import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState, Pager, useAsync } from '../finance/shared';
import { Field, FormError, PageHead, Tag, useGuardedAction } from './ui';
import { opsApi } from './opsApi';
import {
  bedLabel,
  dateOnly,
  label,
  personName,
  suggestedAdmissionDate,
  todayDate,
} from './opsFormat';

export function AdmissionPanel() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useAsync(() => opsApi.admissions.list({ status, page, limit: 20 }), [status, page]);
  // Confirmed bookings that have no admission yet (the pilot's volume fits one page of 100)
  const candidates = useAsync(async () => {
    const [bookings, admissions] = await Promise.all([
      opsApi.bookings.list({ status: 'CONFIRMED', limit: 100 }),
      opsApi.admissions.list({ limit: 100 }),
    ]);
    const taken = new Set(admissions.items.map((a) => a.bookingId));
    return bookings.items.filter((b) => !taken.has(b.id));
  }, [list.data?.total]);
  const [bookingId, setBookingId] = useState('');
  const [date, setDate] = useState(todayDate());
  const [notice, setNotice] = useState<string | null>(null);
  const create = useGuardedAction();
  const act = useGuardedAction();
  const refresh = () => {
    list.reload();
    candidates.reload();
  };
  return (
    <section aria-labelledby="adm-title">
      <PageHead title="Admissions" />
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      <div className="ops-inline-form">
        <Field label="Confirmed booking">
          <select
            value={bookingId}
            onChange={(e) => {
              setBookingId(e.target.value);
              const chosen = candidates.data?.find((b) => b.id === e.target.value);
              // the API only accepts a date inside the booked period, so offer one that is
              if (chosen) setDate(suggestedAdmissionDate(chosen, todayDate()));
            }}
          >
            <option value="">
              {candidates.data && candidates.data.length === 0
                ? 'No booking is waiting for admission'
                : 'Choose a booking'}
            </option>
            {candidates.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {personName(b.resident)} · {bedLabel(b.bed)} · from {dateOnly(b.startDate)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Admission date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <button
          type="button"
          className="primary-button"
          disabled={create.busy || !bookingId || !date}
          onClick={() =>
            void create.run(async () => {
              await opsApi.admissions.create({ bookingId, admissionDate: date });
              setBookingId('');
              setNotice('Admission created. Mark it admitted when the resident arrives.');
              refresh();
            })
          }
        >
          {create.busy ? 'Creating…' : 'Create admission'}
        </button>
      </div>
      <FormError message={create.error} />
      <div className="fin-toolbar" style={{ marginTop: 16 }}>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All statuses</option>
            {['PENDING', 'ADMITTED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FormError message={act.error} />
      {list.loading && !list.data ? <LoadingState label="Loading admissions…" /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <EmptyState title="No admissions" hint="Create an admission from a confirmed booking." />
      ) : null}
      {list.data && list.data.items.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Resident</th>
                <th>Bed</th>
                <th>Admission date</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id}>
                  <td>{personName(a.resident)}</td>
                  <td>{bedLabel(a.bed)}</td>
                  <td>{dateOnly(a.admissionDate)}</td>
                  <td>
                    <Tag>{label(a.status)}</Tag>
                  </td>
                  <td>
                    {a.status === 'PENDING' ? (
                      <button
                        type="button"
                        className="fin-link-button"
                        disabled={act.busy}
                        onClick={() =>
                          void act.run(async () => {
                            await opsApi.admissions.setStatus(a.id, 'ADMITTED');
                            setNotice('Marked admitted. You can now check the resident in.');
                            refresh();
                          })
                        }
                      >
                        Mark admitted
                      </button>
                    ) : null}
                    {a.status !== 'CANCELLED' ? (
                      <button
                        type="button"
                        className="fin-link-button"
                        disabled={act.busy}
                        onClick={() => {
                          if (window.confirm('Cancel this admission?'))
                            void act.run(async () => {
                              await opsApi.admissions.setStatus(a.id, 'CANCELLED');
                              setNotice('Admission cancelled.');
                              refresh();
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
      {list.data ? (
        <Pager page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
      ) : null}
    </section>
  );
}
