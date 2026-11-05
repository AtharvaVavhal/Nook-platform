# NOOK Blocker Register

Phase 2H.8. Planning document only. Written 2026-11-03 from read-only repository inspection.
Companion: `NOOK_LAUNCH_ROADMAP.md` (task IDs such as `B-04`, gates G0-G5, priority definitions).

## How to read this register

- **Pilot gate = Yes** means the blocker must be closed (exit criteria met, evidence attached) before the pilot starts (Gate G3). These are the "P0 blockers".
- **Conditional** means the gate depends on an owner decision (task F-01).
- **Expansion** means it must be closed before growth beyond the first 10-20 residents.
- **Root cause** is filled in only where it is known. Suspected causes are labelled *suspected, not proven*. For the six invoices and the payment anomaly the root cause is **unknown**.
- **Evidence** distinguishes what was observed in this repository (path or command) from what comes only from the task brief. The source audit file `NOOK_LAUNCH_READINESS_AUDIT.md` was not found anywhere, so brief-only evidence is unverified (see BLK-22).
- **Owner** is a role: *Project owner* (decisions, approvals, accounts) or *Engineering* (implementation and verification).
- Every blocker is a risk to a real hostel's money or data unless stated otherwise. Nothing is `Closed`.

## Summary

| ID | Title | Severity | Pilot gate | Status |
|---|---|---|---|---|
| BLK-01 | Six invoices with paid-amount drift | Critical | **Yes** | Open |
| BLK-02 | Unresolved historical payment transaction anomaly | Critical | **Yes** | Open |
| BLK-03 | No least-privilege PostgreSQL test role | High | **Yes** | Open |
| BLK-04 | Real-PostgreSQL integration tests unverified | Critical | **Yes** | Open |
| BLK-05 | macOS free disk space below 5 GiB | High | **Yes** | Open |
| BLK-06 | Invoice scheduler not operational | Medium | Expansion | Open |
| BLK-07 | OTP/SMS provider not configured | Medium | Conditional | Open |
| BLK-08 | Payment gateway not integrated | Medium | Conditional | Open |
| BLK-09 | Production backup and restore unverified | Critical | **Yes** | Open |
| BLK-10 | Sentry DSN and alerting not configured | High | **Yes** | Open |
| BLK-11 | Production deployment and rollback unverified | Critical | **Yes** | Open |
| BLK-12 | Scope-guard failures | High | **Yes** | Open |
| BLK-13 | No general API rate limiting | High | **Yes** | Open |
| BLK-14 | CSP/HSTS not explicitly configured or verified | Medium | **Yes** | Open |
| BLK-15 | No resident end-to-end testing | Medium | Conditional | Open |
| BLK-16 | No real-hostel pilot validation | High | Expansion | Open |
| BLK-17 | CI does not run the integration suite | Medium | Expansion | Open |
| BLK-18 | Large uncommitted working tree, no release baseline | High | **Yes** | Open |
| BLK-19 | Legacy invoice conflict and migration input integrity | Low | Expansion | Open |
| BLK-20 | Document upload / KYC not implemented | Medium | Conditional | Open |
| BLK-21 | Notifications not implemented | Low | Conditional | Open |
| BLK-22 | Audit source file missing; score adjustment unexplained | Medium | No (credibility) | Open |
| BLK-23 | Local `.env` can point tools at `nook_dev` | Medium | Expansion | Open |

Counts: **23 blockers**. Pilot gate = Yes: **12** (BLK-01, 02, 03, 04, 05, 09, 10, 11, 12, 13, 14, 18). Conditional: 5 (BLK-07, 08, 15, 20, 21). Expansion gate: 5 (BLK-06, 16, 17, 19, 23). Credibility only: 1 (BLK-22).

Severity totals: Critical 5 (01, 02, 04, 09, 11); High 7 (03, 05, 10, 12, 13, 16, 18); Medium 9; Low 2.

