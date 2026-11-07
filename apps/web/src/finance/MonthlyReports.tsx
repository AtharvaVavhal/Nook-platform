import { useState } from 'react';
import { financeApi } from './financeApi';
import { currentMonth, formatMoney, monthLabel } from './financeFormat';
import { EmptyState, ErrorState, LoadingState, useAsync } from './shared';

export function MonthlyReports() {
  const [month, setMonth] = useState(currentMonth());
  const [months, setMonths] = useState(6);
  const { data, loading, error, reload } = useAsync(
    () => financeApi.report({ month, months }),
    [month, months],
  );

  return (
    <section aria-labelledby="fin-reports-title">
      <div className="fin-card-head">
        <h2 id="fin-reports-title">Monthly financial report</h2>
        <button type="button" className="outline-button" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <div className="fin-toolbar">
        <label className="fin-field">
          <span>Up to month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </label>
        <label className="fin-field">
          <span>Months shown</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[3, 6, 12].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && !data ? <LoadingState label="Loading report…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.months.every((m) => m.invoiceCount === 0 && m.paymentCount === 0) ? (
        <EmptyState
          title="No financial activity in this range"
          hint="Issue invoices or record payments to see them here."
        />
      ) : null}
      {data && data.months.some((m) => m.invoiceCount > 0 || m.paymentCount > 0) ? (
        <div className="fin-table-wrap" aria-busy={loading}>
          <table className="fin-table">
            <caption className="sr-only">
              Invoiced, collected, outstanding and overdue amounts by month
            </caption>
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Invoiced</th>
                <th className="num">Collected</th>
                <th className="num">Outstanding</th>
                <th className="num">Overdue</th>
                <th className="num">Invoices</th>
                <th className="num">Payments</th>
              </tr>
            </thead>
            <tbody>
              {[...data.months].reverse().map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td className="num">{formatMoney(m.invoiced)}</td>
                  <td className="num">{formatMoney(m.collected)}</td>
                  <td className="num">{formatMoney(m.outstanding)}</td>
                  <td className="num">{formatMoney(m.overdue)}</td>
                  <td className="num">{m.invoiceCount}</td>
                  <td className="num">{m.paymentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="fin-note">
        Invoiced covers issued invoices by billing period. Collected is by the date a payment was
        received. Outstanding and overdue are the unpaid balances of that month’s invoices.
      </p>
    </section>
  );
}
