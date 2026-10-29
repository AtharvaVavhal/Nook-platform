#!/usr/bin/env python3
"""Build the Nook brand-introduction Instagram Story (1080 x 1920).

Brand rules honoured, from nook-brand-guidelines.md:
  * the wordmark is the GENUINE approved master, path data copied verbatim from
    svg/nook-logo-white-period.svg -- the `nook.` variant, which §6 approves for
    campaign artwork, social posts and title cards;
  * white wordmark on Midnight Indigo, per the §5 background table;
  * clear space >= 2x stroke weight on all four sides (§3);
  * no gradient, shadow, glow, stroke, outline or 3D touches the mark (§7.5);
  * the mark is not rotated, recoloured, re-tracked or rebuilt in a font;
  * no house, bed, roof, key or location-pin motif appears (§7.9).
The arcade is independent geometry in the brand's monoline language. It is not
derived from the logo and is never presented as a mark.
"""
import pathlib, re

HERE = pathlib.Path(__file__).parent
ASSETS = pathlib.Path("/home/claude/nook/handbook/assets/svg")

W, H = 1080, 1920
INDIGO, VIOLET, LAVENDER, WHITE = "#171338", "#7657F6", "#F4F1FF", "#FFFFFF"

MARGIN = 96
SAFE_TOP, SAFE_BOTTOM = 250, 250           # Instagram interface-safe areas

# ---------------------------------------------------------------- the wordmark
master = (ASSETS / "nook-logo-white.svg").read_text()
# every drawable child of the master, in document order -- the violet period is a
# <circle>, so matching only <path> would silently drop it and change the mark
paths = re.findall(r"<(?:path|circle|ellipse|rect|polygon)\b[^>]*/>", master)
if len(paths) != 4:
    raise SystemExit(f"expected 4 elements in the wordmark master, read {len(paths)}")
if "#FFFFFF" not in "".join(paths):
    raise SystemExit("the wordmark did not extract as the white master")
VB = re.search(r'viewBox="([^"]+)"', master).group(1)          # "0 -40 426.32 142"
vx, vy, vw, vh = (float(n) for n in VB.split())

LOGO_W = 300.0
scale = LOGO_W / vw
LOGO_H = vh * scale
LOGO_X, LOGO_Y = MARGIN, 272.0
CLEAR = 32 * (LOGO_W / vw) * (vw / 426.32)   # 2x stroke weight, at this scale

wordmark = (f'<g transform="translate({LOGO_X},{LOGO_Y}) scale({scale:.6f}) '
            f'translate({-vx},{-vy})">' + "".join(paths) + "</g>")

# ------------------------------------------------------------------ the arcade
BAND_TOP, BAND_BOT = 470.0, 900.0
AW, PITCH, START = 118.0, 140.0, -60.0
LIT = 5                                        # the one open nook, right of centre

arches = []
i, x = 0, START
while x < W + 40:
    r = AW / 2
    d = (f"M{x:.1f},{BAND_BOT} V{BAND_TOP + r:.1f} "
         f"A{r:.1f},{r:.1f} 0 0 1 {x + AW:.1f},{BAND_TOP + r:.1f} V{BAND_BOT}")
    if i == LIT:
        arches.append(f'<path d="{d} Z" fill="url(#lit)" />')
        arches.append(f'<path d="{d}" fill="none" stroke="{LAVENDER}" '
                      f'stroke-width="2.5" stroke-opacity="0.50" />')
    else:
        # the arcade recedes from the lit bay in both directions
        op = max(0.10, 0.30 - abs(i - LIT) * 0.045)
        arches.append(f'<path d="{d}" fill="none" stroke="{VIOLET}" '
                      f'stroke-width="1.6" stroke-opacity="{op:.2f}" />')
    i, x = i + 1, x + PITCH

# the arcade dissolves at the band's foot rather than being cut off
arcade = ('<g mask="url(#fade)">' + "".join(arches) + "</g>")

# ------------------------------------------------------------------- the words
def text(x, y, s, size, weight, fill, op=1.0, track=0.0, anchor="start"):
    return (f'<text x="{x}" y="{y}" font-family="Inter, sans-serif" '
            f'font-size="{size}" font-weight="{weight}" fill="{fill}" '
            f'fill-opacity="{op}" letter-spacing="{track}" '
            f'text-anchor="{anchor}" xml:space="preserve">{s}</text>')

copy = [
    f'<rect x="{MARGIN}" y="1060" width="64" height="4" rx="2" fill="{VIOLET}" />',
    text(MARGIN, 1178, "Hostel living.", 100, 700, WHITE, 1, -3.5),
    text(MARGIN, 1290, "Reimagined.", 100, 700, WHITE, 1, -3.5),
    text(MARGIN, 1400, "One smarter space to manage stays,", 35, 400, LAVENDER, 0.70),
    text(MARGIN, 1452, "spaces and everyday operations.", 35, 400, LAVENDER, 0.70),
    f'<rect x="{MARGIN}" y="1560" width="{W - 2 * MARGIN}" height="1" '
    f'fill="{LAVENDER}" fill-opacity="0.12" />',
    text(MARGIN, 1622, "Built for better-managed living.", 24, 500, LAVENDER, 0.56, 1.6),
]

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"
     viewBox="0 0 {W} {H}" role="img" aria-label="nook — Hostel living. Reimagined.">
  <title>nook — Hostel living. Reimagined.</title>
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stop-color="{VIOLET}" stop-opacity="0.26" />
      <stop offset="55%"  stop-color="{VIOLET}" stop-opacity="0.08" />
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glow2" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stop-color="{VIOLET}" stop-opacity="0.12" />
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="lit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="{LAVENDER}" stop-opacity="0.17" />
      <stop offset="100%" stop-color="{LAVENDER}" stop-opacity="0.01" />
    </linearGradient>
    <linearGradient id="fadeGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.15" />
      <stop offset="28%"  stop-color="#FFFFFF" stop-opacity="1" />
      <stop offset="82%"  stop-color="#FFFFFF" stop-opacity="1" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <mask id="fade">
      <rect x="0" y="{BAND_TOP}" width="{W}" height="{BAND_BOT - BAND_TOP}"
            fill="url(#fadeGrad)" />
    </mask>
  </defs>

  <rect width="{W}" height="{H}" fill="{INDIGO}" />
  <ellipse cx="900" cy="430" rx="780" ry="700" fill="url(#glow)" />
  <ellipse cx="60"  cy="1640" rx="620" ry="560" fill="url(#glow2)" />

  {arcade}
  {wordmark}
  {"".join(copy)}
</svg>
'''

out = HERE / "nook-instagram-story.svg"
out.write_text(svg)
print(f"wrote {out.name}")
print(f"  wordmark: genuine master, {LOGO_W:.0f}x{LOGO_H:.1f}px at ({LOGO_X},{LOGO_Y:.0f})")
print(f"  clear space required {CLEAR:.1f}px; nearest element is the arcade foot at y={BAND_BOT:.0f}")
print(f"  safe areas: top {SAFE_TOP}px, bottom {SAFE_BOTTOM}px")
