# Owner Dashboard

Phase 3, Task 2. Scope slice `3.10` (`scripts/phase_scope.json`, `docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md`). The decisions, formulas,
response schema and acceptance criteria are frozen in `OWNER_DASHBOARD_IMPLEMENTATION_PLAN.md`; this document describes what was built, how it
is tested, what was measured, and what is known to be limited. Where the two differ the plan states the intent and this document states the
fact; the differences are listed in "Notes against the frozen plan".

## Status

Implemented in PR #5 after the owner's explicit implementation authorization, and revised after an independent pre-merge review (the
fixes are listed under "Review follow-ups"). `OWNER_DASHBOARD_IMPLEMENTATION_PLAN.md` is the **frozen** plan and still carries its original
"not authorized for implementation" header, because its authorization history is not rewritten; this document is where implementation
completion is recorded.

## What it is

A real, read-only, property-scoped dashboard for the owner overview. It replaces the hardcoded demonstration content on the home page
(`#overview`) with figures computed from PostgreSQL: occupancy, tenant lifecycle, bookings, finance, recent payments and recorded activity.
One API request per property and month. Nothing is invented: a figure that cannot be computed from existing records is not shown, and the
page says so for the two things that are not recorded (inventory changes and who made any change).

## API

```
GET /api/v1/properties/:propertyId/dashboard?month=YYYY-MM&days=14
```

- Session authentication; `@RequirePermission('inventory.read')`; no Origin or CSRF guard (a GET). The organization comes only from the session.
- `month`: the current IST month or one of the five before it; anything else is `400 INVALID_INPUT` (`OUT_OF_RANGE`, or `INVALID_FORMAT`).
  `days`: an integer 1 to 31 (`OUT_OF_RANGE`, `INVALID_INTEGER`). Any other query parameter, including an organization field, is `UNKNOWN_FIELD`.
  A malformed property id is `INVALID_UUID`. All problems are reported together.
- A missing, archived or other-organization property is an indistinguishable `404 { code: 'NOT_FOUND' }`.
- Sections are gated by the existing permission constants and are `null` when the caller lacks the permission: `tenants` needs `checkin.read`
  and `resident.read`; `tenants.upcomingCheckIns` and `bookings` need `booking.read`; `tenants.recentAdmissions` needs `admission.read`;
  `finance` needs `finance.read`; each activity entry needs its source permission **and** `resident.read` to name the resident (without
  `resident.read` the event, its time, bed and amount are kept, but `residentName` and `residentId` are `null`). Both existing roles hold all
  of them, so every section is present and named today; the gating is proven with fake roles in the unit and integration tests.
- The whole response is one `REPEATABLE READ` read transaction (precedent: `stay-summary.service.ts`), so the sections always agree.

The response schema is `apps/api/src/dashboard/dashboard.types.ts` (mirrored for the browser in `apps/web/src/dashboard/dashboardApi.ts`).
The pure rules (validation, windows, bed categories, the dashboard-only "past end date" classification, gating, activity merge) are in
`dashboard.rules.ts`; the queries are in `dashboard.service.ts`.

## Dashboard-only definitions to keep in mind

- **Past end date** (`tenants.pastEndDate`): an active stay whose booking end date is strictly before today. A booking that ends **today** is an
  *upcoming check-out*. The existing `isOverstay` rule (end date on or before today), `GET /check-ins/occupancy` and the Finance overstay banner
  are unchanged, so for a resident whose booking ends today the dashboard and the Finance banner differ by design (owner decision D7).
- **Occupied** beds come from active stays resolved to their physical bed (the existing `physicalBedId` rule), never from bookings or
  `IN_SERVICE`. A stay with inconsistent bed history is counted in `anomalies.stayNeedsReview`, not hidden and not fatal.
- **Overdue (all months)** and **Outstanding (all months)** cover every open invoice; **Invoiced**, **Collected** and **Month unpaid** are for the
  chosen month. The Finance overview's month-scoped "Overdue amount" is a different figure with a similar name; both are labelled.
- **Unattributed** finance (invoices with no booking, and their payments) is organization-level, shown separately, and never added to a property.
- Activity entries for a booking or an admission carry the time the **record was created** (`timeBasis: RECORD_CREATED`), worded "… record
  created" with the time captioned "Recorded". It is never an admission date or an approval time.

## Frontend

