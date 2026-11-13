# NOOK — P4-2 Owner Decision Review: 1, 2 and 15

**Owner choices NOT APPROVED. Research and documentation only.**

Workspace: `~/Downloads/nook-phase4-1`; branch verified: `feature/phase-4-1-lifecycle-audit`; HEAD `908098acd567c299ad05529b5a533ad17622dceb` plus existing working-tree changes. Review date: 2026-11-08.

Authoritative policy proposal: [Specification v1.2](P4-2_SPECIFICATION_v1.2_FINAL_FOR_OWNER_APPROVAL.md). Decision aid: [Owner worksheet](P4-2_OWNER_DECISION_WORKSHEET.md), including unapproved Decision 10 operational additions and dueAt precision clarification. Both documents were read completely; neither is changed by this review.

## Findings and evidence boundary

The nine fields are a defensible bounded correction scope, but existing direct writes must be restricted before approval becomes enforceable. Resident names, booking dates/price and admission dates currently accept direct PUT updates without an independent correction reviewer. Status/archival branches can carry those changes too. Existing check-in timestamp updates are explicitly refused; checkout has creation but no observed existing-record update path. These are compatibility findings, not security incidents or already-implemented P4-2 behavior.

Two documentation issues need explicit reconciliation: the specification's “PATCH” restriction must cover actual PUT routes; and ordinary “resident notes” are not supported by Resident's model/write picker. Another source-backed concern is that invoice/receipt names are derived from the current Resident relation: changing a name may change later rendering without changing issued Invoice columns. The owner must decide the historical display requirement rather than assume an immutable name snapshot exists.

**Verified** below means repository definitions inspected, not deployed/runtime results. **Proposed** means v1.2 recommendation, still unapproved. **Advisory** means this review's recommendation, not a selected owner policy. No database, application tests, Prisma commands or external services were used. Examples describe proposed future behavior, not currently available endpoints.

Frozen directions are not reopened: allowlist only; consequential approval; no self-approval; OWNER-only financial approval; controlled historical reason/approval; authoritative recalculation of genuinely unissued billing; immutable issued facts with separate approved remedies; room/bed corrections in P4-3; permanent rejected proposals; indefinite originals subject to privacy/legal requirements. Full first-month rent, separate booking/month invoices, manual overdue review, no automatic overstay billing, extension authority and unresolved tax treatment remain constraints.

## Source evidence index

Paths below are relative to this workspace. Named functions identify the inspected behavior; source searches supplement the listed excerpts. Generated code, secrets, environment files and database helpers were not read.

| ID | Source inspected | Evidence used |
|---|---|---|
| R | apps/api/src/resident/resident.controller.ts; resident.service.ts; resident.fields.ts; resident.dto.ts (field search); prisma/schema.prisma Resident | POST/PUT/archive, explicit picker, names/contact/address/emergency/doc/status coverage; no resident notes field |
| B | apps/api/src/booking/booking.controller.ts; booking.service.ts create/update/extend/cancel; booking.input.ts; booking.rules.ts; booking.extension.ts | PUT writes, mixed status payloads, bed locks, interval/admission constraints, extension role/reason audit |
| A | apps/api/src/admission/admission.controller.ts; admission.service.ts create/update/cancel/assertWithinBooking; admission.input.ts | PUT date/status/location writes; fixed authoritative booking/resident/bed; pre-write date validation and partial audit atomicity |
| C | apps/api/src/checkin/checkin.controller.ts; checkin.service.ts create/update/checkOut; checkin.rules.ts | Creation instants, blocked timestamp update, notes-only update, checkout unique lifecycle, active occupancy checks |
| F | apps/api/src/finance/finance.controller.ts; finance.service.ts billableStays/createDraft/issue/serializeInvoice/receipt/adjustInvoice/reversePayment/voidInvoice; finance.util.ts relevant parsers/billing helpers | Both-role endpoints, full-rent source facts, draft/issued limits, current-name rendering, credit/reversal/void validation |
| T | apps/api/src/common/time.ts; common/input.ts relevant parsing definitions | IST dates versus instants, current permissive instant defaults, no global ValidationPipe assumption |
| S | apps/api/src/auth/auth.guards.ts; auth.types.ts; session.service.ts authenticate; app.setup.ts | Trusted session role/organization, active membership, Origin/CSRF, API prefix api/v1 |
| H | apps/api/src/resident-history/resident-history.service.ts metadata/action projection; apps/api/src/enquiry/enquiry.service.ts convert | Current audit projection; conversion creates a new resident, does not edit an existing identity |
| DB | prisma/schema.prisma relevant Resident/Invoice/CheckOut/tenant-key definitions; migration.sql excerpts in 20261103110000_invoice_guard_hardening and 20261103130000_invoice_active_uniqueness | Column immutability versus settlement changes; slot uniqueness; no existing correction model |
| UI | apps/web/src/ops/Residents.tsx form/submit; Bookings.tsx create/action searches; Admissions.tsx status actions; CheckIns.tsx time/checkout/extension searches; ResidentProfile.tsx; opsApi.ts | Actual PUT client calls, resident edit form sends names even for other edits, operational commands and current history UI |
| TEST | Targeted source searches in apps/api/test/integration/resident-enquiry.integration.test.ts, booking.integration.test.ts, lifecycle.integration.test.ts, checkin.integration.test.ts; test-file discovery | Existing test locations and update assertions, not test execution or coverage certification |

