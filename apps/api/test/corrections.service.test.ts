/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake of the Prisma client */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { CorrectionsService, type CommandContext } from '../src/corrections/corrections.service.js';

/**
 * Service tests run CorrectionsService against an in-memory fake of the database client. The fake's $transaction restores
 * its state when the callback throws, so atomicity (everything or nothing) is observable. They prove the service's own
 * decisions and the shape of its statements. They are NOT PostgreSQL tests and say nothing about locking, triggers, unique
 * indexes or the real Prisma error shapes; those need the disposable-database acceptance run.
 */

const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const OWNER = randomUUID();
const OWNER_2 = randomUUID();
const PM = randomUUID();
const PM_2 = randomUUID();
const RESIDENT = randomUUID();
const SECRET = 's'.repeat(40);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const canonical = (d: Date) =>
  `${d.toISOString().slice(0, 19)}.${String(d.getUTCMilliseconds()).padStart(3, '0')}000Z`;

interface World {
  resident: {
    id: string;
    first_name: string;
    last_name: string;
    status: string;
    created_at: string;
  };
  members: Map<string, { role: string; status: string }>;
  proposals: any[];
  receipts: any[];
  audits: any[];
  links: any[];
  executed: { sql: string; values: unknown[] }[];
}

function makeWorld(createdDaysAgo = 10): World {
  return {
    resident: {
      id: RESIDENT,
      first_name: 'Arahv',
      last_name: 'Shah',
      status: 'ACTIVE',
      created_at: canonical(daysAgo(createdDaysAgo)),
    },
    members: new Map([
      [OWNER, { role: 'OWNER', status: 'ACTIVE' }],
      [OWNER_2, { role: 'OWNER', status: 'ACTIVE' }],
      [PM, { role: 'PROPERTY_MANAGER', status: 'ACTIVE' }],
      [PM_2, { role: 'PROPERTY_MANAGER', status: 'ACTIVE' }],
    ]),
    proposals: [],
    receipts: [],
    audits: [],
    links: [],
    executed: [],
  };
}

function sqlParts(a: any, rest: unknown[]): { text: string; values: unknown[] } {
  if (a && Array.isArray(a.strings)) return { text: a.strings.join('?'), values: a.values };
  return { text: (a as TemplateStringsArray).join('?'), values: rest };
}

interface FakeOptions {
  failAuditFor?: string;
  txErrors?: unknown[]; // thrown by successive $transaction calls before running the callback
}

