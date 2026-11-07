-- phase-scope: slice-3.8
-- Invoice uniqueness: one ACTIVE invoice per booking per billing month; a voided (CANCELLED) invoice frees its slot so a
-- replacement can be issued (void and reissue). Separate bookings of one resident are billed independently.
--
-- Additive in effect: no row is changed or removed. The old resident-level unique index is replaced by weaker, status-aware
-- ones, so existing data cannot violate them; the pre-flight is kept so that a future change of the data cannot slip through.
-- The new unique indexes are created BEFORE the old one is dropped, so there is never a moment without a duplicate guard.
-- Invoices with no booking (legacy) keep the old per-resident rule.

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
