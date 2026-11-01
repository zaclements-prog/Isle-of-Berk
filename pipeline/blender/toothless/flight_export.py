"""Flight clips for the game (toothless.poses.glb / poses.json `flight` blocks).

Every clip is posed frame by frame by its own code, exactly as the reels render it (flight.py, flight_loops.py,
flight_seq.py, flight_run.py), then each pose bone's matrix_basis is keyed. The pelvis track is keyed too but masked
off in the engine: the engine places the pelvis, from its flight path plus the clip's own per-frame pelvis height
(head, m above the ground plane) and pitch (rad, + nose up), measured on the posed rig and written to poses.json.

All clips are posed first (NLA muted, Euler bones: the posing code sets rotation_euler), then keyed, because keying
leaves the bones in quaternion mode and the clips' NLA tracks would override the posed bones mid-solve.
"""
import math
import bpy
import flight as F, flight_loops as FL, flight_seq as FS, flight_run as FR, locomotion as L, library as LIB, rig as R

FPS = F.FPS
# everything the flight authors except the pelvis (the engine's), the jaw and ears (the face's) and the tail fins (the
# secondary motion's)
BODY_MASK = ["spine_", "chest", "neck_", "head", "tail_", "front_", "hind_", "wing_", "hipwing_"]
WING_MASK = ["wing_", "hipwing_"]
LEGS = ["hind_L", "front_L", "hind_R", "front_R"]


def _pelvis(rig):
    pb = rig.pose.bones["pelvis"]
    return pb.head.z, pb.matrix_basis.to_euler("XYZ").x


def _capture(rig):
    return {pb.name: (pb.matrix_basis.to_translation(), pb.matrix_basis.to_quaternion()) for pb in rig.pose.bones}


def _record(rig, n, pose, close_loop=False):
    """Pose frames 0..n-1 (and frame 0 again when close_loop): per frame the bone captures and the pelvis (h, pitch)."""
    caps, heights, pitches = [], [], []
    for k in range(n):
        pose(k)
        bpy.context.view_layer.update()
        caps.append(_capture(rig))
        h, p = _pelvis(rig)
        heights.append(h)
        pitches.append(p)
    if close_loop:
        caps.append(caps[0])
    return caps, heights, pitches


def _key(rig, name, caps):
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    prev = {}
    for f, cap in enumerate(caps if len(caps) > 1 else caps * 2):
        for pb in rig.pose.bones:
            loc, q = cap[pb.name]
            q = q.copy()
            if pb.name in prev and prev[pb.name].dot(q) < 0:
                q.negate()
            prev[pb.name] = q.copy()
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q
            pb.location = loc
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("location", frame=f)
    act.use_fake_user = True
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    rig.animation_data.action = None
    R.reset_pose(rig)
    return act


def _r(xs, nd=4):
    return [round(v, nd) for v in xs]


