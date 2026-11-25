# Resident Portal — Phase 2: Resident self-service APIs

Status: implemented, revised after owner review (profile field set approved, ACTIVE-resident access required,
staff status changes end portal access); awaiting final owner sign-off (scope slice 5.2 is recorded as pending). Backend only; no frontend, no schema change, no migration.
All examples below use synthetic data.

## Resident self-service API scope

Seven read-only `GET` endpoints under `/api/v1/me`, available only to a signed-in resident (Phase 1 resident session).
They expose a resident's own profile, stay, rent position, invoices, payments and receipts, built from the existing stay
and finance services. Nothing is written: no payment collection, refund, invoice or payment change, or correction.

In scope: the endpoints below, their response contract, visibility rules and tests.
Out of scope: any frontend, profile editing, online payment, payment disputes, PDF receipts, SMS provider, owner or
manager authentication changes, new table.

The one authentication-policy change in this revision is the owner-approved ACTIVE-resident rule below.

Routes (all `GET`):

- `/api/v1/me`
- `/api/v1/me/stay`
- `/api/v1/me/rent-summary`
- `/api/v1/me/invoices`
- `/api/v1/me/invoices/:id`
- `/api/v1/me/payments`
- `/api/v1/me/receipts/:id`

Changes to existing code: two `export` keywords in `finance/finance.service.ts` (so the resident views use the same
invoice status sets as the owner views), and `resident/resident.service.ts`, where the three status-changing paths now
end the resident's portal access in the same transaction (see "Portal eligibility").

## Authentication and authorization

- Requires the `nook_resident_session` cookie (Phase 1). Identity comes only from `request.residentAuth`
  (account, resident and organization ids resolved server-side from the session).
- No resident or organization id is ever read from the path, query, body or headers. Every database query filters by
  the session's organization and resident.
- Authorization is default-deny: each route declares `resident.self.read`. Owner/manager permissions are not reused.
- Portal eligibility is checked on every request, including with an already-created session (see the next section).
- A staff session on `/me/*` gets 401. A resident session on any staff route gets 403 `INSUFFICIENT_ROLE`.
- Responses carry `Cache-Control: no-store`.
- CORS: the resident web origin may call only `/api/v1/resident-auth/*` and `/api/v1/me/*`.
- The routes return 404 when `RESIDENT_WEB_ORIGIN` is not configured (portal disabled).
- There are no write routes under `/me`; POST/PUT/PATCH/DELETE return 404.

## Portal eligibility (ACTIVE residents only)

Only a resident whose **status is `ACTIVE`**, with a resident account whose **status is `ACTIVE`**, in an `ACTIVE`
organization, may use the portal:

| Resident status | Account status | Access  |
| --------------- | -------------- | ------- |
| ACTIVE          | ACTIVE         | Allowed |
| INACTIVE        | ACTIVE         | Denied  |
| ARCHIVED        | ACTIVE         | Denied  |
| any             | SUSPENDED      | Denied  |
| any             | REVOKED        | Denied  |

One definition (`PORTAL_ELIGIBLE` in `resident-auth/policy.ts`) is applied server-side at every step; nothing relies on
the frontend:

1. **OTP request**: an ineligible number gets the same response as an unknown number and no code is sent.
2. **OTP verification**: refused with the same generic 401 as a wrong code or an unknown number, even for a correct,
   unexpired code. No cookie is issued.
3. **Session creation**: eligibility is re-checked inside the transaction that consumes the code and creates the
   session, so a resident who becomes INACTIVE in between gets no session.
4. **Every request** (`/me/*` and `/resident-auth/me`): the session is re-validated against the current resident,
   account and organization state.

**Status change ends portal access (atomic).** When an owner or manager sets a resident to `INACTIVE` or `ARCHIVED`,
every live portal session of that resident, and every unused sign-in code, is revoked **in the same database
transaction** as the status change. The staff routes that can change a resident's status are all covered:

| Staff route                                  | Permission        | Effect on portal access                         |
| -------------------------------------------- | ----------------- | ----------------------------------------------- |
| `PUT /residents/:id` with `status: INACTIVE` | `resident.write`  | sessions and codes revoked, `RESIDENT_INACTIVE` |
| `PUT /residents/:id` with `status: ARCHIVED` | `resident.write`  | sessions and codes revoked, `RESIDENT_ARCHIVED` |
| `DELETE /residents/:id` (archives)           | `resident.delete` | sessions and codes revoked, `RESIDENT_ARCHIVED` |

