/* eslint-disable @typescript-eslint/no-explicit-any -- narrow database and HTTP boundary fakes */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '../src/generated/client.js';
import { TransferService } from '../src/transfer/transfer.service.js';
import { TransferController } from '../src/transfer/transfer.controller.js';
import { RoleGuard, SessionGuard, CsrfGuard, OriginGuard } from '../src/auth/auth.guards.js';

const org = '00000000-0000-4000-8000-000000000001';
const resident = '00000000-0000-4000-8000-000000000002';
const destination = '00000000-0000-4000-8000-000000000003';
const source = '00000000-0000-4000-8000-000000000004';
const date = (year: number) => new Date(`${year}-01-01T00:00:00Z`);
function fixture() {
  const bed = (id: string, roomId = 'room') => ({
    id,
    roomId,
    organizationId: org,
    label: id,
    propertyId: 'property',
    price: new Prisma.Decimal(5000),
    operationalStatus: 'IN_SERVICE',
    archivedAt: null,
    room: {
      id: roomId,
      label: roomId,
      archivedAt: null,
      floor: { archivedAt: null, property: { id: 'property', name: 'Property', archivedAt: null } },
    },
  });
  const booking = {
    id: 'booking',
    status: 'CONFIRMED',
    startDate: date(2020),
    endDate: date(2090),
    monthlyPrice: new Prisma.Decimal(5000),
  };
  const stay = {
    id: 'stay',
    bookingId: booking.id,
    booking,
    admission: { status: 'ADMITTED' },
    checkInAt: date(2020),
    bedId: 'old-commercial-bed',
    bed: bed('old-commercial-bed', 'old-room'),
  };
  const assignment = { id: 'assignment', bedId: source, startAt: date(2020), endAt: null };
  const calls: any[] = [];
  const scoped = (args: any) => {
    assert.equal(args.where.organizationId, org);
    calls.push(args);
  };
  const tx: any = {
    $executeRaw: async (sql: TemplateStringsArray) =>
      assert.equal(sql.join(''), 'SET TRANSACTION READ ONLY'),
    resident: {
      findFirst: async (args: any) => {
        scoped(args);
        return { status: 'ACTIVE' };
      },
    },
    checkIn: {
      findMany: async (args: any) => {
        scoped(args);
        return args.where.residentId ? [stay] : [];
      },
    },
    effectiveStayAssignment: {
      findFirst: async (args: any) => {
        scoped(args);
        return assignment;
      },
      count: async () => 1,
      findMany: async (args: any) => {
        scoped(args);
        return [];
      },
    },
    booking: {
      findMany: async (args: any) => {
        scoped(args);
        return [];
      },
    },
    bed: {
      findFirst: async (args: any) => {
        scoped(args);
        return args.where.id === source ? bed(source) : bed(destination);
      },
    },
  };
  const service = new TransferService({
    db: {
      $transaction: async (callback: any, options: any) => {
        assert.equal(options.isolationLevel, 'RepeatableRead');
        return callback(tx);
      },
    },
  } as any);
  const preview = () =>
    service.preview({ organizationId: org, residentId: resident, destinationBedId: destination });
  return { tx, service, preview, assignment, stay, bed, calls };
}

test('preview uses current assignment, equal Decimal values and read-only tenant scoped reads', async () => {
  const f = fixture();
  const result = await f.preview();
  assert.equal(result.currentAssignment.bedId, source);
  assert.equal(result.transferType, 'BED_TRANSFER');
  assert.equal(result.available, true);
  assert.equal(result.executionEnabled, false);
  assert.ok(!result.unresolvedDecisions.some((s) => s.startsWith('D1') || s.startsWith('D5')));
});

test('room type and policy warnings reflect physical destination without approving execution', async () => {
  const f = fixture();
  f.tx.bed.findFirst = async ({ where }: any) => f.bed(where.id, where.id);
  assert.equal((await f.preview()).transferType, 'ROOM_TRANSFER');
});