Inspection of auth source examines code, not actual cookies/tokens/passwords. Searches for mutation call sites under apps/api/src excluded generated code. Absence findings are limited to these sources; privileged SQL, uninspected integrations and deployed schema are unverified.

## Decision 1 — Nine-field analysis

All correction requests under the proposed design require a reason, effectiveAt, server-captured original, protected immutable proposal, idempotency, tenant checks and independent review. Historical/evidence rules remain separate unapproved Decisions 3/4. “Safe independently” means only if all current dependent facts remain valid under the reviewed transaction; it never means unconditional editing or atomic groups.

### 1. Resident.firstName

- **Mistake:** an existing resident was recorded as “Arahv” rather than their actual first name; not replacing one resident with another.
- **Current mutability/path:** R permits POST creation and PUT `/api/v1/residents/:id` through update→pickResidentFields. Enquiry conversion creates a new Resident with supplied name overrides. PUT with status ARCHIVED also carries names through archiveGuarded. No independent correction decision or ResidentService audit write is present in these update paths. **Direct-write bypass exists relative to proposed P4-2 policy.**
- **Validation/impact:** retain required trimmed Unicode text, non-null, raw input length ≤500, immutable resident/tenant id. Identity and historical display change; rent/occupancy calculations do not use firstName. F derives invoice residentName from current Resident; see unresolved display issue below.
- **Independent safety/checks:** compare firstName plus tenant/id/status; preserve lastName and ordinary profile fields. Check target membership/ownership and actual identity-error reason; do not alter invoice snapshots. A concurrent unrelated lastName proposal need not stale this one.
- **Advisory:** retain, normally non-financial; exceptional historical age still requires independent OWNER. Historical invoice-name display needs explicit reconciliation, not automatic new financial capability.

### 2. Resident.lastName

- **Mistake:** a surname spelling/transcription error, not an unapproved general identity-change workflow.
- **Current mutability/path:** same POST/PUT/picker/archive combination as firstName in R; EnquiryService.convert creates rather than edits the resident. **Same direct-write bypass exists.**
- **Validation/impact:** non-null trimmed 1–500 character text; existing identity and audit history affected, no direct rent/occupancy input. No new legal-name/document verification policy is assumed.
- **Independent safety/checks:** capture/check lastName and tenant/id/status, leave firstName untouched, preserve current-profile versus retained evidence distinction. Finance rendering concern applies independently to surname changes.
- **Advisory:** retain with the same normally non-financial classification and history safeguards as firstName.

### 3. Booking.startDate

- **Mistake:** the agreed booking began on the 5th but the record says the 15th. Moving an actual agreed term is not presumed to be a correction.
- **Current mutability/path:** B create writes initial date; PUT→update accepts startDate, including alongside status/paymentStatus. Locks Bed then Booking, validates resulting period, non-cancelled booking overlap and live admission coverage. **Direct update bypass exists; cancelled/status-changing branches must also be covered.**
- **Validation/impact:** preserve half-open IST [startDate,endDate), strict real date and start<end, final bed availability, fixed resident/bed, authoritative admission containment. Check physical stay chronology without pretending every actual checkout must fall before endDate: overstay is legitimate. Dates alter committed availability and Finance bookingCoversMonth, potentially a whole monthly invoice slot.
- **Independent safety/checks:** check Booking, Bed/other bookings, Resident, Admission, CheckIn/CheckOut and affected Invoice slots. One-field application is safe only if current end and all dependent facts still allow it. A start-date proposal cannot secretly update admission/end.
- **Advisory:** retain, OWNER financial review. No automatic new invoice, proration, overstay charge or issued amount change.

### 4. Booking.endDate

- **Mistake:** an exclusive end day was recorded too late; an end recorded too early is subject to the separate extension-only boundary below.
- **Current mutability/path:** PUT update can shorten/end-date replace within period/availability/admission constraints. Lengthening is already rejected there. POST `/bookings/:id/extend` uses extend, same Booking id, OWNER or PROPERTY_MANAGER, 3–500 character reason, new later end and overlap revalidation; writes booking.extended atomically. **Shortening has a direct-write bypass; extension is an explicit preserved domain exception, not that bypass.**
- **Validation/impact:** end is exclusive; adjacent bookings can touch on the same IST day. Check live admission containment, other reservations and historical stays; preserve actual overstay/current ACTIVE occupancy. A shorter booking does not itself check the resident out or release physical occupancy.
- **Independent safety/checks:** same chain as startDate plus shared date/rent dependency snapshot. [10,20)→[15,18) permits separately valid steps but a dependent pending second proposal must be refreshed after the first. [10,20)→[25,30) cannot apply an invalid start-first intermediate; end-first lengthening is outside correction. Grouped changes remain unsupported.
- **Advisory:** retain only the proposed non-lengthening correction semantics. Owner must explicitly accept that some historical repairs/reversals cannot be completed as P4-2 corrections; do not reclassify a recording mistake as a new commercial extension without acknowledging the boundary.

### 5. Booking.monthlyPrice

