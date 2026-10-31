"""Authored takeoff (flight, Phase 2 groundwork): wind-up, push-off and the first heavy wingbeats that haul Toothless
off the ground, then a looping climbing beat.

The wings are posed by direction, like rig.fold_wings, from a few beat channels per segment:
- elev / sweep: the stroke itself, the wing rotated about the shoulder (elev about the body's long axis, + = up;
  sweep about the vertical, + = forward);
- fold: the elbow folding the hand back toward the body on the upstroke (deg), fan: the rib fan closing (0..1);
- twist: pronation about the leading edge (deg, + = leading edge down, the downstroke's angle of attack);
- bend: the rib tips bending under the air load (deg, + = up: the air pushing up under a downstroke).
Each segment outboard samples the stroke a little later (the shoulder leads, the forearm, rib roots and rib tips
follow), so the wing moves like a whip and the membrane trails the arm.

The body is not keyed by hand: its height comes from a small simulation, lift against gravity, where the lift is the
air the wing pushes down: proportional to the squared downstroke speed and to how spread the wing is. Each
downstroke visibly hauls him up and he sags between strokes, which is what makes the wings read as working the air.
On the ground the legs push off first (jump_crouch -> jump_launch), then tuck (jump_tuck).
"""
import math
import bpy
from mathutils import Matrix, Quaternion, Vector
import anatomy as A
import library as LIB
import rig as R

FPS = 30
G = 9.81
SIDES = (("L", 1), ("R", -1))
RIBS = 7
LEG_PREFIX = ("front_", "hind_")

TAKEOFF = {
    "windup": 0.6,            # s: crouch while the wings unfold and lift to the top of the stroke
    "first": 0.55,            # s: the first downstroke (longer, the legs push off under it)
    "period": 0.78,           # s: a climbing beat (~1.3 Hz for a 13.6 m span)
    "down": 0.56,             # fraction of a beat spent on the downstroke
    "beats": 5,               # after the first stroke
    "lift": 19.0,             # m/s^2 at full downstroke speed (scaled by spread): sets the climb
    "drag": 1.6,              # 1/s: vertical air damping
    "push": 3.2,              # m/s: vertical speed the legs give at lift-off
    "forward": (0.6, 3.5),    # m/s: forward speed at lift-off -> after the beats (the downstroke sweeps forward)
    "top": 62.0, "bottom": -42.0,          # stroke elevation (deg)
    "sweepTop": -14.0, "sweepBottom": 12.0,  # back at the top, forward at the bottom
    "foldMax": 58.0, "fanMax": 0.45,
    "twistDown": 12.0, "twistUp": -22.0,
    "bendDown": 16.0, "bendUp": -7.0,
    "lag": 0.035,             # beat fraction each segment outboard lags the one inside it
    # the body line: the spine and tail follow the chest's own path through the air, a point d m behind the chest
    # where the chest was d / waveSpeed s ago, so each downstroke hauls the chest up and the hips and tail answer
    # after it, the motion growing toward the tail tip like a whip
    "waveSpeed": 6.0,         # m/s (plus half the forward speed)
    "whip": 0.8,              # the tail tip's swing over the line's, beyond the hips (x per tail length)
    "heave": 0.06,            # m: the chest hauled up within each downstroke, ahead of the rest of him
    "tailDroop": 0.10,        # m: the tail hung below the line through its middle in flight
    # the legs hang loose: a half tuck they ease into, swung by the body's vertical acceleration through chained
    # springs (upper leg, then the lower leg, then the paw, each lagging the one above)
    "tuck": 0.42,             # 0 = trailing as at lift-off (jump_launch) .. 1 = jump_tuck
    "tuckTime": 1.1,          # s to ease into it after lift-off
    "swing": 0.022,           # tuck fraction per m/s^2 of vertical acceleration (+ = hauled up: the legs drag down)
    "legHz": (2.2, 1.7),      # spring frequency (front, hind): the hind legs are heavier and swing slower
    "legDamp": 0.35,
    "sideLag": 2,             # frames the right legs trail the left: not mirror-locked
}

CHEST_Y, CHEST_Z = A.SPINE[4][1][1], A.SPINE[4][1][2]     # the chest joint (the wings' root) at rest
PELVIS_Y, PELVIS_Z = A.SPINE[0][1][1], A.SPINE[0][1][2]
LEG_LEVEL = {"scapula": 0, "humerus": 0, "femur": 0, "radius": 1, "tibia": 1, "metacarpal": 2, "metatarsal": 2, "toes": 2}


def _ease(u):
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, u)))


