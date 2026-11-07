-- Restore verification fingerprint. READ ONLY: catalog queries, counts, hashes and invariant counts; it changes nothing
-- and contains no personal data (only names, counts and hashes). It is run against the SOURCE database and against the
-- RESTORED database with the same settings, and the two outputs are compared line by line by restore-drill.sh.
--
-- Output: one line per fact, "section|key|value", sorted by the caller. Run as:
--   PGOPTIONS='-c default_transaction_read_only=on -c TimeZone=UTC' \
--     psql -X -q -At -F'|' -v ON_ERROR_STOP=1 [-v runtime_role=<role>] -f restore-verify.sql
--
-- Sections (compared as equal source == restored unless marked INFO):
--   ext, table, column, index, constraint, trigger, function, enum, rows, hash   structure and content
--   owner, acl, runtime_priv                                                       permissions (only meaningful if restored with ACLs)
--   ledger                                                                         finance invariants (count of violations; INFO + equality)
--   total                                                                          money totals

-- ------------------------------------------------------------------ structure
SELECT 'ext', extname, extversion FROM pg_extension;

SELECT 'table', c.relname, c.relkind::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

SELECT 'column', c.relname,
       md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' ||
                      coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum))
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
 WHERE c.relkind IN ('r', 'p')
 GROUP BY c.relname;

SELECT 'index', indexname, md5(indexdef) FROM pg_indexes WHERE schemaname = 'public';

SELECT 'constraint', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  FROM pg_constraint
 WHERE connamespace = 'public'::regnamespace;

SELECT 'trigger', tgrelid::regclass::text || '.' || tgname, md5(pg_get_triggerdef(oid))
  FROM pg_trigger
 WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace);

SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(p.prosrc)
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace;

SELECT 'enum', t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
 WHERE t.typnamespace = 'public'::regnamespace
 GROUP BY t.typname;

-- ------------------------------------------------------------------ content: exact row counts and content hashes
SELECT 'rows', c.relname,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p');

