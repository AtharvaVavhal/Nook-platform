import { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../auth/permissions';
import { ErrorState } from '../../components/ErrorState';
import { StatusBadge } from '../../components/StatusBadge';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { mockDataService, type ResidentListItem, type ResidentStatement } from '../../api/mockAdapter';

export function ResidentStatementScreen() {
  const { can } = useAuth();
  const [residents, setResidents] = useState<ResidentListItem[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string>('res_demo_01');
  const [statement, setStatement] = useState<ResidentStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mockDataService
      .getResidents()
      .then((data) => {
        if (!cancelled) setResidents(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load residents');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    mockDataService
      .getResidentStatement(selectedResidentId)
      .then((data) => {
        if (!cancelled) {
          setStatement(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load resident statement');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedResidentId]);

  if (!can(PERMISSIONS.RESIDENT_READ)) {
    return (
      <ErrorState
        type="forbidden"
        message="Your active role lacks the resident.read permission required to view resident profiles and statements."
      />
    );
  }

  if (error) {
    return <ErrorState type="generic" title="Error loading statement" message={error} />;
  }

  return (
    <section className="resident-statement-screen" aria-labelledby="resident-screen-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow violet">AUDITABLE FINANCIAL RECORD</p>
          <h1 id="resident-screen-heading">Resident Profile & Statement</h1>
          <p className="page-description">
            Rule 4 compliance: Every balance is dynamically computed line-by-line from immutable ledger transactions.
          </p>
        </div>
      </div>

      {/* Resident Selection Strip */}
      <div className="resident-selector-strip" style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '24px' }}>
        {residents.map((r) => {
          const isSelected = r.id === selectedResidentId;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedResidentId(r.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '12px 16px',
                borderRadius: '8px',
                border: `1px solid ${isSelected ? 'var(--color-brand-accent)' : 'var(--color-border-subtle)'}`,
                background: isSelected ? 'var(--color-brand-subtle)' : 'var(--color-surface)',
                cursor: 'pointer',
                minWidth: '200px',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '4px' }}>
                <strong style={{ fontSize: '14px' }}>{r.name}</strong>
                <StatusBadge variant={r.ageingBucket === 'current' ? 'success' : 'danger'} label={`${r.ageingDays}d`} />
              </div>
              <small style={{ color: 'var(--color-text-secondary)' }}>
                Room {r.roomNumber}-{r.bedLetter}
              </small>
              <div style={{ marginTop: '8px', fontSize: '13px', fontWeight: 600 }}>
                Due: <Money paise={r.balancePaise} />
              </div>
            </button>
          );
        })}
      </div>

      {loading || !statement ? (
        <div className="state-card">
          <div className="state-content">
            <h2>Computing statement ledger...</h2>
            <p>Deriving running balances in date sequence.</p>
          </div>
        </div>
      ) : (
        <div className="statement-workspace" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Profile Overview Card */}
          <div className="property-banner" style={{ display: 'block', padding: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
              <div>
                <span className="card-label">Resident Details</span>
                <strong style={{ fontSize: '18px', display: 'block' }}>{statement.resident.name}</strong>
                <small>{statement.resident.phone}</small>
              </div>

              <div>
                <span className="card-label">Assigned Bed</span>
                <strong style={{ fontSize: '18px', display: 'block' }}>
                  Room {statement.resident.roomNumber} · Bed {statement.resident.bedLetter}
                </strong>
                <small>Occupancy confirmed per bed</small>
              </div>

              <div>
                <span className="card-label">Move-in Date</span>
                <strong style={{ fontSize: '18px', display: 'block' }}>
                  <DateText value={statement.resident.checkInDate} />
                </strong>
                <small>Standard Agreement</small>
              </div>

              <div>
                <span className="card-label">Net Derived Balance</span>
                <strong
                  style={{
                    fontSize: '22px',
                    display: 'block',
                    color: statement.currentBalancePaise > 0n ? 'var(--color-danger-solid)' : 'var(--color-success-solid)',
                  }}
                >
                  <Money paise={statement.currentBalancePaise} />
                </strong>
                <small>{statement.currentBalancePaise > 0n ? 'Outstanding Dues' : 'Account in good standing'}</small>
              </div>
            </div>

            {/* Document Separation Notice */}
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                Identity Documents (KYC):
              </span>
              {can(PERMISSIONS.DOCUMENT_READ) ? (
                <span style={{ fontSize: '12px', color: 'var(--color-success-text)' }}>
                  ✓ Document access verified (Operator authorized)
                </span>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  🔒 Documents restricted (Requires document.read permission)
                </span>
              )}
            </div>
          </div>

          {/* Ledger Statement Table */}
          <div className="statement-table-box" style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Itemized Financial Statement</h2>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                Immutable Ledger · Reversals/Adjustments With Stated Reason
              </span>
            </div>

            <div className="inventory-table-wrap" tabIndex={0} aria-label="Statement ledger">
              <table className="inventory-table">
                <caption className="sr-only">Line-by-line financial statement summing to derived balance</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Transaction Type</th>
                    <th scope="col">Description & Audit Reason</th>
                    <th scope="col">Reference</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.lineItems.map((line) => {
                    const isCredit = line.amountPaise < 0n;
                    return (
                      <tr key={line.id}>
                        <td><DateText value={line.date} /></td>
                        <td>
                          <StatusBadge
                            variant={line.type === 'payment' ? 'success' : line.type === 'adjustment' ? 'warning' : 'neutral'}
                            label={line.type}
                          />
                        </td>
                        <td>
                          <div>{line.description}</div>
                          {line.reason && (
                            <small style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                              Audit Reason: {line.reason}
                            </small>
                          )}
                        </td>
                        <td>
                          <code>{line.reference || '—'}</code>
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            color: isCredit ? 'var(--color-success-text)' : 'inherit',
                          }}
                        >
                          {isCredit ? '- ' : ''}
                          <Money paise={isCredit ? -line.amountPaise : line.amountPaise} />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          <Money paise={line.runningBalancePaise} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4}>Final Derived Balance</th>
                    <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700, fontSize: '16px' }}>
                      <Money paise={statement.currentBalancePaise} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
