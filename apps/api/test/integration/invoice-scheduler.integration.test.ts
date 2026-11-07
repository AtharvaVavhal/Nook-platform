/* eslint-disable @typescript-eslint/no-explicit-any -- untyped result rows and log lines */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../../src/database/prisma.service.js';
import { FinanceService } from '../../src/finance/finance.service.js';
import { dueDateAtIssue, parseBillingMonth, shiftMonth } from '../../src/finance/finance.util.js';
import { describeTarget } from '../../src/jobs/invoice-schedule.cli.js';
import { InvoiceSchedulerService } from '../../src/jobs/invoice-scheduler.service.js';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import { schedulerMonths } from '../../src/jobs/schedule-months.js';
import { log } from '../../src/observability/json-logger.js';
import { seedBillingOrg, seedStay, type BillingOrg } from './helpers/billing-fixtures.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';

// The invoice scheduler against a real PostgreSQL with the Layer 1 and invoice-uniqueness migrations applied (the isolated
// scratch database). Service-level tests call the same scheduler the job runs, restricted to the organizations each test
// creates (`organizationIds`), so nothing else in the database is ever billed.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
const DATABASE_URL = requireTestDatabaseUrl();

const DAY = 86_400_000;
const [PREV, CUR] = schedulerMonths(new Date(), 1) as [string, string];
const prevStart = parseBillingMonth(PREV).periodStart;
const curStart = parseBillingMonth(CUR).periodStart;

let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
let scheduler: InvoiceSchedulerService;
let finance: FinanceService;
let prisma: PrismaService;
const sqlRows = (query: string, params: unknown[] = []) =>
  withMigratorClient(async (c) => (await c.query(query, params)).rows);
const count = async (query: string, params: unknown[] = []) =>
  Number((await sqlRows(query, params))[0].n);
const invoices = (orgId: string) =>
  sqlRows(
    `SELECT id, booking_id, resident_id, to_char(period_start,'YYYY-MM') AS month, status, number, issued_at, to_char(due_date,'YYYY-MM-DD') AS due
       FROM invoices WHERE organization_id = $1 ORDER BY period_start, number`,
    [orgId],
  );
const events = (orgId: string, action: string) =>
  sqlRows(
    `SELECT actor_user_id, request_id, target_id, metadata FROM audit_events WHERE organization_id = $1 AND action = $2`,
    [orgId, action],
  );
const quiet = () => log.configure({ level: 'error', sink: () => {} });

test.before(async () => {
  app = await NestFactory.createApplicationContext(JobsModule, { logger: false });
  scheduler = app.get(InvoiceSchedulerService);
  finance = app.get(FinanceService);
  prisma = app.get(PrismaService);
  quiet();
});
test.after(async () => {
  await app.close();
});

const runFor = (orgs: BillingOrg[], extra: Record<string, unknown> = {}) =>
  scheduler.run({ organizationIds: orgs.map((o) => o.orgId), ...extra });

// ------------------------------------------------------------------------------------------- per booking

