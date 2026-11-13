/** Exact Phase 4 catalog contract, captured only from a fresh, checksum-verified disposable migration chain. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export async function readPhase4Catalog(db) {
  const relations =
    await db.query(`SELECT c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner,
    c.relrowsecurity AS "rowSecurity",c.relforcerowsecurity AS "forceRowSecurity",
    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,false) ELSE NULL END AS definition
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind NOT IN ('i','I','t') AND c.relname<>'_prisma_migrations' ORDER BY c.relname`);
  const columns =
    await db.query(`SELECT c.relname AS relation,a.attname AS name,a.attnum AS position,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS "notNull",a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS "default"
    FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f') AND c.relname<>'_prisma_migrations'
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
  const constraints =
    await db.query(`SELECT r.relname AS relation,c.conname AS name,c.contype AS type,c.convalidated AS validated,
    c.condeferrable AS deferrable,c.condeferred AS deferred,pg_get_constraintdef(c.oid,false) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid WHERE c.connamespace='public'::regnamespace
    AND r.relname<>'_prisma_migrations' ORDER BY r.relname,c.conname`);
  const indexes =
    await db.query(`SELECT r.relname AS relation,n.relname AS name,i.indisunique AS "unique",i.indisprimary AS primary,
    i.indisvalid AS valid,i.indisready AS ready,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_class n ON n.oid=i.indexrelid
    WHERE r.relnamespace='public'::regnamespace AND r.relname<>'_prisma_migrations' ORDER BY r.relname,n.relname`);
  const functions =
    await db.query(`SELECT p.proname||'('||oidvectortypes(p.proargtypes)||')' AS signature,pg_get_userbyid(p.proowner) AS owner,
    l.lanname AS language,p.prosrc AS body,p.probin AS library,pg_get_function_result(p.oid) AS result,p.prosecdef AS "securityDefiner",
    p.proconfig AS config,p.provolatile AS volatility,p.proparallel AS parallel,p.proleakproof AS leakproof,p.proisstrict AS strict,
    e.extname AS extension FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    LEFT JOIN pg_depend d ON d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e'
    LEFT JOIN pg_extension e ON e.oid=d.refobjid WHERE p.pronamespace='public'::regnamespace
    ORDER BY p.proname,oidvectortypes(p.proargtypes)`);
  const types =
    await db.query(`SELECT t.typname AS name,t.typtype AS type,t.typcategory AS category,pg_get_userbyid(t.typowner) AS owner,
    CASE WHEN t.typtype='e' THEN (SELECT json_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid=t.oid) ELSE NULL END AS labels,
    e.extname AS extension FROM pg_type t LEFT JOIN pg_depend d ON d.objid=t.oid AND d.classid='pg_type'::regclass AND d.deptype='e'
    LEFT JOIN pg_extension e ON e.oid=d.refobjid WHERE t.typnamespace='public'::regnamespace AND t.typname<>'_prisma_migrations' AND t.typname<>'__prisma_migrations' ORDER BY t.typname`);
  const triggers =
    await db.query(`SELECT c.relname AS relation,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid,false) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
  const extensions =
    await db.query(`SELECT e.extname AS name,e.extversion AS version,n.nspname AS schema,pg_get_userbyid(e.extowner) AS owner
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname<>'plpgsql' ORDER BY e.extname`);
  const schemas =
    await db.query(`SELECT nspname AS name,pg_get_userbyid(nspowner) AS owner FROM pg_namespace
    WHERE nspname !~ '^pg_' AND nspname<>'information_schema' ORDER BY nspname`);
  return {
    relations: relations.rows,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    functions: functions.rows,
    types: types.rows,
    triggers: triggers.rows,
    extensions: extensions.rows,
    schemas: schemas.rows,
  };
}

export function verifyPhase4Catalog(actual) {
  const expected = JSON.parse(
    readFileSync(new URL('./phase4-catalog.json', import.meta.url), 'utf8'),
  );
  const manifest = JSON.parse(
    readFileSync(new URL('./g6b-migrations.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    expected.migrations,
    manifest.migrations,
    'Catalog contract does not match the pinned migration chain',
  );
  assert.deepEqual(actual, expected.catalog, 'Phase 4 catalog differs from the reviewed contract');
}

/** Compatibility shape for the existing semantic/deparser mutation tests; live verification uses the exact catalog above. */
export function phase4Facts(catalog) {
  const enumNames = new Set(catalog.types.filter((t) => t.type === 'e').map((t) => `"${t.name}"`));
  const tables = Object.fromEntries(
    catalog.relations
      .filter((r) => r.kind === 'r')
      .map((r) => [
        r.name,
        {
          owner: r.owner,
          kind: r.kind,
          columns: Object.fromEntries(
            catalog.columns
              .filter((c) => c.relation === r.name)
              .map((c) => [
                c.name,
                {
                  type: c.type,
                  nullable: !c.notNull,
                  ...(enumNames.has(c.type) ? { default: c.default } : {}),
                },
              ]),
          ),
        },
      ]),
  );
  const functions = Object.fromEntries(
    catalog.functions.map((f) => {
      const signature = f.signature.endsWith('()') ? f.signature.slice(0, -2) : f.signature;
      const args = f.signature.slice(f.signature.indexOf('(') + 1, -1);
      const { signature: ignored, ...metadata } = f;
      void ignored;
      return [signature, { ...metadata, arguments: args ? args.split(',').length : 0 }];
    }),
  );
  const triggers = Object.fromEntries(
    catalog.triggers.map((t) => {
      const definition = t.definition;
      const action = definition.split(/\bON\b/)[0];
      const fn = /EXECUTE FUNCTION (?:public\.)?"?([a-z_]+)"?\(/i.exec(definition)?.[1];
      const update = /UPDATE OF ([\w", ]+?) (?:OR |ON )/i.exec(definition);
      return [
        t.name,
        {
          table: t.relation,
          function: fn,
          type:
            1 +
            (/\bBEFORE\b/.test(action) ? 2 : 0) +
            (/\bINSERT\b/.test(action) ? 4 : 0) +
            (/\bDELETE\b/.test(action) ? 8 : 0) +
            (/\bUPDATE\b/.test(action) ? 16 : 0),
          columns: update
            ? update[1]
                .replaceAll('"', '')
                .split(',')
                .map((x) => x.trim())
            : [],
          enabled: t.enabled,
          arguments: 0,
          when: null,
        },
      ];
    }),
  );
  return {
    tables: { ...tables, _prisma_migrations: { owner: 'nook_ci_full_migrator', kind: 'r' } },
    enums: Object.fromEntries(
      catalog.types.filter((t) => t.type === 'e').map((t) => [t.name, t.labels]),
    ),
    constraints: Object.fromEntries(
      catalog.constraints.map((c) => [
        c.name,
        {
          table: c.relation,
          type: c.type,
          definition: c.definition,
          validated: c.validated,
          deferrable: c.deferrable,
          deferred: c.deferred,
        },
      ]),
    ),
    indexes: Object.fromEntries(
      catalog.indexes.map((i) => [
        i.name,
        {
          table: i.relation,
          unique: i.unique,
          valid: i.valid,
          ready: i.ready,
          definition: i.definition,
        },
      ]),
    ),
    functions,
    triggers,
    userSchemas: ['public'],
    schemaOwner: 'pg_database_owner',
    foreignOwnedObjects: 0,
    unexpectedObjects: 0,
  };
}
