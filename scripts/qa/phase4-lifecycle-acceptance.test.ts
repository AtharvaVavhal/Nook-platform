/* eslint-disable @typescript-eslint/no-explicit-any -- disposable PostgreSQL fixtures */
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { BookingService } from '../../apps/api/src/booking/booking.service.js';
import { AdmissionService } from '../../apps/api/src/admission/admission.service.js';
import { CheckInService } from '../../apps/api/src/checkin/checkin.service.js';
import { CorrectionsService } from '../../apps/api/src/corrections/corrections.service.js';
import { FinanceService } from '../../apps/api/src/finance/finance.service.js';
import { InvoiceSchedulerService } from '../../apps/api/src/jobs/invoice-scheduler.service.js';
import { StaySummaryService } from '../../apps/api/src/stay-summary/stay-summary.service.js';
import { TransferService } from '../../apps/api/src/transfer/transfer.service.js';
import { TransferFinanceService, TransferFinanceGate } from '../../apps/api/src/transfer/transfer-finance.service.js';
import { PrismaInventoryRepository } from '../../apps/api/src/inventory/inventory.repository.js';
import { ResidentHistoryService } from '../../apps/api/src/resident-history/resident-history.service.js';
import { acquireOrgGate } from '../../apps/api/src/common/org-gate.js';
import { sqlStates } from '../../apps/api/src/common/tx-errors.js';
import { backfillStayAssignments } from '../backfill-stay-assignments.mjs';
import { todayIst } from '../../apps/api/src/common/time.js';

// Real services and database; seeded transfer history and explicitly injected policy gates mean
// these are technical component checks, NEVER official T1–T10 or production-policy acceptance.
const prisma = new PrismaService();
const sql = (query: string, values: unknown[] = []) => withMigratorClient(async db => (await db.query(query, values)).rows);
const ids = { org: randomUUID(), owner: randomUUID(), owner2: randomUUID(), requester: randomUUID(), property: randomUUID(), floor: randomUUID(), room: randomUUID() };
const f = { resident: randomUUID(), source: randomUUID(), dest: randomUUID(), booking: randomUUID(), admission: randomUUID(), checkin: randomUUID(), transfer: randomUUID() };
const finance = new FinanceService(prisma);
const booking = new BookingService(prisma);
const admissions = new AdmissionService(prisma);
const checkins = new CheckInService(prisma);
const secret = 'disposable-technical-acceptance-secret-32';
const ctx = (userId = ids.owner, role = 'OWNER') => ({ organizationId: ids.org, userId, role });
const now = new Date();
const month = todayIst().toISOString().slice(0, 7), period = `${month}-01`;
let issuedSnapshot: any;

test.before(async () => {
  assert.notEqual(process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED, '1');
  await sql("INSERT INTO organizations(id,name,updated_at) VALUES($1,'Technical acceptance',now())", [ids.org]);
  for (const [user, role] of [[ids.owner, 'OWNER'], [ids.owner2, 'OWNER'], [ids.requester, 'PROPERTY_MANAGER']]) {
    await sql("INSERT INTO users(id,login_identifier,password_hash,display_name,updated_at) VALUES($1,$2,'fixture-only',$3,now())", [user, `${user}@nook.test.invalid`, role]);
    await sql('INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,$3)', [ids.org, user, role]);
  }
  await sql("INSERT INTO properties(id,organization_id,code,name,updated_at) VALUES($1,$2,$1::text,'P',now())", [ids.property, ids.org]);
  await sql("INSERT INTO floors(id,organization_id,property_id,label,ordinal,updated_at) VALUES($1,$2,$3,'F',0,now())", [ids.floor, ids.org, ids.property]);
  await sql("INSERT INTO rooms(id,organization_id,property_id,floor_id,label,updated_at) VALUES($1,$2,$3,$4,'R',now())", [ids.room, ids.org, ids.property, ids.floor]);
  for (const bed of [f.source, f.dest]) await sql('INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,$5,now())', [bed, ids.org, ids.property, ids.room, bed === f.source ? 'Original' : 'Physical']);
  await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Historical','Resident',now())", [f.resident, ids.org]);
  await sql("INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())", [f.booking, ids.org, f.resident, f.source]);
  await sql("INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())", [f.admission, ids.org, f.booking, f.resident, f.source]);
  await sql("INSERT INTO check_ins(id,organization_id,admission_id,resident_id,bed_id,booking_id,check_in_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01',now())", [f.checkin, ids.org, f.admission, f.resident, f.source, f.booking]);
  await seedTransfer(f.transfer);
  await sql("INSERT INTO stay_assignments(organization_id,booking_id,resident_id,bed_id,kind,status,start_at,end_at) VALUES($1,$2,$3,$4,'ORIGINAL','COMPLETED','2020-01-01','2021-01-01')", [ids.org, f.booking, f.resident, f.source]);
  await sql("INSERT INTO stay_assignments(organization_id,booking_id,resident_id,bed_id,kind,status,start_at,transfer_id) VALUES($1,$2,$3,$4,'TRANSFER','ACTIVE','2021-01-01',$5)", [ids.org, f.booking, f.resident, f.dest, f.transfer]);
  const draft = await finance.createDraft(ids.org, ids.owner, { residentId: f.resident, bookingId: f.booking, month });
  await finance.issue(ids.org, ids.owner, draft.id);
  await finance.recordPayment(ids.org, ids.owner, { invoiceId: draft.id, amount: '100.00', method: 'CASH' }, randomUUID());
  issuedSnapshot = await money();
});
test.after(async () => prisma.onModuleDestroy());

