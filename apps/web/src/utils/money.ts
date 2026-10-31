/**
 * Canonical monetary utilities for Nook.
 * 
 * Non-negotiable rules:
 * 1. Money is NEVER stored or calculated using floating-point numbers.
 * 2. All amounts are integer paise (1 INR = 100 paise).
 * 3. Display amounts formatted as INR (₹) using Indian digit grouping (lakhs, crores).
 * 4. Money cannot be negative in standard display; credit/debit is denoted by direction.
 */

export type Paise = bigint;

/**
 * Coerce number or bigint paise to bigint.
 * Throws if a non-integer or NaN number is supplied.
 */
export function toPaise(value: number | bigint | string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new TypeError(`Cannot convert string "${value}" to integer paise. Non-integers forbidden.`);
    }
    return BigInt(trimmed);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new TypeError(`Paise value must be an exact integer. Received: ${value}`);
    }
    return BigInt(value);
  }
  throw new TypeError(`Invalid paise type: ${typeof value}`);
}

/**
 * Format integer paise into standard Indian Rupee representation (₹ with Indian digit grouping).
 * Example: 15000000n paise -> ₹1,50,000.00
 */
export function formatINR(
  paiseInput: number | bigint | string,
  options: {
    showPaise?: boolean;
    showSymbol?: boolean;
    useSign?: boolean;
  } = {}
): string {
  const { showPaise = true, showSymbol = true, useSign = false } = options;
  const paise = toPaise(paiseInput);
  const isNegative = paise < 0n;
  const absolutePaise = isNegative ? -paise : paise;

  const rupees = absolutePaise / 100n;
  const remainderPaise = absolutePaise % 100n;

  // Indian number grouping: last 3 digits, then groups of 2 digits
  const rupeeString = rupees.toString();
  let formattedRupees = '';

  if (rupeeString.length <= 3) {
    formattedRupees = rupeeString;
  } else {
    const lastThree = rupeeString.slice(-3);
    const leading = rupeeString.slice(0, -3);
    // Group leading digits by 2 from the right
    const groups: string[] = [];
    let rem = leading;
    while (rem.length > 2) {
      groups.unshift(rem.slice(-2));
      rem = rem.slice(0, -2);
    }
    if (rem.length > 0) {
      groups.unshift(rem);
    }
    formattedRupees = `${groups.join(',')},${lastThree}`;
  }

  let result = formattedRupees;
  if (showPaise) {
    const paisePart = remainderPaise.toString().padStart(2, '0');
    result += `.${paisePart}`;
  }

  const symbol = showSymbol ? '₹' : '';
  const signPrefix = isNegative ? (useSign ? '-' : '- ') : '';

  return `${signPrefix}${symbol}${result}`;
}

/**
 * Parse an INR user input string into integer paise.
 * Safely handles strings like "1,50,000", "₹1,50,000.50", "1500", "0.75".
 * Rejects scientific notation, multiple decimals, and non-digit characters.
 */
export function parseRupeesToPaise(input: string): bigint {
  const cleaned = input.trim().replace(/^₹\s*/, '').replace(/,/g, '');
  if (!cleaned) {
    throw new Error('Input is empty');
  }

  // Validate format: optional minus, digits, optional single decimal with 1 or 2 digits
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid currency format: "${input}". Provide digits with up to 2 decimal places.`);
  }

  const isNegative = cleaned.startsWith('-');
  const unsigned = isNegative ? cleaned.slice(1) : cleaned;

  const [rupeesPart = '0', fractionPart = ''] = unsigned.split('.');
  const paddedFraction = (fractionPart + '00').slice(0, 2);

  const totalPaise = BigInt(rupeesPart || '0') * 100n + BigInt(paddedFraction);
  return isNegative ? -totalPaise : totalPaise;
}

/**
 * Exact integer addition of paise.
 */
export function addPaise(a: number | bigint, b: number | bigint): bigint {
  return toPaise(a) + toPaise(b);
}

/**
 * Exact integer subtraction of paise.
 */
export function subtractPaise(a: number | bigint, b: number | bigint): bigint {
  return toPaise(a) - toPaise(b);
}

/**
 * Sum an array of paise amounts.
 */
export function sumPaise(items: (number | bigint)[]): bigint {
  return items.reduce<bigint>((acc, curr) => acc + toPaise(curr), 0n);
}
