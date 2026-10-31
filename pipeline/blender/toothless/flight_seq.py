"""Authored flight transitions and the landing (flight, Phase 2 groundwork).

- flap_to_glide: one cruise beat, then the next downstroke slows and stops mid-stroke, where the wing is in its glide
  set, and the wings settle into the glide while the body's flapping rise and fall fades.
- glide_to_flap: from the glide the wings lift through an upstroke as the beat rate ramps up, joining the cruise flap
  at the top of the stroke.
- landing: a descending glide approach; the flare (nose up, two short braking backstrokes with the wings swept forward
  and supinated, the legs reaching); hind paws, then fore paws, plant on their touchdown spots (the takeoff's ground
  leg solve); the body absorbs into a loaded crouch while the wings fold (through the raised path) and he rises to
  stand.

Each clip is a list of frames like the takeoff's, posed by flight.apply_frame with a body hook that lays the spine and
tail on the shoulder-anchored body line. A clip starts with a lead-in from the clip it leaves (frames before
"clipStart"), so the line's history (the hips and tail answering the shoulders late) carries over instead of popping.
The chest track is set so the line puts the pelvis at the clip's pelvis height at any pitch.
"""
import math
import bpy
import flight as F
import flight_loops as FL
import library as LIB

FPS = F.FPS
FLAP, GLIDE = FL.FLAP, FL.GLIDE
ALT = 3.0                       # m: pelvis height in flight for the transitions

BRAKE = dict(FLAP, period=0.38, down=0.5, top=55.0, bottom=8.0, sweepTop=12.0, sweepBottom=30.0,
             foldMax=20.0, fanMax=0.1, twistDown=-16.0, twistUp=-24.0, bendDown=-8.0, bendUp=-4.0, lag=0.05)

NUM = ("elev", "sweep", "fold", "fan", "twist", "bend")


def _ease(u):
    return F._ease(u)


def _lerp(a, b, k):
    return a + (b - a) * k


def _clamp01(u):
    return max(0.0, min(1.0, u))


def _blend_ch(a, b, k):
    """Per-segment wing channels a -> b by k."""
    return {seg: {key: _lerp(a[seg][key], b[seg][key], k) for key in NUM} for seg in a}


def _flap_osc():
    """The cruise flap's chest rise and fall over its cycle, sampled by beat phase."""
    n = int(round(FLAP["period"] * FPS))
    h, _ = FL._periodic_lift_height(FLAP, n)

    def at(u):
        x = (u % 1.0) * n
        k0 = int(x)
        a = x - k0
        return h[k0 % n] * (1 - a) + h[(k0 + 1) % n] * a
    return at


