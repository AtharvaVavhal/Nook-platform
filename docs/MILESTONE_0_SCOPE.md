# Nook Milestone 0 scope and known status

**Scope:** reproducible engineering foundation only.

## Included in this scaffold

- NestJS + TypeScript API shell with non-sensitive health endpoints.
- React + TypeScript + Vite UI shell using the approved Option A design tokens.
- Local PostgreSQL service through Docker Compose.
- A Prisma 7 configuration and empty PostgreSQL provider schema. There are intentionally no domain models or migrations.
- Environment parsing, local example configuration, formatting/lint/type-check/test scripts, CI workflow and a baseline secret-pattern scanner.
- Synthetic-only tests for configuration and brand-token invariants.

## Explicitly excluded

- Resident, property, room/bed, booking, billing, payment, deposit or checkout feature modules.
- Authentication/session issuance or account recovery implementation.
- Final domain database schema and migrations.
- OTP, Razorpay, WhatsApp/SMS or other external provider credentials/integrations.
- Real resident data, real documents, production environment setup or production deployment.

## Important validation status

The original scaffold was created without Docker or npm registry access. Installed dependencies and a lockfile are now present. See [the current validation record](MILESTONE_0_VALIDATION.md) for executed checks and remaining blockers. Milestone 0 remains unaccepted until dependency security, PostgreSQL health, runtime checks and CI are verified in a provisioned environment.

No tenant isolation, financial correctness, booking atomicity or recovery property is claimed as proven by this shell.
