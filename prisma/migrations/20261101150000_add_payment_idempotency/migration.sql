-- Additive: database-backed idempotency for payment creation. No existing object is altered or dropped.

-- Enables a tenant-safe composite foreign key from the idempotency table to payments.
CREATE UNIQUE INDEX "payments_id_organization_id_key" ON "payments"("id", "organization_id");

CREATE TABLE "payment_idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_idempotency_keys_organization_id_key_key" ON "payment_idempotency_keys"("organization_id", "key");
CREATE UNIQUE INDEX "payment_idempotency_keys_payment_id_key" ON "payment_idempotency_keys"("payment_id");

ALTER TABLE "payment_idempotency_keys" ADD CONSTRAINT "payment_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_idempotency_keys" ADD CONSTRAINT "payment_idempotency_keys_payment_id_organization_id_fkey" FOREIGN KEY ("payment_id", "organization_id") REFERENCES "payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "payment_idempotency_keys" ADD CONSTRAINT "payment_idempotency_keys_key_format_check" CHECK ("key" ~ '^[A-Za-z0-9_.:-]{8,128}$');
ALTER TABLE "payment_idempotency_keys" ADD CONSTRAINT "payment_idempotency_keys_hash_format_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

-- Keys are never edited or removed, so a replay always finds the original result.
CREATE FUNCTION "finance_forbid_idempotency_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment idempotency keys are append-only' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_idempotency_keys_immutable" BEFORE UPDATE OR DELETE ON "payment_idempotency_keys"
  FOR EACH ROW EXECUTE FUNCTION "finance_forbid_idempotency_change"();
