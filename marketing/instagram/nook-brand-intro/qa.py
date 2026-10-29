#!/usr/bin/env python3
"""Quality checks for the Nook brand-introduction story. Capable of failing."""
import pathlib, re, sys
import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).parent
STEM = sys.argv[1] if len(sys.argv) > 1 else "nook-instagram-story"
PNG, SVG = HERE / f"{STEM}.png", HERE / f"{STEM}.svg"
PREVIEW = HERE / {"nook-instagram-story": "preview.png",
                  "nook-instagram-story-v2": "preview-v2.png",
                  "nook-instagram-launch-nov-4": "preview-launch.png"}.get(STEM, f"{STEM}-preview.png")
MASTER = pathlib.Path("/home/claude/nook/handbook/assets/svg/nook-logo-white.svg")
FORGE_MASTER = (pathlib.Path(__file__).parents[2] / "brand" / "forge" /
                "FORGE-horizontal-white-on-ink.svg")
FORGE_INK, FORGE_PAPER = "#17140F", "#F3EFE7"
BG = "#171338"
PALETTE = {"#171338", "#7657F6", "#F4F1FF", "#FFFFFF", "#26233D"}
res = []


def srgb(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(t):
    return 0.2126 * srgb(t[0]) + 0.7152 * srgb(t[1]) + 0.0722 * srgb(t[2])


def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def contrast(fg, alpha, bg=BG):
    c = tuple(alpha * f + (1 - alpha) * b for f, b in zip(hx(fg), hx(bg)))
    a, b = lum(c), lum(hx(bg))
    a, b = max(a, b), min(a, b)
    return (a + 0.05) / (b + 0.05)


def check(name, ok, detail):
    res.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}\n         {detail}")


print(f"Nook Instagram story — quality checks — {STEM}\n")

im = Image.open(PNG).convert("RGB")
check("PNG is exactly 1080 x 1920", im.size == (1080, 1920), f"{im.size[0]} x {im.size[1]}")

a = np.asarray(im).astype(int)
L = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
content = L > 110
rows, cols = np.where(content.any(axis=1))[0], np.where(content.any(axis=0))[0]
check("No content in Instagram's safe areas",
      content[:250].sum() == 0 and content[1670:].sum() == 0,
      f"top 0-250: {content[:250].sum()} px; bottom 1670-1920: {content[1670:].sum()} px")
check("Content respects the 96px side margins",
      cols.min() >= 96 and cols.max() <= 984,
      f"content spans x {cols.min()}-{cols.max()}, y {rows.min()}-{rows.max()}")

pad = 23       # 2 x stroke weight at the wordmark's rendered scale
band = content[272 - pad:380 + pad, 96 - pad:396 + pad].copy()
band[pad:pad + 108, pad:pad + 300] = False
check("Logo clear space is 2x stroke weight, unbroken", band.sum() == 0,
      f"{band.sum()} px intrude on the {pad}px zone around the wordmark")

svg = SVG.read_text()
master_paths = re.findall(r"<(?:path|circle|ellipse|rect|polygon)\b[^>]*/>", MASTER.read_text())
check("Wordmark geometry is the genuine master, unaltered",
      all(p in svg for p in master_paths) and len(master_paths) == 4,
      f"{len(master_paths)}/4 approved path elements present verbatim in the SVG")

grp = re.search(r'<g transform="translate\([\d.,]+\) scale\(([\d.]+)\)', svg)
check("Wordmark is uniformly scaled, not distorted or rotated",
      bool(grp) and "rotate" not in svg,
      f"single uniform scale({grp.group(1) if grp else '?'}); no rotate/skew transform")

logo_block = svg[svg.index("<g transform"):svg.index("</g>")]
check("No gradient, stroke, shadow or glow is applied to the mark",
      not re.search(r"(stroke|filter|url\(#)", logo_block),
      "the wordmark group carries fills only")

