# Bulk Room & Bed Creation — Implementation Plan

Status: IMPLEMENTED after owner approval (see "Owner approval record" at the end). Written as a plan (Phase 3, Task 1, Step 1) before any code changed; implementation notes are in `BULK_ROOM_BED_CREATION.md`.
Branch: `feature/bulk-room-bed-creation`, created from `main` at `7c6aff4968255293a88337e99641b3e535b28daf`.

Everything below is taken from the repository as inspected. Where the repository does not answer a question, it is listed in section 12 as a decision for the owner. No schema field or business rule is invented here.

## 1. Existing architecture findings

**Backend (`apps/api`)**
- NestJS modular monolith. Inventory module: `apps/api/src/inventory/{controller,service,repository,types,validation,module}.ts`.
- Every mutating inventory route uses `@RequirePermission('inventory.write')` plus `OriginGuard` and `CsrfGuard`; the session guard is global. Permissions are default-deny, defined in `apps/api/src/auth/permissions.ts`.
- The service layer calls `assertRole` (via `canManageInventory`). OWNER and PROPERTY_MANAGER can write inventory.
- Validation is hand-rolled (not class-validator): `parseBody`, `parseUuid`, `labelField` (max 32 chars), `stringField` (1–200, no control characters), `operationalStatusField`, `outOfServiceReasonField`, `rejectOrganizationFields`. Errors are `400 { code: 'INVALID_INPUT', details: [{ field, code }] }`.
- Responses are wrapped `{ data: ... }`. A repository returning `null` becomes `404`.
- Prisma unique violation (`P2002`) maps to `409 { code: 'DUPLICATE_ACTIVE_IDENTIFIER' }`. Bed archive maps `BED_OCCUPIED` to `409`.
- Tenancy: every query carries `organizationId` taken from the session (`request.auth`), never from the client. Org fields in bodies are rejected.
- Transactions: single-row creates are not wrapped in a transaction. Availability-changing writers (`changeAvailability`: bed archive, room archive, bed status change) use `$transaction` with `acquireOrgGate(tx, organizationId)`, then lock beds in UUID order, with `ORDINARY_TX_OPTIONS` (`maxWait` 5 s, `timeout` 15 s) and a 3 s `lock_timeout`.
- Audit: the inventory module writes no audit events. (The existing integration test named "Audit events – runtime role has no audit_events access (blocker check)" only shows that an inventory create succeeds without needing an audit write; it does not show that the runtime role lacks access, and other modules write audit events through the same role.) Bulk creation therefore adds none without a separate decision (section 12, D6).

**Frontend (`apps/web`)**
- Hash-routed React app. Routes are parsed in `apps/web/src/ops/opsRoute.ts` (`room-new`, `bed-new`, `rooms`, `beds`, …). Screens are in `apps/web/src/ops/Inventory.tsx` (1,045 lines) with one single-record form each for property, floor, room and bed (`ops-form`, `noValidate`, per-field error state, `FormEvent` submit).
- API client: `apps/web/src/ops/opsApi.ts` (`api.inventory.rooms.create`, `api.inventory.beds.create`, …) with CSRF handling and `unwrap`. Role gating is in `apps/web/src/access.ts`.
- Tests next to code (`*.test.ts`, node test runner, no component tests for Inventory.tsx today). Pure logic is tested through extracted helpers (for example `correctionRules.ts` + `correctionRules.test.ts`, `floorPlanState.test.ts`).

**Testing / CI**
- Unit tests in `apps/api/test/*.test.ts`; integration tests in `apps/api/test/integration/*.integration.test.ts` against a disposable PostgreSQL, each starting with `import './helpers/preflight.js';`.
- Helpers: `helpers/{db,env,fixtures,guard,isolation,preflight,suite-lock,billing-fixtures}.ts`. `hostel-scale.integration.test.ts` already builds 100 beds (in waves of 20 to avoid connection resets) and is the closest precedent.
- `apps/api/test/route-inventory.ts` holds the route inventory used by `permission-layer.test.ts`.
- CI contract (`scripts/ci/check.js`): every `*.integration.test.ts` must be listed in `scripts/ci/test-files.json` (`full`), and `scripts/ci/integration-test-reporter.test.js` pins that list and its count (currently 14).
- Phase scope guard (`scripts/verify_phase_scope.py`, check S8): every API route must be in `baselineRoutes` or in the `routes` of an `approved` slice in `scripts/phase_scope.json` (approver, date, ref required).
- Jobs: `quality`, `full-integration`, `pilot-rehearsals`.

