import {
  CorrectionError,
  FIELD_KEYS,
  FIELD_SPECS,
  MAX_REASON_LENGTH,
  TARGET_TYPES,
  parseProposedValue,
  parseZonedInstant,
  type FieldKey,
  type TargetType,
  type ValueEnvelope,
} from './corrections.rules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CorrectionError(400, 'INVALID_VALUE', 'Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

/** Unknown keys (organizationId, requestedBy, originalValue, status, financialImpact, reviewer ids ...) are refused. */
function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new CorrectionError(400, 'UNKNOWN_FIELD', `Unknown field: ${key.slice(0, 40)}`);
    }
  }
}

export function parseUuid(
  raw: unknown,
  field: string,
  code: 'INVALID_VALUE' | 'NOT_FOUND' = 'INVALID_VALUE',
): string {
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    if (code === 'NOT_FOUND') throw new CorrectionError(404, 'NOT_FOUND', 'Not found');
    throw new CorrectionError(400, 'INVALID_VALUE', `${field} must be a valid UUID`);
  }
  return raw.toLowerCase();
}

/** The Idempotency-Key header is the single source of the command key. */
export function parseIdempotencyKey(raw: unknown): string {
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw new CorrectionError(400, 'INVALID_VALUE', 'Idempotency-Key header must be a UUID');
  }
  return raw.toLowerCase();
}

function reasonText(raw: unknown, field: string, required = true): string | null {
  if (raw === undefined || raw === null) {
    if (required) throw new CorrectionError(400, 'INVALID_VALUE', `${field} is required`);
    return null;
  }
  if (typeof raw !== 'string')
    throw new CorrectionError(400, 'INVALID_VALUE', `${field} must be text`);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_REASON_LENGTH) {
    throw new CorrectionError(
      400,
      'INVALID_VALUE',
      `${field} must be 1 to ${MAX_REASON_LENGTH} characters`,
    );
  }
  return trimmed;
}

export interface SubmitInput {
  targetType: TargetType;
  targetId: string;
  fieldKey: FieldKey;
  proposed: ValueEnvelope;
  reason: string;
  effectiveAt: { canonical: string; date: Date };
  evidenceReference: string | null;
  relatedProposalId: string | null;
  relationshipKind: 'REVERSAL' | 'SUPERSEDES' | null;
}

export function parseSubmit(body: unknown, now: Date = new Date()): SubmitInput {
  const b = object(body);
  rejectUnknown(b, [
    'targetType',
    'targetId',
    'fieldKey',
    'proposedValue',
    'reason',
    'effectiveAt',
    'evidenceReference',
    'relatedProposalId',
    'relationshipKind',
  ]);
  if (!TARGET_TYPES.includes(b.targetType as TargetType)) {
    throw new CorrectionError(400, 'INVALID_FIELD', 'targetType is not allowed');
  }
  if (!FIELD_KEYS.includes(b.fieldKey as FieldKey)) {
    throw new CorrectionError(400, 'INVALID_FIELD', 'fieldKey is not allowed');
  }
  const targetType = b.targetType as TargetType;
  const fieldKey = b.fieldKey as FieldKey;
  if (FIELD_SPECS[fieldKey].target !== targetType) {
    throw new CorrectionError(400, 'INVALID_FIELD', 'fieldKey does not belong to targetType');
  }
  if (!('proposedValue' in b))
    throw new CorrectionError(400, 'INVALID_VALUE', 'proposedValue is required');
  const effectiveAt = parseZonedInstant(b.effectiveAt, 'effectiveAt');
  if (effectiveAt.date.getTime() > now.getTime()) {
    throw new CorrectionError(400, 'INVALID_VALUE', 'effectiveAt cannot be in the future');
  }
  const evidenceReference = reasonText(b.evidenceReference, 'evidenceReference', false);
  if (
    b.evidenceReference !== undefined &&
    b.evidenceReference !== null &&
    evidenceReference === null
  ) {
    throw new CorrectionError(400, 'INVALID_EVIDENCE', 'evidenceReference is invalid');
  }
  const hasRelated = b.relatedProposalId !== undefined && b.relatedProposalId !== null;
  const hasKind = b.relationshipKind !== undefined && b.relationshipKind !== null;
  if (hasRelated !== hasKind) {
    throw new CorrectionError(
      400,
      'INVALID_VALUE',
      'relatedProposalId and relationshipKind go together',
    );
  }
  if (hasKind && b.relationshipKind !== 'REVERSAL' && b.relationshipKind !== 'SUPERSEDES') {
    throw new CorrectionError(
      400,
      'INVALID_VALUE',
      'relationshipKind must be REVERSAL or SUPERSEDES',
    );
  }
  return {
    targetType,
    targetId: parseUuid(b.targetId, 'targetId'),
    fieldKey,
    proposed: parseProposedValue(fieldKey, b.proposedValue),
    reason: reasonText(b.reason, 'reason')!,
    effectiveAt,
    evidenceReference,
    relatedProposalId: hasRelated ? parseUuid(b.relatedProposalId, 'relatedProposalId') : null,
    relationshipKind: hasKind ? (b.relationshipKind as 'REVERSAL' | 'SUPERSEDES') : null,
  };
}

