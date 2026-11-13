import { readFileSync } from 'node:fs';
import { readPhase4Catalog, verifyPhase4Catalog, phase4Facts } from './phase4-catalog.js';
import assert from 'node:assert/strict';
import {
  DATABASE_MARKER,
  FULL_APPLICATION_TABLES,
} from '../../apps/api/test/integration/helpers/guard.ts';
import { verifyLedgerSchema, verifyFreshLedger } from './migration-ledger.js';

export const TARGET = Object.freeze({
  database: 'nook_integration_ci_full',
  host: '127.0.0.1',
  port: 5545,
  migrator: 'nook_ci_full_migrator',
  runtime: 'nook_ci_full_runtime',
  verifier: 'nook_ci_full_verifier',
});

export function verifyIdentityFacts(f, role) {
  assert.equal(f.database, TARGET.database);
  assert.equal(f.user, role);
  assert.equal(f.sessionUser, role);
  assert.equal(f.marker, DATABASE_MARKER);
  assert.equal(f.databaseOwner, TARGET.migrator);
  assert.equal(f.recovery, false);
  assert.ok(typeof f.server === 'string' && f.server.length > 0);
  assert.equal(f.serverPort, 5432); // Actual PostgreSQL service port, not the host-mapped port.
  assert.ok(typeof f.postmaster === 'string' && f.postmaster.length > 0);
  assert.ok(f.version >= 170000 && f.version < 180000);
  assert.deepEqual(f.dangerous, []);
  assert.deepEqual(f.memberships, role === TARGET.migrator ? ['pg_database_owner'] : []);
  assert.deepEqual([...f.databases].sort(), [
    'nook_integration_ci_full',
    'postgres',
    'template0',
    'template1',
  ]);
  assert.deepEqual(f.otherConnections, []);
}

export function verifyFreshFacts(f) {
  verifyIdentityFacts(f.identity, TARGET.migrator);
  assert.deepEqual(f.userSchemas, ['public']);
  assert.ok(['pg_database_owner', TARGET.migrator].includes(f.schemaOwner));
  assert.deepEqual(f.objects, []);
}

export async function readIdentity(db) {
  const { rows } =
    await db.query(`SELECT current_database() AS database, current_user AS "user", session_user AS "sessionUser",
    shobj_description(d.oid, 'pg_database') AS marker, pg_get_userbyid(d.datdba) AS "databaseOwner",
    pg_is_in_recovery() AS recovery, inet_server_addr()::text AS server, inet_server_port() AS "serverPort",
    pg_postmaster_start_time()::text AS postmaster, current_setting('server_version_num')::int AS version,
    ARRAY(SELECT x FROM unnest(ARRAY[CASE WHEN r.rolsuper THEN 'superuser' END, CASE WHEN r.rolcreatedb THEN 'createdb' END,
      CASE WHEN r.rolcreaterole THEN 'createrole' END, CASE WHEN r.rolreplication THEN 'replication' END,
      CASE WHEN r.rolbypassrls THEN 'bypassrls' END]) x WHERE x IS NOT NULL) AS dangerous,
    ARRAY(SELECT rolname FROM pg_roles WHERE rolname <> current_user AND pg_has_role(current_user,oid,'MEMBER') ORDER BY rolname)::text[] AS memberships,
    ARRAY(SELECT datname FROM pg_database ORDER BY datname)::text[] AS databases,
    ARRAY(SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> current_database()
      AND has_database_privilege(current_user,oid,'CONNECT') ORDER BY datname)::text[] AS "otherConnections"
    FROM pg_database d CROSS JOIN pg_roles r WHERE d.datname=current_database() AND r.rolname=current_user`);
  assert.equal(rows.length, 1);
  return rows[0];
}

