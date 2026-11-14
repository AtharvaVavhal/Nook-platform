/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies and raw SQL rows are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { todayIst } from '../../src/common/time.js';
import { PrismaClient } from '../../src/generated/client.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { DashboardService } from '../../src/dashboard/dashboard.service.js';
import {
  addDays,
  computeGates,
  dashboardWindows,
  dateKey,
} from '../../src/dashboard/dashboard.rules.js';
import type { Dashboard } from '../../src/dashboard/dashboard.types.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Owner dashboard (GET /api/v1/properties/:propertyId/dashboard), SYNTHETIC DATA ONLY.
// Date-window and arithmetic tests call the service with a FIXED `now` so every boundary is deterministic; the HTTP and
// reconciliation tests use the real clock because the existing finance endpoints they are compared with do.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

/** 2026-11-14 15:30 IST. */
const NOW = new Date('2026-11-14T10:00:00Z');
const ALL_GATES = computeGates(() => true);

let app: any;
let server: ReturnType<typeof request>;
let probeClient: PrismaClient;
let queries: string[] = [];
let txOptions: Array<Record<string, unknown> | undefined> = [];
let service: DashboardService;
let hashed: string;

test.before(async () => {
  hashed = await hashTestPassword();
  app = await NestFactory.create(AppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
  // A second client, with query logging, runs the SAME service code so the number of SQL statements and the
  // transaction isolation level can be observed.
  probeClient = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireTestDatabaseUrl() }),
    log: [{ emit: 'event', level: 'query' }],
  });
  (probeClient as any).$on('query', (event: { query: string }) => queries.push(event.query));
  // The proxy records the options the service passes to $transaction, then delegates unchanged.
  const db = new Proxy(probeClient, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (fn: unknown, options?: Record<string, unknown>) => {
          txOptions.push(options);
          return (target as any).$transaction(fn, options);
        };
      }
      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  service = new DashboardService({ db } as unknown as PrismaService);
});

test.after(async () => {
  await probeClient.$disconnect();
  await app.close();
});

// ------------------------------------------------------------------------------------------------ fixtures

interface Org {
  orgId: string;
  userId: string;
  email: string;
}

async function seedOrg(role: 'OWNER' | 'PROPERTY_MANAGER' = 'OWNER'): Promise<Org> {
  const org = {
    orgId: randomUUID(),
    userId: randomUUID(),
    email: `dash-${randomUUID()}@nook.test.invalid`,
  };
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      org.orgId,
      `Dashboard Org ${org.orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Dash Tester',now())`,
      [org.userId, org.email, hashed],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [randomUUID(), org.orgId, org.userId, role],
    );
    await c.query('COMMIT');
  });
  return org;
}

async function login(org: Org): Promise<Record<string, string>> {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email: org.email, password: TEST_PASSWORD })
    .expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  const session = set.find((c) => c.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((c) => c.startsWith('nook_csrf='))!.split(';')[0]!;
  return {
    Origin: ORIGIN,
    Cookie: `${session}; ${csrf}`,
    'x-csrf-token': csrf.slice('nook_csrf='.length),
  };
}

interface BedSpec {
  label: string;
  oos?: boolean;
  archived?: boolean;
}
interface RoomSpec {
  label: string;
  archived?: boolean;
  beds: BedSpec[];
}
interface FloorSpec {
  label: string;
  ordinal: number;
  archived?: boolean;
  rooms: RoomSpec[];
}
interface Prop {
  id: string;
  name: string;
  floor: Record<string, string>;
  room: Record<string, string>;
  bed: Record<string, string>;
  roomOfBed: Record<string, string>;
}

async function seedProperty(org: Org, name: string, floors: FloorSpec[]): Promise<Prop> {
  const prop: Prop = { id: randomUUID(), name, floor: {}, room: {}, bed: {}, roomOfBed: {} };
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,$4,now())`,
      [prop.id, org.orgId, `P-${prop.id.slice(0, 8)}`, name],
    );
    for (const floor of floors) {
      const floorId = randomUUID();
      prop.floor[floor.label] = floorId;
      await c.query(
        `INSERT INTO floors (id, organization_id, property_id, label, ordinal, archived_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())`,
        [
          floorId,
          org.orgId,
          prop.id,
          floor.label,
          floor.ordinal,
          floor.archived ? '2026-01-01T00:00:00Z' : null,
        ],
      );
      for (const room of floor.rooms) {
        const roomId = randomUUID();
        prop.room[room.label] = roomId;
        await c.query(
          `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, archived_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())`,
          [
            roomId,
            org.orgId,
            prop.id,
            floorId,
            room.label,
            room.archived ? '2026-01-01T00:00:00Z' : null,
          ],
        );
        for (const bed of room.beds) {
          const bedId = randomUUID();
          prop.bed[bed.label] = bedId;
          prop.roomOfBed[bed.label] = roomId;
          await c.query(
            `INSERT INTO beds (id, organization_id, property_id, room_id, label, operational_status, out_of_service_reason, archived_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6::"BedOperationalStatus",$7,$8,now())`,
            [
              bedId,
              org.orgId,
              prop.id,
              roomId,
              bed.label,
              bed.oos ? 'OUT_OF_SERVICE' : 'IN_SERVICE',
              bed.oos ? 'fixture' : null,
              bed.archived ? '2026-01-01T00:00:00Z' : null,
            ],
          );
        }
      }
    }
    await c.query('COMMIT');
  });
  return prop;
}

/** A small property with `floors` floors x `rooms` rooms x `beds` beds, bed labels `F{f}R{r}B{b}`. */
function gridSpec(floors: number, rooms: number, beds: number): FloorSpec[] {
  return Array.from({ length: floors }, (_, f) => ({
    label: `Floor ${f}`,
    ordinal: f,
    rooms: Array.from({ length: rooms }, (_, r) => ({
      label: `F${f}R${r}`,
      beds: Array.from({ length: beds }, (_, b) => ({ label: `F${f}R${r}B${b}` })),
    })),
  }));
}

async function seedResident(org: Org, first: string, last = 'Tester'): Promise<string> {
  const id = randomUUID();
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO residents (id, organization_id, first_name, last_name, status, updated_at) VALUES ($1,$2,$3,$4,'ACTIVE',now())`,
      [id, org.orgId, first, last],
    ),
  );
  return id;
}

interface BookingSpec {
  resident: string;
  bedId: string;
  start: string;
  end: string;
  status?: 'CONFIRMED' | 'CANCELLED';
  createdAt?: string;
}

const OLD = '2026-01-01T00:00:00Z';

async function seedBooking(org: Org, spec: BookingSpec): Promise<string> {
  const id = randomUUID();
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,5000,$7::"BookingStatus",$8,now())`,
      [
        id,
        org.orgId,
        spec.resident,
        spec.bedId,
        spec.start,
        spec.end,
        spec.status ?? 'CONFIRMED',
        spec.createdAt ?? OLD,
      ],
    ),
  );
  return id;
}

async function seedAdmission(
  org: Org,
  spec: {
    bookingId: string;
    resident: string;
    bedId: string;
    admissionDate: string;
    status: 'PENDING' | 'ADMITTED' | 'CANCELLED';
    createdAt?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::"AdmissionStatus",$8,now())`,
      [
        id,
        org.orgId,
        spec.bookingId,
        spec.resident,
        spec.bedId,
        spec.admissionDate,
        spec.status,
        spec.createdAt ?? OLD,
      ],
    ),
  );
  return id;
}

type Segments = 'none' | 'original' | 'zero-open' | 'two-open' | 'transferred';

interface StaySpec {
  bed: Prop['bed'][string];
  resident: string;
  start: string;
  end: string;
  checkInAt?: string;
  admissionDate?: string;
  bookingCreatedAt?: string;
  admissionCreatedAt?: string;
  checkedOutAt?: string;
  segments?: Segments;
  /** For `transferred` and `two-open`: the destination bed and where it lives. */
  transfer?: {
    destBedId: string;
    sourceRoomId: string;
    destRoomId: string;
    sourcePropertyId: string;
    destPropertyId: string;
  };
  /** Check-in status other than the default (ACTIVE, or CHECKED_OUT when `checkedOutAt` is given). */
}

/** A booking, an ADMITTED admission, a check-in (and optionally a check-out) with the chosen stay-segment history. */
async function seedStay(org: Org, spec: StaySpec) {
  const ids = {
    booking: randomUUID(),
    admission: randomUUID(),
    checkIn: randomUUID(),
    checkOut: randomUUID(),
  };
  const checkInAt = spec.checkInAt ?? OLD;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,5000,'CONFIRMED',$7,now())`,
      [
        ids.booking,
        org.orgId,
        spec.resident,
        spec.bed,
        spec.start,
        spec.end,
        spec.bookingCreatedAt ?? OLD,
      ],
    );
    await c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'ADMITTED',$7,now())`,
      [
        ids.admission,
        org.orgId,
        ids.booking,
        spec.resident,
        spec.bed,
        spec.admissionDate ?? checkInAt,
        spec.admissionCreatedAt ?? OLD,
      ],
    );
    await c.query(
      `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"CheckInStatus",now())`,
      [
        ids.checkIn,
        org.orgId,
        ids.admission,
        spec.resident,
        spec.bed,
        ids.booking,
        checkInAt,
        spec.checkedOutAt ? 'CHECKED_OUT' : 'ACTIVE',
      ],
    );
    if (spec.checkedOutAt) {
      await c.query(
        `INSERT INTO check_outs (id, organization_id, check_in_id, resident_id, bed_id, booking_id, check_out_at, reason, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'fixture departure',now())`,
        [
          ids.checkOut,
          org.orgId,
          ids.checkIn,
          spec.resident,
          spec.bed,
          ids.booking,
          spec.checkedOutAt,
        ],
      );
    }
    const segments = spec.segments ?? (spec.checkedOutAt ? 'none' : 'original');
    const segment = (
      bedId: string,
      kind: string,
      status: string,
      start: string,
      end: string | null,
      transferId: string | null,
    ) =>
      c.query(
        `INSERT INTO stay_assignments (organization_id, booking_id, resident_id, bed_id, kind, status, start_at, end_at, transfer_id)
         VALUES ($1,$2,$3,$4,$5::"StayAssignmentKind",$6::"StayAssignmentStatus",$7,$8,$9)`,
        [org.orgId, ids.booking, spec.resident, bedId, kind, status, start, end, transferId],
      );
    const transferRow = async () => {
      const t = spec.transfer!;
      const transferId = randomUUID();
      await c.query(
        `INSERT INTO transfers (id, organization_id, resident_id, booking_id, type, source_bed_id, source_room_id, source_property_id,
           destination_bed_id, destination_room_id, destination_property_id, reason, effective_at, actor_user_id, actor_role, idempotency_key)
         VALUES ($1,$2,$3,$4,'ROOM_TRANSFER',$5,$6,$7,$8,$9,$10,'Fixture history',$11,$12,'OWNER',$13)`,
        [
          transferId,
          org.orgId,
          spec.resident,
          ids.booking,
          spec.bed,
          t.sourceRoomId,
          t.sourcePropertyId,
          t.destBedId,
          t.destRoomId,
          t.destPropertyId,
          '2026-06-01T00:00:00Z',
          org.userId,
          randomUUID(),
        ],
      );
      return transferId;
    };
    if (segments === 'original') {
      await segment(spec.bed, 'ORIGINAL', 'ACTIVE', checkInAt, null, null);
    } else if (segments === 'zero-open') {
      await segment(spec.bed, 'ORIGINAL', 'COMPLETED', checkInAt, '2026-06-01T00:00:00Z', null);
    } else if (segments === 'transferred') {
      const transferId = await transferRow();
      await segment(spec.bed, 'ORIGINAL', 'COMPLETED', checkInAt, '2026-06-01T00:00:00Z', null);
      await segment(
        spec.transfer!.destBedId,
        'TRANSFER',
        'ACTIVE',
        '2026-06-01T00:00:00Z',
        null,
        transferId,
      );
    } else if (segments === 'two-open') {
      const transferId = await transferRow();
      await segment(spec.bed, 'ORIGINAL', 'ACTIVE', checkInAt, null, null);
      await segment(
        spec.transfer!.destBedId,
        'TRANSFER',
        'ACTIVE',
        '2026-06-01T00:00:00Z',
        null,
        transferId,
      );
    }
    await c.query('COMMIT');
  });
  return ids;
}

