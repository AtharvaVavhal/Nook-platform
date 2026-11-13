/** Browser regression of actual React routing with explicit API fixtures.
 * NOT API/PostgreSQL lifecycle acceptance. No database, credentials or real tenant data are used.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
const root = resolve(import.meta.dirname, '../..');
const web = 'http://127.0.0.1:5298';
const artifacts = '/tmp/nook-p4-navigation';
mkdirSync(artifacts, { recursive: true });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const resident = { id: id(1), firstName: 'Route', lastName: 'Resident', status: 'ACTIVE' };
const property = {
  id: id(2),
  code: 'P1',
  name: 'Route House',
  archivedAt: null,
  createdAt: '2026-11-01T00:00:00Z',
};
const floor = { id: id(3), label: 'Ground', ordinal: 0, propertyId: property.id };
const room = { id: id(4), label: 'Room One', floorId: floor.id, floor, propertyId: property.id };
const bed = { id: id(5), label: 'Bed One', operationalStatus: 'AVAILABLE', price: '5000.00', room };
const booking = {
  id: id(6),
  residentId: resident.id,
  resident,
  bedId: bed.id,
  bed,
  status: 'CONFIRMED',
  paymentStatus: 'PENDING',
  startDate: '2026-11-01T00:00:00Z',
  endDate: '2026-12-01T00:00:00Z',
  monthlyPrice: '5000.00',
};
const list = (items) => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  totalPages: items.length ? 1 : 0,
});
let summaryRequests = 0;
let failSummary = false;
const missing = [];
function response(path) {
  if (path === '/auth/me')
    return {
      data: {
        user: {
          id: id(9),
          displayName: 'Route Owner',
          role: 'OWNER',
          organization: { id: id(10), name: 'Navigation fixture' },
          passwordChangeRequired: false,
        },
      },
    };
  if (path === `/residents/${resident.id}`) return resident;
  if (path === '/residents') return list([resident]);
  if (path.endsWith('/stay-summary')) {
    summaryRequests++;
    return {
      resident,
      currentStay: null,
      currentStayStatus: 'NO_ACTIVE_STAY',
      upcomingBookings: [],
      lastCheckOut: null,
      financeBalance: {
        totals: {
          outstandingAmount: '0',
          outstandingCount: 0,
          overdueAmount: '0',
          overdueCount: 0,
        },
        items: [],
      },
    };
  }
  if (path.endsWith('/history') || path === '/corrections' || path === '/corrections/history')
    return list([]);
  if (path === '/corrections/finance-reviews') return { items: [] };
  if (path === '/properties') return { data: [property] };
  if (path === `/properties/${property.id}`) return { data: property };
  if (path === `/properties/${property.id}/floors`) return { data: [floor] };
  if (path === `/properties/${property.id}/rooms`) return { data: [room] };
  if (path === `/rooms/${room.id}/beds`) return { data: [bed] };
  if (path === `/bookings/${booking.id}`) return booking;
  missing.push(path);
  return {};
}
const child = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    '5298',
    '--strictPort',
  ],
  {
    cwd: resolve(root, 'apps/web'),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      VITE_API_BASE: '/api/v1',
      DOTENV_CONFIG_PATH: '/dev/null',
      NOOK_ISOLATED_TEST_RUN: '1',
    },
    stdio: 'ignore',
  },
);
let browser;
let passed = 0;
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(web)).ok) break;
    } catch {
      /* starting */
    }
    assert.ok(i < 100, 'Vite did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await puppeteer.launch({
    executablePath:
      process.env.NOOK_BROWSER_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith('/api/v1')) return void r.continue();
    assert.equal(r.method(), 'GET', 'Navigation regression must not write');
    const path = url.pathname.slice('/api/v1'.length);
    if (path.endsWith('/stay-summary') && failSummary)
      return void r.respond({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Fixture temporarily unavailable' }),
      });
    void r.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response(path)),
    });
  });
  const waitText = (text) =>
    page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 10_000 }, text);
  const go = async (hash, text) => {
    await page.goto(`${web}/${hash}`, { waitUntil: 'networkidle0' });
    await waitText(text);
  };
  const click = async (text) => {
    for (const tag of ['button', 'a']) {
      for (const handle of await page.$$(`xpath/.//${tag}[normalize-space()="${text}"]`)) {
        if (await handle.isVisible()) {
          await handle.click();
          return;
        }
      }
    }
    throw new Error(`No visible action: ${text}`);
  };
  const scenario = async (name, fn) => {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  };
  await scenario(
    'resident profile is reachable from resident details through a real anchor',
    async () => {
      await go(`#residents/${resident.id}`, 'Edit details');
      await click('Stay profile and history');
      await waitText('No active stay');
      assert.equal(new URL(page.url()).hash, `#residents/${resident.id}/profile`);
    },
  );
  await scenario('profile refresh refetches data without replacing the document', async () => {
    await page.evaluate(() => {
      window.nookNavigationProbe = 'preserved';
    });
    const before = summaryRequests;
    await click('Refresh');
    await page.waitForNetworkIdle();
    assert.ok(summaryRequests > before);
    assert.equal(await page.evaluate(() => window.nookNavigationProbe), 'preserved');
  });
  await scenario('profile corrections and history tabs render their empty states', async () => {
    await click('Corrections');
    await waitText('No corrections');
    await click('Stay History');
    await waitText('No history found');
  });
  await scenario('profile errors retry the data request without a reload', async () => {
    failSummary = true;
    await click('Overview');
    await waitText('Try again');
    await page.evaluate(() => {
      window.nookNavigationProbe = 'retry';
    });
    failSummary = false;
    await click('Try again');
    await waitText('No active stay');
    assert.equal(await page.evaluate(() => window.nookNavigationProbe), 'retry');
  });
  await scenario('all twelve inventory list/detail/new routes render', async () => {
    for (const [hash, text] of [
      ['#properties', 'Route House'],
      ['#properties/new', 'Code'],
      [`#properties/${property.id}`, 'Manage floors'],
      [`#floors/${property.id}`, 'Ground'],
      [`#floors/${property.id}/new`, 'Ordinal'],
      [`#floors/${property.id}/${floor.id}`, 'Edit details'],
      [`#rooms/${property.id}`, 'Room One'],
      [`#rooms/${property.id}/new`, 'Floor'],
      [`#rooms/${property.id}/${room.id}`, 'Manage beds'],
      [`#beds/${room.id}`, 'Bed One'],
      [`#beds/${room.id}/new`, 'Out of service reason'],
      [`#beds/${room.id}/${bed.id}`, 'Edit details'],
    ])
      await go(hash, text);
  });
  await scenario('booking detail exposes the existing extension workflow', async () => {
    await go(`#bookings/${booking.id}`, 'Approve extension');
    await waitText('Full-month billing applies.');
  });
  await scenario('corrections navigation uses real URLs and rendered screens', async () => {
    await go('#corrections/new', 'Request a correction');
    await go('#corrections', 'No corrections');
    await click('Billing reviews');
    await waitText('Billing reviews');
  });
  await scenario('profile renders on mobile without horizontal overflow', async () => {
    await page.setViewport({ width: 390, height: 844 });
    await go(`#residents/${resident.id}/profile`, 'No active stay');
    await page.screenshot({ path: `${artifacts}/resident-mobile.png`, fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  console.log(
    JSON.stringify({
      passed,
      failed: 0,
      skipped: 0,
      scope: 'real Chrome/React; API fixtures; no database acceptance',
    }),
  );
} catch (e) {
  if (browser) {
    const pages = await browser.pages();
    const page = pages.at(-1);
    if (page) {
      console.error((await page.evaluate(() => document.body.innerText)).slice(0, 3000));
      await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
    }
  }
  console.error(e);
  console.log(JSON.stringify({ passed, failed: 1, scope: 'navigation fixture regression' }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  await new Promise((r) => {
    if (child.exitCode !== null) r();
    else child.once('exit', r);
  });
}
