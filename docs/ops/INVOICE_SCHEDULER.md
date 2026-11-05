# Daily invoice job (Railway Cron service)

Status: **implemented and tested against the isolated scratch database only. No production job has been run, no cron service
exists, and `BILLING_SCHEDULER_ENABLED` must stay unset everywhere until the owner approves each step in section 5.**

Design and reasoning: `docs/nook-phase-3/TASK_4F3_INVOICE_SCHEDULER_PLAN.md` (with the per-booking amendment, section 11).

## 1. What it does

`node dist/jobs/run-invoice-schedule.js` (also `npm run job:invoices --workspace @nook/api`) runs once and exits.

For every **ACTIVE** organization, one at a time, and for each month from the previous to the current one (Asia/Kolkata), it runs
the same generation the API uses, with the **system actor** (no user) and `source: "scheduler"`:

| Rule                 | Behaviour                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing unit         | **one active invoice per booking per month**; a resident with two bookings (bed transfer) gets two full-month invoices                                                                                                                                                                                                                        |
| First/last month     | charged in full, no proration                                                                                                                                                                                                                                                                                                                 |
| Overstay / extension | only the booking's period, including approved extensions, is billed; nothing beyond it                                                                                                                                                                                                                                                        |
| Due date             | the later of the 5th of the month and the issue date (so a catch-up invoice issued after the 5th is due on issue)                                                                                                                                                                                                                             |
| Voided invoices      | do not occupy the slot: the next run replaces a voided invoice exactly once; the voided invoice, its void record and its audit trail are untouched                                                                                                                                                                                            |
| Existing invoices    | never changed, re-issued or duplicated                                                                                                                                                                                                                                                                                                        |
| Audit                | exactly one `finance.invoice.issued` event per invoice created (actor null, `source: scheduler`, `request_id` = the run id); one `finance.invoices.generated` per organization-month that created something; one `finance.scheduler.run` per live run (organization null); `finance.scheduler.failed` in the failing organization's own trail |
| Idempotency          | a rerun, a late run or an overlapping run creates nothing and writes no per-invoice event                                                                                                                                                                                                                                                     |
| Concurrency          | each organization-month is one transaction under the organization's invoice-numbering advisory lock, with partial unique indexes as the backstop; tested with four simultaneous runs plus manual generation                                                                                                                                   |
| Failure handling     | a transient failure (deadlock, lost connection, pool timeout, restart) is retried up to 3 times with backoff 250 ms, 500 ms; any other error is recorded and skipped; **other organizations and months still run**; exit code 1                                                                                                               |
| Missed runs          | the next run covers the previous month again, so one missed day or one missed month-boundary is repaired automatically; use `--lookback N` (0-12) after a longer outage, after a `--dry-run`                                                                                                                                                  |

## 2. Command line and exit codes

```
run-invoice-schedule [--dry-run] [--lookback 0-12] [--org <uuid>]... [--confirm-target host:port/database]
```

| Flag / variable                  | Meaning                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                      | plan and report only; **writes nothing, not even an audit event**; needs neither the enable flag nor a confirmation                          |
| `--lookback N`                   | months before the current one to include (default 1)                                                                                         |
| `--org <uuid>`                   | restrict to these organizations (repeatable): a supervised first run. Without it, every ACTIVE organization is billed                        |
| `BILLING_SCHEDULER_ENABLED=true` | **required for a live run**; any other value (including `TRUE`, `1`, empty) refuses                                                          |
| `--confirm-target host:port/db`  | **required for a live run** and must equal the database `DATABASE_URL` points at, so a mis-set variable cannot invoice the wrong environment |

| Exit | Meaning                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- |
| 0    | every organization-month succeeded (or there was nothing to do)                                     |
| 1    | at least one organization-month failed, or the job crashed; the others ran                          |
| 2    | refused to start, **nothing touched**: bad arguments or configuration, disabled, or target mismatch |

The job **never loads a `.env` file** (no dotenv): the environment comes from the platform only, so a stray file cannot choose
the database. Output is the same structured JSON as the API, one object per line on stdout; look for
`"message":"invoice scheduler finished"` (`created`, `failed`, `dryRun`, `months`, `durationMs`).

