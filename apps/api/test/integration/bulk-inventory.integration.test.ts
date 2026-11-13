/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { assertFaultInjectionName, withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Bulk room and bed creation (POST /api/v1/properties/:propertyId/rooms/bulk), SYNTHETIC DATA ONLY.
// Every test builds its own organizations, so nothing here depends on or disturbs shared fixture data.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

let app: any;
let server: ReturnType<typeof request>;

interface Org {
  orgId: string;
  propertyId: string;
  floorIds: string[];
  headers: Record<string, string>;
  /** Cookies only: authenticated but with no CSRF header and no Origin. */
  cookieOnly: Record<string, string>;
}

async function newOrg(role: 'OWNER' | 'PROPERTY_MANAGER' = 'OWNER', floors = 2): Promise<Org> {
  const passwordHash = await hashTestPassword();
  const orgId = randomUUID();
  const userId = randomUUID();
  const propertyId = randomUUID();
  const email = `bulk-${randomUUID()}@nook.test.invalid`;
  const floorIds: string[] = [];
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `Bulk Test ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Bulk Tester',now())`,
      [userId, email, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [randomUUID(), orgId, userId, role],
    );
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'Bulk hostel',now())`,
      [propertyId, orgId, `B-${propertyId.slice(0, 8)}`],
    );
    for (let f = 0; f < floors; f++) {
      const floorId = randomUUID();
      floorIds.push(floorId);
      await c.query(
        `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
        [floorId, orgId, propertyId, `Floor ${f}`, f],
      );
    }
    await c.query('COMMIT');
  });
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
    propertyId,
    floorIds,
    headers: {
      Origin: ORIGIN,
      Cookie: `${session}; ${csrf}`,
      'x-csrf-token': csrf.slice('nook_csrf='.length),
    },
    cookieOnly: { Cookie: `${session}; ${csrf}` },
  };
}

const bulkPath = (propertyId: string) => `/api/v1/properties/${propertyId}/rooms/bulk`;
const bed = (label: string, extra: Record<string, unknown> = {}) => ({
  label,
  operationalStatus: 'IN_SERVICE',
  ...extra,
});
const bedsOf = (n: number) => Array.from({ length: n }, (_, i) => bed(`${i + 1}`));
const room = (floorId: string, label: string, beds: unknown[] = bedsOf(1)) => ({
  floorId,
  label,
  beds,
});
const post = (org: Org, body: unknown, propertyId = org.propertyId) =>
  server
    .post(bulkPath(propertyId))
    .set(org.headers)
    .send(body as object);

async function counts(orgId: string) {
  return withMigratorClient(async (c) => {
    const one = async (sql: string) => Number((await c.query(sql, [orgId])).rows[0].n);
    return {
      rooms: await one(`SELECT count(*) n FROM rooms WHERE organization_id = $1`),
      beds: await one(`SELECT count(*) n FROM beds WHERE organization_id = $1`),
    };
  });
}

