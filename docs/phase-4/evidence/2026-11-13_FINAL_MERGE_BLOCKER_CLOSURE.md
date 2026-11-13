# Phase 4 — final merge-blocker closure — 2026-11-13

## 1. Executive verdict

**NOT READY — BOTH** (technical blockers and owner decisions remain).

- Technical: 8 blockers examined. **2 closed, 5 partially closed with a stated residual, 1 open** (S1 `.env`). Nothing here is certified by hosted CI or a full 13-file integration run.
- Owner: **23 decision/authorization items outstanding**, none approved (§5–§9, §15–§17).
- This verdict authorizes no merge, deployment, transfer execution, assignment adoption or financial correction.

Evidence labels used throughout: **[PRIOR]** existing before this closure run (retained, source verified unchanged where stated); **[NEW]** generated during this closure run.

## 2. Baseline (inspected before changes)

| Item | Value |
|---|---|
| Branch / HEAD | `feature/phase-4-1-lifecycle-audit` @ `908098acd567c299ad05529b5a533ad17622dceb` |
| Remote | `origin` = github.com/AtharvaVavhal/Nook-platform; `git ls-remote origin main` = `908098ac…` = HEAD; `HEAD...origin/main` = 0/0 (local `main` is behind; not used) |
| Working tree at start | 101 modified, 1 deleted, 68 untracked — all uncommitted Phase 4 / UI work. HEAD alone cannot certify the candidate. No staging, commit, push, merge or rebase was performed. |
| Source changes **by this run** | new `scripts/qa/transfer-race.test.ts`; additive `transfer-race` mode in `scripts/qa/phase4-disposable.mjs` (original saved in the session scratchpad; diff = 3 mode lists, one `selected` branch, one env entry, one timeout condition); formatting-only fix to `apps/web/src/ops/Bookings.tsx` (Prettier). New evidence/docs files only. |
| API/Prisma source vs the 161-test run | `apps/api/src`, `apps/api/test`, `prisma/` **not newer** than `integration-fb803dab…` → that evidence remains valid for the API. Web and `scripts/qa` files are newer (re-verified in §4). |

## 3. Technical blockers

| ID | Verdict | Evidence and exact residual |
|---|---|---|
| **B1** S1 root `.env` | **OPEN — owner action** | §14 |
| **B2** DB URL options | **CLOSED** | [PRIOR] unconditional `options=-c timezone=UTC` rewrite removed; `config.ts`/`config.test.ts` SHA-256 **unchanged since** the closure record (re-checked [NEW]); 7/7 config tests, real Prisma pooling kept `statement_timeout` and `TimeZone` over 3 connections (`2026-11-13-blocker-closure-results.json`). Compatibility: operator-supplied startup options now pass through unchanged, as on `main`; no migration step; unsupported/untested: an external PgBouncer. |
| **B3** Full integration | **PARTIAL** | [PRIOR] 161 passed / 0 failed / 0 skipped in 10 files (`integration-fb803dab…`): account-security, auth, booking, checkin, cross-origin, inventory, lifecycle, observability, resident-enquiry, uuid-params. **Not run (BLOCKED — authorization):** the 3 other files of the 13-file `full` list in `scripts/ci/test-files.json` — `corrections` (34 test cases), `finance` (120), `invoice-scheduler` (12) (counts by `test(` occurrences, approximate). `finance` was inspected: it calls `generate-monthly`, payments, reversals and voids, i.e. financial mutation (synthetic, disposable DB) — so it is excluded together with the two files you named. **13/13 is not claimed.** |
| **B4** Hosted CI | **PARTIAL — post-approval gate** | `.github/workflows/ci.yml` triggers only on `pull_request` and `push` to `main`; `g6a.yml` is `workflow_dispatch` + typed authorization. Neither can run on this uncommitted candidate without a remote commit; none was created. [NEW] I ran the CI `quality` job's steps locally (`2026-11-13_closure-quality-gate.txt`): scope self-tests ✔, api typecheck/eslint/prettier ✔, api unit ✔, web typecheck/eslint/prettier ✔ (after the one-file fix), web 113/113 ✔, static CI contract ✔, G6A ✔, G6B + ledger + preflight ✔, ci eslint/prettier ✔, build ✔, `prisma validate` ✔, `npm audit --audit-level=high` exit 0 (7 moderate), **`verify:scope` ✖ 17/18 (S1 only)**. The repo's secret scanner reads every file including the root `.env`; I did **not** run it. Substitute: the same four patterns over 636 git-visible non-ignored files — 0 matches (**not equivalent**, labeled substitute). Residual: `full-integration` job (PostgreSQL 17.10 digest-pinned) cannot be exercised locally; local uses 17.11-alpine. |
| **B5** Migration compatibility | **PARTIAL** | [PRIOR] fresh 24/24 checksums (`b0aa027e…` 3/3), upgrade from main's 18 migrations with 23 legacy tables identical (`54c0ec44…` 3/3), engine-failure probe (`e3726ec4…` 1/1: P3018 partial DDL then P3009; **no automatic rollback**). [NEW] static review of the 6 added migrations: no `DROP` of data objects (one `DROP CONSTRAINT`/re-`ADD` of `correction_proposals_self_review_check` in a table created by migration 1 of the six), no `ADD COLUMN … NOT NULL`, **every `ALTER TABLE` (51 statements) and every trigger targets one of the nine tables the six migrations create** (`correction_proposals`, `correction_command_receipts`, `correction_finance_links`, `transfers`, `stay_assignments`, `transfer_command_receipts`, `stay_assignment_replacements`, `transfer_finance_reviews`, `transfer_finance_resolutions`); **no legacy table is altered**, no `UPDATE/INSERT/DELETE` data statements; the exclusion constraint and indexes are on `stay_assignments` (new). Foreign keys from the new tables reference legacy tables. So an old binary's legacy-table reads and writes are not constrained by anything new. `g6b` offline tests (manifest/ledger) re-passed [NEW]. **Residual (open):** old-binary/new-schema behavior is **inferred from the DDL, not executed** — no old binary was run against the new schema. Ordering/locking: additive new tables take no long locks on legacy tables by inspection; not load-tested. Recovery procedure remains a written procedure (§12). |
| **B6** Backup / restore | **CLOSED at rehearsal level** | [NEW] §12 |
| **B7** Race campaign | **PARTIAL** | [NEW] §13 |
| **B8** Compatibility / regression | **PARTIAL** | Overlaps B3/B5. [NEW] typecheck/lint/build/`prisma validate`/Prettier re-run because web and harness sources changed. Counts are not combined: 113 web + the unit/integration figures above are separate runs. Missing: the 3 financial-mutation integration files; old-binary dynamic check. |

