-- phase-scope: slice-2.2
-- This reviewed migration was prepared without executing Prisma or PostgreSQL.

CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'PROPERTY_MANAGER');
CREATE TYPE "BedOperationalStatus" AS ENUM ('IN_SERVICE', 'OUT_OF_SERVICE');

CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "login_identifier" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "floors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "floor_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "beds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "operational_status" "BedOperationalStatus" NOT NULL DEFAULT 'IN_SERVICE',
    "out_of_service_reason" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "active_organization_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "request_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_code" TEXT,
    "metadata" JSONB NOT NULL,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_login_identifier_key" ON "users"("login_identifier");
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE UNIQUE INDEX "properties_id_organization_id_key" ON "properties"("id", "organization_id");
CREATE UNIQUE INDEX "floors_id_property_id_organization_id_key" ON "floors"("id", "property_id", "organization_id");
CREATE UNIQUE INDEX "rooms_id_property_id_organization_id_key" ON "rooms"("id", "property_id", "organization_id");

CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_idle_expires_at_idx" ON "sessions"("idle_expires_at");
CREATE INDEX "audit_events_organization_id_occurred_at_idx" ON "audit_events"("organization_id", "occurred_at");
CREATE INDEX "floors_property_id_organization_id_idx" ON "floors"("property_id", "organization_id");
CREATE INDEX "rooms_floor_id_property_id_organization_id_idx" ON "rooms"("floor_id", "property_id", "organization_id");
CREATE INDEX "beds_room_id_property_id_organization_id_idx" ON "beds"("room_id", "property_id", "organization_id");

CREATE UNIQUE INDEX "properties_organization_id_code_active_key"
    ON "properties"("organization_id", "code")
    WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "floors_property_id_ordinal_active_key"
    ON "floors"("property_id", "ordinal")
    WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "floors_property_id_label_active_key"
    ON "floors"("property_id", "label")
    WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "rooms_property_id_label_active_key"
    ON "rooms"("property_id", "label")
    WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "beds_room_id_label_active_key"
    ON "beds"("room_id", "label")
    WHERE "archived_at" IS NULL;

ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "properties"
    ADD CONSTRAINT "properties_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "floors"
    ADD CONSTRAINT "floors_property_id_organization_id_fkey"
    FOREIGN KEY ("property_id", "organization_id")
    REFERENCES "properties"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "rooms"
    ADD CONSTRAINT "rooms_floor_id_property_id_organization_id_fkey"
    FOREIGN KEY ("floor_id", "property_id", "organization_id")
    REFERENCES "floors"("id", "property_id", "organization_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "beds"
    ADD CONSTRAINT "beds_room_id_property_id_organization_id_fkey"
    FOREIGN KEY ("room_id", "property_id", "organization_id")
    REFERENCES "rooms"("id", "property_id", "organization_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_active_organization_id_user_id_fkey"
    FOREIGN KEY ("active_organization_id", "user_id")
    REFERENCES "memberships"("organization_id", "user_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "audit_events"
    ADD CONSTRAINT "audit_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "audit_events"
    ADD CONSTRAINT "audit_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
