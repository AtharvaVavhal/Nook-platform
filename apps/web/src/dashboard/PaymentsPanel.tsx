import { formatMoney } from '../finance/financeFormat';
import { Tag } from '../ops/ui';
import type { Dashboard, Finance } from './dashboardApi';
import { PAYMENT_METHOD_LABELS, formatInstantIst, recentWindowText } from './dashboardRules';
import { DataTable, NoAccess, Panel } from './Panel';

/** Payments actually received. A reversed payment is shown and marked; it is not part of Collected. */
export function PaymentsPanel({
  finance,
  windows,
}: {
  finance: Finance | null;
  windows: Dashboard['windows'];
}) {
  if (!finance) {
    return (
      <Panel id="dash-payments" title="Recent payments">
        <NoAccess />
      </Panel>
    );
  }
  return (
    <Panel
      id="dash-payments"
      title="Recent payments"
      wide
      note={`Payments received ${recentWindowText(windows)}. A reversed payment is marked and is not counted as collected.`}
    >
      <DataTable
        caption="Payments received recently"
        head={['Received', 'Resident', 'Invoice', 'Method', 'Amount']}
        empty="No payments were received in this period."
        rows={finance.recentPayments.map((payment) => ({
          key: payment.paymentId,
          cells: [
            formatInstantIst(payment.receivedAt),
            payment.residentName,
            payment.invoiceNumber,
            PAYMENT_METHOD_LABELS[payment.method],
            <span key="a">
              {formatMoney(payment.amount)} {payment.reversed ? <Tag>Reversed</Tag> : null}
            </span>,
          ],
        }))}
      />
    </Panel>
  );
}
