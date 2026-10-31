import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import {
  PERMISSIONS,
  type Permission,
  type UserSession,
  hasPermission,
} from './permissions';

export type PersonaId = 'owner' | 'manager' | 'cashier' | 'warden' | 'public';

export interface PersonaDefinition {
  id: PersonaId;
  label: string;
  roleDescription: string;
  session: UserSession | null;
}

const ORG_ID = 'org_nook_demo_blr';
const ORG_NAME = 'Nook Living Bengaluru';

/**
 * Pre-configured personas modeling real operational access boundaries.
 * Enforces:
 * - Cashier: has payment.record, but NOT payment.confirm and NOT data.export
 * - Warden: has occupancy.read, but NO finance.read, NO resident documents
 * - Public: no staff permissions
 */
export const MOCK_PERSONAS: Record<PersonaId, PersonaDefinition> = {
  owner: {
    id: 'owner',
    label: 'Owner / Partner',
    roleDescription: 'Executive oversight: occupancy, aged dues, collections, export',
    session: {
      id: 'usr_owner_01',
      name: 'Vikramaditya Rao',
      title: 'Managing Partner',
      organizationId: ORG_ID,
      organizationName: ORG_NAME,
      permissions: new Set<Permission>([
        PERMISSIONS.OCCUPANCY_READ,
        PERMISSIONS.FINANCE_READ,
        PERMISSIONS.RESIDENT_READ,
        PERMISSIONS.DATA_EXPORT,
        PERMISSIONS.ENQUIRY_READ,
      ]),
    },
  },
  manager: {
    id: 'manager',
    label: 'Property Manager',
    roleDescription: 'Operations: enquiries, allocation, live map, resident lifecycle',
    session: {
      id: 'usr_mgr_01',
      name: 'Ananya Sharma',
      title: 'Property Manager',
      organizationId: ORG_ID,
      organizationName: ORG_NAME,
      permissions: new Set<Permission>([
        PERMISSIONS.OCCUPANCY_READ,
        PERMISSIONS.INVENTORY_MANAGE,
        PERMISSIONS.ENQUIRY_READ,
        PERMISSIONS.ENQUIRY_MANAGE,
        PERMISSIONS.ALLOCATION_CREATE,
        PERMISSIONS.RESIDENT_READ,
        PERMISSIONS.RESIDENT_WRITE,
        PERMISSIONS.DOCUMENT_READ,
      ]),
    },
  },
  cashier: {
    id: 'cashier',
    label: 'Finance Clerk / Cashier',
    roleDescription: 'Cashier desk: records payments against specific charges',
    session: {
      id: 'usr_cashier_01',
      name: 'Karthik Nair',
      title: 'Accounts Associate',
      organizationId: ORG_ID,
      organizationName: ORG_NAME,
      permissions: new Set<Permission>([
        PERMISSIONS.PAYMENT_RECORD,
        PERMISSIONS.FINANCE_READ,
        PERMISSIONS.RESIDENT_READ,
      ]),
    },
  },
  warden: {
    id: 'warden',
    label: 'Warden / Front Desk',
    roleDescription: 'Front desk check: who is in which bed; no finances or docs',
    session: {
      id: 'usr_warden_01',
      name: 'Ramesh Gowda',
      title: 'Hostel Warden',
      organizationId: ORG_ID,
      organizationName: ORG_NAME,
      permissions: new Set<Permission>([
        PERMISSIONS.OCCUPANCY_READ,
      ]),
    },
  },
  public: {
    id: 'public',
    label: 'Prospective Resident',
    roleDescription: 'Public view: authentic bed availability and enquiry form',
    session: null,
  },
};

interface AuthContextValue {
  session: UserSession | null;
  activePersonaId: PersonaId;
  availablePersonas: PersonaDefinition[];
  setPersona: (id: PersonaId) => void;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialPersona = 'manager',
}: {
  children: ReactNode;
  initialPersona?: PersonaId;
}) {
  const [activePersonaId, setActivePersonaId] = useState<PersonaId>(initialPersona);

  const persona = MOCK_PERSONAS[activePersonaId] ?? MOCK_PERSONAS.manager;
  const session = persona.session;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      activePersonaId,
      availablePersonas: Object.values(MOCK_PERSONAS),
      setPersona: (id: PersonaId) => setActivePersonaId(id),
      can: (permission: Permission) => hasPermission(session, permission),
    }),
    [session, activePersonaId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
