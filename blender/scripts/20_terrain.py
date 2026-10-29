"""Desert terrain (counterpart of igloo's ground.drc base + terrain tiles).

One radial mesh (dense near the pyramid, coarser outward) split at SPLIT_R so
both parts share their boundary ring exactly (no cracks):

DUNE_Base  disk r <= SPLIT_R, planar UVs, baked 4096^2 with the pyramid shadow
           (enough texels for the wind ripples in M_Sand).
DUNE_Far   annulus out to FAR_R, polar UVs (u = angle, v = log radius) so bake
           texels concentrate near the transition. Baked 4096 x 1024.
"""
import sys, os, importlib, math
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy, bmesh
opl.use_scene('S1')
from mathutils import Vector, noise

SEG = 288
SPLIT_R = 30.0
FAR_R = 250.0
PYR_HALF = 2.5
# Wind blows toward WIND; slip faces face downwind. Chosen so the slip faces
# turn away from the sun (deep shade) while the crests cross the hero view.
WIND = Vector((-0.34, -0.94)).normalized()
RING_STEP = 0.35                 # radial spacing inside SPLIT_R (sharp crests need it)


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def n2(x, y, s, z):
    return noise.noise(Vector((x * s, y * s, z)), noise_basis='PERLIN_NEW')


def warped(x, y, scale, warp, z):
    """Perlin noise on domain-warped coordinates (sinuous, irregular features)."""
    wx = x + warp * n2(x, y, scale * 0.6, z + 1.3)
    wy = y + warp * n2(x, y, scale * 0.6, z + 7.9)
    return noise.noise(Vector((wx * scale, wy * scale, z)), noise_basis='PERLIN_NEW')


def dune_ridges(x, y, scale, warp, z, width, lee_width):
    """Irregular dune field: crests follow the zero-lines of warped noise, so
    they wander and branch instead of repeating in rows. Each crest has a long,
    gently convex windward flank and a short, steep slip face on its downwind
    side (found from the noise gradient along WIND). Returns 0..1."""
    n = warped(x, y, scale, warp, z)
    e = 0.5
    along = (warped(x + WIND.x * e, y + WIND.y * e, scale, warp, z)
             - warped(x - WIND.x * e, y - WIND.y * e, scale, warp, z))
    across = (warped(x - WIND.y * e, y + WIND.x * e, scale, warp, z)
              - warped(x + WIND.y * e, y - WIND.x * e, scale, warp, z))
    # How squarely this side of the crest faces downwind (-1 windward .. 1 lee).
    # Blending on it (rather than switching on its sign) avoids tears where a
    # crest turns parallel to the wind.
    facing = math.copysign(1.0, n) * along / (math.hypot(along, across) + 1e-9)
    lee = smoothstep(-0.35, 0.35, facing)
    w = width + (lee_width - width) * lee
    p = 1.4 + (0.9 - 1.4) * lee             # convex windward flank, steep slip face
    t = abs(n) / w
    return max(0.0, 1.0 - t ** p) if t < 1.0 else 0.0


def raw_height(x, y):
    r = math.hypot(x, y)
    # Near the pyramid: open sand that barely rolls, so the ripples carry it.
    h = n2(x, y, 0.02, 1.7) * 0.35 * smoothstep(4.0, 16.0, r)
    # Middle distance: a few large irregular dunes (~55 m apart), crest height varying.
    mid_amp = 4.5 * (0.55 + 0.45 * n2(x, y, 0.01, 3.3))
    h += mid_amp * dune_ridges(x, y, 1 / 55, 18.0, 5.0, 0.34, 0.21) * smoothstep(24.0, 48.0, r)
    # Horizon: big dune hills (~130 m apart) with long sweeping crests.
    far_amp = 19.0 * (0.5 + 0.5 * n2(x, y, 0.004, 6.1))
    h += far_amp * dune_ridges(x, y, 1 / 150, 45.0, 9.0, 0.36, 0.22) * smoothstep(55.0, 150.0, r)
    # Broad undulation underneath everything, growing with distance.
    h += n2(x, y, 0.006, 2.4) * 3.0 * smoothstep(30.0, 160.0, r)
    # Sand drifted against the pyramid base, deeper on the windward side.
    d = max(abs(x), abs(y)) - PYR_HALF
    if d > -0.2:
        side = 0.6 + 0.4 * max(0.0, -(x * WIND.x + y * WIND.y) / max(r, 1e-3))
        h += 0.13 * side * math.exp(-max(d, 0.0) / 1.1)
    return h


