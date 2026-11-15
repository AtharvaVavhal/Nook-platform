# Deploying the Nook API on Railway

> **Not validated on live infrastructure.** Production Railway deployment, TLS against a Railway-hosted database, backups and
> restoration have **not** been validated on live Railway infrastructure. The procedures below were exercised only against disposable
> local PostgreSQL 17 containers and the repository's automated tests. Treat every step as unverified on Railway and verify it yourself
> before relying on it.

A generic guide to running the Nook API against a Railway PostgreSQL service with authenticated TLS and least-privilege
database roles. Values (hostnames, passwords, fingerprints) are never committed; they live only in your platform's secret
store. Placeholders look like `<this>`.

## 1. Services

| Service        | Purpose                                                         | Public endpoint                                   |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `postgres`     | PostgreSQL 17.x, database `nook`                                | None. No TCP proxy; private networking only       |
| `nook-migrate` | One-off job: authenticated-TLS proxy + `prisma migrate deploy`  | None                                              |
| `nook-api`     | NestJS API                                                      | Platform-generated hostname, then your own domain |
| `nook-backup`  | Optional cron job: dump, encrypt, upload (`deploy-kit/backup/`) | None                                              |

Put the database and the API in the same region. Never let a service reference another service's `DATABASE_URL`: a
database template's own URL belongs to the superuser.

## 2. API variables (names and rules; values live only in the platform)

| Variable                                                                         | Secret?                 | Rule                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                        | no                      | `production`                                                                                                                                                                                      |
| `WEB_ORIGIN`                                                                     | no                      | exactly one HTTPS origin, e.g. `https://app.example.com` (CORS and the Origin guard use it; no wildcard)                                                                                          |
| `TRUST_PROXY_HOPS`                                                               | no                      | **Required in production.** Number of trusted proxy hops in front of the API; determine it with section 7, do not guess                                                                           |
| `LOG_LEVEL`                                                                      | no                      | `info`                                                                                                                                                                                            |
| `DATABASE_URL`                                                                   | **yes**                 | `postgresql://nook_app:<password>@<db-private-host>:5432/nook?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/tmp/db-ca.pem` (runtime role only). The API refuses to start with any weaker URL |
| `DB_CA_PEM`                                                                      | no (public certificate) | the database server's certificate (PEM); `scripts/ops/start-api.sh` writes it to the `sslrootcert` path                                                                                           |
| `CORRECTION_RECEIPT_SECRET`                                                      | **yes**                 | at least 32 random characters, generated once. Without it the corrections endpoints answer `503`                                                                                                  |
| `CORRECTIONS_FINANCIAL_APPLY_ENABLED`, `BILLING_SCHEDULER_ENABLED`, `SENTRY_DSN` |                         | leave unset unless you intend to enable them                                                                                                                                                      |

The API never receives the superuser URL or the migrator URL. The migration job never receives the runtime URL.

Migration job variables: `MIGRATION_DB_HOST`, `MIGRATION_DB_PORT`, `MIGRATION_DB_NAME`, `MIGRATION_DB_USER` (the migrator
role; superuser names are refused), `MIGRATION_DB_PASSWORD` (secret), `DB_CA_PEM`, `DB_CERT_SHA256` (fingerprint of the
server certificate, hex).

## 3. Database TLS

- **API side.** In production the API fails closed: `DATABASE_URL` must carry `sslmode=verify-full`, or
  `sslmode=verify-ca` with `uselibpqcompat=true` and a readable PEM `sslrootcert`. `disable`, `allow`, `prefer`,
  `require`, `no-verify`, a missing `sslmode`, and repeated or `ssl`/`sslaccept` parameters are refused at startup
  (`apps/api/src/config.ts`).
- **Pin the certificate.** Read the server certificate (public), print its subject, dates and SHA-256 fingerprint with
  `openssl x509 -noout -subject -dates -fingerprint -sha256`, and store the PEM as `DB_CA_PEM`. Never read the private
  key. Note the expiry date: if the platform regenerates the certificate, the pin must be refreshed.
