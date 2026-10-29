"""Trace the logo wordmark (OCTOLITH in Papyrus) into an SVG of outlines.

Papyrus isn't a free web font, so the logo is shipped as outlines: it looks the
same for every visitor whether or not they have the font. Needs the font file
and fontTools (python -m pip install fonttools).

usage (from the repo root):
  python tools/wordmark.py [--text OCTOLITH] [--tracking 0] [--fill #FFF8EE]
                           [--font C:/Windows/Fonts/PAPYRUS.TTF]
                           [--out brand/octolith-wordmark.svg]

--tracking is extra space between letters, in em. Coordinates are scaled so
the cap height is 100 units and rounded to whole units (0.2 px at logo size).
The fill is baked into the file: change it here, not in CSS.
"""
import argparse
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ap = argparse.ArgumentParser()
ap.add_argument('--text', default='OCTOLITH')
ap.add_argument('--tracking', type=float, default=0.0)
ap.add_argument('--fill', default='#FFF8EE')
ap.add_argument('--font', default='C:/Windows/Fonts/PAPYRUS.TTF')
ap.add_argument('--out', default='brand/octolith-wordmark.svg')
args = ap.parse_args()

font = TTFont(args.font)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font['head'].unitsPerEm

# scale: the H's height -> 100 units
bounds = BoundsPen(glyphs)
glyphs[cmap[ord('H')]].draw(bounds)
k = 100.0 / bounds.bounds[3]

# lay the letters out on their advances (Papyrus has no kerning table)
placed = []
x = 0
for ch in args.text:
    name = cmap[ord(ch)]
    placed.append((name, x))
    x += glyphs[name].width + args.tracking * upm
bounds = BoundsPen(glyphs)
for name, gx in placed:
    glyphs[name].draw(TransformPen(bounds, (1, 0, 0, 1, gx, 0)))
x0, y0, x1, y1 = bounds.bounds

# one path: y flipped, the word's top-left at 0,0
pen = SVGPathPen(glyphs, ntos=lambda v: str(round(v)))
for name, gx in placed:
    glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, (gx - x0) * k, y1 * k)))
w, h = (x1 - x0) * k, (y1 - y0) * k
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}">'
    f'<path fill="{args.fill}" d="{pen.getCommands()}"/></svg>\n'
)
with open(args.out, 'w') as f:
    f.write(svg)
print(f'{args.out}: {w:.0f} x {h:.0f} (aspect {w / h:.2f}), {len(svg) // 1024} KB')
print(f'set the <img> width/height in index.html to {round(w)} / {round(h)}')
