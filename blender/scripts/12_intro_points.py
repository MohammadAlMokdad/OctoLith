"""Intro point cloud (igloo: intro_particles.drc).

Points on the hero pyramid's outer faces plus a scatter on the sand around it.
Rendered on the web as hieroglyph glyph sprites that cycle outward from the
centre during the intro.

Attributes: _rand (glyph pick / flicker phase), _t (normalised distance from
the pyramid axis, drives the outward sweep), _onpyr (1 on pyramid, 0 on sand).
"""
import sys, os, importlib, math, random
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy, bmesh
opl.use_scene('S1')
from mathutils import Vector
from mathutils.bvhtree import BVHTree

rng = random.Random(21)
col = opl.collection('S1_Dunes')
opl.remove_object('PYR_IntroPoints')

blocks = bpy.data.objects['PYR_Blocks']
ground = bpy.data.objects['DUNE_Base']
W = 5.0
H = W / 2 * math.tan(math.radians(51.84))
N_PYR, N_SAND, R_MAX = 460, 180, 9.0

bvh_pyr = BVHTree.FromObject(blocks, bpy.context.evaluated_depsgraph_get())
bvh_gnd = BVHTree.FromObject(ground, bpy.context.evaluated_depsgraph_get())

points = []
# Cast rays inward from a slightly inflated pyramid shell so points land on
# the outward-facing block faces.
while len(points) < N_PYR:
    side = rng.randrange(4)
    t = rng.random() ** 1.3                      # denser toward the base
    half = W / 2 * (1 - t) + 0.3
    u = rng.uniform(-half, half)
    z = t * H
    nrm = [Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((-1, 0, 0)), Vector((0, -1, 0))][side]
    tan = Vector((-nrm.y, nrm.x, 0))
    origin = nrm * (half + 0.5) + tan * u + Vector((0, 0, z))
    hit, normal, _, _ = bvh_pyr.ray_cast(origin, -nrm, 3.0)
    if hit is not None:
        points.append((hit + normal * 0.01, 1.0))

while len(points) < N_PYR + N_SAND:
    a = rng.uniform(0, 2 * math.pi)
    r = 3.0 + (R_MAX - 3.0) * math.sqrt(rng.random())
    x, y = r * math.cos(a), r * math.sin(a)
    hit, _, _, _ = bvh_gnd.ray_cast(Vector((x, y, 50)), Vector((0, 0, -1)), 100)
    if hit is not None:
        points.append((hit + Vector((0, 0, 0.02)), 0.0))

bm = bmesh.new()
for p, _ in points:
    bm.verts.new(p)
obj = opl.mesh_object('PYR_IntroPoints', bm, col)
obj.hide_render = True
opl.set_attr(obj.data, '_rand', [rng.random() for _ in points])
opl.set_attr(obj.data, '_t', [min(p.xy.length / R_MAX, 1.0) for p, _ in points])
opl.set_attr(obj.data, '_onpyr', [o for _, o in points])

opl.save()
print('intro points', len(points))
