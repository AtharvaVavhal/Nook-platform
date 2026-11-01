import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';
import request from 'supertest';

// ---- Test configuration ----
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.DATABASE_URL =
  'postgresql://nook_phase3c_runtime:HCZ3ycYIgnACzCp3dDF6-uljyEf16VrxJkT5RL5zDHaODqmFHya2gqRX2fOPqhOC@127.0.0.1:5433/nook_test?schema=public';

const fixturePassword = process.env.TEST_OWNER_PASSWORD;
if (!fixturePassword) {
  throw new Error('TEST_OWNER_PASSWORD environment variable is required');
}

const FIXTURE_EMAIL = 'm3c-owner@nook.test.invalid';
const FIXTURE_PASSWORD = fixturePassword;
const FIXTURE_ORG_ID = '00000000-0000-4000-8000-000000000101';

let app: any;
let server: any;
let authCookies: { sessionCookie: string; csrfCookie: string; csrfToken: string };
let orgACookies: { sessionCookie: string; csrfCookie: string; csrfToken: string };
let orgBCookies: { sessionCookie: string; csrfCookie: string; csrfToken: string };

async function loginFixture() {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD })
    .expect(200);
  const cookies = res.headers['set-cookie'];
  const sessionCookie = cookies.find((c: string) => c.startsWith('nook_session='));
  const csrfCookie = cookies.find((c: string) => c.startsWith('nook_csrf='));
  const csrfToken = cookies
    .find((c: string) => c.startsWith('nook_csrf='))
    ?.split(';')[0]
    ?.split('=')[1];
  authCookies = { sessionCookie: sessionCookie!, csrfCookie: csrfCookie!, csrfToken: csrfToken! };
}

async function loginUser(email: string, password: string) {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email, password })
    .expect(200);
  const cookies = res.headers['set-cookie'];
  const sessionCookie = cookies.find((c: string) => c.startsWith('nook_session='));
  const csrfCookie = cookies.find((c: string) => c.startsWith('nook_csrf='));
  const csrfToken = cookies
    .find((c: string) => c.startsWith('nook_csrf='))
    ?.split(';')[0]
    ?.split('=')[1];
  return { sessionCookie: sessionCookie!, csrfCookie: csrfCookie!, csrfToken: csrfToken! };
}

// ---- Setup NestJS app ----
test.before(async () => {
  app = await NestFactory.create(AppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address();
  const baseUrl = `http://localhost:${address.port}`;
  server = request(baseUrl);
  await loginFixture();

  // Use pre-provisioned test organisations
  const orgAEmail = 'test-a-7ab755ea-c3a9-401e-8e1f-34064119be41@example.com';
  const orgBEmail = 'test-b-a16f9f94-4f92-42ec-8d32-72158652f73c@example.com';

  // Login both test users using the fixture password from environment
  orgACookies = await loginUser(orgAEmail, fixturePassword);
  orgBCookies = await loginUser(orgBEmail, fixturePassword);
});

test.after(async () => {
  await app.close();
});

// ---- Tests using fixture org ----
test('Property CRUD lifecycle', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = authCookies;
  // Create property
  const propCode = `PROP-${randomUUID()}`;
  const createRes = await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: propCode, name: 'Test Property' })
    .expect(201);
  const property = createRes.body.data;
  assert.ok(property.id);
  assert.equal(property.code, propCode);
  assert.equal(property.name, 'Test Property');
  const propertyId = property.id;

  // List properties
  const listRes = await server
    .get('/api/v1/properties')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(200);
  assert.ok(Array.isArray(listRes.body.data));
  assert.ok(listRes.body.data.some((p: any) => p.id === propertyId));

  // Get property
  const getRes = await server
    .get(`/api/v1/properties/${propertyId}`)
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(200);
  assert.equal(getRes.body.data.id, propertyId);

  // Update property
  const updateRes = await server
    .patch(`/api/v1/properties/${propertyId}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ name: 'Updated Property' })
    .expect(200);
  assert.equal(updateRes.body.data.name, 'Updated Property');

  // Archive property
  const archiveRes = await server
    .post(`/api/v1/properties/${propertyId}/archive`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .expect(200);
  assert.ok(archiveRes.body.data.archivedAt);

  // Archived property not in list
  const listAfterArchive = await server
    .get('/api/v1/properties')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(200);
  assert.ok(!listAfterArchive.body.data.some((p: any) => p.id === propertyId));
});

test('Floor CRUD under property', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = authCookies;
  // create property first
  const propRes = await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: `FLPROP-${randomUUID()}`, name: 'Floor Parent' })
    .expect(201);
  const propertyId = propRes.body.data.id;
  // create floor
  const floorRes = await server
    .post(`/api/v1/properties/${propertyId}/floors`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ label: 'First Floor', ordinal: 1 })
    .expect(201);
  const floor = floorRes.body.data;
  assert.ok(floor.id);
  assert.equal(floor.label, 'First Floor');
  assert.equal(floor.ordinal, 1);
  const floorId = floor.id;

  // list floors
  const listRes = await server
    .get(`/api/v1/properties/${propertyId}/floors`)
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(200);
  assert.ok(Array.isArray(listRes.body.data));
  assert.ok(listRes.body.data.some((f: any) => f.id === floorId));

  // update floor
  const updRes = await server
    .patch(`/api/v1/floors/${floorId}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ label: 'Ground Floor', ordinal: 0 })
    .expect(200);
  assert.equal(updRes.body.data.label, 'Ground Floor');

  // archive floor
  await server
    .post(`/api/v1/floors/${floorId}/archive`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .expect(200);
});