> Conditional blockers become pilot gates only if the owner chooses a resident-facing pilot (task F-01 option b) or enables online payment. For a staff-operated pilot with manually recorded payments they gate expansion at most. BLK-08 additionally stays blocked behind BLK-01 and BLK-02 in every case.

---

## Blockers

### BLK-01 Six invoices with paid-amount drift

| Field | Content |
|---|---|
| Description | Six invoices have a stored `paid_amount` that does not equal what the payment history implies. |
| Severity | **Critical** |
| Business impact | A hostel owner could be shown wrong balances or receipts. Any real-money use before this is explained would compound errors in a ledger that has no manual correction path. Undermines trust in every report. |
| Evidence | Brief only: "six invoices with paid-amount drift". **No invoice identifiers, database name or detection query exist in the repository.** Related in-repo facts: `docs/nook-phase-3/TASK_4F_FINANCE_PLAN.md` records that `paid_amount` was a cache with no cross-check; the finance docs state the invariant in two different forms (see roadmap 0.2 item 8). |
| Root cause | **Unknown.** Not proven. |
| Resolution | B-01 locate the six; B-02 define the invariant; B-03 independently verify it; B-04 forensic timelines; B-09 remediation proposal; B-10 approved remediation through audited application paths; B-12 sign-off. |
| Dependencies | A-04 (healthy DB), owner supplying the audit's detection source (BLK-22), BLK-03/04 for any test-based verification. |
| Owner | Engineering (investigation); Project owner (remediation decision) |
| Approval requirement | **Yes.** Read access to any non-scratch database, the remediation choice, and execution each need separate explicit approval. No backfill, void or edit of financial records without it. |
| Status | Open, blocked on audit source |
| Exit criteria | (1) The six invoices are identified. (2) The invariant is written down, independently verified and signed off. (3) Each of the six has a documented timeline and an "explained/unexplained" finding. (4) The owner-approved action is complete, and the read-only reconciliation shows zero drift with original rows and audit history untouched. (5) B-11 daily reconciliation exists. |

### BLK-02 Unresolved historical payment transaction anomaly

| Field | Content |
|---|---|
| Description | An earlier payment transaction behaved anomalously and its cause is not established. The code now contains a defensive read-after-write check on `paid_amount`. |
| Severity | **Critical** |
| Business impact | If the cause is a defect in the payment path it may recur and silently corrupt balances. A defensive check that detects but does not explain can mask the underlying fault. |
| Evidence | Brief only for the anomaly. In repo: the check at `apps/api/src/finance/finance.service.ts` (around lines 883-898, comment "DEFENSIVE: Verify the paid_amount update persisted before emitting the audit event"). Row locking and idempotency are present (lines ~821-836). |
| Root cause | **Unknown.** The existence of the defensive check is not evidence of its cause. |
| Resolution | B-05 investigate and test hypotheses on scratch; B-06 review the defensive check; B-07 lifecycle validation; B-08 audit/append-only verification; C-07, C-08, C-09. |
| Dependencies | BLK-01 findings, BLK-04 (real-PostgreSQL runs), the owner's description of the original anomaly. |
| Owner | Engineering; Project owner (risk acceptance if not reproducible) |
| Approval requirement | **Yes** for any access to non-scratch data and for accepting residual risk. |
| Status | Open |
| Exit criteria | Anomaly reproduced as a failing test and fixed, **or** documented as not reproducible with the owner's written risk acceptance; read-after-write check assessed with a test proving full rollback on mismatch. |

### BLK-03 No least-privilege PostgreSQL test role

