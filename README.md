<div align="center">

<picture>
  <source srcset="docs/assets/readme-hero.svg" type="image/svg+xml">
  <img src="docs/assets/readme-hero.png" alt="nook — bed-level inventory across a building's floors. A product of Forge." width="100%">
</picture>

<br>

![Milestone 0](https://img.shields.io/badge/Milestone%200-not%20accepted-B42318?style=flat-square&labelColor=171338)
![Phase 1](https://img.shields.io/badge/Phase%201-accepted%20with%20limitations-157B55?style=flat-square&labelColor=171338)
![Phase 3](https://img.shields.io/badge/Phase%203-in%20progress-B54708?style=flat-square&labelColor=171338)
![Audit](https://img.shields.io/badge/npm%20audit-0%20vulnerabilities-157B55?style=flat-square&labelColor=171338)
![Node](https://img.shields.io/badge/Node-24.22.1-7657F6?style=flat-square&labelColor=171338)
![NestJS](https://img.shields.io/badge/NestJS-12.3.2-7657F6?style=flat-square&labelColor=171338)
![React](https://img.shields.io/badge/React-19.3.1-7657F6?style=flat-square&labelColor=171338)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-7657F6?style=flat-square&labelColor=171338)
![Prisma](https://img.shields.io/badge/Prisma-7.10.1-7657F6?style=flat-square&labelColor=171338)
![Private](https://img.shields.io/badge/private-no%20licence%20declared-625E78?style=flat-square&labelColor=171338)

</div>

---

> ### This is a pre-release build, not a launched product.
>
> The repository now holds the **Phase 2 authentication and inventory foundation** and the **Phase 3
> core workflows** — residents, enquiries, bookings, admissions, check-in/check-out and a finance
> ledger — on a real PostgreSQL schema with tenant isolation. It is under active development on
> `feature/phase-3-core-workflows`.
>
> **Milestone 0 is not accepted** and the platform is **not launch-ready**. Launch readiness has not
> been independently verified; see [`NOOK_LAUNCH_ROADMAP.md`](NOOK_LAUNCH_ROADMAP.md) and
> [`NOOK_BLOCKER_REGISTER.md`](NOOK_BLOCKER_REGISTER.md).
>
> Nothing here records an approval, a signature or a test result that has not occurred.

<br>

## What Nook is for

A hostel and PG operator knows two things badly: **who is in which bed**, and **who owes what**. Nook
is being built to answer both without a spreadsheet — bed-level spatial inventory on an interactive
floor plan, and a financial record that can be audited rather than argued over.

Three commitments shape every decision in this codebase:

|                           |                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The bed is the unit**   | Availability, allocation and occupancy are computed per bed, never per room. Allocation is atomic and re-checked inside the transaction, so two staff cannot double-book the same bed.                                    |
| **Money is never edited** | Charges, payments, allocations, deposits, adjustments and reversals are immutable once posted. The balance is always derived, never stored as truth. Amounts are integer paise in `BIGINT` — never binary floating point. |
| **No rule is guessed**    | Where a business rule is unapproved, the API refuses the operation with `422 RULE_NOT_CONFIGURED`. It names the rule, writes nothing, and applies no default.                                                             |

<br>

## Stack

| Layer           | Choice              | Version            |
| --------------- | ------------------- | ------------------ |
| Runtime         | Node.js             | `24.22.1`          |
| Package manager | npm                 | `11.6.2`           |
| API             | NestJS + TypeScript | `12.3.2` / `5.9.3` |
| Web             | React + Vite        | `19.3.1` / `8.3.5` |
| Database        | PostgreSQL          | `17`               |
| ORM             | Prisma              | `7.10.1`           |

One deployable modular monolith. Modules own their data and talk through service interfaces — core
workflows need atomic transactions across related records, and two developers with one customer need
transactions far more than they need independent deployability.

<br>

## Quick start

```bash
# 1 — toolchain
node --version        # must be 24.22.1
npm  --version        # must be 11.6.2

# 2 — locked dependencies
npm ci

# 3 — database (loopback only, port 5433), then apply migrations
docker compose up -d postgres
npx prisma migrate deploy

# 4 — two terminals
npm run dev:api       # http://localhost:3000
npm run dev:web       # http://localhost:5173
```

Health endpoints: `GET /api/v1/health` and `GET /api/v1/health/database`. The database check reports
a generic status and never returns connection details.

> **Port 5433 is deliberate.** `5432` may belong to an unrelated PostgreSQL on your machine. Never
> point this project at it. Check any connection URL with `python3 scripts/db_guard.py` before
> running a migration or a seed.

Validate the schema without a database connection:

```bash
DATABASE_URL='postgresql://nook:<password>@127.0.0.1:5433/nook_dev' npm run prisma:validate
```

<br>

## Scripts

| Command                               | What it does                                    |
| ------------------------------------- | ----------------------------------------------- |
| `npm run dev:api` / `dev:web`         | Start the API or web shell in watch mode        |
| `npm run build`                       | Production build, both workspaces               |
| `npm test`                            | Test suites, both workspaces                    |
| `npm run typecheck`                   | TypeScript across the workspace                 |
| `npm run lint` / `format:check`       | ESLint / Prettier                               |
| `npm run prisma:validate`             | Validate the schema, no connection needed       |
| `npm run test:integration -w @nook/api` | Database-backed API suites (needs an isolated DB) |
| `npm run job:invoices -w @nook/api`   | Run the monthly invoice scheduler (after build) |
| `npm run verify:migration`            | Verify the initial migration                    |
| `npm run verify:m0-scope`             | Static guardrail: assert Milestone 0 boundaries |
| `npm run verify:secrets`              | Baseline secret scan across the repository      |
| `npm run verify:scope` / `test:scope` | Phase scope verifier and its own tests          |

<br>

## What is built

| Area                      | State                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Auth and account security | Login, sessions, CSRF, login throttling, change-password, auth audit events                            |
| Inventory                 | Properties, floors, rooms and beds; interactive floor plan                                             |
| Residents                 | CRUD with tenant isolation                                                                             |
| Enquiries                 | Lead management, follow-ups, archive, conversion                                                       |
| Bookings                  | Reservations with bed availability and concurrency safety                                              |
| Admissions                | Bed allocation inside a re-checked transaction                                                         |
| Check-in / check-out      | Lifecycle management with concurrency safety                                                           |
| Finance                   | Invoices, payments with idempotency keys, reversals, adjustments, voids, receipts, monthly reports, overstay banner |
| Invoice scheduler         | Implemented and tested on a scratch database; **not deployed, scheduled or enabled**                   |
| Observability             | Sentry reporter wired in; no event has ever been sent                                                  |

The schema has 23 models across 18 migrations. Out of scope until the owner approves it: payment
gateway, OTP, SMS/WhatsApp, KYC/Aadhaar and document upload.

<br>

## Layout

```
apps/api            NestJS API — auth, inventory, resident, enquiry, booking, admission,
                    checkin, finance, jobs, observability, database
apps/web            React + Vite — login, ops shell, finance shell, floor plan, design tokens
prisma/             schema.prisma and migrations
scripts/            secret scan, scope verifiers, phase guard, db guard, ops and db helpers
docs/               milestone and phase validation, Phase 2/3 planning, ops runbooks, handbook
marketing/          brand assets and campaign artwork
.github/workflows/  CI definition
```

<br>

## Guardrails

These exist because the cost of getting them wrong is paid by somebody's rent record.

**Schema changes are reviewed.** Domain entities and migrations are added only after the conceptual
model and the affected business rules have been reviewed and approved. Every table is tenant-scoped
with composite keys, and the integration suites assert cross-tenant isolation.

**Financial logic is gated.** Rent calculation, automated billing, payment allocation order, payment
confirmation policy, deposit deduction, refund and final checkout settlement are not applied beyond
what the owner has signed off. **Seventy-three business rules await a decision** — seventy unresolved
and three needing professional confirmation. Each one names what it blocks and who decides. The
paid-amount invariant is documented inconsistently across the finance docs and still needs
independent resolution.

**Secrets never enter the repository.** `.env` is never committed; `.env.example` holds local-only
placeholders; `VITE_*` values are public by definition and must never carry a secret. A committed
secret is revoked and rotated — deleting it in a later commit is not sufficient.

<br>

## Documentation

|                                                                                      |                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [`docs/nook-complete-project-handbook-v1/`](docs/nook-complete-project-handbook-v1/) | The complete product and engineering handbook — 121 pages, 25 chapters, plus 42 pages of technical appendices |
| [`docs/MILESTONE_0_SCOPE.md`](docs/MILESTONE_0_SCOPE.md)                             | What Milestone 0 includes and excludes                                                                        |
| [`docs/MILESTONE_0_VALIDATION.md`](docs/MILESTONE_0_VALIDATION.md)                   | Executed checks, exit codes, and the remaining acceptance blockers                                            |
| [`docs/nook-phase-3/`](docs/nook-phase-3/)                                           | Phase 3 scope register, check-in/check-out and finance plans, pilot account requirements                      |
| [`docs/ops/`](docs/ops/)                                                             | Runbooks — invoice scheduler, backup and restore                                                              |
| [`NOOK_LAUNCH_ROADMAP.md`](NOOK_LAUNCH_ROADMAP.md)                                   | Planning-only launch roadmap; nothing in it has been executed                                                 |
| [`NOOK_BLOCKER_REGISTER.md`](NOOK_BLOCKER_REGISTER.md)                               | Launch blockers (`BLK-nn`)                                                                                    |

<br>

## Brand

Nook is **wordmark-led**. The primary logo is the lowercase wordmark; the standalone symbol is the
lowercase `n` monogram, drawn from the identical vector path — not a redrawn lookalike. The
letterforms are closed vector paths and reference no font, so the product's eventual typeface is an
independent decision that cannot break the logo.

|     | Midnight Indigo | Nook Violet | Soft Lavender | Pure White | Primary Text |
| --- | --------------- | ----------- | ------------- | ---------- | ------------ |
|     | `#171338`       | `#7657F6`   | `#F4F1FF`     | `#FFFFFF`  | `#26233D`    |

Masters, the manifest they are checksummed against, and the full guidelines live in
[`docs/nook-complete-project-handbook-v1/`](docs/nook-complete-project-handbook-v1/) and
[`marketing/brand/`](marketing/brand/). Do not retype the wordmark in a font, recolour it outside the
palette, or add a gradient, shadow or outline to it.

> **The name is not cleared.** Trademark clearance and domain ownership are unverified, and public
> brand launch is blocked pending review of the Nook / Nooks conflict. Treat `nook` as a working
> product name.

<br>

## Status

**Phase 1 — accepted with documented limitations** (2026-10-28). The property view and floor plan
passed browser QA. It was a frontend-only demonstration driven by static fixtures.

**Phase 2 and Phase 3 — in progress** on `feature/phase-3-core-workflows`. Phases 3.1–3.5 (residents,
enquiries, bookings, admissions, check-in/check-out) and the finance baseline are committed; later
finance corrections, account security and invoice-integrity migrations are in the working tree.

**Milestone 0 — not accepted.** Approval is not verification, and the remaining evidence has not
been produced.

Known gaps, as recorded in the roadmap and blocker register:

- Backup restore readiness is not established
- Hosted CI has not been shown to run to completion, and the integration suite is not enforced in CI
- General API rate limiting, and explicit CSP/HSTS headers, are unconfigured and unverified
- Hosting topology is only partly decided and has not been verified on live infrastructure
- The invoice scheduler is not operational
- Safari, Firefox, real touch devices, screen readers and a measured contrast audit have not been done

The scope verifier is a local static guardrail. It is not a substitute for runtime, security or
financial tests. Current results always live in the validation documents, not here.

<br>

---

<div align="center">

<sub>A product of</sub>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/forge-lockup-dark.png">
  <img src="docs/assets/forge-lockup-light.png" alt="Forge" width="150">
</picture>

</div>
