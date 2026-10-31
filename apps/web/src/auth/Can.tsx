import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import type { Permission } from './permissions';

interface CanProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Declarative component to conditionally render UI based on permission.
 * Reminds developer: Hiding UI is convenience, not security; server remains the authority.
 */
export function Can({ permission, children, fallback = null }: CanProps) {
  const { can } = useAuth();
  if (!can(permission)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

interface CanNotProps {
  permission: Permission;
  children: ReactNode;
}

export function CanNot({ permission, children }: CanNotProps) {
  const { can } = useAuth();
  if (can(permission)) {
    return null;
  }
  return <>{children}</>;
}
