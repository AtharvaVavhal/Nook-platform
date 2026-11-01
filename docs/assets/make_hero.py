#!/usr/bin/env python3
"""Animated isometric hero for the repository README (1200 x 470).

Why an animated SVG and not a GIF: GitHub strips <script> and <style> from
markdown, but a .svg loaded through <img> is a separate resource, so CSS inside
it survives and plays. Vector also keeps the indigo/violet gradients clean --
a GIF would band them badly at this size.

The subject is the building Nook manages, drawn in axonometric projection:
floor plates that separate to show bed-level occupancy, with one bed allocated.
It is the 3D building view the handbook specifies, not decoration.

Brand rules (nook-brand-guidelines.md):
  * the wordmark is the genuine master, geometry verbatim, and is NEVER
    animated, rotated, skewed or scaled non-uniformly (7.1, 7.2);
  * nothing strokes, shadows or gradients the mark (7.5);
  * no house, bed, roof, key or pin icon -- the building has flat floor plates
    and no pitched roof, and sits far from the mark (7.9);
  * approved palette only. Forge's ink and paper are unused; white is the one
    colour both brands approve and is Forge's own reversed fill.
"""
import math, pathlib, re

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parents[1]
NOOK = ROOT / "handbook" / "assets" / "svg"
FORGE = ROOT / "marketing" / "brand" / "forge"

W, H = 1200.0, 470.0
INDIGO, VIOLET, LAVENDER, WHITE = "#171338", "#7657F6", "#F4F1FF", "#FFFFFF"
PAD = 72.0

COS30, SIN30 = math.cos(math.radians(30)), 0.5
OX, OY = 840.0, 250.0          # where world (0,0,0) lands on the canvas


def iso(x, y, z):
    return (OX + (x - y) * COS30, OY + (x + y) * SIN30 - z)


def poly(pts, fill="none", stroke=None, sw=1.2, op=1.0, sop=1.0, extra=""):
    d = " ".join(f"{px:.1f},{py:.1f}" for px, py in pts)
    s = f'<polygon points="{d}" fill="{fill}" fill-opacity="{op}"'
    if stroke:
        s += f' stroke="{stroke}" stroke-width="{sw}" stroke-opacity="{sop}"'
    return s + f" {extra}/>"


# ------------------------------------------------------------------- building
BW, BD, TH = 210.0, 142.0, 11.0        # footprint and slab thickness
GAP = 74.0                              # vertical separation when opened
STAG = 0.0                              # no horizontal stagger: the beds sit on
                                        # each plate's front edge instead, which is
                                        # the band the floor above does not cover
FLOORS = 4
ROOMS, BEDS = 3, 4
LIT_FLOOR, LIT_ROOM, LIT_BED = 1, 1, 2

