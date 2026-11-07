# Task 4F.3 — Automatic invoice generation: scheduler plan

Status: **design only. No scheduler code, no dependency, no route, no migration, no schema change.** Date 2026-11-02, baseline HEAD `c85dcce`.
The optional run-log SQL in section 6 is **unexecuted** and waits for your approval; the recommended design does not need it.

Builds on: `TASK_4F_FINANCE_PLAN.md` §4.5–4.6 (months to generate, missed runs), `TASK_4F1_…` (decision 10: one audit event per automatically
issued invoice), and the verified 4F.1/4F.2 behaviour (exclusive booking end, stay-based eligibility, extensions, void, hardened invoice guard).

## 0. Recommendation in one paragraph

Run **one idempotent job entry point once a day**, started by an **external scheduler** (host cron, systemd timer or platform scheduler), not by an
in-process cron library. The job processes every active organization **one at a time, each in its own transactions**, for the **previous and the current
Asia/Kolkata month**, by calling the existing, already-verified `generateMonthly` logic with `issue: true`, a **system actor** and a `scheduler` source label.
Because generation is already idempotent, advisory-locked per organization and protected by unique keys, a missed day, a double start or two instances all
converge on the same result, so **no new coordination state is needed**. Observability uses **`audit_events`** (no migration), structured logs and the process
exit code. A dedicated run-log table is optional and specified in section 6 for approval, not required.

## 1. Requirements and how each is met

| Requirement                                                       | Design                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily execution                                                   | External trigger once a day at **06:00 IST** (`30 0 * * *` in UTC). The time of day does not affect correctness: the job reads "today" in Asia/Kolkata itself                                                    |
| Current-month generation                                          | Month `M` = IST month of the run instant. Billable stays (stay ∩ booking `[start, end)`, extensions included) get a full-month invoice, issued automatically                                                     |
| Previous-month catch-up                                           | Month `M−1` is processed in the same run, so a move-in recorded late, an extension approved late, or a missed run is billed at the next run. Older months are **not** automatic (manual `generate-monthly` only) |
| Idempotency, duplicate prevention                                 | Existing `(organization, resident, period)` invoices are skipped; unique key + `skipDuplicates` are the backstop; a second run creates nothing and writes no per-invoice events                                  |
| Missed-run recovery                                               | Next run repeats `M−1` and `M`, so any gap up to the previous month heals itself. Longer outages: `--lookback N` on the command line, with a dry run first                                                       |
| Transaction and concurrency safety                                | One transaction per `(organization, month)`; per-organization advisory lock on numbering (existing); runs may overlap safely (section 4)                                                                         |
| Approved extension handling                                       | Eligibility reads the booking's current `endDate`, which an approved extension already moved. No scheduler-specific logic (section 3.4)                                                                          |
| Existing invoice preservation                                     | The job only inserts. It never updates, issues, voids, reprices or deletes anything that exists, including manual drafts and voided invoices                                                                     |
| Exactly one issuance audit event per automatically issued invoice | Written by the existing generation code in the **same transaction** as the invoice rows; a rolled-back transaction leaves neither. Tested for retries and concurrent runs                                        |
| Failure reporting, observability                                  | Section 5                                                                                                                                                                                                        |
| Organization isolation                                            | Section 3.5                                                                                                                                                                                                      |
| Timezone                                                          | Section 3.6                                                                                                                                                                                                      |

## 2. Mechanism options evaluated