test('foreign resident and destination return not found without foreign data', async () => {
  const f = fixture();
  f.tx.resident.findFirst = async () => null;
  await assert.rejects(f.preview(), { status: 404 });
  const g = fixture();
  g.tx.bed.findFirst = async ({ where }: any) => (where.id === source ? g.bed(source) : null);
  await assert.rejects(g.preview(), { status: 404 });
});

test('ambiguous stay, missing assignment and same current bed are rejected', async () => {
  const f = fixture();
  f.tx.checkIn.findMany = async () => [f.stay, f.stay];
  await assert.rejects(f.preview(), { status: 409 });
  const g = fixture();
  g.tx.effectiveStayAssignment.findFirst = async () => null;
  await assert.rejects(g.preview(), { status: 409 });
  const h = fixture();
  h.assignment.bedId = destination;
  await assert.rejects(h.preview(), { status: 409 });
});

test('overlapping assignments and confirmed reservations make destination unavailable', async () => {
  const f = fixture();
  f.tx.effectiveStayAssignment.findMany = async ({ where }: any) => {
    assert.equal(where.bedId, destination);
    assert.deepEqual(where.startAt, { lt: new Date('2089-12-31T18:30:00Z') });
    return [{ id: 'segment', startAt: date(2020), endAt: null }];
  };
  f.tx.booking.findMany = async ({ where }: any) => {
    assert.equal(where.status, 'CONFIRMED');
    assert.deepEqual(where.startDate, { lt: date(2090) });
    return [{ id: 'reserved', startDate: date(2025), endDate: date(2080) }];
  };
  const result = await f.preview();
  assert.equal(result.available, false);
  assert.equal(result.conflicts.length, 2);
});

test('closed booking, out of service destination and invalid effective times cannot appear available', async () => {
  const f = fixture();
  f.stay.booking.status = 'CANCELLED';
  assert.equal((await f.preview()).available, false);
  const g = fixture();
  g.tx.bed.findFirst = async ({ where }: any) => ({
    ...g.bed(where.id),
    operationalStatus: 'OUT_OF_SERVICE',
  });
  await assert.rejects(g.preview(), { status: 409 });
  for (const time of [new Date(NaN), date(2100), date(2019)]) {
    await assert.rejects(
      f.service.preview({
        organizationId: org,
        residentId: resident,
        destinationBedId: destination,
        effectiveAt: time,
      }),
    );
  }
});

test('controller uses session tenant; rejects unzoned, invalid and injected query fields', async () => {
  const f = fixture();
  const controller = new TransferController(f.service);
  const req: any = { auth: { organizationId: org } };
  assert.deepEqual(Reflect.getMetadata('__guards__', TransferController), [
    SessionGuard,
    RoleGuard,
  ]);
  for (const effectiveAt of ['2026-01-01', '', 'invalid', '2026-02-30T00:00:00Z']) {
    await assert.rejects(
      controller.preview(req, { residentId: resident, destinationBedId: destination, effectiveAt }),
      { status: 400 },
    );
  }
  await assert.rejects(
    controller.preview(req, {
      residentId: resident,
      destinationBedId: destination,
      organizationId: 'foreign',
    } as any),
    { status: 400 },
  );
  assert.equal(
    (await controller.preview(req, { residentId: resident, destinationBedId: destination }))
      .available,
    true,
  );
});

test('role guard permits owner/manager and refuses absent or unsupported roles', () => {
  const guard = new RoleGuard();
  const context = (role: string | undefined): any => ({
    switchToHttp: () => ({ getRequest: () => ({ auth: { role } }) }),
  });
  for (const role of ['OWNER', 'PROPERTY_MANAGER'])
    assert.equal(guard.canActivate(context(role)), true);
  for (const role of ['VIEWER', undefined])
    assert.throws(() => guard.canActivate(context(role)), { status: 403 });
});

