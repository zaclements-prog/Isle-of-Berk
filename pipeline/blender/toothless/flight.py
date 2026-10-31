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
    "windup": 0.8,            # s: load (the crouch) + the pre-load dip, while the wings unfold and lift to the top
    "load": 0.65,             # s of it: the body sinks onto the planted paws, haunches loaded
    "unfold": (0.0, 0.78),    # s: the wings unfold over this window of the wind-up (the fold run backwards)
    "crouchH": 0.72, "dipH": 0.66,   # pelvis height (m) at the end of the load and at the bottom of the dip
    "offH": 1.30,             # pelvis height at toe-off: the hind legs at full extension, up on the toes
    "pushTime": 0.22,         # s: the legs' extension, inside the first downstroke's power phase
    "frontRelease": 0.3,      # fraction of the push at which the fore paws leave (the chest rises first, before the
                              # fore legs lock out)
    "ikFade": 0.3,            # s: a released leg eases from the ground solve into its airborne pose
    "lineBlend": 0.8,         # s: after toe-off the body line takes over from the launch pose
    "first": 0.55,            # s: the first downstroke (longer, the legs push off under it)
    "period": 0.78,           # s: a climbing beat (~1.3 Hz for a 13.6 m span)
    "down": 0.56,             # fraction of a beat spent on the downstroke
    "beats": 5,               # after the first stroke
    "lift": 19.0,             # m/s^2 at full downstroke speed (scaled by spread): sets the climb
    "drag": 1.6,              # 1/s: vertical air damping
    "push": 3.2,              # m/s: vertical speed the legs give at toe-off
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
    "waveSpeed": 6.0,         # m/s (plus a fifth of the forward speed): the hips answer the shoulders ~0.2 s late
                              # (the first downstroke yanks the chest up fast; a slower wave would leave the tail hanging)
    "trunkGain": 0.3,         # the swing grows this much from the shoulders to the hips (the trunk hangs from them)
    "whip": 0.8,              # the tail tip's swing over the line's, beyond the hips (x per tail length)
    "heave": 0.06,            # m: the chest hauled up within each downstroke, ahead of the rest of him
    "tailDroop": 0.10,        # m: the tail hung below the line through its middle in flight
    # the legs hang loose: a half tuck they ease into, swung by the body's vertical acceleration through chained
    # springs (upper leg, then the lower leg, then the paw, each lagging the one above)
    "tuck": (0.3, 0.42),      # front, hind: 0 = trailing as at lift-off (jump_launch) .. 1 = jump_tuck
    "tuckTime": 1.1,          # s to ease into it after lift-off
    "swing": 0.006,           # tuck fraction per m/s^2 of vertical acceleration (+ = hauled up: the legs drag down)
    "legHz": (2.2, 1.7),      # spring frequency (front, hind): the hind legs are heavier and swing slower
    "legDamp": 0.7,
    "sideLag": 2,             # frames the right legs trail the left: not mirror-locked
    # the fore paws hang relaxed: the wrist flexed so the paw drops toward the palm, the toes loosely curled (not the
    # launch's extended wrist, which reads as a paw pressed flat on a floor); the paw spring swings the wrist a little
    "frontHang": {"scapula": 0.0, "humerus": -0.2, "radius": 0.5, "metacarpal": -1.3, "toes": 0.5},
                              # rad: the fore legs hanging relaxed in the air (upper arm a little back, elbow softly
                              # bent, wrist dropped toward the palm (- on this rig: + bends the paw back), toes curled)
    # the fore legs hang on springs that answer the forces of flight (each joint a damped spring about its hang angle;
    # loose, not limp): the shoulder's vertical acceleration (the body hauled up on each downstroke, the chest heaving)
    # swings the upper arm back and opens the elbow; nose-up pitch leaves a hanging arm pointing part way back toward
    # the ground; the airflow trails the paws back; the forearm and wrist are driven by the joint above's swing, so each
    # follows it late, like a whip
    "armHz": (1.9, 2.5, 3.2),        # upper arm, forearm, wrist
    "armDamp": 0.42,
    "armAccel": (0.011, 0.007),      # rad per m/s^2 of shoulder acceleration: upper arm back, elbow open
    "armGravity": 0.65,              # share of the body's pitch change the hanging arm cancels (1 = fully plumb)
    "armDrag": 0.04,                 # rad back per m/s of forward speed
    "armFollow": (0.45, 0.8),         # forearm, wrist: rad / (rad/s) of the joint above's swing velocity, trailing it
}