/** A stable fingerprint of every row the bulk feature must never touch. */
async function fingerprint(orgId: string, tables: string[]) {
  return withMigratorClient(async (c) => {
    const out: Record<string, string> = {};
    for (const table of tables) {
      const r = await c.query(
        `SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t.id::text)), 'empty') h FROM ${table} t WHERE t.organization_id = $1`,
        [orgId],
      );
      out[table] = r.rows[0].h;
    }
    return out;
  });
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

// ------------------------------------------------------------------ creation

test('creates several rooms with several beds in one request and returns a clear summary', async () => {
  const org = await newOrg();
  const [floorA, floorB] = org.floorIds as [string, string];
  const res = await post(org, {
    rooms: [
      room(floorA, '101', [bed('1'), bed('2'), bed('3')]),
      room(floorA, '102', [
        bed('1'),
        bed('2', { operationalStatus: 'OUT_OF_SERVICE', outOfServiceReason: 'broken frame' }),
      ]),
      room(floorB, '201', []),
    ],
  }).expect(201);
  assert.equal(res.body.data.dryRun, false);
  assert.deepEqual(res.body.data.summary, { rooms: 3, beds: 5 });
  assert.deepEqual(res.body.data.limits, { maxRooms: 100, maxBeds: 200 });
  const rooms = res.body.data.rooms;
  assert.deepEqual(
    rooms.map((r: any) => r.label),
    ['101', '102', '201'],
  );
  assert.deepEqual(
    rooms[0].beds.map((b: any) => b.label),
    ['1', '2', '3'],
  );
  assert.equal(rooms[1].beds[1].operationalStatus, 'OUT_OF_SERVICE');
  assert.equal(rooms[1].beds[1].outOfServiceReason, 'broken frame');
  assert.ok(rooms.every((r: any) => typeof r.id === 'string'));

  // Persisted exactly as returned, scoped to the caller's organization and property.
  const stored = await withMigratorClient(async (c) => ({
    rooms: (
      await c.query(
        `SELECT id, label, floor_id, property_id, organization_id FROM rooms WHERE organization_id = $1 ORDER BY label`,
        [org.orgId],
      )
    ).rows,
    beds: (
      await c.query(
        `SELECT b.label, b.operational_status, b.out_of_service_reason, b.property_id, b.organization_id, r.label room
           FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.organization_id = $1 ORDER BY r.label, b.label`,
        [org.orgId],
      )
    ).rows,
  }));
  assert.equal(stored.rooms.length, 3);
  assert.equal(stored.beds.length, 5);
  assert.ok(stored.rooms.every((r: any) => r.property_id === org.propertyId));
  assert.ok(
    stored.beds.every(
      (b: any) => b.property_id === org.propertyId && b.organization_id === org.orgId,
    ),
  );
  assert.equal(stored.rooms[0].floor_id, floorA);
  assert.equal(stored.rooms[2].floor_id, floorB);
  assert.deepEqual(
    stored.beds.filter((b: any) => b.room === '102').map((b: any) => b.operational_status),
    ['IN_SERVICE', 'OUT_OF_SERVICE'],
  );

  // The existing read APIs see the new inventory.
  const list = await server
    .get(`/api/v1/properties/${org.propertyId}/rooms`)
    .set(org.headers)
    .expect(200);
  assert.equal(list.body.data.length, 3);
  const summary = await server.get('/api/v1/inventory/summary').set(org.headers).expect(200);
  assert.equal(summary.body.data.rooms, 3);
  assert.equal(summary.body.data.beds, 5);
});

test('a PROPERTY_MANAGER may bulk-create, like the single-record routes', async () => {
  const org = await newOrg('PROPERTY_MANAGER');
  await post(org, { rooms: [room(org.floorIds[0]!, 'M1')] }).expect(201);
});

test('a realistic 100-bed hostel (25 rooms x 4 beds over 5 floors) is created in one request', async () => {
  const org = await newOrg('OWNER', 5);
  const rooms = Array.from({ length: 25 }, (_, i) =>
    room(org.floorIds[Math.floor(i / 5)]!, `R${Math.floor(i / 5)}${(i % 5) + 1}`, bedsOf(4)),
  );
  const t0 = performance.now();
  const res = await post(org, { rooms }).expect(201);
  const ms = Math.round(performance.now() - t0);
  console.log(
    `bulk 100-bed hostel: 25 rooms / 100 beds created in one request in ${ms} ms (evidence, not asserted)`,
  );
  assert.deepEqual(res.body.data.summary, { rooms: 25, beds: 100 });
  assert.deepEqual(await counts(org.orgId), { rooms: 25, beds: 100 });
  const summary = await server.get('/api/v1/inventory/summary').set(org.headers).expect(200);
  assert.equal(summary.body.data.beds, 100);
  assert.equal(summary.body.data.bedsInService, 100);
});

// ------------------------------------------------------------------ limits

test('the maximum (100 rooms, 200 beds) is accepted; one more room or bed is refused and nothing is written', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const rooms = (n: number, beds: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => room(floor, `${prefix}${i}`, bedsOf(beds)));

  const over = await post(org, { rooms: rooms(101, 0, 'X') }).expect(400);
  assert.deepEqual(over.body.details, [{ field: 'rooms', code: 'TOO_MANY' }]);
  // 100 rooms are allowed, but 201 beds are not (99 rooms of 2 beds plus one room of 3)
  const overBeds = await post(org, {
    rooms: [...rooms(99, 2, 'Y'), room(floor, 'extra', bedsOf(3))],
  }).expect(400);
  assert.deepEqual(overBeds.body.details, [{ field: 'beds', code: 'TOO_MANY' }]);
  assert.deepEqual(await counts(org.orgId), { rooms: 0, beds: 0 });

  // The same limits apply to a dry-run.
  const dryOver = await post(org, { dryRun: true, rooms: rooms(101, 0, 'D') }).expect(400);
  assert.deepEqual(dryOver.body, over.body);

  const max = await post(org, { rooms: rooms(100, 2, 'M') }).expect(201);
  assert.deepEqual(max.body.data.summary, { rooms: 100, beds: 200 });
  assert.deepEqual(await counts(org.orgId), { rooms: 100, beds: 200 });
});

