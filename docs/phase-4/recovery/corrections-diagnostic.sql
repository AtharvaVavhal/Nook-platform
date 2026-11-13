-- DIAGNOSTIC RECONSTRUCTION ONLY. NOT THE MISSING ORIGINAL MIGRATION.
-- Do not deploy or substitute its checksum into the historical migration manifest.

-- CreateEnum
CREATE TYPE "CorrectionTargetType" AS ENUM ('RESIDENT', 'BOOKING', 'ADMISSION', 'CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "CorrectionFieldKey" AS ENUM ('firstName', 'lastName', 'startDate', 'endDate', 'monthlyPrice', 'admissionDate', 'checkInAt', 'checkOutAt', 'reason');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN', 'STALE');

-- CreateEnum
CREATE TYPE "CorrectionRelationKind" AS ENUM ('REVERSAL', 'SUPERSEDES');

-- CreateEnum
CREATE TYPE "CorrectionCommandAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'WITHDRAW', 'RESOLVE');

-- CreateEnum
CREATE TYPE "CorrectionFinanceLinkKind" AS ENUM ('BILLING_GAP', 'INVOICE_REVIEW', 'RESOLUTION');

-- CreateEnum
CREATE TYPE "CorrectionFinanceOutcome" AS ENUM ('REVIEW_REQUIRED', 'RELEASED', 'NO_SUPPORTED_REMEDY', 'OPERATION_RECORDED');

-- CreateTable
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
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