## 2. Relevant Prisma models and relationships

Hierarchy: `Organization → Property → Floor → Room → Bed`. All child links are composite and carry `organizationId`, so a cross-tenant parent is structurally impossible at the database level.

| Model | Fields relevant to creation | Constraints (migration `20261031154500_slice_2_2_foundation`) |
|---|---|---|
| Property | `id, organizationId, code, name, archivedAt` | unique `(organizationId, code)` where `archived_at IS NULL`; `@@unique([id, organizationId])` |
| Floor | `id, organizationId, propertyId, label, ordinal, archivedAt` | unique `(propertyId, ordinal)` active; unique `(propertyId, label)` active |
| Room | `id, organizationId, propertyId, floorId, label, archivedAt` | unique `(propertyId, label)` active — **room labels are unique per property, not per floor** |
| Bed | `id, organizationId, propertyId, roomId, label, operationalStatus (default IN_SERVICE), outOfServiceReason, archivedAt, price (unused)` | unique `(roomId, label)` active — **bed labels are unique per room** |

Facts that bound the design:
- `Room` has **no capacity, room-type, gender, rent or amenity fields**. "Capacity" in this codebase is the count of active beds in the room. The plan must not add a capacity column.
- `Bed.price` is documented as unused for billing and must not be set by bulk creation.
- Beds are referenced (restrict) by bookings, admissions, check-ins, check-outs, stay assignments, transfers. Bulk creation only inserts new rows and never updates or archives existing ones, so existing bookings and allocations cannot be affected.
- The uniqueness indexes are partial (`archived_at IS NULL`): an archived label may be re-used.

## 3. Existing API endpoints and gaps

Existing (all under `/api/v1`, all in approved slice 2.3):
- `GET /properties`, `GET /properties/:propertyId`
- `GET|POST /properties/:propertyId/floors`
- `GET|POST /properties/:propertyId/rooms` (`GET` supports `floorId`, `q`)
- `GET|POST /rooms/:roomId/beds`
- `PATCH` and `POST …/archive` for property, floor, room, bed
- `GET /inventory/summary`

Create inputs today: room `{ floorId, label }`; bed `{ label, operationalStatus (required), outOfServiceReason? }`.

Gaps:
1. No batch endpoint. Creating 100 beds today needs one room POST per room and one bed POST per bed (for example 25 + 100 requests), each in its own transaction, so a mid-way failure leaves a partial hostel.
2. No pre-validation: the only duplicate detection is the DB unique index, reported one row at a time.
3. Room and bed creation are not serialised against availability-changing writers (no org gate on create).
4. No audit trail on inventory writes (the inventory module writes no audit events).
5. The UI offers only single-record forms; there is no preview or summary.

## 4. Proposed API design

One new endpoint, one request, one transaction:

```
POST /api/v1/properties/:propertyId/rooms/bulk
Guards: SessionGuard, OriginGuard, CsrfGuard, @RequirePermission('inventory.write')
```

Request (organization fields rejected as everywhere else):

```json
{
  "rooms": [
    {
      "floorId": "<uuid>",
      "label": "101",
      "beds": [
        { "label": "A", "operationalStatus": "IN_SERVICE" },
        { "label": "B", "operationalStatus": "OUT_OF_SERVICE", "outOfServiceReason": "..." }
      ]
    }
  ]
}
```

- Only fields the existing create endpoints already accept: room `floorId`, `label`; bed `label`, `operationalStatus`, `outOfServiceReason`. Nothing else.
- Whether `operationalStatus` may be omitted per bed (single endpoint requires it) is decision D3.
- Limits (to be confirmed, D2): at most 100 rooms and 200 beds per request — enough for the ~100-bed target with headroom; `beds` per room may be empty (a room with zero beds is already creatable today).
- A `?dryRun=true` (or `"dryRun": true`) mode runs the identical validation and conflict detection inside a rolled-back transaction and returns the same result shape without writing. Decision D4 (preview computed client-side only vs server dry-run). Recommended: server dry-run, because only the server can see existing active labels.

