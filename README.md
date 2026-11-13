<div align="center">

<picture>
  <source srcset="docs/assets/readme-hero.svg" type="image/svg+xml">
  <img src="docs/assets/readme-hero.png" alt="nook — bed-level inventory across a building's floors. A product of Forge." width="100%">
</picture>

<br>

[![CI](https://github.com/AtharvaVavhal/Nook-platform/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/AtharvaVavhal/Nook-platform/actions/workflows/ci.yml)
![Milestone 0](https://img.shields.io/badge/Milestone%200-not%20accepted-B42318?style=flat-square&labelColor=171338)
![Phase 3](https://img.shields.io/badge/Phase%203-merged-7657F6?style=flat-square&labelColor=171338)
![Phase 4](https://img.shields.io/badge/Phase%204-merged%2C%20restricted%20features%20off-B54708?style=flat-square&labelColor=171338)
![Audit](https://img.shields.io/badge/npm%20audit-0%20vulnerabilities-157B55?style=flat-square&labelColor=171338)
![Node](https://img.shields.io/badge/Node-24.22.1-7657F6?style=flat-square&labelColor=171338)
![NestJS](https://img.shields.io/badge/NestJS-12.3.2-7657F6?style=flat-square&labelColor=171338)
![React](https://img.shields.io/badge/React-19.3.1-7657F6?style=flat-square&labelColor=171338)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-7657F6?style=flat-square&labelColor=171338)
![Prisma](https://img.shields.io/badge/Prisma-7.10.1-7657F6?style=flat-square&labelColor=171338)
[![Licence](https://img.shields.io/badge/licence-proprietary-625E78?style=flat-square&labelColor=171338)](LICENSE)

# nook

**The hostel and PG management platform.**
Bed-level inventory, immutable financial records, one tenant boundary.

[Overview](#overview) · [Status](#project-status) · [Getting started](#getting-started) · [Development](#development) · [Architecture](#architecture) · [Security](#security-and-data-integrity) · [Documentation](#documentation)

</div>

---

> ### Pre-release build. Not a launched product.
>
> `main` contains the authentication and inventory foundation, the core operating workflows and the
> Phase 4 lifecycle features, plus an owner and property-manager web application. **Nothing is deployed
> to production.** The restricted Phase 4 operations are disabled by default in code.
>
> **Milestone 0 is not accepted** and Nook is **not launch-ready**. Launch readiness has not been
> independently verified: see [`NOOK_LAUNCH_ROADMAP.md`](NOOK_LAUNCH_ROADMAP.md) and
> [`NOOK_BLOCKER_REGISTER.md`](NOOK_BLOCKER_REGISTER.md). Nothing in this README records an approval, a
> signature or a test result that has not occurred.

## Overview

A hostel or PG operator knows two things badly: **who is in which bed**, and **who owes what**. Nook is
being built to answer both without a spreadsheet: bed-level inventory on an interactive floor plan, and a
financial record that can be audited rather than argued over.

Three commitments shape the codebase:

| Principle                 | What it means                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The bed is the unit**   | Availability, allocation and occupancy are computed per bed, never per room. Allocation is atomic: the bed is locked and re-checked inside the transaction, so two staff cannot double-book it.                                            |
| **Money is never edited** | Payments, reversals, adjustments and voids are append-only records, enforced by database triggers and by the application role's privileges (no `DELETE` anywhere). A correction is a new record. Amounts are exact decimals, never floats. |
| **No rule is guessed**    | Where a business rule or a restricted operation is not approved, it stays disabled in code and the operation is refused. Transfer execution, assignment adoption and financial correction apply are off until the owner approves them.     |

## Project status

| Area                   | State                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1: property view | Accepted with documented limitations (2026-10-28); frontend-only demonstration                                                               |
| Phases 2 and 3         | Merged into `main` (pull request #1, 2026-11-07)                                                                                             |
| Phase 4                | Merged into `main` (pull request #2, 2026-11-13); transfer execution, assignment adoption and financial correction apply remain **disabled** |
| Hosted CI              | `quality` and `full-integration` passed on the merge commit                                                                                  |
| Milestone 0            | **Not accepted**; approval is not verification and the remaining evidence has not been produced                                              |
| Production             | **Not deployed**; no production backup or restore drill has been performed                                                                   |

Known gaps, as recorded in the roadmap, blocker register and release documents:

- Backup and restore readiness is not established
- Hosting topology is only partly decided and has not been verified on live infrastructure
- The invoice scheduler is implemented but not deployed, scheduled or enabled
- Browser end-to-end tests run locally, not in hosted CI
- General API rate limiting and explicit CSP/HSTS headers are unconfigured and unverified
- Safari, Firefox, real touch devices, screen readers and a measured contrast audit have not been done

## Features

| Area                      | What is built                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth and account security | Login, sessions, CSRF protection, login throttling, password change, auth audit events; `OWNER` and `PROPERTY_MANAGER` roles behind a default-deny permission layer |
| Inventory                 | Properties, floors, rooms and beds; interactive floor plan                                                                                                          |
| Residents                 | Records with tenant isolation; resident profile and stay summary                                                                                                    |
| Enquiries                 | Lead management, follow-ups, archive, conversion to a resident                                                                                                      |
| Bookings                  | Reservations with bed availability and concurrency safety; extensions with a reason and an audit event                                                              |
| Admissions                | Bed allocation inside a re-checked transaction                                                                                                                      |
| Check-in / check-out      | Lifecycle management with concurrency safety and overstay detection                                                                                                 |
| Finance                   | Invoices, payments with idempotency keys, reversals, adjustments, voids, receipts, outstanding dues, monthly reports                                                |
| Corrections (Phase 4)     | Request, review and audit workflow; non-financial corrections apply; **financial application is gated off**                                                         |
| Transfers (Phase 4)       | Preview, history and finance-review records; **execution is disabled**                                                                                              |
| Web application           | Owner and property-manager shell: operations, finance, resident profile, settings                                                                                   |
| Operations tooling        | CLI to provision users and reset passwords; restore-drill script; runbooks                                                                                          |
| Invoice scheduler         | Implemented and tested on a scratch database; **not deployed or enabled**                                                                                           |
| Observability             | Structured JSON logs and request ids; Sentry reporter implemented, off until configured                                                                             |

The schema has 33 models across 24 migrations. **Out of scope until the owner approves it:** payment
gateway, OTP, SMS/WhatsApp, KYC and document upload, and any resident-facing login or portal.

## Architecture

```
 Browser ──▶ Web (React + Vite) ──▶ API (NestJS, /api/v1) ──▶ PostgreSQL 17
              static build           sessions, CSRF, RBAC      tenant-scoped tables,
                                     modular monolith          triggers, privileges
```

One deployable modular monolith. Modules own their data and talk through service interfaces: the core
workflows need atomic transactions across related records, which matters far more than independent
deployability for a small team.

| Layer           | Choice              | Version            |
| --------------- | ------------------- | ------------------ |
| Runtime         | Node.js             | `24.22.1`          |
| Package manager | npm (workspaces)    | `11.6.2`           |
| API             | NestJS + TypeScript | `12.3.2` / `5.9.3` |
| Web             | React + Vite        | `19.3.1` / `8.3.5` |
| Database        | PostgreSQL          | `17`               |
| ORM             | Prisma              | `7.10.1`           |

**Planned hosting** (documented, not deployed): the web app on Vercel and the API plus PostgreSQL on
Railway, on custom domains under one registrable domain so the host-only `SameSite=Strict` session
cookies work. See [`docs/ops/WEB_API_TOPOLOGY.md`](docs/ops/WEB_API_TOPOLOGY.md).

## Getting started

### Prerequisites

Node.js `24.22.1` (see `.nvmrc`), npm `11.6.2`, Docker (for the local database) and Python 3 (for the
repository guard scripts).

### Run locally

```bash
# 1. toolchain
node --version        # must be 24.22.1
npm  --version        # must be 11.6.2

# 2. locked dependencies
npm ci

# 3. configuration: copy the template, then set values locally (never commit .env)
cp .env.example .env
#    set POSTGRES_PASSWORD and a matching DATABASE_URL for 127.0.0.1:5433

# 4. database (loopback only, port 5433) and migrations
docker compose up -d postgres
npx prisma migrate deploy

# 5. two terminals
npm run dev:api       # http://localhost:3000   (API prefix /api/v1)
npm run dev:web       # http://localhost:5173
```

Health endpoints: `GET /api/v1/health` and `GET /api/v1/health/database`. The database check reports a
generic status and never returns connection details.

> **Port 5433 is deliberate.** `5432` may belong to an unrelated PostgreSQL on your machine. Never point
> this project at it. Before a migration or a seed, check the URL with
> `python3 scripts/db_guard.py [URL]` (it defaults to `$DATABASE_URL`). It only parses the URL, never
> connects, and accepts only the loopback `nook_dev` or `nook_test` database on port 5433.

### Create a first local user

There is no public sign-up. Users are provisioned by an operator script that prints a temporary password
once. Point it at your **local** database:

```bash
export MIGRATOR_DATABASE_URL='postgresql://nook:<password>@127.0.0.1:5433/nook_dev'
node --import tsx scripts/ops/provision-user.ts \
  --confirm-target 127.0.0.1:5433/nook_dev \
  --email owner@example.com --name "Local Owner" --role OWNER --create-org "Local Hostel"
```

`--confirm-target` must repeat the database as `host:port/database`; it guards against running the
script against the wrong database.

## Development

| Command                                 | What it does                                         |
| --------------------------------------- | ---------------------------------------------------- |
| `npm run dev:api` / `dev:web`           | Start the API or web app in watch mode               |
| `npm run build`                         | Production build, both workspaces                    |
| `npm test`                              | Unit tests, both workspaces (no database needed)     |
| `npm run typecheck`                     | TypeScript across the workspace                      |
| `npm run lint` / `format:check`         | ESLint / Prettier                                    |
| `npm run prisma:validate`               | Validate the schema, no connection needed            |
| `npm run test:integration -w @nook/api` | Database-backed API suites (needs an isolated DB)    |
| `npm run job:invoices -w @nook/api`     | Run the monthly invoice scheduler once (after build) |
| `npm run verify:migration`              | Verify the initial migration                         |
| `npm run verify:secrets`                | Baseline secret scan across the repository           |
| `npm run verify:scope` / `test:scope`   | Phase scope verifier and its own tests               |

### Testing

- **Unit tests** need no database: `npm test`.
- **Integration tests** run against a disposable PostgreSQL provisioned by the CI scripts; point them only
  at an isolated database, never at one that holds data you care about.
- **Browser end-to-end** (real Chrome, Vite, Nest and a disposable tmpfs PostgreSQL in Docker):

  ```bash
  NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 node --import tsx scripts/qa/ui-readiness-disposable.mjs full regression
  ```

  Screenshots go to `docs/ui-readiness/evidence/<phase>`; set `NOOK_UI_AUDIT_PHASE` to a scratch path to
  keep them out of the repository.

- **CI** (`.github/workflows/ci.yml`) runs two required jobs: `quality` (scope guard, typecheck, lint,
  Prettier, unit tests, build, schema validation, secret scan, dependency audit) and `full-integration`
  (the database integration suites on PostgreSQL 17).

## Project structure

```
apps/api            NestJS API: auth, inventory, resident, enquiry, booking, admission, checkin,
                    finance, corrections, transfer, resident-history, stay-summary, jobs,
                    observability, database
apps/web            React + Vite: login, operations shell, finance shell, floor plan, design tokens
prisma/             schema.prisma and migrations
scripts/            CI scripts, QA and end-to-end harnesses, ops CLI, secret scan, scope verifiers,
                    database guard
docs/               milestone and phase documents, ops runbooks, release documents, UI readiness,
                    project handbook
marketing/          brand assets and campaign artwork
.github/workflows/  CI definition
```

## Security and data integrity

- **Tenant isolation.** Every table is tenant-scoped with composite keys, and the integration suites
  assert cross-tenant isolation.
- **Authentication.** Server-side sessions with opaque tokens, scrypt password hashing, CSRF double-submit,
  persistent login throttling, and host-only `HttpOnly; Secure; SameSite=Strict` cookies in production.
- **Authorization.** A default-deny permission layer; `OWNER` and `PROPERTY_MANAGER` today, any other role
  is refused everything.
- **Immutable records.** Payments, reversals, adjustments, voids and audit events are append-only. The
  application role has no `DELETE` privilege on any table and no `UPDATE` on audit and void records.
- **Gated financial logic.** Rent calculation, automated billing, payment allocation order, deposit
  deduction, refunds and final settlement are not applied beyond what the owner has signed off.
  Unapproved rules are tracked in [`NOOK_BLOCKER_REGISTER.md`](NOOK_BLOCKER_REGISTER.md) and the owner
  decision documents under [`docs/phase-4/`](docs/phase-4/).
- **Secrets never enter the repository.** `.env` is never committed; `.env.example` holds local-only
  placeholders; `VITE_*` values are public by definition and must never carry a secret. A committed secret
  is revoked and rotated; deleting it in a later commit is not sufficient.

## Documentation

| Document                                                                             | What it covers                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [`docs/nook-complete-project-handbook-v1/`](docs/nook-complete-project-handbook-v1/) | The complete product and engineering handbook: 121 pages, 25 chapters, plus 42 pages of technical appendices |
| [`docs/MILESTONE_0_SCOPE.md`](docs/MILESTONE_0_SCOPE.md)                             | What Milestone 0 includes and excludes                                                                       |
| [`docs/MILESTONE_0_VALIDATION.md`](docs/MILESTONE_0_VALIDATION.md)                   | Executed checks, exit codes and the remaining acceptance blockers                                            |
| [`docs/nook-phase-3/`](docs/nook-phase-3/)                                           | Phase 3 scope register, check-in/check-out and finance plans                                                 |
| [`docs/phase-4/`](docs/phase-4/)                                                     | Phase 4 specifications, owner decisions required, and evidence                                               |
| [`docs/ops/`](docs/ops/)                                                             | Runbooks: web and API topology, observability, backup and restore, invoice scheduler                         |
| [`docs/release/`](docs/release/)                                                     | Pilot release readiness and the backup/restore verification procedure                                        |
| [`docs/ui-readiness/`](docs/ui-readiness/)                                           | UI implementation and readiness record                                                                       |
| [`NOOK_LAUNCH_ROADMAP.md`](NOOK_LAUNCH_ROADMAP.md)                                   | Planning-only launch roadmap; nothing in it has been executed                                                |
| [`NOOK_BLOCKER_REGISTER.md`](NOOK_BLOCKER_REGISTER.md)                               | Launch blockers (`BLK-nn`)                                                                                   |

Current results always live in the validation and release documents, not in this README. The scope
verifier is a local static guardrail; it is not a substitute for runtime, security or financial tests.

## Brand

Nook is **wordmark-led**. The primary logo is the lowercase wordmark; the standalone symbol is the
lowercase `n` monogram, drawn from the identical vector path, not a redrawn lookalike. The letterforms are
closed vector paths and reference no font, so the product's eventual typeface cannot break the logo.

|     | Midnight Indigo | Nook Violet | Soft Lavender | Pure White | Primary Text |
| --- | --------------- | ----------- | ------------- | ---------- | ------------ |
|     | `#171338`       | `#7657F6`   | `#F4F1FF`     | `#FFFFFF`  | `#26233D`    |

Masters, the manifest they are checksummed against, and the full guidelines live in
[`docs/nook-complete-project-handbook-v1/`](docs/nook-complete-project-handbook-v1/) and
[`marketing/brand/`](marketing/brand/). Do not retype the wordmark in a font, recolour it outside the
palette, or add a gradient, shadow or outline to it.

> **The name is not cleared.** Trademark clearance and domain ownership are unverified, and public brand
> launch is blocked pending review of the Nook / Nooks conflict. Treat `nook` as a working product name.

## Licence

This is proprietary software. Copyright (c) 2026 Forge. All rights reserved. No licence is granted to
use, copy, modify, distribute or host the code or the brand assets without a separate written agreement
with Forge. See [`LICENSE`](LICENSE).

<br>

---

<div align="center">

<sub>A product of</sub>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/forge-lockup-dark.png">
  <img src="docs/assets/forge-lockup-light.png" alt="Forge" width="150">
</picture>

</div>