test('one run bills the previous and the current month, per booking, issued, with the due-date rule and one audit event each', async () => {
  const org = await seedBillingOrg();
  const stay = await seedStay(org, {
    price: '4200.00',
    checkInAt: new Date(prevStart.getTime() + 2 * DAY),
  });
  const first = await runFor([org]);
  assert.equal(first.failed, 0);
  assert.equal(first.created, 2);
  const rows = await invoices(org.orgId);
  assert.deepEqual(
    rows.map((r) => [r.month, r.status, r.booking_id]),
    [
      [PREV, 'ISSUED', stay.booking],
      [CUR, 'ISSUED', stay.booking],
    ],
  );
  for (const row of rows) {
    const rule = dueDateAtIssue(parseBillingMonth(row.month).periodStart, new Date(row.issued_at));
    assert.equal(row.due, rule.toISOString().slice(0, 10), 'later of the 5th and the issue date');
  }
  // exactly one issued event per invoice, by the system, from the scheduler, linked to the run
  const issued = await events(org.orgId, 'finance.invoice.issued');
  assert.equal(issued.length, 2);
  assert.deepEqual(
    [...new Set(issued.map((e) => e.target_id))].sort(),
    rows.map((r) => r.id).sort(),
  );
  for (const event of issued) {
    assert.equal(event.actor_user_id, null, 'the system actor');
    assert.equal(event.metadata.source, 'scheduler');
    assert.equal(event.metadata.automatic, true);
    assert.equal(event.request_id, first.runId);
  }
  assert.equal(
    (await events(org.orgId, 'finance.invoices.generated')).length,
    2,
    'one batch event per month',
  );
  const runEvent = await sqlRows(
    `SELECT organization_id, metadata FROM audit_events WHERE action = 'finance.scheduler.run' AND target_id = $1`,
    [first.runId],
  );
  assert.equal(runEvent.length, 1);
  assert.equal(runEvent[0].organization_id, null);
  assert.equal(runEvent[0].metadata.created, 2);

  // idempotent: a second run creates nothing and writes no further organization events
  const eventCountBefore = await count(
    `SELECT count(*) n FROM audit_events WHERE organization_id = $1`,
    [org.orgId],
  );
  const second = await runFor([org]);
  assert.equal(second.created, 0);
  assert.equal(second.failed, 0);
  assert.equal((await invoices(org.orgId)).length, 2);
  assert.equal(
    await count(`SELECT count(*) n FROM audit_events WHERE organization_id = $1`, [org.orgId]),
    eventCountBefore,
  );
});

test('bed transfer: two bookings of one resident in a month are billed independently, once', async () => {
  const org = await seedBillingOrg();
  const a = await seedStay(org, {
    price: '5000.00',
    checkInAt: new Date(curStart.getTime() + 2 * DAY),
    checkedOutAt: new Date(curStart.getTime() + 14 * DAY),
  });
  const b = await seedStay(org, {
    residentId: a.resident,
    price: '6500.00',
    checkInAt: new Date(curStart.getTime() + 15 * DAY),
  });
  const run = await runFor([org], { lookbackMonths: 0 });
  assert.equal(run.created, 2);
  const rows = await sqlRows(
    `SELECT booking_id, amount::text AS amount FROM invoices WHERE organization_id = $1`,
    [org.orgId],
  );
  const amounts = new Map(rows.map((r) => [r.booking_id, r.amount]));
  assert.equal(amounts.get(a.booking), '5000.00');
  assert.equal(amounts.get(b.booking), '6500.00');
  assert.equal((await runFor([org], { lookbackMonths: 0 })).created, 0);
});

test('a voided invoice is replaced by the next run exactly once; history and audit are kept', async () => {
  const org = await seedBillingOrg();
  await seedStay(org, { price: '3000.00', checkInAt: new Date(curStart.getTime() + 1 * DAY) });
  await runFor([org], { lookbackMonths: 0 });
  const [original] = await invoices(org.orgId);
  await finance.voidInvoice(org.orgId, org.userId, original.id, {
    reason: 'Issued with the wrong rent',
  });

  const replaced = await runFor([org], { lookbackMonths: 0 });
  assert.equal(replaced.created, 1, 'the voided month is billed again');
  assert.equal((await runFor([org], { lookbackMonths: 0 })).created, 0, 'and only once');
  const rows = await invoices(org.orgId);
  assert.deepEqual(rows.map((r) => r.status).sort(), ['CANCELLED', 'ISSUED']);
  assert.equal(
    rows.find((r) => r.status === 'CANCELLED')!.id,
    original.id,
    'the voided invoice is kept',
  );
  assert.equal(
    await count(`SELECT count(*) n FROM invoice_voids WHERE invoice_id = $1`, [original.id]),
    1,
  );
  assert.equal(
    (await events(org.orgId, 'finance.invoice.issued')).length,
    2,
    'one event per invoice ever issued',
  );
});

