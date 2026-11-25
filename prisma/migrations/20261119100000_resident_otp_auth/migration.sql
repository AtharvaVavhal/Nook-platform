-- phase-scope: slice-5.1
-- Resident authentication foundation: owner-provisioned portal accounts, phone-OTP challenges, resident-only sessions and
-- their own rate-limit table. Additive only: no existing table, column or constraint is changed.
CREATE TYPE "ResidentAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

CREATE TABLE "resident_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "status" "ResidentAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "suspended_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    CONSTRAINT "resident_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resident_accounts_phone_format" CHECK ("phone_e164" ~ '^\+91[6-9][0-9]{9}$'),
    CONSTRAINT "resident_accounts_state_consistency" CHECK (
      ("status" = 'REVOKED') = ("revoked_at" IS NOT NULL) AND ("status" = 'SUSPENDED') = ("suspended_at" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "resident_accounts_id_organization_id_key" ON "resident_accounts"("id", "organization_id");
CREATE INDEX "resident_accounts_organization_id_resident_id_idx" ON "resident_accounts"("organization_id", "resident_id");
-- One non-revoked account per resident, and one non-revoked account per phone number (a number must resolve to a single identity).
CREATE UNIQUE INDEX "resident_accounts_one_open_per_resident" ON "resident_accounts"("resident_id") WHERE "status" <> 'REVOKED';
CREATE UNIQUE INDEX "resident_accounts_one_open_per_phone" ON "resident_accounts"("phone_e164") WHERE "status" <> 'REVOKED';
ALTER TABLE "resident_accounts" ADD CONSTRAINT "resident_accounts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "resident_accounts" ADD CONSTRAINT "resident_accounts_resident_id_organization_id_fkey"
    FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "resident_accounts" ADD CONSTRAINT "resident_accounts_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- An account belongs to one resident of one organization for its whole life.
CREATE FUNCTION resident_accounts_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resident_id IS DISTINCT FROM OLD.resident_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'a resident account cannot be moved to another resident or organization' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER resident_accounts_identity_immutable
  BEFORE UPDATE ON "resident_accounts"
  FOR EACH ROW EXECUTE FUNCTION resident_accounts_identity_immutable();

CREATE TABLE "resident_otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resident_account_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "invalidated_at" TIMESTAMPTZ(6),
    "invalidated_reason" TEXT,
    "delivery_status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resident_otp_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resident_otp_challenges_hash_format" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "resident_otp_challenges_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 10 AND "attempts" <= "max_attempts"),
    CONSTRAINT "resident_otp_challenges_delivery_check" CHECK ("delivery_status" IN ('PENDING', 'SENT', 'FAILED'))
);
CREATE INDEX "resident_otp_challenges_resident_account_id_created_at_idx" ON "resident_otp_challenges"("resident_account_id", "created_at");
CREATE INDEX "resident_otp_challenges_expires_at_idx" ON "resident_otp_challenges"("expires_at");
-- At most one live challenge per account: issuing a new one must invalidate the previous one in the same transaction.
CREATE UNIQUE INDEX "resident_otp_challenges_one_live_per_account" ON "resident_otp_challenges"("resident_account_id")
    WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL;
ALTER TABLE "resident_otp_challenges" ADD CONSTRAINT "resident_otp_challenges_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "resident_otp_challenges" ADD CONSTRAINT "resident_otp_challenges_account_organization_fkey"
    FOREIGN KEY ("resident_account_id", "organization_id") REFERENCES "resident_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "resident_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "resident_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    CONSTRAINT "resident_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "resident_sessions_token_hash_key" ON "resident_sessions"("token_hash");
CREATE INDEX "resident_sessions_resident_account_id_idx" ON "resident_sessions"("resident_account_id");
CREATE INDEX "resident_sessions_idle_expires_at_idx" ON "resident_sessions"("idle_expires_at");
ALTER TABLE "resident_sessions" ADD CONSTRAINT "resident_sessions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "resident_sessions" ADD CONSTRAINT "resident_sessions_account_organization_fkey"
    FOREIGN KEY ("resident_account_id", "organization_id") REFERENCES "resident_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "resident_auth_throttles" (
    "scope" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resident_auth_throttles_pkey" PRIMARY KEY ("scope", "key_hash"),
    CONSTRAINT "resident_auth_throttles_scope_valid" CHECK ("scope" IN
      ('OTP_REQUEST_PHONE', 'OTP_REQUEST_ADDRESS', 'OTP_COOLDOWN_PHONE', 'OTP_VERIFY_PHONE', 'OTP_VERIFY_ADDRESS'))
);
CREATE INDEX "resident_auth_throttles_locked_until_idx" ON "resident_auth_throttles"("locked_until");