The revocation is scoped by organization and resident, so no other resident or organization is affected. If the
revocation fails, the whole transaction rolls back: the resident keeps their previous status and their sessions remain
valid, and the staff request fails with a generic 500 (no internal detail). No staff permission or authorization rule
changed, and no resident session identifier appears in any response. The status change writes no audit rows of its own,
exactly as before; the revoked sessions carry the reason code.

**Re-activation does not restore anything.** Setting the resident back to `ACTIVE` revives no earlier session and no
earlier code. The resident must sign in again with a **fresh OTP**, which creates a new session.

**Defense in depth.** Eligibility is also checked on every request. A live session refused for eligibility reasons
(for example after a status written directly in the database) is refused with the generic `401 UNAUTHENTICATED`, which
never says why, and is revoked (`PORTAL_INELIGIBLE`) at that moment.

**Known limitation: direct database writes.** A resident status update made **directly in the database** (for example
a manual SQL `UPDATE residents SET status = ...`) bypasses the application and does **not** immediately revoke the
resident's portal sessions. The per-request check still refuses an INACTIVE or ARCHIVED resident on the very next request
and ends the session it is presented with, but a session that is **not used at all** during the inactive period is not
ended: after the resident is set back to ACTIVE it can become usable again, until its own idle (30 minutes) or absolute
(8 hours) expiry. No database trigger or migration was added for this; the guarantee lives in the application workflow.

**Operational rule.** Resident status changes must be made only through the application workflow: `PUT /residents/:id`
or `DELETE /residents/:id` (owner or manager). Do not change `residents.status` with direct SQL. If it was ever done,
an owner can end any remaining portal sessions and pending codes by suspending the resident's portal account
(`POST /resident-accounts/:id/suspend`) and, when appropriate, re-activating it
(`POST /resident-accounts/:id/reactivate`); re-activation does not restore the ended sessions.

Owner and manager authentication and permissions are unchanged. The resident session is a separate principal.

## Response format and errors

Success: `{ "data": ... }`. Money is a string with two decimals (`"8000.00"`), dates are `YYYY-MM-DD`, timestamps are
ISO 8601 UTC.

| Status | Body                                                | When                                                                                                    |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 401    | `{ "code": "UNAUTHENTICATED" }`                     | missing, malformed, expired, revoked session; ineligible resident or account (see above); staff session |
| 403    | `{ "code": "INSUFFICIENT_ROLE" }`                   | resident session on a staff route                                                                       |
| 404    | `{ "code": "NOT_FOUND" }`                           | record does not exist, belongs to someone else, or is not visible. The two cases are indistinguishable  |
| 400    | `{ "code": "INVALID_ID" }`                          | `:id` is not a UUID                                                                                     |
| 400    | `{ "code": "INVALID_PAGINATION", "field": "page" }` | invalid, repeated or out-of-range `page`/`limit`                                                        |

## Pagination

List endpoints (`/me/invoices`, `/me/payments`) accept `page` (integer >= 1, default 1) and `limit` (integer 1-50,
default 20). Invalid values are rejected, never clamped. Response:

```json
{ "data": { "items": [], "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } } }
```

A page beyond the end returns `items: []`. Ordering is stable: invoices by period descending then number; payments by
received time descending then id.

## Visibility rules

- **Invoices** visible to a resident: `ISSUED`, `PARTIALLY_PAID`, `OVERDUE`, `PAID` (the same billable set the owner
  finance views use). `DRAFT` and `CANCELLED` (voided) invoices are never shown; direct lookup returns 404. `status` is
  the effective status (an `ISSUED` invoice past its due date reads `OVERDUE`).
- **Outstanding** = total amount − settled paid amount, as on the owner side. Credit adjustments are reflected in the
  numbers but adjustment records, reasons and notes are not exposed.
- **Payments** are limited to payments on visible invoices. A reversed payment is shown with status `REVERSED`; the
  reversal reason and actor are not exposed.
- **References** are masked to `****` plus the last four characters.
- **Phone** is masked (`+91******1234`).
- Never returned: documents or document metadata, address, date of birth, email, emergency contacts, internal notes,
  void/adjustment/reversal reasons, staff names or ids, audit data, resident/organization/account ids, session or OTP data.

