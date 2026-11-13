/** Real PostgreSQL/Prisma probes on the verified initial-migration database.
 * These demonstrate driver behaviour; they do not certify correction-service latency or full A1–A10 acceptance.
 */
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/client.js';
import {
  acquireOrgGate,
  setLocalLockTimeout,
  orgGateKeyText,
} from '../../apps/api/src/common/org-gate.js';
import { classifyFailure, sqlStates } from '../../apps/api/src/common/tx-errors.js';
import { correctionDeadlineClient } from '../../apps/api/src/common/correction-deadline.js';
import { requireTestDatabaseUrl } from '../../apps/api/test/integration/helpers/env.js';
import {
  createMigratorClient,
  withMigratorClient,
} from '../../apps/api/test/integration/helpers/db.js';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireTestDatabaseUrl(), max: 10 }),
});
const org = randomUUID();
const second = randomUUID();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
// Record the actual nesting/values used for classification. Messages/SQL are excluded, not fabricated.
function shape(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error;
  const out: Record<string, unknown> = {};
  for (const key of [
    'name',
    'code',
    'originalCode',
    'kind',
    'meta',
    'cause',
    'driverAdapterError',
    'constraint',
    'fields',
    'index',
    'modelName',
  ]) {
    if (key in error) {
      const value = (error as Record<string, unknown>)[key];
      out[key] = Array.isArray(value) ? value : typeof value === 'object' ? shape(value) : value;
    }
  }
  return out;
}
async function failure(label: string, fn: () => Promise<unknown>, expected: string) {
  let error: unknown;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  assert.ok(error, `${label} must fail`);
  console.log(
    JSON.stringify({
      probe: label,
      shape: shape(error),
      sqlStates: sqlStates(error),
      classification: classifyFailure(error),
    }),
  );
  assert.equal(classifyFailure(error), expected);
}
test.before(async () => {
  await withMigratorClient(async (c) => {
    await c.query(
      "INSERT INTO organizations (id,name,updated_at) VALUES ($1,'Gate probe',now()),($2,'Gate probe 2',now())",
      [org, second],
    );
  });
});
test.after(async () => {
  await db.$disconnect();
});

test('advisory lock_timeout aborts the ordinary gate wait and rolls back preceding writes', async () => {
  const holder = createMigratorClient();
  await holder.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      orgGateKeyText(org),
    ]);
    const start = performance.now();
    await failure(
      'advisory-55P03',
      () =>
        db.$transaction(
          async (tx) => {
            await tx.$executeRaw`UPDATE organizations SET name = 'must roll back' WHERE id = ${org}::uuid`;
            await acquireOrgGate(tx, org);
          },
          { timeout: 10_000 },
        ),
      'LOCK_TIMEOUT',
    );
    const elapsed = performance.now() - start;
    console.log(
      JSON.stringify({
        probe: 'ordinary-advisory-wait',
        elapsedMs: elapsed,
        configuredLockTimeoutMs: 3000,
      }),
    );
    assert.ok(elapsed >= 2900 && elapsed < 4500, `bounded wait: ${elapsed}`);
    assert.equal(
      (await holder.query('SELECT name FROM organizations WHERE id=$1', [org])).rows[0].name,
      'Gate probe',
    );
  } finally {
    await holder.query('ROLLBACK');
    await holder.end();
  }
});

