# Invoice uniqueness model: void-and-reissue and one invoice per booking per month

Status: **implemented and verified on the isolated scratch database `nook_layer1_clean` only (2026-11-03).** The migration
`prisma/migrations/20261103130000_invoice_active_uniqueness` (slice 3.8), the service and schema changes in section 5, and the
tests in section 8 exist in the working tree, uncommitted. The migration has been applied to **no other database**: not the
existing scratch database, not `nook_dev`, `nook_test` or production. Owner decisions that drive this document (2026-11-03):

1. A voided invoice must not block billing the same month again (**void and reissue**).
2. **Frozen billing policy:** one invoice per **booking** per billing month. Separate bookings are billed independently.
   Approved extensions remain part of the existing booking. Invoices are never merged automatically. The first month is
   still charged in full, and generation stays idempotent.

## 1. The current model and what is wrong with it

| Fact                                                                                                             | Evidence                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Uniqueness is `UNIQUE (organization_id, resident_id, period_start)`, **over every status including `CANCELLED`** | index `invoices_organization_id_resident_id_period_start_key`, migration `20261101130000_add_finance_billing` |
| A voided invoice therefore occupies its resident-month for ever                                                  | rolled-back probe: replacing a voided invoice fails with `23505` on that index                                |
| `createDraft` answers `409 An invoice already exists for this resident and billing period`                       | `finance.service.ts` (P2002 mapping)                                                                          |
| `generateMonthly` treats the voided invoice as "existing" and skips it                                           | its `existing` lookup has no status filter                                                                    |
| `generateMonthly` keeps **one candidate per resident** ("the most recent billable stay wins")                    | the `byResident` map                                                                                          |
| A resident with two bookings in a month is billed once, at the newest booking's price                            | same map; no test covered it                                                                                  |

Consequences: a wrongly issued invoice cannot be corrected by void and reissue, which is the normal remedy; and a
resident who moves between beds mid-month is billed for one of the two bookings only.

## 2. Proposed model

An invoice is **active** unless it is `CANCELLED`. Uniqueness applies to active invoices only, and its key is the
booking, not the resident.

| Rule                                                             | Mechanism                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| At most one active invoice per **booking** per month             | partial unique index `(organization_id, booking_id, period_start) WHERE status <> 'CANCELLED' AND booking_id IS NOT NULL` |
| Legacy invoices with no booking keep the old resident-level rule | partial unique index `(organization_id, resident_id, period_start) WHERE status <> 'CANCELLED' AND booking_id IS NULL`    |
| Any number of voided invoices may exist for a booking-month      | excluded from both indexes                                                                                                |
| Void is terminal                                                 | unchanged: the guard trigger forbids leaving `CANCELLED`, so a voided invoice can never become active again and collide   |
| Numbers stay unique and are never reused                         | unchanged: `(organization_id, number)` unique; a replacement gets a new number, the voided number stays in history        |
| Resident-month lookups stay fast                                 | a plain index `(organization_id, resident_id, period_start)` replaces the dropped unique one                              |

Historical invoices, void records, payments and audit events are not touched; nothing is rewritten or deleted.

## 3. The exact SQL (not executed)

```sql
-- phase-scope: slice-3.8   (proposed; needs a slice entry, an approval and a scope-register section)
-- Invoice uniqueness: one ACTIVE invoice per booking per month; voided invoices free their slot.
-- Fail-closed pre-flight: the new rules are weaker than the old one, so existing data cannot violate them,
-- but the check is kept so a future change of the data cannot slip through.

DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM "invoices" WHERE "status" <> 'CANCELLED' AND "booking_id" IS NOT NULL
      GROUP BY "organization_id", "booking_id", "period_start" HAVING count(*) > 1
    UNION ALL
    SELECT 1 FROM "invoices" WHERE "status" <> 'CANCELLED' AND "booking_id" IS NULL
      GROUP BY "organization_id", "resident_id", "period_start" HAVING count(*) > 1
  ) x;
  IF bad > 0 THEN
    RAISE EXCEPTION 'active invoices would violate the new uniqueness rules (%), migration aborted without changes', bad;
  END IF;
END $$;

CREATE UNIQUE INDEX "invoices_active_booking_period_key"
  ON "invoices" ("organization_id", "booking_id", "period_start")
  WHERE "status" <> 'CANCELLED' AND "booking_id" IS NOT NULL;

CREATE UNIQUE INDEX "invoices_active_resident_period_legacy_key"
  ON "invoices" ("organization_id", "resident_id", "period_start")
  WHERE "status" <> 'CANCELLED' AND "booking_id" IS NULL;

CREATE INDEX "invoices_organization_id_resident_id_period_start_idx"
  ON "invoices" ("organization_id", "resident_id", "period_start");

DROP INDEX "invoices_organization_id_resident_id_period_start_key";
```

