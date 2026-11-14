import { BadRequestException } from '@nestjs/common';
import type { Permission } from '../auth/permissions.js';
import { istDateOf, istStartOfDay, todayIst } from '../common/time.js';
import { parseBillingMonth, shiftMonth } from '../finance/finance.util.js';
import type { ActivityItem, DashboardAccessView, FloorInventory } from './dashboard.types.js';

/**
 * Pure rules of the owner dashboard (frozen plan, sections 5 and 6). No database, no clock: every function takes the
 * instant it needs, so every boundary is unit-tested.
 */

export const DASHBOARD_DEFAULT_DAYS = 14;
export const DASHBOARD_MIN_DAYS = 1;
export const DASHBOARD_MAX_DAYS = 31;
/** Every list on the dashboard is capped here; counts stay exact. */
export const DASHBOARD_LIST_CAP = 10;
/** The selectable months: the current IST month and this many before it. */
export const DASHBOARD_MONTHS_BACK = 5;

const MS_PER_DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const INTEGER = /^-?\d+$/;

export interface FieldProblem {
  field: string;
  code: string;
}

export interface DashboardParams {
  /** `YYYY-MM`, one of `allowedMonths(now)`. */
  month: string;
  days: number;
}

/** A UTC-midnight date shifted by whole days. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** `YYYY-MM-DD` of a UTC-midnight date value. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Asia/Kolkata calendar date (`YYYY-MM-DD`) of an instant. */
export function istDateKey(instant: Date): string {
  return dateKey(istDateOf(instant));
}

/** The months a caller may select, oldest first: the five before the current IST month, then the current one. */
export function allowedMonths(now: Date): string[] {
  const current = parseBillingMonth(todayIst(now).toISOString().slice(0, 7));
  const months: string[] = [];
  for (let back = DASHBOARD_MONTHS_BACK; back >= 0; back--) {
    months.push(shiftMonth(current, -back).month);
  }
  return months;
}

/**
 * Validates the path id and the query together and reports every problem at once (`400 INVALID_INPUT`,
 * `details: [{ field, code }]`). Unknown parameters, including any organization field, are refused.
 */
export function validateDashboardRequest(
  propertyId: string,
  query: Record<string, unknown>,
  now: Date,
): { propertyId: string; params: DashboardParams } {
  const problems: FieldProblem[] = [];
  if (!UUID.test(propertyId)) problems.push({ field: 'propertyId', code: 'INVALID_UUID' });

  for (const key of Object.keys(query)) {
    if (key !== 'month' && key !== 'days') problems.push({ field: key, code: 'UNKNOWN_FIELD' });
  }

  const months = allowedMonths(now);
  let month = months[months.length - 1]!;
  if (query.month !== undefined) {
    const raw = query.month;
    if (typeof raw !== 'string' || !MONTH.test(raw)) {
      problems.push({ field: 'month', code: 'INVALID_FORMAT' });
    } else if (!months.includes(raw)) {
      problems.push({ field: 'month', code: 'OUT_OF_RANGE' });
    } else {
      month = raw;
    }
  }

  let days = DASHBOARD_DEFAULT_DAYS;
  if (query.days !== undefined) {
    const raw = query.days;
    if (typeof raw !== 'string' || !INTEGER.test(raw)) {
      problems.push({ field: 'days', code: 'INVALID_INTEGER' });
    } else {
      const parsed = Number(raw);
      if (
        !Number.isSafeInteger(parsed) ||
        parsed < DASHBOARD_MIN_DAYS ||
        parsed > DASHBOARD_MAX_DAYS
      ) {
        problems.push({ field: 'days', code: 'OUT_OF_RANGE' });
      } else {
        days = parsed;
      }
    }
  }

  if (problems.length) {
    throw new BadRequestException({ code: 'INVALID_INPUT', details: problems });
  }
  return { propertyId, params: { month, days } };
}

export interface DashboardWindows {
  /** Today as an IST calendar date (UTC-midnight value). */
  today: Date;
  days: number;
  /** Upcoming window U = [today, today + days), as dates. */
  upcomingFrom: Date;
  upcomingToExclusive: Date;
  /** Recent window R = (today - days, today], as dates, both inclusive. */
  recentFrom: Date;
  recentTo: Date;
  /** The same windows as instant ranges `[start, end)` at Asia/Kolkata midnights. */
  upcomingStart: Date;
  upcomingEnd: Date;
  recentStart: Date;
  recentEnd: Date;
}

export function dashboardWindows(now: Date, days: number): DashboardWindows {
  const today = todayIst(now);
  const upcomingToExclusive = addDays(today, days);
  const recentFrom = addDays(today, -(days - 1));
  return {
    today,
    days,
    upcomingFrom: today,
    upcomingToExclusive,
    recentFrom,
    recentTo: today,
    upcomingStart: istStartOfDay(today),
    upcomingEnd: istStartOfDay(upcomingToExclusive),
    recentStart: istStartOfDay(recentFrom),
    recentEnd: istStartOfDay(addDays(today, 1)),
  };
}

