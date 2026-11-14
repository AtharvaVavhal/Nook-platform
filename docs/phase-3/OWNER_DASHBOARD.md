# Owner Dashboard

Phase 3, Task 2. Scope slice `3.10` (`scripts/phase_scope.json`, `docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md`). The decisions, formulas,
response schema and acceptance criteria are frozen in `OWNER_DASHBOARD_IMPLEMENTATION_PLAN.md`; this document describes what was built, how it
is tested, what was measured, and what is known to be limited. Where the two differ the plan states the intent and this document states the
fact; the differences are listed in "Notes against the frozen plan".

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
  `finance` needs `finance.read`; each activity entry needs its source permission. Both existing roles hold all of them, so every section is
  present today; the gating is proven with fake roles in the unit and integration tests.
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
| `apps/api/test/dashboard.rules.test.ts` (28) | validation, IST window edges (18:29:59Z vs 18:30:00Z), the D7 boundary against the unchanged `isOverstay`, percent rounding, bed categories, gating with fake roles, activity merge | `scripts/ci/test-files.json` `quality` |
| `apps/api/test/integration/dashboard.integration.test.ts` (38) | real PostgreSQL: inventory and archived rows, physical beds and cross-property transfers, anomalies, tenants, windows and caps, activity, gating, finance by hand-computed figures, reconciliation with `GET /finance/reports/monthly` and `GET /finance/outstanding` (one property; and two properties plus an archived one plus unattributed), HTTP contract, 400 and 404 and isolation, REPEATABLE READ and concurrent-write consistency, constant statement count, a 100-bed hostel, a read-only fingerprint, the D7 regression against `/check-ins/occupancy` | `test-files.json` `full` and the pinned list in `scripts/ci/integration-test-reporter.test.js` (15 → 16) |
| `apps/web/src/dashboard/overviewRoute.test.ts`, `dashboardRules.test.ts` (19) | hash routing (including legacy `#floor-plan` and that `#overview/<id>` is never an ops, finance or admin hash), labels, month choices, occupancy wording, the R7 activity wording | glob (`npm run test --workspace @nook/web`) |
| Browser (manual, real Chrome) | 17 scenarios against the real API and Vite app on a disposable database: picker and auto-selection, month switching, legacy and malformed links, loading and error and empty states, demo content gone, inventory intact, keyboard order, layout at 390, 768 and 1440 px | not run by hosted CI; local evidence only |

The 403 for a role without `inventory.read` is covered by the default-deny permission layer tests (the route is discovered automatically) and the
gating unit tests; no database role lacks the permission, so it cannot be provoked over HTTP.

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
- Browser results are local evidence; hosted CI does not run a browser.

## Notes against the frozen plan

None of these changes scope or a decision; they are facts the plan could not know or named slightly differently.
- The sidebar item that was removed is labelled "Interactive floor plan" (the plan called it "Demonstration floor plan", which is the breadcrumb label
  of the same section).
- `request`, `unwrap` and `qs` in `apps/web/src/ops/opsApi.ts` are now exported (three words, no behaviour change) so the dashboard client uses the
  existing CSRF, session and error handling.
- The statement count measured at 62 (plan estimate: about 16, labelled unverified).
- The integration test's invoice fixtures follow the database rules: invoice numbers match `INV-YYYY-NNNN…`, and a payment is recorded while the
  invoice is rewound to its pre-payment balance (the payment snapshot trigger checks the balance at insert), then the invoice is restored.
