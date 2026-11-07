/**
 * Redaction for everything that is written to a log or sent to an error tracker.
 *
 * Two layers, because secrets arrive in two shapes:
 *  1. by KEY: any property whose name says it is sensitive (password, token, cookie, authorization, csrf, ...), a
 *     financial amount (amount, price, balance, ...), or personal data (phone, e-mail, names, address, notes, ...)
 *     has its value replaced, whatever the value is;
 *  2. by VALUE: free text (error messages, stack frames, URLs) is scrubbed for connection-string passwords, bearer
 *     tokens, JWTs, our own cookies, "password=..." pairs, e-mail addresses and long digit runs (phone / account
 *     numbers).
 *
 * Request and response BODIES, cookies and headers are never logged at all; this is the safety net for the fields
 * that are logged and for error text produced by libraries.
 */
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY =
  /(pass(word|phrase|wd)?|pwd|secret|token|cookie|authorization|csrf|credential|api[-_]?key|private[-_]?key|signature|hash|otp|session)/i;
const FINANCIAL_KEY =
  /(amount|price|balance|total|rent|deposit|payment|invoice(d)?$|collected|outstanding|overdue|credit|cash|upi|vpa|ifsc|iban|account|card|cvv|aadhaar|aadhar|pan$|gst)/i;
const PERSONAL_KEY =
  /(phone|mobile|e-?mail|first.?name|last.?name|full.?name|display.?name|address|date.?of.?birth|dob|document|emergency|notes?|reason|outcome|gender)/i;

/** Keys that are always safe to log even though a pattern above would match them. */
const SAFE_KEYS = new Set([
  'requestId',
  'statusCode',
  'status',
  'method',
  'path',
  'route',
  'durationMs',
  'contentLength',
  'level',
  'message',
  'service',
  'env',
  'version',
  'timestamp',
  'context',
  'userId',
  'organizationId',
  'role',
  'queryKeys',
  'errorName',
  'errorCode',
  'code',
  'port',
  'trustProxyHops',
  'sessionRequired',
  'action',
  'passwordChangeRequired',
]);

export function isSensitiveKey(key: string): boolean {
  if (SAFE_KEYS.has(key)) return false;
  return SENSITIVE_KEY.test(key) || FINANCIAL_KEY.test(key) || PERSONAL_KEY.test(key);
}

const MAX_STRING = 500;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_KEYS = 60;

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Digit runs of 10 or more (phone, account, card, Aadhaar numbers), allowing spaces, dashes, dots and brackets. */
function scrubDigitRuns(text: string): string {
  // UUIDs are identifiers, not numbers: an id whose hex digits happen to all be 0-9 must survive. Park them aside.
  const parked: string[] = [];
  const withoutIds = text.replace(UUID_IN_TEXT, (id) => `\uE000${parked.push(id) - 1}\uE001`);
  const scrubbed = withoutIds.replace(/\+?\d[\d ()\-.]{8,}\d/g, (match) => {
    const digits = match.replace(/\D/g, '').length;
    // dates (2026-11-03) and times are short; ids with letters never match this pattern
    return digits >= 10 ? '[number]' : match;
  });
  return scrubbed.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => parked[Number(i)] ?? '');
}

export function scrubString(input: string): string {
  let text = input.length > MAX_STRING * 4 ? `${input.slice(0, MAX_STRING * 4)}…` : input;
  // user:password@host inside any URL (database and storage connection strings): credentials AND the internal host go
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s@/]*@[^\s/?#]*/gi, `$1${REDACTED}`);
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, REDACTED);
  text = text.replace(/\b(nook_session|nook_csrf)=[^;\s,]+/g, `$1=${REDACTED}`);
  text = text.replace(
    /(["']?(?:password|passwd|pwd|passphrase|secret|token|authorization|api[-_]?key|csrf[-_]?token)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&})]+)/gi,
    `$1"${REDACTED}"`,
  );
  text = text.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    '[email]',
  );
  text = scrubDigitRuns(text);
  return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
}

/** A JSON-safe, redacted copy of any value. Never throws, never follows cycles, bounds depth and size. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'string':
      return scrubString(value);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
    default:
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return serializeError(value);
  const object = value as Record<string, unknown>;
  if (seen.has(object)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  seen.add(object);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1, seen));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY} more]`);
    return items;
  }
  // Decimal and similar value objects render as text (then are scrubbed), never as their internals.
  if (typeof (object as { toFixed?: unknown }).toFixed === 'function' && 'd' in object) {
    return REDACTED;
  }
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, inner] of Object.entries(object)) {
    if (count >= MAX_KEYS) {
      out['[truncated]'] = `+${Object.keys(object).length - MAX_KEYS} keys`;
      break;
    }
    count += 1;
    out[key] = isSensitiveKey(key) ? REDACTED : redact(inner, depth + 1, seen);
  }
  return out;
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string[];
}

const MAX_FRAMES = 15;

/**
 * A log-safe description of an error. Database-client errors (Prisma) embed the failing query and its VALUES in their
 * message, so for those only the first line and the error code are kept. Stacks keep only their "at ..." frames, never
 * the message that precedes them.
 */
export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return {
      name: 'NonError',
      message: scrubString(String(typeof error === 'object' ? 'object thrown' : error)),
    };
  }
  const isDatabaseClient = /^(PrismaClient|PrismaClient.*Error|DriverAdapterError)/.test(
    error.name,
  );
  const firstLine = (error.message ?? '').split('\n').find((line) => line.trim() !== '') ?? '';
  const out: SerializedError = {
    name: error.name,
    message: scrubString(isDatabaseClient ? firstLine.slice(0, 160) : (error.message ?? '')),
  };
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) out.code = code;
  if (error.stack) {
    const frames = error.stack
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('at '))
      .slice(0, MAX_FRAMES)
      .map((line) => scrubString(line));
    if (frames.length) out.stack = frames;
  }
  return out;
}
