# NOOK Launch Roadmap

Phase 2H.8. Planning document only. Nothing in this file has been executed. No source, database, environment variable,
role, migration, Docker resource or deployment was touched while writing it.
Companion: `NOOK_BLOCKER_REGISTER.md` (blocker IDs `BLK-nn`). Task IDs here are `<phase letter>-nn`.

Written 2026-11-03 from repository inspection (read-only) on branch `feature/phase-3-core-workflows`.

---

## 0. Read this first

### 0.1 Readiness assessment (corrected framing)

| Measure | Value | Status |
|---|---|---|
| Raw weighted score | **76.75%** | Taken from the task brief ("according to the audit's own weights"). Could not be recomputed: see 0.2. |
| Adjusted score | **72%** (as previously reported) | **Adjustment is unexplained.** The brief states a 7-point disk-space deduction is not mathematically justified. Note also that 76.75 to 72 is a 4.75-point gap, so a 7-point deduction does not reconcile with the two reported scores either. The audit's working is needed to explain the difference. |
| Independently verified launch readiness | **Not yet established** | No replacement score is offered. None can be derived honestly until the P0 items below are verified. |

Completing these two documents does **not** make Nook launch-ready.

### 0.2 Evidence limits and corrections to the brief

These were found while inspecting the repository. Each is a place where the brief and the repo disagree or where evidence is missing.

| # | Finding | Effect |
|---|---|---|
| 1 | `NOOK_LAUNCH_READINESS_AUDIT.md` **does not exist** in the repo, in git history (`git log --all`), or under `~/Downloads`, `~/Desktop`, `~/Documents`. | Audit figures (scores, 2.7 GiB, six invoices) are taken from the brief and are **unverified against source**. Tracked as BLK-22. |
| 2 | **Invoice scheduler is implemented in code** (`apps/api/src/jobs/*`, `docs/ops/INVOICE_SCHEDULER.md`), tested only on an isolated scratch database. It is **not deployed, not scheduled, not enabled**, and the code is uncommitted. | The brief's "not implemented" is imprecise. Treated as "not operational" (BLK-06). |
| 3 | **Scope guard today: 17 of 18 checks pass; 1 fails** (`S1 no real .env file`). The brief says three failures. | The audit may have run at a different working-tree state. Two failures cannot be located. Not auto-fixed. BLK-12. |
| 4 | Free space on the Data volume (`/System/Volumes/Data`) measured at **1.7 GiB (100% capacity)** at the start of this session, lower than the audit's 2.7 GiB. | Still below the 5 GiB heavy-work threshold. No tests or builds were run. BLK-05. |
| 5 | **Login throttling and auth audit events exist** (`apps/api/src/auth/throttle.service.ts`, `auth.service.ts`) and a change-password page exists. `docs/nook-phase-3/PILOT_ACCOUNT_REQUIREMENTS.md` says they do not, so it is stale. | The "missing rate limiting" blocker narrows to *general* API rate limiting (BLK-13). |
| 6 | `helmet()` is applied in `apps/api/src/app.setup.ts` with default options. No explicit CSP/HSTS configuration is present, the web app has no `vercel.json`, and **no live response header has been observed**. | BLK-14 is "unconfigured and unverified", not "absent". |
| 7 | CI runs `test:database` against a CI Postgres service. The visible workflow does **not** run `test:integration`. | The integration suite is not enforced in CI (BLK-17). |
| 8 | The two finance docs state the paid-amount invariant in **two different forms**: `TASK_4F_FINANCE_PLAN.md` (paid = cash net of reversals plus applied credits, adjustment total <= 0) and a later line (paid = sum of non-reversed payments minus adjustment total). The sign convention needs independent resolution (task B-02). | The correct invariant is **not** assumed here. |
| 9 | There is **no repo evidence** for the six drifting invoices or the original payment anomaly. The only finance-data evidence is `INV_2099_9999_REMEDIATION_PROPOSAL.md` (one scratch-DB legacy conflict, a different issue). | BLK-01 and BLK-02 root causes are unknown. |
| 10 | A local `.env` that points at `nook_dev` exists (auto-memory: starting `dist/main.js` loads it). It is the likely, **unproven**, trigger of scope-guard S1. | Hazard for test isolation. BLK-23. |
| 11 | Hosting is only partly decided (ADR-010 open). Backups: "restore readiness is NOT established" per `docs/ops/BACKUP_RESTORE.md`. Sentry: "no event has ever been sent". Web/API topology: "not yet verified on live Vercel/Railway". | Matches the brief. BLK-09, 10, 11. |
| 12 | Out of scope per `PHASE_3_SCOPE_REGISTER.md` and the scope guard vocabulary: payment gateway, OTP, SMS/WhatsApp, KYC/Aadhaar, document upload. **Phase F therefore needs owner scope approval before any code.** | Phase F tasks start with an approval task (F-01). |

### 0.3 Priority and gate definitions

| Priority | Meaning |
|---|---|
| **P0** | Must be **Verified before pilot start** (Gate G3). No P0 task may be deferred into the pilot. |
| **P1** | Required before **expansion beyond the first pilot cohort** (Gate G4), or before the specific feature it covers is switched on. May run during the pilot. |
| **P2** | After pilot evidence; scale-up and polish. |

Gates:

| Gate | Condition |
|---|---|
| **G0** | Disk >= 8 GiB free, Docker and PostgreSQL healthy (Phase A). |
| **G1** | Financial correctness independently verified and signed off (B-12). **No real payment is recorded or accepted before G1.** |
| **G2** | Production infrastructure verified, including a **successful restore drill** (G-10) and rollback rehearsal (G-15). **No production launch before G2.** |
| **G3** | Pilot go/no-go (H-06): every P0 task Verified, written owner approval. Pilot starts with **10-20 residents** at one hostel. |
| **G4** | Expansion to 40-50 beds: pilot evidence review (H-09) passes, including a complete billing cycle. |
| **G5** | Expansion to 100 beds: evidence from the 40-50 stage (H-11) passes. |

