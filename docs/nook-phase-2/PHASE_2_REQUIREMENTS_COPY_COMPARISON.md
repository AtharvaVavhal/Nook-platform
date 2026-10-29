# Phase 2 — Requirements Package Copy Comparison

**Status:** Evidence report for decision `U-23`. Prepared 2026-10-29. **Read-only:** no copy was opened for writing, overwritten, renamed, moved or deleted, and nothing was extracted or installed.
**Companions:** [Decision brief](PHASE_2_DECISION_BRIEF.md) · [Unresolved decisions](PHASE_2_UNRESOLVED_DECISIONS.md) · [Implementation plan](PHASE_2_IMPLEMENTATION_PLAN.md)

Identifiers `G-xx`, `U-xx` and `K-x` are defined in [the register](PHASE_2_UNRESOLVED_DECISIONS.md).

## Confirmed existing decisions

| Fact                                                                                                                                                                                                                                            | Source                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| No copy records any approval. In **both** the old and the new copy, every row of the architecture approval record is blank, the owner sign-off checklist has **0** ticked items, and (v0.2) the corrections disposition table has **0** values. | Counted directly from files A and B (method below)                                            |
| The handbook's own verification script reads its source register from `…/Downloads/NIVASA_PACKAGE_v0.2/02_BUSINESS_RULES_REGISTER.md`, and the handbook appendices say they are reproduced from "requirements package v0.2".                    | `verify.py` line 253 and `make_appendices.py`, inside `Nook_Complete_Project_Handbook_v1.zip` |
| v0.2 describes itself as **"Proposed; not approved for implementation"**. The handbook calls the same package "approved". The two statements conflict.                                                                                          | `NIVASA_PACKAGE_v0.2/README.md` against the handbook appendix text                            |

## Method

For every Markdown file in the three locations: SHA-256 of the bytes, size, line count, filesystem birth and modification time, and the document's own `Version` and `Status` header lines. Markdown carries **no embedded author or revision metadata**, so "document metadata" here means those header lines plus filesystem times. Differences between same-named files are summarised with line similarity (Python `difflib`), heading additions and removals, and three identifier-integrity checks (ADR numbers, `BR-*` numbers, gate numbers).

| Label | Location                           | Contents                                                                                                           |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **A** | `~/Documents/Nook/`                | 13 files: documents 01–12 and `README (2).md`. Directory created 2026-10-26 13:09, last modified 2026-10-27 11:15. |
| **B** | `~/Downloads/NIVASA_PACKAGE_v0.2/` | **16** files: documents 01–14, `DOCUMENTATION_REVISION_REPORT.md`, `README.md`. All created 2026-10-27 09:15.      |
| **C** | `~/Downloads/` (loose)             | 15 files: documents 01–14 and `README (2).md`.                                                                     |

**Excluded as unrelated:** `README.md` in `~/Downloads/` (a Vishwakarma Institute project), `README_1.md` and `README_2.md` (a PrintForge reel), and the Nook zips (`nook-complete*.zip`, `nook-brand-assets.zip`, `nook-platform-m0-scaffold.zip`). The zip listings were read without extracting; none contains the requirements documents.

## Proposed architecture