let invoiceCounter = 0;
interface InvoiceSpec {
  resident: string;
  bookingId: string | null;
  /** `YYYY-MM-01` */
  period: string;
  amount: string;
  paid?: string;
  adjustment?: string;
  status?: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  due: string;
}

async function seedInvoice(org: Org, spec: InvoiceSpec): Promise<string> {
  const id = randomUUID();
  const status = spec.status ?? 'ISSUED';
  const periodEnd = dateKey(addDays(new Date(`${spec.period}T00:00:00Z`), 27));
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, paid_amount,
         adjustment_total, status, due_date, issued_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::"InvoiceStatus",$12,$13,now())`,
      [
        id,
        org.orgId,
        spec.resident,
        spec.bookingId,
        `INV-2026-${String(++invoiceCounter).padStart(6, '0')}`,
        spec.period,
        periodEnd,
        spec.amount,
        spec.paid ?? '0.00',
        spec.adjustment ?? '0.00',
        status,
        spec.due,
        status === 'DRAFT' ? null : '2026-01-01T00:00:00Z',
      ],
    ),
  );
  return id;
}

/**
 * Records a payment the way the ledger does: the snapshot trigger checks the payment against the invoice's balance AT
 * INSERT, so the invoice is rewound to its pre-payment state, the payment is inserted, and the invoice's final state
 * (given by the caller as paid_amount / status) is restored. A reversed payment never contributed to paid_amount.
 */
async function seedPayment(
  org: Org,
  spec: {
    invoiceId: string;
    resident: string;
    amount: string;
    receivedAt: string;
    reversed?: boolean;
  },
): Promise<string> {
  const id = randomUUID();
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    let finalStatus: string | null = null;
    if (!spec.reversed) {
      finalStatus = (
        await c.query(`SELECT status FROM invoices WHERE id = $1 AND organization_id = $2`, [
          spec.invoiceId,
          org.orgId,
        ])
      ).rows[0].status;
      await c.query(
        `UPDATE invoices
            SET paid_amount = paid_amount - $3::numeric,
                status = (CASE WHEN paid_amount - $3::numeric + adjustment_total > 0
                               THEN 'PARTIALLY_PAID' ELSE 'ISSUED' END)::"InvoiceStatus"
          WHERE id = $1 AND organization_id = $2`,
        [spec.invoiceId, org.orgId, spec.amount],
      );
    }
    await c.query(
      `INSERT INTO payments (id, organization_id, invoice_id, resident_id, amount, method, received_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'UPI',$6,now())`,
      [id, org.orgId, spec.invoiceId, spec.resident, spec.amount, spec.receivedAt],
    );
    if (!spec.reversed) {
      await c.query(
        `UPDATE invoices SET paid_amount = paid_amount + $3::numeric, status = $4::"InvoiceStatus"
          WHERE id = $1 AND organization_id = $2`,
        [spec.invoiceId, org.orgId, spec.amount, finalStatus],
      );
    }
    if (spec.reversed) {
      await c.query(
        `INSERT INTO payment_reversals (organization_id, payment_id, invoice_id, reason, reversed_by) VALUES ($1,$2,$3,'fixture',$4)`,
        [org.orgId, id, spec.invoiceId, org.userId],
      );
    }
    await c.query('COMMIT');
  });
  return id;
}

const params = (month = '2026-11', days = 14) => ({ month, days });

function dash(
  org: Org,
  propertyId: string,
  opts: { now?: Date; month?: string; days?: number; gates?: ReturnType<typeof computeGates> } = {},
): Promise<Dashboard> {
  return service.build({
    organizationId: org.orgId,
    propertyId,
    params: params(opts.month, opts.days),
    gates: opts.gates ?? ALL_GATES,
    now: opts.now ?? NOW,
  });
}

async function counts(orgId: string): Promise<Record<string, number>> {
  return withMigratorClient(async (c) => {
    const out: Record<string, number> = {};
    for (const t of [
      'rooms',
      'beds',
      'bookings',
      'admissions',
      'check_ins',
      'check_outs',
      'invoices',
      'payments',
      'stay_assignments',
    ]) {
      out[t] = Number(
        (await c.query(`SELECT count(*) n FROM ${t} WHERE organization_id = $1`, [orgId])).rows[0]
          .n,
      );
    }
    return out;
  });
}

async function fingerprint(orgId: string): Promise<Record<string, string>> {
  return withMigratorClient(async (c) => {
    const out: Record<string, string> = {};
    for (const t of [
      'beds',
      'bookings',
      'admissions',
      'check_ins',
      'check_outs',
      'invoices',
      'payments',
      'stay_assignments',
      'properties',
    ]) {
      const r = await c.query(
        `SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t.id::text)), 'empty') h FROM ${t} t WHERE t.organization_id = $1`,
        [orgId],
      );
      out[t] = r.rows[0].h;
    }
    return out;
  });
}

// ------------------------------------------------------------------------------------------------ World A

/**
 * One property with every inventory and lifecycle case, at the fixed NOW (today = 2026-11-14 IST).
 * Live beds: g1a g1b g1c g2a(out of service) f1a f1b = 6 in 4 live rooms; archived and other-property rows are noise.
 */
let worldAPromise:
  | Promise<{ org: Org; prop: Prop; other: Prop; ids: Record<string, any> }>
  | undefined;
function worldA() {
  worldAPromise ??= buildWorldA();
  return worldAPromise;
}

async function buildWorldA() {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Main', [
    {
      label: 'Ground',
      ordinal: 0,
      rooms: [
        {
          label: 'G1',
          beds: [
            { label: 'g1a' },
            { label: 'g1b' },
            { label: 'g1c' },
            { label: 'g1x', archived: true },
          ],
        },
        { label: 'G2', beds: [{ label: 'g2a', oos: true }] },
        { label: 'Old', archived: true, beds: [{ label: 'old1' }] },
      ],
    },
    {
      label: 'First',
      ordinal: 1,
      rooms: [
        { label: 'F1R1', beds: [{ label: 'f1a' }, { label: 'f1b' }] },
        { label: 'Empty', beds: [] },
      ],
    },
    { label: 'Roof', ordinal: 2, rooms: [] },
    {
      label: 'Gone',
      ordinal: 3,
      archived: true,
      rooms: [{ label: 'Lost', beds: [{ label: 'lost1' }] }],
    },
  ]);
  const other = await seedProperty(org, 'Other', gridSpec(1, 1, 2));
  const r = {
    asha: await seedResident(org, 'Asha', 'Rao'),
    bala: await seedResident(org, 'Bala', 'Iyer'),
    chitra: await seedResident(org, 'Chitra', 'Nair'),
    dev: await seedResident(org, 'Dev', 'Shah'),
    elan: await seedResident(org, 'Elan'),
    farah: await seedResident(org, 'Farah'),
    gopal: await seedResident(org, 'Gopal'),
    hari: await seedResident(org, 'Hari'),
    indu: await seedResident(org, 'Indu'),
    jay: await seedResident(org, 'Jay'),
    esha: await seedResident(org, 'Esha'),
    gita: await seedResident(org, 'Gita'),
    farid: await seedResident(org, 'Farid'),
    outsider: await seedResident(org, 'Outsider'),
  };
  const ids: Record<string, any> = { r };
  // Active stays.
  ids.s1 = await seedStay(org, {
    bed: prop.bed.g1a!,
    resident: r.asha,
    start: '2026-01-01',
    end: '2026-11-14',
    admissionDate: '2026-11-01T00:00:00Z',
  });
  ids.s2 = await seedStay(org, {
    bed: prop.bed.g1b!,
    resident: r.bala,
    start: '2026-01-01',
    end: '2026-11-13',
    admissionDate: '2026-10-31T00:00:00Z',
  });
  ids.s3 = await seedStay(org, {
    bed: prop.bed.f1a!,
    resident: r.chitra,
    start: '2026-11-12',
    end: '2026-11-20',
    checkInAt: '2026-11-12T04:00:00Z',
    admissionDate: '2026-11-14T00:00:00Z',
    bookingCreatedAt: '2026-11-11T05:00:00Z',
    admissionCreatedAt: '2026-11-12T03:00:00Z',
  });
  ids.s4 = await seedStay(org, {
    bed: prop.bed.f1b!,
    resident: r.dev,
    start: '2026-06-01',
    end: '2027-03-01',
    checkInAt: '2026-06-01T04:00:00Z',
    admissionDate: '2026-06-01T00:00:00Z',
  });
  // Departures (check-out instants around the recent-window edge: IST 2026-11-01 starts at 2026-10-31T18:30:00Z).
  ids.d1 = await seedStay(org, {
    bed: prop.bed.g1c!,
    resident: r.esha,
    start: '2026-01-01',
    end: '2026-11-02',
    checkedOutAt: '2026-11-13T05:00:00Z',
  });
  ids.d2 = await seedStay(org, {
    bed: prop.bed.g1c!,
    resident: r.gita,
    start: '2026-01-01',
    end: '2026-11-02',
    checkedOutAt: '2026-10-31T18:30:00Z',
  });
  ids.d3 = await seedStay(org, {
    bed: prop.bed.g1c!,
    resident: r.farid,
    start: '2026-01-01',
    end: '2026-11-02',
    checkedOutAt: '2026-10-31T18:29:59Z',
  });
  // Bookings without a check-in.
  ids.bk1 = await seedBooking(org, {
    resident: r.elan,
    bedId: prop.bed.g1c!,
    start: '2026-11-14',
    end: '2026-11-18',
    createdAt: '2026-11-10T05:00:00Z',
  });
  ids.bk1Adm = await seedAdmission(org, {
    bookingId: ids.bk1,
    resident: r.elan,
    bedId: prop.bed.g1c!,
    admissionDate: '2026-11-14T00:00:00Z',
    status: 'PENDING',
    createdAt: '2026-11-10T06:00:00Z',
  });
  ids.bk2 = await seedBooking(org, {
    resident: r.farah,
    bedId: prop.bed.g1c!,
    start: '2026-11-20',
    end: '2026-12-01',
    createdAt: '2026-11-13T05:00:00Z',
  });
  ids.bk3 = await seedBooking(org, {
    resident: r.gopal,
    bedId: prop.bed.f1a!,
    start: '2026-11-20',
    end: '2026-12-31',
    createdAt: '2026-10-20T05:00:00Z',
  });
  ids.bk3Adm = await seedAdmission(org, {
    bookingId: ids.bk3,
    resident: r.gopal,
    bedId: prop.bed.f1a!,
    admissionDate: '2026-10-25T00:00:00Z',
    status: 'ADMITTED',
  });
  ids.bk4 = await seedBooking(org, {
    resident: r.hari,
    bedId: prop.bed.g1b!,
    start: '2026-11-28',
    end: '2027-01-01',
  }); // today + 14: excluded
  ids.bk5 = await seedBooking(org, {
    resident: r.indu,
    bedId: prop.bed.g1c!,
    start: '2026-11-10',
    end: '2026-11-13',
  }); // late arrival
  ids.bk6 = await seedBooking(org, {
    resident: r.jay,
    bedId: prop.bed.g1c!,
    start: '2026-11-16',
    end: '2026-11-19',
    status: 'CANCELLED',
    createdAt: '2026-11-12T05:00:00Z',
  });
  // Noise in the other property and an unrelated stay there.
  ids.other = await seedStay(org, {
    bed: other.bed.F0R0B0!,
    resident: r.outsider,
    start: '2026-01-01',
    end: '2027-01-01',
  });
  return { org, prop, other, ids };
}

// ------------------------------------------------------------------------------------------------ inventory

test('inventory: totals count only live rooms and beds; archived rooms, floors and beds and other properties are excluded', async () => {
  const { org, prop } = await worldA();
  const d = await dash(org, prop.id);
  assert.equal(
    d.inventory.rooms,
    4,
    'G1, G2, F1R1 and the empty room; not the archived room or the archived floor',
  );
  assert.equal(d.inventory.beds, 6);
  assert.deepEqual(
    d.inventory.byFloor.map((f) => [f.label, f.beds]),
    [
      ['Ground', 4],
      ['First', 2],
      ['Roof', 0],
    ],
    'live floors by ordinal, including a floor with no beds; the archived floor is excluded',
  );
});

test('inventory: occupied comes from active stays, never from bookings or IN_SERVICE; out of service is excluded from available', async () => {
  const { org, prop } = await worldA();
  const i = (await dash(org, prop.id)).inventory;
  assert.equal(i.occupiedBeds, 4, 'g1a g1b f1a f1b hold active stays');
  assert.equal(i.outOfServiceBeds, 1, 'g2a');
  assert.equal(i.availableBeds, 1, 'g1c has bookings but no active stay, so it is available');
  assert.equal(i.occupiedBeds + i.availableBeds + i.outOfServiceBeds, i.beds);
  assert.equal(i.occupancyPercent, 66.7);
  assert.deepEqual(i.anomalies, { occupiedOutOfService: 0, stayNeedsReview: 0 });
  const ground = i.byFloor.find((f) => f.label === 'Ground')!;
  assert.deepEqual(
    [ground.beds, ground.occupiedBeds, ground.availableBeds, ground.outOfServiceBeds],
    [4, 2, 1, 1],
  );
});

test('inventory: future, cancelled and late bookings never change occupancy', async () => {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Plain', gridSpec(1, 1, 3));
  const bed = prop.bed.F0R0B0!;
  const before = (await dash(org, prop.id)).inventory;
  assert.equal(before.occupiedBeds, 0);
  const guest = await seedResident(org, 'Future');
  await seedBooking(org, { resident: guest, bedId: bed, start: '2026-11-15', end: '2026-12-15' });
  await seedBooking(org, {
    resident: guest,
    bedId: bed,
    start: '2026-11-14',
    end: '2026-11-20',
    status: 'CANCELLED',
  });
  const after = (await dash(org, prop.id)).inventory;
  assert.deepEqual(
    [after.occupiedBeds, after.availableBeds, after.outOfServiceBeds],
    [before.occupiedBeds, before.availableBeds, before.outOfServiceBeds],
  );
});

test('inventory: an empty property reports zeros, no division error, empty lists', async () => {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Empty', []);
  const d = await dash(org, prop.id);
  assert.deepEqual(
    [
      d.inventory.rooms,
      d.inventory.beds,
      d.inventory.occupiedBeds,
      d.inventory.availableBeds,
      d.inventory.outOfServiceBeds,
      d.inventory.occupancyPercent,
    ],
    [0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(d.inventory.byFloor, []);
  assert.equal(d.tenants!.activeTenants, 0);
  assert.deepEqual(d.tenants!.upcomingCheckIns, { count: 0, items: [] });
  assert.deepEqual(d.tenants!.pastEndDate, { count: 0, items: [] });
  assert.deepEqual(d.bookings!.recent, []);
  assert.equal(d.finance!.invoiced, '0.00');
  assert.equal(d.finance!.outstanding, '0.00');
  assert.equal(d.finance!.unattributed, null);
  assert.deepEqual(d.activity, []);
});

test('transfers: the PHYSICAL bed of a transferred stay is occupied, the source bed is free, and nothing is counted twice', async () => {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Transfers', gridSpec(1, 2, 2));
  const guest = await seedResident(org, 'Moved');
  await seedStay(org, {
    bed: prop.bed.F0R0B0!,
    resident: guest,
    start: '2026-01-01',
    end: '2026-11-20',
    segments: 'transferred',
    transfer: {
      destBedId: prop.bed.F0R1B0!,
      sourceRoomId: prop.room.F0R0!,
      destRoomId: prop.room.F0R1!,
      sourcePropertyId: prop.id,
      destPropertyId: prop.id,
    },
  });
  const d = await dash(org, prop.id);
  assert.equal(d.inventory.occupiedBeds, 1);
  assert.equal(d.inventory.availableBeds, 3);
  assert.equal(d.tenants!.activeTenants, 1);
  assert.equal(d.inventory.byFloor[0]!.occupiedBeds, 1);
  // The stay is shown on the bed it is physically in, not the bed it was checked in to.
  assert.deepEqual(
    d.tenants!.upcomingCheckOuts.items.map((s) => s.bedLabel),
    ['F0R1B0'],
  );
});

test('transfers: a stay moved to another property counts in the destination property only', async () => {
  const org = await seedOrg();
  const home = await seedProperty(org, 'Home', gridSpec(1, 1, 2));
  const away = await seedProperty(org, 'Away', gridSpec(1, 1, 2));
  const guest = await seedResident(org, 'Relocated');
  await seedStay(org, {
    bed: home.bed.F0R0B0!,
    resident: guest,
    start: '2026-01-01',
    end: '2027-01-01',
    segments: 'transferred',
    transfer: {
      destBedId: away.bed.F0R0B1!,
      sourceRoomId: home.room.F0R0!,
      destRoomId: away.room.F0R0!,
      sourcePropertyId: home.id,
      destPropertyId: away.id,
    },
  });
  const h = await dash(org, home.id);
  const a = await dash(org, away.id);
  assert.equal(h.inventory.occupiedBeds, 0);
  assert.equal(h.tenants!.activeTenants, 0);
  assert.equal(a.inventory.occupiedBeds, 1);
  assert.equal(a.tenants!.activeTenants, 1);
  assert.deepEqual(h.inventory.anomalies, { occupiedOutOfService: 0, stayNeedsReview: 0 });
});

test('anomalies: an occupied out-of-service bed and an inconsistent stay are reported and never fail the request', async () => {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Anomalies', [
    {
      label: 'F',
      ordinal: 0,
      rooms: [
        {
          label: 'R',
          beds: [{ label: 'a', oos: true }, { label: 'b' }, { label: 'c' }, { label: 'd' }],
        },
      ],
    },
  ]);
  const people = [
    await seedResident(org, 'One'),
    await seedResident(org, 'Two'),
    await seedResident(org, 'Three'),
  ];
  await seedStay(org, {
    bed: prop.bed.a!,
    resident: people[0]!,
    start: '2026-01-01',
    end: '2027-01-01',
  }); // occupied AND out of service
  await seedStay(org, {
    bed: prop.bed.b!,
    resident: people[1]!,
    start: '2026-01-01',
    end: '2027-01-01',
    segments: 'zero-open',
  });
  await seedStay(org, {
    bed: prop.bed.c!,
    resident: people[2]!,
    start: '2026-01-01',
    end: '2027-01-01',
    segments: 'two-open',
    transfer: {
      destBedId: prop.bed.d!,
      sourceRoomId: prop.room.R!,
      destRoomId: prop.room.R!,
      sourcePropertyId: prop.id,
      destPropertyId: prop.id,
    },
  });
  const i = (await dash(org, prop.id)).inventory;
  assert.deepEqual(i.anomalies, { occupiedOutOfService: 1, stayNeedsReview: 2 });
  assert.equal(i.occupiedBeds, 1, 'only the consistent stay is occupied');
  assert.equal(i.occupiedBeds + i.availableBeds + i.outOfServiceBeds, i.beds);
  assert.equal(
    i.outOfServiceBeds,
    0,
    'the out-of-service bed is occupied, so it is counted once, as occupied',
  );
});

// ------------------------------------------------------------------------------------------------ tenants

test('tenants: active tenants are distinct residents with an active stay on a live bed', async () => {
  const { org, prop } = await worldA();
  assert.equal((await dash(org, prop.id)).tenants!.activeTenants, 4);
  // One resident with two active check-ins is one tenant (the database does not forbid it; the dashboard must not double count).
  const dup = await seedOrg();
  const p = await seedProperty(dup, 'Dup', gridSpec(1, 1, 2));
  const guest = await seedResident(dup, 'Twice');
  await seedStay(dup, {
    bed: p.bed.F0R0B0!,
    resident: guest,
    start: '2026-01-01',
    end: '2027-01-01',
  });
  await seedStay(dup, {
    bed: p.bed.F0R0B1!,
    resident: guest,
    start: '2026-02-01',
    end: '2027-01-01',
  });
  const d = await dash(dup, p.id);
  assert.equal(d.inventory.occupiedBeds, 2);
  assert.equal(d.tenants!.activeTenants, 1);
});

test('D7: a booking ending today is an upcoming check-out and NOT past end date; yesterday is past end date with daysPast 1', async () => {
  const { org, prop, ids } = await worldA();
  const t = (await dash(org, prop.id)).tenants!;
  assert.deepEqual(
    t.upcomingCheckOuts.items.map((s) => [s.residentName, s.endDate, s.bedLabel]),
    [
      ['Asha Rao', '2026-11-14', 'g1a'],
      ['Chitra Nair', '2026-11-20', 'f1a'],
    ],
  );
  assert.equal(t.upcomingCheckOuts.count, 2);
  assert.equal(t.pastEndDate.count, 1);
  assert.equal(t.pastEndDate.items[0]!.residentName, 'Bala Iyer');
  assert.equal(t.pastEndDate.items[0]!.daysPast, 1);
  assert.equal(t.pastEndDate.items[0]!.checkInId, ids.s2.checkIn);
  // Dev ends in 2027: in neither list. Total: 2 + 1 + 1 later = 4 active stays.
  assert.equal(t.activeTenants, 4);
});

test('upcoming check-ins: confirmed bookings with no check-in in [today, today + days); late arrivals and cancelled ones appear nowhere', async () => {
  const { org, prop, ids } = await worldA();
  const d = await dash(org, prop.id);
  const t = d.tenants!;
  // BK1 starts 11-14, BK2 and BK3 11-20 (tie broken by id).
  const startOf: Record<string, string> = {
    [ids.bk1]: '2026-11-14',
    [ids.bk2]: '2026-11-20',
    [ids.bk3]: '2026-11-20',
  };
  const expected = [ids.bk1, ids.bk2, ids.bk3].sort(
    (a, b) => startOf[a]!.localeCompare(startOf[b]!) || a.localeCompare(b),
  );
  assert.equal(t.upcomingCheckIns!.count, 3);
  assert.deepEqual(
    t.upcomingCheckIns!.items.map((b) => b.bookingId),
    expected,
  );
  for (const excluded of [ids.bk4, ids.bk5]) {
    assert.equal(
      [...t.upcomingCheckIns!.items, ...d.bookings!.confirmedUpcoming.items].some(
        (b) => b.bookingId === excluded,
      ),
      false,
      'today + days and a passed start date are outside the window',
    );
  }
  assert.ok(!t.upcomingCheckIns!.items.some((b) => b.bookingId === ids.bk6), 'cancelled');
  const byId = Object.fromEntries(
    t.upcomingCheckIns!.items.map((b) => [b.bookingId, b.admissionStatus]),
  );
  assert.equal(byId[ids.bk1], 'PENDING');
  assert.equal(byId[ids.bk2], 'NONE');
  assert.equal(byId[ids.bk3], 'ADMITTED');
});

test('bookings: confirmedUpcoming is the same set as upcomingCheckIns; committed beds are distinct beds', async () => {
  const { org, prop } = await worldA();
  const d = await dash(org, prop.id);
  assert.deepEqual(d.bookings!.confirmedUpcoming, d.tenants!.upcomingCheckIns);
  assert.equal(d.bookings!.committedBeds, 2, 'g1c (two bookings) and f1a');
});

test('recent bookings: created in (today - days, today], any status, newest first', async () => {
  const { org, prop, ids } = await worldA();
  const recent = (await dash(org, prop.id)).bookings!.recent;
  assert.deepEqual(
    recent.map((b) => b.bookingId),
    [ids.bk2, ids.bk6, ids.s3.booking, ids.bk1],
    'BK2 11-13, BK6 11-12 (cancelled), Chitra 11-11, BK1 11-10; BK3 (October) and every older booking are outside',
  );
  assert.equal(recent.find((b) => b.bookingId === ids.bk6)!.status, 'CANCELLED');
});

test('recent admissions: ADMITTED only, by admissionDate inside the window; a pending admission and an old one are excluded', async () => {
  const { org, prop } = await worldA();
  const t = (await dash(org, prop.id)).tenants!;
  assert.deepEqual(
    t.recentAdmissions!.map((a) => [a.residentName, a.admissionDate]),
    [
      ['Chitra Nair', '2026-11-14'],
      ['Asha Rao', '2026-11-01'],
    ],
    'Bala 10-31 is one day before the window; Elan is PENDING; Gopal and Dev are older',
  );
});

test('recent departures: check-outs inside the window by IST day, with the exact 18:30Z edge', async () => {
  const { org, prop } = await worldA();
  const t = (await dash(org, prop.id)).tenants!;
  assert.deepEqual(
    t.recentDepartures.map((x) => [x.residentName, x.checkOutAt]),
    [
      ['Esha Tester', '2026-11-13T05:00:00.000Z'],
      ['Gita Tester', '2026-10-31T18:30:00.000Z'],
    ],
    'Farid left at 2026-10-31T18:29:59Z = IST 10-31, outside; Gita at 18:30:00Z = IST 11-01, inside',
  );
  assert.equal(t.recentDepartures[0]!.reason, 'fixture departure');
});

test('windows are reported and move with `days`', async () => {
  const { org, prop } = await worldA();
  const d = await dash(org, prop.id, { days: 3 });
  assert.deepEqual(d.windows, {
    upcoming: { from: '2026-11-14', toExclusive: '2026-11-17' },
    recent: { from: '2026-11-12', to: '2026-11-14' },
  });
  assert.equal(d.today, '2026-11-14');
  assert.equal(d.tenants!.upcomingCheckIns!.count, 1, 'only BK1 starts before 11-17');
  assert.equal(d.tenants!.upcomingCheckOuts.count, 1, 'Asha ends today; Chitra ends 11-20');
});

test('IST day edge: the dashboard day changes at 18:30Z, which moves a stay from upcoming to past end date', async () => {
  const { org, prop } = await worldA();
  const before = await dash(org, prop.id, { now: new Date('2026-11-14T18:29:59Z') });
  const after = await dash(org, prop.id, { now: new Date('2026-11-14T18:30:00Z') });
  assert.equal(before.today, '2026-11-14');
  assert.equal(after.today, '2026-11-15');
  assert.equal(before.tenants!.pastEndDate.count, 1);
  assert.equal(after.tenants!.pastEndDate.count, 2, 'Asha (ends 11-14) is now past end date');
  assert.equal(
    after.tenants!.upcomingCheckOuts.items.some((s) => s.residentName === 'Asha Rao'),
    false,
  );
});

test('lists are capped at 10 while every count stays exact', async () => {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Busy', gridSpec(1, 1, 14));
  for (let i = 0; i < 14; i++) {
    const guest = await seedResident(org, `Guest${String(i).padStart(2, '0')}`);
    await seedBooking(org, {
      resident: guest,
      bedId: prop.bed[`F0R0B${i}`]!,
      start: `2026-11-${String(15 + (i % 10)).padStart(2, '0')}`,
      end: '2027-01-01',
      createdAt: '2026-11-13T05:00:00Z',
    });
  }
  const d = await dash(org, prop.id);
  assert.equal(d.bookings!.confirmedUpcoming.count, 14);
  assert.equal(d.bookings!.confirmedUpcoming.items.length, 10);
  assert.equal(d.bookings!.committedBeds, 14);
  assert.equal(d.bookings!.recent.length, 10);
  assert.equal(d.activity!.length, 10);
  const starts = d.bookings!.confirmedUpcoming.items.map((b) => b.startDate);
  assert.deepEqual(starts, [...starts].sort(), 'earliest starts first');
});

// ------------------------------------------------------------------------------------------------ activity

test('activity: recorded events only, with the right time basis; an admission record is not an admission date', async () => {
  const { org, prop, ids } = await worldA();
  const d = await dash(org, prop.id);
  const a = d.activity!;
  assert.ok(a.length <= 10);
  const kinds = (k: string) => a.filter((e) => e.kind === k);
  assert.equal(kinds('booking_created').length, 4);
  assert.equal(kinds('admission_recorded').length, 2);
  assert.equal(kinds('check_in').length, 1);
  assert.equal(kinds('check_out').length, 2);
  assert.equal(kinds('payment_received').length, 0);
  for (const e of a) {
    assert.equal(
      e.timeBasis,
      e.kind === 'booking_created' || e.kind === 'admission_recorded' ? 'RECORD_CREATED' : 'EVENT',
      e.kind,
    );
  }
  // Chitra's admission has admissionDate 2026-11-14 but was CREATED on 11-12: the activity carries the creation time.
  const chitraAdmission = kinds('admission_recorded').find((e) => e.refId === ids.s3.admission)!;
  assert.equal(chitraAdmission.occurredAt, '2026-11-12T03:00:00.000Z');
  const sorted = [...a].sort((x, y) => y.occurredAt.localeCompare(x.occurredAt));
  assert.deepEqual(
    a.map((e) => e.occurredAt),
    sorted.map((e) => e.occurredAt),
    'newest first',
  );
  // An admission created long ago but with a recent admissionDate is NOT activity (it is in Recent admissions only).
  assert.equal(
    a.some((e) => e.kind === 'admission_recorded' && e.refId === ids.s1.admission),
    false,
  );
  assert.equal(
    d.tenants!.recentAdmissions!.some((x) => x.admissionId === ids.s1.admission),
    true,
  );
});

// ------------------------------------------------------------------------------------------------ gating

test('gating: a role without a permission gets null for exactly that section and no data from it', async () => {
  const { org, prop } = await worldA();
  const only = (...granted: string[]) => computeGates((p) => granted.includes(p));

  const none = await dash(org, prop.id, { gates: only('inventory.read') });
  assert.equal(none.tenants, null);
  assert.equal(none.bookings, null);
  assert.equal(none.finance, null);
  assert.equal(none.activity, null);
  assert.deepEqual(none.access, {
    tenants: false,
    upcomingCheckIns: false,
    recentAdmissions: false,
    bookings: false,
    finance: false,
    activity: false,
  });
  assert.equal(none.inventory.beds, 6, 'inventory is always present');
  const text = JSON.stringify(none);
  for (const name of ['Asha', 'Bala', 'Chitra', 'Elan'])
    assert.ok(!text.includes(name), `${name} must not leak into a gated response`);

  const tenantsOnly = await dash(org, prop.id, { gates: only('checkin.read', 'resident.read') });
  assert.ok(tenantsOnly.tenants);
  assert.equal(tenantsOnly.tenants!.upcomingCheckIns, null, 'needs booking.read');
  assert.equal(tenantsOnly.tenants!.recentAdmissions, null, 'needs admission.read');
  assert.equal(tenantsOnly.bookings, null);
  assert.equal(tenantsOnly.finance, null);
  assert.ok(
    tenantsOnly.activity!.every((e) => e.kind === 'check_in' || e.kind === 'check_out'),
    'only check-in events',
  );

  const bookingsOnly = await dash(org, prop.id, { gates: only('booking.read') });
  assert.equal(bookingsOnly.tenants, null);
  assert.ok(bookingsOnly.bookings);
  assert.equal(
    bookingsOnly.bookings!.confirmedUpcoming.items[0]!.admissionStatus,
    null,
    'admission state needs admission.read',
  );
  assert.ok(bookingsOnly.activity!.every((e) => e.kind === 'booking_created'));

  const financeOnly = await dash(org, prop.id, { gates: only('finance.read') });
  assert.equal(financeOnly.tenants, null);
  assert.equal(financeOnly.bookings, null);
  assert.ok(financeOnly.finance);
});

test('gating: an activity entry needs its source permission to appear and resident.read to name the resident', async () => {
  const { org, prop } = await worldA();
  const only = (...granted: string[]) => computeGates((p) => granted.includes(p));
  const sources: Array<[string, string[]]> = [
    ['checkin.read', ['check_in', 'check_out']],
    ['booking.read', ['booking_created']],
    ['admission.read', ['admission_recorded']],
  ];
  for (const [permission, kinds] of sources) {
    // Source permission only: the events are there, with their time and place, but nobody is identified.
    const anonymous = await dash(org, prop.id, { gates: only(permission) });
    const entries = anonymous.activity!;
    assert.ok(entries.length > 0, `${permission} still shows its events`);
    for (const entry of entries) {
      assert.ok(
        kinds.includes(entry.kind),
        `${permission} shows only ${kinds.join('/')}, not ${entry.kind}`,
      );
      assert.equal(
        entry.residentName,
        null,
        `${entry.kind} must not name a resident without resident.read`,
      );
      assert.equal(
        entry.residentId,
        null,
        `${entry.kind} must not identify a resident without resident.read`,
      );
      assert.ok(
        entry.occurredAt && entry.refId && entry.timeBasis,
        'the permitted event information is kept',
      );
      assert.ok(entry.bedLabel && entry.roomLabel, 'the bed and room are kept');
    }
    const feed = JSON.stringify(anonymous.activity);
    for (const first of ['Asha', 'Bala', 'Chitra', 'Elan', 'Esha', 'Faye', 'Gita', 'Farah'])
      assert.ok(!feed.includes(first), `${first} leaked into the unnamed feed for ${permission}`);

    // Source permission plus resident.read: the same events, now named.
    const named = await dash(org, prop.id, { gates: only(permission, 'resident.read') });
    assert.equal(named.activity!.length, entries.length, 'the same events');
    assert.ok(
      named.activity!.every(
        (e) =>
          typeof e.residentName === 'string' && e.residentName.length > 0 && e.residentId !== null,
      ),
    );
  }
  // resident.read alone opens no activity at all: the event permission is still required.
  assert.equal((await dash(org, prop.id, { gates: only('resident.read') })).activity, null);
});

test('gating: payment activity is unnamed without resident.read and named with it', async () => {
  const { org, prop } = await worldB();
  const only = (...granted: string[]) => computeGates((p) => granted.includes(p));
  const anonymous = await dash(org, prop.id, { gates: only('finance.read') });
  const payments = anonymous.activity!.filter((e) => e.kind === 'payment_received');
  assert.equal(payments.length, 4, 'the four attributed payments received in the window');
  for (const entry of payments) {
    assert.equal(entry.residentName, null);
    assert.equal(entry.residentId, null);
    assert.match(entry.amount!, /^\d+\.\d{2}$/, 'the amount is kept');
    assert.equal(typeof entry.reversed, 'boolean');
  }
  assert.ok(
    !JSON.stringify(anonymous.activity).includes('Fin'),
    'no resident name in the activity feed',
  );
  const named = await dash(org, prop.id, { gates: only('finance.read', 'resident.read') });
  assert.ok(
    named
      .activity!.filter((e) => e.kind === 'payment_received')
      .every((e) => /^Fin\d Tester$/.test(e.residentName!)),
  );
});

// ------------------------------------------------------------------------------------------------ finance (fixed now)

interface WorldB {
  org: Org;
  prop: Prop;
  ids: Record<string, string>;
}
let worldBPromise: Promise<WorldB> | undefined;
const worldB = () => (worldBPromise ??= buildWorldB());

/** Hand-computed finance at the fixed NOW (today 2026-11-14, month 2026-11). See the arithmetic in the tests. */
async function buildWorldB(): Promise<WorldB> {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Finance', gridSpec(1, 1, 4));
  const r = [
    await seedResident(org, 'Fin1'),
    await seedResident(org, 'Fin2'),
    await seedResident(org, 'Fin3'),
    await seedResident(org, 'Fin4'),
  ];
  const stay = (i: number) =>
    seedStay(org, {
      bed: prop.bed[`F0R0B${i}`]!,
      resident: r[i]!,
      start: '2026-09-01',
      end: '2027-09-01',
    });
  const bk = [
    (await stay(0)).booking,
    (await stay(1)).booking,
    (await stay(2)).booking,
    (await stay(3)).booking,
  ];
  const ids: Record<string, string> = {};
  ids.i1 = await seedInvoice(org, {
    resident: r[0]!,
    bookingId: bk[0]!,
    period: '2026-11-01',
    amount: '10000.00',
    due: '2026-11-05',
  }); // overdue 10000
  ids.i2 = await seedInvoice(org, {
    resident: r[1]!,
    bookingId: bk[1]!,
    period: '2026-11-01',
    amount: '8000.00',
    paid: '3000.00',
    status: 'PARTIALLY_PAID',
    due: '2026-11-20',
  }); // pending 5000
  ids.i3 = await seedInvoice(org, {
    resident: r[2]!,
    bookingId: bk[2]!,
    period: '2026-11-01',
    amount: '6000.00',
    paid: '6000.00',
    status: 'PAID',
    due: '2026-11-05',
  });
  ids.i4 = await seedInvoice(org, {
    resident: r[3]!,
    bookingId: bk[3]!,
    period: '2026-11-01',
    amount: '7000.00',
    status: 'DRAFT',
    due: '2026-11-30',
  }); // excluded
  const r5 = await seedResident(org, 'Fin5');
  const bk5 = (
    await seedStay(org, {
      bed: prop.bed.F0R0B0!,
      resident: r5,
      start: '2026-09-01',
      end: '2027-09-01',
      segments: 'none',
      checkedOutAt: '2026-10-01T00:00:00Z',
    })
  ).booking;
  ids.i5 = await seedInvoice(org, {
    resident: r5,
    bookingId: bk5,
    period: '2026-11-01',
    amount: '9000.00',
    status: 'CANCELLED',
    due: '2026-11-05',
  }); // excluded
  ids.i6 = await seedInvoice(org, {
    resident: r[0]!,
    bookingId: bk[0]!,
    period: '2026-10-01',
    amount: '12000.00',
    paid: '2000.00',
    status: 'PARTIALLY_PAID',
    due: '2026-10-05',
  }); // overdue 10000, October
  ids.i7 = await seedInvoice(org, {
    resident: r[1]!,
    bookingId: bk[1]!,
    period: '2026-10-01',
    amount: '4000.00',
    due: '2026-11-14',
  }); // due today: pending 4000
  ids.i8 = await seedInvoice(org, {
    resident: r[2]!,
    bookingId: bk[2]!,
    period: '2026-10-01',
    amount: '3000.00',
    paid: '1000.00',
    status: 'PARTIALLY_PAID',
    due: '2026-11-13',
  }); // due yesterday: overdue 2000
  ids.i9 = await seedInvoice(org, {
    resident: r[3]!,
    bookingId: bk[3]!,
    period: '2026-10-01',
    amount: '5000.00',
    paid: '1000.00',
    adjustment: '-1000.00',
    status: 'ISSUED',
    due: '2026-11-30',
  }); // credit, pending 4000
  await seedPayment(org, {
    invoiceId: ids.i2!,
    resident: r[1]!,
    amount: '3000.00',
    receivedAt: '2026-11-05T06:00:00Z',
  });
  await seedPayment(org, {
    invoiceId: ids.i3!,
    resident: r[2]!,
    amount: '6000.00',
    receivedAt: '2026-11-03T06:00:00Z',
  });
  await seedPayment(org, {
    invoiceId: ids.i6!,
    resident: r[0]!,
    amount: '2000.00',
    receivedAt: '2026-10-31T18:30:00Z',
  }); // IST 11-01: November
  await seedPayment(org, {
    invoiceId: ids.i1!,
    resident: r[0]!,
    amount: '2500.00',
    receivedAt: '2026-11-08T06:00:00Z',
    reversed: true,
  });
  await seedPayment(org, {
    invoiceId: ids.i8!,
    resident: r[2]!,
    amount: '1000.00',
    receivedAt: '2026-10-31T18:29:59Z',
  }); // IST 10-31: October
  // Invoices with no booking cannot be attributed to a property.
  ids.u1 = await seedInvoice(org, {
    resident: r[0]!,
    bookingId: null,
    period: '2026-11-01',
    amount: '3000.00',
    paid: '500.00',
    status: 'PARTIALLY_PAID',
    due: '2026-11-02',
  });
  ids.u2 = await seedInvoice(org, {
    resident: r[1]!,
    bookingId: null,
    period: '2026-10-01',
    amount: '1000.00',
    due: '2026-11-30',
  });
  await seedPayment(org, {
    invoiceId: ids.u1!,
    resident: r[0]!,
    amount: '500.00',
    receivedAt: '2026-11-09T06:00:00Z',
  });
  return { org, prop, ids };
}

test('finance: invoiced, collected, month unpaid, outstanding, overdue and pending equal the hand-computed values', async () => {
  const { org, prop } = await worldB();
  const f = (await dash(org, prop.id)).finance!;
  assert.equal(
    f.invoiced,
    '24000.00',
    'Nov billable: 10000 + 8000 + 6000; the draft and the cancelled invoice are excluded',
  );
  assert.equal(f.monthUnpaid, '15000.00', '10000 + (8000 - 3000) + 0');
  assert.equal(
    f.collected,
    '11000.00',
    '3000 + 6000 + 2000 (IST 11-01); the reversed 2500 and the IST 10-31 1000 are not November cash',
  );
  assert.equal(
    f.outstanding,
    '35000.00',
    'open balances over all months: 10000 + 5000 + 10000 + 4000 + 2000 + 4000',
  );
  assert.deepEqual(
    f.overdue,
    { count: 3, amount: '22000.00' },
    'due before today: 10000 + 10000 + 2000',
  );
  assert.deepEqual(
    f.pendingPayments,
    { count: 3, amount: '13000.00' },
    'due today or later: 5000 + 4000 + 4000',
  );
});

test('finance: outstanding is exactly overdue plus pending; a payment is not an invoice; a credit is not collected', async () => {
  const { org, prop } = await worldB();
  const f = (await dash(org, prop.id)).finance!;
  const cents = (v: string) => Math.round(Number(v) * 100);
  assert.equal(cents(f.outstanding), cents(f.overdue.amount) + cents(f.pendingPayments.amount));
  // The 1000.00 credit on the October invoice lowers its balance (5000 - 1000) but no cash was received for it.
  assert.equal(f.collected, '11000.00');
  // Due today is pending, due yesterday is overdue (boundary).
  const shifted = await dash(org, prop.id, { now: new Date('2026-11-14T18:30:00Z') }); // today = 11-15
  assert.deepEqual(
    shifted.finance!.overdue,
    { count: 4, amount: '26000.00' },
    'the invoice due 11-14 is now overdue (+4000)',
  );
  assert.deepEqual(shifted.finance!.pendingPayments, { count: 2, amount: '9000.00' });
});

test('finance: recent payments are windowed, newest first, and a reversed payment is marked but not collected', async () => {
  const { org, prop } = await worldB();
  const f = (await dash(org, prop.id)).finance!;
  assert.deepEqual(
    f.recentPayments.map((p) => [p.amount, p.reversed]),
    [
      ['2500.00', true],
      ['3000.00', false],
      ['6000.00', false],
      ['2000.00', false],
    ],
    'the IST 10-31 payment is outside the window; the unattributed payment is not a property payment',
  );
  assert.ok(
    f.recentPayments.every((p) => /^INV-2026-\d{6}$/.test(p.invoiceNumber) && p.method === 'UPI'),
  );
});

test('finance: the organization-level unattributed figures are separate and never inside the property totals', async () => {
  const { org, prop } = await worldB();
  const f = (await dash(org, prop.id)).finance!;
  assert.deepEqual(f.unattributed, {
    count: 2,
    invoiced: '3000.00',
    collected: '500.00',
    outstanding: '3500.00',
    overdue: '2500.00',
  });
  // The property figures above exclude the 3000 / 500 / 3500 / 2500 of the no-booking invoices.
  assert.equal(f.invoiced, '24000.00');
});

test('finance: month selection changes only the month figures, not the all-months figures', async () => {
  const { org, prop } = await worldB();
  const oct = (await dash(org, prop.id, { month: '2026-10' })).finance!;
  assert.equal(oct.invoiced, '24000.00', 'October billable: 12000 + 4000 + 3000 + 5000');
  assert.equal(oct.collected, '1000.00', 'only the IST 10-31 payment');
  assert.equal(oct.outstanding, '35000.00');
  assert.deepEqual(oct.overdue, { count: 3, amount: '22000.00' });
});

test('finance: an organization with no invoices has zero figures and no unattributed block', async () => {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'NoMoney', gridSpec(1, 1, 1));
  const f = (await dash(org, prop.id)).finance!;
  assert.deepEqual(
    [
      f.invoiced,
      f.collected,
      f.monthUnpaid,
      f.outstanding,
      f.overdue.amount,
      f.pendingPayments.amount,
    ],
    ['0.00', '0.00', '0.00', '0.00', '0.00', '0.00'],
  );
  assert.equal(f.unattributed, null);
  assert.deepEqual(f.recentPayments, []);
});

// ------------------------------------------------------------------------------------------------ reconciliation (real clock)

const realToday = () => todayIst();
const rel = (days: number) => dateKey(addDays(realToday(), days));
const thisMonth = () => `${dateKey(realToday()).slice(0, 7)}`;
const monthStart = () => `${thisMonth()}-01`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function seedBilledStay(org: Org, prop: Prop, bedLabel: string, first: string) {
  const resident = await seedResident(org, first);
  const stay = await seedStay(org, {
    bed: prop.bed[bedLabel]!,
    resident,
    start: '2025-01-01',
    end: '2099-01-01',
  });
  return { resident, booking: stay.booking };
}

test('reconciliation: a one-property organization equals the existing monthly report and outstanding endpoint', async () => {
  const org = await seedOrg();
  const headers = await login(org);
  const prop = await seedProperty(org, 'One', gridSpec(1, 1, 4));
  const a = await seedBilledStay(org, prop, 'F0R0B0', 'ReconA');
  const b = await seedBilledStay(org, prop, 'F0R0B1', 'ReconB');
  const c = await seedBilledStay(org, prop, 'F0R0B2', 'ReconC');
  const i1 = await seedInvoice(org, {
    resident: a.resident,
    bookingId: a.booking,
    period: monthStart(),
    amount: '10000.00',
    due: rel(-3),
  });
  const i2 = await seedInvoice(org, {
    resident: b.resident,
    bookingId: b.booking,
    period: monthStart(),
    amount: '8000.00',
    paid: '3000.00',
    status: 'PARTIALLY_PAID',
    due: rel(+9),
  });
  await seedInvoice(org, {
    resident: c.resident,
    bookingId: c.booking,
    period: monthStart(),
    amount: '6000.00',
    paid: '6000.00',
    status: 'PAID',
    due: rel(-2),
  });
  await seedInvoice(org, {
    resident: c.resident,
    bookingId: c.booking,
    period: dateKey(addDays(new Date(`${monthStart()}T00:00:00Z`), -31)).slice(0, 7) + '-01',
    amount: '5000.00',
    paid: '1000.00',
    adjustment: '-1000.00',
    status: 'ISSUED',
    due: rel(+30),
  });
  await seedPayment(org, {
    invoiceId: i2,
    resident: b.resident,
    amount: '3000.00',
    receivedAt: minutesAgo(30),
  });
  await seedPayment(org, {
    invoiceId: i1,
    resident: a.resident,
    amount: '2500.00',
    receivedAt: minutesAgo(20),
    reversed: true,
  });

  const d = await dash(org, prop.id, { now: new Date(), month: thisMonth() });
  const monthly = (
    await server
      .get(`/api/v1/finance/reports/monthly?month=${thisMonth()}&months=1`)
      .set(headers)
      .expect(200)
  ).body.months[0];
  const outstanding = (await server.get('/api/v1/finance/outstanding').set(headers).expect(200))
    .body.totals;
  const f = d.finance!;
  assert.equal(f.invoiced, monthly.invoiced, 'invoiced');
  assert.equal(f.collected, monthly.collected, 'collected');
  assert.equal(
    f.monthUnpaid,
    monthly.outstanding,
    'the monthly report calls the month unpaid "outstanding"',
  );
  assert.equal(f.outstanding, outstanding.outstandingAmount, 'outstanding (all months)');
  assert.deepEqual(
    [f.overdue.amount, f.overdue.count],
    [outstanding.overdueAmount, outstanding.overdueCount],
    'overdue (all months)',
  );
  assert.equal(f.unattributed, null);
});

test('reconciliation: two properties, an archived one, and unattributed invoices add up to the organization totals', async () => {
  const org = await seedOrg();
  const headers = await login(org);
  const p = await seedProperty(org, 'Alpha', gridSpec(1, 1, 2));
  const q = await seedProperty(org, 'Beta', gridSpec(1, 1, 2));
  const z = await seedProperty(org, 'Zeta', gridSpec(1, 1, 2));
  const pa = await seedBilledStay(org, p, 'F0R0B0', 'AlphaRes');
  const qb = await seedBilledStay(org, q, 'F0R0B0', 'BetaRes');
  const zc = await seedBilledStay(org, z, 'F0R0B0', 'ZetaRes');
  const loose = await seedResident(org, 'Loose');
  await seedInvoice(org, {
    resident: pa.resident,
    bookingId: pa.booking,
    period: monthStart(),
    amount: '1000.00',
    due: rel(+20),
  });
  const qi = await seedInvoice(org, {
    resident: qb.resident,
    bookingId: qb.booking,
    period: monthStart(),
    amount: '2000.00',
    paid: '500.00',
    status: 'PARTIALLY_PAID',
    due: rel(-9),
  });
  await seedPayment(org, {
    invoiceId: qi,
    resident: qb.resident,
    amount: '500.00',
    receivedAt: minutesAgo(15),
  });
  const zi = await seedInvoice(org, {
    resident: zc.resident,
    bookingId: zc.booking,
    period: monthStart(),
    amount: '4000.00',
    paid: '1000.00',
    status: 'PARTIALLY_PAID',
    due: rel(-10),
  });
  await seedPayment(org, {
    invoiceId: zi,
    resident: zc.resident,
    amount: '1000.00',
    receivedAt: minutesAgo(10),
  });
  const ui = await seedInvoice(org, {
    resident: loose,
    bookingId: null,
    period: monthStart(),
    amount: '800.00',
    paid: '100.00',
    status: 'PARTIALLY_PAID',
    due: rel(-1),
  });
  await seedPayment(org, {
    invoiceId: ui,
    resident: loose,
    amount: '100.00',
    receivedAt: minutesAgo(5),
  });
  await withMigratorClient((c) =>
    c.query(`UPDATE properties SET archived_at = now() WHERE id = $1`, [z.id]),
  );

  const monthly = (
    await server
      .get(`/api/v1/finance/reports/monthly?month=${thisMonth()}&months=1`)
      .set(headers)
      .expect(200)
  ).body.months[0];
  const outstanding = (await server.get('/api/v1/finance/outstanding').set(headers).expect(200))
    .body.totals;
  const dp = (await dash(org, p.id, { now: new Date(), month: thisMonth() })).finance!;
  const dq = (await dash(org, q.id, { now: new Date(), month: thisMonth() })).finance!;
  await assert.rejects(
    dash(org, z.id, { now: new Date(), month: thisMonth() }),
    (e) => e instanceof NotFoundException,
    'an archived property has no dashboard',
  );
  const un = dp.unattributed!;
  assert.deepEqual(
    un,
    dq.unattributed,
    'the same organization-level block on every property of the organization',
  );
  assert.deepEqual(un, {
    count: 1,
    invoiced: '800.00',
    collected: '100.00',
    outstanding: '700.00',
    overdue: '700.00',
  });

  const cents = (v: string) => Math.round(Number(v) * 100);
  const zeta = { invoiced: 400000, collected: 100000, outstanding: 300000, overdue: 300000 }; // archived Zeta, from the fixture, in cents
  const sum = (key: 'invoiced' | 'collected' | 'outstanding') =>
    cents(dp[key]) + cents(dq[key]) + zeta[key] + cents(un[key]);
  assert.equal(
    sum('invoiced'),
    cents(monthly.invoiced),
    'invoiced: Alpha + Beta + archived Zeta + unattributed = organization',
  );
  assert.equal(sum('collected'), cents(monthly.collected));
  assert.equal(sum('outstanding'), cents(outstanding.outstandingAmount));
  assert.equal(
    cents(dp.overdue.amount) + cents(dq.overdue.amount) + zeta.overdue + cents(un.overdue),
    cents(outstanding.overdueAmount),
  );
  // The unattributed money is in none of the property figures.
  assert.equal(dp.invoiced, '1000.00');
  assert.equal(dq.invoiced, '2000.00');
});

// ------------------------------------------------------------------------------------------------ HTTP: contract, auth, isolation

test('HTTP: the response has the frozen shape, with real session authentication', async () => {
  const org = await seedOrg();
  const headers = await login(org);
  const prop = await seedProperty(org, 'Http', gridSpec(2, 2, 2));
  const res = await server.get(`/api/v1/properties/${prop.id}/dashboard`).set(headers).expect(200);
  const d = res.body.data as Dashboard;
  assert.deepEqual(Object.keys(d).sort(), [
    'access',
    'activity',
    'asOf',
    'bookings',
    'days',
    'finance',
    'inventory',
    'month',
    'property',
    'tenants',
    'today',
    'windows',
  ]);
  assert.deepEqual(d.property, { id: prop.id, code: `P-${prop.id.slice(0, 8)}`, name: 'Http' });
  assert.equal(d.days, 14);
  assert.equal(d.month, thisMonth());
  assert.equal(d.today, dateKey(realToday()));
  assert.deepEqual(d.access, {
    tenants: true,
    upcomingCheckIns: true,
    recentAdmissions: true,
    bookings: true,
    finance: true,
    activity: true,
  });
  assert.equal(d.inventory.beds, 8);
  assert.equal(d.inventory.rooms, 4);
  assert.deepEqual(Object.keys(d.inventory).sort(), [
    'anomalies',
    'availableBeds',
    'beds',
    'byFloor',
    'occupancyPercent',
    'occupiedBeds',
    'outOfServiceBeds',
    'rooms',
  ]);
  assert.deepEqual(Object.keys(d.tenants!).sort(), [
    'activeTenants',
    'pastEndDate',
    'recentAdmissions',
    'recentDepartures',
    'upcomingCheckIns',
    'upcomingCheckOuts',
  ]);
  assert.deepEqual(Object.keys(d.bookings!).sort(), [
    'committedBeds',
    'confirmedUpcoming',
    'recent',
  ]);
  assert.deepEqual(Object.keys(d.finance!).sort(), [
    'collected',
    'invoiced',
    'monthUnpaid',
    'outstanding',
    'overdue',
    'pendingPayments',
    'recentPayments',
    'unattributed',
  ]);
  assert.match(d.finance!.invoiced, /^-?\d+\.\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(d.asOf)));
});

test('HTTP: a PROPERTY_MANAGER may read the dashboard like an OWNER', async () => {
  const org = await seedOrg('PROPERTY_MANAGER');
  const headers = await login(org);
  const prop = await seedProperty(org, 'Mgr', gridSpec(1, 1, 1));
  await server.get(`/api/v1/properties/${prop.id}/dashboard`).set(headers).expect(200);
});

test('HTTP: unauthenticated requests are refused', async () => {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Anon', gridSpec(1, 1, 1));
  await server.get(`/api/v1/properties/${prop.id}/dashboard`).expect(401);
});

test('HTTP: validation is 400 INVALID_INPUT with every problem listed; the month window and days are enforced', async () => {
  const org = await seedOrg();
  const headers = await login(org);
  const prop = await seedProperty(org, 'Valid', gridSpec(1, 1, 1));
  const get = (path: string) => server.get(path).set(headers);
  const bad = await get(
    `/api/v1/properties/not-a-uuid/dashboard?month=2026-13&days=0&organizationId=${randomUUID()}`,
  ).expect(400);
  assert.equal(bad.body.code, 'INVALID_INPUT');
  assert.deepEqual(bad.body.details, [
    { field: 'propertyId', code: 'INVALID_UUID' },
    { field: 'organizationId', code: 'UNKNOWN_FIELD' },
    { field: 'month', code: 'INVALID_FORMAT' },
    { field: 'days', code: 'OUT_OF_RANGE' },
  ]);
  const old = await get(`/api/v1/properties/${prop.id}/dashboard?month=2020-01`).expect(400);
  assert.deepEqual(old.body.details, [{ field: 'month', code: 'OUT_OF_RANGE' }]);
  const future = await get(`/api/v1/properties/${prop.id}/dashboard?month=2099-01`).expect(400);
  assert.deepEqual(future.body.details, [{ field: 'month', code: 'OUT_OF_RANGE' }]);
  await get(`/api/v1/properties/${prop.id}/dashboard?days=32`).expect(400);
  const frac = await get(`/api/v1/properties/${prop.id}/dashboard?days=1.5`).expect(400);
  assert.deepEqual(frac.body.details, [{ field: 'days', code: 'INVALID_INTEGER' }]);
  await get(`/api/v1/properties/${prop.id}/dashboard?days=1&days=2`).expect(400);
  await get(`/api/v1/properties/${prop.id}/dashboard?month=${thisMonth()}&days=31`).expect(200);
});

test('HTTP: a missing, archived or other-organization property is an indistinguishable 404 with no leakage', async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  const headersB = await login(b);
  const propA = await seedProperty(a, 'Secret Alpha', gridSpec(1, 1, 1));
  const resident = await seedResident(a, 'Confidential', 'Person');
  const stay = await seedStay(a, {
    bed: propA.bed.F0R0B0!,
    resident,
    start: '2026-01-01',
    end: '2027-01-01',
  });
  void stay;
  const cross = await server
    .get(`/api/v1/properties/${propA.id}/dashboard`)
    .set(headersB)
    .expect(404);
  const missing = await server
    .get(`/api/v1/properties/${randomUUID()}/dashboard`)
    .set(headersB)
    .expect(404);
  assert.deepEqual(cross.body, missing.body, 'cross-tenant looks exactly like missing');
  for (const text of [JSON.stringify(cross.body), cross.text]) {
    for (const secret of ['Secret Alpha', 'Confidential', a.orgId])
      assert.ok(!text.includes(secret), `${secret} leaked`);
  }
  const propB = await seedProperty(b, 'Archived soon', gridSpec(1, 1, 1));
  await withMigratorClient((c) =>
    c.query(`UPDATE properties SET archived_at = now() WHERE id = $1`, [propB.id]),
  );
  await server.get(`/api/v1/properties/${propB.id}/dashboard`).set(headersB).expect(404);
});

test('isolation: another organization data never enters the aggregates', async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  const propA = await seedProperty(a, 'IsoA', gridSpec(1, 1, 2));
  const propB = await seedProperty(b, 'IsoB', gridSpec(1, 1, 2));
  const ra = await seedBilledStay(a, propA, 'F0R0B0', 'IsoResA');
  const rb = await seedBilledStay(b, propB, 'F0R0B0', 'IsoResB');
  await seedInvoice(a, {
    resident: ra.resident,
    bookingId: ra.booking,
    period: '2026-11-01',
    amount: '1000.00',
    due: '2026-11-30',
  });
  await seedInvoice(b, {
    resident: rb.resident,
    bookingId: rb.booking,
    period: '2026-11-01',
    amount: '99999.00',
    due: '2026-11-30',
  });
  const da = await dash(a, propA.id);
  assert.equal(da.finance!.invoiced, '1000.00');
  assert.equal(da.inventory.occupiedBeds, 1);
  assert.ok(!JSON.stringify(da).includes('IsoResB'));
  // Asking organization A's service for organization B's property is a 404, not an empty dashboard.
  await assert.rejects(dash(a, propB.id), (e) => e instanceof NotFoundException);
});

// ------------------------------------------------------------------------------------------------ isolation, with records INSIDE every window
//
// The tests above isolate by presence (a foreign stay or invoice that would show up in an ACTIVE figure). Foreign records
// that are dated inside the recent or upcoming windows are a different risk: a dropped filter on a windowed list would
// leak them, and old fixtures would never notice. These worlds are structurally identical, every kind of record is dated
// inside the 14-day windows at the fixed NOW (today = 2026-11-14 IST), and each carries a distinctive name and amount.

interface InWindowWorld {
  names: { active: string; past: string; upcoming: string; departed: string; broken: string };
  /** Every instant that must fall inside the recent window, and every date inside the upcoming window. */
  recentInstants: string[];
  upcomingDates: string[];
  invoice: string;
  paid: string;
}

async function seedInWindowWorld(
  org: Org,
  prop: Prop,
  tag: string,
  money: { invoice: string; paid: string },
  opts: { unattributed?: { amount: string; paid: string } } = {},
): Promise<InWindowWorld> {
  const names = {
    active: `${tag}Active`,
    past: `${tag}Past`,
    upcoming: `${tag}Upcoming`,
    departed: `${tag}Departed`,
    broken: `${tag}Broken`,
  };
  const person = {
    active: await seedResident(org, names.active),
    past: await seedResident(org, names.past),
    upcoming: await seedResident(org, names.upcoming),
    departed: await seedResident(org, names.departed),
    broken: await seedResident(org, names.broken),
  };
  // Active stay, ends in five days: an upcoming check-out. Booking, admission and check-in are all recorded inside R.
  const active = await seedStay(org, {
    bed: prop.bed.F0R0B0!,
    resident: person.active,
    start: '2026-11-01',
    end: '2026-11-19',
    checkInAt: '2026-11-12T04:00:00Z',
    admissionDate: '2026-11-12T00:00:00Z',
    bookingCreatedAt: '2026-11-11T05:00:00Z',
    admissionCreatedAt: '2026-11-12T03:00:00Z',
  });
  // Active stay that ended yesterday: past end date. Also recorded inside R.
  await seedStay(org, {
    bed: prop.bed.F0R0B1!,
    resident: person.past,
    start: '2026-11-01',
    end: '2026-11-13',
    checkInAt: '2026-11-10T04:00:00Z',
    admissionDate: '2026-11-10T00:00:00Z',
    bookingCreatedAt: '2026-11-09T05:00:00Z',
    admissionCreatedAt: '2026-11-10T03:00:00Z',
  });
  // Confirmed booking starting in four days, created yesterday: inside both U and R.
  await seedBooking(org, {
    resident: person.upcoming,
    bedId: prop.bed.F0R0B2!,
    start: '2026-11-18',
    end: '2027-01-01',
    createdAt: '2026-11-13T05:00:00Z',
  });
  // A resident who left yesterday (the booking, admission and check-in are old; only the check-out is recent).
  await seedStay(org, {
    bed: prop.bed.F0R0B3!,
    resident: person.departed,
    start: '2026-01-01',
    end: '2026-11-02',
    checkedOutAt: '2026-11-13T05:00:00Z',
  });
  // A stay with inconsistent bed history: reported as an anomaly of ITS property only.
  await seedStay(org, {
    bed: prop.bed.F0R0B4!,
    resident: person.broken,
    start: '2026-01-01',
    end: '2027-01-01',
    segments: 'zero-open',
  });
  // Money: one overdue partly paid invoice for the active stay, with its payment received yesterday.
  const invoice = await seedInvoice(org, {
    resident: person.active,
    bookingId: active.booking,
    period: '2026-11-01',
    amount: money.invoice,
    paid: money.paid,
    status: 'PARTIALLY_PAID',
    due: '2026-11-05',
  });
  await seedPayment(org, {
    invoiceId: invoice,
    resident: person.active,
    amount: money.paid,
    receivedAt: '2026-11-13T06:00:00Z',
  });
  if (opts.unattributed) {
    // Organization-level money: an invoice with no booking, partly paid, with its payment received inside the month.
    const loose = await seedInvoice(org, {
      resident: person.active,
      bookingId: null,
      period: '2026-11-01',
      amount: opts.unattributed.amount,
      paid: opts.unattributed.paid,
      status: 'PARTIALLY_PAID',
      due: '2026-11-02',
    });
    await seedPayment(org, {
      invoiceId: loose,
      resident: person.active,
      amount: opts.unattributed.paid,
      receivedAt: '2026-11-13T07:00:00Z',
    });
  }
  return {
    names,
    recentInstants: [
      '2026-11-09T05:00:00Z',
      '2026-11-11T05:00:00Z',
      '2026-11-13T05:00:00Z', // bookings created, departure
      '2026-11-10T04:00:00Z',
      '2026-11-12T04:00:00Z', // check-ins
      '2026-11-10T03:00:00Z',
      '2026-11-12T03:00:00Z', // admission records
      '2026-11-10T00:00:00Z',
      '2026-11-12T00:00:00Z', // admission dates
      '2026-11-13T06:00:00Z', // payment
    ],
    upcomingDates: ['2026-11-18', '2026-11-19'],
    invoice: money.invoice,
    paid: money.paid,
  };
}

interface IsoWorlds {
  orgA: Org;
  orgB: Org;
  own: { prop: Prop; world: InWindowWorld };
  otherProp: { prop: Prop; world: InWindowWorld };
  foreignOrg: { prop: Prop; world: InWindowWorld };
}
let isoWorldsPromise: Promise<IsoWorlds> | undefined;
const isoWorlds = () => (isoWorldsPromise ??= buildIsoWorlds());

async function buildIsoWorlds(): Promise<IsoWorlds> {
  const orgA = await seedOrg();
  const orgB = await seedOrg();
  const ownProp = await seedProperty(orgA, 'IsoOwn', gridSpec(1, 1, 6));
  const otherProp = await seedProperty(orgA, 'IsoOtherProperty', gridSpec(1, 1, 6));
  const foreignProp = await seedProperty(orgB, 'IsoForeignOrganization', gridSpec(1, 1, 6));
  return {
    orgA,
    orgB,
    own: {
      prop: ownProp,
      world: await seedInWindowWorld(orgA, ownProp, 'Own', { invoice: '1000.00', paid: '400.00' }),
    },
    otherProp: {
      prop: otherProp,
      world: await seedInWindowWorld(orgA, otherProp, 'OtherProp', {
        invoice: '88888.00',
        paid: '22222.00',
      }),
    },
    foreignOrg: {
      prop: foreignProp,
      world: await seedInWindowWorld(
        orgB,
        foreignProp,
        'ForeignOrg',
        { invoice: '77777.00', paid: '11111.00' },
        { unattributed: { amount: '55555.00', paid: '1234.00' } },
      ),
    },
  };
}

/** Asserts that `d` describes exactly the records of the world tagged `tag`, and nothing of the other two worlds. */
function assertOnly(
  d: Dashboard,
  tag: string,
  foreignTags: string[],
  money: { invoice: string; paid: string; balance: string },
) {
  const name = (suffix: string) => `${tag}${suffix} Tester`;
  const t = d.tenants!;
  // inventory and tenants (active records)
  assert.deepEqual(
    [
      d.inventory.beds,
      d.inventory.occupiedBeds,
      d.inventory.availableBeds,
      d.inventory.outOfServiceBeds,
    ],
    [6, 2, 4, 0],
  );
  assert.equal(t.activeTenants, 2);
  assert.deepEqual(
    d.inventory.anomalies,
    { occupiedOutOfService: 0, stayNeedsReview: 1 },
    "only this property's inconsistent stay",
  );
  assert.deepEqual(
    t.upcomingCheckOuts.items.map((s) => s.residentName),
    [name('Active')],
  );
  assert.deepEqual(
    t.pastEndDate.items.map((s) => s.residentName),
    [name('Past')],
  );
  assert.equal(t.upcomingCheckOuts.count + t.pastEndDate.count, 2);
  // windowed lists and counts
  assert.equal(t.upcomingCheckIns!.count, 1);
  assert.deepEqual(
    t.upcomingCheckIns!.items.map((b) => b.residentName),
    [name('Upcoming')],
  );
  assert.deepEqual(d.bookings!.confirmedUpcoming, t.upcomingCheckIns);
  assert.equal(d.bookings!.committedBeds, 1);
  assert.deepEqual(
    t.recentAdmissions!.map((a) => a.residentName).sort(),
    [name('Active'), name('Past')].sort(),
  );
  assert.deepEqual(
    t.recentDepartures.map((x) => x.residentName),
    [name('Departed')],
  );
  assert.deepEqual(
    d.bookings!.recent.map((b) => b.residentName).sort(),
    [name('Active'), name('Past'), name('Upcoming')].sort(),
  );
  // finance
  const f = d.finance!;
  assert.equal(f.invoiced, money.invoice);
  assert.equal(f.collected, money.paid);
  assert.equal(f.monthUnpaid, money.balance);
  assert.equal(f.outstanding, money.balance);
  assert.deepEqual(f.overdue, { count: 1, amount: money.balance });
  assert.deepEqual(f.pendingPayments, { count: 0, amount: '0.00' });
  assert.deepEqual(
    f.recentPayments.map((p) => [p.residentName, p.amount]),
    [[name('Active'), money.paid]],
  );
  // activity: 3 bookings, 2 admission records, 2 check-ins, 1 check-out, 1 payment
  const kinds = (k: string) => d.activity!.filter((e) => e.kind === k).length;
  assert.deepEqual(
    ['booking_created', 'admission_recorded', 'check_in', 'check_out', 'payment_received'].map(
      kinds,
    ),
    [3, 2, 2, 1, 1],
  );
  assert.equal(d.activity!.length, 9);
  for (const entry of d.activity!)
    assert.ok(entry.residentName!.startsWith(tag), `${entry.kind} names ${entry.residentName}`);
  // and not one byte of any other world
  const text = JSON.stringify(d);
  for (const foreign of foreignTags)
    assert.ok(!text.includes(foreign), `${foreign} leaked into ${tag}'s dashboard`);
}

