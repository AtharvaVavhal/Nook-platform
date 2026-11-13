import assert from 'node:assert/strict';

export function assertHistory(status, body, { residentId, appliedId, pendingId, foreignId }) {
  assert.equal(status, 200);
  assert.ok(body && Array.isArray(body.items));
  assert.equal(body.page, 1);
  assert.ok(Number.isInteger(body.limit) && body.limit > 0);
  assert.equal(body.total, 2);
  assert.equal(body.items.length, 2);
  for (const item of body.items) {
    assert.equal(item.targetType, 'RESIDENT');
    assert.equal(item.targetId, residentId);
    assert.notEqual(item.id, foreignId);
  }
  assert.ok(body.items.some((item) => item.id === appliedId && item.status === 'APPLIED' && item.fieldKey === 'firstName'));
  assert.ok(body.items.some((item) => item.id === pendingId && item.status === 'PENDING' && item.fieldKey === 'lastName'));
}

export function assertForeignHistory(status, body, forbidden) {
  assert.equal(status, 404);
  const text = JSON.stringify(body);
  for (const value of forbidden) assert.ok(!text.includes(value), 'foreign data leaked');
}

export function assertCurrentValue(text, applied, pending) {
  assert.ok(text.includes(applied), 'applied value is current');
  assert.ok(!text.includes(pending), 'pending value is not current');
}

export function assertUiState(text, state) {
  if (state === 'loading') {
    assert.match(text, /Loading corrections…/);
    assert.doesNotMatch(text, /No corrections/);
  } else if (state === 'empty') {
    assert.match(text, /No corrections/);
    assert.doesNotMatch(text, /Pending review|Applied/);
  } else if (state === 'error') {
    assert.match(text, /history temporarily unavailable/i);
    assert.doesNotMatch(text, /No corrections|Pending review|Applied/);
  } else throw new Error('Unknown UI state');
}

export function apiServerError(url, status, apiOrigin) {
  const parsed = new URL(url);
  if (parsed.origin !== apiOrigin || !parsed.pathname.startsWith('/api/v1/') || status < 500) return null;
  return { path: parsed.pathname, status };
}

export function assertNoServerErrors(errors) {
  assert.deepEqual(errors, [], `Unexpected API 5xx: ${JSON.stringify(errors)}`);
}