function makeFake(world: World, options: FakeOptions = {}) {
  const calls = { transactions: 0 };
  const errors = [...(options.txErrors ?? [])];
  const tx: any = {
    membership: {
      findFirst: async ({ where }: any) => {
        const m = world.members.get(where.userId);
        return m && where.organizationId === ORG
          ? {
              role: m.role,
              status: m.status,
              user: { status: 'ACTIVE' },
              organization: { status: 'ACTIVE' },
            }
          : null;
      },
    },
    correctionProposal: {
      findFirst: async ({ where, include }: any) => {
        const p = world.proposals.find(
          (x) => x.id === where.id && x.organizationId === where.organizationId,
        );
        if (!p) return null;
        return include
          ? {
              ...p,
              requester: { id: p.requestedBy, displayName: 'Requester' },
              decider: p.decidedBy ? { id: p.decidedBy, displayName: 'Reviewer' } : null,
            }
          : { ...p };
      },
      create: async ({ data }: any) => {
        const row = {
          id: randomUUID(),
          status: 'PENDING',
          recordedAt: new Date(),
          decidedBy: null,
          decidedAt: null,
          appliedAt: null,
          appliedValue: null,
          decisionReason: null,
          exceptionRationale: null,
          staleCause: null,
          ...data,
        };
        world.proposals.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const p = world.proposals.find((x) => x.id === where.id)!;
        if (p.status !== 'PENDING') throw new Error('terminal proposals cannot change (trigger)');
        Object.assign(p, data);
        return { ...p };
      },
      findMany: async () => world.proposals,
      count: async () => world.proposals.length,
    },
    correctionCommandReceipt: {
      findUnique: async ({ where }: any) => {
        const k = where.organizationId_actorId_idempotencyKey;
        return (
          world.receipts.find(
            (r) =>
              r.organizationId === k.organizationId &&
              r.actorId === k.actorId &&
              r.idempotencyKey === k.idempotencyKey,
          ) ?? null
        );
      },
      create: async ({ data }: any) => {
        world.receipts.push({ id: randomUUID(), ...data });
        return data;
      },
    },
    correctionFinanceLink: { findMany: async () => world.links },
    auditEvent: {
      create: async ({ data }: any) => {
        if (options.failAuditFor && data.action === options.failAuditFor)
          throw new Error('audit write failed');
        world.audits.push({ ...data });
        return data;
      },
    },
    resident: {
      count: async ({ where }: any) =>
        where.id === RESIDENT && where.organizationId === ORG ? 1 : 0,
    },
    $executeRaw: async (a: any, ...rest: unknown[]) => {
      const { text, values } = sqlParts(a, rest);
      if (/set_config|pg_advisory/.test(text) || /^\s*SELECT 1\s*$/i.test(text)) return 0;
      world.executed.push({ sql: text, values });
      if (text.includes('UPDATE residents SET first_name')) {
        world.resident.first_name = String(values[0]);
        return 1;
      }
      if (text.includes('UPDATE residents SET last_name')) {
        world.resident.last_name = String(values[0]);
        return 1;
      }
      return 1;
    },
    $queryRaw: async (a: any, ...rest: unknown[]) => {
      const { text, values } = sqlParts(a, rest);
      if (text.includes('clock_timestamp()') && text.includes('AS now'))
        return [{ now: new Date() }];
      if (text.includes('FROM correction_proposals') && text.includes('FOR UPDATE'))
        return [{ id: values[0] }];
      if (text.includes('FROM residents') && text.includes('FOR NO KEY UPDATE')) {
        return values[0] === RESIDENT && values[1] === ORG ? [{ id: RESIDENT }] : [];
      }
      if (text.includes('FROM residents WHERE id')) {
        return values[0] === RESIDENT && values[1] === ORG ? [world.resident] : [];
      }
      return [];
    },
  };
  const db: any = {
    ...tx,
    $transaction: async (fn: (t: any) => Promise<unknown>) => {
      calls.transactions += 1;
      const next = errors.shift();
      if (next) throw next;
      const snapshot = structuredClone({ ...world, members: [...world.members] });
      try {
        return await fn(tx);
      } catch (error) {
        world.resident = snapshot.resident;
        world.proposals = snapshot.proposals;
        world.receipts = snapshot.receipts;
        world.audits = snapshot.audits;
        world.links = snapshot.links;
        world.executed = snapshot.executed;
        throw error;
      }
    },
  };
  const service = new CorrectionsService({ db } as any, {} as any, {
    receiptSecret: () => SECRET,
    financialApplyEnabled: () => false,
    sleep: async () => undefined,
  });
  return { service, calls };
}

const ctx = (userId: string, role: string, organizationId = ORG): CommandContext => ({
  organizationId,
  userId,
  role,
});
const nameBody = (over: Record<string, unknown> = {}) => ({
  targetType: 'RESIDENT',
  targetId: RESIDENT,
  fieldKey: 'firstName',
  proposedValue: 'Aarav',
  reason: 'Misspelled at registration',
  effectiveAt: new Date().toISOString(),
  ...over,
});
const code = (error: any) => error?.getResponse?.().code;

async function submit(
  world: World,
  who = PM,
  role = 'PROPERTY_MANAGER',
  body = nameBody(),
  key = randomUUID(),
) {
  const { service } = makeFake(world);
  const result = await service.submit(ctx(who, role), key, body);
  return { result, key };
}

// ------------------------------------------------------------------------------------------------ submission

