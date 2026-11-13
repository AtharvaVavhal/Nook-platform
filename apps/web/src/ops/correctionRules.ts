import type { CorrectionFieldKey, CorrectionTargetType, CorrectionValue } from './opsApi';

/**
 * Pure helpers for the correction screens (no React, no network), so the rules that matter are unit-tested:
 * which input each field uses, how an Idempotency-Key survives a network retry, and what each server answer means
 * for the operator. Authority is never decided here: the server's `allowedActions` is what the screens show.
 */

export type InputKind = 'text' | 'nullableText' | 'date' | 'instant' | 'money';

export interface FieldOption {
  target: CorrectionTargetType;
  field: CorrectionFieldKey;
  label: string;
  input: InputKind;
  financial: boolean;
  hint: string;
}

export const FIELD_OPTIONS: readonly FieldOption[] = [
  {
    target: 'RESIDENT',
    field: 'firstName',
    label: 'First name',
    input: 'text',
    financial: false,
    hint: 'The corrected spelling, 1 to 500 characters.',
  },
  {
    target: 'RESIDENT',
    field: 'lastName',
    label: 'Last name',
    input: 'text',
    financial: false,
    hint: 'The corrected spelling, 1 to 500 characters.',
  },
  {
    target: 'BOOKING',
    field: 'startDate',
    label: 'Booking start date',
    input: 'date',
    financial: true,
    hint: 'Must stay before the end date and cover the admission and check-in days.',
  },
  {
    target: 'BOOKING',
    field: 'endDate',
    label: 'Booking end date (shorten only)',
    input: 'date',
    financial: true,
    hint: 'A correction can only shorten a booking. To lengthen it, use the booking extension.',
  },
  {
    target: 'BOOKING',
    field: 'monthlyPrice',
    label: 'Monthly price',
    input: 'money',
    financial: true,
    hint: 'Only to fix a recording error against the agreed price. Evidence of the agreement is required.',
  },
  {
    target: 'ADMISSION',
    field: 'admissionDate',
    label: 'Admission date',
    input: 'date',
    financial: true,
    hint: 'Must fall inside the booking period and not after the check-in day.',
  },
  {
    target: 'CHECK_IN',
    field: 'checkInAt',
    label: 'Check-in time',
    input: 'instant',
    financial: true,
    hint: 'The actual arrival time. It cannot be in the future.',
  },
  {
    target: 'CHECK_OUT',
    field: 'checkOutAt',
    label: 'Check-out time',
    input: 'instant',
    financial: true,
    hint: 'The actual departure time. It cannot be before the check-in or in the future.',
  },
  {
    target: 'CHECK_OUT',
    field: 'reason',
    label: 'Check-out reason',
    input: 'nullableText',
    financial: false,
    hint: 'The corrected departure reason. Leave empty to clear it.',
  },
];

export const TARGET_LABELS: Record<CorrectionTargetType, string> = {
  RESIDENT: 'Resident',
  BOOKING: 'Booking',
  ADMISSION: 'Admission',
  CHECK_IN: 'Check-in',
  CHECK_OUT: 'Check-out',
};

export function fieldLabel(field: string): string {
  return FIELD_OPTIONS.find((f) => f.field === field)?.label ?? field;
}

export function fieldsFor(target: CorrectionTargetType): FieldOption[] {
  return FIELD_OPTIONS.filter((f) => f.target === target);
}

export function optionFor(field: string): FieldOption | undefined {
  return FIELD_OPTIONS.find((f) => f.field === field);
}

/** Evidence is always required for a price, and for any financial or occupancy field when the fact is not from today. */
export function evidenceLikelyRequired(field: CorrectionFieldKey): boolean {
  return field === 'monthlyPrice' || (optionFor(field)?.financial ?? false);
}

/** `datetime-local` (`YYYY-MM-DDTHH:mm`) is Asia/Kolkata wall-clock time; the API needs an explicit zone. */
export function toZonedInstant(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local))
    throw new Error('Enter a valid date and time.');
  return `${local.length === 16 ? `${local}:00` : local}+05:30`;
}

/** The current moment as a `datetime-local` value in Asia/Kolkata. */
export function nowIstLocal(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

export function proposedPayload(option: FieldOption, raw: string): string | null {
  const text = raw.trim();
  switch (option.input) {
    case 'nullableText':
      return text === '' ? null : text;
    case 'instant':
      return toZonedInstant(text);
    default:
      return text;
  }
}

export function validateProposed(option: FieldOption, raw: string): string | null {
  const text = raw.trim();
  if (option.input === 'nullableText')
    return text.length > 500 ? 'Use at most 500 characters.' : null;
  if (text === '') return 'Enter the corrected value.';
  switch (option.input) {
    case 'text':
      return text.length > 500 ? 'Use at most 500 characters.' : null;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? null : 'Enter a date.';
    case 'instant':
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) ? null : 'Enter a date and time.';
    case 'money':
      return /^\d{1,8}(\.\d{1,2})?$/.test(text) && Number(text) > 0
        ? null
        : 'Enter an amount such as 8500 or 8500.50.';
  }
}