export async function readFreshFacts(db) {
  const identity = await readIdentity(db);
  const { rows } = await db.query(`SELECT
    ARRAY(SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' ORDER BY nspname)::text[] AS "userSchemas",
    (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public') AS "schemaOwner",
    ARRAY(SELECT 'relation:'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL SELECT 'function:'||p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL SELECT 'type:'||t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') AS objects`);
  assert.equal(rows.length, 1);
  return { identity, ...rows[0] };
}

// Tokenize without altering quoted strings. Only PostgreSQL's known deparser casts are erased.
export function tokens(sql) {
  const matches =
    sql.match(
      /'(?:''|[^'])*'|"(?:""|[^"])*"|::|<>|!=|<=|>=|!~|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[^\s]/g,
    ) ?? [];
  return matches.map((x) => (x.startsWith("'") ? x : x.replace(/^"|"$/g, '').toLowerCase()));
}

export function expression(sql) {
  const ts = tokens(sql);
  let i = 0;
  const take = (t) => {
    assert.equal(ts[i++], t, 'Unsupported catalog expression');
  };
  const list = (end) => {
    const a = [];
    if (ts[i] !== end) {
      a.push(parse(0));
      while (ts[i] === ',') {
        i++;
        a.push(parse(0));
      }
    }
    take(end);
    return a;
  };
  function atom() {
    let x;
    const t = ts[i++];
    assert.ok(t !== undefined);
    if (t === '(') {
      x = parse(0);
      take(')');
    } else if (t === '-' || t === 'not') x = [t, parse(t === 'not' ? 3 : 6)];
    else if (t === 'array') {
      take('[');
      x = ['array', ...list(']')];
    } else if (ts[i] === '(') {
      i++;
      x = [t, ...list(')')];
    } else x = t;
    while (ts[i] === '::') {
      i++;
      const cast = ts[i++];
      assert.ok(
        [
          'text',
          'numeric',
          'integer',
          ...Object.keys(SCHEMA.enums).map((x) => x.toLowerCase()),
        ].includes(cast),
        'Unexpected expression cast',
      );
      if (ts[i] === '[') {
        i++;
        take(']');
        if (typeof x === 'string' && /^'\{[A-Za-z0-9_,.-]*\}'$/.test(x)) {
          const values = x.slice(2, -2).split(',');
          x = [
            'array',
            ...values.map((v) => (cast === 'integer' || cast === 'numeric' ? v : "'" + v + "'")),
          ];
        }
      }
    }
    return x;
  }
  function parse(min) {
    let a = atom();
    while (i < ts.length) {
      let op = ts[i];
      const notIn = op === 'not' && ts[i + 1] === 'in';
      const p =
        op === 'or'
          ? 1
          : op === 'and'
            ? 2
            : ['=', '<>', '!=', '<', '>', '<=', '>=', '~', '!~', 'in', 'is', 'between'].includes(
                  op,
                ) || notIn
              ? 3
              : ['+', '-'].includes(op)
                ? 4
                : ['*', '/'].includes(op)
                  ? 5
                  : 0;
      if (!p || p < min) break;
      i++;
      if (notIn) {
        take('in');
        op = 'not in';
      }
      if (op === 'in' || op === 'not in') {
        take('(');
        a = [op, a, ...list(')')];
        continue;
      }
      if (op === 'between') {
        const lo = parse(4);
        take('and');
        a = ['between', a, lo, parse(4)];
        continue;
      }
      if (op === 'is') {
        const neg = ts[i] === 'not';
        if (neg) i++;
        take('null');
        a = [neg ? 'is not null' : 'is null', a];
        continue;
      }
      const b = parse(p + 1);
      if (
        (op === '=' || op === '<>') &&
        Array.isArray(b) &&
        ['any', 'all'].includes(b[0]) &&
        b.length === 2 &&
        Array.isArray(b[1]) &&
        b[1][0] === 'array'
      ) {
        assert.ok((op === '=' && b[0] === 'any') || (op === '<>' && b[0] === 'all'));
        a = [op === '=' ? 'in' : 'not in', a, ...b[1].slice(1)];
      } else if ((op === 'and' || op === 'or') && Array.isArray(a) && a[0] === op) a = [...a, b];
      else a = [op, a, b];
    }
    return a;
  }
  const tree = parse(0);
  assert.equal(i, ts.length, 'Unsupported catalog expression suffix');
  function normal(x) {
    if (!Array.isArray(x)) return x;
    if (x[0] === 'between') return normal(['and', ['>=', x[1], x[2]], ['<=', x[1], x[3]]]);
    const items = x.slice(1).map(normal);
    return [
      x[0],
      ...items.flatMap((v) =>
        ['and', 'or'].includes(x[0]) && Array.isArray(v) && v[0] === x[0] ? v.slice(1) : [v],
      ),
    ];
  }
  return normal(tree);
}

