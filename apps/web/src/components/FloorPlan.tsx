import type { CSSProperties, Dispatch } from 'react';
import {
  bedStatuses,
  demoFloors,
  filterRooms,
  statusLabels,
  summarize,
  type Bounds,
  type Floor,
  type StatusFilter,
} from '../propertyDemo';
import {
  isFloorLayoutValid,
  resolveSelection,
  type FloorPlanAction,
  type FloorPlanState,
} from '../floorPlanState';
import { Icon } from './BrandIllustration';

function position(bounds: Bounds, width: number, height: number): CSSProperties {
  return {
    left: `${(bounds.x / width) * 100}%`,
    top: `${(bounds.y / height) * 100}%`,
    width: `${(bounds.width / width) * 100}%`,
    height: `${(bounds.height / height) * 100}%`,
  };
}

export function StatusLegend() {
  return (
    <ul className="status-legend" aria-label="Bed status legend">
      {bedStatuses.map((status) => (
        <li key={status}>
          <span className={`legend-dot ${status}`} aria-hidden="true" />
          {statusLabels[status]}
        </li>
      ))}
      <li>
        <span className="selection-key" aria-hidden="true" />
        Selected locally
      </li>
    </ul>
  );
}

function SelectionDetails({
  floor,
  state,
  dispatch,
}: {
  floor: Floor;
  state: FloorPlanState;
  dispatch: Dispatch<FloorPlanAction>;
}) {
  const selection = resolveSelection(floor, state);
  const totals = selection ? summarize([selection.room]) : null;
  return (
    <aside
      className="selection-panel"
      id="selection-details"
      aria-labelledby="selection-heading"
      tabIndex={-1}
    >
      <div className="selection-panel-heading">
        <p className="eyebrow">INSPECT THE SPACE</p>
        {selection && (
          <button
            className="icon-button"
            type="button"
            aria-label="Clear selection"
            onClick={() => dispatch({ type: 'clear-selection' })}
          >
            <Icon name="close" size={17} />
          </button>
        )}
      </div>
      <div className="selection-preview" aria-hidden="true">
        {selection?.bed ? (
          <span className={`bed-tile ${selection.bed.status}`}>
            <span className="bed-drawing">
              <span />
            </span>
          </span>
        ) : (
          <Icon name={selection ? 'grid' : 'bed'} size={40} />
        )}
        <span>
          {selection
            ? selection.bed
              ? `BED ${selection.bed.id}`
              : `ROOM ${selection.room.id}`
            : 'A CLOSER LOOK'}
        </span>
      </div>
      <h3 id="selection-heading">
        {selection
          ? `Room ${selection.room.id}${selection.bed ? ` · Bed ${selection.bed.id}` : ''}`
          : 'Every space has a story'}
      </h3>
      {!selection ? (
        <p>Select a room name or a bed on the plan to explore its demonstration details.</p>
      ) : (
        <>
          {selection.bed && (
            <span className={`status-pill ${selection.bed.status}`}>
              {statusLabels[selection.bed.status]} · Demo
            </span>
          )}
          <dl className="bed-details">
            <div>
              <dt>Property</dt>
              <dd>Nook House (demo)</dd>
            </div>
            <div>
              <dt>Floor</dt>
              <dd>{floor.name}</dd>
            </div>
            <div>
              <dt>{selection.bed ? 'Bed reference' : 'Room reference'}</dt>
              <dd>
                {selection.room.id}
                {selection.bed ? `-${selection.bed.id}` : ''}
              </dd>
            </div>
            <div>
              <dt>Room capacity</dt>
              <dd>{totals?.beds} beds</dd>
            </div>
            <div>
              <dt>Backend-confirmed allocation</dt>
              <dd>None · not available in this phase</dd>
            </div>
          </dl>
          {!selection.bed && (
            <div className="room-detail-counts">
              {bedStatuses.map((status) => (
                <span key={status}>
                  <i className={`legend-dot ${status}`} aria-hidden="true" />
                  {totals?.[status]} {statusLabels[status].toLowerCase()}
                </span>
              ))}
            </div>
          )}
          {selection.bed?.unavailableReason && (
            <p className="maintenance-note">
              <strong>Operational hold</strong>
              {selection.bed.unavailableReason}
            </p>
          )}
          {selection.bed?.status === 'occupied' && (
            <p>Illustrative occupancy only. No resident record is attached.</p>
          )}
          <p className="local-selection-note">
            <strong>Selected on this device only</strong>Selection does not reserve or allocate a
            bed. Displayed availability is synthetic; no backend confirmation is connected.
          </p>
        </>
      )}
      <a className="text-link" href="#room-layout">
        Back to floor plan <span aria-hidden="true">↗</span>
      </a>
    </aside>
  );
}

