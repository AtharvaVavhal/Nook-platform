# NOOK P4-2 — Implementation Audit Matrix

**Branch:** `feature/phase-4-1-lifecycle-audit`  
**Specification:** `P4-2_SPECIFICATION_v1.3_FINAL_FOR_OWNER_APPROVAL.md`  
**Worksheet:** `P4-2_OWNER_DECISION_WORKSHEET.md`  
**Date:** 2026-11-09

---

## Audit Matrix

| # | Requirement | Implementation | Test Evidence | Defect | Status |
|---|---|---|---|---|---|
| **1. Data Model & Schema** |
| 1.1 | `CorrectionProposal` with 9 allowlisted fields, typed targets, composite FKs | `prisma/schema.prisma:663-768` — enums, model with 5 nullable target columns, composite relations, `UNIQUE(id, org_id)`, `UNIQUE(org_id, requested_by, correlation_id)` | Schema present; migration **missing** (see 1.4) | Migration `20261108120000_p4_2_corrections` referenced but **absent**; partial indexes, CHECKs, triggers SQL-only | **PARTIAL** |
| 1.2 | `CorrectionCommandReceipt` — append-only, HMAC request check, unique per org/actor/key | `prisma/schema.prisma:770-790` — `UNIQUE(org_id, actor_id, idempotency_key)` | Unit: `corrections.service.test.ts:250-276` (receipt on submit/approve); Integration: `corrections.integration.test.ts:250-276` (idempotent replay) | None observed | **PASS** |
| 1.3 | `CorrectionFinanceLink` — billing gaps, invoice reviews, resolutions | `prisma/schema.prisma:792-830` — kinds `BILLING_GAP`, `INVOICE_REVIEW`, `RESOLUTION`; outcomes incl. `REVIEW_REQUIRED` | Integration: `corrections.integration.test.ts:534-616` (gap recorded, scheduler/manual skip); E2E: E7 | None observed | **PASS** |
| 1.4 | **Original migration file** (`20261108120000_p4_2_corrections/migration.sql`) | **MISSING** — referenced in `scripts/ci/g6b-migrations.json` but not in repo | E2E log: "DIAGNOSTIC SCHEMA: original corrections migration still missing" | **Blocker** — cannot certify migration history, partial indexes, CHECKs, triggers | **FAIL** |
| 1.5 | `CheckOut` gets `UNIQUE(id, organization_id)` for composite FK | Schema has `@@unique([id, organizationId])` at line 475 | Not exercised in tests | Migration required to create index (blocks writes during build) | **NOT TESTED** |
| **2. Correction Allowlist & Routine-Edit Boundary** |
| 2.1 | Exactly 9 fields: `firstName`, `lastName`, `startDate`, `endDate`, `monthlyPrice`, `admissionDate`, `checkInAt`, `checkOutAt`, `reason` | `corrections.rules.ts:11-45` — `FIELD_SPECS` with target, kind, financial, gated | Unit: `corrections.rules.test.ts:28-86` (parsing); Integration: all 9 tested via submit/approve | None | **PASS** |
| 2.2 | No-op replacement → 400 | `corrections.service.ts:492-495` | Unit: `corrections.service.test.ts:319-328` | None | **PASS** |
| 2.3 | One field per proposal | Enforced by 5 partial unique indexes (SQL) | Integration: `corrections.integration.test.ts:360-395` (race 1) | Depends on migration (1.4) | **PARTIAL** |
| 2.4 | Ordinary routes refuse 9 fields **before any branch** (Decision 15) | `corrections.bypass.test.ts:42-115` — Resident names, booking dates/price, check-in core timestamp refused at service entry | Unit: `corrections.bypass.test.ts` all pass | Check-in notes on legacy `CHECKED_OUT` without `CheckOut` refused (409) — correct per spec | **PASS** |
| 2.5 | Invoice name display — current profile name, no issued-name snapshot (open choice) | Not implemented (frontend renders current name) | Not tested | Spec §4: "RECOMMENDED — NOT APPROVED: keep current-profile rendering, label it, add no snapshot" | **OWNER DECISION REQUIRED** |
| **3. Authorization & Separation of Duties** |
| 3.1 | OWNER + PROPERTY_MANAGER submit/view | `corrections.rules.ts:244-246` `canSubmit`; controller uses session auth | Integration: `corrections.integration.test.ts:213-306` | None | **PASS** |
| 3.2 | Independent reviewer for approve/reject (self-review → 403) | `corrections.service.ts:642-643` (approve), `811-812` (reject), `831-832` (withdraw) | Unit: `corrections.service.test.ts:496-507` (self-review refused); Integration: E4, E5 | None | **PASS** |
| 3.3 | Financial + exceptional → OWNER only | `corrections.rules.ts:249-257` `reviewerRoleAllowed`; service checks at `644-646`, `668-672` | Unit: `corrections.service.test.ts:519-547`; Integration: E7 (manager refused) | None | **PASS** |
| 3.4 | Membership/role re-read from DB on every attempt & replay | `corrections.service.ts:188-190`, `303-318` `loadAuthority` | Unit: `corrections.service.test.ts:361-374` (revoked member cannot submit/replay) | None | **PASS** |
| 3.5 | Sole OWNER reviews manager's non-financial; never own; no delegation | Spec §5, Decision 12 | Not explicitly tested | Logic exists in `reviewerRoleAllowed` | **NOT TESTED** |
| **4. Historical Lookback & Evidence** |
| 4.1 | Normal window = 90 IST calendar days (Decision 3 AMEND) | `corrections.rules.ts:56` `NORMAL_WINDOW_DAYS = 90`; `ageDays`, `isExceptional` | Unit: `corrections.rules.test.ts:88-101` | None | **PASS** |
| 4.2 | Candidate days: effectiveAt, original/proposed, category anchor (createdAt, booking start, etc.) | `corrections.facts.ts:388-429` `candidateDays` | Unit: `corrections.rules.test.ts:88-101` (age calculation) | Missing required anchor → `LIFECYCLE_CONFLICT` (fail closed) | **PASS** |
| 4.3 | Evidence mandatory: monthlyPrice, exceptional, historical financial/occupancy | `corrections.rules.ts:259-269` `evidenceRequired` | Unit: `corrections.rules.test.ts:108-129`; Integration: `corrections.integration.test.ts:653-685` (price without evidence → 400) | None | **PASS** |
| 4.4 | Approval-time sampling rule (Decision 3 OPEN) | `corrections.service.ts:325-328` `sampleNow` uses `clock_timestamp()` after locks | Not explicitly tested as a distinct rule | Spec: "sample one trusted instant after all locks and revalidation, immediately before application" — implementation uses `clock_timestamp()` which is statement time, not a sampled decision instant | **PARTIAL** |
| 4.5 | Exceptional route: different active same-org OWNER, mandatory evidence, rationale | `corrections.service.ts:668-672` (exceptional check), `675-681` (evidence at approval) | Unit: `corrections.service.test.ts:593-625` (400-day-old resident needs evidence, exceptionRationale, OWNER) | None | **PASS** |
| **5. State Machine** |
| 5.1 | States: PENDING, APPLIED, REJECTED, WITHDRAWN, STALE | `prisma/schema.prisma:683-689` `CorrectionStatus` enum | All tests use these states | None | **PASS** |
| 5.2 | Transitions: none→PENDING (submit), PENDING→APPLIED (approve), PENDING→REJECTED (reject), PENDING→WITHDRAWN (withdraw), PENDING→STALE (stale dep) | `corrections.service.ts:430-593` (submit), `631-778` (approve), `780-822` (reject), `824-862` (withdraw) | Integration: full lifecycle in `corrections.integration.test.ts:213-336`; E2E: E1-E5, E8-E10 | None | **PASS** |
| 5.3 | STALE committed (audit + receipt) **before** HTTP 409 | `corrections.service.ts:691-717` — updates proposal to STALE, writes audit, returns `throwAfterCommit` | Unit: `corrections.service.test.ts:549-578` (STALE committed, replay returns same 409); Integration: `corrections.integration.test.ts:308-336` | None | **PASS** |
| 5.4 | Terminal states immutable (trigger) | `corrections.service.test.ts:124-128` fake enforces; SQL trigger in missing migration | Integration: `corrections.integration.test.ts:482-497` (DB rejects UPDATE/DELETE on terminal) | Migration required for production trigger | **PARTIAL** |
| 5.5 | Reversal = new PENDING proposal (REVERSAL/SUPERSEDES) | `corrections.service.ts:524-542` validates REVERSAL references APPLIED same field | Not tested end-to-end | Spec §7: reversal captures current value, all rules apply | **NOT TESTED** |
| **6. Dependency Snapshots & Staleness** |
| 6.1 | Named captured facts (not bare `updatedAt`) | `corrections.facts.ts:318-381` `snapshotFacts` with `GROUP:fact` keys | Unit: `corrections.rules.test.ts:139-153` (diffSnapshot) | None | **PASS** |
| 6.2 | Dependency groups per §9.2 (resident, booking_terms, admission, check_in, check_out) | `corrections.facts.ts:331-379` | Integration: `corrections.integration.test.ts:338-356` (unrelated sibling name + archive does not stale) | None | **PASS** |
| 6.3 | STALE on identified dependency change; LIFECYCLE_CONFLICT on range/absence/invariant | `corrections.service.ts:684-718` (stale check), `corrections.apply.ts:31-52` (validators → LIFECYCLE_CONFLICT) | Integration: `corrections.integration.test.ts:308-336` (STALE), `653-685` (LIFECYCLE_CONFLICT) | None | **PASS** |
| 6.4 | Financial preview change → STALE_SOURCE | `corrections.service.ts:724-754` compares `beforeMonths` after approval | Integration: `corrections.integration.test.ts:687-740` (price correction racing payment) | None | **PASS** |
| 6.5 | Archived residents: name corrections allowed, status not a stale dependency | `corrections.facts.ts:327-329` (RESIDENT_FIELD only); `corrections.service.test.ts:580-591` (archive + sibling edit survives) | Unit: `corrections.service.test.ts:580-591` | Spec Decision 5: "name corrections remain possible for ARCHIVED residents" | **PASS** |
| **7. Locking & Transaction Protocol** |
| 7.1 | Scoped exclusive organization gate (Decision 6 AMEND) | `org-gate.ts:20-55` `acquireOrgGate` — single helper, `pg_advisory_xact_lock` exclusive | Unit: `corrections.rules.test.ts:225-246` (gate sets lock_timeout, takes exclusive lock) | Proportionality at ~100 beds **unmeasured** (A1-A10) | **PASS** (design) |
| 7.2 | Gate acquired by: booking, admission, check-in/out, finance generation, correction submit/apply (gated fields) | `corrections.service.ts:320-323` `lockGate`; `finance.service.ts:362, 458, 651` | Integration: `corrections.integration.test.ts:783-833` (A1: held gate → 409 RETRY_REQUIRED within lock_timeout) | Inventory writers NOT in gate (spec 10.5: validators must not read bed/room state) | **PASS** |
| 7.3 | Lock order: command-key → proposal row → gate → invoice-number → Bed→Booking→Admission→CheckIn→CheckOut→Invoice | `corrections.service.ts:186` (command-key), `606` (proposal row), `320-323` (gate), `corrections.facts.ts:179-212` (chain locks) | Security test: `corrections.security.test.ts:71-86` (lock order encoded once) | Implicit FK key-share locks on Bed/Resident during Admission.create — `corrections.facts.ts:188-191` locks Bed first | **PASS** |
| 7.4 | Authoritative reads inside transaction after gate | `corrections.service.ts:479-480` (submit), `656-663` (approve) — `loadForTarget` with `locking: true` | Integration: all approval tests re-read under locks | None | **PASS** |
| 7.5 | Transaction-local `lock_timeout` (correction 5s, ordinary 3s) bounded by remaining budget | `org-gate.ts:28-31` `setLocalLockTimeout`; `corrections.service.ts:176-184` `budget()` | Unit: `corrections.rules.test.ts:225-246` (3000ms for ordinary); Integration A1: waited 2.5-6s for 3s timeout | `statement_timeout` not set (spec 11.3: optional backstop) | **PASS** |
| 7.6 | Correction handlers use caller's `tx` only (no nested transactions) | `corrections.service.ts:135-143` `run` passes `tx` to `body`; `finance.applyCorrectionConsequences` accepts `tx` | Verified in `corrections.service.ts:744-754` | None | **PASS** |
| 7.7 | Settlement race: correction never holds Resident row lock + Invoice lock | `corrections.facts.ts:76-86` `lockResidentForUpdate` uses `FOR NO KEY UPDATE`; `corrections.apply.ts:176-220` no Resident lock for gated fields | Security test: `corrections.security.test.ts:52-69` (no `FOR UPDATE` on residents, no `lockRow` for residents) | **Spec 10.3: safe invoice-locking strategy not yet decided** — joint P4-2.3/P4-2.4 review required | **OWNER DECISION REQUIRED** |
| 7.8 | Billing-gap suppression: scheduler & manual generation skip unresolved gaps | `finance.service.ts:537-555` `openGapBookingIds`; `generateMonthly` (658-660), `createDraft` (392-396) | Integration: `corrections.integration.test.ts:501-616` (gap recorded, both paths skip); E2E: E7, E10 | None | **PASS** |
| **8. Retry, Idempotency & Status Contracts** |
| 8.1 | Auto-retry ONLY for SQLSTATE 40P01/40001 (deadlock/serialization) | `tx-errors.ts:92-94` `isAutoRetryable`; `corrections.service.ts:265-267` | Unit: `corrections.service.test.ts:732-751` (deadlock retried 2x, applies once); `773-781` (message "deadlock" not retried) | Real Prisma error shapes **UNPROVEN** (spec 11.4) | **PASS** (logic) |
| 8.2 | Lock timeout (55P03), Prisma P2028, connection loss → NOT auto-retried; client re-sends same key | `tx-errors.ts:67` (55P03), `71` (P2028), `73-77` (connection loss); `corrections.service.ts:287-300` | Unit: `corrections.service.test.ts:753-771` (55P03, P2028 → RETRY_REQUIRED, 1 transaction) | Real adapter shapes **UNPROVEN** | **PASS** (logic) |
| 8.3 | Idempotency-Key header = single source; HMAC request check stored on receipt | `corrections.input.ts:45-50` `parseIdempotencyKey`; `corrections.rules.ts:303-314` `requestCheck` | Unit: `corrections.service.test.ts:250-276`, `378-435` (exact replay, changed payload → conflict) | None | **PASS** |
| 8.4 | Receipt + effect in SAME transaction (receipt exists ⇔ committed) | `corrections.service.ts:243-255` creates receipt after `body` succeeds | Unit: `corrections.service.test.ts:250-276` (2 receipts for submit+approve); Integration: `corrections.integration.test.ts:266-276` (2 receipts) | None | **PASS** |
| 8.5 | Replay returns original status, rechecks authorization, no new mutation | `corrections.service.ts:208-240` (receipt lookup), `303-318` (re-read authority) | Unit: `corrections.service.test.ts:378-435` (revoked member cannot replay); Integration: `corrections.integration.test.ts:250-267` | None | **PASS** |
| 8.6 | Error codes: PENDING_CONFLICT, STALE_SOURCE, LIFECYCLE_CONFLICT, FINANCE_CONFLICT, IDEMPOTENCY_CONFLICT, RETRY_REQUIRED, INVALID_STATE, EVIDENCE_REQUIRED, INSUFFICIENT_ROLE, SELF_REVIEW, NOT_FOUND, etc. | `corrections.rules.ts:62-80` `CorrectionErrorCode`; service throws `CorrectionError` | Unit: all service tests check codes; Integration: all check `body.code` | None | **PASS** |
| **9. Finance Integration** |
| 9.1 | Draft recalculation on correction (genuine drafts only) | `finance.service.ts:506-530` `assertDraftStillEligible`; `applyCorrectionConsequences` | Integration: `corrections.integration.test.ts:687-740` (draft recalculated to corrected price) | None | **PASS** |
| 9.2 | Issued invoice immutable; flagged for INVOICE_REVIEW | `finance.service.ts:506-530`; `applyCorrectionConsequences` creates `INVOICE_REVIEW` link | Integration: `corrections.integration.test.ts:687-740` (issued amount unchanged, review link created) | None | **PASS** |
| 9.3 | Correction-created billing gap → BILLING_GAP link, REVIEW_REQUIRED, skipped by generation | `finance.service.ts:537-555`, `392-396`, `658-660` | Integration: `corrections.integration.test.ts:501-616`; E2E: E7, E10 | None | **PASS** |
| 9.4 | Finance remedies: balance-limited credit, reversal, replacement, guarded void, manual replacement | `finance.service.ts:1004-1241` | Unit: `finance.service.test.ts`; Integration: `finance.integration.test.ts` | Not tested in corrections context | **NOT TESTED** |
| 9.5 | Financial correction application OFF by default (`CORRECTIONS_FINANCIAL_APPLY_ENABLED !== '1'`) | `corrections.service.ts:80-86` `defaultCorrectionsConfig`; `corrections.security.test.ts:13-28` | Unit: `corrections.service.test.ts:535-547`; Integration: `corrections.integration.test.ts:618-651` (flag OFF → FINANCE_CONFLICT) | **Flag verified OFF** | **PASS** |
| **10. Frontend (Web)** |
| 10.1 | Correction queue with filters (status, type, financial) | `Corrections.tsx:89-218` `CorrectionList` | E2E: E2 (queue, pagination, filters) | None | **PASS** |
| 10.2 | New correction form with validation, evidence, effectiveAt (≤ now) | `Corrections.tsx:228-400` `CorrectionNew` | E2E: E1 (submit), validation messages | None | **PASS** |
| 10.3 | Protected detail: before/after, reason, requester, allowedActions from server | `Corrections.tsx:404-524` `CorrectionDetail`, `DetailBody` | E2E: E3 (reviewer sees detail, anonymous sees login) | None | **PASS** |
| 10.4 | Decision UI: approve (note + exception rationale), reject, withdraw | `Corrections.tsx:561-641` `Decisions` | E2E: E4 (approve/reject), E5 (withdraw, no approve for requester) | None | **PASS** |
| 10.5 | STALE banner with "Start a new one" link | `Corrections.tsx:435-450` | E2E: E10 (STALE shown, link works) | None | **PASS** |
| 10.6 | Resident profile Corrections tab (history, pending labelled not current) | `ResidentProfile.tsx:299` `<CorrectionHistory>`; `Corrections.tsx:646-694` | E2E: **E6 FAILS** — "timeout waiting for: history list", page shows 500 error | **Resident profile Corrections tab crashes** (API 5xx in logs) | **FAIL** |
| 10.7 | Finance reviews: OWNER resolves (RELEASED/NO_SUPPORTED_REMEDY/OPERATION_RECORDED) | `Corrections.tsx:698-801` `FinanceReviews`, `ReviewRow` | E2E: E7 (manager refused, owner resolves RELEASED) | None | **PASS** |
| 10.8 | Idempotency key persistence across retries, cleared on definitive answer | `Corrections.tsx:44` `CommandKeys`, `useCommand` hook | E2E: E8 (same key reused after network failure) | None | **PASS** |
| **11. Acceptance Criteria (A1–A10)** |
| 11.1 | A1: Held gate → clean 409 RETRY_REQUIRED within lock_timeout, no 500, nothing written | `corrections.integration.test.ts:783-833` | Integration test passes | Only tested with migrator client holding lock, not real contention | **PASS** (test) |
| 11.2 | A2: Two same-field proposals → exactly one PENDING, one 409 PENDING_CONFLICT | `corrections.integration.test.ts:360-395` (8 rounds) | Integration test passes | Requires partial unique indexes (migration missing) | **PARTIAL** |
| 11.3 | A3: Different fields concurrent → both persist | `corrections.integration.test.ts:397-405` | Integration test passes | | **PASS** |
| 11.4 | A4: Two independent name proposals approved concurrently → both applied, columns survive | `corrections.integration.test.ts:407-424` (6 rounds) | Integration test passes | | **PASS** |
| 11.5 | A5: Approve vs reject/withdraw → exactly one terminal state | `corrections.integration.test.ts:426-452` (8 rounds) | Integration test passes | | **PASS** |
| 11.6 | A6: Mixed workload (corrections, bookings, generation, payments, resident edits) → no deadlock, no 5xx | `corrections.integration.test.ts:835-881` (10 rounds) | Integration test passes, **0 deadlocks** | Only 10 rounds; load not tested | **PASS** (test) |
| 11.7 | A7: Unique violations never retry whole command | `corrections.service.test.ts:828-840` (receipt + unnamed constraints) | Unit test passes | | **PASS** |
| 11.8 | A8: Price correction racing issue → applied+flagged OR stale+untouched, never unflagged stale issue | `corrections.integration.test.ts:946-1002` (8 rounds) | Integration test passes | | **PASS** |
| 11.9 | A9: Price correction racing manual draft → draft at corrected price OR stale | `corrections.integration.test.ts:1004-1037` (8 rounds) | Integration test passes | | **PASS** |
| 11.10 | A10: Real Prisma error shapes for deadlock, lock timeout, P2028, connection loss observed on disposable PG | **NOT EXECUTED** — requires authorized disposable PostgreSQL | No disposable PG authorized; unit tests use fake error shapes | **Blocker** — spec 17, Decision 6, Decision 16 | **NOT TESTED** |
| **12. Browser E2E** |
| 12.1 | E1: Submit → PENDING, before/after shown, record unchanged | **PASS** (845ms) | `/tmp/nook-p4-browser-real.log:4` | None | **PASS** |
| 12.2 | E2: Queue filters, pagination (22 items, 2 pages) | **PASS** (1075ms) | Log:5 | None | **PASS** |
| 12.3 | E3: Protected detail (reviewer sees, anonymous blocked) | **PASS** (709ms) | Log:6 | None | **PASS** |
| 12.4 | E4: Approve + reject by independent reviewer | **PASS** (1010ms) | Log:7 | None | **PASS** |
| 12.5 | E5: Requester withdraws, cannot approve own | **PASS** (663ms) | Log:8 | None | **PASS** |
| 12.6 | E6: Resident profile Corrections tab lists applied, pending never shown as current | **FAIL** — timeout, 500 error "Something went wrong... Reference: b3d95dd7-59a3-4ec2-8a87-b1c6f429fe4a" | Log:9-11, 75-76 | **Resident profile API error** on Corrections tab | **FAIL** |
| 12.7 | E7: Finance review — manager refused, owner resolves RELEASED | **PASS** (1610ms) | Log:12 | None | **PASS** |
| 12.8 | E8: Same-key retry after network failure → applies once | **PASS** (861ms) | Log:13 | None | **PASS** |
| 12.9 | E9: Tenant isolation — cross-org sees nothing, 404 | **PASS** (842ms) | Log:14 | None | **PASS** |
| 12.10 | E10: STALE shown, financial application disabled | **PASS** (1465ms) | Log:15 | None | **PASS** |
| **13. Test Coverage** |
| 13.1 | Unit tests: 403 API + 54 web = 457 passing | `/tmp/nook-p4-unit-final.log:435-438` | All pass | Does not test real PostgreSQL locking, triggers, partial indexes | **PASS** (unit) |
| 13.2 | TypeScript typecheck: zero errors | `/tmp/nook-p4-typecheck-final.log:1-12` | Pass | | **PASS** |
| 13.3 | Integration tests against real PG: 100+ scenarios | `/tmp/nook-p4-diagnostic.log` + `corrections.integration.test.ts` | All pass (when financialTestApplication=true for some) | Financial flag toggled in test module only | **PASS** (integration) |
| 13.4 | CI tests: 3242 passing | `/tmp/nook-p4-ci-final.log` | Pass | | **PASS** |
| 13.5 | Disposable PostgreSQL acceptance (A10, concurrency proof) | **NOT AUTHORIZED** | No run | Spec 17, Decision 6 blocking | **NOT TESTED** |

