# Phase 4 engineering closeout — 2026-11-10

**NOT READY FOR FULL CLOSURE.** Milestone counts: **0 COMPLETE, 3 PARTIALLY COMPLETE, 5 BLOCKED**. These counts measure documented milestone acceptance, not the amount of existing code. No transfer execution or assignment rollout is enabled. Financial correction application remains OFF. No production operations, commits, pushes, merges or deployments occurred.

## Investigation and recovered scope

Reviewed Phase 4 specifications/status/authorization/evidence and owner decisions, prior Phase 2/3 scope/API-contract records, root `NOOK_LAUNCH_ROADMAP.md`, `NOOK_BLOCKER_REGISTER.md`, `PLAN_4E_CHECKIN_CHECKOUT.md`, backend/frontend modules, schema/migrations, test fixtures and TODO/FIXME references. Git history includes `f155686` (roadmap/blocker/4E plan) and `731d2c4` (Phase 3 workflows); current HEAD `908098acd567c299ad05529b5a533ad17622dceb` predates the dirty Phase 4 implementation. No numbered P4-4–P4-8 definitions were recovered from available repository/history evidence. The launch roadmap's A–H phases and Task 4E's internal phases are distinct numbering systems; they are not asserted to be P4 milestones.

Earlier roadmap claims about missing UI/API functionality are stale in several places: current CheckIns provides active/history views, CRUD client methods and checkout; booking availability already recognizes active check-ins and now assignments. These features were reused rather than duplicated. Roadmap proposals for transfer invoicing do not override the current transfer specification or frozen billing rules.

## Complete milestone matrix

Candidate P4-4–P4-8 groupings below are **PROPOSED — NOT APPROVED**. They are concrete scope recommendations based on existing architecture, not recovered original requirements. Approval may replace their numbering/grouping without discarding existing code.

