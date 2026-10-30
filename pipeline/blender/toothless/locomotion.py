"""Authored locomotion cycles (Plan 5): looping walk / trot / gallop clips for toothless.poses.glb, built from big-cat
gait mechanics instead of the engine's procedural leg swing.

A cycle is authored the way an animator blocks one: per leg, the toe-tip path (planted and sliding back at the body's
speed through stance, a lifted hermite arc through swing) and the angles of the distal segments (scapula swing, the
carpus / hock fold, the toe peel at lift-off); per body, the bob, pitch, roll, spine flex, head steadying and tail lag.
A planar two-bone solve (humerus + radius, femur + tibia) closes each leg onto its target, every hinge about its bone's
local X like the engine's LegRig, and the result is baked to plain bone rotations: a frame dict in library.py's form,
so library.keyframe_frames bakes it and the glTF carries no IK.

Coordinates: armature space, Blender axes (-Y forward, Z up), the ground at z = 0. The clip runs "on a treadmill": the
body stays at the origin and a planted paw slides back (+Y) at the cycle's speed; the engine moves the body and pins
the paw. Leg phase follows gait.ts: 0 = touchdown, stance while phase < duty, leg phase = fract(cycle - offset).
"""
import math
import bpy
from mathutils import Vector
import anatomy as A

FPS = 30
LEGS = ("hind_L", "front_L", "hind_R", "front_R")      # gait.ts LEG_KEYS order (LH, LF, RH, RF)
CHAINS = {"front": ("front_humerus", "front_radius", "front_metacarpal", "front_toes"),
          "hind": ("hind_femur", "hind_tibia", "hind_metatarsal", "hind_toes")}
POLE = {"front": 1.0, "hind": -1.0}                    # the elbow folds back (+Y), the knee forward (-Y): anatomy.LIMBS
REST = {"front": A.FRONT_LEG_L, "hind": A.HIND_LEG_L}

# A cycle: frames per loop, body speed (m/s), duty, leg offsets (LEGS order), and per limb kind the stance centre of
# the toe tip (y), swing lift (m) and keyed angle channels over the leg phase: "distal" = metacarpal / metatarsal and
# "toes" in degrees from straight down toward forward (rest: front 45 / 79, hind 31 / 79); "scapula" in degrees of
# hinge rotation from bind (+ = protracted, the shoulder forward). Keys are (leg phase, value) with phase 0 first.
WALK = {
    "frames": 33, "speed": 1.2, "duty": 0.68, "offsets": (0.0, 0.25, 0.5, 0.75),
    "front": {"centre": -0.86, "lift": 0.15, "land": 0.5, "peel": 0.6,
              "distal": [(0.0, 42), (0.3, 47), (0.55, 50), (0.68, 30), (0.78, -5), (0.88, 15), (0.95, 40)],
              "toes": [(0.0, 79), (0.55, 79), (0.68, 45), (0.78, 15), (0.9, 62), (0.95, 86)],
              "scapula": [(0.0, 12), (0.34, 1), (0.68, -11), (0.85, 5), (0.95, 13)]},
    "hind": {"centre": 0.48, "lift": 0.11, "land": 0.5, "peel": 0.6,
             "distal": [(0.0, 35), (0.34, 33), (0.6, 38), (0.68, 46), (0.78, 10), (0.88, 25), (0.96, 38)],
             "toes": [(0.0, 79), (0.52, 79), (0.68, 40), (0.78, 22), (0.9, 66), (0.96, 85)]},
    "body": {"height": 0.98, "lean": -0.03, "bob": 0.014, "pitch": 0.012, "roll": 0.035, "flex": 0.03, "tail": 0.07},
}
CYCLES = {"walk": WALK}


def _pchip(keys, p):
    """Cyclic monotone cubic through (phase, value) keys (phase 0 first): no overshoot, so a held value (a planted
    paw's flat toes) stays exactly held between equal keys."""
    xs = [k[0] for k in keys]
    ys = [k[1] for k in keys]
    n = len(keys)
    X = [xs[-1] - 1.0] + xs + [1.0, xs[1] + 1.0]
    Y = [ys[-1]] + ys + [ys[0], ys[1]]
    p %= 1.0
    i = max(j for j in range(1, n + 1) if X[j] <= p)
    d = [(Y[k + 1] - Y[k]) / (X[k + 1] - X[k]) for k in range(n + 2)]

    def tangent(k):
        a, b = d[k - 1], d[k]
        return 0.0 if a * b <= 0 else 2.0 / (1.0 / a + 1.0 / b)
    h = X[i + 1] - X[i]
    t = (p - X[i]) / h
    return _hermite(Y[i], Y[i + 1], tangent(i) * h, tangent(i + 1) * h, t)


