import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAuthenticatedDatabaseTls,
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
      DATABASE_URL: 'postgresql://app:pw@db.example.com:5432/nook?sslmode=verify-full',
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
    () =>
      loadRuntimeConfig({
        APP_ENV: 'production',
        WEB_ORIGIN: 'https://app.example.com',
        DATABASE_URL: 'postgresql://app:pw@db.example.com:5432/nook?sslmode=verify-full',
      }),
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

const REMOTE = 'postgresql://nook_app:S3cretPw@db.railway.internal:5432/nook';
const PEM = '-----BEGIN CERTIFICATE-----\nMIIBkTCB+wIJAL\n-----END CERTIFICATE-----\n';

test('production requires DATABASE_URL (fail closed)', () => {
  assert.throws(
    () => parseDatabaseUrl(undefined, 'production'),
    /DATABASE_URL must be set in production/,
  );
  assert.throws(() => parseDatabaseUrl('  ', 'production'), /must be set in production/);
  assert.equal(parseDatabaseUrl(undefined, 'development'), undefined);
  assert.equal(parseDatabaseUrl(undefined, 'test'), undefined);
});

test('production refuses every database URL that could connect in plaintext or without authenticating', () => {
  const refused = [
    ['no sslmode (the driver would connect in plaintext)', REMOTE],
    ['sslmode=disable', `${REMOTE}?sslmode=disable`],
    ['sslmode=allow', `${REMOTE}?sslmode=allow`],
    ['sslmode=prefer', `${REMOTE}?sslmode=prefer`],
    ['sslmode=require', `${REMOTE}?sslmode=require`],
    [
      'sslmode=require with libpq compatibility (encrypts, does not authenticate)',
      `${REMOTE}?uselibpqcompat=true&sslmode=require`,
    ],
    ['sslmode=no-verify', `${REMOTE}?sslmode=no-verify`],
    [
      'verify-ca without libpq compatibility',
      `${REMOTE}?sslmode=verify-ca&sslrootcert=/tmp/ca.pem`,
    ],
    ['verify-ca without a CA', `${REMOTE}?sslmode=verify-ca&uselibpqcompat=true`],
    ['repeated sslmode', `${REMOTE}?sslmode=verify-full&sslmode=disable`],
    ['ssl parameter', `${REMOTE}?sslmode=verify-full&ssl=false`],
    ['sslaccept parameter', `${REMOTE}?sslmode=verify-full&sslaccept=accept_invalid_certs`],
  ] as const;
  for (const [label, url] of refused) {
    assert.throws(() => parseDatabaseUrl(url, 'production'), /DATABASE_URL/, label);
    assert.throws(
      () =>
        loadRuntimeConfig({
          APP_ENV: 'production',
          WEB_ORIGIN: 'https://app.example.com',
          TRUST_PROXY_HOPS: '1',
          DATABASE_URL: url,
        }),
      /DATABASE_URL/,
      label,
    );
  }
});

test('production TLS errors never contain the password or the URL', () => {
  for (const url of [
    REMOTE,
    `${REMOTE}?sslmode=disable`,
    `${REMOTE}?sslmode=verify-ca&uselibpqcompat=true`,
  ]) {
    try {
      parseDatabaseUrl(url, 'production');
      assert.fail('expected a refusal');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      assert.ok(!message.includes('S3cretPw') && !message.includes('postgresql://'), message);
    }
  }
});

test('production accepts only verified TLS: verify-full, or verify-ca with a readable pinned PEM CA', () => {
  assert.equal(
    parseDatabaseUrl(`${REMOTE}?sslmode=verify-full`, 'production'),
    `${REMOTE}?sslmode=verify-full`,
  );
  assert.doesNotThrow(() =>
    assertAuthenticatedDatabaseTls(
      `${REMOTE}?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/ca/ok.pem`,
      () => PEM,
    ),
  );
  assert.throws(
    () =>
      assertAuthenticatedDatabaseTls(
        `${REMOTE}?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/ca/missing.pem`,
        () => {
          throw new Error('ENOENT');
        },
      ),
    /cannot be read/,
  );
  assert.throws(
    () =>
      assertAuthenticatedDatabaseTls(
        `${REMOTE}?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/ca/notpem.pem`,
        () => 'not a certificate',
      ),
    /not a PEM certificate/,
  );
  // verify-full with an explicit CA file is also checked for readability
  assert.throws(
    () =>
      assertAuthenticatedDatabaseTls(
        `${REMOTE}?sslmode=verify-full&sslrootcert=/ca/empty.pem`,
        () => '',
      ),
    /not a PEM certificate/,
  );
});

test('loopback database hosts are exempt, other environments are unaffected', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `postgresql://u:p@${host}:5545/db`;
    assert.equal(parseDatabaseUrl(url, 'production'), url, host);
  }
  const plaintext = `${REMOTE}?sslmode=disable`;
  assert.equal(parseDatabaseUrl(plaintext, 'development'), plaintext);
  assert.equal(parseDatabaseUrl(plaintext, 'test'), plaintext);
});
