// TEST-ONLY synthetic contract server for the resident portal's browser regression tests. Synthetic data only; never shipped.
// It serves a built copy of the portal and a fake of the documented resident API on ONE origin, mirroring the real cookie and
// CSRF rules (HttpOnly session cookie, CSRF cookie rotated at every sign-in, double-submit check on logout).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';

export interface LogEntry {
  method: string;
  path: string;
  status: number;
  /** For state-changing calls: did the X-CSRF-Token header match the CSRF cookie the browser held? null when no token was sent. */
  csrfMatchesCookie: boolean | null;
}
export interface Behavior {
  /** 'no-cookie' = the code is accepted (200) but no session cookie is ever set, like a browser blocking the cookie. */
  verifyMode: 'ok' | 'no-cookie';
  /** The next GET /me answers this status once, then recovers (simulates a failed session initialisation). */
  meFailsOnce: number | null;
  dataset: 'normal' | 'long';
  resendAfterSeconds: number;
}
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const IDS = {
  invoice: UUID(102),
  receipt: UUID(203),
  longInvoice: UUID(109),
  longReceipt: UUID(209),
};

function data(kind: 'normal' | 'long') {
  const long = kind === 'long';
  const invoice = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    number: long ? 'INV-2026-11-000000000000123456' : 'INV-1002',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    issuedAt: '2026-10-01T04:00:00.000Z',
    dueDate: '2026-11-05',
    totalAmount: long ? '999999999.00' : '8000.00',
    paidAmount: '3000.00',
    outstandingAmount: long ? '876543209.50' : '5000.00',
    status: 'OVERDUE',
    ...over,
  });
  const payment = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    receiptNumber: `RCPT-${id}`,
    paidAt: '2026-11-02T10:15:00.000Z',
    amount: long ? '123456789.50' : '3000.00',
    method: 'UPI',
    reference: '****3210',
    status: 'COMPLETED',
    ...over,
  });
  const inv = invoice(long ? IDS.longInvoice : IDS.invoice);
  const pay = payment(long ? IDS.longReceipt : IDS.receipt);
  return {
    profile: {
      displayName: long ? 'Aarav Krishnamurthy-Venkataraghavan Subramanian-Iyer' : 'Asha Example',
      firstName: long ? 'Aarav-Krishnamurthy-Venkataraghavan' : 'Asha',
      lastName: 'Example',
      phone: '+91******4321',
      accountStatus: 'ACTIVE',
      residentStatus: 'ACTIVE',
      organizationName: long
        ? 'The Extraordinarily Long Named Residential Hostel and Paying Guest Accommodation Company Private Limited'
        : 'Example Hostel Co',
      memberSince: '2026-05-01T09:30:00.000Z',
    },
    stay: { status: 'NONE', current: null, upcoming: [], lastStay: null },
    rent: {
      totalInvoiced: inv.totalAmount,
      totalPaid: inv.paidAmount,
      outstanding: inv.outstandingAmount,
      overdue: inv.outstandingAmount,
      nextDueDate: null,
      status: 'OVERDUE',
      invoiceCount: 1,
    },
    invoice: inv,
    payment: pay,
    receipt: {
      receiptNumber: pay.receiptNumber,
      issuedBy: long
        ? 'The Extraordinarily Long Named Residential Hostel and Paying Guest Accommodation Company Private Limited'
        : 'Example Hostel Co',
      issuedTo: long ? 'Aarav Krishnamurthy-Venkataraghavan Subramanian-Iyer' : 'Asha Example',
      invoice: {
        number: inv.number,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        totalAmount: inv.totalAmount,
        paidAmount: inv.paidAmount,
        outstandingAmount: inv.outstandingAmount,
        status: 'OVERDUE',
      },
      payment: {
        id: pay.id,
        paidAt: pay.paidAt,
        amount: pay.amount,
        method: pay.method,
        reference: pay.reference,
        status: pay.status,
      },
      balanceAfterPayment: inv.outstandingAmount,
    },
  };
}

