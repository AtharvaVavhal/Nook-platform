import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { loadRuntimeConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const config = loadRuntimeConfig();
  const app = await NestFactory.create(AppModule, { abortOnError: true });
  // Behind a reverse proxy the client address (used for sign-in throttling) comes from X-Forwarded-For. That
  // header is trusted only when the operator states how many proxies sit in front of the API.
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? '0');
  if (Number.isInteger(proxyHops) && proxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', proxyHops);
  }
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
