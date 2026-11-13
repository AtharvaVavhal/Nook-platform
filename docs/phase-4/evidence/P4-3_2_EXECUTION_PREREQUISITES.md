# P4-3.2 execution prerequisites — 2026-11-10

Latest verification: `P4-3_2_SAFE_VERIFICATION.md` supersedes the earlier unverified-migration status below. All 22 migrations and focused receipt/backfill checks passed on a fresh disposable cluster; cleanup verified. Requester/reviewer approval, target backfill sign-off and coordinated rollout remain missing. POST remains 503 with zero database effects.

Status: PARTIAL / EXECUTION BLOCKED. Existing preview/history APIs retained. No atomic execution or approval is claimed.

## Receipt contract prepared

New additive migration: `20261110120000_transfer_command_receipts`. Separate immutable `transfer_command_receipts` table, with no correction-proposal dependency. Scoped unique key `(organization_id, actor_id, idempotency_key)`; unique transfer reference; composite FK binds the receipt to the exact transfer organization, actor and key. HMAC request fingerprint column, versioned original response JSON, and response ID consistency check support eventual payload conflict detection and exact replay. Update/delete are rejected with SQLSTATE 23001. Receipt insertion must share the effect transaction; this schema alone does not implement runtime replay or prove rollback behavior.

Prisma model/client updated; new manifest checksum recorded, manifest pinned count advanced to 22. Existing migration contents/checksums unchanged. Disposable harness treats the new table as append-only when granting runtime access. Prisma generation and manifest verification passed, without a database connection. This migration has NOT been applied or tested against PostgreSQL during this task.

## Reader changes completed

- Booking creation uses assignment-aware active occupancy with tenant scoping and legacy fallback only when the booking has no assignment chain.
- Shared booking overlap query additionally checks active destination assignment segments against the booking's approved end date, retaining Asia/Kolkata date comparisons, self-exclusion and existing commercial reservation checks.
- Available-bed list and physical occupancy/overstay report derive the physical bed from the assignment, retaining original check-in bed for unbackfilled stays. Ambiguous or missing active segments in an existing chain fail closed.
- Check-in creation's destination occupancy check uses the same assignment-aware predicate.

Commercial reservation rules and Booking.bedId are unchanged: original commercial bed reservations are not silently released. No finance/billing calculations changed.

## Unresolved policy and rollout blockers

Repository search found only `P4-3_TRANSFER_SPECIFICATION.md` and its draft; both explicitly state policies are not owner approved. Specification §12 says all D1–D8 remain OWNER DECISION REQUIRED. No approved requester/reviewer workflow, approval record or requester/reviewer identity field was found. Session actor role does not establish who requested/reviewed a transfer. A reviewer UUID supplied by a client would not prove approval and has not been introduced.

Required policy evidence: approved document/rules defining submission and approval actors, eligible role combinations, durable approval record, revalidation/revocation behavior, and immediate effective-time/consent policy. Testing authorization is not policy approval. Requester/reviewer separation cannot safely be invented.

Specification §15 forbids partial assignment rollout; §4.4 requires reviewed backfill. Remaining readiness work includes checkout assignment closure/current-bed locking, extension/current-bed locking, inventory archive safeguards, corrections and stay-summary physical readers, and scheduler/finance consumer readiness. These are not declared complete by updating the main occupancy readers. Finance integration is outside this task. No backfill approval was inferred.

POST remains fail-closed with `TRANSFER_EXECUTION_UNAVAILABLE` before database writes. Its blockers now identify receipt migration verification, requester/reviewer contract and assignment consumer rollout. UUID-ordered bed locks, atomic assignment changes, transfer event/audit/receipt writes, runtime idempotency and rollback acceptance remain unimplemented pending those prerequisites. There is no hidden activation switch or unchecked atomic write entry point.

## Focused checks actually run

- 38 tests passed, 0 failed, 0 skipped: transfer preview/history/execution-blocker, stay occupancy, booking rules, check-in rules. Tests use fakes for database behavior; real Nest loopback routing/guards are exercised. No PostgreSQL integration claim.
- API typecheck: PASS.
- Focused lint on edited backend/test files: PASS.
- Prisma Client generation: PASS with dummy local URL and DOTENV_CONFIG_PATH=/dev/null; no database connection.
- Migration file/manifest verification: 22/22 checksums match. The first verification invocation omitted tsx and failed Node's unsupported-TS-syntax loader; rerun with the repository loader passed.
- Targeted handwritten diff whitespace check: PASS. Existing generated whitespace is not an acceptance claim or reformatted cleanup.

No PostgreSQL, container or volume provisioned/touched. No commits, pushes, merges or deployments. P4-3.3 not started. Full P4-3.2 remains incomplete.
