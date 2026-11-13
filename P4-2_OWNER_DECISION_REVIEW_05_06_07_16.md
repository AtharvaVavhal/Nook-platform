# NOOK — P4-2 Owner Decision Review: Decisions 5, 6, 7 and 16

**Owner choices NOT APPROVED. Read-only research and documentation. Implementation NOT AUTHORIZED.**

Workspace: `~/Downloads/nook-phase4-1` · branch `feature/phase-4-1-lifecycle-audit` · HEAD `908098acd567c299ad05529b5a533ad17622dceb` plus the existing modified and untracked working-tree files (read as the compatibility baseline; HEAD alone is not the baseline). Review date: 2026-11-08.

Primary documents, each read completely and left unchanged: [Specification v1.2](P4-2_SPECIFICATION_v1.2_FINAL_FOR_OWNER_APPROVAL.md) · [Owner worksheet](P4-2_OWNER_DECISION_WORKSHEET.md) · [Review 1/2/15](P4-2_OWNER_DECISION_REVIEW_01_02_15.md) · [Review 3/4/12](P4-2_OWNER_DECISION_REVIEW_03_04_12.md).

## 0. Scope, labels and evidence boundary

Every finding below carries exactly one of these labels:

| Label | Meaning |
|---|---|
| **[VRF]** VERIFIED REPOSITORY FACT | Observed in repository source, schema, migrations, or installed dependency code in the working tree. Where the fact is the text of official PostgreSQL documentation read during this task it is marked **[VRF·DOC]**: that is documented behaviour, **not** a runtime guarantee of any Nook database. |
| **[V1.2]** V1.2 PROPOSAL | What the specification proposes. Not existing code, not approved. |
| **[ADV]** ADVISORY RECOMMENDATION | This review's recommendation. Not an owner decision and not an approval. |
| **[UNV]** UNVERIFIED / REQUIRES IMPLEMENTATION REVIEW | Plausible or expected but not established by source inspection. Needs implementation review and/or disposable-PostgreSQL evidence. |

Boundaries observed: no `.env` or credential file was read; no database was contacted; no Prisma generate/migrate/seed or other application-changing command was run; no source, schema, migration, test, CI or configuration file was modified; no Git state was changed; no existing specification, worksheet or review was modified. Official PostgreSQL documentation pages were read over HTTP (functions-admin, explicit-locking, runtime-config-client, errcodes-appendix, transaction-iso). **No PostgreSQL runtime guarantee is claimed anywhere in this document.** Nothing here marks an owner decision approved or authorizes P4-2.1 or any later slice.

Frozen owner directions (specification §2) are preserved and not reopened. Decision 10 SLA / `dueAt` is a financial-review service target and is **kept entirely separate** from correction age (Decision 3) and from the transaction retry/timeout contracts reviewed here. Decision 3's pending clarification about final decision-time sampling, Decision 4's evidence and exceptional-approval rules, and Decision 12's strict independent-review requirement are preserved; where a Decision 16 contract touches them it only cross-references them.

### Evidence inventory (what was actually inspected)

| Area | Inspected |
|---|---|
| Schema | `prisma/schema.prisma` (all models; Resident, Booking, Admission, CheckIn, CheckOut, Invoice, Payment, PaymentReversal, InvoiceAdjustment, InvoiceVoid, AuditEvent in detail) |
| Migrations | All 18 directories listed; read in detail: `…add_checkin_checkout`, `…tenant_composite_keys_phase_3_3_to_3_5`, `…admission_and_lifecycle_integrity`, `…add_payment_idempotency`, `…add_financial_corrections` (grep), `…payment_receipt_snapshot`, `…invoice_void_record`, `…invoice_guard_hardening` (grep), `…invoice_active_uniqueness` |
| Services | `booking.service.ts` + `booking.rules.ts`; `admission.service.ts`; `checkin.service.ts` + `checkin.rules.ts`; `resident.service.ts`; `enquiry.service.ts` (`convert`); `finance.service.ts` (all write paths, `billableStays`, `planMonthly`); `finance.controller.ts`; `jobs/invoice-scheduler.service.ts`, `run-invoice-schedule.ts`, `schedule-months.ts`; `inventory.repository.ts` (write shape); `stay-summary.service.ts` and `resident-history.service.ts` (read paths) |
| Auth | `auth.guards.ts`, `session.service.ts` (`authenticate`) |
| Infrastructure | `database/prisma.service.ts`; `node_modules/@prisma/adapter-pg` error mapping and `startTransaction`; `@prisma/client` runtime default transaction options |
| Tests | Directory inventory of `apps/api/test` and `apps/api/test/integration`; targeted greps for concurrency, advisory-lock and deadlock handling (no test was executed) |
| Git | `git status`, `git diff` (read-only) of `finance.service.ts` and `checkin.service.ts` to see the working-tree delta over HEAD |

## 1. Executive summary of findings

**Conclusion in one paragraph.** [ADV] v1.2's Decisions 5, 7 and 16 are coherent enough to go to the owner, each with amendments. Decision 6 as written is **not yet transactionally implementable as specified**: source inspection found lock-order hazards that the specification's ordered-lock list does not account for (implicit foreign-key row locks), a default transaction timeout in existing writers that is shorter than the correction transaction the specification proposes, and a Finance source-reader gap far larger than "move reads inside the transaction". None of this is a reason to reject the policy direction; it is a reason to AMEND Decision 6 before it is treated as an implementation contract.

Key findings (details in the numbered sections):

1. **[VRF] The five index definitions are internally consistent with the existing table/column mappings** (`residents`, `bookings`, `admissions`, `check_ins`, `check_outs`, each with `organization_id`; all five tables have an `id` primary key). The target-ID column names, the `field_key`/`target_type`/`status` columns and every enum label are **[V1.2]** proposals — `CorrectionProposal` and all its columns do not exist in the schema, migrations or generated client (§2.2).
2. **[VRF] CheckOut lacks `[id, organizationId]` today**; only `[checkInId, organizationId]` exists (schema and migration `20261101190000`). Decision 7's premise is accurate (§4.1).
3. **[VRF] Credit, void and payment-reversal records already carry tenant-safe invoice references** (composite FK to `invoices(id, organization_id, resident_id)` for adjustments/voids; `payments(id, invoice_id, organization_id)` for reversals). v1.2's proposed `[id, invoiceId, organizationId]` unique keys are missing on three of them; `Payment` already has that key but v1.2's link design does not mention replacement payments although Decision 8 reuses them (§4.4).
4. **[VRF] No writer takes any lifecycle gate today; every writer on v1.2's list would have to change.** Three paths (`Admission.create`, `Admission.update`, `FinanceService.createDraft`) write from unrevalidated reads made outside the writing transaction; three more (`Booking.update`, `Booking.extend`, `CheckIn.create`) use outside-transaction probes only as hints and revalidate under locks; two (`Admission.update` non-status branch, `CheckIn.update` notes) use no transaction at all (§3.3).
5. **[ADV/UNV] Derived deadlock cycles.** (a) Implicit `FOR KEY SHARE` locks taken by foreign-key checks reverse the stated order if `Admission.create` is changed to lock Booking first. (b) `recordPayment` locks Invoice then needs a key-share on Resident (payment FK), while a correction that holds Resident `FOR UPDATE` and then locks an Invoice would wait the other way. Neither is addressed by v1.2's lock list (§3.4).
6. **[VRF] Ordinary Booking/Admission/Resident transactions use Prisma's default `maxWait` 2 s / `timeout` 5 s**; v1.2 proposes a 30 s correction transaction holding an exclusive gate. A held gate longer than the shortest ordinary timeout turns clean waits into transaction-timeout failures for ordinary operators (§3.6).
7. **[VRF] The scheduler creates invoices already `ISSUED` (`issue: true`) from unlocked reads and re-covers the previous and current month on every run.** A correction that makes a stay newly billable inside that window can be auto-invoiced and auto-issued without the review v1.2 §10 intends (§3.5).
8. **[ADV] An exclusive-for-all-lifecycle-and-Finance-source-writers gate (Alternative 1, scoped) removes the shared-reader problem, the cycle class in finding 5(a), and the need for Finance row-lock chains, at the cost of org-level serialization of short transactions.** Whether that cost is acceptable at ~100 beds cannot be established without measurement (§3.1, §3.6).
9. **[VRF] Prisma maps 40001/40P01 to `TransactionWriteConflict`; 55P03 (lock timeout) is not mapped** and surfaces as a generic driver error carrying `originalCode`; the repository's own `isTransientError` does not include it (§5.3).
10. **[V1.2] Single-field proposals leave real desired end states unreachable** (e.g. `[10,20)` → `[25,30)` with a neighbouring booking on `[20,25)`) (§2.4).

---

# 2. Decision 5 — Pending proposal granularity

## 2.1 Alternatives A, B and C

**[V1.2]** v1.2 recommends **B**: one PENDING proposal per organization/target/field, one field per proposal, dependency-aware stale checks, no grouped corrections.

| Criterion | A — one pending per target record | B — one pending per target field (v1.2) | C — multiple proposals with grouped / conflict-aware atomic application |
|---|---|---|---|
| Same-field conflict | Blocked (also blocks everything else on the record) | Blocked by partial unique index → `PENDING_CONFLICT` | Needs a group-level rule: a group may include 0..1 proposals per field; conflicts across groups need a defined winner |
| Different-field proposals | Blocked: `firstName` and `lastName` cannot be pending together | Allowed; each applies only if its own dependency group is intact | Allowed; may be bound into one group applied all-or-nothing |
| Dependency conflicts | Eliminated at submission (only one proposal exists) but resurfaces against *other* records (booking ↔ admission ↔ check-in) | Resolved at approval by dependency-group comparison → terminal `STALE` | Resolved by a group snapshot; one stale member stales the group or must be excluded by an explicit rule |
| Approval workload | Lowest queue size; highest *resubmission* workload (second fix must wait for first) | Moderate; extra resubmission when dependent siblings go stale | Lowest approval count for compound repairs (one decision), highest design/review cost per decision |
| Queue usability | Simple: one row per record | One row per field; related rows are not visibly linked in v1.2 | Needs group display, partial-approval semantics and group-level actions |
| Source snapshot complexity | Whole-record snapshot (simple, but over-broad → false stale on unrelated notes edits unless trimmed) | Per-field dependency group (v1.2: prose only, no field-by-field table) | Union snapshot across members plus cross-member consistency |
| Database constraint complexity | One partial unique index per target type | Five partial unique indexes (field in key) | Group table, member table, group-level uniqueness, atomic status transitions across rows |
| Transaction complexity | Single proposal per application | Single proposal per application; sibling effects only via staleness | Multi-field typed application with intermediate-state suppression; largest lock set |
| Resident-impact risk | Low risk of partial facts; high delay for independent fixes | Low: each applied fact individually valid; transient intermediate states exist between sequential applications (see §2.4) | Lowest transient-state exposure (atomic), highest implementation-defect risk |
| Recovery when stale | Resubmit | Resubmit with fresh snapshot, evidence and (for financial) OWNER review again | Resubmit group or member; recovery rules must be designed |

**Is B appropriate? [ADV] Yes, with amendments.** Reasons: (i) it is the smallest design that does not block the independent name fix pair (`firstName` / `lastName`) or `checkOutAt` / `reason`; (ii) both the uniqueness rule and the stale rule are individually testable; (iii) it does not require group semantics the owner has not designed. Its real costs are (a) forced resubmission for interdependent booking/admission/check-in fields and (b) the unsupported-repair set in §2.4. Amendments required before B is a contract: the field-by-field dependency tables in §2.3 (v1.2 describes groups only in prose), a rule for absence/range facts (§2.3 "ambiguity A"), a rule for archived residents (§2.3 "ambiguity B"), and an explicit user-visible statement of the unsupported final states (§2.4).

## 2.2 The five proposed partial unique indexes

### Verified physical mappings of the existing targets

| Existing Prisma model | [VRF] `@@map` table | [VRF] organization column | [VRF] id column | [VRF] key usable as FK target |
|---|---|---|---|---|
| Resident | `residents` | `organization_id` | `id` (uuid PK) | `[id, organizationId]` |
| Booking | `bookings` | `organization_id` | `id` | `[id, organizationId]` |
| Admission | `admissions` | `organization_id` | `id` | `[id, organizationId]` |
| CheckIn | `check_ins` | `organization_id` | `id` | `[id, organizationId]` |
| CheckOut | `check_outs` | `organization_id` | `id` | **none** — only `[checkInId, organizationId]` (`check_outs_check_in_id_organization_id_key`) |

**[VRF]** `CorrectionProposal`, `correction_proposals`, the five target-ID columns and the proposed enums are absent from `prisma/schema.prisma`, from every migration directory, and from `apps/api/src/generated` (the only schema match for "correction" is the unrelated `PaymentCorrection` self-relation on `Payment`). All proposal-side names below are therefore **[V1.2]** and **[UNV]**.

### Index-by-index verification

For every index: key columns `(organization_id, <target_id>, field_key)`, `UNIQUE`, partial predicate `status = 'PENDING' AND target_type = '<T>' AND <target_id> IS NOT NULL`.

| # | Proposed index name | Target table (verified) | Target-ID column ([V1.2], not existing) | Org column | Field-key column ([V1.2]) | Predicate terms present | Result |
|---|---|---|---|---|---|---|---|
| 1 | `correction_proposals_pending_resident_field_uq` | `residents` | `resident_target_id` | `organization_id` | `field_key` | status ✓, target_type `'RESIDENT'` ✓, not-null ✓ | Consistent |
| 2 | `correction_proposals_pending_booking_field_uq` | `bookings` | `booking_target_id` | ✓ | ✓ | `'BOOKING'` ✓ | Consistent |
| 3 | `correction_proposals_pending_admission_field_uq` | `admissions` | `admission_target_id` | ✓ | ✓ | `'ADMISSION'` ✓ | Consistent |
| 4 | `correction_proposals_pending_check_in_field_uq` | `check_ins` | `check_in_target_id` | ✓ | ✓ | `'CHECK_IN'` ✓ | Consistent |
| 5 | `correction_proposals_pending_check_out_field_uq` | `check_outs` | `check_out_target_id` | ✓ | ✓ | `'CHECK_OUT'` ✓ | Consistent; FK needs the not-yet-existing `[id, organization_id]` unique (§4) |

Observations:

