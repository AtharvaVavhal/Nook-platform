# Task 4F.0 baseline review and 4F.1 correctness plan

Status: **review and plan only. No application code, migration, database or marketing file was changed.**
This document is the only file written. Nothing is staged, committed or pushed.
Date 2026-11-02, branch `feature/phase-3-core-workflows`, HEAD `7edcf70`.

## Part A — 4F.0 baseline safety

### A.1 What the working tree really is

| Fact | Value |
| --- | --- |
| Staged files | 0 |
| Stashes | 0 |
| Modified tracked files | 82 (4 of them marketing) |
| Untracked files (`-uall`) | 163 (80 of them marketing, 1 stray plan file) |
| Total changed paths | 245 (84 marketing, 1 stray plan file, 160 candidate baseline files) |
| Last commit | `7edcf70` Phase 3.5 check-in/out. **Slice 3.6 Finance, account security, tenant-key hardening and the whole `apps/web/src/ops/` and `apps/web/src/auth/` trees have never been committed.** |
| Ignored (correctly) | `.env`, `.env.test`, `*.log`, `dist/` |

**Whose work is it?** The first git status of this conversation already listed the same modified files, so almost all of
these changes predate my sessions and must be treated as **your work**. In this conversation I wrote only the Task 4E
check-in/out changes (`apps/api/src/checkin/*`, small guards in `admission.service.ts` and `booking.service.ts`, the 4E
tests, `apps/web/src/ops/CheckIns.tsx` and its wiring, `opsApi.ts`, `opsFormat.ts`, `opsRoute.ts`, `Enquiries.tsx`
type fixes, `OpsShell.tsx`, `App.tsx` import fixes) plus the 4E and 4F plan documents. I did not touch `marketing/`.
`PLAN_4E_CHECKIN_CHECKOUT.md` in the repository root is a stray planning file from an earlier session; I recommend
excluding it from the baseline.

### A.2 Finance file inventory (exact)

API: `apps/api/src/finance/finance.controller.ts` (127 lines), `finance.module.ts` (13), `finance.service.ts` (1,124),
`finance.util.ts` (197). Tests: `apps/api/test/finance.util.test.ts` (206), `apps/api/test/integration/finance.integration.test.ts` (1,820).
Web: 19 files under `apps/web/src/finance/` plus `apps/web/src/financeHelpers.test.ts`.
Migrations: `20261101130000_add_finance_billing`, `20261101150000_add_payment_idempotency`, `20261101170000_add_financial_corrections`.
Models: `Invoice`, `Payment`, `PaymentReversal`, `InvoiceAdjustment`, `PaymentIdempotencyKey` in `prisma/schema.prisma`.
Wiring: `FinanceModule` added to `app.module.ts`; sidebar link and `FinanceShell` mount in `App.tsx`.

### A.3 Migration review (read-only)

I compared the SHA-256 of every local `migration.sql` with `_prisma_migrations` in `nook_dev`, inside a `READ ONLY`
transaction that was rolled back. Nothing was written.

| Migration | In `nook_dev` | Checksum |
| --- | --- | --- |
| `20261031154500` … `20261101113306` (7 committed) | applied | match |
| `20261101130000_add_finance_billing` | applied | **match** |
| `20261101150000_add_payment_idempotency` | applied | **match** |
| `20261101170000_add_financial_corrections` | applied | **match** |
| `20261101190000_tenant_composite_keys_phase_3_3_to_3_5` | applied | match |
| `20261101210000_admission_and_lifecycle_integrity` | applied | match |
| `20261102100000_account_security` | applied | match |

No database-only migrations; no unfinished or rolled-back rows. `nook_dev` currently holds 180 invoices, 112 payments and 20
adjustments, mostly integration-test data.

Dependencies and risks:

1. **Finance migrations are not self-sufficient in `schema.prisma`.** The finance models reference `Booking`, `Resident`, `Payment`
   by composite keys that the finance migrations themselves create (`bookings_id_organization_id_key`, `residents_id_organization_id_key`).
   They are additive and contain **no `DROP`**. They depend only on the committed tables (`organizations`, `residents`, `bookings`, `users`).
2. **`schema.prisma` has one combined uncommitted diff** (+216/−39) mixing finance, composite-key hardening and
   `LoginThrottle`/account-security. It cannot be split by path. Splitting means `git add -p`, which I advise against for a schema file.
