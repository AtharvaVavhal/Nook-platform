# Phase 2 — Slice 2.1 Preflight Checklist

**Verdict (run 3, 2026-10-29 ~00:56 IST): NOT CLEARED TO BEGIN. Every entry gate that can be evaluated before the slice passes, and exactly one explicit instruction is outstanding: the owner's separate go-ahead to execute slice 2.1 (`D-1` in [the MVP execution plan](PHASE_2_MVP_EXECUTION_PLAN.md)).** Slice 2.1 has not started. Run 2's verdict (NO-GO) is kept in the run history; the owner's decisions of 2026-10-29 changed the picture.

> **Superseded after the owner's D-1 go-ahead (2026-10-29):** slice 2.1 was **executed**; this report describes the state **before** that run. See [PHASE_2_SLICE_2_1_RESULTS.md](PHASE_2_SLICE_2_1_RESULTS.md) for what ran, what passed, and what is `BLOCKED` (the clean-clone evidence, by the owner's 5 GiB disk rule).

Checked against local `main` at `b2a9f0c`. **Writes made in run 3:** the new decision log; three rows in the canonical package register §4 (`ADR-001`, `ADR-003`, `ADR-011`, as the owner authorised); dated status banners and two entry-condition corrections in earlier planning documents; the new MVP execution plan; and this report. **Not changed:** application code, manifests, lockfile, Docker configuration, Prisma schema, migrations, the legacy scope guard. Nothing was installed or pulled; no container or service was started; PostgreSQL was not contacted; nothing was deleted, staged, committed or pushed.
**Source documents:** [Owner decision register](PHASE_2_OWNER_DECISION_REGISTER.md) (nine decision cards, preserved unchanged) · [Decision brief](PHASE_2_DECISION_BRIEF.md) · [Unresolved decisions](PHASE_2_UNRESOLVED_DECISIONS.md) · [Implementation plan](PHASE_2_IMPLEMENTATION_PLAN.md).

