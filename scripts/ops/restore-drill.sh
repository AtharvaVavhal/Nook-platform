#!/usr/bin/env bash
# Restore drill: take a logical backup of a SOURCE database, restore it into a NEW, SEPARATE drill database, and prove
# the restored copy matches the source (structure, content hashes, permissions, ledger consistency).
#
#   scripts/ops/restore-drill.sh plan        ...   print what would happen; connects to nothing
#   scripts/ops/restore-drill.sh fingerprint ...   run restore-verify.sql read-only against one database
#   scripts/ops/restore-drill.sh run         ...   dump -> encrypt -> create drill DB -> decrypt -> restore -> verify
#   scripts/ops/restore-drill.sh cleanup     ...   drop a drill database this script created (explicit, named)
#
# Safety, enforced here (see docs/ops/BACKUP_RESTORE.md):
#   * The source is only READ (read-only sessions). Nothing is ever written to it.
#   * The target must be a NEW database named nook_restore_drill_*. The script never restores over an existing database,
#     never drops anything but a database it created itself (marked by a comment), and only on `cleanup`.
#   * Passwords are never put on a command line or printed. URLs come from environment variables you name; libpq
#     environment variables (PGPASSWORD etc.) carry them to the tools.
#   * The dump is encrypted at rest with a passphrase FILE (mode 600) and is never written unencrypted.
#   * Every target and source must be confirmed as host:port/database.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_SQL="${VERIFY_SQL:-$HERE/restore-verify.sql}"
TARGET_PATTERN='^nook_restore_drill_[a-z0-9_]{1,40}$'
# Databases that must never be a drill target or be dropped, whatever their name.
PROTECTED_DBS='postgres template0 template1 nook_dev nook_test'

die() { printf 'STOP: %s\n' "$*" >&2; exit 2; }
note() { printf '%s\n' "$*"; }

usage() {
  cat >&2 <<'USAGE'
usage: restore-drill.sh <plan|fingerprint|run|cleanup> [options]

  --source-env VAR         env var holding the SOURCE url (default SOURCE_DATABASE_URL)
  --confirm-source H:P/DB  must equal the source url's host:port/database
  --source-kind KIND       production-backup | scratch-rehearsal   (default scratch-rehearsal; recorded in the report)
  --admin-env VAR          env var holding an ADMIN url for the target cluster (default DRILL_ADMIN_URL);
                           used only to CREATE the drill database
  --target-db NAME         new database to create; must match nook_restore_drill_[a-z0-9_]+
  --confirm-target H:P/DB  must equal the admin url's host:port/NAME
  --out-dir DIR            where the encrypted dump, manifest and report go (must not exist; created mode 700)
  --passphrase-file FILE   encryption passphrase file (mode 600, at least 24 characters)
  --runner R               how the PostgreSQL tools run: local (default) or docker-exec:<container>
  --tool-host H --tool-port P   host and port as seen BY THE TOOLS (needed with docker-exec when they differ)
  --with-acl               restore owners and privileges (the roles must already exist in the target cluster)
  --runtime-role ROLE      also fingerprint what this role may do on the sensitive tables
  --yes-create-database    required by `run`: you have approval to create the drill database
USAGE
  exit 2
}

# ------------------------------------------------------------------ arguments
cmd="${1:-}"; [ -n "$cmd" ] || usage; shift || true
SOURCE_ENV=SOURCE_DATABASE_URL; ADMIN_ENV=DRILL_ADMIN_URL; SOURCE_KIND=scratch-rehearsal
CONFIRM_SOURCE=''; TARGET_DB=''; CONFIRM_TARGET=''; OUT_DIR=''; PASS_FILE=''; RUNNER=local
TOOL_HOST=''; TOOL_PORT=''; WITH_ACL=0; RUNTIME_ROLE=''; YES_CREATE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --source-env) SOURCE_ENV="${2:?}"; shift 2 ;;
    --confirm-source) CONFIRM_SOURCE="${2:?}"; shift 2 ;;
    --source-kind) SOURCE_KIND="${2:?}"; shift 2 ;;
    --admin-env) ADMIN_ENV="${2:?}"; shift 2 ;;
    --target-db) TARGET_DB="${2:?}"; shift 2 ;;
    --confirm-target) CONFIRM_TARGET="${2:?}"; shift 2 ;;
    --out-dir) OUT_DIR="${2:?}"; shift 2 ;;
    --passphrase-file) PASS_FILE="${2:?}"; shift 2 ;;
    --runner) RUNNER="${2:?}"; shift 2 ;;
    --tool-host) TOOL_HOST="${2:?}"; shift 2 ;;
    --tool-port) TOOL_PORT="${2:?}"; shift 2 ;;
    --with-acl) WITH_ACL=1; shift ;;
    --runtime-role) RUNTIME_ROLE="${2:?}"; shift 2 ;;
    --yes-create-database) YES_CREATE=1; shift ;;
    *) usage ;;
  esac
