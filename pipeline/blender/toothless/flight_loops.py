"""Authored flight loops (flight, Phase 2 groundwork): a cruising flap and a glide, each one seamless loop.

Both reuse the takeoff's machinery (flight.py): the wings posed by direction from per-segment beat channels with the
outboard segments lagging (the whip), the body line (the spine and tail follow the chest's path through the air, a point
d m behind the chest where the chest was d / wave s ago, the swing growing toward the tail tip), and the fore arms hung
on chained springs answering the forces at the shoulder.

Loops: every channel is periodic in the cycle phase. The chest's height comes from the wing's lift over one cycle
(zero-mean, integrated twice, so the body rises on the downstroke and sags on the upstroke and returns exactly), the
body line samples that history around the loop, and the arm springs are run for several cycles and the last, settled
cycle kept, its end eased into its start so the loop has no seam.

- FLAP: level cruise, ~1.1 Hz. A shallower stroke than the takeoff's climbing beats, the chest hauled up on each
  downstroke and the hips and tail answering after it; the hind legs trailing back streamlined, the fore arms hanging
  on their springs.
- GLIDE: wings held spread with a little dihedral, the membrane loaded and the tips flexing in the air; a slow
  breathing bob, the tail swaying as a rudder, the legs streamlined. A 4 s loop.
"""
import math
import bpy
from mathutils import Vector
import flight as F
import library as LIB

FPS = F.FPS

FLAP = {
    "period": 0.9, "down": 0.52,
    "top": 48.0, "bottom": -30.0, "sweepTop": -10.0, "sweepBottom": 8.0,
    "foldMax": 44.0, "fanMax": 0.35, "twistDown": 10.0, "twistUp": -18.0, "bendDown": 14.0, "bendUp": -6.0,
    "lag": 0.04,
    "speed": 12.0,            # m/s forward (the preview's travel; the body line's wave runs at it)
    "bob": 0.09,              # m: the chest's rise and sag over a beat (peak to peak about twice this)
    "heave": 0.03,            # m: the chest's extra lift inside the downstroke, ahead of the body
    "pitch": 0.06,            # rad: cruise attitude, nose a little up
    "whip": 0.9, "tailDroop": 0.06,
    "hindTrail": 0.85,        # share of jump_launch's trailing hind legs (streamlined)
    "altitude": 3.0,          # m: pelvis height in the preview
}

GLIDE = {
    "period": 4.0,
    "elev": 8.0, "sweep": -4.0, "fold": 6.0, "twist": 3.0, "bend": 9.0,     # the held wing (deg)
    "elevBreath": 2.5,        # deg: a slow rise and settle of the wings over the loop
    "flutter": (3.0, 3, 0.15),  # deg, harmonic, lag per segment: the tips and membrane flexing in the air
    "speed": 15.0, "bob": 0.04, "pitch": 0.03,
    "tailSway": 0.05,         # rad per tail bone: a slow rudder S
    "whip": 0.6, "tailDroop": 0.03,
    "hindTrail": 1.0,
    "altitude": 3.5,
}


def _periodic_lift_height(c, n):
    """The chest's height offset over one flap cycle (n samples): lift ~ (downstroke speed)^2 x spread, zero-mean,
    integrated twice with zero-mean velocity and height, scaled to c['bob']."""
    acc = []
    for k in range(n):
        u = k / n
        rate = F.downstroke_speed(c, u) / (c["top"] - c["bottom"])
        spread = 1.0 - F.stroke(c, u)["fold"] / c["foldMax"]
        acc.append((rate * c["down"]) ** 2 * spread)
    m = sum(acc) / n
    acc = [a - m for a in acc]
    vel, v = [], 0.0
    for a in acc:
        v += a
        vel.append(v)
    mv = sum(vel) / n
    h, z = [], 0.0
    for x in vel:
        z += x - mv
        h.append(z)
    mh = sum(h) / n
    h = [y - mh for y in h]
    amp = max(abs(y) for y in h) or 1.0
    return [c["bob"] * y / amp for y in h], [a * (c["bob"] / amp) * (n / c["period"]) ** 2 for a in acc]


