# Resident portal Phase 1: authentication foundation

Status: implemented and tested against disposable local PostgreSQL 17.11 only. **Nothing here has touched production**: no
production migration, no production grants, no Railway or Vercel change, no real SMS provider, and resident access is switched
off in any environment that does not set `RESIDENT_WEB_ORIGIN`. Scope record: `PHASE_1_RESIDENT_AUTH_SCOPE.md` (scope slice 5.1).

## 1. Identity

- `resident_accounts`: one row grants one `Resident` portal access. The sign-in identifier is a mobile number stored as E.164
  `+91` plus ten digits (`^\+91[6-9][0-9]{9}$`, enforced by a CHECK constraint).
- The account references its resident through the composite foreign key `(resident_id, organization_id)`, so an account can only
  exist for a resident of the same organization. A trigger forbids changing `resident_id` or `organization_id` afterwards.
- A resident never chooses a Resident ID. Provisioning is an owner action; every later request derives the resident from the
  server-side session.
- `Resident.phone` is **not** made unique (existing data and business rules unreviewed). The portal number is a separate value on
  the account, copied from `Resident.phone` only when the owner does not supply one.
- Partial unique indexes: one non-revoked account per resident, and one non-revoked account per phone number (a number must
  resolve to exactly one identity). A revoked account frees both, so access can be granted again with a new account.
- A phone number that is already in use anywhere is refused with the same generic `PHONE_NOT_AVAILABLE` for every organization.

## 2. Provisioning (owner only)

All routes are under `/api/v1/resident-accounts`. They require an owner or manager session; creating and changing accounts is
OWNER-only (a manager can read). A resident session is refused with 403.

