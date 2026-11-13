# P4-2 acceptance closure — 2026-11-10

## A3 final historical-outlier forensics — 2026-11-10 09:05 UTC

This A3 update supersedes earlier A3 measurements below, while retaining the historical failed run as unresolved evidence. The exact run `fb5f85bc-a07b-4fe2-8d27-19a0e08384c2` raw sample was not retained; its duration/phase cause cannot be reconstructed. A controlled rerun of the source timeout workload on fresh disposable PostgreSQL (`5e1441f5-47da-4552-ba19-7d5c0ee4fb5b`) passed 1/1 test and produced three real HTTP correction timeout samples: Prisma attempt durations 29,009.501, 29,009.422 and 29,010.413 ms; separate HTTP walls 29,058.253, 29,065.209 and 29,066.591 ms. Each returned 409 `RETRY_REQUIRED`, SQLSTATE 57014 / Prisma P2039, and acknowledged rollback before attempt settlement. PostgreSQL snapshots observed the controlled `pg_sleep(31)` statement active in `Timeout / PgSleep`; 50ms event-loop heartbeat maximum gap was 53.646ms. Proposals remained PENDING; source, receipt and application-audit state were unchanged.

**A3 remains PARTIAL.** This run did not reproduce an attempt over 30 seconds and did not demonstrate a large event-loop scheduling pause, but three successes do not disprove the missing historical outlier or establish a universal bound. No application behavior changed. Full methodology, every recorded transaction attempt and backend snapshot: `P4-2_A3_STRESS_FORENSICS.md`, structured ledger `P4-2_A3_STRESS_FORENSICS_5e1441f5.json`, raw sanitized run `integration-5e1441f5-47da-4552-ba19-7d5c0ee4fb5b.txt`. Disposable label cleanup was verified.

Recommendation: **NOT ACCEPTED**. Passing functional tests do not replace the mandatory performance and workload evidence in specification v1.3 sections 16.2–16.3. Financial correction activation remains OFF and requires separate independent review and owner authorization.

## A3 timeout fix update — 2026-11-10

Final relevant integration verification after pre-COMMIT refresh:4ba17145-96fb-4e99-bc8e-b6908c739c36,321 passed/0 failed/20 opt-in skips; focused checks74/74,typecheck and diff whitespace clean. All disposable cleanup verified. New common helper/regression test increase untracked top-level entries39→41; tracked dirty count remains74.

Detailed root cause,measurement boundaries,regressions and retained failed stress evidence: **A3_TRANSACTION_DEADLINE_INVESTIGATION.md**. Structured actual traces: **A3_DEADLINE_TIMING_d3a79079.json**.

Missing PostgreSQL statement cancellation allowed a31s statement to occupy the connection while Prisma's30s timer queued ROLLBACK behind it. Added a correction-only remaining-budget server statement timeout,1000ms cleanup reserve,connection-wait accounting,serialized fresh budgets,smaller lock-timeout preservation and pre-COMMIT refresh. No transaction maximum increase,READ COMMITTED/retry/domain/migration changes. Final three full HTTP attempts including rollback:29011.434,29012.656,29014.834ms;max29014.834ms versus before31033.948ms. Rollback acknowledgments1.496–2.410ms; source/audit/receipt effects absent; near-budget advisory/row tests and wait/execution cancellation pass.

**A3 remains PARTIAL,not PASS.** One earlier traced stress run failed its strict duration assertion and cannot be conclusively attributed from retained data; it is explicitly retained. Complete near-budget HTTP cross-product and approved stress sample plan also remain open. Final trace instrumentation captures actual attempt/control/HTTP timing and event-loop heartbeat; no large final heartbeat stall occurred. Other A1/A2/A4/A5/A6/A7/A8/A9/A10 statuses and owner decisions are preserved; no unrelated work was undertaken.

## Final closure sprint — authoritative latest scorecard (2026-11-10 05:56 UTC)

This section supersedes older scorecards below. Owner approval sheet: **P4-2_OWNER_ACCEPTANCE_DECISIONS.md**, PERF-01–06, all PROPOSED — NOT APPROVED. No owner decision was inferred from testing authorization.

Final established disposable `full performance` run800f1294-341d-407b-9bcf-032cc077335f: **1 evidence test passed**, zero failed,50129.679ms. This is a successful measurement/rollback test, **not a declaration that every measured threshold passed**. Raw artifact `integration-800f1294-341d-407b-9bcf-032cc077335f.txt`; structured individual measurements and outcomes `performance-800f1294-summary.json`. Prior successful development run53988894-60c5-44b4-ae3f-9d5f34fd1979 retained separately. Hardware/runtime/isolation unchanged: AppleM4,10 CPUs,16GiB,Node24.22.1,PostgreSQL17.11-alpine,tmpfs,loopback-only ephemeral port,separate runtime/migrator roles. No application/migration/financial-feature-flag changes.

