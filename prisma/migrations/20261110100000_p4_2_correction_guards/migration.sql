-- Withdrawals are requester actions, not self-review decisions.
ALTER TABLE correction_proposals DROP CONSTRAINT correction_proposals_self_review_check;
ALTER TABLE correction_proposals ADD CONSTRAINT correction_proposals_self_review_check CHECK (status = 'WITHDRAWN' OR decided_by <> requested_by OR decided_by IS NULL);

CREATE OR REPLACE FUNCTION "correction_proposals_immutable_trigger"() RETURNS trigger AS $$
BEGIN
    -- Prevent updates to terminal proposals
    IF OLD."status" <> 'PENDING' THEN
        RAISE EXCEPTION 'terminal proposals cannot change' USING ERRCODE = '23001';
    END IF;
    -- Prevent changes to immutable fields even in PENDING
    IF OLD."id" IS DISTINCT FROM NEW."id" OR
       OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR
       OLD."target_type" IS DISTINCT FROM NEW."target_type" OR
       OLD."field_key" IS DISTINCT FROM NEW."field_key" OR
       OLD."original_value" IS DISTINCT FROM NEW."original_value" OR
       OLD."proposed_value" IS DISTINCT FROM NEW."proposed_value" OR
       OLD."expected_snapshot" IS DISTINCT FROM NEW."expected_snapshot" OR
       OLD."reason" IS DISTINCT FROM NEW."reason" OR
       OLD."evidence_reference" IS DISTINCT FROM NEW."evidence_reference" OR
       OLD."effective_at" IS DISTINCT FROM NEW."effective_at" OR
       OLD."recorded_at" IS DISTINCT FROM NEW."recorded_at" OR
       OLD."requested_by" IS DISTINCT FROM NEW."requested_by" OR
       OLD."requested_role" IS DISTINCT FROM NEW."requested_role" OR
       OLD."financial_impact" IS DISTINCT FROM NEW."financial_impact" OR
       OLD."correlation_id" IS DISTINCT FROM NEW."correlation_id" OR
       OLD."related_proposal_id" IS DISTINCT FROM NEW."related_proposal_id" OR
       OLD."relation_kind" IS DISTINCT FROM NEW."relation_kind"
    THEN
        RAISE EXCEPTION 'immutable fields cannot change' USING ERRCODE = '23001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "correction_command_receipts_immutable_trigger"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'correction_command_receipts is append-only' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "correction_finance_links_immutable_trigger"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'correction_finance_links is append-only' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;
