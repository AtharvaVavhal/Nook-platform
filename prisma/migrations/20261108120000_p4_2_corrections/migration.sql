-- P4-2 Corrections migration
-- Creates correction_proposals, correction_command_receipts, correction_finance_links tables
-- Adds partial unique indexes, CHECK constraints, and immutability triggers

-- Enum types
CREATE TYPE "CorrectionTargetType" AS ENUM ('RESIDENT', 'BOOKING', 'ADMISSION', 'CHECK_IN', 'CHECK_OUT');
CREATE TYPE "CorrectionFieldKey" AS ENUM ('firstName', 'lastName', 'startDate', 'endDate', 'monthlyPrice', 'admissionDate', 'checkInAt', 'checkOutAt', 'reason');
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN', 'STALE');
CREATE TYPE "CorrectionRelationKind" AS ENUM ('REVERSAL', 'SUPERSEDES');
CREATE TYPE "CorrectionCommandAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'WITHDRAW', 'RESOLVE');
CREATE TYPE "CorrectionFinanceLinkKind" AS ENUM ('BILLING_GAP', 'INVOICE_REVIEW', 'RESOLUTION');
CREATE TYPE "CorrectionFinanceOutcome" AS ENUM ('REVIEW_REQUIRED', 'RELEASED', 'NO_SUPPORTED_REMEDY', 'OPERATION_RECORDED');

-- correction_proposals table
CREATE TABLE "correction_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "target_type" "CorrectionTargetType" NOT NULL,
    "field_key" "CorrectionFieldKey" NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "resident_target_id" UUID,
    "booking_target_id" UUID,
    "admission_target_id" UUID,
    "check_in_target_id" UUID,
    "check_out_target_id" UUID,
    "original_value" JSONB NOT NULL,
    "proposed_value" JSONB NOT NULL,
    "applied_value" JSONB,
    "expected_snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_reference" TEXT,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "requested_by" UUID NOT NULL,
    "requested_role" "MembershipRole" NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "applied_at" TIMESTAMPTZ(6),
    "decision_reason" TEXT,
    "exception_rationale" TEXT,
    "stale_cause" TEXT,
    "financial_impact" BOOLEAN NOT NULL,
    "correlation_id" UUID NOT NULL,
    "related_proposal_id" UUID,
    "relation_kind" "CorrectionRelationKind",

    CONSTRAINT "correction_proposals_pkey" PRIMARY KEY ("id")
);

-- Indexes for correction_proposals
CREATE UNIQUE INDEX "correction_proposals_id_organization_id_key" ON "correction_proposals" ("id", "organization_id");
CREATE UNIQUE INDEX "correction_proposals_organization_id_requested_by_correlation_id_key" ON "correction_proposals" ("organization_id", "requested_by", "correlation_id");
CREATE INDEX "correction_proposals_organization_id_status_recorded_at_id_idx" ON "correction_proposals" ("organization_id", "status", "recorded_at", "id");

-- Partial unique indexes for PENDING proposals per field per target
CREATE UNIQUE INDEX "correction_proposals_pending_resident_field_uq" ON "correction_proposals" ("organization_id", "resident_target_id", "field_key")
    WHERE "status" = 'PENDING' AND "target_type" = 'RESIDENT' AND "resident_target_id" IS NOT NULL;
CREATE UNIQUE INDEX "correction_proposals_pending_booking_field_uq" ON "correction_proposals" ("organization_id", "booking_target_id", "field_key")
    WHERE "status" = 'PENDING' AND "target_type" = 'BOOKING' AND "booking_target_id" IS NOT NULL;
CREATE UNIQUE INDEX "correction_proposals_pending_admission_field_uq" ON "correction_proposals" ("organization_id", "admission_target_id", "field_key")
    WHERE "status" = 'PENDING' AND "target_type" = 'ADMISSION' AND "admission_target_id" IS NOT NULL;
CREATE UNIQUE INDEX "correction_proposals_pending_check_in_field_uq" ON "correction_proposals" ("organization_id", "check_in_target_id", "field_key")
    WHERE "status" = 'PENDING' AND "target_type" = 'CHECK_IN' AND "check_in_target_id" IS NOT NULL;
CREATE UNIQUE INDEX "correction_proposals_pending_check_out_field_uq" ON "correction_proposals" ("organization_id", "check_out_target_id", "field_key")
    WHERE "status" = 'PENDING' AND "target_type" = 'CHECK_OUT' AND "check_out_target_id" IS NOT NULL;

