# Phase 4 verification — 2026-11-12

**Incomplete. All independently implementable Phase 4 work is NOT yet verified.** This record covers the latest inspected code and this side conversation's checks. No commit, push, merge, deployment, existing database operation or production feature activation occurred.

## Changes verified and failures fixed

- Added real PostgreSQL regression coverage for reviewer revocation while waiting for the organization gate, for both initial resolution and receipt replay. Both return 403 and preserve resolution counts.
- Fixed the migration validator's stale 23 count and ledger test's stale 19 count for the now-pinned 24 migrations. Earlier migration checksums were preserved.
- Captured the new chain-guard catalog from a fresh migrated cluster. Verified the new trigger/function, exact catalog and runtime privileges independently on another fresh cluster.
- Updated the cross-tenant malformed replacement test to expect the earlier chain guard's 23514 rejection, rather than the subsequent FK's 23503. Tenant rejection is preserved.
- Updated the legacy check-in unit fixture to include the required booking/effective-assignment relation. Its missing-checkout protection still returns LIFECYCLE_CONFLICT and performs no write.
- Applied CI-required formatting to the flagged handwritten API/web/CI files, excluding generated Prisma code. No dependency versions were changed.
- Existing latest edits exercised: admission metadata/derived-property audit; check-in current/final physical bed projection preserving original identity; replacement-chain constraints; finance post-lock authority recheck; review concurrency, replay and rollback.

## Exact results

| Check | Result |
|---|---|
| API and web typechecks | PASS |
| API/web/CI lint; targeted new test lint | PASS |
| Initial admission/reconciliation unit run | 23 passed, 0 failed, 0 skipped |
| Scope/database guard self-tests | 55 passed |
| Scope verification | 17/18; S1 real .env restriction FAIL, preserved |
| Full API unit attempt | 428 tests: 412 passed, 16 failed; 15 were sandbox HTTP listener denial, one stale fixture |
| Affected API files rerun | 36 passed, 0 failed, 0 skipped; all 16 initial failures covered, remaining overlap not added |
| Web tests | 54 passed, 0 failed, 0 skipped |
| Static CI contract | PASS |
| All offline CI test files | 749 tests: 748 passed, one stale ledger-count assertion failed |
| Affected ledger suite | 41 passed, 0 failed, 0 skipped; covers the sole offline CI failure |
| Migration/preflight contract recheck | 502 passed, 0 failed, 0 skipped; overlapping evidence, not additive |
| Build | PASS |
| Prisma validation with CI config | PASS |
| Migration content verification | PASS |
| Baseline secret scanner | PASS |
| Prettier | Initial 68 flagged files corrected; recheck isolated one remaining file, then its targeted check passed |
| npm audit --audit-level=high | Exit 0; seven moderate development-tool findings remain; no forced dependency changes |
| Fresh migration/catalog capture | 1 passed; 24 migrations; 33 relations, 198 constraints, 211 functions |
| Assignment/finance PostgreSQL | Initial 19/20; corrected assertion then 20/20, no skips |
| Exact PostgreSQL catalog/runtime privileges | 4/4, no skips |
| Full disposable integration suite | NOT RUN in this continuation: capacity blocker |
| Official T1–T10 browser acceptance | NOT RUN; no fixture checks counted as acceptance |

Disposable run IDs and sanitized raw evidence:
- Catalog capture: `065d033f-d937-4c4e-84fc-5528d92eb5e7`.
- Focused initial: `3452bc1a-1745-4e88-a1ef-b6c96c3673ef`.
- Focused passing: `2b419d72-34da-4077-8131-a0734c086e72`.
- Catalog/privileges passing: `4f1cc7ef-4cb2-42e5-a46c-7e31e7993a68`.

Each has an `integration-<runId>.txt` evidence file. Every created container's label was verified before cleanup; exact removal and tmpfs disposal were confirmed. The fixture suites inject test-only gates/configuration; they do not prove an approved runtime workflow. Shipped financial correction, transfer execution and adoption gates were not enabled.

The full quality invocation list and initial exit codes are in `2026-11-12-verification-commands.json`; its /tmp log references are local diagnostics. Reruns: `node --import tsx --test scripts/ci/migration-ledger.test.js`; failed API files `cors`, `resident-history.controller`, `transfer.preview`, `corrections.bypass` with isolated APP_ENV and no DB credentials; disposable harness modes `catalog-capture`, `assignment-finance`, `catalog-verify` on profile `full`.

## Acceptance status and remaining work

| Milestone | Evidence-backed status |
|---|---|
| P4-3 transfers | NOT ACCEPTED. Mechanical/consumer infrastructure verified in focused tests; durable approved runtime workflow and official acceptance missing. |
| P4-4 extensions | Existing documented behavior covered by focused extension/reconciliation tests; full integration and detailed milestone acceptance outstanding. |
| P4-5 admission/documents | Admission unit regression passes; new real-API admission regression awaits full integration. Document/KYC requirements missing. |
| P4-6 check-in/corrections | Replacement chain, repeated revisions, malformed-chain rejection, historical readers and failure rollback pass focused PostgreSQL checks. Coordinated adoption remains disabled. |
| P4-7 checkout/settlement | Reconciled checkout and immutable history pass focused tests. Settlement policy absent. |
| P4-8 finance integrity | Persistence, independent authority, concurrency, rollback, replay, billing suppression and privileges pass focused tests. F1 activation and full acceptance remain blocked. |

T1 submit/apply, T4 transfer contention, T5 self-review, T8 network replay and T10 lock-timeout execution require the approved runtime approval/execution path. T2 queue and T3 protected detail require the missing A1 workflow. T7 requires F1's trigger/timing/resolution policy. T6 history and T9 tenant-isolation read scenarios can be prepared with real isolated data, but no official Chrome/API/PostgreSQL run was performed here. Do not replace any of these with fixture-gated coverage.

Technical/environment blockers:
- Free capacity fell from 10,760,000 KiB before provisioning to 8,200,000 KiB (about 7.82 GiB), below the 8 GiB heavy-work threshold in NOOK_LAUNCH_ROADMAP.md section 0.5. No shared data or containers were deleted. Restore capacity before full integration/browser runs.
- The real .env scope failure remains. Its guard was neither bypassed nor modified.
- Full integration and real browser tests remain unexecuted; no assertion of zero remaining defects is justified.
- Seven moderate dependency findings remain outside this change's pinned dependency scope.

Owner-policy blockers remain exactly those in OWNER_DECISIONS_REQUIRED.md: D1–D8; A1 requester/reviewer lifecycle; F1 review trigger, timing and resolution; R1 target adoption/rollout; document/KYC and settlement requirements; detailed remaining acceptance boundaries and separate P4-2 acceptance decisions. No policy was silently selected.

Resume with a fresh capacity check, then run the full disposable regression once, fix only reproduced failures, and execute feasible official browser scenarios. Preserve all existing gates and database isolation.
