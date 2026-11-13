# NOOK — P4-2 Specification v1.0

**Final for owner approval — implementation authorization NOT GRANTED**

Workspace inspected: `~/Downloads/nook-phase4-1`  
Branch verified: `feature/phase-4-1-lifecycle-audit`  
Inspection date: 2026-11-08  
HEAD: `908098acd567c299ad05529b5a533ad17622dceb`

## 1. Executive summary

P4-2 introduces controlled, allowlisted corrections of resident and lifecycle facts. A protected proposal preserves the original fact, proposed replacement, evidence reference, requester, reviewer, reasons and effective/recorded times. Approval and application are one transaction. Issued invoice facts are preserved; any financial remedy is a separate, explicitly approved Finance operation.

This document is a complete proposal for owner review, not a record of new policy approval. **Frozen** means supplied owner direction; **Verified** means observed source behavior; **Proposed** means a recommendation requiring sign-off. Approval of this document freezes its proposed policy only when the owner explicitly accepts the register in section 16. Implementation requires a separate authorization afterward. Production additionally requires privacy/legal review and accepted PostgreSQL evidence.

Inspection used the current working tree, which contains existing modified and untracked Phase 4.1 files. Those files were read as the compatibility baseline; HEAD alone does not reproduce that baseline. No database was contacted, and schema/trigger observations describe repository definitions, not deployed state. No tests were executed during this documentation task.

## 2. Frozen owner decisions

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

## 3. Proposed policy recommendations

All recommendations in this section require explicit owner approval.

### 3.1 Historical window and evidence

Normal review permits a maximum age of **90 Asia/Kolkata calendar days**, inclusive. Measure age at submission using the oldest of: effective day, original and proposed date-field days, and the affected fact's historical anchor. The anchor is resident creation for name errors, booking start for price errors, and original checkout time for checkout reason errors. This conservative definition prevents a recent effectiveAt from concealing an old fact. A future booking/admission date is allowed; effectiveAt cannot be future because P4-2 applies corrections immediately, not scheduled changes. Future physical check-in/out instants are prohibited.

At approval, recompute age using the current date. Crossing day 90 requires exceptional review even if submission was normal. Exceptional review is a different OWNER from the requester, mandatory evidence and an explicit exception rationale in the approval command. This is one exceptional OWNER decision, not an invented third approver. No automatic age bypass; the queue clearly marks the exception. There is no automatic maximum beyond 90 days: older requests are permitted only through this explicit exceptional route, with the same integrity checks. Owner sign-off must expressly accept that exception policy.

Evidence is mandatory for every historical financial or occupancy correction, every exceptional correction and every monthlyPrice correction (the agreed term must be demonstrated). Other name/reason corrections within the normal window require a detailed reason; evidence is optional. Store a restricted reference or description (1–2000 characters), never document bytes or an unrestricted external URL containing credentials. Evidence has no automatic truth status. Reviewer must attest adequacy. Conflicting or insufficient evidence results in rejection with explanation; the immutable proposal cannot be patched. Submit a new proposal with better evidence, linked to the old one.

Completed stays remain correctable. Correcting timestamps cannot reopen a stay or release/reassign a bed. Validate the entire physical interval against other recorded stays for the same bed and resident, including completed stays and current occupancy. Reject contradictory chronology or missing authoritative parent history; do not fabricate a checkout from updatedAt. Booking intervals remain half-open IST days; physical checkout may occur beyond the booking end because overstay is a valid fact. Historical approval never authorizes overstay charges, penalties or refunds.

Previously billed periods require Finance classification and a comparison of affected invoice slots. Issued invoice facts remain untouched regardless of payment state. A factual correction can apply while a separately recorded Finance review remains unresolved; this must be visible. It cannot trigger retrospective invoice issuance, credit, refund or replacement. If safe draft recalculation cannot be completed, fail approval atomically.

### 3.2 Routine edits and consequential boundary

All nine allowlisted fields in section 5 are consequential once their record exists and must use P4-2. Creation still uses existing commands. Proposed integration removes direct post-creation writes to these fields from ordinary PATCH routes, with a clear correction-required response, so approval cannot be bypassed. Booking extensions remain an explicitly authorized domain command updating the same booking, under existing OWNER/PROPERTY_MANAGER authority. A mistaken end date may be shortened through correction; **lengthening still uses the existing extension command**, preserving its reason and audit requirements. P4-2 does not become an alternative extension path.