## 3. Railway setup (operator; nothing here has been done)

1. New **Cron service** in the same Railway project, same repository and build as the API.
2. Schedule `30 0 * * *` (UTC) = **06:00 IST**. Railway cron runs in UTC and may start a few minutes late; the job tolerates that.
3. Start command: `node dist/jobs/run-invoice-schedule.js --confirm-target <host:port/database as in DATABASE_URL>`
   (the host:port is Railway's private database address; use the exact value the dry run prints as `target`).
4. Variables (service level, secrets masked): `APP_ENV=production`, `WEB_ORIGIN`, `TRUST_PROXY_HOPS` (the job shares the API's
   configuration loader, so they must be present; the values are not used by the job), `DATABASE_URL` = the **runtime role's**
   URL (never the migrator), `LOG_LEVEL=info`, optionally `SENTRY_DSN` / `SENTRY_ENVIRONMENT` (failures are reported with the
   run id as request id), **and `BILLING_SCHEDULER_ENABLED` left UNSET** until step 5.4.
5. Railway marks a cron run failed when the process exits non-zero (exit 1 or 2), which is the alerting signal; enable Railway
   deployment/run-failure notifications for the owner. Exit 0 with `created: 0` is normal on most days.

### Database role

The runtime role needs no new privilege: `SELECT`/`INSERT`/`UPDATE` on the finance tables and `INSERT` on `audit_events` are
what the API already uses (the job writes only invoices and audit events). Confirm with the reviewed grants script (P1 #5).

## 4. Disable, pause, roll back

| Action                   | How                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause tomorrow's run     | unset `BILLING_SCHEDULER_ENABLED` (every live run then exits 2 and touches nothing)                                                                                                                                                                                                 |
| Stop completely          | disable or delete the Cron service; the API is unaffected                                                                                                                                                                                                                           |
| Undo invoices it created | nothing is deleted. Void an unpaid auto-issued invoice through `POST /finance/invoices/:id/void` (audited, terminal). Find them with `SELECT target_id FROM audit_events WHERE action = 'finance.invoice.issued' AND metadata->>'source' = 'scheduler' AND request_id = '<run id>'` |
| Code rollback            | revert the commit; there is no schema change specific to the job                                                                                                                                                                                                                    |

## 5. Enablement sequence (each step needs the owner's explicit approval)

1. Deploy the migrations first (Layer 1, then the invoice-uniqueness migration), then the code. Run the production pre-flights.
2. `--dry-run` for one pilot organization (`--org <uuid>`), review the plan: bookings, months, would-create counts.
3. Supervised live run for that organization only (`--org`, enable flag set for the run), then check invoices, due dates and the
   audit events (`finance.invoice.issued`, `request_id` = run id).
4. Repeat the live run: expect `created: 0`.
5. Remove `--org`, set `BILLING_SCHEDULER_ENABLED=true` on the Cron service, watch the first scheduled run.

## 6. Monitoring

```sql
-- last live run, and whether it had failures
SELECT occurred_at, metadata FROM audit_events WHERE action = 'finance.scheduler.run' ORDER BY occurred_at DESC LIMIT 5;
-- organizations whose month failed in the last two days
SELECT organization_id, metadata->>'month' AS month, metadata->'error'->>'name' AS error, occurred_at
  FROM audit_events WHERE action = 'finance.scheduler.failed' AND occurred_at > now() - interval '2 days';
```

No `finance.scheduler.run` event in the last 36 hours means the job did not run or was refused: check the Railway run history.

## 7. Known limits

- The job needs the invoice-uniqueness migration (partial unique indexes) on the target database; without it the per-booking rules
  are not enforced by the database. Do not enable it before that migration.
- A run walks organizations sequentially; thousands of organizations would need batching (not an issue at pilot size).
- A month whose booking has no recorded check-in is not billed (stay-based billing, as everywhere else).
- Multi-booking policy: a bed transfer yields two full-month invoices for that month (frozen policy); the owner corrects it with a credit.
