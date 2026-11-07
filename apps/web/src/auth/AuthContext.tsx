import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { UNAUTHORIZED_EVENT } from '../apiConfig';
import { authApi, type AuthUser } from './authApi';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated'; notice: string | null }
  | { status: 'authenticated'; user: AuthUser };

interface AuthValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-read the user from the server (for example after a password change). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export const SESSION_EXPIRED_NOTICE = 'Your session has ended. Please sign in again.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  // Ask the server who we are: the HttpOnly cookie, not the browser, is the source of truth.
  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then((user) => {
        if (!cancelled)
          setState(
            user ? { status: 'authenticated', user } : { status: 'unauthenticated', notice: null },
          );
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unauthenticated', notice: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any API call that is refused with 401 means the session ended (expiry, revocation, another tab).
  useEffect(() => {
    const onUnauthorized = () =>
      setState((current) =>
        current.status === 'authenticated'
          ? { status: 'unauthenticated', notice: SESSION_EXPIRED_NOTICE }
          : current,
      );
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const user = await authApi.login(email, password);
    setState({ status: 'authenticated', user });
  }, []);

  const signOut = useCallback(async () => {
    await authApi.logout();
    setState({ status: 'unauthenticated', notice: null });
  }, []);

  const refresh = useCallback(async () => {
    const user = await authApi.me();
    setState(
      user ? { status: 'authenticated', user } : { status: 'unauthenticated', notice: null },
    );
  }, []);

  const value = useMemo(
    () => ({ state, signIn, signOut, refresh }),
    [state, signIn, signOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