| Field | Content |
|---|---|
| Description | There is no reviewed role that can run the integration suite with only the privileges the runtime needs, separate from the privileges fixtures need. |
| Severity | High |
| Business impact | Without it tests either run with excess rights (hiding permission bugs) or cannot run at all. Past plans note the `nook_test` runtime role cannot read `_prisma_migrations` and no migrator credential existed there. |
| Evidence | `docs/nook-phase-3/TASK_4F_FINANCE_PLAN.md` (the `nook_test` rows); `scripts/db/provision_roles.sql` exists but is not recorded as reviewed for this purpose. Nothing was provisioned during this phase. |
| Root cause | Known in part: role design for tests was deferred behind feature work. Not a defect in the application. |
| Resolution | C-01 guard/allow-list; C-02 role design with grant matrix; C-03 scratch provisioning; C-04 fixture/runtime split. |
| Dependencies | BLK-05 (disk), A-04 (healthy Postgres). |
| Owner | Engineering; Project owner approves the design |
| Approval requirement | **Yes** (design approval and the provisioning step). |
| Status | Open |
| Exit criteria | Approved grant matrix; roles exist on scratch only; the suite passes under the runtime role; removing a needed grant makes a test fail; `nook_dev`, `nook_test` and production are never used. |

### BLK-04 Real-PostgreSQL integration tests unverified

| Field | Content |
|---|---|
| Description | The integration suite (`apps/api/test/integration/*.test.ts`) has not been shown passing on a real PostgreSQL in this audit cycle, so rollback, concurrency, idempotency and locking are claimed in design docs but not evidenced here. |
| Severity | **Critical** |
| Business impact | Money-moving and bed-allocation correctness under concurrency is unproven. A race could double-allocate a bed or mis-record a payment. |
| Evidence | Brief only for "not verified". In repo: the suite exists (13 integration test files); `docs/ops/INVOICE_SCHEDULER.md` says tests ran on the isolated scratch database only. No tests were run in this phase (disk 1.7 GiB). |
| Root cause | Known: blocked by disk shortage (BLK-05) and missing role design (BLK-03). |
| Resolution | C-05, C-06, C-07 rollback, C-08 concurrent payments, C-09 idempotency, C-10 invoice locking, C-11 bed-allocation concurrency; C-12 CI enforcement later (BLK-17). |
| Dependencies | BLK-05, BLK-03, A-04. |
| Owner | Engineering |
| Approval requirement | Run itself: No (scratch only). Role provisioning: Yes. |
| Status | Open, blocked |
| Exit criteria | Unit and integration suites pass against an approved scratch database with logs retained (database **name** recorded, not URL); each failure triaged; rollback, concurrency, idempotency and locking tests pass. |

### BLK-05 macOS free disk space below 5 GiB

| Field | Content |
|---|---|
| Description | The Data volume is at 100% capacity with about 1.7 GiB free. |
| Severity | High |
| Business impact | Builds, Docker, PostgreSQL and test runs can fail or corrupt (a full disk can break Postgres and Docker volumes). Blocks all verification work. |
| Evidence | Observed 2026-11-03: `df -h` on `/` and `/System/Volumes/Data` showed 1.8 GiB and 1.7 GiB available, 100% used on the Data volume. Brief says the audit measured 2.7 GiB. |
| Root cause | Not investigated. Cause of consumption is unknown. |
| Resolution | A-01 baseline, A-02 candidate list (regenerable caches only), A-03 owner-approved reclamation to >= 8 GiB, A-04 Docker/PG health, A-05/A-06 gate and watch. |
| Dependencies | Owner's choice of what to reclaim. |
| Owner | Project owner (host machine); Engineering supports |
| Approval requirement | **Yes** for any deletion. Projects, Application Support, databases and Docker volumes are excluded. |
| Status | Open, blocked on owner |
| Exit criteria | >= 8 GiB free; before/after listings prove nothing protected was removed; Docker and PostgreSQL healthy. |

### BLK-06 Invoice scheduler not operational