### 0.4 Task status vocabulary

`Not started` / `In progress` / `Blocked` / `Verified`. **Nothing in this roadmap is `Verified`.** Where code already exists
(for example resident management screens), the task is to *verify* it, and its status is `Not started` until evidence exists.
"Effort" is engineering hours only; external waiting is written separately as `+ wait`.
"Approval required" = needs explicit project-owner approval before the work (or its execution step) proceeds.

### 0.5 Safety boundaries that apply to every task

- Integration tests run **only** against approved scratch databases. **Never** `nook_dev`, `nook_test` or production.
- No heavy test, build, `docker pull` or image build while free space is below 8 GiB (the formal planning threshold is 5 GiB; 8 GiB is the recovery target).
- Financial rows (`invoices`, `payments`, reversals, adjustments, voids, `audit_events`) are never edited, backfilled or deleted by SQL. Any correction goes through audited application paths with separate explicit approval.
- Never print, log or commit credentials or connection strings. Evidence files record database **names** and roles only.
- Do not delete projects, Application Support data, databases or Docker volumes.
- Scope-guard failures are never auto-fixed.

---

## 1. Dependency overview

```
A (disk, Docker, PG) ──► C (scratch roles, real-PG integration) ──► B (financial integrity) ──► G1 ─┐
        │                          │                                                                  │
        │                          └──► D (security, tenancy) ────────────────────────────────┐       │
        └──► E (core workflow verification) ─────────────────────────────────────────────────┐ │       │
                                                                                              ▼ ▼       ▼
F (resident features: own scope approval, mostly P1) ───────────────────────► G (production infra) ──► G2 ──► H ──► G3 pilot
```

Investigation work in B (read-only forensics) can start once A is done; B's *verification* tasks need C's real-PostgreSQL runs.

### Critical dependency chain (P0 path to pilot)

`A-03` free >= 8 GiB → `A-04` Docker/PG healthy → `C-01/C-02` guard + role design (owner approval) → `C-03` scratch roles → `C-04` fixture split → `C-05/C-06` unit and integration runs → `C-07..C-11` rollback, concurrency, idempotency, locking → `B-02/B-03` invariant defined and independently verified → `B-04/B-05/B-06` six-invoice forensics, anomaly, read-after-write review → `B-07/B-08` lifecycle and audit verification → `B-09/B-10` owner decision and approved remediation → **`B-12` G1** → `G-01` release baseline → `G-03..G-08` infrastructure → `G-09/G-10` backups and **restore drill** → `G-15` rollback rehearsal → `G-17/G-18` production smoke test and **G2** → `H-06` go/no-go → `H-07` pilot (10-20 residents).

Parallel P0 tracks that must also finish before `H-06`: D (security), E (workflow verification), G-12 (Sentry), D-05/D-07 (rate limiting, headers), BLK-12 scope-guard triage (`T-01`).

### Waiting versus engineering

External or owner-dependent waits are marked `+ wait`: owner approvals, hosting decision (ADR-010), domain/DNS propagation, Railway/Vercel account setup, SMS sender/template registration (India DLT lead times are provider-specific and **not verified here**), payment-gateway onboarding/KYC, and the one-month billing cycle in H-08.

---

## 2. Tasks

Columns: ID | Pri | Description | Dependencies | Files / modules | Acceptance criteria | Verification | Effort (eng. h) | Approval | Status.
Phase is the section heading.

### Phase A: Development environment recovery

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| A-01 | P0 | Record disk baseline: `df` for Data volume and read-only size listing of candidate directories. Measured so far: 1.7 GiB free. | none | host only | Baseline numbers and date recorded in a notes file | Captured command output | 1 | No | Not started |
| A-02 | P0 | Produce a reclaimable-candidates list limited to **regenerable** items (package-manager caches, Homebrew cache, Xcode DerivedData/old simulators, Docker build cache *listed only*, Trash). Explicitly exclude project directories, `~/Library/Application Support`, database data directories and Docker volumes. | A-01 | host only | Each item has size, "regenerable yes/no", and how it regenerates | Owner reviews list | 2 | No | Not started |
| A-03 | P0 | Owner-approved reclamation to **>= 8 GiB free**. Engineering can run approved commands or the owner can do it by hand. | A-02 | host only | Data volume shows >= 8 GiB free; before/after listing proves projects, Application Support, databases and volumes untouched | `df` before/after; `docker volume ls` identical before/after; project directory listing | 1-3 + owner time | **Yes** | Blocked (owner decision) |
| A-04 | P0 | Verify Docker daemon and PostgreSQL health **read-only**: daemon up, container state and healthcheck, `pg_isready`, list database **names**, list volumes (no prune). | A-03 | `docker-compose.yml`, `scripts/db/README.md` | Containers healthy; approved scratch DB names exist; no destructive command run | Captured outputs | 1 | No | Not started |
| A-05 | P0 | Write the "heavy-run gate" rule (no test/build/image pull below 8 GiB free; check `df` first) into the runbook used by later tasks. | A-01 | this file; `docs/ops` | Rule documented and referenced by C-05, C-06 | Doc review | 0.5 | No | Not started |
| A-06 | P1 | Add a disk-space watch step before long runs and a periodic check while Docker volumes grow. | A-03 | runbook | Check documented; threshold agreed | Doc review | 1 | No | Not started |

### Phase B: Financial integrity

