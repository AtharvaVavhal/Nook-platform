import { recordAssignmentReplacement } from '../common/assignment-reconciliation.js';
import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { Prisma } from '../generated/client.js';
import { correctionDeadlineClient } from '../common/correction-deadline.js';
import { auditRequestId } from '../observability/request-context.js';
import {
  CORRECTION_GATE_LOCK_TIMEOUT_MS,
  CORRECTION_TX_OPTIONS,
  setLocalLockTimeout,
} from '../common/org-gate.js';
import {
  classifyFailure,
  isAutoRetryable,
  violatedConstraint,
  type FailureClass,
} from '../common/tx-errors.js';
import {
  AUDIT_TARGET_TYPE,
  CorrectionError,
  FIELD_SPECS,
  NORMAL_WINDOW_DAYS,
  POLICY_VERSION,
  ageDays,
  canSubmit,
  diffSnapshot,
  envelopesEqual,
  evidenceRequired,
  isExceptional,
  istDayKeyOf,
  requestCheck,
  reviewerRoleAllowed,
  type FieldKey,
  type SnapshotFacts,
  type TargetType,
  type ValueEnvelope,
} from './corrections.rules.js';
import {
  parseApprove,
  parseIdempotencyKey,
  parseListQuery,
  parseReasonOnly,
  parseResolve,
  parseSubmit,
  parseUuid,
  type SubmitInput,
} from './corrections.input.js';
import {
  candidateDays,
  currentEnvelope,
  invoiceSlotsFact,
  loadChain,
  loadResident,
  lockChain,
  lockCheckOutOnly,
  lockResidentForUpdate,
  resolveBookingId,
  snapshotFacts,
  dayOfInstantText,
  type Chain,
  type ChainDepth,
  type ResidentRow,
  type Tx,
} from './corrections.facts.js';
import { applyColumn, validateCorrection } from './corrections.apply.js';

export interface CorrectionsConfig {
  receiptSecret(): string | undefined;
  financialApplyEnabled(): boolean;
  /** Test seam for jitter sleeping. */
  sleep?(ms: number): Promise<void>;
}

export const CORRECTIONS_CONFIG = 'CORRECTIONS_CONFIG';

/**
 * Financial correction application (booking terms, admission date, physical timestamps) is gated off until P4-2.3 and
 * P4-2.4 have passed joint independent review and the disposable-PostgreSQL acceptance run (specification 17). The
 * default is OFF. Names and checkout reasons are not financial and are not affected by this switch.
 */
export const defaultCorrectionsConfig: CorrectionsConfig = {
  receiptSecret: () => {
    const secret = process.env.CORRECTION_RECEIPT_SECRET;
    return secret && secret.length >= 32 ? secret : undefined;
  },
  financialApplyEnabled: () => process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED === '1',
};

export interface CommandContext {
  organizationId: string;
  userId: string;
  role: string;
}

type CommandAction = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'WITHDRAW' | 'RESOLVE';

interface Authority {
  userId: string;
  role: 'OWNER' | 'PROPERTY_MANAGER';
}

interface Outcome {
  proposalId: string;
  outcomeCode: string;
  status: number;
  body: unknown;
  /** Raised only AFTER the transaction (including the receipt and a STALE transition) has committed. */
  throwAfterCommit?: CorrectionError;
}

const MAX_RETRIES = 2;
const COMMAND_DEADLINE_MS = 45_000;
const OK_STATUS: Record<string, number> = { SUBMITTED: 201 };

function fail(
  status: number,
  code: ConstructorParameters<typeof CorrectionError>[1],
  message: string,
  id?: string,
): never {
  throw new CorrectionError(status, code, message, id);
}

