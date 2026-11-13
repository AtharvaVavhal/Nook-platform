# STAFF role and membership management — contract and decision request

**Status: REVISION 2 — M0–M4 recorded as approved by the project owner (2026-11-13); M5–M13, M15, M16 have conservative defaults PROPOSED and are NOT applied; M14 is NOT approved. No code, schema or migration has been changed.** Every permission, lifecycle rule and number marked **PROPOSED** is a recommendation, not a decision.

## 0. Decision record

The owner's written decisions of 2026-11-13 are recorded below as given. The formal approver *name* was not supplied in that message; it is therefore recorded as "project owner (session message)" and must be replaced with the named approver before this document is used as an approval register entry.

| ID | Decision as given | Status | Consequence recorded here |
|---|---|---|---|
| M0 | Implement and test the default-deny permission layer **before** introducing any STAFF membership or enum value | **APPROVED** | Step 0 of §8. `STAFF` is not added to the enum until step 0 is deployed **and** verified. |
| M1 | Fixed permissions per role in V1; no per-member custom permissions. STAFF least-privilege: no finance mutations, no correction approvals, no transfer execution, no membership administration, no organization settings | **APPROVED in principle** | The exact read/write list for STAFF is *not* yet confirmed — see §3.2 (proposed starting set) and dependency **D2** in §11. |
| M2 | Property-level restrictions in V1. First resolve the missing property relationships (residents, enquiries, invoices). Do not claim property isolation until backend enforcement and tests prove it | **APPROVED; relationship design pending** | §3.3 lists the facts and options; dependency **D3** in §11. |
| M3 | Single-use, expiring invitation links. OWNER generates and shares them manually. No plaintext password sharing | **APPROVED** | §4/§5 updated: link returned once at creation, never stored in plaintext, never e-mailed by the system; no temporary-password path. |
| M4 | OWNER only can invite, deactivate and reactivate members in V1. Managers and STAFF cannot administer memberships | **APPROVED** | `membership.*` is OWNER-only; PM and STAFF receive none. Phase 2 "PM may manage STAFF" option is closed. |
| M5–M13, M15, M16 | "Present conservative defaults and consequences before applying any default that changes security, data integrity or business behavior" | **PROPOSED — NOT APPLIED** | §10 (defaults and consequences); nothing is applied until confirmed. |
| M14 | Do not modify `scripts/phase_scope.json` until an authorized approver name and approval date are provided; do not assume approval | **NOT APPROVED — HARD STOP** for anything needing a model, enum, route or migration | §11 D1. I will not edit that file or the guard. |

Items in the sections below written before this revision that conflict with §0 (for example "M4: A or B") are superseded by §0.

Prepared 2026-11-13 from the working tree on branch `feature/phase-4-1-lifecycle-audit` (HEAD `908098a` plus uncommitted Phase 4 work). Facts in §1 were read from source; the file and line references are the evidence. Where I inferred rather than read, the text says so.

---

## Executive summary — read this first

1. **Adding `STAFF` to the enum is unsafe on its own.** Seven controllers — admissions, bookings, check-ins, enquiries, finance, residents, stay-summary — are protected by `SessionGuard` only. They never look at the role. Today that is harmless because every member is an OWNER or PROPERTY_MANAGER. The moment a `STAFF` membership exists, that person gets **full read/write access to those seven areas, including all finance mutations** (issue invoice, record/reverse payment, adjust, void, monthly generation). Authorization is default-allow for authenticated members except where individual services add role checks.
2. **Therefore step 0 of the milestone is a default-deny permission layer** that must ship, and be verified, *before* any `STAFF` row can exist. This tightens existing security; it does not weaken it. It does touch every controller, so it needs your explicit go-ahead (decision **M0**).
3. **Property-level restriction cannot be enforced uniformly with today's data model.** Properties/floors/rooms/beds are organization-scoped, but residents, enquiries and invoices carry no property; only bookings (via bed → room → property) do. "Staff sees only property X" is straightforward for inventory and bookings and undefined for residents, enquiries and finance (decision **M2**).
4. **There is no invitation mechanism and no e-mail capability.** Accounts today are created by an operator CLI that prints a one-time temporary password (`scripts/ops/provision-user.ts`). "Invite and accept" needs a delivery decision (**M3**) — possibly a new dependency/vendor.
5. **The scope guard will (correctly) block this work** until a slice for it is approved with an approver, date and reference in `scripts/phase_scope.json` (checks S2, S3, S8, S11). I will not edit that file or invent an approver (decision **M14**).
6. **Rollback hazard:** a PostgreSQL enum value cannot be removed by a normal migration, and an *old* application binary that meets a `STAFF` membership would treat that person as full-access on the seven controllers above. The deploy order in §8 prevents this; it must be followed.

Decisions requested: **M0–M16** (§10). I recommend answering M0, M1, M2, M3, M4 and M14 first; most of the rest have conservative defaults I can proceed with once you confirm.

---

## 1. Existing architecture (verified against source)

### 1.1 Identity, tenancy and sessions

