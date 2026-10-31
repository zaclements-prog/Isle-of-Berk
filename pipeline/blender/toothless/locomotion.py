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
    "body": {"height": 0.95, "lean": -0.03, "bob": (0.0, 1, 0.0), "pitch": (0.0, 1, 0.0), "roll": 0.035,
             "flex": 0.03, "tail": 0.07,
             # the body line: a bob per step (amplitude m, harmonic, phase at the neck base) running back along the
             # body over waveLength m per stride, so shoulders and hips rock in turn and the tail carries the wave on
             "path": (0.022, 2, 3.12), "waveLength": 5.0, "neckDrop": 0.05, "headLevel": 0.3, "follow": 0.5,
             "tailDroop": (0.22, 0.12)},
}


def _keys(duty, stance, swing):
    """Absolute leg-phase keys from stance keys (fraction of stance, value) and swing keys (fraction of swing,
    value): one channel shape serves every duty factor."""
    return [(s * duty, v) for s, v in stance] + [(duty + w * (1.0 - duty), v) for w, v in swing]


# Trot: diagonal pairs (LH + RF, RH + LF), a short float between pairs, the bob twice a cycle and little roll.
TROT = {
    "frames": 20, "speed": 3.0, "duty": 0.45, "offsets": (0.0, 0.5, 0.5, 0.0),
    "front": {"centre": -0.97, "lift": 0.17, "land": 0.55, "peel": 0.6,
              "distal": _keys(0.45, [(0, 42), (0.45, 48), (0.8, 50)], [(0, 30), (0.3, -5), (0.62, 15), (0.85, 40)]),
              "toes": _keys(0.45, [(0, 79), (0.78, 79)], [(0, 45), (0.3, 15), (0.7, 62), (0.88, 86)]),
              "scapula": _keys(0.45, [(0, 13), (0.5, 1)], [(0, -12), (0.5, 5), (0.85, 14)])},
    "hind": {"centre": 0.46, "lift": 0.14, "land": 0.55, "peel": 0.6,
             "distal": _keys(0.45, [(0, 35), (0.5, 33), (0.88, 40)], [(0, 46), (0.31, 10), (0.625, 25), (0.875, 38)]),
             "toes": _keys(0.45, [(0, 79), (0.74, 79)], [(0, 40), (0.31, 22), (0.69, 66), (0.875, 85)])},
    "body": {"height": 0.94, "lean": -0.03, "bob": (0.0, 1, 0.0), "pitch": (0.0, 1, 0.0), "roll": 0.015,
             "flex": 0.018, "tail": 0.05,
             "path": (0.032, 2, 2.82), "waveLength": 5.0, "neckDrop": 0.06, "headLevel": 0.3, "follow": 0.5,
             "tailDroop": (0.2, 0.12)},
}

