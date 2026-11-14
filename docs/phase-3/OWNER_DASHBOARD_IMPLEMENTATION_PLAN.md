# Owner Dashboard — Implementation Plan (corrected and frozen)

Status: **PLAN ONLY. NOT AUTHORIZED FOR IMPLEMENTATION.** A corrected plan is not permission to implement; the owner must
separately authorize implementation.
Base commit: `a9c489eedb24c5cfc56020c9a0f091ff0add8b96` (merge of PR #4; `quality`, `full-integration` and `pilot-rehearsals`
passed on it). Branch: `feature/real-owner-dashboard`. Scope slice: `3.10`. Target: the first Nook hostel pilot.
Decision record: owner decisions D1–D14, the contract decisions of 14 November 2026, and the **final owner review** of the
plan's detail items R1–R8 (sections 1 and 14). The final review is applied in this revision.

Everything here comes from reading the repository on the base commit. Nothing was run against a database for this plan, so
query plans, timings and the production role's grants are **unverified** and are labelled so. "Implemented" means it exists
today; "Proposed" means it does not.

## 1. Owner decision record

| # | Decision (as approved) | Where specified |
|---|---|---|
| D1 | Occupancy = occupied ÷ total live beds; the counts and the denominator are shown. | §5.4, §6.1 |
| D2 | Active tenants = distinct residents with an active stay. Not `Resident.status`. | §6.2 |
| D3 | Route permission `inventory.read`. Section permissions use the existing constants (verified, §8). No new permission. | §5, §8 |
| D4 | Organization-level manager access is accepted for the pilot. Property-scoped access is **not** built; the limitation is documented. | §13 |
| D5 | Finance attribution is invoice → booking → bed → property. Invoices without a booking are **unattributed**: shown separately at organization level, never added to a property's totals. | §6.4 |
| D6 | Pending payments are defined from invoices, not from the manual `Booking.paymentStatus` flag. | §6.4 |
| D7 | **Option (b), dashboard-only.** "Past end date" = booking end date strictly before today. A booking ending today is *not* past end date and stays in the upcoming check-out window. Existing `isOverstay`, `/check-ins/occupancy` and the Finance overstay banner are unchanged. | §6.2, §9 |
| D8 | Recent admissions use `admissionDate`, status `ADMITTED`. | §6.2 |
| D9 | Scope approval for slice `3.10` with the exact values in §2. | §2 |
| D10 | The real dashboard replaces the demo content in `#overview`; the demo floor plan and its navigation item are also removed from the owner experience; property selection is `#overview/<propertyId>`. | §10 |
| D11 | Correct the inaccurate `audit_events` statement in the merged bulk-room docs. The inventory module writes no audit events. No grant or schema change. | §15 |
| D12 | Month selector: the current IST month and the previous five months only. Enforced server-side. | §5.2 |
| D13 | Late arrivals are excluded from v1. | §6.2, §13 |
| D14 | The metric is labelled "Invoiced", not "Rent". | §6.4 |

Final owner review of the plan's detail items (applied): **R1, R2, R3, R5, R6, R7 and R8 accepted; R7 with the requirement that
admission activity timestamps are labelled as record/creation timestamps, not admission dates; R4 rejected as originally
proposed** — the demo floor plan and its navigation item are removed from the real owner experience, and all genuine inventory
functionality is preserved (§10, §14).

Contract decisions of 14 November 2026 (all accepted): the overdue headline is two separate figures ("Month unpaid" and
"Overdue (all months)"); invoiced statuses; the `unattributed` shape; the recent windows and caps; the upcoming window;
committed beds; the section permission mapping; server-side month and days validation; frozen item schemas; the overview
composition and routing; the five design tokens.

## 2. D9 — scope approval (exact values)

- Slice: `3.10`
- Approver: `AtharvaVavhal`
- Date: `2026-11-14`
- Reference: `docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md#slice-310-owner-dashboard`
- Required heading in that file: `## Slice 3.10 Owner dashboard`

**Validation result** (read-only, using the guard's own `resolve_ref` and `slug` functions from
`scripts/verify_phase_scope.py`, on a scratch copy; no repository file was modified):

| Check | Result |
|---|---|
| `slug("Slice 3.10 Owner dashboard")` | `slice-310-owner-dashboard`, **identical to the owner's anchor** |
| File `docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md` | exists |
| Heading in the real repository now | **absent** → `resolve_ref` reports `missing heading #slice-310-owner-dashboard` (expected; the heading is added only at implementation) |
| Same reference on a copy with the heading appended | **resolves** |
| Collision with any existing heading slug | none |
| Slice 3.9's reference | still resolves |

So the reference is valid and will resolve exactly when the heading is added. Until then the slice would count as
unapproved and rule S8 would fail the route, which is why registering it is implementation step 3, not part of this plan.

**Proposed register entry** (not added; text for implementation step 3), to be appended to
`docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md`:

```
## Slice 3.10 Owner dashboard

Approved by the project owner on 2026-11-14 (approver: AtharvaVavhal; decision record D1-D14 and the 14 November 2026
contract decisions in `docs/phase-3/OWNER_DASHBOARD_IMPLEMENTATION_PLAN.md`).
Adds exactly one route: `GET /api/v1/properties/:propertyId/dashboard`. It is read-only and reads existing tables. No new
tables, models, enums, columns, indexes, migrations, permissions or database privileges. Floor, room and bed management,
property-scoped manager authorization and inventory audit events are not part of this slice. The approval is not extended
to any other route or operation.
```

**Proposed `scripts/phase_scope.json` slice** (not added; same shape as slice 3.9):

```json
"3.10": {
  "status": "approved",
  "approver": "AtharvaVavhal",
  "date": "2026-11-14",
  "ref": "docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md#slice-310-owner-dashboard",
  "description": "Owner dashboard: the single read-only route GET /api/v1/properties/:propertyId/dashboard and its tests, on existing tables. No schema, permission or grant change. Not extended to any other route or operation.",
  "models": [], "enums": [], "tables": [], "functions": [], "extensions": [],
  "routes": ["GET /api/v1/properties/:propertyId/dashboard"]
}
```

## 3. Existing dashboard assessment (Implemented)

There is no property-scoped dashboard today. The home page (the non-ops, non-finance, non-admin branch of `App.tsx`) renders,
in order:

