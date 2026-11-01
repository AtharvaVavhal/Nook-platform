import { BadRequestException } from '@nestjs/common';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_INPUT',
      details: [{ field, code: 'INVALID_UUID' }],
    });
  }
  return value;
}

export function parseBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidInput();
  }
  return value as Record<string, unknown>;
}

export function stringField(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): string | undefined {
  if (!(field in body)) {
    if (required) throw invalidInput(field, 'REQUIRED');
    return undefined;
  }
  if (typeof body[field] !== 'string') throw invalidInput(field, 'INVALID_STRING');
  const value = body[field].trim();
  if (
    value.length < 1 ||
    value.length > 200 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  ) {
    throw invalidInput(field, 'INVALID_LENGTH');
  }
  return value;
}

export function labelField(body: Record<string, unknown>, required: boolean) {
  const value = stringField(body, 'label', required);
  if (value !== undefined && value.length > 32) throw invalidInput('label', 'INVALID_LENGTH');
  return value;
}

export function codeField(body: Record<string, unknown>, required: boolean) {
  const value = stringField(body, 'code', required);
  if (value !== undefined && value.length > 64) throw invalidInput('code', 'INVALID_LENGTH');
  return value;
}

export function ordinalField(body: Record<string, unknown>, required: boolean) {
  if (!('ordinal' in body)) {
    if (required) throw invalidInput('ordinal', 'REQUIRED');
    return undefined;
  }
  const value = body.ordinal;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10000) {
    throw invalidInput('ordinal', 'INVALID_INTEGER');
  }
  return value;
}

export function rejectOrganizationFields(body: Record<string, unknown>) {
  for (const field of ['organizationId', 'organisationId', 'membershipId']) {
    if (field in body) throw invalidInput(field, 'UNKNOWN_FIELD');
  }
}

export function operationalStatusField(
  body: Record<string, unknown>,
): 'IN_SERVICE' | 'OUT_OF_SERVICE' | undefined {
  if (!('operationalStatus' in body)) return undefined;
  if (body.operationalStatus !== 'IN_SERVICE' && body.operationalStatus !== 'OUT_OF_SERVICE') {
    throw invalidInput('operationalStatus', 'INVALID_ENUM');
  }
  return body.operationalStatus;
}

export function outOfServiceReasonField(
  body: Record<string, unknown>,
  operationalStatus: 'IN_SERVICE' | 'OUT_OF_SERVICE' | undefined,
): string | undefined {
  const reason = stringField(body, 'outOfServiceReason', false);
  if (operationalStatus === 'OUT_OF_SERVICE' && !reason) {
    throw invalidInput('outOfServiceReason', 'REQUIRED');
  }
  if (operationalStatus === 'IN_SERVICE' && reason !== undefined) {
    throw invalidInput('outOfServiceReason', 'FORBIDDEN');
  }
  return reason;
}

export function invalidInput(field?: string, code = 'INVALID_VALUE'): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_INPUT',
    ...(field ? { details: [{ field, code }] } : {}),
  });
}