3. **A finance-only commit would not build.** `app.module.ts` now imports `FinanceModule` and `DatabaseModule`
   (untracked) and drops the `PrismaService` provider; auth guards the finance controller uses are modified. I have not
   built a partial checkout (it would require a worktree); this is reasoned from the diffs, not tested.
4. **The immutability trigger leaves gaps** (see 4F.1-F): it protects amount, number, identity and period on non-DRAFT
   invoices, but **not `due_date`, `issued_at`, `notes` or `status` transitions**. This matters for decision 9 and for the due-date rule.
5. `payments_immutable` forbids every UPDATE, so **any new column on `payments` can never be back-filled** for existing rows.
6. A DB reset is never needed for 4F.1; all proposed schema work is additive, and every item below says whether it needs a migration.

### A.4 Scope-guard result — two failures are mine

`npm run verify:secrets` and `verify:migration` pass. `npm run verify:scope` passes **15 of 18**:

| Check | Result | Cause |
| --- | --- | --- |
| S1 no real `.env` file | FAIL | `.env` exists locally (ignored by git; environmental) |
| S8 routes in the approved list | FAIL | `GET /api/v1/check-ins/occupancy` (**added by me in 4E**) and `GET /api/v1/inventory/summary` (earlier work) |
| S9 raw SQL only in approved files | FAIL | `admission/admission.service.ts` and `checkin/checkin.service.ts` (**both from my 4E work**) |

I did not run this guard during 4E; I should have. The guard is working as designed: new routes and raw SQL need your approval
in `scripts/phase_scope.json` and the scope register. The raw SQL is `SELECT … FOR UPDATE` row locking, the same kind already
approved for `booking.service.ts`. **Either approve those three additions or I will remove them before any baseline commit.**
I will not edit the guard configuration myself.

### A.5 Proposed baseline (nothing is committed; awaiting your approval)

Recommendation: **one baseline commit** on this branch, "Phase 3.1–3.6 baseline", containing groups A–G below, then
`marketing/` and the stray plan file left alone. Reason: groups depend on each other (A.3 item 3), so intermediate commits
would not compile. If you prefer several commits, the safe order is A → B → C → E → D → F → G, with `schema.prisma` entirely in
the first; intermediate builds are **untested**. Files must be added **by explicit path list**, never `git add .`.

Before committing I would run (all read-only apart from test data on `nook_dev`): API and web typecheck, unit tests, lint
on touched files, `verify:*`, and then re-run the integration suites on `nook_dev`. Not on `nook_test`.

### A.6 Exact file list

### A. Database: schema, migrations, generated client — 29 files

`apps/api/src/generated/**`: 22 files (regenerated Prisma client; must match `schema.prisma`).

- `M` prisma/schema.prisma
- `??` prisma/migrations/20261101130000_add_finance_billing/migration.sql
- `??` prisma/migrations/20261101150000_add_payment_idempotency/migration.sql
- `??` prisma/migrations/20261101170000_add_financial_corrections/migration.sql
- `??` prisma/migrations/20261101190000_tenant_composite_keys_phase_3_3_to_3_5/migration.sql
- `??` prisma/migrations/20261101210000_admission_and_lifecycle_integrity/migration.sql
- `??` prisma/migrations/20261102100000_account_security/migration.sql

### B. Scope guards, CI — 6 files

- `M` .github/workflows/ci.yml
- `M` scripts/phase_scope.json
- `M` scripts/test_db_guard.py
- `M` scripts/test_phase_scope.py
- `M` scripts/verify_m0_scope.py
- `M` scripts/verify_phase_scope.py

### C. Platform: auth/account security, shared infrastructure — 32 files

