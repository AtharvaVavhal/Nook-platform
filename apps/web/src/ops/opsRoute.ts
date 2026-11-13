export type OpsRoute =
  | { name: 'residents' }
  | { name: 'corrections' }
  | { name: 'correction-new' }
  | { name: 'correction'; id: string }
  | { name: 'finance-reviews' }
  | { name: 'resident-new' }
  | { name: 'resident'; id: string }
  | { name: 'resident-profile'; id: string }
  | { name: 'enquiries' }
  | { name: 'enquiry-new' }
  | { name: 'enquiry'; id: string }
  | { name: 'overdue-follow-ups' }
  | { name: 'upcoming-follow-ups' }
  | { name: 'bookings' }
  | { name: 'booking'; id: string }
  | { name: 'booking-new' }
  | { name: 'admissions' }
  | { name: 'admission'; id: string }
  | { name: 'check-ins' }
  | { name: 'check-in-new' }
  | { name: 'check-in'; id: string }
  | { name: 'properties' }
  | { name: 'property-new' }
  | { name: 'floor-new'; propertyId: string }
  | { name: 'room-new'; propertyId: string }
  | { name: 'room-bulk'; propertyId: string }
  | { name: 'bed-new'; roomId: string }
  | { name: 'bed'; roomId: string; id: string }
  | { name: 'property'; id: string }
  | { name: 'floors'; propertyId: string }
  | { name: 'floor'; propertyId: string; id: string }
  | { name: 'rooms'; propertyId: string }
  | { name: 'room'; propertyId: string; id: string }
  | { name: 'beds'; roomId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = [
  'residents',
  'corrections',
  'enquiries',
  'bookings',
  'admissions',
  'check-ins',
  'properties',
  'floors',
  'rooms',
  'beds',
  'overdue-follow-ups',
  'upcoming-follow-ups',
];

export function isOpsHash(hash: string): boolean {
  return SECTIONS.some((s) => hash === `#${s}` || hash.startsWith(`#${s}/`));
}

export function parseOpsRoute(hash: string): OpsRoute {
  const parts = (hash.replace(/^#/, '').split('?')[0] ?? '').split('/').filter(Boolean);
  const [first, second, third] = parts;
  if (first === 'residents') {
    if (second === 'new') return { name: 'resident-new' };
    if (second && UUID.test(second)) {
      if (third === 'profile') return { name: 'resident-profile', id: second };
      return { name: 'resident', id: second };
    }
    return { name: 'residents' };
  }
  if (first === 'corrections') {
    if (second === 'new') return { name: 'correction-new' };
    if (second === 'finance-reviews') return { name: 'finance-reviews' };
    if (second && UUID.test(second)) return { name: 'correction', id: second };
    return { name: 'corrections' };
  }
  if (first === 'enquiries') {
    if (second === 'follow-ups' && third === 'overdue') return { name: 'overdue-follow-ups' };
    if (second === 'follow-ups' && third === 'upcoming') return { name: 'upcoming-follow-ups' };
    if (second === 'new') return { name: 'enquiry-new' };
    if (second && UUID.test(second)) return { name: 'enquiry', id: second };
    return { name: 'enquiries' };
  }
  if (first === 'overdue-follow-ups') return { name: 'overdue-follow-ups' };
  if (first === 'upcoming-follow-ups') return { name: 'upcoming-follow-ups' };
  if (first === 'bookings') {
    if (second === 'new') return { name: 'booking-new' };
    if (second && UUID.test(second)) return { name: 'booking', id: second };
    return { name: 'bookings' };
  }
  if (first === 'admissions') {
    if (second && UUID.test(second)) return { name: 'admission', id: second };
    return { name: 'admissions' };
  }
  if (first === 'check-ins') {
    if (second === 'new') return { name: 'check-in-new' };
    if (second && UUID.test(second)) return { name: 'check-in', id: second };
    return { name: 'check-ins' };
  }
  if (first === 'properties') {
    if (second === 'new') return { name: 'property-new' };
    if (second && UUID.test(second)) return { name: 'property', id: second };
    return { name: 'properties' };
  }
  if (first === 'floors' || first === 'rooms') {
    if (!second || !UUID.test(second)) return { name: 'properties' };
    if (first === 'rooms' && third === 'bulk') return { name: 'room-bulk', propertyId: second };
    if (third === 'new')
      return { name: first === 'floors' ? 'floor-new' : 'room-new', propertyId: second };
    if (third && UUID.test(third))
      return { name: first === 'floors' ? 'floor' : 'room', propertyId: second, id: third };
    return { name: first, propertyId: second };
  }
  if (first === 'beds') {
    if (!second || !UUID.test(second)) return { name: 'properties' };
    if (third === 'new') return { name: 'bed-new', roomId: second };
    if (third && UUID.test(third)) return { name: 'bed', roomId: second, id: third };
    return { name: 'beds', roomId: second };
  }
  return { name: 'residents' };
}

export const opsLinks = {
  residents: '#residents',
  residentNew: '#residents/new',
  resident: (id: string) => `#residents/${id}`,
  residentProfile: (id: string) => `#residents/${id}/profile`,
  enquiries: '#enquiries',
  enquiryNew: '#enquiries/new',
  enquiry: (id: string) => `#enquiries/${id}`,
  overdueFollowUps: '#enquiries/follow-ups/overdue',
  upcomingFollowUps: '#enquiries/follow-ups/upcoming',
  bookings: '#bookings',
  bookingNew: '#bookings/new',
  booking: (id: string) => `#bookings/${id}`,
  admissions: '#admissions',
  admission: (id: string) => `#admissions/${id}`,
  checkIns: '#check-ins',
  checkInNew: '#check-ins/new',
  checkIn: (id: string) => `#check-ins/${id}`,
  properties: '#properties',
  propertyNew: '#properties/new',
  floorNew: (propertyId: string) => `#floors/${propertyId}/new`,
  roomNew: (propertyId: string) => `#rooms/${propertyId}/new`,
  roomBulk: (propertyId: string) => `#rooms/${propertyId}/bulk`,
  bedNew: (roomId: string) => `#beds/${roomId}/new`,
  bed: (roomId: string, id: string) => `#beds/${roomId}/${id}`,
  property: (id: string) => `#properties/${id}`,
  floors: (propertyId: string) => `#floors/${propertyId}`,
  floor: (propertyId: string, id: string) => `#floors/${propertyId}/${id}`,
  rooms: (propertyId: string) => `#rooms/${propertyId}`,
  room: (propertyId: string, id: string) => `#rooms/${propertyId}/${id}`,
  beds: (roomId: string) => `#beds/${roomId}`,
};

export const correctionsLinks = {
  list: '#corrections',
  financeReviews: '#corrections/finance-reviews',
  detail: (id: string) => `#corrections/${id}`,
  /** Opens the request form, optionally prefilled with the record (and field) to correct. */
  new: (prefill?: { targetType?: string; targetId?: string; field?: string }) => {
    const search = new URLSearchParams();
    if (prefill?.targetType) search.set('targetType', prefill.targetType);
    if (prefill?.targetId) search.set('targetId', prefill.targetId);
    if (prefill?.field) search.set('field', prefill.field);
    const text = search.toString();
    return text ? `#corrections/new?${text}` : '#corrections/new';
  },
};