# Gallop: a bounding, pouncing rotary gallop (LH, RH, RF, LF). The hinds land under the chest with the back bowed
# and compress, then the spine uncoils and drives the body up into a long, high, stretched flight with the nose up and
# the fores reaching; the fores catch the weight, the body pivots over them nose down and the back coils again as the
# hinds swing forward through a lower, gathered flight. Height, pitch and arch are keyed over the cycle; the tail
# counterbalances.
GALLOP = {
    "frames": 20, "speed": 6.0, "duty": 0.21, "offsets": (0.0, 0.65, 0.1, 0.55),
    "front": {"centre": -1.17, "lift": 0.2, "skew": 1.5, "land": 0.35, "peel": 0.2,
              "distal": _keys(0.21, [(0, 40), (0.5, 50), (0.85, 52)], [(0, 25), (0.28, 6), (0.6, 30), (0.85, 46)]),
              "toes": _keys(0.21, [(0, 79), (0.7, 79)], [(0, 40), (0.3, 10), (0.7, 62), (0.88, 86)]),
              "scapula": _keys(0.21, [(0, 20), (0.5, 0)], [(0, -12), (0.4, 10), (0.85, 21)])},
    "hind": {"centre": 0.45, "lift": 0.22, "land": 0.3, "peel": 0.3,
             "distal": _keys(0.21, [(0, 48), (0.5, 38), (0.88, 44)], [(0, 52), (0.3, 10), (0.62, 34), (0.875, 50)]),
             "toes": _keys(0.21, [(0, 79), (0.68, 79)], [(0, 36), (0.3, 18), (0.69, 66), (0.875, 85)])},
    "body": {"height": 0.91, "lean": -0.045, "smooth": 2, "bob": (0.0, 1, 0.0), "pitch": (0.0, 1, 0.0),
             # the line through the sky: its height offset (m) under the neck base over the stride. Every spine and
             # tail joint passes through the same heights later, delayed by its distance behind / the stride length.
             "path": [(0.0, 0.06), (0.22, 0.12), (0.47, 0.02), (0.72, -0.1), (0.9, -0.02)], "pathGain": 1.8,
             "roll": 0.012, "flex": 0.02, "tail": 0.06, "tailLift": 0.0, "neckDrop": 0.07, "headLevel": 0.3, "follow": 0.3},
}
CYCLES = {"walk": WALK, "trot": TROT, "gallop": GALLOP}


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


_FOURIER = {}


def _smooth(keys, t, n):
    """The keyed cycle low-passed to its first n harmonics: the PCHIP curve sampled round the loop and refit as a
    Fourier series, so the body flows through its keys with no corners (a panther, not a puppet)."""
    k = (id(keys), n)
    if k not in _FOURIER:
        m = 96
        ys = [_pchip(keys, i / m) for i in range(m)]
        coef = [(sum(ys) / m, 0.0)]
        for h in range(1, n + 1):
            coef.append((2 / m * sum(y * math.cos(2 * math.pi * h * i / m) for i, y in enumerate(ys)),
                         2 / m * sum(y * math.sin(2 * math.pi * h * i / m) for i, y in enumerate(ys))))
        _FOURIER[k] = coef
    c = _FOURIER[k]
    return c[0][0] + sum(a * math.cos(2 * math.pi * h * t) + b * math.sin(2 * math.pi * h * t)
                         for h, (a, b) in enumerate(c[1:], 1))


def _chan(body, name, t):
    """A keyed body channel at cycle phase t: smoothed when the body asks for it (body["smooth"] harmonics)."""
    keys = body[name]
    if isinstance(keys, tuple):                       # (amplitude, harmonic, phase) on a cosine
        amp, h, ph = keys
        return amp * math.cos(2 * math.pi * h * t + ph)
    return _smooth(keys, t % 1.0, body["smooth"]) if body.get("smooth") else _pchip(keys, t)


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


def _rise(cyc, t, kind):
    """How far the body above leg `kind` has risen over its baseline at cycle phase t (a keyed bob, or the travelling
    line at the shoulder / hip; a sine bob is small and left out)."""
    b = cyc["body"]
    if "path" in b:
        return _line(cyc, t, REST[kind]["shoulder" if kind == "front" else "hip"][1])
    return _chan(b, "bob", t) if isinstance(b["bob"], list) else 0.0


LEAD_Y = A.NECK[0][1][1]          # the neck base: the body line's leading point


def _line(cyc, t, y):
    """The travelling line's height offset at rest-y `y` (m, +Y behind) and cycle phase t: what the neck base had
    (y - LEAD_Y) / stride of a cycle earlier. The wave stands still in the world while the body runs through it."""
    wave = cyc["body"].get("waveLength") or cyc["speed"] * cyc["frames"] / FPS    # default: the stride (fixed in
    return cyc["body"].get("pathGain", 1.0) * _chan(cyc["body"], "path", t - (y - LEAD_Y) / wave)  # the world)