Ordinary address, emergency contact, notes and other already permitted non-allowlisted profile updates retain existing permissions and validation; P4-2 adds no new permission to edit them. Existing phone/email update behavior is not redefined here: exclusion means no correction endpoint support, and no claim that existing contact edits are verified. Existing status transitions remain domain commands. Commercial rent renegotiation requires a separate rental-term workflow; evidence of an original agreement is mandatory to correct monthlyPrice.

### 3.3 Withdrawal and reversal

Requester OWNER or PROPERTY_MANAGER may withdraw their own PENDING proposal with a reason. Other operators cannot withdraw it. Rejection is a reviewer action. No deletion or editing of submitted proposals is permitted. An applied correction is reversed only by a new proposal referencing the applied proposal, capturing the current source value and following all current rules. The original is never changed to cancelled. Permanent retention extends to withdrawals. Use status WITHDRAWN rather than ambiguous CANCELLED; no separate cancellation command.

## 4. Outstanding approval decisions and authority

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

## 5. Detailed candidate correction allowlist

**Every row requires owner sign-off.** Submitters are OWNER/PROPERTY_MANAGER; review uses section 4. Classification is server-computed and conservative: all booking financial terms and physical occupancy timestamps require OWNER even when a preview finds zero monetary difference. Historical admission dates also use OWNER as potentially finance-related chronology; the candidate admissionDate is classified financial for all requests to avoid role changes during review. Names and checkout reason are non-financial unless exceptional age requires OWNER.

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

No-op replacements are 400. Validate both at submission and approval. One field per proposal; no implicit sibling updates. Dependent changes needing simultaneous multi-field application are excluded from v1; reject intermediate invalid states and explain that a separately designed grouped workflow is required.

Mandatory envelope: correction reason trimmed 1–2000 characters; effectiveAt zoned RFC3339 <= now; request key UUID; evidence as above. Date corrections store the calendar day as the established UTC-midnight representation (booking.rules.ts), not a host-local Date. effectiveAt expresses when the corrected fact applies, not when the reviewer acted; it need not equal the corrected event instant. Original timestamp bytes are retained alongside normalized API values to avoid losing microseconds. Physical instants render in Asia/Kolkata. Strict calendar round-trip validation rejects overflow dates; do not rely on JavaScript Date normalization.

Excluded: phone/email; organization/membership/ownership; property/room/bed and assignments; every workflow/payment/invoice status; payment records; invoice fields; deposits/refunds/settlement; credentials; documents/verification; arbitrary JSON paths. No mass assignment. No KYC gate or uploads.

## 6. Lifecycle and state transitions

Statuses: PENDING, APPLIED, REJECTED, WITHDRAWN, STALE. There is no APPROVED-but-unapplied state.

| From | To | Authority / effect |
|---|---|---|
| none | PENDING | Eligible submitter; target/value snapshot plus submission audit in one transaction |
| PENDING | APPLIED | Independent eligible reviewer; complete application plus audit atomically |
| PENDING | REJECTED | Independent eligible reviewer; mandatory rejection reason; source unchanged |
| PENDING | WITHDRAWN | Requester only; mandatory withdrawal reason; source unchanged |
| PENDING | STALE | Authorized approval attempt detects changed source snapshot; commit stale decision and audit, no source change |
| any terminal | any | Forbidden; exact idempotent replay returns prior result |

For STALE return 409 only after successfully committing the STALE transition; do not throw inside the transaction and accidentally roll it back. Validation, Finance, constraint and infrastructure failures roll back all approval effects and leave PENDING (unless stale was the explicit committed outcome). A business conflict is not silently converted to rejection. Reversal is a new PENDING record, not a transition of the original. Rejected/stale/withdrawn requests may be superseded by linked new requests; no mutation of old evidence.

## 7. Data model and architecture

### 7.1 Verified baseline

`prisma/schema.prisma` uses PostgreSQL UUID ids, snake-case maps, Restrict relations, Timestamptz(6), Decimal money and composite tenant references. Resident, Booking, Admission and CheckIn expose unique [id, organizationId]. CheckOut has an id primary key but lacks that composite unique. Every candidate source has updatedAt; none has an integer version. AuditEvent has actor, nullable organization, target, requestId, occurredAt and JSON metadata. Invoice has no separate line-item model in this schema. Do not invent line-item snapshots.

### 7.2 Smallest safe proposal

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

SQL-only checks enforce exactly one target (`num_nonnulls(resident_target_id, booking_target_id, admission_target_id, check_in_target_id, check_out_target_id) = 1`), target/field compatibility and terminal timestamp shapes. Each typed target gets a partial unique index on `(organization_id, target_column)` WHERE status='PENDING' AND target_column IS NOT NULL. This deliberately permits only one pending correction per target record, not merely per field. Prisma @@index cannot represent these predicates; keep reviewed SQL alongside the eventual migration. Index organization/status/recordedAt/id for queue pagination.