test('HTTP route resolves dependencies and enforces real session and role guards', async () => {
  const { Module } = await import('@nestjs/common');
  const { NestFactory } = await import('@nestjs/core');
  const { SessionService } = await import('../src/auth/session.service.js');
  const { CsrfService } = await import('../src/auth/csrf.service.js');
  const { default: request } = await import('supertest');
  const f = fixture();
  @Module({
    controllers: [TransferController],
    providers: [
      { provide: TransferService, useValue: f.service },
      {
        provide: SessionService,
        useValue: {
          authenticate: async (secret: string) =>
            secret
              ? {
                  organizationId: org,
                  role: secret,
                  passwordChangeRequired: false,
                }
              : null,
        },
      },
      SessionGuard,
      RoleGuard,
      CsrfGuard,
      OriginGuard,
      CsrfService,
    ],
  })
  class PreviewHttpModule {}
  const app = await NestFactory.create(PreviewHttpModule, { logger: false });
  await app.init();
  try {
    const endpoint = `/transfers/preview?residentId=${resident}&destinationBedId=${destination}`;
    await request(app.getHttpServer()).get(endpoint).expect(401);
    await request(app.getHttpServer())
      .get(endpoint)
      .set('Cookie', 'nook_session=VIEWER')
      .expect(403);
    for (const role of ['OWNER', 'PROPERTY_MANAGER']) {
      const response = await request(app.getHttpServer())
        .get(endpoint)
        .set('Cookie', `nook_session=${role}`)
        .expect(200);
      assert.equal(response.body.currentAssignment.bedId, source);
      assert.equal(response.body.executionEnabled, false);
    }
  } finally {
    await app.close();
  }
});

test('history paginates with stable order, scoped count and safe actor projection', async () => {
  const f = fixture();
  let reads = 0;
  const existingBed = f.bed(source);
  f.tx.transfer = {
    count: async ({ where }: any) => {
      assert.deepEqual(where, { organizationId: org, residentId: resident });
      return 3;
    },
    findMany: async (args: any) => {
      reads++;
      assert.deepEqual(args.where, { organizationId: org, residentId: resident });
      assert.equal(args.skip, 2);
      assert.equal(args.take, 2);
      assert.deepEqual(args.orderBy, [{ recordedAt: 'desc' }, { id: 'desc' }]);
      assert.deepEqual(args.include.actor.select, { id: true, displayName: true });
      return [
        {
          id: 'transfer',
          type: 'BED_TRANSFER',
          sourceBedId: source,
          destinationBedId: destination,
          reason: 'Move',
          effectiveAt: date(2025),
          recordedAt: date(2025),
          actor: { id: 'actor', displayName: 'Staff' },
          sourceBed: existingBed,
          destBed: f.bed(destination),
          financeReviews: [],
        },
      ];
    },
  };
  const result = await f.service.history(org, { residentId: resident, page: '2', limit: '2' });
  assert.equal(result.items[0]!.source.bedLabel, source);
  assert.equal(result.total, 3);
  assert.equal(result.totalPages, 2);
  assert.equal(reads, 1);
  f.tx.resident.findFirst = async () => null;
  await assert.rejects(f.service.history(org, { residentId: resident }), { status: 404 });
  assert.equal(reads, 1);
  await assert.rejects(
    f.service.history(org, { residentId: resident, organizationId: 'foreign' }),
    { status: 400 },
  );
  await assert.rejects(f.service.history(org, { residentId: resident, page: '0' }), {
    status: 400,
  });
});

test('execution fails closed before any database effects and is protected by origin and CSRF guards', async () => {
  const service = new TransferService({
    get db() {
      throw new Error('Execution must not touch DB while blocked');
    },
  } as any);
  const input = {
    organizationId: org,
    actorUserId: source,
    actorRole: 'OWNER',
    residentId: resident,
    destinationBedId: destination,
    reason: 'Move',
    effectiveAt: date(2025),
    idempotencyKey: source,
  };
  for (let replay = 0; replay < 2; replay++) {
    await assert.rejects(service.execute(input), (error: any) => {
      assert.equal(error.getStatus(), 503);
      assert.deepEqual(error.getResponse().blockers, [
        'REQUESTER_REVIEWER_CONTRACT',
        'ASSIGNMENT_CONSUMER_ROLLOUT',
      ]);
      return true;
    });
  }
  await assert.rejects(service.execute({ ...input, actorRole: 'VIEWER' }), { status: 403 });
  await assert.rejects(service.execute({ ...input, idempotencyKey: 'bad' }), { status: 400 });
  assert.deepEqual(Reflect.getMetadata('__guards__', TransferController.prototype.execute), [
    OriginGuard,
    CsrfGuard,
  ]);
  const controller = new TransferController(service);
  const req: any = { auth: { organizationId: org, userId: source, role: 'OWNER' } };
  assert.throws(
    () =>
      controller.execute(req, source, {
        residentId: resident,
        destinationBedId: destination,
        reason: 'x',
        effectiveAt: '2025-01-01',
      }),
    { status: 400 },
  );
});

