# Task 4F — Finance & Billing: audit and implementation plan

Status: **audit and plan only.** No application code, migration or data was changed to produce this document.
Branch `feature/phase-3-core-workflows`. Audit date 2026-11-02.

## 0. Headline findings

1. **Finance is largely built, but none of it is committed.** `apps/api/src/finance/`, `apps/web/src/finance/`, the three
   finance migrations and the finance tests are all untracked. Nothing is protected by git history yet.
2. **"Automatic monthly generation" and "automatic issuance" do not exist.** There is no scheduler anywhere in the API
   (no cron, interval or `@nestjs/schedule`). Generation is a manual `POST /finance/invoices/generate-monthly`, and it
   creates **DRAFT** invoices unless the caller passes `issue: true`. Two frozen rules are therefore unimplemented.
3. **Likely billing defect: booking end date is treated as inclusive.** The booking API documents `endDate` as
   *exclusive* (`booking.dto.ts`: "exclusive end date", and bed availability uses `endDate > start`). Finance selects
   bookings with `endDate >= periodStart`, so a booking ending on the 1st of a month is billed for that whole extra
   month. Needs a one-character fix and an owner confirmation (§3.3).
4. **The two behaviours you flagged are real, and both are unintended side effects rather than decisions** (§3.3, §4).
5. **Integration tests, including all finance tests, do not run in CI.** CI runs `npm run test:database` (the
   migration test) only. `test:integration` is not wired in, and its helper refuses port 5432, which CI uses.
6. Ledger integrity is strong (append-only triggers, CHECK constraints, row and advisory locks, idempotency) with two
   gaps: nothing proves `paid_amount` equals the sum of its payments, and there is no way to void an invoice.

## 1. Evidence basis (read this before trusting any "passes")

| Evidence | What it covers | Status |
| --- | --- | --- |
| Code and migration reading | Everything in this plan | Done this session |
| **`nook_dev`** (temporary shim copy of the integration helper, deleted afterwards) | `finance.integration.test.ts` and `booking.integration.test.ts`, **68/68 passed**, run during Task 4E on 2026-11-02 | Executed earlier today; **not re-run for this audit** |
| Unit (no database) | `finance.util.test.ts` (money, months, IST, numbering, status) passed within the 44 API unit tests | Executed earlier today |
| **`nook_test`** | Nothing. The `nook_test` runtime role cannot read `_prisma_migrations`, and no migrator credential is available | **Never executed** |
| CI | Does not run the integration suites (finding 5) | Not evidenced |
| Production | None exists | None |

Passing tests are not treated as proof of completeness: §6 lists what the suite does not cover.

## 2. Existing implementation inventory

### 2.1 Data model (`prisma/schema.prisma`)

| Model | Purpose | Database guarantees (from the migrations) |
| --- | --- | --- |
| `Invoice` | Monthly rent invoice. `amount` snapshot, `paidAmount` = cash net of reversals **plus applied credits**, `adjustmentTotal` (≤ 0), `status`, `dueDate`, `periodStart/End` (DATE) | `UNIQUE(org, number)`, `UNIQUE(org, resident, periodStart)`, `amount > 0`, `0 ≤ paid ≤ amount`, `PAID ⇒ paid = amount`, `DRAFT ⇒ paid = 0`, `number ~ ^INV-[0-9]{4}-[0-9]{4,}$`, `−amount ≤ adjustment_total ≤ 0`, `paid + adjustment ≥ 0`, `due ≥ periodStart`; trigger forbids DELETE and changes to issued identity/amount |
| `Payment` | One payment → one invoice (single composite FK) | `amount > 0`; trigger makes rows immutable (UPDATE/DELETE refused); composite FKs bind org + resident + invoice; `UNIQUE(corrects_payment_id)`; trigger: a replacement may only correct a *reversed* payment on the same invoice |
| `PaymentReversal` | Append-only reversal | `UNIQUE(payment_id)`; reason 3–500 chars; immutable trigger |
| `InvoiceAdjustment` | Append-only credit (negative only) | `amount < 0`; reason 3–500; immutable trigger |
| `PaymentIdempotencyKey` | DB-backed idempotency | `UNIQUE(org, key)`, `UNIQUE(payment_id)`, key/hash format checks; immutable trigger |
| `AuditEvent` | Audit trail (shared) | `actor_user_id` is **nullable**, so a system actor is possible without schema change |

