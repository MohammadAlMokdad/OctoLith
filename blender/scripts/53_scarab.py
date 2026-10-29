"""RELIC_Scarab (slot 2, inside CRY_2): winged scarab with its back to the
viewer. Lapis beetle, gold feathered wings with lapis/carnelian inlay,
carnelian sun disk held above, gold shen ring gripped below.
"""
import sys, os, importlib, math
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import relic_lib; importlib.reload(relic_lib)
from relic_lib import Part, ellipsoid, torus, box, disk, tube, GOLD, LAPIS, CARNELIAN
import bpy, bmesh
from mathutils import Matrix

opl.use_scene('S2')
col = opl.collection('S2_Vault')

scar = Part()
SX = 0.28                                              # sit it away from the broken end
for s in (-1, 1):                                      # two wing cases with a seam
    half = ellipsoid((0, 0, -0.08), (0.25, 0.15, 0.3))
    for v in half.verts:
        if v.co.y > 0:
            v.co.y *= 0.3
    geom = list(half.verts) + list(half.edges) + list(half.faces)
    bmesh.ops.bisect_plane(half, geom=geom, dist=1e-6, plane_co=(0, 0, 0),
                           plane_no=(-s, 0, 0), clear_outer=True)
    bmesh.ops.holes_fill(half, edges=list(half.edges), sides=0)
    scar.add(half, LAPIS, Matrix.Translation((SX + 0.006 * s, 0, 0)))
pron = ellipsoid((SX, 0, 0.29), (0.24, 0.13, 0.11))
for v in pron.verts:
    if v.co.y > 0:
        v.co.y *= 0.3
scar.add(pron, LAPIS)
# Head plate with the serrated clypeus.
outline = []
for k in range(13):
    a = math.pi * k / 12
    r = 0.15 if k % 2 == 0 else 0.128
    outline.append((SX + r * math.cos(a), r * math.sin(a) * 0.8))
head = bmesh.new()
face = head.faces.new([head.verts.new((x, 0, z)) for x, z in outline])
ext = bmesh.ops.extrude_face_region(head, geom=[face])
bmesh.ops.translate(head, verts=[v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)],
                    vec=(0, 0.05, 0))
bmesh.ops.recalc_face_normals(head, faces=list(head.faces))
bmesh.ops.bevel(head, geom=list(head.edges), offset=0.006, segments=2, affect='EDGES',
                clamp_overlap=True)
scar.add(head, LAPIS, Matrix.Translation((0, -0.09, 0.37)))
# Sun disk held up by the front legs; shen ring gripped by the back legs.
scar.add(disk((SX, -0.03, 0.66), 0.15, 0.045), CARNELIAN)
scar.add(torus((SX, -0.03, 0.66), 0.15, 0.015), GOLD)
scar.add(torus((SX, -0.02, -0.55), 0.1, 0.022), GOLD)
scar.add(box((SX, -0.02, -0.66), (0.14, 0.022, 0.024), bevel=0.008), GOLD)
for s in (-1, 1):
    scar.add(tube([(SX + 0.1 * s, -0.03, 0.36), (SX + 0.2 * s, -0.05, 0.46),
                   (SX + 0.14 * s, -0.05, 0.56), (SX + 0.08 * s, -0.04, 0.6)],
                  [0.02, 0.018, 0.016, 0.014]), GOLD)
    scar.add(tube([(SX + 0.12 * s, -0.02, -0.3), (SX + 0.2 * s, -0.04, -0.42),
                   (SX + 0.14 * s, -0.04, -0.5), (SX + 0.08 * s, -0.03, -0.52)],
                  [0.02, 0.018, 0.016, 0.014]), GOLD)
    # Wings: hanging feathers along a top bar, longer toward the tip, fanning outward.
    n_f = 10
    for j in range(n_f):
        t = j / (n_f - 1)
        x = SX + s * (0.22 + t * 0.4)
        top = 0.16 + 0.04 * t * t
        length = 0.18 + 0.26 * t
        fan = Matrix.Translation((x, 0.02, top)) @ Matrix.Rotation(-s * math.radians(3 + 12 * t), 4, 'Y')
        scar.add(box((0, 0, -length / 2), (0.034, 0.016, length / 2), bevel=0.01), GOLD, fan)
        scar.add(box((0, -0.017, -length / 2 - 0.02), (0.009, 0.004, length / 2 - 0.05)),
                 LAPIS, fan)
        scar.add(box((0, -0.02, -0.045), (0.036, 0.012, 0.045), bevel=0.008), CARNELIAN, fan)
    scar.add(box((SX + s * 0.42, 0.0, 0.215), (0.22, 0.02, 0.028), bevel=0.01), GOLD)

relic_lib.finalize('RELIC_Scarab', scar.bm, col, slot=2, crystal_name='CRY_2')
opl.save()
