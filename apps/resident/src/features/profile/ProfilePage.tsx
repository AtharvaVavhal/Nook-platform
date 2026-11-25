import { useState } from 'react';
import { useAuth, useProfile } from '../../auth/AuthContext.js';
import { formatDate } from '../../lib/format.js';
import { accountStatus, residentStatus } from '../../lib/status.js';
import { StatusBadge } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { Banner } from '../../ui/Feedback.js';
import { Card, DefList, PageHeader } from '../../ui/Layout.js';

/** Read-only by design: only fields the API considers safe for a resident. Details are changed by the hostel, not here. */
export function ProfilePage() {
  const profile = useProfile();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function out() {
    setBusy(true);
    setFailed(false);
    if (!(await signOut())) {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <div className="rp-stack rp-stack--lg">
      <PageHeader title="Profile" subtitle="The details your hostel holds for you." />
      <Card>
        <DefList
          rows={[
            { label: 'Name', value: profile.displayName },
            { label: 'Mobile number', value: profile.phone },
            { label: 'Hostel', value: profile.organizationName },
            { label: 'Member since', value: formatDate(profile.memberSince) },
            {
              label: 'Resident status',
              value: <StatusBadge status={residentStatus(profile.residentStatus)} />,
            },
            {
              label: 'Portal access',
              value: <StatusBadge status={accountStatus(profile.accountStatus)} />,
            },
          ]}
        />
      </Card>
      <p className="rp-field__hint">
        Your details are managed by your hostel. To change them, please contact your hostel manager.
      </p>
      <Card title="Session">
        <div className="rp-stack">
          <p className="rp-field__hint">Signing out ends this session on this device.</p>
          {failed ? (
            <Banner tone="error" role="alert">
              We could not sign you out. Check your connection and try again.
            </Banner>
          ) : null}
          <div>
            <Button
              variant="secondary"
              onClick={() => void out()}
              loading={busy}
              loadingLabel="Signing out…"
            >
              Sign out
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
