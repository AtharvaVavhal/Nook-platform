import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, LoadingState, Pager, useAsync } from '../finance/shared';
import { Field, FormError, PageHead, Tag, useGuardedAction } from './ui';
import { opsApi, type Resident, type ResidentInput } from './opsApi';
import { correctionsLinks, opsLinks } from './opsRoute';
import { dateOnly, label, todayDate } from './opsFormat';

const STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

export function ResidentList() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(
    () => opsApi.residents.list({ search: applied, status, page, limit: 20 }),
    [applied, status, page],
  );
  return (
    <section aria-labelledby="res-title">
      <PageHead
        id="res-title"
        title="Residents"
        action={
          <a className="primary-button" href={opsLinks.residentNew}>
            Register resident
          </a>
        }
      />
      <form
        className="fin-toolbar"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setPage(1);
          setApplied(search.trim());
        }}
      >
        <Field label="Search">
          <input
            value={search}
            placeholder="Name, phone or e-mail"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="outline-button">
          Search
        </button>
      </form>
      {loading && !data ? <LoadingState label="Loading residents…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title="No residents found"
          hint={
            applied || status
              ? 'Try a different search or filter.'
              : 'Register the first resident to get started.'
          }
        />
      ) : null}
      {data && data.items.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>E-mail</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={opsLinks.resident(r.id)}>
                      {r.firstName} {r.lastName}
                    </a>
                  </td>
                  <td>{r.phone ?? '—'}</td>
                  <td>{r.email ?? '—'}</td>
                  <td>
                    <Tag>{label(r.status)}</Tag>
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

const EMPTY = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  dateOfBirth: '',
  gender: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelation: '',
};
type Values = typeof EMPTY;

function toValues(r?: Resident): Values {
  if (!r) return EMPTY;
  return {
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone ?? '',
    email: r.email ?? '',
    dateOfBirth: r.dateOfBirth ? r.dateOfBirth.slice(0, 10) : '',
    gender: r.gender ?? '',
    address: r.address ?? '',
    emergencyContactName: r.emergencyContactName ?? '',
    emergencyContactPhone: r.emergencyContactPhone ?? '',
    emergencyContactRelation: r.emergencyContactRelation ?? '',
  };
}

export function validateResident(v: Values): Partial<Record<keyof Values, string>> {
  const e: Partial<Record<keyof Values, string>> = {};
  if (!v.firstName.trim()) e.firstName = 'Enter the first name.';
  if (!v.lastName.trim()) e.lastName = 'Enter the last name.';
  if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()))
    e.email = 'Enter a valid e-mail address.';
  if (v.phone.trim() && !/^[0-9+()\-\s]{6,20}$/.test(v.phone.trim()))
    e.phone = 'Enter a valid phone number.';
  if (v.dateOfBirth && v.dateOfBirth > todayDate())
    e.dateOfBirth = 'The date of birth cannot be in the future.';
  return e;
}

