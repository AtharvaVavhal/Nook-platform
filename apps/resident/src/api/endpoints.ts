import type { ApiClient } from './client.js';
import type {
  Invoice,
  InvoiceDetail,
  OtpRequested,
  Page,
  Payment,
  Profile,
  Receipt,
  RentSummary,
  Stay,
} from './types.js';

/**
 * The complete list of API calls this app makes. Reads are GET only. The writes are the three sign-in/out calls; there is no
 * payment, edit or registration call anywhere. A test asserts this list against the source.
 */
export function createResidentApi(client: ApiClient) {
  const paged = (path: string, page: number, limit: number) =>
    `${path}?page=${page}&limit=${limit}`;
  return {
    requestOtp: (phoneE164: string) =>
      client.post<OtpRequested>(
        '/resident-auth/otp/request',
        { phone: phoneE164 },
        { authenticated: false },
      ),
    // The API issues a fresh CSRF value at every sign-in and drops it at sign-out, so a token cached from one session must never be
    // carried into the next: it is forgotten at each boundary and fetched again when it is next needed.
    verifyOtp: async (phoneE164: string, code: string) => {
      const result = await client.post<{ authenticated: true }>(
        '/resident-auth/otp/verify',
        { phone: phoneE164, code },
        { authenticated: false },
      );
      client.clearCsrf();
      return result;
    },
    logout: async () => {
      const result = await client.post<{ loggedOut: true }>('/resident-auth/logout', undefined, {
        csrf: true,
      });
      client.clearCsrf();
      return result;
    },

    profile: (signal?: AbortSignal) => client.get<Profile>('/me', signal),
    stay: (signal?: AbortSignal) => client.get<Stay>('/me/stay', signal),
    rentSummary: (signal?: AbortSignal) => client.get<RentSummary>('/me/rent-summary', signal),
    invoices: (page: number, limit: number, signal?: AbortSignal) =>
      client.get<Page<Invoice>>(paged('/me/invoices', page, limit), signal),
    invoice: (id: string, signal?: AbortSignal) =>
      client.get<InvoiceDetail>(`/me/invoices/${encodeURIComponent(id)}`, signal),
    payments: (page: number, limit: number, signal?: AbortSignal) =>
      client.get<Page<Payment>>(paged('/me/payments', page, limit), signal),
    receipt: (paymentId: string, signal?: AbortSignal) =>
      client.get<Receipt>(`/me/receipts/${encodeURIComponent(paymentId)}`, signal),
  };
}

export type ResidentApi = ReturnType<typeof createResidentApi>;
