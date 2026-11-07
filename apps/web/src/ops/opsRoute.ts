export type OpsRoute =
  | { name: 'residents' }
  | { name: 'resident-new' }
  | { name: 'resident'; id: string }
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
  | { name: 'property'; id: string }
  | { name: 'floors'; propertyId: string }
  | { name: 'floor'; propertyId: string; id: string }
  | { name: 'rooms'; propertyId: string }
  | { name: 'room'; propertyId: string; id: string }
  | { name: 'beds'; roomId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = [
  'residents',
  'enquiries',
  'bookings',
  'admissions',
  'check-ins',
  'properties',
  'floors',
  'rooms',
  'overdue-follow-ups',
  'upcoming-follow-ups',
];

export function isOpsHash(hash: string): boolean {
  return SECTIONS.some((s) => hash === `#${s}` || hash.startsWith(`#${s}/`));
}

export function parseOpsRoute(hash: string): OpsRoute {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  const [first, second, third] = parts;
  if (first === 'residents') {
    if (second === 'new') return { name: 'resident-new' };
    if (second && UUID.test(second)) return { name: 'resident', id: second };
    return { name: 'residents' };
  }
  if (first === 'enquiries') {
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
    if (second && UUID.test(second)) return { name: 'property', id: second };
    return { name: 'properties' };
  }
  if (first === 'floors') {
    if (second && UUID.test(second)) return { name: 'floor', propertyId: second, id: third! };
    if (second && UUID.test(second)) return { name: 'floors', propertyId: second };
    return { name: 'properties' };
  }
  if (first === 'rooms') {
    if (second && UUID.test(second)) return { name: 'rooms', propertyId: second };
    if (second && third && UUID.test(third))
      return { name: 'room', propertyId: second!, id: third };
    return { name: 'properties' };
  }
  return { name: 'residents' };
}

export const opsLinks = {
  residents: '#residents',
  residentNew: '#residents/new',
  resident: (id: string) => `#residents/${id}`,
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
  property: (id: string) => `#properties/${id}`,
  floors: (propertyId: string) => `#floors/${propertyId}`,
  floor: (propertyId: string, id: string) => `#floors/${propertyId}/${id}`,
  rooms: (propertyId: string) => `#rooms/${propertyId}`,
  room: (propertyId: string, id: string) => `#rooms/${propertyId}/${id}`,
  beds: (roomId: string) => `#beds/${roomId}`,
};
