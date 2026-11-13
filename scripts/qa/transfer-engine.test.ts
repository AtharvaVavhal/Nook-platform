/* eslint-disable @typescript-eslint/no-explicit-any -- isolated PostgreSQL fixture rows */
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { FinanceService } from '../../apps/api/src/finance/finance.service.js';
import { CheckInService } from '../../apps/api/src/checkin/checkin.service.js';
import { loadChain } from '../../apps/api/src/corrections/corrections.facts.js';
import { validateCorrection } from '../../apps/api/src/corrections/corrections.apply.js';
import { todayIst } from '../../apps/api/src/common/time.js';
import { BookingService } from '../../apps/api/src/booking/booking.service.js';
import { acquireOrgGate } from '../../apps/api/src/common/org-gate.js';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TransferExecutionService, TransferExecutionGate, type TransferCommand, type TransferApproval } from '../../apps/api/src/transfer/transfer.execution.js';
import type { Prisma } from '../../apps/api/src/generated/client.js';
import { TransferService } from '../../apps/api/src/transfer/transfer.service.js';

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


// Test-only approval evidence. This is not the missing production approval workflow or F1 policy.
// The real module always uses TransferExecutionGate, which rejects before opening a connection.
const requester = randomUUID();
test.before(async () => {
  await sql("INSERT INTO users(id,login_identifier,password_hash,display_name,updated_at) VALUES($1,$2,'fixture-only','Requester',now())", [requester, `${requester}@nook.test.invalid`]);
  for (const [user, role] of [[ids.actor, 'OWNER'], [requester, 'PROPERTY_MANAGER']]) {
    await sql('INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,$3)', [ids.org, user, role]);
  }
});
class FixtureGate extends TransferExecutionGate {
  failFinance = false;
  override assertConfigured() {}
  override async authorize(tx: Prisma.TransactionClient, command: TransferCommand): Promise<TransferApproval> {
    const row = await tx.auditEvent.findFirst({ where: { organizationId: command.organizationId, action: 'test.transfer.approval',
      targetType: 'stay_assignment', metadata: { path: ['commandKey'], equals: command.idempotencyKey } } });
    const proof = row?.metadata as any;
    if (!proof || proof.residentId !== command.residentId || proof.destinationBedId !== command.destinationBedId) throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
    return { approvalId: row!.id, requestedByUserId: proof.requestedByUserId, approvedByUserId: proof.approvedByUserId,
      sourceAssignmentId: row!.targetId!, bookingId: proof.bookingId };
  }
  override async validateFinance() {} // Explicitly isolates transaction mechanics; no finance policy accepted.
  override async recordFinanceReview() {
    if (this.failFinance) throw new ConflictException({ code: 'FINANCE_REVIEW_REQUIRED' });
  }
}
const gate = new FixtureGate();
const engine = () => new TransferExecutionService(prisma, gate, { receiptSecret: () => 'disposable-transfer-receipt-secret-32chars' });
async function freeBed() {
  const bed = randomUUID();
  await sql("INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,$5,now())", [bed, ids.org, ids.property, ids.room, `Free ${bed}`]);
  return bed;
}
async function commandFor(f: any, destinationBedId = '', requestedByUserId = requester) {
  const current = (await sql("SELECT id FROM stay_assignments WHERE booking_id=$1 AND status='ACTIVE'", [f.booking]))[0];
  const command = { organizationId: ids.org, actorUserId: ids.actor, actorRole: 'OWNER', residentId: f.resident,
    destinationBedId: destinationBedId || await freeBed(), effectiveAt: new Date(), idempotencyKey: randomUUID(), reason: 'Disposable engine test' };
  await prisma.db.auditEvent.create({ data: { organizationId: ids.org, actorUserId: ids.actor, action: 'test.transfer.approval',
    targetType: 'stay_assignment', targetId: current.id, requestId: randomUUID(), metadata: { commandKey: command.idempotencyKey, residentId: f.resident,
      destinationBedId: command.destinationBedId, bookingId: f.booking, requestedByUserId, approvedByUserId: ids.actor } } });
  return command;
}
const count = async (table: string, booking: string) => {
  assert.ok(['transfers', 'stay_assignments'].includes(table));
  return (await sql(`SELECT count(*)::int n FROM ${table} WHERE booking_id=$1`, [booking]))[0].n;
};

