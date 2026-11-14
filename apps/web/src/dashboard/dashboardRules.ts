/**
 * Pure presentation rules of the owner dashboard: labels, counts, month choices, the occupancy bar and the wording of
 * activity entries. No React and no network, so each rule is unit-tested. The server computes every figure; nothing
 * here recomputes money or occupancy.
 */
import { monthLabel } from '../finance/financeFormat';
import type { ActivityItem, Dashboard, Inventory } from './dashboardApi';

/** The window the screen asks for. The API supports 1 to 31; the first version has no control for it. */
export const DASHBOARD_DAYS = 14;
/** The current month and this many months before it can be selected (the server enforces the same window). */
export const MONTHS_BACK = 5;

const IST = 'Asia/Kolkata';

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** `YYYY-MM` shifted by whole months. */
export function shiftMonthKey(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const shifted = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Newest first: the current month, then the five before it. */
export function monthOptions(current: string): Array<{ value: string; label: string }> {
  return Array.from({ length: MONTHS_BACK + 1 }, (_, back) => {
    const value = shiftMonthKey(current, -back);
    return { value, label: monthLabel(value) };
  });
}

/** "62 of 100 beds occupied": the count and its denominator, never a bare percentage. */
export function occupancySummary(inventory: Pick<Inventory, 'occupiedBeds' | 'beds'>): string {
  return `${inventory.occupiedBeds} of ${plural(inventory.beds, 'bed')} occupied`;
}

export function percentText(percent: number): string {
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

export interface OccupancySegment {
  key: 'occupied' | 'available' | 'outOfService';
  label: string;
  count: number;
  /** Share of all live beds, for the width of the bar segment. 0 when the property has no beds. */
  percent: number;
}

export function occupancySegments(inventory: Inventory): OccupancySegment[] {
  const share = (count: number) => (inventory.beds > 0 ? (count / inventory.beds) * 100 : 0);
  return [
    {
      key: 'occupied',
      label: 'Occupied',
      count: inventory.occupiedBeds,
      percent: share(inventory.occupiedBeds),
    },
    {
      key: 'available',
      label: 'Available',
      count: inventory.availableBeds,
      percent: share(inventory.availableBeds),
    },
    {
      key: 'outOfService',
      label: 'Out of service',
      count: inventory.outOfServiceBeds,
      percent: share(inventory.outOfServiceBeds),
    },
  ];
}

/** The text equivalent of the occupancy bar. */
export function occupancyBarDescription(inventory: Inventory): string {
  return `${inventory.occupiedBeds} occupied, ${inventory.availableBeds} available and ${inventory.outOfServiceBeds} out of service, of ${plural(inventory.beds, 'bed')}`;
}

/** A property with no live rooms and no live beds: the screen explains what to do instead of showing zeros. */
export function isEmptyProperty(inventory: Pick<Inventory, 'rooms' | 'beds'>): boolean {
  return inventory.rooms === 0 && inventory.beds === 0;
}

export function anomalyMessages(inventory: Inventory): string[] {
  const out: string[] = [];
  const { occupiedOutOfService, stayNeedsReview } = inventory.anomalies;
  if (occupiedOutOfService > 0) {
    out.push(
      `${plural(occupiedOutOfService, 'occupied bed is', 'occupied beds are')} marked out of service. They are counted as occupied.`,
    );
  }
  if (stayNeedsReview > 0) {
    out.push(
      `${plural(stayNeedsReview, 'active stay has', 'active stays have')} an inconsistent bed history and ${stayNeedsReview === 1 ? 'is' : 'are'} not counted as occupied. Review ${stayNeedsReview === 1 ? 'it' : 'them'} in Check-ins.`,
    );
  }
  return out;
}

/** "Showing 10 of 14" when a capped list hides some of the exact total, else null. */
export function showingLabel(count: number, shown: number): string | null {
  return count > shown ? `Showing ${shown} of ${count}` : null;
}

/** A `YYYY-MM-DD` date plus whole days, as `YYYY-MM-DD`. */
export function addDaysKey(date: string, days: number): string {
  const shifted = new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

const dayMonth = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** "14 Nov to 27 Nov": the inclusive last day of the half-open upcoming window. */
export function upcomingWindowText(windows: Dashboard['windows']): string {
  return `${dayMonth(windows.upcoming.from)} to ${dayMonth(addDaysKey(windows.upcoming.toExclusive, -1))}`;
}

/** "1 Nov to 14 Nov": the inclusive recent window. */
export function recentWindowText(windows: Dashboard['windows']): string {
  return `${dayMonth(windows.recent.from)} to ${dayMonth(windows.recent.to)}`;
}

/** An instant as Asia/Kolkata wall-clock time, whatever the browser's own zone is. */
export function formatInstantIst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST,
  });
}

export interface ActivityText {
  title: string;
  /** What the time is: "Recorded" for a record-creation time, otherwise the event it belongs to. */
  timeLabel: string;
  time: string;
}

/**
 * Words for an activity entry. A booking or admission entry carries the time the RECORD was created, never an event date:
 * it is worded "… record created" with the time captioned "Recorded". "Admitted" and "Admission date" are never used here;
 * they belong only to the separate Recent admissions list, where the value really is the admission date.
 */
export function activityText(item: ActivityItem): ActivityText {
  const time = formatInstantIst(item.occurredAt);
  switch (item.kind) {
    case 'booking_created':
      return { title: 'Booking record created', timeLabel: 'Recorded', time };
    case 'admission_recorded':
      return { title: 'Admission record created', timeLabel: 'Recorded', time };
    case 'check_in':
      return { title: 'Checked in', timeLabel: 'Check-in time', time };
    case 'check_out':
      return { title: 'Checked out', timeLabel: 'Check-out time', time };
    case 'payment_received':
      return { title: 'Payment received', timeLabel: 'Received', time };
  }
}

export const PAYMENT_METHOD_LABELS = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
} as const;

export const ADMISSION_STATUS_LABELS = {
  NONE: 'No admission yet',
  PENDING: 'Admission pending',
  ADMITTED: 'Admitted',
  CANCELLED: 'Admission cancelled',
} as const;

export const NO_ACCESS_MESSAGE = 'You do not have access to this section.';

/** "Floor 1 · Room 101 · Bed 2" */
export function placeText(place: {
  floorLabel: string;
  roomLabel: string;
  bedLabel: string;
}): string {
  return `${place.floorLabel} · Room ${place.roomLabel} · Bed ${place.bedLabel}`;
}

/** True when the unattributed block holds anything worth showing (the server already hides an all-zero block). */
export function hasUnattributed(finance: { unattributed: unknown } | null): boolean {
  return Boolean(finance?.unattributed);
}
