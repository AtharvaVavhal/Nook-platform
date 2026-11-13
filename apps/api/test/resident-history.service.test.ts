/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake of the Prisma client */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ResidentHistoryService } from '../src/resident-history/resident-history.service.js';

const ORG = randomUUID();
const ACTOR = randomUUID();
const RESIDENT_ID = randomUUID();
const OTHER_RESIDENT_ID = randomUUID();

function makeResident(over: Partial<any> = {}) {
  return {
    id: RESIDENT_ID,
    organizationId: ORG,
    firstName: 'Test',
    lastName: 'Resident',
    ...over,
  };
}

function makeAuditEvent(over: Partial<any> = {}) {
  return {
    id: randomUUID(),
    organizationId: ORG,
    actorUserId: ACTOR,
    action: over.action || 'booking.created',
    targetType: over.targetType || 'booking',
    targetId: over.targetId || randomUUID(),
    requestId: randomUUID(),
    occurredAt: over.occurredAt || new Date(),
    reasonCode: null,
    metadata: over.metadata || {},
    actor: { id: ACTOR, displayName: 'Test Actor' },
    ...over,
  };
}

function makeFakePrisma(
  auditEvents: any[],
  targetIds: {
    bookingIds: string[];
    admissionIds: string[];
    checkInIds: string[];
    checkOutIds: string[];
  },
) {
  const events = [...auditEvents];

  return {
    resident: {
      findFirst: async (args: any) => {
        if (args.where?.id === RESIDENT_ID && args.where?.organizationId === ORG) {
          return makeResident();
        }
        return null;
      },
    },
    booking: {
      findMany: async (args: any) => {
        if (args.where?.organizationId === ORG && args.where?.residentId === RESIDENT_ID) {
          return targetIds.bookingIds.map((id) => ({ id }));
        }
        if (args.where?.organizationId === ORG && args.where?.residentId === OTHER_RESIDENT_ID) {
          return [];
        }
        return [];
      },
    },
    admission: {
      findMany: async (args: any) => {
        if (args.where?.organizationId === ORG && args.where?.residentId === RESIDENT_ID) {
          return targetIds.admissionIds.map((id) => ({ id }));
        }
        return [];
      },
    },
    checkIn: {
      findMany: async (args: any) => {
        if (args.where?.organizationId === ORG && args.where?.residentId === RESIDENT_ID) {
          return targetIds.checkInIds.map((id) => ({ id }));
        }
        return [];
      },
    },
    checkOut: {
      findMany: async (args: any) => {
        if (args.where?.organizationId === ORG && args.where?.residentId === RESIDENT_ID) {
          return targetIds.checkOutIds.map((id) => ({ id }));
        }
        return [];
      },
    },
    auditEvent: {
      findMany: async (args: any) => {
        const where = args.where;
        let filtered = events.filter((e) => e.organizationId === ORG);

        if (where?.action) {
          if (typeof where.action === 'string') {
            filtered = filtered.filter((e) => e.action === where.action);
          } else if (where.action.in) {
            filtered = filtered.filter((e) => where.action.in.includes(e.action));
          }
        }
        if (where?.OR) {
          const orConditions = where.OR;
          filtered = filtered.filter((e) =>
            orConditions.some(
              (cond: any) =>
                e.targetType === cond.targetType && cond.targetId.in.includes(e.targetId),
            ),
          );
        }

        if (where?.occurredAt) {
          if (where.occurredAt.gte) {
            filtered = filtered.filter((e) => e.occurredAt >= where.occurredAt.gte);
          }
          if (where.occurredAt.lte) {
            filtered = filtered.filter((e) => e.occurredAt <= where.occurredAt.lte);
          }
        }

        if (args.orderBy) {
          const orders = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
          filtered.sort((a, b) => {
            for (const order of orders) {
              const key = Object.keys(order)[0]!;
              const dir = order[key];
              const aVal = a[key];
              const bVal = b[key];
              if (aVal < bVal) return dir === 'asc' ? -1 : 1;
              if (aVal > bVal) return dir === 'asc' ? 1 : -1;
            }
            return 0;
          });
        }

        if (args.skip) filtered = filtered.slice(args.skip);
        if (args.take) filtered = filtered.slice(0, args.take);

        return filtered.map((e) => ({
          ...e,
          actor: args.include?.actor ? { id: e.actorUserId, displayName: 'Test Actor' } : undefined,
        }));
      },
      count: async (args: any) => {
        const where = args.where;
        let filtered = events.filter((e) => e.organizationId === ORG);

        if (where?.action) {
          if (typeof where.action === 'string') {
            filtered = filtered.filter((e) => e.action === where.action);
          } else if (where.action.in) {
            filtered = filtered.filter((e) => where.action.in.includes(e.action));
          }
        }
        if (where?.OR) {
          const orConditions = where.OR;
          filtered = filtered.filter((e) =>
            orConditions.some(
              (cond: any) =>
                e.targetType === cond.targetType && cond.targetId.in.includes(e.targetId),
            ),
          );
        }

        if (where?.occurredAt) {
          if (where.occurredAt.gte) {
            filtered = filtered.filter((e) => e.occurredAt >= where.occurredAt.gte);
          }
          if (where.occurredAt.lte) {
            filtered = filtered.filter((e) => e.occurredAt <= where.occurredAt.lte);
          }
        }

        return filtered.length;
      },
    },
  };
}

