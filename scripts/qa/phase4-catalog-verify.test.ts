import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { readSchema,verifySchemaFacts,readPrivileges,verifyPrivileges,TARGET } from '../ci/g6b-preflight.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { sqlStates } from '../../apps/api/src/common/tx-errors.js';
const prisma=new PrismaService();
test.after(async()=>prisma.onModuleDestroy());
test('live migrated catalog passes the exact CI structural contract',async()=>{
  await withMigratorClient(async client=>verifySchemaFacts(await readSchema(client)));
});
test('runtime has exact append-only and read-only-view privileges',async()=>{
  await withMigratorClient(async client=>verifyPrivileges(await readPrivileges(client,TARGET.runtime),TARGET.runtime));
});
test('runtime cannot update corrected assignment projection',async()=>{
  await assert.rejects(prisma.db.$executeRaw`UPDATE effective_stay_assignments SET start_at=start_at`,error=>{
    return sqlStates(error).some(state=>state==='42501'||state==='55000');
  });
});
test('an unexpected relation fails acceptance and removal restores the exact contract',async()=>{
  await withMigratorClient(async client=>{
    await client.query('CREATE VIEW phase4_catalog_probe AS SELECT 1 AS value');
    try {const facts=await readSchema(client);assert.throws(()=>verifySchemaFacts(facts));}
    finally {await client.query('DROP VIEW phase4_catalog_probe');}
    verifySchemaFacts(await readSchema(client));
  });
});
