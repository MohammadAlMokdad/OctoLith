"""Bake Scene 2 maps to public/assets/textures/.

  cry{1,2,3}_normal.png      2048  tangent-space normal (non-colour), UV0
  cry{1,2,3}_roughness.png   1024  frost roughness (non-colour), UV0
  relic_{name}_color.png     1024  lit by the vault studio (glass hidden)
  relic_{name}_dark_color.png 1024 same, lights at ~20% (project detail page)
  env_vault.exr / .png       1024x512 equirect from the showcase position,
                             softboxes visible, for glass reflections

Each relic is baked alone at the origin, where the studio lights aim.
ARGS: only=comma,separated keys (crystals, relics, env)
"""
import sys, os, importlib, time
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy
import numpy as np

scene = opl.use_scene('S2')
only = set(filter(None, ARGS.get('only', '').split(',')))
O = bpy.data.objects
os.makedirs(opl.TEXTURES_DIR, exist_ok=True)
CRYSTALS = ['CRY_1', 'CRY_2', 'CRY_3']
# the Sketchfab relics (58_sketchfab_relics.py); the hand-built ones were
# 'RELIC_OctoAnkh': 'octoankh', 'RELIC_Scarab': 'scarab', 'RELIC_Falcon': 'falcon'
RELICS = {'RELIC_Tut': 'tut', 'RELIC_Cat': 'cat', 'RELIC_Ankh': 'ankh'}
LIGHTS = ['L_Key', 'L_Rim', 'L_Top', 'L_Kick']

bake = scene.render.bake
bake.margin = 8
bake.margin_type = 'EXTEND'
bake.use_clear = True


def new_image(name, size, color):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return img


def target(obj, img):
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage')
        node.name = 'BAKE'
        node.image = img
        nt.nodes.active = node


def run(obj, kind, img, samples, **kw):
    target(obj, img)
    scene.cycles.samples = samples
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type=kind, **kw)


def save_raw(img, filename):
    """Save a non-colour bake as an 8-bit PNG. The bake buffers are float, and
    Blender writes float images as 16-bit PNGs: ~4x the download for nothing
    visible on the web (the normal maps went 12.7 MB -> 3.3 MB each)."""
    path = os.path.join(opl.TEXTURES_DIR, filename)
    w, h = img.size
    out = bpy.data.images.new(img.name + '_8bit', w, h, alpha=False, float_buffer=False)
    out.colorspace_settings.name = 'Non-Color'
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    out.pixels.foreach_set(px)
    out.filepath_raw = path
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    return path


def save_color(img, filename):
    fmt = scene.render.image_settings
    fmt.file_format, fmt.color_mode, fmt.color_depth = 'PNG', 'RGB', '8'
    path = os.path.join(opl.TEXTURES_DIR, filename)
    img.save_render(path, scene=scene)
    return path


# ---------------------------------------------------------------- crystals
if not only or 'crystals' in only:
    for i, name in enumerate(CRYSTALS, start=1):
        t0 = time.time()
        obj = O[name]
        img = new_image(f'BAKE_cry{i}_normal', 2048, color=False)
        run(obj, 'NORMAL', img, 16, normal_space='TANGENT')
        save_raw(img, f'cry{i}_normal.png')
        img = new_image(f'BAKE_cry{i}_rough', 1024, color=False)
        run(obj, 'ROUGHNESS', img, 1)
        save_raw(img, f'cry{i}_roughness.png')
        print(f'{name}: normal + roughness {time.time() - t0:.1f}s')

# ---------------------------------------------------------------- relics
if not only or 'relics' in only:
    everything = CRYSTALS + list(RELICS)
    energies = {n: bpy.data.lights[n].energy for n in LIGHTS}
    bg = scene.world.node_tree.nodes.get('Background')
    world_strength = bg.inputs['Strength'].default_value
    for name, short in RELICS.items():
        obj = O[name]
        loc = obj.location.copy()
        hidden = {n: O[n].hide_render for n in everything if n != name}
        try:
            for n in hidden:
                O[n].hide_render = True
            obj.location = (0, 0, 0)
            t0 = time.time()
            img = new_image(f'BAKE_{short}_color', 1024, color=True)
            run(obj, 'COMBINED', img, 256)
            save_color(img, f'relic_{short}_color.png')
            for n in LIGHTS:
                bpy.data.lights[n].energy = energies[n] * 0.2
            bg.inputs['Strength'].default_value = world_strength * 0.3
            img = new_image(f'BAKE_{short}_dark', 1024, color=True)
            run(obj, 'COMBINED', img, 256)
            save_color(img, f'relic_{short}_dark_color.png')
            print(f'{name}: color + dark {time.time() - t0:.1f}s')
        finally:
            for n in LIGHTS:
                bpy.data.lights[n].energy = energies[n]
            bg.inputs['Strength'].default_value = world_strength
            obj.location = loc
            for n, was in hidden.items():
                O[n].hide_render = was

# ---------------------------------------------------------------- env
if not only or 'env' in only:
    cd = bpy.data.cameras.get('CAM_VaultEnv') or bpy.data.cameras.new('CAM_VaultEnv')
    cd.type = 'PANO'
    cd.panorama_type = 'EQUIRECTANGULAR'
    cam = O.get('CAM_VaultEnv') or bpy.data.objects.new('CAM_VaultEnv', cd)
    if cam.name not in bpy.data.collections['S2_Rig'].objects:
        bpy.data.collections['S2_Rig'].objects.link(cam)
    cam.location = (0, 0, 0)
    cam.rotation_euler = (1.5708, 0, -1.5708)
    everything = CRYSTALS + list(RELICS)
    saved = dict(cam=scene.camera, rx=scene.render.resolution_x, ry=scene.render.resolution_y,
                 pct=scene.render.resolution_percentage, s=scene.cycles.samples,
                 path=scene.render.filepath,
                 vis={n: O[n].visible_camera for n in LIGHTS},
                 hid={n: O[n].hide_render for n in everything})
    try:
        for n in LIGHTS:
            O[n].visible_camera = True
        for n in everything:
            O[n].hide_render = True
        scene.camera = cam
        scene.render.resolution_x, scene.render.resolution_y = 1024, 512
        scene.render.resolution_percentage = 100
        scene.cycles.samples = 64
        fmt = scene.render.image_settings
        fmt.file_format, fmt.color_mode, fmt.color_depth = 'OPEN_EXR', 'RGB', '16'
        scene.render.filepath = os.path.join(opl.TEXTURES_DIR, 'env_vault.exr')
        bpy.ops.render.render(write_still=True)
        fmt.file_format, fmt.color_depth = 'PNG', '8'
        scene.render.filepath = os.path.join(opl.PREVIEW_DIR, 'env_vault_preview.png')
        bpy.ops.render.render(write_still=True)
        print('env_vault written')
    finally:
        scene.camera = saved['cam']
        scene.render.resolution_x, scene.render.resolution_y = saved['rx'], saved['ry']
        scene.render.resolution_percentage = saved['pct']
        scene.cycles.samples = saved['s']
        scene.render.filepath = saved['path']
        for n, v in saved['vis'].items():
            O[n].visible_camera = v
        for n, v in saved['hid'].items():
            O[n].hide_render = v

opl.save()
print('s2 bake done')
