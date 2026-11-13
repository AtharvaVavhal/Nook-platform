import { Prisma } from '../generated/client.js';
import { CorrectionError, parseZonedInstant } from '../corrections/corrections.rules.js';
import { auditRequestId } from '../observability/request-context.js';

type Tx = Prisma.TransactionClient;
export interface AssignmentSegment {
  id: string;
  bedId: string;
  kind: string;
  status: string;
  startAt: string;
  endAt: string | null;
  replaceStart: boolean;
  replaceEnd: boolean;
}
const conflict = (message: string): never => {
  throw new CorrectionError(409, 'LIFECYCLE_CONFLICT', message);
};

/** Exact canonical microsecond values; only the requested outer boundary can change. */
export function replacementSegments(
  before: AssignmentSegment[],
  field: 'checkInAt' | 'checkOutAt',
  raw: string,
): AssignmentSegment[] {
  if (!before.length) return [];
  const value = parseZonedInstant(raw, field).canonical;
  const segments = before.map((segment) => ({ ...segment }));
  const first = segments[0]!,
    last = segments.at(-1)!;
  if (field === 'checkInAt') {
    if (first.kind !== 'ORIGINAL' || (first.endAt !== null && value >= first.endAt))
      conflict('Corrected check-in must precede the first assignment end');
    first.startAt = value;
    first.replaceStart = true;
  } else {
    if (last.status !== 'COMPLETED' || last.endAt === null || value <= last.startAt)
      conflict('Corrected checkout must follow the final assignment start');
    last.endAt = value;
    last.replaceEnd = true;
  }
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment.endAt !== null && segment.endAt <= segment.startAt)
      conflict('Corrected assignment interval must be positive');
    if (i > 0 && segments[i - 1]!.endAt !== segment.startAt)
      conflict('Assignment history is not continuous');
  }
  return segments;
}

export async function planAssignmentReplacement(
  tx: Tx,
  organizationId: string,
  bookingId: string,
  field: 'checkInAt' | 'checkOutAt',
  value: string,
) {
  const before = await tx.$queryRaw<AssignmentSegment[]>(Prisma.sql`
    SELECT e.id,e.bed_id AS "bedId",e.kind::text,e.status::text,
      to_char(e.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "startAt",
      to_char(e.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "endAt",
      e.start_at IS DISTINCT FROM s.start_at AS "replaceStart",e.end_at IS DISTINCT FROM s.end_at AS "replaceEnd"
    FROM effective_stay_assignments e JOIN stay_assignments s ON s.id=e.id AND s.organization_id=e.organization_id
    WHERE e.organization_id=${organizationId}::uuid AND e.booking_id=${bookingId}::uuid ORDER BY e.start_at,e.id`);
  const segments = replacementSegments(before, field, value);
  if (!segments.length) return null;
  const changed = field === 'checkInAt' ? segments[0]! : segments.at(-1)!;
  const collisions = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT s.id FROM effective_stay_assignments s WHERE s.organization_id=${organizationId}::uuid AND s.booking_id<>${bookingId}::uuid
      AND (s.bed_id=${changed.bedId}::uuid OR s.resident_id=(SELECT resident_id FROM bookings WHERE id=${bookingId}::uuid AND organization_id=${organizationId}::uuid))
      AND s.start_at<COALESCE(${changed.endAt}::timestamptz,'infinity'::timestamptz)
      AND COALESCE(s.end_at,'infinity'::timestamptz)>${changed.startAt}::timestamptz
    UNION ALL
    SELECT c.id FROM check_ins c LEFT JOIN check_outs o ON o.check_in_id=c.id AND o.organization_id=c.organization_id
    WHERE c.organization_id=${organizationId}::uuid AND c.booking_id<>${bookingId}::uuid
      AND (c.bed_id=${changed.bedId}::uuid OR c.resident_id=(SELECT resident_id FROM bookings WHERE id=${bookingId}::uuid AND organization_id=${organizationId}::uuid))
      AND NOT EXISTS(SELECT 1 FROM stay_assignments s WHERE s.organization_id=c.organization_id AND s.booking_id=c.booking_id)
      AND c.check_in_at<COALESCE(${changed.endAt}::timestamptz,'infinity'::timestamptz)
      AND COALESCE(o.check_out_at,'infinity'::timestamptz)>${changed.startAt}::timestamptz LIMIT 1`);
  if (collisions.length) conflict('The corrected physical assignment would overlap another stay');
  return { before, segments };
}

/** Called only inside an already-authorized correction transaction; the existing financial flag still gates that command. */
export async function recordAssignmentReplacement(
  tx: Tx,
  input: {
    organizationId: string;
    bookingId: string;
    residentId: string;
    proposalId: string;
    actorUserId: string;
    field: 'checkInAt' | 'checkOutAt';
    value: string;
  },
) {
  const plan = await planAssignmentReplacement(
    tx,
    input.organizationId,
    input.bookingId,
    input.field,
    input.value,
  );
  if (!plan) return null;
  const previous = await tx.stayAssignmentReplacement.findFirst({
    where: { organizationId: input.organizationId, bookingId: input.bookingId },
    orderBy: { version: 'desc' },
  });
  const replacement = await tx.stayAssignmentReplacement.create({
    data: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      residentId: input.residentId,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId,
      fieldKey: input.field,
      version: (previous?.version ?? 0) + 1,
      beforeSegments: plan.before as unknown as Prisma.InputJsonValue,
      segments: plan.segments as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'stay_assignment.reconciled',
      targetType: 'booking',
      targetId: input.bookingId,
      requestId: auditRequestId(),
      metadata: {
        replacementId: replacement.id,
        proposalId: input.proposalId,
        fieldKey: input.field,
        version: replacement.version,
      },
    },
  });
  return replacement;
}