def _arm_springs(accels, pitches, speed, n):
    """Run the takeoff's fore-arm spring chain over 4 cycles of the periodic shoulder acceleration and pitch; return
    the last cycle per side as [{humerus, radius, metacarpal, toes}] * n, its last 6 frames eased into its first."""
    c = F.TAKEOFF
    st = {s: {k: [0.0, 0.0] for k in ("humerus", "radius", "metacarpal")} for s in ("L", "R")}
    dt = 1 / FPS
    out = {"L": [], "R": []}
    cycles = 4
    for it in range(cycles * n):
        k = it % n
        for side in ("L", "R"):
            kk = (k - (c["sideLag"] if side == "R" else 0)) % n
            a_i, p_i = accels[kk], pitches[kk]
            s = st[side]
            hz, dmp = c["armHz"], c["armDamp"]
            hum = F._spring(s["humerus"], -c["armAccel"][0] * a_i + c["armGravity"] * p_i - c["armDrag"] * speed * 0.25,
                            hz[0], dmp, dt)
            rad = F._spring(s["radius"], -c["armAccel"][1] * a_i + c["armFollow"][0] * s["humerus"][1] / (2 * math.pi * hz[0]),
                            hz[1], dmp, dt)
            mc = F._spring(s["metacarpal"], -c["armFollow"][1] * s["radius"][1] / (2 * math.pi * hz[1]), hz[2], dmp, dt)
            if it >= (cycles - 1) * n:
                out[side].append({"humerus": hum, "radius": rad, "metacarpal": mc, "toes": -0.4 * mc})
    for side in ("L", "R"):                       # seam: ease the last frames into the first
        seq = out[side]
        for j in range(6):
            w = (j + 1) / 7
            idx = n - 6 + j
            seq[idx] = {key: seq[idx][key] * (1 - w) + seq[0][key] * w for key in seq[idx]}
    return out


def _arms(arm_dev):
    """Fore-arm bones from the relaxed hang plus a spring deviation per side."""
    c = F.TAKEOFF
    bones = {}
    for side in ("L", "R"):
        for part, val in c["frontHang"].items():
            lo, hi = F.ARM_LIMITS.get(part, (-3.0, 3.0))
            bones[f"front_{part}_{side}"] = (min(hi, max(lo, val + arm_dev[side].get(part, 0.0))), 0.0, 0.0)
    return bones


def _hind(trail):
    launch = F._legs("jump_launch")
    return {n: tuple(trail * x for x in e) for n, e in launch.items() if n.startswith("hind_")}


def _frames(c, n, chest, wings, pitch_osc, tail_yaw):
    frames = []
    for k in range(n):
        u = k / n
        frames.append({"t": k / FPS, "u": u, "x": c["speed"] * k / FPS, "root": (c["altitude"], c["pitch"] + pitch_osc[k]),
                       "wing": wings[k], "unfold": 1.0, "chestZ": chest[k], "lineW": 1.0, "wave": c["speed"],
                       "tailYaw": tail_yaw[k], "loop": n, "i": k})
    return frames


def flap_frames(c=FLAP):
    """One seamless cruising-flap cycle."""
    n = int(round(c["period"] * FPS))
    h, acc = _periodic_lift_height(c, n)
    chest = []
    for k in range(n):
        u = k / n
        heave = c["heave"] * math.sin(2 * math.pi * (u - 0.12))
        chest.append(F.CHEST_Z + (c["altitude"] - F.PELVIS_Z) + h[k] + heave)
    heave_acc = [-c["heave"] * (2 * math.pi / c["period"]) ** 2 * math.sin(2 * math.pi * (k / n - 0.12)) for k in range(n)]
    shoulder_acc = [acc[k] + heave_acc[k] for k in range(n)]
    pitch_osc = [0.03 * math.sin(2 * math.pi * (k / n - 0.2)) for k in range(n)]
    arms = _arm_springs(shoulder_acc, pitch_osc, c["speed"], n)
    wings = [F.segment_channels(c, k / n) for k in range(n)]
    frames = _frames(c, n, chest, wings, pitch_osc, [0.0] * n)
    hind = _hind(c["hindTrail"])
    for k, fr in enumerate(frames):
        bones = dict(hind)
        bones.update(_arms({s: arms[s][k] for s in ("L", "R")}))
        u = k / n
        for j, nme in enumerate(("neck_01", "neck_02", "neck_03", "neck_04")):
            bones[nme] = (-0.25 * c["pitch"] + 0.02 * math.sin(2 * math.pi * (u - 0.35 - 0.06 * j)), 0, 0)
        bones["head"] = (-0.3 * c["pitch"], 0, 0)
        fr["bones"] = bones
    return frames


