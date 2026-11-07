import { useRef, useState, type FormEvent } from 'react';
import './auth.css';
import { PasswordChangeError, authApi } from './authApi';
import { useAuth } from './AuthContext';
import { describeLockout, validatePasswordChange, type PasswordChangeErrors } from './authHelpers';

interface Props {
  /** True on the forced screen after a temporary password: there is nothing to cancel back to. */
  forced: boolean;
  onDone: () => void;
  onCancel?: () => void;
}

export function ChangePasswordForm({ forced, onDone, onCancel }: Props) {
  const { refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const found = validatePasswordChange(current, next, confirm);
    setErrors(found);
    setFormError(null);
    if (found.current || found.next || found.confirm) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await authApi.changePassword(current, next);
      await refresh();
      onDone();
    } catch (error) {
      if (error instanceof PasswordChangeError) {
        setFormError(
          error.code === 'RATE_LIMITED' ? describeLockout(error.retryAfterSeconds) : error.message,
        );
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    error?: string,
    autoComplete = 'new-password',
  ) => (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        disabled={submitting}
      />
      {error ? (
        <small id={`${id}-error`} className="auth-error">
          {error}
        </small>
      ) : null}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate>
      {forced ? (
        <p className="auth-notice" role="status">
          You signed in with a temporary password. Choose your own password to continue.
        </p>
      ) : null}
      {field(
        'cp-current',
        'Current password',
        current,
        setCurrent,
        errors.current,
        'current-password',
      )}
      {field('cp-new', 'New password (at least 12 characters)', next, setNext, errors.next)}
      {field('cp-confirm', 'Repeat the new password', confirm, setConfirm, errors.confirm)}
      {formError ? (
        <p className="auth-form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="auth-actions">
        {onCancel ? (
          <button type="button" className="outline-button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="primary-button auth-submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
