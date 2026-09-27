"""Toothless body+head SDF sculpt (bind pose). Returns a berk_sdf.Sculpt ready to mesh."""
import math
import numpy as np
from berk_sdf import Sculpt, sphere, ellipsoid, round_cone, tube, rot, squashed, polygon_slab
import anatomy as A

V = A.V
L = lambda p, s: V(p[0] * s, p[1], p[2])
HO = A.HEAD_OFFSET


# mouth: U-shaped lip line (left half, front -> corner), with the head offset applied
MOUTH_LINE_L = [V(0, -2.232, 1.515), V(0.09, -2.205, 1.508), V(0.18, -2.13, 1.50), V(0.25, -2.02, 1.50), V(0.3, -1.9, 1.51), V(0.33, -1.8, 1.53)]
MOUTH_LINE_L = [p + HO for p in MOUTH_LINE_L]
MOUTH_Z = 1.375
MOUTH_HALF_H = 0.008   # thinner slits (<=1 cm at 5 mm voxels) make Blender heat weighting fail


def mouth_polygon(outset=0.06):
    """XY polygon (counter-clockwise) of the mouth slit: the lip U pushed `outset` outward, closed behind the corners."""
    ctr = np.array([0.0, -1.86])
    left = []
    for i, p in enumerate(MOUTH_LINE_L):
        d = p[:2] - ctr; d /= np.linalg.norm(d)
        k = outset * (1.0 - i / (len(MOUTH_LINE_L) - 1)) ** 0.5   # full outset at the front, none at the corner
        left.append(p[:2] + d * k)
    right = [np.array([-q[0], q[1]]) for q in left[1:]][::-1]
    back = [np.array([MOUTH_LINE_L[-1][0] - 0.02, MOUTH_LINE_L[-1][1] + 0.05]), np.array([-(MOUTH_LINE_L[-1][0] - 0.02), MOUTH_LINE_L[-1][1] + 0.05])]
    poly = right + left + back   # right corner -> front -> left corner -> back left -> back right (CCW seen from +Z)
    return [list(q) for q in poly]


