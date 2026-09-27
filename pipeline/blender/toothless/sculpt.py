"""Toothless body+head SDF sculpt (bind pose). Returns a berk_sdf.Sculpt ready to mesh.

The head is modelled with the mouth closed. At bind the lower jaw is set open by anatomy.JAW_REST_CLOSE_RAD about
the jaw hinge — the slit the jaw opens from (heat weighting needs the lips apart) is a wedge, not a uniform gap — and
the engine applies the same angle as the jaw's rest rotation, which seals the lips along the whole lip line."""
import math
import numpy as np
from berk_sdf import Prim, Sculpt, ellipsoid, round_cone, tube, rot, polygon_slab, smin
import anatomy as A

V = A.V
L = lambda p, s: V(p[0] * s, p[1], p[2])

MOUTH_Z = 1.375           # the lip line, where the lips meet with the mouth closed
MOUTH_CORNER_Y = -1.875   # the lip line closes below the back of the eye (the film's short, cat-like mouth; no frog gape)
SLIT_ROUNDING = 0.004     # the lips' edge fillet
JAW_HINGE = np.asarray(A.JAW[0], float)
NOSTRIL_L = V(0.066, -2.2, 1.585)   # on the front of the rounded snout
# ear plates: twist about the plate's own length axis (degrees, mirrored by side) so its broad face looks out and a
# little forward and up — seen broad from the side and three-quarters, edge-on from above (the film's swept-back
# flaps). The bone only follows the length axis (anatomy.EARS_L); the twist is the plate's shape.
EAR_TWIST_DEG = {"ear_1": 65.0, "ear_2": 60.0, "ear_3": 50.0}


def ear_frame(ear, s):
    """Plate frame (3x3, local -> world) of an anatomy.EARS_L entry on side s: local Y along the ear's length (the
    bone), local Z the plate's thin axis."""
    name, _, _, _, _, pitch, yaw, roll = ear
    t = math.radians(EAR_TWIST_DEG[name] * s)
    twist = np.array([[math.cos(t), 0.0, math.sin(t)], [0.0, 1.0, 0.0], [-math.sin(t), 0.0, math.cos(t)]])
    return A.euler_matrix(pitch, roll * s, yaw * s) @ twist


def eye_basis(s):
    """Eye frame (matching parts.eye_frame) as a 3x3 whose columns are the eye's lateral axis r, gaze n and up."""
    n = np.asarray(A.eye_dir(s), float)
    up = np.array([0.0, 0.0, 1.0]) - n * n[2]
    up /= np.linalg.norm(up)
    return np.stack([np.cross(up, n), n, up], axis=1)


def socket(s):
    """The eye socket carve: an ellipsoid in the eye frame, set 2 cm forward along the gaze. Long along the gaze, it
    opens the front of the eye; flattened vertically it stays inside the lid shells' outer surface (1.045 R + 8 mm
    = 0.098 m) above and below the eye, so the skin overlaps the lids and they emerge from under it; tight along r,
    the skin pinches the eye corners."""
    B = eye_basis(s)
    return ellipsoid(L(A.EYE_CENTER_L, s) + B[:, 1] * 0.02, (0.097, 0.118, 0.092), B)


def close_jaw(P, a=None):
    """Rotate points about the jaw hinge's lateral axis by `a` (default: the rest-close angle; an array gives each
    point its own). The jaw bone's local X is world -X, so a positive angle lifts the front: it carries the opened
    lower jaw of the bind pose onto the closed head, and a negative angle opens it."""
    a = A.JAW_REST_CLOSE_RAD if a is None else a
    q = np.asarray(P, float) - JAW_HINGE
    c, s = np.cos(a), np.sin(a)
    out = q.copy()
    out[..., 1] = q[..., 1] * c + q[..., 2] * s
    out[..., 2] = -q[..., 1] * s + q[..., 2] * c
    return out + JAW_HINGE


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def jaw_weight(P):
    """How much of the jaw's opening a bind point takes: 1 below the bind slit's mid-surface, 0 above it, blended
    over half the local slit height (behind the lip corners, where upper and lower jaw join, the cheek shears
    smoothly), and faded out behind the hinge (the throat and neck stay put)."""
    P = np.asarray(P, float)
    band = np.maximum(0.25 * A.JAW_REST_CLOSE_RAD * np.maximum(0.0, JAW_HINGE[1] - P[..., 1]), 1e-4)
    below = _smoothstep(0.0, -band, slit_side(P))
    return below * _smoothstep(JAW_HINGE[1] + 0.04, JAW_HINGE[1] - 0.08, P[..., 1])


