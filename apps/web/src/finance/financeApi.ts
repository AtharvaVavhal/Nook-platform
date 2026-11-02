// Finance API client. The organization is never sent from the browser: the server derives it
// from the session. Money values are decimal strings and are only ever formatted here, never
// added or compared as JavaScript numbers.
import { API_BASE, csrfToken, notifyUnauthorized } from '../apiConfig';

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

export interface InvoiceDetailData extends Invoice {
  payments: Payment[];
  adjustments: Adjustment[];
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
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method === 'POST' ? { 'x-csrf-token': csrfToken() } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    const payload = await response.json().catch(() => ({}));
    const message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
    throw new FinanceApiError(
      response.status === 401
        ? 'Please sign in to view finance records.'
        : response.status === 403
          ? 'This request was refused for security reasons. Refresh the page and try again.'
          : message || `Request failed (${response.status})`,
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
  }) => request<Paged<Invoice>>('GET', `/finance/invoices${qs(params)}`),
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
    bookingId?: string;
    month: string;
    amount?: string;
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
  outstanding: (params: { page?: number; limit?: number; overdueOnly?: boolean }) =>
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
  residentBookings: (residentId: string) =>
    request<
      Paged<{
        id: string;
        monthlyPrice: string | number;
        startDate: string;
        endDate: string;
        status: string;
      }>
    >('GET', `/bookings${qs({ residentId, status: 'CONFIRMED', limit: 20 })}`),
};