const definitionTokens = (x) =>
  tokens(x).filter(
    (v, i, a) => !(v === 'public' && a[i + 1] === '.') && !(v === '.' && a[i - 1] === 'public'),
  );
function foreignKey(sql) {
  const t = definitionTokens(sql);
  let i = 0;
  const take = (v) => assert.equal(t[i++], v);
  const names = () => {
    take('(');
    const values = [];
    while (t[i] !== ')') {
      assert.ok(i < t.length);
      if (t[i] !== ',') values.push(t[i]);
      i++;
    }
    take(')');
    return values;
  };
  take('foreign');
  take('key');
  const columns = names();
  take('references');
  const table = t[i++];
  const target = names();
  const actions = { delete: 'no action', update: 'no action' };
  while (i < t.length) {
    take('on');
    const key = t[i++];
    assert.ok(['delete', 'update'].includes(key));
    let value = t[i++];
    if (value === 'set' || value === 'no') value += ' ' + t[i++];
    assert.ok(['restrict', 'cascade', 'set null', 'set default', 'no action'].includes(value));
    actions[key] = value;
  }
  return { columns, table, target, ...actions };
}

export function verifySchemaFacts(f) {
  if (f.phase4Catalog) {
    verifyPhase4Catalog(f.phase4Catalog);
    return;
  }
  assert.deepEqual(
    Object.keys(f.tables).sort(),
    [...FULL_APPLICATION_TABLES, '_prisma_migrations'].sort(),
  );
  assert.deepEqual(f.userSchemas, ['public']);
  assert.ok(['pg_database_owner', TARGET.migrator].includes(f.schemaOwner));
  for (const [table, columns] of Object.entries(SCHEMA.tables)) {
    assert.equal(f.tables[table].owner, TARGET.migrator);
    assert.equal(f.tables[table].kind, 'r');
    assert.deepEqual(f.tables[table].columns, columns, `Columns differ: ${table}`);
  }
  assert.equal(f.tables._prisma_migrations.owner, TARGET.migrator);
  assert.deepEqual(f.enums, SCHEMA.enums);
  assert.equal(f.foreignOwnedObjects, 0);
  assert.equal(f.unexpectedObjects, 0);
  assert.deepEqual(Object.keys(f.constraints).sort(), Object.keys(SCHEMA.constraints).sort());
  for (const [name, want] of Object.entries(SCHEMA.constraints)) {
    const actual = f.constraints[name];
    assert.equal(actual.validated, want.validated ?? true);
    assert.equal(actual.deferrable, want.deferrable ?? false);
    assert.equal(actual.deferred, want.deferred ?? false);
    assert.equal(actual.table, want.table);
    assert.equal(actual.type, want.type);
    if (want.type === 'c') {
      // Keep semantic normalization for supported expressions. New native CASE/JSON checks
      // are accepted only with the exact pinned token stream; parser failure is never a waiver.
      let actualExpression, expectedExpression;
      try {
        actualExpression = expression(actual.definition.replace(/^CHECK\s*/i, ''));
        expectedExpression = expression(want.definition.replace(/^CHECK\s*/i, ''));
      } catch {
        assert.deepEqual(
          definitionTokens(actual.definition),
          definitionTokens(want.definition),
          `Check differs: ${name}`,
        );
        continue;
      }
      assert.deepEqual(actualExpression, expectedExpression, `Check differs: ${name}`);
    } else if (want.type === 'f')
      assert.deepEqual(
        foreignKey(actual.definition),
        foreignKey(want.definition),
        `Foreign key differs: ${name}`,
      );
    else
      assert.deepEqual(
        definitionTokens(actual.definition),
        definitionTokens(want.definition),
        `Constraint differs: ${name}`,
      );
  }
  assert.deepEqual(Object.keys(f.indexes).sort(), Object.keys(SCHEMA.indexes).sort());
  for (const [name, want] of Object.entries(SCHEMA.indexes)) {
    const actual = f.indexes[name];
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(want).sort());
    assert.equal(actual.valid, true);
    assert.equal(actual.ready, true);
    assert.equal(actual.table, want.table);
    assert.equal(actual.unique, want.unique);
    assert.deepEqual(
      definitionTokens(actual.definition),
      definitionTokens(want.definition),
      `Index differs: ${name}`,
    );
  }
  assert.deepEqual(Object.keys(f.functions).sort(), Object.keys(SCHEMA.functions).sort());
  for (const [name, body] of Object.entries(SCHEMA.functions)) {
    const { body: actualBody, ...metadata } = f.functions[name];
    assert.deepEqual(metadata, SCHEMA.functionMetadata[name]);
    assert.deepEqual(tokens(actualBody), tokens(body));
  }
  assert.deepEqual(Object.keys(f.triggers).sort(), Object.keys(SCHEMA.triggers).sort());
  for (const [name, want] of Object.entries(SCHEMA.triggers)) {
    const a = f.triggers[name];
    assert.equal(a.enabled, 'O');
    assert.equal(a.when, null);
    assert.equal(a.arguments, 0);
    assert.deepEqual(
      { table: a.table, function: a.function, type: a.type, columns: [...a.columns].sort() },
      { ...want, columns: [...want.columns].sort() },
    );
  }
}

