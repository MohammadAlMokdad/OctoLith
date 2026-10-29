"""Render an equirectangular HDR environment from just above the apex.

Output: public/assets/textures/env_desert.exr (scene-linear, half float).
Used as the reflection env for the gold capstone (and later the glass
blocks). The sun lamp isn't visible to camera rays, so the web scene adds a
matching directional light for the sun highlight.
"""
import sys, os, importlib, math
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy
opl.use_scene('S1')

W_, H_ = int(ARGS.get('width', 2048)), int(ARGS.get('width', 2048)) // 2
scene = bpy.context.scene
apex = 5.0 / 2 * math.tan(math.radians(51.84))

cd = bpy.data.cameras.get('CAM_Env') or bpy.data.cameras.new('CAM_Env')
cd.type = 'PANO'
cd.panorama_type = 'EQUIRECTANGULAR'
cam = bpy.data.objects.get('CAM_Env') or bpy.data.objects.new('CAM_Env', cd)
if cam.name not in bpy.data.collections['Rig'].objects:
    bpy.data.collections['Rig'].objects.link(cam)
cam.location = (0, 0, apex + 0.25)
# Equirect cameras look down their local -Z... point it at the horizon (+X)
# with Z up so the panorama's horizon is level.
cam.rotation_euler = (math.radians(90), 0, math.radians(-90))

hide = [o for o in (bpy.data.objects.get('PYR_Cap'),) if o]
saved = dict(camera=scene.camera, rx=scene.render.resolution_x, ry=scene.render.resolution_y,
             pct=scene.render.resolution_percentage, samples=scene.cycles.samples,
             fmt=scene.render.image_settings.file_format,
             depth=scene.render.image_settings.color_depth,
             mode=scene.render.image_settings.color_mode,
             path=scene.render.filepath)
for o in hide:
    o.hide_render = True
try:
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = W_, H_
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 96
    s = scene.render.image_settings
    s.file_format = 'OPEN_EXR'
    s.color_depth = '16'
    s.color_mode = 'RGB'
    out = os.path.join(opl.TEXTURES_DIR, 'env_desert.exr')
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
finally:
    for o in hide:
        o.hide_render = False
    scene.camera = saved['camera']
    scene.render.resolution_x, scene.render.resolution_y = saved['rx'], saved['ry']
    scene.render.resolution_percentage = saved['pct']
    scene.cycles.samples = saved['samples']
    s = scene.render.image_settings
    s.file_format, s.color_depth, s.color_mode = saved['fmt'], saved['depth'], saved['mode']
    scene.render.filepath = saved['path']

opl.save()
print('env', out, os.path.getsize(out) // 1024, 'KB')