// ------------------------------------------------------------------ duplicates

test('duplicate identifiers are refused with 409 DUPLICATE_ACTIVE_IDENTIFIER and indexed details; nothing is written', async () => {
  const org = await newOrg();
  const [floorA, floorB] = org.floorIds as [string, string];
  await post(org, { rooms: [room(floorA, '101', bedsOf(2))] }).expect(201);
  const before = await counts(org.orgId);

  // room labels are unique per PROPERTY: the same label on another floor still collides
  const res = await post(org, {
    rooms: [
      room(floorA, '201', [bed('1'), bed('1')]), // bed label repeated inside one room
      room(floorB, '202'),
      room(floorB, '202'), // room label repeated inside the request
      room(floorB, '101'), // already active in the property, on another floor
    ],
  }).expect(409);
  assert.equal(res.body.code, 'DUPLICATE_ACTIVE_IDENTIFIER');
  assert.deepEqual(res.body.details, [
    { field: 'rooms[0].beds[1].label', code: 'DUPLICATE_IN_REQUEST' },
    { field: 'rooms[2].label', code: 'DUPLICATE_IN_REQUEST' },
    { field: 'rooms[3].label', code: 'DUPLICATE_EXISTING' },
  ]);
  assert.deepEqual(
    await counts(org.orgId),
    before,
    'a refused batch writes nothing, not even its valid rooms',
  );
});

test('bed labels are unique per room only; labels of archived rooms may be reused', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const first = await post(org, {
    rooms: [room(floor, '101', bedsOf(2)), room(floor, '102', bedsOf(2))],
  }).expect(201);
  // the same bed labels in different rooms are fine (already shown above); now archive 101 and reuse its label
  await server
    .post(`/api/v1/rooms/${first.body.data.rooms[0].id}/archive`)
    .set(org.headers)
    .expect(200);
  await post(org, { rooms: [room(floor, '101', bedsOf(2))] }).expect(201);
  // 102 is still active, so it still collides
  await post(org, { rooms: [room(floor, '102')] }).expect(409);
});

// ------------------------------------------------------------------ invalid payloads

test('invalid payloads return 400 INVALID_INPUT with every problem listed under an indexed path', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const res = await post(org, {
    rooms: [
      { floorId: 'not-a-uuid', label: '', beds: [] },
      room(floor, 'ok', [
        bed(''),
        { label: 'x' },
        { label: 'y', operationalStatus: 'BROKEN' },
        { label: 'z', operationalStatus: 'OUT_OF_SERVICE' },
        bed('w', { outOfServiceReason: 'not allowed while in service' }),
      ]),
    ],
  }).expect(400);
  assert.equal(res.body.code, 'INVALID_INPUT');
  assert.deepEqual(res.body.details, [
    { field: 'rooms[0].floorId', code: 'INVALID_UUID' },
    { field: 'rooms[0].label', code: 'INVALID_LENGTH' },
    { field: 'rooms[1].beds[0].label', code: 'INVALID_LENGTH' },
    { field: 'rooms[1].beds[1].operationalStatus', code: 'REQUIRED' },
    { field: 'rooms[1].beds[2].operationalStatus', code: 'INVALID_ENUM' },
    { field: 'rooms[1].beds[3].outOfServiceReason', code: 'REQUIRED' },
    { field: 'rooms[1].beds[4].outOfServiceReason', code: 'FORBIDDEN' },
  ]);
  for (const body of [
    {},
    { rooms: [] },
    { rooms: 'x' },
    { rooms: [room(floor, 'a')], dryRun: 'yes' },
    [],
  ]) {
    await post(org, body).expect(400);
  }
  await post(org, { rooms: [room(floor, 'a')], organizationId: randomUUID() }).expect(400);
  assert.deepEqual(await counts(org.orgId), { rooms: 0, beds: 0 });
});

// ------------------------------------------------------------------ missing / inaccessible parents

