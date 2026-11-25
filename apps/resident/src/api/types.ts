/** Response shapes of the Phase 2 resident self-service API (docs/resident-portal/PHASE_2_RESIDENT_APIS.md). Money is a two-decimal string. */
export interface Page<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface Profile {
  displayName: string;
  firstName: string;
  lastName: string;
  phone: string; // masked by the API
  accountStatus: string;
  residentStatus: string;
  organizationName: string;
  memberSince: string;
}

export type StayStatus = 'CURRENT' | 'UPCOMING' | 'COMPLETED' | 'NONE' | 'UNDER_REVIEW';
export interface CurrentStay {
  hostelName: string;
  organizationName: string;
  roomNumber: string;
  bedNumber: string;
  checkInDate: string;
  expectedCheckOutDate: string;
  monthlyRent: string;
  stayStatus: string;
}
export interface UpcomingStay {
  hostelName: string;
  roomNumber: string;
  bedNumber: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
  stage: string;
}
export interface Stay {
  status: StayStatus;
  current: CurrentStay | null;
  upcoming: UpcomingStay[];
  lastStay: { checkedOutAt: string } | null;
}

export interface RentSummary {
  totalInvoiced: string;
  totalPaid: string;
  outstanding: string;
  overdue: string;
  nextDueDate: string | null;
  status: string;
  invoiceCount: number;
}

export interface Invoice {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string | null;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  status: string;
}

export interface InvoicePayment {
  id: string;
  receiptNumber: string;
  paidAt: string;
  amount: string;
  method: string;
  reference: string | null;
  status: string;
}
export interface InvoiceDetail extends Invoice {
  payments: InvoicePayment[];
}
export interface Payment extends InvoicePayment {
  invoice: { id: string; number: string };
}

export interface Receipt {
  receiptNumber: string;
  issuedBy: string;
  issuedTo: string;
  invoice: {
    number: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: string;
    paidAmount: string;
    outstandingAmount: string;
    status: string;
  };
  payment: {
    id: string;
    paidAt: string;
    amount: string;
    method: string;
    reference: string | null;
    status: string;
  };
  balanceAfterPayment: string;
}

export interface OtpRequested {
  requested: true;
  resendAfterSeconds: number;
}