| Criterion | Threshold / scope | Actual latest evidence | Status |
|---|---|---|---|
| A1 | PostgreSQL lock_timeout≤3s; timeout55P03, HTTP409 RETRY_REQUIRED, rollback | Actual HTTP-transaction settings read as3s;10/10 loaded Booking requests409,no new booking/audit. Server clock wait/error3010.565ms under actual3s setting,55P03,subtransaction write rollback verified | PASS for specified configured-timeout/classification contract; not a3000ms wall-time guarantee |
| A2 | gate acquisition→completion max≤2000ms,p95 target≤500ms; all gated fields+scheduler+≥10 ordinary clients | Six fields exercised,all eventually applied; scheduler race3 STALE_SOURCE then3 successful fresh applications. Mixed all-field group19 committed holds:p50 6.024ms,p95/p99/max72.030ms; concurrent price group40 holds:p50 10.284ms,p95 20.411ms,p99/max29.214ms | PARTIAL: required field/scheduler engineering coverage closed; minimum distribution sample plan awaits PERF-04 |
| A3 | acquisition≤5s bounded by remaining budget; correction attempt≤30s | HTTP row timeout409 at5054.205ms; explicit cancellation409 at345.478ms; controlled31s SQL delay causedP2028/UNCERTAIN,one attempt31033.948ms,HTTP409 at31131.643ms,source/receipt/audit rollback verified | FAIL against strict client-observed attempt≤30s; server deadline vs late observation unresolved; full route/near-budget HTTP matrix still incomplete |
| A4 |100-bed generation≤3000ms minus approved margin | Reuse100-bed concurrent creation/idempotency max57.751ms; available margin2942.249ms. Proposal500ms means2500ms threshold,measured headroom2442.249ms | PARTIAL: PERF-01 margin unapproved; no billing-rule change |
| A5 | ordinary-route p95 regression≤5% versus exact pre-gate snapshot | Verified archive908098acd567c299ad05529b5a533ad17622dceb; material gate-covered routes mapped to controller methods | BLOCKED: PERF-02 routes/profile unapproved; comparable runner/schema validation required after definition |
| A6 |1000 randomized interleavings per pair,zero40P01 | Previous19 scenarios each1000,zero deadlocks | PASS; not repeated |
| A7 | only40P01/40001,max2 full retries,no duplicates; no23505/uncertain retry | Natural40P01 HTTP recovery retained; controlled PostgreSQL40001/P2034:2 failures→3 attempts→200,one receipt/audit;3 failures→3 attempts→409,no effects.23505/P2002:1 attempt→500;57014/P2039:1 attempt→409;actualP2028:1 attempt→409. Same-key recovery/replay200 | PASS for observed retry policy including explicitly injected HTTP40001; injection is not a natural READ COMMITTED serialization conflict |
| A8 |simulated2s holder,exclusive waiter,next request wait | Existing2004.898ms holder,waiter verified,next1900.140ms | PASS; retained |
| A9 |K waiting ordinary requests,non-gated HTTP endpoints responsive | Exact endpoint/K/latency/sample proposals consolidated in PERF-03 | BLOCKED: owner decision; no arbitrary A9 test claimed |
| A10 |real advisory/row timeout and exact error shapes | Existing six-probe evidence retained | PASS; not repeated |

### A1 precise boundaries

Server-side test-owned PL/pgSQL function reads current_setting(lock_timeout) **inside the transaction**, captures clock_timestamp immediately before advisory acquisition and inside the55P03 exception handler, and verifies its preceding write rolled back via the exception subtransaction. Actual setting3s; start2026-11-10T05:55:26.496859Z, failure2026-11-10T05:55:29.507424Z, server elapsed3010.565ms. This includes server error dispatch/scheduling, not HTTP or driver transport. The same transaction's caller commits only the measurement; the failed protected block is rolled back. Separate actual HTTP transactions record their setting3s and P2010/55P03/LOCK_TIMEOUT; ten requests return409 RETRY_REQUIRED with no booking writes/audits. Max HTTP wall3070.572ms. Raw client lock round trips and transaction-resolution times are retained individually; clocks are not subtracted across unrelated maxima. The requirement is the≤3s **setting**, so neither3107.33ms previous HTTP time nor3010.565ms server error-observation time is silently treated as a setting breach or a hard real-time guarantee.

### A2 workload and fixture accounting

Initial fixture100 beds/residents/bookings/active stays and1200 historical invoices. Gated allowlist from FIELD_SPECS: Booking startDate/endDate/monthlyPrice,Admission admissionDate,CheckIn checkInAt,CheckOut checkOutAt. Name/reason operations remain outside the organization gate. Checkout-field fixture legitimately closes one stay,leaving99 active eligible stays for the later scheduler/generation phase; do not relabel that phase as100 active stays. Six concurrent approvals overlap one actual InvoiceSchedulerService.run and10 ordinary Booking attempts (concurrency17); three Booking corrections become terminal STALE_SOURCE when scheduler wins, three lifecycle corrections apply. New proposals after scheduler then apply all three Booking fields. All fields thus have successful application evidence; conflicts/failed attempts remain separate in raw records.19 mixed-group committed holds include scheduler and terminal-stale commits,not19 successful correction applications. Successful application distributions cannot be inferred by treating those all alike. Pure concurrent-price group40 holds includes20 submissions+20 approvals. Serial-price40 holds:max34.977ms,p95 23.100ms. No observed successful hold exceeded2s; raw rollbacks/timeouts are separate workload labels. PERF-04 defines a proposed larger per-field statistical plan,not an approved sample requirement.

