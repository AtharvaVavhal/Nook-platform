# Verification record — Nook Complete Project Handbook v1.0

Produced 28 October 2026. Every result below came from running `verify.py`, inspecting a rendered
page, or executing a command. Nothing here is asserted from intent.

## How to reproduce

```bash
python3 verify.py      # exits 0 only if all 15 checks pass
```

## The checks

| #   | Check                                       | What it actually inspects                                                                    |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Brand assets match their manifest checksums | SHA-256 of every file in `assets/` against `assets/MANIFEST.md`                              |
| 2   | No rejected-exploration imagery             | Filenames in the package and every reference in the sources                                  |
| 3   | Genuine logo artwork embedded in the PDF    | Vector path count on the rendered cover                                                      |
| 4   | Palette discipline                          | Parses `:root`; asserts the five approved values and that no rule uses an undeclared literal |
| 5   | Handbook PDF exists and has substance       | Page count and file size of the rendered PDF                                                 |
| 6   | PDF is typeset, not renamed Markdown        | Embedded font count and running-footer presence per page                                     |
| 7   | Contents page numbers are correct           | Finds each chapter opener in the PDF and compares with the contents entry                    |
| 8   | No placeholders or filler                   | Scans rendered output for `{{`, `TODO`, `Lorem ipsum`                                        |
| 9   | Diagrams legible at A4                      | Smallest `font-size` in each SVG converted to printed points at the 174 mm column            |
| 10  | Status vocabulary used consistently         | Counts how many of the nine labels appear in the text layer                                  |
| 11  | No unsupported approval claims              | Searches for approval/readiness phrasing outside quotation                                   |
| 12  | No application code in the package          | Looks for `.ts`, `.tsx`, `.prisma`, migration paths                                          |
| 13  | Appendices built with all five sections     | Text layer of the appendices PDF                                                             |
| 14  | Appendix A reproduces the register exactly  | Compares every `BR-*` identifier against the source register                                 |
| 15  | Editable DOCX built properly                | Embedded image count and table markup inside the `.docx`                                     |

## Result

**15 of 15 passed.** Full output is reproduced at the end of this file.

## These checks are capable of failing

Two things evidence this.

**First, they caught real defects on the first run.** Five checks failed; two were defects in the
work and three were defects in the checks themselves:

| First-run failure     | Diagnosis                                                                                                                                                                             | Resolution                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Contents page numbers | **Real defect.** Page discovery returned the physical page in the merged PDF; the printed folio excludes the unnumbered cover. Every one of the 25 contents entries was one too high. | Fixed in `build.py`: contents quotes `physical − 1`. Re-verified: 25/25 correct.                                |
| Palette discipline    | **Real defect.** Seven colours appeared in the stylesheet that were neither brand colours nor declared — including a blue (`#2361EB`) with no relationship to the brand.              | Removed or mapped to declared tokens. The extension set is now declared in `:root` and documented in Chapter 6. |
| Asset checksums       | Check bug — the manifest stores 12-character checksums in a six-column table; the regex expected 64 characters in a two-column one.                                                   | Regex corrected. It then revealed the package held 15 of 38 approved assets; all 38 were added.                 |
| Placeholders          | Check bug — it flagged `{{TOKEN}}` in _source fragments_, which are build-time substitutions.                                                                                         | Narrowed to the rendered output only.                                                                           |
| Approval claims       | Check bug — it matched the phrase `"all tests pass"` in Chapter 23, where the handbook quotes it in order to warn against the inference.                                              | Quoted occurrences excluded.                                                                                    |

**Second, a deliberate mutation test.** Appending one comment byte to `assets/svg/nook-symbol.svg`
and replacing one declared colour with `#FF00AA`:

```
[FAIL] Brand assets match their manifest checksums
       37/38 verified; mismatched=['svg/nook-symbol.svg: 34a75b50a4ac != 124ec158c80c']
[FAIL] Stylesheet uses only the approved palette and declared tints
       undeclared literals: ['#FF00AA']
```

Both files were restored and the suite returned to 15/15.

## Visual inspection

The brief requires the rendered result to be looked at, not merely produced. Pages were rasterised
and inspected individually.

| Page | What was checked                  | Outcome                                             |
| ---- | --------------------------------- | --------------------------------------------------- |
| 1    | Cover                             | Full bleed, genuine wordmark, clear space respected |
| 4    | Contents                          | Leaders and page numbers on every row               |
| 19   | Chapter 4 opener + module map     | No overflow; legible at A4                          |
| 33   | Figure 6.1, brand board           | Complete, uncropped, correct colour                 |
| 41   | Figure 7.2, 2D floor-plan concept | Legible; table beneath intact                       |
| 82   | Figure 15.1, architecture         | No overflow; body text flows correctly              |
| 107  | Roadmap                           | Phase labels and gate text contained                |
| 115  | Decision table                    | Columns and status pills correct                    |

Four layout defects were found by looking and then fixed: the cover logo was clipped at the band
edge; the cover was not full-bleed; divider panels leaked onto the following page; and the
contents leader dots dropped out intermittently at `0.4pt`.

### Diagram legibility — the largest single fix

