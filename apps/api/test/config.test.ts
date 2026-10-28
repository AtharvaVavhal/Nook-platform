import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRuntimeConfig, parseDatabaseUrl, parsePort } from '../src/config.js';

test('parsePort uses the documented local default', () => {
  assert.equal(parsePort(undefined), 3000);
});

test('parsePort rejects out-of-range values', () => {
  assert.throws(() => parsePort('65536'), /between 1 and 65535/);
  assert.throws(() => parsePort('3e3'), /between 1 and 65535/);
});

test('parseDatabaseUrl accepts postgres URLs and rejects other protocols', () => {
  assert.equal(
    parseDatabaseUrl('postgresql://local:local@localhost:5432/nook_dev'),
    'postgresql://local:local@localhost:5432/nook_dev',
  );
  assert.throws(() => parseDatabaseUrl('https://example.com'), /postgres/);
});

test('loadRuntimeConfig does not require a database for the API shell', () => {
  const config = loadRuntimeConfig({
    APP_ENV: 'test',
    PORT: '3100',
    WEB_ORIGIN: 'http://localhost:5173',
  });
  assert.equal(config.port, 3100);
  assert.equal(config.databaseUrl, undefined);
});