## 4. What was re-run and why

Re-run because source changed: web typecheck, ESLint, Prettier, 113 tests, build (web files newer than prior evidence); `phase4-disposable.test.mjs` 5/5 (harness edited). Not re-run because unchanged: API integration (161), fresh/upgrade/failure compatibility, catalog, 20/20 assignment-finance, T6/T9 browser (re-run once earlier in this session after the web change: `transfer-browser-b473c99e…`).

## 5. D1–D8 transfer policy register — all UNAPPROVED

Approver: none supplied. Approval date: none. Status for every row: **UNAPPROVED**. Source of choices: `docs/phase-4/OWNER_DECISIONS_REQUIRED.md` / specification §12 (not restated in full).

| ID | Question | Choices | Implementation impact | Affected tests/workflows | Risks / dependencies | Required approver |
|---|---|---|---|---|---|---|
| D1 | Immediate or backdated; is effective time sampled at execution? | A immediate (confirm server time) / B backdated with evidence + OWNER | B needs historical interval validation and evidence rules | T1, T8, T10; transfer-engine time tests | Interacts with A1.6 replay time | Project owner |
| D2 | Future scheduling? | A no / B yes (OWNER) | B: reservations, cancellation, revalidation | T1, T4 | Destination contention over time | Project owner |
| D3 | Same property or cross-property? | A same / B cross (OWNER) | B: eligibility + finance treatment | T1, T9 | Tenant isolation unaffected either way | Project owner |
| D4 | Overdue/overstay residents | A block / B allow with OWNER | B: exception criteria | T1, T7 | F1 trigger | Project owner |
| D5 | Different reference prices | A block / B allow, rent unchanged / C rent review | C needs a rent-review workflow (not a correction) | T1, T7 | F1; no financial corrections | Project owner |
| D6 | Staff-initiated or resident consent | A staff / B resident approval | B: consent, notification, expiry | T1, T5 | Resident accounts do not exist | Project owner |
| D7 | History presentation | A dedicated only / B also `booking.transfer` | B adds an event + projection | T1, T3, history tests | Three mandatory audits stay either way | Project owner |
| D8 | Partial segments / automatic return | A none / B support | B: end times, return capacity | T1, T4 | Scheduled return failure policy | Project owner |

## 6. A1 requester/reviewer contract — UNAPPROVED (7 items)

