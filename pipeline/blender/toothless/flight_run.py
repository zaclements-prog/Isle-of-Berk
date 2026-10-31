"""Running takeoff and running landing: flight out of and back into the gallop, without stopping.

Running takeoff: the gallop carries on while the wings open over its last strides (the fold path run backwards, up to
the stroke's top). On the next hind plant (the gallop's phase 0, the left hind touching down) the takeoff's push takes
over: the hind paws drive off the spot they planted on, the first downstroke pulls with them, the fore legs are already
off the ground in their swing and fold up into the hang. The takeoff runs with the gallop's height as its start and
the gallop's speed as its lift-off speed, so nothing has to stop and crouch first.

Running landing: the glide comes in faster and flatter, a short flare with light braking, and the hind paws reach for
the gallop's own touchdown spot at the gallop's speed. From touchdown the gallop takes over in phase (hind touchdown =
the gallop's phase 0) while the wings finish folding, and the run carries on.

Both build on the existing clips (flight.takeoff_frames, flight_seq.landing) and blend them with the baked gallop at
the pose-bone level, as the showreel blends clips.
"""
import math
import bpy
from mathutils import Matrix
import flight as F, flight_seq as FS, locomotion as L, library as LIB

FPS = F.FPS
GALLOP = L.GALLOP

RUN_TAKEOFF = dict(F.TAKEOFF,
                   pushTime=0.2,                         # one hind stance of the gallop
                   push=2.8,                             # m/s up at toe-off: the run already carries him forward
                   offH=1.26,
                   forward=(GALLOP["speed"], 10.0))      # lift-off at the gallop's speed, accelerating into the climb
RUN_TAKEOFF_AIR = 2.1                                    # s of climb kept after the push (the cruise flap follows)
RUN_TAKEOFF_STRIDES = 2                                  # gallop strides in the clip before the push (wings opening)
RUN_TAKEOFF_BLEND = 0.45                                 # s: gallop -> takeoff pose from the hind plant

RUN_LAND = dict(FS.LAND,
                flare=0.6,                               # a short flare: he keeps his speed to run it out
                speed=(13.0, 10.0, GALLOP["speed"]),
                flarePitch=0.32, tdPitch=0.12,
                tdH=1.02, tdSink=0.7,
                foldStart=0.1, foldTime=1.0)
RUN_LAND_BLEND = 0.35                                    # s: landing -> gallop from touchdown
RUN_LAND_STRIDES = 3                                     # gallop strides kept in the clip after touchdown


def capture(rig, names=None):
    return {pb.name: (pb.matrix_basis.to_translation(), pb.matrix_basis.to_quaternion())
            for pb in rig.pose.bones if names is None or pb.name in names}


def set_blend(rig, a, b, w):
    """Pose bones from captures a -> b by w (rotations slerped on one hemisphere, locations lerped)."""
    pbs = rig.pose.bones
    for name, (la, qa) in a.items():
        if name not in b:
            continue
        lb, qb = b[name]
        if qa.dot(qb) < 0:
            qb = -qb
        pbs[name].matrix_basis = Matrix.Translation(la.lerp(lb, w)) @ qa.slerp(qb, w).to_matrix().to_4x4()
    bpy.context.view_layer.update()


def _is_wing(n):
    return n.startswith(("wing_", "hipwing_"))


def _hind_td():
    """The gallop's hind touchdown toe tip (y, z), body frame."""
    v = L.leg_targets(GALLOP, "hind", 0.0)[0]
    return v.x, v.y


class Run:
    """n frames; pose(k) poses frame k; x(k) forward travel (m); gallop(k) the gallop frame the clip is in step with at
    frame k (for joining a following gallop clip in phase)."""
    def __init__(self, n, pose, x, gallop=None, fade=None):
        self.n, self.pose, self.x, self.gallop, self.fade = n, pose, x, gallop, fade