test('production execution gate refuses without any database access', async () => {
  const db = { get db() { throw new Error('Database must not be opened'); } } as any;
  const input = { organizationId: ids.org, actorUserId: ids.actor, actorRole: 'OWNER', residentId: fixtures[0].resident,
    destinationBedId: fixtures[1].dest, reason: 'Blocked', effectiveAt: new Date(), idempotencyKey: randomUUID() };
  const actual = new TransferExecutionService(db, new TransferExecutionGate());
  await assert.rejects(actual.execute(input), { status: 503 });
  await assert.rejects(new TransferService(db, actual).execute(input), { status: 503 });
});

test('atomic transfer creates one assignment, exactly three audits and exact response receipt; concurrent same-key replay has one effect', async () => {
  const f = fixtures[0], input = await commandFor(f);
  const before = await count('transfers', f.booking);
  const [first, replay] = await Promise.all([engine().execute(input), engine().execute(input)]);
  assert.deepEqual(first, replay);
  const result = first as any;
  assert.equal(result.destinationBedId, input.destinationBedId);
  assert.equal(await count('transfers', f.booking), before + 1);
  assert.equal((await sql('SELECT count(*)::int n FROM transfer_command_receipts WHERE transfer_id=$1', [result.id]))[0].n, 1);
  assert.equal((await sql("SELECT count(*)::int n FROM audit_events WHERE metadata->>'transferId'=$1", [result.id]))[0].n, 3);
  assert.equal((await sql("SELECT count(*)::int n FROM stay_assignments WHERE booking_id=$1 AND status='ACTIVE'", [f.booking]))[0].n, 1);
  assert.equal((await sql('SELECT bed_id FROM bookings WHERE id=$1', [f.booking]))[0].bed_id, f.source);
  await assert.rejects(engine().execute({ ...input, reason: 'Different payload' }), { status: 409 });
  await sql("UPDATE memberships SET status='REVOKED' WHERE organization_id=$1 AND user_id=$2", [ids.org, ids.actor]);
  try { await assert.rejects(engine().execute(input), { status: 403 }); }
  finally { await sql("UPDATE memberships SET status='ACTIVE' WHERE organization_id=$1 AND user_id=$2", [ids.org, ids.actor]); }
});

let invoiceId: string;
let financialSnapshot: any;
async function issuedSnapshot() {
  return {
    invoice: (await sql('SELECT to_jsonb(i) row FROM invoices i WHERE id=$1', [invoiceId]))[0].row,
    payments: await sql('SELECT to_jsonb(p) row FROM payments p WHERE invoice_id=$1 ORDER BY id', [invoiceId]),
  };
}
test('issued invoice and payment fixture uses the original booking and full contractual rent', async () => {
  const f = fixtures[0], finance = new FinanceService(prisma), month = todayIst().toISOString().slice(0, 7);
  const draft = await finance.createDraft(ids.org, ids.actor, { residentId: f.resident, bookingId: f.booking, month });
  invoiceId = draft.id;
  await finance.issue(ids.org, ids.actor, invoiceId);
  await finance.recordPayment(ids.org, ids.actor, { invoiceId, amount: '100.00', method: 'CASH' }, randomUUID());
  financialSnapshot = await issuedSnapshot();
  assert.equal(financialSnapshot.invoice.amount, 5000);
  assert.equal(financialSnapshot.invoice.paid_amount, 100);
});

test('a late finance barrier failure rolls back transfer, assignment closure, audits and receipt', async () => {
  const f = fixtures[1], input = await commandFor(f);
  const before = await count('transfers', f.booking), beforeSegments = await count('stay_assignments', f.booking);
  gate.failFinance = true;
  try { await assert.rejects(engine().execute(input), { status: 409 }); }
  finally { gate.failFinance = false; }
  assert.equal(await count('transfers', f.booking), before);
  assert.equal(await count('stay_assignments', f.booking), beforeSegments);
  assert.equal((await sql('SELECT count(*)::int n FROM transfer_command_receipts WHERE idempotency_key=$1', [input.idempotencyKey]))[0].n, 0);
  assert.equal((await sql("SELECT status::text status FROM stay_assignments WHERE id=$1", [f.assignment]))[0].status, 'ACTIVE');
});

