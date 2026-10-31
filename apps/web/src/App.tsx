import { useReducer, useState } from 'react';
import { demoFloors, demoProperty, bedStatuses, statusLabels, summarize, type StatusFilter } from './propertyDemo';
import { floorPlanReducer, initialFloorPlanState, type FloorPlanState, type FloorPlanAction } from './floorPlanState';
import { Icon, PropertyIllustration } from './components/BrandIllustration';
import { FloorPlan } from './components/FloorPlan';
import { InventoryOverview } from './components/InventoryOverview';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RouterProvider, useRouter, Link } from './router/RouterContext';
import { AppShell } from './layout/AppShell';
import { PERMISSIONS } from './auth/permissions';
import { ErrorState } from './components/ErrorState';
import { Money } from './components/Money';
import { DateText } from './components/DateText';
import { StatusBadge } from './components/StatusBadge';
import { mockDataService } from './api/mockAdapter';

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
        data. Real resident data and floating-point money calculations are strictly excluded.
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
    <div className="scenarios-panel" style={{ marginTop: '32px', padding: '20px', background: 'var(--color-surface)', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
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

function ResidentStatementScaffold() {
  const { can } = useAuth();
  if (!can(PERMISSIONS.RESIDENT_READ)) {
    return (
      <ErrorState
        type="forbidden"
        message="Your active role lacks the resident.read permission required to view resident statements."
      />
    );
  }

  return (
    <section aria-labelledby="statement-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow violet">FINANCIAL AUDITABILITY</p>
          <h1 id="statement-heading">Resident statement</h1>
          <p className="page-description">Balances are derived line-by-line from immutable ledger entries. Never stored.</p>
        </div>
        <StatusBadge variant="success" label="Active resident" />
      </div>

      <div className="property-banner" style={{ display: 'block', padding: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
          <div>
            <span className="card-label">Resident</span>
            <strong style={{ fontSize: '18px', display: 'block' }}>Devashish Sen</strong>
            <small>Room 103 · Bed B</small>
          </div>
          <div>
            <span className="card-label">Move-in date</span>
            <strong style={{ fontSize: '18px', display: 'block' }}>
              <DateText value="2026-10-01" />
            </strong>
            <small>Contract term: 11 months</small>
          </div>
          <div>
            <span className="card-label">Derived balance</span>
            <strong style={{ fontSize: '22px', display: 'block', color: 'var(--color-danger-solid)' }}>
              <Money paise={100000n} />
            </strong>
            <small>Outstanding utility balance</small>
          </div>
        </div>
      </div>

      <div className="inventory-table-wrap" style={{ marginTop: '24px' }}>
        <table className="inventory-table">
          <caption className="sr-only">Line-by-line resident statement ledger</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Type</th>
              <th scope="col">Description / Reason</th>
              <th scope="col">Reference</th>
              <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
              <th scope="col" style={{ textAlign: 'right' }}>Running Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><DateText value="2026-10-01" /></td>
              <td><StatusBadge variant="neutral" label="Charge" /></td>
              <td>Security Deposit (2 Months)</td>
              <td>DEP-2026-001</td>
              <td style={{ textAlign: 'right' }}><Money paise={3000000n} /></td>
              <td style={{ textAlign: 'right' }}><Money paise={3000000n} /></td>
            </tr>
            <tr>
              <td><DateText value="2026-10-01" /></td>
              <td><StatusBadge variant="success" label="Payment" /></td>
              <td>Deposit payment via UPI</td>
              <td>UPI/261001/98124</td>
              <td style={{ textAlign: 'right', color: 'var(--color-success-text)' }}>- <Money paise={3000000n} /></td>
              <td style={{ textAlign: 'right' }}><Money paise={0n} /></td>
            </tr>
            <tr>
              <td><DateText value="2026-10-01" /></td>
              <td><StatusBadge variant="neutral" label="Charge" /></td>
              <td>Monthly Bed Rent — October 2026</td>
              <td>RNT-2026-10</td>
              <td style={{ textAlign: 'right' }}><Money paise={1500000n} /></td>
              <td style={{ textAlign: 'right' }}><Money paise={1500000n} /></td>
            </tr>
            <tr>
              <td><DateText value="2026-10-04" /></td>
              <td><StatusBadge variant="success" label="Payment" /></td>
              <td>Rent payment via IMPS</td>
              <td>IMPS/261004/77411</td>
              <td style={{ textAlign: 'right', color: 'var(--color-success-text)' }}>- <Money paise={1500000n} /></td>
              <td style={{ textAlign: 'right' }}><Money paise={0n} /></td>
            </tr>
            <tr>
              <td><DateText value="2026-10-15" /></td>
              <td><StatusBadge variant="neutral" label="Charge" /></td>
              <td>Utility Charge — Sub-meter Electricity</td>
              <td>UTL-2026-10</td>
              <td style={{ textAlign: 'right' }}><Money paise={125000n} /></td>
              <td style={{ textAlign: 'right' }}><Money paise={125000n} /></td>
            </tr>
            <tr>
              <td><DateText value="2026-10-20" /></td>
              <td><StatusBadge variant="warning" label="Adjustment" /></td>
              <td>Correction: Recalibrated sub-meter reading</td>
              <td>ADJ-2026-08</td>
              <td style={{ textAlign: 'right', color: 'var(--color-success-text)' }}>- <Money paise={25000n} /></td>
              <td style={{ textAlign: 'right' }}><Money paise={100000n} /></td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>Current statement balance</th>
              <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>
                <Money paise={100000n} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function PaymentRecordScaffold() {
  const { can } = useAuth();
  const [amountInput, setAmountInput] = useState('1000');
  const [reference, setReference] = useState('');
  const [recordedReceipt, setRecordedReceipt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!can(PERMISSIONS.PAYMENT_RECORD)) {
    return (
      <ErrorState
        type="forbidden"
        message="Your active role lacks the payment.record permission required to access the cashier payment desk."
      />
    );
  }

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const paise = BigInt(parseInt(amountInput, 10)) * 100n;
      const receipt = await mockDataService.recordPayment(
        {
          residentId: 'res_demo_01',
          amountPaise: paise,
          date: '2026-10-31',
          method: 'upi',
          reference: reference.trim(),
          settledChargeId: 'txn_05',
        },
        `idem_ui_${Date.now()}`
      );
      setRecordedReceipt(receipt.receiptNumber);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message);
      }
    }
  };

  return (
    <section aria-labelledby="payments-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow violet">CASHIER DESK</p>
          <h1 id="payments-heading">Record a payment</h1>
          <p className="page-description">Settle a specific charge explicitly. Duplicate references are rejected.</p>
        </div>
      </div>

      {recordedReceipt ? (
        <div className="state-card" style={{ borderLeft: '4px solid var(--color-success-solid)' }}>
          <div className="state-content">
            <span className="environment-badge">RECEIPT GENERATED</span>
            <h2>Payment recorded successfully</h2>
            <p>Numbered receipt <strong>{recordedReceipt}</strong> has been issued and linked to the settled charge.</p>
            <button
              type="button"
              className="outline-button"
              style={{ marginTop: '12px' }}
              onClick={() => {
                setRecordedReceipt(null);
                setReference('');
              }}
            >
              Record another payment
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleRecord} style={{ maxWidth: '520px', background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {errorMsg && (
            <div style={{ padding: '12px', background: 'var(--color-danger-tint)', border: '1px solid var(--color-danger-solid)', borderRadius: '6px', color: 'var(--color-danger-text)', fontSize: '13px' }}>
              {errorMsg}
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Settling resident
            </label>
            <input
              type="text"
              readOnly
              value="Devashish Sen (Room 103-B)"
              style={{ width: '100%', padding: '10px', background: 'var(--color-brand-subtle)', border: '1px solid var(--color-border-subtle)', borderRadius: '6px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Charge to settle (Explicit choice required)
            </label>
            <select style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }} required>
              <option value="txn_05">Utility Charge — AC Electricity Sub-meter (₹1,000.00 outstanding)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Payment amount (INR ₹)
            </label>
            <input
              type="number"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              min="1"
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Bank / UPI Reference number
            </label>
            <input
              type="text"
              placeholder="e.g. UPI/261031/55291"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
              required
            />
            <small style={{ color: 'var(--color-text-secondary)', marginTop: '4px', display: 'block' }}>
              Try entering <code>UPI/261001/98124</code> to see duplicate reference rejection.
            </small>
          </div>

          <button type="submit" className="primary-button" style={{ marginTop: '8px' }}>
            Record payment & issue receipt
          </button>
        </form>
      )}
    </section>
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

  const handleExploreFloor = (floorId: string, status?: StatusFilter) => {
    dispatch({ type: 'floor', floorId, ...(status ? { status } : {}) });
    navigate('#/floor-plan');
  };

  switch (routeId) {
    case 'floor-plan':
      return (
        <div>
          <FloorPlan state={state} dispatch={dispatch} />
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
    case 'residents':
      return <ResidentStatementScaffold />;
    case 'payments':
      return <PaymentRecordScaffold />;
    case 'enquiries':
    case 'warden':
    case 'public':
      return (
        <div>
          <div className="page-heading">
            <div>
              <p className="eyebrow violet">ROLE WORKSPACE</p>
              <h1>{routeId === 'warden' ? 'Front Desk Map' : routeId === 'enquiries' ? 'Enquiries & Admission' : 'Public Property View'}</h1>
              <p className="page-description">Role-tailored experience. Operational foundation established.</p>
            </div>
            <span className="environment-badge">PHASE B FOUNDATION</span>
          </div>
          <FloorPlan state={state} dispatch={dispatch} />
          <DemoScenariosSection />
        </div>
      );
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