test('submit: stores the server-captured original, one audit, one receipt, and hides the snapshot', async () => {
  const world = makeWorld();
  const { result } = await submit(world);
  assert.equal(result.status, 201);
  const detail = result.body as any;
  assert.equal(detail.status, 'PENDING');
  assert.deepEqual(
    detail.originalValue,
    { kind: 'text', value: 'Arahv' },
    'original comes from the database',
  );
  assert.deepEqual(detail.proposedValue, { kind: 'text', value: 'Aarav' });
  assert.equal(detail.financialImpact, false);
  assert.ok(!('expectedSnapshot' in detail), 'the dependency snapshot is never exposed');
  assert.equal(world.proposals.length, 1);
  assert.equal(world.receipts.length, 1);
  assert.equal(world.receipts[0].outcomeCode, 'SUBMITTED');
  assert.deepEqual(
    world.audits.map((a) => a.action),
    ['correction.submitted'],
  );
  assert.equal(world.audits[0].targetType, 'resident');
  assert.ok(
    !JSON.stringify(world.audits[0].metadata).includes('Aarav'),
    'no value in the audit metadata',
  );
  assert.equal(world.resident.first_name, 'Arahv', 'a pending proposal changes nothing');
});

test('submit: client-supplied identity, original, status and classification are refused', async () => {
  for (const extra of [
    { organizationId: OTHER_ORG },
    { requestedBy: PM },
    { originalValue: 'x' },
    { status: 'APPLIED' },
    { financialImpact: false },
    { approverId: OWNER },
  ]) {
    const world = makeWorld();
    const { service } = makeFake(world);
    await assert.rejects(
      service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody(extra)),
      (e: any) => code(e) === 'UNKNOWN_FIELD',
    );
    assert.equal(world.proposals.length, 0);
  }
});

test('submit: field/target mismatch, bad values, future effectiveAt and a no-op are 400', async () => {
  const world = makeWorld();
  const { service } = makeFake(world);
  const go = (body: Record<string, unknown>) =>
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), body);
  await assert.rejects(
    go(nameBody({ fieldKey: 'startDate' })),
    (e: any) => code(e) === 'INVALID_FIELD',
  );
  await assert.rejects(
    go(nameBody({ fieldKey: 'phone' })),
    (e: any) => code(e) === 'INVALID_FIELD',
  );
  await assert.rejects(
    go(nameBody({ proposedValue: '   ' })),
    (e: any) => code(e) === 'INVALID_VALUE',
  );
  await assert.rejects(
    go(nameBody({ effectiveAt: new Date(Date.now() + 86_400_000).toISOString() })),
    (e: any) => code(e) === 'INVALID_VALUE',
  );
  await assert.rejects(
    go(nameBody({ effectiveAt: '2026-01-01T00:00:00' })),
    (e: any) => code(e) === 'INVALID_VALUE',
    'an explicit zone is mandatory',
  );
  await assert.rejects(
    go(nameBody({ proposedValue: 'Arahv' })),
    (e: any) => code(e) === 'INVALID_VALUE',
    'no-op replacement',
  );
  assert.equal(world.proposals.length, 0);
});

test('submit: a missing Idempotency-Key is refused and nothing is written', async () => {
  const world = makeWorld();
  const { service } = makeFake(world);
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), undefined, nameBody()),
    (e: any) => code(e) === 'INVALID_VALUE',
  );
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), 'not-a-uuid', nameBody()),
    (e: any) => code(e) === 'INVALID_VALUE',
  );
  assert.equal(world.proposals.length, 0);
});

test('tenant isolation: a target in another organization is indistinguishable from an unknown one (404)', async () => {
  const world = makeWorld();
  const { service } = makeFake(world);
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody({ targetId: randomUUID() })),
    (e: any) => e.getStatus() === 404,
  );
  // The same caller acting in another organization has no membership there.
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER', OTHER_ORG), randomUUID(), nameBody()),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
  assert.equal(world.proposals.length, 0);
});

