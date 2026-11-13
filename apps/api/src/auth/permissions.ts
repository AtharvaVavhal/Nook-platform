import { SetMetadata } from '@nestjs/common';

/**
 * Route permission model (default deny).
 *
 * Every HTTP route must declare exactly one access kind; a route that declares none is refused by the
 * global AccessGuard. The role-to-permission table below is the single place that decides which role may
 * use which permission. It is a fixed, in-code table (no per-member grants).
 *
 * Step 0 of the STAFF milestone: OWNER and PROPERTY_MANAGER hold every permission, which reproduces the
 * behavior the application had before this layer existed (their finer rules — for example OWNER-only
 * financial approvals — are still enforced where they always were, in the services). Any other role value is
 * denied every permission.
 */
export const PERMISSIONS = [
  // inventory
  'inventory.read',
  'inventory.write',
  // sales
  'enquiry.read',
  'enquiry.write',
  'enquiry.convert',
  'enquiry.delete',
  // residents
  'resident.read',
  'resident.write',
  'resident.delete',
  'resident.history.read',
  'stay.summary.read',
  // bookings
  'booking.read',
  'booking.write',
  'booking.extend',
  'booking.cancel',
  // admissions and stays
  'admission.read',
  'admission.write',
  'admission.delete',
  'checkin.read',
  'checkin.write',
  // finance
  'finance.read',
  'finance.invoice.write',
  'finance.payment.record',
  'finance.adjust',
  // lifecycle corrections
  'correction.read',
  'correction.submit',
  'correction.review',
  'correction.finance',
  // transfers
  'transfer.read',
  'transfer.execute',
  'transfer.finance',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Roles that exist in the database today. A role not in this table has no permissions at all. */
const ROLE_PERMISSIONS: ReadonlyMap<string, ReadonlySet<Permission>> = new Map([
  ['OWNER', new Set<Permission>(PERMISSIONS)],
  ['PROPERTY_MANAGER', new Set<Permission>(PERMISSIONS)],
]);

/** Default deny: unknown, missing or inherited-looking role names (`constructor`, `__proto__`) get nothing. */
export function roleHasPermission(role: string | undefined, permission: Permission): boolean {
  if (typeof role !== 'string') return false;
  return ROLE_PERMISSIONS.get(role)?.has(permission) === true;
}

export function permissionsForRole(role: string | undefined): readonly Permission[] {
  if (typeof role !== 'string') return [];
  return [...(ROLE_PERMISSIONS.get(role) ?? [])];
}

export const ROUTE_ACCESS_KEY = 'nook:route-access';

export type RouteAccess =
  | { readonly kind: 'public' }
  | { readonly kind: 'self' }
  | { readonly kind: 'permission'; readonly permission: Permission };

/** No session required (health, login, CSRF token). Use sparingly; every use is visible in the route inventory test. */
export const Public = () => SetMetadata(ROUTE_ACCESS_KEY, { kind: 'public' } satisfies RouteAccess);

/** A valid session is enough, for any role: the caller acts only on their own account (me, logout, password). */
export const SelfService = () =>
  SetMetadata(ROUTE_ACCESS_KEY, { kind: 'self' } satisfies RouteAccess);

/** The caller's role must hold this permission. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(ROUTE_ACCESS_KEY, { kind: 'permission', permission } satisfies RouteAccess);