export const APPEND_ONLY_RUNTIME_TABLES = Object.freeze([
  'transfers',
  'transfer_command_receipts',
  'stay_assignment_replacements',
  'transfer_finance_reviews',
  'transfer_finance_resolutions',
  'invoice_voids',
  'correction_command_receipts',
  'correction_finance_links',
]);

export function verifyPrivileges(f, role, phase = 'after') {
  assert.equal(f.role, role);
  assert.equal(f.ownsObjects, 0);
  assert.equal(f.createSchema, false);
  assert.equal(f.createDatabase, false);
  assert.equal(f.tempDatabase, false);
  const expected =
    role === TARGET.verifier
      ? { _prisma_migrations: ['SELECT'] }
      : phase === 'before'
        ? {}
        : Object.fromEntries(
            FULL_APPLICATION_TABLES.map((t) => [
              t,
              t === 'audit_events' ? ['INSERT', 'SELECT'] : ['INSERT', 'SELECT', 'UPDATE'],
            ]),
          );
  // Void history, correction receipts and correction finance links are insert-only for runtime,
  // independently of the generic table policy.
  if (role !== TARGET.verifier && phase !== 'before') {
    for (const table of APPEND_ONLY_RUNTIME_TABLES) expected[table] = ['INSERT', 'SELECT'];
    expected.effective_stay_assignments = ['SELECT'];
  }
  assert.deepEqual(f.tablePrivileges, expected);
}

