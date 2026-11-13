# Phase 4 — consolidated owner decisions

Updated 2026-11-13. **D1–D8, A1, F1 and R1 are all UNAPPROVED.** This is the single decision register; it supersedes earlier recommendations in this file without treating them as approvals. Verification evidence is accepted as evidence, not policy or rollout permission.

Sources: [transfer specification](P4-3_TRANSFER_SPECIFICATION.md) §§1,4.4,7–12,14–15; [safe verification prerequisites](evidence/P4-3_2_SAFE_VERIFICATION.md); [latest verified handoff](evidence/2026-11-12_VERIFICATION_HANDOFF.md). D1–D8 options below come from §12. A1/F1 details explicitly marked proposed are decisions still needed to resolve gaps or conflicting text.

## Transfer policy choices

All unresolved rows block production acceptance of **the transfer feature**, not independent development or existing unrelated workflows. Selecting a narrower option excludes the corresponding extension; it does not authorize execution. Overall Phase 4 closeout remains blocked until its required scope is accepted.

| ID | Exact decision / supported choices | Technical consequences | Affected capability |
|---|---|---|---|
| D1 | **A** immediate only; **B** backdated with evidence and OWNER approval (§12). If A, confirm that the server samples the effective time at successful execution, not submission/preview. | A avoids retrospective occupancy edits; the server-time clarification is a proposal, not implied approval. B needs evidence rules, historical interval validation and OWNER exceptions. | All executed transfers; retrospective transfer specifically if B. |
| D2 | **A** no future scheduling; **B** future scheduling with OWNER approval. | A keeps future moves unavailable. B needs reservations, cancellation, intervening conflicts and execution-time revalidation rules. | Scheduled transfers. |
| D3 | **A** same property only; **B** cross-property with OWNER approval. | A retains same-property validation. B needs cross-property eligibility and finance treatment; organization isolation remains mandatory. | Cross-property transfers. |
| D4 | **A** block overdue/overstay residents; **B** allow with OWNER approval. | A requires separate resolution before moving. B requires exception/review criteria; neither choice changes issued invoices or automatically bills overstay. | Transfers for overdue/overstay residents. |
| D5 | **A** block reference-price differences; **B** allow with contractual rent unchanged; **C** require rent review. | A restricts destinations. B displays the difference but preserves rent. C needs a separately specified rent-review workflow; this is not authorization for financial corrections. | Transfers between differently priced beds. |
| D6 | **A** staff initiated without resident confirmation; **B** resident approval required. | A uses the staff review workflow. B needs authenticated consent, notification, expiry/revocation and evidence requirements. | Transfer initiation and consent. |
| D7 | **A** dedicated transfer history only; **B** additionally emit booking.transfer. Confirm A does not remove the three required §8 events: transfer.executed, stay_assignment.closed, stay_assignment.opened. | A retains dedicated presentation and required technical audits. B adds a booking-history event and corresponding projection/tests. | History/audit acceptance. |
| D8 | **A** no bounded partial-stay/automatic-return transfer; **B** support partial segments. Confirm that A still permits a later independently approved immediate transfer. | A excludes scheduled return automation. B needs destination end times, return capacity and return-failure policy. | Partial transfers/automatic returns. |

## A1 — durable requester/reviewer contract

**Blocker:** all production transfer execution and T1–T5/T8/T10. §7 names execution roles and forbids self-approval; it does not define proposal/queue/detail/reviewer authority. The existing receipt/transaction engine is not an approval workflow.

Approve or amend every item below; these are the existing register's **proposals**, not already specified policy:

1. Requesters: active OWNER and PROPERTY_MANAGER, or OWNER only. Both choices preserve tenant isolation; restricting requesters excludes PM submissions.
2. Reviewers: independent active OWNER and PROPERTY_MANAGER, or OWNER only. OWNER-only increases the staffing requirement. Requester and reviewer must always be different user identities, regardless of role changes.
3. Lifecycle: proposed PENDING → APPLIED / REJECTED / WITHDRAWN / STALE. Requester alone withdraws while pending; independent eligible reviewer rejects with a reason. No eligible reviewer means no application, not self-approval.
4. Source changes: proposed STALE without effects; a new proposal must capture new facts. Confirm which source/policy/finance dependencies invalidate a proposal. Required revalidation includes membership/user/org authority, active source assignment, destination availability and approved D policies.
5. Requester revocation: choose cancellation/staleness of their pending requests, or allow independent review of existing requests with requester actions revoked. Neither treatment is specified for transfers; owner must choose and define the terminal status if invalidated.
6. Time: confirm D1 immediate execution-time semantics across queue delay and retries. Replay must return the committed time/result and recheck current authority.
7. Durable evidence: preserve requester/reviewer IDs, request/decision times, reason, source/destination snapshot, terminal outcome, audit and receipt atomically. Queue/detail access, filters and pagination must be specified for T2/T3; do not copy correction permissions silently.

Record the approver, date, chosen role sets and lifecycle decisions. Approval authorizes subsequent implementation only; acceptance and runtime activation remain separate.

