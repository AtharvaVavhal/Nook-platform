/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../apps/api/src/app.module.js';
import { concretePath, listRoutes, type RouteInfo } from '../../apps/api/test/route-inventory.js';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { requireTestDatabaseUrl } from '../../apps/api/test/integration/helpers/env.js';
import {
  TEST_PASSWORD,
  hashTestPassword,
} from '../../apps/api/test/integration/helpers/fixtures.js';

/**
 * Permission layer (STAFF milestone, step 0) against a real application and a disposable PostgreSQL database.
 *
 * 1. Behavior baseline: every registered route is called as anonymous, OWNER and PROPERTY_MANAGER with a fixed
 *    deterministic request. The (status, error code) pairs are compared with `fixtures/permission-baseline.json`,
 *    which was captured from the code BEFORE the permission layer existed. Any change in OWNER/PM behavior fails.
 * 2. Cross-organization isolation for every resource family reachable through the seven formerly session-only
 *    controllers: a foreign identifier answers 404, a foreign write changes nothing, lists never leak.
 */
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';
const BASELINE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'permission-baseline.json',
);

let app: any;
let server: ReturnType<typeof request>;
let routes: RouteInfo[];

interface Actor {
  readonly headers: Record<string, string>;
}
const actors: Record<string, Actor> = {};
const ids = {
  a: {} as Record<string, string>,
  b: {} as Record<string, string>,
};

async function seedOrg(label: 'a' | 'b', c: any) {
  const org = randomUUID();
  const s = ids[label];
  Object.assign(s, {
    org,
    property: randomUUID(),
    floor: randomUUID(),
    room: randomUUID(),
    bed: randomUUID(),
    resident: randomUUID(),
    enquiry: randomUUID(),
    booking: randomUUID(),
    admission: randomUUID(),
    checkin: randomUUID(),
  });
  await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
    org,
    `Permission ${label}`,
  ]);
  await c.query(
    `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1::uuid,$2,$1::text,'P',now())`,
    [s.property, org],
  );
  await c.query(
    `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`,
    [s.floor, org, s.property],
  );
  await c.query(
    `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R',now())`,
    [s.room, org, s.property, s.floor],
  );
  await c.query(
    `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,'B',now())`,
    [s.bed, org, s.property, s.room],
  );
  await c.query(
    `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,'Perm','Resident',now())`,
    [s.resident, org],
  );
  await c.query(
    `INSERT INTO enquiries (id, organization_id, first_name, last_name, phone, updated_at) VALUES ($1,$2,'Perm','Enquiry','0000000000',now())`,
    [s.enquiry, org],
  );
  await c.query(
    `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, updated_at)
     VALUES ($1,$2,$3,$4,'2030-01-01','2031-01-01',5000,now())`,
    [s.booking, org, s.resident, s.bed],
  );
  await c.query(
    `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,'2030-01-01','PENDING',now())`,
    [s.admission, org, s.booking, s.resident, s.bed],
  );
}