def build(voxel=0.007, lo=(-0.9, -2.36, -0.04), hi=(0.9, 5.08, 2.2)):
    S = Sculpt(lo=lo, hi=hi, voxel=voxel)
    FL, HL = A.FRONT_LEG_L, A.HIND_LEG_L

    # ---- torso: compact, deep chest, strong rump
    S.add(ellipsoid((0, -0.56, 1.00), (0.43, 0.52, 0.42)), 0.10)
    S.add(ellipsoid((0, -0.88, 0.90), (0.32, 0.27, 0.33)), 0.15)
    S.add(ellipsoid((0, 0.02, 1.04), (0.31, 0.46, 0.29)), 0.25)
    S.add(ellipsoid((0, 0.60, 1.02), (0.36, 0.40, 0.33)), 0.20)
    S.add(round_cone((0, -0.76, 1.27), (0, 0.72, 1.20), 0.16, 0.15), 0.16)
    S.mirror_add(lambda s: ellipsoid(L((0.27, -0.72, 0.98), s), (0.2, 0.3, 0.34), rot(0, s * 8, 0)), 0.12)
    S.mirror_add(lambda s: ellipsoid(L((0.27, 0.58, 0.90), s), (0.22, 0.36, 0.38), rot(-18, 0, 0)), 0.14)

    # ---- neck (short, thick) + head
    S.add(tube([V(0, -0.84, 1.22), V(0, -1.03, 1.30), V(0, -1.21, 1.39), V(0, -1.36, 1.46)], [0.34, 0.315, 0.29, 0.275]), 0.15)
    S.add(ellipsoid(V(0, -1.74, 1.72) + HO, (0.31, 0.33, 0.235)), 0.10)      # cranium (domed)
    S.add(ellipsoid(V(0, -1.84, 1.565) + HO, (0.345, 0.31, 0.165)), 0.10)    # cheeks
    S.add(ellipsoid(V(0, -2.03, 1.615) + HO, (0.235, 0.21, 0.15)), 0.09)     # muzzle
    S.add(ellipsoid(V(0, -2.15, 1.60) + HO, (0.175, 0.11, 0.125)), 0.07)     # muzzle front
    S.add(ellipsoid(V(0, -1.96, 1.455) + HO, (0.265, 0.25, 0.095)), 0.07)    # lower jaw
    S.add(ellipsoid(V(0, -2.07, 1.43) + HO, (0.17, 0.14, 0.07)), 0.05)       # chin
    S.mirror_add(lambda s: ellipsoid(L((0.195, -1.985, 1.81), s) + HO, (0.1, 0.09, 0.042), rot(-8, 0, 0)), 0.05)  # soft brow over the lid (thick enough that the socket wall never goes paper-thin)
    S.mirror_add(lambda s: ellipsoid(L((0.3, -1.86, 1.64), s) + HO, (0.08, 0.12, 0.07)), 0.06)                      # zygoma
    S.mirror_sub(lambda s: sphere(L(A.EYE_CENTER_L, s) + V(s * 0.008, -0.004, 0), A.EYE_RADIUS + 0.012), 0.02)     # sockets

    def lid_ring(s):
        c = L(A.EYE_CENTER_L, s); n = A.eye_dir(s)
        u = np.cross(n, V(0, 0, 1)); u /= np.linalg.norm(u); w = np.cross(u, n)
        R = A.EYE_RADIUS + 0.012
        return tube([c + (math.cos(a) * u + math.sin(a) * w) * R * 1.02 + n * 0.012 for a in np.linspace(0, 2 * math.pi, 25)], [0.015] * 25)
    # (no sculpted lid ring: the separate lid shells form the heavy-lidded look and blink)
    S.mirror_sub(lambda s: ellipsoid(L((0.062, -2.2, 1.708), s) + HO, (0.017, 0.024, 0.011), rot(-35, 0, s * 20)), 0.008)  # nostrils
    # mouth: a real slit through the head (upper/lower jaw join only behind the corners) so the jaw can open
    S.sub(polygon_slab(mouth_polygon(), MOUTH_Z, MOUTH_HALF_H, rounding=0.004), 0.004)

    # ---- legs: thick, pillar-like, big paws
    def paw(pw, s, fwd):
        S.add(ellipsoid(pw + V(0, 0.0, 0.012), (0.14, 0.18, 0.08)), 0.05)
        for tx in (-0.1, -0.034, 0.034, 0.1):
            S.add(ellipsoid(pw + V(s * tx, fwd, -0.01), (0.048, 0.07, 0.055)), 0.028)
    for s in (1, -1):
        sh, el, wr, pw = L(FL["shoulder"], s), L(FL["elbow"], s), L(FL["wrist"], s), L(FL["paw"], s)
        S.add(round_cone(sh, el, 0.17, 0.13), 0.09)
        S.add(ellipsoid(L((0.345, -0.64, 0.42), s), (0.11, 0.115, 0.16)), 0.06)
        S.add(round_cone(el, wr, 0.125, 0.10), 0.04)
        paw(pw, s, -0.14)
        hp, kn, hk, pw = L(HL["hip"], s), L(HL["knee"], s), L(HL["hock"], s), L(HL["paw"], s)
        S.add(round_cone(hp, kn, 0.22, 0.14), 0.12)
        S.add(round_cone(kn, hk, 0.13, 0.09), 0.05)
        S.add(round_cone(hk, pw + V(0, 0.03, 0.04), 0.09, 0.08), 0.04)
        paw(pw, s, -0.15)

    # ---- tail: one continuous taper
    S.add(tube(A.TAIL_PTS, A.TAIL_RADII), 0.18)

    # ---- dorsal spikes: triangular sawtooth, neck -> tail tip
    top_path = [(-1.30, 1.76), (-1.02, 1.60), (-0.7, 1.47), (-0.2, 1.39), (0.4, 1.36), (0.8, 1.33)] + \
        [(float(t[1]), float(t[2] + r * 0.97)) for t, r in zip(A.TAIL_PTS[1:], A.TAIL_RADII[1:])]
    ty = np.array([p[0] for p in top_path]); tz = np.array([p[1] for p in top_path])
    n = 30
    for i in range(n):
        y = -1.25 + i * (4.7 - -1.25) / (n - 1)
        z = float(np.interp(y, ty, tz)) - 0.012
        prof = np.interp(y, [-1.25, -0.6, 0.6, 2.0, 4.7], [0.07, 0.1, 0.16, 0.15, 0.07])
        base = V(0, y, z); tip = base + V(0, prof * 0.62, prof)
        S.add(squashed(round_cone(base, tip, prof * 0.42, 0.004), base, (0.33, 1, 1)), 0.01)
    return S




