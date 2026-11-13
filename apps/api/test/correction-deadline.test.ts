import assert from 'node:assert/strict';
import test from 'node:test';
import { correctionDeadlineClient } from '../src/common/correction-deadline.js';

test('server budgets decrease across queued operations and preserve a smaller requested lock timeout', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const settings: Array<{ sql: string; value: unknown }> = [];
  const order: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    $executeRaw: async (strings: TemplateStringsArray, value: unknown) => {
      settings.push({ sql: strings.join('?'), value });
      return 0;
    },
    resident: {
      update: async ({ data }: { data: { id: string } }) => {
        order.push(data.id);
        t.mock.timers.setTime(Date.now() + 100);
        return data.id;
      },
    },
  };
  const bounded = correctionDeadlineClient(tx, 30000);
  await bounded.$executeRaw`SELECT set_config('lock_timeout', ${'200ms'}, true)`;
  await Promise.all([
    bounded.resident.update({ where: { id: 'first' }, data: { id: 'first' } }),
    bounded.resident.update({ where: { id: 'second' }, data: { id: 'second' } }),
  ]);
  assert.deepEqual(order, ['first', 'second']);
  const statements = settings
    .filter((s) => s.sql.includes('statement_timeout'))
    .map((s) => Number.parseInt(String(s.value), 10));
  assert.ok(statements[0]! <= 29000);
  assert.ok(statements.at(-1)! < statements[0]!);
  assert.ok(
    settings
      .filter((s) => s.sql.includes('lock_timeout'))
      .slice(1)
      .every((s) => Number.parseInt(String(s.value), 10) <= 200),
  );
});

test('cleanup reserve and expired remaining budget prevent a new query; connection wait reduces the supplied budget', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let calls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    $executeRaw: async () => {
      calls++;
    },
    resident: { findMany: async () => [] },
  };
  const bounded = correctionDeadlineClient(tx, 2000);
  t.mock.timers.setTime(2001);
  await assert.rejects(bounded.resident.findMany(), /deadline/);
  assert.equal(calls, 0);
});

test('queued work stops after the original database error and preserves its identity', async () => {
  const original = Object.assign(new Error('driver failure'), { code: 'P2010' });
  let operations = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    $executeRaw: async () => 0,
    resident: {
      findMany: async () => {
        operations++;
        throw original;
      },
    },
  };
  const bounded = correctionDeadlineClient(tx, 30000);
  const results = await Promise.allSettled([
    bounded.resident.findMany(),
    bounded.resident.findMany(),
  ]);
  assert.equal(operations, 1);
  assert.ok(results.every((r) => r.status === 'rejected' && r.reason === original));
});
