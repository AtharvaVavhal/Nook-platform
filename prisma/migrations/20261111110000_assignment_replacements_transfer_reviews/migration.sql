-- phase-scope: slice-4.3
-- Additive history/projection infrastructure; no transfer or financial feature is enabled.
ALTER TABLE transfers ADD CONSTRAINT transfers_finance_identity_key UNIQUE(id,organization_id,booking_id,resident_id);
CREATE TABLE stay_assignment_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL, resident_id uuid NOT NULL, proposal_id uuid NOT NULL UNIQUE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, version integer NOT NULL CHECK(version>0),
  field_key "CorrectionFieldKey" NOT NULL CHECK(field_key IN ('checkInAt','checkOutAt')),
  before_segments jsonb NOT NULL CHECK(jsonb_typeof(before_segments)='array' AND jsonb_array_length(before_segments)>0),
  segments jsonb NOT NULL CHECK(jsonb_typeof(segments)='array' AND jsonb_array_length(segments)=jsonb_array_length(before_segments)),
  recorded_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE(organization_id,booking_id,version),
  FOREIGN KEY(booking_id,organization_id) REFERENCES bookings(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(resident_id,organization_id) REFERENCES residents(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(proposal_id,organization_id) REFERENCES correction_proposals(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX stay_assignment_replacements_chain_idx ON stay_assignment_replacements(organization_id,booking_id);
CREATE FUNCTION phase4_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'phase4 history is append-only' USING ERRCODE='23001'; END $$;
CREATE TRIGGER stay_assignment_replacements_immutable BEFORE UPDATE OR DELETE ON stay_assignment_replacements FOR EACH ROW EXECUTE FUNCTION phase4_append_only();
-- The row can participate in same-transaction Finance validation before the final proposal transition,
-- but no replacement can commit without that transition and an independent, matching reviewer.
CREATE FUNCTION assignment_replacement_applied() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p correction_proposals; b uuid; BEGIN
 SELECT * INTO p FROM correction_proposals WHERE id=NEW.proposal_id AND organization_id=NEW.organization_id;
 IF p.status<>'APPLIED' OR p.decided_by IS DISTINCT FROM NEW.actor_user_id OR p.requested_by=NEW.actor_user_id OR p.field_key<>NEW.field_key THEN
  RAISE EXCEPTION 'replacement requires an applied independent correction' USING ERRCODE='23514'; END IF;
 IF p.field_key='checkInAt' THEN SELECT booking_id INTO b FROM check_ins WHERE id=p.check_in_target_id AND organization_id=NEW.organization_id;
 ELSE SELECT booking_id INTO b FROM check_outs WHERE id=p.check_out_target_id AND organization_id=NEW.organization_id; END IF;
 IF b IS DISTINCT FROM NEW.booking_id OR NOT EXISTS(SELECT 1 FROM bookings WHERE id=b AND organization_id=NEW.organization_id AND resident_id=NEW.resident_id) THEN
  RAISE EXCEPTION 'replacement target does not match its correction' USING ERRCODE='23514'; END IF;
 IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(NEW.segments) x)<>jsonb_array_length(NEW.segments)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.segments) x WHERE NOT EXISTS(
   SELECT 1 FROM stay_assignments a WHERE a.id=(x->>'id')::uuid AND a.organization_id=NEW.organization_id AND a.booking_id=NEW.booking_id AND a.resident_id=NEW.resident_id)) THEN
  RAISE EXCEPTION 'replacement segments must reference the same tenant and stay' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.segments) x WHERE
   (NEW.field_key='checkInAt' AND (x->>'replaceStart')::boolean AND (x->>'startAt')::timestamptz=(p.proposed_value->>'value')::timestamptz)
   OR (NEW.field_key='checkOutAt' AND (x->>'replaceEnd')::boolean AND (x->>'endAt')::timestamptz=(p.proposed_value->>'value')::timestamptz)) THEN
  RAISE EXCEPTION 'replacement must match the approved boundary value' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER assignment_replacement_requires_applied AFTER INSERT ON stay_assignment_replacements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assignment_replacement_applied();
CREATE VIEW effective_stay_assignments AS
 SELECT s.id,s.organization_id,s.booking_id,s.resident_id,s.bed_id,s.kind,s.status,
 CASE WHEN (r.segment->>'replaceStart')::boolean THEN (r.segment->>'startAt')::timestamptz ELSE s.start_at END AS start_at,
 CASE WHEN (r.segment->>'replaceEnd')::boolean THEN (r.segment->>'endAt')::timestamptz ELSE s.end_at END AS end_at,
 s.transfer_id,s.created_at,r.id AS replacement_id
 FROM stay_assignments s LEFT JOIN LATERAL (
   SELECT h.id,e.segment FROM stay_assignment_replacements h
   CROSS JOIN LATERAL jsonb_array_elements(h.segments) e(segment)
   WHERE h.organization_id=s.organization_id AND h.booking_id=s.booking_id AND e.segment->>'id'=s.id::text
   ORDER BY h.version DESC LIMIT 1
 ) r ON true;
CREATE TABLE transfer_finance_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 transfer_id uuid NOT NULL, booking_id uuid NOT NULL, resident_id uuid NOT NULL,
 requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 period_start date NOT NULL CHECK(extract(day FROM period_start)=1), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 recorded_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(id,organization_id), UNIQUE(organization_id,transfer_id,period_start),
 FOREIGN KEY(transfer_id,organization_id,booking_id,resident_id) REFERENCES transfers(id,organization_id,booking_id,resident_id) ON DELETE RESTRICT,
 FOREIGN KEY(booking_id,organization_id) REFERENCES bookings(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(resident_id,organization_id) REFERENCES residents(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,requested_by_user_id) REFERENCES memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX transfer_finance_reviews_period_idx ON transfer_finance_reviews(organization_id,booking_id,period_start);
CREATE TABLE transfer_finance_resolutions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, review_id uuid NOT NULL UNIQUE,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 outcome text NOT NULL CHECK(outcome IN ('RELEASED','NO_SUPPORTED_REMEDY')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), idempotency_key uuid NOT NULL,
 request_check text NOT NULL CHECK(request_check~'^[0-9a-f]{64}$'), recorded_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(organization_id,actor_user_id,idempotency_key), UNIQUE(review_id,organization_id),
 FOREIGN KEY(review_id,organization_id) REFERENCES transfer_finance_reviews(id,organization_id) ON DELETE RESTRICT
);
CREATE TRIGGER transfer_finance_reviews_immutable BEFORE UPDATE OR DELETE ON transfer_finance_reviews FOR EACH ROW EXECUTE FUNCTION phase4_append_only();
CREATE TRIGGER transfer_finance_resolutions_immutable BEFORE UPDATE OR DELETE ON transfer_finance_resolutions FOR EACH ROW EXECUTE FUNCTION phase4_append_only();
CREATE FUNCTION transfer_finance_resolution_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM transfer_finance_reviews r WHERE r.id=NEW.review_id AND r.organization_id=NEW.organization_id AND r.requested_by_user_id=NEW.actor_user_id)
 OR NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.organization_id
 WHERE m.user_id=NEW.actor_user_id AND m.organization_id=NEW.organization_id AND m.role='OWNER' AND m.status='ACTIVE' AND u.status='ACTIVE' AND o.status='ACTIVE') THEN
 RAISE EXCEPTION 'independent active owner required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER transfer_finance_resolution_authorized BEFORE INSERT ON transfer_finance_resolutions FOR EACH ROW EXECUTE FUNCTION transfer_finance_resolution_authority();
