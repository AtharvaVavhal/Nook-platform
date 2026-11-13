/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fakes of the Prisma client */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ResidentService } from '../src/resident/resident.service.js';
import { BookingService } from '../src/booking/booking.service.js';
import { CheckInService } from '../src/checkin/checkin.service.js';

/**
 * Ordinary-route bypass prevention (specification v1.3 section 4, Decision 15): the nine correction fields cannot be changed
 * through the ordinary resident/booking/admission routes, including inside mixed status/archive payloads, and the request is
 * refused as a whole BEFORE any database call or partial success.
 */

const ORG = randomUUID();
const ID = randomUUID();
const refused = (e: any) => e.getStatus() === 409 && e.getResponse().code === 'CORRECTION_REQUIRED';

function spyDb() {
  const calls: string[] = [];
  const proxy: any = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === '$transaction')
          return async (fn: any) => (calls.push('$transaction'), fn(proxy));
        return new Proxy(
          {},
          {
            get: (_x, method: string) => async () => (
              calls.push(`${name}.${method}`),
              { id: ID, status: 'ACTIVE' }
            ),
          },
        );
      },
    },
  );
  return { db: proxy, calls };
}

test('resident: names cannot be changed through the ordinary route, alone or inside an archive payload', async () => {
  for (const body of [
    { firstName: 'New' },
    { lastName: 'New' },
    { firstName: 'A', lastName: 'B', phone: '9876543210' },
    { status: 'ARCHIVED', lastName: 'Sneaky' },
  ]) {
    const { db, calls } = spyDb();
    const service = new ResidentService({ db } as any);
    await assert.rejects(service.update(ORG, ID, body as any), refused);
    assert.ok(
      !calls.some((c) => /update|\$transaction|updateMany/.test(c)),
      `no write happened for ${JSON.stringify(body)}`,
    );
  }
});

test('resident: routine edits (contact, address) and archiving without names still work', async () => {
  const { db, calls } = spyDb();
  const service = new ResidentService({ db } as any);
  await service.update(ORG, ID, { phone: '9876543210', address: 'New street' } as any);
  assert.ok(calls.includes('resident.update'));
});

test('booking: dates and monthly price cannot be changed through the ordinary route, alone or with a status change', async () => {
  for (const body of [
    { startDate: '2027-01-01' },
    { endDate: '2027-02-01' },
    { monthlyPrice: '9000.00' },
    { status: 'CANCELLED', monthlyPrice: '1.00' },
    { paymentStatus: 'PAID', endDate: '2027-02-01' },
  ]) {
    const { db, calls } = spyDb();
    const service = new BookingService({ db } as any);
    await assert.rejects(service.update(ORG, ID, body), refused);
    assert.deepEqual(calls, [], `no database access at all for ${JSON.stringify(body)}`);
  }
});

test('check-in notes: a legacy CHECKED_OUT row with no CheckOut record is refused (its updatedAt is its billing end)', async () => {
  let writes = 0;
  const row = {
    id: ID,
    organizationId: ORG,
    status: 'CHECKED_OUT',
    checkOut: null,
    booking: { effectiveAssignments: [] },
  };
  const db: any = {
    checkIn: {
      findFirst: async () => row,
      updateMany: async () => ((writes += 1), { count: 1 }),
    },
    $executeRaw: async () => 0,
    $queryRawUnsafe: async () => [{ id: ID }],
    $transaction: async (fn: any) => fn(db),
  };
  const service = new CheckInService({ db } as any);
  await assert.rejects(
    service.update(ORG, ID, { notes: 'edited' }),
    (e: any) => e.getStatus() === 409 && e.getResponse().code === 'LIFECYCLE_CONFLICT',
  );
  assert.equal(writes, 0);
  row.status = 'ACTIVE';
  await service.update(ORG, ID, { notes: 'edited' });
  assert.equal(writes, 1);
  row.status = 'CHECKED_OUT';
  (row as any).checkOut = { id: randomUUID() };
  await service.update(ORG, ID, { notes: 'fine, it has a real check-out' });
  assert.equal(writes, 2);
});

test('check-in: the core timestamp still cannot be changed through the ordinary route', async () => {
  const { db } = spyDb();
  const service = new CheckInService({ db } as any);
  await assert.rejects(
    service.update(ORG, ID, { checkInAt: '2027-01-01T00:00:00Z' }),
    (e: any) => e.getStatus() === 400,
  );
});
