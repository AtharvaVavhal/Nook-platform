import type { ReactNode } from 'react';
import { Icon } from './Icon.js';

/** The page heading takes focus when the screen changes, so keyboard and screen-reader users land at the top of the new page. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string | undefined }) {
  return (
    <header className="rp-page-head">
      <h1 id="page-title" className="rp-page-head__title" tabIndex={-1}>
        {title}
      </h1>
      {subtitle ? <p className="rp-page-head__sub">{subtitle}</p> : null}
    </header>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="rp-back" href={href}>
      <Icon name="back" />
      {children}
    </a>
  );
}

export function Card({
  title,
  action,
  flush,
  children,
  labelledBy,
}: {
  title?: string;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section
      className={`rp-card${flush ? ' rp-card--flush' : ''}`}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
    >
      {title || action ? (
        <div className="rp-card__head" style={flush ? { padding: '20px 20px 0' } : undefined}>
          {title ? <h2 className="rp-card__title">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function DefList({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="rp-deflist">
      {rows.map((row) => (
        <div className="rp-deflist__row" key={row.label}>
          <dt>{row.label}</dt>
          <dd
            className={
              /^-?\u20B9/.test(typeof row.value === 'string' ? row.value : '')
                ? 'rp-num rp-nowrap'
                : 'rp-num'
            }
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Pager({
  page,
  totalPages,
  total,
  busy,
  onPage,
  noun,
}: {
  page: number;
  totalPages: number;
  total: number;
  busy: boolean;
  onPage: (p: number) => void;
  noun: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="rp-pager" aria-label={`${noun} pages`}>
      <span className="rp-pager__info" aria-live="polite">
        Page {page} of {totalPages} ({total} {noun})
      </span>
      <span className="rp-pager__btns">
        <button
          type="button"
          className="rp-btn rp-btn--secondary rp-btn--small"
          disabled={busy || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="rp-btn rp-btn--secondary rp-btn--small"
          disabled={busy || page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </span>
    </nav>
  );
}