- **Mistake:** the original documented agreement was ₹8,500 but ₹85,000 was entered. A negotiated new ₹9,000 agreement is a commercial change, not this correction.
- **Current mutability/path:** POST create and PUT→update write price directly; parseMonthlyPrice uses positive Decimal, ≤99999999.99 and at most two decimals. PUT accepts mixed date/status/price changes, including cancellation branch data. Existing service does not require agreement evidence or an independent reviewer. **Direct-write bypass exists.**
- **Validation/impact:** use canonical decimal string, no floating point calculation, agreement evidence always, authoritative FinanceService. First-month rent stays full; separate bookings/month retain separate full invoices. Existing invoices are not rewritten merely because Booking.monthlyPrice changes. No existing draft-recalculation method is established.
- **Independent safety/checks:** Booking date/rent/status/parent dependencies; stay eligibility and all affected draft/issued invoice slots, current settlement facts under locks. Correction may require genuine-draft recalculation/explicit invalidation; failure must roll back the fact. Issued reviews/remedies are separately linked and approved, not automatic.
- **Advisory:** retain for demonstrated recording error only, OWNER financial review. No supported positive debit, refund, write-off or tax mechanism is inferred.

### 6. Admission.admissionDate

- **Mistake:** admission registration day recorded incorrectly while the authoritative booking/stay remains the same.
- **Current mutability/path:** POST create and PUT→update write date. update checks it against the pre-read booking; accepts date plus approve/cancel/reopen/status/location payloads. Normal update and admission.updated audit can be separate writes; status branches write all prepared data with status-focused audits. **Direct/mixed-status bypass exists, plus current parent-validation and audit atomicity gaps.**
- **Validation/impact:** preserve booking resident/bed identity, IST day in [booking.start,booking.end), proposed admission day not after recorded check-in day. CheckIn creation currently checks status/occupancy, not every proposed historical timestamp rule. Do not treat current validators as complete correction chronology enforcement.
- **Independent safety/checks:** lock/re-read authoritative Booking before Admission, inspect related CheckIn/CheckOut and parent status under the reviewed order. A date change needing a simultaneous parent/physical change must fail if it would leave an invalid intermediate state.
- **Advisory:** retain. F's rent calculation does NOT directly consume admissionDate (or admission status); OWNER-only classification is a deliberate precaution for lifecycle consistency, not proof of direct amount impact. Owner should accept that conservative workload explicitly.

### 7. CheckIn.checkInAt

- **Mistake:** actual arrival was 19:00 but the initial entry says 09:00.
- **Current mutability/path:** POST `/check-ins`→create writes resolveInstant output; existing PUT→update explicitly rejects checkInAt, status and parent IDs and allows notes only. **No observed existing-record timestamp bypass.** Initial creation can accept supplied historical/zone-less time; that is a creation-policy boundary, not an existing-record correction.
- **Validation/impact:** proposed correction requires explicit-zone real instant ≤now, authoritative admission chronology, ≤checkout if present and historical interval collision checks for the same bed/resident. Creation's current resolveInstant accepts local time/default now and is not the complete correction validator. Timestamp affects monthly stay eligibility; current ACTIVE occupancy derives from status, not a timestamp edit alone.
- **Independent safety/checks:** parent Bed/Resident/Booking/Admission, target CheckIn/CheckOut and other stays/Invoice slots. Completed stays may be corrected without reopening. Missing actual checkout cannot be fabricated from updatedAt. Revalidate versus concurrent checkout; no automatic status, release, charge or invoice issue.
- **Advisory:** retain, OWNER financial/occupancy classification with evidence under historical rules. Requires a new restricted typed apply path, not weakening current PUT protections.

### 8. CheckOut.checkOutAt

- **Mistake:** actual departure time was entered incorrectly on checkout, discovered after the stay ended.
- **Current mutability/path:** POST `/check-ins/:id/check-out`→checkOut creates one CheckOut and changes CheckIn to CHECKED_OUT atomically, requiring ACTIVE and checkOutAt≥checkInAt. Searches found no CheckOut.update call or existing-record checkout controller route. **No observed direct update bypass; schema DateTime alone does not establish API mutability.**
- **Validation/impact:** explicit-zone real instant ≤now, ≥actual checkInAt, historical bed/resident overlap checks. Completed stay remains CHECKED_OUT; occupancy is not reopened/released a second time. Actual departure after booked end remains possible; it does not authorize extra billing.
- **Independent safety/checks:** existing same-tenant CheckOut and parent CheckIn/Admission/Booking/Bed/Resident, other actual stays and affected invoice slots; proposed CheckOut composite key prerequisite remains Decision 7. One timestamp correction is safe only when the resulting interval remains valid.
- **Advisory:** retain, OWNER financial/occupancy review. Finance's existing month-boundary policy must remain authoritative (see boundary finding below).

### 9. CheckOut.reason

- **Mistake:** “course complete” was recorded instead of the resident's actual departure reason. This is separate from the correction justification.
- **Current mutability/path:** checkout POST→checkOut writes optionalText reason, trim/empty→null/max500. No observed subsequent reason-update route. **No observed existing-record bypass.**
- **Validation/impact:** proposed non-empty trimmed text ≤500 or explicit null; preserve original reason and separately require correction reason/effectiveAt. No direct occupancy/amount input. It changes historical departure explanation and may be sensitive.
- **Independent safety/checks:** target CheckOut, same-tenant CheckIn/parent identities/status and checkout timestamp dependency; never change timestamp/status in the same proposal. Do not persist narrative values in unrestricted audit metadata.
- **Advisory:** retain, normal non-financial independent review; exceptional historical age escalates to OWNER under Decisions 3/4.