export async function readPrivileges(db, role) {
  const { rows } = await db.query(
    `SELECT
    has_schema_privilege($1,'public','CREATE') AS "createSchema",
    has_database_privilege($1,current_database(),'CREATE') AS "createDatabase",
    has_database_privilege($1,current_database(),'TEMP') AS "tempDatabase",
    ((SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=$1) AND relnamespace='public'::regnamespace)
     +(SELECT count(*) FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=$1) AND pronamespace='public'::regnamespace)
     +(SELECT count(*) FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=$1)))::int AS "ownsObjects"`,
    [role],
  );
  assert.equal(rows.length, 1);
  const grants = await db.query(
    `SELECT c.relname AS name, array_agg(p.priv ORDER BY p.priv) AS privileges FROM pg_class c
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(priv)
    WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f') AND (has_table_privilege($1,c.oid,p.priv) OR (CASE WHEN p.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege($1,c.oid,p.priv) ELSE false END))
    GROUP BY c.relname ORDER BY c.relname`,
    [role],
  );
  return {
    role,
    ...rows[0],
    tablePrivileges: Object.fromEntries(grants.rows.map((r) => [r.name, r.privileges])),
  };
}

// The injected connection is a dedicated, non-owner verifier. Never uses the runtime client.
export async function readLedger(db, expected) {
  await db.query('BEGIN READ ONLY');
  try {
    await db.query("SET LOCAL statement_timeout = '10s'");
    const identity = await readIdentity(db);
    verifyIdentityFacts(identity, TARGET.verifier);
    verifyPrivileges(await readPrivileges(db, TARGET.verifier), TARGET.verifier);
    const table =
      await db.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relname='_prisma_migrations'`);
    assert.equal(table.rows.length, 1);
    const columns =
      await db.query(`SELECT column_name AS name,data_type AS type,character_maximum_length AS length,is_nullable='YES' AS nullable,column_default AS "default"
      FROM information_schema.columns WHERE table_schema='public' AND table_name='_prisma_migrations'`);
    const pk =
      await db.query(`SELECT a.attname AS name FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum WHERE c.conrelid='public._prisma_migrations'::regclass AND c.contype='p' ORDER BY k.ordinality`);
    verifyLedgerSchema(
      { relation: table.rows[0], columns: columns.rows, primaryKey: pk.rows.map((r) => r.name) },
      TARGET.migrator,
    );
    const ledger = await db.query(`SELECT id,checksum,migration_name,logs,applied_steps_count,
      (extract(epoch FROM started_at)*1000000)::numeric(30,0)::text AS started_at,
      (extract(epoch FROM finished_at)*1000000)::numeric(30,0)::text AS finished_at,
      (extract(epoch FROM rolled_back_at)*1000000)::numeric(30,0)::text AS rolled_back_at FROM public._prisma_migrations`);
    verifyFreshLedger(ledger.rows, expected);
    return { identity, rows: ledger.rows };
  } finally {
    await db.query('ROLLBACK');
  }
}

export async function readSchema(db) {
  // All catalog reads are bounded and non-mutating. Duplicate names fail closed during collection.
  const collect = (rows, key, value) => {
    const o = {};
    for (const r of rows) {
      assert.ok(!Object.hasOwn(o, r[key]));
      o[r[key]] = value(r);
    }
    return o;
  };
  const tables =
    await db.query(`SELECT c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner,
    COALESCE((SELECT jsonb_object_agg(a.attname,jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull)
        || CASE WHEN (SELECT t.typtype FROM pg_type t WHERE t.oid=a.atttypid)='e'
           THEN jsonb_build_object('default',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum))
           ELSE '{}'::jsonb END)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'{}'::jsonb) AS columns
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')`);
  if (tables.rows.some((row) => row.name === 'stay_assignment_replacements'))
    return { phase4Catalog: await readPhase4Catalog(db) };
  const enums = await db.query(
    `SELECT t.typname AS name,array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace='public'::regnamespace GROUP BY t.typname`,
  );
  const constraints =
    await db.query(`SELECT conname AS name,cl.relname AS "table",contype AS type,convalidated AS validated,condeferrable AS deferrable,condeferred AS deferred,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid WHERE c.connamespace='public'::regnamespace AND cl.relname<>'_prisma_migrations' AND contype IN ('p','f','c')`);
  const indexes =
    await db.query(`SELECT ic.relname AS name,t.relname AS "table",i.indisunique AS "unique",i.indisvalid AS valid,i.indisready AS ready,
    ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num ORDER BY ord)::text[] AS columns,
    pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
    WHERE t.relnamespace='public'::regnamespace AND i.indpred IS NOT NULL`);
  const functions =
    await db.query(`SELECT p.proname AS name,p.prosrc AS body,pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,
    pg_get_function_result(p.oid) AS result,p.pronargs AS arguments,p.prosecdef AS "securityDefiner",p.proconfig AS config,p.provolatile AS volatility,p.proparallel AS parallel,p.proleakproof AS leakproof,p.proisstrict AS strict FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.pronamespace='public'::regnamespace`);
  const triggers =
    await db.query(`SELECT t.tgname AS name,c.relname AS "table",p.proname AS function,t.tgtype::int AS type,t.tgenabled AS enabled,t.tgnargs::int AS arguments,pg_get_expr(t.tgqual,t.tgrelid) AS "when",
    ARRAY(SELECT a.attname FROM unnest(t.tgattr) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num ORDER BY ord)::text[] AS columns
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`);
  const other = await db.query(
    `SELECT (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public') AS "schemaOwner", ARRAY(SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema' ORDER BY nspname)::text[] AS "userSchemas",
    ((SELECT count(*) FROM pg_type WHERE typnamespace='public'::regnamespace AND typowner<>(SELECT oid FROM pg_roles WHERE rolname=$1))
    +(SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proowner<>(SELECT oid FROM pg_roles WHERE rolname=$1)))::int AS "foreignOwnedObjects",
    ((SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind NOT IN ('r','i'))
     +(SELECT count(*) FROM pg_type t WHERE t.typnamespace='public'::regnamespace AND t.typcategory<>'A' AND t.typtype<>'e'
       AND NOT (t.typtype='c' AND EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=t.typrelid AND c.relkind='r'))))::int AS "unexpectedObjects"`,
    [TARGET.migrator],
  );
  const withoutName = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'name'));
  assert.equal(other.rows.length, 1);
  return {
    tables: collect(tables.rows, 'name', withoutName),
    enums: collect(enums.rows, 'name', (r) => r.labels),
    constraints: collect(constraints.rows, 'name', withoutName),
    indexes: collect(indexes.rows, 'name', withoutName),
    functions: collect(functions.rows, 'name', withoutName),
    triggers: collect(triggers.rows, 'name', withoutName),
    ...other.rows[0],
  };
}

// Exact reference data is pinned to all 23 migration checksums and independently exercised on fresh PostgreSQL.
const referenceFacts = phase4Facts(
  JSON.parse(readFileSync(new URL('./phase4-catalog.json', import.meta.url), 'utf8')).catalog,
);
export const SCHEMA = {
  tables: Object.fromEntries(
    Object.entries(referenceFacts.tables)
      .filter(([name]) => name !== '_prisma_migrations')
      .map(([name, value]) => [name, value.columns]),
  ),
  enums: referenceFacts.enums,
  constraints: referenceFacts.constraints,
  indexes: referenceFacts.indexes,
  functions: Object.fromEntries(
    Object.entries(referenceFacts.functions).map(([name, value]) => [name, value.body]),
  ),
  functionMetadata: Object.fromEntries(
    Object.entries(referenceFacts.functions).map(([name, value]) => {
      const { body, ...metadata } = value;
      void body;
      return [name, metadata];
    }),
  ),
  triggers: Object.fromEntries(
    Object.entries(referenceFacts.triggers).map(([name, value]) => [
      name,
      { table: value.table, function: value.function, type: value.type, columns: value.columns },
    ]),
  ),
};
