#!/usr/bin/env python3
"""Repository README banner (1200 x 380 CSS, exported at 1x and 2x).

Genuine masters only:
  * nook wordmark  -- handbook/assets/svg/nook-logo-white.svg, verbatim
  * Forge lockup   -- marketing/brand/forge/FORGE-horizontal-white-on-ink.svg,
                      verbatim, its own background plate removed
Colour is Nook's approved five. Forge's ink and paper are not used; white is the
one colour both brands approve, and is Forge's own reversed fill.
"""
import pathlib, re

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parents[1]
NOOK = ROOT / "handbook" / "assets" / "svg"
FORGE = ROOT / "marketing" / "brand" / "forge"

W, H = 1200.0, 380.0
INDIGO, VIOLET, LAVENDER, WHITE = "#171338", "#7657F6", "#F4F1FF", "#FFFFFF"
PAD = 72.0

# ---------------------------------------------------------------- nook wordmark
master = (NOOK / "nook-logo-white.svg").read_text()
paths = re.findall(r"<(?:path|circle|ellipse|rect|polygon)\b[^>]*/>", master)
if len(paths) != 4:
    raise SystemExit(f"expected 4 elements in the nook master, read {len(paths)}")
vx, vy, vw, vh = (float(n) for n in re.search(r'viewBox="([^"]+)"', master).group(1).split())
LOGO_W = 236.0
ls = LOGO_W / vw
LOGO_X, LOGO_Y = PAD, 84.0
wordmark = (f'<g transform="translate({LOGO_X},{LOGO_Y}) scale({ls:.6f}) '
            f'translate({-vx},{-vy})">' + "".join(paths) + "</g>")

# ------------------------------------------------------------ Forge endorsement
fm = (FORGE / "FORGE-horizontal-white-on-ink.svg").read_text()
fgroups = re.findall(r"<g transform=\"[^\"]+\">.*?</g>", fm, re.S)
if len(fgroups) != 2 or fm.count('fill="#FFFFFF"') != 7:
    raise SystemExit("the Forge lockup master did not extract as the white variant")
FH = 26.0
fs = FH / 120.0
FW = 580.0 * fs
# the label is measured, not guessed, so the lockup never sits on it
LABEL = "A PRODUCT OF"
LABEL_W = len(LABEL) * 12 * 0.62 + (len(LABEL) - 1) * 3.2
FX, FY = PAD + LABEL_W + 26.0, 296.0
forge = (f'<g transform="translate({FX},{FY}) scale({fs:.6f})" opacity="0.72">'
         + "".join(fgroups) + "</g>")

# ------------------------------------------------------------------ plan motif
# The same spatial language as the launch artwork: rooms off a corridor, one
# unit allocated. Here it runs off the right edge as a quiet field.
RT, RB = 74.0, 232.0
CT, CB = 232.0, 276.0
OPP = 320.0
DOOR, UW, UH, UR = 34.0, 19.0, 46.0, 9.0
plan = []


def wall(x1, y1, x2, y2, op, col=VIOLET, w=1.2):
    plan.append(f'<path d="M{x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f}" stroke="{col}" '
                f'stroke-width="{w}" stroke-opacity="{op:.2f}" stroke-linecap="square"/>')


def room(x, w, n, lit=None, subject=False):
    col = LAVENDER if subject else VIOLET
    wop = 0.50 if subject else 0.20
    uop = 0.30 if subject else 0.14
    if subject:
        plan.append(f'<rect x="{x:.1f}" y="{RT}" width="{w:.1f}" height="{RB-RT}" fill="url(#lit)"/>')
    cx = x + w / 2
    wall(x, RT, x, RB, wop, col); wall(x + w, RT, x + w, RB, wop, col)
    wall(x, RT, x + w, RT, wop, col)
    wall(x, RB, cx - DOOR / 2, RB, wop, col); wall(cx + DOOR / 2, RB, x + w, RB, wop, col)
    span, uy = w - 28, RT + 26
    step = span / n
    for i in range(n):
        ux = x + 14 + step * i + (step - UW) / 2
        if ux > W + 12:
            continue
        if subject and i == lit:
            plan.append(f'<rect x="{ux:.1f}" y="{uy:.1f}" width="{UW}" height="{UH}" rx="{UR}" '
                        f'fill="{LAVENDER}" fill-opacity="0.85"/>')
            plan.append(f'<rect x="{ux-5:.1f}" y="{uy-5:.1f}" width="{UW+10}" height="{UH+10}" '
                        f'rx="{UR+5}" fill="none" stroke="{LAVENDER}" stroke-width="1.3" '
                        f'stroke-opacity="0.40"/>')
        else:
            plan.append(f'<rect x="{ux:.1f}" y="{uy:.1f}" width="{UW}" height="{UH}" rx="{UR}" '
                        f'fill="none" stroke="{col}" stroke-width="1.2" stroke-opacity="{uop:.2f}"/>')


