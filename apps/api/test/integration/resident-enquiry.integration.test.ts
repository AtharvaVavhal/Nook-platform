/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies and pg rows are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { withMigratorClient, withRuntimeClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Regression coverage for the Resident (3.1) and Enquiry (3.2) modules: CRUD, follow-ups, conversion,
// tenant isolation, and the preferred-property ownership rule (migration 20261101210000).
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

let app: any;
let server: ReturnType<typeof request>;
let passwordHash: string;

interface Org {
  orgId: string;
  propertyId: string;
  headers: Record<string, string>;
}

async function newOrg(): Promise<Org> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const propertyId = randomUUID();
  const email = `re-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `ResEnq ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'ResEnq Tester',now())`,
      [userId, email, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
      [randomUUID(), orgId, userId],
    );
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'P',now())`,
      [propertyId, orgId, `P-${propertyId.slice(0, 8)}`],
    );
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
    headers: {
      Origin: ORIGIN,
      Cookie: `${session}; ${csrf}`,
      'x-csrf-token': csrf.slice('nook_csrf='.length),
    },
  };
}

const call = (method: 'get' | 'post' | 'put' | 'delete', org: Org, path: string, body?: object) => {
  const r = (server as any)[method](`/api/v1${path}`).set(org.headers);
  return body === undefined ? r : r.send(body);
};
const count = (sql: string, params: unknown[]) =>
  withMigratorClient(async (c) => Number((await c.query(sql, params)).rows[0].n));

test.before(async () => {
  passwordHash = await hashTestPassword();
  app = await NestFactory.create(AppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
});

test.after(async () => {
  await app.close();
});

// ------------------------------------------------------------------------------------ residents

test('resident: create, read, update, search and paginate within the organization', async () => {
  const org = await newOrg();
  const created = await call('post', org, '/residents', {
    firstName: 'Asha',
    lastName: 'Rao',
    phone: '9000000001',
    email: 'asha@example.com',
  }).expect(201);
  assert.equal(created.body.organizationId, org.orgId);
  assert.equal(created.body.status, 'ACTIVE');
  await call('post', org, '/residents', { firstName: 'Vikram', lastName: 'Singh' }).expect(201);
  const got = await call('get', org, `/residents/${created.body.id}`).expect(200);
  assert.equal(got.body.firstName, 'Asha');
  const found = await call('get', org, '/residents?search=asha').expect(200);
  assert.equal(found.body.items.length, 1);
  const page = await call('get', org, '/residents?limit=1&page=2').expect(200);
  assert.equal(page.body.items.length, 1);
  assert.equal(page.body.total, 2);
  const updated = await call('put', org, `/residents/${created.body.id}`, {
    lastName: 'Rao-Iyer',
    status: 'INACTIVE',
  }).expect(200);
  assert.equal(updated.body.lastName, 'Rao-Iyer');
  assert.equal(updated.body.status, 'INACTIVE');
});

test('resident: another organization cannot read, change, delete or list it, and a body organizationId is ignored', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await call('post', orgA, '/residents', { firstName: 'Meera', lastName: 'Nair' }).expect(
    201,
  );
  await call('get', orgB, `/residents/${a.body.id}`).expect(404);
  await call('put', orgB, `/residents/${a.body.id}`, { firstName: 'Hijacked' }).expect(404);
  await call('delete', orgB, `/residents/${a.body.id}`).expect(404);
  assert.equal((await call('get', orgB, '/residents').expect(200)).body.items.length, 0);
  assert.equal(
    (await call('get', orgB, '/residents?search=meera').expect(200)).body.items.length,
    0,
  );
  const spoof = await call('post', orgB, '/residents', {
    firstName: 'Spoof',
    lastName: 'Try',
    organizationId: orgA.orgId,
  }).expect(201);
  assert.equal(spoof.body.organizationId, orgB.orgId, 'the session decides the organization');
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [orgA.orgId]),
    1,
  );
  const still = await call('get', orgA, `/residents/${a.body.id}`).expect(200);
  assert.equal(still.body.firstName, 'Meera');
});

