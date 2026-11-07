// Exercise the locked PostgreSQL driver boundary in the existing G6B test selection.
import './catalog-arrays.test.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DATABASE_MARKER } from '../../apps/api/test/integration/helpers/guard.ts';
import {
  SCHEMA,
  TARGET,
  expression,
  verifyFreshFacts,
  verifyIdentityFacts,
  verifySchemaFacts,
  verifyPrivileges,
  readLedger,
  readIdentity,
  readFreshFacts,
  readSchema,
} from './g6b-preflight.js';
import { LEDGER_COLUMNS } from './migration-ledger.js';
const expected = JSON.parse(
  readFileSync(new URL('./g6b-migrations.json', import.meta.url)),
).migrations;
const identity = (role = TARGET.migrator) => ({
  database: TARGET.database,
  user: role,
  sessionUser: role,
  marker: DATABASE_MARKER,
  databaseOwner: TARGET.migrator,
  recovery: false,
  server: '172.18.0.2',
  serverPort: 5432,
  postmaster: 'synthetic-server',
  version: 170000,
  dangerous: [],
  memberships: role === TARGET.migrator ? ['pg_database_owner'] : [],
  databases: [TARGET.database, 'postgres', 'template0', 'template1'],
  otherConnections: [],
});
const fresh = () => ({
  identity: identity(),
  userSchemas: ['public'],
  schemaOwner: 'pg_database_owner',
  objects: [],
});

// Independent evidence: literal matrix reviewed against the hashed SQL, never obtained from SCHEMA.
const ENUM_COLUMNS = [
  ['organizations', 'status', 'OrganizationStatus', 'ACTIVE'],
  ['users', 'status', 'UserStatus', 'ACTIVE'],
  ['memberships', 'role', 'MembershipRole', null],
  ['memberships', 'status', 'MembershipStatus', 'ACTIVE'],
  ['beds', 'operational_status', 'BedOperationalStatus', 'IN_SERVICE'],
  ['residents', 'document_verification_status', 'DocumentVerificationStatus', 'PENDING'],
  ['residents', 'status', 'ResidentStatus', 'ACTIVE'],
  ['enquiries', 'source', 'EnquirySource', 'OTHER'],
  ['enquiries', 'status', 'EnquiryStatus', 'NEW'],
  ['bookings', 'status', 'BookingStatus', 'CONFIRMED'],
  ['bookings', 'payment_status', 'PaymentStatus', 'PENDING'],
  ['admissions', 'status', 'AdmissionStatus', 'PENDING'],
  ['check_ins', 'status', 'CheckInStatus', 'ACTIVE'],
  ['invoices', 'status', 'InvoiceStatus', 'DRAFT'],
  ['payments', 'method', 'PaymentMethod', null],
  ['invoice_voids', 'previous_status', 'InvoiceStatus', null],
];
const enumColumn = (type, label) => ({
  type: `"${type}"`,
  nullable: false,
  default: label === null ? null : `'${label}'::"${type}"`,
});

