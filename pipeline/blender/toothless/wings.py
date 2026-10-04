"""Fan-fold wings: main wings, hip wings and tail fins as membranes + spars, skinned by vertex groups.

A fan = ribs radiating from a hub (the wrist). Each panel between consecutive ribs is a (u along the ribs,
v across) grid whose vertices blend the two ribs' weights by v and each rib's a/b bones by u, so closing the
ribs closes the membrane like a hand fan. The main wing's inner membrane (back -> arm -> last rib) is a Coons
patch. Every mesh is built in bind-pose world coordinates (object at the origin), parented to the rig with an
Armature modifier.

The main wings carry a `membrane_pleat_<side>` shape key (value 0 at rest): accordion offsets the motion system
blends in while folding. Neighbouring fan panels bulge in opposite directions; ribs, hub and spars stay put.
"""
import math
import bmesh
import bpy
from mathutils import Vector
import anatomy as A
import rig as R

TAIL_BACK = (0.0, 4.9, 0.49)   # the tail fins' inner edge runs along the tail from the fin hub to here
# bone chains as [(bone, mid-y), ...] sorted by y: membrane edges that run along the body ride them
SPINE_MIDS = sorted(((name, float(p[1] + q[1]) / 2) for (name, p), (_, q) in zip(A.SPINE, A.SPINE[1:])),
                    key=lambda e: e[1])
TAIL_MIDS = [(f"tail_{i + 1:02d}", float(p[1] + q[1]) / 2) for i, (p, q) in enumerate(zip(A.TAIL_PTS, A.TAIL_PTS[1:]))]