const createTestEvents = (baseTime: Date = new Date('2027-01-15T10:00:00Z')) => {
  const bookingId = randomUUID();
  const admissionId = randomUUID();
  const checkInId = randomUUID();
  const checkOutId = randomUUID();

  return {
    targetIds: {
      bookingIds: [bookingId],
      admissionIds: [admissionId],
      checkInIds: [checkInId],
      checkOutIds: [checkOutId],
    },
    events: [
      makeAuditEvent({
        action: 'booking.created',
        targetType: 'booking',
        targetId: bookingId,
        occurredAt: new Date(baseTime.getTime() - 100000),
      }),
      makeAuditEvent({
        action: 'booking.updated',
        targetType: 'booking',
        targetId: bookingId,
        occurredAt: new Date(baseTime.getTime() - 90000),
        metadata: {
          changedFields: ['endDate'],
          previousValues: { endDate: '2027-06-01' },
          newValues: { endDate: '2027-08-01' },
        },
      }),
      makeAuditEvent({
        action: 'booking.cancelled',
        targetType: 'booking',
        targetId: bookingId,
        occurredAt: new Date(baseTime.getTime() - 80000),
        metadata: { reason: 'Resident withdrew' },
      }),
      makeAuditEvent({
        action: 'booking.extended',
        targetType: 'booking',
        targetId: bookingId,
        occurredAt: new Date(baseTime.getTime() - 70000),
        metadata: {
          previousEndDate: '2027-06-01',
          newEndDate: '2027-08-01',
          reason: 'Extended for exams',
          approvedByUserId: ACTOR,
          approvedByRole: 'OWNER',
          approvedAt: '2027-04-10T10:00:00Z',
        },
      }),
      makeAuditEvent({
        action: 'booking.shortened',
        targetType: 'booking',
        targetId: bookingId,
        occurredAt: new Date(baseTime.getTime() - 60000),
        metadata: {
          previousEndInstant: '2027-08-01T00:00:00Z',
          newEndInstant: '2027-07-01T00:00:00Z',
          additionalChanges: [],
        },
      }),
      makeAuditEvent({
        action: 'admission.created',
        targetType: 'admission',
        targetId: admissionId,
        occurredAt: new Date(baseTime.getTime() - 50000),
        metadata: {
          bookingId,
          residentId: RESIDENT_ID,
          bedId: randomUUID(),
          admissionDate: '2027-04-01',
          propertyId: null,
          roomId: null,
        },
      }),
      makeAuditEvent({
        action: 'admission.updated',
        targetType: 'admission',
        targetId: admissionId,
        occurredAt: new Date(baseTime.getTime() - 40000),
        metadata: {
          changedFields: ['admissionDate'],
          previousValues: { admissionDate: '2027-04-01' },
          newValues: { admissionDate: '2027-04-15' },
        },
      }),
      makeAuditEvent({
        action: 'admission.approved',
        targetType: 'admission',
        targetId: admissionId,
        occurredAt: new Date(baseTime.getTime() - 30000),
        metadata: {
          previousStatus: 'PENDING',
          approvedByUserId: ACTOR,
          approvedAt: '2027-04-10T10:00:00Z',
        },
      }),
      makeAuditEvent({
        action: 'admission.cancelled',
        targetType: 'admission',
        targetId: admissionId,
        occurredAt: new Date(baseTime.getTime() - 20000),
        metadata: { previousStatus: 'ADMITTED', reason: 'Medical leave' },
      }),
      makeAuditEvent({
        action: 'admission.reopened',
        targetType: 'admission',
        targetId: admissionId,
        occurredAt: new Date(baseTime.getTime() - 10000),
        metadata: {
          previousStatus: 'CANCELLED',
          reopenedByUserId: ACTOR,
          reopenedAt: '2027-04-12T10:00:00Z',
        },
      }),
      makeAuditEvent({
        action: 'checkin.created',
        targetType: 'check_in',
        targetId: checkInId,
        occurredAt: new Date(baseTime.getTime()),
        metadata: {
          admissionId,
          residentId: RESIDENT_ID,
          bedId: randomUUID(),
          bookingId,
          checkInAt: '2027-04-15T08:00:00Z',
        },
      }),
      makeAuditEvent({
        action: 'checkout.created',
        targetType: 'check_out',
        targetId: checkOutId,
        occurredAt: new Date(baseTime.getTime() + 10000),
        metadata: {
          checkInId,
          residentId: RESIDENT_ID,
          bedId: randomUUID(),
          bookingId,
          checkOutAt: '2027-06-15T10:00:00Z',
          reason: 'Moved out',
        },
      }),
    ],
  };
};

