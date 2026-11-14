import type { ReactNode } from 'react';
import { NO_ACCESS_MESSAGE, showingLabel } from './dashboardRules';

/** A titled card. Every panel is a labelled region so assistive technology can jump between them. */
export function Panel({
  id,
  title,
  note,
  wide,
  children,
}: {
  id: string;
  title: string;
  note?: string | undefined;
  wide?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <section className={`fin-card dash-panel${wide ? ' dash-wide' : ''}`} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {note ? <p className="fin-hint">{note}</p> : null}
      {children}
    </section>
  );
}

/** What a section shows when the caller's role does not hold its permission: a message, never data. */
export function NoAccess() {
  return <p className="fin-hint dash-noaccess">{NO_ACCESS_MESSAGE}</p>;
}

/**
 * A small captioned table inside a horizontally scrollable wrapper, so a narrow screen scrolls the table, not the page.
 * `count` is the exact total; when it exceeds the rows shown the table says so.
 */
export function DataTable({
  caption,
  head,
  rows,
  empty,
  count,
}: {
  caption: string;
  head: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  empty: string;
  count?: number;
}) {
  if (rows.length === 0) return <p className="fin-hint dash-empty">{empty}</p>;
  const more = count !== undefined ? showingLabel(count, rows.length) : null;
  return (
    <>
      <div className="fin-table-wrap" role="region" aria-label={caption} tabIndex={0}>
        <table className="fin-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more ? <p className="fin-hint">{more}</p> : null}
    </>
  );
}
