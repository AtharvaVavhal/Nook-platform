// Finance API client. The organization is never sent from the browser: the server derives it
// from the session. Money values are decimal strings and are only ever formatted here, never
// added or compared as JavaScript numbers.
import { API_BASE, csrf, notifyPasswordChangeRequired, notifyUnauthorized } from '../apiConfig';
import { accessFailureMessage, isPasswordChangeRequired, isSecurityRefusal } from '../accessErrors';
import { serverFailureMessage } from '../errorReference';

export type InvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'OVERDUE'
  | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER';

export interface Invoice {
  id: string;
  number: string;
  residentId: string;
  residentName: string;
  bookingId: string | null;
  periodStart: string;
  periodEnd: string;
  amount: string;
  paidAmount: string;
  /** Credits applied to the invoice (zero or negative). */
  adjustmentTotal: string;
  /** Cash actually held: paid amount net of reversals, excluding credits. */
  cashReceived: string;
  balance: string;
  status: InvoiceStatus;
  storedStatus: InvoiceStatus;
  isOverdue: boolean;
  daysOverdue: number;
  dueDate: string;
  issuedAt: string | null;
  notes: string | null;
}

export interface Payment {
  id: string;
  invoiceId: string;
  receiptNumber: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: string;
  notes: string | null;
  correctsPaymentId?: string | null;
  /** Recorded by the database when the payment was made; null on payments that pre-date the snapshot. */
  creditTotalAtPayment?: string | null;
  balanceAfterPayment?: string | null;
  reversed?: boolean;
  reversal?: { id: string; reason: string; reversedAt: string; reversedBy: string | null } | null;
}

