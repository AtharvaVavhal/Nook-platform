import { planAssignmentReplacement } from '../common/assignment-reconciliation.js';
import { Prisma } from '../generated/client.js';
import { findOverlappingBooking } from '../booking/booking.rules.js';
import { periodContains } from '../booking/booking.input.js';
import {
  CorrectionError,
  dayOrdinal,
  istDayKeyOf,
  type FieldKey,
  type ValueEnvelope,
} from './corrections.rules.js';
import { dayOfInstantText, textToDate, type Chain, type Tx } from './corrections.facts.js';

/**
 * Invariant validators and column-only application for the nine allowlisted fields (specification 4 and 9.1).
 *
 * - A violation is a `LIFECYCLE_CONFLICT`: it throws, the transaction rolls back and the proposal stays PENDING. It is
 *   never converted into STALE or REJECTED.
 * - Application writes ONLY the target column (plus `updated_at` metadata) with a raw statement. A row re-read earlier is
 *   never written back, so concurrent edits of other columns survive. Sub-millisecond instants are written as text.
 * - Validators read only the facts in the locked chain and the other bookings/stays of the bed and resident. They do not
 *   read bed, room, floor or property state (specification 10.5); if that ever changes, the inventory writers must join
 *   the gate before correction application is enabled.
 */

function conflict(message: string): never {
  throw new CorrectionError(409, 'LIFECYCLE_CONFLICT', message);
}

