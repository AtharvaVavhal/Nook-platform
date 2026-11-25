import { api } from '../../api/index.js';
import type { Receipt } from '../../api/types.js';
import { formatBillingPeriod, formatDateTime, formatInr, methodLabel } from '../../lib/format.js';
import { hrefs } from '../../lib/route.js';
import { invoiceStatus, paymentStatus } from '../../lib/status.js';
import { useResource } from '../../lib/useResource.js';
import { StatusBadge } from '../../ui/Badge.js';
import { Banner, EmptyState, ErrorState, SkeletonCard } from '../../ui/Feedback.js';
import { BackLink, Card, DefList, PageHeader } from '../../ui/Layout.js';

export function ReceiptPage({ id }: { id: string }) {
  const { state, reload } = useResource((s) => api.receipt(id, s), [id]);
  return (
    <div className="rp-stack rp-stack--lg">
      <div>
        <BackLink href={hrefs.payments}>Payments</BackLink>
        <PageHeader
          title="Receipt"
          subtitle="A record of a payment your hostel received from you."
        />
      </div>
      {state.status === 'loading' ? (
        <Card>
          <SkeletonCard lines={6} label="Loading receipt" />
        </Card>
      ) : null}
      {state.status === 'error' ? (
        <Card>
          {state.error.kind === 'notFound' ? (
            <EmptyState
              icon="receipt"
              title="We couldn't find that receipt"
              text="It may not exist, or it may not be one of yours."
              action={
                <a className="rp-link" href={hrefs.payments}>
                  Back to payments
                </a>
              }
            />
          ) : (
            <ErrorState error={state.error} onRetry={reload} />
          )}
        </Card>
      ) : null}
      {state.status === 'ready' ? <ReceiptView receipt={state.data} /> : null}
    </div>
  );
}

function ReceiptView({ receipt }: { receipt: Receipt }) {
  const reversed = receipt.payment.status === 'REVERSED';
  return (
    <div className="rp-stack">
      {reversed ? (
        <Banner tone="warning" role="status">
          This payment was reversed by your hostel. It no longer counts towards the invoice.
        </Banner>
      ) : null}
      <article className="rp-receipt" aria-label={`Receipt ${receipt.receiptNumber}`}>
        <div className="rp-receipt__head">
          <div>
            <div className="rp-eyebrow">Receipt</div>
            <div className="rp-receipt__no rp-num">{receipt.receiptNumber}</div>
          </div>
          <StatusBadge status={paymentStatus(receipt.payment.status)} />
        </div>
        <div className="rp-total">
          <span className="rp-eyebrow">Amount received</span>
          <span className="rp-total__amount rp-num">{formatInr(receipt.payment.amount)}</span>
        </div>
        <hr />
        <DefList
          rows={[
            { label: 'Received from', value: receipt.issuedTo },
            { label: 'Received by', value: receipt.issuedBy },
            { label: 'Payment date', value: formatDateTime(receipt.payment.paidAt) },
            { label: 'Payment method', value: methodLabel(receipt.payment.method) },
            { label: 'Reference', value: receipt.payment.reference ?? '—' },
          ]}
        />
        <hr />
        <div>
          <div className="rp-eyebrow" style={{ marginBottom: 12 }}>
            Against invoice
          </div>
          <DefList
            rows={[
              { label: 'Invoice number', value: receipt.invoice.number },
              {
                label: 'Billing period',
                value: formatBillingPeriod(receipt.invoice.periodStart, receipt.invoice.periodEnd),
              },
              { label: 'Invoice total', value: formatInr(receipt.invoice.totalAmount) },
              { label: 'Paid on invoice', value: formatInr(receipt.invoice.paidAmount) },
              { label: 'Invoice outstanding', value: formatInr(receipt.invoice.outstandingAmount) },
              {
                label: 'Balance after this payment',
                value: formatInr(receipt.balanceAfterPayment),
              },
              {
                label: 'Invoice status',
                value: <StatusBadge status={invoiceStatus(receipt.invoice.status)} />,
              },
            ]}
          />
        </div>
      </article>
    </div>
  );
}
