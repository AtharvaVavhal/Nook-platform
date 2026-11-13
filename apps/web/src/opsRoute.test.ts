import assert from 'node:assert/strict';
import test from 'node:test';
import { isOpsHash, opsLinks, parseOpsRoute } from './ops/opsRoute';

const admissionId = '123e4567-e89b-12d3-a456-426614174000';

test('admissions hash resolves to the admissions screen', () => {
  assert.equal(isOpsHash(opsLinks.admissions), true);
  assert.deepEqual(parseOpsRoute(opsLinks.admissions), { name: 'admissions' });
});

test('admission ID hash preserves its supported route and link', () => {
  const hash = opsLinks.admission(admissionId);
  assert.equal(hash, `#admissions/${admissionId}`);
  assert.equal(isOpsHash(hash), true);
  assert.deepEqual(parseOpsRoute(hash), { name: 'admission', id: admissionId });
});

test('unrelated operations routes continue to parse', () => {
  assert.deepEqual(parseOpsRoute('#residents'), { name: 'residents' });
  assert.deepEqual(parseOpsRoute('#check-ins'), { name: 'check-ins' });
  assert.equal(isOpsHash('#residents'), true);
});

test('exported follow-up links resolve to the follow-up screens', () => {
  assert.deepEqual(parseOpsRoute(opsLinks.overdueFollowUps), { name: 'overdue-follow-ups' });
  assert.deepEqual(parseOpsRoute(opsLinks.upcomingFollowUps), { name: 'upcoming-follow-ups' });
});