1. **[VRF]** Index names are within PostgreSQL's 63-byte identifier limit (longest is 47 characters).
2. **[V1.2]** Each index uses the *proposed* target-ID column of its own type. This matches the typed-FK design: five nullable ID columns, exactly one non-null.
3. **Casing.** **[VRF]** The repository's enums use UPPER_SNAKE labels (`CHECKED_OUT`, `PARTIALLY_PAID`, `PROPERTY_MANAGER`), so `'PENDING'`, `'CHECK_IN'`, `'CHECK_OUT'` are convention-consistent. **[VRF]** However `AuditEvent.targetType` is a free string and existing events use **lower-case snake** (`'check_in'`, `'check_out'`, `'booking'`, `'admission'`). **[ADV]** v1.2 should state the mapping between the correction enum label (`CHECK_OUT`) and the audit `targetType` string (`check_out`) so history queries by `(targetType, targetId)` do not silently miss events. **[UNV]** `fieldKey` labels in §4 are camelCase (`firstName`, `checkOutAt`) while target labels are UPPER_SNAKE; mixed casing in one enum family is legal in Prisma/PostgreSQL but must be fixed consistently in the field-compatibility CHECK (literals are case-sensitive). The index predicates avoid field literals, so they are unaffected.
4. **Is `target_type` in the predicate useful? [ADV]** It is logically redundant when the exactly-one-target and type-matching CHECKs hold (v1.2 says so itself). It is harmless, and it documents intent in `pg_indexes`/EXPLAIN output. It is **not** a security control: a row that evades the CHECKs could evade the index. The CHECKs are the control. Keep it; do not rely on it.
5. **[UNV]** `status = 'PENDING'` against an enum column with an untyped literal is valid PostgreSQL, but the exact enum type names are unspecified; P4-2.1 must define them and re-verify the predicates against the real catalog.

### Interactions

| With | Interaction | Label |
|---|---|---|
| Exactly-one-target CHECK (`num_nonnulls(5 ids) = 1`) | Without it, a row with all five IDs NULL would never enter any of the five partial indexes (predicate `IS NOT NULL` false) and would escape uniqueness, and **MATCH SIMPLE composite FKs skip a NULL component**, so it would also escape the tenant FK. The CHECK is therefore essential, not complementary. | [V1.2]/[ADV] |
| Target-type/ID-compatibility CHECK | Ensures `target_type='BOOKING'` ⇒ `booking_target_id IS NOT NULL` and the other four NULL; otherwise a row typed `RESIDENT` carrying a booking ID would sit in no index. | [V1.2] |
| Field-compatibility CHECK | Closed enums alone do not stop `(RESIDENT, startDate)`. Needed so `field_key` is meaningful per target. A CHECK that evaluates to UNKNOWN passes in PostgreSQL; v1.2 correctly requires explicit NULL handling. | [V1.2] |
| Same-tenant composite FKs | The index key leads with `organization_id`, but uniqueness itself does not prove the target belongs to that organization; the composite FK `(<target_id>, organization_id)` does. Target UUIDs are globally unique, so `organization_id` in the index key is defence in depth, not a necessity. | [VRF] for existing parent keys; [V1.2] for the FKs |
| Terminal status changes | A committed update of `status` out of `PENDING` makes the row leave the index (predicate no longer true), freeing the slot. A rolled-back update does not. A competing insert for the same key is expected to wait for an in-progress transaction that is deleting the old index entry and then succeed or fail with 23505 depending on its outcome. | [UNV] — standard unique-index behaviour, **must be shown on disposable PostgreSQL** |
| Multiple fields on one record | `field_key` is in the key, so `firstName` and `lastName` coexist; `startDate`, `endDate`, `monthlyPrice` coexist at submission and interact only at approval (§2.3). Admission and CheckIn have one eligible field each, so no coexisting pair exists to test. | [V1.2] |
| Same-field duplicate submissions | Different keys: the second inserter fails with 23505 on the matching index → `PENDING_CONFLICT`. Same key: resolved first by the command receipt (replay). | [V1.2]; adapter shape [VRF] below |
| Constraint-name surfacing | **[VRF]** `@prisma/adapter-pg` maps SQLSTATE 23505 to `UniqueConstraintViolation` with `constraint: { index: <pg constraint name> }` when PostgreSQL supplies one, otherwise `{ fields: [...] }` parsed from the error detail. **[UNV]** Whether PostgreSQL populates the constraint name for a *partial unique index* violation and how Prisma then exposes it in `P2002.meta` must be shown against a real database before "never map every P2002" can be implemented. | [VRF] / [UNV] |

**[ADV] Verdict on the five indexes:** definitions are consistent with verified table mappings and with each other. They are conditional on unverified proposal-side names, a reviewed enum design, a reviewed CHECK set (§2.2 interactions), the CheckOut composite unique, and a runtime proof of constraint-name surfacing. No migration was created or run.

## 2.3 Dependency snapshots, group by group

Two facts frame all groups:

* **[VRF] `updatedAt` is too broad.** `@updatedAt` is bumped by any write to the row. Examples in the working tree: `ResidentService.archiveGuarded` writes `updatedAt: new Date()` as a deliberate no-op lock; any profile edit bumps `Resident.updatedAt`; ordinary booking `notes` / `paymentStatus` edits bump `Booking.updatedAt`; admission `notes`/`propertyId`/`roomId`/status edits bump `Admission.updatedAt`; `CheckIn.update` (notes) bumps `CheckIn.updatedAt`.
* **[VRF] `updatedAt` is also too narrow.** Creating a child row (admission, check-in, checkout, invoice, another booking on the bed) does **not** change the parent's `updatedAt`. Only an explicit captured-child set detects it.

**[VRF] Microsecond precision.** Columns are `Timestamptz(6)` but the repository reads and writes through JavaScript `Date` (millisecond resolution by language definition) via Prisma. Preserving microseconds therefore requires reading the canonical text with a raw query and writing the corrected value with raw SQL (or accepting millisecond precision for corrected values). **[V1.2]** already requires canonical text capture; **[ADV]** v1.2 should also state that the *application* of an RFC3339 value with sub-millisecond digits cannot go through a Prisma `Date` field without truncation.

**[ADV] Column-specific application.** The apply step must `SET` only the target column. **[VRF]** `ResidentService.update` and `BookingService.update` already build partial `data` objects, so a column-specific update is the established pattern. **[UNV]** Under READ COMMITTED a waiting `UPDATE` re-reads the newest row version and recomputes its `SET` list, so unrelated columns changed by a concurrent committed transaction are preserved — documented READ COMMITTED behaviour (**[VRF·DOC]** "the search condition … is re-evaluated"), but "unrelated columns survive" must be proven on PostgreSQL. A full-row write-back of a re-read row would defeat this and must be prohibited.

### Dependency tables

Legend: **Capture** = persisted in the immutable protected snapshot at submission. **Re-read** = read again after locks before application. **Stales** = a change after submission yields terminal `STALE`. **Must not stale** = an unrelated change that must leave the proposal `PENDING`.

| Group | Capture at submission | Re-read before application | Must not stale | Must stale |
|---|---|---|---|---|
| **Resident `firstName`** | tenant id, resident id, `firstName` exact text, resident `status`, `createdAt` (age anchor, exact text) | same, under Resident row lock | `lastName`, phone, email, address, emergency contact, document fields, any `updatedAt` bump, bookings/stays/invoices existing or changing | `firstName` changed by any path (other applied correction, legacy/maintenance write); resident `status` change — see ambiguity B |
| **Resident `lastName`** | symmetric | symmetric | `firstName` and the same list | `lastName` changed; resident `status` — ambiguity B |
| **Booking `startDate`, `endDate`, `monthlyPrice`** (shared group per v1.2) | booking id/status/`bedId`/`residentId`; `startDate`, `endDate`, `monthlyPrice` exact; admission presence + id + status + `admissionDate`; check-in presence + id + status + `checkInAt`; checkout presence + `checkOutAt`; the invoice slots for the booking (id, status, period, amount) used for the OWNER preview | same, under Bed → Resident → Booking → Admission → CheckIn → CheckOut locks | booking `notes`; `paymentStatus` (**v1.2 does not say**; **[ADV]** exclude); admission `notes`/`propertyId`/`roomId`; check-in/out `notes`; other beds; resident profile edits | any of the three booking scalars changed by another correction or by the extension command; admission created, cancelled, or its date changed; check-in created or checkout created; an affected invoice slot created, issued, voided or re-amounted |
| **Admission `admissionDate`** | admission id/status/`admissionDate`; booking id/status/`startDate`/`endDate`; check-in presence + `checkInAt` | under Booking → Admission (→ CheckIn) locks | admission `notes`/location metadata; booking `monthlyPrice`/`paymentStatus` (v1.2 says only "authoritative parent chronology") | admission date or status→`CANCELLED` changed; booking dates or status changed; check-in created |
| **CheckIn `checkInAt`** | check-in id/status/`checkInAt`; admission id/status/`admissionDate`; checkout presence + `checkOutAt`; other stays on the same bed and resident that bound the proposed interval | under Bed → Resident → Booking → Admission → CheckIn (→ CheckOut) | check-in `notes` (but see the legacy-fallback caveat below) | check-in `checkInAt` changed; checkout created (status `ACTIVE`→`CHECKED_OUT`); admission date changed |
| **CheckOut `checkOutAt`** | checkout id/`checkOutAt`/`reason`; check-in id/status/`checkInAt`; other stays on the bed/resident that bound the proposed interval | under … CheckIn → CheckOut locks | checkout `notes`; resident profile edits | `checkOutAt` changed; `checkInAt` changed; checkout deleted (not possible today) |
| **CheckOut `reason`** | checkout `reason` exact text (nullable); `checkOutAt`; check-in id/status | CheckIn → CheckOut locks | resident profile edits (v1.2 example 7), checkout `notes` | `reason` changed; **v1.2 also stales it on a `checkOutAt` change** — conservative, see below |

**[VRF] legacy caveat.** `FinanceService.billableStays` uses `CheckIn.updatedAt` as the billing end for `CHECKED_OUT` check-ins that have no `CheckOut` row. A notes-only `CheckIn.update` therefore moves a billing boundary for those legacy rows. For such rows `updatedAt` **is** a financial dependency, and the "notes never stale" rule must exclude them.

### Ambiguities that v1.2 does not resolve

* **Ambiguity A — absence/range facts. [UNV]** v1.2 §8 says "new dependent rows also invalidate applicability" and §12 says "a changed dependency yields terminal STALE; an invariant conflict without snapshot mismatch returns 409 and rolls back, leaving PENDING", but never says whether *"no overlapping booking exists in the proposed range"* / *"no other stay overlaps the proposed interval"* are snapshot facts (→ STALE) or validators (→ conflict, still PENDING). The §12 race row for check-in vs checkout says "loser revalidates **or** becomes STALE". **[ADV]** Adopt: (i) *identified* parent/child rows (target scalars, parent identity/status, the single admission/check-in/checkout of a booking, the invoice slots shown to the approver) are snapshot facts → `STALE`; (ii) *range/absence* facts (other bookings or stays on the bed, resident-level overlap) are re-evaluated validators → `LIFECYCLE_CONFLICT`, proposal stays `PENDING`. Rationale: snapshotting an open-ended "other rows" set causes false stales and cannot be hashed canonically without a defined range.
* **Ambiguity B — archived residents. [UNV]** v1.2 lists resident `status` as a name-group dependency but does not say whether a name on an `ARCHIVED` resident is correctable. If status is a stale dependency, *archiving a resident silently stales all of their pending name proposals*. **[ADV]** Owner/spec must choose: exclude status from the name group (correction still applicable) or state that archived records are not correctable. Both are acceptable; silence is not.
* **Ambiguity C — financial preview basis. [ADV]** v1.2 says previews are "recalculated under current locks" but not whether an OWNER who approved a preview computed on stale invoice facts is bound to the recomputed consequence. **[ADV]** If the displayed consequence (draft amounts, voided drafts, affected issued invoices) differs from the recomputed one, treat it as `STALE_SOURCE` rather than apply an unseen financial consequence.
* **Over-coupling. [ADV]** Including `monthlyPrice` in the *date* proposals' group and `checkOutAt` in the *reason* group causes false stales (cost: resubmission, re-entered evidence, a second independent review). The price coupling is defensible because of the preview basis (Ambiguity C). The `checkOutAt`→`reason` coupling is defensible only as "the reviewer saw the departure context"; age is recomputed at approval regardless. Keep both as conservative defaults; record the cost.

### Concrete examples (expected outcomes under v1.2 as written; ADV rule noted where v1.2 is ambiguous)

| # | Scenario | Expected outcome |
|---|---|---|
| 1 | Two independent resident name proposals (`firstName` P1, `lastName` P2) | Both submit; both approve independently in either order: **both APPLIED** (own-scalar groups). Requires column-specific update and Resident row serialization. A snapshot built on `updatedAt` would wrongly stale the second. |
| 2 | Two proposals for the same name field | Second submission: **409 `PENDING_CONFLICT`**, rolled back, no row/audit/receipt. After the first is terminal, a fresh submission succeeds. Never `STALE`. |
| 3 | Booking `startDate` P1 and `monthlyPrice` P2 | Submit both. Approve P1 → **APPLIED**. Approve P2 → **`STALE`** (booking scalars + shared group changed), 409 `STALE_SOURCE` after commit; resubmit with fresh snapshot and (price) evidence. If the owner removes the price↔date coupling, P2 would instead apply (see Ambiguity C). |
| 4 | Booking date proposal and a new admission created afterwards | Admission presence/date were captured as *absent*; their appearance is a captured-child change → **`STALE`** under v1.2 text. If admission were not captured, the date validator would instead return **`LIFECYCLE_CONFLICT`** (PENDING) whenever the new range excludes the admission date, or **APPLIED** if it still covers it. v1.2 does not say which; ADV rule: presence of the booking's single admission is an identified child → `STALE`. |
| 5 | Check-in timestamp proposal and a checkout afterwards | Checkout presence and `status` change are captured → **`STALE`** even if the new `checkInAt` is still ≤ `checkOutAt`. (v1.2 race row says "revalidates or STALE"; ADV: STALE, because the approver reviewed an `ACTIVE` stay.) |
| 6 | Checkout timestamp proposal and another stay on the same bed | The new stay is a range/absence fact. Per ADV rule: **`LIFECYCLE_CONFLICT`** if the proposed `checkOutAt` overlaps it (proposal stays PENDING; becomes appliable only if the conflicting stay is not an issue or the proposal is withdrawn/rejected); **APPLIED** otherwise. Under literal v1.2 "new dependent rows invalidate", it would be **`STALE`**. Unresolved by v1.2. |
| 7 | Checkout `reason` proposal and an unrelated resident profile update | **APPLIED** (not stale): reason group excludes resident profile; `updatedAt` is not compared. |

**When a stale proposal needs a fresh submission vs. when a validation conflict leaves the proposal pending [ADV]:**

* `STALE` (terminal, committed, 409 `STALE_SOURCE`): something the approver relied on *changed*. The old proposal can never be applied. A fresh submission needs a new Idempotency-Key, a fresh server-captured original and (for financial/exceptional cases) fresh evidence and independent review.
* `LIFECYCLE_CONFLICT` / `FINANCE_CONFLICT` (409, rollback, proposal stays `PENDING`): the captured facts are unchanged but a validator or the Finance helper refuses. The proposal remains visible and can later be approved (if the blocking condition clears), rejected, or withdrawn.
* Order of evaluation at approval **[ADV]**: authentication → active role/ownership of the tenant → self-review → terminal-state check → age/evidence authority → snapshot comparison (`STALE`) → validators (`LIFECYCLE_CONFLICT`) → Finance (`FINANCE_CONFLICT`). A requester or under-privileged reviewer must be refused with 403 *before* staleness is evaluated; otherwise they could commit a `STALE` terminal transition they were never entitled to attempt.

