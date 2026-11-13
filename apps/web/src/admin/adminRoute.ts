export type AdminRoute =
  | { name: 'settings'; section: SettingsSection }
  | { name: 'staff' }
  | { name: 'notifications' }
  | { name: 'transfers' }
  | { name: 'transfer'; id: string };

export const SETTINGS_SECTIONS = [
  'organization',
  'properties',
  'access',
  'notifications',
  'billing',
  'account',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOTS = ['settings', 'staff', 'notifications', 'transfers'];

export function isAdminHash(hash: string): boolean {
  return ROOTS.some((root) => hash === `#${root}` || hash.startsWith(`#${root}/`));
}

export function parseAdminRoute(hash: string): AdminRoute {
  const [first, second] = (hash.replace(/^#/, '').split('?')[0] ?? '').split('/').filter(Boolean);
  if (first === 'staff') return { name: 'staff' };
  if (first === 'notifications') return { name: 'notifications' };
  if (first === 'transfers') {
    return second && UUID.test(second) ? { name: 'transfer', id: second } : { name: 'transfers' };
  }
  const section = SETTINGS_SECTIONS.find((s) => s === second) ?? 'organization';
  return { name: 'settings', section };
}

export const adminLinks = {
  settings: (section: SettingsSection = 'organization') => `#settings/${section}`,
  staff: '#staff',
  notifications: '#notifications',
  transfers: '#transfers',
  transfer: (id: string) => `#transfers/${id}`,
};
