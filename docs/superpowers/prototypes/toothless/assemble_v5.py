# PROTOTYPE v5 (scratch): game-mesh retopo (QuadriFlow) + automatic body weights + deformation test poses.
import bpy, os, sys, math, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib
import berk_sdf, anatomy, sculpt_body, rig_build, fan, build_parts
for m in (berk_sdf, anatomy, sculpt_body, rig_build, fan, build_parts):
    importlib.reload(m)
from mathutils import Vector
A = anatomy

OUT = os.path.join(HERE, "out_v5"); os.makedirs(OUT, exist_ok=True)
VOX = float(os.environ.get("BERK_VOX", "0.008"))
TARGET_FACES = int(os.environ.get("BERK_FACES", "22000"))
t0 = time.time()
S = sculpt_body.build(VOX)
print("sculpt %.1fs" % (time.time() - t0))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
rig = rig_build.build_armature()
body = S.to_mesh("Body", os.path.join(OUT, "body.vdb"))
print("hi-res %d faces %.1fs" % (len(body.data.polygons), time.time() - t0))

# ---- retopo: QuadriFlow refuses meshes with ANY edge < 0.1 mm (Blender pre-check), so clean degenerates first
import bmesh
for ob in list(sc.objects):
    ob.select_set(False)
bpy.context.view_layer.objects.active = body; body.select_set(True)
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.dissolve_degenerate(bm, dist=0.0006, edges=bm.edges[:])
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0006)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(body.data); bm.free()
body.data.use_mirror_x = True
bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=True, use_preserve_sharp=False, use_preserve_boundary=False,
                                 smooth_normals=True, mode="FACES", target_faces=TARGET_FACES, seed=0)
for p in body.data.polygons:
    p.use_smooth = True
print("game mesh %d faces %d verts %.1fs" % (len(body.data.polygons), len(body.data.vertices), time.time() - t0))

mats = build_parts.build_all(rig)
body.data.materials.append(mats["skin"])

# ---- automatic (heat) weights for the body — only anatomical bones deform the body
NON_BODY = ("wing_", "hipwing_", "tailfin_", "ear_", "saddle", "pedal_")
saved = {}
for b in rig.data.bones:
    saved[b.name] = b.use_deform
    if b.name.startswith(NON_BODY):
        b.use_deform = False
for ob in list(sc.objects):
    ob.select_set(False)
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
for b in rig.data.bones:
    b.use_deform = saved[b.name]
empty = [g.name for g in body.vertex_groups if not any(g.index in [e.group for e in v.groups] for v in body.data.vertices[:2000])]
unweighted = sum(1 for v in body.data.vertices if not v.groups)
print("weights: %d groups, %d unweighted verts  %.1fs" % (len(body.vertex_groups), unweighted, time.time() - t0))

# ---- deformation test poses (bone-local Euler, radians). Bone local X = lateral hinge for limbs/spine.
POSES = {
    "walk": {"front_humerus_L": (0.55, 0, 0), "front_radius_L": (-0.7, 0, 0), "front_humerus_R": (-0.45, 0, 0),
             "hind_femur_R": (0.5, 0, 0), "hind_tibia_R": (-0.8, 0, 0), "hind_femur_L": (-0.45, 0, 0),
             "spine_02": (0, 0, 0.12), "spine_03": (0, 0, 0.12), "neck_02": (0, 0, 0.2), "neck_03": (0, 0, 0.2), "head": (0.1, 0, 0.15),
             **{f"tail_{i:02d}": (0, 0, -0.1) for i in range(2, 10)}},
    "sit": {"pelvis": (0.55, 0, 0), "hind_femur_L": (-1.25, 0, 0), "hind_femur_R": (-1.25, 0, 0), "hind_tibia_L": (1.9, 0, 0),
            "hind_tibia_R": (1.9, 0, 0), "hind_metatarsal_L": (-0.9, 0, 0), "hind_metatarsal_R": (-0.9, 0, 0),
            "spine_01": (-0.15, 0, 0), "chest": (-0.2, 0, 0), "neck_01": (-0.2, 0, 0),
            **{f"tail_{i:02d}": (0.08, 0, 0.18) for i in range(1, 12)}},
    "look": {"neck_01": (0, 0, 0.25), "neck_02": (0, 0, 0.25), "neck_03": (0.1, 0, 0.3), "neck_04": (0.1, 0, 0.3), "head": (0.15, 0, 0.3), "jaw": (-0.45, 0, 0)},
}

sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"; sh.color_type = "MATERIAL"; sh.show_cavity = True; sh.cavity_type = "BOTH"; sh.show_backface_culling = False
w = bpy.data.worlds.new("W"); sc.world = w; w.color = (0.2, 0.22, 0.26)
def shoot(name, loc, target, lens=35, res=(1200, 800)):
    cd = bpy.data.cameras.new(name); cd.lens = lens
    cam = bpy.data.objects.new(name, cd); cam.location = loc; sc.collection.objects.link(cam)
    d = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = (math.pi / 2 + math.asin(max(-1, min(1, d.z))), 0, -math.atan2(d.x, d.y))
    sc.camera = cam; sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)

def apply_pose(pose):
    rig_build.reset_pose(rig)
    rig_build.fold_wings(rig, 1.0)
    for name, (x, y, z) in pose.items():
        pb = rig.pose.bones[name]; pb.rotation_mode = "XYZ"; pb.rotation_euler = (x, y, z)
    bpy.context.view_layer.update()

apply_pose({})
shoot("rest_hero", (-4.4, -5.0, 2.6), (0, 0.2, 1.0))
wire = body.copy(); wire.data = body.data.copy(); sc.collection.objects.link(wire)
wm = wire.modifiers.new("wire", "WIREFRAME"); wm.thickness = 0.0025; wm.use_replace = True
wire.data.materials.clear(); wire.data.materials.append(bpy.data.materials.new("wire"))
wire.data.materials[0].diffuse_color = (0.05, 0.05, 0.06, 1)
shoot("rest_wireframe", (-2.0, -3.4, 1.9), (0, -1.2, 1.3), lens=40)
bpy.data.objects.remove(wire)
shoot("rest_wire", (-2.3, -2.9, 1.9), (0, -1.0, 1.1), lens=40)
for name, pose in POSES.items():
    apply_pose(pose)
    shoot(f"{name}_hero", (-4.4, -5.0, 2.6), (0, 0.2, 1.0))
    shoot(f"{name}_side", (7.5, 0.4, 1.3), (0, 0.4, 0.9))
print("done %.1fs" % (time.time() - t0))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "assemble_v5.blend"))

