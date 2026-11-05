# Phase 2B: provisioning plan for the disposable integration database

**Status: PLAN ONLY. Nothing in this document has been executed.** It supersedes the plan in the Phase 2
report. Every step that creates, writes or deletes something is behind its own approval gate; approving
one gate does not approve the next. Nothing here touches `nook-postgres-1`, its volume, port 5433,
`nook_dev` or `nook_test`.

## What changed from the Phase 2 plan, and why

| #   | Change                                                                                                                   | Reason                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Added `REVOKE CONNECT ON DATABASE postgres FROM PUBLIC` (and `template1`)                                                | The guard refuses a runtime role that can connect to any other database; by default `PUBLIC` can connect to `postgres`                                                                            |
| 2   | Added `NOREPLICATION` to both application roles                                                                          | Explicit least privilege; the guard does not check it                                                                                                                                             |
| 3   | Dropped `uid=70,gid=70,mode=0700` from the tmpfs mount                                                                   | The image starts as root and its entrypoint fixes ownership itself; the extra options were unnecessary risk (NOT VERIFIED either way)                                                             |
| 4   | Memory 512 MB to 1 GB, tmpfs 512 MB to 384 MB, small WAL limits                                                          | tmpfs pages count against the container's memory limit, so the tmpfs cap must sit well below it                                                                                                   |
| 5   | Provisioning runs over the container's Unix socket; checks from the host use `psql` with `PGPASSWORD` in the environment | Fixes a bug: the old identity step ran `psql` _inside_ the container against host port 55433, which does not listen there (inside it is 5432). Also keeps passwords out of command-line arguments |
| 6   | Admin password passed with `--env-file`, not `-e`                                                                        | `-e VAR=value` puts the secret in `ps` output                                                                                                                                                     |
| 7   | Added explicit marker, role-attribute and "no `nook_dev` or `nook_test` on this server" checks                           | The guard checks most of this at test time; checking before the first test fails faster and more clearly                                                                                          |
| 8   | Prisma runs under `env -i` with `DOTENV_CONFIG_PATH=/dev/null` and `CHECKPOINT_DISABLE=1`                                | `prisma.config.ts` imports `dotenv/config`, which would otherwise read the root `.env` (development credentials) into the process                                                                 |
| 9   | Every write has its own approval gate (G1 to G8)                                                                         | Required                                                                                                                                                                                          |
| 10  | Cleanup uses `docker rm -f -v <name>` and a before/after volume comparison                                               | Removes only this container and any anonymous volume attached to it                                                                                                                               |

## Changes in Phase 2A.2 (guard hardening)

The guard is stricter now, which changes what must be provisioned and how commands are run:

- **A second disposable database, `nook_integration_initial`,** holds only the first migration for
  `database-migration.test.ts` (that test asserts exactly nine tables, ten foreign keys and five indexes, so it
  can never pass on the full database). It lives in the same disposable cluster, has the same roles and the
  same marker, and is selected with `NOOK_INTEGRATION_PROFILE=initial-migration`.
- **Each database has its own runtime role.** The guard refuses a runtime role that can connect to any
  other database, so one runtime role cannot serve both integration databases. `nook_it_runtime` connects to
  `nook_integration_isolated` only, and `nook_it_runtime_initial` connects to `nook_integration_initial` only
  (found when the real preflight ran at G4; fixed by approved Option A, with the guard unchanged).
- **No `PG*` environment variable may be set** when a test or the preflight runs (refused by name). Every
  command below already uses `env -i`; do not `export` any `PG*` variable in the shell used for the tests.
- **The runtime role must be a member of no role,** own nothing, and hold no `DELETE`, `TRUNCATE`,
  `REFERENCES`, `TRIGGER` or `MAINTAIN` on any table, no `UPDATE` or `DELETE` on `audit_events`, and no `CREATE`
  on the schema or the database. The grants below already satisfy this; do not widen them.
- **The preflight may wait up to 15 s** if another run holds the suite lock, then fails. It never proceeds
  without the lock, and a lost lock ends the process.
- The server must contain no database named `nook_dev` or `nook_test` (true for a new cluster).

## Approval gates

