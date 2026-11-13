/** Generates a DIAGNOSTIC schema candidate, never a replacement migration or manifest checksum. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { SCHEMA } from '../ci/g6b-preflight.js';
const root = resolve(import.meta.dirname, '../..');
const temporary = mkdtempSync(join(tmpdir(), 'nook-p4-schema-'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
try {
  const base = spawnSync('git', ['show', 'HEAD:prisma/schema.prisma'], { cwd: root, encoding: 'utf8' });
  assert.equal(base.status, 0);
  const from = join(temporary, 'baseline.prisma');
  writeFileSync(from, base.stdout);
  const diff = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-schema', from, '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: '/dev/null', DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/validation_only' },
  });
  assert.equal(diff.status, 0, 'Offline Prisma schema diff failed');
  assert.doesNotMatch(diff.stdout, /(?:^|;)\s*(?:--[^\n]*\n\s*)*(?:DROP|TRUNCATE|DELETE)\b|ALTER[^;]*\bDROP\b/im);
  let sql = '-- DIAGNOSTIC RECONSTRUCTION ONLY. NOT THE MISSING ORIGINAL MIGRATION.\n-- Do not deploy or substitute its checksum into the historical migration manifest.\n\n' + diff.stdout;
  const quote = (s) => `"${s.replaceAll('"', '""')}"`;
  for (const [name, c] of Object.entries(SCHEMA.constraints)) {
    if (name.startsWith('correction_') && c.type === 'c') sql += `\nALTER TABLE ${quote(c.table)} ADD CONSTRAINT ${quote(name)} ${c.definition};\n`;
  }
  for (const [name, i] of Object.entries(SCHEMA.indexes)) {
    if (name.startsWith('correction_')) sql += `\nCREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${quote(name)} ON ${quote(i.table)} (${i.columns.map(quote).join(', ')}) WHERE ${i.predicate};\n`;
  }
  for (const [name, body] of Object.entries(SCHEMA.functions)) {
    if (name.startsWith('correction_')) sql += `\nCREATE FUNCTION ${quote(name)}() RETURNS trigger LANGUAGE plpgsql AS $body$\n${body}\n$body$;\n`;
  }
  for (const [name, t] of Object.entries(SCHEMA.triggers)) {
    if (!name.startsWith('correction_')) continue;
    assert.equal(t.type, 27);
    assert.deepEqual(t.columns, []);
    sql += `\nCREATE TRIGGER ${quote(name)} BEFORE UPDATE OR DELETE ON ${quote(t.table)} FOR EACH ROW EXECUTE FUNCTION ${quote(t.function)}();\n`;
  }
  const output = resolve(root, 'docs/phase-4/recovery/corrections-diagnostic.sql');
  writeFileSync(output, sql);
  writeFileSync(resolve(root, 'docs/phase-4/recovery/provenance.json'), JSON.stringify({
    purpose: 'Diagnostic reconstruction; original migration remains missing',
    baselineSchemaSha256: hash(base.stdout), currentSchemaSha256: hash(readFileSync(resolve(root, 'prisma/schema.prisma'))),
    expectedCatalogSha256: hash(readFileSync(resolve(root, 'scripts/ci/g6b-preflight.js'))), candidateSha256: hash(sql),
    originalRecordedSha256: '1b6f49f2d873c61275313e0072d135fffb656df4dfbaa6357d61b41f758009d0',
  }, null, 2) + '\n');
  console.log(`Diagnostic candidate created (${hash(sql)}); original manifest unchanged.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
