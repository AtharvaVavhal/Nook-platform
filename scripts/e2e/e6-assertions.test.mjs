import test from 'node:test';
import assert from 'node:assert/strict';
import { assertHistory, assertForeignHistory, assertCurrentValue, assertUiState, apiServerError, assertNoServerErrors } from './e6-assertions.mjs';

const expected = { residentId: 'resident-a', appliedId: 'applied-a', pendingId: 'pending-a', foreignId: 'foreign-b' };
const item = (id, status, fieldKey) => ({ id, status, fieldKey, targetType: 'RESIDENT', targetId: 'resident-a' });
const page = () => ({ items: [item('applied-a', 'APPLIED', 'firstName'), item('pending-a', 'PENDING', 'lastName')], page: 1, limit: 10, total: 2 });

test('history validates status, pagination, target, and applied and pending entries', () => {
  assert.doesNotThrow(() => assertHistory(200, page(), expected));
  assert.throws(() => assertHistory(500, page(), expected));
  assert.throws(() => assertHistory(200, { ...page(), items: [] }, expected));
  const wrong = page(); wrong.items[0].targetId = 'foreign';
  assert.throws(() => assertHistory(200, wrong, expected));
  const wrongStatus = page(); wrongStatus.items[1].status = 'APPLIED';
  assert.throws(() => assertHistory(200, wrongStatus, expected));
});

test('current resident value excludes the pending proposal', () => {
  assertCurrentValue('Aarav Shah', 'Aarav', 'PendingNotCurrent');
  assert.throws(() => assertCurrentValue('Aarav PendingNotCurrent', 'Aarav', 'PendingNotCurrent'));
});

test('loading, empty and error states reject misleading content', () => {
  for (const [state, text] of [['loading', 'Loading corrections…'], ['empty', 'No corrections'], ['error', 'History temporarily unavailable']]) {
    assertUiState(text, state);
    assert.throws(() => assertUiState(`${text} ${state === 'loading' ? 'No corrections' : 'Applied'}`, state));
  }
});

test('cross tenant response is 404 and contains no foreign identifiers or data', () => {
  assertForeignHistory(404, { message: 'Not found' }, ['foreign-b']);
  assert.throws(() => assertForeignHistory(200, {}, ['foreign-b']));
  assert.throws(() => assertForeignHistory(404, { metadata: 'foreign-b' }, ['foreign-b']));
});

test('5xx collector restricts origin and API path and removes query and credentials', () => {
  const api = 'http://127.0.0.1:3199';
  const found = apiServerError(`${api}/api/v1/corrections/history?token=secret`, 500, api);
  assert.deepEqual(found, { path: '/api/v1/corrections/history', status: 500 });
  assert.equal(apiServerError('https://example.com/api/v1/x', 500, api), null);
  assert.equal(apiServerError(`${api}/asset`, 500, api), null);
  assert.equal(apiServerError(`${api}/api/v1/x`, 404, api), null);
  assert.throws(() => assertNoServerErrors([found]), /500.*corrections|corrections.*500/);
  assertNoServerErrors([]);
});