`apps/web/src/dashboard/`: `OwnerDashboard.tsx` (screen, property and month selection, states), `OccupancyPanel`, `FinancePanel`,
`MovementsPanel`, `BookingsPanel`, `PaymentsPanel`, `ActivityPanel`, `Panel.tsx`, `dashboardApi.ts`, `dashboardRules.ts`, `overviewRoute.ts`,
`dashboard.css` (canonical tokens only, no hex literals).

- The property is selected with `#overview/<propertyId>`. `parseOverviewHash` keeps the section `overview` whatever property is selected; a
  malformed id shows a notice and makes no request; an id that is not one of the organization's properties is "Property not found". With one
  property it is selected automatically (`history.replaceState`, no history entry). The selection is also kept in the component, so following the
  `#inventory` anchor does not forget it.
- A legacy `#floor-plan` link lands on the dashboard. The demonstration floor plan, its sidebar item ("Interactive floor plan"), its footer
  sentence and every DEMO label are gone from the owner experience.
- Kept untouched: the real inventory table and its `#inventory` anchor and nav item, the Properties, Floors, Rooms, Beds and Bulk-rooms screens,
  the admissions panel, and every other route.
- Per R9 the now-unreferenced demo modules (`components/FloorPlan.tsx`, `floorPlanState.ts`, `propertyDemo.ts`, `components/DemoBadge.tsx`) and
  their tests were left unchanged. The production build contains none of their text (checked: no "Nook House", "Demonstration", "DEMO DATA",
  "Demo bed snapshot" or "Interactive floor plan" in the bundle); only an unused CSS rule remains.
- Layout: one column at 390 px, two columns at 768 px and 1440 px; tables scroll inside their own labelled, focusable box instead of wrapping.

## Tests

| Where | What | Registered |
|---|---|---|
| `apps/api/test/dashboard.rules.test.ts` (29) | validation, IST window edges (18:29:59Z vs 18:30:00Z), the D7 boundary against the unchanged `isOverstay`, percent rounding, bed categories, gating with fake roles (including that an activity entry needs `resident.read` to name a resident), activity merge | `scripts/ci/test-files.json` `quality` |
| `apps/api/test/integration/dashboard.integration.test.ts` (45) | real PostgreSQL: inventory and archived rows, physical beds and cross-property transfers, anomalies, tenants, windows and caps, activity, gating, finance by hand-computed figures, reconciliation with `GET /finance/reports/monthly` and `GET /finance/outstanding` (one property; and two properties plus an archived one plus unattributed), HTTP contract, 400 and 404 and isolation, REPEATABLE READ and concurrent-write consistency, constant statement count, a 100-bed hostel, a read-only fingerprint, the D7 regression against `/check-ins/occupancy`; and isolation with records dated **inside** every window (below) | `test-files.json` `full` and the pinned list in `scripts/ci/integration-test-reporter.test.js` (15 → 16) |
| `apps/web/src/dashboard/overviewRoute.test.ts`, `dashboardRules.test.ts` (25) | IST rendering of instants under UTC and Los Angeles browser zones, no browser-local formatting in any dashboard component, the page `<h1>`, unnamed activity lines, hash routing (including legacy `#floor-plan` and that `#overview/<id>` is never an ops, finance or admin hash), labels, month choices, occupancy wording, the R7 activity wording | glob (`npm run test --workspace @nook/web`) |
| Browser (manual, real Chrome) | 19 scenarios against the real API and Vite app on a disposable database: picker and auto-selection, month switching, legacy and malformed links, loading and error and empty states, demo content gone, exactly one `<h1>` with the title's computed style unchanged, departure times identical under emulated Asia/Kolkata, UTC, Los Angeles and Auckland browser zones, inventory intact, keyboard order, layout at 390, 768 and 1440 px | **local only: the harness is not in this repository** (see "QA evidence that cannot be reproduced from the repository") |

The 403 for a role without `inventory.read` **is** exercised over real HTTP: `apps/api/test/permission-layer.test.ts` (registered in
`test-files.json` `quality`) discovers every route from the framework's own metadata, so it includes this one, and drives each
permission-protected route with the synthetic roles `STAFF`, `RESIDENT`, empty and `constructor`, expecting `403 INSUFFICIENT_ROLE` (and
`OWNER` and `PROPERTY_MANAGER` never being refused). The dashboard integration file adds no separate 403 case because that test already
covers the route. What the database cannot provoke is a real *member* without a section permission, since both existing roles hold every
permission; section gating for such a role is therefore proven with fake permission sets in the unit and integration tests.