Success `201`:

```json
{ "data": {
    "propertyId": "...",
    "summary": { "roomsCreated": 25, "bedsCreated": 100 },
    "rooms": [ { "id": "...", "floorId": "...", "label": "101", "beds": [ { "id": "...", "label": "A", "operationalStatus": "IN_SERVICE" } ] } ]
} }
```

Errors (reusing existing codes and shapes):
- `400 INVALID_INPUT` with `details: [{ field: "rooms[3].beds[1].label", code }]`. Field paths are indexed so the UI can mark the exact row. All problems in the batch are collected and returned together, not just the first.
- `404` when the property or any `floorId` is not found in the caller's organization (indistinguishable from cross-tenant, as today).
- `409 DUPLICATE_ACTIVE_IDENTIFIER` with `details` listing each conflicting room label and bed `(roomLabel, bedLabel)`: both duplicates inside the request and conflicts with existing active rooms.
- `413`/`400` for exceeding batch limits (reuse `INVALID_INPUT` with code `TOO_MANY`; D2).
- `403` for roles without `inventory.write`; `401` unauthenticated.

Atomicity: all-or-nothing. A failure anywhere rolls back every room and bed.

## 5. Proposed frontend workflow

New hash route `#rooms/:propertyId/bulk` (add `room-bulk` to `opsRoute.ts`), reached from a "Add multiple rooms" button on the room list (visible only where `inventory.write` is available, per `access.ts`).

1. Select property: implicit via the property whose room list the user came from (the property picker already exists on property screens).
2. Add rooms: a table, one row per room: floor (select from existing floors), room label. "Add row" and "Add N rows" helpers.
3. Beds per room: per row, a bed count that generates bed labels, with an editable list of labels (default numbering scheme is decision D1) and status (default IN_SERVICE).
4. Preview: read-only summary: rooms and beds per floor, total rooms and total beds, and a warning list.
5. Validate: client-side format checks (label ≤ 32 chars, no blanks, duplicates inside the batch) for fast feedback, then the server dry-run (D4) for conflicts against existing active labels.
6. Submit once: a single call; button disabled while in flight so a double click cannot send two requests.
7. Result: success summary (rooms created, beds created, per-floor breakdown) with a link back to the room list; failure shows row-level errors in place and nothing was created.

Pure logic (label generation, batch validation, summary) lives in a new tested helper, `bulkRoomBedRules.ts`, mirroring `correctionRules.ts`, so it can be unit tested without a DOM. UI follows the existing `ops-form` / `ui.tsx` conventions and mobile widths already used by the evidence screenshots.

## 6. Transaction and validation strategy

Validation order (all before any write, errors collected together):
1. Body shape, no org fields, batch limits.
2. Per-field checks with the existing helpers (`parseUuid`, `labelField`, `operationalStatusField`, `outOfServiceReasonField`) so single and bulk endpoints cannot drift.
3. In-request duplicates: duplicate room labels across the whole request (property-wide scope, matching `rooms_property_id_label_active_key`); duplicate bed labels within the same room (matching `beds_room_id_label_active_key`).
4. Cross-checks inside the transaction: property exists and is active in the caller's org; every distinct `floorId` exists, is active and belongs to the property; existing active room labels in the property do not collide.

Write path: one `prisma.db.$transaction(async tx => …, ORDINARY_TX_OPTIONS)`:
1. `acquireOrgGate(tx, organizationId)` (same gate used by archive and status changes, so a bulk create cannot interleave with an availability-changing write).
2. Re-read property and floors; re-check existing labels (`findMany` on active room labels for the property).
3. `room.createMany`/per-room create with returned ids; then `bed.createMany` using those ids. `propertyId` is taken from the verified room row, as `createBed` does today.
4. Return created rows.