# Background pyramid sites (angle deg from +X, distance m, scale of the 5 m
# pyramid); 21_landmarks.py places them. Each stands on a low, round plateau
# (between the local average and crest height) that blends out over ~45 m, so
# dunes neither bury nor hide it and there is no visible shelf.
LANDMARK_SITES = [(56, 150, 4.2), (38, 190, 5.6), (70, 215, 3.4), (150, 200, 5.0), (-60, 215, 5.5)]


def _plateaus():
    out = []
    for ang, dist, scale in LANDMARK_SITES:
        a = math.radians(ang)
        x, y = dist * math.cos(a), dist * math.sin(a)
        hw = PYR_HALF * scale
        ring = [raw_height(x + (hw + 6) * math.cos(t), y + (hw + 6) * math.sin(t))
                for t in (2 * math.pi * i / 16 for i in range(16))]
        ring.append(raw_height(x, y))
        out.append((x, y, hw, 0.5 * (max(ring) + sum(ring) / len(ring))))
    return out


PLATEAUS = _plateaus()


def height(x, y):
    h = raw_height(x, y)
    for px, py, hw, ph in PLATEAUS:
        d = math.hypot(x - px, y - py)             # round, covers the square footprint
        f = 1.0 - smoothstep(hw * 1.45, hw * 1.45 + 45.0, d)
        if f > 0.0:
            h = h * (1.0 - f) + ph * f
    return h


# Ring radii: fine to just past the split, then growing.
radii = [0.0]
r = 0.0
while r < SPLIT_R - 1e-6:
    r = min(r + RING_STEP, SPLIT_R)
    radii.append(r)
step = 0.6
while r < FAR_R - 1e-6:
    step *= 1.035                    # fine enough to keep far dune crests sharp
    r = min(r + step, FAR_R)
    radii.append(r)
split = radii.index(SPLIT_R)


def build(ring_lo, ring_hi, uv_fn):
    """Mesh of rings [ring_lo, ring_hi]. uv_fn(ring, seg_float) -> (u, v)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rings = {}
    for k in range(ring_lo, ring_hi + 1):
        rk = radii[k]
        if rk == 0.0:
            rings[k] = [bm.verts.new((0.0, 0.0, height(0.0, 0.0)))]
            continue
        row = []
        for i in range(SEG):
            a = 2 * math.pi * i / SEG
            x, y = rk * math.cos(a), rk * math.sin(a)
            row.append(bm.verts.new((x, y, height(x, y))))
        rings[k] = row
    for k in range(ring_lo, ring_hi):
        inner, outer = rings[k], rings[k + 1]
        for i in range(SEG):
            j = (i + 1) % SEG
            if len(inner) == 1:
                f = bm.faces.new((inner[0], outer[i], outer[j]))
                keys = [(k, i + 0.5), (k + 1, i), (k + 1, i + 1)]
            else:
                f = bm.faces.new((inner[i], outer[i], outer[j], inner[j]))
                keys = [(k, i), (k + 1, i), (k + 1, i + 1), (k, i + 1)]
            for loop, (kk, ii) in zip(f.loops, keys):
                loop[uvl].uv = uv_fn(kk, ii)
    bm.normal_update()
    return bm


def base_uv(k, i):
    a = 2 * math.pi * i / SEG
    rr = radii[k]
    return (0.5 + rr * math.cos(a) / (2 * SPLIT_R), 0.5 + rr * math.sin(a) / (2 * SPLIT_R))


LOG_SPAN = math.log(FAR_R / SPLIT_R)


def far_uv(k, i):
    return (i / SEG, math.log(radii[k] / SPLIT_R) / LOG_SPAN)


col = opl.collection('S1_Dunes')
sand = bpy.data.materials['M_Sand']

bm = build(0, split, base_uv)
base = opl.mesh_object('DUNE_Base', bm, col, sand)
bm = build(split, len(radii) - 1, far_uv)
far = opl.mesh_object('DUNE_Far', bm, col, sand)
for o in (base, far):
    o.data.shade_smooth()
    # Rings are wound (inner, outer, outer+1, inner+1), which faces +Z. Don't use
    # normals_make_consistent here: on an open disk it can flip everything down,
    # which renders fine but bakes as if lit from below.
    assert sum(p.normal.z for p in o.data.polygons) > 0, f'{o.name} normals point down'

opl.save()
print(f'rings={len(radii)} split_ring={split} base verts={len(base.data.vertices)} '
      f'far verts={len(far.data.vertices)} h(cam)={height(-14, -14):.2f}')
