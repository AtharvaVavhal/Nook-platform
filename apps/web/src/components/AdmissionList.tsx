import { useEffect, useState } from 'react';
import { api } from '../api';

export interface Admission {
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
  booking?: { id: string; startDate: string; endDate: string };
  resident?: { id: string; firstName: string; lastName: string };
  bed?: { id: string; label: string; room?: { label: string; property?: { name: string } } };
  property?: { id: string; name: string };
  room?: { id: string; label: string };
}

export function AdmissionList() {
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(20),
      });
      if (status) params.set('status', status);
      const data = await api.get<{ items: any[]; total: number; page: number; limit: number; totalPages: number }>(`/admissions?${params.toString()}`);
      setAdmissions(data.items);
      setTotal(data.total);
    } catch (e) {
      console.error('Failed to load admissions', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [page]);

  const statusOptions = ['', 'PENDING', 'ADMITTED', 'CANCELLED'] as const;

  return (
    <section id="admissions" className="section">
      <h2>Admissions</h2>
      <div className="admissions-toolbar">
        <input
          type="search"
          placeholder="Search resident name, phone, email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ADMITTED">Admitted</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className="admissions-table">
          <thead>
            <tr>
              <th>Resident</th>
              <th>Booking</th>
              <th>Bed</th>
              <th>Admission Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {admissions.map(adm => (
              <tr key={adm.id} onClick={() => window.location.hash = `#admission/${adm.id}`}>
                <td>{adm.resident ? `${adm.resident.firstName} ${adm.resident.lastName}` : '—'}</td>
                <td>{adm.booking ? `#${adm.booking.id.slice(0,8)}` : '—'}</td>
                <td>{adm.bed ? `${adm.bed.label} (${adm.bed.room?.label})` : '—'}</td>
                <td>{new Date(adm.admissionDate).toLocaleDateString()}</td>
                <td><span className={`status-badge ${adm.status.toLowerCase()}`}>{adm.status}</span></td>
                <td><button className="icon-button" onClick={e=>{e.stopPropagation(); window.location.hash=`#admission/${adm.id}`;}}><svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 12c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3zm-1.07-1.63c-.59-.34-1.27-.55-2-.55-.86 0-1.56.35-1.86.85-.12.21-.18.46-.18.71 0 .56.44 1 1 1 .37 0 .72-.17.95-.44L13.64 13h2.31c.45-.43.75-1.06.75-1.78 0-.72-.53-1.34-1.24-1.55A4.985 4.985 0 0014 10c-1.1 0-2 .9-2 2s.9 2 2 2c.63 0 1.17-.32 1.47-.79L14 15.06c-.59.57-1.08 1.29-1.08 2.11 0 1.66 1.34 3 3 3s3-1.34 3-3c0-.81-.39-1.56-.94-1.94z"/></svg></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}