| Gate | Action                                                                                                          | Writes to                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| G0   | Read-only prechecks (already done once; repeat before G1)                                                       | nothing                                                       |
| G1   | Create the secrets file and the disposable container                                                            | a local file, one new container                               |
| G2   | Create roles and the database; revoke default access; set the marker                                            | the disposable cluster                                        |
| G3   | Apply the 18 migrations and the runtime grants                                                                  | the disposable database                                       |
| G3b  | Apply the first migration only, and the runtime grants, to the initial-migration database                       | the second disposable database                                |
| G4   | Run the preflight (first execution of the untested identity SQL; read-only, takes then releases the suite lock) | nothing persistent                                            |
| G5   | Run the booking integration tests (writes fixtures)                                                             | the disposable database                                       |
| G6   | Run lifecycle and check-in integration tests                                                                    | the disposable database                                       |
| G6b  | Run the database-migration test against the initial-migration database                                          | the second disposable database (all transactions rolled back) |
| G7   | Run finance integration tests, only after a separate review of their fault-injection sections                   | the disposable database                                       |
| G8   | Tear down: remove the container and the secrets file                                                            | deletes the disposable environment                            |

## G0. Read-only prechecks

Facts recorded on 2026-11-03 (host: Docker 29.8.0, 8.3 GB VM memory, 10 CPUs, host `psql` 16 present):

- `postgres:17.11-alpine` is already local (no pull). Image metadata: `PGDATA=/var/lib/postgresql/data`,
  `VOLUME /var/lib/postgresql/data`, entrypoint `docker-entrypoint.sh`, no `USER` set (starts as root).
- Host port 55433: nothing listening. The only existing container is `nook-postgres-1` on `127.0.0.1:5433`.

```bash
set -euo pipefail
docker image inspect postgres:17.11-alpine >/dev/null && echo "image present"
test -z "$(docker ps -a --filter 'name=^nook-it-postgres$' --format '{{.Names}}')" && echo "name free"
lsof -nP -iTCP:55433 -sTCP:LISTEN && { echo "port busy"; exit 1; } || echo "55433 free"
```

## G1. Secrets and the disposable container

```bash
set -euo pipefail
umask 077
IT=/private/tmp/claude-501/-Users-atharva-Downloads-nook/7096f042-0dbc-4711-ad32-548056bd0280/scratchpad/nook-it
mkdir -p "$IT"
docker volume ls -q | sort > "$IT/volumes.before"      # snapshot for the cleanup comparison
cat > "$IT/secrets.env" <<EOT
MIG_PW=$(openssl rand -hex 24)
RT_PW=$(openssl rand -hex 24)
TEST_OWNER_PASSWORD=$(openssl rand -hex 16)
EOT
cat > "$IT/admin.env" <<EOT
POSTGRES_USER=nook_it_admin
POSTGRES_DB=postgres
POSTGRES_PASSWORD=$(openssl rand -hex 24)
EOT
set -a; . "$IT/secrets.env"; set +a

docker run -d --name nook-it-postgres --pull=never \
  --label nook.purpose=integration-test --label nook.disposable=true \
  --memory=1g --memory-swap=1g --shm-size=128m \
  --tmpfs /var/lib/postgresql/data:rw,size=384m \
  --env-file "$IT/admin.env" \
  -p 127.0.0.1:55433:5432 \
  postgres:17.11-alpine \
  -c log_lock_waits=on -c max_connections=100 -c shared_buffers=64MB \
  -c min_wal_size=32MB -c max_wal_size=128MB
```

Then, before anything else, prove the container is the right one:

```bash
[ "$(docker inspect -f '{{index .Config.Labels "nook.purpose"}}' nook-it-postgres)" = "integration-test" ]
[ "$(docker port nook-it-postgres 5432/tcp)" = "127.0.0.1:55433" ]
docker inspect -f '{{json .Mounts}}' nook-it-postgres      # expect only a tmpfs mount, no volume
until docker exec nook-it-postgres pg_isready -U nook_it_admin -d postgres; do :; done
```

**Not verified until it runs:** that Docker accepts the tmpfs options as written; that the entrypoint
(running as root) takes ownership of the tmpfs data directory and `initdb` succeeds; and that no anonymous
volume appears (the image declares `VOLUME` on the same path; a tmpfs mount at that path should replace it).
If a volume does appear in `docker inspect`, stop and report before continuing.

## G2. Roles, database, default-access revocation, marker

Runs as the disposable cluster's bootstrap superuser over the container's Unix socket (trust
authentication inside the container, so no password appears on any command line). Passwords reach `psql`
on stdin only.