Receipts have no table: `RCPT-` + the full payment UUID is computed (`receiptNumber`), which satisfies the rule and
cannot collide.

### 2.2 API (`/api/v1/finance`, `finance.controller.ts` → `finance.service.ts`)

| Endpoint | Behaviour verified by reading the code |
| --- | --- |
| `POST invoices/generate-monthly` | Billing month ≤ next month (no lower bound). Takes the org advisory lock, selects eligible residents (§3), skips existing `(resident, period)`, numbers sequentially, `createMany(skipDuplicates)`, one batch audit event. Default **DRAFT**; `issue:true` → ISSUED |
| `POST invoices` | Manual draft. Amount from `booking.monthlyPrice` **or a free `amount` override**; does not check admission or check-in |
| `POST invoices/:id/issue` | Row-locked DRAFT → ISSUED, audited |
| `GET invoices`, `GET invoices/:id` | Filters, pagination, payment history |
| `POST payments` | `Idempotency-Key` required; advisory lock on key → row lock on invoice → balance re-read → overpayment refused → payment + invoice update + audit + key row in **one** transaction |
| `POST payments/:id/reverse` | Invoice row lock, then "already reversed" check, reason required, balance and status recomputed, audited with before/after |
| `POST invoices/:id/adjustments` | Credits only, ≤ remaining balance, reason required, audited |
| `GET invoices/:id/receipt` | Per-payment receipts, reversed ones marked |
| `GET outstanding`, `GET reports/monthly`, `GET corrections` | Read models; overdue is **derived** from the due date at read time |

No endpoint exists to **cancel/void** an invoice although `CANCELLED` is in the enum, the payment path refuses it and the
immutability trigger says "cancel instead".

### 2.3 Frontend (`apps/web/src/finance/`, mounted at `#finance`, sidebar item exists)

Overview dashboard, invoice list, invoice detail (issue, record payment, credit, reverse), new invoice / generate
monthly, outstanding, monthly reports, corrections history, printable receipt, `RecordPaymentModal` (client generates
one idempotency key per attempt and reuses it on retry). Foundations are substantial; §7 lists the gaps.
Web tests cover helpers only (`financeHelpers.test.ts`); there are no component or browser tests.

## 3. Business-rule verification

Legend: ✅ implemented and read in code · ⚠️ partial/ambiguous · ❌ missing.

| Frozen rule | Result | Evidence |
| --- | --- | --- |
| INR | ✅ | `Decimal(12,2)`; UI formats ₹. No currency column (single currency by design) |
| Calendar-month cycle, monthly | ✅ | `parseBillingMonth`, `periodEnd` = last day |
| Full rent first and final month, no proration | ✅ | amount is always `booking.monthlyPrice`; tests cover late move-in and mid-month checkout |
| Rent source `Booking.monthlyPrice` | ⚠️ | Generation: yes. **Manual draft allows an `amount` override** (even with a booking) |
| Default due date: 5th | ✅ | `defaultDueDate`; late generation unresolved (§4.1) |
| Automatic monthly generation | ❌ | no scheduler |
| Automatic issuance, no approval | ❌ | generation defaults to DRAFT; UI has an "issue immediately" checkbox |
| Manual collection; CASH, UPI, BANK_TRANSFER | ✅ | `PAYMENT_METHODS`, DB enum |
| Partial payments; overpayment rejected | ✅ | remaining-balance check under row lock; `paid ≤ amount` CHECK as backstop |
| Overdue reviewed by owner; no auto-cancel | ✅ | overdue derived, no side effects anywhere |
| `INV-YYYY-NNNN` per org, Asia/Kolkata year | ⚠️ | Sequential and gap-free (advisory lock + `MAX()+1`, unique backstop). **Year is the year at generation time, not the billing period's year** (§4.2 item b) |
| `RCPT-` + full payment UUID | ✅ | |
| Draft cannot take payments | ✅ | 400 |
| One payment, one invoice | ✅ | |
| Append-only payment history | ✅ | triggers + corrections via reversal/credit |
| Never carry unpaid balance into a new invoice | ✅ | no carry logic exists; each invoice is the booking price only |
| No Razorpay | ✅ | no reference anywhere in `apps/` or `prisma/` |
| OWNER and PROPERTY_MANAGER | ✅ as approved | Scope register (2026-11-02) approved **equal access**; no route checks role. Tests confirm both can reverse and credit |

### 3.1 How eligibility actually works (`generateMonthly`)

