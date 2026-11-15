import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, '../../../apps/api/package.json'));
const { Pool } = require('pg');
const S = process.env.TLS_DIR;
const pw = fs.readFileSync(S + '/su.pw', 'utf8').trim();
const good = S + '/good/server.crt';
const wrong = S + '/wrong/other.crt';
const base = `postgresql://postgres:${pw}@127.0.0.1:55432/postgres`;
const baseLocalhost = `postgresql://postgres:${pw}@localhost:55432/postgres`;
const variants = [
  ['A  sslmode=require (no compat)', `${base}?sslmode=require`],
  ['B  sslmode=verify-full (no compat)', `${base}?sslmode=verify-full`],
  ['C  sslmode=no-verify', `${base}?sslmode=no-verify`],
  ['D  uselibpqcompat+require (no CA)', `${base}?uselibpqcompat=true&sslmode=require`],
  ['E  uselibpqcompat+verify-ca+GOOD CA', `${base}?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=${good}`],
  ['F  uselibpqcompat+verify-ca+WRONG CA', `${base}?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=${wrong}`],
  ['G  uselibpqcompat+verify-ca, no CA given', `${base}?uselibpqcompat=true&sslmode=verify-ca`],
  ['H  verify-ca+GOOD CA via localhost host', `${baseLocalhost}?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=${good}`],
  ['I  no ssl parameter at all', `${base}`],
  ['J  sslmode=disable', `${base}?sslmode=disable`],
];
for (const [label, url] of variants) {
  let out;
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 4000 });
  process.removeAllListeners('warning');
  try {
    const r = await pool.query('select ssl from pg_stat_ssl where pid = pg_backend_pid()');
    out = `CONNECTED  tls=${r.rows[0]?.ssl}`;
  } catch (e) {
    out = `REJECTED   ${e.code || e.name}: ${String(e.message).replace(/[A-Za-z0-9]{24,}/g, '<x>').slice(0, 60)}`;
  } finally {
    await pool.end().catch(() => {});
  }
  process.stdout.write(`${label.padEnd(44)} ${out}\n`);
}
