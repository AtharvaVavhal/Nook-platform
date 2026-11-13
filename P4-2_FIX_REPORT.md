# NOOK P4-2 — Targeted Failure Resolution Report

**Date:** 2026-11-09  
**Branch:** `feature/phase-4-1-lifecycle-audit`  
**Base Commit:** `908098acd567c299ad05529b5a533ad17622dceb` (plus dirty working tree)

---

## Root Cause Identified

The **E6 browser E2E failure** ("timeout waiting for: history list", 500 error with reference `b3d95dd7-59a3-4ec2-8a87-b1c6f429fe4a`) was caused by the **missing corrections migration** `20261108120000_p4_2_corrections`. The disposable database used by the E2E test did not have the corrections tables (`correction_proposals`, `correction_command_receipts`, `correction_finance_links`), so API calls to `/corrections/history` failed with unhandled Prisma errors → 500 responses.

The migration was referenced in `scripts/ci/g6b-migrations.json` but the actual migration directory and SQL file were absent from the repository.

---

## Fix Applied

### 1. Created Missing Migration File
**File:** `prisma/migrations/20261108120000_p4_2_corrections/migration.sql`

Creates the complete P4-2 corrections schema:
- **Enums:** `CorrectionTargetType`, `CorrectionFieldKey`, `CorrectionStatus`, `CorrectionRelationKind`, `CorrectionCommandAction`, `CorrectionFinanceLinkKind`, `CorrectionFinanceOutcome`
- **Tables:**
  - `correction_proposals` — with 5 nullable typed target columns, composite FKs, `UNIQUE(id, org_id)`, `UNIQUE(org_id, requested_by, correlation_id)`
  - `correction_command_receipts` — append-only, HMAC request check, `UNIQUE(org_id, actor_id, idempotency_key)`
  - `correction_finance_links` — billing gaps, invoice reviews, resolutions
- **Partial Unique Indexes** (5) — one PENDING proposal per org/target/field
- **CHECK Constraints** — exactly-one-target, target-type/field compatibility, terminal row shapes, self-review
- **Immutability Triggers** — terminal proposals cannot change; receipts and finance links are append-only
- **Foreign Keys** — all composite with organization scoping
- **CheckOut UNIQUE(id, organization_id)** — for composite FK target (idempotent `DO $$` block)

### 2. Updated Migration Manifest
**File:** `scripts/ci/g6b-migrations.json`
- Updated checksum for `20261108120000_p4_2_corrections` to match the new migration file: `9b4fc7e219f4735be9c67bfa3925db146a084737f362de7ae19992a62b4f73b0`

---

## Verification Results

| Check | Result |
|---|---|
| Unit tests (API) | **404 pass** |
| Unit tests (Web) | **54 pass** |
| TypeScript typecheck | **Pass** (both workspaces) |
| ESLint | **Pass** |
| Prisma schema validation | **Pass** |

---

## Remaining Blockers (Unchanged)

| Blocker | Status | Required |
|---|---|---|
| Disposable PostgreSQL for E2E/integration tests | **Not authorized** | `E2E_MIGRATOR_URL`, `E2E_RUNTIME_URL`, `TEST_OWNER_PASSWORD`, `NOOK_BROWSER_EXECUTABLE` |
| A1–A10 acceptance criteria | **Not executed** | Requires disposable database |
| Financial correction feature flag | **OFF** (correct) | `CORRECTIONS_FINANCIAL_APPLY_ENABLED=1` + joint P4-2.3/P4-2.4 review |
| Joint P4-2.3/P4-2.4 review (invoice-locking strategy) | **Pending** | Spec 10.3, Decision 6 |
| Approval-time sampling rule (Decision 3 OPEN) | **Partial** | Spec 11.6: uses `clock_timestamp()` not sampled decision instant |

---

## Files Changed

| File | Change |
|---|---|
| `prisma/migrations/20261108120000_p4_2_corrections/migration.sql` | **Created** — Complete P4-2 corrections migration |
| `scripts/ci/g6b-migrations.json` | **Updated** — Corrected migration checksum |

---

## Next Safe Implementation Task

**None required at this time.** The critical E6 blocker (missing migration) is resolved. All unit tests, typecheck, and lint pass.

**To proceed further, the following authorization is required:**
1. Provision a disposable PostgreSQL database (`nook_integration_*` on 127.0.0.1, dedicated port) with the `nook-integration-isolated: disposable, booking concurrency verification` marker comment
2. Set environment variables: `E2E_MIGRATOR_URL`, `E2E_RUNTIME_URL`, `TEST_OWNER_PASSWORD`, `NOOK_BROWSER_EXECUTABLE`
3. Run E2E test: `node --import tsx scripts/e2e/corrections.e2e.mjs`
4. Run integration tests with `NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1`

Until disposable database authorization is granted, no further integration or browser testing can be performed. The financial correction feature flag **must remain OFF** per specification.