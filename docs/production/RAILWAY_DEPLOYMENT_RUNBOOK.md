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

| Variable                                                                         | Secret?                 | Rule                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                        | no                      | `production`                                                                                                                                                                                                                                                            |
| `WEB_ORIGIN`                                                                     | no                      | exactly one HTTPS origin, e.g. `https://app.example.com` (CORS and the Origin guard use it; no wildcard)                                                                                                                                                                |
| `TRUST_PROXY_HOPS`                                                               | no                      | **Required in production.** Number of trusted proxy hops in front of the API; determine it with section 7, do not guess                                                                                                                                                 |
| `LOG_LEVEL`                                                                      | no                      | `info`                                                                                                                                                                                                                                                                  |
| `DATABASE_URL`                                                                   | **yes**                 | `postgresql://nook_app:<password>@<db-private-host>:5432/nook?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/tmp/db-ca.pem` (runtime role only; the host is the database's private DNS name, **never an IP address**). The API refuses to start with any weaker URL |
| `DB_CA_PEM`                                                                      | no (public certificate) | PEM of the database's **root CA certificate** (public; with Railway's PostgreSQL template the self-signed `root-ca`, **not** the server (leaf) certificate); `scripts/ops/start-api.sh` writes it to the `sslrootcert` path                                             |
| `CORRECTION_RECEIPT_SECRET`                                                      | **yes**                 | at least 32 random characters, generated once. Without it the corrections endpoints answer `503`                                                                                                                                                                        |
| `CORRECTIONS_FINANCIAL_APPLY_ENABLED`, `BILLING_SCHEDULER_ENABLED`, `SENTRY_DSN` |                         | leave unset unless you intend to enable them                                                                                                                                                                                                                            |

The API never receives the superuser URL or the migrator URL. The migration job never receives the runtime URL.

Migration job variables: `MIGRATION_DB_HOST`, `MIGRATION_DB_PORT`, `MIGRATION_DB_NAME`, `MIGRATION_DB_USER` (the migrator
role; superuser names are refused), `MIGRATION_DB_PASSWORD` (secret), `DB_CA_PEM` (the root CA certificate PEM, as
above), `DB_CERT_SHA256` (SHA-256 fingerprint of the **leaf (server) certificate**, hex, with or without colons).

## 3. Database TLS

### 3.1 The certificate arrangement (Railway PostgreSQL template)

The template's server presents a chain of two public certificates:

- a **leaf** (the server certificate): subject `CN=localhost`, subject alternative names `localhost` and the service's
  private hostname (for example `postgres-17.railway.internal`), issued by
- a self-signed **root CA**: `CN=root-ca`.

The leaf is not self-signed, so it cannot be its own trust anchor. The two values Nook needs are therefore different
certificates:

| Variable         | Value                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `DB_CA_PEM`      | PEM of the **root CA** certificate (the last certificate the server presents)                        |
| `DB_CERT_SHA256` | SHA-256 fingerprint of the **leaf** (server) certificate (the first certificate the server presents) |

Do not store the leaf as `DB_CA_PEM`, and do not pin the root's fingerprint: both are refused.

Get both from the running server with `deploy-kit/tls_pins.sh`. It runs inside the database container, performs a
PostgreSQL STARTTLS handshake against `127.0.0.1`, and prints only public data: the chain, subject, issuer, validity and
names of each certificate, the leaf fingerprint, and the root CA PEM. It never opens a private key, and it refuses to
print results if the leaf does not verify against the CA. Record the validity end date. If the platform regenerates the
certificates (a new root and a new leaf), **both values change** and must be refreshed on every service that holds them.
Never read or print any private key file.

### 3.2 What is verified, and by what

- **Migration proxy** (`scripts/ops/migrate-with-tls-proxy.ts`, `scripts/ops/pg-tls-proxy.ts`). Two independent checks
  that must both pass: (1) the server's certificate chain verifies against `DB_CA_PEM` (so an expired, unrelated or
  wrong-CA certificate fails), and (2) the leaf's SHA-256 fingerprint equals `DB_CERT_SHA256`. The proxy listens on
  loopback only and never falls back to plaintext. If either check fails, the wrapper exits 3 and nothing is migrated.
  The hostname is not consulted: the pin identifies the exact server certificate.
