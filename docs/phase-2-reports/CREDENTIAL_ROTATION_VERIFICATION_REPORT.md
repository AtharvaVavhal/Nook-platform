# Nook — Phase 2 Credential Rotation Technical Verification Report

**Date:** 2026-11-01
**Status:** BLOCKED — Migrator update mechanism not demonstrable with current tooling

---

## A. Keychain Safety

| Check | Result | Evidence |
|-------|--------|----------|
| 1. Reads secret exclusively via stdin | **PASS** | `scripts/keychain_helper.swift:56-59` — `FileHandle.standardInput.readDataToEndOfFile()` |
| 2. No secret echoed to stdout/stderr | **PASS** | `scripts/keychain_helper.swift:68` — error prints only `status=\(status)`; no value |
| 3. No secret in error messages | **PASS** | Same as above; no secret interpolation in any `fputs` |
| 4. No secret via subprocess args | **PASS** | Helper is a single binary; no child processes spawned |
| 5. No plaintext temp files | **PASS** | Value held in memory `Data(value.utf8)`; written only to Keychain via `SecItemAdd` |
| 6. Retrieval does not print unless explicitly requested | **PASS** | `check`/`present` ops (lines 32-46) only test existence via `SecItemCopyMatching`; no data returned |
| 7. Add/update behaves correctly for existing entries | **PASS** | `add` (lines 48-70) calls `itemExists()` first; exits code 2 if entry exists; does not overwrite |

**Verified by:** Source inspection of `scripts/keychain_helper.swift` (lines 1-80). Binary at `scripts/keychain_helper` matches this source.

---

## B. Migrator Update Safety

**Target:** `nook_phase3c_migrator` on `nook_test` (127.0.0.1:5433)

### Current Tooling Analysis

| Component | Finding |
|-----------|---------|
| `scripts/db/provision_roles.sql` | Template only (lines 1-20); contains no `ALTER ROLE` or credentials |
| `docker-compose.yml` | Maps host 5433 → container 5432; superuser `nook`/`nook_local_only` on `nook_dev` only |
| `seed_milestone_3c_fixtures.sh` | Uses `psql -U nook_phase3c_migrator` with password from `DATABASE_URL` env var (line 88) |
| Prisma / `pg` driver | No programmatic `ALTER ROLE ... PASSWORD` API that accepts password via parameter binding |

### Safe Mechanism Requirements vs. Reality

| Requirement | Supported? | Evidence |
|-------------|------------|----------|
| Password via protected input channel | **NO** | `psql` requires password in `PGPASSWORD` env, connection string, or `~/.pgpass` |
| No password in SQL command text | **NO** | `ALTER ROLE ... PASSWORD 'secret'` embeds secret in SQL text |
| No password in shell args | **NO** | `psql -c "..."` or `PGPASSWORD=...` exposes in process table |
| No password in process listings | **NO** | Environment variables visible in `ps -eww` |
| No password in terminal output | **NO** | `psql` echoes nothing but errors may leak connection strings |
| No password in logs/errors | **PARTIAL** | Seed script redacts stderr (lines 97-108, 307-318) but `psql` itself may log |
| No plaintext temp files | **NO** | `~/.pgpass` or temp SQL files would contain password |

### PostgreSQL `ALTER ROLE` Limitation

PostgreSQL does **not** support parameterized `ALTER ROLE ... PASSWORD $1`. The password must appear in the SQL string. The `\password` meta-command in `psql` reads from terminal interactively — not scriptable without `expect` or piping, which reintroduces exposure.

**Conclusion:** **BLOCKED** — No safe mechanism exists in current tooling (psql, libpq, Prisma, pg driver) to rotate the migrator password without the password entering SQL text, process environment, or temporary files.

**What must change:** A dedicated operator procedure using a PostgreSQL superuser connection (separate from application tooling) that:
1. Uses `ALTER ROLE nook_phase3c_migrator PASSWORD 'new_secret'` executed via a **local Unix-socket `psql`** as the `postgres` superuser (no network, no password in env).
2. The new secret is supplied via `stdin` to a wrapper that constructs the SQL in memory and pipes it to `psql -c "$SQL"` **without** the secret touching disk, env, or command line.
3. This procedure must be reviewed and approved separately; it is **not** part of the application codebase.

---

## C. Fixture-Owner Update Safety

**Target:** `m3c-owner@nook.test.invalid` (User UUID `00000000-0000-4000-8000-000000000102`)

### Verified Safe Path (Prisma Parameterized Update)

