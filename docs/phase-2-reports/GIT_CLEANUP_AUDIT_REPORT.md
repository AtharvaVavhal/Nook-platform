**NOOK – POST‑PHASE‑2 GIT CLEAN‑UP AUDIT (read‑only)**  

| # | Path | Purpose | Required / Optional / Temporary | Sensitive‑content risk | Recommended action |
|---|------|---------|--------------------------------|------------------------|--------------------|
| 1 | `CREDENTIAL_ROTATION_VERIFICATION_REPORT.md` | Phase‑2 credential‑rotation verification report | **Temporary** (analysis artefact) | No credentials – only analysis text | **ARCHIVE** (move to `docs/phase‑2‑reports/` or delete after review) |
| 2 | `PHASE2_BLOCKER_VERIFICATION_REPORT.md` | Blocker‑verification report | **Temporary** | No secrets | **ARCHIVE** |
| 3 | `PHASE2_CHECKPOINT_A_CORRECTED_REPORT.md` | Checkpoint‑A corrected report | **Temporary** | No secrets | **ARCHIVE** |
| 4 | `PHASE2_COORDINATOR_VALIDATION_REPORT.md` | Coordinator validation notes | **Temporary** | No secrets | **ARCHIVE** |
| 5 | `PHASE2_CREDENTIAL_ROTATION_FINAL_PLAN.md` | Final rotation plan | **Temporary** | No secrets | **ARCHIVE** |
| 6 | `PHASE2_EXECUTION_REPORT.md` | Execution‑status log | **Temporary** | No secrets | **ARCHIVE** |
| 7 | `PHASE2_FINAL_CHECKPOINT_A_REPORT.md` | Final checkpoint‑A report | **Temporary** | No secrets | **ARCHIVE** |
| 8 | `PHASE2_FINAL_EXECUTION_HANDOFF.md` | Handoff instructions | **Temporary** | No secrets | **ARCHIVE** |
| 9 | `PHASE2_FINAL_PREPARATION_REPORT.md` | Preparation notes | **Temporary** | No secrets | **ARCHIVE** |
|10| `PHASE_2_OWNER_DECISION_ANALYSIS_REPORT.md` | Owner‑decision analysis | **Temporary** | No secrets | **ARCHIVE** |
|11| `POSTGRES_PASSWORD_ROTATION_INVESTIGATION.md` | Investigation notes | **Temporary** | No secrets | **ARCHIVE** |
|12| `apps/api/src/database/prisma.service.ts` | **Tracked** (already staged) – Prisma client factory used by the API | **Required** (runtime) | No secrets (only builds client from `DATABASE_URL`) | **KEEP** (already staged) |
|13| `docs/assets/make_hero.py` | Script that generates hero images from SVG/PNG | **Optional** (build‑time asset generator) | No secrets | **KEEP** (useful for future hero updates) |
|14| `docs/assets/render_hero.cjs` | Alternate renderer for hero assets | **Optional** | No secrets | **KEEP** |
|15| `docs/assets/readme-hero.svg` | Source SVG used in README (referenced in `<picture>` tag) | **Required** (README displays it) | No secrets | **KEEP** |
|15b| `docs/assets/readme-hero.png` | Fallback PNG for README (referenced in `<img>` fallback) | **Required** (fallback) | No secrets | **KEEP** |
|15c| `docs/assets/sample_hero.cjs` | Sample script for hero generation demo | **Optional** (demo) | No secrets | **KEEP** (small utility) |
|16| `docs/nook-phase-2/PHASE_2_SLICE_2_2_DISPOSABLE_TEST_PLAN.md` | Phase‑2 slice test plan (disposable) | **Temporary** | No secrets | **ARCHIVE** |
|17| `docs/nook-phase-2/PHASE_2_SLICE_2_2_IMPLEMENTATION_PLAN.md` | Implementation plan for slice 2.2 | **Temporary** | No secrets | **ARCHIVE** |
|18| `docs/nook-phase-2/PHASE_2_SLICE_2_2_ISOLATED_TEST_ENVIRONMENT_PLAN.md` | Isolated test‑env plan | **Temporary** | No secrets | **ARCHIVE** |
|19| `docs/nook-phase-2/disposable-test-v3/` | Disposable test artefacts (v3) | **Temporary** | No secrets | **DELETE** (or **ARCHIVE** if you want history) |
|20| `docs/nook-phase-2/disposable-test-v4/` | Disposable test artefacts (v4) | **Temporary** | No secrets | **DELETE** / **ARCHIVE** |
|21| `docs/nook-phase-2/disposable-test/` | Base disposable test directory | **Temporary** | No secrets | **DELETE** / **ARCHIVE** |
|22| `scripts/__pycache__/` | Python byte‑code cache | **Temporary / generated** | No secrets | **IGNORE** (add to `.gitignore` if not already) |
|23| `scripts/keychain_helper` (binary) | Compiled Swift helper used by the rotation scripts | **Generated artifact** (built from `scripts/keychain_helper.swift`) | No secrets (only reads stdin) | **IGNORE** (add to `.gitignore`; keep source) |
|24| `scripts/keychain_helper.swift` | Source code for the Keychain helper (already **staged** and committed) | **Required** (source) | No secrets | **KEEP** (already committed) |
|25| `scripts/seed_milestone_3c_fixtures.sh` | Seed script that creates the fixture org/user/membership and stores passwords in Keychain | **Optional / dev‑ops** (used only for local fixture seeding) | No hard‑coded secrets; generates secrets at run‑time | **KEEP** (useful for future seeding) |
|26| `test_pty.cjs` | Prototype PTY test script used during investigation | **Temporary / prototype** | No secrets | **DELETE** (or **ARCHIVE** if you want record) |

### Summary of Recommendations
* **Keep / Commit** – items 12, 13‑15, 15b‑15c, 23 (source already staged), 25 (seed script).  
* **Archive** – all Phase‑2 markdown reports (1‑11) and the disposable‑test docs (16‑18).  
* **Delete / Clean** – disposable test directories (19‑21) and prototype script `test_pty.cjs` (26).  
* **Ignore** – Python cache (`scripts/__pycache__/`) and the compiled binary `scripts/keychain_helper` (add to `.gitignore`).  

### Git‑state sanity check
Running the same `git status` after the audit shows **no modifications** to tracked files and **no new staged/unstaged changes** – the working tree is exactly as reported earlier, and `origin/main` remains at commit `2c95f32`. No files were modified during this audit.