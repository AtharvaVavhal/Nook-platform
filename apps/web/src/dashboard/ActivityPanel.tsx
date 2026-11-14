import { formatMoney } from '../finance/financeFormat';
import { Tag } from '../ops/ui';
import type { ActivityItem, Dashboard } from './dashboardApi';
import { activityText, recentWindowText } from './dashboardRules';
import { NoAccess, Panel } from './Panel';

/** Recorded events only. Inventory changes, and who made any change, are not recorded and so are not shown. */
export function ActivityPanel({
  activity,
  windows,
}: {
  activity: ActivityItem[] | null;
  windows: Dashboard['windows'];
}) {
  return (
    <Panel
      id="dash-activity"
      title="Recent activity"
      note={`Bookings, admission records, check-ins, check-outs and payments recorded ${recentWindowText(windows)}. Changes to rooms and beds, and who made a change, are not recorded, so they are not shown.`}
      wide
    >
      {activity === null ? (
        <NoAccess />
      ) : activity.length === 0 ? (
        <p className="fin-hint dash-empty">Nothing was recorded in this period.</p>
      ) : (
        <ol className="dash-activity">
          {activity.map((item) => {
            const text = activityText(item);
            return (
              <li key={`${item.kind}:${item.refId}`}>
                <div>
                  <strong>{text.title}</strong> · {item.residentName}
                  {item.bedLabel && item.roomLabel
                    ? ` · Room ${item.roomLabel}, Bed ${item.bedLabel}`
                    : ''}
                  {item.amount ? ` · ${formatMoney(item.amount)}` : ''}{' '}
                  {item.reversed ? <Tag>Reversed</Tag> : null}
                </div>
                <small>
                  {text.timeLabel}: {text.time}
                </small>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