Collision handling under concurrency: the pre-check gives friendly errors; the partial unique indexes are the final authority. A `P2002` raised inside the transaction rolls back everything and is mapped to `409 DUPLICATE_ACTIVE_IDENTIFIER` via the existing `handleDatabaseError`. Because the gate serialises same-organization bulk calls, two concurrent identical batches result in exactly one success and one `409`. A gate timeout (3 s) must surface as a clean retryable `409` the same way booking does today — to be confirmed against the existing gate-timeout mapping during implementation.

Existing bookings/allocations: insert-only. No UPDATE/DELETE of rooms, beds or any other table.

## 7. Authorization and tenant-isolation strategy

- `@RequirePermission('inventory.write')` + `assertRole` in the service, identical to single-record creation. OWNER and PROPERTY_MANAGER succeed; any other role gets 403; unauthenticated 401; missing/invalid CSRF or origin rejected by the existing guards.
- `organizationId` comes only from `request.auth`; bodies containing `organizationId`/`organization_id` are rejected via `rejectOrganizationFields`.
- Every repository query includes `organizationId`. A property or floor id from another organization is a plain 404.
- Composite foreign keys (`(roomId, propertyId, organizationId)`) make cross-tenant child rows impossible even if application code were wrong; the tests prove it end to end.
- The route must be added to `apps/api/test/route-inventory.ts` so `permission-layer.test.ts` proves it is permission-guarded.

## 8. Required schema changes

**None.** The existing tables and the partial unique indexes already express every rule the feature needs (room label unique per property, bed label unique per room). No new column, index, enum or migration is proposed. No capacity or room-type field is added (the model has none; see D5).

Migration impact: zero. The governance impact is the scope guard (section 10, item `scripts/phase_scope.json`): a new route needs an approved scope slice entry even though no schema changes.

## 9. Testing strategy

All integration tests use isolated synthetic organizations created by fixtures (no shared data), in a new `apps/api/test/integration/bulk-inventory.integration.test.ts`.

Unit (`apps/api/test/bulk-inventory.test.ts`): body parsing, per-field and indexed-path errors, batch limits, in-request duplicate detection, org-field rejection, label rules shared with the single endpoints.

Integration:
1. Multi-room: 3 rooms across 2 floors, zero beds each → created, response shape.
2. Multi-bed: rooms with 1/2/4 beds; labels, statuses and `propertyId`/`organizationId` on every row correct.
3. 100-bed scenario: 25 rooms × 4 beds in one request; asserts 25 rooms/100 beds, one transaction, `GET /inventory/summary` totals, runtime within the CI time budget.
4. Duplicates: same room label twice in the batch; same bed label twice in one room; label already active in the property; label of an archived room is allowed.
5. Invalid capacities/inputs: empty `rooms`, over-limit rooms/beds, label empty or > 32, control characters, bad status, `OUT_OF_SERVICE` without reason, non-UUID floor.
6. Unauthorized: unauthenticated 401; role without `inventory.write` 403; missing CSRF; wrong origin.
7. Cross-tenant: org B using org A property id and floor id → 404 and zero rows written; body containing `organizationId` → 400.
8. Rollback: batch whose last bed collides → zero rooms and zero beds persisted (row counts before == after); also a forced mid-transaction failure.
9. Concurrency: two identical batches in parallel → exactly one 201 and one 409, no partial rows; two disjoint batches in parallel both succeed; bulk create racing a bed archive/status change both complete without deadlock.
10. Existing bookings unchanged: with an active booking/admission on an existing bed, run a bulk create and assert booking, admission and bed rows (including `updatedAt`) are unchanged.
11. Dry-run (if D4 = server): same result as real validation, zero rows written.

Web unit tests (`apps/web/src/ops/bulkRoomBedRules.test.ts`): label generation, in-batch duplicate detection, totals/summary, mapping of server error paths to rows.

CI wiring: add the new integration file to `scripts/ci/test-files.json` (`full`) and to the pinned list/count in `scripts/ci/integration-test-reporter.test.js` (14 → 15); first import is `import './helpers/preflight.js';`. Existing `check.js` rules then pass.

## 10. Exact files expected to be created / modified

