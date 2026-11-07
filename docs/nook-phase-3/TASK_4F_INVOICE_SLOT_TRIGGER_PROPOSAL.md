# Database-level protection against legacy-versus-booking invoice conflicts

Status: **proposal only. Not implemented as a migration file, not applied to any database.** The SQL below was exercised
inside a transaction that was rolled back on the isolated scratch database `nook_layer1_clean` (and its locking algorithm was
race-tested on a throwaway table there that was dropped afterwards). The existing scratch database, `nook_dev`, `nook_test` and
production were not touched.

## 1. The conflict

After migration `20261103130000_invoice_active_uniqueness` an invoice is unique per **booking** and month (one partial unique index),
and invoices with **no** booking stay unique per resident and month (a second partial index). The two indexes constrain only their
own kind, so a resident-month can hold an active no-booking ("legacy") invoice **and** an active booking invoice. The old
resident-level index forbade that. It means a resident could be billed twice for one month.

It is not only theoretical. In `nook_layer1_clean` it happened once: the old duplicate-prevention test inserted a no-booking invoice
(`INV-2099-9999`, DRAFT) next to a booking invoice of the same resident-month during the one run that executed before the test was
adjusted to the new model (created 2026-11-03 05:05:19 UTC). Application paths do not create it (`createDraft` requires a
booking and refuses a month already billed by a legacy invoice, generation always sets a booking and skips such months; both
tested), so only direct SQL can.

## 2. Proposed migration (not created in `prisma/migrations`)

`-- phase-scope: slice-3.9` (a new slice entry with the function `finance_check_invoice_slot`, approver, date and reference).

```sql
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM "invoices" WHERE "status" <> 'CANCELLED'
     GROUP BY "organization_id", "resident_id", "period_start"
    HAVING bool_or("booking_id" IS NULL) AND bool_or("booking_id" IS NOT NULL)
  ) x;
  IF bad > 0 THEN
    RAISE EXCEPTION 'resident-months with both an active legacy invoice and an active booking invoice exist (%), migration aborted without changes', bad;
  END IF;
END $$;

CREATE FUNCTION "finance_check_invoice_slot"() RETURNS trigger AS $$
BEGIN
  -- A voided invoice occupies no slot, on either side.
  IF NEW."status" = 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  -- An update that changes none of the slot-defining columns cannot create a conflict (and must stay cheap: payments update
  -- invoices constantly). The column list on the trigger already skips most updates; this covers the rest.
  IF TG_OP = 'UPDATE'
     AND NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND NEW."booking_id" IS NOT DISTINCT FROM OLD."booking_id"
     AND NEW."resident_id" = OLD."resident_id"
     AND NEW."period_start" = OLD."period_start"
     AND NEW."organization_id" = OLD."organization_id" THEN
    RETURN NEW;
  END IF;

  -- Serialize every writer of this resident-month until commit. Without it two concurrent transactions, one inserting a legacy
  -- invoice and one a booking invoice, would each see no conflict (neither row is committed) and both commit. After the lock
  -- is granted the query below runs as a new statement in READ COMMITTED and sees what the other transaction committed.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'invoice-slot:' || NEW."organization_id"::text || ':' || NEW."resident_id"::text || ':' || NEW."period_start"::text, 0));

  IF EXISTS (
    SELECT 1 FROM "invoices" i
     WHERE i."organization_id" = NEW."organization_id"
       AND i."resident_id" = NEW."resident_id"
       AND i."period_start" = NEW."period_start"
       AND i."id" <> NEW."id"
       AND i."status" <> 'CANCELLED'
       AND ((NEW."booking_id" IS NULL AND i."booking_id" IS NOT NULL)
         OR (NEW."booking_id" IS NOT NULL AND i."booking_id" IS NULL))
  ) THEN
    RAISE EXCEPTION 'an active invoice without a booking and an active invoice with a booking cannot both exist for one resident and billing month'
      USING ERRCODE = '23505', CONSTRAINT = 'invoices_legacy_booking_slot_conflict';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoices_slot_check"
  BEFORE INSERT OR UPDATE OF "status", "booking_id", "resident_id", "period_start", "organization_id" ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "finance_check_invoice_slot"();
```

### What it does

| Aspect          | Behaviour                                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule            | an active (`status <> 'CANCELLED'`) invoice **without** a booking and an active invoice **with** a booking cannot both exist for the same organization, resident and billing month                                    |
| INSERT          | checked for every non-cancelled new row                                                                                                                                                                               |
| UPDATE          | checked when `status`, `booking_id`, `resident_id`, `period_start` or `organization_id` change (the trigger lists exactly these columns; `paid_amount` and `adjustment_total` are not among them, see the note below) |
| Cancelled rows  | never conflict, on either side (void history stays unlimited)                                                                                                                                                         |
| Same kind twice | left to the two partial unique indexes (clean error names)                                                                                                                                                            |
| Error           | SQLSTATE `23505`, constraint name `invoices_legacy_booking_slot_conflict`                                                                                                                                             |
| Existing rows   | not read, changed or locked by the migration; only the pre-flight reads                                                                                                                                               |

