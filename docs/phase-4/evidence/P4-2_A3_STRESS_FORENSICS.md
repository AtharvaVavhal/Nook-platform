# P4-2 A3 historical outlier forensics

**Disposition: A3 remains PARTIAL.** The previously reported outlier was not reproduced in the controlled run below, but it is not disproven: its original per-attempt artifact is unavailable, so its exact duration and phase breakdown cannot be reconstructed.

## Historical run

Run `fb5f85bc-a07b-4fe2-8d27-19a0e08384c2` is described in the preceding investigation as a strict attempt-duration assertion failure; ordinary HTTP responses were also reported around 27.9 seconds. The repository contains no raw artifact for this run. The contemporaneous instrumentation failed to persist the offending sample before failing its assertion. Consequently there is no defensible exact failed duration, backend PID, SQLSTATE, Prisma code, rollback timestamp, event-loop trace, or proof that the 27.9-second HTTP observation was the offending transaction attempt. It cannot be classified after the fact as an application defect, runtime scheduling delay, pool/HTTP delay, or measurement defect.

The source scenario now exercised is the opt-in `full performance` test in `apps/api/test/integration/corrections.integration.test.ts`: it builds a fresh 100-bed/resident/booking/active-stay fixture with 1,200 historical invoices; runs organization-gate contention and concurrent corrections; then performs three actual correction-approval HTTP requests whose disposable trigger runs `pg_sleep(31)` during the proposal update. The handler asserts HTTP 409 `RETRY_REQUIRED`, one attempt, an unchanged PENDING proposal and source resident value, and no approval receipt or application audit. The earlier failed run's exact original assertion site and lock-holder timing are not recoverable from its missing raw log, so this is a reproduction of the retained source workload, not proof that every historical scheduling condition was identical.

## Controlled reproduction

- Run: `5e1441f5-47da-4552-ba19-7d5c0ee4fb5b`, 2026-11-10 09:05:26 UTC.
- Hardware/runtime: Apple M4, arm64, 10 CPUs, 16 GiB RAM, Node v24.22.1; PostgreSQL 17.11 Alpine.
- Isolation: repository `full performance` disposable harness; fresh database, loopback `127.0.0.1:51884`, tmpfs, full migrations, separate runtime/migrator roles. Exact container cleanup verified.
- Test result: 1 test passed, 0 failed, 0 skipped; 107,752.166 ms.
- Workload produced 163 recorded Prisma transaction attempts across the whole test. The raw ledger records each attempt including errors, elapsed time, locks and terminal control event. The three 31-second controlled timeout cases are separately summarized below; their failures are intentional test stimuli, not failed test assertions.
- Across those 163 attempts, 33 recorded an error outcome: 10 held-gate lock timeouts (`55P03`/`P2010`), 10 stale/domain conflict outcomes, one genuine deadlock retry (`40P01`/`P2010`), five controlled serialization failures (`40001`/`P2034`), one controlled unique violation (`23505`/`P2002`), one controlled cancellation (`57014`/`P2039`), one row-lock timeout (`55P03`/`P2010`), one explicit cancel (`57014`/`P2010`), and the three long statement-timeout attempts (`57014`/`P2039`). The full ledger includes each individual duration and terminal state; the test passed all expected response and state assertions.
- Failure-safe diagnostics: the test emits a final snapshot from `finally`, even if an assertion fails. It records HTTP request/finish events, BEGIN/COMMIT/ROLLBACK submission and acknowledgement, Prisma invocation/settlement, lock durations, PostgreSQL backend state snapshots every 200 ms, and a 50 ms Node event-loop heartbeat. The backend observer is a temporary, read-only SECURITY DEFINER function created only inside this disposable database; SQL text is not captured. A first attempt to grant `pg_read_all_stats` directly to the migrator (run `713f6290-c614-45da-93d1-ba93fba8b42c`) was correctly rejected by the existing integration guard before fixture tests ran; its exact labeled container was cleaned up. The harness instead uses the scoped observer function, with no role membership or safety guard changed.