This report proposes no architecture. Its recommendation is a **provenance decision**, in [the next section](#recommendation).

## Findings

### F1. Copies A and C are the same set, byte for byte

For all 13 files present in A (documents 01–12 and `README (2).md`), the matching file in C has an **identical SHA-256**. A and C are one logical version stored twice. Creation times match too (documents 01–09 at 2026-10-26 13:10, documents 10–12 at 14:21).

### F2. Copy B is a later, different, and the only complete set

B differs from A in **all 12 shared files** and adds documents 13 and 14, a revision report and a v0.2 README. B's headers read: documents 01 and 02–09 `0.2`, documents 10–14 `0.3`, README `0.2`. A and C carry the v0.1 labelling (`0.1 for review`, with documents 10–12 as a `0.2 review addendum`).

### F3. The loose documents 13 and 14 match neither A nor B

Documents 13 and 14 exist only in B and C. The C versions are **earlier drafts** of B's: created 2026-10-27 08:41:19, against B's 09:15:33. They lack B's `Changes in this revision` and `Revision history` sections and are 86% and 58% similar to B's by line. Copy A has no document 13 or 14 at all.

### F4. The older set is internally inconsistent in ways that can mislead a sign-off

| Problem in A and C (v0.1)                                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                | Fixed in B by                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **`ADR-*` numbers name different decisions in different documents.** Document 09's `ADR-003` is "Use NestJS and TypeScript for the API" while document 10's `ADR-003` is "Primary database and ORM". Likewise `ADR-001` (modular monolith versus backend architecture), `ADR-002` (PostgreSQL versus MongoDB, against Frontend) and `ADR-011` (defer operations modules, against Local development and CI). | Heading and table text of A's documents 09 and 10                       | Correction `C-13`: document 10's numbering is canonical; document 09 carries a mapping table |
| **The sign-off checklist cites 21 `BR-*` identifiers its own register does not define** (for example `BR-ALLOC-001…005`). A signature against such an ID resolves no defined rule.                                                                                                                                                                                                                          | A's `11_…` against A's `02_…`                                           | Correction `C-17`. B has **0** undefined identifiers (75 cited, all defined)                 |
| **Gate identifiers collide.** Documents 01 and 07 use bare `G0…G5` / `G0…G4` for different gates, and correction `C-14` records that document 13 did the same.                                                                                                                                                                                                                                              | Documents 01 and 07 in A (document 13 per `C-14`)                       | Correction `C-14`: release gates are `RG-0…RG-5`, Milestone 0 gates are `M0-G0…G2`           |
| **Session mechanism is "evaluated, not selected".**                                                                                                                                                                                                                                                                                                                                                         | A's `05_…` §3: "…or another explicitly selected session/token strategy" | Correction `C-02`. Note that A's own register already proposes opaque sessions in `ADR-004`  |
| Decision count: A's register lists `ADR-001…014`, B's lists `ADR-001…017`.                                                                                                                                                                                                                                                                                                                                  | Both registers                                                          | `C-13` added `ADR-015…017`                                                                   |

**Consequence:** approving "`ADR-003`" against the A or C copy is ambiguous, because two different documents in the same copy give that ID two meanings.

### F5. File-by-file summary

`A = C` means identical SHA-256. The first eight hexadecimal characters identify a file; the full 64-character hashes are in the [appendix](#appendix--full-sha-256-hashes).

| File                                           | A Documents/Nook             | B NIVASA_PACKAGE_v0.2        | C Downloads (loose)          | Relationship             |
| ---------------------------------------------- | ---------------------------- | ---------------------------- | ---------------------------- | ------------------------ |
| `01_PRD.md`                                    | `8bfe7ef1` · 25.5 KB · 358 L | `62acc34b` · 36.8 KB · 426 L | `8bfe7ef1` · 25.5 KB · 358 L | A = C (identical); A ≠ B |
| `02_BUSINESS_RULES_REGISTER.md`                | `e30adfd3` · 14.0 KB · 137 L | `e5b51b3b` · 30.1 KB · 271 L | `e30adfd3` · 14.0 KB · 137 L | A = C (identical); A ≠ B |
| `03_DOMAIN_AND_DATA_MODEL.md`                  | `c4682a86` · 19.0 KB · 291 L | `452889e8` · 26.0 KB · 336 L | `c4682a86` · 19.0 KB · 291 L | A = C (identical); A ≠ B |
| `04_API_SPECIFICATION.md`                      | `8961995f` · 17.4 KB · 202 L | `72b18e68` · 25.6 KB · 248 L | `8961995f` · 17.4 KB · 202 L | A = C (identical); A ≠ B |
| `05_SECURITY_ARCHITECTURE.md`                  | `cb13799f` · 13.4 KB · 193 L | `feef5c3b` · 21.8 KB · 274 L | `cb13799f` · 13.4 KB · 193 L | A = C (identical); A ≠ B |
| `06_FRONTEND_INFORMATION_ARCHITECTURE.md`      | `3a730a44` · 13.1 KB · 191 L | `5da5760d` · 19.1 KB · 243 L | `3a730a44` · 13.1 KB · 191 L | A = C (identical); A ≠ B |
| `07_30_DAY_DELIVERY_BACKLOG.md`                | `bd0fc76c` · 13.0 KB · 144 L | `5c1e7b26` · 22.7 KB · 212 L | `bd0fc76c` · 13.0 KB · 144 L | A = C (identical); A ≠ B |
| `08_TESTING_AND_MIGRATION_PLAN.md`             | `6c5f7d19` · 14.5 KB · 261 L | `49384a41` · 23.8 KB · 319 L | `6c5f7d19` · 14.5 KB · 261 L | A = C (identical); A ≠ B |
| `09_ARCHITECTURE_DECISIONS.md`                 | `3901aef1` · 9.0 KB · 138 L  | `8b781571` · 27.3 KB · 294 L | `3901aef1` · 9.0 KB · 138 L  | A = C (identical); A ≠ B |
| `10_ARCHITECTURE_APPROVAL_REGISTER.md`         | `ef022e4e` · 12.5 KB · 85 L  | `55b18f67` · 19.2 KB · 129 L | `ef022e4e` · 12.5 KB · 85 L  | A = C (identical); A ≠ B |
| `11_OWNER_BUSINESS_RULES_SIGNOFF_CHECKLIST.md` | `828c7c81` · 11.6 KB · 110 L | `0039645b` · 18.6 KB · 177 L | `828c7c81` · 11.6 KB · 110 L | A = C (identical); A ≠ B |
| `12_CROSS_DOCUMENT_CORRECTIONS.md`             | `7660d244` · 11.7 KB · 119 L | `1f830aa0` · 26.5 KB · 315 L | `7660d244` · 11.7 KB · 119 L | A = C (identical); A ≠ B |
| `13_MILESTONE_0_PREPARATION_PLAN.md`           | —                            | `f25ca259` · 13.8 KB · 148 L | `2508eae9` · 11.9 KB · 124 L | B ≠ C                    |
| `14_UNRESOLVED_ITEM_BLOCKER_CLASSIFICATION.md` | —                            | `eaffae51` · 11.6 KB · 86 L  | `0b70bf94` · 9.5 KB · 63 L   | B ≠ C                    |
| `DOCUMENTATION_REVISION_REPORT.md`             | —                            | `de31905d` · 17.9 KB · 175 L | —                            | B only                   |
| `README (2).md`                                | `13a24f95` · 3.3 KB · 46 L   | —                            | `13a24f95` · 3.3 KB · 46 L   | A = C (identical)        |
| `README.md`                                    | —                            | `1a3c648b` · 9.1 KB · 107 L  | —                            | B only                   |

### F6. What changed between A and B

| File                                           | Lines A → B | Size A → B        | Line similarity | Headings A → B (added / removed) | B's declared version                   |
| ---------------------------------------------- | ----------- | ----------------- | --------------- | -------------------------------- | -------------------------------------- |
| `01_PRD.md`                                    | 358 → 426   | 25.5 KB → 36.8 KB | 77%             | 36 → 38 (+12 / −10)              | 0.2 for review                         |
| `02_BUSINESS_RULES_REGISTER.md`                | 137 → 271   | 14.0 KB → 30.1 KB | 32%             | 10 → 14 (+11 / −7)               | 0.2                                    |
| `03_DOMAIN_AND_DATA_MODEL.md`                  | 291 → 336   | 19.0 KB → 26.0 KB | 76%             | 32 → 34 (+2 / −0)                | 0.2                                    |
| `04_API_SPECIFICATION.md`                      | 202 → 248   | 17.4 KB → 25.6 KB | 51%             | 15 → 18 (+4 / −1)                | 0.2                                    |
| `05_SECURITY_ARCHITECTURE.md`                  | 193 → 274   | 13.4 KB → 21.8 KB | 55%             | 17 → 21 (+7 / −3)                | 0.2                                    |
| `06_FRONTEND_INFORMATION_ARCHITECTURE.md`      | 191 → 243   | 13.1 KB → 19.1 KB | 60%             | 26 → 29 (+4 / −1)                | 0.2                                    |
| `07_30_DAY_DELIVERY_BACKLOG.md`                | 144 → 212   | 13.0 KB → 22.7 KB | 26%             | 15 → 18 (+14 / −11)              | 0.2                                    |
| `08_TESTING_AND_MIGRATION_PLAN.md`             | 261 → 319   | 14.5 KB → 23.8 KB | 48%             | 24 → 27 (+5 / −2)                | 0.2                                    |
| `09_ARCHITECTURE_DECISIONS.md`                 | 138 → 294   | 9.0 KB → 27.3 KB  | 32%             | 14 → 24 (+22 / −12)              | 0.2                                    |
| `10_ARCHITECTURE_APPROVAL_REGISTER.md`         | 85 → 129    | 12.5 KB → 19.2 KB | 44%             | 6 → 9 (+3 / −0)                  | 0.3 (coordinated consistency revision) |
| `11_OWNER_BUSINESS_RULES_SIGNOFF_CHECKLIST.md` | 110 → 177   | 11.6 KB → 18.6 KB | 53%             | 10 → 13 (+3 / −0)                | 0.3 (coordinated consistency revision) |
| `12_CROSS_DOCUMENT_CORRECTIONS.md`             | 119 → 315   | 11.7 KB → 26.5 KB | 34%             | 15 → 25 (+12 / −2)               | 0.3 (coordinated consistency revision) |

The low similarity of documents 02, 07, 09 and 12 reflects restructuring (identifier renumbering, new sections), not only additions. The authoritative description of what changed and why is `DOCUMENTATION_REVISION_REPORT.md` and `12_CROSS_DOCUMENT_CORRECTIONS.md` in B.

#### Loose documents 13 and 14 against B

| File                                           | Lines C → B | Size C → B        | Line similarity | Headings only in B                             | Hashes C → B            |
| ---------------------------------------------- | ----------- | ----------------- | --------------- | ---------------------------------------------- | ----------------------- |
| `13_MILESTONE_0_PREPARATION_PLAN.md`           | 124 → 148   | 11.9 KB → 13.8 KB | 86%             | `Changes in this revision`, `Revision history` | `2508eae9` → `f25ca259` |
| `14_UNRESOLVED_ITEM_BLOCKER_CLASSIFICATION.md` | 63 → 86     | 9.5 KB → 11.6 KB  | 58%             | `Changes in this revision`, `Revision history` | `0b70bf94` → `eaffae51` |

### F7. Filesystem times are not authorship

All 16 of B's files were created within eight seconds (2026-10-27 09:15:27–34), which indicates a bulk copy or extraction, not 16 separate edits. The times order the copies (A and C 10-26, C's 13/14 at 10-27 08:41, B at 10-27 09:15) but do not prove who wrote what. The README of B states its own dates (prepared 26 October, revised 27 October 2026).

## Recommendation

**Treat copy B, `~/Downloads/NIVASA_PACKAGE_v0.2/`, as the canonical requirements package for Phase 2, and treat A and C as superseded drafts.**

Reasons, each backed by the findings above:

1. **It is the only complete set** (16 files, including documents 13 and 14 and the revision report).
2. **It is the newest** and records itself as the coordinated revision that resolved the older set's identifier collisions (F4).
3. **It is the one the handbook was built from** (`verify.py` path and appendix text), so choosing it keeps the handbook and the plan consistent.
4. **Phase 2's own documents already cite its identifiers** (`ADR-004`, `BR-SEC-006`, `RG-2`, `C-13`). Citing the v0.1 set would reintroduce the ambiguity of F4.

**This does not mean B is approved.** B says "Proposed; not approved", and its approval record, checklist and corrections disposition are all blank. "Canonical" answers _which text we are asking the owner to approve_, nothing more.

### Conditions the owner should record with the decision

- Approvals reference **v0.2 identifiers only**. Any `ADR-*` written before 2026-10-27 is read through B's mapping table.
- Record B's file hashes (appendix) in the decision log, so the approved text can be verified later. B lives in `~/Downloads`, a location that is easy to change by accident.
- A and C are **not** to be used for sign-off. They are left untouched. Whether to archive or delete them is a separate owner decision this report does not make.
- The handbook's wording "approved requirements package v0.2" should be corrected the next time it is regenerated, because the package is not approved. (The handbook is out of Phase 2 scope and was not edited.)
- The product-name question is separate: the package says **Nivasa**, the product is **Nook**, and the handbook lists a trademark and naming conflict as **Blocked**. Choosing v0.2 as canonical does not settle the name.

### Conflicts remaining even with B canonical

| Conflict                                                                                | Detail                                                                                                                                                                                       | Needed                                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Handbook says "approved", package says "Proposed"                                       | See the confirmed-decisions table                                                                                                                                                            | Decide the true status; correct whichever text is wrong |
| Brief says JWT; B's `ADR-004` says opaque server-side sessions                          | **No copy proposes JWT.** A's and B's registers both already say "Server-side opaque sessions, not long-lived JWTs"; A's security document left the strategy open; B closes it as a proposal | `U-01`                                                  |
| Handbook has "new material absent from the approved requirements package" (spatial map) | Not in any copy A, B or C                                                                                                                                                                    | `G-04`                                                  |
| Corrections `C-01…C-17` are applied in the text but **not dispositioned**               | B's `12_…` §14 is blank                                                                                                                                                                      | `G-05`                                                  |

## Unresolved decisions

`U-23` (canonical copy and product name) · `G-01` (ADR approvals) · `G-05` (corrections disposition) · `U-01` · `G-04`. See [the register](PHASE_2_UNRESOLVED_DECISIONS.md).

## Validation still required

| #   | Claim                                                                               | Status                                                                                                                           |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | The owner reviewed B and not A or C                                                 | **Not confirmed.** Only the owner can say.                                                                                       |
| W-2 | No other copy of the package exists elsewhere (other folders, cloud storage, email) | **Not searched.** Only `~/Documents`, `~/Downloads` and the repository were checked, plus a filename search earlier in the task. |
| W-3 | The hashes below still match when the owner signs off                               | Re-run `shasum -a 256` on each file at that time.                                                                                |
| W-4 | Line similarity understates or overstates substantive change                        | It is a text measure only. The revision report is the authority on intent.                                                       |

## Appendix — full SHA-256 hashes

Generated by the comparison script from the files' bytes on 2026-10-29. Format: hash, copy, file name.

```text
8bfe7ef1aa27e01215e12c48115e9eb889ebb88e015cc2fc9af9cc1dc024245f  A  Documents/Nook        01_PRD.md
62acc34b8c96730d1232ffe0ddd41131d0969f5c097eba5de97b34e5e8300678  B  NIVASA_PACKAGE_v0.2   01_PRD.md
8bfe7ef1aa27e01215e12c48115e9eb889ebb88e015cc2fc9af9cc1dc024245f  C  Downloads (loose)     01_PRD.md
e30adfd39bdebb684f67fbc47fac6c700821eaa2613c12b4a9a2dcf9a4070d07  A  Documents/Nook        02_BUSINESS_RULES_REGISTER.md
e5b51b3b5d87504078768c1bacabf9152db69b09a2e51330581742f756fe3da0  B  NIVASA_PACKAGE_v0.2   02_BUSINESS_RULES_REGISTER.md
e30adfd39bdebb684f67fbc47fac6c700821eaa2613c12b4a9a2dcf9a4070d07  C  Downloads (loose)     02_BUSINESS_RULES_REGISTER.md
c4682a86f88390ed881430431d193c99f62434776c05a06b79868dbb7eaf9056  A  Documents/Nook        03_DOMAIN_AND_DATA_MODEL.md
452889e81130aa6c6cc354f339d8b37644c18f73bf821e294338d03defbb0692  B  NIVASA_PACKAGE_v0.2   03_DOMAIN_AND_DATA_MODEL.md
c4682a86f88390ed881430431d193c99f62434776c05a06b79868dbb7eaf9056  C  Downloads (loose)     03_DOMAIN_AND_DATA_MODEL.md
8961995f76e2240f7111c5f1a42b4adeb9df67f8c0a763ecee3ac34dfc7893dd  A  Documents/Nook        04_API_SPECIFICATION.md
72b18e68a575df596fb56191cbf64a89c9bd65aaec90d5b3915aca668db64996  B  NIVASA_PACKAGE_v0.2   04_API_SPECIFICATION.md
8961995f76e2240f7111c5f1a42b4adeb9df67f8c0a763ecee3ac34dfc7893dd  C  Downloads (loose)     04_API_SPECIFICATION.md
cb13799f8abe558c8f9b2a54282ea0235bf5c549d3cacfeb1f87e6e093639cd2  A  Documents/Nook        05_SECURITY_ARCHITECTURE.md
feef5c3be703861377223c466cb88d7107410370aa544e12c45388626e26d12d  B  NIVASA_PACKAGE_v0.2   05_SECURITY_ARCHITECTURE.md
cb13799f8abe558c8f9b2a54282ea0235bf5c549d3cacfeb1f87e6e093639cd2  C  Downloads (loose)     05_SECURITY_ARCHITECTURE.md
3a730a4451f1046fddfad2183d5a76b09ec9b97cd7945d92e5b0a98122f4da8a  A  Documents/Nook        06_FRONTEND_INFORMATION_ARCHITECTURE.md
5da5760daf9184015b1cf4caa34645f207f63efc4214623d0561fbaaeaa7abe4  B  NIVASA_PACKAGE_v0.2   06_FRONTEND_INFORMATION_ARCHITECTURE.md
3a730a4451f1046fddfad2183d5a76b09ec9b97cd7945d92e5b0a98122f4da8a  C  Downloads (loose)     06_FRONTEND_INFORMATION_ARCHITECTURE.md
bd0fc76cf13b3339ca6fa33724c0a4bce054951ed63173b0e21823e78091d339  A  Documents/Nook        07_30_DAY_DELIVERY_BACKLOG.md
5c1e7b2681b44d6e91f3fa99f5d5317b91c9df7c183e274b094017012e4d89ea  B  NIVASA_PACKAGE_v0.2   07_30_DAY_DELIVERY_BACKLOG.md
bd0fc76cf13b3339ca6fa33724c0a4bce054951ed63173b0e21823e78091d339  C  Downloads (loose)     07_30_DAY_DELIVERY_BACKLOG.md
6c5f7d19d962a6356a3718bc91dfda54c8c3ae38e4f9f9b9dce427a837c8cd9d  A  Documents/Nook        08_TESTING_AND_MIGRATION_PLAN.md
49384a4153d155f1e93ac0bde9a3a5d9d2f9462838dc48c812079bd2b7932390  B  NIVASA_PACKAGE_v0.2   08_TESTING_AND_MIGRATION_PLAN.md
6c5f7d19d962a6356a3718bc91dfda54c8c3ae38e4f9f9b9dce427a837c8cd9d  C  Downloads (loose)     08_TESTING_AND_MIGRATION_PLAN.md
3901aef1b025994f6a6d4e5cc1c824d9a136b7f004d7eacd257199d887df216e  A  Documents/Nook        09_ARCHITECTURE_DECISIONS.md
8b781571e905b563661a76ad89d0561417aaf9532a2eb289386f71de0db08f9b  B  NIVASA_PACKAGE_v0.2   09_ARCHITECTURE_DECISIONS.md
3901aef1b025994f6a6d4e5cc1c824d9a136b7f004d7eacd257199d887df216e  C  Downloads (loose)     09_ARCHITECTURE_DECISIONS.md
ef022e4e69a4654621d64b993d53d0fb9dc3da53de41797d9e55207cf4b4556d  A  Documents/Nook        10_ARCHITECTURE_APPROVAL_REGISTER.md
55b18f67fdcee1ce618371090ccc0dd4d0aea38fd92cac0121eb6777e10163f6  B  NIVASA_PACKAGE_v0.2   10_ARCHITECTURE_APPROVAL_REGISTER.md
ef022e4e69a4654621d64b993d53d0fb9dc3da53de41797d9e55207cf4b4556d  C  Downloads (loose)     10_ARCHITECTURE_APPROVAL_REGISTER.md
828c7c81d00a10194de32b6a3d4ec61eeb2662efc58a73980630b953e21c4064  A  Documents/Nook        11_OWNER_BUSINESS_RULES_SIGNOFF_CHECKLIST.md
0039645b5094fca90d02b0616b6d755c4a4bd57d225057236a8ae41c1d87234e  B  NIVASA_PACKAGE_v0.2   11_OWNER_BUSINESS_RULES_SIGNOFF_CHECKLIST.md
828c7c81d00a10194de32b6a3d4ec61eeb2662efc58a73980630b953e21c4064  C  Downloads (loose)     11_OWNER_BUSINESS_RULES_SIGNOFF_CHECKLIST.md
7660d2442cdb5837dc5d088e352e5b593eaf2b2152c6d0d33ad8bdef26fc7a3f  A  Documents/Nook        12_CROSS_DOCUMENT_CORRECTIONS.md
1f830aa036516dcee84d1e279f021741255028f3a6b00da3d1345c507749e6ec  B  NIVASA_PACKAGE_v0.2   12_CROSS_DOCUMENT_CORRECTIONS.md
7660d2442cdb5837dc5d088e352e5b593eaf2b2152c6d0d33ad8bdef26fc7a3f  C  Downloads (loose)     12_CROSS_DOCUMENT_CORRECTIONS.md
f25ca2590860309f832f907e1016a7c68a7bdbfee51474f055c6efb50da1580f  B  NIVASA_PACKAGE_v0.2   13_MILESTONE_0_PREPARATION_PLAN.md
2508eae9d89b8d0aba8cac890d71ebfea431a18311b6d1110a1b332da39c3c70  C  Downloads (loose)     13_MILESTONE_0_PREPARATION_PLAN.md
eaffae513a484eb6761e4f43c39abe19689a28aa69ddda2a4a6dead083565252  B  NIVASA_PACKAGE_v0.2   14_UNRESOLVED_ITEM_BLOCKER_CLASSIFICATION.md
0b70bf94e5a90dbbeb3df99ca61e78a7970985fc9095b76714cdc144a0befbf4  C  Downloads (loose)     14_UNRESOLVED_ITEM_BLOCKER_CLASSIFICATION.md
de31905d05a88d472bbb675c777056310d39c228e6890b9ca16f22787eed3ae1  B  NIVASA_PACKAGE_v0.2   DOCUMENTATION_REVISION_REPORT.md
13a24f953d9c7587ea343cd0d6c4beda68ff6682fc8920008f42a39e64b780cd  A  Documents/Nook        README (2).md
13a24f953d9c7587ea343cd0d6c4beda68ff6682fc8920008f42a39e64b780cd  C  Downloads (loose)     README (2).md
1a3c648b8fb81c3cf1130ff83e421ca48197824a30bc601ed6886e13d2ff4729  B  NIVASA_PACKAGE_v0.2   README.md
```

## Revision history

| Version | Date       | Change                                                |
| ------- | ---------- | ----------------------------------------------------- |
| 0.1     | 2026-10-29 | Initial comparison. No file in any copy was modified. |
