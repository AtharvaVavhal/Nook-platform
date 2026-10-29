#!/usr/bin/env python3
"""Nook launch-announcement Instagram Story (1080 x 1920).

Built from v2, which is kept unchanged. The motif, wordmark, palette and headline
carry over verbatim; the plan band is compressed to open room for the launch block.

The date is a decision the project owner supplied. It is stated as a planned
launch and nothing more -- no availability claim, no link, no sign-up, no metric.

Brand rules honoured, from nook-brand-guidelines.md:
  * genuine wordmark master, geometry verbatim, uniformly scaled (§1, §7.1/7.6);
  * white wordmark on Midnight Indigo, 17.70:1 (§5);
  * clear space >= 2x stroke weight on all four sides (§3);
  * nothing strokes, shadows, glows or gradients the mark (§7.5);
  * approved palette only (§2).

On §7.9 -- "do not use a house, bed, roof, key or location-pin ICON alongside or
instead of the monogram". The motif here is an architectural plan drawing, not a
pictogram: it is orthographic, it is a cropped fragment of a larger plan, it sits
in its own band far from the wordmark, and it never stands in for the mark. The
units are plan-view capsules, not bed pictograms (no headboard, pillow or
side-view silhouette). This reading is recorded in the README for review.
"""
import pathlib, re

HERE = pathlib.Path(__file__).parent
ASSETS = pathlib.Path("/home/claude/nook/handbook/assets/svg")
FORGE = pathlib.Path(__file__).parents[2] / "brand" / "forge"

W, H = 1080, 1920
INDIGO, VIOLET, LAVENDER, WHITE = "#171338", "#7657F6", "#F4F1FF", "#FFFFFF"
MARGIN = 96
SAFE_TOP, SAFE_BOTTOM = 250, 250

# ---------------------------------------------------------------- the wordmark
master = (ASSETS / "nook-logo-white.svg").read_text()
paths = re.findall(r"<(?:path|circle|ellipse|rect|polygon)\b[^>]*/>", master)
if len(paths) != 4:
    raise SystemExit(f"expected 4 elements in the wordmark master, read {len(paths)}")
VB = re.search(r'viewBox="([^"]+)"', master).group(1)
vx, vy, vw, vh = (float(n) for n in VB.split())
LOGO_W = 300.0
scale = LOGO_W / vw
LOGO_H = vh * scale
LOGO_X, LOGO_Y = MARGIN, 272.0
wordmark = (f'<g transform="translate({LOGO_X},{LOGO_Y}) scale({scale:.6f}) '
            f'translate({-vx},{-vy})">' + "".join(paths) + "</g>")

# ----------------------------------------------------------- Forge endorsement
fm = (FORGE / "FORGE-horizontal-white-on-ink.svg").read_text()
fgroups = re.findall(r"<g transform=\"[^\"]+\">.*?</g>", fm, re.S)
if len(fgroups) != 2:
    raise SystemExit(f"expected 2 groups in the Forge lockup master, read {len(fgroups)}")
if fm.count('fill="#FFFFFF"') != 7:
    raise SystemExit("the Forge lockup master did not extract as the white variant")
FORGE_VB_W, FORGE_VB_H = 580.0, 120.0
FORGE_H = 40.0                                   # well above Forge's small-size floor
fscale = FORGE_H / FORGE_VB_H
FORGE_W = FORGE_VB_W * fscale
FORGE_X, FORGE_Y = 286.0, 1590.0
forge_lockup = (f'<g transform="translate({FORGE_X},{FORGE_Y}) scale({fscale:.6f})" '
                f'opacity="0.82">' + "".join(fgroups) + "</g>")

# ------------------------------------------------------------- the plan motif
# Plan conventions: hairline walls, a door gap on every corridor-facing wall,
# units drawn against the outer wall. Nothing is labelled -- a label would be a
# product claim, and the drawing does not need one.
# A close-up of one room and its neighbours, not a whole floor: a plan drawn at
# wallpaper density reads as texture. One room is the subject; the rest recedes.
ROOM_TOP, ROOM_BOT = 470.0, 724.0
CORR_TOP, CORR_BOT = 724.0, 780.0
OPP_BOT = 834.0                      # the rooms across the corridor, barely begun
DOOR = 56.0
UNIT_W, UNIT_H, UNIT_R = 44.0, 104.0, 20.0