export type StayEndClass = 'PAST_END' | 'UPCOMING' | 'LATER';

/**
 * Dashboard-only classification of an active stay by its booking end date (owner decision D7, option b):
 * strictly before today is "past end date"; today up to but excluding today + days is an upcoming check-out; a booking
 * ending today is therefore NOT past end date. This is deliberately different from `isOverstay` (end <= today), which is
 * unchanged and keeps driving /check-ins/occupancy and the Finance overstay banner.
 */
export function classifyStayEnd(endDate: Date, windows: DashboardWindows): StayEndClass {
  const end = istDateOf(endDate).getTime();
  if (end < windows.today.getTime()) return 'PAST_END';
  if (end < windows.upcomingToExclusive.getTime()) return 'UPCOMING';
  return 'LATER';
}

/** Whole IST days between a past end date and today (at least 1 for a past-end-date stay). */
export function daysPastEnd(endDate: Date, today: Date): number {
  return Math.round((today.getTime() - istDateOf(endDate).getTime()) / MS_PER_DAY);
}

/** occupied / beds as a percentage, one decimal, half up, using integer arithmetic; 0 for an empty property. */
export function occupancyPercent(occupied: number, beds: number): number {
  if (beds <= 0) return 0;
  return Math.floor((occupied * 2000 + beds) / (2 * beds)) / 10;
}

export interface BedFact {
  id: string;
  floorId: string;
  outOfService: boolean;
}

export interface FloorFact {
  id: string;
  label: string;
  ordinal: number;
}

export interface InventorySummary {
  beds: number;
  occupiedBeds: number;
  availableBeds: number;
  outOfServiceBeds: number;
  occupancyPercent: number;
  byFloor: FloorInventory[];
  occupiedOutOfService: number;
}

/**
 * Splits live beds into occupied, out of service (and not occupied) and available. The three are mutually exclusive and
 * always add up to the number of live beds. An occupied bed that is out of service stays occupied and is reported as an
 * anomaly instead of being hidden.
 */
export function summarizeInventory(
  floors: readonly FloorFact[],
  beds: readonly BedFact[],
  occupiedBedIds: ReadonlySet<string>,
): InventorySummary {
  const perFloor = new Map<string, FloorInventory>(
    floors.map((floor) => [
      floor.id,
      {
        floorId: floor.id,
        label: floor.label,
        ordinal: floor.ordinal,
        beds: 0,
        occupiedBeds: 0,
        availableBeds: 0,
        outOfServiceBeds: 0,
      },
    ]),
  );
  let occupied = 0;
  let outOfService = 0;
  let available = 0;
  let occupiedOutOfService = 0;
  for (const bed of beds) {
    const floor = perFloor.get(bed.floorId);
    const isOccupied = occupiedBedIds.has(bed.id);
    if (floor) floor.beds += 1;
    if (isOccupied) {
      occupied += 1;
      if (floor) floor.occupiedBeds += 1;
      if (bed.outOfService) occupiedOutOfService += 1;
    } else if (bed.outOfService) {
      outOfService += 1;
      if (floor) floor.outOfServiceBeds += 1;
    } else {
      available += 1;
      if (floor) floor.availableBeds += 1;
    }
  }
  return {
    beds: beds.length,
    occupiedBeds: occupied,
    availableBeds: available,
    outOfServiceBeds: outOfService,
    occupancyPercent: occupancyPercent(occupied, beds.length),
    byFloor: [...perFloor.values()].sort(
      (a, b) => a.ordinal - b.ordinal || a.floorId.localeCompare(b.floorId),
    ),
    occupiedOutOfService,
  };
}

export interface DashboardGates {
  access: DashboardAccessView;
  /** Per-source permissions behind the activity feed and the admission state of upcoming arrivals. */
  sources: { booking: boolean; admission: boolean; checkin: boolean; finance: boolean };
}

/**
 * Section gating over the EXISTING permission constants (plan 5.3). `has` is the caller's permission test, so the same
 * function is exercised with fake roles in unit tests. Today both roles hold every permission.
 */
export function computeGates(has: (permission: Permission) => boolean): DashboardGates {
  const tenants = has('checkin.read') && has('resident.read');
  const sources = {
    booking: has('booking.read'),
    admission: has('admission.read'),
    checkin: has('checkin.read'),
    finance: has('finance.read'),
  };
  return {
    access: {
      tenants,
      upcomingCheckIns: tenants && has('booking.read'),
      recentAdmissions: tenants && has('admission.read'),
      bookings: has('booking.read'),
      finance: has('finance.read'),
      activity: sources.booking || sources.admission || sources.checkin || sources.finance,
    },
    sources,
  };
}

/** Newest first; ties broken by kind then id so the order is deterministic. At most `cap` entries. */
export function mergeActivity(
  items: readonly ActivityItem[],
  cap = DASHBOARD_LIST_CAP,
): ActivityItem[] {
  return [...items]
    .sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) ||
        a.kind.localeCompare(b.kind) ||
        a.refId.localeCompare(b.refId),
    )
    .slice(0, cap);
}

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}