const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** Half-open physical interval collision with every other stay of the same bed or resident. */
async function assertNoStayCollision(
  tx: Tx,
  organizationId: string,
  chain: Chain,
  checkInId: string,
  checkInAt: string,
  checkOutAt: string | null,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT s.id FROM effective_stay_assignments s
    WHERE s.organization_id = ${organizationId}::uuid AND s.booking_id <> ${chain.bookingId}::uuid
      AND (s.bed_id = ${chain.bedId}::uuid OR s.resident_id = ${chain.residentId}::uuid)
      AND s.start_at < COALESCE(${checkOutAt}::timestamptz, 'infinity'::timestamptz)
      AND COALESCE(s.end_at, 'infinity'::timestamptz) > ${checkInAt}::timestamptz
    UNION ALL
    SELECT c.id
    FROM check_ins c
    LEFT JOIN check_outs o ON o.check_in_id = c.id AND o.organization_id = c.organization_id
    WHERE c.organization_id = ${organizationId}::uuid AND c.id <> ${checkInId}::uuid
      AND (c.bed_id = ${chain.bedId}::uuid OR c.resident_id = ${chain.residentId}::uuid)
      AND NOT EXISTS (SELECT 1 FROM stay_assignments s WHERE s.organization_id = c.organization_id AND s.booking_id = c.booking_id)
      AND c.check_in_at < COALESCE(${checkOutAt}::timestamptz, 'infinity'::timestamptz)
      AND COALESCE(o.check_out_at, 'infinity'::timestamptz) > ${checkInAt}::timestamptz
    LIMIT 1`);
  if (rows.length > 0)
    conflict('The corrected stay would overlap another recorded stay for this bed or resident');
}

export interface ApplyInput {
  tx: Tx;
  organizationId: string;
  targetId: string;
  fieldKey: FieldKey;
  proposed: ValueEnvelope;
  /** Decision instant, sampled after the locks and revalidation. */
  now: Date;
  chain: Chain | null;
}

/** Validates the invariants for the corrected value under the locks; throws LIFECYCLE_CONFLICT on violation. */
export async function validateCorrection(input: ApplyInput): Promise<void> {
  const { tx, organizationId, fieldKey, proposed, now, chain } = input;
  const value = proposed.value;
  if (fieldKey === 'firstName' || fieldKey === 'lastName' || fieldKey === 'reason') return;
  const c = chain!;
  const replacementPlan =
    fieldKey === 'checkInAt' || fieldKey === 'checkOutAt'
      ? await planAssignmentReplacement(tx, organizationId, c.bookingId, fieldKey, value!)
      : null;

  if (c.bookingStatus === 'CANCELLED' && fieldKey !== 'checkOutAt') {
    conflict('A cancelled booking cannot be corrected');
  }
  const startDay = dayOfInstantText(c.startDate);
  const endDay = dayOfInstantText(c.endDate);
  const liveAdmission = c.admissionId && c.admissionStatus !== 'CANCELLED';
  const checkInDay = c.checkInAt ? dayOfInstantText(c.checkInAt) : null;

  switch (fieldKey) {
    case 'startDate': {
      if (dayOrdinal(value!) >= dayOrdinal(endDay))
        conflict('The booking start must be before its end');
      const overlap = await findOverlappingBooking(tx, {
        organizationId,
        bedId: c.bedId,
        start: dayToDate(value!),
        end: dayToDate(endDay),
        excludeBookingId: c.bookingId,
      });
      if (overlap) conflict('Bed already booked for the corrected period');
      if (
        liveAdmission &&
        !periodContains(dayToDate(value!), dayToDate(endDay), textToDate(c.admissionDate!))
      ) {
        conflict('The corrected period would leave the admission date outside the booking');
      }
      if (checkInDay && dayOrdinal(value!) > dayOrdinal(checkInDay)) {
        conflict('The booking must still cover the day the resident checked in');
      }
      return;
    }
    case 'endDate': {
      if (dayOrdinal(value!) > dayOrdinal(endDay)) {
        conflict('A booking cannot be lengthened by correction; use the extension command');
      }
      if (dayOrdinal(value!) <= dayOrdinal(startDay))
        conflict('The booking end must be after its start');
      if (
        liveAdmission &&
        !periodContains(dayToDate(startDay), dayToDate(value!), textToDate(c.admissionDate!))
      ) {
        conflict('The corrected period would leave the admission date outside the booking');
      }
      if (checkInDay && dayOrdinal(value!) <= dayOrdinal(checkInDay)) {
        conflict('The booking must still cover the day the resident checked in');
      }
      return;
    }
    case 'monthlyPrice':
      return;
    case 'admissionDate': {
      if (!c.admissionId || c.admissionStatus === 'CANCELLED')
        conflict('The admission is not correctable');
      if (!periodContains(textToDate(c.startDate), textToDate(c.endDate), dayToDate(value!))) {
        conflict('The admission date must fall inside the booking period');
      }
      if (checkInDay && dayOrdinal(value!) > dayOrdinal(checkInDay)) {
        conflict('The admission cannot be dated after the recorded check-in');
      }
      return;
    }
    case 'checkInAt': {
      if (!c.checkInId) conflict('There is no check-in to correct');
      if (textToDate(value!).getTime() > now.getTime())
        conflict('A check-in cannot be in the future');
      if (
        c.admissionDate &&
        dayOrdinal(dayOfInstantText(c.admissionDate)) > dayOrdinal(istDayKeyOf(textToDate(value!)))
      ) {
        conflict('A check-in cannot precede the admission date');
      }
      if (c.checkOutAt && textToDate(value!).getTime() > textToDate(c.checkOutAt).getTime()) {
        conflict('A check-in cannot be after its check-out');
      }
      if (!replacementPlan)
        await assertNoStayCollision(tx, organizationId, c, c.checkInId!, value!, c.checkOutAt);
      return;
    }
    case 'checkOutAt': {
      if (!c.checkOutId || !c.checkInAt) conflict('There is no completed stay to correct');
      if (textToDate(value!).getTime() > now.getTime())
        conflict('A check-out cannot be in the future');
      if (textToDate(value!).getTime() < textToDate(c.checkInAt!).getTime()) {
        conflict('A check-out cannot be before the check-in');
      }
      if (!replacementPlan)
        await assertNoStayCollision(tx, organizationId, c, c.checkInId!, c.checkInAt!, value!);
      return;
    }
  }
}

/** Writes exactly the target column. Returns the domain audit action to record. */
export async function applyColumn(input: ApplyInput): Promise<string> {
  const { tx, organizationId, targetId, fieldKey, proposed } = input;
  const org = organizationId;
  const v = proposed.value;
  const n = async (p: Prisma.Sql) => {
    const count = await tx.$executeRaw(p);
    if (count !== 1)
      throw new CorrectionError(
        409,
        'RETRY_REQUIRED',
        'The record changed during application. Retry with the same Idempotency-Key.',
      );
  };
  switch (fieldKey) {
    case 'firstName':
      await n(
        Prisma.sql`UPDATE residents SET first_name = ${v}, updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'resident.corrected';
    case 'lastName':
      await n(
        Prisma.sql`UPDATE residents SET last_name = ${v}, updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'resident.corrected';
    case 'startDate':
      await n(
        Prisma.sql`UPDATE bookings SET start_date = (${v}::date)::timestamp AT TIME ZONE 'UTC', updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'booking.corrected';
    case 'endDate':
      await n(
        Prisma.sql`UPDATE bookings SET end_date = (${v}::date)::timestamp AT TIME ZONE 'UTC', updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'booking.corrected';
    case 'monthlyPrice':
      await n(
        Prisma.sql`UPDATE bookings SET monthly_price = ${v}::numeric, updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'booking.corrected';
    case 'admissionDate':
      await n(
        Prisma.sql`UPDATE admissions SET admission_date = (${v}::date)::timestamp AT TIME ZONE 'UTC', updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'admission.corrected';
    case 'checkInAt':
      await n(
        Prisma.sql`UPDATE check_ins SET check_in_at = ${v}::timestamptz, updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'checkin.corrected';
    case 'checkOutAt':
      await n(
        Prisma.sql`UPDATE check_outs SET check_out_at = ${v}::timestamptz, updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'checkout.corrected';
    case 'reason':
      await n(
        Prisma.sql`UPDATE check_outs SET reason = ${v}, updated_at = clock_timestamp() WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
      );
      return 'checkout.corrected';
  }
}