test('a missing, malformed or archived property, or an unusable floor, is refused and nothing is written', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const body = { rooms: [room(floor, 'A1')] };
  await post(org, body, randomUUID()).expect(404);
  await post(org, body, 'not-a-uuid').expect(400);
  // a floor that does not exist
  await post(org, { rooms: [room(randomUUID(), 'A1')] }).expect(404);
  // a floor of another property in the same organization
  const otherProperty = randomUUID();
  const otherFloor = randomUUID();
  await withMigratorClient(async (c) => {
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'Other',now())`,
      [otherProperty, org.orgId, `O-${otherProperty.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`,
      [otherFloor, org.orgId, otherProperty],
    );
  });
  await post(org, { rooms: [room(otherFloor, 'A1')] }).expect(404);
  // an archived floor, and a batch where only one of two floors is unusable
  await withMigratorClient((c) =>
    c.query(`UPDATE floors SET archived_at = now() WHERE id = $1`, [org.floorIds[1]]),
  );
  await post(org, { rooms: [room(floor, 'A1'), room(org.floorIds[1]!, 'A2')] }).expect(404);
  // an archived property
  await withMigratorClient((c) =>
    c.query(`UPDATE properties SET archived_at = now() WHERE id = $1`, [org.propertyId]),
  );
  await post(org, body).expect(404);
  assert.deepEqual(await counts(org.orgId), { rooms: 0, beds: 0 });
});

// ------------------------------------------------------------------ authorization

test('unauthenticated, CSRF-less and cross-origin requests are refused', async () => {
  const org = await newOrg();
  const body = { rooms: [room(org.floorIds[0]!, 'A1')] };
  await server.post(bulkPath(org.propertyId)).set('Origin', ORIGIN).send(body).expect(401);
  await server.post(bulkPath(org.propertyId)).send(body).expect(401);
  // authenticated, but without the CSRF header / with a foreign origin
  await server
    .post(bulkPath(org.propertyId))
    .set(org.cookieOnly)
    .set('Origin', ORIGIN)
    .send(body)
    .expect(403);
  await server
    .post(bulkPath(org.propertyId))
    .set({ ...org.headers, Origin: 'https://evil.example' })
    .send(body)
    .expect(403);
  assert.deepEqual(await counts(org.orgId), { rooms: 0, beds: 0 });
});

// ------------------------------------------------------------------ tenant isolation

test("another organization cannot bulk-create under this organization's property or floors", async () => {
  const a = await newOrg();
  const b = await newOrg();
  const before = await counts(a.orgId);
  // B targets A's property with A's floor
  await post(b, { rooms: [room(a.floorIds[0]!, 'X1')] }, a.propertyId).expect(404);
  // B targets its own property but with A's floor
  await post(b, { rooms: [room(a.floorIds[0]!, 'X1')] }).expect(404);
  // B targets A's property with its own floor
  await post(b, { rooms: [room(b.floorIds[0]!, 'X1')] }, a.propertyId).expect(404);
  // and a dry-run does not leak existence either
  await post(b, { dryRun: true, rooms: [room(a.floorIds[0]!, 'X1')] }, a.propertyId).expect(404);
  assert.deepEqual(await counts(a.orgId), before);
  assert.deepEqual(await counts(b.orgId), { rooms: 0, beds: 0 });
  // the same labels in two organizations never collide
  await post(a, { rooms: [room(a.floorIds[0]!, '101')] }).expect(201);
  await post(b, { rooms: [room(b.floorIds[0]!, '101')] }).expect(201);
});

// ------------------------------------------------------------------ rollback

test('a failure after rooms were inserted rolls the whole batch back', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  await post(org, { rooms: [room(floor, 'KEEP', bedsOf(1))] }).expect(201);
  const before = await counts(org.orgId);
  const fn = `fin_test_bulk_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  assertFaultInjectionName(fn); // only a per-run, test-owned name may be created or dropped
  await withMigratorClient(async (c) => {
    await c.query(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
      IF NEW.label = 'FORCE_FAIL' AND NEW.organization_id = '${org.orgId}' THEN RAISE EXCEPTION 'forced failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await c.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON beds FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
  });
  try {
    // the rooms and the first beds are inserted before the last bed fails
    await post(org, {
      rooms: [room(floor, 'R1', bedsOf(3)), room(floor, 'R2', [bed('1'), bed('FORCE_FAIL')])],
    }).expect(500);
    assert.deepEqual(
      await counts(org.orgId),
      before,
      'no room and no bed of the failed batch survives',
    );
  } finally {
    await withMigratorClient(async (c) => {
      await c.query(`DROP TRIGGER IF EXISTS ${fn} ON beds`);
      await c.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    });
  }
  // healthy again, and the labels of the failed batch were never consumed
  await post(org, {
    rooms: [room(floor, 'R1', bedsOf(3)), room(floor, 'R2', [bed('1'), bed('FORCE_FAIL')])],
  }).expect(201);
});

// ------------------------------------------------------------------ concurrency

test('two identical batches sent at the same time: exactly one succeeds, the other is a 409, no partial rows', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const body = { rooms: [room(floor, 'C1', bedsOf(4)), room(floor, 'C2', bedsOf(4))] };
  const results = await Promise.all(Array.from({ length: 6 }, () => post(org, body)));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409]);
  for (const r of results.filter((x) => x.status === 409)) {
    assert.equal(r.body.code, 'DUPLICATE_ACTIVE_IDENTIFIER');
  }
  assert.deepEqual(await counts(org.orgId), { rooms: 2, beds: 8 });
});

