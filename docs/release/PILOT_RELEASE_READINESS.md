# Owner + Property Manager pilot — release readiness (2026-11-13)

Scope: the existing Owner and Property Manager application only. No STAFF, no transfers, no new backend contracts.
Evidence: this session's runs on disposable PostgreSQL; nothing here was run against production.

## 1. Remaining work, classified

| Class | Item | Why |
|---|---|---|
| **A — required** | **Release candidate is uncommitted.** All Phase 4 migrations, the permission layer and the frontend exist only in the working tree. | Hosted CI cannot test it and nothing can be deployed from it. Needs your authorization to commit and open a PR. |
| A | **Hosted CI green** on that PR (PostgreSQL 17.10 service, full integration job). | Local runs use 17.11 and exclude 3 files; CI is the supported certification. |
| A | **Root `.env` (scope check S1 fails, 17/18).** | Needs your decision: relocate it outside the repo, or keep the failing check. I have not read, moved or hidden it. |
| A | **Three financial integration suites never run on the final tree** (finance, corrections, invoice-scheduler). | They cover the real invoice/payment/reversal logic that a pilot depends on (§3). Needs your authorization. |
| A | **Production operations:** a tested backup of the real database and a named operator; user provisioning via the operator CLI; cookie/CORS settings per `docs/ops/WEB_API_TOPOLOGY.md`. | Nothing in the repository can establish these. The restore *procedure* was rehearsed on scratch data only. |
| **B — deferrable** | Correction-history paging. | `GET /finance/corrections` has no `page` parameter and reports no real total. The UI now asks for the 200-entry maximum and says when it is cut off. Pilot volume is far below that; fixing it changes a finance endpoint whose test suite is in the unrun set above, so it should be done with that suite available. |
| B | Replace the labeled demonstration property/floor plan on the home page with live data. | It is clearly marked DEMO DATA; live inventory and admissions sit below it. Misleading only if the label is ignored. |
| B | Old-binary/new-schema execution test; PERF-01–06 measurements; real-device mobile testing. | Engineering confidence items, not functional gaps. |
| **C — owner decision or scope approval** | Notifications (no model, routes or provider). | New table and routes need an approved scope slice and decisions on categories, channels and retention. Not built; the page says so. |
| C | Organization details and billing settings (tax, due-date, late-fee rules). | No API; these are owner policy decisions. |
| C | Document/KYC upload and verification. | No storage, access, retention or verification policy. **Decide whether the pilot may run KYC on paper/outside Nook.** The profile shows status read-only. |
| C | STAFF, membership and invitations. | Needs Phase 4 closure and M14 scope approval. |
| **D — Phase 4 restricted** | Transfer execution, assignment adoption, finance-review resolution, correction financial apply. | All gates off; D1–D8, A1, F1, R1 unapproved; race pairs 5, 6, 8, 9 not run. Preview and history stay read-only. |

## 2. What was closed in this task

No backend change was required for the pilot. The two backend candidates (correction paging, billing/organization settings) are B and C above, and I did not invent contracts for them.

## 3. Financial test authorization brief (nothing below was run)

**Browser scenarios** (`scripts/e2e/ui-readiness.e2e.mjs`, skipped with `NOOK_UI_SKIP="W11,W12"`):

| ID | What it does | Mutations (synthetic data, disposable DB only) |
|---|---|---|
| W11 | Opens *Generate monthly invoices*, presses *Generate invoices*, expects "No new invoices". | Calls `POST /finance/invoices/generate-monthly` for the current month. Asserts the existing invoice is not duplicated (1 invoice per booking). Expected to write nothing; a defect would write invoices and audit rows. |
| W12 | On the W05 invoice: *Reverse* a payment with a reason, then *Record replacement* of 1000. | Inserts one `payment_reversals` row, one replacement `payments` row and audit events; asserts 2 payments, 1 reversal, balance 3,500.00, receipt marked REVERSED. Append-only tables: rows cannot be edited or deleted afterwards. |

**Integration files** (`apps/api/test/integration/`, run by `scripts/qa/phase4-disposable.mjs full regression`, or the `nonfinancial-regression` mode's complement):

| File | Tests | Financial mutations it performs |
|---|---|---|
| `finance.integration.test.ts` | 120 | Invoice draft/issue, monthly generation, payments, partial/over payments, reversal (incl. concurrent), replacement payments, credits/adjustments, voids, receipts and reports. |
| `invoice-scheduler.integration.test.ts` | 12 | Runs the scheduled billing job (live and dry run) across organizations: creates and issues invoices, voided-invoice replacement, failure isolation. |
| `corrections.integration.test.ts` | 34 | Lifecycle corrections including financial application behind the (test-only) switch, billing reviews, 15 concurrency scenarios. Run with `CORRECTIONS_FINANCIAL_APPLY_ENABLED` unset by default. |

**Fixtures and cleanup:** every run uses a fresh tmpfs PostgreSQL container with generated credentials and a database named `nook_integration_*`; synthetic organizations, users and residents are inserted by the test files themselves. The harness removes the labeled container and its tmpfs at the end (verified in every run this session: "CLEANUP VERIFIED"). No volume is created, no shared container or image is touched, no existing database is reachable (the harness never reads `.env`). Duration is a few minutes; the three files raised the earlier full run from 161 to about 327 tests.

**Decision needed:** authorize (a) W11 + W12 and (b) the three files, together or separately. Recommendation: authorize all three files before the pilot. They are the only automated proof of invoice, payment, reversal and monthly-generation correctness on the final code.

## 4. Verification on the current tree

| Area | Result |
|---|---|
| Owner and Property Manager workflows | Real Chrome + Vite + Nest + disposable PostgreSQL: **26 passed, 2 skipped (W11, W12), 0 failed**. Owner ran every create/edit workflow; the manager ran the full route sweep, correction approval and session cases. |
| Responsive | 276 route/viewport checks (46 routes × 1440/768/390 × two roles): no overflow, no page errors. |
| Tenant isolation | 8/8 PostgreSQL tests (foreign ids 404, no list leakage, foreign deletes change nothing, `organizationId` ignored) plus cross-tenant browser checks. |
| Authorization | Default-deny layer: 87 routes declared; unknown roles refused on all 80 protected routes; OWNER/PM behavior identical to the pre-change baseline (259/259). |
| Session behavior | Revoked session, deactivated membership and mid-session temporary password verified in the browser against real 401/403 responses. |
| Existing integration | 161/161 (non-financial files). |
| Static | API and web typecheck, ESLint, Prettier, production build all clean; unit tests 440/440 (API) and 120/120 (web); scope guard 17/18 (S1 only). |

## 5. Verdict

**NOT READY for pilot release — blocked by authorization and process, not by missing functionality.** The Owner/Manager application is functionally complete for what the backend supports and verified as above. The pilot is blocked by A: authorize and run the financial suites, decide the `.env`, authorize committing the candidate so hosted CI can run, and confirm production backup/operator readiness. The KYC question in C should be answered before onboarding residents.
