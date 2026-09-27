"""Toothless anatomy — single source of truth for joints, bones and fan-wing layouts.

Blender coordinates, metres: X = dragon's LEFT, -Y = forward (head), +Z = up, ground at z = 0.
Right-side items mirror X. Bone specs: (name, head, tail, parent, roll_up_hint, deform).
"""
import math
import numpy as np

V = lambda *a: np.array(a, float)


def mirror(p):
    return V(-p[0], p[1], p[2])


HEAD_OFFSET = V(0, 0.04, -0.14)
EYE_CENTER_L = V(0.2, -2.0, 1.735) + HEAD_OFFSET
EYE_RADIUS = 0.086


def eye_dir(side):
    n = V(side * 0.55, -0.83, 0.1)
    return n / np.linalg.norm(n)


SPINE = [  # pelvis -> chest; each bone runs from point i to i+1 (toward the head)
    ("pelvis", V(0, 0.62, 1.02)), ("spine_01", V(0, 0.30, 1.06)), ("spine_02", V(0, 0.0, 1.10)),
    ("spine_03", V(0, -0.30, 1.14)), ("chest", V(0, -0.58, 1.18)), (None, V(0, -0.86, 1.23)),
]
NECK = [("neck_01", V(0, -0.86, 1.23)), ("neck_02", V(0, -1.03, 1.30)), ("neck_03", V(0, -1.21, 1.39)),
        ("neck_04", V(0, -1.36, 1.46)), (None, V(0, -1.50, 1.50))]
HEAD = (V(0, -1.50, 1.50), V(0, -2.24, 1.45))
JAW = (V(0, -1.70, 1.345), V(0, -2.16, 1.30))   # hinge kept BELOW the mouth slit (inside the lower-jaw volume) or heat weighting fails

TAIL_PTS = [V(0, 0.88, 1.03), V(0, 1.20, 1.00), V(0, 1.54, 0.97), V(0, 1.90, 0.93), V(0, 2.28, 0.88), V(0, 2.66, 0.83),
            V(0, 3.03, 0.78), V(0, 3.38, 0.73), V(0, 3.72, 0.68), V(0, 4.04, 0.63), V(0, 4.34, 0.58), V(0, 4.63, 0.53), V(0, 4.92, 0.48)]
TAIL_RADII = [0.27, 0.235, 0.205, 0.178, 0.154, 0.133, 0.114, 0.097, 0.082, 0.068, 0.056, 0.046, 0.036]

FRONT_LEG_L = {  # scapula top -> shoulder -> elbow -> wrist -> paw -> toe tip
    "scapula": V(0.20, -0.50, 1.28), "shoulder": V(0.31, -0.74, 0.95), "elbow": V(0.34, -0.60, 0.56),
    "wrist": V(0.34, -0.74, 0.17), "paw": V(0.34, -0.84, 0.07), "toe": V(0.34, -1.00, 0.04),
}
HIND_LEG_L = {  # hip -> knee -> hock -> paw -> toe tip
    "hip": V(0.29, 0.62, 0.97), "knee": V(0.34, 0.36, 0.60), "hock": V(0.33, 0.74, 0.30),
    "paw": V(0.33, 0.60, 0.07), "toe": V(0.33, 0.44, 0.04),
}

# ear plates: root, length, width, thickness, pitch, yaw, roll (degrees; yaw/roll mirror with side)
EARS_L = [
    ("ear_1", V(0.125, -1.62, 1.87) + HEAD_OFFSET, 0.34, 0.15, 0.05, 62, -14, -12),
    ("ear_2", V(0.25, -1.62, 1.77) + HEAD_OFFSET, 0.20, 0.09, 0.04, 30, -40, -30),
    ("ear_3", V(0.315, -1.70, 1.61) + HEAD_OFFSET, 0.13, 0.06, 0.035, 10, -68, -45),
]