| Field | Content |
|---|---|
| Description | The scheduler job is implemented and tested on a scratch DB but not committed, deployed or scheduled; it must stay disabled until financial correctness is signed off. |
| Severity | Medium |
| Business impact | Without it, invoices must be generated manually each month; with it enabled prematurely, wrong invoices could be issued automatically. |
| Evidence | `apps/api/src/jobs/*`; `docs/ops/INVOICE_SCHEDULER.md` header: "implemented and tested against the isolated scratch database only. No production job has been run, no cron service exists". The brief calls it "not implemented", which is imprecise. |
| Root cause | Known: deliberately held back pending owner approval of each enablement step. |
| Resolution | C-10 concurrency verification; G-14 Railway Cron setup following the documented dry-run, supervised-run, repeat-run sequence. Manual generation covers the first cycle if G-14 is not done. |
| Dependencies | BLK-01, BLK-02 (G1), BLK-09 (restore drill), BLK-11 (API deployed). |
| Owner | Engineering; Project owner approves each step |
| Approval requirement | **Yes**, every step. `BILLING_SCHEDULER_ENABLED` stays unset until approval. |
| Status | Open |
| Exit criteria | Dry-run reviewed for one organization; supervised live run correct; second run creates zero; non-zero exit alerts the owner; then enabled for all organizations. |

### BLK-07 OTP/SMS provider not configured

| Field | Content |
|---|---|
| Description | No OTP or SMS provider, account, sender or template exists, and no OTP code exists in the API. |
| Severity | Medium |
| Business impact | Residents cannot self-authenticate or receive messages; any resident portal is impossible. |
| Evidence | `grep` of `apps/api/src` finds no OTP/SMS provider code; the scope register and guard list OTP/SMS/WhatsApp as out of scope. |
| Root cause | Known: intentionally out of scope for earlier phases. |
| Resolution | F-01 owner decision and scope change; F-02 provider setup; F-03 integration; F-04 resident auth. |
| Dependencies | F-01; D-05 (rate limiting) before exposing an OTP endpoint. |
| Owner | Project owner (provider, spend); Engineering |
| Approval requirement | **Yes** (scope change, spend, sender registration). |
| Status | Open, conditional |
| Exit criteria | Provider account and sender approved; OTP delivered to a real handset on staging with expiry, retry and abuse limits; or the owner records that the pilot is staff-operated and this is deferred. |

### BLK-08 Payment gateway not integrated

| Field | Content |
|---|---|
| Description | No online payment gateway exists. Payments are recorded manually (CASH, UPI, BANK_TRANSFER). The provider is not chosen. |
| Severity | Medium |
| Business impact | No online collection; manual recording depends on staff accuracy, which is why the reconciliation work matters. |
| Evidence | Scope register: "no payment gateway or automatic payment collection". No gateway code in `apps/api/src`. |
| Root cause | Known: out of scope by design so far. |
| Resolution | F-01 scope decision; F-07 integration **after** B-12. |
| Dependencies | BLK-01, BLK-02 (hard gate); provider onboarding. |
| Owner | Project owner (provider, KYC with the provider); Engineering |
| Approval requirement | **Yes.** |
| Status | Open, conditional, blocked behind financial verification |
| Exit criteria | Test-mode payments and duplicate webhooks reconcile exactly against the verified invariant; signature verification tested; B-11 shows zero drift; owner approves live mode. |

### BLK-09 Production backup and restore unverified

| Field | Content |
|---|---|
| Description | No production backup is confirmed enabled and no restore has ever been performed. No independent off-Railway copy exists. |
| Severity | **Critical** |
| Business impact | Loss, corruption or accidental deletion of the production database would be unrecoverable or of unknown recoverability. Financial history could be lost. |
| Evidence | `docs/ops/BACKUP_RESTORE.md` header: "restore readiness is NOT established"; section 1: backups "Unknown", "Has a backup ever been restored? No", Layer 2 "design only". |
| Root cause | Known: nothing has been provisioned yet; hosting decision open (ADR-010). |
| Resolution | G-02 hosting decision; G-09 Layer 1 backups; **G-10 restore drill into a new database**; G-11 Layer 2 off-provider copy (expansion). |
| Dependencies | G-03 (production PostgreSQL), BLK-11. |
| Owner | Engineering; Project owner (account access, storage choice) |
| Approval requirement | **Yes.** |
| Status | Open |
| Exit criteria | Backup schedule and retention recorded from the real dashboard; a restore into a separate database completes; `restore-verify.sql` and the reconciliation pass; recovery time recorded in BACKUP_RESTORE section 10. Production is never restored in place. **No production launch before this.** |

