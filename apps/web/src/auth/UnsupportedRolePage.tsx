import './auth.css';
import { useState } from 'react';
import { useAuth } from './AuthContext';

/** Shown to a signed-in account whose role has no interface (STAFF and RESIDENT are not defined by the API). */
export function UnsupportedRolePage() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-screen">
      <main className="auth-card" aria-labelledby="unsupported-title">
        <img
          className="auth-logo"
          src={`${import.meta.env.BASE_URL}brand/nook-logo-white.svg`}
          alt="nook"
          width="100"
          height="36"
        />
        <h1 id="unsupported-title">Access denied</h1>
        <p className="auth-lede">
          This account type does not have access to the Nook workspace. Ask the owner of your
          organization for help.
        </p>
        <p className="auth-aside">
          <button
            type="button"
            className="auth-link"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signOut().finally(() => setBusy(false));
            }}
          >
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </p>
      </main>
    </div>
  );
}