test('isolation fixtures really fall inside the windows they are meant to test', async () => {
  const { own, otherProp, foreignOrg } = await isoWorlds();
  const w = dashboardWindows(NOW, 14);
  for (const { world } of [own, otherProp, foreignOrg]) {
    for (const iso of world.recentInstants) {
      const at = new Date(iso);
      assert.ok(at >= w.recentStart && at < w.recentEnd, `${iso} is not inside the recent window`);
    }
    for (const day of world.upcomingDates) {
      const at = new Date(`${day}T00:00:00Z`);
      assert.ok(
        at >= w.upcomingStart && at < w.upcomingEnd,
        `${day} is not inside the upcoming window`,
      );
    }
  }
  assert.equal(dateKey(w.today), '2026-11-14');
});

test('isolation (in-window): the selected property sees only its own records; other-property and other-organization records dated inside every window never appear', async () => {
  const { orgA, own } = await isoWorlds();
  const d = await dash(orgA, own.prop.id);
  assertOnly(
    d,
    'Own',
    [
      'OtherProp',
      'ForeignOrg',
      'IsoOtherProperty',
      'IsoForeignOrganization',
      '88888.00',
      '77777.00',
      '55555.00',
      '54321.00',
      '1234.00',
      '22222.00',
      '11111.00',
    ],
    {
      invoice: '1000.00',
      paid: '400.00',
      balance: '600.00',
    },
  );
  assert.equal(
    d.finance!.unattributed,
    null,
    "the other organization's invoice with no booking is not this organization's unattributed money",
  );
});

