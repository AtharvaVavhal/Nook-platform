import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = join(here, '..', '..');
const require = createRequire(import.meta.url);

/** Builds the portal for production into a fresh temp directory (the browser tests always run against the production bundle). */
export function buildProduction(): string {
  const outDir = mkdtempSync(join(tmpdir(), 'nook-resident-dist-'));
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  execFileSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: APP_ROOT,
    stdio: 'pipe',
  });
  return outDir;
}

/** A Chrome/Chromium executable for the browser tests, or null (the browser tests then skip with a clear reason). */
export function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((c): c is string => typeof c === 'string' && existsSync(c)) ?? null;
}

export async function launch(executablePath: string) {
  const puppeteer = (await import('puppeteer-core')).default;
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-first-run', '--disable-gpu'],
  });
}