def leg_targets(cyc, kind, p, off=0.0):
    """Toe-tip target (y, z) and the distal / toes angles of a leg at leg phase p (leg offset `off`). A swinging paw
    rides up with the body when it rises above the line between its lift-off and touchdown heights (the gallop's
    flight): the leg stays reaching through the air instead of straining down to the ground."""
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
    z = paw_lo.y + (paw_td.y - paw_lo.y) * w + c["lift"] * math.sin(math.pi * w ** c.get("skew", 0.8))   # skew > 1: the peak comes later
    t_lo, t_td = (off + duty) % 1.0, off % 1.0
    base = _rise(cyc, t_lo, kind) + (_rise(cyc, t_td, kind) - _rise(cyc, t_lo, kind)) * w
    z += cyc["body"].get("follow", 1.0) * max(0.0, _rise(cyc, (off + p) % 1.0, kind) - base)
    paw = Vector((y, z))
    return paw + lt * _dir(toes), distal, toes


def body_bones(cyc, t):
    """Body channels at cycle phase t (LH touchdown at 0): (root height, pitch) and the spine / neck / head / tail
    rotations. bob = (amplitude m, harmonic, phase) on a cosine, pitch = (rad, harmonic, phase) on a sine about the
    lean, or either (and arch) keyed as [(cycle phase, value)]; the hips roll toward the swinging hind leg, the spine flexes laterally against the stride, the chest
    counter-rolls; arch = (rad per spine bone, phase of the most gathered moment) bows the back up and stretches it
    flat, or spine = keyed total flexion for a cat's back (hips tucking, a wave running forward); the neck soaks up the body's pitch and the arch so the head stays level; the tail wave trails the hips."""
    b = cyc["body"]
    w = 2 * math.pi * t
    if isinstance(b["bob"], list):                     # keyed over the cycle (the gallop's bound)
        h = 1
        height = b["height"] + _chan(b, "bob", t)
    else:
        amp, h, ph = b["bob"]
        height = b["height"] + amp * math.cos(h * w + ph)
    if isinstance(b["pitch"], list):
        pitch = b["lean"] + _chan(b, "pitch", t)
    else:
        pa, ph_, pph = b["pitch"]
        pitch = b["lean"] + pa * math.sin(ph_ * w + pph)
    roll = b["roll"] * math.sin(w)
    if isinstance(b.get("arch"), list):
        arch = _chan(b, "arch", t)
    else:
        aa, at = b.get("arch", (0.0, 0.0))
        arch = aa * math.cos(w - 2 * math.pi * at)      # + = gathered (back bowed up), - = stretched
    yaw0 = 0.6 * b["flex"] * math.sin(w + 0.4)
    if "spine" in b:
        # a cat's back: the flex lives in the loins and runs forward as a wave. Total flexion F (rad, + = rounded) tilts
        # the hips under (pelvis front up by F / 2) and curls the back evenly back down (-F / 4 per joint), so the
        # pelvis -> chest chord keeps the body pitch while the hips rock through the full range.
        flex = lambda k: _chan(b, "spine", t - 0.03 * k)        # joint k lags the loins by 3 % of the stride per bone
        pelvis = pitch + 0.5 * flex(-1)
        bones = {"pelvis": (pelvis, roll, yaw0)}
        chest = pelvis
        for k, n in enumerate(("spine_01", "spine_02", "spine_03", "chest")):
            bend = -0.25 * flex(k)
            chest += bend
            bones[n] = (bend, -0.35 * roll if n == "chest" else 0.0, -b["flex"] * math.sin(w + 0.4 - 0.5 * k))
        steady = -(chest - b["lean"]) - b["lean"] * 0.3          # level the head against the chest's own tilt
        tail_base = pelvis - pitch          # tail bones point back (local X flipped): + lifts the tip, undoing the hip tilt
        wing_lift = 0.8 * (chest - pitch)                       # the folded wings stay down on the back as the chest tips
    else:
        bones = {"pelvis": (pitch, roll, yaw0)}
        for k, n in enumerate(("spine_01", "spine_02", "spine_03", "chest")):
            bend = arch if k == 0 else -0.667 * arch        # slopes +1, +1/3, -1/3, -1 x arch along the back
            bones[n] = (bend, -0.35 * roll if n == "chest" else 0.0, -b["flex"] * math.sin(w + 0.4 - 0.5 * k))
        steady = -(pitch - b["lean"]) - b["lean"] * 0.3 + arch    # the chest ends tipped -arch: lift the neck as much
        tail_base = 0.0
        wing_lift = 0.0
    for k, n in enumerate(("neck_01", "neck_02", "neck_03", "neck_04")):
        bones[n] = (0.25 * steady - b.get("neckDrop", 0.0) + 0.008 * math.sin(h * w - 1.0 - 0.3 * k), 0.0,
                    0.5 * b["flex"] * math.sin(w - 0.2 * k))
    bones["head"] = (0.1 * steady + 3.5 * b.get("neckDrop", 0.0) - 0.01 * math.sin(h * w - 1.6), 0.0,
                     0.6 * b["flex"] * math.sin(w - 0.9))     # neckDrop: the neck carried long and low, the face level
    lift = b.get("tailLift", 0.02)
    carry = b.get("tailCarry")                                 # (root droop, tip curl) per bone, else a gentle lift
    rest = [(carry[0] if k < 5 else carry[1] if k >= 8 else 0.0) if carry else (0.03 if k < 4 else -0.02)
            for k in range(12)]
    for k in range(12):
        lag = 0.9 + 0.35 * k
        wave = b.get("tailWave", 0.0) * _chan(b, "spine", t - 0.03 * (k + 5)) if "spine" in b else 0.0
        bones[f"tail_{k + 1:02d}"] = (lift * math.sin(h * w - lag) + rest[k] + (tail_base if k == 0 else 0.0)
                                      + wave,
                                      0.0, b["tail"] * (0.4 + 0.05 * k) * math.sin(w - lag))
    return (height, pitch), bones, wing_lift


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


