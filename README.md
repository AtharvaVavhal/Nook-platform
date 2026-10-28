# Nook Platform — Milestone 0 Scaffold

This is the minimal, reviewable engineering foundation for Nook. It is **not** a working hostel/PG management product yet. It contains no resident, booking, rent, payment, deposit or settlement logic.

## Toolchain

- Node.js `24.22.1` (see `.nvmrc` and `.node-version`)
- npm `11.6.2` (declared in `packageManager`)
- NestJS `12.2.0` + TypeScript API shell
- React `19.3.1` + Vite `8.3.5` web shell
- PostgreSQL `17` local service
- Prisma ORM `7.10.1`; schema has no domain models or migrations

## Local setup

1. Install Node `24.22.1` and npm `11.6.2`.
2. Supply local-only placeholder environment values inline when running commands. Keep `.env` absent for the Milestone 0 scope verifier; do not add real credentials.
3. Install locked dependencies with `npm ci`. Review dependency changes to `package-lock.json` before committing them. See `docs/MILESTONE_0_VALIDATION.md` for the unresolved Multer security blocker.
4. Start PostgreSQL with `docker compose up -d postgres` and wait until it becomes healthy.
5. Start the API in one terminal: `npm run dev:api`.
6. Start the web shell in a second terminal: `npm run dev:web`.
7. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run verify:m0-scope`, `npm run verify:secrets` and `npm audit`. Validate the empty schema without connecting to a database:

   ```sh
   DATABASE_URL='postgresql://nook:nook_local_only@127.0.0.1:5432/nook' npm run prisma:validate
   ```

   Database runtime checks require a running PostgreSQL service and the corresponding local `DATABASE_URL` supplied to the API process.

The web server runs on `http://localhost:5173`; the API runs on `http://localhost:3000`. API health endpoints are `GET /api/v1/health` and `GET /api/v1/health/database`. Database health reports only a generic status and does not return connection details.

## CI

The GitHub Actions workflow expects a committed lockfile and runs `npm ci`. The workspace includes a lockfile, but CI execution remains unverified. It uses no production credentials and should use synthetic/local values only.

## Schema and financial policy guardrails

`prisma/schema.prisma` intentionally has no models, and there are no migrations. Do not add domain entities/migrations until the conceptual data model and affected rules have been separately reviewed and approved. Do not implement rent calculations, automated billing, payment allocation order, payment confirmation policy, deposit deductions/refunds or final checkout settlement without explicit owner sign-off.

## Secret handling

- Never commit `.env` or any real key/credential.
- `.env.example` contains local-only placeholders.
- `VITE_*` variables are public and must never contain secrets.
- If a secret is accidentally committed, revoke/rotate it and assess exposure; deleting it in a later commit is not sufficient.

## Status

Milestone 0 is **not yet accepted**. See `docs/MILESTONE_0_VALIDATION.md` for current check results and remaining security, PostgreSQL, runtime and CI blockers, and `docs/MILESTONE_0_SCOPE.md` for scope limits. The scope verifier is a local static guardrail; it is not a substitute for runtime, security or financial tests.

Nook remains a working product name. Trademark/competitor clearance is unresolved; public brand launch is blocked pending review.
