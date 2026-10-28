import {
  bedStatuses,
  demoFloors,
  statusLabels,
  summarize,
  type StatusFilter,
} from '../propertyDemo';
import { Icon } from './BrandIllustration';

export function InventoryOverview({
  onExplore,
}: {
  onExplore: (floorId: string, status?: StatusFilter) => void;
}) {
  const totals = summarize(demoFloors.flatMap((floor) => floor.rooms));
  return (
    <section id="inventory" className="inventory-section" aria-labelledby="inventory-heading">
      <div className="section-heading">
        <div>
          <h2 id="inventory-heading">Inventory at a glance</h2>
          <p>One property. Every room and bed accounted for.</p>
        </div>
        <span className="environment-badge">DEMO INVENTORY</span>
      </div>
      <div
        className="inventory-table-wrap"
        role="region"
        aria-label="Floor inventory, scroll horizontally on small screens"
        tabIndex={0}
      >
        <table className="inventory-table">
          <caption className="sr-only">
            Synthetic inventory by floor. Availability is not live.
          </caption>
          <thead>
            <tr>
              <th scope="col">Floor</th>
              <th scope="col">Rooms</th>
              <th scope="col">Beds</th>
              {bedStatuses.map((status) => (
                <th key={status} scope="col">
                  {statusLabels[status]}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Explore</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {demoFloors.map((floor, index) => {
              const counts = summarize(floor.rooms);
              return (
                <tr key={floor.id}>
                  <th scope="row">
                    <span className="inventory-floor">
                      <span className="floor-number">{index.toString().padStart(2, '0')}</span>
                      {floor.name}
                    </span>
                  </th>
                  <td>{counts.rooms}</td>
                  <td>{counts.beds}</td>
                  {bedStatuses.map((status) => (
                    <td key={status}>
                      <span className={`inventory-count ${status}`}>{counts[status]}</span>
                    </td>
                  ))}
                  <td>
                    <a
                      href="#floor-plan"
                      className="text-link"
                      aria-label={`Explore ${floor.name}`}
                      onClick={() => onExplore(floor.id)}
                    >
                      View plan <Icon name="arrow" size={14} />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Property total</th>
              <td>{totals.rooms}</td>
              <td>{totals.beds}</td>
              {bedStatuses.map((status) => (
                <td key={status}>{totals[status]}</td>
              ))}
              <td>Demo data</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