The new unique indexes are created **before** the old one is dropped, so there is no moment without a duplicate guard.

## 4. Evidence gathered (scratch only, nothing kept)

Run by `uniq_dryrun.mjs` against `nook_4f1_scratch`, inside `BEGIN … ROLLBACK`, as the migrator role:

| Check                                                                      | Result                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Pre-flight on current data                                                 | 0 violations (4,527 invoices; 2 have no booking; 0 resident-month duplicates) |
| Today: second active invoice, same resident and month                      | refused `23505` (old index)                                                   |
| **Today: replacement after the original is voided**                        | **refused `23505` (old index)**                                               |
| After the proposed SQL: replacement after void                             | accepted                                                                      |
| After: duplicate active invoice, same booking and month                    | refused `23505 invoices_active_booking_period_key`                            |
| After: a second `CANCELLED` invoice, same booking and month                | accepted                                                                      |
| After: a different booking of the same resident, same month                | accepted (its own invoice)                                                    |
| After: duplicate invoice number                                            | refused `23505 invoices_organization_id_number_key`                           |
| After: legacy invoice (no booking), second active, same resident and month | refused `23505 invoices_active_resident_period_legacy_key`                    |
| After: legacy invoice, a `CANCELLED` duplicate                             | accepted                                                                      |
| Void record of the voided invoice                                          | still present                                                                 |
| After `ROLLBACK`                                                           | invoice count (4,527) and index list identical to before                      |

## 5. Service changes (made; uncommitted)

All in `apps/api/src/finance/finance.service.ts` unless stated. Deploy the migration first (section 7).

1. **`generateMonthly`:** key candidates by **booking**, not resident: one candidate per billable stay's booking (a booking has
   at most one admission and one check-in, so one stay).
2. **Existing-invoice lookup:** `findMany({ where: { organizationId, periodStart, status: { not: 'CANCELLED' } }, select: { bookingId, residentId } })`.
   Skip a booking that already has an active invoice, **and** skip a resident who has an active _legacy_ (no-booking) invoice
   for that month, so a legacy invoice is not billed twice.
3. **Response counters:** `eligibleResidents` becomes `eligibleBookings` (keep `eligibleResidents` for one release, it is read by
   `CreateInvoice.tsx`), `skippedExisting` counts bookings.
4. **`createDraft`:** unchanged logic; it already requires a booking, and the P2002 mapping now fires per booking-month.
   Reword the 409 to "An active invoice already exists for this booking and billing period".
5. **Audit:** one `finance.invoice.issued` event per auto-issued invoice stays exactly as is; a replacement is a new invoice
   with its own event, so a void-and-reissue leaves `issued`, `voided`, `issued` on three different targets.
6. **`prisma/schema.prisma`:** remove `@@unique([organizationId, residentId, periodStart])`, add
   `@@index([organizationId, residentId, periodStart])`, regenerate the client. Partial indexes cannot be expressed in the Prisma
   schema, so they live only in SQL (section 7, drift).
7. **Web:** `CreateInvoice.tsx` messages say "bookings" where they say "residents"; the invoice list already shows one row per
   invoice. A resident can now legitimately appear twice in a month.
8. **Scheduler plan** (`TASK_4F3_INVOICE_SCHEDULER_PLAN.md`): "per organization, per resident, per month" becomes "per booking".

## 6. Policy consequences the owner should see

- **Two bookings in one month are two full-month invoices.** A resident who changes bed on the 15th (two bookings) is billed
  the full monthly price of **each** booking for that month: no proration, no merging. If that is not what the hostel wants for
  an internal move, the remedy is an extension or a booking edit, or a credit adjustment on the second invoice. This follows
  directly from the frozen policy and should be confirmed with a real example.