done

# ------------------------------------------------------------------ connection handling (no password on any command line)
# parse_url PREFIX URLVAR -> sets PREFIX_HOST/PORT/USER/PASS/DB/SSL in this shell; never echoes the password.
parse_url() {
  local prefix="$1" varname="$2" url="${!2:-}"
  [ -n "$url" ] || die "environment variable $varname is empty or not set"
  local out
  out="$(URL="$url" python3 - <<'PY'
import os, shlex, sys
from urllib.parse import urlparse, unquote, parse_qs
u = urlparse(os.environ["URL"])
if u.scheme not in ("postgres", "postgresql") or not u.hostname:
    sys.exit(3)
q = parse_qs(u.query)
vals = {
  "HOST": u.hostname, "PORT": str(u.port or 5432), "USER": unquote(u.username or ""),
  "PASS": unquote(u.password or ""), "DB": unquote(u.path.lstrip("/")),
  "SSL": (q.get("sslmode") or [""])[0],
}
for k, v in vals.items():
    print(f"{k}={shlex.quote(v)}")
PY
)" || die "$varname is not a valid postgres:// URL"
  local line key val
  while IFS= read -r line; do
    key="${line%%=*}"; val="${line#*=}"
    eval "${prefix}_${key}=$val"
  done <<< "$out"
}

target_of() { printf '%s:%s/%s' "$1" "$2" "$3"; }

# pgrun PREFIX DBNAME tool args...   runs a PostgreSQL client tool against that connection.
pgrun() {
  local prefix="$1" db="$2"; shift 2
  local host port user pass ssl
  eval "host=\${${prefix}_HOST}; port=\${${prefix}_PORT}; user=\${${prefix}_USER}; pass=\${${prefix}_PASS}; ssl=\${${prefix}_SSL}"
  [ -n "$TOOL_HOST" ] && host="$TOOL_HOST"
  [ -n "$TOOL_PORT" ] && port="$TOOL_PORT"
  (
    export PGHOST="$host" PGPORT="$port" PGUSER="$user" PGPASSWORD="$pass" PGDATABASE="$db"
    [ -n "$ssl" ] && export PGSSLMODE="$ssl"
    export PGOPTIONS="${PGOPTIONS:-}" PGCONNECT_TIMEOUT=10
    case "$RUNNER" in
      local) exec "$@" ;;
      docker-exec:*)
        # `-e NAME` (no value) hands the value over from this environment: it never appears in the argument list.
        exec docker exec -i -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGOPTIONS \
          -e PGCONNECT_TIMEOUT "${RUNNER#docker-exec:}" "$@" ;;
      *) die "unknown --runner $RUNNER" ;;
    esac
  )
}

psql_at() { # prefix db sql  -> unaligned, tuples-only result
  local prefix="$1" db="$2" sql="$3"
  pgrun "$prefix" "$db" psql -X -q -At -v ON_ERROR_STOP=1 -c "$sql"
}

# ------------------------------------------------------------------ validation shared by every command
check_runner() {
  case "$RUNNER" in
    local) command -v pg_dump >/dev/null && command -v pg_restore >/dev/null && command -v psql >/dev/null \
             || die "pg_dump, pg_restore and psql must be on PATH for --runner local" ;;
    docker-exec:?*) command -v docker >/dev/null || die "docker is not available for --runner $RUNNER" ;;
    *) die "--runner must be local or docker-exec:<container>" ;;
  esac
}