Scheduler created99 issued invoice slots without failure. Five later idempotent generation calls each skipped99; group max13.238ms,p5010.593ms. These are **idempotent99-eligible measurements**,not replacement first-creation100-bed evidence. The prior100-bed run remains the A4 engineering source.

### A3 endpoint coverage and remaining technical failure

Actual tested endpoints: POST/bookings advisory contention; POST/corrections/:id/approve row contention,cancellation and30s transaction expiry; ordinary/correction lock order unchanged. Runtime backend cancellation uses a same-role connection on this run's own backend PID; no elevated shared-server privileges. Row timeout and cancellation retain PENDING proposal and zero approval receipts. Expired transaction additionally asserts unchanged resident name,zero correction.applied audit,zero approval receipt and one attempt. The blocked command's late completion is a real measured **client-observed overrun**; a successful test of rollback does not make it a performance PASS. No timeout or business rule was changed to hide it.

Relevant route matrix from controllers/source: Booking POST,PUT,extend POST,DELETE; Admission POST,PUT(date/approve/cancel/reopen),DELETE; CheckIn POST,PUT(notes),check-out POST; Finance draft POST,issue POST,generate-monthly POST; correction gated submit/apply. Shared lock helper covers advisory acquisition,source row order differs by operation; settlement endpoints do not join the organization gate. Full per-route failure matrix and near-remaining-budget HTTP measurement remain technically incomplete. Earlier direct SQL near-budget/cancellation probes are supporting evidence only. These technical gaps are not solved by owner approval of a sample plan. Investigate actual PostgreSQL transaction deadline/connection release timestamps versus Prisma callback resolution before changing any production behavior.

### A7 controlled fault safety and exact results

User-authorized **disposable-only fault injection**,not a natural conflict. Test-owned trigger fires only for one generated proposal ID. A test-owned PostgreSQL sequence counts failures across rolled-back attempts (nextval is nontransactional); only runtime usage/select on that exact sequence is granted. Trigger/function/sequence dropped in finally; schema never migrated or applied elsewhere. Current endpoint remains READ COMMITTED.

*40001/P2034/SERIALIZATION,requested2 failures:3 total attempts,2 retries,HTTP200,APPLIED,one approval receipt,one correction.applied audit. Same-key replay200,no duplicate effects.
*40001/P2034,persistent3 failures:3 attempts exactly,2 retries,HTTP409 RETRY_REQUIRED,PENDING,zero receipt/audit. Removing the fixture then repeating the same key applies once; subsequent replay is safe.
*23505/P2002/UNIQUE_VIOLATION:1 attempt,zero retries,HTTP500,PENDING,zero effects. This unrelated uniqueness error is deliberately **not disguised as409**.
*57014/P2039/UNCERTAIN:1 attempt,zero retries,HTTP409 RETRY_REQUIRED,PENDING,zero effects; fixture removal and same-key recovery/replay succeed.
*Actual endpoint transaction expiryP2028/UNCERTAIN:1 attempt,no automatic retry,HTTP409,no durable effects. This proves uncertain-class policy without claiming an actual lost COMMIT was induced; existing lost-response replay evidence remains separate.

Naturally occurring SERIALIZABLE40001/P2010 remains in earlier driver probes; naturally occurring40P01/P2010 HTTP recovery remains in this run. No synthetic application error object was used for new HTTP measurements. Intentional probe failures do not invalidate A6's prior zero-deadlock application-race evidence.

### Verification and cleanup

Only test measurement/injection code and evidence changed. Corrections service32/32 and focused harness4/4 passed; API typecheck and diff whitespace check pass. Failed development measurements (date-only contract/end-date extension fixture mistakes and missing usage on injected sequence) are retained as failed runs,not acceptance passes; each disposable container was label-checked and removed. All final triggers/functions/sequences were removed before the final container cleanup. Final container800f1294-341d-407b-9bcf-032cc077335f and prior successful53988894-60c5-44b4-ae3f-9d5f34fd1979 report removal/tmpfs disposal. No shared container or volume was modified. Dirty tree preserved; no commit/push/merge/PR/deployment.

## Additional loaded performance evidence — 2026-11-10 05:38 UTC

Final strengthened rollback verification: run3484e871-34f8-4d1d-8193-a19b4616fad3,7/7 passed,7528.550ms, with immediate unchanged-state assertions after transaction timeout and explicit cancellation. Evidence `integration-3484e871-34f8-4d1d-8193-a19b4616fad3.txt`: remaining-budget timeout416.396ms; P2028 observation157.302ms;57014 cancellation71.771ms; genuine40001 conflict7.501ms. Exact classifications asserted. The loaded HTTP run's maximum HTTP wall time was3065.589ms; maximum observed row-lock acquisition1005.399ms (intentional deadlock), maximum advisory round trip3036.854ms. Reported probe deadlines and error-observation times are deliberately distinguished.

This update supersedes the preceding performance snapshot, which remains below for provenance. Owner proposals and missing definitions are in `P4-2_PERFORMANCE_ACCEPTANCE_CLARIFICATIONS.md`; none is approved.