| Fact | Evidence |
|---|---|
| `MembershipRole` has exactly two values: `OWNER`, `PROPERTY_MANAGER`. `MembershipStatus`: `ACTIVE`, `REVOKED`. | `prisma/schema.prisma:16-23` |
| `Membership`: `id, organizationId, userId, role, status, createdAt, revokedAt`; `@@unique([organizationId, userId])`. **No** `updatedAt`, no creator/revoker, no reason, no property scope, no history. | `schema.prisma:145-159` |
| `User` is **global**: `loginIdentifier` is unique across all tenants. Tenancy is carried only by `Membership`. A person can hold memberships in several organizations. | `schema.prisma:117-143` |
| Authentication is **opaque server-side sessions, not JWT**: random 256-bit secret in the `nook_session` cookie; only its SHA-256 is stored. Idle 30 min, absolute 8 h. | `auth/session.service.ts`, `auth.guards.ts` |
| **Role is read from the database on every request** (`session → membership → organization`), never cached in a token. A non-ACTIVE membership, disabled user or disabled organization fails authentication on the next request. Role changes therefore take effect immediately with no token to invalidate. | `session.service.ts:36-66` |
| `AuthenticatedContext.role` is typed `'OWNER' \| 'PROPERTY_MANAGER'`; the Prisma enum feeds it unchecked. | `auth/auth.types.ts:24,44` |
| Login binds the session to the **first** ACTIVE membership of an ACTIVE organization (`find`). There is no organization-switch endpoint, so a multi-organization user gets an arbitrary organization. | `auth.service.ts:68-72` |
| Write requests are guarded by `OriginGuard` + `CsrfGuard`; a temporary password restricts the session to `/auth/{me,logout,password,csrf}`. | `auth.guards.ts` |
| Provisioning, access revocation and password reset exist **only as operator CLIs** against a database URL, not as API. `ROLES = ['OWNER','PROPERTY_MANAGER']` is a constant there. Revocation sets the membership `REVOKED` **and revokes the user's sessions in that organization in the same transaction**. | `scripts/ops/{provision-user,revoke-access,reset-password,ops-lib}.ts` |
| No mail library or provider is a dependency. | `package.json`, `apps/api/package.json` |

### 1.2 Authorization — the central finding

| Controller (route prefix) | Guards | Role enforced where |
|---|---|---|
| `admissions`, `bookings`, `check-ins`, `enquiries`, `residents` (CRUD), `finance`, `residents/:id/stay-summary` | `SessionGuard` (+ Origin/CSRF on writes) | **Nowhere** — no role reference in the controller or in `finance.service`. (Booking *extension* has a service check: `booking.extension.ts:5`, `booking.service.ts:214`.) |
| `inventory` (properties, floors, rooms, beds, summary) | `SessionGuard` | Service: OWNER or PROPERTY_MANAGER (`inventory.service.ts:18`, `inventory.types.ts:76`) |
| `corrections` | `SessionGuard` | Service: `canSubmit`, `reviewerRoleAllowed`, OWNER-only for financial impact (`corrections.service.ts`, `corrections.rules.ts:242-255`) |
| `transfers`, `residents/:id/history` | `SessionGuard + RoleGuard` | `RoleGuard` is a **deny-by-default allow-list** (`auth.guards.ts:85-96`) plus service checks; transfer finance review is OWNER-only (`transfer-finance.service.ts:113`) |
| `auth` | per-route | self-service only |

`RoleGuard` is the only default-deny mechanism and is used on two controllers. Everything else relies on "all members are trusted".

### 1.3 Data model relevant to property scope

`Property → Floor → Room → Bed`, all carrying `organizationId` with composite tenant keys.

- **Enquiry:** *has* an optional `propertyId` ("preferred property", nullable, `ON DELETE SET NULL`; `schema.prisma:364`, validated against the organization in `enquiry.service.ts:24-31`, filterable). *(Revision 2 correction: the first draft wrongly said enquiries had no property.)* Legacy and new enquiries may have it NULL.
- **Resident:** **no property relationship** (no `propertyId`); reachable only through its bookings/admissions/check-ins.
- **Booking / admission / check-in:** reach a property through their bed (`bed → room → property`). Booking creation takes a `bedId`; whether a booking's commercial bed can change after creation must be **verified by test** before it is relied on.
- **Invoice / payment:** `Invoice.bookingId` is nullable in the schema, but the service **requires** it on creation (`finance.service.ts:369`), so invoices are derivable to a property through `booking → bed → room → property`. Invoices created before that rule, or by direct SQL, may have NULL and must be counted before any design is chosen. Payments follow their invoice.
- Assignments/transfers carry source/destination property ids.

### 1.4 Audit

`audit_events` (append-only for the runtime role — INSERT/SELECT only): `organizationId, actorUserId, action, targetType, targetId, requestId, occurredAt, reasonCode, metadata(JSONB)`. Auth events are written **best-effort and never block** the request (`auth-audit.service.ts`). State-changing domain commands (corrections, transfers, password change) write their audit row **inside the same transaction**. Membership changes must follow the second pattern: if the audit write fails, the change must not happen.

### 1.5 Database privileges

Runtime role: `SELECT, INSERT, UPDATE` on ordinary tables (no `DELETE`, owns nothing); `SELECT, INSERT` only on the append-only list (`scripts/qa/phase4-disposable.mjs:255-268`, `scripts/db/README.md`). New history tables must join the append-only list and the exact-catalog verification.