if "A PRODUCT OF" in svg:
    fm = FORGE_MASTER.read_text()
    fgroups = re.findall(r"<g transform=\"[^\"]+\">.*?</g>", fm, re.S)
    verbatim = len(fgroups) == 2 and all(g in svg for g in fgroups)
    check("Forge lockup geometry is the genuine master, unaltered", verbatim,
          f"{sum(g in svg for g in fgroups)}/2 approved Forge groups present verbatim")

    bad = [c for c in (FORGE_INK, FORGE_PAPER) if c.upper() in svg.upper()]
    check("Forge endorsement introduces no off-palette brand colour", not bad,
          f"Forge ink/paper in the file: {bad or 'none'}; the lockup is reversed to "
          f"#FFFFFF, Forge's own approved dark-ground fill")

    check("Forge endorsement is not locked up with the nook wordmark",
          svg.index("A PRODUCT OF") > svg.index('transform="translate(96,272'),
          "the endorsement sits at the foot of the canvas, 1300+ px below the wordmark")

used = {c.upper() for c in re.findall(r"#[0-9A-Fa-f]{6}", svg)}
check("Only approved brand colours are declared", used <= PALETTE,
      f"{len(used)} colours used: {', '.join(sorted(used))}")

# Measure what this file actually declares, rather than assuming v1's values.
# The canvas is shown at roughly a third of its pixel size on a phone, so the
# 4.5:1 floor is applied to everything except display-size type.
rows, fails = [], []
for m in re.finditer(r'<text[^>]*font-size="([\d.]+)"[^>]*fill="(#[0-9A-Fa-f]{6})"'
                     r'[^>]*fill-opacity="([\d.]+)"[^>]*>([^<]*)</text>', svg):
    size, col, alpha, body = float(m.group(1)), m.group(2), float(m.group(3)), m.group(4)
    r = contrast(col, alpha)
    need = 3.0 if size >= 60 else 4.5
    rows.append(f"{body.strip()[:22]!r} {size:.0f}px {r:.2f}:1")
    if r < need:
        fails.append(f"{body.strip()[:22]!r} {r:.2f}:1 < {need}")
check("Every text element meets its contrast floor on Midnight Indigo",
      bool(rows) and not fails,
      f"{len(rows)} text elements measured: " + "; ".join(rows) +
      (f" | FAILING: {fails}" if fails else ""))

words = " ".join(re.findall(r">([^<>]+)</text>", svg))

# An approved launch date is a decision the owner supplied, so it is allowed --
# but an invented metric, testimonial, partnership, link or call to action is not.
banned = ["available now", "download", "trusted by", "customers", "users", "rated",
          "free trial", "sign up", "book now", "%", "http", ".com", "@"]
hit = [b for b in banned if b in words.lower()]
check("No metric, testimonial, partnership, link or CTA in the copy", not hit,
      f"copy: \"{words.strip()}\"" if not hit else f"found: {hit}")

APPROVED_DATE = "4 November 2026"
dates = re.findall(r"\b\d{1,2}\s+[A-Z][a-z]+\s+20\d{2}\b", words)
others = [d for d in dates if d != APPROVED_DATE]
check("Any date shown is the approved launch date, exactly",
      not others,
      f"dates in copy: {dates or 'none'}" + (f"; UNAPPROVED: {others}" if others else ""))

if "LAUNCHING" in words.upper():
    check("Launch date is framed as planned, not as availability",
          not re.search(r"\b(live|available|out) now\b|\bbuy\b|\bget it\b", words, re.I),
          "no availability or purchase wording accompanies the date")

check("Preview rendered", PREVIEW.exists(),
      f"{PREVIEW.name} {Image.open(PREVIEW).size if PREVIEW.exists() else 'missing'}")

print(f"\n{sum(res)}/{len(res)} checks passed, {len(res)-sum(res)} failed")
sys.exit(0 if all(res) else 1)
