# Phase 2 — Security Review

**Status:** Review of the repository **as it is today** plus proposed security design for Phase 2. Nothing proposed here is approved (`G-01`). Findings in the first part were observed by running commands on **2026-10-29**.
**Companions:** [Implementation plan](PHASE_2_IMPLEMENTATION_PLAN.md) · [Data model](PHASE_2_DATA_MODEL.md) · [Tenant isolation](PHASE_2_TENANT_ISOLATION.md) · [API contract](PHASE_2_API_CONTRACT.md) · [Unresolved decisions](PHASE_2_UNRESOLVED_DECISIONS.md)

Identifiers `G-xx`, `U-xx`, `K-x` are defined in [the register](PHASE_2_UNRESOLVED_DECISIONS.md).

## Confirmed existing decisions

| Decision                                                                                                                                                            | Source                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Security objectives: no cross-organisation access, least privilege for staff, preserved financial history, protected secrets and documents, detection and response. | `05_SECURITY_ARCHITECTURE.md` §1 (proposed baseline) |
| Authorisation is **server-side on every request**. UI hiding is not a control.                                                                                      | `05_…` §4                                            |
| Passwords are never stored reversibly. Recovery never uses security questions. Login and recovery are rate-limited and enumeration-safe.                            | `05_…` §3 (proposed)                                 |
| Real secrets never enter the repository or client bundle. `.env` files are ignored; `.env.example` has placeholders only.                                           | `.gitignore`, `.env.example`, `M0-T02`               |
| Real resident data, real credentials and production deployment are out of scope for this phase.                                                                     | Brief; `docs/MILESTONE_0_SCOPE.md`                   |
| The Multer advisory GHSA-q7qp-rjg7-q26m was fixed by aligning NestJS to 12.3.2 (commit `b2a9f0c`).                                                                  | `git log`                                            |
| Security-sensitive recovery evidence, RPO and RTO remain **OPEN** and are release gates, not Phase 2 deliverables.                                                  | ADR-016, `K-10`                                      |

## Part 1 — Current dependency and repository status (verified 2026-10-29)

Every row below comes from a command run during this task.

### Dependency tree and audit

| Check                                         | Result                                                                                                                                                                   | Command                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Installed `multer`                            | **2.5.0**                                                                                                                                                                | `node -p require(...).version`   |
| Lockfile `node_modules/multer`                | **2.5.0**, resolved from the npm registry                                                                                                                                | `grep` on `package-lock.json`    |
| Dependency path                               | `@nook/api → @nestjs/platform-express@12.3.2 → multer@2.5.0`                                                                                                             | `npm ls multer`                  |
| Live audit, all dependencies                  | **found 0 vulnerabilities**, exit 0                                                                                                                                      | `npm audit`                      |
| Live audit, production only                   | **found 0 vulnerabilities**, exit 0                                                                                                                                      | `npm audit --omit=dev`           |
| Registry signatures                           | **387** packages with verified registry signatures                                                                                                                       | `npm audit signatures`           |
| Provenance attestations                       | **92** packages with verified attestations                                                                                                                               | `npm audit signatures`           |
| Registry reachable                            | **Yes** on 2026-10-28 and 2026-10-29. The Milestone 0 report recorded the registry as unreachable, so that blocker is **not currently reproducing**.                     | `npm view`, `npm audit`          |
| Versions                                      | `@nestjs/*` 12.3.2 · `prisma` 7.10.1 · `@prisma/client` 7.10.1 · `pg` 8.16.3 · `helmet` 8.1.0 · TypeScript 5.9.3 · React 19.3.1 · Vite 8.3.5 · Node 24.22.1 · npm 11.6.2 | `node -p` on installed manifests |
| Lockfile and manifests unchanged by this task | `git status` shows no modified tracked file; only new untracked documentation                                                                                            | `git status --short`             |

No `npm audit fix`, `--force`, manual lockfile edit or audit suppression was used, and none is proposed. The earlier result ("0 vulnerabilities") **was re-verified today, not assumed**, and still holds.

**What this does and does not establish.** It establishes that the npm advisory database, queried on 2026-10-29, lists no known vulnerability for the installed tree. It does **not** establish that the code is secure, that no unreported vulnerability exists, or anything about PostgreSQL, the API's behaviour under attack, or production configuration.