## Decision 2 — Exact proposed and advisory authorization matrix

The matrix below reproduces v1.2's recommendation and is also this review's advisory matrix. It is NOT an approved policy or current correction endpoint implementation. “Yes” always means active authenticated membership in the same organization; a reviewer must differ from requestedBy. Normal non-financial excludes exceptional-history cases. All denied actions are enforced server-side, not by button visibility.

| Action | OWNER | PROPERTY_MANAGER | Reason |
|---|---|---|---|
| Submit correction | Yes | Yes | Separate requesting from applying; financial submission is not financial approval |
| View proposal queue | Yes | Yes | Operational visibility with safe summaries |
| View protected proposal details | Yes | Yes | Same-tenant role access; originals/evidence protected, no general audit dump |
| Approve non-financial correction | Yes, independent | Yes, independent | Normal names/reason can receive peer review without presumed OWNER hierarchy |
| Reject non-financial correction | Yes, independent | Yes, independent | Require reason; requester cannot reject their own request |
| Approve financial correction | Yes, independent | No | Frozen OWNER financial authority |
| Reject financial correction | Yes, independent | No | V1.2 proposed symmetrical restricted review, not merely approval |
| Approve exceptional historical correction | Yes, independent | No | Evidence plus exception rationale; normal non-financial category does not bypass this |
| Withdraw own pending proposal | Yes | Yes | Reasoned WITHDRAWN, no self-approval or source mutation |
| Withdraw another person's proposal | No | No | Reviewers reject; no erasure/cancellation shortcut |

Exceptional-history rejection is also OWNER-only under v1.2's full matrix. No eligible reviewer means pending, not relaxed authority. Operational escalation in worksheet Decision 10 can assign tracking/follow-up but cannot authorize a financial decision.

**Classification assessment:** booking dates/price and physical timestamps directly affect F's eligible months/amount source and merit conservative OWNER classification even for a zero preview delta. AdmissionDate has no direct Finance input role today but can contradict parent/stay chronology; retain OWNER classification as a precaution and label it honestly. Names/reason are normally non-financial because calculations do not depend on them, but sensitive identity/history still requires independent review and exceptional-age rules. If new functionality later makes an ostensibly non-financial correction change an amount, the financial gate must apply; clients cannot downgrade classification.

**PROPERTY_MANAGER reviewing another OWNER:** technically consistent with independence based on user identity and v1.2, not a hierarchy inversion bug. It reduces OWNER bottlenecks for normal name/reason fixes; risks include operational pressure and broad protected-value access. Reasoned decisions and audits mitigate but do not eliminate that staffing risk. Old resident-creation anchors can still move a name case to exceptional OWNER review; no manager approval in that case. The owner's final staffing policy remains unselected.

**Existing Finance gap:** FinanceController uses SessionGuard and mutation Origin/CSRF, passes trusted organizationId/userId but does not pass role or a correction reviewer decision into adjustInvoice/reversePayment/voidInvoice. Those services validate amounts/state and lock Invoice; they do not implement independent OWNER correction review. Do not reuse them as if calling the method were approval. Future correction-linked remedy gates/typed links must be enforced at service and entry points, including direct Finance requests; how to prevent omission of a correction link disguising an intended correction remedy needs explicit provenance/entrypoint review, not an assumption that an optional client flag is sufficient. Unrelated Finance authority is not globally revoked by this review.

**Minimum future guards:** SessionGuard on all correction reads/writes; OriginGuard+CsrfGuard on mutations; explicit OWNER/PROPERTY_MANAGER entry allowance; service-level classification/exception permission and requester≠reviewer; active role revalidation for decisions/replays; own-PENDING-only withdrawal; organization-scoped target/parent/proposal/Finance reads and typed FKs; strict body parsing rejecting actor/organization/original/classification/status overrides; terminal/idempotency checks and under-lock revalidation. Existing RoleGuard only allows both roles: it is insufficient for financial/exceptional separation. Controller/DTO checks alone cannot protect internal service callers. Audit must record trusted identities and actual recorded time, not client-supplied actors.

## Decision 15 — Explicit boundary classification

Verified current behavior is not automatically approved future policy. A field appearing only in a type/UI does not establish mutability. All ordinary authenticated paths below retain trusted-session tenant isolation and Origin/CSRF where applicable; P4-2 is not a new permission grant.

