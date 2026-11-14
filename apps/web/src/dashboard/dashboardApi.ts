// Client and response types for GET /properties/:propertyId/dashboard (frozen plan, section 5.4).
// The organization is never sent from the browser: the server derives it from the session.
import { qs, request, unwrap, type ApiResponse } from '../ops/opsApi';

/** A 2-decimal money string from the server. Never parsed for arithmetic here. */
export type Money = string;

export interface BedPlaceView {
  bedId: string;
  bedLabel: string;
  roomLabel: string;
  floorLabel: string;
}
export interface UpcomingArrival extends BedPlaceView {
  bookingId: string;
  residentId: string;
  residentName: string;
  startDate: string;
  endDate: string;
  admissionStatus: 'NONE' | 'PENDING' | 'ADMITTED' | 'CANCELLED' | null;
}
export interface StayEnding extends BedPlaceView {
  checkInId: string;
  bookingId: string;
  residentId: string;
  residentName: string;
  checkInAt: string;
  endDate: string;
}
export interface PastEndStay extends StayEnding {
  daysPast: number;
}
export interface AdmissionItem extends BedPlaceView {
  admissionId: string;
  bookingId: string;
  residentId: string;
  residentName: string;
  admissionDate: string;
}
export interface DepartureItem extends BedPlaceView {
  checkOutId: string;
  checkInId: string;
  bookingId: string;
  residentId: string;
  residentName: string;
  checkOutAt: string;
  reason: string | null;
}
export interface BookingItem extends BedPlaceView {
  bookingId: string;
  residentId: string;
  residentName: string;
  startDate: string;
  endDate: string;
  status: 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
}
export interface PaymentItem {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  residentId: string;
  residentName: string;
  amount: Money;
  method: 'CASH' | 'UPI' | 'BANK_TRANSFER';
  receivedAt: string;
  reversed: boolean;
}
export interface Unattributed {
  count: number;
  invoiced: Money;
  collected: Money;
  outstanding: Money;
  overdue: Money;
}
export type ActivityKind =
  | 'booking_created'
  | 'admission_recorded'
  | 'check_in'
  | 'check_out'
  | 'payment_received';
export interface ActivityItem {
  kind: ActivityKind;
  occurredAt: string;
  /** RECORD_CREATED: when the row was created. EVENT: the business time the row states. */
  timeBasis: 'RECORD_CREATED' | 'EVENT';
  refId: string;
  residentId: string;
  residentName: string;
  bedId: string | null;
  bedLabel: string | null;
  roomLabel: string | null;
  amount: Money | null;
  reversed: boolean | null;
}
export interface FloorInventory {
  floorId: string;
  label: string;
  ordinal: number;
  beds: number;
  occupiedBeds: number;
  availableBeds: number;
  outOfServiceBeds: number;
}
export interface Inventory {
  rooms: number;
  beds: number;
  occupiedBeds: number;
  availableBeds: number;
  outOfServiceBeds: number;
  occupancyPercent: number;
  byFloor: FloorInventory[];
  anomalies: { occupiedOutOfService: number; stayNeedsReview: number };
}
export interface Tenants {
  activeTenants: number;
  upcomingCheckIns: { count: number; items: UpcomingArrival[] } | null;
  upcomingCheckOuts: { count: number; items: StayEnding[] };
  pastEndDate: { count: number; items: PastEndStay[] };
  recentAdmissions: AdmissionItem[] | null;
  recentDepartures: DepartureItem[];
}
export interface Bookings {
  confirmedUpcoming: { count: number; items: UpcomingArrival[] };
  committedBeds: number;
  recent: BookingItem[];
}
export interface Finance {
  invoiced: Money;
  collected: Money;
  monthUnpaid: Money;
  outstanding: Money;
  overdue: { count: number; amount: Money };
  pendingPayments: { count: number; amount: Money };
  recentPayments: PaymentItem[];
  unattributed: Unattributed | null;
}
export interface Dashboard {
  property: { id: string; code: string; name: string };
  asOf: string;
  today: string;
  month: string;
  days: number;
  windows: {
    upcoming: { from: string; toExclusive: string };
    recent: { from: string; to: string };
  };
  access: {
    tenants: boolean;
    upcomingCheckIns: boolean;
    recentAdmissions: boolean;
    bookings: boolean;
    finance: boolean;
    activity: boolean;
  };
  inventory: Inventory;
  tenants: Tenants | null;
  bookings: Bookings | null;
  finance: Finance | null;
  activity: ActivityItem[] | null;
}

export const dashboardApi = {
  get: (propertyId: string, params: { month?: string; days?: number } = {}) =>
    request<ApiResponse<Dashboard>>(
      'GET',
      `/properties/${encodeURIComponent(propertyId)}/dashboard${qs(params)}`,
    ).then(unwrap),
};
