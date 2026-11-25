// Daily retention cleanup for the resident sign-in tables (OD-04). DRY RUN by default; deletion needs --execute.
//
//   RESIDENT_CLEANUP_DATABASE_URL=...  node --import tsx scripts/ops/resident-retention-cleanup.ts [--execute --confirm-target host:port/db]
//                                      [--batch-size 500] [--max-batches 100]
//
// The URL belongs to the separate least-privilege role nook_cleanup (SELECT and DELETE on the three resident sign-in tables only;
// see docs/production/deploy-kit/retention_cleanup_role.sql). It is read from the environment, never printed, never an argument.
// Output is one JSON line of counts and SQLSTATE codes: no row data, no URL, no message text.
// Production use is NOT validated: reaching Railway needs the authenticated-TLS path (migrate-with-tls-proxy.ts), and the role
// does not exist yet. Exit codes: 0 ok, 1 a table failed, 2 bad configuration, 4 another run holds the lock.
import { parseArgs } from 'node:util';
import pg from 'pg';
import { runRetention } from '../../apps/api/src/resident-retention/retention.js';

const { values } = parseArgs({
  options: {
    execute: { type: 'boolean', default: false },
    'confirm-target': { type: 'string' },
    'batch-size': { type: 'string' },
    'max-batches': { type: 'string' },
  },
});

const url = process.env.RESIDENT_CLEANUP_DATABASE_URL;
if (!url) {
  console.error('RESIDENT_CLEANUP_DATABASE_URL is not set');
  process.exit(2);
}
let target: string;
try {
  const parsed = new URL(url);
  target = `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
} catch {
  console.error('RESIDENT_CLEANUP_DATABASE_URL is not a valid URL');
  process.exit(2);
}
if (values.execute && values['confirm-target'] !== target) {
  console.error(
    '--execute needs --confirm-target host:port/database matching the configured target',
  );
  process.exit(2);
}
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const report = await runRetention(client, {
    dryRun: !values.execute,
    batchSize: num(values['batch-size']),
    maxBatchesPerTarget: num(values['max-batches']),
  });
  console.log(JSON.stringify({ event: 'resident-retention', ...report }));
  process.exitCode = report.skipped ? 4 : report.ok ? 0 : 1;
} catch (error) {
  const code = (error as { code?: unknown })?.code;
  console.error(
    JSON.stringify({
      event: 'resident-retention',
      ok: false,
      error: typeof code === 'string' ? code : 'UNKNOWN',
    }),
  );
  process.exitCode = 2;
} finally {
  await client.end().catch(() => undefined);
}
