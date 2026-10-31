"""Prototype: the flying body as a physics chain hung from the shoulder blades (position-based dynamics).

STATUS: not adopted (review 2026-10-31). Side by side with the authored body line (flight.py / flight_loops.py) it
read as worse or no different, so the authored line stays the default; this stays opt-in (CLIP=*_chain in
flight_preview.py) as a reference. The physics-based track continues as a learned controller instead:
docs/superpowers/plans/2026-10-31-p2-flight-rl-handoff.md.

The wings hold him up at the wing root on the shoulder blades, so that is the chain's anchor: it follows the flight
path (the lift simulation's height, the forward travel) and holds a target flight attitude. Behind it the chest, the
spine joints, the pelvis and the tail joints are point masses. Each step:
- every node is integrated (Verlet) under gravity and air drag (relative to still air, so a fast-flying tail streams
  back and vertical motion is damped by the air);
- the first segment is pulled toward the anchor's attitude (the shoulders' own stiffness);
- every joint is pulled toward its rest bend (stiff through the trunk, looser toward the tail tip), moving the child;
- every segment is restored to its rest length.
Nothing is a scripted wave: the hips, back and tail respond to the shoulders' motion with their own weight, stiffness
and damping, so the flex is as large as the forces make it. The bones are then aimed along the simulated nodes.

Rest geometry comes from the rig (armature space: +Y behind, +Z up). Simulated in the world (the travel subtracted
back out), 8 substeps per 30 fps frame.
"""
import math
import bpy
from mathutils import Vector
import flight as F
import library as LIB

FPS = F.FPS
SUB = 8
ITER = 4

PARAMS = {
    "g": 9.81,
    "shoulder": 0.55,          # per-iteration pull of the first segment to the anchor's attitude
    "trunk": 0.45,             # per-iteration pull of each trunk joint to its rest bend
    "tailRoot": 0.75, "tailTip": 0.5,     # tail joints, root -> tip
    "dragTrunk": 0.6,          # 1/s air drag on the trunk nodes
    "dragTail": 1.6,           # 1/s on the tail nodes (thin and long: streams in the air)
    "damp": 0.02,              # per-substep velocity loss (internal damping)
}

SPINE = ("chest", "spine_03", "spine_02", "spine_01", "pelvis")       # front -> back: their heads are nodes 1..5
TAIL = tuple(f"tail_{k:02d}" for k in range(1, 13))


def rest_nodes(rig):
    """(y, z) rest positions: [anchor, chest, spine_03, spine_02, spine_01, pelvis, tail_01 .. tail_12 heads,
    tail_12 tail], plus the neck base (the chest bone's tail)."""
    b = rig.data.bones
    nodes = [(F.ANCHOR_Y, F.A.MAIN_WING_L["root"][2])]
    for n in SPINE:
        nodes.append((b[n].head_local.y, b[n].head_local.z))
    for n in TAIL:
        nodes.append((b[n].head_local.y, b[n].head_local.z))
    nodes.append((b["tail_12"].tail_local.y, b["tail_12"].tail_local.z))
    neck = (b["chest"].tail_local.y, b["chest"].tail_local.z)
    return nodes, neck


def _rot(dy, dz, p):
    """Rotate a (y, z) offset nose-up by p (points behind go down)."""
    c, s = math.cos(p), math.sin(p)
    return dy * c + dz * s, dz * c - dy * s


def _angle(a, b):
    return math.atan2(b[1] - a[1], b[0] - a[0])