## Endpoints

### GET /me

```json
{
  "data": {
    "displayName": "Asha Example",
    "firstName": "Asha",
    "lastName": "Example",
    "phone": "+91******4321",
    "accountStatus": "ACTIVE",
    "residentStatus": "ACTIVE",
    "organizationName": "Example Hostel Co",
    "memberSince": "2026-05-01T09:30:00.000Z"
  }
}
```

### GET /me/stay

`status` is one of `CURRENT`, `UPCOMING`, `COMPLETED`, `NONE`, `UNDER_REVIEW`. It uses the existing stay-summary
allocation logic. `UNDER_REVIEW` is returned (with empty fields) when the stay records are inconsistent and need staff
attention; no detail is revealed. `upcoming[].stage` is `BOOKED`, `ADMISSION_PENDING`, `ADMITTED_AWAITING_CHECK_IN` or
`START_DATE_PASSED`.

```json
{
  "data": {
    "status": "CURRENT",
    "current": {
      "hostelName": "Example Residency",
      "organizationName": "Example Hostel Co",
      "roomNumber": "204",
      "bedNumber": "B-2",
      "checkInDate": "2026-09-02T06:00:00.000Z",
      "expectedCheckOutDate": "2027-03-31",
      "monthlyRent": "8000.00",
      "stayStatus": "ACTIVE"
    },
    "upcoming": [],
    "lastStay": null
  }
}
```

Empty states: no stay gives `{"status":"NONE","current":null,"upcoming":[],"lastStay":null}`; a completed stay gives
`status: "COMPLETED"` and `lastStay: { "checkedOutAt": "..." }`; a future booking gives `status: "UPCOMING"` with an
`upcoming` entry (`hostelName, roomNumber, bedNumber, startDate, endDate, monthlyRent, stage`).

### GET /me/rent-summary

```json
{
  "data": {
    "totalInvoiced": "24000.00",
    "totalPaid": "11000.00",
    "outstanding": "13000.00",
    "overdue": "5000.00",
    "nextDueDate": "2026-12-20",
    "status": "OVERDUE",
    "invoiceCount": 3
  }
}
```

`outstanding` and `overdue` come from the existing owner outstanding calculation. `status` is a label for display:
`NO_INVOICES`, `PAID_UP`, `DUE`, `OVERDUE`. `nextDueDate` is the earliest open due date on or after today, or `null`.
A resident with no invoices gets zeros and `NO_INVOICES`.

### GET /me/invoices