Approver/date: none. (1) requester roles; (2) reviewer roles (independent, never self); (3) lifecycle PENDING→APPLIED/REJECTED/WITHDRAWN/STALE and who may reject/withdraw; (4) what makes a proposal stale; (5) pending requests when requester access is revoked; (6) execution and replay time semantics; (7) T2/T3 queue and detail contract (access, filters, ordering, pagination). Impact: nothing is implemented for proposals/queue/detail; approval alone creates no workflow. Affects T1–T5, T8, T10. Full options: `OWNER_DECISIONS_REQUIRED.md` §A1.

## 7. F1 finance-review policy — UNAPPROVED

Trigger (every mid-month transfer vs only newly billable destination month — spec §14 and §9.3 conflict); timing (atomic with transfer vs independent pre-execution review); release criteria for `RELEASED`; criteria for `NO_SUPPORTED_REMEDY`; independent OWNER, no self-review. Financial corrections stay disabled; persistence/suppression infrastructure is verified, creation/resolution runtime-disabled. Affects T7.

## 8. R1 rollout — HOLD (maintained)

No target named, no read-only assessment scope, no approver, no authorization. A future rollout needs: target identity and read-only assessment scope; dry-run counts (eligible/existing/created-if-applied/quarantined by reason); quarantine disposition; coordinated window, operator, stop conditions, history-preserving recovery; named approver and a separate explicit authorization for any adoption/backfill. Nothing was adopted or backfilled.

## 9. T1–T10 acceptance matrix

Gates (execution, adoption, finance review/resolution, corrections) are all OFF. "Execution permission" = permitted by your standing rules **and** by approved policy.

| Case | Preconditions | Required decisions | Execution permission | Method | Evidence | Result | Exact reason |
|---|---|---|---|---|---|---|---|
| T1 submit→apply | Approved proposal workflow, policies, finance | D1–D8, A1, F1, R1 | **No** (no transfer execution) | Two real UI users | — | **BLOCKED / NOT RUN** | Workflow and policies unapproved |
| T2 queue/filter | Queue contract | A1.7 | No | — | — | **BLOCKED / NOT RUN** | Contract and implementation absent |
| T3 protected detail | Detail contract | A1.7 | No | — | — | **BLOCKED / NOT RUN** | Same |
| T4 destination contention | Real execution path | D1–D8, A1, F1 | No | — | Engineering-only: §13 pairs 4 and 7 (fixture gate) | **BLOCKED / NOT RUN** (official) | Engineering evidence is not official acceptance |
| T5 self-approval refused | Real approval operation | A1 | No | — | — | **BLOCKED / NOT RUN** | A disabled-gate 503 is not SELF_REVIEW/403 |
| T6 history | Seeded disposable data | none | Yes (read-only) | Real Chrome/API/PostgreSQL | **[NEW, earlier this session]** `transfer-browser-b473c99e-8226-4401-8789-aab18dc382b4.txt`; also [PRIOR] f7e90d93…, ed5b33c6… | **PASS** (read scenario only) | 21 seeded records paginate 20+1; no-history state; 18 business tables unchanged; 0 writes/5xx/page errors. Pending proposals not testable |
| T7 billing gap | F1 resolved | F1, A1, R1 | No | — | — | **BLOCKED / NOT RUN** | Conflicting spec text |
| T8 lost-ack retry | Committed execution | A1, D1, F1 | No | — | Engineering-only: transfer-engine uncertain-commit test [PRIOR] | **BLOCKED / NOT RUN** (official) | Same |
| T9 isolation | A/B sessions | none for read subset | Yes (read-only subset) | Real sessions | b473c99e… | **PARTIAL** (read subset **PASS**) | 404 foreign reads/previews, 401 anonymous, 400 supplied org, PM 403 on finance reviews; proposal/approval/write isolation blocked on A1 |
| T10 lock timeout | Real execution | A1, F1 | No | — | Engineering-only [PRIOR] | **BLOCKED / NOT RUN** (official) | Same |

## 10. Integration certification coverage

| Suite | Files | Result | Label |
|---|---|---|---|
| Permitted non-financial | 10 of 13 | 161 pass / 0 fail / 0 skip | [PRIOR] |
| Financial mutation (corrections, finance, invoice-scheduler) | 3 of 13 | **BLOCKED — not run** (needs explicit authorization) | — |
| Assignment/finance consumer checks | focused | 20/20; 5/5; 15/15 | [PRIOR] |
| Race campaign (partial) | `transfer-race.test.ts` | 5/5 pair tests | [NEW] §13 |
| **Full 13-file certification** | — | **NOT CLAIMED** | — |

## 11. Migration and compatibility evidence

