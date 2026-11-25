import { api } from '../../api/index.js';
import type { Stay } from '../../api/types.js';
import { formatDate, formatDateTime, formatInr } from '../../lib/format.js';
import { stayStatus, upcomingStageLabel } from '../../lib/status.js';
import { useResource } from '../../lib/useResource.js';
import { StatusBadge } from '../../ui/Badge.js';
import { Banner, EmptyState, ErrorState, SkeletonCard } from '../../ui/Feedback.js';
import { Card, DefList, PageHeader } from '../../ui/Layout.js';

export function StayPage() {
  const { state, reload } = useResource((s) => api.stay(s), []);
  return (
    <div className="rp-stack rp-stack--lg">
      <PageHeader title="My Stay" subtitle="Where you live and how long you are booked." />
      {state.status === 'loading' ? (
        <Card>
          <SkeletonCard lines={5} label="Loading your stay" />
        </Card>
      ) : null}
      {state.status === 'error' ? (
        <Card>
          <ErrorState error={state.error} onRetry={reload} />
        </Card>
      ) : null}
      {state.status === 'ready' ? <StayDetails stay={state.data} /> : null}
    </div>
  );
}

function StayDetails({ stay }: { stay: Stay }) {
  const hasAnything = Boolean(stay.current) || stay.upcoming.length > 0 || Boolean(stay.lastStay);
  return (
    <>
      {stay.status === 'UNDER_REVIEW' ? (
        <Banner tone="warning" role="status">
          <strong>Your stay is under review.</strong> Your hostel is checking your records. Details
          will appear here once that is done. If this lasts long, ask your hostel.
        </Banner>
      ) : null}

      {stay.current ? (
        <Card title="Current stay" action={<StatusBadge status={stayStatus('CURRENT')} />}>
          <DefList
            rows={[
              { label: 'Hostel', value: stay.current.hostelName },
              { label: 'Room', value: stay.current.roomNumber },
              { label: 'Bed', value: stay.current.bedNumber },
              { label: 'Stay started', value: formatDate(stay.current.checkInDate) },
              { label: 'Expected end', value: formatDate(stay.current.expectedCheckOutDate) },
              { label: 'Monthly rent', value: formatInr(stay.current.monthlyRent) },
              {
                label: 'Status',
                value: stay.current.stayStatus === 'ACTIVE' ? 'Active' : stay.current.stayStatus,
              },
            ]}
          />
        </Card>
      ) : null}

      {stay.upcoming.length > 0 ? (
        <section className="rp-stack" aria-labelledby="upcoming-title">
          <h2 id="upcoming-title" className="rp-card__title">
            Upcoming {stay.upcoming.length === 1 ? 'stay' : 'stays'}
          </h2>
          {stay.upcoming.map((u, i) => (
            <Card
              key={`${u.startDate}-${i}`}
              action={<StatusBadge status={stayStatus('UPCOMING')} />}
              title={u.hostelName}
            >
              <DefList
                rows={[
                  { label: 'Room', value: u.roomNumber },
                  { label: 'Bed', value: u.bedNumber },
                  { label: 'Starts', value: formatDate(u.startDate) },
                  { label: 'Ends', value: formatDate(u.endDate) },
                  { label: 'Monthly rent', value: formatInr(u.monthlyRent) },
                  { label: 'Progress', value: upcomingStageLabel(u.stage) },
                ]}
              />
            </Card>
          ))}
        </section>
      ) : null}

      {stay.lastStay ? (
        <Card title="Previous stay">
          <DefList
            rows={[{ label: 'Checked out', value: formatDateTime(stay.lastStay.checkedOutAt) }]}
          />
        </Card>
      ) : null}

      {!hasAnything && stay.status !== 'UNDER_REVIEW' ? (
        <Card>
          <EmptyState
            icon="bed"
            title="No stay on record yet"
            text="When your hostel assigns you a room, your stay details will appear here."
          />
        </Card>
      ) : null}
    </>
  );
}