### 1.6 Frontend role handling

`App.tsx:58-62` maps any non-OWNER role to the label "Property manager" (a STAFF user would be mislabeled); `auth/UserMenu.tsx:7` has a two-entry label map; owner-only affordances in `ops/Corrections.tsx:702`; manager/owner list in `ops/Bookings.tsx:130`. The UI does **no** route gating — it relies on API 403s. Frontend work is out of scope here but must follow the backend (§8).

### 1.7 Prior documented intent (Phase 2, never implemented)

`docs/nook-phase-2/PHASE_2_API_CONTRACT.md:80-92` already names `GET /organisations/current/members`, `PATCH /organisations/current/members/{membershipId}` ("Sensitive. Audited. Revokes affected sessions in the same transaction"), a **deferred** `POST …/members` ("Invite or enable"), and `POST /organisations/{id}/switch`. `PHASE_2_UNRESOLVED_DECISIONS.md` **U-07** left the role→permission baseline open and proposed "one role per membership plus an optional `MembershipPropertyGrant` for Scoped rows", with roles *Owner/Partner, Property Manager, Finance Clerk/Cashier, Warden/Front Desk*. The pilot is "one owner and 1–2 staff". `PHASE_2_SECURITY_REVIEW.md` requires session revocation in the same transaction as membership revocation. None of this was approved. **This contract reuses those names and shapes where they fit, and flags where they differ.** Note the docs spell it *organisations*; the implemented code and routes spell it *organization* — I propose staying with the document names for the new routes but this needs your call (M15).

### 1.8 Existing tests

Unit: `apps/api/test/auth.test.ts`. PostgreSQL integration: `auth`, `account-security`, `inventory`, `booking`, `checkin`, `lifecycle`, `cross-origin`, `uuid-params`, `finance`, `corrections` (`apps/api/test/integration/`). Per-route role matrices do **not** exist for the seven SessionGuard-only controllers.

---

## 2. Proposed STAFF role

