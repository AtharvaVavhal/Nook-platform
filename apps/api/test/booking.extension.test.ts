import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { canApproveExtension, parseExtensionRequest } from '../src/booking/booking.extension.js';

test('extension: OWNER and PROPERTY_MANAGER may approve; any other role may not', () => {
  assert.equal(canApproveExtension('OWNER'), true);
  assert.equal(canApproveExtension('PROPERTY_MANAGER'), true);
  for (const role of ['', 'owner', 'STAFF', 'RESIDENT', 'ADMIN']) {
    assert.equal(canApproveExtension(role), false, role);
  }
});

test('extension request: a date-only value is a calendar date and the reason is trimmed', () => {
  const parsed = parseExtensionRequest({ newEndDate: '2027-04-01', reason: '  Exam season  ' });
  assert.equal(parsed.newEndDate.toISOString(), '2027-04-01T00:00:00.000Z');
  assert.equal(parsed.reason, 'Exam season');
});

test('extension request: an instant is reduced to its Asia/Kolkata calendar date', () => {
  // 18:30Z on 31 Mar is 00:00 on 1 Apr in India.
  assert.equal(
    parseExtensionRequest({
      newEndDate: '2027-03-31T18:30:00Z',
      reason: 'abc',
    }).newEndDate.toISOString(),
    '2027-04-01T00:00:00.000Z',
  );
  assert.equal(
    parseExtensionRequest({
      newEndDate: '2027-03-31T18:29:00Z',
      reason: 'abc',
    }).newEndDate.toISOString(),
    '2027-03-31T00:00:00.000Z',
  );
});

test('extension request: missing, malformed or impossible dates and weak reasons are 400s', () => {
  const bad = (body: unknown) =>
    assert.throws(() => parseExtensionRequest(body), BadRequestException);
  bad(null);
  bad([]);
  bad('text');
  bad({ reason: 'abc' });
  bad({ newEndDate: '', reason: 'abc' });
  bad({ newEndDate: 20270401, reason: 'abc' });
  bad({ newEndDate: 'soon', reason: 'abc' });
  bad({ newEndDate: '2027-02-30', reason: 'abc' });
  bad({ newEndDate: '2027-04-01' });
  bad({ newEndDate: '2027-04-01', reason: '' });
  bad({ newEndDate: '2027-04-01', reason: '  ab  ' });
  bad({ newEndDate: '2027-04-01', reason: 'x'.repeat(501) });
  bad({ newEndDate: '2027-04-01', reason: 42 });
});

test('zone-less extension timestamps use Asia/Kolkata consistently with lifecycle inputs', () => {
  assert.equal(
    parseExtensionRequest({
      newEndDate: '2027-04-01T00:30:00',
      reason: 'Extension',
    }).newEndDate.toISOString(),
    '2027-04-01T00:00:00.000Z',
  );
});
