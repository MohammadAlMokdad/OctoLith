"""The slot relics from Sketchfab (they replace the hand-built RELIC_OctoAnkh,
RELIC_Scarab and RELIC_Falcon, which move to the excluded S2_Retired
collection):

  RELIC_Tut   slot 1 (CRY_1)  Tutankhamun's funerary mask
              source-assets/sketchfab/tutankhamun-mask-hunyuan/source/tut hunyuan.glb
              (500k triangles: decimated to `tris`)
  RELIC_Cat   slot 2 (CRY_2)  an Egyptian cat statue (Bastet)
              source-assets/sketchfab/egyptian-cat-statue/source/model.zip (Collada, which Blender 5
              no longer imports: converted here) + its textures/
  RELIC_Ankh  slot 3 (CRY_3)  an ankh
              source-assets/sketchfab/ankh_asset.glb ("Ankh Asset" by scrampunk, CC BY 4.0)

Each one is flattened into a single mesh with a single UV map (the one its
textures use; the bake reuses it), turned `turn` degrees about Z, scaled to
`height` m and centred on its crystal (+ `offset`), then checked for
containment. Re-runnable: it replaces the RELIC_* it builds.
ARGS: only=tut,cat,ankh (default all)
"""
import sys, os, importlib, math, zipfile, tempfile
import xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(__file__))
import opl; importlib.reload(opl)
import relic_lib; importlib.reload(relic_lib)
import bpy
from mathutils import Vector, Matrix

opl.use_scene('S2')
O = bpy.data.objects
col = opl.collection('S2_Vault')
ROOT = opl.ROOT
SRC = os.path.join(ROOT, 'source-assets', 'sketchfab')  # the Sketchfab downloads (see source-assets/README.md)

RELICS = {
    'tut': dict(name='RELIC_Tut', slot=1, crystal='CRY_1', height=1.3, turn=0.0, offset=(0, 0, 0), tris=60000,
                src=os.path.join(SRC, 'tutankhamun-mask-hunyuan', 'source', 'tut hunyuan.glb')),
    'cat': dict(name='RELIC_Cat', slot=2, crystal='CRY_2', height=1.3, turn=-35.0, offset=(0, 0, 0), tris=None,
                src=os.path.join(SRC, 'egyptian-cat-statue', 'source', 'model.zip'),
                textures=os.path.join(SRC, 'egyptian-cat-statue', 'textures')),
    'ankh': dict(name='RELIC_Ankh', slot=3, crystal='CRY_3', height=1.45, turn=90.0, offset=(0, 0, 0), tris=None,
                 src=os.path.join(SRC, 'ankh_asset.glb')),
}
OLD = ['RELIC_OctoAnkh', 'RELIC_Scarab', 'RELIC_Falcon']
only = set(filter(None, ARGS.get('only', '').split(','))) or set(RELICS)


def retire_old():
    """Keep the hand-built relics in the .blend, out of renders and bakes."""
    retired = bpy.data.collections.get('S2_Retired') or bpy.data.collections.new('S2_Retired')
    if retired.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(retired)
    for n in OLD:
        o = O.get(n)
        if o is None:
            continue
        for c in list(o.users_collection):
            c.objects.unlink(o)
        retired.objects.link(o)
    lc = bpy.context.view_layer.layer_collection.children.get('S2_Retired')
    if lc:
        lc.exclude = True


def imported(fn):
    """Run an import, return the objects it added."""
    before = set(O)
    fn()
    return [o for o in O if o not in before]


def cat_obj(zip_path, out_dir):
    """The cat's Collada (one polylist, one index for every input) -> OBJ."""
    ns = {'c': 'http://www.collada.org/2005/11/COLLADASchema'}
    with zipfile.ZipFile(zip_path) as z:
        root = ET.fromstring(z.read('model/model.dae'))
    arr = {a.get('id'): [float(x) for x in a.text.split()] for a in root.iterfind('.//c:float_array', ns)}
    P, N, T = (arr[f'meshId0-{k}-array'] for k in ('positions', 'normals', 'tex0'))
    pl = root.find('.//c:polylist', ns)
    vcount = [int(x) for x in pl.find('c:vcount', ns).text.split()]
    idx = [int(x) for x in pl.find('c:p', ns).text.split()]
    path = os.path.join(out_dir, 'cat.obj')
    with open(path, 'w') as f:
        f.write('o Cat_Statue\n')
        f.writelines(f'v {P[i]} {P[i + 1]} {P[i + 2]}\n' for i in range(0, len(P), 3))
        f.writelines(f'vt {T[i]} {T[i + 1]}\n' for i in range(0, len(T), 2))
        f.writelines(f'vn {N[i]} {N[i + 1]} {N[i + 2]}\n' for i in range(0, len(N), 3))
        k = 0
        for n in vcount:
            f.write('f ' + ' '.join(f'{j + 1}/{j + 1}/{j + 1}' for j in idx[k:k + n]) + '\n')
            k += n
    return path