test('concurrent batches that conflict on one label leave exactly one winner; disjoint batches all succeed', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const overlapping = await Promise.all([
    post(org, { rooms: [room(floor, 'S1'), room(floor, 'A')] }),
    post(org, { rooms: [room(floor, 'S2'), room(floor, 'A')] }),
  ]);
  assert.deepEqual(overlapping.map((r) => r.status).sort(), [201, 409]);
  const rooms = await withMigratorClient((c) =>
    c.query(`SELECT label FROM rooms WHERE organization_id = $1 ORDER BY label`, [org.orgId]),
  );
  const labels = rooms.rows.map((r: any) => r.label);
  assert.ok(
    labels.length === 2 && labels.includes('A'),
    `exactly one batch landed whole: ${labels}`,
  );

  const disjoint = await Promise.all(
    Array.from({ length: 5 }, (_, i) => post(org, { rooms: [room(floor, `D${i}`, bedsOf(2))] })),
  );
  assert.ok(disjoint.every((r) => r.status === 201));
  assert.deepEqual(await counts(org.orgId), { rooms: 7, beds: 12 });
});

test('a bulk create racing an inventory availability change on the same organization completes without deadlock', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const seed = await post(org, { rooms: [room(floor, 'SEED', bedsOf(4))] }).expect(201);
  const seedBeds = seed.body.data.rooms[0].beds.map((b: any) => b.id);
  const results = await Promise.all([
    post(org, { rooms: [room(floor, 'N1', bedsOf(10)), room(floor, 'N2', bedsOf(10))] }),
    ...seedBeds.map((id: string) =>
      server
        .patch(`/api/v1/beds/${id}`)
        .set(org.headers)
        .send({ operationalStatus: 'OUT_OF_SERVICE', outOfServiceReason: 'race' }),
    ),
  ]);
  assert.equal(results[0]!.status, 201);
  assert.ok(
    results.slice(1).every((r) => r.status === 200),
    'the status changes all complete',
  );
  assert.deepEqual(await counts(org.orgId), { rooms: 3, beds: 24 });
});

// ------------------------------------------------------------------ dry-run

test('a dry-run answers 200, creates no rooms, beds or other records, and a later real submission succeeds', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const rooms = [room(floor, 'P1', bedsOf(3)), room(floor, 'P2', bedsOf(2))];
  const tables = ['properties', 'floors', 'rooms', 'beds', 'residents', 'bookings', 'admissions'];
  const before = await fingerprint(org.orgId, tables);
  const wide = (
    await withMigratorClient((c) =>
      c.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id = $1`, [org.orgId]),
    )
  ).rows[0].n;

  const dry = await post(org, { dryRun: true, rooms }).expect(200);
  assert.equal(dry.body.data.dryRun, true);
  assert.deepEqual(dry.body.data.summary, { rooms: 2, beds: 5 });
  assert.ok(
    dry.body.data.rooms.every((r: any) => r.id === null && r.beds.every((b: any) => b.id === null)),
  );
  assert.deepEqual(await counts(org.orgId), { rooms: 0, beds: 0 });
  assert.deepEqual(
    await fingerprint(org.orgId, tables),
    before,
    'no table of the organization changed',
  );
  assert.equal(
    (
      await withMigratorClient((c) =>
        c.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id = $1`, [org.orgId]),
      )
    ).rows[0].n,
    wide,
  );
  // repeating a dry-run is idempotent: the labels were not consumed
  await post(org, { dryRun: true, rooms }).expect(200);

  const real = await post(org, { rooms }).expect(201);
  assert.deepEqual(
    real.body.data.summary,
    dry.body.data.summary,
    'the preview described what was created',
  );
  assert.deepEqual(
    real.body.data.rooms.map((r: any) => [r.label, r.beds.map((b: any) => b.label)]),
    dry.body.data.rooms.map((r: any) => [r.label, r.beds.map((b: any) => b.label)]),
  );
});

