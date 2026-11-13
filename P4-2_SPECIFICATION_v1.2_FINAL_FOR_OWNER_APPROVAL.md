# NOOK — P4-2 Specification v1.2

**Final technical review and owner approval preparation — implementation NOT AUTHORIZED**

Workspace: `~/Downloads/nook-phase4-1`  
Branch verified: `feature/phase-4-1-lifecycle-audit`  
HEAD: `908098acd567c299ad05529b5a533ad17622dceb` plus existing working-tree changes  
Review date: 2026-11-08

## 1. Executive summary and status

P4-2 introduces controlled, allowlisted corrections of resident and lifecycle facts. A protected proposal preserves the original fact, proposed replacement, evidence reference, requester, reviewer, reasons and effective/recorded times. Approval and application are one transaction. Issued invoice facts are preserved; any financial remedy is a separate, explicitly approved Finance operation.

This document is a complete proposal for owner review, not a record of new policy approval. **Frozen** means supplied owner direction; **Verified** means observed source behavior; **Proposed** means a recommendation requiring sign-off. Approval of this document freezes its proposed policy only when the owner explicitly accepts the register in section 16. Implementation requires a separate authorization afterward. Production additionally requires privacy/legal review and accepted PostgreSQL evidence.

Inspection used the current working tree, which contains existing modified and untracked Phase 4.1 files. Those files were read as the compatibility baseline; HEAD alone does not reproduce that baseline. No database was contacted, and schema/trigger observations describe repository definitions, not deployed state. No tests were executed during this documentation task.

### Changes from v1.0

The v1.1 review superseded v1.0; both earlier documents remain unchanged. V1.2 retains those recommendations. The exact field list, role matrix and lookback remain unapproved. Four recommendations are now explicit: 90-day normal review plus independent OWNER exceptions; one pending proposal per field with dependency-aware stale checks; shared/exclusive organization coordination plus existing row locks; and adding only the missing CheckOut composite unique key, not a new ownership column. These recommendations require owner acceptance and later technical verification.

### Changes from v1.1 — documentation-only consistency pass

- Replaced the ambiguous index shorthand with five individually named SQL definitions and exact ordered columns/predicates in section 8.
- Rechecked the working-tree Prisma schema and migration source: CorrectionProposal, its five target fields, its enums and correction_proposals table do **not** exist. Their physical mappings cannot be verified from source. Section 8 therefore makes the proposed mapping contract explicit and conditional on P4-2.1 implementation review; it does not claim existing @map definitions.
- Reconfirmed existing residents/bookings/admissions/check_ins/check_outs table mappings, organization_id ownership, existing target composite keys, missing CheckOut [id,organizationId] unique and Invoice [id,organizationId,residentId].
- Clarified that type predicates are redundant for valid rows but intentionally retained as readable target-specific guards; target/field CHECKs remain mandatory. Added uniqueness-error handling, terminal slot-release rules and explicit cross-references to transaction/tests/slices/register.
- Added future acceptance cases for each of the five definitions, NULL/type/field rejection, terminal-slot reuse, cross-tenant references and same-key replay precedence. No PostgreSQL validation or test execution occurred.
- Other documentation clarifications: terminal-state shapes and the difference between proposed names and existing schema facts; preservation of both prior versions; no business recommendation, owner decision or scope authorization changed. All section 16 checkboxes remain open.

## 2. Ten approved owner decisions

1. Explicit correction allowlist only; no arbitrary field paths.
2. All consequential corrections require approval.
3. Self-approval is prohibited.
4. Financial correction approval is OWNER only.
5. Historical corrections require controlled backdating, reason and approval.
6. Genuinely unissued billing may be recalculated under approved rules.
7. Issued invoices preserve their original facts; financial adjustment requires a separately approved operation.
8. Room/bed corrections belong to P4-3.
9. Rejected proposals are retained permanently.
10. Original values are retained indefinitely, subject to applicable privacy/legal requirements.

These directions are already approved; the implementation details below do not reopen them.

## 3. Verified repository facts

Verified against the current working tree, not a deployed database:

| Source | Confirmed fact |
|---|---|
| prisma/schema.prisma | UUID primary keys, Timestamptz(6), Decimal money, organization-scoped composite FKs; AuditEvent exists; candidate sources have updatedAt but no integer revision |
| CheckOut | Has organizationId, direct Organization relation and composite CheckIn/Resident/Bed/Booking tenant relations; unique checkInId and [checkInId,organizationId]; lacks [id,organizationId] unique |
| CheckIn / Resident / Booking / Admission | Each has organizationId and unique [id,organizationId]; CheckIn has one unique admission; Booking fixes resident and bed |
| Invoice | Unique [id,organizationId,residentId]; no separate line-item model; active invoice-slot uniqueness supplied by SQL migration |
| BookingService | create locks Bed; update/extend lock Bed then Booking; direct update refuses lengthening; confirmation permits payment pending |
| AdmissionService | Creation reads booking before its insert transaction; status paths lock Admission; normal update/audit can be separate writes |
| CheckInService | create locks Bed → Resident → Booking → Admission; checkout locks CheckIn; normal update permits notes only |
| ResidentService | Ordinary allowlisted update; archive guards with a Resident write lock |
| FinanceService | draft creation reads source facts before numbering transaction; generation uses organization invoice-number advisory lock; issue locks Invoice without source recalculation |
| Finance operations | Invoice-locked credits/reversals/voids and payment idempotency; current controller permits both operator roles |
| Auth/UI | Session/Origin/CSRF guards and role context; ResidentProfile uses existing useAsync/Pager/ErrorState/EmptyState |

Inspection also found `EnquiryService.convert` resident creation and `jobs/invoice-scheduler.service.ts` generation entry. No current correction engine, draft-recalculation command or new concurrency protocol is claimed. Migration text describes intended database safeguards only. Source reference index is appended in section 17.

## 4. Corrected candidate field allowlist and routine-edit boundary

**Every row requires owner sign-off.** Submitters are OWNER/PROPERTY_MANAGER; review uses section 5. Classification is server-computed and conservative: all booking financial terms and physical occupancy timestamps require OWNER even when a preview finds zero monetary difference. Historical admission dates also use OWNER as potentially finance-related chronology; the candidate admissionDate is classified financial for all requests to avoid role changes during review. Names and checkout reason are non-financial unless exceptional age requires OWNER.

| Target / fieldKey | API value / existing storage | Exact proposed validation | Impact and historical anchor |
|---|---|---|---|
| RESIDENT / firstName | string / String | Trim; 1–500 characters; preserve Unicode; no null; actual existing identity error | Non-financial; creation day; never rewrites issued document facts |
| RESIDENT / lastName | string / String | Same as firstName | Non-financial; creation day |
| BOOKING / startDate | YYYY-MM-DD / Timestamptz(6) | Strict real date; resulting start < end in IST; final atomic bed availability; cover live admission day; no status/assignment change | Financial; oldest original/proposed/effective day |
| BOOKING / endDate | YYYY-MM-DD / Timestamptz(6) | Exclusive day > start; no lengthening; preserve admission coverage, availability and actual occupancy facts | Financial; oldest original/proposed/effective day |
| BOOKING / monthlyPrice | decimal string / Decimal(10,2) | >0 and <=99999999.99, at most 2 fractional digits; canonical 2 decimals; documented original agreement; no negotiated change | Financial; booking start anchor; evidence always required |
| ADMISSION / admissionDate | YYYY-MM-DD / Timestamptz(6) | Authoritative booking/resident/bed unchanged; day in [booking.startDate, booking.endDate); cannot place admission after recorded check-in day | Financial precaution; original/proposed/effective day |
| CHECK_IN / checkInAt | zoned RFC3339 / Timestamptz(6) | Explicit zone required; real instant <= now; admission chronology; <= checkout if present; interval collision checks | Financial and occupancy; original/proposed/effective day; evidence mandatory if historical |
| CHECK_OUT / checkOutAt | zoned RFC3339 / Timestamptz(6) | Existing checkout only; >= checkInAt and <= now; interval collision checks; preserve checked-out status | Financial and occupancy; original/proposed/effective day; evidence mandatory if historical |
| CHECK_OUT / reason | string or null / String? | Trim; 1–500 characters or explicit null; correction justification separate from departure reason | Non-financial; original checkout anchor |

No-op replacements are 400. Validate both at submission and approval. One field per proposal; no implicit sibling updates. Multiple different-field proposals may coexist under section 8, but every individual application must be valid. Dependent changes needing simultaneous multi-field application are excluded from v1.2. Reject invalid intermediate states and explain that a separately approved grouped workflow would be required.

Mandatory envelope: correction reason trimmed 1–2000 characters; effectiveAt zoned RFC3339 <= now; request key UUID; evidence as above. Date corrections store the calendar day as the established UTC-midnight representation (booking.rules.ts), not a host-local Date. effectiveAt expresses when the corrected fact applies, not when the reviewer acted; it need not equal the corrected event instant. Original timestamp bytes are retained alongside normalized API values to avoid losing microseconds. Physical instants render in Asia/Kolkata. Strict calendar round-trip validation rejects overflow dates; do not rely on JavaScript Date normalization.

Excluded: phone/email; organization/membership/ownership; property/room/bed and assignments; every workflow/payment/invoice status; payment records; invoice fields; deposits/refunds/settlement; credentials; documents/verification; arbitrary JSON paths. No mass assignment. No KYC gate or uploads.

