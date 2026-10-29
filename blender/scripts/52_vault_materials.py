"""Scene 2 materials.

M_Quartz     sand-frosted desert quartz. Bakes to per-crystal normal (tangent)
             and roughness maps; roughness varies facet to facet (_facet) so
             some faces are nearly clear and others heavily frosted.
M_RelicGold  polished gold with faint wear
M_Lapis      lapis lazuli with pyrite flecks
M_Carnelian  carnelian in the brand orange (#FF4B1F)
M_Obsidian   black glassy stone (eyes)
M_Alabaster  creamy translucent stone (the falcon's white crown)
"""
import sys, os, importlib
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy

opl.use_scene('S2')
Graph = opl.Graph


def mat(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


# ---------------------------------------------------------------- quartz
g = Graph(mat('M_Quartz'))
co = g.node('ShaderNodeTexCoord').outputs['Object']
facet = g.node('ShaderNodeAttribute', p_attribute_name='_facet', p_attribute_type='GEOMETRY')
frost_n = g.node('ShaderNodeTexNoise', Vector=co, Scale=4.0, Detail=4.0)
rough = g.math('MULTIPLY', g.maprange(facet.outputs['Fac'], 0.0, 1.0, 0.18, 0.8),
               g.maprange(frost_n.outputs['Fac'], 0.3, 0.7, 0.75, 1.2))
rough = g.math('MINIMUM', g.math('MAXIMUM', rough, 0.05), 0.9)
# Sandblasted surface: fine pits plus grain, stronger where the facet is frostier.
pits = g.node('ShaderNodeTexVoronoi', Vector=co, Scale=70.0)
pit = g.maprange(pits.outputs['Distance'], 0.0, 0.3, 1.0, 0.0)
grain = g.node('ShaderNodeTexNoise', Vector=co, Scale=30.0, Detail=8.0)
stretch = g.node('ShaderNodeMapping', Vector=co)
stretch.inputs['Scale'].default_value = (1.0, 14.0, 14.0)       # wind streaks along X
streak = g.node('ShaderNodeTexNoise', Vector=stretch.outputs['Vector'], Scale=5.0, Detail=3.0)
height = g.math('ADD', g.math('MULTIPLY', pit, 0.45),
                g.math('ADD', g.math('MULTIPLY', grain.outputs['Fac'], 0.35),
                       g.math('MULTIPLY', streak.outputs['Fac'], 0.2)))
bump = g.node('ShaderNodeBump', Distance=0.02, Height=height)
g.link(g.math('MULTIPLY', rough, 0.6), bump.inputs['Strength'])
bsdf = g.node('ShaderNodeBsdfPrincipled', Normal=bump.outputs['Normal'])
g.link(rough, bsdf.inputs['Roughness'])
bsdf.inputs['Base Color'].default_value = (1.0, 0.95, 0.88, 1)
bsdf.inputs['Transmission Weight'].default_value = 1.0
bsdf.inputs['IOR'].default_value = 1.54
g.out(bsdf)

# ---------------------------------------------------------------- gold
g = Graph(mat('M_RelicGold'))
co = g.node('ShaderNodeTexCoord').outputs['Object']
wear = g.node('ShaderNodeTexNoise', Vector=co, Scale=9.0, Detail=6.0)
bsdf = g.node('ShaderNodeBsdfPrincipled', Metallic=1.0)
g.link(g.maprange(wear.outputs['Fac'], 0.3, 0.7, 0.14, 0.34), bsdf.inputs['Roughness'])
g.link(g.mix((1.0, 0.74, 0.32), (0.93, 0.64, 0.26), wear.outputs['Fac']), bsdf.inputs['Base Color'])
g.out(bsdf)

# ---------------------------------------------------------------- lapis
g = Graph(mat('M_Lapis'))
co = g.node('ShaderNodeTexCoord').outputs['Object']
veins = g.node('ShaderNodeTexNoise', Vector=co, Scale=7.0, Detail=8.0, Roughness=0.65)
blue = g.ramp(veins.outputs['Fac'], [(0.35, (0.02, 0.05, 0.30)), (0.55, (0.05, 0.12, 0.52)),
                                     (0.75, (0.20, 0.30, 0.62))])
flecks = g.node('ShaderNodeTexVoronoi', Vector=co, Scale=55.0, p_feature='F1')
fleck = g.maprange(flecks.outputs['Distance'], 0.05, 0.02)   # tiny bright cells
bsdf = g.node('ShaderNodeBsdfPrincipled', Roughness=0.3)
g.link(g.mix(blue.outputs['Color'], (1.0, 0.78, 0.35), fleck), bsdf.inputs['Base Color'])
g.link(fleck, bsdf.inputs['Metallic'])
g.out(bsdf)

# ---------------------------------------------------------------- carnelian / obsidian
g = Graph(mat('M_Carnelian'))
co = g.node('ShaderNodeTexCoord').outputs['Object']
cloud = g.node('ShaderNodeTexNoise', Vector=co, Scale=5.0, Detail=5.0)
# Tuned toward the brand orange #FF4B1F (linear ~ 1.0, 0.07, 0.013).
bsdf = g.node('ShaderNodeBsdfPrincipled', Roughness=0.18)
g.link(g.ramp(cloud.outputs['Fac'], [(0.3, (0.62, 0.05, 0.012)), (0.7, (1.0, 0.10, 0.025))]).outputs['Color'],
       bsdf.inputs['Base Color'])
g.out(bsdf)

opl.material('M_Obsidian', (0.015, 0.015, 0.02, 1), rough=0.08)

# ---------------------------------------------------------------- alabaster
# Creamy translucent stone for the white crown (hedjet).
g = Graph(mat('M_Alabaster'))
co = g.node('ShaderNodeTexCoord').outputs['Object']
veil = g.node('ShaderNodeTexNoise', Vector=co, Scale=6.0, Detail=6.0)
bsdf = g.node('ShaderNodeBsdfPrincipled', Roughness=0.3)
g.link(g.ramp(veil.outputs['Fac'], [(0.35, (0.86, 0.80, 0.68)), (0.7, (0.95, 0.92, 0.85))]).outputs['Color'],
       bsdf.inputs['Base Color'])
bsdf.inputs['Subsurface Weight'].default_value = 0.3
bsdf.inputs['Subsurface Radius'].default_value = (0.9, 0.7, 0.45)
bsdf.inputs['Subsurface Scale'].default_value = 0.03
g.out(bsdf)

opl.save()
print('vault materials ok')