test('row lock_timeout aborts with exact 55P03 and no automatic-retry classification', async () => {
  const holder = createMigratorClient();
  await holder.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [org]);
    await failure(
      'row-55P03',
      () =>
        db.$transaction(async (tx) => {
          await setLocalLockTimeout(tx, 150);
          await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${org}::uuid FOR UPDATE`;
        }),
      'LOCK_TIMEOUT',
    );
  } finally {
    await holder.query('ROLLBACK');
    await holder.end();
  }
});

test('performance bounds: cancellation, remaining budget, and genuine serialization failure', async () => {
  const measurements: unknown[] = [];
  const timed = async (label:string, fn:()=>Promise<unknown>) => {
    const start=performance.now();
    try { await fn(); measurements.push({label,elapsedMs:performance.now()-start,outcome:'committed'}); }
    catch(error) { measurements.push({label,elapsedMs:performance.now()-start,shape:shape(error),sqlStates:sqlStates(error),classification:classifyFailure(error)}); }
  };
  const holder=createMigratorClient(); await holder.connect();
  try {
    await holder.query('BEGIN'); await holder.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);
    await timed('remaining-budget-row-timeout',()=>db.$transaction(async(tx)=>{
      await delay(350); await setLocalLockTimeout(tx,50);
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${org}::uuid FOR UPDATE`;
    },{timeout:500}));
  } finally { await holder.query('ROLLBACK'); await holder.end(); }
  await timed('transaction-timeout-rollback',()=>db.$transaction(async(tx)=>{
    await tx.$executeRaw`UPDATE organizations SET name='must rollback timeout' WHERE id=${org}::uuid`;
    await delay(150); await tx.$queryRaw`SELECT 1`;
  },{timeout:50}));
  assert.equal((await db.organization.findUnique({where:{id:org},select:{name:true}}))?.name,'Gate probe');
  let pid=0; const ready=latch();
  const cancelled=timed('explicit-query-cancellation',()=>db.$transaction(async(tx)=>{
    const rows=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() pid`; pid=rows[0]!.pid;
    await tx.$executeRaw`UPDATE organizations SET name='must rollback cancellation' WHERE id=${org}::uuid`;
    ready.resolve(); await tx.$queryRaw`SELECT pg_sleep(5)`;
  },{timeout:8000}));
  await ready.promise; await delay(50); await db.$queryRaw`SELECT pg_cancel_backend(${pid}::int)`; await cancelled;
  assert.equal((await db.organization.findUnique({where:{id:org},select:{name:true}}))?.name,'Gate probe');
  const firstRead=latch(),secondRead=latch(),firstDone=latch();
  await Promise.all([
    timed('serializable-first',()=>db.$transaction(async(tx)=>{
      await tx.$queryRaw`SELECT name FROM organizations WHERE id=${org}::uuid`;
      firstRead.resolve(); await secondRead.promise;
      await tx.$executeRaw`UPDATE organizations SET name='serialization committed' WHERE id=${org}::uuid`;
    },{isolationLevel:'Serializable'}).finally(()=>firstDone.resolve())),
    timed('serializable-conflict',()=>db.$transaction(async(tx)=>{
      await tx.$queryRaw`SELECT name FROM organizations WHERE id=${org}::uuid`;
      secondRead.resolve(); await firstRead.promise; await firstDone.promise;
      await tx.$executeRaw`UPDATE organizations SET name='must rollback serialization' WHERE id=${org}::uuid`;
    },{isolationLevel:'Serializable'})),
  ]);
  const final=await db.organization.findUnique({where:{id:org},select:{name:true}});
  assert.equal(final?.name,'serialization committed');
  assert.equal(measurements.find((m)=>m.label==='remaining-budget-row-timeout').classification,'LOCK_TIMEOUT');
  assert.equal(measurements.find((m)=>m.label==='transaction-timeout-rollback').classification,'UNCERTAIN');
  assert.ok(measurements.find((m)=>m.label==='explicit-query-cancellation').sqlStates.includes('57014'));
  assert.ok(measurements.find((m)=>m.label==='serializable-conflict').sqlStates.includes('40001'));
  console.log(JSON.stringify({probe:'performance-bounds',timestamp:new Date().toISOString(),measurements,finalState:'only successful serializable update committed'}));
});

test('intentional deadlock exposes exact 40P01 through the installed Prisma adapter', async () => {
  const a = latch();
  const b = latch();
  const outcomes = await Promise.allSettled([
    db.$transaction(
      async (tx) => {
        await setLocalLockTimeout(tx, 5000);
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${org}::uuid FOR UPDATE`;
        a.resolve();
        await b.promise;
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${second}::uuid FOR UPDATE`;
      },
      { timeout: 10_000 },
    ),
    db.$transaction(
      async (tx) => {
        await setLocalLockTimeout(tx, 5000);
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${second}::uuid FOR UPDATE`;
        b.resolve();
        await a.promise;
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${org}::uuid FOR UPDATE`;
      },
      { timeout: 10_000 },
    ),
  ]);
  const errors = outcomes.filter((r) => r.status === 'rejected');
  assert.equal(errors.length, 1);
  const error = errors[0]!.reason;
  console.log(
    JSON.stringify({
      probe: 'intentional-40P01',
      shape: shape(error),
      sqlStates: sqlStates(error),
      classification: classifyFailure(error),
    }),
  );
  assert.equal(classifyFailure(error), 'DEADLOCK');
});

test('partial unique index violation exposes 23505; this is the foundation property index', async () => {
  await withMigratorClient(async (c) => {
    await c.query(
      "INSERT INTO properties(id,organization_id,code,name,updated_at) VALUES ($1,$2,'GATE-PROBE','Probe',now())",
      [randomUUID(), org],
    );
  });
  await failure(
    'partial-index-23505',
    () =>
      db.$executeRaw`INSERT INTO properties(id,organization_id,code,name,updated_at) VALUES (${randomUUID()}::uuid,${org}::uuid,'GATE-PROBE','Duplicate',now())`,
    'UNIQUE_VIOLATION',
  );
  await failure(
    'partial-index-model-create-23505',
    () =>
      db.property.create({
        data: { organizationId: org, code: 'GATE-PROBE', name: 'Duplicate through Prisma model' },
      }),
    'UNIQUE_VIOLATION',
  );
});

test('expired interactive transaction exposes P2028 and remains UNCERTAIN', async () => {
  await failure(
    'expired-P2028',
    () =>
      db.$transaction(
        async (tx) => {
          await delay(150);
          await tx.$queryRaw`SELECT 1`;
        },
        { timeout: 50 },
      ),
    'UNCERTAIN',
  );
});

test('two-second holder queues both exclusive requests; available pool capacity serves unrelated SQL', async () => {
  const holder = createMigratorClient();
  await holder.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      orgGateKeyText(org),
    ]);
    const start = performance.now();
    const first = db.$transaction(
      async (tx) => {
        await acquireOrgGate(tx, org);
        return performance.now() - start;
      },
      { timeout: 8000 },
    );
    await delay(100);
    const queuedBeforeNext = await holder.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");
    const nextStart = performance.now();
    const next = db.$transaction(
      async (tx) => {
        await acquireOrgGate(tx, org);
        return performance.now() - nextStart;
      },
      { timeout: 8000 },
    );
    await delay(100);
    const readStart = performance.now();
    await db.$queryRaw`SELECT id FROM organizations WHERE id = ${second}::uuid`;
    const readMs = performance.now() - readStart;
    await delay(Math.max(1, 2000 - (performance.now() - start)));
    await holder.query('COMMIT');
    const holderReleasedMs = performance.now() - start;
    const waits = await Promise.all([first, next]);
    console.log(
      JSON.stringify({
        probe: 'queue-and-pool',
        holderMs: 2000,
        measuredHolderMs: holderReleasedMs,
        firstRequestStartMs: 0,
        nextRequestStartMs: nextStart-start,
        exclusiveWaitersBeforeNext: queuedBeforeNext.rows[0].n,
        waitingRequests: 2,
        poolMax: 10,
        firstMs: waits[0],
        nextMs: waits[1],
        unrelatedSqlMs: readMs,
      }),
    );
    assert.ok(waits[0]! >= 1800 && waits[1]! >= 1700);
    assert.ok(readMs < 1000);
  } finally {
    await holder.query('ROLLBACK');
    await holder.end();
  }
});

test('correction deadline bounds near-budget advisory and row waits and execution cancellation', async () => {
  await db.$transaction(async(raw)=>{
    const tx=correctionDeadlineClient(raw,30000);
    await tx.organization.update({where:{id:second},data:{name:'deadline baseline'}});
  },{timeout:30000});
  const samples:unknown[]=[];
  for(const kind of ['advisory','row']) {
    const holder=createMigratorClient(); await holder.connect();
    try {
      await holder.query('BEGIN');
      if(kind==='row') await holder.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);
      else await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[orgGateKeyText(org)]);
      const start=performance.now(); let observed:unknown;
      try {
        await db.$transaction(async(raw)=>{
          const tx=correctionDeadlineClient(raw,4000);
          await tx.organization.update({where:{id:second},data:{name:'must rollback near deadline'}});
          await tx.$executeRaw`SELECT pg_sleep(2.5)`;
          if(kind==='row') await tx.$queryRaw`SELECT id FROM organizations WHERE id=${org}::uuid FOR UPDATE`;
          else await acquireOrgGate(tx,org);
        },{timeout:4000});
      } catch(error) { observed=error; }
      assert.ok(observed);
      const elapsed=performance.now()-start;
      console.log(JSON.stringify({probe:'near-budget-observed',kind,elapsedMs:elapsed,shape:shape(observed),sqlStates:sqlStates(observed),classification:classifyFailure(observed)}));
      assert.ok(elapsed<4000);
      assert.ok(sqlStates(observed).some((s)=>['57014','55P03'].includes(s)));
      assert.equal((await db.organization.findUnique({where:{id:second}}))?.name,'deadline baseline');
      samples.push({kind,configuredAttemptMs:4000,cleanupReserveMs:1000,workBeforeLockMs:2500,elapsedMs:elapsed,shape:shape(observed),sqlStates:sqlStates(observed),classification:classifyFailure(observed),rolledBack:true});
    } finally { await holder.query('ROLLBACK'); await holder.end(); }
  }
  let pid=0; const ready=latch(); let cancelled:unknown;
  const start=performance.now();
  const running=db.$transaction(async(raw)=>{
    const tx=correctionDeadlineClient(raw,30000);
    pid=(await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() pid`)[0]!.pid;
    await tx.organization.update({where:{id:second},data:{name:'must rollback explicit cancellation'}});
    ready.resolve(); await tx.$queryRaw`SELECT pg_sleep(5)`;
  },{timeout:30000}).catch((error)=>{cancelled=error;});
  await ready.promise; await delay(100); await db.$queryRaw`SELECT pg_cancel_backend(${pid}::int)`; await running;
  assert.ok(sqlStates(cancelled).includes('57014'));
  assert.equal((await db.organization.findUnique({where:{id:second}}))?.name,'deadline baseline');
  console.log(JSON.stringify({probe:'correction-deadline-bounds',samples,executionCancellation:{elapsedMs:performance.now()-start,shape:shape(cancelled),classification:classifyFailure(cancelled),rolledBack:true}}));
});