```bash
docker exec -i nook-it-postgres psql -X -v ON_ERROR_STOP=1 -U nook_it_admin -d postgres <<SQL
CREATE ROLE nook_it_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$MIG_PW';
CREATE ROLE nook_it_runtime  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$RT_PW';
CREATE ROLE nook_it_runtime_initial LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$RT_INIT_PW';
CREATE DATABASE nook_integration_isolated OWNER nook_it_migrator;
REVOKE ALL ON DATABASE nook_integration_isolated FROM PUBLIC;
GRANT CONNECT ON DATABASE nook_integration_isolated TO nook_it_runtime;
COMMENT ON DATABASE nook_integration_isolated IS 'nook-integration-isolated: disposable, booking concurrency verification';
CREATE DATABASE nook_integration_initial OWNER nook_it_migrator;
REVOKE ALL ON DATABASE nook_integration_initial FROM PUBLIC;
GRANT CONNECT ON DATABASE nook_integration_initial TO nook_it_runtime_initial;
COMMENT ON DATABASE nook_integration_initial IS 'nook-integration-isolated: disposable, booking concurrency verification';
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
SQL
```

**Consequences of `REVOKE CONNECT ON DATABASE postgres FROM PUBLIC`** (applied only in this new cluster):

- The superuser `nook_it_admin` is unaffected: superusers bypass privilege checks, and it owns `postgres`.
  Provisioning, `pg_isready` and every later admin command still work.
- `nook_it_migrator` and `nook_it_runtime` can no longer connect to `postgres`. Neither needs to: each
  connects only to `nook_integration_isolated`. The runtime keeps an explicit `CONNECT` there; the migrator
  is the owner.
- The runtime role also loses `TEMPORARY` on the integration database through `REVOKE ALL ... FROM PUBLIC`.
  Nothing in the application or the migrations uses temporary tables.
- `template1` is excluded from the guard's "other databases" query as a template; revoking it is optional
  tidying. It does not affect already-created databases.
- The runtime role needs no `TEMPORARY` on either integration database.
- It must never be applied to `nook-postgres-1`.

## G2 verification (read-only, as the superuser over the socket)

```bash
docker exec -i nook-it-postgres psql -X -At -U nook_it_admin -d postgres <<'SQL'
-- role attributes: expect (f,f,f,f,f,t) for both application roles
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolcanlogin
  FROM pg_roles WHERE rolname LIKE 'nook_it_%' ORDER BY 1;
-- owner and exact marker on both databases: expect nook_it_migrator | t for each
SELECT datname, pg_get_userbyid(datdba),
       shobj_description(oid, 'pg_database') = 'nook-integration-isolated: disposable, booking concurrency verification'
  FROM pg_database WHERE datname IN ('nook_integration_isolated', 'nook_integration_initial') ORDER BY 1;
-- runtime CONNECT per database: expect only the two integration databases = t
SELECT datname, has_database_privilege('nook_it_runtime', oid, 'CONNECT')
  FROM pg_database WHERE NOT datistemplate ORDER BY 1;
-- this server must not be the Nook development server: expect 0
SELECT count(*) FROM pg_database WHERE datname IN ('nook_dev', 'nook_test');
SQL
```

## G3. Migrations and runtime grants (disposable database only)

First, validate both URLs with the guard's pure parser, which makes no connection (the runtime URL is only
parsed here; nothing connects with it in this step):

```bash
cd /Users/atharva/Downloads/nook
MIG_URL="postgresql://nook_it_migrator:${MIG_PW}@127.0.0.1:55433/nook_integration_isolated"
RT_URL="postgresql://nook_it_runtime:${RT_PW}@127.0.0.1:55433/nook_integration_isolated"
env -i PATH="$PATH" HOME="$HOME" NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 TEST_OWNER_PASSWORD="$TEST_OWNER_PASSWORD" \
  DATABASE_URL="$RT_URL" MIGRATOR_DATABASE_URL="$MIG_URL" \
  node --import tsx -e "import('./apps/api/test/integration/helpers/guard.js').then(m => { m.validateEnvironment(process.env); console.log('URLs ok'); })"
```

Then the existing migration history, and nothing else, under a scrubbed environment:

```bash
env -i PATH="$PATH" HOME="$HOME" CHECKPOINT_DISABLE=1 DOTENV_CONFIG_PATH=/dev/null \
  DATABASE_URL="$MIG_URL" npx prisma migrate deploy
```

The migrations create only tables, types, indexes, functions and triggers. A search found no
`CREATE EXTENSION`, `CREATE ROLE`, `GRANT`, `REVOKE`, `OWNER TO`, or `SECURITY DEFINER`, so a non-superuser
migrator can apply them, and the migrator ends up owning every table. **Not verified until it runs:** that
`DOTENV_CONFIG_PATH=/dev/null` is accepted without error, and that the Prisma schema engine runs offline.

Verify the history (host `psql`, password in the environment, not in arguments):