test('authorization is re-read from the database: an inactive or unknown member cannot submit, whatever the session says', async () => {
  const world = makeWorld();
  world.members.set(PM, { role: 'PROPERTY_MANAGER', status: 'INACTIVE' });
  const { service } = makeFake(world);
  await assert.rejects(
    service.submit(ctx(PM, 'OWNER'), randomUUID(), nameBody()),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
  await assert.rejects(
    service.submit(ctx(randomUUID(), 'OWNER'), randomUUID(), nameBody()),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
  assert.equal(world.proposals.length, 0);
});

// ------------------------------------------------------------------------------------------------ idempotency

test('replay: the same key and payload returns the original outcome and writes nothing more', async () => {
  const world = makeWorld();
  const { service } = makeFake(world);
  const key = randomUUID();
  const fixedBody = nameBody({ effectiveAt: new Date(Date.now() - 5 * 86_400_000).toISOString() });
  const first = await service.submit(ctx(PM, 'PROPERTY_MANAGER'), key, fixedBody);
  const second = await service.submit(ctx(PM, 'PROPERTY_MANAGER'), key, fixedBody);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201, 'exact-status replay');
  assert.equal((second.body as any).idempotentReplay, true);
  assert.equal(world.proposals.length, 1);
  assert.equal(world.receipts.length, 1);
  assert.equal(world.audits.length, 1);
});

test('replay: a changed payload, a different action or a different proposal under the same key is an idempotency conflict', async () => {
  const world = makeWorld();
  const { service } = makeFake(world);
  const key = randomUUID();
  const created: any = (await service.submit(ctx(PM, 'PROPERTY_MANAGER'), key, nameBody())).body;
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), key, nameBody({ proposedValue: 'Different' })),
    (e: any) => code(e) === 'IDEMPOTENCY_CONFLICT',
  );
  await assert.rejects(
    service.withdraw(ctx(PM, 'PROPERTY_MANAGER'), key, created.id, { reason: 'x' }),
    (e: any) => code(e) === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(world.proposals.length, 1);
  assert.equal(world.proposals[0].status, 'PENDING');
});

test('replay is not an authorization bypass: a member who lost their role cannot replay', async () => {
  const world = makeWorld();
  const { service } = makeFake(world);
  const key = randomUUID();
  await service.submit(ctx(PM, 'PROPERTY_MANAGER'), key, nameBody());
  world.members.set(PM, { role: 'PROPERTY_MANAGER', status: 'REVOKED' });
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), key, nameBody()),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
});

test('a key is scoped to its actor: another member using the same key is a new command', async () => {
  const world = makeWorld();
  const { service } = makeFake(world);
  const key = randomUUID();
  await service.submit(ctx(PM, 'PROPERTY_MANAGER'), key, nameBody());
  // PM_2 sending the same UUID is not a replay of PM's command (and here conflicts only if the pending index existed).
  const other = await service.submit(
    ctx(PM_2, 'PROPERTY_MANAGER'),
    key,
    nameBody({ fieldKey: 'lastName', proposedValue: 'Shaw' }),
  );
  assert.equal(other.status, 201);
  assert.equal(world.receipts.length, 2);
});

// --------------------------------------------------------------------------------------------------- approval

async function pending(
  world: World,
  requester = PM,
  role = 'PROPERTY_MANAGER',
  over: Record<string, unknown> = {},
) {
  const { service } = makeFake(world);
  const created: any = (await service.submit(ctx(requester, role), randomUUID(), nameBody(over)))
    .body;
  return created.id as string;
}

