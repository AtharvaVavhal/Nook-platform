import { BadRequestException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BadRequestException(`${field} must be a valid UUID`);
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | null {
  return value === undefined || value === null || value === '' ? null : requireUuid(value, field);
}

/**
 * Related identifiers come from the authoritative parent record. A client may still send them, but
 * only if they agree with that record, so an inconsistent combination is rejected, never stored.
 */
export function assertMatchesParent(
  provided: unknown,
  actual: string,
  field: string,
  parent: string,
): void {
  if (provided === undefined || provided === null || provided === '') return;
  if (provided !== actual) {
    throw new BadRequestException(`${field} does not match the ${parent}`);
  }
}

/** Query-string paging arrives as text; coerce and bound it so a bad value is a 400, not a Prisma 500. */
export function parsePagination(page: unknown, limit: unknown): { page: number; limit: number } {
  const toInt = (value: unknown, fallback: number, max: number, field: string): number => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new BadRequestException(`${field} must be an integer between 1 and ${max}`);
    }
    return n;
  };
  return { page: toInt(page, 1, 100_000, 'page'), limit: toInt(limit, 20, 100, 'limit') };
}
