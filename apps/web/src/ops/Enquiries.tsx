import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, LoadingState, Pager, useAsync } from '../finance/shared';
import { Field, FormError, PageHead, Tag, useGuardedAction } from './ui';
import { opsApi, type EnquirySource, type EnquiryStatus } from './opsApi';
import { opsLinks } from './opsRoute';
import { dateOnly, dateTime, label, localToIso, nowLocal } from './opsFormat';

const STATUSES = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'LOST', 'ARCHIVED'] as const;
const SOURCES = ['WALK_IN', 'PHONE_CALL', 'WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'OTHER'] as const;

export function EnquiryList() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(
    () => opsApi.enquiries.list({ status, page, limit: 20 }),
    [status, page],
  );
  return (
    <section aria-labelledby="enq-title">
      <PageHead
        title="Enquiries"
        action={
          <a className="primary-button" href={opsLinks.enquiryNew}>
            New enquiry
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
            {[...STATUSES, 'CONVERTED'].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {loading && !data ? <LoadingState label="Loading enquiries…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title="No enquiries"
          hint="Record the first enquiry when someone asks about a bed."
        />
      ) : null}
      {data && data.items.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Expected move-in</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <a href={opsLinks.enquiry(e.id)}>
                      {e.firstName} {e.lastName}
                    </a>
                  </td>
                  <td>{e.phone}</td>
                  <td>{label(e.source)}</td>
                  <td>{dateOnly(e.expectedMoveInDate)}</td>
                  <td>
                    <Tag>{label(e.status)}</Tag>
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

export function EnquiryNew() {
  const [v, setV] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    source: 'WALK_IN',
    expectedMoveInDate: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, error, run } = useGuardedAction();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!v.firstName.trim()) found.firstName = 'Enter the first name.';
    if (!v.lastName.trim()) found.lastName = 'Enter the last name.';
    if (!/^[0-9+()\-\s]{6,20}$/.test(v.phone.trim())) found.phone = 'Enter a valid phone number.';
    if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()))
      found.email = 'Enter a valid e-mail address.';
    setErrors(found);
    if (Object.keys(found).length) return;
    await run(async () => {
      const created = await opsApi.enquiries.create({
        firstName: v.firstName.trim(),
        lastName: v.lastName.trim(),
        phone: v.phone.trim(),
        source: v.source as EnquirySource,
        ...(v.email.trim() ? { email: v.email.trim() } : {}),
        ...(v.expectedMoveInDate ? { expectedMoveInDate: v.expectedMoveInDate } : {}),
        ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
      });
      window.location.hash = opsLinks.enquiry(created.id);
    });
  }
  return (
    <section aria-labelledby="enq-new">
      <p>
        <a href={opsLinks.enquiries}>← All enquiries</a>
      </p>
      <PageHead title="New enquiry" />
      <form className="ops-form" onSubmit={submit} noValidate>
        <div className="ops-grid">
          <Field label="First name" error={errors.firstName}>
            <input value={v.firstName} onChange={set('firstName')} />
          </Field>
          <Field label="Last name" error={errors.lastName}>
            <input value={v.lastName} onChange={set('lastName')} />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input value={v.phone} inputMode="tel" onChange={set('phone')} />
          </Field>
          <Field label="E-mail (optional)" error={errors.email}>
            <input value={v.email} inputMode="email" onChange={set('email')} />
          </Field>
          <Field label="Source">
            <select value={v.source} onChange={set('source')}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expected move-in">
            <input type="date" value={v.expectedMoveInDate} onChange={set('expectedMoveInDate')} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} value={v.notes} onChange={set('notes')} />
        </Field>
        <FormError message={error} />
        <div className="ops-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save enquiry'}
          </button>
          <a className="outline-button" href={opsLinks.enquiries}>
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}

