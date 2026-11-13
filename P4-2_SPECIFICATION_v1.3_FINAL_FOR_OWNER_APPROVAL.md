# NOOK — P4-2 Specification v1.3

**Consolidated final proposal for owner approval — implementation NOT AUTHORIZED**

Workspace: `~/Downloads/nook-phase4-1` · Branch: `feature/phase-4-1-lifecycle-audit` · HEAD `908098acd567c299ad05529b5a533ad17622dceb` plus the existing dirty working tree (the compatibility baseline) · Date: 2026-11-08

Companion: [`P4-2_OWNER_DECISION_WORKSHEET.md`](P4-2_OWNER_DECISION_WORKSHEET.md) (aligned to this document; holds the blank owner fields).

## 1. Status and implementation boundary

1. This is the **single consolidated P4-2 specification** for owner approval. It supersedes v1.2 as the current proposal by reconciling v1.2, the owner worksheet and the three decision reviews (`01_02_15`, `03_04_12`, `05_06_07_16`). Those documents and v1.0–v1.2 are **historical inputs and remain unchanged**.
2. **Recommendations are not approvals.** Only section 2 contains owner-approved directions. Every other choice is labelled `RECOMMENDED — NOT APPROVED` and is decided only when the owner records it in the worksheet.
3. **Writing this document authorizes nothing.** P4-2.1 (schema/contracts) is **not authorized**. No migration, Prisma generation, database operation, source change or test run is authorized.
4. **Financial correction application stays disabled** until P4-2.3 and P4-2.4 have had a **joint independent review** and their acceptance evidence exists (section 17).
5. **P4-2.6 acceptance requires an explicitly authorized disposable PostgreSQL database.** None has been authorized.
6. Nothing in P4-2 is implemented, verified or production-ready. Production additionally needs privacy/legal review of indefinite retention.

### Evidence labels used in this document

| Label | Meaning |
|---|---|
| **FROZEN** | Owner-approved direction (section 2). Not reopened. |
| **VERIFIED** | Observed in repository source, schema, migrations or installed dependency code in the working tree. It is not a statement about any deployed database. Statements taken from official PostgreSQL documentation are marked *(PG docs)* and are documented behaviour, not runtime proof. |
| **REQUIRED DESIGN** | A design requirement of this specification that follows from a RECOMMENDED choice; it binds implementation only if the owner approves that choice. |
| **UNPROVEN** | Expected behaviour that no one has run. It is a design assumption and an acceptance test, never a claim. |

**No PostgreSQL behaviour has been proven.** This applies to the concurrency scenarios (section 16.3), the acceptance criteria A1–A10, advisory-lock `lock_timeout` behaviour, lock-queue behaviour, deadlock outcomes, unique-violation constraint-name surfacing, and the Prisma error shapes in section 11.

### Changes from v1.2

* Decision 5: model B retained and tightened (named dependencies, STALE vs `LIFECYCLE_CONFLICT`, archived-resident rule, column-only apply, timestamp precision, unsupported-state list).
* Decision 6: v1.2's shared/exclusive hybrid is **replaced** by a scoped exclusive organization gate; scheduler, manual generation, payment-lock cycle, correction-created billing gaps and inventory writers are specified (section 10).
* Decision 7: Option A confirmed with four clarifications.
* Decision 16: isolation level, timeouts, retry allow-list, P2028/55P03 treatment, receipts, error codes and STALE semantics made exact.
* Decisions 1–4, 8–15: reconciled, not reopened; open sub-choices from the reviews are recorded (section 18).

## 2. Frozen owner directions (approved — not reopened)

1. Explicit correction allowlist only; no arbitrary field paths.
2. Every consequential correction requires approval.
3. Self-approval is prohibited.
4. Financial correction approval is OWNER only (and so is exceptional-history approval).
5. Historical corrections require controlled backdating, a reason and approval.
6. Genuinely unissued billing may be recalculated, only under approved rules.
7. Issued invoices keep their original facts; only separately approved adjustments are possible.
8. Room/bed corrections belong to P4-3.
9. Rejected proposals are retained permanently.
10. Original values and correction history are retained indefinitely, subject to applicable legal/privacy requirements.

Also preserved (existing platform boundaries): phone/email verification changes are outside P4-2; checkout does not silently cancel bookings, rewrite invoices, issue credits/refunds or settle deposits; no fabricated checkout, no automatic extra occupancy billing, no unauthorized reopening; full first-month rent with no proration; separate full invoices for separate bookings in a month; manual overdue review; unresolved GST/tax treatment; no uploads/KYC, settlement/refunds, transfers or public self-service.

## 3. Verified baseline (working tree)

| Area | Verified fact |
|---|---|
| Schema | UUID PKs, `Timestamptz(6)`, `Decimal` money, composite organization-scoped FKs with `RESTRICT`. `Resident`, `Booking`, `Admission`, `CheckIn` each have `UNIQUE(id, organizationId)`. **`CheckOut` has `organizationId`, direct Organization relation, composite relations to CheckIn/Resident/Booking/Bed, `UNIQUE(checkInId)` and `UNIQUE(checkInId, organizationId)`, but no `UNIQUE(id, organizationId)`.** `Invoice` has `UNIQUE(id, organizationId, residentId)`. `Payment` has `UNIQUE(id, organizationId)` and `UNIQUE(id, invoiceId, organizationId)`. `InvoiceAdjustment`/`InvoiceVoid` carry `residentId` with composite FKs to the invoice key but no `(id, invoiceId, organizationId)` unique; `PaymentReversal` has neither `residentId` nor that unique. No integer version columns. |
| Tables | `residents`, `bookings`, `admissions`, `check_ins`, `check_outs`, each with `id` and `organization_id`. |
| Absent | `CorrectionProposal`, its enums, target columns, `correction_proposals`, receipt and Finance-link tables do not exist in the schema, any migration or the generated client. |
| Generated client | `apps/api/src/generated` is **tracked by Git**. CI migration manifests exist under `scripts/ci/`. |
| Locks and transactions | No writer takes any lifecycle gate. Explicit row-lock orders are consistent prefixes of Bed → Resident → Booking → Admission → CheckIn. `Admission.create`, `Admission.update` and `FinanceService.createDraft` write from reads made outside the writing transaction; `Admission.update` (non-status) and `CheckIn.update` (notes) use no transaction. Booking/Admission/Resident transactions use Prisma defaults (`maxWait` 2 s, `timeout` 5 s); CheckIn 10 s/20 s; Finance 10 s/30 s. No `lock_timeout` or isolation level is set in `apps/api/src` (the read-only stay summary uses REPEATABLE READ). |
| Advisory locks | Finance uses `pg_advisory_xact_lock(hashtextextended(<text>, 0))` for `invoice-number:<org>` and `payment-idempotency:<org>:<key>`, inlined in two places; the integration-suite guard uses a session-level advisory lock in the same key space. |
| Finance | `createDraft` reads booking/stays/amount before its transaction. `issue` locks only the Invoice and does no source validation. `generateMonthly` plans inside its transaction but without source locks (READ COMMITTED, several statements) and uses `createMany({ skipDuplicates: true })`. The **scheduler calls `generateMonthly` with `issue: true`, a null actor and a default lookback of the previous and current month**; the manual `generate-monthly` endpoint is open to both operator roles. `recordPayment` locks Invoice after an idempotency advisory lock; its payment insert has a composite FK to `residents`. `FinanceController` allows OWNER and PROPERTY_MANAGER. |
| Errors | `@prisma/adapter-pg` maps SQLSTATE 40001/40P01 to `TransactionWriteConflict`, 23505 to a unique violation (with `constraint.index` when PostgreSQL supplies the name), 23503 to a foreign-key violation; **55P03 and 57014 are not mapped** and surface as a generic driver error carrying `originalCode`. The scheduler's `isTransientError` does not list 55P03 and also matches message text. |
| Creation validators | `assertCanCheckIn` checks status, bed/room state, existing check-in and *active* stays only; it does not compare against completed stays or require `checkInAt ≤ now`. `assertCanCheckOut` requires only `checkOutAt ≥ checkInAt`. |
| Bed/room state | Bed/room `archivedAt` and `operationalStatus` are read only by creation-time rules (`assertBedBookable`, `assertCanCheckIn`) and the availability list. No Finance rule and no v1.2 correction rule reads them. Inventory writers (bed/room/floor/property update and archive) are plain `updateMany` calls with no transaction or locks. |
| Audit | `AuditEvent` has actor, nullable organization, string `targetType` (existing values are lower-case, e.g. `check_out`), `targetId`, `requestId`, `occurredAt`, JSON metadata. Resident create/update write no audit event today. |
| Existing ordinary edits | Resident names, booking dates/price and admission date are writable through ordinary `PUT` routes (including alongside status/archive payloads). Check-in `checkInAt` is refused on update; no existing-record route changes checkout fields. Booking lengthening is refused in `update` and allowed only through `POST /bookings/:id/extend`. |

