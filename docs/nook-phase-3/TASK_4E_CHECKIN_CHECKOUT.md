# Task 4E — Check-in and check-out

Scope: check-in / check-out API, rules, concurrency safety and the Check-ins screens. No schema change,
no migration, no Finance UI.

## Rules as implemented

| Rule | Where | Result |
| --- | --- | --- |
| Admission must be `ADMITTED` | `assertCanCheckIn` | 409 |
| Booking must be `CONFIRMED` | `assertCanCheckIn` | 409 |
| Resident / bed / booking must match the admission | `assertMatchesParent` + DB trigger `check_check_in_matches_admission` | 400 / 23514 |
| Archived bed, archived room, out-of-service bed refused | `assertCanCheckIn` | 409 |
| Duplicate active check-in refused (same admission, same bed, same resident) | `assertCanCheckIn`, under row locks | 409 |
| An admission is checked in **at most once, ever** | `UNIQUE(admission_id)` (existing) | 409 — a new stay needs a new booking and admission |
| Check-in time defaults to now; a zone-less value is Asia/Kolkata | `resolveInstant` | — |
| Check-out only for an `ACTIVE` check-in; time defaults to now; not before check-in; reason optional | `assertCanCheckOut` | 409 / 400 |
| History preserved | check-in rows are never deleted; status moves only through check-out, which writes a `check_outs` row | — |
| No automatic cancellation | check-out touches only `check_ins` and `check_outs` | — |
| Occupancy comes from active check-ins | `CheckInService.occupancy`, `BookingService.getAvailableBeds` | — |

Changes to existing behaviour (deliberate, all in the direction of the rules above):

- `PUT /check-ins/:id` accepts **notes only**. `status` and `checkInAt` are refused (400). Previously a client
  could flip a stay between `ACTIVE` and `CHECKED_OUT` with no check-out record, or rewrite the check-in time
  that billing starts from.
- `DELETE /check-ins/:id` is removed (it marked a stay checked out without a check-out record).
- Cancelling (or un-admitting) an admission, or cancelling a booking, **while it has an active check-in** is
  refused with 409. Otherwise an active stay could sit on a cancelled booking.
- `getAvailableBeds` now also skips archived beds and beds with an active check-in (a resident who stays past
  the booking end date still occupies the bed).
- Existing 404 for "admission not ADMITTED" became 409 (the admission exists; its state is the problem).
  Unknown and cross-tenant ids are still 404.

## Concurrency design

The database enforces `UNIQUE(admission_id)` on check-ins and `UNIQUE(check_in_id)` on check-outs, plus the
composite tenant keys and integrity triggers. It does **not** stop two different admissions being checked into
one bed, one resident into two beds, or a cancellation landing between a status read and a write. There is no
partial unique index on `(bed_id) WHERE status = 'ACTIVE'`; adding one needs a migration, which this task did not
create. Those rules are therefore enforced with `SELECT … FOR UPDATE` row locks, then a re-read, in one fixed order:

```
check-in :  bed → resident → booking → admission
check-out:  check-in
cancel admission / booking:  that one row
```

Every path takes a prefix of the same order, so none can deadlock another. Verified by mutation: with the
`FOR UPDATE` removed, 5 of the concurrency tests fail (same-admission, same-bed, same-resident, and both
cancellation races). Check-out passes even without the lock because `UNIQUE(check_in_id)` is a second guard;
the lock keeps the loser's answer a clean 409.

**Recommended follow-up (needs approval, not done):** a partial unique index
`CREATE UNIQUE INDEX … ON check_ins (bed_id) WHERE status = 'ACTIVE'` (and the same on `resident_id`) so the
database, not only the application, guarantees one active stay per bed.

## KYC integration boundary — pending, intentionally not enforced

There is **no verification module** in the repository: no DigiLocker or other provider integration, no
verification service, no document store. The scope register (`PHASE_3_SCOPE_REGISTER.md`) places KYC / Aadhaar
out of Phase 3. `Resident.documentVerificationStatus` (`PENDING | VERIFIED | REJECTED`) exists but is a plain
column that any signed-in user can set through the resident update endpoint; nothing verifies it. Enforcing it
would make an editable flag look like a control, so it is **not** used as a gate and no `VERIFIED` is simulated.

Integration point, for when a real module exists: `CheckInService.create()` in
`apps/api/src/checkin/checkin.service.ts`, inside the transaction **after** the four row locks and the
`assertCanCheckIn` call and **before** `tx.checkIn.create`, marked with the comment "KYC integration point".
The module's verified decision for `admission.residentId` is checked there and a failure thrown as a 409 with the
reason. Doing it inside the transaction means a verification revoked concurrently cannot slip past the check.
Policy to apply at that point: accept the approved alternative-document policy; do not require Aadhaar alone.
The UI needs no change beyond showing the 409 message, which it already does.

## Finance — read-only verification, no change to billing rules

`FinanceService.generateMonthly` selects check-ins through the correct relations: the check-in's own
`admission` (must be `ADMITTED`), `booking` (must be `CONFIRMED` and overlap the period), `resident` (must be
`ACTIVE`) and `checkOut`. It bills `booking.monthlyPrice` in full. Nothing in this task changes it.

What that means for check-out (the existing full-month policy, no proration, no automatic refunds):

- **Check-in date:** a stay is billable for a period if `checkInAt` is before the next period start (IST).
  A future-dated check-in is not billed until its month begins. The check-in month is billed in full.
- **Early check-out:** a resident who checks out during a month, or on its first day, is still billed that whole
  month. From the next month they are excluded (`checkOutAt` before the new period start).
- **Already-issued invoices:** untouched. Check-out never edits, cancels, refunds or adjusts an invoice.
- **Generation is not retroactive:** invoices not yet generated for a period follow the rules above at the
  time of generation.
- **Legacy branch:** `generateMonthly` also handles `CHECKED_OUT` rows that have no `check_outs` row (the old
  update/cancel path). That path no longer exists, so the branch only matters for pre-existing rows.

Known implications to be aware of (documented, not changed — billing rules are frozen):

1. Cancelling a booking or admission **after** the resident has checked out removes the stay from billing that
   has not been generated yet, because Finance requires `ADMITTED` and `CONFIRMED`. Issued invoices are unaffected.
2. A resident who stays past `booking.endDate` is checked in but is not selected by Finance once the booking no
   longer overlaps the period. Extending the booking is the current remedy.
3. No refund or credit is created on early check-out; an owner would use the existing correction flows.

## Test evidence

See the delivery report. Test files: `apps/api/test/checkin.rules.test.ts` (pure rules, no database),
`apps/api/test/integration/checkin.integration.test.ts` (API + concurrency, needs a database).