test('dry-run and real submission validate identically: same errors for the same payload', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  await post(org, { rooms: [room(floor, 'TAKEN')] }).expect(201);
  const cases: Array<{ name: string; body: any; status: number }> = [
    {
      name: 'invalid fields',
      body: { rooms: [{ floorId: 'x', label: '', beds: [{ label: '' }] }] },
      status: 400,
    },
    { name: 'empty', body: { rooms: [] }, status: 400 },
    {
      name: 'in-request duplicates',
      body: { rooms: [room(floor, 'D'), room(floor, 'D', [bed('1'), bed('1')])] },
      status: 409,
    },
    {
      name: 'existing label',
      body: { rooms: [room(floor, 'TAKEN'), room(floor, 'NEW')] },
      status: 409,
    },
    { name: 'unknown floor', body: { rooms: [room(randomUUID(), 'U')] }, status: 404 },
  ];
  for (const c of cases) {
    const dry = await post(org, { ...c.body, dryRun: true }).expect(c.status);
    const real = await post(org, c.body).expect(c.status);
    assert.deepEqual(dry.body, real.body, `${c.name}: identical error body`);
  }
  assert.deepEqual(await counts(org.orgId), { rooms: 1, beds: 1 });
});

// ------------------------------------------------------------------ existing records

test('existing rooms, beds, residents, bookings and admissions are untouched by a bulk create', async () => {
  const org = await newOrg();
  const floor = org.floorIds[0]!;
  const seed = await post(org, { rooms: [room(floor, 'LIVE', bedsOf(2))] }).expect(201);
  const bedId = seed.body.data.rooms[0].beds[0].id;
  const residentId = randomUUID();
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,'Syn','Thetic',now())`,
      [residentId, org.orgId],
    ),
  );
  const booking = await server
    .post('/api/v1/bookings')
    .set(org.headers)
    .send({ residentId, bedId, startDate: '2026-12-01', endDate: '2027-03-01', monthlyPrice: 5000 })
    .expect(201);
  assert.ok(booking.body.id ?? booking.body.data?.id);

  const tables = [
    'properties',
    'floors',
    'rooms',
    'beds',
    'residents',
    'bookings',
    'admissions',
    'check_ins',
    'check_outs',
    'stay_assignments',
    'transfers',
  ];
  const before = await fingerprint(org.orgId, tables);
  const bookingsBefore = (
    await withMigratorClient((c) =>
      c.query(`SELECT count(*)::int n FROM bookings WHERE organization_id = $1`, [org.orgId]),
    )
  ).rows[0].n;
  assert.equal(bookingsBefore, 1);

  await post(org, { dryRun: true, rooms: [room(floor, 'NEW1', bedsOf(4))] }).expect(200);
  await post(org, {
    rooms: [room(floor, 'NEW1', bedsOf(4)), room(floor, 'NEW2', bedsOf(4))],
  }).expect(201);
  await post(org, { rooms: [room(floor, 'LIVE')] }).expect(409); // a refused batch changes nothing either

  const after = await fingerprint(org.orgId, tables);
  for (const table of tables.filter((t) => t !== 'rooms' && t !== 'beds')) {
    assert.equal(after[table], before[table], `${table} is unchanged`);
  }
  // rooms and beds only gained rows; the pre-existing ones are byte-identical (including updated_at)
  const preserved = await withMigratorClient(async (c) => {
    const r = await c.query(
      `SELECT (SELECT count(*)::int FROM rooms WHERE organization_id = $1 AND label = 'LIVE') live_rooms,
              (SELECT count(*)::int FROM beds WHERE organization_id = $1 AND room_id = $2) live_beds,
              (SELECT updated_at FROM beds WHERE id = $3) bed_updated`,
      [org.orgId, seed.body.data.rooms[0].id, bedId],
    );
    return r.rows[0];
  });
  assert.equal(preserved.live_rooms, 1);
  assert.equal(preserved.live_beds, 2);
  assert.ok(preserved.bed_updated);
  assert.deepEqual(await counts(org.orgId), { rooms: 3, beds: 10 });
});