All nine allowlisted fields in section 4 are consequential once their record exists and must use P4-2. Creation still uses existing commands. Proposed integration removes direct post-creation writes to these fields from ordinary PATCH routes, with a clear correction-required response, so approval cannot be bypassed. Booking extensions remain an explicitly authorized domain command updating the same booking, under existing OWNER/PROPERTY_MANAGER authority. A mistaken end date may be shortened through correction; **lengthening still uses the existing extension command**, preserving its reason and audit requirements. P4-2 does not become an alternative extension path.

Ordinary address, emergency contact, notes and other already permitted non-allowlisted profile updates retain existing permissions and validation; P4-2 adds no new permission to edit them. Existing phone/email update behavior is not redefined here: exclusion means no correction endpoint support, and no claim that existing contact edits are verified. Existing status transitions remain domain commands. Commercial rent renegotiation requires a separate rental-term workflow; evidence of an original agreement is mandatory to correct monthlyPrice.

## 5. Authorization and separation of duties

Entire matrix below is **proposed** except frozen self-approval prohibition and OWNER-only financial approval.

| Action | OWNER | PROPERTY_MANAGER |
|---|---|---|
| Submit/view queue/detail/history | Yes | Yes |
| Approve/reject normal non-financial correction | Yes | Yes |
| Approve/reject financial correction | Yes | No |
| Approve/reject exceptional historical correction | Yes | No |
| Withdraw own PENDING proposal | Yes | Yes |
| Approve/reject own proposal | No | No |
| Withdraw another person's proposal | No | No |

An OWNER's normal non-financial proposal can be reviewed by another authorized PROPERTY_MANAGER. Any financial proposal, including one submitted by an OWNER, needs a different OWNER. A sole OWNER receives no exception: normal non-financial review can come from a different eligible PROPERTY_MANAGER; financial and exceptional review waits for a different OWNER. Membership must be active at action time. A revoked requester does not make a historical request disappear; an eligible independent reviewer may reject or approve it.

## 6. Historical lookback and evidence policy

### Critical point 1 — alternatives and recommendation

**Verified:** source date helpers compare Booking/Admission as IST days; persisted fields are Timestamptz(6), not SQL date. Check-in/out are physical instants. Existing correction lookback enforcement does not exist.

| Option | Operational consequence | Security/audit consequence |
|---|---|---|
| 30 days | Fits recent monthly review but pushes common delayed discoveries into exception review | Small normal window; more exceptional decisions and review fatigue |
| 90 days | Covers roughly a quarter of operations and completed stays | Bounded ordinary authority with manageable evidence review; recommended |
| 180 days | Fewer exceptions for old records | Larger normal authority and harder reconstruction of facts |
| Unrestricted historical exceptions with additional independent approval | Can resolve old errors; no age-based automatic eligibility | Requires evidence and independent OWNER rationale for every exception; never a blanket bypass |

**Proposed:** retain 90 days for normal review and allow older cases only through an independent OWNER's explicit exceptional approval. Additional means the exception decision/rationale beyond normal eligibility, not a mandatory third person. A financial request always still needs a different OWNER. If owner wants two independent reviewers for exceptions, that is a different workflow and must be separately specified before implementation. Age never overrides validity or invoice protections. Owner must explicitly approve both the limit and the exception route; neither is approved here.

### Exact calculation

At submission and approval compute `age = max(0, todayIST - min(candidateDays))` in whole calendar days. candidateDays always includes effectiveAt's IST day; date fields include BOTH authoritative original and proposed field days. Include the anchors below, ignoring null/non-date values rather than parsing them as dates:

| Field | Additional immutable anchor |
|---|---|
| Resident firstName / lastName | Resident.createdAt day, conservatively; a recent name change on an old resident still needs exception review unless a future approved policy defines another authoritative anchor |
| Booking startDate / endDate | Original start day; plus original/proposed value days; captures old booking context even for a recent end-date error |
| Booking monthlyPrice | Original booking start day |
| Admission admissionDate | Original admission day |
| CheckIn checkInAt / CheckOut checkOutAt | Original event day |
| CheckOut reason | Authoritative checkout day |

Store computed age, policy version and anchor facts in protected submission snapshot, but recalculate eligibility at decision time. A today effectiveAt cannot hide an old original date; a future proposed date cannot reset the age. A future booking/admission fact is a current correction of a scheduled fact; it is not scheduled application. For non-date fields the conservative anchors may produce more exceptions; this is an explicit trade-off requiring owner approval.

Normal review permits a maximum age of **90 Asia/Kolkata calendar days**, inclusive. Measure age using the exact candidate-day rules above. This conservative definition prevents a recent effectiveAt from concealing an old fact. A future booking/admission date is allowed; effectiveAt cannot be future because P4-2 applies corrections immediately, not scheduled changes. Future physical check-in/out instants are prohibited.

At approval, recompute age using the current date. Crossing day 90 requires exceptional review even if submission was normal. Exceptional review is a different OWNER from the requester, mandatory evidence and an explicit exception rationale in the approval command. This is one exceptional OWNER decision, not an invented third approver. No automatic age bypass; the queue clearly marks the exception. There is no automatic maximum beyond 90 days: older requests are permitted only through this explicit exceptional route, with the same integrity checks. Owner sign-off must expressly accept that exception policy.

Evidence is mandatory for every historical financial or occupancy correction, every exceptional correction and every monthlyPrice correction (the agreed term must be demonstrated). Other name/reason corrections within the normal window require a detailed reason; evidence is optional. Store a restricted reference or description (1–2000 characters), never document bytes or an unrestricted external URL containing credentials. Evidence has no automatic truth status. Reviewer must attest adequacy. Conflicting or insufficient evidence results in rejection with explanation; the immutable proposal cannot be patched. Submit a new proposal with better evidence, linked to the old one.

Completed stays remain correctable. Correcting timestamps cannot reopen a stay or release/reassign a bed. Validate the entire physical interval against other recorded stays for the same bed and resident, including completed stays and current occupancy. Reject contradictory chronology or missing authoritative parent history; do not fabricate a checkout from updatedAt. Booking intervals remain half-open IST days; physical checkout may occur beyond the booking end because overstay is a valid fact. Historical approval never authorizes overstay charges, penalties or refunds.

Previously billed periods require Finance classification and a comparison of affected invoice slots. Issued invoice facts remain untouched regardless of payment state. A factual correction can apply while a separately recorded Finance review remains unresolved; this must be visible. It cannot trigger retrospective invoice issuance, credit, refund or replacement. If safe draft recalculation cannot be completed, fail approval atomically.

Treat any earlier affected fact day as historical for evidence purposes; future booking changes are not automatically historical just because the envelope has a current timestamp. Evidence remains mandatory for all monthlyPrice requests. Completed-stay intervals are validated as half-open physical ranges [checkInAt,checkOutAt); equality at a boundary is allowed. Equal check-in/out instants follow existing checkout chronology (zero-duration stays); do not infer an occupied interval of positive duration. Active stays have an open end. Corrections preserve current ACTIVE/CHECKED_OUT status even when they change the historical report. Reject missing CheckOut rows for completed-stay timestamp correction rather than fabricating a timestamp from updatedAt. No final settlement is introduced.

## 7. Correction state machine

Statuses: PENDING, APPLIED, REJECTED, WITHDRAWN, STALE. There is no APPROVED-but-unapplied state.

| From | To | Authority / effect |
|---|---|---|
| none | PENDING | Eligible submitter; target/value snapshot plus submission audit in one transaction |
| PENDING | APPLIED | Independent eligible reviewer; complete application plus audit atomically |
| PENDING | REJECTED | Independent eligible reviewer; mandatory rejection reason; source unchanged |
| PENDING | WITHDRAWN | Requester only; mandatory withdrawal reason; source unchanged |
| PENDING | STALE | Authorized approval attempt detects changed dependency snapshot; commit stale decision and audit, no source change |
| any terminal | any | Forbidden; exact idempotent replay returns prior result |

For STALE return 409 only after successfully committing the STALE transition; do not throw inside the transaction and accidentally roll it back. Validation, Finance, constraint and infrastructure failures roll back all approval effects and leave PENDING (unless stale was the explicit committed outcome). A business conflict is not silently converted to rejection. Reversal is a new PENDING record, not a transition of the original. Rejected/stale/withdrawn requests may be superseded by linked new requests; no mutation of old evidence.

Requester OWNER or PROPERTY_MANAGER may withdraw their own PENDING proposal with a reason. Other operators cannot withdraw it. Rejection is a reviewer action. No deletion or editing of submitted proposals is permitted. An applied correction is reversed only by a new proposal referencing the applied proposal, capturing the current source value and following all current rules. The original is never changed to cancelled. Permanent retention extends to withdrawals. Use status WITHDRAWN rather than ambiguous CANCELLED; no separate cancellation command.

STALE.decidedBy records the authorized actor whose attempt detected stale facts, not a fabricated approver. STALE is terminal and frees the pending-field slot. A fresh key cannot turn a terminal proposal into APPLIED. Only exact command replay returns its stored result. Reversal targets the current value and must reference the same target/field; it does not blindly restore an old value after intervening corrections. Reversing an end-date shortening by lengthening remains subject to the existing extension-only boundary; there is no privileged undo bypass.

## 8. Corrected data model and relational constraints

### Verified baseline