- `M` .env.example
- `M` apps/api/src/auth/auth.controller.ts
- `M` apps/api/src/auth/auth.guards.ts
- `M` apps/api/src/auth/auth.module.ts
- `M` apps/api/src/auth/auth.repository.ts
- `M` apps/api/src/auth/auth.service.ts
- `M` apps/api/src/auth/auth.types.ts
- `M` apps/api/src/auth/session.service.ts
- `M` apps/api/src/main.ts
- `M` apps/api/test/auth.test.ts
- `M` apps/api/test/integration/auth.integration.test.ts
- `M` docker-compose.yml
- `??` apps/api/src/auth/auth-audit.service.ts
- `??` apps/api/src/auth/auth-security.ts
- `??` apps/api/src/auth/throttle.service.ts
- `??` apps/api/src/common/ids.ts
- `??` apps/api/src/database/database.module.ts
- `??` apps/web/src/apiConfig.ts
- `??` apps/web/src/auth/AuthContext.tsx
- `??` apps/web/src/auth/AuthGate.tsx
- `??` apps/web/src/auth/ChangePasswordForm.tsx
- `??` apps/web/src/auth/LoginPage.tsx
- `??` apps/web/src/auth/PasswordChangePage.tsx
- `??` apps/web/src/auth/UserMenu.tsx
- `??` apps/web/src/auth/auth.css
- `??` apps/web/src/auth/authApi.ts
- `??` apps/web/src/auth/authHelpers.ts
- `??` apps/web/src/authHelpers.test.ts
- `??` scripts/ops/ops-lib.ts
- `??` scripts/ops/provision-user.ts
- `??` scripts/ops/reset-password.ts
- `??` scripts/ops/revoke-access.ts

### D. Finance (API, tests, web) — 23 files

- `??` apps/api/src/finance/finance.controller.ts
- `??` apps/api/src/finance/finance.module.ts
- `??` apps/api/src/finance/finance.service.ts
- `??` apps/api/src/finance/finance.util.ts
- `??` apps/api/test/finance.util.test.ts
- `??` apps/api/test/integration/finance.integration.test.ts
- `??` apps/web/src/finance/CorrectionHistory.tsx
- `??` apps/web/src/finance/CorrectionModals.tsx
- `??` apps/web/src/finance/CreateInvoice.tsx
- `??` apps/web/src/finance/FinanceDashboard.tsx
- `??` apps/web/src/finance/FinanceShell.tsx
- `??` apps/web/src/finance/InvoiceDetail.tsx
- `??` apps/web/src/finance/InvoiceList.tsx
- `??` apps/web/src/finance/MonthlyReports.tsx
- `??` apps/web/src/finance/OutstandingPayments.tsx
- `??` apps/web/src/finance/ReceiptView.tsx
- `??` apps/web/src/finance/RecordPaymentModal.tsx
- `??` apps/web/src/finance/finance.css
- `??` apps/web/src/finance/financeApi.ts
- `??` apps/web/src/finance/financeFormat.ts
- `??` apps/web/src/finance/financeRoute.ts
- `??` apps/web/src/finance/shared.tsx
- `??` apps/web/src/financeHelpers.test.ts

### E. Phase 3.1–3.5 API modules and tests (incl. Task 4E) — 35 files

- `M` apps/api/src/admission/admission.controller.ts
- `M` apps/api/src/admission/admission.module.ts
- `M` apps/api/src/admission/admission.service.ts
- `M` apps/api/src/app.module.ts
- `M` apps/api/src/booking/booking.controller.ts
- `M` apps/api/src/booking/booking.module.ts
- `M` apps/api/src/booking/booking.service.ts
- `M` apps/api/src/checkin/checkin.controller.ts
- `M` apps/api/src/checkin/checkin.dto.ts
- `M` apps/api/src/checkin/checkin.module.ts
- `M` apps/api/src/checkin/checkin.service.ts
- `M` apps/api/src/enquiry/enquiry.controller.ts
- `M` apps/api/src/enquiry/enquiry.module.ts
- `M` apps/api/src/enquiry/enquiry.service.ts
- `M` apps/api/src/inventory/inventory.controller.ts
- `M` apps/api/src/inventory/inventory.module.ts
- `M` apps/api/src/inventory/inventory.repository.ts
- `M` apps/api/src/inventory/inventory.service.ts
- `M` apps/api/src/inventory/inventory.types.ts
- `M` apps/api/src/resident/resident.controller.ts
- `M` apps/api/src/resident/resident.dto.ts
- `M` apps/api/src/resident/resident.module.ts
- `M` apps/api/src/resident/resident.service.ts
- `M` apps/api/test/integration/helpers/db.ts
- `M` apps/api/test/integration/inventory.integration.test.ts
- `M` apps/api/test/inventory.test.ts
- `??` apps/api/src/checkin/checkin.rules.ts
- `??` apps/api/src/resident/resident.fields.ts
- `??` apps/api/test/checkin.rules.test.ts
- `??` apps/api/test/integration/account-security.integration.test.ts
- `??` apps/api/test/integration/booking.integration.test.ts
- `??` apps/api/test/integration/checkin.integration.test.ts
- `??` apps/api/test/integration/helpers/env.ts
- `??` apps/api/test/integration/lifecycle.integration.test.ts
- `??` apps/api/test/integration/resident-enquiry.integration.test.ts

