# PROTOTYPE (scratch): Toothless head at 5 mm, compared against film references.
# Blender coords: X = dragon's left, -Y = forward, Z = up. Metres.
import bpy, os, sys, math, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib, berk_sdf
importlib.reload(berk_sdf)
from berk_sdf import Sculpt, sphere, ellipsoid, round_cone, tube, rot, squashed

OUT = os.path.join(HERE, "out_head"); os.makedirs(OUT, exist_ok=True)
OLD = r"C:\Users\zacle\dragon-walk\tools"
t0 = time.time()
V = lambda *a: np.array(a, float)
L = lambda p, s: V(p[0] * s, p[1], p[2])

H = dict(
    head_c=V(0, -1.74, 1.70),
    eye=V(0.2, -2.0, 1.735), eye_r=0.086,
)
S = Sculpt(lo=(-0.62, -2.35, 1.12), hi=(0.62, -1.0, 2.35), voxel=0.005)
print("grid", S.shape, round(np.prod(S.shape) / 1e6, 1), "M")

# neck stub (short, thick) so the head's base blends like the real build
S.add(tube([V(0, -1.0, 1.36), V(0, -1.2, 1.5), V(0, -1.38, 1.6)], [0.31, 0.285, 0.27]), 0.12)
# skull: wide, flat-topped cranium; broad cheeks; short blunt muzzle; broad lower jaw
S.add(ellipsoid((0, -1.74, 1.72), (0.31, 0.33, 0.235)), 0.10)        # cranium (domed)
S.add(ellipsoid((0, -1.84, 1.565), (0.345, 0.31, 0.165)), 0.10)       # cheeks
S.add(ellipsoid((0, -2.03, 1.615), (0.235, 0.21, 0.15)), 0.09)        # muzzle
S.add(ellipsoid((0, -2.15, 1.60), (0.175, 0.11, 0.125)), 0.07)       # muzzle front (blunt)
S.add(ellipsoid((0, -1.96, 1.455), (0.265, 0.25, 0.095)), 0.07)       # lower jaw
S.add(ellipsoid((0, -2.07, 1.43), (0.17, 0.14, 0.07)), 0.05)          # chin
S.mirror_add(lambda s: ellipsoid(L((0.195, -1.985, 1.812), s), (0.105, 0.095, 0.042), rot(-12, s * -10, 0)), 0.04)  # heavy upper lids / brows
S.mirror_add(lambda s: ellipsoid(L((0.3, -1.86, 1.64), s), (0.08, 0.12, 0.07)), 0.06)                          # zygomatic bulge
S.mirror_sub(lambda s: sphere(L(H["eye"], s) + V(s * 0.008, -0.004, 0), H["eye_r"] + 0.012), 0.02)          # sockets
# eyelids: a raised rim around each socket (torus-like ring from a thin tube loop)
def lid_ring(s):
    c = L(H["eye"], s)
    n = V(s * 0.55, -0.83, 0.1); n /= np.linalg.norm(n)       # eye looks mostly forward
    u = np.cross(n, V(0, 0, 1)); u /= np.linalg.norm(u); w = np.cross(u, n)
    R = H["eye_r"] + 0.012
    pts = [c + (math.cos(a) * u + math.sin(a) * w) * R * 1.02 + n * 0.012 for a in np.linspace(0, 2 * math.pi, 25)]
    return tube(pts, [0.017] * len(pts))
for s in (1, -1):
    S.add(lid_ring(s), 0.012)
S.mirror_sub(lambda s: ellipsoid(L((0.062, -2.2, 1.708), s), (0.019, 0.026, 0.013), rot(-35, 0, s * 20)), 0.008)  # nostrils (high on the muzzle)
# mouth: long, wide crease wrapping back to below the eye
mouth = [V(0, -2.232, 1.515), V(0.09, -2.205, 1.508), V(0.18, -2.13, 1.50), V(0.25, -2.02, 1.50), V(0.3, -1.9, 1.51), V(0.33, -1.8, 1.53)]
for s in (1, -1):
    S.sub(tube([L(p, s) for p in mouth], [0.009, 0.01, 0.011, 0.011, 0.01, 0.008]), 0.006)