| Route                                           | Effect                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /` `{residentId, phone?}`                 | provision (resident must be ACTIVE and in the owner's organization)                |
| `GET /?residentId=&status=`                     | list the organization's accounts (masked numbers)                                  |
| `POST /:id/suspend` / `/revoke` / `/reactivate` | state changes; suspend and revoke end sessions and invalidate unused codes at once |
| `POST /:id/phone` `{phone}`                     | change the number; ends sessions and invalidates unused codes                      |

Revoke is permanent for that account. Every change writes an `audit_events` row inside the same transaction. Responses carry the
account's own fields and a masked number only; no document, address or other resident field.

## 3. Phone OTP

| Setting         | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| Identifier      | Indian mobile, E.164 `+91`                                           |
| Code            | 6 digits from `crypto.randomInt`                                     |
| Expiry          | 5 minutes                                                            |
| Attempts        | 5 per code                                                           |
| Resend cooldown | 30 seconds (atomic, per number, applied to unknown numbers too)      |
| Storage         | `HMAC-SHA256(RESIDENT_OTP_SECRET, challenge id : account id : code)` |

- Only the newest code verifies: issuing a code invalidates the previous one in the same transaction, and a partial unique index
  allows one live challenge per account.
- Verification counts the attempt in one conditional UPDATE before comparing, and consumes the code and opens the session in one
  transaction. Parallel guesses cannot exceed five attempts; parallel correct submissions produce exactly one session.
- Every refusal (wrong, expired, used, superseded, locked, unknown number, suspended account) is the same `401
INVALID_OR_EXPIRED_CODE`. A code request for a valid-looking number always answers `200 {requested:true, resendAfterSeconds:30}`.
- Rate limits live in `resident_auth_throttles` (keyed hashes only): 5 codes per number per hour, 20 per address per hour, 10 wrong
  codes per number per 15 minutes, 30 per address per 15 minutes. The owner `login_throttles` table is untouched.
- Codes, numbers, hashes and secrets are never logged (tested by capturing log output).

## 4. SMS provider

`apps/api/src/resident-auth/sms/`: the `SmsProvider` interface, `SmsDispatcher` (5 s per attempt, at most 2 attempts, only transient
and timeout failures are retried), `DisabledSmsProvider` (the default: every send fails permanently and visibly), and
`MockSmsProvider` (tests; in-memory outbox). `createSmsProvider` is the only place a provider is chosen. The mock is refused by
the config parser and again by the factory when `APP_ENV=production`. A delivery failure invalidates the undelivered code and is
logged without the text or the number; the caller still receives the generic answer.

## 5. Sessions and authorization

- `resident_sessions` is a separate table; cookies are `nook_resident_session` and `nook_resident_csrf` (HttpOnly, SameSite=Strict,
  Secure in production, no `Domain`). Idle 30 minutes, absolute 8 hours. Every request re-checks the account, the organization and
  the resident, so suspending any of them ends access immediately.
- The resident principal has its own permission table (`RESIDENT_PERMISSIONS`, currently `resident.self.read`) and holds no staff
  permission. A resident session on any staff route returns 403 `INSUFFICIENT_ROLE`; a staff session on a resident route returns 401. Routes use `@ResidentSessionOnly()` / `@RequireResidentPermission()`; the identity is `request.residentAuth`.
- Mutating resident routes require the resident origin and the resident CSRF token. The owner origin is refused on resident routes
  and the resident origin is refused on owner mutations.

## 6. Origins and CORS

`WEB_ORIGIN` (owner app) and `RESIDENT_WEB_ORIGIN` (resident portal) are each compared as exact strings. The resident origin gets
CORS headers only for `/api/v1/resident-auth/*` and `/api/v1/me/*`; the owner origin keeps access to everything. No wildcard.

## 7. Environment variables (names and rules only; set in the hosting platform)

| Variable                | Rule                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESIDENT_WEB_ORIGIN`   | optional; absent means the resident portal is off (its routes answer 404). Exact HTTP(S) origin, no path, HTTPS in production, different from `WEB_ORIGIN` |
| `RESIDENT_OTP_SECRET`   | required when `RESIDENT_WEB_ORIGIN` is set; at least 32 random characters; a secret                                                                        |
| `RESIDENT_SMS_PROVIDER` | `disabled` (default) or `mock`; `mock` is refused in production                                                                                            |

## 8. Production database review (nothing applied)

Migration `20261119100000_resident_otp_auth` is additive: four tables, one enum, one trigger function, no existing object changed.
It applies as `nook_migrator` through the existing pinned-TLS migration path. The unchanged `docs/production/deploy-kit/grants.sql`
covers the new tables automatically (it loops over every table): `nook_app` gets SELECT, INSERT, UPDATE (the service updates
attempts, status and sessions; it never deletes) and `nook_backup` gets SELECT. `verify_privileges.sql` returns zero rows over
37 relations. Verified on a disposable PostgreSQL 17.11 using the production role names and the remediated `nook_cred.py`
(`provision`, `run-sql`); production was not contacted.

## 9. Known gaps

- No real SMS provider (selection, DLT sender and template registration, credentials) and no delivery receipts.
- No scheduled cleanup of expired challenges, revoked sessions and old throttle rows (they accumulate slowly; indexes exist for it).
- The `/me` resident APIs and the resident frontend are the next phase.

## 10. Migration failure and recovery (verified on disposable PostgreSQL 17.11; production untouched)

There is no down-migration. What was observed, not assumed:

- The migration is additive (no existing catalog entry removed or changed, existing data byte-identical, the 24 earlier ledger rows
  unchanged) and applies in well under a second on top of the 24-migration chain as a non-superuser owner.
- **A failure part-way leaves partial DDL.** With a conflicting object pre-created, the deploy stopped with `P3018`; the objects
  created before the conflict (`resident_accounts`, `resident_otp_challenges`, the enum and the trigger function) stayed, the ledger
  row stayed unfinished, and a plain redeploy was refused with `P3009`. The migration is not atomic under Prisma 7.10.1.
- **Recovery that was verified:** drop the four `resident_*` tables, the function `resident_accounts_identity_immutable()` and the type
  `"ResidentAccountStatus"`, remove any conflicting object, run `prisma migrate resolve --rolled-back 20261119100000_resident_otp_auth`,
  then redeploy. The resulting catalog was identical to a clean 25-migration database.
- **Removing a successful migration** (no data to preserve): the same drops plus deleting its row from `_prisma_migrations` restored the
  exact 24-migration catalog. Once real data exists in these tables this is destructive and needs explicit approval and a verified backup.
- Constraint enforcement on all four tables was checked by direct SQL (phone format, one open account per resident and per phone,
  composite foreign keys, state consistency, identity immutability, one live challenge per account, hash format, attempt limits,
  delivery status, unique session token, throttle scope, and RESTRICT on organization and resident deletion).
