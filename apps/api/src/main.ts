import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadRuntimeConfig } from './config.js';
import { log } from './observability/json-logger.js';
import { setErrorReporter } from './observability/error-reporter.js';
import { installProcessHandlers } from './observability/process-handlers.js';
import { initSentryReporter } from './observability/sentry-reporter.js';

function readConfig() {
  try {
    return loadRuntimeConfig();
  } catch (error) {
    // Configuration errors name the variable and never contain its value, so they are safe (and necessary) to show.
    const reason = error instanceof Error ? error.message : 'invalid configuration';
    log.error('configuration is invalid; the API will not start', {
      context: 'bootstrap',
      detail: reason,
    });
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  installProcessHandlers();
  const config = readConfig();
  if (config.sentryDsn) {
    // Off unless SENTRY_DSN is set. The DSN is a secret and is never logged.
    setErrorReporter(
      initSentryReporter({
        dsn: config.sentryDsn,
        environment: config.sentryEnvironment,
        release: process.env.RAILWAY_GIT_COMMIT_SHA,
      }),
    );
    log.info('error reporting enabled', {
      context: 'bootstrap',
      provider: 'sentry',
      environment: config.sentryEnvironment,
    });
  }
  const app = await NestFactory.create(AppModule, { abortOnError: true, bufferLogs: true });
  configureApp(app, config);
  await app.listen(config.port, '0.0.0.0');
  log.info('API listening', {
    context: 'bootstrap',
    port: config.port,
    env: config.appEnv,
    trustProxyHops: config.trustProxyHops,
    logLevel: config.logLevel,
  });
}

bootstrap().catch((error: unknown) => {
  // The message is scrubbed and the stack reduced to frames by the logger; a failure here is never silent.
  log.error('API failed to start', { context: 'bootstrap', err: error });
  setTimeout(() => process.exit(1), 100).unref();
  process.exitCode = 1;
});
