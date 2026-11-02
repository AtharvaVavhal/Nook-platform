import { useEffect, useState } from 'react';
import '../finance/finance.css';
import { AdmissionPanel } from './Admissions';
import { BookingList, BookingNew } from './Bookings';
import { CheckInDetail, CheckInList, CheckInNew } from './CheckIns';
import { EnquiryDetail, EnquiryList, EnquiryNew } from './Enquiries';
import { ResidentDetail, ResidentList, ResidentNew } from './Residents';
import { opsLinks, parseOpsRoute, type OpsRoute } from './opsRoute';

const TABS: Array<{ href: string; label: string; match: OpsRoute['name'][] }> = [
  {
    href: opsLinks.residents,
    label: 'Residents',
    match: ['residents', 'resident-new', 'resident'],
  },
  { href: opsLinks.enquiries, label: 'Enquiries', match: ['enquiries', 'enquiry-new', 'enquiry'] },
  { href: opsLinks.bookings, label: 'Bookings', match: ['bookings', 'booking-new'] },
  { href: opsLinks.admissions, label: 'Admissions', match: ['admissions'] },
  { href: opsLinks.checkIns, label: 'Check-ins', match: ['check-ins', 'check-in-new', 'check-in'] },
];

export function OpsShell() {
  const [route, setRoute] = useState<OpsRoute>(() => parseOpsRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseOpsRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return (
    <div className="fin-shell">
      <div className="fin-page-head">
        <p className="eyebrow violet">OPERATIONS</p>
        <h1>Residents and stays</h1>
        <p className="fin-lede">
          Enquiries, residents, bookings, admissions and check-ins for your property.
        </p>
      </div>
      <nav className="fin-tabs" aria-label="Operations sections">
        {TABS.map((t) => (
          <a
            key={t.href}
            href={t.href}
            aria-current={t.match.includes(route.name) ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {route.name === 'residents' ? <ResidentList /> : null}
      {route.name === 'resident-new' ? <ResidentNew /> : null}
      {route.name === 'resident' ? <ResidentDetail id={route.id} /> : null}
      {route.name === 'enquiries' ? <EnquiryList /> : null}
      {route.name === 'enquiry-new' ? <EnquiryNew /> : null}
      {route.name === 'enquiry' ? <EnquiryDetail id={route.id} /> : null}
      {route.name === 'bookings' ? <BookingList /> : null}
      {route.name === 'booking-new' ? <BookingNew /> : null}
      {route.name === 'admissions' ? <AdmissionPanel /> : null}
      {route.name === 'check-ins' ? <CheckInList /> : null}
      {route.name === 'check-in-new' ? <CheckInNew /> : null}
      {route.name === 'check-in' ? <CheckInDetail id={route.id} /> : null}
    </div>
  );
}
