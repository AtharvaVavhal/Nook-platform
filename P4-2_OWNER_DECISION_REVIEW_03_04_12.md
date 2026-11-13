# NOOK — P4-2 Owner Decision Review: 3, 4 and 12

**Read-only research and documentation. All owner choices NOT APPROVED. Implementation NOT AUTHORIZED.**

Workspace: `~/Downloads/nook-phase4-1`; branch verified: `feature/phase-4-1-lifecycle-audit`. Review date: 2026-11-08. The current working tree, including pre-existing edits, is the compatibility baseline; HEAD alone is not its full description.

Primary documents read in full: [Specification v1.2](P4-2_SPECIFICATION_v1.2_FINAL_FOR_OWNER_APPROVAL.md), [Owner worksheet](P4-2_OWNER_DECISION_WORKSHEET.md), and [Decisions 1/2/15 review](P4-2_OWNER_DECISION_REVIEW_01_02_15.md). None is modified. The worksheet's Decision 10.1–10.4 operational defaults, including dueAt, remain additional unapproved recommendations and are not attributed to v1.2.

## Executive findings and evidence labels

V1.2 gives a workable conservative age formula and anchors, but it is **not yet precise enough for implementation at approval boundaries without clarification**. In particular, it does not fix the final evaluation instant after lock waits, whether that instant or commit time governs a midnight crossing, or how missing mandatory anchors differ from irrelevant non-date values. These are explicit proposed amendments below, not silent changes to its formula.

The five-year resident-name anchor is intentionally restrictive: a typo discovered today can require independent OWNER review and evidence. No separate exceptional age ceiling avoids permanently blocking older truths, but does not guarantee that evidence or a supported financial remedy exists. A sole OWNER cannot approve their own financial/exceptional correction; an eligible sole OWNER may review a different PROPERTY_MANAGER's request. Staffing, evidence and elapsed time cannot waive independence.

**Frozen owner direction:** explicit allowlist; approval for consequential correction; no self-approval; OWNER-only financial approval; controlled historical reason/approval; authoritative unissued recalculation; issued facts immutable with separate approved remedies; transfers deferred; permanent rejected proposals and indefinite originals subject to applicable privacy/legal requirements. These are not reopened.

**V1.2 recommendation:** exact nine fields, roles/classifications, 90-day anchors, exceptions/evidence, pending-field/state/Finance/locking design. Still awaiting owner selection. **Verified source fact:** inspected repository definitions only, not deployed database behavior or passing tests. **Advisory:** this review's choices, alternative parameters and clarifying wording. None grants authority or asserts legal compliance.

## Source evidence inspected

| Evidence | Current behavior established by inspection | Limit |
|---|---|---|
| apps/api/src/common/time.ts: istDateOf, todayIst, istStartOfDay, resolveInstant | Fixed IST offset +330 minutes; UTC-based day extraction independent of host TZ; physical instant parsing/defaults | Does not implement correction lookback or evidence policy |
| apps/api/src/common/input.ts: parseDateInput/requiredDate/optionalDate | Real date-only round-trip validation, UTC-midnight date representation; date-time delegated to IST-aware helper; absolute year sanity bounds 2000–2100 | These are current input bounds, not an exceptional-review age ceiling |
| apps/api/src/booking/booking.input.ts date rules referenced by booking service; booking.rules.ts; booking.extension.ts; booking.service.ts create/update/extend | IST [start,end), Bed→Booking locks, overlap/admission constraints; extension roles OWNER and PROPERTY_MANAGER unchanged | No independent historical correction engine in these paths |
| apps/api/src/admission/admission.service.ts create/update/status branches | Date checked against booking; current normal update/audit can be separate writes; status branches lock Admission | Parent revalidation/atomicity needs future integration; evidence cannot cure a race |
| apps/api/src/checkin/checkin.service.ts create/update/checkOut; checkin.rules.ts | Creation locks Bed→Resident→Booking→Admission; core timestamp update denied; checkout locks CheckIn, validates departure≥arrival, writes source/status/audit atomically | Full historical interval correction validators do not exist today |
| apps/api/src/resident/resident.service.ts update/archive; prisma/schema.prisma Resident | Direct name update; server-created createdAt timestamp; no complete original-name version archive exposed by this service | createdAt anchors record age, not a proven date when a typo arose; no invented historical evidence |
| apps/api/src/auth/session.service.ts authenticate; auth.guards.ts; schema Membership/AuditEvent | Active user, active membership and active organization required; trusted actor/tenant/role; Origin/CSRF; AuditEvent actor/request/occurredAt | User FK proves identity, not OWNER authority; no correction self-review guard exists yet |
| apps/api/src/finance/finance.util.ts bookingCoversMonth/stayOverlapsMonth/isMonthBillable; finance.service.ts billableStays/createDraft/adjustInvoice/reversePayment/voidInvoice/receipt; finance.controller.ts | Full-month source eligibility; inclusive checkout-at-month-start billing; legacy updatedAt fallback; balance-limited credits; invoice locks; current general endpoints permit both roles | No draft-recalculation/correction approval policy already implemented; unsupported refunds/debits not inferred |
| apps/api/src/resident-history/resident-history.service.ts metadata projection; apps/web/src/ops/ResidentProfile.tsx history/query patterns | Known lifecycle audit action projection, existing useAsync/Pager/ErrorState/EmptyState patterns | No exceptional correction queue or protected evidence viewer implied |
| prisma/schema.prisma candidate source fields/tenant keys/AuditEvent/Finance definitions | Timestamptz(6) source events and createdAt, typed existing tenant relationships; no CorrectionProposal | Proposed indexes/model names in v1.2 remain future reviewed design |

Searches for historical correction/evidence/exception terms under apps/api/src excluding generated code found no implemented correction-age validator. Existing invoice scheduler lookback is a billing batch-month setting; it neither implements a 90-day correction policy nor supplies empirical justification for one. No operational dataset, production history or measured correction backlog was queried. Source review cannot establish a legally required duration or evidence sufficiency in a real case.

## Decision 3 — Exact age calculation

### V1.2 formula and type semantics

V1.2 proposes `age = max(0, todayIST - min(candidateDays))` in whole calendar days. Read “minus” as a difference of validated calendar-day ordinals, not milliseconds minus a Date object. Convert instants to their Asia/Kolkata date first. EffectiveAt is always included; date-valued original and proposed facts and the category anchor are additional candidates. The earliest day wins: a new replacement/effective date cannot erase an older recorded fact. Normal age is 0–90 inclusive; age 91+ requires exceptional review.

