/* eslint-disable @typescript-eslint/no-explicit-any -- isolated PostgreSQL fixture rows */
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { BookingService } from '../../apps/api/src/booking/booking.service.js';
import { PrismaInventoryRepository } from '../../apps/api/src/inventory/inventory.repository.js';
import { backfillStayAssignments } from '../backfill-stay-assignments.mjs';
import { acquireOrgGate } from '../../apps/api/src/common/org-gate.js';

const ids = { org: randomUUID(), actor: randomUUID(), property: randomUUID(), floor: randomUUID(), room: randomUUID() };
const prisma = new PrismaService();
const sql = (query: string, params: unknown[] = []) => withMigratorClient(async c => {
  try { return (await c.query(query, params)).rows; }
  catch (e: any) {
    console.log(JSON.stringify({ probe: 'readiness-sql-failure', sqlstate: /^[0-9A-Z]{5}$/.test(e.code) ? e.code : 'unknown', table: /(?:INTO|FROM) ([a-z_]+)/.exec(query)?.[1] ?? 'unknown' }));
    throw e;
  }
});
const fixtures: any[] = [];

test.before(async () => {
  assert.notEqual(process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED, '1');
  await sql("INSERT INTO organizations(id,name,updated_at) VALUES($1,'Transfer readiness',now())", [ids.org]);
  await sql("INSERT INTO users(id,login_identifier,password_hash,display_name,updated_at) VALUES($1,$2,'fixture-only','Owner',now())", [ids.actor, `${ids.actor}@nook.test.invalid`]);
  await sql("INSERT INTO properties(id,organization_id,code,name,updated_at) VALUES($1::uuid,$2,$1::text,'P',now())", [ids.property, ids.org]);
  await sql("INSERT INTO floors(id,organization_id,property_id,label,ordinal,updated_at) VALUES($1,$2,$3,'F',0,now())", [ids.floor, ids.org, ids.property]);
  await sql("INSERT INTO rooms(id,organization_id,property_id,floor_id,label,updated_at) VALUES($1,$2,$3,$4,'R',now())", [ids.room, ids.org, ids.property, ids.floor]);
  for (let i = 0; i < 3; i++) {
    const f = { resident: randomUUID(), source: randomUUID(), dest: randomUUID(), booking: randomUUID(), admission: randomUUID(), checkin: randomUUID(), transfer: randomUUID(), assignment: randomUUID() };
    fixtures.push(f);
    for (const bed of [f.source, f.dest]) await sql("INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,$5,now())", [bed, ids.org, ids.property, ids.room, bed === f.source ? `Source ${i}` : `Destination ${i}`]);
    await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Transfer','Fixture',now())", [f.resident, ids.org]);
    await sql("INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())", [f.booking, ids.org, f.resident, f.source]);
    await sql("INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())", [f.admission, ids.org, f.booking, f.resident, f.source]);
    await sql("INSERT INTO check_ins(id,organization_id,admission_id,resident_id,bed_id,booking_id,check_in_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01',now())", [f.checkin, ids.org, f.admission, f.resident, f.source, f.booking]);
    // Fixture history only; no transfer execution or policy approval is inferred from these rows.
    await sql("INSERT INTO transfers(id,organization_id,resident_id,booking_id,type,source_bed_id,source_room_id,source_property_id,destination_bed_id,destination_room_id,destination_property_id,reason,effective_at,actor_user_id,actor_role,idempotency_key) VALUES($1,$2,$3,$4,'BED_TRANSFER',$5,$6,$7,$8,$6,$7,'Fixture history','2021-01-01',$9,'OWNER',$10)", [f.transfer, ids.org, f.resident, f.booking, f.source, ids.room, ids.property, f.dest, ids.actor, randomUUID()]);
    await sql("INSERT INTO stay_assignments(organization_id,booking_id,resident_id,bed_id,kind,status,start_at,end_at) VALUES($1,$2,$3,$4,'ORIGINAL','COMPLETED','2020-01-01','2021-01-01')", [ids.org, f.booking, f.resident, f.source]);
    await sql("INSERT INTO stay_assignments(id,organization_id,booking_id,resident_id,bed_id,kind,status,start_at,transfer_id) VALUES($1,$2,$3,$4,$5,'TRANSFER','ACTIVE','2021-01-01',$6)", [f.assignment, ids.org, f.booking, f.resident, f.dest, f.transfer]);
  }
});
test.after(async () => { await prisma.onModuleDestroy(); });


async function legacyStay(kind: 'ACTIVE' | 'COMPLETED' | 'ORPHAN', bedId = randomUUID()) {
  const f = { resident: randomUUID(), bed: bedId, booking: randomUUID(), admission: randomUUID(), checkin: randomUUID() };
  if (!(await sql('SELECT id FROM beds WHERE id=$1', [bedId])).length) {
    await sql("INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,$5,now())", [bedId, ids.org, ids.property, ids.room, `Legacy ${f.booking}`]);
  }
  await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Legacy','Resident',now())", [f.resident, ids.org]);
  await sql("INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())", [f.booking, ids.org, f.resident, bedId]);
  await sql("INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())", [f.admission, ids.org, f.booking, f.resident, bedId]);
  await sql("INSERT INTO check_ins(id,organization_id,admission_id,resident_id,bed_id,booking_id,check_in_at,status,updated_at) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01T00:00:00.123456Z',$7,now())", [f.checkin, ids.org, f.admission, f.resident, bedId, f.booking, kind === 'ACTIVE' ? 'ACTIVE' : 'CHECKED_OUT']);
  if (kind === 'COMPLETED') await sql("INSERT INTO check_outs(organization_id,check_in_id,resident_id,bed_id,booking_id,check_out_at,updated_at) VALUES($1,$2,$3,$4,$5,'2021-01-01T00:00:00.654321Z',now())", [ids.org, f.checkin, f.resident, bedId, f.booking]);
  return f;
}