def stroke(c, u):
    """Beat channels at beat phase u (0 = top of the stroke, the downstroke starting)."""
    u %= 1.0
    d = c["down"]
    if u < d:                                        # downstroke: spread, pronated, sweeping forward, loaded
        k = _ease(u / d)
        w = math.sin(math.pi * u / d)
        return {"elev": c["top"] + (c["bottom"] - c["top"]) * k,
                "sweep": c["sweepTop"] + (c["sweepBottom"] - c["sweepTop"]) * k,
                "fold": 0.0, "fan": 0.0, "twist": c["twistDown"] * w + c["twistUp"] * (1 - w) * 0.3 * (1 - k),
                "bend": c["bendDown"] * w}
    v = (u - d) / (1 - d)                            # upstroke: folded at the elbow, fan closed, supinated
    k = _ease(v)
    w = math.sin(math.pi * v)
    return {"elev": c["bottom"] + (c["top"] - c["bottom"]) * k,
            "sweep": c["sweepBottom"] + (c["sweepTop"] - c["sweepBottom"]) * k,
            "fold": c["foldMax"] * w, "fan": c["fanMax"] * w, "twist": c["twistUp"] * w, "bend": c["bendUp"] * w}


def downstroke_speed(c, u, du=1e-3):
    """How fast the wing is beating down (deg per beat fraction, >= 0)."""
    return max(0.0, (stroke(c, u - du)["elev"] - stroke(c, u + du)["elev"]) / (2 * du))


# ---- wing posing ------------------------------------------------------------------------------------------------------

def _rest_dirs(rig, sfx):
    b = rig.data.bones
    def d(n):
        x = b[n]
        return (x.tail_local - x.head_local).normalized()
    out = {"humerus": d(f"wing_humerus_{sfx}"), "forearm": d(f"wing_forearm_{sfx}"), "thumb": d(f"wing_thumb_{sfx}")}
    for i in range(1, RIBS + 1):
        out[f"rib{i}"] = d(f"wing_rib{i}_a_{sfx}")
    return out


def _mirror(v):
    return Vector((-v.x, v.y, v.z))


def _shoulder(s):
    """The stroke as a rotation about the shoulder (left wing): elevation about the long axis, then sweep."""
    return Matrix.Rotation(-math.radians(s["sweep"]), 3, "Z") @ Matrix.Rotation(-math.radians(s["elev"]), 3, "Y")


def wing_dirs(rig, ch):
    """Armature-space (direction, up) per wing bone of the LEFT wing for per-segment channels ch[seg] (seg = humerus,
    forearm, rib, tip). Up is the membrane normal, so each bone keeps its bind roll."""
    rest = _rest_dirs(rig, "L")
    N = Vector((0, 0, 1))
    out = {}
    s = ch["humerus"]
    Qh = _shoulder(s)
    out["humerus"] = (Qh @ (Matrix.Rotation(math.radians(0.25 * s["fold"]), 3, "Z") @ rest["humerus"]), Qh @ N)
    s = ch["forearm"]
    Qf = _shoulder(s)
    Fold = Matrix.Rotation(math.radians(s["fold"]), 3, "Z")             # the hand folds back about the membrane normal
    fore = Fold @ rest["forearm"]
    out["forearm"] = (Qf @ fore, Qf @ N)
    out["thumb"] = (Qf @ (Fold @ rest["thumb"]), Qf @ N)
    rib_angles = [math.degrees(math.atan2(rest[f"rib{i}"].y, rest[f"rib{i}"].x)) for i in range(1, RIBS + 1)]
    for i in range(1, RIBS + 1):
        sr, st = ch["rib"], ch["tip"]
        close = sr["fan"] * (rib_angles[-1] - rib_angles[i - 1]) * 0.75     # the fan closes toward the trailing rib
        d = Fold @ (Matrix.Rotation(math.radians(close), 3, "Z") @ rest[f"rib{i}"])
        T = Matrix.Rotation(math.radians(sr["twist"]), 3, fore)              # pronation about the leading edge
        d, n = T @ d, T @ N
        Qr = _shoulder(sr)
        load = st["bend"] * (0.45 + 0.55 * (RIBS - i + 1) / RIBS)           # the long leading ribs bend most
        axis = d.cross(n)
        tip = Matrix.Rotation(math.radians(load), 3, axis.normalized()) @ d if axis.length > 1e-6 else d.copy()
        root = Matrix.Rotation(math.radians(0.35 * load), 3, axis.normalized()) @ d if axis.length > 1e-6 else d.copy()
        Qt = _shoulder(st)
        out[f"rib{i}_a"] = (Qr @ root, Qr @ n)
        out[f"rib{i}_b"] = (Qt @ tip, Qt @ n)
    return out


