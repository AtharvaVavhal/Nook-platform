import type { Inventory } from './dashboardApi';
import {
  anomalyMessages,
  isEmptyProperty,
  occupancyBarDescription,
  occupancySegments,
  occupancySummary,
  percentText,
} from './dashboardRules';
import { Panel } from './Panel';

/** Occupancy from active stays: a count with its denominator, a segmented bar with a text equivalent, and by-floor rows. */
export function OccupancyPanel({ inventory }: { inventory: Inventory }) {
  if (isEmptyProperty(inventory)) {
    return (
      <Panel id="dash-occupancy" title="Occupancy" wide>
        <p className="fin-hint dash-empty">
          This property has no rooms or beds yet. Add rooms and beds to see occupancy here.
        </p>
      </Panel>
    );
  }
  const segments = occupancySegments(inventory);
  return (
    <Panel
      id="dash-occupancy"
      title="Occupancy"
      note="Occupied beds hold a resident who is checked in. Bookings do not count until the resident checks in."
      wide
    >
      <p className="dash-headline">
        <strong>{percentText(inventory.occupancyPercent)}</strong>
        <span>{occupancySummary(inventory)}</span>
      </p>
      <div className="dash-bar" role="img" aria-label={occupancyBarDescription(inventory)}>
        {segments.map((segment) =>
          segment.count > 0 ? (
            <span
              key={segment.key}
              className={`dash-seg dash-seg-${segment.key}`}
              style={{ width: `${segment.percent}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="dash-legend">
        {segments.map((segment) => (
          <li key={segment.key}>
            <i className={`dash-dot dash-seg-${segment.key}`} aria-hidden="true" />
            <span>{segment.label}</span> <strong>{segment.count}</strong>
          </li>
        ))}
        <li>
          <span>Rooms</span> <strong>{inventory.rooms}</strong>
        </li>
      </ul>
      {anomalyMessages(inventory).map((message) => (
        <p key={message} className="fin-note dash-warning" role="note">
          {message}
        </p>
      ))}
      {inventory.byFloor.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <caption className="sr-only">Beds by floor</caption>
            <thead>
              <tr>
                <th scope="col">Floor</th>
                <th scope="col" className="num">
                  Beds
                </th>
                <th scope="col" className="num">
                  Occupied
                </th>
                <th scope="col" className="num">
                  Available
                </th>
                <th scope="col" className="num">
                  Out of service
                </th>
              </tr>
            </thead>
            <tbody>
              {inventory.byFloor.map((floor) => (
                <tr key={floor.floorId}>
                  <th scope="row">{floor.label}</th>
                  <td className="num">{floor.beds}</td>
                  <td className="num">{floor.occupiedBeds}</td>
                  <td className="num">{floor.availableBeds}</td>
                  <td className="num">{floor.outOfServiceBeds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}
