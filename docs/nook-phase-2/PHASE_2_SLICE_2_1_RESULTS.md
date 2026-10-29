# Phase 2 — Slice 2.1 Results (executed 2026-10-29)

**Status:** slice 2.1 was **executed under the owner's D-1 authorisation** (decision log and [MVP plan](PHASE_2_MVP_EXECUTION_PLAN.md)). **Nothing is committed, staged or pushed.** No schema or migration was created. Result words: `PASS` ran and passed · `FAIL` ran and failed · `BLOCKED` cannot run until something else happens · `NOT RUN`.
**Companions:** [Slice 2.1 preflight](PHASE_2_SLICE_2_1_PREFLIGHT.md) · [Decision log](PHASE_2_DECISION_LOG.md) · [MVP execution plan](PHASE_2_MVP_EXECUTION_PLAN.md).

## Confirmed existing decisions

| #   | Fact                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | The owner authorised slice 2.1 execution (D-1) with image tag `postgres:17.11-alpine`, on 2026-10-29, via the question presented in the session. This authorised the actions in the table below. It did **not** authorise a schema, a migration, a commit, a push, or installing packages into the repository. |
| R-2 | **Approval is not verification.** `A3` ("subject to Prisma compatibility verification") is **still unmet** against a running PostgreSQL 17: the spike was database-free by its authorisation. Milestone 0 stays **unaccepted**.                                                                                |

## Results by step

