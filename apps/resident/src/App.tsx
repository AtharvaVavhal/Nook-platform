import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { LoginPage } from './auth/LoginPage.js';
import { useRoute } from './lib/useRoute.js';
import type { Route } from './lib/route.js';
import { AppShell } from './shell/AppShell.js';
import { ErrorState } from './ui/Feedback.js';
import { Logo } from './ui/Logo.js';
import { HomePage } from './features/home/HomePage.js';
import { StayPage } from './features/stay/StayPage.js';
import { RentPage } from './features/rent/RentPage.js';
import { InvoicePage } from './features/rent/InvoicePage.js';
import { PaymentsPage } from './features/payments/PaymentsPage.js';
import { ReceiptPage } from './features/payments/ReceiptPage.js';
import { ProfilePage } from './features/profile/ProfilePage.js';
import { NotFoundPage } from './features/NotFoundPage.js';
import { ErrorBoundary } from './ErrorBoundary.js';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'stay':
      return <StayPage />;
    case 'rent':
      return <RentPage />;
    case 'invoice':
      return <InvoicePage id={route.id} />;
    case 'payments':
      return <PaymentsPage />;
    case 'receipt':
      return <ReceiptPage id={route.id} />;
    case 'profile':
      return <ProfilePage />;
    default:
      return <NotFoundPage />;
  }
}

function Gate() {
  const { state, retry } = useAuth();
  const route = useRoute();
  if (state.status === 'checking')
    return (
      <div className="rp-splash" role="status" aria-live="polite">
        <Logo height={36} label="Nook" />
        <span className="rp-visually-hidden">Loading</span>
      </div>
    );
  if (state.status === 'unavailable')
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="rp-card" style={{ maxWidth: 460, width: '100%' }}>
          <ErrorState error={state.error} onRetry={() => void retry()} />
        </div>
      </div>
    );
  if (state.status === 'signedOut')
    return <LoginPage notice={state.notice} initialPhone={state.phone ?? null} />;
  return (
    <AppShell route={route}>
      <Screen route={route} />
    </AppShell>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ErrorBoundary>
  );
}