export interface Adjustment {
  id: string;
  invoiceId: string;
  amount: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

export interface CorrectionItem {
  type: 'PAYMENT_REVERSAL' | 'INVOICE_CREDIT';
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentId: string | null;
  amount: string;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface VoidRecord {
  id: string;
  reason: string;
  voidedAt: string;
  voidedBy: string | null;
  previousStatus: InvoiceStatus;
  amountAtVoid: string;
}

export interface InvoiceDetailData extends Invoice {
  payments: Payment[];
  adjustments: Adjustment[];
  /** Present once the invoice has been voided through a void record. */
  void: VoidRecord | null;
  /** Cancelled before void records existed: kept as it was, with no reason or actor on record. */
  legacyCancelled: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface OutstandingData extends Paged<Invoice> {
  totals: {
    outstandingAmount: string;
    outstandingCount: number;
    overdueAmount: string;
    overdueCount: number;
  };
}

export interface MonthReport {
  month: string;
  invoiced: string;
  collected: string;
  outstanding: string;
  overdue: string;
  invoiceCount: number;
  paymentCount: number;
}

export interface ReceiptData {
  organizationName: string;
  invoice: {
    id: string;
    number: string;
    residentName: string;
    periodStart: string;
    periodEnd: string;
    amount: string;
    paidAmount: string;
    balance: string;
    status: InvoiceStatus;
  };
  receipts: Array<{
    receiptNumber: string;
    paymentId: string;
    amount: string;
    method: PaymentMethod;
    reference: string | null;
    receivedAt: string;
    notes: string | null;
    balanceAfterPayment: string;
    /** Credits applied when the payment was made; null when the receipt is derived. */
    creditTotalAtPayment: string | null;
    /** `recorded` figures were stored when the payment was made; `derived` ones are recomputed (older payments). */
    balanceSource: 'recorded' | 'derived';
    reversed: boolean;
    reversedAt: string | null;
  }>;
}

export class FinanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await csrf.request(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    const payload = await response.json().catch(() => ({}));
    const message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
    if (isPasswordChangeRequired(response.status, payload.code)) notifyPasswordChangeRequired();
    throw new FinanceApiError(
      response.status === 401
        ? 'Please sign in to view finance records.'
        : isSecurityRefusal(response.status, payload.code)
          ? 'This request was refused for security reasons. Refresh the page and try again.'
          : (serverFailureMessage(response.status, response.headers.get('x-request-id')) ??
            (message || accessFailureMessage(response.status, payload.code)) ??
            `Request failed (${response.status})`),
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const financeApi = {
  listInvoices: (params: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    month?: string;
    residentId?: string;
  }) => request<Paged<Invoice>>('GET', `/finance/invoices${qs(params)}`),
  voidInvoice: (invoiceId: string, reason: string) =>
    request<{ invoice: Invoice; void: VoidRecord }>('POST', `/finance/invoices/${invoiceId}/void`, {
      reason,
    }),
  reversePayment: (paymentId: string, reason: string) =>
    request<{ payment: Payment; invoice: Invoice }>(
      'POST',
      `/finance/payments/${paymentId}/reverse`,
      { reason },
    ),
  adjustInvoice: (invoiceId: string, amount: string, reason: string) =>
    request<{ adjustment: Adjustment; invoice: Invoice }>(
      'POST',
      `/finance/invoices/${invoiceId}/adjustments`,
      { amount, reason },
    ),
  corrections: (params: { invoiceId?: string; limit?: number } = {}) =>
    request<{ items: CorrectionItem[]; total: number }>('GET', `/finance/corrections${qs(params)}`),
  getInvoice: (id: string) => request<InvoiceDetailData>('GET', `/finance/invoices/${id}`),
  createDraft: (body: {
    residentId: string;
    /** Required: the invoice amount always comes from the booking's monthly price. */
    bookingId: string;
    month: string;
    dueDate?: string;
    notes?: string;
  }) => request<Invoice>('POST', '/finance/invoices', body),
  issue: (id: string) => request<Invoice>('POST', `/finance/invoices/${id}/issue`, {}),
  generateMonthly: (body: { month: string; dueDate?: string; issue?: boolean }) =>
    request<{
      month: string;
      created: number;
      skippedExisting: number;
      skippedZeroPrice: number;
      /** Bookings with a billable stay in the month: one invoice each (a bed transfer is two bookings). */
      eligibleBookings: number;
      eligibleResidents: number;
      invoices: Invoice[];
    }>('POST', '/finance/invoices/generate-monthly', body),
  recordPayment: (
    idempotencyKey: string,
    body: {
      invoiceId: string;
      amount: string;
      method: PaymentMethod;
      reference?: string;
      receivedAt?: string;
      notes?: string;
      correctsPaymentId?: string;
    },
  ) =>
    request<{ payment: Payment; invoice: Invoice; idempotentReplay: boolean }>(
      'POST',
      '/finance/payments',
      body,
      { 'Idempotency-Key': idempotencyKey },
    ),
  outstanding: (params: {
    page?: number;
    limit?: number;
    overdueOnly?: boolean;
    residentId?: string;
  }) =>
    request<OutstandingData>(
      'GET',
      `/finance/outstanding${qs({ ...params, overdueOnly: params.overdueOnly ? 'true' : undefined })}`,
    ),
  report: (params: { month?: string; months?: number }) =>
    request<{ month: string; months: MonthReport[] }>(
      'GET',
      `/finance/reports/monthly${qs(params)}`,
    ),
  receipt: (invoiceId: string, paymentId?: string) =>
    request<ReceiptData>('GET', `/finance/invoices/${invoiceId}/receipt${qs({ paymentId })}`),
  searchResidents: (search: string) =>
    request<Paged<{ id: string; firstName: string; lastName: string }>>(
      'GET',
      `/residents${qs({ search, limit: 10 })}`,
    ),
  residentBookings: (residentId: string, page = 1) =>
    request<
      Paged<{
        id: string;
        monthlyPrice: string | number;
        startDate: string;
        endDate: string;
        status: string;
      }>
    >('GET', `/bookings${qs({ residentId, status: 'CONFIRMED', limit: 100, page })}`),
};
