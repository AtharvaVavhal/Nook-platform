export type FinanceRoute =
  | { name: 'dashboard' }
  | { name: 'invoices' }
  | { name: 'new-invoice' }
  | { name: 'invoice'; id: string }
  | { name: 'outstanding' }
  | { name: 'reports' }
  | { name: 'corrections' }
  | { name: 'receipt'; invoiceId: string; paymentId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFinanceHash(hash: string): boolean {
  return hash === '#finance' || hash.startsWith('#finance/');
}

export function parseFinanceRoute(hash: string): FinanceRoute {
  const parts = hash
    .replace(/^#finance\/?/, '')
    .split('/')
    .filter(Boolean);
  const [first, second, third] = parts;
  if (!first) return { name: 'dashboard' };
  if (first === 'invoices') {
    if (!second) return { name: 'invoices' };
    if (second === 'new') return { name: 'new-invoice' };
    if (UUID.test(second)) return { name: 'invoice', id: second };
    return { name: 'invoices' };
  }
  if (first === 'outstanding') return { name: 'outstanding' };
  if (first === 'reports') return { name: 'reports' };
  if (first === 'corrections') return { name: 'corrections' };
  if (first === 'receipt' && second && UUID.test(second)) {
    return third && UUID.test(third)
      ? { name: 'receipt', invoiceId: second, paymentId: third }
      : { name: 'receipt', invoiceId: second };
  }
  return { name: 'dashboard' };
}

export const financeLinks = {
  dashboard: '#finance',
  invoices: '#finance/invoices',
  newInvoice: '#finance/invoices/new',
  invoice: (id: string) => `#finance/invoices/${id}`,
  outstanding: '#finance/outstanding',
  reports: '#finance/reports',
  corrections: '#finance/corrections',
  receipt: (invoiceId: string, paymentId?: string) =>
    `#finance/receipt/${invoiceId}${paymentId ? `/${paymentId}` : ''}`,
};