export function FloorPlan({
  state,
  dispatch,
}: {
  state: FloorPlanState;
  dispatch: Dispatch<FloorPlanAction>;
}) {
  const floor = demoFloors.find((item) => item.id === state.floorId);
  if (!floor || !isFloorLayoutValid(floor))
    return (
      <section id="floor-plan" className="empty-state" role="alert">
        <h2>We couldn’t display this floor</h2>
        <p>
          The local layout is missing or invalid. No availability can be inferred from this view.
        </p>
        <button
          className="outline-button"
          onClick={() => dispatch({ type: 'floor', floorId: 'first' })}
        >
          Open first floor
        </button>
      </section>
    );
  const totals = summarize(floor.rooms);
  const matchingRooms = filterRooms(floor.rooms, state.query, state.status);
  const matchingIds = new Set(matchingRooms.map((room) => room.id));
  const selection = resolveSelection(floor, state);
  return (
    <section id="floor-plan" className="floor-section" aria-labelledby="floors-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow violet">EXPLORE YOUR SPACE</p>
          <h2 id="floors-heading">A floor-by-floor perspective</h2>
          <p>Select a room or bed. See the details, keep the context.</p>
        </div>
        <span className="subtle-label">INTERACTIVE 2D PLAN</span>
      </div>
      <div className="floor-workspace">
        <nav className="floor-tabs" aria-label="Choose a floor">
          {demoFloors.map((item, index) => (
            <button
              type="button"
              className={`floor-button ${state.floorId === item.id ? 'selected' : ''}`}
              key={item.id}
              aria-pressed={state.floorId === item.id}
              onClick={() => dispatch({ type: 'floor', floorId: item.id })}
            >
              <span className="floor-number">{index.toString().padStart(2, '0')}</span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.rooms.length
                    ? `${item.rooms.length} rooms · ${summarize(item.rooms).beds} beds`
                    : 'No rooms yet'}
                </small>
              </span>
            </button>
          ))}
        </nav>
        <div className="floor-content">
          <div className="floor-title">
            <div>
              <h3>{floor.name}</h3>
              <p>
                {totals.rooms} rooms <span>·</span> {totals.beds} beds <span>·</span>{' '}
                <span className="available-text">{totals.available} available</span>
              </p>
            </div>
            <span className="floor-view-label">
              <Icon name="grid" size={16} />
              Top-down view
            </span>
          </div>
          {floor.rooms.length > 0 && (
            <div className="room-toolbar">
              <label className="search-field">
                <Icon name="search" size={18} />
                <span className="sr-only">Search rooms on {floor.name}</span>
                <input
                  type="search"
                  placeholder="Find a room, e.g. 103"
                  value={state.query}
                  onChange={(event) => dispatch({ type: 'query', query: event.target.value })}
                />
              </label>
              <label className="status-select">
                <span>Bed status</span>
                <select
                  value={state.status}
                  onChange={(event) =>
                    dispatch({ type: 'status', status: event.target.value as StatusFilter })
                  }
                >
                  <option value="all">All statuses</option>
                  {bedStatuses.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              {(state.query || state.status !== 'all') && (
                <button className="text-button" onClick={() => dispatch({ type: 'reset-filters' })}>
                  Clear filters
                </button>
              )}
            </div>
          )}
          <StatusLegend />
          <p className="result-count" role="status">
            {matchingRooms.length} of {floor.rooms.length} rooms match
            {state.status !== 'all' ? ` · ${statusLabels[state.status]} beds highlighted` : ''}
            {selection
              ? ` · Room ${selection.room.id}${selection.bed ? `, bed ${selection.bed.id}, ${statusLabels[selection.bed.status]}` : ''} selected locally`
              : ''}
          </p>
          <div className="plan-and-details">
            <div className="plan-column">
              {matchingRooms.length ? (
                <>
                  <div className="plan-caption">
                    <span>Schematic layout · Not to scale</span>
                    <span aria-hidden="true">↑ N</span>
                  </div>
                  <div
                    className="plan-scroll"
                    id="room-layout"
                    tabIndex={0}
                    role="region"
                    aria-label={`${floor.name} floor plan, scroll horizontally on small screens`}
                  >
                    <div
                      className="spatial-plan"
                      style={{ aspectRatio: `${floor.width} / ${floor.height}` }}
                    >
                      {floor.zones.map((zone) => (
                        <div
                          key={zone.id}
                          className={`plan-zone ${zone.kind}`}
                          style={position(zone.bounds, floor.width, floor.height)}
                        >
                          {zone.kind === 'stairs' && (
                            <span className="stairs-drawing" aria-hidden="true" />
                          )}
                          <span>{zone.label}</span>
                          {zone.kind === 'corridor' && <span aria-hidden="true">↔</span>}
                        </div>
                      ))}
                      {floor.rooms.map((room) => {
                        const matches = matchingIds.has(room.id);
                        return (
                          <div
                            key={room.id}
                            className={`plan-room ${selection?.room.id === room.id ? 'room-selected' : ''} ${matches ? '' : 'room-muted'}`}
                            style={position(room.bounds, floor.width, floor.height)}
                            role="group"
                            aria-label={`Room ${room.id}`}
                          >
                            <button
                              className="room-select"
                              disabled={!matches}
                              aria-pressed={selection?.room.id === room.id && !selection.bed}
                              onClick={() =>
                                dispatch({
                                  type: 'select',
                                  selection: { floorId: floor.id, roomId: room.id },
                                })
                              }
                            >
                              <strong>Room {room.id}</strong>
                              <span>
                                {room.beds.length}-bed room <span aria-hidden="true">↗</span>
                              </span>
                            </button>
                            {room.beds.map((bed) => {
                              const bedMatches =
                                matches && (state.status === 'all' || bed.status === state.status);
                              return (
                                <button
                                  type="button"
                                  key={bed.id}
                                  className={`bed-tile spatial-bed ${bed.status} ${selection?.room.id === room.id && selection.bed?.id === bed.id ? 'bed-selected' : ''} ${bedMatches ? '' : 'nonmatching'}`}
                                  style={position(
                                    bed.bounds,
                                    room.bounds.width,
                                    room.bounds.height,
                                  )}
                                  disabled={!bedMatches}
                                  aria-pressed={
                                    selection?.room.id === room.id && selection.bed?.id === bed.id
                                  }
                                  aria-label={`Room ${room.id}, bed ${bed.id}: ${statusLabels[bed.status]}. View demo details`}
                                  onClick={() =>
                                    dispatch({
                                      type: 'select',
                                      selection: {
                                        floorId: floor.id,
                                        roomId: room.id,
                                        bedId: bed.id,
                                      },
                                    })
                                  }
                                >
                                  <span className="bed-drawing" aria-hidden="true">
                                    <span />
                                  </span>
                                  <strong>{bed.id}</strong>
                                  <span className="sr-only">{statusLabels[bed.status]}</span>
                                  {bed.status === 'unavailable' && (
                                    <span className="bed-unavailable-mark" aria-hidden="true">
                                      ×
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                            <span className="room-door" aria-hidden="true" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="layout-note">
                    <Icon name="pin" size={16} />
                    <span>
                      Room and bed positions are illustrative. Scroll the plan on smaller screens.
                    </span>
                  </div>
                  {selection && (
                    <a className="text-link selection-jump" href="#selection-details">
                      View selection details <Icon name="arrow" size={14} />
                    </a>
                  )}
                </>
              ) : (
                <div className="empty-state" id="room-layout">
                  <span className="empty-icon">
                    <Icon name={floor.rooms.length ? 'search' : 'building'} size={30} />
                  </span>
                  <h3>{floor.rooms.length ? 'No matching rooms' : 'A little room to grow'}</h3>
                  <p>
                    {floor.rooms.length
                      ? 'Try another room number or bed status on this floor.'
                      : 'This demo floor has no rooms or beds. Explore another floor to see the plan.'}
                  </p>
                  <button
                    className="outline-button"
                    onClick={() =>
                      dispatch(
                        floor.rooms.length
                          ? { type: 'reset-filters' }
                          : { type: 'floor', floorId: 'first' },
                      )
                    }
                  >
                    {floor.rooms.length ? 'Clear filters' : 'Explore first floor'}
                  </button>
                </div>
              )}
            </div>
            <SelectionDetails floor={floor} state={state} dispatch={dispatch} />
          </div>
        </div>
        <div className="plan-disclaimer">
          <span aria-hidden="true">ⓘ</span>
          <span>
            <strong>Explore freely. Nothing is allocated.</strong> Demo availability only · No live
            availability API · No changes are saved.
          </span>
        </div>
      </div>
    </section>
  );
}