test('approve: an independent reviewer applies a name column-only, with domain + correction audits and a receipt, atomically', async () => {
  const world = makeWorld();
  const id = await pending(world);
  const { service } = makeFake(world);
  const res = await service.approve(ctx(OWNER, 'OWNER'), randomUUID(), id, {
    decisionReason: 'Checked against the registration form',
  });
  assert.equal(res.status, 200);
  assert.equal((res.body as any).status, 'APPLIED');
  assert.equal(world.resident.first_name, 'Aarav');
  assert.equal(world.resident.last_name, 'Shah', 'the sibling column is untouched');
  const updates = world.executed.filter((e) => /UPDATE residents/.test(e.sql));
  assert.equal(updates.length, 1);
  assert.ok(
    /SET first_name = /.test(updates[0]!.sql) && !/last_name/.test(updates[0]!.sql),
    'only the target column is written',
  );
  assert.deepEqual(
    world.audits.map((a) => a.action),
    ['correction.submitted', 'resident.corrected', 'correction.applied'],
  );
  assert.equal(world.proposals[0].status, 'APPLIED');
  assert.equal(world.proposals[0].decidedBy, OWNER);
  assert.ok(
    world.proposals[0].decidedAt && world.proposals[0].appliedAt,
    'decidedAt and appliedAt are both recorded',
  );
  assert.deepEqual(world.proposals[0].appliedValue, { kind: 'text', value: 'Aarav' });
  assert.equal(world.receipts.filter((r) => r.outcomeCode === 'APPLIED').length, 1);
});

test('approve: exact replay returns the original result and applies nothing twice', async () => {
  const world = makeWorld();
  const id = await pending(world);
  const { service } = makeFake(world);
  const key = randomUUID();
  const body = { decisionReason: 'Checked' };
  await service.approve(ctx(OWNER, 'OWNER'), key, id, body);
  const before = { audits: world.audits.length, updates: world.executed.length };
  const replay = await service.approve(ctx(OWNER, 'OWNER'), key, id, body);
  assert.equal(replay.status, 200);
  assert.equal((replay.body as any).idempotentReplay, true);
  assert.deepEqual({ audits: world.audits.length, updates: world.executed.length }, before);
});

test('approve: self-review is refused and leaves the proposal PENDING', async () => {
  const world = makeWorld();
  const id = await pending(world, OWNER, 'OWNER');
  const { service } = makeFake(world);
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), randomUUID(), id, { decisionReason: 'mine' }),
    (e: any) => code(e) === 'SELF_REVIEW',
  );
  assert.equal(world.proposals[0].status, 'PENDING');
  assert.equal(world.resident.first_name, 'Arahv');
  assert.equal(world.receipts.filter((r) => r.action === 'APPROVE').length, 0);
});

test('approve: an OWNER request can be reviewed by a different PROPERTY_MANAGER (normal non-financial)', async () => {
  const world = makeWorld();
  const id = await pending(world, OWNER, 'OWNER');
  const { service } = makeFake(world);
  const res = await service.approve(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), id, {
    decisionReason: 'ok',
  });
  assert.equal((res.body as any).status, 'APPLIED');
});

test('approve: a financial proposal needs an OWNER; a manager is refused before anything else is evaluated', async () => {
  const world = makeWorld();
  const id = await pending(world);
  world.proposals[0].financialImpact = true;
  const { service } = makeFake(world);
  await assert.rejects(
    service.approve(ctx(PM_2, 'PROPERTY_MANAGER'), randomUUID(), id, { decisionReason: 'ok' }),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
  assert.equal(
    world.proposals[0].status,
    'PENDING',
    'an unentitled caller cannot even commit a STALE',
  );
});

test('approve: financial application stays disabled until it is explicitly enabled', async () => {
  const world = makeWorld();
  const id = await pending(world);
  world.proposals[0].financialImpact = true;
  world.proposals[0].fieldKey = 'startDate';
  const { service } = makeFake(world);
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), randomUUID(), id, { decisionReason: 'ok' }),
    (e: any) => code(e) === 'FINANCE_CONFLICT',
  );
  assert.equal(world.proposals[0].status, 'PENDING');
  assert.equal(world.executed.filter((e) => /^UPDATE/.test(e.sql.trim())).length, 0);
});