### Observed findings

| ID   | Severity      | Finding                                                                                                                                                                                                                                                                                                                                                                                      | Recommendation                                                                                                                                                                                                                                  |
| ---- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | Medium        | **The Prisma CLI's `latest` dist-tag points to a release candidate**, `8.0.0-rc.28`, published 2026-10-27. The pinned `7.10.1` is tagged `prev`. `@prisma/client`'s `latest` is `7.10.1`. An unpinned `npx prisma` or an upgrade by habit could pull a pre-release CLI that does not match the client.                                                                                       | Always run the **installed, pinned** CLI. Never run `npx prisma@latest`. Re-check tags before any Prisma upgrade. Do not upgrade as part of Phase 2.                                                                                            |
| S-02 | Medium        | **`verify:m0-scope` will fail by design** when the first model lands, and CI runs it. Removing the guard would remove the control that currently blocks unapproved resident, booking and finance models.                                                                                                                                                                                     | `U-27`: replace with an approved Phase 2 guard that allow-lists exact tables, in the same change as the first migration.                                                                                                                        |
| S-03 | Medium        | **Unrelated PostgreSQL 16 server listening on `127.0.0.1:5432` and `[::1]:5432`** (Homebrew, PID 885, running about 4 days, owned by the developer). It is not the project's database. The Docker daemon is **not running**, so the project's `postgres:17-alpine` is not up, and `docker-compose.yml` publishes host port `5432`, which would **collide** with it. I did not connect to it. | `U-20`. Do **not** point migrations or seeds at it without consent: `migrate dev` can reset a database. Add a tooling guard that refuses non-local hosts and unexpected database names. Prefer a dedicated disposable instance on another port. |
| S-04 | Medium        | **Disk at 99%** (about 2.1 GiB free). Installing images, building or generating clients can fail halfway and leave partial state.                                                                                                                                                                                                                                                            | Check `df` before every install, image pull or build. Do not clear caches indiscriminately. Preserve `~/.npm/_npx` entries used for browser QA.                                                                                                 |
| S-05 | Low           | **No Prisma client is generated** in this checkout and **no driver adapter is installed**. `schema.prisma` uses `prisma-client-js`, while the installed 7.10.1 CLI's own templates use `prisma-client`. Behaviour of the older generator with Prisma 7 is not verified.                                                                                                                      | `U-26`, `U-22`: resolve with a disposable spike before the schema is written.                                                                                                                                                                   |
| S-06 | Low           | **The secret scanner is a baseline only.** It looks for four patterns (AWS key IDs, GitHub tokens, Stripe live keys, PEM private-key headers) and says so itself. It would not detect, for example, a database URL with a real password, or a session secret.                                                                                                                                | Add a dedicated scanner to CI before any shared environment exists. Keep the "baseline only" wording.                                                                                                                                           |
| S-07 | Low           | **CI has never been shown to run.** `.github/workflows/ci.yml` exists (format, lint, typecheck, tests, build, Prisma validate, scope guard, secret scan, `npm audit --audit-level=high`) but no hosted run has been verified (`G-02`). Repo-wide lint and format currently fail on **untracked** `marketing/` files; they would fail CI if those files were committed.                       | Verify a CI run on a clean clone. Decide what happens to `marketing/` before it enters the repository.                                                                                                                                          |
| S-08 | Low           | **`/api/v1/health/database` is unauthenticated** and distinguishes `ok` from `degraded`. It exposes no secret, but it does reveal database availability to anyone.                                                                                                                                                                                                                           | Acceptable for local development. Decide before any shared environment whether to restrict it to the monitor or to an internal network.                                                                                                         |
| S-09 | Informational | **CORS is already configured with `credentials: true`** and a single allowed origin (good), and `helmet` is applied. Neither is tested against cookies because no cookie exists yet.                                                                                                                                                                                                         | Add tests for origin handling and cookie attributes when sessions are built.                                                                                                                                                                    |
| S-10 | Informational | **The root `overrides.multer` entry is now redundant** but harmless.                                                                                                                                                                                                                                                                                                                         | Leave it unless the owner decides otherwise.                                                                                                                                                                                                    |
| S-11 | Informational | **Handbook and marketing material sit untracked** in `docs/` and `marketing/`, including a 6.8 MB `.zip` and a duplicate set of PDFs.                                                                                                                                                                                                                                                        | Decide separately whether they belong in this repository. Phase 2 neither stages nor deletes them.                                                                                                                                              |