_REACH = {}


def _reach(rig, kind, upper, lower):
    """Longest root -> wrist / hock span the joint limits allow: the lower bone at either end of its anatomy.LIMBS
    range (bind is bent, and the straight leg is past the limit). Measured once on the posed rig."""
    if lower not in _REACH:
        pbs = rig.pose.bones
        spans = []
        for lim in A.LIMBS[kind]["limits"][lower[:-2]]:
            for n, ang in ((upper, 0.0), (lower, math.radians(lim))):
                pbs[n].rotation_mode = "XYZ"
                pbs[n].rotation_euler = (ang, 0.0, 0.0)
            bpy.context.view_layer.update()
            spans.append((pbs[lower].tail - pbs[upper].head).length)
        _REACH[lower] = max(spans)
    return _REACH[lower]


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
        dist_ = max(abs(a - b) + 1e-4, min(_reach(rig, kind, upper, lower) - 1e-4, span.length))
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
    keep = cyc["body"].get("headLevel")
    if keep is not None:                                      # first pass: where the uncorrected body carries the head
        raw = []
        for f in range(n):
            root, bones, _ = body_bones(cyc, f / n)
            R.reset_pose(rig)
            _place(rig, root, bones)
            if "path" in cyc["body"]:
                _path_body(rig, cyc, f / n, bones)
            raw.append(rig.pose.bones["head"].head.z)
        mean = sum(raw) / n
    for f in range(n + 1):
        t = (f % n) / n
        root, bones, wing_lift = body_bones(cyc, t)
        R.reset_pose(rig)
        _place(rig, root, bones)
        if "path" in cyc["body"]:
            root, wing_lift = _path_body(rig, cyc, t, bones)
        if keep is not None:
            _level_head(rig, bones, mean + keep * (raw[f % n] - mean))
        for key, off in zip(LEGS, cyc["offsets"]):
            kind, side = key.split("_")
            p = (t - off) % 1.0
            toe, distal, toes = leg_targets(cyc, kind, p, off)
            scap = _pchip(cyc["front"]["scapula"], p) if kind == "front" else None
            leg, miss = solve_leg(rig, kind, side, toe, distal, toes, scap)
            bones.update(leg)
            r = report.setdefault(key, {"miss": 0.0, "range": {}})
            if p < cyc["duty"]:                              # a swinging paw short of its target is only in the air
                r["miss"] = max(r["miss"], miss)
            for bn, e in leg.items():
                lo, hi = r["range"].get(bn, (1e9, -1e9))
                r["range"][bn] = (min(lo, math.degrees(e[0])), max(hi, math.degrees(e[0])))
        frames.append({"root": root, "wings": (1.0, wing_lift, 0.0), "bones": bones})
    return frames, report


