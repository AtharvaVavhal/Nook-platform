// Authenticated-TLS PostgreSQL proxy for the migration job.
//
// Why it exists: the Prisma migration engine cannot verify a PostgreSQL certificate issued by a private CA (or a
// self-signed one) with any connection option (tested: `sslaccept=strict` rejects even the exact certificate;
// `sslmode=require` and `verify-full` connect WITHOUT verifying). This proxy lets `prisma migrate deploy` keep working
// unchanged while the real network hop is authenticated TLS:
//
//   prisma (plaintext, 127.0.0.1 only, same container)  ->  this proxy  ->  TLS-authenticated  ->  PostgreSQL
//
// Every upstream connection must (1) get "S" in answer to a PostgreSQL SSLRequest, (2) complete a TLS handshake whose
// certificate chain verifies against the pinned CA with `rejectUnauthorized: true` (expired certificates fail), and
// (3) present a leaf certificate whose SHA-256 fingerprint equals the pin. The chain check and the pin are two separate
// checks: either one failing closes the connection. There is no plaintext or unauthenticated fallback.
//
// What the two inputs are (Railway PostgreSQL template): the server presents a LEAF certificate (CN=localhost, with the
// service's private hostname among its subject alternative names) issued by a self-signed ROOT CA (CN=root-ca).
//   - the pinned CA (DB_CA_PEM)   is the ROOT CA certificate, the last certificate the server presents. The leaf is not
//                                 self-signed, so it is refused as a trust anchor;
//   - the pin (DB_CERT_SHA256)    is the SHA-256 fingerprint of the LEAF certificate, the first one presented.
// If a server instead presents one self-signed certificate, that certificate is both the CA and the leaf.
// Hostname verification is deliberately replaced by the fingerprint pin here (the connection target is fixed by the
// operator, and the pin identifies the exact server certificate), so the certificate's names are not consulted.
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import tls from 'node:tls';

const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
const CODE_SSL_REQUEST = 80877103;
const CODE_GSS_ENC_REQUEST = 80877104;
const MAX_STARTUP_LENGTH = 10_000; // PostgreSQL's own limit for a startup packet
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export class ProxyError extends Error {
  constructor(
    readonly code:
      | 'CONFIG'
      | 'CONNECT'
      | 'UPSTREAM_NO_TLS'
      | 'UPSTREAM_PLAINTEXT_INJECTION'
      | 'TLS_VERIFY'
      | 'PIN_MISMATCH'
      | 'TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

export interface UpstreamOptions {
  upstreamHost: string;
  upstreamPort: number;
  /**
   * PEM of the CA certificate that the server certificate must chain to. With Railway's PostgreSQL template that is the
   * self-signed root CA (the last certificate the server presents), NOT the server (leaf) certificate; a leaf that is
   * not self-signed is refused as its own trust anchor. For a server with a single self-signed certificate, it is that
   * certificate.
   */
  caPem: string;
  /** SHA-256 fingerprint of the expected leaf certificate, hex with or without colons. */
  pinSha256: string;
  connectTimeoutMs?: number;
}

export interface TlsProxyOptions extends UpstreamOptions {
  /** Loopback only. Default 127.0.0.1. */
  listenHost?: string;
  /** 0 picks a free port. */
  listenPort?: number;
  onEvent?: (event: string) => void;
}

export function normalizeFingerprint(value: string): string {
  const hex = value.replace(/:/g, '').trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) {
    throw new ProxyError(
      'CONFIG',
      'The certificate pin must be a SHA-256 fingerprint (64 hex characters).',
    );
  }
  return hex;
}

function assertOptions(options: UpstreamOptions): string {
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(options.caPem)) {
    throw new ProxyError('CONFIG', 'The pinned CA is missing or is not a PEM certificate.');
  }
  return normalizeFingerprint(options.pinSha256);
}

function connectTcp(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ProxyError('TIMEOUT', 'Timed out connecting to the database endpoint.'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      reject(new ProxyError('CONNECT', 'Could not connect to the database endpoint.'));
    });
  });
}

/** Reads the single answer byte to the SSLRequest; any extra byte is a plaintext-injection attempt. */
function readSslAnswer(socket: net.Socket, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ProxyError('TIMEOUT', 'Timed out waiting for the database TLS answer.'));
    }, timeoutMs);
    socket.once('error', () => {
      clearTimeout(timer);
      reject(new ProxyError('CONNECT', 'The database connection failed during TLS negotiation.'));
    });
    socket.once('data', (chunk: Buffer) => {
      clearTimeout(timer);
      if (chunk.length !== 1) {
        socket.destroy();
        reject(
          new ProxyError(
            'UPSTREAM_PLAINTEXT_INJECTION',
            'The database sent unexpected plaintext before the TLS handshake.',
          ),
        );
        return;
      }
      resolve(chunk[0] as number);
    });
  });
}

/**
 * Opens one authenticated TLS connection to the database, positioned just after the handshake, ready to receive
 * the client's PostgreSQL startup message. Throws ProxyError (never falls back) on any verification failure.
 */