| #   | Step                                       | Result                   | Evidence                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0 | Pre-checks                                 | **PASS**                 | Disk 6.82 GiB (two readings) before the first action; port 5433 free; pinned Node 24.22.1                                                                                                                                                                                         |
| 1.1 | Fix DI under `tsx`, with a regression test | **PASS**                 | New `apps/api/test/di.test.ts` **failed first** with `TypeError: Cannot read properties of undefined (reading 'isAvailable')`, then **passed** after `@Inject(DatabaseService)`. Compiled-build DI still resolves. API tests 5/5                                                  |
| 1.2 | Loopback database route                    | **PASS**                 | `docker compose config` shows image `postgres:17.11-alpine`, host IP `127.0.0.1`, published `5433`, target `5432`. Legacy guard still 22/22                                                                                                                                       |
| 1.3 | Database tooling guard                     | **PASS**                 | `scripts/db_guard.py` and `scripts/test_db_guard.py`: tests **failed first** (guard absent), then 13/13 pass. Allows the `.env.example` URL; refuses port 5432, empty URL, non-loopback hosts, other database names, overriding query parameters; never prints the password       |
| 1.4 | Prisma compatibility spike                 | **PASS** (database-free) | See [spike results](#spike-results). A failed spike would have been a valid result; this one succeeded                                                                                                                                                                            |
| 1.5 | Start the project's database               | **PASS**                 | Container `nook-postgres-1` **healthy**; published `127.0.0.1:5433->5432/tcp`; only `127.0.0.1:5433` listening; LAN address `172.20.10.3` refused; `pg_isready` accepting. Existing volumes reviewed first: the project's volume did not exist; other projects' volumes untouched |
| 1.6 | API reaches the database                   | **PASS**                 | Compiled build on the pinned Node **and** `tsx` run from `apps/api`: `GET /api/v1/health/database` → `{"status":"ok","dependency":"database"}` HTTP 200, zero errors. This is the path that returned **500** before the fix                                                       |
| 1.7 | Milestone 0 evidence (clean clone)         | **BLOCKED**              | A clean clone needs `npm ci` (about 450 MB). Disk was **4.33 GiB, below the owner's 5 GiB minimum**, so it was not run                                                                                                                                                            |

## Spike results

Location `/Users/atharva/nook-phase2-spike/` (outside the repository, as confirmed in `C4`). Installed **only** the four authorised exact pins: `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.16.3` (156 packages, 326 MB). **No database was contacted by the spike**, and nothing was installed in the repository.

| Step  | Check                                                                                                  | Result (both generators unless noted)                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2    | `npm audit`, `npm audit signatures`                                                                    | **PASS**: 0 vulnerabilities; 156 packages with verified registry signatures; 51 with attestations                                                                                               |
| D3–D4 | Scratch schema with overlapping `organization_id` composite keys; `prisma validate`; `prisma generate` | **PASS** for `prisma-client-js` (writes into `node_modules`) and for `prisma-client` (writes to `./generated/client`)                                                                           |
| D5    | Offline `migrate diff --script`                                                                        | **PASS**: 4 composite foreign keys, **all `ON UPDATE RESTRICT` and `ON DELETE RESTRICT`, none `CASCADE`**, with the composite unique keys. Confirms the explicit `onUpdate: Restrict` fix       |
| D6    | Import and construct the client with the adapter                                                       | **PASS** under `tsx` for both. Typecheck: `prisma-client-js` **PASS**; `prisma-client` flags only my deliberate no-adapter negative test, because its types **require** options at compile time |
| —     | Is the adapter required?                                                                               | **Yes.** Constructing without it throws "A driver adapter is required to connect to your database." (runtime, both generators)                                                                  |

**Inputs this gives the owner's decisions (recommendations, not approvals):**

- **`U-26` generator:** `prisma-client` (explicit output, compile-time adapter requirement, nothing written into `node_modules`) works in 7.10.1; `prisma-client-js` also works. **Recommend `prisma-client`.** Open question for slice 2.2: whether the generated TypeScript compiles cleanly inside `apps/api`'s `tsc` build (not testable without writing into the repository).
- **`A6` condition:** "adapter conditional on spike results" is **met**: the adapter is required. Installing it **in the repository** needs its own step (exact pin, `npm audit`, lockfile review) and was **not** covered by D-1. **Not done.**
- **`A3` condition:** Prisma 7.10.1 generates correct SQL and a working client, but compatibility with a **running PostgreSQL 17** is **not yet verified**. That verification (applying SQL to `nook_dev`, then `XT-20`…`XT-23`) belongs to slice 2.2.

## What changed in the repository (all uncommitted)

| File                                                    | Change                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/api/src/health.controller.ts`                     | Explicit `@Inject(DatabaseService)` (the DI fix)                                                      |
| `apps/api/test/di.test.ts` (new)                        | Regression test, verified red then green                                                              |
| `docker-compose.yml`                                    | Image `postgres:17.11-alpine`; port `'127.0.0.1:5433:5432'`                                           |
| `.env.example`                                          | Port 5433                                                                                             |
| `README.md`                                             | NestJS version corrected to 12.3.2; loopback and port 5432 warning; `prisma:validate` example on 5433 |
| `scripts/db_guard.py`, `scripts/test_db_guard.py` (new) | The database tooling guard and its 13 tests                                                           |
| `docs/nook-phase-2/*`                                   | Decision log, MVP plan, preflight and this report                                                     |

**Not changed:** the legacy scope guard, `package.json`, `package-lock.json`, `apps/api/package.json`, `prisma/schema.prisma`, migrations. I removed one generated `scripts/__pycache__/` directory created by my own test run.

## New findings

| #   | Finding                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-1 | **`tsx` takes its `tsconfig.json` from the current directory.** Run from the repository root it ignores `apps/api/tsconfig.json` and fails ("Parameter decorators only work when experimental decorators are enabled"). Run API code and tests with the working directory `apps/api` (the npm workspace scripts already do). |
| N-2 | **Starting Docker Desktop triggers a macOS administrator prompt** (its privileged-helper step). It waited about four minutes for the owner to answer; I cannot and did not enter credentials.                                                                                                                                |
| N-3 | **Free disk fell from 8.17 GiB to about 4.2 GiB after Docker started.** Docker's own accounting shows our pull added about 29 MB and the existing 2.2 GB of images are other projects'. Swap usage was 9.4 GB of 10 GB, and macOS keeps swap on this volume: a **likely but unproven** cause.                                |
| N-4 | **Other projects' Docker data exists** (volumes `proofline_*`, `pf-recovery-pgdata`; exited containers `proofline-*`, `spidosoft-postgres`, `pf-recovery-pg17`). None was touched. The local `postgres:17-alpine` image is **415 MB uncompressed**, answering the earlier unknown.                                           |
| N-5 | The owner's dev API server on port 3000 was restarted (now PID 19089, previously 44793). I ran my own API instances on ports 3100 and 3101 only and stopped them.                                                                                                                                                            |

## Milestone 0 evidence after this run (`G-02` option a, no waiver)

| ID     | Check                          | State                                                                                                   |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| M0-E01 | Clean-clone setup              | **BLOCKED** (disk below 5 GiB)                                                                          |
| M0-E02 | PostgreSQL healthy             | **PASS, local only**: container healthy, `pg_isready`, API `/health/database` 200                       |
| M0-E03 | Format, lint, typecheck, build | **PASS locally** (not in CI); repo-wide lint and format still fail only on untracked `marketing/`       |
| M0-E04 | Unit and integration smoke     | **PASS locally**: 5 API tests (including the new DI test); web tests pass. **No integration tests yet** |
| M0-E05 | Secret and dependency scans    | **PASS locally**: baseline scanner; spike audit 0. **No CI run**                                        |
| M0-E06 | Clean migration baseline       | **NOT RUN** (no migration approved yet)                                                                 |
| M0-E07 | Two-developer reproducibility  | **NOT RUN**                                                                                             |
| M0-E08 | No real data, no deployment    | **NOT RUN** (needs a recorded review)                                                                   |

**Milestone 0 remains unaccepted.**

## State left running, and what to stop

| Item                                                | State                             | To stop it                                                                                    |
| --------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| Docker Desktop                                      | Running (started on D-1)          | Quit Docker Desktop. Doing so may free swap and disk                                          |
| Project container `nook-postgres-1`                 | Healthy on `127.0.0.1:5433`       | `docker compose stop postgres` (keeps data) or `docker compose down` (keeps the named volume) |
| Spike directory `/Users/atharva/nook-phase2-spike/` | Present, 326 MB of `node_modules` | Delete it when you no longer need the spike (not deleted by me)                               |

## Follow-up, 2026-10-29 ~01:50 IST: recovery and re-verification

| Item                                | Result                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disk                                | **3.92 GiB free, below the owner's 5 GiB minimum**; unchanged after the steps below                                                                                                                                    |
| Nook container                      | Stopped gracefully with `docker compose stop postgres` (exit 0, not OOM-killed). **Data volume `nook_nook_postgres_data` preserved.** Port 5433 released                                                               |
| Docker Desktop                      | Stopped with `docker desktop stop` (no containers were running). This freed **no** disk                                                                                                                                |
| Untouched                           | The unrelated PostgreSQL on 5432 (listing only), other projects' Docker data, the spike directory, all project files                                                                                                   |
| Re-run and passing (Docker stopped) | API tests 5/5, web tests 11/11, typecheck, build, secrets scan, legacy guard 22/22, `db_guard` tests 13/13, `prisma validate`, scoped lint and format                                                                  |
| **Cannot be re-run**                | Database health route, `pg_isready` and container checks (Docker stopped); clean clone (`npm ci`, disk below 5 GiB)                                                                                                    |
| Diff review                         | Tracked diff is exactly the four files reported; new files are the three reported; the legacy guard, manifests, lockfile and Prisma schema are unchanged                                                               |
| Spike, extra check                  | Generated `prisma-client` code has **zero** type errors under the repo's strict flags (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)                                                                       |
| Adapter delta                       | Only `@prisma/adapter-pg` and `@prisma/driver-adapter-utils` are new to the repo lockfile, plus nested `@types/pg` and `postgres-array`. **Not installed** (disk). See [the slice 2.2 plan](PHASE_2_SLICE_2_2_PLAN.md) |

## Unresolved decisions

`D-2`, `D-3`, `D-4` (authentication baseline, data model and roles, scope-guard replacement) are unchanged and still needed by the dates in the MVP plan. Also needed to continue slice 2.1: free disk of at least 5 GiB for the clean-clone evidence, and an instruction for the repository adapter install and for committing.

## Validation still required

| #   | Claim                                                             | Status                                                    |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| V-1 | PostgreSQL rejects cross-tenant inserts                           | **Not run** (slice 2.2)                                   |
| V-2 | Prisma 7.10.1 works against the running PostgreSQL 17             | **Not run** (slice 2.2); the `A3` condition remains unmet |
| V-3 | Generated `prisma-client` code compiles inside `apps/api`'s build | **Not run**                                               |
| V-4 | Clean-clone setup and hosted CI                                   | **BLOCKED** (disk) / **NOT RUN**                          |
| V-5 | The cause of the disk drop                                        | **Not proven** (swap is a likely contributor)             |

## Revision history

| Version | Date       | Change                                                              |
| ------- | ---------- | ------------------------------------------------------------------- |
| 0.1     | 2026-10-29 | Results of slice 2.1 execution under the owner's D-1 authorisation. |
