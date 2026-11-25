# Resident Portal: launch runbook (resident.trynook.in)

Status: PREPARED, NOT EXECUTED. Nothing here has been deployed, no DNS has changed, no SMS has been sent, and no production system has been touched.
Evidence labels: VERIFIED (run locally, result recorded) / NOT VERIFIED (cannot be checked without the real platform) / BLOCKED (needs an owner input).

## 1. What the portal is today

A read-only, hash-routed single-page app (`apps/resident`) that talks only to the documented resident API:
`GET /me`, `/me/stay`, `/me/rent-summary`, `/me/invoices`, `/me/invoices/:id`, `/me/payments`, `/me/receipts/:id`, and
`POST /resident-auth/otp/request`, `/otp/verify`, `/logout` (plus `GET /resident-auth/csrf`, `GET /resident-auth/me`).
Screens: sign-in (phone + one-time code), home, stay, rent, invoice, payments, receipt, profile.

Not built, because the backend has no contract for them (no table, no endpoint): **complaints, maintenance requests, resident notifications.**
They are new features (schema change, migration, API, tests), not launch tasks. See section 11.

## 2. Hosting

No frontend host is configured anywhere in the repository (no `vercel.json`, `netlify.toml` or `Dockerfile` existed; the API runs on Railway).
`apps/resident/vercel.json` was added as a ready configuration. Any static host works because routes are hash routes (no rewrite rules are needed).

| Setting        | Value                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| Root directory | `apps/resident` (with "include files outside the root directory" enabled)       |
| Install        | `cd ../.. && npm ci`                                                            |
| Build          | `cd ../.. && npm run build --workspace @nook/resident`                          |
| Output         | `dist`                                                                          |
| Node           | `>=24.22.1 <25`, npm `>=11.6.2 <12` (root `engines`)                            |
| Build variable | `VITE_API_BASE=https://api.trynook.in/api/v1` (public, pinned in `vercel.json`) |

NOT VERIFIED: a real Vercel (or other host) build from this configuration. The local equivalent is VERIFIED (section 9).

If another host is chosen, copy the header table from `vercel.json` (CSP, HSTS, nosniff, no-referrer, frame denial, COOP, Permissions-Policy, cache rules) and keep the CSP `connect-src` equal to the API origin.

## 3. Environment checklist (names only; values live in the platform, never in the repository)

Frontend host:

- `VITE_API_BASE` = `https://api.trynook.in/api/v1` (already in `vercel.json`; it is not a secret).

API (Railway), all required before resident sign-in can work:

- `RESIDENT_WEB_ORIGIN` = `https://resident.trynook.in` (exact origin, https, no path, no trailing slash; must differ from `WEB_ORIGIN`). Absent means the portal is OFF and every resident route answers 404.
- `RESIDENT_OTP_SECRET` = at least 32 random characters (secret). Required whenever `RESIDENT_WEB_ORIGIN` is set; the API refuses to start otherwise.
- `RESIDENT_SMS_PROVIDER` = `disabled` until a real provider adapter exists. `mock` is refused in production.
- `TRUST_PROXY_HOPS` already mandatory in production; per-address rate limits depend on it being correct.

## 4. DNS and HTTPS (instructions only; not executed)

