# Bulk Room & Bed Creation

Phase 3, Task 1. Branch `feature/bulk-room-bed-creation`. Decisions D1–D9 are recorded in
`BULK_ROOM_BED_IMPLEMENTATION_PLAN.md` (section "Owner approval record"). Scope slice: `3.9` in
`scripts/phase_scope.json` and `docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md`.

An owner or property manager can create the rooms and beds of a whole hostel (for example 25 rooms and 100 beds)
in one request, preview it first, and be sure that either everything is created or nothing is.

## Endpoint

```
POST /api/v1/properties/:propertyId/rooms/bulk
```

Same guards as the single-record room routes: session, `Origin`, CSRF and `inventory.write` (OWNER and
PROPERTY_MANAGER). The organization always comes from the session; a body containing an organization field is
rejected.

Request:

```json
{
  "dryRun": false,
  "rooms": [
    {
      "floorId": "<uuid of an existing active floor of this property>",
      "label": "101",
      "beds": [
        { "label": "1", "operationalStatus": "IN_SERVICE" },
        { "label": "2", "operationalStatus": "OUT_OF_SERVICE", "outOfServiceReason": "Broken frame" }
      ]
    }
  ]
}
```

- `dryRun` is optional and defaults to `false`.
- `operationalStatus` is required for every bed (D3). `OUT_OF_SERVICE` requires `outOfServiceReason`;
  `IN_SERVICE` must not carry one. These are the rules of the single-bed route.
- `beds` may be empty or omitted: a room with no beds is allowed, as it is today.
- There is no capacity or room-type field. A room's capacity is the number of beds created for it (D5).
- Floors are never created here (D9). Every `floorId` must already exist.

### Limits (D2)

At most **100 rooms** and **200 beds** in total per request. The limits are identical for a dry-run and a real
submission. `rooms: []`, more than 100 rooms or more than 200 beds answer `400 INVALID_INPUT`.

### Responses

| Status | When | Body |
|---|---|---|
| `201` | Real submission succeeded | `{ data: { propertyId, dryRun: false, limits, summary: { rooms, beds }, rooms: [...] } }` with real ids |
| `200` | `dryRun: true` and the batch is valid | Same shape, `dryRun: true`, every `id` is `null`; nothing was saved |
| `400 INVALID_INPUT` | Malformed or invalid payload, over a limit | `details: [{ field, code }]`, **all** problems at once, with indexed paths such as `rooms[3].beds[1].label` |
| `404` | Property missing, archived or in another organization; any floor missing, archived, in another property or in another organization | These cases are deliberately indistinguishable |
| `409 DUPLICATE_ACTIVE_IDENTIFIER` | Duplicate identifiers | `details: [{ field, code }]` with `DUPLICATE_IN_REQUEST` or `DUPLICATE_EXISTING` |
| `409 INVENTORY_BUSY` | The organization gate timed out or the database picked this transaction as a deadlock victim | Nothing was written; the request can be retried |
| `401` / `403` | Not signed in; role without `inventory.write`; missing or wrong CSRF or origin | As for every inventory write |

### Uniqueness rules (unchanged)

Mirrored from the existing partial unique indexes, which stay the final authority:

- a room label is unique **per property** (across all floors), among active rooms;
- a bed label is unique **per room**, among active beds;
- labels of archived rooms or beds may be reused;
- comparison is exact (case-sensitive), as in the database.

If a concurrent writer takes a label between the check and the insert, the unique index raises, the whole
transaction rolls back and the caller receives the same `409 DUPLICATE_ACTIVE_IDENTIFIER`.

## Dry-run and submission share one code path

`parseBulkRoomsBody` (payload rules) and `findBulkConflicts` (duplicate rules) in
`apps/api/src/inventory/inventory.bulk.validation.ts`, plus the same repository method, serve both modes. The only
differences are that a dry-run takes no organization gate, inserts nothing and returns `null` ids. An integration
test asserts the same payload produces the same errors in both modes and that a dry-run leaves every table
unchanged.

