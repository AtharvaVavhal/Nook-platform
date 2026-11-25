import { api } from '../../api/index.js';
import type { RentSummary, Stay } from '../../api/types.js';
import { useProfile } from '../../auth/AuthContext.js';
import { formatDate, formatInr, greeting, isZeroAmount } from '../../lib/format.js';
import { hrefs } from '../../lib/route.js';
import { rentStatus, stayStatus } from '../../lib/status.js';
import { useResource, type Resource } from '../../lib/useResource.js';
import { StatusBadge } from '../../ui/Badge.js';
import { Banner, EmptyState, ErrorState, SkeletonCard, SkeletonRows } from '../../ui/Feedback.js';
import { Icon } from '../../ui/Icon.js';
import { Card, DefList, PageHeader } from '../../ui/Layout.js';
import { InvoiceRow, PaymentRow } from '../rows.js';

export function HomePage() {
  const profile = useProfile();
  const stay = useResource((s) => api.stay(s), []);
  const rent = useResource((s) => api.rentSummary(s), []);
  const invoices = useResource((s) => api.invoices(1, 3, s), []);
  const payments = useResource((s) => api.payments(1, 3, s), []);
  const hostel =
    stay.state.status === 'ready' && stay.state.data.current
      ? stay.state.data.current.hostelName
      : profile.organizationName;

  return (
    <div className="rp-stack rp-stack--lg">
      <PageHeader
        title={`${greeting(new Date().getHours())}, ${profile.firstName}`}
        subtitle={hostel}
      />
      <RentHero resource={rent.state} onRetry={rent.reload} />
      <div className="rp-grid rp-grid--2">
        <div className="rp-stack">
          <StayCard resource={stay.state} onRetry={stay.reload} />
          <Card title="Quick actions">
            <div className="rp-quick">
              <a className="rp-quick__item" href={hrefs.rent}>
                <Icon name="receipt" />
                Invoices
              </a>
              <a className="rp-quick__item" href={hrefs.payments}>
                <Icon name="card" />
                Payments
              </a>
              <a className="rp-quick__item" href={hrefs.stay}>
                <Icon name="bed" />
                My Stay
              </a>
            </div>
          </Card>
        </div>
        <div className="rp-stack">
          <Card
            flush
            title="Recent payments"
            action={
              <a className="rp-link" href={hrefs.payments}>
                View all
                <span className="rp-visually-hidden"> recent payments</span>
              </a>
            }
          >
            {payments.state.status === 'loading' ? (
              <SkeletonRows rows={3} label="Loading recent payments" />
            ) : null}
            {payments.state.status === 'error' ? (
              <ErrorState error={payments.state.error} onRetry={payments.reload} />
            ) : null}
            {payments.state.status === 'ready' ? (
              payments.state.data.items.length === 0 ? (
                <EmptyState
                  icon="card"
                  title="No payments yet"
                  text="Payments your hostel records will appear here."
                />
              ) : (
                <ul className="rp-list">
                  {payments.state.data.items.map((p) => (
                    <li key={p.id}>
                      <PaymentRow payment={p} />
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Card>
          <Card
            flush
            title="Recent invoices"
            action={
              <a className="rp-link" href={hrefs.rent}>
                View all
                <span className="rp-visually-hidden"> recent invoices</span>
              </a>
            }
          >
            {invoices.state.status === 'loading' ? (
              <SkeletonRows rows={3} label="Loading recent invoices" />
            ) : null}
            {invoices.state.status === 'error' ? (
              <ErrorState error={invoices.state.error} onRetry={invoices.reload} />
            ) : null}
            {invoices.state.status === 'ready' ? (
              invoices.state.data.items.length === 0 ? (
                <EmptyState
                  icon="receipt"
                  title="No invoices yet"
                  text="Invoices appear here once your hostel issues them."
                />
              ) : (
                <ul className="rp-list">
                  {invoices.state.data.items.map((i) => (
                    <li key={i.id}>
                      <InvoiceRow invoice={i} />
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function RentHero({ resource, onRetry }: { resource: Resource<RentSummary>; onRetry: () => void }) {
  if (resource.status === 'loading')
    return (
      <div className="rp-hero" aria-busy="true">
        <SkeletonCard lines={2} label="Loading your balance" />
      </div>
    );
  if (resource.status === 'error')
    return (
      <Card>
        <ErrorState error={resource.error} onRetry={onRetry} />
      </Card>
    );
  const rent = resource.data;
  if (rent.status === 'NO_INVOICES')
    return (
      <section className="rp-hero rp-hero--calm" aria-label="Rent">
        <div className="rp-hero__top">
          <span className="rp-eyebrow">Rent</span>
          <StatusBadge status={rentStatus(rent.status)} />
        </div>
        <p className="rp-hero__amount">No invoices yet</p>
        <p className="rp-hero__meta">
          Your invoices will appear here once your hostel issues them.
        </p>
      </section>
    );
  const paidUp = rent.status === 'PAID_UP';
  return (
    <section className="rp-hero" aria-label="Rent balance">
      <div className="rp-hero__top">
        <span className="rp-eyebrow">Outstanding balance</span>
        <StatusBadge status={rentStatus(rent.status)} />
      </div>
      <p className="rp-hero__amount rp-num">{formatInr(rent.outstanding)}</p>
      <div className="rp-hero__meta">
        {paidUp ? <span>You're all paid up. Thank you.</span> : null}
        {rent.nextDueDate && !paidUp ? (
          <span>
            Next due <strong>{formatDate(rent.nextDueDate)}</strong>
          </span>
        ) : null}
        {!isZeroAmount(rent.overdue) ? (
          <span>
            Overdue <strong className="rp-num">{formatInr(rent.overdue)}</strong>
          </span>
        ) : null}
        <span>
          Paid so far <strong className="rp-num">{formatInr(rent.totalPaid)}</strong>
        </span>
      </div>
    </section>
  );
}

function StayCard({ resource, onRetry }: { resource: Resource<Stay>; onRetry: () => void }) {
  return (
    <Card
      title="Your stay"
      action={
        resource.status === 'ready' ? (
          <StatusBadge status={stayStatus(resource.data.status)} />
        ) : undefined
      }
    >
      {resource.status === 'loading' ? <SkeletonCard lines={3} label="Loading your stay" /> : null}
      {resource.status === 'error' ? <ErrorState error={resource.error} onRetry={onRetry} /> : null}
      {resource.status === 'ready' ? <StaySummary stay={resource.data} /> : null}
    </Card>
  );
}

function StaySummary({ stay }: { stay: Stay }) {
  if (stay.current)
    return (
      <div className="rp-stack">
        <DefList
          rows={[
            { label: 'Hostel', value: stay.current.hostelName },
            { label: 'Room', value: stay.current.roomNumber },
            { label: 'Bed', value: stay.current.bedNumber },
            { label: 'Monthly rent', value: formatInr(stay.current.monthlyRent) },
          ]}
        />
        <a className="rp-link" href={hrefs.stay}>
          View stay details <Icon name="chevron" className="rp-row__chev" />
        </a>
      </div>
    );
  if (stay.status === 'UNDER_REVIEW')
    return (
      <Banner tone="warning" role="status">
        Your hostel is reviewing your stay records. Details will show here once that is done.
      </Banner>
    );
  const next = stay.upcoming[0];
  if (stay.status === 'UPCOMING' && next)
    return (
      <div className="rp-stack">
        <DefList
          rows={[
            { label: 'Hostel', value: next.hostelName },
            { label: 'Room', value: next.roomNumber },
            { label: 'Bed', value: next.bedNumber },
            { label: 'Starts', value: formatDate(next.startDate) },
          ]}
        />
        <a className="rp-link" href={hrefs.stay}>
          View stay details <Icon name="chevron" className="rp-row__chev" />
        </a>
      </div>
    );
  if (stay.status === 'COMPLETED' && stay.lastStay)
    return (
      <EmptyState
        icon="clock"
        title="Your last stay has ended"
        text={`It ended on ${formatDate(stay.lastStay.checkedOutAt)}.`}
      />
    );
  return (
    <EmptyState
      icon="bed"
      title="No stay on record yet"
      text="When your hostel assigns you a room, it will appear here."
    />
  );
}
