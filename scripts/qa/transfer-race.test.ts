// Transfer race campaign (disposable PostgreSQL only). Engineering evidence, NOT release acceptance:
//  * It drives the real TransferExecutionService through the test-only FixtureGate (production gate stays closed).
//  * It covers spec 11.3 pairs 1, 2, 3, 4 and 7 only. Pairs 5, 6 (admission/check-in on the destination bed) have no
//    safe service path wired here, and pairs 8, 9 involve financial corrections / invoice generation, which need
//    separate owner authorization. Do not count this as the nine-pair campaign.
//  * Iterations default to 1000 per pair (RACE_INTERLEAVINGS). Each iteration uses a fresh synthetic fixture.
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { CheckInService } from '../../apps/api/src/checkin/checkin.service.js';
import { BookingService } from '../../apps/api/src/booking/booking.service.js';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  TransferExecutionService,
  TransferExecutionGate,
  type TransferCommand,
  type TransferApproval,
} from '../../apps/api/src/transfer/transfer.execution.js';
import type { Prisma } from '../../apps/api/src/generated/client.js';

const N = Number(process.env.RACE_INTERLEAVINGS ?? 1000);
const SEED = Number(process.env.RACE_SEED ?? 20261113);
let rngState = SEED >>> 0;
const rnd = () => ((rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const ids = { org: randomUUID(), actor: randomUUID(), requester: randomUUID(), property: randomUUID(), floor: randomUUID(), room: randomUUID() };
const prisma = new PrismaService();
const sql = (query: string, params: unknown[] = []) =>
  withMigratorClient(async (c) => (await c.query(query, params)).rows);

class FixtureGate extends TransferExecutionGate {
  override assertConfigured() {}
  override async authorize(tx: Prisma.TransactionClient, command: TransferCommand): Promise<TransferApproval> {
    const row = await tx.auditEvent.findFirst({
      where: { organizationId: command.organizationId, action: 'test.transfer.approval', targetType: 'stay_assignment',
        metadata: { path: ['commandKey'], equals: command.idempotencyKey } },
    });
    const proof = row?.metadata as any;
    if (!proof || proof.residentId !== command.residentId || proof.destinationBedId !== command.destinationBedId)
      throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
    return { approvalId: row!.id, requestedByUserId: proof.requestedByUserId, approvedByUserId: proof.approvedByUserId,
      sourceAssignmentId: row!.targetId!, bookingId: proof.bookingId };
  }
  override async validateFinance() {}
  override async recordFinanceReview() {}
}
const gate = new FixtureGate();
const engine = () => new TransferExecutionService(prisma, gate, { receiptSecret: () => 'disposable-transfer-receipt-secret-32chars' });

test.before(async () => {
  assert.notEqual(process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED, '1');
  await sql("INSERT INTO organizations(id,name,updated_at) VALUES($1,'Race campaign',now())", [ids.org]);
  for (const [u, n] of [[ids.actor, 'Owner'], [ids.requester, 'Requester']] as const)
    await sql("INSERT INTO users(id,login_identifier,password_hash,display_name,updated_at) VALUES($1,$2,'fixture-only',$3,now())", [u, `${u}@nook.test.invalid`, n]);
  await sql("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'OWNER'),($1,$3,'PROPERTY_MANAGER')", [ids.org, ids.actor, ids.requester]);
  await sql("INSERT INTO properties(id,organization_id,code,name,updated_at) VALUES($1::uuid,$2,$1::text,'P',now())", [ids.property, ids.org]);
  await sql("INSERT INTO floors(id,organization_id,property_id,label,ordinal,updated_at) VALUES($1,$2,$3,'F',0,now())", [ids.floor, ids.org, ids.property]);
  await sql("INSERT INTO rooms(id,organization_id,property_id,floor_id,label,updated_at) VALUES($1,$2,$3,$4,'R',now())", [ids.room, ids.org, ids.property, ids.floor]);
});
test.after(async () => { await prisma.onModuleDestroy(); });

async function bed() {
  const id = randomUUID();
  await sql('INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,$5,now())', [id, ids.org, ids.property, ids.room, `Bed ${id}`]);
  return id;
}
/** A resident with an open booking, admission, check-in and one ACTIVE original assignment on a fresh bed. */
async function stay() {
  const f = { resident: randomUUID(), source: await bed(), booking: randomUUID(), admission: randomUUID(), checkin: randomUUID() };
  await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Race','Fixture',now())", [f.resident, ids.org]);
  await sql("INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())", [f.booking, ids.org, f.resident, f.source]);
  await sql("INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())", [f.admission, ids.org, f.booking, f.resident, f.source]);
  await sql("INSERT INTO check_ins(id,organization_id,admission_id,resident_id,bed_id,booking_id,check_in_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01',now())", [f.checkin, ids.org, f.admission, f.resident, f.source, f.booking]);
  await sql("INSERT INTO stay_assignments(organization_id,booking_id,resident_id,bed_id,kind,status,start_at) VALUES($1,$2,$3,$4,'ORIGINAL','ACTIVE','2020-01-01')", [ids.org, f.booking, f.resident, f.source]);
  return f;
}
async function command(f: { resident: string; booking: string }, destinationBedId: string) {
  const current = (await sql("SELECT id FROM stay_assignments WHERE booking_id=$1 AND status='ACTIVE'", [f.booking]))[0];
  const c = { organizationId: ids.org, actorUserId: ids.actor, actorRole: 'OWNER', residentId: f.resident, destinationBedId,
    effectiveAt: new Date(), idempotencyKey: randomUUID(), reason: 'Disposable race campaign' };
  await prisma.db.auditEvent.create({ data: { organizationId: ids.org, actorUserId: ids.actor, action: 'test.transfer.approval',
    targetType: 'stay_assignment', targetId: current.id, requestId: randomUUID(),
    metadata: { commandKey: c.idempotencyKey, residentId: f.resident, destinationBedId, bookingId: f.booking,
      requestedByUserId: ids.requester, approvedByUserId: ids.actor } } });
  return c;
}

type Settled = PromiseSettledResult<unknown>;
const status = (r: Settled) => (r.status === 'fulfilled' ? 200 : ((r.reason as any)?.getStatus?.() ?? (r.reason as any)?.status ?? 'ERR'));
const isDeadlock = (r: Settled) => r.status === 'rejected' && /deadlock|40P01/i.test(String((r.reason as any)?.message ?? '') + JSON.stringify((r.reason as any)?.meta ?? ''));

/** Launch operations in random order with a small random stagger so interleavings vary between iterations. */
async function race(ops: Array<() => Promise<unknown>>): Promise<Settled[]> {
  // Every operation gets an independent random start delay (0-39 ms) so that either side can win; the transfer engine
  // is slower than the competing operations, so a tiny stagger would let one side win almost every run.
  const delays = ops.map(() => (rnd() < 0.25 ? 0 : Math.floor(rnd() * 40)));
  const started = ops.map(async (_, i) => {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    return [i, (await Promise.allSettled([ops[i]!()]))[0]!] as const;
  });
  const done = await Promise.all(started);
  const out: Settled[] = [];
  for (const [i, r] of done) out[i] = r;
  return out;
}
async function effects(bookings: string[]) {
  const transfers = (await sql('SELECT id FROM transfers WHERE booking_id = ANY($1::uuid[])', [bookings])).map((r) => r.id as string);
  const receipts = transfers.length ? (await sql('SELECT count(*)::int n FROM transfer_command_receipts WHERE transfer_id = ANY($1::uuid[])', [transfers]))[0].n : 0;
  const audits = transfers.length ? (await sql("SELECT count(*)::int n FROM audit_events WHERE metadata->>'transferId' = ANY($1::text[])", [transfers]))[0].n : 0;
  return { transfers: transfers.length, receipts, audits };
}
async function activeFor(booking: string) {
  return (await sql("SELECT count(*)::int n FROM stay_assignments WHERE booking_id=$1 AND status='ACTIVE'", [booking]))[0].n as number;
}

interface Tally { pair: string; description: string; iterations: number; deadlocks: number; unexpected: number; violations: string[]; outcomes: Record<string, number>; transfers: number; receipts: number; audits: number }
const report = (t: Tally) => console.log(JSON.stringify({ probe: 'race-pair', ...t, violations: t.violations.slice(0, 5), violationCount: t.violations.length }));

async function campaign(pair: string, description: string, iteration: () => Promise<{ results: Settled[]; check: () => Promise<string[]>; bookings: string[] }>) {
  const t: Tally = { pair, description, iterations: 0, deadlocks: 0, unexpected: 0, violations: [], outcomes: {}, transfers: 0, receipts: 0, audits: 0 };
  for (let i = 0; i < N; i++) {
    const { results, check, bookings } = await iteration();
    t.iterations++;
    t.deadlocks += results.filter(isDeadlock).length;
    const codes = results.map(status);
    t.unexpected += codes.filter((c) => c !== 200 && c !== 409).length;
    const key = codes.join('/'); t.outcomes[key] = (t.outcomes[key] ?? 0) + 1;
    const e = await effects(bookings);
    t.transfers += e.transfers; t.receipts += e.receipts; t.audits += e.audits;
    if (e.receipts !== e.transfers) t.violations.push(`iter ${i}: receipts ${e.receipts} != transfers ${e.transfers}`);
    if (e.audits !== 3 * e.transfers) t.violations.push(`iter ${i}: audits ${e.audits} != 3x transfers ${e.transfers}`);
    for (const v of await check()) t.violations.push(`iter ${i}: ${v}`);
  }
  report(t);
  assert.equal(t.deadlocks, 0, `${pair}: deadlocks`);
  assert.equal(t.unexpected, 0, `${pair}: statuses other than success/409`);
  assert.deepEqual(t.violations, [], `${pair}: invariant violations`);
}
const exactlyOne = (r: Settled[]) => (r.filter((x) => x.status === 'fulfilled').length === 1 ? [] : [`expected exactly one success, got ${r.map(status).join('/')}`]);

test(`pair 1: two transfers moving the same resident (${N} runs)`, { timeout: 1_800_000 }, async () => {
  await campaign('1', 'two transfers, same resident/source', async () => {
    const f = await stay(); const a = await command(f, await bed()); const b = await command(f, await bed());
    const results = await race([() => engine().execute(a), () => engine().execute(b)]);
    return { results, bookings: [f.booking], check: async () => [...exactlyOne(results), ...((await activeFor(f.booking)) === 1 ? [] : ['active assignments != 1'])] };
  });
});

test(`pair 2: transfer versus checkout (${N} runs)`, { timeout: 1_800_000 }, async () => {
  await campaign('2', 'transfer vs checkout, same resident', async () => {
    const f = await stay(); const c = await command(f, await bed());
    const results = await race([() => engine().execute(c), () => new CheckInService(prisma).checkOut(ids.org, f.checkin, { checkOutAt: new Date().toISOString() }, ids.actor)]);
    return { results, bookings: [f.booking], check: async () => {
      const v: string[] = [];
      if (results[1]!.status !== 'fulfilled') v.push('checkout did not succeed');
      if ((await activeFor(f.booking)) !== 0) v.push('open assignment remains after checkout');
      if ((await sql('SELECT count(*)::int n FROM check_outs WHERE check_in_id=$1', [f.checkin]))[0].n !== 1) v.push('check_outs != 1');
      return v;
    } };
  });
});

test(`pair 3: transfer versus extension (${N} runs)`, { timeout: 1_800_000 }, async () => {
  await campaign('3', 'transfer vs extension, same booking, destination has a later booking', async () => {
    const f = await stay(); const dest = await bed(); const other = randomUUID();
    await sql("INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Race','Other',now())", [other, ids.org]);
    await sql("INSERT INTO bookings(organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,'2090-01-01','2092-01-01',5000,now())", [ids.org, other, dest]);
    const c = await command(f, dest);
    const results = await race([() => engine().execute(c), () => new BookingService(prisma).extend({ organizationId: ids.org, userId: ids.actor, role: 'OWNER' }, f.booking, { newEndDate: '2091-01-01', reason: 'Concurrent extension' })]);
    return { results, bookings: [f.booking], check: async () => exactlyOne(results) };
  });
});

test(`pair 4: transfer versus new booking on the destination bed (${N} runs)`, { timeout: 1_800_000 }, async () => {
  await campaign('4', 'transfer vs booking create on destination', async () => {
    const f = await stay(); const g = await stay(); const dest = await bed(); const c = await command(f, dest);
    const results = await race([() => engine().execute(c), () => new BookingService(prisma).create(ids.org, { residentId: g.resident, bedId: dest, startDate: '2026-11-01', endDate: '2080-01-01', monthlyPrice: '5000' }, ids.actor)]);
    return { results, bookings: [f.booking], check: async () => exactlyOne(results) };
  });
});

test(`pair 7: two transfers targeting one destination bed (${N} runs)`, { timeout: 1_800_000 }, async () => {
  await campaign('7', 'two residents, same destination bed', async () => {
    const f = await stay(); const g = await stay(); const dest = await bed();
    const a = await command(f, dest); const b = await command(g, dest);
    const results = await race([() => engine().execute(a), () => engine().execute(b)]);
    return { results, bookings: [f.booking, g.booking], check: async () => [...exactlyOne(results),
      ...((await sql("SELECT count(*)::int n FROM stay_assignments WHERE bed_id=$1 AND status='ACTIVE'", [dest]))[0].n === 1 ? [] : ['destination has != 1 active assignment'])] };
  });
});