def warped(prim, pad=0.06):
    """A head primitive modelled with the mouth closed, as it sits at bind: the part below the lips opened with the
    jaw (sculpt field sampled where jaw_weight carries each bind point shut)."""
    return Prim(lambda P: prim.fn(close_jaw(P, jaw_weight(P) * A.JAW_REST_CLOSE_RAD)), prim.bmin - pad, prim.bmax + pad)


def head_volumes():
    """The head's volumes with the mouth closed, in union order: [(primitive, blend k)]. build() adds them warped
    open (warped) and the lip lines are solved on them. Broad and a little flatter on top than tall
    (salamander/cat), the eyes set into the sides of the face, tapering without a stop to a rounded snout; the
    lower jaw tucks under the upper."""
    vols = [
        (ellipsoid((0, -1.66, 1.60), (0.29, 0.31, 0.215)), 0.10),        # skull (top = A.CRANIUM_TOP)
        (ellipsoid((0, -1.90, 1.585), (0.30, 0.24, 0.17)), 0.10),        # face: broadest at the eyes, covering their tops
        (ellipsoid((0, -2.08, 1.46), (0.19, 0.16, 0.15)), 0.08),         # snout: a blunt front down to the lip
        (ellipsoid((0, -1.84, 1.42), (0.24, 0.32, 0.10)), 0.08),         # upper jaw (the lip line), narrower than the eyes
        (ellipsoid((0, -1.88, 1.325), (0.205, 0.29, 0.075)), 0.07),      # lower jaw: shallow, tucked under the upper
        (ellipsoid((0, -2.05, 1.31), (0.125, 0.13, 0.055)), 0.05),       # chin, ~3 cm behind the upper lip (encloses the jaw tail)
    ]
    for s in (1, -1):
        vols.append((ellipsoid(L((0.21, -1.72, 1.43), s), (0.085, 0.15, 0.10)), 0.07))   # masseter: full cheek behind the lip corner
    return vols


def _head_field(P):
    """The closed head's field (no neck or body)."""
    d = np.full(P.shape[:-1], 10.0)
    for prim, k in head_volumes():
        d = smin(d, prim.fn(P), k)
    return d


def _solve_lip_line(z, n=6):
    """A lip U (left half, front -> corner): where the closed head's surface crosses height z, on rays from a point
    on the midline level with the corner, fanned from straight ahead (0 deg) to straight out (90 deg: the corner)."""
    ctr = np.array([0.0, MOUTH_CORNER_Y, z])
    out = []
    for i in range(n):
        a = math.radians(90.0 * i / (n - 1))
        d = np.array([math.sin(a), -math.cos(a), 0.0])
        lo, hi = 0.0, 0.8                      # inside at the centre, outside 80 cm out
        for _ in range(48):
            mid = 0.5 * (lo + hi)
            if _head_field((ctr + d * mid)[None])[0] < 0.0:
                lo = mid
            else:
                hi = mid
        p = ctr + d * lo
        out.append(V(round(float(p[0]), 4), round(float(p[1]), 4), z))
    return out


# mouth: U-shaped lip line (left half, front -> corner) on the sculpted surface, and the lower lip's rim 1.5 cm below
# it (the head narrows under the lip line: the lower teeth follow this one), both with the mouth closed
MOUTH_LINE_L = _solve_lip_line(MOUTH_Z)
LOWER_LIP_L = _solve_lip_line(MOUTH_Z - 0.015)


def mouth_polygon(outset=0.06, corner_outset=0.0):
    """XY polygon (counter-clockwise) of the mouth slit: the lip U pushed `outset` outward at the front, easing to
    `corner_outset` at the corners, closed behind the corners."""
    ctr = np.array([0.0, -1.86])
    left = []
    for i, p in enumerate(MOUTH_LINE_L):
        d = p[:2] - ctr
        d /= np.linalg.norm(d)
        f = (1.0 - i / (len(MOUTH_LINE_L) - 1)) ** 0.5            # 1 at the front, 0 at the corner
        left.append(p[:2] + d * (outset * f + corner_outset * (1.0 - f)))
    right = [np.array([-q[0], q[1]]) for q in left[1:]][::-1]
    corner = left[-1]
    back = [np.array([corner[0] - 0.02, corner[1] + 0.05]), np.array([-(corner[0] - 0.02), corner[1] + 0.05])]
    poly = right + left + back   # right corner -> front -> left corner -> back left -> back right (CCW seen from +Z)
    return [list(q) for q in poly]


