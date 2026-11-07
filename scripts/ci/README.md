# Phase 3 CI database isolation

This configuration is ready for static review, not evidence of a successful database run.
G6 execution requires separate explicit approval. No database is provisioned by static checks.

## Jobs and routing

`quality` has no PostgreSQL service or database credentials. It runs separate API/web typechecks,
ESLint, Prettier and unit tests, plus the retained scope, build, secret-scan and dependency-audit
checks. Static Prisma schema validation uses a CI-only config with no datasource or dotenv loader.
`run-unit.js` passes only PATH and APP_ENV to its explicitly selected backend tests.
`test-files.json` is the reviewed backend routing manifest; new tests need explicit classification.
Frontend uses its existing workspace test command (`src/*.test.ts`).

`full-integration` (G6B) in `.github/workflows/ci.yml` depends on `quality` and runs only after it
succeeds. `initial-integration` (G6A) is the sole job in `.github/workflows/g6a.yml`, triggered by
`workflow_dispatch` with `AUTHORIZE_G6A`; it has no `needs` dependency on `quality` or G6B. G6A runs
the static CI contract, offline migration-path tests and migration-content checks before its
provisioning step, but does not run the complete quality job. The two integration jobs use separate
GitHub-hosted runners and PostgreSQL 17 services, no shared storage or database artifacts, and
30-minute job timeouts. Host bindings are loopback-only. GitHub owns service cleanup. No self-hosted
runner, existing database, arbitrary URL, or operator-specified endpoint is accepted.

| Group                                     | Job                 | Database                                                         | Schema               |
| ----------------------------------------- | ------------------- | ---------------------------------------------------------------- | -------------------- |
| Backend manifest `quality`                | quality             | None                                                             | None                 |
| Frontend `src/*.test.ts`                  | quality             | None                                                             | None                 |
| `database-migration.test.ts`              | initial-integration | Disposable                                                       | Initial only         |
| Manifest `full`, all 12 integration files | full-integration    | Separate disposable                                              | All migrations       |
| `restore-drill.test.ts`                   | Separate/manual     | Mocks write temporary files; real drills need an isolated target | Not in this workflow |
| `invoice-scheduler.test.ts`               | quality             | In-memory database/finance stand-ins                             | None                 |
| `invoice-scheduler.integration.test.ts`   | full-integration    | Disposable                                                       | Full                 |

Unit routing was reviewed through imports and setup: auth/inventory/finance services use fakes;
DI explicitly removes DATABASE_URL; CORS constructs a provider-free HTTP app; guard tests supply
mock facts; suite-lock tests inject fake connections and clocks. Observability/Sentry tests use
synthetic events and test transports. Restore-drill tests create files and spawn mocked tools and
are deliberately excluded. No scheduler entrypoint/job is called by quality.

## Provisioning and guard contract

`integration.js` accepts only `initial-migration` or `full`, and requires GitHub Actions, a hosted
runner and the matching job ID. The fixed endpoints are:

| Profile           | Loopback port | Database                    | Role suffix |
| ----------------- | ------------- | --------------------------- | ----------- |
| initial-migration | 5544          | nook_integration_ci_initial | initial     |
| full              | 5545          | nook_integration_ci_full    | full        |

The service bootstrap password uses the already-masked, job-scoped, read-only GitHub token. It is
used only for cluster provisioning and is never passed to tests or used as an application password.
Checkout does not persist Git credentials. Runtime, migrator and fixture-owner passwords are fresh
random values, masked before use, retained in memory, and never stored in artifacts or GITHUB_ENV.
No connection string, password, SQL text or raw driver error is printed by the provisioning helper.
Do not enable shell tracing or upload service configuration/environment dumps.

Before any connection, the existing pure environment validator validates the generated test
configuration. Before any cluster mutation, provisioning refuses any cluster whose database names
are not exactly postgres/template0/template1. Only this fresh CI service is provisioned. Bootstrap
is the sole superuser connection; no suite receives its credentials.

Runtime and migrator have distinct names and passwords and explicit NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. Neither receives role memberships. Migrator owns the
database and creates all application tables. PostgreSQL's implicit pg_database_owner membership
is allowed by the unchanged guard. PUBLIC loses database privileges on every default database and
the new database; runtime receives CONNECT only on its one database. PUBLIC schema privileges are
revoked; runtime receives USAGE only. Runtime table grants are SELECT/INSERT/UPDATE, except audit
which is SELECT/INSERT only. No DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN or CREATE is granted.
Sequence access is USAGE/SELECT. There are no elevated default grants for future tables.

The exact marker is imported from `helpers/guard.ts`, avoiding a duplicated marker string.
Child environments contain only PATH, APP_ENV and the actual guard variables:

- NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1
- NOOK_INTEGRATION_PROFILE=initial-migration or full
- NOOK_DATABASE_TESTS_REQUIRED=1
- DATABASE_URL (runtime)
- MIGRATOR_DATABASE_URL (distinct owner)
- TEST_OWNER_PASSWORD (fixture login, not database authentication)

