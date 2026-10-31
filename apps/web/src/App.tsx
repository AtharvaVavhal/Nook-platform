import { useReducer, useState } from 'react';
import { demoFloors, demoProperty, bedStatuses, statusLabels, summarize, type StatusFilter } from './propertyDemo';
import { floorPlanReducer, initialFloorPlanState, type FloorPlanState, type FloorPlanAction } from './floorPlanState';
import { Icon, PropertyIllustration } from './components/BrandIllustration';
import { InventoryOverview } from './components/InventoryOverview';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RouterProvider, useRouter, Link } from './router/RouterContext';
import { AppShell } from './layout/AppShell';
import { ErrorState } from './components/ErrorState';

// Core Screens (Phase C)
import { FloorPlanScreen } from './screens/floorplan/FloorPlanScreen';
import { EnquiryAllocationScreen } from './screens/allocation/EnquiryAllocationScreen';
import { ResidentStatementScreen } from './screens/residents/ResidentStatementScreen';
import { RecordPaymentScreen } from './screens/payments/RecordPaymentScreen';
import { OwnerDashboardScreen } from './screens/dashboard/OwnerDashboardScreen';
import { PublicPropertyScreen } from './screens/public/PublicPropertyScreen';
import { WardenDeskScreen } from './screens/warden/WardenDeskScreen';

