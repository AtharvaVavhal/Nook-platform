import { financeApi } from './financeApi';
import { currentMonth, formatMoney, monthLabel } from './financeFormat';
import { financeLinks } from './financeRoute';
import { ErrorState, LoadingState, Stat, useAsync } from './shared';

export function FinanceDashboard() {
  const month = currentMonth();
  const { data, loading, error, reload } = useAsync(
    () => financeApi.report({ month, months: 6 }),
    [month],
  );

  if (loading && !data) return <LoadingState label="Loading finance overview…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const current = data.months[data.months.length - 1]!;
  // Chart scale only: relative bar heights, not accounting arithmetic.
  const scale = Math.max(
    1,
    ...data.months.map((m) => Math.max(Number(m.invoiced), Number(m.collected))),
  );

  return (
    <>
      <div className="fin-stats" aria-label={`Finance summary for ${monthLabel(current.month)}`}>
        <Stat label="Total invoiced" value={formatMoney(current.invoiced)} />
        <Stat label="Total collected" value={formatMoney(current.collected)} tone="success" />
        <Stat label="Outstanding balance" value={formatMoney(current.outstanding)} />
        <Stat
          label="Overdue amount"
          value={formatMoney(current.overdue)}
          tone={Number(current.overdue) > 0 ? 'danger' : undefined}
        />
      </div>
      <p className="fin-note">
        Figures are for {monthLabel(current.month)}. Collected counts payments received this month,
        including for earlier invoices.
      </p>

      <section className="fin-card" aria-labelledby="fin-overview-title">
        <div className="fin-card-head">
          <h2 id="fin-overview-title">Monthly collection overview</h2>
          <a className="outline-button" href={financeLinks.reports}>
            Full report
          </a>
        </div>
        <ul className="fin-bars" aria-label="Invoiced versus collected, last six months">
          {data.months.map((m) => (
            <li key={m.month}>
              <div
                className="fin-bar-pair"
                role="img"
                aria-label={`${monthLabel(m.month)}: invoiced ${formatMoney(m.invoiced)}, collected ${formatMoney(m.collected)}`}
              >
                <span
                  className="fin-bar fin-bar-invoiced"
                  style={{ height: `${(Number(m.invoiced) / scale) * 100}%` }}
                />
                <span
                  className="fin-bar fin-bar-collected"
                  style={{ height: `${(Number(m.collected) / scale) * 100}%` }}
                />
              </div>
              <small>{monthLabel(m.month).slice(0, 3)}</small>
            </li>
          ))}
        </ul>
        <p className="fin-legend">
          <i className="fin-dot fin-bar-invoiced" /> Invoiced{' '}
          <i className="fin-dot fin-bar-collected" /> Collected
        </p>
      </section>
    </>
  );
}