| Block | Status |
|---|---|
| `<section id="overview">`: hero "Property management" with an "Explore floor plan" button, a property banner for the fictional "Nook House, Bengaluru", a "synthetic demo data" notice, three summary cards linking to `#inventory`, and a "Demo bed snapshot" strip linking to `#floor-plan` | **Demo, hardcoded** (`propertyDemo.ts`) |
| `<FloorPlan>` (`#floor-plan`) | **Demo**, self-labelled (`DemoBadge`, "Demo availability only · No live …") |
| `<InventoryOverview>` (`#inventory`) | **Real**, organization-wide counts (`GET /inventory/summary`) |
| `<AdmissionPanel>` | **Real** |
| Footer sentence "Sections marked DEMO DATA are samples…" | Shown on every view except finance and admin |

Real but organization-wide elsewhere: the Finance overview (`GET /finance/reports/monthly`, month-scoped tiles) and the
overstay banner (`GET /check-ins/occupancy`). Missing entirely: occupancy per property, tenant lifecycle figures, booking
commitments, recent payments (no list-payments endpoint exists), and an activity feed.

## 4. Existing architecture and data (Implemented, verified)

- **Backend**: NestJS modules; one `@RequirePermission(...)` per route (default deny); permission table gives OWNER and
  PROPERTY_MANAGER every permission; `organizationId` only from the session; responses `{ data: … }`; validation errors
  `400 { code: 'INVALID_INPUT', details: [{ field, code }] }` (inventory style); `404` for not-found or cross-tenant.
- **Time**: `common/time.ts` (`todayIst`, `istDateOf`, `istStartOfDay`); IST is a fixed +05:30. Booking logic compares IST
  calendar days with half-open periods.
- **Occupancy truth**: an `ACTIVE` check-in with no check-out; its physical bed is the single open
  `effective_stay_assignments` segment (`ACTIVE`, `endAt IS NULL`), or `CheckIn.bedId` when the booking has no segments
  (`physicalBedId`, `activeBedOccupancyWhere`).
- **Finance**: `monthlyReport` (invoiced over `ISSUED, PARTIALLY_PAID, OVERDUE, PAID`; collected = non-reversed payments
  received in the IST month; outstanding = Σ(amount − paidAmount); overdue = open and `dueDate < today`), and
  `outstanding()` (all open invoices). Overdue is derived at read time (`effectiveStatus`). `paidAmount` is cash net of
  reversals **plus** applied credits.
- **Data limits**: invoices and payments have no `propertyId`; `Invoice.bookingId` is nullable; `Booking.paymentStatus` is a
  manual flag; `Admission` has no approval timestamp; `CheckOut.bedId` keeps the original check-in bed; `Membership` has no
  property scope.
- **Existing reuse**: `RepeatableRead` read transactions already exist (`stay-summary.service.ts`, transfer services).
- **Web**: hash routing in `App.tsx`; shared UI in `finance/shared.tsx` and `ops/ui.tsx`; tokens in `tokens.css`; unit tests
  discovered by glob and limited to pure logic; browser E2E is manual disposable tooling only.

Existing endpoints are not property-scoped (`/inventory/summary`, `/check-ins/occupancy`, `/finance/*`, list endpoints),
`/check-ins/occupancy` throws a 409 on inconsistent stay data and counts `totalBeds` with a looser rule, and no payments list
exists. Hence one dedicated aggregation endpoint (§5) instead of 10 to 15 unscoped requests.

## 5. API contract (Proposed)

### 5.1 Route
```
GET /api/v1/properties/:propertyId/dashboard?month=YYYY-MM&days=14
```
Read-only. No request body. No organization input of any kind.

### 5.2 Parameters and validation
All failures are `400` with `{ code: 'INVALID_INPUT', details: [{ field, code }] }`, **all problems reported together**.

| Parameter | Rule | Failure `code` |
|---|---|---|
| `propertyId` (path) | UUID | `INVALID_UUID` (existing `parseUuid` behaviour) |
| `month` | optional, `YYYY-MM`, default the current IST month | malformed → `INVALID_FORMAT`; outside the current IST month and the five months before it → **`OUT_OF_RANGE`** (owner-specified) |
| `days` | optional integer, default 14 | not an integer → `INVALID_INTEGER`; outside 1–31 → `OUT_OF_RANGE` |
| any other query parameter, including `organizationId` | rejected | `UNKNOWN_FIELD` |

`INVALID_FORMAT`, `INVALID_INTEGER` and `UNKNOWN_FIELD` are plan details (§14, R1). A repeated parameter (`days=1&days=2`)
is `INVALID_FORMAT`/`INVALID_INTEGER`. The existing monthly report accepts any month from 2000 to 2100; the dashboard's
narrower window is new and applies only to this route.

Order of evaluation: session (401) → route permission `inventory.read` (403) → `propertyId` and query validation (400) →
property lookup (404).

### 5.3 Authorization
- Global session authentication. `@RequirePermission('inventory.read')`. No Origin or CSRF guard (a GET, as every existing GET).
- Organization from `request.auth` only. Property loaded with `{ id, organizationId, archivedAt: null }`; missing,
  archived and other-organization properties are indistinguishable `404`s.
- Section gating (verified constants, §8) is per section and per sub-field; a gated value is `null`, never fabricated and
  never partially leaked. `access` mirrors every gate.

| Gate | Permission(s) | Effect when absent |
|---|---|---|
| `inventory` | `inventory.read` (the route) | the request is a 403; `inventory` is always present otherwise |
| `tenants` | `checkin.read` **and** `resident.read` | `tenants: null` |
| `tenants.upcomingCheckIns` and `bookings` | `booking.read` | `tenants.upcomingCheckIns: null`; `bookings: null` |
| `tenants.recentAdmissions` | `admission.read` | `null` |
| `finance` (including `recentPayments`, `unattributed`) | `finance.read` | `finance: null` |
| `activity` entries | the source event's permission: bookings `booking.read`; admissions `admission.read`; check-ins and check-outs `checkin.read`; payments `finance.read` | entries of that kind omitted; `activity: null` if the caller holds none of the four |

Resident names follow the section's own permission, as existing endpoints already do (`GET /bookings` embeds the resident
under `booking.read`; finance lists under `finance.read`; `/check-ins/occupancy` under `checkin.read`). The tenant section is
deliberately stricter (`checkin.read` and `resident.read`). Both existing roles hold every permission, so today every section
is present; the gating exists for any narrower role added later and is tested with fake roles.

