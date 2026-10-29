"""Hero pyramid (desert counterpart of igloo.drc + cage + outline).

ARGS: style = 'stepped' (default) | 'khafre' | 'cased', seed
Block layout and styles live in pyramid_lib (shared with the background
landmarks); this script adds the hero-only parts.

Builds, in collection S1_Dunes:
  PYR_Blocks   separate blocks with per-block attributes
               (_centr, _dir, _rand, _emission, _blockid, _course, _casing)
  PYR_Cap      gold capstone (khafre / cased only)
  PYR_Core     inner core, seen through the gaps when blocks separate
  PYR_Cage     wireframe blueprint lines (loose edges) for the build-in intro
  PYR_Outline  per-block outer-face outlines (loose edges) that follow blocks
  PYR_Edges    all 12 box edges of every block (loose edges), for the intro's
               drawn wireframe; carries _centr/_dir/_rand so it can move with blocks

Vector attributes are stored in three.js (Y-up) space, see opl.to_three.
"""
import sys, os, importlib, math
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import pyramid_lib; importlib.reload(pyramid_lib)
from pyramid_lib import W, H, N, CH, CAP_COURSE, DEPTH, RECESS, half
import bpy, bmesh
opl.use_scene('S1')
from mathutils import Vector

STYLE = ARGS.get('style', 'stepped')
SEED = int(ARGS.get('seed', 7))
GLOW_RATIO = 0.06

col = opl.collection('S1_Dunes')
for name in ('PYR_Blocks', 'PYR_Cap', 'PYR_Core', 'PYR_Cage', 'PYR_Outline', 'PYR_Edges'):
    opl.remove_object(name)

m_stone = bpy.data.materials.get('M_Sandstone') or opl.material('M_Sandstone')
m_gold = bpy.data.materials.get('M_Gold') or opl.material('M_Gold', (1.0, 0.7, 0.3, 1), 0.25, 1.0)
m_core = bpy.data.materials.get('M_Core') or opl.material('M_Core', (0.06, 0.045, 0.035, 1), 1.0)

# ---------------------------------------------------------------- blocks
pb = pyramid_lib.PyramidBuilder(STYLE, SEED)
blocks = pb.blocks
# Glow blocks: drawn right after the blocks so the sequence stays stable.
glow = set(pb.rng.sample(range(len(blocks)), max(1, int(len(blocks) * GLOW_RATIO))))

obj = pb.to_object('PYR_Blocks', col, m_stone)
me = obj.data
opl.set_attr(me, '_centr', pb.per_vertex('centr', opl.to_three), 'FLOAT_VECTOR')
opl.set_attr(me, '_dir', pb.per_vertex('dir', opl.to_three), 'FLOAT_VECTOR')
opl.set_attr(me, '_rand', pb.per_vertex('rand'))
opl.set_attr(me, '_emission', [1.0 if b in glow else 0.0 for b in pb.v_block])
opl.set_attr(me, '_blockid', [float(b) for b in pb.v_block])
opl.set_attr(me, '_course', pb.per_vertex('course', lambda k: k / (N - 1)))
opl.set_attr(me, '_casing', pb.per_vertex('casing', float))

# ---------------------------------------------------------------- capstone
# Khafre / cased only: the top courses are casing, and the capstone continues
# their face planes up to the apex.
if pb.has_cap:
    cap_z = CAP_COURSE * CH + 0.004
    cs = half(cap_z)
    bm = bmesh.new()
    base_v = [bm.verts.new((sx * cs, sy * cs, cap_z)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    apex = bm.verts.new((0, 0, H))
    bm.faces.new(list(reversed(base_v)))
    for i in range(4):
        bm.faces.new((base_v[i], base_v[(i + 1) % 4], apex))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=0.005,
                    offset_type='OFFSET', segments=2, profile=0.5, affect='EDGES',
                    clamp_overlap=True)
    cap = opl.mesh_object('PYR_Cap', bm, col, m_gold)
    cap.data.shade_smooth()
    cap.data.set_sharp_from_angle(angle=math.radians(40))

# ---------------------------------------------------------------- core
bm = bmesh.new()
for k in range(pb.last_course):
    casing = k >= pb.casing_from
    outer = half(k * CH) if casing else half((k + 1) * CH) - RECESS
    hs = outer - DEPTH + 0.03
    if hs < 0.02:                     # solid slab courses need no core
        continue
    vs = bmesh.ops.create_cube(bm, size=1.0)['verts']
    for v in vs:
        v.co = Vector((v.co.x * 2 * hs, v.co.y * 2 * hs, (k + 0.5 + v.co.z) * CH))
core = opl.mesh_object('PYR_Core', bm, col, m_core)

# ---------------------------------------------------------------- cage lines
bm = bmesh.new()
cage_t = []


def line(a, b):
    va, vb = bm.verts.new(a), bm.verts.new(b)
    bm.edges.new((va, vb))
    cage_t.extend([a[2] / H, b[2] / H])


for k in range(N + 1):
    z = k * CH
    hs = half(z)
    if hs < 1e-4:
        break
    pts = [(hs, hs, z), (-hs, hs, z), (-hs, -hs, z), (hs, -hs, z)]
    for i in range(4):
        line(pts[i], pts[(i + 1) % 4])
for cx, cy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
    line((cx * W / 2, cy * W / 2, 0), (0, 0, H))
cage = opl.mesh_object('PYR_Cage', bm, col)
opl.set_attr(cage.data, '_t', cage_t)

# ---------------------------------------------------------------- outlines
bm = bmesh.new()
o_centr, o_dir, o_rand = [], [], []
for b in blocks:
    vs = [bm.verts.new(p) for p in b['outline']]
    for i in range(4):
        bm.edges.new((vs[i], vs[(i + 1) % 4]))
    o_centr += [opl.to_three(b['centr'])] * 4
    o_dir += [opl.to_three(b['dir'])] * 4
    o_rand += [b['rand']] * 4
outline = opl.mesh_object('PYR_Outline', bm, col)
opl.set_attr(outline.data, '_centr', o_centr, 'FLOAT_VECTOR')
opl.set_attr(outline.data, '_dir', o_dir, 'FLOAT_VECTOR')
opl.set_attr(outline.data, '_rand', o_rand)

# ---------------------------------------------------------------- block edges
bm = bmesh.new()
e_centr, e_dir, e_rand = [], [], []
for b in blocks:
    for a, c in pb.box_edges(b):
        bm.edges.new((bm.verts.new(a), bm.verts.new(c)))
        e_centr += [opl.to_three(b['centr'])] * 2
        e_dir += [opl.to_three(b['dir'])] * 2
        e_rand += [b['rand']] * 2
edges = opl.mesh_object('PYR_Edges', bm, col)
opl.set_attr(edges.data, '_centr', e_centr, 'FLOAT_VECTOR')
opl.set_attr(edges.data, '_dir', e_dir, 'FLOAT_VECTOR')
opl.set_attr(edges.data, '_rand', e_rand)

cage.hide_render = outline.hide_render = edges.hide_render = True

opl.save()
print(f'style={STYLE} blocks={len(blocks)} glow={len(glow)} verts={len(me.vertices)} '
      f'tris={sum(len(p.vertices) - 2 for p in me.polygons)} H={H:.3f} course_h={CH:.3f}')