test('resident: writes require the Origin and CSRF checks', async () => {
  const org = await newOrg();
  const body = { firstName: 'No', lastName: 'Csrf' };
  assert.equal(
    (
      await server
        .post('/api/v1/residents')
        .set('Origin', ORIGIN)
        .set('Cookie', org.headers.Cookie!)
        .send(body)
    ).status,
    403,
  );
  assert.equal(
    (
      await server
        .post('/api/v1/residents')
        .set({ ...org.headers, Origin: 'https://evil.example' })
        .send(body)
    ).status,
    403,
  );
  assert.equal((await server.post('/api/v1/residents').send(body)).status, 401);
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [org.orgId]),
    0,
  );
});

// ------------------------------------------------------------------------------------ enquiries

const enquiryBody = (extra: object = {}) => ({
  firstName: 'Kavya',
  lastName: 'Menon',
  phone: '9000000002',
  ...extra,
});

test('enquiry: create, list/filter, update, archive', async () => {
  const org = await newOrg();
  const e = await call(
    'post',
    org,
    '/enquiries',
    enquiryBody({ preferredPropertyId: org.propertyId, source: 'WALK_IN' }),
  ).expect(201);
  assert.equal(e.body.status, 'NEW');
  assert.equal(e.body.organizationId, org.orgId);
  assert.equal(e.body.propertyId, org.propertyId);
  assert.equal((await call('get', org, '/enquiries').expect(200)).body.items.length, 1);
  const upd = await call('put', org, `/enquiries/${e.body.id}`, {
    status: 'CONTACTED',
    notes: 'Called back',
  }).expect(200);
  assert.equal(upd.body.status, 'CONTACTED');
  assert.equal(upd.body.notes, 'Called back');
  await call('delete', org, `/enquiries/${e.body.id}`).expect(200);
  const archived = await call('get', org, `/enquiries/${e.body.id}`).expect(200);
  assert.equal(archived.body.status, 'ARCHIVED');
});

test('enquiry: follow-ups are recorded with the acting user and listed in order', async () => {
  const org = await newOrg();
  const e = await call('post', org, '/enquiries', enquiryBody()).expect(201);
  await call('post', org, `/enquiries/${e.body.id}/follow-ups`, {
    notes: 'Second call',
    followUpAt: '2026-12-10T10:00:00Z',
  }).expect(201);
  await call('post', org, `/enquiries/${e.body.id}/follow-ups`, {
    notes: 'First call',
    followUpAt: '2026-12-05T10:00:00Z',
    outcome: 'Interested',
  }).expect(201);
  const list = await call('get', org, `/enquiries/${e.body.id}/follow-ups`).expect(200);
  assert.deepEqual(
    list.body.map((f: any) => f.notes),
    ['First call', 'Second call'],
  );
  assert.equal(list.body[0].user.displayName, 'ResEnq Tester');
});

test('enquiry: conversion creates a resident in the same organization exactly once', async () => {
  const org = await newOrg();
  const e = await call('post', org, '/enquiries', enquiryBody()).expect(201);
  const conv = await call('post', org, `/enquiries/${e.body.id}/convert`, {}).expect(201);
  assert.ok(conv.body.resident?.id ?? conv.body.residentId, 'a resident id is returned');
  const row = await withMigratorClient(
    async (c) =>
      (
        await c.query(
          `SELECT e.status, e.resident_id, r.organization_id, r.first_name FROM enquiries e JOIN residents r ON r.id = e.resident_id WHERE e.id = $1`,
          [e.body.id],
        )
      ).rows[0],
  );
  assert.equal(row.status, 'CONVERTED');
  assert.equal(row.organization_id, org.orgId);
  assert.equal(row.first_name, 'Kavya');
  await call('post', org, `/enquiries/${e.body.id}/convert`, {}).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [org.orgId]),
    1,
    'no second resident',
  );
});

test('enquiry: concurrent conversions create exactly one resident', async () => {
  const org = await newOrg();
  const e = await call('post', org, '/enquiries', enquiryBody()).expect(201);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => call('post', org, `/enquiries/${e.body.id}/convert`, {})),
  );
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [org.orgId]),
    1,
  );
});

