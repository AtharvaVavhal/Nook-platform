# Logging, request ids and error monitoring (P0 #4)

Status: logging, request ids, the exception filter, redaction **and the API-side Sentry integration** are implemented and
tested locally (scratch database, in-memory transport; no event has ever been sent to Sentry). Sentry stays **off until
`SENTRY_DSN` is set** on the Railway API service, and nothing here has been verified on a live Railway service.

## 1. What the API now does

| Concern                 | Behaviour                                                                                                                                                                                    | Code                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Structured logs**     | One JSON object per line on **stdout**, flat fields, `level` and `message` first-class                                                                                                       | `observability/json-logger.ts`                      |
| **Request id**          | Every response carries `X-Request-Id` (a UUID). A UUID sent by the caller is kept, anything else is replaced. The id is on every log line of that request and on every audit event it writes | `observability/request-id.ts`, `request-context.ts` |
| **Access log**          | One line per request when the response finishes: method, path, route, status, duration, user and organisation ids, parameter _names_                                                         | `observability/http-logging.ts`                     |
| **Exception filter**    | The only place an exception becomes a response. Deliberate client errors keep their exact body; everything else is a safe `500`                                                              | `observability/all-exceptions.filter.ts`            |
| **Redaction**           | Keys and values, on every field, message and stack before anything is written                                                                                                                | `observability/redact.ts`                           |
| **Error reporter hook** | A no-op by default; the place a Sentry adapter plugs in                                                                                                                                      | `observability/error-reporter.ts`                   |
| **Process crashes**     | `uncaughtException` / `unhandledRejection` are logged as JSON, then the process exits 1 so Railway restarts it                                                                               | `observability/process-handlers.ts`                 |
| **Start-up**            | Config errors and start failures are JSON log lines naming the variable (never its value)                                                                                                    | `main.ts`                                           |

### Log line shape (Railway-friendly)

Railway reads `message` and `level` as the log text and severity and indexes every other top-level field, so the shape is
flat and everything goes to stdout (severity is in `level`, not in which stream was used).

```json
{
  "timestamp": "2026-11-03T09:12:44.120Z",
  "level": "info",
  "message": "request completed",
  "service": "nook-api",
  "env": "production",
  "version": "<git sha>",
  "context": "http",
  "requestId": "3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e6f",
  "method": "GET",
  "path": "/api/v1/invoices",
  "route": "/api/v1/invoices",
  "status": 200,
  "durationMs": 14.2,
  "userId": "…",
  "organizationId": "…",
  "role": "OWNER",
  "queryKeys": ["status", "page"]
}
```

Find one request's whole story in Railway's log search with `@requestId:<id>`; find failures with `@level:error`; one
organisation with `@organizationId:<id>`.

Levels: `5xx` → `error`; `4xx` → `warn`; `2xx/3xx` → `info`; successful `/health` probes → `debug` (so the platform's health
checks do not flood the log). `LOG_LEVEL` sets the minimum.

### What is deliberately never logged

