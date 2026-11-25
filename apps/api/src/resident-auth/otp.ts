import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { loadRuntimeConfig } from '../config.js';
import { OTP_LENGTH } from './policy.js';

/** A uniformly random code from the operating system's CSPRNG (no modulo bias, no Math.random). */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

/**
 * Keyed one-way hash of a code, bound to its challenge and its account. A 6-digit code has only a million values, so a plain
 * hash could be reversed instantly from a leaked row; the server-side key (RESIDENT_OTP_SECRET) is what prevents that.
 */
export function hashOtp(
  secret: string,
  challengeId: string,
  accountId: string,
  code: string,
): string {
  return createHmac('sha256', secret)
    .update(`otp:v1:${challengeId}:${accountId}:${code}`)
    .digest('hex');
}

export function otpMatches(
  expectedHex: string,
  secret: string,
  challengeId: string,
  accountId: string,
  code: string,
): boolean {
  const actual = Buffer.from(hashOtp(secret, challengeId, accountId, code), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Keyed hash for rate-limit keys, so the throttle table never holds a phone number or an address. */
export function keyedHash(secret: string, scope: string, value: string): string {
  return createHmac('sha256', secret).update(`throttle:v1:${scope}:${value}`).digest('hex');
}

export function requireOtpSecret(): string {
  const secret = loadRuntimeConfig().residentOtpSecret;
  if (!secret) throw new Error('RESIDENT_OTP_SECRET is not configured');
  return secret;
}

/** The message text. It is the only place the code leaves this process. It is never logged, except by the non-production preview mock (mock-sms.provider.ts). */
export function otpMessageBody(code: string, ttlMinutes: number): string {
  return `Your Nook verification code is ${code}. It expires in ${ttlMinutes} minutes. Do not share it with anyone.`;
}
