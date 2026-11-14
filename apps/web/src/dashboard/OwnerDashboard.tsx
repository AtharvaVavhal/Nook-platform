import { useCallback, useEffect, useRef, useState } from 'react';
import { currentMonth } from '../finance/financeFormat';
import { EmptyState, ErrorState, useAsync } from '../finance/shared';
import { opsApi, OpsApiError, type Property } from '../ops/opsApi';
import { opsLinks } from '../ops/opsRoute';
import { PageHead } from '../ops/ui';
import './dashboard.css';
import { ActivityPanel } from './ActivityPanel';
import { BookingsPanel } from './BookingsPanel';
import { FinancePanel } from './FinancePanel';
import { MovementsPanel } from './MovementsPanel';
import { OccupancyPanel } from './OccupancyPanel';
import { PaymentsPanel } from './PaymentsPanel';
import { dashboardApi, type Dashboard } from './dashboardApi';
import { DASHBOARD_DAYS, formatInstantIst, monthOptions } from './dashboardRules';
import { overviewHref, parseOverviewHash } from './overviewRoute';

interface DashboardState {
  data: Dashboard | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  reload: () => void;
}

/** One request per property and month. A superseded response is dropped, so a slow answer never overwrites a newer one. */
function useDashboard(propertyId: string | null, month: string): DashboardState {
  const [state, setState] = useState<Omit<DashboardState, 'reload'>>({
    data: null,
    loading: false,
    error: null,
    notFound: false,
  });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (!propertyId) {
      setState({ data: null, loading: false, error: null, notFound: false });
      return;
    }
    const run = ++latest.current;
    setState({ data: null, loading: true, error: null, notFound: false });
    dashboardApi
      .get(propertyId, { month, days: DASHBOARD_DAYS })
      .then((data) => {
        if (run === latest.current)
          setState({ data, loading: false, error: null, notFound: false });
      })
      .catch((e: unknown) => {
        if (run !== latest.current) return;
        const notFound = e instanceof OpsApiError && e.status === 404;
        setState({
          data: null,
          loading: false,
          notFound,
          error: notFound ? null : e instanceof Error ? e.message : 'Something went wrong',
        });
      });
    return () => {
      latest.current++;
    };
  }, [propertyId, month, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

/** Static placeholders while the first response is on its way. No animation. */
function DashboardSkeleton() {
  return (
    <div className="dash-grid" aria-busy="true" aria-label="Loading the dashboard">
      {['Occupancy', 'Finance', 'Tenants', 'Bookings', 'Recent payments', 'Recent activity'].map(
        (name) => (
          <div key={name} className="fin-card dash-panel dash-skeleton">
            <span className="sr-only">Loading {name}</span>
            <i className="dash-skel-line dash-skel-title" />
            <i className="dash-skel-line" />
            <i className="dash-skel-line" />
            <i className="dash-skel-line dash-skel-short" />
          </div>
        ),
      )}
    </div>
  );
}

/**
 * The owner dashboard: real, property-scoped figures from one API request. The property is part of the hash
 * (`#overview/<propertyId>`) so it survives a reload and can be shared; it is also kept here, so following an in-page
 * anchor such as `#inventory` does not forget it.
 */
export function OwnerDashboard({ hash }: { hash: string }) {
  const route = parseOverviewHash(hash);
  const [selected, setSelected] = useState<string | null>(route.propertyId);
  const [month, setMonth] = useState(() => currentMonth());
  const properties = useAsync<Property[]>(() => opsApi.inventory.properties.list(), []);
  const list = properties.data ?? [];

  useEffect(() => {
    if (route.section === 'overview' && route.propertyId) setSelected(route.propertyId);
  }, [route.section, route.propertyId]);

  // With exactly one property there is nothing to choose: select it without adding a history entry.
  useEffect(() => {
    if (!properties.data || selected !== null || route.malformedPropertyId) return;
    if (properties.data.length === 1) {
      const only = properties.data[0]!.id;
      setSelected(only);
      window.history.replaceState(null, '', overviewHref(only));
    }
  }, [properties.data, selected, route.malformedPropertyId]);

  const known = selected !== null && list.some((property) => property.id === selected);
  const dashboard = useDashboard(known ? selected : null, month);
  const choose = (id: string) => {
    if (!id) return;
    setSelected(id);
    window.location.hash = overviewHref(id);
  };

  let body;
  if (properties.loading && !properties.data) {
    body = <DashboardSkeleton />;
  } else if (properties.error) {
    body = <ErrorState message={properties.error} onRetry={properties.reload} />;
  } else if (list.length === 0) {
    body = (
      <EmptyState
        title="No properties yet"
        hint="Add a property, then its floors, rooms and beds, to see occupancy and finance here."
        action={
          <a className="primary-button" href={opsLinks.propertyNew}>
            Add property
          </a>
        }
      />
    );
  } else if (route.malformedPropertyId && !known) {
    body = (
      <EmptyState
        title="That property link is not valid"
        hint="Choose a property from the list above."
      />
    );
  } else if (selected !== null && !known) {
    body = (
      <EmptyState
        title="Property not found"
        hint="It may have been archived, or it belongs to another organization. Choose a property from the list above."
      />
    );
  } else if (!known) {
    body = (
      <EmptyState title="Choose a property" hint="Pick a property above to see its dashboard." />
    );
  } else if (dashboard.notFound) {
    body = (
      <EmptyState
        title="Property not found"
        hint="It may have been archived. Choose a property from the list above."
      />
    );
  } else if (dashboard.error) {
    body = <ErrorState message={dashboard.error} onRetry={dashboard.reload} />;
  } else if (dashboard.loading || !dashboard.data) {
    body = <DashboardSkeleton />;
  } else {
    const d = dashboard.data;
    body = (
      <div className="dash-grid">
        <OccupancyPanel inventory={d.inventory} />
        <FinancePanel finance={d.finance} month={d.month} />
        <BookingsPanel bookings={d.bookings} windows={d.windows} />
        <MovementsPanel tenants={d.tenants} windows={d.windows} />
        <PaymentsPanel finance={d.finance} windows={d.windows} />
        <ActivityPanel activity={d.activity} windows={d.windows} />
      </div>
    );
  }

  return (
    <section id="overview" className="dash" aria-labelledby="dash-title">
      <PageHead
        as="h1"
        id="dash-title"
        title="Dashboard"
        action={
          known && dashboard.data ? (
            <span className="dash-asof">Updated {formatInstantIst(dashboard.data.asOf)} IST</span>
          ) : undefined
        }
      />
      <div className="dash-controls">
        <label className="fin-field">
          <span>Property</span>
          <select value={known ? selected! : ''} onChange={(e) => choose(e.target.value)}>
            <option value="">Choose a property</option>
            {list.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-field">
          <span>Month for invoiced and collected</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {monthOptions(currentMonth()).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {known ? (
          <button
            type="button"
            className="outline-button"
            onClick={dashboard.reload}
            disabled={dashboard.loading}
          >
            {dashboard.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>
      {body}
    </section>
  );
}