The eleven diagrams were first authored in a 1000-unit coordinate space. At the 174 mm text column
that maps to `size × 0.493`, so an 8.2-unit label printed at roughly **4 pt** — unreadable.
Enlarging the type alone made it worse: geometry stayed in the same space and labels overran their
boxes in `module-map`, `architecture`, `roadmap` and `booking-states`.

All nine schematic diagrams were therefore regenerated in a 620-unit space with layouts rebuilt to
match (fewer columns per row, serpentine row-wrapping with real connectors, transaction bands drawn
behind their messages). The two UI-mock diagrams had their smallest type raised to the 7 pt floor
and their affected callout and legend geometry adjusted.

Each diagram was then rendered **at the exact printed width** and inspected before rebuilding the
PDF. Smallest type now prints at **6.8 pt**.

## Executed commands and their real results

| Command                                    | Exit | Result                                               |
| ------------------------------------------ | ---- | ---------------------------------------------------- |
| `python3 source/build/make_diagrams.py`    | 0    | 9 schematic SVGs regenerated at 620 units            |
| `python3 source/build/build.py`            | 0    | 121 pages, 1.85 MB, 25/25 chapter openers located    |
| `python3 source/build/make_appendices.py`  | 0    | 5 appendix fragments generated from the v0.2 package |
| `python3 source/build/build_appendices.py` | 0    | 42 pages, 5/5 appendix openers located               |
| `python3 source/build/build_docx.py`       | 0    | Both `.docx` files written                           |
| `python3 verify.py`                        | 0    | 15/15                                                |

## Known limitations

These are stated rather than worked around.

1. **Page count.** 121 pages against the brief's 50–90 guideline. The four largest reference
   matrices were moved into separate appendices, which is as far as extraction goes: the remaining
   25 chapters average under five pages each, so reaching 90 would mean deleting required content
   rather than relocating it. Reported rather than padded or cut.

2. **The Word versions are a conversion, not the design.** They carry the full text, tables,
   diagrams and the genuine brand imagery, and they are editable — but they do not reproduce the
   print layout: no part dividers, no running furniture, no status pills (rendered as bracketed
   text), and Calibri in place of Inter, which is not installed everywhere and for which Word has
   no fallback chain. **The PDF is the designed artefact.**

3. **LibreOffice clips one tall figure.** Converting the `.docx` through LibreOffice crops the
   right edge of the brand board. The stored image is correct — 1640 × 2060 at the right aspect in
   `word/document.xml` — so this is a LibreOffice rendering artefact, not a defect in the file. It
   was not reproduced in Word, which was not available here.

4. **Palette extensions.** The brand guidelines define five colours and no neutrals or semantic
   colours. This publication declares fourteen extensions. They are documented in Chapter 6 and
   marked OPEN; they are not brand colours and no mark is rendered in any of them.

5. **The spatial map is new scope.** Public property discovery, the enquiry workflow, phone
   verification and the interactive 2D/3D map do not appear in the approved requirements package
   v0.2. They are specified here because the brief asked for them, and flagged as unapproved
   additions in Chapters 2, 4, 7 and 24. **They have not been costed against the pilot.**

6. **No browser runtime verification.** The PDF was inspected as rendered pages. The repository's
   web application builds but has not been observed running in a browser, here or previously; this
   is recorded in Chapter 23 as an outstanding Milestone 0 item, not resolved by this work.

7. **Third-party 3D library figures are indicative.** The one external source consulted
   (Chapter 7) contradicts itself on bundle sizes. Figures are labelled indicative and no library
   has been selected or added.

## Full output

```
Nook handbook package — verification

  [PASS] Brand assets match their manifest checksums
         38/38 verified; mismatched=0; missing=0; unlisted=0
  [PASS] No rejected-exploration imagery is present or referenced
         rejected-exploration files in package: none; references: none
  [PASS] Genuine logo artwork is embedded in the PDF
         cover carries 22 vector paths; 1 raster images in document
  [PASS] Stylesheet uses only the approved palette and declared tints
         19 declared tokens, 14 of them documented extensions; approved brand colours present: 5/5; undeclared literals: none
  [PASS] Handbook PDF exists and has substance
         121 pages, 1.85 MB
  [PASS] PDF is typeset, not renamed Markdown
         3 embedded fonts; running footer present on 120 pages
  [PASS] Contents page numbers match where chapters open
         25/25 contents entries correct; no discrepancies
  [PASS] No unresolved placeholders or filler text
         unsubstituted tokens or filler in rendered output: none
  [PASS] Diagram type is legible at A4
         smallest diagram type prints at 6.8 pt (allocation-sequence.svg); threshold 6.5 pt
  [PASS] Status vocabulary is used consistently
         9/9 status labels appear: CONFIRMED, APPROVED IN PRINCIPLE, PROPOSED, OPEN, BLOCKED, IMPLEMENTED, VERIFIED, NOT IMPLEMENTED, SUPERSEDED
  [PASS] No unsupported approval or readiness claims
         unsupported approval/readiness claims: none found
  [PASS] No application code, schema or migrations in the package
         application source/schema/migration files in the package: none
  [PASS] Technical appendices built with all five sections
         42 pages; missing appendices: none
  [PASS] Appendix A reproduces the register exactly
         78/78 rule identifiers reproduced; missing=0; invented=0
  [PASS] Editable DOCX built with images and tables
         12 embedded images; tables present: True; 2.10 MB

15/15 checks passed, 0 failed
```