def slit_opening(y):
    """Height of the bind slit (m) at depth y: the rest-close angle times the distance in front of the hinge."""
    return A.JAW_REST_CLOSE_RAD * max(0.0, float(JAW_HINGE[1]) - float(y))


def slit_side(P):
    """Signed height (m) of points above the bind slit's mid-surface: > 0 on the upper lip side, < 0 on the lower."""
    P = np.asarray(P, float)
    return P[..., 2] - (MOUTH_Z - 0.5 * A.JAW_REST_CLOSE_RAD * np.maximum(0.0, JAW_HINGE[1] - P[..., 1]))


def mouth_slit(outset=0.06, extra=0.0, rounding=SLIT_ROUNDING, corner_outset=0.0):
    """The mouth slit at bind: the lip U (mouth_polygon(outset, corner_outset), closed behind the corners) between the
    upper lip plane and the lower lip plane opened with the jaw — a wedge slit_opening(y) tall that the rest close
    shuts. The core planes overlap by 2 x rounding, so the rounded slit (the lip fillets) closes to nothing rather
    than to a 2 x rounding gap. `extra` thickens it on both sides (the mouth material's search band)."""
    xy = polygon_slab(mouth_polygon(outset, corner_outset), MOUTH_Z, 10.0)   # tall slab: its field is the 2D distance
    top, bottom = MOUTH_Z - rounding + extra, MOUTH_Z + rounding - extra

    def f(P):
        dxy = xy.fn(P)
        dz = np.maximum(P[..., 2] - top, bottom - close_jaw(P)[..., 2])
        outside = np.sqrt(np.maximum(dxy, 0.0) ** 2 + np.maximum(dz, 0.0) ** 2)
        return outside + np.minimum(np.maximum(dxy, dz), 0.0) - rounding

    drop = slit_opening(xy.bmin[1]) + rounding + extra + 0.01
    return Prim(f, np.array([xy.bmin[0], xy.bmin[1], MOUTH_Z - drop]) - rounding,
                np.array([xy.bmax[0], xy.bmax[1], MOUTH_Z + rounding + extra + 0.01]) + rounding)


def dorsal_spikes():
    """Triangular sawtooth along the back, neck -> tail tip: [(base, tip, base_radius)], each base 1.2 cm under the
    skin of the midline. None under the saddle (they would tent it). parts.make_spikes builds them as plates."""
    # the sculpted back line at x = 0 (measured on build()'s field), then the top of the tail tube
    top_path = [(-1.30, 1.729), (-1.10, 1.659), (-0.90, 1.591), (-0.70, 1.541), (-0.50, 1.467), (-0.30, 1.431),
                (0.0, 1.406), (0.4, 1.390), (0.7, 1.384), (0.9, 1.341)] + \
        [(float(t[1]), float(t[2] + r * 0.97)) for t, r in zip(A.TAIL_PTS[1:], A.TAIL_RADII[1:])]
    ty = np.array([p[0] for p in top_path])
    tz = np.array([p[1] for p in top_path])
    y0, y1 = A.SADDLE_Y
    out = []
    n = 30
    for i in range(n):
        y = -1.25 + i * (4.7 - -1.25) / (n - 1)
        if y0 - 0.02 <= y <= y1 + 0.02:
            continue
        z = float(np.interp(y, ty, tz)) - 0.012
        prof = float(np.interp(y, [-1.25, -0.6, 0.6, 2.0, 4.7], [0.07, 0.1, 0.16, 0.15, 0.07]))
        base = V(0, y, z)
        out.append((base, base + V(0, prof * 0.62, prof), prof * 0.42))
    return out