export function EnquiryDetail({ id }: { id: string }) {
  const enquiry = useAsync(() => opsApi.enquiries.get(id), [id]);
  const followUps = useAsync(() => opsApi.enquiries.followUps(id), [id]);
  const [notice, setNotice] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [when, setWhen] = useState(nowLocal());
  const [outcome, setOutcome] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const action = useGuardedAction();
  const fu = useGuardedAction();
  if (enquiry.loading && !enquiry.data) return <LoadingState label="Loading enquiry…" />;
  if (enquiry.error) return <ErrorState message={enquiry.error} onRetry={enquiry.reload} />;
  const e = enquiry.data;
  if (!e) return null;
  const converted = Boolean(e.residentId) || e.status === 'CONVERTED';
  const setStatus = (status: EnquiryStatus) =>
    action.run(async () => {
      await opsApi.enquiries.update(id, { status });
      setNotice(`Status set to ${label(status)}.`);
      enquiry.reload();
    });
  const convert = () =>
    action.run(async () => {
      const r = await opsApi.enquiries.convert(id);
      window.location.hash = opsLinks.resident(r.resident.id);
    });
  async function addFollowUp(ev: FormEvent) {
    ev.preventDefault();
    if (notes.trim().length < 2) return setNoteError('Write what was discussed.');
    setNoteError(null);
    const ok = await fu.run(async () => {
      await opsApi.enquiries.addFollowUp(id, {
        notes: notes.trim(),
        followUpAt: localToIso(when),
        ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
      });
    });
    if (ok) {
      setNotes('');
      setOutcome('');
      setNotice('Follow-up recorded.');
      followUps.reload();
    }
  }
  return (
    <section aria-labelledby="enq-detail">
      <p>
        <a href={opsLinks.enquiries}>← All enquiries</a>
      </p>
      <PageHead title={`${e.firstName} ${e.lastName}`} action={<Tag>{label(e.status)}</Tag>} />
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      <dl className="ops-kv">
        <dt>Phone</dt>
        <dd>{e.phone}</dd>
        <dt>E-mail</dt>
        <dd>{e.email ?? '—'}</dd>
        <dt>Source</dt>
        <dd>{label(e.source)}</dd>
        <dt>Expected move-in</dt>
        <dd>{dateOnly(e.expectedMoveInDate)}</dd>
        <dt>Notes</dt>
        <dd>{e.notes ?? '—'}</dd>
        <dt>Recorded</dt>
        <dd>{dateTime(e.createdAt)}</dd>
      </dl>
      {converted ? (
        <p>
          {e.residentId ? (
            <a className="primary-button" href={opsLinks.resident(e.residentId)}>
              Open resident
            </a>
          ) : (
            'Converted to a resident.'
          )}
        </p>
      ) : (
        <div className="ops-actions">
          {STATUSES.filter((s) => s !== e.status).map((s) => (
            <button
              key={s}
              type="button"
              className="outline-button"
              disabled={action.busy}
              onClick={() => void setStatus(s)}
            >
              Mark {label(s).toLowerCase()}
            </button>
          ))}
          <button
            type="button"
            className="primary-button"
            disabled={action.busy}
            onClick={() => void convert()}
          >
            Convert to resident
          </button>
        </div>
      )}
      <FormError message={action.error} />
      <div className="ops-section">
        <h3>Follow-ups</h3>
        {followUps.loading && !followUps.data ? <LoadingState label="Loading follow-ups…" /> : null}
        {followUps.error ? (
          <ErrorState message={followUps.error} onRetry={followUps.reload} />
        ) : null}
        {followUps.data && followUps.data.length === 0 ? (
          <p className="fin-note">No follow-ups yet.</p>
        ) : null}
        {followUps.data && followUps.data.length > 0 ? (
          <ul className="ops-list-plain">
            {followUps.data.map((f) => (
              <li key={f.id}>
                <strong>{dateTime(f.followUpAt)}</strong> · {f.user?.displayName ?? '—'}
                <br />
                {f.notes}
                {f.outcome ? (
                  <>
                    <br />
                    <em>Outcome: {f.outcome}</em>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!converted ? (
          <form className="ops-inline-form" onSubmit={addFollowUp} noValidate>
            <Field label="What was discussed" error={noteError ?? undefined}>
              <input value={notes} onChange={(ev) => setNotes(ev.target.value)} />
            </Field>
            <Field label="When">
              <input
                type="datetime-local"
                value={when}
                onChange={(ev) => setWhen(ev.target.value)}
              />
            </Field>
            <Field label="Outcome (optional)">
              <input value={outcome} onChange={(ev) => setOutcome(ev.target.value)} />
            </Field>
            <button type="submit" className="primary-button" disabled={fu.busy}>
              {fu.busy ? 'Saving…' : 'Add follow-up'}
            </button>
          </form>
        ) : null}
        <FormError message={fu.error} />
      </div>
    </section>
  );
}