Booking/admission API dates are business calendar days even though their current schema type is Timestamptz(6). Current date-only parsing stores a UTC-midnight representation; do not turn that representation into a new physical event or shift it through the host timezone. Historical timestamp-valued booking/admission records must be interpreted through the established IST-day helpers. CheckIn/checkOut timestamps are actual instants with an offset; extract their IST day only for age, retain exact original/proposed instants for chronology/audit. Correction effectiveAt is a historical applicability instant, not the actual recorded decision time and need not equal the corrected event instant.

Verified helpers use `getUTC*` after the +05:30 shift, rather than host-local `getDate()`. For example, `2026-11-08T18:29:59Z` is still November 8 IST; `2026-11-08T18:30:00Z` is November 9 IST. A UTC-midnight reset would be wrong. Calendar-day lookback counts weekends/holidays too; do not import Decision 10's separate business-day SLA calendar. Future booking/admission values may be corrected now, effectiveAt must not be future, and future physical instants are prohibited by v1.2.

### Anchors and risks, one category at a time

| Category | Candidate days in addition to effectiveAt | Why anchor matters / risk prevented | Cost or qualification |
|---|---|---|---|
| Resident firstName/lastName | Resident.createdAt IST day | Prevents old identity facts being treated as recent merely by asserting today's effectiveAt | Record creation is a conservative proxy; a recent typo on an old resident also becomes exceptional. Discovery date is not trusted provenance |
| Booking.startDate/endDate | Original booking start day plus original and proposed value days | Keeps the age of the original agreement context; an end-date replacement cannot hide an old booking behind a recent/future end | Can escalate a recent end-date error on an old booking; start/end still share stale dependencies |
| Booking.monthlyPrice | Original booking start day; never parse monetary values as dates | Anchors rent recording error to original booking context instead of discovery/payment time | Agreement evidence always mandatory, even age 0; does not establish new rent authority |
| Admission.admissionDate | Original and proposed admission day (original is also the anchor) | Prevents moving old admission chronology forward to gain normal review | Duplicate original day does not change min; parent chronology still independently validated |
| CheckIn.checkInAt | Original and proposed event IST days | Prevents a proposed recent arrival instant concealing older actual occupancy | Day age is coarse; chronology uses full instants, not just dates |
| CheckOut.checkOutAt | Original and proposed event IST days | Prevents recency laundering of old departure history | Must preserve completed status and full bed/resident interval integrity |
| CheckOut.reason | Original authoritative checkout day; null/text reason values are not dates | Makes historical departure explanation follow the event it explains | Clearing reason is allowed only within approved field/value policy, not clearing its event anchor |

Original/anchor facts are server-read, not supplied as authoritative by the requester. If a dependency changes before review, stale protection applies; never silently replace the submitted original/anchor with newer source facts to reset age. Exactly which facts are dependencies remains v1.2's section 8/12 contract, including independent name-field comparisons.

### Alternatives for the normal window

| Lookback | Security and control | Operational burden | Resident impact | Advisory assessment |
|---|---|---|---|---|
| 30 days | Small normal authority window; more cases require OWNER evidence review | More exceptions; ordinary backlog can cross boundary quickly | Recent errors fixed, but delayed discoveries wait for scarce review | Defensible if staffing supports frequent exceptions; not this review's default |
| 90 days | Bounded normal review for roughly a quarter of operation dates | Moderate exception frequency in principle; old resident anchors still dominate | Reasonable recent-case access with older repairs still possible exceptionally | Retain as proposed product balance, with precise clock/anchor wording |
| 180 days | Larger ordinary historical authority | Fewer time-based exceptions, longer ordinary exposure | More fixes avoid exception queues, but weaker recency boundary | Consider only by explicit owner amendment, not inferred from convenience |
| Unrestricted normal authority | Removes meaningful age-based escalation; controlled-reason/independence constraints would still apply, but no older-case distinction | Fewer exceptions, heavier ordinary evidence/history assessment | Less delay for old facts, greater risk of casual historical rewriting | Do not adopt by default; no empirical or legal basis establishes its necessity |

Ninety days is v1.2's recommendation, not a law, standard, industry requirement or repository-measured optimum. The repository supplies implementation semantics, not correction-age frequency or staffing evidence. The old-resident anchor can make “90 days” much more restrictive than time since discovery. Retaining it is defensible only with explicit owner acknowledgment of that cost and a functioning exceptional route. Changing to discovery date or most recent updatedAt without trusted field provenance would weaken control; no such change is silently recommended here.

### Six boundary examples under unmodified v1.2

All dates below are hypothetical and specify the earliest candidate day; an even earlier effectiveAt/proposed/anchor day would increase age. Examples calculate calendar differences, not elapsed event hours.

| Case | Submission/review calculation | V1.2 route and qualification |
|---|---|---|
| 1 Age 89 at submission and still 89 at review | Earliest 2026-08-10; both actions on 2026-11-07 IST →89 | Normal age; actual financial category still requires independent OWNER |
| 2 Age 90 at submission | Earliest 2026-08-10; submit/review 2026-11-08 →90 | Normal inclusive boundary, if reviewed on that date; not a permanent eligibility reservation |
| 3 Age 90→91 | Submit November 8→90; review November 9→91 | Exceptional OWNER + evidence + rationale, even if originally non-financial |
| 4 Five-year name typo found today | Resident created 2021-11-08, reviewed 2026-11-08 →1826; today effectiveAt cannot win min | Exceptional independent OWNER/evidence; discovery does not reset age |
| 5 Future booking date corrected today | Original start/value 2026-12-01, proposed 2026-12-02, effectiveAt/review 2026-11-08 →0 | Normal age, financial OWNER review; future applicability/physical times still prohibited. If original booking anchor is old, this example no longer has age 0 |
| 6 Recent effectiveAt, old original | Oldest original/anchor 2026-03-08, effectiveAt/review 2026-11-08 →245 | Exceptional; effectiveAt cannot conceal March history |

### Precision assessment and proposed clarifications

V1.2 is internally understandable for ordinary day comparisons, but **not a complete deterministic approval-clock contract**. Required clarifications before freeze:

1. Define day ordinals/difference, inclusive 0–90 and IST midnight explicitly. Validate input/anchors before applying max; clamp prevents a negative age, not permission for forbidden future effective/physical values.
2. Distinguish irrelevant non-date/null values (name/price/reason) from missing mandatory timestamps/anchors. Missing/invalid createdAt, booking start or required event history must fail closed; do not omit them as “non-date” and manufacture recent eligibility. A completed stay missing its actual CheckOut cannot supply an invented departure from updatedAt.
3. Define the decision evaluation instant after locks and revalidation, not HTTP arrival or transaction-start time. On any whole-command retry/restart, recompute it, the IST date, role eligibility and age. A request waiting across IST midnight cannot retain its earlier normal authority.
4. Define whether eligibility is as of that recorded decision instant or commit date. V1.2 does not explicitly decide this. The exact advisory wording below chooses the final recorded decision instant immediately before application, not a post-hoc commit-time reevaluation; commit can occur later. This choice needs owner acceptance/technical review.
5. Clarify that “historical” evidence categories use any earlier affected IST fact day per section 6, while normal/exceptional age uses the complete candidate/anchor minimum. Evidence optional at submission can become mandatory as review age advances; immutable payloads cannot be patched.
6. Resolve absolute year parsing bounds and microsecond preservation for future correction validators. Existing common/input 2000–2100 bounds are sanity checks, not proof that exceptions have a selected age maximum. Existing resolveInstant's default-now/local-time convenience is unsuitable for mandatory correction values. No parser/schema is changed here.

## Decision 4 — Exceptional age, evidence and integrity

### What “no separate maximum” does and does not mean

The normal 90-day window determines which reviewer/evidence process applies; it does not assert that all recent requests are valid. Exceptional review beyond that window remains contingent on an independent OWNER, sufficient evidence, explicit rationale, unchanged dependencies and all domain/Finance constraints. It is not unrestricted normal permission and not entitlement to apply an old request. A separate exceptional age maximum would prohibit or further gate older cases even if well-supported; v1.2 proposes none.

| Advisory alternative | Operational and integrity effects | Old identity/completed stay/billing consequences |
|---|---|---|
| 1 No exceptional cap; independent OWNER + evidence + rationale for every old case | Preserves ability to correct any reconstructable fact; increased uncertainty and reviewer burden as evidence ages; no automatic eligibility | Five-year name can be repaired if justified; old stays need actual interval history; issued invoices remain immutable |
| 2 Exceptional maximum 1 year | Clear limit, fewer very-old reviews; may leave known errors permanently unresolved inside P4-2 | Five-year name blocked; 8-month stay potentially eligible; billing financial remedies still separately constrained |
| 3 Exceptional maximum 3 years | More historical access than 1 year; larger evidence/reconstruction workload | Five-year name still blocked; older stays may be eligible but not presumed reliable |
| 4 Defined period followed by case-by-case additional approval | Can retain a narrow escape route, but must define period, eligible authority, evidence and whether an extra reviewer/group is required | Could repair older identity facts; otherwise ambiguous and not implementation-ready |

Alternatives 2–4 are new options for owner deliberation, not existing rules. A threshold without a specified period/approval route is not a usable replacement. No cap guarantees evidence exists; no hard cap makes insufficient evidence sufficient. This review recommends option 1 rather than inventing a second reviewer layer or age threshold. Its workload/long-term retention and privacy impacts require explicit owner acceptance.

### Proposed practical evidence standard

V1.2 requires a restricted evidence reference/description (1–2000 characters), not uploads, document-byte storage, KYC or new verification functionality. Examples below are advisory descriptions of existing operational references an owner might use, not capabilities claimed to exist in Nook.

| Category | V1.2 requirement | Advisory sufficiency standard/examples |
|---|---|---|
| Historical financial correction | Evidence mandatory | Original agreement reference for rent; authoritative booking/admission/register context for period errors; explain original versus recorded discrepancy and affected period |
| Historical occupancy correction | Evidence mandatory | Check-in/checkout register entry, contemporaneous arrival/departure operational record or other owner-approved reference that supports the actual instant and does not contradict adjacent stays |
| Every exceptional correction | Evidence plus explicit exception rationale | Evidence must support the specific old fact and the proposed replacement; explain why older correction is justified. Age/rationale alone is not evidence |
| Every monthlyPrice correction, including age 0 | Evidence always mandatory | Original already-agreed rental-term reference; distinguish data-entry error from renegotiation. No new agreed term is inferred |
| Normal firstName/lastName or checkout reason within window | Detailed correction reason; evidence optional | Optional relevant contemporaneous resident/operational register reference; do not impose new identity-document/KYC requirements. Reviewer must still have a defensible reason to accept the exact change |

Evidence strength should match consequences: a claimed arrival/departure instant and rent agreement need more direct support than a routine spelling correction, but no sample list is proof of truth. A reference should be specific enough for an authorized reviewer to locate the entry/period and understand the discrepancy; exclude secrets, excessive personal data or unrelated resident details. “Other owner-approved supporting reference” means an explicitly accepted evidence source, not unrestricted discretion to waive mandatory evidence.

### Immutable evidence and reasoned review

Where the category is mandatory at submission, supply the reference then; server validation rejects its absence rather than creating an approvable request. For categories where evidence is optional, later time/category changes or review findings may require it before approval. Submitted reference/proposed value/reason remain immutable. Do not append/change authoritative evidence silently or reset request time; reject with reason and submit a new linked proposal if stronger evidence is needed. Ordinary administrative follow-up can locate/check the existing referenced material but cannot rewrite the original proposal.

The reviewer must record reasoned evidence adequacy in the decision explanation, including the supported discrepancy and exception rationale where applicable. Do not copy sensitive source content into general audit. Insufficient, contradictory or no-longer-accessible evidence prevents approval when the fact cannot be adequately established. An eligible reviewer rejects with explanation; a pending investigation does not become approval, and no unsupported rejection is fabricated by automation. Inaccessible reference does not automatically mean false evidence: a new linked proposal may identify other supporting material. No new status, binary upload or evidence verification product is invented.

Protected proposal storage retains originals, replacements, reason/evidence, identities, age basis, actual decision time and effectiveAt. General AuditEvent metadata should contain safe organization/actor/proposal/target/field/correlation ids and outcome codes, not free-text personal evidence or before/after values. Same-organization role authorization applies to reference access as well as proposal detail; no unrestricted audit dump or credential-bearing URL. Indefinite personal retention and backups remain subject to production privacy/legal review, not an assumed legal entitlement.

