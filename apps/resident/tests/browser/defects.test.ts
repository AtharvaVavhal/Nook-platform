// Browser regression tests for the seven defects found in the Resident Portal review. They run in headless Chrome against a
// production build of the portal and a synthetic contract server (tests/helpers/fake-api.ts). Run: npm run test:browser
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Browser, BrowserContext, Page } from 'puppeteer-core';
import { buildProduction, findChrome, launch } from '../helpers/browser.js';
import { IDS, startFakeApi } from '../helpers/fake-api.js';

const chrome = findChrome();
const skip = chrome
  ? false
  : 'no Chrome/Chromium found (set CHROME_PATH to run the browser regression tests)';
let api: Awaited<ReturnType<typeof startFakeApi>>;
let browser: Browser;

before(async () => {
  if (!chrome) return;
  api = await startFakeApi(buildProduction());
  browser = await launch(chrome);
});
after(async () => {
  await browser?.close();
  await api?.close();
});

async function open(
  width = 390,
  height = 800,
  opts: { session?: boolean } = {},
): Promise<{ page: Page; ctx: BrowserContext }> {
  api.behavior.verifyMode = 'ok';
  api.behavior.meFailsOnce = null;
  api.behavior.dataset = 'normal';
  api.log.length = 0;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch: width < 1024 });
  if (opts.session)
    await page.setCookie({ name: 'nook_resident_session', value: 'fake', url: api.url });
  return { page, ctx };
}
async function toCodeScreen(page: Page): Promise<void> {
  await page.goto(`${api.url}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#phone');
  await page.type('#phone', '9876543210');
  await page.click('button[type=submit]');
  await page.waitForSelector('#otp');
}
const greeting = (page: Page) =>
  page.waitForFunction(
    () =>
      /^Good (morning|afternoon|evening), /.test(
        document.querySelector('h1#page-title')?.textContent ?? '',
      ),
    { timeout: 8000 },
  );
async function signOut(page: Page): Promise<void> {
  await page.click('.rp-avatar-btn');
  await page.evaluate(() =>
    (
      Array.from(document.querySelectorAll('.rp-menu__item')).find((b) =>
        /Sign out/.test(b.textContent ?? ''),
      ) as HTMLElement
    ).click(),
  );
  await page.waitForSelector('#phone');
}
const active = (page: Page) =>
  page.evaluate(() => ({
    id: document.activeElement?.id ?? '',
    tag: document.activeElement?.tagName ?? '',
    disabled: (document.querySelector('#otp') as HTMLInputElement | null)?.disabled,
    readOnly: (document.querySelector('#otp') as HTMLInputElement | null)?.readOnly,
  }));

test(
  'valid session: a correct code signs in and shows the signed-in app with no error',
  { skip },
  async () => {
    const { page, ctx } = await open();
    await toCodeScreen(page);
    await page.type('#otp', '123456');
    await greeting(page);
    assert.equal(await page.$('[role=alert]'), null, 'no error is shown');
    assert.ok(await page.$('.rp-avatar-btn'), 'the signed-in shell is shown');
    await ctx.close();
  },
);

test(
  'defect 1: after an incorrect code the OTP field is enabled, focused and takes the next code immediately',
  { skip },
  async () => {
    const { page, ctx } = await open();
    await toCodeScreen(page);
    await page.type('#otp', '000000');
    await page.waitForSelector('[role=alert]');
    await page
      .waitForFunction(
        () => {
          const i = document.querySelector('#otp') as HTMLInputElement | null;
          return !!i && !i.disabled && !i.readOnly && document.activeElement === i;
        },
        { timeout: 4000 },
      )
      .catch(() => {});
    const state = await active(page);
    assert.equal(state.id, 'otp', `focus must be on the code field, not ${state.tag}`);
    assert.equal(state.disabled, false);
    assert.equal(state.readOnly, false);
    await page.keyboard.type('123456'); // no click: the user can type the next code at once
    await greeting(page);
    await ctx.close();
  },
);

test(
  'defect 2: a code accepted without a usable session shows a clear error, never an authenticated state, and can be retried without reloading',
  { skip },
  async () => {
    const { page, ctx } = await open();
    api.behavior.verifyMode = 'no-cookie';
    await toCodeScreen(page);
    await page.evaluate(() => {
      (window as unknown as Record<string, boolean>).__sameDocument = true;
    });
    await page.type('#otp', '123456');
    await page.waitForFunction(
      () =>
        /couldn.t finish signing you in/i.test(
          document.querySelector('[role=alert]')?.textContent ?? '',
        ),
      { timeout: 8000 },
    );
    const text = await page.evaluate(() => document.body.innerText);
    assert.equal(await page.$('.rp-avatar-btn'), null, 'must not look signed in');
    assert.doesNotMatch(
      text,
      /nook_resident|csrf|token|fake=|set-cookie/i,
      'no cookie, token or internals are shown',
    );
    assert.match(text, /new code|try again/i, 'the message says what to do');
    // retry in the same document: the session now works
    api.behavior.verifyMode = 'ok';
    await page.waitForFunction(
      () => {
        const b = Array.from(document.querySelectorAll('button')).find((x) =>
          /^Resend code$/.test((x.textContent ?? '').trim()),
        );
        return !!b && !(b as HTMLButtonElement).disabled;
      },
      { timeout: 8000 },
    );
    await page.evaluate(() =>
      (
        Array.from(document.querySelectorAll('button')).find((x) =>
          /^Resend code$/.test((x.textContent ?? '').trim()),
        ) as HTMLElement
      ).click(),
    );
    await page
      .waitForFunction(() => document.activeElement?.id === 'otp', { timeout: 4000 })
      .catch(() => {});
    await page.click('#otp');
    await page.keyboard.type('123456');
    await greeting(page);
    assert.equal(
      await page.evaluate(() => (window as unknown as Record<string, boolean>).__sameDocument),
      true,
      'no page reload was needed',
    );
    await ctx.close();
  },
);

test(
  'defect 2 (failed session initialisation): GET /me failing after a good code shows an error with Try again, then recovers without reloading',
  { skip },
  async () => {
    const { page, ctx } = await open();
    api.behavior.meFailsOnce = 500;
    await toCodeScreen(page);
    await page.evaluate(() => {
      (window as unknown as Record<string, boolean>).__sameDocument = true;
    });
    await page.type('#otp', '123456');
    await page.waitForFunction(() => /Try again/.test(document.body.innerText), { timeout: 8000 });
    assert.equal(await page.$('.rp-avatar-btn'), null, 'must not look signed in');
    assert.doesNotMatch(
      await page.evaluate(() => document.body.innerText),
      /500|statusCode|Internal server error/,
    );
    await page.evaluate(() =>
      (
        Array.from(document.querySelectorAll('button')).find((b) =>
          /Try again/.test(b.textContent ?? ''),
        ) as HTMLElement
      ).click(),
    );
    await greeting(page);
    assert.equal(
      await page.evaluate(() => (window as unknown as Record<string, boolean>).__sameDocument),
      true,
    );
    await ctx.close();
  },
);

test(
  'review F1: when the first session read fails and the cookie never arrives, "Try again" explains what happened, keeps the phone number and lets the resident retry',
  { skip },
  async () => {
    const { page, ctx } = await open();
    api.behavior.verifyMode = 'no-cookie'; // the code is accepted, but the browser never receives a session cookie
    await page.setRequestInterception(true);
    let armed = false;
    let failedOnce = false;
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (armed && !failedOnce && url.pathname === '/api/v1/me') {
        failedOnce = true; // the FIRST session read after the code fails at the network level
        return void req.abort('internetdisconnected');
      }
      void req.continue();
    });
    await page.goto(`${api.url}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#phone');
    armed = true;
    await page.evaluate(() => {
      (window as unknown as Record<string, boolean>).__sameDocument = true;
    });
    await page.type('#phone', '9876543210');
    await page.click('button[type=submit]');
    await page.waitForSelector('#otp');
    await page.type('#otp', '123456');
    await page.waitForFunction(() => /Try again/.test(document.body.innerText), { timeout: 8000 });
    assert.ok(failedOnce, 'the first session read was refused at the network level');
    assert.equal(await page.$('.rp-avatar-btn'), null, 'must not look signed in');

    await page.evaluate(() =>
      (
        Array.from(document.querySelectorAll('button')).find((b) =>
          /Try again/.test(b.textContent ?? ''),
        ) as HTMLElement
      ).click(),
    );
    // The retry finds no session: the resident must be told, not silently returned to a blank sign-in form.
    await page.waitForFunction(
      () =>
        /couldn.t finish signing you in/i.test(
          document.querySelector('[role=alert]')?.textContent ?? '',
        ),
      { timeout: 8000 },
    );
    const screen = await page.evaluate(() => ({
      phone: (document.querySelector('#phone') as HTMLInputElement | null)?.value ?? null,
      signedInShell: !!document.querySelector('.rp-avatar-btn'),
      text: document.body.innerText,
    }));
    assert.equal(screen.phone, '98765 43210', 'the phone number is kept, not lost');
    assert.equal(screen.signedInShell, false, 'must not look signed in');
    assert.match(screen.text, /new code|try again/i, 'the message says what to do');
    assert.doesNotMatch(screen.text, /nook_resident|csrf|token|fake=|401|UNAUTHENTICATED|stack/i);

    // Retry without a silent bounce: starting a new attempt clears the stale message, and the resident signs in.
    api.behavior.verifyMode = 'ok';
    await page.click('button[type=submit]');
    await page.waitForSelector('#otp');
    assert.equal(
      await page.evaluate(() => !!document.querySelector('[role=alert]')),
      false,
      'the old message is cleared once a new attempt begins',
    );
    await page.type('#otp', '123456');
    await greeting(page);
    assert.equal(
      await page.evaluate(() => (window as unknown as Record<string, boolean>).__sameDocument),
      true,
      'no page reload was needed',
    );
    await ctx.close();
  },
);

