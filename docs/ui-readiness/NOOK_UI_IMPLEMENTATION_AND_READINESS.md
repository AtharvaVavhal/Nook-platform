# Nook UI implementation and readiness

Date: 2026-11-13. Branch `feature/phase-4-1-lifecycle-audit`. Nothing was committed, pushed, merged or deployed. Existing uncommitted work was preserved.

## 1. Executive summary

The request was to deliver four role experiences (Owner, Property Manager, Staff, Resident). **Only two exist in the product today.** The API defines `MembershipRole = OWNER | PROPERTY_MANAGER` and has no endpoints for staff or membership management, resident accounts or portal, notifications, settings or a transfer queue/detail. Under the rule "do not invent endpoints, fields or permissions", the work in this pass was limited to what existing contracts support. Everything else is isolated behind explicit "Not available yet" screens that list the missing backend contract, and none of it uses mock data.

Delivered: role/route protection for unsupported roles, the role matrix, Settings (organization read-only, properties live, account/security live), Staff and access, Notifications and Transfers unavailable screens, and resident-profile invoice history and a document/KYC status card.

Not delivered, because the contract does not exist: staff management, resident portal, notification center data, preferences, billing configuration, transfer queue/detail. Not run in this pass: browser, responsive, accessibility and real-API/PostgreSQL tests (see sections 8 to 10).

**Verdict: NOT READY — MULTIPLE BLOCKERS** (backend dependencies and owner decisions; browser verification of this pass also outstanding).

## 2. Existing screens preserved

The 44 screens from `BASELINE.md` are untouched in routing and behavior. Changes to existing files were additive: sidebar links, breadcrumb section, the role label helper, the resident Overview and Finance tabs. Typecheck, 116 frontend tests (113 prior + 3 new) and production build pass. Prior browser results (22/22 scenarios, 252 route scans) were not re-run and do not cover the new screens.

## 3. New screens implemented

| Route | Status |
|---|---|
| `#settings/organization` | Live, read-only (name and your role from `/auth/me`). No edit API. |
| `#settings/properties` | Live list from `GET /properties`, with loading, empty and error states; links to existing property screens. |
| `#settings/access` | Role matrix plus staff-contract-missing state. |
| `#settings/notifications` | Unavailable (no preference storage or delivery service). |
| `#settings/billing` | Unavailable (no endpoint; GST, late fee, cancellation are unapproved policy). |
| `#settings/account` | Live change-password using the existing session API. |
| `#staff` | Unavailable state plus role matrix. |
| `#notifications` | Unavailable state. No fake items, no delivery claims. |
| `#transfers`, `#transfers/:id` | Unavailable state. Execution stays disabled; the record id is not looked up. |
| Access denied (login of an unsupported role) | `UnsupportedRolePage`, shown in place of the workspace. |
| Resident profile → Overview | New "Documents and KYC" card: real verification status and whether a document reference exists. Read-only. |
| Resident profile → Finance | New "Invoice history": all statuses, server-paginated (`residentId` filter), no 100-record cap. |

## 4. Role-by-role matrix

Derived from backend source (see `apps/web/src/access.ts` for file references).

| Capability | Owner | Manager | Staff | Resident |
|---|---|---|---|---|
| Properties, floors, rooms, beds | Yes | Yes | No role | No role |
| Enquiries, residents, bookings, admissions, check-ins | Yes | Yes | No role | No role |
| Booking extension approval | Yes | Yes | No role | No role |
| Invoices, payments, receipts, dues | Yes | Yes | No role | No role |
| Create/withdraw correction requests | Yes | Yes | No role | No role |
| Approve/reject financial or exceptional corrections | Yes | No | No role | No role |
| Resolve correction finance reviews | Yes | No | No role | No role |
| Resolve transfer finance reviews | Yes | No | No role | No role |
| Transfer preview and history | Yes | Yes | No role | No role |
| Transfer execution | Disabled | Disabled | No role | No role |
| Settings (read-only org, properties, change own password) | Yes | Yes | No role | No role |

"No role" means the API defines none, so none was invented.

Frontend note: Settings, Staff, Notifications and Transfers screens are shown to both defined roles. They read only existing endpoints that already enforce session and organization, or show no data. The frontend gate for unsupported roles is not a substitute for API authorization, and the API remains the enforcement point.