- **One role per membership** (matches the existing unique `(organization, user)` and U-07's proposal). STAFF is a **new, separate role — not a PROPERTY_MANAGER subset by inheritance**: nothing is derived from PM; each capability is granted explicitly.
- **Default deny.** A STAFF membership with no permissions can authenticate, read `GET /auth/me`, change their own password and log out, and nothing else.
- **Capabilities are granted by named permissions** (§3) from a fixed catalogue, not free-form. Which permissions STAFF holds is **owner decision M1**; I do not pick the set.
- **STAFF can never**: manage memberships, change their own role/permissions/property assignment, deactivate anyone, view membership history of others, touch finance corrections/transfer reviews, or exceed the organization of their membership.
- OWNER and PROPERTY_MANAGER behavior must remain **byte-identical** at the API level. The permission layer is introduced as a mapping that reproduces today's behavior exactly for those two roles and is proven by regression tests before STAFF exists.

---

## 3. Permission model and matrix

### 3.1 Mechanism (PROPOSED)

A declarative `@RequirePermission('<name>')` decorator on **every** route, evaluated by one global guard after `SessionGuard`. Role → permission set is a static in-code table (no per-user grants in v1; see M1/M2 alternatives). A route with no declaration is **denied** (fail closed) — enforced by a test that enumerates every route in the application and fails if one lacks a declaration. Existing in-service role checks stay (defense in depth); they are not removed.

Permission names below are **proposed identifiers**, grouped by the actual routes read from the controllers.

### 3.2 Matrix

Legend — OWNER/PM columns: **verified current behavior** read from source (`✔` allowed, `✖` denied). Both roles pass `SessionGuard`; "role check" notes are from §1.2. STAFF column: **`DECISION M1`** = no value assumed; shown with my *conservative recommendation* in the last column for convenience only.

| Permission (proposed) | Routes (all under `/api/v1`) | OWNER | PM | STAFF | Recommendation if you want a starting point |
|---|---|---|---|---|---|
| `self.*` | `auth/login,logout,password,me,csrf` | ✔ | ✔ | ✔ (always) | Always allowed; not configurable |
| `inventory.read` | `GET properties*, floors, rooms, beds, inventory/summary` | ✔ | ✔ | M1 | read, limited to assigned properties (M2) |
| `inventory.write` | `POST/PATCH properties, floors, rooms, beds, *archive` | ✔ | ✔ | M1 | **deny** |
| `enquiry.read` / `enquiry.write` | `enquiries` CRUD, follow-ups, convert | ✔ | ✔ | M1 | front-desk read+write plausible; your call |
| `resident.read` / `resident.write` | `residents` CRUD | ✔ | ✔ | M1 | read; write by decision |
| `booking.read` / `booking.write` | `bookings` CRUD, `beds/available` | ✔ | ✔ | M1 | read; write by decision |
| `booking.extend` | `POST bookings/:id/extend` | ✔ (role check) | ✔ (role check) | M1 | **deny** (existing rule limits approvers to OWNER/PM) |
| `admission.read` / `admission.write` | `admissions` CRUD | ✔ | ✔ | M1 | by decision |
| `checkin.read` / `checkin.write` | `check-ins`, `occupancy`, `check-out` | ✔ | ✔ | M1 | read; write by decision |
| `finance.read` | `GET finance/invoices*, receipt, outstanding, reports/monthly, corrections` | ✔ | ✔ | M1 | **deny** until decided |
| `finance.payment.record` | `POST finance/payments` | ✔ | ✔ | M1 | by decision (cashier role?) |
| `finance.invoice.write` | `POST invoices, :id/issue, generate-monthly` | ✔ | ✔ | M1 | **deny** |
| `finance.adjust` | `payments/:id/reverse`, `invoices/:id/adjustments`, `invoices/:id/void` | ✔ | ✔ | M1 | **deny** |
| `correction.submit` / `correction.review` / `correction.finance` | `corrections*` | ✔ / PM per `canSubmit`; financial impact **OWNER only** | | **deny** | Not configurable in v1 |
| `transfer.*` | `transfers/*`, `residents/:id/history` | ✔ (OWNER finance-review resolve only) | ✔ except finance resolve | **deny** | Not configurable in v1 (execution is gated off anyway) |
| `stay.summary.read` | `residents/:id/stay-summary` | ✔ | ✔ | M1 | follows `resident.read` |
| `membership.read` | list/detail/history (§5) | ✔ | **M4** | ✖ | **STAFF never**; PM by M4 |
| `membership.manage` | invite, update, assign, deactivate, reactivate | ✔ | **M4** | ✖ | **STAFF never**; PM by M4 |
| `audit.read` | (no endpoint exists today) | n/a | n/a | n/a | out of scope |

### 3.2a STAFF starting set under M1 (PROPOSED — needs your explicit confirmation, dependency D2)

M1 fixed the *principle*. Applying it to the actual routes, the following is forced by your wording and the rest is my least-privilege reading:

| STAFF | Permissions | Basis |
|---|---|---|
| **Denied (forced by M1/M4)** | `finance.invoice.write`, `finance.adjust`, `finance.payment.record`, all `correction.*`, all `transfer.*`, `booking.extend`, all `membership.*`, any organization-settings route (none exist today) | M1/M4 wording; recording a payment is a finance mutation |
| **Denied (my least-privilege reading; confirm)** | every destructive `DELETE` (`enquiries/:id`, `residents/:id`, `bookings/:id`, `admissions/:id`), all `inventory.write` (property/floor/room/bed create/update/archive), `finance.read` | M1 says "least privilege"; none of these are named either way |
| **Candidate allow, property-scoped (confirm each)** | `inventory.read`, `booking.read`, `booking.write` (create/update, **not** cancel), `admission.read/write`, `checkin.read/write` (incl. check-out), `stay.summary.read` | needed for a front-desk workflow; scopeable through the bed |
| **Candidate allow, blocked until D3** | `enquiry.read/write`, `resident.read/write` | cannot be property-isolated until the relationships in §3.3 are resolved |

Nothing in this subsection is applied. The permission table is only written once D2 is confirmed.

### 3.3 Resource-level authorization (property scope)

Depends on **M2**. If property scope is required in v1, enforcement is a *repository-level* filter, never a UI filter:

| Resource | Can be scoped to assigned properties? | How |
|---|---|---|
| Property, floor, room, bed | Yes | `propertyId ∈ assignments` |
| Booking, admission, check-in, stay summary | Yes (indirect) | via `bed → room → property` |
| Invoice, payment, receipt | Indirect, **only if** the invoice's booking resolves a property | via booking → bed; transfers can change the bed, so "the property" needs a defined rule (original vs current) — a policy question |
| Enquiry | **Yes, partly** — optional `propertyId` already exists; NULL rows have no property | Scope by `propertyId ∈ assignments`; the treatment of NULL rows is decision **D3-b** |
| Resident | **Only indirectly** — no `propertyId` | Derived from bookings/admissions/check-ins, or a new field; a newly registered resident with no booking has no property (**D3-a**) |

**M2 is approved in V1, so org-wide STAFF access is not an option.** OWNER and PROPERTY_MANAGER stay organization-wide (their behavior is preserved, M0). Until D3 is decided, no STAFF permission on residents, enquiries or finance can be granted, because it could not be property-isolated.

A STAFF member with the permission but **no property assignments** sees nothing (empty, not 403, for list endpoints; 404 for direct ids) — PROPOSED. A foreign-organization id is always 404 (existing convention).

---

## 4. Membership lifecycle

```
            invite                 accept (set password)            deactivate
 (none) ───────────► INVITED ───────────────────────────► ACTIVE ───────────────► REVOKED(=deactivated)
                      │  ▲ resend                           │  ▲                       │
                      │  │                                  │  └───── reactivate ──────┘
                      ▼  │                                  └── role/property changes (audited)
                   EXPIRED / REVOKED(invite)
```

| Phase | Rule | Status |
|---|---|---|
| **Invitation** | Created by an inviter holding `membership.manage` (M4). Binds `(organization, normalized e-mail, role, optional property set)`. Stored as a **hash** of a single-use high-entropy token; the token is shown/delivered once (M3). Expires (value: M8). One open invitation per `(org, e-mail)`. Audited. | PROPOSED; delivery M3 |
| **Activation** | Invitee presents the token (public, throttled like login), sets a password meeting the existing policy (`auth-security.ts`), becomes ACTIVE; token consumed; creates the `User` if new, or links the existing `User` (M6). Audited. | PROPOSED |
| **Role/property change** | By `membership.manage` holder only; never self; reason required for role change; audited with before/after. Constraint: the organization must always keep **≥1 ACTIVE OWNER** (a safety invariant, enforced in the same transaction with a row lock on the organization's owner memberships). | invariant PROPOSED; who may change roles = M5 |
| **Deactivation** | `ACTIVE → REVOKED`, sets `revokedAt`, **revokes the member's sessions in that organization in the same transaction** (as the existing `revoke-access` CLI does). Reason required. Cannot deactivate self; cannot deactivate the last OWNER. Audited. | PROPOSED; M7 |
| **Reactivation** | `REVOKED → ACTIVE`. Whether role and property assignments are restored or must be re-granted, and whether a new password is forced, is **M7**. Audited. | M7 |
| **History** | Every transition above appends one immutable row (§6). Viewable by `membership.read` holders only (M9). | PROPOSED |

Existing `MembershipStatus` values are kept (`REVOKED` is the stored form of "deactivated"). No `INVITED` row is created in `memberships`; invitations live in their own table so no half-created member can authenticate.

---

## 5. API contract (PROPOSED — nothing is routed)

Conventions reused from the code: prefix `/api/v1`, session cookie + `OriginGuard`/`CsrfGuard` on writes, UUID path params via `ParseUUIDPipe`, paged responses `{ items, total, page, limit, totalPages }` (as `GET /residents`), error bodies `{ code, … }` with 400/401/403/404/409, foreign-organization id ⇒ **404**, `organizationId` taken **only from the session** (a supplied `organizationId` is rejected with 400, as the transfer routes do).

**Revision 2 notes:** paths below keep the Phase 2 spelling (`organisations`) for traceability; the proposed default (M15, not yet confirmed) is the code's spelling `organizations`. Per M4 every `membership.*` permission is **OWNER-only**; per M3 the invitation link is returned **once** at creation/resend, stored only as a hash, and no password is ever returned or accepted from the inviter. Property assignment (route 8) and the `propertyIds` field are subject to D3/D1.

Path family: Phase 2's documented `organisations/current/members` (§1.7) — see M15 on spelling. Existing endpoints are **not duplicated**: `GET /auth/me` already returns the caller's own role and is extended only to include effective permissions and (if M2) assigned property ids.

| # | Method & path | Purpose | Permission | Notes |
|---|---|---|---|---|
| 1 | `GET /organisations/current/members` | List members (filters: `status`, `role`, `q`; paged) | `membership.read` | Own organization only. Never returns password hashes, tokens or session data. |
| 2 | `GET /organisations/current/members/:membershipId` | Member detail (role, status, assigned properties, created/revoked times, last login) | `membership.read` | 404 if not in the caller's organization |
| 3 | `POST /organisations/current/invitations` | Invite `{ email, role, propertyIds? }` | `membership.manage` | Role limited by M4/M5; creates a PENDING invitation; returns invitation metadata (and token per M3) |
| 4 | `GET /organisations/current/invitations` | List open/expired invitations | `membership.read` | no token values |
| 5 | `POST /organisations/current/invitations/:invitationId/revoke` · `…/resend` | Cancel / re-issue | `membership.manage` | resend rotates the token; limits per M8 |
| 6 | `POST /auth/invitations/accept` | Accept `{ token, password, displayName }` | Public, throttled | Generic failure body for bad/expired/used tokens (no enumeration). Sets cookies like login only if M-decision allows auto-login; otherwise returns 204 and the user logs in |
| 7 | `PATCH /organisations/current/members/:membershipId` | Change `{ role?, displayName? }` | `membership.manage` | Rejects self-targeting (403 `SELF_CHANGE_FORBIDDEN`); last-owner guard (409 `LAST_OWNER`); reason required for role change |
| 8 | `PUT /organisations/current/members/:membershipId/properties` | Replace property assignments `{ propertyIds[] }` | `membership.manage` | Every id must belong to the organization (else 404); full audit of added/removed; only if M2 = yes |
| 9 | `POST /organisations/current/members/:membershipId/deactivate` | Deactivate `{ reason }` | `membership.manage` | Revokes sessions in same txn; self/last-owner guards |
| 10 | `POST /organisations/current/members/:membershipId/reactivate` | Reactivate `{ reason }` | `membership.manage` | per M7 |
| 11 | `GET /organisations/current/members/:membershipId/history` | Paged membership history | `membership.read` (M9) | reads the append-only history |

Idempotency: 3, 5, 9, 10 accept the same retry-safe pattern the correction/transfer commands use only if you want it (not assumed; low value for a 1–2 staff pilot — **M16**). Concurrency: every mutating membership transaction takes a row lock on the target membership and, for owner-count checks, on the organization's owner memberships.

Org switching (`POST /organisations/{id}/switch`, §1.7) is **not** included; it is only needed for multi-organization users (M6).

---

## 6. Database changes (PROPOSED, additive)

1. `ALTER TYPE "MembershipRole" ADD VALUE 'STAFF'` — see §8 for the hazards.
2. `memberships`: add `UNIQUE (id, organization_id)` (supports composite tenant FKs; no column added to the authentication hot path).
3. **`membership_events`** (append-only, runtime INSERT/SELECT only, immutability trigger like `phase4_append_only`): `id, organization_id, membership_id, user_id, event_type, actor_user_id, from_role, to_role, from_status, to_status, reason, details JSONB, request_id, occurred_at`; composite FK `(membership_id, organization_id)`. Index `(organization_id, membership_id, occurred_at)`.
4. **`staff_invitations`**: `id, organization_id, email (normalized login identifier), role, token_hash (unique), status (PENDING/ACCEPTED/REVOKED/EXPIRED), invited_by, expires_at, accepted_at, accepted_membership_id, created_at`; partial unique `(organization_id, email) WHERE status='PENDING'`.
5. **`membership_property_assignments`** (only if M2=yes): `organization_id, membership_id, property_id, assigned_by, assigned_at, removed_at`; composite FKs to `memberships` and `properties`; partial unique on active rows.
6. New enums for invitation status / event type (named, so the scope guard and catalog tests can list them).
7. No change to `users`, `sessions`, or any Phase 3/4 table. No data backfill: existing rows stay valid (§8).

Required companion changes outside the schema: `scripts/phase_scope.json` slice entry (**M14**), exact-catalog expectations (new relations/constraints/functions), the runtime-privilege list in the integration harness and ops docs, `ROLES` in the ops CLIs, and the Prisma client regeneration.

---

## 7. Security model

Controls and how each requested verification is proven (all against disposable PostgreSQL — see §9):

| Requirement | Control | Proof |
|---|---|---|
| Cross-organization access denied | `organizationId` only from the session; every query filters it; composite tenant FKs; foreign ids → 404 | Two-tenant integration tests for **every** endpoint in §5, including property ids and membership ids of the other tenant |
| STAFF cannot use OWNER-only functionality | Global default-deny permission guard + route-completeness test | Per-route matrix test: every route × {OWNER, PM, STAFF-none, STAFF-with-each-permission} |
| STAFF cannot modify their own permissions | Self-target rejection in service **and** `membership.manage` not grantable to STAFF; role/property change requires a *different* active actor | Tests: self PATCH/PUT/deactivate → 403; STAFF with every permission still 403 on §5 |
| Unauthorized membership changes rejected | Permission + role-ceiling (a PM cannot create/modify an OWNER; M4/M5) + last-owner invariant | Table-driven authorization tests |
| Property restrictions enforced by backend | Repository-level scope filter (§3.3), not UI | Integration tests with two properties; direct-id, list, search and count endpoints; cross-property booking/bed ids |
| Session/token authorization reflects membership changes | Role is read per request; deactivation also revokes sessions in the same transaction | Test: change role/deactivate while a session is live → next request reflects it; revoked sessions cannot be reused after reactivation |
| Audit for sensitive changes | Audit row + `membership_events` row **in the same transaction** (failure rolls back the change) | Test: inject audit failure → membership unchanged |
| Invitation abuse | Token hash only; single use; expiry; throttle; generic errors; no e-mail/identity disclosure across tenants (M6) | Tests incl. replay, expiry, wrong org, enumeration timing parity (as `DUMMY_PASSWORD_HASH` in login) |
| No privilege escalation by invitation | Invite role ≤ inviter's ceiling; token carries no role (role is read from the invitation row) | Test: tampered token/payload cannot change role |

Audit event names (PROPOSED, existing `auth.*`/`domain.*` style): `membership.invited`, `membership.invitation.revoked`, `membership.invitation.resent`, `membership.activated`, `membership.role_changed`, `membership.properties_changed`, `membership.deactivated`, `membership.reactivated`, `membership.permission_denied` (security-relevant denials, bounded to avoid log flooding). Metadata never contains passwords, tokens, hashes or full e-mail addresses (use the existing one-way identifier tag).

---

## 8. Migration and rollout strategy

**Non-negotiable ordering** (each step independently deployable and verified):

1. **Default-deny permission layer** with role→permission table that reproduces current OWNER/PM behavior exactly. No schema change, no STAFF. Regression suite proves OWNER and PM unchanged on every route. *This step has value on its own and de-risks everything after.*
2. **Schema migration** (additive; §6). The enum value `STAFF` exists but **no code path can create a STAFF membership yet** and the operator CLIs still refuse it.
3. **Backend membership services and routes**, behind a disabled-by-default switch (same fail-closed gate pattern as transfers/corrections). Verified on disposable PostgreSQL.
4. **Enable** only after (a) every running instance is on a binary from step 1 or later, and (b) frontend is ready (labels, gating, forms).

**Limitations to carry into the release notes:**

- **Rollback is forward-only for the enum.** PostgreSQL cannot drop an enum value without rebuilding the type; the new tables can be dropped only while empty (history is append-only by design). There is no safe automatic down-migration. After step 4, rollback means "disable the switch and deactivate STAFF memberships", not "revert the schema". (Same Prisma limitation already documented for Phase 4: a failed `migrate deploy` leaves partial DDL and a P3009 lock; recovery is forward repair or restore into a separate database.)
- **Old-binary/new-schema hazard:** a binary from *before* step 1 that reads a `STAFF` membership would let that user through every `SessionGuard`-only controller. Hence step 1 before any STAFF row, and the switch in step 3 stays off until all instances are updated.
- `ALTER TYPE … ADD VALUE` cannot be used in the same transaction that first uses the value; the migration must contain only the type change, and rows using it are created by later application code.
- Existing records: no rows change. Existing OWNER/PM memberships, sessions and all Phase 2–4 data stay valid; the unique `(id, organization_id)` index is additive over an already-unique primary key.
- Tenant isolation: every new table carries `organization_id` and composite FKs; no cross-tenant relationship is possible at the database level.
- The Phase 4 migration chain is currently **uncommitted** and un-merged; this milestone's migration must be ordered after it and must not be started on a branch that cannot rely on it (M13).

---

## 9. Test plan

All database tests run only on a disposable cluster (the existing harness: fresh tmpfs PostgreSQL, generated credentials, no `.env`). Financial corrections, the invoice scheduler and transfer execution are not touched.

| Layer | Coverage |
|---|---|
| Unit | Permission table (role → set), decorator/guard decisions, route-completeness enumerator, invitation token generation/hash/expiry, last-owner invariant, self-target rules, lifecycle state machine (every legal and illegal transition) |
| Authorization matrix | Every route × {OWNER, PM, STAFF with no permission, STAFF with each single permission, anonymous, wrong-tenant} — expected status per cell, generated from the approved §3 matrix |
| Lifecycle (PostgreSQL) | invite → accept → login → role change → property change → deactivate → session dead → reactivate → history complete; expiry; resend; revoke invitation; duplicate/open-invite constraint; concurrent accept; concurrent deactivate-last-owner (two owners deactivating each other must leave one) |
| Cross-tenant isolation | Two organizations with identical e-mails/names; every §5 endpoint with foreign membership/invitation/property ids ⇒ 404; invitation token used against another org; list endpoints never leak |
| Property scope (if M2) | Assigned vs unassigned property for read/list/count/search/direct id on inventory, booking, admission, check-in, stay summary; assignment removal takes effect on the next request |
| Session | Role change and deactivation visible on the next request; sessions revoked in the same transaction; no resurrection on reactivation |
| Audit/atomicity | Each sensitive action writes audit + history atomically; injected audit failure rolls back; append-only triggers reject UPDATE/DELETE on history |
| Existing-role regression | Snapshot of status codes/bodies for the full existing integration suites with OWNER and PM identities before vs after step 1; existing `auth`, `account-security`, `inventory`, `booking`, `checkin`, `lifecycle`, `uuid-params`, `cross-origin` suites unchanged and green. The three financial-mutation suites remain excluded unless separately authorized |
| Migration | Fresh schema, upgrade from the current chain with existing memberships and sessions (row hashes identical), catalog/privilege verification updated and passing, failure-behavior note re-verified, restore rehearsal still passes |
| Static | typecheck, eslint, prettier, the repo's scope guard (with an approved slice) — **no guard is weakened to pass** |

Completion is claimed only from executed PostgreSQL results, not from typecheck or build.

---

## 10. Proposed conservative defaults for M5–M13, M15, M16 (NOT APPLIED)

Per your instruction, each default below changes security, data integrity or business behavior, so none is applied until you confirm it. "Consequence" is what you accept by confirming.

| ID | Conservative default | Consequence of confirming | Alternative |
|---|---|---|---|
| **M5** Role changes | OWNER may change a member between `STAFF` and `PROPERTY_MANAGER` only, with a reason, audited. **No API path creates, promotes to, or demotes an OWNER**; owner changes stay with the operator CLI. The organization must always keep **≥1 active OWNER** (enforced under a row lock). | No API-driven owner takeover or accidental owner loss. Owner succession needs operator action (already the current process). A mistaken STAFF→PM promotion widens access immediately (visible in history). | Allow OWNER promotion/demotion through the API (adds an escalation path; needs stronger confirmation such as a second owner). |
| **M6** Multi-organization users | **One organization per user in V1.** Invitation creation always succeeds and returns the same shape. At acceptance, an e-mail already linked to another organization fails with a generic error and an audit event. No organization-switch endpoint. | No cross-tenant identity disclosure to the inviter; inviter may not learn why an acceptance failed (owner contacts operator). It also matches today's login, which picks the first active membership and is unsafe for multi-org users. | Allow multi-org + add `switch` + a selection step at login (new auth surface). |
| **M7** Deactivate / reactivate | Deactivation: `REVOKED`, `revokedAt`, **all of the member's sessions in that organization revoked in the same transaction**, reason required. Reactivation: OWNER issues a **new single-use link**; the membership stays `REVOKED` until the person accepts it and sets a **new password**; property assignments are **cleared** and re-granted explicitly. | Safest against stale or compromised credentials; reactivation is not instant. (It also avoids any temporary-password path, consistent with M3.) | Instant reactivation restoring role/assignments (convenient, keeps old credentials alive). |
| **M8** Invitation parameters | Expiry **72 hours**; at most **3 resends** (each rotates the token and invalidates the previous one); **no auto-login** after acceptance (the person logs in normally). | A lapsed link needs an OWNER action; short exposure window. The numbers are my proposal, not derived from any source. | Longer expiry; more resends; auto-login on accept. |
| **M9** Who reads list/detail/history | OWNER only (follows M4). | PM/STAFF cannot see the roster. | Allow PM read-only. |
| **M10** STAFF in corrections/transfers | Excluded entirely. | Already implied by M1; settled unless you object. | — |
| **M11** STAFF self-service | Password change only (already exists). Display-name edits are OWNER-only. | Fewer self-modification paths. | Allow own display name. |
| **M12** Resident accounts | Out of this milestone; a separate later decision (residents are not memberships). | No resident portal here. | — |
| **M13** Branch/sequence | Do **step 0 (permission layer, no schema)** now in this working tree. Do **schema steps (enum, tables, migration) only after the Phase 4 migration chain is merged**, so the new migration orders after `20261111130000`. | Step 0 edits controllers that already carry uncommitted Phase 4 changes (no commits are made, so nothing is separated or lost). Schema work waits on Phase 4 merge, which itself waits on the open blockers. | Start schema steps on the current branch (couples this milestone's rollout to the unmerged Phase 4 chain). |
| **M15** Route family | Use the code's spelling: **`/api/v1/organizations/current/members`** and `…/invitations`. | Matches every existing identifier (`organizationId`); differs from the never-implemented, never-approved Phase 2 text (`organisations`), so no client compatibility is lost. | Phase 2 spelling. |
| **M16** Idempotency keys | **None in V1.** Mutations are state-guarded (second deactivate → `409`, duplicate open invite → `409`). | Duplicate clicks are safe. A **lost response when creating an invitation loses the one-time link**; the OWNER recovers by `resend`, which rotates the token. | Add keys as corrections/transfers have (extra table/code). |

Two defaults interact with your M3: the link is returned **once** in the creation/resend response body, stored only as a hash, and never logged; the web origin used to build it comes from the existing `webOrigin` configuration.

## 11. Remaining approval dependencies

| # | Dependency | Blocks | Not blocked |
|---|---|---|---|
| **D1** | **M14** — an authorized approver name and approval date for a new slice in `scripts/phase_scope.json`. Not assumed, not edited. | Anything adding a model, enum value, route or migration: the `STAFF` enum value, `membership_events`, `staff_invitations`, property-assignment table, all member/invitation routes, and the migration (scope checks S2/S3/S8/S11). | **Step 0 is expected not to be blocked**: it adds no model, enum, route, migration, dependency or raw SQL. I will run the scope guard afterward and stop if it reports anything other than the existing S1 `.env` failure. |
| **D2** | Confirm the exact STAFF permission set (§3.2a): especially destructive `DELETE`s, `inventory.read`, and `finance.read`. | Writing the role→permission table for STAFF. (OWNER/PM tables reproduce current behavior and need no decision.) | Permission layer for OWNER/PM. |
| **D3** | Resolve the property relationships (M2): **(a) Resident:** derive from bookings/admissions/check-ins (a resident with none is invisible to STAFF) vs. add a mandatory home property to new residents (legacy residents NULL until assigned). **(b) Enquiry:** treatment of NULL `propertyId` (invisible to STAFF until an OWNER/PM sets it — default I recommend — vs. visible to all assigned STAFF). **(c) Invoice/payment:** derive via the booking's bed (recommended; no schema change), and a rule for the transfer case (booking bed vs. current bed) and for any NULL-booking legacy invoices. Any new column is additive but is a schema change and needs D1. | STAFF permissions on residents, enquiries and finance; the property-assignment design. | Bookings, admissions, check-ins and inventory (already bed-derived). |
| **D4** | Named approver for the M0–M4 entries in §0 (the message gave decisions but no name). | Using this document as a formal approval register. | Engineering work already approved in M0. |
| **D5** | Confirm or amend the conservative defaults in §10 (at least M5, M6, M7, M8, M13). | Membership services, invitation flow, rollout order. | Step 0. |
| **D6** | **Phase 4 closure ordering:** the race campaign must finish and produce evidence before the final Phase 4 closure report is written (your instruction). That report remains outstanding; the campaign was still running when this revision was written. | The Phase 4 closure report and, by M13, schema steps of this milestone. | Step 0 and this contract. |

## 12. Proposed implementation order after your confirmations

1. **Step 0 (needs only M0, already approved):** global default-deny guard + `@RequirePermission` on every route; OWNER/PM table reproducing today's behavior; route-completeness test; a status/body snapshot of all seven previously identified controllers (admissions, bookings, check-ins, enquiries, finance, residents, stay-summary) plus inventory, corrections, transfers, resident-history and auth for OWNER, PM, anonymous, and a **test-only synthetic role** (never a database value) to prove unknown roles are denied everywhere; cross-organization checks. Disposable PostgreSQL only.
2. After D1–D3, D5 and the Phase 4 merge (M13): schema → membership services → routes (switch off) → property scope enforcement and cross-property tests → enablement review.

I will not add the `STAFF` enum value, touch `scripts/phase_scope.json`, or create any migration until D1 is supplied and step 0 is verified.

### Not done in this revision

No code, schema, migration, scope-guard edit, commit, push, deployment or production access. This revision only records your decisions, corrects two factual points (enquiries already have an optional property; invoices are derivable through their required booking), and lists what still needs your approval.