test('approve: a changed dependency commits terminal STALE (with audit and receipt) and only then returns 409', async () => {
  const world = makeWorld();
  const id = await pending(world);
  world.resident.first_name = 'Someone Else'; // the corrected field itself changed after submission
  const { service } = makeFake(world);
  const key = randomUUID();
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), key, id, { decisionReason: 'ok' }),
    (e: any) => code(e) === 'STALE_SOURCE' && e.getStatus() === 409,
  );
  const p = world.proposals[0];
  assert.equal(p.status, 'STALE', 'the STALE transition was committed, not rolled back');
  assert.equal(p.staleCause, 'RESIDENT_FIELD');
  assert.equal(p.decidedBy, OWNER);
  assert.ok(world.audits.some((a) => a.action === 'correction.stale'));
  assert.ok(world.receipts.some((r) => r.outcomeCode === 'STALE_SOURCE'));
  assert.equal(world.resident.first_name, 'Someone Else', 'the source was not touched');
  // The committed STALE replays as the same 409 without any new write.
  const auditsBefore = world.audits.length;
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), key, id, { decisionReason: 'ok' }),
    (e: any) => code(e) === 'STALE_SOURCE',
  );
  assert.equal(world.audits.length, auditsBefore);
  // A terminal proposal can never be applied by a fresh key.
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), randomUUID(), id, { decisionReason: 'ok' }),
    (e: any) => code(e) === 'INVALID_STATE',
  );
});

test('approve: an unrelated change (the sibling name) does not stale the proposal', async () => {
  const world = makeWorld();
  const id = await pending(world);
  world.resident.last_name = 'Shaw';
  world.resident.status = 'ARCHIVED'; // archived residents stay correctable; status is not a name dependency
  const { service } = makeFake(world);
  const res = await service.approve(ctx(OWNER, 'OWNER'), randomUUID(), id, {
    decisionReason: 'ok',
  });
  assert.equal((res.body as any).status, 'APPLIED');
  assert.equal(world.resident.last_name, 'Shaw', 'concurrent edit of another column survives');
});

test('approve: an old resident makes a name correction exceptional (owner, rationale and evidence required)', async () => {
  const world = makeWorld(400);
  const { service } = makeFake(world);
  // Evidence is mandatory at submission for an exceptional correction.
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody()),
    (e: any) => code(e) === 'INVALID_EVIDENCE',
  );
  const created: any = (
    await service.submit(
      ctx(PM, 'PROPERTY_MANAGER'),
      randomUUID(),
      nameBody({ evidenceReference: 'Admission register 2025, line 14' }),
    )
  ).body;
  assert.equal(created.exceptionRequired, true);
  await assert.rejects(
    service.approve(ctx(PM_2, 'PROPERTY_MANAGER'), randomUUID(), created.id, {
      decisionReason: 'ok',
    }),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), randomUUID(), created.id, { decisionReason: 'ok' }),
    (e: any) => code(e) === 'INVALID_VALUE',
    'exception rationale required',
  );
  const res = await service.approve(ctx(OWNER, 'OWNER'), randomUUID(), created.id, {
    decisionReason: 'Evidence checked',
    exceptionRationale: 'Typo found during audit',
  });
  assert.equal((res.body as any).status, 'APPLIED');
});

test('atomicity: an audit failure while applying leaves the source, proposal, audits and receipt unchanged', async () => {
  const world = makeWorld();
  const id = await pending(world);
  const { service } = makeFake(world, { failAuditFor: 'correction.applied' });
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), randomUUID(), id, { decisionReason: 'ok' }),
  );
  assert.equal(world.resident.first_name, 'Arahv');
  assert.equal(world.proposals[0].status, 'PENDING');
  assert.deepEqual(
    world.audits.map((a) => a.action),
    ['correction.submitted'],
  );
  assert.equal(world.receipts.filter((r) => r.action === 'APPROVE').length, 0);
});

// ------------------------------------------------------------------------------ reject / withdraw / reads

