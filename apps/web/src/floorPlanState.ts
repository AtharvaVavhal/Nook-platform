import { filterRooms, type Floor, type StatusFilter } from './propertyDemo';

export type Selection = { floorId: string; roomId: string; bedId?: string };
export interface FloorPlanState {
  floorId: string;
  query: string;
  status: StatusFilter;
  selection: Selection | null;
}
export type FloorPlanAction =
  | { type: 'floor'; floorId: string; status?: StatusFilter }
  | { type: 'query'; query: string }
  | { type: 'status'; status: StatusFilter }
  | { type: 'select'; selection: Selection }
  | { type: 'clear-selection' }
  | { type: 'reset-filters' };

export const initialFloorPlanState: FloorPlanState = {
  floorId: 'first',
  query: '',
  status: 'all',
  selection: null,
};
export function floorPlanReducer(state: FloorPlanState, action: FloorPlanAction): FloorPlanState {
  switch (action.type) {
    case 'floor':
      return {
        floorId: action.floorId,
        query: '',
        status: action.status ?? 'all',
        selection: null,
      };
    case 'query':
      return { ...state, query: action.query, selection: null };
    case 'status':
      return { ...state, status: action.status, selection: null };
    case 'select':
      return action.selection.floorId === state.floorId
        ? { ...state, selection: action.selection }
        : state;
    case 'clear-selection':
      return { ...state, selection: null };
    case 'reset-filters':
      return { ...state, query: '', status: 'all', selection: null };
  }
}

/** Resolve IDs against current data on every render; never copy availability into UI state. */
export function resolveSelection(floor: Floor, state: FloorPlanState) {
  const selection = state.selection;
  if (!selection || selection.floorId !== floor.id || state.floorId !== floor.id) return null;
  const room = filterRooms(floor.rooms, state.query, state.status).find(
    (r) => r.id === selection.roomId,
  );
  if (!room) return null;
  const bed = room.beds.find((b) => b.id === selection.bedId);
  if (selection.bedId && (!bed || (state.status !== 'all' && bed.status !== state.status)))
    return null;
  return { room, bed };
}

/** Reject unusable schematic geometry instead of inventing a fallback floor or availability. */
export function isFloorLayoutValid(floor: Floor): boolean {
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  const fits = (bounds: Floor['rooms'][number]['bounds'], width: number, height: number) =>
    [bounds.x, bounds.y].every((v) => Number.isFinite(v) && v >= 0) &&
    positive(bounds.width) &&
    positive(bounds.height) &&
    bounds.x + bounds.width <= width &&
    bounds.y + bounds.height <= height;
  const unique = (items: { id: string }[]) =>
    new Set(items.map((item) => item.id)).size === items.length;
  return (
    positive(floor.width) &&
    positive(floor.height) &&
    Number.isFinite(floor.elevation) &&
    unique(floor.rooms) &&
    unique(floor.zones) &&
    floor.zones.every((zone) => fits(zone.bounds, floor.width, floor.height)) &&
    floor.rooms.every(
      (room) =>
        fits(room.bounds, floor.width, floor.height) &&
        unique(room.beds) &&
        room.beds.every(
          (bed) =>
            fits(bed.bounds, room.bounds.width, room.bounds.height) &&
            ['available', 'occupied', 'unavailable'].includes(bed.status),
        ),
    )
  );
}