No `B-*` task may modify a financial record. Read-only means a `READ ONLY` transaction or equivalent.

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| B-01 | P0 | Locate the six paid-amount-drift invoices: obtain the audit's detection query/source, identify the database(s) and organization(s) where they were observed. Source audit file is missing (BLK-22), so the owner must supply it. | A-04, owner input | none (data read) | Six invoice numbers, organization, and database **name** recorded; detection method reproduced read-only | Read-only output retained; row counts unchanged | 2 | **Yes** (read access to any non-scratch DB) | Blocked (needs audit source) |
| B-02 | P0 | Define the accounting invariant(s). Resolve the two differing formulations in the finance docs against `prisma/schema.prisma`, migration triggers and `finance.service.ts`: exact terms, sign convention for `adjustment_total`, treatment of DRAFT, CANCELLED/void, reversed payments and applied credits. | A-05 | `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/finance/finance.service.ts`, `docs/nook-phase-3/TASK_4F_FINANCE_PLAN.md`, `TASK_4F2_MIGRATION_DESIGN.md` | One-page invariant with each term defined and the sign convention stated | Line-by-line cross-reference to schema, triggers and code | 4 | No | Not started |
| B-03 | P0 | **Independently verify the invariant**: write the reconciliation as raw SQL separate from application code, check it against hand-computed small cases (partial payment, reversal, credit, void, overpayment rejection), obtain owner sign-off. | B-02 | new read-only SQL (future `scripts/ops/`) | SQL result equals hand-computed expectation for every crafted case; owner signs off the definition | Case table with expected vs actual; signed record | 6 | **Yes** (sign-off) | Not started |
| B-04 | P0 | Forensic timeline for each of the six invoices: payments, reversals, adjustments, idempotency keys, audit events, request ids; compute recorded minus recomputed per B-03. | B-01, B-03 | tables `invoices`, `payments`, `payment_reversals`, `invoice_adjustments`, `payment_idempotency_keys`, `audit_events` | For each invoice: drift amount, ordered event timeline, status "explained" or "unexplained" | Evidence pack; no rows modified | 8 | **Yes** | Blocked (B-01) |
| B-05 | P0 | Investigate the original payment-transaction anomaly (no repo evidence of what it was; owner to describe). Reconstruct from audit events, retained logs and git history of `recordPayment`; list hypotheses; test each on scratch. **Do not state a root cause unless reproduced.** | B-04, C-06 | `finance.service.ts` (`recordPayment`, around lines 778-940), `finance.integration.test.ts` | Either reproduced as a failing test on scratch, or documented as not reproduced with residual risk explicitly accepted by owner | Test result or signed risk acceptance | 10-16 | **Yes** | Blocked (B-04, C-06) |
| B-06 | P0 | Review the defensive read-after-write check (`finance.service.ts`, around lines 883-898): does it run in the same transaction; does throwing roll back payment row, idempotency key and audit event; what failure it can catch beyond the row lock; does it hide a cause. Decide keep, replace or supplement with a database-level guard. | B-05 | `finance.service.ts` | Written assessment; a test proves a forced mismatch rolls back everything | Integration test on scratch | 4 | No (design change would need approval) | Not started |
| B-07 | P0 | Validate payment recording, reversals, adjustments (credits only), voids and idempotency: same key and same request replays; same key and different request is refused. Add randomized mixed sequences checked against the B-03 invariant, including concurrent ones. | B-03, C-06 | `apps/api/test/finance.rules.test.ts`, `finance.service.test.ts`, `integration/finance.integration.test.ts` | Invariant holds after every sequence; proposed minimum 1,000 randomized sequences (owner may change the number) | Test log with seed values | 10 | No | Not started |
| B-08 | P0 | Verify audit history is preserved and append-only: every money-moving path writes its audit event in the same transaction; runtime role cannot UPDATE/DELETE payments, reversals, adjustments, voids or audit rows. | B-07, C-03 | migrations (append-only triggers), `finance.service.ts` | Negative tests as runtime role fail as expected | Test log | 5 | No | Not started |
| B-09 | P0 | Remediation **proposal** for the six invoices: options with their effect on invoice balance, reports and audit trail. Proposal only. | B-04 | new doc | Owner has chosen an option or "leave and annotate" | Decision recorded in the decision log | 3 | **Yes** | Blocked (B-04) |
| B-10 | P0 | Execute the owner-approved remediation (if any) through audited application paths only, never direct SQL on financial tables. | B-09 | application finance endpoints | After: the six invoices recompute equal; original rows untouched; new audit events present | B-03 SQL read-only before/after | 2-6 | **Yes** (separate explicit approval) | Blocked (B-09) |
| B-11 | P0 | Build a standing read-only reconciliation report for all invoices and organizations; non-zero exit on drift; used daily in the pilot. | B-03 | future `scripts/ops/` | Zero drift on clean scratch fixtures; seeded drift on scratch is detected | Seeded-drift test | 6 | **Yes** (new script) | Not started |
| B-12 | P0 | **Gate G1.** Written sign-off that B-02..B-11 are Verified. Until signed, no real payment is recorded or accepted and the scheduler stays disabled in any environment holding real data. | B-03..B-11 | n/a | Signed checklist | Owner signature in decision log | 1 | **Yes** | Not started |

