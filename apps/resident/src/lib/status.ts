/** One place that decides how every API status is worded and toned. Status is never conveyed by colour alone (text + icon). */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';
export interface StatusView {
  label: string;
  tone: Tone;
}

const INVOICE: Record<string, StatusView> = {
  PAID: { label: 'Paid', tone: 'success' },
  ISSUED: { label: 'Due', tone: 'accent' },
  PARTIALLY_PAID: { label: 'Partly paid', tone: 'warning' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
};
const RENT: Record<string, StatusView> = {
  PAID_UP: { label: 'Paid up', tone: 'success' },
  DUE: { label: 'Due', tone: 'accent' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
  NO_INVOICES: { label: 'No invoices yet', tone: 'neutral' },
};
const STAY: Record<string, StatusView> = {
  CURRENT: { label: 'Current stay', tone: 'success' },
  UPCOMING: { label: 'Upcoming', tone: 'accent' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
  NONE: { label: 'No stay', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warning' },
};
const PAYMENT: Record<string, StatusView> = {
  COMPLETED: { label: 'Completed', tone: 'success' },
  REVERSED: { label: 'Reversed', tone: 'neutral' },
};
const ACCOUNT: Record<string, StatusView> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'warning' },
  REVOKED: { label: 'Revoked', tone: 'danger' },
};
const RESIDENT: Record<string, StatusView> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};
const UPCOMING_STAGE: Record<string, string> = {
  BOOKED: 'Booked',
  ADMISSION_PENDING: 'Admission in progress',
  ADMITTED_AWAITING_CHECK_IN: 'Ready for check-in',
  START_DATE_PASSED: 'Start date passed, awaiting check-in',
};

/** An unknown value is shown neutrally as its own words, never hidden and never mistaken for a known state. */
const fallback = (value: string): StatusView => ({
  label: value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' '),
  tone: 'neutral',
});
const pick = (table: Record<string, StatusView>, value: string): StatusView =>
  table[value] ?? fallback(value);

export const invoiceStatus = (v: string) => pick(INVOICE, v);
export const rentStatus = (v: string) => pick(RENT, v);
export const stayStatus = (v: string) => pick(STAY, v);
export const paymentStatus = (v: string) => pick(PAYMENT, v);
export const accountStatus = (v: string) => pick(ACCOUNT, v);
export const residentStatus = (v: string) => pick(RESIDENT, v);
export const upcomingStageLabel = (v: string): string => UPCOMING_STAGE[v] ?? fallback(v).label;
