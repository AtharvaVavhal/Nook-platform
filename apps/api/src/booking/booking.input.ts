import { BadRequestException } from '@nestjs/common';
import { istDateOf } from '../common/time.js';
import { parseMoney } from '../finance/finance.util.js';
import {
  MAX_NOTES,
  asQuery,
  has,
  oneOf,
  optionalDate,
  optionalText,
  queryDate,
  queryEnum,
  queryText,
  queryUuid,
  requireObject,
  requireUuid,
  requiredDate,
  type Fields,
} from '../common/input.js';

export const BOOKING_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'OVERDUE', 'REFUNDED'] as const;

/** monthly_price is DECIMAL(10,2): eight integer digits. Anything larger would be a database error. */
const MAX_MONTHLY_PRICE = 99_999_999.99;

export interface CreateBookingInput {
  residentId: string;
  bedId: string;
  startDate: Date;
  endDate: Date;
  /** Two-decimal string, greater than zero. */
  monthlyPrice: string;
  notes: string | null;
}

export interface UpdateBookingInput {
  startDate?: Date;
  endDate?: Date;
  monthlyPrice?: string;
  notes?: string | null;
  status?: (typeof BOOKING_STATUSES)[number];
  paymentStatus?: (typeof PAYMENT_STATUSES)[number];
}

export function parseMonthlyPrice(value: unknown, field = 'monthlyPrice'): string {
  const amount = parseMoney(value, field);
  if (amount.gt(MAX_MONTHLY_PRICE)) {
    throw new BadRequestException(`${field} must not exceed ${MAX_MONTHLY_PRICE.toFixed(2)}`);
  }
  return amount.toFixed(2);
}

/** The end date is exclusive, so a booking must cover at least one night: its end is a later IST calendar day. */
export function assertValidPeriod(startDate: Date, endDate: Date): void {
  if (istDateOf(endDate).getTime() <= istDateOf(startDate).getTime()) {
    throw new BadRequestException('endDate must be after startDate');
  }
}

/**
 * Whether a calendar date falls inside the booking period [start, end) when all three are read as Asia/Kolkata
 * days (the end is exclusive). Used to keep an admission date consistent with the booking it belongs to.
 */
export function periodContains(startDate: Date, endDate: Date, date: Date): boolean {
  const day = istDateOf(date).getTime();
  return day >= istDateOf(startDate).getTime() && day < istDateOf(endDate).getTime();
}

export function parseCreateBooking(body: unknown): CreateBookingInput {
  const input = requireObject(body);
  const startDate = requiredDate(input, 'startDate');
  const endDate = requiredDate(input, 'endDate');
  assertValidPeriod(startDate, endDate);
  return {
    residentId: requireUuid(input.residentId, 'residentId'),
    bedId: requireUuid(input.bedId, 'bedId'),
    startDate,
    endDate,
    monthlyPrice: parseMonthlyPrice(input.monthlyPrice),
    notes: optionalText(input, 'notes', MAX_NOTES) ?? null,
  };
}

/** Each field is optional; the period rule is re-checked by the service against the stored dates. */
export function parseUpdateBooking(body: unknown): UpdateBookingInput {
  const input = requireObject(body);
  const out: UpdateBookingInput = {};
  const startDate = optionalDate(input, 'startDate');
  const endDate = optionalDate(input, 'endDate');
  if (startDate === null || endDate === null) {
    throw new BadRequestException('startDate and endDate cannot be cleared');
  }
  if (startDate !== undefined) out.startDate = startDate;
  if (endDate !== undefined) out.endDate = endDate;
  if (has(input, 'monthlyPrice')) out.monthlyPrice = parseMonthlyPrice(input.monthlyPrice);
  const notes = optionalText(input, 'notes', MAX_NOTES);
  if (notes !== undefined) out.notes = notes;
  if (has(input, 'status')) out.status = oneOf(input.status, BOOKING_STATUSES, 'status');
  if (has(input, 'paymentStatus')) {
    out.paymentStatus = oneOf(input.paymentStatus, PAYMENT_STATUSES, 'paymentStatus');
  }
  return out;
}

export interface BookingQuery {
  search?: string | undefined;
  status?: (typeof BOOKING_STATUSES)[number] | undefined;
  paymentStatus?: (typeof PAYMENT_STATUSES)[number] | undefined;
  residentId?: string | undefined;
  bedId?: string | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  page: unknown;
  limit: unknown;
}

export function parseBookingQuery(raw: unknown): BookingQuery {
  const query: Fields = asQuery(raw);
  const fromDate = queryDate(query, 'fromDate');
  const toDate = queryDate(query, 'toDate');
  if (fromDate && toDate && toDate < fromDate) {
    throw new BadRequestException('toDate must not be before fromDate');
  }
  return {
    search: queryText(query, 'search'),
    status: queryEnum(query, 'status', BOOKING_STATUSES),
    paymentStatus: queryEnum(query, 'paymentStatus', PAYMENT_STATUSES),
    residentId: queryUuid(query, 'residentId'),
    bedId: queryUuid(query, 'bedId'),
    fromDate,
    toDate,
    page: query.page,
    limit: query.limit,
  };
}

export interface AvailabilityQuery {
  startDate: Date;
  endDate: Date;
  propertyId?: string | undefined;
}

export function parseAvailabilityQuery(raw: unknown): AvailabilityQuery {
  const query = asQuery(raw);
  const startDate = queryDate(query, 'startDate');
  const endDate = queryDate(query, 'endDate');
  if (!startDate || !endDate) {
    throw new BadRequestException('startDate and endDate are required valid dates');
  }
  assertValidPeriod(startDate, endDate);
  return { startDate, endDate, propertyId: queryUuid(query, 'propertyId') };
}