## F1 — transfer finance-review policy

**Blocker:** production transfer finance behavior, T7 and transfer acceptance. Frozen invariants: one invoice per booking/month, contractual rent unchanged, no proration, no issued-invoice/payment rewrite, no automatic financial correction.

| Required choice | Supported alternatives / unresolved detail | Technical consequence |
|---|---|---|
| Trigger | §14 says mid-month moves create a billing gap; §9.3 says a newly billable destination month. Choose **every mid-month transfer** or **only newly billable destination months**, and explicitly define newly billable against booking/month billing. | Determines the affected booking-period obligations. Physical movement alone does not establish a new booking/month invoice. Neither predicate may be inferred from the other. |
| Timing | **Atomic transfer plus unresolved review**, consistent with §9.3 creation; or **independent review before execution**, proposed in the prior decision sheet. | Atomic creation requires occupancy/review/audit/receipt rollback together and billing suppression after transfer. Prior review requires a pre-transfer obligation and staleness/revalidation design; existing transfer-linked records alone cannot satisfy it. |
| Authority and outcomes | Confirm independent active OWNER, no self-review, and RELEASED / NO_SUPPORTED_REMEDY. | RELEASED permits the separately authorized supported billing action; it never auto-issues. NO_SUPPORTED_REMEDY remains suppressed. Immutable resolution and live authorization apply to retries as well. |
| Release conditions | State the evidence/reason needed for RELEASED and when NO_SUPPORTED_REMEDY is required. These criteria are not currently defined. | UI may expose only approved resolutions; no invented remedy, invoice adjustment or refund. |

Persistence/suppression/immutability infrastructure is verified. Creation/resolution remain runtime-disabled pending this decision. Policy approval does not enable financial corrections.

## R1 — target adoption and coordinated rollout

**Blocker:** production assignment adoption and transfer rollout; not isolated fixtures or read-only readiness work.

Supported disposition: **hold adoption** until evidence is approved, or **approve a specific target rollout after review** under §§4.4,15. A generic “approve R1” without target evidence is insufficient. A partial consumer rollout is not a supported option.

Before approval, attach: target identity and authorized read-only inspection scope; dry-run counts (eligible, existing, created-if-applied, quarantined by reason); case-by-case quarantine disposition; immutable-chain/consumer compatibility evidence; migration/privilege and required concurrency results; rollout sequence, responsible operator, stop conditions and recovery procedure preserving history. Target dataset evidence has not been collected because existing databases are out of scope.

First approval may authorize a specific read-only target assessment; it does **not** authorize adoption. Final approval must identify the reviewed report, target and coordinated adoption window. Keep the gate disabled until that separate authorization and all engineering prerequisites are satisfied.

## Decision response record

Supply D1–D8 choices; all seven A1 decisions; F1 trigger/timing/authority/release criteria; and R1 = HOLD or a specifically scoped assessment/rollout authorization. Record approver identity and date. Until then every item remains UNAPPROVED. Do not approve this document as one bundle: its unresolved fields need explicit answers.

## Other blockers kept separate

- P4-2 performance acceptance: A2 sampling, A4 margin, A5 comparison/load and A9 responsiveness methodology; see [PERF-01–06](evidence/P4-2_OWNER_ACCEPTANCE_DECISIONS.md). Engineering failures cannot be waived by approving a measurement proposal.
- Financial correction activation requires independent finance review and separate owner authorization; remains OFF.
- Cleanup of the exact candidates in the [resource report](evidence/2026-11-13_EXECUTION_READINESS.md) requires separate approval. No deletion is implied by policy approval.
- Root .env disposition requires owner action; its existence-based scope rule remains unchanged. No cleanup recommendation includes that file.

## Remaining milestone requirements

The current sprint defines these labels. Repository/history searches found existing domain contracts but no authoritative detailed acceptance specifications under these numbered milestones. Do not treat the older closeout's alternative proposed groupings as approvals.

| Milestone | Current user grouping | Existing recoverable rules | Missing decision or source |
|---|---|---|---|
| P4-4 | Extensions | Booking extension command, reason, role, overlap and audit contracts; current physical-bed checks | Milestone-specific acceptance matrix, including transfer/extension scenarios |
| P4-5 | Admission/documents | Booking-linked admission and lifecycle validation; verification-status field only | Upload/KYC scope, storage/access/retention/verification policy and acceptance |
| P4-6 | Check-in/corrections | Task 4E and P4-2 v1.3 rules; existing acceptance evidence | Replacement-chain reconciliation implemented under existing correction lifecycle; coordinated adoption and exact milestone acceptance boundary remain outstanding |
| P4-7 | Checkout/settlement | Explicit checkout without invoice rewriting, cancellation, refund or deposit settlement | Settlement/refund/deposit rules and required acceptance |
| P4-8 | Finance integrity | Existing invoice/payment/adjustment/reversal/void and frozen billing contracts | Milestone-specific integrity/reconciliation matrix and any unresolved source anomaly details |