Run b8356fbc-08b6-4ae2-87ba-aa3f5fbcfd4c, established `full performance` disposable mode: **1/1 passed**, 9029.731ms. Raw `integration-b8356fbc-08b6-4ae2-87ba-aa3f5fbcfd4c.txt`; structured `performance-b8356fbc-summary.json`. Same Apple M4/10 CPUs/16GiB/Node24.22.1/PostgreSQL17.11-alpine/tmpfs fixture:100 beds,100 residents/bookings/stays,1200 historical invoices. Hardware/runtime fields and timestamp retained in raw JSON. Ten ordinary HTTP requests contend for the held gate, followed by20 concurrent same-organization price correction submissions and20 concurrent approvals (distinct bookings), plus20 serial submit/approve pairs. Five generation requests run concurrently. This still omits performance samples for every gated field type and the scheduler; the sample plan remains unapproved. No business rules changed.

| Criterion | Required threshold | New actual evidence | Disposition |
|---|---|---|---|
| A1 | PostgreSQL lock_timeout≤3000ms,409 RETRY_REQUIRED,rollback |10/10 HTTP409 RETRY_REQUIRED; no new bookings/audits. Max client-observed lock round trip3036.854ms, attempt including rollback3043.138ms; individual HTTP start/completion/wall times retained | PARTIAL: loaded Booking HTTP proved; pure server lock/error/rollback time not separately instrumented, other ordinary routes not sampled |
| A2 | max≤2000ms, targetp95≤500ms |40 concurrent-phase gate holds (20 submissions+20 approvals):p50=11.065ms,p95=19.951ms,p99/max=30.457ms; all committed,no breach. Serial40 holds:max35.312ms,p95=25.952ms | PARTIAL: measured holds pass, full all-field/scheduler workload missing; sample plan requires approval |
| A3 | acquisitions≤5000ms and remaining budget; attempts≤30000ms |388 explicit acquisitions max3036.854ms;99 attempts max3043.138ms. Timestamp pairs, budgets and errors retained. Separate bounds probes below | PARTIAL: measured bounds pass; shortened controlled timeout/cancellation probes do not establish every30s endpoint-boundary scenario |
| A4 | generation≤A1 minus approved margin |100-bed concurrent generation:5 samples,p50=7.772ms,p95/p99/max=57.751ms. One creation creates100 drafts; four idempotent calls each skip100. Raw transaction times and lock waits retained separately by attempt | PARTIAL: first-creation n=1; margin undefined; API workload only |
| A5 | same-hardware pre-gate p95 regression≤5% | baseline source archived and verified; no arbitrary route comparison | BLOCKED: owner-approved route/load definition missing |
| A6 | zero deadlocks,1000/pair | Existing19-scenario evidence retained | PASS |
| A7 |≤2 full retries,only40P01/40001,no duplicate effects | Genuine40P01 HTTP recovery retained; genuine40001/P2010/SERIALIZATION measured in real SERIALIZABLE transactions; unchanged service policy replayed with both captured error classes | PARTIAL: no real HTTP40001 retry; READ COMMITTED endpoint cannot use SERIALIZABLE anomaly without changing its isolation |
| A8 |2s holder,waiting request,next-request impact | Existing measured holder2004.898ms,verified exclusive waiter,next1900.140ms | PASS under authoritative v1.3 exclusive protocol; no additional acceptance rerun required |
| A9 |K ordinary waiters,non-gated HTTP responsive | No authoritative K/endpoints/response threshold found; proposals documented | BLOCKED: owner decision required; SQL evidence not substituted |
| A10 |advisory/row lock timeouts and real error shapes | Prior evidence retained; bounds probe run also confirms shapes | PASS |

A1 analysis: source requirements in v1.3§16.2 and owner review05/06/07/16 lines394–395 limit the PostgreSQL setting, not HTTP wall time. Thus3107.33ms wall time is compatible with3000ms configured timeout and processing/transport overhead; it is not proof that pure server wait complied with a mathematically exact3000ms wall ceiling. New lock measurements include driver dispatch and error delivery; attempt duration includes rollback. HTTP measurement additionally includes guard/API/filter/transport time. Do not subtract uncorrelated maxima to invent phase durations.

Bounds run122389e0-c478-4d11-88e9-b81759b299aa: **7/7 passed**,7524.145ms; raw `integration-122389e0-c478-4d11-88e9-b81759b299aa.txt`. Remaining-budget test:500ms transaction budget,350ms delay,50ms row lock timeout,observed total418.164ms,55P03/P2010/LOCK_TIMEOUT. Shortened transaction timeout:50ms configured,156.734ms error observation after150ms deliberate callback delay,P2028/UNCERTAIN. Explicit pg_cancel_backend on same-runtime-user query:70.914ms,57014/P2010/UNCERTAIN. Subsequent writes/reads verify only the successful serializable update persists; all failed transactions roll back. Cancellation is not confused with a lock timeout or automatically retried. These are client-observed timings, not exact server deadline timestamps.