`prisma/schema.prisma` uses PostgreSQL UUID ids, snake-case maps, Restrict relations, Timestamptz(6), Decimal money and composite tenant references. Resident, Booking, Admission and CheckIn expose unique [id, organizationId]. CheckOut has an id primary key but lacks that composite unique. Every candidate source has updatedAt; none has an integer version. AuditEvent has actor, nullable organization, target, requestId, occurredAt and JSON metadata. Invoice has no separate line-item model in this schema. Do not invent line-item snapshots.

### Smallest safe proposal

Add CorrectionProposal, reuse AuditEvent; no entity_version table, event-sourcing system or general mutation engine. Design below is a proposal, not executable migration approval.

| Fields | PostgreSQL / Prisma design |
|---|---|
| id | uuid primary key, gen_random_uuid(); String @id @db.Uuid |
| organizationId | one uuid NOT NULL column, Organization FK Restrict |
| targetType, fieldKey, status | closed enums; fieldKey validated against targetType by SQL CHECK and application switch |
| residentTargetId, bookingTargetId, admissionTargetId, checkInTargetId, checkOutTargetId | nullable uuid typed target references; exactly one non-null via CHECK; type must match |
| originalValue, proposedValue, appliedValue | jsonb; closed scalar envelope with value kind; appliedValue null until APPLIED; never arbitrary mutation instructions |
| expectedSnapshot | protected jsonb canonical exact source facts, updated_at textual microseconds and selected related facts |
| reason, evidenceReference | text; evidence nullable when permitted |
| effectiveAt, recordedAt | timestamptz(6); recordedAt DB default now(); recordedAt is submission time, requestedAt API alias |
| requestedBy, decidedBy | uuid User references Restrict; decidedBy nullable; requested role captured in protected snapshot |
| decidedAt, appliedAt | nullable timestamptz(6); actual recorded times |
| decisionReason, exceptionRationale | nullable text with state-dependent requirements |
| financialImpact | boolean server-computed; conservative classification retained |
| correlationId, requestHash | UUID key and canonical payload hash; unique [organizationId, requestedBy, correlationId] |
| relatedProposalId | optional uuid; composite same-tenant self-reference; relationship kind REVERSAL or SUPERSEDES |

For each typed target use composite FK `(target_id, organization_id) REFERENCES target(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT`. Add `@@unique([id, organizationId])` to CheckOut first and the proposal itself. Prisma optional relations use the nullable target scalar plus required shared organizationId and named relation/backrelation fields; all targets receive matching backrelations. Do not duplicate organizationId for each relation. Invoice links must use its existing [id, organizationId, residentId] unique key, not an assumed [id, organizationId] key.

### Explicit proposed mappings and five pending-field indexes

**Verified absence, not verified correction mappings:** neither `prisma/schema.prisma` nor repository Prisma/SQL definitions currently declare CorrectionProposal, its five target-ID fields, correction_proposals, or correction target/status/field enums. V1.1 supplied logical fields only. Consequently the names below are **proposed physical mappings requiring implementation review**, not facts about an existing Prisma model. No relation name or SQL enum type name is invented as an existing definition.

Proposed model mapping: `CorrectionProposal` → `@@map("correction_proposals")`. For index-bearing fields, the proposed explicit Prisma mappings are:

| Proposed Prisma field | Proposed mapping / physical column | Required shape |
|---|---|---|
| organizationId | @map("organization_id") | UUID NOT NULL; single shared tenant scalar |
| targetType | @map("target_type") | Closed target enum NOT NULL |
| fieldKey | @map("field_key") | Closed field enum NOT NULL; one scalar, no array/path |
| status | No @map needed: status | Closed status enum NOT NULL |
| residentTargetId | @map("resident_target_id") | Nullable UUID; typed target RESIDENT |
| bookingTargetId | @map("booking_target_id") | Nullable UUID; typed target BOOKING |
| admissionTargetId | @map("admission_target_id") | Nullable UUID; typed target ADMISSION |
| checkInTargetId | @map("check_in_target_id") | Nullable UUID; typed target CHECK_IN |
| checkOutTargetId | @map("check_out_target_id") | Nullable UUID; typed target CHECK_OUT |

Proposed enum **labels** are the targetType values in section 4, the fieldKey values in its nine allowlist rows, and PENDING/APPLIED/REJECTED/WITHDRAWN/STALE. SQL enum **type names** and Prisma enum identifiers are not specified or verified here; P4-2.1 must define/review them and use these labels consistently, with no enum-value @map silently changing stored labels. The SQL below uses implicitly typed string literals, so it does not assume any enum type identifier or cast. It assumes correction_proposals is in the migration's reviewed application schema/search_path; a non-default schema must be explicitly qualified consistently during implementation review.

**Proposed SQL definitions for the mapping contract above; documentation only.** These are not existing indexes, an executable migration, or evidence of PostgreSQL validation. Each index has ordered keys (organization_id, its named target-id column, field_key):

```sql
CREATE UNIQUE INDEX "correction_proposals_pending_resident_field_uq"
ON "correction_proposals" ("organization_id", "resident_target_id", "field_key")
WHERE "status" = 'PENDING'
  AND "target_type" = 'RESIDENT'
  AND "resident_target_id" IS NOT NULL;

CREATE UNIQUE INDEX "correction_proposals_pending_booking_field_uq"
ON "correction_proposals" ("organization_id", "booking_target_id", "field_key")
WHERE "status" = 'PENDING'
  AND "target_type" = 'BOOKING'
  AND "booking_target_id" IS NOT NULL;

CREATE UNIQUE INDEX "correction_proposals_pending_admission_field_uq"
ON "correction_proposals" ("organization_id", "admission_target_id", "field_key")
WHERE "status" = 'PENDING'
  AND "target_type" = 'ADMISSION'
  AND "admission_target_id" IS NOT NULL;

CREATE UNIQUE INDEX "correction_proposals_pending_check_in_field_uq"
ON "correction_proposals" ("organization_id", "check_in_target_id", "field_key")
WHERE "status" = 'PENDING'
  AND "target_type" = 'CHECK_IN'
  AND "check_in_target_id" IS NOT NULL;

CREATE UNIQUE INDEX "correction_proposals_pending_check_out_field_uq"
ON "correction_proposals" ("organization_id", "check_out_target_id", "field_key")
WHERE "status" = 'PENDING'
  AND "target_type" = 'CHECK_OUT'
  AND "check_out_target_id" IS NOT NULL;
```

| Proposed index | Exact duplicate it prevents | Different fields on the same target |
|---|---|---|
| correction_proposals_pending_resident_field_uq | Two PENDING RESIDENT proposals with identical organization_id, resident_target_id and field_key | firstName vs lastName |
| correction_proposals_pending_booking_field_uq | Two PENDING BOOKING proposals with identical organization_id, booking_target_id and field_key | startDate vs endDate vs monthlyPrice |
| correction_proposals_pending_admission_field_uq | Two PENDING ADMISSION proposals with identical organization_id, admission_target_id and field_key | Only admissionDate is allowlisted |
| correction_proposals_pending_check_in_field_uq | Two PENDING CHECK_IN proposals with identical organization_id, check_in_target_id and field_key | Only checkInAt is allowlisted |
| correction_proposals_pending_check_out_field_uq | Two PENDING CHECK_OUT proposals with identical organization_id, check_out_target_id and field_key | checkOutAt vs reason |

For every index, inclusion of field_key allows distinct allowlisted fields to coexist; admission/check-in currently have only one eligible field, so no second different-field proposal exists for those target types. Different target IDs are independent; tenant identity is included even though target UUIDs are globally unique. None of these indexes authorizes a multi-target or multi-field row. Exactly-one-target, type/field checks and non-null scalar fieldKey are complementary constraints, not inferred from uniqueness.

**Predicate choice:** target_type equality is logically redundant when exactly-one-target and matching-type checks hold. It is retained deliberately to make each index's target domain explicit, align query/diagnostic interpretation with the closed target type and match the five typed mappings. It is not a substitute for validation: a malformed row could evade its intended index without the type checks. SQL CHECKs must reject such rows at every status. No new business permission is introduced by the redundant guard.

**Required row constraints:** organizationId, targetType, fieldKey and status are NOT NULL. Exactly one of the five nullable target ids is non-null (`num_nonnulls(resident_target_id, booking_target_id, admission_target_id, check_in_target_id, check_out_target_id) = 1`). A matching-type CHECK requires that the non-null id correspond to targetType. A separate field compatibility CHECK permits precisely RESIDENT(firstName,lastName), BOOKING(startDate,endDate,monthlyPrice), ADMISSION(admissionDate), CHECK_IN(checkInAt), CHECK_OUT(checkOutAt,reason). Closed enums alone do not enforce this cross-field mapping. Checks must be written to reject invalid/null combinations rather than accidentally relying on PostgreSQL CHECK accepting UNKNOWN.

**Slot lifecycle:** a committed transition from PENDING to APPLIED, REJECTED, WITHDRAWN or STALE removes that row from its partial index, freeing only its target/field slot; the proposal and original values remain permanently retained. A rolled-back transition does not free the slot. Concurrent submissions wait/conflict as enforced by PostgreSQL; after a conflicting transaction aborts, another valid submission may succeed. A pending sibling field can still become stale under section 12's dependency checks. Terminal rows cannot become PENDING again, and a new proposal needs a fresh command key; replay of the old key returns the original outcome rather than claiming a new slot.

