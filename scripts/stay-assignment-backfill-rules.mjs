/** Quarantine inconsistent legacy facts rather than choose an assignment or violate the one-original constraint. */
export function backfillHistoryIssue(booking) {
  const stays = booking.checkIns;
  if (stays.filter((stay) => stay.status === 'ACTIVE').length > 1) return 'MULTIPLE_ACTIVE_CHECK_INS';
  if (stays.length > 1) return 'MULTIPLE_CHECK_IN_PERIODS';
  for (const stay of stays) {
    if (stay.organizationId !== booking.organizationId || stay.bookingId !== booking.id ||
        stay.residentId !== booking.residentId || stay.bedId !== booking.bedId) return 'INCONSISTENT_CHECK_IN_PARENT';
    if (!Number.isFinite(new Date(stay.checkInAt).getTime())) return 'INVALID_CHECK_IN_TIME';
    if (stay.status === 'ACTIVE' && stay.checkOut) return 'ACTIVE_WITH_CHECKOUT';
    if (stay.status === 'CHECKED_OUT' && !stay.checkOut) return 'LEGACY_CHECKED_OUT_NO_CHECKOUT';
    if (stay.checkOut) {
      const out = stay.checkOut;
      if (out.organizationId !== booking.organizationId || out.bookingId !== booking.id ||
          out.residentId !== booking.residentId || out.bedId !== booking.bedId || out.checkInId !== stay.id) return 'INCONSISTENT_CHECK_OUT_PARENT';
      if (!Number.isFinite(new Date(out.checkOutAt).getTime()) || new Date(out.checkOutAt) <= new Date(stay.checkInAt)) return 'INVALID_ASSIGNMENT_INTERVAL';
    }
  }
  return null;
}

/** Existing chains are retained, never rewritten; incompatible lifecycle history requires review. */
export function backfillAssignmentIssue(booking, assignments) {
  if (!assignments.length) return null;
  if (!booking.checkIns.length) return 'ASSIGNMENT_WITHOUT_CHECK_IN';
  const chain = [...assignments].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const stay = booking.checkIns[0];
  const original = chain.filter(segment => segment.kind === 'ORIGINAL');
  if (original.length !== 1 || chain[0] !== original[0] || original[0].bedId !== booking.bedId ||
      new Date(original[0].startAt).getTime() !== new Date(stay.checkInAt).getTime()) return 'INCONSISTENT_ORIGINAL_ASSIGNMENT';
  for (let i = 0; i < chain.length; i++) {
    const segment = chain[i];
    if (segment.organizationId !== booking.organizationId || segment.bookingId !== booking.id ||
        segment.residentId !== booking.residentId || !Number.isFinite(new Date(segment.startAt).getTime()) ||
        (segment.endAt !== null && (!Number.isFinite(new Date(segment.endAt).getTime()) || new Date(segment.endAt) <= new Date(segment.startAt)))) return 'INCONSISTENT_ASSIGNMENT_CHAIN';
    if (segment.status !== (segment.endAt === null ? 'ACTIVE' : 'COMPLETED')) return 'INCONSISTENT_ASSIGNMENT_CHAIN';
    if (i > 0 && (segment.kind !== 'TRANSFER' || !segment.transferId || chain[i - 1].endAt === null ||
        new Date(chain[i - 1].endAt).getTime() !== new Date(segment.startAt).getTime())) return 'INCONSISTENT_ASSIGNMENT_CHAIN';
    if (i > 0) {
      const transfer = segment.transfer;
      if (!transfer || transfer.organizationId !== booking.organizationId || transfer.bookingId !== booking.id ||
          transfer.residentId !== booking.residentId || transfer.sourceBedId !== chain[i - 1].bedId ||
          transfer.destinationBedId !== segment.bedId || new Date(transfer.effectiveAt).getTime() !== new Date(segment.startAt).getTime()) return 'INCONSISTENT_TRANSFER_ASSIGNMENT';
    }
  }
  const last = chain.at(-1);
  if (stay.status === 'ACTIVE' && last.endAt !== null) return 'INCONSISTENT_ASSIGNMENT_CHAIN';
  if (stay.status === 'CHECKED_OUT' && (last.endAt === null ||
      new Date(last.endAt).getTime() !== new Date(stay.checkOut.checkOutAt).getTime())) return 'INCONSISTENT_ASSIGNMENT_CHAIN';
  return null;
}
