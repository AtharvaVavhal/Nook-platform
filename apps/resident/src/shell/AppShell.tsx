import { useEffect, useRef, type ReactNode } from 'react';
import { useProfile } from '../auth/AuthContext.js';
import { sectionOf, titleOf, type Route } from '../lib/route.js';
import { Icon } from '../ui/Icon.js';
import { Logo } from '../ui/Logo.js';
import { NAV } from './nav.js';
import { ProfileMenu } from './ProfileMenu.js';

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const profile = useProfile();
  const section = sectionOf(route);
  const first = useRef(true);

  // On every screen change: update the tab title, and move focus to the new page heading (not on the first load).
  useEffect(() => {
    document.title = `${titleOf(route)} · Nook`;
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('page-title')?.focus({ preventScroll: false });
    window.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="rp-shell">
      <a
        className="rp-skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>

      <aside className="rp-sidebar">
        <a className="rp-sidebar__logo" href="#/" aria-label="Nook home">
          <Logo height={28} label="Nook" />
        </a>
        <nav className="rp-nav" aria-label="Primary">
          {NAV.map((item) => (
            <a
              key={item.section}
              className="rp-nav__link"
              href={item.href}
              {...(item.section === section ? { 'aria-current': 'page' as const } : {})}
            >
              <Icon name={item.icon} />
              {item.label}
            </a>
          ))}
        </nav>
        <div className="rp-sidebar__foot rp-wrap">{profile.organizationName}</div>
      </aside>

      <div className="rp-frame">
        <header className="rp-topbar">
          <a className="rp-topbar__logo" href="#/" aria-label="Nook home">
            <Logo height={24} label="Nook" />
          </a>
          <ProfileMenu />
        </header>
        <main id="main" className="rp-main" tabIndex={-1}>
          <div className="rp-content">{children}</div>
        </main>
      </div>

      <nav className="rp-bottomnav" aria-label="Primary">
        {NAV.map((item) => (
          <a
            key={item.section}
            className="rp-bottomnav__link"
            href={item.href}
            aria-label={item.label}
            {...(item.section === section ? { 'aria-current': 'page' as const } : {})}
          >
            <span className="rp-bottomnav__icon">
              <Icon name={item.icon} />
            </span>
            <span aria-hidden="true">{item.short}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