---

## Five Highest-Priority Remaining Blockers

| Priority | Blocker | Impact | Required Action |
|---|---|---|---|
| **1** | **Missing original migration** (`20261108120000_p4_2_corrections/migration.sql`) | Cannot certify schema history; partial unique indexes, CHECK constraints, immutability triggers, `CheckOut UNIQUE(id, org_id)` not created in DB; E2E diagnostic warns "original corrections migration still missing" | Recover original migration file from backup/stash or authorize reconstruction with **exact checksum match** from `scripts/ci/g6b-migrations.json` |
| **2** | **Resident profile Corrections tab crashes (E6 failure)** | Browser E2E fails; resident corrections history inaccessible; API 5xx errors (9 markers in log) | Diagnose `/residents/:id/profile` → Corrections tab; error reference `b3d95dd7-59a3-4ec2-8a87-b1c6f429fe4a` suggests server exception |
| **3** | **Disposable PostgreSQL not authorized for P4-2.6 acceptance** | A10 unexecuted; real Prisma error shapes (deadlock 40P01, lock timeout 55P03, P2028, connection loss) unobserved; concurrency proof incomplete | Obtain explicit authorization for disposable `nook_integration_*` database on dedicated port |
| **4** | **Joint P4-2.3/P4-2.4 review for invoice-locking strategy (spec 10.3)** | Financial correction application **stays disabled**; settlement race (Resident row lock → Invoice lock) unresolved; no safe strategy chosen/proven | Conduct independent review of: (a) Invoice locks without Resident lock, (b) settlement takes Resident key-share first, (c) weaker Resident lock mode |
| **5** | **Approval-time sampling rule (Decision 3 OPEN)** | Spec: "sample one trusted instant after all locks and revalidation, immediately before application, persist it with policy version" — implementation uses `clock_timestamp()` (statement time), not a sampled decision instant | Implement explicit decision-instant sampling per Decision 3; record `decidedAt` from sampled instant, not transaction start |

