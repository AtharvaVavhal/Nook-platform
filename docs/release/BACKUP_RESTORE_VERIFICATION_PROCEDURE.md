# Production backup and restore — verification procedure (pilot)

**Status: NOT PERFORMED. Backup readiness is not established.** The only restore evidence in the repository is a rehearsal on a scratch database with trivial data (`docs/phase-4/evidence/2026-11-13_restore-rehearsal-report.md`). It proves the script and tooling work; it does not prove that a production backup exists, is recent, or restores. Nothing here was run against production, and no production credential was requested or used.

Authoritative background: `docs/ops/BACKUP_RESTORE.md`. Tool: `scripts/ops/restore-drill.sh` (read-only on the source, creates only a NEW `nook_restore_drill_*` database, never restores in place).

## A. Operator confirmations required before the pilot (the operator signs each)

| # | Confirmation | Evidence to record |
|---|---|---|
| 1 | Named operator and a named deputy who may restore | names, dates |
| 2 | Hosting platform's volume backups are **enabled** for the production database | screenshot/export of the Backups tab: schedule, retention, plan |
| 3 | Whether a restore replaces the volume or creates a new service (decides the procedure in §B) | platform documentation read on the day |
| 4 | PostgreSQL major version of the server, and that the client tools used are the same major or newer | `SELECT version()` output |
| 5 | A read-only database role exists for dumps, and its URL is held by the operator only | role name (not the URL) |
| 6 | An independent encrypted logical backup copy exists **off the hosting platform** (or the owner accepts, in writing, that none exists for the pilot) | location, owner, retention |
| 7 | The owner accepts the recovery granularity: **last backup only** (no point-in-time recovery is configured) | written acceptance |

## B. Procedure (operator performs; Claude does not receive production URLs or data)

1. **Pre-release backup.** Take a manual, named backup `pre-release-YYYY-MM-DD` (platform) before the first deployment of the Phase 4 migration chain (six additive migrations, no down-migration exists). Record its identifier and time.
2. **Logical dump and restore into a separate database** with the existing script, run by the operator from a trusted machine with the same-or-newer PostgreSQL client:
   ```sh
   export SOURCE_DATABASE_URL=...   # read-only role, production or a restored copy of the platform backup
   export DRILL_ADMIN_URL=...       # admin URL of a SEPARATE scratch/staging cluster (never production)
   scripts/ops/restore-drill.sh plan  --source-kind production-backup --confirm-source host:port/db \
     --target-db nook_restore_drill_<date> --confirm-target host:port/nook_restore_drill_<date> \
     --out-dir <new dir> --passphrase-file <mode-600 file> --with-acl --runtime-role <runtime role>
   scripts/ops/restore-drill.sh run   <same options> --yes-create-database
   ```
   `plan` connects to nothing and must be reviewed first. `--with-acl` needs the application roles to exist in the target cluster; without it, permissions are reported as NOT VERIFIED.
3. **Pass criteria** (all in the generated `report.md`): every comparison section PASS (extensions, tables, columns, indexes, constraints, triggers, functions, enums, row counts, content hashes, migration ledger, totals, and — with `--with-acl` — owners, privileges and runtime-role privileges); ledger invariants show 0 violations except the documented legacy `cancelled_without_void`; migration ledger lists all 24 migrations.
4. **Application smoke test on the restored copy** (staging only): start the API against the restored database and sign in as an OWNER; open a resident profile, an invoice and a receipt; confirm balances equal the source figures recorded in §B.3.
5. **Measure** dump time, restore time and total time (reported by the script) as the real recovery-time estimate for the pilot's data volume.
6. **Clean up** only the drill database the script created (`restore-drill.sh cleanup`, named), and securely delete the encrypted dump and passphrase file per the owner's retention rule.
7. **Record** the report, the operator's name, date, source identifier and the result in `docs/ops/BACKUP_RESTORE.md` §10. Repeat monthly during the pilot and before every release that includes a migration.

## C. Failure handling

- Any section FAIL, a missing ledger entry or a failed single-transaction restore: **stop**, do not proceed with the release, keep the artifacts, and report the exact section.
- If a production migration fails: stop; do not redeploy blindly, edit applied migration checksums, drop append-only tables or revert the application after data was written. Inspect the ledger and catalog, then forward-repair or restore into a separate database and cut over only after verification. (Verified behavior: a failed `prisma migrate deploy` leaves partial DDL and a P3009 lock.)

## D. Sign-off (pilot go/no-go input)

| Item | Done by | Date | Result |
|---|---|---|---|
| §A confirmations 1–7 | operator | | |
| §B steps 1–5 passed on a real backup | operator | | |
| Owner acceptance of recovery granularity | owner | | |