def _glide_channels(c, u):
    """Held wing with a slow breath and a travelling flutter outboard (per segment, the tips lag and flex most)."""
    amp, harm, lag = c["flutter"]
    out = {}
    for j, seg in enumerate(("humerus", "forearm", "rib", "tip")):
        breath = c["elevBreath"] * math.sin(2 * math.pi * u)
        fl = amp * (j / 3) * math.sin(2 * math.pi * (harm * u - lag * j))
        out[seg] = {"elev": c["elev"] + breath + 0.3 * fl, "sweep": c["sweep"], "fold": c["fold"], "fan": 0.0,
                    "twist": c["twist"] + 0.3 * fl, "bend": c["bend"] + fl + 1.5 * math.sin(2 * math.pi * (u - 0.1))}
    return out


def glide_frames(c=GLIDE):
    """One seamless glide loop."""
    n = int(round(c["period"] * FPS))
    chest, acc = [], []
    w = 2 * math.pi / c["period"]
    for k in range(n):
        u = k / n
        chest.append(F.CHEST_Z + (c["altitude"] - F.PELVIS_Z) + c["bob"] * math.sin(2 * math.pi * u))
        acc.append(-c["bob"] * w * w * math.sin(2 * math.pi * u))
    pitch_osc = [0.015 * math.sin(2 * math.pi * (k / n + 0.1)) for k in range(n)]
    arms = _arm_springs(acc, pitch_osc, c["speed"], n)
    wings = [_glide_channels(c, k / n) for k in range(n)]
    yaw = [math.sin(2 * math.pi * k / n) for k in range(n)]
    frames = _frames(c, n, chest, wings, pitch_osc, yaw)
    hind = _hind(c["hindTrail"])
    for k, fr in enumerate(frames):
        bones = dict(hind)
        bones.update(_arms({s: arms[s][k] for s in ("L", "R")}))
        u = k / n
        for j, nme in enumerate(("neck_01", "neck_02", "neck_03", "neck_04")):
            bones[nme] = (-0.25 * c["pitch"], 0, 0.015 * math.sin(2 * math.pi * (u - 0.3)))
        bones["head"] = (-0.3 * c["pitch"], 0, 0.03 * math.sin(2 * math.pi * (u - 0.4)))
        fr["bones"] = bones
    return frames


def loop_line(frames, fr, c):
    """The body line for a loop: the chest's height (y - CHEST_Y) / wave s ago, wrapping around the cycle."""
    n = fr["loop"]

    def line(y, z):
        d = max(0.0, y - F.CHEST_Y)
        k = (fr["i"] - d / fr["wave"] * FPS) % n
        k0 = int(k)
        a = k - k0
        past = frames[k0 % n]["chestZ"] * (1 - a) + frames[(k0 + 1) % n]["chestZ"] * a
        now = fr["chestZ"]
        beyond = max(0.0, y - F.PELVIS_Y)
        tail_len = 3.4
        whip = 1.0 + c["whip"] * min(1.0, beyond / tail_len)
        droop = c["tailDroop"] * math.sin(math.pi * min(1.0, beyond / (1.2 * tail_len)))
        lean = c["pitch"] * (F.CHEST_Y - y)          # the cruise attitude: points behind the chest sit lower
        return now + (past - now) * whip + (z - F.CHEST_Z) - droop + lean
    return line


def apply_loop_frame(rig, fr, frames, c):
    """Pose a loop frame: the body from the library pose, laid along the looping body line, the tail's rudder sway,
    then the wings."""
    LIB.apply_pose(rig, {"root": fr["root"], "wings": (0.0, 0.0, 0.0), "bones": fr["bones"]})
    F._apply_line(rig, fr, frames, loop_line(frames, fr, c))
    sway = c.get("tailSway", 0.0)
    if sway:
        n = fr["loop"]
        for j in range(12):
            pb = rig.pose.bones[f"tail_{j + 1:02d}"]
            e = pb.rotation_euler
            phase = 2 * math.pi * (fr["i"] / n - 0.05 * j)
            pb.rotation_euler = (e[0], e[1], sway * (0.4 + 0.06 * j) * math.sin(phase))
        bpy.context.view_layer.update()
    F.apply_wings(rig, fr["wing"])
