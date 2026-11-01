-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "EnquirySource" AS ENUM ('WEBSITE', 'PHONE_CALL', 'WALK_IN', 'REFERRAL', 'SOCIAL_MEDIA', 'OTHER');

-- CreateTable
CREATE TABLE "enquiries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "preferred_room_type" TEXT,
    "expected_move_in_date" TIMESTAMPTZ(6),
    "expected_duration_of_stay" INTEGER,
    "number_of_occupants" INTEGER,
    "source" "EnquirySource" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "assigned_user_id" UUID,
    "resident_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_follow_ups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enquiry_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notes" TEXT NOT NULL,
    "follow_up_at" TIMESTAMPTZ(6) NOT NULL,
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiry_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enquiries_resident_id_key" ON "enquiries"("resident_id");

-- CreateIndex
CREATE INDEX "enquiries_organization_id_status_idx" ON "enquiries"("organization_id", "status");

-- CreateIndex
CREATE INDEX "enquiries_organization_id_created_at_idx" ON "enquiries"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "enquiry_follow_ups_enquiry_id_follow_up_at_idx" ON "enquiry_follow_ups"("enquiry_id", "follow_up_at");

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "enquiry_follow_ups" ADD CONSTRAINT "enquiry_follow_ups_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiries"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "enquiry_follow_ups" ADD CONSTRAINT "enquiry_follow_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