Genuine40001:two SERIALIZABLE transactions read the same organization row,one commits an update,the other attempts its conflicting update and rolls back after9.073ms. PrismaClientKnownRequestError/P2010,driver originalCode40001,TransactionWriteConflict,classifierSERIALIZATION. No fake SQLSTATE was raised. This proves driver classification,not service HTTP retry. The correction service uses its unchanged READ COMMITTED isolation; overriding it merely to claim an HTTP40001 pass would change the subject under test. Corrections service tests now exercise both observed40P01/P2010 and40001/P2010 shapes, assert3 attempts maximum, one receipt/proposal, and exhaustion response; **32/32 passed**. Existing23505/uncertain nonretry tests remain intact. Real40P01 successful retry/replay still has one application audit and receipt.

A5 snapshot prepared at `/tmp/nook-p42-pregate-f282i9j0` from git archive908098acd567c299ad05529b5a533ad17622dceb without touching the working tree. Its org-gate file is absent; BookingService transactions precede gate introduction; API runtime dependency declarations equal current, Node engine supports available24.22.1. Snapshot has18 migrations versus current20. This establishes an available source/runtime candidate,not proven schema/runtime equivalence. No historical server was launched and no incomparable p95 numbers were generated. Freeze route/load plan,then validate separate historical schema/client and equivalent fixtures before running a paired comparison.

Only integration measurement tests, gate probes, correction retry unit tests and evidence changed in this update. Failed gate acquisitions no longer count as successful gate holds in the measurement wrapper. API typecheck passes; focused harness tests4/4 and corrections service32/32 pass. All new disposable runs reported exact label-verified removal/tmpfs disposal; final absence independently checked. No production code,migration,feature flag or shared database changed. Recommendation remains NOT ACCEPTED, pending listed measurements and owner decisions.

## Latest performance evidence — 2026-11-10 05:28 UTC

This section supersedes earlier missing-measurement descriptions below; the earlier sections retain run provenance. Recommendation remains **NOT ACCEPTED**.

Executed `node --import tsx scripts/qa/phase4-disposable.mjs full performance` through the established disposable safeguards. Final run `24298375-11ea-4b97-b86c-7a08fddaa8dd`: 1 evidence test passed, zero failed, 5,180.47 ms. Raw sanitized per-attempt and per-acquisition data: `integration-24298375-11ea-4b97-b86c-7a08fddaa8dd.txt`. Reduced machine-readable data: `performance-24298375-summary.json`.

Hardware: Apple M4, 10 logical CPUs, 16 GiB RAM, macOS arm64, Node v24.22.1. PostgreSQL uses the existing postgres:17.11-alpine image, fresh tmpfs cluster, loopback ephemeral port, separate generated migrator/runtime roles. Fixture: 100 beds, 100 residents/bookings/active stays, 1,200 historical invoices. Workload: 20 sequential price-correction submit/approve pairs, one genuine-deadlock name approval and replay, five monthly-generation calls. This does **not** meet the full specification workload: no ten ordinary concurrent clients, no correction for every gated field type, no simulated scheduler in this performance run. A6's scheduler coverage remains separate.

Instrumentation is test-only: a Prisma transaction wrapper records each explicit advisory/row-lock call (including Prisma.sql objects), remaining time on entry, callback transaction completion, and gate acquisition through resolved transaction completion including COMMIT acknowledgement. No request duration is substituted for gate hold. Measurements are client-observed bounds and include instrumentation/transport overhead; implicit row locks inside model writes are not independently timed. Every recorded value is retained; nearest-rank quantiles are used. The 40 correction holds include submission and approval holds, not 40 application samples.

| Criterion | Required threshold | Latest measured evidence | Disposition |
|---|---|---|---|
| A1 | configured lock_timeout ≤3000 ms; retryable HTTP 409 and rollback | A10 probe configured 3000 ms; wall time 3107.33 ms. Prior ordinary HTTP integration verifies 409/RETRY_REQUIRED/no writes. No new loaded HTTP timeout sample | PARTIAL |
| A2 | hard max ≤2000 ms, target p95 ≤500 ms | 40 gate holds: p50 15.762 ms, p95 19.851 ms, p99/max 30.017 ms; zero observed breaches | PARTIAL — measured sample passes; full concurrent/all-field workload absent |
| A3 | acquisitions ≤5000 ms and remaining budget; attempts ≤30000 ms | 198 explicit acquisitions: advisory max 1.678 ms, row max 1027.284 ms; 49 attempts max 1032.016 ms. Per-acquisition remaining budgets retained | PARTIAL — sampled bounds pass; no complete all-field/cancellation workload |
| A4 | generation hold ≤A1 minus margin on 100 beds | 5 holds: p50 5.963 ms, p95/max 75.804 ms; headroom from 3000 ms =2924.196 ms. First call creates 100 drafts; next four each process/skip 100 existing slots | PARTIAL — numerical required margin undefined; only one creation sample, four idempotent samples |
| A5 | same-hardware p95 regression ≤5% versus authoritative pre-gate code | Exact pre-gate source identified: 908098acd567c299ad05529b5a533ad17622dceb. No comparable baseline/current route benchmark run | BLOCKED — route/profile definitions absent; comparable historical runner not prepared |
| A6 | ≥1000 interleavings per pair, zero deadlocks | Prior 19 scenarios each 1000, zero deadlocks | PASS — reused unchanged evidence |
| A7 | ≤2 full retries, only 40P01/40001, no duplicates | Genuine 40P01/P2010/DEADLOCK during approval, failed attempt 1032.016 ms, one automatic retry succeeds; HTTP200, replay200, one APPROVE receipt and one correction.applied audit; resident becomes Aarav | PARTIAL — real 40P01 recovery verified; full two-retry/40001/nonretry workload not all measured here |
| A8 | simulated 2s holder, exclusive waiter, next-request impact | Actual holder 2004.898 ms; exclusive waiter count before next=1; next starts107.109 ms after first; first wait2005.406 ms; next wait1900.140 ms | PASS — exact SQL request queue requirement measured; not claimed as A9 HTTP evidence |
| A9 | K waiters, specified non-gated HTTP endpoints responsive | No HTTP pool/load run; specification only says K and does not name endpoints or K | BLOCKED — approved K/endpoints/response threshold needed |
| A10 | actual advisory/row timeout and exact Prisma shapes | Probe rerun 558cfe77-9669-4d4b-8682-74ec0a64c533:6/6 passed | PASS |

