import { useEffect, useState, type FormEvent } from 'react';
import { financeApi, type Invoice } from './financeApi';
import { currentMonth, formatMoney, isValidAmountInput, monthLabel } from './financeFormat';
import { financeLinks } from './financeRoute';
import { ErrorState } from './shared';

type ResidentOption = { id: string; firstName: string; lastName: string };
type BookingOption = {
  id: string;
  monthlyPrice: string | number;
  startDate: string;
  endDate: string;
  status: string;
};

export function CreateInvoice() {
  return (
    <section aria-labelledby="fin-new-title">
      <p>
        <a href={financeLinks.invoices}>← All invoices</a>
      </p>
      <h2 id="fin-new-title">Create and issue invoices</h2>
      <div className="fin-grid-2">
        <GenerateMonthly />
        <SingleInvoice />
      </div>
    </section>
  );
}

function GenerateMonthly() {
  const [month, setMonth] = useState(currentMonth());
  const [dueDate, setDueDate] = useState('');
  const [issue, setIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof financeApi.generateMonthly>
  > | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await financeApi.generateMonthly({ month, ...(dueDate ? { dueDate } : {}), issue }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate invoices.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fin-card" onSubmit={submit}>
      <h3>Generate monthly invoices</h3>
      <p className="fin-note">
        Bills every resident who is admitted and checked in with a confirmed booking, at the
        booking’s full monthly price. A late move-in pays the full month. Running it again never
        creates duplicates.
      </p>
      <label className="fin-field">
        <span>Billing month</span>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          required
        />
      </label>
      <label className="fin-field">
        <span>Due date (optional — defaults to the 5th)</span>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </label>
      <label className="fin-check">
        <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} />
        Issue invoices immediately
      </label>
      {error ? <ErrorState message={error} /> : null}
      {result ? (
        <p className="fin-success" role="status">
          {result.created > 0
            ? `Created ${result.created} invoice${result.created === 1 ? '' : 's'} for ${monthLabel(result.month)}.`
            : `No new invoices for ${monthLabel(result.month)}.`}{' '}
          {result.skippedExisting > 0 ? `${result.skippedExisting} already existed. ` : ''}
          {result.eligibleResidents === 0 ? 'No eligible residents were found.' : ''}
          {result.skippedZeroPrice > 0
            ? `${result.skippedZeroPrice} skipped (booking price is zero).`
            : ''}{' '}
          {result.created > 0 ? <a href={financeLinks.invoices}>View invoices</a> : null}
        </p>
      ) : null}
      <button type="submit" className="primary-button" disabled={busy}>
        {busy ? 'Generating…' : 'Generate invoices'}
      </button>
    </form>
  );
}

function SingleInvoice() {
  const [query, setQuery] = useState('');
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [resident, setResident] = useState<ResidentOption | null>(null);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [bookingId, setBookingId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Invoice | null>(null);

  useEffect(() => {
    if (query.trim().length < 2 || resident) return setResidents([]);
    const handle = setTimeout(() => {
      financeApi
        .searchResidents(query.trim())
        .then((r) => setResidents(r.items))
        .catch(() => setResidents([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, resident]);

  useEffect(() => {
    setBookings([]);
    setBookingId('');
    if (!resident) return;
    financeApi
      .residentBookings(resident.id)
      .then((r) => setBookings(r.items))
      .catch(() => setBookings([]));
  }, [resident]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!resident) return setError('Choose a resident.');
    if (amount && !isValidAmountInput(amount))
      return setError('Amount must be greater than zero with at most 2 decimals.');
    if (!amount && !bookingId)
      return setError('Choose a booking to use its monthly price, or enter an amount.');
    setBusy(true);
    try {
      setCreated(
        await financeApi.createDraft({
          residentId: resident.id,
          month,
          ...(bookingId ? { bookingId } : {}),
          ...(amount ? { amount: amount.trim() } : {}),
          ...(dueDate ? { dueDate } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invoice.');
    } finally {
      setBusy(false);
    }
  }

  async function issueNow() {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      setCreated(await financeApi.issue(created.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue the invoice.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="fin-card">
        <h3>Invoice {created.number}</h3>
        <p className="fin-success" role="status">
          {created.storedStatus === 'DRAFT' ? 'Draft created.' : 'Invoice issued.'}{' '}
          {formatMoney(created.amount)} for {created.residentName}.
        </p>
        {error ? <ErrorState message={error} /> : null}
        <div className="fin-actions">
          {created.storedStatus === 'DRAFT' ? (
            <button type="button" className="primary-button" onClick={issueNow} disabled={busy}>
              {busy ? 'Issuing…' : 'Issue invoice'}
            </button>
          ) : null}
          <a className="outline-button" href={financeLinks.invoice(created.id)}>
            Open invoice
          </a>
          <button
            type="button"
            className="outline-button"
            onClick={() => {
              setCreated(null);
              setAmount('');
              setNotes('');
            }}
          >
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="fin-card" onSubmit={submit} noValidate>
      <h3>Create a single invoice</h3>
      <label className="fin-field">
        <span>Resident</span>
        {resident ? (
          <span className="fin-chosen">
            {resident.firstName} {resident.lastName}{' '}
            <button
              type="button"
              className="fin-link-button"
              onClick={() => {
                setResident(null);
                setQuery('');
              }}
            >
              Change
            </button>
          </span>
        ) : (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name (2+ letters)"
            autoComplete="off"
          />
        )}
      </label>
      {!resident && residents.length > 0 ? (
        <ul className="fin-suggest" role="listbox" aria-label="Matching residents">
          {residents.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => setResident(r)}
              >
                {r.firstName} {r.lastName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {resident ? (
        <label className="fin-field">
          <span>Booking (uses its monthly price)</span>
          <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
            <option value="">
              {bookings.length ? 'No booking — enter an amount' : 'No confirmed bookings found'}
            </option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                {formatMoney(String(b.monthlyPrice))} / month · from {b.startDate.slice(0, 10)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="fin-field">
        <span>Billing month</span>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          required
        />
      </label>
      <label className="fin-field">
        <span>Amount override (₹, optional with a booking)</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Booking price is used if blank"
        />
      </label>
      <label className="fin-field">
        <span>Due date (optional)</span>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
      {error ? <ErrorState message={error} /> : null}
      <button type="submit" className="primary-button" disabled={busy}>
        {busy ? 'Creating…' : 'Create draft'}
      </button>
    </form>
  );
}
