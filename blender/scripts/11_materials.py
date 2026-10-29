"""Bake materials for Scene 1 (stone blocks, sand terrain, gold, core). Stone and sand use
the photo-scanned textures in source-assets/textures, with procedural tone on top.

These only exist to be baked into colour maps. On the web everything except
the gold capstone renders unlit from the bakes.
"""
import sys, os, importlib, math
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy


opl.use_scene('S1')
Graph = opl.Graph


# ---------------------------------------------------------------- textures
# Photo-scanned textures supplied in source-assets/textures (1024^2, tileable).
TEX_DIR = os.path.join(opl.ROOT, 'source-assets', 'textures')
SAND_MEAN = (0.53, 0.35, 0.21)        # linear average of sand-basecolor.jpg
STONE_MEAN = (0.50, 0.28, 0.14)       # linear average of pyramid-basecolor.jpg
STONE_TARGET = (0.68, 0.50, 0.32)     # the lighter sandstone we re-tint it to
SAND_TILE = 1.6                       # metres per repeat (~10 ripples, ~0.16 m apart)
STONE_TILE = 0.9                      # metres per repeat on the blocks


def image(name, color=True, folder=TEX_DIR):
    im = bpy.data.images.load(os.path.join(folder, name), check_existing=True)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return im


# Colour comes from the blurred (low-pass) versions made by 13_detail_textures.py:
# the bakes can't hold grains, specks or crack lines, which the web draws live
# from the matching high-pass detail textures instead.
LOWPASS_DIR = os.path.join(opl.ROOT, 'blender', 'textures')


# ---------------------------------------------------------------- sandstone
# Cracked stone texture box-projected onto every block, offset per block
# (_rand) so neighbouring stones don't share the same patch. The per-block
# tone ramp only nudges brightness; sand still settles on the treads and the
# crack relief comes from the texture's own luminance.
# _casing = 1 (khafre/cased styles) reads as paler dressed stone.
g = Graph(opl.material('M_Sandstone'))
coord = g.node('ShaderNodeTexCoord')
geo = g.node('ShaderNodeNewGeometry')
rnd = g.node('ShaderNodeAttribute', p_attribute_name='_rand', p_attribute_type='GEOMETRY')
cas = g.node('ShaderNodeAttribute', p_attribute_name='_casing', p_attribute_type='GEOMETRY')
rough = g.math('SUBTRACT', 1.0, cas.outputs['Fac'])

offset = g.node('ShaderNodeCombineXYZ', X=g.math('MULTIPLY', rnd.outputs['Fac'], 13.7),
                Y=g.math('MULTIPLY', rnd.outputs['Fac'], 7.1), Z=g.math('MULTIPLY', rnd.outputs['Fac'], 3.3))
scaled = g.node('ShaderNodeVectorMath', p_operation='SCALE', Vector=coord.outputs['Object'])
scaled.inputs['Scale'].default_value = 1.0 / STONE_TILE
stone_co = g.node('ShaderNodeVectorMath', p_operation='ADD')
g.link(scaled.outputs['Vector'], stone_co.inputs[0])
g.link(offset.outputs['Vector'], stone_co.inputs[1])
stone = g.node('ShaderNodeTexImage', p_image=image('stone_lowpass.png', folder=LOWPASS_DIR), p_projection='BOX',
               p_projection_blend=0.3, Vector=stone_co.outputs['Vector'])

tone = g.ramp(rnd.outputs['Fac'], [
    (0.00, (0.84, 0.82, 0.80)),
    (0.30, (0.96, 0.95, 0.93)),
    (0.70, (1.04, 1.03, 1.00)),
    (1.00, (1.12, 1.10, 1.05)),
])
# The scan averages dark and saturated (STONE_MEAN); divide that out and
# re-tint to a lighter warm sandstone, keeping its cracks and variation.
remap = g.node('ShaderNodeVectorMath', p_operation='MULTIPLY', Vector=stone.outputs['Color'])
remap.inputs[1].default_value = tuple(t / m for t, m in zip(STONE_TARGET, STONE_MEAN))
col = g.mix(remap.outputs['Vector'], tone.outputs['Color'], 1.0, 'MULTIPLY')
col = g.mix(col, (1.3, 1.3, 1.35), cas.outputs['Fac'], 'MULTIPLY')         # dressed casing

