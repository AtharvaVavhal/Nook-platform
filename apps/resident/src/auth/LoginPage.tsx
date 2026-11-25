import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/index.js';
import { ApiError, asApiError } from '../api/errors.js';
import { Banner } from '../ui/Feedback.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
import { Logo } from '../ui/Logo.js';
import {
  describeNoSession,
  describeRequestCodeError,
  describeVerifyError,
  type Message,
} from '../lib/errorCopy.js';
import { formatDuration } from '../lib/format.js';
import {
  formatNational,
  isValidIndianMobile,
  sanitizeOtp,
  sanitizePhoneInput,
  toE164,
} from '../lib/phone.js';
import { useCountdown } from '../lib/useCountdown.js';
import { useAuth } from './AuthContext.js';

const PHONE_HELP = 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9.';

/**
 * Phone number + one-time code, nothing else: no email, no password, no sign-up and no staff entrance. The API answers a code
 * request identically for every valid number, and refuses a code identically whether it is wrong or expired, so the wording
 * here says "if" and "may" and never claims to know more.
 */
export function LoginPage({
  notice,
  initialPhone,
}: {
  notice: 'session-ended' | 'signed-out' | 'no-session' | null;
  /** The number the resident had entered when a sign-in could not be completed, so it need not be typed again. */
  initialPhone: string | null;
}) {
  const { refresh } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  // The field shows exactly what was typed or pasted (so a typed "+91" is never silently turned into part of the number);
  // the ten national digits are derived from it, and the text is tidied on blur.
  const [rawPhone, setRawPhone] = useState(initialPhone ?? '');
  const digits = sanitizePhoneInput(rawPhone);
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [limited, setLimited] = useState(false);
  const [refocus, setRefocus] = useState<'phone' | 'code' | null>(null);
  // The "could not finish signing you in" notice belongs to the attempt that failed: it goes away when a new attempt begins.
  const [attempted, setAttempted] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const submittedCode = useRef<string | null>(null);
  const wait = useCountdown(resendAt);

  const phoneValid = isValidIndianMobile(digits);
  const phoneInvalid = touched && !phoneValid;

  useEffect(() => {
    (step === 'code' ? codeRef : phoneRef).current?.focus();
  }, [step]);

  // After a request ends, put focus back on the field the resident was using. It is done here, once `busy` is false and the field
  // can take input again, because focusing during the request would hit a field that cannot take focus (and focus would land on <body>).
  useEffect(() => {
    if (busy || refocus === null) return;
    (refocus === 'code' ? codeRef : phoneRef).current?.focus();
    setRefocus(null);
  }, [busy, refocus]);

  async function requestCode(isResend = false) {
    if (!phoneValid) {
      setTouched(true);
      phoneRef.current?.focus();
      return;
    }
    setAttempted(true);
    setBusy(true);
    setMessage(null);
    setInfo(null);
    try {
      const result = await api.requestOtp(toE164(digits));
      setLimited(false);
      setResendAt(Date.now() + Math.max(1, result.resendAfterSeconds) * 1000);
      setCode('');
      submittedCode.current = null;
      if (isResend) setInfo('A new code is on its way. Only the newest code works.');
      setStep('code');
    } catch (error) {
      const e = asApiError(error);
      setMessage(describeRequestCodeError(e));
      setRefocus(step === 'code' ? 'code' : 'phone');
      setLimited(e.kind === 'rateLimited');
      if (e.kind === 'rateLimited' && e.retryAfterSeconds)
        setResendAt(Date.now() + e.retryAfterSeconds * 1000);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    setAttempted(true);
    setBusy(true);
    setMessage(null);
    setInfo(null);
    try {
      await api.verifyOtp(toE164(digits), value);
      // The server set the session cookie; "signed in" is whatever GET /me says next, and it must actually say so.
      const session = await refresh({ signIn: { phone: formatNational(digits) } });
      if (session.kind === 'noSession') {
        setMessage(describeNoSession());
        setCode('');
        submittedCode.current = null;
        setRefocus('code');
      }
    } catch (error) {
      const e: ApiError = asApiError(error);
      setMessage(describeVerifyError(e));
      setCode('');
      submittedCode.current = null;
      if (e.kind === 'rateLimited' && e.retryAfterSeconds)
        setResendAt(Date.now() + e.retryAfterSeconds * 1000);
      setRefocus('code');
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(raw: string) {
    const next = sanitizeOtp(raw);
    setCode(next);
    if (message) setMessage(null);
    if (next.length === 6 && !busy && submittedCode.current !== next) {
      submittedCode.current = next;
      void verify(next);
    }
  }

  function changeNumber() {
    setStep('phone');
    setCode('');
    setMessage(null);
    setInfo(null);
    submittedCode.current = null;
  }

  const onPhoneSubmit = (event: FormEvent) => {
    event.preventDefault();
    void requestCode(false);
  };
  const onCodeSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === 6 && !busy) {
      submittedCode.current = code;
      void verify(code);
    }
  };

  return (
    <div className="rp-auth">
      <div className="rp-auth__brand">
        <Logo height={34} />
      </div>
      <main className="rp-auth__panel">
        <div className="rp-auth__inner">
          <div>
            <h1 className="rp-auth__title">Welcome home.</h1>
            <p className="rp-auth__lead">
              Your stay, payments and hostel updates — all in one place.
            </p>
          </div>

          {notice === 'session-ended' ? (
            <Banner tone="warning" role="status">
              <strong>You have been signed out.</strong> Your session ended or portal access is not
              available. Sign in again to continue. If that keeps happening, ask your hostel to
              check your access.
            </Banner>
          ) : null}
          {notice === 'signed-out' ? (
            <Banner tone="info" role="status">
              You have signed out.
            </Banner>
          ) : null}

          {notice === 'no-session' && !attempted ? (
            <Banner tone="error" role="alert">
              <strong>{describeNoSession().title}.</strong> {describeNoSession().text}
            </Banner>
          ) : null}

          {step === 'phone' ? (
            <form className="rp-form" onSubmit={onPhoneSubmit} noValidate>
              <div className="rp-field">
                <label className="rp-field__label" htmlFor="phone">
                  Mobile number
                </label>
                <div className="rp-phone" data-invalid={phoneInvalid ? 'true' : 'false'}>
                  <span className="rp-phone__prefix" aria-hidden="true">
                    +91
                  </span>
                  <input
                    id="phone"
                    ref={phoneRef}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    value={rawPhone}
                    onChange={(e) => {
                      setRawPhone(e.target.value.replace(/[^\d\s+\-().]/g, '').slice(0, 20));
                      if (message) setMessage(null);
                    }}
                    onBlur={() => {
                      if (digits === '') return;
                      setTouched(true);
                      if (phoneValid) setRawPhone(formatNational(digits));
                    }}
                    aria-describedby={phoneInvalid ? 'phone-help phone-error' : 'phone-help'}
                    aria-invalid={phoneInvalid ? true : undefined}
                    aria-required="true"
                    readOnly={busy}
                  />
                </div>
                <p id="phone-help" className="rp-field__hint">
                  Country code +91 (India). We will text you a 6-digit code.
                </p>
                {phoneInvalid ? (
                  <p id="phone-error" className="rp-field__error" role="alert">
                    <Icon name="alert" />
                    {PHONE_HELP}
                  </p>
                ) : null}
              </div>
              {message ? (
                <Banner tone="error" role="alert">
                  <strong>{message.title}.</strong> {message.text}
                </Banner>
              ) : null}
              <Button
                type="submit"
                block
                loading={busy}
                loadingLabel="Sending code…"
                disabled={!phoneValid || (limited && wait > 0)}
              >
                {limited && wait > 0 ? `Try again in ${formatDuration(wait)}` : 'Send OTP'}
              </Button>
            </form>
          ) : (
            <form className="rp-form" onSubmit={onCodeSubmit} noValidate>
              <div className="rp-field">
                <label className="rp-field__label" htmlFor="otp">
                  Enter the 6-digit code
                </label>
                <p id="otp-help" className="rp-field__hint">
                  If +91 {formatNational(digits)} has portal access, a code is on its way. It
                  expires in 5 minutes.
                </p>
                <input
                  id="otp"
                  ref={codeRef}
                  className="rp-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="······"
                  value={code}
                  onChange={(e) => onCodeChange(e.target.value)}
                  aria-describedby={message ? 'otp-help otp-error' : 'otp-help'}
                  aria-invalid={message ? true : undefined}
                  readOnly={busy}
                />
              </div>
              <div aria-live="polite">
                {message ? (
                  <div id="otp-error">
                    <Banner tone="error" role="alert">
                      <strong>{message.title}.</strong> {message.text}
                    </Banner>
                  </div>
                ) : null}
                {info && !message ? (
                  <Banner tone="info" role="status">
                    {info}
                  </Banner>
                ) : null}
              </div>
              <Button
                type="submit"
                block
                loading={busy}
                loadingLabel="Checking…"
                disabled={code.length !== 6}
              >
                Verify and sign in
              </Button>
              <div className="rp-auth__actions">
                <Button variant="ghost" size="small" onClick={changeNumber} disabled={busy}>
                  Change phone number
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => void requestCode(true)}
                  disabled={busy || wait > 0}
                >
                  {wait > 0 ? `Resend code in ${formatDuration(wait)}` : 'Resend code'}
                </Button>
              </div>
            </form>
          )}

          <div className="rp-note">
            <Icon name="shield" />
            <p>
              We use your number only to send a one-time code. Never share your code with anyone,
              including hostel staff. Signing in is done with your code alone.
            </p>
          </div>
          <p className="rp-auth__foot">
            Access is set up by your hostel. If you can't sign in, ask your hostel manager to check
            your access.
          </p>
        </div>
      </main>
    </div>
  );
}