plan.append(f'<rect x="604" y="{CT}" width="{W-604+40}" height="{CB-CT}" '
            f'fill="{VIOLET}" fill-opacity="0.05"/>')
room(640.0, 196, 4, lit=2, subject=True)
room(860.0, 212, 4)
room(1096.0, 180, 3)
wall(604, CB, W + 40, CB, 0.15)
for ox, ow in ((648.0, 200), (872.0, 210), (1106.0, 160)):
    wall(ox, CB, ox, OPP, 0.12); wall(ox + ow, CB, ox + ow, OPP, 0.12)

motif = ('<g mask="url(#fadeY)"><g mask="url(#fadeX)">'
         f'<ellipse cx="738" cy="153" rx="230" ry="200" fill="url(#litglow)"/>'
         + "".join(plan) + "</g></g>")


def text(x, y, s, size, weight, fill, op=1.0, track=0.0):
    return (f'<text x="{x}" y="{y}" font-family="Inter, sans-serif" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" fill-opacity="{op}" '
            f'letter-spacing="{track}" xml:space="preserve">{s}</text>')


svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}"
     viewBox="0 0 {W:.0f} {H:.0f}" role="img"
     aria-label="nook — the hostel and PG management platform, a product of Forge">
  <title>nook — hostel and PG management platform</title>
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="{VIOLET}" stop-opacity="0.26"/>
      <stop offset="55%" stop-color="{VIOLET}" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="litglow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="{LAVENDER}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="{LAVENDER}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="lit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{LAVENDER}" stop-opacity="0.13"/>
      <stop offset="100%" stop-color="{LAVENDER}" stop-opacity="0.02"/>
    </linearGradient>
    <linearGradient id="gX" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FFF" stop-opacity="0"/>
      <stop offset="14%" stop-color="#FFF" stop-opacity="1"/>
      <stop offset="78%" stop-color="#FFF" stop-opacity="1"/>
      <stop offset="100%" stop-color="#FFF" stop-opacity="0.28"/>
    </linearGradient>
    <linearGradient id="gY" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFF" stop-opacity="1"/>
      <stop offset="62%" stop-color="#FFF" stop-opacity="1"/>
      <stop offset="100%" stop-color="#FFF" stop-opacity="0"/>
    </linearGradient>
    <mask id="fadeX"><rect width="{W:.0f}" height="{H:.0f}" fill="url(#gX)"/></mask>
    <mask id="fadeY"><rect x="0" y="{RT-10}" width="{W:.0f}" height="{OPP-RT+40}" fill="url(#gY)"/></mask>
  </defs>

  <rect width="{W:.0f}" height="{H:.0f}" fill="{INDIGO}"/>
  <ellipse cx="880" cy="60" rx="520" ry="400" fill="url(#glow)"/>
  {motif}
  {wordmark}
  {text(PAD, 216, "The hostel and PG management platform.", 21, 400, LAVENDER, 0.72)}
  {text(PAD, 246, "Bed-level inventory, immutable financial records, one tenant boundary.", 16, 400, LAVENDER, 0.46)}
  {text(PAD, 314, LABEL, 12, 600, LAVENDER, 0.52, 3.2)}
  {forge}
</svg>
'''
out = HERE / "readme-banner.svg"
out.write_text(svg)
print(f"wrote {out.name}  ({W:.0f}x{H:.0f})")
print(f"  nook wordmark {LOGO_W:.0f}px at y{LOGO_Y:.0f}, Forge lockup {FW:.0f}x{FH:.0f}px at x{FX:.0f}")
print(f"  label width {LABEL_W:.0f}px, gap to lockup {FX-PAD-LABEL_W:.0f}px")
