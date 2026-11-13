# NOOK — P4-2 Owner Decision Worksheet (aligned to Specification v1.3)

**Decision aid only. Every choice is `RECOMMENDED — NOT APPROVED`. Owner fields are blank.**

Workspace: `~/Downloads/nook-phase4-1` · Authoritative document: [P4-2 Specification v1.3](P4-2_SPECIFICATION_v1.3_FINAL_FOR_OWNER_APPROVAL.md) (section numbers below refer to it). Updated 2026-11-08. This worksheet was reconciled with v1.3 and supersedes its earlier v1.2-based text, which was a historical input.

**Status rules.** A recommendation is not an approval. Nothing here authorizes P4-2.1 or any later slice, any migration, any database operation, or production use. The only owner-approved items are the ten **frozen** directions below; they are not questions. For each decision, record ACCEPT / REJECT / AMEND / DEFER in the blank field. REJECT or DEFER never creates a default permission or waives a frozen rule; an AMEND must be a complete replacement that is reconciled across v1.3 before implementation scope is granted.

## Frozen directions (approved — not reopened)

Explicit allowlist only · approval of every consequential correction · no self-approval · OWNER-only financial and exceptional-history approval · controlled historical correction with reason and approval · authoritative recalculation of genuinely unissued billing under approved rules only · immutable issued invoice facts with separately approved adjustments · room/bed corrections deferred to P4-3 · permanent retention of rejected proposals · indefinite retention of original values and correction history, subject to applicable legal/privacy requirements. Also preserved: phone/email verification outside P4-2; checkout does not silently cancel bookings, rewrite invoices, issue credits/refunds or settle deposits; no fabricated checkout; no automatic extra occupancy billing; no unauthorized reopening; full first-month rent; separate invoices per booking per month; manual overdue review; unresolved GST/tax; no uploads/KYC, refunds/settlement, transfers or public self-service.

**Blocking key:** *P4-2.1* = schema/contracts (not authorized) · *P4-2.2* = submit/review API · *P4-2.3 + P4-2.4* = lock protocol and Finance, **joint independent review required before any financial correction application** · *P4-2.6* = acceptance, **requires explicitly authorized disposable PostgreSQL**. No concurrency, lock-timeout, deadlock or constraint-error behaviour has been tested; criteria A1–A10 (v1.3 §16.2) are unexecuted.

---

## Decision 1 — Exact correction allowlist (v1.3 §4)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT** the nine fields: Resident `firstName`, `lastName`; Booking `startDate`, `endDate`, `monthlyPrice`; Admission `admissionDate`; CheckIn `checkInAt`; CheckOut `checkOutAt`, `reason`.
* **Exact policy:** the §4 validation table; no-op replacement is 400; one field per proposal; booking end date cannot be lengthened by correction (extension command only); `monthlyPrice` needs evidence of the original agreement and never covers renegotiation; no phone/email, status, assignment, payment/invoice, deposit, document or arbitrary-path fields. **Open sub-choice:** invoices/receipts show the *current* resident name (no issued-name snapshot exists); recommended: keep current-profile rendering, labelled, and add no snapshot in P4-2.
* **Trade-offs:** typed dispatch and ordinary-route restrictions are required; removing a field reduces capability, adding one needs new analysis; a corrected name changes later invoice rendering.
* **Blocking:** P4-2.1.
* **Owner selection (ACCEPT / REJECT / AMEND / DEFER):** __________ · **Invoice-name display choice:** __________
* **Approval status: NOT APPROVED**

