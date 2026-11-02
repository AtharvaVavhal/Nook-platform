import { useEffect, useRef, useState, type FormEvent } from 'react';
import './auth.css';
import { AuthError } from './authApi';
import { describeAuthError, validateLogin, type LoginFieldErrors } from './authHelpers';
import { useAuth } from './AuthContext';

export function LoginPage({ notice }: { notice: string | null }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
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
    setFormError(null);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();
    inFlight.current = true;
    setSubmitting(true);
    try {
      await signIn(email, password);
      // The gate swaps this page for the app; keep the in-flight lock so nothing resubmits meanwhile.
    } catch (error) {
      setFormError(describeAuthError(error instanceof AuthError ? error.code : 'UNKNOWN'));
      setPassword('');
      refocusPassword.current = true;
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <main className="auth-card" aria-labelledby="auth-title">
        <img
          className="auth-logo"
          src={`${import.meta.env.BASE_URL}brand/nook-logo-white.svg`}
          alt="nook"
          width="100"
          height="36"
        />
        <h1 id="auth-title">Sign in</h1>
        <p className="auth-lede">Use the email and password for your Nook workspace.</p>

        {notice ? (
          <p className="auth-notice" role="status">
            {notice}
          </p>
        ) : null}

        <form onSubmit={submit} noValidate>
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
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
              aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
              disabled={submitting}
            />
            {fieldErrors.email ? (
              <small id="auth-email-error" className="auth-error">
                {fieldErrors.email}
              </small>
            ) : null}
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <div className="auth-password">
              <input
                id="auth-password"
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                disabled={submitting}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {fieldErrors.password ? (
              <small id="auth-password-error" className="auth-error">
                {fieldErrors.password}
              </small>
            ) : null}
          </div>

          {formError ? (
            <p className="auth-form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <button type="submit" className="primary-button auth-submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </div>
  );
}