See B5. Fresh [PRIOR], upgrade [PRIOR], failure-behavior [PRIOR], static additive review [NEW], offline manifest/ledger tests [NEW]. Not established: old-binary/new-schema execution, nonempty-money-table preservation through *this* chain (relies on [PRIOR] focused suites), production-volume timing.

## 12. Rollback and backup/restore

**Rollback (documented limits, unchanged):** explicit SQL savepoint rollback of each script works; `prisma migrate deploy` does **not** roll back — a failed migration leaves partial DDL and a P3009 lock (verified [PRIOR]). Safe recovery: stop; inspect ledger and catalog; forward repair or restore into a **separate** database; never edit applied checksums, drop append-only history, or revert the app after adoption. No down-migration exists.

**Restore rehearsal [NEW]** — `2026-11-13_restore-rehearsal-report.md`; scratch `postgres:17.11-alpine` on tmpfs, labeled container, removed and verified:
- Fresh migrated database (24 migrations) + synthetic seed (2 organizations, 1 user; an attempted membership seed failed on a nonexistent column and was skipped).
- `scripts/ops/restore-drill.sh run` (existing script): encrypted dump (AES-256, passphrase file mode 600), **restore into a new, separate database** (`nook_restore_drill_closure`), single-transaction restore, source read-only.
- Comparison **PASS** on 12 sections: extensions 2, tables 33, columns 33, indexes 135, constraints 199, triggers 29, functions 211, enums 25, row counts 33, content hashes 32, ledger invariants 12, totals 10. Independent row counts matched (organizations 2, users 1, migration ledger 24).
- **Limits:** it proves procedure and tooling on a scratch source, **not** that a production backup restores; owners/ACLs and runtime-role privileges were **not verified** (`--no-owner --no-acl`); data volume trivial; Railway backup settings remain unestablished; no point-in-time recovery; no off-provider copy.

## 13. Race campaign [NEW]

Command: `NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 RACE_INTERLEAVINGS=1000 node --import tsx scripts/qa/phase4-disposable.mjs full transfer-race` — run `22fcfe85-8fad-4473-a8f4-6f941bcf48f0`, exit 0, 5/5 tests, 719.9 s, fresh tmpfs cluster, cleanup verified. Evidence: `integration-22fcfe85-8fad-4473-a8f4-6f941bcf48f0.txt`. Seed `20261113`. Every iteration builds a fresh synthetic fixture; each operation starts after an independent random 0–39 ms delay; either side may win.

| Spec §11.3 pair | Iterations | Deadlocks (40P01) | Outcomes (a/b) | Transfers / receipts / audits | Invariant violations |
|---|---:|---:|---|---|---:|
| 1 two transfers, same resident | 1000 | 0 | 409/200 479 · 200/409 521 | 1000 / 1000 / 3000 | 0 |
| 2 transfer vs checkout | 1000 | 0 | 409/200 677 · 200/200 323 | 323 / 323 / 969 | 0 |
| 3 transfer vs extension | 1000 | 0 | 409/200 655 · 200/409 345 | 345 / 345 / 1035 | 0 |
| 4 transfer vs new booking on destination | 1000 | 0 | 409/200 670 · 200/409 330 | 330 / 330 / 990 | 0 |
| 7 two residents, same destination | 1000 | 0 | 409/200 483 · 200/409 517 | 1000 / 1000 / 3000 | 0 |
| **5, 6, 8, 9** | **not run** | — | — | — | — |

Checks per iteration: exactly one winner where required; no status other than success/409; receipts = transfers; audits = 3 × transfers; no open assignment after checkout; one active assignment per source/destination. Transfers executed here are the real engine under the test-only `FixtureGate` in a throw-away database (the production gate stays closed) — not real transfers.

**Not the nine-pair release campaign.** Pairs 5 and 6 (admission/check-in on the destination bed) have no safe path wired in this test; pairs 8 and 9 involve correction apply and monthly invoice generation, which are prohibited without authorization. Smoke runs `0a4d6736…` (5 iterations) and `eefb27da…` (40) are debugging runs and are **not counted**. Automated race tests on one disposable local database are not production concurrency validation (different hardware, pool sizes, real traffic, PostgreSQL 17.10 vs 17.11).

## 14. S1 `.env` disposition

