-- Tenant and lifecycle integrity enforced by the database itself. Additive: only functions and
-- triggers are created; no table, column, constraint or row is altered or dropped, and the existing
-- foreign keys (including ON DELETE SET NULL for admissions.property_id / room_id) are unchanged.
--
-- Why triggers: admissions.property_id / room_id are nullable with ON DELETE SET NULL, which a composite
-- foreign key cannot express (it would try to null the NOT NULL organization_id). A trigger adds the
-- missing ownership checks while keeping those delete semantics intact.

-- Fail closed: if any existing row would violate these rules, stop and report. Nothing is repaired here.
DO $$
DECLARE bad text;
BEGIN
  SELECT concat_ws(', ',
    CASE WHEN a1 > 0 THEN 'admissions.property_id(other org)=' || a1 END,
    CASE WHEN a2 > 0 THEN 'admissions.room_id(other org or other property)=' || a2 END,
    CASE WHEN a3 > 0 THEN 'admissions vs booking resident/bed=' || a3 END,
    CASE WHEN c1 > 0 THEN 'check_ins vs admission resident/bed/booking=' || c1 END,
    CASE WHEN o1 > 0 THEN 'check_outs vs check_in resident/bed/booking=' || o1 END,
    CASE WHEN e1 > 0 THEN 'enquiries.property_id(other org)=' || e1 END,
    CASE WHEN e2 > 0 THEN 'enquiries.resident_id(other org)=' || e2 END,
    CASE WHEN e3 > 0 THEN 'enquiries.assigned_user_id(not a member of the organization)=' || e3 END)
  INTO bad
  FROM (SELECT
    (SELECT count(*) FROM admissions a JOIN properties p ON p.id = a.property_id WHERE p.organization_id <> a.organization_id) a1,
    (SELECT count(*) FROM admissions a JOIN rooms r ON r.id = a.room_id
       WHERE r.organization_id <> a.organization_id OR (a.property_id IS NOT NULL AND r.property_id <> a.property_id)) a2,
    (SELECT count(*) FROM admissions a JOIN bookings b ON b.id = a.booking_id WHERE b.resident_id <> a.resident_id OR b.bed_id <> a.bed_id) a3,
    (SELECT count(*) FROM check_ins c JOIN admissions a ON a.id = c.admission_id
       WHERE a.resident_id <> c.resident_id OR a.bed_id <> c.bed_id OR a.booking_id <> c.booking_id) c1,
    (SELECT count(*) FROM check_outs o JOIN check_ins c ON c.id = o.check_in_id
       WHERE c.resident_id <> o.resident_id OR c.bed_id <> o.bed_id OR c.booking_id <> o.booking_id) o1,
    (SELECT count(*) FROM enquiries e JOIN properties p ON p.id = e.property_id WHERE p.organization_id <> e.organization_id) e1,
    (SELECT count(*) FROM enquiries e JOIN residents r ON r.id = e.resident_id WHERE r.organization_id <> e.organization_id) e2,
    (SELECT count(*) FROM enquiries e WHERE e.assigned_user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM memberships m WHERE m.user_id = e.assigned_user_id AND m.organization_id = e.organization_id)) e3
  ) v;
  IF bad IS NOT NULL AND bad <> '' THEN
    RAISE EXCEPTION 'inconsistent rows exist, migration aborted without changes: %', bad;
  END IF;
END $$;

-- Admission: property and room must belong to the admission's organization, and the room to the property.
CREATE FUNCTION "check_admission_location"() RETURNS trigger AS $$
BEGIN
  IF NEW."property_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "properties" p WHERE p."id" = NEW."property_id" AND p."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'admission property must belong to the same organization' USING ERRCODE = '23514';
  END IF;
  IF NEW."room_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "rooms" r
    WHERE r."id" = NEW."room_id" AND r."organization_id" = NEW."organization_id"
      AND (NEW."property_id" IS NULL OR r."property_id" = NEW."property_id")
  ) THEN
    RAISE EXCEPTION 'admission room must belong to the same organization and to the selected property' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admissions_check_location" BEFORE INSERT OR UPDATE OF "organization_id", "property_id", "room_id" ON "admissions"
  FOR EACH ROW EXECUTE FUNCTION "check_admission_location"();

