export type BedStatus = 'available' | 'occupied' | 'unavailable';
export type StatusFilter = 'all' | BedStatus;
export interface Room {
  id: string;
  beds: { id: string; status: BedStatus }[];
}
export interface Floor {
  id: string;
  name: string;
  rooms: Room[];
}
export const statusLabels: Record<BedStatus, string> = {
  available: 'Available',
  occupied: 'Occupied',
  unavailable: 'Unavailable',
};

function room(id: string, states: BedStatus[]): Room {
  return {
    id,
    beds: states.map((status, index) => ({ id: String.fromCharCode(65 + index), status })),
  };
}
// Fictional, read-only UI fixtures. No resident records or persisted data.
export const demoFloors: Floor[] = [
  {
    id: 'ground',
    name: 'Ground floor',
    rooms: [
      room('001', ['occupied', 'occupied', 'available', 'available']),
      room('002', ['occupied', 'occupied', 'occupied', 'unavailable']),
      room('003', ['available', 'occupied', 'occupied', 'available']),
    ],
  },
  {
    id: 'first',
    name: 'First floor',
    rooms: [
      room('101', ['occupied', 'occupied', 'available', 'available']),
      room('102', ['occupied', 'occupied', 'occupied', 'occupied']),
      room('103', ['occupied', 'available', 'occupied', 'unavailable']),
    ],
  },
  {
    id: 'second',
    name: 'Second floor',
    rooms: [
      room('201', ['occupied', 'available', 'occupied', 'occupied']),
      room('202', ['available', 'occupied', 'unavailable', 'occupied']),
      room('203', ['occupied', 'occupied', 'available', 'occupied']),
    ],
  },
  { id: 'third', name: 'Third floor', rooms: [] },
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
