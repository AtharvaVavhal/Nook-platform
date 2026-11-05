-- phase-scope: slice-3.7
-- Invoice status consistency. Adds one row-local CHECK so the stored status can never contradict the amounts.
-- Additive and fail-closed: if any existing row would violate the rule the migration aborts without changes and
-- repairs nothing. No function, trigger, column or data is touched, and no row is rewritten.
--
-- Rule, for every status except DRAFT and CANCELLED (those are governed by their own constraints and the guard):
--   PAID            paid_amount = amount                          (settled by cash and/or credits)
--   PARTIALLY_PAID  paid_amount < amount AND cash > 0             (cash = paid_amount + adjustment_total)
--   ISSUED          paid_amount < amount AND cash = 0             (includes credit-only partial settlement)
--   OVERDUE         paid_amount < amount                          (legacy label: the application never stores it)

DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM "invoices"
   WHERE NOT (
        "status" IN ('DRAFT', 'CANCELLED')
     OR ("status" = 'PAID' AND "paid_amount" = "amount")
     OR ("status" = 'PARTIALLY_PAID' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" > 0)
     OR ("status" = 'ISSUED' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" <= 0)
     OR ("status" = 'OVERDUE' AND "paid_amount" < "amount")
   );
  IF bad > 0 THEN
    RAISE EXCEPTION 'invoices whose status contradicts their amounts exist (%), migration aborted without changes', bad;
  END IF;
END $$;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_matches_amounts" CHECK (
     "status" IN ('DRAFT', 'CANCELLED')
  OR ("status" = 'PAID' AND "paid_amount" = "amount")
  OR ("status" = 'PARTIALLY_PAID' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" > 0)
  OR ("status" = 'ISSUED' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" <= 0)
  OR ("status" = 'OVERDUE' AND "paid_amount" < "amount")
);
