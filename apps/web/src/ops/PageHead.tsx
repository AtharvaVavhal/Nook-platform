import type { ReactNode } from 'react';

export function PageHead({
  title,
  action,
  id,
  as: Heading = 'h2',
}: {
  title: string;
  action?: ReactNode;
  id?: string;
  /** The heading level. `h2` for the many screens that sit under a shell title; `h1` where the screen is the page. */
  as?: 'h1' | 'h2';
}) {
  return (
    <div className="fin-card-head">
      <Heading id={id}>{title}</Heading>
      {action}
    </div>
  );
}