**Domain error handling:** distinguish a known pending-field index violation (PostgreSQL 23505, or Prisma P2002 with validated index/constraint metadata) from correlation/receipt idempotency uniqueness and unrelated constraints. Check same-key receipt first under command-key serialization; exact replay takes precedence over a pending-field conflict. For different-key same-field collisions, roll back the failed submission transaction (including proposal/audit/receipt), then return HTTP 409 with code PENDING_CONFLICT and safe request context. Do not query inside an already aborted transaction; if a safe post-rollback lookup is needed, keep it tenant-scoped. Do not expose SQL/index names, conflicting values, other actors or database error text to the client. If adapter metadata cannot distinguish the constraint, implementation must resolve using reviewed safe metadata or a tenant-scoped post-rollback lookup; never map every P2002 to PENDING_CONFLICT. Return exact idempotency-conflict semantics for key collisions as section 9 requires.

Prisma's ordinary `@@unique` cannot express these partial predicates; an unconditional unique would incorrectly prevent terminal history and later corrections. Ordinary `@@index` likewise does not encode this partial unique contract. The five definitions belong in a reviewed SQL migration only after implementation authorization. Do not create that migration during this task. Preserve the existing proposed organization/status/recordedAt/id queue index separately; it is not a uniqueness rule.

### Verified target and Finance key mappings

| Existing Prisma model | Verified @@map table | Verified organizationId mapping | Verified key available for direct target FK |
|---|---|---|---|
| Resident | residents | organization_id | [id,organizationId] |
| Booking | bookings | organization_id | [id,organizationId] |
| Admission | admissions | organization_id | [id,organizationId] |
| CheckIn | check_ins | organization_id | [id,organizationId] |
| CheckOut | check_outs | organization_id | id primary key; [id,organizationId] must be added under the proposal |

All five existing ids are physical id columns. Proposed direct target FKs are: (resident_target_id,organization_id) → residents(id,organization_id); (booking_target_id,organization_id) → bookings(id,organization_id); (admission_target_id,organization_id) → admissions(id,organization_id); (check_in_target_id,organization_id) → check_ins(id,organization_id); (check_out_target_id,organization_id) → check_outs(id,organization_id), last only after the proposed CheckOut unique key. Keep one shared correction organization_id and default MATCH SIMPLE with nullable target components, plus exactly-one-target CHECK. Partial indexes do not back these FKs; the referenced target composite unique keys do. Do not declare a new primary key on CheckOut or duplicate ownership.

Invoice maps to invoices and [id,organizationId,residentId] maps to (id,organization_id,resident_id). Correction Finance links must use that existing key. InvoiceAdjustment/PaymentReversal/InvoiceVoid map to invoice_adjustments/payment_reversals/invoice_voids; each has physical id, invoice_id and organization_id, but NOT the proposed three-column operation keys. Their additional [id,invoiceId,organizationId] unique keys and all correction-link mappings remain future reviewed design. No correction-link FK is claimed to exist today.

**Terminal row-shape clarification (proposed, unchanged lifecycle):** PENDING has no decidedBy/decidedAt/decisionReason/appliedAt/appliedValue. APPLIED requires a distinct reviewer, actual decidedAt/appliedAt, decisionReason and an appliedValue envelope; REJECTED/STALE require a distinct recorded decision actor, decidedAt and decisionReason but no appliedAt/appliedValue; WITHDRAWN requires requestedBy as decision actor, decidedAt and reason but no application fields. Nullable corrected values such as checkout reason use a non-SQL-null typed envelope, e.g. a value envelope containing JSON null; SQL null means not applied. Row-local CHECKs validate shapes; a transition trigger enforces only PENDING→terminal and payload/terminal immutability. Role, evidence and tenant authority remain service requirements; the index or User FK cannot approve a correction. STALE audit/receipt commits before its 409 is returned.


On submission the proposal payload is immutable; only the single terminal decision fields may be set. Propose SQL triggers denying deletes, payload rewrites and terminal-to-any updates, with checks against self-review. AuditEvent remains the event history; no claim of tamper-proof storage. AuditEvent application append-only convention does not protect against privileged database administrators. Source mutations and protected-value access require service authorization.

A small CorrectionCommandReceipt table provides decision idempotency: UUID id primary key; organizationId, actorId, key, requestHash, proposalId, action, outcomeCode, recordedAt; unique [organizationId, actorId, key], same-tenant proposal FK. Store outcome references rather than duplicated personal-value responses. Create its row in the decision transaction; same actor/key/payload replays, changed payload returns 409. Submission also writes a command receipt under the shared correction-command key namespace; proposal correlation uniqueness remains a second backstop.

Finance consequence links require a typed CorrectionFinanceLink: one proposal FK, same-tenant invoice FK using residentId, outcome REVIEW_REQUIRED or resolved operation references, a separately recorded approving OWNER and reason when resolved (nullable while REVIEW_REQUIRED). Optional adjustment/payment-reversal/void references must match that invoice and tenant transactionally and through available composite keys. No generic unverified operation id. Preserve link/audit append-only; resolution is an additional link event, never automatic adjustment. Exact migration and Prisma relation code is an independently reviewed P4-2.1 deliverable; none is generated here.

### Critical point 2 — pending-proposal granularity

**Verified:** no current correction proposal table or uniqueness policy exists. v1.0 recommended record-level exclusivity, not an existing implementation.

| Alternative | Conflicts/dependencies and stale behavior | Complexity |
|---|---|---|
| A: one pending per record | Prevents all parallel proposals, including independent first/last name fixes; easy review | Five partial target indexes, simplest but unnecessarily blocks submission |
| B: one pending per field | Prevents competing replacements of the same field; independent proposals can proceed; dependent proposals become stale after an affected sibling change | Five field-inclusive partial indexes plus explicit dependency groups; recommended |
| C: multiple proposals/grouped application | Requires group identity, shared snapshots, explicit approval of all changes, all-or-nothing application and conflict resolution | New group/version semantics; defer |

**Proposed B:** one field per immutable proposal, one pending per target/field. Never auto-merge or auto-rebase. Names compare only their own original scalar plus tenant/id and Resident status, so applying firstName does not stale an unrelated lastName proposal. Booking start/end/monthlyPrice share a dependency group of dates, rent, status, parent ids and relevant admission/stay facts; applying one stales other proposals if any captured dependency changes. Admission and physical event proposals include the authoritative parent chronology. Checkout reason depends on its original reason, parent ids/status and checkout timestamp. Record updatedAt is retained for diagnostics but an unrelated notes update alone must not force STALE or overwrite notes. Read/revalidate interval query results under locks; new dependent rows also invalidate applicability.

Booking example: from [10,20) to [15,18) can proceed as two independently valid, separately approved corrections; after the first, the second proposal must be freshly submitted against changed dependencies. From [10,20) to [25,30) has no valid start-first intermediate, and end-first would lengthen through a prohibited correction path. Do not apply either invalid step or temporarily relax start<end. Route legitimate lengthening through the existing extension command; a genuinely atomic multi-field historical repair is unsupported in v1.2 and requires separate design/authorization. Same rule applies to interdependent admission/check-in changes.

Risk: dependent proposals may require resubmission, but unrelated fields are not blocked at submission and independent name changes can apply without spurious staleness. Owner must approve B, the one-field limit and deferred grouped corrections.

### Critical point 4 — CheckOut tenant-safe reference

**Verified:** CheckOut already has `organizationId String @db.Uuid` mapped to organization_id, an Organization FK, `(checkInId,organizationId)` → CheckIn(id,organizationId), and tenant-scoped Resident/Booking/Bed FKs. Its own `id` is a primary key. `(id,organizationId)` is NOT declared unique. CheckIn, Resident and Booking already expose that composite unique. The existing `(checkInId,organizationId)` unique cannot back an FK referencing `(id,organizationId)`.

| Alternative | Assessment |
|---|---|
| A as phrased: add organizationId and unique | Adding ownership again is invalid and unnecessary; add ONLY the missing composite unique |
| B: derive exclusively through checkIn | Valid tenant lookup through the existing relation, but a correction FK to Checkout.id alone would not enforce equality with correction.organizationId; requires an extra reviewed cross-table constraint/trigger |
| C: use checkInId+organizationId as checkout target | Existing unique can back a valid FK; changes API target identity and target-column meaning for checkout only |

**Recommended:** retain existing organizationId; propose `@@unique([id, organizationId])` on CheckOut and direct composite correction FK. This is a small redundant unique index over a globally unique id that gives a consistent declarative tenant FK. No extra primary key, ownership column or assumed FK. Owner acceptance of this schema direction is required, followed by independent migration/Prisma review after implementation authorization. B/C remain valid alternatives but add semantic inconsistency or enforcement work.

### Relational consistency details

All target FKs use PostgreSQL default MATCH SIMPLE: a nullable target scalar skips that FK while organizationId remains non-null. The exactly-one CHECK is essential. Enumerated field/target checks and state checks must be row-local SQL CHECKs, not subqueries. The eventual Prisma model must use relationMode foreignKeys, named reverse relations and the same shared scalar organizationId; SQL-only partial indexes/checks/triggers need explicit migration review. The index SQL above is a precise documentary proposal conditional on its explicitly proposed mappings, not a migrated or PostgreSQL-validated schema. No complete validated Prisma model is asserted by this document.

