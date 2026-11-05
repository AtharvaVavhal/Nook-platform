import { parseArgs } from 'node:util';
import { loadRuntimeConfig } from '../config.js';
import { log } from '../observability/json-logger.js';
import {
  flushErrorReporter,
  reportError,
  setErrorReporter,
} from '../observability/error-reporter.js';
import { initSentryReporter } from '../observability/sentry-reporter.js';
import type { SchedulerResult } from './invoice-scheduler.service.js';

export const EXIT_OK = 0;
/** At least one organization-month failed (the others ran). */
export const EXIT_FAILED = 1;
/** The job refused to start: disabled, wrong target, bad arguments or bad configuration. Nothing was touched. */
export const EXIT_REFUSED = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CliArguments {
  dryRun: boolean;
  lookbackMonths: number;
  organizationIds: string[];
  confirmTarget: string | undefined;
}

export class CliRefusal extends Error {}

export function parseCliArguments(argv: readonly string[]): CliArguments {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    values = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        'dry-run': { type: 'boolean' },
        lookback: { type: 'string' },
        org: { type: 'string', multiple: true },
        'confirm-target': { type: 'string' },
      },
    }).values;
  } catch (error) {
    throw new CliRefusal(
      `invalid arguments (${(error as Error).message}). Usage: run-invoice-schedule [--dry-run] [--lookback 0-12] [--org <uuid>]... [--confirm-target host:port/database]`,
    );
  }
  const rawLookback = values.lookback;
  let lookbackMonths = 1;
  if (rawLookback !== undefined) {
    if (
      typeof rawLookback !== 'string' ||
      !/^\d{1,2}$/.test(rawLookback) ||
      Number(rawLookback) > 12
    ) {
      throw new CliRefusal('--lookback must be a whole number between 0 and 12');
    }
    lookbackMonths = Number(rawLookback);
  }
  const organizationIds = (values.org as string[] | undefined) ?? [];
  for (const id of organizationIds) {
    if (!UUID.test(id)) throw new CliRefusal('--org must be an organization UUID');
  }
  return {
    dryRun: values['dry-run'] === true,
    lookbackMonths,
    organizationIds,
    confirmTarget:
      typeof values['confirm-target'] === 'string' ? values['confirm-target'] : undefined,
  };
}

/** `host:port/database` of a connection URL, with no credentials. */
export function describeTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.hostname}:${url.port || '5432'}/${url.pathname.replace(/^\//, '')}`;
}

/**
 * The job's front door. It returns an exit code instead of exiting, so tests can run it.
 *
 *   0  every organization-month succeeded (or there was nothing to do)
 *   1  at least one organization-month failed; the others ran, and the failures are in the log and the audit trail
 *   2  the job refused to start and touched nothing: bad arguments or configuration, not enabled, or the confirmed
 *      target does not match DATABASE_URL
 *
 * A live run needs BILLING_SCHEDULER_ENABLED=true AND --confirm-target host:port/database equal to the database the job is
 * about to write to, so a wrongly pointed variable can never invoice the wrong environment. A dry run needs neither and writes
 * nothing. This file never loads a .env file: the environment must come from the platform.
 */
export async function runCli(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let args: CliArguments;
  let config: ReturnType<typeof loadRuntimeConfig>;
  try {
    args = parseCliArguments(argv);
    config = loadRuntimeConfig(env);
    log.configure({
      level: config.logLevel,
      base: { env: config.appEnv, job: 'invoice-scheduler' },
    });
    if (!config.databaseUrl) throw new CliRefusal('DATABASE_URL is not set');
    const target = describeTarget(config.databaseUrl);
    if (!args.dryRun) {
      if (env.BILLING_SCHEDULER_ENABLED !== 'true') {
        throw new CliRefusal(
          'the scheduler is disabled: set BILLING_SCHEDULER_ENABLED=true to run it (use --dry-run to look)',
        );
      }
      if (!args.confirmTarget) {
        throw new CliRefusal(
          `--confirm-target is required for a live run (the configured target is ${target})`,
        );
      }
    }
    if (args.confirmTarget !== undefined && args.confirmTarget !== target) {
      throw new CliRefusal(`--confirm-target does not match the configured target ${target}`);
    }
    log.info('invoice scheduler starting', {
      context: 'invoice-scheduler',
      target,
      dryRun: args.dryRun,
      lookbackMonths: args.lookbackMonths,
      organizationFilter: args.organizationIds.length || null,
    });
  } catch (error) {
    log.error('invoice scheduler refused to start', {
      context: 'invoice-scheduler',
      detail: error instanceof Error ? error.message : 'invalid configuration',
    });
    return EXIT_REFUSED;
  }

  if (config.sentryDsn) {
    setErrorReporter(
      initSentryReporter({
        dsn: config.sentryDsn,
        environment: config.sentryEnvironment,
        release: env.RAILWAY_GIT_COMMIT_SHA,
      }),
    );
  }

  // Loaded only now, so a refusal above never builds the application (or touches the database).
  const [{ NestFactory }, { JobsModule }, { InvoiceSchedulerService }] = await Promise.all([
    import('@nestjs/core'),
    import('./jobs.module.js'),
    import('./invoice-scheduler.service.js'),
  ]);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    app = await NestFactory.createApplicationContext(JobsModule, { logger: false });
    const result: SchedulerResult = await app.get(InvoiceSchedulerService).run({
      dryRun: args.dryRun,
      lookbackMonths: args.lookbackMonths,
      ...(args.organizationIds.length ? { organizationIds: args.organizationIds } : {}),
    });
    for (const failed of result.results.filter((r) => r.status === 'failed')) {
      reportError(new Error(`${failed.error?.name ?? 'Error'}: ${failed.error?.message ?? ''}`), {
        status: 500,
        requestId: result.runId,
        organizationId: failed.organizationId,
      });
    }
    return result.failed > 0 ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    log.error('invoice scheduler crashed', { context: 'invoice-scheduler', err: error });
    reportError(error, { status: 500 });
    return EXIT_FAILED;
  } finally {
    await app?.close().catch(() => undefined);
    await flushErrorReporter(2000);
  }
}