| Field or operation | Current behavior verified? | Proposed category | Correction approval required? | Notes |
|---|---|---|---|---|
| Resident firstName/lastName | Yes: R POST/PUT, including mixed archive payload | Consequential correction after creation | Yes | No new identity replacement/document verification workflow |
| Phone/email | Yes: R picker accepts direct PUT; UI edit sends these | Explicitly excluded from P4-2; existing contact maintenance only | No P4-2 path | Existing edits not verified identity changes; Decision 13 controls separate policy |
| Address | Yes: R picker/UI PUT | Routine profile maintenance | No | Preserve existing validation and access; no new fields/permissions |
| Emergency contacts | Yes: R picker/UI PUT | Routine profile maintenance | No | Includes name/phone/relation; privacy controls still apply |
| Resident notes | No supported write: absent from Resident model/picker | Not an existing routine operation | No path to approve | Scenario 8's wording needs correction; do not invent a notes column |
| Booking/admission notes | Yes: B/A PUT and creation | Existing routine record maintenance | No for notes alone | Admission audit atomicity currently incomplete; must not smuggle candidate date/rent changes |
| Check-in notes | Yes: C PUT, while core fields blocked | Routine with legacy billing caveat | No normally | CHECKED_OUT without CheckOut uses updatedAt for legacy billing; notes update can affect that fallback and needs a safe design, not a blanket “no impact” claim |
| Checkout notes | Creation only observed | Existing checkout command, no assumed routine update | Not generic correction | Do not infer post-creation edit permission |
| Booking.startDate | Yes: B PUT | Consequential correction | Yes | Availability, live admission and physical chronology; Finance assessment |
| Booking.endDate shortening | Yes: B PUT | Consequential correction for recording error | Yes | No implicit status/occupancy change |
| Booking.endDate lengthening / extension | Yes: B POST extend | Existing validated domain command | No P4-2 proposal | Existing OWNER/PROPERTY_MANAGER authority; reason and atomic booking.extended audit; same booking |
| Monthly rent | Yes: B PUT accepts price without agreement evidence | Consequential recording correction OR excluded new commercial term | Yes for original error; new agreement unsupported | Decimal validation does not establish commercial authority |
| Booking cancellation | Yes: B PUT status or DELETE cancel | Existing validated lifecycle command | No generic correction | Cannot cancel a booking with any check-in history; no arbitrary status correction; mixed candidate fields must be blocked |
| Admission status | Yes: A PUT; UI uses setStatus | Existing lifecycle command | No generic correction | Approve/reopen/cancel under current validated rules; no new role policy inferred |
| Admission date | Yes: A PUT, including status bundles | Consequential correction | Yes | Parent and check-in chronology; preserve existing state transitions |
| Check-in timestamp | Creation yes; existing update rejected | Creation command / consequential later correction | Yes after creation | Cannot use notes PUT to change it |
| Checkout timestamp/reason | Checkout creation yes; subsequent edit not observed | Checkout domain command / consequential later correction | Yes after creation | Preserve CHECKED_OUT status and departure history |
| Room/bed assignment | Booking bed immutable in update parser; C parent echoes checked; A permits propertyId/roomId metadata updates | Initial allocation existing command; transfer/correction excluded P4-3 | No P4-2 generic path | Admission location metadata is not proof of a transfer mechanism; inventory label/status editing is a separate concern, not reviewed end-to-end here |
| Payment/invoice fields | Yes: F dedicated draft/issue/payment/reversal/credit/void commands | Existing Finance commands, excluded generic correction | Separate independent OWNER approval for correction-linked remedies | Issued core facts immutable; permitted settlement caches/status changes not invoice rewriting |
| Deposit/refund fields | No dedicated workflow found in inspected schema/services; paymentStatus includes REFUNDED label | Explicitly excluded | No P4-2 path | A status enum does not prove refund execution/support; broader refund behavior unverified |
| Document verification/metadata | Yes: R picker accepts enum/metadata/url; no genuine verification gate shown | Explicitly excluded from P4-2 | No P4-2 path | Existing editable flag is not KYC proof; do not introduce uploads/verification policy |
| Organization/role fields | R picker/B parser do not write these; S obtains context from membership | Explicitly excluded | No P4-2 path | Dedicated organization/provisioning/role mutation APIs not reviewed; do not claim no such workflow exists |

Workflow status changes are not all separate URLs today: several domain commands use PUT with service validation. Preserve their meaning, not a fictional route layout. Rejecting candidate edits must happen before status/archival branches so a request combining an allowed domain transition with a forbidden field cannot partially succeed.

## Cross-decision scenarios — proposed outcomes, not current feature behavior

All scenarios assume the relevant recommendations are eventually explicitly approved. Requests remain unavailable as P4-2 until implementation is separately authorized/completed. Historical exceptions always override normal non-financial review authority. Every applied correction preserves original/proposed/applied values, effective/recorded time, requester/reviewer and atomic correction/domain/Finance audits; rejected/withdrawn/stale proposals remain retained. Pending proposals never display as applied facts.

