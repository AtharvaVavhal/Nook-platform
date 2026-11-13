/* eslint-disable @typescript-eslint/no-explicit-any -- isolated PostgreSQL fixture rows */
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { CheckInService } from '../../apps/api/src/checkin/checkin.service.js';
import { BookingService } from '../../apps/api/src/booking/booking.service.js';
import { TransferService } from '../../apps/api/src/transfer/transfer.service.js';
import { FinanceService } from '../../apps/api/src/finance/finance.service.js';
import { StaySummaryService } from '../../apps/api/src/stay-summary/stay-summary.service.js';

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

test('physical summary and transfer history retain commercial terms and tenant isolation', async () => {
  const f = fixtures[0];
  const summary = await new StaySummaryService(prisma, new FinanceService(prisma)).getStaySummary(ids.org, f.resident);
  assert.equal(summary.currentStay!.activeCheckIn.bedId, f.dest);
  assert.equal(summary.currentStay!.booking.bedLabel, 'Destination 0');
  assert.equal(summary.currentStay!.booking.monthlyPrice, '5000');
  const service = new TransferService(prisma);
  const history = await service.history(ids.org, { residentId: f.resident });
  assert.equal(history.items[0]!.sourceBedId, f.source);
  assert.equal(history.items[0]!.destinationBedId, f.dest);
  await assert.rejects(service.history(randomUUID(), { residentId: f.resident }), { status: 404 });
});

test('extension checks the physical destination and rolls back on its conflicting reservation', async () => {
  const f = fixtures[0], other = fixtures[1];
  await sql("INSERT INTO bookings(organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,'2090-01-01','2092-01-01',5000,now())", [ids.org, other.resident, f.dest]);
  await assert.rejects(new BookingService(prisma).extend({ organizationId: ids.org, userId: ids.actor, role: 'OWNER' }, f.booking,
    { newEndDate: '2091-01-01', reason: 'Focused extension check' }), { status: 409 });
  assert.equal((await sql('SELECT end_date FROM bookings WHERE id=$1', [f.booking]))[0].end_date.toISOString().slice(0, 10), '2090-01-01');
  assert.equal((await sql("SELECT count(*)::int count FROM audit_events WHERE target_id=$1 AND action='booking.extended'", [f.booking]))[0].count, 0);
});

test('checkout rejects historical times without effects, then closes the physical assignment exactly once under contention', async () => {
  const f = fixtures[1], service = new CheckInService(prisma);
  await assert.rejects(service.checkOut(ids.org, f.checkin, { checkOutAt: '2020-06-01T00:00:00Z' }, ids.actor), { status: 409 });
  assert.equal((await sql('SELECT status::text status FROM stay_assignments WHERE id=$1', [f.assignment]))[0].status, 'ACTIVE');
  // Force a late audit FK failure after assignment/checkout writes; the whole command must roll back.
  await assert.rejects(service.checkOut(ids.org, f.checkin, { checkOutAt: '2026-11-01T08:00:00Z' }, randomUUID()));
  assert.equal((await sql('SELECT status::text status FROM stay_assignments WHERE id=$1', [f.assignment]))[0].status, 'ACTIVE');
  assert.equal((await sql('SELECT count(*)::int count FROM check_outs WHERE check_in_id=$1', [f.checkin]))[0].count, 0);
  const results = await Promise.allSettled([0, 1].map(() => service.checkOut(ids.org, f.checkin, { checkOutAt: '2026-11-01T08:00:00Z' }, ids.actor)));
  console.log(JSON.stringify({ probe: 'checkout-contention', outcomes: results.map(r => r.status === 'fulfilled' ? 'fulfilled' : {
    status: r.reason?.getStatus?.(), code: r.reason?.code ?? null,
    category: String(r.reason?.message ?? '').includes('Foreign key') ? 'foreign-key' : String(r.reason?.message ?? '').includes('constraint') ? 'constraint' : r.reason?.constructor?.name,
  }) }));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  const assignment = (await sql('SELECT status::text status,end_at FROM stay_assignments WHERE id=$1', [f.assignment]))[0];
  assert.equal(assignment.status, 'COMPLETED');
  assert.equal(assignment.end_at.toISOString(), '2026-11-01T08:00:00.000Z');
  assert.equal((await sql('SELECT bed_id FROM check_outs WHERE check_in_id=$1', [f.checkin]))[0].bed_id, f.source);
  assert.equal((await sql("SELECT metadata->>'physicalBedId' bed FROM audit_events WHERE action='checkout.created' AND metadata->>'checkInId'=$1", [f.checkin]))[0].bed, f.dest);
  assert.equal((await sql('SELECT bed_id FROM bookings WHERE id=$1', [f.booking]))[0].bed_id, f.source);
});

test('completed assignment chains retain the existing booking extension behavior', async () => {
  const f = fixtures[1];
  await new BookingService(prisma).extend({ organizationId: ids.org, userId: ids.actor, role: 'OWNER' }, f.booking,
    { newEndDate: '2091-01-01', reason: 'Existing extension behavior' });
  assert.equal((await sql('SELECT end_date FROM bookings WHERE id=$1', [f.booking]))[0].end_date.toISOString().slice(0, 10), '2091-01-01');
  assert.equal((await sql("SELECT count(*)::int count FROM stay_assignments WHERE booking_id=$1 AND status='ACTIVE'", [f.booking]))[0].count, 0);
});

test('blocked execution and advisory finance do not mutate the assignment chain', async () => {
  const f = fixtures[2], service = new TransferService(prisma);
  const preview = await service.preview({ organizationId: ids.org, residentId: f.resident, destinationBedId: fixtures[0].source });
  assert.equal(preview.executionEnabled, false);
  assert.equal(preview.finance.proration, false);
  for (let i = 0; i < 2; i++) await assert.rejects(service.execute({ organizationId: ids.org, actorUserId: ids.actor, actorRole: 'OWNER', residentId: f.resident,
    destinationBedId: fixtures[0].source, reason: 'Blocked execution', effectiveAt: new Date(), idempotencyKey: f.transfer }), { status: 503 });
  assert.equal((await sql('SELECT count(*)::int count FROM transfers WHERE booking_id=$1', [f.booking]))[0].count, 1);
  assert.equal((await sql("SELECT count(*)::int count FROM stay_assignments WHERE booking_id=$1 AND status='ACTIVE'", [f.booking]))[0].count, 1);
});
