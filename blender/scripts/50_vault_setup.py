"""Scene 2 'Relic Vault' setup (igloo: cubes scene): its own Blender scene
with studio lighting, a dark warm world and the showcase camera.

igloo's cube camera sits at three.js (0, 0, 5) with a 45 deg FOV, looking
down -Z at a cube at the origin. In Blender that's (0, -5, 0) looking +Y.
Showcase items are laid out side by side along X (SLOT_X) for previews only;
the web stacks them vertically.
"""
import sys, os, importlib, math
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy
from mathutils import Vector

scene = opl.use_scene('S2')
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 16
scene.cycles.transmission_bounces = 16
scene.cycles.caustics_refractive = True
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = 0.0
scene.unit_settings.system = 'METRIC'
for name in ('S2_Vault', 'S2_Rig'):
    opl.collection(name)
rig = bpy.data.collections['S2_Rig']


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


# Showcase camera (single item) and an overview camera for all three.
for cname, loc, target, fov in (('CAM_Vault', (0, -5, 0), (0, 0, 0), 45),
                                ('CAM_VaultAll', (0, -11, 0.4), (0, 0, 0), 40)):
    opl.remove_object(cname)
    cd = bpy.data.cameras.get(cname) or bpy.data.cameras.new(cname)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(fov)
    cam = bpy.data.objects.new(cname, cd)
    rig.objects.link(cam)
    cam.location = loc
    aim(cam, target)
# One camera per preview slot, framed like the web's single-item view.
SLOT_X = {1: -3.3, 2: 0.0, 3: 3.3}
for i, x in SLOT_X.items():
    cname = f'CAM_Slot{i}'
    opl.remove_object(cname)
    cd = bpy.data.cameras.get(cname) or bpy.data.cameras.new(cname)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(45)
    cam = bpy.data.objects.new(cname, cd)
    rig.objects.link(cam)
    cam.location = (x, -5, 0)
    aim(cam, (x, 0, 0))
scene.camera = bpy.data.objects['CAM_VaultAll']

# Studio lights: warm key softbox upper-left-front, cool-neutral rim strip
# behind right, soft top light. These are what the glass refracts and the
# relic bakes are lit by.
LIGHTS = [
    ('L_Key', (-3.2, -3.4, 2.6), (2.2, 1.4), (1.0, 0.86, 0.70), 900),
    ('L_Rim', (3.0, 2.6, 0.6), (0.35, 3.2), (0.92, 0.94, 1.0), 700),
    ('L_Top', (0.0, 0.4, 3.6), (2.0, 2.0), (1.0, 0.93, 0.84), 350),
    ('L_Kick', (-3.4, 2.4, -1.2), (0.3, 2.4), (1.0, 0.78, 0.52), 300),
]
for name, loc, size, color, power in LIGHTS:
    opl.remove_object(name)
    ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size, ld.size_y = size
    ld.color = color
    ld.energy = power
    lo = bpy.data.objects.new(name, ld)
    rig.objects.link(lo)
    lo.location = loc
    aim(lo, (0, 0, 0))

# World: dark warm dusk gradient (the vault background itself is drawn on the web).
world = bpy.data.worlds.get('W_Vault') or bpy.data.worlds.new('W_Vault')
scene.world = world
g = opl.Graph(world)
wc = g.node('ShaderNodeTexCoord')
wz = g.node('ShaderNodeSeparateXYZ', Vector=wc.outputs['Generated'])
sky = g.ramp(g.maprange(wz.outputs['Z'], -1.0, 1.0), [
    (0.00, (0.05, 0.035, 0.025)),
    (0.50, (0.28, 0.19, 0.12)),
    (1.00, (0.10, 0.09, 0.10)),
])
bg = g.node('ShaderNodeBackground', Color=sky.outputs['Color'], Strength=0.6)
g.link(bg.outputs[0], g.node('ShaderNodeOutputWorld').inputs['Surface'])

opl.save()
print('vault setup ok')