def apply_wings(rig, ch):
    """Aim both wings (left from wing_dirs, right mirrored), parents first."""
    dirs = wing_dirs(rig, ch)
    order = ["humerus", "forearm", "thumb"] + [f"rib{i}_a" for i in range(1, RIBS + 1)] + [f"rib{i}_b" for i in range(1, RIBS + 1)]
    names = {"humerus": "wing_humerus", "forearm": "wing_forearm", "thumb": "wing_thumb"}
    for sfx, s in SIDES:
        for key in order:
            d, up = dirs[key]
            if s < 0:
                d, up = _mirror(d), _mirror(up)
            base = names.get(key) or f"wing_{key}"
            R.aim(rig, f"{base}_{sfx}", d, up)


def segment_channels(c, u):
    """Per-segment channels: each segment outboard lags the one inside it by c['lag'] of a beat."""
    lag = c["lag"]
    return {"humerus": stroke(c, u), "forearm": stroke(c, u - lag), "rib": stroke(c, u - 2 * lag), "tip": stroke(c, u - 3 * lag)}


# ---- the takeoff --------------------------------------------------------------------------------------------------

def _legs(pose):
    return {n: e for n, e in LIB.POSES[pose]["bones"].items() if n.startswith(LEG_PREFIX)}


def _mix(a, b, k):
    zero = (0.0, 0.0, 0.0)
    return {n: tuple(x + (y - x) * k for x, y in zip(a.get(n, zero), b.get(n, zero))) for n in set(a) | set(b)}


def _spring(state, target, hz, damp, dt):
    """One semi-implicit step of a damped spring [x, v] toward target."""
    w = 2 * math.pi * hz
    state[1] += (-w * w * (state[0] - target) - 2 * damp * w * state[1]) * dt
    state[0] += state[1] * dt
    return state[0]


def _leg_mix(launch, tuck, k_by_level):
    """Legs between jump_launch (0) and jump_tuck (1), each joint at the tuck fraction of its level (0 upper .. 2 paw)."""
    zero = (0.0, 0.0, 0.0)
    out = {}
    for n in set(launch) | set(tuck):
        part = n.split("_")[1]
        k = k_by_level[LEG_LEVEL.get(part, 1)]
        a, b = launch.get(n, zero), tuck.get(n, zero)
        out[n] = tuple(x + (y - x) * k for x, y in zip(a, b))
    return out


