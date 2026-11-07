-- Additive: auditable financial corrections (payment reversals, invoice credits, replacement payments).
-- No existing constraint, trigger, row or column is altered or dropped.

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "adjustment_total" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "corrects_payment_id" UUID;

-- CreateTable
CREATE TABLE "payment_reversals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "reversed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_reversals_invoice_id_idx" ON "payment_reversals"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_reversals_organization_id_created_at_idx" ON "payment_reversals"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reversals_payment_id_key" ON "payment_reversals"("payment_id");

-- CreateIndex
CREATE INDEX "invoice_adjustments_invoice_id_idx" ON "invoice_adjustments"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_adjustments_organization_id_created_at_idx" ON "invoice_adjustments"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_invoice_id_organization_id_key" ON "payments"("id", "invoice_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_corrects_payment_id_key" ON "payments"("corrects_payment_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_corrects_payment_id_organization_id_fkey" FOREIGN KEY ("corrects_payment_id", "organization_id") REFERENCES "payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_payment_id_invoice_id_organization_id_fkey" FOREIGN KEY ("payment_id", "invoice_id", "organization_id") REFERENCES "payments"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_invoice_id_organization_id_resident_id_fkey" FOREIGN KEY ("invoice_id", "organization_id", "resident_id") REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Integrity checks (not expressible in Prisma schema)
-- Credits only: stored negative, never more than the invoice amount, and cash received (settled
-- amount less credits) can never go negative.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_adjustment_total_valid" CHECK ("adjustment_total" <= 0 AND "adjustment_total" >= -"amount");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cash_received_non_negative" CHECK ("paid_amount" + "adjustment_total" >= 0);
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_credit_only" CHECK ("amount" < 0);
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_reason_present" CHECK (length(btrim("reason")) BETWEEN 3 AND 500);
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_reason_present" CHECK (length(btrim("reason")) BETWEEN 3 AND 500);

-- Corrections are append-only history: never edited, never deleted.
CREATE FUNCTION "finance_forbid_correction_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'financial corrections are append-only' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_reversals_immutable" BEFORE UPDATE OR DELETE ON "payment_reversals"
  FOR EACH ROW EXECUTE FUNCTION "finance_forbid_correction_change"();
CREATE TRIGGER "invoice_adjustments_immutable" BEFORE UPDATE OR DELETE ON "invoice_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "finance_forbid_correction_change"();

-- A replacement payment may only correct a payment that is already reversed, on the same invoice.
CREATE FUNCTION "finance_check_payment_correction"() RETURNS trigger AS $$
BEGIN
  IF NEW."corrects_payment_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "payment_reversals" r
    WHERE r."payment_id" = NEW."corrects_payment_id"
      AND r."organization_id" = NEW."organization_id"
      AND r."invoice_id" = NEW."invoice_id"
  ) THEN
    RAISE EXCEPTION 'a payment can only correct a reversed payment on the same invoice' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payments_check_correction" BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "finance_check_payment_correction"();
