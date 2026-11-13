/**
 * UI readiness audit (real Chrome, real Vite web app, real Nest API, disposable PostgreSQL).
 *
 * Usage (disposable database only; see docs in the final report):
 *   NOOK_UI_AUDIT_PHASE=after node --import tsx scripts/qa/ui-readiness-disposable.mjs full
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
import {
  hashTestPassword,
  TEST_PASSWORD,
} from '../../apps/api/test/integration/helpers/fixtures.ts';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.NOOK_BROWSER_MODULE ?? 'puppeteer-core');
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3199);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5199);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const PHASE = process.env.NOOK_UI_AUDIT_PHASE ?? 'baseline';
const SHOTS = resolve(ROOT, 'docs/ui-readiness/evidence', PHASE);
mkdirSync(SHOTS, { recursive: true });

// ----------------------------------------------------------------------------------------------- safety
function checkUrl(name, raw) {
  const url = new URL(raw ?? '');
  assert.equal(url.hostname, '127.0.0.1', `${name} must be a local disposable database`);
  assert.ok(url.port && !['5432', '5433'].includes(url.port), `${name} must use a dedicated port`);
  assert.match(
    url.pathname.slice(1),
    /^nook_integration_/,
    `${name} must name a disposable database`,
  );
  return raw;
}
const MIGRATOR = checkUrl('E2E_MIGRATOR_URL', process.env.E2E_MIGRATOR_URL);
const RUNTIME = checkUrl('E2E_RUNTIME_URL', process.env.E2E_RUNTIME_URL);
assert.notEqual(MIGRATOR, RUNTIME);

const admin = new pg.Client({ connectionString: MIGRATOR });
await admin.connect();
const marker = await admin.query(
  `SELECT shobj_description(oid, 'pg_database') c FROM pg_database WHERE datname = current_database()`,
);
assert.match(
  marker.rows[0].c ?? '',
  /nook-integration-isolated: disposable/,
  'database marker comment',
);
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
  const ids = {
    property: randomUUID(),
    floor: randomUUID(),
    room: randomUUID(),
    bed: randomUUID(),
  };
  await q('BEGIN');
  await q(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
    orgId,
    `E2E ${label}`,
  ]);
  for (const p of people) {
    await q(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,$4,now())`,
      [p.userId, p.email, hash, p.name],
    );
    await q(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [randomUUID(), orgId, p.userId, p.role],
    );
  }
  await q(
    `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'Main',now())`,
    [ids.property, orgId, `P-${ids.property.slice(0, 8)}`],
  );
  await q(
    `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`,
    [ids.floor, orgId, ids.property],
  );
  await q(
    `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R',now())`,
    [ids.room, orgId, ids.property, ids.floor],
  );
  await q(
    `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,'B1',now())`,
    [ids.bed, orgId, ids.property, ids.room],
  );
  await q('COMMIT');
  const [owner, owner2, pm, pm2] = people;
  return { orgId, bedId: ids.bed, owner, owner2, pm, pm2 };
}
async function addResident(orgId, first, last) {
  const id = randomUUID();
  await q(
    `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,$3,$4,now())`,
    [id, orgId, first, last],
  );
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
const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CHECKPOINT_DISABLE: '1',
  DOTENV_CONFIG_PATH: '/dev/null',
  NOOK_ISOLATED_TEST_RUN: '1',
};
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
start(
  'web',
  process.execPath,
  [
    resolve(ROOT, 'node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(WEB_PORT),
  ],
  resolve(ROOT, 'apps/web'),
  {
    ...baseEnv,
    VITE_API_BASE: `${API}/api/v1`,
  },
);

async function shutdown() {
  for (const { child } of children) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL');
}

// --------------------------------------------------------------------------------------- API helpers
const jar = new Map();
async function apiLogin(user) {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB },
    body: JSON.stringify({ email: user.email, password: TEST_PASSWORD }),
  });
  assert.equal(res.status, 200, `login ${user.name}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  const csrf = cookies.find((c) => c.startsWith('nook_csrf=')).slice('nook_csrf='.length);
  jar.set(user.userId, { cookie: cookies.join('; '), csrf });
}
async function apiPost(user, path, body, key = randomUUID()) {
  if (!jar.has(user.userId)) await apiLogin(user);
  const s = jar.get(user.userId);
  const res = await fetch(`${API}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: WEB,
      cookie: s.cookie,
      'x-csrf-token': s.csrf,
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
// ------------------------------------------------------------------------------------------ browser DSL
let browser;
const results = [];
async function newSession(user) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
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
  await Promise.all([
    page.waitForSelector('#login-email', { hidden: true }),
    page.keyboard.press('Enter'),
  ]);
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
      await page.screenshot({ path: `${SHOTS}/FAIL-${label.replace(/\W+/g, '-')}.png` });
      throw new Error(`timeout waiting for: ${label}\n--- page text ---\n${text.slice(0, 1500)}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}
const field = async (page, label) => {
  const handle = await page.waitForSelector(
    `xpath/.//label[contains(@class,'fin-field')][span[contains(normalize-space(.), "${label}")]]//*[self::input or self::select or self::textarea]`,
    { timeout: 10_000 },
  );
  assert.ok(handle, `field ${label}`);
  return handle;
};
async function pick(page, label, value) {
  const el = await field(page, label);
  await page.waitForFunction(
    (select, value) => !select.disabled && [...select.options].some((o) => o.value === value),
    { timeout: 10000 },
    el,
    value,
  );
  await el.select(value);
}
async function click(page, label) {
  await page.waitForFunction(
    (label) => {
      const scope = document.querySelector('[aria-modal="true"]') ?? document;
      return [...scope.querySelectorAll('button,a')].some(
        (el) =>
          el.textContent.replace(/\s+/g, ' ').trim() === label &&
          el.getClientRects().length &&
          !el.disabled,
      );
    },
    { timeout: 10000 },
    label,
  );
  const modal = await page.$('[aria-modal="true"]');
  const scope = modal ?? page;
  for (const tag of ['button', 'a']) {
    for (const handle of await scope.$$(`xpath/.//${tag}[normalize-space()="${label}"]`)) {
      if (await handle.isVisible()) {
        await handle.click();
        return;
      }
    }
  }
  throw new Error(`No visible action: ${label}`);
}
async function hasButton(page, label) {
  return (await page.$$(`xpath/.//button[normalize-space()="${label}"]`)).length > 0;
}
// NOOK_UI_SKIP="W11,W12": comma-separated scenario ids to leave out (reported as SKIP, never as PASS).
const SKIP = (process.env.NOOK_UI_SKIP ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
async function scenario(name, fn) {
  const t0 = Date.now();
  if (SKIP.some((id) => name === id || name.startsWith(`${id} `))) {
    results.push({ name, ok: null, skipped: true, ms: 0 });
    console.log(`SKIP  ${name}`);
    return;
  }
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`PASS  ${name} (${Date.now() - t0} ms)`);
  } catch (error) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - t0,
      error: String(error?.stack ?? error).slice(0, 1800),
    });
    console.log(`FAIL  ${name}\n${String(error?.stack ?? error).slice(0, 1800)}`);
  }
}

const waitText = (page, text) =>
  until(page, (t) => t.toLowerCase().includes(text.toLowerCase()), text);
async function value(page, label, next) {
  const handle = await field(page, label);
  await handle.evaluate((el, v) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, next);
}
const settled = async (page) => {
  await page.waitForNetworkIdle({ idleTime: 150, timeout: 15000 });
};
const navigate = async (page, hash, text) => {
  await go(page, hash);
  if (text) await waitText(page, text);
  await settled(page);
};
const dates = new Date();
const isoDate = (date) => date.toISOString().slice(0, 10);
const month = isoDate(dates).slice(0, 7);
const bookingStart = `${month}-01`;
const end = isoDate(new Date(Date.UTC(dates.getUTCFullYear(), dates.getUTCMonth() + 1, 1)));
const extended = isoDate(new Date(Date.UTC(dates.getUTCFullYear(), dates.getUTCMonth() + 2, 1)));
const istLocal = (date) => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 16);
const ids = {};
const scans = [];
const probes = [];
let page;
const routes = () => [
  ['Workspace demo', '#overview', 'Property management'],
  ['Residents', '#residents', 'Residents'],
  ['Register resident', '#residents/new', 'First name'],
  ['Resident details', `#residents/${ids.resident}`, 'Edit details'],
  ['Resident profile', `#residents/${ids.resident}/profile`, 'Resident Information'],
  ['Enquiries', '#enquiries', 'Enquiries'],
  ['New enquiry', '#enquiries/new', 'First name'],
  ['Enquiry details', `#enquiries/${ids.enquiry}`, 'Follow-ups'],
  ['Overdue follow-ups', '#enquiries/follow-ups/overdue', 'Overdue follow-ups'],
  ['Upcoming follow-ups', '#enquiries/follow-ups/upcoming', 'Upcoming follow-ups'],
  ['Bookings', '#bookings', 'Bookings'],
  ['New booking', '#bookings/new', 'Find available beds'],
  ['Booking details', `#bookings/${ids.booking}`, 'Exclusive end date'],
  ['Admissions', '#admissions', 'Confirmed booking'],
  ['Admission details', `#admissions/${ids.admission}`, 'Admission details'],
  ['Check-ins', '#check-ins', 'beds occupied'],
  ['New check-in', '#check-ins/new', 'Check-in'],
  ['Check-in details', `#check-ins/${ids.checkin}`, 'Stay of'],
  ['Properties', '#properties', 'Properties'],
  ['Add property', '#properties/new', 'Code'],
  ['Property details', `#properties/${ids.property}`, 'Manage floors'],
  ['Floors', `#floors/${ids.property}`, 'Floors'],
  ['Add floor', `#floors/${ids.property}/new`, 'Ordinal'],
  ['Floor details', `#floors/${ids.property}/${ids.floor}`, 'Edit details'],
  ['Rooms', `#rooms/${ids.property}`, 'Rooms'],
  ['Add room', `#rooms/${ids.property}/new`, 'Floor'],
  ['Room details', `#rooms/${ids.property}/${ids.room}`, 'Manage beds'],
  ['Beds', `#beds/${ids.room}`, 'Beds'],
  ['Add bed', `#beds/${ids.room}/new`, 'Out of service reason'],
  ['Bed details', `#beds/${ids.room}/${ids.bed}`, 'Edit details'],
  ['Corrections', '#corrections', 'Corrections'],
  ['New correction', '#corrections/new', 'What to correct'],
  ['Correction details', `#corrections/${ids.correction}`, 'Current value when proposed'],
  ['Billing reviews', '#corrections/finance-reviews', 'Billing reviews'],
  ['Finance overview', '#finance', 'Monthly collection overview'],
  ['Invoices', '#finance/invoices', 'Invoices'],
  ['Create invoices', '#finance/invoices/new', 'Create a single invoice'],
  ['Invoice details', `#finance/invoices/${ids.invoice}`, 'Payment history'],
  ['Outstanding', '#finance/outstanding', 'Outstanding payments'],
  ['Financial report', '#finance/reports', 'Monthly financial report'],
  ['Finance correction history', '#finance/corrections', 'Correction history'],
  ['Receipt', `#finance/receipt/${ids.invoice}`, 'Payment receipt'],
  ['Settings', '#settings', 'Organization profile'],
  ['Staff accounts', '#staff', 'Not available yet'],
  ['Notifications', '#notifications', 'Not available yet'],
  ['Transfer requests', '#transfers', 'Transfer requests'],
];
try {
  await Promise.all([waitFor(`${API}/api/v1/health`, 'api'), waitFor(`${WEB}/`, 'web')]);
  browser = await puppeteer.launch({
    executablePath: process.env.NOOK_BROWSER_EXECUTABLE,
    headless: true,
  });
  page = await newSession();
  await scenario('A01 protected deep link and invalid login', async () => {
    await navigate(page, '#finance/invoices', 'Welcome');
    assert.ok(!(await textOf(page)).includes('Monthly collection overview'));
    await page.type('#login-email', A.owner.email);
    await page.type('#login-password', 'incorrect-password');
    await page.keyboard.press('Enter');
    await waitText(page, 'password');
    await settled(page);
    assert.ok(await page.$('#login-email'));
    for (const width of [1440, 768, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.screenshot({ path: `${SHOTS}/login-${width}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await page.setViewport({ width: 1440, height: 1000 });
    await page.$eval('#login-password', (el) => (el.value = ''));
    await page.type('#login-password', TEST_PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#login-email', { hidden: true });
    await settled(page);
    assert.ok((await textOf(page)).includes('Sign out'));
    await page.reload();
    await settled(page);
    assert.ok(!(await page.$('#login-email')));
  });
  // A fresh context avoids retained invalid-login form state if the first check fails.
  if (await page.$('#login-email')) {
    await page.browserContext().close();
    page = await newSession(A.owner);
  }
  await scenario('W01 create property, floor, room and two beds through UI', async () => {
    await navigate(page, '#properties/new', 'Code');
    await value(page, 'Code', 'UI-AUDIT');
    await value(page, 'Name', 'Synthetic Audit House');
    await click(page, 'Create property');
    await waitText(page, 'Manage floors');
    ids.property = (
      await q("SELECT id FROM properties WHERE organization_id=$1 AND code='UI-AUDIT'", [A.orgId])
    )[0].id;
    await click(page, 'Manage floors');
    await waitText(page, 'Add floor');
    await click(page, 'Add floor');
    await value(page, 'Label', 'Audit Ground');
    await value(page, 'Ordinal', '0');
    await click(page, 'Add floor');
    await settled(page);
    ids.floor = (await q('SELECT id FROM floors WHERE property_id=$1', [ids.property]))[0].id;
    await navigate(page, `#rooms/${ids.property}/new`, 'Floor');
    await pick(page, 'Floor', ids.floor);
    await value(page, 'Label', 'Audit Room');
    await click(page, 'Add room');
    await waitText(page, 'Manage beds');
    ids.room = (await q('SELECT id FROM rooms WHERE property_id=$1', [ids.property]))[0].id;
    for (const label of ['Audit Bed A', 'Audit Bed B']) {
      await navigate(page, `#beds/${ids.room}/new`, 'Out of service reason');
      await value(page, 'Label', label);
      await click(page, 'Add bed');
      await waitText(page, label);
    }
    ids.bed = (
      await q("SELECT id FROM beds WHERE room_id=$1 AND label='Audit Bed A'", [ids.room])
    )[0].id;
    ids.bed2 = (
      await q("SELECT id FROM beds WHERE room_id=$1 AND label='Audit Bed B'", [ids.room])
    )[0].id;
    await navigate(page, `#beds/${ids.room}/${ids.bed2}`, 'Edit details');
    await click(page, 'Edit details');
    await pick(page, 'Operational status', 'OUT_OF_SERVICE');
    await click(page, 'Save changes');
    await waitText(page, 'Reason is required');
    await value(page, 'Out of service reason', 'Synthetic repair');
    await click(page, 'Save changes');
    await waitText(page, 'Details saved.');
    await click(page, 'Edit details');
    await pick(page, 'Operational status', 'IN_SERVICE');
    await value(page, 'Out of service reason', '');
    await click(page, 'Save changes');
    await settled(page);
  });
  // Keep independent workflows auditable even when bed creation is broken; this setup is not a UI pass.
  if (!ids.bed && ids.room) {
    for (const [key, label] of [
      ['bed', 'Audit Bed A'],
      ['bed2', 'Audit Bed B'],
    ]) {
      ids[key] = randomUUID();
      await q(
        'INSERT INTO beds (id,organization_id,property_id,room_id,label,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
        [ids[key], A.orgId, ids.property, ids.room, label],
      );
    }
    probes.push({
      name: 'Inventory fallback',
      scope: 'direct disposable fixture seed after UI failure; W01 stays failed',
    });
  }
  await scenario(
    'W02 enquiry validation, creation, status, follow-up and resident conversion',
    async () => {
      await navigate(page, '#enquiries/new', 'First name');
      await click(page, 'Save enquiry');
      await waitText(page, 'Enter the first name.');
      await value(page, 'First name', 'Synthetic');
      await value(page, 'Last name', 'Audit');
      await value(page, 'Phone', '+910000000000');
      await click(page, 'Save enquiry');
      await waitText(page, 'Convert to resident');
      ids.enquiry = (
        await q("SELECT id FROM enquiries WHERE organization_id=$1 AND first_name='Synthetic'", [
          A.orgId,
        ])
      )[0].id;
      await click(page, 'Mark contacted');
      await waitText(page, 'Status set to Contacted.');
      await value(page, 'What was discussed', 'Synthetic audit follow-up');
      await click(page, 'Add follow-up');
      await waitText(page, 'Follow-up recorded.');
      await click(page, 'Convert to resident');
      await waitText(page, 'Stay profile and history');
      ids.resident = (
        await q('SELECT resident_id FROM enquiries WHERE id=$1', [ids.enquiry])
      )[0].resident_id;
      await click(page, 'Edit details');
      await value(page, 'Address', 'Synthetic address for audit only');
      await click(page, 'Save changes');
      await waitText(page, 'Details saved.');
    },
  );
  await scenario('W03 booking search, availability, create and conflict handling', async () => {
    await navigate(page, '#bookings/new', 'Find available beds');
    await value(page, 'Search residents', 'Synthetic');
    await click(page, 'Search');
    await settled(page);
    await click(page, 'Synthetic Audit · +910000000000');
    await value(page, 'Start date', bookingStart);
    await value(page, 'End date', end);
    await click(page, 'Find available beds');
    await waitText(page, 'Audit Bed A');
    const radio = await page.$(`input[type=radio][value="${ids.bed}"]`);
    assert.ok(radio);
    await radio.click();
    await value(page, 'Monthly rent', '5000');
    await click(page, 'Create booking');
    await waitText(page, 'View booking');
    ids.booking = (await q('SELECT id FROM bookings WHERE resident_id=$1', [ids.resident]))[0].id;
    await apiLogin(A.owner);
    const conflict = await apiPost(A.owner, '/bookings', {
      residentId: ids.resident,
      bedId: ids.bed,
      startDate: bookingStart,
      endDate: end,
      monthlyPrice: '5000',
    });
    assert.equal(conflict.status, 409);
  });
  await scenario('W04 admission create, admit and check-in updates occupancy', async () => {
    await navigate(page, '#admissions', 'Confirmed booking');
    await pick(page, 'Confirmed booking', ids.booking);
    await click(page, 'Create admission');
    await waitText(page, 'Admission created.');
    ids.admission = (await q('SELECT id FROM admissions WHERE booking_id=$1', [ids.booking]))[0].id;
    await click(page, 'Mark admitted');
    await waitText(page, 'Marked admitted.');
    await navigate(page, '#check-ins/new', 'Check-in time');
    await pick(page, 'Admission', ids.admission);
    await value(page, 'Check-in time', istLocal(new Date(Date.now() - 120000)));
    await click(page, 'Check in');
    await waitText(page, 'Check out resident');
    ids.checkin = (
      await q('SELECT id FROM check_ins WHERE admission_id=$1', [ids.admission])
    )[0].id;
    await navigate(page, '#check-ins', '1 of');
  });
  await scenario(
    'W05 single draft, issue, partial payment, receipt, dues and reports',
    async () => {
      await navigate(page, '#finance/invoices/new', 'Create a single invoice');
      await value(page, 'Resident', 'Synthetic');
      await settled(page);
      await waitText(page, 'Synthetic Audit');
      await click(page, 'Synthetic Audit');
      await settled(page);
      await pick(page, 'Booking (', ids.booking);
      await click(page, 'Create draft');
      await waitText(page, 'Draft created.');
      await click(page, 'Issue invoice');
      await waitText(page, 'Invoice issued.');
      await click(page, 'Open invoice');
      await waitText(page, 'Record payment');
      ids.invoice = (await q('SELECT id FROM invoices WHERE booking_id=$1', [ids.booking]))[0].id;
      await click(page, 'Record payment');
      await value(page, 'Amount', '6000');
      await click(page, 'Record payment');
      await waitText(page, 'cannot exceed');
      await value(page, 'Amount', '1000');
      await click(page, 'Record payment');
      await waitText(page, 'Payment of');
      await settled(page);
      assert.equal(
        (await q('SELECT count(*)::int n FROM payments WHERE invoice_id=$1', [ids.invoice]))[0].n,
        1,
      );
      await click(page, 'Receipts');
      await waitText(page, 'Payment receipt');
      await waitText(page, '1,000.00');
      await navigate(page, '#finance/outstanding', 'Outstanding payments');
      await waitText(page, '4,000.00');
      await navigate(page, '#finance/reports', 'Monthly financial report');
      await waitText(page, '1,000.00');
    },
  );
  await scenario('W06 correction submit and requester cannot self-approve', async () => {
    await navigate(page, `#residents/${ids.resident}`, 'Edit details');
    await click(page, 'Edit details');
    await click(page, 'Request a correction');
    await waitText(page, 'Corrected value');
    await value(page, 'Corrected value', 'Synthetic Corrected');
    await value(page, 'Why is this needed', 'Synthetic spelling correction');
    await click(page, 'Submit correction');
    await waitText(page, 'Current value when proposed');
    ids.correction = new URL(page.url()).hash.split('/')[1];
    assert.equal(await hasButton(page, 'Approve and apply'), false);
    assert.equal(await hasButton(page, 'Withdraw'), true);
  });
  await scenario('W07 transfer preview respects execution safety gate', async () => {
    await navigate(page, `#residents/${ids.resident}/profile`, 'Resident Information');
    await click(page, 'Transfer');
    await settled(page);
    await pick(page, 'Destination property', ids.property);
    await settled(page);
    await pick(page, 'Destination room', ids.room);
    await settled(page);
    await pick(page, 'Destination bed', ids.bed2);
    await value(page, 'Transfer reason', 'Synthetic audit move');
    await click(page, 'Preview transfer');
    await settled(page);
    if ((await textOf(page)).includes('No active stay assignment')) {
      probes.push({
        name: 'Transfer workflow',
        scope:
          'real API; new check-in has no active assignment; preview refused, execution unavailable',
        available: false,
      });
      assert.equal(await hasButton(page, 'Confirm transfer'), false);
      return;
    }
    await waitText(page, 'Monthly rent unchanged');
    const button = await page.$('xpath/.//button[normalize-space()="Confirm transfer"]');
    assert.ok(await button.evaluate((el) => el.disabled));
    await waitText(page, 'Transfer execution is unavailable');
    assert.equal(
      (await q('SELECT count(*)::int n FROM transfers WHERE resident_id=$1', [ids.resident]))[0].n,
      0,
    );
    await page.screenshot({ path: `${SHOTS}/transfer-preview.png`, fullPage: true });
  });
  await scenario('R01 every route at 1440/768/390 with real API data', async () => {
    assert.equal(Object.keys(ids).length, 12, 'Workflow setup must supply all identifiers');
    for (const width of [1440, 768, 390]) {
      await page.setViewport({ width, height: 1000 });
      for (const [name, hash, expected] of routes()) {
        const before = page.errors.length;
        await go(page, hash);
        await settled(page);
        const text = await textOf(page);
        const metrics = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          brokenLabels: [...document.querySelectorAll('[aria-labelledby]')]
            .filter((el) =>
              el
                .getAttribute('aria-labelledby')
                .split(' ')
                .some((id) => !document.getElementById(id)),
            )
            .map((el) => el.getAttribute('aria-labelledby')),
          overflow: [...document.querySelectorAll('main *')]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.width > 0 &&
                r.right > innerWidth + 1 &&
                !el.closest('.fin-table-wrap,.profile-table-wrap,.plan-scroll,.fin-tabs')
              );
            })
            .slice(0, 8)
            .map((el) => el.className || el.tagName),
        }));
        scans.push({
          role: 'OWNER',
          name,
          hash,
          width,
          expectedContent: text.toLowerCase().includes(expected.toLowerCase()),
          errorState: text.includes('Try again'),
          pageErrors: page.errors.slice(before),
          ...metrics,
        });
        await page.screenshot({
          path: `${SHOTS}/${name.toLowerCase().replace(/\W+/g, '-')}-${width}.png`,
          fullPage: true,
        });
      }
    }
    writeFileSync(`${SHOTS}/route-scan.json`, JSON.stringify(scans, null, 2));
    assert.ok(
      scans.every(
        (s) =>
          s.expectedContent &&
          !s.pageErrors.length &&
          s.scrollWidth <= s.width + 1 &&
          s.brokenLabels.length === 0,
      ),
      `${scans.filter((s) => !s.expectedContent || s.pageErrors.length || s.scrollWidth > s.width + 1 || s.brokenLabels.length).length} route/viewport/label failures (see route-scan.json)`,
    );
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await scenario(
    'X03 navigating to another property discards the prior record editor',
    async () => {
      await navigate(page, `#properties/${ids.property}`, 'Edit details');
      await click(page, 'Edit details');
      await value(page, 'Name', 'Unsaved prior property');
      const other = (
        await q('SELECT id FROM properties WHERE organization_id=$1 AND id<>$2', [
          A.orgId,
          ids.property,
        ])
      )[0].id;
      await page.evaluate((hash) => (window.location.hash = hash), `#properties/${other}`);
      await settled(page);
      const input = await page.$('input');
      const retained = input ? await page.$$eval('input', (els) => els.map((el) => el.value)) : [];
      probes.push({ name: 'Record editor identity', retained });
      assert.ok(
        !retained.includes('Unsaved prior property'),
        'Old property editor remains active on another record',
      );
    },
  );
  await scenario(
    'W09 invoice credit displayed consistently in resident financial profile',
    async () => {
      await navigate(page, `#finance/invoices/${ids.invoice}`, 'Credit invoice');
      await click(page, 'Credit invoice');
      await value(page, 'Credit amount', '500');
      await value(page, 'Reason', 'Synthetic audit credit');
      await click(page, 'Apply credit');
      await waitText(page, 'Credit of');
      await navigate(page, `#residents/${ids.resident}/profile`, 'Resident Information');
      await click(page, 'Financial');
      await waitText(page, PHASE === 'baseline' ? 'Invoice Items' : 'Outstanding invoices');
      await settled(page);
      const cells = await page.$$eval('.profile-table tbody tr:first-child td', (els) =>
        els.map((el) => el.textContent),
      );
      probes.push({ name: 'Credit balance', scope: 'real API credit', cells });
      assert.ok(
        cells[4].includes('3,500.00'),
        `Expected remaining balance 3500 after 1000 cash and 500 credit: ${cells[4]}`,
      );
      assert.ok(cells[3].includes('1,000.00'), `Expected actual cash 1000: ${cells[3]}`);
    },
  );
  await scenario(
    'X01 form failures visibly report errors and allow retry (injected 503)',
    async () => {
      let failedPath = '';
      await page.setRequestInterception(true);
      const handler = (r) => {
        const u = new URL(r.url());
        if (failedPath && u.pathname === `/api/v1${failedPath}` && r.method() === 'GET')
          return void r.respond({
            status: 503,
            contentType: 'application/json',
            headers: {
              'access-control-allow-origin': WEB,
              'access-control-allow-credentials': 'true',
            },
            body: JSON.stringify({ message: 'Synthetic outage' }),
          });
        return void r.continue();
      };
      page.on('request', handler);
      try {
        for (const [hash, path, searchLabel] of [
          [`#rooms/${ids.property}/new`, `/properties/${ids.property}/floors`, null],
          ['#admissions', '/bookings', null],
          ['#finance/invoices/new', '/residents', 'Resident'],
        ]) {
          failedPath = path;
          await go(page, hash);
          await settled(page);
          if (searchLabel) {
            await value(page, searchLabel, 'Synthetic');
            await new Promise((r) => setTimeout(r, 350));
            await settled(page);
          }
          const visible = await page.$('[role=alert]');
          probes.push({ name: '503 handling', hash, path, visibleError: Boolean(visible) });
          failedPath = '';
          if (visible) {
            await click(page, 'Try again');
            await settled(page);
            assert.equal(await page.$('[role=alert]'), null);
          }
        }
        assert.ok(
          probes.filter((p) => p.name === '503 handling').every((p) => p.visibleError),
          'One or more form data failures are hidden',
        );
      } finally {
        failedPath = '';
        page.off('request', handler);
        await page.setRequestInterception(false);
      }
    },
  );
  await scenario('X02 payment dialog traps Tab, restores focus and fits mobile', async () => {
    await navigate(page, `#finance/invoices/${ids.invoice}`, 'Record payment');
    await click(page, 'Record payment');
    await page.waitForSelector('[role=dialog]');
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      assert.ok(
        await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))),
        'Tab escaped payment dialog',
      );
    }
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}/payment-mobile.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.keyboard.press('Escape');
    assert.equal(await page.$('[role=dialog]'), null);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Record payment');
  });
  // Leave a failed dialog probe in a known state for subsequent independent checks.
  await navigate(page, '#residents', 'Residents');
  await page.setViewport({ width: 1440, height: 1000 });
  await scenario('A02 manager review permission and cross-tenant denial', async () => {
    const manager = await newSession(A.pm);
    await navigate(manager, `#corrections/${ids.correction}`, 'Current value when proposed');
    assert.ok(await hasButton(manager, 'Approve and apply'));
    await value(manager, 'Your note', 'Verified synthetic correction');
    await click(manager, 'Approve and apply');
    await waitText(manager, 'Applied value');
    assert.equal(
      (await q('SELECT first_name FROM residents WHERE id=$1', [ids.resident]))[0].first_name,
      'Synthetic Corrected',
    );
    await navigate(manager, `#residents/${bPrivateResident}/profile`, 'could not be found');
    assert.ok(!(await textOf(manager)).includes('Hidden Tenant'));
    await manager.browserContext().close();
  });
  await scenario('W08 extension confirmation and completed checkout/history', async () => {
    page.on('dialog', async (d) => d.accept());
    await navigate(page, `#bookings/${ids.booking}`, 'Approve extension');
    await value(page, 'New exclusive end date', extended);
    await value(page, 'Reason', 'Synthetic extension');
    await click(page, 'Approve extension');
    await waitText(page, 'Booking extended.');
    assert.equal(
      isoDate(
        new Date((await q('SELECT end_date FROM bookings WHERE id=$1', [ids.booking]))[0].end_date),
      ),
      extended,
    );
    await navigate(page, `#check-ins/${ids.checkin}`, 'Check out resident');
    await click(page, 'Check out resident');
    await waitText(page, 'Resident checked out.');
    await navigate(page, `#residents/${ids.resident}/profile`, 'No active stay');
    await click(page, 'Stay History');
    await waitText(page, 'Check-out');
    await waitText(page, 'Booking Extended');
    await navigate(page, '#check-ins', '0 of');
    await pick(page, 'Show', 'CHECKED_OUT');
    await waitText(page, 'Synthetic Corrected');
  });
  await scenario(
    'W10 register/search resident, edit inventory, stable floor filter and archive confirmation',
    async () => {
      await navigate(page, '#residents/new', 'First name');
      await value(page, 'First name', 'Independent');
      await value(page, 'Last name', 'Synthetic');
      await click(page, 'Register resident');
      await waitText(page, 'Edit details');
      await navigate(page, '#residents', 'Residents');
      await value(page, 'Search', 'Independent');
      await click(page, 'Search');
      await waitText(page, 'Independent Synthetic');
      await settled(page);
      await navigate(page, `#floors/${ids.property}/${ids.floor}`, 'Edit details');
      await click(page, 'Edit details');
      await value(page, 'Label', 'Audit Ground Edited');
      await click(page, 'Save changes');
      await waitText(page, 'Details saved.');
      await navigate(page, `#rooms/${ids.property}/${ids.room}`, 'Edit details');
      await click(page, 'Edit details');
      await value(page, 'Label', 'Audit Room Edited');
      await click(page, 'Save changes');
      await waitText(page, 'Details saved.');
      await navigate(page, `#floors/${ids.property}/new`, 'Ordinal');
      await value(page, 'Label', 'Empty Audit Floor');
      await value(page, 'Ordinal', '1');
      await click(page, 'Add floor');
      await settled(page);
      const extraFloor = (
        await q("SELECT id FROM floors WHERE property_id=$1 AND label='Empty Audit Floor'", [
          ids.property,
        ])
      )[0].id;
      await navigate(page, `#rooms/${ids.property}`, 'Floor');
      await pick(page, 'Floor', ids.floor);
      await settled(page);
      const options = await (
        await field(page, 'Floor')
      ).evaluate((el) => [...el.options].map((o) => o.value));
      assert.ok(options.includes(extraFloor), 'Empty floor disappears after filtering');
      assert.equal(new Set(options).size, options.length);
      await navigate(page, `#floors/${ids.property}/${extraFloor}`, 'Archive floor');
      // Replace the automatic confirmation listener to explicitly verify cancellation is harmless.
      page.removeAllListeners('dialog');
      page.once('dialog', async (d) => d.dismiss());
      await click(page, 'Archive floor');
      await settled(page);
      assert.equal(
        (await q('SELECT archived_at FROM floors WHERE id=$1', [extraFloor]))[0].archived_at,
        null,
      );
      page.on('dialog', async (d) => d.accept());
      await click(page, 'Archive floor');
      await waitText(page, 'Floor archived.');
      assert.ok(
        (await q('SELECT archived_at FROM floors WHERE id=$1', [extraFloor]))[0].archived_at,
      );
      await navigate(page, `#beds/${ids.room}/${ids.bed2}`, 'Archive bed');
      await click(page, 'Archive bed');
      await waitText(page, 'Bed archived.');
    },
  );
  await scenario('W11 monthly invoice generation skips the existing invoice', async () => {
    await navigate(page, '#finance/invoices/new', 'Generate monthly invoices');
    await click(page, 'Generate invoices');
    await waitText(page, 'No new invoices');
    assert.equal(
      (await q('SELECT count(*)::int n FROM invoices WHERE booking_id=$1', [ids.booking]))[0].n,
      1,
    );
  });
  await scenario(
    'W12 reverse and replace payment preserves history and credited balance',
    async () => {
      await navigate(page, `#finance/invoices/${ids.invoice}`, 'Payment history');
      assert.equal(await hasButton(page, 'Void invoice'), false);
      await click(page, 'Reverse');
      await value(page, 'Reason', 'Synthetic correction of payment');
      await click(page, 'Reverse payment');
      await waitText(page, 'reversed.');
      await settled(page);
      await click(page, 'Record replacement');
      await value(page, 'Amount', '1000');
      await click(page, 'Record payment');
      await waitText(page, 'Payment of');
      await settled(page);
      assert.equal(
        (await q('SELECT count(*)::int n FROM payments WHERE invoice_id=$1', [ids.invoice]))[0].n,
        2,
      );
      assert.equal(
        (
          await q('SELECT count(*)::int n FROM payment_reversals WHERE invoice_id=$1', [
            ids.invoice,
          ])
        )[0].n,
        1,
      );
      await waitText(page, '3,500.00');
      await waitText(page, 'Replacement');
      await click(page, 'Receipts');
      await waitText(page, 'REVERSED');
      await waitText(page, 'no longer valid');
    },
  );
  await scenario(
    'X04 skip link preserves the route; password dialog traps focus; dark screens fit',
    async () => {
      await navigate(page, '#finance/invoices', 'Invoices');
      const hash = new URL(page.url()).hash;
      await page.$eval('.skip-link', (el) => el.focus());
      await page.keyboard.press('Enter');
      assert.equal(new URL(page.url()).hash, hash);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'main');
      await click(page, 'Change password');
      await page.waitForSelector('[role=dialog]');
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        assert.ok(
          await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))),
        );
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.$('[role=dialog]'), null);
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
      for (const [hash, name] of [
        ['#finance', 'finance'],
        ['#corrections/new', 'correction'],
        [`#residents/${ids.resident}/profile`, 'profile'],
      ]) {
        await page.setViewport({ width: 390, height: 844 });
        await navigate(page, hash);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
        await page.screenshot({ path: `${SHOTS}/dark-${name}-390.png`, fullPage: true });
      }
      await page.emulateMediaFeatures([]);
      await page.setViewport({ width: 1440, height: 1000 });
    },
  );
  await scenario('R02 manager route sweep at all three viewport widths', async () => {
    const manager = await newSession(A.pm);
    try {
      for (const width of [1440, 768, 390]) {
        await manager.setViewport({ width, height: 1000 });
        for (const [name, hash, expected] of routes()) {
          await go(manager, hash);
          await settled(manager);
          const content = await textOf(manager);
          const metrics = await manager.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
          }));
          scans.push({
            role: 'PROPERTY_MANAGER',
            name,
            hash,
            width,
            expectedContent: content.toLowerCase().includes(expected.toLowerCase()),
            ...metrics,
          });
        }
      }
      const checks = scans.filter((s) => s.role === 'PROPERTY_MANAGER');
      assert.ok(checks.every((s) => s.expectedContent && s.scrollWidth <= s.width + 1));
      assert.deepEqual(manager.errors, []);
    } finally {
      await manager.browserContext().close();
    }
  });
  await scenario(
    'P01 role label, navigation and settings pages for OWNER and PROPERTY_MANAGER',
    async () => {
      const navigation = {};
      for (const [user, label] of [
        [A.owner, 'Owner'],
        [A.pm, 'Property manager'],
      ]) {
        const session = await newSession(user);
        try {
          await navigate(session, '#overview', 'Property management');
          const sidebarRole = await session.evaluate(
            () => document.querySelector('.workspace-name small')?.textContent?.trim() ?? '',
          );
          assert.equal(sidebarRole, label, `sidebar role for ${label}`);
          const menuRole = await session.evaluate(
            () => document.querySelector('.user-menu-who small')?.textContent ?? '',
          );
          assert.ok(menuRole.includes(label), `user menu role for ${label}: ${menuRole}`);
          assert.ok(!(await textOf(session)).includes('Unsupported role'));
          navigation[label] = await session.evaluate(() =>
            [...document.querySelectorAll('nav[aria-label="Primary navigation"] a')].map((a) =>
              a.textContent.trim(),
            ),
          );
          // Every sidebar destination opens for this role without an error state.
          for (const [, hash, expected] of routes().slice(-4)) {
            await navigate(session, hash, expected);
            assert.ok(!(await textOf(session)).includes('Try again'), `${label} ${hash}`);
          }
        } finally {
          await session.browserContext().close();
        }
      }
      assert.ok(navigation.Owner.length >= 10, `owner navigation: ${navigation.Owner}`);
      assert.deepEqual(
        navigation.Owner,
        navigation['Property manager'],
        'both roles see the same navigation',
      );
    },
  );
  await scenario(
    'P02 a session revoked mid-use returns to sign-in with a clear notice (real 401)',
    async () => {
      const session = await newSession(A.pm2);
      try {
        await navigate(session, '#bookings', 'Bookings');
        await q(
          "UPDATE sessions SET revoked_at=now(), revoked_reason='e2e-p02' WHERE user_id=$1 AND revoked_at IS NULL",
          [A.pm2.userId],
        );
        await go(session, '#enquiries');
        await session.waitForSelector('#login-email', { timeout: 15_000 });
        assert.ok((await textOf(session)).includes('Your session has ended'), 'notice shown');
        assert.ok(
          !(await textOf(session)).includes('Enquiries'.concat(' and')),
          'no protected content',
        );
        await signIn(session, A.pm2);
        await navigate(session, '#bookings', 'Bookings');
      } finally {
        await session.browserContext().close();
      }
    },
  );
  await scenario(
    'P03 a deactivated membership loses access on the next request and cannot sign back in',
    async () => {
      const session = await newSession(B.pm2);
      try {
        await navigate(session, '#residents', 'Residents');
        await q("UPDATE memberships SET status='REVOKED', revoked_at=now() WHERE user_id=$1", [
          B.pm2.userId,
        ]);
        await go(session, '#bookings');
        await session.waitForSelector('#login-email', { timeout: 15_000 });
        assert.ok((await textOf(session)).includes('Your session has ended'));
        await session.type('#login-email', B.pm2.email);
        await session.type('#login-password', TEST_PASSWORD);
        await session.keyboard.press('Enter');
        await waitText(session, 'incorrect');
        assert.ok(await session.$('#login-email'), 'still on the sign-in page');
      } finally {
        await q("UPDATE memberships SET status='ACTIVE', revoked_at=NULL WHERE user_id=$1", [
          B.pm2.userId,
        ]);
        await session.browserContext().close();
      }
    },
  );
  await scenario(
    'P04 a temporary password enforced mid-session shows the password page (real 403)',
    async () => {
      const session = await newSession(B.owner2);
      try {
        await navigate(session, '#finance', 'Monthly collection overview');
        await q('UPDATE users SET password_change_required=true WHERE id=$1', [B.owner2.userId]);
        await go(session, '#bookings');
        await waitText(session, 'Choose your password');
        assert.ok(!(await textOf(session)).includes('Request failed'), 'no raw failure text');
        for (const width of [1440, 768, 390]) {
          await session.setViewport({ width, height: 900 });
          assert.ok(
            await session.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          );
        }
      } finally {
        await q('UPDATE users SET password_change_required=false WHERE id=$1', [B.owner2.userId]);
        await session.browserContext().close();
      }
    },
  );
  await scenario(
    'S01 settings sections show real data and the account password change works',
    async () => {
      const orgName = (await q('SELECT name FROM organizations WHERE id=$1', [A.orgId]))[0].name;
      const propertyName = (await q('SELECT name FROM properties WHERE id=$1', [ids.property]))[0]
        .name;
      const owner = await newSession(A.owner);
      try {
        await navigate(owner, '#settings/organization', 'Organization profile');
        const organization = await textOf(owner);
        assert.ok(organization.includes(orgName) && organization.includes('Owner'));
        await navigate(owner, '#settings/properties', 'Property configuration');
        const properties = await textOf(owner);
        assert.ok(properties.includes(propertyName) && properties.includes('Manage properties'));
        for (const [section, heading] of [
          ['access', 'Staff accounts'],
          ['notifications', 'Notification preferences'],
          ['billing', 'Billing configuration'],
        ]) {
          await navigate(owner, `#settings/${section}`, heading);
          assert.ok(
            (await textOf(owner)).includes('Not available yet'),
            `${section} is honest about what is missing`,
          );
        }
      } finally {
        await owner.browserContext().close();
      }
      const before = (await q('SELECT password_hash FROM users WHERE id=$1', [B.pm.userId]))[0]
        .password_hash;
      const session = await newSession(B.pm);
      const next = `Settings-${randomUUID()}-new`;
      try {
        await navigate(session, '#settings/account', 'Change password');
        await session.type('#cp-current', TEST_PASSWORD);
        await session.type('#cp-new', next);
        await session.type('#cp-confirm', next);
        // "Change password" is also the user-menu button label, so submit this form by its own button.
        await session.click(
          'section[aria-labelledby="account-title"] form button:not([type="button"])',
        );
        await waitText(session, 'Password changed.');
        assert.equal(await session.$eval('#cp-current', (el) => el.value), '', 'form is cleared');
        assert.notEqual(
          (await q('SELECT password_hash FROM users WHERE id=$1', [B.pm.userId]))[0].password_hash,
          before,
        );
      } finally {
        await session.browserContext().close();
      }
      const again = await newSession();
      try {
        await again.waitForSelector('#login-email');
        await again.type('#login-email', B.pm.email);
        await again.type('#login-password', next);
        await again.keyboard.press('Enter');
        await waitText(again, 'Property manager');
      } finally {
        await again.browserContext().close();
      }
    },
  );
  await scenario(
    'S02 resident profile shows the full record, document status and invoice payment history',
    async () => {
      const residentId = (await q('SELECT resident_id FROM invoices WHERE id=$1', [ids.invoice]))[0]
        .resident_id;
      await q(
        `UPDATE residents SET date_of_birth='1999-04-02', gender='FEMALE', address='12 Synthetic Lane, Pune',
         emergency_contact_name='Synthetic Guardian', emergency_contact_relation='Parent', emergency_contact_phone='9000000099'
       WHERE id=$1`,
        [residentId],
      );
      const session = await newSession(A.owner);
      try {
        for (const width of [1440, 768, 390]) {
          await session.setViewport({ width, height: 1000 });
          await navigate(session, `#residents/${residentId}/profile`, 'Resident Information');
          await waitText(session, 'Synthetic Guardian');
          const text = await textOf(session);
          for (const expected of [
            '12 Synthetic Lane, Pune',
            '2 Apr 1999',
            'Female',
            'Documents and KYC',
            'Verification',
          ])
            assert.ok(text.includes(expected), `${expected} at ${width}`);
          assert.ok(
            await session.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `no overflow at ${width}`,
          );
        }
        await session.setViewport({ width: 1440, height: 1000 });
        await click(session, 'Financial');
        await waitText(session, 'Invoice history');
        await click(session, 'View payments');
        await session.waitForSelector('a[href^="#finance/receipt/"]', { timeout: 15_000 });
        const history = await textOf(session);
        assert.ok(history.includes('Balance') && history.includes('Hide payments'));
        await session.screenshot({ path: `${SHOTS}/resident-payment-history.png`, fullPage: true });
      } finally {
        await session.browserContext().close();
      }
    },
  );
  await scenario('A04 forced password change is protected, responsive and saves', async () => {
    await q('UPDATE users SET password_change_required=true WHERE id=$1', [A.owner2.userId]);
    const forced = await newSession(A.owner2);
    try {
      await waitText(forced, 'Choose your password');
      for (const width of [1440, 768, 390]) {
        await forced.setViewport({ width, height: 900 });
        await forced.screenshot({ path: `${SHOTS}/forced-password-${width}.png`, fullPage: true });
        assert.ok(
          await forced.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
      }
      await forced.type('#cp-current', TEST_PASSWORD);
      const password = `Audit-${randomUUID()}-updated`;
      await forced.type('#cp-new', password);
      await forced.type('#cp-confirm', password);
      await click(forced, 'Change password');
      await waitText(forced, 'Sign out');
      await settled(forced);
      assert.equal(
        (await q('SELECT password_change_required FROM users WHERE id=$1', [A.owner2.userId]))[0]
          .password_change_required,
        false,
      );
    } finally {
      await forced.browserContext().close();
    }
  });
  await scenario('A03 logout clears protected UI and returning session', async () => {
    await click(page, 'Sign out');
    await page.waitForSelector('#login-email');
    await navigate(page, '#finance/invoices', 'Welcome');
    assert.ok(await page.$('#login-email'));
    await signIn(page, A.owner);
    await settled(page);
    // Revoke only this disposable account's sessions to test real 401 session expiry.
    await q('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [A.owner.userId]);
    await navigate(page, '#residents', 'Welcome');
    assert.ok(await page.$('#login-email'));
  });
} catch (error) {
  results.push({ name: 'HARNESS', ok: false, error: String(error.stack ?? error) });
} finally {
  writeFileSync(
    `${SHOTS}/results.json`,
    JSON.stringify(
      {
        phase: PHASE,
        scope: 'real Chrome + Vite + Nest + disposable PostgreSQL; synthetic records only',
        results,
        scans,
        probes,
        pageErrors: page?.errors ?? [],
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await admin.end();
  await shutdown();
  console.log(
    JSON.stringify({
      phase: PHASE,
      passed: results.filter((r) => r.ok === true).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => r.ok === false).length,
      routeViewportChecks: scans.length,
      artifacts: SHOTS,
    }),
  );
  if (results.some((r) => r.ok === false)) process.exitCode = 1;
}
