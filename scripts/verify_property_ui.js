/** Optional browser smoke check. Uses externally provisioned Puppeteer + Chromium;
 * no dependency installation or API/database access. See docs/PHASE_1_VALIDATION.md.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.NOOK_BROWSER_MODULE || 'puppeteer');
const artifacts = resolve(process.env.NOOK_UI_ARTIFACTS || '/tmp/nook-phase1-validation');
await mkdir(artifacts, { recursive: true });
const browser = await puppeteer.launch({
  ...(process.env.NOOK_BROWSER_EXECUTABLE
    ? { executablePath: process.env.NOOK_BROWSER_EXECUTABLE }
    : {}),
  headless: true,
  pipe: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewport({ width: 1600, height: 1100 });
  await page.goto(process.env.NOOK_UI_URL || 'http://127.0.0.1:5173', {
    waitUntil: 'networkidle0',
  });
  await page.waitForSelector('.spatial-bed');
  const content = (selector) => page.$eval(selector, (element) => element.textContent);
  const clickText = async (selector, label) => {
    await page.$$eval(
      selector,
      (elements, text) => {
        const target = elements.find((element) => element.textContent.includes(text));
        if (!target) throw new Error(`Missing control: ${text}`);
        target.click();
      },
      label,
    );
  };
  const bed = (room, id) => `.spatial-bed[aria-label^="Room ${room}, bed ${id}:"]`;
  const expectSelection = async (text) => {
    await page.waitForFunction(
      (expected) => document.querySelector('#selection-heading')?.textContent === expected,
      {},
      text,
    );
  };
  assert.equal(await page.$$eval('.plan-room', (elements) => elements.length), 3);
  assert.equal(await page.$$eval('.spatial-bed', (elements) => elements.length), 12);
  assert.match(await content('.availability-strip'), /23.*Occupied/);
  assert.match(await content('.availability-strip'), /10.*Available/);
  assert.match(await content('.availability-strip'), /3.*Unavailable/);
  assert.equal(
    await page.$eval('.brand-lockup img', (img) => img.complete && img.naturalWidth > 0),
    true,
  );
  await page.click(bed('103', 'D'));
  await expectSelection('Room 103 · Bed D');
  assert.match(await content('.selection-panel'), /Operational hold/);
  assert.equal(
    await page.$eval(bed('103', 'D'), (element) => element.getAttribute('aria-pressed')),
    'true',
  );
  await page.screenshot({ path: `${artifacts}/desktop.png`, fullPage: true });
  await clickText('.room-select', 'Room 101');
  await expectSelection('Room 101');
  assert.match(await content('.room-detail-counts'), /2 available/);
  await clickText('.floor-button', 'Second floor');
  await expectSelection('Every space has a story');
  assert.match(await content('.floor-title'), /Second floor/);
  assert.equal(await page.$(bed('103', 'D')), null);
  await page.click(bed('202', 'C'));
  await expectSelection('Room 202 · Bed C');
  assert.match(await content('.bed-details'), /Second floor/);
  await page.select('.status-select select', 'available');
  await expectSelection('Every space has a story');
  assert.equal(await page.$$eval('.spatial-bed:not(:disabled)', (elements) => elements.length), 3);
  await page.type('input[type="search"]', '999');
  await page.waitForSelector('.empty-state');
  assert.match(await content('.empty-state'), /No matching rooms/);
  await page.click('.empty-state button');
  await page.waitForSelector('.spatial-plan');
  await clickText('.floor-button', 'Third floor');
  assert.match(await content('.empty-state'), /A little room to grow/);
  await page.click('.empty-state button');
  await page.waitForSelector(bed('101', 'A'));
  // Keyboard focus and activation use the same native controls as pointer selection.
  await page.focus(bed('101', 'C'));
  await page.keyboard.press('Enter');
  await expectSelection('Room 101 · Bed C');
  assert.match(await content('.selection-panel'), /Available · Demo/);
  await page.focus('button[aria-label="Clear selection"]');
  await page.keyboard.press('Space');
  await expectSelection('Every space has a story');
  await page.click('a[aria-label="Explore Ground floor"]');
  assert.match(await content('.floor-title'), /Ground floor/);
  await page.click('.snapshot-labels a:last-child');
  assert.equal(
    await page.$eval('.status-select select', (element) => element.value),
    'unavailable',
  );
  assert.equal(await page.$$eval('.spatial-bed:not(:disabled)', (elements) => elements.length), 1);
  await page.click(bed('002', 'D'));
  await expectSelection('Room 002 · Bed D');
  await clickText('.floor-button', 'First floor');
  await page.click(bed('101', 'C'));
  for (const width of [320, 390, 768, 1024, 1440, 1600]) {
    await page.setViewport({ width, height: 900 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      console.log(
        await page.$$eval('body *', (items) =>
          items
            .filter(
              (el) =>
                el.getBoundingClientRect().right > innerWidth &&
                !el.closest('.spatial-plan, .inventory-table'),
            )
            .map((el) => ({
              tag: el.tagName,
              cls: el.className,
              width: el.getBoundingClientRect().width,
              right: el.getBoundingClientRect().right,
            })),
        ),
      );
    }

    await page.setViewport({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `Page overflow at ${width}`,
    );
    assert.equal(
      await page.$$eval('.spatial-bed', (elements) =>
        elements.every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44;
        }),
      ),
      true,
      `Small bed target at ${width}`,
    );
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.click('.mobile-menu');
  assert.equal(
    await page.$eval('.mobile-menu', (element) => element.getAttribute('aria-expanded')),
    'true',
  );
  await page.click('.workspace-navigation a[href="#floor-plan"]');
  assert.equal(
    await page.$eval('.mobile-menu', (element) => element.getAttribute('aria-expanded')),
    'false',
  );
  await page.$eval('.plan-scroll', (element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await page.click(bed('103', 'D'));
  await expectSelection('Room 103 · Bed D');
  await page.click('.selection-jump');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'selection-details');
  await page.screenshot({ path: `${artifacts}/mobile.png`, fullPage: true });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.keyboard.press('Tab');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real HTTP frontend; source totals, logo, room/bed selection, floor switching, filters, empty recovery, keyboard activation, inventory links, mobile navigation, scrollable plan and details focus; no page or HTTP errors.',
  );
  console.log('PASS: no document overflow and bed targets >=44px at 320/390/768/1024/1440/1600px.');
  console.log(`Screenshots: ${artifacts}/desktop.png and ${artifacts}/mobile.png`);
} finally {
  await browser.close();
}
