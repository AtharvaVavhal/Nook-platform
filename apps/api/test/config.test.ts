import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadRuntimeConfig,
  parseDatabaseUrl,
  parsePort,
  parseTrustProxyHops,
} from '../src/config.js';

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

test('database URL validation preserves startup options, pooling parameters and encoded credentials', () => {
  const url =
    'postgresql://test:p%40ss%2Fword@localhost:5545/test?options=-c%20statement_timeout%3D1234%20-c%20timezone%3DAsia%2FKolkata&connection_limit=3&pgbouncer=true&sslmode=require';
  assert.equal(parseDatabaseUrl(url), url);
  assert.equal(loadRuntimeConfig({ APP_ENV: 'test', DATABASE_URL: url }).databaseUrl, url);
});

test('loadRuntimeConfig does not require a database for the API shell', () => {
  const config = loadRuntimeConfig({
    APP_ENV: 'test',
    PORT: '3100',
    WEB_ORIGIN: 'http://localhost:5173',
  });
  assert.equal(config.port, 3100);
  assert.equal(config.databaseUrl, undefined);
  assert.equal(config.secureCookies, false);
});

test('production runtime configuration requires an HTTPS application origin', () => {
  assert.throws(
    () =>
      loadRuntimeConfig({
        APP_ENV: 'production',
        WEB_ORIGIN: 'http://localhost:5173',
      }),
    /HTTPS in production/,
  );
  assert.equal(
    loadRuntimeConfig({
      APP_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.com',
      TRUST_PROXY_HOPS: '1',
    }).secureCookies,
    true,
  );
});

test('TRUST_PROXY_HOPS: optional outside production, mandatory and bounded in production', () => {
  assert.equal(parseTrustProxyHops(undefined, 'development'), 0);
  assert.equal(parseTrustProxyHops('', 'test'), 0);
  assert.equal(parseTrustProxyHops('1', 'production'), 1);
  assert.equal(parseTrustProxyHops('0', 'production'), 0, 'an explicit 0 is a deliberate answer');
  assert.throws(() => parseTrustProxyHops(undefined, 'production'), /TRUST_PROXY_HOPS must be set/);
  assert.throws(() => parseTrustProxyHops('', 'production'), /must be set/);
  for (const bad of ['-1', '1.5', 'one', '6', '99', '1e1']) {
    assert.throws(
      () => parseTrustProxyHops(bad, 'development'),
      /whole number between 0 and 5/,
      bad,
    );
  }
  assert.throws(
    () => loadRuntimeConfig({ APP_ENV: 'production', WEB_ORIGIN: 'https://app.example.com' }),
    /TRUST_PROXY_HOPS must be set/,
  );
  assert.equal(
    loadRuntimeConfig({
      APP_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:5173',
      TRUST_PROXY_HOPS: '2',
    }).trustProxyHops,
    2,
  );
});
