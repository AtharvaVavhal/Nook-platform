// Defect 3 regression (source level): wherever a breakpoint sets the content's horizontal padding, it must keep the device
// safe-area inset. The browser test (tests/browser/defects.test.ts) measures the real computed padding with emulated insets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');

/** The body of every `@media (min-width: …) { … }` block, with its query. */
function mediaBlocks(source: string): Array<{ query: string; body: string }> {
  const out: Array<{ query: string; body: string }> = [];
  const re = /@media\s*\(([^)]*)\)\s*\{/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    out.push({ query: m[1] ?? '', body: source.slice(re.lastIndex, i - 1) });
  }
  return out;
}
const rule = (body: string, selector: string) =>
  new RegExp(`(?:^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(body)?.[1] ??
  null;

test('the base rule and every min-width override of .rp-content horizontal padding keep both safe-area insets', () => {
  const sources = [
    { query: 'base', body: css },
    ...mediaBlocks(css).filter((b) => /min-width/.test(b.query)),
  ];
  let checked = 0;
  for (const { query, body } of sources) {
    const decl = rule(body, '.rp-content');
    if (!decl || !/padding/.test(decl)) continue;
    checked += 1;
    assert.match(decl, /env\(safe-area-inset-right\)/, `${query}: right inset kept`);
    // the desktop rule leaves the left edge to the sidebar, so only rules that start at the left of the screen need the left inset
    if (!/min-width:\s*1024px/.test(query))
      assert.match(decl, /env\(safe-area-inset-left\)/, `${query}: left inset kept`);
  }
  assert.ok(
    checked >= 3,
    `expected the base, 640px and 1024px rules to be checked (got ${checked})`,
  );
});

test('safe-area handling is not hard-coded to a particular device inset', () => {
  assert.doesNotMatch(css, /\b47px\b|\b44px\s*\+\s*env/, 'no fixed notch value');
});
