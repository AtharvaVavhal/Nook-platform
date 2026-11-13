import { useState, type FormEvent, type ChangeEvent } from 'react';
import { EmptyState, ErrorState, LoadingState, useAsync } from '../finance/shared';
import { Field, FormError, PageHead, Tag, useGuardedAction } from './ui';
import {
  opsApi,
  type Property,
  type Floor,
  type Room,
  type Bed,
  type PropertyInput,
  type FloorInput,
  type RoomInput,
  type BedInput,
} from './opsApi';
import { opsLinks } from './opsRoute';
import { label } from './opsFormat';

const STATUSES = ['IN_SERVICE', 'OUT_OF_SERVICE'] as const;

export function PropertyList() {
  const { data, loading, error, reload } = useAsync(() => opsApi.inventory.properties.list(), []);
  return (
    <section aria-labelledby="prop-title">
      <PageHead
        id="prop-title"
        title="Properties"
        action={
          <a className="primary-button" href={opsLinks.propertyNew}>
            Add property
          </a>
        }
      />
      {loading && !data ? <LoadingState label="Loading properties…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.length === 0 ? (
        <EmptyState
          title="No properties found"
          hint="Add the first property to get started."
          action={
            <a className="primary-button" href={opsLinks.propertyNew}>
              Add property
            </a>
          }
        />
      ) : null}
      {data && data.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <code>{p.code}</code>
                  </td>
                  <td>
                    <a href={opsLinks.property(p.id)}>{p.name}</a>
                  </td>
                  <td>{p.archivedAt ? <Tag>Archived</Tag> : <Tag>Active</Tag>}</td>
                  <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

const EMPTY_PROPERTY: PropertyInput = { code: '', name: '' };

export function PropertyForm({
  property,
  onSaved,
  onCancel,
}: {
  property?: Property;
  onSaved: (p: Property) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<PropertyInput>(
    property ? { code: property.code, name: property.name } : EMPTY_PROPERTY,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof PropertyInput, string>>>({});
  const { busy, error, run } = useGuardedAction();
  const setField = (k: keyof PropertyInput) => (e: ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Partial<Record<keyof PropertyInput, string>> = {};
    if (!v.code.trim()) found.code = 'Enter a property code.';
    if (!v.name.trim()) found.name = 'Enter a property name.';
    setErrors(found);
    if (Object.keys(found).length) return;
    await run(async () =>
      onSaved(
        property
          ? await opsApi.inventory.properties.update(property.id, v)
          : await opsApi.inventory.properties.create(v),
      ),
    );
  }
  return (
    <form className="ops-form" onSubmit={submit} noValidate>
      <div className="ops-grid">
        <Field label="Code" error={errors.code}>
          <input value={v.code} onChange={setField('code')} disabled={!!property} />
        </Field>
        <Field label="Name" error={errors.name}>
          <input value={v.name} onChange={setField('name')} />
        </Field>
      </div>
      <FormError message={error} />
      <div className="ops-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Saving…' : property ? 'Save changes' : 'Create property'}
        </button>
        <button type="button" className="outline-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function PropertyNew() {
  return (
    <section aria-labelledby="prop-new">
      <p>
        <a href={opsLinks.properties}>← All properties</a>
      </p>
      <PageHead id="prop-new" title="Add property" />
      <PropertyForm
        onSaved={(p) => {
          window.location.hash = opsLinks.property(p.id);
        }}
        onCancel={() => {
          window.location.hash = opsLinks.properties;
        }}
      />
    </section>
  );
}

export function PropertyDetail({ id }: { id: string }) {
  const { data, loading, error, reload } = useAsync(
    () => opsApi.inventory.properties.get(id),
    [id],
  );
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const statusAction = useGuardedAction();
  if (loading && !data) return <LoadingState label="Loading property…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const p = data;
  const archive = () =>
    window.confirm(`Archive ${p.name}? It will no longer be available for new stays.`) &&
    statusAction.run(async () => {
      await opsApi.inventory.properties.archive(p.id);
      setNotice('Property archived.');
      reload();
    });
  return (
    <section aria-labelledby="prop-detail">
      <p>
        <a href={opsLinks.properties}>← All properties</a>
      </p>
      <PageHead
        id="prop-detail"
        title={p.name}
        action={p.archivedAt ? <Tag>Archived</Tag> : <Tag>Active</Tag>}
      />
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      {editing ? (
        <PropertyForm
          property={p}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice('Details saved.');
            reload();
          }}
        />
      ) : (
        <>
          <dl className="ops-kv">
            <dt>Code</dt>
            <dd>
              <code>{p.code}</code>
            </dd>
            <dt>Status</dt>
            <dd>{p.archivedAt ? 'Archived' : 'Active'}</dd>
            <dt>Created</dt>
            <dd>{new Date(p.createdAt).toLocaleString()}</dd>
            <dt>Updated</dt>
            <dd>{new Date(p.updatedAt).toLocaleString()}</dd>
          </dl>
          <div className="ops-actions">
            {!p.archivedAt && (
              <button type="button" className="outline-button" onClick={() => setEditing(true)}>
                Edit details
              </button>
            )}
            {!p.archivedAt && (
              <button
                type="button"
                className="outline-button"
                disabled={statusAction.busy}
                onClick={archive}
              >
                Archive property
              </button>
            )}
            <a className="outline-button" href={opsLinks.floors(p.id)}>
              Manage floors
            </a>
          </div>
          <FormError message={statusAction.error} />
          {p.archivedAt && (
            <p className="fin-form-error">
              This property is archived. No further changes can be made.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function FloorList({ propertyId }: { propertyId: string }) {
  const { data, loading, error, reload } = useAsync(
    () => opsApi.inventory.floors.list(propertyId),
    [propertyId],
  );
  return (
    <section aria-labelledby="floor-title">
      {window.location.hash.endsWith('?archived=1') ? (
        <p className="fin-success" role="status">
          Floor archived.
        </p>
      ) : null}
      <PageHead
        id="floor-title"
        title="Floors"
        action={
          <a className="primary-button" href={opsLinks.floorNew(propertyId)}>
            Add floor
          </a>
        }
      />
      {loading && !data ? <LoadingState label="Loading floors…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.length === 0 ? (
        <EmptyState
          title="No floors found"
          hint="Add the first floor to get started."
          action={
            <a className="primary-button" href={opsLinks.floorNew(propertyId)}>
              Add floor
            </a>
          }
        />
      ) : null}
      {data && data.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Ordinal</th>
                <th>Label</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((f) => (
                <tr key={f.id}>
                  <td>{f.ordinal}</td>
                  <td>{f.label}</td>
                  <td>
                    <a className="text-link" href={opsLinks.rooms(propertyId)}>
                      Manage rooms
                    </a>
                    <span aria-hidden="true">·</span>
                    <a className="text-link" href={`#floors/${propertyId}/${f.id}`}>
                      Edit
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

const EMPTY_FLOOR: FloorInput = { label: '', ordinal: 0 };

export function FloorForm({
  propertyId,
  floor,
  onSaved,
  onCancel,
}: {
  propertyId: string;
  floor?: Floor;
  onSaved: (f: Floor) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<FloorInput>(
    floor ? { label: floor.label, ordinal: floor.ordinal } : EMPTY_FLOOR,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof FloorInput, string>>>({});
  const { busy, error, run } = useGuardedAction();
  const setField =
    (k: keyof FloorInput) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
      setV({ ...v, [k]: value });
    };
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Partial<Record<keyof FloorInput, string>> = {};
    if (!v.label.trim()) found.label = 'Enter a floor label.';
    if (v.ordinal < 0) found.ordinal = 'Ordinal must be zero or greater.';
    setErrors(found);
    if (Object.keys(found).length) return;
    await run(async () =>
      onSaved(
        floor
          ? await opsApi.inventory.floors.update(floor.id, v)
          : await opsApi.inventory.floors.create(propertyId, v),
      ),
    );
  }
  return (
    <form className="ops-form" onSubmit={submit} noValidate>
      <div className="ops-grid">
        <Field label="Label" error={errors.label}>
          <input value={v.label} onChange={setField('label')} />
        </Field>
        <Field label="Ordinal" error={errors.ordinal}>
          <input type="number" value={v.ordinal} onChange={setField('ordinal')} min="0" />
        </Field>
      </div>
      <FormError message={error} />
      <div className="ops-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Saving…' : floor ? 'Save changes' : 'Add floor'}
        </button>
        <button type="button" className="outline-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function FloorNew({ propertyId }: { propertyId: string }) {
  return (
    <section aria-labelledby="floor-new">
      <p>
        <a href={opsLinks.floors(propertyId)}>← All floors</a>
      </p>
      <PageHead id="floor-new" title="Add floor" />
      <FloorForm
        propertyId={propertyId}
        onSaved={() => {
          window.location.hash = opsLinks.rooms(propertyId);
        }}
        onCancel={() => {
          window.location.hash = opsLinks.floors(propertyId);
        }}
      />
    </section>
  );
}

export function FloorDetail({ propertyId, id }: { propertyId: string; id: string }) {
  const { data, loading, error, reload } = useAsync(
    () => opsApi.inventory.floors.list(propertyId),
    [propertyId],
  );
  const floor = data?.find((f) => f.id === id);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const statusAction = useGuardedAction();
  if (loading && !data) return <LoadingState label="Loading floor…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!floor) return <ErrorState message="Floor not found" />;
  const archive = () =>
    window.confirm(`Archive ${floor.label}?`) &&
    statusAction.run(async () => {
      await opsApi.inventory.floors.archive(floor.id);
      window.location.hash = `${opsLinks.floors(propertyId)}?archived=1`;
    });
  return (
    <section aria-labelledby="floor-detail">
      <p>
        <a href={opsLinks.floors(propertyId)}>← All floors</a>
      </p>
      <PageHead id="floor-detail" title={floor.label} />
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      {editing ? (
        <FloorForm
          propertyId={propertyId}
          floor={floor}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice('Details saved.');
            reload();
          }}
        />
      ) : (
        <>
          <dl className="ops-kv">
            <dt>Ordinal</dt>
            <dd>{floor.ordinal}</dd>
          </dl>
          <div className="ops-actions">
            <button type="button" className="outline-button" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button
              type="button"
              className="outline-button"
              disabled={statusAction.busy}
              onClick={archive}
            >
              Archive floor
            </button>
            <a className="outline-button" href={opsLinks.rooms(propertyId)}>
              Manage rooms on this floor
            </a>
          </div>
          <FormError message={statusAction.error} />
        </>
      )}
    </section>
  );
}

export function RoomList({ propertyId }: { propertyId: string }) {
  const floors = useAsync(() => opsApi.inventory.floors.list(propertyId), [propertyId]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [floorId, setFloorId] = useState('');
  const params =
    floorId || applied
      ? { ...(floorId ? { floorId } : {}), ...(applied ? { q: applied } : {}) }
      : undefined;
  const { data, loading, error, reload } = useAsync(
    () => opsApi.inventory.rooms.list(propertyId, params),
    [propertyId, applied, floorId],
  );
  return (
    <section aria-labelledby="room-title">
      {window.location.hash.endsWith('?archived=1') ? (
        <p className="fin-success" role="status">
          Room archived.
        </p>
      ) : null}
      <PageHead
        id="room-title"
        title="Rooms"
        action={
          <a className="primary-button" href={opsLinks.roomNew(propertyId)}>
            Add room
          </a>
        }
      />
      <form
        className="fin-toolbar"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <Field label="Search">
          <input
            value={search}
            placeholder="Room label"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field label="Floor">
          <select
            value={floorId}
            onChange={(e) => {
              setFloorId(e.target.value);
            }}
          >
            <option value="">All floors</option>
            {floors.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="outline-button">
          Search
        </button>
      </form>
      {floors.error ? <ErrorState message={floors.error} onRetry={floors.reload} /> : null}
      {loading && !data ? <LoadingState label="Loading rooms…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.length === 0 ? (
        <EmptyState
          title="No rooms found"
          hint={
            applied || floorId
              ? 'Try a different search or filter.'
              : 'Add the first room to get started.'
          }
        />
      ) : null}
      {data && data.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Floor</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={opsLinks.room(propertyId, r.id)}>{r.label}</a>
                  </td>
                  <td>
                    {r.floor?.label ?? floors.data?.find((f) => f.id === r.floorId)?.label ?? '—'}
                  </td>
                  <td>
                    <a href={opsLinks.beds(r.id)}>Manage beds</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

const EMPTY_ROOM: RoomInput = { floorId: '', label: '' };

export function RoomForm({
  propertyId,
  room,
  floors,
  onSaved,
  onCancel,
}: {
  propertyId: string;
  room?: Room;
  floors: Floor[];
  onSaved: (r: Room) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<RoomInput>(
    room ? { floorId: room.floorId, label: room.label } : EMPTY_ROOM,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof RoomInput, string>>>({});
  const { busy, error, run } = useGuardedAction();
  const setField = (k: keyof RoomInput) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Partial<Record<keyof RoomInput, string>> = {};
    if (!v.floorId) found.floorId = 'Select a floor.';
    if (!v.label.trim()) found.label = 'Enter a room label.';
    setErrors(found);
    if (Object.keys(found).length) return;
    await run(async () =>
      onSaved(
        room
          ? await opsApi.inventory.rooms.update(room.id, { label: v.label })
          : await opsApi.inventory.rooms.create(propertyId, v),
      ),
    );
  }
  return (
    <form className="ops-form" onSubmit={submit} noValidate>
      <div className="ops-grid">
        <Field label="Floor" error={errors.floorId}>
          <select value={v.floorId} onChange={setField('floorId')} disabled={!!room}>
            <option value="">Select floor</option>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label" error={errors.label}>
          <input value={v.label} onChange={setField('label')} />
        </Field>
      </div>
      <FormError message={error} />
      <div className="ops-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Saving…' : room ? 'Save changes' : 'Add room'}
        </button>
        <button type="button" className="outline-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RoomNew({ propertyId }: { propertyId: string }) {
  const { data, loading, error, reload } = useAsync(
    () => opsApi.inventory.floors.list(propertyId),
    [propertyId],
  );
  return (
    <section aria-labelledby="room-new">
      <p>
        <a href={opsLinks.rooms(propertyId)}>← All rooms</a>
      </p>
      <PageHead id="room-new" title="Add room" />
      {loading ? (
        <LoadingState label="Loading floors…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <RoomForm
          propertyId={propertyId}
          floors={data ?? []}
          onSaved={(r) => {
            window.location.hash = opsLinks.room(propertyId, r.id);
          }}
          onCancel={() => {
            window.location.hash = opsLinks.rooms(propertyId);
          }}
        />
      )}
    </section>
  );
}

export function RoomDetail({ propertyId, id }: { propertyId: string; id: string }) {
  const {
    data: roomData,
    loading,
    error,
    reload,
  } = useAsync(() => opsApi.inventory.rooms.list(propertyId), [propertyId]);
  const room = roomData?.find((r) => r.id === id);
  const beds = useAsync(() => opsApi.inventory.beds.list(id), [id]);
  const { data: bedData } = beds;
  const floors = useAsync(() => opsApi.inventory.floors.list(propertyId), [propertyId]);
  const { data: floorData } = floors;
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const statusAction = useGuardedAction();
  if (loading && !roomData) return <LoadingState label="Loading room…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!room) return <ErrorState message="Room not found" />;
  const archive = () =>
    window.confirm(`Archive ${room.label}?`) &&
    statusAction.run(async () => {
      await opsApi.inventory.rooms.archive(room.id);
      window.location.hash = `${opsLinks.rooms(propertyId)}?archived=1`;
    });
  return (
    <section aria-labelledby="room-detail">
      <p>
        <a href={opsLinks.rooms(propertyId)}>← All rooms</a>
      </p>
      <PageHead id="room-detail" title={room.label} />
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      {editing ? (
        floors.error ? (
          <ErrorState message={floors.error} onRetry={floors.reload} />
        ) : floors.loading ? (
          <LoadingState label="Loading floors…" />
        ) : (
          <RoomForm
            propertyId={propertyId}
            room={room}
            floors={floorData ?? []}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              setNotice('Details saved.');
              reload();
            }}
          />
        )
      ) : (
        <>
          <dl className="ops-kv">
            <dt>Floor</dt>
            <dd>
              {room.floor?.label ?? floorData?.find((f) => f.id === room.floorId)?.label ?? '—'}
            </dd>
          </dl>
          <div className="ops-actions">
            <button type="button" className="outline-button" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button
              type="button"
              className="outline-button"
              disabled={statusAction.busy}
              onClick={archive}
            >
              Archive room
            </button>
            <a className="primary-button" href={opsLinks.beds(room.id)}>
              Manage beds
            </a>
          </div>
          <FormError message={statusAction.error} />
          <h3 style={{ marginTop: 24 }}>Beds</h3>
          {beds.error ? (
            <ErrorState message={beds.error} onRetry={beds.reload} />
          ) : bedData ? (
            bedData.length === 0 ? (
              <EmptyState
                title="No beds"
                hint="Add the first bed to this room."
                action={
                  <a className="primary-button" href={opsLinks.bedNew(room.id)}>
                    Add bed
                  </a>
                }
              />
            ) : (
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Status</th>
                      <th>Out of service reason</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bedData.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <a href={opsLinks.bed(id, b.id)}>{b.label}</a>
                        </td>
                        <td>
                          <Tag>{label(b.operationalStatus)}</Tag>
                        </td>
                        <td>{b.outOfServiceReason ?? '—'}</td>
                        <td>{b.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <LoadingState label="Loading beds…" />
          )}
        </>
      )}
    </section>
  );
}

export function BedList({ roomId }: { roomId: string }) {
  const { data, loading, error, reload } = useAsync(
    () => opsApi.inventory.beds.list(roomId),
    [roomId],
  );
  return (
    <section aria-labelledby="bed-title">
      {window.location.hash.endsWith('?archived=1') ? (
        <p className="fin-success" role="status">
          Bed archived.
        </p>
      ) : null}
      <PageHead
        id="bed-title"
        title="Beds"
        action={
          <a className="primary-button" href={opsLinks.bedNew(roomId)}>
            Add bed
          </a>
        }
      />
      {loading && !data ? <LoadingState label="Loading beds…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.length === 0 ? (
        <EmptyState
          title="No beds"
          hint="Add the first bed to get started."
          action={
            <a className="primary-button" href={opsLinks.bedNew(roomId)}>
              Add bed
            </a>
          }
        />
      ) : null}
      {data && data.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Status</th>
                <th>Out of service reason</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id}>
                  <td>
                    <a href={opsLinks.bed(roomId, b.id)}>{b.label}</a>
                  </td>
                  <td>
                    <Tag>{label(b.operationalStatus)}</Tag>
                  </td>
                  <td>{b.outOfServiceReason ?? '—'}</td>
                  <td>{b.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

const EMPTY_BED: BedInput = { label: '', operationalStatus: 'IN_SERVICE', outOfServiceReason: '' };

export function BedForm({
  roomId,
  bed,
  onSaved,
  onCancel,
}: {
  roomId: string;
  bed?: Bed;
  onSaved: (b: Bed) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<BedInput>(
    bed
      ? {
          label: bed.label,
          operationalStatus: bed.operationalStatus,
          outOfServiceReason: bed.outOfServiceReason ?? '',
        }
      : EMPTY_BED,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof BedInput, string>>>({});
  const { busy, error, run } = useGuardedAction();
  const setField =
    (k: keyof BedInput) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setV({ ...v, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Partial<Record<keyof BedInput, string>> = {};
    if (!v.label.trim()) found.label = 'Enter a bed label.';
    const reason = v.outOfServiceReason ?? '';
    if (v.operationalStatus === 'OUT_OF_SERVICE' && !reason.trim()) {
      found.outOfServiceReason = 'Reason is required when status is Out of Service.';
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: BedInput = {
      label: v.label.trim(),
      operationalStatus: v.operationalStatus,
      ...(v.operationalStatus === 'OUT_OF_SERVICE' ? { outOfServiceReason: reason.trim() } : {}),
    };
    await run(async () =>
      onSaved(
        bed
          ? await opsApi.inventory.beds.update(bed.id, body)
          : await opsApi.inventory.beds.create(roomId, body),
      ),
    );
  }
  return (
    <form className="ops-form" onSubmit={submit} noValidate>
      <div className="ops-grid">
        <Field label="Label" error={errors.label}>
          <input value={v.label} onChange={setField('label')} />
        </Field>
        <Field label="Operational status" error={errors.operationalStatus}>
          <select value={v.operationalStatus} onChange={setField('operationalStatus')}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Out of service reason" error={errors.outOfServiceReason}>
        <textarea
          rows={2}
          value={v.outOfServiceReason}
          onChange={setField('outOfServiceReason')}
          placeholder={
            v.operationalStatus === 'OUT_OF_SERVICE'
              ? 'Required'
              : 'Only required when status is Out of Service'
          }
        />
      </Field>
      <FormError message={error} />
      <div className="ops-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Saving…' : bed ? 'Save changes' : 'Add bed'}
        </button>
        <button type="button" className="outline-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function BedNew({ roomId }: { roomId: string }) {
  return (
    <section aria-labelledby="bed-new">
      <p>
        <a href={opsLinks.beds(roomId)}>← All beds</a>
      </p>
      <PageHead id="bed-new" title="Add bed" />
      <BedForm
        roomId={roomId}
        onSaved={() => {
          window.location.hash = opsLinks.beds(roomId);
        }}
        onCancel={() => {
          window.location.hash = opsLinks.beds(roomId);
        }}
      />
    </section>
  );
}

export function BedDetail({ roomId, id }: { roomId: string; id: string }) {
  const { data, loading, error, reload } = useAsync(
    () => opsApi.inventory.beds.list(roomId),
    [roomId],
  );
  const bed = data?.find((b) => b.id === id);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const archive = useGuardedAction();
  if (loading && !data) return <LoadingState label="Loading bed…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!bed) return <ErrorState message="Bed not found" />;
  return (
    <section aria-labelledby="bed-detail">
      <p>
        <a href={opsLinks.beds(roomId)}>← All beds</a>
      </p>
      <PageHead
        id="bed-detail"
        title={bed.label}
        action={<Tag>{label(bed.operationalStatus)}</Tag>}
      />
      {notice ? (
        <p className="fin-success" role="status">
          {notice}
        </p>
      ) : null}
      {editing ? (
        <BedForm
          roomId={roomId}
          bed={bed}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice('Details saved.');
            reload();
          }}
        />
      ) : (
        <>
          <dl className="ops-kv">
            <dt>Status</dt>
            <dd>{label(bed.operationalStatus)}</dd>
            <dt>Out of service reason</dt>
            <dd>{bed.outOfServiceReason ?? '—'}</dd>
            <dt>Price</dt>
            <dd>{bed.price}</dd>
          </dl>
          <div className="ops-actions">
            <button type="button" className="outline-button" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button
              type="button"
              className="outline-button"
              disabled={archive.busy}
              onClick={() => {
                if (window.confirm(`Archive ${bed.label}?`))
                  void archive.run(async () => {
                    await opsApi.inventory.beds.archive(bed.id);
                    window.location.hash = `${opsLinks.beds(roomId)}?archived=1`;
                  });
              }}
            >
              Archive bed
            </button>
          </div>
          <FormError message={archive.error} />
        </>
      )}
    </section>
  );
}