**Queue consequence. [ADV]** v1.2 detects staleness only on an authorized approval attempt. A stale proposal therefore looks `PENDING`, occupies its field slot, and stays in the queue until someone tries to approve it. GET handlers must not mutate; a non-authoritative "may be stale" hint computed from the same comparison is optional and must never change status.

## 2.4 Unsupported grouped repairs (booking examples)

Using the verified half-open rule `[start, end)` as IST calendar days, direct-update shortening allowed, lengthening only through `POST /bookings/:id/extend` (**[VRF]** `BookingService.update` throws 400 "A booking cannot be lengthened here…"; `extend` requires `CONFIRMED`, overlap-checks only the added slice `[currentEnd, newEnd)` under the Bed→Booking locks).

**`[10,20)` → `[15,18)`.** Valid single-field sequences: *start-first* `[10,20)`→`[15,20)`→`[15,18)`; *end-first* `[10,20)`→`[10,18)`→`[15,18)`. Every intermediate state is valid. Prohibited: none, **provided** the booking's admission date lies inside `[15,18)` or was corrected first (admission date correction requires the date to be inside the *current* booking range, so order is admission-date first, then booking dates). Under B, submitting all pending proposals at once guarantees that the first applied one stales the rest (shared group), so **N dependent fixes cost N sequential approvals, each with a fresh proposal**.

**`[10,20)` → `[25,30)`.** Start-first makes `[25,20)` — `start ≥ end`, invalid; end-first `[10,30)` is a lengthening, prohibited in correction. The only reachable path is extension then correction: `extend` to `[10,30)`, then correct `startDate` to 25. That path **fails exactly when it should not**: if another booking occupies `[20,25)` on the same bed, the extension's added-slice check `[20,30)` conflicts even though the *final* state `[25,30)` is valid and adjacent. **[ADV] That desired final state is unsupported by v1.2.** It also exposes a transient `[10,30)` state to every concurrent reader (e.g. the scheduler) between the two committed steps.

**Other unsupported or burdensome final states [ADV]:** swapping or shifting two bookings on one bed whose every single-field intermediate overlaps; a check-in correction that needs an earlier admission date that needs an earlier booking start (a 3-step chain, each step staling the next); reversing an end-date shortening (extension-only, per v1.2).

**[ADV] Recommendation to the owner:** **Accept the limitation for the first correction release and record it in the specification as an enumerated list** (the cases above), with the manual fallback stated (for a booking with no check-in history, cancel and recreate; **[VRF]** a booking with any check-in history cannot be cancelled, so for stays there is no fallback). Do **not** introduce grouped correction silently. Treat a grouped/atomic workflow as a **separately designed and separately authorized** future item. **Defer no field now**, but make the UI show the required ordering (admission → booking dates → check-in) and the "will require resubmission" warning. If the owner finds the stay-side unsupported set unacceptable, the proportionate response is to defer enabling the interdependent chain (`startDate`/`endDate`/`admissionDate`/`checkInAt`) until a grouped design exists, keeping names, `monthlyPrice` (single-field), `checkOutAt` and `reason`.

**[VRF] Durability caveat for physical intervals.** `assertCanCheckIn` checks status, bed/room state, existing check-in for the admission, and *active* stays on the bed/resident; it does not compare the new `checkInAt` with *completed* stays and does not require `checkInAt ≤ now`. `assertCanCheckOut` only requires `checkOutAt ≥ checkInAt`. So the "no overlapping physical intervals" invariant that v1.2 imposes on corrections is **not** enforced by ordinary check-in/check-out creation. A correction can establish a clean interval that a later back-dated ordinary check-in violates. **[ADV]** The spec should either add the same interval validator to the creation paths or state that the invariant is only checked at correction time.

---

# 3. Decision 6 — Locking strategy

**[V1.2]** v1.2 recommends a hybrid: one transaction-scoped advisory key per organization; ordinary booking/admission/check-in/check-out writers and Finance source readers take it **SHARED**; booking/admission/physical-time correction application takes it **EXCLUSIVE** (never upgraded); names and checkout `reason` use row locks only; existing Bed → Resident → Booking → Admission → CheckIn → CheckOut → Invoice row locks are kept; the existing invoice-number advisory lock stays separate. **[VRF] None of this exists today**: no writer acquires a lifecycle gate (§3.3).

## 3.1 Comparing the four alternatives

| Criterion | 1. Exclusive org lock for all operations | 2. Entity-level advisory locks | 3. Existing row locks only | 4. Hybrid shared/exclusive org gate + ordered row locks (v1.2) |
|---|---|---|---|---|
| Concurrency safety | Highest: lifecycle and Finance-source writers are fully serialized | Depends on completeness of key set per path | Insufficient alone: several paths read outside the writing transaction or take no lock (§3.3) | Safe only if **every** source writer/reader takes the gate **and** the row-lock protocol is complete |
| Cross-entity correctness | Complete (one critical section) | Needs coordinated keys across bed/resident/booking/invoice | Not guaranteed (Booking ↔ Admission write skew exists today) | Gate excludes corrections from ordinary writers; ordinary-vs-ordinary still relies on row locks |
| Missing-row / phantom protection | Complete: nothing can commit concurrently | Needs a key for "all candidate bookings" / absent invoice slots | None for absent rows beyond unique indexes | Bookings-scoped absence is protected only because child creators lock the parent (§3.5); org-wide candidate discovery is not |
| Contention | Highest: unrelated beds serialize; long Finance runs block everyone | Lowest | Lowest (today's behaviour) | Moderate; plus lock-queue effects (§3.4 C5) |
| Deadlock risk | Lowest among ordinary writers (serialized); remaining risk only against non-gated settlement operations | Highest (many keys) | Existing orders appear acyclic (§3.4) | Highest *new* risk: row locks under S overlap; derived cycles C1, C2 (§3.4) |
| Implementation complexity | Lowest protocol; same number of call sites to touch | Highest | None (but insufficient) | High: gate helper + row-lock chains in Finance + FK-lock ordering + convoy bounds |
| Finance consistency | Reads inside the gated transaction are stable without row-lock chains | Hard (absent invoice slots) | Not achieved today | Needs Finance source-chain locking, restart rule and revalidation (§3.5) |
| Testability on PostgreSQL | Simple (two interleavings per pair) | Large matrix | n/a | Large matrix (S/S, S/X, X/X × writer pairs × Finance orders) |

### Recommendation

**[ADV] Recommended alternative: Alternative 1 in a *scoped* form — one exclusive organization gate for (a) the lifecycle writers that change correction-relevant facts, (b) the Finance operations that *derive amounts from or validate against* those facts, and (c) consequential correction submission/application — with existing row locks retained as defence in depth.** It deliberately excludes standalone settlement operations (payment, reversal, credit, void), reads, ordinary resident profile edits, resident/enquiry creation, and name/`reason` corrections (these keep their row locks).

Specific justification, from the source rather than the specification:

1. v1.2 itself says the shared gate "alone only excludes correction application"; for ordinary-vs-Finance consistency it adds a new Finance row-lock protocol (§3.5) that the repository has none of. Exclusive scoping makes the *same* guarantee by exclusion.
2. The new cycles found in §3.4 (C1 implicit FK locks, C2 Resident-then-Invoice) only arise because S holders overlap and take row locks in orders the specification does not control. Serialization removes C1 and, if corrections hold no Resident row lock while serialized, C2.
3. The number of call sites to change is identical for both designs (§3.3). The difference is the *extra* protocol, not the *basic* integration.
4. At ~100 beds, per-organization serialization of short, server-side transactions may be proportionate, but **this cannot be established from source** — it depends on measured transaction durations that this task cannot obtain. The criteria in §3.6 decide it.

**What would change this recommendation [ADV]:** disposable-PostgreSQL evidence that scoped-exclusive serialization breaches the §3.6 ordinary-operation criteria (most likely cause: a long monthly generation transaction). The fallback is the v1.2 hybrid **with** the eight required fixes below, or batching monthly generation into per-booking transactions under Alternative 1.

**If the owner prefers the v1.2 hybrid, [ADV] minimum required fixes (H1–H8) before it is treated as an implementation contract:**

* **H1** A single gate-key helper used by every module, plus a static guard test that every `$transaction` in the lifecycle and Finance modules acquires it (§3.2).
* **H2** Explicit `lock_timeout` on every gate acquirer *and* explicit Prisma transaction options for the ordinary writers that currently use defaults (§3.6).
* **H3** `Admission.create` must explicitly lock Bed → Resident → Booking *before* the insert (cycle C1).
* **H4** Resolve C2: a correction holding Resident `FOR UPDATE` must never then lock an Invoice, or payment-side code must take the Resident key-share before the Invoice, or the correction must use `FOR NO KEY UPDATE` on Resident (non-key column only).
* **H5** Correction handlers must use only the caller's `tx` (no public service methods that open their own transaction) (C3).
* **H6** Enumerate the exact Finance source-chain sets, the restart-on-differing-chain rule, and how locks within a table are ordered.
* **H7** Bound the hold time of SHARED Finance transactions so a waiting EXCLUSIVE correction cannot convoy ordinary writers (C5).
* **H8** Record measured gate wait/hold times and meet §3.6.

## 3.2 PostgreSQL advisory-lock feasibility

| Question | Finding | Label |
|---|---|---|
| Shared and exclusive transaction-scoped locks exist | `pg_advisory_xact_lock` and `pg_advisory_xact_lock_shared`, each with a `bigint` form and a two-`integer` form. "a shared lock does not conflict with other shared locks on the same resource, only with exclusive locks." | [VRF·DOC] |
| Release | Transaction-level locks are "held until the current transaction ends; there is no provision for manual release" and are "automatically released at the end of the transaction". The documentation contrasts session-level locks, which survive rollback. | [VRF·DOC] — not runtime-proven |
| Key spaces | The single-`bigint` form and the two-`integer` form "do not overlap". | [VRF·DOC] |
| Re-request by the same holder | "If a session already holds a given advisory lock, additional requests by it will always succeed, even if other sessions are awaiting the lock." The docs do not address *mode* (shared then exclusive). | [VRF·DOC] |
| Existing key construction in the repo | `pg_advisory_xact_lock(hashtextextended(<text>, 0))` with text `invoice-number:<orgId>` (`finance.service.ts` `lockNumbering`) and `payment-idempotency:<orgId>:<key>`. The integration-suite guard uses a *session-level* `pg_try_advisory_lock(hashtextextended('nook:integration-suite', 0))` in the same single-`bigint` key space. | [VRF] |
| Key derivation across services | The template strings are written inline in two places in `finance.service.ts`; no shared helper, no use outside Finance. A gate would need one helper used by Booking, Admission, CheckIn, Resident, Finance, the scheduler path and Corrections. | [VRF] gap → [ADV] helper |
| Collision risk | 64-bit hash of a namespaced string; a collision between the gate key and `invoice-number:…`/`payment-idempotency:…` keys would only cause *extra* waiting (false sharing), not a safety loss, but could create a spurious cycle if two different gate-ordered paths collided. Probability is negligible but is a property of the hash, not proven here. | [UNV] |
| Stability of `hashtextextended` | It is a built-in used by the repo today. The pages read in this task do not document it as a user-facing, version-stable API. | [UNV] — alternative: derive a 64-bit key in application code from a documented hash (SHA-256 prefix) and pass it as a `bigint` parameter |
| Prisma can run the statements safely | The repo already runs `tx.$executeRaw\`SELECT pg_advisory_xact_lock(…)\`` inside interactive transactions; `@prisma/adapter-pg` `startTransaction` takes a dedicated pooled connection, issues `BEGIN`, and optionally `SET TRANSACTION ISOLATION LEVEL …`, so a transaction-scoped lock lives on the transaction's own connection. A shared variant uses the same call shape. | [VRF] code; execution on a real server [UNV] |
| Transaction-local `lock_timeout` | `SET LOCAL` cannot take bind parameters through `$executeRaw`; `set_config('lock_timeout', '<ms>', true)` is documented as transaction-local. | [VRF·DOC] |
| Does `lock_timeout` bound advisory-lock waits? | Documentation: aborts "any statement that waits longer … while attempting to acquire a lock on a table, index, row, or other database object", applied "separately to each lock acquisition attempt" and to explicit and implicit lock requests. **Advisory locks are not named.** v1.2's five-second bound on gate waits therefore depends on behaviour the pages read here do not confirm. | [UNV] — must be shown on disposable PostgreSQL |
| Shared → exclusive upgrade | Not addressed by the documentation. Two transactions each holding shared and each requesting exclusive on one key would wait on each other; PostgreSQL's deadlock detection would resolve it by aborting one (40P01). v1.2 avoids this by acquiring exclusive directly. That is only possible if the need for exclusive is known before the first gate acquisition; it is (the proposal's immutable target type/field decides it). | [UNV] runtime; design rule [V1.2] |
| Does every transaction use one protocol? | **No.** Today zero transactions acquire a lifecycle gate. Safety under any gate design is the conjunction of 100% coverage of the §3.3 paths plus no privileged or maintenance writer outside the application. | [VRF] |
| Deployment pooling mode | Not inspected (environment files not read). Transaction-scoped advisory locks are compatible with transaction-level pooling; session-level ones are not. | [UNV] |

**Source-code feasibility** (the pattern is in use and expressible through the installed Prisma adapter): **established**. **PostgreSQL behaviour** (shared/exclusive conflict, release on rollback, `lock_timeout` coverage, upgrade deadlock, queue fairness): **not established by source inspection**; documentation text is quoted above and nothing is claimed beyond it.

## 3.3 Inventory of writers and readers

Columns are as the task requires. "Locks" lists explicit row/advisory locks only; implicit foreign-key key-share locks and trigger locks are discussed in §3.4. "Reads outside the tx?" means a read that influences what the transaction writes but is not made inside it. Transaction options: Booking/Admission/Resident use Prisma defaults (**[VRF]** `maxWait` 2 s, `timeout` 5 s in the installed runtime); CheckIn `10 s / 20 s`; Finance `10 s / 30 s`.

### Booking

| Path | Current transaction | Existing locks | Source reads before transaction? | Proposed gate needed | Required future change |
|---|---|---|---|---|---|
| `create` | Yes (defaults) | Bed `FOR UPDATE`; Resident read, **no** lock | Validation only; none feeding writes | Yes | Gate before Bed. Keep availability check and atomic `booking.created` audit. Insert takes implicit key-share on resident/bed/org. |
| `update` | Yes (defaults) | Bed → Booking `FOR UPDATE`; admission and check-in reads are **unlocked** | Unlocked probe for `bedId` (a hint; revalidated, refuses on mismatch) | Yes | Gate; reject candidate fields (`startDate`, `endDate`, `monthlyPrice`) before any branch; the unlocked admission read is a write-skew partner of `Admission.update` (no Booking lock there). |
| `extend` | Yes | Bed → Booking | Unlocked probe (bedId) | Yes | Gate; stays an ordinary domain command; audit already atomic. |
| `cancel` (`DELETE`) | Delegates to `update` (own tx) | As `update` | As `update` | Yes | Same as `update`. |