|                                                                   | A. `@nestjs/schedule` in the API process                                             | **B. External trigger → job entry point (recommended)**                     | C. External trigger → secret-protected HTTP endpoint | D. `pg_cron` in the database                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| New dependency                                                    | Yes (`@nestjs/schedule` + a cron library); S10 requires exact pins and your approval | **None**                                                                    | None                                                 | A PostgreSQL extension, which the scope guard lists as needing approval |
| New API surface                                                   | None                                                                                 | **None**                                                                    | A new route (S8 approval) and a long-lived secret    | None                                                                    |
| Works if the API sleeps, scales to zero or is deployed serverless | **No**: the timer lives and dies with the process                                    | **Yes**                                                                     | Yes                                                  | Yes                                                                     |
| Several API instances                                             | Every instance fires (safe only because of the locks)                                | **One invocation per tick**                                                 | One request per tick                                 | One                                                                     |
| Missed run when the process is down                               | Lost until the next tick                                                             | **Healed by the catch-up window**                                           | Healed                                               | Healed                                                                  |
| Credential used                                                   | The API's runtime role                                                               | **The runtime role** (never the owner/migrator)                             | Runtime role plus a bearer secret                    | Database owner context                                                  |
| Failure visibility                                                | Only in the app log                                                                  | **Exit code + structured log + audit event** (cron/host alerts on non-zero) | HTTP status                                          | Hidden in the database                                                  |
| Testability                                                       | Needs fake timers                                                                    | **A plain function called with an injected clock**                          | HTTP + clock                                         | Hard                                                                    |
| Hosting assumption                                                | Long-running single process                                                          | **Anything that can run a command on a schedule**                           | Anything that can send an HTTP request               | Postgres host must allow it                                             |

The hosting target for the API is **not recorded in the repository**, which is the main reason to avoid options that assume a long-lived process or a
specific platform. Option B makes no assumption beyond "something can run a command daily". It also follows the repository's existing pattern for
out-of-band operations (`scripts/ops/*`), with the safer difference that it uses the **runtime** role.

### 2.1 Shape of option B

