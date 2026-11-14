import { formatMoney, monthLabel } from '../finance/financeFormat';
import { Stat } from '../finance/shared';
import type { Finance } from './dashboardApi';
import { plural } from './dashboardRules';
import { NoAccess, Panel } from './Panel';

/**
 * Invoiced and collected are for the chosen month; outstanding, overdue and pending cover all months. They are kept
 * apart and labelled so an invoice is never read as a payment and the two "outstanding" figures are never mixed up.
 */
export function FinancePanel({ finance, month }: { finance: Finance | null; month: string }) {
  if (!finance) {
    return (
      <Panel id="dash-finance" title="Finance">
        <NoAccess />
      </Panel>
    );
  }
  const label = monthLabel(month);
  const overdue = Number(finance.overdue.amount) > 0;
  return (
    <Panel
      id="dash-finance"
      title="Finance"
      note={`Invoiced, Collected and Month unpaid are for ${label}. Outstanding, Overdue and Pending cover all months. Collected counts payments received in ${label}, including for earlier invoices.`}
    >
      <div className="fin-stats">
        <Stat label={`Invoiced (${label})`} value={formatMoney(finance.invoiced)} />
        <Stat
          label={`Collected (${label})`}
          value={formatMoney(finance.collected)}
          tone="success"
        />
        <Stat label={`Month unpaid (${label})`} value={formatMoney(finance.monthUnpaid)} />
        <Stat label="Outstanding (all months)" value={formatMoney(finance.outstanding)} />
        <Stat
          label={`Overdue (all months) · ${plural(finance.overdue.count, 'invoice')}`}
          value={formatMoney(finance.overdue.amount)}
          tone={overdue ? 'danger' : undefined}
        />
        <Stat
          label={`Pending, not yet due · ${plural(finance.pendingPayments.count, 'invoice')}`}
          value={formatMoney(finance.pendingPayments.amount)}
        />
      </div>
      {finance.unattributed ? (
        <div className="fin-note dash-unattributed" role="note">
          <strong>Not included above.</strong> Your organization also has{' '}
          {plural(finance.unattributed.count, 'open invoice')} that belong to no booking, so they
          cannot be assigned to a property: invoiced {formatMoney(finance.unattributed.invoiced)}{' '}
          and collected {formatMoney(finance.unattributed.collected)} in {label}; outstanding{' '}
          {formatMoney(finance.unattributed.outstanding)}, of which overdue{' '}
          {formatMoney(finance.unattributed.overdue)}.
        </div>
      ) : null}
    </Panel>
  );
}
