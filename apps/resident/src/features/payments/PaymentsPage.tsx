import { useState } from 'react';
import { api } from '../../api/index.js';
import { useResource } from '../../lib/useResource.js';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/Feedback.js';
import { Card, PageHeader, Pager } from '../../ui/Layout.js';
import { PaymentRow } from '../rows.js';

const PAGE_SIZE = 10;

export function PaymentsPage() {
  const [page, setPage] = useState(1);
  const { state, reload } = useResource((s) => api.payments(page, PAGE_SIZE, s), [page]);
  return (
    <div className="rp-stack rp-stack--lg">
      <PageHeader
        title="Payments"
        subtitle="A record of the payments your hostel has received from you."
      />
      <Card flush>
        {state.status === 'loading' ? <SkeletonRows rows={4} label="Loading payments" /> : null}
        {state.status === 'error' ? <ErrorState error={state.error} onRetry={reload} /> : null}
        {state.status === 'ready' ? (
          state.data.items.length === 0 ? (
            <EmptyState
              icon="card"
              title="No payments yet"
              text="Payments your hostel records will appear here, newest first."
            />
          ) : (
            <>
              <ul className="rp-list">
                {state.data.items.map((p) => (
                  <li key={p.id}>
                    <PaymentRow payment={p} />
                  </li>
                ))}
              </ul>
              <Pager
                page={state.data.pagination.page}
                totalPages={state.data.pagination.totalPages}
                total={state.data.pagination.total}
                busy={false}
                onPage={setPage}
                noun="payments"
              />
            </>
          )
        ) : null}
      </Card>
    </div>
  );
}
