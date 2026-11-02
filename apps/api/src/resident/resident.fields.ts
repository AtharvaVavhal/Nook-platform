import { BadRequestException } from '@nestjs/common';
import { DocumentVerificationStatus, ResidentStatus } from '../generated/enums.js';

const TEXT_FIELDS = [
  'gender',
  'phone',
  'email',
  'address',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'documentUrl',
] as const;
const REQUIRED_TEXT_FIELDS = ['firstName', 'lastName'] as const;
const MAX_TEXT = 500;

type Fields = Record<string, unknown>;

/**
 * The only resident fields a request may set. Everything else in a request body (organizationId, id,
 * timestamps, anything unknown) is dropped, so a body can never move a resident to another organization
 * or choose its identity. `partial` is true for updates, where only the supplied fields are returned.
 */
export function pickResidentFields(input: unknown, partial: boolean): Fields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Request body must be an object');
  }
  const body = input as Fields;
  const out: Fields = {};

  for (const key of REQUIRED_TEXT_FIELDS) {
    const value = body[key];
    if (value === undefined && partial) continue;
    if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_TEXT) {
      throw new BadRequestException(`${key} is required (1 to ${MAX_TEXT} characters)`);
    }
    out[key] = value.trim();
  }
  for (const key of TEXT_FIELDS) {
    const value = body[key];
    if (value === undefined) continue;
    if (value === null || value === '') {
      out[key] = null;
      continue;
    }
    if (typeof value !== 'string' || value.length > MAX_TEXT) {
      throw new BadRequestException(`${key} must be text of at most ${MAX_TEXT} characters`);
    }
    out[key] = value;
  }
  if (body.dateOfBirth !== undefined) {
    if (body.dateOfBirth === null || body.dateOfBirth === '') out.dateOfBirth = null;
    else {
      const date =
        typeof body.dateOfBirth === 'string' ? new Date(body.dateOfBirth) : new Date(NaN);
      if (Number.isNaN(date.getTime()))
        throw new BadRequestException('dateOfBirth must be a valid date');
      out.dateOfBirth = date;
    }
  }
  if (body.documentMetadata !== undefined) {
    const meta = body.documentMetadata;
    if (meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) {
      throw new BadRequestException('documentMetadata must be an object');
    }
    out.documentMetadata = meta;
  }
  if (body.status !== undefined) {
    if (!Object.values(ResidentStatus).includes(body.status as never)) {
      throw new BadRequestException(
        `status must be one of ${Object.values(ResidentStatus).join(', ')}`,
      );
    }
    out.status = body.status;
  }
  if (body.documentVerificationStatus !== undefined) {
    if (
      !Object.values(DocumentVerificationStatus).includes(body.documentVerificationStatus as never)
    ) {
      throw new BadRequestException(
        `documentVerificationStatus must be one of ${Object.values(DocumentVerificationStatus).join(', ')}`,
      );
    }
    out.documentVerificationStatus = body.documentVerificationStatus;
  }
  return out;
}
