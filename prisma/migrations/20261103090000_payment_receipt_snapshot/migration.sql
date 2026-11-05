-- phase-scope: slice-3.7
-- Payment receipt snapshot. Additive: two nullable columns, three CHECK constraints and one insert trigger.
-- Existing payments keep NULL in both columns: payments are immutable (payments_immutable), so they cannot be
-- back-filled, and no historical value is invented. The application shows such rows as "derived".
--
-- The database computes the snapshot itself, under the invoice row lock, and overwrites anything a client supplies.
-- Correctness depends on the application inserting the payment BEFORE it updates invoices.paid_amount, which is the
-- order FinanceService.recordPayment uses (pinned by an integration test).

ALTER TABLE "payments"
  ADD COLUMN "credit_total_at_payment" DECIMAL(12,2),
  ADD COLUMN "balance_after_payment"   DECIMAL(12,2);

ALTER TABLE "payments" ADD CONSTRAINT "payments_snapshot_complete"
  CHECK (num_nonnulls("credit_total_at_payment", "balance_after_payment") IN (0, 2));
ALTER TABLE "payments" ADD CONSTRAINT "payments_snapshot_credit_valid"
  CHECK ("credit_total_at_payment" IS NULL OR "credit_total_at_payment" <= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_snapshot_balance_valid"
  CHECK ("balance_after_payment" IS NULL OR "balance_after_payment" >= 0);

CREATE FUNCTION "finance_snapshot_payment"() RETURNS trigger AS $$
DECLARE inv RECORD;
BEGIN
  SELECT "status", "amount", "paid_amount", "adjustment_total" INTO inv
    FROM "invoices"
   WHERE "id" = NEW."invoice_id" AND "organization_id" = NEW."organization_id"
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment references an unknown invoice' USING ERRCODE = '23503';
  END IF;
  IF inv."status" IN ('DRAFT', 'CANCELLED') THEN
    RAISE EXCEPTION 'payments cannot be recorded against a % invoice', lower(inv."status"::text)
      USING ERRCODE = '23514';
  END IF;
  NEW."credit_total_at_payment" := inv."adjustment_total";
  NEW."balance_after_payment"   := inv."amount" - inv."paid_amount" - NEW."amount";
  IF NEW."balance_after_payment" < 0 THEN
    RAISE EXCEPTION 'payment exceeds the invoice balance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payments_snapshot" BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "finance_snapshot_payment"();
