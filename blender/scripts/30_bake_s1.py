"""Bake Scene 1 lighting into colour maps (the web renders these objects unlit).

Outputs to public/assets/textures/:
  pyramid_color.png           2048  PYR_Blocks assembled
  pyramid_exploded_color.png  2048  PYR_Blocks with every block pushed out along
                                    _dir by EXPLODE_BASE + EXPLODE_RAND * _rand
  ground_color.png            4096  DUNE_Base with the pyramid (wind ripples need the texels)
  far_color.png          4096x1024  DUNE_Far (polar UVs)
  landmark_color.png          1024  LAND_Pyramid (baked on one placed instance)
(The rubble piles and the relics that sat round the pyramid were removed on
2026-10-02: the user wants clear sand around it.)

ARGS: only=comma,separated,keys  samples=N (override)
"""
import sys, os, importlib, json, time
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy
opl.use_scene('S1')
from mathutils import Vector

EXPLODE_BASE = 0.3
EXPLODE_RAND = 0.2
CAP_LIFT = 0.5

scene = bpy.context.scene
only = set(filter(None, ARGS.get('only', '').split(',')))
os.makedirs(opl.TEXTURES_DIR, exist_ok=True)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
bake = scene.render.bake
bake.margin = 8
bake.margin_type = 'EXTEND'
bake.use_clear = True
bake.use_pass_direct = True
bake.use_pass_indirect = True
bake.use_pass_diffuse = True
bake.use_pass_glossy = False
bake.use_pass_transmission = True
bake.use_pass_emit = True
fmt = scene.render.image_settings
fmt.file_format = 'PNG'
fmt.color_mode = 'RGB'
fmt.color_depth = '8'


def run_bake(key, targets, size, samples, hide=()):
    if only and key not in only:
        return
    t0 = time.time()
    w, h = size if isinstance(size, tuple) else (size, size)
    name = f'BAKE_{key}'
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)

    for obj in targets:
        for slot in obj.material_slots:
            nt = slot.material.node_tree
            node = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage')
            node.name = 'BAKE'
            node.image = img
            nt.nodes.active = node

    hidden = [(o, o.hide_render) for o in hide]
    for o, _ in hidden:
        o.hide_render = True
    scene.cycles.samples = int(ARGS.get('samples', samples))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in targets:
        obj.hide_viewport = False
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.bake(type='COMBINED')
    for o, was in hidden:
        o.hide_render = was

    path = os.path.join(opl.TEXTURES_DIR, f'{key}_color.png')
    img.save_render(path, scene=scene)
    print(f'{key}: {w}x{h} {samples}spp {time.time() - t0:.1f}s -> {path}')


O = bpy.data.objects

run_bake('pyramid', [O['PYR_Blocks']], 2048, 384)
run_bake('ground', [O['DUNE_Base']], 4096, 256)
run_bake('far', [O['DUNE_Far']], (4096, 1024), 192)
run_bake('landmark', [O['LAND_Pyramid.002']], 1024, 256)

# Exploded bake: displace blocks along _dir, lift the cap, bake, restore.
if not only or 'pyramid_exploded' in only:
    me = O['PYR_Blocks'].data
    n = len(me.vertices)
    orig = [0.0] * (3 * n)
    me.vertices.foreach_get('co', orig)
    dirs = [0.0] * (3 * n)
    me.attributes['_dir'].data.foreach_get('vector', dirs)
    rands = [0.0] * n
    me.attributes['_rand'].data.foreach_get('value', rands)
    moved = list(orig)
    for i in range(n):
        amt = EXPLODE_BASE + EXPLODE_RAND * rands[i]
        tx, ty, tz = dirs[3 * i:3 * i + 3]          # three.js space
        d = Vector((tx, -tz, ty))                   # back to Blender space
        moved[3 * i] += d.x * amt
        moved[3 * i + 1] += d.y * amt
        moved[3 * i + 2] += d.z * amt
    cap = O.get('PYR_Cap')              # absent on the stepped style
    cap_z = cap.location.z if cap else 0.0
    try:
        me.vertices.foreach_set('co', moved)
        me.update()
        if cap:
            cap.location.z = cap_z + CAP_LIFT
        run_bake('pyramid_exploded', [O['PYR_Blocks']], 2048, 384)
    finally:
        me.vertices.foreach_set('co', orig)
        me.update()
        if cap:
            cap.location.z = cap_z

with open(os.path.join(opl.MODELS_DIR, 'bake_meta.json'), 'w') as fh:
    json.dump({'explode': {'base': EXPLODE_BASE, 'rand': EXPLODE_RAND, 'capLift': CAP_LIFT},
               'colorManagement': {'view': scene.view_settings.view_transform,
                                   'look': scene.view_settings.look,
                                   'exposure': scene.view_settings.exposure}}, fh, indent=2)
opl.save()
print('bake done')
