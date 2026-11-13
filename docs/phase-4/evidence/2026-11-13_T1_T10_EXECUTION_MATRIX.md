> **Latest re-certification:** T6-read and T9-read PASS after the runtime URL fix, run `ed5b33c6-9f51-4e91-b429-8146c41e8269`. See the final technical blocker execution section in [assessment](2026-11-13_ACCEPTANCE_EXECUTION_AND_MERGE_READINESS.md). Other eligibility is unchanged.

> **Execution update — 2026-11-13:** Official `full transfer-browser` run `f7e90d93-e391-4edf-84af-f2e5af4e2cf3` passed **T6-read and T9-read**, exit 0; full T9 remains PARTIAL. Eight other cases remain BLOCKED/NOT RUN. The runner now exists; the preparation-only descriptions below are historical. Actual profile URL is `#residents/<id>/profile`. See [executed results and merge assessment](2026-11-13_ACCEPTANCE_EXECUTION_AND_MERGE_READINESS.md) and [machine results](2026-11-13-acceptance-results.json). No policy approved or execution gate enabled.

# Official transfer acceptance execution preparation

Prepared 2026-11-13 from P4-3_TRANSFER_SPECIFICATION.md §§5,7–11,14. **No scenario executed here; none newly passed.** Prior fixture/service evidence remains useful engineering evidence, not official acceptance. No policy selected and no runtime gate changed.

## Execution eligibility

| T1 | Submit → preview → confirm → applied | BLOCKED POLICY AND RUNTIME | A1, D1-D8, F1, R1 |
| T2 | Queue with filters | BLOCKED MISSING SPECIFICATION | A1 |
| T3 | Protected detail | BLOCKED MISSING SPECIFICATION | A1 |
| T4 | Concurrent destination conflict | BLOCKED RUNTIME | A1, D policies, F1, R1 |
| T5 | Self-approval refused | BLOCKED POLICY AND RUNTIME | A1 |
| T6 | Resident profile transfer history | POLICY READY READ SCENARIO | No policy gate for the described read checks |
| T7 | Mid-month billing-gap review | BLOCKED CONFLICTING SPECIFICATION | F1, A1, R1 |
| T8 | Same-key retry after network loss | BLOCKED RUNTIME | A1, D1, F1, R1 |
| T9 | Tenant isolation | POLICY READY READ SUBSET | No policy gate for the described read checks |
| T10 | Retryable lock timeout | BLOCKED RUNTIME | A1, F1, R1 |

T6 and the read subset of T9 have documented, independently executable behavior with all gates OFF. They require a real-browser/real-API/disposable-PG runner, which is not yet present for transfers. This is an **engineering preparation gap**, not a missing owner decision. T9 write/proposal/approval coverage remains blocked; passing its read subset cannot mark full T9 complete. T6 seeded-history evidence proves rendering/reading only, not the ability to create that history through execution.

No complete official transfer runner exists today: `transfers-ui.e2e.mjs` intercepts API requests with fixtures and explicitly disclaims T1–T10; `corrections.e2e.mjs` and the `full-migration-browser` harness profile execute correction E1–E10. Do not relabel either result. The specification states outcomes for all ten but does not specify the A1 queue/detail workflow or resolve F1's contradictory trigger. No missing route or policy may be guessed.

## Shared runner contract

Before future execution:

1. Perform the capacity/resource checks in [execution readiness](2026-11-13_EXECUTION_READINESS.md). Use a fresh UUID-labeled tmpfs cluster and the existing full migration/role/marker/isolation verification. Keep generated credentials process-local; never read .env or reuse existing DB URLs.
2. Start actual Nest API and actual React/Vite app with real session authentication. Use system Chrome, isolated browser contexts for OWNER-A, PM-A, OWNER-B and anonymous. Synthetic identities only. No fake SessionService, fixture execution gate, disabled constraints or mocked business API responses are allowed for official acceptance.
3. For read scenarios only, seed synthetic tenant A/B history into the freshly provisioned DB: valid organization/membership/inventory/resident/booking/admission/check-in plus immutable transfer and linked original/destination assignment rows, satisfying existing constraints. Do not seed money/audit-history edits, run adoption, or execute a transfer. Use distinct identifiable names/reasons; preserve original commercial bed and rent. Include more than one history page and a no-history resident.
4. Keep all shipped gates OFF. If a scenario requires execution/review activation, record BLOCKED before attempting it. A 503 feature-disabled response is not a successful T1/T5/T7/T8/T10 result. Do not override production DI or environment flags for acceptance.
5. Attach browser response listeners and page-error listeners before navigation. Record request path/status, case ID and assertion result only; omit cookies, CSRF values, passwords, connection strings and protected response bodies. Assert unexpected API 5xx and page errors are zero. For isolated loss-of-response tests, alter transport only, never return fabricated business results.
6. Record per-case start/end time, executed assertions, exact DB effect counts (where applicable), state snapshots and failure/blocker reason. Separate NOT RUN, BLOCKED, PARTIAL, FAIL and PASS. An error caught by the runner must fail the case and the run; missing cases cannot become skipped passes.
7. Close browser/API/web processes owned by this run, close connections, verify UUID container label, remove only that container and confirm its tmpfs removal. Never prune shared containers, images or volumes.

