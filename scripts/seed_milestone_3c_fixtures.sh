#!/bin/sh
set -eu

REPO=/Users/atharva/Downloads/nook
CONTAINER=nook-postgres-1
DATABASE=nook_test
MIGRATOR=nook_phase3c_migrator
RUNTIME_ENV="$REPO/.env.test"
KEYCHAIN_HELPER="$REPO/scripts/keychain_helper"
KEYCHAIN_SERVICE=nook_m3c_fixture_owner
KEYCHAIN_ACCOUNT='m3c-owner@nook.test.invalid'

ORG_ID='00000000-0000-4000-8000-000000000101'
USER_ID='00000000-0000-4000-8000-000000000102'
MEMBERSHIP_ID='00000000-0000-4000-8000-000000000103'

WORK_DIR=$(mktemp -d)
chmod 700 "$WORK_DIR"
KEYCHAIN_SAVED=0
TRANSACTION_COMMITTED=0
CURRENT_STEP=initialization

fail_step() {
    status=$1
    detail=$2
    echo "SEED FAILED: step=$CURRENT_STEP exit=$status detail=$detail" >&2
    exit "$status"
}

cleanup() {
    status=$?
    if [ "$status" -ne 0 ]; then
        echo "SEED FAILED: step=$CURRENT_STEP exit=$status" >&2
    fi

    if [ "$KEYCHAIN_SAVED" -eq 1 ] && [ "$TRANSACTION_COMMITTED" -eq 0 ]; then
        echo "ORPHANED KEYCHAIN CREDENTIAL: service=$KEYCHAIN_SERVICE account=$KEYCHAIN_ACCOUNT" >&2
    fi

    if [ "$status" -eq 0 ] && [ "$TRANSACTION_COMMITTED" -eq 1 ]; then
        echo "Fixture seed committed and runtime verification passed."
    fi

    rm -rf "$WORK_DIR" || :
    exit "$status"
}

trap 'exit 130' INT TERM
trap cleanup EXIT

CURRENT_STEP=disk_preflight
AVAILABLE_KIB=$(df -Pk "$REPO" | awk 'NR == 2 { print $4 }')
AVAILABLE_BYTES=$((AVAILABLE_KIB * 1024))
if [ "$AVAILABLE_BYTES" -lt 5368709120 ]; then
    fail_step 20 "available space below 5 GiB"
fi

if [ ! -x "$KEYCHAIN_HELPER" ]; then
    fail_step 21 "Keychain helper unavailable"
fi

if [ ! -f "$RUNTIME_ENV" ]; then
    fail_step 22 "runtime environment unavailable"
fi

CURRENT_STEP=container_preflight
CONTAINER_STATE=$(
    docker inspect \
        --format '{{.State.Status}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
        "$CONTAINER"
)
if [ "$CONTAINER_STATE" != "running|true|healthy" ]; then
    fail_step 23 "container is not running and healthy"
fi

CURRENT_STEP=database_preflight
PREFLIGHT_QUERY="SELECT
    current_user,
    current_database(),
    inet_server_port(),
    (SELECT count(*) FROM organizations WHERE id = '$ORG_ID'),
    (SELECT count(*) FROM users WHERE id = '$USER_ID'),
    (SELECT count(*) FROM memberships WHERE id = '$MEMBERSHIP_ID');"

if docker exec "$CONTAINER" \
    psql -X -q -v ON_ERROR_STOP=1 \
    -h 127.0.0.1 -p 5432 \
    -U "$MIGRATOR" -d "$DATABASE" \
    -At -F '|' \
    -c "$PREFLIGHT_QUERY" \
    >"$WORK_DIR/preflight.out" \
    2>"$WORK_DIR/preflight.err"
then
    :
else
    status=$?
    if grep -qiE 'could not connect|connection refused|no route to host|password authentication failed' \
        "$WORK_DIR/preflight.err"
    then
        error_class=connection_failure
    elif grep -qiE 'syntax error|does not exist|permission denied|role .* does not exist' \
        "$WORK_DIR/preflight.err"
    then
        error_class=database_request_failure
    else
        error_class=psql_or_container_failure
    fi
    fail_step "$status" "migrator preflight: $error_class"
fi

IFS='|' read -r DB_USER DB_NAME DB_PORT ORG_COUNT USER_COUNT MEMBERSHIP_COUNT \
    <"$WORK_DIR/preflight.out"

if [ "$DB_USER" != "$MIGRATOR" ] ||
   [ "$DB_NAME" != "$DATABASE" ] ||
   [ "$DB_PORT" != "5432" ]; then
    fail_step 24 "provisioning identity mismatch"
fi

if [ "$ORG_COUNT" != "0" ] ||
   [ "$USER_COUNT" != "0" ] ||
   [ "$MEMBERSHIP_COUNT" != "0" ]; then
    fail_step 25 "fixture IDs are not all absent"
fi

CURRENT_STEP=keychain_preflight
if "$KEYCHAIN_HELPER" check "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT"; then
    fail_step 26 "fixture item already exists"
