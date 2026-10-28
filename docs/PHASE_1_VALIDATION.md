# Phase 1 validation — Property management and 2D floor plan

Phase 1 is a **frontend-only demonstration**. Nothing here is connected to an API, database or resident record.

**Recommendation: ACCEPT WITH DOCUMENTED LIMITATIONS** (2026-10-28). The Phase 1 UI passed the browser checks listed below in Chrome only. The product slice is accepted for demonstration use. The Multer advisory was subsequently fixed (see "Security fix"); the platform is still **not** release-ready because PostgreSQL, the API beyond a health-route boot check, and hosted CI remain unverified (see "Unresolved blockers").

## What exists

- Application shell (sidebar, property context, mobile menu) using the existing Nook tokens and logo assets in `apps/web/public/brand`.
- Property overview: floors, rooms, beds, and available/occupied/unavailable counts, all derived from `apps/web/src/propertyDemo.ts` (4 floors, 9 rooms, 36 beds: 10 available, 23 occupied, 3 unavailable).
- Interactive floor plan: floor selection, room search, status filter, selectable beds, legend, details panel, and empty/error states.
- Inventory overview linking each metric to the matching floor-plan filter.
- Future modules (Residents, Booking, Finance, Operations) appear only as **Planned** labels, with no behaviour.

## Data model and its limits

- One source of truth: `demoFloors` in `propertyDemo.ts`. All counts, bed states and details are derived from it.
- Geometry is schematic (top-left origin, +x right, +y down; floors carry an `elevation`), so a backend spatial model or a future 3D view can supply the same shape.
- The UI distinguishes **displayed availability** (synthetic), **a locally selected bed** (device-only, not persisted) and a **backend-confirmed allocation** (always "None · not available in this phase").
- There is no live availability API. The UI offers no booking, reservation or allocation action, and instant booking is not enabled.

## Browser QA

- Browser: Google Chrome 156.0.8078.73, headless, macOS, driven by `puppeteer-core` 24.43.1 (taken from the local npx cache; **no dependency was added to the repo**).
- App: `npm run dev:web` (Vite) at `http://127.0.0.1:5173`.
- Viewports: 1440, 1024, 768, 390 px for layout/overflow/screenshots; the smoke script additionally covers 320, 1600 px.
- Not covered: Safari, Firefox, real touch devices, screen readers, and a measured colour-contrast audit.

| Scenario                                                                    | Result               | Notes                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard loads, no console errors/warnings, page errors or failed requests | PASS                 | Zero entries across 4 viewport loads and all interactions.                                                                                                                                              |
| Genuine Nook logo and brand colours                                         | PASS                 | `nook-logo-white.svg` loads (`naturalWidth > 0`); sidebar `rgb(23,19,56)` = #171338, primary button `rgb(118,87,246)` = #7657F6, body text `rgb(38,35,61)` = #26233D.                                   |
| Desktop navigation and mobile menu                                          | PASS                 | Menu toggles `aria-expanded` and closes after choosing a link (smoke script, 390 px). Menu-open state was not visually screenshotted.                                                                   |
| Floor switching                                                             | PASS                 | Ground/First/Second show 3 rooms and 12 beds each; Third shows the empty state. No bed tiles overlap.                                                                                                   |
| Room search and status filter                                               | PASS                 | "102" leaves only Room 102's beds enabled, mutes other rooms and announces "1 of 3 rooms match". Combined with a non-matching status it shows "No matching rooms".                                      |
| Selecting a bed shows correct details                                       | PASS                 | Heading, floor, reference, status, operational hold note and "Backend-confirmed allocation: None" match the sample data.                                                                                |
| Empty search / empty floor states with recovery                             | PASS                 | Both offer a clear-filters action.                                                                                                                                                                      |
| Invalid-layout error state                                                  | **Unit-tested only** | Covered by `floorPlanState.test.ts`; it cannot be reached through the UI with the shipped data, so it was not exercised in the browser.                                                                 |
| Demo-data labels and no-allocation messaging                                | PASS                 | "DEMO DATA" badge, demo notice, "Explore freely. Nothing is allocated", "Selected on this device only" present.                                                                                         |
| No control falsely implies a backend action                                 | PASS                 | Visible text contains no book/reserve/allocate/confirm/pay wording. Controls are navigation, filters, selection and Clear selection only.                                                               |
| Layout at 1440 / 1024 / 768 / 390 px                                        | PASS                 | No document overflow, no clipped headings/nav/buttons, no controls under 24 px. Bed targets are at least 44 px at 320-1600 px. The plan scrolls horizontally inside its own container on small screens. |
| Keyboard operation and focus visibility                                     | PASS                 | Tab order follows the visual order from the skip link onward; every focus stop shows a 3 px violet outline; beds activate with Enter and Clear selection with Space.                                    |

### Defect found and fixed

- **Horizontal page overflow on phones** (document `scrollWidth` 594 px at a 390 px viewport; also at 320 px). The inventory table's visually hidden "Explore" header text is absolutely positioned and its containing block was the viewport, so the table's scroll container did not clip it. Fix: `position: relative` on `.inventory-table-wrap` in `apps/web/src/styles.css`. After the fix `scrollWidth` equals the viewport width at all tested widths.

### Evidence

Screenshots (full page and floor-plan crops at each viewport, search state, keyboard focus) were generated in the session scratchpad and are deliberately **not** committed. Regenerate the smoke screenshots with:

```sh
NOOK_BROWSER_MODULE=<path to puppeteer-core> \
NOOK_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
NOOK_UI_ARTIFACTS=<output dir> node scripts/verify_property_ui.js
```

