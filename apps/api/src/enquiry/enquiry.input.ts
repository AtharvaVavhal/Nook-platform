import { BadRequestException } from '@nestjs/common';
import {
  MAX_NAME,
  MAX_NOTES,
  MAX_SHORT_TEXT,
  asQuery,
  has,
  oneOf,
  optionalDate,
  optionalEmail,
  optionalInt,
  optionalObject,
  optionalText,
  optionalUuidField,
  queryDate,
  queryEnum,
  queryInt,
  queryText,
  queryUuid,
  requireObject,
  requiredDate,
  requiredPhone,
  requiredText,
  type Fields,
} from '../common/input.js';

export const ENQUIRY_SOURCES = [
  'WEBSITE',
  'PHONE_CALL',
  'WALK_IN',
  'REFERRAL',
  'SOCIAL_MEDIA',
  'OTHER',
] as const;
export const ENQUIRY_STATUSES = [
  'NEW',
  'CONTACTED',
  'FOLLOW_UP',
  'INTERESTED',
  'CONVERTED',
  'LOST',
  'ARCHIVED',
] as const;
/** Statuses a client may set with PUT. CONVERTED only happens through /convert, ARCHIVED through DELETE. */
export const SETTABLE_ENQUIRY_STATUSES = [
  'NEW',
  'CONTACTED',
  'FOLLOW_UP',
  'INTERESTED',
  'LOST',
] as const;

type Source = (typeof ENQUIRY_SOURCES)[number];
type Status = (typeof ENQUIRY_STATUSES)[number];

export interface EnquiryFields {
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  preferredPropertyId: string | null;
  preferredRoomType: string | null;
  expectedMoveInDate: Date | null;
  expectedDurationOfStay: number | null;
  numberOfOccupants: number | null;
  source: Source;
  notes: string | null;
  assignedUserId: unknown;
}

export function parseCreateEnquiry(body: unknown): EnquiryFields {
  const input = requireObject(body);
  return {
    firstName: requiredText(input, 'firstName', MAX_NAME),
    lastName: requiredText(input, 'lastName', MAX_NAME),
    phone: requiredPhone(input, 'phone'),
    email: optionalEmail(input, 'email') ?? null,
    preferredPropertyId: optionalUuidField(input, 'preferredPropertyId') ?? null,
    preferredRoomType: optionalText(input, 'preferredRoomType', MAX_SHORT_TEXT) ?? null,
    expectedMoveInDate: optionalDate(input, 'expectedMoveInDate') ?? null,
    expectedDurationOfStay: optionalInt(input, 'expectedDurationOfStay', 1, 3650) ?? null,
    numberOfOccupants: optionalInt(input, 'numberOfOccupants', 1, 20) ?? null,
    source:
      has(input, 'source') && input.source !== null
        ? oneOf(input.source, ENQUIRY_SOURCES, 'source')
        : 'OTHER',
    notes: optionalText(input, 'notes', MAX_NOTES) ?? null,
    // validated against the organization's members by the service
    assignedUserId: input.assignedUserId,
  };
}

/** Only the fields present in the body appear in the result (absent = leave unchanged). */
export type UpdateEnquiryInput = Partial<Omit<EnquiryFields, 'source' | 'assignedUserId'>> & {
  source?: Source;
  status?: (typeof SETTABLE_ENQUIRY_STATUSES)[number];
  assignedUserId?: unknown;
};

export function parseUpdateEnquiry(body: unknown): UpdateEnquiryInput {
  const input = requireObject(body);
  const out: UpdateEnquiryInput = {};
  const set = <K extends keyof UpdateEnquiryInput>(key: K, value: UpdateEnquiryInput[K]) => {
    if (value !== undefined) out[key] = value;
  };
  for (const key of ['firstName', 'lastName'] as const) {
    if (has(input, key)) set(key, requiredText(input, key, MAX_NAME));
  }
  if (has(input, 'phone')) set('phone', requiredPhone(input, 'phone'));
  set('email', optionalEmail(input, 'email'));
  if (has(input, 'preferredPropertyId')) {
    out.preferredPropertyId = optionalUuidField(input, 'preferredPropertyId') ?? null;
  }
  set('preferredRoomType', optionalText(input, 'preferredRoomType', MAX_SHORT_TEXT));
  set('expectedMoveInDate', optionalDate(input, 'expectedMoveInDate'));
  set('expectedDurationOfStay', optionalInt(input, 'expectedDurationOfStay', 1, 3650));
  set('numberOfOccupants', optionalInt(input, 'numberOfOccupants', 1, 20));
  set('notes', optionalText(input, 'notes', MAX_NOTES));
  if (has(input, 'source')) out.source = oneOf(input.source, ENQUIRY_SOURCES, 'source');
  if (has(input, 'status')) {
    if (input.status === 'CONVERTED') {
      throw new BadRequestException(
        'An enquiry becomes CONVERTED only through POST /enquiries/:id/convert',
      );
    }
    if (input.status === 'ARCHIVED') {
      throw new BadRequestException('An enquiry is archived with DELETE /enquiries/:id');
    }
    out.status = oneOf(input.status, SETTABLE_ENQUIRY_STATUSES, 'status');
  }
  if (has(input, 'assignedUserId')) out.assignedUserId = input.assignedUserId;
  return out;
}

export interface FollowUpInput {
  notes: string;
  followUpAt: Date;
  outcome: string | null;
}

export function parseFollowUp(body: unknown): FollowUpInput {
  const input = requireObject(body);
  return {
    notes: requiredText(input, 'notes', MAX_NOTES),
    followUpAt: requiredDate(input, 'followUpAt'),
    outcome: optionalText(input, 'outcome', 500) ?? null,
  };
}

/** The optional resident overrides sent with /convert must be a JSON object when present. */
export function parseConvertBody(body: unknown): Fields {
  return optionalObject(body, 'Request body');
}

export interface EnquiryQuery {
  search?: string | undefined;
  status?: Status | undefined;
  source?: Source | undefined;
  propertyId?: string | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  page: unknown;
  limit: unknown;
}

export function parseEnquiryQuery(raw: unknown): EnquiryQuery {
  const query = asQuery(raw);
  const fromDate = queryDate(query, 'fromDate');
  const toDate = queryDate(query, 'toDate');
  if (fromDate && toDate && toDate < fromDate) {
    throw new BadRequestException('toDate must not be before fromDate');
  }
  return {
    search: queryText(query, 'search'),
    status: queryEnum(query, 'status', ENQUIRY_STATUSES),
    source: queryEnum(query, 'source', ENQUIRY_SOURCES),
    propertyId: queryUuid(query, 'propertyId'),
    fromDate,
    toDate,
    page: query.page,
    limit: query.limit,
  };
}

/** `?days=` for the upcoming follow-ups list: a whole number of days, 1 to 365 (default 7). */
export function parseUpcomingDays(raw: unknown): number {
  return queryInt(asQuery({ days: raw }), 'days', 1, 365, 7);
}