else
    KEYCHAIN_STATUS=$?
    if [ "$KEYCHAIN_STATUS" -ne 1 ]; then
        fail_step "$KEYCHAIN_STATUS" "Keychain check"
    fi
fi

if [ ! -f "$REPO/apps/api/src/auth/password-hasher.ts" ]; then
    fail_step 28 "PasswordHasher source unavailable"
fi

umask 077

CURRENT_STEP=password_generation
if node -e '
  const { randomBytes } = require("node:crypto");
  const { writeFileSync } = require("node:fs");
  writeFileSync(
    process.argv[1],
    randomBytes(32).toString("base64url") + "\n",
    { mode: 0o600 }
  );
' "$WORK_DIR/password" >/dev/null 2>&1
then
    :
else
    status=$?
    fail_step "$status" "random password generation"
fi

CURRENT_STEP=password_hashing
if (
    cd "$REPO/apps/api"
    node --import tsx --input-type=module - \
        "$WORK_DIR/password" "$WORK_DIR/seed.sql" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { PasswordHasher } from "./src/auth/password-hasher.ts";

const stdinArguments = process.argv.slice(1);
const [passwordPath, sqlPath] =
  stdinArguments[0] === "-" ? stdinArguments.slice(1) : stdinArguments;
const password = readFileSync(passwordPath, "utf8").trim();
const passwordHash = await new PasswordHasher().hash(password);

const sql = `BEGIN;

INSERT INTO organizations (
  id, name, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000101',
  'Nook Milestone 3C Fixture Organisation',
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO users (
  id, login_identifier, password_hash, display_name, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000102',
  'm3c-owner@nook.test.invalid',
  '${passwordHash}',
  'Milestone 3C Fixture Owner',
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO memberships (
  id, organization_id, user_id, role, status, created_at
) VALUES (
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  'OWNER',
  'ACTIVE',
  CURRENT_TIMESTAMP
);

COMMIT;
`;

writeFileSync(sqlPath, sql, { mode: 0o600 });
NODE
); then
    :
else
    status=$?
    fail_step "$status" "PasswordHasher or seed SQL generation"
fi

CURRENT_STEP=sql_validation
if [ ! -s "$WORK_DIR/seed.sql" ]; then
    fail_step 30 "generated SQL file is missing or empty"
fi

SQL_MODE=$(stat -f '%Lp' "$WORK_DIR/seed.sql" 2>/dev/null) || \
    fail_step 30 "generated SQL permissions unavailable"
case "$SQL_MODE" in
    600|400) ;;
    *) fail_step 30 "generated SQL permissions are not restrictive" ;;
esac

exec 3<"$WORK_DIR/seed.sql"
exec 4<"$WORK_DIR/seed.sql"

if node --input-type=module - /dev/fd/4 <<'NODE'
import { readFileSync } from "node:fs";

const sql = readFileSync(process.argv[2], "utf8");
const hash = "scrypt\\$[A-Za-z0-9_-]{22}\\$[A-Za-z0-9_-]{86}";
const expected = new RegExp(
  "^BEGIN;\\n\\n" +
  "INSERT INTO organizations \\(\\n" +
  "  id, name, status, created_at, updated_at\\n" +
  "\\) VALUES \\(\\n" +
  "  '00000000-0000-4000-8000-000000000101',\\n" +
  "  'Nook Milestone 3C Fixture Organisation',\\n" +
  "  'ACTIVE',\\n" +
  "  CURRENT_TIMESTAMP,\\n" +
  "  CURRENT_TIMESTAMP\\n" +
  "\\);\\n\\n" +
  "INSERT INTO users \\(\\n" +
  "  id, login_identifier, password_hash, display_name, status, created_at, updated_at\\n" +
  "\\) VALUES \\(\\n" +
  "  '00000000-0000-4000-8000-000000000102',\\n" +
  "  'm3c-owner@nook\\.test\\.invalid',\\n" +
  "  '" + hash + "',\\n" +
  "  'Milestone 3C Fixture Owner',\\n" +
  "  'ACTIVE',\\n" +
  "  CURRENT_TIMESTAMP,\\n" +
  "  CURRENT_TIMESTAMP\\n" +
  "\\);\\n\\n" +
  "INSERT INTO memberships \\(\\n" +
  "  id, organization_id, user_id, role, status, created_at\\n" +
  "\\) VALUES \\(\\n" +
  "  '00000000-0000-4000-8000-000000000103',\\n" +
  "  '00000000-0000-4000-8000-000000000101',\\n" +
  "  '00000000-0000-4000-8000-000000000102',\\n" +
  "  'OWNER',\\n" +
  "  'ACTIVE',\\n" +
  "  CURRENT_TIMESTAMP\\n" +
  "\\);\\n\\n" +
  "COMMIT;\\n(?![\\s\\S])"
);

if (!expected.test(sql)) process.exit(1);
NODE
then
    :
else
    fail_step 30 "generated SQL transaction structure is invalid"
fi

CURRENT_STEP=keychain_storage
if "$KEYCHAIN_HELPER" add \
    "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT" \
    <"$WORK_DIR/password"
then
    :
