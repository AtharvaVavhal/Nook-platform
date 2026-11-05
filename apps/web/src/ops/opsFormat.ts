export const personName = (p?: { firstName: string; lastName: string } | null) =>
  p ? `${p.firstName} ${p.lastName}` : '—';
export const bedLabel = (b?: { label: string; room?: { label: string } | null } | null) =>
  b ? `${b.room ? `Room ${b.room.label} · ` : ''}Bed ${b.label}` : '—';
export const dateOnly = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';
export const dateTime = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
export const label = (s: string) =>
  s
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
/** `datetime-local` value for "now", in the browser's time zone. */
export const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export const localToIso = (v: string) => new Date(v).toISOString();
export const todayDate = () => nowLocal().slice(0, 10);
export const isMoney = (v: string) => /^\d{1,10}(\.\d{1,2})?$/.test(v.trim());

/** The largest monthly rent the database column (DECIMAL(10,2)) and the API accept. */
export const MAX_MONTHLY_PRICE_LABEL = '99,999,999.99';
/**
 * A monthly rent: greater than zero, at most two decimals, at most 99,999,999.99 (eight integer digits).
 * Mirrors the API rule in booking.input.ts so the form refuses exactly what the server would.
 */
export const isMonthlyPrice = (v: string) => {
  const text = v.trim();
  return /^\d{1,8}(\.\d{1,2})?$/.test(text) && Number(text) > 0;
};

const IST = 'Asia/Kolkata';
/** A date-time shown in Asia/Kolkata, whatever the browser's own time zone is. */
export const dateTimeIst = (v: string | null | undefined) =>
  v
    ? `${new Date(v).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: IST,
      })} IST`
    : '—';
/** `datetime-local` value for "now" in Asia/Kolkata. Sent without a zone; the server reads it as IST. */
export const nowIst = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: IST,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

/** The Asia/Kolkata calendar date (YYYY-MM-DD) of an instant, whatever the browser's time zone is. */
export const istDateString = (v: string | Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof v === 'string' ? new Date(v) : v);
/**
 * A checked-in resident is past their booking when today (India) is on or after the booking end date.
 * The end date is exclusive, so that day is already outside the booked period.
 */
export const isPastBookingEnd = (bookingEnd: string, now: Date = new Date()) =>
  istDateString(bookingEnd) <= istDateString(now);

/**
 * The admission date to offer for a booking: today when today falls inside the booked period (the end is
 * exclusive), otherwise the first booked day. The API refuses an admission date outside the period.
 */
export function suggestedAdmissionDate(
  booking: { startDate: string; endDate: string },
  today: string,
): string {
  const start = istDateString(booking.startDate);
  const end = istDateString(booking.endDate);
  return today >= start && today < end ? today : start;
}