### BLK-10 Sentry DSN and alerting not configured

| Field | Content |
|---|---|
| Description | `SENTRY_DSN` is unset anywhere; no event has ever been sent; no alert routing exists; same for uptime alerts. |
| Severity | High |
| Business impact | Production errors and failed jobs could go unnoticed; the pilot owner would find out from users. |
| Evidence | `docs/ops/OBSERVABILITY.md` header: "no event has ever been sent to Sentry", "stays off until SENTRY_DSN is set". Code: `apps/api/src/observability/sentry-reporter.ts`. |
| Root cause | Known: not yet configured (needs a deployed service and a Sentry account). |
| Resolution | D-09 data scrubbing review; G-12 DSN, test event, alert rules; G-13 health checks and uptime alerts. |
| Dependencies | G-04 (deployed API), Sentry account. |
| Owner | Project owner (account); Engineering |
| Approval requirement | **Yes** (account, DSN, and what data may be sent). |
| Status | Open |
| Exit criteria | A forced error appears in Sentry with no PII; an alert reaches the owner; a forced downtime triggers an uptime alert. |

### BLK-11 Production deployment and rollback unverified

| Field | Content |
|---|---|
| Description | Nothing has been deployed. Cross-host cookies/CORS, HTTPS, proxy hop count, secrets, DNS, migrations on production and rollback have not been verified on live Railway or Vercel. |
| Severity | **Critical** |
| Business impact | A first deployment with real data and no tested rollback risks extended downtime or an unrecoverable bad migration. |
| Evidence | `docs/ops/WEB_API_TOPOLOGY.md`: "Not yet verified on a live Vercel/Railway"; line ~86: the `TRUST_PROXY_HOPS=1` expectation has not been confirmed. `docs/ops/INVOICE_SCHEDULER.md` section 3: "nothing here has been done". No Railway/Vercel configuration is in the repo. |
| Root cause | Known: not yet attempted; ADR-010 open. |
| Resolution | G-02..G-08 infrastructure; G-15 rollback written and rehearsed; G-16 migration runbook; G-17 synthetic-organization smoke test; G-18 Gate G2. |
| Dependencies | BLK-18 (baseline commit), BLK-09 (backups before first migration), BLK-12 (CI green). |
| Owner | Engineering; Project owner (accounts, domain) |
| Approval requirement | **Yes.** |
| Status | Open |
| Exit criteria | Live sign-in works across hosts; proxy hops confirmed from real client IPs; rollback rehearsal logged for API and web; migrations deployed from a documented runbook after a named backup; smoke test passes; Gate G2 signed. |

### BLK-12 Scope-guard failures

| Field | Content |
|---|---|
| Description | The brief reports three scope-guard failures. |
| Severity | High |
| Business impact | CI runs `verify:scope`; failing guard blocks the pipeline. The guard also protects against unapproved scope creep, so failures must be understood, not silenced. |
| Evidence | Observed 2026-11-03 by running `python3 -I scripts/verify_phase_scope.py` (read-only): **17 of 18 checks pass; 1 fails: `S1 no real .env file`.** The other two reported failures were **not reproduced** in the current working tree. |
| Root cause | For S1: *suspected, not proven* that a local `.env` file (pointing at `nook_dev`, see BLK-23) is the trigger, because the rule is literally "no real .env file". The two other failures are unlocated. |
| Resolution | T-01 triage; the guard and `phase_scope.json` change only by explicit owner decision. **Not auto-fixed.** |
| Dependencies | Owner decision on any change to `scripts/phase_scope.json` or the scope register. |
| Owner | Engineering (triage); Project owner (any scope change) |
| Approval requirement | **Yes** for any fix. |
| Status | Open |
| Exit criteria | Each failure has a documented cause; fixes were approved by the owner; the guard reports 18/18 on a clean checkout and in CI. |

