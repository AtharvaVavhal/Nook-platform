import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeAuthError,
  describeLockout,
  validateLogin,
  validatePasswordChange,
} from './auth/authHelpers';

test('login validation: both fields are required and the email must look like one', () => {
  assert.deepEqual(validateLogin('owner@example.com', 'secret'), {});
  assert.deepEqual(
    validateLogin('  owner@example.com  ', 'x'),
    {},
    'surrounding spaces are trimmed',
  );
  assert.equal(validateLogin('', 'x').email, 'Enter your email address.');
  assert.equal(validateLogin('   ', 'x').email, 'Enter your email address.');
  for (const bad of [
    'owner',
    'owner@',
    '@example.com',
    'a b@c.d',
    'two@@example.com'.replace('@@', '@ @'),
  ]) {
    assert.equal(validateLogin(bad, 'x').email, 'Enter a valid email address.', bad);
  }
  assert.equal(validateLogin('owner@example.com', '').password, 'Enter your password.');
  assert.deepEqual(Object.keys(validateLogin('', '')).sort(), ['email', 'password']);
});

test('login validation: a password made of spaces is still a password', () => {
  assert.deepEqual(validateLogin('owner@example.com', '   '), {});
});

test('auth error messages never reveal which credential was wrong', () => {
  assert.equal(describeAuthError('INVALID_CREDENTIALS'), 'The email or password is incorrect.');
  assert.match(describeAuthError('NETWORK'), /Could not reach the server/);
  assert.match(describeAuthError('RATE_LIMITED'), /Too many attempts/);
  assert.match(describeAuthError('UNKNOWN'), /Something went wrong/);
  for (const code of ['INVALID_CREDENTIALS', 'NETWORK', 'RATE_LIMITED', 'UNKNOWN'] as const) {
    assert.ok(!/password is wrong|no account|unknown email/i.test(describeAuthError(code)));
  }
});

test('password change validation mirrors the server policy', () => {
  assert.deepEqual(
    validatePasswordChange('old-password-1', 'a-new-long-passphrase', 'a-new-long-passphrase'),
    {},
  );
  assert.equal(
    validatePasswordChange('', 'a-new-long-passphrase', 'a-new-long-passphrase').current,
    'Enter your current password.',
  );
  assert.match(
    validatePasswordChange('old', 'short-11-ch', 'short-11-ch').next ?? '',
    /at least 12/,
  );
  assert.equal(
    validatePasswordChange('old', 'exactly-12-ch', 'exactly-12-ch').next,
    undefined,
    '12 characters is allowed',
  );
  assert.match(
    validatePasswordChange('old', 'x'.repeat(129), 'x'.repeat(129)).next ?? '',
    /at most 128/,
  );
  assert.match(
    validatePasswordChange('same-password-12', 'same-password-12', 'same-password-12').next ?? '',
    /different/,
  );
  assert.match(
    validatePasswordChange('old', 'Owner@Example.com', 'Owner@Example.com', 'owner@example.com')
      .next ?? '',
    /e-mail/,
  );
  assert.equal(
    validatePasswordChange('old', 'a-new-long-passphrase', 'a-new-long-passphras').confirm,
    'The two new passwords do not match.',
  );
});

test('lockout message rounds up to whole minutes', () => {
  assert.equal(describeLockout(1), 'Too many attempts. Try again in about 1 minute.');
  assert.equal(describeLockout(61), 'Too many attempts. Try again in about 2 minutes.');
  assert.equal(describeLockout(900), 'Too many attempts. Try again in about 15 minutes.');
});
