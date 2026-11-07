import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';
import { readIdentity, readFreshFacts, readSchema } from './g6b-preflight.js';

const require = createRequire(import.meta.url);
const pgRequire = createRequire(require.resolve('pg'));
const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
// PostgreSQL catalog OIDs: NAMEARRAYOID=1003, TEXTARRAYOID=1009.
// These literals and expected values are independent of the verifier's SCHEMA/TARGET constants.
const parse = (oid, wire) => (wire === null ? null : pg.types.getTypeParser(oid, 'text')(wire));
const values = [
  'pg_database_owner',
  'role with space',
  'comma,value',
  'brace{value}',
  'quote"value',
  'back\\slash',
  'NULL',
  '',
];
const wire = String.raw`{pg_database_owner,"role with space","comma,value","brace{value}","quote\"value","back\\slash","NULL",""}`;
const affected = [
  [
    'role memberships',
    'identity',
    'memberships',
    'memberships',
    /ARRAY\(SELECT rolname FROM pg_roles/,
  ],
  [
    'database names',
    'identity',
    'databases',
    'databases',
    /ARRAY\(SELECT datname FROM pg_database ORDER BY datname/,
  ],
  [
    'other connectable databases',
    'identity',
    'otherConnections',
    'otherConnections',
    /ARRAY\(SELECT datname FROM pg_database WHERE datallowconn/,
  ],
  [
    'fresh schema names',
    'fresh',
    'userSchemas',
    'userSchemas',
    /ARRAY\(SELECT nspname FROM pg_namespace/,
  ],
  [
    'enum labels',
    'schema',
    'labels',
    'enums.synthetic_enum',
    /array_agg\(e\.enumlabel ORDER BY e\.enumsortorder\)/,
  ],
  [
    'partial-index columns',
    'schema',
    'columns',
    'indexes.synthetic_index.columns',
    /ARRAY\(SELECT a\.attname FROM unnest\(i\.indkey\)/,
  ],
  [
    'trigger columns',
    'schema',
    'columns',
    'triggers.synthetic_trigger.columns',
    /ARRAY\(SELECT a\.attname FROM unnest\(t\.tgattr\)/,
  ],
  [
    'post-migration schema names',
    'schema',
    'userSchemas',
    'userSchemas',
    /ARRAY\(SELECT nspname FROM pg_namespace/,
  ],
];
const cast = (alias) => new RegExp(`\\)::text\\[\\] AS "?${alias}"?(?:,|\\s|$)`);
function fixture(input = wire) {
  const queries = [];
  const array = (sql, alias) => parse(cast(alias).test(sql) ? 1009 : 1003, input);
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('SELECT current_database()'))
        return {
          rows: [
            {
              database: 'synthetic_database',
              user: 'synthetic_role',
              memberships: array(sql, 'memberships'),
              databases: array(sql, 'databases'),
              otherConnections: array(sql, 'otherConnections'),
              dangerous: parse(1009, '{}'),
              recovery: false,
              serverPort: 5432,
            },
          ],
        };
      if (sql.includes('AS objects'))
        return {
          rows: [
            {
              userSchemas: array(sql, 'userSchemas'),
              schemaOwner: parse(19, 'synthetic_owner'),
              objects: parse(1009, '{"relation:synthetic"}'),
            },
          ],
        };
      if (sql.includes('jsonb_object_agg'))
        return {
          rows: [
            {
              name: parse(19, 'synthetic_table'),
              kind: 'r',
              owner: 'synthetic_owner',
              columns: parse(3802, '{"value":{"nullable":true,"type":"text"}}'),
            },
          ],
        };
      if (sql.includes('array_agg(e.enumlabel'))
        return { rows: [{ name: 'synthetic_enum', labels: array(sql, 'labels') }] };
      if (sql.includes('FROM pg_constraint')) return { rows: [] };
      if (sql.includes('FROM pg_index'))
        return {
          rows: [
            { name: 'synthetic_index', columns: array(sql, 'columns'), unique: true, valid: true },
          ],
        };
      if (sql.includes('pg_get_function_result'))
        return {
          rows: [
            {
              name: 'synthetic_function',
              config: parse(1009, '{"search_path=public"}'),
              arguments: 0,
            },
          ],
        };
      if (sql.includes('FROM pg_trigger'))
        return {
          rows: [{ name: 'synthetic_trigger', columns: array(sql, 'columns'), enabled: 'O' }],
        };
      if (sql.includes('foreignOwnedObjects'))
        return {
          rows: [
            {
              schemaOwner: 'synthetic_owner',
              userSchemas: array(sql, 'userSchemas'),
              foreignOwnedObjects: 0,
              unexpectedObjects: 0,
            },
          ],
        };
      throw new Error('Unexpected catalog query in database-free fixture');
    },
  };
  return { db, queries };
}
const read = { identity: readIdentity, fresh: readFreshFacts, schema: readSchema };
const get = (result, path) => path.split('.').reduce((value, key) => value[key], result);

test('catalog array tests use the actual locked pg and pg-types parser registry', () => {
  assert.equal(require('pg/package.json').version, '8.16.3');
  assert.equal(pgRequire('pg-types/package.json').version, '2.2.0');
  assert.equal(lock.packages['node_modules/pg'].version, '8.16.3');
  assert.equal(lock.packages['node_modules/pg-types'].version, '2.2.0');
  assert.equal(pg.types, pgRequire('pg-types'));
});
test('name[] is returned as a string by the locked driver', () => {
  assert.equal(parse(1003, wire), wire);
  assert.equal(Array.isArray(parse(1003, wire)), false);
});
test('text[] preserves roles, spaces, delimiters, quotes, escapes, NULL strings and empty strings', () => {
  assert.deepEqual(parse(1009, wire), values);
  assert.deepEqual(parse(1009, '{pg_database_owner}'), ['pg_database_owner']);
});
test('real text[] parser preserves empty arrays, null elements and null aggregate results', () => {
  assert.deepEqual(parse(1009, '{}'), []);
  assert.deepEqual(parse(1009, '{NULL,"NULL"}'), [null, 'NULL']);
  assert.equal(parse(1009, null), null);
  assert.equal(parse(1003, '{}'), '{}');
});
for (const [name, adapter, alias, path, expression] of affected) {
  for (const [label, input, expected] of [
    ['populated', wire, values],
    ['empty', '{}', []],
  ]) {
    test(`catalog array ${name}: ${label} SQL cast and real driver boundary`, async () => {
      const { db, queries } = fixture(input);
      const result = await read[adapter](db);
      const sql = queries.find((query) => expression.test(query));
      assert.ok(sql, 'Expected catalog expression must be queried');
      assert.match(sql, cast(alias), 'Affected name[] expression must explicitly return text[]');
      assert.deepEqual(get(result, path), expected);
      assert.equal(Array.isArray(get(result, path)), true);
    });
  }
}
test('unaffected scalar, jsonb, boolean, integer and existing text[] fields retain their types', async () => {
  const identity = await readIdentity(fixture().db);
  assert.equal(identity.database, 'synthetic_database');
  assert.equal(identity.recovery, false);
  assert.equal(identity.serverPort, 5432);
  assert.deepEqual(identity.dangerous, []);
  const fresh = await readFreshFacts(fixture().db);
  assert.equal(fresh.schemaOwner, 'synthetic_owner');
  assert.deepEqual(fresh.objects, ['relation:synthetic']);
  const schema = await readSchema(fixture().db);
  assert.deepEqual(schema.tables.synthetic_table.columns, {
    value: { nullable: true, type: 'text' },
  });
  assert.deepEqual(schema.functions.synthetic_function.config, ['search_path=public']);
  assert.equal(schema.triggers.synthetic_trigger.enabled, 'O');
  assert.equal(schema.indexes.synthetic_index.unique, true);
  assert.equal(schema.foreignOwnedObjects, 0);
});
