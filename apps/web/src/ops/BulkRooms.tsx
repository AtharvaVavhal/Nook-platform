import { useState, type ChangeEvent } from 'react';
import { EmptyState, ErrorState, LoadingState, useAsync } from '../finance/shared';
import { Field, FormError, PageHead, Tag, useGuardedAction } from './ui';
import { opsApi, OpsApiError, type BulkRoomsResult, type Floor } from './opsApi';
import { opsLinks } from './opsRoute';
import {
  BULK_MAX_BEDS,
  BULK_MAX_ROOMS,
  batchLevelProblems,
  bedPath,
  describeFailure,
  newRoomKey,
  problemsByField,
  resizeBeds,
  roomPath,
  roomsFromPattern,
  summarize,
  toRequestBody,
  validateDraft,
  type BedStatus,
  type DraftRoom,
  type FieldProblem,
} from './bulkRoomBedRules';

type Step = 'edit' | 'review' | 'done';

/**
 * Add many rooms, and the beds in each room, to a property in one go.
 * Build the list, preview it (the server validates it without saving anything), then create everything in one
 * request. The create is all-or-nothing: if anything is wrong, no room and no bed is created.
 */
export function BulkRooms({ propertyId }: { propertyId: string }) {
  const property = useAsync(() => opsApi.inventory.properties.get(propertyId), [propertyId]);
  const floors = useAsync(() => opsApi.inventory.floors.list(propertyId), [propertyId]);
  return (
    <section aria-labelledby="bulk-title">
      <p>
        <a href={opsLinks.rooms(propertyId)}>← All rooms</a>
      </p>
      <PageHead id="bulk-title" title="Add multiple rooms" />
      {property.loading || floors.loading ? <LoadingState label="Loading property…" /> : null}
      {property.error ? <ErrorState message={property.error} onRetry={property.reload} /> : null}
      {floors.error ? <ErrorState message={floors.error} onRetry={floors.reload} /> : null}
      {property.data && floors.data && floors.data.length === 0 ? (
        <EmptyState
          title="This property has no floors yet"
          hint="Rooms are added to a floor. Add a floor first, then come back."
          action={
            <a className="primary-button" href={opsLinks.floorNew(propertyId)}>
              Add floor
            </a>
          }
        />
      ) : null}
      {property.data && floors.data && floors.data.length > 0 ? (
        <BulkEditor
          propertyId={propertyId}
          propertyName={property.data.name}
          floors={floors.data}
        />
      ) : null}
    </section>
  );
}