test('reject: needs a reason and an independent reviewer; the source is unchanged', async () => {
  const world = makeWorld();
  const id = await pending(world);
  const { service } = makeFake(world);
  await assert.rejects(
    service.reject(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), id, { reason: 'mine' }),
    (e: any) => code(e) === 'SELF_REVIEW',
  );
  await assert.rejects(
    service.reject(ctx(OWNER, 'OWNER'), randomUUID(), id, {}),
    (e: any) => code(e) === 'INVALID_VALUE',
  );
  const res = await service.reject(ctx(OWNER, 'OWNER'), randomUUID(), id, {
    reason: 'Evidence does not match',
  });
  assert.equal((res.body as any).status, 'REJECTED');
  assert.equal(world.resident.first_name, 'Arahv');
  assert.equal(world.proposals[0].status, 'REJECTED', 'rejected proposals are retained');
});

test('reject: a manager cannot reject a financial proposal', async () => {
  const world = makeWorld();
  const id = await pending(world);
  world.proposals[0].financialImpact = true;
  const { service } = makeFake(world);
  await assert.rejects(
    service.reject(ctx(PM_2, 'PROPERTY_MANAGER'), randomUUID(), id, { reason: 'no' }),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
});

test('withdraw: only the requester, only while PENDING; approve then withdraw races end in INVALID_STATE', async () => {
  const world = makeWorld();
  const id = await pending(world);
  const { service } = makeFake(world);
  await assert.rejects(
    service.withdraw(ctx(PM_2, 'PROPERTY_MANAGER'), randomUUID(), id, { reason: 'not mine' }),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
  await assert.rejects(
    service.withdraw(ctx(OWNER, 'OWNER'), randomUUID(), id, { reason: 'not mine' }),
    (e: any) => code(e) === 'INSUFFICIENT_ROLE',
  );
  const res = await service.withdraw(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), id, {
    reason: 'Mistake',
  });
  assert.equal((res.body as any).status, 'WITHDRAWN');
  assert.equal(world.proposals[0].decidedBy, PM, 'withdrawal is decided by the requester');
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), randomUUID(), id, { decisionReason: 'ok' }),
    (e: any) => code(e) === 'INVALID_STATE',
  );
  await assert.rejects(
    service.reject(ctx(OWNER, 'OWNER'), randomUUID(), id, { reason: 'late' }),
    (e: any) => code(e) === 'INVALID_STATE',
  );
});

test('decisions on an unknown or other-tenant proposal are 404 and write no receipt', async () => {
  const world = makeWorld();
  const { service } = makeFake(world);
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), randomUUID(), randomUUID(), { decisionReason: 'x' }),
    (e: any) => e.getStatus() === 404,
  );
  await assert.rejects(
    service.approve(ctx(OWNER, 'OWNER'), randomUUID(), 'not-a-uuid', { decisionReason: 'x' }),
    (e: any) => e.getStatus() === 404,
  );
  assert.equal(world.receipts.length, 0);
});

test('detail: allowedActions reflect the viewer; pending values are labelled as a proposal, never as current', async () => {
  const world = makeWorld();
  const id = await pending(world);
  const { service } = makeFake(world);
  const asRequester: any = await service.detail(ctx(PM, 'PROPERTY_MANAGER'), id);
  const asReviewer: any = await service.detail(ctx(OWNER, 'OWNER'), id);
  assert.deepEqual(asRequester.allowedActions, ['withdraw']);
  assert.deepEqual(asReviewer.allowedActions, ['approve', 'reject']);
  assert.equal(asReviewer.status, 'PENDING');
  assert.equal(asReviewer.financeReviewStatus, 'NONE');
  assert.ok(!('expectedSnapshot' in asReviewer));
});

// --------------------------------------------------------------------------------------- retry / failures

