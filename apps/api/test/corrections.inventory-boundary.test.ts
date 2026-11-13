import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Inventory boundary (specification v1.3 section 10.5). Bed, room, floor and property writers (archive, out-of-service,
 * relocation) historically did not take the organization gate. Availability-changing archive/status writers now join it.
 * Correction validators still do not read inventory state: a
 * validator that reads it requires an audited scope change. This test fails if a correction source file starts to read
 * inventory state. If a future validator genuinely needs it, the inventory mutation must first join the gate protocol
 * and this allowlist must be changed in the same reviewed change.
 */
const SRC = new URL('../src/', import.meta.url).pathname;
const CORRECTION_DIR = join(SRC, 'corrections');
const files = readdirSync(CORRECTION_DIR)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(CORRECTION_DIR, name), 'utf8') }));

const INVENTORY_TABLES = ['beds', 'rooms', 'floors', 'properties'];
const INVENTORY_MODELS = ['bed', 'room', 'floor', 'property'];
const READABLE_TABLES = new Set([
  'residents',
  'bookings',
  'admissions',
  'check_ins',
  'check_outs',
  'invoices',
  'payments',
  'invoice_adjustments',
  'invoice_voids',
  'payment_reversals',
  'correction_proposals',
  'correction_command_receipts',
  'correction_finance_links',
  'stay_assignments',
  'effective_stay_assignments',
  'memberships',
  'audit_events',
]);
// Imports from outside the corrections module, and the only symbols each may bring in.
const ALLOWED_EXTERNAL = new Map<string, string[]>([
  ['../booking/booking.rules.js', ['findOverlappingBooking']],
  ['../booking/booking.input.js', ['periodContains']],
]);

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the correction module reads only the audited set of tables', () => {
  for (const { name, text } of files) {
    const code = stripComments(text);
    for (const match of code.matchAll(/\b(?:FROM|JOIN|UPDATE|INSERT INTO)\s+"?([a-z_]+)"?/g)) {
      const table = match[1]!;
      if (table === 'set' || table === 'select') continue;
      assert.ok(
        !INVENTORY_TABLES.includes(table),
        `${name} reads inventory table ${table}; see the inventory boundary note`,
      );
      assert.ok(READABLE_TABLES.has(table), `${name} reads unaudited table ${table}`);
    }
  }
});

test('the correction module never uses an inventory Prisma model or inventory state', () => {
  for (const { name, text } of files) {
    const code = stripComments(text);
    for (const model of INVENTORY_MODELS) {
      assert.doesNotMatch(code, new RegExp(`\\btx\\.${model}\\.`), `${name} uses tx.${model}`);
      assert.doesNotMatch(
        code,
        new RegExp(`\\.${model}\\.(find|count|aggregate)`),
        `${name} reads ${model}`,
      );
    }
    assert.doesNotMatch(
      code,
      /operational_status|operationalStatus|archived_at|archivedAt|OUT_OF_SERVICE|BookableBedFacts|bedBookability/,
      `${name} reads bed, room, floor or property state`,
    );
  }
});

test('the only bed access is the row lock keyed by the booking bed id, never a state read', () => {
  const uses = files.flatMap(({ name, text }) =>
    [...stripComments(text).matchAll(/'beds'/g)].map(() => name),
  );
  assert.deepEqual(
    uses.sort(),
    ['corrections.facts.ts', 'corrections.facts.ts'],
    'only the LockTable union and the one lockRow call may name beds',
  );
  const facts = stripComments(files.find((f) => f.name === 'corrections.facts.ts')!.text);
  assert.match(facts, /lockRow\(tx, organizationId, 'beds', probe\.bedId\)/);
});

test('imports from other modules are limited to audited booking helpers that read no inventory state', () => {
  for (const { name, text } of files) {
    for (const match of text.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(\.\.\/[^']+)'/g,
    )) {
      const path = match[2]!;
      const symbols = match[1]!
        .split(',')
        .map(
          (s) =>
            s
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0]!,
        )
        .filter(Boolean);
      if (path.startsWith('../generated/') || path.startsWith('../common/')) continue;
      if (path.startsWith('../database/') || path.startsWith('../observability/')) continue;
      if (path.startsWith('../auth/') || path.startsWith('../finance/')) continue;
      const allowed = ALLOWED_EXTERNAL.get(path);
      assert.ok(allowed, `${name} imports from unaudited module ${path}`);
      for (const symbol of symbols)
        assert.ok(allowed.includes(symbol), `${name} imports unaudited ${symbol} from ${path}`);
    }
  }
  // The one imported helper that touches the database reads bookings only.
  const rules = readFileSync(join(SRC, 'booking/booking.rules.ts'), 'utf8');
  const start = rules.indexOf('export async function findOverlappingBooking');
  const end = rules.indexOf('\nexport ', start + 10);
  const body = rules.slice(start, end);
  assert.match(body, /FROM bookings/);
  for (const table of INVENTORY_TABLES)
    assert.doesNotMatch(body, new RegExp(`\\b(FROM|JOIN)\\s+${table}\\b`));
});

/** The scanners must actually fire: feed them the exact regressions this guard exists to prevent. */
const tableReads = (code: string) =>
  [...stripComments(code).matchAll(/\b(?:FROM|JOIN|UPDATE|INSERT INTO)\s+"?([a-z_]+)"?/g)].map(
    (m) => m[1]!,
  );
const stateReads = (code: string) =>
  /operational_status|operationalStatus|archived_at|archivedAt|OUT_OF_SERVICE|BookableBedFacts|\btx\.(bed|room|floor|property)\./.test(
    stripComments(code),
  );
test('the guard detects a validator that starts reading inventory state', () => {
  assert.ok(tableReads('SELECT 1 FROM beds b WHERE b.id = $1').includes('beds'));
  assert.ok(tableReads('JOIN rooms r ON r.id = b.room_id').includes('rooms'));
  assert.ok(tableReads('FROM "properties" p').includes('properties'));
  assert.ok(stateReads('const bed = await tx.bed.findFirst({ where })'));
  assert.ok(stateReads('if (bed.operationalStatus === "OUT_OF_SERVICE") conflict()'));
  assert.ok(stateReads('WHERE b.archived_at IS NULL'));
  assert.ok(!stateReads('// archived_at is mentioned only in a comment'));
  assert.deepEqual(tableReads('FROM bookings JOIN check_ins'), ['bookings', 'check_ins']);
});