test('inactive and archived residents cannot receive a transfer preview', async () => {
  for (const status of ['INACTIVE', 'ARCHIVED']) {
    const f = fixture();
    f.tx.resident.findFirst = async () => ({ status });
    await assert.rejects(f.preview(), { status: 409 });
  }
});

test('finance preview uses IST billing boundaries and exact reference amounts without proration', async () => {
  const { transferFinancePreview } = await import('../src/transfer/transfer.finance.js');
  const input = {
    monthlyPrice: new Prisma.Decimal('5000.10'),
    sourcePrice: new Prisma.Decimal('5000.10'),
    destinationPrice: new Prisma.Decimal('5000.30'),
  };
  const boundary = transferFinancePreview({
    ...input,
    effectiveAt: new Date('2026-10-31T18:30:00Z'),
  });
  assert.equal(boundary.reviewRequired, false);
  assert.equal(boundary.reviewPeriod, null);
  assert.equal(boundary.referencePriceDifference, '0.20');
  const midMonth = transferFinancePreview({
    ...input,
    effectiveAt: new Date('2026-11-15T08:00:00Z'),
  });
  assert.equal(midMonth.reviewRequired, true);
  assert.equal(midMonth.reviewPeriod, '2026-11-01');
  assert.equal(midMonth.monthlyPrice, '5000.10');
  assert.equal(midMonth.proration, false);
  assert.equal(midMonth.issuedInvoicesUnchanged, true);
  assert.equal(midMonth.reviewSupported, false);
  assert.equal(midMonth.reviewBlocker, 'TRANSFER_FINANCE_LINK_CONTRACT');
});

test('preview exposes finance and server actions without authorizing a financial or extended transfer', async () => {
  const f = fixture();
  const result = await f.preview();
  assert.deepEqual(result.allowedActions, ['preview']);
  assert.ok(result.executionBlockers.includes('TRANSFER_FINANCE_LINK_CONTRACT'));
  assert.equal(result.finance.monthlyPrice, '5000.00');
  assert.equal(result.finance.referencePriceDifference, '0.00');
  assert.equal(result.finance.rentUnchanged, true);
  assert.ok(Number.isFinite(result.effectiveAt.getTime()));
});

test('booking interval ends at IST midnight and adjacent reservations do not collide', async () => {
  const f = fixture();
  f.stay.booking.endDate = new Date('2026-11-01T00:00:00Z');
  await assert.rejects(
    f.service.preview({
      organizationId: org,
      residentId: resident,
      destinationBedId: destination,
      effectiveAt: new Date('2026-10-31T18:30:00Z'),
    }),
    { status: 409 },
  );
  const g = fixture();
  g.tx.booking.findMany = async ({ where }: any) => {
    assert.equal(where.endDate.gt.getTime() - Date.now() <= 330 * 60_000 + 1000, true);
    assert.equal(where.startDate.lt.toISOString(), '2090-01-01T00:00:00.000Z');
    return [];
  };
  assert.equal((await g.preview()).available, true);
});

test('execution rejects impossible calendar dates before the policy gate', () => {
  const f = fixture();
  const controller = new TransferController(f.service);
  assert.throws(
    () =>
      controller.execute(
        { auth: { organizationId: org, userId: source, role: 'OWNER' } } as any,
        source,
        {
          residentId: resident,
          destinationBedId: destination,
          reason: 'Move',
          effectiveAt: '2026-02-30T08:00:00Z',
        },
      ),
    { status: 400 },
  );
});
