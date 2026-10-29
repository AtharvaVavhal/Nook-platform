# Phase 2 — Decision Log

**What this is:** the record of the decisions the owner explicitly supplied on **2026-10-29**. It records **only** what was stated. Anything not stated stays `PROPOSED` in [the owner decision register](PHASE_2_OWNER_DECISION_REGISTER.md).
**Decision owner, as stated by the owner:** `AtharvaVavhal`. **Date:** 2026-10-29. **Reference:** "chat reply" (the owner's own wording). This log cannot verify who is at the keyboard; it records the owner's statement.
**Source of the decisions:** the owner's pasted "OWNER DECISION DRAFT" (below, verbatim) and the owner's four follow-up answers (below). The owner chose "**Yes, final — record all as written**".
**Existing decision records are unchanged.** `PHASE_2_OWNER_DECISION_REGISTER.md`, `PHASE_2_OWNER_APPROVAL_WORKSHEET.md` and the others still show `PROPOSED` and an unchecked worksheet **because they were written before the decisions and were deliberately not edited**. For the eight inputs below, **this log is later and controls their status.** The ADR wording quoted in those records is untouched.

Status words: `APPROVED` means the owner accepted the **proposal**. It does **not** mean the thing is built, configured or **verified**. The remaining verification for each is listed.

## Confirmed existing decisions (recorded on 2026-10-29)

| #   | Input                              | Owner's response, verbatim                                                           | Recorded status                               | Conditions the owner attached                                                        | Verification still required (none of it is done by this record)                                                                                             |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `U-23` canonical package           | "Approve v0.2 as canonical"                                                          | **APPROVED**                                  | None                                                                                 | Owner confirms review of v0.2 (`W-1`); re-hash at sign-off                                                                                                  |
| A2  | `ADR-001` backend architecture     | "Approve with the proposed amendment"                                                | **APPROVED** with the amendment in §3         | The scope condition: direction only; Phase 2 builds only access, inventory and audit | Later slices build and test the modules                                                                                                                     |
| A3  | `ADR-003` database and ORM         | "Approve with the proposed amendments, subject to Prisma compatibility verification" | **APPROVED** with amendments 1–4 in §3        | **Subject to Prisma compatibility verification**                                     | Prisma 7.10.1 against PostgreSQL 17 (the spike and the project database); generator and adapter (`U-26`); final PostgreSQL major not selected               |
| A4  | `ADR-011` local development and CI | "Approve with the proposed amendments"                                               | **APPROVED** with amendments 1–5 in §3        | None beyond the amendments                                                           | A hosted CI run on a clean clone; integration and migration-on-empty-database jobs                                                                          |
| A5  | `U-20` isolated Docker PostgreSQL  | "Approve option A, subject to all isolation and disk checks"                         | **APPROVED** (option A)                       | **Subject to all isolation and disk checks**                                         | Loopback binding verified after the compose edit; port other than 5432; volumes reviewed; free space re-measured before each action; health through the API |
| A6  | `U-22` dependencies                | "Approve the proposed list; adapter conditional on spike results"                    | **APPROVED** (list)                           | **`@prisma/adapter-pg` is conditional on the spike results**                         | Per install: `npm audit`, `npm audit signatures`, lockfile diff, build and typecheck. The spike must show the adapter is required                           |
| A7  | `G-02` Milestone 0 evidence        | "(a) Gather missing evidence; do not waive acceptance criteria"                      | **APPROVED** (option a)                       | **No waiver of any acceptance criterion**                                            | The evidence itself (`M0-E01…E08`); Milestone 0 stays **unaccepted** until it exists                                                                        |
| A8  | `U-26` spike authorisation         | "Authorise the isolated spike subject to A3, A6 and disk gates"                      | **APPROVED** (authorisation to run the spike) | **Subject to A3, A6 and the disk gate**                                              | The spike itself, run and recorded. A failed spike is a valid result                                                                                        |

Four confirmations, verbatim:

| #   | Confirmation        | Owner's response, verbatim          | Recorded as                                                                                                                                                                                                             |
| --- | ------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Minimum free space  | "5 GiB"                             | At least **5 GiB** free on `/System/Volumes/Data`, measured immediately before each Docker start, image pull or install                                                                                                 |
| C2  | Local database port | "5433 on 127.0.0.1 only"            | Host port **5433**, bound to **`127.0.0.1` only**                                                                                                                                                                       |
| C3  | Image-tag precision | "Minor-version tag"                 | A **minor-version tag** (not a digest, not the floating `17-alpine`). **The exact tag was not specified and is not chosen here.** It is selected, and verified to exist, when the compose edit is separately authorised |
| C4  | Spike directory     | "/Users/atharva/nook-phase2-spike/" | `/Users/atharva/nook-phase2-spike/`, outside the repository                                                                                                                                                             |

ADR register: "Explicitly authorised to fill the three ADR rows after verifying each approval." Additional conditions: "None specified".

## The owner's draft, verbatim

```text
OWNER DECISION DRAFT — REVIEW BEFORE SUBMITTING
Owner: [ENTER OWNER NAME]
Date: 2026-10-29

A1: Approve v0.2 as canonical | owner: [OWNER] | date: 2026-10-29 | ref: chat reply
A2: Approve with the proposed amendment | owner: [OWNER] | date: 2026-10-29 | ref: chat reply
A3: Approve with the proposed amendments, subject to Prisma compatibility verification | owner: [OWNER] | date: 2026-10-29 | ref: chat reply
A4: Approve with the proposed amendments | owner: [OWNER] | date: 2026-10-29 | ref: chat reply
A5: Approve option A, subject to all isolation and disk checks | owner: [OWNER] | date: 2026-10-29 | ref: chat reply
A6: Approve the proposed list; adapter conditional on spike results | owner: [OWNER] | date: 2026-10-29 | ref: chat reply
A7: (a) Gather missing evidence; do not waive acceptance criteria | owner: [OWNER] | date: 2026-10-29 | ref: chat reply
A8: Authorise the isolated spike subject to A3, A6 and disk gates | owner: [OWNER] | date: 2026-10-29 | ref: chat reply
C1: 5 GiB
C2: 5433 on 127.0.0.1 only
C3: Minor-version tag
C4: /Users/atharva/nook-phase2-spike/
ADR register: Explicitly authorised to fill the three ADR rows after verifying each approval.
Additional conditions: None specified

IMPORTANT: This is a proposed decision draft. Review every line and explicitly approve it before sending to Claude Code.
```

The draft's `[OWNER]` and `[ENTER OWNER NAME]` placeholders were unfilled. The owner resolved them in the answers below.

## 2. The owner's four follow-up answers

| Question asked                                                                          | Owner's answer                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the draft the explicit, final approval, to be recorded exactly as written?           | "**Yes, final — record all as written**"                                                                                                                                                                                                                        |
| Which name should be recorded as decision owner?                                        | "**AtharvaVavhal**"                                                                                                                                                                                                                                             |
| If a conditional approval's spike or gate fails later, what happens to those approvals? | "**Approvals stand; failure reopens only that decision.**" The approval stays `APPROVED` with its condition; a failed verification marks the condition **unmet** and returns **only the affected decision** to the owner. **Nothing proceeds on it meanwhile.** |
| What should be verified before the three ADR rows are filled?                           | "**Only that each ADR approval is explicit here and matches the worksheet**". Implementation verification stays on the preflight                                                                                                                                |

## 3. Approved amendments (kept separate from the quoted ADR wording)

The original ADR wording is **not reproduced or altered here**. It is in `~/Downloads/NIVASA_PACKAGE_v0.2/10_ARCHITECTURE_APPROVAL_REGISTER.md` §1 and `09_ARCHITECTURE_DECISIONS.md`, and verbatim in the [worksheet](PHASE_2_OWNER_APPROVAL_WORKSHEET.md) (SHA-256 `1a72355414a47b2491bc877fb723b7a8851ec9ecc26c5ba9f448651bf3d7ec4a`). The amendments the owner approved are the following, copied exactly from the worksheet.

### `ADR-001` (A2)

**Proposed amendment (kept separate; it does not alter the wording above).** "`ADR-001` approved as written in `10_ARCHITECTURE_APPROVAL_REGISTER.md` v0.3. **Condition:** this approval authorises the architectural direction only. Phase 2 builds only the access, inventory and audit modules. Residents and stays, finance, deposits, reports and documents, named in the narrative, are **not** authorised by this approval."

### `ADR-003` (A3)

**Proposed amendments (kept separate; none alters the wording above).**

1. **PostgreSQL major.** "Local development pins PostgreSQL **17**. Maintained-release evidence, 2026-10-29: 17 is supported, current minor 17.11, final release 2029-11-08 (`postgresql.org/support/versioning`). PostgreSQL 18 is also supported and is the newer major. **The final PostgreSQL major is not selected by this approval**; it is decided with `ADR-010` (hosting) and must match the deployed major."
2. **Prisma.** "Prisma and `@prisma/client` `7.10.1`, exact pins. The CLI is always run from the installed pin; the `latest` dist-tag currently points to a release candidate (`8.0.0-rc.28`) and must not be used."
3. **Hosting and region** remain open under `ADR-010`; "managed PostgreSQL" in the source text is an intention, not a selected provider.
4. **No schema before approval.** The source rule "Schema implementation begins only after the conceptual model and the business rules for enabled features are approved" is repeated as a condition and tied to `G-03`.

**Owner condition on A3:** "subject to Prisma compatibility verification". Prisma 7.10.1 against PostgreSQL 17 is **not yet verified**.

### `ADR-011` (A4)

**Proposed amendments (kept separate; none alters the wording above).**

1. **"Same major version chosen for deployed environments" is provisional.** No deployed major exists (`ADR-010` is `OPEN`), so the clause cannot be checked. Local pin: PostgreSQL 17.
2. **Pinning precision.** `docker-compose.yml` uses the floating tag `postgres:17-alpine`, which changes whenever a new minor is published. Whether "pinned" means a minor-version tag or an image digest is **your** decision when the compose file is next changed (discrepancy `X-9`; also asked on card A5).
3. **CI gaps recorded, not hidden.** Integration tests and a migration-on-empty-database job do not exist and are added when the first migration lands. Dependency review is `npm audit --audit-level=high` only; secret scanning is a four-pattern baseline.
4. **"Realised" claim.** `ADR-011` is not treated as realised until a **hosted CI run on a clean clone** is verified (`G-02`). CI has never been shown to run.
5. **Node.** Node `24.22.1` is pinned and supported (Maintenance LTS since 2026-10-20, end of life 2028-04-30). Node 26 became LTS on 2026-10-28. **No Node change is proposed.**

## 4. ADR rows in the canonical approval register

The owner authorised filling the three ADR rows after verifying that each approval is explicit and matches the worksheet. **Verified:** A2, A3 and A4 are each stated explicitly by the owner, with the amendments named in the worksheet. The rows below were written to `~/Downloads/NIVASA_PACKAGE_v0.2/10_ARCHITECTURE_APPROVAL_REGISTER.md` §4 and **nowhere else in that file**.

| Item                              | Value                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| File SHA-256 before the edit      | `55b18f67fdcee1ce618371090ccc0dd4d0aea38fd92cac0121eb6777e10163f6`                   |
| File SHA-256 after the edit       | `75c0f8d705702b3c3a0959ff78bd74ec07a5368ee01198e751aa3336d0707c5a`                   |
| Rows filled                       | `ADR-001`, `ADR-003`, `ADR-011` (the other 14 rows are untouched and blank)          |
| ADR wording in §1 and document 09 | Unchanged (re-checked by exact match; see the verification note in the final report) |

The earlier recorded hash of this file (`55b18f67…`, in the comparison and worksheet) is the **pre-edit** value and is superseded by the "after" hash above for this file only.

## 4A. Second batch, 2026-10-29

**Owner:** `AtharvaVavhal`. **Date:** 2026-10-29. **Reference:** chat reply "proceed", then the owner's explicit answer **"Yes: approve all recommended, install, and commit"** to this confirmation question: "Does 'proceed' mean you approve all my recommended options (1A D-2 sessions+CSRF, 2A D-3 minimal 9-table model with OWNER and PROPERTY_MANAGER, 3A D-4 allow-list guard S1-S14, 4A prisma-client) AND authorise the adapter install and committing the four reviewed boundaries (never a push)?"

| #   | Decision                                    | Recorded status | What was approved (the recommended option as presented)                                                                                                                                                                                                                                                                                                                                  | Verification still required (none done by this record)                                                                                                     |
| --- | ------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1A  | `D-2` authentication (`U-01`–`U-04`)        | **APPROVED**    | Server-side opaque sessions in an `HttpOnly` cookie with CSRF protection (token plus `Origin` check on every state-changing request); `node:crypto` scrypt passwords; email login; account recovery blocked; idle expiry 30 minutes and absolute expiry 8 hours; local use only, no shared environment. **No JWT.**                                                                      | Slice 2.3 not started. `U-05` (MFA) and `U-06` (rate limits) stay deferred to before any shared environment. Nothing authenticates anyone today            |
| 2A  | `D-3` data model and roles (`G-03`, `U-07`) | **APPROVED**    | Minimal 9-table model: organisations, users, memberships, sessions, audit events, properties, floors, rooms, beds; composite tenant keys with `onUpdate` and `onDelete` `Restrict`; roles `OWNER` and `PROPERTY_MANAGER` only, everything else denied; beds `IN_SERVICE` or `OUT_OF_SERVICE` only; soft archive only; **no layout tables**, so the floor plan stays on labelled fixtures | No schema or migration exists. The scope guard (3A) must be committed **before** any model. Cross-tenant rejection on live PostgreSQL 17 is not yet proven |
| 3A  | `D-4` scope-guard replacement (`U-27`)      | **APPROVED**    | The tested, CI-enforced allow-list guard, rules S1–S14, committed before any model. CI runs the guard's self-tests first. The legacy guard keeps running until the first migration commit, is never edited, and edits to it or its removal are detected (S13, S14)                                                                                                                       | Not written. Hosted CI cannot be verified without a push                                                                                                   |
| 4A  | `U-26` Prisma generator                     | **APPROVED**    | `prisma-client` with an explicit output under `apps/api/src/generated/`                                                                                                                                                                                                                                                                                                                  | Whether the generated code compiles inside `apps/api`'s own `tsc` build is not yet run                                                                     |

**Also authorised, in the same answer:**

- **Adapter install:** the exact-pinned `@prisma/adapter-pg@7.10.1` and its required dependencies, using `npm install -w @nook/api --save-exact`, **only when free disk is at least 5 GiB**, followed by a lockfile review, the relevant checks and an audit. Not yet installed (disk 4.93 GiB at last reading).
- **Commits:** staging and committing the four reviewed slice 2.1 boundaries in the order 1, 2, 3, 4. **No push, ever, without a separate instruction.** `marketing/` and the handbook folder stay out of every commit.

**Not authorised by this batch:** starting slice 2.2 implementation, any production schema or migration, Docker start (still gated by disk and the owner's administrator prompt), running SQL against any database, a push.

## 5. Still `PROPOSED`, not decided by the owner

**Superseded in part by §4A:** `U-01`–`U-04`, `G-03`, `U-07`, `U-26` and `U-27` were approved on 2026-10-29. The remainder below is still **`PROPOSED`**. Originally written as: "Not part of the eight inputs, so **unchanged**:" `U-01` (sessions), `U-27` (scope-guard replacement), `G-04` (2D map scope), `G-03` (conceptual model), `G-05`, `G-06`, and the open `U-xx` list in [the register](PHASE_2_UNRESOLVED_DECISIONS.md).

## 6. Effect on the 11 tracked discrepancies

The owner's answers settle the **substance** of five blocking discrepancies. **None is reconciled** by the strict definition (the affected source documents are not yet annotated). This log does not edit those documents.

| Discrepancy                                | Settled by                                                                                                   | Reconciliation still pending                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `X-1`, `X-2`, `X-3`                        | A7 (gather evidence in slice 2.1), A8 (spike authorised, conditions A3 and A6), A6 approved before the spike | Annotate the plan and brief wording                           |
| `X-5`                                      | A5 and C2 (loopback `127.0.0.1` only, port 5433)                                                             | Update `U-20` and security finding `S-03`                     |
| `X-9`                                      | C3 (a minor-version tag)                                                                                     | Exact tag still to be chosen and verified at the compose edit |
| `X-4`, `X-6`, `X-7`, `X-8`, `X-10`, `X-11` | Not addressed by these decisions                                                                             | Open                                                          |

## Unresolved decisions

Everything in §5, plus the exact image tag (C3 remainder). See [the register](PHASE_2_UNRESOLVED_DECISIONS.md).

## Validation still required

| #   | Claim                                                         | Status                                                    |
| --- | ------------------------------------------------------------- | --------------------------------------------------------- |
| L-1 | The owner's verbatim text above matches what was received     | Copied from the received message                          |
| L-2 | The three register rows contain only what the owner approved  | Verified when written (see final report)                  |
| L-3 | Nothing in this log is read as verification of implementation | By construction; every row lists what is still unverified |

## Revision history

| Version | Date       | Change                                                                                            |
| ------- | ---------- | ------------------------------------------------------------------------------------------------- |
| 0.1     | 2026-10-29 | Initial log: eight inputs, four confirmations and register authorisation, as stated by the owner. |