```bash
env -i PATH="$PATH" PGPASSWORD="$MIG_PW" psql -X -At -h 127.0.0.1 -p 55433 -U nook_it_migrator -d nook_integration_isolated \
  -c "select count(*), count(*) filter (where finished_at is not null), count(*) filter (where rolled_back_at is not null) from _prisma_migrations"
# expect: 18 | 18 | 0
```

Runtime grants, run as the migrator so the grantor is the table owner (matching the existing scratch
databases). Reviewed against the privilege matrix of `nook_layer1_clean`:

```bash
env -i PATH="$PATH" PGPASSWORD="$MIG_PW" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55433 -U nook_it_migrator -d nook_integration_isolated <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nook_it_runtime;
GRANT SELECT, INSERT, UPDATE ON admissions, beds, bookings, check_ins, check_outs, enquiries,
  enquiry_follow_ups, floors, invoice_adjustments, invoices, login_throttles, memberships,
  organizations, payment_idempotency_keys, payment_reversals, payments, properties,
  residents, rooms, sessions, users TO nook_it_runtime;
GRANT SELECT, INSERT ON audit_events, invoice_voids TO nook_it_runtime;
SQL
```

Expected result of a privilege check (as migrator): the runtime role has SELECT, INSERT and UPDATE on the 21
tables; SELECT and INSERT only on `audit_events` and `invoice_voids`; no DELETE and no TRUNCATE anywhere;
nothing on `_prisma_migrations`.

## G3b. The initial-migration database (for the migration test only)

Applies the first migration file, and only that file, in a single transaction as the migrator. It deliberately
bypasses Prisma, so there is no `_prisma_migrations` ledger here (the guard excludes it).

```bash
cd /Users/atharva/Downloads/nook
env -i PATH="$PATH" PGPASSWORD="$MIG_PW" psql -X -v ON_ERROR_STOP=1 -1 -h 127.0.0.1 -p 55433 \
  -U nook_it_migrator -d nook_integration_initial \
  -f prisma/migrations/20261031154500_slice_2_2_foundation/migration.sql
env -i PATH="$PATH" PGPASSWORD="$MIG_PW" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55433 -U nook_it_migrator -d nook_integration_initial <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nook_it_runtime_initial;
GRANT SELECT, INSERT, UPDATE ON beds, floors, memberships, organizations, properties, rooms, sessions, users TO nook_it_runtime_initial;
GRANT SELECT, INSERT ON audit_events TO nook_it_runtime_initial;
SQL
```

Expected: exactly nine tables, ten foreign keys (all `RESTRICT`) and five partial unique indexes (a read-only
count of `pg_class`, `pg_constraint` and `pg_indexes`). The first migration contains no extension, role or grant
statement, so a non-superuser can apply it.

## G4. Preflight (first real execution of the identity SQL)

Read-only queries; takes the suite lock and releases it when the process exits.

```bash
cd /Users/atharva/Downloads/nook/apps/api
env -i PATH="$PATH" HOME="$HOME" NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 TEST_OWNER_PASSWORD="$TEST_OWNER_PASSWORD" \
  DATABASE_URL="postgresql://nook_it_runtime:${RT_PW}@127.0.0.1:55433/nook_integration_isolated" \
  MIGRATOR_DATABASE_URL="$MIG_URL" \
  node --import tsx -e "import('./test/integration/helpers/preflight.js').then(() => { console.log('preflight OK'); process.exit(0); }, e => { console.log(e.message); process.exit(1); })"
```

Expect `preflight OK`. Any refusal prints rule names only. A refusal is a finding to report, not something to
work around. Run it once per database: for `nook_integration_initial` use that database name in both URLs and
use `nook_it_runtime_initial` with `RT_INIT_PW` as the runtime role, and add `NOOK_INTEGRATION_PROFILE=initial-migration`.

What the preflight now reads (all catalogs any role may read; nothing is granted or written): database and
role identity, the server's `pg_database` list (to prove no `nook_dev` or `nook_test` exists), each role's
attributes including `rolreplication`, ownership of the database, schemas, functions and tables, role
membership through `pg_has_role`, and privileges through `has_table_privilege`, `has_schema_privilege` and
`has_database_privilege`. `pg_control_system()` is attempted and tolerated if unreadable.

## G5 to G7. Tests (each file in its own process, serial)

```bash
cd /Users/atharva/Downloads/nook/apps/api
RUN() { env -i PATH="$PATH" HOME="$HOME" NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 TEST_OWNER_PASSWORD="$TEST_OWNER_PASSWORD" \
  DATABASE_URL="postgresql://nook_it_runtime:${RT_PW}@127.0.0.1:55433/nook_integration_isolated" \
  MIGRATOR_DATABASE_URL="$MIG_URL" \
  node --import tsx --test --test-concurrency=1 "$@"; }
```

- **G5:** `RUN test/integration/booking.integration.test.ts`, repeated three times to check the race tests are stable.
- **G6:** `RUN test/integration/lifecycle.integration.test.ts`, then `RUN test/integration/checkin.integration.test.ts`.
- **G6b:** the migration test, against the initial-migration database only:

  ```bash
  env -i PATH="$PATH" HOME="$HOME" NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 NOOK_DATABASE_TESTS_REQUIRED=1 \
    NOOK_INTEGRATION_PROFILE=initial-migration TEST_OWNER_PASSWORD="$TEST_OWNER_PASSWORD" \
    DATABASE_URL="postgresql://nook_it_runtime_initial:${RT_INIT_PW}@127.0.0.1:55433/nook_integration_initial" \
    MIGRATOR_DATABASE_URL="postgresql://nook_it_migrator:${MIG_PW}@127.0.0.1:55433/nook_integration_initial" \
    node --import tsx --test --test-concurrency=1 test/database-migration.test.ts
  ```

  It uses only the verified migrator connection and rolls back every transaction. Run it directly like this,
  not through `npm run test:database`, so the `env -i` isolation is kept.

- **G7:** `test/integration/finance.integration.test.ts` only after its four fault-injection sections have been
  reviewed and approved separately.

Never use `.env` or `.env.test`.

After each run, verify: pass and fail counts; no leftover blocked backends; no stray test triggers
(`select tgname from pg_trigger where not tgisinternal` shows only the 15 application triggers).

## G8. Cleanup

```bash
[ "$(docker inspect -f '{{index .Config.Labels "nook.purpose"}}' nook-it-postgres)" = "integration-test" ]
docker rm -f -v nook-it-postgres          # this container and any anonymous volume attached to it only
rm -P "$IT/secrets.env" "$IT/admin.env"
docker ps -a --filter label=nook.purpose=integration-test     # expect empty
docker volume ls -q | sort | diff - "$IT/volumes.before" && echo "volumes unchanged"
```

Never use `docker compose down -v`, `docker system prune` or `docker volume prune`. No volume is created by
this plan. `nook-postgres-1` is never named in any command.

## Safety audit of the commands above

- Every `docker exec`, `docker inspect`, `docker rm` and `docker port` names `nook-it-postgres`; every
  connection uses `127.0.0.1:55433` or the container's own socket. Nothing uses 5433 or `nook-postgres-1`.
- `set -euo pipefail` plus the label and port assertions after G1 stop the sequence if a name or variable is
  wrong.
- Passwords live in two mode-600 files outside the repo, reach `psql` and the container by stdin, `--env-file`
  or the process environment (never as command-line arguments), and are deleted at G8.
- The superuser `nook_it_admin` is reachable over TCP on loopback with its password until teardown; no test
  uses it.

## Resources

- No persistent disk and no image pull. Data lives on a 384 MB tmpfs inside a 1 GB container limit (Docker VM:
  8.3 GB). An empty cluster plus 18 migrations is about 10 MB; earlier scratch databases reached 54 MB.
- Roughly 100 to 300 MB of container memory in use; a few hundred MB for each Node test process, one at a time.

## Status of the Phase 2A.1 gaps

| #   | Gap                                                               | Status after Phase 2A.2                                                                                                                               |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `database-migration.test.ts` skipped identity checks and the lock | Fixed in code: preflight first, verified migrator connection only, all transactions always rolled back. Needs the second database above. Not yet run. |
| F2  | Ambient `PG*` variables not rejected                              | Fixed in code: any `PG*` variable and `NODE_TLS_REJECT_UNAUTHORIZED` is refused by name.                                                              |
| F3  | Lock could be lost silently                                       | Fixed in code: heartbeat, error and end events, keep-alive; loss ends the process; no reconnect.                                                      |
| F4  | Single-attempt lock acquisition                                   | Fixed in code: 250 ms retry for at most 15 s on one connection.                                                                                       |
| F5  | No server-level rejection of the Nook development cluster         | Fixed in code: refuses any server hosting `nook_dev` or `nook_test`.                                                                                  |
| F6  | Incomplete ownership and role checks                              | Fixed in code: database, schema, function and table ownership; memberships; forbidden table, audit and DDL privileges; `REPLICATION`.                 |
| F7  | Password-bearing URLs retained in config                          | Fixed in code: the config holds metadata only; driver errors reduced to a code.                                                                       |

**None of this has run against a server.** The SQL behind F5 and F6 and the lock behaviour are verified only
by reading and by mock-based unit tests until G4.
