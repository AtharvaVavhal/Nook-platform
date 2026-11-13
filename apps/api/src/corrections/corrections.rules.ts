import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';

/**
 * Pure rules for P4-2 corrections (specification v1.3 sections 4-6, 9, 11). Nothing here touches a database.
 */

export const TARGET_TYPES = ['RESIDENT', 'BOOKING', 'ADMISSION', 'CHECK_IN', 'CHECK_OUT'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const FIELD_KEYS = [
  'firstName',
  'lastName',
  'startDate',
  'endDate',
  'monthlyPrice',
  'admissionDate',
  'checkInAt',
  'checkOutAt',
  'reason',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type ValueKind = 'text' | 'nullableText' | 'date' | 'instant' | 'money';

export interface FieldSpec {
  target: TargetType;
  kind: ValueKind;
  /** Server-computed classification: all booking terms, admission date and physical timestamps are financial. */
  financial: boolean;
  /** The correction needs a lifecycle row-lock chain and the organization gate. */
  gated: boolean;
}

export const FIELD_SPECS: Record<FieldKey, FieldSpec> = {
  firstName: { target: 'RESIDENT', kind: 'text', financial: false, gated: false },
  lastName: { target: 'RESIDENT', kind: 'text', financial: false, gated: false },
  startDate: { target: 'BOOKING', kind: 'date', financial: true, gated: true },
  endDate: { target: 'BOOKING', kind: 'date', financial: true, gated: true },
  monthlyPrice: { target: 'BOOKING', kind: 'money', financial: true, gated: true },
  admissionDate: { target: 'ADMISSION', kind: 'date', financial: true, gated: true },
  checkInAt: { target: 'CHECK_IN', kind: 'instant', financial: true, gated: true },
  checkOutAt: { target: 'CHECK_OUT', kind: 'instant', financial: true, gated: true },
  reason: { target: 'CHECK_OUT', kind: 'nullableText', financial: false, gated: false },
};

/** Correction enum label -> existing AuditEvent.targetType string (specification 8.1). */
export const AUDIT_TARGET_TYPE: Record<TargetType, string> = {
  RESIDENT: 'resident',
  BOOKING: 'booking',
  ADMISSION: 'admission',
  CHECK_IN: 'check_in',
  CHECK_OUT: 'check_out',
};

export const NORMAL_WINDOW_DAYS = 90;
export const POLICY_VERSION = 'p4-2-v1.3';
export const MAX_NAME_LENGTH = 500;
export const MAX_REASON_LENGTH = 2000;

/** Every client-visible error code of the correction API (specification 11.7). */
export type CorrectionErrorCode =
  | 'PENDING_CONFLICT'
  | 'STALE_SOURCE'
  | 'LIFECYCLE_CONFLICT'
  | 'FINANCE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RETRY_REQUIRED'
  | 'INVALID_STATE'
  | 'SELF_REVIEW'
  | 'INSUFFICIENT_ROLE'
  | 'UNAUTHENTICATED'
  | 'INVALID_EVIDENCE'
  | 'EVIDENCE_REQUIRED'
  | 'NOT_FOUND'
  | 'INVALID_FIELD'
  | 'INVALID_VALUE'
  | 'UNKNOWN_FIELD'
  | 'CORRECTION_REQUIRED'
  | 'CORRECTIONS_NOT_CONFIGURED';

/** An HTTP error with a stable machine-readable code. Bodies never carry SQL, index names, values or other actors. */
export class CorrectionError extends HttpException {
  constructor(
    status: number,
    readonly code: CorrectionErrorCode,
    message: string,
    readonly correctionId?: string,
  ) {
    super({ statusCode: status, code, message, ...(correctionId ? { correctionId } : {}) }, status);
  }
}

// --------------------------------------------------------------------------------------------- value parsing

export interface ValueEnvelope {
  kind: ValueKind | 'null';
  value: string | null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
const MONEY_RE = /^\d{1,8}(?:\.\d{1,2})?$/;

function invalid(field: string, why: string): never {
  throw new CorrectionError(400, 'INVALID_VALUE', `${field}: ${why}`);
}

/** Strict calendar date `YYYY-MM-DD`; JavaScript Date normalization is never relied on. */
export function parseCalendarDate(raw: unknown, field: string): string {
  if (typeof raw !== 'string') invalid(field, 'must be a YYYY-MM-DD date');
  const m = DATE_RE.exec(raw as string);
  if (!m) invalid(field, 'must be a YYYY-MM-DD date');
  const [y, mo, d] = [Number(m![1]), Number(m![2]), Number(m![3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    invalid(field, 'is not a real calendar date');
  }
  if (y < 2000 || y > 2100) invalid(field, 'year is outside the supported range');
  return raw as string;
}

export interface ParsedInstant {
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ` in UTC with microseconds preserved as text. */
  canonical: string;
  /** Millisecond-resolution Date for comparisons only; never written back (sub-millisecond digits would be lost). */
  date: Date;
}

/** Zoned RFC 3339 instant. An explicit zone is mandatory; sub-millisecond digits are kept in `canonical`. */
export function parseZonedInstant(raw: unknown, field: string): ParsedInstant {
  if (typeof raw !== 'string')
    invalid(field, 'must be an RFC 3339 timestamp with an explicit zone');
  const m = INSTANT_RE.exec(raw as string);
  if (!m) invalid(field, 'must be an RFC 3339 timestamp with an explicit zone');
  const [y, mo, d, h, mi, s] = [m![1], m![2], m![3], m![4], m![5], m![6]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    wall.getUTCFullYear() !== y ||
    wall.getUTCMonth() !== mo - 1 ||
    wall.getUTCDate() !== d ||
    wall.getUTCHours() !== h ||
    wall.getUTCMinutes() !== mi ||
    wall.getUTCSeconds() !== s
  ) {
    invalid(field, 'is not a real instant');
  }
  if (y < 2000 || y > 2100) invalid(field, 'year is outside the supported range');
  const zone = m![8]!;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const zh = Number(zone.slice(1, 3));
    const zm = Number(zone.slice(4, 6));
    if (zh > 23 || zm > 59) invalid(field, 'has an invalid zone offset');
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (zh * 60 + zm);
  }
  const utc = new Date(wall.getTime() - offsetMinutes * 60_000);
  const fraction = (m![7] ?? '').padEnd(6, '0');
  return {
    canonical: `${utc.toISOString().slice(0, 19)}.${fraction}Z`,
    date: new Date(utc.getTime() + Number(fraction.slice(0, 3))),
  };
}

export function parseMoney(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !MONEY_RE.test(raw)) {
    invalid(field, 'must be a decimal string with at most 2 fractional digits');
  }
  const [whole, frac = ''] = (raw as string).split('.');
  const canonical = `${Number(whole)}.${frac.padEnd(2, '0')}`;
  if (Number(canonical) <= 0) invalid(field, 'must be greater than zero');
  if (Number(whole) > 99_999_999) invalid(field, 'is above the supported maximum');
  return canonical;
}

export function parseText(raw: unknown, field: string, max = MAX_NAME_LENGTH): string {
  if (typeof raw !== 'string') invalid(field, 'must be text');
  const trimmed = (raw as string).trim();
  if (trimmed.length < 1 || trimmed.length > max) invalid(field, `must be 1 to ${max} characters`);
  return trimmed;
}

/** Normalizes a client-proposed value into the closed scalar envelope for its field. */
export function parseProposedValue(fieldKey: FieldKey, raw: unknown): ValueEnvelope {
  const spec = FIELD_SPECS[fieldKey];
  switch (spec.kind) {
    case 'text':
      return { kind: 'text', value: parseText(raw, fieldKey) };
    case 'nullableText':
      return raw === null
        ? { kind: 'null', value: null }
        : { kind: 'text', value: parseText(raw, fieldKey) };
    case 'date':
      return { kind: 'date', value: parseCalendarDate(raw, fieldKey) };
    case 'instant':
      return { kind: 'instant', value: parseZonedInstant(raw, fieldKey).canonical };
    case 'money':
      return { kind: 'money', value: parseMoney(raw, fieldKey) };
  }
}

export function envelopesEqual(a: ValueEnvelope, b: ValueEnvelope): boolean {
  return a.value === b.value;
}

// ------------------------------------------------------------------------------------------------- day maths

const DAY_MS = 86_400_000;

export function dayOrdinal(dayKey: string): number {
  const m = DATE_RE.exec(dayKey);
  if (!m) throw new Error('invalid day key');
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** The Asia/Kolkata calendar day (`YYYY-MM-DD`) of an instant. Independent of the host timezone. */
export function istDayKeyOf(instant: Date): string {
  return new Date(instant.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Age = max(0, today - earliest candidate day), in whole IST calendar days (specification 6). */
export function ageDays(candidateDays: readonly string[], todayDay: string): number {
  if (candidateDays.length === 0) throw new Error('age needs at least one candidate day');
  const earliest = Math.min(...candidateDays.map(dayOrdinal));
  return Math.max(0, dayOrdinal(todayDay) - earliest);
}

export function isExceptional(age: number): boolean {
  return age > NORMAL_WINDOW_DAYS;
}

// ------------------------------------------------------------------------------------ authority and evidence

export type ActorRole = 'OWNER' | 'PROPERTY_MANAGER';

export function canSubmit(role: string): role is ActorRole {
  return role === 'OWNER' || role === 'PROPERTY_MANAGER';
}

/** OWNER-only review applies to every financial or exceptional proposal; otherwise any independent operator. */
export function reviewerRoleAllowed(
  role: string,
  proposal: { financialImpact: boolean },
  exceptional: boolean,
): boolean {
  if (!canSubmit(role)) return false;
  if (proposal.financialImpact || exceptional) return role === 'OWNER';
  return true;
}

export function evidenceRequired(input: {
  fieldKey: FieldKey;
  historical: boolean;
  exceptional: boolean;
}): boolean {
  return (
    input.fieldKey === 'monthlyPrice' ||
    input.exceptional ||
    (FIELD_SPECS[input.fieldKey].financial && input.historical)
  );
}

// ------------------------------------------------------------------------------------- dependency snapshots

export type SnapshotFacts = Record<string, string | null>;

/**
 * Compares the captured named facts with the facts read under the locks. Only keys captured at submission are compared,
 * so an unrelated change (a phone number, a note, an `updatedAt` bump) can never stale a proposal. Returns the closed
 * dependency-group code of the first difference, or null when intact. Keys are `GROUP:fact`.
 */
export function diffSnapshot(expected: SnapshotFacts, current: SnapshotFacts): string | null {
  for (const key of Object.keys(expected).sort()) {
    if ((expected[key] ?? null) !== (current[key] ?? null)) return key.split(':')[0]!;
  }
  return null;
}

// ----------------------------------------------------------------------------------------- request check

/** Deterministic JSON: object keys sorted recursively, so equal requests serialize identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Keyed request check stored on the receipt. A plain hash of low-entropy values (a name, a price) would be
 * dictionary-attackable because the key is stored beside it, so an HMAC with a server-side secret is used.
 */
export function requestCheck(
  secret: string,
  request: {
    action: string;
    proposalId: string | null;
    organizationId: string;
    actorId: string;
    payload: unknown;
  },
): string {
  return createHmac('sha256', secret).update(canonicalJson(request)).digest('hex');
}