### Evidence cannot replace transaction safeguards

Completed stays must remain CHECKED_OUT; existing physical history is not recreated or reopened. Validate the corrected half-open actual interval [checkInAt,checkOutAt) against all relevant completed/open intervals for the same bed and resident; equal boundaries are adjacent, zero-duration facts follow existing chronology, an active stay has an open end. No fake CheckOut inferred from updatedAt, no bed reassignment/release and no new status command through correction.

Booking intervals remain half-open IST dates; actual overstay after booking end may be true. Revalidate booking/admission/actual arrival chronology and authoritative parent links without making truthful overstay “illegal” to permit billing. Lock targets/parents in the reviewed order, compare dependency snapshots, and serialize concurrent checkout/payment/issue operations. Evidence can support the fact but cannot waive a stale snapshot, overlap or tenant violation.

FinanceService determines genuinely unissued draft recalculation and any explicitly approved ineligible-draft invalidation in the same transaction; required failure rolls back factual application and all audit effects. Issued original amounts/dates/identity facts remain unchanged for unpaid, part-paid, overdue and paid invoices. Factual APPLIED may coexist with linked REVIEW_REQUIRED, not automatic money correction. Existing credit is limited to outstanding balance; fully settled invoices cannot receive that credit. Payment reversal/replacement and void remain separately constrained approved operations; a reversal is not a refund and must not be invented to manufacture credit eligibility.

Do not substitute physical overlap math for the existing Finance rule: stayOverlapsMonth includes departure exactly at month-start in full-month eligibility (`endedAt >= from`), and legacy no-checkout rows use updatedAt as a derived fallback. Those existing billing conventions do not license fabrication of physical timestamp history. Full first-month rent, separate booking/month invoices and manual overdue review remain frozen. No automatic retrospective issuance, overstay charging, penalties, refund, settlement, debit note, write-off or tax correction.

## Decision 12 — Reviewer availability without authority bypass

### Alternatives

| Option | Availability / resident cost | Security and implementation consequence | Advisory assessment |
|---|---|---|---|
| 1 Strict independence; wait for another eligible OWNER when required | Some repairs remain pending indefinitely; resident factual/money uncertainty persists | Preserves frozen rules; clear visible blocker and protected history | Recommended current policy direction |
| 2 Require two active OWNER memberships for organizations needing owner-originated financial/historical repair | Reduces self-request dead ends, but adds staffing/governance obligations | New organization capability/onboarding policy, not current implementation; two memberships still do not guarantee availability/independence | Consider operational readiness planning; do not silently impose a new membership minimum |
| 3 Independently appointed external reviewer | Could improve coverage, but outside-organization access creates privacy/security risks | Requires separately defined roles/appointment, tenant access, revocation and conflict rules; no such authority verified | Separate design only, not an available v1.2 capability |
| 4 Emergency self-approval | Fast but removes separation exactly when pressure is high | Contradicts frozen no-self-approval; cannot be selected as a compliant v1.2 option | Not available under existing owner direction |

“Another OWNER” means another user independently eligible for the particular request, not an extra membership for the same user. Current Membership unique [organizationId,userId] supports a single membership per organization/user; independence must compare trusted user ids. An OWNER FK or reminder does not establish authority. Two accounts controlled by a requester would not be a defensible substitute for actual independent review; account-governance controls beyond current session behavior are not invented here.

### Operational cases under v1.2

| Situation | Permitted reviewer/outcome | Tracking versus approval |
|---|---|---|
| Requester is only OWNER; financial or exceptional correction | Different eligible OWNER required; without one request stays PENDING | Requester may track but cannot approve/reject own proposal; own withdrawal remains a separate reasoned action if permitted |
| Different OWNER temporarily unavailable, user disabled or membership revoked | Unavailable/ineligible person cannot decide; wait for another independent active OWNER | Show availability blocker; no inferred delegation or automatic denial |
| OWNER requests normal non-financial correction; different active PROPERTY_MANAGER exists | That manager can review/reject if independent and case is still normal age | Old resident anchor may override this route |
| Name correction is exceptional by its anchor | Independent OWNER, even though no direct rent calculation | Manager can follow up, not exceptional-approve |
| PROPERTY_MANAGER submits financial correction | Different active OWNER may review; an organization with one OWNER can satisfy independence if requester is the manager | Do not incorrectly require two OWNERs for every financial request |
| Requester OWNER membership revoked while pending | Historical requester identity remains; another eligible independent reviewer may approve/reject per v1.2 | Revoked requester cannot use the old session for new decisions/views/withdrawal; no automatic deletion/cancellation of proposal |
| Factual approver later reviews associated financial remedy | May do so if still eligible independent OWNER for that case; separate reasoned decision and validation required | No third-OWNER requirement inferred; original requester still cannot self-approve. Financial workflow's own request/decision provenance must be reconciled explicitly if it introduces a distinct remedy requester |

SessionService.authenticate currently rejects inactive users/memberships/organizations and returns trusted session organization/role; it does not implement this correction matrix. Future decisions must recheck current authority under their transactional protocol, including retries. A membership revocation race needs actual PostgreSQL acceptance testing, not reliance on a prior HTTP/session result alone. No current automatic promotion or historical reviewer exception is verified.

### Consistency with worksheet Decision 10

Tracking assignment grants no remedy permission. A requester sole OWNER can administratively track an APPLIED fact's unresolved Finance review but cannot self-approve the money operation; a manager's follow-up is not financial authority. Proposed reminders/escalation inform another eligible OWNER or keep the organization queue visibly blocked. They do not solve missing eligibility by auto-approval.

Decision 10's proposed three-business-day SLA is a **financial-review** service target after APPLIED with REVIEW_REQUIRED, not a v1.2 normal-correction approval deadline. Its dueAt is IST midnight on the calendar day after the final eligible business day and overdue is `now >= dueAt` for an unresolved review, including weekends/holidays. Workweek/holiday calendar and SLA remain unapproved worksheet additions, entirely separate from Decision 3's all-calendar-day age. Missing holiday configuration is not an accepted empty holiday list. SLA expiry does not mutate invoices/payments, block resident payment, reopen facts or reduce OWNER independence.

## Twelve connected scenarios

