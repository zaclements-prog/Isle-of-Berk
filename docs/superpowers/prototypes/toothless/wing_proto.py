# PROTOTYPE (scratch): fan-fold wing — does closing the ribs close the membrane cleanly?
# Left wing only (+X). Blender coords: -Y forward, Z up. A stand-in torso shows how the fold sits.
import bpy, bmesh, os, sys, math, time
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out_wing"); os.makedirs(OUT, exist_ok=True)
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
V = lambda *a: Vector(a)

# ------------------------------------------------ bind-pose joints (spread planform)
W0 = V(0.26, -0.72, 1.42)      # wing root on the back, above the shoulder
W1 = V(1.45, -0.56, 1.56)      # elbow
W2 = V(3.24, -0.66, 1.62)      # wrist
RIB_ANG = [-4, 12, 28, 45, 62, 79, 96]            # degrees from +X toward +Y (back)
RIB_LEN = [3.4, 3.1, 2.75, 2.45, 2.2, 2.0, 1.85]
TIPS = [W2 + V(math.cos(math.radians(a)) * l, math.sin(math.radians(a)) * l, -0.06 - 0.01 * i) for i, (a, l) in enumerate(zip(RIB_ANG, RIB_LEN))]
HIP = V(0.26, 0.55, 1.30)      # where the inner membrane meets the back (high, near the spine)
BODY_MID = V(0.25, -0.1, 1.40)

# ------------------------------------------------ armature
arm_data = bpy.data.armatures.new("WingRig")
rig = bpy.data.objects.new("WingRig", arm_data)
sc.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None, roll_up=V(0, 0, 1)):
    b = eb.new(name); b.head = head; b.tail = tail
    b.align_roll(roll_up)
    if parent:
        b.parent = eb[parent]; b.use_connect = False
    return b
bone("spine", V(0, 0.6, 1.15), V(0, -0.9, 1.25))
bone("wing_humerus", W0, W1, "spine")
bone("wing_forearm", W1, W2, "wing_humerus")
for i, tip in enumerate(TIPS):
    mid = W2.lerp(tip, 0.5)
    bone(f"rib{i+1}_a", W2, mid, "wing_forearm")
    bone(f"rib{i+1}_b", mid, tip, f"rib{i+1}_a")
bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------ membrane mesh + weights
bm = bmesh.new()
groups = {}          # vertex index -> {bone: weight}
verts = []
def add_vert(p, w):
    v = bm.verts.new(p); verts.append(v); groups[len(verts) - 1] = w; return len(verts) - 1
def rib_weights(i, u):
    """Weight of rib i (0-based) along its length u in [0,1]: a->b blend around the midpoint."""
    t = min(1.0, max(0.0, (u - 0.35) / 0.3))
    return {f"rib{i+1}_a": 1 - t, f"rib{i+1}_b": t}
NU, NV = 14, 6
SCALLOP = 0.2
# panels between consecutive ribs (a fan from the wrist)
for i in range(len(TIPS) - 1):
    grid = []
    for iu in range(NU + 1):
        u = iu / NU
        row = []
        for iv in range(NV + 1):
            v = iv / NV
            edge = TIPS[i].lerp(TIPS[i + 1], v)
            inward = (W2 - edge) * (SCALLOP * math.sin(math.pi * v))
            p = W2.lerp(edge + inward, u)
            p.z -= 0.08 * math.sin(math.pi * v) * u        # slight billow
            wa, wb = rib_weights(i, u), rib_weights(i + 1, u)
            w = {k: val * (1 - v) for k, val in wa.items()}
            for k, val in wb.items():
                w[k] = w.get(k, 0) + val * v
            if u < 0.08:                                   # near the wrist the forearm holds it
                f = 1 - u / 0.08
                w = {k: val * (1 - f) for k, val in w.items()}; w["wing_forearm"] = f
            row.append(add_vert(p, w))
        grid.append(row)
    for iu in range(NU):
        for iv in range(NV):
            a, b, c, d = grid[iu][iv], grid[iu + 1][iv], grid[iu + 1][iv + 1], grid[iu][iv + 1]
            bm.faces.new([verts[a], verts[b], verts[c], verts[d]])
# inner panel: Coons patch bounded by the arm (W0-W1-W2), last rib's tip line to the hip, and the flank
def arm_curve(t):   # W0 -> W1 -> W2
    return W0.lerp(W1, t * 2) if t < 0.5 else W1.lerp(W2, (t - 0.5) * 2)
def flank_curve(t):  # HIP -> BODY_MID -> W0 (reversed orientation handled below)
    return HIP.lerp(BODY_MID, t * 2) if t < 0.5 else BODY_MID.lerp(W0, (t - 0.5) * 2)
last = TIPS[-1]
NI, NJ = 12, 8
inner = []
for ii in range(NI + 1):
    s = ii / NI          # along the arm (0 = shoulder root, 1 = wrist)
    col = []
    for jj in range(NJ + 1):
        t = jj / NJ      # from the arm (0) toward the body/trailing side (1)
        top = arm_curve(s)
        bottom = flank_curve(1 - s).lerp(W2.lerp(last, 1.0), 0) if False else None
        # bottom edge runs flank (s=0 at W0 ... ) to the last rib tip at s=1
        b0 = flank_curve(1 - s) if s < 0.6 else HIP.lerp(last, (s - 0.6) / 0.4)
        p = top.lerp(b0, t)
        p.z -= 0.1 * math.sin(math.pi * t) * math.sin(math.pi * s)
        # weights: arm edge -> humerus/forearm; trailing edge near the last rib -> rib7; flank -> spine
        w_arm = {"wing_humerus": 1 - s, "wing_forearm": s} if s < 1 else {"wing_forearm": 1}
        if s < 0.6:
            w_trail = {"spine": 1.0}
        else:
            f = (s - 0.6) / 0.4
            w_trail = {"spine": 1 - f}
            for k, val in rib_weights(6, 1.0).items():
                w_trail[k] = w_trail.get(k, 0) + val * f
        w = {k: val * (1 - t) for k, val in w_arm.items()}
        for k, val in w_trail.items():
            w[k] = w.get(k, 0) + val * t
        col.append(add_vert(p, w))
    inner.append(col)
