"""Shared helpers for OctoPyramid Blender scripts.

Scripts are sent to Blender through tools/blender.mjs, which defines
ARGS and __file__ before the script body. Import this module with:

    import sys, os, importlib
    sys.path.insert(0, os.path.dirname(__file__))
    import opl; importlib.reload(opl)
"""
import os
import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BLEND_PATH = os.path.join(ROOT, 'blender', 'octopyramid.blend')
MODELS_DIR = os.path.join(ROOT, 'public', 'assets', 'models')
TEXTURES_DIR = os.path.join(ROOT, 'public', 'assets', 'textures')
PREVIEW_DIR = os.path.join(ROOT, 'blender', 'previews')

# Blender is Z-up, three.js is Y-up. The glTF exporter converts positions and
# normals but NOT custom attributes, so vector attributes are stored already
# converted to three.js space.
def to_three(v):
    return (v[0], v[2], -v[1])


def use_scene(name):
    """Make scene `name` active (created on first use). Each web scene has its
    own Blender scene so lights and worlds don't leak between bakes."""
    sc = bpy.data.scenes.get(name)
    if sc is None:
        sc = bpy.data.scenes.new(name)
    bpy.context.window.scene = sc
    return sc


def collection(name, parent=None):
    """Get or create a collection and make sure it's linked into the active
    scene (or `parent`)."""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if col.name not in parent.children:
        parent.children.link(col)
    return col


def clear_collection(col):
    for obj in list(col.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve):
                bpy.data.curves.remove(data)


def remove_object(name):
    obj = bpy.data.objects.get(name)
    if obj is not None:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if isinstance(data, bpy.types.Mesh) and data.users == 0:
            bpy.data.meshes.remove(data)


def mesh_object(name, bm, col, material=None):
    """Create (or replace) an object from a bmesh and link it to col."""
    remove_object(name)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    if material is not None:
        me.materials.append(material)
    return obj


def set_attr(mesh, name, values, kind='FLOAT', domain='POINT'):
    """values: flat per-element list (scalars, or tuples for FLOAT_VECTOR)."""
    if name in mesh.attributes:
        mesh.attributes.remove(mesh.attributes[name])
    attr = mesh.attributes.new(name, kind, domain)
    if kind == 'FLOAT_VECTOR':
        flat = [c for v in values for c in v]
        attr.data.foreach_set('vector', flat)
    elif kind == 'FLOAT_COLOR':
        flat = [c for v in values for c in v]
        attr.data.foreach_set('color', flat)
    else:
        attr.data.foreach_set('value', list(values))
    return attr


def material(name, color=(0.8, 0.8, 0.8, 1.0), rough=0.8, metal=0.0, emission=None):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    if bsdf is None:
        nodes.clear()
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        out = nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(bsdf.outputs[0], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = emission[0]
        bsdf.inputs['Emission Strength'].default_value = emission[1]
    mat.diffuse_color = color
    return mat


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export_glb(objs, filename, draco=False, loose_edges=False, loose_points=False, tangents=False):
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, filename)
    select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        use_active_scene=True,          # multiple Blender scenes: don't pull in other scenes' selections
        export_apply=True,
        export_attributes=True,
        export_materials='NONE',
        export_normals=True,
        export_texcoords=True,
        export_tangents=tangents,
        export_yup=True,
        export_extras=False,
        export_animations=False,
        use_mesh_edges=loose_edges,
        use_mesh_vertices=loose_points,
        export_draco_mesh_compression_enable=draco,
    )
    return path


def save():
    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)


class Graph:
    """Tiny helper for building node trees in code."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def node(self, kind, **inputs):
        n = self.nt.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 220
        for key, val in inputs.items():
            if key.startswith('p_'):
                setattr(n, key[2:], val)
            elif isinstance(val, bpy.types.NodeSocket):
                self.nt.links.new(val, n.inputs[key])
            else:
                n.inputs[key].default_value = val
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def ramp(self, fac, stops):
        n = self.node('ShaderNodeValToRGB', Fac=fac)
        els = n.color_ramp.elements
        while len(els) > len(stops):
            els.remove(els[-1])
        while len(els) < len(stops):
            els.new(0.5)
        for el, (pos, col) in zip(els, stops):
            el.position = pos
            el.color = (*col, 1.0) if len(col) == 3 else col
        return n

    def mix(self, a, b, fac, blend='MIX'):
        n = self.node('ShaderNodeMix', p_data_type='RGBA', p_blend_type=blend)
        if isinstance(fac, bpy.types.NodeSocket):
            self.link(fac, n.inputs['Factor'])
        else:
            n.inputs['Factor'].default_value = fac
        for sock, val in ((n.inputs[6], a), (n.inputs[7], b)):
            if isinstance(val, bpy.types.NodeSocket):
                self.link(val, sock)
            else:
                sock.default_value = (*val, 1.0)
        return n.outputs[2]

    def math(self, op, a, b=0.0, clamp=False):
        n = self.node('ShaderNodeMath', p_operation=op, p_use_clamp=clamp)
        for sock, val in ((n.inputs[0], a), (n.inputs[1], b)):
            if isinstance(val, bpy.types.NodeSocket):
                self.link(val, sock)
            else:
                sock.default_value = val
        return n.outputs[0]

    def maprange(self, val, a, b, c=0.0, d=1.0):
        n = self.node('ShaderNodeMapRange', Value=val)
        n.inputs['From Min'].default_value = a
        n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c
        n.inputs['To Max'].default_value = d
        return n.outputs[0]

    def out(self, bsdf):
        o = self.node('ShaderNodeOutputMaterial')
        self.link(bsdf.outputs[0], o.inputs['Surface'])