test('missed-run recovery: the next run bills the month that was missed, and only that one', async () => {
  const org = await seedBillingOrg();
  await seedStay(org, { price: '2500.00', checkInAt: new Date(prevStart.getTime() + 3 * DAY) });
  assert.equal(
    (await runFor([org], { lookbackMonths: 0 })).created,
    1,
    'only the current month ran',
  );
  assert.deepEqual(
    (await invoices(org.orgId)).map((r) => r.month),
    [CUR],
  );
  const recovery = await runFor([org], { lookbackMonths: 1 });
  assert.equal(recovery.created, 1);
  assert.deepEqual(
    (await invoices(org.orgId)).map((r) => r.month),
    [PREV, CUR],
  );
});

test('an approved extension is part of the same booking: it makes the next month billable, once, on the same booking', async () => {
  const org = await seedBillingOrg();
  const stay = await seedStay(org, {
    price: '4000.00',
    checkInAt: new Date(prevStart.getTime() + 2 * DAY),
    bookingEnd: curStart, // exclusive: the booking ends as the current month begins
  });
  const before = await runFor([org], { lookbackMonths: 1 });
  assert.equal(before.created, 1, 'only the previous month is covered by the booking');
  await withMigratorClient((c) =>
    c.query(`UPDATE bookings SET end_date = $2 WHERE id = $1`, [
      stay.booking,
      new Date(curStart.getTime() + 60 * DAY),
    ]),
  );
  const after = await runFor([org], { lookbackMonths: 1 });
  assert.equal(after.created, 1, 'the extension makes the current month billable');
  assert.equal((await runFor([org], { lookbackMonths: 1 })).created, 0);
  const rows = await invoices(org.orgId);
  assert.equal(new Set(rows.map((r) => r.booking_id)).size, 1, 'one booking');
  assert.equal(rows.length, 2);
});

// -------------------------------------------------------------------------- duplicate and concurrent runs

test('duplicate and concurrent runs, even alongside manual generation, never duplicate an invoice or a number', async () => {
  const org = await seedBillingOrg();
  for (let i = 0; i < 4; i += 1) {
    await seedStay(org, {
      price: `${3000 + i * 100}.00`,
      checkInAt: new Date(prevStart.getTime() + (2 + i) * DAY),
    });
  }
  const results = await Promise.all([
    runFor([org]),
    runFor([org]),
    runFor([org]),
    runFor([org]),
    finance.generateMonthly(org.orgId, org.userId, { month: CUR, issue: true }),
    finance.generateMonthly(org.orgId, org.userId, { month: PREV, issue: true }),
  ]);
  for (const r of results.slice(0, 4) as any[])
    assert.equal(r.failed, 0, JSON.stringify(r.results.filter((x: any) => x.error)));
  const rows = await invoices(org.orgId);
  assert.equal(rows.length, 8, '4 bookings x 2 months, no more');
  assert.equal(
    new Set(rows.map((r) => `${r.booking_id}|${r.month}`)).size,
    8,
    'one per booking and month',
  );
  const numbers = rows.map((r) => Number(String(r.number).slice(-4))).sort((x, y) => x - y);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8], 'unique and gap-free');
  assert.equal(
    (await events(org.orgId, 'finance.invoice.issued')).length,
    8,
    'exactly one issued event per invoice',
  );
  const totalCreated = results.reduce((sum, r: any) => sum + (r.created ?? 0), 0);
  assert.equal(totalCreated, 8, 'the creations add up to the invoices that exist');
});

// ------------------------------------------------------------------------------------- tenant isolation