### F. Web: operations screens, app shell — 20 files

- `M` apps/web/index.html
- `M` apps/web/src/App.tsx
- `M` apps/web/src/api.ts
- `M` apps/web/src/components/FloorPlan.tsx
- `M` apps/web/src/components/InventoryOverview.tsx
- `M` apps/web/src/main.tsx
- `M` apps/web/src/styles.css
- `??` apps/web/src/components/DemoBadge.tsx
- `??` apps/web/src/ops/Admissions.tsx
- `??` apps/web/src/ops/Bookings.tsx
- `??` apps/web/src/ops/CheckIns.tsx
- `??` apps/web/src/ops/Enquiries.tsx
- `??` apps/web/src/ops/Inventory.tsx
- `??` apps/web/src/ops/OpsShell.tsx
- `??` apps/web/src/ops/Residents.tsx
- `??` apps/web/src/ops/ops.css
- `??` apps/web/src/ops/opsApi.ts
- `??` apps/web/src/ops/opsFormat.ts
- `??` apps/web/src/ops/opsRoute.ts
- `??` apps/web/src/ops/ui.tsx

### G. Documentation and README — 14 files

- `M` README.md
- `M` docs/MILESTONE_0_VALIDATION.md
- `M` docs/nook-phase-2/PHASE_2_DECISION_BRIEF.md
- `M` docs/nook-phase-2/PHASE_2_OWNER_DECISION_REGISTER.md
- `M` docs/nook-phase-2/PHASE_2_SLICE_2_1_PREFLIGHT.md
- `M` docs/phase-2-reports/CREDENTIAL_ROTATION_VERIFICATION_REPORT.md
- `M` docs/phase-2-reports/PHASE2_CHECKPOINT_A_CORRECTED_REPORT.md
- `M` docs/phase-2-reports/PHASE2_FINAL_EXECUTION_HANDOFF.md
- `M` docs/phase-2-reports/PHASE_2_SLICE_2_2_ISOLATED_TEST_ENVIRONMENT_PLAN.md
- `M` docs/phase-2-reports/POSTGRES_PASSWORD_ROTATION_INVESTIGATION.md
- `??` docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md
- `??` docs/nook-phase-3/PILOT_ACCOUNT_REQUIREMENTS.md
- `??` docs/nook-phase-3/TASK_4E_CHECKIN_CHECKOUT.md
- `??` docs/nook-phase-3/TASK_4F_FINANCE_PLAN.md

### EXCLUDED — marketing assets (not touched) — 84 files

80 files under `marketing/instagram/**`. Excluded in full; not listed individually.


### EXCLUDED — stray plan file — 1 files

- `??` PLAN_4E_CHECKIN_CHECKOUT.md

`M` = modified tracked file, `??` = untracked.

---

## Part B — 4F.1 correctness plan

Frozen decisions applied: 1 (exclusive end), 2 (due date), 3 (no GST), 4–5 (no billing beyond booking end without an
approved extension), 6 (history preserved), 7 (equal permissions), 8 (IST), 9 (immutability), 10 (auto-issue audit),
11 (receipt credit snapshot), 12 (no free amount override). The scheduler is **not** part of this work.

Open interpretation questions that change the design are collected in Part C. Everything below assumes the recommended answer.

### Issue 1 — Exclusive booking end date `[startDate, endDate)`

- **Today:** `endDate: { gte: periodStart }` in `FinanceService.generateMonthly`. A booking ending on the 1st bills that month.
- **Change:** a month is billable by a booking when `startDate < nextPeriodStart` **and** `endDate > periodStart`, with both
  booking instants converted to their **IST calendar date** first (booking dates are stored as UTC-midnight instants from date
  strings, so a naive comparison with IST boundaries is off by 5½ hours at the edges). Do the comparison on IST dates in code
  after a coarse database pre-filter.
