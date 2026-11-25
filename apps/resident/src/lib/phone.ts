/** Indian mobile numbers only (+91). Mirrors the API's rule: ten digits starting 6, 7, 8 or 9. */
export const COUNTRY_CODE = '+91';

/** Keeps digits only, drops a pasted +91 / 91 / 0 prefix, and limits the result to ten digits. */
export function sanitizePhoneInput(raw: string): string {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+91') || trimmed.startsWith('0091'))
    digits = digits.replace(/^(?:0091|91)/, '');
  else if (digits.length >= 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function isValidIndianMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

/** 9876543210 -> "98765 43210" */
export function formatNational(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

export function toE164(digits: string): string {
  return `${COUNTRY_CODE}${digits}`;
}

export function sanitizeOtp(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}
