import { useState } from 'react';
import { financeApi } from './financeApi';
import { formatDate, formatMoney } from './financeFormat';
import { financeLinks } from './financeRoute';
import { EmptyState, ErrorState, LoadingState, Pager, StatusBadge, Stat, useAsync } from './shared';

export function OutstandingPayments() {
  const [page, setPage] = useState(1);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const { data, loading, error, reload } = useAsync(
    () => financeApi.outstanding({ page, limit: 20, overdueOnly }),
    [page, overdueOnly],
  );

  return (
    <section aria-labelledby="fin-outstanding-title">
      <div className="fin-card-head">
        <h2 id="fin-outstanding-title">Outstanding payments</h2>
        <label className="fin-check">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => {
              setPage(1);
              setOverdueOnly(e.target.checked);
            }}
          />
          Overdue only
        </label>
      </div>
      <p className="fin-note">
        Overdue accounts are for owner review. Nothing is cancelled or restricted automatically.
      </p>

      {loading && !data ? <LoadingState label="Loading outstanding balances…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <div className="fin-stats">
            <Stat label="Total outstanding" value={formatMoney(data.totals.outstandingAmount)} />
            <Stat label="Open invoices" value={String(data.totals.outstandingCount)} />
            <Stat
              label="Overdue amount"
              value={formatMoney(data.totals.overdueAmount)}
              tone={Number(data.totals.overdueAmount) > 0 ? 'danger' : undefined}
            />
            <Stat label="Overdue invoices" value={String(data.totals.overdueCount)} />
          </div>
          {data.items.length === 0 ? (
            <EmptyState
              title={overdueOnly ? 'Nothing is overdue' : 'No outstanding balances'}
              hint="Every issued invoice is paid up."
            />
          ) : (
            <div className="fin-table-wrap" aria-busy={loading}>
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Resident</th>
                    <th>Invoice</th>
                    <th>Due</th>
                    <th className="num">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.residentName}</td>
                      <td>
                        <a href={financeLinks.invoice(invoice.id)}>{invoice.number}</a>
                      </td>
                      <td>
                        {formatDate(invoice.dueDate)}
                        {invoice.isOverdue ? (
                          <small className="fin-overdue-days">
                            {' '}
                            · {invoice.daysOverdue} days late
                          </small>
                        ) : null}
                      </td>
                      <td className="num">{formatMoney(invoice.balance)}</td>
                      <td>
                        <StatusBadge status={invoice.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : null}
    </section>
  );
}
