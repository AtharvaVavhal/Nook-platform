import { useState, useCallback, useEffect } from 'react';
import { LoadingState, ErrorState, EmptyState, Pager, Stat } from '../finance/shared';
import { useAsync } from '../finance/shared';
import { Field, PageHead, Tag } from './ui';
import {
  opsApi,
  type StaySummaryStatus,
  type HistoryEventResponse,
  type StaySummaryCurrentStay,
  type StaySummaryUpcomingBooking,
  type StaySummaryLastCheckOut,
  type StaySummaryFinanceBalance,
} from './opsApi';
import { opsLinks } from './opsRoute';
import { dateOnly, label as formatLabel } from './opsFormat';
import { Icon } from '../components/BrandIllustration';
import { CorrectionHistory } from './Corrections';
import { TransferWorkflow, TransferHistory } from './Transfers';
import { financeApi } from '../finance/financeApi';
import {
  formatDateTime as formatPaymentTime,
  formatMoney as formatPaymentMoney,
  methodLabels,
} from '../finance/financeFormat';
import './ops.css';

type ProfileTab = 'overview' | 'history' | 'finance' | 'corrections';

// Type for metadata to avoid accessing unknown properties
type EventMetadata = Record<string, unknown>;

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    return dateOnly(dateString);
  } catch {
    return dateString.slice(0, 10);
  }
}

function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString.slice(0, 16);
  }
}

function formatCurrency(amount: string): string {
  const num = Number(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function getEventTitle(action: string): string {
  const titles: Record<string, string> = {
    'booking.created': 'Booking Created',
    'booking.updated': 'Booking Updated',
    'booking.cancelled': 'Booking Cancelled',
    'booking.extended': 'Booking Extended',
    'booking.shortened': 'Booking Shortened',
    'admission.created': 'Admission Created',
    'admission.updated': 'Admission Updated',
    'admission.approved': 'Admission Approved',
    'admission.cancelled': 'Admission Cancelled',
    'admission.reopened': 'Admission Reopened',
    'checkin.created': 'Check-in',
    'checkout.created': 'Check-out',
    'correction.submitted': 'Correction requested',
    'correction.applied': 'Correction applied',
    'correction.rejected': 'Correction rejected',
    'correction.withdrawn': 'Correction withdrawn',
    'correction.stale': 'Correction became stale',
    'resident.corrected': 'Resident corrected',
    'booking.corrected': 'Booking corrected',
    'admission.corrected': 'Admission corrected',
    'checkin.corrected': 'Check-in corrected',
    'checkout.corrected': 'Checkout corrected',
  };
  return titles[action] || action;
}

function getEventDescription(event: HistoryEventResponse): string {
  const { action, metadata } = event;
  const meta = metadata as EventMetadata;
  switch (action) {
    case 'booking.created':
      return `Bed ${(meta.bedId as string)?.slice(0, 8)} · ${meta.startDate} to ${meta.endDate}`;
    case 'booking.updated':
      return `Changed: ${(meta.changedFields as string[])?.join(', ') || '—'}`;
    case 'booking.cancelled':
      return `Reason: ${meta.reason || '—'}`;
    case 'booking.extended':
      return `Extended from ${meta.previousEndDate} to ${meta.newEndDate} · ${meta.reason || ''}`;
    case 'booking.shortened':
      return `Shortened to ${meta.newEndInstant}`;
    case 'admission.created':
      return `Bed ${(meta.bedId as string)?.slice(0, 8)} · Admission date: ${formatDate(meta.admissionDate as string)}`;
    case 'admission.updated':
      return `Changed: ${(meta.changedFields as string[])?.join(', ') || '—'}`;
    case 'admission.approved':
      return `Previous status: ${meta.previousStatus}`;
    case 'admission.cancelled':
      return `Previous status: ${meta.previousStatus} · Reason: ${meta.reason || '—'}`;
    case 'admission.reopened':
      return `Previous status: ${meta.previousStatus}`;
    case 'checkin.created':
      return `Bed ${(meta.bedId as string)?.slice(0, 8)} · Checked in at ${formatDateTime(meta.checkInAt as string)}`;
    case 'checkout.created':
      return `Checked out at ${formatDateTime(meta.checkOutAt as string)} · ${meta.reason || ''}`;
    default:
      return '';
  }
}

function getEventIcon(
  action: string,
): 'building' | 'grid' | 'bed' | 'layers' | 'search' | 'arrow' | 'pin' | 'close' {
  if (action.startsWith('booking.')) return 'grid';
  if (action.startsWith('admission.')) return 'building';
  if (action.startsWith('checkin.')) return 'arrow';
  if (action.startsWith('checkout.')) return 'arrow';
  return 'layers';
}

function formatISTDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return formatDate(dateString);
  }
}

