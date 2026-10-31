import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const required = process.env.NOOK_DATABASE_TESTS_REQUIRED === '1';

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the mandatory database test suite');
}

if (!required) {
  throw new Error(
    'NOOK_DATABASE_TESTS_REQUIRED=1 is required for the mandatory database test suite',
  );
}

const tables = [
  'organizations',
  'users',
  'memberships',
  'sessions',
  'audit_events',
  'properties',
  'floors',
  'rooms',
  'beds',
] as const;

async function expectPostgresError(
  client: Client,
  statement: string,
  values: unknown[],
  code: string,
) {
  await client.query('SAVEPOINT expected_failure');
  try {
    await client.query(statement, values);
    assert.fail(`Expected PostgreSQL error ${code}`);
  } catch (error: unknown) {
    assert.equal(
      error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined,
      code,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    await client.query('RELEASE SAVEPOINT expected_failure');
  }
}

test('initial migration creates exactly the approved tables', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
         AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    );
    assert.deepEqual(
      result.rows.map((row) => row.table_name),
      [...tables].sort(),
    );
  } finally {
    await client.end();
  }
});

test('initial migration creates the five approved active-row indexes', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [
        [
          'properties_organization_id_code_active_key',
          'floors_property_id_ordinal_active_key',
          'floors_property_id_label_active_key',
          'rooms_property_id_label_active_key',
          'beds_room_id_label_active_key',
        ],
      ],
    );
    assert.equal(result.rows.length, 5);
    for (const row of result.rows) {
      assert.match(row.indexdef, /UNIQUE INDEX/);
      assert.match(row.indexdef, /archived_at.*IS NULL/i);
    }
  } finally {
    await client.end();
  }
});

test('initial migration uses restrictive foreign keys', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_constraint
       WHERE contype = 'f'
         AND connamespace = 'public'::regnamespace
         AND confdeltype = 'r'
         AND confupdtype = 'r'`,
    );
    assert.equal(result.rows[0]?.count, '10');
  } finally {
    await client.end();
  }
});

test('active-row uniqueness permits archived-row reuse at every approved scope', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const orgId = '00000000-0000-4000-8000-000000000001';
    const otherOrgId = '00000000-0000-4000-8000-000000000002';
    const userId = '00000000-0000-4000-8000-000000000003';
    const propertyId = '00000000-0000-4000-8000-000000000004';
    const otherPropertyId = '00000000-0000-4000-8000-000000000005';
    const floorId = '00000000-0000-4000-8000-000000000006';
    const otherFloorId = '00000000-0000-4000-8000-000000000007';
    const roomId = '00000000-0000-4000-8000-000000000008';
    const otherRoomId = '00000000-0000-4000-8000-000000000009';

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO organizations (id, name, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP), ($3, $4, CURRENT_TIMESTAMP)`,
      [orgId, 'Test Organisation A', otherOrgId, 'Test Organisation B'],
    );
    await client.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, 'migration-test@example.invalid', 'hash', 'Migration Test'],
    );
    await client.query(
      `INSERT INTO memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'OWNER')`,
      [orgId, userId],
    );
    await client.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at)
       VALUES ($1, $2, 'P-1', 'Property A', CURRENT_TIMESTAMP)`,
      [propertyId, orgId],
    );
    await expectPostgresError(
      client,
      `INSERT INTO properties (organization_id, code, name, updated_at)
       VALUES ($1, 'P-1', 'Duplicate', CURRENT_TIMESTAMP)`,
      [orgId],
      '23505',
    );
    await client.query('UPDATE properties SET archived_at = CURRENT_TIMESTAMP WHERE id = $1', [
      propertyId,
    ]);
    await client.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at)
       VALUES ($1, $2, 'P-1', 'Property A Reused', CURRENT_TIMESTAMP)`,
      [otherPropertyId, orgId],
    );

    await client.query(
      `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at)
       VALUES ($1, $2, $3, 'Ground', 1, CURRENT_TIMESTAMP)`,
      [floorId, orgId, propertyId],
    );
    await expectPostgresError(
      client,
      `INSERT INTO floors (organization_id, property_id, label, ordinal, updated_at)
       VALUES ($1, $2, 'Ground Duplicate', 1, CURRENT_TIMESTAMP)`,
      [orgId, propertyId],
      '23505',
    );
    await client.query('UPDATE floors SET archived_at = CURRENT_TIMESTAMP WHERE id = $1', [
      floorId,
    ]);
    await client.query(
      `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at)
       VALUES ($1, $2, $3, 'Ground', 1, CURRENT_TIMESTAMP)`,
      [otherFloorId, orgId, propertyId],
    );

    await client.query(
      `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at)
       VALUES ($1, $2, $3, $4, 'Room 1', CURRENT_TIMESTAMP)`,
      [roomId, orgId, propertyId, otherFloorId],
    );
    await expectPostgresError(
      client,
      `INSERT INTO rooms (organization_id, property_id, floor_id, label, updated_at)
       VALUES ($1, $2, $3, 'Room 1', CURRENT_TIMESTAMP)`,
      [orgId, propertyId, otherFloorId],
      '23505',
    );
    await client.query('UPDATE rooms SET archived_at = CURRENT_TIMESTAMP WHERE id = $1', [roomId]);
    await client.query(
      `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at)
       VALUES ($1, $2, $3, $4, 'Room 1', CURRENT_TIMESTAMP)`,
      [otherRoomId, orgId, propertyId, otherFloorId],
    );

    await client.query(
      `INSERT INTO beds (organization_id, property_id, room_id, label, updated_at)
       VALUES ($1, $2, $3, 'Bed 1', CURRENT_TIMESTAMP)`,
      [orgId, propertyId, otherRoomId],
    );
    await expectPostgresError(
      client,
      `INSERT INTO beds (organization_id, property_id, room_id, label, updated_at)
       VALUES ($1, $2, $3, 'Bed 1', CURRENT_TIMESTAMP)`,
      [orgId, propertyId, otherRoomId],
      '23505',
    );
    await client.query(
      `UPDATE beds SET archived_at = CURRENT_TIMESTAMP
       WHERE room_id = $1 AND label = 'Bed 1'`,
      [otherRoomId],
    );
    await client.query(
      `INSERT INTO beds (organization_id, property_id, room_id, label, updated_at)
       VALUES ($1, $2, $3, 'Bed 1', CURRENT_TIMESTAMP)`,
      [orgId, propertyId, otherRoomId],
    );
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});