BODY_LINE = ("pelvis", "spine_01", "spine_02", "spine_03", "chest") + tuple(f"tail_{k:02d}" for k in range(1, 13))


def _path_body(rig, cyc, t, bones):
    """Lay the spine and tail along the travelling line: each joint's target height is its rest height, crouched by
    body height and tilted by lean about the hips, plus the line's offset at its own y. The pelvis sets the root
    (height, pitch); every later bone hinges about its local X to aim at its tail joint's target, keeping the
    roll / yaw sway body_bones gave it. The neck and the folded wings counter the chest's tilt. Returns the root and
    the wing lift."""
    import library as LIB
    b = cyc["body"]
    data = rig.data.bones
    pelvis_rest = data["pelvis"].head_local

    tail0, tail1 = data["tail_01"].head_local.y, data["tail_12"].tail_local.y
    droop, curl = b.get("tailDroop", (0.0, 0.0))

    def carriage(y):
        """The tail hung low through its middle and its tip turned up (m below its rest line)."""
        u = max(0.0, (y - tail0) / (tail1 - tail0))
        return -droop * math.sin(math.pi * min(1.0, u / 1.2)) + curl * max(0.0, (u - 0.6) / 0.4) ** 2

    def target(p):
        return (p.z + (b["height"] - pelvis_rest.z) + b["lean"] * (pelvis_rest.y - p.y) + _line(cyc, t, p.y)
                + carriage(p.y))
    zp = target(pelvis_rest)
    nxt = data["pelvis"].tail_local
    run = pelvis_rest.y - nxt.y
    pitch = math.atan2(target(nxt) - zp, run) - math.atan2(nxt.z - pelvis_rest.z, run)
    LIB.place_root(rig, zp, pitch)
    bones["pelvis"] = (pitch, bones["pelvis"][1], bones["pelvis"][2])
    rig.pose.bones["pelvis"].rotation_euler = bones["pelvis"]
    bpy.context.view_layer.update()
    for n in BODY_LINE[1:]:
        tail = data[n].tail_local
        pb = rig.pose.bones[n]
        aim = Vector((tail.y, target(tail))) - _yz(pb.head)
        theta = _hinge(rig, n, aim.normalized())
        bones[n] = (theta, bones[n][1], bones[n][2])
        pb.rotation_euler = bones[n]
        bpy.context.view_layer.update()
    rest = data["chest"].tail_local - data["chest"].head_local
    cur = rig.pose.bones["chest"].tail - rig.pose.bones["chest"].head
    chest = math.atan2(cur.z, -cur.y) - math.atan2(rest.z, -rest.y)       # + = the chest tipped nose up
    drop = b.get("neckDrop", 0.0)
    for n in ("neck_01", "neck_02", "neck_03", "neck_04"):
        bones[n] = (-0.225 * chest - drop, bones[n][1], bones[n][2])
    bones["head"] = (-0.1 * chest + 3.5 * drop, bones["head"][1], bones["head"][2])
    for n in ("neck_01", "neck_02", "neck_03", "neck_04", "head"):
        rig.pose.bones[n].rotation_euler = bones[n]
    bpy.context.view_layer.update()
    # the folded wings ride with the chest (a nose-up tilt lowers their tips by as much); lift them so their angle
    # follows 80 % of the chest -> loins line's turn from bind, laying the bundle along the back
    lo, ch = rig.pose.bones["spine_01"].head, rig.pose.bones["chest"].head
    rlo, rch = data["spine_01"].head_local, data["chest"].head_local
    back = math.atan2(lo.z - ch.z, lo.y - ch.y) - math.atan2(rlo.z - rch.z, rlo.y - rch.y)   # + = loins higher
    return (zp, pitch), max(-0.4, min(0.4, 0.8 * back + chest))