else
    status=$?
    fail_step "$status" "Keychain add"
fi
KEYCHAIN_SAVED=1

CURRENT_STEP=seed_transaction
if docker exec -i "$CONTAINER" \
    psql -X -q -v ON_ERROR_STOP=1 \
    -h 127.0.0.1 -p 5432 \
    -U "$MIGRATOR" -d "$DATABASE" \
    -f - <&3 \
    >"$WORK_DIR/seed_transaction.out" \
    2>"$WORK_DIR/seed_transaction.err"
then
    :
else
    status=$?
    if grep -qiE 'could not connect|connection refused|no route to host|password authentication failed' \
        "$WORK_DIR/seed_transaction.err"
    then
        error_class=connection_failure
    elif grep -qiE 'syntax error|does not exist|violates|permission denied|role .* does not exist' \
        "$WORK_DIR/seed_transaction.err"
    then
        error_class=database_request_failure
    else
        error_class=psql_or_container_failure
    fi
    fail_step "$status" "transaction failed: $error_class; no retry"
fi

CURRENT_STEP=transaction_verification
TRANSACTION_VERIFY_QUERY="SELECT
    current_user,
    current_database(),
    inet_server_port(),
    (SELECT count(*) FROM organizations WHERE id = '$ORG_ID'),
    (SELECT count(*) FROM users WHERE id = '$USER_ID'),
    (SELECT count(*) FROM memberships
        WHERE id = '$MEMBERSHIP_ID'
          AND organization_id = '$ORG_ID'
          AND user_id = '$USER_ID'
          AND role = 'OWNER'
          AND status = 'ACTIVE');"

if docker exec "$CONTAINER" \
    psql -X -q -v ON_ERROR_STOP=1 \
    -h 127.0.0.1 -p 5432 \
    -U "$MIGRATOR" -d "$DATABASE" \
    -At -F '|' \
    -c "$TRANSACTION_VERIFY_QUERY" \
    >"$WORK_DIR/transaction_verify.out" \
    2>"$WORK_DIR/transaction_verify.err"
then
    :
else
    status=$?
    if grep -qiE 'could not connect|connection refused|no route to host|password authentication failed' \
        "$WORK_DIR/transaction_verify.err"
    then
        error_class=connection_failure
    elif grep -qiE 'syntax error|does not exist|permission denied|role .* does not exist' \
        "$WORK_DIR/transaction_verify.err"
    then
        error_class=database_request_failure
    else
        error_class=psql_or_container_failure
    fi
    fail_step "$status" "transaction verification failed: $error_class"
fi

if [ "$(awk -F '|' 'NF == 6 { rows++ } END { print rows + 0 }' \
    "$WORK_DIR/transaction_verify.out")" -ne 1 ]; then
    fail_step 31 "transaction verification output is invalid"
fi

IFS='|' read -r VERIFY_USER VERIFY_DATABASE VERIFY_PORT \
    VERIFY_ORG_COUNT VERIFY_USER_COUNT VERIFY_MEMBERSHIP_COUNT \
    <"$WORK_DIR/transaction_verify.out"
if [ "$VERIFY_USER" != "$MIGRATOR" ] ||
   [ "$VERIFY_DATABASE" != "$DATABASE" ] ||
   [ "$VERIFY_PORT" != "5432" ] ||
   [ "$VERIFY_ORG_COUNT" != "1" ] ||
   [ "$VERIFY_USER_COUNT" != "1" ] ||
   [ "$VERIFY_MEMBERSHIP_COUNT" != "1" ]; then
    fail_step 31 "transaction verification mismatch"
fi
TRANSACTION_COMMITTED=1

CURRENT_STEP=runtime_verification
if (
    cd "$REPO"
    DOTENV_CONFIG_PATH=.env.test \
    node --import dotenv/config --input-type=module - <<'NODE'
import pg from "pg";

const parsed = new URL(process.env.DATABASE_URL);
if (
  parsed.username !== "nook_phase3c_runtime" ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "5433" ||
  parsed.pathname !== "/nook_test"
) {
  throw new Error("RUNTIME DATABASE_URL target mismatch");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query(`
    SELECT
      current_user,
      current_database(),
      inet_server_port(),
      (SELECT count(*) FROM organizations
       WHERE id = '00000000-0000-4000-8000-000000000101') AS organization_count,
      (SELECT count(*) FROM users
       WHERE id = '00000000-0000-4000-8000-000000000102') AS user_count,
      (SELECT count(*) FROM memberships
       WHERE id = '00000000-0000-4000-8000-000000000103') AS membership_count
  `);
  const row = result.rows[0];
  if (
    row.current_user !== "nook_phase3c_runtime" ||
    row.current_database !== "nook_test" ||
    Number(row.inet_server_port) !== 5432 ||
    Number(row.organization_count) !== 1 ||
    Number(row.user_count) !== 1 ||
    Number(row.membership_count) !== 1
  ) {
    console.error("RUNTIME VERIFICATION FAILED: identity or fixture counts differ");
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
NODE
); then
    :
else
    status=$?
    fail_step "$status" "runtime verification"
fi