Created:
- `apps/api/src/inventory/inventory.bulk.validation.ts` (bulk body parsing; reuses `inventory.validation.ts` helpers)
- `apps/api/test/bulk-inventory.test.ts`
- `apps/api/test/integration/bulk-inventory.integration.test.ts`
- `apps/web/src/ops/bulkRoomBedRules.ts`, `apps/web/src/ops/bulkRoomBedRules.test.ts`
- `apps/web/src/ops/BulkRooms.tsx` (screen; alternatively added to `Inventory.tsx`, D7)
- `docs/phase-3/BULK_ROOM_BED_CREATION.md` (operator/developer notes, written at implementation time)

Modified:
- `apps/api/src/inventory/inventory.controller.ts` (new route)
- `apps/api/src/inventory/inventory.service.ts` (`bulkCreateRooms`, error mapping)
- `apps/api/src/inventory/inventory.repository.ts` (transactional bulk create)
- `apps/api/src/inventory/inventory.types.ts` (repository interface)
- `apps/api/test/route-inventory.ts` (route entry)
- `apps/web/src/ops/opsApi.ts` (`inventory.rooms.bulkCreate`)
- `apps/web/src/ops/opsRoute.ts` (route + `href` helper)
- `apps/web/src/ops/Inventory.tsx` ("Add multiple rooms" entry point on the room list)
- `apps/web/src/App.tsx` / `ops/OpsShell.tsx` only if route rendering is registered there
- `scripts/phase_scope.json` and the matching scope register doc under `docs/nook-phase-3/` (new approved slice for the route; **requires owner approval, D8**)
- `scripts/ci/test-files.json`, `scripts/ci/integration-test-reporter.test.js` (register the new integration file)

Not modified: `prisma/schema.prisma`, `prisma/migrations/**`, `.github/workflows/**`, risk acceptance document.

## 11. Implementation sequence

1. Owner decisions D1–D8 answered; scope slice approved (`phase_scope.json` + register doc).
2. API validation module + unit tests (red/green).
3. Repository transaction + service + controller + `route-inventory.ts`.
4. Integration test file; register in CI list/pinned names; run `quality` steps and the disposable full integration profile locally (`scripts/qa/phase4-disposable.mjs full regression`, which writes untracked evidence only).
5. Frontend: `bulkRoomBedRules` + tests, `opsApi`, route, screen, entry point; typecheck, lint, web tests.
6. Mobile/desktop manual check of the screen with synthetic data.
7. Docs, then stage only reviewed files, commit, push, open PR `feat: add bulk room and bed creation` (no merge) — only when that later step is authorized.

## 12. Risks and unresolved decisions

Decisions needed from the owner (no default has been assumed in the plan beyond "recommended"):
- **D1 Label scheme.** What bed labels does the generator propose (A/B/C, 1/2/3, room-prefixed)? Existing data uses free-form labels ≤ 32 chars. Recommended: editable, default `1..n`, nothing enforced by the server.
- **D2 Batch limits.** Proposed 100 rooms / 200 beds per request. Confirm.
- **D3 Bed status in bulk.** Single endpoint requires `operationalStatus`. Recommended: bulk defaults to `IN_SERVICE` when omitted (the schema default), `OUT_OF_SERVICE` still requires a reason.
- **D4 Preview.** Client-only vs server dry-run. Recommended: server dry-run for conflict accuracy.
- **D5 Capacity / room type.** The model has none, and none is added. If the owner expects "capacity" or "room type" per room, that is a separate schema decision and out of scope here.
- **D6 Audit logging.** The inventory module writes no audit events today. Adding them is a separate change in the inventory module; the production runtime role's grants on `audit_events` would first have to be verified (they have not been). Recommended: out of scope for this task; document the gap.
- **D7 Screen placement.** New `BulkRooms.tsx` vs extending the 1,045-line `Inventory.tsx`.
- **D8 Governance.** A new route needs an approved slice in `scripts/phase_scope.json`; approver and ref must be supplied by the owner. The plan does not self-approve.
- **D9 Floor creation.** Bulk covers rooms and beds on existing floors only; creating floors inline is excluded (floors have `ordinal` rules). Confirm.