@Injectable()
export class CorrectionsService {
  private readonly cfg: CorrectionsConfig;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Optional() @Inject(CORRECTIONS_CONFIG) config?: CorrectionsConfig,
  ) {
    this.cfg = config ?? defaultCorrectionsConfig;
  }

  // ===================================================================================== command runner

  /**
   * Runs one correction command as a single transaction with an idempotency receipt written in the SAME transaction as the
   * effect. Order of locks: command-key advisory lock -> (body: proposal row -> organization gate -> source rows).
   * Whole-transaction retry happens only for SQLSTATE 40P01/40001 read from the driver error, at most twice, with the same
   * key; authorization and every fact are re-read on each attempt. Lock timeout, a Prisma transaction error and any
   * ambiguous failure are NOT retried here: the client re-sends the same Idempotency-Key and the receipt answers.
   */
  private async run(
    ctx: CommandContext,
    action: CommandAction,
    rawKey: unknown,
    proposalId: string | null,
    payload: unknown,
    body: (tx: Tx, authority: Authority, budget: () => number) => Promise<Outcome>,
    pendingFieldProbe?: () => Promise<boolean>,
  ): Promise<{ status: number; body: unknown }> {
    const key = parseIdempotencyKey(rawKey);
    const secret = this.cfg.receiptSecret();
    if (!secret) {
      fail(503, 'CORRECTIONS_NOT_CONFIGURED', 'Corrections are not configured on this server');
    }
    const check = requestCheck(secret!, {
      action,
      proposalId,
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      payload,
    });
    const startedAt = Date.now();
    const sleep =
      this.cfg.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let lastFailure: FailureClass = 'OTHER';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const deadlineLeft = () => COMMAND_DEADLINE_MS - (Date.now() - startedAt);
      const attemptStarted = Date.now();
      try {
        const outcome = await this.prisma.db.$transaction(async (rawTx) => {
          const tx = correctionDeadlineClient(
            rawTx,
            CORRECTION_TX_OPTIONS.timeout - (Date.now() - attemptStarted),
          );
          const txStarted = attemptStarted;
          const result = await (async () => {
            // Remaining-budget logic: a lock wait never outlives what is left of the transaction timeout or the deadline.
            const budget = () =>
              Math.max(
                250,
                Math.min(
                  CORRECTION_GATE_LOCK_TIMEOUT_MS,
                  CORRECTION_TX_OPTIONS.timeout - (Date.now() - txStarted) - 1_000,
                  deadlineLeft(),
                ),
              );
            await setLocalLockTimeout(tx, budget());
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nook:correction-command:${ctx.organizationId}:${ctx.userId}:${key}`}, 0))`;

            // Authorization is re-read from the database on EVERY attempt and replay (the session guard ran once per request).
            const authority = await this.loadAuthority(tx, ctx);

            if (proposalId) {
              const known = await tx.correctionProposal.findFirst({
                where: { id: proposalId, organizationId: ctx.organizationId },
                select: { id: true },
              });
              if (!known) fail(404, 'NOT_FOUND', 'Not found');
            }

            const receipt = await tx.correctionCommandReceipt.findUnique({
              where: {
                organizationId_actorId_idempotencyKey: {
                  organizationId: ctx.organizationId,
                  actorId: ctx.userId,
                  idempotencyKey: key,
                },
              },
            });
            if (receipt) {
              if (
                receipt.action !== action ||
                receipt.requestCheck !== check ||
                (proposalId && receipt.proposalId !== proposalId)
              ) {
                fail(
                  409,
                  'IDEMPOTENCY_CONFLICT',
                  'This Idempotency-Key was already used for a different request',
                );
              }
              const stale = receipt.outcomeCode === 'STALE_SOURCE';
              return {
                proposalId: receipt.proposalId,
                outcomeCode: receipt.outcomeCode,
                status: stale ? 409 : (OK_STATUS[receipt.outcomeCode] ?? 200),
                body: {
                  id: receipt.proposalId,
                  outcomeCode: receipt.outcomeCode,
                  idempotentReplay: true,
                },
                ...(stale
                  ? {
                      throwAfterCommit: new CorrectionError(
                        409,
                        'STALE_SOURCE',
                        'The record changed after this correction was proposed; submit a new correction',
                        receipt.proposalId,
                      ),
                    }
                  : {}),
              } satisfies Outcome;
            }

            const result = await body(tx, authority, budget);
            await tx.correctionCommandReceipt.create({
              data: {
                organizationId: ctx.organizationId,
                actorId: ctx.userId,
                idempotencyKey: key,
                requestCheck: check,
                proposalId: result.proposalId,
                action,
                outcomeCode: result.outcomeCode,
              },
            });
            return result;
          })();
          // Refresh the server budget immediately before Prisma sends COMMIT (also covers receipt replay).
          await tx.$executeRaw`SELECT 1`;
          return result;
        }, CORRECTION_TX_OPTIONS);

        if (outcome.throwAfterCommit) throw outcome.throwAfterCommit;
        return { status: outcome.status, body: outcome.body };
      } catch (error) {
        if (error instanceof CorrectionError) throw error;
        if (error instanceof HttpException) throw error;
        const failure = classifyFailure(error);
        lastFailure = failure;
        if (isAutoRetryable(failure) && attempt < MAX_RETRIES && deadlineLeft() > 2_000) {
          await sleep(50 + Math.floor(Math.random() * 100) * (attempt + 1));
          continue;
        }
        if (failure === 'UNIQUE_VIOLATION') {
          const name = violatedConstraint(error) ?? '';
          if (/pending_.*_field_uq/.test(name)) {
            fail(409, 'PENDING_CONFLICT', 'Another correction for this field is already pending');
          }
          if (/receipts|correlation|requested_by/.test(name)) {
            fail(
              409,
              'RETRY_REQUIRED',
              'Send the request again with the same Idempotency-Key to resolve the command result.',
            );
          }
          // Constraint name unavailable: resolve with a tenant-scoped lookup AFTER the rollback.
          if (pendingFieldProbe && (await pendingFieldProbe())) {
            fail(409, 'PENDING_CONFLICT', 'Another correction for this field is already pending');
          }
          // A uniqueness conflict is never an automatic whole-transaction retry (A7).
        }
        break;
      }
    }
    // Retry budget exhausted, lock timeout, Prisma transaction error or an ambiguous failure.
    if (
      lastFailure === 'OTHER' ||
      lastFailure === 'FOREIGN_KEY_VIOLATION' ||
      lastFailure === 'UNIQUE_VIOLATION'
    ) {
      throw new Error('Correction command failed unexpectedly');
    }
    fail(
      409,
      'RETRY_REQUIRED',
      lastFailure === 'UNCERTAIN'
        ? 'The outcome of this request is uncertain. Send it again with the same Idempotency-Key to learn the result.'
        : 'The system is busy. Retry with the same Idempotency-Key.',
    );
  }

  private async loadAuthority(tx: Tx, ctx: CommandContext): Promise<Authority> {
    const membership = await tx.membership.findFirst({
      where: { organizationId: ctx.organizationId, userId: ctx.userId },
      include: { user: { select: { status: true } }, organization: { select: { status: true } } },
    });
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      membership.user.status !== 'ACTIVE' ||
      membership.organization.status !== 'ACTIVE' ||
      !canSubmit(membership.role)
    ) {
      fail(403, 'INSUFFICIENT_ROLE', 'You are not permitted to do this');
    }
    return { userId: ctx.userId, role: membership.role as 'OWNER' | 'PROPERTY_MANAGER' };
  }

  private async lockGate(tx: Tx, organizationId: string, budget: () => number): Promise<void> {
    await setLocalLockTimeout(tx, budget());
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nook:lifecycle-gate:${organizationId}`}, 0))`;
  }

  private async sampleNow(tx: Tx): Promise<Date> {
    const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    return rows[0]!.now;
  }

  private async audit(
    tx: Tx,
    organizationId: string,
    actorUserId: string,
    action: string,
    targetType: TargetType,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        action,
        targetType: AUDIT_TARGET_TYPE[targetType],
        targetId,
        requestId: auditRequestId(),
        metadata,
      },
    });
  }

  // ==================================================================================== shared fact loading

  private async loadForTarget(
    tx: Tx,
    organizationId: string,
    targetType: TargetType,
    targetId: string,
    fieldKey: FieldKey,
    locking: boolean,
  ): Promise<{ resident: ResidentRow | null; chain: Chain | null; bookingId: string | null }> {
    if (targetType === 'RESIDENT') {
      if (locking && !(await lockResidentForUpdate(tx, organizationId, targetId)))
        fail(404, 'NOT_FOUND', 'Not found');
      const resident = await loadResident(tx, organizationId, targetId);
      if (!resident) fail(404, 'NOT_FOUND', 'Not found');
      return { resident, chain: null, bookingId: null };
    }
    const bookingId = await resolveBookingId(tx, organizationId, targetType, targetId);
    if (!bookingId) fail(404, 'NOT_FOUND', 'Not found');
    if (fieldKey === 'reason') {
      if (locking) await lockCheckOutOnly(tx, organizationId, targetId);
      return { resident: null, chain: await loadChain(tx, organizationId, bookingId!), bookingId };
    }
    const depth: ChainDepth = fieldKey === 'admissionDate' ? 'checkIn' : 'checkOut';
    const chain = locking
      ? await lockChain(tx, organizationId, bookingId!, depth)
      : await loadChain(tx, organizationId, bookingId!);
    return { resident: null, chain, bookingId };
  }

  private assertTargetShape(
    targetType: TargetType,
    targetId: string,
    fieldKey: FieldKey,
    chain: Chain | null,
  ): void {
    if (!chain) return;
    const ok =
      (targetType === 'BOOKING' && chain.bookingId === targetId) ||
      (targetType === 'ADMISSION' && chain.admissionId === targetId) ||
      (targetType === 'CHECK_IN' && chain.checkInId === targetId) ||
      (targetType === 'CHECK_OUT' && chain.checkOutId === targetId);
    if (!ok) fail(404, 'NOT_FOUND', 'Not found');
    if (fieldKey === 'admissionDate' && !chain.admissionId)
      fail(409, 'LIFECYCLE_CONFLICT', 'There is no admission to correct');
    if (fieldKey === 'checkInAt' && !chain.checkInId)
      fail(409, 'LIFECYCLE_CONFLICT', 'There is no check-in to correct');
    if ((fieldKey === 'checkOutAt' || fieldKey === 'reason') && !chain.checkOutId) {
      fail(409, 'LIFECYCLE_CONFLICT', 'There is no completed stay to correct');
    }
  }

  private targetColumns(targetType: TargetType, targetId: string) {
    return {
      residentTargetId: targetType === 'RESIDENT' ? targetId : null,
      bookingTargetId: targetType === 'BOOKING' ? targetId : null,
      admissionTargetId: targetType === 'ADMISSION' ? targetId : null,
      checkInTargetId: targetType === 'CHECK_IN' ? targetId : null,
      checkOutTargetId: targetType === 'CHECK_OUT' ? targetId : null,
    };
  }

  private targetIdOf(p: {
    residentTargetId: string | null;
    bookingTargetId: string | null;
    admissionTargetId: string | null;
    checkInTargetId: string | null;
    checkOutTargetId: string | null;
  }): string {
    return (p.residentTargetId ??
      p.bookingTargetId ??
      p.admissionTargetId ??
      p.checkInTargetId ??
      p.checkOutTargetId)!;
  }

  // ============================================================================================== submit

  async submit(ctx: CommandContext, idempotencyKey: unknown, rawBody: unknown) {
    const input = parseSubmit(rawBody);
    const spec = FIELD_SPECS[input.fieldKey];
    return this.run(
      ctx,
      'SUBMIT',
      idempotencyKey,
      null,
      input,
      (tx, authority, budget) =>
        this.submitInTx(
          tx,
          authority,
          ctx,
          input,
          parseIdempotencyKey(idempotencyKey),
          spec.gated,
          budget,
        ),
      async () => {
        const existing = await this.prisma.db.correctionProposal.findFirst({
          where: {
            organizationId: ctx.organizationId,
            status: 'PENDING',
            fieldKey: input.fieldKey,
            ...this.targetColumnsWhere(input.targetType, input.targetId),
          },
          select: { id: true },
        });
        return existing !== null;
      },
    );
  }

  private targetColumnsWhere(targetType: TargetType, targetId: string) {
    const c = this.targetColumns(targetType, targetId);
    return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null));
  }

  private async submitInTx(
    tx: Tx,
    authority: Authority,
    ctx: CommandContext,
    input: SubmitInput,
    correlationId: string,
    gated: boolean,
    budget: () => number,
  ): Promise<Outcome> {
    const org = ctx.organizationId;
    if (gated) await this.lockGate(tx, org, budget);
    const now = await this.sampleNow(tx);
    const todayDay = istDayKeyOf(now);
    const { resident, chain } = await this.loadForTarget(
      tx,
      org,
      input.targetType,
      input.targetId,
      input.fieldKey,
      false,
    );
    this.assertTargetShape(input.targetType, input.targetId, input.fieldKey, chain);

    const original = currentEnvelope(input.fieldKey, resident, chain);
    if (envelopesEqual(original, input.proposed)) {
      fail(400, 'INVALID_VALUE', 'proposedValue is the same as the current value');
    }
    const effectiveDay = istDayKeyOf(input.effectiveAt.date);
    const days = candidateDays(
      input.fieldKey,
      original,
      input.proposed,
      effectiveDay,
      resident,
      chain,
    );
    const age = ageDays(days, todayDay);
    const exceptional = isExceptional(age);
    const historical = days.some((d) => d < todayDay);
    if (
      evidenceRequired({ fieldKey: input.fieldKey, historical, exceptional }) &&
      !input.evidenceReference
    ) {
      fail(400, 'INVALID_EVIDENCE', 'Supporting evidence is required for this correction');
    }
    await validateCorrection({
      tx,
      organizationId: org,
      targetId: input.targetId,
      fieldKey: input.fieldKey,
      proposed: input.proposed,
      now,
      chain,
    });

    if (input.relatedProposalId) {
      const related = await tx.correctionProposal.findFirst({
        where: { id: input.relatedProposalId, organizationId: org },
        select: { status: true, targetType: true, fieldKey: true, ...this.targetSelect },
      });
      if (!related) fail(404, 'NOT_FOUND', 'Not found');
      if (
        input.relationshipKind === 'REVERSAL' &&
        (related!.status !== 'APPLIED' ||
          related!.fieldKey !== input.fieldKey ||
          this.targetIdOf(related!) !== input.targetId)
      ) {
        fail(
          400,
          'INVALID_VALUE',
          'A reversal must reference an applied correction of the same field',
        );
      }
    }

    const slots =
      input.targetType === 'BOOKING' ? await invoiceSlotsFact(tx, org, chain!.bookingId) : null;
    const facts = snapshotFacts(input.fieldKey, resident, chain, slots);
    const snapshot = {
      policyVersion: POLICY_VERSION,
      facts,
      candidateDays: days,
      ageAtSubmission: age,
    };

    const created = await tx.correctionProposal.create({
      data: {
        organizationId: org,
        targetType: input.targetType,
        fieldKey: input.fieldKey,
        ...this.targetColumns(input.targetType, input.targetId),
        originalValue: original as unknown as Prisma.InputJsonValue,
        proposedValue: input.proposed as unknown as Prisma.InputJsonValue,
        expectedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        reason: input.reason,
        evidenceReference: input.evidenceReference,
        effectiveAt: input.effectiveAt.date,
        requestedBy: authority.userId,
        requestedRole: authority.role,
        financialImpact: FIELD_SPECS[input.fieldKey].financial,
        correlationId,
        relatedProposalId: input.relatedProposalId,
        relationKind: input.relationshipKind,
      },
    });
    await this.audit(
      tx,
      org,
      authority.userId,
      'correction.submitted',
      input.targetType,
      input.targetId,
      {
        proposalId: created.id,
        fieldKey: input.fieldKey,
        correlationId,
      },
    );
    return {
      proposalId: created.id,
      outcomeCode: 'SUBMITTED',
      status: 201,
      body: await this.detailInTx(tx, org, created.id, authority),
    };
  }

  private readonly targetSelect = {
    residentTargetId: true,
    bookingTargetId: true,
    admissionTargetId: true,
    checkInTargetId: true,
    checkOutTargetId: true,
  } as const;

  // ============================================================================================== decisions

  private async lockProposal(tx: Tx, organizationId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM correction_proposals WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    const p = await tx.correctionProposal.findFirst({ where: { id, organizationId } });
    if (!p) fail(404, 'NOT_FOUND', 'Not found');
    return p!;
  }

  private ageOfStored(
    p: { expectedSnapshot: Prisma.JsonValue },
    now: Date,
  ): { age: number; exceptional: boolean; days: string[] } {
    const days = ((p.expectedSnapshot as { candidateDays?: string[] }).candidateDays ??
      []) as string[];
    if (days.length === 0) fail(409, 'LIFECYCLE_CONFLICT', 'The correction has no age basis');
    const age = ageDays(days, istDayKeyOf(now));
    return { age, exceptional: isExceptional(age), days };
  }

  async approve(ctx: CommandContext, idempotencyKey: unknown, rawId: unknown, rawBody: unknown) {
    const id = parseUuid(rawId, 'id', 'NOT_FOUND');
    const input = parseApprove(rawBody);
    return this.run(ctx, 'APPROVE', idempotencyKey, id, input, (tx, authority, budget) =>
      this.approveInTx(tx, authority, ctx.organizationId, id, input, budget),
    );
  }

  private async approveInTx(
    tx: Tx,
    authority: Authority,
    org: string,
    id: string,
    input: { decisionReason: string; exceptionRationale: string | null },
    budget: () => number,
  ): Promise<Outcome> {
    const p = await this.lockProposal(tx, org, id);
    if (p.status !== 'PENDING')
      fail(409, 'INVALID_STATE', 'This correction has already been decided', id);
    if (p.requestedBy === authority.userId)
      fail(403, 'SELF_REVIEW', 'You cannot review your own correction', id);
    if (p.financialImpact && authority.role !== 'OWNER') {
      fail(403, 'INSUFFICIENT_ROLE', 'Only an owner can review a financial correction', id);
    }
    const fieldKey = p.fieldKey as FieldKey;
    const spec = FIELD_SPECS[fieldKey];
    const targetType = p.targetType as TargetType;
    const targetId = this.targetIdOf(p);
    if (spec.financial && !this.cfg.financialApplyEnabled()) {
      fail(409, 'FINANCE_CONFLICT', 'Applying financial corrections is not enabled yet', id);
    }

    if (spec.gated) await this.lockGate(tx, org, budget);
    const { resident, chain } = await this.loadForTarget(
      tx,
      org,
      targetType,
      targetId,
      fieldKey,
      true,
    );

    // Decision instant: sampled after the locks and before revalidation/application (Decision 3 working baseline).
    const now = await this.sampleNow(tx);
    const { exceptional, days } = this.ageOfStored(p, now);
    if (exceptional) {
      if (authority.role !== 'OWNER')
        fail(403, 'INSUFFICIENT_ROLE', 'Only an owner can review an older correction', id);
      if (!input.exceptionRationale)
        fail(400, 'INVALID_VALUE', 'exceptionRationale is required for an older correction');
    }
    const historical = days.some((d) => d < istDayKeyOf(now));
    if (evidenceRequired({ fieldKey, historical, exceptional }) && !p.evidenceReference) {
      fail(
        409,
        'EVIDENCE_REQUIRED',
        'Supporting evidence is required to approve this correction',
        id,
      );
    }

    // Snapshot comparison: ONLY after authorization, self-review, terminal-state and authority checks above.
    const slots =
      targetType === 'BOOKING' ? await invoiceSlotsFact(tx, org, chain!.bookingId) : null;
    const current = snapshotFacts(fieldKey, resident, chain, slots);
    const expected = (p.expectedSnapshot as { facts: SnapshotFacts }).facts;
    const staleCause = diffSnapshot(expected, current);
    if (staleCause) {
      await tx.correctionProposal.update({
        where: { id },
        data: {
          status: 'STALE',
          decidedBy: authority.userId,
          decidedAt: now,
          decisionReason: input.decisionReason,
          staleCause,
        },
      });
      await this.audit(tx, org, authority.userId, 'correction.stale', targetType, targetId, {
        proposalId: id,
        fieldKey,
        staleCause,
      });
      return {
        proposalId: id,
        outcomeCode: 'STALE_SOURCE',
        status: 409,
        body: null,
        throwAfterCommit: new CorrectionError(
          409,
          'STALE_SOURCE',
          'The record changed after this correction was proposed; submit a new correction',
          id,
        ),
      };
    }

    const proposed = p.proposedValue as unknown as ValueEnvelope;
    const applyInput = { tx, organizationId: org, targetId, fieldKey, proposed, now, chain };
    await validateCorrection(applyInput);

    let beforeMonths: Set<string> | null = null;
    let months: string[] = [];
    if (spec.financial && chain && fieldKey !== 'admissionDate') {
      const original = p.originalValue as unknown as ValueEnvelope;
      const touched = [dayOfInstantText(chain.startDate)];
      if (chain.checkInAt) touched.push(dayOfInstantText(chain.checkInAt));
      if (spec.kind === 'date') touched.push(original.value!, proposed.value!);
      if (fieldKey === 'checkInAt' || fieldKey === 'checkOutAt') {
        touched.push(dayOfInstantText(original.value!), dayOfInstantText(proposed.value!));
      }
      months = this.finance.correctionMonthWindow(touched.sort()[0]!, istDayKeyOf(now));
      beforeMonths = await this.finance.billableMonthKeys(tx, org, chain.bookingId, months);
    }

    const domainAction = await applyColumn(applyInput);
    if (chain && (fieldKey === 'checkInAt' || fieldKey === 'checkOutAt')) {
      await recordAssignmentReplacement(tx, {
        organizationId: org,
        bookingId: chain.bookingId,
        residentId: chain.residentId,
        proposalId: id,
        actorUserId: authority.userId,
        field: fieldKey,
        value: proposed.value!,
      });
    }
    await this.audit(tx, org, authority.userId, domainAction, targetType, targetId, {
      proposalId: id,
      fieldKey,
    });

    if (beforeMonths && chain) {
      await this.finance.applyCorrectionConsequences(tx, {
        organizationId: org,
        actorUserId: authority.userId,
        proposalId: id,
        bookingId: chain.bookingId,
        residentId: chain.residentId,
        before: beforeMonths,
        months,
      });
    }

    await tx.correctionProposal.update({
      where: { id },
      data: {
        status: 'APPLIED',
        decidedBy: authority.userId,
        decidedAt: now,
        appliedAt: now,
        decisionReason: input.decisionReason,
        exceptionRationale: input.exceptionRationale,
        appliedValue: proposed as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit(tx, org, authority.userId, 'correction.applied', targetType, targetId, {
      proposalId: id,
      fieldKey,
    });
    return {
      proposalId: id,
      outcomeCode: 'APPLIED',
      status: 200,
      body: await this.detailInTx(tx, org, id, authority),
    };
  }

  async reject(ctx: CommandContext, idempotencyKey: unknown, rawId: unknown, rawBody: unknown) {
    const id = parseUuid(rawId, 'id', 'NOT_FOUND');
    const input = parseReasonOnly(rawBody);
    return this.run(ctx, 'REJECT', idempotencyKey, id, input, async (tx, authority) => {
      const p = await this.lockProposal(tx, ctx.organizationId, id);
      if (p.status !== 'PENDING')
        fail(409, 'INVALID_STATE', 'This correction has already been decided', id);
      if (p.requestedBy === authority.userId)
        fail(403, 'SELF_REVIEW', 'You cannot review your own correction', id);
      const now = await this.sampleNow(tx);
      const { exceptional } = this.ageOfStored(p, now);
      if (!reviewerRoleAllowed(authority.role, p, exceptional)) {
        fail(403, 'INSUFFICIENT_ROLE', 'Only an owner can review this correction', id);
      }
      await tx.correctionProposal.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedBy: authority.userId,
          decidedAt: now,
          decisionReason: input.reason,
        },
      });
      await this.audit(
        tx,
        ctx.organizationId,
        authority.userId,
        'correction.rejected',
        p.targetType as TargetType,
        this.targetIdOf(p),
        {
          proposalId: id,
          fieldKey: p.fieldKey,
        },
      );
      return {
        proposalId: id,
        outcomeCode: 'REJECTED',
        status: 200,
        body: await this.detailInTx(tx, ctx.organizationId, id, authority),
      };
    });
  }

  async withdraw(ctx: CommandContext, idempotencyKey: unknown, rawId: unknown, rawBody: unknown) {
    const id = parseUuid(rawId, 'id', 'NOT_FOUND');
    const input = parseReasonOnly(rawBody);
    return this.run(ctx, 'WITHDRAW', idempotencyKey, id, input, async (tx, authority) => {
      const p = await this.lockProposal(tx, ctx.organizationId, id);
      if (p.status !== 'PENDING')
        fail(409, 'INVALID_STATE', 'This correction has already been decided', id);
      if (p.requestedBy !== authority.userId)
        fail(403, 'INSUFFICIENT_ROLE', 'Only the requester can withdraw a correction', id);
      const now = await this.sampleNow(tx);
      await tx.correctionProposal.update({
        where: { id },
        data: {
          status: 'WITHDRAWN',
          decidedBy: authority.userId,
          decidedAt: now,
          decisionReason: input.reason,
        },
      });
      await this.audit(
        tx,
        ctx.organizationId,
        authority.userId,
        'correction.withdrawn',
        p.targetType as TargetType,
        this.targetIdOf(p),
        {
          proposalId: id,
          fieldKey: p.fieldKey,
        },
      );
      return {
        proposalId: id,
        outcomeCode: 'WITHDRAWN',
        status: 200,
        body: await this.detailInTx(tx, ctx.organizationId, id, authority),
      };
    });
  }

  // =================================================================================== Finance review

  /**
   * Independent OWNER resolution of a correction billing gap or issued-invoice review. It never changes an invoice or a
   * payment and never issues or creates anything: RELEASED only lets a normal explicit createDraft + issue proceed;
   * NO_SUPPORTED_REMEDY records that none exists; OPERATION_RECORDED references an existing credit/reversal/void/payment of
   * the SAME invoice (composite keys make a different invoice impossible). Runs under the organization gate so it is
   * serialized with generation, which reads gaps under the same gate.
   */
  async resolveFinanceReview(
    ctx: CommandContext,
    idempotencyKey: unknown,
    rawLinkId: unknown,
    rawBody: unknown,
  ) {
    const linkId = parseUuid(rawLinkId, 'linkId', 'NOT_FOUND');
    const input = parseResolve(rawBody);
    const link0 = await this.prisma.db.correctionFinanceLink.findFirst({
      where: { id: linkId, organizationId: ctx.organizationId },
      select: { proposalId: true },
    });
    if (!link0) fail(404, 'NOT_FOUND', 'Not found');
    return this.run(
      ctx,
      'RESOLVE',
      idempotencyKey,
      link0!.proposalId,
      { linkId, ...input },
      async (tx, authority, budget) => {
        if (authority.role !== 'OWNER')
          fail(403, 'INSUFFICIENT_ROLE', 'Only an owner can resolve a finance review');
        await this.lockGate(tx, ctx.organizationId, budget);
        const link = await tx.correctionFinanceLink.findFirst({
          where: { id: linkId, organizationId: ctx.organizationId },
          include: { proposal: { select: { requestedBy: true, decidedBy: true } } },
        });
        if (!link || (link.kind !== 'BILLING_GAP' && link.kind !== 'INVOICE_REVIEW'))
          fail(404, 'NOT_FOUND', 'Not found');
        if (link!.proposal.requestedBy === authority.userId) {
          fail(
            403,
            'SELF_REVIEW',
            'You cannot resolve a review of your own correction',
            link!.proposalId,
          );
        }
        const already = await tx.correctionFinanceLink.findFirst({
          where: { organizationId: ctx.organizationId, kind: 'RESOLUTION', resolvesLinkId: linkId },
          select: { id: true },
        });
        if (already)
          fail(409, 'INVALID_STATE', 'This review is already resolved', link!.proposalId);
        const op: Prisma.CorrectionFinanceLinkUncheckedCreateInput = {
          organizationId: ctx.organizationId,
          proposalId: link!.proposalId,
          kind: 'RESOLUTION',
          outcome: input.outcome,
          residentId: link!.residentId,
          bookingId: link!.bookingId,
          periodStart: link!.periodStart,
          invoiceId: link!.invoiceId,
          resolvesLinkId: linkId,
          resolvedBy: authority.userId,
          reason: input.reason,
        };
        if (input.outcome === 'OPERATION_RECORDED') {
          if (!link!.invoiceId || !input.operation)
            fail(
              400,
              'INVALID_VALUE',
              'An operation can only be recorded against an invoice review',
            );
          const column = {
            adjustment: 'adjustmentId',
            reversal: 'reversalId',
            void: 'voidId',
            payment: 'paymentId',
          }[input.operation!.type] as 'adjustmentId' | 'reversalId' | 'voidId' | 'paymentId';
          const table = {
            adjustment: 'invoice_adjustments',
            reversal: 'payment_reversals',
            void: 'invoice_voids',
            payment: 'payments',
          }[input.operation!.type];
          const found = await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id = ${input.operation!.id}::uuid AND invoice_id = ${link!.invoiceId}::uuid AND organization_id = ${ctx.organizationId}::uuid`,
          );
          if (found.length === 0) fail(404, 'NOT_FOUND', 'Not found');
          op[column] = input.operation!.id;
        }
        const created = await tx.correctionFinanceLink.create({ data: op });
        await tx.auditEvent.create({
          data: {
            organizationId: ctx.organizationId,
            actorUserId: authority.userId,
            action: 'correction.finance_review.resolved',
            targetType: 'booking',
            targetId: link!.bookingId ?? link!.invoiceId,
            requestId: auditRequestId(),
            metadata: {
              proposalId: link!.proposalId,
              linkId,
              resolutionId: created.id,
              outcome: input.outcome,
            },
          },
        });
        return {
          proposalId: link!.proposalId,
          outcomeCode: `RESOLVED_${input.outcome}`,
          status: 200,
          body: { id: created.id, resolvesLinkId: linkId, outcome: input.outcome },
        };
      },
    );
  }

  async listFinanceReviews(ctx: CommandContext, rawQuery: unknown) {
    if (!canSubmit(ctx.role)) fail(403, 'INSUFFICIENT_ROLE', 'You are not permitted to do this');
    const q = (typeof rawQuery === 'object' && rawQuery !== null ? rawQuery : {}) as Record<
      string,
      unknown
    >;
    const open = q.resolved !== 'true';
    const rows = await this.prisma.db.correctionFinanceLink.findMany({
      where: {
        organizationId: ctx.organizationId,
        kind: { in: ['BILLING_GAP', 'INVOICE_REVIEW'] },
        resolutions: open ? { none: {} } : { some: {} },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        kind: true,
        proposalId: true,
        residentId: true,
        bookingId: true,
        invoiceId: true,
        periodStart: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((r) => ({
        ...r,
        periodStart: r.periodStart?.toISOString().slice(0, 10) ?? null,
      })),
    };
  }

  // =================================================================================================== reads

  private async viewerAllowedActions(
    p: {
      status: string;
      requestedBy: string;
      financialImpact: boolean;
      expectedSnapshot: Prisma.JsonValue;
    },
    viewer: { userId: string; role: string },
    now: Date,
  ): Promise<string[]> {
    if (p.status !== 'PENDING') return [];
    const actions: string[] = [];
    if (p.requestedBy === viewer.userId) actions.push('withdraw');
    else {
      const { exceptional } = this.ageOfStored(p, now);
      if (reviewerRoleAllowed(viewer.role, p, exceptional)) actions.push('approve', 'reject');
    }
    return actions;
  }

  private async toDetail(
    db: Pick<Tx, 'correctionFinanceLink' | 'correctionProposal'>,
    organizationId: string,
    id: string,
    viewer: { userId: string; role: string },
    now: Date,
  ) {
    const p = await db.correctionProposal.findFirst({
      where: { id, organizationId },
      include: {
        requester: { select: { id: true, displayName: true } },
        decider: { select: { id: true, displayName: true } },
      },
    });
    if (!p) fail(404, 'NOT_FOUND', 'Not found');
    const links = await db.correctionFinanceLink.findMany({
      where: { organizationId, proposalId: id, kind: { in: ['BILLING_GAP', 'INVOICE_REVIEW'] } },
      select: {
        id: true,
        kind: true,
        invoiceId: true,
        bookingId: true,
        periodStart: true,
        resolutions: { select: { outcome: true } },
      },
    });
    const unresolved = links.filter((l) => l.resolutions.length === 0);
    const { age, exceptional } = this.ageOfStored(p!, now);
    return {
      id: p!.id,
      targetType: p!.targetType,
      targetId: this.targetIdOf(p!),
      fieldKey: p!.fieldKey,
      status: p!.status,
      originalValue: p!.originalValue,
      proposedValue: p!.proposedValue,
      appliedValue: p!.appliedValue,
      effectiveAt: p!.effectiveAt.toISOString(),
      recordedAt: p!.recordedAt.toISOString(),
      requestedAt: p!.recordedAt.toISOString(),
      requester: p!.requester,
      reviewer: p!.decider,
      decidedAt: p!.decidedAt?.toISOString() ?? null,
      appliedAt: p!.appliedAt?.toISOString() ?? null,
      reason: p!.reason,
      decisionReason: p!.decisionReason,
      exceptionRationale: p!.exceptionRationale,
      evidenceReference: p!.evidenceReference,
      staleCause: p!.staleCause,
      financialImpact: p!.financialImpact,
      ageDays: age,
      normalWindowDays: NORMAL_WINDOW_DAYS,
      exceptionRequired: exceptional,
      relatedProposalId: p!.relatedProposalId,
      relationKind: p!.relationKind,
      // APPLIED describes only the source fact; the money review is separate and never claimed resolved.
      financeReviewStatus:
        links.length === 0 ? 'NONE' : unresolved.length > 0 ? 'REVIEW_REQUIRED' : 'RESOLVED',
      financeReviewLinks: links.map((l) => ({
        id: l.id,
        kind: l.kind,
        invoiceId: l.invoiceId,
        bookingId: l.bookingId,
        period: l.periodStart?.toISOString().slice(0, 10) ?? null,
        resolved: l.resolutions.length > 0,
      })),
      allowedActions: await this.viewerAllowedActions(p!, viewer, now),
    };
  }

  private async detailInTx(tx: Tx, organizationId: string, id: string, viewer: Authority) {
    return this.toDetail(tx, organizationId, id, viewer, await this.sampleNow(tx));
  }

  async detail(ctx: CommandContext, rawId: unknown) {
    if (!canSubmit(ctx.role)) fail(403, 'INSUFFICIENT_ROLE', 'You are not permitted to do this');
    const id = parseUuid(rawId, 'id', 'NOT_FOUND');
    return this.toDetail(this.prisma.db, ctx.organizationId, id, ctx, new Date());
  }

  private summarize(p: {
    id: string;
    targetType: string;
    fieldKey: string;
    status: string;
    financialImpact: boolean;
    recordedAt: Date;
    effectiveAt: Date;
    decidedAt: Date | null;
    requester: { id: string; displayName: string };
    expectedSnapshot: Prisma.JsonValue;
    residentTargetId: string | null;
    bookingTargetId: string | null;
    admissionTargetId: string | null;
    checkInTargetId: string | null;
    checkOutTargetId: string | null;
  }) {
    return {
      id: p.id,
      targetType: p.targetType,
      targetId: this.targetIdOf(p),
      fieldKey: p.fieldKey,
      status: p.status,
      financialImpact: p.financialImpact,
      requester: p.requester,
      recordedAt: p.recordedAt.toISOString(),
      effectiveAt: p.effectiveAt.toISOString(),
      decidedAt: p.decidedAt?.toISOString() ?? null,
      exceptionRequired:
        p.status === 'PENDING' ? this.ageOfStored(p, new Date()).exceptional : false,
    };
  }

  private async page(ctx: CommandContext, query: ReturnType<typeof parseListQuery>) {
    const where: Prisma.CorrectionProposalWhereInput = { organizationId: ctx.organizationId };
    if (query.status) where.status = query.status as 'PENDING';
    if (query.financialImpact !== undefined) where.financialImpact = query.financialImpact;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId)
      Object.assign(where, this.targetColumnsWhere(query.targetType ?? 'RESIDENT', query.targetId));
    const [items, total] = await Promise.all([
      this.prisma.db.correctionProposal.findMany({
        where,
        orderBy: [{ recordedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { requester: { select: { id: true, displayName: true } } },
      }),
      this.prisma.db.correctionProposal.count({ where }),
    ]);
    return {
      items: items.map((p) => this.summarize(p)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async list(ctx: CommandContext, rawQuery: unknown) {
    if (!canSubmit(ctx.role)) fail(403, 'INSUFFICIENT_ROLE', 'You are not permitted to do this');
    return this.page(ctx, parseListQuery(rawQuery));
  }

  async history(ctx: CommandContext, rawQuery: unknown) {
    if (!canSubmit(ctx.role)) fail(403, 'INSUFFICIENT_ROLE', 'You are not permitted to do this');
    const query = parseListQuery(rawQuery, true);
    // Validate the target belongs to this organization before listing anything about it.
    const exists = await this.targetExists(ctx.organizationId, query.targetType!, query.targetId!);
    if (!exists) fail(404, 'NOT_FOUND', 'Not found');
    return this.page(ctx, query);
  }

  private async targetExists(
    organizationId: string,
    targetType: TargetType,
    id: string,
  ): Promise<boolean> {
    const db = this.prisma.db;
    const where = { id, organizationId };
    switch (targetType) {
      case 'RESIDENT':
        return (await db.resident.count({ where })) > 0;
      case 'BOOKING':
        return (await db.booking.count({ where })) > 0;
      case 'ADMISSION':
        return (await db.admission.count({ where })) > 0;
      case 'CHECK_IN':
        return (await db.checkIn.count({ where })) > 0;
      case 'CHECK_OUT':
        return (await db.checkOut.count({ where })) > 0;
    }
  }
}
