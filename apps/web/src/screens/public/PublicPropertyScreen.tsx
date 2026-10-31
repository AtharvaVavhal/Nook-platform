import { useState, useReducer } from 'react';
import { demoProperty, demoFloors } from '../../propertyDemo';
import { FloorPlan } from '../../components/FloorPlan';
import { floorPlanReducer, initialFloorPlanState } from '../../floorPlanState';
import { mockDataService } from '../../api/mockAdapter';
import { Icon, PropertyIllustration } from '../../components/BrandIllustration';

export function PublicPropertyScreen() {
  const [floorState, dispatch] = useReducer(floorPlanReducer, {
    ...initialFloorPlanState,
    status: 'available', // Prospective residents primarily focus on free beds
  });

  const [applicantName, setApplicantName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredRoomType, setPreferredRoomType] = useState('Double Sharing');
  const [moveInDate, setMoveInDate] = useState('2026-11-15');
  const [notes, setNotes] = useState('');

  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmitEnquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await mockDataService.submitPublicEnquiry({
        applicantName: applicantName.trim(),
        phone: phone.trim(),
        preferredRoomType,
        moveInDate,
        notes: notes.trim(),
      });
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  const availableCount = demoFloors.flatMap((f) => f.rooms.flatMap((r) => r.beds)).filter((b) => b.status === 'available').length;

  return (
    <div className="public-property-view" style={{ maxWidth: '1080px', margin: '0 auto', padding: '16px' }}>
      <header className="public-header" style={{ marginBottom: '24px' }}>
        <div className="page-heading">
          <div>
            <p className="eyebrow violet">WELCOME TO NOOK LIVING</p>
            <h1>{demoProperty.name}</h1>
            <p className="page-description">
              <Icon name="pin" size={16} /> {demoProperty.location} · Thoughtfully organised shared living
            </p>
          </div>
          <span className="environment-badge">
            <strong>{availableCount} Available Beds</strong>
          </span>
        </div>

        <div className="property-banner">
          <div className="property-copy">
            <span className="property-kicker">CURATED PG & HOSTEL LIVING</span>
            <h2>Spacious, well-managed rooms with verified bed-level availability.</h2>
            <p>
              Explore our real-time floor plan below to see exactly which bed is open before you apply.
            </p>
          </div>
          <PropertyIllustration />
        </div>
      </header>

      {/* Interactive Floor Plan filtered to Available Beds */}
      <section style={{ marginBottom: '40px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 6px' }}>Explore Genuinely Free Beds</h2>
          <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
            Every bed status is transparently reported. Selecting a bed does not lock or hold it.
          </p>
        </div>
        <FloorPlan state={floorState} dispatch={dispatch} />
      </section>

      {/* Public Enquiry Form */}
      <section style={{ background: 'var(--color-surface)', padding: '32px', borderRadius: '12px', border: '1px solid var(--color-border-subtle)', maxWidth: '640px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '22px', margin: '0 0 8px' }}>Submit an Enquiry</h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
          Leave your details and the property manager will reach out within 2 hours.
        </p>

        {submitted ? (
          <div style={{ padding: '24px', background: 'var(--color-success-tint)', border: '1px solid var(--color-success-solid)', borderRadius: '8px', color: 'var(--color-success-text)' }}>
            <h3 style={{ margin: '0 0 8px' }}>Thank you, {applicantName}!</h3>
            <p style={{ margin: 0 }}>
              Your enquiry has been received by Nook House management. We will contact you at <strong>{phone}</strong> to confirm bed allocation and schedule a visit.
            </p>
            <button
              type="button"
              className="outline-button"
              style={{ marginTop: '16px' }}
              onClick={() => {
                setSubmitted(false);
                setApplicantName('');
                setPhone('');
                setNotes('');
              }}
            >
              Submit another enquiry
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmitEnquiry} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Your Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Aditi Rao"
                value={applicantName}
                onChange={(e) => setApplicantName(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Phone Number
              </label>
              <input
                type="tel"
                required
                placeholder="+91 98XXX XXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Preferred Room Type
                </label>
                <select
                  value={preferredRoomType}
                  onChange={(e) => setPreferredRoomType(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                >
                  <option value="Single Room">Single Room</option>
                  <option value="Double Sharing">Double Sharing</option>
                  <option value="Triple Sharing">Triple Sharing</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Target Move-in Date
                </label>
                <input
                  type="date"
                  required
                  value={moveInDate}
                  onChange={(e) => setMoveInDate(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Any special requirements or questions?
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Ground floor preference, parking requirement..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)', fontFamily: 'inherit' }}
              />
            </div>

            <button
              type="submit"
              className="primary-button"
              disabled={loading}
              style={{ padding: '12px', marginTop: '8px' }}
            >
              {loading ? 'Submitting...' : 'Send Enquiry to Property Manager'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