CHEST_Y, CHEST_Z = A.SPINE[4][1][1], A.SPINE[4][1][2]     # the chest joint (the wings' root) at rest
PELVIS_Y, PELVIS_Z = A.SPINE[0][1][1], A.SPINE[0][1][2]
# the anchor: the wing root on the shoulder blades. The wings hold him up from there, so the body's motion starts at
# the shoulders and runs back through the spine to the hips and the tail, and forward up the neck
ANCHOR_Y = A.MAIN_WING_L["root"][1]
TOE_REST = {"front": (A.FRONT_LEG_L["toe"][1], A.FRONT_LEG_L["toe"][2]), "hind": (A.HIND_LEG_L["toe"][1], A.HIND_LEG_L["toe"][2])}
TAIL_LEN = 3.4


def wave_height(d, past, now, c):
    """Body-line height offset of a point d m behind the anchor (d < 0: ahead of it, toward the neck), given the
    anchor's height when this point's delay began (`past`) and now: the point repeats the shoulders' motion late, its
    swing growing toward the hips (the trunk hangs from the shoulders) and on along the tail (the whip); ahead of the
    shoulders the neck base follows at half strength. c: trunkGain, whip, tailDroop."""
    trunk = PELVIS_Y - ANCHOR_Y
    if d < 0:
        gain = 0.5
    else:
        gain = 1.0 + c.get("trunkGain", 0.0) * min(1.0, d / trunk) + c["whip"] * min(1.0, max(0.0, d - trunk) / TAIL_LEN)
    beyond = max(0.0, d - trunk)
    droop = c["tailDroop"] * math.sin(math.pi * min(1.0, beyond / (1.2 * TAIL_LEN)))
    # a soft limit on how far a point lags the shoulders (more room toward the tail tip): a sudden haul (the takeoff's
    # first downstroke) bends the body and swings the tail, instead of leaving them hanging straight down
    raw = (past - now) * gain
    room = 0.25 + 0.15 * min(1.0, max(0.0, d) / trunk) + 0.35 * min(1.0, beyond / TAIL_LEN)
    return room * math.tanh(raw / room) - droop
ARM_LIMITS = {"humerus": (-1.1, 0.9), "radius": (-0.5, 1.9), "metacarpal": (-1.5, 1.5), "toes": (-1.3, 1.3)}  # rad, inside anatomy.LIMBS
LEG_LEVEL = {"scapula": 0, "humerus": 0, "femur": 0, "radius": 1, "tibia": 1, "metacarpal": 2, "metatarsal": 2, "toes": 2}


def _ease(u):
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, u)))


def stroke(c, u):
    """Beat channels at beat phase u (0 = top of the stroke, the downstroke starting)."""
    u %= 1.0
    d = c["down"]
    if u < d:                                        # downstroke: spread, pronated, sweeping forward, loaded
        k = _ease(u / d)
        w = math.sin(math.pi * u / d) ** 2          # squared: the loading eases in and out at the turnarounds
        return {"elev": c["top"] + (c["bottom"] - c["top"]) * k,
                "sweep": c["sweepTop"] + (c["sweepBottom"] - c["sweepTop"]) * k,
                "fold": 0.0, "fan": 0.0, "twist": c["twistDown"] * w + c["twistUp"] * (1 - w) * 0.3 * (1 - k),
                "bend": c["bendDown"] * w}
    v = (u - d) / (1 - d)                            # upstroke: folded at the elbow, fan closed, supinated
    k = _ease(v)
    w = math.sin(math.pi * v) ** 2
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


def _lerp(a, b, k):
    return a + (b - a) * k


def _hermite01(p0, p1, m0, m1, u):
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1


def _body_of(pose):
    """A library pose's spine / chest / tail rotations (no legs, no neck or head)."""
    return {n: e for n, e in LIB.POSES[pose]["bones"].items()
            if n.startswith(("spine_", "chest", "tail_"))}


