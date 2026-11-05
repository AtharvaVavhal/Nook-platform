import { useEffect, useRef, useState, type FormEvent } from 'react';
import './login.css';
import { AuthError } from './authApi';
import {
  describeAuthError,
  validateLogin,
  type AuthErrorCode,
  type LoginFieldErrors,
} from './authHelpers';
import { useAuth } from './AuthContext';
import { HostelIllustration } from '../components/HostelIllustration';

interface SignInFailure {
  code: AuthErrorCode;
  message: string;
}

/** Short heading per failure, so a wrong password reads differently from the server being down. */
const FAILURE_TITLES: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: 'Sign-in failed',
  RATE_LIMITED: 'Too many attempts',
  NETWORK: 'Connection problem',
  UNKNOWN: 'Server error',
};

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

function AlertIcon({ kind }: { kind: 'error' | 'warning' }) {
  return (
    <svg {...svgProps} className="login-alert-icon" width="20" height="20">
      {kind === 'error' ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 7v5l3 2" />
        </>
      )}
    </svg>
  );
}

export function LoginPage({ notice }: { notice: string | null }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref, not state: two quick submissions in the same tick must not both pass the guard.
  const inFlight = useRef(false);
  const refocusPassword = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // Inputs are disabled while a sign-in is in flight and a disabled input cannot take focus, so the
  // password field is focused only after the form has been re-enabled.
  useEffect(() => {
    if (!submitting && refocusPassword.current) {
      refocusPassword.current = false;
      passwordRef.current?.focus();
    }
  }, [submitting]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const errors = validateLogin(email, password);
    setFieldErrors(errors);
    setFailure(null);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();
    inFlight.current = true;
    setSubmitting(true);
    try {
      await signIn(email, password);
      // The gate swaps this page for the app; keep the in-flight lock so nothing resubmits meanwhile.
    } catch (error) {
      const code: AuthErrorCode = error instanceof AuthError ? error.code : 'UNKNOWN';
      setFailure({ code, message: describeAuthError(code) });
      setPassword('');
      refocusPassword.current = true;
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const base = import.meta.env.BASE_URL;

  return (
    <div className="login-screen">
      <aside className="login-brand">
        <div className="login-brand-inner">
          <img
            className="login-brand-logo"
            src={`${base}brand/nook-logo-white.svg`}
            alt="Nook"
            width="140"
            height="50"
          />
          <div className="login-brand-copy">
            <p className="login-brand-headline">Hostel operations, made simple.</p>
            <p className="login-brand-description">
              Enquiries, bookings, admissions, check-ins and finance in one workspace, built for the
              people who run the property.
            </p>
          </div>
          <HostelIllustration className="login-brand-illustration" />
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-card">
          <h1 id="login-title" className="login-title">
            Welcome back
          </h1>
          <p className="login-subtitle">Sign in to your Nook workspace.</p>

          {notice ? (
            <div className="login-alert login-alert--warning" role="status">
              <AlertIcon kind="warning" />
              <div>
                <strong>Session ended</strong>
                <span>{notice}</span>
              </div>
            </div>
          ) : null}

          {failure ? (
            <div
              id="login-failure"
              className={`login-alert login-alert--error login-alert--${failure.code.toLowerCase()}`}
              role="alert"
            >
              <AlertIcon kind="error" />
              <div>
                <strong>{FAILURE_TITLES[failure.code]}</strong>
                <span>{failure.message}</span>
              </div>
            </div>
          ) : null}

          <form
            onSubmit={submit}
            noValidate
            aria-labelledby="login-title"
            aria-busy={submitting}
            aria-describedby={failure ? 'login-failure' : undefined}
          >
            <div className="login-field">
              <label htmlFor="login-email" className="login-label">
                Email
              </label>
              <input
                id="login-email"
                ref={emailRef}
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                disabled={submitting}
                className="login-input"
                placeholder="you@company.com"
              />
              {fieldErrors.email ? (
                <p id="login-email-error" className="login-field-error" role="alert">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <div className="login-field">
              <label htmlFor="login-password" className="login-label">
                Password
              </label>
              <div className="login-password">
                <input
                  id="login-password"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                  disabled={submitting}
                  className="login-input"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="login-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={submitting}
                >
                  <svg {...svgProps} width="20" height="20">
                    {showPassword ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <path d="M1 1l22 22" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
              {fieldErrors.password ? (
                <p id="login-password-error" className="login-field-error" role="alert">
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>

            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="login-spinner" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="login-security">
            <svg {...svgProps} width="16" height="16">
              <path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6l8-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span>
              Secure sign-in. For your protection, sessions end after 30 minutes of inactivity.
            </span>
          </p>
        </div>
      </main>
    </div>
  );
}
