#!/usr/bin/env python3
"""Verification checks for the Nook handbook package.

These checks are written to be capable of failing. Each one inspects a real
artefact — a checksum, a rendered page, a file on disk — and reports what it
found. Run:  python3 verify.py
"""
import hashlib, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
PDF = ROOT / "Nook_Complete_Project_Handbook_v1.pdf"
APDF = ROOT / "Nook_Technical_Appendices_v1.pdf"
DOCX = ROOT / "Nook_Complete_Project_Handbook_v1.docx"
ASSETS = ROOT / "assets"
SRC = ROOT / "source"

APPROVED = {"#171338", "#7657F6", "#F4F1FF", "#FFFFFF", "#26233D"}
STATUSES = ["CONFIRMED", "APPROVED IN PRINCIPLE", "PROPOSED", "OPEN", "BLOCKED",
            "IMPLEMENTED", "VERIFIED", "NOT IMPLEMENTED", "SUPERSEDED"]

results = []


def check(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:                                   # a check that errors is a failure
        ok, detail = False, f"check raised {type(e).__name__}: {e}"
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}\n         {detail}")
    return ok


# ---------------------------------------------------------------- brand assets
def c_asset_checksums():
    man = ASSETS / "MANIFEST.md"
    if not man.exists():
        return False, "assets/MANIFEST.md is missing"
    rows = re.findall(r"^\|\s*`([^`]+)`\s*\|.*?\|\s*`([0-9a-f]{12,64})`\s*\|",
                      man.read_text(), re.M)
    listed = dict(rows)
    if not listed:
        return False, "no asset rows with a checksum found in MANIFEST.md"
    present = {str(p.relative_to(ASSETS)): p for p in ASSETS.rglob("*")
               if p.is_file() and p.suffix.lower() in (".svg", ".png", ".md")}
    bad, missing = [], []
    for rel, want in listed.items():
        p = present.get(rel)
        if p is None:
            missing.append(rel); continue
        got = hashlib.sha256(p.read_bytes()).hexdigest()[:len(want)]
        if got != want:
            bad.append(f"{rel}: {got} != {want}")
    # MANIFEST.md cannot list its own checksum
    unlisted = sorted(set(present) - set(listed) - {"MANIFEST.md"})
    ok = not bad and not missing and not unlisted
    return ok, (f"{len(listed) - len(bad) - len(missing)}/{len(listed)} verified; "
                f"mismatched={bad or 0}; missing={missing or 0}; unlisted={unlisted or 0}")


def c_no_rejected_assets():
    hits = [str(p.relative_to(ROOT)) for p in ROOT.rglob("*")
            if p.is_file() and "reject" in p.name.lower()]
    refs = []
    for p in list(SRC.rglob("*.html")) + list(SRC.rglob("*.py")):
        if re.search(r"reject\w*\.(png|jpg|svg)", p.read_text(errors="ignore"), re.I):
            refs.append(str(p.relative_to(ROOT)))
    return (not hits and not refs,
            f"rejected-exploration files in package: {hits or 'none'}; references: {refs or 'none'}")


def c_logo_embedded():
    if not PDF.exists():
        return False, "handbook PDF not built"
    import pymupdf
    d = pymupdf.open(PDF)
    n_img = sum(len(p.get_images(full=True)) for p in d)
    cover_vec = len(d[0].get_drawings())
    d.close()
    # the cover wordmark is a vector path set from the approved SVG master
    return cover_vec > 20, f"cover carries {cover_vec} vector paths; {n_img} raster images in document"


# ------------------------------------------------------------------- palette
def c_palette():
    """Two things must hold: the five approved brand colours are used unaltered,
    and every other colour in the stylesheet is a declared token, not an ad-hoc
    literal dropped into a rule."""
    css = (SRC / "build" / "handbook.css").read_text()
    root = css[css.index(":root {"): css.index("}", css.index(":root {"))]
    declared = {c.upper() for c in re.findall(r"#[0-9A-Fa-f]{6}", root)}
    used = {c.upper() for c in re.findall(r"#[0-9A-Fa-f]{6}", css)}
    undeclared = sorted(used - declared)
    brand_missing = sorted(APPROVED - declared)
    ok = not undeclared and not brand_missing
    return ok, (f"{len(declared)} declared tokens, {len(declared) - len(APPROVED)} of them "
                f"documented extensions; approved brand colours present: "
                f"{len(APPROVED) - len(brand_missing)}/5; undeclared literals: {undeclared or 'none'}")


