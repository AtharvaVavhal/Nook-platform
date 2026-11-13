# P4-3 transfer status — 2026-11-11

## Reconciliation and persistent finance infrastructure — 2026-11-11

This update supersedes earlier implementation blockers below; it does **not** approve owner decisions or certify Phase 4 acceptance.

- **P4-6:** implemented append-only assignment replacement chains tied to independently applied correction proposals. Original assignments remain immutable. Corrected outer boundaries retain PostgreSQL microseconds; internal transfer boundaries cannot move. Source change, replacement, audit, finance consequences and receipt roll back together. Effective assignment projection is read-only to runtime. Existing financial correction gate stays OFF.
- **P4-4:** existing extensions now consume reconciled physical segments; verified destination/overlap serialization, live authorization, audit, unchanged admission and contractual rent. Reused existing extension rules; no additional policy or detailed numbered acceptance specification was recovered.
- **P4-3/P4-8:** added persistent transfer-linked finance obligations and immutable independent OWNER resolutions, identity/FK/period/idempotency constraints, audit, protected list/resolve routes and review state in history. Review creation and resolution remain unconditionally disabled pending F1. Unresolved/unsupported obligations suppress generation, draft creation and issue; release never automatically issues. Existing issued invoices/payments are preserved.
- **Consumer readiness:** booking, check-in/checkout, extension, correction, inventory, summary, finance/scheduler and backfill use effective segments. Corrupt active chains conservatively retain occupancy. Added transactional/idempotent new-check-in mirroring behind an always-disabled R1 gate; backfill retries preserve reconciled history. No target adoption occurred.
- **Migration/CI:** additive `20261111110000_assignment_replacements_transfer_reviews` and regenerated client; original migrations unchanged. Updated exact catalog and runtime privilege contracts for 23 migrations, including btree_gist overloads, deferred proof and SELECT-only projection. Unexpected objects, modified definitions and excess privileges still fail. Migration applied only to fresh disposable tmpfs clusters.

| Milestone | Current implementation status |
|---|---|
| P4-3 | Atomic infrastructure, consumers and persistent reviews implemented; approval workflow/F1/R1, official T1–T10 and full race campaign block acceptance. |
| P4-4 | Independently documented extension behavior implemented/verified; detailed milestone acceptance specification absent. |
| P4-5 | Existing admission preserved; document/KYC specification and acceptance missing. |
| P4-6 | Replacement-chain reconciliation implemented/verified; production financial correction application remains OFF; coordinated adoption/acceptance outstanding. |
| P4-7 | Existing atomic checkout now consumes reconciled chains; settlement policy/specification absent. |
| P4-8 | Transfer review persistence, billing suppression, immutability and privilege safeguards implemented/verified; F1 activation and detailed acceptance remain blocked. |

**Verification actually completed:** API/web typechecks and focused lint PASS; focused checks 52/52 and 88/88 (overlap exists; not a unique total); 7/7 Chrome fixture-API UI checks including finance state; 15/15 replacement/finance/adoption/extension/HTTP PostgreSQL checks, run `19cf97c4-9ed1-47af-a7ae-e7c18b20b87e`; 15/15 existing atomic-engine PostgreSQL checks against the new projection, run `509c700e-0535-4bce-8bfa-6577306684aa`; 4/4 live CI catalog/privilege checks, run `2ba1e86f-a261-436f-8458-fcc9b5d156f5`; 502/502 CI contract/mutation/adapter checks and 42/42 integration guard checks. Raw database evidence is in the corresponding `integration-<runId>.txt` files. All three disposable containers were removed with cleanup verified. Scope **17/18**, solely pre-existing real `.env` restriction; guard/configuration preserved. No baseline full-suite rerun.

**T1–T10 preparation:** T1 atomic service path; T4 destination races; T5 independent-review denial; T6 history rendering; T7 persistent obligation/suppression; T8 uncertain-commit replay; T9 tenant isolation; T10 actual lock timeout have supporting focused coverage. T2 queue and T3 protected approval detail depend on A1's missing approved workflow. These service/HTTP/UI fixtures do **not** establish real API + Chrome + disposable PostgreSQL T1–T10 acceptance. Nine concurrency pairs × 1,000 also remain outstanding.

