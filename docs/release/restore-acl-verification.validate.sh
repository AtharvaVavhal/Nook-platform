#!/bin/bash
# Disposable local validation of docs/release/restore-acl-verification.sql. NO NETWORK in the container.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SP=$(mktemp -d)
N=nook-acl-validation
DB=nook_acl_validation
MIG=nook_ci_full_migrator; RT=nook_ci_full_runtime; RO=nook_val_readonly
PSQL(){ docker exec -i "$N" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 "$@"; }
VER(){ docker exec -i "$N" psql -U postgres -d $DB -X -q -At -F'|' -v ON_ERROR_STOP=1 -v runtime_role=$RT -v migrator_role=$MIG -v readonly_role=$RO -f - < $ROOT/docs/release/restore-acl-verification.sql; }
cleanup(){ docker rm -f "$N" >/dev/null 2>&1; echo "container removed: $(docker ps -a --filter name=$N --format '{{.Names}}' | wc -l) remaining"; }
trap cleanup EXIT
docker rm -f $N >/dev/null 2>&1
docker run -d --rm --name $N --network none -e POSTGRES_HOST_AUTH_METHOD=trust --mount type=tmpfs,destination=/var/lib/postgresql/data postgres:17.11-alpine >/dev/null || exit 1
echo "network mode: $(docker inspect -f '{{.HostConfig.NetworkMode}}' $N); server: $(docker exec $N postgres --version)"
for i in $(seq 1 40); do docker exec $N pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
# --- provision like CI (scripts/qa/phase4-disposable.mjs)
PSQL -c "CREATE ROLE $MIG LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS" -c "CREATE ROLE $RT LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS" -c "REVOKE ALL ON DATABASE postgres FROM PUBLIC" -c "CREATE DATABASE $DB OWNER $MIG" -c "REVOKE ALL ON DATABASE $DB FROM PUBLIC" -c "GRANT CONNECT ON DATABASE $DB TO $RT" >/dev/null || exit 1
docker exec -i $N psql -U $MIG -d $DB -X -q -v ON_ERROR_STOP=1 -c "REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO $RT;" || exit 1
n=0; for f in $(ls -d $ROOT/prisma/migrations/*/ | sort); do n=$((n+1)); docker exec -i $N psql -U $MIG -d $DB -X -q -v ON_ERROR_STOP=1 -f - < $f/migration.sql >/dev/null 2>$SP/mig-err.txt || { echo "migration failed: $f"; head -3 $SP/mig-err.txt; exit 1; }; done
echo "migrations applied: $n"
# --- runtime grants exactly as the CI harness does
APPEND="audit_events invoice_voids correction_command_receipts transfers transfer_command_receipts stay_assignment_replacements transfer_finance_reviews transfer_finance_resolutions correction_finance_links"
for t in $(docker exec -i $N psql -U $MIG -d $DB -At -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'"); do
  if echo " $APPEND " | grep -q " $t "; then P="SELECT, INSERT"; else P="SELECT, INSERT, UPDATE"; fi
  docker exec -i $N psql -U $MIG -d $DB -X -q -v ON_ERROR_STOP=1 -c "GRANT $P ON public.\"$t\" TO $RT" || exit 1
done
docker exec -i $N psql -U $MIG -d $DB -X -q -v ON_ERROR_STOP=1 -c "GRANT SELECT ON effective_stay_assignments TO $RT; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $RT;" || exit 1
# --- read-only dump role per checklist section 12.7 (this also tests that procedure's statements)
docker exec -i $N psql -U postgres -d $DB -X -q -v ON_ERROR_STOP=1 -c "CREATE ROLE $RO LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT CONNECT ON DATABASE $DB TO $RO; GRANT USAGE ON SCHEMA public TO $RO; GRANT SELECT ON ALL TABLES IN SCHEMA public TO $RO; ALTER ROLE $RO SET default_transaction_read_only = on;" || { echo "12.7 statements FAILED"; exit 1; }
echo "tables: $(PSQL -d $DB -c "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")"
echo "=== BASELINE (expect SUMMARY|violations|0)"; VER; echo "baseline exit=$?"
pass=0; fail=0
mut(){ # name | inject | revert | expected-substring
  local name="$1" inj="$2" rev="$3" exp="$4"
  PSQL -d $DB -c "$inj" >/dev/null 2>$SP/mut-err.txt || { echo "INJECT-ERROR $name: $(head -1 $SP/mut-err.txt)"; fail=$((fail+1)); return; }
  out=$(VER 2>&1)
  if echo "$out" | grep -qF "$exp"; then echo "DETECTED  $name"; pass=$((pass+1)); else echo "MISSED    $name  (wanted: $exp)"; echo "$out" | head -4 | sed 's/^/          /'; fail=$((fail+1)); fi
  PSQL -d $DB -c "$rev" >/dev/null 2>$SP/mut-err.txt || echo "REVERT-ERROR $name: $(head -1 $SP/mut-err.txt)"
}
FN=$(PSQL -d $DB -c "SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e') ORDER BY 1 LIMIT 1")
echo "=== INJECTED DEVIATIONS (function used: $FN)"
mut "runtime DELETE on payments" "GRANT DELETE ON payments TO $RT" "REVOKE DELETE ON payments FROM $RT" "FAIL|runtime_privilege|payments|DELETE actual=true expected=false"
mut "runtime lacks UPDATE on invoices" "REVOKE UPDATE ON invoices FROM $RT" "GRANT UPDATE ON invoices TO $RT" "FAIL|runtime_privilege|invoices|UPDATE actual=false expected=true"
mut "runtime lacks SELECT on payments" "REVOKE SELECT ON payments FROM $RT" "GRANT SELECT ON payments TO $RT" "FAIL|runtime_privilege|payments|SELECT actual=false expected=true"
mut "runtime UPDATE on audit_events" "GRANT UPDATE ON audit_events TO $RT" "REVOKE UPDATE ON audit_events FROM $RT" "FAIL|runtime_privilege|audit_events|UPDATE actual=true expected=false"
mut "runtime column-level UPDATE on append-only transfers" "GRANT UPDATE (reason) ON transfers TO $RT" "REVOKE UPDATE (reason) ON transfers FROM $RT" "FAIL|runtime_privilege|transfers|UPDATE actual=true expected=false"
mut "runtime TRUNCATE on beds" "GRANT TRUNCATE ON beds TO $RT" "REVOKE TRUNCATE ON beds FROM $RT" "FAIL|runtime_privilege|beds|TRUNCATE actual=true expected=false"
mut "runtime TRIGGER on residents" "GRANT TRIGGER ON residents TO $RT" "REVOKE TRIGGER ON residents FROM $RT" "FAIL|runtime_privilege|residents|TRIGGER actual=true expected=false"
mut "runtime UPDATE on the view" "GRANT UPDATE ON effective_stay_assignments TO $RT" "REVOKE UPDATE ON effective_stay_assignments FROM $RT" "FAIL|runtime_privilege|effective_stay_assignments|UPDATE actual=true expected=false"
mut "read-only role INSERT on residents" "GRANT INSERT ON residents TO $RO" "REVOKE INSERT ON residents FROM $RO" "FAIL|readonly_can_write|residents|INSERT"
mut "read-only role column-level UPDATE" "GRANT UPDATE (first_name) ON residents TO $RO" "REVOKE UPDATE (first_name) ON residents FROM $RO" "FAIL|readonly_can_write|residents|UPDATE"
mut "read-only role CREATE on schema" "GRANT CREATE ON SCHEMA public TO $RO" "REVOKE CREATE ON SCHEMA public FROM $RO" "FAIL|readonly_schema_create|public"
mut "default privileges exist" "ALTER DEFAULT PRIVILEGES FOR ROLE $MIG IN SCHEMA public GRANT SELECT ON TABLES TO $RT" "ALTER DEFAULT PRIVILEGES FOR ROLE $MIG IN SCHEMA public REVOKE SELECT ON TABLES FROM $RT" "FAIL|default_privileges"
mut "PUBLIC holds TEMP on the database" "GRANT TEMP ON DATABASE $DB TO PUBLIC" "REVOKE TEMP ON DATABASE $DB FROM PUBLIC" "FAIL|database_level|$DB|PUBLIC holds TEMPORARY"
mut "PUBLIC USAGE on schema" "GRANT USAGE ON SCHEMA public TO PUBLIC" "REVOKE USAGE ON SCHEMA public FROM PUBLIC" "FAIL|schema_public_privilege|public|PUBLIC holds USAGE"
mut "runtime CREATE on schema" "GRANT CREATE ON SCHEMA public TO $RT" "REVOKE CREATE ON SCHEMA public FROM $RT" "FAIL|schema_runtime_privilege|public"
mut "a sequence exists" "CREATE SEQUENCE public.zz_seq" "DROP SEQUENCE public.zz_seq" "FAIL|sequence_exists|zz_seq"
mut "function ACL grants EXECUTE to runtime" "GRANT EXECUTE ON FUNCTION $FN TO $RT" "REVOKE EXECUTE ON FUNCTION $FN FROM $RT" "FAIL|function_owner_or_acl"
mut "runtime owns a table" "CREATE TABLE public.zz_owned(id int); ALTER TABLE public.zz_owned OWNER TO $RT" "DROP TABLE public.zz_owned" "FAIL|runtime_owns_object|$RT"
mut "runtime role gains CREATEDB" "ALTER ROLE $RT CREATEDB" "ALTER ROLE $RT NOCREATEDB" "FAIL|runtime_role_attribute|$RT"
mut "table owner is not the migrator" "ALTER TABLE beds OWNER TO postgres" "ALTER TABLE beds OWNER TO $MIG" "FAIL|relation_owner|beds"
mut "database owner changed" "ALTER DATABASE $DB OWNER TO postgres" "ALTER DATABASE $DB OWNER TO $MIG" "FAIL|database_level|$DB|owner=postgres"
mut "expected table missing" "ALTER TABLE beds RENAME TO beds_x" "ALTER TABLE beds_x RENAME TO beds" "FAIL|missing_object|beds"
mut "runtime CREATE on database" "GRANT CREATE ON DATABASE $DB TO $RT" "REVOKE CREATE ON DATABASE $DB FROM $RT" "FAIL|database_level|$DB|runtime CREATE=true"
ENUM=$(PSQL -d $DB -c "SELECT t.typname FROM pg_type t WHERE t.typnamespace='public'::regnamespace AND t.typtype='e' ORDER BY 1 LIMIT 1")
mut "function EXECUTE revoked from PUBLIC (differs from default)" "REVOKE EXECUTE ON FUNCTION $FN FROM PUBLIC" "GRANT EXECUTE ON FUNCTION $FN TO PUBLIC" "FAIL|function_owner_or_acl"
mut "runtime role is a member of another role" "GRANT pg_read_all_data TO $RT" "REVOKE pg_read_all_data FROM $RT" "FAIL|role_membership|$RT|member of pg_read_all_data"
mut "read-only role is a member of another role" "GRANT pg_write_all_data TO $RO" "REVOKE pg_write_all_data FROM $RO" "FAIL|role_membership|$RO|member of pg_write_all_data"
mut "an extra schema exists" "CREATE SCHEMA zz_extra" "DROP SCHEMA zz_extra" "FAIL|extra_schema|zz_extra"
mut "enum type owned by someone else" "ALTER TYPE public.\"$ENUM\" OWNER TO postgres" "ALTER TYPE public.\"$ENUM\" OWNER TO $MIG" "FAIL|type_owner|$ENUM"
mut "runtime role cannot connect" "REVOKE CONNECT ON DATABASE $DB FROM $RT" "GRANT CONNECT ON DATABASE $DB TO $RT" "FAIL|database_level|$DB|runtime role lacks CONNECT"
mut "read-only role has TEMP on the database" "GRANT TEMP ON DATABASE $DB TO $RO" "REVOKE TEMP ON DATABASE $DB FROM $RO" "FAIL|database_level|$DB|read-only role CREATE=false TEMP=true"
mut "runtime SELECT on a table the CI matrix does not know (extra relation)" "CREATE TABLE public.zz_extra_rel(id int); GRANT SELECT ON public.zz_extra_rel TO $RT" "DROP TABLE public.zz_extra_rel" "FAIL|unexpected_relation|zz_extra_rel"
echo "=== detected: $pass  missed/errors: $fail"
echo "=== BASELINE AGAIN after all reverts (expect 0 violations)"; VER
