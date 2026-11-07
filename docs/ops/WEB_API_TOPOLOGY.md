# Web and API topology: Vercel + Railway (P0 #2, Option A)

Status: implemented and tested locally against the scratch database. **Not yet verified on a live Vercel/Railway
deployment** (nothing here has touched production infrastructure). Section 6 is the verification to do on first deploy.

## 1. Shape

| Part                 | Host                   | Example                                         |
| -------------------- | ---------------------- | ----------------------------------------------- |
| Web app (Vite build) | Vercel                 | `https://trynook.in`                            |
| API (NestJS)         | Railway, custom domain | `https://api.trynook.in` (API prefix `/api/v1`) |

Both hosts are under one registrable domain (`trynook.in`), so they are **same-site**. That is what lets the
`SameSite=Strict` cookies set by the API be sent on the web app's `fetch(..., { credentials: 'include' })` calls.
Using the default `*.up.railway.app` and `*.vercel.app` hosts would make them cross-site, and the browser would drop
the cookies: use the custom domains.

No `vercel.json` rewrites or proxy are used: the browser talks to the API directly.

## 2. How the browser flow works

1. `POST /auth/login` (credentialed CORS request from `WEB_ORIGIN`). The API sets two **host-only** cookies on
   `api.trynook.in`, both `HttpOnly; Secure; SameSite=Strict; Path=/` and **no `Domain`**:
   `nook_session` (the session) and `nook_csrf` (the CSRF value).
2. The web app calls `GET /auth/csrf`. The token is in the **response body** (`data.csrfToken`). The web app keeps it
   **in memory only**; nothing is written to `localStorage`, `sessionStorage` or `document.cookie`.
3. Every `POST`/`PUT`/`PATCH`/`DELETE` sends the token in the `X-CSRF-Token` header. The server compares it with the
   `nook_csrf` cookie it receives (double submit) after checking `Origin` and the session.
4. The token is cleared and re-fetched whenever the session changes: after sign-in, sign-out, or any 401. A write
   refused with `INVALID_CSRF_TOKEN` (for example a second tab signed in meanwhile) is retried once with a fresh token.
5. A page on another origin cannot read `GET /auth/csrf` (no CORS headers for it), cannot send the cookies
   (`SameSite=Strict`), and is refused by the `Origin` check.

Why the token goes in the body and not in a readable cookie: a cookie set by `api.trynook.in` is invisible to
JavaScript on `trynook.in` unless it is given a shared `Domain`, which would also expose the **session** cookie to every
subdomain. Option A avoids that.

The CSRF cookie is `HttpOnly` as well (it was readable before). The web app never reads it.

## 3. Configuration

### API (Railway service variables)

| Variable           | Value                | Notes                                                                                                                                                                                                                                         |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`          | `production`         | Turns on `Secure` cookies and the HTTPS-origin check.                                                                                                                                                                                         |
| `WEB_ORIGIN`       | `https://trynook.in` | **Exact** origin of the web app: scheme + host (+ port), no path, no trailing slash. Used for CORS and the `Origin` guard. If the web app is served from `www.` or an `app.` host, put that exact host here. Only this one origin is allowed. |
| `TRUST_PROXY_HOPS` | `1`                  | Mandatory in production (the API refuses to start without it). See section 5.                                                                                                                                                                 |
| `DATABASE_URL`     | the runtime-role URL | Never the migrator or superuser role.                                                                                                                                                                                                         |
| `PORT`             | provided by Railway  |                                                                                                                                                                                                                                               |

### Web (Vercel project environment variable, Production)

| Variable        | Value                           |
| --------------- | ------------------------------- |
| `VITE_API_BASE` | `https://api.trynook.in/api/v1` |

`VITE_API_BASE` is baked in at build time. A production build refuses a non-HTTPS or non-absolute value, and warns when
it is unset (an unset value means the app calls the relative `/api/v1` on the Vercel host, which does not reach the API).

### CORS (set in code, `apps/api/src/app.setup.ts`)

Exactly one allowed origin (`WEB_ORIGIN`), `credentials: true`, methods `GET, HEAD, POST, PUT, PATCH, DELETE`, allowed
request headers `Content-Type` and `X-CSRF-Token`, preflight cached for 600 s. Any other origin receives **no** CORS
headers (not even the allowed origin echoed back). Responses vary by `Origin`.

## 4. DNS and TLS (to do outside the repository)

- `trynook.in` -> Vercel (project domain). `api.trynook.in` -> Railway (custom domain on the API service, `CNAME` as
  Railway instructs). Both certificates are issued by the platforms.
- The cookies are `Secure`, so the API must be reached over HTTPS only. TLS ends at Railway's edge and the process sees
  plain HTTP; `Secure` is set by configuration (`APP_ENV=production`), not by looking at the request, so this works
  behind the proxy (covered by a test).

## 5. `TRUST_PROXY_HOPS` and the client address

Sign-in throttling keys on the client address (20 failed sign-ins per 15 minutes per address, plus 5 per account).
The address comes from `X-Forwarded-For`, trusted only to the depth `TRUST_PROXY_HOPS`:

- Too low (`0` behind a proxy): every visitor appears as the proxy's address, so **a handful of failed sign-ins from
  anywhere locks everybody out**. That is why the API refuses to start in production without an explicit value.
- Too high: a client could put a forged address at the front of the header and escape its own lock.

Expected Railway topology: **one** reverse proxy (Railway's edge) in front of the container, and nothing else (Vercel is
not in the API's request path). Express then takes the **last** `X-Forwarded-For` entry, which the proxy appended, as the
client. So `TRUST_PROXY_HOPS=1`. This is the documented expectation for Railway's public networking but has **not been
confirmed against a live Railway service** from this repository; do the check in section 6. If a CDN or another proxy is
ever put in front of Railway, increase the value by one per proxy.

Tested locally (one-hop simulation): clients are throttled separately by the last entry; a forged leading entry does not
reset a lock; the throttle table stores only a hash of the address.

## 6. First-deploy verification checklist (production, by an operator)

1. `GET https://api.trynook.in/api/v1/health` returns 200; `GET .../health/database` returns 200.
2. From the web app: sign in, reload the page (session persists), create and edit a record, delete a record, sign out.
   In the browser's developer tools check the cookies: both `nook_session` and `nook_csrf` show Domain `api.trynook.in`,
   HttpOnly, Secure, SameSite Strict. `localStorage`/`sessionStorage` contain nothing from Nook.
3. Open the web app from a second origin (for example a local `file://` page or another site) and confirm
   `fetch('https://api.trynook.in/api/v1/auth/csrf', { credentials: 'include' })` is blocked by CORS.
4. **Client address check** (no secrets involved). From network A make one failed sign-in with an unknown e-mail; from
   network B make one more. Then, as the database owner:
   ```sql
   SELECT count(*) FROM login_throttles WHERE scope = 'ADDRESS' AND updated_at > now() - interval '5 minutes';
   ```
   Expect **2**. Expect 1 means the value is too low (both look like the proxy): raise `TRUST_PROXY_HOPS`. Next, from
   network A send one failed sign-in carrying a made-up header `X-Forwarded-For: 203.0.113.9`; the count must **stay 2**.
   If it becomes 3 the value is too high: lower it.
5. Session expiry: leave a session idle for more than 30 minutes (or wait for 8 hours); the next action must return to
   the sign-in screen with the "session has ended" notice, and signing in again must work without a page reload.
