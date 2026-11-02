-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "booking_id" UUID,
    "number" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "due_date" DATE NOT NULL,
    "issued_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_organization_id_status_due_date_idx" ON "invoices"("organization_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "invoices_organization_id_period_start_idx" ON "invoices"("organization_id", "period_start");

-- CreateIndex
CREATE INDEX "invoices_resident_id_organization_id_idx" ON "invoices"("resident_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_number_key" ON "invoices"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_resident_id_period_start_key" ON "invoices"("organization_id", "resident_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_organization_id_resident_id_key" ON "invoices"("id", "organization_id", "resident_id");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_received_at_idx" ON "payments"("organization_id", "received_at");

-- CreateIndex
CREATE INDEX "payments_resident_id_organization_id_idx" ON "payments"("resident_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_id_organization_id_key" ON "bookings"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "residents_id_organization_id_key" ON "residents"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_resident_id_organization_id_fkey" FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_organization_id_fkey" FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_resident_id_organization_id_fkey" FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_organization_id_resident_id_fkey" FOREIGN KEY ("invoice_id", "organization_id", "resident_id") REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Integrity checks (not expressible in Prisma schema)
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_within_amount" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "amount");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_period_valid" CHECK ("period_end" >= "period_start");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_due_after_period_start" CHECK ("due_date" >= "period_start");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_status_consistent" CHECK ("status" <> 'PAID' OR "paid_amount" = "amount");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_draft_unpaid" CHECK ("status" <> 'DRAFT' OR "paid_amount" = 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_format" CHECK ("number" ~ '^INV-[0-9]{4}-[0-9]{4,}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- Financial history is append-only: payments can never be updated or deleted,
-- invoices can never be deleted, and an issued invoice's identity and amount are frozen.
CREATE FUNCTION "finance_forbid_payment_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payments are immutable; record an adjustment instead' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payments_immutable" BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "finance_forbid_payment_change"();

CREATE FUNCTION "finance_guard_invoice"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices cannot be deleted; cancel instead' USING ERRCODE = '23001';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
       NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."resident_id" IS DISTINCT FROM OLD."resident_id"
    OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"
    OR NEW."period_start" IS DISTINCT FROM OLD."period_start"
    OR NEW."period_end" IS DISTINCT FROM OLD."period_end"
  ) THEN
    RAISE EXCEPTION 'issued invoice identity and amount are immutable' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoices_guard" BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "finance_guard_invoice"();
