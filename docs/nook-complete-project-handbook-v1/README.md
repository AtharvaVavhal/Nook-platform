# Nook — Complete Project Handbook v1.0

A designed, full-colour project handbook for **Nook**, the hostel and PG management platform,
together with its technical appendices, editable Word versions, the complete source package and a
verification script.

**Status: DRAFT FOR REVIEW. Nothing in this package has been approved.** It describes the intended
product. Chapter 23 sets out, separately and factually, what exists in the repository today.

---

## What is here

| File                                     | What it is                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Nook_Complete_Project_Handbook_v1.pdf`  | **The primary deliverable.** 121 pages, A4, typeset, full colour. 25 chapters in six parts.                            |
| `Nook_Complete_Project_Handbook_v1.docx` | Editable Word version of the same content.                                                                             |
| `Nook_Technical_Appendices_v1.pdf`       | 42 pages. Appendices A–E: the large reference matrices.                                                                |
| `Nook_Technical_Appendices_v1.docx`      | Editable Word version of the appendices.                                                                               |
| `verify.py`                              | 15 verification checks. Run it; it reports real pass/fail.                                                             |
| `verification.md`                        | What was checked, what failed first time, and what is still a known limitation.                                        |
| `assets/`                                | The 38 genuine approved brand assets, the brand guidelines, and the manifest they are checksummed against.             |
| `source/`                                | Everything needed to regenerate the PDFs: chapter fragments, diagram generators, the stylesheet and the build scripts. |

## The handbook at a glance

Six parts, twenty-five chapters:

- **Front matter** — how to read the document and what its status labels mean
- **Part I · Product** (ch. 2–5) — executive summary, vision, the 25-module map, personas and journeys
- **Part II · Experience** (ch. 6–7) — UI/UX and design system; the interactive spatial map
- **Part III · Domain modules** (ch. 8–12) — inventory, booking and allocation, residents, finance, operations
- **Part IV · Platform** (ch. 13–14) — organisation isolation and SaaS administration; notifications
- **Part V · Engineering** (ch. 15–21) — architecture, data model, API, security, NFRs, testing, deployment
- **Part VI · Delivery** (ch. 22–25) — roadmap, current implementation status, risks and open decisions, glossary

## Regenerating the PDFs

Requires Node with Playwright/Chromium, and Python with `pypdf` and `pymupdf`.

```bash
python3 source/build/make_diagrams.py        # 11 SVG diagrams
python3 source/build/build.py                # handbook PDF
python3 source/build/make_appendices.py      # appendix HTML from the v0.2 package
python3 source/build/build_appendices.py     # appendices PDF
python3 source/build/build_docx.py           # both DOCX files (needs pandoc)
python3 verify.py                            # 15 checks
```

The handbook PDF regenerates from `source/` and `assets/` alone. The appendices read the approved
requirements package v0.2 and will report a clear failure if it is not reachable.

## How to read the status labels

Nine labels are used consistently throughout. The two that matter most:

- **OPEN** — the decision has not been taken. The specification deliberately stops here.
- **NOT IMPLEMENTED** — specified, not built. This applies to almost every product capability.

Where a business rule is OPEN, the API is specified to refuse the dependent operation with
`422 RULE_NOT_CONFIGURED` rather than apply a default. No money rule has been chosen on the
owner's behalf anywhere in this package.

## What this package deliberately does not do

- It implements no product functionality, adds no Prisma models, creates no migrations and changes
  no dependency versions.
- It invents no fee amounts, formulas, dates, deductions, refund decisions or accounting treatment.
- It records no approval that has not occurred, and no test result that was not produced by a
  command that actually ran.
- It uses no image from `nook-rejected-explorations.png`.

## Known limitations

Recorded in full in `verification.md`. In short: the handbook is 121 pages against a 50–90 page
guideline; the Word versions are a content conversion and do not reproduce the print layout; and
the spatial-map scope in Chapters 2, 4 and 7 is **new material absent from the approved
requirements package**, flagged as such wherever it appears.