Identifiers `G-xx`, `U-xx`, `K-x` are defined in [the register of gates and decisions](PHASE_2_UNRESOLVED_DECISIONS.md); `X-1…X-11` are the discrepancies in [the owner decision register](PHASE_2_OWNER_DECISION_REGISTER.md#discrepancies-between-the-source-documents).

## Run history

| Run | Time (IST)        | Verdict                                       | What it found                                                                                                                                                                                                                                  |
| --- | ----------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-10-29 ~00:30 | **NO-GO**                                     | Disk 1.3 GiB (below 5 GiB); owner approvals 0 of 8; compose unchanged; no spike approval; Milestone 0 evidence open; 11 of 11 discrepancies open                                                                                               |
| 2   | 2026-10-29 ~00:40 | **NO-GO**                                     | **Disk 7.5 GiB (meets 5 GiB).** Everything else re-checked from scratch and **unchanged**                                                                                                                                                      |
| 3   | 2026-10-29 ~00:56 | **NOT CLEARED** (one instruction outstanding) | Owner decisions recorded (`A1`–`A8`, four confirmations, ADR rows). Disk 7.4 GiB (PASS). Protected files identical. Docker still stopped; compose not yet edited; spike and Milestone 0 evidence **not run**; start not yet authorised (`D-1`) |

**Delta from run 1 to run 2:** Preflight B moved from FAIL to PASS. Preflights A, C, D, E and F are unchanged and still FAIL. Nothing was assumed resolved: each item below was re-measured in run 2.

## Run 3 — after the owner's decisions (2026-10-29 ~00:56 IST)

**What changed since run 2:** the owner supplied and confirmed final decisions for `A1`–`A8` and `C1`–`C4`, recorded in [the decision log](PHASE_2_DECISION_LOG.md); the three ADR rows were filled in the canonical register after verifying each approval was explicit and matched the worksheet. **Approval is not verification:** everything below marked `NOT RUN` or `BLOCKED` is verification that has not happened. Run 2's sections that follow are kept as history; where they differ from this section, **this section is current**.

Status words: `PASS` ran and passed · `FAIL` ran and failed · `BLOCKED` cannot run until something else happens · `NOT RUN` has not been run.

| #    | Check                                                    | Result                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Free disk at least the owner's 5 GiB (`C1`)              | **PASS**                                                      | 7.4 GiB free, 97% used, on **two consecutive readings** (~00:56). Re-measure immediately before each Docker start, pull or install                                                                                                                                                                                                                                                          |
| R-2  | Owner decisions `A1`–`A8` recorded                       | **PASS** (recorded)                                           | [Decision log](PHASE_2_DECISION_LOG.md): `APPROVED` with the owner's conditions. **This records approval only**                                                                                                                                                                                                                                                                             |
| R-3  | Three ADR rows in the canonical approval register        | **PASS**                                                      | `ADR-001`, `ADR-003`, `ADR-011` filled; the other 14 rows blank; file still 129 lines; §1 wording and document 09 unchanged; hash before and after recorded in the log                                                                                                                                                                                                                      |
| R-4  | Spike authorisation gates (`A8`: `A3`, `A6`, disk)       | **PASS** (gates met)                                          | `A3` and `A6` approved; disk met. The spike itself is **NOT RUN**: no spike directory exists and nothing is installed                                                                                                                                                                                                                                                                       |
| R-5  | Dependency approval (`U-22`)                             | **PASS** (approved)                                           | `A6` approved; `@prisma/adapter-pg` is conditional on the spike. Nothing installed: no `adapter-pg` under `node_modules/@prisma`; no manifest references it                                                                                                                                                                                                                                 |
| R-6  | Prisma compatibility (`A3` condition)                    | **NOT RUN**                                                   | Condition **unmet** until the spike and the project database. _Preliminary, not the authorised spike:_ in a scratch directory outside the repo, using the installed CLI with no database and no install, `prisma validate` **PASS** and `migrate diff --script` **PASS**, emitting the composite foreign keys as designed                                                                   |
| R-7  | Blocking discrepancies `X-1`, `X-2`, `X-3`, `X-5`, `X-9` | **DECIDED; formally OPEN**                                    | The owner's answers settle each. Documentation corrected for `X-1`–`X-4` in the plan. **Not yet annotated:** `U-20` and finding `S-03` (`X-5`), and the exact image tag (`X-9`). Formal reconciliation is **0 of 12**. `X-6`, `X-7`, `X-8`, `X-10` and `X-11` were not addressed by these decisions; `X-9` still needs its exact tag confirmed and `X-12` (below) needs the owner's reading |
| R-8  | Protected-file hashes and Git                            | **PASS**                                                      | Legacy guard `90150af7…`, compose, `.env.example`, `package.json`, lockfile, `apps/api/package.json`, `prisma/schema.prisma` all identical to baseline. Only untracked directories; **0** tracked changes; `main` still at `b2a9f0c`; nothing staged, committed or pushed                                                                                                                   |
| R-9  | Milestone 0 acceptance evidence                          | **NOT RUN** (3 of 11 met)                                     | Owner chose `G-02` option (a): gather it inside slice 2.1, **no waiver**. `M0-E01…E08` none filled; no hosted CI run exists because nothing is pushed                                                                                                                                                                                                                                       |
| R-10 | Docker availability                                      | **BLOCKED**                                                   | Socket `~/.docker/run/docker.sock` absent and no Docker process. Starting Docker Desktop is part of `D-1` and has not been authorised for execution                                                                                                                                                                                                                                         |
| R-11 | Loopback binding on `127.0.0.1:5433`                     | **Port free: PASS. Edit: NOT RUN. Binding verified: BLOCKED** | Nothing listens on 5433. `docker-compose.yml` still has the bare `'5432:5432'` (edit not authorised for execution). The unrelated PostgreSQL 16 on 5432 was not contacted                                                                                                                                                                                                                   |
| R-12 | Image tag (`C3`)                                         | **PENDING owner**                                             | The owner chose "minor-version tag" without a value. `postgres:17.11-alpine` was verified to exist and shares the digest of `17-alpine`; it is **proposed** for the owner to confirm                                                                                                                                                                                                        |
| R-13 | Separate explicit instruction to start slice 2.1         | **NOT GIVEN**                                                 | Required by the owner. This is the one outstanding item                                                                                                                                                                                                                                                                                                                                     |

**New discrepancy `X-12` (found in run 3).** The register's "next safe gate" asks that the loopback-binding check **passes** before slice 2.1 opens, yet the binding can only be verified **after** the compose edit that slice 2.1 itself performs. Read literally the gate is circular. **Proposed reading, for the owner to confirm inside `D-1`:** port-free, disk and approval are **pre-start** gates (all `PASS`); binding, volume review and health are **in-slice acceptance checks** run before the database accepts connections. The owner's own condition on `A5` ("subject to all isolation and disk checks") is consistent with this reading.

**Verdict.** Entry gates satisfied: disk, decisions, ADR rows, spike gates, dependency approval, protected files. Not satisfied, and not claimed: any verification (Docker, loopback binding, spike result, Prisma compatibility, Milestone 0 evidence). **Slice 2.1 is not cleared to begin until the owner gives the separate go-ahead (`D-1`)**; on that instruction nothing else stands in the way except the reading of `X-12` and the confirmation of the exact image tag, both of which `D-1` asks for. Slice 2.1 was **not started**.

## Confirmed existing decisions

Facts re-measured in run 2.

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                 | How re-checked in run 2                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P-1 | **All nine decision cards are preserved and every one is `PROPOSED`.** The register's "Approval evidence" column is still blank. The register, brief, unresolved-decisions and plan files hash **identically** to the run-1 baseline.                                                                                                                                                                                | `grep` of status lines (9 × `PROPOSED`); SHA-256 against the recorded baseline |
| P-2 | The legacy scope guard is unchanged: SHA-256 begins `90150af7abce2e3a`. So are `docker-compose.yml` (`e3d03c246411dc0b`), `.env.example` (`b1f4c8bd0e34abe5`), `package.json` (`23c82326675b6808`), `package-lock.json` (`5f8cc1caeea66532`), `apps/api/package.json` (`4881055605c29741`), `apps/web/package.json`, `prisma/schema.prisma` (`4e7ce8c679a4e8ba`), `prisma.config.ts` and `.github/workflows/ci.yml`. | `shasum -a 256`                                                                |
| P-3 | `docker-compose.yml` still publishes the bare `'5432:5432'`. `.env.example` and `README.md` line 25 still use port `5432`. `prisma/` still holds only `schema.prisma`: **no migrations**.                                                                                                                                                                                                                            | File contents; directory listing                                               |
| P-4 | Nothing listens on port **5433**. Port **5432** is still held by the unrelated PostgreSQL 16 (PID 885, `127.0.0.1` and `[::1]`). That server was **not contacted**.                                                                                                                                                                                                                                                  | `lsof -nP -iTCP:<port> -sTCP:LISTEN` (lists sockets; makes no connection)      |
| P-5 | The Docker socket `~/.docker/run/docker.sock` **does not exist** and no Docker process is running, so the daemon is stopped. No Docker command that contacts the daemon was run.                                                                                                                                                                                                                                     | `ls` of the socket path; `pgrep`                                               |
| P-6 | Git: `main` is ahead of `origin/main` by **2**; the working tree has only the three untracked directories. **Nothing has been pushed**, so no hosted CI run exists for these commits.                                                                                                                                                                                                                                | `git status -sb`, `git log`                                                    |
| P-7 | `docker-compose.yml` pins `postgres:17-alpine`, a floating tag. PostgreSQL 17 is a supported major until 2029-11-08 (evidence in the register).                                                                                                                                                                                                                                                                      | Register, evidence table                                                       |

## Proposed architecture

The preflight checklist below is a **proposal**. Each part ends in a pass or fail condition. **Nothing in it has been executed.**

### What slice 2.1 is, and is not

Slice 2.1 is the **environment and database foundation** from [the plan](PHASE_2_IMPLEMENTATION_PLAN.md#slice-21--environment-and-database-foundation). It writes **no schema and no migration**. Its exit is a project-dedicated PostgreSQL reporting healthy through the API, a throwaway spike result for Prisma, and the Milestone 0 evidence that was missing.

Files that slice 2.1 would change **after approval** (none changed now): `docker-compose.yml` (ports line), `.env.example` (port), `README.md` (setup text), a new database tooling guard under `scripts/`, and evidence documents. Package manifests change **only** if the spike shows the adapter is required, and then only through a separately approved, one-package-per-commit install.

### Preflight A — Required owner decisions

The register's [next safe gate](PHASE_2_OWNER_DECISION_REGISTER.md#next-safe-implementation-gate) requires the eight owner inputs below. **None is given.** `U-01`, `U-27` and `G-04` are **not** needed for slice 2.1.

**Re-checked in run 2, where an approval would actually appear:**

| Instrument                                                                              | Result                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Canonical package register, `10_…APPROVAL_REGISTER.md` §4 (the owner's approval record) | **0 of 17 rows** contain any value               |
| Owner sign-off checklist, `11_…`                                                        | **0** ticked items                               |
| Corrections disposition table, `12_…` §14                                               | **0** dispositions filled                        |
| All 44 requirements-package files in the three locations                                | **0 changed** since the 2026-10-29 hash snapshot |
| A decision log or approval file created after run 1                                     | **None** found                                   |
| This repository's register, "Approval evidence" column                                  | Blank for all nine                               |

| #   | Required before slice 2.1                                                                      | Needed status                | Current    | Owner evidence |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------- | ---------- | -------------- |
| A1  | `U-23` canonical requirements package (`NIVASA_PACKAGE_v0.2`)                                  | `APPROVED`                   | `PROPOSED` | None           |
| A2  | `ADR-001` backend architecture                                                                 | `APPROVED` (register §4 row) | `PROPOSED` | None           |
| A3  | `ADR-003` database and ORM, with the proposed amendments                                       | `APPROVED` (register §4 row) | `PROPOSED` | None           |
| A4  | `ADR-011` local development and CI, with the proposed amendments                               | `APPROVED` (register §4 row) | `PROPOSED` | None           |
| A5  | `U-20` isolated Docker PostgreSQL, loopback, port 5433                                         | `APPROVED`                   | `PROPOSED` | None           |
| A6  | `U-22` dependency list, including `@prisma/adapter-pg@7.10.1`                                  | `APPROVED`                   | `PROPOSED` | None           |
| A7  | `G-02`: gather Milestone 0's missing evidence **inside** slice 2.1, **or** waive it in writing | A written choice             | Undecided  | None           |
| A8  | `U-26`: authorise the Prisma compatibility spike (location, disk, scope below)                 | A written authorisation      | Not given  | None           |

Further owner inputs these decisions imply and the register does not yet fix: **(a)** confirm the free-space threshold number (5 GiB, as instructed, stated as the minimum); **(b)** confirm host port **5433**; **(c)** choose the image-tag precision (a minor-version tag or a digest, `X-9`) for when `docker-compose.yml` is edited; **(d)** confirm the spike's throwaway location.

**Gate result: A1–A8 = 0 of 8 satisfied. FAIL (pending the owner). Unchanged from run 1.**

### Preflight B — Free-space threshold: 5 GiB minimum

**Rule:** before any Docker start, image pull or dependency install, the data volume must have **at least 5 GiB free**, using `df -h /System/Volumes/Data`. Re-measure **immediately before each** of those actions, not once. The go condition is two consecutive readings at or above 5 GiB, the latest taken just before the action.

| Reading (2026-10-29)                | Free        | Used | Meets 5 GiB? |
| ----------------------------------- | ----------- | ---- | ------------ |
| Start of the decision-register task | 2.7 GiB     | 99%  | No           |
| After writing the register          | 1.3 GiB     | 100% | No           |
| Run 1 (~00:27 to ~00:35)            | 1.2–1.3 GiB | 100% | No           |
| Owner-reported before run 2         | 7.5 GiB     | —    | Yes          |
| **Run 2, reading 1 (~00:36)**       | **7.5 GiB** | 97%  | **Yes**      |
| **Run 2, reading 2 (~00:40)**       | **7.5 GiB** | 97%  | **Yes**      |

**Current result: 7.5 GiB free against a 5 GiB minimum, on two consecutive readings. PASS, with 2.5 GiB of margin.** The used figure fell from 195 GiB to 188 GiB between runs, so about 7 GB was freed; **this task did not free it and did not delete anything.** What was freed was not identified.

Cautions, because this item changed once already and can change again:

- The same volume fell from 2.7 GiB to 1.2 GiB within about an hour earlier today, and recovered to 7.5 GiB afterwards. **The reading is volatile.** It must be taken again immediately before each action, and the action must be refused if it falls below 5 GiB.
- A pass here means "the threshold is met", not "the operation is safe". The compressed `postgres:17-alpine` image is about 109.7 MiB (arm64); its uncompressed size and Docker's own growth are unknown. After a start or pull, re-measure and record the figure.
- **Protected:** `~/.npm/_npx/8003d8991b0d346b` holds the `puppeteer-core` used for Phase 1 browser QA and must be preserved by any cleanup.
- Run-1 observations about `~/Library/Caches` (9.1 GB → 11 GB) are **superseded** and were not re-measured; they are not evidence of the recovery.

**Gate result: PASS (changed from run 1). Re-measure before each action.**

### Preflight C — PostgreSQL loopback binding on port 5433

**Proposed mapping (not applied):** `127.0.0.1:5433:5432` in `docker-compose.yml`, replacing the bare `'5432:5432'`. The unrelated PostgreSQL 16 keeps port 5432 and is never used by this project without separate written consent.

| #   | Check                                                 | Pass condition                                                                                                            | Run 2 result                                                                   |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| C1  | Port 5433 is free before the change                   | `lsof -nP -iTCP:5433 -sTCP:LISTEN` prints nothing                                                                         | **Pass** (re-measured, nothing listening)                                      |
| C2  | Compose mapping names the loopback host address       | `docker compose config` shows `host_ip: 127.0.0.1`, `published: "5433"`, target `5432`. Never `0.0.0.0` or a bare mapping | **Fail**: the file still has `'5432:5432'` (hash `e3d03c24…` unchanged)        |
| C3  | After start, the listening socket is loopback only    | `lsof` shows `127.0.0.1:5433` and **not** `*:5433`                                                                        | Not run (daemon stopped)                                                       |
| C4  | Not reachable from another interface                  | A connection attempt to the machine's LAN address on 5433 is refused                                                      | Not run                                                                        |
| C5  | Port 5432 stays untouched                             | No project file, URL or tool references 5432 after the change; the tooling guard refuses 5432                             | **Fail**: `.env.example`, `README.md` line 25 and compose still reference 5432 |
| C6  | Existing Docker volumes reviewed before any `down -v` | `docker volume ls` reviewed; `nook_postgres_data` checked for prior data                                                  | Not run (daemon stopped, socket absent)                                        |
| C7  | Health through the API                                | `pg_isready -h 127.0.0.1 -p 5433` succeeds, and `GET /api/v1/health/database` returns `ok`                                | Not run                                                                        |
| C8  | Image tag precision decided (`X-9`)                   | Owner chooses minor-tag or digest pin, recorded in the register                                                           | Undecided                                                                      |

Also needed with the change: `.env.example` and `README.md` port edits, and a tooling guard that refuses non-loopback hosts, port 5432 and unexpected database names. Those are slice 2.1 work after approval.

**Gate result: C1 pass; C2–C8 not satisfied. FAIL. Unchanged from run 1.** The loopback change cannot be made until the owner approves `U-20` and the edit is authorised.

### Preflight D — Prisma adapter approval and the compatibility spike

**Approval first.** The spike installs `@prisma/adapter-pg@7.10.1` (registry: Apache-2.0; dependencies `@prisma/driver-adapter-utils`, `@types/pg`, `pg`, `postgres-array`; `pg` is already installed at `8.16.3`). That is a dependency install, so **A6 (`U-22`) must be approved before the spike** (`X-3`). It is installed **only in a throwaway directory outside the repository**, never in the repository manifests.

**Re-checked in run 2:**

| Check                                                                                         | Result                                             |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `@prisma/adapter-pg` installed in the repository                                              | **No.** `node_modules/@prisma` has no `adapter-pg` |
| Any reference to `adapter-pg`, `zod` or `cookie` in `package.json` or `apps/api/package.json` | **None** (0 matches)                               |
| A throwaway spike directory exists                                                            | **None** found                                     |
| `U-22` approval or `U-26` authorisation recorded                                              | **None** (register blank; no decision log)         |
| A Prisma client has been generated                                                            | No (`node_modules/.prisma` absent, as before)      |

**Spike protocol (proposed, not executed):**

| Step | Action                                                                                                                                                                                             | Records                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| D1   | Check free space (Preflight B). Create the throwaway directory at the owner-approved location, **outside the repository**.                                                                         | Free space before and after                                     |
| D2   | Install **exact** versions there: `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.16.3`. Never run an unpinned `npx prisma` (`S-01`).                                 | `npm ls`, `npm audit`, `npm audit signatures`                   |
| D3   | Write a **scratch** schema with the composite-foreign-key pattern from the [data model](PHASE_2_DATA_MODEL.md#composite-foreign-key-pattern), including **overlapping `organization_id` columns**. | The scratch schema                                              |
| D4   | `prisma validate`, then generate the client with **each** candidate generator (`prisma-client-js` and `prisma-client`) (`U-26`).                                                                   | Pass or fail per generator, and any error text                  |
| D5   | Generate migration SQL **without a database** (`migrate diff` from empty to the schema, as a script). Inspect the SQL for the composite keys.                                                      | The SQL; whether overlapping keys are emitted correctly (`V-1`) |
| D6   | Import the generated client from a TypeScript file and typecheck it under `tsc` and run it under `tsx`, constructed with the adapter but **not connected**.                                        | Whether the client imports and constructs (`V-4`)               |
| D7   | Record the result, free space after, and what was installed. Leave the directory in place until the owner says to remove it.                                                                       | The spike report                                                |

**The spike must not:** touch the repository, its manifests or lockfile; connect to any database (the existing PostgreSQL 16 included); start a container; or read real data.

**Cannot be proven by this spike (needs the project's own PostgreSQL, so later):** that PostgreSQL **rejects** a cross-tenant insert (`V-2`), that partial indexes, `CHECK`s and the audit trigger survive migration without drift (`V-3`), and that the application role cannot alter audit rows (`V-7`).

**Pass condition:** the generator choice and adapter requirement are decided from evidence (`U-26`); `@prisma/adapter-pg` is shown required or not; overlapping composite keys either work or the schema pattern is amended. **A failure is a valid result** and changes the data model, not the schedule.

**Gate result: approval (A6) and authorisation (A8) not given; spike not run; adapter not installed. FAIL. Unchanged from run 1.** The newly met disk threshold does **not** authorise the spike.

### Preflight E — Missing Milestone 0 acceptance evidence (`G-02`)

Package document 13 §7 says "M0 is accepted only when **all** applicable items below are evidenced". Status against each, re-assessed in run 2. **No new evidence was produced between runs**, so no criterion changed.

| #    | Milestone 0 criterion (`13_…` §7)                                                                                        | State in run 2                                                                                                                                                                                                                                               | Closed by                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| E-1  | Architecture decisions and corrections approved or deferred with named owners                                            | **Not met.** Register §4 (0 of 17), checklist (0 ticks) and corrections (0 of 17) are blank (`G-01`, `G-05`)                                                                                                                                                 | A1–A4, and `G-05`                                 |
| E-2  | Toolchain and dependency versions pinned and documented                                                                  | **Met.** Pinned in `package.json`, `.nvmrc`, `.node-version`; documented in `README.md`                                                                                                                                                                      | Already evidenced                                 |
| E-3  | Clean-clone setup works and does not rely on hidden machine state                                                        | **Not run**                                                                                                                                                                                                                                                  | A clean clone and install (`M0-E01`)              |
| E-4  | Local PostgreSQL starts reliably and the app and tests can connect                                                       | **Not met.** Docker socket absent, no daemon, nothing on 5433; `/health/database` last reported `degraded`                                                                                                                                                   | Preflights B, C and C7 (`M0-E02`)                 |
| E-5  | Formatting, lint, typecheck, unit tests, build, integration smoke tests, secret scan and dependency checks run **in CI** | **Local only.** Local runs of tests, typecheck, build, secrets and scope exited 0 earlier (not re-run in this pass); repo-wide lint and format exit 1 on **untracked** `marketing/` files. **CI never run** (nothing pushed); **no integration tests exist** | A hosted CI run on a clean clone (`M0-E03`–`E05`) |
| E-6  | CI uses synthetic or local credentials only                                                                              | **Plausible, unverified.** `ci.yml` (unchanged) uses the placeholder `nook_local_only`; no CI run to inspect                                                                                                                                                 | A CI run                                          |
| E-7  | No real resident data, documents, bank or UPI references anywhere in repo, tests, CI logs, fixtures                      | **Not independently verified.** The baseline scanner passed earlier; no real data is known. A review is required, not just a scan                                                                                                                            | A recorded review (`M0-E08`)                      |
| E-8  | No production deployment or real-data import has occurred                                                                | **No evidence of any.** None performed in this work                                                                                                                                                                                                          | A recorded review (`M0-E08`)                      |
| E-9  | No rent calculation, billing, allocation, deposit or settlement behaviour implemented                                    | **Met today** (no models, no migrations, no such code)                                                                                                                                                                                                       | The Phase 2 scope guard keeps it so               |
| E-10 | No final domain schema without separate approval                                                                         | **Met today** (`prisma/` holds only the datasource-only `schema.prisma`)                                                                                                                                                                                     | Same                                              |
| E-11 | Setup guide, failure-recovery or reset notes, CI evidence and known limitations reviewed                                 | **Partial.** `README.md` has setup steps; reset notes and CI evidence are missing                                                                                                                                                                            | Slice 2.1 documentation                           |

Evidence-record rows `M0-E01…E08` from package document 13 §9: **none is filled in.** Partial evidence outside CI, from earlier work and **not re-run here**: on 2026-10-28 the built API served `GET /api/v1/health` (200) and reported `degraded` for the database route; the live `npm audit` reported 0 vulnerabilities on 2026-10-29 00:02.

**The `G-02` choice (A7):** (a) **gather the missing evidence inside slice 2.1** (the plan's approach), accepting that M0 stays unaccepted until it exists; or (b) **waive** it in writing, which the package does not describe as a normal path. This checkpoint recommends nothing beyond the plan's existing (a).

**Gate result: E-2, E-9, E-10 met; E-1, E-3 to E-8 and E-11 open. FAIL. Unchanged from run 1.**

### Preflight F — Discrepancy tracker (all eleven, none reconciled)

Source: [the owner decision register](PHASE_2_OWNER_DECISION_REGISTER.md#discrepancies-between-the-source-documents). **"Reconciled" means the owner has confirmed the resolution in writing and every affected source document has been updated or carries a dated annotation, by a separately approved documentation change.**

**Re-check in run 2:** the register, brief, unresolved-decisions and plan files are **byte-identical** to the run-1 baseline, and no owner confirmation exists anywhere. So **no discrepancy was reconciled between runs.**

| #    | Discrepancy (short)                                                                                               | Resolution used in the register                                                      | Blocks slice 2.1?               | Action to reconcile                                          | Run 2 status |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------ | ------------ |
| X-1  | Slice 2.1 entry conditions: plan lists `G-01`, `G-02`, `U-20`, `U-22`, `U-26`; brief's table omits `G-02`, `U-26` | Plan is the fuller list; this checklist uses it (A7, A8)                             | **Yes**                         | Owner confirms; annotate the brief's approval table          | **OPEN**     |
| X-2  | `U-26` is both an entry condition and slice 2.1 work                                                              | Owner **authorises** the spike (entry); its **result** closes `U-26` (exit)          | **Yes**                         | Owner confirms the reading; amend the plan wording           | **OPEN**     |
| X-3  | The spike needs an install while installs are "not yet approved"                                                  | `U-22` approved before the spike (A6 precedes D2)                                    | **Yes**                         | Owner confirms order                                         | **OPEN**     |
| X-4  | Slice 2.5 entry omits `G-03`, `U-13`, `U-14`, `U-15`                                                              | Decision 9 states them as explicit gates                                             | No (slice 2.5)                  | Update the plan's slice 2.5 entry                            | **OPEN**     |
| X-5  | Loopback binding missing from `U-20` and security finding `S-03`                                                  | Loopback is a condition of Decision 6 (C2, C3)                                       | **Yes**                         | Update `U-20` and `S-03`; owner confirms                     | **OPEN**     |
| X-6  | Scope-guard proposal grew from S1–S12 to S1–S14                                                                   | Register lists S1–S14, marking S13–S14 as additions                                  | No (slice 2.2)                  | Owner confirms the two additions; update the brief           | **OPEN**     |
| X-7  | "Do not disable" versus "leave unmodified": the legacy guard leaves CI                                            | It leaves CI only in the approved change adding the first migration; S13, S14 hold   | No (slice 2.2)                  | Owner acknowledges the consequence explicitly                | **OPEN**     |
| X-8  | Node LTS status was "not verified" in the brief; now evidenced (24 in Maintenance LTS; 26 became LTS)             | Recorded as evidence; no Node change proposed                                        | No                              | Annotate the brief's conformance row                         | **OPEN**     |
| X-9  | `ADR-011` says "pinned" but compose uses the floating `postgres:17-alpine`                                        | Amendment 2 on Decision 4; owner picks minor tag or digest                           | **Yes** (compose edit needs it) | Owner chooses (C8); record in the register                   | **OPEN**     |
| X-10 | Handbook calls v0.2 "approved"; package calls itself "Proposed; not approved"                                     | Treated as **not approved**                                                          | No                              | Correct the handbook wording when regenerated (out of scope) | **OPEN**     |
| X-11 | Brief says "seven blockers"; register lists nine items                                                            | Not a conflict (the ADR blocker is three ADRs; `U-23` and `G-04` counted separately) | No                              | Annotate the brief with the 1–9 numbering                    | **OPEN**     |

**Tally: 11 tracked, 0 reconciled, 11 open. Five of them block slice 2.1** (`X-1`, `X-2`, `X-3`, `X-5`, `X-9`), because each changes what is approved or what the compose edit must say. **Unchanged from run 1.**

### Preflight G — Overall go or no-go

| Part | Subject                       | Run 1              | **Run 2**                                    |
| ---- | ----------------------------- | ------------------ | -------------------------------------------- |
| A    | Owner decisions (8 required)  | FAIL (0 of 8)      | **FAIL** (0 of 8)                            |
| B    | Free space ≥ 5 GiB            | FAIL (1.3 GiB)     | **PASS** (7.5 GiB, two readings)             |
| C    | Loopback binding on port 5433 | FAIL (1 of 8)      | **FAIL** (1 of 8; no edit made)              |
| D    | Adapter approval and spike    | FAIL               | **FAIL** (approval not given; not installed) |
| E    | Milestone 0 evidence          | FAIL (3 of 11 met) | **FAIL** (3 of 11 met)                       |
| F    | Discrepancies reconciled      | FAIL (0 of 11)     | **FAIL** (0 of 11; 5 block slice 2.1)        |
| —    | **Overall**                   | NO-GO              | **NO-GO. Stop and wait for owner approval.** |

**One of six preflight parts passes. The pass does not move the verdict:** the remaining five need the owner's decisions or authorised edits, none of which exist.

### Guardrails that apply throughout slice 2.1

- The nine decisions stay `PROPOSED` until the owner approves them in their own instrument. A passing preflight part does not approve anything.
- No change to application code, manifests, lockfile, Prisma schema, migrations or the legacy scope guard in this slice, except the specific edits listed above after approval.
- Never connect to PostgreSQL on port 5432. Never run `prisma migrate dev` against anything but a disposable project database.
- Never delete files, volumes or caches without the owner's explicit instruction, and never the protected Puppeteer cache.
- No commit and no push without a separate instruction.

## Unresolved decisions

All nine register decisions, plus `G-02` (A7) and the `U-26` spike authorisation (A8), are unresolved. Also open and **not** needed for slice 2.1: `G-03`, `G-05`, `G-06`, `U-02` to `U-19`, `U-21`, `U-24`, `U-25`. See [the register](PHASE_2_UNRESOLVED_DECISIONS.md).

## Validation still required

| #   | Claim                                                                                    | Status (run 2)                                                          |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| V-A | All nine decision cards remain unchanged and `PROPOSED`                                  | **Verified** by hash and `grep`                                         |
| V-B | Free space reaches 5 GiB                                                                 | **Met** (7.5 GiB, two readings). **Re-measure before each action**      |
| V-C | The compose file publishes on loopback only, on 5433                                     | **Not done.** File unchanged                                            |
| V-D | `@prisma/adapter-pg` is required and works with the chosen generator                     | **Not run**                                                             |
| V-E | Milestone 0 evidence rows `M0-E01…E08`                                                   | **None filled**                                                         |
| V-F | Discrepancies `X-1…X-11` reconciled                                                      | **0 of 11**                                                             |
| V-G | Local checks (tests, typecheck, build, lint, format, secrets, scope) re-run in this pass | **Not re-run.** Earlier results stand; not needed to settle the verdict |

Preservation check, 2026-10-29: the first sixteen hexadecimal characters of each file's SHA-256 were identical between run 1 and run 2 for `PHASE_2_OWNER_DECISION_REGISTER.md` (`d71b1ea3c3ba17c3`), `PHASE_2_DECISION_BRIEF.md` (`e9effae142d87340`), `PHASE_2_UNRESOLVED_DECISIONS.md` (`b9bb3e8009e3bb3f`) and `PHASE_2_IMPLEMENTATION_PLAN.md` (`dfebb0924e691a16`). The legacy guard remained `90150af7abce2e3a`.

## Revision history

| Version | Date       | Change                                                                                                                                               |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | 2026-10-29 | Initial preflight checklist for slice 2.1. NO-GO. No source document edited.                                                                         |
| 0.2     | 2026-10-29 | Run 2. Free space re-measured at 7.5 GiB (two readings): Preflight B now PASSES. All other items re-checked from scratch and unchanged. Still NO-GO. |