### Phase C: PostgreSQL integration verification

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| C-01 | P0 | Review the DB guard and fix the approved scratch-database allow-list: names permitted, names forbidden (`nook_dev`, `nook_test`, anything production-like). | A-04 | `scripts/db_guard.py`, `scripts/test_db_guard.py`, `scripts/db/README.md` | Guard refuses forbidden names in its own unit test | `test_db_guard.py` result | 3 | **Yes** (allow-list) | Not started |
| C-02 | P0 | Design least-privilege roles: (a) migrator/fixture-setup, (b) runtime (what the API and scheduler use), (c) test runner. Grant matrix per table, revoke defaults from PUBLIC, no superuser/CREATEROLE/CREATEDB for runtime, no UPDATE/DELETE on append-only tables. | C-01 | `scripts/db/provision_roles.sql`, `docs/nook-phase-3/TASK_4F_LAYER1_APPROVAL_PACK.md` | Design doc with the grant matrix, owner-approved | Review | 5 | **Yes** | Not started |
| C-03 | P0 | Provision those roles on the **scratch** server only (this executes SQL). | C-02, A-04 | `scripts/db/provision_roles.sql` | Roles exist only on scratch; no production credential reused | Catalog queries for roles and grants | 2 | **Yes** | Blocked (C-02) |
| C-04 | P0 | Separate fixture setup from runtime test privileges: setup helpers use the setup role, assertions use the runtime role; no test needs elevated rights. | C-02 | `apps/api/test/integration/helpers/billing-fixtures.ts`, other helpers | Tests pass with the runtime role; revoking a setup privilege from the runtime role does not break them; removing a needed runtime grant does | Test runs | 8 | No | Not started |
| C-05 | P0 | Run the unit suite once disk >= 8 GiB. | A-03, A-05 | `apps/api/test/*.test.ts` | All pass; counts recorded; failures triaged | Log | 1 | No | Blocked (A-03) |
| C-06 | P0 | Run the full integration suite against the approved scratch DB. | C-03, C-04, C-05 | `apps/api/test/integration/*.test.ts` | All pass or each failure has a recorded triage; DB **name** recorded | Log | 4 | No | Blocked |
| C-07 | P0 | Verify transaction rollback: injected failure mid-payment leaves no payment, idempotency key or audit rows. | C-06 | `finance.integration.test.ts` | Counts before = after for each table | Test | 4 | No | Not started |
| C-08 | P0 | Verify concurrent payment recording: parallel payments on one invoice with distinct keys never overpay; parallel same-key requests create one payment. | C-06 | finance integration | Invoice paid never exceeds amount; exactly one row per key; B-03 invariant holds | Test | 5 | No | Not started |
| C-09 | P0 | Verify idempotency end to end (replay returns the original result; mismatch refused; key scope per organization). | C-06 | finance integration | As stated | Test | 3 | No | Not started |
| C-10 | P0 | Verify invoice numbering lock and invoice row lock; four simultaneous scheduler runs plus manual generation create no duplicates. | C-06 | `invoice-scheduler.integration.test.ts`, `finance.service.ts` | No duplicate numbers or per-booking-month duplicates | Test | 4 | No | Not started |
| C-11 | P0 | Verify bed-allocation concurrency: double booking, double admission and check-in on the same bed under parallel requests. | C-06 | `booking.*`, `admission.*`, `checkin.*`, `inventory` integration tests | Exactly one winner; others receive a conflict; no orphan state | Test | 5 | No | Not started |
| C-12 | P1 | Run `test:integration` in CI with the required-tests flag (visible CI runs only `test:database`). | C-06 | `.github/workflows/ci.yml` | CI job executes the integration suite and fails when skipped | Green run on a branch | 3 | **Yes** (CI change) | Not started |
| C-13 | P1 | Decide the `INV-2099-9999` scratch legacy conflict and run migration-input integrity checks before any migration touches data with legacy invoices. | C-06 | `docs/nook-phase-3/INV_2099_9999_REMEDIATION_PROPOSAL.md`, `FUTURE_MIGRATION_INPUT_INTEGRITY_CHECKS.md` | Owner decision recorded; integrity checks defined | Doc | 4 | **Yes** | Not started |
| C-14 | P1 | Remove the "API loads dev `.env`" hazard: confirm dotenv is not loaded by test or job entry points; document how to run against scratch explicitly. | C-01 | `apps/api/src/main.ts`, `config.ts`, `package.json` scripts | Starting the API or tests cannot silently select `nook_dev` | Review plus test | 3 | **Yes** (source change) | Not started |

### Phase D: Security and tenant isolation

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| D-01 | P0 | Verify authentication, sessions and CSRF: login, logout, idle and absolute timeout, session revocation, password change revokes other sessions; cookies HttpOnly, SameSite=Strict, Secure in production; CSRF required on every state-changing route. | C-06 | `apps/api/src/auth/*`, `app.setup.ts`, `apps/web/src/csrf.ts`, auth and cross-origin integration tests | Integration tests pass; manual cookie-flag check on the deployed staging host | Test log plus header capture | 6 | No | Not started |
| D-02 | P0 | Review role-based authorization: endpoint-by-role matrix; every controller guarded (deny by default); OWNER and PROPERTY_MANAGER equal per the scope register. | C-06 | all `*.controller.ts` | Matrix complete; no unguarded route except health and login | Matrix review plus tests | 5 | No | Not started |
| D-03 | P0 | Organization isolation sweep: for each module (inventory, residents, enquiries, bookings, admissions, check-ins, finance, auth), read/update/delete with another organization's UUID returns not-found or forbidden; body-supplied organization ids ignored. | C-06 | all modules, tenant tests | Cross-tenant attempts on every route fail | Test log | 10 | No | Not started |
| D-04 | P0 | Cross-tenant tests for finance: receipts, outstanding, monthly reports, corrections and scheduler `--org` scoping. | D-03 | finance module, jobs | No cross-org data in any report or receipt | Test log | 5 | No | Not started |
| D-05 | P0 | General API rate limiting for authenticated and write endpoints (login throttling already exists). Design with limits per IP and per user, a persistent or proxy-aware counter (`TRUST_PROXY_HOPS` must be verified on Railway first), and 429 handling in the web client. | G-08 (proxy facts), C-06 | `app.setup.ts`, new module, `apps/web/src/api.ts` | Burst beyond the limit receives 429 with `Retry-After`; normal use unaffected | Integration test plus staging load check | 8 | **Yes** (source change) | Not started |
| D-06 | P0 | Request-size and input limits: confirm effective body-size limit, oversize returns 413, UUID/params validated, strings bounded. | C-06 | `main.ts`, `common/input.ts` | 413 on oversize body; documented limit | Test | 3 | No (change would need approval) | Not started |
| D-07 | P0 | Security headers: capture real response headers on staging for API and web; define CSP for the API (JSON only) and for the web app (Vercel headers config); decide HSTS (max-age, includeSubDomains, no preload for now); keep `helmet()` explicit. | G-05, G-06 | `app.setup.ts`, new `vercel.json` (web) | Headers present on live responses, CSP does not break the app | `curl -I` captures; browser console clean | 5 | **Yes** (config change) | Not started |
| D-08 | P0 | Audit-log review: coverage for auth and money events, immutability, no secrets or PII in metadata. | B-08 | `audit_events` writers, `redact.ts` | Coverage table; redaction tests pass | Review plus test | 4 | No | Not started |
| D-09 | P0 | Sensitive-data exposure review: API response fields, error bodies, logs, Sentry payload scrubbing rules (code-level; live Sentry events re-checked in G-12). | B-08, C-06 | `observability/*`, `sentry-reporter.ts` | No credential, token, hash or full phone/email in logs or events | Sampled log and event review | 4 | No | Not started |
| D-10 | P1 | Dependency audit and secret scan in CI (`scripts/secret_scan.py` already exists). | C-12 | CI | Findings triaged | CI run | 2 | **Yes** (CI change) | Not started |
| D-11 | P1 | Independent security review (outside the build team) before expansion beyond the pilot. | H-09 | n/a | Report with findings triaged | Report | 16 + external wait | **Yes** | Not started |