Propose additional unique [id,invoiceId,organizationId] keys on InvoiceAdjustment, InvoiceVoid and PaymentReversal if typed Finance resolution links reference them. They are NOT present today. Composite FKs then enforce linked operation/invoice/tenant equality, while Invoice uses its existing [id,organizationId,residentId]. Check reviewer authority in service under trusted session; a database FK to User proves identity only, never OWNER membership. SQL terminal-state checks must distinguish WITHDRAWN (requester allowed) from APPLIED/REJECTED/STALE (different actor); do not apply a blanket decidedBy != requestedBy rule to withdrawal.

Review-required Finance links have nullable resolutionActor/operation references. Append separate resolution records with immutable approved OWNER actor, reason, related invoice and exact operation. Never require an approving OWNER on a review-required link that has not been reviewed. Unique resolution keys prevent duplicate links; contradictory links are rejected. Audit insertion is transactionally coupled to each link action.

## 9. API contracts

Prefix `/api/v1/corrections`. SessionGuard for every route, active-role authorization, OriginGuard and CsrfGuard for every POST. Recheck membership for decision commands. All tenant/actor ids derive from req.auth. Reject unknown body keys, including originalValue, organizationId, requestedBy, approverId, status and client financialImpact. Parent identifiers are looked up server-side. UUID syntax errors are 400; unknown or cross-tenant UUIDs share 404 response shapes. List cannot probe other tenants.

| Method / route | Request | Response |
|---|---|---|
| POST `/` | Idempotency-Key UUID; body below | 201 protected proposal; exact replay 201 same submission result |
| GET `/` | page>=1, limit 1–100, optional status/targetType/targetId/financialImpact; strict validation | 200 {items,total,page,limit}; safe summaries, no original/proposed values |
| GET `/history` | targetType and targetId required, page/limit | 200 paged terminal and pending proposals; validate target ownership first |
| GET `/:id` | UUID | 200 protected detail and permissible actions |
| POST `/:id/approve` | Idempotency-Key; {decisionReason, exceptionRationale?} | 200 APPLIED; no independent approved state |
| POST `/:id/reject` | Idempotency-Key; {reason} | 200 REJECTED |
| POST `/:id/withdraw` | Idempotency-Key; {reason} | 200 WITHDRAWN |

Register `/history` before `/:id`. Decision reasons are trimmed 1–2000 characters; approval reason required for traceability. Exceptional evidence adequacy is confirmed in decisionReason; exceptionRationale additionally mandatory beyond lookback.

```json
{
  "targetType": "BOOKING",
  "targetId": "11111111-1111-4111-8111-111111111111",
  "fieldKey": "monthlyPrice",
  "proposedValue": "8500.00",
  "reason": "Recorded amount differs from agreed term",
  "effectiveAt": "2026-11-01T00:00:00+05:30",
  "evidenceReference": "Restricted agreement register entry 42"
}
```

Optional relatedProposalId plus relationshipKind uses same-tenant checks; REVERSAL must reference an APPLIED correction of the same target/field. The client never chooses the restored value implicitly: submit the explicit requested replacement and capture the current authoritative original.

Detail response: id, targetType/id, fieldKey, typed original/proposed/applied values, status, effectiveAt, recordedAt, requestedAt alias, requester {id,displayName}, reviewer or null, decision/application timestamps and reasons, evidenceReference, financialImpact, exceptionRequired, relatedProposalId, financeReview links and allowedActions. No expectedSnapshot or internal requestHash is exposed. History lists include before/after only through authorized protected detail retrieval; pending values are labelled proposals. Use Cache-Control:no-store for protected detail and history.

Errors `{code,message,requestId,correctionId?}`: 400 INVALID_FIELD/INVALID_VALUE/INVALID_EVIDENCE/UNKNOWN_FIELD; 401 UNAUTHENTICATED; 403 INSUFFICIENT_ROLE/SELF_REVIEW/INVALID_ORIGIN/INVALID_CSRF_TOKEN; 404 NOT_FOUND; 409 STALE_SOURCE/PENDING_CONFLICT/IDEMPOTENCY_CONFLICT/INVALID_STATE/LIFECYCLE_CONFLICT/FINANCE_CONFLICT. Safe retryable lock/serialization failures use 409 RETRY_REQUIRED after rollback; never leak database details. Error payloads/logs exclude protected values.

Command receipt requestHash covers route/action, proposal id, actor, tenant, canonical payload and key. Key namespace is shared across correction command kinds (including submission): reusing a key for a different command is 409, not accidental replay. Use the receipt for submission too, pointing to the new proposal. Proposal correlationId remains its unique submission identifier. Same-key successful mutation or committed STALE replays the original HTTP status and safe result (201 submission, 200 decision, 409 stale); do not re-run source mutation or append audits. Current proposal state is retrieved separately if it later changed. The sole current submission replay convention is exact-status replay (201); the historical replay-200 wording does not apply. Revalidate current authentication, active role and tenant access before replay; replay is not an authorization bypass. Validation/authorization/conflict errors that commit no mutation need not persist a receipt. A timeout with unknown commit outcome must first look up the same key, not generate a new key. Reconstructed responses omit stale action permissions and protected snapshots; clients fetch current detail afterward.

## 10. Finance safeguards and verified operations

Verified in `apps/api/src/finance/finance.service.ts`, `finance.controller.ts`, schema and migration definitions:

| Capability | Existing behavior | P4-2 use |
|---|---|---|
| adjustInvoice | Credit only: negative amount, issued and not cancelled, unsettled balance >0, credit cannot exceed remaining balance; append-only InvoiceAdjustment; updates settlement caches/status | Separate OWNER-approved remedy only |
| reversePayment | Reasoned append-only PaymentReversal; one reversal per payment; invoice lock; refuses cancelled invoice | Separate OWNER-approved remedy; no payment rewrite |
| recordPayment correction | correctsPaymentId links a replacement to an already reversed payment; uniqueness prevents multiple replacements | Separate existing payment workflow, never automatic |
| voidInvoice | Reason; terminal CANCELLED; no applied credits or unreversed cash; InvoiceVoid snapshot and audit; draft may also be voided | Separate approved operation only |
| createDraft and issue | Booking-derived full monthly amount; one active booking/month slot; explicit issue command | Manual replacement composition after eligible void, not dedicated replacement API |
| generateMonthly | Can create drafts or issue explicitly; serialized invoice numbering; separate booking slots | Do not invoke issue=true on correction approval |
| Debit note / write-off / tax correction | No verified dedicated operation | Separately gated; excluded |

`FinanceController` currently accepts both operator roles. Existing Finance operations are not inherently independent-approval workflows. P4-2 must add an OWNER-only, independent decision/link gate for correction-related remedies, enforced even when existing Finance endpoints are called directly with a correction link. Do not globally change unrelated Finance authority without separate scope approval. Amounts come exclusively from FinanceService; no controller/UI arithmetic.

No dedicated draft-recalculation method exists. Future transaction-aware FinanceService helper must accept the caller's transaction and locked facts, assess affected booking/month slots, recompute eligible DRAFT amounts from authoritative policies and audit changes. Genuinely unissued means status DRAFT, issuedAt null and no historical issue/void/payment/credit evidence. CANCELLED issued invoices are never drafts. Legacy invoices without reliable booking linkage require manual review, not guessed allocation. A draft no longer eligible is explicitly invalidated through reviewed Finance rules; proposed default is FinanceService void with linked reason, never silent deletion. Approval must include that draft consequence. No new retrospective invoice is created by approval; missing slots are review-required and handled manually.

Issued identity, original amount, dates and notes are protected by migration `20261103110000_invoice_guard_hardening`. Financial caches/status can legitimately change through existing payment/credit/void commands: immutability does not mean freezing settlement status. P4-2 approval itself never changes an issued invoice. Fully paid invoices cannot receive existing balance-limited credits; do not invent refunds or claim those cases are resolved.

Frozen compatibility: full first-month rent, no proration; separate full invoices for separate bookings in a month; manual overdue review; no automatic overstay billing; existing payment/reversal/adjustment history preserved; no deposit deductions/refunds/settlement; GST/tax unresolved. Preserve booking confirmation/allocation immediately after final atomic availability validation and payment-pending confirmation. Extensions keep the same booking and both existing authorized roles. Admission/check-in/checkout commands retain statuses. Factual checkout overstay remains possible without generating billing.

Draft invalidation means an explicit consequence included in the OWNER approval preview: proposed FinanceService records a draft void with reason and retains its InvoiceVoid history when a corrected booking/stay no longer qualifies. It is not silent deletion. This is unapproved policy detail. If owner declines draft voiding, affected approvals must fail closed until another approved draft policy exists. Recalculation may change a genuine draft amount, never its original identity/number for convenience. Missing or ambiguous historical invoice evidence causes manual review or approval failure, not a guessed draft classification.

An APPLIED factual correction with unresolved issued-invoice remedy is truthful only if the response/history shows `financeReviewStatus: REVIEW_REQUIRED`, linked affected invoices and no claim that money was corrected. APPLIED refers exclusively to the source fact. No pending remedy blocks payment or implies a write-off. Separate OWNER review may conclude no supported remedy; retain that outcome and reason. Positive debit and paid-invoice refunds remain unavailable; a new workflow would need separate policy approval. Do not label a manual createDraft+issue composition as an existing replacement command or assume automatic replacement lineage exists.

## 11. Audit and privacy requirements