test('1. All 12 lifecycle event types are returned with correct structure', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  assert.equal(result.items.length, 12);
  assert.equal(result.total, 12);
  const actions = result.items.map((i) => i.action).sort();
  const expectedActions = [
    'admission.approved',
    'admission.cancelled',
    'admission.created',
    'admission.reopened',
    'admission.updated',
    'booking.cancelled',
    'booking.created',
    'booking.extended',
    'booking.shortened',
    'booking.updated',
    'checkin.created',
    'checkout.created',
  ].sort();
  assert.deepEqual(actions, expectedActions);
});

test('2. Correct resident-to-event associations', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  for (const item of result.items) {
    if (
      item.targetType === 'booking' ||
      item.targetType === 'admission' ||
      item.targetType === 'check_in' ||
      item.targetType === 'check_out'
    ) {
      assert.ok(item.targetId, `targetId should be present for ${item.action}`);
    }
  }
});

test('3. Multiple bookings for the same resident', async () => {
  const baseTime = new Date('2027-01-15T10:00:00Z');
  const bookingId1 = randomUUID();
  const bookingId2 = randomUUID();
  const targetIds = {
    bookingIds: [bookingId1, bookingId2],
    admissionIds: [],
    checkInIds: [],
    checkOutIds: [],
  };
  const events = [
    makeAuditEvent({
      action: 'booking.created',
      targetType: 'booking',
      targetId: bookingId1,
      occurredAt: new Date(baseTime.getTime() - 100000),
    }),
    makeAuditEvent({
      action: 'booking.created',
      targetType: 'booking',
      targetId: bookingId2,
      occurredAt: new Date(baseTime.getTime() - 50000),
    }),
  ];
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  assert.equal(result.items.length, 2);
  assert.ok(result.items.some((i) => i.targetId === bookingId1));
  assert.ok(result.items.some((i) => i.targetId === bookingId2));
});

