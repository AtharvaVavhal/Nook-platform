/* eslint-disable @typescript-eslint/no-explicit-any -- hand-made stand-ins for the database and finance service */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CliRefusal,
  EXIT_REFUSED,
  describeTarget,
  parseCliArguments,
  runCli,
} from '../src/jobs/invoice-schedule.cli.js';
import { InvoiceSchedulerService } from '../src/jobs/invoice-scheduler.service.js';
import { isTransientError, schedulerMonths } from '../src/jobs/schedule-months.js';
import { log } from '../src/observability/json-logger.js';

const ORG_A = '3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e6f';
const ORG_B = '9a2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e70';
const ORG_C = '11111111-2222-4333-8444-555555555555';

// ----------------------------------------------------------------------------------------------- months

test('months: the current IST month and the previous one, oldest first', () => {
  assert.deepEqual(schedulerMonths(new Date('2026-11-03T00:30:00Z'), 1), ['2026-10', '2026-11']);
  assert.deepEqual(schedulerMonths(new Date('2026-11-03T00:30:00Z'), 0), ['2026-11']);
  assert.deepEqual(schedulerMonths(new Date('2026-11-03T00:30:00Z'), 3), [
    '2026-08',
    '2026-09',
    '2026-10',
    '2026-11',
  ]);
});

test('months: the month is chosen in Asia/Kolkata, not in UTC or the server zone', () => {
  // 18:30 UTC on 31 Oct is 00:00 on 1 Nov in India
  assert.deepEqual(schedulerMonths(new Date('2026-10-31T18:30:00Z'), 1), ['2026-10', '2026-11']);
  assert.deepEqual(schedulerMonths(new Date('2026-10-31T18:29:59Z'), 1), ['2026-09', '2026-10']);
  // the 06:00 IST run on the 1st is 00:30 UTC on the 1st
  assert.deepEqual(schedulerMonths(new Date('2027-01-01T00:30:00Z'), 1), ['2026-12', '2027-01']);
  assert.deepEqual(schedulerMonths(new Date('2028-03-01T00:30:00Z'), 1), ['2028-02', '2028-03']);
});

test('months: lookback is bounded', () => {
  for (const bad of [-1, 13, 1.5, Number.NaN]) {
    assert.throws(() => schedulerMonths(new Date(), bad), RangeError);
  }
  assert.equal(schedulerMonths(new Date('2026-11-03T00:30:00Z'), 12).length, 13);
});

// --------------------------------------------------------------------------------------------- retries

test('retry classification: deadlocks and lost connections are transient, validation and conflicts are not', () => {
  for (const code of [
    'P2034',
    'P1001',
    'P1017',
    'P2024',
    '40P01',
    '40001',
    '57P01',
    'ECONNRESET',
  ]) {
    assert.equal(isTransientError({ code }), true, code);
  }
  assert.equal(isTransientError({ code: 'X', cause: { code: '40P01' } }), true);
  assert.equal(
    isTransientError({ meta: { driverAdapterError: { cause: { originalCode: '40001' } } } }),
    true,
  );
  assert.equal(isTransientError(new Error('deadlock detected')), true);
  assert.equal(isTransientError(new Error('Connection terminated unexpectedly')), true);
  for (const error of [
    new Error('Billing month cannot be later than next month'),
    { code: 'P2002' },
    { code: '23505' },
    { code: '23514' },
    null,
    undefined,
    'text',
  ]) {
    assert.equal(isTransientError(error), false, String(JSON.stringify(error)));
  }
});

// ---------------------------------------------------------------------------------------------- service