test('isolation (in-window): the other property of the same organization sees only its own records', async () => {
  const { orgA, otherProp } = await isoWorlds();
  const d = await dash(orgA, otherProp.prop.id);
  assertOnly(
    d,
    'OtherProp',
    ['Own', 'ForeignOrg', 'IsoOwn', '77777.00', '55555.00', '54321.00', '11111.00'],
    {
      invoice: '88888.00',
      paid: '22222.00',
      balance: '66666.00',
    },
  );
  assert.equal(d.finance!.unattributed, null);
});

test('isolation (in-window): the other organization sees only its own records, including its organization-level unattributed money', async () => {
  const { orgB, foreignOrg } = await isoWorlds();
  const d = await dash(orgB, foreignOrg.prop.id);
  assertOnly(
    d,
    'ForeignOrg',
    ['Own', 'OtherProp', 'IsoOwn', 'IsoOtherProperty', '88888.00', '22222.00'],
    { invoice: '77777.00', paid: '11111.00', balance: '66666.00' },
  );
  assert.deepEqual(d.finance!.unattributed, {
    count: 1,
    invoiced: '55555.00',
    collected: '1234.00',
    outstanding: '54321.00',
    overdue: '54321.00',
  });
});

test("isolation (in-window): the activity feed alone contains only the selected property's events", async () => {
  const { orgA, own } = await isoWorlds();
  const only = (...granted: string[]) => computeGates((p) => granted.includes(p));
  const all = ['booking.read', 'admission.read', 'checkin.read', 'finance.read', 'resident.read'];
  // Each activity source on its own, so a leak in one query cannot hide behind the 10-entry cap or another source.
  const expected: Record<string, [string, number]> = {
    'booking.read': ['booking_created', 3],
    'admission.read': ['admission_recorded', 2],
    'checkin.read': ['check_in', 2],
    'finance.read': ['payment_received', 1],
  };
  for (const [permission, [kind, count]] of Object.entries(expected)) {
    const d = await dash(orgA, own.prop.id, { gates: only(permission, 'resident.read') });
    const entries = d.activity!.filter((e) => e.kind === kind);
    assert.equal(entries.length, count, `${kind}`);
    for (const entry of d.activity!)
      assert.ok(
        entry.residentName!.startsWith('Own'),
        `${permission}: ${entry.kind} ${entry.residentName}`,
      );
  }
  const check = await dash(orgA, own.prop.id, { gates: only('checkin.read', 'resident.read') });
  assert.equal(check.activity!.filter((e) => e.kind === 'check_out').length, 1);
  void all;
});