test('enquiry: another organization cannot read, change, follow up, convert or archive it', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const e = await call('post', orgA, '/enquiries', enquiryBody()).expect(201);
  await call('get', orgB, `/enquiries/${e.body.id}`).expect(404);
  await call('put', orgB, `/enquiries/${e.body.id}`, { notes: 'x' }).expect(404);
  await call('post', orgB, `/enquiries/${e.body.id}/follow-ups`, {
    notes: 'x',
    followUpAt: '2026-12-05T10:00:00Z',
  }).expect(404);
  await call('get', orgB, `/enquiries/${e.body.id}/follow-ups`).expect(404);
  await call('post', orgB, `/enquiries/${e.body.id}/convert`, {}).expect(404);
  await call('delete', orgB, `/enquiries/${e.body.id}`).expect(404);
  assert.equal((await call('get', orgB, '/enquiries').expect(200)).body.items.length, 0);
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [orgA.orgId]),
    0,
  );
  assert.equal((await call('get', orgA, `/enquiries/${e.body.id}`).expect(200)).body.status, 'NEW');
});

test("enquiry: the preferred property must belong to the caller's organization (4xx, nothing stored)", async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  await call(
    'post',
    orgB,
    '/enquiries',
    enquiryBody({ preferredPropertyId: orgA.propertyId }),
  ).expect(404);
  await call('post', orgB, '/enquiries', enquiryBody({ preferredPropertyId: randomUUID() })).expect(
    404,
  );
  await call('post', orgB, '/enquiries', enquiryBody({ preferredPropertyId: 'not-a-uuid' })).expect(
    400,
  );
  assert.equal(
    await count(`SELECT count(*) n FROM enquiries WHERE organization_id = $1`, [orgB.orgId]),
    0,
  );
  const own = await call(
    'post',
    orgB,
    '/enquiries',
    enquiryBody({ preferredPropertyId: orgB.propertyId }),
  ).expect(201);
  await call('put', orgB, `/enquiries/${own.body.id}`, {
    preferredPropertyId: orgA.propertyId,
  }).expect(404);
  await call('put', orgB, `/enquiries/${own.body.id}`, { preferredPropertyId: 'bad' }).expect(400);
  assert.equal(
    (await call('get', orgB, `/enquiries/${own.body.id}`).expect(200)).body.propertyId,
    orgB.propertyId,
    'unchanged',
  );
  const cleared = await call('put', orgB, `/enquiries/${own.body.id}`, {
    preferredPropertyId: null,
  }).expect(200);
  assert.equal(cleared.body.propertyId, null);
});

test('enquiry: the database refuses a property or resident from another organization', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const e = await call('post', orgB, '/enquiries', enquiryBody()).expect(201);
  const resA = await call('post', orgA, '/residents', { firstName: 'A', lastName: 'A' }).expect(
    201,
  );
  await withMigratorClient(async (c) => {
    const reject = (sql: string, params: unknown[], msg: RegExp) =>
      assert.rejects(
        c.query(sql, params),
        (err: any) => err.code === '23514' && msg.test(err.message),
        sql.slice(0, 40),
      );
    await reject(
      `UPDATE enquiries SET property_id = $2 WHERE id = $1`,
      [e.body.id, orgA.propertyId],
      /property must belong/,
    );
    await reject(
      `UPDATE enquiries SET resident_id = $2 WHERE id = $1`,
      [e.body.id, resA.body.id],
      /resident must belong/,
    );
    await reject(
      `INSERT INTO enquiries (organization_id, first_name, last_name, phone, status, source, property_id, updated_at) VALUES ($1,'x','y','1','NEW','OTHER',$2,now())`,
      [orgB.orgId, orgA.propertyId],
      /property must belong/,
    );
    // ON DELETE SET NULL is preserved
    await c.query(`UPDATE enquiries SET property_id = $2 WHERE id = $1`, [
      e.body.id,
      orgB.propertyId,
    ]);
    await c.query(`DELETE FROM properties WHERE id = $1`, [orgB.propertyId]).catch(() => undefined);
  });
});

// ---------------------------------------------------------------------------------------------
// Request-body hardening: mass assignment and the enquiry assignee
// ---------------------------------------------------------------------------------------------

