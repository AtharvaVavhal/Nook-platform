import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import {
  readSchema,
  verifySchemaFacts,
  readPrivileges,
  verifyPrivileges,
  TARGET,
} from '../ci/g6b-preflight.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { snapshotLegacy } from './phase4-upgrade.mjs';

const prisma = new PrismaService();
test.after(async () => prisma.onModuleDestroy());
test('fresh or upgraded schema has exact constraints, indexes, functions, privileges and ordered migration ledger', async () => {
  await withMigratorClient(async (db) => {
    verifySchemaFacts(await readSchema(db));
    verifyPrivileges(await readPrivileges(db, TARGET.runtime), TARGET.runtime);
    const manifest = JSON.parse(readFileSync('scripts/ci/g6b-migrations.json', 'utf8')).migrations;
    const rows = (
      await db.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at,id',
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => ({ name: r.migration_name, checksum: r.checksum })),
      manifest,
    );
    assert.ok(rows.every((r) => r.finished_at && !r.rolled_back_at));
    if (process.env.NOOK_UPGRADE_SNAPSHOT) {
      const snapshot = JSON.parse(process.env.NOOK_UPGRADE_SNAPSHOT);
      assert.deepEqual(await snapshotLegacy(db, snapshot.tables), snapshot.before);
      for (const table of [
        'stay_assignments',
        'transfers',
        'stay_assignment_replacements',
        'correction_proposals',
        'transfer_finance_reviews',
      ]) {
        assert.equal(
          (await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
          0,
          'Migration must not adopt stays or execute business commands',
        );
      }
    }
  });
});

test('Prisma runtime preserves PostgreSQL startup options across pooled connections and rollback', async () => {
  const saved = process.env.DATABASE_URL!;
  const url = new URL(saved);
  url.searchParams.set('options', '-c statement_timeout=1234 -c timezone=Asia/Kolkata');
  process.env.DATABASE_URL = url.href;
  const configured = new PrismaService();
  try {
    const query = () =>
      configured.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ timeout: string; zone: string; pid: number }>
        >`SELECT current_setting('statement_timeout') AS timeout,current_setting('TimeZone') AS zone,pg_backend_pid() AS pid`;
        await tx.$executeRaw`SELECT pg_sleep(0.05)`;
        assert.equal(rows[0].timeout, '1234ms');
        assert.equal(rows[0].zone, 'Asia/Kolkata');
        return rows[0].pid;
      });
    const pids = await Promise.all([query(), query(), query()]);
    assert.equal(new Set(pids).size, 3);
    await assert.rejects(
      configured.db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout='50ms'`;
        await tx.$executeRaw`SELECT pg_sleep(0.2)`;
      }),
    );
    await query();
  } catch (error) {
    console.log(
      JSON.stringify({
        probe: 'pool-options-failure',
        code: (error as { code?: string }).code ?? 'ASSERTION',
      }),
    );
    throw error;
  } finally {
    process.env.DATABASE_URL = saved;
    await configured.onModuleDestroy();
  }
});

test('runtime reads legacy commercial history without adoption or transfer activation', async () => {
  const before = await prisma.db.booking.findMany({
    select: { id: true, bedId: true, monthlyPrice: true },
  });
  assert.ok(Array.isArray(before));
  if (process.env.NOOK_UPGRADE_SNAPSHOT) {
    assert.equal(before.length, 2);
    assert.equal((await prisma.db.checkIn.findMany()).length, 2);
    assert.equal((await prisma.db.invoice.findMany()).length, 2);
    assert.equal((await prisma.db.payment.findMany()).length, 2);
    assert.equal(await prisma.db.stayAssignment.count(), 0);
    assert.equal(await prisma.db.transfer.count(), 0);
  }
});