# Sand settles on the core treads.
up = g.node('ShaderNodeSeparateXYZ', Vector=geo.outputs['Normal'])
flat = g.maprange(up.outputs['Z'], 0.8, 0.95)
sand_n = g.node('ShaderNodeTexNoise', Vector=coord.outputs['Object'], Scale=9.0, Detail=4.0)
sand_mask = g.maprange(g.math('MULTIPLY', flat, sand_n.outputs['Fac']), 0.25, 0.5)
col = g.mix(col, tuple(c * 1.05 for c in SAND_MEAN), g.math('MULTIPLY', sand_mask, rough))

# Relief from the texture: cracks are dark, so luminance works as height.
lum = g.node('ShaderNodeRGBToBW', Color=stone.outputs['Color'])
bevel = g.node('ShaderNodeBevel', Radius=0.006, p_samples=8)
bump = g.node('ShaderNodeBump', Strength=0.6, Distance=0.012, Height=lum.outputs['Val'],
              Normal=bevel.outputs['Normal'])
bsdf = g.node('ShaderNodeBsdfPrincipled', Roughness=0.92, Normal=bump.outputs['Normal'])
g.link(col, bsdf.inputs['Base Color'])
bsdf.inputs['Specular IOR Level'].default_value = 0.25
g.out(bsdf)

# ---------------------------------------------------------------- sand terrain
# Scanned sand (colour + normal) on the high-res base disk, sampled at two
# scales and blended by noise so the 1.6 m tile doesn't visibly repeat. The
# far ring is too coarse for it, so the texture fades out by r ~ 29 m and the
# far dunes use the texture's average colour instead (no seam). Dune tones,
# curvature and slip-face shading apply on top everywhere.
# The texture's ripples run along its X axis, i.e. across world Y, which is
# within ~20 deg of perpendicular to WIND in 20_terrain.py.
g = Graph(opl.material('M_Sand'))
coord = g.node('ShaderNodeTexCoord')
geo = g.node('ShaderNodeNewGeometry')
co = coord.outputs['Object']
uv = coord.outputs['UV']
base_uv_span = 2 * 30.0                                    # DUNE_Base UVs cover 60 m
uv_a = g.node('ShaderNodeVectorMath', p_operation='SCALE', Vector=uv)
uv_a.inputs['Scale'].default_value = base_uv_span / SAND_TILE
uv_b0 = g.node('ShaderNodeVectorMath', p_operation='SCALE', Vector=uv)
uv_b0.inputs['Scale'].default_value = base_uv_span / (SAND_TILE * 1.63)
uv_b = g.node('ShaderNodeVectorMath', p_operation='ADD')
g.link(uv_b0.outputs['Vector'], uv_b.inputs[0])
uv_b.inputs[1].default_value = (0.37, 0.61, 0.0)
sand_img = image('sand_lowpass.png', folder=LOWPASS_DIR)
sand_nrm = image('sand-normal.jpg', color=False)
col_a = g.node('ShaderNodeTexImage', p_image=sand_img, Vector=uv_a.outputs['Vector'])
col_b = g.node('ShaderNodeTexImage', p_image=sand_img, Vector=uv_b.outputs['Vector'])
nrm_a = g.node('ShaderNodeTexImage', p_image=sand_nrm, Vector=uv_a.outputs['Vector'])
nrm_b = g.node('ShaderNodeTexImage', p_image=sand_nrm, Vector=uv_b.outputs['Vector'])
blend_n = g.node('ShaderNodeTexNoise', Vector=co, Scale=0.08, Detail=2.0)
blend = g.maprange(blend_n.outputs['Fac'], 0.4, 0.6)
tex_col = g.mix(col_a.outputs['Color'], col_b.outputs['Color'], blend)
tex_nrm = g.mix(nrm_a.outputs['Color'], nrm_b.outputs['Color'], blend)

xy = g.node('ShaderNodeSeparateXYZ', Vector=co)
flat_xy = g.node('ShaderNodeCombineXYZ', X=xy.outputs['X'], Y=xy.outputs['Y'])
radius = g.node('ShaderNodeVectorMath', p_operation='LENGTH', Vector=flat_xy.outputs['Vector'])
fade = g.maprange(radius.outputs['Value'], 22.0, 29.0, 1.0, 0.0)
col = g.mix(SAND_MEAN, tex_col, fade)

