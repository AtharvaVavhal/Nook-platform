import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  type MouseEvent,
} from 'react';
import type { RouteId } from './routes';

interface RouterContextValue {
  currentPath: string;
  routeId: RouteId;
  navigate: (path: string) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function parseHash(hash: string): { path: string; routeId: RouteId } {
  const clean = hash.replace(/^#\/?/, '').split('?')[0] || 'overview';
  const validRouteIds: RouteId[] = [
    'overview',
    'dashboard',
    'floor-plan',
    'inventory',
    'enquiries',
    'residents',
    'payments',
    'warden',
    'public',
  ];

  const matched = validRouteIds.find((id) => clean === id || clean.startsWith(`${id}/`));
  const routeId = matched ?? 'overview';
  return { path: `#/${clean}`, routeId };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    return window.location.hash || '#/overview';
  });

  const parsed = parseHash(currentPath);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPath(window.location.hash || '#/overview');
    };

    window.addEventListener('hashchange', handleHashChange);
    if (!window.location.hash) {
      window.location.hash = '#/overview';
    }

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = useCallback((to: string) => {
    const targetHash = to.startsWith('#') ? to : `#/${to.replace(/^\/+/, '')}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    } else {
      setCurrentPath(targetHash);
    }
  }, []);

  return (
    <RouterContext.Provider
      value={{
        currentPath,
        routeId: parsed.routeId,
        navigate,
      }}
    >
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return ctx;
}

export function Link({
  to,
  children,
  className,
  'aria-label': ariaLabel,
  onClick,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
  onClick?: () => void;
}) {
  const { navigate } = useRouter();

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
      return;
    }
    e.preventDefault();
    navigate(to);
    onClick?.();
  };

  const href = to.startsWith('#') ? to : `#/${to.replace(/^\/+/, '')}`;

  return (
    <a href={href} className={className} aria-label={ariaLabel} onClick={handleClick}>
      {children}
    </a>
  );
}