| # / scenario | Who initiates / reviews? | Checks and correct path | Audit and prevention |
|---|---|---|---|
| 1 OWNER corrects misspelled first name | OWNER submits; different OWNER or PROPERTY_MANAGER reviews normally; different OWNER if exceptional age | P4-2 firstName; 1–500 trimmed Unicode, original identity, tenant/status snapshot, age/evidence | Retain spelling evidence/history; prevent self-review, identity replacement and unapproved issued-name snapshot assumptions |
| 2 PROPERTY_MANAGER requests name correction | PROPERTY_MANAGER submits; different permitted OWNER/PROPERTY_MANAGER normally; independent OWNER if exceptional | Same P4-2 name checks; classify server-side, not by submitter role | Retain independent actor/reason; prevent manager approving own request or bypass via PUT |
| 3 OWNER corrects booking start affecting existing admission | OWNER submits; different OWNER reviews | P4-2 startDate; lock/revalidate bed availability, [start,end), live admission containment, physical history and affected Finance slots | Reject invalid intermediate; do not auto-change admission or invoice; preserve all domain/correction audits |
| 4 PROPERTY_MANAGER attempts monthly rent correction | May submit a documented original-error proposal; cannot approve/reject financial proposal; different OWNER reviews | P4-2 only for evidence-backed original agreement; Decimal/rent/dependencies; genuine-draft recalculation and issued review | Prevent direct PUT, disguised renegotiation, proration or automatic credit/debit/refund; retain agreement reference and Finance consequences |
| 5 OWNER tries end-date lengthening | P4-2 request invalid regardless of OWNER; existing extend can be initiated/approved by authorized OWNER or PROPERTY_MANAGER under existing authority | Use POST extend for an actual approved extension, with later end/reason/availability; do not pretend a historical error is automatically a commercial extension | booking.extended actual actor/reason/history, same booking; no correction approval path or self-approval exception is created for P4-2 |
| 6 Resident phone needs correction | Existing operator contact edit under current access; no P4-2 submit/reviewer route | Current R PUT accepts phone; no new verified-contact workflow; new policy needed for verified identity change | P4-2 exclusion does not silently disable ordinary contact edits or certify verification; current ResidentService audit gap is explicit, not fabricated history |
| 7 Checkout time corrected after completed stay | OWNER or PROPERTY_MANAGER submits; different OWNER reviews | P4-2 existing checkout; explicit instant, ≥checkIn and ≤now, historical bed/resident interval checks, parent/Finance snapshot, evidence/age | Preserve CHECKED_OUT, original departure, issued invoices; prevent reopening, second bed release, fake checkout, automatic overstay billing |
| 8 Manager edits “ordinary resident notes” during pending name request | No resident-notes operation is verified; cannot claim it succeeds or invent reviewer | Unsupported literal scenario. If intended address/emergency contact or booking/admission notes, use that existing routine path; no correction review for supported notes alone | Existing routine update must not smuggle names; unrelated updates do not automatically stale name snapshot; check-in legacy notes caveat remains |
| 9 User tries existing PATCH to bypass workflow | No observed candidate entity PATCH route; actual bypass attempts use PUT. Active operator still lacks independent correction authority there after future restriction | Future ordinary PUT rejects candidate fields before mutation, including mixed cancellation/archive/admission-status bodies; internal service dispatch also guarded | Do not merely hide form fields, silently ignore forbidden candidate change or partially apply the rest; record real proposal/audit only through authorized path; no endpoint assumed from CORS PATCH support |
| 10 Two independent corrections pending for same resident | Either operator may submit firstName/lastName requests; each needs an eligible different reviewer from its own requester | P4-2 one pending per target/field; selected-field+tenant/status dependencies; row-serialize application and leave sibling value untouched | Both independent names may apply; no full-row overwrite/spurious stale from notes; same-field duplicate must conflict; no grouped approval inferred |

Scenario 5's extension authority is explicitly preserved; it is not retrospectively subjected to P4-2's independent financial-review policy. Scenario 8 is a source/document mismatch requiring wording reconciliation, not an invitation to add a field. Scenario 6 highlights an existing contact-policy boundary rather than a newly authorized identity workflow.

## Unresolved issues and required reconciliation

1. **Actual write routes and mixed payload bypass:** v1.2 uses PATCH language while R/B/A/C controllers implement PUT. Candidate name/date/rent updates can accompany archive/cancel/approve/reopen bodies. Future restriction must cover every service branch and actual verb. Advisory: reject the entire ordinary request containing prohibited candidate fields before changing anything; edit UI should omit these fields for routine changes. Existing ResidentForm always sends names, so merely changing backend behavior would break routine form saves. This rejection detail requires explicit reconciliation, not an already-existing error contract.
2. **Resident notes absent:** model and picker do not support notes. Clarify that routine notes mean only entity-specific supported paths; no new resident notes field, UI or audit policy should be smuggled into P4-2. Owner should identify the intended operation if literal resident notes are needed.
3. **Invoice/receipt name rendering:** F serializeInvoice uses current residentName and receipt joins firstName/lastName; Invoice has no issued-name snapshot. An approved name correction may change later rendering without modifying protected issued columns. Owner must choose whether to retain clearly labelled current-profile rendering or require a separately reviewed issued-identity snapshot/display design. No backfilled historic name can be invented. This review does not select either policy or promise historically identical invoice output. Names remain normally non-financial for calculations, but the display consequence must be acknowledged before implementation acceptance.
4. **Chronology versus billing boundary:** physical intervals proposed in v1.2 are half-open, whereas F stayOverlapsMonth deliberately includes checkout exactly at month start (`endedAt >= from`) in full-month billing. Keep existing Finance rule authoritative. Do not reuse a generic physical overlap predicate for rent or silently “fix” that boundary. Distinguish physical no-overlap assertions from frozen billing tests.
5. **Admission classification and current gaps:** admissionDate is not consumed by Finance rent calculation. OWNER review is a conservative recommended control, not a source-supported direct monetary dependency. Current normal audit can follow its write non-atomically, mixed status audits may omit sibling values and booking validation uses an earlier read. Existing commands need transaction integration before corrections are enabled.
6. **Ordinary notes can have a legacy consequence:** CheckIn.update changes updatedAt. F uses updatedAt as fallback end for CHECKED_OUT records without CheckOut. A notes-only edit can shift derived billing history in that legacy case. Do not fabricate a checkout, call all notes financially irrelevant, or implement an ad hoc Finance calculation. Future design must guard/classify the legacy condition without changing the frozen rules; exact safe handling remains an implementation investigation/acceptance prerequisite.
7. **Remedy provenance:** a role gate conditional only on an optional client correction link can be omitted. The authorized source of the association/entrypoint and its enforcement require review; v1.2 must not be interpreted as an existing independent-OWNER Finance policy. Global Finance permission changes are outside these decisions.
8. **Unsupported combined repair and end-date reversal:** single-field constraints can block valid desired end states when no valid permitted intermediate exists; reversing a shortening by lengthening is still outside correction. Accept that limitation explicitly or separately scope a group/rental-term workflow; do not silently expand the list.