async function addUser(orgId: string, status: 'ACTIVE' | 'REVOKED' = 'ACTIVE'): Promise<string> {
  const userId = randomUUID();
  await withMigratorClient(async (c) => {
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Staff',now())`,
      [userId, `staff-${userId}@nook.test.invalid`, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'PROPERTY_MANAGER',$4)`,
      [randomUUID(), orgId, userId, status],
    );
  });
  return userId;
}
const residentRow = (id: string) =>
  withMigratorClient(
    async (c) => (await c.query(`SELECT * FROM residents WHERE id = $1`, [id])).rows[0],
  );

test('resident: a body can never move a resident to another organization or choose its identity', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const mine = await call('post', orgB, '/residents', {
    firstName: 'Own',
    lastName: 'Resident',
  }).expect(201);
  const before = await residentRow(mine.body.id);
  // update: organizationId / id / timestamps in the body are dropped, allowed fields still apply
  const forged = randomUUID();
  const upd = await call('put', orgB, `/residents/${mine.body.id}`, {
    organizationId: orgA.orgId,
    id: forged,
    createdAt: '2000-01-01T00:00:00Z',
    firstName: 'Renamed',
  }).expect(200);
  assert.equal(upd.body.organizationId, orgB.orgId);
  assert.equal(upd.body.id, mine.body.id);
  const after = await residentRow(mine.body.id);
  assert.equal(after.organization_id, orgB.orgId, "still in the caller's organization");
  assert.equal(after.first_name, 'Renamed');
  assert.deepEqual(after.created_at, before.created_at, 'timestamps cannot be forged');
  assert.equal(await residentRow(forged), undefined, 'no row under the forged id');
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [orgA.orgId]),
    0,
  );
  // create: client-chosen id and unknown fields are ignored too
  const chosen = randomUUID();
  const made = await call('post', orgB, '/residents', {
    id: chosen,
    firstName: 'New',
    lastName: 'One',
    isAdmin: true,
    role: 'OWNER',
  }).expect(201);
  assert.notEqual(made.body.id, chosen);
  assert.equal(made.body.organizationId, orgB.orgId);
});

test('resident: invalid fields are 400 and write nothing', async () => {
  const org = await newOrg();
  const base = await call('post', org, '/residents', {
    firstName: 'Base',
    lastName: 'Line',
  }).expect(201);
  const snapshot = await residentRow(base.body.id);
  for (const bad of [
    { firstName: '' },
    { firstName: 5 },
    { lastName: null },
    { status: 'DELETED' },
    { documentVerificationStatus: 'MAYBE' },
    { dateOfBirth: 'not-a-date' },
    { email: { a: 1 } },
    { documentMetadata: [1] },
    { phone: 'x'.repeat(501) },
  ]) {
    await call('put', org, `/residents/${base.body.id}`, bad).expect(400);
  }
  assert.deepEqual(
    await residentRow(base.body.id),
    snapshot,
    'row untouched by every rejected update',
  );
  await call('post', org, '/residents', { lastName: 'NoFirst' }).expect(400);
  await call('post', org, '/residents', { firstName: 'X', lastName: 'Y', status: 'NOPE' }).expect(
    400,
  );
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [org.orgId]),
    1,
  );
});

test('enquiry conversion: overrides are allow-listed and can never target another organization', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const e = await call('post', orgB, '/enquiries', enquiryBody()).expect(201);
  const forged = randomUUID();
  const conv = await call('post', orgB, `/enquiries/${e.body.id}/convert`, {
    organizationId: orgA.orgId,
    id: forged,
    address: 'Pune',
  }).expect(201);
  const row = await residentRow(conv.body.resident.id);
  assert.equal(row.organization_id, orgB.orgId);
  assert.equal(row.address, 'Pune', 'a legitimate override still applies');
  assert.notEqual(conv.body.resident.id, forged);
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [orgA.orgId]),
    0,
  );
  const e2 = await call('post', orgB, '/enquiries', enquiryBody()).expect(201);
  await call('post', orgB, `/enquiries/${e2.body.id}/convert`, { status: 'BANNED' }).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM residents WHERE organization_id = $1`, [orgB.orgId]),
    1,
    'the rejected conversion created nothing',
  );
  assert.equal(
    (await call('get', orgB, `/enquiries/${e2.body.id}`).expect(200)).body.status,
    'NEW',
  );
});