def _vec(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


def _blend(*pairs):
    """Weighted sum of weight dicts: _blend((a, {bone: w}), (b, {bone: w}), ...)."""
    out = {}
    for w, weights in pairs:
        for k, v in weights.items():
            out[k] = out.get(k, 0.0) + w * v
    return out


def _smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def rib_weights(rib, u):
    """rib = (bone_a, bone_b), (bone,) or a callable u -> weights. Two-bone ribs hand over around their midpoint."""
    if callable(rib):
        return rib(u)
    if len(rib) == 1:
        return {rib[0]: 1.0}
    t = min(1.0, max(0.0, (u - 0.35) / 0.3))
    return {rib[0]: 1 - t, rib[1]: t}


class MeshBuilder:
    """A bmesh plus, per vertex (in creation order = mesh order), skin weights {bone: w} and a pleat-key offset."""

    def __init__(self):
        self.bm = bmesh.new()
        self.weights = []
        self.pleat = []

    def vert(self, p, w, pleat=None):
        v = self.bm.verts.new(_vec(p))
        self.weights.append(w)
        self.pleat.append(pleat or Vector())
        return v

    def quad(self, a, b, c, d, mat=0):
        """A quad, or a triangle where a collapsed edge repeats a vertex (fan hub, Coons apex)."""
        f = self.bm.faces.new(list(dict.fromkeys((a, b, c, d))))
        f.material_index = mat
        return f

    def to_object(self, name, materials, pleat_key=None):
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
        if pleat_key:
            ob.shape_key_add(name="Basis", from_mix=False)
            key = ob.shape_key_add(name=pleat_key, from_mix=False)
            key.value = 0.0   # Blender 5.1 adds keys at 1.0; the bind pose shows the smooth membrane
            for i, v in enumerate(me.vertices):
                key.data[i].co = v.co + self.pleat[i]
        return ob


def _row_vert(mb, row, p, w, pleat):
    """Append a grid vertex; where the grid edge collapses to a point (fan hub, Coons apex) reuse the previous one.
    (mathutils is float32: the Coons sum lands within ~1e-6 of the apex; grid spacing is >= 1 cm.)"""
    if row and (p - row[-1].co).length < 1e-5:
        row.append(row[-1])
    else:
        row.append(mb.vert(p, w, pleat))


def fan_panels(mb, hub, tips, ribs, scallop, billow, down, nu=14, nv=6, hub_weights=None, hub_zone=0.08, mat=0,
               pleat=0.0):
    """Panels between consecutive ribs. `scallop` = trailing-edge cut depth (fraction of the way to the hub), one
    for every panel or a list per panel; `down` = unit vector the membrane billows toward; `pleat` = accordion
    offset amplitude for the pleat key (panel i bulges along +down when i is even, -down when odd)."""
    hub = _vec(hub)
    tips = [_vec(t) for t in tips]
    down = _vec(down)
    scallops = list(scallop) if isinstance(scallop, (list, tuple)) else [scallop] * (len(tips) - 1)
    for i in range(len(tips) - 1):
        sign = 1 if i % 2 == 0 else -1
        scallop = scallops[i]
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
                _row_vert(mb, row, p, w, down * (pleat * sign * math.sin(math.pi * v) * u))
            grid.append(row)
        for iu in range(nu):
            for iv in range(nv):
                mb.quad(grid[iu][iv], grid[iu + 1][iv], grid[iu + 1][iv + 1], grid[iu][iv + 1], mat)


def coons_panel(mb, top, bottom, left, right, weight_fn, ni=12, nj=8, sag=0.0, down=(0, 0, -1), mat=0, pleat=0.0):
    """Bilinear Coons patch. top(s)/bottom(s) for s in [0,1]; left(t)/right(t) for t in [0,1].
    weight_fn(s, t, p) -> {group: w} (p = the rest position); `pleat` = amplitude of the pleat-key offset
    sin(pi s) sin(2 pi t) along `down`."""
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
            _row_vert(mb, col, p, weight_fn(s, t, p), down * (pleat * math.sin(math.pi * s) * math.sin(2 * math.pi * t)))
        grid.append(col)
    for ii in range(ni):
        for jj in range(nj):
            mb.quad(grid[ii][jj], grid[ii + 1][jj], grid[ii + 1][jj + 1], grid[ii][jj + 1], mat)


def spar(mb, a, b, r0, r1, weights, segments=10, mat=0):
    """Capped tapered tube from a to b, weighted to `weights` (dict or callable(u) -> dict). No pleat offset."""
    a = _vec(a)
    b = _vec(b)
    d = b - a
    L = d.length
    d.normalize()
    x = d.cross(Vector((0, 0, 1)))
    if x.length < 1e-6:
        x = d.cross(Vector((1, 0, 0)))
    x.normalize()
    y = d.cross(x)
    rings = []
    steps = 6
    for k in range(steps + 1):
        u = k / steps
        c = a + d * (L * u)
        r = r0 + (r1 - r0) * u
        w = weights(u) if callable(weights) else weights
        rings.append([mb.vert(c + (x * math.cos(t) + y * math.sin(t)) * r, w)
                      for t in [2 * math.pi * j / segments for j in range(segments)]])
    for k in range(steps):
        for j in range(segments):
            j2 = (j + 1) % segments
            mb.quad(rings[k][j], rings[k][j2], rings[k + 1][j2], rings[k + 1][j], mat)
    for ring, center, flip in ((rings[0], a, True), (rings[-1], b, False)):
        cv = mb.vert(center, weights(0 if flip else 1) if callable(weights) else weights)
        for j in range(segments):
            j2 = (j + 1) % segments
            face = [ring[j2], ring[j], cv] if flip else [ring[j], ring[j2], cv]
            mb.bm.faces.new(face).material_index = mat


def _skin_to_rig(ob, rig):
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    ob.parent = rig
    return ob


def _chain_weights(chain, y):
    """Weights for a point at depth y along a bone chain [(bone, mid-y), ...]: the two bones whose midpoints bracket it."""
    if y <= chain[0][1]:
        return {chain[0][0]: 1.0}
    for (a, ya), (b, yb) in zip(chain, chain[1:]):
        if y <= yb:
            t = (y - ya) / (yb - ya)
            return {a: 1 - t, b: t}
    return {chain[-1][0]: 1.0}


def spine_weights_at(y):
    """Spine weights for a point on the back at depth y (the membrane root rides the spine)."""
    return _chain_weights(SPINE_MIDS, y)


def build_main_wing(rig, M, s, sfx):
    """Fan panels (hub -> 7 rib tips), the inner Coons membrane (back -> arm -> last rib), arm/rib spars, thumb claw."""
    W = A.MAIN_WING_L
    m = lambda p: _vec((p[0] * s, p[1], p[2]))
    root, elbow, hub = m(W["root"]), m(W["elbow"]), m(W["hub"])
    tips = [_vec(t) for t in A.fan_tips(W, s)]
    ribs = [(f"wing_rib{i + 1}_a_{sfx}", f"wing_rib{i + 1}_b_{sfx}") for i in range(len(tips))]
    humerus, forearm = f"wing_humerus_{sfx}", f"wing_forearm_{sfx}"
    mb = MeshBuilder()
    fan_panels(mb, hub, tips, ribs, W["scallop"], W["billow"], (0, 0, -1), hub_weights={forearm: 1.0}, pleat=0.05)
    attach = [m(p) for p in W["attach"]]
    last = tips[-1]

    def arm(u):          # leading edge: shoulder -> elbow -> wrist
        return root.lerp(elbow, u * 2) if u < 0.5 else elbow.lerp(hub, (u - 0.5) * 2)

    def trailing(u):     # membrane root along the back, then out to the last rib's tip
        if u < 0.6:
            k = u / 0.6
            return attach[0].lerp(attach[1], k * 2) if k < 0.5 else attach[1].lerp(attach[2], (k - 0.5) * 2)
        return attach[2].lerp(last, (u - 0.6) / 0.4)

    def w_top(u):
        if u < 0.45:
            return {humerus: 1.0}
        if u > 0.55:
            return {forearm: 1.0}
        return {humerus: (0.55 - u) / 0.1, forearm: (u - 0.45) / 0.1}

    def w_bottom(u):
        p = trailing(u)
        if u < 0.6:
            return spine_weights_at(p.y)
        f = (u - 0.6) / 0.4
        return _blend((1 - f, spine_weights_at(p.y)), (f, rib_weights(ribs[-1], 1.0)))

    # Around the wrist the forearm and the last rib act like two ribs of a fan (~76 deg apart spread, nearly parallel
    # folded): weighting the membrane between them by its angle around the wrist makes their opposite swings cancel,
    # as between the fan's ribs. Forearm-weighted membrane alone swings out past the folded arm (a balloon).
    planar = lambda v: Vector((v.x, v.y, 0.0))
    to_elbow, to_last = planar(elbow - hub), planar(last - hub)
    span = to_elbow.angle(to_last)

    def wrist_fan(p):
        d = planar(p - hub)
        f = min(1.0, max(0.0, to_elbow.angle(d) / span)) if d.length > 1e-6 else 0.0
        return {forearm: 1 - f, ribs[-1][0]: f}

    def weights(u, t, p):
        g = min(1.0, max(0.0, (u - 0.8) / 0.2))
        base = _blend((1 - t, w_top(u)), (t, w_bottom(u)))
        # interior of the forearm half only: the arm (t=0), trailing (t=1) and last-rib (g) edges keep their weights
        fan = _smoothstep(0.5, 0.62, u) * _smoothstep(0.0, 0.15, t) * _smoothstep(1.0, 0.65, t)
        base = _blend((1 - fan, base), (fan, wrist_fan(p)))
        return _blend((1 - g, base), (g, rib_weights(ribs[-1], t)))

    coons_panel(mb, top=arm, bottom=trailing, left=lambda t: root, right=lambda t: hub.lerp(last, t),
                weight_fn=weights, ni=14, nj=10, sag=0.06, pleat=0.045)
    spar(mb, root, elbow, 0.075, 0.055, {humerus: 1.0}, mat=1)
    spar(mb, elbow, hub, 0.055, 0.036, {forearm: 1.0}, mat=1)
    for i, tip in enumerate(tips):
        mid = hub + (tip - hub) * 0.5
        spar(mb, hub, mid, 0.026, 0.017, {ribs[i][0]: 1.0}, mat=1)
        spar(mb, mid, tip, 0.017, 0.005, {ribs[i][1]: 1.0}, mat=1)
    spar(mb, hub, hub + Vector((s * 0.05, -0.16, 0.02)), 0.03, 0.003, {f"wing_thumb_{sfx}": 1.0}, mat=2)
    ob = mb.to_object(f"Wing_{sfx}", [M["membrane"], M["skin"], M["claw"]], pleat_key=f"membrane_pleat_{sfx}")
    return _skin_to_rig(ob, rig)


def build_small_fan(rig, s, sfx, spec, prefix, root_bone, materials, extra_rib=None):
    """Single-bone-rib fan (hip wing, tail fin). `extra_rib` = (point, chain) prepends a spar-less inner rib from the
    hub to `point` along a bone chain [(bone, mid-y), ...], weighted along it so the edge follows the chain's bends."""
    hub = _vec((spec["hub"][0] * s, spec["hub"][1], spec["hub"][2]))
    tips = [_vec(t) for t in A.fan_tips(spec, s)]
    ribs = [(f"{prefix}_rib{i + 1}_{sfx}",) for i in range(len(tips))]
    spars = list(zip(tips, ribs))
    if extra_rib is not None:
        point, chain = _vec(extra_rib[0]), extra_rib[1]
        tips = [point] + tips
        ribs = [lambda u: _chain_weights(chain, hub.y + (point.y - hub.y) * u)] + ribs
    mb = MeshBuilder()
    fan_panels(mb, hub, tips, ribs, spec["scallop"], spec["billow"], (0, 0, -1), nu=8, nv=4,
               hub_weights={root_bone: 1.0}, hub_zone=0.12)
    for tip, rib in spars:
        spar(mb, hub, tip, 0.014, 0.004, {rib[0]: 1.0}, mat=1, segments=8)
    return _skin_to_rig(mb.to_object(f"{prefix}_{sfx}", materials), rig)


def build_all(rig, M):
    """Build and skin every fan part. M = materials by name (membrane, skin, claw, prosthetic, metal).
    Returns [Wing_L, Wing_R, hipwing_L, hipwing_R, tailfin_L, tailfin_R]; the left tail fin is Hiccup's red
    prosthetic (metal spars)."""
    out = {}
    for s, sfx in ((1, "L"), (-1, "R")):
        out[f"Wing_{sfx}"] = build_main_wing(rig, M, s, sfx)
        out[f"hipwing_{sfx}"] = build_small_fan(rig, s, sfx, A.HIP_WING_L, "hipwing", f"hipwing_root_{sfx}",
                                                [M["membrane"], M["skin"]])
        fin = [M["prosthetic"], M["metal"]] if sfx == "L" else [M["membrane"], M["skin"]]
        out[f"tailfin_{sfx}"] = build_small_fan(rig, s, sfx, A.TAIL_FIN_L, "tailfin", f"tailfin_root_{sfx}", fin,
                                                extra_rib=(TAIL_BACK, TAIL_MIDS))
    return [out[n] for n in ("Wing_L", "Wing_R", "hipwing_L", "hipwing_R", "tailfin_L", "tailfin_R")]


def fold_metrics(rig, objs, amount=1.0):
    """Fold, evaluate the skinned meshes, return the folded extents (armature space = world); resets the pose."""
    R.fold_wings(rig, amount)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    xs, ys, zs = [], [], []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = ob.matrix_world @ v.co
            xs.append(abs(p.x)); ys.append(p.y); zs.append(p.z)
        ev.to_mesh_clear()
    R.reset_pose(rig)
    return {"max_abs_x": max(xs), "min_z": min(zs), "max_y": max(ys)}