def simulate(rest, anchors, pitches, prm=PARAMS, init_pitch=None):
    """Run the chain. anchors: per frame the anchor's world (y, z); pitches: the anchor's attitude (rad, nose up).
    Returns per frame the nodes' world (y, z)."""
    n = len(rest)
    lens = [math.dist(rest[i], rest[i + 1]) for i in range(n - 1)]
    # rest bend at each interior node: the angle from the incoming segment to the outgoing one
    rel = [0.0] * n
    for i in range(1, n - 1):
        rel[i] = _angle(rest[i], rest[i + 1]) - _angle(rest[i - 1], rest[i])
    stiff = [0.0] * n
    stiff[0] = prm["shoulder"]
    for i in range(1, n - 1):
        if i < 5:
            stiff[i] = prm["trunk"]
        else:
            u = (i - 5) / max(1, n - 7)
            stiff[i] = prm["tailRoot"] + (prm["tailTip"] - prm["tailRoot"]) * u
    drag = [prm["dragTrunk"] if i <= 5 else prm["dragTail"] for i in range(n)]
    p0 = init_pitch if init_pitch is not None else pitches[0]
    ay, az = anchors[0]
    pos = []
    for (y, z) in rest:
        dy, dz = _rot(y - rest[0][0], z - rest[0][1], p0)
        pos.append([ay + dy, az + dz])
    prev = [q[:] for q in pos]
    out = []
    dt = 1.0 / (FPS * SUB)
    for f in range(len(anchors)):
        a_prev = anchors[f - 1] if f > 0 else anchors[0]
        p_prev = pitches[f - 1] if f > 0 else pitches[0]
        for s in range(SUB):
            k = (s + 1) / SUB
            ay = a_prev[0] + (anchors[f][0] - a_prev[0]) * k
            az = a_prev[1] + (anchors[f][1] - a_prev[1]) * k
            pitch = p_prev + (pitches[f] - p_prev) * k
            for i in range(1, n):                       # integrate
                vy = (pos[i][0] - prev[i][0]) * (1 - prm["damp"])
                vz = (pos[i][1] - prev[i][1]) * (1 - prm["damp"])
                vy -= drag[i] * vy * dt
                vz -= drag[i] * vz * dt
                prev[i] = pos[i][:]
                pos[i][0] += vy
                pos[i][1] += vz - prm["g"] * dt * dt
            pos[0] = [ay, az]
            prev[0] = [ay, az]
            for _ in range(ITER):
                # the shoulders: the first segment toward the anchor's attitude
                dy, dz = _rot(rest[1][0] - rest[0][0], rest[1][1] - rest[0][1], pitch)
                pos[1][0] += (ay + dy - pos[1][0]) * stiff[0]
                pos[1][1] += (az + dz - pos[1][1]) * stiff[0]
                for i in range(1, n - 1):               # rest bends, then lengths, front to back
                    ang = _angle(pos[i - 1], pos[i]) + rel[i]
                    ty = pos[i][0] + lens[i] * math.cos(ang)
                    tz = pos[i][1] + lens[i] * math.sin(ang)
                    pos[i + 1][0] += (ty - pos[i + 1][0]) * stiff[i]
                    pos[i + 1][1] += (tz - pos[i + 1][1]) * stiff[i]
                for i in range(n - 1):
                    dy, dz = pos[i + 1][0] - pos[i][0], pos[i + 1][1] - pos[i][1]
                    d = math.hypot(dy, dz) or 1e-9
                    pos[i + 1][0] = pos[i][0] + dy * lens[i] / d
                    pos[i + 1][1] = pos[i][1] + dz * lens[i] / d
        out.append([tuple(q) for q in pos])
    return out


def neck_base(rest, neck, anchor, pitch):
    dy, dz = _rot(neck[0] - rest[0][0], neck[1] - rest[0][1], pitch)
    return anchor[0] + dy, anchor[1] + dz


# ---- posing ----------------------------------------------------------------------------------------------------------

