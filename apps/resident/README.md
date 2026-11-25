# Nook Resident Portal (`@nook/resident`)

The resident-facing app for `resident.trynook.in`: sign in with a phone number and a one-time code, then see your stay, rent,
invoices, payments and receipts. Read-only. It is a separate workspace from the owner dashboard (`apps/web`) and shares only the
brand palette.

## Run it

```
npm run dev --workspace @nook/resident        # http://localhost:5174
npm test --workspace @nook/resident           # unit tests (formatting, routing, API client, tokens and contrast)
npm run typecheck --workspace @nook/resident
npm run build --workspace @nook/resident
```

The API must allow this origin: set `RESIDENT_WEB_ORIGIN=http://localhost:5174` (and `RESIDENT_OTP_SECRET`) for the API
(see `docs/resident-portal/PHASE_1_RESIDENT_AUTH.md`). In development Vite proxies `/api` to `http://localhost:3000`.

## Configuration

| Variable        | Where                             | Meaning                                                                   |
| --------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `VITE_API_BASE` | build time (public, not a secret) | API address, e.g. `https://api.trynook.in/api/v1`. Defaults to `/api/v1`. |

There are no secrets in this app. The session is an HttpOnly cookie that the browser sends and the app cannot read; nothing is
stored in `localStorage`, `sessionStorage` or readable cookies.

## What it calls

Only the documented resident API (`docs/resident-portal/PHASE_2_RESIDENT_APIS.md`): `GET /me`, `/me/stay`, `/me/rent-summary`,
`/me/invoices`, `/me/invoices/:id`, `/me/payments`, `/me/receipts/:id`, plus `POST /resident-auth/otp/request`, `/otp/verify`
and `/logout` (with the resident CSRF token from `/resident-auth/csrf`). A unit test fails if any other call, any write
endpoint, or any payment/registration/staff wording appears in the source.

## Design notes

- Colours come from the owner app's canonical tokens (copied; a test fails if they drift) and every text/background pair is
  checked for WCAG AA in `src/styles/tokens.test.ts`.
- The Nook logo is the original white wordmark, unmodified, and is only placed on Midnight Indigo.
- The API deliberately answers a wrong code and an expired code identically, and shows a suspended, revoked, inactive or archived
  resident only a generic "signed out". The UI words these honestly and never pretends to know more.
