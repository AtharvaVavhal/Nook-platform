import { useRef, useState } from 'react';
import './auth.css';
import { ChangePasswordForm } from './ChangePasswordForm';
import { useAuth } from './AuthContext';

const ROLE_LABEL: Record<string, string> = { OWNER: 'Owner', PROPERTY_MANAGER: 'Property manager' };

export function UserMenu() {
  const { state, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const inFlight = useRef(false);
  if (state.status !== 'authenticated') return null;
  const { user } = state;

  async function handleSignOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch {
      setError('Could not sign out. Try again.');
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="user-menu">
      <div className="user-menu-who">
        <strong>{user.displayName}</strong>
        <small>
          {user.organization.name} · {ROLE_LABEL[user.role] ?? user.role}
        </small>
      </div>
      <button
        type="button"
        className="user-menu-signout"
        onClick={() => {
          setChanged(false);
          setChanging(true);
        }}
      >
        Change password
      </button>
      <button type="button" className="user-menu-signout" onClick={handleSignOut} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error ? (
        <small className="user-menu-error" role="alert">
          {error}
        </small>
      ) : null}
      {changed ? (
        <small className="user-menu-ok" role="status">
          Password changed.
        </small>
      ) : null}
      {changing ? (
        <div
          className="auth-modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setChanging(false)}
        >
          <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="cp-title">
            <h2 id="cp-title">Change password</h2>
            <p className="auth-lede">Your other signed-in devices will be signed out.</p>
            <ChangePasswordForm
              forced={false}
              onCancel={() => setChanging(false)}
              onDone={() => {
                setChanging(false);
                setChanged(true);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