## Isolation tests with records inside every window

The first version isolated by presence: a foreign stay or invoice that would show up in an *active* figure. The foreign and other-property
rows were dated long ago, so they sat outside the recent and upcoming windows, and a dropped filter on a *windowed* list would not have been
noticed. `dashboard.integration.test.ts` now builds three structurally identical worlds at the fixed `NOW` (today = 2026-11-14 IST): the
selected property, **another property of the same organization**, and **another organization**. Each has an active stay ending in five days,
a stay that ended yesterday, a confirmed booking starting in four days, a departed resident, a stay with inconsistent bed history, an overdue
partly-paid invoice with its payment, and (for the other organization) an organization-level invoice with no booking and its payment. Every
record is dated inside its window (the test asserts that for each timestamp), and each world has distinctive names and amounts. The selected
property's response must contain exactly its own counts and names, none of the others' names or amounts, and every activity source is also
asserted on its own so a leak cannot hide behind the ten-entry cap.

**Mutation check (local script, not committed).** For each query, the property or organization filter was removed in turn and
`dashboard.integration.test.ts` was run on a disposable database:

| Filter removed | Result |
|---|---|
| `propertyId`: floors, rooms, beds | detected |
| `propertyId`: stays (query filter, segment filter and anomaly guard together) | detected |
| `propertyId`: upcoming bookings (count, distinct beds, list) | detected |
| `propertyId`: recent bookings, recent admissions, recent departures | detected |
| `propertyId`: finance attribution (invoiced, open, overdue, pending, collected, recent payments) | detected |
| `propertyId`: activity admissions, activity check-ins | detected |
| `organizationId`: property lookup (a cross-organization request would succeed) | detected |
| `organizationId`: the four unattributed-money queries (invoiced, open balance and count, overdue, collected) | detected, each |
| `propertyId`: stays query filter **alone**, or the anomaly guard **alone** | **not detected, by design**: the two protect each other (and the live-bed lookup), so removing one cannot leak |
| `organizationId`: every property-scoped query at once | **not detected, by design**: a property id belongs to exactly one organization (composite foreign keys), so the filter there is defence in depth and removing it changes no result |

Two earlier mutations of the stays query that replaced the filter with an empty object were *discarded as invalid evidence*: they were
"detected", but because the changed query no longer meant what it did, not because they modelled a leak. They were replaced by mutations that
genuinely widen the filter.

## Review follow-ups

An independent pre-merge review of PR #5 found no blocker or high-severity defect and asked for these fixes, which are done:
- Isolation tests with in-window records (above).
- Departure times use the existing IST formatter; a test proves the calendar day is right when the browser is in UTC or Los Angeles, and another
  fails if any dashboard component formats an instant in the browser's zone again.
- The dashboard title is the page's single `<h1>` (`PageHead` gained an optional `as`, default `h2`, so no other screen changes; the title keeps
  its exact computed style, checked in the browser).
- Activity entries need `resident.read` to name a resident (above).
- This document now states which QA evidence is local and uncommitted, and the 403 coverage is described correctly.

Left as follow-ups, not blockers: remembering the selected property across other sections, reducing the 62 round trips, the organization-sized
work of the active-stays query, announcing the loading placeholder to assistive technology, and a contract test between the API and web types.

## QA evidence that cannot be reproduced from the repository

Two kinds of evidence in this work come from **local scripts that are not committed**, so they cannot be re-run from the repository:

- **Browser verification.** A puppeteer script drove real Chrome against the real API and Vite app on a disposable database (built from copies of
  the existing disposable-database runner with its paths rewritten). The scenarios above describe what it covered; its screenshots and
  per-run results are not kept. Hosted CI does not run a browser. Treat the browser result as the author's local observation.
- **Performance measurements.** The harness that seeded the data and ran `EXPLAIN (ANALYZE, BUFFERS)` is likewise not committed. The numbers
  below, and `docs/phase-3/evidence/dashboard-performance-2026-11-14.json` (which carries a `provenance` block saying the same), are a record
  of **one run in a synthetic, disposable environment**. They are historical evidence, not a service-level promise, and nothing here
  claims they can be regenerated.