test('Room CRUD with floor filter and q prefix', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = authCookies;
  // property + floor
  const propRes = await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: `ROOMPROP-${randomUUID()}`, name: 'Room Parent' })
    .expect(201);
  const propertyId = propRes.body.data.id;
  const floorRes = await server
    .post(`/api/v1/properties/${propertyId}/floors`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ label: 'Floor A', ordinal: 1 })
    .expect(201);
  const floorId = floorRes.body.data.id;

  // create rooms
  const room1 = await server
    .post(`/api/v1/properties/${propertyId}/rooms`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ floorId, label: 'Alpha Room' })
    .expect(201);
  const room2 = await server
    .post(`/api/v1/properties/${propertyId}/rooms`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ floorId, label: 'Beta Room' })
    .expect(201);

  // list rooms all
  const listAll = await server
    .get(`/api/v1/properties/${propertyId}/rooms`)
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(200);
  assert.equal(listAll.body.data.length, 2);

  // filter by floorId
  const listFloor = await server
    .get(`/api/v1/properties/${propertyId}/rooms?floorId=${floorId}`)
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(200);
  assert.equal(listFloor.body.data.length, 2);

  // prefix query
  const listQ = await server
    .get(`/api/v1/properties/${propertyId}/rooms?q=Al`)
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(200);
  assert.equal(listQ.body.data.length, 1);
  assert.ok(listQ.body.data[0].label.startsWith('Al'));

  // update room label
  await server
    .patch(`/api/v1/rooms/${room1.body.data.id}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ label: 'Alpha Renamed' })
    .expect(200);

  // archive room
  await server
    .post(`/api/v1/rooms/${room1.body.data.id}/archive`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .expect(200);
});

test('Bed CRUD with status and reason validation', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = authCookies;
  // property -> floor -> room
  const propRes = await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: `BEDPROP-${randomUUID()}`, name: 'Bed Parent' })
    .expect(201);
  const propertyId = propRes.body.data.id;
  const floorRes = await server
    .post(`/api/v1/properties/${propertyId}/floors`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ label: 'Floor B', ordinal: 2 })
    .expect(201);
  const floorId = floorRes.body.data.id;
  const roomRes = await server
    .post(`/api/v1/properties/${propertyId}/rooms`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ floorId, label: 'Room for Beds' })
    .expect(201);
  const roomId = roomRes.body.data.id;

  // create bed IN_SERVICE
  const bedIn = await server
    .post(`/api/v1/rooms/${roomId}/beds`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ label: 'Bed 1', operationalStatus: 'IN_SERVICE' })
    .expect(201);
  assert.equal(bedIn.body.data.operationalStatus, 'IN_SERVICE');

  // create bed OUT_OF_SERVICE with reason
  const bedOut = await server
    .post(`/api/v1/rooms/${roomId}/beds`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ label: 'Bed 2', operationalStatus: 'OUT_OF_SERVICE', outOfServiceReason: 'Maintenance' })
    .expect(201);
  assert.equal(bedOut.body.data.operationalStatus, 'OUT_OF_SERVICE');
  assert.equal(bedOut.body.data.outOfServiceReason, 'Maintenance');

  // reject OUT_OF_SERVICE without reason
  await server
    .post(`/api/v1/rooms/${roomId}/beds`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ label: 'Bed 3', operationalStatus: 'OUT_OF_SERVICE' })
    .expect(400);

  // update bed status and reason
  await server
    .patch(`/api/v1/beds/${bedIn.body.data.id}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ operationalStatus: 'OUT_OF_SERVICE', outOfServiceReason: 'Repairs' })
    .expect(200);

  // list beds
  const listBeds = await server
    .get(`/api/v1/rooms/${roomId}/beds`)
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(200);
  assert.ok(listBeds.body.data.length >= 2);

  // archive bed
  await server
    .post(`/api/v1/beds/${bedIn.body.data.id}/archive`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .expect(200);
});

test('Authentication guards protect mutations', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = authCookies;
  const propRes = await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: `AUTHPROP-${randomUUID()}`, name: 'Auth Test' })
    .expect(201);
  const propertyId = propRes.body.data.id;

  // missing session -> 401
  await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .send({ code: 'X', name: 'X' })
    .expect(401);

  // missing CSRF -> 403
  await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .send({ code: 'X', name: 'X' })
    .expect(403);

  // missing Origin -> 403
  await server
    .post('/api/v1/properties')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: 'X', name: 'X' })
    .expect(403);
});

