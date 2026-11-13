# Final P4-2 owner acceptance decisions

**Every item below is PROPOSED — NOT APPROVED. No financial activation is authorized.**

Authority: specification v1.3 §16.2–16.3, Decision6/16 worksheet and owner review05/06/07/16 acceptance table. Exact current routes checked against controllers; pre-gate snapshot908098acd567c299ad05529b5a533ad17622dceb has transactions without organization-gate acquisition. Existing measured values are evidence, not approvals.

## PERF-01 — A4 generation margin

Proposed rule: reserve **500ms** below A1's3000ms setting; successful generation acquired-to-COMMIT maximum≤2500ms. Rationale: explicit operational headroom for scheduling/rollback/transport, rather than using the entire ordinary wait budget. Method: 100-bed fixture,100 active stays,1200 historical invoices; separately report fresh creation and existing-slot runs under10 ordinary clients,30 samples each, actual scheduler and API. Existing measured maximum57.751ms leaves2942.249ms headroom against3000ms and2442.249ms against proposed2500ms. Approval establishes a judgeable threshold; rejection requires an alternative margin or batching requirement; deferral leaves A4 PARTIAL. No billing semantics change.

## PERF-02 — A5 exact routes and paired baseline profile

Proposed route matrix (all prefixed `/api/v1`):

* POST `/bookings`; PUT `/bookings/:id`; POST `/bookings/:id/extend`; DELETE `/bookings/:id`.
* POST `/admissions`; PUT `/admissions/:id` (date/approve/cancel/reopen action payloads are separate cases); DELETE `/admissions/:id`.
* POST `/check-ins`; PUT `/check-ins/:id` (notes); POST `/check-ins/:id/check-out`.
* POST `/finance/invoices` (draft); POST `/finance/invoices/:id/issue`; POST `/finance/invoices/generate-monthly`.

These are actual gate-covered controller routes, not invented endpoints. Historical/current service implementations materially differ in authoritative-read placement as well as added gate calls; compare whole implementations and disclose those differences, never a synthetic gate-disabled current build.

Recommended profile: same Apple M4 host, Node24.22.1, locked dependencies, PostgreSQL17.11-alpine tmpfs configuration; separate disposable clusters and historical/current schema/client generation; equivalent100-bed/100-stay/12-month fixtures;10 clients,100 warmups then1000 measured successful requests per route case, three alternating baseline/current paired repetitions. Use independent organizations per client for the noncontended-gate comparison; recreate lifecycle fixtures per state-changing case and exclude fixture setup from latency. Record client monotonic durations, p50/p95/p99 nearest-rank, throughput over measurement interval and error rate. Acceptance: each route's `100*(current_p95/baseline_p95-1) <= 5`, zero unexpected errors, report all repetitions without cherry-picking. Baseline is the exact verified commit above, not main.

Approval freezes routes and comparison method; rejection requires replacements; deferral leaves A5 BLOCKED. Archived candidate `/tmp/nook-p42-pregate-f282i9j0` exists, runtime dependency declarations match and Node engine is compatible; historical schema/client equivalence must still be validated in its own harness before measurement.

## PERF-03 — A9 HTTP pool responsiveness

Recommended K=10 (saturation case for default pool10), K=2 control; actual pool maximum must be measured, not presumed. Hold organization gate2s then3.5s in separate cases; verify K ungranted ordinary gate requests using pg_locks and pg_stat_activity.

Actual endpoint list: authenticated GET `/api/v1/residents`; authenticated GET `/api/v1/corrections/history?targetType=RESIDENT&targetId=<own-resident>`; GET `/api/v1/health`. Proposed p95/p99 ceilings: health100/250ms; residents500/1000ms; correction history500/1000ms. Proposed errors: zero unexpected errors/timeouts. Run100 warmups then≥1000 requests per endpoint over≥120s, target10 requests/sec per endpoint; report achieved throughput, don't extrapolate. Timestamp HTTP starts/completions plus sampled server access logs, pg_stat_activity wait_event and pg_locks, pool connection occupancy and connection-acquisition waits. Distinguish intentional gated409 from non-gated endpoint failure. Values are proposed engineering service objectives, not existing specification thresholds.

Approval permits a judgeable A9 run; rejection requires new K/endpoints/objectives; deferral leaves A9 BLOCKED. SQL-only responsiveness never satisfies this decision.

## PERF-04 — A2 representative sampling

Explicit required categories are Booking startDate/endDate/monthlyPrice, Admission admissionDate, CheckIn checkInAt and CheckOut checkOutAt. Name/reason corrections do not take the organization gate. Minimum existing specification workload is one of each gated field, ≥10 ordinary clients and one scheduler on100 beds/100 stays/1200 invoices; minimum distribution sample count is unspecified.

Proposed closure sample plan:1000 successful holds, at least100 per gated field (submit and apply distributions reported separately),10 ordinary clients plus scheduler overlap; three repetitions after100 warmups. Hard max≤2000ms, p95 target≤500ms, failed/conflicted/cancelled attempts separate. Gate acquisition→transaction resolution including commit acknowledgement, with transport overhead disclosed. Approval defines representativeness; rejection requires a different sample plan; deferral retains sampled engineering results without a full distribution PASS.

## PERF-05 — A1/A3 measurement boundaries

Existing requirement: PostgreSQL lock_timeout setting≤3000ms ordinary/≤5000ms correction and bounded by remaining budget; correction attempt timeout30000ms. Proposed reporting rule: distinguish server clock timestamps around acquisition/error, client SQL round trip, rollback acknowledgement and HTTP wall time. Do not redefine settings as a mathematically exact wall-time ceiling or hide scheduler overshoot. Report transaction deadline and late callback/error observation separately. Endpoint matrix follows PERF-02, including advisory/row contention, near-budget waits, cancellation and transaction expiry. Proposed samples:10 per fault per route case; no altered production timeout/isolation policy. Approval freezes scope/tolerances; deferral leaves endpoint-boundary evidence partial. An actual overrun/incorrect rollback is an engineering defect, not an owner exception.

## PERF-06 — A7 evidence classification

No policy change proposed: only40P01/40001, maximum2 full retries; no23505 or uncertain automatic retry; exactly one durable application/audit/receipt. Accept explicitly labeled disposable database fault injection at the real HTTP boundary as policy evidence, together with separate natural-conflict error-shape evidence. A PostgreSQL sequence can count injected failures across rolled-back attempts; test trigger is scoped to a test-owned proposal and removed in finally. No production migration, trigger, isolation or feature flag changes. Approval accepts the stated methodology, not financial activation; rejection requires an alternative safe reproduction; deferral leaves methodology acceptance open even when measurements pass. Naturally occurring SERIALIZABLE40001 remains distinct from READ COMMITTED HTTP injection.

Owner response fields for each ID: APPROVE / REJECT / DEFER; alternative values; decision date; approver. No response has been recorded by this agent.