On submission the proposal payload is immutable; only the single terminal decision fields may be set. Propose SQL triggers denying deletes, payload rewrites and terminal-to-any updates, with checks against self-review. AuditEvent remains the event history; no claim of tamper-proof storage. AuditEvent application append-only convention does not protect against privileged database administrators. Source mutations and protected-value access require service authorization.

A small CorrectionCommandReceipt table provides decision idempotency: UUID id primary key; organizationId, actorId, key, requestHash, proposalId, action, outcomeCode, recordedAt; unique [organizationId, actorId, key], same-tenant proposal FK. Store outcome references rather than duplicated personal-value responses. Create its row in the decision transaction; same actor/key/payload replays, changed payload returns 409. Submission reuses proposal correlation uniqueness.

Finance consequence links require a typed CorrectionFinanceLink: one proposal FK, same-tenant invoice FK using residentId, outcome REVIEW_REQUIRED or resolved operation references, separate approving OWNER and reason. Optional adjustment/payment-reversal/void references must match that invoice and tenant transactionally and through available composite keys. No generic unverified operation id. Preserve link/audit append-only; resolution is an additional link event, never automatic adjustment. Exact migration and Prisma relation code is an independently reviewed P4-2.1 deliverable; none is generated here.

## 8. API contracts

Prefix `/api/v1/corrections`. SessionGuard for every route, active-role authorization, OriginGuard and CsrfGuard for every POST. Recheck membership for decision commands. All tenant/actor ids derive from req.auth. Reject unknown body keys, including originalValue, organizationId, requestedBy, approverId, status and client financialImpact. Parent identifiers are looked up server-side. UUID syntax errors are 400; unknown or cross-tenant UUIDs share 404 response shapes. List cannot probe other tenants.

| Method / route | Request | Response |
|---|---|---|
| POST `/` | Idempotency-Key UUID; body below | 201 protected proposal; replay 200 same proposal |
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

## 9. Finance integrity and verified capabilities

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

## 10. Audit and privacy

Submission, application, rejection, withdrawal and stale decisions write `correction.submitted`, `.applied`, `.rejected`, `.withdrawn`, `.stale` AuditEvents in the same transaction as the state change. Use actual occurredAt; effectiveAt is separately recorded. Events contain organization, actor, proposal id, closed target/field identifiers, correlation/request id and safe decision codes. Free-text reasons, evidence references and original/proposed/applied values remain in protected proposal storage, not general metadata. Finance consequence events link proposal and invoice/operation identifiers without duplicating personal facts. Preserve domain audit events alongside correction events when applying a correction; both must share the transaction.

Indefinite retention of originals and permanent rejected-proposal retention are frozen directions. Withdrawal records, actor identities, reasons, evidence references and exact timestamps also remain available under the proposed policy. Role and organization restrict value access; no secrets, passwords, tokens or document contents. Separate current profile display from retained historical evidence. Production requires privacy/legal validation of personal-value retention, access, backup handling and any legally required erasure/restriction process. Do not claim perpetual personal-data storage is automatically lawful or database storage is tamper-proof.

## 11. Concurrency and transaction strategy

### 11.1 Verified source ordering and gaps

| Existing path | Observed explicit locks / gap |
|---|---|
| Booking create | Bed first, final overlap/usability read under bed lock; insert and audit in transaction |
| Booking update/extend | Bed then Booking; re-read; ordinary update prohibits end-date lengthening |
| Check-in create | Bed → Resident → Booking → Admission; check-in unique admission constraint |
| Checkout | CheckIn lock, re-read, create unique CheckOut and update CheckIn in transaction |
| Admission status changes | Admission lock for approve/cancel/reopen; ordinary date update validates against pre-transaction booking and may write audit separately |
| Resident update/archive | Ordinary update writes row; archive uses resident write lock and active-stay guard |
| Finance draft creation | Booking/stay facts read before transaction; transaction locks organization invoice-number advisory key |
| Monthly generation | Invoice-number advisory lock, then computes plan/inserts |
| Issue | Invoice lock; does not revalidate corrected source amounts |
| Payment | Payment idempotency advisory lock → Invoice lock |
| Reversal/credit/void | Invoice lock; reversal initially probes payment; receipt and void triggers also lock invoice |

Source comments do not establish a global cross-domain order. Current Finance paths do not share an occupancy lock with lifecycle writers. Therefore merely adding a correction lock is insufficient. These are required integration changes in later authorized slices, not changes performed now.

### 11.2 Proposed coordinated order

