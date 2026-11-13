/* eslint-disable @typescript-eslint/no-explicit-any -- isolated PostgreSQL fixture rows */
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { CheckInService } from '../../apps/api/src/checkin/checkin.service.js';
import { CorrectionsService, defaultCorrectionsConfig } from '../../apps/api/src/corrections/corrections.service.js';
import { TransferFinanceService, TransferFinanceGate } from '../../apps/api/src/transfer/transfer-finance.service.js';
import { PrismaInventoryRepository } from '../../apps/api/src/inventory/inventory.repository.js';
import { OriginalAssignmentWriter, AssignmentAdoptionGate } from '../../apps/api/src/common/assignment-adoption.js';
import { acquireOrgGate } from '../../apps/api/src/common/org-gate.js';
import { backfillStayAssignments } from '../backfill-stay-assignments.mjs';
import { todayIst } from '../../apps/api/src/common/time.js';
import { BookingService } from '../../apps/api/src/booking/booking.service.js';
import { FinanceService } from '../../apps/api/src/finance/finance.service.js';

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


const requester = randomUUID(), owner2 = randomUUID();
const secret = 'disposable-reconciliation-finance-secret-32';
const finance = new FinanceService(prisma);
// Test-only application seam already used by the correction suite; the shipped feature flag stays OFF.
const corrections = (enabled: boolean, financial = finance) => new CorrectionsService(prisma, financial,
  { receiptSecret: () => secret, financialApplyEnabled: () => enabled, sleep: async () => {} });
const ctx = (userId: string, role = 'OWNER') => ({ organizationId: ids.org, userId, role });
test.before(async () => {
  for (const user of [requester, owner2]) await sql("INSERT INTO users(id,login_identifier,password_hash,display_name,updated_at) VALUES($1,$2,'fixture-only','Reviewer',now())", [user, `${user}@nook.test.invalid`]);
  for (const [user, role] of [[ids.actor,'OWNER'],[requester,'PROPERTY_MANAGER'],[owner2,'OWNER']]) {
    await sql('INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,$3)', [ids.org,user,role]);
  }
});
async function submit(f: any, value: string, field = 'checkInAt', target = f.checkin) {
  const result = await corrections(false).submit(ctx(requester,'PROPERTY_MANAGER'), randomUUID(), {
    targetType: field === 'checkInAt' ? 'CHECK_IN' : 'CHECK_OUT', targetId: target, fieldKey: field, proposedValue: value,
    reason: 'Verified fixture register correction', effectiveAt: new Date().toISOString(), evidenceReference: 'Disposable register evidence',
  });
  return (result.body as any).id as string;
}
const approveBody = { decisionReason: 'Independent fixture review', exceptionRationale: 'Verified historical register evidence' };
let firstProposal: string;
test('replacement commits with the approved correction, preserves originals and exact precision, and replays once', async () => {
  const f = fixtures[0], value = '2020-01-02T00:00:00.123456Z';
  firstProposal = await submit(f,value);
  await assert.rejects(corrections(false).approve(ctx(ids.actor), randomUUID(), firstProposal, approveBody));
  assert.equal(defaultCorrectionsConfig.financialApplyEnabled(), false);
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignment_replacements'))[0].n, 0);
  const key = randomUUID();
  await corrections(true).approve(ctx(ids.actor), key, firstProposal, approveBody);
  await corrections(true).approve(ctx(ids.actor), key, firstProposal, approveBody);
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignment_replacements WHERE proposal_id=$1', [firstProposal]))[0].n, 1);
  const row = (await sql("SELECT to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') value FROM effective_stay_assignments WHERE booking_id=$1 AND kind='ORIGINAL'", [f.booking]))[0];
  assert.equal(row.value,'2020-01-02 00:00:00.123456');
  assert.equal((await sql("SELECT start_at FROM stay_assignments WHERE booking_id=$1 AND kind='ORIGINAL'", [f.booking]))[0].start_at.toISOString(),'2020-01-01T00:00:00.000Z');
  await finance.previewMonthly(ids.org,todayIst().toISOString().slice(0,7));
});