for ii in range(NI):
    for jj in range(NJ):
        a, b, c, d = inner[ii][jj], inner[ii + 1][jj], inner[ii + 1][jj + 1], inner[ii][jj + 1]
        bm.faces.new([verts[a], verts[b], verts[c], verts[d]])
mesh = bpy.data.meshes.new("Membrane"); bm.to_mesh(mesh); bm.free()
memb = bpy.data.objects.new("Membrane", mesh); sc.collection.objects.link(memb)
for name in ["spine", "wing_humerus", "wing_forearm"] + [f"rib{i+1}_{s}" for i in range(7) for s in "ab"]:
    memb.vertex_groups.new(name=name)
for vi, w in groups.items():
    tot = sum(w.values()) or 1
    for k, val in w.items():
        if val > 1e-4:
            memb.vertex_groups[k].add([vi], val / tot, "REPLACE")
mod = memb.modifiers.new("Armature", "ARMATURE"); mod.object = rig
memb.parent = rig
mat = bpy.data.materials.new("Membrane"); mat.diffuse_color = (0.3, 0.32, 0.36, 1)
memb.data.materials.append(mat)
for p in memb.data.polygons: p.use_smooth = True

# rib + arm spars: tubes along bones, rigidly parented to their bones
def spar(name, a, b, r0, r1, bone_name):
    d = (b - a); L = d.length
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=r0, radius2=r1, depth=L, location=(a + b) / 2)
    o = bpy.context.active_object; o.name = name
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    bpy.context.view_layer.update()
    mw = o.matrix_world.copy()
    o.parent = rig; o.parent_type = "BONE"; o.parent_bone = bone_name
    o.matrix_world = mw
    return o
spar("Humerus", W0, W1, 0.075, 0.055, "wing_humerus")
spar("Forearm", W1, W2, 0.05, 0.035, "wing_forearm")
for i, tip in enumerate(TIPS):
    mid = W2.lerp(tip, 0.5)
    spar(f"Rib{i+1}a", W2, mid, 0.024, 0.017, f"rib{i+1}_a")
    spar(f"Rib{i+1}b", mid, tip, 0.017, 0.006, f"rib{i+1}_b")

# stand-in torso
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, -0.1, 1.0))
torso = bpy.context.active_object; torso.scale = (0.4, 1.0, 0.38)
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, -1.5, 1.55))
hd = bpy.context.active_object; hd.scale = (0.3, 0.36, 0.22)

# ------------------------------------------------ posing helpers
def aim(pb_name, target_dir, up=Vector((0, 0, 1))):
    """Point a pose bone along target_dir (armature space) keeping its head where it is."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[pb_name]
    head = pb.head.copy()
    y = target_dir.normalized()
    x = y.cross(up); x = x.normalized() if x.length > 1e-6 else Vector((1, 0, 0))
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = head
    pb.matrix = m
    bpy.context.view_layer.update()

def pose(fold):
    """fold in [0,1]: 0 = spread bind pose, 1 = folded along the back."""
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    if fold <= 0:
        return
    rest = {b.name: (b.tail_local - b.head_local) for b in arm_data.bones}
    def mix(a, b):
        return a.normalized().lerp(b.normalized(), fold)
    aim("wing_humerus", mix(rest["wing_humerus"], Vector((0.12, 0.95, -0.12))))
    aim("wing_forearm", mix(rest["wing_forearm"], Vector((0.1, -0.97, 0.16))))
    for i in range(7):
        folded = Vector((0.07 + 0.012 * i, 0.97, -0.1 - 0.035 * i))
        aim(f"rib{i+1}_a", mix(rest[f"rib{i+1}_a"], folded))
        aim(f"rib{i+1}_b", mix(rest[f"rib{i+1}_b"], folded))

# ------------------------------------------------ renders
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"; sh.color_type = "MATERIAL"; sh.show_cavity = True; sh.show_backface_culling = False
w = bpy.data.worlds.new("W"); sc.world = w; w.color = (0.2, 0.22, 0.26)
def shoot(name, loc, target, lens=35, res=(1000, 700)):
    cd = bpy.data.cameras.new(name); cd.lens = lens
    cam = bpy.data.objects.new(name, cd); cam.location = loc; sc.collection.objects.link(cam)
    d = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = (math.pi / 2 + math.asin(d.z), 0, -math.atan2(d.x, d.y))
    sc.camera = cam; sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
for f in (0.0, 0.5, 0.85, 1.0):
    pose(f)
    tag = f"{int(f * 100):03d}"
    shoot(f"top_{tag}", (2.0, 0.2, 9.5), (2.0, 0.2, 1.2), lens=30)
    shoot(f"q34_{tag}", (5.5, -5.0, 4.0), (1.2, 0.0, 1.3), lens=30)
    shoot(f"back_{tag}", (1.2, 6.5, 2.6), (0.5, 0.0, 1.3), lens=35)
print("done %.1fs" % (time.time() - t0))

