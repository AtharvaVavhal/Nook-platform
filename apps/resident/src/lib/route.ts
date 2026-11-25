/** Hash routes, so the portal needs no server-side rewrite rules. Unknown paths are a "not found" page, never a blank screen. */
export type Route =
  | { name: 'home' }
  | { name: 'stay' }
  | { name: 'rent' }
  | { name: 'invoice'; id: string }
  | { name: 'payments' }
  | { name: 'receipt'; id: string }
  | { name: 'profile' }
  | { name: 'notFound' };

export type NavSection = 'home' | 'stay' | 'rent' | 'payments' | 'profile';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b, c] = parts;
  if (parts.length === 0) return { name: 'home' };
  if (parts.length === 1) {
    if (a === 'stay') return { name: 'stay' };
    if (a === 'rent') return { name: 'rent' };
    if (a === 'payments') return { name: 'payments' };
    if (a === 'profile') return { name: 'profile' };
  }
  if (parts.length === 3 && a === 'rent' && b === 'invoice' && c && UUID.test(c))
    return { name: 'invoice', id: c };
  if (parts.length === 3 && a === 'payments' && b === 'receipt' && c && UUID.test(c))
    return { name: 'receipt', id: c };
  return { name: 'notFound' };
}

export const hrefs = {
  home: '#/',
  stay: '#/stay',
  rent: '#/rent',
  payments: '#/payments',
  profile: '#/profile',
  invoice: (id: string) => `#/rent/invoice/${id}`,
  receipt: (id: string) => `#/payments/receipt/${id}`,
} as const;

export function sectionOf(route: Route): NavSection {
  switch (route.name) {
    case 'stay':
      return 'stay';
    case 'rent':
    case 'invoice':
      return 'rent';
    case 'payments':
    case 'receipt':
      return 'payments';
    case 'profile':
      return 'profile';
    default:
      return 'home';
  }
}

export function titleOf(route: Route): string {
  switch (route.name) {
    case 'home':
      return 'Home';
    case 'stay':
      return 'My Stay';
    case 'rent':
      return 'Rent & Invoices';
    case 'invoice':
      return 'Invoice';
    case 'payments':
      return 'Payments';
    case 'receipt':
      return 'Receipt';
    case 'profile':
      return 'Profile';
    default:
      return 'Page not found';
  }
}
