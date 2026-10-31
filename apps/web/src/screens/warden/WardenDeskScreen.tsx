import { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../auth/permissions';
import { ErrorState } from '../../components/ErrorState';
import { StatusBadge } from '../../components/StatusBadge';
import { DateText } from '../../components/DateText';
import { mockDataService, type ResidentListItem, type MaintenanceItem } from '../../api/mockAdapter';
import { demoFloors } from '../../propertyDemo';

export function WardenDeskScreen() {
  const { can } = useAuth();
  const [residents, setResidents] = useState<ResidentListItem[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([mockDataService.getResidents(), mockDataService.getMaintenanceRequests()])
      .then(([resData, mntData]) => {
        if (!cancelled) {
          setResidents(resData);
          setMaintenance(mntData);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load front desk records');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!can(PERMISSIONS.OCCUPANCY_READ)) {
    return (
      <ErrorState
        type="forbidden"
        message="Your active role lacks the occupancy.read permission required to view the front desk roster."
      />
    );
  }

  if (loading) {
    return (
      <div className="state-card" aria-busy="true">
        <div className="state-content">
          <h2>Loading front desk roster...</h2>
          <p>Compiling current bed allocations and maintenance hold logs.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState type="generic" title="Front Desk Error" message={error} />;
  }

  const allBeds = demoFloors.flatMap((f) =>
    f.rooms.flatMap((r) =>
      r.beds.map((b) => ({
        floorName: f.name,
        roomNumber: r.id,
        bedLetter: b.id,
        status: b.status,
        reason: b.unavailableReason,
        resident: residents.find((res) => res.roomNumber === r.id && res.bedLetter === b.id),
      }))
    )
  );

  return (
    <section className="warden-desk-screen" aria-labelledby="warden-desk-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow violet">FRONT DESK & OPERATIONS</p>
          <h1 id="warden-desk-heading">Warden / Front Desk Roster</h1>
          <p className="page-description">
            Strict role separation: Bed allocation and maintenance holds only. Financial balances, ledger references, and KYC documents are not visible.
          </p>
        </div>
        <StatusBadge variant="success" label="Hostel Check-in Active" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        {/* Maintenance / Operational Holds Card */}
        <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 16px' }}>Active Maintenance Holds ({maintenance.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {maintenance.map((m) => (
              <div key={m.id} style={{ padding: '12px', background: 'var(--color-warning-tint)', borderRadius: '6px', borderLeft: '4px solid var(--color-warning-solid)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>
                    {m.floorName} · Room {m.roomNumber}
                    {m.bedLetter ? ` (Bed ${m.bedLetter})` : ''}
                  </strong>
                  <StatusBadge variant="warning" label={m.status.replace('_', ' ')} />
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  {m.issue}
                </p>
                <small style={{ color: 'var(--color-text-secondary)', marginTop: '4px', display: 'block' }}>
                  Reported on <DateText value={m.reportedDate} />
                </small>
              </div>
            ))}
          </div>
        </div>

        {/* Rapid Check-in Summary */}
        <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 16px' }}>Property Bed Summary</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
            <div style={{ padding: '16px', background: 'var(--color-brand-subtle)', borderRadius: '8px' }}>
              <span className="card-label">Total Beds</span>
              <strong style={{ fontSize: '24px' }}>{allBeds.length}</strong>
            </div>
            <div style={{ padding: '16px', background: 'var(--color-brand-subtle)', borderRadius: '8px' }}>
              <span className="card-label">Occupied</span>
              <strong style={{ fontSize: '24px', color: 'var(--color-text-primary)' }}>
                {allBeds.filter((b) => b.status === 'occupied').length}
              </strong>
            </div>
            <div style={{ padding: '16px', background: 'var(--color-brand-subtle)', borderRadius: '8px' }}>
              <span className="card-label">Vacant</span>
              <strong style={{ fontSize: '24px', color: 'var(--color-success-text)' }}>
                {allBeds.filter((b) => b.status === 'available').length}
              </strong>
            </div>
          </div>
          <div style={{ marginTop: '20px', padding: '12px', background: 'var(--color-neutral-tint)', borderRadius: '6px', fontSize: '12px', color: 'var(--color-neutral-text)' }}>
            🔒 <strong>Warden Privacy Guarantee:</strong> No tenant balances or payment transaction data are exposed to this desk.
          </div>
        </div>
      </div>

      {/* Bed-by-Bed Who Is Where Table */}
      <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
        <h2 style={{ fontSize: '18px', margin: '0 0 16px' }}>Who Is in Which Bed</h2>
        <div className="inventory-table-wrap" tabIndex={0} aria-label="Warden bed directory">
          <table className="inventory-table">
            <thead>
              <tr>
                <th scope="col">Bed Location</th>
                <th scope="col">Status</th>
                <th scope="col">Resident Name</th>
                <th scope="col">Contact</th>
                <th scope="col">Move-in Date</th>
                <th scope="col">Operational Notes</th>
              </tr>
            </thead>
            <tbody>
              {allBeds.map((bed, idx) => (
                <tr key={`${bed.roomNumber}-${bed.bedLetter}-${idx}`}>
                  <th scope="row">
                    <strong>Room {bed.roomNumber}-{bed.bedLetter}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{bed.floorName}</div>
                  </th>
                  <td>
                    <StatusBadge variant={bed.status} />
                  </td>
                  <td>
                    {bed.resident ? (
                      <strong>{bed.resident.name}</strong>
                    ) : (
                      <span style={{ color: 'var(--color-text-secondary)' }}>— Vacant —</span>
                    )}
                  </td>
                  <td>{bed.resident ? bed.resident.phone : '—'}</td>
                  <td>{bed.resident ? <DateText value={bed.resident.checkInDate} /> : '—'}</td>
                  <td>
                    {bed.reason ? (
                      <span style={{ color: 'var(--color-warning-text)', fontWeight: 500 }}>
                        {bed.reason}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-secondary)' }}>Standard occupancy</span>
                    )}
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