`scripts/verify_phase_scope.py` S1 fails on `not (root/".env").exists()` — existence only. Metadata (contents never read, copied or hashed): regular file, 346 bytes, mtime 2026-11-07 22:21, ignored by `.gitignore:14` (`**/.env`), untracked. Repository docs say integration tests "do not use `.env`" (it "names development and shared databases") and the scheduler "never loads a `.env` file". **Determination (inferred from metadata and docs): an intentional local development file, not an accidental artifact; it does not belong in the repository.** Correct permanent treatment: keep it out of the repo (relocate outside the working tree or remove it) after the owner confirms what depends on it. I did not move, delete, hide, ignore, read or alter it, and did not touch the guard. **Owner action required.** A clean checkout will not have it, but this dirty workspace cannot be certified that way, and a passing result obtained by hiding the file would be invalid.

## 15. PERF-01–06 (all PROPOSED, none approved) — `P4-2_OWNER_ACCEPTANCE_DECISIONS.md`

| ID | Subject | Status |
|---|---|---|
| PERF-01 | A4 generation margin (proposed 500 ms below 3000 ms) | UNAPPROVED |
| PERF-02 | A5 route matrix and paired baseline profile | UNAPPROVED; blocks A5 |
| PERF-03 | A9 HTTP pool responsiveness (K=10/K=2, ceilings) | UNAPPROVED; blocks A9 |
| PERF-04 | A2 representative sampling (1000 holds, ≥100 per field) | UNAPPROVED |
| PERF-05 | A1/A3 measurement boundaries | UNAPPROVED |
| PERF-06 | A7 evidence classification (fault injection) | UNAPPROVED |

No performance acceptance is claimed. Engineering failures cannot be waived by approving a methodology.

## 16. P4-4 … P4-8

No authoritative detailed acceptance specification exists in the repository. Two non-identical groupings exist and neither is approved: the current user grouping in `OWNER_DECISIONS_REQUIRED.md` (P4-4 extensions, P4-5 admission/documents, P4-6 check-in/corrections, P4-7 checkout/settlement, P4-8 finance integrity) and `PHASE_4_FINAL_CLOSEOUT.md` §P4-4–P4-8 (different proposed groupings). All five: **BLOCKED — no accepted criteria; acceptance not claimed.** **Owner specification request:** for each of P4-4…P4-8 supply the scope, acceptance matrix (scenarios, roles, expected outcomes), and for P4-5/P4-7 the missing policies (upload/KYC storage, access, retention, verification; settlement, refund, deposit). Implementation and unit tests do not constitute acceptance.

## 17. Exact remaining merge prerequisites

| # | Action | Party |
|---|---|---|
| 1 | Decide `.env` disposition (relocate/remove, or keep and accept S1 FAIL) | Owner |
| 2 | Authorize, or decline, running the 3 financial-mutation integration files on disposable PostgreSQL | Owner |
| 3 | Decide D1–D8, A1 (7), F1, and keep R1 = HOLD or name a target | Owner |
| 4 | Decide PERF-01–06 | Owner |
| 5 | Supply P4-4…P4-8 scope and acceptance | Owner |
| 6 | Build and run race pairs 5, 6 (needs a safe path) and 8, 9 (needs authorization) at ≥1000 each | Engineering (+ owner for 8, 9) |
| 7 | Run old-binary/new-schema compatibility against the final schema | Engineering |
| 8 | After approval: commit the intended tree (all tracked + untracked Phase 4 work, no env files) and obtain hosted CI on the real PostgreSQL 17.10 service | Owner authorizes; engineering executes |
| 9 | Official T1–T5, T7, T8, T10 and full T9 once 3 and the A1 workflow are implemented | Engineering after owner |
| 10 | Named-target read-only assessment before any adoption (R1) | Owner then operator |

## 18. Post-merge and production activation restrictions

A merge-ready result would not authorize: deployment, enabling transfer execution or finance-review creation/resolution, assignment adoption or backfill, financial corrections, or any production database action. Each needs separate authorization, a named operator, a tested backup and the history-preserving recovery in §12. Do not blindly redeploy after a failed migration, edit applied checksums, drop append-only history or revert the application after adoption.

## 19. Related work not part of Phase 4

The STAFF role/membership milestone contract is a separate document (`docs/backend/STAFF_ROLE_AND_MEMBERSHIP_CONTRACT.md`). Its step 0 changes backend authorization and is not part of this closure; it is not started.

## 20. Safety statement

No commit, push, merge, rebase, deployment or publication. No production or existing database access (disposable tmpfs clusters only; four created and verified removed during this closure: the restore rehearsal, the 5- and 40-iteration race smoke runs and the 1,000-iteration run). No `.env` read, copied, hashed, hidden, moved or modified; the repository secret scanner was deliberately not run. No scope guard changed. No transfer executed outside the labeled fixture-gate engineering tests, no assignment adoption, no financial correction or invoice-scheduler operation.