test('tenant isolation: only the named active organizations are billed, each only for its own bookings', async () => {
  const x = await seedBillingOrg();
  const y = await seedBillingOrg();
  const disabled = await seedBillingOrg('DISABLED');
  const bystander = await seedBillingOrg();
  for (const org of [x, y, disabled, bystander]) {
    await seedStay(org, { price: '1000.00', checkInAt: new Date(prevStart.getTime() + 2 * DAY) });
  }
  const run = await scheduler.run({ organizationIds: [x.orgId, y.orgId, disabled.orgId] });
  assert.equal(run.organizations, 2, 'the DISABLED organization is not listed');
  assert.equal((await invoices(disabled.orgId)).length, 0);
  assert.equal(
    (await invoices(bystander.orgId)).length,
    0,
    'an organization outside the filter is untouched',
  );
  for (const org of [x, y]) {
    assert.equal((await invoices(org.orgId)).length, 2);
    const mismatched = await count(
      `SELECT count(*) n FROM invoices i JOIN bookings b ON b.id = i.booking_id
        WHERE i.organization_id = $1 AND (b.organization_id <> i.organization_id OR b.resident_id <> i.resident_id)`,
      [org.orgId],
    );
    assert.equal(mismatched, 0);
    const foreignEvents = await count(
      `SELECT count(*) n FROM audit_events a WHERE a.organization_id = $1 AND a.action = 'finance.invoice.issued'
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id::text = a.target_id AND i.organization_id = a.organization_id)`,
      [org.orgId],
    );
    assert.equal(foreignEvents, 0, 'every event points at an invoice of its own organization');
  }
});

test("a failure in one organization is isolated, recorded in that organization's trail, and retried by the next run", async () => {
  const x = await seedBillingOrg();
  const y = await seedBillingOrg();
  for (const org of [x, y])
    await seedStay(org, { price: '1800.00', checkInAt: new Date(curStart.getTime() + 1 * DAY) });
  const flaky = new InvoiceSchedulerService(prisma, {
    generateMonthly: (orgId, actor, body, options) => {
      if (orgId === x.orgId)
        throw Object.assign(new Error('unexpected failure in organization X'), { code: 'XX000' });
      return finance.generateMonthly(orgId, actor, body, options);
    },
    previewMonthly: (orgId, month) => finance.previewMonthly(orgId, month),
  });
  const broken = await flaky.run({
    organizationIds: [x.orgId, y.orgId],
    lookbackMonths: 0,
    sleep: async () => undefined,
  });
  assert.equal(broken.failed, 1);
  assert.equal((await invoices(x.orgId)).length, 0);
  assert.equal((await invoices(y.orgId)).length, 1, 'organization Y was billed');
  const failure = await events(x.orgId, 'finance.scheduler.failed');
  assert.equal(failure.length, 1);
  assert.equal(failure[0].actor_user_id, null);
  assert.equal(failure[0].request_id, broken.runId);
  assert.equal(
    (await events(y.orgId, 'finance.scheduler.failed')).length,
    0,
    "not in the other organization's trail",
  );

  // the next (healthy) run repairs it
  const repaired = await runFor([x, y], { lookbackMonths: 0 });
  assert.equal(repaired.created, 1);
  assert.equal((await invoices(x.orgId)).length, 1);
  assert.equal((await invoices(y.orgId)).length, 1);
});

test('a transient database failure is retried and the organization is still billed exactly once', async () => {
  const org = await seedBillingOrg();
  await seedStay(org, { price: '2200.00', checkInAt: new Date(curStart.getTime() + 1 * DAY) });
  let calls = 0;
  const retrying = new InvoiceSchedulerService(prisma, {
    generateMonthly: async (orgId, actor, body, options) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      return finance.generateMonthly(orgId, actor, body, options);
    },
    previewMonthly: (orgId, month) => finance.previewMonthly(orgId, month),
  });
  const result = await retrying.run({
    organizationIds: [org.orgId],
    lookbackMonths: 0,
    sleep: async () => undefined,
  });
  assert.equal(calls, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0]!.attempts, 2);
  assert.equal((await invoices(org.orgId)).length, 1);
  assert.equal((await events(org.orgId, 'finance.invoice.issued')).length, 1);
});

// ------------------------------------------------------------------------------------ dry run and logs