- **Files:** `apps/api/src/finance/finance.service.ts` (eligibility), `finance.util.ts` (new `istDate()`/`bookingCoversMonth()`),
  `apps/api/src/booking/booking.dto.ts` comment stays. Also check `CreateInvoice.tsx` helper text.
- **Database:** none.
- **Regression tests:** booking ending exactly on the 1st (not billed that month); ending on the last day (billed); ending
  mid-month (billed full month); starting on the last day (billed); starting on the 1st; IST boundary instants
  (`2026-11-30T18:30Z`); a booking end date supplied with an offset.
- **Acceptance:** for every month, billed ⇔ the month intersects `[start, end)` in IST dates; one-day and one-month bookings
  behave per the table in the test; existing finance tests still pass.

### Issue 2 — Cancellation after check-out must not erase occupancy (decision 6)

- **Today:** finance requires `admission.status = ADMITTED` and `booking.status = CONFIRMED`, so a later cancellation silently
  removes occupied months from ungenerated invoices.
- **Change:** eligibility is driven by the **stay** (the check-in/check-out records) and the booking's period and price.
  Booking and admission status are no longer part of the filter once a check-in exists. A booking cancelled **before** any check-in
  still produces no invoice because there is no stay. A cancelled booking keeps `monthlyPrice` as the rent source.
  Check-in/check-out rows are already never deleted (4E); keep it that way.
  Optional extra (needs your yes): also refuse to cancel a booking/admission that has any check-in on record.
- **Files:** `finance.service.ts`; optionally `booking.service.ts`, `admission.service.ts` (the 4E guard currently covers only *active* check-ins).
- **Database:** none.
- **Regression tests:** cancel booking after check-out → months occupied are still billed; cancel admission after check-out → same;
  cancellation before check-in → not billed; cancellation never deletes or alters check-in/check-out rows; a cancelled booking's price is used.
- **Acceptance:** occupied months are billed identically whether or not the booking/admission was later cancelled.

### Issue 3 — No billing beyond the booking end without an approved extension (decisions 4–5)

- **Today:** an active check-in past `endDate` falls out of billing silently, and the booking can be edited freely
  (`PUT /bookings/:id` changes `endDate` and `monthlyPrice` with no trail).
- **Change:**
  1. Keep eligibility strictly inside `[start, end)` (Issue 1); an active check-in alone never extends billing.
  2. Add an explicit **extend booking** action, `POST /bookings/:id/extend` `{ newEndDate, reason }`: later than the current end,
     overlap-checked under the bed row lock (same as booking creation), reason required, **audit event** with actor and old/new
     end date. Plain `PUT` is no longer allowed to move `endDate` later (shortening stays allowed, also audited).
  3. Make the leak **visible**: an "occupied past booking end" list (active check-in whose `endDate` is in the past or
     ends this month) on the Finance overview and the Check-ins screen, linking to the extension action. Extension also
     requires the same exclusive-end semantics.
  4. Billing for the extension then follows normally.
- **Files:** `booking.service.ts`, `booking.controller.ts` (+ one new route → scope guard S8), `finance.service.ts` (read-only query for the list),
  web `ops/Bookings.tsx`, `ops/opsApi.ts`, finance overview.
- **Database:** none (audit events already exist, `actor_user_id` nullable).
- **Regression tests:** overstay is not billed; extension (audited) makes the extra month billable; extension that overlaps another
  booking is refused; concurrent extension vs new booking on the same bed; shortening audited; `PUT` cannot lengthen; cross-organization extension is 404.
- **Acceptance:** no invoice is ever generated for a month outside `[start, end)`; every extension is traceable to a user and reason;
  overstays appear in the review list the day they begin.
- **Question to settle first (Part C, Q1):** does "owner-approved" mean the `OWNER` role, or the business owner acting through either role?

### Issue 4 — Due date: later of the 5th and the issue date (decision 2)

- **Today:** `defaultDueDate()` = the 5th, fixed at creation, before issue.
- **Change:** `dueDate = max(5th of billing month, IST date of issue)`, computed **at issue time**. A DRAFT keeps a provisional
  due date (shown as "set on issue"); `issue()` and auto-issue recompute it. An explicitly supplied due date stays an explicit
  override (validated ≥ period start) and is audited. The invoice due date is **never changed after issue**.
