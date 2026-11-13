import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { log } from '../observability/json-logger.js';
import { serializeError } from '../observability/redact.js';
import { runWithRequest } from '../observability/request-context.js';
import { isTransientError, schedulerMonths } from './schedule-months.js';

export interface SchedulerOptions {
  /** The moment the run is for (default: now). Months are chosen in Asia/Kolkata. */
  now?: Date;
  /** How many months before the current one are also covered (default 1: previous and current). */
  lookbackMonths?: number;
  /** Plan only: nothing is written, not even an audit event. */
  dryRun?: boolean;
  /** Restrict the run to these organizations (a supervised first run, or a test). Default: every ACTIVE organization. */
  organizationIds?: readonly string[];
  /** Identifies the run in every log line and audit event it writes. */
  runId?: string;
  maxAttempts?: number;
  backoffMs?: number;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
}

export interface OrgMonthResult {
  organizationId: string;
  month: string;
  status: 'ok' | 'dry-run' | 'failed';
  attempts: number;
  durationMs: number;
  eligibleBookings?: number;
  created?: number;
  skippedExisting?: number;
  skippedZeroPrice?: number;
  /** Booking-months held back because a correction left an unresolved OWNER review (never auto-issued). */
  skippedPendingReview?: number;
  error?: { name: string; code?: string | undefined; message: string };
}

export interface SchedulerResult {
  runId: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  months: string[];
  organizations: number;
  created: number;
  failed: number;
  results: OrgMonthResult[];
}

/** The two finance operations the scheduler needs (narrowed so a test can stand in for them). */
export type SchedulerFinance = Pick<FinanceService, 'generateMonthly' | 'previewMonthly'>;

/**
 * Automatic monthly invoicing. For every ACTIVE organization, one at a time, and for each month from oldest to newest, it
 * runs the same generation the API uses, with the system actor (no user) and `source: 'scheduler'`.
 *
 * Why it is safe to run twice, late, or concurrently with itself or with a person generating invoices:
 *  - generation is idempotent: a booking that already has an active invoice for the month is skipped, so a rerun creates
 *    nothing and writes no audit event;
 *  - each organization-month is ONE transaction under the organization's invoice-numbering advisory lock, and the partial
 *    unique indexes on invoices are the database-level backstop, so two overlapping runs cannot create a duplicate or leave
 *    a gap in the numbers;
 *  - a failure in one organization-month is retried when it is transient, otherwise recorded and skipped: other
 *    organizations and months still run, and the next run picks the failed one up again.
 * Tenant isolation: everything is done per organization id; no query spans organizations except the list of ids.
 */