// Build the mock PostgreSQL catalog from independently hashed migration SQL, not the verifier's
// expected constant. This deliberately small fixture reader supports only this reviewed history.
function migrationCatalog() {
  const c = { tables: {}, enums: {}, constraints: {}, indexes: {}, functions: {}, triggers: {} };
  const names = (sql) => [...sql.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  function column(type, tail) {
    const value = {
      type: type.startsWith('"')
        ? type
        : type.toLowerCase().replace('decimal', 'numeric').replace('timestamptz', 'timestamp') +
          (type.startsWith('TIMESTAMPTZ') ? ' with time zone' : ''),
      nullable: !tail.includes('NOT NULL'),
    };
    if (type.startsWith('"')) {
      const label = /DEFAULT\s+'([^']*)'/.exec(tail)?.[1];
      value.default = label === undefined ? null : `'${label}'::${type}`;
    }
    return value;
  }
  for (const migration of expected) {
    const bytes = readFileSync(
      new URL(`../../prisma/migrations/${migration.name}/migration.sql`, import.meta.url),
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), migration.checksum);
    const sql = bytes.toString('utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/CREATE TYPE "([^"]+)" AS ENUM\s*\(([^;]+)\)/g))
      c.enums[m[1]] = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    for (const m of sql.matchAll(/ALTER TYPE "([^"]+)" ADD VALUE '([^']+)'/g))
      c.enums[m[1]].push(m[2]);
    for (const m of sql.matchAll(/CREATE TABLE "([^"]+)"\s*\(([\s\S]*?)^\);/gm)) {
      c.tables[m[1]] = {};
      for (const x of m[2].matchAll(
        /^\s*"([^"]+)"\s+("[^"]+"|[A-Z]+(?:\(\d+(?:,\d+)?\))?)([^\n]*)/gm,
      ))
        c.tables[m[1]][x[1]] = column(x[2], x[3]);
      for (const x of m[2].matchAll(/CONSTRAINT "([^"]+)" PRIMARY KEY\s*\(([^)]+)\)/g))
        c.constraints[x[1]] = { table: m[1], type: 'p', definition: `PRIMARY KEY (${x[2]})` };
    }
    for (const m of sql.matchAll(/ALTER TABLE "([^"]+)"\s+((?:ADD COLUMN)[\s\S]*?);/g)) {
      for (const x of m[2].matchAll(
        /ADD COLUMN\s+"([^"]+)"\s+("[^"]+"|[A-Z]+(?:\(\d+(?:,\d+)?\))?)([^,;\n]*)/g,
      ))
        c.tables[m[1]][x[1]] = column(x[2], x[3]);
    }
    for (const m of sql.matchAll(/ALTER TABLE "([^"]+)"\s+ADD CONSTRAINT "([^"]+)"\s+([^;]+);/g))
      c.constraints[m[2]] = {
        table: m[1],
        type: m[3].startsWith('CHECK') ? 'c' : 'f',
        definition: m[3].trim(),
      };
    for (const m of sql.matchAll(/ALTER TABLE "[^"]+" DROP CONSTRAINT "([^"]+)"/g))
      delete c.constraints[m[1]];
    for (const m of sql.matchAll(
      /CREATE (UNIQUE )?INDEX "([^"]+)"\s+ON "([^"]+)"\s*\(([^)]+)\)(?:\s+WHERE\s+([^;]+))?;/g,
    )) {
      if (m[5])
        c.indexes[m[2]] = {
          table: m[3],
          unique: Boolean(m[1]),
          columns: names(m[4]),
          predicate: m[5].trim(),
        };
    }
    for (const m of sql.matchAll(/DROP INDEX "([^"]+)"/g)) delete c.indexes[m[1]];
    for (const m of sql.matchAll(
      /CREATE (?:OR REPLACE )?FUNCTION "([^"]+)"\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/g,
    ))
      c.functions[m[1]] = m[2].trim();
    for (const m of sql.matchAll(
      /CREATE TRIGGER "([^"]+)" (BEFORE|AFTER) ([\s\S]*?) ON "([^"]+)"\s+FOR EACH ROW EXECUTE FUNCTION "([^"]+)"\(\);/g,
    )) {
      c.triggers[m[1]] = {
        table: m[4],
        function: m[5],
        type:
          1 +
          (m[2] === 'BEFORE' ? 2 : 0) +
          (m[3].includes('INSERT') ? 4 : 0) +
          (m[3].includes('DELETE') ? 8 : 0) +
          (m[3].includes('UPDATE') ? 16 : 0),
        columns: names(m[3]),
      };
    }
  }
  return c;
}