**Remaining:** D1–D8, A1 roles/lifecycle, F1 trigger/timing/resolution and target R1 approval; missing detailed P4-4–P4-8/document/settlement acceptance; separate P4-2 acceptance/sign-off. Finance corrections OFF, production/extended transfer execution disabled, new-assignment adoption disabled. No existing database migrated, live backfill, commits, pushes, merges or deployments. **Phase 4 is not ready for acceptance.**

---

## Build-mode update — 2026-11-11

- Added `apps/api/src/transfer/transfer.execution.ts`: atomic assignment close/open, immutable Transfer, three audits and versioned HMAC receipt; exact replay with current DB authorization; same-org gate/ordered bed locks; bounded transactions, retryable/uncertain errors and destination/interval validation. Wired into the existing module/service. **Production approval/finance gate unconditionally blocks execution before database access; no activation switch or client-supplied approval exists.** Tests use an explicitly separate fixture gate, not an approved production workflow.
- Check-in/correction collision checks now recognize physical assignment segments and retain unbackfilled legacy compatibility. Corrections that would rewrite immutable assignment boundaries fail without mutations; replacement-chain semantics remain unresolved. Finance/scheduler reads validate adopted timelines before billing while preserving the existing booking/month/full-rent rules.
- Fixed zone-less extension timestamp interpretation to Asia/Kolkata. No admission/document or settlement policy was invented. Existing checkout was verified against transfer contention.
- Files: transfer execution/service/module; common stay occupancy; check-in service; correction apply validator/boundary test; finance service/test; extension parser/test; occupancy test; new `scripts/qa/transfer-engine.test.ts`, disposable harness mode, narrow raw-SQL scope registration. No schema, migration, dependency, configuration or feature-flag changes.
- **101 distinct focused unit/DI/harness tests passed (95 + 6); API/web typechecks and focused lint passed.** These checks were necessary for the new transaction provider and changed lifecycle/finance consumers; unchanged broad/browser suites were not rerun.
- **15/15 consolidated disposable PostgreSQL checks passed, zero skipped.** Same-key concurrent replay; exact receipt and three audits; revoked authority/self-review/tenant denial; late finance barrier rollback; same-source/same-destination races; transfer versus booking, extension and checkout; lost-acknowledgement replay; real lock timeout and retry; immutable correction boundary refusal; historical destination collision checks; unchanged issued invoice/payment records; generation once per booking/month. Initial test fixture omitted its mandatory audit request ID; corrected before the final run.
- Final run `546dfd34-bc29-465c-824a-bd518911f06a`, evidence `integration-546dfd34-bc29-465c-824a-bd518911f06a.txt`; exact container cleanup verified, tmpfs discarded, no shared volumes/databases touched. Scope remains **17/18**, solely the existing local `.env` prohibition; it was not weakened.
- Finance corrections verified OFF; extended/runtime transfer execution remains disabled. No commits, pushes, merges or deployments. Official T1–T10 and the nine-pair × 1,000 campaign are **not claimed** by these fixture-gated infrastructure checks. D1–D8, A1, F1, target R1 and missing document/settlement/milestone requirements remain unresolved. Phase 4 is not ready for acceptance.

---

## Completion sprint update — 2026-11-11

**Still not ready for Phase 4 acceptance.** This update supersedes the earlier consumer/backfill status below; retained earlier results remain historical evidence. No owner response approving D1–D8, A1 or F1 was received during this sprint.

