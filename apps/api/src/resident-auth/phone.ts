/**
 * Indian mobile numbers only. Accepted spellings: 9876543210, 09876543210, 919876543210, +919876543210, 00919876543210, with
 * spaces, dashes, dots or brackets. The result is always E.164 `+91` followed by ten digits starting 6, 7, 8 or 9.
 */
export function normalizeIndianMobile(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (input.length > 24) return null;
  let digits = input.trim().replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (/^91\d{10}$/.test(digits)) digits = digits.slice(2);
  else if (/^0\d{10}$/.test(digits)) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** For owner-facing responses: enough to recognise the number, not enough to copy it. */
export function maskPhone(e164: string): string {
  return `+91******${e164.slice(-4)}`;
}