### 5.4 Response schema (frozen)
All dates are IST calendar dates `YYYY-MM-DD`; all instants are ISO-8601 UTC strings; `Money` is a string matching
`^-?\d+\.\d{2}$`, summed as `Decimal`, never a float.

```ts
interface DashboardResponse { data: Dashboard }

interface Dashboard {
  property: { id: string; code: string; name: string };
  asOf: string;                 // instant of the snapshot
  today: string;                // IST date
  month: string;                // 'YYYY-MM' (selected)
  days: number;                 // 1..31
  windows: {
    upcoming: { from: string; toExclusive: string };   // [today, today + days)
    recent:   { from: string; to: string };            // (today - days, today]  ==  today-days+1 .. today, both inclusive
  };
  access: {
    tenants: boolean; upcomingCheckIns: boolean; recentAdmissions: boolean;
    bookings: boolean; finance: boolean; activity: boolean;
  };
  inventory: Inventory;
  tenants: Tenants | null;
  bookings: Bookings | null;
  finance: Finance | null;
  activity: ActivityItem[] | null;       // at most 10
}

interface Inventory {
  rooms: number;                // live rooms, including rooms with no beds
  beds: number;                 // live beds = the denominator
  occupiedBeds: number;
  availableBeds: number;
  outOfServiceBeds: number;     // out of service AND not occupied
  occupancyPercent: number;     // occupiedBeds / beds * 100, one decimal, half up; 0 when beds = 0
  byFloor: Array<{ floorId: string; label: string; ordinal: number;
                   beds: number; occupiedBeds: number; availableBeds: number; outOfServiceBeds: number }>;  // live floors by ordinal, including floors with 0 beds
  anomalies: { occupiedOutOfService: number; stayNeedsReview: number };
}

interface Tenants {
  activeTenants: number;
  upcomingCheckIns: { count: number; items: UpcomingArrival[] } | null;   // booking.read
  upcomingCheckOuts: { count: number; items: StayEnding[] };
  pastEndDate: { count: number; items: PastEndStay[] };                   // D7(b); replaces "overstays"
  recentAdmissions: AdmissionItem[] | null;                               // admission.read
  recentDepartures: DepartureItem[];
}

interface Bookings {
  confirmedUpcoming: { count: number; items: UpcomingArrival[] };         // the same set as tenants.upcomingCheckIns
  committedBeds: number;
  recent: BookingItem[];
}

interface Finance {
  invoiced: Money;              // selected month
  collected: Money;             // selected month, non-reversed payments received in the IST month
  monthUnpaid: Money;           // selected month's billable invoices: sum(amount - paidAmount)
  outstanding: Money;           // ALL months, open invoices: "Outstanding (all months)"
  overdue: { count: number; amount: Money };            // ALL months: "Overdue (all months)"
  pendingPayments: { count: number; amount: Money };    // open invoices not yet due
  recentPayments: PaymentItem[];
  unattributed: Unattributed | null;                    // organization level; see 6.4
}
```

**Item schemas** (every `*Label` is the entity's `label`; `floorLabel` is the floor's `label`):

```ts
interface UpcomingArrival {            // sorted startDate asc, then bookingId
  bookingId: string; residentId: string; residentName: string;
  bedId: string; bedLabel: string; roomLabel: string; floorLabel: string;
  startDate: string; endDate: string;
  admissionStatus: 'NONE' | 'PENDING' | 'ADMITTED' | 'CANCELLED' | null;     // null without admission.read
}
interface StayEnding {                 // sorted endDate asc, then checkInId
  checkInId: string; bookingId: string; residentId: string; residentName: string;
  bedId: string;                       // the PHYSICAL bed
  bedLabel: string; roomLabel: string; floorLabel: string;
  checkInAt: string; endDate: string;
}
interface PastEndStay extends StayEnding { daysPast: number }                 // >= 1; sorted endDate asc (longest first)
interface AdmissionItem {              // status ADMITTED; sorted admissionDate desc, then admissionId
  admissionId: string; bookingId: string; residentId: string; residentName: string;
  bedId: string; bedLabel: string; roomLabel: string; floorLabel: string; admissionDate: string;
}
interface DepartureItem {              // sorted checkOutAt desc, then checkOutId
  checkOutId: string; checkInId: string; bookingId: string; residentId: string; residentName: string;
  bedId: string;                       // CheckOut.bedId = the ORIGINAL check-in bed
  bedLabel: string; roomLabel: string; floorLabel: string;
  checkOutAt: string; reason: string | null;
}
interface BookingItem {                // sorted createdAt desc, then bookingId
  bookingId: string; residentId: string; residentName: string;
  bedId: string; bedLabel: string; roomLabel: string; floorLabel: string;
  startDate: string; endDate: string; status: 'CONFIRMED' | 'CANCELLED'; createdAt: string;
}
interface PaymentItem {                // sorted receivedAt desc, then paymentId
  paymentId: string; invoiceId: string; invoiceNumber: string;
  residentId: string; residentName: string;
  amount: Money; method: 'CASH' | 'UPI' | 'BANK_TRANSFER'; receivedAt: string; reversed: boolean;
}
interface Unattributed { count: number; invoiced: Money; collected: Money; outstanding: Money; overdue: Money }
interface ActivityItem {               // merged, sorted occurredAt desc, then kind, then refId
  kind: 'booking_created' | 'admission_recorded' | 'check_in' | 'check_out' | 'payment_received';
  occurredAt: string;                  // the instant named by timeBasis
  timeBasis: 'RECORD_CREATED' | 'EVENT';   // RECORD_CREATED: when the row was created (booking_created, admission_recorded)
                                           // EVENT: the business time the row states (check_in, check_out, payment_received)
  refId: string;
  residentId: string; residentName: string;
  bedId: string | null; bedLabel: string | null; roomLabel: string | null;
  amount: Money | null; reversed: boolean | null;       // payment_received only
}
```

**Caps and counts.** Every list is capped at **10**. Every `count` is exact (computed in the database), not the length of the
capped list. `byFloor` is not a "recent" list and is not capped.