- **Server side.** Reject non-TLS network connections by placing `hostnossl all all all reject` before the first `host`
  rule in `pg_hba.conf`, then `SELECT pg_reload_conf()`. Check afterwards that the rule survives a restart or image update
  on your platform.
- **Migrations.** The Prisma migration engine cannot verify a self-signed certificate, so
  `scripts/ops/migrate-with-tls-proxy.ts` runs the real `prisma migrate deploy` through a loopback-only proxy
  (`scripts/ops/pg-tls-proxy.ts`) that pins the CA and the certificate's SHA-256 fingerprint, rejects expired, changed or
  wrong-CA certificates, and never falls back to plaintext. If the endpoint cannot be authenticated the wrapper exits 3
  without migrating.

## 4. Roles and privileges

| Role            | Privileges                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres`      | superuser; provisioning and emergencies only; in no service variable except the database service's own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `nook_migrator` | owns the database and its objects; non-superuser; runs `prisma migrate deploy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `nook_app`      | `SELECT, INSERT, UPDATE` on application tables; **`SELECT, INSERT` only** on 13 append-only tables (`transfers`, `transfer_command_receipts`, `stay_assignment_replacements`, `transfer_finance_reviews`, `transfer_finance_resolutions`, `audit_events`, `invoice_voids`, `correction_command_receipts`, `correction_finance_links`, `payments`, `payment_reversals`, `invoice_adjustments`, `payment_idempotency_keys`); `SELECT` on the view `effective_stay_assignments`; `USAGE, SELECT` on sequences; no `DELETE`, `TRUNCATE`, DDL, ownership, or access to `_prisma_migrations` |
| `nook_backup`   | `SELECT` on every table including `_prisma_migrations`, the view and sequences                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Create the roles with `deploy-kit/provision.sql` (passwords travel as SCRAM verifiers produced by
`deploy-kit/scram_verifier.py`, never as plaintext), apply `deploy-kit/grants.sql` as `nook_migrator` after every
migration run, and require `deploy-kit/verify_privileges.sql` to return **zero rows**.

The four financial tables (`payments`, `payment_reversals`, `invoice_adjustments`, `payment_idempotency_keys`) also carry an
unconditional `BEFORE UPDATE OR DELETE` trigger that raises, so immutability does not rest on privileges alone. Triggers do
not cover `TRUNCATE` (blocked by not granting it), and an owner or superuser can disable triggers.

## 5. Order of operations

1. Create the database service; no TCP proxy, no public domain.
2. Provision roles (section 4) and pin the certificate (section 3).
3. Take and verify a backup before migrating a database that holds real data. Stop if the backup is missing or
   not completed.
4. Run the migration job; confirm all migrations are applied and none unfinished.
5. Apply `grants.sql`; run `verify_privileges.sql` (0 rows).
6. Deploy the API: build `npm ci && npm run build --workspace @nook/api`, start `sh scripts/ops/start-api.sh`, health
   check `/api/v1/health` (liveness; not `/health/database`). Platform health checks usually run only at deploy time and
   do not monitor afterwards.
7. Test the generated hostname (health, database health, invalid login → 401, request validation, CORS, restart) before
   attaching a custom domain. Use only the DNS records the platform shows you.

The migration job needs `tsx` and `prisma` (devDependencies), so do not prune them from its build.

## 6. Backups

`deploy-kit/backup/` holds an image (PostgreSQL 17 client, `age`, AWS CLI) and `backup.sh`: logical dump as the read-only
role over verified TLS, client-side `age` encryption (public keys only), upload to object storage with a SHA-256 manifest. A
backup is not verified until an encrypted copy exists off-platform **and** a restore from it succeeds
(`restore-acl-verification.sql` checks ownership and privileges of a restored copy against the CI matrix).

## 7. Determining `TRUST_PROXY_HOPS`

On the live platform hostname, make one failed sign-in from each of two different networks, then count address-scope rows
in `login_throttles` updated in the last five minutes (expect 2). Repeat with a forged `X-Forwarded-For` header; the count
must stay 2. See `docs/ops/WEB_API_TOPOLOGY.md` §6.4. Until verified, any value is an expectation, not a measurement.