function formatISTDateTime(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return formatDateTime(dateString);
  }
}

interface ResidentProfileProps {
  id: string;
}

export function ResidentProfile({ id }: ResidentProfileProps) {
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyAction, setHistoryAction] = useState<string>('');
  const [historyFromDate, setHistoryFromDate] = useState('');
  const [historyToDate, setHistoryToDate] = useState('');
  const [historyLimit] = useState(20);

  // Stay Summary query (only active when overview or finance tab is active)
  const staySummaryQuery = useAsync(
    useCallback(async () => {
      return opsApi.residents.staySummary(id);
    }, [id, activeTab]),
    [id, activeTab],
  );

  // History query
  const historyQuery = useAsync(
    useCallback(async () => {
      return opsApi.residents.history(id, {
        page: historyPage,
        limit: historyLimit,
        action: historyAction,
        fromDate: historyFromDate,
        toDate: historyToDate,
      });
    }, [id, historyPage, historyAction, historyFromDate, historyToDate, historyLimit]),
    [id, historyPage, historyAction, historyFromDate, historyToDate, historyLimit],
  );

  // Current stay status for overview
  const currentStayStatus = staySummaryQuery.data?.currentStayStatus ?? 'NO_ACTIVE_STAY';
  const currentStay = staySummaryQuery.data?.currentStay;
  const upcomingBookings = staySummaryQuery.data?.upcomingBookings ?? [];
  const lastCheckOut = staySummaryQuery.data?.lastCheckOut;
  const financeBalance = staySummaryQuery.data?.financeBalance;
  // Handle 404 for stay summary
  const isResidentNotFound =
    staySummaryQuery.error?.includes('Resident not found') ||
    historyQuery.error?.includes('Resident not found');

  // History data
  const historyItems = historyQuery.data?.items ?? [];
  const historyTotal = historyQuery.data?.total ?? 0;
  const historyTotalPages = historyQuery.data?.totalPages ?? 0;

  // Loading states
  const isLoadingOverview =
    activeTab !== 'history' && (staySummaryQuery.loading || staySummaryQuery.data === null);
  const isLoadingHistory =
    activeTab === 'history' && (historyQuery.loading || historyQuery.data === null);
  const isLoading = activeTab === 'history' ? isLoadingHistory : isLoadingOverview;

  // Error states
  const currentError = activeTab === 'history' ? historyQuery.error : staySummaryQuery.error;

  // Handle tab change
  useEffect(() => {
    setHistoryPage(1);
    setHistoryAction('');
    setHistoryFromDate('');
    setHistoryToDate('');
  }, [activeTab]);

  if (isResidentNotFound) {
    return (
      <section aria-labelledby="res-profile">
        <p>
          <a href={opsLinks.residents}>← All residents</a>
        </p>
        <PageHead id="res-profile" title="Resident not found" />
        <ErrorState message="This resident could not be found." />
      </section>
    );
  }

  const resident = staySummaryQuery.data?.resident;
  const residentName = resident ? `${resident.firstName} ${resident.lastName}` : 'Loading…';

  return (
    <section aria-labelledby="res-profile">
      <p>
        <a href={opsLinks.residents}>← All residents</a>
      </p>
      <PageHead
        id="res-profile"
        title={residentName}
        action={resident ? <Tag>{formatLabel(resident.status)}</Tag> : null}
      />

      {/* Tab Navigation */}
      <nav className="profile-tabs" aria-label="Profile sections">
        <button
          type="button"
          className={`profile-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Icon name="grid" size={16} />
          Overview
        </button>
        <button
          type="button"
          className={`profile-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <Icon name="layers" size={16} />
          Stay History
        </button>
        <button
          type="button"
          className={`profile-tab ${activeTab === 'finance' ? 'active' : ''}`}
          onClick={() => setActiveTab('finance')}
        >
          <Icon name="grid" size={16} />
          Financial
        </button>
        <button
          type="button"
          className={`profile-tab ${activeTab === 'corrections' ? 'active' : ''}`}
          onClick={() => setActiveTab('corrections')}
        >
          <Icon name="search" size={16} />
          Corrections
        </button>
      </nav>

      {currentError ? (
        <ErrorState
          message={currentError}
          onRetry={activeTab === 'history' ? historyQuery.reload : staySummaryQuery.reload}
        />
      ) : isLoading ? (
        <LoadingState label={activeTab === 'history' ? 'Loading history…' : 'Loading profile…'} />
      ) : (
        <>
          {activeTab === 'overview' &&
            currentStayStatus === 'ACTIVE' &&
            currentStay &&
            staySummaryQuery.data?.allowedActions?.includes('transferPreview') && (
              <TransferWorkflow
                key={id}
                residentId={id}
                currentBedId={currentStay.activeCheckIn.bedId}
                residentName={residentName}
                onComplete={staySummaryQuery.reload}
              />
            )}
          {activeTab === 'overview' && staySummaryQuery.data?.resident && (
            <OverviewTab
              resident={staySummaryQuery.data.resident}
              currentStay={currentStay ?? null}
              currentStayStatus={currentStayStatus}
              upcomingBookings={upcomingBookings}
              lastCheckOut={lastCheckOut ?? null}
              onRefresh={staySummaryQuery.reload}
            />
          )}
          {activeTab === 'history' && (
            <HistoryTab
              items={historyItems}
              total={historyTotal}
              page={historyPage}
              totalPages={historyTotalPages}
              action={historyAction}
              fromDate={historyFromDate}
              toDate={historyToDate}
              onPageChange={setHistoryPage}
              onActionChange={setHistoryAction}
              onFromDateChange={setHistoryFromDate}
              onToDateChange={setHistoryToDate}
              loading={historyQuery.loading}
              error={historyQuery.error}
              reload={historyQuery.reload}
            />
          )}
          {activeTab === 'finance' && financeBalance && <FinanceTab residentId={id} />}
          {activeTab === 'corrections' && (
            <>
              <CorrectionHistory targetType="RESIDENT" targetId={id} />
              <TransferHistory key={id} residentId={id} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function OverviewTab({
  resident,
  currentStay,
  currentStayStatus,
  upcomingBookings,
  lastCheckOut,
  onRefresh,
}: {
  resident: {
    id: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    email?: string | null;
    status: string;
  };
  currentStay: StaySummaryCurrentStay | null;
  currentStayStatus: StaySummaryStatus;
  upcomingBookings: StaySummaryUpcomingBooking[];
  lastCheckOut: StaySummaryLastCheckOut | null;
  onRefresh: () => void;
}) {
  if (!resident) return <LoadingState label="Loading resident…" />;

  return (
    <div className="profile-overview">
      <ResidentRecordCards resident={resident} />

      {/* Current Stay */}
      <section className="profile-card" aria-labelledby="current-stay-heading">
        <div className="profile-section-header">
          <h3 id="current-stay-heading" className="profile-section-title">
            Current Stay
          </h3>
          {currentStayStatus !== 'ACTIVE' && (
            <button type="button" className="outline-button" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
        {currentStayStatus === 'ACTIVE' && currentStay ? (
          <CurrentStayCard stay={currentStay} />
        ) : currentStayStatus === 'NO_ACTIVE_STAY' ? (
          <EmptyState title="No active stay" hint="This resident is not currently checked in." />
        ) : currentStayStatus === 'INCONSISTENT_ACTIVE_CHECK_INS' ? (
          <div className="fin-state fin-state-warning" role="alert">
            <p>
              <strong>Inconsistent active check-ins</strong>
            </p>
            <p>
              Multiple active check-ins were found for this resident. Please review check-ins
              manually.
            </p>
          </div>
        ) : null}
      </section>

      {/* Upcoming Bookings */}
      <section className="profile-card" aria-labelledby="upcoming-bookings-heading">
        <h3 id="upcoming-bookings-heading" className="profile-section-title">
          Upcoming Bookings
        </h3>
        {upcomingBookings.length > 0 ? (
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>Dates</th>
                  <th>Property / Room / Bed</th>
                  <th>Admission</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {upcomingBookings.map((b) => (
                  <tr key={b.booking.id}>
                    <td>
                      {formatISTDate(b.booking.startDate)} – {formatISTDate(b.booking.endDate)}
                    </td>
                    <td>
                      {b.booking.propertyName}
                      {b.booking.roomLabel && ` / ${b.booking.roomLabel}`}
                      {b.booking.bedLabel && ` / ${b.booking.bedLabel}`}
                    </td>
                    <td>
                      {b.admission ? (
                        <>
                          <Tag>{formatLabel(b.admission.status)}</Tag>
                          <br />
                          <small>
                            {b.admission.admissionDate
                              ? formatISTDate(b.admission.admissionDate)
                              : '—'}
                          </small>
                        </>
                      ) : (
                        <span className="fin-empty">No admission</span>
                      )}
                    </td>
                    <td>
                      <Tag>{b.classification.replace(/_/g, ' ')}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No upcoming bookings" hint="All confirmed bookings are shown here." />
        )}
      </section>

      {/* Last Checkout */}
      {lastCheckOut && (
        <section className="profile-card" aria-labelledby="last-checkout-heading">
          <h3 id="last-checkout-heading" className="profile-section-title">
            Last Check-out
          </h3>
          <dl className="ops-kv">
            <dt>Date & Time</dt>
            <dd>{formatISTDateTime(lastCheckOut.checkOutAt)}</dd>
            {lastCheckOut.reason && (
              <>
                <dt>Reason</dt>
                <dd>{lastCheckOut.reason}</dd>
              </>
            )}
            {lastCheckOut.notes && (
              <>
                <dt>Notes</dt>
                <dd>{lastCheckOut.notes}</dd>
              </>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}

function CurrentStayCard({ stay }: { stay: StaySummaryCurrentStay }) {
  const { booking, admission, activeCheckIn } = stay;
  return (
    <div className="current-stay-card">
      <div className="current-stay-header">
        <div>
          <h4 className="current-stay-property">{booking.propertyName}</h4>
          <p className="current-stay-location">
            Room {booking.roomLabel} · Bed {booking.bedLabel}
          </p>
        </div>
        <Tag>{formatLabel(booking.paymentStatus)}</Tag>
      </div>
      <dl className="ops-kv current-stay-details">
        <dt>Booking Period</dt>
        <dd>
          {formatISTDate(booking.startDate)} – {formatISTDate(booking.endDate)}
        </dd>
        <dt>Monthly Rent</dt>
        <dd>{formatCurrency(booking.monthlyPrice)}</dd>
        <dt>Booking Status</dt>
        <dd>
          <Tag>{formatLabel(booking.status)}</Tag>
        </dd>
        <dt>Check-in</dt>
        <dd>{formatISTDateTime(activeCheckIn.checkInAt)}</dd>
        {admission && (
          <>
            <dt>Admission</dt>
            <dd>
              <Tag>{formatLabel(admission.status)}</Tag>
              {admission.admissionDate && ` · ${formatISTDate(admission.admissionDate)}`}
            </dd>
          </>
        )}
        {activeCheckIn.isOverstay && (
          <>
            <dt>⚠ Overstay</dt>
            <dd>
              <strong>Booking ended on {formatISTDate(activeCheckIn.bookingEndDate)}</strong>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function HistoryTab({
  items,
  total,
  page,
  totalPages,
  action,
  fromDate,
  toDate,
  onPageChange,
  onActionChange,
  onFromDateChange,
  onToDateChange,
  loading,
  error,
  reload,
}: {
  items: HistoryEventResponse[];
  total: number;
  page: number;
  totalPages: number;
  action: string;
  fromDate: string;
  toDate: string;
  onPageChange: (page: number) => void;
  onActionChange: (action: string) => void;
  onFromDateChange: (date: string) => void;
  onToDateChange: (date: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => void;
}) {
  const actionOptions = [
    'booking.created',
    'booking.updated',
    'booking.cancelled',
    'booking.extended',
    'booking.shortened',
    'admission.created',
    'admission.updated',
    'admission.approved',
    'admission.cancelled',
    'admission.reopened',
    'checkin.created',
    'checkout.created',
    'correction.submitted',
    'correction.applied',
    'correction.rejected',
    'correction.withdrawn',
    'correction.stale',
    'resident.corrected',
    'booking.corrected',
    'admission.corrected',
    'checkin.corrected',
    'checkout.corrected',
  ];

  return (
    <div className="profile-history">
      <div className="history-filters">
        <Field label="Action">
          <select
            value={action}
            onChange={(e) => {
              onPageChange(1);
              onActionChange(e.target.value);
            }}
          >
            <option value="">All actions</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From date">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              onPageChange(1);
              onFromDateChange(e.target.value);
            }}
          />
        </Field>
        <Field label="To date">
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              onPageChange(1);
              onToDateChange(e.target.value);
            }}
          />
        </Field>
        <button type="button" className="outline-button" onClick={reload} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && items.length === 0 ? <LoadingState label="Loading history…" /> : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState
          title="No history found"
          hint="This resident has no recorded lifecycle events."
        />
      ) : null}

      {!loading && items.length > 0 && (
        <>
          <div className="history-timeline">
            {items.map((event) => (
              <HistoryEventCard key={event.id} event={event} />
            ))}
          </div>
          {totalPages > 1 && <Pager page={page} totalPages={totalPages} onPage={onPageChange} />}
        </>
      )}

      <p className="history-count">
        Showing {items.length} of {total} events
      </p>
    </div>
  );
}

function HistoryEventCard({ event }: { event: HistoryEventResponse }) {
  return (
    <article className="history-event">
      <div className="history-event-marker">
        <Icon name={getEventIcon(event.action)} size={16} />
      </div>
      <div className="history-event-content">
        <div className="history-event-header">
          <h4 className="history-event-title">{getEventTitle(event.action)}</h4>
          <time className="history-event-time" dateTime={event.occurredAt}>
            {formatISTDateTime(event.occurredAt)}
          </time>
        </div>
        <p className="history-event-description">{getEventDescription(event)}</p>
        {event.actor && <p className="history-event-actor">By {event.actor.displayName}</p>}
        {Object.keys(event.metadata).length > 0 && (
          <details className="history-event-metadata">
            <summary>View metadata</summary>
            <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
          </details>
        )}
      </div>
    </article>
  );
}

/** Document/KYC state read from the resident record. Verification and resubmission controls are not offered. */
/**
 * The resident's full record (from the resident API, scoped to the session organization) and its document status.
 * The stay summary only carries phone, e-mail and status, so those show immediately and the rest follows.
 */
function ResidentRecordCards({
  resident,
}: {
  resident: { id: string; phone?: string | null; email?: string | null; status: string };
}) {
  const query = useAsync(() => opsApi.residents.get(resident.id), [resident.id]);
  const record = query.data;
  const emergency = record
    ? [record.emergencyContactName, record.emergencyContactRelation, record.emergencyContactPhone]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <>
      <section className="profile-card" aria-labelledby="resident-info-heading">
        <h3 id="resident-info-heading" className="profile-section-title">
          Resident Information
        </h3>
        <dl className="ops-kv">
          <dt>Phone</dt>
          <dd>{(record?.phone ?? resident.phone) || '—'}</dd>
          <dt>E-mail</dt>
          <dd>{(record?.email ?? resident.email) || '—'}</dd>
          {record ? (
            <>
              <dt>Date of birth</dt>
              <dd>{formatDate(record.dateOfBirth)}</dd>
              <dt>Gender</dt>
              <dd>{record.gender ? formatLabel(record.gender) : '—'}</dd>
              <dt>Address</dt>
              <dd>{record.address || '—'}</dd>
              <dt>Emergency contact</dt>
              <dd>{emergency || '—'}</dd>
            </>
          ) : null}
          <dt>Status</dt>
          <dd>
            <Tag>{formatLabel(record?.status ?? resident.status)}</Tag>
          </dd>
        </dl>
        {query.loading ? <LoadingState label="Loading resident details…" /> : null}
        {query.error ? <ErrorState message={query.error} onRetry={query.reload} /> : null}
      </section>
      <section className="profile-card" aria-labelledby="documents-heading">
        <h3 id="documents-heading" className="profile-section-title">
          Documents and KYC
        </h3>
        {query.loading ? <LoadingState label="Loading documents…" /> : null}
        {record ? (
          <>
            <dl className="ops-kv">
              <dt>Verification</dt>
              <dd>
                <Tag>{formatLabel(record.documentVerificationStatus)}</Tag>
              </dd>
              <dt>Document reference</dt>
              <dd>{record.documentUrl ? 'Recorded' : 'None recorded'}</dd>
            </dl>
            <p className="fin-lede">
              Read-only. There is no upload, review or rejection-reason contract yet, so this card
              cannot verify, reject or request resubmission.
            </p>
          </>
        ) : null}
      </section>
    </>
  );
}

function FinanceTab({ residentId }: { residentId: string }) {
  const [page, setPage] = useState(1);
  const query = useAsync(
    () => financeApi.outstanding({ residentId, page, limit: 20 }),
    [residentId, page],
  );
  if (query.loading) return <LoadingState label="Loading financial summary…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />;
  const financeBalance = query.data;
  if (!financeBalance) return null;

  const { totals, items } = financeBalance;

  return (
    <div className="profile-finance">
      {/* Financial Summary Stats */}
      <div className="finance-stats">
        <Stat
          label="Outstanding Amount"
          value={formatCurrency(totals.outstandingAmount)}
          tone={totals.outstandingAmount !== '0.00' ? 'danger' : undefined}
        />
        <Stat
          label="Overdue Amount"
          value={formatCurrency(totals.overdueAmount)}
          tone={totals.overdueAmount !== '0.00' ? 'danger' : undefined}
        />
        <Stat label="Outstanding Invoices" value={String(totals.outstandingCount)} />
        <Stat
          label="Overdue Invoices"
          value={String(totals.overdueCount)}
          tone={totals.overdueCount > 0 ? 'danger' : undefined}
        />
      </div>

      {/* Invoice Items */}
      <section className="profile-card" aria-labelledby="finance-items-heading">
        <h3 id="finance-items-heading" className="profile-section-title">
          Outstanding invoices
        </h3>
        {items.length > 0 ? (
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Period</th>
                  <th>Amount</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Due Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((inv: StaySummaryFinanceBalance['items'][0]) => (
                  <tr key={inv.id}>
                    <td>
                      <a href={`#finance/invoices/${inv.id}`}>{inv.number}</a>
                    </td>
                    <td>
                      {formatISTDate(inv.periodStart)} – {formatISTDate(inv.periodEnd)}
                    </td>
                    <td>{formatCurrency(inv.amount)}</td>
                    <td>{formatCurrency(inv.cashReceived)}</td>
                    <td>{formatCurrency(inv.balance)}</td>
                    <td>
                      <Tag>{formatLabel(inv.status)}</Tag>
                    </td>
                    <td>{formatISTDate(inv.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No outstanding invoices"
            hint="This resident has no unpaid issued invoices. View Finance for invoice and payment history."
          />
        )}
      </section>
      <Pager page={financeBalance.page} totalPages={financeBalance.totalPages} onPage={setPage} />
      <InvoiceHistory residentId={residentId} />
    </div>
  );
}

/** Every invoice for this resident (all statuses), read page by page: nothing is capped or dropped. */
function InvoiceHistory({ residentId }: { residentId: string }) {
  const [page, setPage] = useState(1);
  const query = useAsync(
    () => financeApi.listInvoices({ residentId, page, limit: 20 }),
    [residentId, page],
  );
  return (
    <section className="profile-card" aria-labelledby="invoice-history-heading">
      <h3 id="invoice-history-heading" className="profile-section-title">
        Invoice history
      </h3>
      {query.loading ? <LoadingState label="Loading invoice history…" /> : null}
      {query.error ? <ErrorState message={query.error} onRetry={query.reload} /> : null}
      {query.data && query.data.items.length === 0 ? (
        <EmptyState title="No invoices yet" hint="Invoices for this resident will appear here." />
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <>
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Period</th>
                  <th>Amount</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Due date</th>
                  <th>Payments</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((inv) => (
                  <InvoiceHistoryRow key={inv.id} inv={inv} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="fin-lede">
            {query.data.total} invoice
            {query.data.total === 1 ? '' : 's'} in total. Use “View payments” for the payment
            history of an invoice, or open it for adjustments and receipts.
          </p>
          <Pager page={query.data.page} totalPages={query.data.totalPages} onPage={setPage} />
        </>
      ) : null}
    </section>
  );
}

/** One invoice in the resident's history; its payments are read from the invoice only when asked for. */
function InvoiceHistoryRow({
  inv,
}: {
  inv: {
    id: string;
    number: string;
    periodStart: string;
    periodEnd: string;
    amount: string;
    balance: string;
    status: string;
    dueDate: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const canHavePayments = inv.status !== 'DRAFT';
  return (
    <>
      <tr>
        <td>
          <a href={`#finance/invoices/${inv.id}`}>{inv.number}</a>
        </td>
        <td>
          {formatISTDate(inv.periodStart)} – {formatISTDate(inv.periodEnd)}
        </td>
        <td>{formatCurrency(inv.amount)}</td>
        <td>{formatCurrency(inv.balance)}</td>
        <td>
          <Tag>{formatLabel(inv.status)}</Tag>
        </td>
        <td>{formatISTDate(inv.dueDate)}</td>
        <td>
          {canHavePayments ? (
            <button
              type="button"
              className="outline-button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? 'Hide payments' : 'View payments'}
            </button>
          ) : (
            '—'
          )}
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7}>
            <InvoicePayments invoiceId={inv.id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function InvoicePayments({ invoiceId }: { invoiceId: string }) {
  const query = useAsync(() => financeApi.getInvoice(invoiceId), [invoiceId]);
  if (query.loading) return <LoadingState label="Loading payments…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />;
  const payments = query.data?.payments ?? [];
  if (payments.length === 0) {
    return <EmptyState title="No payments" hint="No payment has been recorded on this invoice." />;
  }
  return (
    <div className="profile-table-wrap">
      <table className="profile-table">
        <caption className="sr-only">Payments on this invoice</caption>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Received</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>
                <a href={`#finance/receipt/${invoiceId}/${payment.id}`}>{payment.receiptNumber}</a>
              </td>
              <td>{formatPaymentTime(payment.receivedAt)}</td>
              <td>{methodLabels[payment.method]}</td>
              <td>{formatPaymentMoney(payment.amount)}</td>
              <td>
                {payment.reversed ? <Tag>Reversed</Tag> : null}
                {payment.correctsPaymentId ? <Tag>Replacement payment</Tag> : null}
                {payment.reference ? ` Ref ${payment.reference}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
