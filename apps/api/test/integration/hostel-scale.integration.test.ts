/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Hostel-scale concurrency evidence for the first staff-operated pilot (about 100 beds), SYNTHETIC DATA ONLY.
// It asserts only invariants the booking service already promises (the booking.integration tests assert the
// same for one bed): at most one live booking per bed and date range, and no overlapping live bookings.
// Latency and throughput are PRINTED as evidence; no latency threshold is asserted because none has been approved.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

const BEDS = 100; // 5 floors x 5 rooms x 4 beds
const PER_BED = 3; // competing requests per bed in each test

let app: any;
let server: ReturnType<typeof request>;

interface Hostel {
  orgId: string;
  bedIds: string[];
  residentIds: string[];
  headers: Record<string, string>;
}

async function newHostel(): Promise<Hostel> {
  const passwordHash = await hashTestPassword();
  const orgId = randomUUID();
  const userId = randomUUID();
  const propertyId = randomUUID();
  const email = `scale-${randomUUID()}@nook.test.invalid`;
  const bedIds: string[] = [];
  const residentIds: string[] = [];
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `Scale Test ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Scale Tester',now())`,
      [userId, email, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
      [randomUUID(), orgId, userId],
    );
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'Scale hostel',now())`,
      [propertyId, orgId, `S-${propertyId.slice(0, 8)}`],
    );
    for (let f = 0; f < 5; f++) {
      const floorId = randomUUID();
      await c.query(
        `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
        [floorId, orgId, propertyId, `Floor ${f}`, f],
      );
      for (let r = 0; r < 5; r++) {
        const roomId = randomUUID();
        await c.query(
          `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
          [roomId, orgId, propertyId, floorId, `R${f}${r}`],
        );
        for (let b = 0; b < 4; b++) {
          const bedId = randomUUID();
          bedIds.push(bedId);
          await c.query(
            `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
            [bedId, orgId, propertyId, roomId, `B${b + 1}`],
          );
        }
      }
    }
    // distinct synthetic residents so no request is refused for a reason unrelated to bed allocation
    for (let i = 0; i < BEDS * PER_BED * 2; i++) {
      const id = randomUUID();
      residentIds.push(id);
      await c.query(
        `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,$3,'Synthetic',now())`,
        [id, orgId, `Res${i}`],
      );
    }
    await c.query('COMMIT');
  });
  assert.equal(bedIds.length, BEDS);
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  const session = set.find((c) => c.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((c) => c.startsWith('nook_csrf='))!.split(';')[0]!;
  return {
    orgId,
    bedIds,
    residentIds,
    headers: {
      Origin: ORIGIN,
      Cookie: `${session}; ${csrf}`,
      'x-csrf-token': csrf.slice('nook_csrf='.length),
    },
  };
}

interface Attempt {
  bed: number;
  window: string;
  status: number;
  ms: number;
}

async function attempt(
  h: Hostel,
  bed: number,
  residentIndex: number,
  window: string,
  startDate: string,
  endDate: string,
): Promise<Attempt> {
  const t0 = performance.now();
  const res = await server.post('/api/v1/bookings').set(h.headers).send({
    residentId: h.residentIds[residentIndex],
    bedId: h.bedIds[bed],
    startDate,
    endDate,
    monthlyPrice: 5000,
  });
  return { bed, window, status: res.status, ms: performance.now() - t0 };
}

// Client-side cap: 300 simultaneous connections from this single test process overflowed the local listen backlog
// (ECONNRESET at connect, before any request reached the API). Requests are therefore sent in waves of CHUNK_BEDS beds
// (CHUNK_BEDS x 3 requests in flight), so every bed still has its competing requests in flight at the same time.
const CHUNK_BEDS = 20;
async function inWaves(make: (bed: number) => Promise<Attempt>[]): Promise<Attempt[]> {
  const all: Attempt[] = [];
  for (let start = 0; start < BEDS; start += CHUNK_BEDS) {
    const beds = Array.from({ length: Math.min(CHUNK_BEDS, BEDS - start) }, (_, i) => start + i);
    all.push(...(await Promise.all(beds.flatMap(make))));
  }
  return all;
}

/** Pairs of live bookings on one bed whose Asia/Kolkata day ranges overlap (half-open). Must always be 0. */
const overlapCount = (orgId: string) =>
  withMigratorClient(async (c) =>
    Number(
      (
        await c.query(
          `SELECT count(*) n FROM bookings a JOIN bookings b
             ON a.bed_id = b.bed_id AND a.id < b.id
            AND a.organization_id = $1 AND b.organization_id = $1
            AND a.status <> 'CANCELLED' AND b.status <> 'CANCELLED'
            AND (a.start_date AT TIME ZONE 'Asia/Kolkata')::date < (b.end_date AT TIME ZONE 'Asia/Kolkata')::date
            AND (b.start_date AT TIME ZONE 'Asia/Kolkata')::date < (a.end_date AT TIME ZONE 'Asia/Kolkata')::date`,
          [orgId],
        )
      ).rows[0].n,
    ),
  );