These are evidence-based findings and open design/product details, not amendments applied to either authoritative document. Contact verification, retention/privacy legality, historical ages/evidence and Decision 10 operational defaults remain their separate unapproved choices. Production privacy/legal review is still required.

## Advisory choices — no owner selections made

### Recommendation for Decision 1

**Recommended choice: ACCEPT** the nine-field candidate list and all v1.2 validation/one-field/no-lengthening constraints. Retain each field for the use cases above; add no fields.

**Recommended policy:** names and departure reason correct existing recording mistakes; dates/rent/physical timestamps use conservative OWNER review and authoritative parent/Finance validation. Price must match a documented original agreement. Preserve actual occupancy facts, immutable issued amounts/dates, full-month rent and separate booking slots. Applied facts and unresolved money review are distinct.

**Reasoning:** bounded scalar fields address practical errors without a general editing API. **Trade-offs:** all post-creation name changes need a second operator; old resident anchors can need another OWNER; dependent repairs require resubmission or remain unsupported; Finance safeguards add transactional work.

**Required future amendments/clarifications:** explicitly list current mutation paths, date/physical/Finance checks and source-created versus source-corrected facts; record the name-rendering decision in a reconciled specification before acceptance. If that decision requires new invoice snapshots, obtain separate design/scope authorization rather than treating ACCEPT as approval of that feature. No historical invoice-name reconstruction is inferred.

**Dependencies:** Decisions 2/3/4/5/6/7/8/9/10/13/14/15/16. Owner may still reject/amend/defer; this is not a mark in the worksheet.

### Recommendation for Decision 2

**Recommended choice: ACCEPT** v1.2's complete proposed matrix, with classification rationale clarified.

**Recommended policy:** both roles submit/view and independently review normal non-financial cases; OWNER only independently reviews financial and exceptional cases (including rejection); requester-only pending withdrawal; no other-person withdrawal. AdmissionDate receives OWNER review as precaution even though not currently a rent input. A different manager may review an OWNER's normal non-financial request; active membership/tenant/user identity, not role seniority, controls independence.

**Reasoning:** financial/chronological risk stays with OWNER while ordinary peer review avoids unnecessary bottlenecks. **Trade-offs:** conservative admission review adds OWNER workload, sole-OWNER requests may stall, and protected-value access needs strict role/tenant/privacy enforcement.

**Required future amendments/clarifications:** state service-level classification and exception escalation, own-rejection denial, replay authorization and correction-linked remedy gates; identify enforceable trusted Finance linkage instead of relying on a client flag. Distinguish current Finance authority from future correction authority without globally changing unrelated permissions.

**Dependencies:** 1/3/4/6/8/10/11/12/14/15/16. No escalation/SLA changes authority.

### Recommendation for Decision 15

**Recommended choice: AMEND** the wording/coverage while retaining v1.2's policy direction.

**Recommended policy:** routine supported address/emergency-contact/notes edits retain current permissions; the nine candidate post-creation fields must use approved correction paths. Creation, validated cancellation/admission transitions, actual check-in/checkout and existing extension remain domain commands. New commercial rent terms, transfers, contact verification, refunds/settlement and document verification are excluded P4-2 workflows.

**Exact required amendments for a future reconciled specification:**

- Replace generic PATCH-only wording with actual PUT/service restrictions and cover all mixed status/archive payloads. Define whole-request refusal of candidate fields in ordinary updates, alongside UI omission of unchanged candidate values; do not silently alter those values during a permitted status transition.
- Replace blanket “resident notes” with named existing notes paths. Explicitly state Resident has no supported notes field and check-in notes require safe legacy fallback handling before being declared financially inert.
- Distinguish immutable physical bed/resident assignment from Admission's currently editable room/property metadata; P4-2 neither turns that metadata edit into transfer support nor newly approves it.
- Preserve existing phone/email maintenance while stating that exclusion does not certify verification. Preserve current document/status permissions outside P4-2 rather than approving a new KYC policy.
- State recording-error price versus renegotiation evidence boundary and end-date-lengthening extension exception; do not route every desired historical repair through a commercial change.
- Address current-name historical invoice/receipt display in conjunction with Decision 1, keeping issued column facts and supported Finance operations unchanged.

**Reasoning:** source-accurate restrictions close real bypasses and prevent adding routine capabilities that do not exist. **Trade-offs:** ordinary forms/types need coordinated changes, mixed requests can fail, legacy records require investigation and some commercial/historical repair requests remain unsupported. **Dependencies:** 1/2/5/6/8/9/10/11/13/14/16. These are proposed amendments only; owner chooses and a later specification must reconcile them.

## Future implementation impact — read-only inventory

| Group | Verified current behavior | Required future change if authorized | Uncertain / review prerequisite |
|---|---|---|---|
| Entity/service validation | R picker writes names; B/A direct date/rent with state bundles; C denies core updates | Typed correction dispatch, strict scalar parsing, dependency snapshots and source checks; ordinary-path candidate restrictions before branches | Complete writer inventory, legacy missing-checkout handling, cancelled/archived record correction eligibility must be reconciled with existing facts |
| Controllers/routes | /api/v1 prefix; R/B/A/C PUT, domain POST/DELETE; trusted context passed | Explicit correction routes and tenant/role rules; preserve Origin/CSRF; refuse mixed bypass payloads | No unobserved PATCH route assumed; check any future/internal callers |
| Authorization guards | SessionService checks active user/membership/organization; RoleGuard allows both roles | Financial/exceptional service gate, self-review denial, requester withdrawal, current-role replay check | Trusted correction/Finance association, concurrency with membership revocation needs acceptance evidence |
| Audit writes | B changes transactional; A ordinary write/audit separate; R update/C notes have no explicit domain audit in inspected service; current history projector knows lifecycle actions | Protected values, safe event ids/codes, trusted actor, domain/correction/Finance events in application transaction; add history projections | Do not backfill unknown originals/actors or call current audit coverage complete; routine audit gaps require explicit scope treatment |
| Finance integration | Source rent/period/stay facts, full amounts, draft issue without recalculation; current-name serialization; invoice-locked settlement operations | Transaction-aware draft validation/recalculation, explicit approved invalidation, linked issued REVIEW_REQUIRED, OWNER gates, coordinated source locks | Invoice-name display policy; safe existing Finance entrypoint reuse; no debit/refund/tax feature |
| Resident Profile UI | ResidentProfile.tsx overview/history/finance with useAsync/Pager/ErrorState/EmptyState; H known-event projection | Add correction history/request/review links, pending versus applied state, effective/recorded times and money warning | Existing history payload projection must not expose protected narratives/values broadly |
| Existing forms/API types | Residents.tsx edit sends names with profile changes; opsApi uses PUT; Bookings/Admissions/CheckIns expose create/status/extension/checkout commands | Split correction request from routine edit; omit candidate fields on routine saves; preserve initial creation; add queue/review controls/types | Client type presence does not guarantee service support; review full form interactions during authorized UI work |
| API/integration tests | Existing locations in R/B/A/C lifecycle/Finance/auth/history suites and ResidentProfile.test.ts | Add forbidden PUT/mixed-status payload, both roles, self-review/tenant, dependent stale/independent names, price evidence, exact date/Finance boundary and audit rollback cases | No current passing results claimed; disposable PostgreSQL authorization required for transaction/race/immutability tests |

Likely relevant future paths: new apps/api/src/corrections module/contracts/controller/service; existing R/B/A/C/F modules and services; auth guards, ResidentHistory projection; apps/web/src/ops/Residents.tsx, ResidentProfile.tsx, opsApi.ts, opsRoute.ts, existing operational forms and shared Finance components. Tests may extend apps/api/test/{input,booking.rules,booking.extension,checkin.rules,admission.audit,finance.rules,finance.service,resident-history.service}.test.ts and integration/{resident-enquiry,booking,lifecycle,checkin,finance}.integration.test.ts plus web profile/form tests. These are future work candidates, not edited or executed files.

## Scope and approval gates

Only this review document is created. Both primary documents remain unchanged. No source/schema/migration/test/config/environment/marketing edits, database/credential access, application commands or Git mutations occurred. No runtime, PostgreSQL or application test validation is claimed.

Owner policy choices, reconciled final specification, independent schema/migration review, joint P4-2.3/P4-2.4 transaction review, authorized disposable PostgreSQL tests and production privacy/legal review remain separate gates. This review authorizes neither P4-2.1 nor any later slice. Worksheet Decision 10 SLA/escalation/communications—including dueAt—remain unapproved proposals and add no financial review authority.

DECISIONS 1, 2 AND 15 — READY FOR OWNER REVIEW

## Final owner decision form

The advisory choices above are not entered here. End-of-document records remain blank for the owner.

### Decision 1 — Exact correction allowlist

- Decision: NOT APPROVED
- Owner selection:
- Accepted fields:
- Removed fields:
- Amendments:
- Rationale:

### Decision 2 — Roles and financial classifications

- Decision: NOT APPROVED
- Owner selection:
- Approved role matrix:
- Financial classifications:
- Amendments:
- Rationale:

### Decision 15 — Routine-edit and commercial boundaries

- Decision: NOT APPROVED
- Owner selection:
- Routine operations:
- Correction-required operations:
- Existing domain commands:
- Excluded workflows:
- Amendments:
- Rationale:
