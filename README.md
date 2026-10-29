<div align="center">

<img src="docs/assets/readme-banner.png" alt="nook — the hostel and PG management platform, a product of Forge" width="100%">

<br>

![Milestone 0](https://img.shields.io/badge/Milestone%200-not%20accepted-B42318?style=flat-square&labelColor=171338)
![Phase 1](https://img.shields.io/badge/Phase%201-accepted%20with%20limitations-157B55?style=flat-square&labelColor=171338)
![Audit](https://img.shields.io/badge/npm%20audit-0%20vulnerabilities-157B55?style=flat-square&labelColor=171338)
![Node](https://img.shields.io/badge/Node-24.22.1-7657F6?style=flat-square&labelColor=171338)
![NestJS](https://img.shields.io/badge/NestJS-12.3.2-7657F6?style=flat-square&labelColor=171338)
![React](https://img.shields.io/badge/React-19.3.1-7657F6?style=flat-square&labelColor=171338)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-7657F6?style=flat-square&labelColor=171338)
![Prisma](https://img.shields.io/badge/Prisma-7.10.1-7657F6?style=flat-square&labelColor=171338)
![Private](https://img.shields.io/badge/private-no%20licence%20declared-625E78?style=flat-square&labelColor=171338)

</div>

---

> ### This is a foundation and a demo, not a product.
>
> The repository holds the **Milestone 0 engineering foundation**, a **Phase 1 frontend
> demonstration** of the property view and floor plan, and **Phase 2 planning**. The database schema
> is still empty by design, so there is **no** resident, booking, rent, payment, deposit or
> settlement logic anywhere in it.
>
> Phase 1 is accepted for demonstration use with documented limitations. **Milestone 0 is not
> accepted.** The platform is not release-ready.
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

# 3 — database (loopback only, port 5433)
docker compose up -d postgres

# 4 — two terminals
npm run dev:api       # http://localhost:3000
npm run dev:web       # http://localhost:5173
```

Health endpoints: `GET /api/v1/health` and `GET /api/v1/health/database`. The database check reports
a generic status and never returns connection details.

> **Port 5433 is deliberate.** `5432` may belong to an unrelated PostgreSQL on your machine. Never
> point this project at it. Check any connection URL with `python3 scripts/db_guard.py` before
> running a migration or a seed.

Validate the empty schema without a database connection:

```bash
DATABASE_URL='postgresql://nook:nook_local_only@127.0.0.1:5433/nook_dev' npm run prisma:validate
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
| `npm run verify:m0-scope`             | Static guardrail: assert Milestone 0 boundaries |
| `npm run verify:secrets`              | Baseline secret scan across the repository      |
| `npm run verify:scope` / `test:scope` | Phase scope verifier and its own tests          |

<br>

## Layout

```
apps/api            NestJS shell — health routes, config parsing, database service
apps/web            React + Vite shell — design tokens, demonstration property UI
prisma/             schema.prisma — a generator and a datasource, and no models
scripts/            secret scan, Milestone 0 scope verifier, phase guard, db guard
docs/               Milestone 0 scope and validation, the project handbook
marketing/          brand assets and campaign artwork
.github/workflows/  CI definition
```

<br>

## Guardrails

These exist because the cost of getting them wrong is paid by somebody's rent record.

**The schema is empty on purpose.** `prisma/schema.prisma` declares a generator and a datasource and
nothing else. There are no migrations. Domain entities are not added until the conceptual model and
the affected business rules have been reviewed and approved.

**Financial logic is gated.** Rent calculation, automated billing, payment allocation order, payment
confirmation policy, deposit deduction, refund and final checkout settlement are not implemented
without explicit owner sign-off. **Seventy-three business rules await a decision** — seventy
unresolved and three needing professional confirmation. Each one names what it blocks and who
decides.

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

**Phase 1 — accepted with documented limitations** (2026-10-28). The property view and interactive
floor plan passed browser QA, and a horizontal-overflow defect found at 390 px and 320 px was fixed.
It is a **frontend-only demonstration** driven by static fixtures: no API call, no persistence, and
every control is navigation, filter or selection. Nothing is allocated.

**Milestone 0 — not accepted.** Approval is not verification, and the remaining evidence has not
been produced.

What has been verified, with recorded exit codes:

- `npm test`, `npm run typecheck`, `npm run build`, `npm run verify:secrets`, `prisma:validate` — all `0`
- `npm run verify:m0-scope` — 22/22 checks
- `npm audit` — **0 vulnerabilities** since the dependency advisory was resolved on 2026-10-28
- PostgreSQL 17 reachable on `127.0.0.1:5433`, and `GET /api/v1/health/database` returning `200`

What has not:

- Clean-clone reproducibility, which needs roughly 450 MB for `npm ci`
- Hosted CI, which has never run to completion
- Any database-backed route beyond the health check — there is no schema to serve one
- Safari, Firefox, real touch devices, screen readers and a measured contrast audit

The scope verifier is a local static guardrail. It is not a substitute for runtime, security or
financial tests. Current results always live in the validation documents above, not here.

<br>

---

<div align="center">

<sub>A product of</sub>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/forge-lockup-dark.png">
  <img src="docs/assets/forge-lockup-light.png" alt="Forge" width="150">
</picture>

</div>