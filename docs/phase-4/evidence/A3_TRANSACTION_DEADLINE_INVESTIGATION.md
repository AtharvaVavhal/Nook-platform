# A3 transaction deadline investigation — 2026-11-10

**Disposition: PARTIAL. The original active-SQL overrun mechanism is fixed and the final three near-deadline samples pass, but strict complete-attempt acceptance is not claimed.** An earlier traced stress run failed its <=30000ms assertion and lacks sufficient retained detail to attribute that outlier. Full endpoint-boundary coverage also remains incomplete. P4-2 remains NOT ACCEPTED.

## Root cause and exact boundary

Before: integration-800f1294-341d-407b-9bcf-032cc077335f.txt recorded a31s pg_sleep in a disposable BEFORE UPDATE trigger. The correction transaction had Prisma timeout30000ms and lock_timeout, but **no PostgreSQL statement_timeout**. A running statement is not bounded by lock_timeout. Installed Prisma7.10.1 runtime (`node_modules/@prisma/client/runtime/client.js`, transaction manager #f) closes a non-phantom transaction by awaiting executeRaw(ROLLBACK), then adapter rollback/release. Installed pg (`node_modules/pg/lib/client.js`, _pulseQueryQueue, approximately498–516) submits the next query only after activeQuery reaches ReadyForQuery. Thus the Prisma timer's rollback SQL queues behind the still-running31s statement. The timer is not an interrupt/cancel request for that statement. Adapter-pg's PgTransaction.rollback releases the connection after transaction-manager SQL; it is not a competing cancellation channel.

The before measurement31033.948ms starts at the test wrapper's call to `$transaction` and ends only when its promise settles, so includes connection acquisition,BEGIN,callback SQL,timeout propagation and rollback/release. It excludes earlier HTTP guards/request validation and later HTTP rendering/transport.31s SQL versus30s client timeout explains the approximately1000ms excess; the remaining33.948ms is combined startup/dispatch/error/rollback overhead. The old data does **not** permit attributing all33.948ms to rollback or splitting it exactly. No such split is invented. The same request's HTTP wall was31131.643ms, a different boundary.

Specification v1.3 §16.2 A3 says5s per acquisition bounded by remaining budget and no attempt exceeding30s. The conservative chosen measured boundary is invocation of `$transaction` through settled promise including cleanup; the clock is **not** stopped when cancellation is merely requested. Connection wait is counted by this boundary, even though Prisma's interactive timeout begins after startup. HTTP receipt/send is reported separately. The specification does not define an OS scheduling/network latency tolerance, and none has been approved.

## Small production change

* New `apps/api/src/common/correction-deadline.ts`: per-attempt absolute budget; **1000ms cleanup reserve within the unchanged30000ms maximum**; server statement_timeout recalculated before each operation; lock_timeout capped at5000ms,remaining budget,and any smaller explicitly requested lock timeout. Already-queued operations use freshly computed budgets. Work on the single pg connection is serialized in invocation order; the first database error stops later queued work and retains its identity.
* `apps/api/src/corrections/corrections.service.ts`: account for elapsed connection-acquisition time in each attempt; use bounded transaction client; refresh remaining server budget just before successful callback completion/COMMIT,including receipt replay. Prisma maxWait/timeout,READ COMMITTED,retry classes/limit,lock order and domain rules remain unchanged. Exhausted local work budget raises an explicit retryable conflict; unrelated database exceptions are not mapped to409.
* This is a runtime cancellation backstop,not a larger timeout or weaker test. The reserve admits approximately29s SQL/work and leaves1s for driver completion. A server-initiated statement cancellation remains57014/UNCERTAIN under the existing classifier; it is not automatically retried. No Promise.race returns success/failure while a hidden transaction keeps running.

A finite reserve cannot mathematically bound arbitrary OS suspension,network partition,server scheduling stalls or rollback I/O. No absolute real-time guarantee is asserted. The pre-COMMIT refresh reduces the remaining allowance for COMMIT itself but cannot promise a bounded client acknowledgment under arbitrary transport delay.

## Cases and results

Proposed sample plan,NOT owner-approved: three real31s-trigger HTTP attempts near the30s boundary, plus normal commit,real advisory/row contention,shortened near-budget tests for both lock types,explicit cancellation during row wait and execution,existing retry/nonretry and full integration regressions. No statistical confidence is inferred from three samples.

| Case | Actual test and result | Limitation |
|---|---|---|
| A Normal | Full correction integration passes,including durable application/audit/receipt and replay; control trace includes BEGIN/COMMIT acknowledgments | General production transport not bounded |
| B Advisory contention | Ten ordinary Booking HTTP writers return409 RETRY_REQUIRED under held gate; actual helper near-budget advisory test terminates at3002.621ms under4000ms attempt budget | Correction HTTP advisory-near-deadline matrix not complete |
| C Row contention | Actual correction approve blocked on Resident returns409 with no application receipt/source effect; raw acquisition and rollback timestamps retained | Configured5s and client observation are distinguished |
| D Near budget | Bounded client4000ms attempt minus1000ms reserve,2500ms work then advisory or row wait:3002.621/3010.624ms total;57014/P2010/UNCERTAIN; preceding write rolled back | Shortened real budget,not full near30s HTTP acquisition for every route |
| E Real expiry | Final three31s-trigger attempts:29011.434,29012.656,29014.834ms;57014/P2039/UNCERTAIN,HTTP409,no automatic retries; all source/audit/receipt checks unchanged | Prior traced stress failure remains unresolved; no universal hard-wall claim |
| F Cancellation | Correction HTTP row-wait cancellation returns409 and unchanged state; helper execution pg_sleep cancellation119.142ms,57014/P2010/UNCERTAIN,rollback verified | Not arbitrary network loss or unknown COMMIT |
| G Real endpoint | POST/corrections/:id/approve normal,wait,cancel,expiry and same-key receipt tests run through real guards/services/Prisma/PostgreSQL | Not every gated endpoint/fault cross-product |

Near-budget evidence: integration-89070efc-9f2f-428e-8116-f96306caa073.txt,8/8 passed. Two earlier development runs failed because SELECT pg_sleep returns unsupported PostgreSQL void when decoded by queryRaw; fixture changed to executeRaw. Those failures were fixture errors,not deadline-helper passes,and all resources were cleaned.

## Final trace and timing

Run d3a79079-861e-4960-a043-52a04b3fb5b3,1/1 measurement test passed,108726.296ms. Raw integration-d3a79079-861e-4960-a043-52a04b3fb5b3.txt; structured **A3_DEADLINE_TIMING_d3a79079.json**. Same disposable100-bed fixture,AppleM4/10 CPUs/16GiB,Node24.22.1,PostgreSQL17.11-alpine,tmpfs. Each sample creates a fresh proposal; the previous timed-out PENDING proposal is withdrawn through the real API before the next. The source value never changes on expiry.

| Sample | Entire attempt ms | HTTP client wall ms | ROLLBACK submit→ack ms | Classification |
|---|---:|---:|---:|---|
|0|29011.434|29069.238|2.410|57014 / P2039 / UNCERTAIN|
|1|29012.656|29091.326|1.496|57014 / P2039 / UNCERTAIN|
|2|29014.834|29095.236|1.526|57014 / P2039 / UNCERTAIN|

Attempt p50=29012.656ms,p95=p99=max=29014.834ms (nearest-rank,n=3). Maximum of **all** final traced attempts is29014.834ms. The first implementation stress run7d72ca4c-c411-4be0-a776-bf706f14b7e6 also passed three near-deadline samples,max29012.101ms,but preceded connection-wait accounting and detailed tracing and is supporting evidence only.

Structured final trace independently records:

1. Node HTTP request listener receivedMs and response finish sentMs (listener timing,not kernel packet-arrival time).
2. attemptBeginMs before invoking Prisma,callbackEnteredMs,backend PID,server transaction_timestamp and clock_timestamp.
3. Per-advisory and row call start/end,configured lock_timeout,remaining budget and success/failure.
4. Callback/businessStartedMs and businessFinishedMs. This spans authorization/receipt/locks/domain callback,not a claim of separately instrumented every domain substep.
5. pg control BEGIN/COMMIT/ROLLBACK submitted and acknowledged timestamps,tagged only by PID; no SQL values,headers orcredentials.
6. attemptTerminatedMs after Prisma settles. For each near-deadline sample,successful ROLLBACK acknowledgement precedes termination.

Commit/rollback submission timestamps mean driver API invocation; acknowledgment means server response received. They do not pretend to be exact server execution-start timestamps. Server transaction timestamps are retained separately,not mixed arithmetically with the Node monotonic clock. Test-only pg instrumentation is restored in finally. Heartbeat target50ms; maximum final gap101.787ms,so the final samples show no large event-loop stall.

## Failed stress run retained; strict bound not closed

Run fb5f85bc-a07b-4fe2-8d27-19a0e08384c2 failed the strict attempt-duration assertion after the server backstop was introduced. Its loaded ordinary3s HTTP requests were observed at approximately27.9s,demonstrating a large client/server/transport delay in that run. The failing sample duration was not logged before the assertion in that development version; no valid exact maximum or event-loop attribution can be reconstructed. That instrumentation defect was fixed so later attempts and control traces are logged even on failure,and heartbeat timing was added. **The outlier is not erased or declared a pass.** Current data cannot prove whether its delay was event-loop,host scheduling,server ortransport; investigating that requires a reproducible controlled runtime and independent server/connection trace. Three clean final samples do not prove that failure impossible.

Therefore A3 improves from an unprotected active-SQL failure to **PARTIAL with a verified server cancellation fix**,not unconditional PASS. Remaining technical work: attribute/reproduce the failed traced outlier; complete full near-budget HTTP matrix; agree an explicit sample plan and measurement boundary without waiving true overruns. Other acceptance criteria retain their existing status; this investigation does not approve A2/A4/A5/A9 decisions.

## Regression, files and cleanup

Changed: correction-deadline.ts; corrections.service.ts; correction-deadline.test.ts; corrections.service.test.ts(fake now correctly treats SELECT1 as a read); integration/corrections.integration.test.ts(timing/control/HTTP trace and3 expiry samples); scripts/qa/gate-locks.test.ts; scripts/ci/test-files.json(register new regression); this evidence and closure report.

Focused deadline/service/finance/harness:74 passed,0 failed. API typecheck passes; git diff --check clean. Full integration a09a4521-4e68-4120-992a-19bcdd6fa4ee:321 passed,0 failed,20 opt-in skips (performance + prior A6); final pre-COMMIT refresh has an additional integration run recorded in the closure report. The three expiry samples exercise the failure path,which skips the success-only pre-COMMIT refresh; that final refresh is covered by success/replay unit and integration tests.

Every disposable run reported label-checked exact-container removal/tmpfs disposal. Final trace,near-budget andintegration resource absence verified separately. Shared PostgreSQL/containers/volumes untouched. No commit,push,merge,branch switch,deployment or financial flag activation.

Final pre-COMMIT-refresh integration run4ba17145-96fb-4e99-bc8e-b6908c739c36: **321 passed,0 failed,20 opt-in skips,341 total**,67692.628ms. The20 skips are the separately executed performance test plus the19 previously completed A6 benchmarks,not newly bypassed failures. Final focused checks74/74,API typecheck and diff whitespace check pass. Workspace remainsfeature/phase-4-1-lifecycle-audit,74 tracked dirty files/41 untracked entries (new deadline helper and unit-test entries account for the increase from39). Existing changes preserved.
