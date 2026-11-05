# Phase 3 — Scope Register

This register is the reference target for the slices in `scripts/phase_scope.json`. The guard
(`scripts/verify_phase_scope.py`) allow-lists exactly what is registered here and fails on anything else.

## How to read this register

- **Slices 3.1 to 3.5 and Slice 2.3 are recorded retroactively.** Each was commissioned by the project owner in
  its own session and delivered as the git commit named below. The guard was not extended at the time, so this
  register captures what each commit actually added. **The owner is asked to confirm these entries during review of
  the change that introduced this file.** The guard cannot prove an approval is genuine; human review does.
- **Slice 3.6** records the decisions the owner approved in session on 2026-11-01 and 2026-11-02 (see the slice).
- Delivered state is checked against git history, not against this prose.

## Still out of scope (unchanged, and enforced by the guard's forbidden vocabulary)

No payment gateway or automatic payment collection, no refunds, settlements or general ledger, no KYC, Aadhaar,
OTP, SMS or WhatsApp messaging, no document upload pipeline, no microservices.

## Slice 2.3 Authentication and inventory API

Delivered in commit `2c95f32` (feat: complete phase 2 authentication and inventory foundation). Session login, logout,
`me` and CSRF endpoints, and the property, floor, room and bed inventory API, on the nine tables of Slice 2.2.
No new tables.
`GET /api/v1/inventory/summary` (read-only, organization-scoped counts of properties, floors, rooms and beds for the
operations dashboard) is part of this API and was approved for the baseline on 2026-11-02; it was not in the original commit.

## Slice 3.1 Resident management

Commit `c7118b5`. Model `Resident` with enums `ResidentStatus` and `DocumentVerificationStatus` (a verification
status only; no document files are stored). Organization-scoped CRUD under `/api/v1/residents`.

## Slice 3.2 Enquiry and lead management

Commits `40c2b36` and the archive follow-up. Models `Enquiry` and `EnquiryFollowUp`, enums `EnquiryStatus` and
`EnquirySource`. CRUD, follow-ups and conversion to a resident under `/api/v1/enquiries`.

## Slice 3.3 Booking and reservation management

Commit `c01bb93`. Model `Booking`, enums `BookingStatus` and `PaymentStatus` (a booking-level status that finance does
not synchronize), bed availability, under `/api/v1/bookings`.

## Slice 3.4 Admission and bed allocation

Commit `7238b78`. Model `Admission`, enum `AdmissionStatus`, under `/api/v1/admissions`.

## Slice 3.5 Check-in and check-out management

Commit `7edcf70`. Models `CheckIn` and `CheckOut`, enum `CheckInStatus`, under `/api/v1/check-ins`.

## Slice 3.6 Finance and billing

Owner decisions approved in session on 2026-11-01 and 2026-11-02:
monthly rent invoices numbered `INV-YYYY-NNNN` per organization (Asia/Kolkata year); the amount is a snapshot of the
booking's monthly price; full rent for the first and final month (no proration); partial payments allowed and
overpayments rejected; methods CASH, UPI and BANK_TRANSFER; receipts numbered `RCPT-<payment id>`; overdue is derived,
never an automatic action; OWNER and PROPERTY_MANAGER have equal access.

Models `Invoice`, `Payment`, `PaymentIdempotencyKey` (database-backed idempotency), `PaymentReversal` and
`InvoiceAdjustment` (append-only corrections, credits only), enums `InvoiceStatus` and `PaymentMethod`, under
`/api/v1/finance`. Money is `Decimal(12,2)`; this is the only approved use of `Decimal`.

Integrity hardening in the same slice, approved 2026-11-02: composite organization-scoped foreign keys for bookings,
admissions, check-ins and check-outs, and database triggers that keep admission locations, lifecycle references and
enquiry links within one organization. These add functions and triggers only.

Account security for the founding-hostel pilot, approved 2026-11-02: model `LoginThrottle` (persistent sign-in
throttling keyed by hashes), the `users.password_change_required` flag, the authentication audit trail, the
change-own-password endpoint, and the operator scripts under `scripts/ops/` (provision, reset, revoke). See
`PILOT_ACCOUNT_REQUIREMENTS.md`.

## Slice 3.7 Finance ledger integrity

Task 4F.2, approved in session on 2026-11-02 from `TASK_4F2_MIGRATION_DESIGN.md`. All changes are additive; none is applied
outside the isolated scratch database without a separate approval.