### Admission

| Path | Current transaction | Existing locks | Source reads before transaction? | Proposed gate needed | Required future change |
|---|---|---|---|---|---|
| `create` | **Partial**: transaction wraps only `admission.create` + audit | **None explicit** (implicit FK key-share on booking/resident/bed on insert); `UNIQUE(booking_id)` is the backstop | **Yes**: booking (CONFIRMED check), existing admission, room/property resolution, `assertWithinBooking` all before the tx | Yes | Move reads into the tx; lock Bed → Resident → Booking before insert (cycle C1). |
| `update` (no status change) | **None** — `this.prisma.db.admission.update` then a *separate* `this.prisma.db.auditEvent.create` | None | Yes (`findOne` incl. booking; date validated against that read) | Yes | Put in one tx; lock Booking → Admission; revalidate booking dates under lock; audit atomic. |
| `update` approve | Yes (defaults) | Admission `FOR UPDATE` | Yes (`findOne`) | Yes | Gate; revalidate booking status/dates under lock. |
| `update` cancel / reopen | Yes (defaults) | Admission `FOR UPDATE`; check-in read unlocked (protected indirectly: check-in create locks the Admission) | Yes | Yes | Gate. |

### Check-in / check-out

| Path | Current transaction | Existing locks | Source reads before transaction? | Proposed gate needed | Required future change |
|---|---|---|---|---|---|
| `create` | Yes (`10 s / 20 s`) | Bed → Resident → Booking → Admission `FOR UPDATE`, then re-read | Unlocked probe for ids (hint only) | Yes | Gate before Bed. Audit is already in the tx (working-tree change over HEAD). Add historical-interval validation if the invariant is to hold beyond corrections (§2.4). |
| `update` (notes) | **None** — `findOne` then `updateMany` | None (the `UPDATE` takes a row lock) | Yes | v1.2: shared only when legacy billing facts can change | Guard the legacy `CHECKED_OUT`-without-`CheckOut` case (notes edit moves `updatedAt`, which billing uses as the end). |
| `checkOut` | Yes (`10 s / 20 s`) | CheckIn `FOR UPDATE` only; insert takes implicit key-share on resident/bed/booking | Parsing only | Yes | Gate before CheckIn. Audit already in tx. |

### Resident

| Path | Current transaction | Existing locks | Source reads before transaction? | Proposed gate needed | Required future change |
|---|---|---|---|---|---|
| `create` | **None** (single insert); **no audit** written | None | n/a | No (v1.2) | Creation-only; cannot masquerade as a correction. |
| `update` | **None** (non-archive path: `findOne` then `update`) | Implicit row lock from the `UPDATE` | Yes | No | Reject `firstName`/`lastName` (candidate fields) in ordinary routes (v1.2 / Decision 15). |
| `archive` / archiving `update` | Yes (defaults) — `archiveGuarded` | Resident row via a deliberate no-op `UPDATE … updatedAt`; then active-check-in read | `findOne` first | No | Preserve; note it bumps `updatedAt` (stale-detection must not use it). |
| `EnquiryService.convert` | Yes (defaults) | Enquiry `FOR UPDATE`, then Resident insert | None material | No | Creation-only. |

### Finance

| Path | Current transaction | Existing locks | Source reads before transaction? | Proposed gate needed | Required future change |
|---|---|---|---|---|---|
| `createDraft` | Yes (`10 s / 30 s`) but **reads are outside it** | Numbering advisory → insert | **Yes — resident, booking, `billableStays` and the amount (`booking.monthlyPrice`) are read through `this.prisma.db` before the tx** | Yes | Move all reads inside; lock source chain (or rely on exclusion, §3.1); recheck. |
| `generateMonthly` / `planMonthly` | Yes (`10 s / 30 s`); reads inside | Numbering advisory; **no source row locks**; plan is several READ COMMITTED statements; `createMany({ skipDuplicates: true })` | None, but reads are un-locked and not a single snapshot | Yes | Gate before numbering; plan under exclusion or under source locks; scheduler issues directly (`issue: true`). |
| `previewMonthly` | **None** | None | n/a (read-only) | No (advisory only) | Never evidence for approval. |
| `issue` | Yes | Invoice `FOR UPDATE` only | **No source read at all — no recalculation** | Yes | Gate, validate current eligibility/amount, new conflict code (none defined in §9). |
| `recordPayment` | Yes | Idempotency advisory (`payment-idempotency:<org>:<key>`) → Invoice; payment insert fires `finance_snapshot_payment` (re-locks the invoice) and FK key-share on resident/invoice | None | No (settlement) | Unchanged; but see cycle C2. |
| `reversePayment` | Yes | Invoice (payment read first, unlocked, immutable) | Payment lookup | No | Unchanged. |
| `adjustInvoice` | Yes | Invoice | None | No | Unchanged; correction-linked remedies add an OWNER gate. |
| `voidInvoice` | Yes | Invoice; `finance_check_void` trigger re-locks it | None | No | Unchanged; draft void also reachable from a correction (same tx). |

### Scheduler and other entry points

| Path | Current transaction | Existing locks | Source reads before transaction? | Proposed gate needed | Required future change |
|---|---|---|---|---|---|
| `InvoiceSchedulerService` (separate process `run-invoice-schedule.js`) | One `generateMonthly` tx per organization-month; retries transient errors up to 3 attempts | As `generateMonthly`; **`issue: true`**, system actor, default lookback = previous + current month | `previewMonthly` for dry runs | Yes (through `generateMonthly`) | Gate in the service, not the caller; decide auto-issue policy for correction-created gaps (§3.5). |
| `POST /finance/invoices/generate-monthly` | As `generateMonthly`; both roles; optional `issue` | As above | None | Yes | Same. |
| `POST /finance/invoices`, `/:id/issue` | As above | As above | See `createDraft` / `issue` | Yes | Same. |
| **Inventory writers** (bed / room / floor / property archive, label, `operationalStatus`) | Plain `updateMany`, no explicit tx or locks | None | Yes | **Not in v1.2 §12** | **[UNV]** Bed `archivedAt`/`operationalStatus` are read by booking and check-in rules; whether correction validators consult them is not specified. Decide and, if yes, add to the inventory. |
| Membership / session writers (`auth.repository`) | Some transactions | n/a | n/a | n/a | Relevant to reviewer eligibility revalidation (Decisions 12, 16), not lifecycle facts. |
| Privileged SQL, maintenance and migration scripts | Outside the application | None | n/a | Not enforceable | Application advisory locks cannot protect against them (v1.2 already says so). |

**[VRF] Pattern summary:** of the lifecycle and Finance writers above, **two** (`Admission.update` non-status branch, `CheckIn.update` notes) have no transaction; **three** write from authoritative source reads made outside the writing transaction and never revalidated (`Admission.create`, `Admission.update` — all branches, including the status classification taken from the pre-lock read — and `FinanceService.createDraft`); **none** acquires an organization-level lifecycle gate; `FinanceService.issue` performs no source validation.

## 3.4 Lock ordering and cycles

### Observed acquisition orders (explicit locks)

| Path | Order |
|---|---|
| `Booking.create` | Bed → (insert; implicit key-share Resident, Org) |
| `Booking.update` / `extend` | Bed → Booking |
| `Admission.create` | (none) → insert (implicit key-share Bed, Booking, Resident, Org, Property/Room) |
| `Admission.update` cancel/reopen/approve | Admission |
| `CheckIn.create` | Bed → Resident → Booking → Admission |
| `CheckIn.checkOut` | CheckIn → (insert checkout; implicit key-share Resident, Bed, Booking) |
| `Resident` archive / update | Resident (via `UPDATE`) |
| `Finance.createDraft` / `generateMonthly` | Numbering advisory → (insert invoice; implicit key-share Resident, Booking, Org) |
| `Finance.recordPayment` | Idempotency advisory → Invoice → (insert payment; implicit key-share Resident, Invoice, Org) |
| `Finance.reverse` / `adjust` / `void` / `issue` | Invoice |

**[VRF] Existing explicit orders are consistent**: every explicit sequence is a prefix-ordered subset of Bed → Resident → Booking → Admission → CheckIn, as the `CheckInService` comment states. **[UNV]** Implicit foreign-key checks acquire `FOR KEY SHARE` on referenced rows; `FOR UPDATE` conflicts with it. That mechanism is standard PostgreSQL row-locking behaviour but was not among the pages read in this task, so every cycle below is **derived, not demonstrated**, and each needs a `pg_locks` / forced-interleaving test.

### Derived cycles and order violations

| ID | Description | Why v1.2's list does not prevent it | Label |
|---|---|---|---|
| **C1** | `Admission.create` changed per v1.2 to "lock Booking before Admission": it holds **Booking** `FOR UPDATE`, then its insert needs key-share on **Bed** (and Resident). `CheckIn.create` holds **Bed** (and Resident) `FOR UPDATE` and waits for **Booking**. Booking-then-Bed is the reverse of the stated Bed-then-Booking order. The same cycle exists against `Booking.update` (Bed → Booking). | The order list covers explicit locks only; the implicit insert-time locks run *after* the explicit one. | [ADV/UNV] derived |
| **C2** | A correction under v1.2's step 4 holds **Resident** `FOR UPDATE` and then locks an **Invoice** (to capture balances / classify slots / void a draft). `recordPayment` holds the **Invoice** and its payment insert needs key-share on **Resident** (`Payment` has a composite FK to `residents`). Resident→Invoice vs Invoice→Resident. Existing code has no Resident-then-Invoice path, so this is introduced by the design. | v1.2: "Standalone payment/reversal/credit/void … never acquire the lifecycle gate after an invoice lock" — true, but the gate is not the lock involved. | [ADV/UNV] derived |
| **C3** | Self-wait across connections: a correction handler (holding the EXCLUSIVE gate) that calls a public service method which opens its own `$transaction` on `this.prisma.db` runs on a second connection, requests the gate and waits on its own caller. PostgreSQL cannot see an application-level wait, so no deadlock error is raised; only timeouts end it. | **[VRF]** All Finance methods use `this.prisma.db`; only `outstanding()` accepts a `tx` (a working-tree change over HEAD). | [ADV] |
| **C4** | Gate vs invoice-number advisory: v1.2 orders gate → numbering. Today numbering is first within Finance, and no other path takes numbering after a source row. No reverse edge exists in the current source. | — | [VRF] (no cycle found) |
| **C5** | Queue behaviour: an EXCLUSIVE request waiting for a long SHARED holder (e.g. a monthly run) may cause *new* SHARED requests to queue behind it, so the effective stall is the long holder plus the correction, not the correction alone. | Not discussed. | [UNV] — PostgreSQL lock-queue behaviour; documentation read here is silent |
| **C6** | Incidental trigger locks: `finance_snapshot_payment` and `finance_check_void` run `SELECT … FOR UPDATE` on the same invoice already locked by the caller (no new edge). The admission/check-in/check-out integrity triggers use plain `EXISTS (SELECT …)` — no row locks. | — | [VRF] code |
| **C7** | Reads before locks: `Admission.create`/`update`, `Finance.createDraft`, and the unlocked probes in Booking/CheckIn create/extend/update. Probes are hints and are revalidated; the first three are not. | v1.2 lists the first three for change. | [VRF] |
| **C8** | `Admission.update` (non-status) writes without any lock while `Booking.update` reads the admission without a lock: a write-skew pair (booking shortening vs admission date move) that no existing lock serializes. | Closed only by v1.2's Booking → Admission rule or by a single gate. | [VRF] gap |
| **C9** | Prisma `timeout` expiry may not unblock a statement that is waiting for a lock (client protocol is sequential per connection). A bounded `lock_timeout` is therefore necessary, not optional. | v1.2 proposes 5 s but also shows ordinary writers without one. | [UNV] |
| **C10** | Omitted writers: inventory (bed/room/property), membership revocation, any maintenance SQL. | See §3.3. | [VRF] |

**[ADV]** The specification may not claim its order safe merely because it lists one. Before enablement, P4-2.3/P4-2.4 review must include implicit FK locks and trigger locks per path.

## 3.5 The Finance shared-reader problem

**[V1.2]** A shared gate lets ordinary writers and Finance readers overlap; v1.2 adds source row-lock chains for Finance. What the source shows today and what v1.2 would change:

| Area | Current source [VRF] | v1.2 proposal [V1.2] | Residual gap |
|---|---|---|---|
| Booking-derived draft amount | `createDraft` reads booking, stays and `monthlyPrice` **before** the tx; writes an amount computed from that read | All authoritative reads inside the gated tx; numbering → source chain → create | Needs chain sets defined (H6); amount is only as fresh as the locks |
| Monthly candidate discovery | `planMonthly`: several READ COMMITTED statements inside the tx, un-locked | Discover candidate booking ids, lock chains in table/UUID order, **recompute after locking**; restart if a chain differs; bookings admitted after the cut wait for a later run | Candidate *discovery* is not a stable set; late candidates are explicit "later run" |
| Missing active invoice slots | Partial unique indexes prevent duplicate active invoices per booking/month (and per resident for legacy); `createMany({ skipDuplicates: true })` silently absorbs conflicts | Indexes remain "final duplicate backstop"; omitted slots become `REVIEW_REQUIRED`/manual | Indexes prevent duplicates, **not omissions or wrong amounts**; see scheduler note below |
| Issue of existing drafts | `issue` locks only the Invoice; no source revalidation | SHARED → source chain → Invoice → validate current eligibility and amount; stale draft fails | No conflict code defined in §9 for "recalculation required" (nearest: `FINANCE_CONFLICT`) |
| Payment / reversal / credit / void | Invoice-locked, append-only, no lifecycle read | Preserve invoice-first; correction-linked remedy gated to OWNER | Cycle C2 |
| Concurrent booking/admission/checkout vs Finance | None; no gate | Shared gate + row chains | Row chains lock many rows for a long time during monthly generation |

**Distinguishing the four guarantees** the task asks about:

1. **Consistent point-in-time read.** Requires a single statement or a REPEATABLE READ / SERIALIZABLE snapshot. **[VRF·DOC]** READ COMMITTED gives each statement its own snapshot ("two successive SELECT commands can see different data"). **[VRF]** The only snapshot-isolated transaction in the repository is the read-only `StaySummaryService` (`RepeatableRead`). `FinanceService` never sets an isolation level. v1.2 does not choose one; it relies on locks.
2. **Locked stable source set.** Row locks pin *known* rows. For a booking-scoped draft the chain is bounded: **[VRF]** `UNIQUE(admissions.booking_id)` and `UNIQUE(check_ins.admission_id)` and `UNIQUE(check_outs.check_in_id)` give at most one admission, one check-in and one checkout per booking, and **[VRF]** `CheckIn.create` locks Resident, Booking and Admission, so an *absent* check-in cannot appear while a Finance transaction holds the Booking row — **provided `Admission.create` also locks the Booking, which it does not today.** For the org-wide monthly set there is no parent row to lock.
3. **Absent-row uniqueness constraint.** The `invoices_active_booking_period_key` and legacy partial unique indexes prevent a *second* active invoice. They do not make the first one correct.
4. **A later explicit billing run.** The designed answer for late candidates. **[VRF]** The scheduler re-covers the previous and current month on every run and **issues** what it creates.

**[VRF/ADV] Scheduler hazard (not addressed by v1.2).** `generateMonthly(…, { issue: true })` creates invoices directly as `ISSUED`, with the amount from the plan. v1.2 §10 says approval must not create retrospective invoices and that missing slots are handled by manual review. But if a correction makes a stay newly billable in the previous or current month, the **next scheduled run will create and issue that invoice automatically**, bypassing the REVIEW_REQUIRED path. The manual `generate-monthly` endpoint (both roles, `issue` optional, months up to next month) can do the same for any in-range month. **Unresolved in v1.2.** Needs an explicit rule (e.g. a correction-created gap suppresses auto-issue until an OWNER review closes it) belonging jointly to Decisions 6, 9 and 10.

**[ADV]** Under the recommended exclusive scoping, items 1–2 are met by exclusion for lifecycle-derived facts, with no new row-lock chain; item 3 is unchanged; item 4 remains the answer for late candidates and for the scheduler hazard above.

## 3.6 Contention at Nook's scale and proposed acceptance criteria

**Operations an exclusive correction (or, under the recommendation, any gate holder) can delay [VRF scope]:** new bookings; booking extension / cancellation; admissions (create, approve, cancel, reopen, date update); check-ins and check-outs; draft creation; invoice issue; monthly generation (API or scheduler); correction submissions for gated fields. Not delayed: payments, reversals, credits, voids, reads, resident profile edits, enquiry work, name/`reason` corrections.

**[VRF] Timeout interaction.** Booking, Admission and Resident transactions run with Prisma defaults (`maxWait` 2 s, `timeout` 5 s). A correction transaction of the v1.2 maximum (30 s) holding the gate would make these ordinary operations fail with a transaction timeout (P2028-class error), not a clean conflict. `@prisma/adapter-pg` opens a pooled connection per transaction and `PrismaService` uses the pool defaults [UNV: default maximum 10], so blocked ordinary requests also consume connections.

**[ADV] Proportionality.** The hybrid is a defensible long-term shape but is not demonstrably proportionate at ~100 beds *relative to the simpler scoped-exclusive gate*: both stall gate-covered operations during a correction; the hybrid adds only ordinary-vs-ordinary and Finance-vs-ordinary overlap, bought with the extra protocol in §3.4–3.5. No throughput figure exists or is invented here.

**Proposed PostgreSQL acceptance criteria (all [ADV]; none is an existing measurement):**

| # | Criterion | Proposed threshold | Basis |
|---|---|---|---|
| A1 | Ordinary writers' maximum gate wait | `lock_timeout` ≤ 3 s on every gate acquirer; expiry returns 409 `RETRY_REQUIRED`, never a Prisma transaction-timeout error | Shortest ordinary `timeout` is 5 s [VRF] |
| A2 | Maximum correction gate-hold time (gate acquired → commit) | Hard maximum ≤ 2 s on the test fixture; target p95 ≤ 500 ms | Must stay below A1 + margin and below the 5 s default timeouts |
| A3 | Correction attempt bounds | 5 s per lock acquisition ([V1.2]); one attempt never exceeds the 30 s transaction timeout; remaining-budget logic so `5 s × N waits` cannot exceed it | Per-acquisition `lock_timeout` is not a total bound |
| A4 | Monthly generation hold | ≤ A1 minus margin on the 100-bed fixture; otherwise batch per booking | Generation is idempotent by slot uniqueness, so batching is safe in principle |
| A5 | Ordinary-operation latency impact | p95 with gate acquisition and no contention within 5 % of the same suite's pre-gate p95 on the same hardware | Relative, so no absolute number is invented |
| A6 | Deadlocks | **Zero** 40P01 across ≥ 1,000 randomized interleavings per race pair in §6; a 40P01 is a defect to fix, not to retry | Retries are a safety net |
| A7 | Retry behaviour | ≤ 2 whole-transaction retries ([V1.2]); no duplicate audit, receipt or application after any retried attempt | Decision 16 |
| A8 | Queue effect | With a simulated 2 s SHARED holder and a waiting EXCLUSIVE request, record the wait of a *new* SHARED request | C5 |
| A9 | Pool | With the gate held and K waiting ordinary requests, non-gated endpoints stay responsive | Pool exhaustion risk |
| A10 | `lock_timeout` coverage | Demonstrate that `lock_timeout` aborts a wait for the gate (advisory) and for row locks | §3.2 [UNV] |

**Workload assumptions (test design, not forecasts):** 100 beds; 100 residents each with a booking and stay; 12 months of invoices; ≥ 10 concurrent ordinary clients; one simulated scheduler run; one correction of each gated field type. Mock-based tests cannot satisfy any of A1–A10.

---

# 4. Decision 7 — CheckOut tenant-safe reference

**[V1.2]** Reuse `CheckOut.organizationId`; add only `@@unique([id, organizationId])` on CheckOut; reference it from a direct composite correction FK `(check_out_target_id, organization_id)`.

## 4.1 Verified schema (separated from proposed design)

| Fact | Result | Label |
|---|---|---|
| CheckOut primary key | `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` | [VRF] |
| `CheckOut.organizationId` | `String @map("organization_id") @db.Uuid`, NOT NULL | [VRF] |
| Direct Organization relation | `organization @relation(fields:[organizationId], references:[id], onDelete: Restrict, onUpdate: Restrict)` | [VRF] |
| Composite relation to CheckIn | `(checkInId, organizationId)` → `CheckIn(id, organizationId)` | [VRF] |
| Composite relations to Resident / Booking / Bed | `(residentId|bookingId|bedId, organizationId)` → each parent's `(id, organizationId)` | [VRF] |
| Existing unique keys | `checkInId @unique`; `@@unique([checkInId, organizationId])` (`check_outs_check_in_id_organization_id_key`, migration `20261101190000`); `@@index([organizationId])` | [VRF] |
| `[id, organizationId]` today | **Absent** from schema and every migration | [VRF] |
| Integrity trigger | `check_outs_match_check_in` ensures resident/bed/booking equal the check-in's | [VRF] |
| `CorrectionProposal` today | **Absent** (schema, migrations, generated client) | [VRF] |
| Proposed composite unique, FK, enum, columns | Everything proposal-side | [V1.2] |

The existing `(checkInId, organizationId)` unique cannot back a foreign key that references `check_outs(id, organization_id)`: a FK needs a unique constraint over exactly the referenced columns.

## 4.2 Options

| Criterion | A — direct target `CheckOut.id` + new `[id, organizationId]` unique (v1.2) | B — derive tenant only through CheckIn + extra cross-table enforcement | C — use `(checkInId, organizationId)` as the CheckOut target identity |
|---|---|---|---|
| Declarative FK enforcement | Yes: `(check_out_target_id, organization_id)` → `check_outs(id, organization_id)` | No: an FK to `check_outs(id)` alone cannot compare organizations; needs a trigger or equivalent | Yes: existing unique already backs the FK |
| Tenant-mismatch protection | Database-level, same mechanism as the other four targets | Trigger-level; bypassable by whatever bypasses triggers; invisible to Prisma | Database-level |
| Prisma relation complexity | One added `@@unique` + one relation like the other four | Plain single-column relation + hidden trigger | Relation references a non-`id` compound key; the column named `check_out_target_id` would hold a *check-in* id |
| SQL constraint complexity | One `CREATE UNIQUE INDEX` | Trigger function + trigger | None new |
| Query simplicity | Target id = `check_outs.id` | Same | Needs a join/translation from check-in id |
| API target-identity consistency | Consistent with audit and history: `checkout.created` audit uses `targetId = check_out.id`, `targetType = 'check_out'` [VRF]; the history service's target lookup returns `checkOutIds` [VRF] | Same | Inconsistent: CHECK_OUT and CHECK_IN targets would share one id domain, and audit/history ids would differ from the correction target id |
| Index / storage overhead | One redundant unique btree over `(id, organization_id)` on a small table | None | None |
| Migration risk | Cannot fail on existing data (`id` is already unique). A plain `CREATE UNIQUE INDEX` blocks writes to `check_outs` while it builds; the repo's precedent migration `20261101190000_tenant_composite_keys…` created its keys the same way. Whether `CONCURRENTLY` is usable inside a Prisma migration was not verified. | Trigger-behaviour risk | None |

**[ADV] Recommendation: Option A.** It is the only option that gives the same declarative tenant guarantee as the other four targets *and* keeps one id meaning per target type, which the audit/history code already assumes. Option B repeats the repo's trigger pattern but is weaker; Option C removes the index by changing identity semantics for a single type.

## 4.3 Typed-target design

