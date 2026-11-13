import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useModalFocus } from '../useModalFocus';
import { financeApi, type Invoice, type Payment, type PaymentMethod } from './financeApi';
import {
  formatMoney,
  isValidAmountInput,
  istDate,
  methodLabels,
  receivedAtFor,
  toMinorUnits,
} from './financeFormat';

interface Props {
  invoice: Invoice;
  /** Set when recording the replacement for a reversed payment. */
  corrects?: Payment;
  onClose: () => void;
  onRecorded: (payment: Payment) => void;
}

// The received date is a calendar date in India, whatever the browser's own time zone is.
const todayInput = () => istDate();

export function RecordPaymentModal({ invoice, corrects, onClose, onRecorded }: Props) {
  const dialogRef = useModalFocus<HTMLFormElement>();
  const inFlight = useRef(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [receivedDate, setReceivedDate] = useState(todayInput());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // A retry of the same unchanged form reuses the key and timestamp, so the server can recognise
  // it as the same payment; any edit starts a new attempt with a new key.
  const attempt = useRef<{ fingerprint: string; key: string; receivedAt: string } | null>(null);

  useEffect(() => {
    amountRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !submitting && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  function validate(): string | null {
    if (!isValidAmountInput(amount))
      return 'Enter an amount greater than zero with at most 2 decimals.';
    if (toMinorUnits(amount) > toMinorUnits(invoice.balance))
      return `The amount cannot exceed the remaining balance of ${formatMoney(invoice.balance)}.`;
    if (!receivedDate) return 'Enter the date the payment was received.';
    if (receivedDate > todayInput()) return 'The received date cannot be in the future.';
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const problem = validate();
    if (problem) return setError(problem);
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify([
        amount.trim(),
        method,
        reference.trim(),
        receivedDate,
        notes.trim(),
      ]);
      if (attempt.current?.fingerprint !== fingerprint) {
        attempt.current = {
          fingerprint,
          key: crypto.randomUUID(),
          receivedAt: receivedAtFor(receivedDate),
        };
      }
      const { key, receivedAt } = attempt.current;
      const result = await financeApi.recordPayment(key, {
        invoiceId: invoice.id,
        ...(corrects ? { correctsPaymentId: corrects.id } : {}),
        amount: amount.trim(),
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        receivedAt,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onRecorded(result.payment);
    } catch (err) {
      inFlight.current = false;
      setError(err instanceof Error ? err.message : 'Could not record the payment.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fin-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <form
        ref={dialogRef}
        className="fin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fin-pay-title"
        onSubmit={submit}
        noValidate
      >
        <h2 id="fin-pay-title">{corrects ? 'Record replacement payment' : 'Record payment'}</h2>
        {corrects ? (
          <p className="fin-note">
            Replaces the reversed payment of {formatMoney(corrects.amount)} (
            {corrects.receiptNumber.slice(0, 13)}…).
          </p>
        ) : null}
        <p className="fin-note">
          {invoice.number} · {invoice.residentName} · Remaining balance{' '}
          <strong>{formatMoney(invoice.balance)}</strong>
        </p>
        <label className="fin-field">
          <span>Amount (₹)</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
        </label>
        <button
          type="button"
          className="fin-link-button"
          onClick={() => setAmount(invoice.balance)}
        >
          Pay full balance ({formatMoney(invoice.balance)})
        </button>
        <label className="fin-field">
          <span>Payment method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(methodLabels) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {methodLabels[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-field">
          <span>Reference (optional)</span>
          <input
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UPI transaction ID, cheque or transfer number"
          />
        </label>
        <label className="fin-field">
          <span>Received on</span>
          <input
            type="date"
            value={receivedDate}
            max={todayInput()}
            onChange={(e) => setReceivedDate(e.target.value)}
            required
          />
        </label>
        <label className="fin-field">
          <span>Notes (optional)</span>
          <textarea
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error ? (
          <p className="fin-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="fin-modal-actions">
          <button type="button" className="outline-button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? 'Recording…' : 'Record payment'}
          </button>
        </div>
        <p className="fin-note">Payments cannot be edited or deleted once recorded.</p>
      </form>
    </div>
  );
}