function schema() {
  const c = migrationCatalog();
  return {
    tables: {
      ...Object.fromEntries(
        Object.entries(c.tables).map(([name, columns]) => [
          name,
          { owner: TARGET.migrator, kind: 'r', columns },
        ]),
      ),
      _prisma_migrations: { owner: TARGET.migrator, kind: 'r' },
    },
    enums: c.enums,
    constraints: Object.fromEntries(
      Object.entries(c.constraints).map(([n, x]) => [
        n,
        { ...x, validated: true, deferrable: false, deferred: false },
      ]),
    ),
    indexes: Object.fromEntries(
      Object.entries(c.indexes).map(([n, x]) => [n, { ...x, valid: true, ready: true }]),
    ),
    functions: Object.fromEntries(
      Object.entries(c.functions).map(([n, body]) => [
        n,
        {
          body,
          owner: TARGET.migrator,
          language: 'plpgsql',
          result: 'trigger',
          arguments: 0,
          securityDefiner: false,
          config: null,
          volatility: 'v',
          parallel: 'u',
          leakproof: false,
          strict: false,
        },
      ]),
    ),
    triggers: Object.fromEntries(
      Object.entries(c.triggers).map(([n, x]) => [
        n,
        { ...x, enabled: 'O', when: null, arguments: 0 },
      ]),
    ),
    userSchemas: ['public'],
    schemaOwner: 'pg_database_owner',
    foreignOwnedObjects: 0,
    unexpectedObjects: 0,
  };
}
const privileges = (role = TARGET.verifier) => ({
  role,
  ownsObjects: 0,
  createSchema: false,
  createDatabase: false,
  tempDatabase: false,
  tablePrivileges: role === TARGET.verifier ? { _prisma_migrations: ['SELECT'] } : {},
});
test('fresh dedicated migrator identity is accepted', () => verifyFreshFacts(fresh()));
for (const [name, mutate] of [
  ['protected database', (f) => (f.identity.database = 'nook_dev')],
  ['wrong identity', (f) => (f.identity.user = TARGET.runtime)],
  ['SET ROLE', (f) => (f.identity.sessionUser = 'other')],
  ['marker', (f) => (f.identity.marker = 'wrong')],
  ['owner', (f) => (f.identity.databaseOwner = 'other')],
  ['replica', (f) => (f.identity.recovery = true)],
  ['version', (f) => (f.identity.version = 160000)],
  ['missing server', (f) => (f.identity.server = null)],
  ['wrong server port', (f) => (f.identity.serverPort = 5545)],
  ['superuser', (f) => (f.identity.dangerous = ['superuser'])],
  ['membership', (f) => f.identity.memberships.push('pg_read_all_data')],
  ['protected cluster', (f) => f.identity.databases.push('nook_test')],
  ['other connection', (f) => (f.identity.otherConnections = ['postgres'])],
  ['ledger exists', (f) => (f.objects = ['relation:_prisma_migrations'])],
  ['nonempty schema', (f) => (f.objects = ['relation:users'])],
  ['function exists', (f) => (f.objects = ['function:unexpected'])],
  ['unexpected schema', (f) => f.userSchemas.push('other')],
])
  test(`reject fresh preflight: ${name}`, () => {
    const f = fresh();
    mutate(f);
    assert.throws(() => verifyFreshFacts(f));
  });
test('independent migration-derived catalog passes exact structural comparison', () =>
  verifySchemaFacts(schema()));
for (const [name, mutate] of [
  ['missing table', (f) => delete f.tables.users],
  ['extra table', (f) => (f.tables.unexpected = f.tables.users)],
  ['table owner', (f) => (f.tables.users.owner = TARGET.runtime)],
  ['missing column', (f) => delete f.tables.payments.columns.balance_after_payment],
  ['column type', (f) => (f.tables.payments.columns.amount.type = 'text')],
  ['enum label', (f) => f.enums.InvoiceStatus.pop()],
  ['missing tenant FK', (f) => delete f.constraints.bookings_resident_id_organization_id_fkey],
  [
    'FK target',
    (f) =>
      (f.constraints.bookings_resident_id_organization_id_fkey.definition =
        'FOREIGN KEY (resident_id) REFERENCES users(id)'),
  ],
  ['missing check', (f) => delete f.constraints.invoices_amount_positive],
  [
    'changed check',
    (f) => (f.constraints.invoices_amount_positive.definition = 'CHECK (amount >= 0)'),
  ],
  ['unvalidated check', (f) => (f.constraints.invoices_amount_positive.validated = false)],
  [
    'wrong predicate',
    (f) =>
      (f.indexes.invoices_active_booking_period_key.predicate =
        "status = 'CANCELLED' AND booking_id IS NOT NULL"),
  ],
  ['missing partial index', (f) => delete f.indexes.invoices_active_booking_period_key],
  ['invalid index', (f) => (f.indexes.invoices_active_booking_period_key.valid = false)],
  ['changed function', (f) => (f.functions.finance_guard_invoice.body = 'BEGIN RETURN NEW; END;')],
  ['security definer', (f) => (f.functions.finance_guard_invoice.securityDefiner = true)],
  ['missing trigger', (f) => delete f.triggers.payments_snapshot],
  ['disabled trigger', (f) => (f.triggers.payments_snapshot.enabled = 'D')],
  ['foreign object owner', (f) => (f.foreignOwnedObjects = 1)],
])
  test(`reject schema: ${name}`, () => {
    const f = schema();
    mutate(f);
    assert.throws(() => verifySchemaFacts(f));
  });