A8 evidence: `integration-558cfe77-9669-4d4b-8682-74ec0a64c533.txt`. Unlike the earlier nominal 2000ms field, this run records elapsed time after holder COMMIT acknowledgement and queries pg_locks for an ungranted exclusive advisory waiter before issuing the next request. Unrelated SQL read15.702 ms, K=2 and pool10 are exploratory observations, not invented A9 acceptance settings.

A5 provenance: `git log --all -- apps/api/src/common/org-gate.ts` has no committed gate implementation; `git grep acquireOrgGate 908098acd567c299ad05529b5a533ad17622dceb -- apps/api/src` returns no matches. That commit's BookingService has its ordinary transactions/bed locks without the organization gate; the gate is introduced only by current uncommitted changes. Thus HEAD is a defensible pre-gate snapshot, rather than an assumed main baseline. It can be archived without touching the working tree, but running it comparably requires an isolated historical client/configuration and a frozen route/load definition. No archive, branch change or synthetic baseline was used. The specification does not list exact A5 routes, A9 endpoints/K, or a numerical A4 margin; clarification was requested and no values were supplied in this turn.

A7 fault induction uses a separate disposable-only transaction holding Resident then requesting the already-held proposal; the application itself keeps its existing lock order and semantics. PostgreSQL chooses the application as the deadlock victim. Raw error classification, failed/successful attempts, replay, and counts are retained. No fake SQLSTATE was injected, no application flag was enabled, and no automatic retry code was changed. This intentional probe deadlock does not invalidate the separate A6 zero-deadlock application-race run.

Initial fixture setup attempts failed on duplicate bed label23505 and invoice-number-format23514; each container was removed before correcting test fixture data. They are not performance passes. Successful measurement runs: 3de71b4c-77dc-4ac6-a3f4-de9e195d7952 (initial instrumentation) and24298375-11ea-4b97-b86c-7a08fddaa8dd (Prisma.sql row locks included). All runs reported exact-container cleanup and tmpfs discard; final container absence was independently checked.

Only test code/harness modes/evidence changed. API typecheck passes after instrumentation; git diff --check passes. Existing functional/browser/A6 verification is reused because application code and migrations were unchanged. A new opt-in performance test is selected explicitly by the performance mode; it is not counted as an executed default-suite test.

## Evidence and verification

Workspace `/Users/atharva/Downloads/nook-phase4-1`, branch `feature/phase-4-1-lifecycle-audit`, verified before edits. The extensive pre-existing dirty tree, including deletions and untracked files, was preserved.

Baseline browser: `browser-f36d19b7-5907-4b71-b860-f346c5015c7d.txt`, 10/10. Baseline integration: `integration-b3cd3e3e-5407-4d58-9996-520f7d54cfd6.txt`, 320 passed / 0 failed / 19 skipped / 339 total. The entire baseline integration artifact was read: it contains totals only, not test names.

Latest full integration: `integration-1fbfe214-9c5a-45e7-8157-9ae4b3ce109b.txt`: **321 passed, 0 failed, 19 skipped, 340 total**, 98,711.07 ms. Added historical-constraint reproduction accounts for the additional test.

Final full integration with per-request decision-race diagnostics: `integration-7b49bfac-b0f0-40e2-9fa4-e1b76bac05ac.txt`, **321 passed, 0 failed, 19 skipped, 340 total**, 116,838.78 ms. Eight normal decision-race rounds passed, including four approve/withdraw races. Both winning orders were observed for withdrawal: rounds 1/5 withdrew (approve 409 INVALID_STATE), rounds 3/7 approved (withdraw 409 INVALID_STATE). Every round asserts one decision receipt and one decision audit. No SQLSTATE or Prisma error is expected for the normal losing request: the service detects the terminal row and throws the documented conflict before another update.

Latest browser: `browser-6b9391f3-f364-4034-8d63-b72eec97f46b.txt`: **10 passed, 0 failed**, E5/E6/E9 pass, zero backend 5xx markers.

Service/finance command: `TSX_TSCONFIG_PATH=apps/api/tsconfig.json node --import tsx --test apps/api/test/stay-summary.service.test.ts apps/api/test/corrections.service.test.ts apps/api/test/finance.service.test.ts`: **89 passed, 0 failed, 0 skipped**.