Note on payments: a payment updates `paid_amount` and, when the status changes (`ISSUED` to `PARTIALLY_PAID`/`PAID`), `status`. That
status change fires the trigger, which then returns at once because the status moved between two non-cancelled values and no other
slot column changed (the early-exit branch), so no advisory lock is taken and no query is run on the payment path.

### Concurrency safety

Two transactions, one inserting a legacy invoice and one a booking invoice for the same resident-month, would each see no conflict
(neither row is committed yet) and both commit. The trigger therefore takes a **transaction-level advisory lock keyed by
organization, resident and month** before it looks. The second writer waits until the first commits or rolls back, then its
`EXISTS` query runs as a fresh statement under `READ COMMITTED` and sees the committed row.

Evidence (`slot_concurrency.mjs`, throwaway table, not the real trigger): 300 concurrent races of "legacy" against "booking" for one
key. **Without the lock, all 300 committed both kinds. With the lock, 0 did; exactly one won every race.** Assumptions: the
application and the migrator use the default `READ COMMITTED` isolation (Prisma does); under `REPEATABLE READ` the second query
would not see the other commit, so such a session must not write invoices. The lock is held to commit, so writers for the same
resident-month queue (milliseconds); different residents never contend; a hash collision between two keys only serializes them.

## 3. Pre-flight

| Database                    | Result                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nook_layer1_clean`         | **1 conflicting resident-month, so the migration would abort**: `INV-2099-9999` described above (verified by running the pre-flight block: `... exist (1), migration aborted without changes`). The row stays: no cleanup.                                                                            |
| Existing `nook_4f1_scratch` | not applicable: it has neither the uniqueness migration nor its tests; it was not touched.                                                                                                                                                                                                            |
| Production                  | not checked. The same `SELECT` (the `HAVING bool_or(...) AND bool_or(...)` query) is read-only and must return 0 before the migration is run. Any row it returns must be resolved by voiding the redundant invoice through the application (voiding is terminal and keeps history), never by editing. |

## 4. Impact on existing invoices

None. No row is rewritten, no index is touched. Behavioural change: from deployment on, direct SQL that creates the conflict gets
`23505`. Legacy invoices (no booking) can still be updated, paid, credited, reversed and voided as before.

## 5. Rollback migration

Prisma migrations are forward-only, so the rollback is a **new** migration:

```sql
DROP TRIGGER IF EXISTS "invoices_slot_check" ON "invoices";
DROP FUNCTION IF EXISTS "finance_check_invoice_slot"();
```

Verified in the same dry run (trigger and function gone afterwards). It removes only the check: no data is involved, so it is safe at
any time. After it, the gap described in section 1 is open again.

## 6. Direct-SQL regression tests (to add once approved; they ran as the dry-run script)

Each runs in a rolled-back transaction (`rolledBack()` helper) so it leaves nothing behind. All passed in the dry run:

| #   | Scenario                                                                                              | Expected                                                                        |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | legacy active exists, insert booking invoice, same resident-month                                     | `23505 invoices_legacy_booking_slot_conflict`                                   |
| 2   | booking invoice active exists, insert legacy invoice, same resident-month                             | same                                                                            |
| 3   | legacy exists, insert a second legacy invoice                                                         | `23505 invoices_active_resident_period_legacy_key` (the index, not the trigger) |
| 4   | booking exists, insert the same booking again                                                         | `23505 invoices_active_booking_period_key`                                      |
| 5   | either kind exists, insert a `CANCELLED` invoice of the other kind                                    | accepted                                                                        |
| 6   | either kind exists, insert the other kind in another month                                            | accepted                                                                        |
| 7   | booking exists, insert a second booking invoice (bed transfer)                                        | accepted                                                                        |
| 8   | `UPDATE booking_id = NULL` on a booking invoice while another booking invoice is active in that month | refused, trigger error                                                          |
| 9   | `UPDATE period_start` of a booking invoice into a month held by a legacy invoice                      | refused, trigger error                                                          |
| 10  | `DRAFT` to `ISSUED`, and `updated_at`-only updates                                                    | accepted (no conflict, no lock)                                                 |
| 11  | the trigger definition does not list `paid_amount`                                                    | assertion on `pg_get_triggerdef`                                                |
| 12  | two real connections race a legacy and a booking insert (300 iterations)                              | exactly one commits each time; to run against the real trigger once it exists   |

An API-level test already exists and passes: generation and `createDraft` skip or refuse a month billed by a legacy invoice.

## 7. Risks and open decisions

- Needs a slice (3.9) with approver, date and reference, and a `migrationSlices` entry.
- A new function and trigger on the hottest finance table: the early exit keeps payment writes unaffected; a regression test must keep
  `paid_amount` out of the trigger's column list.
- The `23505` raised by the trigger reaches Prisma as a unique violation; `createDraft`'s generic 409 text says "booking and billing
  period", which is slightly off for this case. Its legacy pre-check runs first, so users see the precise message.
- `period_start` is a `date`, so the lock key is stable; keys are text-concatenated UUIDs and a date.
- Deploy order: the pre-flight must be clean first. Then the migration; there is no application change.
- Decision requested: approve implementing this as slice 3.9, and tell me how a production pre-flight hit would be resolved.
