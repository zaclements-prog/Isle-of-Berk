"""Playblast of the authored takeoff (flight groundwork): the rig rises and moves forward over a striped ground, the
camera tracks him. usage (bpy): flight_preview.py <out_dir> <view> <first> <count> [res_w res_h]; env STEP = frame step."""
import os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(os.path.dirname(HERE), "lib"), HERE]
import bpy
from mathutils import Vector
import flight as F, flight_loops as FL, flight_chain as FC, flight_seq as FS, qa_render as QR
argv = sys.argv[sys.argv.index("--") + 1:]
out, view, first, count = argv[0], argv[1], int(argv[2]), int(argv[3])
res = (int(argv[4]), int(argv[5])) if len(argv) > 5 else (960, 540)
bpy.ops.wm.open_mainfile(filepath=os.path.join(os.path.dirname(HERE), "build", "toothless_assembled.blend"))
sc = bpy.context.scene
rig = bpy.data.objects["ToothlessRig"]
QR.setup_clay(sc)
sc.display.shading.show_shadows = True
CLIP = os.environ.get("CLIP", "takeoff")       # takeoff | flap | glide, each also _chain (the shoulder-hung physics
CHAIN = CLIP.endswith("_chain")                 # chain body); loops: env CYCLES of them back to back;
CLIP = CLIP.replace("_chain", "")               # flap2glide | glide2flap | land: the transitions and the landing
SEQ = CLIP in FS.CLIPS
if SEQ:
    seq_all = FS.CLIPS[CLIP]()
    folded = F.folded_wing_basis(rig)
    seq_hook = FS.body_hook(seq_all)
    frames = seq_all[seq_all[0]["clipStart"]:]
elif CLIP == "takeoff":
    frames = F.takeoff_frames()
    folded = F.folded_wing_basis(rig)
    if CHAIN:
        chain = FC.takeoff_chain(rig, frames)
        span = int(F.TAKEOFF["period"] * F.FPS)
        head_rest = rig.data.bones["head"].head_local.z

        def body_fn(rig_, fr):
            got = chain[fr["i"]]
            if got is None or fr["lineW"] <= 0:
                return
            win = [frames[k]["chestZ"] for k in range(max(0, fr["i"] - span), fr["i"] + 1)]
            steady = sum(win) / len(win)
            FC.apply_chain(rig_, got[0], got[1], fr["lineW"], head_rest + (steady - F.CHEST_Z) + 0.25 * (fr["chestZ"] - steady))
else:
    cfg = FL.FLAP if CLIP == "flap" else FL.GLIDE
    loop = FL.flap_frames() if CLIP == "flap" else FL.glide_frames()
    if CHAIN:
        lchain = FC.loop_chain(rig, loop, cfg)

        def lbody_fn(rig_, fr, head_z):
            FC.apply_chain(rig_, lchain[fr["i"]][0], lchain[fr["i"]][1], 1.0, head_z)
    cycles = int(os.environ.get("CYCLES", "2"))
    frames = [dict(loop[k % len(loop)], x=cfg["speed"] * k / F.FPS, _k=k % len(loop)) for k in range(cycles * len(loop))]


def mat(nm, rgb):
    m = bpy.data.materials.new(nm); m.diffuse_color = (*rgb, 1); return m


bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -20, 0)); g = bpy.context.active_object
g.scale = (40, 80, 1); g.data.materials.append(mat("g", (0.36, 0.38, 0.33)))
dark = mat("s", (0.25, 0.27, 0.23))
for k in range(-60, 30):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, k * 1.0, 0.001)); s = bpy.context.active_object
    s.scale = (40, 0.08, 1); s.data.materials.append(dark)
VIEWS = {"side": (Vector((17.0, -1.0, 2.5)), Vector((0, -1.0, 1.6)), 30),
         "front": (Vector((-5.0, -15.0, 0.8)), Vector((0, -0.5, 2.2)), 26),
         "head": (Vector((0.0, -18.0, 2.0)), Vector((0, -0.5, 2.0)), 26),
         "tq": (Vector((-11.0, -10.0, 4.0)), Vector((0, 0.0, 1.6)), 28),
         "back": (Vector((3.0, 14.0, 3.0)), Vector((0, -1.0, 1.8)), 30),
         "close": (Vector((7.0, -1.2, 2.2)), Vector((0, -0.8, 1.9)), 45),
         "ground": (Vector((8.0, -0.4, 1.1)), Vector((0, -0.4, 0.95)), 38)}
loc, tgt, lens = VIEWS[view]
os.makedirs(out, exist_ok=True)
t0 = time.time()
cam_h = None
step = int(os.environ.get("STEP", "1"))
for f in range(first, min(first + count, len(frames)), step):
    fr = frames[f]
    if SEQ:
        F.apply_frame(rig, fr, folded, None, seq_hook)
    elif CLIP == "takeoff":
        F.apply_frame(rig, fr, folded, frames, body_fn if CHAIN else None)
    else:
        FL.apply_loop_frame(rig, loop[fr["_k"]], loop, cfg, lbody_fn if CHAIN else None)
    rig.location = (0, -fr["x"], 0)
    bpy.context.view_layer.update()
    h = fr["root"][0] - 1.02
    cam_h = h if cam_h is None else cam_h + (h - cam_h) * 0.15     # the camera follows him up, a little behind
    off = Vector((0, -fr["x"], (0.85 if CLIP in ("takeoff", "land") else 0.95) * cam_h))
    QR.shoot(sc, out, f"f{f:04d}", tuple(loc + off), tuple(tgt + off), lens=lens, res=res)
print("RENDER s/frame", round((time.time() - t0) / max(1, count // step), 2))