-- A hash of every row of every table that has an "id" column (rows ordered by id, rendered as text in UTC).
SELECT 'hash', c.relname,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT md5(coalesce(string_agg(t::text, ''|'' ORDER BY t.id::text), '''')) AS c FROM public.%I t', c.relname),
          false, true, '')))[1]::text
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped);

-- ------------------------------------------------------------------ permissions
SELECT 'owner', c.relname, pg_get_userbyid(c.relowner)
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p');

SELECT 'acl', c.relname, md5(coalesce(c.relacl::text, ''))
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p');

-- What the application's runtime role may do on the sensitive tables (only when -v runtime_role=... is given).
\if :{?runtime_role}
SELECT 'runtime_priv', t.relname || '.' || p.priv,
       CASE WHEN has_table_privilege(:'runtime_role', format('public.%I', t.relname), p.priv) THEN 'yes' ELSE 'no' END
  FROM (VALUES ('audit_events'), ('payments'), ('payment_reversals'), ('invoice_adjustments'), ('invoice_voids'),
               ('invoices'), ('residents'), ('bookings'), ('sessions')) AS t(relname)
  JOIN pg_class c ON c.relname = t.relname AND c.relnamespace = 'public'::regnamespace
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv);
\endif

-- ------------------------------------------------------------------ ledger consistency (violation counts)
-- Each line is the NUMBER of rows that break a rule. A healthy production database reports 0 everywhere except
-- ledger|cancelled_without_void, which counts legacy cancelled invoices that predate void records. In a test fixture
-- database these may be non-zero; the drill requires restored == source, and reports the absolute numbers.
WITH live_payments AS (
  SELECT p.invoice_id, sum(p.amount) AS cash
    FROM payments p
   WHERE NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)
   GROUP BY p.invoice_id
), adjustments AS (
  SELECT invoice_id, sum(amount) AS total FROM invoice_adjustments GROUP BY invoice_id
)
SELECT 'ledger', k, v FROM (
  SELECT 'paid_amount_drift' AS k, count(*)::text AS v
    FROM invoices i LEFT JOIN live_payments lp ON lp.invoice_id = i.id
   WHERE i.paid_amount <> coalesce(lp.cash, 0) - i.adjustment_total
  UNION ALL
  SELECT 'adjustment_total_drift', count(*)::text
    FROM invoices i LEFT JOIN adjustments a ON a.invoice_id = i.id
   WHERE i.adjustment_total <> coalesce(a.total, 0)
  UNION ALL
  SELECT 'status_contradicts_amounts', count(*)::text FROM invoices
   WHERE status NOT IN ('DRAFT', 'CANCELLED') AND NOT (
         (status = 'PAID' AND paid_amount = amount)
      OR (status = 'PARTIALLY_PAID' AND paid_amount < amount AND paid_amount + adjustment_total > 0)
      OR (status = 'ISSUED' AND paid_amount < amount AND paid_amount + adjustment_total <= 0)
      OR (status = 'OVERDUE' AND paid_amount < amount))
  UNION ALL
  SELECT 'negative_cash', count(*)::text FROM invoices WHERE paid_amount + adjustment_total < 0
  UNION ALL
  SELECT 'paid_exceeds_amount', count(*)::text FROM invoices WHERE paid_amount > amount
  UNION ALL
  SELECT 'partially_paid_without_live_payment', count(*)::text FROM invoices i
   WHERE i.status = 'PARTIALLY_PAID' AND NOT EXISTS (SELECT 1 FROM live_payments lp WHERE lp.invoice_id = i.id)
  UNION ALL
  -- only LIVE payments count: voiding requires every payment to be reversed first, so reversed payments legitimately
  -- remain on a voided invoice as history
  SELECT 'payments_on_draft_or_cancelled', count(*)::text FROM payments p JOIN invoices i ON i.id = p.invoice_id
   WHERE i.status IN ('DRAFT', 'CANCELLED')
     AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)
  UNION ALL
  SELECT 'draft_with_money', count(*)::text FROM invoices WHERE status = 'DRAFT' AND (paid_amount <> 0 OR adjustment_total <> 0)
  UNION ALL
  SELECT 'cancelled_with_money', count(*)::text FROM invoices WHERE status = 'CANCELLED' AND (paid_amount <> 0 OR adjustment_total <> 0)
  UNION ALL
  SELECT 'cancelled_without_void', count(*)::text FROM invoices i
   WHERE i.status = 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM invoice_voids v WHERE v.invoice_id = i.id)
  UNION ALL
  SELECT 'duplicate_invoice_numbers', count(*)::text FROM (
    SELECT organization_id, number FROM invoices GROUP BY 1, 2 HAVING count(*) > 1) d
  UNION ALL
  SELECT 'reversals_without_payment', count(*)::text FROM payment_reversals r
   WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = r.payment_id)
) x;

-- ------------------------------------------------------------------ money totals
SELECT 'total', 'invoices_non_draft_amount', coalesce(sum(amount), 0)::text FROM invoices WHERE status NOT IN ('DRAFT', 'CANCELLED');
SELECT 'total', 'invoices_paid_amount', coalesce(sum(paid_amount), 0)::text FROM invoices WHERE status NOT IN ('DRAFT', 'CANCELLED');
SELECT 'total', 'invoices_adjustment_total', coalesce(sum(adjustment_total), 0)::text FROM invoices;
SELECT 'total', 'payments_amount', coalesce(sum(amount), 0)::text FROM payments;
SELECT 'total', 'reversed_payments_amount', coalesce(sum(p.amount), 0)::text
  FROM payments p WHERE EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id);
SELECT 'total', 'per_organization_digest',
       md5(coalesce(string_agg(organization_id::text || ':' || s::text || ':' || c::text || ':' || a::text, '|' ORDER BY organization_id::text), ''))
  FROM (SELECT organization_id, sum(amount) s, sum(paid_amount) c, sum(adjustment_total) a
          FROM invoices WHERE status NOT IN ('DRAFT', 'CANCELLED') GROUP BY organization_id) t;
SELECT 'total', 'audit_events', count(*)::text FROM audit_events;
-- Prisma's migration table exists wherever `prisma migrate deploy` was used (always, in production). A database built
-- some other way (a scratch database) simply reports it as absent, identically for source and restored.
SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS has_migrations \gset
\if :has_migrations
SELECT 'total', 'migrations_applied', count(*)::text FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SELECT 'total', 'migrations_unfinished', count(*)::text FROM _prisma_migrations WHERE finished_at IS NULL;
SELECT 'total', 'latest_migration', coalesce(max(migration_name), '') FROM _prisma_migrations;
\else
SELECT 'total', 'migrations_table', 'absent';
\endif