### BLK-13 No general API rate limiting

| Field | Content |
|---|---|
| Description | Sign-in and password-change attempts are throttled, but there is no rate limiting on other authenticated or write endpoints. |
| Severity | High |
| Business impact | An internet-exposed API holding resident data and money records could be abused or overloaded. OTP, if added, would be exposed without limits. |
| Evidence | `apps/api/src/auth/auth.service.ts`, `throttle.service.ts`, `auth-security.ts` implement login throttling only; `apps/api/src/app.setup.ts` has no general limiter. The brief's "missing API rate limiting" is therefore accurate only for the general case. |
| Root cause | Known: not yet built. |
| Resolution | D-05 design and implement; D-06 verify request-size limits; G-08 must first prove the real client IP (`TRUST_PROXY_HOPS`). |
| Dependencies | BLK-11 (proxy facts). |
| Owner | Engineering |
| Approval requirement | **Yes** (source change, limits). |
| Status | Open |
| Exit criteria | Bursts above the limit return 429 with `Retry-After`; normal use unaffected; web client handles 429; verified on staging behind the real proxy. |

### BLK-14 CSP/HSTS not explicitly configured or verified

| Field | Content |
|---|---|
| Description | The API uses `helmet()` defaults; no explicit CSP or HSTS policy is configured or has been observed in a live response; the web app has no header configuration (no `vercel.json`). |
| Severity | Medium |
| Business impact | Weaker browser-side protections for the staff web app (script injection, downgrade). |
| Evidence | `apps/api/src/app.setup.ts` line ~49 `app.use(helmet())`; no `vercel.json` found in the repo. Whether defaults emit CSP/HSTS in the deployed form was **not observed**. |
| Root cause | Known: not yet configured because nothing is deployed. |
| Resolution | D-07 capture real headers, define API and web CSP, decide HSTS parameters. |
| Dependencies | G-05, G-06 (a live HTTPS host). |
| Owner | Engineering |
| Approval requirement | **Yes** (config change). |
| Status | Open |
| Exit criteria | Live responses for both hosts show the agreed CSP and HSTS; the app runs without CSP violations. |

### BLK-15 No resident end-to-end testing

| Field | Content |
|---|---|
| Description | No resident-facing flow exists to test; no resident E2E suite exists. |
| Severity | Medium |
| Business impact | If the pilot is resident-facing, resident journeys would be untested on first use. |
| Evidence | No resident-facing code found in `apps/web/src`; the existing screens are staff screens. |
| Root cause | Known: resident features are out of scope so far (BLK-07, 08, 20, 21). |
| Resolution | F-01 decision; F-10 and H-03 only if resident-facing. |
| Dependencies | BLK-07, BLK-08, BLK-20, BLK-21 as applicable. |
| Owner | Engineering |
| Approval requirement | Yes (via F-01). |
| Status | Open, conditional |
| Exit criteria | Either "not applicable: staff-operated pilot" recorded by the owner, or a passing recorded resident E2E run. |

### BLK-16 No real-hostel pilot validation

| Field | Content |
|---|---|
| Description | The system has never run a real hostel through a billing cycle. |
| Severity | High |
| Business impact | Real-world edge cases (mid-month exits, partial payments, extensions, in-house residents with existing dues) are not yet exercised. Expansion without evidence risks scaling a defect. |
| Evidence | No pilot has run (nothing deployed). `docs/nook-phase-3/PILOT_ACCOUNT_REQUIREMENTS.md` defines a single-hostel pilot but is partly stale (see roadmap 0.2 item 5). No opening-balance feature was found (task E-12). |
| Root cause | Known: pilot cannot start until pilot-gate blockers close. |
| Resolution | H-06 go/no-go; H-07 pilot of **10-20 residents**; H-08 one complete billing cycle; H-09 evidence review; H-10 40-50 beds; H-11 stabilisation; H-12 100 beds. |
| Dependencies | All pilot-gate blockers. |
| Owner | Project owner; Engineering |
| Approval requirement | **Yes** at each expansion gate (G4, G5). |
| Status | Open |
| Exit criteria | A complete billing cycle closes with zero unexplained drift and no Sev1; evidence report approved before 40-50 beds; a second evidence report approved before 100 beds. |

