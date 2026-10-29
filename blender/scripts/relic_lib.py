"""Shared modelling helpers for the Scene 2 relics.

Relics share one material slot layout (see MATERIALS); faces carry the slot
index, which finalize() also writes per vertex as _mat (and _metal = 1 on
gold) for the web. The camera looks along +Y, so a relic's front is -Y.
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import opl

MATERIALS = ('M_RelicGold', 'M_Lapis', 'M_Carnelian', 'M_Obsidian', 'M_Alabaster')
GOLD, LAPIS, CARNELIAN, OBSIDIAN, ALABASTER = range(len(MATERIALS))
SLOT_X = {1: -3.3, 2: 0.0, 3: 3.3}      # preview layout, shared with the crystals


class Part:
    """Accumulates primitives (each with a material index) into one bmesh."""

    def __init__(self):
        self.bm = bmesh.new()

    def add(self, bm, mat, matrix=None):
        """mat=None keeps the material indices already set on bm's faces."""
        if matrix is not None:
            bmesh.ops.transform(bm, matrix=matrix, verts=list(bm.verts))
        if mat is not None:
            for f in bm.faces:
                f.material_index = mat
        me = bpy.data.meshes.new('tmp')
        bm.to_mesh(me)
        bm.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)


def ellipsoid(center, radii, segs=(40, 24)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2])) + Vector(center)
    return bm


def torus(center, major, minor, axis='Y', seg=(48, 12), zscale=1.0):
    """Torus whose ring lies in the plane perpendicular to `axis` ('Y' or 'Z')."""
    bm = bmesh.new()
    rows = []
    for i in range(seg[0]):
        u = 2 * math.pi * i / seg[0]
        row = []
        for j in range(seg[1]):
            w = 2 * math.pi * j / seg[1]
            r = major + minor * math.cos(w)
            p = Vector((r * math.cos(u), minor * math.sin(w), r * math.sin(u) * zscale))
            if axis == 'Z':
                p = Vector((p.x, p.z, p.y))
            row.append(bm.verts.new(p + Vector(center)))
        rows.append(row)
    for i in range(seg[0]):
        for j in range(seg[1]):
            a, b = rows[i][j], rows[(i + 1) % seg[0]][j]
            c, d = rows[(i + 1) % seg[0]][(j + 1) % seg[1]], rows[i][(j + 1) % seg[1]]
            bm.faces.new((a, b, c, d))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def box(center, half, bevel=0.0, taper_z=None):
    """Axis-aligned box. taper_z=(sx_bottom, sx_top) scales X linearly with Z."""
    bm = bmesh.new()
    for v in bmesh.ops.create_cube(bm, size=2.0)['verts']:
        v.co = Vector((v.co.x * half[0], v.co.y * half[1], v.co.z * half[2]))
    if taper_z:
        for v in bm.verts:
            t = (v.co.z + half[2]) / (2 * half[2])            # 0 bottom .. 1 top
            v.co.x *= taper_z[1] * t + taper_z[0] * (1 - t)
    for v in bm.verts:
        v.co += Vector(center)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type='OFFSET',
                        segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def disk(center, radius, depth, seg=40):
    """Cylinder facing the camera (axis along Y)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=radius, radius2=radius,
                          depth=depth)
    bmesh.ops.rotate(bm, verts=list(bm.verts), cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=list(bm.verts), vec=Vector(center))
    return bm


def lathe(profile, center=(0, 0, 0), seg=40):
    """Surface of revolution around Z from (radius, z) pairs, bottom to top.
    Ends with radius 0 close to a point; a non-zero end gets a cap."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([bm.verts.new(Vector(center) + Vector((0, 0, z)))])
            continue
        rings.append([bm.verts.new(Vector(center) + Vector((r * math.cos(a), r * math.sin(a), z)))
                      for a in (2 * math.pi * i / seg for i in range(seg))])
    for lo, hi in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            if len(lo) == 1:
                bm.faces.new((lo[0], hi[j], hi[i]))
            elif len(hi) == 1:
                bm.faces.new((lo[i], lo[j], hi[0]))
            else:
                bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    for ring in (rings[0], rings[-1]):
        if len(ring) > 1:
            bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def tube(points, radii, res=4):
    """Smooth tube along points (NURBS, per-point radius) converted to a bmesh."""
    cd = bpy.data.curves.new('tube_tmp', 'CURVE')
    cd.dimensions = '3D'
    cd.resolution_u = 3
    cd.bevel_depth = 1.0
    cd.bevel_resolution = res
    cd.use_fill_caps = True
    sp = cd.splines.new('NURBS')
    sp.points.add(len(points) - 1)
    for p, co, r in zip(sp.points, points, radii):
        p.co = (co[0], co[1], co[2], 1.0)
        p.radius = r
    sp.order_u = min(4, len(points))
    sp.use_endpoint_u = True
    obj = bpy.data.objects.new('tube_tmp', cd)
    bpy.context.scene.collection.objects.link(obj)
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(obj)
    bpy.data.curves.remove(cd)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return bm


def outside_count(obj, crystal_name, step=5):
    """Sampled vertices of obj lying outside its crystal (odd/even ray parity).
    Relic and crystal share an origin and the BVH is in local space."""
    bvh = BVHTree.FromObject(bpy.data.objects[crystal_name], bpy.context.evaluated_depsgraph_get())
    ray = Vector((0.3, 0.2, 1.0)).normalized()
    outside = 0
    verts = obj.data.vertices
    for vi in range(0, len(verts), step):
        o, hits = verts[vi].co.copy(), 0
        for _ in range(64):
            loc, _, _, _ = bvh.ray_cast(o, ray)
            if loc is None:
                break
            hits += 1
            o = loc + ray * 1e-4
        outside += hits % 2 == 0
    return outside


def finalize(name, bm, col, slot, crystal_name, smooth_angle=50):
    """Turn a relic bmesh into an object: materials, _mat/_metal, one clean UV
    atlas, placed at its preview slot, plus a containment check."""
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    obj = opl.mesh_object(name, bm, col)
    me = obj.data
    for n in MATERIALS:
        me.materials.append(bpy.data.materials[n])
    obj.location = (SLOT_X[slot], 0, 0)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth_angle))

    vmat = [0.0] * len(me.vertices)
    for p in me.polygons:
        for vi in p.vertices:
            vmat[vi] = float(p.material_index)
    opl.set_attr(me, '_mat', vmat)
    opl.set_attr(me, '_metal', [1.0 if m == GOLD else 0.0 for m in vmat])

    opl.select_only([obj])
    # Curve-to-mesh conversion leaves per-tube UV layers; start from one clean layer.
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='UVMap')
    me.uv_layers.active = me.uv_layers['UVMap']
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003)
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')

    d = obj.dimensions
    print(f'{name}: verts={len(me.vertices)} tris={sum(len(p.vertices) - 2 for p in me.polygons)} '
          f'size={d.x:.2f}x{d.y:.2f}x{d.z:.2f} '
          f'sampled-outside-{crystal_name}={outside_count(obj, crystal_name)}')
    return obj
