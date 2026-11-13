/** Browser checks of the real transfer React components using explicit API fixtures.
 * These are NOT the PostgreSQL T1–T10 transfer execution acceptance scenarios.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
const root = resolve(import.meta.dirname, '../..');
const web = 'http://127.0.0.1:5299';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const paged = items => ({ items, total: items.length, page: 1, totalPages: 1, limit: 20 });
const location = { propertyId: id(2), propertyName: 'Test House', roomId: id(3), roomLabel: 'Room A', bedId: id(4), bedLabel: 'Bed A' };
const booking = { id: id(5), ...location, startDate: '2026-01-01', endDate: '2090-01-01', monthlyPrice: '5000.00', status: 'CONFIRMED', paymentStatus: 'PENDING', extensions: [] };
const resident = { id: id(1), firstName: 'Transfer', lastName: 'Resident', status: 'ACTIVE' };
let unavailable = false, previewError = false, history = false;
let previewCalls = 0, writes = 0, passed = 0;
const preview = () => ({ advisory: true, executionEnabled: false, allowedActions: ['preview'], executionBlockers: ['REQUESTER_REVIEWER_CONTRACT'],
  effectiveAt: '2026-11-15T08:00:00Z', available: !unavailable, transferType: 'BED_TRANSFER', currentAssignment: location,
  destination: { ...location, bedId: id(6), bedLabel: 'Bed B', operationalStatus: 'IN_SERVICE' }, booking,
  staleState: null, unresolvedDecisions: ['D6: Resident confirmation awaits owner decision'], conflicts: unavailable ? [{ bedId: id(6) }] : [],
  finance: { monthlyPrice: '5000.00', sourceReferencePrice: '5000.00', destinationReferencePrice: '5500.00', referencePriceDifference: '500.00',
    rentUnchanged: true, proration: false, issuedInvoicesUnchanged: true, reviewRequired: true, reviewPeriod: '2026-11-01', reviewSupported: false } });
function response(path) {
  if (path === '/auth/me') return { data: { user: { id: id(9), displayName: 'Owner', role: 'OWNER', organization: { id: id(10), name: 'Fixture' }, passwordChangeRequired: false } } };
  if (path.endsWith('/stay-summary')) return { resident, currentStayStatus: 'ACTIVE', allowedActions: ['transferPreview'],
    currentStay: { booking, admission: null, activeCheckIn: { id: id(11), bedId: id(4), checkInAt: '2026-01-01T08:00:00Z' } }, upcomingBookings: [], lastCheckOut: null };
  if (path === '/properties') return { data: [{ id: id(2), name: 'Test House' }] };
  if (path === `/properties/${id(2)}/rooms`) return { data: [{ id: id(3), label: 'Room A' }] };
  if (path === `/rooms/${id(3)}/beds`) return { data: [{ id: id(4), label: 'Bed A', operationalStatus: 'IN_SERVICE' },
    { id: id(6), label: 'Bed B', operationalStatus: 'IN_SERVICE' }, { id: id(7), label: 'Bed C', operationalStatus: 'OUT_OF_SERVICE', outOfServiceReason: 'Repair' }] };
  if (path === '/transfers/preview') { previewCalls++; return preview(); }
  if (path === '/transfers/history') return paged(history ? [{ id: id(12), type: 'BED_TRANSFER', source: location,
    destination: { ...location, bedLabel: 'Bed B' }, financeReviews: [{ id: id(14), periodStart: '2026-11-01', status: 'REVIEW_REQUIRED' }], reason: '<script>unsafe()</script>', actor: { id: id(9), displayName: 'Owner' },
    effectiveAt: '2026-11-15T08:00:00Z', recordedAt: '2026-11-15T08:00:01Z' }] : []);
  if (path.endsWith('/history')) return paged([]);
  throw new Error(`Unhandled fixture: ${path}`);
}
const child = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5299', '--strictPort'], {
  cwd: resolve(root, 'apps/web'), env: { PATH: process.env.PATH, HOME: process.env.HOME, VITE_API_BASE: '/api/v1', DOTENV_CONFIG_PATH: '/dev/null', NOOK_ISOLATED_TEST_RUN: '1' }, stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; ; i++) { try { if ((await fetch(web)).ok) break; } catch { /* Vite is still starting. */ } assert.ok(i < 100, 'Vite did not start'); await new Promise(r => setTimeout(r, 100)); }
  browser = await puppeteer.launch({ executablePath: process.env.NOOK_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', r => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith('/api/v1')) return void r.continue();
    if (r.method() !== 'GET') { writes++; return void r.respond({ status: 500, body: '{}' }); }
    const path = url.pathname.slice(7);
    if (path === '/transfers/preview' && previewError) return void r.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'CONFLICT', message: 'Destination changed; preview again' }) });
    return void r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(response(path)) });
  });
  const text = value => page.waitForFunction(t => document.body.innerText.includes(t), { timeout: 10000 }, value);
  const click = async label => { const h = await page.$(`xpath/.//button[normalize-space()="${label}"]`); assert.ok(h, `Button ${label}`); await h.click(); };
  const check = async (name, run) => { await run(); passed++; console.log(`PASS UI${passed}: ${name}`); };
  await page.goto(`${web}/#residents/${id(1)}/profile`, { waitUntil: 'networkidle0' });
  await check('active stay exposes transfer action and destination picker', async () => { await click('Transfer'); await text('Select property'); });
  await page.waitForFunction(() => document.querySelectorAll('select')[0]?.options.length > 1);
  await page.select('select', id(2));
  await page.waitForFunction(() => document.querySelectorAll('select')[1]?.options.length > 1);
  const selects = await page.$$('select');
  await selects[1].select(id(3));
  await page.waitForFunction(() => document.querySelectorAll('select')[2]?.options.length > 1);
  await check('current bed is excluded and out-of-service bed cannot be selected', async () => {
    const options = await page.evaluate(() => [...document.querySelectorAll('select')[2].options].map(o => ({ value: o.value, disabled: o.disabled })));
    assert.ok(!options.some(o => o.value === id(4)));
    assert.equal(options.find(o => o.value === id(7)).disabled, true);
  });
  await selects[2].select(id(6));
  await check('preview displays the physical move and financial review without enabling execution', async () => {
    await click('Preview transfer'); await text('Financial review required'); await text('Monthly rent unchanged'); await text('difference: ₹500.00');
    const confirm = await page.$('xpath/.//button[normalize-space()="Confirm transfer"]');
    assert.equal(await confirm.evaluate(e => e.disabled), true); assert.equal(writes, 0);
  });
  await check('occupied destination clearly reports conflicts', async () => { unavailable = true; await click('Preview transfer'); await text('Destination unavailable: 1 conflicting allocation(s)'); });
  await check('preview conflicts can be retried without reloading the document', async () => {
    previewError = true; await click('Preview transfer'); await text('Destination changed; preview again');
    previewError = false; unavailable = false; await click('Preview transfer'); await text('Monthly rent unchanged'); assert.equal(previewCalls, 3);
  });
  await click('Close');
  await check('transfer history has a clear empty state', async () => { await click('Corrections'); await text('No transfers'); });
  await check('completed history displays source, destination, actor and escaped reason', async () => {
    history = true; await click('Overview'); await click('Corrections'); await text('Transfer history'); await text('<script>unsafe()</script>'); await text('Finance review · 2026-11-01: REVIEW REQUIRED');
    assert.equal(await page.evaluate(() => typeof window.unsafe), 'undefined'); await text('Bed A →'); await text('Bed B');
  });
  assert.deepEqual(errors, []); assert.equal(writes, 0);
  console.log(`${passed}/7 transfer UI browser checks passed; fixture APIs only; T1–T10 execution acceptance remains blocked.`);
} finally { await browser?.close(); child.kill('SIGTERM'); }