@Injectable()
export class InvoiceSchedulerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceService) private readonly finance: SchedulerFinance,
  ) {}

  async run(options: SchedulerOptions = {}): Promise<SchedulerResult> {
    const startedAt = new Date();
    const now = options.now ?? startedAt;
    const runId = options.runId ?? randomUUID();
    const dryRun = options.dryRun === true;
    const lookback = options.lookbackMonths ?? 1;
    const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    const backoffMs = options.backoffMs ?? 250;
    const sleep =
      options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const months = schedulerMonths(now, lookback);

    // Every log line and audit event of the run carries the run id as its request id.
    return runWithRequest({ requestId: runId }, async () => {
      const orgs = await this.prisma.db.organization.findMany({
        where: {
          status: 'ACTIVE',
          ...(options.organizationIds ? { id: { in: [...options.organizationIds] } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      log.info('invoice scheduler started', {
        context: 'invoice-scheduler',
        runId,
        dryRun,
        months,
        organizations: orgs.length,
      });

      const results: OrgMonthResult[] = [];
      for (const org of orgs) {
        for (const month of months) {
          results.push(
            await this.processOrgMonth(org.id, month, {
              runId,
              dryRun,
              maxAttempts,
              backoffMs,
              sleep,
            }),
          );
        }
      }

      const created = results.reduce((sum, r) => sum + (r.created ?? 0), 0);
      const failed = results.filter((r) => r.status === 'failed').length;
      const finishedAt = new Date();
      const result: SchedulerResult = {
        runId,
        dryRun,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        months,
        organizations: orgs.length,
        created,
        failed,
        results,
      };
      if (!dryRun) await this.recordRun(result);
      log[failed > 0 ? 'warn' : 'info']('invoice scheduler finished', {
        context: 'invoice-scheduler',
        runId,
        dryRun,
        months,
        organizations: orgs.length,
        created,
        failed,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
      return result;
    });
  }

  private async processOrgMonth(
    organizationId: string,
    month: string,
    ctx: {
      runId: string;
      dryRun: boolean;
      maxAttempts: number;
      backoffMs: number;
      sleep: (ms: number) => Promise<void>;
    },
  ): Promise<OrgMonthResult> {
    const started = Date.now();
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        if (ctx.dryRun) {
          const plan = await this.finance.previewMonthly(organizationId, month);
          return this.finish(organizationId, month, 'dry-run', attempts, started, {
            eligibleBookings: plan.eligibleBookings,
            created: plan.wouldCreate,
            skippedExisting: plan.skippedExisting,
            skippedZeroPrice: plan.skippedZeroPrice,
            skippedPendingReview: plan.skippedPendingReview,
          });
        }
        const done = await this.finance.generateMonthly(
          organizationId,
          null,
          { month, issue: true },
          { source: 'scheduler' },
        );
        return this.finish(organizationId, month, 'ok', attempts, started, {
          eligibleBookings: done.eligibleBookings,
          created: done.created,
          skippedExisting: done.skippedExisting,
          skippedZeroPrice: done.skippedZeroPrice,
          skippedPendingReview: done.skippedPendingReview,
        });
      } catch (error) {
        if (attempts < ctx.maxAttempts && isTransientError(error)) {
          log.warn('invoice scheduler will retry', {
            context: 'invoice-scheduler',
            runId: ctx.runId,
            organizationId,
            month,
            attempt: attempts,
            err: serializeError(error),
          });
          await ctx.sleep(ctx.backoffMs * 2 ** (attempts - 1));
          continue;
        }
        const info = serializeError(error);
        const result: OrgMonthResult = {
          organizationId,
          month,
          status: 'failed',
          attempts,
          durationMs: Date.now() - started,
          error: { name: info.name, code: info.code, message: info.message },
        };
        log.error('invoice scheduler failed for an organization month', {
          context: 'invoice-scheduler',
          runId: ctx.runId,
          organizationId,
          month,
          attempts,
          err: info,
        });
        if (!ctx.dryRun) await this.recordFailure(organizationId, month, ctx.runId, result);
        return result;
      }
    }
  }

  private finish(
    organizationId: string,
    month: string,
    status: 'ok' | 'dry-run',
    attempts: number,
    started: number,
    counts: Pick<
      OrgMonthResult,
      | 'eligibleBookings'
      | 'created'
      | 'skippedExisting'
      | 'skippedZeroPrice'
      | 'skippedPendingReview'
    >,
  ): OrgMonthResult {
    const result: OrgMonthResult = {
      organizationId,
      month,
      status,
      attempts,
      durationMs: Date.now() - started,
      ...counts,
    };
    // quiet when there was nothing to do; the run summary still counts it
    const level = (counts.created ?? 0) > 0 || attempts > 1 ? 'info' : 'debug';
    log[level]('invoice scheduler processed an organization month', {
      context: 'invoice-scheduler',
      organizationId,
      month,
      status,
      attempts,
      eligibleBookings: counts.eligibleBookings,
      created: counts.created,
      skippedExisting: counts.skippedExisting,
      skippedZeroPrice: counts.skippedZeroPrice,
      skippedPendingReview: counts.skippedPendingReview,
      durationMs: result.durationMs,
    });
    return result;
  }

  /** A failure is recorded in the organization's own audit trail, in a transaction of its own (never rolled back with the work). */
  private async recordFailure(
    organizationId: string,
    month: string,
    runId: string,
    result: OrgMonthResult,
  ): Promise<void> {
    try {
      await this.prisma.db.auditEvent.create({
        data: {
          organizationId,
          actorUserId: null,
          action: 'finance.scheduler.failed',
          targetType: 'scheduler_run',
          targetId: runId,
          requestId: runId,
          metadata: {
            month,
            attempts: result.attempts,
            error: {
              name: result.error?.name ?? 'Error',
              code: result.error?.code ?? null,
              message: result.error?.message ?? '',
            },
          },
        },
      });
    } catch (error) {
      log.error('could not record a scheduler failure in the audit trail', {
        context: 'invoice-scheduler',
        runId,
        organizationId,
        err: serializeError(error),
      });
    }
  }

  /** One event per live run, not tied to an organization (the per-invoice events are the organization-level trail). */
  private async recordRun(result: SchedulerResult): Promise<void> {
    try {
      await this.prisma.db.auditEvent.create({
        data: {
          organizationId: null,
          actorUserId: null,
          action: 'finance.scheduler.run',
          targetType: 'scheduler_run',
          targetId: result.runId,
          requestId: result.runId,
          metadata: {
            months: result.months,
            organizations: result.organizations,
            created: result.created,
            failed: result.failed,
          },
        },
      });
    } catch (error) {
      log.error('could not record the scheduler run in the audit trail', {
        context: 'invoice-scheduler',
        runId: result.runId,
        err: serializeError(error),
      });
    }
  }
}
