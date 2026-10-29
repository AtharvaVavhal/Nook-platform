import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { HealthController } from '../src/health.controller.js';

// tsx (esbuild) does not emit decorator metadata, so implicit constructor injection silently
// yields undefined under tsx. Every injectable must use an explicit @Inject(Token).
test('constructor injection resolves under the tsx runner', async () => {
  const saved = { APP_ENV: process.env.APP_ENV, DATABASE_URL: process.env.DATABASE_URL };
  process.env.APP_ENV = 'test';
  delete process.env.DATABASE_URL;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const controller = app.get(HealthController);
    // With no database configured the route must answer 503, never fail with a TypeError (500).
    await assert.rejects(
      () => controller.getDatabaseHealth(),
      (error: unknown) => error instanceof ServiceUnavailableException,
    );
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