| Milestone/status | Original requirement / source | Current implementation | Missing implementation / dependencies | Acceptance criteria / tests required | Remaining blocker |
|---|---|---|---|---|---|
| P4-1 — PARTIALLY COMPLETE | Resident history/stay-summary/profile per Phase 4 implementation authorization and existing contracts | Tenant-scoped history and summary, FinanceService balances, profile wiring, correction history; existing service/browser evidence | Complete milestone-level acceptance traceability; no original standalone P4-1 acceptance specification was recovered | Existing history/summary/profile tests and E5/E6/E9 evidence; full scoped acceptance confirmation | Existing functional passes do not define an absent full milestone acceptance boundary |
| P4-2 — PARTIALLY COMPLETE | Correction lifecycle/audit/idempotency/financial protections and A1–A10; specification v1.3 | Functional browser/integration implementation, receipt/trigger safeguards, deadline fix; financial activation OFF | A2 distribution plan, A3 residual evidence/matrix, A4 margin, A5 baseline comparison, A9 HTTP measurement | See `evidence/P4-2_FINAL_ACCEPTANCE_CLOSURE.md`; retained A6/A8/A10 evidence is not rerun | Mandatory performance criteria remain partial/blocked; independent finance activation review remains separate |
| P4-3 — PARTIALLY COMPLETE | Transfer specification: assignment model, reviewed backfill, preview/execute/history, atomic locks/receipt/audits, coordinated consumers | Models/migrations, transfer-only receipt contract, preview/history, explicit blocked POST, main occupancy readers | Requester/reviewer policy/model, remaining assignment lifecycle consumers, real atomic execution/replay/audits and concurrency acceptance; reviewed backfill/rollout required | Existing disposable migration/receipt/legacy/backfill evidence; latest quarantine change needs fresh PG checks; later real execute/race/browser coverage only after prerequisites | Execution and rollout intentionally disabled; no approval inferred |
| P4-4 — BLOCKED | No original definition found. Proposed: booking/admission workflow closure, based on roadmap E-06 and existing modules | Existing booking create/update/cancel/extend, admissions and UI/API contracts | Confirm exact scope, then verify/fix documented contract gaps without altering commercial rules; depends on auth/inventory/residents | Proposed: tenant-safe booking→admission and extension/cancel flows, API compatibility, no overlap/regression, focused unit/PG/browser coverage | Milestone scope/acceptance mapping unapproved; no new business rules proposed |
| P4-5 — BLOCKED | No original definition found. Proposed: check-in/checkout reliability, using Task 4E and roadmap E-08–E-10 | Existing active/history screens, lifecycle commands, occupancy, immutable checkout history | Confirm scope and finish actual lifecycle edge-case coverage; approved booking/admission prerequisite; transfer rollout remains independent and disabled | Proposed: consistent active/checked-out views, clean duplicate/invalid/cross-tenant errors, legacy availability preserved; unit/PG/browser tests | Scope mapping unapproved; settlement/KYC excluded until separately decided |
| P4-6 — BLOCKED | No original definition found. Proposed: existing Finance lifecycle verification, using roadmap Phase B and Task 4E Finance contract | Existing drafts/issues/payments/reversals/adjustments/voids/scheduler and FinanceService authority | Confirm scope; verify existing frozen full-first/full-final-month/no-proration and invoice immutability only; no automatic settlement or new pricing | Proposed: authoritative balances, safe retries, tenant isolation, existing finance unit/PG/browser regressions; no correction activation | Scope mapping unapproved; financial activation/review gates remain distinct |
| P4-7 — BLOCKED | No original definition found. Proposed: cross-workflow authorization/tenant/API hardening, based on roadmap Phase D and existing guards | Session/role/CSRF/origin guards, protected routes and regression coverage | Confirm endpoint matrix and close demonstrated gaps using existing permissions; depends on chosen P4-4–P4-6 scope | Proposed: deny anonymous/foreign-tenant/unsupported-role writes, no secret leakage or unexpected API 5xx; focused security/API checks | Scope mapping unapproved; no new role/approval policy inferred |
| P4-8 — BLOCKED | No original definition found. Proposed: synthetic owner journey and engineering acceptance, based on roadmap E-13 / H | Disposable harness, browser suite, sanitized evidence and cleanup checks | Confirm exact journey/device/error matrix and mandatory earlier acceptance criteria; no pilot/deployment inferred | Proposed: defined synthetic flows pass with counts, clean resource cleanup and explicit disabled-feature behavior; independent approvals listed separately | Scope mapping and prior mandatory acceptance unresolved; fresh heavy testing blocked by disk |

These proposed specifications use existing services and constraints. They add no KYC provider, upload storage, refund/settlement rule, new rent policy, transfer approval exception or production scope. Until the mapping is confirmed, work on recoverable existing contracts can proceed under their own identities; it is not claimed as completion of an unknown numbered milestone.

## Independently actionable engineering completed this sprint

1. Transfer preview now rejects both INACTIVE and ARCHIVED residents, satisfying the documented active-resident prerequisite. Previously only ARCHIVED was rejected. No execution behavior was enabled.
2. Backfill now classifies ambiguous/inconsistent history before attempting assignments: multiple check-in periods (one ORIGINAL per booking cannot represent them), active-with-checkout contradictions, missing checkout records, inconsistent tenant/resident/booking/bed relationships and nonpositive completed intervals. Such records are quarantined, not repaired or silently chosen. Valid and empty histories retain their existing behavior. This does not authorize live backfill or implement rollover/transfer semantics.
3. Added focused regression coverage for these validation failures and no-mutation behavior.

Files changed in this sprint: `apps/api/src/transfer/transfer.service.ts`, `apps/api/test/transfer.preview.test.ts`, `scripts/backfill-stay-assignments.mjs`, new `scripts/stay-assignment-backfill-rules.mjs`, new `scripts/qa/stay-assignment-backfill-rules.test.mjs`, this closeout, and `OWNER_DECISIONS_REQUIRED.md`. Existing dirty tracked/untracked work preserved; generated files and migrations were not rewritten in this sprint.

