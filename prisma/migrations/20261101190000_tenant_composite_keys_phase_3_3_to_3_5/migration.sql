-- Tenant integrity for Phases 3.3-3.5: make the database itself refuse cross-organization links.
--
-- Every relation below changes from  child.parent_id -> parent.id  to
-- (child.parent_id, child.organization_id) -> (parent.id, parent.organization_id), all ON DELETE/UPDATE RESTRICT.
-- A composite key implies the old single-column one, so no protection is weakened: each new composite FK is
-- ADDED FIRST, and only then is the (now redundant) single-column FK dropped. Prisma cannot model two foreign
-- keys on the same columns, which is why the old ones are dropped rather than kept alongside.
-- No table, column or row is touched. Admission -> Property/Room are intentionally left as they are (SET NULL).

-- Fail closed: if any row already links across organizations, stop and report. Nothing is repaired here.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(rel || '=' || n, ', ') INTO bad FROM (SELECT 'bookings.resident_id -> residents' AS rel, count(*) AS n FROM bookings x JOIN residents y ON y.id = x.resident_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'bookings.bed_id -> beds' AS rel, count(*) AS n FROM bookings x JOIN beds y ON y.id = x.bed_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'admissions.booking_id -> bookings' AS rel, count(*) AS n FROM admissions x JOIN bookings y ON y.id = x.booking_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'admissions.resident_id -> residents' AS rel, count(*) AS n FROM admissions x JOIN residents y ON y.id = x.resident_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'admissions.bed_id -> beds' AS rel, count(*) AS n FROM admissions x JOIN beds y ON y.id = x.bed_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'check_ins.admission_id -> admissions' AS rel, count(*) AS n FROM check_ins x JOIN admissions y ON y.id = x.admission_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'check_ins.resident_id -> residents' AS rel, count(*) AS n FROM check_ins x JOIN residents y ON y.id = x.resident_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'check_ins.bed_id -> beds' AS rel, count(*) AS n FROM check_ins x JOIN beds y ON y.id = x.bed_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'check_ins.booking_id -> bookings' AS rel, count(*) AS n FROM check_ins x JOIN bookings y ON y.id = x.booking_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'check_outs.check_in_id -> check_ins' AS rel, count(*) AS n FROM check_outs x JOIN check_ins y ON y.id = x.check_in_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'check_outs.resident_id -> residents' AS rel, count(*) AS n FROM check_outs x JOIN residents y ON y.id = x.resident_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'check_outs.bed_id -> beds' AS rel, count(*) AS n FROM check_outs x JOIN beds y ON y.id = x.bed_id WHERE y.organization_id <> x.organization_id UNION ALL SELECT 'check_outs.booking_id -> bookings' AS rel, count(*) AS n FROM check_outs x JOIN bookings y ON y.id = x.booking_id WHERE y.organization_id <> x.organization_id) v WHERE n > 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'cross-organization rows exist, migration aborted without changes: %', bad;
  END IF;
END $$;

-- Parent keys required as composite foreign-key targets
CREATE UNIQUE INDEX "admissions_id_organization_id_key" ON "admissions"("id", "organization_id");
CREATE UNIQUE INDEX "admissions_booking_id_organization_id_key" ON "admissions"("booking_id", "organization_id");
CREATE UNIQUE INDEX "beds_id_organization_id_key" ON "beds"("id", "organization_id");
CREATE UNIQUE INDEX "check_ins_id_organization_id_key" ON "check_ins"("id", "organization_id");
CREATE UNIQUE INDEX "check_ins_admission_id_organization_id_key" ON "check_ins"("admission_id", "organization_id");
CREATE UNIQUE INDEX "check_outs_check_in_id_organization_id_key" ON "check_outs"("check_in_id", "organization_id");

-- New composite foreign keys
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resident_id_organization_id_fkey" FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bed_id_organization_id_fkey" FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_booking_id_organization_id_fkey" FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_resident_id_organization_id_fkey" FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_bed_id_organization_id_fkey" FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_admission_id_organization_id_fkey" FOREIGN KEY ("admission_id", "organization_id") REFERENCES "admissions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_resident_id_organization_id_fkey" FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_bed_id_organization_id_fkey" FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_booking_id_organization_id_fkey" FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_check_in_id_organization_id_fkey" FOREIGN KEY ("check_in_id", "organization_id") REFERENCES "check_ins"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_resident_id_organization_id_fkey" FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_bed_id_organization_id_fkey" FOREIGN KEY ("bed_id", "organization_id") REFERENCES "beds"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_booking_id_organization_id_fkey" FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Superseded single-column foreign keys (each is implied by the composite one added above)
ALTER TABLE "admissions" DROP CONSTRAINT "admissions_bed_id_fkey";
ALTER TABLE "admissions" DROP CONSTRAINT "admissions_booking_id_fkey";
ALTER TABLE "admissions" DROP CONSTRAINT "admissions_resident_id_fkey";
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_bed_id_fkey";
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_resident_id_fkey";
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_admission_id_fkey";
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_bed_id_fkey";
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_booking_id_fkey";
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_resident_id_fkey";
ALTER TABLE "check_outs" DROP CONSTRAINT "check_outs_bed_id_fkey";
ALTER TABLE "check_outs" DROP CONSTRAINT "check_outs_booking_id_fkey";
ALTER TABLE "check_outs" DROP CONSTRAINT "check_outs_check_in_id_fkey";
ALTER TABLE "check_outs" DROP CONSTRAINT "check_outs_resident_id_fkey";
