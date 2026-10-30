"""Playblast of an authored locomotion cycle (Plan 5 review): the rig walks forward over a ground striped every 0.5 m
(a planted paw must not slide against the stripes) and the camera tracks it. Workbench clay; frames as PNGs.
usage (bpy): loco_preview.py <cycle> <out_dir> <view> <first> <count> [res_w res_h]"""
import os, sys, time, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(os.path.dirname(HERE), "lib"), HERE]
import bpy
from mathutils import Vector
import locomotion as L, library as LIB, qa_render as QR
argv = sys.argv[sys.argv.index("--") + 1:]
name, out, view, first, count = argv[0], argv[1], argv[2], int(argv[3]), int(argv[4])
res = (int(argv[5]), int(argv[6])) if len(argv) > 6 else (960, 540)
bpy.ops.wm.open_mainfile(filepath=os.path.join(os.path.dirname(HERE), "build", "toothless_assembled.blend"))
sc = bpy.context.scene
rig = bpy.data.objects["ToothlessRig"]
QR.setup_clay(sc)
sc.display.shading.show_shadows = True
cyc = L.CYCLES[name]
frames, _ = L.cycle_frames(rig, name)
n = cyc["frames"]
def mat(nm, rgb):
    m = bpy.data.materials.new(nm); m.diffuse_color = (*rgb, 1); return m
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -20, 0)); g = bpy.context.active_object
g.scale = (12, 80, 1); g.data.materials.append(mat("g", (0.36, 0.38, 0.33)))
dark = mat("s", (0.25, 0.27, 0.23))
for k in range(-60, 30):                     
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, k * 0.5, 0.001)); s = bpy.context.active_object
    s.scale = (12, 0.06, 1); s.data.materials.append(dark)
VIEWS = {"side": (Vector((8.0, 0.6, 1.0)), Vector((0, 0.6, 0.72)), 30),
         "tq": (Vector((-4.8, -5.2, 2.0)), Vector((0, 0.2, 0.75)), 32),
         "front": (Vector((-1.4, -8.0, 1.2)), Vector((0, -0.4, 0.8)), 45),
         "low": (Vector((4.2, -2.4, 0.35)), Vector((0, -0.2, 0.55)), 30)}
loc, tgt, lens = VIEWS[view]
os.makedirs(out, exist_ok=True)
t0 = time.time()
for f in range(first, first + count, int(os.environ.get("STEP", "1"))):
    LIB.apply_pose(rig, frames[f % n])
    dy = -cyc["speed"] * f / L.FPS
    rig.location = (0, dy, 0)
    bpy.context.view_layer.update()
    off = Vector((0, dy, 0))
    QR.shoot(sc, out, f"f{f:04d}", tuple(loc + off), tuple(tgt + off), lens=lens, res=res)
print("RENDER s/frame", round((time.time() - t0) / count, 2))