| Element | Assessment | Label |
|---|---|---|
| One shared `organizationId` | Matches how every existing model uses its single `organizationId` in several composite relations (Booking, Admission, CheckIn, CheckOut…). | [VRF] pattern; [V1.2] use |
| Five nullable typed target ids with optional composite relations | `Payment.corrects` is an existing optional relation over `(correctsPaymentId String?, organizationId String)` with `Restrict`, so Prisma 7.10.1 accepts a nullable id paired with a required organization column. | [VRF] precedent |
| Exactly-one-target | Only a SQL `CHECK` can express it; Prisma cannot. Essential, because **MATCH SIMPLE** composite FKs skip a NULL component (a row with all five ids NULL passes every FK and sits in no partial index). | [V1.2] / reviewed SQL required |
| Target-type compatibility; field compatibility; terminal row shapes | SQL `CHECK`s only. | reviewed SQL required |
| `ON DELETE` / `ON UPDATE` | `RESTRICT` (repo convention). Do not use `SET NULL`: for a composite FK it would try to null the NOT NULL organization column (the repo's own migration comments explain this). | [VRF]/[V1.2] |
| Backrelations and relation names | Required on Resident, Booking, Admission, CheckIn, CheckOut and Organization; `requestedBy` and `decidedBy` both point to User and `relatedProposalId` is a self-relation, so named relations are mandatory. | [V1.2]; Prisma requirement [UNV until generated] |
| Self-relation `relatedProposalId` | A same-tenant composite self-FK needs `UNIQUE(id, organization_id)` on `correction_proposals` (v1.2 lists it). | [V1.2] |
| Partial unique indexes ×5 | Prisma `@@unique` cannot express partial predicates. Existing precedent keeps such indexes SQL-only with a schema comment (`invoices_active_*`). Whether Prisma tooling tolerates them across migrate/diff was not verified. | [VRF] precedent; [UNV] tooling |
| Cross-tenant access errors | The FK (23503; the adapter maps it) is a backstop only. The service must resolve targets with an `organizationId` filter first and answer 404 with the same shape as an unknown id; it must never surface the FK error. | [VRF] mapping exists; behaviour [ADV] |
| Tracked generated client | **[VRF]** `apps/api/src/generated` is tracked by Git; a schema change means a regenerated, committed client. CI migration manifests also exist under `scripts/ci/` (`g6b-migrations.json`, `test-files.json`). Both belong to P4-2.1's reviewed scope. | [VRF] |

**Needs explicit reviewed SQL (Prisma cannot express it cleanly) [ADV]:** the five partial unique indexes; exactly-one-target; target-type and field-compatibility CHECKs; terminal row-shape CHECKs; the self-review CHECK (decision actor ≠ requester except WITHDRAWN); the transition/immutability triggers; any Finance-link exclusivity CHECK; jsonb envelope validation; same-resident/booking equality for Finance links (§4.4).

## 4.4 Finance link consistency

**[V1.2]** `CorrectionFinanceLink` references Invoice via its existing key and optionally an adjustment, payment reversal or void. Verified keys:

| Referenced record | Verified columns | Verified existing keys | Tenant-safe reference today? | v1.2 needs a new key? |
|---|---|---|---|---|
| Invoice | `id`, `organization_id`, `resident_id` | `UNIQUE(id, organization_id, resident_id)` (`invoices_id_organization_id_resident_id_key`) | Yes | No |
| InvoiceAdjustment | `id`, `organization_id`, `invoice_id`, `resident_id`; composite FK `(invoice_id, organization_id, resident_id)` → invoices | PK `id` only | Operation→invoice link is already tenant- and resident-safe | **Yes** — `(id, invoice_id, organization_id)` |
| InvoiceVoid | `id`, `organization_id`, `invoice_id`, `resident_id`; same composite FK | `UNIQUE(invoice_id)` only | Same | **Yes**. Since one void exists per invoice, a smaller `(invoice_id, organization_id)` unique would also work; v1.2 chose `(id, invoice_id, organization_id)` |
| PaymentReversal | `id`, `organization_id`, `payment_id`, `invoice_id`; **no `resident_id`**; composite FK `(payment_id, invoice_id, organization_id)` → payments | PK `id`; `UNIQUE(payment_id)` | Invoice/tenant yes; resident only transitively through `payments` | **Yes** — `(id, invoice_id, organization_id)` |
| Payment (replacement) | `id`, `organization_id`, `invoice_id`, `resident_id`, `corrects_payment_id` | `UNIQUE(id, invoice_id, organization_id)` and `UNIQUE(id, organization_id)` | Yes | **No**; but v1.2's link design does not list replacement payments although Decision 8 reuses them. |

**Equality that foreign keys do and do not prove [ADV]:**

* With link FKs `(invoice_id, organization_id, resident_id)` → invoices and `(operation_id, invoice_id, organization_id)` → operation table, the operation provably belongs to the linked invoice, organization and (transitively) resident. A bare id FK would prove nothing about invoice, resident or organization.
* Nothing proves the linked invoice is *affected by the proposal's target* (same resident as a Resident/Booking target; same booking as a Booking target). `CorrectionProposal` stores no resident column, so no declarative equality is possible. This needs either a denormalized resident/booking column with composite FKs, or a reviewed constrained trigger plus transactional service validation. **Currently missing in v1.2.**
* A User FK on the resolving actor proves identity, never OWNER role (v1.2 already states this).
* A REVIEW_REQUIRED link (no operation, no approver) versus a resolved link (operation + approving OWNER + reason) needs a mutual-exclusivity CHECK; "unique resolution keys" are named but not defined.

---

# 5. Decision 16 — Retry and status contracts

## 5.1 State machine

**[V1.2]** States `PENDING`, `APPLIED`, `REJECTED`, `WITHDRAWN`, `STALE`; no APPROVED-but-unapplied state; terminal states do not transition; reversal is a new proposal.

| Transition | Actor / authority | Durable effect | Does not happen | Notes |
|---|---|---|---|---|
| none → `PENDING` | Eligible submitter | Proposal + submission audit + receipt (one tx) | — | Fails with `PENDING_CONFLICT` if a PENDING proposal holds the field slot |
| `PENDING` → `APPLIED` | Independent eligible reviewer | Source change + domain audit + correction audit + links + receipt + proposal (one tx) | Any partial effect on failure | Authority and age per Decisions 2–4, 12 |
| `PENDING` → `REJECTED` | Independent eligible reviewer, mandatory reason | Proposal + audit + receipt | Source change | Reviewer is OWNER for financial/exceptional (Decision 2) |
| `PENDING` → `WITHDRAWN` | Requester only, mandatory reason | Proposal + audit + receipt | Source change | `decided_by = requested_by` allowed here only |
| `PENDING` → `STALE` | An *authorized* approval attempt that detects a changed dependency | Proposal + stale audit + receipt **committed**, then 409 | Source change | `decided_by` = detecting actor |
| any terminal → any | Forbidden | — | — | Exact replay returns the stored result; any other command → `INVALID_STATE` |

| Item to confirm | Finding | Label |
|---|---|---|
| Terminal states cannot transition again | Enforced only by service logic plus the proposed transition trigger; precedent for append-only triggers exists (`payments_immutable`, `invoice_voids_immutable`, `payment_idempotency_keys_immutable`) | [V1.2]; precedent [VRF]; runtime [UNV] |
| Same-key exact replay returns the original result | Matches the existing payment idempotency pattern (stored response, `idempotentReplay` flag, advisory lock on the key hash) | [V1.2]; precedent [VRF] |
| Changed payload / action under the same key → idempotency conflict | Matches existing payment behaviour (409 on hash mismatch) | [V1.2]; precedent [VRF] |
| Different key, same field → `PENDING_CONFLICT` | Index-arbitrated; reached only after the same-key receipt check | [V1.2] |
| Validation conflict does not mark STALE | v1.2 text says so, but the STALE/validator boundary for absence/range facts is undefined (§2.3 Ambiguity A) | [UNV] |
| STALE commits before 409 | **[VRF]** Existing services signal conflicts by throwing inside the `$transaction` callback, which rolls back. STALE needs a return-then-throw pattern (return an outcome from the callback, commit, then raise the HTTP error) that does not exist today. | [VRF] gap → [ADV] |
| Rollback failures leave PENDING | Consistent with a single-transaction design; there is no failure state | [V1.2] |
| Reversal is a new proposal | Same-tenant `relatedProposalId` with kind `REVERSAL`; target/field must match; the old proposal never changes | [V1.2] |

**Ambiguities [ADV] to close in the specification:**

1. **STALE `decisionReason`.** The approve command requires a `decisionReason` (an approval justification). On a STALE outcome v1.2 requires a recorded decision reason but the text is not an approval. Define: a closed stale-cause code in the outcome, with the reviewer's attempted text either stored clearly labelled as an attempted rationale or discarded; never copied to `AuditEvent`.
2. **`decidedAt` / `appliedAt` source.** `now()` in PostgreSQL is transaction-start time, which can be stale after lock waits. How the final decision instant is sampled is **Decision 3's pending clarification and is not decided here**; Decision 16 only requires that each attempt and each retry re-sample it.
3. **Order of authorization versus staleness** (§2.3): authorization, self-review and terminal-state checks must precede the snapshot comparison, or an unentitled caller could commit a terminal STALE.
4. **Stuck PENDING.** A proposal that deterministically fails (e.g. `FINANCE_CONFLICT`) remains `PENDING` indefinitely and holds its slot until withdrawn (requester) or rejected (independent reviewer). There is no expiry or `FAILED` status and none is proposed here; for a revoked requester only rejection can free the slot.
5. **`appliedAt` vs `decidedAt`.** Both are required for APPLIED; state whether they are one instant or two.
6. **Self-review.** Both service check and CHECK compare user ids; Decision 12 defines independence; unchanged here.

## 5.2 Command receipts

**[V1.2]** `CorrectionCommandReceipt`: id, organizationId, actorId, key, requestHash, proposalId, action, outcomeCode, recordedAt; `UNIQUE(organizationId, actorId, key)`; same-tenant proposal FK; created in the same transaction as the effect; shared key namespace across submit/approve/reject/withdraw; outcome references, not values.

| Check | Assessment | Label |
|---|---|---|
| Uniqueness `(organization, actor, key)` | Stricter than the existing payment table, which is unique on `(organization_id, key)` and not actor-scoped. Actor scoping avoids one user learning (via a 409) that another user used a key. | [VRF] precedent; [V1.2] |
| Key format | Existing payment keys are `^[A-Za-z0-9_.:-]{8,128}$` with a DB CHECK; v1.2 requires a UUID. Different formats across modules are acceptable but must be stated. | [VRF]/[V1.2] |
| `requestHash` content | "canonical payload" is undefined (key ordering, trimmed strings, canonical decimal `"8500.00"`, instants as text). The payment precedent hashes a fixed-order array with `JSON.stringify` + SHA-256 and a `^[0-9a-f]{64}$` CHECK. | [VRF] precedent; definition [ADV] |
| Low-entropy hash exposure | A plain SHA-256 of a short name or a price is dictionary-attackable offline by anyone who can read receipt rows; the key is stored in the clear next to it. Protected values must not be recoverable from receipts. **[ADV]** Use a keyed hash (HMAC with a server-side secret and key id) or compare against the stored proposal row. | [ADV] |
| Route / action / proposal / tenant binding | Receipt stores `action` and `proposalId`. On replay the service must check path `:id` and route action equal the stored values, else `IDEMPOTENCY_CONFLICT`. At *submission* the proposal id does not exist yet, so the hash cannot include it; v1.2's wording ("proposal id") applies to decisions only. | [ADV] clarification |
| Same-key different action | Shared namespace → `IDEMPOTENCY_CONFLICT`. | [V1.2] |
| Same-key same payload | Replay: 201 / 200 / 409(STALE) with stored safe result; no new mutation or audit. | [V1.2] |
| Cross-tenant replay | Key scope includes the session's organization. Resolve the target with an organization filter (404) **before** any receipt lookup so receipts never confirm another tenant's proposal. | [ADV] order |
| Role revoked or changed at replay | v1.2: revalidate current auth and role; replay is not an authorization bypass. Consequence: a demoted or revoked actor receives 403/401 on a retry although the command committed; the authorized detail GET is the way to see the state. | [V1.2]/[ADV] |
| Committed STALE | Receipt stored with a stale outcome code; replay returns 409 `STALE_SOURCE`. | [V1.2] |
| Uncertain commit | v1.2: "look up the same key". **No lookup-by-key route exists in §9**; the lookup is re-POSTing with the same key. That is safe only because receipt creation and the effect share one transaction. | [V1.2]; gap [ADV] |
| Atomicity of receipt and mutation | "Receipt exists ⇔ the command committed" requires both inserts in the same transaction; a same-key advisory lock (the payment path already does this) serializes concurrent duplicates. | [VRF] precedent; runtime [UNV] |
| Overlap of proposal `correlationId` uniqueness and receipt uniqueness | Redundant by design for submission. v1.2 §4 calls the value a "request key UUID" in the envelope while §9 takes `Idempotency-Key` as a header and the body example has no key field. **[ADV]** Declare the header the single source and `correlationId` its copy. | [ADV] |
| Error outcomes persisted? | No (except committed STALE). Re-submitting a failed command under the same key re-executes it, and a different payload under that key is treated as new, not as a conflict. Consistent with "failed means no effect". | [V1.2] |
| Protected values | Receipts hold outcome codes and ids only; apart from the hash caveat above they hold no personal values. | [V1.2] |
| Immutability and retention | Not stated. Precedent: `payment_idempotency_keys_immutable` forbids update/delete. **[ADV]** Same for receipts; retention follows Decision 14. | [VRF] precedent; [ADV] |

## 5.3 Retry semantics

### Timeouts are four different things

| Setting | Measures | Enforced by | Today in the repo [VRF] | v1.2 proposal |
|---|---|---|---|---|
| Prisma `maxWait` | Time to obtain a transaction (connection checkout / start) | Prisma client | Default 2 s; CheckIn 10 s; Finance 10 s | 10 s |
| Prisma `timeout` | Total wall time of the interactive transaction before Prisma rolls it back | Prisma client | Default 5 s; CheckIn 20 s; Finance 30 s | 30 s |
| PostgreSQL `lock_timeout` | Each individual lock wait | PostgreSQL | **Not set anywhere in `apps/api/src`** | 5 s (transaction-local) |
| PostgreSQL `statement_timeout` | A statement's elapsed time, which **includes** lock waits inside it | PostgreSQL | Not set in source; documented default 0 = disabled; deployment value unknown | Not proposed |

Consequences: `lock_timeout` is per acquisition, so `N` waits can sum to `N × 5 s` and exceed the 30 s transaction timeout (the resulting Prisma timeout error is not in v1.2's error table); Prisma's `timeout` rolling back a transaction does not necessarily cancel a statement that is already blocked on a lock because a connection processes statements sequentially [UNV], so a bounded `lock_timeout` is required; `maxWait` says nothing about lock waits. **[ADV]** Add a remaining-budget rule (set `lock_timeout` to the smaller of 5 s and the time left) and a total command deadline across attempts (suggest ≤ 45 s; shorter caller limits win), because three 30 s attempts plus jitter exceed typical client and proxy limits and make the uncertain-commit case likelier.

### Error classes

| Condition | SQLSTATE | Adapter mapping [VRF] | Retry whole transaction automatically? | Notes |
|---|---|---|---|---|
| Serialization failure | 40001 | `TransactionWriteConflict` (Prisma `P2034`) | Yes, ≤ 2 ([V1.2]) | At READ COMMITTED PostgreSQL does not normally raise it; v1.2 does not choose an isolation level, so this is defensive unless REPEATABLE READ/SERIALIZABLE is chosen [UNV] |
| Deadlock | 40P01 | `TransactionWriteConflict` | Yes, ≤ 2 | Acceptance requires zero in tests (A6) |
| Lock timeout | 55P03 | **Not mapped**: falls through to a generic `postgres` kind with `originalCode` | No → 409 `RETRY_REQUIRED` | Classification must read `originalCode` (`cause`/`meta.driverAdapterError.cause.originalCode`), as `isTransientError` does. Whether the exact Prisma error code/shape is stable must be shown [UNV]. The repo's `isTransientError` does **not** list 55P03. |
| Statement timeout / cancel | 57014 | Not mapped | No | |
| Connection failure | 08xxx, `ECONNRESET`… | Socket errors mapped by the adapter | No auto-retry ([V1.2]) | Commit outcome unknown only if the loss happened during `COMMIT` |
| Unknown commit outcome | — | — | No; client re-POSTs the same key | Receipt resolves it |
| Unique violation | 23505 | `UniqueConstraintViolation` with `constraint.index` or `fields` | No; classify (§2.2) | Pending-field index → `PENDING_CONFLICT`; receipt/correlation key → replay lookup; anything else → internal error |
| Transaction timeout / start failure | — | Prisma `P2028`-class | Not covered by v1.2 | **Gap**: needs a mapping and a retry rule |

### Is retrying with the same key safe? **[ADV] Yes, under five conditions**

1. All effects of an attempt are inside the database transaction (no network calls, no files). Rollback therefore erases the attempt, including its receipt and audit rows.
2. Each attempt starts with the same-key advisory lock and the receipt lookup, so a retry after a *committed* but unacknowledged attempt becomes a replay.
3. Authorization is re-derived each attempt. **[VRF]** `SessionGuard` authenticates once per HTTP request, *before* the service call; a retry inside the service would otherwise reuse that stale result. The service must re-read the actor's membership, user and organization status in the retried transaction.
4. The immutable stored snapshot is compared against freshly read facts each attempt; age/eligibility and the decision instant are re-sampled each attempt (Decision 3 pending; not decided here).
5. Only an allow-list of SQLSTATE values (read from `originalCode`) triggers a retry. The scheduler's `isTransientError` additionally matches message text; **[ADV]** the correction path should not retry on message regexes, and must never retry validation, authorization or domain-conflict errors.

## 5.4 Proposed outcome table

★ = code or behaviour **not** defined in v1.2 §9 and proposed here for owner/spec decision.

| Condition | Source / proposal state | HTTP | Error code | Retry permitted? | Notes |
|---|---|---|---|---|---|
| Same-field PENDING conflict (submit, different key) | No row, audit or receipt; existing PENDING unchanged | 409 | `PENDING_CONFLICT` | Same key may be re-POSTed (nothing was stored) but conflicts until the holder is terminal | Reached only after same-key receipt check; no SQL/index names, values or other actors in the body |
| Dependency snapshot changed (approve) | Proposal → `STALE` **committed**; source unchanged | 409 | `STALE_SOURCE` | No: terminal. Same key replays the same 409. New proposal and new key required | The commit precedes the response |
| Domain validation conflict (approve, snapshot intact) | `PENDING`; nothing written | 409 | `LIFECYCLE_CONFLICT` | Yes after the condition changes; same key allowed (no receipt) | Never converts to STALE or REJECTED |
| Finance cannot classify or apply | `PENDING` | 409 | `FINANCE_CONFLICT` | As above | "Recalculation required" on invoice issue has no code ★ |
| Evidence: reviewer rejects | `REJECTED` (a normal 200 decision, not an error) | 200 | — | n/a | Better evidence needs a new linked proposal |
| Evidence: mandatory evidence missing at submission | No row | 400 | `INVALID_EVIDENCE` | Yes, with evidence | |
| Evidence / exceptional authority unmet at approval time (age crossed the normal limit) | `PENDING` | ★ | ★ no code in v1.2 | n/a | Belongs to Decisions 3/4; flagged, not decided |
| Idempotency-Key payload / action / proposal mismatch | Unchanged | 409 | `IDEMPOTENCY_CONFLICT` | No: use a new key | |
| Exact submission replay | Original proposal | 201 | original body | n/a | No new rows or audits |
| Exact approval replay | `APPLIED` | 200 | original body | n/a | Role/session re-checked first |
| Exact committed STALE replay | `STALE` | 409 | `STALE_SOURCE` | No | Same status as the first response; clients must read `code` |
| Deadlock after ≤ 2 internal retries | Rolled back; prior state | 409 | `RETRY_REQUIRED` | Yes, same key, with backoff | Zero deadlocks required in acceptance tests |
| Serialization failure after ≤ 2 retries | Rolled back | 409 | `RETRY_REQUIRED` | Yes | Defensive at READ COMMITTED |
| Lock timeout | Rolled back | 409 | `RETRY_REQUIRED` | Yes, manual, same key | Not auto-retried |
| Prisma transaction timeout / start failure (P2028) ★ | Rolled back, or unknown if during commit | 409 ★ (or 503) | `RETRY_REQUIRED` ★ | Yes, same key | Absent from v1.2 |
| Unknown commit outcome | Unknown | none / 5xx | — | **Must** re-POST with the same key | Receipt resolves it |
| Cross-tenant or unknown target / proposal | None | 404 | `NOT_FOUND` | No | Same body shape for both; resolved before any receipt lookup |
| Revoked or inactive reviewer | `PENDING` | 401 `UNAUTHENTICATED` if the session is invalid at the guard; 403 `INSUFFICIENT_ROLE` if the in-transaction recheck fails | as shown | No | Recheck after each retry |
| Self-review | `PENDING` | 403 | `SELF_REVIEW` | No | Evaluated before staleness |
| Already-terminal proposal, different key or action | Unchanged | 409 | `INVALID_STATE` | No | Differs from exact replay, which returns the original result |
| Unknown / forged body keys | None | 400 | `UNKNOWN_FIELD` | Yes, corrected | |

### When to use each of the four conflict codes (precise rule) **[ADV]**

* **`PENDING_CONFLICT`** — *submission only*: another PENDING proposal already holds the same organization/target/field slot and the command key differs. Never at approval.
* **`STALE_SOURCE`** (+ terminal `STALE`) — *approval only*, after authentication, role, self-review and terminal-state checks pass: a captured dependency changed. Never from reject, withdraw or submission.
* **`LIFECYCLE_CONFLICT`** — an invariant is violated although no captured dependency changed (range/absence facts, chronology, overlap, bed availability). At submission: no proposal is created. At approval: the proposal stays PENDING.
* **`RETRY_REQUIRED`** — infrastructure contention only (lock timeout, retries exhausted, transaction timeout). No domain judgement was made and no proposal state changed.

HTTP 409 is used for all four, so clients must branch on `code`. Whether `RETRY_REQUIRED` should instead be 503/429 with `Retry-After` is a contract choice v1.2 made in favour of 409; this review does not change it.

---

# 6. Combined transaction and failure scenarios

Analysed against the **v1.2 architecture**; differences under the §3.1 scoped-exclusive recommendation are noted where they matter. Shorthand — **K** command-key advisory lock; **P** proposal row `FOR UPDATE`; **G(S)/G(X)** shared/exclusive organization gate; **N** invoice-numbering advisory lock; **Rows** ordered source row locks. v1.2's order: K → P → G → N → Rows. **None of these races has been tested; no PostgreSQL behaviour is claimed.** Where v1.2 does not provide enough detail the result is marked **UNRESOLVED**. "Audit" counts new `AuditEvent` rows from the competing commands; domain audits (e.g. a Resident name event) are listed only where one exists today [VRF].

**1. Two same-field proposals, different keys.** *Txs:* S1(K1), S2(K2) on `Resident.firstName`. *Order:* K1, K2 (different keys, no contention) → insert. *Constraint:* `…_pending_resident_field_uq`. *Winner:* the first insert; the second is expected to wait for the first transaction's outcome and then fail 23505 if it committed, or proceed if it rolled back [UNV]. *Durable:* one PENDING proposal, source unchanged. *Audit:* 1 `correction.submitted`. *Receipt:* 1 (winner); loser stores nothing. *HTTP:* 201 / 409 `PENDING_CONFLICT`. *Retry:* loser may re-POST; it conflicts until the holder is terminal. *Unresolved:* none beyond constraint-name surfacing (§2.2).

**2. Two different-field proposals, one Resident.** *Txs:* S1(`firstName`), S2(`lastName`). *Order:* K → insert; different index entries; no gate for names. *Durable:* two PENDING proposals. *Audit:* 2 submitted. *Receipts:* 2. *HTTP:* 201, 201. *Retry:* none needed. *Unresolved:* whether submission reads the Resident under a lock (not specified); a single-row consistent read suffices.

**3. Two independent name proposals approved concurrently.** *Txs:* A1 (approve `firstName` P1, reviewer X), A2 (approve `lastName` P2, reviewer Y). *Order:* K → own P → Resident row (no gate). *Winner:* first to lock the Resident; the other waits (≤ 5 s) then re-reads. *Result:* own-field snapshots both intact → both APPLIED, each with a column-specific update, so each preserves the other's column [UNV on PostgreSQL]. *Audit:* 2 `correction.applied`; **no domain audit exists for resident edits today [VRF]** — UNRESOLVED which domain event accompanies a name application. *Receipts:* 2. *HTTP:* 200, 200 (or 409 `RETRY_REQUIRED` for a lock-timeout loser, retry allowed). *Hazard:* a full-row write-back or an `updatedAt` comparison would wrongly overwrite or stale the second.

**4. Booking correction vs new booking creation (same bed).** *Txs:* C (correct B1 dates) vs N (create B2). *Order:* C: K → P → G(X) → Bed → Resident → Booking. N: G(S) → Bed → insert. *Constraint:* the existing Bed lock plus overlap check already serialize both on that bed, so the gate is redundant here. *C first:* N waits (and, with default 2 s/5 s options and a long C, may fail with a transaction timeout [VRF]); N's overlap check sees the corrected range. *N first:* C re-reads and finds a new overlapping booking — a range fact: `LIFECYCLE_CONFLICT`, proposal stays PENDING (ADV) or `STALE` (literal v1.2) — **UNRESOLVED**. *Durable:* never two live overlapping bookings. *Audit:* C: 1 applied (+ the booking domain event); N: 1 `booking.created`. *Receipt:* C 1 on commit, none on conflict. *HTTP:* C 200 / 409; N 201 / 409. *Retry:* N yes; C per outcome.

**5. Booking correction vs admission creation.** *Txs:* C vs A (create admission on the same booking). *Order:* C as above. A (v1.2): G(S) → Booking `FOR UPDATE` → insert. *Today [VRF]:* A reads the booking before its transaction and takes no lock, so it can insert an admission outside a just-corrected period; this is closed only if A is moved inside the lock. *C first:* A re-validates the date against the corrected booking → 400. *A first:* C sees a new admission (captured as absent) → `STALE`. *Deadlock:* C1 if A locks Booking before Bed/Resident. *Durable:* no admission outside its booking period. *Audit:* A 1 created; C 1 (applied or stale). *HTTP:* A 201/400; C 200 / 409 `STALE_SOURCE`. *Retry:* stale → new proposal.

**6. Admission update vs check-in.** *Txs:* U (cancel/reopen) vs CI (create check-in). *Order:* CI: Bed → Resident → Booking → Admission. U: Admission. *Constraint:* Admission row lock; `UNIQUE(admission_id)` on check-ins. *CI first:* U waits at the Admission lock, then sees the check-in → 409. *U first:* CI waits, re-reads status, is refused. Existing behaviour [VRF], not tested here. *Gap:* the non-status admission-date update has no transaction or lock and is not serialized with CI today; after P4-2 it is reachable only as a correction (G(X) excludes CI; check-in presence then makes it `STALE` as in race 7). *Audit:* CI 1 `checkin.created`; U 1 `admission.cancelled`. *HTTP:* 201/409. *Retry:* after the other finishes.

**7. Check-in timestamp correction vs checkout.** *Txs:* C vs O (checkout). *Order:* C: K → P → G(X) → Bed → Resident → Booking → Admission → CheckIn. O: G(S) → CheckIn. *C first:* O waits at the gate, then validates against the corrected `checkInAt`. *O first:* C re-reads; a CheckOut now exists and status is CHECKED_OUT → `STALE` (ADV). v1.2's own race row says "revalidates **or** becomes STALE" — **UNRESOLVED**. *Audit:* C 1 (applied or stale); O 1 `checkout.created`. *Receipt:* C 1. *HTTP:* C 200 / 409 `STALE_SOURCE`; O 201 / 400. *Retry:* stale requires a new proposal.

**8. Checkout timestamp correction vs a new stay on the same bed.** *Txs:* C (move `checkOutAt` later) vs CI′ (new check-in on that bed). *Order:* C: G(X) → … → CheckIn → CheckOut. CI′: G(S) → Bed → … *Constraint:* **[VRF]** `assertCanCheckIn` checks only *active* stays on the bed/resident, not completed intervals. *CI′ first:* C re-validates against the new stay → `LIFECYCLE_CONFLICT` (ADV) or `STALE` (literal) — UNRESOLVED. *C first:* CI′ can still record a check-in time inside the corrected interval because ordinary creation does not check completed intervals — **UNRESOLVED invariant gap** (§2.4). *Audit:* 1–2. *HTTP:* 200/409. *Retry:* per outcome.

**9. Correction vs `createDraft`.** *Today [VRF]:* `createDraft` reads booking and stays before its transaction, so it can commit an amount from pre-correction facts that nothing detects. *v1.2:* D: G(S) → N → chain → insert; C: G(X). *D first:* draft created from old facts; C then recalculates or voids it inside its own transaction (a draft helper that **does not exist** [VRF]). *C first:* D reads corrected facts. Either order ends consistent only if D's reads are inside the gated transaction. *Audit:* D 1 `finance.invoice.created`; C 1 applied (+ 1 void if the draft is invalidated). *Receipt:* C 1. *HTTP:* D 201; C 200 / 409 `FINANCE_CONFLICT`. *Unresolved:* classification of "genuinely unissued", helper behaviour.

**10. Correction vs monthly generation (API or scheduler).** *Txs:* M (`generateMonthly`, scheduler `issue: true`) vs C. *Order:* M: G(S) → N → chain → plan → insert/issue. C: G(X). *M first:* invoices ISSUED from pre-correction facts; C then finds issued invoices → REVIEW_REQUIRED links, no change to issued records. *C first:* M reads corrected facts and may create **and issue** an invoice for a newly billable stay with no OWNER review (§3.5). *Contention:* a long M delays C up to `lock_timeout` → `RETRY_REQUIRED`; queue effect C5. *Audit:* M `finance.invoices.generated` 1 + `finance.invoice.issued` per invoice; C 1 (+ link events). *HTTP:* M 200; C 200 / 409. *Retry:* C yes. *UNRESOLVED:* scheduler suppression rule.

**11. Correction vs issue.** *Txs:* I (`issue`) vs C. *Order:* I (v1.2): G(S) → chain → Invoice → validate. C: G(X) → … → Invoice. *I first:* invoice ISSUED; C records REVIEW_REQUIRED; issued facts untouched. *C first:* the draft is recalculated or voided; I then fails (`CANCELLED`, or "recalculation required"). *Today [VRF]:* `issue` has no source check. *Audit:* I 1 `finance.invoice.issued`; C 1 (+ void). *HTTP:* I 200 / 409; C 200. *UNRESOLVED:* no error code for "recalculation required".

**12. Correction vs payment / reversal / credit / void.** *Txs:* P (settlement) vs C. *Order:* P: idempotency advisory → Invoice (payment insert then needs key-share on Resident). C: … Resident `FOR UPDATE` → Invoice. *Possible cycle C2:* each side holds what the other needs; PostgreSQL would abort one with 40P01. **[VRF]** The standalone Finance methods have no deadlock translation, so a payment user could receive an unmapped error [UNV]; the correction side retries ≤ 2. *If not deadlocked:* serialization on the Invoice; C classifies under the locked balance. *Audit:* P 1 `finance.payment.recorded`; C 1 (+ links). *Receipt:* payment-idempotency row 1; correction receipt 1. *HTTP:* P 200/201; C 200 / 409. *Retry:* yes, same key.

**13. Approval vs rejection of the same proposal.** *Txs:* A (reviewer X) vs R (reviewer Y). *Order:* K → P. Both lock the proposal row; the loser re-reads a terminal status. *A wins:* source corrected, APPLIED; R → 409 `INVALID_STATE` (different key/action/actor, so not a replay). *R wins:* REJECTED, source unchanged; A → 409 `INVALID_STATE`. *Audit:* winner's events only. *Receipt:* winner 1. *HTTP:* 200 / 409. *Retry:* no. Note A may hold P while waiting on G(X); R then waits on P up to 5 s → `RETRY_REQUIRED`. Order K → P → G is consistent, so this is a wait, not a deadlock.

**14. Approval vs requester withdrawal.** As 13, with W by the requester (never the approver). W wins → WITHDRAWN (`decided_by = requested_by`), A → `INVALID_STATE`. A wins (APPLIED or STALE) → W → `INVALID_STATE`. *Edge:* a revoked requester cannot withdraw; only rejection frees the slot.

**15. Approval commits but the HTTP response is lost; exact retry.** *Original:* committed — source corrected, APPLIED, audits written, one receipt. *Retry (same actor, key, payload):* K serializes → receipt found → hash matches → session and role re-validated → stored 200 result returned, **no** new mutation, audit or receipt. *If the actor was demoted meanwhile:* 403/401 although the command committed; the authorized detail GET shows the state. *If the first attempt is still running:* the retry waits on K up to `lock_timeout` → then replay or `RETRY_REQUIRED`. *If the first attempt actually rolled back:* no receipt exists, so the retry executes as a fresh command. *Audit:* unchanged. *Receipt:* exactly 1. *Retry allowed:* yes, required. *Depends on* receipt and effect sharing one transaction [UNV].

**Races marked UNRESOLVED by v1.2's detail:** 3 (domain event for name application), 4/7/8 (STALE vs conflict rule), 8 (completed-interval invariant on creation), 9/11 (draft helper, conflict code), 10 (scheduler interplay), 12 (deadlock translation on standalone Finance paths).

---

# 7. Owner recommendations (advisory — nothing here is approved)

## Decision 5 — Pending proposal granularity

**Recommended choice: AMEND** (retain v1.2's model B; tighten how it is specified).

**Exact recommended policy [ADV]:**

1. One PENDING proposal per organization + target + field; one scalar field per proposal; five partial unique indexes as defined in v1.2 §8, subject to §2.2's conditions; no merge, rebase or grouped application.
2. Stale detection compares **named captured facts**, never bare `updatedAt`: the §2.3 tables become part of the specification (capture / re-read / must-not-stale / must-stale per group).
3. Identified rows (target, parent identity/status, a booking's single admission/check-in/checkout, the invoice slots shown to the approver) → mismatch is `STALE`. Range/absence facts (other bookings or stays on the bed, resident overlap) are validators → `LIFECYCLE_CONFLICT`, proposal stays PENDING.
4. A change to the financial consequence shown to the approver is `STALE_SOURCE`; booking `paymentStatus`/`notes`, admission `notes`/location and check-in/out `notes` never stale a proposal (except the legacy check-in fallback, §2.3).
5. Resident `status`: **owner to choose** either "name corrections are allowed on ARCHIVED residents and status is not a stale dependency" (advisory preference) or "archived residents are not correctable"; not left silent.
6. Authorization, self-review and terminal checks run before the snapshot comparison.
7. Application writes only the target column; sub-millisecond values are captured and applied via raw text/SQL, or the specification states millisecond precision for applied values.
8. The specification lists the unsupported final states (§2.4) and the manual fallback; the UI states the required order and the resubmission cost. Grouped correction is out of scope until separately designed and authorized.

**Reasoning:** B is the smallest model that keeps independent fixes independent and puts the conflict rule in the database (uniqueness) and the dependency rule in the transaction. **Trade-offs:** resubmission and repeat reviews for interdependent booking/admission/check-in repairs; some end states unreachable; false stales from the conservative price↔date and `checkOutAt`↔`reason` couplings. **Specification amendments:** replace the §8 "critical point 2" and §12 "Dependency snapshots" prose with the tables and the rules above; add the unsupported-state list. **Implementation dependencies:** Decision 1 (fields), 6 (snapshots under locks), 7 (CheckOut target), 16 (STALE/replay); slices P4-2.1 (indexes/CHECKs), P4-2.2 (submission), P4-2.3 (apply).

## Decision 6 — Locking strategy

**Recommended choice: AMEND** (a simpler protocol than the hybrid; the hybrid remains acceptable only with H1–H8).

**Exact recommended policy [ADV] — suggested replacement for v1.2 §12 "Proposed hybrid":**

> One transaction-scoped advisory key per organization, derived by a single shared helper used by every module. Every transaction that (a) writes a Booking, Admission, CheckIn or CheckOut, (b) creates a draft, issues an invoice or runs monthly generation (including the scheduler and the controller entry), or (c) submits or applies a Booking, Admission, CheckIn or CheckOut correction acquires that key **exclusively**, exactly once, immediately after the command-key and proposal-row locks and before any numbering or source-row lock, with a transaction-local `lock_timeout`. Existing Bed → Resident → Booking → Admission → CheckIn → CheckOut → Invoice row locks are retained. Standalone settlement operations (payment, reversal, credit, void), reads, resident-profile edits, resident and enquiry creation, and Resident-name and checkout-`reason` corrections do not acquire the key. A transaction that holds the key and a Resident row lock must not then lock an Invoice. Every authoritative source read that feeds a write or an amount occurs after the key is held and inside the same transaction. Correction handlers use only the caller's transaction client. Shared mode is not used in the first release.

Suggested parameters: ordinary gate acquirers `lock_timeout` 3 s; correction `lock_timeout` 5 s per acquisition with remaining-budget logic; correction Prisma `maxWait` 10 s, `timeout` 30 s; explicit transaction options on Booking/Admission/Resident writers; acceptance criteria A1–A10 (§3.6).

**Reasoning:** removes the shared-reader problem and the derived cycle class without a new Finance row-lock protocol, with the same integration surface. **Trade-offs:** org-wide serialization of covered operations (ordinary-vs-ordinary concurrency lost); a long monthly generation holds the key for its duration (mitigate by batching); proportionality at ~100 beds is **unmeasured**. **Specification amendments:** the paragraph above; delete or mark optional the Finance source-chain rule; add C1–C3 handling, the inventory-writer decision, the scheduler auto-issue rule, and the nested-call rule. **Implementation dependencies:** Decisions 5 (snapshots), 8–10 (Finance behaviour), 16 (timeouts/retry); joint P4-2.3 + P4-2.4 review; authorized disposable PostgreSQL evidence (P4-2.6).

**If the owner instead ACCEPTS the hybrid:** adopt it only together with H1–H8 (§3.1) and treat C1/C2/C5 as blocking review items.

## Decision 7 — CheckOut tenant-safe reference

**Recommended choice: ACCEPT** (Option A) with four clarifications.

**Exact recommended policy [ADV]:** keep `CheckOut.organizationId`; add only `UNIQUE(id, organization_id)` on `check_outs` (Prisma `@@unique([id, organizationId])`, conventional name `check_outs_id_organization_id_key`); reference it by the direct composite FK `(check_out_target_id, organization_id)` with `RESTRICT`/`RESTRICT`; no new column, primary key or trigger.

**Reasoning:** the only option that gives the same declarative guarantee as the other four targets while keeping the audit/history identity (`check_out.id`). **Trade-offs:** one redundant unique index; a write-blocking index build on a small table whose behaviour inside a Prisma migration (and `CONCURRENTLY` availability) must be confirmed. **Specification amendments:** (1) state the audit `targetType` string mapping (`check_out` ↔ `CHECK_OUT`); (2) either add replacement `Payment` links to `CorrectionFinanceLink` or state they are out of link scope; (3) state how same-resident/same-booking equality of a linked invoice is enforced (denormalized column + composite FK, or reviewed trigger) since a bare id FK cannot; (4) record that the tracked generated client and CI migration manifests are in P4-2.1's reviewed scope. **Dependencies:** Decisions 1, 5, 6, 8, 10; slice P4-2.1.

## Decision 16 — Retry and status contracts

**Recommended choice: AMEND** (keep the contract; fix the gaps below).

**Exact recommended policy [ADV]:**

* Terminal `STALE`; exact replay with exact original status (201 / 200 / 409); `IDEMPOTENCY_CONFLICT` for any hash/action/proposal/tenant mismatch; `PENDING_CONFLICT` only for different-key same-field submission; `INVALID_STATE` for any non-replay command on a terminal proposal.
* Isolation: **READ COMMITTED with locks**, stated explicitly; `40001` handling is defensive.
* Timeouts: transaction-local `lock_timeout` 5 s per acquisition bounded by remaining budget; Prisma `maxWait` 10 s; `timeout` 30 s; total command deadline across attempts ≤ 45 s, shorter caller limits win; `statement_timeout` optional as a backstop.
* Retries: at most 2 whole-transaction retries, only for SQLSTATE 40P01 and 40001 read from `originalCode`; same key; bounded jitter; re-derive authorization, snapshot comparison and the decision instant on every attempt. Lock timeout, Prisma transaction timeout/start failure, and connection loss → `RETRY_REQUIRED` (or re-POST for unknown outcome), never auto-retried.
* STALE is returned by value from the transaction callback, committed, then raised as 409.
* Receipts: keyed or comparison-based request check (no plain hash of low-entropy values), append-only trigger, replay checks path id and action against stored values, tenant-scoped target resolution (404) before receipt lookup; the `Idempotency-Key` header is the single source of `correlationId`.
* Error table §5.4 including the starred additions (P2028 mapping, exceptional-authority-unmet code, "recalculation required" mapping).
* Decision 10 SLA / `dueAt` and Decision 3 correction age remain separate from all of the above.

**Reasoning:** the contract prevents double application on retry and makes terminal outcomes explicit; the amendments close places where today's Prisma/adapter behaviour would make it fail or mis-classify. **Trade-offs:** more code in a retry wrapper; `RETRY_REQUIRED` shares HTTP 409 with domain conflicts; keyed hashing adds a secret. **Specification amendments:** the list above, applied to v1.2 §7, §8 (receipt), §9 and §12. **Dependencies:** Decision 5 (stale/conflict boundary), 6 (locks and timeouts), 8–11 (atomic effects), 14 (receipt retention), 3 (decision-time sampling, still pending); slices P4-2.2, P4-2.3, P4-2.6.

---

# 8. Implementation and acceptance inventory (read-only; no code or SQL written)

| Item | Existing source behaviour verified | Proposed future change | Required independent review | Required PostgreSQL acceptance evidence |
|---|---|---|---|---|
| Prisma typed-target model | No `CorrectionProposal`; composite optional relation precedent (`Payment.corrects`); generated client tracked in Git | New model, five optional composite relations, backrelations, named relations, enums | P4-2.1 schema review; generated-client diff review | Migration applies cleanly; Prisma client matches DB; relation validity |
| Partial unique indexes and CHECKs | Invoice partial unique indexes exist SQL-only; no correction constraints | Five indexes; exactly-one-target, type, field and terminal-shape CHECKs; transition and immutability triggers | Schema review of every predicate, enum label and NULL case | Catalog inspection; reject two-/zero-/wrong-type/wrong-field/NULL rows; slot reuse after commit; rollback keeps slot; constraint-name surfacing |
| CheckOut composite unique + FK | `[checkInId, organizationId]` only | Add `[id, organizationId]`; direct FK | Migration review (index build lock) | Cross-tenant insert rejected; no existing-data failure |
| Finance link keys | Invoice key exists; adjustment/void/reversal lack 3-column keys; `Payment` has it | Add three keys; link FKs; affected-resident equality; exclusivity CHECK | Finance + schema review | Different invoice/tenant/resident rejected; fail-closed without keys |
| Advisory-lock helper | Two inline `hashtextextended` templates in `finance.service.ts`; no shared helper | One helper for key derivation and S/X acquisition (and the static guard test) | Review of collision and derivation; every call site | `pg_locks` shows expected modes; gate coverage; collision-free in fixture |
| Transaction-scoped lock order | Explicit orders consistent; implicit FK locks not analysed | Single documented order including FK-implied locks | P4-2.3/P4-2.4 joint review | Zero 40P01 over randomized interleavings (C1, C2) |
| Booking/admission/check-in/check-out writers | §3.3 | Gate; move reads inside; Admission transaction fixes; block candidate fields | Per-writer review | Races 4–8 |
| Finance readers/writers | §3.3, §3.5 | Reads inside the gated tx; issue validation; draft helper | Finance review | Races 9–12 |
| Invoice scheduler | `issue: true`, lookback 1, separate process, 3 attempts | Gate via service; auto-issue policy for correction-created gaps | Scheduler + Finance review | Race 10; scheduler overlap |
| Correction proposal / receipt services | None | Submit/decide/withdraw; command-key lock; STALE-by-value; keyed request check | Service review | Replay, mismatch, committed-STALE, uncertain commit |
| Controller idempotency contract | Only payments use `Idempotency-Key` (header allowed by CORS) | New routes, UUID key, strict body, no-store | Controller review | Same-key/different-action, cross-tenant, revoked role |
| Error mapping | Adapter maps 40001/40P01, 23505, 23503; 55P03 unmapped; Finance has no deadlock translation | Allow-list classifier on `originalCode`; add P2028 | Review of mapping | Real error shapes for 40P01, 55P03, 23505 (partial index), P2028 |
| Audit atomicity | Booking/check-in/out audits in tx; admission non-status update and resident writes not | Atomic audits for every touched path; correction events in the same tx | Audit review | Audit failure rolls back source, proposal, receipt |
| Unit / service / controller tests | Existing suites; concurrency "tests" use injected errors | Per §14 matrix | Test review | n/a (mocks cannot prove concurrency) |
| Disposable PostgreSQL concurrency tests | Integration suite guard uses a session advisory lock; no existing lock/gate/timeout tests | 15 races + criteria A1–A10 | Independent execution review | Authorized disposable database required (not granted) |

---

# 9. Readiness assessment

Separate verdicts, as requested; owner approval is not technical readiness.

| Question | Verdict | Basis |
|---|---|---|
| **Conceptually coherent** | **Yes, with amendments.** D5, D7, D16: coherent. D6: coherent in intent; overlooks implicit FK locks, default ordinary timeouts and scheduler auto-issue. | §2–§5 |
| **Relationally implementable** | **Yes, with reviewed SQL.** Prisma can express the optional composite relations (precedent) but not partial indexes, CHECKs or triggers. Open: Finance-link resident/booking equality, replacement-payment link, audit type mapping. | §2.2, §4 |
| **Transactionally implementable** | **Not as written (Decision 6); conditional for 16.** Hybrid needs H1–H8 and cycle resolution; scoped-exclusive is implementable with fewer unknowns. D16 depends on D6, an isolation choice, P2028 handling and Decision 3's pending decision-time rule. | §3, §5 |
| **Correctly testable** | **Not yet.** Testable only on an authorized disposable PostgreSQL; `lock_timeout` coverage of advisory waits, cycle behaviour, constraint-name surfacing and queue effects are unproven; mock tests prove none of it. | §3.6, §8 |
| **Ready for owner policy approval** | **Yes for D5 and D7 (as amended/accepted); D6 and D16: yes as policy directions, but v1.2 §12 should not be approved as the implementation contract in its current wording.** | §7 |
| **Ready for implementation authorization** | **No.** Policy is unapproved; amendments are unreconciled; reconciled specification, schema/transaction reviews and test authorization are pending. | §10 |

**Issues to clarify before P4-2.1 (schema/contract slice):** (1) proposal-side names, enum identifiers and casing, and the audit `targetType` mapping; (2) CheckOut unique naming and the migration lock behaviour; (3) Finance-link keys, replacement-payment link, affected-resident/booking equality enforcement; (4) receipt table: keyed request check, immutability, key format, `correlationId` source; (5) explicit isolation level; (6) proof that the partial-index violation exposes a usable constraint name through Prisma; (7) generated-client and CI-manifest scope; (8) archived-resident rule, STALE `decisionReason` and timestamp semantics, Decision 3's pending decision-time sampling.

**Issues to resolve before financial correction application is enabled (P4-2.3 + P4-2.4):** (1) final lock design with every §3.3 writer integrated, including the `Admission.create/update` transaction and read fixes and `FinanceService.createDraft` reads moved inside; (2) C1/C2/C3 resolved or disproved on PostgreSQL; (3) demonstration that `lock_timeout` bounds gate waits; explicit timeouts for ordinary writers; (4) scheduler/manual-generation interplay with correction-created billing gaps; (5) the draft recalculation/void helper and Finance conflict codes; (6) correction-linked remedy provenance and OWNER gate (Reviews 1/2/15); (7) completed-interval invariant on creation paths; (8) decision on inventory writers; (9) acceptance criteria A1–A10 met on an authorized disposable database.

---

## Scope integrity and verdict

All four primary documents are unchanged. Only this review file was created (drafted in a session scratch directory and copied here). No source, Prisma schema, migration, test, CI or configuration file was modified; no `.env` or credential was read; no database was contacted; no Prisma, migration, seed or application command was run; no Git state changed. Official PostgreSQL documentation was read over HTTP; no runtime guarantee is claimed. Decision 10 SLA / `dueAt` is untouched and separate; Decisions 3, 4 and 12 are preserved. This document authorizes neither P4-2.1 nor any later slice.

DECISIONS 5, 6, 7 AND 16 — READY FOR OWNER REVIEW

---

# 10. Final owner decision form

The advisory choices above are not entered here. All owner fields remain blank.

### Decision 5 — Pending proposal granularity
- Decision: NOT APPROVED
- Owner selection:
- Selected proposal model:
- Dependency conflict policy:
- Grouped correction boundary:
- Amendments:
- Rationale:

### Decision 6 — Locking strategy
- Decision: NOT APPROVED
- Owner selection:
- Selected lock design:
- Lock ordering:
- Finance reader/writer requirements:
- Performance acceptance criteria:
- Amendments:
- Rationale:

### Decision 7 — CheckOut tenant-safe reference
- Decision: NOT APPROVED
- Owner selection:
- Selected relationship design:
- Composite keys/FKs:
- Amendments:
- Rationale:

### Decision 16 — Retry and status contracts
- Decision: NOT APPROVED
- Owner selection:
- Idempotency/replay policy:
- Retry and timeout policy:
- Error/status contracts:
- Amendments:
- Rationale:
