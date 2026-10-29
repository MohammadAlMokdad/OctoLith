"""Pyramid block generator shared by the hero (10_pyramid.py) and the
background landmarks (21_landmarks.py), so both have identical stonework.

Styles:
  stepped every course is rough stepped core stone, all the way up; the
          pyramid ends on a single top block (no capstone).
  khafre  casing survives above casing_from; below it the casing is stripped,
          exposing rough stepped core blocks recessed behind the face plane.
  cased   every course is smooth limestone casing: blocks are clipped by the
          four pyramid planes, so faces are flush, corners mitred along the
          hips, and only hairline joints show.

lite=True skips chips and bevels (for distant copies that never animate).
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector
import opl

W = 5.0                                  # base width
SLOPE = math.radians(51.84)              # Great Pyramid slope
H = W / 2 * math.tan(SLOPE)              # apex height (~3.18)
N = 18                                   # nominal courses up to the apex
CH = H / N                               # course height (~0.177)
CAP_COURSE = 15                          # capstone replaces the top 3 courses
MIN_TOP = 0.12                           # stop when a course gets narrower than this
DEPTH = 0.36                             # block depth into the pyramid
LEN = 0.5                                # target block length
RECESS = 0.09                            # core steps sit this far behind the face plane

# Side frames: outward normal N and tangent T with [N, T, Z] right-handed.
SIDES = [
    (Vector((1, 0, 0)), Vector((0, 1, 0))),
    (Vector((0, 1, 0)), Vector((-1, 0, 0))),
    (Vector((-1, 0, 0)), Vector((0, -1, 0))),
    (Vector((0, -1, 0)), Vector((1, 0, 0))),
]
UP = Vector((0, 0, 1))
COT = 1 / math.tan(SLOPE)
# Outward normals of the four face planes; each plane passes through N * W/2 at z = 0.
PLANES = [((n + UP * COT).normalized(), n * (W / 2)) for n, _ in SIDES]


def half(z):
    """Half-width of the ideal pyramid at height z."""
    return W / 2 * (1 - z / H)


def clip(bm, co, no):
    """Cut away everything on the +no side of the plane and cap the hole."""
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no, clear_outer=True)
    bmesh.ops.holes_fill(bm, edges=list(bm.edges), sides=0)


def chip(bm, rng, chance, lo, hi):
    """Knock a small chunk off one outward corner."""
    if rng.random() > chance:
        return
    center = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
    d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.choice((0.6, 1.0)))).normalized()
    corner = max(bm.verts, key=lambda v: (v.co - center).dot(d)).co.copy()
    clip(bm, corner - d * rng.uniform(lo, hi), d)


def rough_stone(half, rng, jit=0.014, bevel=0.011, split=None):
    """A loose core stone like the pyramid's own blocks (hand-cut jitter,
    chipped corners, bevel), centred on the origin. half = half extents.
    split=(normal, gap) breaks it in two along a plane through the centre and
    returns both halves pushed apart; otherwise returns one bmesh."""
    bm = bmesh.new()
    for v in bmesh.ops.create_cube(bm, size=2.0)['verts']:
        v.co = Vector((v.co.x * half[0], v.co.y * half[1], v.co.z * half[2]))
        v.co += Vector((rng.uniform(-jit, jit), rng.uniform(-jit, jit), rng.uniform(-jit, jit) * 0.5))
    pieces = [bm]
    if split:
        no, gap = Vector(split[0]).normalized(), split[1]
        other = bm.copy()
        clip(bm, (0, 0, 0), no)
        clip(other, (0, 0, 0), -no)
        bmesh.ops.translate(other, verts=list(other.verts), vec=no * gap)
        pieces.append(other)
    for piece in pieces:
        chip(piece, rng, 0.8, 0.02, 0.07)
        chip(piece, rng, 0.5, 0.015, 0.05)
        bmesh.ops.remove_doubles(piece, verts=list(piece.verts), dist=1e-5)
        bmesh.ops.recalc_face_normals(piece, faces=list(piece.faces))
        bmesh.ops.bevel(piece, geom=list(piece.verts) + list(piece.edges), offset=bevel,
                        offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
    return pieces if split else bm


class PyramidBuilder:
    """Builds the block list on construction; to_object() makes the mesh.

    After construction: verts/faces (mesh data), v_block/f_block (block index
    per vertex/face) and blocks (dicts: centr, dir, n, rand, course, casing,
    outline). rng is left positioned right after the last block, so callers
    drawing from it next get a stable sequence.
    """

    def __init__(self, style='stepped', seed=7, lite=False):
        self.style = style
        self.lite = lite
        self.rng = random.Random(seed)
        self.has_cap = style != 'stepped'
        self.last_course = CAP_COURSE if self.has_cap else N
        self.casing_from = {'cased': 0, 'khafre': 9, 'stepped': N}[style]
        self.verts, self.faces = [], []
        self.v_block, self.f_block = [], []
        self.blocks = []
        self._build()

    # ------------------------------------------------------------ helpers
    def _partition(self, length, target):
        n = max(1, round(length / target))
        w = [1 + self.rng.uniform(-0.3, 0.3) for _ in range(n)]
        total = sum(w)
        return [length * x / total for x in w]

    def _chip(self, bm, chance, lo, hi):
        chip(bm, self.rng, chance, lo, hi)

    def _box(self, corner, jit, exposed):
        """Box from corner(lx, ly, lz) -> world point (l* are -1/+1). Corners
        for which exposed(lx, ly, lz) is true get jittered (hand-cut look)."""
        rng = self.rng
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        signs = [v.co.copy() for v in tmp.verts]
        for v in tmp.verts:
            l = tuple(1 if c > 0 else -1 for c in v.co)
            p = corner(*l)
            if jit and exposed(*l):
                p += Vector((rng.uniform(-jit, jit), rng.uniform(-jit, jit), rng.uniform(-jit, jit) * 0.5))
            v.co = p
        # Hand-cut corners before chipping/bevelling, keyed by their -1/+1 signs;
        # they become the block's clean box edges (PYR_Edges).
        self._corners = [(tuple(1 if c > 0 else -1 for c in v_l), v.co.copy())
                         for v_l, v in zip(signs, tmp.verts)]
        return tmp

    def _finish(self, tmp, nrm, k, casing, outline):
        """Chip, bevel and append one block with its per-block data."""
        if casing:
            for pn, pco in PLANES:
                clip(tmp, pco, pn)
            # Hairline tonal variation: some stones sit a hair proud or shy.
            bmesh.ops.translate(tmp, verts=list(tmp.verts),
                                vec=-(nrm + UP * COT).normalized() * self.rng.uniform(0.0, 0.004))
            if not self.lite:
                self._chip(tmp, 0.18, 0.012, 0.035)
        elif not self.lite:
            self._chip(tmp, 0.45, 0.02, 0.06)
            self._chip(tmp, 0.25, 0.015, 0.04)
        bmesh.ops.remove_doubles(tmp, verts=list(tmp.verts), dist=1e-5)
        bmesh.ops.recalc_face_normals(tmp, faces=list(tmp.faces))
        if not self.lite:
            bmesh.ops.bevel(tmp, geom=list(tmp.verts) + list(tmp.edges),
                            offset=0.006 if casing else 0.011, offset_type='OFFSET',
                            segments=2 if casing else 1, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        bid = len(self.blocks)
        base = len(self.verts)
        centr = Vector()
        for v in tmp.verts:
            self.verts.append(v.co.copy())
            centr += v.co
            self.v_block.append(bid)
        centr /= len(tmp.verts)
        for f in tmp.faces:
            self.faces.append([base + v.index for v in f.verts])
            self.f_block.append(bid)
        tmp.free()
        self.blocks.append(dict(centr=centr, dir=(nrm + UP * 0.5).normalized(), n=nrm,
                                rand=self.rng.random(), course=k, casing=casing,
                                outline=outline, corners=self._corners))

    def box_edges(self, block):
        """The 12 edges of a block's hand-cut box, as (a, b) point pairs."""
        cs = block['corners']
        return [(pa, pb) for i, (la, pa) in enumerate(cs) for lb, pb in cs[i + 1:]
                if sum(x != y for x, y in zip(la, lb)) == 1]

    # ------------------------------------------------------------ courses
    def _build(self):
        for k in range(self.last_course):
            z0, z1 = k * CH, (k + 1) * CH
            casing = k >= self.casing_from
            gap = 0.004 if casing else 0.012
            b0, b1 = z0 + gap / 2, z1 - gap / 2
            # Casing blocks start past the face plane and get clipped onto it.
            # Core blocks are vertical-faced steps recessed behind the plane.
            n_out = half(z0) + 0.05 if casing else half(z1) - RECESS
            s = half(z0) if casing else n_out
            jit = 0.0 if casing else 0.014
            if not casing and s < MIN_TOP:
                break                          # the course below was the top block

            if not casing and s - DEPTH < 0.08:
                self._slab(k, s, gap, b0, b1, jit)
                continue

            full_axis = k % 2
            for si, (nrm, tan) in enumerate(SIDES):
                full = (si % 2) == full_axis
                span = s if full else s - DEPTH
                pieces = self._partition(2 * span, LEN * (1.0 if casing else 0.8))
                shift = self.rng.randrange(len(pieces))
                pieces = pieces[shift:] + pieces[:shift]
                u = -span
                for plen in pieces:
                    u0, u1 = u + gap / 2, u + plen - gap / 2
                    u += plen
                    n0 = (half(z0) if casing else n_out) - DEPTH
                    n1 = n_out
                    tmp = self._box(
                        lambda lx, ly, lz: (nrm * (n1 if lx > 0 else n0) + tan * (u1 if ly > 0 else u0)
                                            + UP * (b1 if lz > 0 else b0)),
                        jit, lambda lx, ly, lz: lx > 0)          # only the outer face corners

                    # Outline of the outer face (on the plane for casing, on the step for core).
                    def face_pt(uu, zz):
                        nn = half(zz) + 0.003 if casing else n1 + 0.003
                        uu = max(-nn, min(nn, uu))
                        return nrm * nn + tan * uu + UP * zz
                    self._finish(tmp, nrm, k, casing,
                                 [face_pt(u0, b0), face_pt(u1, b0), face_pt(u1, b1), face_pt(u0, b1)])

    def _slab(self, k, s, gap, b0, b1, jit):
        """Near the top a ring would have no hole: lay a solid slab of stones."""
        n = max(1, round(2 * s / 0.34))
        step = 2 * s / n
        for i in range(n):
            for j in range(n):
                x0, x1 = -s + i * step + gap / 2, -s + (i + 1) * step - gap / 2
                y0, y1 = -s + j * step + gap / 2, -s + (j + 1) * step - gap / 2
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                if abs(cx) >= abs(cy):
                    nrm = Vector((1 if cx >= 0 else -1, 0, 0))
                else:
                    nrm = Vector((0, 1 if cy >= 0 else -1, 0))
                tan = next(t for nn, t in SIDES if nn == nrm)
                tmp = self._box(
                    lambda lx, ly, lz: Vector((x1 if lx > 0 else x0, y1 if ly > 0 else y0,
                                               b1 if lz > 0 else b0)),
                    jit,
                    lambda lx, ly, lz: (lx > 0 and x1 > s - 0.05) or (lx < 0 and x0 < -s + 0.05)
                    or (ly > 0 and y1 > s - 0.05) or (ly < 0 and y0 < -s + 0.05))
                ts = [Vector((x, y, 0)).dot(tan) for x in (x0, x1) for y in (y0, y1)]
                nn = s + 0.003
                outline = [nrm * nn + tan * u + UP * z for u, z in
                           ((min(ts), b0), (max(ts), b0), (max(ts), b1), (min(ts), b1))]
                self._finish(tmp, nrm, k, False, outline)

    # ------------------------------------------------------------ mesh
    def to_object(self, name, col, material):
        """Mesh object with a bake-ready UV atlas: one island per (block,
        dominant axis), projected on that group's plane and scaled by how
        visible it is, so outer faces get most of the texels."""
        opl.remove_object(name)
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        me.update()
        obj = bpy.data.objects.new(name, me)
        col.objects.link(obj)
        me.materials.append(material)
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(40))

        groups = {}
        for poly in me.polygons:
            nr = poly.normal
            ax = max(range(3), key=lambda i: abs(nr[i]))
            groups.setdefault((self.f_block[poly.index], ax, nr[ax] > 0), []).append(poly)
        uv = me.uv_layers.new(name='UVMap')
        for gi, ((bid, ax, pos), polys) in enumerate(groups.items()):
            b = self.blocks[bid]
            gn = sum((p.normal * p.area for p in polys), Vector())
            gn = gn.normalized() if gn.length > 1e-9 else Vector((0, 0, 1))
            outward = gn.dot(b['n'])
            if outward > 0.5:
                weight = 1.0
            elif gn.z > 0.7:
                weight = 0.12 if b['casing'] else 0.8     # casing tops are covered by the next course
            elif outward < -0.5 or gn.z < -0.7:
                weight = 0.1
            else:
                weight = 0.3
            e1 = gn.cross(UP)
            e1 = e1.normalized() if e1.length > 1e-4 else Vector((1, 0, 0))
            e2 = gn.cross(e1)
            ox, oy = (gi % 97) * 3.0, (gi // 97) * 3.0
            for poly in polys:
                for li in poly.loop_indices:
                    co = self.verts[me.loops[li].vertex_index]
                    uv.data[li].uv = (ox + co.dot(e1) * weight, oy + co.dot(e2) * weight)

        opl.select_only([obj])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION',
                                margin=0.0015, shape_method='AABB')
        bpy.ops.object.mode_set(mode='OBJECT')
        return obj

    def per_vertex(self, key, fn=None):
        """Per-vertex list of a block property (optionally mapped by fn)."""
        fn = fn or (lambda v: v)
        return [fn(self.blocks[b][key]) for b in self.v_block]
