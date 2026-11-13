// Role model for the interface. It mirrors what the API enforces today and nothing more: the
// MembershipRole enum has OWNER and PROPERTY_MANAGER only. STAFF and RESIDENT have no account role, no
// permissions and no API, so they are reported as "not defined" rather than given invented rights.
// This is a presentation and route-protection aid. The API remains the authority on every request.

export type WorkspaceRole = 'OWNER' | 'PROPERTY_MANAGER';
export type Experience = 'workspace' | 'unsupported';

export function isWorkspaceRole(role: string): role is WorkspaceRole {
  return role === 'OWNER' || role === 'PROPERTY_MANAGER';
}

/** Which interface a session role may enter. Anything the API does not define gets no workspace. */
export function experienceFor(role: string): Experience {
  return isWorkspaceRole(role) ? 'workspace' : 'unsupported';
}

export function roleLabel(role: string): string {
  if (role === 'OWNER') return 'Owner';
  if (role === 'PROPERTY_MANAGER') return 'Property manager';
  return 'Unsupported role';
}

export type Grant = 'allowed' | 'owner-only' | 'not-defined';

export interface MatrixRow {
  capability: string;
  owner: Grant;
  manager: Grant;
  /** Backend evidence for the row. */
  source: string;
}

/** Owner and manager columns come from the backend source; staff and resident are always not-defined. */
export const ROLE_MATRIX: readonly MatrixRow[] = [
  {
    capability: 'Properties, floors, rooms and beds',
    owner: 'allowed',
    manager: 'allowed',
    source: 'inventory.service.ts, inventory.types.ts',
  },
  {
    capability: 'Enquiries, residents, bookings, admissions, check-ins',
    owner: 'allowed',
    manager: 'allowed',
    source: 'session-scoped controllers, organization-filtered services',
  },
  {
    capability: 'Booking extension approval',
    owner: 'allowed',
    manager: 'allowed',
    source: 'booking.extension.ts EXTENSION_APPROVER_ROLES',
  },
  {
    capability: 'Invoices, payments, receipts, dues',
    owner: 'allowed',
    manager: 'allowed',
    source: 'finance.controller.ts',
  },
  {
    capability: 'Correction requests (create, withdraw)',
    owner: 'allowed',
    manager: 'allowed',
    source: 'corrections.rules.ts',
  },
  {
    capability: 'Approve or reject financial and exceptional corrections',
    owner: 'owner-only',
    manager: 'not-defined',
    source: 'corrections.rules.ts, corrections.service.ts:660',
  },
  {
    capability: 'Resolve correction finance reviews',
    owner: 'owner-only',
    manager: 'not-defined',
    source: 'corrections.service.ts:920',
  },
  {
    capability: 'Resolve transfer finance reviews',
    owner: 'owner-only',
    manager: 'not-defined',
    source: 'transfer-finance.service.ts:113',
  },
  {
    capability: 'Transfer preview and history (read-only)',
    owner: 'allowed',
    manager: 'allowed',
    source: 'transfer.controller.ts RoleGuard',
  },
  {
    capability: 'Transfer execution',
    owner: 'not-defined',
    manager: 'not-defined',
    source: 'Disabled pending owner decisions D1–D8 and rollout gate',
  },
];

export const NOT_DEFINED_ROLES = ['Staff', 'Resident'] as const;