plan = []


def wall(x1, y1, x2, y2, op, col=VIOLET, w=1.6):
    plan.append(f'<path d="M{x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f}" stroke="{col}" '
                f'stroke-width="{w}" stroke-opacity="{op:.2f}" stroke-linecap="square" />')


def units(x, w, y, n, lit, col, op, lit_op=0.88):
    span, out = w - 60, []
    step = span / n
    for i in range(n):
        ux = x + 30 + step * i + (step - UNIT_W) / 2
        if ux + UNIT_W < -20 or ux > W + 20:
            continue
        if i == lit:
            # the allocated unit, with the selection ring the product would draw
            out.append(f'<rect x="{ux:.1f}" y="{y:.1f}" width="{UNIT_W}" height="{UNIT_H}" '
                       f'rx="{UNIT_R}" fill="{LAVENDER}" fill-opacity="{lit_op}" />')
            out.append(f'<rect x="{ux-7:.1f}" y="{y-7:.1f}" width="{UNIT_W+14}" '
                       f'height="{UNIT_H+14}" rx="{UNIT_R+7}" fill="none" stroke="{LAVENDER}" '
                       f'stroke-width="1.8" stroke-opacity="0.42" />')
        else:
            out.append(f'<rect x="{ux:.1f}" y="{y:.1f}" width="{UNIT_W}" height="{UNIT_H}" '
                       f'rx="{UNIT_R}" fill="none" stroke="{col}" stroke-width="1.6" '
                       f'stroke-opacity="{op:.2f}" />')
    plan.extend(out)


def room(x, w, n, lit=None, subject=False):
    col = LAVENDER if subject else VIOLET
    wop = 0.55 if subject else 0.22
    uop = 0.32 if subject else 0.16
    if subject:
        plan.append(f'<rect x="{x:.1f}" y="{ROOM_TOP}" width="{w:.1f}" '
                    f'height="{ROOM_BOT-ROOM_TOP}" fill="url(#lit)" />')
    cx = x + w / 2
    wall(x, ROOM_TOP, x, ROOM_BOT, wop, col)
    wall(x + w, ROOM_TOP, x + w, ROOM_BOT, wop, col)
    wall(x, ROOM_TOP, x + w, ROOM_TOP, wop, col)          # exterior wall
    wall(x, ROOM_BOT, cx - DOOR / 2, ROOM_BOT, wop, col)  # corridor wall, with a doorway
    wall(cx + DOOR / 2, ROOM_BOT, x + w, ROOM_BOT, wop, col)
    units(x, w, ROOM_TOP + 42, n, lit, col, uop)


# the subject room's left wall sits on the text column, so the plan, the
# wordmark and the headline all start on the same line
room(-320.0, 400, 3)                       # neighbour, mostly cropped left
room(98.0, 380, 4, lit=2, subject=True)    # the subject
room(502.0, 420, 4)                        # neighbour
room(946.0, 400, 4)                        # neighbour, cropped right

# circulation, and the first suggestion of the rooms opposite
plan.append(f'<rect x="-40" y="{CORR_TOP}" width="{W+80}" height="{CORR_BOT-CORR_TOP}" '
            f'fill="{VIOLET}" fill-opacity="0.05" />')
wall(-40, CORR_BOT, W + 40, CORR_BOT, 0.16)
for ox, ow in ((-260.0, 420), (180.0, 440), (640.0, 400), (1060.0, 300)):
    wall(ox, CORR_BOT, ox, OPP_BOT, 0.13)
    wall(ox + ow, CORR_BOT, ox + ow, OPP_BOT, 0.13)

LIT_X, LIT_Y = 98 + 380 / 2, (ROOM_TOP + ROOM_BOT) / 2
glow = f'<ellipse cx="{LIT_X:.0f}" cy="{LIT_Y:.0f}" rx="350" ry="300" fill="url(#litglow)" />'

motif = f'<g mask="url(#fadeY)"><g mask="url(#fadeX)">{glow}{"".join(plan)}</g></g>'

# ------------------------------------------------------------------- the words
def text(x, y, s, size, weight, fill, op=1.0, track=0.0):
    return (f'<text x="{x}" y="{y}" font-family="Inter, sans-serif" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" fill-opacity="{op}" '
            f'letter-spacing="{track}" xml:space="preserve">{s}</text>')


