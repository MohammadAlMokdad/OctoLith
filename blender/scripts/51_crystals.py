"""Scene 2 showcase containers: sand-frosted desert quartz (igloo: cube1-3).

  CRY_1  rough-knapped block        -> holds the octopus idol
  CRY_2  hexagonal quartz crystal lying along X, natural 6-sided termination
         at +X, broken end at -X     -> holds the winged scarab
  CRY_3  crystal obelisk, broken base -> holds the ankh

Facets come from random plane cuts (like knapping), then a tiny bevel so edges
catch highlights. UV0 is a unique atlas (baked normal/roughness), UV1 a
world-scale box projection for tiling detail / the frost-rub simulation.
Per-face _facet randoms drive facet-to-facet frost variation in M_Quartz.
Meshes are centred on their own origin; SLOT_X only spreads them for previews.
"""
import sys, os, importlib, math, random
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy, bmesh
from mathutils import Vector

scene = opl.use_scene('S2')
col = opl.collection('S2_Vault')
SLOT_X = {1: -3.3, 2: 0.0, 3: 3.3}
rng = random.Random(int(ARGS.get('seed', 5)))


def clip(bm, co, no):
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no, clear_outer=True)
    bmesh.ops.holes_fill(bm, edges=list(bm.edges), sides=0)


def rand_dir(bias=Vector()):
    while True:
        v = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if 0.05 < v.length <= 1:
            return (v.normalized() + bias).normalized()


def knap(bm, count, dmin, dmax, bias=Vector()):
    """Slice `count` chips off whatever sticks out furthest along random directions."""
    for _ in range(count):
        d = rand_dir(bias)
        s = max(v.co.dot(d) for v in bm.verts)
        clip(bm, d * (s - rng.uniform(dmin, dmax)), d)


def solid(verts, faces):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def block(sx, sy, sz):
    bm = bmesh.new()
    for v in bmesh.ops.create_cube(bm, size=1.0)['verts']:
        v.co = Vector((v.co.x * 2 * sx, v.co.y * 2 * sy, v.co.z * 2 * sz))   # sx.. are half-extents
    return bm


def hex_crystal(r, x0, x1, tip):
    # Vertices at 30 + 60k degrees in the YZ plane put a flat face toward -Y (camera).
    ang = [math.radians(30 + 60 * k) for k in range(6)]
    ring = lambda x: [(x, r * math.cos(a), r * math.sin(a)) for a in ang]
    verts = ring(x0) + ring(x1) + [(x1 + tip, 0, 0)]
    faces = [list(range(6))]
    for k in range(6):
        j = (k + 1) % 6
        faces.append([k, j, 6 + j, 6 + k])
        faces.append([6 + k, 6 + j, 12])
    return solid(verts, faces)


def obelisk(bx, by, tx, ty, z0, z1, apex):
    verts = [(-bx, -by, z0), (bx, -by, z0), (bx, by, z0), (-bx, by, z0),
             (-tx, -ty, z1), (tx, -ty, z1), (tx, ty, z1), (-tx, ty, z1), (0, 0, apex)]
    faces = [[0, 1, 2, 3]]
    for k in range(4):
        j = (k + 1) % 4
        faces.append([k, j, 4 + j, 4 + k])
        faces.append([4 + k, 4 + j, 8])
    return solid(verts, faces)


builds = {}
bm = block(0.86, 0.76, 0.86)
knap(bm, 34, 0.04, 0.22)
builds[1] = bm

bm = hex_crystal(0.86, -0.95, 0.9, 0.62)
knap(bm, 10, 0.05, 0.32, bias=Vector((-1.8, 0, 0)))    # broken end
knap(bm, 8, 0.02, 0.07)                                  # small chips
builds[2] = bm

bm = obelisk(0.6, 0.52, 0.52, 0.45, -1.15, 0.95, 1.5)
knap(bm, 10, 0.05, 0.3, bias=Vector((0, 0, -1.8)))     # broken base
knap(bm, 8, 0.02, 0.07)
builds[3] = bm

mat = bpy.data.materials.get('M_Quartz') or bpy.data.materials.new('M_Quartz')
for i, bm in builds.items():
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=list(bm.verts),
                             edges=list(bm.edges))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    big = {f for f in bm.faces}
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.008, offset_type='OFFSET',
                    segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    name = f'CRY_{i}'
    obj = opl.mesh_object(name, bm, col, mat)
    me = obj.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(30))
    obj.location = (SLOT_X[i], 0, 0)
    # Per-facet frost variation; the thin bevel faces read as polished edges.
    opl.set_attr(me, '_facet', [rng.random() if p.area > 0.004 else 0.05 for p in me.polygons],
                 domain='FACE')

    opl.select_only([obj])
    uv0 = me.uv_layers.new(name='UVMap')
    uv1 = me.uv_layers.new(name='UV1')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    me.uv_layers.active = uv0
    bpy.ops.uv.smart_project(angle_limit=math.radians(25), island_margin=0.004)
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION',
                            margin=0.004, shape_method='CONCAVE')
    me.uv_layers.active = me.uv_layers['UV1']
    bpy.ops.uv.cube_project(cube_size=2.0, scale_to_bounds=False, correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Edit-mode toggles invalidate layer references, so look them up by name.
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True
    dims = obj.dimensions
    print(f'{name}: faces={len(me.polygons)} verts={len(me.vertices)} '
          f'size={dims.x:.2f}x{dims.y:.2f}x{dims.z:.2f}')

opl.save()