## Decision 2 — Roles and financial classifications (v1.3 §5)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT** the §5 matrix.
* **Exact policy:** OWNER and PROPERTY_MANAGER submit and view; either, if independent, reviews normal non-financial requests (including an OWNER's); only a different OWNER reviews (approves **or rejects**) financial or exceptional-history requests; requester-only withdrawal; no self-review. All booking, admission-date and physical-time fields are conservatively financial even at zero monetary change; names and checkout reason are non-financial unless exceptional by age. Membership is re-read on every attempt and replay.
* **Trade-offs:** OWNER workload and possible delays for financial fixes; admission-date OWNER review is a precaution (Finance rent does not read it); the existing Finance controller admits both roles, so correction-linked remedy gates must be added at service level.
* **Blocking:** P4-2.2.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 3 — Normal historical lookback (v1.3 §6)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **AMEND**: 90 inclusive Asia/Kolkata calendar days with the precision wording below.
* **Exact policy:** age is the non-negative difference of IST calendar-day ordinals between the evaluated date and the earliest candidate day (effective day; original and proposed days of date fields; category anchor: resident creation for names, original booking start for booking dates/price, original admission day, original check-in/out day, original checkout day for reason). 0–90 normal; 91+ exceptional. Missing required anchors fail closed (never `updatedAt`/now). Future `effectiveAt` and physical instants are prohibited. Re-evaluated at approval.
* **OPEN owner choice — approval-time sampling:** recommended: sample one trusted instant after all locks and revalidation, immediately before application; use its IST day for the final check; persist it with the policy version and basis; resample after any retry. Alternative: commit-day eligibility. **This is Decision 3's rule; it is independent of Decision 10's SLA and of Decision 16's timeouts.**
* **Trade-offs:** 30 days = more exceptions, 180 = larger ordinary authority; 90 is a product balance, not a legal figure; the resident-creation anchor makes an old resident's name typo exceptional.
* **Blocking:** P4-2.1 (decision-time fields), P4-2.3.
* **Owner selection (duration / sampling rule):** __________ · **Approval status: NOT APPROVED**

## Decision 4 — Exceptional corrections and evidence (v1.3 §6)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT**.
* **Exact policy:** beyond the normal window, a different active same-organization OWNER with mandatory evidence and an explicit exception rationale; no separate maximum age; no third approver; no entitlement to apply. Evidence mandatory for historical financial/occupancy corrections, every exceptional correction and every `monthlyPrice` correction; optional for in-window names/reason. Evidence is a 1–2000-character reference/description (no bytes, no credential URLs); the reviewer records adequacy; immutable payloads, so insufficient evidence ends in rejection and a new linked proposal. Approval-time shortfall returns `EVIDENCE_REQUIRED`/`INSUFFICIENT_ROLE`.
* **Trade-offs:** old facts may be unreconstructable; no cap does not create a supported money remedy; alternatives (1- or 3-year cap, two-reviewer exceptions) are owner options needing separate design.
* **Blocking:** P4-2.2.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 5 — Pending proposal granularity (v1.3 §8.3, §9)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **AMEND, retain Model B**.
* **Exact policy:** one PENDING proposal per organization/target/field; one scalar field per proposal; five partial unique indexes; **no grouped corrections in this release**; named captured dependencies, never bare `updatedAt`; identified dependency change → terminal `STALE`; range/absence/invariant conflicts → `LIFECYCLE_CONFLICT`, proposal stays PENDING; a changed financial preview the reviewer approved → `STALE_SOURCE`; authorization, role, self-review and terminal-state checks precede stale evaluation; apply only the target column (no full-row write-back); timestamp precision handled explicitly (raw-text capture; raw SQL for sub-millisecond writes, or state millisecond precision). **Archived residents (resolved as a recommendation): name corrections remain possible and resident status is not a stale dependency.** The unsupported multi-field booking end states and required ordering (admission → booking → check-in) are listed in §9.5; not all compound repairs are reachable (e.g. `[10,20)`→`[25,30)` with a neighbour on `[20,25)` is unsupported).
* **Trade-offs:** resubmission and repeat reviews for interdependent fields; false stales from the price↔date and `checkOutAt`↔`reason` couplings; some repairs impossible until a separately authorized grouped workflow exists. Option of deferring the interdependent chain.
* **Blocking:** P4-2.1 (indexes/CHECKs), P4-2.3.
* **Owner selection:** __________ · **Archived-resident rule:** __________ · **Approval status: NOT APPROVED**

## Decision 6 — Locking strategy (v1.3 §10)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **AMEND: scoped exclusive organization gate** (v1.2's shared/exclusive hybrid is not the first-release recommendation).
* **Exact policy:** exclusive transaction-scoped advisory gate, derived and acquired by **one shared helper**, taken by: Booking create/update/extend/cancel; Admission create/update/approve/cancel/reopen; check-in create, check-out and check-in notes; Finance `createDraft`, `issue` and `generateMonthly` (controller and scheduler, acquired in the service); correction submission and application for booking, admission, `checkInAt` and `checkOutAt`. **Not** taken by standalone settlement (payment, reversal, credit, void), reads and dry runs, resident-profile edits, resident/enquiry creation, name corrections, checkout-reason corrections, reject/withdraw. Order: command-key lock → proposal row → gate → invoice-number lock → ordered rows (Bed → Resident → Booking → Admission → CheckIn → CheckOut) → Invoice, accounting for implicit foreign-key locks and triggers (e.g. `Admission.create` must lock Bed → Resident → Booking before inserting). Transaction-local `lock_timeout` and explicit Prisma options for every gate acquirer (ordinary 3 s, correction 5 s). All authoritative reads feeding a write or amount occur inside the transaction after the gate. Correction handlers use only the caller's transaction client. **The gate does not solve settlement races:** correction code must never hold a Resident row lock and then take an Invoice lock; a safe invoice-locking strategy must be chosen and proved jointly in P4-2.3/P4-2.4. **Scheduler/manual generation fail closed** on correction-created billing gaps (v1.3 §10.4). **Inventory:** validators must not read bed/room/floor/property state; if any does, those inventory mutations join the gate — unresolved implementation gate. Criteria A1–A10 are kept and unexecuted.
* **Trade-offs:** org-wide serialization of covered operations (proportionality at ~100 beds is **unmeasured**); long monthly generation holds the gate (mitigation: per-booking batching); fallback is a separately reviewed shared-mode design with its fixes.
* **Blocking:** P4-2.3, P4-2.4 (joint review), P4-2.6 (disposable-PostgreSQL evidence). Financial correction application stays disabled until both.
* **Owner selection / lock design:** __________ · **Billing-gap rule:** __________ · **Approval status: NOT APPROVED**

## Decision 7 — CheckOut tenant-safe reference (v1.3 §8.5)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT Option A**.
* **Exact policy:** `CheckOut.id` stays the target identity; keep the existing `CheckOut.organizationId`; add only `UNIQUE(id, organization_id)`; direct composite FK `(check_out_target_id, organization_id)` → `check_outs(id, organization_id)`, RESTRICT/RESTRICT; no new tenant column, primary key or `checkInId` identity. Clarifications: (1) enum `CHECK_OUT` ↔ audit string `check_out`; (2) replacement-`Payment` links are in scope (existing key); (3) the link's resident/booking must equal the proposal target's (an invoice FK alone does not prove it); (4) the tracked generated client and CI migration manifests are in P4-2.1 review scope. Prisma can express the optional composite relations but **not** the partial indexes, CHECKs or triggers, which need reviewed SQL.
* **Trade-offs:** one redundant unique index; an index build that blocks `check_outs` writes (behaviour in a Prisma migration unconfirmed).
* **Blocking:** P4-2.1.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 8 — Finance remedies (v1.3 §13.1)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT** verified operations only.
* **Exact policy:** balance-limited credit, payment reversal, replacement payment, guarded void, and manual replacement (`createDraft` + `issue` after an eligible void), each after a separately approved independent-OWNER remedy decision, enforced at service level for correction-linked remedies with a server-verified association (not an optional client flag). No debit note, write-off, tax correction, paid-invoice refund or deposit/settlement.
* **Trade-offs:** fully paid invoices may have no supported remedy; more manual cases.
* **Blocking:** P4-2.4.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 9 — Draft consequences (v1.3 §13.2)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT**.
* **Exact policy:** Finance-only, transaction-aware recalculation of genuinely unissued drafts (DRAFT, `issuedAt` null, no issue/void/payment/credit evidence); a draft no longer eligible is **voided with a recorded reason** (history retained) as part of the OWNER-approved preview, never deleted; legacy/ambiguous linkage fails closed; approval never creates or issues an invoice; `issue` validates current eligibility and amount under the gate.
* **Trade-offs:** rejecting voiding means affected approvals fail closed; the helper does not exist yet.
* **Blocking:** P4-2.4.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 10 — Unresolved issued-invoice remedies (v1.3 §13.3)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT** factual APPLIED coexisting with visible `REVIEW_REQUIRED` and separate OWNER resolution.
* **Exact policy:** APPLIED means only the source fact changed; the review does not block payment, imply a write-off or change an issued invoice; a "no supported remedy" outcome is recorded with reason. Correction-created billing gaps are suppressed from generation until an independent OWNER resolves them (Decision 6).
* **Trade-offs:** truthful facts sooner but an OWNER backlog and a visible mismatch between corrected facts and historical invoices.
* **Blocking:** P4-2.4. **The sub-decisions below do not block until approved.**
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

### Decision 10 operational sub-decisions — new recommendations, **NOT approved, not v1.2/v1.3 source rules**

Safeguards for every option: no automatic refund, debit note, write-off, tax correction, retrospective issuance or settlement; expiry, reminders and notices never change an invoice or payment, block payment, reopen a fact, or grant authority; REVIEW_REQUIRED stays visible until a separate authorized resolution. **The SLA is a financial-review service target, separate from correction age (Decision 3), decision-time sampling and every retry/timeout value (Decision 16).**

**10.1 Accountability** — `RECOMMENDED — NOT APPROVED`: a named responsible OWNER (an eligible independent OWNER where available) plus the organization OWNER queue as fallback, with recorded handovers that do not reset the clock; a sole-OWNER requester can track but cannot resolve; a manager may assist administratively, never resolve. Trade-off: assignment/handover history and queue work. Owner selection: __________ · NOT APPROVED

**10.2 Resolution deadline and `dueAt`** — `RECOMMENDED — NOT APPROVED`: three business days. Clock starts at the committed `appliedAt` (not the backdated `effectiveAt`). Convert `appliedAt` to its Asia/Kolkata date, exclude that date, count the next eligible business day as day 1; after three, `dueAt` = **00:00:00 Asia/Kolkata on the calendar day immediately after the final eligible business day**; overdue exactly when `now >= dueAt` while unresolved; never shifted to a business day; never computed as 72 hours. Business days Monday–Friday excluding an explicitly owner-approved holiday calendar — **neither the workweek nor any holiday list is approved, and an absent calendar is not an empty list.** Persist `appliedAt`, duration, calendar/policy version and basis alongside `dueAt` (future fields, none exist). Alternatives 1, 5 or 10 business days or an owner-defined calendar. Illustrations (no holidays): applied Friday or Saturday → due Thursday 00:00; Monday → Friday 00:00; Tuesday → Saturday 00:00. Owner selection: __________ · NOT APPROVED

**10.3 Escalation** — `RECOMMENDED — NOT APPROVED`: on creation queue the review and notify the responsible OWNER; 09:00 Asia/Kolkata on the due business day remind (not yet overdue); at `now >= dueAt` show in the overdue queue; 09:00 next business day escalate to the OWNER queue and another eligible independent OWNER; repeat each business day, at most one reminder per recipient per day; failed notices change nothing. With no eligible independent OWNER the review stays visibly overdue with that blocker; no bypass. Automated delivery needs later authorization and privacy review. Owner selection: __________ · NOT APPROVED

**10.4 Resident communication** — `RECOMMENDED — NOT APPROVED`: a neutral notice after the factual correction commits and another after a separate financial outcome, through an already permitted channel, never on a rolled-back or pending proposal, never promising a financial result, using Finance-authoritative figures only, minimal personal detail. No email/SMS capability is claimed. Alternatives: notify only after financial resolution; conditional on an owner-defined materiality threshold (not defined). Owner selection: __________ · NOT APPROVED

## Decision 11 — Withdrawal and reversal (v1.3 §7, §14)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT**.
* **Exact policy:** only the requester withdraws a PENDING proposal, with a reason; WITHDRAWN is retained permanently; reversal is a new same-target/field proposal referencing the applied one, capturing the current value, under all current rules; no blind restore, silent cancellation or end-date lengthening bypass; applied money consequences are never auto-reversed.
* **Trade-offs:** reversal may need another independent OWNER and may be unsupported (lengthening).
* **Blocking:** P4-2.2.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 12 — Sole-OWNER handling (v1.3 §5)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT**.
* **Exact policy:** a different PROPERTY_MANAGER may review normal non-financial requests; a different OWNER is required for financial/exceptional; a sole OWNER reviews a manager's request but never their own; no eligible reviewer means PENDING with a visible blocker; no self-approval, delegation or external reviewer.
* **Trade-offs:** repairs may wait indefinitely; staffing is the owner's responsibility; a two-OWNER minimum or external reviewer would be separate design.
* **Blocking:** P4-2.2.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 13 — Contact-field exclusion (v1.3 §4, §14)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT**.
* **Exact policy:** phone/email are not correction fields; existing contact edits are neither redefined nor certified verified.
* **Trade-offs:** no correction path for contacts until a verification policy exists.
* **Blocking:** none.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 14 — Retention details (v1.3 §14)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **ACCEPT**.
* **Exact policy:** protected values; permanent withdrawal and review history; minimized general audit metadata; role/tenant-restricted detail; receipts hold codes and ids only; no secrets or document bytes; no tamper-proof claim. Production needs privacy/legal review of indefinite retention, backups and any erasure/restriction process.
* **Trade-offs:** durable accountability versus retained personal data and storage/backup/access workload.
* **Blocking:** P4-2.1; production release.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 15 — Routine-edit and commercial boundaries (v1.3 §4)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **AMEND** (policy direction unchanged; coverage made source-accurate).
* **Exact policy:** the nine fields require correction after creation; ordinary `PUT`/`DELETE` routes refuse the **whole** request if it carries one (including mixed cancel/approve/reopen/archive payloads) before any branch runs, and the edit form stops sending unchanged names; creation, status transitions, check-in/out and the existing extension stay ordinary commands; address, emergency contact and the supported notes fields keep current permissions (Resident has no notes field); check-in notes on a legacy `CHECKED_OUT` row without a `CheckOut` are refused; admission room/property metadata is not transfer support; new commercial terms need a separate workflow.
* **Trade-offs:** coordinated form/API changes; legacy rows need handling; some commercial or historical repair requests remain unsupported.
* **Blocking:** P4-2.3.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

## Decision 16 — Retry and status contracts (v1.3 §11)

* **Recommended owner selection:** `RECOMMENDED — NOT APPROVED` — **AMEND**.
* **Exact policy:** terminal `STALE`, committed (returned by value) before HTTP 409; exact idempotent replay with original status; READ COMMITTED with locks; `maxWait`, `timeout`, `lock_timeout` and `statement_timeout` specified separately (correction: 10 s / 30 s / 5 s per acquisition bounded by remaining budget / optional backstop; ordinary gate acquirers `lock_timeout` 3 s; total deadline ≤ 45 s); at most two whole-transaction retries **only** for SQLSTATE 40P01/40001 read from the driver code, never from message text; no auto-retry of lock timeout (55P03, which the current adapter does not map), Prisma timeout/start failure, connection loss or unknown commit; P2028 classified by phase (before execution, expired before COMMIT, or uncertain during COMMIT) and never silently safe; unknown outcomes resolved by same-key re-POST; receipt and effect in one transaction; HMAC or stored-value comparison instead of a plain hash; `Idempotency-Key` header is the single source of `correlationId`; replay bound to tenant, actor, action, route/proposal and canonical request; authorization re-read on every attempt and replay; `staleCause` semantics and distinct `decidedAt`/`appliedAt`; codes `PENDING_CONFLICT`, `STALE_SOURCE`, `LIFECYCLE_CONFLICT`, `FINANCE_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `RETRY_REQUIRED`, `INVALID_STATE`, plus recommended new `EVIDENCE_REQUIRED`.
* **Trade-offs:** a retry wrapper and keyed hashing (a secret); `RETRY_REQUIRED` shares HTTP 409; none of the Prisma error shapes or lock-timeout behaviour is proven.
* **Blocking:** P4-2.1 (receipt/schema), P4-2.2, P4-2.3, P4-2.6.
* **Owner selection:** __________ · **Approval status: NOT APPROVED**

---

## Dependencies

| Decisions | Coupling | Must be settled before implementation |
|---|---|---|
| 1 ↔ 2 ↔ 15 | Fields determine classification and which ordinary edits are closed | One field list, classification and routine boundary |
| 3 ↔ 4 ↔ 12 | Age formula, exception route, reviewer availability | One age formula, sampling rule, evidence rule |
| 1 → 5 → 16 | Fields set slots, dependency groups, STALE/replay | One-field rule, indexes, snapshots, receipts agree |
| 5 ↔ 6 | Uniqueness vs snapshots vs gate | Indexes + under-lock revalidation; no grouping implied |
| 7 → 5/6 | Direct CheckOut target needs the tenant FK | Existing ownership reused; new unique independently reviewed |
| 6 ↔ 8/9/10 | Gate, Finance reads, scheduler/manual generation, settlement locks | Joint P4-2.3/P4-2.4 review; billing-gap rule; invoice-locking strategy |
| 8 ↔ 9 ↔ 10 | Remedy limits vs draft vs issued handling | Agreed together |
| 10.1–10.4 ↔ 2/8/9/12 | Tracking and SLA never confer authority | Accountable owner, calendar, escalation, truthful notices |
| 11/12/13/14 | Withdrawal, availability, contacts, retention | No self-review bypass; legal review before production |
| 16 ↔ 3/5/6/8–11 | Retry/idempotency across every atomic effect | Receipt and effect in one transaction; decision-time rule (Decision 3) |

Suggested discussion order: 1/2/15 → 3/4/12 → 5/6/7/16 with 8/9/10 → 11/13/14. A discussion order, not an approval order.

## Final approval summary (all owner cells blank)

| # | Decision | Recommended (NOT APPROVED) | Owner choice | Amendment | Status |
|---|---|---|---|---|---|
| 1 | Allowlist | ACCEPT |  |  | NOT APPROVED |
| 2 | Roles/classifications | ACCEPT |  |  | NOT APPROVED |
| 3 | Normal lookback | AMEND (90 d + precision; sampling open) |  |  | NOT APPROVED |
| 4 | Exceptions/evidence | ACCEPT |  |  | NOT APPROVED |
| 5 | Granularity | AMEND (Model B) |  |  | NOT APPROVED |
| 6 | Locking | AMEND (scoped exclusive gate) |  |  | NOT APPROVED |
| 7 | CheckOut reference | ACCEPT (Option A) |  |  | NOT APPROVED |
| 8 | Finance remedies | ACCEPT |  |  | NOT APPROVED |
| 9 | Draft consequences | ACCEPT |  |  | NOT APPROVED |
| 10 | Issued-invoice remedies (incl. 10.1–10.4, each unapproved) | ACCEPT coexistence |  |  | NOT APPROVED |
| 11 | Withdrawal/reversal | ACCEPT |  |  | NOT APPROVED |
| 12 | Sole OWNER | ACCEPT |  |  | NOT APPROVED |
| 13 | Contact exclusion | ACCEPT |  |  | NOT APPROVED |
| 14 | Retention | ACCEPT |  |  | NOT APPROVED |
| 15 | Routine/commercial boundary | AMEND |  |  | NOT APPROVED |
| 16 | Retry/status | AMEND |  |  | NOT APPROVED |

## Additional gates — separate from the 16 choices

1. Owner policy approval — pending. 2. Reconciled specification matching the owner's selections — pending. 3. P4-2.1 implementation authorization — **not granted**. 4. Disposable PostgreSQL testing authorization — **not granted**. 5. Independent schema/migration review (including generated client and CI manifests) — pending. 6. Joint P4-2.3/P4-2.4 transaction review — pending; financial correction application stays disabled until done. 7. Execution of A1–A10 and the 15 scenarios — not performed. 8. Production privacy/legal review — pending.

No gate is completed by this worksheet or by v1.3. Existing v1.0–v1.2 and the three review documents are unchanged historical inputs.
