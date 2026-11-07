# PostgreSQL backup and restore (Railway) — P0 #3

> **Status: restore readiness is NOT established.**
> No restore drill has been executed. Railway's backup settings have not been inspected (this repository has no Railway
> configuration and no access to the Railway account was used). Nothing in this document may be read as "backups are
> enabled" or "restore works" until section 10 is filled in with real evidence.

## 1. What is known and what is not

| Question                                                        | Answer today                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Are Railway volume backups enabled for the production database? | **Unknown.** Do not assume. Check the PostgreSQL service's _Backups_ tab (section 3.1).                                         |
| Which Railway plan, region, PostgreSQL major version?           | **Unknown.** Hosting is still partly open (`ADR-010`). The restore tools must be the same major version as the server or newer. |
| Does Railway PostgreSQL offer point-in-time recovery?           | **Assume no.** No WAL archiving is configured by this project. Recovery granularity is the last backup.                         |
| Is there an independent (off-Railway) copy of the data?         | **No.** None is configured.                                                                                                     |
| Has a backup ever been restored?                                | **No.**                                                                                                                         |

What Railway offers (from its documentation as the author knows it, to be **re-read and recorded here on the day**,
because plans and behaviour change): volume backups of the database service, manual and on a daily / weekly / monthly
schedule, on paid plans; a restore from a volume backup is performed from the dashboard. Record in section 10 the exact
schedule, retention and whether a restore replaces the volume or creates a new one — that detail decides which
procedure in section 6 applies.

## 2. Strategy: two independent layers

A backup held by the same provider, in the same account, as the database does not protect against account loss, a
mistaken deletion of the service, or a provider incident. So:

1. **Layer 1 — Railway volume backups** (platform-level, fast to restore, same failure domain). Turn on a daily
   schedule and keep manual backups before every release and migration.
2. **Layer 2 — independent encrypted logical backups** (`pg_dump`, custom format) written **off Railway** to storage the
   owner controls. This is the copy that survives losing the Railway project. _Design only: the storage service,
   credentials, cost and the job that runs it (a Railway Cron service running `pg_dump` and an upload) need the owner's
   approval and are not implemented._

Restores always go to a **new, separate database** first. Production is never restored in place (section 6).

## 3. Configuration to apply and record (production; done by an operator, not by this repository)

### 3.1 Layer 1 checklist

- [ ] Backups tab of the PostgreSQL service: schedule **daily** enabled; weekly and monthly enabled if the plan allows.
- [ ] Retention recorded: daily **_ / weekly _** / monthly \_\_\_.
- [ ] Manual backup taken and **named** before each release and each migration (`pre-release-YYYY-MM-DD`).
- [ ] Who can restore or delete backups in the Railway project: \_\_\_ (least privilege; at least two owners).
- [ ] A restore of a Layer 1 backup into a new service has been tried once (section 10).

### 3.2 Layer 2 (proposal, awaiting approval)

| Item           | Proposal                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tool           | `pg_dump --format=custom --serializable-deferrable` (consistent snapshot, no locks that block the application)   |
| Client version | Same major as the server or newer (a v16 client cannot dump a v17 server)                                        |
| Connection     | Railway's TCP proxy URL with `sslmode=require`, using a **read-only** database role created for backups          |
| Schedule       | Daily at 02:30 IST (21:00 UTC), away from the invoice run at 06:00 IST; plus on demand before releases           |
| Encryption     | Before it leaves the job, section 5                                                                              |
| Destination    | Object storage under the owner's control, versioned bucket, write-only credentials for the job, no public access |
| Verification   | After each upload: size and checksum recorded; a monthly restore drill (section 8)                               |
| Alerting       | A job that exits non-zero, or no new object in 36 hours, alerts the owner                                        |

## 4. Recovery objectives and retention (proposed — the owner must ratify)

| Objective                           | Proposal                                                                             | Basis                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **RPO** (data you may lose)         | **24 hours** for a full loss; shorter if you restore a Railway backup taken that day | Daily backups, no PITR                                                                                    |
| **RTO** (time to a working service) | **4 hours** for the pilot                                                            | Estimate. **Replace with the measured time from a drill**; the drill report records each step's duration. |
| Retention, Layer 2                  | 14 daily, 8 weekly, 12 monthly                                                       | Cost versus the need to notice slow corruption                                                            |
| Retention, finance records          | Per Indian statutory requirements; **the owner's accountant confirms the period**    | Not decided here. GST treatment is itself still pending.                                                  |

RPO 24 hours means up to a day of payments, bookings and check-ins can be lost. The owner needs a way to reconstruct a
lost day (paper receipts, UPI statements, WhatsApp messages). Section 6.4 covers the reconciliation.