# dorsal plate on the crown (small), between the ears
S.add(squashed(round_cone(V(0, -1.60, 1.89), V(0, -1.52, 1.97), 0.03, 0.004), V(0, -1.6, 1.89), (0.35, 1, 1)), 0.01)
print("sculpt %.1fs" % (time.time() - t0))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
head = S.to_mesh("Head", os.path.join(OUT, "head.vdb"))
print("mesh %d faces  %.1fs" % (len(head.data.polygons), time.time() - t0))
skin = bpy.data.materials.new("Skin"); skin.diffuse_color = (0.46, 0.47, 0.5, 1)
head.data.materials.append(skin)
eye_mat = bpy.data.materials.new("Eye"); eye_mat.diffuse_color = (0.62, 0.78, 0.16, 1)
pupil_mat = bpy.data.materials.new("Pupil"); pupil_mat.diffuse_color = (0.02, 0.02, 0.02, 1)
for s in (1, -1):
    c = L(H["eye"], s)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=H["eye_r"], location=tuple(c), segments=48, ring_count=24)
    e = bpy.context.active_object; e.data.materials.append(eye_mat)
    for p in e.data.polygons: p.use_smooth = True
    n = V(s * 0.55, -0.83, 0.1); n /= np.linalg.norm(n)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=tuple(c + n * H["eye_r"] * 0.93), segments=24, ring_count=12)
    pu = bpy.context.active_object; pu.data.materials.append(pupil_mat)
    pu.scale = (0.012, 0.012, 0.05)
    pu.rotation_euler = (0, 0, math.atan2(n[0], -n[1]) * -1)

def blade(name, root, length, width, thick, pitch, yaw, roll, s, tip_round=0.35):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=32, ring_count=16)
    b = bpy.context.active_object; b.name = name
    for v in b.data.vertices:
        t = (v.co.y + 1.0) / 2.0
        v.co.y = t * length
        taper = 1.0 - tip_round * t ** 2
        v.co.x *= width * 0.5 * taper
        v.co.z *= thick * 0.5 * (1.0 - 0.4 * t)
    b.location = tuple(root)
    b.rotation_euler = (math.radians(pitch), math.radians(roll * s), math.radians(yaw * s))
    b.data.materials.append(skin)
    for p in b.data.polygons: p.use_smooth = True
    return b

for s in (1, -1):
    tag = "L" if s > 0 else "R"
    blade(f"Ear1_{tag}", L((0.125, -1.62, 1.87), s), 0.34, 0.15, 0.05, 62, -14, -12, s)     # main paddles
    blade(f"Ear2_{tag}", L((0.25, -1.62, 1.77), s), 0.2, 0.09, 0.04, 30, -40, -30, s)    # side plates
    blade(f"Ear3_{tag}", L((0.315, -1.70, 1.61), s), 0.13, 0.06, 0.035, 10, -68, -45, s)     # cheek nubs

sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"; sh.color_type = "MATERIAL"; sh.show_cavity = True; sh.cavity_type = "BOTH"
w = bpy.data.worlds.new("W"); sc.world = w; w.color = (0.2, 0.22, 0.26)

def shoot(name, loc, target, lens=50, res=(900, 900)):
    cam_data = bpy.data.cameras.new(name); cam_data.lens = lens
    cam = bpy.data.objects.new(name, cam_data); cam.location = loc
    sc.collection.objects.link(cam)
    d = V(*target) - V(*loc); d /= np.linalg.norm(d)
    yaw = math.atan2(d[0], d[1]); pitch = math.asin(max(-1, min(1, d[2])))
    cam.rotation_euler = (math.pi / 2 + pitch, 0, -yaw)
    sc.camera = cam; sc.render.resolution_x, sc.render.resolution_y = res
    p = os.path.join(OUT, name + ".png"); sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    return p

def load_px(path):
    img = bpy.data.images.load(path, check_existing=False)
    w_, h_ = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h_, w_, 4)
    bpy.data.images.remove(img)
    return px

def resize(px, h):
    Hh, W = px.shape[:2]; w_ = int(round(W * h / Hh))
    return px[(np.arange(h) * Hh / h).astype(int)][:, (np.arange(w_) * W / w_).astype(int)]

def composite(name, ref_path, render_path, h=520):
    a = resize(load_px(ref_path), h); b = resize(load_px(render_path), h)
    out = np.concatenate([a, np.ones((h, 8, 4), np.float32), b], axis=1)
    img = bpy.data.images.new(name, out.shape[1], out.shape[0], alpha=True)
    img.pixels = out.ravel(); img.filepath_raw = os.path.join(OUT, name + ".png"); img.file_format = "PNG"; img.save()

front = shoot("front", (0, -4.2, 1.95), (0, -1.8, 1.66), lens=70)
q34 = shoot("q34", (-1.55, -3.2, 1.9), (0, -1.85, 1.65), lens=60)
side = shoot("side", (3.2, -1.8, 1.68), (0, -1.8, 1.68), lens=60)
top = shoot("top", (0, -1.8, 4.5), (0, -1.79, 1.6), lens=60)
composite("cmp_front", os.path.join(OLD, "ref_dtv.png"), front)
composite("cmp_q34", os.path.join(OLD, "ref_9999.png"), q34)
print("done %.1fs" % (time.time() - t0))

