import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/client.js';

/** R1 is not approved. There is no environment switch or client-controlled activation path. */
@Injectable()
export class AssignmentAdoptionGate {
  enabled(_organizationId: string): boolean {
    void _organizationId;
    return false;
  }
}

/** New-stay mirroring infrastructure; called in the check-in transaction only after all lifecycle validations. */
@Injectable()
export class OriginalAssignmentWriter {
  constructor(@Inject(AssignmentAdoptionGate) private readonly gate: AssignmentAdoptionGate) {}
  async mirror(tx: Prisma.TransactionClient, organizationId: string, checkInId: string) {
    if (!this.gate.enabled(organizationId)) return null;
    const stay = await tx.checkIn.findFirst({
      where: { id: checkInId, organizationId, status: 'ACTIVE', checkOut: null },
    });
    if (!stay) throw new ConflictException('An original assignment requires an active check-in');
    const existing = await tx.stayAssignment.findFirst({
      where: { organizationId, bookingId: stay.bookingId, kind: 'ORIGINAL' },
    });
    if (existing) {
      if (existing.residentId !== stay.residentId || existing.bedId !== stay.bedId)
        throw new ConflictException('Original assignment requires review');
      return existing;
    }
    // Preserve the database instant exactly, including microseconds from a legacy/source writer.
    await tx.$executeRaw`INSERT INTO stay_assignments(organization_id,booking_id,resident_id,bed_id,kind,status,start_at)
      SELECT organization_id,booking_id,resident_id,bed_id,'ORIGINAL'::"StayAssignmentKind",'ACTIVE'::"StayAssignmentStatus",check_in_at
      FROM check_ins WHERE id=${checkInId}::uuid AND organization_id=${organizationId}::uuid AND status='ACTIVE'`;
    return tx.stayAssignment.findFirstOrThrow({
      where: { organizationId, bookingId: stay.bookingId, kind: 'ORIGINAL' },
    });
  }
}