def _hermite(y0, y1, m0, m1, t):
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1


def _dir(phi_deg):
    """Unit direction (y, z) at phi degrees from straight down toward forward (-Y)."""
    a = math.radians(phi_deg)
    return Vector((-math.sin(a), -math.cos(a)))


def _seg(kind, a, b):
    r = REST[kind]
    return (Vector((r[b][1], r[b][2])) - Vector((r[a][1], r[a][2]))).length


def leg_targets(cyc, kind, p):
    """Toe-tip target (y, z) and the distal / toes angles of a leg at leg phase p."""
    c = cyc[kind]
    T = cyc["frames"] / FPS
    duty = cyc["duty"]
    stance = cyc["speed"] * duty * T                     # paw travel relative to the body while planted
    td, lo = c["centre"] - stance / 2, c["centre"] + stance / 2
    z0 = REST[kind]["toe"][2]
    toes = _pchip(c["toes"], p)
    distal = _pchip(c["distal"], p)
    if p < duty:
        return Vector((td + stance * p / duty, z0)), distal, toes
    # swing: the paw joint flies a hermite arc from its lift-off spot to its touchdown spot, leaving at a fraction
    # ("peel") of the ground's speed and arriving matching a fraction ("land") of it; the toe tip hangs off it
    w = (p - duty) / (1.0 - duty)
    lt = _seg(kind, "paw", "toe")
    paw_lo = Vector((lo, z0)) - lt * _dir(_pchip(c["toes"], duty))
    paw_td = Vector((td, z0)) - lt * _dir(_pchip(c["toes"], 0.0))
    v = cyc["speed"] * T * (1.0 - duty)                 # ground speed in swing-phase units
    y = _hermite(paw_lo.x, paw_td.x, c["peel"] * v, c["land"] * v, w)      # 2-D vectors: .x = y, .y = z
    z = paw_lo.y + (paw_td.y - paw_lo.y) * w + c["lift"] * math.sin(math.pi * w ** 0.8)
    paw = Vector((y, z))
    return paw + lt * _dir(toes), distal, toes


def body_bones(cyc, t):
    """Body channels at cycle phase t (LH touchdown at 0): (root height, pitch) and the spine / neck / head / tail
    rotations. The hips roll toward the swinging hind leg, the spine flexes laterally against the stride, the chest
    counter-rolls, the neck soaks up the bob so the head stays level, and the tail wave trails the hips."""
    b = cyc["body"]
    w = 2 * math.pi * t
    height = b["height"] + b["bob"] * math.cos(2 * w - 0.6)
    pitch = b["lean"] + b["pitch"] * math.sin(2 * w - 0.3)
    roll = b["roll"] * math.sin(w)
    bones = {"pelvis": (pitch, roll, 0.6 * b["flex"] * math.sin(w + 0.4))}
    for k, n in enumerate(("spine_01", "spine_02", "spine_03", "chest")):
        bones[n] = (0.0, -0.35 * roll if n == "chest" else 0.0, -b["flex"] * math.sin(w + 0.4 - 0.5 * k))
    for k, n in enumerate(("neck_01", "neck_02", "neck_03", "neck_04")):
        bones[n] = (-0.3 * pitch + 0.008 * math.sin(2 * w - 1.0 - 0.3 * k), 0.0, 0.5 * b["flex"] * math.sin(w - 0.2 * k))
    bones["head"] = (-0.4 * pitch - 0.01 * math.sin(2 * w - 1.6), 0.0, 0.6 * b["flex"] * math.sin(w - 0.9))
    for k in range(12):
        lag = 0.9 + 0.35 * k
        bones[f"tail_{k + 1:02d}"] = (0.02 * math.sin(2 * w - lag) + (0.03 if k < 4 else -0.02),
                                      0.0, b["tail"] * (0.4 + 0.05 * k) * math.sin(w - lag))
    return (height, pitch), bones


def _hinge(rig, name, d2):
    """Rotate pose bone `name` about its local X so it points along the armature-space (y, z) direction d2."""
    pb = rig.pose.bones[name]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    d = pb.matrix.to_3x3().inverted() @ Vector((0.0, d2.x, d2.y))
    pb.rotation_euler = (math.atan2(d.z, d.y), 0.0, 0.0)
    bpy.context.view_layer.update()
    return pb.rotation_euler[0]


def _yz(v):
    return Vector((v.y, v.z))