- **API** (`DATABASE_URL`, `apps/api/src/config.ts`). Production accepts exactly two modes, with different
  hostname semantics:

  | Mode                                                             | Chain verified against `sslrootcert` | Hostname verified                        |
  | ---------------------------------------------------------------- | ------------------------------------ | ---------------------------------------- |
  | `sslmode=verify-ca` with `uselibpqcompat=true` and `sslrootcert` | yes                                  | **no** (libpq `verify-ca` semantics)     |
  | `sslmode=verify-full` with `sslrootcert`                         | yes                                  | **yes**, against the certificate's names |

  `verify-ca` proves the server holds a certificate issued by the pinned CA. `verify-full` additionally proves the name
  you connected to appears in the certificate. Because Railway's leaf includes the service's private hostname,
  `verify-full` is expected to work against that exact hostname, and it is the stricter choice. It was verified locally
  with a chain of the same shape (a DNS name in the certificate connects; any other DNS name, including another
  service's private hostname, is refused), and it must still be confirmed on the live service. `disable`, `allow`,
  `prefer`, `require`, `no-verify`, a missing `sslmode`, and repeated or `ssl`/`sslaccept` parameters are refused at startup.

- **Never use an IP address in `DATABASE_URL`** (or in `MIGRATION_DB_HOST`). The `pg` driver does not verify the
  hostname when the host is an IP address, so `verify-full` would silently become chain-only. Always use the private DNS name.

### 3.3 Rejecting connections that do not use TLS

The server rule is `hostnossl all all all reject`. `hostnossl` matches only TCP connections **without** TLS, so
Unix-socket (`local`) administration can never match it, wherever it sits. Position still matters for the TCP rules:

- it must come **before** the catch-all `host all all all scram-sha-256` rule, otherwise it never matches;
- it should come **after** the `local` rules and the loopback rules (`127.0.0.1`, `::1`), so loopback administration
  inside the container keeps working while every network client (the API, the migration job, anything on the private
  network) must use TLS;
- it must not be placed first. TLS connections still match the original `host` rule and still need a valid password.

Provisioning (local socket) and migrations (TLS through the pinned proxy) are not affected by the rule, so it can be
applied right after roles are provisioned and before the first migration, which proves migrations work with it active.

Apply it with `deploy-kit/require_tls.sh`, inside the database container:

- `sh require_tls.sh` saves the current file once as `pg_hba.conf.pre-nook-tls`, inserts the rule in the position above,
  reloads, then proves the change (the rule is active and ordered correctly, `pg_hba_file_rules` shows no errors, and
  the server reports a configuration load after the change). It is idempotent, refuses to start if
  `pg_hba_file_rules` already reports errors, and restores the saved file by itself if validation fails.
- `sh require_tls.sh --check` changes nothing and exits 0 only when the rule is active and correctly placed.
- `sh require_tls.sh --rollback` restores the saved file and reloads.

Verify it in two ways, because `pg_hba_file_rules` shows the file and a behavioural test shows what the server enforces:

1. **Rules.** `SELECT line_number, type, database, user_name, address, auth_method, error FROM pg_hba_file_rules ORDER BY
line_number;` must show `hostnossl | {all} | {all} | all | reject` with a null `error`, ahead of the catch-all `host`
   rule and after the loopback rules.
2. **Behaviour.** From a client on the private network (for example the migration or API service), a plaintext
   attempt (`PGSSLMODE=disable`) must fail with `no encryption`, while a verified TLS connection with the right password succeeds.

**Persistence.** `pg_hba.conf` lives in the data directory on the persistent volume. In a local rehearsal with a
persistent volume the rule and TLS settings survived a restart. That is **not verified on Railway**: the template's own
startup scripts could rewrite the file on a redeploy or image change. Repeat `sh require_tls.sh --check` and the plaintext
test after every restart, redeploy and image change, and treat a missing rule as a blocker before any real data is stored.

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
2. Provision roles (section 4), pin the root CA and the leaf fingerprint (section 3.1) and require TLS (section 3.3).
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

`deploy-kit/backup/` holds an image (PostgreSQL 17.11 client, `age`, AWS CLI) and `backup.sh`: logical dump as the read-only
role over verified TLS (`verify-ca` against the root CA in `DB_CA_PEM`), client-side `age` encryption (public keys only), upload to object storage with a SHA-256 manifest. A
backup is not verified until an encrypted copy exists off-platform **and** a restore from it succeeds
(`restore-acl-verification.sql` checks ownership and privileges of a restored copy against the CI matrix).

Status of the backup tooling (this is **not** a backup or restore readiness claim):

- The image is based on `postgres:17.11`, the same minor as the target server; any 17.x client works against a 17.x
  server (`pg_dump` cannot dump a newer major version, which is why the script requires server major 17).
- `backup.sh` was rehearsed locally against PostgreSQL 17.11 with stand-ins for `age` and `aws`: `verify-ca` with the root
  CA, the role and version checks, the checksum and manifest logic, and a restore of the dump into a scratch database
  (data, tables and immutability triggers intact).
- **Not verified:** the layered image build (it installs `age` and `awscli` from Debian 13, where both packages exist; the
  build could not be completed in the review environment because the container could not reach the package mirrors, so run
  `docker build` yourself and check the tools before relying on it), real `age` encryption, the S3 upload, and a restore
  of a real encrypted backup from off-platform storage. Do not store real data until a real backup and restore succeed.

## 7. Determining `TRUST_PROXY_HOPS`

On the live platform hostname, make one failed sign-in from each of two different networks, then count address-scope rows
in `login_throttles` updated in the last five minutes (expect 2). Repeat with a forged `X-Forwarded-For` header; the count
must stay 2. See `docs/ops/WEB_API_TOPOLOGY.md` §6.4. Until verified, any value is an expectation, not a measurement.