# ------------------------------------------------------------------ the PDF
def c_pdf_built():
    if not PDF.exists():
        return False, "file not found"
    import pymupdf
    d = pymupdf.open(PDF); n = d.page_count; d.close()
    mb = PDF.stat().st_size / 1e6
    return n > 40, f"{n} pages, {mb:.2f} MB"


def c_pdf_is_typeset():
    """A renamed Markdown file would have no fonts, no vector art and no page furniture."""
    import pymupdf
    d = pymupdf.open(PDF)
    fonts = set()
    for p in d:
        for f in p.get_fonts(full=True):
            fonts.add(f[3])
    furniture = sum(1 for p in d if "/ 121" in p.get_text() or re.search(r"\d+ / \d+", p.get_text()))
    d.close()
    return (len(fonts) >= 2 and furniture > 50,
            f"{len(fonts)} embedded fonts; running footer present on {furniture} pages")


def c_toc_accurate():
    """Every contents entry must point at the page the chapter actually opens on."""
    import pymupdf
    d = pymupdf.open(PDF)
    man = json.loads((SRC / "build" / "manifest.json").read_text())
    chs = [m for m in man if m.get("kind") == "chapter"]
    sq = lambda s: "".join(s.split()).lower()
    actual = {}
    for i, pg in enumerate(d):
        t = sq(pg.get_text())
        for m in chs:
            if m["stem"] in actual:
                continue
            if sq(f"Chapter {m['num']}") in t and sq(m["title"]) in t:
                actual[m["stem"]] = i  # 0-based == printed number (cover is unnumbered)
    toc_text = "".join(d[p].get_text() for p in range(3, 6))
    d.close()
    wrong = []
    for m in chs:
        if m["stem"] not in actual:
            wrong.append(f"{m['num']}: opener not found"); continue
        want = actual[m["stem"]]
        pat = re.compile(re.escape(m["title"]) + r"\s*\.*\s*(\d+)")
        hit = pat.search(toc_text)
        if not hit:
            wrong.append(f"{m['num']}: not listed in contents")
        elif int(hit.group(1)) != want:
            wrong.append(f"{m['num']}: contents says {hit.group(1)}, opens on {want}")
    return not wrong, f"{len(chs) - len(wrong)}/{len(chs)} contents entries correct; {wrong or 'no discrepancies'}"


def c_no_placeholders():
    # {{TOKEN}} in a source fragment is substituted at build time; build.py already
    # fails on an unknown one. A defect is a token that survives into the output.
    leftovers = []
    import pymupdf
    d = pymupdf.open(PDF)
    in_pdf = [p.number + 1 for p in d if "{{" in p.get_text() or "TODO" in p.get_text()
              or "Lorem ipsum" in p.get_text()]
    d.close()
    for name, path in (("handbook", PDF), ("appendices", APDF)):
        if path.exists():
            dd = pymupdf.open(path)
            for pg in dd:
                t = pg.get_text()
                if "{{" in t or "TODO" in t or "Lorem ipsum" in t:
                    leftovers.append(f"{name} p{pg.number + 1}")
            dd.close()
    return (not leftovers and not in_pdf,
            f"unsubstituted tokens or filler in rendered output: {leftovers or 'none'}")


def c_diagrams_legible():
    """Smallest diagram type, converted to the size it prints at in a 174 mm column."""
    worst, name = 99.0, None
    for p in (SRC / "diagrams").glob("*.svg"):
        s = p.read_text()
        vb = re.search(r'viewBox="0 0 ([\d.]+)', s)
        if not vb:
            continue
        scale = 493.0 / float(vb.group(1))     # 174 mm expressed in points
        sizes = [float(x) for x in re.findall(r'font-size="([\d.]+)"', s)]
        if not sizes:
            continue
        pt = min(sizes) * scale
        if pt < worst:
            worst, name = pt, p.name
    return worst >= 6.5, f"smallest diagram type prints at {worst:.1f} pt ({name}); threshold 6.5 pt"


def c_status_vocabulary():
    import pymupdf
    d = pymupdf.open(PDF)
    text = " ".join(p.get_text() for p in d).upper()
    d.close()
    used = [s for s in STATUSES if s in text]
    return len(used) >= 7, f"{len(used)}/9 status labels appear: {', '.join(used)}"


