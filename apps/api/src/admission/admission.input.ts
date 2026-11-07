import {
  MAX_NOTES,
  asQuery,
  has,
  oneOf,
  optionalText,
  optionalUuidField,
  queryDate,
  queryEnum,
  queryText,
  queryUuid,
  requireObject,
  requireUuid,
  requiredDate,
  type Fields,
} from '../common/input.js';
import { BadRequestException } from '@nestjs/common';

export const ADMISSION_STATUSES = ['PENDING', 'ADMITTED', 'CANCELLED'] as const;
export type AdmissionStatusValue = (typeof ADMISSION_STATUSES)[number];

export interface CreateAdmissionInput {
  bookingId: string;
  admissionDate: Date;
  notes: string | null;
  propertyId: string | null;
  roomId: string | null;
  /** Optional echoes of what the booking already says; the service rejects any that disagree. */
  residentId: string | null;
  bedId: string | null;
}

export function parseCreateAdmission(body: unknown): CreateAdmissionInput {
  const input = requireObject(body);
  return {
    bookingId: requireUuid(input.bookingId, 'bookingId'),
    admissionDate: requiredDate(input, 'admissionDate'),
    notes: optionalText(input, 'notes', MAX_NOTES) ?? null,
    propertyId: optionalUuidField(input, 'propertyId') ?? null,
    roomId: optionalUuidField(input, 'roomId') ?? null,
    residentId: optionalUuidField(input, 'residentId') ?? null,
    bedId: optionalUuidField(input, 'bedId') ?? null,
  };
}

export interface UpdateAdmissionInput {
  admissionDate?: Date;
  notes?: string | null;
  status?: AdmissionStatusValue;
  /** `undefined` = not sent. These select the location change handled by the service. */
  propertyId?: string | null | undefined;
  roomId?: string | null | undefined;
  residentId: string | null;
  bedId: string | null;
  bookingId: string | null;
}

export function parseUpdateAdmission(body: unknown): UpdateAdmissionInput {
  const input = requireObject(body);
  const out: UpdateAdmissionInput = {
    residentId: optionalUuidField(input, 'residentId') ?? null,
    bedId: optionalUuidField(input, 'bedId') ?? null,
    bookingId: optionalUuidField(input, 'bookingId') ?? null,
  };
  if (has(input, 'admissionDate')) out.admissionDate = requiredDate(input, 'admissionDate');
  const notes = optionalText(input, 'notes', MAX_NOTES);
  if (notes !== undefined) out.notes = notes;
  if (has(input, 'status')) out.status = oneOf(input.status, ADMISSION_STATUSES, 'status');
  if (has(input, 'propertyId')) out.propertyId = optionalUuidField(input, 'propertyId') ?? null;
  if (has(input, 'roomId')) out.roomId = optionalUuidField(input, 'roomId') ?? null;
  return out;
}

export interface AdmissionQuery {
  search?: string | undefined;
  status?: AdmissionStatusValue | undefined;
  residentId?: string | undefined;
  bookingId?: string | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  page: unknown;
  limit: unknown;
}

export function parseAdmissionQuery(raw: unknown): AdmissionQuery {
  const query: Fields = asQuery(raw);
  const fromDate = queryDate(query, 'fromDate');
  const toDate = queryDate(query, 'toDate');
  if (fromDate && toDate && toDate < fromDate) {
    throw new BadRequestException('toDate must not be before fromDate');
  }
  return {
    search: queryText(query, 'search'),
    status: queryEnum(query, 'status', ADMISSION_STATUSES),
    residentId: queryUuid(query, 'residentId'),
    bookingId: queryUuid(query, 'bookingId'),
    fromDate,
    toDate,
    page: query.page,
    limit: query.limit,
  };
}
