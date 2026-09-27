# PROTOTYPE v6 (scratch): complete Toothless -> one skinned mesh with shape keys + pose clips -> GLB.
import bpy, bmesh, os, sys, math, time, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib
import berk_sdf, anatomy, sculpt_body, rig_build, fan, build_parts, head_parts
for m in (berk_sdf, anatomy, sculpt_body, rig_build, fan, build_parts, head_parts):
    importlib.reload(m)
from mathutils import Vector, Matrix
A = anatomy

OUT = os.path.join(HERE, "out_v6"); os.makedirs(OUT, exist_ok=True)
VOX = float(os.environ.get("BERK_VOX", "0.008"))
FACES = int(os.environ.get("BERK_FACES", "24000"))
t0 = time.time()
log = lambda *a: print(*a, "%.1fs" % (time.time() - t0))

S = sculpt_body.build(VOX)
log("sculpt")
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
rig = rig_build.build_armature()
body = S.to_mesh("Toothless", os.path.join(OUT, "body.vdb"))

def only(ob):
    for o in list(sc.objects): o.select_set(False)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)

# ---- game mesh: voxel remesh (closed manifold) -> degenerate cleanup -> QuadriFlow
only(body)
body.data.remesh_voxel_size = VOX; bpy.ops.object.voxel_remesh()
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.dissolve_degenerate(bm, dist=0.0006, edges=bm.edges[:])
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0006)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(body.data); bm.free()
body.data.use_mirror_x = True
r = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=True, mode="FACES", target_faces=FACES, seed=0)
for p in body.data.polygons: p.use_smooth = True
log("game mesh", r, len(body.data.polygons), "faces")

mats = build_parts.build_all(rig)                     # eyes(+pupil), ears, claws, wings, hip wings, tail fins
M = dict(mats)
M["mouth"] = bpy.data.materials.new("mouth"); M["mouth"].diffuse_color = (0.75, 0.3, 0.33, 1)
M["teeth"] = bpy.data.materials.new("teeth"); M["teeth"].diffuse_color = (0.95, 0.93, 0.88, 1)
body.data.materials.append(M["skin"])
log("mouth faces", head_parts.assign_mouth_material(body, M["mouth"], inset=0.03))

# ---- body weights: heat weights with non-body bones excluded
NON_BODY = ("wing_", "hipwing_", "tailfin_", "ear_", "saddle", "pedal_")
saved = {b.name: b.use_deform for b in rig.data.bones}
for b in rig.data.bones:
    b.use_deform = not b.name.startswith(NON_BODY)
for o in list(sc.objects): o.select_set(False)
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
for b in rig.data.bones: b.use_deform = saved[b.name]
jaw_g = body.vertex_groups.get("jaw")
log("jaw verts", sum(1 for v in body.data.vertices for g in v.groups if jaw_g and g.group == jaw_g.index and g.weight > 0.5))

# ---- head parts: lids (blink keys), teeth (teeth_out key); drop pupil meshes (the eye shader draws the pupil)
def rigid(ob, bone):
    g = ob.vertex_groups.new(name=bone); g.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = rig; ob.parent = rig
for s in (1, -1):
    for upper in (True, False):
        rigid(head_parts.lid(s, f"Lid{'U' if upper else 'D'}_{'L' if s > 0 else 'R'}", M["skin"], upper=upper), "head")
teeth = head_parts.teeth(M["teeth"])
for name, sel in (("head", lambda z: z > sculpt_body.MOUTH_Z), ("jaw", lambda z: z <= sculpt_body.MOUTH_Z)):
    g = teeth.vertex_groups.new(name=name); g.add([v.index for v in teeth.data.vertices if sel(v.co.z)], 1.0, "REPLACE")
mod = teeth.modifiers.new("Armature", "ARMATURE"); mod.object = rig; teeth.parent = rig
for ob in [o for o in sc.objects if o.name.startswith("Pupil_")]:
    bpy.data.objects.remove(ob)

