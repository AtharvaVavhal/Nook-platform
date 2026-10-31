import type { Floor } from '../propertyDemo';
import { statusLabels, summarize } from '../propertyDemo';
import { StatusBadge } from './StatusBadge';
import { type FloorPlanState, type FloorPlanAction } from '../floorPlanState';
import type { Dispatch } from 'react';

interface FloorPlanListProps {
  floor: Floor;
  state: FloorPlanState;
  dispatch: Dispatch<FloorPlanAction>;
  onSwitchToVisual?: () => void;
}

export function FloorPlanList({
  floor,
  state,
  dispatch,
  onSwitchToVisual,
}: FloorPlanListProps) {
  const totals = summarize(floor.rooms);

  const filteredRooms = floor.rooms.filter((room) => {
    const matchesSearch =
      !state.query ||
      `room ${room.id}`.toLowerCase().includes(state.query.toLowerCase()) ||
      room.beds.some((b) => `${room.id}-${b.id}`.toLowerCase().includes(state.query.toLowerCase()));

    const matchesStatus =
      state.status === 'all' || room.beds.some((b) => b.status === state.status);

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="floor-list-view" role="region" aria-label={`Tabular bed directory for ${floor.name}`}>
      <div className="floor-list-header">
        <div>
          <h3>{floor.name} — Bed Inventory</h3>
          <p>
            {totals.rooms} rooms · {totals.beds} beds ·{' '}
            <strong className="available-text">{totals.available} available</strong>
          </p>
        </div>
        {onSwitchToVisual && (
          <button type="button" className="outline-button" onClick={onSwitchToVisual}>
            Switch to 2D Schematic Plan
          </button>
        )}
      </div>

      <div className="inventory-table-wrap" tabIndex={0} aria-label="Bed list table, scroll horizontally if needed">
        <table className="inventory-table">
          <caption className="sr-only">
            List of all rooms and beds on {floor.name}. Availability is live per bed.
          </caption>
          <thead>
            <tr>
              <th scope="col">Room</th>
              <th scope="col">Bed ID</th>
              <th scope="col">Status</th>
              <th scope="col">Operational Notes / Reason</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRooms.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '24px' }}>
                  No beds match the current filter on this floor.
                </td>
              </tr>
            ) : (
              filteredRooms.flatMap((room) =>
                room.beds
                  .filter((bed) => state.status === 'all' || bed.status === state.status)
                  .map((bed) => {
                    const isSelected =
                      state.selection?.roomId === room.id && state.selection?.bedId === bed.id;

                    return (
                      <tr
                        key={`${room.id}-${bed.id}`}
                        className={isSelected ? 'is-selected-row' : ''}
                      >
                        <th scope="row">Room {room.id}</th>
                        <td>
                          <strong>{room.id}-{bed.id}</strong>
                        </td>
                        <td>
                          <StatusBadge variant={bed.status} label={statusLabels[bed.status]} />
                        </td>
                        <td>
                          {bed.unavailableReason ? (
                            <span className="maintenance-note-inline">
                              {bed.unavailableReason}
                            </span>
                          ) : bed.status === 'available' ? (
                            <span style={{ color: 'var(--color-success-text)' }}>
                              Ready for allocation
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-secondary)' }}>
                              Currently occupied
                            </span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={isSelected ? 'primary-button' : 'outline-button'}
                            style={{ padding: '4px 10px', fontSize: '12px' }}
                            onClick={() =>
                              dispatch({
                                type: 'select',
                                selection: { floorId: floor.id, roomId: room.id, bedId: bed.id },
                              })
                            }
                          >
                            {isSelected ? 'Selected' : 'Inspect'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