## 4. Correction allowlist and routine-edit boundary (Decisions 1, 15)

`RECOMMENDED — NOT APPROVED` (Decision 1): exactly these nine fields. Submitters: OWNER and PROPERTY_MANAGER. Classification is server-computed and conservative: all booking financial terms, admission date and physical occupancy timestamps are **financial/OWNER-reviewed** even when a preview shows zero monetary change; names and checkout reason are non-financial unless age makes them exceptional.

| Target / `fieldKey` | API value | Validation | Class |
|---|---|---|---|
| RESIDENT / `firstName`, `lastName` | string | Trim; 1–500 characters; Unicode kept; no null | Non-financial |
| BOOKING / `startDate` | `YYYY-MM-DD` | Strict real date; start < end in IST; atomic bed-overlap check; must cover a live admission's date; no status/assignment change | Financial |
| BOOKING / `endDate` | `YYYY-MM-DD` | Exclusive day > start; **no lengthening** (extension command only); preserve admission coverage and actual occupancy | Financial |
| BOOKING / `monthlyPrice` | decimal string | > 0, ≤ 99999999.99, ≤ 2 fractional digits, canonical 2 decimals; evidence of the original agreement always required; no renegotiation | Financial |
| ADMISSION / `admissionDate` | `YYYY-MM-DD` | Within `[booking.start, booking.end)`; not after a recorded check-in day; booking/resident/bed unchanged | Financial (precaution; Finance rent does not read it) |
| CHECK_IN / `checkInAt` | zoned RFC 3339 | Explicit zone; real instant ≤ now; admission chronology; ≤ checkout if present; interval collision checks | Financial + occupancy |
| CHECK_OUT / `checkOutAt` | zoned RFC 3339 | Existing checkout only; ≥ checkInAt, ≤ now; interval collision checks; status stays CHECKED_OUT | Financial + occupancy |
| CHECK_OUT / `reason` | string or null | Trim; 1–500 characters or explicit null | Non-financial |

* No-op replacements are 400. Validate at submission and again at approval. One field per proposal; no implicit sibling updates.
* Envelope: correction reason 1–2000 characters; `effectiveAt` zoned and ≤ now; evidence per section 6.
* Dates use the UTC-midnight date representation of the existing parser; physical instants render in Asia/Kolkata; calendar round-trip validation rejects overflow dates.
* Excluded: phone/email; organization/membership/role; property/room/bed and assignments; every workflow/payment/invoice status; payments, invoices, deposits/refunds; credentials; documents/verification; arbitrary JSON paths; resident notes (no such field exists).
* **Routine-edit boundary (Decision 15, `RECOMMENDED — NOT APPROVED`, AMEND):** the nine fields are consequential once their record exists. Ordinary `PUT`/`DELETE` routes must **reject the whole request, before any branch runs**, if it carries one of them (including inside cancel/approve/reopen/archive payloads); the web edit form must stop sending unchanged names. Creation, validated status transitions, check-in/checkout, and the existing booking extension remain ordinary domain commands under their existing roles. Address, emergency contact, booking/admission/check-in notes and other non-allowlisted profile edits keep their current permissions. Admission `propertyId`/`roomId` metadata editing is not a transfer mechanism and is not approved here. Check-in notes on a legacy `CHECKED_OUT` row with no `CheckOut` are **refused** (409), because notes move `updatedAt`, which billing uses as that row's end. Commercial rent renegotiation needs a separate rental-term workflow.
* **Invoice name display (open choice inside Decision 1):** invoices and receipts render the *current* resident name; no issued-name snapshot exists. `RECOMMENDED — NOT APPROVED`: keep current-profile rendering, label it, and add no snapshot in P4-2.

## 5. Authorization and separation of duties (Decisions 2, 12)

`RECOMMENDED — NOT APPROVED`, except self-approval prohibition and OWNER-only financial approval (FROZEN).

| Action | OWNER | PROPERTY_MANAGER |
|---|---|---|
| Submit; view queue/detail/history | Yes | Yes |
| Approve/reject normal non-financial correction | Yes, independent | Yes, independent |
| Approve/reject financial correction | Yes, independent | No |
| Approve/reject exceptional-history correction | Yes, independent | No |
| Withdraw own PENDING proposal | Yes | Yes |
| Approve/reject own proposal | No | No |
| Withdraw another person's proposal | No | No |

* Independence compares trusted user ids. Membership, user and organization must be ACTIVE at action time and **re-read on every attempt and replay** (the session guard runs once per request and is not sufficient).
* A different PROPERTY_MANAGER may review an OWNER's normal non-financial request. Financial and exceptional requests need a different OWNER, including when an OWNER requested them. A sole OWNER is a valid independent reviewer of a manager's request, never of their own. With no eligible reviewer the proposal stays PENDING; there is no self-approval exception, external reviewer or delegation. A revoked requester's proposal stays reviewable by another eligible actor; the revoked user gains no action rights.
* Existing `RoleGuard` admits both roles and cannot express this matrix; classification and exception checks live in the service.

## 6. Historical lookback and evidence (Decisions 3, 4)

**Normal window `RECOMMENDED — NOT APPROVED` (Decision 3, AMEND = 90 days plus precision wording):**

> At submission and at the final application decision, age is the non-negative difference in IST calendar-day ordinals between the evaluated current date and the earliest candidate day. Candidate days: `effectiveAt`'s IST day; both original and proposed days of a date-valued field; and the category anchor — Resident `createdAt` (names); original booking start (booking dates and price); original admission day; original check-in/check-out event day; original checkout day (`reason`). Age 0–90 inclusive is normal; 91 or more is exceptional. No elapsed-24-hour blocks, server-local dates, business days or discovery time. Null/text/decimal values are ignored only where they are not date facts; a missing or invalid *required* anchor fails validation and is never replaced by `updatedAt` or now. Future `effectiveAt` and future physical instants are prohibited; future booking/admission dates may be corrected now.

**Approval-time sampling — OPEN, owner choice (Decision 3):** the recommended rule is to sample one trusted current instant after all blocking locks and revalidation, immediately before application, and use its IST day for the final age/exception check, persisting that instant, policy version, candidate-day basis and resulting classification; resample after any retry. The alternative is commit-day eligibility. This sampling rule is **Decision 3's** and is independent of Decision 10's SLA and of Decision 16's transaction timeouts.

**Exceptional route `RECOMMENDED — NOT APPROVED` (Decision 4, ACCEPT):** beyond the normal window only a different active same-organization OWNER may approve or reject, with mandatory evidence and an explicit exception rationale; no separate maximum age; no third approver; no entitlement to apply. Age never overrides validity, tenant, chronology or invoice protections.

**Evidence (Decision 4):** mandatory for every historical financial or occupancy correction, every exceptional correction and every `monthlyPrice` correction; optional for normal in-window names and checkout reason (a detailed reason is still required). Evidence is a restricted reference/description, 1–2000 characters — no document bytes, no credential-bearing URL. The reviewer records evidence adequacy in the decision reason. Submitted payloads are immutable: insufficient, contradictory or inaccessible evidence ends in a reasoned rejection and a new linked proposal; inaccessibility is not proof of falsity. If age crossing the window makes evidence or authority insufficient at approval, the approval is refused (`EVIDENCE_REQUIRED` / `INSUFFICIENT_ROLE`, section 11.6) and the proposal stays PENDING.

**Completed stays** remain correctable without reopening a stay or releasing/reassigning a bed. Physical intervals are half-open `[checkInAt, checkOutAt)`; equal boundaries are adjacent; an active stay has an open end; physical checkout beyond the booking end is a valid overstay fact and authorizes no billing. Missing authoritative history fails closed; a checkout is never fabricated from `updatedAt`. The existing Finance rule that includes checkout exactly at month start in a full-month invoice is **not** replaced by physical-overlap arithmetic. Previously billed periods need a Finance comparison of affected slots; issued facts are never changed.

**Creation-path invariant (REQUIRED DESIGN, pending owner approval of Decision 1):** because `assertCanCheckIn`/`assertCanCheckOut` do not check completed-stay intervals, the interval invariant is enforced only at correction time unless the same validator is added to the creation paths. P4-2.3 must either add it or state in the specification that the invariant is correction-time only.