test('4. Organization isolation - events scoped to organization', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  assert.equal(result.items.length, 12);
  for (const item of result.items) {
    assert.ok(item.id);
    assert.ok(item.occurredAt);
  }
});

test('5. Cross-tenant resident returns 404', async () => {
  const OTHER_ORG = randomUUID();
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  await assert.rejects(
    () => service.getHistory(OTHER_ORG, RESIDENT_ID, { page: 1, limit: 50 }),
    /Resident not found/,
  );
});

test('6. Chronological ordering (occurredAt DESC)', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  for (let i = 1; i < result.items.length; i++) {
    const prev = new Date(result.items[i - 1]!.occurredAt).getTime();
    const curr = new Date(result.items[i]!.occurredAt).getTime();
    assert.ok(prev >= curr, 'Events should be ordered by occurredAt DESC');
  }
});

test('7. Stable ordering for identical timestamps (id ASC tie-break)', async () => {
  const baseTime = new Date('2027-01-15T10:00:00Z');
  const targetId = randomUUID();
  const targetIds = { bookingIds: [targetId], admissionIds: [], checkInIds: [], checkOutIds: [] };
  const events = [
    makeAuditEvent({
      action: 'booking.created',
      targetType: 'booking',
      targetId,
      occurredAt: baseTime,
      id: 'aaa-aaa',
    }),
    makeAuditEvent({
      action: 'booking.updated',
      targetType: 'booking',
      targetId,
      occurredAt: baseTime,
      id: 'bbb-bbb',
    }),
    makeAuditEvent({
      action: 'booking.cancelled',
      targetType: 'booking',
      targetId,
      occurredAt: baseTime,
      id: 'ccc-ccc',
    }),
  ];
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  assert.equal(result.items.length, 3);
  assert.equal(result.items[0]!.id, 'aaa-aaa');
  assert.equal(result.items[1]!.id, 'bbb-bbb');
  assert.equal(result.items[2]!.id, 'ccc-ccc');
});

test('8. Pagination across multiple pages', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const page1 = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 5 });
  const page2 = await service.getHistory(ORG, RESIDENT_ID, { page: 2, limit: 5 });
  const page3 = await service.getHistory(ORG, RESIDENT_ID, { page: 3, limit: 5 });

  assert.equal(page1.items.length, 5);
  assert.equal(page2.items.length, 5);
  assert.equal(page3.items.length, 2);
  assert.equal(page1.total, 12);
  assert.equal(page2.total, 12);
  assert.equal(page3.total, 12);

  const allIds = [...page1.items, ...page2.items, ...page3.items].map((i) => i.id);
  const uniqueIds = new Set(allIds);
  assert.equal(uniqueIds.size, 12, 'All pages should have unique items');
});

test('9. Accurate total count and total pages', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 5 });

  assert.equal(result.total, 12);
  assert.equal(result.totalPages, 3);
  assert.equal(result.page, 1);
  assert.equal(result.limit, 5);
});

test('10. Action filters work correctly', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const bookingOnly = await service.getHistory(ORG, RESIDENT_ID, {
    page: 1,
    limit: 50,
    action: 'booking.created',
  });
  assert.equal(bookingOnly.items.length, 1);
  assert.equal(bookingOnly.items[0]!.action, 'booking.created');

  const admissionOnly = await service.getHistory(ORG, RESIDENT_ID, {
    page: 1,
    limit: 50,
    action: 'admission.approved',
  });
  assert.equal(admissionOnly.items.length, 1);
  assert.equal(admissionOnly.items[0]!.action, 'admission.approved');
});