export async function startFakeApi(distDir: string) {
  const log: LogEntry[] = [];
  const behavior: Behavior = {
    verifyMode: 'ok',
    meFailsOnce: null,
    dataset: 'normal',
    resendAfterSeconds: 2,
  };
  const session = { csrf: null as string | null };
  const cookiesOf = (req: http.IncomingMessage) =>
    Object.fromEntries(
      (req.headers.cookie ?? '')
        .split(';')
        .map((c) => c.trim().split('='))
        .filter((p) => p[0])
        .map(([k, ...v]) => [k, v.join('=')]),
    ) as Record<string, string>;
  const COOKIE = 'Path=/; HttpOnly; SameSite=Strict';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/v1/')) {
      let file = join(distDir, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(distDir, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      return void res.end(readFileSync(file));
    }
    const p = url.pathname.slice('/api/v1'.length);
    const cookies = cookiesOf(req);
    let body = '';
    for await (const chunk of req) body += chunk;
    const entry: LogEntry = {
      method: req.method ?? 'GET',
      path: p + url.search,
      status: 0,
      csrfMatchesCookie: null,
    };
    const header = req.headers['x-csrf-token'];
    if (typeof header === 'string') entry.csrfMatchesCookie = header === cookies.nook_resident_csrf;
    const send = (
      status: number,
      payload: unknown,
      extra: Record<string, string | string[]> = {},
    ) => {
      entry.status = status;
      log.push(entry);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...extra,
      });
      res.end(JSON.stringify(payload));
    };
    const d = data(behavior.dataset);

    if (p === '/resident-auth/csrf') {
      const token = cookies.nook_resident_csrf ?? randomBytes(12).toString('hex');
      return send(
        200,
        { data: { csrfToken: token } },
        { 'Set-Cookie': `nook_resident_csrf=${token}; ${COOKIE}` },
      );
    }
    if (p === '/resident-auth/otp/request' && req.method === 'POST')
      return send(200, {
        data: { requested: true, resendAfterSeconds: behavior.resendAfterSeconds },
      });
    if (p === '/resident-auth/otp/verify' && req.method === 'POST') {
      const { code } = JSON.parse(body || '{}') as { code?: string };
      if (code === '000000') return send(401, { code: 'INVALID_OR_EXPIRED_CODE' });
      if (behavior.verifyMode === 'no-cookie') return send(200, { data: { authenticated: true } });
      session.csrf = randomBytes(12).toString('hex'); // a fresh CSRF value with every sign-in, exactly like the real API
      return send(
        200,
        { data: { authenticated: true } },
        {
          'Set-Cookie': [
            `nook_resident_session=fake; ${COOKIE}`,
            `nook_resident_csrf=${session.csrf}; ${COOKIE}`,
          ],
        },
      );
    }
    if (p === '/resident-auth/logout' && req.method === 'POST') {
      if (!cookies.nook_resident_csrf || header !== cookies.nook_resident_csrf)
        return send(403, { code: 'INVALID_CSRF_TOKEN' });
      return send(
        200,
        { data: { loggedOut: true } },
        {
          'Set-Cookie': [
            `nook_resident_session=; ${COOKIE}; Max-Age=0`,
            `nook_resident_csrf=; ${COOKIE}; Max-Age=0`,
          ],
        },
      );
    }
    if (p.startsWith('/me')) {
      if (cookies.nook_resident_session !== 'fake') return send(401, { code: 'UNAUTHENTICATED' });
      if (p === '/me' && behavior.meFailsOnce) {
        const s = behavior.meFailsOnce;
        behavior.meFailsOnce = null;
        return send(s, { statusCode: s, message: 'x' });
      }
      if (p === '/me') return send(200, { data: d.profile });
      if (p === '/me/stay') return send(200, { data: d.stay });
      if (p === '/me/rent-summary') return send(200, { data: d.rent });
      const page = (items: unknown[]) => ({
        items,
        pagination: { page: 1, limit: 10, total: items.length, totalPages: 1 },
      });
      if (p === '/me/invoices') return send(200, { data: page([d.invoice]) });
      if (p === '/me/payments')
        return send(200, {
          data: page([{ ...d.payment, invoice: { id: d.invoice.id, number: d.invoice.number } }]),
        });
      if (p === `/me/invoices/${d.invoice.id}`)
        return send(200, { data: { ...d.invoice, payments: [d.payment] } });
      if (p === `/me/receipts/${d.payment.id}`) return send(200, { data: d.receipt });
    }
    return send(404, { message: 'Not Found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    log,
    behavior,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
