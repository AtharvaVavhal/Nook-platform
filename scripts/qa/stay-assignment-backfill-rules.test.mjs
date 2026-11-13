import assert from 'node:assert/strict';
import test from 'node:test';
import { backfillHistoryIssue } from '../stay-assignment-backfill-rules.mjs';
function fixture() {
  const booking={id:'booking',organizationId:'org',residentId:'resident',bedId:'bed',checkIns:[]};
  const stay={id:'stay',organizationId:'org',bookingId:'booking',residentId:'resident',bedId:'bed',status:'ACTIVE',checkInAt:new Date('2020-01-01'),checkOut:null};
  return {...booking,checkIns:[stay]};
}
function completed() {
  const booking=fixture(),stay=booking.checkIns[0]; stay.status='CHECKED_OUT';
  stay.checkOut={checkInId:stay.id,organizationId:'org',bookingId:'booking',residentId:'resident',bedId:'bed',checkOutAt:new Date('2021-01-01')};
  return booking;
}
test('consistent active/completed/empty histories are eligible without mutation',()=>{
  for(const booking of [fixture(),completed(),{...fixture(),checkIns:[]}]) {
    const before=structuredClone(booking);assert.equal(backfillHistoryIssue(booking),null);assert.deepEqual(booking,before);
  }
});
test('ambiguous histories are quarantined before creating any original assignment',()=>{
  const duplicate=fixture();duplicate.checkIns.push({...duplicate.checkIns[0]});
  assert.equal(backfillHistoryIssue(duplicate),'MULTIPLE_ACTIVE_CHECK_INS');
  const multiple=completed();multiple.checkIns.push({...multiple.checkIns[0]});
  assert.equal(backfillHistoryIssue(multiple),'MULTIPLE_CHECK_IN_PERIODS');
  const contradictory=completed();contradictory.checkIns[0].status='ACTIVE';
  assert.equal(backfillHistoryIssue(contradictory),'ACTIVE_WITH_CHECKOUT');
  const orphan=fixture();orphan.checkIns[0].status='CHECKED_OUT';
  assert.equal(backfillHistoryIssue(orphan),'LEGACY_CHECKED_OUT_NO_CHECKOUT');
});
test('tenant, resident, bed and interval inconsistencies cannot be silently backfilled',()=>{
  for(const field of ['organizationId','residentId','bedId','bookingId']) {
    const booking=fixture();booking.checkIns[0][field]='foreign';assert.equal(backfillHistoryIssue(booking),'INCONSISTENT_CHECK_IN_PARENT');
    const out=completed();out.checkIns[0].checkOut[field]='foreign';assert.equal(backfillHistoryIssue(out),'INCONSISTENT_CHECK_OUT_PARENT');
  }
  const zero=completed();zero.checkIns[0].checkOut.checkOutAt=zero.checkIns[0].checkInAt;
  assert.equal(backfillHistoryIssue(zero),'INVALID_ASSIGNMENT_INTERVAL');
});

test('existing original/transfer chains are retained only when continuous and consistent with the stay', async () => {
  const { backfillAssignmentIssue } = await import('../stay-assignment-backfill-rules.mjs');
  const booking = fixture();
  const original = { organizationId: 'org', bookingId: 'booking', residentId: 'resident', bedId: 'bed', kind: 'ORIGINAL',
    startAt: new Date('2020-01-01'), endAt: new Date('2020-02-01'), status: 'COMPLETED' };
  const destination = { ...original, bedId: 'destination', kind: 'TRANSFER', transferId: 'transfer', startAt: original.endAt, endAt: null, status: 'ACTIVE' };
  destination.transfer = { organizationId: 'org', bookingId: 'booking', residentId: 'resident', sourceBedId: 'bed', destinationBedId: 'destination', effectiveAt: destination.startAt };
  const chain = [original, destination];
  const before = structuredClone(chain);
  assert.equal(backfillAssignmentIssue(booking, chain), null);
  assert.deepEqual(chain, before);
  assert.equal(backfillAssignmentIssue(booking, [{ ...original, startAt: new Date('2019-01-01') }, destination]), 'INCONSISTENT_ORIGINAL_ASSIGNMENT');
  assert.equal(backfillAssignmentIssue(booking, [original, { ...destination, residentId: 'foreign' }]), 'INCONSISTENT_ASSIGNMENT_CHAIN');
  assert.equal(backfillAssignmentIssue(booking, [original, { ...destination, startAt: new Date('2020-03-01') }]), 'INCONSISTENT_ASSIGNMENT_CHAIN');
  assert.equal(backfillAssignmentIssue(booking, [original, { ...destination, transfer: { ...destination.transfer, bookingId: 'foreign' } }]), 'INCONSISTENT_TRANSFER_ASSIGNMENT');
  assert.equal(backfillAssignmentIssue(booking, [original]), 'INCONSISTENT_ASSIGNMENT_CHAIN');
  assert.equal(backfillAssignmentIssue({ ...booking, checkIns: [] }, chain), 'ASSIGNMENT_WITHOUT_CHECK_IN');
});
