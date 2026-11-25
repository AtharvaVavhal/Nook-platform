// Defect 2 regression: after a code is accepted, "did we actually get a session?" must be answered explicitly.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../api/errors.js';
import { describeNoSession } from '../lib/errorCopy.js';
import { sessionCheckFromError, type SessionCheck } from './sessionCheck.js';

test('a profile that loads is a valid session', () => {
  assert.deepEqual(sessionCheckFromError(null), { kind: 'signedIn' } satisfies SessionCheck);
});

test('a code accepted but the session read refused (401) is "no session", never "signed in"', () => {
  assert.deepEqual(sessionCheckFromError(new ApiError('unauthorized', 401, 'UNAUTHENTICATED')), {
    kind: 'noSession',
  });
});

test('a failed session read (network, server, anything else) is "unavailable" and keeps the error for the retry screen', () => {
  for (const kind of ['network', 'server', 'unexpected', 'forbidden', 'rateLimited'] as const) {
    const error = new ApiError(kind, kind === 'network' ? 0 : 500);
    const check = sessionCheckFromError(error);
    assert.equal(check.kind, 'unavailable', kind);
    assert.equal((check as { error: ApiError }).error, error);
  }
  assert.equal(
    sessionCheckFromError(new Error('boom')).kind,
    'unavailable',
    'a non-API error is never treated as a session',
  );
});

test('the "no session" message is actionable and exposes nothing internal', () => {
  const m = describeNoSession();
  assert.match(m.title, /couldn.t finish signing you in/i);
  assert.match(m.text, /new code|try again/i);
  assert.match(m.text, /cookies/i);
  assert.doesNotMatch(
    JSON.stringify(m),
    /nook_resident|csrf|token|401|UNAUTHENTICATED|set-cookie/i,
  );
});
