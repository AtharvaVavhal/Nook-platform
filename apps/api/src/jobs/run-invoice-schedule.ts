import 'reflect-metadata';
import { runCli } from './invoice-schedule.cli.js';

/**
 * Entry point of the daily invoice job: `node dist/jobs/run-invoice-schedule.js`.
 * Deliberately does NOT import dotenv: a stray .env must never choose the database for a job that writes invoices.
 */
runCli(process.argv.slice(2), process.env)
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(() => {
    // Let stdout drain, then end the process: a scheduled job must always exit.
    setTimeout(() => process.exit(process.exitCode ?? 1), 200).unref();
  });