### BLK-17 CI does not run the integration suite

| Field | Content |
|---|---|
| Description | The CI workflow runs `test:database` against a CI Postgres service but the visible workflow does not run `test:integration`. |
| Severity | Medium |
| Business impact | Regressions in finance and tenancy tests would not be caught automatically. |
| Evidence | `.github/workflows/ci.yml` (last visible step runs `npm run test:database --workspace @nook/api`); `apps/api/package.json` defines `test:integration` separately. Whole-workflow review was partial. |
| Root cause | Known: integration tests needed role/scratch design first (BLK-03). |
| Resolution | C-12; D-10. |
| Dependencies | BLK-03, BLK-04. |
| Owner | Engineering |
| Approval requirement | **Yes** (CI change). |
| Status | Open |
| Exit criteria | CI runs the integration suite with the required flag and fails if it is skipped. |

### BLK-18 Large uncommitted working tree, no release baseline

| Field | Content |
|---|---|
| Description | The branch has a very large set of modified, deleted and untracked files (API, web, schema, migrations, jobs, observability, tests) not yet committed. |
| Severity | High |
| Business impact | There is no reviewed, tagged commit to deploy, roll back to, or compare. A deployment from a dirty tree is not reproducible. |
| Evidence | `git status` at session start listing modified `apps/api/src/**`, `apps/web/src/**`, `prisma/schema.prisma`, `scripts/phase_scope.json`, plus untracked `apps/api/src/jobs/`, `observability/`, and new tests. Latest commit `c85dcce`. |
| Root cause | Known: work in progress across Phase 3.6. |
| Resolution | G-01 (owner-controlled review and commit, CI green). Nothing was staged or committed in this phase. |
| Dependencies | T-01 (guard), C-06 (tests). |
| Owner | Project owner (commit decision); Engineering |
| Approval requirement | **Yes.** |
| Status | Open |
| Exit criteria | Clean working tree at a tagged release candidate with green CI. |

### BLK-19 Legacy invoice conflict and migration input integrity

| Field | Content |
|---|---|
| Description | One legacy invoice (`INV-2099-9999`) in a scratch database conflicts with the per-booking uniqueness model; migration input checks are defined but not run against any data. |
| Severity | Low (scratch only; a fresh production database has no legacy rows) |
| Business impact | Only matters if migrations are applied to a database already holding legacy invoices. |
| Evidence | `docs/nook-phase-3/INV_2099_9999_REMEDIATION_PROPOSAL.md`, `FUTURE_MIGRATION_INPUT_INTEGRITY_CHECKS.md` (scratch census). Awaiting owner choice among options. |
| Root cause | Documented in the proposal (index replaced before the migration was applied to the scratch database); treat as the proposal's finding, not re-verified here. |
| Resolution | C-13. |
| Dependencies | BLK-04. |
| Owner | Project owner (decision); Engineering |
| Approval requirement | **Yes** (any change to the scratch row or migration). |
| Status | Open |
| Exit criteria | Owner decision recorded; integrity checks run on a restored copy before any migration on data that has legacy invoices. |

### BLK-20 Document upload and KYC not implemented

