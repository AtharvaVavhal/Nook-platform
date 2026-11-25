/** Resident sign-in policy. One place to read it, one place to change it. */
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

/** Resident sessions are isolated from owner sessions: own cookie names, own table, own lifetimes. */
export const RESIDENT_SESSION_COOKIE = 'nook_resident_session';
export const RESIDENT_CSRF_COOKIE = 'nook_resident_csrf';
export const RESIDENT_SESSION_IDLE_MS = 30 * 60 * 1000;
export const RESIDENT_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;

export type ResidentThrottleScope =
  | 'OTP_REQUEST_PHONE'
  | 'OTP_REQUEST_ADDRESS'
  | 'OTP_COOLDOWN_PHONE'
  | 'OTP_VERIFY_PHONE'
  | 'OTP_VERIFY_ADDRESS';

export interface ThrottleRule {
  /** Events allowed inside the window before the key is locked. */
  readonly limit: number;
  readonly windowSeconds: number;
  readonly lockSeconds: number;
}

/** Counting rules. The cooldown scope has no rule: it is a plain timed lock set after each code request. */
export const RESIDENT_THROTTLE: Record<
  Exclude<ResidentThrottleScope, 'OTP_COOLDOWN_PHONE'>,
  ThrottleRule
> = {
  OTP_REQUEST_PHONE: { limit: 5, windowSeconds: 3600, lockSeconds: 3600 }, // 5 codes per phone per hour
  OTP_REQUEST_ADDRESS: { limit: 20, windowSeconds: 3600, lockSeconds: 3600 }, // 20 codes per address per hour
  OTP_VERIFY_PHONE: { limit: 10, windowSeconds: 900, lockSeconds: 900 }, // 10 wrong or invalid codes per phone per 15 min
  OTP_VERIFY_ADDRESS: { limit: 30, windowSeconds: 900, lockSeconds: 900 }, // 30 per address per 15 min
};

/** The reasons a resident account sign-in can be refused are never told apart on the wire. */
export const GENERIC_CODE_FAILURE = 'INVALID_OR_EXPIRED_CODE';

/**
 * Who may use the resident portal (owner decision): an ACTIVE resident with an ACTIVE account in an ACTIVE organization.
 * INACTIVE and ARCHIVED residents, and suspended or revoked accounts, are refused. One definition, used for sign-in
 * request, verification, session creation and the per-request session check, so the rules cannot drift apart.
 */
export const PORTAL_ELIGIBLE = {
  status: 'ACTIVE',
  organization: { status: 'ACTIVE' },
  resident: { status: 'ACTIVE' },
} as const;