Submission, application, rejection, withdrawal and stale decisions write `correction.submitted`, `.applied`, `.rejected`, `.withdrawn`, `.stale` AuditEvents in the same transaction as the state change. Use actual occurredAt; effectiveAt is separately recorded. Events contain organization, actor, proposal id, closed target/field identifiers, correlation/request id and safe decision codes. Free-text reasons, evidence references and original/proposed/applied values remain in protected proposal storage, not general metadata. Finance consequence events link proposal and invoice/operation identifiers without duplicating personal facts. Preserve domain audit events alongside correction events when applying a correction; both must share the transaction.

Indefinite retention of originals and permanent rejected-proposal retention are frozen directions. Withdrawal records, actor identities, reasons, evidence references and exact timestamps also remain available under the proposed policy. Role and organization restrict value access; no secrets, passwords, tokens or document contents. Separate current profile display from retained historical evidence. Production requires privacy/legal validation of personal-value retention, access, backup handling and any legally required erasure/restriction process. Do not claim perpetual personal-data storage is automatically lawful or database storage is tamper-proof.

## 12. Concurrency and transaction protocol

### Critical point 3 — alternatives and recommendation

Verified explicit orders and gaps are in section 3 and the source index. No new protocol described here exists today. v1.0's exclusive organization lock on every ordinary writer would serialize unrelated beds; that is unnecessarily broad.

| Alternative | Safety / trade-off |
|---|---|
| Exclusive organization advisory lock for all operations | Simple cross-domain serialization, but blocks unrelated ordinary check-ins/bookings and billing; reject as default |
| Entity advisory locks by booking/bed/resident | Allows unrelated operations, but monthly discovery, absent invoice slots and shared resident/bed interval checks require several coordinated keys and phantom protection; higher review burden |
| Row locks only | Good existing building blocks, but absent invoices/children and Finance reads before transactions leave gaps; a target-row lock alone is insufficient |
| Hybrid shared/exclusive organization gate plus existing row locks | Ordinary operations share the gate; financially/lifecycle consequential correction application takes it exclusively; modest new protocol, retains safe row ordering; recommend for v1.2 |

**Proposed hybrid:** one transaction-scoped advisory key per organization. Ordinary booking/admission/check-in/checkout writers and Finance source-reading operations acquire a SHARED lock before all existing resource locks. Correction submissions needing coherent lifecycle snapshots acquire SHARED. Applying booking/admission/physical-time corrections acquires EXCLUSIVE before resource locks. Non-financial resident names and checkout reason use target/parent row locks and do not need an exclusive organization gate; they do not change Finance input facts. Reject/withdraw use no lifecycle gate. Database transactions alone enforce shared/exclusive behavior; never use a process-local mutex.

Existing invoice-number advisory lock remains exclusive and separate. Standalone payment/reversal/credit/void operations retain invoice locks and never acquire the lifecycle gate after an invoice lock. Correction-linked Finance resolutions may use command/proposal locks before invoice; no Finance path may then acquire proposal locks in reverse order. A correction's draft-void helper runs within the correction transaction, not the standalone endpoint transaction.

For approximately 100 beds, ordinary operations can overlap; correction transactions briefly stop lifecycle/billing source mutations organization-wide. No measured throughput claim is made. Monthly generation holding SHARED can delay an EXCLUSIVE correction, and an exclusive correction can delay unrelated admissions. Keep transactions free of network/evidence fetching and long UI waits. Load tests must establish latency/lock-wait bounds. If contention is unacceptable, entity-level gates require a separately reviewed design rather than silently removing this gate. Owner must accept this trade-off; acceptance performance results are an implementation exit gate.

### Required lock protocol

1. Authenticate and validate; derive tenant/actor. Serialize correction actor/key (transaction advisory lock); recheck receipt.
2. For decisions, lock the single proposal and verify PENDING and reviewer authority. Never lock another proposal afterward; immutable references can be read without locking it.
3. Acquire SHARED/EXCLUSIVE lifecycle gate as described, before ANY numbering or domain lock. Ordinary operations do this as their first resource lock. No upgrading shared to exclusive: application acquires exclusive directly.
4. If invoice numbering is needed, acquire its existing advisory key. Then take an ordered subset of Bed → Resident → Booking → Admission → CheckIn → CheckOut → Invoice. Sort UUIDs within a table. No acquiring an earlier resource later. Name corrections use Resident only; reason corrections use CheckIn → CheckOut (plus Invoice only if a separate validated review needs it). All probes before locks are routing hints and must be revalidated.
5. Re-read source/parents after locks, compare dependency snapshot, check chronology/overlap, and re-evaluate Finance using the same transaction. Mutable interval facts are stable against other lifecycle writers while exclusive gate is held. Submission may observe a changing child set under SHARED; this is acceptable only as a point-in-time proposal snapshot: read each dependency group in one consistent query/statement, or lock its full relevant chain before capture. Approval always revalidates absence/new child facts.
6. Apply typed field and permitted draft consequences; append audits, links and command receipt; mark APPLIED; commit. On stale, commit STALE/audit/receipt without source mutation and return 409 afterward.

Issue and draft creation must move all authoritative source reads into the gated transaction. Monthly generation acquires SHARED before its numbering key and plans inside that transaction. Issue holds SHARED, locks the authoritative source chain before Invoice, then validates current source eligibility and authoritative draft amount before issuing; if mismatched it fails with a recalculation-required conflict rather than issuing a stale draft. No new rent calculation in a controller. Ordinary lifecycle changes that invalidate drafts must leave drafts unissuable until explicit Finance validation/recalculation; there is no automatic retroactive issuance. Correction EXCLUSIVE cannot overlap these readers; standalone settlement commands serialize on Invoice.

Finance source readers additionally take ordered source row locks before Invoice: Bed → Resident → Booking → Admission → CheckIn → CheckOut for their affected set. Draft creation takes numbering first, then this chain, then creates its invoice. Issue probes invoice/booking only to discover ids, locks the source chain, then locks and revalidates Invoice. Monthly generation discovers candidate booking ids, locks the corresponding source chains in table/UUID order and recomputes its plan after locking; new bookings admitted after the candidate cut are eligible for a later explicit run, not silently billed from an unlocked stale preview. Active-slot indexes remain the final duplicate backstop. No earlier unprotected read supplies an amount written later. This row protocol matters because SHARED source readers can overlap SHARED ordinary writers; the gate alone only excludes correction application. Generation must not acquire an extra Bed after holding any Resident/Booking lock: discover the full candidate set first and restart the whole transaction if a required chain differs. No existing ordinary lifecycle path takes numbering after a source row, so numbering-first Finance paths do not introduce a reverse dependency.

Shared operations still need existing row locks and proper under-lock validation: the shared gate alone does not prevent ordinary Booking and Admission races. Admission create/update must lock Booking before Admission, revalidate booking dates/status under that lock and write audit atomically. Existing booking Bed→Booking and check-in Bed→Resident→Booking→Admission ordering remains compatible. No admission path can hold Admission and later acquire Booking. Standalone checkout remains CheckIn-only under SHARED; correction EXCLUSIVE blocks it, and direct reason correction additionally shares CheckIn lock with it.

### Race-specific behavior

| Race | Required result |
|---|---|
| Booking creation vs correction | SHARED vs EXCLUSIVE gate, then existing Bed availability serialization; correction cannot allocate a different bed |
| Admission update vs check-in | Both SHARED; Booking→Admission compatible ordered locks and under-lock state checks; unique admission/check-in constraints retained |
| Check-in timestamp correction vs checkout | EXCLUSIVE vs SHARED plus CheckIn row; loser revalidates or becomes STALE |
| Correction vs createDraft/monthly generation | Gate excludes source changes during Finance planning; move pre-transaction draft facts inside; absent slots protected by numbering and active-slot unique index |
| Correction vs issue | Gate and Invoice serialize; no stale-source draft issue; already-issued invoice remains unchanged |
| Correction vs payment/reversal/credit/void | Ordered Invoice locks serialize consequence review; no payment path waits back on source/proposal locks; capture latest balance and append-only records |
| Two corrections, approve/reject/withdraw | Proposal locks serialize decisions; EXCLUSIVE gates serialize consequential applications; field dependency changes produce STALE |

### Dependency snapshots and atomicity

Original/proposed values are immutable scalar envelopes. Capture exact PostgreSQL microsecond timestamps as canonical text (not JS millisecond Date alone). Compare the explicit dependency group from section 8, not all updatedAt changes. Preserve updatedAt for diagnostics; no integer entity_version table is required. Financial previews/balances are recalculated under current locks; payment/reversal does not silently change required reviewer role. A changed dependency yields terminal STALE; an invariant conflict without snapshot mismatch returns 409 and rolls back, leaving PENDING. No automatic rebase, invented history or partial mutation.

Audit insert failure, Finance failure, FK/check violation or unexpected exception rolls back source, proposal, draft mutations, links and receipt. Domain/correction/Finance audits all use the caller's transaction. STALE is an explicit successful state transition with an error HTTP outcome, not an exception thrown inside the transaction. Correction approval is never recorded APPLIED if required draft consequences fail. Issued remedies may remain separately REVIEW_REQUIRED, clearly labelled.

Proposed correction transaction bounds: lock_timeout 5 seconds and Prisma maxWait 10 seconds/timeout 30 seconds; do not confuse pool maxWait with PostgreSQL lock_timeout. Existing check-in uses maxWait 10s/timeout 20s; Finance 10s/30s. New lock_timeout must be set transaction-locally. At most two automatic whole-transaction retries for deadlock/serialization (40P01/40001), using bounded jitter and the SAME key. Lock timeout returns retryable 409 after rollback; uncertain commit requires receipt lookup. Recheck authorization after each retry. Preserve existing shorter caller limits rather than extending them implicitly. Operational acceptance must verify these proposed bounds.

