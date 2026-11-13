# P4-3.2 preview backend — 2026-11-10

Updated the existing `apps/api/src/transfer/` module in place. No duplicate transfer module was created. Preview is available at GET `/api/v1/transfers/preview`, through the existing AppModule registration.

Changes:
- Replaced nonexistent auth decorators with the existing SessionGuard, RoleGuard and authenticated request context. OWNER and PROPERTY_MANAGER are supported; organization comes from the authenticated session.
- Fixed dependency injection/module imports and incorrect Prisma relation selections.
- Read-only RepeatableRead transaction for consistent advisory reads; no gate, allocations, assignments, invoices, receipts or audit effects are written by the service.
- Current physical bed is taken from the active StayAssignment, rather than historical CheckIn/Booking bed IDs.
- Validates resident, unique active stay without checkout, unique current assignment, booking state, effective interval, destination hierarchy/operational state, UUIDs and zoned timestamps.
- Destination conflicts include overlapping assignment segments, confirmed reservations, and legacy active stays lacking assignments. Intervals use strict start < end and end > start comparisons.
- Decimal prices compared by value. Availability means physical availability within the snapshot; policy warnings are separate. Every response declares advisory=true and executionEnabled=false. It grants no execution authorization.
- Existing execute placeholder fails closed with 503 TRANSFER_EXECUTION_UNAVAILABLE; no execution route was added. Owner decisions and rollout/backfill prerequisites remain unresolved. P4-3.3 was not implemented. Full specification P4-3.2 acceptance includes execution, so this preview work alone does not establish full milestone acceptance.

Verification:
- API typecheck: PASS (`npm run typecheck --workspace @nook/api`).
- Focused lint: PASS (`npx eslint apps/api/src/transfer apps/api/test/transfer.preview.test.ts`).
- Focused tests: 9 passed, 0 failed, 0 skipped. Covers current assignment, room/bed type, Decimal equality, tenant scoping/not-found behavior, stale states, overlap checks, date/input validation, role matrix, and actual Nest HTTP router/session/role guard wiring with fake authentication repository and database boundaries.
- Command: `TSX_TSCONFIG_PATH=apps/api/tsconfig.json node --import tsx --test apps/api/test/transfer.preview.test.ts`. First sandbox attempt could not bind a loopback listener (EPERM); authorized rerun passed all nine tests. These are focused unit/HTTP tests, not real PostgreSQL integration evidence.
- New test registered in the quality manifest.
- Existing generated Prisma trailing whitespace remains; generated files were not reformatted.

No PostgreSQL/container provisioning, shared database access, commits, pushes, merges or deployments performed during this implementation. Real PostgreSQL preview integration and execution/rollout acceptance remain outstanding; prior P4-2 evidence is unchanged.

## Execution/history follow-up

Added GET `/api/v1/transfers/history`: session/role protected, tenant-scoped resident lookup, stable recordedAt/id pagination, matching scoped count and limited actor projection. History reads use the same read-only snapshot pattern as preview.

Added POST `/api/v1/transfers`: session/role/origin/CSRF protected; validates supported fields, UUID idempotency header, reason and zoned effective time. Execution returns 503 `TRANSFER_EXECUTION_UNAVAILABLE` with explicit blockers before database effects. Retrying the same request therefore writes nothing; this is not a claim of implemented idempotent transfer execution.

Atomic execution, UUID-ordered bed locking, decision receipts and execution audit writes are NOT implemented. The following verified specification/schema conflicts prevent safely enabling them without a schema/contract decision:

1. Specification §6.2 step 11 requires CorrectionCommandReceipt. Prisma CorrectionCommandReceipt has a required proposalId foreign key to CorrectionProposal and CorrectionCommandAction has no transfer action. There is no transfer proposal/receipt relation. Reusing Transfer's unique key as a substitute receipt would depart from the stated receipt contract, particularly for request fingerprint/replay handling.
2. Specification §1/§7 prohibits self-approval, but the POST contract and Transfer model identify only one actor and contain no requester/reviewer or approval reference. No supported rule can distinguish requester from reviewer without defining that contract.
3. Specification §15 prohibits partial rollout and requires all physical availability consumers to use StayAssignment. Existing booking/check-in/admission/finance source does not reference StayAssignment. Enabling assignments-only transfers would leave occupancy and availability readers inconsistent. P4-3.1 also requires owner backfill review; no approval is inferred from the existence of its models.

No new policy, financial integration, placeholder correction proposal, alternate receipt scheme, migration or activation switch was invented. P4-3.2 remains INCOMPLETE/BLOCKED for execution. A schema/contract decision and assignment-consumer readiness are required before atomic writes can be enabled.

Latest checks: API typecheck PASS; focused lint PASS; focused preview/history/execution-blocker tests 11 passed, 0 failed, 0 skipped. The existing HTTP guard test uses real Nest routing/guards with fake authentication/database boundaries. No real PostgreSQL execution, concurrency or idempotency acceptance evidence is claimed. No database/container was provisioned. No commits, pushes or deployments.

Receipt/reader prerequisite follow-up: see `P4-3_2_EXECUTION_PREREQUISITES.md`. A separate transfer receipt migration/model and main occupancy reader support are now prepared. Latest focused tests 38/38, typecheck/lint and 22 migration checksums pass. Migration application, approved requester/reviewer policy and complete assignment rollout remain unresolved; POST stays blocked and no atomic execution is claimed.