def run_takeoff(rig, folded, gal, strides=RUN_TAKEOFF_STRIDES):
    per = len(gal) - 1
    gh = gal[0]["root"][0]
    c = dict(RUN_TAKEOFF, dipH=gh, crouchH=gh)                 # the push starts from the gallop's own height
    tk = F.takeoff_frames(c)
    i0 = int(round(c["windup"] * FPS))                          # the push's first frame
    ch_top = tk[i0]["wing"]
    ty, tz = _hind_td()
    shift = ty - F.TOE_REST["hind"][0]
    for fr in tk[i0:]:
        # the hind paws push off the gallop's touchdown spot; the fore paws are in their swing (no ground solve)
        fr["legIK"] = {k: (v[0], (v[1][0] + shift, tz)) + tuple(v[2:]) for k, v in fr["legIK"].items()
                       if k.startswith("hind")}
    G = strides * per
    U = int(round(0.78 * FPS))                                  # the wings open over the last strides
    B = int(round(RUN_TAKEOFF_BLEND * FPS))
    n = G + int(round(RUN_TAKEOFF_AIR * FPS))
    names = [pb.name for pb in rig.pose.bones if not _is_wing(pb.name)]

    def gallop_pose(k, unfold):
        LIB.apply_pose(rig, gal[k % per])
        if unfold > 0:
            F.pose_unfold(rig, unfold, ch_top, folded)

    def pose(k):
        if k < G:
            gallop_pose(k, max(0.0, min(1.0, (k - (G - U)) / U)))
            return
        j = k - G
        w = F._ease(min(1.0, (j + 1) / (B + 1)))
        if w < 1.0:
            gallop_pose(k, 1.0)
            a = capture(rig, names)
        F.apply_frame(rig, tk[i0 + j], folded, tk)
        if w < 1.0:
            b = capture(rig, names)
            set_blend(rig, a, b, w)

    def x(k):
        if k < G:
            return GALLOP["speed"] * k / FPS
        return GALLOP["speed"] * G / FPS + tk[min(len(tk) - 1, i0 + k - G)]["x"]
    return Run(n, pose, x, gallop=lambda k: k % per)


def run_landing(rig, folded, gal, c=RUN_LAND):
    per = len(gal) - 1
    allf = FS.landing(c)
    hook = FS.body_hook(allf)
    s0 = allf[0]["clipStart"]
    t_td = c["lead"] + c["approach"] + c["flare"]
    i_td = int(round(t_td * FPS))
    ty, tz = _hind_td()
    shift = ty - F.TOE_REST["hind"][0]
    x_td = allf[i_td]["x"]
    for i, fr in enumerate(allf):
        if i > i_td:                                            # he runs on at the gallop's speed
            fr["x"] = x_td + GALLOP["speed"] * (i - i_td) / FPS
        # the hind paws reach for the gallop's touchdown spot; the fore paws come down in the gallop's own time
        fr["legIK"] = {k: (v[0], (v[1][0] + shift, tz)) + tuple(v[2:]) for k, v in (fr.get("legIK") or {}).items()
                       if k.startswith("hind")}
    B = int(round(RUN_LAND_BLEND * FPS))
    k_td = i_td - s0
    n = k_td + RUN_LAND_STRIDES * per
    wing_done = int(round((c["foldStart"] + c["foldTime"]) * FPS))
    WB = int(round(0.3 * FPS))
    body_names = [pb.name for pb in rig.pose.bones if not _is_wing(pb.name)]
    wing_names = [pb.name for pb in rig.pose.bones if _is_wing(pb.name)]

    def pose(k):
        i = s0 + k
        d = i - i_td                                            # frames since hind touchdown
        if d < -1:
            F.apply_frame(rig, allf[i], folded, None, hook)
            return
        w = F._ease(min(1.0, (d + 2) / (B + 2)))
        ww = F._ease(max(0.0, min(1.0, (d - wing_done) / WB)))
        if i < len(allf):
            F.apply_frame(rig, allf[i], folded, None, hook)
            a = capture(rig)
        else:
            a = None
        LIB.apply_pose(rig, gal[d % per])
        if a is None:
            return
        b = capture(rig)
        set_blend(rig, {n: a[n] for n in body_names}, b, w)
        set_blend(rig, {n: a[n] for n in wing_names}, b, ww)

    def x(k):
        i = s0 + k
        base = allf[s0]["x"]
        if i < len(allf):
            return allf[i]["x"] - base
        return allf[-1]["x"] - base + GALLOP["speed"] * (i - len(allf) + 1) / FPS
    return Run(n, pose, x, gallop=lambda k: (s0 + k - i_td) % per, fade=max(1, k_td - int(round(0.15 * FPS))))
