"""Showreel: one continuous take through the authored motion: walk -> trot -> gallop -> takeoff -> cruise flap ->
flap-to-glide -> glide -> landing, to judge how the clips blend.

Every clip is posed by its own code (locomotion cycles, the takeoff, the flap loop, flight_seq's transitions and
landing) at its own time; between clips every pose bone is blended from the outgoing clip to the incoming one over a
short window (rotations slerped, locations lerped, eased). Forward travel accumulates from each clip's own speed (the
blend mixes the two), so planted paws hold where the clip plants them; flight altitudes are offset so a clip picks up
at the height the previous one left, the offset easing out before the landing touches down.

usage (bpy): flight_reel.py <out_dir> <first> <count> [res_w res_h]; env STEP = frame step, VIEW = side | tq
"""
import math
import os
import sys
import time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(os.path.dirname(HERE), "lib"), HERE]
import bpy
from mathutils import Vector, Matrix
import flight as F, flight_loops as FL, flight_seq as FS, locomotion as L, library as LIB, qa_render as QR

FPS = F.FPS


class Clip:
    """A posable clip: n frames, pose(k) poses frame k on the rig, x(k) its own forward travel (m), and whether its
    root height is absolute ground height (ground clips) or flight altitude (offsettable)."""
    def __init__(self, name, n, pose, x, airborne):
        self.name, self.n, self.pose, self.x, self.airborne = name, n, pose, x, airborne


def ground_clip(rig, gait, cycles):
    frames, _ = L.cycle_frames(rig, gait)
    per = len(frames) - 1
    speed = L.CYCLES[gait]["speed"]
    return Clip(gait, per * cycles, lambda k: LIB.apply_pose(rig, frames[k % per]), lambda k: speed * k / FPS, False)


def build(rig):
    folded = F.folded_wing_basis(rig)
    tk = F.takeoff_frames()
    t0 = int(round(0.15 * FPS))                     # into the takeoff's load
    t1 = int(round(2.9 * FPS))                      # two climbing beats after toe-off
    takeoff = Clip("takeoff", t1 - t0, lambda k: F.apply_frame(rig, tk[t0 + k], folded, tk),
                   lambda k: tk[t0 + k]["x"], True)
    loop = FL.flap_frames()
    flap = Clip("flap", 2 * len(loop), lambda k: FL.apply_loop_frame(rig, loop[k % len(loop)], loop, FL.FLAP),
                lambda k: FL.FLAP["speed"] * k / FPS, True)
    gl = FL.glide_frames()
    glide = Clip("glide", len(gl), lambda k: FL.apply_loop_frame(rig, gl[k % len(gl)], gl, FL.GLIDE),
                 lambda k: FL.GLIDE["speed"] * k / FPS, True)

    def seq(name):
        allf = FS.CLIPS[name]()
        hook = FS.body_hook(allf)
        s0 = allf[0]["clipStart"]
        return Clip(name, len(allf) - s0, lambda k: F.apply_frame(rig, allf[s0 + k], folded, None, hook),
                    lambda k: allf[s0 + k]["x"] - allf[s0]["x"], True)
    return [ground_clip(rig, "walk", 3), ground_clip(rig, "trot", 4), ground_clip(rig, "gallop", 4), takeoff, flap,
            seq("flap2glide"), glide, seq("land")], folded


BLEND = {"trot": 0.6, "gallop": 0.5, "takeoff": 0.5, "flap": 0.5, "flap2glide": 0.25, "glide": 0.6, "land": 0.6}


def capture(rig):
    return {pb.name: (pb.matrix_basis.to_translation(), pb.matrix_basis.to_quaternion()) for pb in rig.pose.bones}


def pelvis_z(rig):
    return rig.pose.bones["pelvis"].head.z