test('a second replacement retains the first revision and cumulative projection', async () => {
  const f=fixtures[0], proposal=await submit(f,'2020-01-03T00:00:00.654321Z');
  await corrections(true).approve(ctx(ids.actor),randomUUID(),proposal,approveBody);
  const versions=await sql('SELECT version FROM stay_assignment_replacements WHERE booking_id=$1 ORDER BY version',[f.booking]);
  assert.deepEqual(versions.map(v=>v.version),[1,2]);
  assert.equal((await sql("SELECT to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') value FROM effective_stay_assignments WHERE booking_id=$1 AND kind='ORIGINAL'",[f.booking]))[0].value,'2020-01-03 00:00:00.654321');
});

test('replacement guards refuse version gaps, missing links, stale snapshots and unapproved internal changes', async () => {
  const f = fixtures[2], proposal = await submit(f, '2020-01-02T00:00:00.123456Z');
  const mutations = [
    (data: any) => { data.version += 1; },
    (data: any) => { data.beforeSegments = data.beforeSegments.slice(0, 1); data.segments = data.segments.slice(0, 1); },
    (data: any) => { data.beforeSegments[0].startAt = '2019-01-01T00:00:00.000000Z'; },
    (data: any) => { data.segments[0].endAt = '2021-01-02T00:00:00.000000Z'; data.segments[0].replaceEnd = true; data.segments[1].startAt = data.segments[0].endAt; data.segments[1].replaceStart = true; },
    (data: any) => { data.segments[1].id = data.segments[0].id; },
  ];
  for (const mutate of mutations) {
    const db = new Proxy(prisma.db, { get(target, property) {
      if (property === '$transaction') return (fn: any, options: any) => target.$transaction(tx => fn(new Proxy(tx, { get(t, key) {
        if (key === 'stayAssignmentReplacement') return new Proxy(t.stayAssignmentReplacement, { get(delegate, method) {
          if (method === 'create') return (args: any) => { const data = structuredClone(args.data); mutate(data); return delegate.create({ ...args, data }); };
          const value = Reflect.get(delegate, method); return typeof value === 'function' ? value.bind(delegate) : value;
        } });
        const value = Reflect.get(t, key); return typeof value === 'function' ? value.bind(t) : value;
      } })), options);
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const service = new CorrectionsService({ db } as any, finance, { receiptSecret: () => secret, financialApplyEnabled: () => true, sleep: async () => {} });
    await assert.rejects(service.approve(ctx(ids.actor), randomUUID(), proposal, approveBody));
    assert.equal((await sql('SELECT count(*)::int n FROM stay_assignment_replacements WHERE proposal_id=$1', [proposal]))[0].n, 0);
    assert.equal((await sql('SELECT status FROM correction_proposals WHERE id=$1', [proposal]))[0].status, 'PENDING');
    assert.equal((await sql('SELECT check_in_at FROM check_ins WHERE id=$1', [f.checkin]))[0].check_in_at.toISOString(), '2020-01-01T00:00:00.000Z');
  }
  // A rejected forged revision does not consume the proposal or the next version.
  await corrections(true).approve(ctx(ids.actor), randomUUID(), proposal, approveBody);
  assert.equal((await sql('SELECT version FROM stay_assignment_replacements WHERE proposal_id=$1', [proposal]))[0].version, 1);
});

test('late finance failure rolls back source, replacement, proposal transition and receipt together', async () => {
  const f=fixtures[0],proposal=await submit(f,'2020-01-04T00:00:00.111111Z');
  const failing = new Proxy(finance,{get(target,property){ if(property==='applyCorrectionConsequences') return async()=>{throw new Error('Injected finance failure');}; const value=Reflect.get(target,property); return typeof value==='function'?value.bind(target):value; }});
  await assert.rejects(corrections(true,failing).approve(ctx(ids.actor),randomUUID(),proposal,approveBody));
  assert.equal((await sql('SELECT status::text status FROM correction_proposals WHERE id=$1',[proposal]))[0].status,'PENDING');
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignment_replacements WHERE proposal_id=$1',[proposal]))[0].n,0);
  assert.equal((await sql("SELECT to_char(check_in_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') value FROM check_ins WHERE id=$1",[f.checkin]))[0].value,'2020-01-03 00:00:00.654321');
});

test('replacement rows are immutable and cannot cross tenants or commit against a pending proposal', async () => {
  const r=(await sql('SELECT * FROM stay_assignment_replacements WHERE proposal_id=$1',[firstProposal]))[0];
  for(const query of ['UPDATE stay_assignment_replacements SET version=version WHERE id=$1','DELETE FROM stay_assignment_replacements WHERE id=$1']) {
    await assert.rejects(sql(query,[r.id]),(e:any)=>e.code==='23001');
  }
  await assert.rejects(sql('INSERT INTO stay_assignment_replacements(organization_id,booking_id,resident_id,proposal_id,actor_user_id,version,field_key,before_segments,segments) VALUES($1,$2,$3,$4,$5,99,$6,$7,$8)',
    [randomUUID(),r.booking_id,r.resident_id,randomUUID(),ids.actor,r.field_key,JSON.stringify(r.before_segments),JSON.stringify(r.segments)]),(e:any)=>e.code==='23514');
  const pending=(await sql("SELECT id FROM correction_proposals WHERE organization_id=$1 AND status='PENDING' LIMIT 1",[ids.org]))[0];
  await assert.rejects(sql('INSERT INTO stay_assignment_replacements(organization_id,booking_id,resident_id,proposal_id,actor_user_id,version,field_key,before_segments,segments) VALUES($1,$2,$3,$4,$5,99,$6,$7,$8)',
    [ids.org,r.booking_id,r.resident_id,pending.id,ids.actor,r.field_key,JSON.stringify(r.before_segments),JSON.stringify(r.segments)]),(e:any)=>e.code==='23514');
});

class FixtureFinanceGate extends TransferFinanceGate {
  override assertCreationConfigured() {}
  override assertResolutionConfigured() {}
}
const reviews = new TransferFinanceService(prisma,new FixtureFinanceGate(),{receiptSecret:()=>secret});
const periodStart=todayIst().toISOString().slice(0,7)+'-01';
let reviewId:string;
let moneySnapshot:any;
async function record(f:any,initiator=requester) {
  return prisma.db.$transaction(async tx=>{await acquireOrgGate(tx,ids.org);return reviews.recordInTransaction(tx,{
    organizationId:ids.org,transferId:f.transfer,requestedByUserId:initiator,periodStart,reason:'Explicit fixture review obligation',
  });});
}
test('review creation/resolution remain disabled by default without accessing the database', async()=>{
  const service=new TransferFinanceService({get db(){throw new Error('DB must remain unopened');}} as any,new TransferFinanceGate());
  await assert.rejects(service.recordInTransaction({} as any,{organizationId:ids.org,transferId:fixtures[0].transfer,requestedByUserId:requester,periodStart,reason:'Review'}),{status:503});
  await assert.rejects(service.resolve(ids.org,ids.actor,randomUUID(),randomUUID(),{outcome:'RELEASED',reason:'Review'}),{status:503});
});
test('concurrent review retries persist one obligation and suppress generation, draft creation and issue',async()=>{
  const f=fixtures[0];
  const month=periodStart.slice(0,7);
  const draft=await finance.createDraft(ids.org,ids.actor,{residentId:f.resident,bookingId:f.booking,month});
  const [a,b]=await Promise.all([record(f),record(f)]);reviewId=a.id;assert.equal(a.id,b.id);
  assert.equal((await sql('SELECT count(*)::int n FROM transfer_finance_reviews WHERE transfer_id=$1',[f.transfer]))[0].n,1);
  await assert.rejects(finance.issue(ids.org,ids.actor,draft.id),{status:409});
  // Other booking-months can still be generated; no financial correction is executed.
  await finance.generateMonthly(ids.org,ids.actor,{month,issue:true});
  assert.equal((await sql('SELECT status::text status FROM invoices WHERE id=$1',[draft.id]))[0].status,'DRAFT');
  const page=await reviews.list(ids.org,ids.actor,{});assert.equal(page.items[0]!.status,'REVIEW_REQUIRED');
  await assert.rejects(reviews.list(ids.org,requester,{}),{status:403});
});
test('independent owner resolution is atomic, replayable, visible, and never auto-issues the released invoice',async()=>{
  const key=randomUUID(),body={outcome:'RELEASED',reason:'Independently reviewed fixture obligation'};
  const first=await reviews.resolve(ids.org,ids.actor,reviewId,key,body);
  assert.deepEqual(await reviews.resolve(ids.org,ids.actor,reviewId,key,body),first);
  await assert.rejects(reviews.resolve(ids.org,ids.actor,reviewId,key,{...body,reason:'Changed request'}),{status:409});
  assert.equal((await sql('SELECT count(*)::int n FROM transfer_finance_resolutions WHERE review_id=$1',[reviewId]))[0].n,1);
  const page=await reviews.list(ids.org,ids.actor,{resolved:'true'});assert.equal(page.items[0]!.status,'RELEASED');
  await finance.generateMonthly(ids.org,ids.actor,{month:periodStart.slice(0,7),issue:true});
  assert.equal((await sql('SELECT status::text status FROM invoices WHERE booking_id=$1 AND period_start=$2',[fixtures[0].booking,periodStart]))[0].status,'DRAFT');
  assert.ok((await finance.openGapBookingIds(prisma.db,ids.org,new Date(periodStart),true)).has(fixtures[0].booking));
  assert.ok(!(await finance.openGapBookingIds(prisma.db,ids.org,new Date(periodStart),false)).has(fixtures[0].booking));
  const invoice=(await sql('SELECT id FROM invoices WHERE booking_id=$1 AND period_start=$2',[fixtures[0].booking,periodStart]))[0];
  await finance.issue(ids.org,ids.actor,invoice.id);
  await finance.recordPayment(ids.org,ids.actor,{invoiceId:invoice.id,amount:'100.00',method:'CASH'},randomUUID());
  moneySnapshot={invoice:(await sql('SELECT to_jsonb(i) value FROM invoices i WHERE id=$1',[invoice.id]))[0].value,
    payments:await sql('SELECT to_jsonb(p) value FROM payments p WHERE invoice_id=$1 ORDER BY id',[invoice.id])};
});
test('self-review and cross-tenant resolution are refused; unsupported remedy retains billing suppression',async()=>{
  const self=await record(fixtures[1],ids.actor);
  await assert.rejects(reviews.resolve(ids.org,ids.actor,self.id,randomUUID(),{outcome:'RELEASED',reason:'Own request'}),{status:403});
  await assert.rejects(reviews.resolve(randomUUID(),ids.actor,self.id,randomUUID(),{outcome:'RELEASED',reason:'Foreign tenant'}),{status:403});
  await reviews.resolve(ids.org,owner2,self.id,randomUUID(),{outcome:'NO_SUPPORTED_REMEDY',reason:'No approved remedy available'});
  const gaps=await finance.openGapBookingIds(prisma.db,ids.org,new Date(periodStart),false);assert.ok(gaps.has(fixtures[1].booking));
  const r=(await sql('SELECT id FROM transfer_finance_resolutions WHERE review_id=$1',[self.id]))[0];
  for(const query of ['UPDATE transfer_finance_resolutions SET outcome=outcome WHERE id=$1','DELETE FROM transfer_finance_resolutions WHERE id=$1']) await assert.rejects(sql(query,[r.id]),(e:any)=>e.code==='23001');
});

test('extensions after reconciliation serialize, retain admission/rent and write one history event',async()=>{
  const f=fixtures[0], service=new BookingService(prisma);
  const before=(await sql('SELECT to_jsonb(a) value FROM admissions a WHERE booking_id=$1',[f.booking]))[0].value;
  await assert.rejects(service.extend(ctx(requester,'VIEWER'),f.booking,{newEndDate:'2091-01-01',reason:'Denied role'}),{status:403});
  const results=await Promise.allSettled([
    service.extend(ctx(ids.actor),f.booking,{newEndDate:'2091-01-01',reason:'Verified extension'}),
    service.extend(ctx(owner2),f.booking,{newEndDate:'2091-01-01',reason:'Concurrent extension'}),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.getStatus()===400).length,1);
  const history=await service.extensionHistory(ids.org,f.booking);assert.equal(history.length,1);
  assert.equal(history[0]!.previousEndDate,'2090-01-01');assert.equal(history[0]!.newEndDate,'2091-01-01');
  const booking=(await sql('SELECT monthly_price,bed_id FROM bookings WHERE id=$1',[f.booking]))[0];
  assert.equal(String(booking.monthly_price),'5000.00');assert.equal(booking.bed_id,f.source);
  assert.deepEqual((await sql('SELECT to_jsonb(a) value FROM admissions a WHERE booking_id=$1',[f.booking]))[0].value,before);
});

test('checkout and completed-stay correction use the replacement projection without rewriting base segments',async()=>{
  const f=fixtures[0], outAt=new Date(), service=new CheckInService(prisma);
  const checkout=await service.checkOut(ids.org,f.checkin,{checkOutAt:outAt.toISOString()},ids.actor);
  const base=(await sql('SELECT end_at FROM stay_assignments WHERE id=$1',[f.assignment]))[0].end_at.toISOString();
  const proposed=new Date(outAt.getTime()-3600000).toISOString();
  const proposal=await submit(f,proposed,'checkOutAt',checkout.id);
  await corrections(true).approve(ctx(ids.actor),randomUUID(),proposal,approveBody);
  assert.equal((await sql('SELECT end_at FROM stay_assignments WHERE id=$1',[f.assignment]))[0].end_at.toISOString(),base);
  assert.equal((await sql('SELECT end_at FROM effective_stay_assignments WHERE id=$1',[f.assignment]))[0].end_at.toISOString(),proposed);
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignment_replacements WHERE booking_id=$1',[f.booking]))[0].n,3);
  await finance.previewMonthly(ids.org,periodStart.slice(0,7));
  assert.deepEqual((await sql('SELECT to_jsonb(i) value FROM invoices i WHERE id=$1',[moneySnapshot.invoice.id]))[0].value,moneySnapshot.invoice);
  assert.deepEqual(await sql('SELECT to_jsonb(p) value FROM payments p WHERE invoice_id=$1 ORDER BY id',[moneySnapshot.invoice.id]),moneySnapshot.payments);
});

test('review/resolve database constraints protect tenant identity and independent-owner authority',async()=>{
  const f=fixtures[2],self=await record(f,ids.actor);
  await assert.rejects(sql("INSERT INTO transfer_finance_resolutions(organization_id,review_id,actor_user_id,outcome,reason,idempotency_key,request_check) VALUES($1,$2,$3,'RELEASED','Invalid self approval',$4,$5)",
    [ids.org,self.id,ids.actor,randomUUID(),'a'.repeat(64)]),(e:any)=>e.code==='23514');
  const other=(await sql('SELECT resident_id FROM bookings WHERE id=$1',[fixtures[0].booking]))[0].resident_id;
  await assert.rejects(sql('INSERT INTO transfer_finance_reviews(organization_id,transfer_id,booking_id,resident_id,requested_by_user_id,period_start,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [ids.org,f.transfer,f.booking,other,requester,'2099-01-01','Mismatched identity']),(e:any)=>e.code==='23503');
  await assert.rejects(sql('UPDATE transfer_finance_reviews SET reason=reason WHERE id=$1',[self.id]),(e:any)=>e.code==='23001');
});

test('new check-in assignment mirroring is disabled by default and idempotent under an explicit fixture adoption gate',async()=>{
  const disabled=new OriginalAssignmentWriter(new AssignmentAdoptionGate());
  await disabled.mirror({get checkIn(){throw new Error('Disabled adoption must not access assignment sources');}} as any,ids.org,fixtures[1].checkin);
  class FixtureAdoption extends AssignmentAdoptionGate { override enabled(){return true;} }
  const bed=randomUUID(),resident=randomUUID(),booking=randomUUID(),admission=randomUUID();
  await sql("INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,'New stay mirror',now())",[bed,ids.org,ids.property,ids.room]);
  await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'New','Stay',now())",[resident,ids.org]);
  await sql("INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())",[booking,ids.org,resident,bed]);
  await sql("INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())",[admission,ids.org,booking,resident,bed]);
  const writer=new OriginalAssignmentWriter(new FixtureAdoption());
  const checkin=await new CheckInService(prisma,writer).create(ids.org,{admissionId:admission,checkInAt:new Date().toISOString()},ids.actor);
  await prisma.db.$transaction(async tx=>{await acquireOrgGate(tx,ids.org);await writer.mirror(tx,ids.org,checkin.id);});
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignments WHERE booking_id=$1',[booking]))[0].n,1);
  assert.equal((await sql('SELECT count(*)::int n FROM effective_stay_assignments WHERE booking_id=$1',[booking]))[0].n,1);
});

test('backfill retries retain reconciled chains and create no duplicate original assignments',async()=>{
  const before=(await sql('SELECT count(*)::int n FROM stay_assignments'))[0].n;
  const dry=await backfillStayAssignments(true,prisma.db);
  const live=await backfillStayAssignments(false,prisma.db);
  assert.equal(dry.totalCreated,0);assert.equal(live.totalCreated,0);
  assert.ok(!live.quarantined.some((item:any)=>item.bookingId===fixtures[0].booking));
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignments'))[0].n,before);
});

test('active and historical check-in readers expose the physical destination without changing original identity', async () => {
  const service = new CheckInService(prisma);
  for (const f of [fixtures[0], fixtures[2]]) {
    const detail = await service.findOne(ids.org, f.checkin);
    assert.equal(detail.bedId, f.source);
    assert.equal(detail.physicalBed.id, f.dest);
    const page = await service.findAll(ids.org, { residentId: f.resident });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]!.physicalBed.id, f.dest);
  }
});

async function additionalReview(period: string) {
  return prisma.db.$transaction(async tx => { await acquireOrgGate(tx, ids.org); return reviews.recordInTransaction(tx, {
    organizationId: ids.org, transferId: fixtures[2].transfer, requestedByUserId: requester,
    periodStart: period, reason: 'Explicit isolated lifecycle verification',
  }); });
}
const resolutionBody = { outcome: 'RELEASED', reason: 'Independent isolated review' };
test('concurrent finance resolutions commit exactly one decision and one audit; same-key retries replay', async () => {
  const review = await additionalReview('2098-01-01');
  const key = randomUUID();
  const [a,b] = await Promise.all([reviews.resolve(ids.org,ids.actor,review.id,key,resolutionBody),reviews.resolve(ids.org,ids.actor,review.id,key,resolutionBody)]);
  assert.deepEqual(a,b);
  const next = await additionalReview('2098-02-01');
  const results = await Promise.allSettled([reviews.resolve(ids.org,ids.actor,next.id,randomUUID(),resolutionBody),reviews.resolve(ids.org,owner2,next.id,randomUUID(),{outcome:'NO_SUPPORTED_REMEDY',reason:'Independent competing review'})]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 409).length, 1);
  for (const id of [review.id,next.id]) {
    assert.equal((await sql('SELECT count(*)::int n FROM transfer_finance_resolutions WHERE review_id=$1',[id]))[0].n,1);
    assert.equal((await sql("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND action='transfer.finance_review.resolved' AND metadata->>'reviewId'=$2",[ids.org,id]))[0].n,1);
  }
  await sql("UPDATE memberships SET status='REVOKED' WHERE organization_id=$1 AND user_id=$2",[ids.org,ids.actor]);
  try { await assert.rejects(reviews.resolve(ids.org,ids.actor,review.id,key,resolutionBody),{status:403}); }
  finally { await sql("UPDATE memberships SET status='ACTIVE' WHERE organization_id=$1 AND user_id=$2",[ids.org,ids.actor]); }
});

test('finance resolution audit failure rolls back and uncertain commit can be replayed without duplicates', async () => {
  const review = await additionalReview('2098-03-01'), key = randomUUID();
  const failingDb = new Proxy(prisma.db,{get(target,property) {
    if(property === '$transaction') return (fn:any,options:any) => target.$transaction(tx => fn(new Proxy(tx,{get(t,k) {
      if(k === 'auditEvent') return {create:async()=>{throw new Error('Injected audit failure');}};
      const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;
    }})),options);
    const v=Reflect.get(target,property);return typeof v==='function'?v.bind(target):v;
  }});
  const failing = new TransferFinanceService({db:failingDb} as any,new FixtureFinanceGate(),{receiptSecret:()=>secret});
  await assert.rejects(failing.resolve(ids.org,ids.actor,review.id,key,resolutionBody));
  assert.equal((await sql('SELECT count(*)::int n FROM transfer_finance_resolutions WHERE review_id=$1',[review.id]))[0].n,0);
  const lostAckDb = new Proxy(prisma.db,{get(target,property) {
    if(property === '$transaction') return async (fn:any,options:any) => {await target.$transaction(fn,options);throw {code:'P2028'};};
    const v=Reflect.get(target,property);return typeof v==='function'?v.bind(target):v;
  }});
  const lostAck = new TransferFinanceService({db:lostAckDb} as any,new FixtureFinanceGate(),{receiptSecret:()=>secret});
  await assert.rejects(lostAck.resolve(ids.org,ids.actor,review.id,key,resolutionBody),{status:409});
  const replay = await reviews.resolve(ids.org,ids.actor,review.id,key,resolutionBody);
  assert.equal(replay.outcome,'RELEASED');
  assert.equal((await sql('SELECT count(*)::int n FROM transfer_finance_resolutions WHERE review_id=$1',[review.id]))[0].n,1);
  assert.equal((await sql("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND action='transfer.finance_review.resolved' AND metadata->>'reviewId'=$2",[ids.org,review.id]))[0].n,1);
});

test('authority revoked during the organization gate wait denies initial resolution and replay', async () => {
  for (const replay of [false, true]) {
    const review = await additionalReview(replay ? '2098-05-01' : '2098-04-01');
    const key = randomUUID();
    if (replay) await reviews.resolve(ids.org, ids.actor, review.id, key, resolutionBody);
    let signal!: () => void;
    const reachedGate = new Promise<void>(resolve => { signal = resolve; });
    const db = new Proxy(prisma.db, { get(target, property) {
      if (property === '$transaction') return (fn: any, options: any) => target.$transaction(tx => fn(new Proxy(tx, { get(t, k) {
        if (k === '$executeRaw') return (...args: any[]) => {
          if (args.some(value => typeof value === 'string' && value.startsWith('nook:lifecycle-gate:'))) signal();
          return (t.$executeRaw as any)(...args);
        };
        const value = Reflect.get(t, k); return typeof value === 'function' ? value.bind(t) : value;
      } })), options);
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const waiting = new TransferFinanceService({ db } as any, new FixtureFinanceGate(), { receiptSecret: () => secret });
    await withMigratorClient(async holder => {
      await holder.query('BEGIN');
      let denied: Promise<void> | undefined;
      try {
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`nook:lifecycle-gate:${ids.org}`]);
        denied = assert.rejects(waiting.resolve(ids.org, ids.actor, review.id, key, resolutionBody), { status: 403 });
        await reachedGate;
        await sql("UPDATE memberships SET status='REVOKED' WHERE organization_id=$1 AND user_id=$2", [ids.org, ids.actor]);
        await holder.query('ROLLBACK');
        await denied;
      } finally {
        await holder.query('ROLLBACK');
        await sql("UPDATE memberships SET status='ACTIVE' WHERE organization_id=$1 AND user_id=$2", [ids.org, ids.actor]);
      }
    });
    assert.equal((await sql('SELECT count(*)::int n FROM transfer_finance_resolutions WHERE review_id=$1', [review.id]))[0].n, replay ? 1 : 0);
  }
});

test('an active legacy stay with no open segment cannot silently free its physical destination',async()=>{
  const f=fixtures[1];
  await sql("UPDATE stay_assignments SET status='COMPLETED',end_at='2022-01-01' WHERE id=$1",[f.assignment]);
  await assert.rejects(new BookingService(prisma).create(ids.org,{residentId:fixtures[0].resident,bedId:f.dest,startDate:periodStart,endDate:'2090-01-01',monthlyPrice:'5000'},ids.actor),{status:409});
  await assert.rejects(new PrismaInventoryRepository(prisma).archiveBed(ids.org,f.dest),{status:409});
});

test('finance-review HTTP routes enforce session, owner, tenant, origin and CSRF while resolution remains blocked',async()=>{
  const { Module }=await import('@nestjs/common');
  const { NestFactory }=await import('@nestjs/core');
  const { default: request }=await import('supertest');
  const { TransferController }=await import('../../apps/api/src/transfer/transfer.controller.js');
  const { TransferService }=await import('../../apps/api/src/transfer/transfer.service.js');
  const { SessionGuard,RoleGuard,CsrfGuard,OriginGuard }=await import('../../apps/api/src/auth/auth.guards.js');
  const { SessionService }=await import('../../apps/api/src/auth/session.service.js');
  const { CsrfService }=await import('../../apps/api/src/auth/csrf.service.js');
  const runtimeReviews=new TransferFinanceService(prisma,new TransferFinanceGate());
  @Module({controllers:[TransferController],providers:[
    {provide:TransferService,useValue:new TransferService(prisma)},
    {provide:TransferFinanceService,useValue:runtimeReviews},
    {provide:SessionService,useValue:{authenticate:async(token:string)=>token==='owner'?{organizationId:ids.org,userId:ids.actor,role:'OWNER',passwordChangeRequired:false}:token==='pm'?{organizationId:ids.org,userId:requester,role:'PROPERTY_MANAGER',passwordChangeRequired:false}:null}},
    SessionGuard,RoleGuard,CsrfGuard,OriginGuard,CsrfService,
  ]}) class ReviewHttpModule{}
  const previous=process.env.WEB_ORIGIN;process.env.WEB_ORIGIN='http://localhost:5173';
  const app=await NestFactory.create(ReviewHttpModule,{logger:false});await app.init();
  try{
    await request(app.getHttpServer()).get('/transfers/finance-reviews').expect(401);
    await request(app.getHttpServer()).get('/transfers/finance-reviews').set('Cookie','nook_session=pm').expect(403);
    await request(app.getHttpServer()).get('/transfers/finance-reviews').set('Cookie','nook_session=owner').expect(200);
    await request(app.getHttpServer()).get('/transfers/finance-reviews?organizationId=foreign').set('Cookie','nook_session=owner').expect(400);
    const endpoint=`/transfers/finance-reviews/${reviewId}/resolve`;
    await request(app.getHttpServer()).post(endpoint).set('Cookie','nook_session=owner').send({outcome:'RELEASED',reason:'Blocked command'}).expect(403);
    const before=(await sql('SELECT count(*)::int n FROM transfer_finance_resolutions'))[0].n;
    for(let i=0;i<2;i++){
      const response=await request(app.getHttpServer()).post(endpoint).set('Cookie','nook_session=owner; nook_csrf=fixture').set('Origin','http://localhost:5173').set('X-CSRF-Token','fixture').set('Idempotency-Key',ids.actor).send({outcome:'RELEASED',reason:'Blocked command'}).expect(503);
      assert.equal(response.body.code,'TRANSFER_FINANCE_POLICY_UNAVAILABLE');
    }
    assert.equal((await sql('SELECT count(*)::int n FROM transfer_finance_resolutions'))[0].n,before);
  }finally{await app.close();if(previous===undefined)delete process.env.WEB_ORIGIN;else process.env.WEB_ORIGIN=previous;}
});
