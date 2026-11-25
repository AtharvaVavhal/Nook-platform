import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const here = new URL('.', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, here), 'utf8');
/** Custom properties of every top-level `:root { ... }` block (not the dark-mode or attribute variants). */
function rootVars(css: string): Record<string, string> {
  const blocks = [...css.matchAll(/^:root \{([\s\S]*?)\n\}/gm)].map((m) => m[1] ?? '');
  return Object.fromEntries(
    blocks.flatMap((block) =>
      [...block.matchAll(/(--[\w-]+):\s*([^;]+?);/g)].map((m) => [
        m[1]!,
        m[2]!.trim().toLowerCase(),
      ]),
    ),
  );
}
const resident = rootVars(read('./tokens.css'));
const owner = rootVars(readFileSync(new URL('../../../web/src/tokens.css', here), 'utf8'));

test('the portal shares the owner app palette: every owner colour token is present and identical', () => {
  const colours = Object.keys(owner).filter((k) => k.startsWith('--color-'));
  assert.ok(colours.length >= 35, `${colours.length} colour tokens`);
  for (const key of colours) assert.equal(resident[key], owner[key], key);
});

test('the five brand colours are exactly the specified ones', () => {
  assert.equal(resident['--color-brand-primary'], '#171338'); // Midnight Indigo
  assert.equal(resident['--color-brand-accent'], '#7657f6'); // Nook Violet
  assert.equal(resident['--color-brand-subtle'], '#f4f1ff'); // Soft Lavender
  assert.equal(resident['--color-surface'], '#ffffff'); // White
  assert.equal(resident['--color-text-primary'], '#26233d'); // Primary Text
});

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** Colour of `fg` at `alpha` laid over `bg`. */
function blend(fg: string, alpha: number, bg: string): string {
  const f = parseInt(fg.slice(1), 16),
    b = parseInt(bg.slice(1), 16);
  const mix = (s: number) => Math.round(((f >> s) & 255) * alpha + ((b >> s) & 255) * (1 - alpha));
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`;
}
const v = (name: string) => resident[`--color-${name}`]!;

test('every text and background pairing the portal uses meets WCAG AA (4.5:1 for text)', () => {
  const pairs: Array<[string, string, string]> = [
    ['primary text on white', v('text-primary'), v('surface')],
    ['primary text on lavender page', v('text-primary'), v('brand-subtle')],
    ['heading indigo on white', v('brand-primary'), v('surface')],
    ['heading indigo on lavender', v('brand-primary'), v('brand-subtle')],
    ['secondary text on white', v('text-secondary'), v('surface')],
    ['secondary text on lavender', v('text-secondary'), v('brand-subtle')],
    ['white on primary button (violet)', '#ffffff', v('brand-accent')],
    ['white on primary button hover', '#ffffff', v('accent-hover')],
    ['white on primary button pressed', '#ffffff', v('accent-pressed')],
    ['links and accent text on white', v('accent-text'), v('surface')],
    ['links and accent text on lavender', v('accent-text'), v('brand-subtle')],
    ['white on indigo (sidebar, hero, top bar)', '#ffffff', v('brand-primary')],
    ['lavender on indigo', v('text-on-dark'), v('brand-primary')],
    [
      'nav text on indigo (82%)',
      blend(v('text-on-dark'), 0.82, v('brand-primary')),
      v('brand-primary'),
    ],
    [
      'hero eyebrow on indigo (80%)',
      blend(v('text-on-dark'), 0.8, v('brand-primary')),
      v('brand-primary'),
    ],
    [
      'sidebar footer on indigo (72%)',
      blend(v('text-on-dark'), 0.72, v('brand-primary')),
      v('brand-primary'),
    ],
    [
      'hero meta on indigo (88%)',
      blend(v('text-on-dark'), 0.88, v('brand-primary')),
      v('brand-primary'),
    ],
    ['success badge', v('success-text'), v('success-tint')],
    ['warning badge', v('warning-text'), v('warning-tint')],
    ['danger badge', v('danger-text'), v('danger-tint')],
    ['info badge', v('info-text'), v('info-tint')],
    ['neutral badge', v('neutral-text'), v('neutral-tint')],
    ['accent badge', v('accent-text'), v('brand-subtle')],
    ['error text on white', v('danger-text'), v('surface')],
    ['overdue figure on white', v('danger-text'), v('surface')],
    ['banner text on info tint', v('text-primary'), v('info-tint')],
    ['banner text on warning tint', v('text-primary'), v('warning-tint')],
    ['banner text on error tint', v('text-primary'), v('danger-tint')],
    ['disabled button text', v('disabled-text'), v('disabled-background')],
    ['input placeholder on white', v('placeholder'), v('surface')],
    ['input placeholder on lavender prefix', v('placeholder'), v('brand-subtle')],
  ];
  const failures = pairs
    .map(([name, fg, bg]) => ({ name, ratio: contrast(fg, bg) }))
    .filter((p) => p.ratio < 4.5);
  assert.deepEqual(
    failures.map((f) => `${f.name} ${f.ratio.toFixed(2)}`),
    [],
  );
});

test('non-text boundaries meet 3:1: input borders and focus ring on white', () => {
  assert.ok(
    contrast(v('border-strong'), v('surface')) >= 3,
    `input border ${contrast(v('border-strong'), v('surface')).toFixed(2)}`,
  );
  assert.ok(contrast(v('focus'), v('surface')) >= 3, 'focus ring on white');
  assert.ok(contrast('#ffffff', v('brand-primary')) >= 3, 'focus ring (white) on indigo');
});