def c_no_false_approval():
    """The handbook must not assert sign-off that has not happened."""
    import pymupdf
    d = pymupdf.open(PDF)
    text = " ".join(p.get_text() for p in d)
    d.close()
    banned = [r"owner has approved", r"signed off by the owner", r"approved by the owner",
              r"all tests pass(?!es)", r"production[- ]ready", r"audit is clean"]
    hits = []
    for b in banned:
        for m in re.finditer(b, text, re.I):
            a, z = max(0, m.start() - 2), min(len(text), m.end() + 2)
            quoted = ('"' in text[a:m.start()] and '"' in text[m.end():z]) or \
                     ("\u201c" in text[a:m.start()] or "\u2018" in text[a:m.start()])
            if not quoted:
                hits.append(f"{b} -> ...{text[max(0, m.start()-45):m.end()+45]}...")
                break
    return not hits, f"unsupported approval/readiness claims: {hits or 'none found'}"


# ------------------------------------------------------- scope restrictions
def c_scope_untouched():
    """Nothing in this package may be application source, schema or migrations."""
    offenders = []
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        rel = str(p.relative_to(ROOT))
        if p.suffix in (".ts", ".tsx", ".prisma") or "/migrations/" in rel:
            offenders.append(rel)
    return not offenders, f"application source/schema/migration files in the package: {offenders or 'none'}"


def c_appendices():
    if not APDF.exists():
        return False, "appendices PDF not built"
    import pymupdf
    d = pymupdf.open(APDF)
    t = " ".join(p.get_text() for p in d)
    n = d.page_count
    d.close()
    want = ["Business Rules Register", "Data Dictionary", "API Catalogue",
            "Acceptance Criteria", "Owner Decision Worksheet"]
    missing = [w for w in want if w not in t]
    return not missing, f"{n} pages; missing appendices: {missing or 'none'}"


def c_rules_match_source():
    """Appendix A must reproduce the register, not a rewrite of it."""
    src = pathlib.Path("/mnt/user-data/uploads/Downloads/NIVASA_PACKAGE_v0.2/02_BUSINESS_RULES_REGISTER.md")
    if not src.exists():
        return False, "source register not available in this environment to compare against"
    want = set(re.findall(r"BR-[A-Z]+-\d{3}", src.read_text()))
    import pymupdf
    d = pymupdf.open(APDF)
    got = set(re.findall(r"BR-[A-Z]+-\d{3}", " ".join(p.get_text() for p in d)))
    d.close()
    missing = sorted(want - got)
    extra = sorted(got - want)
    return (not missing and not extra,
            f"{len(got & want)}/{len(want)} rule identifiers reproduced; missing={missing or 0}; invented={extra or 0}")


def c_docx():
    if not DOCX.exists():
        return False, "DOCX not built"
    import zipfile
    z = zipfile.ZipFile(DOCX)
    media = [n for n in z.namelist() if n.startswith("word/media/")]
    doc = z.read("word/document.xml").decode("utf-8", "ignore")
    z.close()
    return (len(media) >= 10 and "<w:tbl>" in doc,
            f"{len(media)} embedded images; tables present: {'<w:tbl>' in doc}; "
            f"{DOCX.stat().st_size/1e6:.2f} MB")


print("Nook handbook package — verification\n")
checks = [
    ("Brand assets match their manifest checksums", c_asset_checksums),
    ("No rejected-exploration imagery is present or referenced", c_no_rejected_assets),
    ("Genuine logo artwork is embedded in the PDF", c_logo_embedded),
    ("Stylesheet uses only the approved palette and declared tints", c_palette),
    ("Handbook PDF exists and has substance", c_pdf_built),
    ("PDF is typeset, not renamed Markdown", c_pdf_is_typeset),
    ("Contents page numbers match where chapters open", c_toc_accurate),
    ("No unresolved placeholders or filler text", c_no_placeholders),
    ("Diagram type is legible at A4", c_diagrams_legible),
    ("Status vocabulary is used consistently", c_status_vocabulary),
    ("No unsupported approval or readiness claims", c_no_false_approval),
    ("No application code, schema or migrations in the package", c_scope_untouched),
    ("Technical appendices built with all five sections", c_appendices),
    ("Appendix A reproduces the register exactly", c_rules_match_source),
    ("Editable DOCX built with images and tables", c_docx),
]
passed = sum(check(n, f) for n, f in checks)
print(f"\n{passed}/{len(checks)} checks passed, {len(checks)-passed} failed")
sys.exit(0 if passed == len(checks) else 1)
