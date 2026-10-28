import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoFloors, type Bounds } from './propertyDemo';
import {
  floorPlanReducer,
  initialFloorPlanState,
  isFloorLayoutValid,
  resolveSelection,
} from './floorPlanState';
import { FloorPlan } from './components/FloorPlan';

const first = demoFloors.find((floor) => floor.id === 'first')!;
const selected = floorPlanReducer(initialFloorPlanState, {
  type: 'select',
  selection: { floorId: 'first', roomId: '103', bedId: 'D' },
});

test('bed selection resolves the source record and operational reason without copying status', () => {
  const result = resolveSelection(first, selected);
  assert.equal(result?.room, first.rooms[2]);
  assert.equal(result?.bed, first.rooms[2]?.beds[3]);
  assert.equal(result?.bed?.status, 'unavailable');
  assert.match(result?.bed?.unavailableReason ?? '', /fixture repair/);
  const updated = structuredClone(first);
  updated.rooms[2]!.beds[3]!.status = 'available';
  assert.equal(resolveSelection(updated, selected)?.bed?.status, 'available');
});

test('switching floor clears selection, search and status; cross-floor selection is rejected', () => {
  const next = floorPlanReducer(
    { ...selected, query: '103', status: 'unavailable' },
    { type: 'floor', floorId: 'second' },
  );
  assert.deepEqual(next, { floorId: 'second', query: '', status: 'all', selection: null });
  assert.equal(resolveSelection(demoFloors[2]!, selected), null);
  assert.equal(
    floorPlanReducer(next, {
      type: 'select',
      selection: { floorId: 'first', roomId: '103', bedId: 'D' },
    }),
    next,
  );
});

test('room selection replaces bed selection and invalid or hidden references cannot resolve', () => {
  const next = floorPlanReducer(selected, {
    type: 'select',
    selection: { floorId: 'first', roomId: '101' },
  });
  assert.equal(resolveSelection(first, next)?.room.id, '101');
  assert.equal(resolveSelection(first, next)?.bed, undefined);
  for (const selection of [
    { floorId: 'first', roomId: '999' },
    { floorId: 'first', roomId: '103', bedId: 'Z' },
  ])
    assert.equal(resolveSelection(first, { ...selected, selection }), null);
  assert.equal(resolveSelection(first, { ...selected, status: 'available' }), null);
  assert.equal(resolveSelection(first, { ...selected, query: '101' }), null);
});

test('filters and clear selection never mutate the underlying demonstration inventory', () => {
  const before = JSON.stringify(demoFloors);
  assert.equal(floorPlanReducer(selected, { type: 'query', query: '102' }).selection, null);
  assert.equal(floorPlanReducer(selected, { type: 'status', status: 'occupied' }).selection, null);
  assert.equal(floorPlanReducer(selected, { type: 'clear-selection' }).selection, null);
  const reset = floorPlanReducer(
    { ...selected, query: '103', status: 'unavailable' },
    { type: 'reset-filters' },
  );
  assert.deepEqual(reset, initialFloorPlanState);
  assert.equal(JSON.stringify(demoFloors), before);
});

test('all fixtures have valid, non-overlapping spatial bounds and unique floor IDs', () => {
  const overlaps = (a: Bounds, b: Bounds) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const disjoint = (items: { bounds: Bounds }[]) =>
    items.forEach((item, i) =>
      items
        .slice(i + 1)
        .forEach((other) => assert.equal(overlaps(item.bounds, other.bounds), false)),
    );
  assert.equal(new Set(demoFloors.map((floor) => floor.id)).size, demoFloors.length);
  for (const floor of demoFloors) {
    assert.ok(isFloorLayoutValid(floor));
    disjoint([...floor.rooms, ...floor.zones]);
    for (const room of floor.rooms) {
      disjoint(room.beds);
      for (const bed of room.beds)
        if (bed.status === 'unavailable') assert.ok(bed.unavailableReason);
    }
  }
});

test('invalid geometry and duplicate IDs fail validation', () => {
  assert.equal(isFloorLayoutValid({ ...first, width: 0 }), false);
  assert.equal(isFloorLayoutValid({ ...first, height: NaN }), false);
  assert.equal(isFloorLayoutValid({ ...first, rooms: [first.rooms[0]!, first.rooms[0]!] }), false);
  const invalid = structuredClone(first);
  invalid.rooms[0]!.beds[0]!.bounds.x = 1000;
  assert.equal(isFloorLayoutValid(invalid), false);
});

test('missing floor renders an honest error; empty floor and no-match views offer recovery', () => {
  const render = (state: typeof initialFloorPlanState) =>
    renderToStaticMarkup(createElement(FloorPlan, { state, dispatch: () => undefined }));
  assert.match(render({ ...initialFloorPlanState, floorId: 'missing' }), /role="alert"/);
  assert.match(
    render({ ...initialFloorPlanState, floorId: 'missing' }),
    /No availability can be inferred/,
  );
  assert.match(render({ ...initialFloorPlanState, floorId: 'third' }), /A little room to grow/);
  assert.match(render({ ...initialFloorPlanState, query: '999' }), /No matching rooms/);
  const details = render(selected);
  assert.match(details, /Room 103 · Bed D/);
  assert.match(details, /fixture repair/);
  assert.match(details, /no backend confirmation is connected/);
});