These are hypothetical examples, not actual resident data or executable cases. “Normal” means age ≤90, not approval without a reviewer. In each case active OWNER/PROPERTY_MANAGER may submit only while authorized in the same organization; financial and exceptional rejection require an independent OWNER under the proposed matrix. A requester cannot self-reject or self-approve. Normal non-financial review allows a different OWNER/PROPERTY_MANAGER.

**Retained audit basis for all persisted proposals:** original/proposed/applied values where applicable, reason/reference, effectiveAt, recorded submission/decision instants, candidate/anchor basis and age classification, requester/reviewer identities, correlation/idempotency, terminal decision reasons and linked Finance outcome. Values/evidence remain protected; general events use safe identifiers/codes. There is no fabricated prior evidence, approver or resolved money state. The per-scenario audit notes add to this common basis. A submission rejected before proposal creation is not falsely described as a permanently stored proposal; request/error logging follows existing safe conventions.

### Scenario 1 — Five-year-old name misspelling discovered today

- **Fact/age:** Resident.createdAt 2021-11-08; review 2026-11-08; min with today's effectiveAt gives 1826 days. New discovery is not an anchor.
- **Evidence/actors:** every exceptional request needs supporting reference and rationale. Either active operator submits; a different eligible OWNER approves/rejects. A different manager cannot review this exceptional name case.
- **Outcome/Finance:** possible only if evidence and identity/stale checks pass; no-cap exceptions do not guarantee approval. No direct rent remedy, but invoice/receipt current-name rendering remains an unresolved issue from the prior review.
- **Audit/open decisions:** retain old/new name, old creation anchor and exceptional reasoning, not just discovery narrative. Owner choices 1/2/3/4/12/14 and historical name display remain open; a 1- or 3-year hard cap would block this example unless a new route were defined.

### Scenario 2 — Booking date age 89 at submission, 91 at review

- **Fact/age:** earliest candidate 2026-08-10; submit November 7→89; independent OWNER reviews November 9→91. Parent/proposed days are assumed no earlier for this example.
- **Evidence/actors:** historical financial evidence is already mandatory at age 89; exceptional rationale becomes necessary at 91. Either active role submits; only different OWNER approves/rejects, including at normal age because booking dates are financial.
- **Outcome/Finance:** re-evaluate as exceptional; the existing immutable proposal can proceed only if its original evidence is sufficient and the decision includes exception rationale. If more evidence is needed, reject/resubmit rather than patch. Finance assesses affected drafts/issued slots separately.
- **Audit/open decisions:** retain submission/review dates/ages and changed eligibility plus Finance links. Choices 3/4/8/9/10 and decision-instant clarification remain open; do not grandfather age 89.

### Scenario 3 — Historical monthlyPrice against a fully paid issued invoice

- **Fact/age:** assume original booking start is 2026-03-08; review November 8→245, even if price discovery/effectiveAt is today.
- **Evidence/actors:** original agreed-term reference mandatory for any price correction; exceptional evidence/rationale additionally applies. Either role submits; independent OWNER reviews/rejects.
- **Outcome/Finance:** correct the source fact only if valid and allowed while a separate issued REVIEW_REQUIRED is visible. Issued invoice is unchanged. Existing balance-limited credit refuses a fully settled invoice; no automatic refund, reversal, void or invented debit remedy. A separately authorized OWNER may record no supported remedy with reason.
- **Audit/open decisions:** preserve price/anchor/agreement reference, paid invoice link, factual and separate financial decisions. Choices 3/4/8/9/10/12 remain open; unsupported accounting policy is not solved by exception approval.

### Scenario 4 — Disputed checkout eight months ago

- **Fact/age:** original checkout 2026-03-08 and review November 8→245 unless an earlier proposed/effective day raises age.
- **Evidence/actors:** historical occupancy/financial and exceptional evidence required, e.g. contemporaneous departure record. Either role submits; different OWNER reviews/rejects. A disputed reference is not presumed true.
- **Outcome/Finance:** approve only after evidence adequacy plus actual check-in/checkout, other bed/resident intervals, tenant/parent and Finance checks. Reject contradictory evidence; if source changed, STALE follows its own transactional rule. Completed status persists. Issued review may be required; genuine drafts follow approved Finance rules.
- **Audit/open decisions:** retain dispute/evidence adequacy and protected old/new instants; no fabricated history. Choices 3/4/5/6/7/8/9/10/12 remain open; factual dispute cannot be “fixed” by a billing operation.

### Scenario 5 — Manager requests name correction older than 90 days

- **Fact/age:** assume resident creation earliest day is 120 days before review. Today's effectiveAt does not reduce it.
- **Evidence/actors:** manager can submit; evidence and explicit exception rationale needed; only a different active OWNER can approve/reject, not another manager.
- **Outcome/Finance:** may apply if supported/valid; lack of eligible OWNER leaves pending. No amount change is inferred; current-name invoice display remains unresolved.
- **Audit/open decisions:** retain manager identity and OWNER exception explanation or rejection. Decisions 2/3/4/12/14 and name display remain unapproved; do not create manager exceptional authority.

### Scenario 6 — Sole OWNER requests financial booking-date repair

- **Fact/age:** assume booking anchor 10 days old→normal age; financial classification is enough to require independent OWNER. Older age would add exception controls.
- **Evidence/actors:** requester OWNER may submit with historical financial evidence. Only a different eligible OWNER can approve/reject; none is available in the premise.
- **Outcome/Finance:** proposal stays PENDING, factual source and invoices unchanged. No APPLIED-linked financial review is created merely to bypass the unapproved fact. Own withdrawal may be used under its separate proposed rule; no self-review.
- **Audit/open decisions:** retain proposal/blocked follow-up without inventing an approver; no correction application audit. Decisions 2/3/4/11/12 govern handling; a new reviewer model is separate policy, not an emergency override.

### Scenario 7 — OWNER's normal name correction with manager available

- **Fact/age:** assume resident.createdAt, effectiveAt and relevant facts are 10 days old or newer, so min→10; this assumption matters because most old residents would be exceptional.
- **Evidence/actors:** normal name reason required, evidence optional. OWNER submits; different active PROPERTY_MANAGER or OWNER may review/reject.
- **Outcome/Finance:** manager can apply after identity/tenant/dependency checks; source classification remains non-financial. No monetary remedy inferred; acknowledge current-name issued display issue.
- **Audit/open decisions:** retain independent manager and exact name/effective/recorded facts. Decisions 1/2/3/4/12/14 and display policy open. OWNER role does not require an OWNER peer for a normal non-financial case under the proposal.

