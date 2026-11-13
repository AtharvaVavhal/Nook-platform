import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/client.js';

/** Active segments are authoritative; unbackfilled check-ins retain their original physical bed. */
export function activeBedOccupancyWhere(
  organizationId: string,
  target: string | string[],
): Prisma.CheckInWhereInput {
  const bedId = Array.isArray(target) ? { in: target } : target;
  return {
    organizationId,
    status: 'ACTIVE',
    checkOut: null,
    OR: [
      {
        booking: {
          effectiveAssignments: { some: { organizationId, bedId, status: 'ACTIVE', endAt: null } },
        },
      },
      { bedId, booking: { stayAssignments: { none: {} } } },
      // An ACTIVE check-in with no open segment is inconsistent. Conservatively protect every
      // bed in that history instead of silently freeing its last physical destination.
      {
        booking: {
          effectiveAssignments: { none: { status: 'ACTIVE', endAt: null } },
          stayAssignments: { some: { organizationId, bedId } },
        },
      },
    ],
  };
}

export function physicalBedId(stay: {
  bedId: string;
  booking: {
    stayAssignments?: { bedId: string; status: string; endAt: Date | null }[];
    effectiveAssignments?: { bedId: string; status: string; endAt: Date | null }[];
  };
}): string {
  const segments = stay.booking.effectiveAssignments ?? stay.booking.stayAssignments ?? [];
  if (!segments.length) return stay.bedId;
  const active = segments.filter(
    (segment) => segment.status === 'ACTIVE' && segment.endAt === null,
  );
  if (active.length !== 1) throw new ConflictException('Active stay assignment requires review');
  return active[0]!.bedId;
}

interface TimelineSegment {
  bookingId: string;
  residentId: string;
  kind: string;
  status: string;
  startAt: Date;
  endAt: Date | null;
}

/** Validate assignment adoption without changing the established check-in/out based billing rules. */
export function assertAssignmentTimeline(stay: {
  residentId: string;
  status: string;
  checkInAt: Date;
  checkOut: { checkOutAt: Date } | null;
  booking: {
    id: string;
    stayAssignments?: TimelineSegment[];
    effectiveAssignments?: TimelineSegment[];
  };
}): void {
  const chain = [...(stay.booking.effectiveAssignments ?? stay.booking.stayAssignments ?? [])].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
  if (!chain.length) return; // Deliberately retained compatibility for unbackfilled legacy stays.
  const fail = () => {
    throw new ConflictException({
      code: 'CONFLICT',
      message: 'Stay assignment history requires review before billing.',
    });
  };
  if (chain[0]!.kind !== 'ORIGINAL' || chain[0]!.startAt.getTime() !== stay.checkInAt.getTime())
    fail();
  for (let i = 0; i < chain.length; i++) {
    const segment = chain[i]!;
    if (
      segment.bookingId !== stay.booking.id ||
      segment.residentId !== stay.residentId ||
      !Number.isFinite(segment.startAt.getTime()) ||
      segment.status !== (segment.endAt === null ? 'ACTIVE' : 'COMPLETED') ||
      (segment.endAt !== null &&
        (!Number.isFinite(segment.endAt.getTime()) || segment.endAt <= segment.startAt))
    )
      fail();
    if (
      i > 0 &&
      (segment.kind !== 'TRANSFER' || chain[i - 1]!.endAt?.getTime() !== segment.startAt.getTime())
    )
      fail();
  }
  const last = chain.at(-1)!;
  if (stay.status === 'ACTIVE') {
    if (last.endAt !== null || stay.checkOut !== null) fail();
  } else if (!stay.checkOut || last.endAt?.getTime() !== stay.checkOut.checkOutAt.getTime()) fail();
}