### Existing writer/reader modification inventory before enablement

| Path | Required future change |
|---|---|
| BookingService.create/update/extend/cancel | SHARED gate before Bed/Booking; retain final availability and atomic audits; disallow direct corrected-field bypass; cancel delegates update |
| AdmissionService.create/update/cancel including approve/reopen/fallback | SHARED gate; move parent reads/validation into transaction; ordered Booking→Admission; audit atomic with every relevant write |
| CheckInService.create/checkOut | SHARED gate before existing locks; retain unique child records, statuses and transaction audits |
| CheckInService.update notes | Does not change Finance facts except legacy billing fallback uses updatedAt; must audit inventory and guard legacy CHECKED_OUT-without-CheckOut cases so notes cannot move a fallback billing boundary; use SHARED when legacy billing facts can change |
| ResidentService.update/archiveGuarded | Preserve Resident serialization and prevent candidate name direct-write bypass; unrelated profile changes remain routine; archive checks unchanged; no exclusive gate for ordinary resident edits |
| ResidentService.create; EnquiryService conversion creating Resident | Creation remains permitted; cannot masquerade as existing-record correction; verify initial audit/tenant conventions; no new correction gate required for creation-only row |
| FinanceService.createDraft | SHARED gate before numbering; move booking/stay reads and amount calculation into transaction |
| FinanceService.generateMonthly/planMonthly | SHARED before numbering; all authoritative plan reads inside transaction |
| FinanceService.issue | SHARED then ordered source-chain rows before Invoice, current-source eligibility/amount validation; reject stale drafts |
| jobs/invoice-scheduler.service.ts and FinanceController generation entry | All write calls use gated FinanceService; dry-run previews are advisory, never approval evidence |
| FinanceService.recordPayment/reversePayment/adjustInvoice/voidInvoice | Preserve invoice-first settlement protocol; correction-linked OWNER decision and atomic typed links; no reverse acquisition of lifecycle/proposal locks |
| New correction application / draft helper | EXCLUSIVE for consequential facts, typed dispatch, exact snapshot and audit/link/receipt transaction |

This inventory covers application mutation call sites found under apps/api/src excluding generated code. SQL triggers (receipt snapshot, void and tenant integrity) introduce incidental row/FK locks and must be included in PostgreSQL deadlock review. Future writers and maintenance jobs must enter the protocol; enabling correction application before all required paths are reviewed is prohibited. Production DDL/privileged external writes cannot be made safe by application advisory locks alone.



Submission uniqueness follows the five exact indexes in section 8: different-key same-tenant/same-target/same-field concurrent commands cannot both persist PENDING. Locks/preflight reads improve diagnostics but never replace the unique indexes. Different fields may persist independently, then apply only if their dependency snapshots still match; no grouped application is implied. Terminal decisions and their slot removal, audits and command receipts commit atomically. Known uniqueness collisions map to PENDING_CONFLICT only after rollback; exact-key replay remains authoritative.

## 13. Frontend scope

Reuse React/TypeScript, existing operational layout, `apps/web/src/ops/ResidentProfile.tsx`, ops API/route conventions, `useAsync`, `Pager`, `ErrorState`, `EmptyState` and existing styling. Existing finance `CorrectionModals.tsx`/`CorrectionHistory.tsx` describe financial operations; keep their meaning clear alongside the new lifecycle queue.

Add allowlisted request form with entity context, original server value, proposed typed input, effective time, reason, evidence reference and financial/exception classification. Pending queue has paging/status filters, loading/empty/retry states. Protected review shows exact before/after, requester, evidence, effective versus recorded times, financial consequences and reviewer decision. Display allowed actions from server; server remains authoritative. Require reasons for approve/reject/withdraw, retain idempotency keys across network retries and refresh after decisions. Disable duplicate controls while pending; show a recoverable retry if outcome is uncertain.

History on relevant resident/profile views links proposals and related reversals, displays terminal status and reviewer identity, and never presents pending values as current facts. STALE/conflict responses refresh source, explain that a new proposal is required and never silently resubmit with a new original. Issued-invoice warnings identify manual Finance review; no automatic adjustment/refund button. No unrelated redesign, document upload, public self-service or room/bed transfer UI.

## 14. Testing and acceptance evidence

No database or test execution is authorized by this document. Real PostgreSQL tests need separate explicit authorization of a disposable database, with verified isolation from production and existing developer data. Mock tests cannot satisfy concurrency acceptance.

| Level | Required evidence |
|---|---|
| Unit | All nine typed fields and unknown-field refusal; no mass assignment; money bounds; strict invalid dates; UTC/IST host independence; half-open days; instant precision; age 89/90/91 and approval crossing boundary; anchors prevent backdating bypass; evidence categories; financial classification; immutable metadata construction |
| Service | Both submitter roles; full normal/exceptional review matrix; OWNER request reviewed by different PM for non-financial; self reject/approve denial; sole OWNER behavior; revoked roles; original captured server-side; conflicts; snapshot stale; reversal and supersession; permanent rejection/withdrawal; routine update bypass blocked; extension authority unchanged |
| Controller | 400/401/403/404/409 shapes; Origin/CSRF; forged actor/tenant/original/financial flags; cross-tenant target/proposal/evidence/Finance links; query bounds; idempotent retry and mismatched payload; static history route |
| PostgreSQL | Typed tenant FKs, exactly-one target checks, terminal-state checks, partial indexes; complete submission/apply/reject/withdraw transactions; audit failure rollback; source and Finance failure rollback; microsecond stale comparison; no issued identity/amount/date mutation; genuinely unissued recalculation and invalidation; credits/reversals retained |
| Concurrency | Barriers in independent connections for approve/update, approve/reject, approve/withdraw, duplicate submit same/different keys, two corrections same target, booking correction/check-in, admission correction/check-in, check-in correction/checkout, checkout correction/another correction or new stay, financial correction/payment/reversal/void, correction/draft create, correction/monthly scheduler, correction/issue |
| UI/regression | Form types, accessible validation, before/after and pending labels, both roles, errors/loading/empty/retry, retained retry key, stale refresh; existing lifecycle, first-month full rent, two bookings/month, pending-payment booking, extension, occupancy/overstay/manual overdue rules |

Race tests assert final durable rows, audit count and values, winning/losing response, absence of partial side effects and bounded lock completion. Test both winning orders, not merely concurrent HTTP calls. Integration tests must exercise actual guards/services/triggers and scheduler paths. Do not infer deployed protection from migration text alone. Acceptance evidence names source revision plus working-tree baseline, DB version/schema, commands and isolated test results without credentials.

v1.1 additions: two independent name-field proposals can apply without staling each other; same-field concurrent proposals fail uniqueness; related booking-field proposals become STALE; no invalid start/end intermediate applies; old anchor plus recent effectiveAt still exceptional; future booking dates do not become physical instants; self-withdraw permitted while self-review denied; exact 201/200/409 replay and cross-command key collision; revoked-role replay denial; CheckOut composite FK rejects cross-tenant reference; review-required Finance links need no invented approver; typed resolution rejects a different invoice's operation. Exercise hybrid gate SHARED/SHARED overlap, EXCLUSIVE exclusion, no lock upgrade, scheduler/issue races, lock timeouts, retry limits and 100-bed contention with durable assertions. Legacy missing-checkout billing fallback and notes updates must not fabricate occupancy or issue new charges.



V1.2 planned acceptance (not executed): inspect the created catalog definitions for all five named indexes against section 8, including exact ordered keys, unique flag and all three predicate terms. For each target type, two distinct keys competing for the same field must yield one durable proposal and one safe 409 PENDING_CONFLICT, with no losing audit/receipt. Verify distinct eligible fields coexist for Resident/Booking/CheckOut; do not fabricate a second allowlisted Admission/CheckIn field. Each terminal status frees its field slot only after commit while history remains; rollback preserves the slot. Reject two-target, zero-target, wrong-type, wrong-field and null-field rows even when they would evade an index predicate. Verify same-key retry returns the prior result without new rows before conflict classification, idempotency-key mismatch does not become PENDING_CONFLICT, and tenant FK violations do not leak target existence. Exercise CheckOut only after its reviewed referenced unique is present; Finance operation links must fail closed without their proposed referenced keys. These checks require the separately authorized disposable PostgreSQL database during implementation acceptance.

## 15. Implementation slices P4-2.0 through P4-2.6

All paths below are likely future edits; no implementation is authorized. Each slice excludes transfers, KYC/uploads, settlement/refunds, public booking, new contracts/tax/debit-note policy and unrelated redesign.

