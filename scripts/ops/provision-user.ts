// Create a user (and optionally the organization) with a random temporary password.
//   node --import tsx scripts/ops/provision-user.ts --confirm-target host:port/db \
//        --email a@b.in --name "Meera Iyer" --role OWNER (--org-id <uuid> | --create-org "Hostel name")
import { PasswordHasher } from '../../apps/api/src/auth/password-hasher.js';
import {
  ROLES,
  audit,
  connect,
  fail,
  normalizeEmail,
  parseOpsArgs,
  randomTemporaryPassword,
  showOnce,
} from './ops-lib.js';

const args = parseOpsArgs({
  email: { type: 'string' },
  name: { type: 'string' },
  role: { type: 'string' },
  'org-id': { type: 'string' },
  'create-org': { type: 'string' },
});
const email = normalizeEmail(args.email);
const name = (args.name ?? '').trim();
if (name.length < 1 || name.length > 100) fail('--name is required (1 to 100 characters)');
if (!ROLES.includes(args.role as never)) fail(`--role must be one of ${ROLES.join(', ')}`);
if (Boolean(args['org-id']) === Boolean(args['create-org']))
  fail('give exactly one of --org-id or --create-org');
const newOrgName = (args['create-org'] ?? '').trim();
if (args['create-org'] !== undefined && (newOrgName.length < 1 || newOrgName.length > 100))
  fail('--create-org needs a name (1 to 100 characters)');

const { client } = await connect(args);
const temporary = randomTemporaryPassword();
const passwordHash = await new PasswordHasher().hash(temporary);
try {
  await client.query('BEGIN');
  if ((await client.query('SELECT 1 FROM users WHERE login_identifier = $1', [email])).rowCount) {
    fail(
      'a user with this e-mail already exists; use reset-password.ts to give them a new temporary password',
    );
  }
  let organizationId = args['org-id'] ?? '';
  let organizationName = newOrgName;
  if (args['org-id']) {
    const org = await client.query('SELECT id, name, status FROM organizations WHERE id = $1', [
      args['org-id'],
    ]);
    if (!org.rowCount || org.rows[0].status !== 'ACTIVE')
      fail('--org-id does not match an ACTIVE organization');
    organizationId = org.rows[0].id;
    organizationName = org.rows[0].name;
  } else {
    organizationId = (
      await client.query(
        `INSERT INTO organizations (name, updated_at) VALUES ($1, now()) RETURNING id`,
        [newOrgName],
      )
    ).rows[0].id;
  }
  const userId = (
    await client.query(
      `INSERT INTO users (login_identifier, password_hash, display_name, password_change_required, updated_at)
       VALUES ($1, $2, $3, true, now()) RETURNING id`,
      [email, passwordHash, name],
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
    [organizationId, userId, args.role],
  );
  await audit(client, 'auth.user.provisioned', {
    organizationId,
    targetUserId: userId,
    metadata: { role: args.role, createdOrganization: Boolean(args['create-org']) },
  });
  await client.query('COMMIT');
  console.log(`Provisioned ${email} as ${args.role} in "${organizationName}" (${organizationId}).`);
  showOnce(email, temporary);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
