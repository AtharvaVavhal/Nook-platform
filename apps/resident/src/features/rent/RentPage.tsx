import { useState } from 'react';
import { api } from '../../api/index.js';
import type { RentSummary } from '../../api/types.js';
import { formatDate, formatInr, isZeroAmount } from '../../lib/format.js';
import { rentStatus } from '../../lib/status.js';
import { useResource } from '../../lib/useResource.js';
import { StatusBadge } from '../../ui/Badge.js';
import { EmptyState, ErrorState, SkeletonCard, SkeletonRows } from '../../ui/Feedback.js';
import { Card, PageHeader, Pager } from '../../ui/Layout.js';
import { InvoiceRow } from '../rows.js';

const PAGE_SIZE = 10;

export function RentPage() {
  const summary = useResource((s) => api.rentSummary(s), []);
  const [page, setPage] = useState(1);
  const invoices = useResource((s) => api.invoices(page, PAGE_SIZE, s), [page]);
  return (
    <div className="rp-stack rp-stack--lg">
      <PageHeader
        title="Rent & Invoices"
        subtitle="What has been billed, what you have paid, and what is due."
      />
      {summary.state.status === 'loading' ? (
        <Card>
          <SkeletonCard lines={3} label="Loading your rent summary" />
        </Card>
      ) : null}
      {summary.state.status === 'error' ? (
        <Card>
          <ErrorState error={summary.state.error} onRetry={summary.reload} />
        </Card>
      ) : null}
      {summary.state.status === 'ready' ? <Summary data={summary.state.data} /> : null}

      <Card flush title="Invoices">
        {invoices.state.status === 'loading' ? (
          <SkeletonRows rows={4} label="Loading invoices" />
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
            <>
              <ul className="rp-list">
                {invoices.state.data.items.map((i) => (
                  <li key={i.id}>
                    <InvoiceRow invoice={i} />
                  </li>
                ))}
              </ul>
              <Pager
                page={invoices.state.data.pagination.page}
                totalPages={invoices.state.data.pagination.totalPages}
                total={invoices.state.data.pagination.total}
                busy={false}
                onPage={setPage}
                noun="invoices"
              />
            </>
          )
        ) : null}
      </Card>
    </div>
  );
}

function Summary({ data }: { data: RentSummary }) {
  if (data.status === 'NO_INVOICES') return null;
  const overdue = !isZeroAmount(data.overdue);
  // Very large figures get a full-width card on phones, so an amount is never squeezed or split.
  const large = [data.totalInvoiced, data.totalPaid, data.overdue].some(
    (v) => formatInr(v).length > 13,
  );
  return (
    <section aria-label="Rent summary" className="rp-stack">
      <div className={`rp-stats rp-stats--4${large ? ' rp-stats--stack' : ''}`}>
        <div className="rp-stat rp-stat--wide">
          <div className="rp-stat__label">Outstanding balance</div>
          <div className="rp-stat__value rp-num">{formatInr(data.outstanding)}</div>
          <div style={{ marginTop: 8 }}>
            <StatusBadge status={rentStatus(data.status)} />
          </div>
        </div>
        <div className={`rp-stat${overdue ? ' rp-stat--danger' : ''}`}>
          <div className="rp-stat__label">Overdue</div>
          <div className="rp-stat__value rp-num">{formatInr(data.overdue)}</div>
        </div>
        <div className="rp-stat">
          <div className="rp-stat__label">Next due date</div>
          <div className="rp-stat__value">
            {data.nextDueDate ? formatDate(data.nextDueDate) : 'Nothing due'}
          </div>
        </div>
        <div className="rp-stat">
          <div className="rp-stat__label">Total invoiced</div>
          <div className="rp-stat__value rp-num">{formatInr(data.totalInvoiced)}</div>
        </div>
        <div className="rp-stat">
          <div className="rp-stat__label">Total paid</div>
          <div className="rp-stat__value rp-num">{formatInr(data.totalPaid)}</div>
        </div>
      </div>
    </section>
  );
}