test('independent reviewer and tenant checks cannot be replaced by supplied actor role', async () => {
  const f = fixtures[1], self = await commandFor(f, '', ids.actor);
  await assert.rejects(engine().execute(self), { status: 403 });
  const foreign = await commandFor(f);
  await assert.rejects(engine().execute({ ...foreign, organizationId: randomUUID() }), { status: 403 });
  assert.equal((await sql('SELECT count(*)::int n FROM transfer_command_receipts WHERE idempotency_key=$1', [self.idempotencyKey]))[0].n, 0);
});

test('two commands for the same source serialize and exactly one can close the approved source', async () => {
  const f = fixtures[1], a = await commandFor(f), b = await commandFor(f);
  const before = await count('transfers', f.booking);
  const results = await Promise.allSettled([engine().execute(a), engine().execute(b)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 409).length, 1);
  assert.equal(await count('transfers', f.booking), before + 1);
});

test('two residents targeting the same bed cannot both allocate it', async () => {
  const destination = await freeBed();
  const a = await commandFor(fixtures[1], destination), b = await commandFor(fixtures[2], destination);
  const results = await Promise.allSettled([engine().execute(a), engine().execute(b)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 409).length, 1);
  assert.equal((await sql("SELECT count(*)::int n FROM stay_assignments WHERE bed_id=$1 AND status='ACTIVE'", [destination]))[0].n, 1);
});

