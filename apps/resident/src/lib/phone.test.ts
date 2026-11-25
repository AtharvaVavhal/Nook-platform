import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatNational,
  isValidIndianMobile,
  sanitizeOtp,
  sanitizePhoneInput,
  toE164,
} from './phone.js';

test('phone input keeps ten digits and drops a pasted country code or trunk zero', () => {
  assert.equal(sanitizePhoneInput('9876543210'), '9876543210');
  assert.equal(sanitizePhoneInput('98765 43210'), '9876543210');
  assert.equal(sanitizePhoneInput('+91 98765-43210'), '9876543210');
  assert.equal(sanitizePhoneInput('919876543210'), '9876543210');
  assert.equal(sanitizePhoneInput('09876543210'), '9876543210');
  assert.equal(sanitizePhoneInput('0091 9876543210'), '9876543210');
  assert.equal(sanitizePhoneInput('98765432109999'), '9876543210');
  assert.equal(sanitizePhoneInput('abc'), '');
  // typing is not mistaken for a prefix: a number that merely starts with 91 stays intact while it is short
  assert.equal(sanitizePhoneInput('91'), '91');
  assert.equal(sanitizePhoneInput('9198765432'), '9198765432');
});

test('validity mirrors the API rule and the number is sent as E.164', () => {
  for (const ok of ['9876543210', '6000000000', '7123456789', '8123456789'])
    assert.equal(isValidIndianMobile(ok), true, ok);
  for (const bad of ['5876543210', '987654321', '98765432100', '', '98765abcde'])
    assert.equal(isValidIndianMobile(bad), false, bad);
  assert.equal(toE164('9876543210'), '+919876543210');
  assert.equal(formatNational('9876543210'), '98765 43210');
  assert.equal(formatNational('98765'), '98765');
});

test('OTP input keeps six digits only', () => {
  assert.equal(sanitizeOtp('12 34-56'), '123456');
  assert.equal(sanitizeOtp('1234567890'), '123456');
  assert.equal(sanitizeOtp('ab'), '');
});