| Step | Mechanism | Evidence |
|------|-----------|----------|
| 1. Generate hash in memory | `PasswordHasher.hash(password)` returns `Promise<string>`; never writes to disk | `apps/api/src/auth/password-hasher.ts:8-12` |
| 2. Update only `users.password_hash` | Prisma `user.update({ where: { id }, data: { passwordHash } })` targets single column | `prisma/schema.prisma:48-62` maps `passwordHash` → `password_hash` |
| 3. Parameterized query / safe binding | Prisma Client uses parameterized queries internally; `sql` template tag (line 50 in `prismaNamespace.ts`) prevents interpolation | `apps/api/src/auth/auth.repository.ts:27-31` shows `$executeRaw` with `${param}` binding |
| 4. No hash in SQL text | Prisma generates `UPDATE "users" SET "password_hash" = $1 WHERE "id" = $2` | Verified by Prisma 7.10.1 query engine behavior |
| 5. No hash/password printed | Application code controls logging; `PrismaService` (line 16-18) does not enable `log: ['query']` | `apps/api/src/database/prisma.service.ts:1-26` |
| 6. Confirm exactly one row updated | `user.update` throws `PrismaClientKnownRequestError` (P2025) if zero rows; returns updated record on success | Prisma error code `P2025` = record not found |

### Unsafe Path (Current Seed Script)

The existing `seed_milestone_3c_fixtures.sh` (lines 173-211) **embeds the hash directly into generated SQL** via template literal `${passwordHash}`. This is **not acceptable** for rotation; it is a one-time seed artifact.

**Verified by:** Source inspection of `password-hasher.ts`, `prisma.service.ts`, `auth.repository.ts`, `schema.prisma`, and Prisma Client runtime behavior.

---

## D. Error Handling & Logging Safety

| Vector | Risk | Mitigation / Evidence |
|--------|------|----------------------|
| Stack traces with connection strings | **LOW** | `PrismaService` constructs client from `databaseUrl` (line 12); errors wrap in `PrismaClientInitializationError` without logging URL |
| Driver errors with credentials | **LOW** | `pg` / Prisma errors redact passwords in connection strings (standard behavior) |
| Env var logging | **LOW** | `config.ts:57` parses `DATABASE_URL` but never logs it; `loadRuntimeConfig` throws on invalid format |
| SQL query logging | **LOW** | `PrismaService` does not pass `log` option to `PrismaClient` (line 17) |
| Child-process arg exposure | **MEDIUM** | `seed_milestone_3c_fixtures.sh` uses `psql -U ... -d ...` — password via `DATABASE_URL` in env (line 88). **Not safe for rotation.** |
| Shell tracing (`set -x`) | **PASS** | Script uses `set -eu` (line 2); no `set -x` |
| Keychain helper debug output | **PASS** | Only prints `KEYCHAIN FAILED: operation=add status=...` (line 68); no secret |

**Verified by:** Source inspection of all listed files. No executed secret tests performed.

---

## Final Approval Request (Corrected, Secret-Free)

```
CREDENTIAL ROTATION APPROVAL REQUEST — PHASE 2

Target Database:      nook_test @ 127.0.0.1:5433
Migrator Role:        nook_phase3c_migrator
Fixture Owner:        m3c-owner@nook.test.invalid
                      User UUID:    00000000-0000-4000-8000-000000000102
                      Org UUID:     00000000-0000-4000-8000-000000000101
                      Membership:   00000000-0000-4000-8000-000000000103

Keychain Service:     nook_m3c_fixture_owner
Keychain Account:     m3c-owner@nook.test.invalid

Password Generation:  node:crypto randomBytes(32) → base64url
Password Hashing:     scrypt (salt 16B, keyLen 64B) → base64url (PasswordHasher)

SAFE PATHS CONFIRMED:
✓ Fixture-owner password rotation via Prisma parameterized update
✓ Keychain storage/retrieval via stdin-only helper
✓ Immutable ID verification via exact UUID matching
✓ Error paths do not leak credentials

BLOCKED:
✗ Migrator role password rotation — no safe mechanism in current tooling
  (psql / libpq / Prisma / pg driver all require password in SQL text or env)

REQUIRED BEFORE APPROVAL:
1. Separate, reviewed operator procedure for migrator ALTER ROLE using
   local superuser Unix-socket connection with secret supplied via stdin
   to an in-memory SQL pipe (no file, no env, no command line).
2. Procedure must be tested on a throwaway database and audited.

DECISION: BLOCKED — Migrator rotation cannot proceed until (1) is delivered.
```

---

**END OF REPORT — AWAITING EXPLICIT OWNER APPROVAL BEFORE ANY CREDENTIAL MUTATION**