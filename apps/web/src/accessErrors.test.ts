import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessFailureMessage,
  isPasswordChangeRequired,
  isSecurityRefusal,
  SESSION_ENDED_MESSAGE,
} from './accessErrors';

test('401 always means the session ended', () => {
  assert.equal(accessFailureMessage(401), SESSION_ENDED_MESSAGE);
  assert.equal(accessFailureMessage(401, 'UNAUTHENTICATED'), SESSION_ENDED_MESSAGE);
});

test('access refusals read as plain language, never as a generic HTTP status', () => {
  const role = accessFailureMessage(403, 'INSUFFICIENT_ROLE');
  assert.ok(role && /role does not allow/i.test(role) && !/403|HTTP/.test(role));
  assert.match(accessFailureMessage(403, 'ROUTE_NOT_DECLARED') ?? '', /not available/i);
  assert.match(accessFailureMessage(403, 'PASSWORD_CHANGE_REQUIRED') ?? '', /new password/i);
});

test('other statuses and unknown codes are left to the caller', () => {
  assert.equal(accessFailureMessage(404, 'INSUFFICIENT_ROLE'), null);
  assert.equal(accessFailureMessage(500), null);
  assert.equal(accessFailureMessage(403), null);
  assert.equal(accessFailureMessage(403, 'SOMETHING_ELSE'), null);
});

test('browser-security refusals are told apart from permission refusals', () => {
  assert.equal(isSecurityRefusal(403), true);
  assert.equal(isSecurityRefusal(403, 'INVALID_CSRF_TOKEN'), true);
  assert.equal(isSecurityRefusal(403, 'INVALID_ORIGIN'), true);
  assert.equal(isSecurityRefusal(403, 'INSUFFICIENT_ROLE'), false);
  assert.equal(isSecurityRefusal(401), false);
  assert.equal(isPasswordChangeRequired(403, 'PASSWORD_CHANGE_REQUIRED'), true);
  assert.equal(isPasswordChangeRequired(403, 'INSUFFICIENT_ROLE'), false);
  assert.equal(isPasswordChangeRequired(401, 'PASSWORD_CHANGE_REQUIRED'), false);
});