## Read-scenario execution details

**T6:** Log into tenant A through the actual login UI. Open `#residents/<resident-A-id>`, select the Corrections tab and inspect the Transfers section. Cross-check visible labels, reason, actor and times with `/api/v1/transfers/history?residentId=<id>&page=1&limit=20`. Page forward/back, check stable order and exact totals, then open the no-history resident and assert the empty state. Attempt the tenant B resident URL and verify no foreign history. Record database snapshots before/after to prove no transfer/assignment/financial effects. Pending visibility cannot be tested until pending proposals exist; record that boundary explicitly rather than inventing rows.

**T9 read subset:** With real A/B browser sessions, verify A cannot read B's `/residents/:id/stay-summary`, `/residents/:id/history` and `/transfers/history?residentId=...`; use B's resident in preview and A's resident with B's destination bed. Assert the documented 404/not-found behavior for cross-tenant identifiers, 401 for anonymous access, and no foreign names, locations, reasons or record IDs rendered. Tenant B must still read its own data. A client-supplied organizationId must not override session authority. Finance-review list remains OWNER-only; if tested, require tenant-scoped results and no mutation. Do not assert complete T9 while transfer write authorization is unavailable.

The runner addition should reuse the existing safety primitives and real authentication setup, but must register transfer case IDs separately and extend sanitized reporting to T IDs. Existing reporting filters only E IDs; otherwise transfer results would disappear from evidence. No runner command is presented as executable until that wiring exists.

## Blocked scenario recipes

### T1 — Submit → preview → confirm → applied

Two distinct authorized users; real UI submission and independent review; after confirmation one transfer, source close, destination open, three mandatory audits and one receipt; booking/rent/issued invoices unchanged.

### T2 — Queue with filters

Specify allowed viewer roles, queue membership, filter fields/semantics, ordering, paging and terminal-item treatment. Then create mixed tenant/status records through the approved proposal API and assert exact rows/counts for every supported filter.

### T3 — Protected detail

Specify detail route/schema and requester/reviewer visibility. Then independent eligible reviewer sees approved fields, anonymous user gets no detail, and foreign-tenant identifier reveals no protected data.

### T4 — Concurrent destination conflict

Two real browser sessions submit permitted moves competing for one destination; exactly one commits, the other receives the documented conflict; assert no overlapping occupancy and exact audit/receipt counts.

### T5 — Self-approval refused

Requester attempts the real approval action under current authorized role; server returns SELF_REVIEW/403 and no assignment, transfer or receipt effect. Role change must not defeat distinct-user enforcement.

### T6 — Resident profile transfer history

Real Chrome renders seeded historical PostgreSQL transfer records through real authenticated API. Assert source/destination, actor, reason, effective/recorded times, pagination and tenant scoping; do not claim transfer execution or pending-queue acceptance.

### T7 — Mid-month billing-gap review

After F1 fixes trigger/timing, exercise real transfer-linked obligation and independent OWNER resolution. Verify suppression, no self-review, supported outcomes, immutable invoice/payment history, replay and no automatic issue.

### T8 — Same-key retry after network loss

Drop only the response after the real server commits, preserve request payload/key, retry through browser, and compare exact response plus one transfer/receipt/audit set. Request abort before commit is not lost-ack proof.

### T9 — Tenant isolation

Real tenant A and B sessions; A cannot obtain B resident summary/history/preview, and B remains able to access its own data. Anonymous requests denied. Full proposal/approval/write-isolation acceptance remains blocked on A1/runtime.

### T10 — Retryable lock timeout

Use dedicated migrator connection to hold the documented organization gate in the disposable database. Real authorized browser command receives RETRY_REQUIRED/409 with no effects, retains key, then succeeds exactly once after lock release.

## Release acceptance boundaries

The nine race pairs × at least 1,000 interleavings each in §11.3 remain separate from T1–T10 and from P4-2 A6. Required outcomes include zero deadlocks and exact audit/receipt counts; neither a focused race sample nor passing browser cases replaces the campaign.

Owner choices are centralized in [OWNER_DECISIONS_REQUIRED.md](../OWNER_DECISIONS_REQUIRED.md). Approval does not itself implement missing endpoints, enable a gate or establish a test pass. Full milestone acceptance still needs the approved workflow, real executions and evidence-backed disposition of every required case.

Machine-readable case inventory: [acceptance cases](2026-11-13-acceptance-cases.json). It intentionally records `executed: false` and distinguishes read subsets from blocked full cases.
