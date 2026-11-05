import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = JSON.parse(readFileSync(new URL('./test-files.json', import.meta.url), 'utf8'));
// An allowlist: new tests require a deliberate routing review. No ambient database credentials.
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...files.quality.map((name) => `test/${name}.test.ts`)],
  { cwd: 'apps/api', env: { PATH: process.env.PATH, APP_ENV: 'test' }, stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
