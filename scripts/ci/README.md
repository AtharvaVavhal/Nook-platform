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

Both `initial-integration` and `full-integration` depend on `quality`. They run independently on
separate GitHub-hosted runners with separate PostgreSQL 17 services, no shared storage or database
artifacts, and 30-minute job timeouts. Host bindings are loopback-only. GitHub owns service cleanup.
No self-hosted runner, existing database, arbitrary URL, or operator-specified endpoint is accepted.

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
`database-migration.test.ts`. Full applies every checked-in migration directory in sorted order
via direct SQL, one transaction per file. Failed migration setup prevents all test execution.

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