### Scenario 8 — OWNER's name request becomes exceptional by creation anchor

- **Fact/age:** assume Resident.createdAt 400 days ago, today's discovery/effectiveAt; min→400. Manager availability does not change age.
- **Evidence/actors:** OWNER submits with evidence; different OWNER alone can approve/reject with rationale. Manager may follow up but cannot decide.
- **Outcome/Finance:** pending if no independent OWNER; otherwise only evidence-supported application. No direct rent amount change; historical invoice-name display still open.
- **Audit/open decisions:** retain creation-anchor basis so a recent typo is not falsely declared recent source history. Decisions 3/4/12 and classification/display decisions open; changing the anchor is an explicit amendment, not discretion during review.

### Scenario 9 — Submitted evidence later contradicts the request

- **Fact/age:** suppose physical correction min is 45 days old; normal age, but mandatory historical occupancy evidence. Age cannot establish truth.
- **Evidence/actors:** either role initially submitted. Independent OWNER reviews/rejects; contradictions prevent approval until resolved through sufficient evidence in a new immutable proposal.
- **Outcome/Finance:** eligible reviewer rejects with reason; better evidence requires a new linked request/key/current snapshot. No source, invoice or automatic financial-review outcome changes just because review failed. If source dependency changed instead, STALE must not be mislabeled evidence rejection.
- **Audit/open decisions:** retain original disputed reference, protected explanation and rejection/link; never overwrite evidence to remove the contradiction. Decisions 4/11/14/16 and evidence standard need explicit selection.

### Scenario 10 — Referenced record no longer accessible

- **Fact/age:** assume an exceptional 120-day correction; loss of access does not change candidate age or reset submission time.
- **Evidence/actors:** either role may have submitted originally; different OWNER must decide/reject. A reference string by itself is inadequate if the fact cannot be established; loss of access is not automatically proof of falsity.
- **Outcome/Finance:** no approval on inaccessible mandatory support alone. Administrative follow-up may locate the same record; if adequacy cannot be established, reasoned rejection and a new linked proposal with alternate support is the v1.2 route. No direct Finance mutation. Financial consequence depends on the field if a later request applies.
- **Audit/open decisions:** preserve reference/access obstacle privately and actual disposition, no fetched document bytes or fabricated verification. Decisions 4/12/14/16 and permitted supporting references remain open.

### Scenario 11 — Requester's membership revoked before review

- **Fact/age:** age still derives from original category facts, e.g. 100 days→exceptional; revocation does not make facts younger.
- **Evidence/actors:** request was submitted while authorized; revoked user may not make new requests/actions via old session. Another active independent OWNER may review/reject an exceptional/financial request; normal non-financial follows its own matrix.
- **Outcome/Finance:** v1.2 permits a valid historical proposal to be reviewed despite requester revocation; no automatic deletion. Verify current reviewer authority and current source facts/evidence. Any financial remedy remains separate; no auto adjustment on revocation.
- **Audit/open decisions:** retain historical requester identity/status context and actual later actor, not replace requester with a current member. Decisions 2/4/12/14/16; reviewer revocation races require separate transaction validation.

### Scenario 12 — Financial review overdue and no eligible independent OWNER

- **Fact/age:** factual correction already APPLIED at a prior valid decision. Its original historical age/anchors remain recorded; no new factual approval age is manufactured by SLA expiry. Reviewer availability may have changed since application.
- **Evidence/actors:** original submission was authorized; protected evidence/Finance links remain. Only an eligible independent OWNER may record financial resolution. A sole requester OWNER/manager may track within allowed access, not approve a remedy.
- **Outcome/Finance:** unresolved issued review remains REVIEW_REQUIRED and, if its operational policy is later adopted, visibly overdue at `now >= dueAt`. It does not become a rejected/cancelled fact or automatically paid/refunded invoice. Wait for eligible review; no new source proposal is implied by a reminder.
- **Audit/open decisions:** retain original factual decision, Finance link, tracking/reminder/escalation history and unavailable-reviewer blocker under future approved rules; no fictitious financial approver. Decisions 8/10.1–10.4/12/14/16 remain open, including workweek/holiday/SLA choices.

## Consistency with previous review and authoritative documents

- Proposed submitters remain OWNER and PROPERTY_MANAGER; review authority depends on financial/exceptional category and distinct user identity, not just the requester's role. No self-approval or own rejection is introduced.
- AdmissionDate remains conservatively OWNER-reviewed even though current Finance calculations do not consume it directly. Exceptions can upgrade a normally non-financial name/reason request to OWNER-only review.
- Old Resident.createdAt anchors remain as proposed; no discovery-date/updatedAt shortcut is adopted. Current invoice/receipt name rendering remains an unresolved display-policy issue; neither immutable historical name snapshots nor new monetary consequences are assumed.
- Direct PUT/mixed-status bypasses, Resident notes absence and legacy check-in notes effects identified in the earlier review remain distinct implementation/reconciliation issues. Historical exception review does not excuse leaving those bypasses open or invent new profile fields.
- Existing booking extension authority remains OWNER/PROPERTY_MANAGER and updates the same booking. End-date lengthening cannot be disguised as P4-2 correction or privileged reversal; no new correction separation policy is applied to the existing extension command.
- Worksheet Decision 10 operational tracking, SLA, escalation and resident communications remain unapproved additions. dueAt and business days do not redefine the normal historical lookback or create permission. No notice, overdue state or appointed tracker can authorize a financial operation.

## Advisory recommendations — owner choices remain blank

### Recommendation for Decision 3

**Recommended choice: AMEND.** Retain the proposed 90-day inclusive duration and all field-specific anchors; amend precision, not the normal lookback duration.

**Recommended exact replacement/clarifying wording for a future reconciled specification:**