Ambient PG\* and NODE_TLS_REJECT_UNAUTHORIZED variables are rejected during setup and are not
forwarded to children. No dotenv loader or Prisma config is imported.

## Schema separation and fixtures

The initial profile deploys only `20261031154500_slice_2_2_foundation` and runs only
`database-migration.test.ts`. Full deploys the 18 checksum-pinned migration files with the locked Prisma CLI. Independent ledger,
schema and privilege verification must succeed before fixtures or tests. There is no direct-SQL fallback.

The initial profile uses `prisma migrate deploy` through `deployFoundation()` in
`scripts/ci/g6a-migration.js`. The locked CLI binary is resolved from
`node_modules/prisma/package.json` and cross-checked against `package-lock.json`. Only the
foundation SQL file and `migration_lock.toml` are staged in a temporary directory; later
migrations are excluded so `migrate deploy` cannot advance further. The temporary staging
directory is removed unconditionally in a `finally` block. After the CLI exits successfully,
`verifyLedger()` queries `public._prisma_migrations` and asserts: exactly one record for the
foundation migration, correct SHA-256 checksum of the SQL file, non-null `started_at` and
`finished_at`, `finished_at >= started_at`, `rolled_back_at IS NULL`, `applied_steps_count > 0`,
and no error log. `verifyTables()` then asserts exactly the nine expected application tables and
no others. No schema push or rewritten migration is used. The child-process environment is
restricted to `PATH`, `DATABASE_URL` and `NOOK_CI_G6A_MIGRATIONS_DIR`; raw CLI output is never
relayed because it may contain credentials or database URLs.

For full only, `seed-fixtures.js` imports the existing preflight first and provisions the M3C owner
and the two legacy inventory login accounts using the existing guarded helper. It completes and
releases its advisory lock before the test process starts. No bootstrap seeding bypasses the guard.
Every integration test retains its own preflight import. Tests run with `--test-concurrency=1`;
lock retry, heartbeat loss termination and secret redaction are unchanged.

## Review limits

Only static validation was authorized. Neither SQL execution, grants on a running server, fixture
login behavior nor suite outcomes have been verified. Existing application/test formatting or test
failures still fail quality/integration normally; CI does not suppress failures or relax checks.
The full suite is stateful and may expose existing failures on a fresh database; do not loosen the
guard or assertions to resolve them. Production migration deployment is outside this CI helper's scope.

GitHub service networking reference:
https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers

Static checks (none connect to PostgreSQL):

```sh
node scripts/ci/check.js
node --check scripts/ci/integration.js
node --check scripts/ci/run-unit.js
node --check scripts/ci/seed-fixtures.js
npx --no-install eslint scripts/ci
npx --no-install prettier --check .github/workflows/ci.yml scripts/ci
git diff --check -- .github/workflows/ci.yml scripts/ci
```

The YAML reader in `check.js` uses js-yaml supplied by the locked ESLint dependency tree.

## Formatting policy and readiness review

The original 33 formatting warnings comprise two authored controllers and 31 Prisma-generated
files. Only the admission and booking controllers were formatted. Generated files remain byte-for-byte
unchanged. No existing Prettier exclusion was found: this is a narrow CI configuration correction,
not a claim that the previous command already excluded these files.

Evidence for treating generated output separately: each file says "This is code generated by Prisma.
Do not edit directly." The Phase 2 implementation plan also states that the generated directory is
not hand-edited (`docs/phase-2-reports/PHASE_2_SLICE_2_2_IMPLEMENTATION_PLAN.md`, risk table).
CI now uses a quoted negative glob, `prettier --check apps/api '!apps/api/src/generated/**'`,
whose sole added exclusion is the Prisma-generated directory. The default Git ignore handling
is retained, including existing build-output exclusions.
Authored source and tests still undergo formatting checks. Root formatting commands remain unchanged.
The static checker asserts the exact CI command and exclusion, preventing accidental widening.

Provisioning now handles idle pg Client error events explicitly: these occur outside query promises
and previously bypassed the sanitized top-level catch. The handler emits only a sanitized error code
and exits unsuccessfully, closing sockets; GitHub service teardown remains responsible for disposable
cluster cleanup. No database lock or heartbeat logic was changed.

G6A execution authorization requirements: `workflow_dispatch` on `g6a.yml`, the `AUTHORIZE_G6A`
input, `GITHUB_JOB=initial-integration`, `RUNNER_ENVIRONMENT=github-hosted`, the
`g6a-disposable` environment approval, and a fresh PostgreSQL 17 service on port 5544. The first
authorized run must verify: role privileges, marker/identity checks, Prisma migration ledger
contents, migration checksum, table set, lock lifecycle and all test assertions. Static review
and offline unit tests cannot establish those database-backed results.

G6A preparation is complete. G6A execution has not been authorized and no database has been
provisioned or connected to by any task in this working tree.

## G6B-2: full-profile Prisma deployment (database-free implementation gate)

