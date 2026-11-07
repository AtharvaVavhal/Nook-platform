// Give an existing user a new random temporary password and end all of their sessions.
//   node --import tsx scripts/ops/reset-password.ts --confirm-target host:port/db --email a@b.in
import { PasswordHasher } from '../../apps/api/src/auth/password-hasher.js';
import { throttleKeyHash } from '../../apps/api/src/auth/auth-security.js';
import {
  audit,
  connect,
  fail,
  normalizeEmail,
  parseOpsArgs,
  randomTemporaryPassword,
  showOnce,
} from './ops-lib.js';

const args = parseOpsArgs({ email: { type: 'string' } });
const email = normalizeEmail(args.email);
const { client } = await connect(args);
const temporary = randomTemporaryPassword();
const passwordHash = await new PasswordHasher().hash(temporary);
try {
  await client.query('BEGIN');
  const user = await client.query(
    `SELECT id, status FROM users WHERE login_identifier = $1 FOR UPDATE`,
    [email],
  );
  if (!user.rowCount) fail('no user has this e-mail address');
  const userId = user.rows[0].id as string;
  await client.query(
    `UPDATE users SET password_hash = $2, password_change_required = true, updated_at = now() WHERE id = $1`,
    [userId, passwordHash],
  );
  const revoked = await client.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  // clear any sign-in lock so the user can actually use the new temporary password
  await client.query(
    `UPDATE login_throttles SET failures = 0, locked_until = NULL, updated_at = now() WHERE scope = 'IDENTIFIER' AND key_hash = $1`,
    [throttleKeyHash('IDENTIFIER', email)],
  );
  const org = await client.query(
    `SELECT organization_id FROM memberships WHERE user_id = $1 ORDER BY status, created_at LIMIT 1`,
    [userId],
  );
  await audit(client, 'auth.password.reset', {
    organizationId: org.rows[0]?.organization_id ?? null,
    targetUserId: userId,
    metadata: { revokedSessions: revoked.rowCount },
  });
  await client.query('COMMIT');
  console.log(`Password reset for ${email}; ${revoked.rowCount} active session(s) ended.`);
  showOnce(email, temporary);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