- **Files:** `finance.util.ts` (`dueDateAtIssue()`), `finance.service.ts` (`issue`, `generateMonthly`, `createDraft`), `InvoiceDetail.tsx`, `CreateInvoice.tsx`.
- **Database:** the current trigger already permits changing `due_date` while the invoice is DRAFT, so the rule works without a
  migration. **But it also lets `due_date` change after issue.** Closing that gap needs a new trigger version (additive function replace) → **migration, needs approval** (see Issue 8).
- **Regression tests:** issued on the 3rd (due 5th), on the 5th (due 5th), on the 6th (due the 6th), on the last day, issued the next month
  for an old period (due = issue date), explicit override, issue at 18:30–24:00 UTC (IST date rollover), generated-and-issued in one run.
- **Acceptance:** no invoice is born overdue; due date never moves after issue.

### Issue 5 — Asia/Kolkata everywhere (decision 8)

- **Today:** `todayIst`, invoice year and eligibility use IST. Not IST: monthly report `receivedAt` ranges use UTC month starts;
  `receivedAt` with no zone is read in the *server* zone; the dashboard's `currentMonth()` and the payment date picker use the *browser* zone.
- **Change:** report ranges use `istStartOfDay(period)`; shared `resolveInstant()` (already written for 4E, `checkin.rules.ts`) is moved
  to `common/` and used for `receivedAt` (zone-less ⇒ IST, future-date guard unchanged); web `currentMonth()` and the payment date use IST and send
  explicit instants (e.g. `…T12:00:00+05:30`); times displayed as IST.
- **Files:** `finance.service.ts` (`monthlyReport`, `recordPayment`), `finance.util.ts`, `common/time.ts` (new), `checkin.rules.ts` (re-export), `financeFormat.ts`, `RecordPaymentModal.tsx`.
- **Database:** none.
- **Regression tests:** payment at 00:30 IST on the 1st belongs to the new month; at 23:30 IST on the last day, the old month; run the suite with `TZ=America/Los_Angeles`
  and `TZ=UTC` to prove independence from server zone; browser zone differing from IST.
- **Acceptance:** identical results regardless of server or browser time zone.

### Issue 6 — Auto-issue writes audit events (decision 10)

- **Today:** `generateMonthly(issue:true)` writes a batch event only; single `issue()` writes `finance.invoice.issued`.
- **Change:** when invoices are created ISSUED, insert one `finance.invoice.issued` audit event **per invoice**, in the same transaction, with
  `{ number, automatic, source: 'generate-monthly' }` (the scheduler later reuses this with a null actor). Keep the batch event. Roll back together on failure.
- **Files:** `finance.service.ts` (`generateMonthly`, `audit`).
- **Database:** none.
- **Regression tests:** N invoices ⇒ N issued events plus 1 batch event; failure mid-run leaves no invoices and no events; re-run creates no new events; events carry the actor.
- **Acceptance:** every issued invoice has exactly one issued event, regardless of path.

### Issue 7 — Receipts preserve credits applicable at issuance (decision 11)

- **Today:** `balanceAfterPayment` uses today's `adjustmentTotal`; a later credit rewrites old receipts, and reversals alter later receipts' running balance.
- **Options:**
  - **A (recommended): snapshot at payment time.** Add nullable columns to `payments`: `credit_total_at_payment`, `balance_after_payment`. They are written
    inside the payment transaction under the invoice lock (so they are exact even under concurrency) and never updated. Legacy rows stay null and fall back to a derived value, marked "derived".
    **Needs a migration** (additive, nullable). Cannot be back-filled because payments are immutable.
  - **B: derive from timestamps** (credits created before the payment). **No migration, but unsafe:** `created_at` is the transaction *start*
    time, so a payment that waited on the invoice lock can carry an earlier timestamp than a credit it actually follows. I do not recommend it.
- **Files:** `schema.prisma`, new migration, `finance.service.ts` (`recordPayment`, `receipt`), `ReceiptView.tsx`, `financeApi.ts`.
- **Regression tests:** pay, then credit ⇒ first receipt unchanged; credit, then pay ⇒ second shows the credit; reversal marks the receipt reversed but does not change its stored balance;
  concurrent pay and credit ⇒ each receipt consistent with the actual lock order; legacy null rows still render.
