import { useCallback, useRef, useState } from 'react';
import { EmptyState, ErrorState, LoadingState, Pager, useAsync } from '../finance/shared';
import { Field, FormError, useGuardedAction } from './ui';
import { opsApi, OpsApiError, type TransferPreview } from './opsApi';
import { CommandKeys, browserKeyStorage, commandSignature } from './correctionRules';

function when(value: string) {
  return `${new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`;
}

export function TransferWorkflow({
  residentId,
  currentBedId,
  residentName,
  onComplete,
}: {
  residentId: string;
  currentBedId: string;
  residentName: string;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="outline-button" onClick={() => setOpen(true)}>
        Transfer
      </button>
      {open && (
        <TransferForm
          key={residentId}
          residentId={residentId}
          currentBedId={currentBedId}
          residentName={residentName}
          onClose={() => setOpen(false)}
          onComplete={onComplete}
        />
      )}
    </>
  );
}

function TransferForm({
  residentId,
  currentBedId,
  residentName,
  onClose,
  onComplete,
}: {
  residentId: string;
  currentBedId: string;
  residentName: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [propertyId, setPropertyId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [destinationBedId, setDestinationBedId] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [retry, setRetry] = useState(false);
  const keys = useRef(new CommandKeys(browserKeyStorage()));
  const action = useGuardedAction();
  const properties = useAsync(
    useCallback(() => opsApi.inventory.properties.list(), []),
    [],
  );
  const rooms = useAsync(
    useCallback(
      () => (propertyId ? opsApi.inventory.rooms.list(propertyId) : Promise.resolve([])),
      [propertyId],
    ),
    [propertyId],
  );
  const beds = useAsync(
    useCallback(
      () => (roomId ? opsApi.inventory.beds.list(roomId) : Promise.resolve([])),
      [roomId],
    ),
    [roomId],
  );
  const resetPreview = () => {
    setPreview(null);
    action.setError(null);
  };
  async function execute() {
    if (
      !preview?.available ||
      !preview.executionEnabled ||
      !preview.allowedActions.includes('execute') ||
      !reason.trim()
    )
      return;
    const body = {
      residentId,
      destinationBedId,
      reason: reason.trim(),
      effectiveAt: preview.effectiveAt,
    };
    const signature = commandSignature([
      'transfer',
      residentId,
      destinationBedId,
      body.reason,
      body.effectiveAt,
    ]);
    const ok = await action.run(async () => {
      try {
        await opsApi.transfers.execute(body, keys.current.keyFor(signature));
        keys.current.clear(signature);
      } catch (e) {
        const uncertain =
          !(e instanceof OpsApiError) ||
          e.status === 0 ||
          e.status >= 500 ||
          e.code === 'RETRY_REQUIRED';
        setRetry(uncertain);
        if (!uncertain) {
          keys.current.clear(signature);
          setPreview(null);
        }
        throw e;
      }
    });
    if (ok) {
      onComplete();
      onClose();
    }
  }
  const error = properties.error || rooms.error || beds.error;
  return (
    <section
      className="profile-card"
      role="dialog"
      aria-modal="false"
      aria-label="Transfer resident"
    >
      <h3>Transfer {residentName}</h3>
      <p>Choose a destination and review availability before confirming.</p>
      {error && (
        <ErrorState
          message={error}
          onRetry={() => {
            properties.reload();
            rooms.reload();
            beds.reload();
          }}
        />
      )}
      <fieldset disabled={action.busy || retry}>
        <Field label="Destination property">
          <select
            value={propertyId}
            disabled={properties.loading}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setRoomId('');
              setDestinationBedId('');
              resetPreview();
            }}
          >
            <option value="">Select property</option>
            {properties.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Destination room">
          <select
            value={roomId}
            disabled={!propertyId || rooms.loading}
            onChange={(e) => {
              setRoomId(e.target.value);
              setDestinationBedId('');
              resetPreview();
            }}
          >
            <option value="">Select room</option>
            {!rooms.loading &&
              rooms.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Destination bed">
          <select
            value={destinationBedId}
            disabled={!roomId || beds.loading}
            onChange={(e) => {
              setDestinationBedId(e.target.value);
              resetPreview();
            }}
          >
            <option value="">Select bed</option>
            {!beds.loading &&
              beds.data
                ?.filter((b) => b.id !== currentBedId)
                .map((b) => (
                  <option key={b.id} value={b.id} disabled={b.operationalStatus !== 'IN_SERVICE'}>
                    {b.label} ·{' '}
                    {b.operationalStatus === 'IN_SERVICE'
                      ? 'In service'
                      : `Out of service: ${b.outOfServiceReason ?? 'Unavailable'}`}
                  </option>
                ))}
          </select>
        </Field>
        <Field label="Transfer reason">
          <textarea
            value={reason}
            required
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <button
          type="button"
          disabled={!destinationBedId}
          onClick={() => {
            setPreview(null);
            void action.run(async () =>
              setPreview(await opsApi.transfers.preview(residentId, destinationBedId)),
            );
          }}
        >
          Preview transfer
        </button>
      </fieldset>
      {preview && (
        <div aria-label="Transfer preview" aria-live="polite">
          <h4>{preview.transferType === 'ROOM_TRANSFER' ? 'Room transfer' : 'Bed transfer'}</h4>
          <p>
            {preview.currentAssignment.propertyName} / {preview.currentAssignment.roomLabel} /{' '}
            {preview.currentAssignment.bedLabel}
            {' → '}
            {preview.destination.propertyName} / {preview.destination.roomLabel} /{' '}
            {preview.destination.bedLabel}
          </p>
          <p>Effective time: {when(preview.effectiveAt)}</p>
          <p>
            Monthly rent unchanged: ₹{preview.finance.monthlyPrice}. No proration. Issued invoices
            unaffected. Deposit remains with the booking.
          </p>
          {preview.finance.referencePriceDifference !== '0.00' && (
            <p>
              Destination reference price: ₹{preview.finance.destinationReferencePrice}; difference:
              ₹{preview.finance.referencePriceDifference}. Rent review awaits an owner decision.
            </p>
          )}
          {preview.finance.reviewRequired && (
            <p role="alert">
              Financial review required for billing period {preview.finance.reviewPeriod}. Transfer
              billing review is awaiting an approved implementation contract.
            </p>
          )}
          {!preview.available && (
            <p role="alert">
              Destination unavailable
              {preview.conflicts.length
                ? `: ${preview.conflicts.length} conflicting allocation(s)`
                : ''}
              .{preview.staleState && ` Stay state: ${preview.staleState}.`}
            </p>
          )}
          {preview.unresolvedDecisions.length > 0 && (
            <ul>
              {preview.unresolvedDecisions.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          {!preview.executionEnabled && (
            <p role="status">
              Transfer execution is unavailable pending owner decisions, approval workflow and
              rollout verification. Extended transfers remain disabled.
            </p>
          )}
          <button
            type="button"
            disabled={
              action.busy ||
              !preview.available ||
              !preview.executionEnabled ||
              !preview.allowedActions.includes('execute') ||
              !reason.trim()
            }
            onClick={() => void execute()}
          >
            {retry ? 'Retry transfer with same key' : 'Confirm transfer'}
          </button>
        </div>
      )}
      <FormError message={action.error} />
      {retry && (
        <p role="alert">
          The outcome is uncertain. Retry this same transfer before changing the destination or
          reason.
        </p>
      )}
      <button
        type="button"
        className="outline-button"
        disabled={action.busy || retry}
        onClick={onClose}
      >
        Close
      </button>
    </section>
  );
}

export function TransferHistory({ residentId }: { residentId: string }) {
  const [page, setPage] = useState(1);
  const query = useAsync(
    useCallback(() => opsApi.transfers.history(residentId, page), [residentId, page]),
    [residentId, page],
  );
  if (query.loading) return <LoadingState label="Loading transfers…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />;
  if (!query.data?.items.length)
    return <EmptyState title="No transfers" hint="Completed transfers will appear here." />;
  return (
    <section aria-label="Transfer history">
      <h3>Transfer history</h3>
      {query.data.items.map((t) => (
        <article className="profile-card" key={t.id}>
          <h4>{t.type === 'ROOM_TRANSFER' ? 'Room transfer' : 'Bed transfer'}</h4>
          <p>
            {t.source.propertyName} / {t.source.roomLabel} / {t.source.bedLabel} →{' '}
            {t.destination.propertyName} / {t.destination.roomLabel} / {t.destination.bedLabel}
          </p>
          <p>
            Effective: {when(t.effectiveAt)} · Recorded: {when(t.recordedAt)}
          </p>
          <p>
            {t.actor.displayName}: {t.reason}
          </p>
          {t.financeReviews?.map((review) => (
            <p key={review.id}>
              Finance review · {review.periodStart}: {review.status.replace(/_/g, ' ')}
            </p>
          ))}
        </article>
      ))}
      <Pager page={page} totalPages={query.data.totalPages} onPage={setPage} />
    </section>
  );
}
