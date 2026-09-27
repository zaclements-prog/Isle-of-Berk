# PROTOTYPE (scratch): mouth slit + jaw open + teeth_out + blink lids, head region at 5 mm.
import bpy, bmesh, os, sys, math, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib
import berk_sdf, anatomy, sculpt_body, rig_build, head_parts
for m in (berk_sdf, anatomy, sculpt_body, rig_build, head_parts):
    importlib.reload(m)
from mathutils import Vector
A = anatomy

OUT = os.path.join(HERE, "out_headtest"); os.makedirs(OUT, exist_ok=True)
t0 = time.time()
S = sculpt_body.build(0.005, lo=(-0.62, -2.34, 0.98), hi=(0.62, -1.05, 2.18))
print("sculpt %.1fs" % (time.time() - t0))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
rig = rig_build.build_armature()
body = S.to_mesh("Head", os.path.join(OUT, "head.vdb"))
# voxel remesh guarantees a closed manifold (thin walls from the VDB mesher break heat weighting)
for ob in list(sc.objects): ob.select_set(False)
bpy.context.view_layer.objects.active = body; body.select_set(True)
body.data.remesh_voxel_size = 0.005; bpy.ops.object.voxel_remesh()
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.dissolve_degenerate(bm, dist=0.0006, edges=bm.edges[:])
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0006)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(body.data); bm.free()
for p in body.data.polygons: p.use_smooth = True

def mat(name, rgb):
    m = bpy.data.materials.new(name); m.diffuse_color = (*rgb, 1); return m
M_SKIN, M_MOUTH, M_EYE, M_PUPIL, M_TEETH = mat("skin", (0.46, 0.47, 0.5)), mat("mouth", (0.75, 0.3, 0.33)), mat("eye", (0.62, 0.78, 0.16)), mat("pupil", (0.02, 0.02, 0.02)), mat("teeth", (0.95, 0.93, 0.88))
body.data.materials.append(M_SKIN)
n_mouth = head_parts.assign_mouth_material(body, M_MOUTH, inset=0.03)
print("mouth faces", n_mouth)

# auto weights: only head-region bones deform
KEEP = {"head", "jaw", "neck_03", "neck_04"}
saved = {b.name: b.use_deform for b in rig.data.bones}
for b in rig.data.bones:
    b.use_deform = b.name in KEEP
for ob in list(sc.objects): ob.select_set(False)
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
for b in rig.data.bones: b.use_deform = saved[b.name]
jaw_verts = sum(1 for v in body.data.vertices for g in v.groups if body.vertex_groups[g.group].name == "jaw" and g.weight > 0.5)
print("jaw-dominant verts", jaw_verts, "%.1fs" % (time.time() - t0))

def rigid(ob, bone):
    g = ob.vertex_groups.new(name=bone); g.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = rig; ob.parent = rig

for s in (1, -1):
    c = Vector((A.EYE_CENTER_L[0] * s, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2])); n = Vector(A.eye_dir(s))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=A.EYE_RADIUS, location=c, segments=48, ring_count=24)
    e = bpy.context.active_object; e.data.materials.append(M_EYE); rigid(e, "head")
    for p in e.data.polygons: p.use_smooth = True
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=c + n * A.EYE_RADIUS * 0.93, segments=24, ring_count=12)
    pu = bpy.context.active_object; pu.data.materials.append(M_PUPIL)
    pu.scale = (0.012, 0.012, 0.05); pu.rotation_euler = (0, 0, -math.atan2(n.x, -n.y))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); rigid(pu, "head")
    for upper in (True, False):
        lid = head_parts.lid(s, f"Lid{'U' if upper else 'D'}_{'L' if s > 0 else 'R'}", M_SKIN, upper=upper)
        rigid(lid, "head")
teeth = head_parts.teeth(M_TEETH)
gu = teeth.vertex_groups.new(name="head"); gl = teeth.vertex_groups.new(name="jaw")
gu.add([v.index for v in teeth.data.vertices if v.co.z > sculpt_body.MOUTH_Z], 1.0, "REPLACE")
gl.add([v.index for v in teeth.data.vertices if v.co.z <= sculpt_body.MOUTH_Z], 1.0, "REPLACE")
mod = teeth.modifiers.new("Armature", "ARMATURE"); mod.object = rig; teeth.parent = rig

sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"; sh.color_type = "MATERIAL"; sh.show_cavity = True; sh.cavity_type = "BOTH"; sh.show_backface_culling = False
w = bpy.data.worlds.new("W"); sc.world = w; w.color = (0.2, 0.22, 0.26)
def shoot(name, loc, target, lens=50, res=(1000, 800)):
    cd = bpy.data.cameras.new(name); cd.lens = lens
    cam = bpy.data.objects.new(name, cd); cam.location = loc; sc.collection.objects.link(cam)
    d = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = (math.pi / 2 + math.asin(max(-1, min(1, d.z))), 0, -math.atan2(d.x, d.y))
    sc.camera = cam; sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = os.path.join(OUT, name + ".png"); bpy.ops.render.render(write_still=True)
def set_state(jaw=0.0, teeth_out=0.0, blink=0.0):
    rig_build.reset_pose(rig)
    pb = rig.pose.bones["jaw"]; pb.rotation_mode = "XYZ"; pb.rotation_euler = (jaw, 0, 0)
    teeth.data.shape_keys.key_blocks["teeth_out"].value = teeth_out
    for ob in sc.objects:
        if ob.data and getattr(ob.data, "shape_keys", None):
            for kb in ob.data.shape_keys.key_blocks:
                if kb.name.startswith("blink"):
                    kb.value = blink
    bpy.context.view_layer.update()
FRONT = ((-0.95, -3.35, 1.62), (0, -1.9, 1.5))
SIDE34 = ((-1.45, -2.75, 1.55), (0, -1.9, 1.45))
for tag, st in (("neutral", {}), ("snarl", {"jaw": -0.38, "teeth_out": 1.0}), ("blink", {"blink": 1.0}), ("half_blink", {"blink": 0.5}), ("yawn", {"jaw": -0.62})):
    set_state(**st)
    shoot(f"{tag}_front", *FRONT)
    shoot(f"{tag}_34", *SIDE34)
print("done %.1fs" % (time.time() - t0))