function makeService(opts: {
  orgs: Array<{ id: string }>;
  generate?: (org: string, actor: unknown, body: any, options: any) => Promise<any>;
  preview?: (org: string, month: string) => Promise<any>;
}) {
  const events: any[] = [];
  const queries: any[] = [];
  const prisma: any = {
    db: {
      organization: {
        findMany: async (args: any) => {
          queries.push(args);
          const ids: string[] | undefined = args.where.id?.in;
          return opts.orgs.filter((o) => !ids || ids.includes(o.id));
        },
      },
      auditEvent: { create: async ({ data }: any) => events.push(data) },
    },
  };
  const calls: Array<{ org: string; month: string; actor: unknown; options: any; body: any }> = [];
  const finance: any = {
    generateMonthly:
      opts.generate ??
      (async (org: string, actor: unknown, body: any, options: any) => {
        calls.push({ org, month: body.month, actor, options, body });
        return { eligibleBookings: 1, created: 1, skippedExisting: 0, skippedZeroPrice: 0 };
      }),
    previewMonthly:
      opts.preview ??
      (async () => ({
        eligibleBookings: 2,
        wouldCreate: 1,
        skippedExisting: 1,
        skippedZeroPrice: 0,
      })),
  };
  return { service: new InvoiceSchedulerService(prisma, finance), events, calls, queries };
}

const quiet = () => {
  log.configure({ level: 'error', sink: () => {} });
};

test('a run covers every active organization, previous month then current, as the system actor with source "scheduler"', async () => {
  quiet();
  const { service, calls, events, queries } = makeService({ orgs: [{ id: ORG_A }, { id: ORG_B }] });
  const result = await service.run({ now: new Date('2026-11-03T00:30:00Z'), runId: ORG_C });
  assert.deepEqual(queries[0].where.status, 'ACTIVE', 'disabled organizations are never listed');
  assert.deepEqual(
    calls.map((c) => [c.org, c.month]),
    [
      [ORG_A, '2026-10'],
      [ORG_A, '2026-11'],
      [ORG_B, '2026-10'],
      [ORG_B, '2026-11'],
    ],
    'organizations one at a time, months oldest first',
  );
  for (const call of calls) {
    assert.equal(call.actor, null, 'the system actor: no user');
    assert.deepEqual(call.options, { source: 'scheduler' });
    assert.equal(call.body.issue, true);
  }
  assert.equal(result.created, 4);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.months, ['2026-10', '2026-11']);
  const run = events.filter((e) => e.action === 'finance.scheduler.run');
  assert.equal(run.length, 1, 'exactly one run event');
  assert.equal(run[0].organizationId, null);
  assert.equal(run[0].requestId, ORG_C, 'the run id');
  assert.equal(run[0].actorUserId, null);
});

test('a run can be limited to named organizations, and an empty filter finds nothing (never "all")', async () => {
  quiet();
  const one = makeService({ orgs: [{ id: ORG_A }, { id: ORG_B }] });
  const result = await one.service.run({ organizationIds: [ORG_B], lookbackMonths: 0 });
  assert.deepEqual(
    one.calls.map((c) => c.org),
    [ORG_B],
  );
  assert.equal(result.organizations, 1);
  const none = makeService({ orgs: [{ id: ORG_A }] });
  const empty = await none.service.run({ organizationIds: [] });
  assert.equal(empty.organizations, 0);
  assert.equal(none.calls.length, 0);
});

test('a failure in one organization does not stop the others; it is recorded against that organization only', async () => {
  quiet();
  const { service, calls, events } = makeService({
    orgs: [{ id: ORG_A }, { id: ORG_B }],
    generate: async (org, actor, body, options) => {
      if (org === ORG_A) throw new Error('Billing month cannot be later than next month');
      calls.push({ org, month: body.month, actor, options, body });
      return { eligibleBookings: 1, created: 1, skippedExisting: 0, skippedZeroPrice: 0 };
    },
  });
  const result = await service.run({ now: new Date('2026-11-03T00:30:00Z'), lookbackMonths: 0 });
  assert.equal(result.failed, 1);
  assert.equal(result.created, 1, 'organization B was still processed');
  assert.deepEqual(
    calls.map((c) => c.org),
    [ORG_B],
  );
  const failure = events.filter((e) => e.action === 'finance.scheduler.failed');
  assert.equal(failure.length, 1);
  assert.equal(
    failure[0].organizationId,
    ORG_A,
    "recorded in the failing organization's own trail",
  );
  assert.equal(failure[0].actorUserId, null);
  assert.equal(failure[0].metadata.month, '2026-11');
  assert.equal(result.results.find((r) => r.organizationId === ORG_A)!.status, 'failed');
});

