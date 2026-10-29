"""Export Scene 1 meshes to public/assets/models/ as uncompressed GLB.

The GLBs ship as exported: the web build has no Draco/KTX2 step. The one
post-export step is `node tools/trim-world.mjs`, which drops the triangles no
camera can see and crops the bakes, keeping the custom attributes.

  pyramid.glb    PYR_Blocks, PYR_Cap, PYR_Core, PYR_Cage (lines),
                 PYR_Outline (lines), PYR_IntroPoints (points)
  terrain.glb    DUNE_Base, DUNE_Far
  landmarks.glb  LAND_Pyramid.001-005 (nodes share one mesh)
(patches.glb, the rubble beside the pyramid, went on 2026-10-02: clear sand.)
"""
import sys, os, importlib
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy
opl.use_scene('S1')

O = bpy.data.objects
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')

exports = [
    ('pyramid.glb', ['PYR_Blocks', 'PYR_Cap', 'PYR_Core', 'PYR_Cage', 'PYR_Outline',
                     'PYR_Edges', 'PYR_IntroPoints'], dict(loose_edges=True, loose_points=True)),
    ('terrain.glb', ['DUNE_Base', 'DUNE_Far'], {}),
    ('landmarks.glb', sorted(o.name for o in O if o.name.startswith('LAND_Pyramid.')), {}),
]
for filename, names, opts in exports:
    names = [n for n in names if n in O]          # PYR_Cap is absent on the stepped style
    path = opl.export_glb([O[n] for n in names], filename, **opts)
    print(f'{filename}: {len(names)} objects, {os.path.getsize(path) / 1024:.0f} KB')