- **Acceptance:** a receipt, once issued, always shows the same amounts; corrections show up as separate documents.

### Issue 8 — Manual amount override and immutability (decisions 9 and 12)

- **Today:** `POST /finance/invoices` accepts any `amount` (even alongside a booking) and the UI offers "No booking — enter an amount".
- **Change (recommended):** **remove the override.** A manual draft requires a booking and takes the price from it. A price correction before billing
  is a booking price change; after issue it is a **credit** (existing append-only workflow). Reducing is therefore fully audited; **raising** an issued invoice has no workflow
  (credits are negative only). If you need extra charges, it is a new, explicit feature, not an override.
  Replacement design if you want to keep overrides: DRAFT-only `amountOverride` with a required reason, an audit event carrying old/new amount, and the same equal permissions.
- **Also (decision 9):** close the trigger gaps in a new, additive trigger version: forbid changing `due_date` after issue, forbid changing `issued_at` once set, forbid status moves back to `DRAFT`, and forbid `notes` rewrites after issue if you consider notes part of the record.
  Add a controlled **void** (decision 9 names it): `POST /finance/invoices/:id/void` `{ reason }`, only for an invoice with **no net cash** (no unreversed payments), append-only void record.
  Whether void ships in 4F.1 or 4F.3 is your call (Q4).
- **Files:** `finance.service.ts` (`createDraft`), `CreateInvoice.tsx`, finance tests that create drafts by amount (`finance.integration.test.ts` lines ≈ 294–318 and ≈ 1772), `schema.prisma` + migration if void/trigger work is approved.
- **Database:** override removal — none. Trigger hardening and void — **additive migration, needs approval**; existing rows must satisfy the new rule (a pre-flight check that fails closed, like migration `…210000`).
- **Regression tests:** draft without booking ⇒ 400; amount in body ignored or rejected (choose **reject 400**); booking price used; direct SQL update of issued `due_date`/`issued_at` refused; void rules; void is append-only and audited; payments on a voided invoice refused.
- **Acceptance:** no code path can silently change what a customer was billed.

### Cross-cutting acceptance for 4F.1

- API and web typecheck clean; unit tests pass; lint clean for touched files; `verify:scope` passes (after your decisions on A.4).
- Integration suites pass on `nook_dev` (labelled as such), plus the new regression tests; a `TZ` matrix run.
- No scheduler code, no tax fields, no `nook_test` or production access, no `prisma db push`, no data resets.
- Finance suites remain **un-evidenced in CI and on `nook_test`** until the migrator credential and CI wiring are provided; the final report will say so.

### Ordering

1 (exclusive end) → 2 (history) → 5 (IST) → 4 (due date) → 6 (issue audit) → 3 (extension) → 7 and 8 (the two that need migrations, last, so everything else can ship without waiting).
Estimated changes outside finance: `booking.service.ts`/`controller` (Issue 3) only.

## Part C — Questions that block application changes

1. **"Owner-approved" extension:** the `OWNER` role only, or any signed-in user acting for the owner, with the audit trail as the approval record?
   (Decision 7 gives equal finance permissions, but extension is a booking action.) Recommendation: record the approver and reason; allow both roles.
2. **Scope guard:** approve `GET /check-ins/occupancy`, and raw `SELECT … FOR UPDATE` in `admission.service.ts` and `checkin.service.ts`
   (and, if you agree to Issue 3, `POST /bookings/:id/extend`)? Or remove them?
3. **Baseline commit:** one commit with groups A–G (recommended), excluding `marketing/` and `PLAN_4E_CHECKIN_CHECKOUT.md`? Approve the file list above?
4. **Migrations:** approve one additive migration for (a) payment receipt snapshot columns, (b) hardened invoice trigger, (c) invoice void record?
   Or ship Issues 1–6 first and defer 7–8?
5. **Issue 2:** finance-from-stay only (recommended), or also refuse cancelling a booking/admission with any check-in on record?
6. **Manual draft:** remove the amount override (recommended) or keep it as a reasoned, audited draft-only override?
7. **Existing data:** `nook_dev` contains test invoices that violate none of the above; no production data exists. Confirm no remediation is needed.

Nothing will be changed until you answer, at minimum, Q2, Q3 and Q1.