/** How a stored value is shown. A pending proposed value is always labelled as proposed by the screen, never as current. */
export function valueText(value: CorrectionValue | null | undefined, field?: string): string {
  if (!value || value.value === null) return value ? 'Empty' : '—';
  if (value.kind === 'money') return `₹${value.value}`;
  if (value.kind === 'instant') return formatInstantIst(value.value);
  if (value.kind === 'date') return value.value;
  void field;
  return value.value;
}

export function formatInstantIst(canonical: string): string {
  const d = new Date(canonical.replace(/\.(\d{3})\d{3}Z$/, '.$1Z'));
  if (Number.isNaN(d.getTime())) return canonical;
  const ist = new Date(d.getTime() + 330 * 60_000).toISOString();
  return `${ist.slice(0, 10)} ${ist.slice(11, 16)} IST`;
}

// ------------------------------------------------------------------------------- idempotency-key persistence

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'nook.correction.key.';

/**
 * Keeps the Idempotency-Key of a command until the command reaches a definitive answer. A network failure or a
 * "retry required" answer keeps the key (so a re-send is a replay, never a second command); a definitive answer clears it.
 * Backed by sessionStorage so a page reload between send and answer also keeps it. Storage failures never break the screen.
 */
export class CommandKeys {
  private readonly memory = new Map<string, string>();
  constructor(
    private readonly storage: KeyStorage | null,
    private readonly generate: () => string = () => crypto.randomUUID(),
  ) {}

  keyFor(signature: string): string {
    const known = this.memory.get(signature) ?? this.read(signature);
    if (known) {
      this.memory.set(signature, known);
      return known;
    }
    const fresh = this.generate();
    this.memory.set(signature, fresh);
    this.write(signature, fresh);
    return fresh;
  }

  clear(signature: string): void {
    this.memory.delete(signature);
    try {
      this.storage?.removeItem(PREFIX + signature);
    } catch {
      /* private mode or blocked storage: the in-memory key is already gone */
    }
  }

  private read(signature: string): string | null {
    try {
      return this.storage?.getItem(PREFIX + signature) ?? null;
    } catch {
      return null;
    }
  }

  private write(signature: string, key: string): void {
    try {
      this.storage?.setItem(PREFIX + signature, key);
    } catch {
      /* in-memory only */
    }
  }
}

export function browserKeyStorage(): KeyStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** A stable signature for "the same command": changing any part of it is a different command with its own key. */
export function commandSignature(parts: readonly (string | null | undefined)[]): string {
  return parts.map((p) => p ?? '').join('\u0001');
}

// ------------------------------------------------------------------------------------- server answers

export type Advice =
  | { kind: 'retry-same-key'; message: string }
  | { kind: 'new-proposal'; message: string }
  | { kind: 'refresh'; message: string }
  | { kind: 'fix-input'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'other'; message: string };

/**
 * What an error answer means. `status` 0 is a network failure (the outcome is uncertain). Only RETRY_REQUIRED and network
 * failures keep the Idempotency-Key; STALE_SOURCE means the proposal is finished and a NEW one is needed.
 */
export function adviceFor(status: number, code: string | undefined, message: string): Advice {
  if (status === 0 || code === 'RETRY_REQUIRED') {
    return {
      kind: 'retry-same-key',
      message:
        'We could not confirm the result. Retry — the same request will not be applied twice.',
    };
  }
  switch (code) {
    case 'STALE_SOURCE':
      return {
        kind: 'new-proposal',
        message:
          'The record changed after this correction was proposed, so it can no longer be applied. Refresh and submit a new correction.',
      };
    case 'PENDING_CONFLICT':
      return {
        kind: 'refresh',
        message:
          'Another correction for this field is already pending. Review or withdraw it first.',
      };
    case 'LIFECYCLE_CONFLICT':
    case 'FINANCE_CONFLICT':
    case 'EVIDENCE_REQUIRED':
    case 'INVALID_STATE':
      return { kind: 'refresh', message };
    case 'IDEMPOTENCY_CONFLICT':
      return {
        kind: 'fix-input',
        message:
          'This request was already used for a different correction. Reload the page and try again.',
      };
    case 'SELF_REVIEW':
    case 'INSUFFICIENT_ROLE':
      return { kind: 'denied', message };
    case 'INVALID_VALUE':
    case 'INVALID_FIELD':
    case 'INVALID_EVIDENCE':
    case 'UNKNOWN_FIELD':
      return { kind: 'fix-input', message };
    default:
      return { kind: 'other', message };
  }
}

/** Whether the Idempotency-Key must be kept for a re-send. */
export function keepsKey(advice: Advice): boolean {
  return advice.kind === 'retry-same-key';
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending review',
  APPLIED: 'Applied',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  STALE: 'Stale — needs a new proposal',
};

export const STALE_CAUSE_LABEL: Record<string, string> = {
  RESIDENT_FIELD: 'the resident record changed',
  BOOKING_TERMS: 'the booking changed',
  ADMISSION: 'the admission changed',
  CHECK_IN: 'the check-in changed',
  CHECK_OUT: 'the check-out changed',
  INVOICE_SLOTS: 'the invoices for this booking changed',
};