## 7. State machine (Decision 16 — partial; full contract in section 11)

States: `PENDING`, `APPLIED`, `REJECTED`, `WITHDRAWN`, `STALE`. No approved-but-unapplied state.

| Transition | Authority | Durable effect |
|---|---|---|
| none → PENDING | Eligible submitter | Proposal, `correction.submitted` audit, receipt (one transaction) |
| PENDING → APPLIED | Independent eligible reviewer | Source change, domain audit, correction audit, links, receipt, proposal (one transaction) |
| PENDING → REJECTED | Independent eligible reviewer, reason required | Proposal, audit, receipt |
| PENDING → WITHDRAWN | Requester only, reason required | Proposal, audit, receipt |
| PENDING → STALE | An authorized, non-self approval attempt that finds a captured dependency changed | Proposal, `correction.stale` audit and receipt **committed**, then HTTP 409 |
| terminal → any | Forbidden | Exact replay returns the stored result; any other command → `INVALID_STATE` |

Reversal is a **new** PENDING proposal referencing the applied one (same target and field, current value captured, all current rules apply, no blind restore); reversing an end-date shortening by lengthening stays extension-only. Rejected, stale and withdrawn proposals may be superseded by linked new proposals. A proposal that deterministically fails (e.g. `FINANCE_CONFLICT`) stays PENDING until withdrawn or rejected; no expiry status is introduced. Terminal row shapes: PENDING has no decision fields; APPLIED requires a distinct reviewer, `decidedAt`, `appliedAt`, `decisionReason`, `appliedValue`; REJECTED and STALE require a distinct decision actor, `decidedAt`, `decisionReason`; WITHDRAWN requires `decidedBy = requestedBy`, `decidedAt`, reason. Nullable corrected values (checkout reason) use a non-SQL-null typed envelope; SQL null means "not applied".

## 8. Data model and relational constraints (Decisions 5, 7)

Everything in this section is **proposed design** (the tables do not exist). Exact SQL, enum identifiers and Prisma code are P4-2.1 deliverables after authorization; none is written here.

### 8.1 Tables

* `correction_proposals` (`@@map`): id; `organization_id`; `target_type`, `field_key`, `status` (closed enums); five nullable typed target columns `resident_target_id`, `booking_target_id`, `admission_target_id`, `check_in_target_id`, `check_out_target_id`; `original_value`, `proposed_value`, `applied_value` (jsonb scalar envelopes); `expected_snapshot` (protected jsonb, canonical text including microsecond timestamps); `reason`, `evidence_reference`; `effective_at`, `recorded_at`; `requested_by`, `decided_by`; `decided_at`, `applied_at`, `decision_reason`, `exception_rationale`; `financial_impact`; `correlation_id`; `related_proposal_id` + relationship kind (`REVERSAL`/`SUPERSEDES`); `UNIQUE(id, organization_id)`; `UNIQUE(organization_id, requested_by, correlation_id)`.
* `correction_command_receipts`, `correction_finance_links` (sections 11.4 and 13).
* Audit `targetType` mapping: correction enum `CHECK_OUT` ↔ existing audit string `check_out` (likewise `check_in`, `booking`, `admission`, `resident`); the history queries must use the mapping.
* Enum labels: target types `RESIDENT`, `BOOKING`, `ADMISSION`, `CHECK_IN`, `CHECK_OUT`; statuses as section 7; `field_key` labels as the section 4 keys. Casing must be one consistent decision in P4-2.1; SQL literals are case-sensitive.

### 8.2 Typed targets and composite foreign keys

Each target uses a composite FK `(<target>_target_id, organization_id)` → the target table's `(id, organization_id)`, `ON DELETE RESTRICT ON UPDATE RESTRICT`, default MATCH SIMPLE, over one shared `organization_id`. Targets: `residents`, `bookings`, `admissions`, `check_ins` (existing unique keys) and `check_outs` (**needs the new key**, section 8.5). Because MATCH SIMPLE skips a NULL component, the exactly-one-target CHECK is essential. Do not use `SET NULL` on these composite keys.

**Prisma boundary (no concern is hidden by saying Prisma supports it):** Prisma can express the optional composite relations (`Payment.corrects` is a verified precedent), named relations and back-relations on Resident, Booking, Admission, CheckIn, CheckOut and Organization. Prisma **cannot** express, and P4-2.1 must supply as explicit reviewed SQL: the five partial unique indexes; the exactly-one-target, target-type, field-compatibility and terminal row-shape CHECKs; the self-review CHECK; transition and immutability triggers; any Finance-link exclusivity CHECK; jsonb envelope validation; and Finance-link resident/booking equality. How Prisma tooling treats SQL-only partial indexes is unverified (an existing precedent keeps them SQL-only with a schema comment).

### 8.3 The five partial unique indexes

Ordered keys `(organization_id, <target id column>, field_key)`, `UNIQUE`, predicate `status = 'PENDING' AND target_type = '<T>' AND <target id column> IS NOT NULL`:

| Index | Target id column | `<T>` |
|---|---|---|
| `correction_proposals_pending_resident_field_uq` | `resident_target_id` | `RESIDENT` |
| `correction_proposals_pending_booking_field_uq` | `booking_target_id` | `BOOKING` |
| `correction_proposals_pending_admission_field_uq` | `admission_target_id` | `ADMISSION` |
| `correction_proposals_pending_check_in_field_uq` | `check_in_target_id` | `CHECK_IN` |
| `correction_proposals_pending_check_out_field_uq` | `check_out_target_id` | `CHECK_OUT` |

VERIFIED: the target tables and `organization_id`/`id` columns exist as named; all five index names are ≤ 47 characters. PROPOSED: the target-id, `field_key`, `target_type` and `status` columns and enum labels. The `target_type` predicate term is redundant when the CHECKs hold; it is kept for readability and is **not** a security control — the CHECKs are. A committed move out of PENDING frees the slot; a rolled-back move does not; terminal rows never return to PENDING. A known pending-field violation maps to `PENDING_CONFLICT` only after rollback and only when the constraint is identified (never map every unique violation). UNPROVEN until shown on disposable PostgreSQL: waiting/ordering of competing inserts, slot release on commit, and whether the partial-index violation exposes a usable constraint name through Prisma.

### 8.4 Row constraints

`organization_id`, `target_type`, `field_key`, `status` NOT NULL; `num_nonnulls(5 target ids) = 1`; non-null id matches `target_type`; `field_key` permitted only for its target (RESIDENT: firstName, lastName; BOOKING: startDate, endDate, monthlyPrice; ADMISSION: admissionDate; CHECK_IN: checkInAt; CHECK_OUT: checkOutAt, reason); CHECKs must reject NULL/invalid combinations explicitly (a CHECK evaluating to UNKNOWN passes). Terminal-shape CHECKs per section 7; a trigger permits only PENDING → terminal and denies payload rewrites, terminal-to-any updates and deletes. No tamper-proof storage is claimed.

### 8.5 CheckOut reference (Decision 7)

`RECOMMENDED — NOT APPROVED` (**ACCEPT, Option A**): keep `CheckOut.id` as the target identity and keep the existing `CheckOut.organizationId`; add only `UNIQUE(id, organization_id)` (conventional name `check_outs_id_organization_id_key`); add the direct composite FK `(check_out_target_id, organization_id)` → `check_outs(id, organization_id)` with RESTRICT/RESTRICT. Do **not** add a tenant column, a new primary key or replace the identity with `checkInId`. Rejected alternatives: derive the tenant only via CheckIn (needs a trigger, no declarative FK) and use `(checkInId, organizationId)` as identity (changes the id domain; breaks the audit/history id which is `check_out.id`). Cost: one redundant unique index; a write-blocking index build on `check_outs` whose behaviour inside a Prisma migration (and `CONCURRENTLY` availability) must be confirmed. Four clarifications are part of this recommendation: (1) the audit `targetType` mapping above; (2) replacement-`Payment` links are handled explicitly (section 13.4); (3) invoice-to-proposal resident/booking equality is enforced (section 13.4); (4) the tracked generated client and the CI migration manifests are inside P4-2.1's reviewed scope.

### 8.6 Proposal-side reuse

Reuse `AuditEvent`; no entity-version table, event store or general mutation engine.

## 9. Pending-proposal granularity and dependency snapshots (Decision 5)

`RECOMMENDED — NOT APPROVED`: **AMEND — retain Model B.**

