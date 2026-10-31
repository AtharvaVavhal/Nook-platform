import { PERMISSIONS, type Permission } from '../auth/permissions';

export type RouteId =
  | 'overview'
  | 'floor-plan'
  | 'inventory'
  | 'enquiries'
  | 'residents'
  | 'payments'
  | 'warden'
  | 'public';

export interface RouteConfig {
  id: RouteId;
  path: string;
  label: string;
  requiredPermission?: Permission;
  iconName: 'building' | 'layers' | 'grid' | 'search' | 'bed' | 'arrow' | 'pin';
  staffOnly?: boolean;
  publicOnly?: boolean;
}

export const APP_ROUTES: RouteConfig[] = [
  {
    id: 'overview',
    path: '#/overview',
    label: 'Property overview',
    iconName: 'building',
    staffOnly: true,
  },
  {
    id: 'floor-plan',
    path: '#/floor-plan',
    label: 'Interactive floor plan',
    iconName: 'layers',
    requiredPermission: PERMISSIONS.OCCUPANCY_READ,
    staffOnly: true,
  },
  {
    id: 'inventory',
    path: '#/inventory',
    label: 'Inventory overview',
    iconName: 'grid',
    staffOnly: true,
  },
  {
    id: 'enquiries',
    path: '#/enquiries',
    label: 'Enquiries & admission',
    iconName: 'search',
    requiredPermission: PERMISSIONS.ENQUIRY_READ,
    staffOnly: true,
  },
  {
    id: 'residents',
    path: '#/residents',
    label: 'Residents & statements',
    iconName: 'bed',
    requiredPermission: PERMISSIONS.RESIDENT_READ,
    staffOnly: true,
  },
  {
    id: 'payments',
    path: '#/payments',
    label: 'Record payment',
    iconName: 'building',
    requiredPermission: PERMISSIONS.PAYMENT_RECORD,
    staffOnly: true,
  },
  {
    id: 'warden',
    path: '#/warden',
    label: 'Front desk map',
    iconName: 'grid',
    requiredPermission: PERMISSIONS.OCCUPANCY_READ,
    staffOnly: true,
  },
  {
    id: 'public',
    path: '#/public',
    label: 'Public property view',
    iconName: 'pin',
  },
];