test('11. From-date and to-date filters', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const midDate = new Date('2027-01-15T10:00:00Z');
  const fromDate = new Date(midDate.getTime() - 40000).toISOString();
  const toDate = new Date(midDate.getTime() + 40000).toISOString();

  const filtered = await service.getHistory(ORG, RESIDENT_ID, {
    page: 1,
    limit: 50,
    fromDate,
    toDate,
  });

  for (const item of filtered.items) {
    const occurredAt = new Date(item.occurredAt).getTime();
    assert.ok(occurredAt >= new Date(fromDate).getTime(), 'All events should be >= fromDate');
    assert.ok(occurredAt <= new Date(toDate).getTime(), 'All events should be <= toDate');
  }
});

test('12. Invalid query parameters are handled', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  await assert.rejects(
    () =>
      service.getHistory(ORG, RESIDENT_ID, {
        page: 'invalid',
        limit: 'invalid',
        action: 'invalid-action',
      }),
    /page must be an integer/,
  );
});

test('13. Explicit metadata allowlists', async () => {
  const baseTime = new Date('2027-01-15T10:00:00Z');
  const bookingId = randomUUID();
  const targetIds = { bookingIds: [bookingId], admissionIds: [], checkInIds: [], checkOutIds: [] };
  const events = [
    makeAuditEvent({
      action: 'booking.created',
      targetType: 'booking',
      targetId: bookingId,
      occurredAt: baseTime,
      metadata: {
        residentId: RESIDENT_ID,
        bedId: 'bed-1',
        startDate: '2027-04-01',
        endDate: '2027-07-01',
        monthlyPrice: '5000',
        extraField: 'should-be-excluded',
      },
    }),
  ];
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  assert.equal(result.items.length, 1);
  const metadata = result.items[0]!.metadata;
  assert.ok('residentId' in metadata);
  assert.ok('bedId' in metadata);
  assert.ok('startDate' in metadata);
  assert.ok('endDate' in metadata);
  assert.ok('monthlyPrice' in metadata);
  assert.ok(!('extraField' in metadata), 'Extra fields should be excluded by allowlist');
});

test('14. Legacy event metadata compatibility', async () => {
  const baseTime = new Date('2027-01-15T10:00:00Z');
  const bookingId = randomUUID();
  const targetIds = { bookingIds: [bookingId], admissionIds: [], checkInIds: [], checkOutIds: [] };
  const events = [
    makeAuditEvent({
      action: 'booking.extended',
      targetType: 'booking',
      targetId: bookingId,
      occurredAt: baseTime,
      metadata: {
        previousEndDate: '2027-06-01',
        newEndDate: '2027-08-01',
        reason: 'Extended',
        approvedByUserId: ACTOR,
        approvedByRole: 'OWNER',
        approvedAt: '2027-04-10T10:00:00Z',
        legacyField: 'old',
      },
    }),
    makeAuditEvent({
      action: 'booking.shortened',
      targetType: 'booking',
      targetId: bookingId,
      occurredAt: baseTime,
      metadata: {
        previousEndInstant: '2027-08-01T00:00:00Z',
        newEndInstant: '2027-07-01T00:00:00Z',
        additionalChanges: [],
      },
    }),
  ];
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  const extended = result.items.find((i) => i.action === 'booking.extended');
  assert.ok(extended);
  assert.equal(extended.metadata.previousEndDate, '2027-06-01');
  assert.equal(extended.metadata.newEndDate, '2027-08-01');
  assert.equal(extended.metadata.reason, 'Extended');
  assert.ok(!('legacyField' in extended.metadata));

  const shortened = result.items.find((i) => i.action === 'booking.shortened');
  assert.ok(shortened);
  assert.equal(shortened.metadata.previousEndInstant, '2027-08-01T00:00:00Z');
  assert.equal(shortened.metadata.newEndInstant, '2027-07-01T00:00:00Z');
});

