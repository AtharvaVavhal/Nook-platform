import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { InvoiceStatus } from './financeApi';
import { statusLabels } from './financeFormat';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const run = ++latest.current;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (run === latest.current) setData(result);
      })
      .catch((e: unknown) => {
        if (run === latest.current)
          setError(e instanceof Error ? e.message : 'Something went wrong');
      })
      .finally(() => {
        if (run === latest.current) setLoading(false);
      });
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, reload };
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="fin-state" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="fin-state fin-state-error" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="outline-button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="fin-state fin-empty">
      <strong>{title}</strong>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`fin-badge fin-badge-${status.toLowerCase().replace('_', '-')}`}>
      {statusLabels[status]}
    </span>
  );
}

export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="fin-pager" aria-label="Pagination">
      <button
        type="button"
        className="outline-button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="outline-button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'success' | undefined;
}) {
  return (
    <div className={`fin-stat ${tone ? `fin-stat-${tone}` : ''}`}>
      <span className="card-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