function BulkEditor({
  propertyId,
  propertyName,
  floors,
}: {
  propertyId: string;
  propertyName: string;
  floors: Floor[];
}) {
  const [step, setStep] = useState<Step>('edit');
  const [rooms, setRooms] = useState<DraftRoom[]>([]);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [preview, setPreview] = useState<BulkRoomsResult | null>(null);
  const [created, setCreated] = useState<BulkRoomsResult | null>(null);
  const [pattern, setPattern] = useState({
    floorId: floors[0]?.id ?? '',
    prefix: '',
    start: '101',
    count: '5',
    bedsPerRoom: '4',
  });
  const previewAction = useGuardedAction();
  const submitAction = useGuardedAction();
  const floorLabel = (id: string) => floors.find((f) => f.id === id)?.label ?? 'Unknown floor';
  const totals = summarize(rooms);
  const errors = problemsByField(problems);
  const batchProblems = batchLevelProblems(problems);

  function update(next: DraftRoom[]) {
    setRooms(next);
    setProblems([]);
  }
  function patchRoom(index: number, change: Partial<DraftRoom>) {
    update(rooms.map((room, i) => (i === index ? { ...room, ...change } : room)));
  }
  function patchBed(
    roomIndex: number,
    bedIndex: number,
    change: Partial<DraftRoom['beds'][number]>,
  ) {
    update(
      rooms.map((room, i) =>
        i === roomIndex
          ? { ...room, beds: room.beds.map((b, j) => (j === bedIndex ? { ...b, ...change } : b)) }
          : room,
      ),
    );
  }
  const setPatternField =
    (key: keyof typeof pattern) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setPattern({ ...pattern, [key]: e.target.value });

  function addPattern() {
    const count = Number.parseInt(pattern.count, 10);
    const start = Number.parseInt(pattern.start, 10);
    const bedsPerRoom = Number.parseInt(pattern.bedsPerRoom, 10);
    if (!pattern.floorId || !Number.isFinite(count) || count < 1) return;
    update([
      ...rooms,
      ...roomsFromPattern({
        floorId: pattern.floorId,
        prefix: pattern.prefix,
        start: Number.isFinite(start) ? start : 1,
        count,
        bedsPerRoom: Number.isFinite(bedsPerRoom) ? bedsPerRoom : 0,
      }),
    ]);
  }
  function addBlankRoom() {
    update([
      ...rooms,
      { key: newRoomKey(), floorId: pattern.floorId, label: '', beds: resizeBeds([], 1) },
    ]);
  }

  /** Runs the server's dry-run. Nothing is saved; the same validation as the real submission applies. */
  async function runPreview() {
    const local = validateDraft(rooms);
    setProblems(local);
    if (local.length) return;
    await previewAction.run(async () => {
      try {
        setPreview(await opsApi.inventory.rooms.bulkCreate(propertyId, toRequestBody(rooms, true)));
        setStep('review');
      } catch (e) {
        if (e instanceof OpsApiError) {
          if (e.details?.length) setProblems([...e.details]);
          throw new Error(describeFailure(e.status, e.code) ?? e.message);
        }
        throw e;
      }
    });
  }

  async function submit() {
    await submitAction.run(async () => {
      try {
        setCreated(
          await opsApi.inventory.rooms.bulkCreate(propertyId, toRequestBody(rooms, false)),
        );
        setStep('done');
      } catch (e) {
        if (e instanceof OpsApiError) {
          // Something changed since the preview (for example a label was taken meanwhile): back to editing, with
          // the marked rows. Nothing was created.
          if (e.details?.length) {
            setProblems([...e.details]);
            setStep('edit');
          }
          throw new Error(describeFailure(e.status, e.code) ?? e.message);
        }
        throw e;
      }
    });
  }

  if (step === 'done' && created) {
    return (
      <div role="status" className="fin-card">
        <h3>Created</h3>
        <p className="fin-success">
          {created.summary.rooms} {created.summary.rooms === 1 ? 'room' : 'rooms'} and{' '}
          {created.summary.beds} {created.summary.beds === 1 ? 'bed' : 'beds'} added to{' '}
          {propertyName}.
        </p>
        <div className="ops-actions">
          <a className="primary-button" href={opsLinks.rooms(propertyId)}>
            View rooms
          </a>
          <button
            type="button"
            className="outline-button"
            onClick={() => {
              setRooms([]);
              setPreview(null);
              setCreated(null);
              setProblems([]);
              setStep('edit');
            }}
          >
            Add more rooms
          </button>
        </div>
      </div>
    );
  }

  if (step === 'review' && preview) {
    const previewTotals = preview.summary;
    return (
      <div className="ops-form" style={{ maxWidth: 'none' }}>
        <p className="fin-hint">
          Preview for <strong>{propertyName}</strong>. Nothing has been saved yet.
        </p>
        <div className="fin-card">
          <h3>
            {previewTotals.rooms} {previewTotals.rooms === 1 ? 'room' : 'rooms'},{' '}
            {previewTotals.beds} {previewTotals.beds === 1 ? 'bed' : 'beds'}
          </h3>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Floor</th>
                  <th>Rooms</th>
                  <th>Beds</th>
                </tr>
              </thead>
              <tbody>
                {totals.perFloor.map((f) => (
                  <tr key={f.floorId}>
                    <td>{floorLabel(f.floorId)}</td>
                    <td>{f.rooms}</td>
                    <td>{f.beds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Floor</th>
                <th>Beds</th>
              </tr>
            </thead>
            <tbody>
              {preview.rooms.map((room, i) => (
                <tr key={`${room.label}-${i}`}>
                  <td>
                    <code>{room.label}</code>
                  </td>
                  <td>{floorLabel(room.floorId)}</td>
                  <td>
                    {room.beds.length === 0 ? (
                      <span className="fin-hint">No beds</span>
                    ) : (
                      room.beds.map((bed) => (
                        <span key={bed.label} style={{ marginRight: 6 }}>
                          <code>{bed.label}</code>
                          {bed.operationalStatus === 'OUT_OF_SERVICE' ? (
                            <Tag>Out of service</Tag>
                          ) : null}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fin-note">
          Everything is created together. If anything fails, no room and no bed is created.
        </p>
        <FormError message={submitAction.error} />
        <div className="ops-actions">
          <button
            type="button"
            className="primary-button"
            disabled={submitAction.busy}
            onClick={() => void submit()}
          >
            {submitAction.busy
              ? 'Creating…'
              : `Create ${previewTotals.rooms} ${previewTotals.rooms === 1 ? 'room' : 'rooms'} and ${previewTotals.beds} ${previewTotals.beds === 1 ? 'bed' : 'beds'}`}
          </button>
          <button
            type="button"
            className="outline-button"
            disabled={submitAction.busy}
            onClick={() => setStep('edit')}
          >
            Back to edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-form" style={{ maxWidth: 'none' }}>
      <p className="fin-hint">
        Adding to <strong>{propertyName}</strong>. A room&apos;s capacity is the number of beds you
        give it. Room labels must be unique across the whole property; bed labels must be unique
        within a room.
      </p>

      <fieldset className="fin-card">
        <legend>Add several rooms at once</legend>
        <div className="ops-grid">
          <Field label="Floor">
            <select value={pattern.floorId} onChange={setPatternField('floorId')}>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label prefix (optional)">
            <input value={pattern.prefix} onChange={setPatternField('prefix')} />
          </Field>
          <Field label="First number">
            <input inputMode="numeric" value={pattern.start} onChange={setPatternField('start')} />
          </Field>
          <Field label="Number of rooms">
            <input inputMode="numeric" value={pattern.count} onChange={setPatternField('count')} />
          </Field>
          <Field label="Beds per room">
            <input
              inputMode="numeric"
              value={pattern.bedsPerRoom}
              onChange={setPatternField('bedsPerRoom')}
            />
          </Field>
        </div>
        <div className="ops-actions">
          <button type="button" className="outline-button" onClick={addPattern}>
            Add these rooms
          </button>
          <button type="button" className="outline-button" onClick={addBlankRoom}>
            Add one blank room
          </button>
        </div>
      </fieldset>

      <p
        role="status"
        className={totals.overRoomLimit || totals.overBedLimit ? 'fin-form-error' : 'fin-note'}
      >
        {totals.rooms} of {BULK_MAX_ROOMS} rooms, {totals.beds} of {BULK_MAX_BEDS} beds in this
        request.
      </p>

      {rooms.length === 0 ? (
        <EmptyState title="No rooms added yet" hint="Use the form above to add rooms." />
      ) : null}

      {rooms.map((room, roomIndex) => (
        <fieldset className="fin-card" key={room.key}>
          <legend>Room {room.label.trim() || roomIndex + 1}</legend>
          <div className="ops-grid">
            <Field label="Floor" error={errors[roomPath(roomIndex, 'floorId')]}>
              <select
                value={room.floorId}
                onChange={(e) => patchRoom(roomIndex, { floorId: e.target.value })}
              >
                <option value="">Select floor</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Room label" error={errors[roomPath(roomIndex, 'label')]}>
              <input
                value={room.label}
                onChange={(e) => patchRoom(roomIndex, { label: e.target.value })}
              />
            </Field>
            <Field label="Beds in this room">
              <input
                inputMode="numeric"
                value={String(room.beds.length)}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  patchRoom(roomIndex, { beds: resizeBeds(room.beds, Number.isFinite(n) ? n : 0) });
                }}
              />
            </Field>
          </div>
          {room.beds.map((bed, bedIndex) => (
            <div className="ops-grid" key={bedIndex}>
              <Field
                label={`Bed ${bedIndex + 1} label`}
                error={errors[bedPath(roomIndex, bedIndex, 'label')]}
              >
                <input
                  value={bed.label}
                  onChange={(e) => patchBed(roomIndex, bedIndex, { label: e.target.value })}
                />
              </Field>
              <Field
                label={`Bed ${bedIndex + 1} status`}
                error={errors[bedPath(roomIndex, bedIndex, 'operationalStatus')]}
              >
                <select
                  value={bed.operationalStatus}
                  onChange={(e) =>
                    patchBed(roomIndex, bedIndex, {
                      operationalStatus: e.target.value as BedStatus,
                    })
                  }
                >
                  <option value="IN_SERVICE">In service</option>
                  <option value="OUT_OF_SERVICE">Out of service</option>
                </select>
              </Field>
              {bed.operationalStatus === 'OUT_OF_SERVICE' ? (
                <Field
                  label={`Bed ${bedIndex + 1} reason`}
                  error={errors[bedPath(roomIndex, bedIndex, 'outOfServiceReason')]}
                >
                  <input
                    value={bed.outOfServiceReason}
                    onChange={(e) =>
                      patchBed(roomIndex, bedIndex, { outOfServiceReason: e.target.value })
                    }
                  />
                </Field>
              ) : null}
            </div>
          ))}
          <div className="ops-actions">
            <button
              type="button"
              className="outline-button"
              onClick={() => update(rooms.filter((_, i) => i !== roomIndex))}
            >
              Remove room
            </button>
          </div>
        </fieldset>
      ))}

      {batchProblems.map((message) => (
        <FormError key={message} message={message} />
      ))}
      {problems.length > 0 && batchProblems.length === 0 ? (
        <FormError message="Some rows need attention. Fix the marked fields." />
      ) : null}
      <FormError message={previewAction.error} />
      <div className="ops-actions">
        <button
          type="button"
          className="primary-button"
          disabled={previewAction.busy || rooms.length === 0}
          onClick={() => void runPreview()}
        >
          {previewAction.busy ? 'Checking…' : 'Preview'}
        </button>
        <a className="outline-button" href={opsLinks.rooms(propertyId)}>
          Cancel
        </a>
      </div>
    </div>
  );
}
