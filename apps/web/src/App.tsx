import { useReducer, useState, useEffect } from 'react';
import { demoFloors, demoProperty, bedStatuses, statusLabels, summarize } from './propertyDemo';
import { floorPlanReducer, initialFloorPlanState } from './floorPlanState';
import { Icon, PropertyIllustration } from './components/BrandIllustration';
import { FloorPlan } from './components/FloorPlan';
import { InventoryOverview } from './components/InventoryOverview';
import { FinanceShell } from './finance/FinanceShell';
import { isFinanceHash } from './finance/financeRoute';
import { isOpsHash, parseOpsRoute, opsLinks } from './ops/opsRoute';
import { ResidentList, ResidentNew, ResidentDetail } from './ops/Residents';
import {
  PropertyList, PropertyNew, PropertyDetail,
  FloorList, FloorNew, FloorDetail,
  RoomList, RoomNew, RoomDetail,
  BedList, BedNew, BedDetail,
} from './ops/Inventory';
import { EnquiryList, EnquiryNew, EnquiryDetail } from './ops/Enquiries';
import { BookingList, BookingNew } from './ops/Bookings';
import { AdmissionPanel } from './ops/Admissions';
import { CheckInList, CheckInNew, CheckInDetail } from './ops/CheckIns';
import { UserMenu } from './auth/UserMenu';
import { useAuth } from './auth/AuthContext';
import { DemoBadge } from './components/DemoBadge';

export function App() {
  const [state, dispatch] = useReducer(floorPlanReducer, initialFloorPlanState);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [financeView, setFinanceView] = useState(() => isFinanceHash(window.location.hash));
  const [opsView, setOpsView] = useState(() => isOpsHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setFinanceView(isFinanceHash(window.location.hash));
      setOpsView(isOpsHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const { state: auth } = useAuth();
  const organizationName = auth.status === 'authenticated' ? auth.user.organization.name : '';
  const roleLabel =
    auth.status === 'authenticated'
      ? auth.user.role === 'OWNER'
        ? 'Owner'
        : 'Property manager'
      : '';
  const initials = organizationName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
  const totals = summarize(demoFloors.flatMap((floor) => floor.rooms));
  const populatedFloors = demoFloors.filter((floor) => floor.rooms.length).length;
  const opsRoute = opsView ? parseOpsRoute(window.location.hash) : null;
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
          <span className="workspace-avatar">{initials || 'N'}</span>
          <div>
            <strong>{organizationName}</strong>
            <small>{roleLabel}</small>
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
              <a className="nav-item" href={opsLinks.admissions}>
                <Icon name="layers" />
                Admissions
              </a>
              <a className="nav-item" href={opsLinks.properties}>
                <Icon name="grid" />
                Properties
              </a>
              <a className="nav-item" href={opsLinks.residents}>
                <Icon name="layers" />
                Residents
              </a>
              <a className="nav-item" href={opsLinks.enquiries}>
                <Icon name="layers" />
                Enquiries
              </a>
              <a className="nav-item" href={opsLinks.bookings}>
                <Icon name="layers" />
                Bookings
              </a>
              <a className="nav-item" href={opsLinks.checkIns}>
                <Icon name="layers" />
                Check-ins
              </a>
              <a className="nav-item" href="#finance" aria-current={financeView ? 'page' : undefined}>
                <Icon name="layers" />
                Finance
              </a>
            </nav>
            <div className="planned-modules">
              <p className="sidebar-label">ON THE HORIZON</p>
              <ul>
                {['Booking', 'Operations'].map((module) => (
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
      </aside>
      <main className="main-content" id="main" tabIndex={-1}>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <Icon name="arrow" size={13} />
            <span>Property management</span>
          </div>
          <div className="topbar-actions">
            <UserMenu />
          </div>
        </header>
        {financeView ? (
          <FinanceShell />
        ) : opsView ? (
          (() => {
            const r = opsRoute;
            if (!r) return <ResidentList />;
            if (r.name === 'resident-new') return <ResidentNew />;
            if (r.name === 'resident') return <ResidentDetail id={r.id} />;
            if (r.name === 'properties') return <PropertyList />;
            if (r.name === 'property') return <PropertyDetail id={r.id} />;
            if (r.name === 'floors') return <FloorList propertyId={r.propertyId} />;
            if (r.name === 'floor') return <FloorDetail propertyId={r.propertyId} id={r.id} />;
            if (r.name === 'rooms') return <RoomList propertyId={r.propertyId} />;
            if (r.name === 'room') return <RoomDetail propertyId={r.propertyId} id={r.id} />;
            if (r.name === 'beds') return <BedList roomId={r.roomId} />;
            if (r.name === 'enquiries') return <EnquiryList />;
            if (r.name === 'enquiry-new') return <EnquiryNew />;
            if (r.name === 'enquiry') return <EnquiryDetail id={r.id} />;
            if (r.name === 'bookings' || r.name === 'booking') return <BookingList />;
            if (r.name === 'booking-new') return <BookingNew />;
            if (r.name === 'admissions' || r.name === 'admission') return <AdmissionPanel />;
            if (r.name === 'check-ins') return <CheckInList />;
            if (r.name === 'check-in-new') return <CheckInNew />;
            if (r.name === 'check-in') return <CheckInDetail id={r.id} />;
            return <ResidentList />;
          })()
        ) : (
          <>
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
                  <h2>
                    {demoProperty.name} <DemoBadge />
                  </h2>
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
            <InventoryOverview />
            <AdmissionPanel />
          </>
        )}
        <footer className="footer-note">
          <span>Thoughtfully organised. Simply nook.</span>
          {financeView ? null : (
            <span>
              Sections marked DEMO DATA are samples. Admissions and finance use your real records.
            </span>
          )}
        </footer>
      </main>
    </div>
  );
}