def euler_matrix(pitch, roll, yaw):
    """XYZ Euler (degrees) -> rotation matrix, matching Blender rotation_euler (X then Y then Z)."""
    rx, ry, rz = map(math.radians, (pitch, roll, yaw))
    X = np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)], [0, math.sin(rx), math.cos(rx)]])
    Y = np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0], [-math.sin(ry), 0, math.cos(ry)]])
    Z = np.array([[math.cos(rz), -math.sin(rz), 0], [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])
    return Z @ Y @ X


def ear_axis(ear, side):
    _, root, length, _, _, pitch, yaw, roll = ear
    R = euler_matrix(pitch, roll * side, yaw * side)
    r = V(root[0] * side, root[1], root[2])
    return r, r + R @ V(0, length, 0)


# fan wings: root joint(s), then a fan of ribs radiating from `hub` (wrist) in the bind pose
MAIN_WING_L = {
    "root": V(0.26, -0.72, 1.42), "elbow": V(1.05, -0.45, 1.55), "hub": V(2.05, -0.62, 1.62),
    "rib_angles": [-6, 10, 26, 42, 58, 75, 94], "rib_lengths": [4.75, 4.2, 3.6, 3.05, 2.6, 2.2, 1.9],
    "attach": [V(0.26, -0.72, 1.42), V(0.25, -0.1, 1.40), V(0.25, 0.62, 1.30)],   # membrane root along the back
    "scallop": 0.2, "billow": 0.08,
}
HIP_WING_L = {   # the secondary wing pair sits on the base of the tail
    "hub": V(0.16, 1.45, 1.13),
    "rib_angles": [4, 30, 56, 82], "rib_lengths": [1.45, 1.3, 1.1, 0.85],
    "scallop": 0.18, "billow": 0.03,
}
TAIL_FIN_L = {   # long rudder-like fin along the tail end (left = the red prosthetic)
    "hub": V(0.04, 3.80, 0.69),
    "rib_angles": [48, 62, 76], "rib_lengths": [0.85, 1.05, 1.18],
    "scallop": 0.16, "billow": 0.0,
}

SADDLE_SEAT = V(0, -0.36, 1.46)
PEDAL_L = V(0.38, -0.28, 1.02)


def fan_tips(wing, side=1):
    hub = wing["hub"]
    tips = []
    for i, (a, l) in enumerate(zip(wing["rib_angles"], wing["rib_lengths"])):
        d = V(math.cos(math.radians(a)), math.sin(math.radians(a)), 0) * l
        tip = hub + d + V(0, 0, -0.06 - 0.01 * i if "root" in wing else 0)
        tips.append(V(tip[0] * side, tip[1], tip[2]) if side < 0 else tip)
    return tips


def bone_specs():
    """All bones: (name, head, tail, parent, deform). Heads/tails in Blender space."""
    b = []
    for i in range(len(SPINE) - 1):
        b.append((SPINE[i][0], SPINE[i][1], SPINE[i + 1][1], SPINE[i - 1][0] if i > 0 else None, True))
    for i in range(len(NECK) - 1):
        parent = "chest" if i == 0 else NECK[i - 1][0]
        b.append((NECK[i][0], NECK[i][1], NECK[i + 1][1], parent, True))
    b.append(("head", HEAD[0], HEAD[1], "neck_04", True))
    b.append(("jaw", JAW[0], JAW[1], "head", True))
    for i in range(len(TAIL_PTS) - 1):
        b.append((f"tail_{i+1:02d}", TAIL_PTS[i], TAIL_PTS[i + 1], "pelvis" if i == 0 else f"tail_{i:02d}", True))
    for side, sfx in ((1, "L"), (-1, "R")):
        m = (lambda p: p) if side > 0 else mirror
        f = {k: m(v) for k, v in FRONT_LEG_L.items()}
        b += [(f"front_scapula_{sfx}", f["scapula"], f["shoulder"], "chest", True),
              (f"front_humerus_{sfx}", f["shoulder"], f["elbow"], f"front_scapula_{sfx}", True),
              (f"front_radius_{sfx}", f["elbow"], f["wrist"], f"front_humerus_{sfx}", True),
              (f"front_metacarpal_{sfx}", f["wrist"], f["paw"], f"front_radius_{sfx}", True),
              (f"front_toes_{sfx}", f["paw"], f["toe"], f"front_metacarpal_{sfx}", True)]
        h = {k: m(v) for k, v in HIND_LEG_L.items()}
        b += [(f"hind_femur_{sfx}", h["hip"], h["knee"], "pelvis", True),
              (f"hind_tibia_{sfx}", h["knee"], h["hock"], f"hind_femur_{sfx}", True),
              (f"hind_metatarsal_{sfx}", h["hock"], h["paw"], f"hind_tibia_{sfx}", True),
              (f"hind_toes_{sfx}", h["paw"], h["toe"], f"hind_metatarsal_{sfx}", True)]
        for ear in EARS_L:
            head, tail = ear_axis(ear, side)
            b.append((f"{ear[0]}_{sfx}", head, tail, "head", True))
        w = MAIN_WING_L
        root, elbow, hub = m(w["root"]), m(w["elbow"]), m(w["hub"])
        b += [(f"wing_humerus_{sfx}", root, elbow, "chest", True),
              (f"wing_forearm_{sfx}", elbow, hub, f"wing_humerus_{sfx}", True),
              (f"wing_thumb_{sfx}", hub, hub + V(side * 0.05, -0.16, 0.02), f"wing_forearm_{sfx}", True)]
        for i, tip in enumerate(fan_tips(w, side)):
            mid = hub + (tip - hub) * 0.5
            b += [(f"wing_rib{i+1}_a_{sfx}", hub, mid, f"wing_forearm_{sfx}", True),
                  (f"wing_rib{i+1}_b_{sfx}", mid, tip, f"wing_rib{i+1}_a_{sfx}", True)]
        hw = HIP_WING_L
        hhub = m(hw["hub"])
        b.append((f"hipwing_root_{sfx}", hhub - V(side * 0.06, 0, 0), hhub, "tail_02", True))
        for i, tip in enumerate(fan_tips(hw, side)):
            b.append((f"hipwing_rib{i+1}_{sfx}", hhub, tip, f"hipwing_root_{sfx}", True))
        tf = TAIL_FIN_L
        thub = m(tf["hub"])
        b.append((f"tailfin_root_{sfx}", thub - V(side * 0.03, 0.05, 0), thub, "tail_09", True))
        for i, tip in enumerate(fan_tips(tf, side)):
            b.append((f"tailfin_rib{i+1}_{sfx}", thub, tip, f"tailfin_root_{sfx}", True))
    b.append(("saddle", SADDLE_SEAT, SADDLE_SEAT + V(0, -0.25, 0.02), "spine_03", True))
    b.append(("pedal_L", PEDAL_L, PEDAL_L + V(0, -0.14, 0), "saddle", True))
    return b


JAW_OPEN_SIGN = -1          # the jaw opens with a NEGATIVE rotation about its local X (verified in the prototype)
MOUTH_ANCHOR = V(0, -2.20, 1.375)   # front of the mouth slit (plasma muzzle)

# paw contact points (left; mirror X for right) — sole centre, toe tip, heel. Derived from the sculpted paws
# (sculpt.build: paw pad ellipsoid at paw + (0, 0, 0.012) r (0.14, 0.18, 0.08); toes at paw + (±tx, fwd, -0.01) r 0.07 in y)
CONTACTS_L = {
    "front": {"bone": "front_toes", "sole": V(0.34, -0.86, 0.0), "toe": V(0.34, -1.05, 0.0), "heel": V(0.34, -0.68, 0.03)},
    "hind": {"bone": "hind_toes", "sole": V(0.33, 0.58, 0.0), "toe": V(0.33, 0.38, 0.0), "heel": V(0.33, 0.76, 0.03)},
}

# saddle footprint (shared by tack.py and sculpt.dorsal_spikes): between the wing roots and the waist
SADDLE_Y = (-0.58, -0.16)
SADDLE_HALF_WIDTH = 0.20      # stays inside the membrane attach line (x = 0.25)
CRANIUM_TOP = 1.72 + HEAD_OFFSET[2] + 0.235   # top of the cranium ellipsoid in sculpt.build (centre z 1.72 + HO, radius z 0.235)

# collision proxies: (name, bone, centre, radius) — all on the midline, fitted to the sculpt's main masses
PROXIES = [
    ("head", "head", V(0, -1.72, 1.58), 0.33), ("muzzle", "head", V(0, -2.02, 1.47), 0.20),
    ("neck", "neck_02", V(0, -1.10, 1.33), 0.30),
    ("chest", "chest", V(0, -0.62, 1.00), 0.44), ("belly", "spine_02", V(0, 0.00, 1.04), 0.32),
    ("hips", "pelvis", V(0, 0.60, 1.02), 0.36), ("tail_a", "tail_03", V(0, 1.72, 0.95), 0.20),
    ("tail_b", "tail_06", V(0, 2.85, 0.80), 0.13), ("tail_c", "tail_09", V(0, 3.88, 0.66), 0.08),
    ("tail_d", "tail_12", V(0, 4.80, 0.50), 0.045),
]

ANCHORS = {
    "eye_L": ("head", EYE_CENTER_L), "eye_R": ("head", mirror(EYE_CENTER_L)), "mouth": ("head", MOUTH_ANCHOR),
    "saddle": ("saddle", SADDLE_SEAT + V(0, 0, 0.06)), "pedal_L": ("pedal_L", PEDAL_L),
}

# limbs (bone base names; add _L/_R). pole = the direction the middle joint bends toward (Blender space);
# limits = allowed hinge rotation relative to the bind pose, degrees (consumed by the motion system's IK)
LIMBS = {
    "front": {"bones": ["front_scapula", "front_humerus", "front_radius", "front_metacarpal", "front_toes"],
              "pole": V(0, 1, 0),
              "limits": {"front_scapula": [-25, 25], "front_humerus": [-70, 60], "front_radius": [-5, 120],
                         "front_metacarpal": [-60, 70], "front_toes": [-40, 45]}},
    "hind": {"bones": ["hind_femur", "hind_tibia", "hind_metatarsal", "hind_toes"],
             "pole": V(0, -1, 0),
             "limits": {"hind_femur": [-70, 75], "hind_tibia": [-120, 5], "hind_metatarsal": [-10, 110],
                        "hind_toes": [-40, 45]}},
}


# per-bone rotation limits for the procedural chains, degrees from bind (pitch = local X, yaw = local Z, roll = local Y)
CHAIN_LIMITS = {
    "spine": {"pitch": 15, "yaw": 12, "roll": 8},
    "neck": {"pitch": 35, "yaw": 40, "roll": 15},
    "tail": {"pitch": 25, "yaw": 30, "roll": 10},
}


def blender_to_gltf(p):
    return (float(p[0]), float(p[2]), float(-p[1]))


def proportions():
    tips = fan_tips(MAIN_WING_L, 1)
    return {
        "length": float(TAIL_PTS[-1][1] - (HEAD[1][1] - 0.02)),
        "wingspan": float(2 * max(t[0] for t in tips)),
        "shoulderHeight": float(FRONT_LEG_L["scapula"][2]),   # withers height
        "hipHeight": float(HIND_LEG_L["hip"][2]),
        "headTop": float(CRANIUM_TOP),
    }