This implementation has not established PostgreSQL runtime behavior. G6B-3 requires separate explicit
approval before provisioning, migrations, fixtures or integration execution. Publishing a PR or main
push can make the existing full-integration job eligible after quality; implementation approval does
not authorize triggering it. G6A remains its own manually authorized, foundation-only workflow.

`g6b-migrations.json` is the reviewed immutable 18-name, raw-byte SHA-256 manifest. Files, directory
ordering, symlinks and PostgreSQL provider are checked before staging and after deployment. Any future
history addition/change needs a separately reviewed manifest update; checksums are never regenerated
at runtime. Staging copies exact SQL bytes, including transaction boundaries, without rewriting SQL.

`g6b-prisma.config.ts` reads only `MIGRATOR_DATABASE_URL` and the private staged migration directory.
It never imports dotenv or the root config and never reads the runtime URL. The wrapper resolves
Prisma 7.10.1 from the locked local package, invokes its executable using the current Node, and has no
npx/download fallback. Only PATH, the two dedicated variables and a validated local schema-engine binary path reach the migration child.
The engine path is resolved under this installation using the locked platform helper; missing, linked,
non-executable or version-mismatched engines fail before spawning. A controlled PRISMA_SCHEMA_ENGINE_BINARY
value prevents automatic engine downloading. Ambient Prisma overrides are still rejected.

The full hosted-job contract requires the fixed loopback endpoint and fresh service cluster. A new
CI-only empty-schema preflight validates identities, marker, server fingerprint, PostgreSQL 17,
privileges, ownership and absence of user objects. It does not relax the existing post-migration
integration guard, which cannot accept an empty schema. The cluster identity is compared with the
bootstrap session and both runtime and migrator sessions. A second empty-schema check after acquiring
the migration lock prevents a schema change between preflight and deployment.

The existing SuiteLock state machine and advisory key are used on a dedicated migration connection.
Heartbeat/retry behavior and no-reconnect semantics are preserved. Asynchronous child supervision
keeps heartbeat timers responsive. The detached process group contains the CLI and inherited engine
children. Timeout, signal, spawn failure, output overflow or heartbeat loss stops the group with a
bounded TERM/KILL sequence and verifies disappearance before intentional lock release. Engine output
is counted with a fixed byte ceiling and never relayed. If group termination cannot be established,
no later work runs and no intentional lock release occurs: the process keeps its lock connection
pending the hosted job timeout and disposable-service teardown. This deliberately fails acceptance.

The verifier is a separately generated, masked, temporary service role. It has CONNECT only to the
disposable database, public-schema USAGE and ledger SELECT only. It owns no objects and has no role
memberships, DDL or mutation privileges. Runtime receives no ledger privilege. Ledger reads use a
bounded READ ONLY transaction with a ROLLBACK on both success and failure.

The adapter verifies all eight ledger columns, types, lengths, nullability, defaults, primary key and
owner. The pure verifier groups by migration name, preserves rolled-back attempts and their logs,
rejects unresolved/conflicting states, duplicate IDs/successes, missing/extra names and wrong successful
checksums, and compares epoch-microsecond timestamp strings without JS Date rounding. Return order is
irrelevant; equal consecutive migration boundaries are permitted. Fresh G6B accepts exactly one
successful non-rolled-back record per expected name with empty/null logs and positive supporting step
metadata. Step count is not SQL-statement count or the primary completeness proof. Legitimate recovery
history can be classified but is rejected by the fresh-run acceptance policy. No migrate resolve,
automatic repair or rollback is implemented.

The independent structural contract in `g6b-preflight.js` covers exactly 23 application tables plus
ledger, all reviewed columns/enums, primary and tenant foreign keys, financial CHECK definitions,
partial-index keys/predicates, function bodies/ownership/security settings and enabled trigger wiring.
Expression parsing preserves Boolean grouping while accepting PostgreSQL deparser casts, ANY arrays
and BETWEEN expansion. Unsupported catalog representations fail closed; PostgreSQL acceptance remains
a G6B-3 requirement. This is targeted catalog verification, not a claim of universal drift detection.

Schema acceptance and absence of runtime migration privileges precede application grants. Exact
runtime privileges are checked after grants and before lock release, fixtures or tests. Audit remains
SELECT/INSERT only; other application tables keep SELECT/INSERT/UPDATE and no destructive/DDL rights.
Fixture and test processes acquire the same suite lock themselves, so the migration lock is released
before they start. Full tests remain serial and retain their preflight imports and manifest routing.

On every normal/error exit, managed connections close and bounded postrun catalog checks require zero
target sessions and advisory locks. Remaining database/role/container resources are removed by the
existing GitHub service lifecycle, never by a developer-database utility. Cleanup uncertainty fails the
job. Failure recovery is a new disposable service/database, not continued execution on partial state.

Offline tests: `node --import tsx --test scripts/ci/g6b-migration.test.js scripts/ci/migration-ledger.test.js scripts/ci/g6b-preflight.test.js`.
All process/database boundaries in those tests are injected; no PostgreSQL connection or migration is
executed. G6B-4 acceptance still requires review of separately authorized G6B-3 execution evidence.
