import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../api/errors.js';
import { describeLoadError, describeRequestCodeError, describeVerifyError } from './errorCopy.js';

const err = (
  kind: ConstructorParameters<typeof ApiError>[0],
  status = 0,
  code: string | null = null,
  retry: number | null = null,
) => new ApiError(kind, status, code, retry);

test('a refused code gets one honest message: the API never says wrong versus expired, and neither does the UI', () => {
  const m = describeVerifyError(err('unauthorized', 401, 'INVALID_OR_EXPIRED_CODE'));
  assert.match(m.text, /incorrect or expired/);
  assert.doesNotMatch(
    JSON.stringify(m),
    /not registered|no account|suspended|inactive|archived|revoked/i,
    'no hint about the state of an account',
  );
});

test('rate limits tell the resident how long to wait', () => {
  assert.match(
    describeRequestCodeError(err('rateLimited', 429, 'OTP_RATE_LIMITED', 125)).text,
    /2:05/,
  );
  assert.match(describeVerifyError(err('rateLimited', 429, 'OTP_RATE_LIMITED', 30)).text, /0:30/);
  assert.match(describeVerifyError(err('rateLimited', 429)).text, /wait a little while/);
});

test('network, server, not-found and portal-off each have their own plain wording', () => {
  assert.match(describeLoadError(err('network')).title, /can't reach Nook/);
  assert.match(describeLoadError(err('server', 500)).title, /our side/);
  assert.match(describeLoadError(err('notFound', 404)).text, /may not exist/);
  assert.match(describeRequestCodeError(err('notFound', 404)).title, /not available/);
  assert.match(
    describeRequestCodeError(err('badRequest', 400, 'INVALID_PHONE_NUMBER')).text,
    /10-digit/,
  );
  for (const k of ['forbidden', 'unexpected'] as const)
    assert.ok(describeLoadError(err(k, 403)).title.length > 0);
});

test('error wording never exposes internals (codes, stack, status numbers)', () => {
  for (const kind of [
    'network',
    'unauthorized',
    'forbidden',
    'notFound',
    'rateLimited',
    'badRequest',
    'server',
    'unexpected',
  ] as const) {
    const text = JSON.stringify([
      describeLoadError(err(kind, 500, 'SOME_CODE')),
      describeRequestCodeError(err(kind, 500, 'SOME_CODE')),
      describeVerifyError(err(kind, 500, 'SOME_CODE')),
    ]);
    assert.doesNotMatch(text, /SOME_CODE|\b5\d\d\b|stack|undefined|\[object/);
  }
});
