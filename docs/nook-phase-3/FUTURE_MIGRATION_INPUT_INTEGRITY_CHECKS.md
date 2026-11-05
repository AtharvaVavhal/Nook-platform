# Future migration requirement: database-level input-integrity CHECKs

Status: **requirement only. Nothing here has been executed or written as a migration file.** It follows P0 #1
(input validation), which enforces these rules in the API. The database should enforce them too, so a bug, a script or
direct SQL cannot store what the API refuses. A migration needs its own approval, a slice entry in
`scripts/phase_scope.json` and a `-- phase-scope:` tag (S3).

## 1. What the scratch data says (read-only census, scratch database only)

| Check                                                          | Rows                 |
| -------------------------------------------------------------- | -------------------- |
| bookings                                                       | 6,191                |
| `end_date <= start_date`                                       | 11 (9 not cancelled) |
| `monthly_price <= 0`                                           | 2 (0 not cancelled)  |
| admissions whose date is outside the booking period (IST days) | 157                  |
| enquiries `CONVERTED` without a resident                       | 0                    |

The scratch database is full of test fixtures, so these numbers are not production. They show the point: **legacy rows
can violate a new rule**, so each constraint needs a pre-flight and a legacy strategy (exempt cancelled rows, or add
`NOT VALID` first and `VALIDATE CONSTRAINT` after the data is reviewed).

## 2. Proposed constraints

### 2.1 Booking period (recommended)

```sql
-- compared as Asia/Kolkata calendar days, like the API: a booking covers at least one night
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_period_valid" CHECK (
  "status" = 'CANCELLED'
  OR ("end_date" AT TIME ZONE 'Asia/Kolkata')::date > ("start_date" AT TIME ZONE 'Asia/Kolkata')::date
) NOT VALID;
-- after pre-flight shows 0 violating rows:
ALTER TABLE "bookings" VALIDATE CONSTRAINT "bookings_period_valid";
```

Pre-flight (must return 0): `SELECT count(*) FROM bookings WHERE status <> 'CANCELLED' AND (end_date AT TIME ZONE
'Asia/Kolkata')::date <= (start_date AT TIME ZONE 'Asia/Kolkata')::date;`

Cancelled rows are exempt because they are history and may predate the rule. `AT TIME ZONE` with a constant zone is
immutable, so it is allowed in a CHECK.

### 2.2 Booking price (recommended)

```sql
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_price_positive" CHECK (
  "status" = 'CANCELLED' OR "monthly_price" > 0
) NOT VALID;
ALTER TABLE "bookings" VALIDATE CONSTRAINT "bookings_price_positive";
```

The column is already `DECIMAL(10,2)`, which caps the value at 99,999,999.99 (the API and the web form use the same
limit). Invoices need an amount above zero (`invoices_amount_positive`), so a zero-price confirmed booking could never be
billed.

### 2.3 No double-booking of a bed (strongly recommended, needs approval for an extension)

Today the only guard is the application's `SELECT ... FOR UPDATE` on the bed plus an overlap query. A database
exclusion constraint makes overlap impossible whatever the code does:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- needs privilege and approval; Railway PostgreSQL supports it
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
  "bed_id" WITH =,
  tstzrange("start_date", "end_date", '[)') WITH &&
) WHERE ("status" <> 'CANCELLED');
```

Pre-flight lists overlapping live bookings (self-join on `bed_id` with overlapping ranges, `a.id < b.id`). Notes: PostgreSQL does not
support `NOT VALID` on an exclusion constraint (only on CHECK and foreign keys), so the pre-flight must be clean first and the
build scans the whole table;
`/extend` and shortening both update the same row, so they are covered; the extension adds a GiST index (size and lock
time to be assessed on the real table). A violation surfaces as SQLSTATE `23P01`, which the API should map to 409.

### 2.4 Enquiry conversion link (optional)

```sql
-- a CONVERTED enquiry always points at its resident (the reverse is not required: archiving keeps the link)
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_converted_has_resident" CHECK (
  "status" <> 'CONVERTED' OR "resident_id" IS NOT NULL
);
```

Scratch census: 0 violations.

### 2.5 Text lengths (optional)

`CHECK (char_length(notes) <= 2000)` on bookings, admissions, enquiries and follow-ups; `char_length(first_name) <= 100`
and the like. Low value: the API already bounds them.

## 3. Deliberately **not** a database constraint

**Admission date inside the booking period.** It spans two tables (it would need a trigger), it is a business rule that
may be relaxed (for example advance admission), and the scratch census shows 157 existing admissions that would violate
it. It stays an API rule (`assertWithinBooking`, and the booking update check) unless the owner decides otherwise.

## 4. Migration shape and safety

- One migration per concern, additive, each starting with `-- phase-scope: slice-3.x`, each with a fail-closed
  pre-flight `DO $$ ... RAISE EXCEPTION` block like `20261103110000_invoice_guard_hardening`.
- `ADD CONSTRAINT ... CHECK` scans the table under a brief lock; `NOT VALID` then `VALIDATE CONSTRAINT` keeps the heavy
  step to a weaker lock. Production size is small at launch, so either is acceptable; the exclusion constraint builds an
  index and needs a maintenance window estimate.
- Rollback is `ALTER TABLE ... DROP CONSTRAINT ...` (no data change).
- Run order: scratch copy of a production restore first (the restore drill from P0 #3), then production.
- Tests to add with the migration: direct SQL refused for each case in the API tests (`booking.integration.test.ts`
  "invalid input" matrix), cancelled legacy rows still readable and editable, the overlap race (two parallel inserts)
  refused with `23P01`, and the API mapping of the new SQLSTATEs to 400/409.
- The grants matrix is unaffected (constraints need no new privilege for the runtime role).