### 5.5 Errors
`400 INVALID_INPUT` (above); `401`/`403` from the existing guards; `404` for a missing, archived or other-organization
property with no body detail; `500` only for an unexpected failure. The response is **all-or-nothing**: one consistent
snapshot or an error, so sections can never disagree. One failed or anomalous record must not fail it (§6.1).

## 6. Metric definitions and exact formulas (Proposed)

### 6.0 Conventions
`T` = `todayIst()`; `N` = `days`. Business time is IST; booking and billing logic compares IST calendar days. All "IST-day"
comparisons are `istDate(instant)`, equivalent to a range on instants `[istStartOfDay(a), istStartOfDay(b))`.
- Upcoming window **U** = `[T, T+N)`.
- Recent window **R** = `(T−N, T]` = `T−N+1 … T`, inclusive.
- **Live bed** = bed, its room, its floor and the property are all non-archived (the chain `assertBedBookable` uses),
  resolved through `bed.propertyId`, never the nullable `Admission.propertyId`.
- Upcoming lists and counts require a **live** bed; **recent/history** lists key on `bed.propertyId` only (a past event stays
  visible even if its bed was archived later).

### 6.1 Inventory
- `rooms` = live rooms (non-archived room in a non-archived floor), including rooms with no beds. `beds` (T_b) = live beds.
- **Occupied** (O) = distinct live physical beds that hold an active stay: a check-in with `status ACTIVE` and no check-out,
  whose physical bed is the single open effective segment, or `CheckIn.bedId` when the booking has no segments
  (`physicalBedId`). Bookings, admissions and `IN_SERVICE` never count. A future booking never changes O.
- **Out of service** (X) = live beds that are `OUT_OF_SERVICE` **and not occupied**.
- **Available** (A) = `T_b − O − X`. The three are mutually exclusive and always sum to `T_b`.
- **Occupancy %** = `O / T_b × 100`, one decimal, half up, `0` when `T_b = 0` (never a division by zero). The UI shows
  "62 of 100 beds".
- **By floor**: the same four numbers per live floor.
- **Anomalies** (reported, never hidden or silently corrected, and they never fail the request): `occupiedOutOfService` — an
  occupied bed that is `OUT_OF_SERVICE` (still counted as occupied, not in X); `stayNeedsReview` — an active check-in whose
  open segments are not exactly one (excluded from O, attributed to the property of its `CheckIn.bedId`).
  Per-row handling (try/catch around `physicalBedId`) counts it instead of throwing.

### 6.2 Tenant lifecycle
- **Active tenants** = distinct `residentId` over active stays whose resolved physical bed is a live bed of the property.
- **Upcoming check-ins** = bookings with `status = CONFIRMED`, a live bed in the property, **no check-in row of any status**,
  and `istDate(startDate) ∈ U`. Each item carries the admission state (`NONE`, `PENDING`, `ADMITTED`, `CANCELLED`).
- **Upcoming check-outs** = active stays with `istDate(endDate) ∈ U`. Because U starts at `T`, a booking that ends **today**
  is here (D7).
- **Past end date** = active stays with `istDate(endDate) < T` (**strictly** before today). `daysPast = T − istDate(endDate)`,
  at least 1. The two sets are disjoint and, with the stays ending after `T+N`, cover every active stay.
- **Recent admissions** = admissions with `status = ADMITTED` and `istDate(admissionDate) ∈ R`, on a bed of the property.
  `admissionDate` is the declared admission date; the approval day is not stored (D8).
- **Recent departures** = check-outs with `istDate(checkOutAt) ∈ R`, on a bed of the property (`CheckOut.bedId`).
- **Late arrivals are excluded (D13).** A confirmed booking whose start date has passed with no check-in is in no dashboard
  list: not in upcoming (`startDate < T`), not in committed beds, not in past end date (it has no stay). It appears only in
  `bookings.recent` if it was created in R. This is a documented v1 limitation (§13).

### 6.3 Booking overview
- **Confirmed upcoming bookings** = exactly the upcoming check-ins set, `[T, T+N)`. `bookings.confirmedUpcoming` and
  `tenants.upcomingCheckIns` are identical in count and items; they appear twice only because they are gated by different
  permissions. A test asserts equality.
- **Committed beds** = the number of **distinct live beds** among those bookings (two bookings on one bed are one bed).
- **Recent bookings** = bookings of the property with `istDate(createdAt) ∈ R`, any status, most recently created first,
  capped at 10.
- Pending payments are **not** here: they derive from invoices and need `finance.read` (they are `finance.pendingPayments`).

