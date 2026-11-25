import type { Prisma } from '../generated/client.js';

/** Why portal access ended, recorded on the revoked sessions and invalidated codes (same convention as ACCOUNT_SUSPENDED). */
export type ResidentAccessEndReason =
  | 'RESIDENT_INACTIVE'
  | 'RESIDENT_ARCHIVED'
  | 'PORTAL_INELIGIBLE';

/**
 * Ends every resident portal session and unused sign-in code of one resident. It takes the caller's transaction on purpose:
 * the staff action that makes a resident INACTIVE or ARCHIVED and this revocation commit together or not at all, so a
 * resident can never be left inactive with a working session because a secondary step failed.
 *
 * Scoped by organization AND resident through the account relation. It never restores anything: re-activating the resident
 * later does not bring a revoked session back; the resident signs in again with a fresh code.
 */
export async function endResidentPortalAccess(
  tx: Prisma.TransactionClient,
  scope: { organizationId: string; residentId: string },
  reason: ResidentAccessEndReason,
  now: Date = new Date(),
): Promise<void> {
  const account = { residentId: scope.residentId, organizationId: scope.organizationId };
  await tx.residentSession.updateMany({
    where: { revokedAt: null, organizationId: scope.organizationId, account },
    data: { revokedAt: now, revokedReason: reason },
  });
  await tx.residentOtpChallenge.updateMany({
    where: { consumedAt: null, invalidatedAt: null, account },
    data: { invalidatedAt: now, invalidatedReason: reason },
  });
}