check_passphrase_file() {
  [ -n "$PASS_FILE" ] || die "--passphrase-file is required"
  [ -f "$PASS_FILE" ] || die "the passphrase file does not exist"
  local mode; mode="$(stat -f '%Lp' "$PASS_FILE" 2>/dev/null || stat -c '%a' "$PASS_FILE")"
  [ "$mode" = 600 ] || die "the passphrase file must have mode 600 (it has $mode)"
  [ "$(wc -c < "$PASS_FILE")" -ge 24 ] || die "the passphrase must be at least 24 characters"
}

check_target_name() {
  [[ "$TARGET_DB" =~ $TARGET_PATTERN ]] || die "--target-db must match $TARGET_PATTERN (a new database that is clearly a drill)"
  local p; for p in $PROTECTED_DBS; do [ "$TARGET_DB" != "$p" ] || die "$p can never be a drill target"; done
}

# ------------------------------------------------------------------ plan
print_plan() {
  note "Restore drill plan (nothing has been contacted)"
  note "  source           : ${SRC_TARGET}   [${SOURCE_KIND}]   read-only"
  note "  drill database   : ${ADM_TARGET_BASE}/${TARGET_DB}   (new; created by this run, never an existing database)"
  note "  tools            : ${RUNNER}${TOOL_HOST:+  (tool host ${TOOL_HOST}:${TOOL_PORT:-?})}"
  note "  dump             : pg_dump --format=custom --serializable-deferrable, $( [ $WITH_ACL = 1 ] && echo 'with owners and privileges' || echo '--no-owner --no-acl (permissions NOT verified)' )"
  note "  encryption       : openssl aes-256-cbc, pbkdf2 600000 iterations, passphrase file (mode 600); no unencrypted dump on disk"
  note "  output directory : ${OUT_DIR}  (mode 700)"
  note "  steps            : preflight -> dump+encrypt -> create database -> decrypt+restore (single transaction) -> fingerprint both -> compare -> report"
  note "  leaves           : the drill database in place (cleanup is a separate, named command)"
}

# ------------------------------------------------------------------ fingerprint
fingerprint() { # prefix db outfile
  local prefix="$1" db="$2" out="$3" vars=()
  [ -n "$RUNTIME_ROLE" ] && vars=(-v "runtime_role=$RUNTIME_ROLE")
  [ -f "$VERIFY_SQL" ] || die "restore-verify.sql not found"
  PGOPTIONS='-c default_transaction_read_only=on -c TimeZone=UTC -c statement_timeout=600000' \
    pgrun "$prefix" "$db" psql -X -q -At -F'|' -v ON_ERROR_STOP=1 ${vars[@]+"${vars[@]}"} -f - < "$VERIFY_SQL" | LC_ALL=C sort > "$out"
}

# ------------------------------------------------------------------ compare two fingerprints
compare_section() { # section srcfile dstfile
  local s="$1" a="$2" b="$3" ca cb
  ca="$(grep -c "^${s}|" "$a" || true)"; cb="$(grep -c "^${s}|" "$b" || true)"
  if diff <(grep "^${s}|" "$a") <(grep "^${s}|" "$b") >/dev/null; then
    printf 'PASS  %-14s %6s facts identical\n' "$s" "$ca"; return 0
  fi
  printf 'FAIL  %-14s source %s facts, restored %s facts; first differences:\n' "$s" "$ca" "$cb"
  diff <(grep "^${s}|" "$a") <(grep "^${s}|" "$b") | head -8 | sed 's/^/        /'
  return 1
}

# ------------------------------------------------------------------ commands
case "$cmd" in
  plan|fingerprint|run|cleanup) ;;
  *) usage ;;
esac

check_runner
parse_url SRC "$SOURCE_ENV"
SRC_TARGET="$(target_of "$SRC_HOST" "$SRC_PORT" "$SRC_DB")"

if [ "$cmd" = fingerprint ]; then
  [ "$CONFIRM_SOURCE" = "$SRC_TARGET" ] || die "--confirm-source must be exactly the source: $SRC_TARGET"
  [ -n "$OUT_DIR" ] || die "--out-dir is required"
  [ ! -e "$OUT_DIR" ] || die "--out-dir already exists; choose a new path"
  mkdir -m 700 -p "$OUT_DIR"
  fingerprint SRC "$SRC_DB" "$OUT_DIR/fingerprint.txt"
  note "fingerprint written: $(wc -l < "$OUT_DIR/fingerprint.txt" | tr -d ' ') facts in $OUT_DIR/fingerprint.txt"
  exit 0
fi

