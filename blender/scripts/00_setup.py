"""Reset the scene: units, render settings, collections, hero camera, lighting."""
import sys, os, importlib, math
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy
opl.use_scene('S1')
from mathutils import Vector

scene = bpy.context.scene

# Start clean on first run (default cube scene).
for name in ('Cube', 'Light', 'Camera'):
    opl.remove_object(name)

scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0

# Cycles on the RTX GPU, used for previews and bakes.
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == 'OPTIX'
scene.cycles.device = 'GPU'
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'None'

for name in ('S1_Dunes', 'Rig'):
    opl.collection(name)
rig = opl.collection('Rig')

# Hero camera matches igloo.inc's resting camera: three.js (-14, 4, 14) looking
# at (0, 1, 0) with a 30 deg vertical FOV. In Blender (Z-up) that's
# (-14, -14, 4) looking at (0, 0, 1).
opl.remove_object('CAM_Hero')
cam_data = bpy.data.cameras.get('CAM_Hero') or bpy.data.cameras.new('CAM_Hero')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(30)
cam_data.clip_start = 0.1
cam_data.clip_end = 1000
cam = bpy.data.objects.new('CAM_Hero', cam_data)
rig.objects.link(cam)
cam.location = (-14, -14, 4)
direction = Vector((0, 0, 1)) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

# Key light: low warm sun from camera-left so the -X face is lit and the
# -Y face falls into cool sky shadow (keeps the gold accent readable).
opl.remove_object('SUN_Key')
sun_data = bpy.data.lights.get('SUN_Key') or bpy.data.lights.new('SUN_Key', 'SUN')
sun_data.color = (1.0, 0.80, 0.58)
sun_data.energy = 3.2
sun_data.angle = math.radians(1.8)
sun = bpy.data.objects.new('SUN_Key', sun_data)
rig.objects.link(sun)
to_sun = Vector((-0.37, 0.825, 0.423)).normalized()   # behind-left, 25 deg up
sun.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()

# World: cool dusk sky fill.
world = bpy.data.worlds.get('W_Desert') or bpy.data.worlds.new('W_Desert')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value = (0.36, 0.42, 0.60, 1.0)
bg.inputs['Strength'].default_value = 0.9

opl.save()
print('setup ok', opl.BLEND_PATH)