-- CreateTable
CREATE TABLE "correction_command_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_check" TEXT NOT NULL,
    "proposal_id" UUID NOT NULL,
    "action" "CorrectionCommandAction" NOT NULL,
    "outcome_code" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_command_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_finance_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "correction_proposals_organization_id_status_recorded_at_id_idx" ON "correction_proposals"("organization_id", "status", "recorded_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "correction_proposals_id_organization_id_key" ON "correction_proposals"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "correction_proposals_organization_id_requested_by_correlati_key" ON "correction_proposals"("organization_id", "requested_by", "correlation_id");

-- CreateIndex
CREATE INDEX "correction_command_receipts_proposal_id_idx" ON "correction_command_receipts"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "correction_command_receipts_organization_id_actor_id_idempo_key" ON "correction_command_receipts"("organization_id", "actor_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "correction_finance_links_organization_id_kind_booking_id_pe_idx" ON "correction_finance_links"("organization_id", "kind", "booking_id", "period_start");

-- CreateIndex
CREATE INDEX "correction_finance_links_proposal_id_idx" ON "correction_finance_links"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "correction_finance_links_id_organization_id_key" ON "correction_finance_links"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "check_outs_id_organization_id_key" ON "check_outs"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reversals_id_invoice_id_organization_id_key" ON "payment_reversals"("id", "invoice_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_adjustments_id_invoice_id_organization_id_key" ON "invoice_adjustments"("id", "invoice_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_voids_id_invoice_id_organization_id_key" ON "invoice_voids"("id", "invoice_id", "organization_id");

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_resident_target_id_organization_id_fkey" FOREIGN KEY ("resident_target_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_booking_target_id_organization_id_fkey" FOREIGN KEY ("booking_target_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_admission_target_id_organization_id_fkey" FOREIGN KEY ("admission_target_id", "organization_id") REFERENCES "admissions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_check_in_target_id_organization_id_fkey" FOREIGN KEY ("check_in_target_id", "organization_id") REFERENCES "check_ins"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_check_out_target_id_organization_id_fkey" FOREIGN KEY ("check_out_target_id", "organization_id") REFERENCES "check_outs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_related_proposal_id_organization_id_fkey" FOREIGN KEY ("related_proposal_id", "organization_id") REFERENCES "correction_proposals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_command_receipts" ADD CONSTRAINT "correction_command_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_command_receipts" ADD CONSTRAINT "correction_command_receipts_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_command_receipts" ADD CONSTRAINT "correction_command_receipts_proposal_id_organization_id_fkey" FOREIGN KEY ("proposal_id", "organization_id") REFERENCES "correction_proposals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_proposal_id_organization_id_fkey" FOREIGN KEY ("proposal_id", "organization_id") REFERENCES "correction_proposals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_resident_id_organization_id_fkey" FOREIGN KEY ("resident_id", "organization_id") REFERENCES "residents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_booking_id_organization_id_fkey" FOREIGN KEY ("booking_id", "organization_id") REFERENCES "bookings"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_invoice_id_organization_id_reside_fkey" FOREIGN KEY ("invoice_id", "organization_id", "resident_id") REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_adjustment_id_invoice_id_organiza_fkey" FOREIGN KEY ("adjustment_id", "invoice_id", "organization_id") REFERENCES "invoice_adjustments"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_reversal_id_invoice_id_organizati_fkey" FOREIGN KEY ("reversal_id", "invoice_id", "organization_id") REFERENCES "payment_reversals"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_void_id_invoice_id_organization_i_fkey" FOREIGN KEY ("void_id", "invoice_id", "organization_id") REFERENCES "invoice_voids"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_payment_id_invoice_id_organizatio_fkey" FOREIGN KEY ("payment_id", "invoice_id", "organization_id") REFERENCES "payments"("id", "invoice_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_resolves_link_id_organization_id_fkey" FOREIGN KEY ("resolves_link_id", "organization_id") REFERENCES "correction_finance_links"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_one_target_check" CHECK ((num_nonnulls(resident_target_id, booking_target_id, admission_target_id, check_in_target_id, check_out_target_id) = 1));

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_target_type_check" CHECK ((((target_type = 'RESIDENT'::"CorrectionTargetType") AND (resident_target_id IS NOT NULL)) OR ((target_type = 'BOOKING'::"CorrectionTargetType") AND (booking_target_id IS NOT NULL)) OR ((target_type = 'ADMISSION'::"CorrectionTargetType") AND (admission_target_id IS NOT NULL)) OR ((target_type = 'CHECK_IN'::"CorrectionTargetType") AND (check_in_target_id IS NOT NULL)) OR ((target_type = 'CHECK_OUT'::"CorrectionTargetType") AND (check_out_target_id IS NOT NULL))));

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_field_check" CHECK ((((target_type = 'RESIDENT'::"CorrectionTargetType") AND (field_key = ANY (ARRAY['firstName'::"CorrectionFieldKey", 'lastName'::"CorrectionFieldKey"]))) OR ((target_type = 'BOOKING'::"CorrectionTargetType") AND (field_key = ANY (ARRAY['startDate'::"CorrectionFieldKey", 'endDate'::"CorrectionFieldKey", 'monthlyPrice'::"CorrectionFieldKey"]))) OR ((target_type = 'ADMISSION'::"CorrectionTargetType") AND (field_key = 'admissionDate'::"CorrectionFieldKey")) OR ((target_type = 'CHECK_IN'::"CorrectionTargetType") AND (field_key = 'checkInAt'::"CorrectionFieldKey")) OR ((target_type = 'CHECK_OUT'::"CorrectionTargetType") AND (field_key = ANY (ARRAY['checkOutAt'::"CorrectionFieldKey", 'reason'::"CorrectionFieldKey"])))));

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_status_shape_check" CHECK ((((status = 'PENDING'::"CorrectionStatus") AND (decided_by IS NULL) AND (decided_at IS NULL) AND (applied_at IS NULL) AND (decision_reason IS NULL) AND (applied_value IS NULL) AND (stale_cause IS NULL) AND (exception_rationale IS NULL)) OR ((status = 'APPLIED'::"CorrectionStatus") AND (decided_by IS NOT NULL) AND (decided_by <> requested_by) AND (decided_at IS NOT NULL) AND (applied_at IS NOT NULL) AND (decision_reason IS NOT NULL) AND (applied_value IS NOT NULL) AND (stale_cause IS NULL)) OR ((status = 'REJECTED'::"CorrectionStatus") AND (decided_by IS NOT NULL) AND (decided_by <> requested_by) AND (decided_at IS NOT NULL) AND (decision_reason IS NOT NULL) AND (applied_at IS NULL) AND (applied_value IS NULL) AND (stale_cause IS NULL)) OR ((status = 'STALE'::"CorrectionStatus") AND (decided_by IS NOT NULL) AND (decided_by <> requested_by) AND (decided_at IS NOT NULL) AND (decision_reason IS NOT NULL) AND (stale_cause IS NOT NULL) AND (applied_at IS NULL) AND (applied_value IS NULL) AND (exception_rationale IS NULL)) OR ((status = 'WITHDRAWN'::"CorrectionStatus") AND (decided_by IS NOT NULL) AND (decided_by = requested_by) AND (decided_at IS NOT NULL) AND (decision_reason IS NOT NULL) AND (applied_at IS NULL) AND (applied_value IS NULL) AND (stale_cause IS NULL) AND (exception_rationale IS NULL))));

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_text_check" CHECK ((((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 2000)) AND ((evidence_reference IS NULL) OR ((length(btrim(evidence_reference)) >= 1) AND (length(btrim(evidence_reference)) <= 2000))) AND ((decision_reason IS NULL) OR ((length(btrim(decision_reason)) >= 1) AND (length(btrim(decision_reason)) <= 2000))) AND ((exception_rationale IS NULL) OR ((length(btrim(exception_rationale)) >= 1) AND (length(btrim(exception_rationale)) <= 2000)))));

ALTER TABLE "correction_proposals" ADD CONSTRAINT "correction_proposals_related_check" CHECK (((related_proposal_id IS NULL) = (relation_kind IS NULL)));

ALTER TABLE "correction_command_receipts" ADD CONSTRAINT "correction_command_receipts_check_format" CHECK ((request_check ~ '^[0-9a-f]{64}$'::text));

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_one_operation_check" CHECK ((num_nonnulls(adjustment_id, reversal_id, void_id, payment_id) <= 1));

ALTER TABLE "correction_finance_links" ADD CONSTRAINT "correction_finance_links_shape_check" CHECK ((((kind = 'BILLING_GAP'::"CorrectionFinanceLinkKind") AND (outcome = 'REVIEW_REQUIRED'::"CorrectionFinanceOutcome") AND (booking_id IS NOT NULL) AND (period_start IS NOT NULL) AND (invoice_id IS NULL) AND (resolves_link_id IS NULL) AND (resolved_by IS NULL) AND (num_nonnulls(adjustment_id, reversal_id, void_id, payment_id) = 0)) OR ((kind = 'INVOICE_REVIEW'::"CorrectionFinanceLinkKind") AND (outcome = 'REVIEW_REQUIRED'::"CorrectionFinanceOutcome") AND (invoice_id IS NOT NULL) AND (resolves_link_id IS NULL) AND (resolved_by IS NULL) AND (num_nonnulls(adjustment_id, reversal_id, void_id, payment_id) = 0)) OR ((kind = 'RESOLUTION'::"CorrectionFinanceLinkKind") AND (outcome = ANY (ARRAY['RELEASED'::"CorrectionFinanceOutcome", 'NO_SUPPORTED_REMEDY'::"CorrectionFinanceOutcome", 'OPERATION_RECORDED'::"CorrectionFinanceOutcome"])) AND (resolves_link_id IS NOT NULL) AND (resolved_by IS NOT NULL) AND (reason IS NOT NULL) AND ((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 2000)) AND ((outcome = 'OPERATION_RECORDED'::"CorrectionFinanceOutcome") = (num_nonnulls(adjustment_id, reversal_id, void_id, payment_id) = 1)))));

CREATE UNIQUE INDEX "correction_finance_links_one_resolution_uq" ON "correction_finance_links" ("resolves_link_id") WHERE (kind = 'RESOLUTION'::"CorrectionFinanceLinkKind");

CREATE UNIQUE INDEX "correction_proposals_pending_check_out_field_uq" ON "correction_proposals" ("organization_id", "check_out_target_id", "field_key") WHERE ((status = 'PENDING'::"CorrectionStatus") AND (target_type = 'CHECK_OUT'::"CorrectionTargetType") AND (check_out_target_id IS NOT NULL));

CREATE UNIQUE INDEX "correction_proposals_pending_check_in_field_uq" ON "correction_proposals" ("organization_id", "check_in_target_id", "field_key") WHERE ((status = 'PENDING'::"CorrectionStatus") AND (target_type = 'CHECK_IN'::"CorrectionTargetType") AND (check_in_target_id IS NOT NULL));

CREATE UNIQUE INDEX "correction_proposals_pending_admission_field_uq" ON "correction_proposals" ("organization_id", "admission_target_id", "field_key") WHERE ((status = 'PENDING'::"CorrectionStatus") AND (target_type = 'ADMISSION'::"CorrectionTargetType") AND (admission_target_id IS NOT NULL));

CREATE UNIQUE INDEX "correction_proposals_pending_booking_field_uq" ON "correction_proposals" ("organization_id", "booking_target_id", "field_key") WHERE ((status = 'PENDING'::"CorrectionStatus") AND (target_type = 'BOOKING'::"CorrectionTargetType") AND (booking_target_id IS NOT NULL));

CREATE UNIQUE INDEX "correction_proposals_pending_resident_field_uq" ON "correction_proposals" ("organization_id", "resident_target_id", "field_key") WHERE ((status = 'PENDING'::"CorrectionStatus") AND (target_type = 'RESIDENT'::"CorrectionTargetType") AND (resident_target_id IS NOT NULL));

CREATE FUNCTION "correction_proposals_guard"() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'correction proposals are permanent and cannot be deleted' USING ERRCODE = '23001';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'a terminal correction proposal cannot change' USING ERRCODE = '23001';
  END IF;
  IF NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION 'a pending correction proposal can only move to a terminal status' USING ERRCODE = '23001';
  END IF;
  IF (NEW."id", NEW."organization_id", NEW."target_type", NEW."field_key",
      NEW."resident_target_id", NEW."booking_target_id", NEW."admission_target_id", NEW."check_in_target_id",
      NEW."check_out_target_id", NEW."original_value", NEW."proposed_value", NEW."expected_snapshot",
      NEW."reason", NEW."evidence_reference", NEW."effective_at", NEW."recorded_at", NEW."requested_by",
      NEW."requested_role", NEW."financial_impact", NEW."correlation_id", NEW."related_proposal_id",
      NEW."relation_kind")
     IS DISTINCT FROM
     (OLD."id", OLD."organization_id", OLD."target_type", OLD."field_key",
      OLD."resident_target_id", OLD."booking_target_id", OLD."admission_target_id", OLD."check_in_target_id",
      OLD."check_out_target_id", OLD."original_value", OLD."proposed_value", OLD."expected_snapshot",
      OLD."reason", OLD."evidence_reference", OLD."effective_at", OLD."recorded_at", OLD."requested_by",
      OLD."requested_role", OLD."financial_impact", OLD."correlation_id", OLD."related_proposal_id",
      OLD."relation_kind") THEN
    RAISE EXCEPTION 'a correction proposal payload is immutable' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$body$;

CREATE FUNCTION "correction_append_only"() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION 'correction receipts and finance links are append-only' USING ERRCODE = '23001';
END;
$body$;

CREATE TRIGGER "correction_proposals_guard" BEFORE UPDATE OR DELETE ON "correction_proposals" FOR EACH ROW EXECUTE FUNCTION "correction_proposals_guard"();

CREATE TRIGGER "correction_command_receipts_immutable" BEFORE UPDATE OR DELETE ON "correction_command_receipts" FOR EACH ROW EXECUTE FUNCTION "correction_append_only"();

CREATE TRIGGER "correction_finance_links_immutable" BEFORE UPDATE OR DELETE ON "correction_finance_links" FOR EACH ROW EXECUTE FUNCTION "correction_append_only"();
