import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import tls from 'node:tls';

// The proxy lives under scripts/ops and is loaded through a runtime URL so this workspace's type-check root stays put.
interface UpstreamOptions {
  upstreamHost: string;
  upstreamPort: number;
  caPem: string;
  pinSha256: string;
  connectTimeoutMs?: number;
}
interface ProxyModule {
  startPgTlsProxy: (
    options: UpstreamOptions & {
      listenHost?: string;
      listenPort?: number;
      onEvent?: (event: string) => void;
    },
  ) => Promise<{ port: number; close: () => Promise<void> }>;
  probeUpstream: (options: UpstreamOptions) => Promise<void>;
  normalizeFingerprint: (value: string) => string;
}
interface MigrateModule {
  parseMigrationEnv: (env: NodeJS.ProcessEnv) => {
    host: string;
    port: number;
    user: string;
    password: string;
    proxyPort?: number;
  };
  buildChildEnv: (
    base: NodeJS.ProcessEnv,
    config: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      caPem: string;
      pinSha256: string;
    },
    proxyPort: number,
  ) => NodeJS.ProcessEnv;
}
const load = <T>(file: string) =>
  import(new URL(`../../../scripts/ops/${file}`, import.meta.url).href) as Promise<T>;

interface Material {
  key: string;
  cert: string;
  fingerprint: string;
}
let proxyModule: ProxyModule;
let migrateModule: MigrateModule;
let dir: string;
let good: Material;
let other: Material;
let expired: Material;

function makeCert(name: string, days: number): Material {
  const keyFile = path.join(dir, `${name}.key`);
  const csrFile = path.join(dir, `${name}.csr`);
  const certFile = path.join(dir, `${name}.crt`);
  const run = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
  // key, request, then a self-signed certificate; `x509 -req -days 0` yields a certificate that is already expired
  run(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyFile]);
  run(['req', '-new', '-key', keyFile, '-subj', '/CN=localhost', '-out', csrFile]);
  run([
    'x509',
    '-req',
    '-in',
    csrFile,
    '-signkey',
    keyFile,
    '-days',
    String(days),
    '-out',
    certFile,
  ]);
  const cert = readFileSync(certFile, 'utf8');
  return {
    key: readFileSync(keyFile, 'utf8'),
    cert,
    fingerprint: new X509Certificate(cert).fingerprint256,
  };
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'nook-tls-proxy-'));
  good = makeCert('good', 30);
  other = makeCert('other', 30);
  expired = makeCert('expired', 0); // valid for zero days: expired as soon as the clock ticks
  proxyModule = await load<ProxyModule>('pg-tls-proxy.ts');
  migrateModule = await load<MigrateModule>('migrate-with-tls-proxy.ts');
  await new Promise((resolve) => setTimeout(resolve, 1500));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const AUTH_OK = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]); // 'R' AuthenticationOk
function startupMessage(): Buffer {
  const body = Buffer.from('user\0nook_migrator\0database\0nook\0\0', 'utf8');
  const message = Buffer.alloc(8 + body.length);
  message.writeInt32BE(message.length, 0);
  message.writeInt32BE(196608, 4);
  body.copy(message, 8);
  return message;
}
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);

