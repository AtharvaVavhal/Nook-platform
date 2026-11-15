-- restore-acl-verification.sql — OWNER/ACL verification against the CI-TESTED matrix (read-only).
--
-- STATUS: VALIDATED 2026-11-13 on a disposable local PostgreSQL 17.11 (container with NO network, no credentials), provisioned like CI
-- (24 migrations, 32 tables, migrator-owned database, PUBLIC revoked, runtime role granted per the CI matrix, read-only role per
-- checklist 12.7): baseline = SUMMARY|violations|0; 31 of 31 injected deviations detected; baseline again 0 after every revert.
-- Evidence: restore-acl-verification.validation-2026-11-13.txt; runner: restore-acl-verification.validate.sh.
-- NOT covered by that validation: execution on a hosted platform; execution as a non-superuser; a database provisioned by a platform
-- (its owner/PUBLIC settings may legitimately differ from CI's and would be REPORTED as violations, not repaired).
-- Validation found and fixed one false positive (a function ACL equal to the default after a GRANT/REVOKE round trip) and added checks
-- for role membership, extra schemas, enum type owners, and database CONNECT / read-only-role CREATE/TEMP.
--
-- The expected values below are NOT read from the database being checked. They come from the repository's CI definitions:
--   tables/view/append-only list : apps/api/test/integration/helpers/guard.ts FULL_APPLICATION_TABLES,
--                                  scripts/ci/g6b-preflight.js APPEND_ONLY_RUNTIME_TABLES and verifyPrivileges
--   role setup                   : scripts/ci/integration.js (database owner = migrator; REVOKE ALL ON DATABASE and ON SCHEMA
--                                  public FROM PUBLIC; runtime gets CONNECT and schema USAGE only; sequences: none exist;
--                                  no function grants, no default privileges)
--
-- Run on BOTH the restored copy (Path A source) and the drill database, through the same runner as the drill, e.g.
--   psql -X -q -At -F'|' -v ON_ERROR_STOP=1 -v runtime_role=<runtime> -v migrator_role=<migrator> -v readonly_role=<readonly> -f - < restore-acl-verification.sql
-- Output: one FAIL|<check>|<object>|<detail> line per violation, then SUMMARY|violations|<n>. Pass = no FAIL lines and 0.
-- The 'database_level' checks are meaningful only on the restored copy: a drill database is newly created, so its
-- database owner and database-level ACL cannot match; treat database_level lines on the drill DB as N/A, never as repairs.
-- A function ACL that equals the default ACL (for example after a GRANT/REVOKE round trip) is NOT a violation; any real difference is.
-- Any violation is REPORTED, never repaired; it blocks the release gate.

BEGIN READ ONLY;
WITH
expected_table(name, privs) AS (VALUES
  ('admissions', ARRAY['SELECT','INSERT','UPDATE']),
  ('audit_events', ARRAY['SELECT','INSERT']),
  ('beds', ARRAY['SELECT','INSERT','UPDATE']),
  ('bookings', ARRAY['SELECT','INSERT','UPDATE']),
  ('check_ins', ARRAY['SELECT','INSERT','UPDATE']),
  ('check_outs', ARRAY['SELECT','INSERT','UPDATE']),
  ('correction_command_receipts', ARRAY['SELECT','INSERT']),
  ('correction_finance_links', ARRAY['SELECT','INSERT']),
  ('correction_proposals', ARRAY['SELECT','INSERT','UPDATE']),
  ('enquiries', ARRAY['SELECT','INSERT','UPDATE']),
  ('enquiry_follow_ups', ARRAY['SELECT','INSERT','UPDATE']),
  ('floors', ARRAY['SELECT','INSERT','UPDATE']),
  ('invoice_adjustments', ARRAY['SELECT','INSERT','UPDATE']),
  ('invoice_voids', ARRAY['SELECT','INSERT']),
  ('invoices', ARRAY['SELECT','INSERT','UPDATE']),
  ('login_throttles', ARRAY['SELECT','INSERT','UPDATE']),
  ('memberships', ARRAY['SELECT','INSERT','UPDATE']),
  ('organizations', ARRAY['SELECT','INSERT','UPDATE']),
  ('payment_idempotency_keys', ARRAY['SELECT','INSERT','UPDATE']),
  ('payment_reversals', ARRAY['SELECT','INSERT','UPDATE']),
  ('payments', ARRAY['SELECT','INSERT','UPDATE']),
  ('properties', ARRAY['SELECT','INSERT','UPDATE']),
  ('residents', ARRAY['SELECT','INSERT','UPDATE']),
  ('rooms', ARRAY['SELECT','INSERT','UPDATE']),
  ('sessions', ARRAY['SELECT','INSERT','UPDATE']),
  ('stay_assignments', ARRAY['SELECT','INSERT','UPDATE']),
  ('stay_assignment_replacements', ARRAY['SELECT','INSERT']),
  ('transfer_command_receipts', ARRAY['SELECT','INSERT']),
  ('transfer_finance_reviews', ARRAY['SELECT','INSERT']),
  ('transfer_finance_resolutions', ARRAY['SELECT','INSERT']),
  ('transfers', ARRAY['SELECT','INSERT']),
  ('users', ARRAY['SELECT','INSERT','UPDATE']),
  ('effective_stay_assignments', ARRAY['SELECT'])
),
privs(priv) AS (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')),
rel AS (
  SELECT c.oid, c.relname, c.relkind, c.relowner FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f','S')
),
v AS (
  -- 1. runtime role privileges on every table/view equal the CI matrix (includes column-level grants)
  SELECT 'runtime_privilege' AS chk, r.relname AS obj,
         p.priv || ' actual=' || a.has::text || ' expected=' || (e.privs IS NOT NULL AND p.priv = ANY(e.privs))::text AS detail
    FROM rel r CROSS JOIN privs p
    LEFT JOIN expected_table e ON e.name = r.relname
    CROSS JOIN LATERAL (SELECT has_table_privilege(:'runtime_role', r.oid, p.priv)
                               OR CASE WHEN p.priv IN ('SELECT','INSERT','UPDATE','REFERENCES')
                                       THEN has_any_column_privilege(:'runtime_role', r.oid, p.priv) ELSE false END AS has) a
   WHERE r.relkind <> 'S'
     AND a.has IS DISTINCT FROM (e.privs IS NOT NULL AND p.priv = ANY(e.privs))
  UNION ALL
  -- 2. every expected object exists
  SELECT 'missing_object', e.name, 'expected object not found in schema public'
    FROM expected_table e WHERE NOT EXISTS (SELECT 1 FROM rel r WHERE r.relname = e.name)
  UNION ALL
  -- 3. no unexpected relations (the migration ledger is the only extra)
  SELECT 'unexpected_relation', r.relname, 'relkind=' || r.relkind::text
    FROM rel r WHERE r.relname NOT IN (SELECT name FROM expected_table) AND r.relname <> '_prisma_migrations' AND r.relkind <> 'S'
  UNION ALL
  -- 4. sequences: none exist in the schema
  SELECT 'sequence_exists', r.relname, 'the CI-tested schema has no sequences' FROM rel r WHERE r.relkind = 'S'
  UNION ALL
  -- 5. ownership of tables, views and the ledger
  SELECT 'relation_owner', r.relname, 'owner=' || pg_get_userbyid(r.relowner) || ' expected=' || :'migrator_role'
    FROM rel r WHERE pg_get_userbyid(r.relowner) <> :'migrator_role'
  UNION ALL
  -- 6. functions (excluding extension members): owned by the migrator, default ACL (no explicit grants)
  SELECT 'function_owner_or_acl', p.oid::regprocedure::text,
         'owner=' || pg_get_userbyid(p.proowner) || ' acl=' || coalesce(p.proacl::text, 'default')
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     AND (pg_get_userbyid(p.proowner) <> :'migrator_role'
          OR (p.proacl IS NOT NULL AND (
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                         WHERE NOT EXISTS (SELECT 1 FROM aclexplode(acldefault('f', p.proowner)) d
                                            WHERE d.grantee = a.grantee AND d.privilege_type = a.privilege_type AND d.is_grantable = a.is_grantable))
             OR EXISTS (SELECT 1 FROM aclexplode(acldefault('f', p.proowner)) d
                         WHERE NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                                            WHERE d.grantee = a.grantee AND d.privilege_type = a.privilege_type AND d.is_grantable = a.is_grantable)))))
  UNION ALL
  -- 7. schema public: owner, no PUBLIC privilege, runtime has USAGE and not CREATE
  SELECT 'schema_owner', n.nspname, 'owner=' || pg_get_userbyid(n.nspowner)
    FROM pg_namespace n WHERE n.nspname = 'public' AND pg_get_userbyid(n.nspowner) NOT IN ('pg_database_owner', :'migrator_role')
  UNION ALL
  SELECT 'schema_public_privilege', 'public', 'PUBLIC holds ' || a.privilege_type
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
   WHERE n.nspname = 'public' AND a.grantee = 0
  UNION ALL
  SELECT 'schema_runtime_privilege', 'public', 'USAGE=' || has_schema_privilege(:'runtime_role', 'public', 'USAGE')::text
         || ' CREATE=' || has_schema_privilege(:'runtime_role', 'public', 'CREATE')::text || ' expected USAGE=true CREATE=false'
   WHERE NOT has_schema_privilege(:'runtime_role', 'public', 'USAGE') OR has_schema_privilege(:'runtime_role', 'public', 'CREATE')
  UNION ALL
  -- 8. no default privileges anywhere
  SELECT 'default_privileges', coalesce(pg_get_userbyid(d.defaclrole), '?'), 'objtype=' || d.defaclobjtype::text || ' acl=' || d.defaclacl::text
    FROM pg_default_acl d
  UNION ALL
  -- 9. runtime role: no superuser/createrole/createdb/replication/bypassrls; owns nothing
  SELECT 'runtime_role_attribute', r.rolname, 'privileged attribute set'
    FROM pg_roles r WHERE r.rolname = :'runtime_role' AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
  UNION ALL
  SELECT 'runtime_owns_object', :'runtime_role', 'relations=' || (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid AND c.relnamespace = 'public'::regnamespace)::text
         || ' functions=' || (SELECT count(*) FROM pg_proc p WHERE p.proowner = r.oid AND p.pronamespace = 'public'::regnamespace)::text
         || ' schemas=' || (SELECT count(*) FROM pg_namespace n WHERE n.nspowner = r.oid)::text
    FROM pg_roles r WHERE r.rolname = :'runtime_role'
     AND ((SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid AND c.relnamespace = 'public'::regnamespace)
        + (SELECT count(*) FROM pg_proc p WHERE p.proowner = r.oid AND p.pronamespace = 'public'::regnamespace)
        + (SELECT count(*) FROM pg_namespace n WHERE n.nspowner = r.oid)) > 0
  UNION ALL
  -- 10. read-only dump role: privileged attributes, owned objects, and ANY write-type privilege
  SELECT 'readonly_role_attribute', r.rolname, 'privileged attribute set'
    FROM pg_roles r WHERE r.rolname = :'readonly_role' AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
  UNION ALL
  SELECT 'readonly_owns_object', :'readonly_role', 'owns objects in public or a schema'
    FROM pg_roles r WHERE r.rolname = :'readonly_role'
     AND ((SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid AND c.relnamespace = 'public'::regnamespace)
        + (SELECT count(*) FROM pg_proc p WHERE p.proowner = r.oid AND p.pronamespace = 'public'::regnamespace)
        + (SELECT count(*) FROM pg_namespace n WHERE n.nspowner = r.oid)) > 0
  UNION ALL
  SELECT 'readonly_can_write', r.relname, p.priv
    FROM rel r CROSS JOIN privs p
   WHERE r.relkind <> 'S' AND p.priv <> 'SELECT'
     AND (has_table_privilege(:'readonly_role', r.oid, p.priv)
          OR CASE WHEN p.priv IN ('INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege(:'readonly_role', r.oid, p.priv) ELSE false END)
  UNION ALL
  SELECT 'readonly_schema_create', 'public', 'role can CREATE in schema public' WHERE has_schema_privilege(:'readonly_role', 'public', 'CREATE')
  UNION ALL
  -- 11. database level (restored copy only; N/A on a freshly created drill database)
  SELECT 'database_level', d.datname, 'owner=' || pg_get_userbyid(d.datdba) || ' expected=' || :'migrator_role'
    FROM pg_database d WHERE d.datname = current_database() AND pg_get_userbyid(d.datdba) <> :'migrator_role'
  UNION ALL
  SELECT 'database_level', current_database(), 'PUBLIC holds ' || a.privilege_type
    FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
   WHERE d.datname = current_database() AND a.grantee = 0
  UNION ALL
  SELECT 'database_level', current_database(), 'runtime CREATE=' || has_database_privilege(:'runtime_role', current_database(), 'CREATE')::text
         || ' TEMP=' || has_database_privilege(:'runtime_role', current_database(), 'TEMP')::text || ' expected both false'
   WHERE has_database_privilege(:'runtime_role', current_database(), 'CREATE') OR has_database_privilege(:'runtime_role', current_database(), 'TEMP')
  UNION ALL
  -- 12. neither role may be a member of any other role (membership would inherit privileges)
  SELECT 'role_membership', r.rolname, 'member of ' || pg_get_userbyid(m.roleid)
    FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname IN (:'runtime_role', :'readonly_role')
  UNION ALL
  -- 13. no schemas other than public (and system schemas)
  SELECT 'extra_schema', n.nspname, 'owner=' || pg_get_userbyid(n.nspowner)
    FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'public')
  UNION ALL
  -- 14. enum types owned by the migrator
  SELECT 'type_owner', t.typname, 'owner=' || pg_get_userbyid(t.typowner) || ' expected=' || :'migrator_role'
    FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e' AND pg_get_userbyid(t.typowner) <> :'migrator_role'
  UNION ALL
  -- 15. database level (restored copy only): the runtime role can connect; the read-only role has no CREATE/TEMP
  SELECT 'database_level', current_database(), 'runtime role lacks CONNECT'
   WHERE NOT has_database_privilege(:'runtime_role', current_database(), 'CONNECT')
  UNION ALL
  SELECT 'database_level', current_database(), 'read-only role CREATE=' || has_database_privilege(:'readonly_role', current_database(), 'CREATE')::text
         || ' TEMP=' || has_database_privilege(:'readonly_role', current_database(), 'TEMP')::text || ' expected both false'
   WHERE has_database_privilege(:'readonly_role', current_database(), 'CREATE') OR has_database_privilege(:'readonly_role', current_database(), 'TEMP')
)
SELECT 'FAIL', chk, obj, detail FROM v
UNION ALL
SELECT 'SUMMARY', 'violations', count(*)::text, '' FROM v
ORDER BY 1, 2, 3;
ROLLBACK;
