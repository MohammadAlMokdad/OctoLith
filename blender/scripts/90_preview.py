"""Render a quick Cycles preview from a camera to blender/previews/<name>.png.

ARGS: name (default 'preview'), camera (default CAM_Hero; CAM_Web is the web's
exact hero camera, introConfig camera.hero, on the user's 1707 x 1067), res (percentage,
default 50), samples (default 64), ground (1 = add a temporary flat ground if
no terrain exists), hide (comma-separated object names to hide from the render).
"""
import sys, os, importlib
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy, bmesh

name = ARGS.get('name', 'preview')
cam = bpy.data.objects[ARGS.get('camera', 'CAM_Hero')]
scene = opl.use_scene(cam.users_scene[0].name)   # render the scene that owns the camera

tmp = None
if scene.name == 'S1' and ARGS.get('ground', '1') == '1' and not any(o.name.startswith('DUNE_') for o in scene.objects):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=200)
    tmp = opl.mesh_object('TMP_Ground', bm, scene.collection,
                          opl.material('M_TmpSand', (0.62, 0.48, 0.32, 1), rough=1.0))

hidden = [bpy.data.objects[n] for n in filter(None, ARGS.get('hide', '').split(','))]
for o in hidden:
    o.hide_render = True

old = (scene.camera, scene.render.resolution_percentage, scene.cycles.samples,
       scene.render.filepath)
scene.camera = cam
scene.render.resolution_percentage = int(ARGS.get('res', 50))
scene.cycles.samples = int(ARGS.get('samples', 64))
os.makedirs(opl.PREVIEW_DIR, exist_ok=True)
out = os.path.join(opl.PREVIEW_DIR, name + '.png')
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
scene.camera, scene.render.resolution_percentage, scene.cycles.samples, scene.render.filepath = old

for o in hidden:
    o.hide_render = False
if tmp is not None:
    opl.remove_object('TMP_Ground')
print('rendered', out)