interface Fake {
  port: number;
  seen: { startup: Buffer | null; viaTls: boolean };
  close: () => Promise<void>;
}
/** A minimal stand-in for PostgreSQL: answers SSLRequest, optionally upgrades to TLS, records the startup packet. */
async function fakePostgres(
  mode: 'tls' | 'plaintext' | 'inject',
  material?: Material,
): Promise<Fake> {
  const seen = { startup: null as Buffer | null, viaTls: false };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('data', () => {
      if (mode === 'plaintext') {
        socket.write('N');
        socket.on('data', (chunk) => (seen.startup = chunk));
        return;
      }
      if (mode === 'inject') {
        socket.write(Buffer.from('SX'));
        return;
      }
      socket.write('S');
      const secure = new tls.TLSSocket(socket, {
        isServer: true,
        key: material?.key,
        cert: material?.cert,
      });
      secure.on('error', () => undefined);
      secure.once('data', (chunk) => {
        seen.startup = chunk;
        seen.viaTls = true;
        secure.write(AUTH_OK);
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as net.AddressInfo).port,
    seen,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Sends the given packets to the proxy and returns everything it answers until it closes or goes quiet. */
function talk(port: number, packets: Buffer[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const received: Buffer[] = [];
    const client = net.connect({ host: '127.0.0.1', port });
    let timer = setTimeout(done, 1500);
    function done() {
      client.destroy();
      resolve(Buffer.concat(received));
    }
    client.on('data', (chunk) => {
      received.push(chunk);
      clearTimeout(timer);
      timer = setTimeout(done, 400);
    });
    client.on('close', done);
    client.on('error', () => undefined);
    client.on('connect', () => {
      let delay = 0;
      for (const packet of packets) {
        setTimeout(() => client.write(packet), delay);
        delay += 60;
      }
    });
  });
}

const optionsFor = (fake: Fake, ca: Material, pin: Material): UpstreamOptions => ({
  upstreamHost: '127.0.0.1',
  upstreamPort: fake.port,
  caPem: ca.cert,
  pinSha256: pin.fingerprint,
  connectTimeoutMs: 3000,
});

test('correct pinned certificate: the startup packet reaches PostgreSQL over TLS and the answer comes back', async () => {
  const fake = await fakePostgres('tls', good);
  const events: string[] = [];
  const proxy = await proxyModule.startPgTlsProxy({
    ...optionsFor(fake, good, good),
    onEvent: (event) => events.push(event),
  });
  try {
    // a client that asks for TLS gets "N" from the local proxy first, then sends its startup message
    const answer = await talk(proxy.port, [SSL_REQUEST, startupMessage()]);
    assert.equal(answer[0], 0x4e, 'the local SSLRequest is answered with N');
    assert.ok(answer.subarray(1).equals(AUTH_OK), 'the upstream answer is passed through');
    assert.equal(fake.seen.viaTls, true, 'the upstream saw the startup packet inside TLS');
    assert.ok(fake.seen.startup?.equals(startupMessage()), 'the startup packet arrived unchanged');
    assert.ok(events.includes('upstream-verified'));
  } finally {
    await proxy.close();
    await fake.close();
  }
});

test('a wrong certificate is rejected and nothing reaches PostgreSQL', async () => {
  const fake = await fakePostgres('tls', other); // server presents certificate B, the pin is certificate A
  const events: string[] = [];
  const proxy = await proxyModule.startPgTlsProxy({
    ...optionsFor(fake, good, good),
    onEvent: (event) => events.push(event),
  });
  try {
    const answer = await talk(proxy.port, [startupMessage()]);
    assert.equal(answer[0], 0x45, 'the client gets an ErrorResponse');
    assert.match(answer.toString('utf8'), /FATAL/);
    assert.equal(fake.seen.startup, null, 'the startup packet was never forwarded');
    assert.ok(events.includes('rejected:TLS_VERIFY'), events.join(','));
  } finally {
    await proxy.close();
    await fake.close();
  }
});

test('a certificate signed by the pinned CA but with a different fingerprint is rejected', async () => {
  const fake = await fakePostgres('tls', good);
  const events: string[] = [];
  const proxy = await proxyModule.startPgTlsProxy({
    ...optionsFor(fake, good, other), // CA verifies, fingerprint pin is another certificate's
    onEvent: (event) => events.push(event),
  });
  try {
    const answer = await talk(proxy.port, [startupMessage()]);
    assert.equal(answer[0], 0x45);
    assert.equal(fake.seen.startup, null);
    assert.ok(events.includes('rejected:PIN_MISMATCH'), events.join(','));
  } finally {
    await proxy.close();
    await fake.close();
  }
});

test('an expired certificate is rejected', async () => {
  const fake = await fakePostgres('tls', expired);
  await assert.rejects(
    () => proxyModule.probeUpstream(optionsFor(fake, expired, expired)),
    (error: Error & { code?: string }) => error.code === 'TLS_VERIFY',
  );
  assert.equal(fake.seen.startup, null);
  await fake.close();
});

test('a database that does not offer TLS is refused, never used in plaintext', async () => {
  const fake = await fakePostgres('plaintext');
  const events: string[] = [];
  const proxy = await proxyModule.startPgTlsProxy({
    ...optionsFor(fake, good, good),
    onEvent: (event) => events.push(event),
  });
  try {
    const answer = await talk(proxy.port, [startupMessage()]);
    assert.equal(answer[0], 0x45);
    assert.equal(fake.seen.startup, null, 'no plaintext startup packet was sent upstream');
    assert.ok(events.includes('rejected:UPSTREAM_NO_TLS'), events.join(','));
  } finally {
    await proxy.close();
    await fake.close();
  }
});

test('plaintext injected before the TLS handshake is detected', async () => {
  const fake = await fakePostgres('inject');
  await assert.rejects(
    () => proxyModule.probeUpstream(optionsFor(fake, good, good)),
    (error: Error & { code?: string }) => error.code === 'UPSTREAM_PLAINTEXT_INJECTION',
  );
  await fake.close();
});

test('an unreachable endpoint fails safely', async () => {
  const closed = await new Promise<number>((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
  await assert.rejects(
    () =>
      proxyModule.probeUpstream({
        upstreamHost: '127.0.0.1',
        upstreamPort: closed,
        caPem: good.cert,
        pinSha256: good.fingerprint,
        connectTimeoutMs: 1000,
      }),
    (error: Error & { code?: string }) => error.code === 'CONNECT',
  );
});

test('missing or malformed trust material is a configuration error, and the listener is loopback-only', async () => {
  const base = { upstreamHost: '127.0.0.1', upstreamPort: 1 };
  await assert.rejects(
    () => proxyModule.probeUpstream({ ...base, caPem: '', pinSha256: good.fingerprint }),
    (error: Error & { code?: string }) => error.code === 'CONFIG',
  );
  await assert.rejects(
    () => proxyModule.probeUpstream({ ...base, caPem: good.cert, pinSha256: 'not-a-fingerprint' }),
    (error: Error & { code?: string }) => error.code === 'CONFIG',
  );
  await assert.rejects(
    () =>
      proxyModule.startPgTlsProxy({
        ...base,
        caPem: good.cert,
        pinSha256: good.fingerprint,
        listenHost: '0.0.0.0',
      }),
    (error: Error & { code?: string }) => error.code === 'CONFIG',
  );
  assert.equal(
    proxyModule.normalizeFingerprint('aa:bb'.padEnd(5, 'c') + 'AA'.repeat(30)).length,
    64,
  );
});

test('migration environment: required variables, no superuser, and secrets removed from the child', () => {
  const complete = {
    MIGRATION_DB_HOST: 'db.railway.internal',
    MIGRATION_DB_NAME: 'nook',
    MIGRATION_DB_USER: 'nook_migrator',
    MIGRATION_DB_PASSWORD: 'p@ss/w:rd?#',
    DB_CA_PEM: good.cert,
    DB_CERT_SHA256: good.fingerprint,
  };
  const parsed = migrateModule.parseMigrationEnv(complete);
  assert.equal(parsed.port, 5432);
  assert.throws(
    () => migrateModule.parseMigrationEnv({ ...complete, MIGRATION_DB_PASSWORD: '' }),
    /MIGRATION_DB_PASSWORD/,
  );
  assert.throws(
    () => migrateModule.parseMigrationEnv({ ...complete, MIGRATION_DB_USER: 'postgres' }),
    /superuser/,
  );
  assert.throws(
    () => migrateModule.parseMigrationEnv({ ...complete, MIGRATION_DB_PORT: '70000' }),
    /MIGRATION_DB_PORT/,
  );
  const child = migrateModule.buildChildEnv(
    { ...complete, MIGRATOR_DATABASE_URL: 'x', PATH: '/bin' },
    { ...parsed, database: 'nook', caPem: good.cert, pinSha256: good.fingerprint },
    5555,
  );
  assert.equal(
    child.DATABASE_URL,
    'postgresql://nook_migrator:p%40ss%2Fw%3Ard%3F%23@127.0.0.1:5555/nook?sslmode=disable',
  );
  for (const name of ['MIGRATION_DB_PASSWORD', 'DB_CA_PEM', 'DB_CERT_SHA256']) {
    assert.equal(child[name], undefined, `${name} must not reach the migration command`);
  }
  // An inherited MIGRATOR_DATABASE_URL never reaches the command; the ops scripts get only the loopback proxy URL.
  assert.notEqual(child.MIGRATOR_DATABASE_URL, 'x');
  assert.equal(child.MIGRATOR_DATABASE_URL, child.DATABASE_URL);
  assert.match(child.MIGRATOR_DATABASE_URL ?? '', /@127\.0\.0\.1:5555\//);
  assert.equal(child.PATH, '/bin');
  assert.equal(
    migrateModule.parseMigrationEnv({ ...complete, MIGRATION_PROXY_PORT: '15432' }).proxyPort,
    15432,
  );
  assert.equal(migrateModule.parseMigrationEnv(complete).proxyPort, undefined);
  for (const bad of ['80', '70000', 'abc', '15432.5']) {
    assert.throws(
      () => migrateModule.parseMigrationEnv({ ...complete, MIGRATION_PROXY_PORT: bad }),
      /MIGRATION_PROXY_PORT/,
    );
  }
});