def takeoff_frames(c=TAKEOFF):
    """Per-frame takeoff: {"t", "x" forward (m), "root": (pelvis height, pitch), "bones": body + legs, "wing": per-segment
    channels or None while folded, "unfold": 0..1 from the folded wings to the flight pose, "chestZ": the chest joint's
    height, "lineW": 0..1 how far the spine and tail follow the body line (0 on the ground), "wave": its speed}."""
    rest_h = 1.02
    t_launch = c["windup"]
    t_beats = t_launch + c["first"]
    total = t_beats + c["beats"] * c["period"]
    n = int(round(total * FPS))
    crouch, launch, tuck = _legs("jump_crouch"), _legs("jump_launch"), _legs("jump_tuck")
    h, v, x = 0.0, 0.0, 0.0
    off = False
    t_off = None
    frames = []
    # chained leg springs per (front, hind): levels 0..2, each driven by the one above (level 0 by the acceleration)
    springs = {g: [[0.0, 0.0] for _ in range(3)] for g in ("front", "hind")}
    swing_hist = {g: [] for g in ("front", "hind")}
    lever = 0.0
    for f in range(n + 1):
        t = f / FPS
        dt = 1 / FPS
        accel = 0.0
        if t < t_launch:                               # wind-up: crouch, wings unfolding up to the top of the stroke
            k = _ease(t / t_launch)
            u = 0.0
            h = (0.78 - rest_h) * k
            legs = _mix({}, crouch, k)
            unfold = _ease(t / (0.8 * t_launch))
            pitch = -0.1 * k
        else:
            # beat phase: the first stroke is stretched over c["first"], then regular beats
            if t < t_beats:
                u = c["down"] * (t - t_launch) / c["first"]
            else:
                u = (c["down"] + (t - t_beats) / c["period"]) % 1.0      # regular beats, from the first upstroke on
            unfold = 1.0
            if not off:                                # the legs drive the body up until they leave the ground
                k = min(1.0, (t - t_launch) / 0.22)
                h = (0.78 - rest_h) + (1.5 - 0.78) * _ease(k)
                legs = _mix(crouch, launch, _ease(k))
                if k >= 1.0:
                    off = True
                    t_off = t
                    v = c["push"]
                pitch = -0.1 + 0.3 * _ease(k)
            else:                                      # airborne: the wings' lift against gravity
                rate = downstroke_speed(c, u) / (c["top"] - c["bottom"])      # 0..~2 (fraction of the stroke per beat)
                spread = 1.0 - stroke(c, u)["fold"] / c["foldMax"]
                per = c["first"] / c["down"] if t < t_beats else c["period"]
                accel = c["lift"] * (rate * c["down"]) ** 2 * spread * (0.78 / per) - G - c["drag"] * v
                v += accel * dt
                h += v * dt
                climb = _ease(min(1.0, (t - t_off) / 0.6))
                pitch = 0.2 + 0.18 * climb + 0.08 * math.sin(2 * math.pi * (u - 0.15))
                # the legs: ease into a loose half tuck; the body's vertical acceleration swings them through the
                # chained springs (a downstroke hauls him up and the legs drag down and back, then float up after)
                base = c["tuck"] * _ease(min(1.0, (t - t_off) / c["tuckTime"]))
                ks = {}
                for gi, g in enumerate(("front", "hind")):
                    hz = c["legHz"][gi]
                    drive = -c["swing"] * (accel + G)          # relative to hanging under 1 g
                    s0 = _spring(springs[g][0], drive, hz, c["legDamp"], dt)
                    s1 = _spring(springs[g][1], s0, hz * 1.3, c["legDamp"], dt)
                    s2 = _spring(springs[g][2], s1, hz * 1.6, c["legDamp"], dt)
                    swing_hist[g].append((s0, s1, s2))
                    ks[g] = (base, s0, s1, s2)
                legs = {}
                for g, prefix in (("front", "front_"), ("hind", "hind_")):
                    b0, s0, s1, s2 = ks[g]
                    hist = swing_hist[g]
                    for side in ("L", "R"):
                        lag = c["sideLag"] if side == "R" else 0
                        r0, r1, r2 = hist[max(0, len(hist) - 1 - lag)]
                        levels = [min(1.0, max(0.0, b0 + r0)), min(1.0, max(0.0, b0 + r1)), min(1.0, max(0.0, b0 + r2))]
                        part = _leg_mix({n: e for n, e in launch.items() if n.startswith(prefix) and n.endswith(side)},
                                        {n: e for n, e in tuck.items() if n.startswith(prefix) and n.endswith(side)}, levels)
                        legs.update(part)
        sp = c["forward"][0] + (c["forward"][1] - c["forward"][0]) * _ease((t - t_launch) / max(total - t_launch, 1e-6))
        x += sp * dt if t >= t_launch else 0.0
        ch = segment_channels(c, u)
        bones = dict(legs)
        heave = c["heave"] * math.sin(2 * math.pi * (u - 0.12)) * unfold if t >= t_launch else 0.0
        # on the ground the library shapes the spine (crouch, launch); in the air the body line takes over (apply_frame)
        neck_wave = 0.03 * unfold
        for k, nme in enumerate(("neck_01", "neck_02", "neck_03", "neck_04")):
            bones[nme] = (-0.7 * pitch / 4 + neck_wave * math.sin(2 * math.pi * (u - 0.3 - 0.06 * k)), 0, 0)
        bones["head"] = (-0.25 * pitch, 0, 0)
        line_w = _ease(min(1.0, (t - t_off) / 0.35)) if off else 0.0
        # the chest stands above the pelvis by the pitch's lever on the ground; in the air that lift-off offset is
        # kept and the line's delay makes the climbing pitch (the hips answer the chest's rise late)
        if not off or t_off == t:
            lever = (PELVIS_Y - CHEST_Y) * math.sin(pitch)
        chest_z = CHEST_Z + h + lever + heave
        frames.append({"t": t, "x": x, "root": (rest_h + h, pitch), "bones": bones, "wing": ch, "unfold": unfold,
                       "chestZ": chest_z, "lineW": line_w, "wave": c["waveSpeed"] + 0.5 * sp, "i": f, "tOff": t_off if off else t})
    # the airborne chest height carries on from the ground's: once off, chestZ is the body height plus the chest's
    # rest height (the pitch now comes out of the line), so join the two smoothly over the line's blend-in
    for fr in frames:
        if fr["lineW"] > 0:
            fr["root"] = (line_z(frames, fr["i"], PELVIS_Y, PELVIS_Z, c), fr["root"][1])
    return frames