### Phase E: Complete core workflows

Most screens and endpoints already exist (`apps/web/src/ops/*`, `apps/web/src/finance/*`). Each task is **verify and fill gaps** on synthetic data in a scratch or staging environment, on desktop and phone width.

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| E-01 | P0 | Owner onboarding: operator provisioning (organization, owner user, membership, temporary password shown once, forced change, audit). Confirm no self-service signup is needed for the pilot. | C-06 | `scripts/ops/provision-user.ts`, `reset-password.ts`, `revoke-access.ts` | A fresh organization is created and its owner can sign in and change the password; events audited | Scripted run on scratch | 6 | **Yes** (executes provisioning) | Not started |
| E-02 | P0 | Property setup | E-01 | `inventory`, `Inventory.tsx` | Property created and listed | Browser E2E | 3 | No | Not started |
| E-03 | P0 | Floors, rooms and beds, including a bed count matching the pilot hostel. | E-02 | `inventory` | Structure matches hostel floor plan; counts correct | Browser E2E | 4 | No | Not started |
| E-04 | P0 | Resident management: create, edit, archive, verification status. | E-01 | `resident`, `Residents.tsx` | CRUD works within the organization | Browser E2E | 4 | No | Not started |
| E-05 | P0 | Enquiries, follow-ups and conversion to resident. | E-04 | `enquiry`, `Enquiries.tsx` | Conversion creates one resident and keeps history | Browser E2E | 4 | No | Not started |
| E-06 | P0 | Booking and admission. | E-03, E-04 | `booking`, `admission`, `Bookings.tsx`, `Admissions.tsx` | Booking to admission produces a consistent state | Browser E2E | 5 | No | Not started |
| E-07 | P0 | Bed allocation, transfer and extension; per-booking invoicing for transfers. | E-06, C-11 | `booking`, `admission` | No double allocation; transfer yields correct billing periods | Browser E2E plus tests | 5 | No | Not started |
| E-08 | P0 | Check-in and check-out, including overstay handling. | E-07 | `checkin`, `CheckIns.tsx`, `OverstayBanner.tsx` | State machine correct; overstay surfaces | Browser E2E | 5 | No | Not started |
| E-09 | P0 | Invoice generation: preview, generate, issue; numbering `INV-YYYY-NNNN` per organization. | E-08, B-07 | `finance`, `CreateInvoice.tsx` | Correct month, amount snapshot, due date; no duplicates | Browser E2E plus reconciliation | 5 | No | Not started |
| E-10 | P0 | Payment recording and receipts (CASH, UPI, BANK_TRANSFER). **Synthetic data only until G1 (B-12).** | E-09, B-07 | `finance`, `RecordPaymentModal.tsx`, `ReceiptView.tsx` | Payment reduces balance; receipt `RCPT-<id>` correct; overpayment rejected | Browser E2E plus B-11 report | 4 | No | Not started |
| E-11 | P0 | Overdue payment handling. Overdue is **derived** (no automatic action per the scope register): confirm outstanding report, define the staff procedure. Automated reminders belong to Phase F. | E-10 | `OutstandingPayments.tsx`, `finance.service.ts` (`outstanding`) | Overdue list is correct on seeded data; procedure written | Browser E2E | 3 | No | Not started |
| E-12 | P0 | Decide how residents already living in the pilot hostel enter the system: opening balances and history **without fabricating payments** (no evidence of an opening-balance feature was found). | owner input | none yet | Written approach approved by owner | Decision recorded | 3 | **Yes** | Blocked (owner decision) |
| E-13 | P0 | Full synthetic owner journey end to end (onboarding to overdue), desktop and phone width, with the findings list closed. | E-01..E-12 | whole web app | Journey completes without workaround; no open Sev1/Sev2 | Recorded run plus checklist | 8 | No | Not started |

### Phase F: Resident experience