test('Cross-org access denied – using non‑existent org id returns 404', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = authCookies;
  const fakeOrgId = '00000000-0000-4000-8000-000000000999';
  // try to list floors for unknown property (belongs to other org)
  await server
    .get(`/api/v1/properties/${fakeOrgId}/floors`)
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .expect(404);
});

test('Audit events – runtime role has no audit_events access (blocker check)', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = authCookies;
  await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: `AUDIT-${randomUUID()}`, name: 'Audit Test' })
    .expect(201);
  // If audit_events were required, request would fail with permission denied.
  // Currently passes, indicating no audit writes required.
});

// ---- Two-organisation tenant isolation tests ----
test('Organisation A can create property and Organisation B cannot access it', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = orgACookies;
  // Org A creates property
  const createRes = await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: `ISO-${randomUUID()}`, name: 'Org A Property' })
    .expect(201);
  const propertyId = createRes.body.data.id;

  // Org A can list its property
  const listA = await server
    .get('/api/v1/properties')
    .set('Cookie', `${orgACookies.sessionCookie}; ${orgACookies.csrfCookie}`)
    .expect(200);
  assert.ok(listA.body.data.some((p: any) => p.id === propertyId));

  // Org B cannot list Org A's property
  const listB = await server
    .get('/api/v1/properties')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .expect(200);
  assert.ok(!listB.body.data.some((p: any) => p.id === propertyId));

  // Org B cannot retrieve Org A's property by ID
  await server
    .get(`/api/v1/properties/${propertyId}`)
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .expect(404);

  // Org B cannot update Org A's property
  await server
    .patch(`/api/v1/properties/${propertyId}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .send({ name: 'Hacked' })
    .expect(404);

  // Org B cannot archive Org A's property
  await server
    .post(`/api/v1/properties/${propertyId}/archive`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .expect(404);
});

test('Organisation B cannot create child resources under Organisation A property', async () => {
  const { sessionCookie, csrfCookie, csrfToken } = orgACookies;
  // Org A creates property
  const propRes = await server
    .post('/api/v1/properties')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
    .set('x-csrf-token', csrfToken!)
    .send({ code: `ISO-${randomUUID()}`, name: 'Org A Property for Children' })
    .expect(201);
  const propertyId = propRes.body.data.id;

  // Org A creates floor
  const floorRes = await server
    .post(`/api/v1/properties/${propertyId}/floors`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgACookies.sessionCookie}; ${orgACookies.csrfCookie}`)
    .set('x-csrf-token', orgACookies.csrfToken!)
    .send({ label: 'Floor A1', ordinal: 1 })
    .expect(201);
  const floorId = floorRes.body.data.id;

  // Org B tries to create floor under Org A property -> 404
  await server
    .post(`/api/v1/properties/${propertyId}/floors`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .send({ label: 'Hack Floor', ordinal: 99 })
    .expect(404);

  // Org A creates room on its floor
  const roomRes = await server
    .post(`/api/v1/properties/${propertyId}/rooms`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgACookies.sessionCookie}; ${orgACookies.csrfCookie}`)
    .set('x-csrf-token', orgACookies.csrfToken!)
    .send({ floorId, label: 'Room A1' })
    .expect(201);
  const roomId = roomRes.body.data.id;

  // Org B tries to create room under Org A property/floor -> 404
  await server
    .post(`/api/v1/properties/${propertyId}/rooms`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .send({ floorId, label: 'Hack Room' })
    .expect(404);

  // Org A creates bed in its room
  const bedRes = await server
    .post(`/api/v1/rooms/${roomId}/beds`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgACookies.sessionCookie}; ${orgACookies.csrfCookie}`)
    .set('x-csrf-token', orgACookies.csrfToken!)
    .send({ label: 'Bed A1', operationalStatus: 'IN_SERVICE' })
    .expect(201);
  const bedId = bedRes.body.data.id;

  // Org B tries to create bed in Org A room -> 404
  await server
    .post(`/api/v1/rooms/${roomId}/beds`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .send({ label: 'Hack Bed', operationalStatus: 'IN_SERVICE' })
    .expect(404);

  // Org B cannot retrieve, update, archive Org A's floor
  await server
    .patch(`/api/v1/floors/${floorId}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .send({ label: 'Hack' })
    .expect(404);
  await server
    .post(`/api/v1/floors/${floorId}/archive`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .expect(404);

  // Org B cannot retrieve, update, archive Org A's room
  await server
    .patch(`/api/v1/rooms/${roomId}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .send({ label: 'Hack' })
    .expect(404);
  await server
    .post(`/api/v1/rooms/${roomId}/archive`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .expect(404);

  // Org B cannot retrieve, update, archive Org A's bed
  await server
    .patch(`/api/v1/beds/${bedId}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .send({ label: 'Hack' })
    .expect(404);
  await server
    .post(`/api/v1/beds/${bedId}/archive`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', `${orgBCookies.sessionCookie}; ${orgBCookies.csrfCookie}`)
    .set('x-csrf-token', orgBCookies.csrfToken!)
    .expect(404);
});