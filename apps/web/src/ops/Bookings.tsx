import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, LoadingState, Pager, useAsync } from '../finance/shared';
import { Field, FormError, PageHead, Tag, useGuardedAction } from './ui';
import { opsApi, type Bed, type Resident } from './opsApi';
import { opsLinks } from './opsRoute';
import { bedLabel, dateOnly, isMoney, label, personName, todayDate } from './opsFormat';

export function BookingList() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(
    () => opsApi.bookings.list({ status, page, limit: 20 }),
    [status, page],
  );
  const cancel = useGuardedAction();
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section aria-labelledby="bk-title">
      <PageHead
        title="Bookings"
        action={
          <a className="primary-button" href={opsLinks.bookingNew}>
            New booking
          </a>
        }
      />
      <div className="fin-toolbar">
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All statuses</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </Field>
      </div>
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      <FormError message={cancel.error} />
      {loading && !data ? <LoadingState label="Loading bookings…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState title="No bookings" hint="Create a booking to reserve a bed for a resident." />
      ) : null}
      {data && data.items.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Resident</th>
                <th>Bed</th>
                <th>From</th>
                <th>To</th>
                <th className="num">Monthly rent</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.resident ? (
                      <a href={opsLinks.resident(b.residentId)}>{personName(b.resident)}</a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{bedLabel(b.bed)}</td>
                  <td>{dateOnly(b.startDate)}</td>
                  <td>{dateOnly(b.endDate)}</td>
                  <td className="num">
                    ₹{Number(b.monthlyPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    <Tag>{label(b.status)}</Tag>
                  </td>
                  <td>
                    {b.status === 'CONFIRMED' ? (
                      <button
                        type="button"
                        className="fin-link-button"
                        disabled={cancel.busy}
                        onClick={() => {
                          if (window.confirm('Cancel this booking?'))
                            void cancel.run(async () => {
                              await opsApi.bookings.cancel(b.id);
                              setNotice('Booking cancelled.');
                              reload();
                            });
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data ? <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} /> : null}
    </section>
  );
}

export function BookingNew() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Resident[] | null>(null);
  const [resident, setResident] = useState<Resident | null>(null);
  const [start, setStart] = useState(todayDate());
  const [end, setEnd] = useState('');
  const [beds, setBeds] = useState<Bed[] | null>(null);
  const [bedId, setBedId] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const search = useGuardedAction();
  const find = useGuardedAction();
  const save = useGuardedAction();
  async function searchResidents() {
    if (query.trim().length < 2) return search.setError('Type at least 2 letters of the name.');
    await search.run(async () =>
      setMatches(
        (await opsApi.residents.list({ search: query.trim(), status: 'ACTIVE', limit: 8 })).items,
      ),
    );
  }
  async function findBeds() {
    const found: Record<string, string> = {};
    if (!start) found.start = 'Choose the start date.';
    if (!end) found.end = 'Choose the end date.';
    else if (end <= start) found.end = 'The end date must be after the start date.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBedId('');
    await find.run(async () =>
      setBeds(await opsApi.bookings.availableBeds({ startDate: start, endDate: end })),
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!resident) found.resident = 'Choose the resident.';
    if (!beds) found.beds = 'Find the available beds for these dates first.';
    else if (!bedId) found.beds = 'Choose a bed.';
    if (!isMoney(price) || Number(price) <= 0)
      found.price = 'Enter the monthly rent, for example 7500 or 7500.50.';
    setErrors((cur) => ({ ...cur, ...found, start: cur.start ?? '', end: cur.end ?? '' }));
    if (Object.keys(found).length) return;
    await save.run(async () => {
      await opsApi.bookings.create({
        residentId: resident!.id,
        bedId,
        startDate: start,
        endDate: end,
        monthlyPrice: price.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      window.location.hash = opsLinks.bookings;
    });
  }
  return (
    <section aria-labelledby="bk-new">
      <p>
        <a href={opsLinks.bookings}>← All bookings</a>
      </p>
      <PageHead title="New booking" />
      <form className="ops-form" onSubmit={submit} noValidate>
        <h3>1. Resident</h3>
        {resident ? (
          <p>
            {personName(resident)}{' '}
            <button
              type="button"
              className="fin-link-button"
              onClick={() => {
                setResident(null);
                setMatches(null);
              }}
            >
              Change
            </button>
          </p>
        ) : (
          <>
            <div className="ops-inline-form">
              <Field label="Search residents" error={errors.resident}>
                <input
                  value={query}
                  placeholder="Name"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void searchResidents();
                    }
                  }}
                />
              </Field>
              <button
                type="button"
                className="outline-button"
                onClick={() => void searchResidents()}
                disabled={search.busy}
              >
                Search
              </button>
            </div>
            <FormError message={search.error} />
            {matches && matches.length === 0 ? (
              <p className="fin-note">
                No active resident matches.{' '}
                <a href={opsLinks.residentNew}>Register a new resident</a> first.
              </p>
            ) : null}
            {matches && matches.length > 0 ? (
              <ul className="ops-list-plain">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="fin-link-button"
                      onClick={() => setResident(m)}
                    >
                      {personName(m)}
                      {m.phone ? ` · ${m.phone}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <h3>2. Dates and bed</h3>
        <div className="ops-grid">
          <Field label="Start date" error={errors.start || undefined}>
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setBeds(null);
              }}
            />
          </Field>
          <Field label="End date" error={errors.end || undefined}>
            <input
              type="date"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setBeds(null);
              }}
            />
          </Field>
        </div>
        <div className="ops-actions">
          <button
            type="button"
            className="outline-button"
            onClick={() => void findBeds()}
            disabled={find.busy}
          >
            {find.busy ? 'Searching…' : 'Find available beds'}
          </button>
        </div>
        <FormError message={find.error} />
        {beds && beds.length === 0 ? (
          <p className="fin-note">No bed is free for these dates. Try different dates.</p>
        ) : null}
        {beds && beds.length > 0 ? (
          <fieldset className="ops-list-plain" style={{ border: 0, padding: 0 }}>
            <legend>Available beds ({beds.length})</legend>
            {beds.map((b) => (
              <label key={b.id} className="ops-bed-option">
                <input
                  type="radio"
                  name="bed"
                  value={b.id}
                  checked={bedId === b.id}
                  onChange={() => setBedId(b.id)}
                />
                {bedLabel(b)}
              </label>
            ))}
          </fieldset>
        ) : null}
        {errors.beds ? (
          <small className="fin-form-error" role="alert">
            {errors.beds}
          </small>
        ) : null}
        <h3>3. Rent</h3>
        <div className="ops-grid">
          <Field label="Monthly rent (₹)" error={errors.price}>
            <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes (optional)">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="fin-note">
          The full monthly rent is charged for the first and the final month, whatever the move-in
          or check-out date.
        </p>
        <FormError message={save.error} />
        <div className="ops-actions">
          <button type="submit" className="primary-button" disabled={save.busy}>
            {save.busy ? 'Saving…' : 'Create booking'}
          </button>
          <a className="outline-button" href={opsLinks.bookings}>
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
