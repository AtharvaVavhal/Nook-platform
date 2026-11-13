# P4-3.2 safe verification — 2026-11-10

No explicit approved requester/reviewer policy or assignment backfill/rollout sign-off was found. Search included repository Markdown approval/decision documents, the P4-3 specification and draft, and P4-3 evidence reports. Proposed policies and testing authorization were not counted as approvals.

## Disposable verification

Run `0aa9a0e3-ba96-4a5f-9d61-7b420cfe0c18`, established `full transfer-verification` harness. PostgreSQL bound only to 127.0.0.1:52613, fresh isolated named database, tmpfs, generated credentials, separate runtime/migrator identities and existing database marker/suite-lock checks. No shared databases accessed.

All 22 migrations applied. Three focused real PostgreSQL tests passed, zero failed/skipped:

1. Receipt identity mismatch rejected with 23503; duplicate key rejected with 23505; update/delete rejected with 23001; original receipt unchanged.
2. Backfill dry run reported 2 candidates and 1 quarantined legacy CHECKED_OUT record missing a CheckOut, with zero assignments written. Live disposable backfill created 2 assignments (active and completed) and retained 1 quarantine. Repeat created 0, skipped 2 and retained 1 quarantine. Existing legacy occupancy and booking availability were identical before and after. This verifies the stated fixture cases, not every possible legacy inconsistency or a target-dataset backfill approval.
3. Two actual HTTP execution requests with the same key returned 503 TRANSFER_EXECUTION_UNAVAILABLE. Real guards were used with a fixture session authenticator; Prisma/database behavior was real. Fingerprints of every public table were identical before and after. No request effects occurred.

Raw sanitized evidence: `integration-0aa9a0e3-ba96-4a5f-9d61-7b420cfe0c18.txt`. Harness printed CLEANUP VERIFIED for that exact run: labeled container removed, tmpfs discarded, no volumes created/deleted. Backfill ran only inside the verified disposable environment; no rollout was enabled.

Code changes for this verification: explicit opt-in/full-profile-only transfer-verification harness mode, focused verification test, and removal of the resolved receipt-migration blocker from the fail-closed endpoint/test. Authorization and all existing isolation/cleanup checks retained. The backfill script itself was not modified.

After the blocker-list adjustment: 21/21 focused preview/history/blocker, occupancy and harness tests passed. API typecheck and focused lint passed. No broad test suite or benchmark rerun. No finance integration, commits, pushes, merges or deployments.

## Exact missing approvals

- **Requester/reviewer policy approval:** authoritative record defining who requests, who reviews, eligible role combinations, how distinct identities are proven/recorded, and the approval operation. The self-approval prohibition exists in the proposed specification; an approved workflow implementing it was not found.
- **P4-3 scope/policy decisions D1–D8:** approved choices for effective-time/backdating, future scheduling, cross-property moves, overstay/overdue treatment, destination-price differences, resident confirmation, audit/history placement and partial transfers. Unsupported choices can remain explicitly disallowed; no proposal was inferred to be approved.
- **Backfill sign-off (§4.4):** owner review of the intended target dataset's backfill counts and quarantine dispositions before adoption. Disposable fixture counts are verification evidence only.
- **Coordinated rollout sign-off (§15):** explicit approval after all required assignment consumers are ready and the reviewed backfill is complete. Technical reader/lifecycle readiness and P4-2 acceptance remain prerequisites; approval cannot substitute for missing implementation or failed acceptance criteria.

POST remains blocked with 503 and zero database effects. Its remaining runtime blockers are REQUESTER_REVIEWER_CONTRACT and ASSIGNMENT_CONSUMER_ROLLOUT. Full P4-3.2 execution remains incomplete.