None of Razorpay, SMS, OTP, document upload or resident login is assumed to exist. No resident-facing code was found in `apps/web/src`. Nothing here may start until F-01 is approved, because these capabilities are currently **out of scope** per the scope register and guard.

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| F-01 | P0 | **Owner decision:** pilot access model: (a) staff-operated pilot where residents never log in, or (b) resident-facing portal. Update scope register and guard allow-list for whatever is chosen. | none | `PHASE_3_SCOPE_REGISTER.md`, `scripts/phase_scope.json` | Decision and scope change recorded | Decision log | 2 | **Yes** | Not started |
| F-02 | P1 | OTP/SMS provider selection and account setup (cost, sender registration, templates). | F-01 | n/a | Provider chosen; sender/template registration submitted | Provider console evidence | 3 + wait (external) | **Yes** | Blocked (F-01) |
| F-03 | P1 | OTP integration (send, verify, expiry, retry limits, abuse protection). | F-02, D-05 | new module | Delivery on real handset; limits enforced | Staging test | 20 | **Yes** | Blocked |
| F-04 | P1 | Resident authentication and sessions, separate from staff auth, scoped to own data. | F-03 | auth module, web | Resident can sign in and sees only own records | Isolation tests (D-03 style) | 24 | **Yes** | Blocked |
| F-05 | P1 | Booking confirmation to resident. | F-04 or F-09 | booking | Confirmation reaches the resident | Staging test | 8 | **Yes** | Blocked |
| F-06 | P1 | Resident payment experience: view invoices and receipts; online payment only after F-07. | F-04, B-12 | web, finance | Resident sees correct balances | E2E | 20 | **Yes** | Blocked |
| F-07 | P1 | Payment gateway integration (provider **not assumed**; owner to choose). Webhook signature verification, idempotent handling, reconciliation against B-03. | B-12, F-01 | new module | Test-mode payments reconcile exactly; duplicate webhooks harmless | Test mode run plus B-11 | 40 + wait (provider onboarding) | **Yes** | Blocked (G1) |
| F-08 | P1 | Document submission and verification (storage, access control, retention, privacy and legal review of identity documents). | F-01 | new module | Upload, review, status; only authorized staff can read | Security review | 40 + wait (legal) | **Yes** | Blocked |
| F-09 | P1 | Notifications (rent due, overdue, confirmations): channel choice, templates, opt-out. | F-02 | new module | Messages delivered and logged | Staging test | 16 | **Yes** | Blocked |
| F-10 | P1 | Resident end-to-end tests (only if F-01 chose option b). | F-04..F-09 | e2e suite | Full resident journey passes | Recorded run | 12 | No | Blocked |

### Phase G: Production infrastructure

Nothing below has been provisioned. Hosting is partly open (ADR-010).

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| G-01 | P0 | Release baseline: review the large uncommitted working-tree change set, get it committed through an owner-controlled process, CI green (including `verify:scope`, see T-01). | T-01, C-06 | repo | Clean tree; tagged release candidate; CI green | CI run | 6 | **Yes** | Not started |
| G-02 | P0 | Close the hosting decision (ADR-010) and record plan, region, PostgreSQL major version. | none | `docs/ops/*` | Decision recorded | Decision log | 2 + wait (owner) | **Yes** | Not started |
| G-03 | P0 | Railway PostgreSQL: provision, create migrator and runtime roles per C-02, private networking. | G-02, C-02 | `scripts/db/provision_roles.sql` | Roles match the grant matrix; runtime role cannot alter schema | Catalog queries | 4 | **Yes** | Blocked (G-02) |
| G-04 | P0 | Railway API service: build, start command, `APP_ENV=production`, `WEB_ORIGIN`, `TRUST_PROXY_HOPS`, runtime `DATABASE_URL`, no dotenv. | G-01, G-03, G-07 | `main.ts`, `config.ts` | Service healthy; `/health` OK | Health check plus logs | 4 | **Yes** | Blocked |
| G-05 | P0 | Vercel frontend: project, API base URL variable, build; no rewrites that bypass the API host rule. | G-01 | `apps/web`, `docs/ops/WEB_API_TOPOLOGY.md` | Web served; API calls reach the API host | Browser check | 3 | **Yes** | Blocked |
| G-06 | P0 | Domain and DNS (web host and API host under one registrable domain, as the cookie model requires). | G-04, G-05 | DNS | Both hosts resolve; certificates issued | `dig`, TLS check | 2 + wait (propagation) | **Yes** | Blocked |
| G-07 | P0 | Secrets management: production-only credentials, none shared with dev, stored only in the host's secret store, rotation procedure, access list. | G-02 | host consoles | Inventory of secrets (names only); no secret in repo or logs | `scripts/secret_scan.py`; review | 3 | **Yes** | Not started |
| G-08 | P0 | HTTPS-only and cookie topology verified live: Secure cookies, SameSite behaviour, CORS single origin, and **real `TRUST_PROXY_HOPS`** value proven (client IP seen by throttling). | G-06 | `app.setup.ts`, `WEB_API_TOPOLOGY.md` | Login works cross-host; throttle keys on real client IP | Browser and log evidence | 4 | No | Blocked |
| G-09 | P0 | Backups Layer 1: enable Railway volume backups, record schedule and retention, name a manual backup before each release and migration, access list. | G-03 | `docs/ops/BACKUP_RESTORE.md` section 3.1 | Checklist filled with real values | Dashboard evidence | 2 | **Yes** | Blocked |
| G-10 | P0 | **Restore drill:** restore a Layer 1 backup into a new, separate database, run `scripts/ops/restore-verify.sql` and the B-11 reconciliation, record timing and gaps in BACKUP_RESTORE section 10. Never restore in place. | G-09 | `scripts/ops/restore-drill.sh`, `restore-verify.sql` | Restored DB passes row-count and reconciliation checks; recovery time recorded | Section 10 filled with evidence | 6 | **Yes** | Blocked (G-09) |
| G-11 | P1 | Backups Layer 2: independent encrypted `pg_dump` to storage outside Railway (design only today). | G-10 | new cron service | Daily object appears; monthly restore from it works | Restore from Layer 2 | 12 + wait (storage choice) | **Yes** | Not started |
| G-12 | P0 | Sentry: set DSN, environment, test event received, alert rules to the owner, PII scrubbing confirmed. | G-04, D-09 | `observability/sentry-reporter.ts` | Forced error appears in Sentry and an alert reaches the owner | Screenshot and alert delivery | 3 | **Yes** | Blocked |
| G-13 | P0 | Health checks and uptime monitoring with alerting. | G-04 | `health.controller.ts` | Alert fires on forced downtime | Forced test | 2 | **Yes** | Blocked |
| G-14 | P1 | Invoice scheduler on Railway Cron, following `INVOICE_SCHEDULER.md` section 5: dry-run for one organization, supervised live run, repeat run creates zero, then enable. **Not before G1.** | B-12, G-10, G-04 | `jobs/*`, `docs/ops/INVOICE_SCHEDULER.md` | Dry-run plan reviewed; second run `created: 0`; failure alerting verified (non-zero exit visible) | Run output and audit events | 6 | **Yes** (each step) | Blocked |
| G-15 | P0 | Deployment rollback procedure written **and rehearsed**: web (Vercel previous deployment), API (previous Railway deployment), and migrations (forward-fix policy plus pre-release backup). | G-04, G-05, G-09 | runbook | A rehearsal rolls API and web back and forward without data loss | Rehearsal log | 4 | **Yes** | Blocked |
| G-16 | P0 | Migration deployment runbook: pre-release backup, `migrate deploy` with migrator role, verification queries, abort criteria. | G-03, G-09 | `prisma/migrations`, `scripts/verify_*` | Dry run on a restored copy succeeds | Log | 3 | No | Blocked |
| G-17 | P0 | Production smoke test with a clearly labelled synthetic organization (created, exercised, then archived, not hard-deleted). | G-08, G-12, G-13, G-15 | whole stack | Sign-in, one booking, one invoice, one test receipt; reconciliation zero | Recorded run | 4 | **Yes** | Blocked |
| G-18 | P0 | **Gate G2** review: G-01..G-17 P0 items Verified, restore drill evidence attached. | all P0 G | n/a | Signed checklist | Decision log | 1 | **Yes** | Blocked |