### 6.4 Finance
Attribution: `invoice → booking → bed → property` (the booking's bed). A payment is attributed through its invoice. An invoice
with `bookingId IS NULL` cannot be attributed.

For the selected month `M` (IST), `monthStart`/`nextMonthStart` from `monthRangeIst`:
- **Invoiced** = Σ `amount` of attributed invoices with `periodStart = first day of M` and `status ∈ {ISSUED, PARTIALLY_PAID,
  OVERDUE, PAID}`. Drafts and cancelled invoices are excluded (exactly the monthly report). It is **not** "status = ISSUED".
- **Collected** = Σ `Payment.amount` of attributed payments with `receivedAt ∈ [monthStart, nextMonthStart)` and no reversal.
  A cash view over any invoice period. Never derived from invoices, so invoices and payments are never conflated; credits
  and adjustments are not collected.
- **Month unpaid** = Σ (`amount − paidAmount`) over the same billable invoices as Invoiced (the monthly report's
  "outstanding"). `paidAmount` already includes applied credits.
- **Outstanding (all months)** = Σ (`amount − paidAmount`) over attributed invoices with stored status `ISSUED`,
  `PARTIALLY_PAID` or `OVERDUE`, matching `GET /finance/outstanding` at property level.
- **Overdue (all months)** = the open invoices above with `dueDate < T` (strictly): count and Σ balance. Derived at read time;
  the stored `OVERDUE` value is not trusted; the overdue rule is unchanged.
- **Pending payments** = the open invoices with `dueDate ≥ T`: count and Σ balance.
- **Invariant**: `outstanding = overdue.amount + pendingPayments.amount` exactly (open invoices partition by due date).
- **Recent payments** = attributed payments with `istDate(receivedAt) ∈ R`, newest first, capped at 10, with a `reversed`
  marker (a reversed payment is shown but excluded from Collected).
- **Unattributed** = organization-level, for invoices with `bookingId IS NULL` and their payments, in the same definitions:
  `invoiced` and `collected` for month `M`; `outstanding` and `overdue` for all months; `count` = the number of such **open**
  invoices (R2). It is shown **only when any figure is non-zero**, is `null` otherwise and whenever `finance` is `null`, and
  is **never added to any property's totals**, so the dashboards of all properties plus `unattributed` equal the organization
  totals of the existing reports.
- Label "Invoiced" (D14); invoices carry one `amount` and no line items. Money attributable to an **archived** property
  appears on no dashboard (the property is a 404).

### 6.5 Operational activity
Events from existing business tables only, in R, merged and capped at 10, each with the timestamp the table actually holds
and an explicit `timeBasis`:
- `booking_created` = `Booking.createdAt`, `timeBasis RECORD_CREATED`;
- `admission_recorded` = `Admission.createdAt`, `timeBasis RECORD_CREATED`. **This is the time the admission record was
  created. It is not the admission date** (`admissionDate`, which is a different, declared date and is shown only in
  "Recent admissions") **and not the approval time** (approval is not timestamped, so approval is **not** an event);
- `check_in` = `CheckIn.checkInAt`, `check_out` = `CheckOut.checkOutAt`, `payment_received` = `Payment.receivedAt`, all
  `timeBasis EVENT` (the business time the row states, which can differ from when it was entered).
Nothing is invented. The window R applies to `istDate(occurredAt)` of whichever instant the entry carries. `audit_events` is **not** read (it cannot be filtered by
property, and the actors would imply coverage that does not exist). **Inventory changes and who made any change cannot be
shown** because the inventory module writes no audit events; the page states this.

## 7. Query and aggregation strategy (Proposed; query plans and timings UNVERIFIED)

1. One read-only transaction, `isolationLevel: RepeatableRead` (precedent: `stay-summary.service.ts`, transfer services), so
   every section reads one snapshot and the figures add up. No write, no lock, no organization gate.
2. A bounded number of queries independent of data size (estimate: about 16; **not verified**): property check; live beds with
   room and floor labels; active stays with `effectiveAssignments` and resident name (active tenants, check-outs, past end
   date and anomalies are all derived from this one result in code); upcoming bookings (count + top 10 + distinct beds);
   recent bookings; recent admissions (`ADMITTED`, by `admissionDate`); recent departures; invoice aggregates (invoiced,
   month unpaid, outstanding, overdue, pending) via `invoice.aggregate`; unattributed aggregates; collected via
   `payment.aggregate`; recent payments. The activity feed reuses the recent bookings, departures and payments lists and
   adds two small capped queries of its own, because its events are defined differently: recent check-ins by `checkInAt`
   and recent admission records by `Admission.createdAt` (any status).
3. Prisma `aggregate`/`findMany` with `include` (no per-row lookups); raw SQL only where Prisma cannot express a condition,
   always parameterized. IST-day comparisons are instant ranges `[istStartOfDay(a), istStartOfDay(b))`.
4. Index facts, **verified from the migrations**: bookings `(bed_id, start_date, end_date)` and `(organization_id, status)`;
   invoices `(organization_id, status, due_date)`, `(organization_id, period_start)` and the partial unique
   `(organization_id, booking_id, period_start)` where not cancelled and `booking_id` is not null; payments
   `(organization_id, received_at)` and `(invoice_id)`; check_ins `(organization_id, status)`; check_outs
   `(organization_id)` only; admissions `(organization_id, status)`; stay_assignments `(organization_id, bed_id, start_at,
   end_at)` and `(organization_id, booking_id, start_at)`; beds `(room_id, property_id, organization_id)`.
   **Verified gaps**: no `beds(property_id)` alone; no index on `check_outs.check_out_at` or `bed_id`; none on
   `admissions.admission_date` or `bed_id`.
5. **Not verified**: the translation of `booking: { bedId: { in } }` by Prisma, the cost of the `effective_stay_assignments`
   view (a `LATERAL` over `stay_assignment_replacements` per segment), and whether any gap matters at 100 or 2,000 beds.
6. No cache, no Redis, no new dependency, no index and no migration proposed.

## 8. Permission constants (verified)
Present in `apps/api/src/auth/permissions.ts`: `inventory.read`, `resident.read`, `checkin.read`, `booking.read`,
`admission.read`, `finance.read`. `roleHasPermission(role, permission)` exists. No new permission is created. The route is
discovered automatically by the route inventory and `permission-layer.test.ts`.

## 9. D7 — the dashboard-only "Past end date" rule and its discrepancy

The owner explicitly chose a dashboard-specific definition. It is **not** a global business-rule change.

| | Dashboard (new) | Existing (unchanged) |
|---|---|---|
| Name | **Past end date** (`pastEndDate`) | overstay (`isOverstay`, `/check-ins/occupancy`, Finance overstay banner) |
| Condition | `istDate(endDate) < today` | `istDate(endDate) ≤ today` |
| A booking ending **today** | Not past end date; listed under **Upcoming check-outs** | Counted as an overstay |

Consequences, stated plainly:
- For residents whose booking ends today the dashboard and the Finance banner **may differ**. The dashboard's past-end-date
  count can be lower than the banner's overstay count by exactly the residents ending today.
- `isOverstay`, `GET /check-ins/occupancy` and the banner are not changed, and a regression test pins their current output.
- The word "overstay" is not used on the dashboard, so the two never share a label. Overstay days are still billed or not
  under the existing billing rules, which are untouched.

## 10. Frontend composition and routing (Proposed)

**Home page after the change**, in order:
1. `OwnerDashboard` inside `<section id="overview">` with the heading "Dashboard".
2. `<InventoryOverview>` unchanged (the real organization-wide table; its `#inventory` anchor stays).
3. `<AdmissionPanel>` unchanged.

**Removed from the real owner experience** (final owner review; R4 rejected as originally proposed):
- the hardcoded hero ("ROOM TO BELONG", "Property management", "Explore floor plan"), the demo property banner and
  `PropertyIllustration`, the demo notice, the three demo summary cards, the "Demo bed snapshot" strip and its links;
- the **demo floor plan**: the `<FloorPlan>` section, the sidebar item "Demonstration floor plan", the `#floor-plan` anchor
  and its breadcrumb label, and the floor-plan reducer state in `App.tsx`;
- the footer sentence "Sections marked DEMO DATA are samples…" (no demo content remains on the owner experience);
- imports and state used only by those blocks.

**Preserved (genuine inventory functionality, untouched):** the real `InventoryOverview` table and its `#inventory` anchor and
sidebar item "Inventory overview"; the Properties, Floors, Rooms, Beds and Bulk-rooms screens and their navigation; the
admissions panel; every other sidebar item and route. Nothing real is removed or broken.

**Orphaned demo modules (R9).** After the removal, `components/FloorPlan.tsx`, `floorPlanState.ts`, `propertyDemo.ts` and
`components/DemoBadge.tsx` are referenced only by their own tests (`floorPlanState.test.ts`, `propertyDemo.test.ts`). They
and those tests are **left in the repository unchanged**: no test is deleted, weakened or skipped, and deleting the unused
modules is a separate cleanup that would need its own decision. `BrandIllustration.tsx` stays because it exports `Icon`, used
by real screens. At implementation the build output is checked to confirm the demo modules are not in the bundle (not yet
verified; it relies on the bundler dropping unreferenced modules). The existing assertions in `ResidentProfile.test.ts` that
`#floor-plan` is not an ops hash remain true and are unchanged.

**Routing**
- Property selection is the hash `#overview/<propertyId>`.
- A pure helper `parseOverviewHash(hash)` (new `apps/web/src/dashboard/overviewRoute.ts`, unit-tested) returns
  `{ section: 'overview', propertyId: string | null, malformedPropertyId: boolean }`.
- `App.tsx`: the non-ops `section` becomes the **first path segment** of the hash, so `#overview/<id>` keeps `section ===
  'overview'` (nav highlight, breadcrumb and `sectionLabel` stay correct) while the property id is parsed separately. The
  `#inventory` anchor behaves as today. The sidebar item and the breadcrumb read "Dashboard".
- **Legacy `#floor-plan`**: the section no longer exists, so an old bookmark or link to `#floor-plan` (and `#floor-plan/...`)
  resolves to the `overview` section instead of an unlabelled page: the section derivation maps `floor-plan` to `overview`,
  the dashboard renders, and no error or "floor plan" label appears. `parseOverviewHash` and its tests cover this.
- The dashboard keeps the selected property in component state, so clicking the in-page `#inventory` anchor does not reset it. On a fresh load without a property id: exactly one property is selected automatically and written with
  `history.replaceState`; several properties show a picker; none shows an empty state linking to "Add property".
- A malformed id shows a notice and the picker and makes **no** API call (the UI never causes the 400); an API `404` shows
  "Property not found" with the picker.
- Controls: a property `<select>` (existing `opsApi.inventory.properties.list`) and a month `<select>` (current month and
  the previous five, labelled with the existing `monthLabel`). The UI uses `days = 14` with no control in v1 (R5).

**States and layout**: loading skeletons per section; per-list empty states (for example "No upcoming check-ins in the next
14 days"); one error state with retry for the whole response; a clear "You do not have access to this section" for a `null`
section; "Overdue (all months)" and "Outstanding (all months)" labelled as such, "Month unpaid" next to "Invoiced"; money via
the existing `formatMoney`; dates via the existing IST helpers; occupancy shown as a count plus denominator and a segmented
bar with a text equivalent (plain CSS, no chart library, no animation, nothing conveyed by colour alone). Responsive at 390,
768 and 1440 px with no horizontal page scroll. A note states that inventory changes and actors are not shown because
inventory writes no audit events.

**Activity labels (R7).** Each activity entry shows its time with its basis, never as an event date it is not:
`admission_recorded` reads "Admission record created" with the timestamp captioned "Recorded", and `booking_created` reads
"Booking record created", also "Recorded"; `check_in`, `check_out` and `payment_received` read "Checked in", "Checked out" and
"Payment received" with their event time. The wording "Admitted on" or "Admission date" is used only in the separate
"Recent admissions" list, where the value really is `admissionDate`.

**Design tokens** (existing in `tokens.css`; use the variables, never hex literals): `--color-brand-primary` (#171338),
`--color-brand-accent` (#7657F6), `--color-brand-subtle` (#F4F1FF), `--color-surface` (#FFFFFF), `--color-text-primary`
(#26233D). The other existing semantic tokens (success, warning, danger, info) may be used for status.

## 11. Testing strategy (required before the PR)

All data synthetic and isolated per test (the `newOrg` pattern of `bulk-inventory.integration.test.ts`).

**Backend unit** (`apps/api/test/dashboard.rules.test.ts`, registered in `test-files.json` `quality`): category arithmetic
(O + A + X = beds), percent rounding and zero division; the windows U and R at the exact IST edges (`18:29:59Z` vs
`18:30:00Z`, today, `T+N−1`, `T+N`, `T−N`, `T−N+1`, month edges); **D7 boundaries** (end = today → upcoming check-out, not
past end date; end = yesterday → past end date, `daysPast = 1`); month validation (current, current−5 ok; current−6 and
future → `OUT_OF_RANGE`; `2026-13`, `abc` → `INVALID_FORMAT`); days (0, 32 → `OUT_OF_RANGE`; `1.5` → `INVALID_INTEGER`);
unknown and repeated parameters; section gating with fake roles (each sub-field null exactly per §5.3); money as `Decimal`.

**Integration** (`apps/api/test/integration/dashboard.integration.test.ts`, registered in `test-files.json` `full` and the
pinned reporter list, 15 → 16):
1. Totals: rooms and beds, empty rooms, archived rooms/floors/beds excluded.
2. Occupied/available/out of service; out-of-service excluded from availability; sum = total; a transferred stay and effective
   physical-bed assignments count the physical bed only.
3. Future and overlapping bookings never change occupied; two segments on one stay do not double count.
4. Anomalies (occupied out-of-service, inconsistent stay) answer 200 and are reported.
5. Active tenants deduplicated; upcoming check-ins/check-outs; past end date; recent admissions (`ADMITTED` only) and
   departures; cap 10 with exact counts above 10; late arrivals appear in no upcoming list.
6. `bookings.confirmedUpcoming` equals `tenants.upcomingCheckIns`; committed beds is distinct beds.
7. Finance: invoiced, collected, month unpaid, outstanding, overdue, pending; **`outstanding = overdue + pending`**; a payment
   is not an invoice; a reversed payment is excluded from collected but marked in recent payments; a credit lowers the balance
   but is not collected; drafts and cancelled excluded; due today is pending, due yesterday overdue.
8. **Reconciliation**: one-property organization equals `GET /finance/reports/monthly` and `GET /finance/outstanding`;
   two properties (plus an archived one in the sum) plus `unattributed` equal the organization totals; unattributed is never
   inside a property's figures; present only when non-zero; `null` without `finance.read`.
9. Empty property: zeros, `occupancyPercent 0`, empty lists, 200.
10. Authorization and isolation: 401; 403; cross-organization, missing and archived property → 404 with no leakage; malformed
    id → 400; an `organizationId` query parameter → 400; no other organization's names or amounts in any body.
11. Concurrent-write snapshot: figures stay mutually consistent while writes happen.
12. 100-bed realistic property (25 rooms × 4 beds over 5 floors): correct figures; **query-count guard** (identical count for a
    10-bed and a 100-bed property); latency **printed, not asserted**.
13. **Fingerprint**: bookings, allocations, invoices and payments are untouched.
14. **Regression for D7**: a stay ending today is an overstay in `/check-ins/occupancy` and absent from `pastEndDate`.

**Web unit** (glob-discovered): `overviewRoute.test.ts` (including `#overview/<uuid>`, `#overview`, malformed ids, `#inventory`,
and legacy `#floor-plan` and `#floor-plan/x` resolving to `overview`), `dashboardRules.test.ts` (formatting, labels, empty and
null-section handling, and the activity label for each `timeBasis`: an `admission_recorded` entry is never worded as an
admission date). The existing `floorPlanState.test.ts`, `propertyDemo.test.ts` and the `#floor-plan` assertions in
`ResidentProfile.test.ts` keep passing unchanged.

**Browser** (manual disposable tooling, real Chrome): 390, 768 and 1440 px; no horizontal overflow; loading, empty, error,
null-section and populated states; property and month switching; hash routing and the `#inventory` anchor; keyboard operation;
**no "Demonstration floor plan" sidebar item, no floor-plan section and no DEMO badge or DEMO text anywhere on the owner
experience**; an old `#floor-plan` link lands on the dashboard; the real inventory table and the Properties and Bulk-rooms
screens still work.
Hosted CI does not run browsers; results are local evidence and are never described as CI-verified.

CI registration: `scripts/ci/test-files.json` (`quality` and `full`) and `scripts/ci/integration-test-reporter.test.js`
(15 → 16 and the name list). No existing check is weakened.

## 12. Performance verification requirements
- Consistent snapshot via `RepeatableRead`; query count bounded and independent of inventory size.
- Do not add an index on speculation. Run `EXPLAIN (ANALYZE, BUFFERS)` on disposable datasets of about **100** and about
  **2,000** beds, with realistic bookings, stays, invoices and payments; record each query's plan, row counts and timing, and
  the total latency and query count.
- No latency threshold is asserted unless the owner approves one. No performance claim is made until measured.
- Any index or migration (candidates, only if measurements justify: `beds(property_id)`, `check_outs(organization_id,
  check_out_at)`, `admissions` date) needs separate justification and **separate owner approval**.

## 13. Known limitations and risks
- **Property-scoped manager access is not implemented (D4).** `Membership` has no property scope; any manager can open every
  property of their organization on every existing screen. The dashboard enforces organization isolation only and does not
  restrict managers to "permitted" properties.
- **Property-level finance is approximate (D5).** Attribution is through the booking's bed. Invoices without a booking are
  shown only as `unattributed`. A cross-property transfer (undecided; execution disabled today) would leave a booking on its
  original bed's property. A `propertyId` on invoices would be a schema change and is not proposed. Money on an archived
  property appears nowhere.
- **Late arrivals are invisible (D13)**; **`admissionDate` is not the approval day (D8)**; **departures use the original bed**.
- **Dashboard and existing overstay figures may differ for residents ending today (D7)** (§9).
- **Dashboard "Overdue (all months)" differs from the Finance overview's month-scoped "Overdue amount"**; both labelled.
- **Two occupancy computations will coexist** (`/check-ins/occupancy` counts `totalBeds` with a looser rule); they can
  differ when rooms or floors are archived.
- Inventory changes and actors cannot be shown (the inventory module writes no audit events).
- Admission activity carries the record-creation time, not the admission date or approval time (R7); the dashboard states so.
- Performance is unmeasured; the missing indexes (§7) are a measured-later risk. A data anomaly must never blank the page.
- Hosted CI does not run browser tests.
- A new route touches the scope guard (`3.10` must be registered or `quality` fails) and both CI registries.

## 14. Plan detail items: final owner review

**No owner decision is outstanding.** The owner reviewed the plan's detail items R1–R8 and decided:

| Item | Decision | Final content |
|---|---|---|
| R1 | **Accepted** | Codes for input errors the owner did not name: `INVALID_FORMAT` (month), `INVALID_INTEGER` (days), `UNKNOWN_FIELD` (other parameters; precedent: the transfer-preview tests reject injected query fields). All are `400 INVALID_INPUT`. |
| R2 | **Accepted** | `unattributed.count` = the number of open no-booking invoices. |
| R3 | **Accepted** | "Recent bookings" applies the window R as well as the cap of 10. |
| R4 | **Rejected as originally proposed** | The demo floor plan and its navigation item are **removed** from the real owner experience; all genuine inventory functionality is preserved; the DEMO footer sentence is removed (§10). |
| R5 | **Accepted** | The UI fixes `days = 14` with no control in v1; the API supports 1–31. |
| R6 | **Accepted** | `pendingPayments` lives in `finance` (it needs `finance.read`; an earlier draft placed it under `bookings`), and the field `overstays` is renamed `pastEndDate`. |
| R7 | **Accepted, with a labelling requirement** | `admission_recorded` activity uses `Admission.createdAt`, and its timestamp is **clearly labelled as a record/creation timestamp, not an admission date** (`timeBasis RECORD_CREATED`; wording in §10). |
| R8 | **Accepted** | The nav and breadcrumb label is "Dashboard". |

**New plan detail arising from rejecting R4 (for the owner to veto at implementation authorization):**
- **R9** The now-unreferenced demo modules (`components/FloorPlan.tsx`, `floorPlanState.ts`, `propertyDemo.ts`,
  `components/DemoBadge.tsx`) and their tests are left in place unchanged; deleting them is a separate cleanup (§10). A legacy
  `#floor-plan` link resolves to the dashboard.

## 15. Documentation correction (executed at implementation step 10; not done by this plan)
Inventory writes no audit events — unchanged and out of scope. The merged documents also say the runtime database role cannot
write `audit_events`. That is **not supported**: the CI-provisioned runtime role holds `SELECT, INSERT` on `audit_events`
(`scripts/ci/integration.js`), booking, admission, check-in, finance and transfer code write to it, and the cited test only
shows an inventory create succeeds without needing an audit row. The production role's grants have **not** been verified.
Places to correct (verified by search): `docs/phase-3/BULK_ROOM_BED_CREATION.md` lines 135–138;
`docs/phase-3/BULK_ROOM_BED_IMPLEMENTATION_PLAN.md` lines 19, 67 and 232. Replacement meaning: "The inventory module writes no
audit events, and bulk creation adds none. Recording who created a batch would require adding audit writes to the inventory
module, a separate change. The production role's grants are unverified." No grant or schema change. (PR #4's description has
similar wording; it is history and is not edited.)

## 16. Files expected to change (at implementation)
Created:
- `apps/api/src/dashboard/dashboard.controller.ts`, `dashboard.service.ts`, `dashboard.rules.ts`, `dashboard.types.ts`,
  `dashboard.module.ts`
- `apps/api/test/dashboard.rules.test.ts`, `apps/api/test/integration/dashboard.integration.test.ts`
- `apps/web/src/dashboard/` (`OwnerDashboard.tsx`, `dashboardApi.ts`, `dashboardRules.ts`, `overviewRoute.ts`, the panels,
  `dashboard.css`) and their `*.test.ts`
- `docs/phase-3/OWNER_DASHBOARD.md` (operator and developer notes)

Modified:
- `apps/api/src/app.module.ts`; `apps/web/src/App.tsx` (overview composition, removal of the demo floor plan section, its
  sidebar item and its reducer state, section derivation, legacy `#floor-plan` mapping, nav label)
- `scripts/phase_scope.json` (slice `3.10`, step 3) and `docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md` (the heading, step 3)
- `scripts/ci/test-files.json` and `scripts/ci/integration-test-reporter.test.js`
- `docs/phase-3/BULK_ROOM_BED_CREATION.md` and `BULK_ROOM_BED_IMPLEMENTATION_PLAN.md` (§15)

Not modified (R9): the unreferenced demo modules `components/FloorPlan.tsx`, `floorPlanState.ts`, `propertyDemo.ts`,
`components/DemoBadge.tsx` and their tests; `BrandIllustration.tsx`; `components/InventoryOverview.tsx`.

Not modified: `prisma/schema.prisma`, `prisma/migrations/**`, `.github/workflows/**`, permissions and database grants, the
risk-acceptance document, `finance.service.ts`, `booking.rules.ts`, `checkin.rules.ts` (`isOverstay`), or any billing,
overdue, first/last-month rent or booking rule.

## 17. Acceptance criteria
1. One `GET /api/v1/properties/:propertyId/dashboard` returns every section from one `RepeatableRead` snapshot with a query
   count independent of data size.
2. Occupancy uses active stays (physical bed); O + A + X = beds; future and overlapping bookings never change O; anomalies
   are reported and never fail the request.
3. Finance equals the existing monthly and outstanding reports for a one-property organization; the sum over all properties
   plus `unattributed` equals the organization totals; `outstanding = overdue + pending`; payments are never invoices.
4. All dates and month boundaries are IST with exact-edge tests; the D7 boundary behaves as in §9 and the existing overstay
   behaviour is unchanged.
5. Validation, errors, caps, orderings and every item schema match §5; gated values are `null`.
6. 401, 403, 404 (cross-organization, missing, archived) and 400 (malformed id, month, days, unknown parameter) behave as
   specified, with no leakage.
7. An empty property and a 100-bed property render and compute correctly; latency is printed, not asserted.
8. The overview shows only real data; hash routing keeps `section === 'overview'`; the demo floor plan, its sidebar item and
   every DEMO label are gone from the owner experience while the real inventory table, admissions panel and every inventory
   screen are intact; a legacy `#floor-plan` link lands on the dashboard; admission activity is labelled as a record-creation
   time; layouts at 390, 768 and 1440 px have no horizontal scroll (verified in a real browser and reported as local evidence).
9. No change to the schema, migrations, workflows, permissions, grants, billing, overdue or booking rules, or the
   risk-acceptance document; slice `3.10` is registered with the §2 values and resolves; both CI registries updated.
10. The audit statement is corrected (§15) without any grant change.
11. `quality`, `full-integration` and `pilot-rehearsals` are green on the PR; it is not merged or deployed without separate
    authorization.

## 18. Implementation sequence (after explicit authorization)
1. Owner authorizes implementation.
2. Confirm this plan is frozen (any change is a new owner decision).
3. Add the register heading and register slice `3.10` (§2); confirm the reference resolves and S8 passes.
4. Implement the pure rules and unit tests (windows, formulas, validation, gating).
5. Implement the service, controller, module and authorization.
6. Implement the integration tests, reconciliation and the 100-bed case; register both CI lists.
7. Measure query plans, latency and query counts at about 100 and 2,000 beds (§12); report; stop for approval if an index
   looks warranted.
8. Implement the web client, routing helper, rules, panels and screen.
9. Verify routing and the three layouts in a real browser.
10. Update documentation, including the §15 correction and `OWNER_DASHBOARD.md`.
11. Run all local checks (typecheck, ESLint, Prettier, unit, web, integration, CI contract and reporter, scope guard on a clean
    export, build, secret scan).
12. Open a pull request and wait for hosted CI.
13. Do not merge or deploy without separate authorization.

## 19. Explicit exclusions
Payment gateway integration; a resident self-service dashboard; OTP; notifications; subscription billing; property-scoped
manager authorization; new inventory audit-event implementation; any unapproved schema, permission or grant change; floor,
room or bed management; deleting the unreferenced demo modules or their tests; Redis or any cache; new dependencies; changes to `isOverstay`, `/check-ins/occupancy` or the Finance
overstay banner.