-- Foreign keys for correction_proposals
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_resident_target_id_organization_id_fkey"
    FOREIGN KEY ("resident_target_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_booking_target_id_organization_id_fkey"
    FOREIGN KEY ("booking_target_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_admission_target_id_organization_id_fkey"
    FOREIGN KEY ("admission_target_id", "organization_id") REFERENCES "admissions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_check_in_target_id_organization_id_fkey"
    FOREIGN KEY ("check_in_target_id", "organization_id") REFERENCES "check_ins"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The referenced composite key must exist before the foreign key is created.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'check_outs_id_organization_id_key'
    ) THEN
        ALTER TABLE "check_outs" ADD CONSTRAINT "check_outs_id_organization_id_key" UNIQUE ("id", "organization_id");
    END IF;
END $$;

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_check_out_target_id_organization_id_fkey"
    FOREIGN KEY ("check_out_target_id", "organization_id") REFERENCES "check_outs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_decided_by_fkey"
    FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_related_proposal_id_organization_id_fkey"
    FOREIGN KEY ("related_proposal_id", "organization_id") REFERENCES "correction_proposals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CHECK constraints for correction_proposals
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_exactly_one_target_check"
    CHECK (
        (CASE WHEN "resident_target_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "booking_target_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "admission_target_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "check_in_target_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "check_out_target_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
    );

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_target_type_matches_id_check"
    CHECK (
        ("target_type" = 'RESIDENT' AND "resident_target_id" IS NOT NULL) OR
        ("target_type" = 'BOOKING' AND "booking_target_id" IS NOT NULL) OR
        ("target_type" = 'ADMISSION' AND "admission_target_id" IS NOT NULL) OR
        ("target_type" = 'CHECK_IN' AND "check_in_target_id" IS NOT NULL) OR
        ("target_type" = 'CHECK_OUT' AND "check_out_target_id" IS NOT NULL)
    );

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_field_key_compatible_check"
    CHECK (
        ("target_type" = 'RESIDENT' AND "field_key" IN ('firstName', 'lastName')) OR
        ("target_type" = 'BOOKING' AND "field_key" IN ('startDate', 'endDate', 'monthlyPrice')) OR
        ("target_type" = 'ADMISSION' AND "field_key" = 'admissionDate') OR
        ("target_type" = 'CHECK_IN' AND "field_key" = 'checkInAt') OR
        ("target_type" = 'CHECK_OUT' AND "field_key" IN ('checkOutAt', 'reason'))
    );

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_self_review_check"
    CHECK ("requested_by" <> "decided_by" OR "decided_by" IS NULL);

-- Terminal row shape CHECK constraints
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_pending_shape_check"
    CHECK (
        "status" <> 'PENDING' OR
        ("decided_by" IS NULL AND "decided_at" IS NULL AND "applied_at" IS NULL AND
         "decision_reason" IS NULL AND "exception_rationale" IS NULL AND
         "stale_cause" IS NULL AND "applied_value" IS NULL)
    );

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_applied_shape_check"
    CHECK (
        "status" <> 'APPLIED' OR
        ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "applied_at" IS NOT NULL AND
         "decision_reason" IS NOT NULL AND "applied_value" IS NOT NULL)
    );

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_rejected_shape_check"
    CHECK (
        "status" <> 'REJECTED' OR
        ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "decision_reason" IS NOT NULL AND
         "applied_at" IS NULL AND "applied_value" IS NULL AND "stale_cause" IS NULL)
    );

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_withdrawn_shape_check"
    CHECK (
        "status" <> 'WITHDRAWN' OR
        ("decided_by" = "requested_by" AND "decided_at" IS NOT NULL AND "decision_reason" IS NOT NULL AND
         "applied_at" IS NULL AND "applied_value" IS NULL AND "stale_cause" IS NULL)
    );

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_stale_shape_check"
    CHECK (
        "status" <> 'STALE' OR
        ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "decision_reason" IS NOT NULL AND
         "stale_cause" IS NOT NULL AND "applied_at" IS NULL AND "applied_value" IS NULL)
    );

-- Immutability trigger for correction_proposals
CREATE OR REPLACE FUNCTION "correction_proposals_immutable_trigger"() RETURNS trigger AS $$
BEGIN
    -- Prevent updates to terminal proposals
    IF OLD."status" <> 'PENDING' THEN
        RAISE EXCEPTION 'terminal proposals cannot change';
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
        RAISE EXCEPTION 'immutable fields cannot change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "correction_proposals_immutable"
    BEFORE UPDATE ON "correction_proposals"
    FOR EACH ROW EXECUTE FUNCTION "correction_proposals_immutable_trigger"();