test(
  'defect 3: at 640px and wider the content padding keeps env(safe-area-inset-left/right) and normal spacing stays intact',
  { skip },
  async (t) => {
    // Capability probe FIRST. If this Chrome cannot emulate safe-area insets the test must be reported as skipped, never as passed:
    // none of the measured-padding assertions below would have run. (src/styles/safearea.test.ts is a source check, not a substitute.)
    const probe = await open(844, 390);
    let supported = true;
    try {
      const client = await probe.page.createCDPSession();
      await client.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      });
    } catch (error) {
      if (!/wasn.?t found|not found|not supported/i.test(String((error as Error).message)))
        throw error; // a real failure (crash, timeout) must not masquerade as "unsupported"
      supported = false;
    } finally {
      await probe.ctx.close();
    }
    if (!supported) {
      t.skip(
        'Chrome cannot emulate safe-area insets (Emulation.setSafeAreaInsetsOverride): the measured padding assertions did NOT run',
      );
      return;
    }
    const cases: Array<{
      w: number;
      h: number;
      insets: { left: number; right: number };
      expectLeft: number | null;
      expectRight: number;
    }> = [
      { w: 844, h: 390, insets: { left: 47, right: 47 }, expectLeft: 47, expectRight: 47 }, // landscape phone with a notch
      { w: 844, h: 390, insets: { left: 0, right: 0 }, expectLeft: 32, expectRight: 32 }, // normal spacing intact
      { w: 639, h: 390, insets: { left: 47, right: 47 }, expectLeft: 47, expectRight: 47 }, // below the breakpoint (already handled)
      { w: 640, h: 390, insets: { left: 47, right: 47 }, expectLeft: 47, expectRight: 47 }, // exactly at the breakpoint
      { w: 1280, h: 800, insets: { left: 60, right: 60 }, expectLeft: null, expectRight: 60 }, // desktop: sidebar owns the left edge
      { w: 1440, h: 900, insets: { left: 0, right: 0 }, expectLeft: 40, expectRight: 40 }, // desktop spacing intact
    ];
    // One subtest per scenario: a failing scenario is reported on its own and never prevents the others from running.
    for (const c of cases) {
      const label = `${c.w}px, insets ${c.insets.left}/${c.insets.right}`;
      await t.test(label, async () => {
        const { page, ctx } = await open(c.w, c.h, { session: true });
        try {
          const client = await page.createCDPSession();
          await client.send('Emulation.setSafeAreaInsetsOverride', {
            insets: { top: 0, bottom: 0, left: c.insets.left, right: c.insets.right },
          });
          await page.goto(`${api.url}/#/`, { waitUntil: 'networkidle0' });
          await page.waitForSelector('h1#page-title');
          const pad = await page.evaluate(() => {
            const s = getComputedStyle(document.querySelector('.rp-content') as Element);
            return { l: parseFloat(s.paddingLeft), r: parseFloat(s.paddingRight) };
          });
          assert.ok(pad.r >= c.expectRight - 0.01, `right padding ${pad.r} at ${label}`);
          if (c.expectLeft !== null)
            assert.ok(pad.l >= c.expectLeft - 0.01, `left padding ${pad.l} at ${label}`);
          if (c.insets.left === 0 && c.insets.right === 0)
            assert.equal(pad.l, c.expectLeft, `normal spacing at ${label}`);
        } finally {
          await ctx.close();
        }
      });
    }
  },
);