async function addMember(c: any, org: string, role: 'OWNER' | 'PROPERTY_MANAGER', label: string) {
  const hash = await hashTestPassword();
  const userId = randomUUID();
  const email = `perm-${label.toLowerCase()}-${randomUUID().slice(0, 8)}@nook.test.invalid`;
  await c.query(
    `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,$4,now())`,
    [userId, email, hash, label],
  );
  await c.query(
    `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
    [randomUUID(), org, userId, role],
  );
  return email;
}

async function login(email: string): Promise<Actor> {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  const session = set.find((x) => x.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((x) => x.startsWith('nook_csrf='))!.split(';')[0]!;
  return {
    headers: {
      Origin: ORIGIN,
      Cookie: `${session}; ${csrf}`,
      'x-csrf-token': csrf.slice('nook_csrf='.length),
    },
  };
}

test.before(async () => {
  try {
    await setup();
  } catch (error) {
    console.log(
      JSON.stringify({
        probe: 'permission-setup-error',
        message: String((error as Error).message).slice(0, 300),
        stack: String((error as Error).stack)
          .split('\n')
          .slice(1, 4),
      }),
    );
    throw error;
  }
});

async function setup() {
  const emails: Record<string, string> = {};
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await seedOrg('a', c);
    await seedOrg('b', c);
    emails.ownerA = await addMember(c, ids.a.org!, 'OWNER', 'ownerA');
    emails.pmA = await addMember(c, ids.a.org!, 'PROPERTY_MANAGER', 'pmA');
    emails.ownerB = await addMember(c, ids.b.org!, 'OWNER', 'ownerB');
    emails.pmB = await addMember(c, ids.b.org!, 'PROPERTY_MANAGER', 'pmB');
    await c.query('COMMIT');
  });
  app = await NestFactory.create(AppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
  routes = listRoutes(app);
  for (const key of ['ownerA', 'pmA', 'ownerB', 'pmB']) actors[key] = await login(emails[key]!);
}

test.after(async () => {
  await app.close();
});

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const call = (actor: Actor | null, method: string, path: string, body?: object) => {
  const verb = method.toLowerCase() as Method;
  const r = (server as any)[verb](`/api/v1${path}`).set(actor ? actor.headers : { Origin: ORIGIN });
  return method === 'GET' || method === 'DELETE' ? r : r.send(body ?? {});
};
const outcome = (res: any) =>
  `${res.status} ${res.body?.code ?? res.body?.error?.code ?? res.body?.message?.code ?? ''}`.trim();

test('every registered route is discovered and none is an unsupported method', () => {
  assert.ok(routes.length >= 80, `expected the full route table, found ${routes.length}`);
  assert.deepEqual(
    routes.filter((r) => r.method.startsWith('UNSUPPORTED')),
    [],
  );
});

test('OWNER and PROPERTY_MANAGER behavior is identical to the pre-permission-layer baseline on every route', async () => {
  const observed: Record<string, string> = {};
  for (const route of routes) {
    const path = concretePath(route.path);
    for (const who of ['anonymous', 'ownerA', 'pmA'] as const) {
      // Logout would end the session used by the rest of the sweep; it is exercised by auth.integration.
      if (who !== 'anonymous' && route.path === '/auth/logout' && route.method === 'POST') continue;
      const res = await call(who === 'anonymous' ? null : actors[who]!, route.method, path);
      observed[`${who} ${route.method} ${route.path}`] = outcome(res);
    }
  }
  if (!existsSync(BASELINE)) {
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, JSON.stringify(observed, null, 2) + '\n');
    assert.fail(
      `Baseline captured (${Object.keys(observed).length} observations) at ${BASELINE}. Review it, then re-run.`,
    );
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string>;
  const differences = Object.keys({ ...baseline, ...observed })
    .filter((key) => baseline[key] !== observed[key])
    .map(
      (key) =>
        `${key}: baseline ${baseline[key] ?? '(absent)'} -> now ${observed[key] ?? '(absent)'}`,
    );
  if (differences.length)
    console.log(
      JSON.stringify({
        probe: 'permission-diff',
        count: differences.length,
        differences: differences.slice(0, 40),
      }),
    );
  assert.deepEqual(differences, [], 'observable route behavior changed');
  assert.equal(Object.keys(observed).length, Object.keys(baseline).length);
});

test('no authenticated OWNER or PM request ends in a server error', async () => {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string>;
  const errors = Object.entries(baseline).filter(
    ([key, value]) => !key.startsWith('anonymous') && /^5/.test(value),
  );
  if (errors.length) console.log(JSON.stringify({ probe: 'permission-5xx', errors }));
  assert.deepEqual(errors, []);
});

test('anonymous callers are refused on every route that is not public', async () => {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string>;
  const open = Object.entries(baseline)
    .filter(([key]) => key.startsWith('anonymous '))
    .filter(([, value]) => !value.startsWith('401'))
    .map(([key, value]) => `${key} -> ${value}`);
  // Public by design: health, login (validation answers 401 INVALID_CREDENTIALS) and the CSRF token endpoint.
  const unexpectedOpen = open.filter(
    (line) =>
      !/^anonymous GET \/health( |$)|^anonymous GET \/health\/database|^anonymous GET \/auth\/csrf/.test(
        line,
      ),
  );
  if (unexpectedOpen.length)
    console.log(JSON.stringify({ probe: 'permission-open-anonymous', unexpectedOpen }));
  assert.deepEqual(unexpectedOpen, []);
});

test('cross-organization reads: a foreign identifier is 404, an own identifier is 200', async () => {
  const A = ids.a as Record<string, string>;
  const reads: Array<[string, string]> = [
    ['residents', A.resident!],
    ['enquiries', A.enquiry!],
    ['bookings', A.booking!],
    ['admissions', A.admission!],
    ['properties', A.property!],
  ];
  for (const [family, id] of reads) {
    const own = await call(actors.ownerA!, 'GET', `/${family}/${id}`);
    assert.equal(own.status, 200, `own ${family} detail`);
    for (const foreign of ['ownerB', 'pmB'] as const) {
      const res = await call(actors[foreign]!, 'GET', `/${family}/${id}`);
      assert.equal(res.status, 404, `${foreign} reading A's ${family}/${id}`);
    }
  }
  for (const path of [
    `/residents/${A.resident}/stay-summary`,
    `/residents/${A.resident}/history`,
    `/properties/${A.property}/floors`,
    `/properties/${A.property}/rooms`,
    `/rooms/${A.room}/beds`,
  ]) {
    assert.equal((await call(actors.ownerB!, 'GET', path)).status, 404, `ownerB ${path}`);
    assert.equal((await call(actors.pmB!, 'GET', path)).status, 404, `pmB ${path}`);
    assert.equal((await call(actors.ownerA!, 'GET', path)).status, 200, `ownerA ${path}`);
  }
});

