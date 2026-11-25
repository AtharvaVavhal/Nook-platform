import type { IconName } from '../ui/Icon.js';
import { hrefs, type NavSection } from '../lib/route.js';

/** Exactly the five resident screens the backend supports today. Nothing is listed that has no data behind it. */
export const NAV: Array<{
  section: NavSection;
  label: string;
  short: string;
  href: string;
  icon: IconName;
}> = [
  { section: 'home', label: 'Home', short: 'Home', href: hrefs.home, icon: 'home' },
  { section: 'stay', label: 'My Stay', short: 'My Stay', href: hrefs.stay, icon: 'bed' },
  { section: 'rent', label: 'Rent & Invoices', short: 'Rent', href: hrefs.rent, icon: 'receipt' },
  { section: 'payments', label: 'Payments', short: 'Payments', href: hrefs.payments, icon: 'card' },
  { section: 'profile', label: 'Profile', short: 'Profile', href: hrefs.profile, icon: 'user' },
];