test('enquiry assignee: only an active member of the same organization can be assigned', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const sameOrg = await addUser(orgB.orgId);
  const otherOrg = await addUser(orgA.orgId);
  const revoked = await addUser(orgB.orgId, 'REVOKED');
  const stranger = randomUUID(); // a user id that exists nowhere
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Nobody',now())`,
      [stranger, `nobody-${stranger}@nook.test.invalid`, passwordHash],
    ),
  );
  // create
  const ok = await call(
    'post',
    orgB,
    '/enquiries',
    enquiryBody({ assignedUserId: sameOrg }),
  ).expect(201);
  assert.equal(ok.body.assignedUserId, sameOrg);
  for (const bad of [otherOrg, revoked, stranger, randomUUID()]) {
    await call('post', orgB, '/enquiries', enquiryBody({ assignedUserId: bad })).expect(404);
  }
  await call('post', orgB, '/enquiries', enquiryBody({ assignedUserId: 'not-a-uuid' })).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM enquiries WHERE organization_id = $1`, [orgB.orgId]),
    1,
    'rejected creates wrote nothing',
  );
  // update
  const free = await call('post', orgB, '/enquiries', enquiryBody()).expect(201);
  const snapshot = (await call('get', orgB, `/enquiries/${free.body.id}`).expect(200)).body;
  for (const bad of [otherOrg, revoked, stranger]) {
    await call('put', orgB, `/enquiries/${free.body.id}`, {
      assignedUserId: bad,
      notes: 'must not apply',
    }).expect(404);
  }
  await call('put', orgB, `/enquiries/${free.body.id}`, { assignedUserId: 'bad' }).expect(400);
  const same = (await call('get', orgB, `/enquiries/${free.body.id}`).expect(200)).body;
  assert.equal(same.assignedUserId, snapshot.assignedUserId);
  assert.equal(
    same.notes,
    snapshot.notes,
    'a rejected update changes nothing, not even other fields',
  );
  const assigned = await call('put', orgB, `/enquiries/${free.body.id}`, {
    assignedUserId: sameOrg,
  }).expect(200);
  assert.equal(assigned.body.assignedUserId, sameOrg);
  const cleared = await call('put', orgB, `/enquiries/${free.body.id}`, {
    assignedUserId: null,
  }).expect(200);
  assert.equal(cleared.body.assignedUserId, null);
});

test("enquiry assignee: the database refuses a user who is not a member of the enquiry's organization", async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const foreign = await addUser(orgA.orgId);
  const e = await call('post', orgB, '/enquiries', enquiryBody()).expect(201);
  await withMigratorClient(async (c) => {
    await assert.rejects(
      c.query(`UPDATE enquiries SET assigned_user_id = $2 WHERE id = $1`, [e.body.id, foreign]),
      (err: any) => err.code === '23514' && /assignee must be a member/.test(err.message),
    );
    await assert.rejects(
      c.query(
        `INSERT INTO enquiries (organization_id, first_name, last_name, phone, status, source, assigned_user_id, updated_at) VALUES ($1,'x','y','1','NEW','OTHER',$2,now())`,
        [orgB.orgId, foreign],
      ),
      (err: any) => err.code === '23514',
    );
  });
  const member = await addUser(orgB.orgId);
  await withMigratorClient((c) =>
    c.query(`UPDATE enquiries SET assigned_user_id = $2 WHERE id = $1`, [e.body.id, member]),
  );
  // revoking the membership later does not block unrelated updates of that enquiry
  await withMigratorClient((c) =>
    c.query(`UPDATE memberships SET status = 'REVOKED' WHERE user_id = $1`, [member]),
  );
  await call('put', orgB, `/enquiries/${e.body.id}`, { notes: 'still editable' }).expect(200);
});

// ------------------------------------------------ deleting a resident archives it (4F.1 follow-up)

test('resident: DELETE archives the resident; the row is kept and still readable', async () => {
  const org = await newOrg();
  const created = await call('post', org, '/residents', {
    firstName: 'Asha',
    lastName: 'Rao',
  }).expect(201);
  assert.equal(created.body.status, 'ACTIVE');
  const archived = await call('delete', org, `/residents/${created.body.id}`).expect(200);
  assert.equal(archived.body.id, created.body.id);
  assert.equal(archived.body.status, 'ARCHIVED');
  assert.equal(await count(`SELECT count(*) n FROM residents WHERE id = $1`, [created.body.id]), 1);
  const reread = await call('get', org, `/residents/${created.body.id}`).expect(200);
  assert.equal(reread.body.status, 'ARCHIVED');
  assert.equal(reread.body.firstName, 'Asha');
  // repeating it is harmless
  await call('delete', org, `/residents/${created.body.id}`).expect(200);
  assert.equal(await count(`SELECT count(*) n FROM residents WHERE id = $1`, [created.body.id]), 1);
  // unknown and malformed ids are still 404 / 400-class, never a database error
  const missing = await call('delete', org, `/residents/${randomUUID()}`);
  assert.equal(missing.status, 404);
});

test('resident: archiving through DELETE leaves the converted enquiry linked to it', async () => {
  const org = await newOrg();
  const enquiry = await call('post', org, '/enquiries', enquiryBody()).expect(201);
  const converted = await call('post', org, `/enquiries/${enquiry.body.id}/convert`, {}).expect(
    201,
  );
  const residentId = converted.body.resident?.id ?? converted.body.residentId;
  assert.ok(residentId, 'conversion returned the resident');
  await call('delete', org, `/residents/${residentId}`).expect(200);
  const link = await withMigratorClient((c) =>
    c.query(`SELECT resident_id FROM enquiries WHERE id = $1`, [enquiry.body.id]),
  );
  assert.equal(
    link.rows[0].resident_id,
    residentId,
    'the enquiry keeps its link (no ON DELETE SET NULL)',
  );
});

test('resident: the runtime database role cannot hard-delete a resident at all', async () => {
  const org = await newOrg();
  const created = await call('post', org, '/residents', {
    firstName: 'Dev',
    lastName: 'Patel',
  }).expect(201);
  await withRuntimeClient(async (c) => {
    await assert.rejects(
      c.query(`DELETE FROM residents WHERE id = $1`, [created.body.id]),
      (e: any) => e.code === '42501',
    );
  });
  assert.equal(await count(`SELECT count(*) n FROM residents WHERE id = $1`, [created.body.id]), 1);
});

// ------------------------------------------------------------------ input validation (P0 #1)

test('enquiry create: invalid input is a 400 with the field named, and nothing is stored', async () => {
  const org = await newOrg();
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['no first name', { firstName: undefined }, /firstName/],
    ['first name not text', { firstName: 42 }, /firstName/],
    ['blank last name', { lastName: '   ' }, /lastName/],
    ['name too long', { lastName: 'x'.repeat(101) }, /lastName/],
    ['no phone', { phone: undefined }, /phone/],
    ['phone too short', { phone: '12' }, /phone/],
    ['phone with letters', { phone: 'call me' }, /phone/],
    ['phone markup', { phone: '<script>1' }, /phone/],
    ['phone number type', { phone: 9000000002 }, /phone/],
    ['bad e-mail', { email: 'nope' }, /email/],
    ['unknown source', { source: 'FLYER' }, /source/],
    ['zero stay', { expectedDurationOfStay: 0 }, /expectedDurationOfStay/],
    ['fractional stay', { expectedDurationOfStay: 1.5 }, /expectedDurationOfStay/],
    ['too many occupants', { numberOfOccupants: 21 }, /numberOfOccupants/],
    ['garbage move-in date', { expectedMoveInDate: 'soon' }, /expectedMoveInDate/],
    ['notes too long', { notes: 'x'.repeat(2001) }, /notes/],
  ];
  for (const [label, over, field] of cases) {
    const res = await call('post', org, '/enquiries', enquiryBody(over));
    assert.equal(res.status, 400, `${label} answered ${res.status}`);
    assert.match(String(res.body.message), field, label);
  }
  for (const raw of ['null', '[]', '"x"', '5']) {
    const res = await (server as any)
      .post('/api/v1/enquiries')
      .set(org.headers)
      .set('Content-Type', 'application/json')
      .send(raw);
    assert.equal(res.status, 400, `body ${raw} answered ${res.status}`);
  }
  assert.equal(
    await count(`SELECT count(*) n FROM enquiries WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  const ok = await call(
    'post',
    org,
    '/enquiries',
    enquiryBody({
      phone: '+91 98765 43210',
      email: 'kavya@example.in',
      expectedMoveInDate: '2027-01-15',
    }),
  ).expect(201);
  assert.equal(ok.body.status, 'NEW');
  assert.equal(ok.body.source, 'OTHER');
});