A resident is billed for a month if they have a check-in (most recent wins; one invoice per resident per period) where:

- `checkInAt` < start of the **next** month in IST (so a move-in on the last day is billed that month in full), **and**
- the check-in is `ACTIVE`, **or** its check-out time ≥ IST start of this month (so the checkout month is billed in full),
  or (legacy) a `CHECKED_OUT` row with no `check_outs` row and `updated_at` in/after the month, **and**
- `admission.status = ADMITTED`, **and**
- `resident.status = ACTIVE`, **and**
- `booking.status = CONFIRMED`, `booking.startDate < nextPeriodStart`, `booking.endDate >= periodStart`.

Then amount = `booking.monthlyPrice`; zero-price bookings are skipped and counted; existing invoices are skipped.

### 3.2 Scenario table

| Scenario | Today's behaviour | Verdict |
| --- | --- | --- |
| Booked and admitted, **not checked in** (including a no-show) | Not billed. Billing starts at check-in, not at booking start | Consistent design; confirm (§4.7) |
| Future-dated check-in | Not billed until its month begins | OK |
| Move-in on the 31st | Full month | OK, per rule |
| Early check-out | That month billed in full; later months excluded | OK, per rule. Matches the 4E documentation |
| **Overstay beyond `booking.endDate`** | Drops out of billing from the first month that begins after `endDate`, while still `ACTIVE` in the bed | **Unintended revenue leak** (§4.3) |
| **Booking ends exactly on the 1st** (exclusive end) | The new month is still billed | **Likely over-billing defect** |
| **Booking/admission cancelled after check-out** | Stay vanishes from not-yet-generated invoices, even for months actually occupied | **Unintended** (§4.4). Since 4E, cancellation is refused *while* active, but allowed after check-out |
| Resident set INACTIVE/ARCHIVED while checked in | Not billed | Plausible, but nothing prevents archiving an occupant; decision (§4.7) |
| Duplicate run for the same month | Second run skips existing, `created: 0` | OK (tested, including concurrent) |
| Manual draft then generation, same resident and month | Generation skips it; the draft stays whatever the user typed (possibly a different amount) | Acceptable; note in UI |

### 3.3 Verdict on the two reported behaviours

- *"Cancelling a booking or admission after check-out removes the stay from invoices not yet generated."* Real, and
  **incorrect as a side effect**: the finance filter reads current booking/admission status instead of the facts of the
  stay. It silently loses rent for months already occupied. It is not a documented business decision. Needs your choice
  between two safe options (§4.4).
- *"A resident who overstays beyond `booking.endDate` falls out of billing."* Real and **incorrect as a side effect**: the
  frozen rules give no basis for free occupancy. It is also a business decision *what* to bill (§4.3).
- Related, not previously reported: the **exclusive-end-date mismatch** above.

## 4. Outstanding policy decisions — owner approval required

For each: options, trade-offs, my recommended safe default. None are implemented or assumed.

### 4.1 Due date when the invoice is created after the 5th
- **A. Keep the 5th** (current): simplest, predictable. A mid-month or catch-up invoice is born overdue and shows in the
  owner's overdue review immediately — noise and an unfair "late" signal.
- **B. Due = later of the 5th and the issue date (IST)**: nobody is overdue on day one. Slightly less predictable.
- **C. Issue date + N days** always: predictable grace but breaks "5th" for the normal case.
- **Recommend B.** Due date is chosen at generation, never silently changed later.

### 4.2 GST / tax
- Nothing in code or docs addresses tax. Invoices carry a single `amount`; there are no tax columns.
- Whether GST applies to hostel/PG rent depends on the facts (residential vs commercial use, charge thresholds) and is a
  **tax-advice question I cannot settle**. Needs the owner's CA to confirm before real billing starts.
- **Recommend:** pilot with no tax, label documents "Invoice" and "Receipt" (not "Tax invoice"), and confirm in writing
  that this is acceptable. If tax is required, add `taxRate`/`taxAmount` and a `total` **before** any invoice is issued:
  `amount` is immutable once issued, so retrofitting is a migration plus a re-issue problem. Tax configuration (rate,
  GSTIN, SAC) would be new owner-managed settings, so decide now whether the pilot needs them.
- Also decide invoice-year numbering: **(a)** year of the billing period vs **(b)** year of generation (current).
  Under (b), generating January invoices in December yields `INV-2026-…` for a 2027 period, and back-filling gives
  `INV-2027-…` for 2026. **Recommend (b)** (issue date, simplest, never renumbers history) but state it.