# eye UVs: planar coordinates in each eye's frame (x = right, y = up, normalised by radius) -> iris shader
for s, sfx in ((1, "L"), (-1, "R")):
    eye = sc.objects[f"Eye_{sfx}"]
    n, up, r = head_parts.eye_frame(s)
    c = Vector((A.EYE_CENTER_L[0] * s, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2]))
    uv = eye.data.uv_layers.new(name="UVMap") if not eye.data.uv_layers else eye.data.uv_layers[0]
    for loop in eye.data.loops:
        p = eye.matrix_world @ eye.data.vertices[loop.vertex_index].co - c
        front = 1.0 if p.normalized().dot(n) > 0 else -1.0
        uv.data[loop.index].uv = (0.5 + 0.5 * p.dot(r) / A.EYE_RADIUS, 0.5 + 0.5 * p.dot(up) / A.EYE_RADIUS if front > 0 else -1.0)

# ---- join everything that rides the rig into ONE skinned mesh
parts = [o for o in sc.objects if o.type == "MESH" and o is not body]
for o in parts:
    only(o); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(sc.objects): o.select_set(False)
for o in parts: o.select_set(True)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
me = body.data
log("joined", len(me.vertices), "verts", len(me.polygons), "faces", "tris", sum(len(p.vertices) - 2 for p in me.polygons),
    "keys", [k.name for k in (me.shape_keys.key_blocks if me.shape_keys else [])], "mats", [m.name for m in me.materials])
# keep only the armature modifier pointing at the rig; limit to 4 influences, normalise
for md in list(body.modifiers):
    if md.type == "ARMATURE" and md.object != rig: body.modifiers.remove(md)
only(body)
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
unweighted = sum(1 for v in me.vertices if not v.groups)
log("unweighted", unweighted)

# ---- pose clips: every bone keyed (so glTF keeps full tracks), 2 frames
def keyframe_pose(name, setter):
    rig_build.reset_pose(rig)
    setter()
    act = bpy.data.actions.new(name)
    rig.animation_data_create(); rig.animation_data.action = act
    for f in (1, 2):
        for pb in rig.pose.bones:
            pb.rotation_mode = "QUATERNION"
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("location", frame=f)
    act.use_fake_user = True
    track = rig.animation_data.nla_tracks.new(); track.name = name
    track.strips.new(name, 1, act)
    rig.animation_data.action = None
    return act
def set_jaw():
    pb = rig.pose.bones["jaw"]; pb.rotation_mode = "XYZ"; pb.rotation_euler = (-0.5, 0, 0)
    q = pb.rotation_euler.to_quaternion(); pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = q
keyframe_pose("bind", lambda: None)
keyframe_pose("wings_folded", lambda: rig_build.fold_wings(rig, 1.0))
keyframe_pose("jaw_open", set_jaw)
rig_build.reset_pose(rig)
log("actions", [a.name for a in bpy.data.actions])

# ---- export (shape-key values become glTF default morph weights: they MUST be 0 or the rest pose shows blinks/teeth)
if me.shape_keys:
    for kb in me.shape_keys.key_blocks:
        kb.value = 0.0
for o in list(sc.objects): o.select_set(False)
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
glb = os.path.join(OUT, "toothless_v6.glb")
props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
opts = dict(filepath=glb, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_skins=True, export_morph=True, export_morph_normal=True, export_animations=True,
            export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_optimize_animation_size=False,
            export_optimize_animation_keep_anim_armature=True, export_def_bones=False, export_materials="EXPORT")
opts = {k: v for k, v in opts.items() if k == "filepath" or k in props}
missing = sorted(set(["export_optimize_animation_keep_anim_armature", "export_animation_mode", "export_force_sampling"]) - props)
print("export option names missing in this Blender:", missing)
bpy.ops.export_scene.gltf(**opts)
log("glb bytes", os.path.getsize(glb))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "toothless_v6.blend"))