test('PostgreSQL deparser casts/ANY compare to reviewed IN expressions', () => {
  assert.deepEqual(
    expression("status IN ('ISSUED', 'PAID')"),
    expression(`((status = ANY (ARRAY['ISSUED'::"InvoiceStatus", 'PAID'::"InvoiceStatus"])))`),
  );
  assert.notDeepEqual(expression('a AND (b OR c)'), expression('(a AND b) OR c'));
  assert.throws(() => expression('a::unknown_type = 1'));
});
for (const [name, mutate] of [
  [
    'runtime ledger SELECT',
    (f) => {
      f.role = TARGET.runtime;
    },
  ],
  ['verifier mutation', (f) => f.tablePrivileges._prisma_migrations.push('UPDATE')],
  ['DDL', (f) => (f.createSchema = true)],
  ['database CREATE', (f) => (f.createDatabase = true)],
  ['TEMP', (f) => (f.tempDatabase = true)],
  ['ownership', (f) => (f.ownsObjects = 1)],
])
  test(`reject privileges: ${name}`, () => {
    const f = privileges();
    mutate(f);
    assert.throws(() => verifyPrivileges(f, f.role, 'before'));
  });
function runtimePrivileges() {
  const f = privileges(TARGET.runtime);
  f.tablePrivileges = Object.fromEntries(
    Object.keys(SCHEMA.tables).map((t) => [
      t,
      t === 'audit_events' ? ['INSERT', 'SELECT'] : ['INSERT', 'SELECT', 'UPDATE'],
    ]),
  );
  f.tablePrivileges.invoice_voids = ['INSERT', 'SELECT'];
  return f;
}
test('runtime gets exactly application CRUD subset and append-only audit and void history', () => {
  const f = runtimePrivileges();
  verifyPrivileges(f, TARGET.runtime);
  f.tablePrivileges.audit_events.push('UPDATE');
  assert.throws(() => verifyPrivileges(f, TARGET.runtime));
});
for (const privilege of ['UPDATE', 'DELETE'])
  test(`runtime invoice_voids rejects ${privilege}`, () => {
    const f = runtimePrivileges();
    f.tablePrivileges.invoice_voids.push(privilege);
    assert.throws(() => verifyPrivileges(f, TARGET.runtime));
  });
for (const privilege of ['SELECT', 'INSERT'])
  test(`runtime invoice_voids requires ${privilege}`, () => {
    const f = runtimePrivileges();
    f.tablePrivileges.invoice_voids = f.tablePrivileges.invoice_voids.filter(
      (p) => p !== privilege,
    );
    assert.throws(() => verifyPrivileges(f, TARGET.runtime));
  });
function ledgerAdapter({ missing = false, fail = false, badSchema = false, mutate = false } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (fail && calls.length === 2) throw new Error('synthetic query failure');
      if (sql.startsWith('SELECT current_database')) return { rows: [identity(TARGET.verifier)] };
      if (sql.includes('AS "ownsObjects"'))
        return {
          rows: [
            { ownsObjects: 0, createSchema: false, createDatabase: false, tempDatabase: false },
          ],
        };
      if (sql.includes('array_agg(p.priv'))
        return {
          rows: [
            { name: '_prisma_migrations', privileges: mutate ? ['SELECT', 'UPDATE'] : ['SELECT'] },
          ],
        };
      if (sql.includes('c.relname AS name,c.relkind'))
        return {
          rows: missing
            ? []
            : [{ schema: 'public', name: '_prisma_migrations', kind: 'r', owner: TARGET.migrator }],
        };
      if (sql.includes('information_schema.columns'))
        return {
          rows: Object.entries(LEDGER_COLUMNS).map(([name, [type, length, nullable]]) => ({
            name,
            type: badSchema ? 'text' : type,
            length,
            nullable,
            default: name === 'started_at' ? 'now()' : name === 'applied_steps_count' ? '0' : null,
          })),
        };
      if (sql.includes('pg_constraint')) return { rows: [{ name: 'id' }] };
      if (sql.includes('extract(epoch'))
        return {
          rows: expected.map((m, i) => ({
            id: String(i),
            migration_name: m.name,
            checksum: m.checksum,
            logs: null,
            started_at: String(i * 10),
            finished_at: String(i * 10 + 1),
            rolled_back_at: null,
            applied_steps_count: 1,
          })),
        };
      return { rows: [] };
    },
  };
}
test('restricted ledger adapter uses read-only transaction and rolls back after success', async () => {
  const db = ledgerAdapter();
  await readLedger(db, expected);
  assert.equal(db.calls[0], 'BEGIN READ ONLY');
  assert.equal(db.calls.at(-1), 'ROLLBACK');
});
for (const opts of [{ missing: true }, { fail: true }, { badSchema: true }, { mutate: true }])
  test(`ledger query/catalog failure closes transaction ${JSON.stringify(opts)}`, async () => {
    const db = ledgerAdapter(opts);
    await assert.rejects(readLedger(db, expected));
    assert.equal(db.calls.at(-1), 'ROLLBACK');
  });