// ------------------------------------------------------------------------------------------------ existing behaviour, snapshot, queries

test('D7 regression: the existing occupancy endpoint still treats a stay ending today as an overstay; the dashboard does not', async () => {
  const org = await seedOrg();
  const headers = await login(org);
  const prop = await seedProperty(org, 'Regress', gridSpec(1, 1, 2));
  const a = await seedResident(org, 'EndsToday');
  const b = await seedResident(org, 'EndedYesterday');
  await seedStay(org, { bed: prop.bed.F0R0B0!, resident: a, start: '2025-01-01', end: rel(0) });
  await seedStay(org, { bed: prop.bed.F0R0B1!, resident: b, start: '2025-01-01', end: rel(-1) });
  const occupancy = (await server.get('/api/v1/check-ins/occupancy').set(headers).expect(200)).body;
  assert.equal(occupancy.overstayCount, 2, 'existing rule: end <= today is an overstay');
  const d = await dash(org, prop.id, { now: new Date(), month: thisMonth() });
  assert.equal(d.tenants!.pastEndDate.count, 1, 'dashboard rule: strictly before today');
  assert.equal(d.tenants!.pastEndDate.items[0]!.residentName, 'EndedYesterday Tester');
  assert.equal(d.tenants!.upcomingCheckOuts.items[0]!.residentName, 'EndsToday Tester');
});

