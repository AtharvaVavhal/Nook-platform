// Defect 6 regression: a production build must not emit or reference source maps.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildProduction } from './helpers/browser.js';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test('defect 6: the production build contains no .map files and no sourceMappingURL references', () => {
  const out = buildProduction();
  const all = files(out);
  assert.ok(
    all.some((f) => f.endsWith('.js')) && all.some((f) => f.endsWith('.css')),
    'the build produced its JS and CSS',
  );
  assert.deepEqual(
    all.filter((f) => f.endsWith('.map')),
    [],
    'no source map files are emitted',
  );
  const referencing = all.filter(
    (f) => /\.(js|css)$/.test(f) && /sourceMappingURL/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(referencing, [], 'no bundle points at a source map');
});
