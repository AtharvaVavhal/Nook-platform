import { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../auth/permissions';
import { ErrorState } from '../../components/ErrorState';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { StatusBadge } from '../../components/StatusBadge';
import { Link } from '../../router/RouterContext';
import { mockDataService, type OwnerDashboardSummary } from '../../api/mockAdapter';
import { Icon } from '../../components/BrandIllustration';

export function OwnerDashboardScreen({
  onSelectResidentStatement,
}: {
  onSelectResidentStatement?: (residentId: string) => void;
}) {
  const { can } = useAuth();
  const [summary, setSummary] = useState<OwnerDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    mockDataService
      .getOwnerDashboard()
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load owner dashboard');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!can(PERMISSIONS.FINANCE_READ)) {
    return (
      <ErrorState
        type="forbidden"
        message="Your active role lacks the finance.read permission required to view executive financial dashboards."
      />
    );
  }

  if (loading) {
    return (
      <div className="state-card" aria-busy="true">
        <div className="state-content">
          <h2>Aggregating property metrics...</h2>
          <p>Compiling bed-level occupancy, aged arrears, and today's collections.</p>
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return <ErrorState type="generic" title="Unable to load dashboard" message={error ?? 'Unknown error'} />;
  }

  return (
    <section className="owner-dashboard" aria-labelledby="owner-dashboard-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow violet">EXECUTIVE OVERSIGHT</p>
          <h1 id="owner-dashboard-heading">Owner & Partner Dashboard</h1>
          <p className="page-description">Bed-level yield, ageing analysis of outstanding dues, and today's collections.</p>
        </div>
        <Link to="#/floor-plan" className="primary-button">
          Live Floor Plan <Icon name="arrow" size={16} />
        </Link>
      </div>

      {/* KPI Overview Grid */}
      <div className="summary-grid" style={{ marginBottom: '24px' }}>
        <div className="summary-card">
          <div>
            <span className="card-label">Bed Occupancy</span>
            <strong style={{ fontSize: '28px' }}>{summary.occupancyRate}%</strong>
            <p>
              {summary.occupiedBeds} occupied · {summary.availableBeds} free · {summary.unavailableBeds} hold
            </p>
          </div>
          <span className="summary-icon">
            <Icon name="bed" size={24} />
          </span>
        </div>

        <div className="summary-card">
          <div>
            <span className="card-label">Total Outstanding Dues</span>
            <strong style={{ fontSize: '28px', color: 'var(--color-danger-solid)' }}>
              <Money paise={summary.totalOutstandingPaise} />
            </strong>
            <p>Sum across all active residents</p>
          </div>
          <span className="summary-icon">
            <Icon name="layers" size={24} />
          </span>
        </div>

        <div className="summary-card">
          <div>
            <span className="card-label">Today's Collections</span>
            <strong style={{ fontSize: '28px', color: 'var(--color-success-text)' }}>
              <Money paise={summary.todayCollectionsPaise} />
            </strong>
            <p>{summary.todayCollections.length} payments recorded today</p>
          </div>
          <span className="summary-icon">
            <Icon name="grid" size={24} />
          </span>
        </div>
      </div>

      {/* Collections Breakdown by Method */}
      <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', margin: '0 0 16px' }}>Today's Collections by Payment Method</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
          <div style={{ padding: '16px', background: 'var(--color-brand-subtle)', borderRadius: '6px' }}>
            <span className="card-label">UPI</span>
            <strong style={{ fontSize: '20px', display: 'block' }}>
              <Money paise={summary.collectionsByMethod.upi} />
            </strong>
          </div>
          <div style={{ padding: '16px', background: 'var(--color-brand-subtle)', borderRadius: '6px' }}>
            <span className="card-label">Bank Transfer (IMPS/NEFT)</span>
            <strong style={{ fontSize: '20px', display: 'block' }}>
              <Money paise={summary.collectionsByMethod.bank_transfer} />
            </strong>
          </div>
          <div style={{ padding: '16px', background: 'var(--color-brand-subtle)', borderRadius: '6px' }}>
            <span className="card-label">Cash</span>
            <strong style={{ fontSize: '20px', display: 'block' }}>
              <Money paise={summary.collectionsByMethod.cash} />
            </strong>
          </div>
          <div style={{ padding: '16px', background: 'var(--color-brand-subtle)', borderRadius: '6px' }}>
            <span className="card-label">Cheque</span>
            <strong style={{ fontSize: '20px', display: 'block' }}>
              <Money paise={summary.collectionsByMethod.cheque} />
            </strong>
          </div>
        </div>
      </div>

      {/* Ageing Arrears Table */}
      <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>Outstanding Dues by Resident & Ageing Analysis</h2>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Click resident to inspect statement</span>
        </div>

        <div className="inventory-table-wrap" tabIndex={0} aria-label="Aged receivables table">
          <table className="inventory-table">
            <thead>
              <tr>
                <th scope="col">Resident</th>
                <th scope="col">Bed</th>
                <th scope="col">Move-in Date</th>
                <th scope="col">Ageing</th>
                <th scope="col" style={{ textAlign: 'right' }}>Total Outstanding</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {summary.residents.map((res) => (
                <tr key={res.id}>
                  <th scope="row">
                    <strong>{res.name}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{res.phone}</div>
                  </th>
                  <td>Room {res.roomNumber}-{res.bedLetter}</td>
                  <td><DateText value={res.checkInDate} /></td>
                  <td>
                    <StatusBadge
                      variant={res.ageingBucket === 'current' ? 'success' : res.ageingBucket === '60+' ? 'danger' : 'warning'}
                      label={`${res.ageingDays} days (${res.ageingBucket})`}
                    />
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    <Money paise={res.balancePaise} />
                  </td>
                  <td>
                    <Link
                      to="#/residents"
                      className="text-link"
                      onClick={() => onSelectResidentStatement?.(res.id)}
                    >
                      Statement <Icon name="arrow" size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
