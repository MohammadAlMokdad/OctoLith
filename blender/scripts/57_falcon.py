"""RELIC_Falcon (slot 3, inside the crystal obelisk CRY_3): a Horus falcon
statuette wearing the double crown of Egypt.

  gold body         upright egg-shaped body, folded wings with lapis feather
                    bands, tail down to the plinth, hooked beak, talons
  face              obsidian eyes, lapis kohl line and Horus's malar "tear"
                    stripe (the origin of the Eye of Horus)
  double crown      red deshret in carnelian (brand orange) with its tall back
                    and gold curl; white hedjet in alabaster rising from it
  plinth            gold block with a lapis band

Built facing -Y, then turned three-quarters to the camera.
"""
import sys, os, importlib, math
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import relic_lib; importlib.reload(relic_lib)
from relic_lib import (Part, ellipsoid, box, lathe, tube,
                       GOLD, LAPIS, CARNELIAN, OBSIDIAN, ALABASTER)
import bpy, bmesh
from mathutils import Vector, Matrix

opl.use_scene('S2')
col = opl.collection('S2_Vault')
TURN = math.radians(-35)          # beak toward camera-left

fal = Part()

# ---------------------------------------------------------------- body + head
def body_shape(v, grow=1.0):
    """Upright egg: full chest, narrow base, chest pushed slightly forward."""
    x, y, z = v.co
    w = (1.0 + 0.15 * z - 0.3 * max(0.0, -z) ** 2) * grow
    v.co = Vector((x * 0.19 * w, y * 0.21 * w - 0.04 * z, z * 0.34 * (1 + (grow - 1) * 0.3) - 0.12))


body = ellipsoid((0, 0, 0), (1, 1, 1), (48, 28))
for v in body.verts:
    body_shape(v)
fal.add(body, GOLD)
fal.add(ellipsoid((0, -0.01, 0.2), (0.115, 0.125, 0.12)), GOLD)        # neck
fal.add(ellipsoid((0, -0.035, 0.325), (0.118, 0.13, 0.12)), GOLD)      # head
fal.add(ellipsoid((0, -0.14, 0.345), (0.04, 0.035, 0.03), (24, 12)), GOLD)    # cere
fal.add(tube([(0, -0.145, 0.34), (0, -0.2, 0.33), (0, -0.235, 0.295),
              (0, -0.23, 0.255), (0, -0.21, 0.24)],
             [0.048, 0.038, 0.026, 0.014, 0.004]), GOLD)                # hooked beak

for s in (-1, 1):
    fal.add(ellipsoid((0.078 * s, -0.112, 0.355), (0.03, 0.024, 0.028), (24, 12)), OBSIDIAN)
    fal.add(tube([(0.066 * s, -0.132, 0.357), (0.094 * s, -0.09, 0.362), (0.11 * s, -0.035, 0.352)],
                 [0.01, 0.011, 0.006]), LAPIS)                          # kohl line
    fal.add(tube([(0.082 * s, -0.115, 0.33), (0.092 * s, -0.11, 0.285),
                  (0.098 * s, -0.096, 0.245), (0.106 * s, -0.08, 0.226)],
                 [0.012, 0.014, 0.017, 0.019]), LAPIS)                  # malar tear stripe

    # Folded wing: an inflated copy of the body surface, kept on this side and
    # below the shoulder, tips swept back past the tail, given thickness.
    # Lapis cloisonne follows the shell: two covert bands, then primary stripes.
    wing = ellipsoid((0, 0, 0), (1, 1, 1), (72, 40))
    for v in wing.verts:
        body_shape(v, grow=1.08)
    for co, no in (((0.07 * s, 0, 0), (-s, 0, 0)), ((0, 0, 0.13), (0, 0, 1))):
        geom = list(wing.verts) + list(wing.edges) + list(wing.faces)
        bmesh.ops.bisect_plane(wing, geom=geom, dist=1e-6, plane_co=co, plane_no=no, clear_outer=True)
    for v in wing.verts:
        low = max(0.0, -0.22 - v.co.z)
        v.co.y += low * 0.9                              # sweep the tips back...
        v.co.z -= low * 0.25                             # ...and down past the tail
    for f in wing.faces:
        c = f.calc_center_median()
        if c.z < -0.27:
            f.material_index = LAPIS if int((c.y + 0.4) / 0.045) % 2 else GOLD
        elif -0.19 < c.z < -0.15 or -0.1 < c.z < -0.06:
            f.material_index = LAPIS
        else:
            f.material_index = GOLD
    bmesh.ops.solidify(wing, geom=list(wing.faces), thickness=0.016)
    fal.add(wing, None)

    # Legs and talons standing on the plinth.
    fal.add(tube([(0.06 * s, -0.04, -0.42), (0.064 * s, -0.05, -0.52), (0.066 * s, -0.06, -0.6)],
                 [0.03, 0.026, 0.022]), GOLD)
    for t in (-1, 0, 1):
        fal.add(tube([(0.066 * s, -0.06, -0.6), (0.066 * s + 0.02 * t, -0.11, -0.612),
                      (0.066 * s + 0.03 * t, -0.14, -0.62)], [0.013, 0.011, 0.006]), GOLD)

# Tail angled down to the plinth, with a lapis stripe.
tail_m = Matrix.Translation((0, 0.17, -0.5)) @ Matrix.Rotation(math.radians(-25), 4, 'X')
fal.add(box((0, 0, 0), (0.07, 0.03, 0.14), bevel=0.012, taper_z=(1.25, 0.8)), GOLD, tail_m)
fal.add(box((0, 0.031, 0), (0.02, 0.004, 0.12)), LAPIS, tail_m)

# Plinth.
fal.add(box((0, 0.02, -0.665), (0.2, 0.22, 0.04), bevel=0.01), GOLD)
fal.add(box((0, 0.02, -0.665), (0.203, 0.223, 0.012)), LAPIS)

# ---------------------------------------------------------------- double crown
# Red crown (deshret): a band hugging the head, a tall back, and the gold curl.
fal.add(lathe([(0.118, 0.4), (0.122, 0.44), (0.118, 0.475)], center=(0, -0.01, 0), seg=48), CARNELIAN)
fal.add(box((0, 0.07, 0.56), (0.1, 0.035, 0.14), bevel=0.012), CARNELIAN)
fal.add(tube([(0, -0.1, 0.46), (0, -0.14, 0.51), (0, -0.17, 0.57), (0, -0.165, 0.61),
              (0, -0.135, 0.615), (0, -0.125, 0.59)],
             [0.012, 0.011, 0.01, 0.009, 0.008, 0.007]), GOLD)
# White crown (hedjet): tall bulbous cone ending in a knob.
fal.add(lathe([(0.086, 0.44), (0.092, 0.5), (0.082, 0.6), (0.064, 0.7), (0.05, 0.75),
               (0.056, 0.78), (0.046, 0.82), (0.0, 0.84)], center=(0, -0.01, 0), seg=48), ALABASTER)

bm = fal.bm
bmesh.ops.rotate(bm, verts=list(bm.verts), cent=(0, 0, 0), matrix=Matrix.Rotation(TURN, 3, 'Z'))
relic_lib.finalize('RELIC_Falcon', bm, col, slot=3, crystal_name='CRY_3')

# The plain ankh it replaces is retired.
old = bpy.data.objects.get('RELIC_Ankh')
if old:
    opl.remove_object('RELIC_Ankh')
opl.save()