def _level_head(rig, bones, target):
    """The neck carries the head toward height `target` (a panther's head rides a near-level line while its body
    rocks): neck_01 / neck_02 pitch together, the head counter-pitches so the face keeps its angle."""
    pbs = rig.pose.bones
    total = 0.0
    for _ in range(4):
        err = target - pbs["head"].head.z
        if abs(err) < 0.003:
            break
        lever = max(0.2, abs(pbs["head"].head.y - pbs["neck_01"].head.y))
        d = max(-0.5 - total, min(0.5 - total, err / lever))
        total += d
        for n, share in (("neck_01", 0.5), ("neck_02", 0.5), ("head", -1.0)):
            x, y, z = bones[n]
            bones[n] = (x + share * d, y, z)
            pbs[n].rotation_euler = bones[n]
        bpy.context.view_layer.update()


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
        out.append(f"{key:8s} worst stance toe miss {r['miss'] * 100:.2f} cm")
    return out


# ---- export (toothless.poses.glb / poses.json) ----------------------------------------------------------------------

LOCO_CLIPS = {"walk": "loco_walk", "trot": "loco_trot", "gallop": "loco_gallop"}
# the engine plays these additively over its body pose: the legs stay the planner's and the leg IK's
LOCO_MASK = ["pelvis", "spine_", "chest", "neck_", "head", "tail_"]


def _solved(rig, name):
    """cycle_frames with NLA playback muted (earlier clips' tracks would override the posed bones mid-solve)."""
    ad = rig.animation_data
    use_nla = ad.use_nla if ad else None
    if ad:
        ad.use_nla = False
    try:
        return cycle_frames(rig, name)[0]
    finally:
        if ad:
            ad.use_nla = use_nla


def make_clips(rig):
    """Bake every cycle as a looping clip (frames + 1 keys, the last equal to the first)."""
    import library as LIB
    solved = {name: _solved(rig, name) for name in LOCO_CLIPS}
    return [LIB.keyframe_frames(rig, clip, solved[name]) for name, clip in LOCO_CLIPS.items()]


def meta_entries(rig):
    """poses.json entries: mask, loop, blends and a `locomotion` block — the gait (gait.ts name), nominal speed (m/s),
    stride (m), duty and leg offsets the cycle was authored with, and per-frame curves over one loop (frame k at
    phase k / frames): rootBob = the pelvis height about its mean (m; the glTF carries rotations only for the engine's
    additive layer), wingLift = the folded wings' lift (rad) that keeps them on the flexing back."""
    out = {}
    for name, clip in LOCO_CLIPS.items():
        cyc = CYCLES[name]
        frames = _solved(rig, name)
        n = cyc["frames"]
        period = n / FPS
        heights = [f["root"][0] for f in frames[:n]]
        mean = sum(heights) / n
        out[clip] = {
            "mask": LOCO_MASK, "loop": True, "blendIn": 0.3, "blendOut": 0.3, "interrupt": "exit",
            "duration": round(period, 4),
            "locomotion": {
                "gait": name, "speed": cyc["speed"], "stride": round(cyc["speed"] * period, 4), "duty": cyc["duty"],
                "offsets": list(cyc["offsets"]), "height": round(mean, 4),
                "rootBob": [round(h - mean, 4) for h in heights],
                "wingLift": [round(f["wings"][1], 4) for f in frames[:n]],
            },
        }
    return out
