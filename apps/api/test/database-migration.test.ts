import './integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from 'pg';
import { withMigratorClient } from './integration/helpers/db.js';

// This suite asserts the schema produced by the FIRST migration only (nine tables, ten foreign keys, five
// active-row indexes), so it must run against a database that has just that migration, selected with
// NOOK_INTEGRATION_PROFILE=initial-migration (the preflight refuses any other table set). It also needs
// owner-level rights (DELETE and primary-key UPDATE against foreign keys), so every connection here is the
// verified MIGRATOR connection from the shared helper; nothing in this file builds its own client, and the
// preflight (opt-in, nook_integration_* name, marker, server identity, role checks, suite lock) has already
// passed before the first test is registered.
const required = process.env.NOOK_DATABASE_TESTS_REQUIRED === '1';
if (!required) {
  throw new Error(
    'NOOK_DATABASE_TESTS_REQUIRED=1 is required for the mandatory database test suite',
  );
}

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back, whether `fn` returns or throws, so no row from
 * this suite can ever be committed. (If the connection itself fails, the open transaction dies with it.)
 */
async function inRolledBackTransaction<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
  }
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
  await withMigratorClient(async (client) => {
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
  });
});

test('initial migration creates the five approved active-row indexes', async () => {
  await withMigratorClient(async (client) => {
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
  });
});

test('initial migration uses restrictive foreign keys', async () => {
  await withMigratorClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_constraint
       WHERE contype = 'f'
         AND connamespace = 'public'::regnamespace
         AND confdeltype = 'r'
         AND confupdtype = 'r'`,
    );
    assert.equal(result.rows[0]?.count, '10');
  });
});

test('active-row uniqueness permits archived-row reuse at every approved scope', async () => {
  await withMigratorClient(async (client) => {
    const orgId = '00000000-0000-4000-8000-000000000001';
    const otherOrgId = '00000000-0000-4000-8000-000000000002';
    const userId = '00000000-0000-4000-8000-000000000003';
    const propertyId = '00000000-0000-4000-8000-000000000004';
    const otherPropertyId = '00000000-0000-4000-8000-000000000005';
    const floorId = '00000000-0000-4000-8000-000000000006';
    const otherFloorId = '00000000-0000-4000-8000-000000000007';
    const roomId = '00000000-0000-4000-8000-000000000008';
    const otherRoomId = '00000000-0000-4000-8000-000000000009';

    await inRolledBackTransaction(client, async () => {
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
      await client.query('UPDATE rooms SET archived_at = CURRENT_TIMESTAMP WHERE id = $1', [
        roomId,
      ]);
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
    });
  });
});

test('tenant-scoped foreign keys and restrictive deletion are enforced', async () => {
  await withMigratorClient(async (client) => {
    const orgId = '00000000-0000-4000-8000-000000000011';
    const otherOrgId = '00000000-0000-4000-8000-000000000012';
    const propertyId = '00000000-0000-4000-8000-000000000013';
    const otherPropertyId = '00000000-0000-4000-8000-000000000014';
    const floorId = '00000000-0000-4000-8000-000000000015';

    await inRolledBackTransaction(client, async () => {
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
      await expectPostgresError(
        client,
        'DELETE FROM organizations WHERE id = $1',
        [orgId],
        '23503',
      );
      await expectPostgresError(
        client,
        'UPDATE organizations SET id = $1 WHERE id = $2',
        ['00000000-0000-4000-8000-000000000016', orgId],
        '23503',
      );
    });
  });
});

test('audit events accept the approved structure', async () => {
  await withMigratorClient(async (client) => {
    await inRolledBackTransaction(client, async () => {
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
    });
  });
});