Request and response **bodies**, **cookies**, **headers**, **query-string values** (a search term can be a resident's name),
IP addresses, and passwords, tokens, CSRF values, session secrets, e-mail addresses, phone numbers, names, notes, document
links and amounts. The access log records _that_ a call happened and how it went, not its content. The redaction layer is
the safety net for the fields that _are_ logged and for error text produced by libraries:

- **by key** (value replaced by `[REDACTED]` at any depth): password, passphrase, secret, token, cookie, authorization,
  csrf, credential, api key, signature, hash, otp, session; amount, price, balance, total, rent, deposit, payment, credit,
  cash, account, card, upi, ifsc, gst; phone, e-mail, names, address, date of birth, document, emergency, notes, reason;
- **by value** (inside any string, including messages and stack frames): `scheme://user:password@host`, `Bearer …`, JWTs,
  `nook_session=` / `nook_csrf=` cookies, `password=…` and `"token":"…"` pairs, e-mail addresses, and digit runs of ten or
  more (phone, account, card numbers). UUIDs, dates and invoice numbers are left alone.
- **database-client errors** (Prisma) embed the failing query _and its values_; for them only the first line, the error
  code and the stack frames are kept.
- size limits: strings 500 characters, arrays 50 items, depth 6, cycles cut.

## 2. Error responses

| Situation                                                                              | Client receives                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Validation, authentication, authorisation, not found, conflict (`HttpException` < 500) | **Unchanged** body and status, exactly as before                                |
| Malformed or oversized JSON body                                                       | `400` / `413` JSON from the framework, no HTML, no stack                        |
| Any other exception (bug, database or driver error)                                    | `500` `{"statusCode":500,"message":"Internal server error","requestId":"<id>"}` |
| A `5xx` raised deliberately with internal text                                         | Same safe body (`503` says "Service unavailable")                               |

The `requestId` in a `500` body equals the `X-Request-Id` header, which CORS exposes to the web app. The web app shows
"Something went wrong on our side… Reference: <id>" for any 5xx so a user can quote it; the full detail (message, redacted;
stack frames; user; organisation; path) is in the log line `unhandled exception` with the same id.

## 3. Production environment variables

| Variable                 | Required         | Value / meaning                                                                                                                                 |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                | yes              | `production`                                                                                                                                    |
| `WEB_ORIGIN`             | yes              | Exact web origin, `https://…` (see `WEB_API_TOPOLOGY.md`)                                                                                       |
| `TRUST_PROXY_HOPS`       | yes              | `1` (provisional until verified on Railway)                                                                                                     |
| `DATABASE_URL`           | yes              | Runtime-role connection string                                                                                                                  |
| `LOG_LEVEL`              | no               | `debug` \| `info` \| `warn` \| `error`; default `info` (`warn` when `APP_ENV=test`). Use `info` in production; `debug` only while investigating |
| `RAILWAY_GIT_COMMIT_SHA` | automatic        | Railway sets it; it is added to every log line as `version`                                                                                     |
| `SENTRY_DSN` and related | **not used yet** | Section 7                                                                                                                                       |

No new secret is introduced by logging.

## 4. Railway setup (operator checklist)

- [ ] Service healthcheck path: `/api/v1/health` (it answers 200 without touching the database). Use `/api/v1/health/database` only for dependency checks, not as the deploy healthcheck (a database blip should not restart the API).
- [ ] Confirm in the Railway log view that lines appear as structured attributes (`@level`, `@requestId`) and that `info` lines are not marked as errors.
- [ ] Log retention: record what the Railway plan keeps (it is short); if the incident-investigation window must be longer, a log drain is a decision for later (new vendor, cost, personal-data review). **Unknown today.**
- [ ] Deploy notifications: enable Railway's deployment-failed notifications to the owner.
- [ ] Alerting on error logs: **Railway does not (to the author's knowledge) alert on log content**; confirm. Until Sentry or an uptime monitor exists, errors are found by looking, which is not enough for launch (section 6).

## 5. Using it during an incident

1. User reports "something went wrong, reference `<id>`" → search `@requestId:<id>` → the access line, the
   `unhandled exception` line (error name/code, stack frames) and any other line of that request.
2. For a finance question, the audit rows the request wrote have the same id: `SELECT * FROM audit_events WHERE request_id = '<id>'`.
3. Spike of errors → `@level:error` grouped by `err.name` / `err.code` / `route`.
4. Never paste a raw log into a ticket without checking it: it is redacted, but names inside free text can survive.

## 6. Known limitations and risks

- **No alerting yet.** Without Sentry (or an uptime/log monitor) nobody is told when errors happen. This is the main
  reason section 7 matters before launch.
- Redaction is pattern-based. It cannot know that an arbitrary sentence contains a resident's name. That is why bodies,
  query values and free-text fields are not logged at all and why error text is shortened and scrubbed.
- Over-redaction is deliberate: a field called `total…` or `…account…` is hidden even if it is harmless.
- AsyncLocalStorage carries the request id across `await`; work started outside a request (the future scheduler, startup)
  has no request id and audit events fall back to a fresh UUID.
- Logging adds one synchronous `process.stdout.write` per request; negligible now, revisit at high volume.
- Not verified against the real Railway log pipeline.

## 7. Sentry (approved 2026-11-03; API only)

Implemented in `observability/sentry-reporter.ts` (dependency `@sentry/node` 10.76.2, exact-pinned, installed with
`--ignore-scripts`, recorded in the scope register and manifest). It is installed by `main.ts` only when `SENTRY_DSN` is
set; otherwise the error reporter stays a no-op and the API behaves exactly as without it.

### What is sent, and what is not

| Sent                                                                                                                                     | Never sent                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Unexpected errors only: those the exception filter turns into a 5xx, and process crashes                                                 | 4xx responses, log lines, access logs                                                                                              |
| Error name, a **scrubbed** message, stack **frames** (rebuilt from `serializeError`; the original error object is not passed to the SDK) | Request bodies, query strings, headers, cookies, CSRF or session values, IP address, user e-mail or name, request data of any kind |
| Tags: `requestId`, `method`, `status`, `organizationId`; transaction name = route with ids replaced by `:id`                             | Breadcrumbs (disabled), console output, HTTP/DB spans, traces, profiles                                                            |
| `user.id` only (an opaque UUID)                                                                                                          | Machine name, module list, local variables                                                                                         |
| `release` = `RAILWAY_GIT_COMMIT_SHA`, `environment`                                                                                      | Anything attached to the error object (`request`, `payload`, `cause` are dropped)                                                  |

Controls: `sendDefaultPii: false`; `defaultIntegrations: false` and no extra integrations (so no HTTP, fetch, console,
context or local-variable capture); `skipOpenTelemetrySetup`; `tracesSampleRate: 0`; `maxBreadcrumbs: 0`;
`beforeSend` strips `request`, `server_name`, `modules`, breadcrumbs and unknown contexts and scrubs every remaining
string; connection strings lose their credentials **and host**, e-mail addresses, phone and account numbers, bearer
tokens, JWTs and `password=` pairs are removed. Tests: `sentry-reporter.test.ts` (in-memory transport, no network) and the
Sentry case in `observability.integration.test.ts` (a real 500 through the real app: tagged with the response's
`X-Request-Id`, 4xx not reported, no secret in the envelope).

### Setup (operator, not yet done)

- [ ] Create a Sentry organisation and one project (platform: Node.js). Choose the **EU data region** if offered; the owner decides because resident personal data is in scope.
- [ ] Project settings: _Security & Privacy_ -> enable **Prevent Storing of IP Addresses**, data scrubbing and "Use Default Scrubbers"; leave "Store Native Crash Reports" off.
- [ ] Copy the DSN into the Railway **API service** variables as `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT=production`). Not in the web project, not in git.
- [ ] Alert rules (Sentry -> Alerts): (1) new issue in `production` -> e-mail the owner immediately; (2) more than 10 events in 5 minutes -> e-mail/SMS; (3) issue regression after a release.
- [ ] Confirm the owner and one backup person receive the alerts.
- [ ] **Verify end to end once**, from a Railway shell on the API service, without adding any endpoint:
  ```sh
  node --input-type=module -e "
    import { initSentryReporter } from './dist/observability/sentry-reporter.js';
    const r = initSentryReporter({ dsn: process.env.SENTRY_DSN, environment: 'production', release: 'verify' });
    r.capture(new Error('Sentry verification, safe to ignore'), { status: 500, requestId: 'verify' });
    await r.flush(5000); await r.close();"
  ```
  Expect one issue titled "Sentry verification, safe to ignore" with no user, no request and no IP. Resolve it afterwards.
- [ ] Record in section 6 of `BACKUP_RESTORE.md`-style evidence: date, who verified, region chosen.

### Rollback

Remove `SENTRY_DSN` from the Railway variables and redeploy (or restart): the reporter becomes a no-op. To remove the
integration entirely, delete `sentry-reporter.ts`, its import in `main.ts`, and the dependency.

### Risks

- A third party receives scrubbed error text and stack frames. Scrubbing is pattern-based, like the log scrubbing:
  free-text names in a message cannot be recognised. Error messages written by our own code should therefore never contain
  personal data (they do not today).
- Quota: a failure loop can send many events. Sentry rate-limits and groups them; set a spike alert and a project quota.
- Newest-version risk: the pinned version is the newest v10 release more than two weeks old (2026-10-08), one major
  behind the latest (v11). Revisit at the next dependency review.
- Until the operator steps above are done, **no alert will fire**.