def line_z(frames, i, y, z, c=TAKEOFF):
    """Height of the body line at rest point (y, z) (armature space, +Y behind) in frame i: the chest's height
    (y - CHEST_Y) / wave s ago, its swing amplified beyond the hips toward the tail tip, the tail hung below it."""
    fr = frames[i]
    d = max(0.0, y - CHEST_Y)
    td = max(fr["t"] - d / fr["wave"], fr.get("tOff", 0.0))   # the line starts at lift-off: no history before it
    k = max(0.0, td * FPS)
    k0 = min(int(k), len(frames) - 1)
    k1 = min(k0 + 1, len(frames) - 1)
    a = k - k0
    past = frames[k0]["chestZ"] * (1 - a) + frames[k1]["chestZ"] * a
    now = fr["chestZ"]
    tail_len = 3.4
    beyond = max(0.0, y - PELVIS_Y)
    whip = 1.0 + c["whip"] * min(1.0, beyond / tail_len)
    droop = c["tailDroop"] * math.sin(math.pi * min(1.0, beyond / (1.2 * tail_len)))
    return now + (past - now) * whip + (z - CHEST_Z) - droop


def _apply_line(rig, fr, frames):
    """Lay the pelvis, spine and tail along the body line (blended in by lineW from the library's ground pose): the
    pelvis takes its height and pitch from the line, every later bone hinges about local X to aim at its tail
    joint's target. The neck counters the chest's tilt so the head keeps near level."""
    import locomotion as L
    w = fr["lineW"]
    if w <= 0:
        return
    data = rig.data.bones
    pbs = rig.pose.bones
    frames_ = frames

    def target(rest, cur_z):
        return cur_z + (line_z(frames_, fr["i"], rest.y, rest.z) - cur_z) * w

    pr = data["pelvis"].head_local
    nxt = data["pelvis"].tail_local
    zp = target(pr, pbs["pelvis"].head.z)
    run = pr.y - nxt.y
    zt = target(nxt, pbs["pelvis"].tail.z)
    pitch = math.atan2(zt - zp, run) - math.atan2(nxt.z - pr.z, run)
    LIB.place_root(rig, zp, pitch)
    bpy.context.view_layer.update()
    for n in L.BODY_LINE[1:]:
        tail = data[n].tail_local
        pb = pbs[n]
        tz = target(tail, pb.tail.z)
        ty = pb.tail.y + (tail.y - pb.tail.y) * w
        aim = Vector((ty, tz)) - L._yz(pb.head)
        L._hinge(rig, n, aim.normalized())
    rest = data["chest"].tail_local - data["chest"].head_local
    cur = pbs["chest"].tail - pbs["chest"].head
    chest = math.atan2(cur.z, -cur.y) - math.atan2(rest.z, -rest.y)       # + = the chest tipped nose up
    for n in ("neck_01", "neck_02", "neck_03", "neck_04"):
        e = pbs[n].rotation_euler
        pbs[n].rotation_euler = (e[0] - w * 0.2 * chest, e[1], e[2])
    e = pbs["head"].rotation_euler
    pbs["head"].rotation_euler = (e[0] - w * 0.1 * chest, e[1], e[2])
    bpy.context.view_layer.update()


def apply_frame(rig, fr, folded_basis=None, frames=None):
    """Pose a takeoff frame: body from LIB.apply_pose (wings spread at bind), the spine and tail laid along the body
    line in the air (frames: the whole takeoff, for the line's history), then the wings aimed from their channels,
    slerped from the folded wings by `unfold` (folded_basis: bone -> quaternion, the library's folded pose)."""
    LIB.apply_pose(rig, {"root": fr["root"], "wings": (0.0, 0.0, 0.0), "bones": fr["bones"]})
    if frames is not None:
        _apply_line(rig, fr, frames)
    apply_wings(rig, fr["wing"])
    if folded_basis is not None and fr["unfold"] < 1.0:
        k = fr["unfold"]
        for name, q0 in folded_basis.items():
            pb = rig.pose.bones[name]
            q1 = pb.matrix_basis.to_quaternion()
            loc = pb.matrix_basis.to_translation()
            if q0.dot(q1) < 0:
                q1.negate()
            q = q0.slerp(q1, k)
            pb.matrix_basis = Matrix.Translation(loc) @ q.to_matrix().to_4x4()
        bpy.context.view_layer.update()


def folded_wing_basis(rig):
    """The library's folded wings (rig.fold_wings at 1) as bone -> basis quaternion, for the unfold blend."""
    R.reset_pose(rig)
    R.fold_wings(rig, 1.0)
    bpy.context.view_layer.update()
    out = {pb.name: pb.matrix_basis.to_quaternion() for pb in rig.pose.bones if pb.name.startswith(("wing_", "hipwing_"))}
    R.reset_pose(rig)
    return out