- Overlapping bookings of one resident (two beds at once) are billed independently as well.
- An extension changes the end date of the **same** booking, so it never adds an invoice (tested).
- Legacy invoices without a booking keep the old per-resident rule; a month with an active legacy invoice is not re-billed by
  generation.

## 7. Migration risks and rollback

| Risk                                                                         | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data loss                                                                    | None. No row is changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Locks                                                                        | `CREATE INDEX` (non-concurrent) blocks writes to `invoices` for its duration; at pilot size (thousands of rows) that is milliseconds. For a large table use `CREATE INDEX CONCURRENTLY`, which cannot run inside Prisma's migration transaction and would need a separate step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Window without a guard                                                       | None: new indexes first, old index dropped last, all in one migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Weaker guarantee for legacy rows                                             | By design only for `CANCELLED` ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Prisma drift**                                                             | `prisma migrate dev` would try to remove indexes it does not know. The project uses `migrate deploy` only; keep it that way, and document it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Code deployed before the migration                                           | Degrades safely: the second invoice of a multi-booking month is skipped by `skipDuplicates`, and a reissue gets 409, exactly as today. The reverse (migration first, old code) is also safe: old code never creates duplicates. **Deploy order: migration, then code.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Rollback                                                                     | Forward-only (Prisma has no down migrations). A rollback is a new migration: recreate `invoices_organization_id_resident_id_period_start_key` and drop the three new indexes. It **fails if any month now has two active invoices for one resident (multi-booking) or a reissue happened**: those rows would have to be merged or voided first. So rollback is only clean until the first multi-booking month or reissue exists.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Known gap: legacy and booking invoices can coexist at the database level** | The two partial unique indexes each constrain only their own kind, so direct SQL could insert an active no-booking invoice next to an active booking invoice for the same resident-month (the old resident-level index forbade that). No application path creates a no-booking invoice (`createDraft` requires a booking, generation always sets one), and both `createDraft` and generation refuse or skip a month already billed by an active legacy invoice (tested). The gap did happen once in `nook_layer1_clean` (a direct-SQL insert by the old duplicate test, `INV-2099-9999`). Closing it in the database needs a `BEFORE INSERT OR UPDATE` trigger (new function `finance_check_invoice_slot`): see `TASK_4F_INVOICE_SLOT_TRIGGER_PROPOSAL.md` (proposal only, verified in a rolled-back transaction, not applied). Decision for the owner. |
| Scope guard                                                                  | Slice 3.8 is registered (approver, date, reference) with a `migrationSlices` entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 8. Tests (all passing on `nook_layer1_clean`)

In `apps/api/test/integration/finance.integration.test.ts`; none is `todo` any more:

| Test                                                                                                       | Result on the clean database |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------- |
| a second active invoice for the same booking and month is refused by the API and the database              | pass                         |
| concurrent drafts for one booking and month create exactly one active invoice                              | pass                         |
| void and reissue: replacement accepted, new number, history, void record and audit kept                    | pass                         |
| void and reissue: monthly generation replaces a voided invoice exactly once, idempotently                  | pass                         |
| bed transfer: two bookings of one resident in one month, two separate full-month invoices, once            | pass                         |
| bed transfer, issued: own invoice, audit event and payment trail per booking; voiding one leaves the other | pass                         |
| an approved extension stays on its booking and never creates a second invoice                              | pass                         |
| legacy invoices with no booking keep the per-resident rule and are never billed twice                      | pass                         |

## 9. Status and remaining steps

- Applied only to `nook_layer1_clean`. The existing `nook_4f1_scratch` is untouched (so its finance suite can no longer pass: it
  lacks migrations 3.7-status and 3.8, and may not be cleaned).
- Still needed before any other database: your approval for each target; the production pre-flight (the DO block, read-only);
  deploy order migration then code; slice 3.8 is registered in the scope manifest and register.
- Open design note: the scheduler plan (`TASK_4F3_INVOICE_SCHEDULER_PLAN.md`) must say "per booking" wherever it says "per resident".
