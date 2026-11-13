import { useEffect, useState, type ReactNode } from 'react';
import '../finance/finance.css';
import { useAuth } from '../auth/AuthContext';
import { ChangePasswordForm } from '../auth/ChangePasswordForm';
import { EmptyState, ErrorState, LoadingState, useAsync } from '../finance/shared';
import { Tag } from '../ops/ui';
import { opsApi } from '../ops/opsApi';
import { opsLinks } from '../ops/opsRoute';
import { NOT_DEFINED_ROLES, ROLE_MATRIX, roleLabel, type Grant } from '../access';
import {
  adminLinks,
  parseAdminRoute,
  SETTINGS_SECTIONS,
  type AdminRoute,
  type SettingsSection,
} from './adminRoute';

/**
 * Honest unavailable state. It states what is missing in the backend, so the screen can never be
 * mistaken for a working feature. Nothing here reads or writes data.
 */
function ContractUnavailable({
  title,
  summary,
  needs,
  children,
}: {
  title: string;
  summary: string;
  needs: readonly string[];
  children?: ReactNode;
}) {
  return (
    <section className="fin-card" aria-labelledby="unavailable-title">
      <div className="fin-card-head">
        <h2 id="unavailable-title">{title}</h2>
        <Tag>Not available yet</Tag>
      </div>
      <p>{summary}</p>
      <p>
        <strong>Backend contract required before this can work:</strong>
      </p>
      <ul>
        {needs.map((need) => (
          <li key={need}>{need}</li>
        ))}
      </ul>
      {children}
    </section>
  );
}

const GRANT_TEXT: Record<Grant, string> = {
  allowed: 'Allowed',
  'owner-only': 'Owner only',
  'not-defined': 'Not permitted / not defined',
};