test('read-only: building the dashboard changes no row of any lifecycle, finance or inventory table', async () => {
  const { org, prop } = await worldA();
  const { org: orgB, prop: propB } = await worldB();
  for (const [o, p] of [
    [org, prop],
    [orgB, propB],
  ] as const) {
    const before = await fingerprint(o.orgId);
    const rows = await counts(o.orgId);
    await dash(o, p.id);
    await dash(o, p.id, { now: new Date() });
    assert.deepEqual(await fingerprint(o.orgId), before);
    assert.deepEqual(await counts(o.orgId), rows);
  }
});

test('snapshot: the dashboard reads in one REPEATABLE READ transaction and its figures stay mutually consistent under concurrent writes', async () => {
  const org = await seedOrg();
  const prop = await seedProperty(org, 'Race', gridSpec(2, 5, 4)); // 40 beds
  const guests = await Promise.all(
    Array.from({ length: 12 }, (_, i) => seedResident(org, `Racer${i}`)),
  );
  txOptions = [];
  await dash(org, prop.id);
  assert.equal(txOptions.length, 1, 'one transaction for the whole dashboard');
  assert.equal(
    txOptions[0]!.isolationLevel,
    'RepeatableRead',
    'the transaction is opened at REPEATABLE READ',
  );

  let writing = true;
  const writer = (async () => {
    let i = 0;
    while (writing && i < guests.length) {
      const bed = prop.bed[`F${i % 2}R${i % 5}B${i % 4}`]!;
      await seedStay(org, { bed, resident: guests[i]!, start: '2026-01-01', end: '2027-01-01' });
      await seedBooking(org, {
        resident: guests[i]!,
        bedId: prop.bed[`F1R4B${i % 4}`]!,
        start: '2026-11-20',
        end: '2026-12-20',
      });
      i += 1;
    }
  })();
  const results: Dashboard[] = [];
  for (let n = 0; n < 6; n++) results.push(await dash(org, prop.id));
  writing = false;
  await writer;
  for (const d of results) {
    assert.equal(
      d.inventory.occupiedBeds + d.inventory.availableBeds + d.inventory.outOfServiceBeds,
      d.inventory.beds,
    );
    assert.equal(
      d.tenants!.activeTenants,
      d.inventory.occupiedBeds,
      'one occupant per stay, one stay per bed here',
    );
    assert.deepEqual(d.bookings!.confirmedUpcoming, d.tenants!.upcomingCheckIns);
    const f = d.finance!;
    assert.equal(
      Math.round(Number(f.outstanding) * 100),
      Math.round(Number(f.overdue.amount) * 100) +
        Math.round(Number(f.pendingPayments.amount) * 100),
    );
    assert.equal(
      d.inventory.byFloor.reduce((s, x) => s + x.beds, 0),
      d.inventory.beds,
    );
  }
});