test('transient failures are retried with exponential backoff and then succeed; permanent ones are not retried', async () => {
  quiet();
  const sleeps: number[] = [];
  let tries = 0;
  const transient = makeService({
    orgs: [{ id: ORG_A }],
    generate: async () => {
      tries += 1;
      if (tries < 3) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      return { eligibleBookings: 1, created: 1, skippedExisting: 0, skippedZeroPrice: 0 };
    },
  });
  const ok = await transient.service.run({
    lookbackMonths: 0,
    backoffMs: 100,
    sleep: async (ms) => void sleeps.push(ms),
  });
  assert.equal(tries, 3);
  assert.deepEqual(sleeps, [100, 200]);
  assert.equal(ok.failed, 0);
  assert.equal(ok.results[0]!.attempts, 3);

  let permanentTries = 0;
  const permanent = makeService({
    orgs: [{ id: ORG_A }],
    generate: async () => {
      permanentTries += 1;
      throw Object.assign(new Error('boom'), { code: 'P2002' });
    },
  });
  const bad = await permanent.service.run({ lookbackMonths: 0, sleep: async () => undefined });
  assert.equal(permanentTries, 1, 'no retry for a permanent error');
  assert.equal(bad.failed, 1);

  let exhausted = 0;
  const forever = makeService({
    orgs: [{ id: ORG_A }],
    generate: async () => {
      exhausted += 1;
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    },
  });
  const gaveUp = await forever.service.run({
    lookbackMonths: 0,
    maxAttempts: 3,
    sleep: async () => undefined,
  });
  assert.equal(exhausted, 3, 'bounded attempts');
  assert.equal(gaveUp.failed, 1);
  assert.equal(gaveUp.results[0]!.attempts, 3);
});

test('a dry run plans and reports but writes nothing: no generation, no audit event', async () => {
  quiet();
  const { service, calls, events } = makeService({ orgs: [{ id: ORG_A }] });
  const result = await service.run({ dryRun: true, lookbackMonths: 1 });
  assert.equal(calls.length, 0, 'generateMonthly is never called');
  assert.equal(events.length, 0, 'not even the run event is written');
  assert.equal(result.dryRun, true);
  assert.equal(result.created, 2, 'would create 1 per month');
  assert.ok(result.results.every((r) => r.status === 'dry-run'));
});

test('the run is logged as structured JSON with its run id, and contains no personal data', async () => {
  const lines: string[] = [];
  log.configure({ level: 'debug', sink: (line) => lines.push(line) });
  const { service } = makeService({ orgs: [{ id: ORG_A }] });
  await service.run({ runId: ORG_C, lookbackMonths: 0 });
  const entries = lines.map((line) => JSON.parse(line));
  assert.ok(entries.some((e) => e.message === 'invoice scheduler started' && e.runId === ORG_C));
  const finished = entries.find((e) => e.message === 'invoice scheduler finished');
  assert.equal(finished.created, 1);
  assert.equal(finished.failed, 0);
  assert.ok(
    entries.every((e) => e.requestId === ORG_C),
    'every line carries the run id as its request id',
  );
  quiet();
});

// ----------------------------------------------------------------------------------------------- CLI

test('arguments: defaults, and every malformed form is refused', () => {
  assert.deepEqual(parseCliArguments([]), {
    dryRun: false,
    lookbackMonths: 1,
    organizationIds: [],
    confirmTarget: undefined,
  });
  assert.deepEqual(
    parseCliArguments([
      '--dry-run',
      '--lookback',
      '3',
      '--org',
      ORG_A,
      '--org',
      ORG_B,
      '--confirm-target',
      'h:5432/db',
    ]),
    {
      dryRun: true,
      lookbackMonths: 3,
      organizationIds: [ORG_A, ORG_B],
      confirmTarget: 'h:5432/db',
    },
  );
  for (const bad of [
    ['--lookback', '13'],
    ['--lookback', '-1'],
    ['--lookback', 'x'],
    ['--org', 'nope'],
    ['--nope'],
    ['positional'],
    ['--lookback'],
  ]) {
    assert.throws(() => parseCliArguments(bad), CliRefusal, bad.join(' '));
  }
  assert.equal(
    describeTarget('postgresql://user:secret@db.internal:5433/nook?sslmode=require'),
    'db.internal:5433/nook',
  );
});

