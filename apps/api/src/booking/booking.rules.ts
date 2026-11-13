import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/client.js';
import { istDateOf } from '../common/time.js';
import { periodContains } from './booking.input.js';

/** The Asia/Kolkata calendar day of an instant as `YYYY-MM-DD` (the business date Nook books and bills by). */
export function istDayKey(instant: Date): string {
  return istDateOf(instant).toISOString().slice(0, 10);
}

/** Anything that can run a raw query: the Prisma client or an interactive-transaction client. */
type RawClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

export interface OverlapQuery {
  organizationId: string;
  bedId: string;
  start: Date;
  end: Date;
  /** The booking being changed, so it never conflicts with itself. */
  excludeBookingId?: string;
}

const NO_BOOKING = '00000000-0000-0000-0000-000000000000';

/**
 * Finds a live (not cancelled) booking on the bed whose period overlaps [start, end).
 *
 * Periods are half-open and compared as Asia/Kolkata calendar days, the same convention billing and
 * admission dates use: `existing.start < requested.end AND existing.end > requested.start`. A date-only
 * input is stored as a UTC-midnight instant and a date-time as the instant it names; converting both
 * sides to their IST day makes the two forms compare consistently, so a booking that ends on a day and
 * one that starts on it are adjacent, never overlapping, whichever way each was entered.
 *
 * This is a plain read. It is only a guarantee when the caller already holds the bed row lock.
 */
export async function findOverlappingBooking(
  db: RawClient,
  query: OverlapQuery,
): Promise<string | null> {
  const startDay = istDayKey(query.start);
  const endDay = istDayKey(query.end);
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM bookings
    WHERE organization_id = ${query.organizationId}::uuid
      AND bed_id = ${query.bedId}::uuid
      AND status <> 'CANCELLED'
      AND id <> ${query.excludeBookingId ?? NO_BOOKING}::uuid
      AND (start_date AT TIME ZONE 'Asia/Kolkata')::date < ${endDay}::date
      AND (end_date AT TIME ZONE 'Asia/Kolkata')::date > ${startDay}::date
    UNION ALL
    SELECT b.id FROM bookings b
    JOIN effective_stay_assignments s ON s.booking_id = b.id AND s.organization_id = b.organization_id
    WHERE b.organization_id = ${query.organizationId}::uuid
      AND s.bed_id = ${query.bedId}::uuid
      AND b.status <> 'CANCELLED' AND s.status = 'ACTIVE' AND s.end_at IS NULL
      AND b.id <> ${query.excludeBookingId ?? NO_BOOKING}::uuid
      AND (s.start_at AT TIME ZONE 'Asia/Kolkata')::date < ${endDay}::date
      AND (b.end_date AT TIME ZONE 'Asia/Kolkata')::date > ${startDay}::date
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

export interface BookableBedFacts {
  archivedAt: Date | null;
  operationalStatus: string;
  room: {
    archivedAt: Date | null;
    floor?: { archivedAt: Date | null; property: { archivedAt: Date | null } };
  } | null;
}

/**
 * Whether a bed can take a new booking. Mirrors what check-in already refuses (archived, out of
 * service) and what the availability list already hides, so a booking is never confirmed on a bed
 * that could not be occupied. Throws a 409 for the first violated rule.
 *
 * Occupancy: a bed with an ACTIVE check-in is physically occupied now, so a period that includes
 * today (Asia/Kolkata) cannot be allocated. A period that starts later is decided by the date
 * overlap alone. What to do when the current occupant has outstayed their booking and a new booking
 * starts after today is an OWNER DECISION that is deliberately not encoded here.
 */
export function assertBedBookable(
  bed: BookableBedFacts,
  context: { hasActiveCheckIn: boolean; start: Date; end: Date; today: Date },
): void {
  if (
    bed.archivedAt ||
    bed.room?.archivedAt ||
    bed.room?.floor?.archivedAt ||
    bed.room?.floor?.property.archivedAt
  ) {
    throw new ConflictException('This bed is archived and cannot be booked');
  }
  if (bed.operationalStatus !== 'IN_SERVICE') {
    throw new ConflictException('This bed is out of service and cannot be booked');
  }
  if (context.hasActiveCheckIn && periodContains(context.start, context.end, context.today)) {
    throw new ConflictException('This bed is currently occupied and cannot be booked for today');
  }
}