export async function openVerifiedUpstream(options: UpstreamOptions): Promise<tls.TLSSocket> {
  const pin = assertOptions(options);
  const timeoutMs = options.connectTimeoutMs ?? 10_000;
  const raw = await connectTcp(options.upstreamHost, options.upstreamPort, timeoutMs);
  raw.write(SSL_REQUEST);
  const answer = await readSslAnswer(raw, timeoutMs);
  if (answer !== 0x53 /* 'S' */) {
    raw.destroy();
    throw new ProxyError(
      'UPSTREAM_NO_TLS',
      'The database does not offer TLS; refusing to continue in plaintext.',
    );
  }
  const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({
      socket: raw,
      ca: [options.caPem],
      rejectUnauthorized: true,
      // Hostname verification is replaced by the leaf fingerprint pin below.
      checkServerIdentity: () => undefined,
      minVersion: 'TLSv1.2',
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ProxyError('TIMEOUT', 'Timed out during the TLS handshake.'));
    }, timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      reject(
        new ProxyError(
          'TLS_VERIFY',
          'The database certificate was rejected (not signed by the pinned CA, expired, or malformed).',
        ),
      );
    });
  });
  const peer = secure.getPeerCertificate();
  const actual = (peer.fingerprint256 ?? '').replace(/:/g, '').toUpperCase();
  const expected = Buffer.from(pin);
  const got = Buffer.from(actual.padEnd(pin.length, '0').slice(0, pin.length));
  if (!secure.authorized || actual.length !== pin.length || !timingSafeEqual(expected, got)) {
    secure.destroy();
    throw new ProxyError(
      'PIN_MISMATCH',
      'The database certificate does not match the pinned fingerprint.',
    );
  }
  return secure;
}

/** Verifies the upstream end to end and closes the connection. Used as a pre-flight before running migrations. */
export async function probeUpstream(options: UpstreamOptions): Promise<void> {
  const socket = await openVerifiedUpstream(options);
  socket.destroy();
}

function errorResponse(message: string): Buffer {
  const fields = Buffer.concat([
    Buffer.from('SFATAL\0', 'utf8'),
    Buffer.from('C08006\0', 'utf8'),
    Buffer.from(`M${message}\0`, 'utf8'),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(5);
  header.write('E', 0, 'latin1');
  header.writeInt32BE(fields.length + 4, 1);
  return Buffer.concat([header, fields]);
}

/** Starts the loopback listener. Each accepted connection gets its own freshly verified upstream connection. */
export async function startPgTlsProxy(
  options: TlsProxyOptions,
): Promise<{ port: number; close: () => Promise<void> }> {
  assertOptions(options);
  const listenHost = options.listenHost ?? '127.0.0.1';
  if (!LOOPBACK.has(listenHost)) {
    throw new ProxyError('CONFIG', 'The proxy may only listen on a loopback address.');
  }
  const emit = options.onEvent ?? (() => undefined);
  const open = new Set<net.Socket>();

  const server = net.createServer((client) => {
    open.add(client);
    client.once('close', () => open.delete(client));
    client.on('error', () => client.destroy());
    handleClient(client).catch((error: unknown) => {
      const proxyError = error instanceof ProxyError ? error : undefined;
      emit(`rejected:${proxyError?.code ?? 'INTERNAL'}`);
      if (!client.destroyed) {
        client.end(errorResponse(proxyError?.message ?? 'TLS proxy failed.'));
      }
    });
  });

  async function handleClient(client: net.Socket): Promise<void> {
    let buffer = Buffer.alloc(0);
    // Read the first real message, answering SSL/GSS encryption requests from the local client with "N".
    for (;;) {
      while (buffer.length < 8) buffer = Buffer.concat([buffer, await nextChunk(client)]);
      const length = buffer.readInt32BE(0);
      if (length < 8 || length > MAX_STARTUP_LENGTH) {
        throw new ProxyError('CONFIG', 'Invalid PostgreSQL startup packet from the local client.');
      }
      while (buffer.length < length) buffer = Buffer.concat([buffer, await nextChunk(client)]);
      const code = buffer.readInt32BE(4);
      if (code === CODE_SSL_REQUEST || code === CODE_GSS_ENC_REQUEST) {
        client.write('N');
        buffer = buffer.subarray(length);
        continue;
      }
      break;
    }
    client.pause();
    const upstream = await openVerifiedUpstream(options);
    emit('upstream-verified');
    upstream.once('close', () => client.destroy());
    upstream.on('error', () => client.destroy());
    client.once('close', () => upstream.destroy());
    upstream.write(buffer);
    client.pipe(upstream);
    upstream.pipe(client);
    client.resume();
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.listenPort ?? 0, listenHost, () => resolve());
  });
  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    close: async () => {
      for (const socket of open) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function nextChunk(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      cleanup();
      resolve(chunk);
    };
    const onEnd = () => {
      cleanup();
      reject(new ProxyError('CONNECT', 'The local client closed the connection.'));
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('close', onEnd);
      socket.off('error', onEnd);
    };
    socket.on('data', onData);
    socket.once('close', onEnd);
    socket.once('error', onEnd);
  });
}
