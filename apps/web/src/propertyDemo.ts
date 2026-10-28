export type BedStatus = 'available' | 'occupied' | 'unavailable';
export type StatusFilter = 'all' | BedStatus;
/** Schematic units, not surveyed metres. Origin: top left; +x right, +y down.
 * Beds are room-local; rooms/zones are floor-local. Elevation supports future 3D adapters.
 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Bed {
  id: string;
  status: BedStatus;
  bounds: Bounds;
  unavailableReason?: string;
}
export interface Room {
  id: string;
  bounds: Bounds;
  beds: Bed[];
}
export interface Floor {
  id: string;
  name: string;
  elevation: number;
  width: number;
  height: number;
  zones: { id: string; label: string; kind: 'corridor' | 'stairs' | 'common'; bounds: Bounds }[];
  rooms: Room[];
}
export const statusLabels: Record<BedStatus, string> = {
  available: 'Available',
  occupied: 'Occupied',
  unavailable: 'Unavailable',
};

export const bedStatuses: BedStatus[] = ['available', 'occupied', 'unavailable'];
export const demoProperty = { id: 'nook-house-demo', name: 'Nook House', location: 'Bengaluru' };

function room(id: string, states: BedStatus[], column: number): Room {
  return {
    id,
    bounds: { x: 20 + column * 320, y: 20, width: 300, height: 320 },
    beds: states.map((status, index) => ({
      id: String.fromCharCode(65 + index),
      status,
      bounds: {
        x: 28 + (index % 2) * 164,
        y: 94 + Math.floor(index / 2) * 112,
        width: 80,
        height: 90,
      },
      ...(status === 'unavailable'
        ? { unavailableReason: 'Held out of service for a fixture repair (demo).' }
        : {}),
    })),
  };
}
function floorLayout(elevation: number): Pick<Floor, 'elevation' | 'width' | 'height' | 'zones'> {
  return {
    elevation,
    width: 1000,
    height: 540,
    zones: [
      {
        id: 'corridor',
        label: 'Shared corridor',
        kind: 'corridor',
        bounds: { x: 20, y: 340, width: 940, height: 80 },
      },
      {
        id: 'stairs',
        label: 'Stairs / entry',
        kind: 'stairs',
        bounds: { x: 20, y: 420, width: 300, height: 100 },
      },
      {
        id: 'common',
        label: 'Shared lounge',
        kind: 'common',
        bounds: { x: 340, y: 420, width: 620, height: 100 },
      },
    ],
  };
}
// Fictional, read-only UI fixtures. No resident records or persisted data.
export const demoFloors: Floor[] = [
  {
    id: 'ground',
    name: 'Ground floor',
    ...floorLayout(0),
    rooms: [
      room('001', ['occupied', 'occupied', 'available', 'available'], 0),
      room('002', ['occupied', 'occupied', 'occupied', 'unavailable'], 1),
      room('003', ['available', 'occupied', 'occupied', 'available'], 2),
    ],
  },
  {
    id: 'first',
    name: 'First floor',
    ...floorLayout(340),
    rooms: [
      room('101', ['occupied', 'occupied', 'available', 'available'], 0),
      room('102', ['occupied', 'occupied', 'occupied', 'occupied'], 1),
      room('103', ['occupied', 'available', 'occupied', 'unavailable'], 2),
    ],
  },
  {
    id: 'second',
    name: 'Second floor',
    ...floorLayout(680),
    rooms: [
      room('201', ['occupied', 'available', 'occupied', 'occupied'], 0),
      room('202', ['available', 'occupied', 'unavailable', 'occupied'], 1),
      room('203', ['occupied', 'occupied', 'available', 'occupied'], 2),
    ],
  },
  { id: 'third', name: 'Third floor', ...floorLayout(1020), rooms: [] },
];
export function summarize(rooms: Room[]) {
  const beds = rooms.flatMap((item) => item.beds);
  return {
    rooms: rooms.length,
    beds: beds.length,
    available: beds.filter((bed) => bed.status === 'available').length,
    occupied: beds.filter((bed) => bed.status === 'occupied').length,
    unavailable: beds.filter((bed) => bed.status === 'unavailable').length,
  };
}
export function filterRooms(rooms: Room[], query: string, status: StatusFilter): Room[] {
  const search = query.trim().toLowerCase();
  return rooms.filter(
    (item) =>
      `room ${item.id}`.includes(search) &&
      (status === 'all' || item.beds.some((bed) => bed.status === status)),
  );
}
