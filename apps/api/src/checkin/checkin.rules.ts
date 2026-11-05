import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * Pure business rules for check-in / check-out. They take plain facts (read under row locks by the
 * service) and either return or throw, so they can be unit-tested without a database.
 */

import { istDateOf } from '../common/time.js';

export { resolveInstant } from '../common/time.js';

/**
 * Whether a resident who is still checked in is past the approved booking period. The booking end is
 * exclusive, so on the end date itself (Asia/Kolkata) the stay is already beyond what was booked.
 * Overstay days are never billed unless an extension is approved.
 */
export function isOverstay(bookingEndDate: Date, now: Date = new Date()): boolean {
  return istDateOf(bookingEndDate).getTime() <= istDateOf(now).getTime();
}

export const MAX_REASON_LENGTH = 500;
export const MAX_NOTES_LENGTH = 2000;

/** Optional free text: trimmed, empty becomes null, over-long is a 400 rather than a database error. */
export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be text`);
  const text = value.trim();
  if (text === '') return null;
  if (text.length > max)
    throw new BadRequestException(`${field} must be at most ${max} characters`);
  return text;
}

export interface CheckInFacts {
  admission: { status: string };
  booking: { status: string };
  bed: {
    archivedAt: Date | null;
    operationalStatus: string;
    room: { archivedAt: Date | null } | null;
  };
  /** The check-in already attached to this admission, if any (an admission has at most one, ever). */
  existingForAdmission: { status: string } | null;
  /** Another ACTIVE check-in on the same bed (occupancy comes from active check-ins, not bed status). */
  activeOnBed: boolean;
  /** Another ACTIVE check-in for the same resident. */
  activeForResident: boolean;
}

/** Throws the first rule that is violated. Every failure is a 409 (state) so the UI can explain it. */
export function assertCanCheckIn(f: CheckInFacts): void {
  if (f.admission.status !== 'ADMITTED') {
    throw new ConflictException('Only an admitted admission can be checked in');
  }
  if (f.booking.status !== 'CONFIRMED') {
    throw new ConflictException('The booking for this admission is not confirmed');
  }
  if (f.bed.archivedAt || f.bed.room?.archivedAt) {
    throw new ConflictException('This bed is archived and cannot be checked into');
  }
  if (f.bed.operationalStatus !== 'IN_SERVICE') {
    throw new ConflictException('This bed is out of service and cannot be checked into');
  }
  if (f.existingForAdmission) {
    throw new ConflictException(
      f.existingForAdmission.status === 'ACTIVE'
        ? 'Admission already has an active check-in'
        : 'This admission has already been checked in and out; create a new booking and admission for a new stay',
    );
  }
  if (f.activeOnBed)
    throw new ConflictException('This bed is currently occupied by another check-in');
  if (f.activeForResident) {
    throw new ConflictException('This resident already has an active check-in');
  }
}

export function assertCanCheckOut(
  checkIn: { status: string; checkInAt: Date },
  checkOutAt: Date,
): void {
  if (checkIn.status !== 'ACTIVE')
    throw new ConflictException('This check-in has already been checked out');
  if (checkOutAt.getTime() < checkIn.checkInAt.getTime()) {
    throw new BadRequestException('Check-out time cannot be before the check-in time');
  }
}