async function seedTransfer(id: string) {
  await sql("INSERT INTO transfers(id,organization_id,resident_id,booking_id,type,source_bed_id,source_room_id,source_property_id,destination_bed_id,destination_room_id,destination_property_id,reason,effective_at,actor_user_id,actor_role,idempotency_key) VALUES($1,$2,$3,$4,'BED_TRANSFER',$5,$6,$7,$8,$6,$7,'Seeded historical evidence','2021-01-01',$9,'OWNER',$10)", [id, ids.org, f.resident, f.booking, f.source, ids.room, ids.property, f.dest, ids.owner, randomUUID()]);
}
async function money() {
  return { invoices: await sql('SELECT to_jsonb(i) value FROM invoices i WHERE organization_id=$1 ORDER BY id', [ids.org]), payments: await sql('SELECT to_jsonb(p) value FROM payments p WHERE organization_id=$1 ORDER BY id', [ids.org]) };
}
async function correct(field: 'checkInAt' | 'checkOutAt', target: string, value: string) {
  // Exercises mechanical reconciliation only; no shipped flag/configuration is changed.
  const service = new CorrectionsService(prisma, finance, { receiptSecret: () => secret, financialApplyEnabled: () => true, sleep: async () => {} });
  const result = await service.submit(ctx(ids.requester, 'PROPERTY_MANAGER'), randomUUID(), {
    targetType: field === 'checkInAt' ? 'CHECK_IN' : 'CHECK_OUT', targetId: target, fieldKey: field,
    proposedValue: value, reason: 'Technical historical register evidence', evidenceReference: 'Disposable historical register', effectiveAt: now.toISOString(),
  });
  await service.approve(ctx(), randomUUID(), (result.body as any).id, { decisionReason: 'Independent technical review', exceptionRationale: 'Historical register evidence' });
}

test('P4-6: reconciled active history reaches occupancy, summary, booking availability, preview and inventory protection', async () => {
  await correct('checkInAt', f.checkin, '2020-01-02T00:00:00.123456Z');
  const occupancy = await checkins.occupancy(ids.org);
  assert.ok(occupancy.occupiedBedIds.includes(f.dest));
  assert.ok(!occupancy.occupiedBedIds.includes(f.source));
  const summary = await new StaySummaryService(prisma, finance).getStaySummary(ids.org, f.resident);
  assert.equal(summary.currentStay!.activeCheckIn.bedId, f.dest);
  assert.equal(summary.currentStay!.activeCheckIn.checkInAt, '2020-01-02T00:00:00.123Z');
  const available = await booking.getAvailableBeds(ids.org, todayIst(), new Date('2089-01-01'));
  assert.ok(!available.some(bed => bed.id === f.dest));
  await assert.rejects(new PrismaInventoryRepository(prisma).archiveBed(ids.org, f.dest), { status: 409 });
  await assert.rejects(booking.create(ids.org, { residentId: f.resident, bedId: f.dest, startDate: period, endDate: '2089-01-01', monthlyPrice: '5000' }, ids.owner), { status: 409 });
  const history = await new TransferService(prisma).history(ids.org, { residentId: f.resident });
  assert.equal(history.items[0]!.destinationBedId, f.dest);
  await assert.rejects(new TransferService(prisma).preview(ids.org, 'OWNER', { residentId: f.resident, destinationBedId: f.dest, effectiveAt: now.toISOString() }));
});