Risks:
- Org gate contention: a long bulk call blocks bookings/admissions for the same organization for its duration; mitigated by keeping the transaction to a handful of statements (`createMany`) well inside 15 s; verify with the 100-bed test.
- Gate timeout mapping (3 s) for bulk callers must return a clean retryable error, not a 500.
- Room label uniqueness is per property, not per floor; the UI must say so, or users will see surprising conflicts such as "101" on two floors.
- Prisma `createMany` does not return rows; the implementation must pre-generate UUIDs or re-select by label within the transaction.
- Partial indexes allow re-use of archived labels; this is intentional and tested, not a bug.
- Adding an integration file touches the CI pinned list; forgetting either place fails `quality`.
- No audit trail (D6).

## 13. Acceptance criteria

1. One `POST /api/v1/properties/:propertyId/rooms/bulk` request creates all requested rooms and beds in one transaction; any failure leaves zero new rows.
2. A 25-room / 100-bed batch succeeds in one request and `GET /inventory/summary` reflects exactly +25 rooms and +100 beds.
3. Duplicate room labels (in the request or existing active in the property) and duplicate bed labels (within a room) are rejected with `409 DUPLICATE_ACTIVE_IDENTIFIER` and identify every offending label; archived labels may be reused.
4. Invalid inputs return `400 INVALID_INPUT` with indexed field paths, all errors reported together.
5. Unauthenticated → 401; role without `inventory.write` → 403; missing CSRF/origin → rejected; route present in `route-inventory.ts` with the permission.
6. Cross-tenant property/floor ids → 404 and no rows written; bodies carrying organization ids → 400.
7. Concurrent identical batches yield exactly one success and one 409; no deadlock with concurrent archive/status changes.
8. Existing bookings, admissions and beds are byte-for-byte unchanged by a bulk create.
9. The UI supports property → rooms → beds per room → preview → validation → single submit → clear success/failure summary, and works at 390 px and 1440 px widths.
10. No change to `prisma/schema.prisma` or migrations; no workflow change; `scripts/phase_scope.json` slice approved by the owner; the new integration file is registered in both CI lists.
11. `quality`, `full-integration` and `pilot-rehearsals` are green on the PR; the PR is not merged without explicit authorization.

## Owner approval record

Recorded 2026-11-13 from the owner's "Owner Approval and Phase 3 Implementation Authorization" instruction for branch `feature/bulk-room-bed-creation` (base `7c6aff4968255293a88337e99641b3e535b28daf`). These answers resolve section 12 and supersede the "recommended" wording there.

| Decision | Owner answer |
|---|---|
| D1 Bed labels | Generate `1..n` by default; editable before submission. |
| D2 Batch limits | Maximum 100 rooms and 200 beds per request, identical for preview and submission. |
| D3 Bed status | The API requires an explicit status per bed. The frontend defaults new beds to `IN_SERVICE`, visible and editable. |
| D4 Preview | Server-side dry-run. Preview and submission share validation logic. A dry-run persists nothing. |
| D5 Capacity / room type | Not added. Capacity means the number of beds created for a room. No Prisma schema change. |
| D6 Audit logging | Out of scope. No change to database privileges or audit schema. The gap is documented in `docs/phase-3/BULK_ROOM_BED_CREATION.md`. |
| D7 Screen placement | Separate `BulkRooms.tsx`. |
| D8 Phase-scope approval | Approved for the single route `POST /api/v1/properties/:propertyId/rooms/bulk` and its tests only. Not extended to any other route or operation. |
| D9 Floors | Out of scope. Rooms and beds only, on existing floors. |

Implementation notes that follow from these answers:
- The dry-run is selected by `"dryRun": true` in the request body of the same route (no second route). A dry-run answers `200`; a real submission answers `201`.
- Where section 4 says a missing floor is a `404`, that stays: a floor that is missing, archived, in another property or in another organization is indistinguishable from a missing property.
- Duplicate conflicts (inside the request, or against an active room already in the property) answer `409 DUPLICATE_ACTIVE_IDENTIFIER` with indexed `details`.
- A gate wait timeout or database deadlock answers `409 INVENTORY_BUSY`; nothing was written and the request can be retried.