```json
{
  "data": {
    "items": [
      {
        "id": "00000000-0000-4000-8000-000000000001",
        "number": "INV-000123",
        "periodStart": "2026-11-01",
        "periodEnd": "2026-11-30",
        "issuedAt": "2026-11-01T04:00:00.000Z",
        "dueDate": "2026-11-05",
        "totalAmount": "8000.00",
        "paidAmount": "3000.00",
        "outstandingAmount": "5000.00",
        "status": "OVERDUE"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

### GET /me/invoices/:id

The invoice fields above plus `payments`: the invoice's payments (same shape as the payments list items below,
without the `invoice` object). Ownership is enforced in the database query (`id` + organization + resident + visible
status); anything else is 404.

### GET /me/payments

```json
{
  "data": {
    "items": [
      {
        "id": "00000000-0000-4000-8000-0000000000a1",
        "receiptNumber": "RCPT-00000000-0000-4000-8000-0000000000a1",
        "paidAt": "2026-11-02T10:15:00.000Z",
        "amount": "3000.00",
        "method": "UPI",
        "reference": "****3210",
        "status": "COMPLETED",
        "invoice": { "id": "00000000-0000-4000-8000-000000000001", "number": "INV-000123" }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

`status` is `COMPLETED` or `REVERSED`.

### GET /me/receipts/:id

`:id` is a **payment** id. The receipt is produced by the existing owner receipt logic after an ownership check.
A reversed payment's receipt shows `status: "REVERSED"`.

```json
{
  "data": {
    "receiptNumber": "RCPT-00000000-0000-4000-8000-0000000000a1",
    "issuedBy": "Example Hostel Co",
    "issuedTo": "Asha Example",
    "invoice": {
      "number": "INV-000123",
      "periodStart": "2026-11-01",
      "periodEnd": "2026-11-30",
      "totalAmount": "8000.00",
      "paidAmount": "3000.00",
      "outstandingAmount": "5000.00",
      "status": "OVERDUE"
    },
    "payment": {
      "id": "00000000-0000-4000-8000-0000000000a1",
      "paidAt": "2026-11-02T10:15:00.000Z",
      "amount": "3000.00",
      "method": "UPI",
      "reference": "****3210",
      "status": "COMPLETED"
    },
    "balanceAfterPayment": "5000.00"
  }
}
```

## Owner decisions and design notes

1. **Profile fields (approved, unchanged).** The profile contains exactly: `displayName`, `firstName`, `lastName`,
   masked `phone`, `accountStatus`, `residentStatus`, `organizationName`, `memberSince`. Email, residential address,
   date of birth, emergency contacts, identity documents, internal notes and any other personal or financial data are
   excluded. Because only ACTIVE residents can use the portal, `residentStatus` is always `ACTIVE` in a response; the
   field is kept so the approved contract does not change. Tests assert the exact key set (unit test with a deliberately
   over-selected row, and the integration suite).
2. **ACTIVE-resident access (approved).** See "Portal eligibility". Replaces the earlier rule that blocked only ARCHIVED
   residents.
3. **Hostel name** is the property name; the property model has only `code` and `name`, so no address is exposed.
4. **Rent `status` label** is presentation only; it adds no financial rule.
5. **Scope approval (pending).** Slice 5.2 in `scripts/phase_scope.json` is recorded with status
   `pending-owner-signoff` and an empty approver and date: the implementation is complete, but **no owner sign-off has been
   given**, and none is recorded here. It lists exactly the seven `GET` routes above, no tables, models, enums, functions
   or migrations, and no general vocabulary exception: the word "rent" is allowed only as the exact route token
   `_api_v1_me_rent` through `allowedIdentifiers`. While the slice is pending, the scope guard deliberately fails rules S8
   (routes not approved) and S11 (slice not approved); that is the guard doing its job, not a defect. On sign-off, the
   owner (or the owner's instruction) supplies `approver` and `date` and sets `status` to `approved`; nothing else changes.

## Explicit exclusions

Not provided by this API: profile editing, online payments or any payment collection, refunds, payment disputes,
invoice or payment changes, PDF receipts (receipts are JSON), notifications, complaints, or any write endpoint.

## Tests

- `apps/api/test/resident-self.rules.test.ts`: database-free unit tests of the mappers, exact key sets and rules.
- `apps/api/test/resident-auth.rules.test.ts`: includes the pinned eligibility policy.
- `apps/api/test/integration/resident-self.integration.test.ts`: real HTTP against disposable PostgreSQL. Data is built
  through the owner workflows (issue, pay, reverse, credit, void) and each resident figure is cross-checked against the
  owner API. It proves cross-resident and cross-organization isolation, session and account-state refusal, the
  ACTIVE/INACTIVE/ARCHIVED matrix on every `/me/*` route, CSRF/origin/CORS behaviour, pagination limits, absence of
  sensitive fields, and that the endpoints write nothing (database snapshot before and after).
- `apps/api/test/integration/resident-auth.integration.test.ts`: includes the status-policy test covering OTP request,
  verification, session creation (with a database trigger that makes the resident INACTIVE mid-login), an existing
  session, re-activation and unaffected bystanders.
- `resident-auth.integration.test.ts` also covers staff status changes end to end (owner and manager; INACTIVE, ARCHIVED and
  DELETE paths; several sessions; bystander resident and organization; re-activation; fresh OTP; unchanged authorization)
  and the rollback when revocation fails (a real database trigger makes the revocation fail inside the transaction).
- Ownership filters, the eligibility checks and the revocation (skipped, non-atomic, too wide, codes not invalidated) were
  mutation-tested: each makes the suite fail.

## Remaining limitations

- Read-only by design: a resident cannot pay, dispute or download a PDF; receipts are JSON.
- A resident status changed by a direct database write does not revoke sessions immediately, and a session unused during the
  inactive period can become usable again after re-activation until it expires. Status changes must use the application
  workflow (see "Portal eligibility", operational rule).
- Currency is not included in responses (all amounts are INR, as elsewhere in the product).
- No property address, contact details or document status are returned.
- Stay records in a state the stay logic rejects as inconsistent show as `UNDER_REVIEW` without detail.