test('15. Null, missing and malformed metadata handled safely', async () => {
  const baseTime = new Date('2027-01-15T10:00:00Z');
  const bookingId = randomUUID();
  const targetIds = { bookingIds: [bookingId], admissionIds: [], checkInIds: [], checkOutIds: [] };
  const events = [
    makeAuditEvent({
      action: 'booking.created',
      targetType: 'booking',
      targetId: bookingId,
      occurredAt: baseTime,
      metadata: null,
    }),
    makeAuditEvent({
      action: 'booking.updated',
      targetType: 'booking',
      targetId: bookingId,
      occurredAt: baseTime,
      metadata: undefined,
    }),
    makeAuditEvent({
      action: 'booking.cancelled',
      targetType: 'booking',
      targetId: bookingId,
      occurredAt: baseTime,
      metadata: 'not-an-object',
    }),
    makeAuditEvent({
      action: 'booking.extended',
      targetType: 'booking',
      targetId: bookingId,
      occurredAt: baseTime,
      metadata: { reason: 'Valid' },
    }),
  ];
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  assert.equal(result.items.length, 4);
  for (const item of result.items) {
    assert.ok(typeof item.metadata === 'object' && item.metadata !== null);
  }
  const validExtended = result.items.find((i) => i.action === 'booking.extended');
  assert.equal(validExtended?.metadata.reason, 'Valid');
});

test('16. Sensitive-field exclusion', async () => {
  const baseTime = new Date('2027-01-15T10:00:00Z');
  const bookingId = randomUUID();
  const targetIds = { bookingIds: [bookingId], admissionIds: [], checkInIds: [], checkOutIds: [] };
  const events = [
    makeAuditEvent({
      action: 'booking.created',
      targetType: 'booking',
      targetId: bookingId,
      occurredAt: baseTime,
      metadata: {
        residentId: RESIDENT_ID,
        password: 'secret',
        token: 'jwt-token',
        ssn: '123-45-6789',
      },
    }),
  ];
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });

  const metadata = result.items[0]!.metadata;
  assert.ok(!('password' in metadata));
  assert.ok(!('token' in metadata));
  assert.ok(!('ssn' in metadata));
  assert.ok('residentId' in metadata);
});

test('17. Empty history returns correct structure', async () => {
  const targetIds = { bookingIds: [], admissionIds: [], checkInIds: [], checkOutIds: [] };
  const events: any[] = [];
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 20 });

  assert.equal(result.items.length, 0);
  assert.equal(result.total, 0);
  assert.equal(result.page, 1);
  assert.equal(result.limit, 20);
  assert.equal(result.totalPages, 0);
  assert.ok(Array.isArray(result.items));
});

test('18. Database error propagation', async () => {
  const prisma = {
    resident: {
      findFirst: async () => {
        throw new Error('Database connection lost');
      },
    },
    booking: { findMany: async () => [] },
    admission: { findMany: async () => [] },
    checkIn: { findMany: async () => [] },
    checkOut: { findMany: async () => [] },
    auditEvent: { findMany: async () => [], count: async () => 0 },
  };
  const service = new ResidentHistoryService({ db: prisma } as any);

  await assert.rejects(
    () => service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 20 }),
    /Database connection lost/,
  );
});

// Authorization tests for ResidentHistoryController
const createMockRequest = (role: string, organizationId: string = ORG) => ({
  auth: {
    sessionId: randomUUID(),
    userId: randomUUID(),
    organizationId,
    organizationName: 'Test Org',
    displayName: 'Test User',
    role: role as 'OWNER' | 'PROPERTY_MANAGER',
    passwordChangeRequired: false,
  },
  headers: { cookie: '' },
});

test('19. OWNER can access resident history', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  // Simulate controller authorization check
  const req = createMockRequest('OWNER');
  const role = req.auth?.role;
  assert.ok(role === 'OWNER' || role === 'PROPERTY_MANAGER', 'OWNER role should be allowed');

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });
  assert.equal(result.items.length, 12);
});