test('query count: the number of SQL statements does not grow with the size of the property', async () => {
  const org = await seedOrg();
  const small = await seedProperty(org, 'Ten', gridSpec(1, 2, 5)); // 10 beds
  const big = await seedProperty(org, 'Hundred', gridSpec(5, 5, 4)); // 100 beds
  for (const [prop, stays] of [
    [small, 6],
    [big, 70],
  ] as const) {
    const beds = Object.values(prop.bed).slice(0, stays);
    for (let i = 0; i < beds.length; i++) {
      const guest = await seedResident(org, `Cnt${i}`);
      await seedStay(org, {
        bed: beds[i]!,
        resident: guest,
        start: '2026-01-01',
        end: i % 3 === 0 ? '2026-11-14' : '2027-01-01',
      });
    }
  }
  const run = async (propertyId: string) => {
    queries = [];
    await dash(org, propertyId);
    return queries.length;
  };
  await run(small.id); // warm the connection
  const smallCount = await run(small.id);
  const bigCount = await run(big.id);
  const shape = new Map<string, number>();
  for (const q of queries) {
    const key = q.replace(/\s+/g, ' ').replace(/\$\d+/g, '?').slice(0, 56);
    shape.set(key, (shape.get(key) ?? 0) + 1);
  }
  console.log(
    JSON.stringify({
      probe: 'dashboard-query-count',
      statements10Beds: smallCount,
      statements100Beds: bigCount,
      kinds: [...shape.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    }),
  );
  assert.equal(bigCount, smallCount, `statements: 10 beds = ${smallCount}, 100 beds = ${bigCount}`);
  assert.ok(bigCount <= 100, `a bounded number of statements (${bigCount})`);
});

test('a realistic 100-bed hostel: correct figures, one request, timing printed as evidence', async () => {
  const org = await seedOrg();
  const headers = await login(org);
  const prop = await seedProperty(org, 'Hostel100', gridSpec(5, 5, 4));
  const today = realToday();
  const beds = Object.values(prop.bed);
  const month = monthStart();
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    for (let i = 0; i < 70; i++) {
      const resident = randomUUID();
      const booking = randomUUID();
      const admission = randomUUID();
      const checkIn = randomUUID();
      await c.query(
        `INSERT INTO residents (id, organization_id, first_name, last_name, status, updated_at) VALUES ($1,$2,$3,'Hostel','ACTIVE',now())`,
        [resident, org.orgId, `H${i}`],
      );
      await c.query(
        `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, updated_at) VALUES ($1,$2,$3,$4,'2026-01-01',$5,6000,now())`,
        [booking, org.orgId, resident, beds[i], dateKey(addDays(today, 60 + i))],
      );
      await c.query(
        `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-01-01','ADMITTED',now())`,
        [admission, org.orgId, booking, resident, beds[i]],
      );
      await c.query(
        `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'2026-01-01',now())`,
        [checkIn, org.orgId, admission, resident, beds[i], booking],
      );
      await c.query(
        `INSERT INTO stay_assignments (organization_id, booking_id, resident_id, bed_id, kind, status, start_at) VALUES ($1,$2,$3,$4,'ORIGINAL','ACTIVE','2026-01-01')`,
        [org.orgId, booking, resident, beds[i]],
      );
      await c.query(
        `INSERT INTO invoices (organization_id, resident_id, booking_id, number, period_start, period_end, amount, paid_amount, status, due_date, issued_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5,6000,$6,$7::"InvoiceStatus",$8,now(),now())`,
        [
          org.orgId,
          resident,
          booking,
          `INV-2026-${String(100000 + i)}`,
          month,
          i % 2 === 0 ? '6000.00' : '0.00',
          i % 2 === 0 ? 'PAID' : 'ISSUED',
          dateKey(addDays(today, i % 2 === 0 ? -5 : 10)),
        ],
      );
    }
    await c.query('COMMIT');
  });
  const started = Date.now();
  const res = await server.get(`/api/v1/properties/${prop.id}/dashboard`).set(headers).expect(200);
  const ms = Date.now() - started;
  const d = res.body.data as Dashboard;
  assert.equal(d.inventory.beds, 100);
  assert.equal(d.inventory.rooms, 25);
  assert.equal(d.inventory.occupiedBeds, 70);
  assert.equal(d.inventory.availableBeds, 30);
  assert.equal(d.inventory.occupancyPercent, 70);
  assert.equal(d.tenants!.activeTenants, 70);
  assert.equal(d.inventory.byFloor.length, 5);
  assert.equal(d.finance!.invoiced, '420000.00');
  assert.equal(d.finance!.outstanding, '210000.00', '35 unpaid invoices of 6000');
  assert.deepEqual(d.finance!.pendingPayments, { count: 35, amount: '210000.00' });
  assert.deepEqual(d.finance!.overdue, { count: 0, amount: '0.00' });
  console.log(JSON.stringify({ probe: 'dashboard-100-beds', httpMs: ms, bytes: res.text.length }));
});