| Milestone | Current status | Evidence / remaining requirement |
|---|---|---|
| P4-3 | PARTIAL / BLOCKED | Existing preview/UI/history preserved. Backfill and inventory integration advanced below. Approval/finance contracts, atomic execute, runtime receipt/review and T1–T10 remain blocked. |
| P4-4 Extensions | Existing functionality, acceptance incomplete | Existing extension command and physical destination checks retained; archive hierarchy validation strengthened. No detailed numbered milestone acceptance matrix recovered. |
| P4-5 Admission/documents | BLOCKED for documents | Admission exists. Upload/KYC access, storage, retention and verification requirements are missing; no invented pipeline. |
| P4-6 Check-in/corrections | PARTIAL / BLOCKED | Check-in archive hierarchy and backfill concurrency verified. Immutable assignment start/end versus correction reconciliation still requires a supported contract; financial application stays OFF. |
| P4-7 Checkout/settlement | Checkout implemented; settlement BLOCKED | Prior atomic checkout evidence retained; backfill observes committed checkout under the gate. Settlement/refund/deposit policy is absent. |
| P4-8 Finance integrity | Existing controls retained; acceptance incomplete | No invoice/payment/financial-service changes. One-invoice-per-booking/month and immutable money history remain intact. Transfer review linkage/timing and a milestone-specific acceptance matrix remain missing. |

The user's current labels above supersede older proposed milestone groupings. Search covered repository Markdown/specs/status/ADRs, root roadmap and blocker register, prior Phase 2/3 contracts, DOCX handbook text and available git history/path records. No authoritative detailed P4-4–P4-8 acceptance specifications were recovered. Scope labels alone were not treated as new financial/document/security rules.

### Independent implementation completed

- **Backfill:** lazy database initialization; identities-only probes; live re-read under the existing org gate and booking/check-in/checkout locks. Dry runs use read-only snapshots. Concurrent runners cannot duplicate originals. INSERT SELECT preserves PostgreSQL microseconds. Contradictory, overlapping or invalid existing assignment/transfer chains are quarantined rather than overwritten. CLI disconnects cleanly and withholds arbitrary database errors. No target/shared backfill or adoption was performed.
- **Inventory consumers:** archive and operational-status changes take the org gate, then tenant-scoped beds in UUID order. Archive protection includes physical assignments, legacy occupancy and existing reservations/admissions, including parent hierarchy archives. Existing out-of-service policy was preserved; serialization was added. Booking availability and booking/check-in validation now respect archived floors/properties.
- **Scope guard:** narrow registration of existing transfer models/routes/migration objects, read-only transfer SQL, inventory locks, and previously unregistered correction guard/deadline objects. No migration or constraint changed, no checker was disabled, and the existing local-env restriction remains enforced. Authorization provenance is in the existing implementation record.
- **One consolidated owner document:** `../OWNER_DECISIONS_REQUIRED.md`, updated in place with actual D1–D8 choices, recommendations/consequences, approval contract A1, finance ambiguity F1, target adoption R1 and missing milestone requirements. No recommendations were silently approved.

### New verification

- **44/44 focused tests passed**, including changed booking/check-in rules, inventory service boundary, correction inventory isolation, backfill chain validation and disposable harness safeguards. Four classifier tests were rerun after adding transfer-link consistency validation; they are included in 44, not counted again.
- **42/42 scope-guard self-tests passed.** Scope verification: **17/18 checks passed**; only S1's pre-existing real local `.env` restriction fails. Local configuration was preserved; no clean scope PASS is claimed.
- **5/5 focused PostgreSQL tests passed, zero skipped.** Covers dry/live/concurrent/repeated backfill; exact microseconds; orphan and overlap quarantine; actual org-gate wait and committed checkout re-read; physical assignment protection across archive hierarchy; foreign tenant isolation; status-change gate wait and availability exclusion.
- Final isolated run **690ea794-ee7a-4916-b9a6-39a36fb2fc9f**, raw sanitized evidence `integration-690ea794-ee7a-4916-b9a6-39a36fb2fc9f.txt`. Cleanup verified for the exact container; tmpfs discarded, no shared database/volume changes. Fresh migrations were only test bootstrap prerequisites.
- API/web typechecks, focused lint and targeted tracked handwritten whitespace checks: PASS. No full baseline suite or unchanged browser suite rerun. Financial correction flag verified OFF in process/local configuration; configuration unchanged. Extended execution remains disabled.

