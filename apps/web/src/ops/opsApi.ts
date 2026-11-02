// Client for the operational APIs (residents, enquiries, bookings, admissions, check-ins).
// The organization is never sent from the browser: the server derives it from the session.
import { API_BASE, csrfToken, notifyUnauthorized } from '../apiConfig';

export class OpsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-csrf-token': csrfToken() } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new OpsApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string | string[];
      code?: string;
    };
    const message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
    throw new OpsApiError(
      response.status === 401
        ? 'Your session has ended. Please sign in again.'
        : response.status === 403
          ? 'This request was refused for security reasons. Refresh the page and try again.'
          : message || `Request failed (${response.status})`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

const qs = (params?: Record<string, string | number | undefined>) => {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};

export interface ApiResponse<T> {
  data: T;
}

function unwrap<T>(response: ApiResponse<T>): T {
  return response.data;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
export interface Resident {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  documentVerificationStatus: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}
export type ResidentInput = Partial<Omit<Resident, 'id' | 'documentVerificationStatus'>>;
export interface FollowUp {
  id: string;
  notes: string;
  followUpAt: string;
  outcome: string | null;
  user?: { displayName: string } | null;
  enquiry?: { id: string; firstName: string; lastName: string } | null;
}
export interface Enquiry {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  source: string;
  status: string;
  notes: string | null;
  expectedMoveInDate: string | null;
  residentId: string | null;
  createdAt: string;
  preferredPropertyId?: string | null;
  preferredRoomType?: string | null;
  expectedDurationOfStay?: number | null;
  numberOfOccupants?: number | null;
  assignedUserId?: string | null;
  property?: { id: string; name: string } | null;
  resident?: { id: string; firstName: string; lastName: string } | null;
  followUps?: FollowUp[];
}
export type EnquiryStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'FOLLOW_UP'
  | 'INTERESTED'
  | 'CONVERTED'
  | 'LOST'
  | 'ARCHIVED';
export type EnquirySource =
  | 'WEBSITE'
  | 'PHONE_CALL'
  | 'WALK_IN'
  | 'REFERRAL'
  | 'SOCIAL_MEDIA'
  | 'OTHER';
export interface EnquiryInput {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  preferredPropertyId?: string;
  preferredRoomType?: string;
  expectedMoveInDate?: string;
  expectedDurationOfStay?: number | undefined;
  numberOfOccupants?: number | undefined;
  source: EnquirySource;
  notes?: string;
  assignedUserId?: string;
}
export interface EnquiryUpdateInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  preferredPropertyId?: string;
  preferredRoomType?: string;
  expectedMoveInDate?: string;
  expectedDurationOfStay?: number | undefined;
  numberOfOccupants?: number | undefined;
  source?: EnquirySource;
  notes?: string;
  status?: EnquiryStatus;
  assignedUserId?: string;
}
export interface FollowUpInput {
  notes: string;
  followUpAt: string;
  outcome?: string;
}
export interface Bed {
  id: string;
  label: string;
  operationalStatus: 'IN_SERVICE' | 'OUT_OF_SERVICE';
  outOfServiceReason: string | null;
  room?: { label: string } | null;
  price: string | number;
}
export interface Room {
  id: string;
  label: string;
  floorId: string;
  floor?: { label: string } | null;
}
export interface Floor {
  id: string;
  label: string;
  ordinal: number;
  propertyId: string;
}
export interface Property {
  id: string;
  code: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface FloorInput {
  label: string;
  ordinal: number;
}
export interface RoomInput {
  floorId: string;
  label: string;
}
export interface BedInput {
  label: string;
  operationalStatus: 'IN_SERVICE' | 'OUT_OF_SERVICE';
  outOfServiceReason?: string;
}
export interface PropertyInput {
  code: string;
  name: string;
}
export interface InventorySummary {
  properties: number;
  floors: number;
  rooms: number;
  beds: number;
  bedsInService: number;
  bedsOutOfService: number;
  bedsArchived: number;
}

export interface Booking {
  id: string;
  residentId: string;
  bedId: string;
  startDate: string;
  endDate: string;
  monthlyPrice: string | number;
  status: 'CONFIRMED' | 'CANCELLED';
  paymentStatus: 'PENDING' | 'PAID' | 'OVERDUE' | 'REFUNDED';
  notes: string | null;
  resident?: { firstName: string; lastName: string };
  bed?: Bed;
  createdAt: string;
  updatedAt: string;
}
export interface BookingInput {
  residentId: string;
  bedId: string;
  startDate: string;
  endDate: string;
  monthlyPrice: string | number;
  notes?: string | null;
}
export interface BookingUpdateInput {
  startDate?: string;
  endDate?: string;
  monthlyPrice?: string | number;
  notes?: string | null;
  status?: 'CONFIRMED' | 'CANCELLED';
  paymentStatus?: 'PENDING' | 'PAID' | 'OVERDUE' | 'REFUNDED';
}
export interface Admission {
  id: string;
  bookingId: string;
  residentId: string;
  bedId: string;
  propertyId?: string | null;
  roomId?: string | null;
  admissionDate: string;
  status: 'PENDING' | 'ADMITTED' | 'CANCELLED';
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  booking?: {
    id: string;
    monthlyPrice: string | number;
    status: string;
    paymentStatus: string;
    startDate: string;
    endDate: string;
  };
  resident?: { firstName: string; lastName: string; phone?: string | null; email?: string | null };
  bed?: {
    label: string;
    room?: { label: string } | null;
    propertyId?: string | null;
    roomId?: string | null;
  };
  property?: { id: string; name: string; code: string } | null;
  room?: { label: string; propertyId?: string | null } | null;
}
export interface AdmissionInput {
  bookingId: string;
  admissionDate: string;
  notes?: string | null;
}
export interface AdmissionUpdateInput {
  admissionDate?: string;
  notes?: string | null;
  status?: 'PENDING' | 'ADMITTED' | 'CANCELLED';
  propertyId?: string | null;
  roomId?: string | null;
}
export interface CheckIn {
  id: string;
  admissionId: string;
  residentId: string;
  bedId: string;
  bookingId: string;
  checkInAt: string;
  status: 'ACTIVE' | 'CHECKED_OUT';
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  resident?: { firstName: string; lastName: string; phone?: string | null; email?: string | null };
  bed?: { label: string; room?: { label: string } | null };
  booking?: { id: string; startDate: string; endDate: string; status: string };
  admission?: { id: string; status: string; admissionDate: string };
  /** Present once the resident has checked out; the history of the stay is never overwritten. */
  checkOut?: CheckOut | null;
}
export interface CheckOut {
  id: string;
  checkInId: string;
  residentId: string;
  bedId: string;
  bookingId: string;
  checkOutAt: string;
  reason?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}
/** `checkInAt` is optional: the server uses the current time. A value without a zone is Asia/Kolkata time. */
export interface CheckInInput {
  admissionId: string;
  checkInAt?: string;
  notes?: string | null;
}
export interface CheckOutInput {
  checkOutAt?: string;
  reason?: string | null;
  notes?: string | null;
}
export interface Occupancy {
  activeCheckIns: number;
  occupiedBeds: number;
  totalBeds: number;
  occupiedBedIds: string[];
}

export const opsApi = {
  residents: {
    list: (p: { search?: string; status?: string; page?: number; limit?: number }) =>
      request<Paged<Resident>>('GET', `/residents${qs(p)}`),
    get: (id: string) => request<Resident>('GET', `/residents/${id}`),
    create: (body: ResidentInput) => request<Resident>('POST', '/residents', body),
    update: (id: string, body: ResidentInput) => request<Resident>('PUT', `/residents/${id}`, body),
  },
  inventory: {
    properties: {
      list: () => request<ApiResponse<Property[]>>('GET', '/properties').then(unwrap),
      get: (id: string) => request<ApiResponse<Property>>('GET', `/properties/${id}`).then(unwrap),
      create: (body: PropertyInput) =>
        request<ApiResponse<Property>>('POST', '/properties', body).then(unwrap),
      update: (id: string, body: Partial<PropertyInput>) =>
        request<ApiResponse<Property>>('PATCH', `/properties/${id}`, body).then(unwrap),
      archive: (id: string) =>
        request<ApiResponse<Property>>('POST', `/properties/${id}/archive`).then(unwrap),
    },
    floors: {
      list: (propertyId: string) =>
        request<ApiResponse<Floor[]>>('GET', `/properties/${propertyId}/floors`).then(unwrap),
      create: (propertyId: string, body: FloorInput) =>
        request<ApiResponse<Floor>>('POST', `/properties/${propertyId}/floors`, body).then(unwrap),
      update: (id: string, body: Partial<FloorInput>) =>
        request<ApiResponse<Floor>>('PATCH', `/floors/${id}`, body).then(unwrap),
      archive: (id: string) =>
        request<ApiResponse<Floor>>('POST', `/floors/${id}/archive`).then(unwrap),
    },
    rooms: {
      list: (propertyId: string, params?: { floorId?: string; q?: string }) =>
        request<ApiResponse<Room[]>>('GET', `/properties/${propertyId}/rooms${qs(params)}`).then(
          unwrap,
        ),
      create: (propertyId: string, body: RoomInput) =>
        request<ApiResponse<Room>>('POST', `/properties/${propertyId}/rooms`, body).then(unwrap),
      update: (id: string, body: { label?: string }) =>
        request<ApiResponse<Room>>('PATCH', `/rooms/${id}`, body).then(unwrap),
      archive: (id: string) =>
        request<ApiResponse<Room>>('POST', `/rooms/${id}/archive`).then(unwrap),
    },
    beds: {
      list: (roomId: string) =>
        request<ApiResponse<Bed[]>>('GET', `/rooms/${roomId}/beds`).then(unwrap),
      create: (roomId: string, body: BedInput) =>
        request<ApiResponse<Bed>>('POST', `/rooms/${roomId}/beds`, body).then(unwrap),
      update: (id: string, body: Partial<BedInput>) =>
        request<ApiResponse<Bed>>('PATCH', `/beds/${id}`, body).then(unwrap),
      archive: (id: string) =>
        request<ApiResponse<Bed>>('POST', `/beds/${id}/archive`).then(unwrap),
    },
    summary: () => request<ApiResponse<InventorySummary>>('GET', '/inventory/summary').then(unwrap),
  },
  enquiries: {
    list: (p: {
      search?: string;
      status?: string;
      source?: string;
      propertyId?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      limit?: number;
    }) => request<Paged<Enquiry>>('GET', `/enquiries${qs(p)}`),
    get: (id: string) => request<Enquiry>('GET', `/enquiries/${id}`),
    create: (body: EnquiryInput) => request<Enquiry>('POST', '/enquiries', body),
    update: (id: string, body: EnquiryUpdateInput) =>
      request<Enquiry>('PUT', `/enquiries/${id}`, body),
    archive: (id: string) => request<Enquiry>('DELETE', `/enquiries/${id}`),
    followUps: (id: string) => request<FollowUp[]>('GET', `/enquiries/${id}/follow-ups`),
    addFollowUp: (id: string, body: FollowUpInput) =>
      request<FollowUp>('POST', `/enquiries/${id}/follow-ups`, body),
    convert: (id: string, residentData?: Record<string, unknown>) =>
      request<{ enquiry: Enquiry; resident: Resident }>(
        'POST',
        `/enquiries/${id}/convert`,
        residentData ?? {},
      ),
    overdue: () => request<FollowUp[]>('GET', `/enquiries/follow-ups/overdue`),
    upcoming: (days?: number) =>
      request<FollowUp[]>('GET', `/enquiries/follow-ups/upcoming${qs({ days })}`),
  },
  bookings: {
    list: (p: {
      search?: string;
      status?: string;
      paymentStatus?: string;
      residentId?: string;
      bedId?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      limit?: number;
    }) => request<Paged<Booking>>('GET', `/bookings${qs(p)}`),
    get: (id: string) => request<Booking>('GET', `/bookings/${id}`),
    availableBeds: (p: { startDate: string; endDate: string; propertyId?: string }) =>
      request<Bed[]>('GET', `/bookings/beds/available${qs(p)}`),
    create: (body: BookingInput) => request<Booking>('POST', '/bookings', body),
    update: (id: string, body: BookingUpdateInput) =>
      request<Booking>('PUT', `/bookings/${id}`, body),
    cancel: (id: string) => request<Booking>('PUT', `/bookings/${id}`, { status: 'CANCELLED' }),
  },
  admissions: {
    list: (p: {
      status?: string;
      residentId?: string;
      bookingId?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      limit?: number;
    }) => request<Paged<Admission>>('GET', `/admissions${qs(p)}`),
    get: (id: string) => request<Admission>('GET', `/admissions/${id}`),
    create: (body: AdmissionInput) => request<Admission>('POST', '/admissions', body),
    update: (id: string, body: AdmissionUpdateInput) =>
      request<Admission>('PUT', `/admissions/${id}`, body),
    cancel: (id: string) => request<Admission>('DELETE', `/admissions/${id}`),
    setStatus: (id: string, status: 'PENDING' | 'ADMITTED' | 'CANCELLED') =>
      request<Admission>('PUT', `/admissions/${id}`, { status }),
  },
checkIns: {
    list: (p: {
      search?: string;
      status?: string;
      residentId?: string;
      bedId?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      limit?: number;
    }) => request<Paged<CheckIn>>('GET', `/check-ins${qs(p)}`),
    get: (id: string) => request<CheckIn>('GET', `/check-ins/${id}`),
    occupancy: () => request<Occupancy>('GET', '/check-ins/occupancy'),
    checkIn: (body: CheckInInput) => request<CheckIn>('POST', '/check-ins', body),
    checkOut: (id: string, body: CheckOutInput) =>
      request<CheckOut>('POST', `/check-ins/${id}/check-out`, body),
  },
};
