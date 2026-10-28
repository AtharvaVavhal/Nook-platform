import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { loadRuntimeConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const config = loadRuntimeConfig();
  const app = await NestFactory.create(AppModule, { abortOnError: true });
  app.use(helmet());
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

bootstrap().catch(() => {
  // Avoid writing configuration values or credentials to stdout/stderr.
  process.stderr.write('Nook API failed to start. Check local configuration and runtime logs.\n');
  process.exitCode = 1;
});
