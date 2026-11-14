import { formatDate } from '../finance/financeFormat';
import { Stat } from '../finance/shared';
import { Tag } from '../ops/ui';
import type { Dashboard, Tenants } from './dashboardApi';
import {
  ADMISSION_STATUS_LABELS,
  formatInstantIst,
  plural,
  placeText,
  recentWindowText,
  upcomingWindowText,
} from './dashboardRules';
import { DataTable, NoAccess, Panel } from './Panel';

/** Tenant lifecycle: who is here, who is about to arrive or leave, and who is past their booking end date. */
export function MovementsPanel({
  tenants,
  windows,
}: {
  tenants: Tenants | null;
  windows: Dashboard['windows'];
}) {
  if (!tenants) {
    return (
      <Panel id="dash-tenants" title="Tenants" wide>
        <NoAccess />
      </Panel>
    );
  }
  const upcoming = upcomingWindowText(windows);
  const recent = recentWindowText(windows);
  return (
    <Panel
      id="dash-tenants"
      title="Tenants"
      note={`Upcoming covers ${upcoming}. Recent covers ${recent}. A booking that ends today is listed under upcoming check-outs.`}
      wide
    >
      <div className="fin-stats">
        <Stat label="Active tenants" value={String(tenants.activeTenants)} />
        <Stat
          label="Upcoming check-ins"
          value={tenants.upcomingCheckIns ? String(tenants.upcomingCheckIns.count) : '—'}
        />
        <Stat label="Upcoming check-outs" value={String(tenants.upcomingCheckOuts.count)} />
        <Stat
          label="Past end date"
          value={String(tenants.pastEndDate.count)}
          tone={tenants.pastEndDate.count > 0 ? 'danger' : undefined}
        />
      </div>

      <h4 className="dash-sub">Upcoming check-ins · {upcoming}</h4>
      {tenants.upcomingCheckIns ? (
        <DataTable
          caption="Confirmed bookings starting soon that have not checked in"
          head={['Resident', 'Bed', 'Starts', 'Admission']}
          empty="No check-ins expected in this period."
          count={tenants.upcomingCheckIns.count}
          rows={tenants.upcomingCheckIns.items.map((item) => ({
            key: item.bookingId,
            cells: [
              item.residentName,
              placeText(item),
              formatDate(item.startDate),
              item.admissionStatus ? ADMISSION_STATUS_LABELS[item.admissionStatus] : '—',
            ],
          }))}
        />
      ) : (
        <NoAccess />
      )}

      <h4 className="dash-sub">Upcoming check-outs · {upcoming}</h4>
      <DataTable
        caption="Residents whose booking ends soon"
        head={['Resident', 'Bed', 'Booking ends']}
        empty="No check-outs expected in this period."
        count={tenants.upcomingCheckOuts.count}
        rows={tenants.upcomingCheckOuts.items.map((item) => ({
          key: item.checkInId,
          cells: [item.residentName, placeText(item), formatDate(item.endDate)],
        }))}
      />

      <h4 className="dash-sub">Past end date</h4>
      <p className="fin-hint">Still checked in after their booking end date.</p>
      <DataTable
        caption="Residents still checked in after their booking end date"
        head={['Resident', 'Bed', 'Booking ended', 'Days past']}
        empty="Nobody is past their booking end date."
        count={tenants.pastEndDate.count}
        rows={tenants.pastEndDate.items.map((item) => ({
          key: item.checkInId,
          cells: [
            item.residentName,
            placeText(item),
            formatDate(item.endDate),
            <Tag key="d">{plural(item.daysPast, 'day')}</Tag>,
          ],
        }))}
      />

      <h4 className="dash-sub">Recent admissions · {recent}</h4>
      {tenants.recentAdmissions ? (
        <DataTable
          caption="Admitted residents by admission date"
          head={['Resident', 'Bed', 'Admission date']}
          empty="No admissions dated in this period."
          rows={tenants.recentAdmissions.map((item) => ({
            key: item.admissionId,
            cells: [item.residentName, placeText(item), formatDate(item.admissionDate)],
          }))}
        />
      ) : (
        <NoAccess />
      )}

      <h4 className="dash-sub">Recent departures · {recent}</h4>
      <DataTable
        caption="Residents who checked out recently"
        head={['Resident', 'Bed', 'Checked out']}
        empty="Nobody checked out in this period."
        rows={tenants.recentDepartures.map((item) => ({
          key: item.checkOutId,
          cells: [item.residentName, placeText(item), formatInstantIst(item.checkOutAt)],
        }))}
      />
    </Panel>
  );
}