def timeline(clips):
    """[(clip index, local frame, blend partner index or None, partner frame, weight of partner)] per output frame:
    each clip plays fully; the next one starts BLEND[next] s before this one ends and fades in over that window."""
    out = []
    starts = [0]
    for i in range(1, len(clips)):
        starts.append(starts[-1] + clips[i - 1].n - int(round(BLEND[clips[i].name] * FPS)))
    total = starts[-1] + clips[-1].n
    for f in range(total):
        active = [i for i in range(len(clips)) if starts[i] <= f < starts[i] + clips[i].n]
        if len(active) == 1:
            i = active[0]
            out.append((i, f - starts[i], None, 0, 0.0))
        else:
            a, b = active[0], active[-1]
            win = int(round(BLEND[clips[b].name] * FPS))
            w = F._ease((f - starts[b] + 1) / (win + 1))
            out.append((a, f - starts[a], b, f - starts[b], w))
    return out


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out, first, count = argv[0], int(argv[1]), int(argv[2])
    res = (int(argv[3]), int(argv[4])) if len(argv) > 4 else (960, 540)
    step = int(os.environ.get("STEP", "1"))
    view = os.environ.get("VIEW", "side")
    bpy.ops.wm.open_mainfile(filepath=os.path.join(os.path.dirname(HERE), "build", "toothless_assembled.blend"))
    sc = bpy.context.scene
    rig = bpy.data.objects["ToothlessRig"]
    QR.setup_clay(sc)
    sc.display.shading.show_shadows = True

    def mat(nm, rgb):
        m = bpy.data.materials.new(nm)
        m.diffuse_color = (*rgb, 1)
        return m
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -110, 0))
    g = bpy.context.active_object
    g.scale = (60, 280, 1)
    g.data.materials.append(mat("g", (0.36, 0.38, 0.33)))
    dark = mat("s", (0.25, 0.27, 0.23))
    for k in range(-120, 10):
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, k * 2.0, 0.001))
        s = bpy.context.active_object
        s.scale = (60, 0.12, 1)
        s.data.materials.append(dark)

    clips, _ = build(rig)
    tl = timeline(clips)
    # travel and altitude offsets, accumulated over the whole take (cheap: positions only need the clips' x, and the
    # altitude offsets need each clip's pelvis height at its start, measured once)
    X, xs = 0.0, []
    prev = None
    for (a, ka, b, kb, w) in tl:
        if prev is not None:
            pa, pka, pb_, pkb, pw = prev
            da = clips[a].x(ka) - clips[a].x(max(0, ka - 1)) if ka > 0 else (clips[a].x(1) - clips[a].x(0))
            db = (clips[b].x(kb) - clips[b].x(max(0, kb - 1)) if kb > 0 else clips[b].x(1) - clips[b].x(0)) if b is not None else 0.0
            X += da * (1 - w) + db * w
        xs.append(X)
        prev = (a, ka, b, kb, w)
    # altitude: each airborne clip after the first is offset to start where the previous clip's pelvis is at its
    # blend start; the offset eases out over the clip (the landing's by its touchdown, ~1.9 s into it)
    offsets = [0.0] * len(clips)
    for i in range(1, len(clips)):
        if not clips[i].airborne:
            continue
        start = next(f for f, row in enumerate(tl) if row[2] == i or row[0] == i)
        a, ka = tl[start][0], tl[start][1]
        clips[a].pose(ka)
        za = pelvis_z(rig) + offset_at(offsets, clips, a, ka)
        clips[i].pose(0)
        offsets[i] = za - pelvis_z(rig)
    os.makedirs(out, exist_ok=True)
    cam_h = None
    t_start = time.time()
    for f in range(first, min(first + count, len(tl)), step):
        a, ka, b, kb, w = tl[f]
        clips[a].pose(ka)
        pa = capture(rig)
        za = offset_at(offsets, clips, a, ka)
        if b is not None:
            clips[b].pose(kb)
            pb = capture(rig)
            zb = offset_at(offsets, clips, b, kb)
            for name, (la, qa) in pa.items():
                lb, qb = pb[name]
                if qa.dot(qb) < 0:
                    qb = -qb
                q = qa.slerp(qb, w)
                rig.pose.bones[name].matrix_basis = Matrix.Translation(la.lerp(lb, w)) @ q.to_matrix().to_4x4()
            bpy.context.view_layer.update()
            z_off = za * (1 - w) + zb * w
        else:
            z_off = za
        rig.location = (0, -xs[f], z_off)
        bpy.context.view_layer.update()
        h = pelvis_z(rig) + z_off - 1.02
        cam_h = h if cam_h is None else cam_h + (h - cam_h) * 0.08
        if view == "tq":
            loc, tgt, lens = Vector((-12.0, -xs[f] - 9.0, 4.5 + 0.9 * cam_h)), Vector((0, -xs[f] - 0.5, 1.2 + 0.9 * cam_h)), 28
        else:
            loc, tgt, lens = Vector((13.0, -xs[f] - 1.5, 2.2 + 0.9 * cam_h)), Vector((0, -xs[f] - 1.0, 1.4 + 0.9 * cam_h)), 34
        QR.shoot(sc, out, f"f{f:04d}", tuple(loc), tuple(tgt), lens=lens, res=res)
    print("REEL frames", len(tl), "s/frame", round((time.time() - t_start) / max(1, len(range(first, min(first + count, len(tl)), step))), 2))


def offset_at(offsets, clips, i, k):
    """Clip i's altitude offset at its frame k: full at its start, easing to 0 over the clip (the landing by ~1.9 s,
    before its touchdown; flap and glide over their length)."""
    o = offsets[i]
    if o == 0.0:
        return 0.0
    fade = int(round(1.9 * FPS)) if clips[i].name == "land" else clips[i].n
    return o * (1.0 - F._ease(min(1.0, k / max(1, fade))))


if __name__ == "__main__":
    main()
