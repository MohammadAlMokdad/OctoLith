"""Export Scene 2 meshes to public/assets/models/.

  vault.glb   CRY_1..3 (tangents, UV0 atlas + UV1 box projection)
  relics.glb  RELIC_Tut, RELIC_Cat, RELIC_Ankh (58_sketchfab_relics.py)

Objects are exported at the origin (their preview SLOT_X offsets are removed);
each relic shares its crystal's origin, so the web places both at one point.
"""
import sys, os, importlib
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import bpy

opl.use_scene('S2')
O = bpy.data.objects
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')

for filename, names, opts in (
        ('vault.glb', ['CRY_1', 'CRY_2', 'CRY_3'], dict(tangents=True)),
        ('relics.glb', ['RELIC_Tut', 'RELIC_Cat', 'RELIC_Ankh'], {})):
    objs = [O[n] for n in names]
    saved = [o.location.copy() for o in objs]
    tris = []
    try:
        for o in objs:
            o.location = (0, 0, 0)
            if opts.get('tangents'):
                # Tangents need triangles; export_apply bakes this modifier in.
                m = o.modifiers.new('EXPORT_TRI', 'TRIANGULATE')
                m.keep_custom_normals = True
                tris.append((o, m))
        path = opl.export_glb(objs, filename, **opts)
    finally:
        for o, m in tris:
            o.modifiers.remove(m)
        for o, loc in zip(objs, saved):
            o.location = loc
    print(f'{filename}: {len(objs)} objects, {os.path.getsize(path) / 1024:.0f} KB')