# Broad tonal drift across the dunes (multipliers around 1).
big = g.node('ShaderNodeTexNoise', Vector=co, Scale=0.035, Detail=4.0)
drift = g.ramp(big.outputs['Fac'], [(0.30, (0.9, 0.86, 0.82)), (0.55, (1, 1, 1)), (0.80, (1.06, 1.08, 1.12))])
col = g.mix(col, drift.outputs['Color'], 1.0, 'MULTIPLY')
# Curvature from the dense mesh: crests catch a paler tone, hollows go deeper.
curv = g.maprange(geo.outputs['Pointiness'], 0.485, 0.515)
col = g.mix(col, (0.66, 0.49, 0.33), g.math('MULTIPLY', curv, 0.35))
col = g.mix(col, g.maprange(curv, 0.0, 0.5, 0.82, 1.0), 1.0, 'MULTIPLY')
# Steep slip faces are a touch darker and redder.
up = g.node('ShaderNodeSeparateXYZ', Vector=geo.outputs['Normal'])
steep = g.maprange(up.outputs['Z'], 0.97, 0.8)
col = g.mix(col, (0.44, 0.25, 0.13), g.math('MULTIPLY', steep, 0.5))

nmap = g.node('ShaderNodeNormalMap', p_space='TANGENT', p_uv_map='UVMap', Color=tex_nrm)
g.link(fade, nmap.inputs['Strength'])

# Beyond the scanned texture, large wind ripples (~2.5 m apart) keep the hills
# and far dunes from looking like smooth plastic. They follow the wind, skip
# the steep slip faces and vary in strength across the dunes.
align = g.node('ShaderNodeMapping', Vector=co)
align.inputs['Rotation'].default_value = (0.0, 0.0, -math.atan2(-0.94, -0.34))
mega = g.node('ShaderNodeTexWave', Vector=align.outputs['Vector'], Scale=0.125, Distortion=7.0,
              Detail=3.0, p_wave_type='BANDS', p_bands_direction='X')
mega.inputs['Detail Scale'].default_value = 0.5
far_in = g.maprange(radius.outputs['Value'], 20.0, 32.0)
calm = g.maprange(up.outputs['Z'], 0.88, 0.97)
vary_n = g.node('ShaderNodeTexNoise', Vector=co, Scale=0.02, Detail=2.0)
vary = g.maprange(vary_n.outputs['Fac'], 0.3, 0.7, 0.3, 1.0)
mega_mask = g.math('MULTIPLY', g.math('MULTIPLY', far_in, calm), vary)
col = g.mix(col, (0.42, 0.27, 0.15), g.math('MULTIPLY', g.math('MULTIPLY',
            g.math('SUBTRACT', 1.0, mega.outputs['Fac']), mega_mask), 0.18))
mega_bump = g.node('ShaderNodeBump', Distance=0.08, Height=g.math('MULTIPLY', mega.outputs['Fac'], mega_mask),
                   Normal=nmap.outputs['Normal'])
mega_bump.inputs['Strength'].default_value = 0.5
bsdf = g.node('ShaderNodeBsdfPrincipled', Roughness=1.0, Normal=mega_bump.outputs['Normal'])
g.link(col, bsdf.inputs['Base Color'])
bsdf.inputs['Specular IOR Level'].default_value = 0.15
g.out(bsdf)

# ---------------------------------------------------------------- gold + core
opl.material('M_Gold', (1.0, 0.77, 0.36, 1), rough=0.3, metal=1.0)
opl.material('M_Core', (0.06, 0.045, 0.035, 1), rough=1.0)

# Lighting/grade tweaks for more contrast between sunlit stone and cool shade.
scene = bpy.context.scene
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -0.75
sun = bpy.data.lights['SUN_Key']
sun.energy = 8.0
sun.color = (1.0, 0.74, 0.50)
# World: warm hazy horizon to cool zenith, sand-coloured below the horizon.
# It lights the bakes (cool fill in the shade) and is what the gold reflects.
g = Graph(bpy.data.worlds['W_Desert'])
wc = g.node('ShaderNodeTexCoord')
wz = g.node('ShaderNodeSeparateXYZ', Vector=wc.outputs['Generated'])
sky = g.ramp(g.maprange(wz.outputs['Z'], -1.0, 1.0), [
    (0.00, (0.42, 0.31, 0.20)),
    (0.49, (0.62, 0.48, 0.34)),
    (0.50, (0.86, 0.72, 0.58)),
    (0.60, (0.52, 0.58, 0.74)),
    (1.00, (0.24, 0.34, 0.62)),
])
bg = g.node('ShaderNodeBackground', Color=sky.outputs['Color'], Strength=0.35)
wo = g.node('ShaderNodeOutputWorld')
g.link(bg.outputs[0], wo.inputs['Surface'])

opl.save()
print('materials ok')