### Phase H: Internal testing and pilot

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| H-01 | P0 | Build a synthetic dataset (fake people, obviously fake phone numbers) for staging; no real PII. | E-13 | `scripts/seed_*` (new) | Dataset covers all workflow states | Review | 4 | No | Not started |
| H-02 | P0 | End-to-end owner workflows on staging using H-01. | H-01, G-17 | whole stack | All journeys pass | Recorded run | 8 | No | Blocked |
| H-03 | P0 | End-to-end resident workflows. Required **only if** F-01 chose option b (then F-10 is also a pilot prerequisite and is P0); otherwise record "not applicable". | F-10 | e2e | Pass, or N/A recorded | Recorded run | 8 | No | Blocked |
| H-04 | P0 | Payment and invoice verification on staging: payments, reversals, credits, voids, overdue, month-end report, B-11 zero drift. | H-02, B-12 | finance | Zero drift across the whole run | Report | 6 | No | Blocked |
| H-05 | P0 | Security tests on staging: auth, CSRF, rate limits, cross-tenant, headers (D-01..D-09 re-run against the deployed stack). | G-17, D-05, D-07 | n/a | No open high or critical finding | Test log | 8 | No | Blocked |
| H-06 | P0 | **Gate G3 go/no-go:** every P0 task Verified; restore drill evidence; rollback rehearsal; financial sign-off; owner written approval; named person on call. | all P0 | n/a | Signed checklist | Decision log | 2 | **Yes** | Blocked |
| H-07 | P1 | Pilot start: **10-20 residents** at one hostel, staff-operated unless F-01 says otherwise, real payments recorded manually (CASH, UPI, BANK_TRANSFER) only after G1. | H-06, E-12 | n/a | Cohort onboarded; cap of 20 residents enforced operationally | Resident count and daily reconciliation | 24 + wait | **Yes** | Blocked |
| H-08 | P1 | Run a **complete billing cycle**: invoice generation, payments, overdue, month-end reports, and (if G-14 done) the scheduler. | H-07 | n/a | One calendar billing cycle closed with zero unexplained drift and no Sev1 | Reconciliation and incident log | 16 + about one month | No | Blocked |
| H-09 | P1 | Pilot evidence review: incidents, drift, support load, backup status, restore re-test, owner feedback. | H-08 | n/a | Written evidence report | Report | 6 | **Yes** | Blocked |
| H-10 | P2 | Expand to **40-50 beds** (Gate G4) only after H-09 passes. | H-09, D-11, C-12, G-11, G-14 | n/a | Evidence report approves expansion | Decision log | 16 + wait | **Yes** | Blocked |
| H-11 | P2 | Stabilisation review at 40-50 beds: capacity, performance, support load, second billing cycle. | H-10 | n/a | Evidence report | Report | 12 + about one month | **Yes** | Blocked |
| H-12 | P2 | Expand to **100 beds** (Gate G5) only after H-11 evidence. | H-11 | n/a | Evidence report approves expansion | Decision log | 12 + wait | **Yes** | Blocked |

### Cross-cutting

| ID | Pri | Description | Deps | Files/modules | Acceptance criteria | Verification | Effort | Approval | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-01 | P0 | Triage the scope-guard failures: today `verify_phase_scope.py` reports 1 failure (S1, a real `.env` file) of 18 checks; the brief reports three. Identify the other two (or show they do not reproduce), propose fixes; **do not auto-fix**. | none | `scripts/verify_phase_scope.py`, `scripts/phase_scope.json`, `docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md` | Each failure explained; fixes approved by owner and applied by owner decision; guard passes 18/18 | Guard output | 3 | **Yes** (any fix) | Not started |
| T-02 | P1 | Locate or recreate `NOOK_LAUNCH_READINESS_AUDIT.md`; reproduce the 76.75% weighted score from its weights and write down the adjustment, or remove it. | owner input | audit file | Score either reproduced with working shown, or retired | Side-by-side calculation | 3 | **Yes** | Blocked (file missing) |

