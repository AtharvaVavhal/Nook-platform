-- phase-scope: slice-3.7
-- Invoice void record. Additive: one new table, its constraints and two triggers. No existing object is altered.
-- A void is an append-only row; the invoice moves to the existing CANCELLED status in the same transaction.
-- Payments, reversals and adjustments are never touched.

CREATE TABLE "invoice_voids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "previous_status" "InvoiceStatus" NOT NULL,
    "amount_at_void" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "voided_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_voids_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_voids_invoice_id_key" ON "invoice_voids"("invoice_id");
CREATE INDEX "invoice_voids_organization_id_created_at_idx" ON "invoice_voids"("organization_id", "created_at");

ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_invoice_id_organization_id_resident_id_fkey"
  FOREIGN KEY ("invoice_id", "organization_id", "resident_id")
  REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_voided_by_fkey"
  FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_reason_present"
  CHECK (length(btrim("reason")) BETWEEN 3 AND 500);
ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_amount_positive" CHECK ("amount_at_void" > 0);
ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_previous_status_open"
  CHECK ("previous_status" <> 'CANCELLED');

-- Append-only, reusing the function created by the financial corrections migration.
CREATE TRIGGER "invoice_voids_immutable" BEFORE UPDATE OR DELETE ON "invoice_voids"
  FOR EACH ROW EXECUTE FUNCTION "finance_forbid_correction_change"();

-- The database, not the caller, decides whether a void is allowed and records what was voided.
CREATE FUNCTION "finance_check_void"() RETURNS trigger AS $$
DECLARE inv RECORD;
BEGIN
  SELECT "status", "amount", "paid_amount", "adjustment_total" INTO inv
    FROM "invoices"
   WHERE "id" = NEW."invoice_id" AND "organization_id" = NEW."organization_id"
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void references an unknown invoice' USING ERRCODE = '23503';
  END IF;
  IF inv."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'invoice is already voided' USING ERRCODE = '23505';
  END IF;
  IF inv."paid_amount" <> 0 OR inv."adjustment_total" <> 0 THEN
    RAISE EXCEPTION 'an invoice with settled money or credits cannot be voided; reverse its payments first'
      USING ERRCODE = '23514';
  END IF;
  NEW."previous_status" := inv."status";
  NEW."amount_at_void"  := inv."amount";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_voids_check" BEFORE INSERT ON "invoice_voids"
  FOR EACH ROW EXECUTE FUNCTION "finance_check_void"();