test(
  "defect 4: signing in twice in one tab uses fresh CSRF state: each sign-out succeeds first time with the new session's token",
  { skip },
  async () => {
    const { page, ctx } = await open();
    await toCodeScreen(page);
    await page.type('#otp', '123456');
    await greeting(page);
    await signOut(page);
    await page.type('#phone', '9876543210');
    await page.click('button[type=submit]');
    await page.waitForSelector('#otp');
    await page.type('#otp', '123456');
    await greeting(page);
    await signOut(page);
    const logouts = api.log.filter(
      (e) => e.method === 'POST' && e.path === '/resident-auth/logout',
    );
    assert.equal(
      logouts.length,
      2,
      `exactly one logout request per sign-out (got ${logouts.map((l) => l.status)})`,
    );
    assert.ok(
      logouts.every((l) => l.status === 200 && l.csrfMatchesCookie === true),
      JSON.stringify(logouts),
    );
    assert.equal(api.log.filter((e) => e.status === 403).length, 0, 'no CSRF refusal at all');
    await ctx.close();
  },
);

test(
  'defect 5: the two "View all" links keep their visible label but have distinct, meaningful accessible names',
  { skip },
  async () => {
    const { page, ctx } = await open(1440, 900, { session: true });
    await page.goto(`${api.url}/#/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('h1#page-title');
    await page.waitForFunction(() => document.querySelectorAll('a.rp-link').length >= 2);
    const client = await page.createCDPSession();
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const names = nodes
      .filter(
        (n) =>
          !n.ignored && n.role?.value === 'link' && /^View all/.test(String(n.name?.value ?? '')),
      )
      .map((n) => String(n.name?.value).trim());
    assert.equal(names.length, 2, `two View all links expected, got ${JSON.stringify(names)}`);
    assert.equal(new Set(names).size, 2, `accessible names must differ: ${JSON.stringify(names)}`);
    assert.ok(
      names.some((n) => /payments/i.test(n)) && names.some((n) => /invoices/i.test(n)),
      JSON.stringify(names),
    );
    const visible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a.rp-link'))
        .filter((a) => /^View all/.test(a.textContent ?? ''))
        .map((a) => (a.firstChild?.textContent ?? '').trim()),
    );
    assert.deepEqual(visible, ['View all', 'View all'], 'the visible label is unchanged');
    await ctx.close();
  },
);

for (const dataset of ['normal', 'long'] as const) {
  test(
    `defect 7: the receipt and invoice pages do not overflow horizontally at 320px (${dataset} data), without an overflow workaround`,
    { skip },
    async () => {
      for (const hash of [
        `#/payments/receipt/${dataset === 'long' ? IDS.longReceipt : IDS.receipt}`,
        `#/rent/invoice/${dataset === 'long' ? IDS.longInvoice : IDS.invoice}`,
      ]) {
        const { page, ctx } = await open(320, 700, { session: true });
        api.behavior.dataset = dataset;
        await page.goto(`${api.url}/${hash}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('h1#page-title');
        await page.waitForFunction(() => !document.querySelector('[aria-busy=true]'));
        const m = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('.rp-deflist__row')).map((r) => ({
            text: (r.textContent ?? '').trim().slice(0, 40),
            over: r.scrollWidth - r.clientWidth,
          }));
          const amounts = Array.from(
            document.querySelectorAll('.rp-nowrap, .rp-total__amount'),
          ).map((e) => {
            const box = (e.closest('.rp-receipt, .rp-card') as Element).getBoundingClientRect();
            const r = e.getBoundingClientRect();
            return { text: (e.textContent ?? '').trim(), spill: r.right - box.right };
          });
          const clip = [
            'html',
            'body',
            '#root',
            '.rp-shell',
            '.rp-frame',
            '.rp-main',
            '.rp-content',
            '.rp-receipt',
            '.rp-card',
            '.rp-deflist',
          ].filter((s) => {
            const e = document.querySelector(s);
            return e && /hidden|clip/.test(getComputedStyle(e).overflowX) && s !== 'body';
          });
          // Text must never be split mid-word or mid-number: every word (and every amount) must sit on a single line.
          const brokenWords: string[] = [];
          for (const el of Array.from(
            document.querySelectorAll('.rp-deflist dt, .rp-deflist dd, .rp-total__amount'),
          )) {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const text = node.textContent ?? '';
              const isAmount =
                el.classList.contains('rp-total__amount') || el.classList.contains('rp-nowrap');
              const re = isAmount ? /\S+/g : /[A-Za-z]{3,}/g; // amounts are one unit; for prose, the words of the label/value
              for (let m = re.exec(text); m; m = re.exec(text)) {
                const range = document.createRange();
                range.setStart(node, m.index);
                range.setEnd(node, m.index + m[0].length);
                const lines = new Set(
                  Array.from(range.getClientRects()).map((r) => Math.round(r.top)),
                );
                if (lines.size > 1 && (isAmount || el.tagName === 'DT')) brokenWords.push(m[0]);
              }
            }
          }
          return {
            doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            rows: rows.filter((r) => r.over > 0),
            amounts: amounts.filter((a) => a.spill > 0),
            brokenWords,
            clip,
          };
        });
        assert.equal(m.doc, 0, `document scrolls horizontally by ${m.doc}px on ${hash}`);
        assert.deepEqual(m.rows, [], `rows overflow their card on ${hash}`);
        assert.deepEqual(m.amounts, [], `amounts spill out of their card on ${hash}`);
        assert.deepEqual(
          m.brokenWords,
          [],
          `a label, amount or number is split mid-word on ${hash}`,
        );
        assert.deepEqual(m.clip, [], `overflow is hidden by a workaround on ${hash}`);
        await ctx.close();
      }
    },
  );
}