def cat_material(tex_dir):
    """Principled material from the cat's PBR maps (AO multiplied into the colour)."""
    m = bpy.data.materials.get('M_CatStatue') or bpy.data.materials.new('M_CatStatue')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    def image(file, color):
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = bpy.data.images.load(os.path.join(tex_dir, file), check_existing=True)
        node.image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        return node

    albedo = image('M_Cat_Statue_albedo.jpeg', True)
    ao = image('M_Cat_Statue_AO.jpeg', False)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(albedo.outputs['Color'], mix.inputs['A'])
    nt.links.new(ao.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    nt.links.new(image('M_Cat_Statue_roughness.jpeg', False).outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(image('M_Cat_Statue_metallic.jpeg', False).outputs['Color'], bsdf.inputs['Metallic'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(image('M_Cat_Statue_normal.png', False).outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def single_mesh(objs, name):
    """Bake every node transform into the meshes, join them, drop the empties."""
    meshes = [o for o in objs if o.type == 'MESH']
    for o in meshes:
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    for o in objs:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    opl.select_only(meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    old = O.get(name)
    if old is not None and old is not obj:
        opl.remove_object(name)
    obj.name = obj.data.name = name
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    # one UV map: the first (what the textures read; the bake writes it too)
    uvs = obj.data.uv_layers
    while len(uvs) > 1:
        uvs.remove(uvs[-1])
    uvs[0].name = 'UVMap'
    uvs.active = uvs[0]
    uvs[0].active_render = True
    return obj


def build(key, spec):
    if key == 'cat':
        tmp = tempfile.mkdtemp()
        path = cat_obj(spec['src'], tmp)
        objs = imported(lambda: bpy.ops.wm.obj_import(filepath=path, forward_axis='NEGATIVE_Z', up_axis='Y'))
        obj = single_mesh(objs, spec['name'])
        obj.data.materials.clear()
        obj.data.materials.append(cat_material(spec['textures']))
    else:
        objs = imported(lambda: bpy.ops.import_scene.gltf(filepath=spec['src']))
        obj = single_mesh(objs, spec['name'])
    me = obj.data

    if spec['tris']:
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        if tris > spec['tris']:
            mod = obj.modifiers.new('DECIMATE', 'DECIMATE')
            mod.ratio = spec['tris'] / tris
            mod.use_collapse_triangulate = True
            opl.select_only([obj])
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)

    # turn, scale to height, centre on the crystal (relic and crystal share an origin)
    me.transform(Matrix.Rotation(math.radians(spec['turn']), 4, 'Z'))
    xs, ys, zs = zip(*(v.co[:] for v in me.vertices))
    size = Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))
    mid = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(zs) + min(zs)) / 2))
    k = spec['height'] / size.z
    cry = O[spec['crystal']]
    pts = [cry.matrix_world @ Vector(c) for c in cry.bound_box]
    cmid = sum(pts, Vector()) / 8 - cry.location
    me.transform(Matrix.Translation(cmid + Vector(spec['offset'])) @ Matrix.Scale(k, 4) @ Matrix.Translation(-mid))
    obj.location = (relic_lib.SLOT_X[spec['slot']], 0, 0)
    obj.rotation_euler = (0, 0, 0)
    obj.scale = (1, 1, 1)

    xs, ys, zs = zip(*(v.co[:] for v in me.vertices))
    d = Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))
    print(f"{spec['name']}: verts={len(me.vertices)} tris={sum(len(p.vertices) - 2 for p in me.polygons)} "
          f"size={d.x:.2f}x{d.y:.2f}x{d.z:.2f} mats={[s.material.name for s in obj.material_slots if s.material]} "
          f"sampled-outside-{spec['crystal']}={relic_lib.outside_count(obj, spec['crystal'])}")


if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
retire_old()
for key in ('tut', 'cat', 'ankh'):
    if key in only:
        build(key, RELICS[key])