def ground_legs(c, t):
    """The legs on the ground through the load, the dip and the push: per leg (ik weight, toe-tip target (y, z) in the
    world frame of the start, distal deg, toes deg, scapula deg or None). The paws stay planted while the body sinks
    (hocks dropping, elbows bending), then the push lifts the heels and rolls the paws onto the toes; the fore paws
    release first, the hind toes leave last at toe-off."""
    t_push = c["windup"]
    out = {}
    load = _ease(min(1.0, t / c["load"]))
    dip = _ease(max(0.0, min(1.0, (t - c["load"]) / (t_push - c["load"]))))
    kp = max(0.0, (t - t_push) / c["pushTime"])           # push progress (> 1 after toe-off)
    for kind in ("front", "hind"):
        toe0 = TOE_REST[kind]
        if kind == "hind":
            distal = _lerp(_lerp(31, 52, load), 58, dip)
            toes = _lerp(79, 84, load)
            if kp > 0:
                distal = _lerp(distal, 2, _ease(min(1.0, kp)) ** 1.4)          # the heel lifts through the push
                toes = _lerp(toes, 35, _ease(max(0.0, min(1.0, (kp - 0.55) / 0.45))))   # up onto the toe tips
            release = 1.0
            scap = None
        else:
            distal = _lerp(_lerp(45, 52, load), 55, dip)
            toes = _lerp(79, 82, load)
            scap = _lerp(_lerp(0, -6, load), -8, dip)
            release = c["frontRelease"]
            if kp > 0:
                k = _ease(min(1.0, kp / release))
                distal = _lerp(distal, 25, k)
                toes = _lerp(toes, 50, k)
                scap = _lerp(scap, 10, k)
        t_rel = t_push + release * c["pushTime"]
        fade = c["ikFade"] * (1.5 if kind == "front" else 1.0)     # the fore legs swing further into their air pose
        w = 1.0 if t <= t_rel else 1.0 - _ease(min(1.0, (t - t_rel) / fade))
        for side in ("L", "R"):
            out[f"{kind}_{side}"] = (w, toe0, distal, toes, scap)
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
    rel_state = {}
    arm_state = {side: {n: [0.0, 0.0] for n in ("humerus", "radius", "metacarpal")} for side in ("L", "R")}
    arm_in = []
    pitch_prev, pitch_off = None, 0.0
    for f in range(n + 1):
        t = f / FPS
        dt = 1 / FPS
        accel = 0.0
        crouch_body, launch_body = _body_of("jump_crouch"), _body_of("jump_launch")
        body = {}
        if t < t_launch:                               # load, then the pre-load dip: the paws planted, the body sinking
            u = 0.0
            load = _ease(min(1.0, t / c["load"]))
            dip = _ease(max(0.0, min(1.0, (t - c["load"]) / (t_launch - c["load"]))))
            h = _lerp(_lerp(0.0, c["crouchH"] - rest_h, load), c["dipH"] - rest_h, dip)
            legs = _mix({}, crouch, load)
            body = _mix({}, crouch_body, min(1.0, load + 0.3 * dip))
            u0, u1 = c["unfold"]
            unfold = max(0.0, min(1.0, (t - u0) / (u1 - u0)))
            pitch = _lerp(_lerp(0.0, -0.04, load), -0.06, dip)
        else:
            # beat phase: the first stroke is stretched over c["first"], then regular beats
            if t < t_beats:
                u = c["down"] * (t - t_launch) / c["first"]
            else:
                u = (c["down"] + (t - t_beats) / c["period"]) % 1.0      # regular beats, from the first upstroke on
            unfold = 1.0
            if not off:                                # the push, with the first downstroke: the legs drive him up
                k = min(1.0, (t - t_launch) / c["pushTime"])
                rise = c["offH"] - c["dipH"]
                h = c["dipH"] - rest_h + _hermite01(0.0, rise, 0.0, c["push"] * c["pushTime"], k)
                legs = _mix(crouch, launch, _ease(k))
                body = _mix(crouch_body, launch_body, _ease(k))
                if k >= 1.0:
                    off = True
                    t_off = t
                    v = c["push"]
                pitch = -0.06 + 0.31 * _ease(min(1.0, k / 0.8))      # the chest rises first: the fore paws leave early
            else:                                      # airborne: the wings' lift against gravity
                rate = downstroke_speed(c, u) / (c["top"] - c["bottom"])      # 0..~2 (fraction of the stroke per beat)
                spread = 1.0 - stroke(c, u)["fold"] / c["foldMax"]
                per = c["first"] / c["down"] if t < t_beats else c["period"]
                accel = c["lift"] * (rate * c["down"]) ** 2 * spread * (0.78 / per) - G - c["drag"] * v
                v += accel * dt
                h += v * dt
                body = _mix(launch_body, {}, _ease(min(1.0, (t - t_off) / c["lineBlend"])))
                climb = _ease(min(1.0, (t - t_off) / 0.6))
                pitch = 0.2 + 0.18 * climb + 0.08 * math.sin(2 * math.pi * (u - 0.15))
                # the legs: ease into a loose half tuck; the body's vertical acceleration swings them through the
                # chained springs (a downstroke hauls him up and the legs drag down and back, then float up after)
                ease_in = _ease(min(1.0, (t - t_off) / c["tuckTime"]))
                ks = {}
                for gi, g in enumerate(("front", "hind")):
                    hz = c["legHz"][gi]
                    drive = -c["swing"] * accel                # about the steady climb (the base tuck hangs under it)
                    s0 = _spring(springs[g][0], drive, hz, c["legDamp"], dt)
                    s1 = _spring(springs[g][1], s0, hz * 1.3, c["legDamp"], dt)
                    s2 = _spring(springs[g][2], s1, hz * 1.6, c["legDamp"], dt)
                    swing_hist[g].append((s0, s1, s2))
                    ks[g] = (c["tuck"][gi] * ease_in, s0, s1, s2)
                # the fore arms: forces at the shoulder -> chained springs, the right arm fed the left's inputs late
                sp_now = c["forward"][0] + (c["forward"][1] - c["forward"][0]) * _ease((t - t_launch) / max(total - t_launch, 1e-6))
                heave_acc = -c["heave"] * (2 * math.pi / c["period"]) ** 2 * math.sin(2 * math.pi * (u - 0.12))
                a_sh = accel + heave_acc
                d_pitch = pitch - (pitch_prev if pitch_prev is not None else pitch)
                pitch_prev = pitch
                pitch_off += d_pitch
                arm_in.append((a_sh, pitch_off, sp_now))
                arm_out = {}
                for side in ("L", "R"):
                    lag = c["sideLag"] if side == "R" else 0
                    a_i, p_i, v_i = arm_in[max(0, len(arm_in) - 1 - lag)]
                    st = arm_state[side]
                    hz, dmp = c["armHz"], c["armDamp"]
                    hum_t = -c["armAccel"][0] * a_i + c["armGravity"] * p_i - c["armDrag"] * v_i
                    hum_prev_v = st["humerus"][1]
                    hum = _spring(st["humerus"], hum_t, hz[0], dmp, dt)
                    rad_t = -c["armAccel"][1] * a_i + c["armFollow"][0] * st["humerus"][1] / (2 * math.pi * hz[0])
                    rad = _spring(st["radius"], rad_t, hz[1], dmp, dt)
                    mc_t = -c["armFollow"][1] * st["radius"][1] / (2 * math.pi * hz[1])
                    mc = _spring(st["metacarpal"], mc_t, hz[2], dmp, dt)
                    arm_out[side] = {"humerus": hum, "radius": rad, "metacarpal": mc, "toes": -0.4 * mc}
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
                        if g == "front":
                            for part_name, val in c["frontHang"].items():
                                bone = f"front_{part_name}_{side}"
                                a = launch.get(bone, (0.0, 0.0, 0.0))
                                dev = arm_out[side].get(part_name, 0.0)
                                lo, hi = ARM_LIMITS.get(part_name, (-3.0, 3.0))
                                legs[bone] = (a[0] + (min(hi, max(lo, val + dev)) - a[0]) * ease_in, 0.0, 0.0)
        sp = c["forward"][0] + (c["forward"][1] - c["forward"][0]) * _ease((t - t_launch) / max(total - t_launch, 1e-6))
        x += sp * dt if t >= t_launch else 0.0
        ch = segment_channels(c, u)
        bones = dict(body)
        bones.update(legs)
        heave = c["heave"] * math.sin(2 * math.pi * (u - 0.12)) * unfold if t >= t_launch else 0.0
        # on the ground the library shapes the spine (crouch, launch); in the air the body line takes over (apply_frame)
        neck_wave = 0.03 * unfold
        for k, nme in enumerate(("neck_01", "neck_02", "neck_03", "neck_04")):
            bones[nme] = (-0.7 * pitch / 4 + neck_wave * math.sin(2 * math.pi * (u - 0.3 - 0.06 * k)), 0, 0)
        bones["head"] = (-0.25 * pitch, 0, 0)
        line_w = _ease(min(1.0, (t - t_off) / c["lineBlend"])) if off else 0.0
        # the chest stands above the pelvis by the pitch's lever on the ground; in the air that lift-off offset is
        # kept and the line's delay makes the climbing pitch (the hips answer the chest's rise late)
        # the chest track the body line follows (only its history from toe-off on is used): the body's height and the
        # heave. The lift-off attitude rides on as a lean that hands over to the pitch the climb's own lag makes
        if off and t_off == t:
            lever = pitch
        lean = lever * (1.0 - _ease(min(1.0, (t - t_off) / 0.8))) if off else 0.0
        chest_z = CHEST_Z + h + heave
        leg_ik = {}
        for k_, v_ in ground_legs(c, t).items():
            if v_[0] <= 0:
                continue
            kind_ = k_.split("_")[0]
            t_rel = t_launch + (c["frontRelease"] if kind_ == "front" else 1.0) * c["pushTime"]
            if t >= t_rel:
                # a released paw goes with the body (its target carried by the body's travel and rise since release),
                # so the fading solve doesn't drag the leg back toward the spot it left
                if kind_ not in rel_state:
                    rel_state[kind_] = (x, rest_h + h)
                x_r, h_r = rel_state[kind_]
                toe_ = (v_[1][0] + x_r - x, v_[1][1] + (rest_h + h) - h_r)
                v_ = (v_[0], toe_) + tuple(v_[2:])
            leg_ik[k_] = v_
        frames.append({"t": t, "x": x, "root": (rest_h + h, pitch), "bodyH": rest_h + h, "heave": heave, "pitch": pitch,
                       "legIK": leg_ik,
                       "bones": bones, "wing": ch, "unfold": unfold,
                       "chestZ": chest_z, "lineW": line_w, "wave": c["waveSpeed"] + 0.2 * sp, "i": f, "tOff": t_off if off else t, "lean": lean})
    return frames