function RoleMatrix() {
  return (
    <section className="fin-card" aria-labelledby="matrix-title">
      <h2 id="matrix-title">Role and permission matrix</h2>
      <p>
        This is what the API enforces today. Staff and Resident have no account role, so they have
        no permissions here; none are assumed.
      </p>
      <div className="profile-table-wrap">
        <table className="profile-table">
          <caption className="sr-only">Capabilities by role</caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Owner</th>
              <th scope="col">Property manager</th>
              {NOT_DEFINED_ROLES.map((role) => (
                <th scope="col" key={role}>
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX.map((row) => (
              <tr key={row.capability}>
                <th scope="row">{row.capability}</th>
                <td>{GRANT_TEXT[row.owner]}</td>
                <td>{GRANT_TEXT[row.manager]}</td>
                {NOT_DEFINED_ROLES.map((role) => (
                  <td key={role}>No role defined</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StaffAccess() {
  return (
    <>
      <ContractUnavailable
        title="Staff accounts"
        summary="Staff directory, adding or editing staff, activation and property assignment are not built, because the API has no staff role and no membership endpoints. Granting Owner or Property manager rights as a workaround is not done, and no invitation flow is simulated."
        needs={[
          'Add STAFF to the MembershipRole enum with a migration, and decide STAFF permissions (owner decision; not guessed here).',
          'Membership endpoints scoped to the session organization: list, create, update, deactivate (status ACTIVE/REVOKED already exists on Membership).',
          'Property assignment model (no Membership-to-Property relation exists today).',
          'Invitation or temporary-password provisioning contract. Existing passwordChangeRequired supports a temporary password, but no endpoint creates users.',
          'Audit read endpoint for membership events (AuditEvent rows exist; no read API).',
          'Server-side guards that enforce STAFF restrictions on every existing controller.',
        ]}
      />
      <RoleMatrix />
    </>
  );
}

function NotificationCenter() {
  return (
    <ContractUnavailable
      title="Notifications"
      summary="There is no notification store or delivery service, so there is nothing to list. No sample notifications are shown and no email, SMS, WhatsApp or push delivery is implied."
      needs={[
        'Notification model scoped by organization and recipient (category, createdAt, readAt, target record reference).',
        'GET list with pagination and unread filter; mark-read endpoint; recipient derived from the session, never from the request.',
        'Notification preference model and endpoints (only if the owner approves categories and channels).',
        'A connected delivery provider per channel before any delivery status is shown.',
      ]}
    />
  );
}

function TransferQueue({ id }: { id: string | null }) {
  return (
    <ContractUnavailable
      title={id ? 'Transfer request detail' : 'Transfer requests'}
      summary="Transfer execution is disabled and the A1 queue/detail contract is unresolved, so no queue, request detail, review or withdrawal action is shown. Preview and per-resident history remain available from the resident profile."
      needs={[
        'Approved A1 contract: list (search, filters, pagination) and get-by-id endpoints for transfer requests.',
        'Owner decisions D1–D8: requester and reviewer roles, lifecycle transitions, execution timing, cross-property and partial-transfer rules, resident consent.',
        'Stale-proposal signal from the API (current assignment version) for the stale-state banner.',
      ]}
    >
      {id ? <p>Requested record: {id}. It was not looked up.</p> : null}
      <p>
        <a href={opsLinks.residents}>
          Open a resident profile to preview a transfer or view its history
        </a>
      </p>
    </ContractUnavailable>
  );
}

function SettingsPage({ section }: { section: SettingsSection }) {
  const { state } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  const labels: Record<SettingsSection, string> = {
    organization: 'Organization',
    properties: 'Properties',
    access: 'Access',
    notifications: 'Notifications',
    billing: 'Billing',
    account: 'Account and security',
  };
  return (
    <>
      <nav className="fin-tabs" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((s) => (
          <a
            key={s}
            href={adminLinks.settings(s)}
            aria-current={s === section ? 'page' : undefined}
          >
            {labels[s]}
          </a>
        ))}
      </nav>
      {section === 'organization' ? (
        <section className="fin-card" aria-labelledby="org-title">
          <h2 id="org-title">Organization profile</h2>
          <dl className="ops-kv">
            <dt>Name</dt>
            <dd>{user?.organization.name ?? '—'}</dd>
            <dt>Your role</dt>
            <dd>{user ? roleLabel(user.role) : '—'}</dd>
          </dl>
          <p>
            Read-only. The API has no endpoint to edit organization details (contact, address, tax
            identifiers); adding one is a backend change.
          </p>
        </section>
      ) : null}
      {section === 'properties' ? <PropertySettings /> : null}
      {section === 'access' ? <StaffAccess /> : null}
      {section === 'notifications' ? (
        <ContractUnavailable
          title="Notification preferences"
          summary="No preference storage or delivery service exists. Toggles are not shown, because they would save nothing."
          needs={[
            'Preference model and endpoints (see Notifications), pending owner approval of categories and channels.',
          ]}
        />
      ) : null}
      {section === 'billing' ? (
        <ContractUnavailable
          title="Billing configuration"
          summary="No billing settings endpoint exists. Tax (GST), due-date, late-fee and cancellation rules are owner policy decisions and are not entered, defaulted or implied here."
          needs={[
            'Organization billing-settings model and endpoints, after the owner approves each policy.',
            'Existing invoice behaviour is unchanged and is managed on the Finance screens.',
          ]}
        />
      ) : null}
      {section === 'account' ? (
        <section className="fin-card" aria-labelledby="account-title">
          <h2 id="account-title">Account and security</h2>
          <dl className="ops-kv">
            <dt>Signed in as</dt>
            <dd>{user?.displayName ?? '—'}</dd>
          </dl>
          <h3>Change password</h3>
          <p>Your other signed-in devices will be signed out.</p>
          <ChangePasswordPanel />
          <p>
            Session lists, two-factor authentication and login history have no API and are not
            shown.
          </p>
        </section>
      ) : null}
    </>
  );
}

/** The password form with a visible result: it is cleared and a confirmation is shown once the change succeeded. */
function ChangePasswordPanel() {
  const [done, setDone] = useState(0);
  return (
    <>
      {done > 0 ? (
        <p className="auth-notice" role="status">
          Password changed. Your other signed-in devices were signed out.
        </p>
      ) : null}
      <ChangePasswordForm key={done} forced={false} onDone={() => setDone((n) => n + 1)} />
    </>
  );
}

function PropertySettings() {
  const properties = useAsync(() => opsApi.inventory.properties.list(), []);
  return (
    <section className="fin-card" aria-labelledby="prop-title">
      <div className="fin-card-head">
        <h2 id="prop-title">Property configuration</h2>
        <a className="outline-button" href={opsLinks.properties}>
          Manage properties
        </a>
      </div>
      {properties.loading ? <LoadingState label="Loading properties…" /> : null}
      {properties.error ? (
        <ErrorState message={properties.error} onRetry={properties.reload} />
      ) : null}
      {properties.data && properties.data.length === 0 ? (
        <EmptyState
          title="No properties yet"
          hint="Add a property to start configuring floors, rooms and beds."
        />
      ) : null}
      {properties.data && properties.data.length > 0 ? (
        <ul>
          {properties.data.map((p) => (
            <li key={p.id}>
              <a href={opsLinks.property(p.id)}>{p.name}</a> ({p.code}){' '}
              {p.archivedAt ? <Tag>Archived</Tag> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const HEADINGS: Record<AdminRoute['name'], { title: string; lede: string }> = {
  settings: { title: 'Settings', lede: 'Organization, properties, access and account.' },
  staff: {
    title: 'Staff and access',
    lede: 'Who can use this workspace, and what each role may do.',
  },
  notifications: {
    title: 'Notifications',
    lede: 'Updates about bookings, payments and documents.',
  },
  transfers: { title: 'Transfers', lede: 'Transfer requests. Execution is disabled.' },
  transfer: { title: 'Transfers', lede: 'Transfer requests. Execution is disabled.' },
};

export function AdminShell() {
  const [route, setRoute] = useState<AdminRoute>(() => parseAdminRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseAdminRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const head = HEADINGS[route.name];
  return (
    <div className="fin-shell">
      <div className="fin-page-head">
        <p className="eyebrow violet">WORKSPACE</p>
        <h1>{head.title}</h1>
        <p className="fin-lede">{head.lede}</p>
      </div>
      {route.name === 'settings' ? <SettingsPage section={route.section} /> : null}
      {route.name === 'staff' ? <StaffAccess /> : null}
      {route.name === 'notifications' ? <NotificationCenter /> : null}
      {route.name === 'transfers' ? <TransferQueue id={null} /> : null}
      {route.name === 'transfer' ? <TransferQueue id={route.id} /> : null}
    </div>
  );
}
