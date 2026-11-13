/** Supported main-schema upgrade, only inside the disposable harness's verified new cluster. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPhase4Catalog } from '../ci/phase4-catalog.js';

export async function snapshotLegacy(db, tables) {
  const result = {};
  for (const table of tables) {
    assert.match(table, /^[a-z_]+$/);
    const rows = (
      await db.query(
        `SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text COLLATE "C"`,
      )
    ).rows;
    result[table] = {
      count: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    };
  }
  return result;
}

export async function prepareUpgrade(db, root, env, migratorUrl) {
  // Pin the supported committed baseline; do not infer a target database or use its credentials.
  const baseline = spawnSync(
    'git',
    ['show', '908098acd567c299ad05529b5a533ad17622dceb:scripts/ci/g6b-migrations.json'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(baseline.status, 0);
  const old = JSON.parse(baseline.stdout).migrations;
  const all = JSON.parse(readFileSync(resolve(root, 'scripts/ci/g6b-migrations.json'))).migrations;
  assert.equal(old.length, 18);
  assert.deepEqual(all.slice(0, 18), old);
  assert.equal(all.length, 24);
  const dir = mkdtempSync(join(tmpdir(), 'nook-upgrade-'));
  try {
    const migrations = join(dir, 'migrations');
    mkdirSync(migrations);
    copyFileSync(
      resolve(root, 'prisma/migrations/migration_lock.toml'),
      join(migrations, 'migration_lock.toml'),
    );
    for (const m of old) {
      const source = resolve(root, 'prisma/migrations', m.name, 'migration.sql');
      assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), m.checksum);
      mkdirSync(join(migrations, m.name));
      copyFileSync(source, join(migrations, m.name, 'migration.sql'));
    }
    const config = join(dir, 'prisma.config.mjs');
    writeFileSync(
      config,
      `import { defineConfig } from ${JSON.stringify(resolve(root, 'node_modules/prisma/config.js'))};\nexport default defineConfig({schema:${JSON.stringify(resolve(root, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL}});\n`,
    );
    const deploy = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', config],
      { cwd: root, env: { ...env, DATABASE_URL: migratorUrl }, encoding: 'utf8', timeout: 120_000 },
    );
    assert.equal(
      deploy.status,
      0,
      'Baseline migration bootstrap failed; sensitive output withheld',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  } // exact temporary files owned by this invocation
  const tables = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  for (const label of ['A', 'B']) {
    const ids = Array.from({ length: 10 }, () => randomUUID());
    const [org, user, property, floor, room, bed, resident, booking, admission, checkin] = ids;
    await db.query('BEGIN');
    try {
      await db.query('INSERT INTO organizations(id,name,updated_at) VALUES($1,$2,now())', [
        org,
        `Legacy ${label}`,
      ]);
      await db.query(
        "INSERT INTO users(id,login_identifier,password_hash,display_name,updated_at) VALUES($1,$2,'synthetic-unusable','Legacy owner',now())",
        [user, `${user}@nook.test.invalid`],
      );
      await db.query(
        "INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'OWNER')",
        [org, user],
      );
      await db.query(
        "INSERT INTO properties(id,organization_id,code,name,updated_at) VALUES($1,$2,'L','Legacy',now())",
        [property, org],
      );
      await db.query(
        "INSERT INTO floors(id,organization_id,property_id,label,ordinal,updated_at) VALUES($1,$2,$3,'F',0,now())",
        [floor, org, property],
      );
      await db.query(
        "INSERT INTO rooms(id,organization_id,property_id,floor_id,label,updated_at) VALUES($1,$2,$3,$4,'R',now())",
        [room, org, property, floor],
      );
      await db.query(
        "INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,'B',now())",
        [bed, org, property, room],
      );
      await db.query(
        "INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Legacy',$3,now())",
        [resident, org, label],
      );
      await db.query(
        "INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())",
        [booking, org, resident, bed],
      );
      await db.query(
        "INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())",
        [admission, org, booking, resident, bed],
      );
      await db.query(
        "INSERT INTO check_ins(id,organization_id,admission_id,resident_id,bed_id,booking_id,check_in_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01T00:00:00.123456Z',now())",
        [checkin, org, admission, resident, bed, booking],
      );
      const invoice = randomUUID();
      await db.query(
        "INSERT INTO invoices(id,organization_id,resident_id,booking_id,number,period_start,period_end,amount,status,due_date,issued_at,updated_at) VALUES($1,$2,$3,$4,'INV-2020-0001','2020-01-01','2020-01-31',5000,'ISSUED','2020-01-10','2020-01-01',now())",
        [invoice, org, resident, booking],
      );
      await db.query(
        "INSERT INTO payments(organization_id,invoice_id,resident_id,amount,method,received_at,updated_at) VALUES($1,$2,$3,100,'CASH','2020-01-02',now())",
        [org, invoice, resident],
      );
      await db.query("UPDATE invoices SET paid_amount=100,status='PARTIALLY_PAID' WHERE id=$1", [
        invoice,
      ]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  }
  const before = await snapshotLegacy(db, tables);
  const catalog = await readPhase4Catalog(db);
  const rollback = [];
  await db.query('BEGIN');
  try {
    for (const m of all.slice(18)) {
      const previous = await readPhase4Catalog(db);
      const sql = readFileSync(resolve(root, 'prisma/migrations', m.name, 'migration.sql'), 'utf8');
      await db.query('SAVEPOINT migration_probe');
      await db.query(sql);
      await db.query('ROLLBACK TO SAVEPOINT migration_probe');
      assert.deepEqual(await readPhase4Catalog(db), previous, 'DDL rollback changed catalog');
      assert.deepEqual(
        await snapshotLegacy(db, tables),
        before,
        'DDL rollback changed legacy rows',
      );
      await db.query('RELEASE SAVEPOINT migration_probe');
      await db.query(sql); // advance to the next prerequisite, still inside the outer rollback
      rollback.push({ migration: m.name, ddlRollback: 'PASS' });
    }
  } finally {
    await db.query('ROLLBACK');
  }
  assert.deepEqual(await readPhase4Catalog(db), catalog);
  assert.deepEqual(await snapshotLegacy(db, tables), before);
  console.log(
    'UPGRADE_PRECHECK ' +
      JSON.stringify({ baselineMigrations: 18, legacyTables: tables.length, rollback }),
  );
  return { tables, before, rollback };
}
