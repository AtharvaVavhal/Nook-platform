# Nook UI readiness baseline — 2026-11-13

Audit performed on the existing dirty working tree. Existing changes were preserved; the starting frontend diff was captured at `/tmp/nook-ui-readiness-existing-web.diff`. No commits, pushes, merges or deployment.

## Counting rule

44 unique screen types: 42 workspace/operations/finance route templates plus login and forced password change. Overview, floor plan and inventory anchors share one rendered workspace screen; reusable components, modals, profile tabs, record IDs and receipt variants are not extra screens. 33 operations route types, eight finance route types and one workspace = 42. Both OWNER and PROPERTY_MANAGER use these screens. STAFF and RESIDENT do not exist as account roles (MembershipRole has only OWNER / PROPERTY_MANAGER).

## Baseline evidence

`evidence/baseline/route-scan.json`: 126 route/viewport observations (42 × 1440/768/390), real Chrome + Vite + Nest + a new disposable PostgreSQL cluster. Nine failed observations are three broken route types at each width: overdue follow-ups, upcoming follow-ups and admission detail. No document-level horizontal overflow or page exceptions in this sweep. Screenshots are synthetic records only.

`evidence/baseline/results.json`: nine passing scenarios, seven failing scenarios. W05's failure is a harness timing assertion: its wait matched modal footer copy before the payment committed; later receipt/finance captures confirm the real payment. It is not counted as an application defect. Harness preflight directories contain setup/debug attempts, not acceptance results. The baseline inventory scenario fails on real HTTP 400 bed creation; independent workflows subsequently use two explicitly seeded synthetic beds. The failed bed scenario remains failed.

## Verified defects before changes

| ID | Priority | Route | Reproduction / evidence | Source |
|---|---|---|---|---|
| F01 | P1 | #beds/:room/new and #beds/:room/:bed | Submit an in-service bed with a label. HTTP 400: the form sends an outOfServiceReason forbidden by the existing API. Returning an out-of-service bed to service also fails. | apps/web/src/ops/Inventory.tsx, BedForm |
| F02 | P1 | #residents/:id/profile → Financial | Invoice 5000, cash 1000, credit 500. Profile displays balance 3000 instead of server balance 3500, and labels cash as 1500. | apps/web/src/ops/ResidentProfile.tsx, FinanceTab |
| F03 | P1 | #properties/:id (also unkeyed detail routes) | Edit property A, type an unsaved name, change hash to property B without reloading. A's form values persist and can submit against the new record. Browser X03 reproduced. | apps/web/src/ops/OpsShell.tsx; apps/web/src/finance/FinanceShell.tsx; apps/web/src/finance/shared.tsx |
| F04 | P1 | #admissions/:id | Open a valid admission detail URL. Shell renders no detail body, despite an existing get API. | apps/web/src/ops/OpsShell.tsx; Admissions.tsx |
| F05 | P1 | #enquiries/follow-ups/overdue; #enquiries/follow-ups/upcoming | Open exported opsLinks URLs. Parser falls back to ordinary enquiries; declared follow-up route names also have no body. Existing APIs are available. | apps/web/src/ops/opsRoute.ts; OpsShell.tsx; Enquiries.tsx |
| F06 | P2 | #rooms/:property/new; #admissions; #finance/invoices/new | Inject GET 503 while loading floors, confirmed bookings, or resident search. Failures are hidden or presented as no records; no retry. These are explicitly fault-injected UI checks, not real integration acceptance. | Inventory.tsx; Admissions.tsx; CreateInvoice.tsx |
| F07 | P2 | Finance dialogs; change-password dialog | Open a modal and Tab repeatedly. Focus escapes to the background; no focus return. | finance/RecordPaymentModal.tsx; CorrectionModals.tsx; auth/UserMenu.tsx |
| F08 | P2 | Operations sections | Most aria-labelledby attributes point to nonexistent headings (captured per route). | ops/ui.tsx and section callers |
| F09 | P2 | #rooms/:property | Floor options are derived from already-filtered rooms, producing duplicate options and removing other floors after filtering; empty floors cannot be selected. | ops/Inventory.tsx, RoomList |
| F10 | P2 | Shared navigation | Sidebar lacks active location for most routes; breadcrumb always says Property management. Sidebar contents exceed short desktop viewport; Booking and Operations are labelled Planned despite existing modules. | App.tsx; styles.css |
| F11 | P2 | #properties/:id; #floors/:property/:id; #rooms/:property/:id | Archive acts immediately without confirmation. | ops/Inventory.tsx |
| F12 | P2 | Admission/check-in pickers | Only the first 100 bookings/admissions/stays are read; eligible records after page one disappear. | Admissions.tsx; CheckIns.tsx |
| F13 | P2 | Profile history | Change filters after advancing a page. Page is not reset; filtered events may appear empty. | ResidentProfile.tsx |
| F14 | P2 | Dark theme operations/finance | Hardcoded hint/tag colours and active finance tab's dark primary foreground do not follow theme tokens. Correction primary button class has no primary style. | ops/ops.css; finance/finance.css |
| F15 | P2 | Frontend test script | npm test --workspace @nook/web runs only nested test files (54 tests), omitting root src tests for auth, CSRF, finance, floor plan and brand. | apps/web/package.json |

## Product gaps / preserved safety constraints

- Staff and resident accounts, role-specific portals, staff/permission management, general settings and notifications have no screens or implemented account roles.
- Resident forms expose no document handling/verification controls, although resident APIs carry document fields.
- The top workspace property and floor-plan visuals are explicitly synthetic. Inventory at a glance and admissions below them are live API integrations; the workspace is mixed, not wholly mocked.
- A freshly created real check-in does not have an active stay assignment; transfer preview refuses it with a stale-state error. Execution remains deliberately gated. This is a launch blocker; do not enable transfer execution or alter assignment/finance safety controls.
- Billing reviews and finance correction history are bounded to 100 entries with no UI pagination. Profile financial list is an outstanding-only list; it should not imply complete invoice/payment history.
- Full accessibility conformance, real mobile Safari/touch devices and production session-cookie configuration are not certified by desktop Chrome emulation.

Final screen classifications and verification totals will be reported after targeted frontend repairs.
