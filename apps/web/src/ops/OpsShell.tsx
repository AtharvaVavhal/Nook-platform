import { useEffect, useState } from 'react';
import '../finance/finance.css';
import { AdmissionDetail, AdmissionPanel } from './Admissions';
import { BulkRooms } from './BulkRooms';
import { CorrectionDetail, CorrectionList, CorrectionNew, FinanceReviews } from './Corrections';
import { BookingDetail, BookingList, BookingNew } from './Bookings';
import { CheckInDetail, CheckInList, CheckInNew } from './CheckIns';
import { EnquiryDetail, EnquiryList, EnquiryNew, FollowUpList } from './Enquiries';
import { ResidentDetail, ResidentList, ResidentNew } from './Residents';
import { correctionsLinks, opsLinks, parseOpsRoute, type OpsRoute } from './opsRoute';

import { ResidentProfile } from './ResidentProfile';
import {
  PropertyList,
  PropertyNew,
  PropertyDetail,
  FloorList,
  FloorNew,
  FloorDetail,
  RoomList,
  RoomNew,
  RoomDetail,
  BedList,
  BedNew,
  BedDetail,
} from './Inventory';

const TABS: Array<{ href: string; label: string; match: OpsRoute['name'][] }> = [
  {
    href: opsLinks.residents,
    label: 'Residents',
    match: ['residents', 'resident-new', 'resident', 'resident-profile'],
  },
  {
    href: opsLinks.enquiries,
    label: 'Enquiries',
    match: ['enquiries', 'enquiry-new', 'enquiry', 'overdue-follow-ups', 'upcoming-follow-ups'],
  },
  { href: opsLinks.bookings, label: 'Bookings', match: ['bookings', 'booking-new', 'booking'] },
  { href: opsLinks.admissions, label: 'Admissions', match: ['admissions', 'admission'] },
  { href: opsLinks.checkIns, label: 'Check-ins', match: ['check-ins', 'check-in-new', 'check-in'] },
  {
    href: correctionsLinks.list,
    label: 'Corrections',
    match: ['corrections', 'correction-new', 'correction', 'finance-reviews'],
  },
];

export function OpsShell() {
  const [route, setRoute] = useState<OpsRoute>(() => parseOpsRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseOpsRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const inventory = /^(propert|floor|room|bed)/.test(route.name);
  return (
    <div className="fin-shell">
      <div className="fin-page-head">
        <p className="eyebrow violet">OPERATIONS</p>
        <h1>{inventory ? 'Property inventory' : 'Residents and stays'}</h1>
        <p className="fin-lede">
          {inventory
            ? 'Properties, floors, rooms and beds for your organization.'
            : 'Enquiries, residents, bookings, admissions and check-ins for your property.'}
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
      <div key={window.location.hash}>
        {route.name === 'corrections' ? (
          <>
            <CorrectionList />
            <p>
              <a href={correctionsLinks.financeReviews}>Billing reviews</a>
            </p>
          </>
        ) : null}
        {route.name === 'correction-new' ? <CorrectionNew /> : null}
        {route.name === 'correction' ? <CorrectionDetail key={route.id} id={route.id} /> : null}
        {route.name === 'finance-reviews' ? <FinanceReviews /> : null}
        {route.name === 'residents' ? <ResidentList /> : null}
        {route.name === 'resident-profile' ? (
          <ResidentProfile key={route.id} id={route.id} />
        ) : null}
        {route.name === 'resident-new' ? <ResidentNew /> : null}
        {route.name === 'resident' ? <ResidentDetail key={route.id} id={route.id} /> : null}
        {route.name === 'enquiries' ? <EnquiryList /> : null}
        {route.name === 'enquiry-new' ? <EnquiryNew /> : null}
        {route.name === 'enquiry' ? <EnquiryDetail id={route.id} /> : null}
        {route.name === 'overdue-follow-ups' ? <FollowUpList upcoming={false} /> : null}
        {route.name === 'upcoming-follow-ups' ? <FollowUpList upcoming /> : null}
        {route.name === 'bookings' ? <BookingList /> : null}
        {route.name === 'booking' ? <BookingDetail key={route.id} id={route.id} /> : null}
        {route.name === 'booking-new' ? <BookingNew /> : null}
        {route.name === 'admissions' ? <AdmissionPanel /> : null}
        {route.name === 'admission' ? <AdmissionDetail id={route.id} /> : null}
        {route.name === 'check-ins' ? <CheckInList /> : null}
        {route.name === 'check-in-new' ? <CheckInNew /> : null}
        {route.name === 'check-in' ? <CheckInDetail id={route.id} /> : null}
        {route.name === 'properties' ? <PropertyList /> : null}
        {route.name === 'property-new' ? <PropertyNew /> : null}
        {route.name === 'property' ? <PropertyDetail id={route.id} /> : null}
        {route.name === 'floors' ? <FloorList propertyId={route.propertyId} /> : null}
        {route.name === 'floor-new' ? <FloorNew propertyId={route.propertyId} /> : null}
        {route.name === 'floor' ? (
          <FloorDetail propertyId={route.propertyId} id={route.id} />
        ) : null}
        {route.name === 'rooms' ? <RoomList propertyId={route.propertyId} /> : null}
        {route.name === 'room-new' ? <RoomNew propertyId={route.propertyId} /> : null}
        {route.name === 'room-bulk' ? <BulkRooms propertyId={route.propertyId} /> : null}
        {route.name === 'room' ? <RoomDetail propertyId={route.propertyId} id={route.id} /> : null}
        {route.name === 'beds' ? <BedList roomId={route.roomId} /> : null}
        {route.name === 'bed-new' ? <BedNew roomId={route.roomId} /> : null}
        {route.name === 'bed' ? <BedDetail roomId={route.roomId} id={route.id} /> : null}
      </div>
    </div>
  );
}
