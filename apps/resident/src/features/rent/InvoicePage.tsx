import { api } from '../../api/index.js';
import type { InvoiceDetail } from '../../api/types.js';
import {
  formatBillingPeriod,
  formatDate,
  formatInr,
  isZeroAmount,
  methodLabel,
} from '../../lib/format.js';
import { hrefs } from '../../lib/route.js';
import { invoiceStatus, paymentStatus } from '../../lib/status.js';
import { useResource } from '../../lib/useResource.js';
import { StatusBadge } from '../../ui/Badge.js';
import { EmptyState, ErrorState, SkeletonCard } from '../../ui/Feedback.js';
import { Icon } from '../../ui/Icon.js';
import { BackLink, Card, DefList, PageHeader } from '../../ui/Layout.js';

export function InvoicePage({ id }: { id: string }) {
  const { state, reload } = useResource((s) => api.invoice(id, s), [id]);
  return (
    <div className="rp-stack rp-stack--lg">
      <div>
        <BackLink href={hrefs.rent}>Rent &amp; Invoices</BackLink>
        <PageHeader
          title={state.status === 'ready' ? `Invoice ${state.data.number}` : 'Invoice'}
          subtitle={
            state.status === 'ready'
              ? formatBillingPeriod(state.data.periodStart, state.data.periodEnd)
              : undefined
          }
        />
      </div>
      {state.status === 'loading' ? (
        <Card>
          <SkeletonCard lines={6} label="Loading invoice" />
        </Card>
      ) : null}
      {state.status === 'error' ? (
        <Card>
          {state.error.kind === 'notFound' ? (
            <EmptyState
              icon="receipt"
              title="We couldn't find that invoice"
              text="It may not exist, or it may not be one of yours."
              action={
                <a className="rp-link" href={hrefs.rent}>
                  Back to invoices
                </a>
              }
            />
          ) : (
            <ErrorState error={state.error} onRetry={reload} />
          )}
        </Card>
      ) : null}
      {state.status === 'ready' ? <Detail invoice={state.data} /> : null}
    </div>
  );
}

function Detail({ invoice }: { invoice: InvoiceDetail }) {
  const owing = !isZeroAmount(invoice.outstandingAmount);
  return (
    <div className="rp-grid rp-grid--2">
      <Card>
        <div className="rp-stack">
          <div className="rp-total">
            <span className="rp-eyebrow">{owing ? 'Amount outstanding' : 'Invoice total'}</span>
            <span className="rp-total__amount rp-num">
              {formatInr(owing ? invoice.outstandingAmount : invoice.totalAmount)}
            </span>
            <div style={{ marginTop: 8 }}>
              <StatusBadge status={invoiceStatus(invoice.status)} />
            </div>
          </div>
          <DefList
            rows={[
              { label: 'Invoice number', value: invoice.number },
              {
                label: 'Billing period',
                value: formatBillingPeriod(invoice.periodStart, invoice.periodEnd),
              },
              { label: 'Issue date', value: formatDate(invoice.issuedAt) },
              { label: 'Due date', value: formatDate(invoice.dueDate) },
              { label: 'Total amount', value: formatInr(invoice.totalAmount) },
              { label: 'Paid', value: formatInr(invoice.paidAmount) },
              { label: 'Outstanding', value: formatInr(invoice.outstandingAmount) },
            ]}
          />
        </div>
      </Card>
      <Card flush title="Payments on this invoice">
        {invoice.payments.length === 0 ? (
          <EmptyState
            icon="card"
            title="No payments recorded yet"
            text="Payments your hostel records against this invoice will appear here."
          />
        ) : (
          <ul className="rp-list">
            {invoice.payments.map((p) => (
              <li key={p.id}>
                <a className="rp-row" href={hrefs.receipt(p.id)}>
                  <div className="rp-row__main">
                    <div className="rp-row__title rp-num">
                      {formatDate(p.paidAt)} · {methodLabel(p.method)}
                    </div>
                    <div className="rp-row__meta rp-num">Receipt {p.receiptNumber}</div>
                    {p.reference ? (
                      <div className="rp-row__meta rp-num">Ref {p.reference}</div>
                    ) : null}
                  </div>
                  <div className="rp-row__side">
                    <span className="rp-row__amount rp-num">{formatInr(p.amount)}</span>
                    <StatusBadge status={paymentStatus(p.status)} />
                  </div>
                  <Icon name="chevron" className="rp-row__chev" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
