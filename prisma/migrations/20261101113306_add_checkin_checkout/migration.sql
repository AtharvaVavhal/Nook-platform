-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('ACTIVE', 'CHECKED_OUT');

-- CreateTable
CREATE TABLE "check_ins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "check_in_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "CheckInStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_outs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "check_in_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "check_out_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "check_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "check_ins_admission_id_key" ON "check_ins"("admission_id");

-- CreateIndex
CREATE INDEX "check_ins_organization_id_status_idx" ON "check_ins"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "check_outs_check_in_id_key" ON "check_outs"("check_in_id");

-- CreateIndex
CREATE INDEX "check_outs_organization_id_idx" ON "check_outs"("organization_id");

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "check_ins"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
