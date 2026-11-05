import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, LoadingState, Pager, useAsync } from '../finance/shared';
import { Field, FormError, PageHead, Tag, useGuardedAction } from './ui';
import { opsApi, type CheckIn } from './opsApi';
import { opsLinks } from './opsRoute';
import {
  bedLabel,
  dateOnly,
  dateTimeIst,
  isPastBookingEnd,
  label,
  nowIst,
  personName,
} from './opsFormat';

// Check-in / check-out screens. All times are shown in Asia/Kolkata. A time typed into a form is sent
// without a zone and the server reads it as Asia/Kolkata, so the browser's own time zone never matters.

const VIEWS = [
  { value: 'ACTIVE', label: 'Currently checked in' },
  { value: 'CHECKED_OUT', label: 'Check-out history' },
  { value: '', label: 'All stays' },
] as const;

/** Currently checked in (default), check-out history, or every stay. */
export function CheckInList() {
  const [view, setView] = useState<string>('ACTIVE');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => opsApi.checkIns.list({ status: view, search: applied, page, limit: 20 }),
    [view, applied, page],
  );
  const occupancy = useAsync(() => opsApi.checkIns.occupancy(), [list.data?.total, view]);
  const heading = VIEWS.find((v) => v.value === view)?.label ?? 'Check-ins';
  return (
    <section aria-labelledby="ci-title">
      <PageHead
        title="Check-ins"
        action={
          <a className="primary-button" href={opsLinks.checkInNew}>
            New check-in
          </a>
        }
      />
      {occupancy.data ? (
        <p className="fin-lede" role="status">
          {occupancy.data.occupiedBeds} of {occupancy.data.totalBeds} beds occupied. Occupancy is
          counted from active check-ins.
        </p>
      ) : null}
      {occupancy.data && occupancy.data.overstayCount > 0 ? (
        <div className="fin-warning" role="alert">
          <strong>
            {occupancy.data.overstayCount} resident{occupancy.data.overstayCount === 1 ? '' : 's'}{' '}
            checked in past the booking end date.
          </strong>{' '}
          These days are not billed unless the booking is extended with a reason.
          <ul>
            {occupancy.data.overstays.map((o) => (
              <li key={o.checkInId}>
                <a href={opsLinks.checkIn(o.checkInId)}>{o.residentName}</a> · booking ended{' '}
                {dateOnly(o.bookingEndDate)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form
        className="fin-toolbar"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setPage(1);
          setApplied(search.trim());
        }}
      >
        <Field label="Show">
          <select
            value={view}
            onChange={(e) => {
              setPage(1);
              setView(e.target.value);
            }}
          >
            {VIEWS.map((v) => (
              <option key={v.label} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Resident">
          <input
            value={search}
            placeholder="Name or phone"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <button type="submit" className="outline-button">
          Search
        </button>
      </form>
      {list.loading && !list.data ? <LoadingState label="Loading check-ins…" /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          title={applied ? 'No matching stays' : `No stays under “${heading}”`}
          hint={
            applied
              ? 'Try a different name or phone number.'
              : view === 'CHECKED_OUT'
                ? 'Completed stays will appear here after a resident checks out.'
                : 'Check a resident in from an admitted admission to get started.'
          }
        />
      ) : null}
      {list.data && list.data.items.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Resident</th>
                <th>Bed</th>
                <th>Checked in</th>
                <th>Checked out</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={opsLinks.checkIn(c.id)}>{personName(c.resident)}</a>
                  </td>
                  <td>{bedLabel(c.bed)}</td>
                  <td>{dateTimeIst(c.checkInAt)}</td>
                  <td>{c.checkOut ? dateTimeIst(c.checkOut.checkOutAt) : '—'}</td>
                  <td>
                    <Tag>{c.status === 'ACTIVE' ? 'Checked in' : 'Checked out'}</Tag>
                    {c.status === 'ACTIVE' && c.booking && isPastBookingEnd(c.booking.endDate) ? (
                      <Tag>Past booking end</Tag>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list.data ? (
        <Pager page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
      ) : null}
    </section>
  );
}

export function CheckInNew() {
  // Admitted admissions that have not been checked in yet (the pilot's volume fits one page of 100).
  const eligible = useAsync(async () => {
    const [admissions, stays] = await Promise.all([
      opsApi.admissions.list({ status: 'ADMITTED', limit: 100 }),
      opsApi.checkIns.list({ limit: 100 }),
    ]);
    const used = new Set(stays.items.map((c) => c.admissionId));
    return admissions.items.filter((a) => !used.has(a.id));
  }, []);
  const [admissionId, setAdmissionId] = useState('');
  const [checkInAt, setCheckInAt] = useState(nowIst);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<{ admissionId?: string; checkInAt?: string }>({});
  const save = useGuardedAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    if (!admissionId) found.admissionId = 'Choose an admitted admission.';
    if (!checkInAt) found.checkInAt = 'Enter the check-in time.';
    setErrors(found);
    if (Object.keys(found).length) return;
    await save.run(async () => {
      const created = await opsApi.checkIns.checkIn({
        admissionId,
        checkInAt,
        notes: notes.trim() || null,
      });
      window.location.hash = opsLinks.checkIn(created.id);
    });
  }

  return (
    <section aria-labelledby="ci-new">
      <p>
        <a href={opsLinks.checkIns}>← All check-ins</a>
      </p>
      <PageHead title="New check-in" />
      {eligible.loading && !eligible.data ? <LoadingState label="Loading admissions…" /> : null}
      {eligible.error ? <ErrorState message={eligible.error} onRetry={eligible.reload} /> : null}
      {eligible.data && eligible.data.length === 0 ? (
        <EmptyState
          title="No admission is waiting for check-in"
          hint="Mark an admission as admitted first. The booking must be confirmed and the bed in service."
        />
      ) : null}
      {eligible.data && eligible.data.length > 0 ? (
        <form className="ops-form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="ops-grid">
            <Field label="Admission" error={errors.admissionId}>
              <select value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}>
                <option value="">Choose an admitted admission</option>
                {eligible.data.map((a) => (
                  <option key={a.id} value={a.id}>
                    {personName(a.resident)} · {bedLabel(a.bed)} · admitted{' '}
                    {dateOnly(a.admissionDate)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Check-in time (India time)" error={errors.checkInAt}>
              <input
                type="datetime-local"
                value={checkInAt}
                onChange={(e) => setCheckInAt(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <FormError message={save.error} />
          <div className="ops-actions">
            <button type="submit" className="primary-button" disabled={save.busy}>
              {save.busy ? 'Checking in…' : 'Check in'}
            </button>
            <a className="outline-button" href={opsLinks.checkIns}>
              Cancel
            </a>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export function CheckInDetail({ id }: { id: string }) {
  const { data, loading, error, reload } = useAsync(() => opsApi.checkIns.get(id), [id]);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkOutAt, setCheckOutAt] = useState(nowIst);
  const [reason, setReason] = useState('');
  const [outNotes, setOutNotes] = useState('');
  const [timeError, setTimeError] = useState<string | undefined>();
  const out = useGuardedAction();

  if (loading && !data) return <LoadingState label="Loading check-in…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const c: CheckIn = data;

  async function submitCheckOut(e: FormEvent) {
    e.preventDefault();
    if (!checkOutAt) {
      setTimeError('Enter the check-out time.');
      return;
    }
    setTimeError(undefined);
    if (!window.confirm(`Check out ${personName(c.resident)}? This cannot be undone.`)) return;
    await out.run(async () => {
      await opsApi.checkIns.checkOut(c.id, {
        checkOutAt,
        reason: reason.trim() || null,
        notes: outNotes.trim() || null,
      });
      setNotice('Resident checked out. The booking and admission were left as they are.');
      reload();
    });
  }

  return (
    <section aria-labelledby="ci-detail">
      <p>
        <a href={opsLinks.checkIns}>← All check-ins</a>
      </p>
      <PageHead
        title={`Stay of ${personName(c.resident)}`}
        action={<Tag>{c.status === 'ACTIVE' ? 'Checked in' : 'Checked out'}</Tag>}
      />
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      <dl className="ops-kv">
        <dt>Resident</dt>
        <dd>{personName(c.resident)}</dd>
        <dt>Bed</dt>
        <dd>{bedLabel(c.bed)}</dd>
        <dt>Admission</dt>
        <dd>
          {c.admission
            ? `${label(c.admission.status)} · admitted ${dateOnly(c.admission.admissionDate)}`
            : '—'}{' '}
          <a href={opsLinks.admissions}>View admissions</a>
        </dd>
        <dt>Booking</dt>
        <dd>
          {c.booking
            ? `${label(c.booking.status)} · ${dateOnly(c.booking.startDate)} to ${dateOnly(c.booking.endDate)}`
            : '—'}
        </dd>
        <dt>Checked in</dt>
        <dd>{dateTimeIst(c.checkInAt)}</dd>
        <dt>Checked out</dt>
        <dd>{c.checkOut ? dateTimeIst(c.checkOut.checkOutAt) : '—'}</dd>
        {c.checkOut ? (
          <>
            <dt>Check-out reason</dt>
            <dd>{c.checkOut.reason ?? 'Not recorded'}</dd>
            <dt>Check-out notes</dt>
            <dd>{c.checkOut.notes ?? '—'}</dd>
          </>
        ) : null}
        <dt>Notes</dt>
        <dd>{c.notes ?? '—'}</dd>
      </dl>

      {c.status === 'ACTIVE' && c.booking && isPastBookingEnd(c.booking.endDate) ? (
        <ExtendBookingForm
          bookingId={c.booking.id}
          currentEnd={c.booking.endDate}
          onDone={() => {
            setNotice('Booking extended. The extension is recorded with your name and the reason.');
            reload();
          }}
        />
      ) : null}

      {c.status === 'ACTIVE' ? (
        <form className="ops-form ops-section" onSubmit={(e) => void submitCheckOut(e)} noValidate>
          <h3>Check out</h3>
          <p className="fin-lede">
            Billing is not changed by checking out early: the full month stays billed and no refund
            or invoice adjustment is created automatically.
          </p>
          <div className="ops-grid">
            <Field label="Check-out time (India time)" error={timeError}>
              <input
                type="datetime-local"
                value={checkOutAt}
                onChange={(e) => setCheckOutAt(e.target.value)}
              />
            </Field>
            <Field label="Reason (optional)">
              <input
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For example: moved out, relocated"
              />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea
              rows={2}
              maxLength={2000}
              value={outNotes}
              onChange={(e) => setOutNotes(e.target.value)}
            />
          </Field>
          <FormError message={out.error} />
          <div className="ops-actions">
            <button type="submit" className="primary-button" disabled={out.busy}>
              {out.busy ? 'Checking out…' : 'Check out resident'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** Approves an extension of the booking behind an overstay. Without it, days past the end are not billed. */
function ExtendBookingForm({
  bookingId,
  currentEnd,
  onDone,
}: {
  bookingId: string;
  currentEnd: string;
  onDone: () => void;
}) {
  const [newEndDate, setNewEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ newEndDate?: string; reason?: string }>({});
  const action = useGuardedAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: { newEndDate?: string; reason?: string } = {};
    if (!newEndDate) next.newEndDate = 'Choose the new end date.';
    else if (newEndDate <= currentEnd.slice(0, 10)) {
      next.newEndDate = 'The new end date must be later than the current end date.';
    }
    if (reason.trim().length < 3) next.reason = 'Enter a reason (at least 3 characters).';
    setErrors(next);
    if (next.newEndDate || next.reason) return;
    await action.run(async () => {
      await opsApi.bookings.extend(bookingId, { newEndDate, reason: reason.trim() });
      onDone();
    });
  }

  return (
    <form className="ops-form ops-section" onSubmit={(e) => void submit(e)} noValidate>
      <h3>Past the booking end date</h3>
      <p className="fin-lede" role="status">
        This booking ended on {dateOnly(currentEnd)}. The resident is still checked in, but days
        after the booking end are not billed unless you extend the booking. An extension needs a
        reason and is recorded with your name.
      </p>
      <div className="ops-grid">
        <Field label="New end date (the first day not booked)" error={errors.newEndDate}>
          <input
            type="date"
            value={newEndDate}
            min={currentEnd.slice(0, 10)}
            onChange={(e) => setNewEndDate(e.target.value)}
          />
        </Field>
        <Field label="Reason" error={errors.reason}>
          <input
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="For example: stayed on for exams"
          />
        </Field>
      </div>
      <FormError message={action.error} />
      <button type="submit" className="primary-button" disabled={action.busy}>
        {action.busy ? 'Extending…' : 'Extend booking'}
      </button>
    </form>
  );
}
