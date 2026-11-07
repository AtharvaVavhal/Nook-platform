import { opsApi } from '../ops/opsApi';
import { dateOnly } from '../ops/opsFormat';
import { opsLinks } from '../ops/opsRoute';
import { summariseOverstays } from './overstaySummary';
import { useAsync } from './shared';

/**
 * Residents still checked in past their booking end date. Those days are not billed unless the booking is
 * extended, so Finance sees the gap here. It reads GET /check-ins/occupancy (organisation-scoped by the
 * session) and loads independently: if the call fails the overview is unaffected, and no amount is estimated.
 */
export function OverstayBanner() {
  const { data, loading, error, reload } = useAsync(() => opsApi.checkIns.occupancy(), []);

  if (error) {
    return (
      <p className="fin-note" role="status">
        Couldn’t check for residents past their booking end date.{' '}
        <button type="button" className="fin-link-button" onClick={reload}>
          Try again
        </button>
      </p>
    );
  }
  if (loading && !data) return null;
  const summary = summariseOverstays(data);
  if (!summary) return null;

  return (
    <div className="fin-warning" role="alert" aria-label="Residents past their booking end date">
      <strong>{summary.headline}</strong> Those days are not billed unless the booking is extended
      with a reason. Open the check-in to extend it.
      <ul>
        {summary.shown.map((o) => (
          <li key={o.checkInId}>
            <a href={opsLinks.checkIn(o.checkInId)}>{o.residentName}</a> · booking ended{' '}
            {dateOnly(o.bookingEndDate)}
          </li>
        ))}
      </ul>
      {summary.hidden > 0 ? (
        <p>
          and {summary.hidden} more. <a href={opsLinks.checkIns}>See all check-ins</a>
        </p>
      ) : null}
    </div>
  );
}
