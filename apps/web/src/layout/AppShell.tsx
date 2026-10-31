import { useState, type ReactNode } from 'react';
import { useAuth, type PersonaId } from '../auth/AuthContext';
import { useRouter, Link } from '../router/RouterContext';
import { APP_ROUTES, type RouteConfig } from '../router/routes';
import { Icon } from '../components/BrandIllustration';
import { ThemeToggle } from '../components/ThemeToggle';

export function AppShell({ children }: { children: ReactNode }) {
  const { session, activePersonaId, availablePersonas, setPersona, can } = useAuth();
  const { currentPath } = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Filter routes visible to the active persona
  const visibleRoutes = APP_ROUTES.filter((route: RouteConfig) => {
    if (activePersonaId === 'public') {
      return route.id === 'public';
    }
    if (route.publicOnly) {
      return false;
    }
    if (route.requiredPermission && !can(route.requiredPermission)) {
      return false;
    }
    return true;
  });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <Link to="#/overview" className="brand-lockup" aria-label="Nook home">
          <img
            src={`${import.meta.env.BASE_URL}brand/nook-logo-white.svg`}
            alt="nook"
            width="100"
            height="36"
          />
        </Link>

        {/* Mobile menu trigger */}
        <button
          type="button"
          className="mobile-menu outline-button"
          aria-expanded={mobileMenuOpen}
          aria-controls="workspace-navigation"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? 'Close menu' : 'Menu'}
          <Icon name={mobileMenuOpen ? 'close' : 'grid'} size={18} />
        </button>

        {/* Workspace Organization & Persona Switcher */}
        <div className="workspace-name">
          <span className="workspace-avatar">
            {session ? session.name.split(' ').map((n) => n[0]).join('').slice(0, 2) : 'PB'}
          </span>
          <div className="workspace-info">
            <strong>{session ? session.organizationName : 'Public Access'}</strong>
            <small>{session ? session.title : 'Prospective Resident'}</small>
          </div>
        </div>

        {/* Persona Switcher for Development & Demonstration */}
        <div className="persona-selector-box">
          <label htmlFor="persona-select" className="sidebar-label">
            ACTIVE ROLE (DEMO)
          </label>
          <select
            id="persona-select"
            className="persona-select"
            value={activePersonaId}
            onChange={(e) => setPersona(e.target.value as PersonaId)}
            aria-label="Switch active demonstration role"
          >
            {availablePersonas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Navigation list */}
        <div
          className={`workspace-navigation ${mobileMenuOpen ? 'is-open' : ''}`}
          id="workspace-navigation"
        >
          <p className="sidebar-label">NAVIGATION</p>
          <nav aria-label="Primary navigation" onClick={() => setMobileMenuOpen(false)}>
            {visibleRoutes.map((route) => {
              const isActive = currentPath === route.path || currentPath.startsWith(`${route.path}/`);
              return (
                <Link
                  key={route.id}
                  to={route.path}
                  className={`nav-item ${isActive ? 'is-active' : ''}`}
                >
                  <Icon name={route.iconName} />
                  <span>{route.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* On the Horizon badge section for unbuilt backend domains */}
          {activePersonaId !== 'public' && (
            <div className="planned-modules">
              <p className="sidebar-label">ON THE HORIZON</p>
              <ul>
                {['Biometric Check-in', 'Auto Bank Reconciliation', 'GST E-Invoicing'].map(
                  (feature) => (
                    <li key={feature}>
                      <span>{feature}</span>
                      <small>Planned</small>
                    </li>
                  )
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Theme toggle & footer */}
        <div className="sidebar-bottom">
          <ThemeToggle />
          <div className="sidebar-footer">
            <span className="demo-dot" />
            Demonstration workspace
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content" id="main" tabIndex={-1}>
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="arrow" size={13} />
            <span className="breadcrumb-current">
              {visibleRoutes.find((r) => currentPath.startsWith(r.path))?.label ?? 'Overview'}
            </span>
          </div>

          <div className="topbar-meta">
            <span className="persona-badge">
              Role: <strong>{availablePersonas.find((p) => p.id === activePersonaId)?.label}</strong>
            </span>
            <span className="environment-badge">DEMO DATA</span>
          </div>
        </header>

        <div className="main-viewport">{children}</div>

        <footer className="footer-note">
          <span>Thoughtfully organised. Simply nook.</span>
          <span>Frontend foundation · Integer paise currency · Permission-gated UI</span>
        </footer>
      </main>
    </div>
  );
}
