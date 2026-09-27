# PROTOTYPE v4 (scratch): full assembly — sculpted body + parts + fan wings/hip wings/tail fins on the rig.
import bpy, os, sys, math, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib
import berk_sdf, anatomy, sculpt_body, rig_build, fan
for m in (berk_sdf, anatomy, sculpt_body, rig_build, fan):
    importlib.reload(m)
from mathutils import Vector
A = anatomy
V = A.V

OUT = os.path.join(HERE, "out_v4"); os.makedirs(OUT, exist_ok=True)
REF = r"C:\Users\zacle\Pictures\Screenshots"; OLD = r"C:\Users\zacle\dragon-walk\tools"
VOX = float(os.environ.get("BERK_VOX", "0.01"))
t0 = time.time()

S = sculpt_body.build(VOX)
print("sculpt %.1fs" % (time.time() - t0))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

def mat(name, rgb):
    m = bpy.data.materials.new(name); m.diffuse_color = (*rgb, 1); return m
M_SKIN, M_MEMB, M_EYE, M_PUPIL, M_CLAW, M_FIN = (mat("skin", (0.46, 0.47, 0.5)), mat("membrane", (0.34, 0.35, 0.39)),
    mat("eye", (0.62, 0.78, 0.16)), mat("pupil", (0.02, 0.02, 0.02)), mat("claw", (0.85, 0.8, 0.72)), mat("prosthetic", (0.62, 0.12, 0.08)))

rig = rig_build.build_armature()
body = S.to_mesh("Body", os.path.join(OUT, "body.vdb"))
body.data.materials.append(M_SKIN)
print("body mesh %d faces  %.1fs" % (len(body.data.polygons), time.time() - t0))

def skin_to_rig(ob):
    mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = rig
    ob.parent = rig

# ---------------- eyes, ears, claws (rigid pieces weighted to one bone each)
def rigid(ob, bone):
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    skin_to_rig(ob)

for s, sfx in ((1, "L"), (-1, "R")):
    c = V(A.EYE_CENTER_L[0] * s, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2]); n = A.eye_dir(s)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=A.EYE_RADIUS, location=tuple(c), segments=48, ring_count=24)
    e = bpy.context.active_object; e.name = f"Eye_{sfx}"; e.data.materials.append(M_EYE); rigid(e, "head")
    for p in e.data.polygons: p.use_smooth = True
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=tuple(c + n * A.EYE_RADIUS * 0.93), segments=24, ring_count=12)
    pu = bpy.context.active_object; pu.name = f"Pupil_{sfx}"; pu.data.materials.append(M_PUPIL)
    pu.scale = (0.012, 0.012, 0.05); pu.rotation_euler = (0, 0, -math.atan2(n[0], -n[1]))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); rigid(pu, "head")
    for ear in A.EARS_L:
        name, root, length, width, thick, pitch, yaw, roll = ear
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=32, ring_count=16)
        b = bpy.context.active_object; b.name = f"{name}_{sfx}"
        for v in b.data.vertices:
            t = (v.co.y + 1.0) / 2.0
            v.co.y = t * length
            v.co.x *= width * 0.5 * (1.0 - 0.35 * t ** 2)
            v.co.z *= thick * 0.5 * (1.0 - 0.4 * t)
        b.location = (root[0] * s, root[1], root[2])
        b.rotation_euler = (math.radians(pitch), math.radians(roll * s), math.radians(yaw * s))
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        b.data.materials.append(M_SKIN)
        for p in b.data.polygons: p.use_smooth = True
        rigid(b, f"{name}_{sfx}")
    for leg, fwd, bone in ((A.FRONT_LEG_L, -0.14, f"front_toes_{sfx}"), (A.HIND_LEG_L, -0.15, f"hind_toes_{sfx}")):
        pw = V(leg["paw"][0] * s, leg["paw"][1], leg["paw"][2])
        for tx in (-0.1, -0.034, 0.034, 0.1):
            base = pw + V(s * tx, fwd - 0.07, -0.005)
            bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.018, radius2=0.002, depth=0.07, location=tuple(base))
            cl = bpy.context.active_object; cl.rotation_euler = (math.radians(-100), 0, 0)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            cl.data.materials.append(M_CLAW); rigid(cl, bone)