1. In the host, add the domain `resident.trynook.in` to the resident project.
2. At the DNS provider for `trynook.in`, create the record the host displays (normally a CNAME `resident` to the host's target).
3. Wait for the host to issue the TLS certificate; confirm `https://resident.trynook.in` loads and HTTP redirects to HTTPS.
4. Do not enable HSTS preload. The `includeSubDomains` header is already set; check no other `trynook.in` subdomain is HTTP-only first.
5. The API cookie rules need no change: the portal and API are the same site (`trynook.in`), so the `SameSite=Strict`, `Secure`, `HttpOnly` cookies are sent on the portal's calls.

## 5. Deployment order

1. Merge approved release scope (owner decision; not yet made).
2. Set the API variables in section 3 on Railway and redeploy the API. Confirm it starts (config validation runs at boot).
3. Deploy the frontend. Open the preview URL and run section 7 steps 1 to 4 before attaching the domain.
4. Attach `resident.trynook.in` (section 4). Run the full smoke test.
5. Create resident accounts only for real, consenting residents, after SMS is live.

## 6. Rollback

- Frontend: promote the previous deployment in the host (or redeploy the previous commit). Static; takes effect immediately. Hashed assets from the failed build stay cached harmlessly.
- API switch-off without a redeploy of code: remove `RESIDENT_WEB_ORIGIN` and redeploy; every resident route answers 404 and no resident session can be used.
- Sessions: revoke or suspend accounts through the existing owner endpoints (`POST /resident-accounts/:id/suspend|revoke`).
- Database: this launch changes no schema and runs no migration. The resident tables come with the Phase 2 migration, which has its own governance.

## 7. Production smoke tests (run after deploy; none sends an SMS)

1. `https://resident.trynook.in/` returns 200 with the headers from `vercel.json` (check with `curl -sI`).
2. The browser console shows zero CSP violations on load.
3. The sign-in page renders; entering a phone number shows the neutral outcome without revealing whether the number is registered.
4. CORS: a preflight from `https://resident.trynook.in` to a resident route is allowed; to an owner route (for example `/api/v1/properties`) it is refused; a preflight from any other origin is refused.
5. `GET /api/v1/me` without a cookie answers 401 and `Cache-Control: no-store`.
6. Rate limit: repeated code requests for one number are throttled after 5 in an hour (use a test number you own, only after SMS is live).
7. With SMS live and an owner-created test account: full sign-in, home, stay, rent, one invoice, one receipt, sign-out; confirm the session cookie is gone and `/me` answers 401 afterwards.
8. Idle expiry: after 30 minutes idle the next call answers 401 and the app shows the signed-out screen.

## 8. Monitoring requirements

- Frontend uptime check on `/` (expect 200).
- API: alert on 5xx rate for `/api/v1/me*` and `/api/v1/resident-auth/*`.
- Alert on OTP delivery failures (`SmsDeliveryResult.status = FAILED`) and on a spike of throttled requests (possible abuse).
- Alert on audit-event anomalies: many failed verifications from one address.
- Never log the code, the phone number or the cookie (the existing audit service already omits them; keep it that way).

## 9. Local evidence (VERIFIED)

- `apps/resident` typecheck, ESLint, Prettier: pass.
- Resident unit and build-output tests: pass (`npm test --workspace @nook/resident`), including `tests/hosting-config.test.ts`.
- API resident rule tests: 89 of 89 pass.
- The production bundle built with `VITE_API_BASE=https://api.trynook.in/api/v1`, served locally with the exact CSP from `vercel.json`, loaded in headless Chrome with **0 CSP violations**; the app rendered its "can't reach Nook" screen because the API host was blocked in that run (no production request was made).
- NOT RE-RUN in this pass: PostgreSQL 17 integration tests and `npm run test:browser` (see section 10).

## 10. Open technical blockers

1. PostgreSQL 17 integration tests need Docker. Docker Desktop did not start in this session and the disk had under 1 GiB free. They passed earlier in the Phase 2 work with the disposable database.
2. `npm run test:browser` needs `puppeteer-core`, which is absent from the available `node_modules`. Run it after a clean `npm ci`.
3. The worktree has no root `node_modules` of its own; the checks above ran through a temporary link to a sibling checkout whose versions of every resident dependency match (vite 8.3.5, react 19.3.1, typescript 5.9.3, tsx 4.20.6). A clean `npm ci` is still required for lockfile-exact evidence.

## 11. Owner inputs and decisions

- Frontend host choice and account (and DNS access for `trynook.in`).
- MSG91 or another SMS provider. Needed for MSG91: the field-level API reference (endpoint, authentication header, request and response fields), the DLT entity ID, sender ID and approved template ID, and a decision on using MSG91 as transport only (Nook generates the code) versus MSG91's own OTP product. The official pages reachable on 2026-11-22 and 2026-11-23 did not state these, so no adapter was written and nothing was invented. Until then the provider stays `disabled` and live login cannot work.
- Whether complaints, maintenance requests and notifications are wanted for the first release. Each needs a data model and API contract first.
- Release scope and slice sign-offs (Phase 2 owner decisions) before any commit or push.

## 12. Security checklist

| Item                                                                                    | State                                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Session cookie HttpOnly, Secure, SameSite=Strict, no Domain                             | VERIFIED in source (`resident-auth.controller.ts`)                                            |
| Separate resident session table, cookie names, 30 min idle / 8 h absolute               | VERIFIED in source (`policy.ts`)                                                              |
| CSRF token on state-changing resident routes                                            | VERIFIED in source (`ResidentCsrfGuard` on logout; origin guard on OTP routes)                |
| Resident and organization taken from the session, never the request                     | VERIFIED in source (`ResidentSelfController`); no route accepts a resident or organization id |
| Permission required on every `/me` route                                                | VERIFIED in source (`RequireResidentPermission` on all seven)                                 |
| OTP: 6 digits, 5 min life, 5 attempts, 30 s resend cooldown, hashed at rest             | VERIFIED in source and by the API rule tests                                                  |
| Rate limits: 5 codes/phone/h, 20/address/h, 10 verifies/phone/15 min, 30/address/15 min | VERIFIED in source                                                                            |
| Wrong and expired codes indistinguishable; ineligible accounts see a generic signed-out | VERIFIED in source and tests                                                                  |
| Resident origin may call only resident routes (CORS allow-list)                         | VERIFIED in source (`app.setup.ts`); production check is smoke test 4                         |
| Cross-tenant isolation against a real database                                          | PASSED earlier (Phase 2); NOT RE-RUN in this pass                                             |
| Strict CSP and security headers                                                         | VERIFIED locally (0 violations); NOT VERIFIED on the real host                                |
| No source maps, no secrets in the bundle                                                | VERIFIED by `tests/build-output.test.ts`                                                      |

## 13. Release acceptance criteria

The portal may be called production-ready only when ALL of these have evidence:

1. Owner approves the release scope and the slice sign-offs.
2. Clean `npm ci`, then typecheck, ESLint, Prettier, unit, build-output and browser tests all pass.
3. PostgreSQL 17 integration suite, including cross-tenant tests, passes on a disposable database.
4. The Phase 2 migration is applied to production under its own approved procedure.
5. A real SMS provider adapter is implemented from official documentation, tested, and approved; `RESIDENT_SMS_PROVIDER` is not `disabled`.
6. API variables set; frontend deployed; DNS and HTTPS live.
7. Smoke tests 1 to 8 pass on production.
8. Monitoring and alerts from section 8 are active.
9. An independent review has signed off.

## 14. Non-production preview: reading the mock one-time code

Preview only. Real SMS is NOT implemented and this section never applies to production (the API refuses `RESIDENT_SMS_PROVIDER=mock` when `APP_ENV=production`).

- Preview API settings: `APP_ENV=development` (the API accepts only `development`, `test` and `production`; the preview line is written ONLY for `development`, `test` stays silent so CI logs never hold a code), `RESIDENT_SMS_PROVIDER=mock`.
- When a code is requested for a provisioned account, the API writes ONE warning-level log line that starts with `PREVIEW-ONLY MOCK SMS (not delivered to any handset)` and contains the masked number (`+91******NNNN`), the expiry time (UTC) and the code (`otp=NNNNNN`).
- A presenter with access to the preview API's logs (the hosting platform's log viewer) filters for `PREVIEW-ONLY MOCK SMS` and reads the newest line for the masked number. Codes are random per request, valid 5 minutes, and a new request replaces the previous code.
- The code is never in an API response, a database row (only its hash), the browser, or this repository. Treat preview logs as sensitive and restrict who can read them.
- `APP_ENV=development` also turns off the `Secure` cookie flag and the production-only start-up checks; use it only for a short-lived, non-production preview. Cookies are `SameSite=Strict`, so the portal and the API must share a registrable domain (or run on localhost).