for (const state of ['40P01', '40001']) {
  test(`retry: captured adapter SQLSTATE ${state} is retried at most twice and persists once`, async () => {
    const world = makeWorld();
    const deadlock = Object.assign(new Error('deadlock'), {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: state } } },
    });
    const { service, calls } = makeFake(world, { txErrors: [deadlock, deadlock] });
    const res = await service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody());
    assert.equal(res.status, 201);
    assert.equal(calls.transactions, 3);
    assert.equal(world.proposals.length, 1);
    assert.equal(world.receipts.length, 1);

    const exhausted = makeFake(makeWorld(), { txErrors: [deadlock, deadlock, deadlock] });
    await assert.rejects(
      exhausted.service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody()),
      (e: any) => code(e) === 'RETRY_REQUIRED',
    );
    assert.equal(exhausted.calls.transactions, 3, 'never more than two retries');
  });
}

test('retry: a lock timeout (55P03) and a Prisma transaction error are NOT retried and ask the client to re-send the key', async () => {
  const lockTimeout = Object.assign(new Error('lock timeout'), {
    meta: { driverAdapterError: { cause: { originalCode: '55P03' } } },
  });
  const a = makeFake(makeWorld(), { txErrors: [lockTimeout] });
  await assert.rejects(
    a.service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody()),
    (e: any) => code(e) === 'RETRY_REQUIRED' && e.getStatus() === 409,
  );
  assert.equal(a.calls.transactions, 1);

  const p2028 = Object.assign(new Error('Transaction API error'), { code: 'P2028' });
  const b = makeFake(makeWorld(), { txErrors: [p2028] });
  await assert.rejects(
    b.service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody()),
    (e: any) => /same Idempotency-Key/.test(e.getResponse().message),
  );
  assert.equal(b.calls.transactions, 1, 'an ambiguous failure is not silently retried');
});

test('retry: a message that merely says "deadlock" is not retried (only an exact SQLSTATE is)', async () => {
  const looksLikeDeadlock = new Error('deadlock detected somewhere');
  const { service, calls } = makeFake(makeWorld(), { txErrors: [looksLikeDeadlock] });
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody()),
    (e: any) => !e?.getResponse?.().code,
  );
  assert.equal(calls.transactions, 1);
});

test('conflict: a unique violation on the pending-field index is PENDING_CONFLICT and writes nothing', async () => {
  const world = makeWorld();
  const unique = Object.assign(new Error('unique'), {
    code: 'P2002',
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: '23505',
          constraint: { index: 'correction_proposals_pending_resident_field_uq' },
        },
      },
    },
  });
  const { service } = makeFake(world, { txErrors: [unique] });
  await assert.rejects(
    service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody()),
    (e: any) => code(e) === 'PENDING_CONFLICT',
  );
  assert.equal(world.proposals.length, 0);
});

test('configuration: without a receipt secret the API fails closed (503) instead of storing weak checks', async () => {
  const world = makeWorld();
  const { service: base } = makeFake(world);
  void base;
  const noSecret = new CorrectionsService(
    {
      db: {
        $transaction: async () => {
          throw new Error('must not run');
        },
      },
    } as any,
    {} as any,
    {
      receiptSecret: () => undefined,
      financialApplyEnabled: () => false,
    },
  );
  await assert.rejects(
    noSecret.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody()),
    (e: any) => code(e) === 'CORRECTIONS_NOT_CONFIGURED' && e.getStatus() === 503,
  );
});

test('A7: unique violations never retry the complete command, including receipt and unnamed constraints', async () => {
  for (const index of ['correction_command_receipts_organization_id_actor_id_idempo_key', '']) {
    const world = makeWorld();
    const error = Object.assign(new Error('unique violation'), {
      code: 'P2002',
      meta: { driverAdapterError: { cause: { originalCode: '23505', constraint: { index } } } },
    });
    const { service, calls } = makeFake(world, { txErrors: [error] });
    await assert.rejects(service.submit(ctx(PM, 'PROPERTY_MANAGER'), randomUUID(), nameBody()));
    assert.equal(calls.transactions, 1, '23505 is not a whole-transaction retry condition');
    assert.equal(world.proposals.length, 0);
    assert.equal(world.receipts.length, 0);
  }
});
