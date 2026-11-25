// Hosting contract for resident.trynook.in: the security headers in vercel.json must stay strict, must allow exactly the production
// API origin, and the production bundle must be loadable under them (no inline scripts, no inline <style>, no third-party hosts).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { APP_ROOT, buildProduction } from './helpers/browser.js';

interface Header {
  key: string;
  value: string;
}
interface Rule {
  source: string;
  headers: Header[];
}

const config = JSON.parse(readFileSync(join(APP_ROOT, 'vercel.json'), 'utf8')) as {
  headers: Rule[];
  outputDirectory: string;
  build: { env: { VITE_API_BASE: string } };
};

function headersFor(source: string): Map<string, string> {
  const rule = config.headers.find((r) => r.source === source);
  assert.ok(rule, `a header rule exists for ${source}`);
  return new Map(rule.headers.map((h) => [h.key, h.value]));
}

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name as string, values] as [string, string[]];
      }),
  );
}

test('hosting: every response carries the security headers', () => {
  const h = headersFor('/(.*)');
  assert.match(h.get('Strict-Transport-Security') ?? '', /max-age=\d{8,}/);
  assert.equal(h.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(h.get('Referrer-Policy'), 'no-referrer');
  assert.equal(h.get('X-Frame-Options'), 'DENY');
  assert.equal(h.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.ok(h.get('Permissions-Policy'), 'a Permissions-Policy is set');
});

test('hosting: the CSP is strict and allows exactly the production API origin', () => {
  const csp = headersFor('/(.*)').get('Content-Security-Policy') ?? '';
  const d = directives(csp);
  assert.deepEqual(d.get('default-src'), ["'none'"]);
  assert.deepEqual(d.get('script-src'), ["'self'"]);
  assert.deepEqual(d.get('style-src'), ["'self'"]);
  assert.deepEqual(d.get('connect-src'), ['https://api.trynook.in']);
  assert.deepEqual(d.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(d.get('base-uri'), ["'none'"]);
  assert.deepEqual(d.get('object-src'), ["'none'"]);
  assert.ok(d.has('upgrade-insecure-requests'));
  assert.doesNotMatch(
    csp,
    /unsafe-inline|unsafe-eval|\*/,
    'no unsafe keyword and no wildcard source',
  );
});

test('hosting: hashed assets are immutable and the HTML shell is never cached', () => {
  assert.match(
    headersFor('/assets/(.*)').get('Cache-Control') ?? '',
    /max-age=31536000.*immutable/,
  );
  assert.equal(headersFor('/').get('Cache-Control'), 'no-cache');
  assert.equal(headersFor('/index.html').get('Cache-Control'), 'no-cache');
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test('hosting: the production bundle can load under that CSP', () => {
  const out = buildProduction();
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'no inline <script>');
  assert.doesNotMatch(html, /<style[\s>]/i, 'no inline <style>');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handler attributes');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'no inline style attribute in the shell');
  const external = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/gi)];
  assert.deepEqual(external, [], 'the shell loads nothing from another host');
  for (const f of files(out).filter((p) => p.endsWith('.js') || p.endsWith('.css'))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\beval\s*\(|new Function\s*\(/, `${f}: no eval`);
  }
  assert.equal(config.outputDirectory, 'dist');
});

test('hosting: the production build is pinned to the production API and the CSP allows only that origin', () => {
  const apiBase = config.build.env.VITE_API_BASE;
  assert.equal(apiBase, 'https://api.trynook.in/api/v1');
  const csp = headersFor('/(.*)').get('Content-Security-Policy') ?? '';
  assert.deepEqual(directives(csp).get('connect-src'), [new URL(apiBase).origin]);
});
