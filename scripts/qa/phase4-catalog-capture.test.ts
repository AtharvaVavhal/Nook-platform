import '../../apps/api/test/integration/helpers/preflight.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { readPhase4Catalog } from '../ci/phase4-catalog.js';
test('capture exact catalog from the verified disposable migration chain',async()=>{
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB,'1');
  const catalog=await withMigratorClient(readPhase4Catalog);
  assert.ok(catalog.relations.some(row=>row.name==='effective_stay_assignments'&&row.kind==='v'));
  assert.ok(catalog.constraints.some(row=>row.name==='stay_assignments_no_overlap_excl'&&row.type==='x'));
  assert.ok(catalog.constraints.some(row=>row.name==='assignment_replacement_requires_applied'&&row.deferrable&&row.deferred));
  assert.ok(catalog.functions.every(row=>row.securityDefiner===false));
  assert.ok(catalog.relations.every(row=>row.owner==='nook_ci_full_migrator'));
  const manifest=JSON.parse(readFileSync('scripts/ci/g6b-migrations.json','utf8'));
  writeFileSync('scripts/ci/phase4-catalog.json',JSON.stringify({migrations:manifest.migrations,catalog},null,2)+'\n');
  console.log(JSON.stringify({probe:'phase4-catalog-capture',relations:catalog.relations.length,constraints:catalog.constraints.length,functions:catalog.functions.length}));
});