def _clips(rig):
    """name -> (n frames, pose(k), loop, mask, extra meta, x(k) or None)."""
    folded = F.folded_wing_basis(rig)
    gal = L.cycle_frames(rig, "gallop")[0]
    out = {}
    flap = FL.flap_frames()
    out["fly_flap"] = (len(flap), lambda k: FL.apply_loop_frame(rig, flap[k], flap, FL.FLAP), True, BODY_MASK,
                       {"kind": "flap", "speed": FL.FLAP["speed"], "period": FL.FLAP["period"],
                        "down": FL.FLAP["down"], "basePitch": FL.FLAP["pitch"]}, None)
    glide = FL.glide_frames()
    out["fly_glide"] = (len(glide), lambda k: FL.apply_loop_frame(rig, glide[k], glide, FL.GLIDE), True, BODY_MASK,
                        {"kind": "glide", "speed": FL.GLIDE["speed"], "period": FL.GLIDE["period"],
                         "basePitch": FL.GLIDE["pitch"]}, None)
    # standing takeoff: to the end of its second climbing beat
    tk = F.takeoff_frames()
    c = F.TAKEOFF
    n_tk = int(round(2.9 * FPS))
    t_beats = c["windup"] + c["first"]
    t_end = (n_tk - 1) / FPS
    out["fly_takeoff"] = (n_tk, lambda k: F.apply_frame(rig, tk[k], folded, tk), False, BODY_MASK,
                          {"kind": "takeoff", "push": c["windup"], "liftoff": c["windup"] + c["pushTime"],
                           "beatPeriod": c["period"], "beatEnd": round((c["down"] + (t_end - t_beats) / c["period"]) % 1.0, 4)},
                          lambda k: tk[k]["x"])
    # running takeoff: the wings' prep over the gallop, then everything from the hind plant (the push) on
    rt = FR.run_takeoff(rig, folded, gal).parts
    rc, rtk, i0, G, prep, air = rt["c"], rt["tk"], rt["i0"], rt["G"], rt["prep"], rt["air"]
    U = prep - int(round(FR.RUN_RAISE * FPS))                   # opening low, then the raise to the stroke's top
    RZ = prep - U
    out["fly_runtakeoff_wings"] = (prep + 1, lambda k: rt["gallop_pose"](G - prep + k, min(1.0, k / U), max(0.0, min(1.0, (k - U) / RZ))),
                                   False, WING_MASK, {"kind": "runtakeoff_wings", "raise": FR.RUN_RAISE}, None)
    t_end = (i0 + air - 1) / FPS
    rt_beats = rc["windup"] + rc["first"]
    out["fly_runtakeoff"] = (air, lambda k: F.apply_frame(rig, rtk[i0 + k], folded, rtk), False, BODY_MASK,
                             {"kind": "runtakeoff", "liftoff": rc["pushTime"], "speed0": rc["forward"][0],
                              "beatPeriod": rc["period"],
                              "beatEnd": round((rc["down"] + (t_end - rt_beats) / rc["period"]) % 1.0, 4)},
                             lambda k: rtk[i0 + k]["x"])
    # standing landing: from the glide lead-in to standing
    lf = FS.landing()
    lh = FS.body_hook(lf)
    ls0 = lf[0]["clipStart"]
    lc = FS.LAND
    td = lc["lead"] + lc["approach"] + lc["flare"]
    out["fly_land"] = (len(lf) - ls0, lambda k: F.apply_frame(rig, lf[ls0 + k], folded, None, lh), False, BODY_MASK,
                       {"kind": "land", "touchdown": round(td - ls0 / FPS, 4), "flare": round(lc["lead"] + lc["approach"] - ls0 / FPS, 4),
                        "frontTouchdown": round(td + lc["frontLag"] - ls0 / FPS, 4), "speed0": lc["speed"][0]},
                       lambda k: lf[ls0 + k]["x"] - lf[ls0]["x"])
    # running landing: to touchdown + the gallop hand-off blend
    rl = FR.run_landing(rig, folded, gal).parts
    allf, hook, s0, i_td, B = rl["allf"], rl["hook"], rl["s0"], rl["i_td"], rl["blend"]
    rlc = FR.RUN_LAND
    n_rl = i_td - s0 + B + 1
    out["fly_runland"] = (n_rl, lambda k: F.apply_frame(rig, allf[s0 + k], folded, None, hook), False, BODY_MASK,
                          {"kind": "runland", "touchdown": round((i_td - s0) / FPS, 4),
                           "flare": round((i_td - s0) / FPS - rlc["flare"], 4), "handoff": FR.RUN_LAND_BLEND,
                           "speed0": rlc["speed"][0], "runSpeed": rlc["speed"][2]},
                          lambda k: allf[s0 + k]["x"] - allf[s0]["x"])
    return out


_RECORDED = {}


def record_all(rig):
    """Pose every flight clip (once per session) with NLA muted and Euler bones."""
    if _RECORDED:
        return _RECORDED
    ad = rig.animation_data
    use_nla = ad.use_nla if ad else None
    act = ad.action if ad else None
    if ad:
        ad.use_nla = False
        ad.action = None
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
    R.reset_pose(rig)
    try:
        for name, (n, pose, loop, mask, meta, xfn) in _clips(rig).items():
            caps, hs, ps = _record(rig, n, pose, close_loop=loop)
            _RECORDED[name] = (caps, hs, ps, loop, mask, meta, [xfn(k) for k in range(n)] if xfn else None, n)
            print("FLIGHT CLIP", name, n, "frames")
    finally:
        if ad:
            ad.use_nla = use_nla
            ad.action = act
        R.reset_pose(rig)
    return _RECORDED


def make_clips(rig):
    rec = record_all(rig)
    return [_key(rig, name, r[0]) for name, r in rec.items()]


def meta_entries(rig):
    """poses.json entries: mask (no pelvis: the engine places it), loop, duration, ownsLegs and a `flight` block —
    kind, per-frame curves (frame k at t = k / 30): height = pelvis head height (m; loops: about the loop's mean, the
    mean in `meanHeight`), pitch (rad, + nose up), x = forward travel (m, one-shots), plus each clip's markers (s)."""
    rec = record_all(rig)
    out = {}
    for name, (caps, hs, ps, loop, mask, meta, xs, n) in rec.items():
        dur = (n if loop else n - 1) / FPS
        fl = dict(meta)
        if loop:
            mean = sum(hs) / n
            fl["meanHeight"] = round(mean, 4)
            fl["height"] = _r([h - mean for h in hs])
        else:
            fl["height"] = _r(hs)
            if xs is not None:
                fl["x"] = _r(xs)
        fl["pitch"] = _r(ps)
        entry = {"mask": mask, "loop": loop, "blendIn": 0.3, "blendOut": 0.3, "interrupt": "none",
                 "duration": round(dur, 4), "flight": fl}
        if mask is BODY_MASK:
            entry["ownsLegs"] = list(LEGS)
        out[name] = entry
    return out


FLIGHT_CLIPS = ["fly_flap", "fly_glide", "fly_takeoff", "fly_runtakeoff_wings", "fly_runtakeoff", "fly_land", "fly_runland"]
