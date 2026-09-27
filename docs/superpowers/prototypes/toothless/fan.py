"""Fan-fold membranes and spars (main wings, hip wings, tail fins), skinned by vertex groups.

A fan = ribs radiating from a hub. Each panel between consecutive ribs is a (u along the ribs,
v across) grid whose vertices blend the two ribs' weights by v and each rib's a/b bones by u —
so closing the ribs closes the membrane like a hand fan.
"""
import math
import bmesh
import bpy
from mathutils import Vector


def _vec(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


def _blend(*pairs):
    out = {}
    for w, weights in pairs:
        for k, v in weights.items():
            out[k] = out.get(k, 0.0) + w * v
    return out


def rib_weights(rib, u):
    """rib = (bone_a, bone_b) or (bone,). Two-bone ribs hand over around their midpoint."""
    if len(rib) == 1:
        return {rib[0]: 1.0}
    t = min(1.0, max(0.0, (u - 0.35) / 0.3))
    return {rib[0]: 1 - t, rib[1]: t}


class MeshBuilder:
    def __init__(self):
        self.bm = bmesh.new()
        self.weights = []  # per-vertex {group: w}
        self.mat_index = []

    def vert(self, p, w):
        v = self.bm.verts.new(_vec(p))
        self.weights.append(w)
        return v

    def quad(self, a, b, c, d, mat=0):
        f = self.bm.faces.new([a, b, c, d])
        f.material_index = mat
        return f

    def to_object(self, name, materials):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        for m in materials:
            me.materials.append(m)
        groups = {}
        for vi, w in enumerate(self.weights):
            tot = sum(w.values()) or 1.0
            for g, val in w.items():
                if val <= 1e-4:
                    continue
                if g not in groups:
                    groups[g] = ob.vertex_groups.new(name=g)
                groups[g].add([vi], val / tot, "REPLACE")
        for p in me.polygons:
            p.use_smooth = True
        return ob


def fan_panels(mb, hub, tips, ribs, scallop, billow, down, nu=14, nv=6, hub_weights=None, hub_zone=0.08, mat=0):
    """Panels between consecutive ribs. `down` = unit vector the membrane billows toward."""
    hub = _vec(hub); tips = [_vec(t) for t in tips]; down = _vec(down)
    for i in range(len(tips) - 1):
        grid = []
        for iu in range(nu + 1):
            u = iu / nu
            row = []
            for iv in range(nv + 1):
                v = iv / nv
                edge = tips[i].lerp(tips[i + 1], v)
                edge = edge + (hub - edge) * (scallop * math.sin(math.pi * v))
                p = hub.lerp(edge, u) + down * (billow * math.sin(math.pi * v) * u)
                w = _blend((1 - v, rib_weights(ribs[i], u)), (v, rib_weights(ribs[i + 1], u)))
                if hub_weights and u < hub_zone:
                    f = 1 - u / hub_zone
                    w = _blend((1 - f, w), (f, hub_weights))
                row.append(mb.vert(p, w))
            grid.append(row)
        for iu in range(nu):
            for iv in range(nv):
                mb.quad(grid[iu][iv], grid[iu + 1][iv], grid[iu + 1][iv + 1], grid[iu][iv + 1], mat)


def coons_panel(mb, top, bottom, left, right, weight_fn, ni=12, nj=8, sag=0.0, down=(0, 0, -1), mat=0):
    """Bilinear Coons patch. top(s)/bottom(s) for s in [0,1]; left(t)/right(t) for t in [0,1].
    weight_fn(s, t) -> {group: w}."""
    down = _vec(down)
    P00, P10, P01, P11 = top(0), top(1), bottom(0), bottom(1)
    grid = []
    for ii in range(ni + 1):
        s = ii / ni
        col = []
        for jj in range(nj + 1):
            t = jj / nj
            p = (top(s) * (1 - t) + bottom(s) * t + left(t) * (1 - s) + right(t) * s
                 - (P00 * (1 - s) * (1 - t) + P10 * s * (1 - t) + P01 * (1 - s) * t + P11 * s * t))
            p = p + down * (sag * math.sin(math.pi * s) * math.sin(math.pi * t))
            col.append(mb.vert(p, weight_fn(s, t)))
        grid.append(col)
    for ii in range(ni):
        for jj in range(nj):
            mb.quad(grid[ii][jj], grid[ii + 1][jj], grid[ii + 1][jj + 1], grid[ii][jj + 1], mat)


def spar(mb, a, b, r0, r1, weights, segments=10, mat=0):
    """Tapered tube from a to b, weighted to `weights` (dict or callable(u) -> dict)."""
    a = _vec(a); b = _vec(b)
    d = (b - a); L = d.length; d.normalize()
    x = d.cross(Vector((0, 0, 1)))
    if x.length < 1e-6:
        x = d.cross(Vector((1, 0, 0)))
    x.normalize(); y = d.cross(x)
    rings = []
    steps = 6
    for k in range(steps + 1):
        u = k / steps
        c = a + d * (L * u); r = r0 + (r1 - r0) * u
        w = weights(u) if callable(weights) else weights
        rings.append([mb.vert(c + (x * math.cos(t) + y * math.sin(t)) * r, w)
                      for t in [2 * math.pi * j / segments for j in range(segments)]])
    for k in range(steps):
        for j in range(segments):
            j2 = (j + 1) % segments
            mb.quad(rings[k][j], rings[k][j2], rings[k + 1][j2], rings[k + 1][j], mat)
    # caps
    for ring, center, flip in ((rings[0], a, True), (rings[-1], b, False)):
        cv = mb.vert(center, weights(0 if flip else 1) if callable(weights) else weights)
        for j in range(segments):
            j2 = (j + 1) % segments
            face = [ring[j2], ring[j], cv] if flip else [ring[j], ring[j2], cv]
            mb.bm.faces.new(face).material_index = mat
