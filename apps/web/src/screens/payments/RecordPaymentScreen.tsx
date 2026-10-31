import { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../auth/permissions';
import { ErrorState } from '../../components/ErrorState';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import {
  mockDataService,
  type ResidentListItem,
  type SettlableCharge,
  type PaymentReceipt,
} from '../../api/mockAdapter';
import { parseRupeesToPaise } from '../../utils/money';
import { ConflictError } from '../../api/errors';

export function RecordPaymentScreen() {
  const { can } = useAuth();
  const [residents, setResidents] = useState<ResidentListItem[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string>('res_demo_01');
  const [settlableCharges, setSettlableCharges] = useState<SettlableCharge[]>([]);
  const [selectedChargeId, setSelectedChargeId] = useState<string>('');

  const [amountStr, setAmountStr] = useState('1000');
  const [paymentDate, setPaymentDate] = useState('2026-10-31');
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'bank_transfer' | 'cash' | 'cheque'>('upi');
  const [referenceNumber, setReferenceNumber] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    mockDataService.getResidents().then((data) => {
      setResidents(data);
      if (data[0]) setSelectedResidentId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedResidentId) return;
    mockDataService.getSettlableCharges(selectedResidentId).then((charges) => {
      setSettlableCharges(charges);
      // Non-negotiable rule 5: NO preselection of charge; user must explicitly choose!
      setSelectedChargeId('');
    });
  }, [selectedResidentId]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selectedChargeId) {
      setErrorMsg('Please explicitly select which charge this payment settles. Automated preselection is forbidden.');
      return;
    }

    let paise: bigint;
    try {
      paise = parseRupeesToPaise(amountStr);
      if (paise <= 0n) {
        setErrorMsg('Payment amount must be greater than zero.');
        return;
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid amount.');
      return;
    }

    setSubmitting(true);
    const idempotencyKey = `pay_idem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      const generatedReceipt = await mockDataService.recordPayment(
        {
          residentId: selectedResidentId,
          amountPaise: paise,
          date: paymentDate,
          method: paymentMethod,
          reference: referenceNumber.trim(),
          settledChargeId: selectedChargeId,
        },
        idempotencyKey
      );

      setReceipt(generatedReceipt);
    } catch (err: unknown) {
      if (err instanceof ConflictError) {
        setErrorMsg(err.message);
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!can(PERMISSIONS.PAYMENT_RECORD)) {
    return (
      <ErrorState
        type="forbidden"
        message="Your active role lacks the payment.record permission required to record payments."
      />
    );
  }

  return (
    <section className="record-payment-screen" aria-labelledby="record-payment-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow violet">CASHIER DESK</p>
          <h1 id="record-payment-heading">Record a Payment</h1>
          <p className="page-description">
            Rule 3 & 5 compliance: No preselected charges, exact integer paise, duplicate reference protection, and numbered receipts.
          </p>
        </div>
      </div>

      {receipt ? (
        <div className="receipt-modal-view" style={{ maxWidth: '640px', margin: '0 auto', background: 'var(--color-surface)', border: '2px solid var(--color-brand-accent)', borderRadius: '12px', padding: '32px' }}>
          <div style={{ textAlign: 'center', borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: '16px', marginBottom: '20px' }}>
            <span className="environment-badge">OFFICIAL RECEIPT</span>
            <h2 style={{ fontSize: '24px', margin: '12px 0 4px' }}>{receipt.receiptNumber}</h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
              Issued on <DateText value={receipt.timestamp} showTime />
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '14px', marginBottom: '24px' }}>
            <div>
              <span className="card-label">Received From</span>
              <strong>{receipt.residentName}</strong>
            </div>
            <div>
              <span className="card-label">Amount Paid</span>
              <strong style={{ fontSize: '18px', color: 'var(--color-success-text)' }}>
                <Money paise={receipt.amountPaise} />
              </strong>
            </div>
            <div>
              <span className="card-label">Payment Method</span>
              <span style={{ textTransform: 'uppercase' }}>{receipt.method.replace('_', ' ')}</span>
            </div>
            <div>
              <span className="card-label">Reference Number</span>
              <code>{receipt.reference}</code>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <span className="card-label">Settled Charge</span>
              <div>{receipt.settledChargeDescription}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setReceipt(null);
                setReferenceNumber('');
                setSelectedChargeId('');
              }}
            >
              Record Another Payment
            </button>
            <button
              type="button"
              className="outline-button"
              onClick={() => window.print()}
            >
              Print Receipt
            </button>
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: '600px', background: 'var(--color-surface)', padding: '32px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
          {errorMsg && (
            <div style={{ padding: '14px', background: 'var(--color-danger-tint)', border: '1px solid var(--color-danger-solid)', borderRadius: '6px', color: 'var(--color-danger-text)', marginBottom: '20px', fontSize: '14px' }}>
              <strong>Notice:</strong> {errorMsg}
            </div>
          )}

          <form onSubmit={handleRecordPayment} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Resident
              </label>
              <select
                value={selectedResidentId}
                onChange={(e) => setSelectedResidentId(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
              >
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (Room {r.roomNumber}-{r.bedLetter})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Target Charge (Rule 5: Explicit choice required)
              </label>
              <select
                value={selectedChargeId}
                onChange={(e) => setSelectedChargeId(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                required
              >
                <option value="">-- Choose specific charge to settle --</option>
                {settlableCharges.map((chg) => (
                  <option key={chg.id} value={chg.id}>
                    {chg.description} — Outstanding: ₹{(Number(chg.outstandingPaise) / 100).toLocaleString('en-IN')}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Amount (INR ₹)
                </label>
                <input
                  type="text"
                  required
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="e.g. 1,000 or 1000.50"
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Payment Date
                </label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(
                      e.target.value as 'upi' | 'bank_transfer' | 'cash' | 'cheque'
                    )
                  }
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                >
                  <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                  <option value="bank_transfer">Bank Transfer (IMPS / NEFT)</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Bank Reference Number
                </label>
                <input
                  type="text"
                  required
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="e.g. UPI/261031/99812"
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                />
              </div>
            </div>

            <div className="local-selection-note">
              <strong>Duplicate Ref Safeguard:</strong> Re-entering an existing bank reference (e.g. <code>UPI/261001/98124</code>) is refused by the server with a link to the original receipt.
            </div>

            <button
              type="submit"
              className="primary-button"
              disabled={submitting}
              style={{ marginTop: '8px' }}
            >
              {submitting ? 'Verifying & issuing receipt...' : 'Confirm Payment & Issue Numbered Receipt'}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