### 4.3 Overstay
- **A. Keep bill-by-booking-dates** (current): revenue leaks silently.
- **B. Bill every month a check-in is `ACTIVE`, at the booking's `monthlyPrice`**, and flag the stay as "past booking end"
  on the dashboard: no silent leak; rent source is still the booking.
- **C. Block until the booking is extended:** safe but relies on staff acting.
- **Recommend B.** It is a billing decision (charging beyond the contract), so it needs your explicit approval.

### 4.4 Cancellation after check-out, before invoice generation
- **A. Bill from the stay, ignore later cancellation** (eligibility = check-in/check-out facts + resident). The booking
  still provides the price even if cancelled. Rent for occupied months is never lost.
- **B. Refuse cancelling any booking/admission that has a check-in on record** (not just an active one). Keeps the current
  filter correct and removes the ambiguity at the source; but staff cannot clean up a mistaken booking after the fact.
- **Recommend B** (smallest change, consistent with 4E's guard) **plus** keeping the `CONFIRMED`/`ADMITTED` filter as a
  second line. Choose A instead if historical cancellations must remain possible.

### 4.5 Which months should the scheduler generate?
- **Recommend: the current IST month only**, run daily; idempotent, so it also picks up mid-month move-ins and a late
  run. It never creates a *future* month automatically.
- Future months stay a **manual** owner action (already allowed up to next month). Auto-billing next month would bill
  residents who may check out first, and would fix prices before the owner can change a booking.
- Trade-off: invoices for next month cannot be sent before the 1st. Accepted for the pilot.

### 4.6 Missed scheduler runs
- Daily idempotent runs make a one-day miss self-healing. For longer outages, **auto catch-up only for the previous
  month**; anything older needs an explicit owner action, because back-filled invoices carry old due dates and, under
  (§4.2b) new-year numbers.
- Every run (success, skipped, failed) must be visible to the owner. Today there is no run record.
  **Recommend** a small run-log table (`finance_runs`: month, started, finished, created, status, error) or reuse
  `audit_events` with a system actor (actor is nullable). The table needs a migration → needs approval.
- **Mechanism needs a decision**: in-process `@nestjs/schedule` (new dependency, the scope register requires owner
  approval of dependencies; duplicates across instances are safe because generation is advisory-locked and unique) vs. an
  external cron or platform scheduler calling a secret-protected internal endpoint (no dependency, but the hosting target
  for the API is not recorded in the repo).

### 4.7 Smaller confirmations
- Billing begins at check-in, not at booking start (a no-show resident is not billed).
- Residents archived while checked in: warn or refuse archiving an occupant.
- Manual drafts: keep the free `amount` override? (Recommend: allow only with a mandatory reason, or remove.)
- Equal OWNER / PROPERTY_MANAGER access for reversals and credits was approved 2026-11-02; reconfirm for money-moving
  corrections, because the frozen rule says overdue is "reviewed by the owner".
- Add an invoice **void** (DRAFT or unpaid ISSUED with a reason, append-only) or accept credit-to-zero as the only route?

## 5. Architecture and safety review

| Area | Finding |
| --- | --- |
| Organization isolation | ✅ `organizationId` comes only from the session; every query filters by it; composite FKs bind invoice↔resident↔org, payment↔invoice↔org. Tests cover cross-org read/write and an ignored client `organizationId` |
| Invoice numbering | ✅ per-org `pg_advisory_xact_lock` then `MAX()+1`; unique index backstop; rolled-back transactions leave no gap. Collision risk of the 64-bit lock hash is negligible. Numbers ≥ 10,000 are allowed by the CHECK |
| Duplicate prevention | ✅ in-transaction existence check **and** `UNIQUE(org, resident, period)` with `skipDuplicates` |
| Idempotent generation | ✅ for the API. Not applicable to a scheduler that does not exist |
| Payment consistency | ✅ one transaction: payment, invoice update, audit event and idempotency key together; tested rollback |
| Lock ordering | ✅ no inversion: only the payment path takes two locks (key advisory → invoice row), always in that order; reversal, credit and issue take only the invoice row |
| Reversal and credit auditability | ✅ append-only rows, mandatory reason, in-transaction audit with before/after balance and status |
| CSRF / Origin | ✅ on every write (`OriginGuard`, `CsrfGuard`), tested including unauthenticated requests |
| Permissions | ⚠️ Both roles can do everything (as approved). No finer control exists |
| Database constraints | ✅ strong, see §2.1 |
| **`paid_amount` is a cache with no cross-check** | ❌ No constraint or test proves `paid_amount = Σ(non-reversed payments) − adjustment_total`. A future code path that updates one without the other would drift silently |
| **`receivedAt` time zone** | ⚠️ `new Date(string)` on a zone-less value uses the **server's** zone. The web client always sends a full ISO instant, but a direct API call would not. Same class of bug fixed in 4E for check-ins |
| **Reports use UTC month boundaries** | ⚠️ `monthlyReport` filters `receivedAt` by UTC month start. A payment at 23:00 IST on the last day (17:30 UTC) is correct, but one at 01:00 IST on the 1st (19:30 UTC the day before) lands in the previous month. Invoice periods are IST by rule |
| Issuance audit | ⚠️ Auto-issue in `generateMonthly` writes one batch event, **no per-invoice `finance.invoice.issued`** event, unlike the single-issue path |
| Receipt `balanceAfterPayment` | ⚠️ Computed from current credits, not from the credits that existed when the payment was recorded; can misstate historical receipts after a later credit |
| Invoice void | ❌ missing (§2.2) |
| Zero-price bookings | ⚠️ skipped silently apart from a counter (CHECK `amount > 0`); surface in the run report |
| Money-moving concurrency under `nook_test` / CI | ❌ not evidenced (§1) |

## 6. Test plan

### 6.1 What exists (`finance.integration.test.ts`, 1,820 lines, plus `finance.util.test.ts`)
Covered: duplicate prevention, concurrent generation (unique, gap-free), concurrent manual drafts, idempotent generation,
concurrent payments never overpay, idempotency (replay, conflict, concurrent, rollback, tenant), reversal (once,
concurrent, race with a new payment), replacement payments, credits (never beyond balance, concurrent), append-only
triggers, audit before/after, cross-org access, CSRF/Origin, unauthenticated access, both roles, early checkout,
last-day move-in, checkout-before-period, status-only checkouts, IST invoice year.

### 6.2 Missing — to be written in 4F

| Case | Level | Why it matters |
| --- | --- | --- |
| Duplicate **scheduler** execution (two ticks, two instances) | integration | the scheduler does not exist yet |
| Missed-run recovery: skipped day, skipped month, catch-up limit, no future months | integration | policy §4.5–4.6 |
| Scheduler run log is written on success, no-op and failure; a failed run does not stop other organizations | integration | owner visibility |
| Scheduler issues automatically; per-invoice audit event | integration | frozen rule |
| Booking ending exactly on the 1st (exclusive end) | integration | defect |
| Overstay past `endDate` (per the decision) | integration | decision §4.3 |
| Cancellation after check-out (per the decision) | integration | decision §4.4 |
| Future-dated booking and future-dated check-in across month boundary | integration | currently only implied |
| Booking-start-before-check-in, no-show, never checked in | integration | confirms §4.7 |
| Resident archived while checked in | integration | |
| Due date: generated after the 5th, per the decision | unit + integration | §4.1 |
| Invoice-year numbering across 31 Dec / 1 Jan IST (a run at 18:30 UTC) | unit + integration | rollover |
| `paid_amount` reconciliation invariant after random mixes of pay / reverse / credit / replace, run concurrently | integration (property-style) | cache integrity |
| Concurrent partial payments that sum **exactly** to the balance with different keys | integration | partly tested; add many-way |
| Reversal racing credit, credit racing payment, issue racing payment | integration | only reversal×payment is covered |
| `receivedAt` zone-less value and IST month-boundary reports | unit + integration | §5 |
| Receipt balance history after a later credit | integration | §5 |
| Invoice void: only permitted states, append-only, payment refused afterwards, audited | integration | new endpoint |
| Role matrix after any decision to restrict reversals/credits | integration | decision §4.7 |
| Browser tests: generate, issue, pay (partial, full, overpay error), reverse, credit, receipt print, mobile width | browser | none exist |

### 6.3 Where each will run
- Unit: no database, runs anywhere.
- Integration and concurrency: **`nook_dev`** for development feedback only (throwaway; leaves `4E-TEST`/test orgs
  behind — 4E left roughly 144), via the existing guard-respecting approach.
- **`nook_test`: required before any acceptance claim**, which needs a migrator credential that does not exist yet.
- CI: must run `test:integration` against its own database; today it does not (finding 5).
- No test touches production, and none will be described as production-ready.

## 7. UI implementation plan

Already present and kept: dashboard, invoices, detail, payment, credit, reversal, outstanding, reports, corrections, receipt.

To add or fix:
1. Billing run status panel on the Overview: last run, month, created / skipped / failed, next run, "run now" for the owner,
   and a list of skipped residents with the reason (zero price, overstay, no check-in).
2. Replace the "Issue invoices immediately" checkbox with the policy outcome (automatic by default; manual run stays
   available, showing what will happen before it happens).
3. Overstay and past-booking-end flags; "occupied but not billed" list, so a revenue leak is visible.
4. Resident ledger: invoices, payments, reversals, credits for one resident, linked from the resident page.
5. Overdue review view for the owner (days overdue, last payment, follow-up notes are **out of scope**: no automatic action).
6. Invoice void action and its history, once approved.
7. Show due-date rule used ("5th" / "issue date") on each invoice.
8. Payment date: send an explicit IST instant; show times as IST; fix the browser-zone noon assumption.
9. Mobile layout, keyboard and screen-reader checks for the modals; loading, empty, error and success states reviewed.
10. Printable receipt/invoice wording per the tax decision (§4.2).

Out of scope: Razorpay, refunds, general ledger, SMS/WhatsApp reminders, tax filing.

## 8. Milestones

| # | Milestone | Content | Needs approval first |
| --- | --- | --- | --- |
| **4F.0** | **Commit the existing finance work** | Finance code, migrations and tests are untracked; commit them (by explicit path) before changing anything, so every later diff is reviewable | your go-ahead to commit |
| **4F.1** | Correctness fixes | Exclusive booking end; decisions §4.3/§4.4 implemented; IST month boundaries in reports; `receivedAt` IST handling; per-invoice issue audit; due-date policy §4.1; receipt balance history; manual-amount override rule. No schema change | decisions 4.1, 4.3, 4.4 |
| **4F.2** | Automatic generation and issuance | Scheduler (mechanism per §4.6), system actor, auto-issue, current-month idempotent runs, previous-month catch-up, run log | scheduler mechanism and dependency; run-log migration; decisions 4.5, 4.6 |
| **4F.3** | Integrity and concurrency hardening | `paid_amount` reconciliation (query + test + optional DB check), invoice void, new race tests, CI runs `test:integration` | migration approvals; migrator credential |
| **4F.4** | UI completion | §7 | decisions on void and tax labels |
| **4F.5** | Verification and pilot readiness | Full suites on `nook_dev` and **`nook_test`**, browser tests on desktop and phone width, reconciliation run, runbook (missed run, wrong payment, wrong invoice), honest known-limitations list | `nook_test` access |

Sequence: 4F.0 → 4F.1 → (4F.2 ∥ 4F.3) → 4F.4 → 4F.5. Nothing starts without the matching approvals.

## 9. Decisions requested from the owner

1. Commit the untracked finance work as the baseline? (4F.0)
2. Due date for invoices created after the 5th: A, B (recommended) or C? (§4.1)
3. Tax: does the pilot bill with no GST? Confirmed with the CA? Add tax fields now or later? (§4.2)
4. Invoice-number year: generation year (recommended) or period year? (§4.2)
5. Overstay: A, **B (recommended)** or C? (§4.3)
6. Cancellation after check-out: A or **B (recommended)**? (§4.4)
7. Scheduler scope: current month only (recommended)? Catch-up only the previous month? (§4.5, 4.6)
8. Scheduler mechanism: in-process dependency vs external cron; where is the API hosted? (§4.6)
9. Approve a run-log table (migration)? (§4.6)
10. Equal OWNER/PROPERTY_MANAGER access for reversals and credits: keep or restrict? (§4.7)
11. Invoice void: add it? Keep free `amount` on manual drafts? (§4.7)
12. Provide a migrator credential for `nook_test`, and approve wiring `test:integration` into CI.

## 10. Risks if the plan is not followed

- Real billing started on the current build would leave invoices in DRAFT unless someone presses the button each month.
- Over-billing one month for bookings that end on the 1st, and under-billing overstays, are both silent.
- The finance code lives only in the working tree.
- Acceptance would rest on tests that CI does not execute and that have never run on `nook_test`.
