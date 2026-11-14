/**
 * Response contract of GET /api/v1/properties/:propertyId/dashboard (frozen plan, section 5.4).
 * Dates are IST calendar dates `YYYY-MM-DD`, instants are ISO-8601 UTC strings, `Money` is a 2-decimal string
 * produced from Decimal sums (never a float).
 */
export type Money = string;

export interface DashboardResponse {
  data: Dashboard;
}

export interface DashboardWindowsView {
  /** [today, today + days): `toExclusive` is not part of the window. */
  upcoming: { from: string; toExclusive: string };
  /** (today - days, today]: both ends inclusive. */
  recent: { from: string; to: string };
}

export interface DashboardAccessView {
  tenants: boolean;
  upcomingCheckIns: boolean;
  recentAdmissions: boolean;
  bookings: boolean;
  finance: boolean;
  activity: boolean;
}

export interface Dashboard {
  property: { id: string; code: string; name: string };
  asOf: string;
  today: string;
  month: string;
  days: number;
  windows: DashboardWindowsView;
  access: DashboardAccessView;
  inventory: Inventory;
  tenants: Tenants | null;
  bookings: Bookings | null;
  finance: Finance | null;
  activity: ActivityItem[] | null;
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
  /** null when the caller lacks `resident.read`: the event is shown, the resident is not identified. */
  residentId: string | null;
  residentName: string | null;
  bedId: string | null;
  bedLabel: string | null;
  roomLabel: string | null;
  amount: Money | null;
  reversed: boolean | null;
}
