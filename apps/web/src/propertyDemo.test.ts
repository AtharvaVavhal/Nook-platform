import assert from 'node:assert/strict';
import test from 'node:test';
import { demoFloors, filterRooms, summarize } from './propertyDemo';

test('property snapshot accounts for every demo bed exactly once', () => {
  const totals = summarize(demoFloors.flatMap((floor) => floor.rooms));
  assert.deepEqual(totals, { rooms: 9, beds: 36, available: 10, occupied: 23, unavailable: 3 });
  assert.equal(totals.available + totals.occupied + totals.unavailable, totals.beds);
});

test('room search and status filter combine without losing layout context', () => {
  const rooms = demoFloors.find((floor) => floor.id === 'first')!.rooms;
  assert.deepEqual(
    filterRooms(rooms, ' ROOM 103 ', 'unavailable').map((room) => room.id),
    ['103'],
  );
  assert.equal(filterRooms(rooms, '102', 'available').length, 0);
  assert.equal(filterRooms(rooms, '101', 'available')[0]?.beds.length, 4);
  assert.equal(filterRooms(rooms, '', 'all').length, 3);
  assert.equal(filterRooms(rooms, '999', 'all').length, 0);
});

test('an empty floor has a zero snapshot and no search results', () => {
  const empty = demoFloors.find((floor) => floor.id === 'third')!;
  assert.deepEqual(summarize(empty.rooms), {
    rooms: 0,
    beds: 0,
    available: 0,
    occupied: 0,
    unavailable: 0,
  });
  assert.deepEqual(filterRooms(empty.rooms, '', 'all'), []);
});