check_target_name
parse_url ADM "$ADMIN_ENV"
ADM_TARGET_BASE="${ADM_HOST}:${ADM_PORT}"
DRILL_TARGET="${ADM_TARGET_BASE}/${TARGET_DB}"

[ -n "$OUT_DIR" ] || die "--out-dir is required"

if [ "$cmd" = plan ]; then
  print_plan; exit 0
fi

# the same cluster and database must never be both source and target
if [ "$SRC_HOST:$SRC_PORT" = "$ADM_HOST:$ADM_PORT" ] && [ "$SRC_DB" = "$TARGET_DB" ]; then
  die "the source and the drill database are the same database"
fi
[ "$CONFIRM_TARGET" = "$DRILL_TARGET" ] || die "--confirm-target must be exactly the drill database: $DRILL_TARGET"

if [ "$cmd" = cleanup ]; then
  marker="$(psql_at ADM postgres "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${TARGET_DB}'")"
  [ -n "$marker" ] || die "database ${TARGET_DB} does not exist (or has no comment); nothing to drop"
  case "$marker" in nook-restore-drill:*) ;; *) die "database ${TARGET_DB} was not created by this script; refusing to drop it" ;; esac
  note "dropping drill database ${TARGET_DB} (${marker})"
  psql_at ADM postgres "DROP DATABASE \"${TARGET_DB}\"" >/dev/null
  note "dropped."
  exit 0
fi

# ---- run
[ "$CONFIRM_SOURCE" = "$SRC_TARGET" ] || die "--confirm-source must be exactly the source: $SRC_TARGET"
[ "$YES_CREATE" = 1 ] || die "run creates a database: pass --yes-create-database once that has been approved"
case "$SOURCE_KIND" in production-backup|scratch-rehearsal) ;; *) die "--source-kind must be production-backup or scratch-rehearsal" ;; esac
check_passphrase_file
[ ! -e "$OUT_DIR" ] || die "--out-dir already exists; choose a new path (nothing is overwritten)"
print_plan
mkdir -m 700 -p "$OUT_DIR"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
T0=$SECONDS

note ""; note "[1/6] preflight"
src_info="$(psql_at SRC "$SRC_DB" "SELECT current_setting('server_version') || ' ' || pg_size_pretty(pg_database_size(current_database()))")"
note "  source server/size : $src_info"
exists="$(psql_at ADM postgres "SELECT count(*) FROM pg_database WHERE datname = '${TARGET_DB}'")"
[ "$exists" = 0 ] || die "database ${TARGET_DB} already exists; choose another name (nothing is overwritten)"
if [ "$WITH_ACL" = 1 ]; then
  missing="$(psql_at SRC "$SRC_DB" "SELECT string_agg(DISTINCT r, ', ') FROM (
      SELECT pg_get_userbyid(relowner) AS r FROM pg_class WHERE relnamespace = 'public'::regnamespace
      UNION SELECT (aclexplode(relacl)).grantee::regrole::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relacl IS NOT NULL) x
      WHERE r <> '-' AND r <> '0'")"
  for role in $(printf '%s' "$missing" | tr ',' ' '); do
    [ "$(psql_at ADM postgres "SELECT count(*) FROM pg_roles WHERE rolname = '${role}'")" = 1 ] \
      || die "--with-acl needs role ${role} in the target cluster; create it first or drop --with-acl (permissions would then be reported as NOT VERIFIED)"
  done
fi

note "[2/6] dump + encrypt"
T1=$SECONDS
dump_opts=(--format=custom --serializable-deferrable --no-password)
[ "$WITH_ACL" = 1 ] || dump_opts+=(--no-owner --no-acl)
# pipefail is on: a failing pg_dump or openssl fails the run. The dump never touches the disk unencrypted.
pgrun SRC "$SRC_DB" pg_dump "${dump_opts[@]}" \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -pass "file:$PASS_FILE" -out "$OUT_DIR/dump.enc"
enc_sha="$(shasum -a 256 "$OUT_DIR/dump.enc" | cut -d' ' -f1)"
enc_size="$(wc -c < "$OUT_DIR/dump.enc" | tr -d ' ')"
D_DUMP=$((SECONDS - T1))
note "  encrypted dump     : ${enc_size} bytes, sha256 ${enc_sha:0:16}…, ${D_DUMP}s"

