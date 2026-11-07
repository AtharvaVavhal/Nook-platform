import { BadRequestException } from '@nestjs/common';
import { optionalUuid, requireUuid } from './ids.js';
import { resolveInstant } from './time.js';

/**
 * Request-body and query parsing shared by the booking, admission and enquiry modules.
 *
 * Why this exists: the controllers receive `unknown` bodies and there is no global ValidationPipe, so nothing
 * else stands between a client and Prisma. Each parser returns a new object built only from the fields it
 * knows (unknown keys are dropped, so a body can never choose organizationId, id, timestamps or status
 * fields it has no business setting) and turns every bad value into a 400 with a message that names the field,
 * instead of a Prisma 500.
 */
export type Fields = Record<string, unknown>;

export const MAX_NOTES = 2000;
export const MAX_NAME = 100;
export const MAX_SHORT_TEXT = 100;
export const MAX_SEARCH = 100;

/** Earliest and latest calendar years accepted for any date a client sends (a sanity bound, not a business rule). */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export function requireObject(body: unknown, what = 'Request body'): Fields {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(`${what} must be a JSON object`);
  }
  return body as Fields;
}

/** An absent body (or `null`) is an empty object; anything else must be an object. */
export function optionalObject(body: unknown, what = 'Request body'): Fields {
  return body === undefined || body === null ? {} : requireObject(body, what);
}

export function has(obj: Fields, key: string): boolean {
  return obj[key] !== undefined;
}

export function requiredText(obj: Fields, key: string, max: number, min = 1): string {
  const value = obj[key];
  if (typeof value !== 'string') throw new BadRequestException(`${key} is required`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new BadRequestException(
      `${key} is required (${min === 1 ? '1' : min} to ${max} characters)`,
    );
  }
  return text;
}

/** Absent -> undefined (leave unchanged); null or blank -> null (clear); otherwise trimmed text within `max`. */
export function optionalText(obj: Fields, key: string, max: number): string | null | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${key} must be text`);
  const text = value.trim();
  if (text === '') return null;
  if (text.length > max) {
    throw new BadRequestException(`${key} must be at most ${max} characters`);
  }
  return text;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function optionalInt(
  obj: Fields,
  key: string,
  min: number,
  max: number,
): number | null | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${key} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A client date. A date-only value (`2026-12-01`) must be a real calendar day and is stored as UTC midnight of
 * that day, which is how bookings have always been stored. A value with a time is read with its own zone, or as
 * Asia/Kolkata when it has none (never as the server's zone). Garbage, impossible days (`2027-02-30`) and years
 * outside 2000-2100 are a 400.
 */
export function parseDateInput(raw: unknown, field: string): Date {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException(`${field} must be a valid date`);
  }
  const text = raw.trim();
  let date: Date;
  if (DATE_ONLY.test(text)) {
    date = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
  } else {
    try {
      date = resolveInstant(text, field);
    } catch {
      throw new BadRequestException(`${field} must be a valid date`);
    }
  }
  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new BadRequestException(`${field} must be between the years ${MIN_YEAR} and ${MAX_YEAR}`);
  }
  return date;
}

export function requiredDate(obj: Fields, key: string): Date {
  return parseDateInput(obj[key], key);
}

/** Absent -> undefined; null or blank -> null; otherwise a validated date. */
export function optionalDate(obj: Fields, key: string): Date | null | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return parseDateInput(value, key);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function optionalEmail(obj: Fields, key: string): string | null | undefined {
  const text = optionalText(obj, key, 254);
  if (text === undefined || text === null) return text;
  if (!EMAIL.test(text)) throw new BadRequestException(`${key} must be a valid e-mail address`);
  return text;
}

const PHONE = /^[0-9+()\-.\s]{5,20}$/;

export function requiredPhone(obj: Fields, key: string): string {
  const text = requiredText(obj, key, 20, 5);
  if (!PHONE.test(text) || !/\d{4,}/.test(text.replace(/[^0-9]/g, ''))) {
    throw new BadRequestException(`${key} must be a phone number (digits, spaces, + ( ) - .)`);
  }
  return text;
}

export function optionalUuidField(obj: Fields, key: string): string | null | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  return optionalUuid(value, key);
}

export { requireUuid };

// ------------------------------------------------------------------------- query strings

/** A query-string value must arrive as a single string; `?a=1&a=2` (an array) or `?a[x]=1` (an object) is a 400. */
function queryString(query: Fields, key: string): string | undefined {
  const value = query[key];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${key} must be a single value`);
  return value;
}

export function queryText(query: Fields, key: string, max = MAX_SEARCH): string | undefined {
  const value = queryString(query, key)?.trim();
  if (!value) return undefined;
  if (value.length > max) throw new BadRequestException(`${key} must be at most ${max} characters`);
  return value;
}

export function queryEnum<T extends string>(
  query: Fields,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = queryString(query, key);
  return value === undefined ? undefined : oneOf(value, allowed, key);
}

export function queryUuid(query: Fields, key: string): string | undefined {
  const value = queryString(query, key);
  return value === undefined ? undefined : requireUuid(value, key);
}

export function queryDate(query: Fields, key: string): Date | undefined {
  const value = queryString(query, key);
  return value === undefined ? undefined : parseDateInput(value, key);
}

export function queryInt(
  query: Fields,
  key: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = queryString(query, key);
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${key} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

/** The query object itself must be a plain object (Express always gives one, but be explicit about it). */
export function asQuery(query: unknown): Fields {
  return optionalObject(query, 'Query string');
}
