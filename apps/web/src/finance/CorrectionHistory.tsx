import { financeApi } from './financeApi';
import { formatDateTime, formatMoney } from './financeFormat';
import { financeLinks } from './financeRoute';
import { EmptyState, ErrorState, LoadingState, useAsync } from './shared';

const TYPE_LABEL = {
  PAYMENT_REVERSAL: 'Payment reversed',
  INVOICE_CREDIT: 'Credit applied',
} as const;

/** The API returns at most this many entries (it has no paging); older ones are not reachable from here. */
const CORRECTION_LIMIT = 200;

export function CorrectionHistory() {
  const { data, loading, error, reload } = useAsync(
    () => financeApi.corrections({ limit: CORRECTION_LIMIT }),
    [],
  );

  return (
    <section aria-labelledby="fin-corrections-title">
      <h2 id="fin-corrections-title">Correction history</h2>
      <p className="fin-note">
        Every payment reversal and invoice credit, newest first. Corrections never edit or delete
        the original records.
      </p>
      {loading && !data ? <LoadingState label="Loading corrections…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title="No corrections yet"
          hint="Reversed payments and invoice credits will be listed here."
        />
      ) : null}
      {data && data.items.length >= CORRECTION_LIMIT ? (
        <p className="fin-note" role="status">
          Showing the latest {CORRECTION_LIMIT} entries. Older corrections exist but cannot be
          listed here yet, because the API has no paging for this list.
        </p>
      ) : null}
      {data && data.items.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Type</th>
                <th>Reason</th>
                <th>By</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>
                    <a href={financeLinks.invoice(item.invoiceId)}>{item.invoiceNumber}</a>
                  </td>
                  <td>{TYPE_LABEL[item.type]}</td>
                  <td>{item.reason}</td>
                  <td>{item.actor}</td>
                  <td className="num">{formatMoney(item.amount.replace('-', ''))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
