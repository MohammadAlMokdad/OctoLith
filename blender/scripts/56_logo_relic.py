"""RELIC_OctoAnkh: the OctoPyramid octopus mark (brand/octopus-mark.svg) built
as an Egyptian ankh relic. The mark already reads as an ankh (head = loop,
horizontal arms = crossbar, bottom arm = shaft), so the outline is used as is.

  gold body       exact SVG outline, extruded with a rounded bevel
  carnelian inlay the same outline inset (curve offset), front and back, in
                  the brand orange #FF4B1F
  lapis cabochon  domed jewel where the arms meet

Sized for the square knapped block CRY_1 (slot 1) and sharing its origin.
Uses the shared relic material slots from relic_lib.
"""
import sys, os, importlib, math, re
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import relic_lib; importlib.reload(relic_lib)
from relic_lib import GOLD, LAPIS, CARNELIAN
import bpy, bmesh
from mathutils import Vector, Matrix

scene = opl.use_scene('S2')
col = opl.collection('S2_Vault')
SVG = os.path.join(opl.ROOT, 'brand', 'octopus-mark.svg')
WIDTH = 1.36                 # logo width in metres inside CRY_1 (1.72 across)
HALF_T = 0.055               # half thickness of the gold body (before bevel)
BEVEL = 0.014
INSET = 0.024                # how far the carnelian inlay sits inside the outline

opl.remove_object('RELIC_OctoAnkh')

# ---------------------------------------------------------------- parse SVG
# A small exact path parser (M L H V C S Z, absolute + relative, implicit
# repeats) instead of the SVG importer, which drops the closing curve's handle
# at the start point and leaves zero-length handles on straight segments.
TOKEN = re.compile(r'[MmLlHhVvCcSsZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')


def parse_path(d):
    toks = TOKEN.findall(d)
    i, cmd = 0, None
    paths, nodes = [], None                  # node = [co, handle_in, handle_out]
    cur = start = (0.0, 0.0)
    last_cp = None

    def num():
        nonlocal i
        i += 1
        return float(toks[i - 1])

    while i < len(toks):
        if toks[i].isalpha():
            cmd = toks[i]
            i += 1
            if cmd in 'Zz':
                # Relative paths drift by rounding, so allow 0.1 SVG units.
                if nodes and len(nodes) > 1 and math.dist(nodes[-1][0], nodes[0][0]) < 0.1:
                    nodes[0][1] = nodes.pop()[1]     # closing segment lands on the start
                cur, last_cp = start, None
                continue
        rel = cmd.islower()
        ox, oy = cur if rel else (0.0, 0.0)
        c = cmd.upper()
        if c == 'M':
            cur = start = (num() + ox, num() + oy)
            nodes = [[cur, None, None]]
            paths.append(nodes)
            cmd = 'l' if rel else 'L'            # further pairs are line-tos
            last_cp = None
        elif c in 'LHV':
            if c == 'L':
                cur = (num() + ox, num() + oy)
            elif c == 'H':
                cur = (num() + (cur[0] if rel else 0.0), cur[1])
            else:
                cur = (cur[0], num() + (cur[1] if rel else 0.0))
            nodes.append([cur, None, None])
            last_cp = None
        elif c in 'CS':
            if c == 'C':
                cp1 = (num() + ox, num() + oy)
            else:                                # reflect the previous control point
                cp1 = (2 * cur[0] - last_cp[0], 2 * cur[1] - last_cp[1]) if last_cp else cur
            cp2 = (num() + ox, num() + oy)
            end = (num() + ox, num() + oy)
            nodes[-1][2] = cp1
            nodes.append([end, cp2, None])
            cur, last_cp = end, cp2
    return paths