test('transfer versus booking creation preserves atomic availability', async () => {
  const destination = await freeBed(), input = await commandFor(fixtures[0], destination);
  const results = await Promise.allSettled([engine().execute(input), new BookingService(prisma).create(ids.org, {
    residentId: fixtures[2].resident, bedId: destination, startDate: '2026-11-01', endDate: '2080-01-01', monthlyPrice: '5000' }, ids.actor)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});

test('uncertain commit is resolved by exact same-key receipt replay without a second transfer', async () => {
  const f = fixtures[0], input = await commandFor(f);
  let ambiguous = true;
  const wrapped = { db: { $transaction: async (body: any, options: any) => {
    const result = await prisma.db.$transaction(body, options);
    if (ambiguous) { ambiguous = false; throw Object.assign(new Error('Injected lost acknowledgement'), { code: 'P2028' }); }
    return result;
  } } } as any;
  const service = new TransferExecutionService(wrapped, gate, { receiptSecret: () => 'disposable-transfer-receipt-secret-32chars' });
  const before = await count('transfers', f.booking);
  await assert.rejects(service.execute(input), (error: any) => error.getStatus() === 409 && error.getResponse().code === 'RETRY_REQUIRED');
  const response = await service.execute(input);
  assert.equal(await count('transfers', f.booking), before + 1);
  assert.equal((await sql('SELECT response_body FROM transfer_command_receipts WHERE idempotency_key=$1', [input.idempotencyKey]))[0].response_body.id, (response as any).id);
});

test('actual organization lock timeout returns RETRY_REQUIRED with no effects, then same key succeeds', async () => {
  const f = fixtures[2], input = await commandFor(f);
  let release!: () => void, acquired!: () => void;
  const held = new Promise<void>(resolve => { acquired = resolve; });
  const unblock = new Promise<void>(resolve => { release = resolve; });
  const holder = prisma.db.$transaction(async tx => { await acquireOrgGate(tx, ids.org); acquired(); await unblock; }, { timeout: 15000 });
  await held;
  const before = await count('transfers', f.booking);
  try {
    await assert.rejects(engine().execute(input), (error: any) => error.getStatus() === 409 && error.getResponse().code === 'RETRY_REQUIRED');
    assert.equal(await count('transfers', f.booking), before);
    assert.equal((await sql('SELECT count(*)::int n FROM transfer_command_receipts WHERE idempotency_key=$1', [input.idempotencyKey]))[0].n, 0);
  } finally { release(); await holder; }
  await engine().execute(input);
  assert.equal(await count('transfers', f.booking), before + 1);
});

test('transfer versus extension revalidates the destination for the enlarged booking interval', async () => {
  const f = fixtures[0], destination = await freeBed(), input = await commandFor(f, destination);
  await sql("INSERT INTO bookings(organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,'2090-01-01','2092-01-01',5000,now())", [ids.org, fixtures[2].resident, destination]);
  const results = await Promise.allSettled([engine().execute(input), new BookingService(prisma).extend({ organizationId: ids.org, userId: ids.actor, role: 'OWNER' }, f.booking,
    { newEndDate: '2091-01-01', reason: 'Concurrent extension' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 409).length, 1);
});

test('transfer versus checkout leaves no open assignment after a successful checkout', async () => {
  const f = fixtures[2], input = await commandFor(f);
  const results = await Promise.allSettled([engine().execute(input), new CheckInService(prisma).checkOut(ids.org, f.checkin,
    { checkOutAt: new Date().toISOString() }, ids.actor)]);
  assert.equal(results[1]!.status, 'fulfilled');
  if (results[0]!.status === 'rejected') assert.equal(results[0]!.reason.getStatus(), 409);
  assert.equal((await sql("SELECT count(*)::int n FROM stay_assignments WHERE booking_id=$1 AND status='ACTIVE'", [f.booking]))[0].n, 0);
  assert.equal((await sql('SELECT count(*)::int n FROM check_outs WHERE check_in_id=$1', [f.checkin]))[0].n, 1);
});

test('replacement validation cannot cross an immutable transfer boundary and retains all source facts', async () => {
  const f = fixtures[0];
  const before = await sql('SELECT id,start_at,end_at,status::text FROM stay_assignments WHERE booking_id=$1 ORDER BY start_at', [f.booking]);
  await assert.rejects(prisma.db.$transaction(async tx => {
    await acquireOrgGate(tx, ids.org);
    const chain = await loadChain(tx, ids.org, f.booking);
    await validateCorrection({ tx, organizationId: ids.org, targetId: f.checkin, fieldKey: 'checkInAt',
      proposed: { kind: 'instant', value: '2021-01-02T01:00:00.000000Z' }, now: new Date(), chain });
  }), (error: any) => error.status === 409 || error.getStatus?.() === 409);
  assert.deepEqual(await sql('SELECT id,start_at,end_at,status::text FROM stay_assignments WHERE booking_id=$1 ORDER BY start_at', [f.booking]), before);
});

test('new check-in recognizes completed destination segments, then permits occupancy after their end', async () => {
  const bed = fixtures[0].dest, resident = randomUUID(), booking = randomUUID(), admission = randomUUID();
  await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Physical','History',now())", [resident, ids.org]);
  await sql("INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())", [booking, ids.org, resident, bed]);
  await sql("INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())", [admission, ids.org, booking, resident, bed]);
  const service = new CheckInService(prisma);
  await assert.rejects(service.create(ids.org, { admissionId: admission, checkInAt: '2025-01-01T00:00:00Z' }, ids.actor), { status: 409 });
  const current = await service.create(ids.org, { admissionId: admission, checkInAt: new Date().toISOString() }, ids.actor);
  assert.equal(current.bedId, bed);
});

test('transfers preserve issued invoice/payment facts and generation remains once per booking/month', async () => {
  assert.deepEqual(await issuedSnapshot(), financialSnapshot);
  const finance = new FinanceService(prisma), month = todayIst().toISOString().slice(0, 7);
  await finance.generateMonthly(ids.org, ids.actor, { month, issue: false });
  const retry = await finance.generateMonthly(ids.org, ids.actor, { month, issue: false });
  assert.equal(retry.created, 0);
  assert.deepEqual(await issuedSnapshot(), financialSnapshot);
  assert.deepEqual(await sql("SELECT booking_id,period_start FROM invoices WHERE organization_id=$1 AND status<>'CANCELLED' GROUP BY booking_id,period_start HAVING count(*)>1", [ids.org]), []);
});
