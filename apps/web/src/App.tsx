import React, { useEffect, useRef, useState } from 'react';
import {
  demoFloors,
  filterRooms,
  statusLabels,
  summarize,
  type BedStatus,
  type StatusFilter,
} from './propertyDemo';

type IconName = 'building' | 'grid' | 'bed' | 'layers' | 'search' | 'arrow' | 'pin' | 'close';
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths = {
    building: (
      <>
        <path d="M4 21V5l8-2v18M12 8h8v13M2 21h20" />
        <path d="M8 7v1m0 3v1m0 3v1m8-4v1m0 3v1" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    bed: (
      <>
        <path d="M3 17V7m18 10V9H3m0 5h18M3 17v3m18-3v3M7 9V6h5v3" />
        <path d="M3 14v3h18v-3" />
      </>
    ),
    layers: <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function PropertyIllustration() {
  return (
    <svg className="property-illustration" viewBox="0 0 280 180" fill="none" aria-hidden="true">
      <circle cx="168" cy="87" r="77" fill="currentColor" opacity=".05" />
      <path
        d="M38 159h211M70 159V49l95-26v136M165 64l56 16v79M66 49l99-28 5 3"
        stroke="currentColor"
        strokeWidth="2"
      />
      {[0, 1, 2].map((row) => (
        <g key={row}>
          {[0, 1, 2].map((col) => (
            <path
              key={col}
              d={`M${84 + col * 25} ${62 + row * 29 - col * 6}v17l12-3V${59 + row * 29 - col * 6}Z`}
              fill="currentColor"
              opacity={row === 1 && col === 1 ? '.5' : '.17'}
            />
          ))}
        </g>
      ))}
      <path
        d="M105 159v-25l29-6v31M183 90v15l14 4V94Zm0 29v15l14 4v-15Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M43 158v-25m-10 0c-5-17 11-34 16-17 16-5 19 20 3 22"
        fill="currentColor"
        opacity=".22"
      />
    </svg>
  );
}

export function App(): React.JSX.Element {
  const [floorId, setFloorId] = useState('first');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selectedBed, setSelectedBed] = useState<{
    room: string;
    id: string;
    status: BedStatus;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const floor = demoFloors.find((item) => item.id === floorId) ?? demoFloors[0]!;
  const totals = summarize(demoFloors.flatMap((item) => item.rooms));
  const floorTotals = summarize(floor.rooms);
  const rooms = filterRooms(floor.rooms, query, status);
  const statuses = Object.keys(statusLabels) as BedStatus[];
  useEffect(() => {
    if (selectedBed && !dialog.current?.open) dialog.current?.showModal();
  }, [selectedBed]);
  function resetFilters() {
    setQuery('');
    setStatus('all');
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand-lockup" href="#overview" aria-label="Nook home">
          <span className="brand-monogram" aria-hidden="true">
            n
          </span>
          <span className="brand-wordmark">
            nook<span>.</span>
          </span>
        </a>
        <div className="workspace-name">
          <span className="workspace-avatar">NH</span>
          <div>
            <strong>Nook House</strong>
            <small>Demo workspace</small>
          </div>
        </div>
        <p className="sidebar-label">YOUR WORKSPACE</p>
        <nav aria-label="Primary navigation">
          <a className="nav-item nav-item-active" href="#overview" aria-current="page">
            <Icon name="building" />
            Property overview
          </a>
          <a className="nav-item" href="#floor-plan">
            <Icon name="layers" />
            Floors & rooms
          </a>
          <a className="nav-item" href="#room-layout">
            <Icon name="bed" />
            Bed layout
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon">
            <Icon name="building" />
          </span>
          <strong>
            A little space.
            <br />A lot of possibility.
          </strong>
          <p>Your property, thoughtfully organised.</p>
        </div>
        <div className="sidebar-footer">
          <span className="demo-dot" />
          Demonstration workspace
        </div>
      </aside>
      <main className="main-content" id="main" tabIndex={-1}>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <Icon name="arrow" size={13} />
            <span>Property management</span>
          </div>
          <span className="environment-badge">DEMO DATA</span>
        </header>
        <section id="overview" aria-labelledby="page-title">
          <div className="page-heading">
            <div>
              <p className="eyebrow violet">A SPACE FOR EVERYONE</p>
              <h1 id="page-title">Property management</h1>
              <p className="page-description">A clear view of your property, from floor to bed.</p>
            </div>
            <a className="outline-button" href="#floor-plan">
              Explore layout <Icon name="arrow" size={16} />
            </a>
          </div>
          <div className="property-banner">
            <div className="property-copy">
              <span className="property-kicker">YOUR DEMONSTRATION PROPERTY</span>
              <h2>Nook House</h2>
              <p>
                <Icon name="pin" size={16} />
                Indiranagar, Bengaluru <span>· Fictional property</span>
              </p>
              <div className="property-meta">
                <span>Shared living</span>
                <span>{demoFloors.length} floors</span>
                <span>{totals.rooms} rooms</span>
              </div>
            </div>
            <PropertyIllustration />
          </div>
          <p className="demo-notice">
            <span aria-hidden="true">ⓘ</span> All rooms and bed states are illustrative. Explore the
            layout; no live property or resident data is connected.
          </p>
          <div className="summary-grid" aria-label="Property summary">
            <article className="summary-card">
              <div>
                <span className="card-label">Total floors</span>
                <strong>{demoFloors.length.toString().padStart(2, '0')}</strong>
                <p>3 with rooms · 1 empty floor</p>
              </div>
              <span className="summary-icon">
                <Icon name="layers" size={23} />
              </span>
            </article>
            <article className="summary-card">
              <div>
                <span className="card-label">Total rooms</span>
                <strong>{totals.rooms.toString().padStart(2, '0')}</strong>
                <p>A room-by-room perspective</p>
              </div>
              <span className="summary-icon">
                <Icon name="grid" size={23} />
              </span>
            </article>
            <article className="summary-card">
              <div>
                <span className="card-label">Total beds</span>
                <strong>{totals.beds}</strong>
                <p>
                  <span className="available-text">{totals.available} available</span> across the
                  property
                </p>
              </div>
              <span className="summary-icon">
                <Icon name="bed" size={23} />
              </span>
            </article>
          </div>
          <div className="availability-strip">
            <span className="strip-label">Bed snapshot</span>
            <div className="availability-track" aria-hidden="true">
              {statuses.map((item) => (
                <span key={item} className={item} style={{ flex: totals[item] }} />
              ))}
            </div>
            <div className="snapshot-labels">
              {statuses.map((item) => (
                <span key={item}>
                  <i className={`legend-dot ${item}`} />
                  <strong>{totals[item]}</strong> {statusLabels[item]}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section id="floor-plan" aria-labelledby="floors-heading" className="floor-section">
          <div className="section-heading">
            <div>
              <h2 id="floors-heading">Floors & rooms</h2>
              <p>A place for every bed. Select one to take a closer look.</p>
            </div>
            <span className="subtle-label">READ-ONLY PREVIEW</span>
          </div>
          <div className="floor-workspace">
            <nav className="floor-list" aria-label="Choose a floor">
              <p className="eyebrow">
                FLOORS <span>{demoFloors.length}</span>
              </p>
              {demoFloors.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`floor-button ${floorId === item.id ? 'selected' : ''}`}
                  aria-pressed={floorId === item.id}
                  onClick={() => {
                    setFloorId(item.id);
                    resetFilters();
                  }}
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
                  <Icon name="arrow" size={14} />
                </button>
              ))}
            </nav>
            <div className="floor-content" id="room-layout">
              <div className="floor-title">
                <div>
                  <h3>{floor.name}</h3>
                  <p>
                    {floorTotals.rooms} rooms <span>·</span> {floorTotals.beds} beds <span>·</span>{' '}
                    <span className="available-text">{floorTotals.available} available</span>
                  </p>
                </div>
                <span className="floor-view-label">
                  <Icon name="grid" size={15} />
                  Layout view
                </span>
              </div>
              {floor.rooms.length > 0 && (
                <div className="room-toolbar">
                  <label className="search-field">
                    <Icon name="search" size={17} />
                    <span className="sr-only">Search rooms on {floor.name}</span>
                    <input
                      type="search"
                      placeholder="Search room number…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <label className="status-select">
                    <span>Bed status</span>
                    <select
                      aria-label="Filter rooms by bed status"
                      value={status}
                      onChange={(event) => setStatus(event.target.value as StatusFilter)}
                    >
                      <option value="all">All statuses</option>
                      {statuses.map((item) => (
                        <option key={item} value={item}>
                          {statusLabels[item]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <p className="result-count" role="status">
                {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} shown
                {status !== 'all' ? ` with ${status} beds` : ''}
              </p>
              {rooms.length > 0 ? (
                <div className="room-grid">
                  {rooms.map((room) => (
                    <article className="room-card" key={room.id}>
                      <div className="room-heading">
                        <h4>Room {room.id}</h4>
                        <span>{room.beds.length} beds</span>
                      </div>
                      <div className="room-availability">
                        <i
                          className={`legend-dot ${room.beds.some((bed) => bed.status === 'available') ? 'available' : 'occupied'}`}
                        />
                        {room.beds.filter((bed) => bed.status === 'available').length} available
                      </div>
                      <div className="bed-grid">
                        {room.beds.map((bed) => (
                          <button
                            type="button"
                            key={bed.id}
                            className={`bed-tile ${bed.status} ${status !== 'all' && bed.status !== status ? 'nonmatching' : ''}`}
                            aria-label={`Room ${room.id}, bed ${bed.id}: ${statusLabels[bed.status]}. View demo details`}
                            onClick={() => setSelectedBed({ room: room.id, ...bed })}
                          >
                            <span className="bed-drawing" aria-hidden="true">
                              <span />
                            </span>
                            <strong>Bed {bed.id}</strong>
                            <small>{statusLabels[bed.status]}</small>
                          </button>
                        ))}
                      </div>
                      <div className="room-card-footer">
                        <span>Illustrative layout</span>
                        <span aria-hidden="true">↗</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">
                    <Icon name={floor.rooms.length ? 'search' : 'building'} size={30} />
                  </span>
                  <h4>{floor.rooms.length ? 'No matching rooms' : 'A little room to grow'}</h4>
                  <p>
                    {floor.rooms.length
                      ? 'Try another room number or bed status on this floor.'
                      : 'This demonstration floor has no rooms. Select another floor to explore its bed layout.'}
                  </p>
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => {
                      resetFilters();
                      if (!floor.rooms.length) setFloorId('first');
                    }}
                  >
                    {floor.rooms.length ? 'Clear filters' : 'Explore first floor'}
                  </button>
                </div>
              )}
              <div className="layout-note">
                <Icon name="bed" size={16} />
                <span>
                  Positions are illustrative and do not represent an architectural floor plan.
                </span>
              </div>
            </div>
          </div>
        </section>
        <footer className="footer-note">
          <span>Thoughtfully organised. Simply nook.</span>
          <span>Frontend demonstration · No changes are saved</span>
        </footer>
      </main>
      <dialog
        ref={dialog}
        className="bed-dialog"
        aria-labelledby="bed-title"
        aria-describedby="bed-description"
        onClose={() => setSelectedBed(null)}
      >
        {selectedBed && (
          <>
            <div className="dialog-header">
              <span className="eyebrow violet">DEMONSTRATION BED</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Close bed details"
                onClick={() => dialog.current?.close()}
                autoFocus
              >
                <Icon name="close" />
              </button>
            </div>
            <h2 id="bed-title">
              Room {selectedBed.room} · Bed {selectedBed.id}
            </h2>
            <span className={`status-pill ${selectedBed.status}`}>
              {statusLabels[selectedBed.status]}
            </span>
            <dl className="bed-details">
              <div>
                <dt>Property</dt>
                <dd>Nook House (fictional)</dd>
              </div>
              <div>
                <dt>Floor</dt>
                <dd>{floor.name}</dd>
              </div>
              <div>
                <dt>Bed reference</dt>
                <dd>
                  {selectedBed.room}-{selectedBed.id}
                </dd>
              </div>
            </dl>
            <p id="bed-description">
              This is a mock bed state for exploring the interface. No resident information is
              attached, and the status cannot be changed in this preview.
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => dialog.current?.close()}
            >
              Back to layout
            </button>
          </>
        )}
      </dialog>
    </div>
  );
}
