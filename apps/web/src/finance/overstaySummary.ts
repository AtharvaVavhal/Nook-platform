import type { Occupancy, Overstay } from '../ops/opsApi';

/** How many residents the Finance overview names before pointing at the full list. */
export const OVERSTAY_PREVIEW = 3;

export interface OverstaySummary {
  /** Exact count as reported by the server; never derived from the (capped) list. */
  count: number;
  shown: Overstay[];
  /** Residents beyond the ones named, so the banner can say "and N more". */
  hidden: number;
  headline: string;
}

/**
 * Presents the server's overstay answer. The overstay rule itself (booking end date versus today, in
 * Asia/Kolkata) lives only in the API; this only counts, truncates and words what the API returned.
 */
export function summariseOverstays(
  occupancy: Pick<Occupancy, 'overstayCount' | 'overstays'> | null | undefined,
  preview: number = OVERSTAY_PREVIEW,
): OverstaySummary | null {
  const count = occupancy?.overstayCount ?? 0;
  if (!occupancy || count <= 0) return null;
  const shown = occupancy.overstays.slice(0, Math.max(0, preview));
  return {
    count,
    shown,
    hidden: Math.max(0, count - shown.length),
    headline: `${count} resident${count === 1 ? ' is' : 's are'} still checked in past the booking end date.`,
  };
}