- **Mutation checks of the isolation tests** (below) were also driven by a local script. They are described so they can be repeated by hand:
  remove the named filter from `dashboard.service.ts`, run `dashboard.integration.test.ts` on a disposable database, and expect a failure.

What *is* in the repository and re-runnable: every automated test listed above, on the existing disposable-database runner
(`node --import tsx scripts/qa/phase4-disposable.mjs full regression`, with `NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1`) and in hosted CI.

## Measured performance

Measured on a throwaway PostgreSQL 17 in Docker on a developer laptop (tmpfs storage, loopback connection), after `ANALYZE`, with synthetic data:
6,100 beds, 11,143 bookings, 10,279 check-ins, 25,137 invoices and 19,288 payments across four organizations. Every figure below is from the real
`DashboardService`; each statement it issues was then run under `EXPLAIN (ANALYZE, BUFFERS)` with its real parameters. The compact record is
`docs/phase-3/evidence/dashboard-performance-2026-11-14.json` (the full plan text is 2.3 MB and was not kept).

| Scenario | Statements | Warm latency, p50 / p95 / max (25 runs, service call) | Sum of server execution (EXPLAIN) | Slowest statement |
|---|---|---|---|---|
| 100-bed organization | 62 | 31 / 36 / 48 ms | 4.5 ms | 0.55 ms |
| 2,000-bed organization, one property | 62 | 82 / 113 / 185 ms | 23.0 ms | 2.3 ms |
| One 100-bed property in a 2,000-bed, 20-property organization | 62 | 40 / 56 / 58 ms | 14.3 ms | 2.6 ms |

- The statement count is the same at every size (it is also asserted in the integration test); it is **62, not the "about 16" the plan estimated**,
  because Prisma runs one statement per relation level of each `findMany`. Almost all of the wall time is those round trips, not the database.
- Several statements use a sequential scan of `beds` (2,000 rows), `bookings` or `stay_assignments` where there is no index on `beds(property_id)`,
  `check_outs(check_out_at)` or `admissions(admission_date)`. At these sizes each such statement takes at most 2.6 ms, so **no index and no
  migration is proposed**. If this ever matters, the first lever is fewer statements (for example `relationLoadStrategy: 'join'`), not an index;
  that was not tried and would need its own measurement.
- Not measured: a production database, network latency, concurrent load, cold-cache behaviour, or data beyond the sizes above. The numbers are
  evidence for this machine and this synthetic data, not a service-level promise, and no latency threshold is asserted anywhere.

## Known limitations

- **Property-scoped manager access is not implemented (D4).** `Membership` has no property scope; any manager can open every property of the
  organization here and on every existing screen.
- **Finance by property is approximate (D5).** Attribution is invoice → booking → the booking's bed; invoices with no booking appear only as
  `unattributed`; a cross-property transfer would leave a booking on its original bed's property; money on an archived property appears on no
  dashboard.
- Late arrivals (a confirmed booking whose start date passed with no check-in) appear in no list (D13). `admissionDate` is not the approval day
  (D8). Departures use the original check-in bed.
- Two occupancy computations coexist: `GET /check-ins/occupancy` counts `totalBeds` with a looser rule and is organization-wide.
- Inventory changes, and who made any change, cannot be shown: the **inventory module writes no audit events**. This is unchanged and out of
  scope. (Earlier documents said the runtime role *cannot write* `audit_events`; that was not supported and has been corrected. The production
  role's grants have not been verified. No grant or schema was changed.)
- Browser results are local evidence from an uncommitted harness; hosted CI does not run a browser. The performance figures are likewise a record
  of one synthetic run from an uncommitted harness.

## Notes against the frozen plan

None of these changes scope or a decision; they are facts the plan could not know or named slightly differently.
- The sidebar item that was removed is labelled "Interactive floor plan" (the plan called it "Demonstration floor plan", which is the breadcrumb label
  of the same section).
- `request`, `unwrap` and `qs` in `apps/web/src/ops/opsApi.ts` are now exported (three words, no behaviour change) so the dashboard client uses the
  existing CSRF, session and error handling.
- The statement count measured at 62 (plan estimate: about 16, labelled unverified).
- The integration test's invoice fixtures follow the database rules: invoice numbers match `INV-YYYY-NNNN…`, and a payment is recorded while the
  invoice is rewound to its pre-payment balance (the payment snapshot trigger checks the balance at insert), then the invoice is restored.