-- Admission: resident and bed must be those of its booking.
CREATE FUNCTION "check_admission_matches_booking"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "bookings" b WHERE b."id" = NEW."booking_id" AND b."resident_id" = NEW."resident_id" AND b."bed_id" = NEW."bed_id"
  ) THEN
    RAISE EXCEPTION 'admission resident and bed must match its booking' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admissions_match_booking" BEFORE INSERT OR UPDATE OF "booking_id", "resident_id", "bed_id" ON "admissions"
  FOR EACH ROW EXECUTE FUNCTION "check_admission_matches_booking"();

-- Check-in: resident, bed and booking must be those of its admission.
CREATE FUNCTION "check_check_in_matches_admission"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "admissions" a
    WHERE a."id" = NEW."admission_id" AND a."resident_id" = NEW."resident_id" AND a."bed_id" = NEW."bed_id" AND a."booking_id" = NEW."booking_id"
  ) THEN
    RAISE EXCEPTION 'check-in resident, bed and booking must match its admission' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "check_ins_match_admission" BEFORE INSERT OR UPDATE OF "admission_id", "resident_id", "bed_id", "booking_id" ON "check_ins"
  FOR EACH ROW EXECUTE FUNCTION "check_check_in_matches_admission"();

-- Check-out: resident, bed and booking must be those of its check-in.
CREATE FUNCTION "check_check_out_matches_check_in"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "check_ins" c
    WHERE c."id" = NEW."check_in_id" AND c."resident_id" = NEW."resident_id" AND c."bed_id" = NEW."bed_id" AND c."booking_id" = NEW."booking_id"
  ) THEN
    RAISE EXCEPTION 'check-out resident, bed and booking must match its check-in' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "check_outs_match_check_in" BEFORE INSERT OR UPDATE OF "check_in_id", "resident_id", "bed_id", "booking_id" ON "check_outs"
  FOR EACH ROW EXECUTE FUNCTION "check_check_out_matches_check_in"();

-- Enquiry: the preferred property and the resident it was converted to must belong to the enquiry's organization.
-- (Same reasoning as admissions: both foreign keys are nullable with ON DELETE SET NULL.)
CREATE FUNCTION "check_enquiry_links"() RETURNS trigger AS $$
BEGIN
  IF NEW."property_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "properties" p WHERE p."id" = NEW."property_id" AND p."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'enquiry property must belong to the same organization' USING ERRCODE = '23514';
  END IF;
  IF NEW."resident_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "residents" r WHERE r."id" = NEW."resident_id" AND r."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'enquiry resident must belong to the same organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "enquiries_check_links" BEFORE INSERT OR UPDATE OF "organization_id", "property_id", "resident_id" ON "enquiries"
  FOR EACH ROW EXECUTE FUNCTION "check_enquiry_links"();

-- Enquiry assignee: assigned_user_id has no foreign key, so it could hold any user id. It must be a user who has
-- a membership in the enquiry's organization. The API additionally requires that membership to be ACTIVE; the
-- database only checks existence so that later revoking a membership never blocks unrelated enquiry updates.
CREATE FUNCTION "check_enquiry_assignee"() RETURNS trigger AS $$
BEGIN
  IF NEW."assigned_user_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "memberships" m WHERE m."user_id" = NEW."assigned_user_id" AND m."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'enquiry assignee must be a member of the same organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "enquiries_check_assignee" BEFORE INSERT OR UPDATE OF "organization_id", "assigned_user_id" ON "enquiries"
  FOR EACH ROW EXECUTE FUNCTION "check_enquiry_assignee"();
