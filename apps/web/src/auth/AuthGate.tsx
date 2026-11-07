import type { ReactNode } from 'react';
import './auth.css';
import { useAuth } from './AuthContext';
import { LoginPage } from './LoginPage';
import { PasswordChangePage } from './PasswordChangePage';

/** Nothing in the workspace renders until the server has confirmed a valid session. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') {
    return (
      <div className="auth-screen" role="status" aria-live="polite">
        <p className="auth-loading">Checking your session…</p>
      </div>
    );
  }
  if (state.status === 'unauthenticated') return <LoginPage notice={state.notice} />;
  // A temporary password must be replaced before anything else is shown.
  if (state.user.passwordChangeRequired) return <PasswordChangePage />;
  return <>{children}</>;
}
