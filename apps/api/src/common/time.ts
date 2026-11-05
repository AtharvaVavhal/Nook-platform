import { BadRequestException } from '@nestjs/common';

/**
 * Asia/Kolkata calendar and instant helpers. India observes no daylight saving time, so IST is a
 * fixed +05:30 offset. Nothing here reads the process time zone: results are identical under
 * TZ=UTC, TZ=Asia/Kolkata or any other host setting.
 */
export const IST_OFFSET_MINUTES = 330;
export const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;
const IST_OFFSET = '+05:30';
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

/** The Asia/Kolkata calendar date of an instant, as a UTC-midnight date-only value. */
export function istDateOf(instant: Date): Date {
  const ist = new Date(instant.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Today's Asia/Kolkata calendar date, as a UTC-midnight date-only value. */
export function todayIst(now: Date = new Date()): Date {
  return istDateOf(now);
}

/** The instant a date-only value begins in Asia/Kolkata (used to compare against timestamps). */
export function istStartOfDay(dateOnly: Date): Date {
  return new Date(dateOnly.getTime() - IST_OFFSET_MS);
}

/**
 * Parses a client timestamp into an instant. A value with an explicit zone (`Z`, `+05:30`) is taken
 * as given. A zone-less value (what a `datetime-local` input produces) or a bare date is read as
 * Asia/Kolkata wall-clock time, never as the server's own time zone. With no value the default is "now".
 */
export function resolveInstant(raw: unknown, field: string, now: Date = new Date()): Date {
  if (raw === undefined || raw === null || raw === '') return now;
  if (typeof raw !== 'string') throw new BadRequestException(`${field} must be a date-time string`);
  const text = raw.trim();
  let iso: string;
  if (HAS_ZONE.test(text) && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) iso = text;
  else if (LOCAL_DATE_TIME.test(text)) iso = `${text.replace(' ', 'T')}${IST_OFFSET}`;
  else if (DATE_ONLY.test(text)) iso = `${text}T00:00:00${IST_OFFSET}`;
  else throw new BadRequestException(`${field} must be a valid date-time`);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException(`${field} must be a valid date-time`);
  return date;
}