# ---------------- main wings
def spine_weights_at(y):
    pts = [("chest", -0.72), ("spine_03", -0.44), ("spine_02", -0.15), ("spine_01", 0.15), ("pelvis", 0.46)]
    if y <= pts[0][1]: return {pts[0][0]: 1.0}
    if y >= pts[-1][1]: return {pts[-1][0]: 1.0}
    for (a, ya), (b, yb) in zip(pts, pts[1:]):
        if ya <= y <= yb:
            t = (y - ya) / (yb - ya); return {a: 1 - t, b: t}

def build_main_wing(s, sfx):
    W = A.MAIN_WING_L
    m = lambda p: V(p[0] * s, p[1], p[2])
    root, elbow, hub = m(W["root"]), m(W["elbow"]), m(W["hub"])
    tips = A.fan_tips(W, s)
    ribs = [(f"wing_rib{i+1}_a_{sfx}", f"wing_rib{i+1}_b_{sfx}") for i in range(len(tips))]
    mb = fan.MeshBuilder()
    fan.fan_panels(mb, hub, tips, ribs, W["scallop"], W["billow"], (0, 0, -1), hub_weights={f"wing_forearm_{sfx}": 1.0})
    attach = [m(p) for p in W["attach"]]
    last = tips[-1]
    def arm(u):
        return Vector(root).lerp(Vector(elbow), u * 2) if u < 0.5 else Vector(elbow).lerp(Vector(hub), (u - 0.5) * 2)
    def trailing(u):
        if u < 0.6:
            k = u / 0.6
            return Vector(attach[0]).lerp(Vector(attach[1]), k * 2) if k < 0.5 else Vector(attach[1]).lerp(Vector(attach[2]), (k - 0.5) * 2)
        return Vector(attach[2]).lerp(Vector(last), (u - 0.6) / 0.4)
    def w_top(u):
        return {f"wing_humerus_{sfx}": 1.0} if u < 0.45 else ({f"wing_forearm_{sfx}": 1.0} if u > 0.55 else
                {f"wing_humerus_{sfx}": (0.55 - u) / 0.1, f"wing_forearm_{sfx}": (u - 0.45) / 0.1})
    def w_bottom(u):
        p = trailing(u)
        if u < 0.6: return spine_weights_at(p.y)
        f = (u - 0.6) / 0.4
        return fan._blend((1 - f, spine_weights_at(p.y)), (f, fan.rib_weights(ribs[-1], 1.0)))
    def weights(u, t):
        g = min(1.0, max(0.0, (u - 0.8) / 0.2))
        base = fan._blend((1 - t, w_top(u)), (t, w_bottom(u)))
        return fan._blend((1 - g, base), (g, fan.rib_weights(ribs[-1], t)))
    fan.coons_panel(mb, top=arm, bottom=trailing, left=lambda t: Vector(root), right=lambda t: Vector(hub).lerp(Vector(last), t),
                    weight_fn=weights, ni=14, nj=10, sag=0.1)
    fan.spar(mb, root, elbow, 0.075, 0.055, {f"wing_humerus_{sfx}": 1.0}, mat=1)
    fan.spar(mb, elbow, hub, 0.055, 0.036, {f"wing_forearm_{sfx}": 1.0}, mat=1)
    for i, tip in enumerate(tips):
        mid = hub + (tip - hub) * 0.5
        fan.spar(mb, hub, mid, 0.026, 0.017, {ribs[i][0]: 1.0}, mat=1)
        fan.spar(mb, mid, tip, 0.017, 0.005, {ribs[i][1]: 1.0}, mat=1)
    fan.spar(mb, hub, hub + V(s * 0.05, -0.16, 0.02), 0.03, 0.003, {f"wing_thumb_{sfx}": 1.0}, mat=2)
    ob = mb.to_object(f"Wing_{sfx}", [M_MEMB, M_SKIN, M_CLAW]); skin_to_rig(ob)