def caps(x, y, s_, size, weight, fill, op, track):
    return (f'<text x="{x}" y="{y}" font-family="Inter, sans-serif" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" fill-opacity="{op}" '
            f'letter-spacing="{track}" xml:space="preserve">{s_}</text>')


copy = [
    f'<rect x="{MARGIN}" y="892" width="64" height="4" rx="2" fill="{VIOLET}" />',
    text(MARGIN, 1010, "Hostel living.", 100, 700, WHITE, 1, -3.5),
    text(MARGIN, 1122, "Reimagined.", 100, 700, WHITE, 1, -3.5),
    text(MARGIN, 1222, "One smarter space to manage stays,", 35, 400, LAVENDER, 0.70),
    text(MARGIN, 1274, "spaces and everyday operations.", 35, 400, LAVENDER, 0.70),

    # the launch block
    f'<rect x="{MARGIN}" y="1340" width="{W-2*MARGIN}" height="1" fill="{LAVENDER}" fill-opacity="0.14" />',
    caps(MARGIN, 1396, "LAUNCHING", 21, 600, LAVENDER, 0.72, 5.2),
    text(MARGIN, 1482, "4 November 2026", 64, 700, WHITE, 1, -1.2),
    text(MARGIN, 1540, "Save the date.", 28, 400, LAVENDER, 0.62),

    # Forge endorsement: nook is a Forge product
    # baseline set on the lockup's optical centre, not its box foot
    caps(MARGIN, 1616, "A PRODUCT OF", 16, 600, LAVENDER, 0.55, 4.0),
    forge_lockup,
]

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"
     viewBox="0 0 {W} {H}" role="img" aria-label="nook — Hostel living. Reimagined.">
  <title>nook — Hostel living. Reimagined.</title>
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stop-color="{VIOLET}" stop-opacity="0.24" />
      <stop offset="55%"  stop-color="{VIOLET}" stop-opacity="0.07" />
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glow2" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stop-color="{VIOLET}" stop-opacity="0.12" />
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="litglow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stop-color="{LAVENDER}" stop-opacity="0.085" />
      <stop offset="100%" stop-color="{LAVENDER}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="lit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="{LAVENDER}" stop-opacity="0.13" />
      <stop offset="100%" stop-color="{LAVENDER}" stop-opacity="0.02" />
    </linearGradient>

    <linearGradient id="gY" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.25" />
      <stop offset="9%"   stop-color="#FFFFFF" stop-opacity="1" />
      <stop offset="66%"  stop-color="#FFFFFF" stop-opacity="1" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="gX" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.30" />
      <stop offset="8%"   stop-color="#FFFFFF" stop-opacity="1" />
      <stop offset="62%"  stop-color="#FFFFFF" stop-opacity="1" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.20" />
    </linearGradient>
    <mask id="fadeY">
      <rect x="0" y="{ROOM_TOP-30}" width="{W}" height="{OPP_BOT-ROOM_TOP+70}" fill="url(#gY)" />
    </mask>
    <mask id="fadeX"><rect width="{W}" height="{H}" fill="url(#gX)" /></mask>
  </defs>

  <rect width="{W}" height="{H}" fill="{INDIGO}" />
  <ellipse cx="900" cy="430" rx="780" ry="700" fill="url(#glow)" />
  <ellipse cx="60"  cy="1640" rx="620" ry="560" fill="url(#glow2)" />

  {motif}
  {wordmark}
  {"".join(copy)}
</svg>
'''

out = HERE / "nook-instagram-launch-nov-4.svg"
out.write_text(svg)
print(f"wrote {out.name}")
print("  motif: 4 rooms off a corridor, 15 units, 1 allocated (band compressed)")
print("  launch block: LAUNCHING / 4 November 2026 / Save the date.")
print(f"  endorsement: genuine Forge lockup, {FORGE_W:.0f}x{FORGE_H:.0f}px at ({FORGE_X:.0f},{FORGE_Y:.0f}), white on indigo")
print(f"  plan band y {ROOM_TOP:.0f}-{OPP_BOT:.0f}; wordmark {LOGO_W:.0f}x{LOGO_H:.1f} at ({LOGO_X},{LOGO_Y:.0f})")
