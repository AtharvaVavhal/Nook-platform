// Remove a person's access to an organization: revoke the membership and end their sessions there.
//   node --import tsx scripts/ops/revoke-access.ts --confirm-target host:port/db --email a@b.in [--org-id <uuid>]
import { audit, connect, fail, normalizeEmail, parseOpsArgs } from './ops-lib.js';

const args = parseOpsArgs({ email: { type: 'string' }, 'org-id': { type: 'string' } });
const email = normalizeEmail(args.email);
const { client } = await connect(args);
try {
  await client.query('BEGIN');
  const user = await client.query(`SELECT id FROM users WHERE login_identifier = $1 FOR UPDATE`, [
    email,
  ]);
  if (!user.rowCount) fail('no user has this e-mail address');
  const userId = user.rows[0].id as string;
  const active = await client.query(
    `SELECT organization_id FROM memberships WHERE user_id = $1 AND status = 'ACTIVE'`,
    [userId],
  );
  if (!active.rowCount) fail('this user has no active membership');
  let organizationId = args['org-id'];
  if (!organizationId) {
    if (active.rowCount! > 1) fail('this user belongs to several organizations; pass --org-id');
    organizationId = active.rows[0].organization_id as string;
  }
  const revokedMembership = await client.query(
    `UPDATE memberships SET status = 'REVOKED', revoked_at = now() WHERE user_id = $1 AND organization_id = $2 AND status = 'ACTIVE'`,
    [userId, organizationId],
  );
  if (!revokedMembership.rowCount) fail('no active membership in that organization');
  const sessions = await client.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'access_revoked' WHERE user_id = $1 AND active_organization_id = $2 AND revoked_at IS NULL`,
    [userId, organizationId],
  );
  await audit(client, 'auth.access.revoked', {
    organizationId,
    targetUserId: userId,
    metadata: { revokedSessions: sessions.rowCount },
  });
  await client.query('COMMIT');
  console.log(
    `Access revoked for ${email} in organization ${organizationId}; ${sessions.rowCount} session(s) ended.`,
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