def apply_chain(rig, nodes, neck, w=1.0, head_z=None):
    """Aim the pelvis, spine and tail along armature-space nodes (blended in by w from the current pose): the pelvis
    head on its node, each bone hinged about local X to point at its tail's node; the neck counters the chest's tilt and
    the head rides head_z."""
    import locomotion as L
    pbs = rig.pose.bones
    data = rig.data.bones
    # bone -> its tail node (y, z)
    tail_of = {"pelvis": nodes[4], "spine_01": nodes[3], "spine_02": nodes[2], "spine_03": nodes[1], "chest": neck}
    for k, n in enumerate(TAIL):
        tail_of[n] = nodes[7 + k]

    def blend(cur, tgt):
        return (cur[0] + (tgt[0] - cur[0]) * w, cur[1] + (tgt[1] - cur[1]) * w)

    pr, nx = data["pelvis"].head_local, data["pelvis"].tail_local
    ph = blend((pbs["pelvis"].head.y, pbs["pelvis"].head.z), nodes[5])
    pt = blend((pbs["pelvis"].tail.y, pbs["pelvis"].tail.z), tail_of["pelvis"])
    run = pr.y - nx.y
    pitch = math.atan2(pt[1] - ph[1], ph[0] - pt[0]) - math.atan2(nx.z - pr.z, run)
    LIB.place_root(rig, ph[1], pitch)
    bpy.context.view_layer.update()
    for n in ("spine_01", "spine_02", "spine_03", "chest") + TAIL:
        pb = pbs[n]
        tgt = blend((pb.tail.y, pb.tail.z), tail_of[n])
        aim = Vector(tgt) - L._yz(pb.head)
        L._hinge(rig, n, aim.normalized())
    rest = data["chest"].tail_local - data["chest"].head_local
    cur = pbs["chest"].tail - pbs["chest"].head
    chest = math.atan2(cur.z, -cur.y) - math.atan2(rest.z, -rest.y)
    for n in ("neck_01", "neck_02", "neck_03", "neck_04"):
        e = pbs[n].rotation_euler
        pbs[n].rotation_euler = (e[0] - w * 0.2 * chest, e[1], e[2])
    e = pbs["head"].rotation_euler
    pbs["head"].rotation_euler = (e[0] - w * 0.1 * chest, e[1], e[2])
    bpy.context.view_layer.update()
    if head_z is not None:
        bones = {n: tuple(pbs[n].rotation_euler) for n in ("neck_01", "neck_02", "head")}
        cur_z = pbs["head"].head.z
        L._level_head(rig, bones, cur_z + (head_z - cur_z) * w)


# ---- clips -------------------------------------------------------------------------------------------------------------

def _anchor_offset(rest, pitch):
    """The anchor's height above the pelvis head at an attitude."""
    pel = rest[5]
    dy, dz = _rot(rest[0][0] - pel[0], rest[0][1] - pel[1], pitch)
    return dz


def takeoff_chain(rig, frames, prm=PARAMS):
    """Simulate the chain over the takeoff from lift-off on; returns per frame armature-space nodes and neck base (None
    before lift-off)."""
    rest, neck = rest_nodes(rig)
    i0 = next(i for i, fr in enumerate(frames) if fr["lineW"] > 0) - 1
    anchors, pitches = [], []
    for fr in frames[i0:]:
        p = fr["pitch"]
        z = fr["bodyH"] + _anchor_offset(rest, p) + fr["heave"]
        anchors.append((rest[0][0] - fr["x"], z))
        pitches.append(p)
    sim = simulate(rest, anchors, pitches, prm)
    out = [None] * i0
    for k, fr in enumerate(frames[i0:]):
        nodes = [(y + fr["x"], z) for (y, z) in sim[k]]
        nb = neck_base(rest, neck, (anchors[k][0] + fr["x"], anchors[k][1]), pitches[k])
        out.append((nodes, nb))
    return out


def loop_chain(rig, frames, c, prm=PARAMS, cycles=4):
    """Simulate the chain over `cycles` repeats of a flight loop (flight_loops frames) and keep the last, settled
    cycle, its seam eased; per loop frame armature-space nodes and neck base."""
    rest, neck = rest_nodes(rig)
    n = len(frames)
    anchors, pitches = [], []
    for it in range(cycles * n):
        fr = frames[it % n]
        x = c["speed"] * it / FPS
        anchors.append((rest[0][0] - x, fr["chestZ"] + (rest[0][1] - F.CHEST_Z)))
        pitches.append(fr["root"][1])
    sim = simulate(rest, anchors, pitches, prm)
    out = []
    for k in range(n):
        it = (cycles - 1) * n + k
        x = c["speed"] * it / FPS
        nodes = [(y + x, z) for (y, z) in sim[it]]
        nb = neck_base(rest, neck, (anchors[it][0] + x, anchors[it][1]), pitches[it])
        out.append((nodes, nb))
    for j in range(6):                                  # seam
        w = (j + 1) / 7
        a, b = out[n - 6 + j], out[0]
        out[n - 6 + j] = ([(p[0] * (1 - w) + q[0] * w, p[1] * (1 - w) + q[1] * w) for p, q in zip(a[0], b[0])],
                          (a[1][0] * (1 - w) + b[1][0] * w, a[1][1] * (1 - w) + b[1][1] * w))
    return out