| Field | Content |
|---|---|
| Description | No document file storage or identity verification exists; only a verification-status field exists. |
| Severity | Medium |
| Business impact | Documents must be handled outside the system; any later feature carries privacy, retention and legal obligations. |
| Evidence | `PHASE_3_SCOPE_REGISTER.md`: "a verification status only; no document files are stored"; out of scope: KYC, Aadhaar, document upload. |
| Root cause | Known: out of scope by design. |
| Resolution | F-01, F-08 (includes legal/privacy review). |
| Dependencies | F-01; D-05. |
| Owner | Project owner (policy, legal); Engineering |
| Approval requirement | **Yes.** |
| Status | Open, conditional |
| Exit criteria | Owner records manual handling for the pilot, or a reviewed secure upload pipeline passes the security review. |

### BLK-21 Notifications not implemented

| Field | Content |
|---|---|
| Description | No SMS, WhatsApp or e-mail notifications exist (booking confirmation, due or overdue reminders). |
| Severity | Low |
| Business impact | Staff chase payments and confirmations by hand. |
| Evidence | Scope register: no SMS or WhatsApp messaging; no notification code in `apps/api/src`. |
| Root cause | Known: out of scope so far. |
| Resolution | F-09. |
| Dependencies | BLK-07 (SMS channel) or an e-mail choice. |
| Owner | Project owner; Engineering |
| Approval requirement | **Yes.** |
| Status | Open, conditional |
| Exit criteria | Channel, templates and opt-out approved; messages delivered and logged on staging; or deferred by the owner with a manual procedure. |

### BLK-22 Audit source file missing; score adjustment unexplained

| Field | Content |
|---|---|
| Description | `NOOK_LAUNCH_READINESS_AUDIT.md` cannot be found, so the brief's figures cannot be checked. The raw weighted score (76.75%) and adjusted score (72%) differ by 4.75 points, yet the brief describes a 7-point disk deduction. |
| Severity | Medium (credibility of the readiness claim; not a runtime risk) |
| Business impact | Decisions could be made on a score nobody can reproduce. Independently verified launch readiness is **not established**, and no replacement score is offered. |
| Evidence | Searched the repo, `git log --all`, `~/Downloads`, `~/Desktop`, `~/Documents` and the project memory directory: no file. |
| Root cause | Unknown (file never saved here, saved elsewhere, or renamed). |
| Resolution | T-02. |
| Dependencies | Owner locating the file. |
| Owner | Project owner; Engineering |
| Approval requirement | Yes. |
| Status | Open |
| Exit criteria | The score is reproduced from the audit's own weights with working shown, or retired. |

### BLK-23 Local `.env` can point tools at `nook_dev`

| Field | Content |
|---|---|
| Description | A local `.env` points at the development database, and starting `dist/main.js` loads it, so running tools can unintentionally touch `nook_dev`. |
| Severity | Medium |
| Business impact | Violates the rule that integration tests never use `nook_dev`; could mutate development data. |
| Evidence | The project's auto-memory entry "API .env points at nook_dev: starting dist/main.js loads it; disable dotenv first". Related guard failure `S1` (cause *suspected, not proven*). |
| Root cause | Known from the memory note: the entry point loads dotenv. |
| Resolution | C-01 guard review; C-14 remove the hazard; use explicit environment for scratch runs. |
| Dependencies | none |
| Owner | Engineering |
| Approval requirement | **Yes** (source change). |
| Status | Open |
| Exit criteria | No entry point can silently select `nook_dev`; the guard S1 cause is documented. |

---

## Cross-checks

- **Every required blocker is present:** six invoices (01), payment anomaly (02), test role (03), integration tests (04), disk (05), scheduler (06), OTP/SMS (07), gateway (08), backup/restore (09), Sentry (10), deployment/rollback (11), scope guard (12), rate limiting (13), CSP/HSTS (14), resident E2E (15), pilot validation (16). BLK-17 to BLK-23 were found during inspection.
- **Every blocker maps to at least one roadmap task** (matrix in `NOOK_LAUNCH_ROADMAP.md` section 3.1).
- **No root cause is asserted as proven** for BLK-01, 02, 05, 12 (S1 suspected only) or 22.
