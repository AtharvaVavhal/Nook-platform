import { formatDate } from '../finance/financeFormat';
import { Stat } from '../finance/shared';
import { Tag } from '../ops/ui';
import type { Bookings, Dashboard } from './dashboardApi';
import { placeText, recentWindowText, upcomingWindowText } from './dashboardRules';
import { DataTable, NoAccess, Panel } from './Panel';

/** Bookings: what is committed for the coming days and what was booked recently. */
export function BookingsPanel({
  bookings,
  windows,
}: {
  bookings: Bookings | null;
  windows: Dashboard['windows'];
}) {
  if (!bookings) {
    return (
      <Panel id="dash-bookings" title="Bookings">
        <NoAccess />
      </Panel>
    );
  }
  return (
    <Panel
      id="dash-bookings"
      title="Bookings"
      note={`Confirmed bookings that start ${upcomingWindowText(windows)} and have not checked in. Recent bookings were created ${recentWindowText(windows)}.`}
    >
      <div className="fin-stats">
        <Stat label="Confirmed upcoming" value={String(bookings.confirmedUpcoming.count)} />
        <Stat label="Beds committed" value={String(bookings.committedBeds)} />
      </div>
      <h4 className="dash-sub">Recent booking activity</h4>
      <DataTable
        caption="Bookings created recently"
        head={['Resident', 'Bed', 'Stay', 'Status']}
        empty="No bookings were created in this period."
        rows={bookings.recent.map((item) => ({
          key: item.bookingId,
          cells: [
            item.residentName,
            placeText(item),
            `${formatDate(item.startDate)} to ${formatDate(item.endDate)}`,
            <Tag key="s">{item.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'}</Tag>,
          ],
        }))}
      />
    </Panel>
  );
}