## 5. API integration status

| Area | Status |
|---|---|
| Properties list, change password, `/auth/me` | Integrated (existing). |
| Invoices by resident (paged), resident record | Integrated (existing; `residentId` filter added to the client call only). |
| Staff, memberships, invitations | No API. |
| Resident auth, portal, self-service reads | No API. |
| Notifications and preferences | No API. |
| Organization and billing settings | No API. |
| Transfer queue and detail | No API. `preview`, `history`, `finance-reviews` exist but are per-resident or per-review, not a queue. |
| Payment history list | No list-payments endpoint. Payments are reachable per invoice from invoice detail. |
| Document upload, review, rejection reason | No API. `documentUrl`, `documentVerificationStatus` and free JSON `documentMetadata` exist on the resident, but no upload, reviewer role or rejection-reason field. |

## 6. Backend dependencies

1. **Staff:** `STAFF` in `MembershipRole` plus migration and an approved permission set; organization-scoped membership list/create/update/deactivate; membership-to-property assignment model; user provisioning or invitation endpoint (only `passwordChangeRequired` exists); audit read endpoint; STAFF-aware guards on every controller.
2. **Resident portal:** a `RESIDENT` role or a separate principal linked to exactly one `Resident` row via the server-side session; `/me/*` endpoints (booking, stay, invoices, payments, receipts, documents, notifications, profile) whose identity comes only from the session; tenant and own-record tests; support-request model if wanted.
3. **Notifications:** model, list/mark-read, preferences, delivery provider.
4. **Settings:** organization update and billing-settings endpoints.
5. **Documents:** upload storage, verification endpoints with an approved reviewer role, rejection-reason field.
6. **Transfers:** A1 queue/detail contract; stale-proposal signal.
7. **Payments list:** paginated payments endpoint (resident-scoped for admin, own-scoped for resident).

## 7. Features blocked by owner decisions

Transfer decisions D1–D8 (requester and reviewer roles, lifecycle, execution timing, cross-property and partial transfers, resident consent); STAFF permission set; resident-visible data scope; GST, pricing, cancellation and late-fee policy; notification categories and channels; who may verify documents.

## 8. Responsive test results

**Not run for this pass.** The new screens reuse existing `fin-*`/`profile-*` layout classes, but no 1440/768/390 verification was done, so no overflow claim is made. The earlier 252-scan result covers only the prior screens.

## 9. Accessibility results

**Not certified.** By construction the new screens use semantic headings, labelled tables with captions, `scope` attributes, `role="status"` and `role="alert"` states and the existing form components. No screen reader, keyboard, focus or contrast testing was done on them, and none was done on real devices or Safari.

## 10. Test results

- Typecheck: pass. Build: pass.
- Frontend unit tests: 116 pass, 0 fail (3 new in `src/access.test.ts`: unsupported roles denied, matrix never lets a manager have owner-only rights, admin route parsing and fallbacks).
- **Not run:** API integration tests, browser tests against real API and disposable PostgreSQL, cross-tenant and expired-session scenarios, regression of the 22 browser scenarios. Staff, resident, notification and transfer-queue tests could not be written against contracts that do not exist.

## 11. Known defects and limits

- Resident Overview "Documents and KYC" makes a second request (`GET /residents/:id`) because the stay-summary resident payload omits document fields.
- Payment history is only reachable per invoice. Billing reviews and correction history remain capped at 100 with no pager (carried over from baseline).
- Transfer preview of a fresh check-in without an active stay assignment is refused (baseline launch blocker, unchanged).
- Sidebar is now longer; short-viewport behavior not rechecked.
- Typography is not reviewed here, and the logo assets were not changed. The pasted brief names Inter and a violet palette; the repo's current tokens were not audited against them.

## 12. Remaining implementation work

Everything in section 6, then in order: resident-portal shell, staff directory and forms, notification center, settings forms, transfer queue and detail, then the full browser, responsive and accessibility pass with real API and PostgreSQL.

## 13. Final verdict

**NOT READY — MULTIPLE BLOCKERS.** Two of four roles are real and working. Staff and Resident cannot ship without new backend roles, endpoints and authorization. Owner decisions are needed for transfers, billing policy and permissions. This pass's new screens also still need browser, responsive and accessibility verification. A successful build and unit tests are not proof of readiness.