test('cross-organization lists never contain the other tenant', async () => {
  for (const [viewer, other] of [
    ['ownerB', ids.a],
    ['ownerA', ids.b],
  ] as const) {
    for (const [path, key] of [
      ['/residents', 'resident'],
      ['/enquiries', 'enquiry'],
      ['/bookings', 'booking'],
      ['/admissions', 'admission'],
      ['/properties', 'property'],
    ] as const) {
      const res = await call(actors[viewer]!, 'GET', path);
      assert.equal(res.status, 200, `${viewer} GET ${path}`);
      assert.ok(
        !JSON.stringify(res.body).includes(other[key]!),
        `${viewer} GET ${path} leaked a foreign ${key}`,
      );
    }
  }
});

test('cross-organization writes are refused and change nothing', async () => {
  const A = ids.a as Record<string, string>;
  const before = async () =>
    (
      await withMigratorClient(async (c) =>
        c.query(
          `SELECT (SELECT count(*) FROM residents WHERE id=$1) r, (SELECT count(*) FROM enquiries WHERE id=$2) e,
                  (SELECT status::text FROM bookings WHERE id=$3) b, (SELECT count(*) FROM admissions WHERE id=$4) a`,
          [A.resident, A.enquiry, A.booking, A.admission],
        ),
      )
    ).rows[0];
  const snapshot = await before();
  for (const path of [
    `/residents/${A.resident}`,
    `/enquiries/${A.enquiry}`,
    `/bookings/${A.booking}`,
    `/admissions/${A.admission}`,
  ]) {
    for (const foreign of ['ownerB', 'pmB'] as const) {
      const res = await call(actors[foreign]!, 'DELETE', path);
      assert.equal(res.status, 404, `${foreign} DELETE ${path}`);
    }
  }
  assert.deepEqual(await before(), snapshot, 'a foreign delete changed data');
});

test('a client-supplied organization id never overrides the session organization', async () => {
  const A = ids.a as Record<string, string>;
  const res = await call(actors.ownerB!, 'GET', `/residents/${A.resident}?organizationId=${A.org}`);
  assert.notEqual(res.status, 200);
  assert.ok(!JSON.stringify(res.body).includes('Perm'));
});
