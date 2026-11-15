-- Read-only verification of the privilege matrix. Expected result: ZERO rows from the final SELECT.
-- Every returned row is a violation (a privilege that should not exist, or one that is missing).
WITH append_only(t) AS (
  VALUES ('transfers'), ('transfer_command_receipts'), ('stay_assignment_replacements'), ('transfer_finance_reviews'),
         ('transfer_finance_resolutions'), ('audit_events'), ('invoice_voids'), ('correction_command_receipts'),
         ('correction_finance_links'), ('payments'), ('payment_reversals'), ('invoice_adjustments'),
         ('payment_idempotency_keys')
),
rel AS (
  SELECT c.relname AS name, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND c.relname <> '_prisma_migrations'
),
privs(p) AS (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')),
expected AS (
  SELECT r.name, p.p, ro.role,
    CASE
      WHEN ro.role = 'nook_backup' THEN p.p = 'SELECT'
      WHEN r.relkind = 'v' THEN p.p = 'SELECT'
      WHEN r.name IN (SELECT t FROM append_only) THEN p.p IN ('SELECT', 'INSERT')
      ELSE p.p IN ('SELECT', 'INSERT', 'UPDATE')
    END AS should_have
  FROM rel r CROSS JOIN privs p CROSS JOIN (VALUES ('nook_app'), ('nook_backup')) ro(role)
),
table_violations AS (
  SELECT format('table %s: %s %s %s', name, role, CASE WHEN should_have THEN 'MISSING' ELSE 'UNEXPECTED' END, p) AS problem
  FROM expected WHERE has_table_privilege(role, format('public.%I', name), p) IS DISTINCT FROM should_have
),
attr_violations AS (
  SELECT format('role %s has attribute %s', rolname, a) AS problem
  FROM pg_roles, LATERAL (VALUES ('superuser', rolsuper), ('createdb', rolcreatedb), ('createrole', rolcreaterole),
                                 ('replication', rolreplication), ('bypassrls', rolbypassrls)) x(a, v)
  WHERE rolname IN ('nook_app', 'nook_backup', 'nook_migrator') AND v
),
owner_violations AS (
  SELECT format('%s owns relation %s', pg_get_userbyid(c.relowner), c.relname) AS problem
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) IN ('nook_app', 'nook_backup')
),
migrator_owner AS (
  SELECT format('relation %s is owned by %s, expected nook_migrator', c.relname, pg_get_userbyid(c.relowner)) AS problem
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND pg_get_userbyid(c.relowner) <> 'nook_migrator'
),
misc AS (
  SELECT 'nook_app can CREATE in schema public' AS problem WHERE has_schema_privilege('nook_app', 'public', 'CREATE')
  UNION ALL SELECT 'nook_backup can CREATE in schema public' WHERE has_schema_privilege('nook_backup', 'public', 'CREATE')
  UNION ALL SELECT 'PUBLIC can connect to this database' WHERE has_database_privilege('public', current_database(), 'CONNECT')
  UNION ALL SELECT 'nook_app cannot CONNECT' WHERE NOT has_database_privilege('nook_app', current_database(), 'CONNECT')
  UNION ALL SELECT 'nook_app can CREATE in database' WHERE has_database_privilege('nook_app', current_database(), 'CREATE')
  UNION ALL SELECT 'nook_app can use _prisma_migrations' WHERE has_table_privilege('nook_app', 'public._prisma_migrations', 'SELECT')
  UNION ALL SELECT 'nook_backup cannot read _prisma_migrations (a dump would fail)' WHERE NOT has_table_privilege('nook_backup', 'public._prisma_migrations', 'SELECT')
  UNION ALL SELECT format('nook_backup has %s on _prisma_migrations', p) FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p WHERE has_table_privilege('nook_backup', 'public._prisma_migrations', p)
  UNION ALL SELECT format('%s is a member of %s', r.rolname, m.rolname) FROM pg_auth_members a
    JOIN pg_roles r ON r.oid = a.member JOIN pg_roles m ON m.oid = a.roleid
    WHERE r.rolname IN ('nook_app', 'nook_backup', 'nook_migrator') AND m.rolname !~ '^pg_database_owner$'
  UNION ALL SELECT format('sequence %s: nook_app lacks USAGE', c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND NOT has_sequence_privilege('nook_app', format('public.%I', c.relname), 'USAGE')
)
SELECT problem FROM table_violations
UNION ALL SELECT problem FROM attr_violations
UNION ALL SELECT problem FROM owner_violations
UNION ALL SELECT problem FROM migrator_owner
UNION ALL SELECT problem FROM misc
ORDER BY 1;
