import type { ReactNode } from 'react';
import { describeLoadError } from '../lib/errorCopy.js';
import type { ApiError } from '../api/errors.js';
import { Button } from './Button.js';
import { Icon, type IconName } from './Icon.js';

export function Banner({
  tone,
  children,
  role,
}: {
  tone: 'info' | 'warning' | 'error';
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  const icon: IconName = tone === 'error' ? 'alert' : tone === 'warning' ? 'clock' : 'info';
  return (
    <div className={`rp-banner rp-banner--${tone}`} {...(role ? { role } : {})}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  text,
  action,
}: {
  icon?: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rp-state">
      <div className="rp-state__icon">
        <Icon name={icon} />
      </div>
      <h2 className="rp-state__title">{title}</h2>
      {text ? <p className="rp-state__text">{text}</p> : null}
      {action}
    </div>
  );
}

/** A failed load, worded for a resident, with a way to try again. It never shows a status code or a raw message. */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const message = describeLoadError(error);
  return (
    <div className="rp-state rp-state--error" role="alert">
      <div className="rp-state__icon">
        <Icon name={error.kind === 'network' ? 'wifi' : 'alert'} />
      </div>
      <h2 className="rp-state__title">{message.title}</h2>
      <p className="rp-state__text">{message.text}</p>
      {onRetry ? (
        <Button variant="secondary" size="small" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({
  width = '100%',
  height = 14,
}: {
  width?: string | number;
  height?: number;
}) {
  return <span className="rp-skel" style={{ width, height }} aria-hidden="true" />;
}

/** Placeholder rows shown while a list loads. The region is announced once as busy, not once per bar. */
export function SkeletonRows({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="rp-visually-hidden">{label}</span>
      <ul className="rp-list" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <div className="rp-row">
              <div className="rp-row__main" style={{ display: 'grid', gap: 8 }}>
                <Skeleton width="55%" height={16} />
                <Skeleton width="35%" />
              </div>
              <div className="rp-row__side">
                <Skeleton width={72} height={16} />
                <Skeleton width={56} height={20} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SkeletonCard({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={{ display: 'grid', gap: 12 }}>
      <span className="rp-visually-hidden">{label}</span>
      <Skeleton width="40%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}