def build(voxel=0.007, lo=(-0.9, -2.36, -0.04), hi=(0.9, 5.08, 2.2)):
    S = Sculpt(lo=lo, hi=hi, voxel=voxel)
    FL, HL = A.FRONT_LEG_L, A.HIND_LEG_L

    # ---- torso: a panther — a deep but narrow ribcage set between the front legs, a waist tucked up and in behind
    # it, a compact rump (not a ball)
    S.add(ellipsoid((0, -0.58, 1.00), (0.34, 0.50, 0.42)), 0.10)          # ribcage (keeps the chest depth)
    S.add(ellipsoid((0, -0.86, 0.92), (0.26, 0.26, 0.32)), 0.12)          # brisket
    S.add(ellipsoid((0, 0.02, 1.08), (0.25, 0.44, 0.25)), 0.20)           # waist: narrower, belly tucked up
    S.add(ellipsoid((0, 0.58, 1.04), (0.29, 0.38, 0.30)), 0.18)           # rump
    S.add(round_cone((0, -0.76, 1.27), (0, 0.72, 1.20), 0.16, 0.15), 0.16)   # back and spine
    S.mirror_add(lambda s: ellipsoid(L((0.25, -0.72, 0.98), s), (0.16, 0.28, 0.32), rot(0, s * 8, 0)), 0.12)   # shoulders
    S.mirror_add(lambda s: ellipsoid(L((0.24, 0.58, 0.90), s), (0.16, 0.34, 0.36), rot(-18, 0, 0)), 0.14)      # haunches

    # ---- neck (short, thick) + head
    S.add(tube([V(0, -0.84, 1.22), V(0, -1.03, 1.30), V(0, -1.21, 1.39), V(0, -1.36, 1.46)], [0.34, 0.315, 0.29, 0.275]), 0.15)
    for prim, k in head_volumes():
        S.add(warped(prim), k)

    def ear_base(ear, s):
        _, root, length, width, thick, *_ = ear
        R = ear_frame(ear, s)
        return ellipsoid(L(root, s) + R @ V(0, 0.18 * length, 0), (0.32 * width, 0.28 * length, 0.5 * thick), R)
    for ear in A.EARS_L[1:]:   # fleshy bases so the side ear plates grow out of the skin (their roots only graze it)
        S.mirror_add(lambda s, ear=ear: ear_base(ear, s), 0.04)
    # mouth-corner jowls: the slit runs 5 cm past the lip corners; thicken the cheek there so it ends inside solid
    # cheek and the corner teeth stay under the skin
    corner = MOUTH_LINE_L[-1]
    S.mirror_add(lambda s: warped(ellipsoid(L((corner[0] - 0.03, corner[1] + 0.04, MOUTH_Z), s), (0.03, 0.06, 0.035))), 0.03)
    S.mirror_sub(socket, 0.02)
    # (no sculpted lid ring: the separate lid shells frame the eye and blink)
    S.mirror_sub(lambda s: ellipsoid(L(NOSTRIL_L, s), (0.021, 0.045, 0.015), rot(-35, 0, s * 20)), 0.006)        # nostrils
    # mouth: a real slit through the head (upper/lower jaw join only behind the corners) so the jaw can open
    S.sub(mouth_slit(), 0.004)

    # ---- legs: short and powerful — thick all the way down (forearms and shins nearly as thick as the upper
    # limbs) into big paws
    def paw(pw, s, fwd):
        S.add(ellipsoid(pw + V(0, 0.0, 0.014), (0.155, 0.19, 0.085)), 0.05)
        for tx in (-0.1, -0.034, 0.034, 0.1):
            S.add(ellipsoid(pw + V(s * tx, fwd, -0.01), (0.052, 0.072, 0.058)), 0.028)
    for s in (1, -1):
        sh, el, wr, pw = L(FL["shoulder"], s), L(FL["elbow"], s), L(FL["wrist"], s), L(FL["paw"], s)
        S.add(round_cone(sh, el, 0.165, 0.14), 0.09)
        S.add(ellipsoid(L((0.345, -0.64, 0.42), s), (0.12, 0.125, 0.17)), 0.06)
        S.add(round_cone(el, wr, 0.14, 0.12), 0.05)
        paw(pw, s, -0.14)
        hp, kn, hk, pw = L(HL["hip"], s), L(HL["knee"], s), L(HL["hock"], s), L(HL["paw"], s)
        S.add(round_cone(hp, kn, 0.17, 0.15), 0.12)
        S.add(round_cone(kn, hk, 0.145, 0.115), 0.06)
        S.add(round_cone(hk, pw + V(0, 0.03, 0.04), 0.11, 0.10), 0.05)
        paw(pw, s, -0.15)

    # ---- tail: one continuous taper
    S.add(tube(A.TAIL_PTS, A.TAIL_RADII), 0.18)
    # (the dorsal spikes are separate crisp plates, parts.make_spikes: the 24k-face body cannot hold them)
    return S