def solve_leg(rig, kind, side, toe, distal, toes, scapula=None):
    """Close one leg onto its toe-tip target: scapula (front), the two-bone solve to the wrist / hock, then the
    distal and toe segments at their authored angles. Returns {bone: (x, 0, 0)} and the toe-tip miss (m)."""
    upper, lower, dist, digit = (f"{n}_{side}" for n in CHAINS[kind])
    out = {}
    if scapula is not None:
        pb = rig.pose.bones[f"front_scapula_{side}"]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (math.radians(scapula), 0.0, 0.0)
        bpy.context.view_layer.update()
        out[pb.name] = (pb.rotation_euler[0], 0.0, 0.0)
    pbs = rig.pose.bones
    l_toe = (pbs[digit].tail - pbs[digit].head).length
    l_dist = (pbs[dist].tail - pbs[dist].head).length
    goal = Vector(toe)
    for _ in range(3):                                  # the legs splay a little out of the YZ plane: re-aim the miss
        paw = goal - l_toe * _dir(toes)
        mid = paw - l_dist * _dir(distal)               # wrist / hock
        root = _yz(pbs[upper].head)
        a = (pbs[upper].tail - pbs[upper].head).length
        b = (pbs[lower].tail - pbs[lower].head).length
        span = mid - root
        dist_ = max(abs(a - b) + 1e-4, min(a + b - 1e-4, span.length))
        u = span.normalized()
        ang = math.acos(max(-1.0, min(1.0, (a * a + dist_ * dist_ - b * b) / (2 * a * dist_))))
        n = Vector((-u.y, u.x))                         # u turned +90 deg in the (y, z) plane
        side_sign = 1.0 if n.x * POLE[kind] > 0 else -1.0
        joint = root + a * (u * math.cos(ang) + n * side_sign * math.sin(ang))
        _hinge(rig, upper, (joint - root).normalized())
        _hinge(rig, lower, (mid - _yz(pbs[lower].head)).normalized())
        _hinge(rig, dist, _dir(distal))
        _hinge(rig, digit, _dir(toes))
        miss = Vector(toe) - _yz(pbs[digit].tail)
        if miss.length < 5e-4:
            break
        goal += miss
    for nme in (upper, lower, dist, digit):
        out[nme] = (pbs[nme].rotation_euler[0], 0.0, 0.0)
    return out, (Vector(toe) - _yz(pbs[digit].tail)).length


def cycle_frames(rig, name):
    """The baked frames of a cycle (frames + 1 entries, the last equal to the first, so the clip loops cleanly) and
    a per-leg report (worst toe miss, hinge range used in degrees)."""
    import rig as R
    cyc = CYCLES[name]
    n = cyc["frames"]
    frames, report = [], {}
    for f in range(n + 1):
        t = (f % n) / n
        root, bones = body_bones(cyc, t)
        R.reset_pose(rig)
        _place(rig, root, bones)
        for key, off in zip(LEGS, cyc["offsets"]):
            kind, side = key.split("_")
            p = (t - off) % 1.0
            toe, distal, toes = leg_targets(cyc, kind, p)
            scap = _pchip(cyc["front"]["scapula"], p) if kind == "front" else None
            leg, miss = solve_leg(rig, kind, side, toe, distal, toes, scap)
            bones.update(leg)
            r = report.setdefault(key, {"miss": 0.0, "range": {}})
            r["miss"] = max(r["miss"], miss)
            for bn, e in leg.items():
                lo, hi = r["range"].get(bn, (1e9, -1e9))
                r["range"][bn] = (min(lo, math.degrees(e[0])), max(hi, math.degrees(e[0])))
        frames.append({"root": root, "wings": (1.0, 0.0, 0.0), "bones": bones})
    return frames, report


def _place(rig, root, bones):
    """Body only (legs still at bind): root placement and the spine / neck / tail rotations, evaluated."""
    import library as LIB
    LIB.place_root(rig, *root)
    for n, e in bones.items():
        pb = rig.pose.bones[n]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = e
    bpy.context.view_layer.update()


def limit_report(report):
    """Lines naming any hinge that leaves its anatomy.LIMBS range (degrees from bind)."""
    out = []
    for key, r in report.items():
        kind, side = key.split("_")
        lim = A.LIMBS[kind]["limits"]
        for bn, (lo, hi) in r["range"].items():
            base = bn[:-2]
            a, b = lim[base]
            flag = "" if a <= lo and hi <= b else "  <-- OUTSIDE"
            out.append(f"{key:8s} {base:18s} {lo:7.1f} .. {hi:6.1f}  (limit {a} .. {b}){flag}")
        out.append(f"{key:8s} worst toe miss {r['miss'] * 100:.2f} cm")
    return out