def line_z(frames, i, y, z, c=TAKEOFF):
    """Height of the body line at rest point (y, z) (armature space, +Y behind) in frame i: the anchor's (shoulders')
    height |y - ANCHOR_Y| / wave s ago, shaped by wave_height. chestZ is the anchor's height track."""
    fr = frames[i]
    d = y - ANCHOR_Y
    td = max(fr["t"] - abs(d) / fr["wave"], fr.get("tOff", 0.0))   # the line starts at lift-off: no history before it
    k = max(0.0, td * FPS)
    k0 = min(int(k), len(frames) - 1)
    k1 = min(k0 + 1, len(frames) - 1)
    a = k - k0
    past = frames[k0]["chestZ"] * (1 - a) + frames[k1]["chestZ"] * a
    now = fr["chestZ"]
    # the lean pivots at the pelvis, as the ground pose's pitch does (place_root), so the two agree as the line blends in
    return now + wave_height(d, past, now, c) + (z - CHEST_Z) + fr.get("lean", 0.0) * (PELVIS_Y - y)


def _apply_line(rig, fr, frames, line_fn=None, head_z=None):
    """Lay the pelvis, spine and tail along the body line (blended in by lineW from the library's ground pose; line_fn:
    (rest y, rest z) -> height, in place of the takeoff's line_z): the
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
        z = line_fn(rest.y, rest.z) if line_fn else line_z(frames_, fr["i"], rest.y, rest.z)
        return cur_z + (z - cur_z) * w

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
    if head_z is not None:
        # the head rides a steady line: the neck soaks up the shoulders' rise and fall (the run cycles' leveller)
        bones = {n: tuple(pbs[n].rotation_euler) for n in ("neck_01", "neck_02", "head")}
        cur = pbs["head"].head.z
        L._level_head(rig, bones, cur + (head_z - cur) * w)


def apply_frame(rig, fr, folded_basis=None, frames=None, body_fn=None):
    """Pose a takeoff frame: body from LIB.apply_pose (wings spread at bind), the spine and tail laid along the body
    line in the air (frames: the whole takeoff, for the line's history), then the wings aimed from their channels,
    slerped from the folded wings by `unfold` (folded_basis: bone -> quaternion, the library's folded pose)."""
    LIB.apply_pose(rig, {"root": fr["root"], "wings": (0.0, 0.0, 0.0), "bones": fr["bones"]})
    if body_fn is not None:
        body_fn(rig, fr)
    elif frames is not None:
        i = fr["i"]
        span = int(TAKEOFF["period"] * FPS)
        win = [frames[k]["chestZ"] for k in range(max(0, i - span), i + 1)]
        steady = sum(win) / len(win)
        head_rest = rig.data.bones["head"].head_local.z
        _apply_line(rig, fr, frames, head_z=head_rest + (steady - CHEST_Z) + 0.25 * (fr["chestZ"] - steady))
    apply_ground_legs(rig, fr)
    if folded_basis is not None and fr["unfold"] < 1.0:
        pose_unfold(rig, fr["unfold"], fr["wing"], folded_basis)
    else:
        apply_wings(rig, fr["wing"])


# the unfold: groups outboard from the shoulder, each starting a little after the one inside it
UNFOLD_GROUPS = (("humerus", 0.0), ("forearm", 0.05), ("ribs_a", 0.1), ("ribs_b", 0.15))


def _group_bones(group, sfx):
    if group == "humerus":
        return [f"wing_humerus_{sfx}"]
    if group == "forearm":
        return [f"wing_forearm_{sfx}", f"wing_thumb_{sfx}"]
    part = "a" if group == "ribs_a" else "b"
    return [f"wing_rib{i}_{part}_{sfx}" for i in range(1, RIBS + 1)]


def _fold_frames(rig, arm, hinges, names):
    """Armature-space bone frames (quaternions) along the fan-fold (rig.fold_wings' geometry) with the arm's fold
    `arm` (0 spread .. 1 folded: the humerus, forearm and every rib's inner half swinging back) and each doubled rib's
    outer-half hinge separate (hinges[i]: 0 straight .. 1 doubled forward over the bundle), so the tips can open at
    their own, slower pace. Left side; the right is mirrored. Poses the wing bones as a side effect."""
    pbs = rig.pose.bones
    for n in names:
        pbs[n].matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    up = Vector((0, 0, 1))
    for s, sfx in ((1, "L"), (-1, "R")):
        side = lambda v: Vector((s * v[0], v[1], v[2]))

        def mix(bone, target):
            return R.rest_dir(rig, bone).lerp(side(target).normalized(), arm)
        R.aim(rig, f"wing_humerus_{sfx}", mix(f"wing_humerus_{sfx}", R.FOLD_HUMERUS))
        R.aim(rig, f"wing_forearm_{sfx}", mix(f"wing_forearm_{sfx}", R.FOLD_FOREARM))
        for i in range(RIBS):
            inner, outer = f"wing_rib{i + 1}_a_{sfx}", f"wing_rib{i + 1}_b_{sfx}"
            back = mix(inner, R._rib_back(i))
            R.aim(rig, inner, back)
            if i < R.DOUBLED_RIBS:
                q = R.tip_fold(R._frame(back, up).to_quaternion(), s, hinges[i])
                R.aim(rig, outer, q @ Vector((0, 1, 0)), up=q @ Vector((0, 0, 1)))
            else:
                R.aim(rig, outer, back)
    return {n: pbs[n].matrix.to_quaternion() for n in names}


def pose_unfold(rig, k, ch, folded_basis):
    """Wings between folded (k = 0) and their stroke pose for channels ch (k = 1) along the fold's own path: the
    fan-fold (rig.fold_wings) run backwards, the arm swinging out of its tuck and the ribs fanning open, then a rise
    into the stroke; each group outboard from the shoulder starts a little later, so the shoulder leads and the fan
    follows, and folding (k falling) runs it back with the fan closing first and the arm tucking last. Bone frames are
    interpolated in armature space (direction and membrane normal together) and aimed parent first. The hip wings
    take the plain slerp from their folded pose."""
    pbs = rig.pose.bones
    names = [n for g, _ in UNFOLD_GROUPS for sfx in ("L", "R") for n in _group_bones(g, sfx)]
    apply_wings(rig, ch)
    target = {n: pbs[n].matrix.to_quaternion() for n in names}
    hip_target = {n: pbs[n].matrix_basis.to_quaternion() for n in folded_basis if n.startswith("hipwing_")}
    span = 1.0 - UNFOLD_GROUPS[-1][1]
    # the doubled rib tips unhinge over most of the unfold, shortest rib first and the long leading rib last (a
    # ripple), instead of flipping over as a block in a sixth of a second
    hinges = []
    for i in range(RIBS):
        lag = 0.04 * (R.DOUBLED_RIBS - 1 - i) if i < R.DOUBLED_RIBS else 0.0
        hinges.append(1.0 - _ease(max(0.0, min(1.0, (k - lag) / 0.88))))
    plan = {}
    cache = {}
    for g, delay in UNFOLD_GROUPS:
        kg = max(0.0, min(1.0, (k - delay) / span))
        arm = round(1.0 - _ease(min(1.0, kg / 0.75)), 4)               # the arm swinging out of its tuck
        rise = _ease(max(0.0, min(1.0, (kg - 0.55) / 0.45)))            # then settle into the exact stroke pose
        if arm not in cache:
            cache[arm] = _fold_frames(rig, arm, hinges, names)
        # the fold path is carried up about the shoulder as it opens (toward the stroke's top elevation), so the wing
        # opens straight into a raised spread instead of out to the flat bind spread and back up again
        lift = math.radians(TAKEOFF["top"]) * _ease(min(1.0, kg / 0.75))
        for sfx, sgn in (("L", -1.0), ("R", 1.0)):
            q_up = Quaternion((0.0, 1.0, 0.0), sgn * lift)
            for n in _group_bones(g, sfx):
                plan[n] = (q_up @ cache[arm][n], rise)
    order = [n for sfx in ("L", "R") for g in ("humerus", "forearm", "ribs_a", "ribs_b") for n in _group_bones(g, sfx)]
    for n in order:
        q0, rise = plan[n]
        q1 = target[n].copy()
        if q0.dot(q1) < 0:
            q1.negate()
        q = q0.slerp(q1, rise)
        R.aim(rig, n, q @ Vector((0.0, 1.0, 0.0)), q @ Vector((0.0, 0.0, 1.0)))
    for n, q0 in folded_basis.items():
        if not n.startswith("hipwing_"):
            continue
        pb = pbs[n]
        q1 = hip_target[n].copy()
        if q0.dot(q1) < 0:
            q1.negate()
        loc = pb.matrix_basis.to_translation()
        pb.matrix_basis = Matrix.Translation(loc) @ q0.slerp(q1, _ease(k)).to_matrix().to_4x4()
    bpy.context.view_layer.update()


def apply_ground_legs(rig, fr):
    """Close the planted / pushing legs onto their toe-tip targets (the run cycles' leg solve), blended over the
    frame's airborne leg pose by each leg's ik weight. The targets stay put in the world: the rig travels by x."""
    import locomotion as L
    ik = fr.get("legIK") or {}
    if not ik:
        return
    pbs = rig.pose.bones
    for key, (w, toe, distal, toes, scap) in ik.items():
        kind, side = key.split("_")
        names = [f"{n}_{side}" for n in L.CHAINS[kind]] + ([f"front_scapula_{side}"] if kind == "front" else [])
        cur = {n: pbs[n].rotation_euler[0] for n in names}
        sol, _miss = L.solve_leg(rig, kind, side, (toe[0] + fr["x"], toe[1]), distal, toes, scap)
        for n, e in sol.items():
            pbs[n].rotation_euler = (cur[n] + (e[0] - cur[n]) * w, 0.0, 0.0)
        bpy.context.view_layer.update()


def folded_wing_basis(rig):
    """The library's folded wings (rig.fold_wings at 1) as bone -> basis quaternion, for the unfold blend."""
    R.reset_pose(rig)
    R.fold_wings(rig, 1.0)
    bpy.context.view_layer.update()
    out = {pb.name: pb.matrix_basis.to_quaternion() for pb in rig.pose.bones if pb.name.startswith(("wing_", "hipwing_"))}
    R.reset_pose(rig)
    return out
