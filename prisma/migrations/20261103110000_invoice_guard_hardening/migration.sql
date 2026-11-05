-- phase-scope: slice-3.7
-- Invoice guard hardening. Fails closed: if any existing row is inconsistent the migration aborts without
-- changes and repairs nothing. The invoices_guard trigger object is unchanged; only the function body is replaced,
-- so nothing is dropped. Legacy CANCELLED invoices (no void record) are kept as they are and become frozen.

DO $$
DECLARE bad text;
BEGIN
  SELECT concat_ws(', ',
    CASE WHEN a > 0 THEN 'issued/paid invoices without issued_at=' || a END,
    CASE WHEN b > 0 THEN 'DRAFT invoices with issued_at=' || b END,
    CASE WHEN c > 0 THEN 'CANCELLED invoices holding cash or credits=' || c END)
  INTO bad
  FROM (SELECT
    (SELECT count(*) FROM "invoices" WHERE "status" NOT IN ('DRAFT', 'CANCELLED') AND "issued_at" IS NULL) a,
    (SELECT count(*) FROM "invoices" WHERE "status" = 'DRAFT' AND "issued_at" IS NOT NULL) b,
    (SELECT count(*) FROM "invoices" WHERE "status" = 'CANCELLED' AND ("paid_amount" <> 0 OR "adjustment_total" <> 0)) c
  ) v;
  IF bad IS NOT NULL AND bad <> '' THEN
    RAISE EXCEPTION 'inconsistent invoices exist, migration aborted without changes: %', bad;
  END IF;
END $$;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_at_consistent"
  CHECK ("status" = 'CANCELLED' OR (("status" = 'DRAFT') = ("issued_at" IS NULL)));

CREATE OR REPLACE FUNCTION "finance_guard_invoice"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices cannot be deleted; void instead' USING ERRCODE = '23001';
  END IF;

  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'a voided invoice cannot be changed' USING ERRCODE = '23001';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" IN ('ISSUED', 'CANCELLED'))
    OR (OLD."status" IN ('ISSUED', 'OVERDUE', 'PARTIALLY_PAID', 'PAID')
        AND NEW."status" IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid invoice status transition % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23001';
  END IF;

  IF NEW."status" = 'CANCELLED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "invoice_voids" v
       WHERE v."invoice_id" = OLD."id" AND v."organization_id" = OLD."organization_id"
    ) THEN
      RAISE EXCEPTION 'an invoice can only be cancelled by recording a void' USING ERRCODE = '23001';
    END IF;
    IF NEW."paid_amount" <> 0 OR NEW."adjustment_total" <> 0 THEN
      RAISE EXCEPTION 'an invoice with settled money or credits cannot be voided' USING ERRCODE = '23001';
    END IF;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ISSUED' AND NEW."issued_at" IS NULL THEN
    RAISE EXCEPTION 'issuing an invoice requires issued_at' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'DRAFT' AND (
       NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."resident_id" IS DISTINCT FROM OLD."resident_id"
    OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"
    OR NEW."period_start" IS DISTINCT FROM OLD."period_start"
    OR NEW."period_end" IS DISTINCT FROM OLD."period_end"
    OR NEW."due_date" IS DISTINCT FROM OLD."due_date"
    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
    OR NEW."notes" IS DISTINCT FROM OLD."notes"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'issued invoice identity, amount, dates and notes are immutable' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