const liveByBed = (orgId: string) =>
  withMigratorClient(async (c) => {
    const rows = (
      await c.query(
        `SELECT bed_id, count(*)::int n FROM bookings WHERE organization_id = $1 AND status <> 'CANCELLED' GROUP BY bed_id`,
        [orgId],
      )
    ).rows;
    return new Map<string, number>(rows.map((r: any) => [r.bed_id as string, r.n as number]));
  });

function summarize(label: string, attempts: Attempt[], elapsedMs: number) {
  const ms = attempts.map((a) => a.ms).sort((a, b) => a - b);
  const pick = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]!);
  const histogram: Record<string, number> = {};
  for (const a of attempts) histogram[a.status] = (histogram[a.status] ?? 0) + 1;
  console.log(
    JSON.stringify({
      evidence: 'hostel-scale',
      test: label,
      beds: BEDS,
      requests: attempts.length,
      statuses: histogram,
      wallClockMs: Math.round(elapsedMs),
      latencyMs: { p50: pick(0.5), p95: pick(0.95), max: Math.round(ms[ms.length - 1]!) },
      note: 'printed evidence only; no latency threshold has been approved',
    }),
  );
}

test.before(async () => {
  app = await NestFactory.create(AppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
});

test.after(async () => {
  await app.close();
});

test('hostel scale: 300 competing bookings for the same window on 100 beds (60 in flight) give exactly one winner per bed', async () => {
  const h = await newHostel();
  const t0 = performance.now();
  const attempts = await inWaves((bed) =>
    Array.from({ length: PER_BED }, (_, k) =>
      attempt(h, bed, bed * PER_BED + k, 'same', '2026-12-01', '2027-03-01'),
    ),
  );
  summarize('same-window contention', attempts, performance.now() - t0);
  for (const a of attempts)
    assert.ok([201, 409].includes(a.status), `unexpected status ${a.status}`);
  for (let bed = 0; bed < BEDS; bed++) {
    const mine = attempts.filter((a) => a.bed === bed);
    assert.equal(mine.filter((a) => a.status === 201).length, 1, `bed ${bed}`);
    assert.equal(mine.filter((a) => a.status === 409).length, PER_BED - 1, `bed ${bed}`);
  }
  const live = await liveByBed(h.orgId);
  assert.equal(live.size, BEDS);
  for (const n of live.values()) assert.equal(n, 1);
  assert.equal(await overlapCount(h.orgId), 0);
});

test('hostel scale: adjacent and overlapping future windows on 100 beds never overlap', async () => {
  const h = await newHostel();
  const t0 = performance.now();
  const attempts = await inWaves((bed) => [
    attempt(h, bed, bed * PER_BED, 'A', '2026-12-01', '2027-03-01'),
    attempt(h, bed, bed * PER_BED + 1, 'B', '2027-03-01', '2027-06-01'), // adjacent to A (end exclusive)
    attempt(h, bed, bed * PER_BED + 2, 'C', '2027-02-01', '2027-04-01'), // overlaps both A and B
  ]);
  summarize('mixed windows', attempts, performance.now() - t0);
  for (const a of attempts)
    assert.ok([201, 409].includes(a.status), `unexpected status ${a.status}`);
  assert.equal(await overlapCount(h.orgId), 0);
  const live = await liveByBed(h.orgId);
  const outcomes: Record<string, number> = {};
  for (let bed = 0; bed < BEDS; bed++) {
    const won = attempts
      .filter((a) => a.bed === bed && a.status === 201)
      .map((a) => a.window)
      .sort()
      .join('');
    outcomes[won] = (outcomes[won] ?? 0) + 1;
    // Half-open ranges: A and B are adjacent and both fit; C overlaps both. So a bed ends with exactly {A,B} or {C}.
    // A lone A or B would mean a request that fits was refused, which is a defect, not a race outcome.
    assert.ok(['AB', 'C'].includes(won), `bed ${bed}: winners ${won}`);
    assert.equal(live.get(h.bedIds[bed]!), won.length, `bed ${bed}`);
  }
  console.log(JSON.stringify({ evidence: 'hostel-scale', test: 'mixed windows', outcomes }));
});
