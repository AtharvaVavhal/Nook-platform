import './auth.css';
import { useState } from 'react';
import { ChangePasswordForm } from './ChangePasswordForm';
import { useAuth } from './AuthContext';

/** Shown instead of the workspace while a temporary password is in use. */
export function PasswordChangePage() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    setBusy(true);
    setError(false);
    try {
      await signOut();
    } catch {
      setBusy(false);
      setError(true);
    }
  }
  return (
    <div className="auth-screen">
      <main className="auth-card" aria-labelledby="pw-title">
        <img
          className="auth-logo"
          src={`${import.meta.env.BASE_URL}brand/nook-logo-white.svg`}
          alt="nook"
          width="100"
          height="36"
        />
        <h1 id="pw-title">Choose your password</h1>
        <p className="auth-lede">Your account needs a password only you know.</p>
        <ChangePasswordForm forced onDone={() => undefined} />
        <p className="auth-aside">
          <button type="button" className="auth-link" disabled={busy} onClick={() => void logout()}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </p>
        {error ? (
          <p className="auth-form-error" role="alert">
            Could not sign out. Try again.
          </p>
        ) : null}
      </main>
    </div>
  );
}