test('backfill dry-run and concurrent retries preserve microseconds and quarantine ambiguous history', async () => {
  const active = await legacyStay('ACTIVE'), completed = await legacyStay('COMPLETED'), orphan = await legacyStay('ORPHAN');
  const before = await sql('SELECT id FROM stay_assignments ORDER BY id');
  const dry = await backfillStayAssignments(true, prisma.db);
  assert.equal(dry.totalCreated, 2);
  assert.ok(dry.quarantined.some((q: any) => q.bookingId === orphan.booking));
  assert.deepEqual(await sql('SELECT id FROM stay_assignments ORDER BY id'), before);
  const runs = await Promise.all([backfillStayAssignments(false, prisma.db), backfillStayAssignments(false, prisma.db)]);
  assert.equal(runs.reduce((n, r) => n + r.totalCreated, 0), 2);
  for (const f of [active, completed]) {
    const rows = await sql("SELECT to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') start,to_char(end_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') ending FROM stay_assignments WHERE booking_id=$1", [f.booking]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].start, '2020-01-01 00:00:00.123456');
    if (f === completed) assert.equal(rows[0].ending, '2021-01-01 00:00:00.654321');
  }
  const repeat = await backfillStayAssignments(false, prisma.db);
  assert.equal(repeat.totalCreated, 0);
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignments WHERE booking_id=$1', [orphan.booking]))[0].n, 0);
  console.log(JSON.stringify({ probe: 'backfill-retry-precision', created: 2, duplicateAssignments: 0, microsecondsPreserved: true, orphanQuarantined: true }));
});

test('backfill quarantines both overlapping legacy occupants instead of allocating the first', async () => {
  const a = await legacyStay('ACTIVE'), b = await legacyStay('ACTIVE', a.bed);
  const result = await backfillStayAssignments(false, prisma.db);
  for (const f of [a, b]) {
    assert.ok(result.quarantined.some((q: any) => q.bookingId === f.booking && q.type === 'OVERLAPPING_STAY_HISTORY'));
    assert.equal((await sql('SELECT count(*)::int n FROM stay_assignments WHERE booking_id=$1', [f.booking]))[0].n, 0);
  }
});

test('backfill serializes against checkout and rereads the committed lifecycle state', async () => {
  const f = await legacyStay('ACTIVE');
  let release!: () => void, acquired!: () => void;
  const held = new Promise<void>(resolve => { acquired = resolve; });
  const unblock = new Promise<void>(resolve => { release = resolve; });
  const writer = prisma.db.$transaction(async tx => {
    await acquireOrgGate(tx, ids.org); acquired(); await unblock;
    await tx.checkOut.create({ data: { organizationId: ids.org, checkInId: f.checkin, residentId: f.resident, bedId: f.bed,
      bookingId: f.booking, checkOutAt: new Date('2026-11-01T08:00:00Z') } });
    await tx.checkIn.update({ where: { id: f.checkin }, data: { status: 'CHECKED_OUT' } });
  });
  await held;
  const fill = backfillStayAssignments(false, prisma.db);
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      waiting = (await sql("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted"))[0].n > 0;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, 'Backfill must actually wait for the checkout organization gate');
  } finally { release(); }
  await Promise.all([writer, fill]);
  const row = (await sql('SELECT status::text status,end_at FROM stay_assignments WHERE booking_id=$1', [f.booking]))[0];
  assert.equal(row.status, 'COMPLETED');
  assert.equal(row.end_at.toISOString(), '2026-11-01T08:00:00.000Z');
});

test('inventory archive protects transferred occupancy at every hierarchy level and across tenants', async () => {
  const repo = new PrismaInventoryRepository(prisma), f = fixtures[0];
  for (const operation of [() => repo.archiveBed(ids.org, f.dest), () => repo.archiveRoom(ids.org, ids.room),
    () => repo.archiveFloor(ids.org, ids.floor), () => repo.archiveProperty(ids.org, ids.property)]) {
    await assert.rejects(operation(), { status: 409 });
  }
  assert.equal(await repo.archiveBed(randomUUID(), f.dest), null);
  assert.equal((await sql('SELECT archived_at FROM beds WHERE id=$1', [f.dest]))[0].archived_at, null);
  assert.equal((await sql('SELECT archived_at FROM properties WHERE id=$1', [ids.property]))[0].archived_at, null);
});

test('inventory status change waits for the lifecycle gate and then removes the bed from availability', async () => {
  const bed = randomUUID();
  await sql("INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,'Status serialization',now())", [bed, ids.org, ids.property, ids.room]);
  let release!: () => void, acquired!: () => void;
  const held = new Promise<void>(resolve => { acquired = resolve; });
  const unblock = new Promise<void>(resolve => { release = resolve; });
  const holder = prisma.db.$transaction(async tx => { await acquireOrgGate(tx, ids.org); acquired(); await unblock; });
  await held;
  let finished = false;
  const update = new PrismaInventoryRepository(prisma).updateBed(ids.org, bed, { operationalStatus: 'OUT_OF_SERVICE', outOfServiceReason: 'Maintenance' }).then(result => { finished = true; return result; });
  // Wait until PostgreSQL observes an actual advisory-lock waiter, rather than asserting after an arbitrary sleep.
  let waiting = false;
  try {
    for (let i = 0; i < 100; i++) {
      waiting = (await sql("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted"))[0].n > 0;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting); assert.equal(finished, false);
  } finally { release(); }
  await holder; await update;
  const available = await new BookingService(prisma).getAvailableBeds(ids.org, new Date('2026-11-01'), new Date('2026-12-01'));
  assert.ok(!available.some(item => item.id === bed));
});