- `apps/api/src/finance/invoice-scheduler.service.ts`: `run({ now, lookbackMonths, organizationIds?, dryRun? })`, plain and unit-testable with an injected clock.
- `apps/api/src/jobs/run-invoice-schedule.ts`: builds a standalone Nest application context (no HTTP listener) from a minimal module (`DatabaseModule` + `FinanceModule`), calls the service, prints the summary, exits `0` / `1` / `2`.
- `package.json` script `billing:run`, run as `node dist/jobs/run-invoice-schedule.js` in production.
- Guard rails copied from the operator scripts: refuses to start unless `BILLING_SCHEDULER_ENABLED=true`, and requires `--confirm-target host:port/database` to match `DATABASE_URL`, so a mistyped environment cannot bill the wrong database.
- No new route, no dependency, no raw SQL, no migration. (S8, S9, S10 unaffected; a slice 3.8 entry is added to the guard manifest for the new files' purpose.)

## 3. Behaviour in detail

### 3.1 What one run does

```
now      = injected clock (defaults to the real clock)
today    = Asia/Kolkata calendar date of `now`
months   = [ month(today) − lookback … month(today) ]      // default lookback = 1  →  previous, current
orgs     = organizations with status ACTIVE, ordered by id   // DISABLED organizations are skipped and counted
for org in orgs (sequential):
  for month in months, oldest first:
    try   generate(org, month, issue = true, actor = system, source = 'scheduler')   // its own transaction
    catch record the failure, continue with the next month / organization
write one run-summary audit event; exit non-zero if anything failed
```

Oldest month first keeps invoice numbers in period order. Months are never in the future (the existing "no later than next month" rule is not used by the job).

### 3.2 Idempotency and duplicate prevention (what already guarantees it)

1. `generateMonthly` first takes the per-organization numbering advisory lock, so two runs for one organization serialize.
2. It reads the organization's existing invoices for the period and skips every `(resident, period)` that exists, whatever its status (draft, issued, paid, **voided**).
3. `UNIQUE(organization, resident, period_start)` and `createMany … skipDuplicates` are the last line of defence.
4. Per-invoice audit events are written only for invoices **this call created**, in the same transaction. A re-run creates none, so it writes none.
   Consequences: a second start, an overlapping start and a start on two machines all produce the same final data and the same number of audit events.

### 3.3 Failure isolation and recovery

- A failure in one `(organization, month)` rolls back **only that transaction** (invoices and their audit events together), is recorded, and the job carries on.
- The next daily run retries it automatically, because nothing was created. No "retry queue" is needed.
- A failure that stops the whole job (database unreachable) writes nothing; the non-zero exit status and the missing success event are the signal (section 5).

### 3.4 Approved booking extensions

The scheduler adds no extension logic. Eligibility already uses the booking's current `endDate`, and an approved extension moves it. Two behaviours worth knowing:

- An extension approved **before** a month is invoiced makes that month billable at the next run.
- An extension approved **after** a month was invoiced changes nothing already issued (existing invoices are preserved). A month not yet invoiced inside the catch-up window is billed at the next run; older months need the manual endpoint.
  Overstay days past the booking end are never billed without an extension, so the scheduler cannot bill them either.

### 3.5 Organization isolation

- Each call is made with one organization id, and the generation code filters every query by it.
- Organizations are processed one at a time with no shared state; one organization's failure or large size cannot change another's result.
- The only cross-organization read is the list of active organization ids.
- The runtime role has no privilege that the API does not already have.

### 3.6 Timezone (Asia/Kolkata)

- "Today", the current month and the previous month are derived from the IST calendar date of the run instant (the shared `common/time.ts` helpers), never from the host time zone.
- The job's own time of day is irrelevant to correctness; 06:00 IST is chosen to run after overnight check-ins are recorded and well after the IST day rollover (18:30 UTC).
- IST has no daylight-saving changes, so there is no skipped or repeated hour.
- Tested under several `TZ` values with an injected clock around the IST month boundary (`2026-10-31T18:29Z` vs `18:30Z`).

### 3.7 Due dates, numbering and known catch-up effects

- Auto-issued invoices get `due = later of the 5th of the billing month and the issue date`, so a catch-up invoice is due on the day it is issued and is never born overdue.
- Invoice numbers use the IST year of the issue time, so a December invoice caught up in January is numbered in the new year (known, recorded in the 4F plan §4.2b).
- Manual drafts are left as drafts: the job never issues something a person created.

## 4. Concurrency and safety analysis

| Situation                                | Outcome                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Job started twice at once / two machines | Second waits on the organization lock, then finds the invoices and creates none; one set of invoices, one set of events |
| Job overlaps a manual "generate" click   | Same lock; whichever is second creates nothing                                                                          |
| Job overlaps a payment or reversal       | Different rows; payment code locks the invoice row, generation only inserts new invoices                                |
| Job overlaps a booking extension         | The extension commits before or after the stay query; either way the next run reconciles inside the catch-up window     |
| Crash mid-run                            | Committed organizations/months stay; the in-flight transaction rolls back wholly; the next run repeats it               |
| Database restored from backup            | Idempotent re-run regenerates what is missing                                                                           |

The hardened invoice guard (4F.2) does not obstruct the job: it only inserts invoices, in `DRAFT`-or-`ISSUED` states that satisfy the new CHECK (`issued_at` present exactly when issued).

## 5. Failure reporting and observability (no migration)

1. **Exit code:** `0` all succeeded or nothing to do; `1` at least one organization/month failed; `2` refused to start (disabled, wrong target). Cron or the platform scheduler alerts on non-zero.
2. **Structured log lines** to stdout, one per `(organization, month)` plus a summary: `run_id`, `organization_id` (UUID only, no names or e-mail), `month`, `status`, `eligible`, `created`, `skipped_existing`, `duration_ms`, `error_code`. No resident data is logged.
3. **Audit events** (`audit_events`, `actor_user_id = NULL` = system, `organization_id` set where applicable; the runtime role already has INSERT/SELECT):
   - `finance.invoice.issued` per created invoice, already written by generation with `{ automatic: true, source: 'scheduler', month }`.
   - `finance.invoices.generated`: the existing batch event per organization/month that created something.
   - `finance.scheduler.run`: **one per run** with totals and the list of failed organization/months. Written in its own transaction so it survives failures.
   - `finance.scheduler.failed`: per failed organization/month, written in a **separate** transaction (the failed one rolled back), with a sanitized, truncated error code and message.
4. **Missed-run detection:** "no `finance.scheduler.run` event in the last 36 hours" is a one-line query, and the same fact can be monitored from the scheduler's own success/failure record. Optional later: a read-only status route feeding a "last automatic run" card (needs S8 approval; not part of 4F.3).
5. **Dry run:** `--dry-run` runs the same code inside transactions that are rolled back and prints what would be created. It is required for the first enablement.
   No outbound notification (e-mail/WhatsApp/SMS) is proposed: messaging is out of scope and the scope guard forbids messaging SDKs.

## 6. Is a run-log migration needed?

**Not for the recommended design.** `audit_events` already provides an append-only, organization-scoped, queryable record with a nullable actor, and it is the approved audit mechanism. A dedicated table would add typed columns and an index for "last successful run per organization" but no new correctness guarantee.

**Optional table, only if you want a typed run history or a Finance status widget** (unexecuted; needs your approval, a slice 3.8 entry, a Prisma model, and a runtime grant of `SELECT, INSERT`):

```sql
-- OPTIONAL — not required by the recommended design. phase-scope: slice-3.8
CREATE TABLE "invoice_generation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "eligible" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped_existing" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_generation_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoice_generation_runs" ADD CONSTRAINT "invoice_generation_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_generation_runs" ADD CONSTRAINT "invoice_generation_runs_month_format"
  CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "invoice_generation_runs" ADD CONSTRAINT "invoice_generation_runs_trigger_valid"
  CHECK ("trigger" IN ('scheduler', 'manual'));
ALTER TABLE "invoice_generation_runs" ADD CONSTRAINT "invoice_generation_runs_status_valid"
  CHECK ("status" IN ('SUCCEEDED', 'FAILED'));
ALTER TABLE "invoice_generation_runs" ADD CONSTRAINT "invoice_generation_runs_error_iff_failed"
  CHECK (("status" = 'FAILED') = ("error_code" IS NOT NULL));
ALTER TABLE "invoice_generation_runs" ADD CONSTRAINT "invoice_generation_runs_counts_valid"
  CHECK ("eligible" >= 0 AND "created" >= 0 AND "skipped_existing" >= 0 AND "created" <= "eligible");
ALTER TABLE "invoice_generation_runs" ADD CONSTRAINT "invoice_generation_runs_time_order"
  CHECK ("finished_at" >= "started_at");

CREATE INDEX "invoice_generation_runs_organization_id_started_at_idx"
  ON "invoice_generation_runs"("organization_id", "started_at" DESC);
CREATE INDEX "invoice_generation_runs_started_at_idx" ON "invoice_generation_runs"("started_at" DESC);

-- Append-only, reusing the existing function.
CREATE TRIGGER "invoice_generation_runs_immutable" BEFORE UPDATE OR DELETE ON "invoice_generation_runs"
  FOR EACH ROW EXECUTE FUNCTION "finance_forbid_correction_change"();
```

Compatibility: purely additive, no existing row or object touched. Rollback: `DROP TABLE` loses only run history (no financial data), which is the one place a table rollback is harmless. The column name `trigger` is a SQL keyword used only as a quoted identifier; rename it to `triggered_by` if you prefer.

## 7. Implementation plan (when approved)

| Step | Change                                                                                                                                                                                                    | Notes                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1    | `FinanceService`: let `generateMonthly`'s core accept `actor: string \| null`, a `source` label (`generate-monthly` or `scheduler`) and an injected `now`; keep the HTTP method's signature and behaviour | The audit helper already accepts a null actor                                                   |
| 2    | `InvoiceSchedulerService` + pure `monthsToProcess(now, lookback)`                                                                                                                                         | Unit tests with an injected clock                                                               |
| 3    | `jobs/run-invoice-schedule.ts` + `billing:run` script                                                                                                                                                     | Standalone context, exit codes, `--dry-run`, `--lookback`, `--organization`, `--confirm-target` |
| 4    | Failure events in a separate transaction; run-summary event                                                                                                                                               | Section 5                                                                                       |
| 5    | Scope manifest slice 3.8 (purpose only; no routes, no tables unless section 6 is approved)                                                                                                                | S8/S9/S10 unaffected                                                                            |
| 6    | Tests, scratch-database verification, runbook (how to schedule, monitor, dry-run, disable)                                                                                                                |                                                                                                 |

## 8. Test plan (PostgreSQL integration on the scratch database, plus unit tests)

Unit: `monthsToProcess` at IST month and year boundaries and under several `TZ` values; lookback bounds; never a future month.
Integration:

1. Creates and issues current-month invoices; exactly one `issued` event each; actor null, `source = scheduler`.
2. Previous-month catch-up creates missing previous-month invoices only for billable stays.
3. Second run creates nothing and writes no per-invoice events (counts compared before and after).
4. Two concurrent runs (and a run racing a manual generate): one set of invoices, one event each, numbers unique and sequential.
5. Missed-run recovery: no run for 20 days, then one run bills the gap inside the window; a month older than the window is not billed.
6. Existing invoices preserved: drafts stay drafts, issued/paid/voided untouched (row hashes equal).
7. A voided invoice's month is not regenerated.
8. Extension: stay past booking end is not billed; after an approved extension the next run bills it; an invoice issued before the extension is unchanged.
9. Inactive and archived residents with valid stays are billed; stays outside the booking period are not.
10. Organization isolation: with an induced failure for organization A only, organization B is billed; A's transaction is fully rolled back; a `finance.scheduler.failed` event exists for A; exit status is non-zero.
11. `DISABLED` organizations are skipped.
12. Rollback atomicity: a failure after the invoice insert leaves neither invoices nor events.
13. Dry run writes nothing.
14. Refuses to start without `BILLING_SCHEDULER_ENABLED` or with a mismatching `--confirm-target`.
15. IST boundary with an injected clock at `18:29Z` vs `18:30Z` on the last day of a month, under several `TZ` values.
16. Runtime-role privileges are sufficient (no owner credential used).

## 9. Decisions I need from you

| ID  | Decision                                                                | Recommendation                                                                                                                          |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Issue automatically, or create drafts for the owner to review?          | **Issue** (the frozen rule: one audit event per automatically issued invoice)                                                           |
| S2  | Catch-up window                                                         | **Previous + current month**, overridable by `--lookback`                                                                               |
| S3  | Run time                                                                | **06:00 IST daily**                                                                                                                     |
| S4  | Mechanism                                                               | **External trigger → job entry point (option B)**. Needs you to say where the API runs, or accept any host that can run a daily command |
| S5  | Run log                                                                 | **`audit_events`** (no migration); adopt the table in section 6 only if you want a typed history or a Finance status widget             |
| S6  | Skip `DISABLED` organizations                                           | **Yes**                                                                                                                                 |
| S7  | Alerting                                                                | **Non-zero exit status handled by the scheduler/host**; no outbound messaging                                                           |
| S8  | First enablement                                                        | **Dry run on the target, review, then enable**; production enablement needs your explicit approval                                      |
| S9  | A read-only "last automatic run" route and card on the Finance overview | **Later (4F.3b)**; needs S8 route approval                                                                                              |

Risks to be aware of: automatic issuance means residents' invoices exist without a human looking at them (S1 mitigates with the dry run and the audit trail);
a wrong booking price, or a stay recorded wrongly, is billed automatically (the correction path is a credit, or a void while nothing is settled);
and the first enablement may create previous-month invoices for stays that were never invoiced manually (the dry run shows exactly which).

---

## 10. Platform-specific implementation plan (added after the 2026-11-03 approvals)

Approved: external daily trigger at 06:00 Asia/Kolkata (decision 7); `audit_events` as the run record, no run-log migration (decision 8).

### 10.1 Which platform? The repository does not say

Evidence searched: `README.md`, `docs/**`, `.github/workflows/ci.yml`, `docker-compose.yml`, `.env.example`, both `package.json` files, and the repository root for `vercel.json`, `Dockerfile`, `fly.toml`, `render.yaml`, `railway.json`, `Procfile`, `app.yaml`.

- **No deployment target is recorded.** Hosting is explicitly open: `ADR-010` and `BR-OPS-005` are `OPEN` (`PHASE_2_OWNER_DECISION_REGISTER.md`), and "managed PostgreSQL" is "an intention, not a selected provider".
- The only automation present is **GitHub Actions** (CI). `docker-compose.yml` is local development only.
- The Vercel setup visible in this workspace belongs to the unrelated FORGE marketing site, not Nook. It is not evidence for the API.

So nothing below assumes a host. The job is specified as a **host-neutral command**, with a concrete binding for each realistic host, and one decision (S4) is needed from you before any code is written.

### 10.2 The job contract (identical on every host)

| Item          | Specification                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Command       | `node dist/jobs/run-invoice-schedule.js` (built output of `apps/api/src/jobs/run-invoice-schedule.ts`), run from the same build artefact as the API                                                                                                          |
| Schedule      | Once daily at **06:00 Asia/Kolkata = 00:30 UTC**. India has no daylight saving, so a fixed UTC cron is exact: `30 0 * * *`                                                                                                                                   |
| Months        | Previous IST month, then current IST month, per organization (`--lookback` default 1)                                                                                                                                                                        |
| Idempotency   | Inherited, not re-implemented: per-organization advisory lock, `(resident, booking, period)` uniqueness and the existing duplicate checks. A second run, an overlapping run, or a manual rerun creates nothing new                                           |
| Unit of work  | One transaction per organization per month; a failing organization rolls back alone and is reported, the others continue                                                                                                                                     |
| Organizations | Active organizations only, sequentially; every query is scoped by `organization_id`                                                                                                                                                                          |
| Actor         | System: `actor_user_id = NULL`, audit `metadata.source = 'scheduler'`, `automatic = true` (the audit writer already accepts a null actor)                                                                                                                    |
| Audit         | Exactly one `finance.invoice.issued` event per auto-issued invoice (existing behaviour of `generateMonthly`), plus one `finance.scheduler.run` event per run and `finance.scheduler.failed` per failed organization-month, written in a separate transaction |
| Exit status   | `0` success or nothing to do, `1` at least one organization failed (others completed), `2` refused to start (disabled, wrong target, missing config)                                                                                                         |
| Database role | The **runtime** role (`SELECT/INSERT/UPDATE`; `SELECT/INSERT` on `audit_events`). No migrator credential on the scheduler                                                                                                                                    |

### 10.3 Missed-run recovery

- A missed day needs no special action: the next run covers the previous and current month, and generation is idempotent.
- A missed **month boundary** (no run at all on the 1st or 2nd) is still recovered by the first run in the new month, which sees the earlier month as "previous".
- A longer outage (more than one month) is recovered by a manual `--lookback N` run, after a `--dry-run`.
- **Detecting a missed run:** no `finance.scheduler.run` event in the last 36 hours:

```sql
SELECT max(created_at) AS last_run FROM audit_events WHERE action = 'finance.scheduler.run';
```

Alert if `last_run` is older than 36 hours. This is read-only SQL for an operator or monitor, not a new route.

### 10.4 Host bindings

|                       | A. GitHub Actions `schedule`                                                                                                                                                    | B. Platform cron job (Render, Railway, Fly machines, ECS scheduled task, Cloud Run job, Kubernetes CronJob) | C. Host/VM cron or systemd timer                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Needs in repo         | One workflow file                                                                                                                                                               | The API container/build; the platform runs the command from §10.2                                           | A crontab/timer unit on the API host                |
| Schedule              | `cron: '30 0 * * *'` (UTC). GitHub may delay scheduled runs, sometimes by 15+ minutes at busy times, and disables scheduled workflows after 60 days without repository activity | Native, usually on-time; most offer cron in UTC                                                             | Exact; `CRON_TZ=Asia/Kolkata` or the UTC equivalent |
| Database reachability | The database must accept connections from GitHub-hosted runners (public endpoint + allow-list, or a self-hosted runner). Often **not** acceptable for a production database     | Same private network as the API: normally the best fit                                                      | Local to the API host                               |
| Secrets               | GitHub environment secret `SCHEDULER_DATABASE_URL`, with required reviewers on the production environment                                                                       | Platform secret store, same as the API's                                                                    | Root-readable env file, mode 600                    |
| Failure notification  | Failed workflow emails the repository watchers; add an issue-on-failure step                                                                                                    | Platform job-failure alert on non-zero exit                                                                 | `MAILTO`, or a systemd `OnFailure=` unit            |
| Fit                   | Reasonable only if the database is reachable from it                                                                                                                            | **Recommended once the API host is chosen**                                                                 | Fine for a single VM                                |

My recommendation: **B** on whatever platform hosts the API (same network, same secret store, native failure alerts). **A** is a fallback only if the production database can safely accept GitHub's runners. I would not choose C unless the API runs on one VM.

### 10.5 Secrets and configuration

| Name                        | Where                             | Purpose                                                                                                                                          |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SCHEDULER_DATABASE_URL`    | Scheduler job's secret store only | Runtime-role connection string. Never committed, never printed, never in process arguments                                                       |
| `BILLING_SCHEDULER_ENABLED` | Job environment                   | Must be exactly `true` for a non-dry run, otherwise the job exits `2` before touching the database                                               |
| `BILLING_SCHEDULER_TARGET`  | Job environment                   | Expected `database/host`, compared with `--confirm-target`; a mismatch exits `2` (prevents a staging job pointing at production, or the reverse) |
| `APP_ENV`                   | Job environment                   | Same meaning as for the API                                                                                                                      |

The job logs the database name and host, never the connection string, and its structured log lines contain organization ids and counts only.

### 10.6 Disable and roll back

1. **Pause:** set `BILLING_SCHEDULER_ENABLED=false` (the next run exits `2` and does nothing), or disable the platform job or workflow. Nothing in the API changes.
2. **Stop at once:** disable the trigger. A run already in flight finishes its current organization-month transaction (each is atomic).
3. **Undo generated invoices:** nothing is deleted. Auto-issued invoices are ordinary invoices: an unpaid one is voided through `POST /finance/invoices/:id/void` (audited, terminal). The audit trail identifies them: `finance.invoice.issued` with `metadata.source = 'scheduler'`.
4. **Code rollback:** the job is a separate entry point with no schema change, so reverting the commit removes it with no database step. There is no migration to reverse.

### 10.7 First enablement sequence

1. Merge the job code with the scheduler **disabled**.
2. On the scratch database: full test plan (§8) including races against manual generation and extensions.
3. On the target environment: `--dry-run` (prints what would be created, writes nothing); review the list.
4. One supervised live run with `--lookback 0`; check audit events and invoice counts.
5. Enable the schedule. Production enablement needs your explicit approval at each step.

### 10.8 Decision still open

**S4 is now blocking:** which host runs the API and the database (and therefore the trigger)? Until it is answered, the next code step I can take without guessing is the host-neutral part (§10.2 job, flags, exit codes, tests on scratch), with no workflow file, no dependency and no migration.

---

## 11. Amendment, 2026-11-03: billing is per booking

Wherever this plan says "per resident per month", read **per booking per month** (frozen billing policy; see
`TASK_4F_INVOICE_UNIQUENESS_MODEL.md`). The scheduler calls the same `generateMonthly` logic, which now:

- creates at most one active invoice per booking per billing month, so a resident with two bookings in a month (a bed transfer)
  gets two full-month invoices;
- ignores `CANCELLED` invoices when deciding whether a month is already billed, so a voided invoice is replaced on the next run,
  exactly once;
- skips a resident who has an active legacy invoice with no booking for that month;
- still writes exactly one `finance.invoice.issued` audit event per invoice it creates, and none on a rerun.

The idempotency and concurrency arguments in section 3 are unchanged: the advisory lock and the partial unique indexes
(`invoices_active_booking_period_key`, `invoices_active_resident_period_legacy_key`) are the guards. The scheduler must be deployed
only after migration `20261103130000_invoice_active_uniqueness` has been applied.

---

## 12. Implemented, 2026-11-03

The plan is implemented (code, tests and runbook; **no production run, no cron service**): `apps/api/src/jobs/`
(`run-invoice-schedule.ts`, `invoice-schedule.cli.ts`, `invoice-scheduler.service.ts`, `schedule-months.ts`, `jobs.module.ts`),
`FinanceService.previewMonthly` and the `source`/system-actor option of `generateMonthly`, tests
`invoice-scheduler.test.ts` and `invoice-scheduler.integration.test.ts`, runbook `docs/ops/INVOICE_SCHEDULER.md`.
Differences from the plan: no run-log table (audit events only, as decided); the job lives in the API workspace and shares its
configuration loader; `--org` filters were added for supervised first runs.