function OverviewScreen({
  onExploreFloor,
}: {
  onExploreFloor: (floorId: string, status?: (typeof bedStatuses)[number]) => void;
}) {
  const totals = summarize(demoFloors.flatMap((floor) => floor.rooms));
  const populatedFloors = demoFloors.filter((floor) => floor.rooms.length).length;

  return (
    <section id="overview" aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow violet">ROOM TO BELONG</p>
          <h1 id="page-title">Property management</h1>
          <p className="page-description">The whole property. A little more clarity.</p>
        </div>
        <Link className="primary-button" to="#/floor-plan">
          Explore floor plan <Icon name="arrow" size={16} />
        </Link>
      </div>

      <div className="property-banner">
        <div className="property-copy">
          <span className="property-kicker">YOUR DEMONSTRATION PROPERTY</span>
          <h2>{demoProperty.name}</h2>
          <p>
            <Icon name="pin" size={16} />
            {demoProperty.location}
            <span>· Fictional property</span>
          </p>
          <div className="property-meta">
            <span>Shared living</span>
            <span>{demoFloors.length} floors</span>
            <span>{totals.rooms} rooms</span>
          </div>
        </div>
        <PropertyIllustration />
      </div>

      <p className="demo-notice">
        <span aria-hidden="true">ⓘ</span> A space to explore: every figure is synthetic demo
        data. Real resident data, identity documents, and floating-point money calculations are strictly excluded.
      </p>

      <div className="summary-grid" aria-label="Demonstration property summary">
        <Link className="summary-card" to="#/inventory">
          <div>
            <span className="card-label">Total floors</span>
            <strong>{String(demoFloors.length).padStart(2, '0')}</strong>
            <p>
              {populatedFloors} with rooms · {demoFloors.length - populatedFloors} empty
            </p>
          </div>
          <span className="summary-icon">
            <Icon name="layers" size={23} />
          </span>
        </Link>
        <Link className="summary-card" to="#/inventory">
          <div>
            <span className="card-label">Total rooms</span>
            <strong>{String(totals.rooms).padStart(2, '0')}</strong>
            <p>Explore floor inventory</p>
          </div>
          <span className="summary-icon">
            <Icon name="grid" size={23} />
          </span>
        </Link>
        <Link className="summary-card" to="#/floor-plan">
          <div>
            <span className="card-label">Total beds</span>
            <strong>{totals.beds}</strong>
            <p>Every bed accounted for</p>
          </div>
          <span className="summary-icon">
            <Icon name="bed" size={23} />
          </span>
        </Link>
      </div>

      <div className="availability-strip">
        <span className="strip-label">Demo bed snapshot</span>
        <div className="availability-track" aria-hidden="true">
          {bedStatuses.map((status) => (
            <span key={status} className={status} style={{ flex: totals[status] }} />
          ))}
        </div>
        <div className="snapshot-labels">
          {bedStatuses.map((status) => (
            <button
              key={status}
              type="button"
              className="text-link"
              aria-label={`Explore ${totals[status]} ${status} demo beds on floor plan`}
              onClick={() => onExploreFloor('ground', status)}
            >
              <i className={`legend-dot ${status}`} aria-hidden="true" />
              <strong>{totals[status]}</strong> {statusLabels[status]}{' '}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function DemoScenariosSection() {
  const [activeScenario, setActiveScenario] = useState<string | null>(null);

  return (
    <div
      className="scenarios-panel"
      style={{
        marginTop: '32px',
        padding: '20px',
        background: 'var(--color-surface)',
        borderRadius: '8px',
        border: '1px solid var(--color-border-subtle)',
      }}
    >
      <p className="eyebrow">NON-NEGOTIABLE GUARDRAIL DEMONSTRATIONS</p>
      <h3 style={{ margin: '8px 0 16px', fontSize: '16px' }}>Test Architectural Error States</h3>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="outline-button"
          onClick={() => setActiveScenario(activeScenario === '409' ? null : '409')}
        >
          {activeScenario === '409' ? 'Hide 409 Conflict' : 'Trigger 409 Bed Collision'}
        </button>
        <button
          type="button"
          className="outline-button"
          onClick={() => setActiveScenario(activeScenario === '422' ? null : '422')}
        >
          {activeScenario === '422' ? 'Hide 422 Rule Error' : 'Trigger 422 RULE_NOT_CONFIGURED'}
        </button>
      </div>

      {activeScenario === '409' && (
        <ErrorState
          type="conflict"
          title="Bed 103-B was allocated a moment ago"
          message="Another applicant completed an allocation before this submission. Selecting a bed does not hold it. You are returned to the map with current state."
        />
      )}

      {activeScenario === '422' && (
        <ErrorState
          type="rule-not-configured"
          ruleName="PRORATA_CHECKOUT_DEDUCTION"
          message="Notice period rent deduction could not be computed because the property rule is unconfigured."
        />
      )}
    </div>
  );
}

function MainContent({
  state,
  dispatch,
}: {
  state: FloorPlanState;
  dispatch: React.Dispatch<FloorPlanAction>;
}) {
  const { routeId, navigate } = useRouter();
  const { activePersonaId } = useAuth();

  const handleExploreFloor = (floorId: string, status?: StatusFilter) => {
    dispatch({ type: 'floor', floorId, ...(status ? { status } : {}) });
    navigate('#/floor-plan');
  };

  // If user is Public persona, lock display to Public screen
  if (activePersonaId === 'public') {
    return <PublicPropertyScreen />;
  }

  switch (routeId) {
    case 'dashboard':
      return (
        <div>
          <OwnerDashboardScreen />
          <DemoScenariosSection />
        </div>
      );
    case 'floor-plan':
      return (
        <div>
          <FloorPlanScreen state={state} dispatch={dispatch} />
          <DemoScenariosSection />
        </div>
      );
    case 'inventory':
      return (
        <div>
          <InventoryOverview onExplore={handleExploreFloor} />
          <DemoScenariosSection />
        </div>
      );
    case 'enquiries':
      return (
        <div>
          <EnquiryAllocationScreen />
          <DemoScenariosSection />
        </div>
      );
    case 'residents':
      return (
        <div>
          <ResidentStatementScreen />
          <DemoScenariosSection />
        </div>
      );
    case 'payments':
      return (
        <div>
          <RecordPaymentScreen />
          <DemoScenariosSection />
        </div>
      );
    case 'warden':
      return (
        <div>
          <WardenDeskScreen />
          <DemoScenariosSection />
        </div>
      );
    case 'public':
      return <PublicPropertyScreen />;
    case 'overview':
    default:
      return (
        <div>
          <OverviewScreen onExploreFloor={handleExploreFloor} />
          <DemoScenariosSection />
        </div>
      );
  }
}

export function App() {
  const [state, dispatch] = useReducer(floorPlanReducer, initialFloorPlanState);

  return (
    <AuthProvider initialPersona="manager">
      <RouterProvider>
        <AppShell>
          <MainContent state={state} dispatch={dispatch} />
        </AppShell>
      </RouterProvider>
    </AuthProvider>
  );
}
