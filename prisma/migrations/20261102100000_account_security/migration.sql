-- Account security: persistent sign-in throttling and a "must change password" flag. Additive only.

-- A temporary password (operator provisioning or reset) forces the user to choose their own on first sign-in.
ALTER TABLE "users" ADD COLUMN "password_change_required" BOOLEAN NOT NULL DEFAULT false;

-- Failure counters survive restarts. Keys are SHA-256 hashes of the identifier or address, never the raw value.
CREATE TABLE "login_throttles" (
    "scope" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("scope", "key_hash")
);

CREATE INDEX "login_throttles_locked_until_idx" ON "login_throttles"("locked_until");

ALTER TABLE "login_throttles" ADD CONSTRAINT "login_throttles_scope_valid" CHECK ("scope" IN ('IDENTIFIER', 'ADDRESS', 'PASSWORD'));
ALTER TABLE "login_throttles" ADD CONSTRAINT "login_throttles_key_hash_format" CHECK ("key_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "login_throttles" ADD CONSTRAINT "login_throttles_failures_non_negative" CHECK ("failures" >= 0);