note "[3/6] create the drill database"
psql_at ADM postgres "CREATE DATABASE \"${TARGET_DB}\" TEMPLATE template0 ENCODING 'UTF8'" >/dev/null
psql_at ADM postgres "COMMENT ON DATABASE \"${TARGET_DB}\" IS 'nook-restore-drill:${RUN_ID}'" >/dev/null

note "[4/6] decrypt + restore (single transaction; a failure leaves the drill database empty)"
T2=$SECONDS
restore_opts=(--dbname="$TARGET_DB" --exit-on-error --single-transaction --no-password)
[ "$WITH_ACL" = 1 ] || restore_opts+=(--no-owner --no-acl)
[ "$(shasum -a 256 "$OUT_DIR/dump.enc" | cut -d' ' -f1)" = "$enc_sha" ] \
  || die "the encrypted dump changed on disk since it was written"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$PASS_FILE" -in "$OUT_DIR/dump.enc" \
  | pgrun ADM "$TARGET_DB" pg_restore "${restore_opts[@]}"
D_RESTORE=$((SECONDS - T2))
note "  restored in ${D_RESTORE}s from the encrypted dump (hash re-checked before decrypting)"

note "[5/6] fingerprint source and restored database (read-only)"
T3=$SECONDS
fingerprint SRC "$SRC_DB" "$OUT_DIR/source.fingerprint"
fingerprint ADM "$TARGET_DB" "$OUT_DIR/restored.fingerprint"
D_VERIFY=$((SECONDS - T3))

note "[6/6] compare"
fail=0
SECTIONS=(ext table column index constraint trigger function enum rows hash ledger total)
if [ "$WITH_ACL" = 1 ]; then SECTIONS+=(owner acl); fi
[ -n "$RUNTIME_ROLE" ] && SECTIONS+=(runtime_priv)
{
  for s in "${SECTIONS[@]}"; do compare_section "$s" "$OUT_DIR/source.fingerprint" "$OUT_DIR/restored.fingerprint" || fail=1; done
  [ "$WITH_ACL" = 1 ] || printf 'SKIP  %-14s dumped with --no-owner --no-acl: owners and privileges NOT VERIFIED\n' 'owner/acl'
  [ -n "$RUNTIME_ROLE" ] || printf 'SKIP  %-14s no --runtime-role given\n' 'runtime_priv'
} | tee "$OUT_DIR/comparison.txt"

D_TOTAL=$((SECONDS - T0))
{
  echo "# Restore drill report ${RUN_ID}"
  echo
  echo "- Source: ${SRC_TARGET} (${SOURCE_KIND}); server/size: ${src_info}"
  echo "- Drill database: ${DRILL_TARGET} (left in place)"
  echo "- Tools: ${RUNNER}; permissions restored: $( [ $WITH_ACL = 1 ] && echo yes || echo 'no (NOT VERIFIED)')"
  echo "- Encrypted dump: ${enc_size} bytes, sha256 ${enc_sha}"
  echo "- Durations (s): dump+encrypt ${D_DUMP}, decrypt+restore ${D_RESTORE}, fingerprint ${D_VERIFY}, total ${D_TOTAL}"
  echo "- Result: $( [ $fail = 0 ] && echo PASS || echo FAIL )"
  echo
  if [ "$SOURCE_KIND" = scratch-rehearsal ]; then
    echo "> This was a rehearsal on a scratch source. It proves the procedure and tooling work. It does NOT show that a"
    echo "> production backup restores: repeat with --source-kind production-backup on a real backup."
    echo
  fi
  echo '## Comparison'; echo '```'; cat "$OUT_DIR/comparison.txt"; echo '```'
  echo
  echo '## Ledger invariants (violation counts; a healthy production database shows 0 except legacy cancelled_without_void)'
  echo '```'; grep '^ledger|' "$OUT_DIR/restored.fingerprint" | sed 's/^ledger|//; s/|/ = /'; echo '```'
  echo
  echo '## Totals'; echo '```'; grep '^total|' "$OUT_DIR/restored.fingerprint" | sed 's/^total|//; s/|/ = /'; echo '```'
} > "$OUT_DIR/report.md"
note ""; note "report: $OUT_DIR/report.md   (total ${D_TOTAL}s)"
[ $fail = 0 ] && note "RESULT: PASS" || { note "RESULT: FAIL"; exit 1; }
