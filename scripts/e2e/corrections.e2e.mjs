/**
 * Browser-level acceptance for P4-2 corrections (real Chrome, real Vite web app, real Nest API, real PostgreSQL).
 *
 * Usage (disposable database only; see docs in the final report):
 *   node --import tsx scripts/e2e/corrections.e2e.mjs
 * Environment:
 *   E2E_MIGRATOR_URL, E2E_RUNTIME_URL   disposable database URLs on 127.0.0.1, database name nook_integration_*
 *   TEST_OWNER_PASSWORD                 password given to the generated users (never printed)
 *   NOOK_BROWSER_MODULE                 absolute path of an externally provisioned puppeteer-core (not a repo dependency)
 *   NOOK_BROWSER_EXECUTABLE             Chrome/Chromium binary
 * CORRECTIONS_FINANCIAL_APPLY_ENABLED is deliberately NOT set: the API under test runs with the shipped default (OFF).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { hashTestPassword, TEST_PASSWORD } from '../../apps/api/test/integration/helpers/fixtures.ts';
import { assertHistory, assertForeignHistory, assertCurrentValue, assertUiState, apiServerError, assertNoServerErrors } from './e6-assertions.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.NOOK_BROWSER_MODULE ?? 'puppeteer-core');
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3199);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5199);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const SHOTS = resolve(process.env.E2E_ARTIFACTS ?? '/tmp/nook-p42-e2e');
mkdirSync(SHOTS, { recursive: true });

// ----------------------------------------------------------------------------------------------- safety
function checkUrl(name, raw) {
  const url = new URL(raw ?? '');
  assert.equal(url.hostname, '127.0.0.1', `${name} must be a local disposable database`);
  assert.ok(url.port && !['5432', '5433'].includes(url.port), `${name} must use a dedicated port`);
  assert.match(url.pathname.slice(1), /^nook_integration_/, `${name} must name a disposable database`);
  return raw;
}
const MIGRATOR = checkUrl('E2E_MIGRATOR_URL', process.env.E2E_MIGRATOR_URL);
const RUNTIME = checkUrl('E2E_RUNTIME_URL', process.env.E2E_RUNTIME_URL);
assert.notEqual(MIGRATOR, RUNTIME);

const admin = new pg.Client({ connectionString: MIGRATOR });
await admin.connect();
const marker = await admin.query(`SELECT shobj_description(oid, 'pg_database') c FROM pg_database WHERE datname = current_database()`);
assert.match(marker.rows[0].c ?? '', /nook-integration-isolated: disposable/, 'database marker comment');
const q = async (sql, params = []) => (await admin.query(sql, params)).rows;

// -------------------------------------------------------------------------------------------------- seed
const hash = await hashTestPassword();
async function seedOrg(label) {
  const orgId = randomUUID();
  const people = ['OWNER', 'OWNER', 'PROPERTY_MANAGER', 'PROPERTY_MANAGER'].map((role, i) => ({
    role,
    userId: randomUUID(),
    email: `e2e-${label}-${i}-${randomUUID().slice(0, 8)}@nook.test.invalid`,
    name: `${role === 'OWNER' ? 'Owner' : 'Manager'} ${label}${i}`,
  }));
  const ids = { property: randomUUID(), floor: randomUUID(), room: randomUUID(), bed: randomUUID() };
  await q('BEGIN');
  await q(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [orgId, `E2E ${label}`]);
  for (const p of people) {
    await q(`INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,$4,now())`, [p.userId, p.email, hash, p.name]);
    await q(`INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`, [randomUUID(), orgId, p.userId, p.role]);
  }
  await q(`INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'Main',now())`, [ids.property, orgId, `P-${ids.property.slice(0, 8)}`]);
  await q(`INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`, [ids.floor, orgId, ids.property]);
  await q(`INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R',now())`, [ids.room, orgId, ids.property, ids.floor]);
  await q(`INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,'B1',now())`, [ids.bed, orgId, ids.property, ids.room]);
  await q('COMMIT');
  const [owner, owner2, pm, pm2] = people;
  return { orgId, bedId: ids.bed, owner, owner2, pm, pm2 };
}
async function addResident(orgId, first, last) {
  const id = randomUUID();
  await q(`INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,$3,$4,now())`, [id, orgId, first, last]);
  return id;
}

const A = await seedOrg('a');
const B = await seedOrg('b');
const bPrivateResident = await addResident(B.orgId, 'Hidden', 'Tenant');

// ------------------------------------------------------------------------------------------- processes
const children = [];
function start(name, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  child.on('exit', (code) => log.push(`[exit ${code}]`));
  children.push({ name, child, log });
  return { child, log };
}
async function waitFor(url, label, ms = 90_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > ms) throw new Error(`${label} did not start`);
    await new Promise((r) => setTimeout(r, 400));
  }
}
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CHECKPOINT_DISABLE: '1', DOTENV_CONFIG_PATH: '/dev/null', NOOK_ISOLATED_TEST_RUN: '1' };
start('api', process.execPath, ['--import', 'tsx', 'src/main.ts'], resolve(ROOT, 'apps/api'), {
  ...baseEnv,
  TSX_TSCONFIG_PATH: resolve(ROOT, 'apps/api/tsconfig.json'),
  APP_ENV: 'test',
  PORT: String(API_PORT),
  WEB_ORIGIN: WEB,
  DATABASE_URL: RUNTIME,
  CORRECTION_RECEIPT_SECRET: randomUUID() + randomUUID(),
  // CORRECTIONS_FINANCIAL_APPLY_ENABLED intentionally absent: shipped default.
});
start('web', process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(WEB_PORT)], resolve(ROOT, 'apps/web'), {
  ...baseEnv,
  VITE_API_BASE: `${API}/api/v1`,
});

async function shutdown() {
  for (const { child } of children) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL');
}

// --------------------------------------------------------------------------------------- API helpers
const jar = new Map();
async function apiLogin(user) {
  const res = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: WEB }, body: JSON.stringify({ email: user.email, password: TEST_PASSWORD }) });
  assert.equal(res.status, 200, `login ${user.name}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  const csrf = cookies.find((c) => c.startsWith('nook_csrf=')).slice('nook_csrf='.length);
  jar.set(user.userId, { cookie: cookies.join('; '), csrf });
}
async function apiPost(user, path, body, key = randomUUID()) {
  if (!jar.has(user.userId)) await apiLogin(user);
  const s = jar.get(user.userId);
  const res = await fetch(`${API}/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: WEB, cookie: s.cookie, 'x-csrf-token': s.csrf, 'idempotency-key': key }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const nameProposal = (residentId, value, field = 'firstName') => ({ targetType: 'RESIDENT', targetId: residentId, fieldKey: field, proposedValue: value, reason: 'Misspelled at registration', effectiveAt: new Date().toISOString() });

// ------------------------------------------------------------------------------------------ browser DSL
let browser;
const results = [];
async function newSession(user) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
  if (user) await signIn(page, user);
  return page;
}
async function signIn(page, user) {
  await page.waitForSelector('#login-email');
  await page.type('#login-email', user.email);
  await page.type('#login-password', TEST_PASSWORD);
  await Promise.all([page.waitForSelector('#login-email', { hidden: true }), page.keyboard.press('Enter')]);
}
const go = async (page, hash) => {
  // Navigate the actual URL; do not simulate a hashchange event.
  await page.goto(`${WEB}/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expected) => window.location.hash === expected, {}, hash);
};
const textOf = (page) => page.evaluate(() => document.body.innerText);
async function until(page, predicate, label, ms = 15_000) {
  const t0 = Date.now();
  for (;;) {
    const text = await textOf(page);
    if (predicate(text)) return text;
    if (Date.now() - t0 > ms) {
      if (process.env.NOOK_E2E_SANITIZED !== '1') await page.screenshot({ path: `${SHOTS}/FAIL-${label.replace(/\W+/g, '-')}.png` });
      throw new Error(`timeout waiting for: ${label}\n--- page text ---\n${text.slice(0, 1500)}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}
const field = async (page, label) => {
  const handle = await page.waitForSelector(`xpath/.//label[contains(@class,'fin-field')][span[contains(normalize-space(.), "${label}")]]//*[self::input or self::select or self::textarea]`, { timeout: 10_000 });
  assert.ok(handle, `field ${label}`);
  return handle;
};
async function fill(page, label, value) {
  const el = await field(page, label);
  await el.click({ clickCount: 3 });
  await el.type(value);
}
async function pick(page, label, value) {
  const el = await field(page, label);
  await el.select(value);
}
async function click(page, label) {
  for (const tag of ['button', 'a']) {
    for (const handle of await page.$$(`xpath/.//${tag}[normalize-space()="${label}"]`)) {
      if (await handle.isVisible()) { await handle.click(); return; }
    }
  }
  throw new Error(`No visible action: ${label}`);
}
async function hasButton(page, label) {
  return (await page.$$(`xpath/.//button[normalize-space()="${label}"]`)).length > 0;
}
async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`PASS  ${name} (${Date.now() - t0} ms)`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(error?.stack ?? error).slice(0, 1800) });
    console.log(`FAIL  ${name}\n${String(error?.stack ?? error).slice(0, 1800)}`);
  }
}
const proposalStatus = async (id) => (await q(`SELECT status FROM correction_proposals WHERE id = $1`, [id]))[0]?.status;

// ------------------------------------------------------------------------------------------------ run
try {
  await Promise.all([waitFor(`${API}/api/v1/health`, 'api'), waitFor(`${WEB}/`, 'web')]);
  browser = await puppeteer.launch({ executablePath: process.env.NOOK_BROWSER_EXECUTABLE, headless: true });

  browser.process()?.once('exit', (code, signal) => console.log(`Chrome exited: code=${code} signal=${signal}`));

  const r1 = await addResident(A.orgId, 'Arahv', 'Shah');
  let submittedId;

  await scenario('E1 request submission: the form creates a PENDING proposal and shows before/after without changing the record', async () => {
    const page = await newSession(A.pm);
    await go(page, '#corrections/new');
    await until(page, (t) => t.includes('Request a correction'), 'new form');
    await fill(page, 'Record id', r1);
    await fill(page, 'Corrected value', 'Aarav');
    await fill(page, 'Why is this needed?', 'Misspelled at registration');
    await click(page, 'Submit correction');
    const text = await until(page, (t) => t.includes('Pending review') && t.toLowerCase().includes('current value when proposed'), 'detail after submit');
    assert.match(text, /Arahv/);
    assert.match(text, /Aarav/);
    assert.match(text, /still shows the current value until it is approved/);
    const row = (await q(`SELECT id, status, requested_by, financial_impact FROM correction_proposals WHERE resident_target_id = $1`, [r1]))[0];
    assert.equal(row.status, 'PENDING');
    assert.equal(row.requested_by, A.pm.userId);
    assert.equal(row.financial_impact, false);
    assert.equal((await q(`SELECT first_name FROM residents WHERE id = $1`, [r1]))[0].first_name, 'Arahv', 'record unchanged before approval');
    submittedId = row.id;
    // client-side validation: empty reason is refused before any request
    await go(page, '#corrections/new');
    await fill(page, 'Record id', r1);
    await fill(page, 'Corrected value', 'Zed');
    await click(page, 'Submit correction');
    await until(page, (t) => t.includes('Explain why this correction is needed.'), 'validation message');
    assert.equal((await q(`SELECT count(*)::int n FROM correction_proposals WHERE organization_id = $1`, [A.orgId]))[0].n, 1);
    assert.deepEqual(page.errors, []);
    await page.browserContext().close();
  });

  await scenario('E2 queue filters and pagination: 22 pending items span two pages; filters narrow the list', async () => {
    for (let i = 0; i < 22; i += 1) {
      const id = await addResident(A.orgId, `Page${String(i).padStart(2, '0')}`, 'Queue');
      const res = await apiPost(A.pm2, '/corrections', nameProposal(id, `Fixed${i}`));
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }
    const page = await newSession(A.owner);
    await go(page, '#corrections');
    await until(page, (t) => t.includes('Page 1 of 2'), 'page 1 of 2');
    assert.equal((await page.$$('table.fin-table tbody tr')).length, 20);
    await click(page, 'Next');
    await until(page, (t) => t.includes('Page 2 of 2'), 'page 2 of 2');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
    assert.equal((await page.$$('table.fin-table tbody tr')).length, 3, '23 pending in total');
    await pick(page, 'Status', 'APPLIED');
    await until(page, (t) => t.includes('No corrections'), 'applied filter empty');
    await pick(page, 'Status', 'PENDING');
    await pick(page, 'Record type', 'BOOKING');
    await until(page, (t) => t.includes('No corrections'), 'booking filter empty');
    await pick(page, 'Record type', 'RESIDENT');
    await pick(page, 'Needs owner', 'true');
    await until(page, (t) => t.includes('No corrections'), 'financial-only filter empty (all are name fixes)');
    await pick(page, 'Needs owner', 'false');
    await until(page, (t) => t.includes('Page 1 of 2'), 'non-financial filter restores two pages');
    assert.deepEqual(page.errors, []);
    await page.browserContext().close();
  });

  await scenario('E3 protected detail: reviewers see exact before/after, reason and requester; anonymous visitors see nothing', async () => {
    const page = await newSession(A.owner);
    await go(page, `#corrections/${submittedId}`);
    const text = await until(page, (t) => t.toLowerCase().includes('current value when proposed'), 'detail');
    for (const needle of ['Arahv', 'Aarav', 'Misspelled at registration', A.pm.name, 'Review this correction']) assert.ok(text.includes(needle), needle);
    await page.browserContext().close();
    const anon = await newSession(null);
    await go(anon, `#corrections/${submittedId}`);
    await until(anon, (t) => t.includes('Sign in') || t.toLowerCase().includes('password'), 'login page for anonymous');
    const body = await textOf(anon);
    assert.ok(!body.includes('Aarav') && !body.includes('Arahv'), 'no correction data without a session');
    await anon.browserContext().close();
  });

  await scenario('E4 approval and rejection: an independent reviewer applies one correction and rejects another', async () => {
    const r2 = await addResident(A.orgId, 'Reject', 'Me');
    const rej = await apiPost(A.pm, '/corrections', nameProposal(r2, 'Rejected'));
    assert.equal(rej.status, 201);
    const page = await newSession(A.owner2);
    await go(page, `#corrections/${submittedId}`);
    await until(page, (t) => t.includes('Review this correction'), 'review');
    await click(page, 'Approve and apply');
    await until(page, (t) => t.includes('Your note') && t.includes('Write a short note'), 'note required');
    await fill(page, 'Your note', 'Checked against the admission register');
    await click(page, 'Approve and apply');
    const text = await until(page, (t) => t.toLowerCase().includes('applied value'), 'applied');
    assert.match(text, /Applied/);
    assert.equal((await q(`SELECT first_name FROM residents WHERE id = $1`, [r1]))[0].first_name, 'Aarav');
    const row = (await q(`SELECT status, decided_by FROM correction_proposals WHERE id = $1`, [submittedId]))[0];
    assert.equal(row.status, 'APPLIED');
    assert.equal(row.decided_by, A.owner2.userId, 'the reviewer is the signed-in user');
    await go(page, `#corrections/${rej.body.id}`);
    await until(page, (t) => t.includes('Review this correction'), 'review reject');
    await fill(page, 'Your note', 'Not supported by the register');
    await click(page, 'Reject');
    await page.waitForFunction(() => [...document.querySelectorAll('[class*=tag], [class*=badge]')].some(el => el.textContent.trim() === 'Rejected'));
    assert.equal(await proposalStatus(rej.body.id), 'REJECTED');
    assert.equal((await q(`SELECT first_name FROM residents WHERE id = $1`, [r2]))[0].first_name, 'Reject');
    assert.deepEqual(page.errors, []);
    await page.browserContext().close();
  });

  await scenario('E5 requester withdrawal: the requester can withdraw but never approve their own request', async () => {
    const r3 = await addResident(A.orgId, 'Withdraw', 'Me');
    const created = await apiPost(A.pm, '/corrections', nameProposal(r3, 'Withdrawn'));
    assert.equal(created.status, 201);
    const page = await newSession(A.pm);
    await go(page, `#corrections/${created.body.id}`);
    await until(page, (t) => t.includes('Withdraw this correction'), 'withdraw panel');
    assert.equal(await hasButton(page, 'Approve and apply'), false, 'no approve control for the requester');
    assert.equal(await hasButton(page, 'Reject'), false);
    await fill(page, 'Why are you withdrawing it?', 'Requested by mistake');
    await click(page, 'Withdraw');
    await page.waitForFunction(() => [...document.querySelectorAll('[class*=tag], [class*=badge]')].some(el => el.textContent.trim() === 'Withdrawn'));
    assert.equal(await proposalStatus(created.body.id), 'WITHDRAWN');
    // the server also refuses a forged approval from the requester
    const forged = await apiPost(A.pm, `/corrections/${created.body.id}/approve`, { decisionReason: 'self' });
    assert.ok([403, 409].includes(forged.status), `server refused: ${forged.status}`);
    await page.browserContext().close();
  });

  await scenario('E6 resident history: the resident profile lists the applied correction and a pending value is never shown as current', async () => {
    const pendingValue = 'PendingNotCurrent';
    const pending = await apiPost(A.pm2, '/corrections', nameProposal(r1, pendingValue, 'lastName'));
    assert.equal(pending.status, 201);
    const foreign = await apiPost(B.pm, '/corrections', nameProposal(bPrivateResident, 'ForeignPrivateValue'));
    assert.equal(foreign.status, 201);
    const page = await newSession(A.owner);
    const errors = [];
    page.on('response', (response) => {
      const error = apiServerError(response.url(), response.status(), API);
      if (error) { errors.push(error); console.log(`E6 API 5xx ${error.status} ${error.path}`); }
    });
    await go(page, `#residents/${r1}/profile`);
    await page.waitForSelector('.profile-tabs button');
    await until(page, (t) => t.includes('Stay History'), 'profile tabs');
    const historyResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === API && url.pathname === '/api/v1/corrections/history' && url.searchParams.get('targetId') === r1;
    });
    await click(page, 'Corrections');
    const history = await historyResponse;
    assertHistory(history.status(), await history.json(), { residentId: r1, appliedId: submittedId, pendingId: pending.body.id, foreignId: foreign.body.id });
    const text = await until(page, (t) => t.includes('First name') && t.includes('Applied'), 'history list');
    assert.match(text, /Last name\s+—\s+Pending review/);
    await go(page, `#residents/${r1}/profile`);
    await until(page, (t) => t.includes('Aarav'), 'overview shows applied name');
    const overview = await textOf(page);
    assertCurrentValue(overview, 'Aarav', pendingValue);
    const foreignResponse = await page.evaluate(async (api, id) => {
      const response = await fetch(`${api}/api/v1/corrections/history?targetType=RESIDENT&targetId=${encodeURIComponent(id)}`, { credentials: 'include' });
      return { status: response.status, body: await response.json() };
    }, API, bPrivateResident);
    assertForeignHistory(foreignResponse.status, foreignResponse.body, [bPrivateResident, foreign.body.id, 'ForeignPrivateValue', B.orgId]);
    assertNoServerErrors(errors);
    await page.browserContext().close();

    // Isolated state checks: delay a real response, then force one failure and retry the real endpoint.
    const emptyId = await addResident(A.orgId, 'Empty', 'History');
    const states = await newSession(A.owner);
    await go(states, `#residents/${emptyId}/profile`);
    await until(states, (t) => t.includes('Stay History'), 'empty resident profile');
    await states.setRequestInterception(true);
    const held = [];
    let holdRequests = true;
    let failNext = false;
    states.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === API && url.pathname === '/api/v1/corrections/history') {
        if (holdRequests) held.push(request);
        else if (failNext && request.method() === 'GET') {
          void request.respond({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': WEB, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ message: 'History temporarily unavailable' }) });
        } else void request.continue();
      } else void request.continue();
    });
    await click(states, 'Corrections');
    await until(states, (t) => t.includes('Loading corrections…'), 'corrections loading');
    assertUiState(await textOf(states), 'loading');
    assert.ok(held.length > 0, 'history request is pending');
    holdRequests = false;
    await Promise.all(held.map((request) => request.continue()));
    await until(states, (t) => t.includes('No corrections'), 'empty correction history');
    assertUiState(await textOf(states), 'empty');
    await click(states, 'Overview');
    failNext = true;
    await click(states, 'Corrections');
    await until(states, (t) => t.includes('History temporarily unavailable'), 'history error');
    assertUiState(await textOf(states), 'error');
    failNext = false;
    await click(states, 'Try again');
    await until(states, (t) => t.includes('No corrections'), 'history retry');
    assertUiState(await textOf(states), 'empty');
    await states.browserContext().close();
  });

  await scenario('E7 billing review: only an independent OWNER resolves; a manager is refused and nothing changes', async () => {
    // State left by a financial application, seeded directly because financial application stays OFF in this run.
    const rb = await addResident(A.orgId, 'Billing', 'Gap');
    const bookingId = randomUUID();
    await q(`INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, updated_at) VALUES ($1,$2,$3,$4,'2026-09-01','2027-01-01',5000,now())`, [bookingId, A.orgId, rb, A.bedId]);
    const proposalId = randomUUID();
    await q(`INSERT INTO correction_proposals (id, organization_id, target_type, field_key, status, booking_target_id, original_value, proposed_value, applied_value, expected_snapshot, reason, effective_at, requested_by, requested_role, decided_by, decided_at, applied_at, decision_reason, financial_impact, correlation_id)
             VALUES ($1,$2,'BOOKING','monthlyPrice','APPLIED',$3,'{"kind":"money","value":"5000.00"}','{"kind":"money","value":"5200.00"}','{"kind":"money","value":"5200.00"}','{}','Recorded wrongly',now(),$4,'PROPERTY_MANAGER',$5,now(),now(),'Checked',true,$6)`, [proposalId, A.orgId, bookingId, A.pm.userId, A.owner.userId, randomUUID()]);
    const link = async (period) => {
      const id = randomUUID();
      await q(`INSERT INTO correction_finance_links (id, organization_id, proposal_id, kind, outcome, resident_id, booking_id, period_start) VALUES ($1,$2,$3,'BILLING_GAP','REVIEW_REQUIRED',$4,$5,$6)`, [id, A.orgId, proposalId, rb, bookingId, period]);
      return id;
    };
    const linkOne = await link('2026-09-01');
    const linkTwo = await link('2026-10-01');
    const unresolved = async (id) => (await q(`SELECT count(*)::int n FROM correction_finance_links WHERE kind = 'RESOLUTION' AND resolves_link_id = $1`, [id]))[0].n;

    const mgr = await newSession(A.pm2);
    await go(mgr, '#corrections/finance-reviews');
    await until(mgr, (t) => t.includes('No invoice yet for 2026-09-01'), 'reviews visible');
    await fill(mgr, 'Reason (required)', 'Manager attempt');
    await click(mgr, 'Record decision');
    await until(mgr, (t) => /owner/i.test(t.split('Billing reviews')[1] ?? '') && t.includes('Only an owner'), 'manager refused');
    assert.equal(await unresolved(linkOne), 0);
    await mgr.browserContext().close();

    const owner = await newSession(A.owner2);
    await go(owner, '#corrections/finance-reviews');
    await until(owner, (t) => t.includes('No invoice yet for 2026-09-01'), 'reviews for owner');
    await click(owner, 'Record decision'); // empty reason: refused client side
    await until(owner, (t) => t.includes('Write the reason for the record.'), 'reason required');
    const septemberCard = await owner.waitForSelector('xpath/.//div[contains(@class,"profile-card")][p/strong[contains(.,"2026-09-01")]]');
    const reasonBox = await septemberCard.$('textarea');
    await reasonBox.type('Reviewed with the owner; the September invoice may be created by hand');
    const decide = await septemberCard.$('button');
    await decide.click();
    await until(owner, (t) => !t.includes('No invoice yet for 2026-09-01'), 'first review leaves the open list');
    assert.equal(await unresolved(linkOne), 1);
    assert.equal(await unresolved(linkTwo), 0, 'the other review is untouched');
    const resolvedBy = (await q(`SELECT resolved_by, outcome FROM correction_finance_links WHERE kind = 'RESOLUTION' AND resolves_link_id = $1`, [linkOne]))[0];
    assert.equal(resolvedBy.resolved_by, A.owner2.userId);
    assert.equal(resolvedBy.outcome, 'RELEASED');
    await pick(owner, 'Show', 'resolved');
    await until(owner, (t) => t.includes('No invoice yet for 2026-09-01'), 'resolved list shows it');
    await owner.browserContext().close();
  });

  await scenario('E8 same-key retry after a simulated network failure applies exactly once', async () => {
    const r4 = await addResident(A.orgId, 'Network', 'Retry');
    const created = await apiPost(A.pm, '/corrections', nameProposal(r4, 'Reconnected'));
    assert.equal(created.status, 201);
    const page = await newSession(A.owner);
    await go(page, `#corrections/${created.body.id}`);
    await until(page, (t) => t.includes('Review this correction'), 'review');
    await fill(page, 'Your note', 'Verified');
    await page.setRequestInterception(true);
    const seenKeys = [];
    let failed = 0;
    page.on('request', async (request) => {
      if (request.method() === 'POST' && request.url().endsWith(`/corrections/${created.body.id}/approve`)) {
        const headers = request.headers();
        seenKeys.push(headers['idempotency-key']);
        if (failed === 0) {
          failed += 1;
          // The server receives and APPLIES the request; the browser never sees the response.
          const cookies = (await page.cookies(API)).map((c) => `${c.name}=${c.value}`).join('; ');
          const res = await fetch(request.url(), { method: 'POST', headers: { ...headers, cookie: cookies }, body: request.postData() });
          assert.equal(res.status, 200, 'the original request reached the server and was applied');
          return request.abort('connectionreset');
        }
      }
      return request.continue();
    });
    await click(page, 'Approve and apply');
    await until(page, (t) => t.includes('We could not confirm the result. Retry'), 'retry advice');
    assert.equal(await proposalStatus(created.body.id), 'APPLIED', 'the first attempt was applied before the failure was shown');
    await click(page, 'Retry');
    await until(page, (t) => t.toLowerCase().includes('applied value'), 'applied after retry');
    assert.equal(seenKeys.length, 2);
    assert.equal(seenKeys[0], seenKeys[1], 'the retry reuses the same Idempotency-Key');
    assert.equal((await q(`SELECT count(*)::int n FROM audit_events WHERE organization_id = $1 AND action = 'correction.applied' AND target_id = $2`, [A.orgId, r4]))[0].n, 1, 'applied exactly once');
    assert.equal((await q(`SELECT count(*)::int n FROM correction_command_receipts WHERE proposal_id = $1 AND action = 'APPROVE'`, [created.body.id]))[0].n, 1);
    assert.equal((await q(`SELECT first_name FROM residents WHERE id = $1`, [r4]))[0].first_name, 'Reconnected');
    await page.browserContext().close();
  });

  await scenario('E9 tenant isolation and unauthorized access: another organization sees none of this tenant\'s corrections', async () => {
    const e9Resident = await addResident(B.orgId, 'Private', 'E9');
    const bCorrection = await apiPost(B.pm, '/corrections', nameProposal(e9Resident, 'Exposed'));
    assert.equal(bCorrection.status, 201);
    const page = await newSession(B.owner);
    await go(page, '#corrections');
    const list = await until(page, (t) => t.includes('Exposed') === false && (t.includes('Name') || t.includes('First name') || t.includes('No corrections')), 'tenant B list');
    assert.ok(!list.includes('Aarav') && !list.includes('Page00'), 'no organization A rows');
    // organization A's proposal id is indistinguishable from a missing record
    await go(page, `#corrections/${submittedId}`);
    const denied = await until(page, (t) => /not found/i.test(t), 'not found for foreign id');
    assert.ok(!denied.includes('Aarav') && !denied.includes('Arahv'));
    const probe = await page.evaluate(async (api, id) => {
      const res = await fetch(`${api}/api/v1/corrections/${id}`, { credentials: 'include' });
      return { status: res.status, body: await res.text() };
    }, API, submittedId);
    assert.equal(probe.status, 404);
    assert.ok(!probe.body.includes('Aarav'));
    // a foreign target cannot be proposed against, and the forged tenant field is refused
    const foreignTarget = await apiPost(B.pm, '/corrections', nameProposal(r1, 'Hijack'));
    assert.equal(foreignTarget.status, 404);
    const forged = await apiPost(B.pm, '/corrections', { ...nameProposal(bPrivateResident, 'X', 'lastName'), organizationId: A.orgId });
    assert.equal(forged.status, 400);
    // the session cookie of B cannot approve A's proposal even with the right id
    const approveForeign = await apiPost(B.owner, `/corrections/${submittedId}/approve`, { decisionReason: 'x' });
    assert.equal(approveForeign.status, 404);
    await page.browserContext().close();
  });

  await scenario('E10 STALE and disabled financial application: clear conflict feedback preserves records', async () => {
    // STALE: the record changes after the proposal.
    const rs = await addResident(A.orgId, 'Stale', 'Case');
    const stale = await apiPost(A.pm, '/corrections', nameProposal(rs, 'Fresh'));
    await q(`UPDATE residents SET first_name = 'ChangedElsewhere' WHERE id = $1`, [rs]);
    const page = await newSession(A.owner2);
    await go(page, `#corrections/${stale.body.id}`);
    await until(page, (t) => t.includes('Review this correction'), 'review stale');
    await fill(page, 'Your note', 'Approving');
    await click(page, 'Approve and apply');
    await until(page, (t) => t.includes('This correction can no longer be applied') && t.includes('Start a new one'), 'stale banner after refresh');
    assert.equal(await proposalStatus(stale.body.id), 'STALE');
    assert.equal((await q(`SELECT first_name FROM residents WHERE id = $1`, [rs]))[0].first_name, 'ChangedElsewhere', 'nothing applied');
    await click(page, 'Start a new one');
    await until(page, (t) => t.includes('Request a correction'), 'new proposal form');

    // The deployment-default financial gate must refuse application, even when a competing booking exists.
    // Financial lifecycle-conflict validation is covered separately through the integration-only injected config.
    const e1 = await addResident(A.orgId, 'Lifecycle', 'One');
    const e2 = await addResident(A.orgId, 'Lifecycle', 'Two');
    const bed2 = randomUUID();
    const roomRow = (await q(`SELECT property_id, room_id FROM beds WHERE id = $1`, [A.bedId]))[0];
    await q(`INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,'B2',now())`, [bed2, A.orgId, roomRow.property_id, roomRow.room_id]);
    const bookingA = randomUUID();
    await q(`INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, updated_at) VALUES ($1,$2,$3,$4,'2026-09-01','2027-01-01',5000,now())`, [bookingA, A.orgId, e1, bed2]);
    const conflict = await apiPost(A.pm, '/corrections', { targetType: 'BOOKING', targetId: bookingA, fieldKey: 'startDate', proposedValue: '2026-08-01', reason: 'Entered wrongly', effectiveAt: new Date().toISOString(), evidenceReference: 'Register' });
    assert.equal(conflict.status, 201, JSON.stringify(conflict.body));
    // the competing booking is created through the real API route by an ordinary writer
    const created = await apiPost(A.owner, '/bookings', { residentId: e2, bedId: bed2, startDate: '2026-08-10', endDate: '2026-08-25', monthlyPrice: 4000 }, randomUUID());
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await go(page, `#corrections/${conflict.body.id}`);
    await until(page, (t) => t.includes('Review this correction'), 'review lifecycle');
    await fill(page, 'Your note', 'Approving');
    const exception = await page.$$('xpath/.//label[span[contains(., "Exception reason")]]//textarea');
    if (exception.length) await exception[0].type('Verified against the agreement register');
    await click(page, 'Approve and apply');
    const text = await until(page, (t) => t.includes('Applying financial corrections is not enabled yet'), 'financial application disabled');
    assert.match(text, /Applying financial corrections is not enabled yet/);
    assert.equal(await proposalStatus(conflict.body.id), 'PENDING', 'a lifecycle conflict leaves the proposal pending');
    assert.equal(await hasButton(page, 'Approve and apply'), true, 'the reviewer can still decide (reject) after the conflict');
    assert.equal((await q(`SELECT to_char(start_date,'YYYY-MM-DD') d FROM bookings WHERE id = $1`, [bookingA]))[0].d, '2026-09-01');
    await page.browserContext().close();
  });
} finally {
  await browser?.close().catch(() => undefined);
  await shutdown();
  await admin.end();
}

const failed = results.filter((r) => !r.ok);
if (process.env.NOOK_E2E_SANITIZED === '1') {
  const safe = JSON.stringify(failed, null, 2).replaceAll(MIGRATOR, '[redacted]').replaceAll(RUNTIME, '[redacted]')
    .replaceAll(TEST_PASSWORD, '[redacted]').replace(/postgres(?:ql)?:\/\/[^\s"\\]+/gi, '[redacted]');
  writeFileSync(resolve(SHOTS, 'failures.json'), safe);
}
console.log(`\nE2E scenarios: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log(`  FAILED: ${f.name}`);
const apiLog = children.find((c) => c.name === 'api')?.log.join('') ?? '';
if (process.env.NOOK_E2E_SANITIZED !== '1') writeFileSync(resolve(SHOTS, 'api.log'), apiLog);
else {
  const exceptions = apiLog.split('\n').flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      if (entry.message !== 'unhandled exception') return [];
      const rendered = JSON.stringify({ path: entry.path, status: entry.status, err: entry.err })
        .replaceAll(MIGRATOR, '[redacted]').replaceAll(RUNTIME, '[redacted]')
        .replaceAll(TEST_PASSWORD, '[redacted]')
        .replace(/postgres(?:ql)?:\/\/[^\s"\\]+/gi, '[redacted]');
      return [rendered];
    } catch { return []; }
  });
  writeFileSync(resolve(SHOTS, 'exceptions.jsonl'), exceptions.join('\n'));
}
const serverErrors = (apiLog.match(/"status":5\d\d|unhandled exception/g) ?? []).length;
console.log(`API 5xx/ERROR log markers: ${serverErrors}`);
process.exit(failed.length === 0 && (process.env.NOOK_E2E_SANITIZED !== '1' || serverErrors === 0) ? 0 : 1);