A dry-run is a point-in-time answer: a later real submission can still fail with `409` if someone else took a label
in between. The UI handles this by returning to the edit step with the offending rows marked.

## Transaction and concurrency

A real submission runs in one `$transaction` with the existing `ORDINARY_TX_OPTIONS`. It first joins the
organization gate (`acquireOrgGate`), exactly as bed archive and bed-status changes do, so it cannot interleave
with a booking, admission or check-in transaction or with another inventory availability writer. It then
re-verifies the property and floors, checks existing room labels, and inserts all rooms and then all beds with
`createManyAndReturn` (two inserts, not one per row).

Consequence: while a bulk create runs, other writes in the same organization wait for the gate. The 100-bed case
is two inserts and finishes well inside the gate timeout.

The route only inserts. It never updates or deletes rooms, beds, bookings, admissions, check-ins, stays or
residents, and an integration test compares those tables before and after.

## Frontend

Route `#rooms/:propertyId/bulk`, opened from "Add multiple rooms" on the room list. Screen:
`apps/web/src/ops/BulkRooms.tsx`; pure logic and tests in `bulkRoomBedRules.ts` and `bulkRoomBedRules.test.ts`.

1. Add rooms with the pattern form (floor, optional prefix, first number, count, beds per room) or one blank room
   at a time.
2. Bed labels default to `1..n` and every label and status is editable (D1). New beds default to `IN_SERVICE`,
   shown and editable (D3).
3. A live counter shows rooms and beds against the 100 and 200 limits.
4. **Preview** runs quick local checks, then the server dry-run (D4). The review step shows totals, a per-floor
   breakdown and each room's beds, and states that nothing is saved yet.
5. **Create** sends one request. The button is disabled while it is in flight. Server field errors are mapped back
   onto the exact room and bed rows by their indexed paths. A rejected preview or submission shows one message
   (for a rejected submission it says nothing was created); an edit, a new attempt, going back or starting over
   clears it, so a stale message never sits next to a newer result.
6. On success the screen shows the counts and links to the room list.

## Tests

- `apps/api/test/inventory.bulk.test.ts` — payload parsing, indexed errors, limits, duplicate rules.
- `apps/api/test/integration/bulk-inventory.integration.test.ts` — real PostgreSQL: several rooms and beds, a
  100-bed hostel, maximum and over-limit, duplicates, archived-label reuse, invalid payloads, missing and
  archived properties and floors, authentication, CSRF and origin, cross-tenant requests, rollback after a partial
  insert, concurrent identical and conflicting batches, a race with an availability change, a held organization
  gate (the real advisory lock held on a second connection: `409 INVENTORY_BUSY` after about 3 s, nothing written, the
  same request succeeding once released, no lock or transaction left behind), dry-run persistence and
  consistency, and untouched existing data.
- `apps/web/src/ops/bulkRoomBedRules.test.ts` — label generation, draft validation, summary, request building and
  server-error mapping.

The integration file is registered in `scripts/ci/test-files.json` (full profile) and in the pinned list of
`scripts/ci/integration-test-reporter.test.js` (14 → 15 files).

## Known limitations

- **No audit trail (D6, out of scope).** The inventory module writes no audit events, and bulk creation adds none.
  Recording who created a batch would require adding audit writes to the inventory module, which is a separate
  change. (An earlier version of this note said the runtime database role cannot write `audit_events`. That is not
  supported: the role used by the CI integration profile holds `SELECT` and `INSERT` on `audit_events`, and the
  booking, admission, check-in, finance and transfer code writes to it. The grants of the production role have not
  been verified.) Until audit writes are added, a bulk batch cannot be attributed to a user from the database alone.
- No capacity or room-type field exists, by decision (D5).
- No floor creation in this flow (D9). A property with no floors gets a link to add one first.
- A dry-run does not reserve labels; a real submission can still return `409` if another user took one meanwhile.
- While a real batch runs, other writes in the same organization wait briefly on the organization gate.
- The screen has automated tests for its logic only. This repository has no component or browser test harness for
  `Inventory.tsx` either; the layout at 390 px and 1440 px has not been checked in a browser as part of this task.