### 9.1 Policy

1. One PENDING proposal per organization + target + field, enforced by the five indexes of section 8.3; one scalar field per proposal; no merge, rebase or grouped application. Alternative A (one per record) blocks independent fixes; alternative C (grouped atomic application) needs group identity, shared snapshots and all-or-nothing semantics that are **not designed or authorized** and are out of this release.
2. Staleness compares **named captured facts**, never a bare `updatedAt`. `updatedAt` is retained for diagnostics only: it is too broad (bumped by notes, profile edits, the resident archive lock write) and too narrow (child rows do not bump the parent).
3. A change to an **identified** dependency (target scalars; parent identity/status; a booking's single admission/check-in/checkout; the invoice slots shown to the approver) produces terminal `STALE` / `STALE_SOURCE`.
4. **Range/absence and invariant facts** (other bookings or stays on the bed, resident-level overlap, chronology, bed availability) are re-evaluated as validators: a violation returns `LIFECYCLE_CONFLICT` and the proposal **stays PENDING**.
5. If the financial consequence the reviewer was shown (draft amounts, drafts to be voided, affected issued invoices) differs from the consequence recomputed under the locks, the result is `STALE_SOURCE`; an unseen financial consequence is never applied.
6. Order of evaluation at approval: authentication → active role and tenant → self-review → terminal-state → age/evidence authority → snapshot comparison (`STALE`) → validators (`LIFECYCLE_CONFLICT`) → Finance (`FINANCE_CONFLICT`). An unentitled caller can never commit a STALE.
7. Application writes **only the target column**; no full-row write-back of a re-read row.
8. **Timestamp precision:** Prisma `Date` values are millisecond-resolution while columns are `Timestamptz(6)`. Snapshots capture timestamps as canonical text read with a raw query; applying a value with sub-millisecond digits requires a raw SQL write. If the owner prefers, the specification may instead state that applied values have millisecond precision. P4-2.1 must choose one; silence is not allowed.
9. Staleness is detected only on an authorized approval attempt; a stale proposal looks PENDING and holds its slot until then. Read endpoints never mutate; an optional non-authoritative "may be stale" hint may be shown.

### 9.2 Dependency groups

| Group | Captured at submission | Must **not** stale | Stales |
|---|---|---|---|
| Resident `firstName` / `lastName` | tenant, id, the field's own exact text, `createdAt` (age anchor) | the other name, phone, email, address, emergency contact, document fields, any `updatedAt` bump, **resident status**, bookings/stays/invoices | the field's own value changed |
| Booking `startDate` / `endDate` / `monthlyPrice` (one shared group) | booking id/status/bed/resident; the three scalars; admission presence/id/status/date; check-in presence/id/status/`checkInAt`; checkout presence/`checkOutAt`; invoice slots shown to the approver | booking notes; `paymentStatus`; admission notes/location; check-in/out notes; other beds; resident profile edits | any of the three scalars changed (other correction or the extension command); admission created/cancelled/date changed; check-in or checkout created; a shown invoice slot created/issued/voided/re-amounted |
| Admission `admissionDate` | admission id/status/date; booking id/status/start/end; check-in presence/`checkInAt` | admission notes/location; booking price/`paymentStatus` | admission date or cancellation; booking dates/status; check-in created |
| CheckIn `checkInAt` | check-in id/status/`checkInAt`; admission id/status/date; checkout presence/`checkOutAt` | check-in notes (except the legacy no-checkout row, which section 4 refuses) | its own value; checkout created (status ACTIVE → CHECKED_OUT); admission date changed |
| CheckOut `checkOutAt` | checkout id/value/`reason`; check-in id/status/`checkInAt` | checkout notes; resident profile edits | its own value; `checkInAt` changed |
| CheckOut `reason` | checkout `reason`, `checkOutAt`, check-in id/status | resident profile edits; checkout notes | its own value; `checkOutAt` changed (conservative: the reviewer saw the departure context; age is recomputed regardless) |

The price↔date coupling is kept because of the preview basis (9.1 item 5); both couplings cost resubmission, re-entered evidence and a second independent review, and that cost is accepted.

### 9.3 Archived residents (resolved as a recommendation)

`RECOMMENDED — NOT APPROVED`: name corrections **remain possible for ARCHIVED residents**, and resident `status` is **not** a stale dependency for `firstName`/`lastName` proposals. Archiving a resident therefore never stales pending name proposals. The alternative ("archived records are not correctable") is a valid owner choice but must be recorded explicitly.

### 9.4 Expected outcomes (design expectations, untested)

| Scenario | Outcome |
|---|---|
| Two independent name proposals | Both APPLIED in either order |
| Two proposals, same name field | Second submission: 409 `PENDING_CONFLICT`, nothing stored |
| Booking `startDate` + `monthlyPrice` | First APPLIED; second `STALE` (shared group) |
| Booking date proposal + new admission | `STALE` (admission presence was captured) |
| Check-in timestamp + checkout | `STALE` (reviewer saw an ACTIVE stay) |
| Checkout timestamp + new stay on the same bed | `LIFECYCLE_CONFLICT` if the proposed interval overlaps; otherwise APPLIED; proposal stays PENDING on conflict |
| Checkout reason + unrelated resident edit | APPLIED |

A `STALE` proposal can never be applied; a fresh submission needs a new Idempotency-Key, a fresh server-captured original and fresh evidence/review where required. A `LIFECYCLE_CONFLICT`/`FINANCE_CONFLICT` proposal stays PENDING and may later be approved, rejected or withdrawn.

### 9.5 Unsupported end states and correction ordering

* Booking `[10,20)` → `[15,18)` is reachable by two single-field corrections in either order (each intermediate valid), but the first applied one stales the other: **N dependent fixes need N sequential proposals and approvals.** If a live admission lies outside the final range its date must be corrected first, then the booking dates (then check-in if needed): admission → booking → check-in.
* Booking `[10,20)` → `[25,30)` has no valid start-first intermediate and end-first is a prohibited lengthening. The only path is the extension command (`[10,30)`) then a start correction, and it **fails when another booking occupies `[20,25)` on the bed even though the final range is valid. That end state is unsupported in this release.** The transient `[10,30)` state is visible to other readers between the two commits.
* Also unsupported: shifts or swaps whose every single-field intermediate overlaps; reversing an end-date shortening by lengthening.
* Manual fallback: for a booking with **no** check-in history, cancel and recreate; a booking with any check-in history cannot be cancelled, so there is no fallback for stays.
* The UI states the required order and the resubmission cost. Grouped/atomic repair requires a separately designed and separately authorized workflow and is **not** introduced here. The owner may instead defer enabling the interdependent chain (`startDate`/`endDate`/`admissionDate`/`checkInAt`).

## 10. Locking and transaction protocol (Decision 6)

`RECOMMENDED — NOT APPROVED`: **AMEND — scoped exclusive organization gate.** v1.2's shared/exclusive hybrid is **not** the first-release recommendation. Reason: with a shared mode, shared Finance readers overlap shared lifecycle writers and need a new Finance row-lock chain; the derived deadlock classes below then multiply. Exclusion gives lifecycle-derived reads a stable source without that chain. Whether serialization is proportionate at Nook's initial target of about 100 beds is **unmeasured**; it is decided only by the acceptance criteria in section 16.2. If measurement shows unacceptable contention, the fallback is per-booking batching of monthly generation or a separately reviewed shared-mode design (v1.2 hybrid) with its fixes; neither is pre-approved.

### 10.1 Who acquires the gate (exclusive)

| Path | Gate |
|---|---|
| Booking create, update, extend, cancel | Yes |
| Admission create, update (all branches), approve, cancel, reopen | Yes |
| Check-in create; check-out; check-in notes update | Yes |
| `FinanceService.createDraft`, `issue`, `generateMonthly` — API controller entry **and** the scheduler (acquired inside the service, not the caller) | Yes |
| Correction **submission and application** for booking, admission, `checkInAt`, `checkOutAt` fields | Yes |
| Standalone settlement: `recordPayment`, `reversePayment`, `adjustInvoice`, `voidInvoice` (non-correction) | **No** — they keep the Invoice lock protocol |
| Reads, `previewMonthly` and dry runs (advisory only, never approval evidence) | No |
| Resident-profile edits, resident creation, enquiry conversion | No |
| Resident `firstName`/`lastName` corrections and checkout-`reason` corrections | No — row locks only |
| Correction reject and withdraw | No |

### 10.2 Protocol

1. **One shared helper** derives the key from the organization id and acquires `pg_advisory_xact_lock` (exclusive, transaction-scoped); used by every module. The key namespace must not collide with `invoice-number:`/`payment-idempotency:` keys or the test-suite lock. Whether to keep the existing hash function or derive a 64-bit key in application code from a documented hash is a P4-2.1 review item. A static guard test must show every in-scope `$transaction` calls the helper. Shared mode is not used.
2. **Order:** (1) command-key advisory lock (actor + key) → (2) proposal row `FOR UPDATE` (decisions) → (3) organization gate → (4) invoice-number advisory lock if numbering is needed → (5) existing ordered row locks Bed → Resident → Booking → Admission → CheckIn → CheckOut (UUID-sorted within a table) → (6) Invoice. No earlier resource may be acquired later. The gate is requested directly in exclusive mode and never upgraded.
3. **Implicit locks count.** Foreign-key checks take key-share locks on referenced rows and triggers may read other rows; an order is acceptable only after those are included. Derived hazard to resolve: `Admission.create` changed to lock Booking first would hold Booking and then need key-share on Bed/Resident, the reverse of the check-in order; therefore `Admission.create` must explicitly lock Bed → Resident → Booking **before** its insert. UNPROVEN until forced-interleaving tests run.
4. **Authoritative reads inside, after the gate:** every read that feeds a write, an amount or a validation (including `createDraft`'s booking/stay/amount reads, `Admission.create`/`update` booking reads, and issue's source validation) happens inside the same transaction after the gate is held, and is revalidated after row locks. Unlocked probes are routing hints only.
5. **Transaction-local timeout and explicit options:** each gate acquirer sets `lock_timeout` transaction-locally (via `set_config(..., true)`); ordinary writers get explicit Prisma transaction options (they currently use 2 s/5 s defaults). Values in section 11.3.
6. **Caller's client only:** correction handlers use only the transaction client they are given; they may not call public service methods that open their own transaction (a second connection would wait on its own caller, undetectable by PostgreSQL). Finance helpers used by corrections must accept the caller's `tx`.
7. **No network or evidence fetching inside transactions.**

### 10.3 Settlement and the Resident ↔ Invoice hazard

The exclusive gate does **not** solve payment/settlement races, because settlement operations do not take it. Derived deadlock (UNPROVEN): a correction holding a Resident row `FOR UPDATE` that then locks an Invoice can wait on `recordPayment`, which holds that Invoice and whose payment insert needs key-share on the Resident row (the payment has a composite FK to `residents`).

* **Prohibition (REQUIRED DESIGN):** correction code must **never hold a Resident row lock and then acquire an Invoice lock.**
* Corrections of gated fields take no Resident row lock (the gate already excludes lifecycle writers); name corrections take Resident only and lock no Invoice; where a correction must lock Invoices (draft void/recalculation, classifying slots), it does so with no Resident row lock held.
* **A safe invoice-locking strategy is required and is not yet decided.** P4-2.3 and P4-2.4 must jointly choose and prove one of: (a) Invoice locks taken only without a Resident row lock held; (b) settlement paths taking an explicit Resident key-share before the Invoice; (c) a weaker Resident lock mode for non-key-column changes. Financial correction application stays disabled until that review passes and the evidence exists.
* Standalone Finance methods currently translate no deadlock error; a deadlock there would surface as an unmapped server error. P4-2.4 must add deadlock handling for any settlement path it can collide with.

### 10.4 Correction-created billing gaps (scheduler and manual generation) — fail closed

Hazard (VERIFIED code): the scheduler creates invoices already ISSUED (`issue: true`) for the previous and current month, and the manual `generate-monthly` endpoint can do the same for any month up to next month. A correction that makes a stay newly billable in a month with no active invoice slot would otherwise be invoiced and issued by the next ordinary run without OWNER review.

`RECOMMENDED — NOT APPROVED` rule:

1. When an APPLIED correction changes the billable-month set of a booking, the application transaction (under the gate) computes the set before and after using Finance's own eligibility rules and records, for every **newly billable booking-month with no active invoice**, a durable unresolved **billing-gap** link (`REVIEW_REQUIRED`, booking, month) in `correction_finance_links`.
2. `generateMonthly` (scheduler **and** controller) and `createDraft` skip any booking-month with an unresolved gap: nothing is created or issued for it, and the result counts it as `skippedPendingReview`. This is checked inside the gated transaction. An ordinary scheduled or manual run can never bypass REVIEW_REQUIRED.
3. An independent OWNER resolves the gap with a recorded reason: either *release* (the slot may then be produced by a normal explicit `createDraft` + `issue`; the scheduler never auto-issues a released correction gap) or *no supported remedy*. No automatic invoice, credit or refund results.
4. If the before/after eligibility cannot be computed reliably (legacy invoices without booking linkage, legacy checkouts without a `CheckOut` row), approval fails closed (`FINANCE_CONFLICT`).

This couples Decisions 6, 9 and 10 and adds a schema requirement (the gap link) to P4-2.1 and a Finance requirement to P4-2.4.

### 10.5 Inventory writers

VERIFIED: bed/room `archivedAt`/`operationalStatus` are read by creation-time rules and the availability list only; no Finance rule and no allowlisted-field correction rule in this specification reads them; inventory mutations (`updateMany` on property/floor/room/bed, archive and status) use no transaction or locks and are not in the gate. Whether they can invalidate a correction assumption is **not established** and depends on what P4-2.3's validators read.

**Implementation gate (unresolved):** P4-2.3 must state the exact facts each correction validator reads. **Default:** correction validators must not read bed, room, floor or property state; with that rule inventory writers stay outside the gate. If any validator does read such state, the corresponding inventory mutations join the gate protocol before correction application is enabled.

### 10.6 Design requirement versus proven behaviour

Everything in 10.2–10.5 is REQUIRED DESIGN. Not proven: that `lock_timeout` bounds an advisory-lock wait *(PG docs: it applies to lock acquisition attempts generally; advisory locks are not named)*; release on rollback beyond the documented text; lock-queue behaviour when an exclusive request waits; the derived cycles; and that exclusive serialization meets A1–A10.

## 11. Retry, idempotency and status contracts (Decision 16)

`RECOMMENDED — NOT APPROVED`: **AMEND**, retaining terminal `STALE`, exact idempotent replay, same-key retry after an uncertain commit, permanent terminal states, and committing STALE before returning 409.

### 11.1 Isolation and transaction shape

* Correction transactions run at **READ COMMITTED with locks**, stated explicitly. No evidence in the repository justifies another level for this path. SQLSTATE 40001 is therefore defensive (PostgreSQL normally raises it only under REPEATABLE READ/SERIALIZABLE).
* STALE is **returned by value** from the transaction callback, committed, and only then raised as HTTP 409 (existing services signal conflicts by throwing inside the callback, which rolls back; that pattern must not be used for STALE).
* The canonical order of checks is section 9.1 item 6.

### 11.2 Four different time limits

| Setting | Measures | Enforced by | Today (VERIFIED) |
|---|---|---|---|
| Prisma `maxWait` | Time to obtain a transaction/connection — **not** lock waiting | Prisma client | default 2 s; CheckIn 10 s; Finance 10 s |
| Prisma `timeout` | Total wall time of the interactive transaction | Prisma client (rolls back) | default 5 s; CheckIn 20 s; Finance 30 s |
| PostgreSQL `lock_timeout` | Each individual lock acquisition | PostgreSQL | not set anywhere |
| PostgreSQL `statement_timeout` | One statement's elapsed time, including lock waits inside it | PostgreSQL | not set in source; server default is disabled *(PG docs)*; deployment value unknown |

### 11.3 Recommended values and bounds

* Correction: `lock_timeout` 5 s **per acquisition, bounded by remaining budget** (set it to the smaller of 5 s and the time left before the transaction `timeout`), Prisma `maxWait` 10 s, `timeout` 30 s. `statement_timeout` is an optional backstop set below the Prisma `timeout`; its value is chosen only after P4-2.6 measurement.
* Ordinary gate acquirers (Booking/Admission/CheckIn/Finance gated paths): `lock_timeout` 3 s with explicit Prisma options so a held gate returns a clean 409 `RETRY_REQUIRED`, not a transaction-timeout failure.
* Total command deadline across attempts ≤ 45 s; the shorter of this and any caller limit wins. Three full attempts must not exceed it.
* A Prisma `timeout` expiry may not unblock a statement already waiting on a lock (a connection processes statements sequentially) — UNPROVEN — so a bounded `lock_timeout` is mandatory, not optional.

### 11.4 Retry rules

* **At most two** whole-transaction retries, **only** when the driver error's SQLSTATE is **40P01 or 40001**, read from the actual driver code (`originalCode` on the adapter's cause / `meta.driverAdapterError.cause.originalCode` / the pg `code`), never from message text. Same Idempotency-Key, bounded jitter.
* **Not auto-retried:** lock timeout (SQLSTATE 55P03), any Prisma transaction timeout or start failure, connection loss, unknown-commit outcomes, validation, authorization, domain-conflict and unique-violation errors.
* **55P03:** the installed adapter does not map it (it arrives as a generic driver error with `originalCode`), and the existing transient classifier does not include it. The correction classifier must read `originalCode` explicitly and map 55P03 to `RETRY_REQUIRED` (409) after rollback. The exact Prisma error shape is UNPROVEN until observed on a real server.
* **Prisma P2028 / start / timeout:** classify by phase tracked by the application. (a) *Failed before the transaction executed* (could not start within `maxWait`): nothing ran; `RETRY_REQUIRED`, no state change. (b) *Expired during execution before `COMMIT` was issued*: rolled back; `RETRY_REQUIRED`. (c) *Expired or failed while `COMMIT` was in flight, or connection lost at any point after COMMIT was sent*: **uncertain outcome** — no response claiming failure; the client must re-POST with the same key. P2028 is never silently treated as a safe retry.
* **Unknown commit / uncertain outcome:** there is no lookup-by-key route; the lookup **is** a same-key re-POST, which hits the receipt (below).
* **Safety conditions for a retry:** all effects are inside the database transaction; each attempt starts with the command-key lock and receipt lookup; membership, user, organization and role are **re-read on every attempt** (the session guard's earlier result is stale); the stored immutable snapshot is compared against freshly read facts; age/eligibility and the decision instant are re-sampled (Decision 3's pending sampling rule governs how); no state computed in an earlier attempt is reused.