def _build(sig, c_line):
    """Frames from per-frame signals: dicts with t, x, pelvisH, pitch, wing (channels), osc (m, chest rise / fall),
    unfold, lineW, legs (hind + extra bones), legIK, armW (spring arms weight), reach (fore-leg reach weight), wave,
    sway. The fore arms hang on the takeoff's springs, driven by the chest's acceleration and the pitch."""
    c = F.TAKEOFF
    st = {s: {k: [0.0, 0.0] for k in ("humerus", "radius", "metacarpal")} for s in ("L", "R")}
    chest = []
    for s in sig:
        lever = s["pitch"] * (F.PELVIS_Y - F.ANCHOR_Y)          # the line then puts the pelvis at pelvisH
        chest.append(F.CHEST_Z + (s["pelvisH"] - F.PELVIS_Z) + lever + s["osc"])
    dt = 1.0 / FPS
    land = LIB.POSES["jump_land"]["bones"]
    frames = []
    hist = []
    p0 = sig[0]["pitch"]
    for i, s in enumerate(sig):
        acc = 0.0
        if 0 < i < len(sig) - 1:
            acc = (chest[i + 1] - 2 * chest[i] + chest[i - 1]) / (dt * dt)
        acc = max(-40.0, min(40.0, acc))
        hist.append((acc, s["pitch"] - p0, s.get("speed", 10.0)))
        if i == 0:                                            # settle the springs on the first frame's input
            for _ in range(120):
                for side in ("L", "R"):
                    _arm_step(st[side], hist[0], c, dt)
        arms = {}
        for side in ("L", "R"):
            inp = hist[max(0, i - (c["sideLag"] if side == "R" else 0))]
            arms[side] = _arm_step(st[side], inp, c, dt)
        bones = dict(s.get("legs", {}))
        for side in ("L", "R"):
            for part, val in c["frontHang"].items():
                lo, hi = F.ARM_LIMITS.get(part, (-3.0, 3.0))
                hang = min(hi, max(lo, val + arms[side].get(part, 0.0)))
                reach = land.get(f"front_{part}_{side}", (hang, 0, 0))[0]
                bones[f"front_{part}_{side}"] = (_lerp(hang, reach, s.get("reach", 0.0)), 0.0, 0.0)
        for j, nme in enumerate(("neck_01", "neck_02", "neck_03", "neck_04")):
            bones.setdefault(nme, (-0.25 * s["pitch"], 0, 0))
        bones.setdefault("head", (-0.3 * s["pitch"], 0, 0))
        frames.append({"t": s["t"], "x": s["x"], "root": (s["pelvisH"], s["pitch"]), "pitch": s["pitch"],
                       "bones": bones, "wing": s["wing"], "unfold": s.get("unfold", 1.0), "chestZ": chest[i],
                       "lineW": s.get("lineW", 1.0), "wave": s["wave"], "legIK": s.get("legIK", {}), "i": i,
                       "sway": s.get("sway", 0.0), "swayPhase": s.get("swayPhase", 0.0), "line": c_line(s)})
    return frames


def _arm_step(st, inp, c, dt):
    a_i, p_i, v_i = inp
    hz, dmp = c["armHz"], c["armDamp"]
    hum = F._spring(st["humerus"], -c["armAccel"][0] * a_i + c["armGravity"] * p_i - c["armDrag"] * v_i * 0.25, hz[0], dmp, dt)
    rad = F._spring(st["radius"], -c["armAccel"][1] * a_i + c["armFollow"][0] * st["humerus"][1] / (2 * math.pi * hz[0]),
                    hz[1], dmp, dt)
    mc = F._spring(st["metacarpal"], -c["armFollow"][1] * st["radius"][1] / (2 * math.pi * hz[1]), hz[2], dmp, dt)
    return {"humerus": hum, "radius": rad, "metacarpal": mc, "toes": -0.4 * mc}


def _line_params(wf):
    """Body-line parameters between the glide (wf = 0) and the flap (wf = 1)."""
    return {k: _lerp(GLIDE[k], FLAP[k], wf) for k in ("trunkGain", "whip", "tailDroop", "headFollow")}


# ---- flap -> glide / glide -> flap -------------------------------------------------------------------------------------

def flap_to_glide():
    osc = _flap_osc()
    per, d = FLAP["period"], FLAP["down"]
    lead = per                                  # one plain beat of lead-in
    t1 = per                                    # then one full beat in the clip
    u_stop = 0.5 * d                            # mid-downstroke: elevation ~ the glide's
    ts = 2 * u_stop * per                       # the slowing downstroke (its start rate matches the beat)
    total = lead + t1 + ts + 0.9
    hind = FL._hind(FLAP["hindTrail"])
    sig = []
    for f in range(int(round(total * FPS)) + 1):
        t = f / FPS
        tc = t - lead
        if tc < t1:
            u = t / per
        elif tc < t1 + ts:
            k = (tc - t1) / ts
            u = (lead + t1) / per + u_stop * (1 - (1 - k) ** 2)
        else:
            u = (lead + t1) / per + u_stop
        wg = _ease(_clamp01((tc - (t1 + 0.5 * ts)) / (0.5 * ts + 0.35)))
        tau = max(0.0, tc - (t1 + 0.5 * ts)) / GLIDE["period"]
        wing = _blend_ch(F.segment_channels(FLAP, u), FL._glide_channels(GLIDE, tau % 1.0), wg)
        speed = _lerp(FLAP["speed"], GLIDE["speed"], _clamp01(tc / (t1 + ts + 0.9)))
        sig.append({"t": t, "speed": speed, "pelvisH": ALT, "pitch": _lerp(FLAP["pitch"], GLIDE["pitch"], wg),
                    "wing": wing, "osc": (1 - wg) * (osc(u) + FLAP["heave"] * math.sin(2 * math.pi * (u - 0.12)))
                    + wg * GLIDE["bob"] * math.sin(2 * math.pi * tau),
                    "legs": hind, "wave": _lerp(FLAP["wave"], GLIDE["wave"], wg), "wf": 1 - wg,
                    "sway": wg * GLIDE["tailSway"], "swayPhase": tau})
    _integrate_x(sig)
    frames = _build(sig, lambda s: _line_params(s["wf"]))
    for fr in frames:
        fr["clipStart"] = int(round(lead * FPS))
    return frames


def glide_to_flap():
    osc = _flap_osc()
    per, d = FLAP["period"], FLAP["down"]
    lead = 1.0
    u0 = d + 0.5 * (1 - d)                      # mid-upstroke: elevation ~ the glide's
    tr = 0.45                                   # the beat rate ramps up over this
    total = lead + tr + 2 * per + 0.3
    hind = FL._hind(FLAP["hindTrail"])
    sig = []
    for f in range(int(round(total * FPS)) + 1):
        t = f / FPS
        tc = t - lead
        tau = t / GLIDE["period"]
        if tc <= 0:
            u, wf = u0, 0.0
        else:
            u = u0 + ((tc * tc / (2 * tr)) if tc < tr else (tr / 2 + tc - tr)) / per
            wf = _ease(_clamp01(tc / 0.4))
        wing = _blend_ch(FL._glide_channels(GLIDE, tau % 1.0), F.segment_channels(FLAP, u), wf)
        speed = _lerp(GLIDE["speed"], FLAP["speed"], _clamp01(tc / 1.5))
        sig.append({"t": t, "speed": speed, "pelvisH": ALT, "pitch": _lerp(GLIDE["pitch"], FLAP["pitch"], wf),
                    "wing": wing, "osc": wf * (osc(u) + FLAP["heave"] * math.sin(2 * math.pi * (u - 0.12)))
                    + (1 - wf) * GLIDE["bob"] * math.sin(2 * math.pi * tau),
                    "legs": hind, "wave": _lerp(GLIDE["wave"], FLAP["wave"], wf), "wf": wf,
                    "sway": (1 - wf) * GLIDE["tailSway"], "swayPhase": tau})
    _integrate_x(sig)
    frames = _build(sig, lambda s: _line_params(s["wf"]))
    for fr in frames:
        fr["clipStart"] = int(round(lead * FPS))
    return frames


def _integrate_x(sig):
    x = 0.0
    for s in sig:
        s["x"] = x
        x += s["speed"] / FPS


# ---- landing -----------------------------------------------------------------------------------------------------------

LAND = {
    "lead": 0.6,               # s of plain glide lead-in
    "approach": 0.9,           # s: the descending glide
    "flare": 0.8,              # s: nose up, braking backstrokes, legs reaching
    "frontLag": 0.12,          # s: the fore paws plant after the hind
    "absorb": 0.35,            # s: down into the loaded crouch
    "rise": 0.75,              # s: back up to standing
    "hold": 0.4,
    "startH": 3.4, "sink": 1.3,            # m, m/s: the approach
    "tdH": 1.25, "tdSink": 0.8,            # pelvis height and sink speed at hind touchdown
    "crouchH": 0.76, "standH": 1.02,
    "speed": (13.0, 10.0, 1.4),            # m/s: approach start, flare start, touchdown
    "flarePitch": 0.55, "tdPitch": 0.32,
    "foldStart": 0.15, "foldTime": 0.8,    # s after hind touchdown, s
}


def landing(c=LAND):
    lead, ta, tf = c["lead"], c["approach"], c["flare"]
    t_flare = lead + ta
    t_td = t_flare + tf
    t_ftd = t_td + c["frontLag"]
    t_abs = t_td + c["absorb"]
    t_up = t_abs + c["rise"]
    total = t_up + c["hold"]
    h_flare = c["startH"] - c["sink"] * ta
    hind_air = FL._hind(GLIDE["hindTrail"])
    land_bones = LIB.POSES["jump_land"]["bones"]
    hind_reach = {n: e for n, e in land_bones.items() if n.startswith("hind_")}
    crouch_body = F._body_of("jump_crouch")
    sig = []
    for f in range(int(round(total * FPS)) + 1):
        t = f / FPS
        tau = t / GLIDE["period"]
        # pelvis height
        if t < t_flare:
            h = c["startH"] - c["sink"] * max(0.0, t - lead)
        elif t < t_td:
            k = (t - t_flare) / tf
            h = F._hermite01(h_flare, c["tdH"], -c["sink"] * tf, -c["tdSink"] * tf, k)
        elif t < t_abs:
            k = (t - t_td) / c["absorb"]
            h = F._hermite01(c["tdH"], c["crouchH"], -c["tdSink"] * c["absorb"], 0.0, k)
        elif t < t_up:
            h = _lerp(c["crouchH"], c["standH"], _ease((t - t_abs) / c["rise"]))
        else:
            h = c["standH"]
        # forward speed
        v0, v1, v2 = c["speed"]
        if t < t_flare:
            speed = _lerp(v0, v1, _clamp01((t - lead) / ta))
        elif t < t_td:
            speed = _lerp(v1, v2, 1 - (1 - (t - t_flare) / tf) ** 2)
        else:
            speed = v2 * max(0.0, 1 - (t - t_td) / 0.3)
        # pitch
        if t < t_flare:
            pitch = GLIDE["pitch"]
        elif t < t_td:
            pitch = _lerp(GLIDE["pitch"], c["flarePitch"], _ease(_clamp01((t - t_flare) / (0.75 * tf))))
            pitch = _lerp(pitch, c["tdPitch"], _ease(_clamp01((t - t_flare - 0.75 * tf) / (0.25 * tf))))
        else:
            pitch = _lerp(c["tdPitch"], -0.03, _ease(_clamp01((t - t_td) / (c["frontLag"] + 0.25))))
            pitch = _lerp(pitch, 0.0, _ease(_clamp01((t - t_abs) / c["rise"])))
        # wings: glide -> braking backstrokes -> held up while folding
        wb = _ease(_clamp01((t - t_flare) / 0.2)) * (1 - _ease(_clamp01((t - t_td - 0.05) / 0.2)))
        ub = max(0.0, t - t_flare) / BRAKE["period"]
        brake = F.segment_channels(BRAKE, ub if t < t_td else ub)       # two strokes over the flare
        held = F.segment_channels(BRAKE, 0.0)                            # the stroke's top, for the fold
        wing = _blend_ch(FL._glide_channels(GLIDE, tau % 1.0), brake, wb)
        wing = _blend_ch(wing, held, _ease(_clamp01((t - t_td) / 0.25)))
        unfold = 1.0 - _ease(_clamp01((t - t_td - c["foldStart"]) / c["foldTime"]))
        # legs: trailing in the glide, reaching through the flare, then the ground solve from just before touchdown
        reach = _ease(_clamp01((t - t_flare - 0.2) / (tf - 0.2)))
        legs = {n: tuple(_lerp(a, b, reach) for a, b in zip(hind_air.get(n, (0, 0, 0)), hind_reach.get(n, (0, 0, 0))))
                for n in set(hind_air) | set(hind_reach)}
        crouch_w = _ease(_clamp01((t - t_td) / c["absorb"])) * (1 - _ease(_clamp01((t - t_abs) / c["rise"])))
        for n, e in crouch_body.items():
            legs[n] = tuple(crouch_w * v for v in e)
        sig.append({"t": t, "speed": speed, "pelvisH": h, "pitch": pitch, "wing": wing, "unfold": unfold,
                    "osc": (1 - wb) * GLIDE["bob"] * math.sin(2 * math.pi * tau) * (1 - _clamp01((t - t_flare) / 0.3)),
                    "legs": legs, "reach": reach * (1 - _clamp01((t - t_ftd) / 0.1)),
                    "lineW": 1.0 - _ease(_clamp01((t - t_td) / 0.3)), "wave": GLIDE["wave"], "wf": 0.0,
                    "sway": GLIDE["tailSway"] * (1 - _clamp01((t - t_flare) / 0.3)), "swayPhase": tau})
    _integrate_x(sig)
    # touchdown spots (world y at the start's frame): where each paw's rest toe is under the body at its touchdown
    x_at = lambda tt: sig[min(len(sig) - 1, int(round(tt * FPS)))]["x"]
    spots = {"hind": F.TOE_REST["hind"][0] - x_at(t_td), "front": F.TOE_REST["front"][0] - x_at(t_ftd)}
    for s in sig:
        t = s["t"]
        ik = {}
        for kind, ttd in (("hind", t_td), ("front", t_ftd)):
            w = _ease(_clamp01((t - (ttd - 0.15)) / 0.15))
            if w <= 0:
                continue
            k_abs = _ease(_clamp01((t - ttd) / c["absorb"]))
            k_up = _ease(_clamp01((t - t_abs) / c["rise"]))
            if kind == "hind":
                distal = _lerp(_lerp(20, 55, k_abs), 31, k_up)
                toes = _lerp(_lerp(60, 82, k_abs), 79, k_up)
                scap = None
            else:
                distal = _lerp(_lerp(30, 52, k_abs), 45, k_up)
                toes = _lerp(_lerp(60, 82, k_abs), 79, k_up)
                scap = _lerp(_lerp(10, -6, k_abs), 0, k_up)
            for side in ("L", "R"):
                ik[f"{kind}_{side}"] = (w, (spots[kind], F.TOE_REST[kind][1]), distal, toes, scap)
        s["legIK"] = ik
    # a calmer line than the glide's: the chest sinks and slows through the flare, and a full whip would fling the tail
    # high on the old path
    frames = _build(sig, lambda s: dict(_line_params(0.0), whip=0.25, trunkGain=0.15))
    for fr in frames:
        fr["clipStart"] = int(round(lead * FPS))
        fr["wave"] = 4.5
    return frames


# ---- posing ------------------------------------------------------------------------------------------------------------

def seq_line(frames, fr):
    """The shoulder-anchored body line over a sequence: the anchor's height |y - ANCHOR_Y| / wave s ago (no wrap: the
    lead-in supplies the history), the attitude tilting it."""
    i = fr["i"]
    c = fr["line"]

    def line(y, z):
        d = y - F.ANCHOR_Y
        k = max(0.0, i - abs(d) / fr["wave"] * FPS)
        k0 = int(k)
        a = k - k0
        past = frames[k0]["chestZ"] * (1 - a) + frames[min(k0 + 1, i)]["chestZ"] * a
        now = fr["chestZ"]
        lean = fr["pitch"] * (F.ANCHOR_Y - y)
        return now + F.wave_height(d, past, now, c) + (z - F.CHEST_Z) + lean
    return line


def body_hook(frames):
    span = int(FLAP["period"] * FPS)

    def hook(rig, fr):
        if fr["lineW"] > 0:
            i = fr["i"]
            win = [frames[k]["chestZ"] for k in range(max(0, i - span), i + 1)]
            steady = sum(win) / len(win)
            head_z = rig.data.bones["head"].head_local.z + (steady - F.CHEST_Z) + fr["line"]["headFollow"] * (fr["chestZ"] - steady)
            F._apply_line(rig, fr, frames, line_fn=seq_line(frames, fr), head_z=head_z)
        if fr["sway"]:
            for j in range(12):
                pb = rig.pose.bones[f"tail_{j + 1:02d}"]
                e = pb.rotation_euler
                pb.rotation_euler = (e[0], e[1], fr["sway"] * (0.4 + 0.06 * j) * math.sin(2 * math.pi * (fr["swayPhase"] - 0.05 * j)))
            bpy.context.view_layer.update()
    return hook


CLIPS = {"flap2glide": flap_to_glide, "glide2flap": glide_to_flap, "land": landing}
