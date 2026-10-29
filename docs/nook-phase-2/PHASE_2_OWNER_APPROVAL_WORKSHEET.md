# Phase 2 — Owner Approval Worksheet (Slice 2.1)

**Purpose:** one place where the owner can read, decide and record each of the **eight inputs that block Slice 2.1**. **Every box below is unchecked. Every decision is `PROPOSED`. Nothing in this worksheet is, or has been, approved.** Prepared 2026-10-29 against local `main` at `b2a9f0c`.
**Built from:** the canonical requirements package `~/Downloads/NIVASA_PACKAGE_v0.2/` (the recommended canonical copy, itself unapproved), [the owner decision register](PHASE_2_OWNER_DECISION_REGISTER.md), [the decision brief](PHASE_2_DECISION_BRIEF.md) and [the slice 2.1 preflight](PHASE_2_SLICE_2_1_PREFLIGHT.md). **Those records were not changed.**
**Also relevant:** [Copy comparison](PHASE_2_REQUIREMENTS_COPY_COMPARISON.md) · [Unresolved decisions](PHASE_2_UNRESOLVED_DECISIONS.md) · [Implementation plan](PHASE_2_IMPLEMENTATION_PLAN.md) · [Security review](PHASE_2_SECURITY_REVIEW.md).

Identifiers `G-xx`, `U-xx`, `K-x` are defined in [the register of gates and decisions](PHASE_2_UNRESOLVED_DECISIONS.md). `ADR-*`, `BR-*`, `C-*` are the requirements package's, read against `NIVASA_PACKAGE_v0.2`.

## Confirmed existing decisions

| #   | Fact                                                                                                                                                                                                                                                                                            | Source                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| W-1 | **No decision is approved.** The canonical package's approval record has 0 of 17 rows filled, the sign-off checklist has 0 ticks and the corrections table 0 dispositions. This repository's register shows all nine decisions `PROPOSED` with the approval-evidence column blank.              | Re-checked 2026-10-29 (preflight run 2)                   |
| W-2 | The package states: "A blank row means the decision is **not approved**. Implementation starting is not approval, and neither is silence."                                                                                                                                                      | `10_ARCHITECTURE_APPROVAL_REGISTER.md` §4, canonical copy |
| W-3 | The preflight verdict is **NO-GO**. Free disk space now meets the 5 GiB minimum (7.5 GiB); owner decisions, loopback configuration, dependency approval, spike authorisation, Milestone 0 evidence and the 11 tracked discrepancies do not.                                                     | [Preflight run 2](PHASE_2_SLICE_2_1_PREFLIGHT.md)         |
| W-4 | Hashes of the sources the ADR wording comes from: `10_ARCHITECTURE_APPROVAL_REGISTER.md` `55b18f67fdcee1ce618371090ccc0dd4d0aea38fd92cac0121eb6777e10163f6`; `09_ARCHITECTURE_DECISIONS.md` `8b781571e905b563661a76ad89d0561417aaf9532a2eb289386f71de0db08f9b` (both in `NIVASA_PACKAGE_v0.2`). | Hashed when this worksheet was generated                  |

## How to use this worksheet

1. Read each card, **A1 to A8**, in the order given. The order follows the dependencies.
2. For each, mark **one** response and fill the owner, date and reference lines. A blank response means **not approved**.
3. Reply to me with your decisions. **Your explicit written reply is the decision.** I will then record it in a new decision log and **will not mark anything approved on any other basis**.
4. For the three ADRs, the package names its **own** instrument: `10_ARCHITECTURE_APPROVAL_REGISTER.md` §4 in the canonical copy. Please also fill those rows yourself. A tick in this worksheet does not replace them, and this worksheet does not edit that file.
5. Nothing is executed until you reply and, for each action, a separate instruction authorises it.

## Approval is not verification

The two words mean different things, and this worksheet keeps them apart.

|                          | **Approval of a proposal**                                                          | **Verification of an implementation**                                            |
| ------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **What it is**           | You, the owner, accept a **direction or a plan**                                    | Evidence, produced by running something, that the **built thing actually works** |
| **Who does it**          | The owner                                                                           | A test, a command, a CI run or a review, with a recorded result                  |
| **Where it is recorded** | The owner's instrument: package register §4 for ADRs; the decision log for the rest | The evidence record (`M0-E01…E08` and the checks named per card)                 |
| **What it proves**       | That the work **may** begin                                                         | That the work **succeeded**                                                      |
| **It never implies**     | That any code, configuration or test exists or passes                               | That the proposal was approved                                                   |

Worked examples from this worksheet:

- Approving **`ADR-011`** does **not** make CI pass. CI has **never run**.
- Approving **`ADR-003`** does **not** show that Prisma 7.10.1 works with PostgreSQL 17. That is the spike's job.
- Approving **`U-20`** does **not** make the database loopback-only. That is checked **after** the compose file is edited.
- Approving **`U-22`** does **not** show a package is safe. That is `npm audit` and `npm audit signatures` **after** each install.
- Choosing **`G-02`** option (a) does **not** accept Milestone 0. It commits to **gathering** the evidence.
- Authorising the **`U-26`** spike does **not** mean the spike passed. A failure is a valid result.

Every card therefore ends in two lists: **what approving gives** and **what must still be verified**.

## Summary of the eight inputs

| #   | Item                            | ID(s)     | Recommended choice                                                                          | Current status | Your response |
| --- | ------------------------------- | --------- | ------------------------------------------------------------------------------------------- | -------------- | ------------- |
| A1  | Canonical requirements package  | `U-23`    | `NIVASA_PACKAGE_v0.2` canonical; older copies superseded after approval                     | **PROPOSED**   | ☐ undecided   |
| A2  | Backend architecture            | `ADR-001` | Approve with the scope condition                                                            | **PROPOSED**   | ☐ undecided   |
| A3  | Database and ORM                | `ADR-003` | Approve with amendments                                                                     | **PROPOSED**   | ☐ undecided   |
| A4  | Local development and CI        | `ADR-011` | Approve with amendments                                                                     | **PROPOSED**   | ☐ undecided   |
| A5  | Isolated Docker PostgreSQL      | `U-20`    | Docker, loopback-only, port 5433, behind explicit checks                                    | **PROPOSED**   | ☐ undecided   |
| A6  | New dependencies                | `U-22`    | `@prisma/adapter-pg@7.10.1` (conditional), `zod@4.6.7`, `cookie@2.0.1`, installed per slice | **PROPOSED**   | ☐ undecided   |
| A7  | Milestone 0 acceptance evidence | `G-02`    | (a) gather the evidence inside slice 2.1                                                    | **UNDECIDED**  | ☐ undecided   |
| A8  | Prisma compatibility spike      | `U-26`    | Authorise the throwaway-directory spike                                                     | **NOT GIVEN**  | ☐ undecided   |

**Not needed for slice 2.1:** `U-01` (sessions), `U-27` (scope guard), `G-04` (2D map). They are in [the register](PHASE_2_OWNER_DECISION_REGISTER.md) and are decided later.

**Four small confirmations the decisions above imply** (answer on the relevant card): the **5 GiB** free-space minimum (A5), host port **5433** (A5), the **image-tag precision** (A5, discrepancy `X-9`), and the **spike location** (A8).

**Recommended signing order:** A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8. Each card lists what it needs first.

---

## A1 — Canonical requirements package (`U-23`)

**Status: `PROPOSED`.**

**The question.** Which copy of the requirements package is the text you are being asked to approve? Three locations hold versions; they differ. Evidence: [copy comparison](PHASE_2_REQUIREMENTS_COPY_COMPARISON.md).

**Exact wording to approve.** "`~/Downloads/NIVASA_PACKAGE_v0.2/` is the canonical requirements package for Nook Phase 2. All `ADR-*`, `BR-*` and `C-*` identifiers are read against it. The copies in `~/Documents/Nook/` and the loose requirement files in `~/Downloads/` are historical, superseded drafts and are not to be used for sign-off. The package's own status remains 'Proposed; not approved'."

| Option                          | Consequence                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recommended: v0.2 canonical** | One unambiguous text. v0.2 is the only complete set (16 files), the handbook's own verification script reads it, and it fixes the older set's ADR and `BR-*` numbering collisions |
| The older v0.1 set canonical    | A signature on `ADR-003` is ambiguous (document 09 says "NestJS", document 10 says "database and ORM"); the checklist cites 21 undefined `BR-*` IDs                               |
| Another copy                    | You must identify it; every later decision would be re-read against it                                                                                                            |

**Amendments proposed.** (1) Record the SHA-256 hashes of the canonical files (comparison appendix) in the decision log. (2) Approvals use v0.2 identifiers only. (3) **After** approval only, a status note records the other copies as superseded, **without editing, renaming, moving or deleting them**. (4) The product-name question ("Nivasa" in the package, "Nook" the product, trademark clearance "Blocked") stays separate.

**Depends on.** Nothing. **Unlocks.** A fixed text for every other decision.

