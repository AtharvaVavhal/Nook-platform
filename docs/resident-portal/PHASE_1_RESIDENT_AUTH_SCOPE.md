# Resident portal Phase 1: authentication foundation

## Resident authentication foundation scope

Source: the repository user's "NOOK — PHASE 1: RESIDENT AUTHENTICATION FOUNDATION" instruction, received in this session on
2026-11-19, which follows the Phase 0 audit of the same day. This record is the reference for scope slice 5.1 in
`scripts/phase_scope.json`. It authorizes implementation and local, disposable-database testing only. It does not authorize
a production migration, production grants, deployment, a real SMS provider or enabling resident access in production.

In scope (backend only):

- Owner-provisioned resident portal accounts: one account per resident, identified by an Indian mobile number (E.164, +91).
- Phone sign-in with a six-digit SMS code (hashed at rest, 5-minute expiry, 5 attempts, 30-second resend cooldown, rate limits).
- A provider-independent SMS interface, a disabled default adapter and a test-only mock adapter. No real provider.
- Resident sessions in their own table with their own cookie names, isolated from owner sessions.
- A resident principal with a default-deny permission table; resident sessions are refused on every staff route.
- An exact-match origin allowlist (owner app and resident portal) with the resident origin limited to resident routes.

Tables: `resident_accounts`, `resident_otp_challenges`, `resident_sessions`, `resident_auth_throttles`.

Out of scope for this slice: any frontend, the `/me` resident APIs, invoices, payments or complaints for residents, a real
SMS provider (and its DLT registration), email or password sign-in for residents, and any production change.