- Receipt snapshots: nullable `payments.credit_total_at_payment` and `payments.balance_after_payment`, written by the trigger function
  `finance_snapshot_payment` under the invoice row lock; client values are overwritten and existing payments keep NULL ("derived").
  The column name `balance_after_payment` is why this slice allows the vocabulary word `balance`.
- Invoice voiding: model `InvoiceVoid` (table `invoice_voids`, append-only, one per invoice, organization-scoped composite keys) and
  route `POST /api/v1/finance/invoices/:id/void`. The existing `CANCELLED` status is reused. Voiding is terminal, needs a reason, is refused
  while payments are unreversed or credits are applied, and never alters payments. A draft may be voided. Function `finance_check_void`.
- Trigger hardening: `finance_guard_invoice` is replaced (body only; no object is dropped) to enforce the permitted status transitions,
  freeze `due_date`, `issued_at`, `notes` and `created_at` after issue, and allow `CANCELLED` only through a void record. The database also
  refuses payments against DRAFT or CANCELLED invoices.
- The 12 legacy `CANCELLED` invoices in test data have no void record and none is invented; they stay `CANCELLED` and become read-only.

## Slice 3.8 Invoice uniqueness

Approved in session on 2026-11-03 from `TASK_4F_INVOICE_UNIQUENESS_MODEL.md` (owner decisions: void and reissue; one invoice per
**booking** per billing month, separate bookings billed independently, extensions stay on their booking, no automatic merging).
Index change only: the resident-level unique index on `invoices` is replaced by partial unique indexes over non-`CANCELLED`
invoices (per booking, and per resident for legacy invoices with no booking). No new table, model, function or route. Applied only
to the isolated scratch database `nook_layer1_clean`; applying it anywhere else needs a separate approval.

## Dependency additions since Phase 2

All are exact-pinned and used by committed code. Recorded for owner confirmation.

- `@nestjs/swagger`, `class-validator`, `class-transformer` in `apps/api`: controller decorators and DTOs.
- `supertest` and `@types/supertest` in `apps/api`: HTTP integration tests.
- `node-pty` (root, dev only): chosen in the Phase 2 credential-rotation plan to read a password without placing it
  in process arguments. It is not imported by application code.
- `@sentry/node` 10.76.2 in `apps/api`, approved by the owner on 2026-11-03 (P0 #4, error monitoring), with these
  conditions: API only (no web SDK); active only when `SENTRY_DSN` is set; no default integrations, no request data,
  cookies, headers, bodies or breadcrumbs; `sendDefaultPii: false`; tracing off; only unexpected 5xx errors, rebuilt with
  scrubbed messages and stack frames; user id and organisation id only. Installed with `--ignore-scripts`; 19 packages
  added (OpenTelemetry and Sentry internals); `npm audit` reports 0 vulnerabilities. The version is the newest v10
  release that was more than two weeks old when chosen. Details: `docs/ops/OBSERVABILITY.md`.

## Raw SQL

Raw SQL (`$queryRaw`, `$executeRaw`) is approved in seven files, each for a reason Prisma cannot express:
`auth/auth.repository.ts` (session handling), `booking/booking.service.ts` and `enquiry/enquiry.service.ts`
(`SELECT ... FOR UPDATE` row locks), `finance/finance.service.ts` (advisory locks, row locks, invoice numbering), `auth/throttle.service.ts` (one atomic upsert per failed sign-in), and, approved 2026-11-02 (Task 4E),
`admission/admission.service.ts` and `checkin/checkin.service.ts` (`SELECT ... FOR UPDATE` row locks so check-in, check-out and
cancellation serialize; see `TASK_4E_CHECKIN_CHECKOUT.md`).

## Guard maintenance, 2026-11-02

The `.env.example` check now looks for a non-secret placeholder token instead of a literal password. Migration
tagging for post-Phase-2 migrations is read from `migrationSlices` in the manifest, because already-applied migration
files must never be edited (rule S5 and Prisma's migration checksums).

## Approvals recorded 2026-11-02 (Tasks 4E and 4F)

- `GET /api/v1/check-ins/occupancy` approved. `DELETE /api/v1/check-ins/:id` is removed (it ended a stay without a check-out record).
- Raw SQL row locks approved in `admission.service.ts` and `checkin.service.ts`.
- `POST /api/v1/bookings/:id/extend` approved (booking extension with a reason and an audit event; OWNER and PROPERTY_MANAGER may both approve).
- Additive migrations for receipt snapshots, issued-invoice trigger hardening and invoice voiding are approved **in principle only**; the SQL
  must be reviewed and approved before it is applied.
- Booking and admission cancellation is refused once any check-in exists, including after check-out. Manual invoice amount overrides are removed.
