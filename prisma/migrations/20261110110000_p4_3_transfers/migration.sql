-- P4-3 Transfers migration
-- Creates stay_assignments and transfers tables with constraints, indexes, and immutability triggers

-- Enable btree_gist extension for UUID operator class in GIST indexes
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Enum types
CREATE TYPE "StayAssignmentKind" AS ENUM ('ORIGINAL', 'TRANSFER');
CREATE TYPE "StayAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED');
CREATE TYPE "TransferType" AS ENUM ('ROOM_TRANSFER', 'BED_TRANSFER');

-- transfers table (must be created first because stay_assignments references it)
CREATE TABLE "transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "TransferType" NOT NULL,
    "source_bed_id" UUID NOT NULL,
    "source_room_id" UUID NOT NULL,
    "source_property_id" UUID NOT NULL,
    "destination_bed_id" UUID NOT NULL,
    "destination_room_id" UUID NOT NULL,
    "destination_property_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_role" "MembershipRole" NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- Indexes for transfers
CREATE UNIQUE INDEX "transfers_id_organization_id_key" ON "transfers" ("id", "organization_id");
CREATE UNIQUE INDEX "transfers_organization_id_actor_user_id_idempotency_key_key" ON "transfers" ("organization_id", "actor_user_id", "idempotency_key");
CREATE INDEX "transfers_organization_id_resident_id_recorded_at_idx" ON "transfers" ("organization_id", "resident_id", "recorded_at");
CREATE INDEX "transfers_organization_id_booking_id_recorded_at_idx" ON "transfers" ("organization_id", "booking_id", "recorded_at");

-- Foreign keys for transfers
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_resident_id_organization_id_fkey"
    FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_booking_id_organization_id_fkey"
    FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_bed_id_organization_id_fkey"
    FOREIGN KEY ("source_bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_bed_id_organization_id_fkey"
    FOREIGN KEY ("destination_bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Immutability trigger for transfers (append-only)
CREATE OR REPLACE FUNCTION "transfers_immutable_trigger"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'transfers is append-only' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transfers_immutable"
    BEFORE UPDATE OR DELETE ON "transfers"
    FOR EACH ROW EXECUTE FUNCTION "transfers_immutable_trigger"();

-- stay_assignments table
CREATE TABLE "stay_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "kind" "StayAssignmentKind" NOT NULL DEFAULT 'ORIGINAL',
    "status" "StayAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6),
    "transfer_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "stay_assignments_pkey" PRIMARY KEY ("id")
);

-- Indexes for stay_assignments
CREATE UNIQUE INDEX "stay_assignments_id_organization_id_key" ON "stay_assignments" ("id", "organization_id");
CREATE INDEX "stay_assignments_organization_id_booking_id_start_at_idx" ON "stay_assignments" ("organization_id", "booking_id", "start_at");
CREATE INDEX "stay_assignments_organization_id_bed_id_start_at_end_at_idx" ON "stay_assignments" ("organization_id", "bed_id", "start_at", "end_at");

-- Exclusion constraint to prevent overlapping assignments on the same bed
ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_no_overlap_excl"
    EXCLUDE USING GIST (
        "bed_id" WITH =,
        "organization_id" WITH =,
        tstzrange("start_at", "end_at", '[)') WITH &&
    ) WHERE ("status" = 'ACTIVE');

-- CHECK constraints for stay_assignments
ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_valid_interval_check"
    CHECK ("end_at" IS NULL OR "end_at" > "start_at");

ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_transfer_link_check"
    CHECK ("kind" <> 'TRANSFER' OR "transfer_id" IS NOT NULL);

ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_state_consistency_check"
    CHECK (
        ("status" = 'ACTIVE' AND "end_at" IS NULL) OR
        ("status" = 'COMPLETED' AND "end_at" IS NOT NULL)
    );

-- Foreign keys for stay_assignments
ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_booking_id_organization_id_fkey"
    FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_resident_id_organization_id_fkey"
    FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_bed_id_organization_id_fkey"
    FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "stay_assignments" ADD CONSTRAINT "stay_assignments_transfer_id_organization_id_fkey"
    FOREIGN KEY ("transfer_id", "organization_id") REFERENCES "transfers"("id", "organization_id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- Partial unique index for exactly one original assignment per booking
CREATE UNIQUE INDEX "stay_assignments_original_per_booking_uq" ON "stay_assignments" ("organization_id", "booking_id", "kind")
    WHERE "kind" = 'ORIGINAL';

-- Immutability trigger for stay_assignments
CREATE OR REPLACE FUNCTION "stay_assignments_immutable_trigger"() RETURNS trigger AS $$
BEGIN
    -- Prevent updates to COMPLETED assignments
    IF OLD."status" = 'COMPLETED' THEN
        RAISE EXCEPTION 'completed stay assignments cannot change' USING ERRCODE = '23001';
    END IF;
    -- Prevent changes to immutable fields
    IF OLD."id" IS DISTINCT FROM NEW."id" OR
       OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR
       OLD."booking_id" IS DISTINCT FROM NEW."booking_id" OR
       OLD."resident_id" IS DISTINCT FROM NEW."resident_id" OR
       OLD."bed_id" IS DISTINCT FROM NEW."bed_id" OR
       OLD."kind" IS DISTINCT FROM NEW."kind" OR
       OLD."start_at" IS DISTINCT FROM NEW."start_at" OR
       OLD."created_at" IS DISTINCT FROM NEW."created_at"
    THEN
        RAISE EXCEPTION 'immutable fields cannot change' USING ERRCODE = '23001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stay_assignments_immutable"
    BEFORE UPDATE ON "stay_assignments"
    FOR EACH ROW EXECUTE FUNCTION "stay_assignments_immutable_trigger"();

CREATE TRIGGER "stay_assignments_no_delete"
    BEFORE DELETE ON "stay_assignments"
    FOR EACH ROW EXECUTE FUNCTION "stay_assignments_immutable_trigger"();