Migration/harness command: `node --import tsx --test scripts/ci/g6b-migration.test.js scripts/qa/phase4-disposable.test.mjs scripts/e2e/e6-assertions.test.mjs`: **241 passed, 0 failed, 0 skipped**.

`npm run typecheck --workspace @nook/api`: exit 0. `git diff --check`: exit 0 after removing the 14 reported indentation-only blank lines at generated Prisma namespace lines 3196–3287 (step 7). No regeneration or unrelated formatting was used for this repair.

## Historical concurrency mechanism

The dedicated disposable regression temporarily reinstates the original self-review constraint, tests it, and restores the corrected constraint in `finally`. No shared database is involved. It does not claim that the inaccessible historical execution's error was recorded retroactively.

Captured evidence in `integration-1fbfe214-9c5a-45e7-8157-9ae4b3ce109b.txt`:

* Constraint: `correction_proposals_self_review_check`.
* Phase: proposal update, before withdrawal receipt creation.
* Exact SQLSTATE: **23514** (check violation).
* Prisma: **PrismaClientKnownRequestError / P2039**; driver SQLSTATE exposed through nested adapter metadata, confirmed by `sqlStates`.
* Classifier: **OTHER**; not an automatic retry and not converted to 409.
* Request: requester POST `/corrections/{proposal}/withdraw`, reason `mistake`, fixed test-owned idempotency key.
* HTTP: **500**, `{message: "Internal server error", statusCode: 500}`; request IDs omitted from evidence.
* Result: rolled back, proposal PENDING, zero withdrawal decision receipts. The prior original constraint prohibited exactly the requester decision required by WITHDRAWN shape validation.
* With the corrected constraint restored: withdrawal returns 200; same-key replay returns 200 with `idempotentReplay: true`.

Current transaction inspection: command-key advisory lock → authorization/receipt lookup → action body. Approval takes organization gate and its fact/row locks; withdrawal locks the proposal and checks PENDING before changing it. Receipt and audit writes share the transaction. Losing decided-proposal requests return INVALID_STATE. Only 40P01/40001 are automatically retried, maximum two; 23505 and uncertain outcomes are not retried. Existing race regression verifies one winning terminal decision, one decision receipt and one decision audit. A6 repeated evidence is recorded separately when complete.

## The 19 skipped tests

All are in `apps/api/test/integration/corrections.integration.test.ts`, named `A6 scenario …` below. Each is **environment-dependent / deliberately opt-in**, skipped because `A6_INTERLEAVINGS` defaults to zero. Each covers mandatory P4-2 A6/16.3 requirements and can run safely through the disposable harness. None is redundant, unsupported or approved for omission. Full integration retains these skips; the separate `full a6` run enables them with 1,000 iterations, parallelism 4 and seed 20261109.

1. scenario 1: same-field proposals, different keys
2. scenario 2: different-field proposals, one resident
3. scenario 3: independent name approvals
4. scenario 4: booking correction vs new booking
5. scenario 5: booking correction vs admission creation
6. scenario 6: admission update vs check-in
7. scenario 8: check-out correction vs new stay
8. scenario 7: check-in correction vs check-out
9. scenario 9: price correction vs createDraft
10. scenario 10: check-in correction vs monthly generation (billing gap)
11. scenario 11: price correction vs invoice issue
12. scenario 12: price correction vs payment (Resident-Invoice lock order)
13. scenario 13: approve vs reject
14. scenario 14: approve vs withdraw
15. scenario 15: duplicate same-key approvals / lost response
16. scenario 12-reversal: price correction vs reversal
17. scenario 12-credit: price correction vs credit
18. scenario 12-void: price correction vs void
19. scenario 10-scheduler: check-in correction vs real scheduler with a billing gap

## A1–A10 scorecard

Authoritative definitions: `P4-2_SPECIFICATION_v1.3_FINAL_FOR_OWNER_APPROVAL.md:439`. Required workload: 100 beds, 100 residents with bookings/stays, 12 months of invoices, at least 10 ordinary clients, one scheduler, one correction per gated field type. The existing functional fixture does not establish all these assumptions.