def build_small_fan(s, sfx, spec, prefix, root_bone, extra_rib=None, material=None):
    m = lambda p: V(p[0] * s, p[1], p[2])
    hub = m(spec["hub"]); tips = A.fan_tips(spec, s)
    ribs = [(f"{prefix}_rib{i+1}_{sfx}",) for i in range(len(tips))]
    if extra_rib is not None:
        tips = [extra_rib[0]] + tips; ribs = [extra_rib[1]] + ribs
    mb = fan.MeshBuilder()
    fan.fan_panels(mb, hub, tips, ribs, spec["scallop"], spec["billow"], (0, 0, -1), nu=8, nv=4, hub_weights={root_bone: 1.0}, hub_zone=0.12)
    for i, tip in enumerate(tips[(1 if extra_rib is not None else 0):]):
        fan.spar(mb, hub, tip, 0.014, 0.004, {ribs[i + (1 if extra_rib is not None else 0)][0]: 1.0}, mat=1, segments=8)
    ob = mb.to_object(f"{prefix}_{sfx}", [material or M_MEMB, M_SKIN]); skin_to_rig(ob)

for s, sfx in ((1, "L"), (-1, "R")):
    build_main_wing(s, sfx)
    build_small_fan(s, sfx, A.HIP_WING_L, "hipwing", f"hipwing_root_{sfx}")
    tail_back = V(0.0, 4.9, 0.49)
    build_small_fan(s, sfx, A.TAIL_FIN_L, "tailfin", f"tailfin_root_{sfx}", extra_rib=(tail_back, ("tail_12",)),
                    material=M_FIN if sfx == "L" else M_MEMB)
skin_to_rig(body)   # body rides the rig unweighted for this visual test
print("assembled %.1fs" % (time.time() - t0))

# ---------------- renders
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"; sh.color_type = "MATERIAL"; sh.show_cavity = True; sh.cavity_type = "BOTH"; sh.show_backface_culling = False
w = bpy.data.worlds.new("W"); sc.world = w; w.color = (0.2, 0.22, 0.26)
def shoot(name, loc, target, lens=35, res=(1400, 800), ortho=None):
    cd = bpy.data.cameras.new(name)
    if ortho: cd.type = "ORTHO"; cd.ortho_scale = ortho
    else: cd.lens = lens
    cam = bpy.data.objects.new(name, cd); cam.location = loc; sc.collection.objects.link(cam)
    d = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = (math.pi / 2 + math.asin(max(-1, min(1, d.z))), 0, -math.atan2(d.x, d.y))
    sc.camera = cam; sc.render.resolution_x, sc.render.resolution_y = res
    p = os.path.join(OUT, name + ".png"); sc.render.filepath = p
    bpy.ops.render.render(write_still=True); return p
def load_px(path):
    img = bpy.data.images.load(path, check_existing=False); w_, h_ = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h_, w_, 4); bpy.data.images.remove(img); return px
def resize(px, h):
    Hh, W_ = px.shape[:2]; w_ = int(round(W_ * h / Hh))
    return px[(np.arange(h) * Hh / h).astype(int)][:, (np.arange(w_) * W_ / w_).astype(int)]
def composite(name, ref_path, render_path, h=520):
    a = resize(load_px(ref_path), h); b = resize(load_px(render_path), h)
    out = np.concatenate([a, np.ones((h, 8, 4), np.float32), b], axis=1)
    img = bpy.data.images.new(name, out.shape[1], out.shape[0], alpha=True)
    img.pixels = out.ravel(); img.filepath_raw = os.path.join(OUT, name + ".png"); img.file_format = "PNG"; img.save()

top = shoot("top_spread", (0, 1.2, 20), (0, 1.2000001, 0), ortho=15.5, res=(1400, 900))
composite("cmp_top", os.path.join(REF, "Screenshot 2026-06-12 155348.png"), top)
shoot("hero_spread", (-5.5, -7.5, 4.2), (0, 0, 1.2), lens=32)
for f in (0.5, 1.0):
    rig_build.reset_pose(rig); rig_build.fold_wings(rig, f)
    tag = f"{int(f * 100):03d}"
    shoot(f"hero_fold{tag}", (-4.8, -5.4, 2.9), (0, 0.2, 1.1), lens=35)
    shoot(f"side_fold{tag}", (9, 1.0, 1.3), (0, 1.0, 1.0), lens=35)
    shoot(f"top_fold{tag}", (0, 1.2, 12), (0, 1.2000001, 0), ortho=8.5)
print("done %.1fs" % (time.time() - t0))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "assemble_v4.blend"))
