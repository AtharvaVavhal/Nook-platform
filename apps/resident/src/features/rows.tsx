import type { Invoice, Payment } from '../api/types.js';
import {
  formatBillingPeriod,
  formatDate,
  formatInr,
  isZeroAmount,
  methodLabel,
} from '../lib/format.js';
import { hrefs } from '../lib/route.js';
import { invoiceStatus, paymentStatus } from '../lib/status.js';
import { StatusBadge } from '../ui/Badge.js';
import { Icon } from '../ui/Icon.js';

export function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const owing = !isZeroAmount(invoice.outstandingAmount);
  return (
    <a className="rp-row" href={hrefs.invoice(invoice.id)}>
      <div className="rp-row__main">
        <div className="rp-row__title">
          {formatBillingPeriod(invoice.periodStart, invoice.periodEnd)}
        </div>
        <div className="rp-row__meta rp-num">
          {invoice.number} · Due {formatDate(invoice.dueDate)}
        </div>
      </div>
      <div className="rp-row__side">
        <span className="rp-row__amount rp-num">
          {formatInr(owing ? invoice.outstandingAmount : invoice.totalAmount)}
        </span>
        <StatusBadge status={invoiceStatus(invoice.status)} />
      </div>
      <Icon name="chevron" className="rp-row__chev" />
    </a>
  );
}

export function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <a className="rp-row" href={hrefs.receipt(payment.id)}>
      <div className="rp-row__main">
        <div className="rp-row__title rp-num">
          {formatDate(payment.paidAt)} · {methodLabel(payment.method)}
        </div>
        <div className="rp-row__meta rp-num">Receipt {payment.receiptNumber}</div>
        <div className="rp-row__meta rp-num">
          {payment.reference ? `Ref ${payment.reference} · ` : ''}Invoice {payment.invoice.number}
        </div>
      </div>
      <div className="rp-row__side">
        <span className="rp-row__amount rp-num">{formatInr(payment.amount)}</span>
        <StatusBadge status={paymentStatus(payment.status)} />
      </div>
      <Icon name="chevron" className="rp-row__chev" />
    </a>
  );
}