export function ResidentForm({
  resident,
  onSaved,
  onCancel,
}: {
  resident?: Resident;
  onSaved: (r: Resident) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<Values>(toValues(resident));
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const { busy, error, run } = useGuardedAction();
  const set = (k: keyof Values) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateResident(v);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: ResidentInput = {
      // A resident's name changes only through an approved correction, so an edit never sends it.
      ...(resident ? {} : { firstName: v.firstName.trim(), lastName: v.lastName.trim() }),
      phone: v.phone.trim() || null,
      email: v.email.trim() || null,
      gender: v.gender.trim() || null,
      address: v.address.trim() || null,
      dateOfBirth: v.dateOfBirth || null,
      emergencyContactName: v.emergencyContactName.trim() || null,
      emergencyContactPhone: v.emergencyContactPhone.trim() || null,
      emergencyContactRelation: v.emergencyContactRelation.trim() || null,
    };
    await run(async () =>
      onSaved(
        resident
          ? await opsApi.residents.update(resident.id, body)
          : await opsApi.residents.create(body),
      ),
    );
  }
  return (
    <form className="ops-form" onSubmit={submit} noValidate>
      {resident ? (
        <p className="fin-hint" role="note">
          A name changes only through an approved correction.{' '}
          <a
            href={correctionsLinks.new({
              targetType: 'RESIDENT',
              targetId: resident.id,
              field: 'firstName',
            })}
          >
            Request a correction
          </a>
        </p>
      ) : null}
      <div className="ops-grid">
        <Field label="First name" error={errors.firstName}>
          <input value={v.firstName} onChange={set('firstName')} readOnly={Boolean(resident)} />
        </Field>
        <Field label="Last name" error={errors.lastName}>
          <input value={v.lastName} onChange={set('lastName')} readOnly={Boolean(resident)} />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <input value={v.phone} inputMode="tel" onChange={set('phone')} />
        </Field>
        <Field label="E-mail" error={errors.email}>
          <input value={v.email} inputMode="email" onChange={set('email')} />
        </Field>
        <Field label="Date of birth" error={errors.dateOfBirth}>
          <input type="date" value={v.dateOfBirth} onChange={set('dateOfBirth')} />
        </Field>
        <Field label="Gender">
          <input value={v.gender} onChange={set('gender')} />
        </Field>
      </div>
      <Field label="Address">
        <textarea rows={2} value={v.address} onChange={set('address')} />
      </Field>
      <div className="ops-grid">
        <Field label="Emergency contact name">
          <input value={v.emergencyContactName} onChange={set('emergencyContactName')} />
        </Field>
        <Field label="Emergency contact phone">
          <input
            value={v.emergencyContactPhone}
            inputMode="tel"
            onChange={set('emergencyContactPhone')}
          />
        </Field>
        <Field label="Relationship">
          <input value={v.emergencyContactRelation} onChange={set('emergencyContactRelation')} />
        </Field>
      </div>
      <FormError message={error} />
      <div className="ops-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Saving…' : resident ? 'Save changes' : 'Register resident'}
        </button>
        <button type="button" className="outline-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ResidentNew() {
  return (
    <section aria-labelledby="res-new">
      <p>
        <a href={opsLinks.residents}>← All residents</a>
      </p>
      <PageHead id="res-new" title="Register resident" />
      <ResidentForm
        onSaved={(r) => {
          window.location.hash = opsLinks.resident(r.id);
        }}
        onCancel={() => {
          window.location.hash = opsLinks.residents;
        }}
      />
    </section>
  );
}

export function ResidentDetail({ id }: { id: string }) {
  const { data, loading, error, reload } = useAsync(() => opsApi.residents.get(id), [id]);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const status = useGuardedAction();
  if (loading && !data) return <LoadingState label="Loading resident…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const changeStatus = (next: Resident['status']) =>
    status.run(async () => {
      await opsApi.residents.update(id, { status: next });
      setNotice(`Status set to ${label(next)}.`);
      reload();
    });
  return (
    <section aria-labelledby="res-detail">
      <p>
        <a href={opsLinks.residents}>← All residents</a>
      </p>
      <PageHead
        id="res-detail"
        title={`${data.firstName} ${data.lastName}`}
        action={<Tag>{label(data.status)}</Tag>}
      />
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      {editing ? (
        <ResidentForm
          resident={data}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice('Details saved.');
            reload();
          }}
        />
      ) : (
        <>
          <dl className="ops-kv">
            <dt>Phone</dt>
            <dd>{data.phone ?? '—'}</dd>
            <dt>E-mail</dt>
            <dd>{data.email ?? '—'}</dd>
            <dt>Date of birth</dt>
            <dd>{dateOnly(data.dateOfBirth)}</dd>
            <dt>Gender</dt>
            <dd>{data.gender ?? '—'}</dd>
            <dt>Address</dt>
            <dd>{data.address ?? '—'}</dd>
            <dt>Emergency contact</dt>
            <dd>
              {data.emergencyContactName
                ? `${data.emergencyContactName} (${data.emergencyContactRelation ?? 'contact'}) · ${data.emergencyContactPhone ?? '—'}`
                : '—'}
            </dd>
          </dl>
          <div className="ops-actions">
            <a className="outline-button" href={opsLinks.residentProfile(id)}>
              Stay profile and history
            </a>
            <button type="button" className="outline-button" onClick={() => setEditing(true)}>
              Edit details
            </button>
            {(['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const)
              .filter((s) => s !== data.status)
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  className="outline-button"
                  disabled={status.busy}
                  onClick={() => void changeStatus(s)}
                >
                  Mark {label(s).toLowerCase()}
                </button>
              ))}
          </div>
          <FormError message={status.error} />
        </>
      )}
    </section>
  );
}
