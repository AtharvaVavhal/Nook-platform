/**
 * Canonical permissions for Nook.
 * 
 * Non-negotiable rule 7: Permissions, not roles.
 * UI is gated on fine-grained permission identifiers, never on role-name strings.
 * 
 * Strict separations required:
 * - payment.record ≠ payment.confirm
 * - resident.read ≠ document.read
 * - finance.read ≠ data.export
 */

export const PERMISSIONS = {
  // Occupancy & floor plan
  OCCUPANCY_READ: 'occupancy.read',
  INVENTORY_MANAGE: 'inventory.manage',

  // Enquiries & admission
  ENQUIRY_READ: 'enquiry.read',
  ENQUIRY_MANAGE: 'enquiry.manage',
  ALLOCATION_CREATE: 'allocation.create',

  // Resident lifecycle & documents
  RESIDENT_READ: 'resident.read',
  RESIDENT_WRITE: 'resident.write',
  DOCUMENT_READ: 'document.read',

  // Finance & payments
  FINANCE_READ: 'finance.read',
  PAYMENT_RECORD: 'payment.record',
  PAYMENT_CONFIRM: 'payment.confirm',
  DATA_EXPORT: 'data.export',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface UserSession {
  id: string;
  name: string;
  title: string;
  organizationId: string;
  organizationName: string;
  permissions: ReadonlySet<Permission>;
}

/**
 * Check if the current session holds a specific permission.
 */
export function hasPermission(
  session: UserSession | null,
  permission: Permission
): boolean {
  if (!session) return false;
  return session.permissions.has(permission);
}

/**
 * Check if the session holds all specified permissions.
 */
export function hasAllPermissions(
  session: UserSession | null,
  permissions: Permission[]
): boolean {
  if (!session) return false;
  return permissions.every((p) => session.permissions.has(p));
}

/**
 * Check if the session holds at least one of the specified permissions.
 */
export function hasAnyPermission(
  session: UserSession | null,
  permissions: Permission[]
): boolean {
  if (!session) return false;
  return permissions.some((p) => session.permissions.has(p));
}