### 11.5 Command receipts and idempotency

* `correction_command_receipts`: id, `organization_id`, `actor_id`, `idempotency_key`, `request_check`, `proposal_id`, `action`, `outcome_code`, `recorded_at`; `UNIQUE(organization_id, actor_id, idempotency_key)`; same-tenant proposal FK; append-only (update/delete forbidden by trigger, following the existing idempotency-key precedent). The key namespace is shared by submit/approve/reject/withdraw. Key format: UUID.
* **`Idempotency-Key` header is the single source**; the proposal's `correlationId` is its stored copy (unique with organization and requester as a second backstop). Body fields never carry the key.
* **Receipt and effect are written in the same transaction**, so "receipt exists ⇔ the command committed". Committed STALE writes a receipt; validation, authorization and conflict errors that commit nothing write none.
* **Request check:** an **HMAC-SHA256** (server-side secret with a key id) over a canonical request — route/action, proposal id (decisions only; a submission's id does not exist yet), tenant, actor and canonical payload (sorted keys, trimmed strings, canonical decimals, instants as canonical text) — **or** a comparison against the values already stored on the proposal. A plain hash of low-entropy values (names, prices) is not acceptable because the key is stored beside it. The secret's provisioning is an implementation item; no configuration was inspected.
* **Replay binding:** tenant (session organization), actor, action, route and proposal id are checked against the stored receipt; any mismatch → `IDEMPOTENCY_CONFLICT`. The target and proposal are resolved with an organization filter (404) **before** any receipt lookup so receipts never confirm another tenant's records.
* **Replay returns the original status and safe result** (201 submission, 200 decision, 409 committed STALE) with no new mutation, audit or receipt; current authorization (session, active role, tenant) is rechecked first — a demoted or revoked actor gets 403/401 even though the command committed and reads the state through the authorized detail endpoint. Receipts contain codes and ids, not protected values. A retry that finds the first attempt still running waits on the command-key lock up to `lock_timeout`, then replays or returns `RETRY_REQUIRED`.
* Receipt retention follows Decision 14.

### 11.6 STALE semantics and timestamps

* A STALE row stores a closed **`staleCause`** code (the dependency group that changed) and `outcome_code = STALE_SOURCE`. `decidedBy` is the authorized actor whose attempt detected it. The reviewer's attempted approval text is kept only in protected proposal storage, labelled as an attempted rationale; it is never copied to `AuditEvent`.
* **`decidedAt`** is the instant the terminal decision was recorded (for every terminal status); **`appliedAt`** exists only for APPLIED and is the instant the source mutation was applied in the same transaction. They may hold the same sampled instant but are distinct columns with distinct meanings. How the decision instant is sampled is Decision 3's pending choice; PostgreSQL `now()` is transaction-start time and must not be assumed to be that sample. Decision 10's `dueAt` is unrelated to either.

### 11.7 Error codes

| Condition | HTTP | Code | Retry? |
|---|---|---|---|
| Different-key same-field pending collision (submission only) | 409 | `PENDING_CONFLICT` | after the holder is terminal |
| Captured dependency or approved financial preview changed (approval only) — STALE committed | 409 | `STALE_SOURCE` | no; new proposal and key |
| Invariant/range/chronology violation, snapshot intact | 409 | `LIFECYCLE_CONFLICT` | after the condition changes |
| Finance cannot classify/apply, including "issue needs recalculation" and unresolved billing gap | 409 | `FINANCE_CONFLICT` | after resolution |
| Same key, different payload/action/proposal/tenant | 409 | `IDEMPOTENCY_CONFLICT` | no; new key |
| Deadlock/serialization after ≤ 2 retries; 55P03; start failure; expiry before COMMIT | 409 | `RETRY_REQUIRED` | yes, same key |
| Uncertain commit outcome | none/5xx | — | **must** re-POST same key |
| Terminal proposal, non-replay command | 409 | `INVALID_STATE` | no |
| Self-review | 403 | `SELF_REVIEW` | no |
| Role/membership not permitted (including a non-OWNER on an exceptional/financial proposal, or revoked inside the transaction) | 403 | `INSUFFICIENT_ROLE` | no |
| Session invalid | 401 | `UNAUTHENTICATED` | — |
| Mandatory evidence missing at submission | 400 | `INVALID_EVIDENCE` | with evidence |
| Evidence required at approval time (e.g. age crossed the window) and absent | 409 | `EVIDENCE_REQUIRED` *(new; recommended)* | no; reject and resubmit |
| Unknown or cross-tenant target/proposal | 404 | `NOT_FOUND` (same shape) | no |
| Invalid field/value, unknown or forged body keys | 400 | `INVALID_FIELD` / `INVALID_VALUE` / `UNKNOWN_FIELD` | corrected |

`RETRY_REQUIRED` shares HTTP 409 with domain conflicts, so clients branch on `code`. A reviewer rejecting for insufficient evidence is a normal 200 `REJECTED`, not an error. Errors never expose SQL or index names, protected values, other actors or database text.

## 12. API contracts

Prefix `/api/v1/corrections`. `SessionGuard` on every route; `OriginGuard` + `CsrfGuard` on every POST; active role and membership rechecked for decision commands; all tenant and actor ids derive from `req.auth`. Unknown body keys (including `originalValue`, `organizationId`, `requestedBy`, `approverId`, `status`, `financialImpact`) are rejected. Parent identifiers are resolved server-side with an organization filter; malformed UUIDs are 400; unknown and cross-tenant ids share one 404 shape.

| Route | Request | Response |
|---|---|---|
| `POST /` | `Idempotency-Key` (UUID) header; `{targetType, targetId, fieldKey, proposedValue, reason, effectiveAt, evidenceReference?, relatedProposalId?, relationshipKind?}` | 201 protected proposal; exact replay 201 |
| `GET /` | page ≥ 1, limit 1–100, optional filters | 200 safe summaries (no original/proposed values) |
| `GET /history` | `targetType`, `targetId`, page/limit | 200; register before `/:id` |
| `GET /:id` | UUID | 200 protected detail with `allowedActions` |
| `POST /:id/approve` | `Idempotency-Key`; `{decisionReason, exceptionRationale?}` | 200 APPLIED (no separate approved state) |
| `POST /:id/reject` | `Idempotency-Key`; `{reason}` | 200 REJECTED |
| `POST /:id/withdraw` | `Idempotency-Key`; `{reason}` | 200 WITHDRAWN |

A REVERSAL must reference an APPLIED correction of the same target and field; the client supplies the requested replacement and the server captures the current original. Detail responses omit `expected_snapshot` and any request check; protected detail and history use `Cache-Control: no-store`. Errors are `{code, message, requestId, correctionId?}` per section 11.7. Phone/email are not accepted as `fieldKey`.

## 13. Finance consequences (Decisions 8, 9, 10)

### 13.1 Remedies (Decision 8) — `RECOMMENDED — NOT APPROVED` (ACCEPT)

Only verified existing operations are reusable, each within its existing limits and each only after a **separately approved, independent OWNER** remedy decision: balance-limited credit (`adjustInvoice`: negative amount, issued, non-cancelled, outstanding balance, never above it); payment reversal (append-only, refuses cancelled invoices); replacement payment (links an already reversed payment); guarded invoice void (terminal; no applied credits or unreversed cash); manual replacement = `createDraft` + explicit `issue` after an eligible void (no dedicated replacement command and no automatic lineage). No debit note, write-off, tax correction, refund of a paid invoice or deposit/settlement operation exists or is introduced. The existing Finance controller admits both operator roles; the OWNER-only independent gate applies to **correction-linked** remedies and must be enforced at the service/entry-point level with a server-verified correction association, never an optional client flag. Unrelated Finance authority is not changed.

### 13.2 Drafts (Decision 9) — `RECOMMENDED — NOT APPROVED` (ACCEPT)

"Genuinely unissued" means status DRAFT, `issuedAt` null and no issue/void/payment/credit evidence; a CANCELLED issued invoice is never a draft. A transaction-aware Finance helper (accepting the caller's `tx`; it does not exist today) recomputes eligible draft amounts from authoritative rules and audits them. A genuine draft that is no longer eligible is **voided through FinanceService with a recorded reason (InvoiceVoid history retained), never silently deleted**, and that consequence is shown in the OWNER's approval preview. Missing or ambiguous linkage (legacy invoices without a booking) means manual review or fail-closed approval, never guessed allocation. No retrospective invoice is created and `issue=true` is never invoked by approval. If the owner rejects draft voiding, affected approvals fail closed until another approved policy exists. `FinanceService.issue` must validate current source eligibility and amount under the gate and fail with `FINANCE_CONFLICT` rather than issue a stale draft.

### 13.3 Issued invoices (Decision 10) — `RECOMMENDED — NOT APPROVED` (ACCEPT coexistence)

A factual correction may be APPLIED while a linked issued invoice is `REVIEW_REQUIRED`; APPLIED describes only the source fact. The response and history must show the pending review and must not claim money was corrected. A pending review does not block payment, imply a write-off or change an issued invoice; a separate independent OWNER may conclude "no supported remedy" with a retained reason. Fully paid invoices cannot receive existing credits; no refund is invented. Correction-created billing gaps follow section 10.4.

**Decision 10 operational sub-decisions (10.1–10.4) are `RECOMMENDED — NOT APPROVED` and are not source rules.** They are specified in the worksheet: accountable tracking (named responsible OWNER plus organization OWNER queue), a three-business-day resolution target with `dueAt` defined as 00:00 Asia/Kolkata on the day after the final eligible business day (overdue exactly when `now >= dueAt`, never shifted to a business day, never derived by adding 72 hours), an overdue reminder/escalation path, and resident communication timing. The workweek and any holiday calendar are not approved. Expiry, reminders and notices never change an invoice, block a payment, reopen a fact, or confer authority. **This SLA is a financial-review service target; it is separate from correction age (Decision 3), the decision-time sampling rule, and every retry/timeout value in section 11.**

### 13.4 Finance links (typed, append-only)

`correction_finance_links`: one proposal FK; tenant-safe invoice FK `(invoice_id, organization_id, resident_id)` → `invoices`; outcome `REVIEW_REQUIRED` or resolved; for a resolved link a separately recorded approving OWNER and reason; an optional operation reference; billing-gap rows (section 10.4) carry booking and month. Resolution is a new append-only link event, never an automatic adjustment.

| Referenced record | Existing tenant-safe key (VERIFIED) | Needs a new key |
|---|---|---|
| Invoice | `UNIQUE(id, organization_id, resident_id)` | No |
| InvoiceAdjustment | composite FK to the invoice key; no operation unique | Yes — `(id, invoice_id, organization_id)` |
| InvoiceVoid | composite FK to the invoice key; `UNIQUE(invoice_id)` only | Yes — `(id, invoice_id, organization_id)` (or `(invoice_id, organization_id)`, since one void exists per invoice) |
| PaymentReversal | FK `(payment_id, invoice_id, organization_id)` → payments; no `resident_id` | Yes — `(id, invoice_id, organization_id)` |
| Payment (replacement) | `UNIQUE(id, invoice_id, organization_id)` and `UNIQUE(id, organization_id)` | **No — replacement payments are in link scope** (resolves the omission in v1.2) |

An ID foreign key alone proves nothing about invoice, resident or tenant; the composite keys above do for operation → invoice → resident → organization. **They do not prove the linked invoice is affected by the proposal's target.** `RECOMMENDED — NOT APPROVED` enforcement: the link stores the affected resident (and, for a Booking target or a billing gap, the booking) with composite FKs `(…, organization_id)`, and a reviewed constrained trigger plus transactional service validation require the link's resident (and booking) to equal the proposal target's resident (and booking), and the invoice's resident/booking to match. A mutual-exclusivity CHECK separates `REVIEW_REQUIRED` (no operation, no approver) from resolved links; unique resolution keys prevent duplicates. A User FK proves identity, never OWNER role — authority is a service requirement. Exact SQL and Prisma are P4-2.1 deliverables.

## 14. Audit, privacy, retention, contact exclusion (Decisions 11, 13, 14)

* Audit events `correction.submitted|applied|rejected|withdrawn|stale` are written in the same transaction as the state change, with actual time and safe identifiers only; free-text reasons, evidence and values stay in protected proposal storage. Domain audit events are preserved alongside correction events in the same transaction. Resident edits write no audit today, so applying a name correction needs a defined domain event (P4-2.3 item).
* **Decision 14** `RECOMMENDED — NOT APPROVED` (ACCEPT): protected values, permanent retention of withdrawals, rejections and review history, minimized general audit metadata, role- and tenant-restricted detail; no passwords, tokens, document bytes or secrets; no tamper-proof claim. Indefinite retention of personal values and evidence needs privacy/legal review before production.
* **Decision 11** `RECOMMENDED — NOT APPROVED` (ACCEPT): requester-only withdrawal of a PENDING proposal with a reason; reversal is a new proposal under all current rules; no silent cancellation, deletion or privileged undo.
* **Decision 13** `RECOMMENDED — NOT APPROVED` (ACCEPT): phone/email stay outside P4-2; existing contact edits are neither redefined nor certified as verified.
* **Decision 12** `RECOMMENDED — NOT APPROVED` (ACCEPT): section 5; no eligible independent reviewer means PENDING.

## 15. Frontend scope

Reuse the existing React ops layout, `ResidentProfile.tsx`, `useAsync`, `Pager`, `ErrorState`, `EmptyState`, ops API/route conventions. Add an allowlisted request form (original server value, typed proposed input, effective time, reason, evidence, classification), a paged queue with status filters, a protected review view (exact before/after, evidence, effective vs recorded time, financial consequences, exception status), and history on the resident profile that never shows a pending value as current. Server-provided `allowedActions` are authoritative; reasons are required for approve/reject/withdraw; the Idempotency-Key is kept across network retries; duplicate controls are disabled while pending; an uncertain outcome offers a same-key retry. STALE/conflict responses refresh the source and explain that a new proposal is needed. The correction form shows the required ordering (admission → booking → check-in) and the resubmission warning (section 9.5). The resident edit form stops sending unchanged names. Issued-invoice warnings identify manual Finance review and never offer an automatic adjustment. No document upload, public self-service or room/bed transfer UI.

## 16. Testing and acceptance

No test or database has been run for this specification. Mock tests cannot establish any concurrency, lock, timeout or constraint property.

### 16.1 Test levels

* **Unit:** all nine typed fields; unknown-field refusal; money bounds; strict dates; host-timezone independence; half-open intervals; instant precision; age 89/90/91 and crossing at approval; anchors; evidence categories; classification; canonical request check; error classifier on `originalCode` (40P01, 40001, 55P03, 23505, P2028 phases).
* **Service/controller:** both roles; the review matrix; self-review; sole OWNER; revoked roles on first call, retry and replay; tenant isolation; ordinary-route candidate-field refusal (whole request, mixed payloads); STALE-by-value commit; every row of section 11.7.
* **PostgreSQL (disposable, authorization required):** typed FKs, exactly-one-target and field/type CHECKs, terminal-state checks, partial indexes; transactions and rollbacks; microsecond comparison; column-only application preserving concurrent unrelated edits; no issued-invoice mutation.

### 16.2 PostgreSQL acceptance criteria A1–A10 (proposed; none executed)

| # | Criterion | Proposed threshold |
|---|---|---|
| A1 | Ordinary gate wait | `lock_timeout` ≤ 3 s; expiry returns 409 `RETRY_REQUIRED`, never a Prisma transaction-timeout failure (shortest ordinary `timeout` is 5 s) |
| A2 | Correction gate-hold (gate acquired → commit) | Hard maximum ≤ 2 s on the fixture; target p95 ≤ 500 ms |
| A3 | Correction attempt bounds | 5 s per acquisition bounded by remaining budget; no attempt exceeds the 30 s timeout |
| A4 | Monthly-generation hold | ≤ A1 minus margin on the 100-bed fixture, else batch per booking (safe in principle because generation is idempotent by slot uniqueness) |
| A5 | Ordinary-operation latency | p95 with gate and no contention within 5 % of the same suite's pre-gate p95 on the same hardware |
| A6 | Deadlocks | **Zero** 40P01 across ≥ 1,000 randomized interleavings per race pair in 16.3; a deadlock is a defect to fix, not to retry |
| A7 | Retries | ≤ 2 whole-transaction retries; no duplicate audit, receipt or application after any retried attempt |
| A8 | Queue effect | With a simulated 2 s holder and a waiting request, record the wait of a new request |
| A9 | Pool | With the gate held and K waiting requests, non-gated endpoints stay responsive |
| A10 | `lock_timeout` coverage | Demonstrate that `lock_timeout` aborts a wait for the advisory gate and for row locks, and record the exact Prisma error shapes for 40P01, 55P03, partial-index 23505 and P2028 |

Workload assumptions (test design, not forecasts): 100 beds; 100 residents with bookings and stays; 12 months of invoices; ≥ 10 concurrent ordinary clients; one simulated scheduler run; one correction per gated field type. Whether exclusive serialization is proportionate at that scale is decided by these results, not assumed.

### 16.3 Concurrency scenarios to be executed (none has been run)

1 two same-field proposals, different keys · 2 two different-field proposals, one resident · 3 two independent name approvals · 4 booking correction vs new booking · 5 booking correction vs admission creation · 6 admission update vs check-in · 7 check-in correction vs checkout · 8 checkout correction vs new stay on the bed · 9 correction vs `createDraft` · 10 correction vs monthly generation, **including a scheduler run and a correction-created billing gap** · 11 correction vs `issue` · 12 correction vs payment/reversal/credit/void, **including the Resident ↔ Invoice lock-order hazard** · 13 approve vs reject · 14 approve vs withdraw · 15 approval commits but its response is lost, then same-key retry. Each asserts final durable rows, audit count, winner/loser response, receipt behaviour, absence of partial effects and bounded lock completion, in both winning orders, through the real guards, services, triggers and scheduler path. Additional cases: per-index checks (two keys on one field yield one proposal and one 409 with no loser audit/receipt; distinct fields coexist; each terminal status frees the slot only after commit; rollback keeps it; two-/zero-target, wrong-type, wrong-field and NULL rows rejected); cross-tenant FK rejection without leaking existence; same-key replay before conflict classification; exercise CheckOut targets only after the reviewed unique key exists; Finance links fail closed without their keys; legacy missing-checkout billing and check-in notes cannot fabricate occupancy or issue charges.

## 17. Slices, gates and blockers

| Slice | Scope | Gate |
|---|---|---|
| P4-2.0 | Owner approves policy; this specification is reconciled with the worksheet | Owner decisions recorded; **no implementation** |
| P4-2.1 | Schema/contracts: typed model, enums, five indexes, CHECKs, triggers, CheckOut unique and FK, Finance-link keys and billing-gap link, receipts, tracked generated client, CI migration manifests | **Not authorized.** Needs approved Decisions 1, 5, 7, 16 (schema parts) and independent schema/migration review |
| P4-2.2 | Submit/list/detail/history/reject/withdraw, roles, receipts | Apply endpoint stays disabled |
| P4-2.3 | Gate helper, lock protocol, STALE-by-value, atomic typed apply, ordinary-route bypass closure, writer fixes (Admission transaction/reads, `createDraft` reads, check-in notes rule), inventory-reads decision | **Blocks gated-field and financial application; joint review with P4-2.4** |
| P4-2.4 | Transaction-aware Finance helper, issue validation, scheduler/manual-generation gap suppression, safe invoice-locking strategy, remedy gate and links | **Financial correction application stays disabled until P4-2.3 and P4-2.4 have a joint independent review and acceptance evidence** |
| P4-2.5 | UI | After stable API |
| P4-2.6 | Independent acceptance, A1–A10, scenarios 16.3 | **Requires an explicitly authorized disposable PostgreSQL database and actual execution.** Production also needs privacy/legal review |

Migration application, CI manifest edits, client generation, deployment and Git publication need their own authorization. This document grants none.

## 18. Decision register (all 16; every row `RECOMMENDED — NOT APPROVED`)

| # | Decision | Recommended selection | Blocks |
|---|---|---|---|
| 1 | Allowlist | ACCEPT nine fields; invoice name display stays current-profile (owner confirms) | P4-2.1 |
| 2 | Roles/classification | ACCEPT section 5 matrix | P4-2.2 |
| 3 | Normal lookback | AMEND: 90 days + precision wording; **decision-time sampling OPEN** | P4-2.1 (snapshot fields), P4-2.3 |
| 4 | Exceptions/evidence | ACCEPT, no cap, evidence rules | P4-2.2 |
| 5 | Granularity | AMEND, Model B | P4-2.1, P4-2.3 |
| 6 | Locking | AMEND, scoped exclusive gate | P4-2.3, P4-2.4, P4-2.6 |
| 7 | CheckOut reference | ACCEPT Option A + four clarifications | P4-2.1 |
| 8 | Finance remedies | ACCEPT verified operations only | P4-2.4 |
| 9 | Draft consequences | ACCEPT recalc + explicit void | P4-2.4 |
| 10 | Issued-invoice remedies | ACCEPT coexistence; 10.1–10.4 recommended, unapproved | P4-2.4 (10.1–10.4 not blocking until approved) |
| 11 | Withdrawal/reversal | ACCEPT | P4-2.2 |
| 12 | Sole OWNER | ACCEPT | P4-2.2 |
| 13 | Contact exclusion | ACCEPT | none |
| 14 | Retention | ACCEPT; legal review before production | P4-2.1, production |
| 15 | Routine/commercial boundary | AMEND per section 4 | P4-2.3 |
| 16 | Retry/status | AMEND per section 11 | P4-2.1, P4-2.2, P4-2.3, P4-2.6 |

## 19. Unresolved owner choices and gated implementation items

**Owner choices still open (recommended, not approved):** every register row; specifically Decision 3's decision-time sampling rule (recommended instant sampled after locks vs commit-day); archived-resident name correction (recommended: allowed, status not a dependency); invoice name display; the billing-gap suppression rule (section 10.4); timestamp precision (raw SQL vs millisecond); Decision 10.1–10.4 (accountability model, SLA duration and business-day/holiday calendar, escalation, resident communication); whether to defer the interdependent booking/admission/check-in chain.

**Implementation gates that stay closed:** the safe invoice-locking strategy (10.3); validators' reads of bed/room state and the resulting inventory-gate decision (10.5); proof that `lock_timeout` bounds the advisory gate; the derived lock cycles (Admission.create vs check-in; correction vs `recordPayment`; nested-transaction self-wait); gate-key derivation function; HMAC secret provisioning; Prisma tooling with SQL-only partial indexes; migration index-build behaviour; partial-index constraint-name surfacing; the draft helper and before/after billable-month computation; the correction-linked remedy provenance; the creation-path interval invariant; the defined domain audit for resident name application; deadlock handling on standalone Finance paths; all of A1–A10.

## 20. Lineage

v1.0, v1.1 and v1.2 specifications, the owner worksheet's earlier text and the reviews `01_02_15`, `03_04_12` and `05_06_07_16` are historical inputs. v1.2 is no longer the current proposal; where it differs, this document governs. The review documents' findings are recorded here as REQUIRED DESIGN or UNPROVEN, not as test results.

READY FOR OWNER APPROVAL — RECOMMENDATIONS ONLY; IMPLEMENTATION NOT AUTHORIZED