**What approving gives.** A single reference text.
**What must still be verified.** ☐ You confirm you reviewed v0.2 (only you can). ☐ The files are re-hashed at sign-off and match the comparison appendix. ☑ Already done: all 44 files hashed and re-hashed unchanged on 2026-10-29.

**Your response (all unchecked):** ☐ Approve · ☐ Approve with changes · ☐ Reject · ☐ Defer
**Changes or conditions:** `____________________` **Owner:** `____________` **Date:** `________` **Reference:** `____________`

---

## A2 — `ADR-001` backend architecture

**Status: `PROPOSED`** (the package's own status: `PROPOSED — approve/amend`).

**Source wording, retained exactly** (verbatim from the canonical files; not paraphrased, not reformatted).

**Register row, `ADR-001` (verbatim, `10_ARCHITECTURE_APPROVAL_REGISTER.md` §1; the four content cells, one per block)**

_Decision:_

```text
Backend architecture
```

_Proposed default:_

```text
NestJS + TypeScript, one modular monolith; modules remain explicit and business rules live in domain/application services, not controllers or React components.
```

_Reason / consequences:_

```text
Fastest safe starting point for two developers; transactional use cases can remain in one deployable process. No microservices in P0.
```

_Status / approval required:_

```text
**PROPOSED — approve/amend**
```

**Narrative (verbatim, `09_ARCHITECTURE_DECISIONS.md`)**

```text
### ADR-001 — Modular monolith on NestJS and TypeScript

**Status:** Proposed
**Decision:** One deployable backend application built with NestJS and TypeScript, with explicit modules for access, inventory, residents and stays, finance, deposits, reports, documents and audit. Business rules live in domain and application services, not in controllers or React components.

**Context:** The team has two developers and one initial customer. Core workflows need atomic transactions across related records. Microservices would introduce distributed deployment, observability and consistency overhead before product demand justifies them. Shared TypeScript reduces language switching with the React client, and a module-oriented framework helps maintain boundaries across two developers.

**Consequences:**
- Easier deployment and transactional composition.
- Modules need clear boundaries and interfaces to avoid a single unstructured codebase.
- The framework does not guarantee security. Guard placement, validation, transaction boundaries and tests remain the team's responsibility.
- Establish domain services, DTO validation, permission checks, typed error contracts and integration tests from the start.
- Separate services can be extracted later based on real scaling or organisational needs.

**Revisit when:** Team size, workload, deployment independence or integration needs demonstrate a measurable reason to split services.

*Version 0.1: this document's ADR-001 and ADR-003, merged.*
```

**Proposed amendment (kept separate; it does not alter the wording above).** "`ADR-001` approved as written in `10_ARCHITECTURE_APPROVAL_REGISTER.md` v0.3. **Condition:** this approval authorises the architectural direction only. Phase 2 builds only the access, inventory and audit modules. Residents and stays, finance, deposits, reports and documents, named in the narrative, are **not** authorised by this approval."

| Option                                            | Consequence                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Recommended: approve with the scope condition** | The direction is settled; the module list in the narrative cannot be read as authority to build residents or finance |
| Approve as written                                | Same direction, but the narrative's module list could be read as authorised work                                     |
| Amend or reject                                   | You write the change or name a replacement (for example a different structure). Dependent slices wait                |

**Depends on.** A1. **Unlocks.** Direction for every slice.

**What approving gives.** The NestJS modular-monolith direction, with Phase 2 limited to three modules.
**What must still be verified.** ☑ NestJS `12.3.2` is present as one `apps/api` with one `AppModule` (checked). ☐ The module boundaries and tests the narrative requires ("domain services, DTO validation, permission checks, typed error contracts and integration tests") **do not exist yet** and are built and verified in later slices. ☐ Your row in the package register §4.

**Your response (all unchecked):** ☐ Approve · ☐ Approve with the proposed amendment · ☐ Approve with other changes · ☐ Reject · ☐ Defer
**Changes or conditions:** `____________________` **Owner:** `____________` **Date:** `________` **Reference:** `____________`

---

## A3 — `ADR-003` database and ORM

**Status: `PROPOSED`** (the package's own status: "PostgreSQL **approved in principle** by project review; Prisma and tool versions **PROPOSED**"; the package says "Approved in principle" "Does not authorise implementation on its own").

**Source wording, retained exactly.**

**Register row, `ADR-003` (verbatim, `10_ARCHITECTURE_APPROVAL_REGISTER.md` §1; the four content cells, one per block)**

_Decision:_

```text
Primary database and ORM
```

_Proposed default:_

```text
PostgreSQL as source of truth; Prisma ORM with versioned Prisma Migrate migrations. Exact supported PostgreSQL/Node/package-manager versions are pinned during scaffold approval after checking maintained releases.
```

_Reason / consequences:_

```text
Relational data, referential integrity, reporting, transactions, constraints and migrations fit the domain. No production `db push` or manual schema edits. Domain schema is not finalised in Milestone 0.
```

_Status / approval required:_

```text
PostgreSQL **approved in principle** by project review; Prisma and tool versions **PROPOSED**
```

**Narrative (verbatim, `09_ARCHITECTURE_DECISIONS.md`)**

```text
### ADR-003 — PostgreSQL as source of truth, with Prisma and versioned migrations

**Status:** PostgreSQL **approved in principle** by project review. Prisma, and the pinned tool and runtime versions, remain **Proposed**.
**Decision:** Use managed PostgreSQL as the source of truth for all domain data. Use Prisma ORM with versioned Prisma Migrate migrations. Exact supported PostgreSQL, Node and package-manager versions are pinned at scaffold approval, after checking maintained releases. *(C-06)*

**Context:** Nivasa's central records are relational: organisations, properties, rooms, beds, stays, rental terms, charges, payments, allocations and deposit entries. Correct reporting, referential integrity and multi-record financial operations are core requirements.

**Why not default to MongoDB and the MERN stack:** MongoDB can support transactions, but a document-first structure gives no clear advantage for the key workflows and would push more relationship and reporting integrity into application code. This is a domain-fit decision, not a claim that MongoDB cannot be used for financial applications.

**Consequences:**
- Use relational constraints and transactions where appropriate.
- Design indexes from actual queries after the data model is approved.
- Migrations are reviewed in pull requests and tested against a clean PostgreSQL database in CI.
- **Production `db push` and manual schema editing are prohibited.** Schema history must be reproducible from the migration record alone. *(C-06)*
- Do not finalise the domain schema during Milestone 0. Schema implementation begins only after the conceptual model and the business rules for enabled features are approved.
- Row-level security is considered only after the team can safely manage connection context, database roles and policies — see ADR-007.

**Revisit when:** A future workload or data domain has proven document-store needs that justify a separate datastore. PostgreSQL remains the source of truth for financial and occupancy records unless separately approved.

*Version 0.1: this document's ADR-002, extended with the ORM and migration decision.*
```

**Proposed amendments (kept separate; none alters the wording above).**

1. **PostgreSQL major.** "Local development pins PostgreSQL **17**. Maintained-release evidence, 2026-10-29: 17 is supported, current minor 17.11, final release 2029-11-08 (`postgresql.org/support/versioning`). PostgreSQL 18 is also supported and is the newer major. **The final PostgreSQL major is not selected by this approval**; it is decided with `ADR-010` (hosting) and must match the deployed major."
2. **Prisma.** "Prisma and `@prisma/client` `7.10.1`, exact pins. The CLI is always run from the installed pin; the `latest` dist-tag currently points to a release candidate (`8.0.0-rc.28`) and must not be used."
3. **Hosting and region** remain open under `ADR-010`; "managed PostgreSQL" in the source text is an intention, not a selected provider.
4. **No schema before approval.** The source rule "Schema implementation begins only after the conceptual model and the business rules for enabled features are approved" is repeated as a condition and tied to `G-03`.

| Option                                       | Consequence                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recommended: approve with the amendments** | PostgreSQL 17 and Prisma 7.10.1 are the local pins; the deployed major and hosting stay open; no schema until the model is approved               |
| Approve as written                           | The "after checking maintained releases" clause is left unrecorded; the pinned major is unstated                                                  |
| Reject                                       | The package's alternative (MongoDB and the MERN stack) was considered and not defaulted to; a replacement decision is needed before any migration |

**Depends on.** A1. **Unlocks.** The local pin, and (with `G-03`) every later migration.

**What approving gives.** Permission to plan and spike on PostgreSQL 17 and Prisma 7.10.1.
**What must still be verified.** ☑ PostgreSQL 17 is currently supported (until 2029-11-08; third-party page read once). ☐ **Prisma 7.10.1 works against PostgreSQL 17**: not confirmed; the spike (A8) and the project database prove it. ☐ Generator and driver-adapter configuration (`U-26`). ☐ Final PostgreSQL major: **not selected**; needs you and `ADR-010`. ☐ Your row in the package register §4.

**Your response (all unchecked):** ☐ Approve · ☐ Approve with the proposed amendments · ☐ Approve with other changes · ☐ Reject · ☐ Defer
**Changes or conditions:** `____________________` **Owner:** `____________` **Date:** `________` **Reference:** `____________`

---

## A4 — `ADR-011` local development and CI

**Status: `PROPOSED`** (the package's own status: `PROPOSED — approve/amend`). The package records **no alternatives** for this ADR.

**Source wording, retained exactly.**

**Register row, `ADR-011` (verbatim, `10_ARCHITECTURE_APPROVAL_REGISTER.md` §1; the four content cells, one per block)**

_Decision:_

```text
Local development and CI
```

_Proposed default:_

```text
Single repository with a pinned package manager/workspace; pinned supported Node LTS version; Docker Compose PostgreSQL at the same major version chosen for deployed environments; `.env.example` contains placeholders only. CI checks formatting, lint, typecheck, unit/integration tests, build, migration-on-empty-database, dependency review and secret scanning.
```

_Reason / consequences:_

```text
A new developer can reproduce checks from a clean clone. No secrets or real resident data are required.
```

_Status / approval required:_

```text
**PROPOSED — approve/amend**
```

**Narrative (verbatim, `09_ARCHITECTURE_DECISIONS.md`)**

```text
### ADR-011 — Reproducible local development and CI quality gates

**Status:** Proposed
**Decision:** A single repository with a pinned package manager and workspace strategy, a pinned supported Node LTS version, and Docker Compose PostgreSQL at the same major version chosen for deployed environments. `.env.example` contains placeholders only. CI checks formatting, lint, typecheck, unit and integration tests, build, migration against an empty database, dependency review and secret scanning.

**Rationale:** A new developer must reproduce every check from a clean clone. No secrets and no real resident data are required to do so.

**Consequences:** CI uses synthetic values only. No required check may pass by silently skipping tests. This decision is realised by Milestone 0 (`13_MILESTONE_0_PREPARATION_PLAN.md`).

*Version 0.1: no narrative existed in this document.*
```

**Proposed amendments (kept separate; none alters the wording above).**

1. **"Same major version chosen for deployed environments" is provisional.** No deployed major exists (`ADR-010` is `OPEN`), so the clause cannot be checked. Local pin: PostgreSQL 17.
2. **Pinning precision.** `docker-compose.yml` uses the floating tag `postgres:17-alpine`, which changes whenever a new minor is published. Whether "pinned" means a minor-version tag or an image digest is **your** decision when the compose file is next changed (discrepancy `X-9`; also asked on card A5).
3. **CI gaps recorded, not hidden.** Integration tests and a migration-on-empty-database job do not exist and are added when the first migration lands. Dependency review is `npm audit --audit-level=high` only; secret scanning is a four-pattern baseline.
4. **"Realised" claim.** `ADR-011` is not treated as realised until a **hosted CI run on a clean clone** is verified (`G-02`). CI has never been shown to run.
5. **Node.** Node `24.22.1` is pinned and supported (Maintenance LTS since 2026-10-20, end of life 2028-04-30). Node 26 became LTS on 2026-10-28. **No Node change is proposed.**

| Option                                       | Consequence                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Recommended: approve with the amendments** | The target is adopted honestly: the unverifiable clause is marked provisional and the CI gaps are listed |
| Approve as written                           | Commits you to a deployed-version match nobody can verify, and implies CI that has not run               |
| Reject                                       | Local setup and CI conventions need a replacement decision before slice 2.1                              |

**Depends on.** A1 and A3 (the PostgreSQL major). **Unlocks.** The local-development and CI target for slice 2.1.

**What approving gives.** An agreed target for local setup and CI.
**What must still be verified.** ☐ **A hosted CI run passes on a clean clone: not run.** ☐ Integration tests and a migration-on-empty-database job: **do not exist**. ☐ "No required check may pass by silently skipping tests": unverified. ☑ Conformance table of the repository against each element: [in the brief](PHASE_2_DECISION_BRIEF.md#adr-011--local-development-and-ci-status-proposed--approveamend). ☑ Node 24 is a supported LTS. ☐ Your row in the package register §4.

**Your response (all unchecked):** ☐ Approve · ☐ Approve with the proposed amendments · ☐ Approve with other changes · ☐ Reject · ☐ Defer
**Changes or conditions:** `____________________` **Owner:** `____________` **Date:** `________` **Reference:** `____________`

---

## A5 — Isolated Docker PostgreSQL (`U-20`)

**Status: `PROPOSED`.**

**The question.** How does the project get its own PostgreSQL? Today: Docker is stopped; an unrelated PostgreSQL 16 (Homebrew, PID 885) holds port 5432; `docker-compose.yml` has the bare mapping `'5432:5432'`, and `.env.example` and `README.md` also point at 5432.

**Exact wording to approve.** "The project's local PostgreSQL runs from the pinned Docker Compose service on a **loopback-only host port other than 5432**. The existing Homebrew PostgreSQL on port 5432 is never used by this project without the owner's separate written consent. Before any container is started, the explicit checks below pass."

| Option                                                   | Consequence                                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recommended: A. Docker on `127.0.0.1:5433`**           | Matches the pinned compose file and `ADR-011`; isolated from the other server; reproducible. Needs Docker started and disk headroom                                  |
| B. A database and role inside the existing PostgreSQL 16 | No new image, but it touches a server that is not the project's and may hold other data; needs your **explicit consent**; major differs from the pinned compose file |
| C. A second self-managed PostgreSQL 16 on another port   | No Docker, but hand-managed, not reproducible for another developer, and the major differs                                                                           |

**Confirmations asked on this card.**

- ☐ Free-space minimum: **5 GiB** before any Docker start, image pull or install, measured immediately before each action. _(Current reading: 7.5 GiB, two readings.)_
- ☐ Host port: **5433**. _(Nothing listens on it today.)_
- ☐ Image tag precision (`X-9`): ☐ a minor-version tag · ☐ an image digest · ☐ keep `17-alpine` (floating).

**Explicit checks that must pass before a container starts** (from the preflight; none has been run):

| Check                                | Required result                                                                                                                | State today                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Loopback binding                     | Compose mapping names the host address: `127.0.0.1:5433:5432`; `docker compose config` and `docker port` show only `127.0.0.1` | **Not met**: file unchanged, bare `'5432:5432'`   |
| Port is free and not 5432            | Nothing listening on 5433; 5432 never used                                                                                     | 5433 free; 5432 held by PG 16                     |
| Disk-space threshold                 | At least the owner-set minimum, re-measured before each action                                                                 | **Met today** (7.5 GiB against 5 GiB)             |
| Image size known                     | Compressed size recorded; you accept it                                                                                        | ≈109.7 MiB arm64 compressed; uncompressed unknown |
| Existing volumes listed              | `docker volume ls` reviewed before any `down -v`                                                                               | Not checked (daemon stopped)                      |
| No connection to the existing server | Tooling refuses port 5432 and unexpected database names                                                                        | Guard not written; no connection ever made        |

**Depends on.** A4. **Unlocks.** Slice 2.1's database step, together with A6.

**What approving gives.** Permission to edit `docker-compose.yml`, `.env.example` and `README.md` (not edited now) and to start the project's own container once the checks pass.
**What must still be verified.** ☐ The file edit is made **and** `docker compose config` shows loopback. ☐ After start, the socket listens on `127.0.0.1:5433` only and is refused from the LAN address. ☐ `pg_isready -h 127.0.0.1 -p 5433` succeeds and `GET /api/v1/health/database` returns `ok`. ☐ Free space re-measured after the pull. ☐ Volumes reviewed. **None of these is done; approval does not do them.**

**Your response (all unchecked):** ☐ Approve option A · ☐ Approve with changes · ☐ Choose B (consent in writing) · ☐ Choose C · ☐ Reject · ☐ Defer
**Changes or conditions:** `____________________` **Owner:** `____________` **Date:** `________` **Reference:** `____________`

---

## A6 — Minimum new dependencies (`U-22`)

**Status: `PROPOSED`.** Nothing is installed.

**Exact wording to approve.** "The following new dependencies are approved **individually and for installation per slice**, each added with `npm install -w @nook/api --save-exact`, each as its own commit, each followed by `npm audit` and `npm audit signatures`: `@prisma/adapter-pg@7.10.1` (only if the slice 2.1 spike shows it is required); `zod@4.6.7` (when the first request DTO is written); `cookie@2.0.1` (slice 2.3). Re-verify each version from the registry at install time. No other dependency, and no dependency upgrade, is approved."

| Package                     | Registry facts, 2026-10-29 (metadata only)                                                          | When installed                        |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `@prisma/adapter-pg@7.10.1` | Apache-2.0; 4 dependencies (`pg` already installed at 8.16.3); version matches the installed Prisma | Slice 2.1 spike, **only if required** |
| `zod@4.6.7`                 | MIT; 0 dependencies; about 6.1 MB unpacked                                                          | When the first DTO is written (2.3)   |
| `cookie@2.0.1`              | MIT; 0 dependencies; needs Node ≥ 22 (installed 24.22.1)                                            | Slice 2.3                             |

| Option                                                    | Consequence                                                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recommended: the minimal list, installed per slice**    | The tree grows no faster than the current gate needs. Deferred on purpose: `@nestjs/throttler`, an argon2 package, `supertest`, `cookie-parser`, `class-validator`, `class-transformer` |
| Approve with alternatives (for example `class-validator`) | More packages (one last published in 2022); you state the reason                                                                                                                        |
| Defer all                                                 | The spike cannot run (it needs the adapter); slice 2.1 stalls                                                                                                                           |

**Depends on.** A5 (database route) and, for `cookie`, the later sessions decision (`U-01`, not needed now). **Unlocks.** The A8 spike.

**What approving gives.** Permission to install **those named packages, one at a time**, at the stated slice.
**What must still be verified.** ☐ The spike shows the adapter is **required and sufficient**. ☐ After **each** install: `npm audit` reports 0 vulnerabilities, `npm audit signatures` is clean, the lockfile diff contains nothing unrelated, build and typecheck pass, and disk is re-measured. ☑ Registry metadata recorded (it is **not** a security review of the packages).

**Your response (all unchecked):** ☐ Approve the list · ☐ Approve with changes · ☐ Reject · ☐ Defer
**Changes or conditions:** `____________________` **Owner:** `____________` **Date:** `________` **Reference:** `____________`

---

## A7 — Milestone 0 acceptance evidence (`G-02`)

**Status: undecided.**

**The question.** Package document 13 says "M0 is accepted only when **all** applicable items below are evidenced." Milestone 0 is **unaccepted**, and slice 2.1 would produce much of the missing evidence. What do you want to do about that?

**Exact wording to approve (option a).** "Milestone 0's missing acceptance evidence (PostgreSQL health, clean-clone setup, CI on a clean clone, the evidence record `M0-E01…E08`) is gathered **inside slice 2.1**. Milestone 0 remains **unaccepted** until that evidence exists and the owner accepts it."

| Option                                                           | Consequence                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recommended: (a) gather the evidence inside slice 2.1**        | Follows the plan. Slice 2.1 gives M0 its missing evidence. Acceptance still needs your separate decision afterwards                           |
| (b) Waive the requirement in writing                             | Allowed by you, but the package does not describe it as a normal path; later claims (isolation, CI) rest on evidence that was never collected |
| (c) Do not start slice 2.1 until M0 is accepted by another route | There is no other route: the evidence is exactly what slice 2.1 produces, so this stalls the work                                             |

**Depends on.** A4 (the CI target). **Unlocks.** Starting slice 2.1 with a defined evidence obligation.

**What choosing gives.** A recorded rule for how the gap is handled.
**What must still be verified (M0 evidence, none filled):** ☐ `M0-E01` clean-clone setup · ☐ `M0-E02` PostgreSQL healthy · ☐ `M0-E03`–`E05` format/lint/typecheck/build, unit and integration smoke tests, secret and dependency scans **in CI** · ☐ `M0-E06` clean migration baseline (only if a baseline is approved) · ☐ `M0-E07` two-developer reproducibility · ☐ `M0-E08` no real data and no production deployment (a review, not just a scan). **Only 3 of 11 acceptance criteria are met today** (pinned toolchain; no billing or finance code; no schema without approval).

**Your response (all unchecked):** ☐ (a) gather inside slice 2.1 · ☐ (b) waive in writing · ☐ (c) hold slice 2.1 · ☐ Defer
**Changes or conditions:** `____________________` **Owner:** `____________` **Date:** `________` **Reference:** `____________`

---

## A8 — Prisma compatibility spike authorisation (`U-26`)

**Status: not given.**

**The question.** May a **throwaway** experiment, outside the repository, test whether the Prisma setup this plan needs actually works? Today `schema.prisma` names the `prisma-client-js` generator, the installed 7.10.1 CLI's own templates use `prisma-client`, no client is generated and no driver adapter is installed.

**Exact wording to approve.** "A Prisma compatibility spike is authorised, in a **throwaway directory outside the repository** at the location confirmed below. It installs exact pins only (`prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.16.3`), tests both generators and the composite-foreign-key pattern **without a database**, and records the result. It does not touch the repository, its manifests or lockfile; it does not connect to any database, including the PostgreSQL 16 on port 5432; it starts no container. Free space is at least 5 GiB immediately before it starts."

**Confirmation asked.** Spike location (a proposal; change it if you prefer): `/Users/atharva/nook-phase2-spike/` ☐ confirm · ☐ use: `____________________`

**The seven steps** (full protocol in the [preflight, section D](PHASE_2_SLICE_2_1_PREFLIGHT.md#preflight-d--prisma-adapter-approval-and-the-compatibility-spike)): check free space → install exact pins in the throwaway directory → write a scratch schema with overlapping `organization_id` composite keys → `prisma validate` and generate with **each** generator → generate migration SQL with no database → import and typecheck the client with the adapter, unconnected → record the result and leave the directory in place.

| Option                                | Consequence                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recommended: authorise as written** | The generator and adapter choices are decided from evidence before any schema is written                                                        |
| Authorise with changes                | You change the location, versions or scope; the checks stay                                                                                     |
| Defer the spike                       | The data model's composite-key pattern and the generator choice stay **untested**; later work may hit a failure after schema decisions are made |

**Depends on.** **A6 approved first** (the spike installs `@prisma/adapter-pg`; discrepancy `X-3`), A3 (the Prisma pin) and the disk minimum. **Unlocks.** The `U-26` decision and the adapter-required answer.

**What authorising gives.** Permission to run **only** the spike as written.
**What must still be verified (the spike itself):** ☐ Generator choice works (`V-4`). ☐ Overlapping composite keys are emitted correctly (`V-1`). ☐ The client imports and constructs with the adapter. A **failed** spike is a valid result; it changes the data model, not the schedule.
**What the spike cannot verify (needs the project's own database):** that PostgreSQL **rejects** a cross-tenant insert (`V-2`), that partial indexes, `CHECK`s and the audit trigger survive migration (`V-3`), and that the application role cannot alter audit rows (`V-7`).

**Your response (all unchecked):** ☐ Authorise as written · ☐ Authorise with changes · ☐ Defer · ☐ Refuse
**Changes or conditions:** `____________________` **Owner:** `____________` **Date:** `________` **Reference:** `____________`

---

## What approving all eight does, and does not do

| Approving all eight **gives**                                                                                          | Approving all eight **does not**                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Permission to start **slice 2.1**, which writes **no schema and no migration**                                         | Approve the data model (`G-03`), roles (`G-06`), bed-status meaning (`U-13`) or any business rule                     |
| A fixed requirements text, a PostgreSQL 17 local pin, a loopback database route, a minimal dependency list and a spike | Decide sessions (`U-01`), the scope-guard replacement (`U-27`) or the 2D map (`G-04`)                                 |
| A defined way to handle the Milestone 0 gap                                                                            | **Verify** any of it. Disk, loopback, CI, the spike, `npm audit` and the M0 evidence are all **still to be produced** |

**Still open and independent of these eight:** the preflight's other blockers, notably the **11 tracked discrepancies** (none reconciled; five block slice 2.1: `X-1`, `X-2`, `X-3`, `X-5`, `X-9`). Several are resolved by your answers here: `X-1`/`X-2`/`X-3` by A7, A8 and the A6-before-A8 order, `X-5` and `X-9` by A5. Resolving them also needs the affected source documents updated or annotated in a **later, separately approved** change. Until then the preflight stays **NO-GO**.

## After you reply

1. I record each decision **exactly as you state it** in a new decision log, leaving the existing decision records unchanged. Anything you leave blank stays `PROPOSED`.
2. I re-run the preflight to show what has changed, and I stop again. **A reply does not start slice 2.1.** Starting needs the preflight to pass and a separate instruction from you.
3. Nothing is installed, started, connected to, staged, committed or pushed unless you separately instruct it.

## Unresolved decisions

All eight inputs. Also open and not needed for slice 2.1: `G-03`, `G-05`, `G-06`, `U-01`…`U-19` (except `U-20`, `U-22`, `U-26` here), `U-21`, `U-24`, `U-25`, `U-27` and `G-04`. See [the register](PHASE_2_UNRESOLVED_DECISIONS.md).

## Validation still required

| #   | Claim                                                                      | Status                                                                                                              |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| S-1 | The quoted ADR wording equals the canonical source character for character | **Checked** by exact-match script when generated (15 blocks)                                                        |
| S-2 | Every decision in this worksheet is unapproved                             | **True by construction**; no box is checked                                                                         |
| S-3 | No existing decision record or protected file changed                      | **Checked** by SHA-256 before and after writing; the result is stated in the report that accompanies this worksheet |
| S-4 | Free space meets the 5 GiB minimum for each later action                   | Measured at generation (7.5 GiB); **re-measure before each action**                                                 |
| S-5 | Mermaid diagrams render                                                    | None in this document                                                                                               |

## Revision history

| Version | Date       | Change                                                                                   |
| ------- | ---------- | ---------------------------------------------------------------------------------------- |
| 0.1     | 2026-10-29 | Initial worksheet. All eight inputs, all unchecked. No existing decision record changed. |