test('P4-4: destination extension collision rolls back dates, admission, rent and extension audit after reconciliation', async () => {
  const other = randomUUID();
  await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Future','Occupant',now())", [other, ids.org]);
  await booking.create(ids.org, { residentId: other, bedId: f.dest, startDate: '2090-01-01', endDate: '2092-01-01', monthlyPrice: '6000' }, ids.owner);
  const before = await sql('SELECT to_jsonb(b) booking,to_jsonb(a) admission FROM bookings b JOIN admissions a ON a.booking_id=b.id WHERE b.id=$1', [f.booking]);
  await assert.rejects(booking.extend(ctx(), f.booking, { newEndDate: '2091-01-01', reason: 'Conflicting future physical bed' }), { status: 409 });
  assert.deepEqual(await sql('SELECT to_jsonb(b) booking,to_jsonb(a) admission FROM bookings b JOIN admissions a ON a.booking_id=b.id WHERE b.id=$1', [f.booking]), before);
  assert.equal((await booking.extensionHistory(ids.org, f.booking)).length, 0);
});

test('P4-7: concurrent checkout closes reconciled physical assignment once, preserves money and records physical audit identity', async () => {
  const outAt = new Date(now.getTime() - 60_000).toISOString();
  const results = await Promise.allSettled([checkins.checkOut(ids.org, f.checkin, { checkOutAt: outAt, reason: 'Technical checkout' }, ids.owner), checkins.checkOut(ids.org, f.checkin, { checkOutAt: outAt }, ids.owner2)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.getStatus() === 409).length, 1);
  assert.equal((await sql("SELECT count(*)::int n FROM effective_stay_assignments WHERE booking_id=$1 AND end_at IS NULL", [f.booking]))[0].n, 0);
  const rows = await sql("SELECT metadata FROM audit_events WHERE organization_id=$1 AND action='checkout.created'", [ids.org]);
  assert.equal(rows.length, 1); assert.equal(rows[0].metadata.physicalBedId, f.dest); assert.equal(rows[0].metadata.bedId, f.source);
  assert.ok(rows[0].metadata.stayAssignmentId);
  assert.deepEqual(await money(), issuedSnapshot);
  const events = await new ResidentHistoryService(prisma).getHistory(ids.org, f.resident, { action: 'checkout.created' });
  assert.equal(events.items[0]!.metadata.physicalBedId, f.dest);
  await assert.rejects(checkins.checkOut(randomUUID(), f.checkin, { checkOutAt: now.toISOString() }, ids.owner), { status: 404 });
});

test('P4-5/P4-6: corrected historical end permits adjacent check-in, rejects overlap, and preserves legacy adoption behavior', async () => {
  const checkout = (await sql('SELECT id FROM check_outs WHERE check_in_id=$1', [f.checkin]))[0];
  const correctedEnd = new Date(now.getTime() - 3_600_000);
  await correct('checkOutAt', checkout.id, correctedEnd.toISOString());
  const resident = randomUUID();
  await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Adjacent','Resident',now())", [resident, ids.org]);
  const next = await booking.create(ids.org, { residentId: resident, bedId: f.dest, startDate: period, endDate: '2089-01-01', monthlyPrice: '5000' }, ids.owner);
  await assert.rejects(admissions.create(randomUUID(), { bookingId: next.id, admissionDate: period }, ids.owner), { status: 404 });
  await assert.rejects(admissions.create(ids.org, { bookingId: next.id, admissionDate: '2095-01-01' }, ids.owner), { status: 400 });
  const admitted = await admissions.create(ids.org, { bookingId: next.id, admissionDate: period, residentId: resident, bedId: f.dest }, ids.owner);
  await assert.rejects(admissions.create(ids.org, { bookingId: next.id, admissionDate: period }, ids.owner), { status: 409 });
  await assert.rejects(checkins.create(ids.org, { admissionId: admitted.id, checkInAt: correctedEnd.toISOString() }, ids.owner), { status: 409 });
  await admissions.update(ids.org, admitted.id, { status: 'ADMITTED' }, ids.owner);
  await assert.rejects(checkins.create(ids.org, { admissionId: admitted.id, checkInAt: new Date(correctedEnd.getTime() - 1).toISOString() }, ids.owner), { status: 409 });
  const nextIn = await checkins.create(ids.org, { admissionId: admitted.id, checkInAt: correctedEnd.toISOString() }, ids.owner);
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignments WHERE booking_id=$1', [next.id]))[0].n, 0, 'Production adoption remains disabled');
  await assert.rejects(checkins.create(ids.org, { admissionId: admitted.id, checkInAt: correctedEnd.toISOString() }, ids.owner), { status: 409 });
  await checkins.checkOut(ids.org, nextIn.id, { checkOutAt: now.toISOString() }, ids.owner);
  const historical = await new StaySummaryService(prisma, finance).getStaySummary(ids.org, f.resident);
  assert.equal(historical.currentStay, null); assert.equal(historical.lastCheckOut!.checkOutAt, correctedEnd.toISOString());
  assert.deepEqual(await money(), issuedSnapshot);
});

