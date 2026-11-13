import { BadRequestException } from '@nestjs/common';
import { istDateOf, resolveInstant } from '../common/time.js';

/** Roles that may approve a booking extension (OWNER and PROPERTY_MANAGER have equal authority). */
export const EXTENSION_APPROVER_ROLES = ['OWNER', 'PROPERTY_MANAGER'] as const;

export function canApproveExtension(role: string): boolean {
  return (EXTENSION_APPROVER_ROLES as readonly string[]).includes(role);
}

export interface ExtensionRequest {
  /** UTC-midnight value of the new end date's Asia/Kolkata calendar date (the end is exclusive). */
  newEndDate: Date;
  reason: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Validates { newEndDate, reason }. A date-only value is a calendar date; an instant is read as IST. */
export function parseExtensionRequest(body: unknown): ExtensionRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;
  const raw = input.newEndDate;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException('newEndDate is required');
  }
  const text = raw.trim();
  const parsed = DATE_ONLY.test(text)
    ? new Date(`${text}T00:00:00Z`)
    : resolveInstant(text, 'newEndDate');
  if (
    Number.isNaN(parsed.getTime()) ||
    (DATE_ONLY.test(text) && parsed.toISOString().slice(0, 10) !== text)
  ) {
    throw new BadRequestException('newEndDate must be a valid date');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) {
    throw new BadRequestException('reason is required (3 to 500 characters)');
  }
  return { newEndDate: istDateOf(parsed), reason };
}