const goodEnv = {
  APP_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://user:SECRETPW@127.0.0.1:1/nook_unit',
};

async function cliExit(argv: string[], env: NodeJS.ProcessEnv) {
  const lines: string[] = [];
  log.configure({ level: 'debug', sink: (line) => lines.push(line) });
  const code = await runCli(argv, env);
  quiet();
  return { code, text: lines.join('\n') };
}

test('a live run is refused (exit 2, nothing touched) unless enabled AND the target is confirmed AND it matches', async () => {
  // port 1 is closed: reaching the database would fail loudly, so these cases prove nothing was attempted
  const disabled = await cliExit(['--confirm-target', '127.0.0.1:1/nook_unit'], goodEnv);
  assert.equal(disabled.code, EXIT_REFUSED);
  assert.match(disabled.text, /disabled/);
  const noConfirm = await cliExit([], { ...goodEnv, BILLING_SCHEDULER_ENABLED: 'true' });
  assert.equal(noConfirm.code, EXIT_REFUSED);
  assert.match(noConfirm.text, /--confirm-target is required/);
  const wrong = await cliExit(['--confirm-target', '127.0.0.1:5433/nook_prod'], {
    ...goodEnv,
    BILLING_SCHEDULER_ENABLED: 'true',
  });
  assert.equal(wrong.code, EXIT_REFUSED);
  assert.match(wrong.text, /does not match the configured target 127\.0\.0\.1:1\/nook_unit/);
  for (const value of ['TRUE', '1', 'yes', 'true ', '']) {
    const odd = await cliExit(['--confirm-target', '127.0.0.1:1/nook_unit'], {
      ...goodEnv,
      BILLING_SCHEDULER_ENABLED: value,
    });
    assert.equal(odd.code, EXIT_REFUSED, `BILLING_SCHEDULER_ENABLED=${JSON.stringify(value)}`);
  }
  for (const out of [disabled, noConfirm, wrong])
    assert.ok(!out.text.includes('SECRETPW'), 'the password is never printed');
});

test('configuration problems are refused with exit 2: no database URL, a bad environment, bad arguments', async () => {
  assert.equal(
    (await cliExit(['--dry-run'], { APP_ENV: 'test', WEB_ORIGIN: 'http://localhost:5173' })).code,
    EXIT_REFUSED,
  );
  assert.equal((await cliExit(['--dry-run'], { ...goodEnv, APP_ENV: 'bogus' })).code, EXIT_REFUSED);
  assert.equal(
    (await cliExit(['--dry-run'], { ...goodEnv, DATABASE_URL: 'https://example.test/x' })).code,
    EXIT_REFUSED,
  );
  assert.equal((await cliExit(['--lookback', '99'], goodEnv)).code, EXIT_REFUSED);
  assert.equal(
    (await cliExit(['--dry-run', '--confirm-target', 'wrong:1/x'], goodEnv)).code,
    EXIT_REFUSED,
  );
  const production = await cliExit(['--dry-run'], {
    ...goodEnv,
    APP_ENV: 'production',
    WEB_ORIGIN: 'https://app.example.test',
  });
  assert.equal(production.code, EXIT_REFUSED, 'production requires TRUST_PROXY_HOPS like the API');
});

test('the job never loads a .env file, so a stray file cannot choose the database', () => {
  for (const file of [
    'run-invoice-schedule.ts',
    'invoice-schedule.cli.ts',
    'invoice-scheduler.service.ts',
    'jobs.module.ts',
  ]) {
    const code = readFileSync(new URL(`../src/jobs/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
      /dotenv/,
      file,
    );
  }
});