### Changed files this sprint

`scripts/backfill-stay-assignments.mjs`, `scripts/stay-assignment-backfill-rules.mjs`, `scripts/qa/stay-assignment-backfill-rules.test.mjs`, `scripts/qa/transfer-consumers.test.ts`, `scripts/qa/phase4-disposable.mjs`; `apps/api/src/inventory/inventory.repository.ts`; booking/check-in services and rules with their existing rule tests; correction inventory-boundary test commentary; `scripts/phase_scope.json`; existing implementation authorization, owner-decision document and this report.

**Remaining blockers:** D1–D8/A1/F1 and target R1 approval; transfer proposal/review model and runtime commands; transfer finance linkage/suppression and its independent review; check-in assignment creation and immutable correction reconciliation as part of coordinated rollout; execution concurrency/idempotency and T1–T10; detailed remaining milestone requirements; local S1 guard condition. No commits, pushes, merges, deployments or live rollout occurred.

---

## Previous transfer implementation record

**P4-3 remains incomplete.** This record uses the milestone grouping in the current task; the specification's §13–14 groups history, integration, browser and owner review differently. Its acceptance gates have not been relaxed or renamed.

| Requested milestone | Result |
|---|---|
| P4-3.2 backend | Preview/history and protected fail-closed POST retained; finance preview, IST booking boundaries and calendar validation added. Atomic transfer execution, runtime receipts and requester/reviewer authorization remain blocked. |
| P4-3.3 finance | Read-only exact Decimal reference-price comparison and IST billing-period review indication implemented. No proration or financial writes. Persistent transfer billing-gap creation/review remains blocked by its missing linkage contract. |
| P4-3.4 frontend | Active-stay action uses server allowedActions; cascading property/room/bed selection, current-bed exclusion, service-state display, advisory preview, reason, errors and disabled confirmation implemented. A guarded command handler retains its key after uncertain answers; actual execution/retry acceptance is blocked. |
| P4-3.5 history | Transfer history UI implemented with actor, reason, source/destination, effective/recorded times and pagination. Existing tenant-scoped history API verified against PostgreSQL. |
| P4-3.6 integration/concurrency | Physical assignment projection, checkout closure and extension destination checks implemented and verified. Transfer-execution races/idempotency and all nine race pairs × 1,000 remain blocked/unverified. |
| P4-3.7 browser acceptance | Seven focused browser UI checks pass using explicit API fixtures. These do not satisfy the required PostgreSQL T1–T10 execution acceptance. |
| P4-3.8 final acceptance | Not accepted. All D1–D8 remain explicitly unresolved; extended execution remains disabled. |

## Changes in this task

- `apps/api/src/transfer/transfer.finance.ts`: advisory financial projection, precise price difference and mid-month review period. No financial model writes.
- `apps/api/src/transfer/transfer.service.ts`, `transfer.controller.ts`: financial/policy details, server actions, explicit blockers, IST interval bounds, invalid calendar-date rejection.
- `apps/api/src/stay-summary/stay-summary.service.ts`: active assignment determines physical location; inconsistent chains fail closed; active stays advertise transfer preview.
- `apps/api/src/checkin/checkin.service.ts`: org gate, physical-bed/booking locks, assignment closure and checkout share one transaction. CheckOut retains its original check-in bed to satisfy the existing lifecycle integrity trigger. Audit additionally records the physical bed and assignment.
- `apps/api/src/booking/booking.service.ts`: extension locks commercial/current physical beds in UUID order and checks both added intervals, preserving existing extension behavior after checkout.
- `apps/api/src/resident-history/resident-history.service.ts`: allows physical checkout/assignment identifiers through the existing audit projection.
- `apps/web/src/ops/Transfers.tsx`, `ResidentProfile.tsx`, `opsApi.ts`: transfer preview workflow and history.
- Focused checks: `apps/api/test/transfer.preview.test.ts`, `stay-summary.service.test.ts`, `scripts/qa/transfer-readiness.test.ts`, `scripts/e2e/transfers-ui.e2e.mjs`. The existing disposable harness adds an explicit full-profile `transfer-readiness` mode.