| Slice | Scope and dependencies | Likely files | Tests / acceptance and specific exclusions |
|---|---|---|---|
| P4-2.0 | Approve candidate policy and this specification; depends on inspected P4.1 baseline | This document | Completed signed register; separate implementation authorization still required; no schema/code/DB changes |
| P4-2.1 | Closed domain contracts, typed FKs, SQL checks/partial indexes/immutability, snapshots, idempotency and Finance links; depends on policy freeze and implementation authorization | prisma/schema.prisma; new reviewed migration; new apps/api/src/corrections contracts/rules | Independent schema review, valid Prisma relations and PostgreSQL checks; no generic event store or entity_version table; generated client only when subsequently authorized |
| P4-2.2 | Submit/list/detail/history/reject/withdraw, role and idempotency enforcement | new corrections module/controller/service/input; app.module.ts; existing auth integration | Unit/service/controller tests; tenant isolation, conflict retention, exact replay; apply endpoint not enabled before next slices |
| P4-2.3 | Source lock protocol, stale outcome, atomic typed apply, ordinary-route bypass prevention | corrections service; booking/admission/checkin/resident services and controllers; common helpers | Authorized PG races and audit rollback; original/applied values durable; no permission/status changes outside defined boundary; depends on P4-2.1/2 and joint P4-2.4 review |
| P4-2.4 | Transaction-aware Finance recalculation/validation, all billing reader gates, explicit remedy authorization/links | finance.service.ts/controller/module; scheduler callers; corrections Finance link adapter; migrations only if reviewed | Issued facts unchanged; unissued freshness; issue/create/scheduler/payment/reversal races; existing credit/void limits; no auto adjustment/issue/refund or new debit semantics; financial application cannot ship before this slice |
| P4-2.5 | Request/queue/review/withdraw/history and Finance warnings | ops/ResidentProfile.tsx; opsApi.ts; opsRoute.ts; App.tsx; new corrections components; existing CSS/shared components | Component/UI flows and both roles; full pending/stale/error states; depends on stable API and safeguards |
| P4-2.6 | Independent acceptance against frozen rules and approved policy | apps/api/test and integration suites; apps/web tests; acceptance evidence document | Full relevant regression and authorized disposable PG concurrency evidence; privacy/legal production gate tracked; no release or deployment inferred |

P4-2.1 must review the exact proposed mappings and all five named partial unique definitions in section 8, their supporting CHECKs/target keys and their source-versus-proposal labels. P4-2.2 must distinguish known pending-field collisions from command-key conflicts; P4-2.6 must accept the section 14 per-index evidence. These are documentation clarifications of existing slice responsibilities.

P4-2.3 and P4-2.4 must be reviewed together before any financial field is enabled. “Independent” means a separate review/acceptance gate; this documentation task does not authorize launching agents or reviewers. Migration application, CI/migration manifest edits, generation, deployment and Git publication need their own authorized execution scope.

## 16. Outstanding owner approval register

All ten frozen decisions in section 2 remain approved. Every checkbox below is still open; recommendations are not policy approvals.

| Decision | Proposed recommendation requiring explicit owner sign-off | Consequence |
|---|---|---|
| [ ] Exact allowlist | Nine fields and constraints in section 4; no end-date lengthening bypass; all post-creation candidate edits consequential | Typed dispatch and ordinary API restrictions |
| [ ] Roles and classifications | Section 5 matrix; PM may review another OWNER's normal non-financial request; all booking/admission/physical-time fields OWNER-reviewed; OWNER-only financial rejection too | Active role/separation gates; no self-review |
| [ ] Normal history | 90 IST calendar days inclusive, exact anchors/minimum-day formula, recalculate at approval | Boundary crossing becomes exceptional; conservative old-resident name review |
| [ ] Exceptions and evidence | Older cases require independent OWNER, evidence and rationale; not a third approver; historical financial/occupancy and all price evidence mandatory | No unrestricted normal backdating; insufficient evidence rejected |
| [ ] Pending granularity | B: one pending per target field (five explicit proposed indexes in section 8), explicit dependency snapshots; one field per proposal; no atomic groups | Independent names coexist; dependent booking repairs may need resubmission or separate design |
| [ ] Lock strategy | Hybrid shared ordinary/exclusive correction organization gate plus ordered row locks | Ordinary operations overlap; consequential corrections briefly block hostel lifecycle/billing; performance acceptance required |
| [ ] CheckOut reference | Add only missing [id,organizationId] unique; use existing ownership column | Declarative tenant FK; independent schema review required |
| [ ] Finance remedies | Verified existing credit/reversal/replacement-payment/void operations only; correction-linked independent OWNER gate; manual invoice replacement composition | No debit/write-off/tax/refund capability inferred |
| [ ] Draft consequences | Finance-only recalculation; explicit void/invalidation of no-longer-eligible genuine draft included in OWNER decision | No deletion, no automatic issue or new retrospective invoices; fail closed without approved policy |
| [ ] Unresolved issued remedy | Factual APPLIED may coexist with visible REVIEW_REQUIRED and separate OWNER resolution | No false claim of financial completion; no automatic adjustment |
| [ ] Withdrawal and reversal | Requester-only pending withdrawal with reason and permanent retention; reversal through new proposal under all current constraints | No silent cancellation/deletion/privileged undo |
| [ ] Sole OWNER | Different PM for normal non-financial; different OWNER for financial/exceptional | No eligible reviewer means pending, no self-approval exception |
| [ ] Contact exclusion | Phone/email outside P4-2 until verification workflow | Existing contact policy not silently replaced |
| [ ] Retention details | Original/rejected retention frozen; protected values and permanent withdrawal/review history; minimize general audit | Role/tenant restriction; no unsupported tamper-proof claims |
| [ ] Routine/commercial boundary | Routine non-candidate edits retain policy; candidate post-creation fixes require correction; extensions stay existing commands; negotiated rent excluded | No generic correction bypass or scope expansion |
| [ ] Retry/status contract | Terminal STALE; exact idempotent status replay; 5s lock timeout and bounded retries | New request needed after stale; no duplicate audit/application |

**Production requirement, not policy approval:** privacy/legal review must validate indefinite personal-value/evidence retention and required restriction/erasure handling before production. This task does not provide or complete that review.

Owner name: ____________________  Date: ____________________
Approved rows / amendments: __________________________________________

Implementation authorization and disposable PostgreSQL authorization remain separate, ungranted gates.

## 17. Implementation authorization requirements

Owner approval must explicitly accept or amend section 16. No checkboxes have been marked approved by this review. Any amendment affecting validation, permissions, retention, state transitions or Finance consequences must be reconciled across the specification before implementation scope is granted.

After policy approval, implementation authorization must identify permitted slices, workspace/branch, code/schema/migration/generation scope and required independent reviews. Real PostgreSQL execution requires a separately and explicitly authorized disposable database; no existing/production database access is implied. Migration application, deployment, CI changes and Git publication are not authorized by specification approval. P4-2.1 schema review and joint P4-2.3/4 transaction review are technical gates. P4-2.6 requires actual regression/concurrency evidence. Production requires privacy/legal approval.

No source, Prisma schema, migrations, CI, marketing assets, original nook workspace, credentials or Git mutations are part of this task. Only this v1.2 document is the deliverable; v1.0 and v1.1 are preserved. Implementation, P4-3/P4-4/P4-5 and database tests remain unauthorized.

### Source index and technical review disposition

- `prisma/schema.prisma`: actual targets, tenant keys, time/money types, AuditEvent and Finance models.
- `apps/api/src/booking/booking.service.ts` create/update/extend; `booking.input.ts`, `booking.rules.ts`: atomic bed checks, prohibited direct lengthening, rent bounds, IST intervals.
- `apps/api/src/admission/admission.service.ts` create/update: parent validation and existing partial transactional audit coverage; `admission.input.ts`.
- `apps/api/src/checkin/checkin.service.ts` create/checkOut; `checkin.rules.ts`: observed lock order, occupancy and chronology.
- `apps/api/src/resident/resident.service.ts`, `resident.fields.ts`: current ordinary edit allowlist and archive protection.
- `apps/api/src/common/time.ts`: date/instant semantics; new correction parser must add strict calendar checks and explicit zones.
- `apps/api/src/finance/finance.service.ts` createDraft/issue/generateMonthly/recordPayment/reversePayment/adjustInvoice/voidInvoice; `finance.controller.ts`: verified Finance behavior and role gap.
- `prisma/migrations/20261101170000_add_financial_corrections/migration.sql`, `20261103090000_payment_receipt_snapshot`, `20261103100000_invoice_void_record`, `20261103110000_invoice_guard_hardening`, `20261103130000_invoice_active_uniqueness`: repository financial safeguards; latter four directory names refer to their migration.sql files.
- `apps/api/src/auth/auth.guards.ts`: session, active role, Origin and CSRF patterns.
- `apps/web/src/ops/ResidentProfile.tsx` and finance shared components: established UI patterns.

Compatibility findings are source inspection, not claims of passing runtime tests. No external legal advice or tax assumptions were used. The proposed cross-domain protocol and migration must receive independent implementation review and real concurrency verification before acceptance.

The review resolves the four design concerns at proposal level: CheckOut ownership verified; composite unique accurately identified as new; field-level conflicts bounded by explicit dependency groups; hybrid gate distinguished from existing locks; historical anchors and future facts defined. It also closes self-withdrawal CHECK conflicts, exact stale replay, cross-command idempotency, pending Finance approver nullability and operation-link FK assumptions. Planned schema/compiler/concurrency checks remain implementation validation, not falsely reported successes. No observed code is represented as already satisfying the new safeguards. The shared-gate design also explicitly locks Finance source chains so ordinary SHARED writers cannot race source-derived amounts.

The correction model/enum physical mappings remain explicitly proposed assumptions for P4-2.1 review; none could be verified as an existing source definition. All section 16 owner decisions remain open and implementation authorization remains ungranted. No additional material policy/design contradiction was identified by this documentation pass; future schema and concurrency validation are still required.

The verdict below means this internally consistent proposal can be reviewed and approved by the owner; it does not mean the owner has approved it or that implementation may start.

READY FOR OWNER APPROVAL
