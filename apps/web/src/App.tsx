import { useReducer, useState } from 'react';
import { demoFloors, demoProperty, bedStatuses, statusLabels, summarize } from './propertyDemo';
import { floorPlanReducer, initialFloorPlanState } from './floorPlanState';
import { Icon, PropertyIllustration } from './components/BrandIllustration';
import { FloorPlan } from './components/FloorPlan';
import { InventoryOverview } from './components/InventoryOverview';

export function App() {
  const [state, dispatch] = useReducer(floorPlanReducer, initialFloorPlanState);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const totals = summarize(demoFloors.flatMap((floor) => floor.rooms));
  const populatedFloors = demoFloors.filter((floor) => floor.rooms.length).length;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand-lockup" href="#overview" aria-label="Nook home">
          <img
            src={`${import.meta.env.BASE_URL}brand/nook-logo-white.svg`}
            alt="nook"
            width="100"
            height="36"
          />
        </a>
        <button
          type="button"
          className="mobile-menu outline-button"
          aria-expanded={navigationOpen}
          aria-controls="workspace-navigation"
          onClick={() => setNavigationOpen(!navigationOpen)}
        >
          {navigationOpen ? 'Close menu' : 'Menu'}
          <Icon name={navigationOpen ? 'close' : 'grid'} size={18} />
        </button>
        <div className="workspace-name">
          <span className="workspace-avatar">NH</span>
          <div>
            <strong>{demoProperty.name}</strong>
            <small>Demonstration property</small>
          </div>
        </div>
        <div
          className={`workspace-navigation ${navigationOpen ? 'is-open' : ''}`}
          id="workspace-navigation"
        >
          <p className="sidebar-label">YOUR WORKSPACE</p>
          <nav aria-label="Primary navigation" onClick={() => setNavigationOpen(false)}>
            <a className="nav-item" href="#overview">
              <Icon name="building" />
              Property overview
            </a>
            <a className="nav-item" href="#floor-plan">
              <Icon name="layers" />
              Interactive floor plan
            </a>
            <a className="nav-item" href="#inventory">
              <Icon name="grid" />
              Inventory overview
            </a>
          </nav>
          <div className="planned-modules">
            <p className="sidebar-label">ON THE HORIZON</p>
            <ul>
              {['Residents', 'Booking', 'Finance', 'Operations'].map((module) => (
                <li key={module}>
                  <span>{module}</span>
                  <small>Planned</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
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
              <p className="eyebrow violet">ROOM TO BELONG</p>
              <h1 id="page-title">Property management</h1>
              <p className="page-description">The whole property. A little more clarity.</p>
            </div>
            <a className="primary-button" href="#floor-plan">
              Explore floor plan <Icon name="arrow" size={16} />
            </a>
          </div>
          <div className="property-banner">
            <div className="property-copy">
              <span className="property-kicker">YOUR DEMONSTRATION PROPERTY</span>
              <h2>{demoProperty.name}</h2>
              <p>
                <Icon name="pin" size={16} />
                {demoProperty.location}
                <span>· Fictional property</span>
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
            <span aria-hidden="true">ⓘ</span> A space to explore: every figure is synthetic demo
            data. No live property or resident records are connected.
          </p>
          <div className="summary-grid" aria-label="Demonstration property summary">
            <a className="summary-card" href="#inventory">
              <div>
                <span className="card-label">Total floors</span>
                <strong>{String(demoFloors.length).padStart(2, '0')}</strong>
                <p>
                  {populatedFloors} with rooms · {demoFloors.length - populatedFloors} empty
                </p>
              </div>
              <span className="summary-icon">
                <Icon name="layers" size={23} />
              </span>
            </a>
            <a className="summary-card" href="#inventory">
              <div>
                <span className="card-label">Total rooms</span>
                <strong>{String(totals.rooms).padStart(2, '0')}</strong>
                <p>Explore floor inventory</p>
              </div>
              <span className="summary-icon">
                <Icon name="grid" size={23} />
              </span>
            </a>
            <a className="summary-card" href="#inventory">
              <div>
                <span className="card-label">Total beds</span>
                <strong>{totals.beds}</strong>
                <p>Every bed accounted for</p>
              </div>
              <span className="summary-icon">
                <Icon name="bed" size={23} />
              </span>
            </a>
          </div>
          <div className="availability-strip">
            <span className="strip-label">Demo bed snapshot</span>
            <div className="availability-track" aria-hidden="true">
              {bedStatuses.map((status) => (
                <span key={status} className={status} style={{ flex: totals[status] }} />
              ))}
            </div>
            <div className="snapshot-labels">
              {bedStatuses.map((status) => (
                <a
                  key={status}
                  href="#floor-plan"
                  aria-label={`Explore ${totals[status]} ${status} demo beds, starting on ground floor`}
                  onClick={() => dispatch({ type: 'floor', floorId: 'ground', status })}
                >
                  <i className={`legend-dot ${status}`} aria-hidden="true" />
                  <strong>{totals[status]}</strong> {statusLabels[status]}{' '}
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
            </div>
          </div>
        </section>
        <FloorPlan state={state} dispatch={dispatch} />
        <InventoryOverview
          onExplore={(floorId, status) =>
            dispatch({ type: 'floor', floorId, ...(status ? { status } : {}) })
          }
        />
        <footer className="footer-note">
          <span>Thoughtfully organised. Simply nook.</span>
          <span>Frontend demonstration · No changes are saved</span>
        </footer>
      </main>
    </div>
  );
}