test('enquiry update: CONVERTED and ARCHIVED cannot be forced, a converted enquiry keeps its status', async () => {
  const org = await newOrg();
  const e = await call('post', org, '/enquiries', enquiryBody()).expect(201);
  const id = e.body.id as string;
  for (const body of [
    { status: 'CONVERTED' },
    { status: 'ARCHIVED' },
    { status: 'MAYBE' },
    { firstName: '' },
    { phone: 'x' },
    { email: 'nope' },
    { numberOfOccupants: 0 },
    { expectedMoveInDate: 'x' },
  ]) {
    const res = await call('put', org, `/enquiries/${id}`, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} answered ${res.status}`);
  }
  assert.equal((await call('get', org, `/enquiries/${id}`).expect(200)).body.status, 'NEW');
  await call('put', org, `/enquiries/${id}`, { status: 'LOST', email: null }).expect(200);

  const converted = await call('post', org, '/enquiries', enquiryBody()).expect(201);
  await call('post', org, `/enquiries/${converted.body.id}/convert`, {}).expect(201);
  const res = await call('put', org, `/enquiries/${converted.body.id}`, { status: 'NEW' });
  assert.equal(res.status, 409);
  await call('put', org, `/enquiries/${converted.body.id}`, { notes: 'still editable' }).expect(
    200,
  );
});

test('enquiry follow-ups, convert body and queries: bad input is 400, not 500', async () => {
  const org = await newOrg();
  const e = await call('post', org, '/enquiries', enquiryBody()).expect(201);
  const id = e.body.id as string;
  for (const body of [
    {},
    { notes: 'x' },
    { followUpAt: '2026-12-10T10:00:00Z' },
    { notes: 'x', followUpAt: 'later' },
    { notes: 5, followUpAt: '2026-12-10T10:00:00Z' },
    { notes: 'x', followUpAt: '2026-12-10T10:00:00Z', outcome: 'y'.repeat(501) },
  ]) {
    const res = await call('post', org, `/enquiries/${id}/follow-ups`, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} answered ${res.status}`);
  }
  assert.equal(
    await count(`SELECT count(*) n FROM enquiry_follow_ups WHERE enquiry_id = $1`, [id]),
    0,
  );
  for (const raw of ['[]', '"x"', '5']) {
    const res = await (server as any)
      .post(`/api/v1/enquiries/${id}/convert`)
      .set(org.headers)
      .set('Content-Type', 'application/json')
      .send(raw);
    assert.equal(res.status, 400, `convert body ${raw} answered ${res.status}`);
  }
  assert.equal((await call('get', org, `/enquiries/${id}`).expect(200)).body.status, 'NEW');

  for (const path of [
    '/enquiries?status=NOPE',
    '/enquiries?source=NOPE',
    '/enquiries?propertyId=abc',
    '/enquiries?fromDate=abc',
    '/enquiries?fromDate=2026-02-01&toDate=2026-01-01',
    '/enquiries?status=NEW&status=LOST',
    '/enquiries/not-a-uuid',
    `/enquiries/${id}/follow-ups?x=1`.replace(`/${id}`, '/not-a-uuid'),
    '/enquiries/follow-ups/upcoming?days=0',
    '/enquiries/follow-ups/upcoming?days=abc',
    '/enquiries/follow-ups/upcoming?days=366',
  ]) {
    const res = await call('get', org, path);
    assert.equal(res.status, 400, `${path} answered ${res.status}`);
  }
  await call('put', org, '/enquiries/not-a-uuid', {}).expect(400);
  await call('delete', org, '/enquiries/not-a-uuid').expect(400);
  await call('post', org, '/enquiries/not-a-uuid/convert', {}).expect(400);
  await call('get', org, '/enquiries/follow-ups/upcoming?days=30').expect(200);
  await call('get', org, '/enquiries/follow-ups/overdue').expect(200);
});
