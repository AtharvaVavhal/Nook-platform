import { useEffect, useState } from 'react';
import { api } from '../api';
import { useParams, useNavigate } from 'react-router-dom';

interface Admission {
  id: string;
  organizationId: string;
  bookingId: string;
  residentId: string;
  bedId: string;
  propertyId?: string;
  roomId?: string;
  admissionDate: string;
  status: 'PENDING' | 'ADMITTED' | 'CANCELLED';
  notes?: string;
  createdAt: string;
  updatedAt: string;
  booking?: { id: string; startDate: string; endDate: string; monthlyPrice: number; paymentStatus: string };
  resident?: { id: string; firstName: string; lastName: string; phone?: string; email?: string; documentVerificationStatus: string };
  bed?: { id: string; label: string; room?: { label: string; property?: { name: string } } };
  property?: { name: string };
  room?: { label: string };
}

export function AdmissionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [admission, setAdmission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const data = await api.get(`/admissions/${id}`);
        setAdmission(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleStatusChange(newStatus: string) {
    if (!admission) return;
    setSaving(true);
    try {
      await api.put(`/admissions/${id}`, { status: newStatus });
      setAdmission({ ...admission, status: newStatus });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this admission?')) return;
    await handleStatusChange('CANCELLED');
  }

  if (loading) return <p>Loading…</p>;
  if (!admission) return <p>Admission not found.</p>;

  const resident = admission.resident;
  const booking = admission.booking;
  const bed = admission.bed;

  return (
    <section className="admission-detail">
      <header className="detail-header">
        <h2>Admission <span className="id-badge">{admission.id.slice(0,8)}</span></h2>
        <div className="actions">
          <select
            value={admission.status}
            onChange={e => handleStatusChange(e.target.value)}
            disabled={saving}
          >
            <option value="PENDING">Pending</option>
            <option value="ADMITTED">Admitted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button className="danger-button" onClick={handleCancel} disabled={saving || admission.status === 'CANCELLED'}>
            Cancel Admission
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="detail-grid">
        <section className="card">
          <h3>Resident</h3>
          {admission.resident && (
            <dl>
              <dt>Name</dt><dd>{admission.resident.firstName} {admission.resident.lastName}</dd>
              <dt>Phone</dt><dd>{admission.resident.phone ?? '—'}</dd>
              <dt>Email</dt><dd>{admission.resident.email ?? '—'}</dd>
              <dt>Document verification</dt><dd><span className={`badge ${admission.resident.documentVerificationStatus.toLowerCase()}`}>{admission.resident.documentVerificationStatus}</span></dd>
            </dl>
          )}
        </section>

        <section className="card">
          <h3>Booking</h3>
          {admission.booking && (
            <dl>
              <dt>Booking ID</dt><dd>{admission.booking.id.slice(0,8)}</dd>
              <dt>Start</dt><dd>{new Date(admission.booking.startDate).toLocaleDateString()}</dd>
              <dt>End</dt><dd>{new Date(admission.booking.endDate).toLocaleDateString()}</dd>
              <dt>Monthly price</dt><dd>{Number(admission.booking.monthlyPrice).toLocaleString()}</dd>
              <dt>Payment status</dt><dd><span className={`badge ${admission.booking.paymentStatus.toLowerCase()}`}>{admission.booking.paymentStatus}</span></dd>
            </dl>
          )}
        </section>

        <section className="card">
          <h3>Bed Assignment</h3>
          {admission.bed && (
            <dl>
              <dt>Bed</dt><dd>{admission.bed.label}</dd>
              <dt>Room</dt><dd>{admission.bed.room?.label ?? '—'}</dd>
              <dt>Property</dt><dd>{admission.bed.room?.property?.name ?? admission.property?.name ?? '—'}</dd>
            </dl>
          )}
        </section>

        <section className="card">
          <h3>Admission Details</h3>
          <dl>
            <dt>Admission date</dt><dd>{new Date(admission.admissionDate).toLocaleDateString()}</dd>
            <dt>Status</dt><dd><span className={`badge ${admission.status.toLowerCase()}`}>{admission.status}</span></dd>
            <dt>Notes</dt><dd>{admission.notes ?? '—'}</dd>
          </dl>
        </section>
      </div>
    </section>
  );
}