### Boundaries and samples

An attempt duration is measured monotonically from immediately before the Prisma interactive `$transaction` invocation through its returned promise settling. It includes connection acquisition, BEGIN, callback work, and transaction termination/rollback acknowledgement; it does not include HTTP work before the service invokes Prisma or response serialization/transport after the Prisma promise settles. HTTP wall time is independently measured from the Supertest request invocation through response completion. PostgreSQL backend snapshots are sampled observations, not a precise server-side timeout timestamp.

| Sample | Prisma attempt (ms) | HTTP wall (ms) | HTTP result | Error evidence | Rollback acknowledgement (ms) |
|---|---:|---:|---|---|---:|
| 0 | 29,009.501 | 29,058.253 | 409 `RETRY_REQUIRED` | SQLSTATE `57014`; Prisma `P2039`; `UNCERTAIN` | 0.773 |
| 1 | 29,009.422 | 29,065.209 | 409 `RETRY_REQUIRED` | SQLSTATE `57014`; Prisma `P2039`; `UNCERTAIN` | 1.541 |
| 2 | 29,010.413 | 29,066.591 | 409 `RETRY_REQUIRED` | SQLSTATE `57014`; Prisma `P2039`; `UNCERTAIN` | 0.749 |

The three attempt durations have p50 29,009.501 ms, p95/p99/max 29,010.413 ms (nearest-rank, n=3). Connection acquisition through BEGIN acknowledgement was 0.252–0.281 ms. Callback entry followed invocation by 0.289–0.322 ms. Each 31-second SQL operation was interrupted at about 29.008 seconds of attempt time; the reported `P2039` carried PostgreSQL `57014`. The Node callback observed the failed SQL and submitted ROLLBACK 0.053, 0.056 and 0.116 ms later; rollback acknowledgement took 0.773, 1.541 and 0.749 ms, with Prisma settlement 0.097, 0.082 and 0.132 ms after acknowledgement, respectively. The backend snapshots observed the target sessions active in `Timeout / PgSleep` while the trigger query ran; target-PID snapshot counts were 620 total, with 433 observations in that active wait state. The maximum sampled query age was 28,968.889 ms. The event-loop heartbeat had 2,055 intervals with maximum gap 53.646 ms (nominal interval 50 ms); no large scheduling stall was observed in this run.

The response and durable-state assertions passed on every sample: proposal remained PENDING; resident source value was unchanged; approval-receipt count was zero; `correction.applied` audit count was zero. The SQLSTATE is consistent with the server-side `statement_timeout` interrupt, while the Prisma boundary reports `P2039`. These observations support the current deadline implementation on this host and workload; three samples do not establish a universal bound or explain the historical outlier.

The same run's loaded held-gate HTTP requests returned 409 `RETRY_REQUIRED`; their maximum wall time was about 3.06 seconds. That separates ordinary HTTP contention from the 29-second controlled correction attempts, but does not reconstruct the historical approximately 27.9-second response.

## Evidence files and conclusion

- Raw sanitized harness output, including all 163 attempt records, all HTTP/control events, backend snapshots, heartbeat samples and test summary: `integration-5e1441f5-47da-4552-ba19-7d5c0ee4fb5b.txt` (SHA-256 and byte count are in the structured file).
- Filtered structured ledger: `P4-2_A3_STRESS_FORENSICS_5e1441f5.json`.
- Earlier successful three-sample trace: `A3_DEADLINE_TIMING_d3a79079.json`.
- Earlier failed run summary and cause of missing sample: `A3_TRANSACTION_DEADLINE_INVESTIGATION.md`.

No application deadline code or business behavior changed in this forensics run. The only code changes add failure-safe tracing to the opt-in test and a disposable-only observer function in the harness. No migrations were altered. The original outlier remains unresolved and A3 is **PARTIAL**, not PASS. To resolve that historical event conclusively, its original raw process/test output or an equivalent captured run with its original host/runtime scheduling conditions is required. The fresh controlled run narrows current evidence but does not erase the historical failure.