## 5. Encryption and credential handling

Backups contain residents' personal data and the full financial ledger. They are as sensitive as the database itself.

- **Encrypted before they touch a disk or leave the machine.** The drill script pipes `pg_dump` straight into
  `openssl enc -aes-256-cbc -pbkdf2 -iter 600000` with a passphrase read from a **file** (mode `600`, at least 24
  characters). No plaintext dump is ever written. The passphrase is never on a command line, in the environment of a
  long-lived process, or in the repository.
- **Integrity.** `openssl enc` does not authenticate. The script records a SHA-256 of the encrypted file and re-checks it
  before decrypting; the real integrity proof is a successful restore plus the comparison in section 8. For Layer 2,
  prefer an authenticated tool such as `age` (needs installation approval; not present on this machine).
- **Passphrase custody.** Held in the owner's password manager **and** a second sealed copy held by a second person. If
  every copy is lost, every backup is unreadable: this is a single point of failure to manage deliberately. Rotate it
  when someone with access leaves; old backups need the old passphrase, so keep a record of which passphrase protects
  which date range.
- **Database credentials.** Passed to the tools through libpq environment variables (`PGPASSWORD` and friends), taken
  from environment variables you name; never as arguments (visible in `ps`), never printed, never committed. The drill
  script prints only `host:port/database`. Use a **read-only role** for backups and the migrator/admin role only to
  create a drill database.
- **In transit.** `sslmode=require` (or stricter) on every connection that leaves a private network.
- **Where restores run.** Treat any restored database as production data: scratch or cloud, access limited to named
  people, no copies on laptops without the owner's say-so, and **delete drill databases and dumps when the drill is
  reviewed** (section 8.5).

## 6. Restore procedures

Golden rules: restore into a **new** database; never overwrite production in place; keep the broken database until the
restored one is verified; write down what you did.

### 6.1 Rehearsal / verification restore (no incident)

Use the drill (section 8). It never touches the source except to read it.

### 6.2 A few rows or one table were damaged or deleted

1. Restore the most suitable backup into a new database (drill script or Railway restore into a new service).
2. Find the rows in the restored copy (read-only queries).
3. Apply the correction to production with a **reviewed SQL script** run in a transaction, after a fresh manual backup.
   Invoices, payments, voids and audit events are append-only/immutable by trigger: do not try to bypass them; correct
   through the application's own correction paths (reversal, credit, void) wherever one exists.
4. Record the change (what, why, who approved) in the incident log.

### 6.3 The database or the Railway service is lost or unusable

1. Declare the incident (section 7). Put the API in maintenance (stop the service or return 503) so nothing writes to
   a half-restored database. **Keep the invoice scheduler disabled.**
