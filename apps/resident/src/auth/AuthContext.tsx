import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, setUnauthorizedHandler } from '../api/index.js';
import { ApiError, asApiError } from '../api/errors.js';
import type { Profile } from '../api/types.js';
import { sessionCheckFromError, type SessionCheck } from './sessionCheck.js';

export type AuthState =
  | { status: 'checking' }
  | {
      status: 'signedOut';
      notice: 'session-ended' | 'signed-out' | 'no-session' | null;
      /** The number the resident was signing in with, kept only when a sign-in could not be completed. */
      phone?: string;
    }
  | { status: 'signedIn'; profile: Profile }
  | { status: 'unavailable'; error: ApiError };

interface AuthValue {
  state: AuthState;
  /**
   * Re-reads the session and says what it found. Pass `signIn` right after a code was accepted: if the read then cannot be completed,
   * the retry screen knows which number the resident was signing in with.
   */
  refresh: (options?: { signIn?: { phone: string } }) => Promise<SessionCheck>;
  /** "Try again" on the retry screen: like refresh, but a sign-in that still has no session is explained, not silently dropped. */
  retry: () => Promise<SessionCheck>;
  /** Ends the session on the server first; resolves false if that could not be done, so the screen can say so. */
  signOut: () => Promise<boolean>;
}

const Ctx = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** The signed-in profile; only for screens that are rendered while signed in. */
export function useProfile(): Profile {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useProfile needs a signed-in session');
  return state.profile;
}

/**
 * Who is signed in is decided by the server, never by the browser: the session lives in an HttpOnly cookie that this code cannot
 * read, and "signed in" simply means `GET /me` answered. Any later 401 (the session ended, or portal access was paused) returns the
 * resident to sign-in with a plain explanation. Nothing about the session is stored in the browser.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'checking' });
  const mounted = useRef(true);
  const signIn = useRef<{ phone: string } | null>(null);

  const refresh = useCallback(
    async (options?: { signIn?: { phone: string } }): Promise<SessionCheck> => {
      if (options?.signIn) signIn.current = options.signIn;
      try {
        const profile = await api.profile();
        signIn.current = null;
        if (mounted.current) setState({ status: 'signedIn', profile });
        return sessionCheckFromError(null);
      } catch (error) {
        const check = sessionCheckFromError(error);
        // Only "unavailable" keeps the sign-in context: that is the one answer that still needs a retry.
        if (check.kind !== 'unavailable') signIn.current = null;
        if (mounted.current)
          setState(
            check.kind === 'unavailable'
              ? { status: 'unavailable', error: check.error }
              : { status: 'signedOut', notice: null },
          );
        return check;
      }
    },
    [],
  );

  const retry = useCallback(async (): Promise<SessionCheck> => {
    const attempt = signIn.current;
    const check = await refresh();
    if (check.kind === 'noSession' && attempt && mounted.current)
      setState({ status: 'signedOut', notice: 'no-session', phone: attempt.phone });
    return check;
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    setUnauthorizedHandler(() =>
      setState((prev) =>
        prev.status === 'signedIn' ? { status: 'signedOut', notice: 'session-ended' } : prev,
      ),
    );
    void refresh();
    return () => {
      mounted.current = false;
      setUnauthorizedHandler(null);
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    signIn.current = null;
    try {
      await api.logout();
    } catch (error) {
      // A 401 means there was no session left to end: the goal is met. Anything else (offline, server) means it may still be live.
      if (asApiError(error).kind !== 'unauthorized') return false;
    }
    window.location.hash = '#/';
    setState({ status: 'signedOut', notice: 'signed-out' });
    return true;
  }, []);

  const value = useMemo(
    () => ({ state, refresh, retry, signOut }),
    [state, refresh, retry, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
