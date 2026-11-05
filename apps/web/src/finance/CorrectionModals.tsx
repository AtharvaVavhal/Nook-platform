import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FinanceApiError, financeApi, type Invoice, type Payment } from './financeApi';
import { formatMoney, isValidAmountInput, toMinorUnits } from './financeFormat';

const REASON_HINT = 'Explain why (3 to 500 characters). This is kept in the audit history.';
const validReason = (reason: string) => reason.trim().length >= 3 && reason.trim().length <= 500;

interface ReverseProps {
  payment: Payment;
  invoiceNumber: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ReversePaymentModal({ payment, invoiceNumber, onClose, onDone }: ReverseProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: two clicks in the same tick must not both pass the guard.
  const inFlight = useRef(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !inFlight.current && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!validReason(reason)) return setError(REASON_HINT);
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await financeApi.reversePayment(payment.id, reason.trim());
      onDone(`Payment of ${formatMoney(payment.amount)} reversed.`);
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 409) {
        // The reversal already went through (for example a retry after a lost response).
        onDone('This payment was already reversed.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not reverse the payment.');
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fin-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <form
        className="fin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fin-reverse-title"
        onSubmit={submit}
        noValidate
      >
        <h2 id="fin-reverse-title">Reverse payment</h2>
        <p className="fin-note">
          {invoiceNumber} · {formatMoney(payment.amount)} · {payment.receiptNumber.slice(0, 13)}…
        </p>
        <p className="fin-note">
          The payment stays in the history, marked as reversed. The invoice balance is restored and
          its status recalculated. To correct an amount, reverse it and then record a replacement.
        </p>
        <label className="fin-field">
          <span>Reason</span>
          <textarea
            ref={reasonRef}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={Boolean(error)}
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
            {submitting ? 'Reversing…' : 'Reverse payment'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface VoidProps {
  invoice: Invoice;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Voiding is terminal: the invoice is kept, marked void, and can never be paid, credited or re-issued. */
export function VoidInvoiceModal({ invoice, onClose, onDone }: VoidProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !inFlight.current && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!validReason(reason)) return setError(REASON_HINT);
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await financeApi.voidInvoice(invoice.id, reason.trim());
      onDone(`Invoice ${invoice.number} voided.`);
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 409) {
        // Refused, or already voided (for example a retry after a lost response): say so, change nothing.
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Could not void the invoice.');
      }
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fin-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <form
        className="fin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fin-void-title"
        onSubmit={submit}
        noValidate
      >
        <h2 id="fin-void-title">Void invoice</h2>
        <p className="fin-note">
          {invoice.number} · {invoice.residentName} · {formatMoney(invoice.amount)}
        </p>
        <p className="fin-note">
          Voiding cannot be undone. The invoice stays in the history marked as void, with your name
          and this reason, and it can no longer be paid or credited. That month is not billed again
          automatically.
        </p>
        <label className="fin-field">
          <span>Reason</span>
          <textarea
            ref={reasonRef}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={Boolean(error)}
          />
        </label>
        {error ? (
          <p className="fin-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="fin-modal-actions">
          <button type="button" className="outline-button" onClick={onClose} disabled={submitting}>
            Keep invoice
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? 'Voiding…' : 'Void invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface CreditProps {
  invoice: Invoice;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function CreditInvoiceModal({ invoice, onClose, onDone }: CreditProps) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    amountRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !inFlight.current && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!isValidAmountInput(amount)) {
      return setError('Enter a credit greater than zero with at most 2 decimals.');
    }
    if (toMinorUnits(amount) > toMinorUnits(invoice.balance)) {
      return setError(
        `The credit cannot exceed the remaining balance of ${formatMoney(invoice.balance)}.`,
      );
    }
    if (!validReason(reason)) return setError(REASON_HINT);
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Credits are stored as negative amounts.
      await financeApi.adjustInvoice(invoice.id, `-${amount.trim()}`, reason.trim());
      onDone(`Credit of ${formatMoney(amount.trim())} applied.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply the credit.');
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fin-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <form
        className="fin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fin-credit-title"
        onSubmit={submit}
        noValidate
      >
        <h2 id="fin-credit-title">Credit invoice</h2>
        <p className="fin-note">
          {invoice.number} · {invoice.residentName} · Remaining balance{' '}
          <strong>{formatMoney(invoice.balance)}</strong>
        </p>
        <p className="fin-note">
          The issued amount is never changed. The credit is recorded separately and lowers the
          balance.
        </p>
        <label className="fin-field">
          <span>Credit amount (₹)</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="fin-field">
          <span>Reason</span>
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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
            {submitting ? 'Applying…' : 'Apply credit'}
          </button>
        </div>
      </form>
    </div>
  );
}