test('P4-6/R1: effective boundaries retain microseconds, immutable originals and exact transfer boundaries across backfill retry', async () => {
  const before = await sql('SELECT id,start_at,end_at FROM stay_assignments WHERE booking_id=$1 ORDER BY start_at', [f.booking]);
  const exact = (await sql("SELECT to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') value FROM effective_stay_assignments WHERE booking_id=$1 AND kind='ORIGINAL'", [f.booking]))[0];
  assert.equal(exact.value, '2020-01-02 00:00:00.123456');
  assert.equal(before[0].start_at.toISOString(), '2020-01-01T00:00:00.000Z');
  await assert.rejects(correct('checkInAt', f.checkin, '2021-01-01T00:00:00Z'));
  const dry = await backfillStayAssignments(true, prisma.db);
  assert.ok(!dry.quarantined.some((item: any) => item.bookingId === f.booking));
  assert.deepEqual(await sql('SELECT id,start_at,end_at FROM stay_assignments WHERE booking_id=$1 ORDER BY start_at', [f.booking]), before);
  assert.deepEqual(await money(), issuedSnapshot);
});

class FixtureReviewGate extends TransferFinanceGate {
  override assertCreationConfigured() {}
  override assertResolutionConfigured() {}
}
const reviews = new TransferFinanceService(prisma, new FixtureReviewGate(), { receiptSecret: () => secret });
let firstReview: string, secondReview: string;
test('P4-8: multiple transfer obligations in one booking-month require separate immutable resolutions and exact audits', async () => {
  const secondTransfer = randomUUID(); await seedTransfer(secondTransfer);
  for (const transferId of [f.transfer, secondTransfer]) {
    const review = await prisma.db.$transaction(async tx => {
      await acquireOrgGate(tx, ids.org);
      return reviews.recordInTransaction(tx, { organizationId: ids.org, transferId, requestedByUserId: ids.requester, periodStart: period, reason: 'Explicit technical review' });
    });
    if (transferId === f.transfer) firstReview = review.id; else secondReview = review.id;
  }
  await reviews.resolve(ids.org, ids.owner, firstReview, randomUUID(), { outcome: 'RELEASED', reason: 'First independent resolution' });
  assert.ok((await finance.openGapBookingIds(prisma.db, ids.org, new Date(period), false)).has(f.booking));
  const decisions = await Promise.allSettled([ids.owner, ids.owner2].map(actor => reviews.resolve(ids.org, actor, secondReview, randomUUID(), { outcome: 'RELEASED', reason: 'Concurrent independent resolution' })));
  assert.equal(decisions.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(decisions.filter(result => result.status === 'rejected' && result.reason.getStatus() === 409).length, 1);
  assert.ok(!(await finance.openGapBookingIds(prisma.db, ids.org, new Date(period), false)).has(f.booking));
  assert.ok((await finance.openGapBookingIds(prisma.db, ids.org, new Date(period), true)).has(f.booking));
  const audits = await sql("SELECT action,metadata,request_id FROM audit_events WHERE organization_id=$1 AND action LIKE 'transfer.finance_review.%' ORDER BY recorded_at", [ids.org]);
  assert.equal(audits.filter(row => row.action === 'transfer.finance_review.required').length, 2);
  assert.equal(audits.filter(row => row.action === 'transfer.finance_review.resolved').length, 2);
  for (const reviewId of [firstReview, secondReview]) {
    assert.equal(audits.filter(row => row.metadata.reviewId === reviewId).length, 2);
    await assert.rejects(prisma.db.$executeRaw`DELETE FROM transfer_finance_reviews WHERE id=${reviewId}::uuid`, error => sqlStates(error).includes('42501'));
  }
  assert.deepEqual(await money(), issuedSnapshot);
});

test('P4-8: real scheduler respects review suppression, period isolation and released-manual-only billing', async () => {
  const scheduler = new InvoiceSchedulerService(prisma, finance);
  const before = await money();
  const dry = await scheduler.run({ now, lookbackMonths: 0, dryRun: true, organizationIds: [ids.org] });
  assert.equal(dry.failed, 0);
  assert.deepEqual(await money(), before);
  const result = await scheduler.run({ now, lookbackMonths: 0, organizationIds: [ids.org], maxAttempts: 1 });
  assert.equal(result.failed, 0);
  assert.equal(result.results[0]!.status, 'ok');
  const untouchedIssued = (await money()).invoices.find((row: any) => row.value.id === issuedSnapshot.invoices[0].value.id);
  assert.deepEqual(untouchedIssued, issuedSnapshot.invoices[0]);
  assert.deepEqual((await money()).payments, issuedSnapshot.payments);
  const futurePeriod = '2099-01-01';
  assert.ok(!(await finance.openGapBookingIds(prisma.db, ids.org, new Date(futurePeriod), true)).has(f.booking));
  const foreign = await reviews.list(randomUUID(), ids.owner, {});
  assert.equal(foreign.total, 0);
});
