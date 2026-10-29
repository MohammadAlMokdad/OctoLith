"""Distant landmarks (igloo: mountain.drc x5).

LAND_Pyramid      the hero's stepped stone pyramid (pyramid_lib, lite: no chips,
                  bevels or interaction attributes), base 5 m. Placed as linked
                  duplicates LAND_Pyramid.001.. at landmark scale, like igloo's
                  single mountain reused 5x. All face due north, as at Giza, so
                  one lighting bake is right for every copy.

The two rubble piles beside the hero pyramid (igloo's patch.drc x2), and the
relics later set in the sand round it, were removed on 2026-10-02: the user
wants clear sand around the pyramid. This still clears any PATCH_ object.
"""
import sys, os, importlib, math, random, json
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import pyramid_lib; importlib.reload(pyramid_lib)
import bpy, bmesh
opl.use_scene('S1')
from mathutils import Vector, Matrix, Euler, noise

# Reuse the terrain height function so instances sit on the dunes.
_terrain_globals = {'__file__': os.path.join(os.path.dirname(__file__), '20_terrain.py'),
                    'ARGS': {}, '__name__': 'terrain_lib'}
with open(_terrain_globals['__file__']) as fh:
    src = fh.read().split('# Ring radii')[0]
exec(src, _terrain_globals)
height = _terrain_globals['height']

rng = random.Random(11)
col = opl.collection('S1_Dunes')
m_stone = bpy.data.materials['M_Sandstone']
for o in [o for o in col.objects if o.name.startswith(('LAND_', 'PATCH_'))]:
    opl.remove_object(o.name)

# ---------------------------------------------------------------- distant pyramid
W = pyramid_lib.W
pb = pyramid_lib.PyramidBuilder('stepped', seed=13, lite=True)
dist_pyr = pb.to_object('LAND_Pyramid', col, m_stone)
opl.set_attr(dist_pyr.data, '_rand', pb.per_vertex('rand'))      # per-stone tone in M_Sandstone
dist_pyr.hide_render = True  # source mesh lives at origin; instances are placed below
dist_pyr.hide_viewport = True

# Instances: Giza-like trio behind the hero pyramid, plus two far off to the
# sides. Sites and their plateau heights come from the terrain script.
instances = []
for idx, ((ang, dist, scale), (x, y, hw, plateau)) in enumerate(
        zip(_terrain_globals['LANDMARK_SITES'], _terrain_globals['PLATEAUS'])):
    z = plateau - 0.01 * scale * W            # bottom course just bedded in the sand
    inst = bpy.data.objects.new(f'LAND_Pyramid.{idx + 1:03d}', dist_pyr.data)
    col.objects.link(inst)
    inst.location = (x, y, z)
    inst.scale = (scale, scale, scale)
    instances.append(inst)

# Export instance transforms (three.js space) for the web scene.
os.makedirs(opl.MODELS_DIR, exist_ok=True)
data = {'landmarks': []}
for inst in instances:
    data['landmarks'].append({
        'mesh': 'LAND_Pyramid',
        'position': opl.to_three(inst.location),
        'rotationY': inst.rotation_euler.z,
        'scale': inst.scale.x,
    })
with open(os.path.join(opl.MODELS_DIR, 'landmarks.json'), 'w') as fh:
    json.dump(data, fh, indent=2)

opl.save()
print('landmarks', [(i.name, [round(c, 1) for c in i.location], i.scale.x) for i in instances])
