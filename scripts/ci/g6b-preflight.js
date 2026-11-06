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
    assert.ok(actual.validated && !actual.deferrable && !actual.deferred);
    assert.equal(actual.table, want.table);
    assert.equal(actual.type, want.type);
    if (want.type === 'c')
      assert.deepEqual(
        expression(actual.definition.replace(/^CHECK\s*/i, '')),
        expression(want.definition.replace(/^CHECK\s*/i, '')),
        `Check differs: ${name}`,
      );
    else if (want.type === 'f')
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
    const a = f.indexes[name];
    assert.ok(a.valid && a.ready);
    assert.equal(a.table, want.table);
    assert.equal(a.unique, want.unique);
    assert.deepEqual(a.columns, want.columns);
    assert.deepEqual(expression(a.predicate), expression(want.predicate), `Index differs: ${name}`);
  }
  assert.deepEqual(Object.keys(f.functions).sort(), Object.keys(SCHEMA.functions).sort());
  for (const [name, body] of Object.entries(SCHEMA.functions)) {
    const a = f.functions[name];
    assert.equal(a.owner, TARGET.migrator);
    assert.equal(a.language, 'plpgsql');
    assert.equal(a.result, 'trigger');
    assert.equal(a.arguments, 0);
    assert.equal(a.securityDefiner, false);
    assert.equal(a.config, null);
    assert.equal(a.volatility, 'v');
    assert.equal(a.parallel, 'u');
    assert.equal(a.leakproof, false);
    assert.equal(a.strict, false);
    assert.deepEqual(tokens(a.body), tokens(body));
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

// Reviewed structural contract derived from the 18 approved, checksum-pinned SQL files.
export const SCHEMA = {
  tables: {
    organizations: {
      status: {
        type: '"OrganizationStatus"',
        nullable: false,
        default: '\'ACTIVE\'::"OrganizationStatus"',
      },
      id: {
        type: 'uuid',
        nullable: false,
      },
      name: {
        type: 'text',
        nullable: false,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    users: {
      status: { type: '"UserStatus"', nullable: false, default: '\'ACTIVE\'::"UserStatus"' },
      id: {
        type: 'uuid',
        nullable: false,
      },
      login_identifier: {
        type: 'text',
        nullable: false,
      },
      password_hash: {
        type: 'text',
        nullable: false,
      },
      display_name: {
        type: 'text',
        nullable: false,
      },
      last_login_at: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      password_change_required: {
        type: 'boolean',
        nullable: false,
      },
    },
    memberships: {
      role: { type: '"MembershipRole"', nullable: false, default: null },
      status: {
        type: '"MembershipStatus"',
        nullable: false,
        default: '\'ACTIVE\'::"MembershipStatus"',
      },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      user_id: {
        type: 'uuid',
        nullable: false,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      revoked_at: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
    },
    properties: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      code: {
        type: 'text',
        nullable: false,
      },
      name: {
        type: 'text',
        nullable: false,
      },
      archived_at: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    floors: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      property_id: {
        type: 'uuid',
        nullable: false,
      },
      label: {
        type: 'text',
        nullable: false,
      },
      ordinal: {
        type: 'integer',
        nullable: false,
      },
      archived_at: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    rooms: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      property_id: {
        type: 'uuid',
        nullable: false,
      },
      floor_id: {
        type: 'uuid',
        nullable: false,
      },
      label: {
        type: 'text',
        nullable: false,
      },
      archived_at: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    beds: {
      operational_status: {
        type: '"BedOperationalStatus"',
        nullable: false,
        default: '\'IN_SERVICE\'::"BedOperationalStatus"',
      },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      property_id: {
        type: 'uuid',
        nullable: false,
      },
      room_id: {
        type: 'uuid',
        nullable: false,
      },
      label: {
        type: 'text',
        nullable: false,
      },
      out_of_service_reason: {
        type: 'text',
        nullable: true,
      },
      archived_at: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      price: {
        type: 'numeric(10,2)',
        nullable: false,
      },
    },
    sessions: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      token_hash: {
        type: 'text',
        nullable: false,
      },
      user_id: {
        type: 'uuid',
        nullable: false,
      },
      active_organization_id: {
        type: 'uuid',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      last_seen_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      idle_expires_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      absolute_expires_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      revoked_at: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      revoked_reason: {
        type: 'text',
        nullable: true,
      },
    },
    audit_events: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: true,
      },
      actor_user_id: {
        type: 'uuid',
        nullable: true,
      },
      action: {
        type: 'text',
        nullable: false,
      },
      target_type: {
        type: 'text',
        nullable: false,
      },
      target_id: {
        type: 'text',
        nullable: true,
      },
      request_id: {
        type: 'text',
        nullable: false,
      },
      occurred_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      reason_code: {
        type: 'text',
        nullable: true,
      },
      metadata: {
        type: 'jsonb',
        nullable: false,
      },
    },
    residents: {
      document_verification_status: {
        type: '"DocumentVerificationStatus"',
        nullable: false,
        default: '\'PENDING\'::"DocumentVerificationStatus"',
      },
      status: {
        type: '"ResidentStatus"',
        nullable: false,
        default: '\'ACTIVE\'::"ResidentStatus"',
      },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      first_name: {
        type: 'text',
        nullable: false,
      },
      last_name: {
        type: 'text',
        nullable: false,
      },
      date_of_birth: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      gender: {
        type: 'text',
        nullable: true,
      },
      phone: {
        type: 'text',
        nullable: true,
      },
      email: {
        type: 'text',
        nullable: true,
      },
      address: {
        type: 'text',
        nullable: true,
      },
      emergency_contact_name: {
        type: 'text',
        nullable: true,
      },
      emergency_contact_phone: {
        type: 'text',
        nullable: true,
      },
      emergency_contact_relation: {
        type: 'text',
        nullable: true,
      },
      document_metadata: {
        type: 'jsonb',
        nullable: true,
      },
      document_url: {
        type: 'text',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    enquiries: {
      source: { type: '"EnquirySource"', nullable: false, default: '\'OTHER\'::"EnquirySource"' },
      status: { type: '"EnquiryStatus"', nullable: false, default: '\'NEW\'::"EnquiryStatus"' },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      property_id: {
        type: 'uuid',
        nullable: true,
      },
      first_name: {
        type: 'text',
        nullable: false,
      },
      last_name: {
        type: 'text',
        nullable: false,
      },
      phone: {
        type: 'text',
        nullable: false,
      },
      email: {
        type: 'text',
        nullable: true,
      },
      preferred_room_type: {
        type: 'text',
        nullable: true,
      },
      expected_move_in_date: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      expected_duration_of_stay: {
        type: 'integer',
        nullable: true,
      },
      number_of_occupants: {
        type: 'integer',
        nullable: true,
      },
      notes: {
        type: 'text',
        nullable: true,
      },
      assigned_user_id: {
        type: 'uuid',
        nullable: true,
      },
      resident_id: {
        type: 'uuid',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    enquiry_follow_ups: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      enquiry_id: {
        type: 'uuid',
        nullable: false,
      },
      user_id: {
        type: 'uuid',
        nullable: false,
      },
      notes: {
        type: 'text',
        nullable: false,
      },
      follow_up_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      outcome: {
        type: 'text',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    bookings: {
      status: {
        type: '"BookingStatus"',
        nullable: false,
        default: '\'CONFIRMED\'::"BookingStatus"',
      },
      payment_status: {
        type: '"PaymentStatus"',
        nullable: false,
        default: '\'PENDING\'::"PaymentStatus"',
      },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      resident_id: {
        type: 'uuid',
        nullable: false,
      },
      bed_id: {
        type: 'uuid',
        nullable: false,
      },
      start_date: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      end_date: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      monthly_price: {
        type: 'numeric(10,2)',
        nullable: false,
      },
      notes: {
        type: 'text',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    admissions: {
      status: {
        type: '"AdmissionStatus"',
        nullable: false,
        default: '\'PENDING\'::"AdmissionStatus"',
      },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      booking_id: {
        type: 'uuid',
        nullable: false,
      },
      resident_id: {
        type: 'uuid',
        nullable: false,
      },
      bed_id: {
        type: 'uuid',
        nullable: false,
      },
      property_id: {
        type: 'uuid',
        nullable: true,
      },
      room_id: {
        type: 'uuid',
        nullable: true,
      },
      admission_date: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      notes: {
        type: 'text',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    check_ins: {
      status: { type: '"CheckInStatus"', nullable: false, default: '\'ACTIVE\'::"CheckInStatus"' },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      admission_id: {
        type: 'uuid',
        nullable: false,
      },
      resident_id: {
        type: 'uuid',
        nullable: false,
      },
      bed_id: {
        type: 'uuid',
        nullable: false,
      },
      booking_id: {
        type: 'uuid',
        nullable: false,
      },
      check_in_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      notes: {
        type: 'text',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    check_outs: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      check_in_id: {
        type: 'uuid',
        nullable: false,
      },
      resident_id: {
        type: 'uuid',
        nullable: false,
      },
      bed_id: {
        type: 'uuid',
        nullable: false,
      },
      booking_id: {
        type: 'uuid',
        nullable: false,
      },
      check_out_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      reason: {
        type: 'text',
        nullable: true,
      },
      notes: {
        type: 'text',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    invoices: {
      status: { type: '"InvoiceStatus"', nullable: false, default: '\'DRAFT\'::"InvoiceStatus"' },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      resident_id: {
        type: 'uuid',
        nullable: false,
      },
      booking_id: {
        type: 'uuid',
        nullable: true,
      },
      number: {
        type: 'text',
        nullable: false,
      },
      period_start: {
        type: 'date',
        nullable: false,
      },
      period_end: {
        type: 'date',
        nullable: false,
      },
      amount: {
        type: 'numeric(12,2)',
        nullable: false,
      },
      paid_amount: {
        type: 'numeric(12,2)',
        nullable: false,
      },
      due_date: {
        type: 'date',
        nullable: false,
      },
      issued_at: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      notes: {
        type: 'text',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      adjustment_total: {
        type: 'numeric(12,2)',
        nullable: false,
      },
    },
    payments: {
      method: { type: '"PaymentMethod"', nullable: false, default: null },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      invoice_id: {
        type: 'uuid',
        nullable: false,
      },
      resident_id: {
        type: 'uuid',
        nullable: false,
      },
      amount: {
        type: 'numeric(12,2)',
        nullable: false,
      },
      reference: {
        type: 'text',
        nullable: true,
      },
      received_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      notes: {
        type: 'text',
        nullable: true,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      corrects_payment_id: {
        type: 'uuid',
        nullable: true,
      },
      credit_total_at_payment: {
        type: 'numeric(12,2)',
        nullable: true,
      },
      balance_after_payment: {
        type: 'numeric(12,2)',
        nullable: true,
      },
    },
    payment_idempotency_keys: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      key: {
        type: 'text',
        nullable: false,
      },
      request_hash: {
        type: 'text',
        nullable: false,
      },
      payment_id: {
        type: 'uuid',
        nullable: false,
      },
      response: {
        type: 'jsonb',
        nullable: false,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    payment_reversals: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      payment_id: {
        type: 'uuid',
        nullable: false,
      },
      invoice_id: {
        type: 'uuid',
        nullable: false,
      },
      reason: {
        type: 'text',
        nullable: false,
      },
      reversed_by: {
        type: 'uuid',
        nullable: false,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    invoice_adjustments: {
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      invoice_id: {
        type: 'uuid',
        nullable: false,
      },
      resident_id: {
        type: 'uuid',
        nullable: false,
      },
      amount: {
        type: 'numeric(12,2)',
        nullable: false,
      },
      reason: {
        type: 'text',
        nullable: false,
      },
      created_by: {
        type: 'uuid',
        nullable: false,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    login_throttles: {
      scope: {
        type: 'text',
        nullable: false,
      },
      key_hash: {
        type: 'text',
        nullable: false,
      },
      failures: {
        type: 'integer',
        nullable: false,
      },
      window_started_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
      locked_until: {
        type: 'timestamp(6) with time zone',
        nullable: true,
      },
      updated_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
    invoice_voids: {
      previous_status: { type: '"InvoiceStatus"', nullable: false, default: null },
      id: {
        type: 'uuid',
        nullable: false,
      },
      organization_id: {
        type: 'uuid',
        nullable: false,
      },
      invoice_id: {
        type: 'uuid',
        nullable: false,
      },
      resident_id: {
        type: 'uuid',
        nullable: false,
      },
      amount_at_void: {
        type: 'numeric(12,2)',
        nullable: false,
      },
      reason: {
        type: 'text',
        nullable: false,
      },
      voided_by: {
        type: 'uuid',
        nullable: false,
      },
      created_at: {
        type: 'timestamp(6) with time zone',
        nullable: false,
      },
    },
  },
  enums: {
    OrganizationStatus: ['ACTIVE', 'DISABLED'],
    UserStatus: ['ACTIVE', 'DISABLED'],
    MembershipStatus: ['ACTIVE', 'REVOKED'],
    MembershipRole: ['OWNER', 'PROPERTY_MANAGER'],
    BedOperationalStatus: ['IN_SERVICE', 'OUT_OF_SERVICE'],
    ResidentStatus: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
    DocumentVerificationStatus: ['PENDING', 'VERIFIED', 'REJECTED'],
    EnquiryStatus: ['NEW', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'CONVERTED', 'LOST', 'ARCHIVED'],
    EnquirySource: ['WEBSITE', 'PHONE_CALL', 'WALK_IN', 'REFERRAL', 'SOCIAL_MEDIA', 'OTHER'],
    BookingStatus: ['CONFIRMED', 'CANCELLED'],
    PaymentStatus: ['PENDING', 'PAID', 'OVERDUE', 'REFUNDED'],
    AdmissionStatus: ['PENDING', 'ADMITTED', 'CANCELLED'],
    CheckInStatus: ['ACTIVE', 'CHECKED_OUT'],
    InvoiceStatus: ['DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED'],
    PaymentMethod: ['CASH', 'UPI', 'BANK_TRANSFER'],
  },
  constraints: {
    organizations_pkey: {
      table: 'organizations',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    users_pkey: {
      table: 'users',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    memberships_pkey: {
      table: 'memberships',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    properties_pkey: {
      table: 'properties',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    floors_pkey: {
      table: 'floors',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    rooms_pkey: {
      table: 'rooms',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    beds_pkey: {
      table: 'beds',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    sessions_pkey: {
      table: 'sessions',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    audit_events_pkey: {
      table: 'audit_events',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    memberships_organization_id_fkey: {
      table: 'memberships',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    memberships_user_id_fkey: {
      table: 'memberships',
      type: 'f',
      definition:
        'FOREIGN KEY ("user_id") REFERENCES "users"("id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    properties_organization_id_fkey: {
      table: 'properties',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    floors_property_id_organization_id_fkey: {
      table: 'floors',
      type: 'f',
      definition:
        'FOREIGN KEY ("property_id", "organization_id")\n    REFERENCES "properties"("id", "organization_id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    rooms_floor_id_property_id_organization_id_fkey: {
      table: 'rooms',
      type: 'f',
      definition:
        'FOREIGN KEY ("floor_id", "property_id", "organization_id")\n    REFERENCES "floors"("id", "property_id", "organization_id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    beds_room_id_property_id_organization_id_fkey: {
      table: 'beds',
      type: 'f',
      definition:
        'FOREIGN KEY ("room_id", "property_id", "organization_id")\n    REFERENCES "rooms"("id", "property_id", "organization_id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    sessions_user_id_fkey: {
      table: 'sessions',
      type: 'f',
      definition:
        'FOREIGN KEY ("user_id") REFERENCES "users"("id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    sessions_active_organization_id_user_id_fkey: {
      table: 'sessions',
      type: 'f',
      definition:
        'FOREIGN KEY ("active_organization_id", "user_id")\n    REFERENCES "memberships"("organization_id", "user_id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    audit_events_organization_id_fkey: {
      table: 'audit_events',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    audit_events_actor_user_id_fkey: {
      table: 'audit_events',
      type: 'f',
      definition:
        'FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")\n    ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    residents_pkey: {
      table: 'residents',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    residents_organization_id_fkey: {
      table: 'residents',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    enquiries_pkey: {
      table: 'enquiries',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    enquiry_follow_ups_pkey: {
      table: 'enquiry_follow_ups',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    enquiries_organization_id_fkey: {
      table: 'enquiries',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    enquiries_property_id_fkey: {
      table: 'enquiries',
      type: 'f',
      definition:
        'FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE RESTRICT',
    },
    enquiries_resident_id_fkey: {
      table: 'enquiries',
      type: 'f',
      definition:
        'FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE RESTRICT',
    },
    enquiry_follow_ups_enquiry_id_fkey: {
      table: 'enquiry_follow_ups',
      type: 'f',
      definition:
        'FOREIGN KEY ("enquiry_id") REFERENCES "enquiries"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
    },
    enquiry_follow_ups_user_id_fkey: {
      table: 'enquiry_follow_ups',
      type: 'f',
      definition:
        'FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    bookings_pkey: {
      table: 'bookings',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    bookings_organization_id_fkey: {
      table: 'bookings',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    admissions_pkey: {
      table: 'admissions',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    admissions_organization_id_fkey: {
      table: 'admissions',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    admissions_property_id_fkey: {
      table: 'admissions',
      type: 'f',
      definition:
        'FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE RESTRICT',
    },
    admissions_room_id_fkey: {
      table: 'admissions',
      type: 'f',
      definition:
        'FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE RESTRICT',
    },
    check_ins_pkey: {
      table: 'check_ins',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    check_outs_pkey: {
      table: 'check_outs',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    check_ins_organization_id_fkey: {
      table: 'check_ins',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_outs_organization_id_fkey: {
      table: 'check_outs',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoices_pkey: {
      table: 'invoices',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    payments_pkey: {
      table: 'payments',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    invoices_organization_id_fkey: {
      table: 'invoices',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoices_resident_id_organization_id_fkey: {
      table: 'invoices',
      type: 'f',
      definition:
        'FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoices_booking_id_organization_id_fkey: {
      table: 'invoices',
      type: 'f',
      definition:
        'FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    payments_organization_id_fkey: {
      table: 'payments',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    payments_resident_id_organization_id_fkey: {
      table: 'payments',
      type: 'f',
      definition:
        'FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    payments_invoice_id_organization_id_resident_id_fkey: {
      table: 'payments',
      type: 'f',
      definition:
        'FOREIGN KEY ("invoice_id", "organization_id", "resident_id") REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoices_amount_positive: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("amount" > 0)',
    },
    invoices_paid_within_amount: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("paid_amount" >= 0 AND "paid_amount" <= "amount")',
    },
    invoices_period_valid: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("period_end" >= "period_start")',
    },
    invoices_due_after_period_start: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("due_date" >= "period_start")',
    },
    invoices_paid_status_consistent: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("status" <> \'PAID\' OR "paid_amount" = "amount")',
    },
    invoices_draft_unpaid: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("status" <> \'DRAFT\' OR "paid_amount" = 0)',
    },
    invoices_number_format: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("number" ~ \'^INV-[0-9]{4}-[0-9]{4,}$\')',
    },
    payments_amount_positive: {
      table: 'payments',
      type: 'c',
      definition: 'CHECK ("amount" > 0)',
    },
    payment_idempotency_keys_pkey: {
      table: 'payment_idempotency_keys',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    payment_idempotency_keys_organization_id_fkey: {
      table: 'payment_idempotency_keys',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    payment_idempotency_keys_payment_id_organization_id_fkey: {
      table: 'payment_idempotency_keys',
      type: 'f',
      definition:
        'FOREIGN KEY ("payment_id", "organization_id") REFERENCES "payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    payment_idempotency_keys_key_format_check: {
      table: 'payment_idempotency_keys',
      type: 'c',
      definition: 'CHECK ("key" ~ \'^[A-Za-z0-9_.:-]{8,128}$\')',
    },
    payment_idempotency_keys_hash_format_check: {
      table: 'payment_idempotency_keys',
      type: 'c',
      definition: 'CHECK ("request_hash" ~ \'^[0-9a-f]{64}$\')',
    },
    payment_reversals_pkey: {
      table: 'payment_reversals',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    invoice_adjustments_pkey: {
      table: 'invoice_adjustments',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    payments_corrects_payment_id_organization_id_fkey: {
      table: 'payments',
      type: 'f',
      definition:
        'FOREIGN KEY ("corrects_payment_id", "organization_id") REFERENCES "payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    payment_reversals_organization_id_fkey: {
      table: 'payment_reversals',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    payment_reversals_payment_id_invoice_id_organization_id_fkey: {
      table: 'payment_reversals',
      type: 'f',
      definition:
        'FOREIGN KEY ("payment_id", "invoice_id", "organization_id") REFERENCES "payments"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    payment_reversals_reversed_by_fkey: {
      table: 'payment_reversals',
      type: 'f',
      definition:
        'FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoice_adjustments_organization_id_fkey: {
      table: 'invoice_adjustments',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoice_adjustments_invoice_id_organization_id_resident_id_fkey: {
      table: 'invoice_adjustments',
      type: 'f',
      definition:
        'FOREIGN KEY ("invoice_id", "organization_id", "resident_id") REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoice_adjustments_created_by_fkey: {
      table: 'invoice_adjustments',
      type: 'f',
      definition:
        'FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoices_adjustment_total_valid: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("adjustment_total" <= 0 AND "adjustment_total" >= -"amount")',
    },
    invoices_cash_received_non_negative: {
      table: 'invoices',
      type: 'c',
      definition: 'CHECK ("paid_amount" + "adjustment_total" >= 0)',
    },
    invoice_adjustments_credit_only: {
      table: 'invoice_adjustments',
      type: 'c',
      definition: 'CHECK ("amount" < 0)',
    },
    invoice_adjustments_reason_present: {
      table: 'invoice_adjustments',
      type: 'c',
      definition: 'CHECK (length(btrim("reason")) BETWEEN 3 AND 500)',
    },
    payment_reversals_reason_present: {
      table: 'payment_reversals',
      type: 'c',
      definition: 'CHECK (length(btrim("reason")) BETWEEN 3 AND 500)',
    },
    bookings_resident_id_organization_id_fkey: {
      table: 'bookings',
      type: 'f',
      definition:
        'FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    bookings_bed_id_organization_id_fkey: {
      table: 'bookings',
      type: 'f',
      definition:
        'FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    admissions_booking_id_organization_id_fkey: {
      table: 'admissions',
      type: 'f',
      definition:
        'FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    admissions_resident_id_organization_id_fkey: {
      table: 'admissions',
      type: 'f',
      definition:
        'FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    admissions_bed_id_organization_id_fkey: {
      table: 'admissions',
      type: 'f',
      definition:
        'FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_ins_admission_id_organization_id_fkey: {
      table: 'check_ins',
      type: 'f',
      definition:
        'FOREIGN KEY ("admission_id", "organization_id") REFERENCES "admissions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_ins_resident_id_organization_id_fkey: {
      table: 'check_ins',
      type: 'f',
      definition:
        'FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_ins_bed_id_organization_id_fkey: {
      table: 'check_ins',
      type: 'f',
      definition:
        'FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_ins_booking_id_organization_id_fkey: {
      table: 'check_ins',
      type: 'f',
      definition:
        'FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_outs_check_in_id_organization_id_fkey: {
      table: 'check_outs',
      type: 'f',
      definition:
        'FOREIGN KEY ("check_in_id", "organization_id") REFERENCES "check_ins"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_outs_resident_id_organization_id_fkey: {
      table: 'check_outs',
      type: 'f',
      definition:
        'FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_outs_bed_id_organization_id_fkey: {
      table: 'check_outs',
      type: 'f',
      definition:
        'FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    check_outs_booking_id_organization_id_fkey: {
      table: 'check_outs',
      type: 'f',
      definition:
        'FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    login_throttles_pkey: {
      table: 'login_throttles',
      type: 'p',
      definition: 'PRIMARY KEY ("scope", "key_hash")',
    },
    login_throttles_scope_valid: {
      table: 'login_throttles',
      type: 'c',
      definition: "CHECK (\"scope\" IN ('IDENTIFIER', 'ADDRESS', 'PASSWORD'))",
    },
    login_throttles_key_hash_format: {
      table: 'login_throttles',
      type: 'c',
      definition: 'CHECK ("key_hash" ~ \'^[0-9a-f]{64}$\')',
    },
    login_throttles_failures_non_negative: {
      table: 'login_throttles',
      type: 'c',
      definition: 'CHECK ("failures" >= 0)',
    },
    payments_snapshot_complete: {
      table: 'payments',
      type: 'c',
      definition:
        'CHECK (num_nonnulls("credit_total_at_payment", "balance_after_payment") IN (0, 2))',
    },
    payments_snapshot_credit_valid: {
      table: 'payments',
      type: 'c',
      definition: 'CHECK ("credit_total_at_payment" IS NULL OR "credit_total_at_payment" <= 0)',
    },
    payments_snapshot_balance_valid: {
      table: 'payments',
      type: 'c',
      definition: 'CHECK ("balance_after_payment" IS NULL OR "balance_after_payment" >= 0)',
    },
    invoice_voids_pkey: {
      table: 'invoice_voids',
      type: 'p',
      definition: 'PRIMARY KEY ("id")',
    },
    invoice_voids_organization_id_fkey: {
      table: 'invoice_voids',
      type: 'f',
      definition:
        'FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoice_voids_invoice_id_organization_id_resident_id_fkey: {
      table: 'invoice_voids',
      type: 'f',
      definition:
        'FOREIGN KEY ("invoice_id", "organization_id", "resident_id")\n  REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoice_voids_voided_by_fkey: {
      table: 'invoice_voids',
      type: 'f',
      definition:
        'FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    },
    invoice_voids_reason_present: {
      table: 'invoice_voids',
      type: 'c',
      definition: 'CHECK (length(btrim("reason")) BETWEEN 3 AND 500)',
    },
    invoice_voids_amount_positive: {
      table: 'invoice_voids',
      type: 'c',
      definition: 'CHECK ("amount_at_void" > 0)',
    },
    invoice_voids_previous_status_open: {
      table: 'invoice_voids',
      type: 'c',
      definition: 'CHECK ("previous_status" <> \'CANCELLED\')',
    },
    invoices_issued_at_consistent: {
      table: 'invoices',
      type: 'c',
      definition:
        'CHECK ("status" = \'CANCELLED\' OR (("status" = \'DRAFT\') = ("issued_at" IS NULL)))',
    },
    invoices_status_matches_amounts: {
      table: 'invoices',
      type: 'c',
      definition:
        'CHECK (\n     "status" IN (\'DRAFT\', \'CANCELLED\')\n  OR ("status" = \'PAID\' AND "paid_amount" = "amount")\n  OR ("status" = \'PARTIALLY_PAID\' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" > 0)\n  OR ("status" = \'ISSUED\' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" <= 0)\n  OR ("status" = \'OVERDUE\' AND "paid_amount" < "amount")\n)',
    },
  },
  indexes: {
    properties_organization_id_code_active_key: {
      table: 'properties',
      unique: true,
      columns: ['organization_id', 'code'],
      predicate: '"archived_at" IS NULL',
    },
    floors_property_id_ordinal_active_key: {
      table: 'floors',
      unique: true,
      columns: ['property_id', 'ordinal'],
      predicate: '"archived_at" IS NULL',
    },
    floors_property_id_label_active_key: {
      table: 'floors',
      unique: true,
      columns: ['property_id', 'label'],
      predicate: '"archived_at" IS NULL',
    },
    rooms_property_id_label_active_key: {
      table: 'rooms',
      unique: true,
      columns: ['property_id', 'label'],
      predicate: '"archived_at" IS NULL',
    },
    beds_room_id_label_active_key: {
      table: 'beds',
      unique: true,
      columns: ['room_id', 'label'],
      predicate: '"archived_at" IS NULL',
    },
    invoices_active_booking_period_key: {
      table: 'invoices',
      unique: true,
      columns: ['organization_id', 'booking_id', 'period_start'],
      predicate: '"status" <> \'CANCELLED\' AND "booking_id" IS NOT NULL',
    },
    invoices_active_resident_period_legacy_key: {
      table: 'invoices',
      unique: true,
      columns: ['organization_id', 'resident_id', 'period_start'],
      predicate: '"status" <> \'CANCELLED\' AND "booking_id" IS NULL',
    },
  },
  functions: {
    finance_forbid_payment_change:
      "BEGIN\n  RAISE EXCEPTION 'payments are immutable; record an adjustment instead' USING ERRCODE = '23001';\nEND;",
    finance_guard_invoice:
      'BEGIN\n  IF TG_OP = \'DELETE\' THEN\n    RAISE EXCEPTION \'invoices cannot be deleted; void instead\' USING ERRCODE = \'23001\';\n  END IF;\n\n  IF OLD."status" = \'CANCELLED\' THEN\n    RAISE EXCEPTION \'a voided invoice cannot be changed\' USING ERRCODE = \'23001\';\n  END IF;\n\n  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (\n       (OLD."status" = \'DRAFT\' AND NEW."status" IN (\'ISSUED\', \'CANCELLED\'))\n    OR (OLD."status" IN (\'ISSUED\', \'OVERDUE\', \'PARTIALLY_PAID\', \'PAID\')\n        AND NEW."status" IN (\'ISSUED\', \'PARTIALLY_PAID\', \'PAID\', \'CANCELLED\'))\n  ) THEN\n    RAISE EXCEPTION \'invalid invoice status transition % -> %\', OLD."status", NEW."status"\n      USING ERRCODE = \'23001\';\n  END IF;\n\n  IF NEW."status" = \'CANCELLED\' THEN\n    IF NOT EXISTS (\n      SELECT 1 FROM "invoice_voids" v\n       WHERE v."invoice_id" = OLD."id" AND v."organization_id" = OLD."organization_id"\n    ) THEN\n      RAISE EXCEPTION \'an invoice can only be cancelled by recording a void\' USING ERRCODE = \'23001\';\n    END IF;\n    IF NEW."paid_amount" <> 0 OR NEW."adjustment_total" <> 0 THEN\n      RAISE EXCEPTION \'an invoice with settled money or credits cannot be voided\' USING ERRCODE = \'23001\';\n    END IF;\n  END IF;\n\n  IF OLD."status" = \'DRAFT\' AND NEW."status" = \'ISSUED\' AND NEW."issued_at" IS NULL THEN\n    RAISE EXCEPTION \'issuing an invoice requires issued_at\' USING ERRCODE = \'23514\';\n  END IF;\n\n  IF OLD."status" <> \'DRAFT\' AND (\n       NEW."amount" IS DISTINCT FROM OLD."amount"\n    OR NEW."number" IS DISTINCT FROM OLD."number"\n    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"\n    OR NEW."resident_id" IS DISTINCT FROM OLD."resident_id"\n    OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"\n    OR NEW."period_start" IS DISTINCT FROM OLD."period_start"\n    OR NEW."period_end" IS DISTINCT FROM OLD."period_end"\n    OR NEW."due_date" IS DISTINCT FROM OLD."due_date"\n    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"\n    OR NEW."notes" IS DISTINCT FROM OLD."notes"\n    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"\n  ) THEN\n    RAISE EXCEPTION \'issued invoice identity, amount, dates and notes are immutable\' USING ERRCODE = \'23001\';\n  END IF;\n  RETURN NEW;\nEND;',
    finance_forbid_idempotency_change:
      "BEGIN\n  RAISE EXCEPTION 'payment idempotency keys are append-only' USING ERRCODE = '23001';\nEND;",
    finance_forbid_correction_change:
      "BEGIN\n  RAISE EXCEPTION 'financial corrections are append-only' USING ERRCODE = '23001';\nEND;",
    finance_check_payment_correction:
      'BEGIN\n  IF NEW."corrects_payment_id" IS NOT NULL AND NOT EXISTS (\n    SELECT 1 FROM "payment_reversals" r\n    WHERE r."payment_id" = NEW."corrects_payment_id"\n      AND r."organization_id" = NEW."organization_id"\n      AND r."invoice_id" = NEW."invoice_id"\n  ) THEN\n    RAISE EXCEPTION \'a payment can only correct a reversed payment on the same invoice\' USING ERRCODE = \'23514\';\n  END IF;\n  RETURN NEW;\nEND;',
    check_admission_location:
      'BEGIN\n  IF NEW."property_id" IS NOT NULL AND NOT EXISTS (\n    SELECT 1 FROM "properties" p WHERE p."id" = NEW."property_id" AND p."organization_id" = NEW."organization_id"\n  ) THEN\n    RAISE EXCEPTION \'admission property must belong to the same organization\' USING ERRCODE = \'23514\';\n  END IF;\n  IF NEW."room_id" IS NOT NULL AND NOT EXISTS (\n    SELECT 1 FROM "rooms" r\n    WHERE r."id" = NEW."room_id" AND r."organization_id" = NEW."organization_id"\n      AND (NEW."property_id" IS NULL OR r."property_id" = NEW."property_id")\n  ) THEN\n    RAISE EXCEPTION \'admission room must belong to the same organization and to the selected property\' USING ERRCODE = \'23514\';\n  END IF;\n  RETURN NEW;\nEND;',
    check_admission_matches_booking:
      'BEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM "bookings" b WHERE b."id" = NEW."booking_id" AND b."resident_id" = NEW."resident_id" AND b."bed_id" = NEW."bed_id"\n  ) THEN\n    RAISE EXCEPTION \'admission resident and bed must match its booking\' USING ERRCODE = \'23514\';\n  END IF;\n  RETURN NEW;\nEND;',
    check_check_in_matches_admission:
      'BEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM "admissions" a\n    WHERE a."id" = NEW."admission_id" AND a."resident_id" = NEW."resident_id" AND a."bed_id" = NEW."bed_id" AND a."booking_id" = NEW."booking_id"\n  ) THEN\n    RAISE EXCEPTION \'check-in resident, bed and booking must match its admission\' USING ERRCODE = \'23514\';\n  END IF;\n  RETURN NEW;\nEND;',
    check_check_out_matches_check_in:
      'BEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM "check_ins" c\n    WHERE c."id" = NEW."check_in_id" AND c."resident_id" = NEW."resident_id" AND c."bed_id" = NEW."bed_id" AND c."booking_id" = NEW."booking_id"\n  ) THEN\n    RAISE EXCEPTION \'check-out resident, bed and booking must match its check-in\' USING ERRCODE = \'23514\';\n  END IF;\n  RETURN NEW;\nEND;',
    check_enquiry_links:
      'BEGIN\n  IF NEW."property_id" IS NOT NULL AND NOT EXISTS (\n    SELECT 1 FROM "properties" p WHERE p."id" = NEW."property_id" AND p."organization_id" = NEW."organization_id"\n  ) THEN\n    RAISE EXCEPTION \'enquiry property must belong to the same organization\' USING ERRCODE = \'23514\';\n  END IF;\n  IF NEW."resident_id" IS NOT NULL AND NOT EXISTS (\n    SELECT 1 FROM "residents" r WHERE r."id" = NEW."resident_id" AND r."organization_id" = NEW."organization_id"\n  ) THEN\n    RAISE EXCEPTION \'enquiry resident must belong to the same organization\' USING ERRCODE = \'23514\';\n  END IF;\n  RETURN NEW;\nEND;',
    check_enquiry_assignee:
      'BEGIN\n  IF NEW."assigned_user_id" IS NOT NULL AND NOT EXISTS (\n    SELECT 1 FROM "memberships" m WHERE m."user_id" = NEW."assigned_user_id" AND m."organization_id" = NEW."organization_id"\n  ) THEN\n    RAISE EXCEPTION \'enquiry assignee must be a member of the same organization\' USING ERRCODE = \'23514\';\n  END IF;\n  RETURN NEW;\nEND;',
    finance_snapshot_payment:
      'DECLARE inv RECORD;\nBEGIN\n  SELECT "status", "amount", "paid_amount", "adjustment_total" INTO inv\n    FROM "invoices"\n   WHERE "id" = NEW."invoice_id" AND "organization_id" = NEW."organization_id"\n     FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION \'payment references an unknown invoice\' USING ERRCODE = \'23503\';\n  END IF;\n  IF inv."status" IN (\'DRAFT\', \'CANCELLED\') THEN\n    RAISE EXCEPTION \'payments cannot be recorded against a % invoice\', lower(inv."status"::text)\n      USING ERRCODE = \'23514\';\n  END IF;\n  NEW."credit_total_at_payment" := inv."adjustment_total";\n  NEW."balance_after_payment"   := inv."amount" - inv."paid_amount" - NEW."amount";\n  IF NEW."balance_after_payment" < 0 THEN\n    RAISE EXCEPTION \'payment exceeds the invoice balance\' USING ERRCODE = \'23514\';\n  END IF;\n  RETURN NEW;\nEND;',
    finance_check_void:
      'DECLARE inv RECORD;\nBEGIN\n  SELECT "status", "amount", "paid_amount", "adjustment_total" INTO inv\n    FROM "invoices"\n   WHERE "id" = NEW."invoice_id" AND "organization_id" = NEW."organization_id"\n     FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION \'void references an unknown invoice\' USING ERRCODE = \'23503\';\n  END IF;\n  IF inv."status" = \'CANCELLED\' THEN\n    RAISE EXCEPTION \'invoice is already voided\' USING ERRCODE = \'23505\';\n  END IF;\n  IF inv."paid_amount" <> 0 OR inv."adjustment_total" <> 0 THEN\n    RAISE EXCEPTION \'an invoice with settled money or credits cannot be voided; reverse its payments first\'\n      USING ERRCODE = \'23514\';\n  END IF;\n  NEW."previous_status" := inv."status";\n  NEW."amount_at_void"  := inv."amount";\n  RETURN NEW;\nEND;',
  },
  triggers: {
    payments_immutable: {
      table: 'payments',
      function: 'finance_forbid_payment_change',
      type: 27,
      columns: [],
    },
    invoices_guard: {
      table: 'invoices',
      function: 'finance_guard_invoice',
      type: 27,
      columns: [],
    },
    payment_idempotency_keys_immutable: {
      table: 'payment_idempotency_keys',
      function: 'finance_forbid_idempotency_change',
      type: 27,
      columns: [],
    },
    payment_reversals_immutable: {
      table: 'payment_reversals',
      function: 'finance_forbid_correction_change',
      type: 27,
      columns: [],
    },
    invoice_adjustments_immutable: {
      table: 'invoice_adjustments',
      function: 'finance_forbid_correction_change',
      type: 27,
      columns: [],
    },
    payments_check_correction: {
      table: 'payments',
      function: 'finance_check_payment_correction',
      type: 7,
      columns: [],
    },
    admissions_check_location: {
      table: 'admissions',
      function: 'check_admission_location',
      type: 23,
      columns: ['organization_id', 'property_id', 'room_id'],
    },
    admissions_match_booking: {
      table: 'admissions',
      function: 'check_admission_matches_booking',
      type: 23,
      columns: ['booking_id', 'resident_id', 'bed_id'],
    },
    check_ins_match_admission: {
      table: 'check_ins',
      function: 'check_check_in_matches_admission',
      type: 23,
      columns: ['admission_id', 'resident_id', 'bed_id', 'booking_id'],
    },
    check_outs_match_check_in: {
      table: 'check_outs',
      function: 'check_check_out_matches_check_in',
      type: 23,
      columns: ['check_in_id', 'resident_id', 'bed_id', 'booking_id'],
    },
    enquiries_check_links: {
      table: 'enquiries',
      function: 'check_enquiry_links',
      type: 23,
      columns: ['organization_id', 'property_id', 'resident_id'],
    },
    enquiries_check_assignee: {
      table: 'enquiries',
      function: 'check_enquiry_assignee',
      type: 23,
      columns: ['organization_id', 'assigned_user_id'],
    },
    payments_snapshot: {
      table: 'payments',
      function: 'finance_snapshot_payment',
      type: 7,
      columns: [],
    },
    invoice_voids_immutable: {
      table: 'invoice_voids',
      function: 'finance_forbid_correction_change',
      type: 27,
      columns: [],
    },
    invoice_voids_check: {
      table: 'invoice_voids',
      function: 'finance_check_void',
      type: 7,
      columns: [],
    },
  },
};
