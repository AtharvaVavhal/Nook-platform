-- phase-scope: slice-4.3
-- Prove every replacement extends the complete current chain and changes only its approved outer boundary.
CREATE FUNCTION assignment_replacement_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected jsonb; revised jsonb; proposal correction_proposals; boundary integer;
  value text; segment jsonb; prior_end text; position integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('nook:lifecycle-gate:' || NEW.organization_id::text, 0));
  IF NEW.version <> (SELECT COALESCE(max(version),0)+1 FROM stay_assignment_replacements
      WHERE organization_id=NEW.organization_id AND booking_id=NEW.booking_id) THEN
    RAISE EXCEPTION 'replacement version must extend the current chain' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
      'id',e.id,'bedId',e.bed_id,'kind',e.kind,'status',e.status,
      'startAt',to_char(e.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'endAt',to_char(e.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'replaceStart',e.start_at IS DISTINCT FROM s.start_at,
      'replaceEnd',e.end_at IS DISTINCT FROM s.end_at) ORDER BY e.start_at,e.id)
    INTO expected FROM effective_stay_assignments e
    JOIN stay_assignments s ON s.id=e.id AND s.organization_id=e.organization_id
    WHERE e.organization_id=NEW.organization_id AND e.booking_id=NEW.booking_id;
  IF expected IS NULL OR NEW.before_segments IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'replacement source snapshot is incomplete or stale' USING ERRCODE='23514';
  END IF;
  SELECT * INTO proposal FROM correction_proposals WHERE id=NEW.proposal_id AND organization_id=NEW.organization_id;
  IF NOT FOUND OR proposal.field_key IS DISTINCT FROM NEW.field_key THEN
    RAISE EXCEPTION 'replacement proposal mismatch' USING ERRCODE='23514';
  END IF;
  value := to_char((proposal.proposed_value->>'value')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  IF value IS NULL OR NOT isfinite((proposal.proposed_value->>'value')::timestamptz) THEN
    RAISE EXCEPTION 'replacement boundary must be finite' USING ERRCODE='23514';
  END IF;
  IF NEW.field_key='checkInAt' THEN
    revised := jsonb_set(jsonb_set(expected,'{0,startAt}',to_jsonb(value)),'{0,replaceStart}','true');
  ELSE
    boundary := jsonb_array_length(expected)-1;
    IF expected->boundary->>'status' <> 'COMPLETED' THEN
      RAISE EXCEPTION 'replacement cannot close an active stay' USING ERRCODE='23514';
    END IF;
    revised := jsonb_set(jsonb_set(expected,ARRAY[boundary::text,'endAt'],to_jsonb(value)),ARRAY[boundary::text,'replaceEnd'],'true');
  END IF;
  IF NEW.segments IS DISTINCT FROM revised THEN
    RAISE EXCEPTION 'replacement may change only the approved outer boundary' USING ERRCODE='23514';
  END IF;
  FOR segment IN SELECT * FROM jsonb_array_elements(revised) LOOP
    IF (position=0 AND segment->>'kind'<>'ORIGINAL')
       OR (position>0 AND (segment->>'kind'<>'TRANSFER' OR prior_end IS DISTINCT FROM segment->>'startAt'))
       OR (segment->>'endAt' IS NOT NULL AND (segment->>'endAt')::timestamptz <= (segment->>'startAt')::timestamptz)
       OR (segment->>'status' IS DISTINCT FROM CASE WHEN segment->>'endAt' IS NULL THEN 'ACTIVE' ELSE 'COMPLETED' END) THEN
      RAISE EXCEPTION 'replacement assignment chain is inconsistent' USING ERRCODE='23514';
    END IF;
    prior_end := segment->>'endAt';
    position := position+1;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_replacement_chain_valid BEFORE INSERT ON stay_assignment_replacements
FOR EACH ROW EXECUTE FUNCTION assignment_replacement_chain();