test('tenant-scoped foreign keys and restrictive deletion are enforced', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const orgId = '00000000-0000-4000-8000-000000000011';
    const otherOrgId = '00000000-0000-4000-8000-000000000012';
    const propertyId = '00000000-0000-4000-8000-000000000013';
    const otherPropertyId = '00000000-0000-4000-8000-000000000014';
    const floorId = '00000000-0000-4000-8000-000000000015';

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO organizations (id, name, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP), ($3, $4, CURRENT_TIMESTAMP)`,
      [orgId, 'Tenant A', otherOrgId, 'Tenant B'],
    );
    await client.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at)
       VALUES ($1, $2, 'A', 'Tenant A Property', CURRENT_TIMESTAMP),
              ($3, $4, 'B', 'Tenant B Property', CURRENT_TIMESTAMP)`,
      [propertyId, orgId, otherPropertyId, otherOrgId],
    );
    await expectPostgresError(
      client,
      `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at)
       VALUES ($1, $2, $3, 'Cross Tenant', 1, CURRENT_TIMESTAMP)`,
      [floorId, orgId, otherPropertyId],
      '23503',
    );
    await expectPostgresError(client, 'DELETE FROM organizations WHERE id = $1', [orgId], '23503');
    await expectPostgresError(
      client,
      'UPDATE organizations SET id = $1 WHERE id = $2',
      ['00000000-0000-4000-8000-000000000016', orgId],
      '23503',
    );
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});

test('audit events accept the approved structure', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `INSERT INTO audit_events
         (action, target_type, request_id, metadata)
       VALUES ('migration.test', 'migration', 'request-1', '{"ok":true}'::jsonb)
       RETURNING action, target_type, request_id, metadata`,
    );
    assert.deepEqual(result.rows[0], {
      action: 'migration.test',
      target_type: 'migration',
      request_id: 'request-1',
      metadata: { ok: true },
    });
  } finally {
    await client.end();
  }
});