test('a dry run reports what a live run would do and writes nothing at all', async () => {
  const org = await seedBillingOrg();
  await seedStay(org, { price: '2000.00', checkInAt: new Date(prevStart.getTime() + 2 * DAY) });
  const scopeCount = () =>
    count(
      `SELECT (SELECT count(*) FROM invoices WHERE organization_id = $1) + (SELECT count(*) FROM audit_events WHERE organization_id = $1 OR action LIKE 'finance.scheduler.%') AS n`,
      [org.orgId],
    );
  const before = await scopeCount();
  const dry = await runFor([org], { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.created, 2, 'would create the previous and the current month');
  assert.equal(await scopeCount(), before, 'no invoice and no audit event, not even the run event');
  const live = await runFor([org]);
  assert.equal(live.created, 2, 'and the live run does exactly what the dry run said');
});

test('logging: structured, tied to the run id, and free of resident names and amounts', async () => {
  const org = await seedBillingOrg();
  const secretName = `Zzyzx${Math.random().toString(36).slice(2, 8)}`;
  await seedStay(org, {
    name: secretName,
    price: '7777.00',
    checkInAt: new Date(curStart.getTime() + 1 * DAY),
  });
  const lines: string[] = [];
  log.configure({ level: 'debug', sink: (line) => lines.push(line) });
  try {
    const run = await runFor([org], { lookbackMonths: 0 });
    const parsed = lines.map((line) => JSON.parse(line));
    assert.ok(parsed.length >= 3);
    assert.ok(
      parsed.every((e) => e.requestId === run.runId),
      'every line carries the run id',
    );
    const processed = parsed.find(
      (e) => e.message === 'invoice scheduler processed an organization month',
    );
    assert.equal(processed.organizationId, org.orgId);
    assert.equal(processed.created, 1);
    const text = lines.join('\n');
    assert.ok(
      !text.includes(secretName) && !text.includes('7777'),
      'no resident name and no amount in the log',
    );
  } finally {
    quiet();
  }
});

// ------------------------------------------------------------------------------ the job as a process

const entry = new URL('../../src/jobs/run-invoice-schedule.ts', import.meta.url).pathname;
function job(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync('node', ['--import', 'tsx', entry, ...args], {
    env: {
      PATH: process.env.PATH ?? '',
      APP_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'info',
      DATABASE_URL,
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 60_000,
    cwd: new URL('../../', import.meta.url).pathname,
  });
  const lines = String(r.stdout)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l };
      }
    });
  return { code: r.status, lines, stdout: String(r.stdout) };
}

test('the job process: refuses without enablement or with a wrong target, dry-runs safely, and a live run is idempotent', async () => {
  const org = await seedBillingOrg();
  await seedStay(org, { price: '1500.00', checkInAt: new Date(curStart.getTime() + 1 * DAY) });
  const target = describeTarget(DATABASE_URL);
  const filter = ['--org', org.orgId, '--lookback', '0'];

  const disabled = job([...filter, '--confirm-target', target]);
  assert.equal(disabled.code, 2);
  const wrong = job([...filter, '--confirm-target', 'localhost:5433/nook_dev'], {
    BILLING_SCHEDULER_ENABLED: 'true',
  });
  assert.equal(wrong.code, 2);
  assert.equal((await invoices(org.orgId)).length, 0, 'refusals touched nothing');
  for (const out of [disabled, wrong])
    assert.ok(!out.stdout.includes(new URL(DATABASE_URL).password), 'no password in the output');

  const dry = job([...filter, '--dry-run']);
  assert.equal(dry.code, 0);
  assert.equal(dry.lines.find((l) => l.message === 'invoice scheduler finished')?.dryRun, true);
  assert.equal((await invoices(org.orgId)).length, 0, 'a dry run writes nothing');

  const live = job([...filter, '--confirm-target', target], { BILLING_SCHEDULER_ENABLED: 'true' });
  assert.equal(live.code, 0, live.stdout.slice(-400));
  assert.equal(live.lines.find((l) => l.message === 'invoice scheduler finished')?.created, 1);
  assert.equal((await invoices(org.orgId)).length, 1);

  const again = job([...filter, '--confirm-target', target], { BILLING_SCHEDULER_ENABLED: 'true' });
  assert.equal(again.code, 0);
  assert.equal(
    again.lines.find((l) => l.message === 'invoice scheduler finished')?.created,
    0,
    'a repeat creates nothing',
  );
  assert.equal((await invoices(org.orgId)).length, 1);
  assert.equal((await events(org.orgId, 'finance.invoice.issued')).length, 1);
  void shiftMonth;
});