---

## 3. Traceability

### 3.1 Blocker to task

| Blocker | Resolved by tasks |
|---|---|
| BLK-01 six invoices drift | B-01, B-02, B-03, B-04, B-09, B-10, B-12 |
| BLK-02 payment transaction anomaly | B-05, B-06, B-07, B-08 |
| BLK-03 no least-privilege test role | C-01, C-02, C-03, C-04 |
| BLK-04 integration tests unverified | C-05, C-06, C-07, C-08, C-09, C-10, C-11 |
| BLK-05 disk below 5 GiB | A-01, A-02, A-03, A-04, A-05, A-06 |
| BLK-06 scheduler not operational | G-14, C-10 |
| BLK-07 OTP/SMS provider | F-01, F-02, F-03 |
| BLK-08 payment gateway | F-01, F-07 (gated by B-12) |
| BLK-09 backup/restore unverified | G-09, G-10, G-11 |
| BLK-10 Sentry/alerting | G-12, G-13, D-09 |
| BLK-11 production deployment and rollback | G-02..G-08, G-15, G-16, G-17, G-18 |
| BLK-12 scope-guard failures | T-01 |
| BLK-13 API rate limiting | D-05, D-06 |
| BLK-14 CSP/HSTS | D-07 |
| BLK-15 resident E2E testing | F-10, H-03 |
| BLK-16 no real-hostel pilot validation | H-06, H-07, H-08, H-09, H-10, H-11, H-12 |
| BLK-17 CI does not run integration tests | C-12, D-10 |
| BLK-18 uncommitted working tree | G-01 |
| BLK-19 INV-2099-9999 / migration input integrity | C-13 |
| BLK-20 documents/KYC not implemented | F-01, F-08 |
| BLK-21 notifications not implemented | F-09 |
| BLK-22 audit source missing / unexplained adjustment | T-02 |
| BLK-23 dev `.env` hazard | C-14, C-01 |

### 3.2 Pilot prerequisites (earliest realistic)

For a staff-operated pilot (F-01 option a), the P0 set is: A-01..A-05, C-01..C-11, B-01..B-12, D-01..D-09, E-01..E-13, F-01, G-01..G-10, G-12, G-13, G-15..G-18, T-01, H-01, H-02, H-04, H-05, H-06. P1 items (F-02..F-10, G-11, G-14, C-12..C-14, D-10, D-11, H-08, H-09, T-02) are not pilot-start prerequisites, **except** where a P0 task depends on them (none do).

The critical path is bounded by calendar waits, not coding: owner approvals (A-03, C-02, C-03, B-09, G-02), DNS and account setup (G-06), and unknown time to obtain the audit source (B-01). Engineering effort for the P0 set is totalled in section 4; calendar duration cannot be estimated honestly until the owner approvals above are scheduled.

---

## 4. Effort summary

98 tasks: **74 P0, 21 P1, 3 P2** (A 6, B 12, C 14, D 11, E 13, F 10, G 18, H 12, cross-cutting T 2).

| Priority | Tasks | Engineering hours (sum of table estimates) |
|---|---|---|
| P0 | 74 | about 314-326 |
| P1 | 21 | about 279 (Phase F alone is about 185) |
| P2 | 3 | about 40 |

Excluded from these sums: owner decision time, account and provider setup, DNS propagation, legal review, third-party security review, payment-gateway onboarding, SMS sender registration, and the roughly one-month wall-clock duration of each billing cycle (H-08, H-11). The estimates are planning figures made without running any of the code under test; B-05 (payment anomaly) is the least predictable. If the pilot is resident-facing (F-01 option b), the Phase F items needed for it move to P0 and the P0 total increases by roughly 100-185 hours.

---

## 5. Self-validation (performed after writing)

Checked mechanically with a script over both files (parsing the task tables and the blocker headings), then by reading:

| # | Check | Result |
|---|---|---|
| 1 | Every known blocker appears in the register | **Pass.** All 16 required blockers are BLK-01..BLK-16; BLK-17..BLK-23 added from inspection. 23 in total. |
| 2 | Every blocker has a corresponding roadmap task | **Pass.** 23 of 23 appear in the matrix in section 3.1, and every task named there exists. |
| 3 | Roadmap dependencies are logically ordered | **Pass.** All 98 tasks parse; every referenced task ID exists; no dependency cycle. A cycle between D-09 and G-12 was found and fixed while writing. |
| 4 | P0 tasks precede pilot launch | **Pass.** No P0 task depends on H-06/H-07; H-06 (go/no-go) depends on all P0 work and H-07 (pilot) depends on H-06. One intentional exception to "P0 depends only on P0": H-03 (resident E2E) lists F-10, which is P1, because both apply only if the owner picks a resident-facing pilot (F-01); in that case F-10 becomes P0. |
| 5 | Real payment acceptance is gated by verified financial correctness | **Pass.** B-12 (Gate G1) blocks real payments, E-10 real money, F-07 (gateway), and G-14 (scheduler). H-07 depends on H-06 which requires G1. |
| 6 | Production launch is gated by backup/restore verification | **Pass.** G-10 (restore drill) precedes G-18 (Gate G2) which precedes H-06; G-14 (scheduler) also needs G-10. |
| 7 | First pilot is limited to 10-20 residents | **Pass.** H-07 states 10-20 residents with an operational cap of 20. |
| 8 | Expansion to 100 beds requires pilot evidence | **Pass.** H-12 depends on H-11, which depends on H-10, which depends on H-09 (evidence review of the complete billing cycle in H-08). |

Limits of this validation: it proves internal consistency of the two documents, not that the plan is complete or that any item is true of the live system. Dependencies were checked as written, not against a real schedule. No task is `Verified`, and Nook's launch readiness remains **not established**.