test('catalog adapters refuse incomplete identity/schema data', async () => {
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(readIdentity(db));
  await assert.rejects(readFreshFacts(db));
  await assert.rejects(readSchema(db));
});

test('PostgreSQL BETWEEN expansion and FK action order preserve semantics', () => {
  assert.deepEqual(
    expression('length(btrim(reason)) BETWEEN 3 AND 500'),
    expression('((length(btrim(reason)) >= 3) AND (length(btrim(reason)) <= 500))'),
  );
  const f = schema();
  for (const c of Object.values(f.constraints))
    if (c.type === 'f')
      c.definition = c.definition.replace(
        /ON DELETE (RESTRICT|CASCADE|SET NULL) ON UPDATE RESTRICT/,
        'ON UPDATE RESTRICT ON DELETE $1',
      );
  verifySchemaFacts(f);
});

test('all three isolated identities obey ownership and membership separation', () => {
  for (const role of [TARGET.migrator, TARGET.runtime, TARGET.verifier])
    verifyIdentityFacts(identity(role), role);
});

test('PostgreSQL constant array deparse preserves IN semantics', () => {
  assert.deepEqual(
    expression("status IN ('DRAFT','CANCELLED')"),
    expression(`status = ANY ('{DRAFT,CANCELLED}'::"InvoiceStatus"[])`),
  );
});
test('unexpected user relations or domains fail schema acceptance', () => {
  const f = schema();
  f.unexpectedObjects = 1;
  assert.throws(() => verifySchemaFacts(f));
});

test('literal enum matrix agrees with every enum column declared by approved migration SQL', () => {
  const catalog = migrationCatalog();
  const actual = Object.entries(catalog.tables)
    .flatMap(([table, cols]) =>
      Object.entries(cols)
        .filter(([, value]) => value.type.startsWith('"'))
        .map(([column]) => `${table}.${column}`),
    )
    .sort();
  assert.deepEqual(actual, ENUM_COLUMNS.map(([table, column]) => `${table}.${column}`).sort());
  for (const [table, column, type, label] of ENUM_COLUMNS)
    assert.deepEqual(catalog.tables[table][column], enumColumn(type, label));
});
for (const [table, column, type, label] of ENUM_COLUMNS) {
  test(`reviewed enum contract includes ${table}.${column}: ${type}`, () => {
    assert.deepEqual(SCHEMA.tables[table][column], enumColumn(type, label));
  });
  test(`missing enum column rejected: ${table}.${column}`, () => {
    const f = schema();
    delete f.tables[table].columns[column];
    assert.throws(() => verifySchemaFacts(f));
  });
  test(`wrong enum identity rejected: ${table}.${column}`, () => {
    const f = schema();
    f.tables[table].columns[column].type = 'text';
    assert.throws(() => verifySchemaFacts(f));
  });
  test(`enum nullability mismatch rejected: ${table}.${column}`, () => {
    const f = schema();
    f.tables[table].columns[column].nullable = true;
    assert.throws(() => verifySchemaFacts(f));
  });
  test(`enum default mismatch rejected: ${table}.${column}`, () => {
    const f = schema();
    f.tables[table].columns[column].default = label === null ? `'${type}'::text` : null;
    assert.throws(() => verifySchemaFacts(f));
  });
}
test('unexpected enum column is rejected', () => {
  const f = schema();
  f.tables.organizations.columns.unexpected_status = enumColumn('OrganizationStatus', 'ACTIVE');
  assert.throws(() => verifySchemaFacts(f));
});

test('a changed enum default value or cast is rejected', () => {
  for (const value of ['\'DISABLED\'::"OrganizationStatus"', "'ACTIVE'::text"]) {
    const f = schema();
    f.tables.organizations.columns.status.default = value;
    assert.throws(() => verifySchemaFacts(f));
  }
});