> At submission and at the final application decision, calculate age as the non-negative difference in IST calendar-day ordinals between the evaluated current date and the earliest required candidate day. Candidate days are effectiveAt's IST day, both original/proposed days for a date-valued field and the category anchor in the approved anchor table. Age 0–90 inclusive is normal; age 91 or greater is exceptional. Do not count elapsed 24-hour blocks, server-local dates, business days or discovery time. The current anchors remain Resident.createdAt for names; original booking start for booking dates/price; original admission day; original check-in/out event day; and original checkout day for departure reason.
>
> Null/text/decimal values are ignored only where they are not date facts. Missing or invalid required anchors/events fail validation; they are never dropped to reduce age or replaced with updatedAt/now. Validate future effectiveAt/physical timestamps separately before applying the age clamp. Future booking/admission values are permitted only under their approved lifecycle rules.
>
> For approval, after all required blocking locks and source/role revalidation, sample a single trusted current decision instant immediately before final validation/application. Use its Asia/Kolkata day for all final age/exception checks and persist that instant, selected policy version, candidate-day basis and resulting age/authority classification with the protected decision. This is the authorization decision's time, not transaction start, HTTP arrival, effectiveAt or commit time. If further blocking waits or a retry/restart occur before application, resample and repeat the final checks. A midnight crossing before the final sample can require exceptional OWNER review; a later commit does not retrospectively change an already valid recorded decision. Failure of authority/evidence requirements leaves no factual application. Exact idempotent replay returns its original outcome rather than a new decision-time approval.

This wall-clock sampling/persistence is a proposed future contract, not existing fields/code. In a PostgreSQL implementation review, distinguish a current wall-clock sample from transaction-start defaults such as now(); do not assume AuditEvent's current default automatically implements the required late decision-time evaluation. No SQL is executed here. If the owner instead wants commit-day eligibility, that is a different rule requiring a specific reviewed transaction design before freeze; it is not assumed.

**Reasoning:** this makes boundary behavior deterministic and prevents eligibility captured before a long wait surviving into the next IST day. Keeping the earliest anchors prevents recency laundering without inventing field provenance.

**Trade-offs:** old resident typos can still need scarce OWNER review; midnight/long-wait cases can fail or escalate; capturing exact basis and testing clock/lock retries adds engineering work. A recorded decision-time rule is auditable but must be distinguished from commit-time policy. Ninety days remains an owner operating choice, not evidence-based legal necessity.

**Required specification amendments:** insert the exact precision contract above; define canonical date/day representation and mandatory anchor failure; clarify same-day historical-evidence semantics and existing parser year/microsecond constraints; document refusal/resubmission when crossing eligibility makes evidence insufficient. Do not silently change an old proposal's original values or add mandatory evidence to its payload.

**Dependencies:** Decisions 1/2 field/classification, 4 evidence/exception, 5 stale groups, 6 locks, 8/9/10 money consequences, 12 reviewer availability, 14 protected age-basis retention and 16 retries/stale/replay. Decision 10 business-day SLA remains separate.

### Recommendation for Decision 4

**Recommended choice: ACCEPT** v1.2's no-separate-cap exceptional route and evidence categories, subject to the explicit precision clarifications in Decision 3 and recorded evidence-review semantics below.

**Recommended exact policy:** beyond the approved normal limit, only a different active same-organization OWNER can approve/reject, with mandatory supporting reference/description and explicit exceptional rationale. No separate exceptional maximum age and no entitlement to application. Historical financial/occupancy and every monthlyPrice correction require evidence; exceptional names/reasons also require evidence. Normal in-window names/reasons need a detailed reason, evidence optional. The original-agreement/register examples in this review are advisory acceptable-source examples for owner selection, not KYC or upload features.

**Reasoning:** a hard age ceiling could permanently strand provable identity/history errors; controlled independent review plus inability to waive domain constraints is more defensible than either permanent prohibition or unrestricted ordinary authority.

**Trade-offs:** very old history may be unreconstructable, reviewers must refuse inadequate cases, residents may face rejection/resubmission delays and OWNER workload grows. No cap does not create a supported money remedy for old paid invoices. Long-retained personal evidence requires privacy/legal review. A one- or three-year cap remains an owner alternative, not selected here.

**Required specification clarifications before freeze:** explicitly require evidence at submission when mandatory then; re-evaluate sufficiency at final decision; record adequacy/exception explanation in protected decisionReason; immutable references cannot be patched if evidence must change; contradiction/inaccessibility preventing sufficiency leads to reasoned rejection and a new linked proposal, not automatic falsity, overwrite or approval. Administrative attempts to locate the same referenced material are not authoritative payload changes. Keep STALE for changed dependencies, not as an evidence-rejection substitute. Specify future approved protected access and permitted reference descriptions without credential-bearing URLs, document bytes or general audit narrative. Preserve all lifecycle/Finance/tenant/transaction checks even after evidence is judged adequate.

**Dependencies:** 1/2/3 scope/roles/age, 5/6/7 dependency and relational safety, 8/9/10 existing financial limits/review, 11 linked replacement requests, 12 eligibility, 14 legal/privacy/retention and 16 idempotency. Owner still explicitly accepts, rejects, amends or defers; no selection is entered in the form.

### Recommendation for Decision 12

**Recommended choice: ACCEPT** strict independent review and pending-until-eligible handling. Do not impose a new two-OWNER organization minimum or external role through this review.

**Recommended exact policy:** only current active same-organization authorized reviewers may act; compare requester/reviewer user identities. A different PROPERTY_MANAGER may review normal non-financial requests; any financial or exceptional historical request requires a different OWNER. A sole OWNER may review a different manager's qualifying request if independent and eligible, but not their own. If no eligible independent reviewer exists, retain PENDING and its original age basis, with truthful tracking of the blocker; never auto-approve, reject, cancel, redate or change authority. A revoked requester's valid historical request remains reviewable by another eligible independent actor; the revoked user gains no continuing action rights. A factual approver may perform a later separately authorized financial review only if still independently eligible; no third approver is inferred and no client-supplied link creates permission.

**Reasoning:** preserves frozen separation/financial rules while avoiding the mistaken rule that every financial request requires two OWNER memberships regardless of who requested it.

**Trade-offs:** eligible OWNER absence can produce indefinite delay and resident uncertainty, especially old names that become exceptional. Operators need clear queue/blocker visibility and realistic independent-review coverage; reminders cannot cure absent authority. Two-OWNER readiness planning may reduce risk but would be a separately selected operating requirement; external reviewer models require new authorization/security design. No self-approval emergency option complies with the frozen direction.

