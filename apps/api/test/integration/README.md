# Integration tests

These tests start the real API and write real rows. They create organizations, users, residents, beds,
bookings, invoices and payments, and some of them delete rows, install temporary triggers on
`audit_events`, and reset login throttles for the whole database.

**There is no fixture teardown.** Rows are left behind on purpose, namespaced only by random UUIDs.
Until safe, run-scoped teardown exists, **a dedicated, disposable database is mandatory**. Destroying that
database is the only cleanup. Never point this suite at a development, shared or production database.

## What the guard enforces

Every integration file, and `database-migration.test.ts`, imports `./helpers/preflight.js` first.
Top-level `await` there means no test runs until all of the following have passed (pure rules in
`helpers/guard.ts`; the queries in `helpers/isolation.ts`; the lock lifecycle in `helpers/suite-lock.ts`).
Any failure stops the run before a single fixture is written, and messages never contain a URL, a password,
a role name or a driver message.

**Environment (all required, in this order of checking)**

| Variable                               | Rule                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB` | exactly `1`                                                                                         |
| `DATABASE_URL`                         | runtime-role URL                                                                                    |
| `MIGRATOR_DATABASE_URL`                | migrator-role URL                                                                                   |
| `TEST_OWNER_PASSWORD`                  | set (the password hashed into fixture users; not a database credential)                             |
| `NOOK_INTEGRATION_PROFILE`             | unset or `full` (all 23 application tables), or `initial-migration` (exactly the first nine tables) |

**No ambient driver variables.** Any set variable starting with `PG` (`PGHOST`, `PGSSLMODE`, `PGOPTIONS`,
`PGSERVICE`, ... , or any future one) and `NODE_TLS_REJECT_UNAUTHORIZED` is refused, by name only, with no
exceptions: `node-postgres` falls back to them for every setting a URL does not state. Always run with
`env -i`.

**Both URLs, validated independently**

- scheme `postgres://` or `postgresql://`; no fragment
- host `127.0.0.1`, `localhost` or `[::1]`
- explicit port, not `5432` and not `5433`
- exactly one database name matching `nook_integration_*` (never `nook_dev` or `nook_test`)
- no query parameters except `schema=public`
- runtime and migrator must name the same host, port and database, and must be different roles

**PostgreSQL identity, checked on both connections before any write**

- `current_database()`, `current_user` and `session_user` match the URLs; no role switching
- same server: `inet_server_addr()`, `inet_server_port()`, postmaster start time and, where readable, the
  system identifier agree; `pg_is_in_recovery()` is false
- the database comment equals `nook-integration-isolated: disposable, booking concurrency verification`
- **the server hosts no `nook_dev` or `nook_test` database at all**, whether or not any role can connect to it

**Runtime role must not**

- be a superuser or have `CREATEDB`, `CREATEROLE`, `BYPASSRLS` or `REPLICATION`
- own the database, a schema, a function or any table
- be a member of any other role (this covers `pg_read_all_data`, `pg_write_all_data`, `pg_maintain` and the
  migrator)
- hold `TRUNCATE`, `DELETE`, `REFERENCES`, `TRIGGER` or `MAINTAIN` on any application table, `UPDATE` or
  `DELETE` on `audit_events`, or `CREATE` on schema `public` or on the database
- be able to connect to any other database on the server

All of this is read with `has_*_privilege` and catalog queries; nothing is ever attempted destructively.

**Migrator role must**

- have none of the elevated attributes above
- own the database and every application table, and the expected tables for the profile must exist
- have no role memberships except PostgreSQL's implicit `pg_database_owner`

Provisioning must therefore also run `REVOKE CONNECT ON DATABASE postgres FROM PUBLIC` (see the plan).

## The suite lock

After the checks pass, the migrator connection takes a session-level advisory lock and keeps it for the life
of the process. One run at a time per database.

- **Acquisition retries on the same connection** every 250 ms for at most 15 s (at most 61 attempts), so a
  run that starts the instant the previous process exits is not refused spuriously. After the deadline it
  fails with a clear message. It never proceeds without the lock.
- **Loss is fatal.** A heartbeat pings the connection every 5 s (three unanswered ticks count as lost) and
  the driver's `error` and `end` events are watched; TCP keep-alive is on. If the lock is lost the process
  prints a safe message and exits with status 1. There is no reconnect: a new connection would be a new
  session that does not hold the lock. Every client the helpers hand out also re-checks that the lock is
  still held.
- **Release.** Normal shutdown (`beforeExit`) and `SIGINT`/`SIGTERM` close the connection, which releases the
  lock; a requested close is never reported as a loss.
- It lives only in test helpers. The application runtime has no global lock.

`npm run test:integration` also runs with `--test-concurrency=1`.

## Every way a test can reach a database

`test/integration-connection-paths.test.ts` scans the test tree and fails if this list changes without a
conscious edit.

| Path                                                             | Why it is safe                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `helpers/isolation.ts` builds two clients                        | the verification itself; only reads, then one becomes the lock holder                |
| `helpers/db.ts` builds clients                                   | only after the preflight and a live lock check                                       |
| The app under test (`DATABASE_URL`, Prisma adapter, health pool) | uses the verified environment                                                        |
| `invoice-scheduler.integration.test.ts` spawns the billing job   | starts after the parent verified and locked; scoped to one organization with `--org` |
| `account-security.integration.test.ts` runs operator scripts     | same verified environment, spawned after the preflight                               |
| `di.test.ts` clears `DATABASE_URL`                               | unit test that removes a connection for its duration and restores it                 |
| `restore-drill.test.ts`                                          | runs a shell script against fake hosts; touches no database                          |
| `database-migration.test.ts`                                     | uses `withMigratorClient` only; see below                                            |
| `scripts/seed_milestone_3c_fixtures.sh`, `scripts/ops/*`         | not part of the suite; the seed script is a manual tool and is never run by a test   |

Credential-bearing connection strings are never stored in the configuration objects: they sit in a private
map and are reachable only through `connectionStringOf`. Printing, serializing or diffing the config cannot
leak a password, and driver errors are reduced to an error code.

## Destructive statements in the suite

All of them go through a guarded helper, so they cannot run before the checks above succeed.

- `audit_events` privileges are inspected, never exercised destructively. The refused `UPDATE` and `DELETE`
  attempts on a test's own row run inside a transaction that is always rolled back. `TRUNCATE` is never run
  (the scan test fails if any test starts a `TRUNCATE` statement).
- Fault-injection triggers and functions (finance tests) must carry a per-run name matching
  `fin_test_<word>_<10 hex>` (`assertFaultInjectionName`) before they are created or dropped. They fire on
  every `audit_events` insert, which is another reason the suite must be serial.
- The login-throttle reset in the account-security test is database-wide by design; it is safe only under
  the serial run and suite lock on a disposable database.
- The booking race tests count blocked backends in the current database, which is only meaningful when no
  other run shares the database. The suite lock guarantees that.

## The migration test needs its own database

`database-migration.test.ts` asserts the schema of the **first migration only** (nine tables, ten foreign
keys, five active-row indexes) and needs owner-level rights (`DELETE` and key updates against foreign
keys). It therefore cannot share the full database, and it cannot use the runtime role. It runs against a
second disposable database that holds only the first migration, with `NOOK_INTEGRATION_PROFILE=initial-migration`
(the preflight refuses any other table set). Every connection it makes is the verified migrator connection,
and every transaction it opens is always rolled back, including the audit-event insert that used to commit a
row.

```bash
npm run test:database   # sets NOOK_DATABASE_TESTS_REQUIRED=1 and NOOK_INTEGRATION_PROFILE=initial-migration
```

## Running

Do not use `.env` or `.env.test`: they name development and shared databases and are never loaded by these
commands. Supply the variables explicitly, with `env -i` so no ambient variable leaks in:

```bash
cd apps/api
env -i PATH="$PATH" HOME="$HOME" \
  NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 TEST_OWNER_PASSWORD=... \
  DATABASE_URL=... MIGRATOR_DATABASE_URL=... \
  node --import tsx --test --test-concurrency=1 test/integration/booking.integration.test.ts
```

## Provisioning

The two integration databases use two different runtime roles (`nook_it_runtime` for the full database,
`nook_it_runtime_initial` for the initial-migration database), because the guard refuses a runtime role that
can connect to any other database.

`PHASE_2B_PROVISIONING_PLAN.md` is the approval-gated plan for creating the disposable cluster and both
databases.

## Unit tests for the guard

`test/integration-guard.test.ts` (rules and identity facts), `test/suite-lock.test.ts` (retry and lifecycle,
with a mock connection and a fake clock) and `test/integration-connection-paths.test.ts` (the scan above)
run as part of `npm test`. None of them connects to PostgreSQL.