parts = []
for f in range(FLOORS):
    z = f * GAP
    top = [iso(0, 0, z), iso(BW, 0, z), iso(BW, BD, z), iso(0, BD, z)]
    fx = [iso(BW, 0, z), iso(BW, BD, z), iso(BW, BD, z - TH), iso(BW, 0, z - TH)]
    fy = [iso(0, BD, z), iso(BW, BD, z), iso(BW, BD, z - TH), iso(0, BD, z - TH)]

    g = [f'<g transform="translate({f * STAG:.1f},0)"><g class="fl f{f}">']
    # the two visible side faces, then the deck
    g.append(poly(fy, fill=INDIGO, op=1))
    g.append(poly(fy, fill=VIOLET, op=0.17))
    g.append(poly(fx, fill=INDIGO, op=1))
    g.append(poly(fx, fill=VIOLET, op=0.09))
    # an opaque backing first, so an upper plate occludes the one beneath it
    g.append(poly(top, fill=INDIGO, op=1))
    g.append(poly(top, fill=f"url(#deck{f})", stroke=VIOLET, sw=1.1, sop=0.42))

    # rooms across the plate, beds inside each
    mx, my = 16.0, 14.0
    rw = (BW - 2 * mx) / ROOMS
    for r in range(ROOMS):
        rx = mx + r * rw
        rpts = [iso(rx + 4, my, z), iso(rx + rw - 4, my, z),
                iso(rx + rw - 4, BD - my, z), iso(rx + 4, BD - my, z)]
        g.append(poly(rpts, stroke=VIOLET, sw=0.9, sop=0.26))
        bw_ = (rw - 8) / BEDS
        for b in range(BEDS):
            bx = rx + 4 + b * bw_
            inset, bd_ = 2.2, 30.0
            by = BD - my - 6 - bd_          # front edge, clear of the plate above
            cell = [iso(bx + inset, by, z), iso(bx + bw_ - inset, by, z),
                    iso(bx + bw_ - inset, by + bd_, z), iso(bx + inset, by + bd_, z)]
            if (f, r, b) == (LIT_FLOOR, LIT_ROOM, LIT_BED):
                g.append(poly(cell, fill=LAVENDER, op=0.9, extra='class="bed lit"'))
                cx, cy = iso(bx + bw_ / 2, by + bd_ / 2, z)
                g.append(f'<circle class="halo" cx="{cx:.1f}" cy="{cy:.1f}" r="34" '
                         f'fill="url(#halo)"/>')
            else:
                occupied = (f * 7 + r * 3 + b) % 3 != 0
                g.append(poly(cell, fill=LAVENDER if occupied else "none",
                              op=0.16 if occupied else 0,
                              stroke=LAVENDER, sw=0.8, sop=0.30, extra='class="bed"'))
    g.append("</g></g>")
    parts.append("".join(g))

# elevation guides, visible only while the plates are apart
guides = []
for cx_, cy_ in ((0.0, 0.0), (BW, 0.0), (BW, BD), (0.0, BD)):
    a = iso(cx_, cy_, -14)
    b = iso(cx_, cy_, (FLOORS - 1) * GAP + 26)
    bx = b[0] + (FLOORS - 1) * STAG
    guides.append(f'<path class="guide" d="M{a[0]:.1f},{a[1]:.1f} L{bx:.1f},{b[1]:.1f}" '
                  f'stroke="{VIOLET}" stroke-width="1" stroke-dasharray="3 7"/>')

decks = "".join(
    f'<linearGradient id="deck{f}" x1="0" y1="0" x2="0.7" y2="1">'
    f'<stop offset="0%" stop-color="{VIOLET}" stop-opacity="{0.30 - f*0.045:.3f}"/>'
    f'<stop offset="100%" stop-color="{VIOLET}" stop-opacity="{0.12 - f*0.02:.3f}"/>'
    f"</linearGradient>" for f in range(FLOORS))

# ------------------------------------------------------------------ wordmark
master = (NOOK / "nook-logo-white.svg").read_text()
mp = re.findall(r"<(?:path|circle|ellipse|rect|polygon)\b[^>]*/>", master)
if len(mp) != 4:
    raise SystemExit(f"expected 4 elements in the nook master, read {len(mp)}")
vx, vy, vw, vh = (float(n) for n in re.search(r'viewBox="([^"]+)"', master).group(1).split())
LW = 236.0
ls = LW / vw
wordmark = (f'<g transform="translate({PAD},110) scale({ls:.6f}) translate({-vx},{-vy})">'
            + "".join(mp) + "</g>")

# ------------------------------------------------------------ Forge endorsement
fm = (FORGE / "FORGE-horizontal-white-on-ink.svg").read_text()
fg = re.findall(r"<g transform=\"[^\"]+\">.*?</g>", fm, re.S)
if len(fg) != 2 or fm.count('fill="#FFFFFF"') != 7:
    raise SystemExit("the Forge lockup master did not extract as the white variant")
