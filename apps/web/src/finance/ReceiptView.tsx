import { financeApi } from './financeApi';
import { formatDate, formatDateTime, formatMoney, methodLabels, monthLabel } from './financeFormat';
import { financeLinks } from './financeRoute';
import { ErrorState, LoadingState, useAsync } from './shared';

export function ReceiptView({
  invoiceId,
  paymentId,
}: {
  invoiceId: string;
  paymentId?: string | undefined;
}) {
  const { data, loading, error, reload } = useAsync(
    () => financeApi.receipt(invoiceId, paymentId),
    [invoiceId, paymentId],
  );

  if (loading && !data) return <LoadingState label="Loading receipt…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <section aria-labelledby="fin-receipt-title">
      <div className="fin-noprint fin-card-head">
        <a href={financeLinks.invoice(invoiceId)}>← Back to invoice</a>
        <button type="button" className="primary-button" onClick={() => window.print()}>
          Print receipt{data.receipts.length > 1 ? 's' : ''}
        </button>
      </div>
      <h2 id="fin-receipt-title" className="sr-only">
        Receipt for invoice {data.invoice.number}
      </h2>
      {data.receipts.map((receipt) => (
        <article className="fin-receipt" key={receipt.paymentId}>
          <header>
            <div>
              <p className="fin-receipt-org">{data.organizationName}</p>
              <p className="fin-receipt-kicker">Payment receipt</p>
            </div>
            <div className="fin-receipt-number">
              <small>Receipt no.</small>
              <code>{receipt.receiptNumber}</code>
            </div>
          </header>
          {receipt.reversed ? (
            <p className="fin-receipt-reversed" role="status">
              REVERSED{receipt.reversedAt ? ` on ${formatDateTime(receipt.reversedAt)}` : ''} — this
              receipt is no longer valid.
            </p>
          ) : null}
          <dl>
            <div>
              <dt>Received from</dt>
              <dd>{data.invoice.residentName}</dd>
            </div>
            <div>
              <dt>Invoice</dt>
              <dd>
                {data.invoice.number} · {monthLabel(data.invoice.periodStart.slice(0, 7))}
                <small>
                  {' '}
                  ({formatDate(data.invoice.periodStart)} – {formatDate(data.invoice.periodEnd)})
                </small>
              </dd>
            </div>
            <div>
              <dt>Date received</dt>
              <dd>{formatDateTime(receipt.receivedAt)}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>
                {methodLabels[receipt.method]}
                {receipt.reference ? <small> · Ref {receipt.reference}</small> : null}
              </dd>
            </div>
          </dl>
          <p className="fin-receipt-amount">
            <small>Amount received</small>
            <strong>{formatMoney(receipt.amount)}</strong>
          </p>
          <dl className="fin-receipt-totals">
            <div>
              <dt>Invoice total</dt>
              <dd>{formatMoney(data.invoice.amount)}</dd>
            </div>
            {receipt.creditTotalAtPayment !== null ? (
              <div>
                <dt>Credits applied at the time</dt>
                <dd>{formatMoney(receipt.creditTotalAtPayment.replace('-', ''))}</dd>
              </div>
            ) : null}
            <div>
              <dt>Balance after this payment</dt>
              <dd>
                {formatMoney(receipt.balanceAfterPayment)}
                {receipt.balanceSource === 'derived' ? (
                  <span
                    className="fin-tag"
                    title="Recorded before receipts stored their own figures, so this is recalculated from today's invoice and may differ from what was shown at the time."
                  >
                    Derived
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
          {receipt.notes ? <p className="fin-note">Note: {receipt.notes}</p> : null}
          <footer>
            This is a computer-generated receipt and records a payment already received.
          </footer>
        </article>
      ))}
    </section>
  );
}
