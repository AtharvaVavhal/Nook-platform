import { useState } from 'react';
import { financeApi, type Payment } from './financeApi';
import { CreditInvoiceModal, ReversePaymentModal, VoidInvoiceModal } from './CorrectionModals';
import {
  canVoidInvoice,
  formatDate,
  formatDateTime,
  formatMoney,
  methodLabels,
  monthLabel,
  voidBlockedReason,
} from './financeFormat';
import { financeLinks } from './financeRoute';
import { RecordPaymentModal } from './RecordPaymentModal';
import { EmptyState, ErrorState, LoadingState, Stat, StatusBadge, useAsync } from './shared';

export function InvoiceDetail({ id }: { id: string }) {
  const { data, loading, error, reload } = useAsync(() => financeApi.getInvoice(id), [id]);
  const [paying, setPaying] = useState(false);
  const [replacing, setReplacing] = useState<Payment | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [crediting, setCrediting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !data) return <LoadingState label="Loading invoice…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const canPay =
    ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(data.status) && Number(data.balance) > 0;

  async function issue() {
    setIssuing(true);
    setActionError(null);
    try {
      await financeApi.issue(id);
      setNotice('Invoice issued.');
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not issue the invoice.');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <section aria-labelledby="fin-invoice-title">
      <p>
        <a href={financeLinks.invoices}>← All invoices</a>
      </p>
      <div className="fin-card-head">
        <div>
          <h2 id="fin-invoice-title">
            {data.number} <StatusBadge status={data.status} />
          </h2>
          <p className="fin-note">
            {data.residentName} · {monthLabel(data.periodStart.slice(0, 7))} (
            {formatDate(data.periodStart)} – {formatDate(data.periodEnd)})
          </p>
        </div>
        <div className="fin-actions">
          {data.status === 'DRAFT' ? (
            <button type="button" className="primary-button" onClick={issue} disabled={issuing}>
              {issuing ? 'Issuing…' : 'Issue invoice'}
            </button>
          ) : null}
          {canPay ? (
            <button type="button" className="outline-button" onClick={() => setCrediting(true)}>
              Credit invoice
            </button>
          ) : null}
          {canPay ? (
            <button type="button" className="primary-button" onClick={() => setPaying(true)}>
              Record payment
            </button>
          ) : null}
          {canVoidInvoice(data) ? (
            <button type="button" className="outline-button" onClick={() => setVoiding(true)}>
              Void invoice
            </button>
          ) : null}
          {data.payments.length > 0 ? (
            <a className="outline-button" href={financeLinks.receipt(data.id)}>
              Receipts
            </a>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      {actionError ? <ErrorState message={actionError} /> : null}
      {data.void ? (
        <p className="fin-warning" role="status">
          <strong>Voided</strong> on {formatDateTime(data.void.voidedAt)} by{' '}
          {data.void.voidedBy ?? 'a user'}: {data.void.reason}. It was{' '}
          {data.void.previousStatus.toLowerCase().replace('_', ' ')} for{' '}
          {formatMoney(data.void.amountAtVoid)}. It stays here for the record and cannot be paid or
          changed.
        </p>
      ) : null}
      {data.legacyCancelled ? (
        <p className="fin-warning" role="status">
          This invoice was cancelled before void records existed, so no reason or user was recorded
          for it. It is kept as it was.
        </p>
      ) : null}
      {voidBlockedReason(data) ? <p className="fin-note">{voidBlockedReason(data)}</p> : null}

      <div className="fin-stats">
        <Stat label="Invoice amount" value={formatMoney(data.amount)} />
        <Stat label="Paid" value={formatMoney(data.cashReceived)} tone="success" />
        {Number(data.adjustmentTotal) !== 0 ? (
          <Stat
            label="Credits applied"
            value={formatMoney(data.adjustmentTotal.replace('-', ''))}
          />
        ) : null}
        <Stat
          label="Remaining balance"
          value={formatMoney(data.balance)}
          tone={data.isOverdue ? 'danger' : undefined}
        />
        <Stat
          label={data.isOverdue ? `Due · ${data.daysOverdue} days late` : 'Due date'}
          value={formatDate(data.dueDate)}
          tone={data.isOverdue ? 'danger' : undefined}
        />
      </div>
      {data.notes ? <p className="fin-note">Notes: {data.notes}</p> : null}

      <h3>Payment history</h3>
      {data.payments.length === 0 ? (
        <EmptyState
          title="No payments recorded"
          hint={
            data.status === 'DRAFT'
              ? 'Issue the invoice before recording payments.'
              : 'Payments will appear here once recorded.'
          }
        />
      ) : (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Receipt</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="num">Amount</th>
                <th className="fin-noprint">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className={p.reversed ? 'fin-struck' : undefined}>
                  <td>
                    {formatDateTime(p.receivedAt)}
                    {p.reversed ? <span className="fin-tag">Reversed</span> : null}
                    {p.correctsPaymentId ? <span className="fin-tag">Replacement</span> : null}
                  </td>
                  <td>
                    <a href={financeLinks.receipt(data.id, p.id)} title={p.receiptNumber}>
                      {p.receiptNumber.slice(0, 13)}…
                    </a>
                  </td>
                  <td>{methodLabels[p.method]}</td>
                  <td>{p.reference ?? '—'}</td>
                  <td className="num">{formatMoney(p.amount)}</td>
                  <td className="fin-noprint">
                    {!p.reversed && data.status !== 'CANCELLED' ? (
                      <button
                        type="button"
                        className="fin-link-button"
                        onClick={() => setReversing(p)}
                      >
                        Reverse
                      </button>
                    ) : null}
                    {p.reversed &&
                    !data.payments.some((x) => x.correctsPaymentId === p.id) &&
                    canPay ? (
                      <button
                        type="button"
                        className="fin-link-button"
                        onClick={() => setReplacing(p)}
                      >
                        Record replacement
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.payments.some((p) => p.reversed) || data.adjustments.length > 0 ? (
        <>
          <h3>Corrections</h3>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>By</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...data.payments.flatMap((p) =>
                    p.reversal
                      ? [
                          {
                            key: p.reversal.id,
                            at: p.reversal.reversedAt,
                            type: 'Payment reversed',
                            reason: p.reversal.reason,
                            by: p.reversal.reversedBy,
                            amount: p.amount,
                          },
                        ]
                      : [],
                  ),
                  ...data.adjustments.map((a) => ({
                    key: a.id,
                    at: a.createdAt,
                    type: 'Credit applied',
                    reason: a.reason,
                    by: a.createdBy,
                    amount: a.amount.replace('-', ''),
                  })),
                ]
                  .sort((x, y) => y.at.localeCompare(x.at))
                  .map((row) => (
                    <tr key={row.key}>
                      <td>{formatDateTime(row.at)}</td>
                      <td>{row.type}</td>
                      <td>{row.reason}</td>
                      <td>{row.by ?? '—'}</td>
                      <td className="num">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {paying || replacing ? (
        <RecordPaymentModal
          invoice={data}
          {...(replacing ? { corrects: replacing } : {})}
          onClose={() => {
            setPaying(false);
            setReplacing(null);
          }}
          onRecorded={(payment) => {
            setPaying(false);
            setReplacing(null);
            setNotice(`Payment of ${formatMoney(payment.amount)} recorded.`);
            reload();
          }}
        />
      ) : null}
      {reversing ? (
        <ReversePaymentModal
          payment={reversing}
          invoiceNumber={data.number}
          onClose={() => setReversing(null)}
          onDone={(message) => {
            setReversing(null);
            setNotice(message);
            reload();
          }}
        />
      ) : null}
      {voiding ? (
        <VoidInvoiceModal
          invoice={data}
          onClose={() => setVoiding(false)}
          onDone={(message) => {
            setVoiding(false);
            setNotice(message);
            reload();
          }}
        />
      ) : null}
      {crediting ? (
        <CreditInvoiceModal
          invoice={data}
          onClose={() => setCrediting(false)}
          onDone={(message) => {
            setCrediting(false);
            setNotice(message);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}