---

## Single Highest-Priority Safe Implementation Task

**Task:** **Diagnose and fix the E6 browser failure (Resident profile Corrections tab crash)**

**Why:**
- It is the **only failing browser E2E scenario** (9/10 pass)
- It blocks the resident corrections history feature entirely
- The error reference `b3d95dd7-59a3-4ec2-8a87-b1c6f429fe4a` indicates a server-side exception
- Fixing it requires **no schema changes, no migrations, no feature flags** — only debugging the existing API/frontend integration
- It is a **safe, isolated fix** that preserves all existing work

**Investigation steps:**
1. Check API logs for the error reference `b3d95dd7-59a3-4ec2-8a87-b1c6f429fe4a`
2. Inspect `apps/api/src/resident-history/resident-history.service.ts` and controller for the corrections history query
3. Verify `CorrectionHistory` component (`Corrections.tsx:646-694`) calls correct endpoint with `targetType=RESIDENT`
4. Check if the `history` endpoint (`GET /corrections/history?targetType=RESIDENT&targetId=...`) handles the query correctly
5. Fix the root cause (likely a missing import, wrong query parameter, or N+1 query issue)

**Do not:** Enable financial correction flag, create migrations, modify schema, or change locking protocol.

---

## Summary Classification

| Category | PASS | PARTIAL | FAIL | NOT TESTED | OWNER DECISION REQUIRED |
|---|---|---|---|---|---|
| **Data Model** | 2 | 2 | 1 | 1 | 0 |
| **Allowlist/Boundary** | 4 | 0 | 0 | 0 | 1 |
| **Authorization** | 4 | 0 | 0 | 1 | 0 |
| **Lookback/Evidence** | 4 | 1 | 0 | 0 | 0 |
| **State Machine** | 4 | 1 | 0 | 1 | 0 |
| **Snapshots/Staleness** | 5 | 0 | 0 | 0 | 0 |
| **Locking/Transactions** | 6 | 0 | 0 | 0 | 1 |
| **Retry/Idempotency** | 6 | 0 | 0 | 0 | 0 |
| **Finance Integration** | 4 | 0 | 0 | 1 | 0 |
| **Frontend** | 7 | 0 | 1 | 0 | 0 |
| **Acceptance A1-A10** | 8 | 1 | 0 | 1 | 0 |
| **Browser E2E** | 9 | 0 | 1 | 0 | 0 |
| **TOTAL** | **63** | **5** | **3** | **5** | **2** |

**Overall P4-2 Status: NOT ACCEPTED** — Critical blockers (missing migration, E6 crash, no disposable PG authorization, joint review pending) must be resolved before acceptance. Unit and integration tests pass, but real PostgreSQL concurrency proof and browser acceptance are incomplete.