Use a new organization-scoped lifecycle-billing advisory transaction lock for **all lifecycle mutations that can change billing facts and all Finance source-reading creation/issue/recalculation paths**, before any existing row/numbering lock. This is intentionally coarse for v1 safety and must be reviewed for latency. No path may acquire it after holding an invoice/numbering/bed lock. Standalone payment/reversal/credit/void paths retain invoice-only ordering and must not later acquire lifecycle locks. They cannot form a cycle because they never wait back on a correction-held source resource.

Correction command order: actor/key advisory lock → proposal row (existing proposal only) → lifecycle-billing gate if required → existing invoice-number gate if needed → Bed → Resident → Booking → Admission → CheckIn → CheckOut → affected Invoice rows sorted UUID. Take an ordered subset only; never acquire a parent later. Resident-name corrections require only resident target lock, with no later bed lock. Rejection/withdrawal require only command key/proposal locks. New submission has no existing proposal lock; serialize correlation key, take target locks as necessary and use the partial unique index as conflict backstop. Related proposal reads never lock a second proposal in reverse order; relationship evidence is immutable.

This is a proposed extension derived from the verified ordering, not a claim the existing system already follows it. Every writer of affected source fields must be inventoried and brought into the order before enablement, including admission creation/date updates, direct check-in edits, checkout, billing scheduler, draft creation, monthly generation and issue. No arbitrary whole-organization row scan for locks; determine impacted records, re-read under the gate, then lock stable sorted identifiers. Invoice-only standalone operations may run concurrently and serialize on affected invoice locks.

Draft creation must move source reads inside its gated transaction; otherwise a stale pre-transaction price could be inserted after correction. Issue must also hold the gate and validate draft freshness before issue; existing stale drafts cannot be issued while correction recalculates. A no-longer-eligible draft requires the explicit Finance invalidation policy in section 9. No nested transaction, no second Prisma client during application. TX_OPTIONS/timeouts and retry mapping must use established conventions; review SQL triggers' incidental FK locks during integration tests.

### 11.3 Snapshot and approval algorithm

Use source exact updatedAt plus canonical original value and relevant business facts; no new global version table. Capture PostgreSQL microsecond text inside the transaction (JS Date loses precision), and compare the same representation after lock. Include statuses/parent ids/date/rent facts required by the validator; revalidate newly created children and interval overlaps rather than trusting captured child absence. All supported writers must update updatedAt consistently. A changed target row is conservatively stale even if the chosen field is unchanged. Related financial changes may only require a fresh impact preview, not automatic stale, but cannot reduce required reviewer authority.

1. Authenticate; derive tenant/actor and validate strict command.
2. Serialize actor/key; replay prior successful identical command or 409 changed payload.
3. Lock proposal; verify tenant, PENDING and role, self-review prohibition and exceptional policy.
4. Acquire relevant ordered locks, re-read authoritative source and parent chain.
5. If snapshot differs, commit STALE plus audit and idempotency outcome; return 409 after commit.
6. Revalidate allowlist, evidence, age, chronology, availability and Finance impact under locks. An insufficient role cannot be cured by a zero-delta calculation.
7. Apply exactly one field via explicit typed dispatch; run transaction-aware Finance draft consequences. Persist protected appliedValue equal to actual normalized source value.
8. Write domain/correction/Finance audits and review-required links, set APPLIED and actual decision/application timestamps, persist command receipt, commit.

Any failed mutation, audit or Finance helper rolls everything back. Lock timeouts/serialization errors receive bounded whole-command retries with the same idempotency key, never partial retries. Duplicate submissions with the same key/payload return the same proposal; new key for same pending target returns 409. Approve/reject/withdraw races serialize on proposal: one terminal action wins. Concurrent ordinary update/correction serializes on target; if ordinary update won first, stale is detected. If correction won first, later prohibited allowlist edits are refused by ordinary API boundary rules. Checkout and check-in timestamp correction share CheckIn lock; historical checkout correction also holds parent Bed/Resident locks to protect interval queries against new occupancy. Every newly introduced writer must obey this protocol.

## 12. Frontend scope

Reuse React/TypeScript, existing operational layout, `apps/web/src/ops/ResidentProfile.tsx`, ops API/route conventions, `useAsync`, `Pager`, `ErrorState`, `EmptyState` and existing styling. Existing finance `CorrectionModals.tsx`/`CorrectionHistory.tsx` describe financial operations; keep their meaning clear alongside the new lifecycle queue.