### Unverified, treat as unknown

- **PostgreSQL runtime for this project** (no instance started, no connection made).
- **Hosted CI** (never run).
- **Any behaviour of the API under authentication**, because none exists.
- **Production security**, hosting, TLS, secrets management, monitoring and backup (all `U-21`, `OPEN`).

## Part 2 — Proposed security design for Phase 2

### Threat model for the Phase 2 surface

Assets introduced in Phase 2: staff credentials and sessions, organisation and membership records, inventory structure, audit events. **No resident, financial or document data.**

| Threat                                          | Example                                                      | Primary control                                                                                       | Backup control                                     | Test                      |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------- |
| Cross-tenant read or write                      | Staff of B calls A's room ID                                 | Scoped repositories + tenant context                                                                  | Composite FKs, schema lint, optional RLS (`U-08`)  | `XT-01…XT-35`             |
| Privilege escalation                            | A front-desk user changes their own role                     | Permission identifiers; "cannot grant what you do not hold"; role enum only                           | Audit of every grant                               | `XT-19`, `XT-29`, `XT-35` |
| Credential stuffing, brute force                | Repeated `POST /auth/login`                                  | Rate limits (`U-06`), generic failure, adaptive hashing (`U-03`)                                      | Alerting on repeated failures                      | Auth tests                |
| Session theft or fixation                       | Stolen cookie, pre-login session ID                          | Opaque random token, hash stored, rotation on login, switch and privilege change, `HttpOnly`/`Secure` | Idle and absolute expiry (`U-02`), revocation      | Session tests             |
| CSRF                                            | A third-party page triggers `PATCH` with the victim's cookie | CSRF token **and** `Origin` check on every state-changing request                                     | `SameSite` cookie policy                           | `A-3`                     |
| Account enumeration                             | Different error for unknown user                             | One generic failure and constant-ish timing                                                           | Rate limit                                         | Auth tests                |
| Mass assignment                                 | Posting `organizationId`, `role`, `id`                       | Reject unknown fields; DTO → explicit domain operation                                                | Composite FKs                                      | `XT-06`, `XT-34`          |
| Injection                                       | SQL or operator injection through search                     | ORM parameterisation; no raw SQL in handlers; reviewed raw SQL in migrations only                     | Least-privilege DB role                            | Search tests              |
| Insecure direct object reference                | Guessing UUIDs                                               | **Scoping**, never ID secrecy                                                                         | Non-sequential IDs (not a control)                 | `XT-01`…`XT-04`           |
| Audit tampering                                 | Deleting evidence of a role change                           | Application role has `INSERT`/`SELECT` only; trigger rejects `UPDATE`/`DELETE`                        | Export and protect logs (later)                    | `XT-23`                   |
| Secret leakage                                  | `.env` committed, secret in logs                             | `.gitignore`, secret scan, log redaction                                                              | Rotation procedure (later)                         | Scan, redaction tests     |
| Dependency compromise                           | Malicious or vulnerable package                              | Locked dependencies, `npm ci`, audit in CI, signature checks, minimal new packages (`U-22`)           | Review each new dependency                         | CI                        |
| Disabled or revoked principal keeps access      | Revoked staff with a live session                            | Revoke sessions in the **same transaction** as the revocation                                         | Context rebuilt from the database on every request | `XT-16`, `XT-30`          |
| Destructive local tooling on the wrong database | `migrate dev` against the unrelated PG 16                    | Tooling guard on host and database name; no default credentials for it                                | Never run without consent                          | Guard test                |

### Authentication and session lifecycle (proposed, `U-01` unresolved)

The package proposes (ADR-004, ADR-005) and this plan carries forward, for the owner to approve or amend:

- **Session mechanism.** Server-side, revocable, opaque sessions. The cookie carries a random token with at least 256 bits of entropy; the database stores only its **hash**. A JWT is not proposed (see `U-01`); if the owner prefers one, the isolation design in [the isolation document](PHASE_2_TENANT_ISOLATION.md#why-jwt-alone-does-not-give-tenant-isolation) still applies unchanged.
- **Cookie attributes.** `HttpOnly`; `Secure` in every deployed environment; `SameSite` as strict as the flows allow (`U-02`); narrow `Path`. In deployed environments the `__Host-` name prefix (which requires `Secure`, `Path=/` and no `Domain`) is a good fit and is proposed. **Hosting is undecided**, so the proposal must be re-checked if the web app and API end up on different registrable domains, where `SameSite` cookies stop working and a proxy would be needed.
- **Rotation and invalidation.** Rotate on login, on organisation switch and after any privilege change. Invalidate on logout, disablement, membership revocation, role change and password reset.
- **Expiry.** Idle and absolute expiry are **required configuration with no default**; start-up fails in non-local environments if absent (`U-02`).
- **Passwords.** Adaptive hashing, never reversible. The algorithm is `U-03`: argon2id adds a native dependency; `scrypt` in `node:crypto` adds none. Parameters are checked against current guidance at scaffold time and are not invented in code. Password policy is open.
- **Accounts.** Owner-provisioned only; no public sign-up (ADR-005). Bootstrap is a controlled, audited procedure (`U-09`) behind the same environment guard as the seed, never a standing backdoor, and no "first login becomes admin" behaviour.
- **Recovery.** `POST /auth/recovery` stays **blocked** with `RULE_NOT_CONFIGURED` until `BR-SEC-006` is answered (`U-04`). Owner-assisted reset with an audit event is the proposed interim. Tokens, if ever used: single-use, short-lived, hash stored.
- **MFA.** Required for owners is proposed for **shared** environments, and required for any future platform operator (`U-05`).
- **Rate limits.** On login, recovery, audit search and writes. Thresholds are `U-06`; the throttling dependency is `U-22`.

### Authorisation (proposed)

- **Permission identifiers only**, from the canonical vocabulary (`05_…` §4.1). Phase 2 uses `inventory.read`, `inventory.write`, `property.manage`, `member.manage`, `audit.read` and `settings.manage`.
- **Deny by default.** Every route declares `@Public()` or `@RequirePermission(...)`, or the application refuses to start.
- **No self-elevation.** An actor cannot grant a permission they do not hold and cannot change their own role.
- **The three deliberate separations stay intact**, even though Phase 2 exercises none of them: `payment.record` ≠ `payment.confirm`, `resident.read` ≠ `document.read`, `finance.read` ≠ `data.export`. The Phase 2 permission table must not contain a shortcut that merges them.
- **Property scope** for roles marked Scoped, if the owner approves grants (`U-07`).
- The role→permission **assignment** is the owner's decision (`BR-SEC-001…003`). This plan does not write it.

### Secrets and configuration

- **Environment variables only**, validated at start-up with a clear, non-secret failure. The existing `config.ts` already does this for `APP_ENV`, `PORT`, `WEB_ORIGIN` and `DATABASE_URL` and avoids echoing values.
- **New required values** in Phase 2 (names indicative): session idle and absolute expiry (`U-02`), cookie settings, CSRF settings, database role credentials for migrator and application roles. None has a default in code.
- `.env.example` stays **placeholders only**. The existing local-only database credentials in `.env.example` and `docker-compose.yml` are allowed by the scanner and must never be reused anywhere shared.
- Seed passwords are generated at seed time and never committed.
- No secret in the client bundle: the web app receives no server configuration beyond its own public values.
- A dedicated secret scanner replaces the baseline one before a shared environment (S-06).

### Database security

- **Three roles** proposed: migrator (DDL only, used by the migration job), application (DML only, no DDL, no `BYPASSRLS`, **no** `UPDATE`/`DELETE` on `audit_events`), read-only diagnostics.
- The application never connects as the database owner or a superuser.
- Connection strings are never logged; the existing `DatabaseService` already swallows connection errors rather than exposing them.
- Local-only credentials stay local. TLS and network policy for deployed databases are `U-21`.

### Logging and audit

- Structured logs with the request ID. **Redact** request bodies on auth endpoints and never log passwords, tokens, session identifiers or cookie values.
- Audit events as described in [the data model](PHASE_2_DATA_MODEL.md#audit-events), including security-sensitive administrative changes: membership and role changes, organisation context switches, session revocation, provisioning, property creation and archival, and bed operational-status changes (`U-18`).
- Audit access is itself permissioned (`audit.read`) and, once implemented, itself audited.
- Retention, location and whether CERT-In directions apply need **professional confirmation** (`05_…` §12). This plan does not assert a legal duty.

### API hardening

CORS to the single real origin (already so); `helmet` (already so); `Content-Type` enforcement; unknown-field rejection; bounded pagination and payloads; no stack traces; per-route rate limits; CSRF on state changes; deny-by-default; no endpoint that mutates without an audit event where one is defined.

### Dependencies for Phase 2

Each is **PROPOSED and needs approval** (`U-22`). None is installed. Re-run `npm audit` and `npm audit signatures` after any install, and verify the exact version from the registry at install time.

| Need                                 | Candidate                                                              | Note                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma driver adapter for PostgreSQL | `@prisma/adapter-pg@7.10.1`                                            | Exists in the registry and depends on `pg ^8.16.3` (installed `8.16.3`). **VALIDATE** it is required and sufficient for Prisma 7.10.1. |
| Request validation                   | A schema or DTO library                                                | Nest has none built in. Choose one; keep it small.                                                                                     |
| Rate limiting                        | A Nest-compatible throttler                                            | Needed for `U-06`.                                                                                                                     |
| Cookies and CSRF                     | A cookie parser, and either an in-repo token check or a vetted library | Do not hand-roll cryptography. A small CSRF token check is acceptable in-repo if reviewed.                                             |
| Password hashing                     | Per `U-03`                                                             | Not decided.                                                                                                                           |
| Testing                              | `@nestjs/testing` and an HTTP test client                              | The existing runner is Node's built-in test runner with `tsx`.                                                                         |

No dependency upgrade is proposed. Existing pins (`NestJS 12.3.2`, `Prisma 7.10.1`) stay unless the owner decides otherwise.

### What this review does not claim

It does not claim the API is secure, that tenant isolation holds, that PostgreSQL works for this project, that hosted CI passes, that production is safe, or that any compliance obligation is met. The compliance questions in `05_…` §12 (DPDP Act and Rules, CERT-In, Maharashtra requirements and others) need qualified advice. This plan states no commencement date, threshold or legal conclusion.

## Unresolved decisions

`G-01` · `G-02` · `G-06` · `U-01`…`U-06` · `U-07` · `U-08` · `U-09` · `U-18` · `U-20` · `U-21` · `U-22` · `U-26` · `U-27`. See [the register](PHASE_2_UNRESOLVED_DECISIONS.md).

## Validation still required

| #    | Claim                                                                                               | Evidence needed                                                               |
| ---- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| SR-1 | Installed tree stays free of known vulnerabilities after any Phase 2 dependency is added            | Fresh `npm audit` and `npm audit signatures` after each install               |
| SR-2 | A real PostgreSQL instance dedicated to this project starts and passes health and constraint checks | `U-20` spike (**not run**)                                                    |
| SR-3 | Cookie attributes, CSRF and CORS behave as specified under the real client origin                   | Integration tests with a browser-like client                                  |
| SR-4 | Rate limits and enumeration-safe responses work                                                     | Auth tests                                                                    |
| SR-5 | Log redaction actually removes secrets                                                              | Test that logs a request with a password and a cookie and inspects the output |
| SR-6 | Application DB role cannot alter or delete audit rows and cannot run DDL                            | Integration test as that role (`XT-23`)                                       |
| SR-7 | A dedicated secret scanner passes on a clean clone and on CI                                        | After it is added                                                             |
| SR-8 | Hosted CI runs every check on a clean clone                                                         | First verified run (`G-02`)                                                   |
| SR-9 | Hosting, TLS, secrets management, monitoring and backup restore evidence                            | Not Phase 2. Required before a pilot; `ADR-016`, `RG-4`                       |

## Revision history

| Version | Date       | Change                                                                                   |
| ------- | ---------- | ---------------------------------------------------------------------------------------- |
| 0.1     | 2026-10-29 | Initial review. Fresh audit run; 0 vulnerabilities; eleven repository findings recorded. |