2. Create a **new** PostgreSQL service (same major version or newer). Do not delete the old one yet.
3. Restore into it from the chosen backup (Layer 1 restore or `pg_restore` from the decrypted Layer 2 dump).
4. Roles: `pg_dump` does not carry roles or passwords. Recreate the migrator and runtime roles and their grants with the
   reviewed grants script (P1 #5, not yet written), then re-apply ownership/privileges. Confirm the runtime role
   **cannot** update or delete `audit_events`, `invoice_voids`, `payments` (section 8.3 prints the matrix).
5. Check the migration state is what the application expects (`_prisma_migrations` lists every migration as finished)
   **without running any migration** during recovery.
6. Run the verification (section 9) against the restored database. Stop if anything differs from the backup's source.
7. Point `DATABASE_URL` (runtime role) at the new database, deploy/restart the API, run the smoke test (sign in, read an
   invoice, record nothing).
8. Revoke every session (`sessions.revoked_at`), because the restored `sessions` table may contain sessions that were
   valid at backup time.
9. Re-enable the invoice scheduler only after the owner confirms the data and after a `--dry-run`.
10. Keep the old database read-only until the incident is closed.

### 6.4 After any restore to an earlier point: reconcile the gap

Everything recorded between the backup and the incident is gone. For each hostel: list payments received, bookings made,
residents added and check-ins/outs since the backup time (UPI/bank statements, receipt books, messages), re-enter them
through the application, and have the owner sign off the reconciliation. Never fabricate historical receipt snapshots or
void records; re-enter payments as new payments with their real received date.

## 7. Incident responsibilities

Fill in names before launch; a role with no name is a gap.

| Role                             | Responsibility                                                                                                | Person |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| **Owner / decision maker**       | Declares a data incident, approves restoring and any data loss, tells hostel owners, signs the reconciliation | \_\_\_ |
| **Operator (Railway/DB access)** | Takes and restores backups, runs the drill, holds the backup credentials                                      | \_\_\_ |
| **Second operator (backup)**     | Same access, holds the second passphrase copy, reviews destructive steps                                      | \_\_\_ |
| **Developer on call**            | Diagnoses the application, runs verification, prepares correction SQL for review                              | \_\_\_ |
| **Communicator**                 | Informs affected hostel owners; records the timeline                                                          | \_\_\_ |

Escalation: operator → owner within 15 minutes of confirming data loss or corruption. No restore over production, no
deletion of backups and no manual edit of ledger tables without the owner's explicit approval, recorded in the log.

## 8. The restore drill

`scripts/ops/restore-drill.sh` (with `scripts/ops/restore-verify.sql`). It dumps a **source** database, encrypts the
dump, creates a **new** drill database, decrypts and restores into it in a single transaction, fingerprints both
databases and compares them. It has four commands: `plan` (contacts nothing), `fingerprint` (read-only, one database),
`run`, and `cleanup` (drops only a drill database it created, by exact name).

### 8.1 Safety built into the script

- The source is only read: read-only sessions (`default_transaction_read_only=on`).
- The target must be a **new** database named `nook_restore_drill_*` on the admin connection's cluster. The names
  `postgres`, `template0/1`, `nook_dev`, `nook_test` and anything not matching the pattern are refused, as is a database
  that already exists, a target equal to the source, an existing output directory, and a missing confirmation.
- Source and target must each be confirmed by typing `host:port/database`.
- `run` additionally requires `--yes-create-database`: creating a database needs prior approval.
- Passwords never appear in arguments or output. The dump is never on disk unencrypted. The passphrase file must be
  mode `600`.
- `cleanup` refuses any database whose comment does not start with `nook-restore-drill:` (set only by `run`).
- The script's refusal paths are unit-tested with failing stand-ins for the PostgreSQL tools
  (`apps/api/test/restore-drill.test.ts`).

### 8.2 Running it

```sh
# environment variables hold the URLs; the values are never typed on a command line
export SOURCE_DATABASE_URL='postgresql://<read-only-user>:<password>@<host>:<port>/<database>?sslmode=require'
export DRILL_ADMIN_URL='postgresql://<admin-user>:<password>@<target-host>:<port>/postgres'

scripts/ops/restore-drill.sh plan \
  --confirm-source <host>:<port>/<database> \
  --target-db nook_restore_drill_20261105 --confirm-target <target-host>:<port>/nook_restore_drill_20261105 \
  --out-dir ~/nook-drills/2026-11-05 --passphrase-file ~/nook-drills/passphrase --source-kind production-backup

# same arguments, then:  run ... --with-acl --runtime-role <runtime role> --yes-create-database
```

- **Tool versions.** Use a `pg_dump`/`pg_restore`/`psql` of the same major as the _source_ server (or newer). On a
  machine whose client is older, run the tools inside a matching container: `--runner docker-exec:<container>` (the
  hosts and ports are then as the container sees them: `--tool-host`, `--tool-port`).
- **`--with-acl`** restores owners and privileges and compares them; the roles must already exist in the target cluster.
  Without it, ownership and privileges are _not restored and not verified_, and the report says so.
- **`--source-kind production-backup`** marks a drill that restored a real production backup. A drill from a scratch
  source is reported as a rehearsal only.

### 8.3 What is compared (source == restored, line by line)

| Section                                                                        | Proves                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext`, `table`, `column`, `index`, `constraint`, `trigger`, `function`, `enum` | The schema survived: every table, column (type, nullability, default), index definition, constraint definition, trigger definition (the immutability/guard triggers), function body and enum                          |
| `rows`                                                                         | Exact row count per table                                                                                                                                                                                             |
| `hash`                                                                         | A content hash of every row of every table with an `id` (rows rendered as text in UTC, ordered by id): the data is identical, not just the same size                                                                  |
| `owner`, `acl`, `runtime_priv`                                                 | (`--with-acl`) table owners, privileges, and what the runtime role may do on `audit_events`, `payments`, `payment_reversals`, `invoice_adjustments`, `invoice_voids`, `invoices`, `residents`, `bookings`, `sessions` |
| `ledger`                                                                       | Finance invariants hold identically (section 9)                                                                                                                                                                       |
| `total`                                                                        | Money totals, a per-organisation digest, audit-event count and the migration state match                                                                                                                              |

It does **not** prove business correctness of the source data (a backup of corrupted data restores as corrupted data),
that the application works against the restored database, or that the Railway backup mechanism itself ran.

### 8.4 Evidence and RTO

Each run writes `report.md` (durations of dump+encrypt, decrypt+restore, fingerprint; sizes; hashes; the comparison;
the ledger counts) into the output directory. Copy the figures into section 10. The measured restore time of the largest
realistic dataset, plus the time to provision a service, repoint and smoke-test, is the real RTO.

### 8.5 After the drill

The reviewer inspects the report. Then, with the owner's approval, `cleanup --target-db <name> --confirm-target ...`
drops the drill database, and the encrypted dump is deleted from every location (or kept under the retention rule if the
drill used a real production backup and the owner wants to keep it). Nothing is dropped automatically.

### 8.6 Cadence

Before launch (a production-backup drill is the exit criterion), then monthly for the first quarter, quarterly after,
and after any migration that changes the finance tables or the grants.

## 9. Verifying that restored financial records are consistent

Two checks, both automatic in the drill and both usable by hand on any restored database:

**Equality with the source** (`hash`, `rows`, `total`, `ledger` identical). This catches missing, altered or truncated
data.

**Internal consistency** (the `ledger` lines are counts of violating rows). On a healthy production database every
one is `0`, except `cancelled_without_void`, which counts legacy cancelled invoices created before void records existed
(never invent void records for them):

| Line                                                     | Rule                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `paid_amount_drift`                                      | `paid_amount` equals live payments minus `adjustment_total` for every invoice                                             |
| `adjustment_total_drift`                                 | `adjustment_total` equals the sum of the invoice's credits                                                                |
| `status_contradicts_amounts`                             | The stored status matches the amounts (PAID / PARTIALLY_PAID / ISSUED rule)                                               |
| `negative_cash`, `paid_exceeds_amount`                   | Cash never negative; paid never above the invoice amount                                                                  |
| `partially_paid_without_live_payment`                    | A part-paid invoice has real cash behind it                                                                               |
| `payments_on_draft_or_cancelled`                         | No LIVE (unreversed) payment sits on a draft or cancelled invoice (reversed payments stay on a voided invoice as history) |
| `draft_with_money`, `cancelled_with_money`               | Drafts and voided invoices hold no money                                                                                  |
| `duplicate_invoice_numbers`, `reversals_without_payment` | Numbering unique per organisation; every reversal points at a payment                                                     |
| `cancelled_without_void`                                 | Informational (legacy)                                                                                                    |

If a count is non-zero **in the source too**, the restore is faithful but the data already had a problem: do not call the
restore "consistent"; open a finance issue. A non-zero count only in the restored copy means the restore is unfaithful:
stop.

Then reconcile with people: pick five recent invoices per hostel and compare invoice, payments and receipt with the
owner's own records; confirm the month's `total|invoices_paid_amount` against their collection sheet.

## 10. Evidence log (fill in; unfilled means not done)

| Item                                                                   | Evidence / date / who                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Railway Layer 1 schedule and retention recorded (3.1)                  | **not done**                                               |
| Layer 2 approved and implemented (3.2)                                 | **not done**                                               |
| Passphrase custody agreed (5)                                          | **not done**                                               |
| Roles named (7)                                                        | **not done**                                               |
| Drill 1 — scratch rehearsal (procedure and tooling)                    | **not run** (awaiting approval to create a drill database) |
| Drill 2 — production backup restored and verified (**exit criterion**) | **not run**                                                |
| Measured RTO                                                           | **unknown**                                                |
| Layer 1 restore into a new service tried                               | **not done**                                               |

**Restore readiness may be claimed only when drill 2 has passed and the owner has ratified RPO/RTO.** (RPO 24 hours and the retention in section 4 are approved as planning targets; RTO 4 hours stays provisional until measured on a realistic dataset. Layer 2 is deferred until after the controlled pilot.)

## 11. Known limitations and risks

- `audit_events` is append-only **by privilege, not by trigger**: the runtime role cannot update or delete it (verified in
  the restored copy), but the owning/migrator role can. Keep the migrator credential out of the running application and
  consider an immutability trigger as a later hardening step.

- `pg_dump` does not include roles, role passwords or cluster settings: roles and grants must be recreated separately
  (P1 #5).
- A logical dump is consistent as of its snapshot; it is not a point-in-time stream. Writes after the snapshot are not in it.
- The content hash renders rows as text; it assumes the same PostgreSQL major and `TimeZone=UTC` (the script sets it).
  A restore into a different major version can legitimately render a few types differently: investigate, do not ignore.
- The hash covers every row of every table with an `id`; for very large tables the fingerprint takes longer. Revisit when
  `audit_events` reaches tens of millions of rows.
- The local machine used for rehearsals has little free disk space; the drill needs roughly twice the database size
  (encrypted dump + restored copy).
