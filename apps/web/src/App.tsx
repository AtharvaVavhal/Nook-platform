import { useState, useEffect } from 'react';
import { Icon } from './components/BrandIllustration';
import { InventoryOverview } from './components/InventoryOverview';
import { FinanceShell } from './finance/FinanceShell';
import { isFinanceHash } from './finance/financeRoute';
import { isOpsHash, parseOpsRoute, opsLinks, correctionsLinks } from './ops/opsRoute';
import { OpsShell } from './ops/OpsShell';
import { AdminShell } from './admin/AdminShell';
import { adminLinks, isAdminHash, parseAdminRoute } from './admin/adminRoute';
import { roleLabel as describeRole } from './access';
import { AdmissionPanel } from './ops/Admissions';
import { UserMenu } from './auth/UserMenu';
import { useAuth } from './auth/AuthContext';
import { OwnerDashboard } from './dashboard/OwnerDashboard';
import { parseOverviewHash } from './dashboard/overviewRoute';

export function App() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [hash, setHash] = useState(() => window.location.hash);
  const financeView = isFinanceHash(hash);
  const opsView = isOpsHash(hash);
  const adminView = isAdminHash(hash);
  const adminRoute = adminView ? parseAdminRoute(hash).name : '';
  const opsRoute = opsView ? parseOpsRoute(hash).name : '';
  const section = adminView
    ? adminRoute === 'transfer'
      ? 'transfers'
      : adminRoute
    : financeView
      ? 'finance'
      : /^(propert|floor|room|bed)/.test(opsRoute)
        ? 'properties'
        : /^(enquir|overdue|upcoming)/.test(opsRoute)
          ? 'enquiries'
          : opsRoute.startsWith('resident')
            ? 'residents'
            : opsRoute.startsWith('booking')
              ? 'bookings'
              : opsRoute.startsWith('admission')
                ? 'admissions'
                : opsRoute.startsWith('check-in')
                  ? 'check-ins'
                  : opsRoute
                    ? 'corrections'
                    : parseOverviewHash(hash).section;
  const sectionLabel =
    section === 'overview'
      ? 'Dashboard'
      : section === 'inventory'
        ? 'Inventory overview'
        : section.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
  useEffect(() => {
    const onHash = () => {
      setHash(window.location.hash);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const { state: auth } = useAuth();
  const organizationName = auth.status === 'authenticated' ? auth.user.organization.name : '';
  const roleLabel = auth.status === 'authenticated' ? describeRole(auth.user.role) : '';
  const initials = organizationName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
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
            <a
              className="nav-item"
              href="#overview"
              aria-current={section === 'overview' ? 'page' : undefined}
            >
              <Icon name="building" />
              Dashboard
            </a>
            <a
              className="nav-item"
              href="#inventory"
              aria-current={section === 'inventory' ? 'page' : undefined}
            >
              <Icon name="grid" />
              Inventory overview
            </a>
            <a
              className="nav-item"
              href={opsLinks.admissions}
              aria-current={section === 'admissions' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Admissions
            </a>
            <a
              className="nav-item"
              href={opsLinks.properties}
              aria-current={section === 'properties' ? 'page' : undefined}
            >
              <Icon name="grid" />
              Properties
            </a>
            <a
              className="nav-item"
              href={opsLinks.residents}
              aria-current={section === 'residents' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Residents
            </a>
            <a
              className="nav-item"
              href={opsLinks.enquiries}
              aria-current={section === 'enquiries' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Enquiries
            </a>
            <a
              className="nav-item"
              href={opsLinks.bookings}
              aria-current={section === 'bookings' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Bookings
            </a>
            <a
              className="nav-item"
              href={opsLinks.checkIns}
              aria-current={section === 'check-ins' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Check-ins
            </a>
            <a
              className="nav-item"
              href={correctionsLinks.list}
              aria-current={section === 'corrections' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Corrections
            </a>
            <a className="nav-item" href="#finance" aria-current={financeView ? 'page' : undefined}>
              <Icon name="layers" />
              Finance
            </a>
            <a
              className="nav-item"
              href={adminLinks.transfers}
              aria-current={section === 'transfers' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Transfers
            </a>
            <a
              className="nav-item"
              href={adminLinks.notifications}
              aria-current={section === 'notifications' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Notifications
            </a>
            <a
              className="nav-item"
              href={adminLinks.staff}
              aria-current={section === 'staff' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Staff and access
            </a>
            <a
              className="nav-item"
              href={adminLinks.settings()}
              aria-current={section === 'settings' ? 'page' : undefined}
            >
              <Icon name="layers" />
              Settings
            </a>
          </nav>
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
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <a href="#overview">Workspace</a> <Icon name="arrow" size={13} />
            <span aria-current="page">{sectionLabel}</span>
          </nav>
          <div className="topbar-actions">
            <UserMenu />
          </div>
        </header>
        {adminView ? (
          <AdminShell />
        ) : financeView ? (
          <FinanceShell />
        ) : opsView ? (
          <OpsShell />
        ) : (
          <>
            <OwnerDashboard hash={hash} />
            <InventoryOverview />
            <AdmissionPanel />
          </>
        )}
        <footer className="footer-note">
          <span>Thoughtfully organised. Simply nook.</span>
        </footer>
      </main>
    </div>
  );
}