## Verification actually executed

Unique final focused test run: **25 passed, 0 failed, 0 skipped**, duration 824.31925ms. The earlier standalone 3 backfill-rule passes are included in those 25 and are not counted twice.

Exact commands:

```sh
TSX_TSCONFIG_PATH=apps/api/tsconfig.json node --import tsx --test apps/api/test/transfer.preview.test.ts apps/api/test/stay-occupancy.test.ts scripts/qa/phase4-disposable.test.mjs scripts/qa/stay-assignment-backfill-rules.test.mjs
npm run typecheck --workspace @nook/api
npm run typecheck --workspace @nook/web
npx eslint scripts/stay-assignment-backfill-rules.mjs scripts/qa/stay-assignment-backfill-rules.test.mjs apps/api/src/transfer/transfer.service.ts apps/api/test/transfer.preview.test.ts
node --import tsx --input-type=module -e 'import {readFileSync} from "node:fs"; import {verifyMigrationFiles} from "./scripts/ci/g6b-migration.js"; verifyMigrationFiles("prisma/migrations",JSON.parse(readFileSync("scripts/ci/g6b-migrations.json"))); console.log("22 migration manifests/checksums verified; no database contacted");'
```

API/web typechecks PASS; focused lint PASS; 22 migration files/checksums verified. HTTP regression uses real Nest router/session/role guards with fixture authentication and database fakes. Tenant/status/input checks and execution blocker coverage pass. New backfill classifier tests cover consistent/empty data, ambiguity, parent/tenant mismatch and invalid intervals. These are not real PostgreSQL execution claims. API routes/response shapes are retained; the inactive-resident case intentionally changes to 409.

## Reused evidence and current limits

- Browser: 10/10 baseline (`evidence/browser-f36d19b7-5907-4b71-b860-f346c5015c7d.txt`), reused for unchanged browser workflows; no new browser run claimed.
- Broad PostgreSQL integration: prior 321/0 baseline and separately executed A6 scenarios remain historical evidence; no new full suite claimed.
- Disposable `0aa9a0e3-ba96-4a5f-9d61-7b420cfe0c18`: 22 migrations, receipt identity/immutability, legacy occupancy and blocked HTTP with unchanged database state passed; exact container cleanup verified. The backfill implementation changed in this sprint, so prior backfill output is supporting evidence only, not verification of the latest classifier integration.
- New PostgreSQL/backfill integration and heavy acceptance execution: **BLOCKED, not skipped-as-passed**. `df -k .` reported 520000 KiB available (~508 MiB) at 100% usage. `NOOK_LAUNCH_ROADMAP.md` §0.5 prohibits heavy tests/database provisioning below 8 GiB. No database/container was created, and no shared container, volume or infrastructure was touched to reclaim space.
- Raw historical A3 failed-run file is now available in the workspace, but its failed timeout sample still was not logged before the assertion. The retained failed run is not erased or declared disproven; exact overrun attribution remains unresolved.
- Existing generated Prisma whitespace warnings are unchanged; a global clean `git diff --check` is not claimed. Targeted checks on relevant tracked handwritten files passed.

## Owner decisions and closure conditions

One consolidated actionable list is in `OWNER_DECISIONS_REQUIRED.md`. The only new proposal is the P4-4–P4-8 scope grouping above, explicitly unapproved. Missing scope is not permission to fabricate acceptance. Engineering deficits, missing disk capacity and unexecuted integration are technical blockers; owner approval cannot turn them into passes.

Next safe work: restore sufficient host capacity without touching protected shared resources, verify the new backfill behavior with the established disposable harness, complete independently specified missing acceptance measurements, and implement newly confirmed P4-4–P4-8 scope. Transfer execution, assignment rollout and financial correction activation remain disabled throughout unless their separate prerequisites are genuinely met and explicitly authorized. Phase 4 is not genuinely ready for closure.
