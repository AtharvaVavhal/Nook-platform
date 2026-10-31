import { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../auth/permissions';
import { ErrorState } from '../../components/ErrorState';
import { StatusBadge } from '../../components/StatusBadge';
import { DateText } from '../../components/DateText';
import { mockDataService, type EnquiryItem } from '../../api/mockAdapter';
import { demoFloors } from '../../propertyDemo';
import { ConflictError } from '../../api/errors';

export function EnquiryAllocationScreen() {
  const { can } = useAuth();
  const [enquiries, setEnquiries] = useState<EnquiryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form & allocation state
  const [selectedEnquiry, setSelectedEnquiry] = useState<EnquiryItem | null>(null);
  const [applicantName, setApplicantName] = useState('');
  const [phone, setPhone] = useState('');
  const [moveInDate, setMoveInDate] = useState('2026-11-05');
  const [selectedFloorId, setSelectedFloorId] = useState('ground');
  const [selectedRoomId, setSelectedRoomId] = useState('001');
  const [selectedBedId, setSelectedBedId] = useState('C');

  const [submitting, setSubmitting] = useState(false);
  const [allocationSuccess, setAllocationSuccess] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const fetchEnquiries = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await mockDataService.getEnquiries();
      setEnquiries(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load enquiries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnquiries();
  }, []);

  const handleSelectEnquiry = (enq: EnquiryItem) => {
    setSelectedEnquiry(enq);
    setApplicantName(enq.applicantName);
    setPhone(enq.phone);
    setMoveInDate(enq.moveInDate);
    setConflictError(null);
    setAllocationSuccess(null);
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    setConflictError(null);
    setAllocationSuccess(null);
    setSubmitting(true);

    const idempotencyKey = `alloc_ui_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      const result = await mockDataService.allocateBed(
        {
          enquiryId: selectedEnquiry?.id,
          residentName: applicantName.trim(),
          phone: phone.trim(),
          floorId: selectedFloorId,
          roomId: selectedRoomId,
          bedId: selectedBedId,
          expectedMoveInDate: moveInDate,
        },
        idempotencyKey
      );

      setAllocationSuccess(`Bed ${selectedRoomId}-${selectedBedId} successfully allocated (Allocation Ref: ${result.allocationId}).`);
      await fetchEnquiries();
    } catch (err: unknown) {
      if (err instanceof ConflictError) {
        setConflictError(err.message);
      } else if (err instanceof Error) {
        setConflictError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!can(PERMISSIONS.ENQUIRY_READ)) {
    return (
      <ErrorState
        type="forbidden"
        message="Your active role lacks the enquiry.read permission required to manage admissions and allocations."
      />
    );
  }

  // Available beds on chosen floor
  const floor = demoFloors.find((f) => f.id === selectedFloorId) ?? demoFloors[0]!;
  const room = floor.rooms.find((r) => r.id === selectedRoomId) ?? floor.rooms[0];
  const availableBeds = room?.beds.filter((b) => b.status === 'available') ?? [];

  return (
    <section className="enquiry-allocation-flow" aria-labelledby="enquiry-flow-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow violet">STREAMLINED ADMISSIONS</p>
          <h1 id="enquiry-flow-heading">Enquiries & Bed Allocation</h1>
          <p className="page-description">Review applicant requests and allocate available beds in one continuous workflow.</p>
        </div>
      </div>

      <div className="admission-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        {/* Left Column: Enquiry Queue */}
        <div className="enquiry-queue" style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '18px', margin: 0 }}>Pending Queue ({enquiries.filter((e) => e.status === 'pending').length})</h2>
            <button
              type="button"
              className="outline-button"
              style={{ fontSize: '12px', padding: '4px 10px' }}
              onClick={() => {
                setSelectedEnquiry(null);
                setApplicantName('');
                setPhone('');
                setAllocationSuccess(null);
                setConflictError(null);
              }}
            >
              + Walk-in Admission
            </button>
          </div>

          {loading ? (
            <p>Loading enquiries...</p>
          ) : error ? (
            <div style={{ color: 'var(--color-danger-text)' }}>{error}</div>
          ) : enquiries.length === 0 ? (
            <p>No enquiries received yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {enquiries.map((enq) => (
                <div
                  key={enq.id}
                  onClick={() => enq.status === 'pending' && handleSelectEnquiry(enq)}
                  style={{
                    padding: '16px',
                    borderRadius: '6px',
                    border: `1px solid ${selectedEnquiry?.id === enq.id ? 'var(--color-brand-accent)' : 'var(--color-border-subtle)'}`,
                    background: selectedEnquiry?.id === enq.id ? 'var(--color-brand-subtle)' : 'var(--color-surface)',
                    cursor: enq.status === 'pending' ? 'pointer' : 'default',
                    opacity: enq.status === 'allocated' ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{enq.applicantName}</strong>
                    <StatusBadge variant={enq.status === 'allocated' ? 'success' : 'pending'} label={enq.status} />
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                    <span>{enq.phone}</span> · <span>Target Move-in: <DateText value={enq.moveInDate} /></span>
                  </div>
                  <small style={{ display: 'block', marginTop: '6px', color: 'var(--color-text-secondary)' }}>
                    Preference: {enq.preferredRoomType}
                  </small>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Instant Bed Allocation Form */}
        <div className="allocation-form-card" style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 16px' }}>
            {selectedEnquiry ? `Allocate Bed for ${selectedEnquiry.applicantName}` : 'Walk-in Admission & Allocation'}
          </h2>

          {allocationSuccess && (
            <div style={{ padding: '16px', background: 'var(--color-success-tint)', border: '1px solid var(--color-success-solid)', borderRadius: '6px', color: 'var(--color-success-text)', marginBottom: '16px' }}>
              <strong>Allocation Confirmed!</strong>
              <p style={{ margin: '4px 0 0', fontSize: '13px' }}>{allocationSuccess}</p>
            </div>
          )}

          {conflictError && (
            <ErrorState
              type="conflict"
              title="Bed collision detected"
              message={conflictError}
            />
          )}

          <div className="local-selection-note" style={{ marginBottom: '16px' }}>
            <strong>Rule 2 Safeguard:</strong> Selecting a bed does not hold or lock it. Availability is verified with the server at the moment of approval.
          </div>

          <form onSubmit={handleAllocate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Applicant full name
              </label>
              <input
                type="text"
                required
                value={applicantName}
                onChange={(e) => setApplicantName(e.target.value)}
                placeholder="e.g. Sneha Kulkarni"
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Contact phone number
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98XXX XXXXX"
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Expected move-in date
              </label>
              <input
                type="date"
                required
                value={moveInDate}
                onChange={(e) => setMoveInDate(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
              />
            </div>

            {/* Bed Selection */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Floor</label>
                <select
                  value={selectedFloorId}
                  onChange={(e) => {
                    setSelectedFloorId(e.target.value);
                    const f = demoFloors.find((fl) => fl.id === e.target.value);
                    if (f && f.rooms[0]) {
                      setSelectedRoomId(f.rooms[0].id);
                      const b = f.rooms[0].beds.find((bd) => bd.status === 'available');
                      if (b) setSelectedBedId(b.id);
                    }
                  }}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                >
                  {demoFloors.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Room</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => {
                    setSelectedRoomId(e.target.value);
                    const r = floor.rooms.find((rm) => rm.id === e.target.value);
                    const b = r?.beds.find((bd) => bd.status === 'available');
                    if (b) setSelectedBedId(b.id);
                  }}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                >
                  {floor.rooms.map((r) => (
                    <option key={r.id} value={r.id}>Room {r.id}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Bed</label>
                <select
                  value={selectedBedId}
                  onChange={(e) => setSelectedBedId(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                  required
                >
                  {availableBeds.length === 0 ? (
                    <option value="" disabled>No free beds</option>
                  ) : (
                    availableBeds.map((b) => (
                      <option key={b.id} value={b.id}>Bed {b.id}</option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="primary-button"
              disabled={submitting || availableBeds.length === 0}
              style={{ marginTop: '12px' }}
            >
              {submitting ? 'Confirming with server...' : `Approve & Allocate Bed ${selectedRoomId}-${selectedBedId}`}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