FH = 26.0
fs = FH / 120.0
LABEL = "A PRODUCT OF"
LABEL_W = len(LABEL) * 12 * 0.62 + (len(LABEL) - 1) * 3.2
forge = (f'<g transform="translate({PAD + LABEL_W + 26:.1f},352) scale({fs:.6f})" '
         f'opacity="0.72">' + "".join(fg) + "</g>")


def text(x, y, s, size, weight, fill, op=1.0, track=0.0, cls=""):
    c = f' class="{cls}"' if cls else ""
    return (f'<text{c} x="{x}" y="{y}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" '
            f'font-size="{size}" font-weight="{weight}" fill="{fill}" fill-opacity="{op}" '
            f'letter-spacing="{track}">{s}</text>')


# Floors settle closed, hold, open again. Authored OPEN, so a renderer that
# ignores the animation still shows the informative state.
css = """
  .fl { animation: settle 11s cubic-bezier(.45,.02,.25,1) infinite; }
  .f0 { animation-delay: 0s; }
  .f1 { animation-delay: .10s; }
  .f2 { animation-delay: .20s; }
  .f3 { animation-delay: .30s; }
  @keyframes settle {
    0%, 6%    { transform: translate(0, 0); }
    30%, 52%  { transform: translate(var(--slide), var(--drop)); }
    78%, 100% { transform: translate(0, 0); }
  }
  .f0 { --drop: 0px;   --slide: 0px; }
  .f1 { --drop: 40px;  --slide: 0px; }
  .f2 { --drop: 80px;  --slide: 0px; }
  .f3 { --drop: 120px; --slide: 0px; }

  .guide { animation: guides 11s ease-in-out infinite; stroke-opacity: .22; }
  @keyframes guides {
    0%, 6%   { stroke-opacity: .22; }
    30%, 52% { stroke-opacity: 0; }
    78%,100% { stroke-opacity: .22; }
  }

  .lit  { animation: pulse 3.4s ease-in-out infinite; }
  .halo { animation: pulse 3.4s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { opacity: .62; }
    50%      { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .fl, .guide, .lit, .halo { animation: none; }
  }
"""

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}"
     viewBox="0 0 {W:.0f} {H:.0f}" role="img"
     aria-label="nook — bed-level inventory across a building's floors. A product of Forge.">
  <title>nook — the hostel and PG management platform</title>
  <defs>
    <style>{css}</style>
    <radialGradient id="amb" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="{VIOLET}" stop-opacity="0.28"/>
      <stop offset="55%" stop-color="{VIOLET}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="{LAVENDER}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="{LAVENDER}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ground" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="{VIOLET}" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0"/>
    </radialGradient>
    {decks}
  </defs>

  <rect width="{W:.0f}" height="{H:.0f}" fill="{INDIGO}"/>
  <ellipse cx="880" cy="70" rx="540" ry="420" fill="url(#amb)"/>
  <ellipse cx="{OX}" cy="{OY + 118}" rx="300" ry="78" fill="url(#ground)"/>

  {"".join(guides)}
  {"".join(parts)}

  {wordmark}
  {text(PAD, 228, "The hostel and PG management platform.", 21, 400, LAVENDER, 0.72)}
  {text(PAD, 260, "Bed-level inventory, immutable financial records, one tenant boundary.", 16, 400, LAVENDER, 0.46)}
  {text(PAD, 370, LABEL, 12, 600, LAVENDER, 0.52, 3.2)}
  {forge}
</svg>
'''

out = HERE / "readme-hero.svg"
out.write_text(svg)
print(f"wrote {out.name}  ({W:.0f}x{H:.0f}, {len(svg)/1024:.1f} KB)")
print(f"  stagger {STAG:.0f}px per floor, vertical gap {GAP:.0f}px")
print(f"  {FLOORS} floor plates, {ROOMS}x{BEDS} beds each, 1 allocated on floor {LIT_FLOOR}")
print(f"  animation: 11s settle/open loop, 3.4s allocation pulse, reduced-motion respected")