`scripts/verify_property_ui.js` exits 0 against the fixed build. It failed with "Page overflow at 320" before the fix.

## Automated verification (2026-10-28, Node 24.22.1, npm 11.6.2)

| Command                                              | Exit | Notes                                                                                                                                                                               |
| ---------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                           | 0    | 15 tests (4 api, 11 web).                                                                                                                                                           |
| `npm run typecheck`                                  | 0    |                                                                                                                                                                                     |
| `npm run build`                                      | 0    |                                                                                                                                                                                     |
| `npm run lint`                                       | 1    | Fails only on two untracked, unrelated files: `marketing/instagram/nook-brand-intro/render.js` and `render_v2.js`. `eslint apps scripts eslint.config.js prisma.config.ts` exits 0. |
| `npm run format:check`                               | 1    | Fails only on untracked `marketing/instagram/nook-brand-intro/*`. `prettier --check apps scripts docs/*.md eslint.config.js README.md` exits 0.                                     |
| `npm run verify:secrets`                             | 0    | Baseline pattern scanner only.                                                                                                                                                      |
| `npm run verify:m0-scope`                            | 0    | 22/22 checks.                                                                                                                                                                       |
| `DATABASE_URL=<placeholder> npm run prisma:validate` | 0    | Validates the empty schema only; no database connection.                                                                                                                            |

The `marketing/` directory is not part of Phase 1 and was left untouched. The repo-wide lint and format commands will keep failing until its owner formats it or it is ignored/removed.

## Unresolved blockers

- **Multer advisory GHSA-q7qp-rjg7-q26m: fixed in the dependency tree, 2026-10-28.** See "Security fix" below. At the time of the Phase 1 browser QA it was open (installed multer 2.4.0, 2 high-severity findings in a live `npm audit`); that state is why the Phase 1 commit message records it as open.
- The registry was reachable during this run, unlike the Milestone 0 report. The registry connectivity problem is therefore not currently reproducing, but earlier results in `MILESTONE_0_VALIDATION.md` have not been re-derived.
- PostgreSQL runtime, the API, and hosted CI remain unverified.
- Git: a local repo exists (no `.git` in the M0 report). Phase 1 and the Multer fix are committed locally as two separate commits; nothing has been pushed. A GitHub remote `origin` (`AtharvaVavhal/Nook-platform`) is configured and local `main` is ahead of `origin/main` by those two commits. An earlier draft of this report incorrectly said no remote existed.

## Security fix: Multer GHSA-q7qp-rjg7-q26m (2026-10-28)

Change: `@nestjs/common`, `@nestjs/core` and `@nestjs/platform-express` aligned from `12.2.0` to `12.3.2` (exact pins) in `apps/api/package.json`, applied with `npm install -w @nook/api --save-exact ...`. `package-lock.json` was written by npm, not edited by hand. `npm audit fix --force` was not used.

Compatibility basis: only `multer` (2.4.0 to 2.5.0) differs in `platform-express` dependencies; `@nestjs/common` moves `file-type` 22.1.1 to 22.2.0 (and its transitive `@tokenizer/inflate` 0.4.1 to 0.5.2); `@nestjs/core` dependencies are unchanged. NestJS 12.3.0 release notes list bug fixes, including Express adapter error mapping, plus an opt-in native `platform-node` adapter that this project does not use. Tag comparison 12.3.0 to 12.3.2 touches only `platform-node`, dependency patch updates and release metadata. The API source contains no file uploads, interceptors or direct `multer`/`express` imports. 12.3.x was published 2026-10-27, so it is very recent.

Evidence after install:

- `npm ls multer`: `@nestjs/platform-express@12.3.2 -> multer@2.5.0`; installed `node_modules/multer` is `2.5.0`; lockfile entry is `2.5.0`.
- Live `npm audit`: **0 vulnerabilities**, exit 0 (registry reachable).
- `npm test` 0 (15 tests), `npm run typecheck` 0, `npm run build` 0, `npm run verify:secrets` 0, `npm run verify:m0-scope` 22/22, `prisma:validate` 0, scoped eslint and prettier 0, browser smoke script PASS (both result lines printed; its exit code was not captured in this shell).
- Built API booted on 12.3.2 with placeholder config: `GET /api/v1/health` returned 200 and the Helmet headers were present; `GET /api/v1/health/database` returned 503 "degraded" because no PostgreSQL is running.
- Repo-wide `npm run lint` and `npm run format:check` still exit 1, solely because of the untracked `marketing/instagram/nook-brand-intro/` scripts and README.

Not verified: upload or multipart behaviour (none exists in the API), any database-backed route, and hosted CI. The root `overrides.multer` entry (`2.5.0`) is now redundant and was left in place. Npm also re-sorted `devDependencies` in `apps/api/package.json`; this is cosmetic.

## Git hygiene review

- Modified tracked files: `apps/web/index.html`, `App.tsx`, `propertyDemo.ts`, `styles.css`, `eslint.config.js`. `README.md` carried a stray whitespace-only edit, which was reverted with Prettier; it now has no diff.
- Untracked and in scope: `apps/web/public/`, `apps/web/src/components/`, `floorPlanState.ts(.test.ts)`, `scripts/verify_property_ui.js`, `docs/PHASE_1_VALIDATION.md`.
- Untracked and **not** Phase 1: `marketing/` (Instagram assets/scripts) and `docs/nook-complete-project-handbook-v1/` (includes a `.zip` and `.docx`/`.pdf` binaries over 2 MB). Review these before committing.
- Ignored build output (`apps/*/dist`) is not tracked. The secrets scan passes and no credential-like strings appear in the added lines.