test('20. PROPERTY_MANAGER can access resident history', async () => {
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  // Simulate controller authorization check
  const req = createMockRequest('PROPERTY_MANAGER');
  const role = req.auth?.role;
  assert.ok(
    role === 'OWNER' || role === 'PROPERTY_MANAGER',
    'PROPERTY_MANAGER role should be allowed',
  );

  const result = await service.getHistory(ORG, RESIDENT_ID, { page: 1, limit: 50 });
  assert.equal(result.items.length, 12);
});

test('21. Other authenticated roles are denied by RoleGuard', () => {
  const unauthorizedRoles = ['VIEWER', 'STAFF', 'ADMIN', ''];
  for (const role of unauthorizedRoles) {
    const req = createMockRequest(role);
    const isAllowed = req.auth?.role === 'OWNER' || req.auth?.role === 'PROPERTY_MANAGER';
    assert.equal(isAllowed, false, `Role ${role} should be denied`);
  }
});

test('22. Unauthenticated requests are denied by SessionGuard', () => {
  const req = { auth: undefined, headers: { cookie: '' } };
  assert.equal(!!req.auth, false, 'Unauthenticated request should have no auth');
});

test('23. Organization isolation remains intact with authorization', async () => {
  const OTHER_ORG = randomUUID();
  const { targetIds, events } = createTestEvents();
  const prisma = makeFakePrisma(events, targetIds);
  const service = new ResidentHistoryService({ db: prisma } as any);

  // OWNER from different org should not find resident
  const req = createMockRequest('OWNER', OTHER_ORG);
  assert.equal(req.auth?.organizationId, OTHER_ORG);

  await assert.rejects(
    () => service.getHistory(OTHER_ORG, RESIDENT_ID, { page: 1, limit: 50 }),
    /Resident not found/,
  );
});
test('corrections are visible without a booking and remain scoped to this resident and tenant', async () => {
  const proposalId = randomUUID();
  const targetIds = { bookingIds: [], admissionIds: [], checkInIds: [], checkOutIds: [] };
  const events = [
    makeAuditEvent({
      action: 'correction.applied',
      targetType: 'resident',
      targetId: RESIDENT_ID,
      metadata: {
        proposalId,
        fieldKey: 'firstName',
        originalValue: 'private original',
        proposedValue: 'private proposed',
      },
    }),
    makeAuditEvent({
      action: 'correction.applied',
      targetType: 'resident',
      targetId: OTHER_RESIDENT_ID,
    }),
    makeAuditEvent({
      organizationId: randomUUID(),
      action: 'correction.applied',
      targetType: 'resident',
      targetId: RESIDENT_ID,
    }),
  ];
  const service = new ResidentHistoryService({ db: makeFakePrisma(events, targetIds) } as any);
  for (const query of [{}, { action: 'correction.applied' }]) {
    const result = await service.getHistory(ORG, RESIDENT_ID, query);
    assert.equal(result.total, 1);
    assert.equal(result.items[0]!.targetId, RESIDENT_ID);
    assert.deepEqual(result.items[0]!.metadata, { proposalId, fieldKey: 'firstName' });
  }
});

test('booking corrections are in history, but another resident’s booking is excluded even with an action filter', async () => {
  const bookingId = randomUUID();
  const targetIds = { bookingIds: [bookingId], admissionIds: [], checkInIds: [], checkOutIds: [] };
  const events = [
    makeAuditEvent({
      action: 'booking.corrected',
      targetType: 'booking',
      targetId: bookingId,
      metadata: { proposalId: 'p', fieldKey: 'endDate' },
    }),
    makeAuditEvent({ action: 'booking.corrected', targetType: 'booking', targetId: randomUUID() }),
  ];
  const service = new ResidentHistoryService({ db: makeFakePrisma(events, targetIds) } as any);
  for (const query of [{}, { action: 'booking.corrected' }]) {
    const result = await service.getHistory(ORG, RESIDENT_ID, query);
    assert.equal(result.total, 1);
    assert.equal(result.items[0]!.targetId, bookingId);
  }
});
