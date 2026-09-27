"""Signed-distance sculpting on a dense numpy grid, meshed through OpenVDB + Blender Volume-to-Mesh.

Conventions: Blender world space, metres. A Sculpt owns one dense float32 grid; primitives are
evaluated only inside their (padded) bounding box, then merged with smooth-min / smooth-max.
"""
import math
import numpy as np


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def rot(rx=0.0, ry=0.0, rz=0.0):
    """Local->world rotation matrix from XYZ Euler degrees (applied X, then Y, then Z)."""
    rx, ry, rz = map(math.radians, (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    X = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Y = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Z = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Z @ Y @ X


def look_rot(forward, up=(0, 0, 1)):
    """Rotation whose local +Y points along `forward` and local +Z as close to `up` as possible."""
    f = np.asarray(forward, float); f = f / np.linalg.norm(f)
    u = np.asarray(up, float)
    x = np.cross(f, u)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(f, (1, 0, 0))
    x /= np.linalg.norm(x)
    z = np.cross(x, f)
    return np.stack([x, f, z], axis=1)


class Prim:
    """A primitive: SDF function over points (..., 3) plus a conservative AABB."""

    def __init__(self, fn, bmin, bmax):
        self.fn, self.bmin, self.bmax = fn, np.asarray(bmin, float), np.asarray(bmax, float)


def sphere(c, r):
    c = np.asarray(c, float)
    return Prim(lambda P: np.linalg.norm(P - c, axis=-1) - r, c - r, c + r)


def ellipsoid(c, r, R=None):
    """Approximate ellipsoid SDF (iq). r = semi-axes in local x,y,z; R = local->world rotation."""
    c = np.asarray(c, float); r = np.asarray(r, float)

    def f(P):
        q = P - c
        if R is not None:
            q = q @ R
        k0 = np.linalg.norm(q / r, axis=-1)
        k1 = np.linalg.norm(q / (r * r), axis=-1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

    e = float(r.max())
    return Prim(f, c - e, c + e)


def round_cone(a, b, r1, r2):
    """Capsule with different end radii (iq sdRoundCone, arbitrary endpoints)."""
    a = np.asarray(a, float); b = np.asarray(b, float)
    ba = b - a; l2 = float(ba @ ba); rr = r1 - r2; a2 = l2 - rr * rr; il2 = 1.0 / l2

    def f(P):
        pa = P - a
        y = pa @ ba
        z = y - l2
        x = pa * l2 - y[..., None] * ba
        x2 = np.sum(x * x, axis=-1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = math.copysign(1.0, rr) * rr * rr * x2 if rr != 0 else np.zeros_like(x2)
        d1 = np.sqrt(x2 + z2) * il2 - r2
        d2 = np.sqrt(x2 + y2) * il2 - r1
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
        return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))

    m = max(r1, r2)
    return Prim(f, np.minimum(a, b) - m, np.maximum(a, b) + m)


def tube(points, radii):
    """Continuous tapered tube through points (hard union of round cones — no joint bulges)."""
    prims = [round_cone(points[i], points[i + 1], radii[i], radii[i + 1]) for i in range(len(points) - 1)]

    def f(P):
        d = prims[0].fn(P)
        for p in prims[1:]:
            d = np.minimum(d, p.fn(P))
        return d

    return Prim(f, np.min([p.bmin for p in prims], axis=0), np.max([p.bmax for p in prims], axis=0))


def squashed(prim, center, scale):
    """Non-uniformly scale a primitive about `center` (scale < 1 flattens that axis).
    The field is divided by the largest stretch so it stays a (conservative) distance bound."""
    c = np.asarray(center, float); s = np.asarray(scale, float)
    fn = prim.fn

    def f(P):
        return fn(c + (P - c) / s) * float(s.min())

    lo = c + (prim.bmin - c) * s
    hi = c + (prim.bmax - c) * s
    return Prim(f, np.minimum(lo, hi), np.maximum(lo, hi))


def box(c, half, R=None, rounding=0.0):
    c = np.asarray(c, float); h = np.asarray(half, float) - rounding

    def f(P):
        q = P - c
        if R is not None:
            q = q @ R
        d = np.abs(q) - h
        return np.linalg.norm(np.maximum(d, 0.0), axis=-1) + np.minimum(np.max(d, axis=-1), 0.0) - rounding

    e = float(np.linalg.norm(half))
    return Prim(f, c - e, c + e)


class Sculpt:
    def __init__(self, lo, hi, voxel):
        self.lo = np.asarray(lo, float); self.hi = np.asarray(hi, float); self.voxel = voxel
        self.shape = tuple(int(n) for n in np.ceil((self.hi - self.lo) / voxel).astype(int) + 1)
        self.d = np.full(self.shape, 10.0, dtype=np.float32)

    def _region(self, bmin, bmax):
        i0 = np.maximum(np.floor((bmin - self.lo) / self.voxel).astype(int), 0)
        i1 = np.minimum(np.ceil((bmax - self.lo) / self.voxel).astype(int) + 1, np.array(self.shape))
        if np.any(i1 <= i0):
            return None, None
        axes = [self.lo[i] + np.arange(i0[i], i1[i]) * self.voxel for i in range(3)]
        X, Y, Z = np.meshgrid(*axes, indexing="ij")
        return (slice(i0[0], i1[0]), slice(i0[1], i1[1]), slice(i0[2], i1[2])), np.stack([X, Y, Z], axis=-1)

    def add(self, prim, k=0.0):
        self._merge(prim, k, "union")

    def sub(self, prim, k=0.0):
        self._merge(prim, k, "sub")

    def mirror_add(self, make, k=0.0):
        """make(s) builds a primitive for side s in (+1, -1)."""
        for s in (1, -1):
            self.add(make(s), k)

    def mirror_sub(self, make, k=0.0):
        for s in (1, -1):
            self.sub(make(s), k)

    def _merge(self, prim, k, op):
        pad = k + 2 * self.voxel
        sl, P = self._region(prim.bmin - pad, prim.bmax + pad)
        if sl is None:
            return
        d = prim.fn(P).astype(np.float32)
        if op == "union":
            self.d[sl] = smin(self.d[sl], d, k)
        else:
            self.d[sl] = smax(self.d[sl], -d, k)

    def to_mesh(self, name, vdb_path):
        """Mesh the zero level set via OpenVDB + Volume-to-Mesh. Returns a new bpy mesh object."""
        import bpy, openvdb
        band = 4 * self.voxel
        dens = np.clip(-self.d, -band, None).astype(np.float32)  # >0 inside
        grid = openvdb.FloatGrid(-band)
        grid.copyFromArray(dens)
        grid.name = "density"
        grid.transform = openvdb.createLinearTransform(voxelSize=self.voxel)
        openvdb.write(vdb_path, grids=[grid])
        sc = bpy.context.scene
        vol_data = bpy.data.volumes.new(name + "_vol")
        vol_data.filepath = vdb_path
        vol = bpy.data.objects.new(name + "_vol", vol_data)
        vol.location = self.lo
        sc.collection.objects.link(vol)
        me = bpy.data.meshes.new(name)
        obj = bpy.data.objects.new(name, me)
        sc.collection.objects.link(obj)
        mod = obj.modifiers.new("v2m", "VOLUME_TO_MESH")
        mod.object = vol
        mod.grid_name = "density"
        mod.threshold = 0.0
        mod.resolution_mode = "GRID"
        mod.adaptivity = 0.0
        dg = bpy.context.evaluated_depsgraph_get()
        baked = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        obj.modifiers.clear()
        old = obj.data
        obj.data = baked
        baked.name = name
        bpy.data.meshes.remove(old)
        bpy.data.objects.remove(vol)
        bpy.data.volumes.remove(vol_data)
        for p in baked.polygons:
            p.use_smooth = True
        return obj