CREATE TRIGGER "correction_proposals_no_delete"
    BEFORE DELETE ON "correction_proposals"
    FOR EACH ROW EXECUTE FUNCTION "correction_proposals_immutable_trigger"();

-- correction_command_receipts table
CREATE TABLE "correction_command_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_check" TEXT NOT NULL,
    "proposal_id" UUID NOT NULL,
    "action" "CorrectionCommandAction" NOT NULL,
    "outcome_code" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "correction_command_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "correction_command_receipts_organization_id_actor_id_idempotency_key_key"
    ON "correction_command_receipts" ("organization_id", "actor_id", "idempotency_key");
CREATE INDEX "correction_command_receipts_proposal_id_idx" ON "correction_command_receipts" ("proposal_id");

ALTER TABLE "correction_command_receipts" ADD CONSTRAINT "correction_command_receipts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_command_receipts" ADD CONSTRAINT "correction_command_receipts_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_command_receipts" ADD CONSTRAINT "correction_command_receipts_proposal_id_organization_id_fkey"
    FOREIGN KEY ("proposal_id", "organization_id") REFERENCES "correction_proposals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Immutability trigger for correction_command_receipts (append-only)
CREATE OR REPLACE FUNCTION "correction_command_receipts_immutable_trigger"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'correction_command_receipts is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "correction_command_receipts_immutable"
    BEFORE UPDATE OR DELETE ON "correction_command_receipts"
    FOR EACH ROW EXECUTE FUNCTION "correction_command_receipts_immutable_trigger"();

-- correction_finance_links table
CREATE TABLE "correction_finance_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "kind" "CorrectionFinanceLinkKind" NOT NULL,
    "outcome" "CorrectionFinanceOutcome" NOT NULL,
    "resident_id" UUID NOT NULL,
    "booking_id" UUID,
    "period_start" DATE,
    "invoice_id" UUID,
    "adjustment_id" UUID,
    "reversal_id" UUID,
    "void_id" UUID,
    "payment_id" UUID,
    "resolves_link_id" UUID,
    "resolved_by" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "correction_finance_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "correction_finance_links_id_organization_id_key" ON "correction_finance_links" ("id", "organization_id");
CREATE INDEX "correction_finance_links_organization_id_kind_booking_id_period_start_idx"
    ON "correction_finance_links" ("organization_id", "kind", "booking_id", "period_start");
CREATE INDEX "correction_finance_links_proposal_id_idx" ON "correction_finance_links" ("proposal_id");

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_proposal_id_organization_id_fkey"
    FOREIGN KEY ("proposal_id", "organization_id") REFERENCES "correction_proposals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_resident_id_organization_id_fkey"
    FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_booking_id_organization_id_fkey"
    FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_invoice_id_fkey"
    FOREIGN KEY ("invoice_id", "organization_id", "resident_id") REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite targets for finance links must exist before their foreign keys.
CREATE UNIQUE INDEX "invoice_adjustments_id_invoice_id_organization_id_key" ON "invoice_adjustments" ("id", "invoice_id", "organization_id");
CREATE UNIQUE INDEX "payment_reversals_id_invoice_id_organization_id_key" ON "payment_reversals" ("id", "invoice_id", "organization_id");
CREATE UNIQUE INDEX "invoice_voids_id_invoice_id_organization_id_key" ON "invoice_voids" ("id", "invoice_id", "organization_id");

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_adjustment_id_fkey"
    FOREIGN KEY ("adjustment_id", "invoice_id", "organization_id") REFERENCES "invoice_adjustments"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_reversal_id_fkey"
    FOREIGN KEY ("reversal_id", "invoice_id", "organization_id") REFERENCES "payment_reversals"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_void_id_fkey"
    FOREIGN KEY ("void_id", "invoice_id", "organization_id") REFERENCES "invoice_voids"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_payment_id_fkey"
    FOREIGN KEY ("payment_id", "invoice_id", "organization_id") REFERENCES "payments"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_resolves_link_id_organization_id_fkey"
    FOREIGN KEY ("resolves_link_id", "organization_id") REFERENCES "correction_finance_links"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_resolved_by_fkey"
    FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Immutability trigger for correction_finance_links (append-only for non-RESOLUTION kinds, RESOLUTION is also append-only)
CREATE OR REPLACE FUNCTION "correction_finance_links_immutable_trigger"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'correction_finance_links is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "correction_finance_links_immutable"
    BEFORE UPDATE OR DELETE ON "correction_finance_links"
    FOR EACH ROW EXECUTE FUNCTION "correction_finance_links_immutable_trigger"();