Add allowlisted request form with entity context, original server value, proposed typed input, effective time, reason, evidence reference and financial/exception classification. Pending queue has paging/status filters, loading/empty/retry states. Protected review shows exact before/after, requester, evidence, effective versus recorded times, financial consequences and reviewer decision. Display allowed actions from server; server remains authoritative. Require reasons for approve/reject/withdraw, retain idempotency keys across network retries and refresh after decisions. Disable duplicate controls while pending; show a recoverable retry if outcome is uncertain.

History on relevant resident/profile views links proposals and related reversals, displays terminal status and reviewer identity, and never presents pending values as current facts. STALE/conflict responses refresh source, explain that a new proposal is required and never silently resubmit with a new original. Issued-invoice warnings identify manual Finance review; no automatic adjustment/refund button. No unrelated redesign, document upload, public self-service or room/bed transfer UI.

## 13. Test strategy

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

## 14. Implementation slices

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

P4-2.3 and P4-2.4 must be reviewed together before any financial field is enabled. “Independent” means a separate review/acceptance gate; this documentation task does not authorize launching agents or reviewers. Migration application, CI/migration manifest edits, generation, deployment and Git publication need their own authorized execution scope.

## 15. Verified source reference index and limitations

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

## 16. Final owner approval register and checklist

Every row distinguishes frozen direction from additional proposed detail. A checkmark requires an actual owner decision; none is pre-approved by inclusion here. Amendments must be recorded in this register before scope freeze.

| # | Previously approved | Proposed recommendation | Explicit owner approval required | Technical consequence |
|---|---|---|---|---|
| 1 | Allowlist only | All nine fields, types and constraints in section 5; no end-date lengthening through correction | [ ] Exact list and constraints | Closed enums, typed dispatch; post-creation ordinary edit bypass removed |
| 2 | Consequential approval, no self-approval; OWNER financial approval | Section 4 full matrix, including PM review of another OWNER's normal non-financial request; admissionDate classified financial | [ ] Full matrix and classification | Explicit service role gates, no inferred hierarchy |
| 3 | Controlled historical corrections | 90 IST calendar days inclusive; oldest-day/anchor measurement, recomputed at approval | [ ] Limit and calculation | Reliable backdating checks without recent-date bypass |
| 4 | Reason and approval for history | Older facts require independent OWNER exception plus evidence/rationale; financial/occupancy history and price evidence mandatory | [ ] Exceptional route, evidence rules and completed-stay treatment | No unrestricted normal backdating; evidence adequacy review; no fabricated chronology |
| 5 | Issued facts immutable; separate approved remedies | Reuse verified balance-limited credit, payment reversal/replacement and guarded void; manual invoice replacement composition; correction-linked OWNER gate; draft recalculation/invalidation under Finance | [ ] Remedy scope and draft invalidation policy | New transaction-aware Finance helper; explicit links; no new debit/write-off/tax capability |
| 6 | Rejected retention | Requester-only pending withdrawal with reason; WITHDRAWN terminal; applied reversal via linked new proposal | [ ] Withdrawal/permanent retention and reversal rules | No generic cancellation/delete; command idempotency |
| 7 | Self-approval forbidden | Different PM can review sole OWNER normal non-financial request; different OWNER required financial/exceptional | [ ] Role availability behavior | Requests remain pending if no eligible reviewer |
| 8 | Allowlist only | Phone/email excluded pending separate verification design | [ ] Explicit contact exclusion | No contact corrections through P4-2; existing edits not falsely labelled verified |
| 9 | Permanent rejected/original retention subject to law | Protected personal-value storage; indefinite withdrawal/history retention; privacy/legal production review | [ ] Additional retention details and production gate | Access/minimization controls; no assumption that all personal data may legally persist forever |
| 10 | Consequential approval; existing lifecycle rules intact | Section 3.2 routine-edit boundary; all nine candidate fields consequential; existing extension path retained; commercial rent changes excluded | [ ] Boundary and necessary ordinary-route restrictions | Preserve routine profile permissions while closing correction bypasses |

Additional scope acceptance: [ ] one pending proposal per target; [ ] one field per proposal and no grouped changes; [ ] proposed coarse lifecycle-billing gate and required integration work; [ ] Finance review can remain outstanding after a factual APPLIED result; [ ] no automatic retrospective billing issuance or financial remedies.

Owner name: ____________________  Decision/date: ____________________

Approved items/amendments: __________________________________________

Specification approval records policy agreement only. Implementation authorization: **NOT GRANTED**. Disposable PostgreSQL authorization: **NOT GRANTED**. Production privacy/legal review: **REQUIRED, not completed**.

Readiness refers to the specification's suitability for owner review. Its proposed choices are explicit and complete for decision; unchecked items prevent policy freeze and implementation, rather than hiding missing defaults.

READY FOR OWNER APPROVAL