| Criterion | Required threshold | Actual evidence | Status |
|---|---|---|---|
| A1 Ordinary gate wait | lock_timeout ≤3s; 409 RETRY_REQUIRED, no Prisma timeout or partial write | Configured 3000ms; real advisory probe 3099.07ms wall time with rollback; ordinary writer integration checks 409 and no write, but permits up to 6000ms wall time | BLOCKED: functional/configuration proof only; strict workload measurement incomplete |
| A2 Correction gate hold | hard max ≤2s; target p95 ≤500ms | No acquired-to-commit distribution on specified workload | BLOCKED: benchmark instrumentation/fixture absent |
| A3 Attempt bounds | each acquisition ≤5s bounded by remaining budget; attempt ≤30s | Source budget logic inspected; no complete measured attempt/lock distribution | BLOCKED: instrumentation absent |
| A4 Generation hold | ≤A1 minus margin on 100-bed fixture, otherwise per-booking batching | No 100-bed generation hold measurement; margin not quantified | BLOCKED: workload/measurement absent |
| A5 Ordinary p95 | within 5% of pre-gate baseline, same suite/hardware | No retained pre-gate baseline | BLOCKED: provenance-matched baseline required; cannot substitute current run |
| A6 Deadlocks | zero 40P01, ≥1000 randomized rounds per defined race pair | Separate full a6 execution; per-pair results appended below | PASS — 19 scenarios individually completed 1,000 rounds with zero deadlocks |
| A7 Retries | ≤2 whole-transaction retries, no duplicate audit/receipt/application | Unit tests pass, real replay/race tests pass; real retry injection under required workload absent | BLOCKED: partial proof only |
| A8 Queue effect | 2s holder + waiting request; record new request wait | Holder 2000ms, first wait 2000.63ms, next 1899.75ms, two SQL transaction requests, pool 10 | PASS for SQL queue probe; HTTP workload qualification remains open |
| A9 Pool | gate held + K waiters, non-gated endpoints responsive | K=2, pool10, unrelated SQL read 8.03ms; no non-gated HTTP endpoint measurement | BLOCKED: SQL responsiveness is insufficient |
| A10 lock_timeout coverage | advisory and row waits aborted; exact 40P01/55P03/partial23505/P2028 Prisma shapes | Six real probes pass; exact shapes retained in integration-9643cd63-a93e-4d14-b9c6-26cb044d8f14.txt | PASS for driver coverage; billing-gap suppression is separate |

A10 details: advisory/row 55P03 → Prisma P2010/LOCK_TIMEOUT; deadlock 40P01 → P2010/DEADLOCK; partial-index 23505 → P2010 raw and P2002 model-create/UNIQUE_VIOLATION; expired transaction P2028 → UNCERTAIN. No error messages, credentials or SQL values are captured by these probes.

## Changes and cleanup

Added a focused historical-constraint regression. Extended existing disposable harness with `full a6` and `full probes` modes, preserving manifest verification, generated credentials, exact marker, separate roles, fresh cluster, loopback binding, tmpfs, label-checked cleanup. Results retention now includes skip names, per-pair A6 summaries and allowlisted probe JSON. No service/business rule or migration was changed in this closure task.

Completed full integration, browser and probe runs reported exact-container removal and tmpfs disposal. A6 cleanup must be recorded after completion. Shared PostgreSQL and volumes were not accessed. No commit, push, merge or deployment was performed.

## Completed A6 disposition

Run `87483414-45ff-4137-b178-0cbe13946b12`, command `node --import tsx scripts/qa/phase4-disposable.mjs full a6`: **19 passed / 0 failed / 0 skipped**, 1,145,315.10 ms. Seed 20261109, parallelism 4. Evidence: `integration-87483414-45ff-4137-b178-0cbe13946b12.txt`. Each baseline skipped test was executed individually as an enabled test in this run. No baseline skipped test remains unexecuted. These are functional race fixtures, not a substitute for the 100-bed performance workload.

| Race pair | Completed rounds | Total ms | Slowest operation-pair ms | Deadlocks |
|---|---:|---:|---:|---:|
| scenario 1 | 1000 | 38905 | 155 | 0 |
| scenario 2 | 1000 | 39308 | 103 | 0 |
| scenario 3 | 1000 | 52747 | 65 | 0 |
| scenario 4: booking correction vs new booking | 1000 | 64695 | 267 | 0 |
| scenario 5: booking correction vs admission creation | 1000 | 61464 | 84 | 0 |
| scenario 6: admission update vs check-in | 1000 | 51162 | 51 | 0 |
| scenario 8: check-out correction vs new stay | 1000 | 79781 | 146 | 0 |
| scenario 7 | 1000 | 56535 | 67 | 0 |
| scenario 9 | 1000 | 59556 | 72 | 0 |
| scenario 10 | 1000 | 60256 | 78 | 0 |
| scenario 11 | 1000 | 72145 | 120 | 0 |
| scenario 12 | 1000 | 77104 | 101 | 0 |
| scenario 13 | 1000 | 51564 | 59 | 0 |
| scenario 14 | 1000 | 50710 | 48 | 0 |
| scenario 15 | 1000 | 54943 | 55 | 0 |
| scenario 12-reversal | 1000 | 73439 | 89 | 0 |
| scenario 12-credit | 1000 | 68617 | 85 | 0 |
| scenario 12-void | 1000 | 66319 | 95 | 0 |
| scenario 10-scheduler | 1000 | 65078 | 91 | 0 |

Scenario 14: 505 approval wins and 495 withdrawal wins, no 5xx. Scenario 15: 1,000 applied-once outcomes with same-key replay assertions. Billing-gap scheduler suppression is scenario 10-scheduler, distinct from A10 driver probes.

A6 cleanup verified exact container removal and tmpfs disposal. All disposable runs in this closure have completed. No process or database is intentionally left running by this task. Final recommendation remains NOT ACCEPTED: A1 workload qualification, A2, A3, A4, A5, A7 real-retry workload evidence, and A9 HTTP/pool evidence remain incomplete. These are missing acceptance fixtures/measurements, not permission denials. A5 additionally requires a provenance-matched pre-gate baseline that is not present in the inspected evidence.