## Verification

- API and web typechecks: PASS. Focused lint of edited modules/tests/harnesses: PASS.
- Transfer/stay-summary/harness checks: 46 distinct tests passed. The initial HTTP test was blocked by sandbox loopback permissions; that one test passed on its authorized rerun. No full API/web/integration baseline suite rerun.
- Browser: 7/7 real React/Chrome checks with fixture APIs, zero writes/page errors. Covers destination/service restrictions, financial display, blocked execution, occupied/error recovery and escaped history. Not T1–T10 acceptance.
- PostgreSQL: 5/5 focused checks, zero skipped. Tenant-scoped history/physical summary; destination reservation blocks extension without effects; late audit failure rolls back assignment and checkout; two concurrent checkouts yield exactly one success and one 409; completed chains preserve existing extension behavior; execution remains blocked without changing the chain.
- Final disposable run: `b093814c-d44f-4ccf-abe9-100893788d07`; evidence `integration-b093814c-d44f-4ccf-abe9-100893788d07.txt`. Exact container cleanup verified; tmpfs discarded, no volumes created/deleted. Migrations were bootstrapped solely as prerequisites for the new isolated tests; foundation files/constraints were not modified.
- Earlier test fixture errors (SQL parameter typing, duplicate bed labels, missing wait for options) were corrected. The checkout test exposed the original lifecycle bed-match constraint; the implementation was corrected to preserve it, then rollback/contention checks passed.
- Financial correction flag verified OFF in process/local configuration; unset retains the existing OFF default. No configuration, invoice/payment data, schema, migration or immutability protection changed in this task. No commit, push, merge or deployment.

## Owner decisions and blockers

No new approved decision record was supplied during this task. The authoritative repository specification still marks each decision unapproved:

| Decision | Status |
|---|---|
| D1 immediate/backdated effective time | OWNER DECISION REQUIRED |
| D2 scheduled future transfers | OWNER DECISION REQUIRED; execution disabled |
| D3 cross-property transfers | OWNER DECISION REQUIRED; execution disabled |
| D4 overdue/overstay eligibility | OWNER DECISION REQUIRED |
| D5 different reference price/rent review | OWNER DECISION REQUIRED; no rent change implemented |
| D6 resident confirmation | OWNER DECISION REQUIRED |
| D7 booking audit/history placement | OWNER DECISION REQUIRED; dedicated transfer history implemented, no new booking-transfer audit policy |
| D8 partial stay/return scheduling | OWNER DECISION REQUIRED; execution disabled |

Additional blockers:

1. **Requester/reviewer contract:** no approved approval operation, durable approval record or requester/reviewer fields exist. A session role cannot prove separation. No fabricated reviewer or approval was introduced.
2. **Transfer finance-link contract:** `CorrectionFinanceLink.proposalId` is required and references `CorrectionProposal`; no transfer-linked financial review contract exists. A synthetic correction proposal or weakening its FK would invent a financial policy. Preview marks the review requirement and unsupported linkage explicitly.
3. **Backfill and coordinated rollout:** intended-target backfill/quarantine owner review is still absent in repository evidence. Check-in assignment creation, correction/assignment reconciliation and inventory mutation safety still need coordinated implementation before assignment rollout. Billing remains booking/check-in based, preserving the original contract; transfer-aware review linkage is not ready. The proposed transfer source-row-before-org-gate order must also be reconciled with the existing gate-first writers before execution races can be certified.
4. **Acceptance:** no successful transfer execution, transfer financial review or runtime transfer receipt replay is claimed. T1–T10 and the specified transfer race campaign remain blocked; they cannot be replaced by fixture previews or checkout contention evidence.

**Exact Phase 4 status:** P4-3 has additional implemented and verified functionality but is not complete or accepted. P4-4 through P4-8 were not implemented or inferred. Phase 4 is not complete.