**Required specification clarifications before freeze:** explicitly distinguish sole OWNER as requester versus independent reviewer of a manager; distinguish inactive/revoked/unavailable reviewer from revoked requester; keep linked Finance review/escalation authority separate from tracking; define current-authority checks on retries/decisions and validate revocation races in the reviewed transaction protocol. If financial workflow adds a separate remedy requester, reconcile its separation-of-duties/provenance contract explicitly rather than granting the factual approver unrestricted authority. Record the availability blocker without inventing new correction statuses or promising any SLA outcome. Decision 10 operational defaults must be approved/reconciled separately before their implementation.

**Dependencies:** 2 matrix, 3/4 exceptional routing, 6 authorization concurrency, 8/9/10 supported remedy and tracking, 11 own withdrawal, 14 retained identities and 16 replay/retry authorization. Independent OWNER staffing is not solved by provisioning or role changes in this task.

## Read-only implementation-impact inventory

| Area | Verified source behavior | Future requirement if separately authorized | Unverified assumption / exit evidence |
|---|---|---|---|
| common/time.ts and common/input.ts | IST/UTC helpers and strict date-only round trip; resolveInstant supports local/default-now; absolute year sanity bounds | Mandatory correction-value parser, IST day ordinals, exact offset/precision handling; final evaluation instant after waits | No correction-age function exists; strict instant overflow and historical bounds need explicit tests rather than assumed reuse |
| Correction proposal validation/age | No implemented proposal/evidence/lookback engine found | Server snapshots, immutable candidate-day basis, normal/exceptional classification at submission/final decision and policy version | Exact model/time fields and SQL types require P4-2.1 review; no code generated |
| Booking/Admission services | Bed→Booking checks; current direct date/rent PUT; pre-read Admission validation and partial audit atomicity | Close previously identified bypasses, revalidate parent chronology and source snapshots under reviewed lock protocol | Grouped repairs unsupported; parent/rent/status change races require PG evidence |
| CheckIn/CheckOut services | Core PUT changes blocked; transactional creation/checkout and actual instants; active-status occupancy | Full historical bed/resident interval validation, completed-state preservation, no fabricated timestamps | Missing checkout/legacy fallback handling cannot be inferred from updatedAt or evidence string |
| Authentication/membership | Session checks active user/membership/org and returns trusted context; both-role guard | Independent OWNER financial/exceptional decision checks; revoked-requester retention; current review/replay/retry authority | Membership revocation races/lock interactions and remedy requester provenance require independent transaction review |
| Evidence references/protected access | No correction evidence or binary-upload mechanism established | Validate restricted reference/description and reasoned adequacy; immutable payload; linked resubmission; role/tenant protected access | Locating/validating real external records is manual policy evidence, not automatic product verification; no new fetching/upload permission |
| Resident history/AuditEvent projection | Existing known lifecycle metadata allowlist; no general correction evidence projection | Atomic submitted/applied/rejected/stale/withdrawn events with safe codes; protected original/evidence and actual recorded time | Existing general audit defaults/metadata do not establish tamper-proof or lawful indefinite personal retention |
| Finance classification/review links | Full rent and booking/stay months; inclusive checkout billing boundary; credit balance limits; current both-role Finance endpoints | OWNER-gated correction impacts, transaction-aware genuine-draft consequences, separate issued REVIEW_REQUIRED/resolution | Draft recalculation helper and linked decision authority absent; name display unresolved; no refunds/debits/write-offs/tax operation |
| Review queue/UI | ResidentProfile uses existing async/paging/error/empty patterns | Show age basis, as-of review instant, exceptional evidence/rationale, eligibility/blocker and separately pending financial outcome | Workflow UI must not display candidate values as applied or tracker/escalation recipient as approver; no current exception queue implied |
| PostgreSQL constraints/transactions | Typed source tenant keys and timestamp columns; no correction tables/indexes currently | Reviewed proposed typed FKs/partial pending-field indexes/terminal checks, exact snapshot and atomic source/Finance/audit/receipt writes | SQL definitions in v1.2 are future design, not migrated/tested facts; no index can prove evidence truth or reviewer availability |
| Tests | Existing date/input/booking/check-in/Finance/auth/history and integration test locations | Unit: calendar ordinals/89–90–91/offset/leap/missing anchors/future input; service/controller: evidence/roles/tenant/revocation; PG: midnight lock waits/retries/approve-reject/checkout/payment/issue races and rollback | Disposable PostgreSQL requires explicit authorization; no test execution or production/database inspection occurred |

Additional proposed acceptance examples: same-day normal physical event versus earlier-day historical evidence; effectiveAt earlier than all source dates; future booking with old start anchor; inaccessible/contradictory evidence; rejected/resubmitted age changes; two users with separate roles in one versus another tenant; revoked original requester versus revoked reviewer; sole OWNER submitting versus reviewing manager; factual approver's later independent money review; decision instant before/after IST midnight; later commit without a new logical decision; exact committed-STALE replay and no reapproval on retry. These are test requirements, not executed or new authorized tests.

## Scope integrity and readiness

All three primary documents remain unchanged. Only this new review is the workspace deliverable. No source/schema/migration/test/config/environment/marketing change, credential access, database connection, application-changing command or Git mutation occurred. Calendar example arithmetic and document coverage checks are not application or PostgreSQL tests. No legal compliance or empirically optimal lookback claim is made.

Readiness is for owner deliberation. V1.2's current age formula is not yet sufficiently precise at final decision time to freeze for implementation; the exact Decision 3 advisory amendment addresses that gap without changing its 90-day anchors. Owner must select the historical policy and reconcile the final specification. Implementation authorization for P4-2.1 or later slices is not granted; independent schema/transaction review, explicitly authorized disposable PostgreSQL acceptance and production privacy/legal review remain separate incomplete gates.

DECISIONS 3, 4 AND 12 — READY FOR OWNER REVIEW

## Final owner decision form

Advisory choices above do not fill these records. All owner fields below remain blank.

### Decision 3 — Normal historical lookback

- Decision: NOT APPROVED
- Owner selection:
- Selected lookback:
- Age-calculation policy:
- Approval-time boundary:
- Required amendments:
- Rationale:

### Decision 4 — Exceptional historical corrections and evidence

- Decision: NOT APPROVED
- Owner selection:
- Exceptional age policy:
- Evidence requirements:
- Evidence sufficiency/rejection policy:
- Required amendments:
- Rationale:

### Decision 12 — Sole-OWNER handling

- Decision: NOT APPROVED
- Owner selection:
- Independent reviewer policy:
- Unavailable-reviewer handling:
- Escalation boundary:
- Required amendments:
- Rationale:
