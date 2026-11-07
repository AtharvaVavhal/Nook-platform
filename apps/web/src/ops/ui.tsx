import { useRef, useState, type ReactNode } from 'react';
import './ops.css';
import { OpsApiError } from './opsApi';

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="fin-field">
      <span>{label}</span>
      {children}
      {error ? (
        <small className="fin-form-error" role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

/**
 * Runs an async action at most once at a time. The lock is a ref, so two clicks in the same tick cannot
 * both start it. Returns the busy flag and the error text for the form to show.
 */
export function useGuardedAction() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(
        e instanceof OpsApiError || e instanceof Error
          ? e.message
          : 'Something went wrong. Please try again.',
      );
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p className="fin-form-error" role="alert">
      {message}
    </p>
  ) : null;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="fin-tag">{children}</span>;
}

export function PageHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="fin-card-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}