svg_text = open(SVG, encoding='utf-8').read()
d = re.search(r'<path[^>]*\sd="([^"]+)"', svg_text).group(1)
curve = bpy.data.curves.new('logo_src', 'CURVE')
curve.dimensions = '2D'
curve.fill_mode = 'BOTH'
for path in parse_path(d):
    sp = curve.splines.new('BEZIER')
    sp.bezier_points.add(len(path) - 1)
    sp.use_cyclic_u = True
    for bp, (co, h_in, h_out) in zip(sp.bezier_points, path):
        flip = lambda q: Vector((q[0], -q[1], 0.0))      # SVG y points down
        bp.co = flip(co)
        # None means that side is a straight segment: VECTOR handles keep it straight.
        bp.handle_left_type = 'VECTOR' if h_in is None else 'FREE'
        bp.handle_right_type = 'VECTOR' if h_out is None else 'FREE'
        if h_in is not None:
            bp.handle_left = flip(h_in)
        if h_out is not None:
            bp.handle_right = flip(h_out)
src = bpy.data.objects.new('logo_src', curve)
col.objects.link(src)

# Normalise: centre on the bounding box, scale to WIDTH, apply the object
# transform so curve units are metres.
pts = [p.co for s in curve.splines for p in s.bezier_points]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), 0))
k = WIDTH / (hi.x - lo.x)
curve.transform(Matrix.Scale(k, 4) @ Matrix.Translation(-(lo + hi) / 2))
# transform() also scales point radii, and bevel/extrude are multiplied by them.
for spline in curve.splines:
    for p in spline.bezier_points:
        p.radius = 1.0


def solid(offset, extrude, bevel):
    """Evaluate the SVG curve with the given offset/extrude/bevel into a bmesh."""
    c = curve.copy()
    c.dimensions = '2D'
    c.fill_mode = 'BOTH'
    c.offset = offset
    c.extrude = extrude
    c.bevel_depth = bevel
    c.bevel_resolution = 3
    c.resolution_u = 16
    obj = bpy.data.objects.new('svg_tmp', c)
    col.objects.link(obj)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    bpy.data.curves.remove(c)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    return bm


# Curve space is XY with the logo's up = +Y and its face normal = +Z. Standing it
# up: rotate +90 deg about X so +Y -> +Z (up) and +Z -> -Y (toward the camera).
STAND = Matrix.Rotation(math.radians(90), 4, 'X')
FRONT = HALF_T + BEVEL


def place(bm, mat, z_offset):
    for f in bm.faces:
        f.material_index = mat
    bmesh.ops.transform(bm, matrix=STAND @ Matrix.Translation((0, 0, z_offset)), verts=list(bm.verts))
    return bm


parts = [place(solid(0.0, HALF_T, BEVEL), GOLD, 0.0)]
for side in (1, -1):
    parts.append(place(solid(-INSET, 0.004, 0.003), CARNELIAN, side * (FRONT - 0.002)))

# Hub jewel where the arms cross. The horizontal arms' outermost cap points
# sit on the bar's centre line, so their Y is the hub height (x is centred).
bar_ys = [p.co.y for s in curve.splines for p in s.bezier_points
          if abs(abs(p.co.x) - WIDTH / 2) < 0.02]
hub_y = sum(bar_ys) / len(bar_ys)
for side in (1, -1):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-6], context='VERTS')
    for v in bm.verts:                       # open dome, flat side against the gold
        v.co = Vector((v.co.x * 0.075, v.co.y * 0.075 + hub_y, v.co.z * 0.03 * side))
    parts.append(place(bm, LAPIS, side * (FRONT - 0.004)))

bpy.data.objects.remove(src)
bpy.data.curves.remove(curve)

merged = bmesh.new()
for bm in parts:
    me = bpy.data.meshes.new('tmp')
    bm.to_mesh(me)
    bm.free()
    merged.from_mesh(me)
    bpy.data.meshes.remove(me)
relic_lib.finalize('RELIC_OctoAnkh', merged, col, slot=1, crystal_name='CRY_1', smooth_angle=35)

# The octopus idol it replaced in slot 1 is retired.
opl.remove_object('RELIC_Octopus')
opl.save()