export function parseApprove(body: unknown): {
  decisionReason: string;
  exceptionRationale: string | null;
} {
  const b = object(body ?? {});
  rejectUnknown(b, ['decisionReason', 'exceptionRationale']);
  return {
    decisionReason: reasonText(b.decisionReason, 'decisionReason')!,
    exceptionRationale: reasonText(b.exceptionRationale, 'exceptionRationale', false),
  };
}

export function parseReasonOnly(body: unknown): { reason: string } {
  const b = object(body ?? {});
  rejectUnknown(b, ['reason']);
  return { reason: reasonText(b.reason, 'reason')! };
}

export interface ListQuery {
  page: number;
  limit: number;
  status?: string;
  targetType?: TargetType;
  targetId?: string;
  financialImpact?: boolean;
}

const STATUSES = ['PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN', 'STALE'];

export function parseListQuery(raw: unknown, requireTarget = false): ListQuery {
  const q = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  rejectUnknown(q, ['page', 'limit', 'status', 'targetType', 'targetId', 'financialImpact']);
  const page = q.page === undefined ? 1 : Number(q.page);
  const limit = q.limit === undefined ? 20 : Number(q.limit);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) {
    throw new CorrectionError(400, 'INVALID_VALUE', 'page must be a positive integer');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new CorrectionError(400, 'INVALID_VALUE', 'limit must be 1 to 100');
  }
  const out: ListQuery = { page, limit };
  if (q.status !== undefined && q.status !== '') {
    if (!STATUSES.includes(String(q.status)))
      throw new CorrectionError(400, 'INVALID_VALUE', 'status is invalid');
    out.status = String(q.status);
  }
  if (q.targetType !== undefined && q.targetType !== '') {
    if (!TARGET_TYPES.includes(q.targetType as TargetType)) {
      throw new CorrectionError(400, 'INVALID_VALUE', 'targetType is invalid');
    }
    out.targetType = q.targetType as TargetType;
  }
  if (q.targetId !== undefined && q.targetId !== '')
    out.targetId = parseUuid(q.targetId, 'targetId');
  if (q.financialImpact !== undefined && q.financialImpact !== '') {
    if (q.financialImpact !== 'true' && q.financialImpact !== 'false') {
      throw new CorrectionError(400, 'INVALID_VALUE', 'financialImpact must be true or false');
    }
    out.financialImpact = q.financialImpact === 'true';
  }
  if (requireTarget && (!out.targetType || !out.targetId)) {
    throw new CorrectionError(400, 'INVALID_VALUE', 'targetType and targetId are required');
  }
  return out;
}

export function parseResolve(body: unknown): {
  outcome: 'RELEASED' | 'NO_SUPPORTED_REMEDY' | 'OPERATION_RECORDED';
  reason: string;
  operation: { type: 'adjustment' | 'reversal' | 'void' | 'payment'; id: string } | null;
} {
  const b = object(body ?? {});
  rejectUnknown(b, ['outcome', 'reason', 'operation']);
  if (
    b.outcome !== 'RELEASED' &&
    b.outcome !== 'NO_SUPPORTED_REMEDY' &&
    b.outcome !== 'OPERATION_RECORDED'
  ) {
    throw new CorrectionError(400, 'INVALID_VALUE', 'outcome is invalid');
  }
  let operation: { type: 'adjustment' | 'reversal' | 'void' | 'payment'; id: string } | null = null;
  if (b.outcome === 'OPERATION_RECORDED') {
    const op = object(b.operation);
    rejectUnknown(op, ['type', 'id']);
    if (!['adjustment', 'reversal', 'void', 'payment'].includes(String(op.type))) {
      throw new CorrectionError(400, 'INVALID_VALUE', 'operation.type is invalid');
    }
    operation = {
      type: op.type as 'adjustment' | 'reversal' | 'void' | 'payment',
      id: parseUuid(op.id, 'operation.id'),
    };
  } else if (b.operation !== undefined) {
    throw new CorrectionError(
      400,
      'INVALID_VALUE',
      'operation is only allowed for OPERATION_RECORDED',
    );
  }
  return { outcome: b.outcome, reason: reasonText(b.reason, 'reason')!, operation };
}
