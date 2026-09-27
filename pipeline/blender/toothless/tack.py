"""Hiccup's tack: saddle (seat + pommel and cantle rolls), two girth straps, left stirrup strap + pedal plate,
the fin-linkage cable along the left flank and tail, and the clamp ring at the prosthetic fin's root."""
import math
import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import anatomy as A


def _bvh(body):
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(body.evaluated_get(dg), dg)


def _drop(bvh, x, y, z_from=3.0):
    """Body surface point + normal straight below (x, y); (None, None) when the ray misses."""
    hit, normal, _, _ = bvh.ray_cast(Vector((x, y, z_from)), Vector((0, 0, -1)))
    return hit, normal


def _obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def _solidify(ob, thickness, offset):
    mod = ob.modifiers.new("solid", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="solid")


def _bind(ob, rig, weight_fn):
    """weight_fn(co) -> {bone: w}: vertex groups + armature modifier + parent to the rig."""
    groups = {}
    for v in ob.data.vertices:
        w = weight_fn(v.co)
        tot = sum(w.values()) or 1.0
        for g, val in w.items():
            if g not in groups:
                groups[g] = ob.vertex_groups.new(name=g)
            groups[g].add([v.index], val / tot, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    ob.parent = rig


def spine_weight(y):
    """Blend between spine bones by position along the back (bone midpoints)."""
    pts = [("chest", -0.72), ("spine_03", -0.44), ("spine_02", -0.15), ("spine_01", 0.15), ("pelvis", 0.46)]
    if y <= pts[0][1]:
        return {pts[0][0]: 1.0}
    if y >= pts[-1][1]:
        return {pts[-1][0]: 1.0}
    for (a, ya), (b, yb) in zip(pts, pts[1:]):
        if y <= yb:
            t = (y - ya) / (yb - ya)
            return {a: 1 - t, b: t}


def tail_weight(y):
    """Tail bone i spans TAIL_PTS[i-1] -> TAIL_PTS[i]; weights hand over across each joint (outer 30 % of each side)."""
    ys = [float(p[1]) for p in A.TAIL_PTS]
    if y <= ys[0]:
        return {"pelvis": 1.0}
    for i in range(len(ys) - 1):
        if y <= ys[i + 1]:
            t = (y - ys[i]) / (ys[i + 1] - ys[i])
            bone = f"tail_{i + 1:02d}"
            if t > 0.7 and i + 2 <= 12:
                k = (t - 0.7) / 0.6
                return {bone: 1 - k, f"tail_{i + 2:02d}": k}
            if t < 0.3:
                k = (0.3 - t) / 0.6
                return {bone: 1 - k, ("pelvis" if i == 0 else f"tail_{i:02d}"): k}
            return {bone: 1.0}
    return {"tail_12": 1.0}


def tube(name, pts, radius, mat, segs=8, closed=False):
    """Round tube through `pts` (Vectors)."""
    bm = bmesh.new()
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        a = pts[(i - 1) % n] if closed else pts[max(i - 1, 0)]
        b = pts[(i + 1) % n] if closed else pts[min(i + 1, n - 1)]
        t = (b - a).normalized()
        x = t.cross(Vector((0, 0, 1)))
        if x.length < 1e-6:
            x = t.cross(Vector((1, 0, 0)))
        x.normalize()
        y = t.cross(x)
        rings.append([bm.verts.new(p + (x * math.cos(2 * math.pi * j / segs) + y * math.sin(2 * math.pi * j / segs)) * radius)
                      for j in range(segs)])
    for i in range(n if closed else n - 1):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for j in range(segs):
            j2 = (j + 1) % segs
            bm.faces.new([r0[j], r0[j2], r1[j2], r1[j]])
    return _obj(name, bm, mat)


def saddle(rig, M, bvh):
    """Seat: a leather sheet draped 1.5 cm above the back and solidified 3 cm inward (no gap; the underside hides in
    the body), plus a pommel roll across the front edge and a taller cantle roll across the back edge."""
    nx, ny = 10, 10
    y0, y1 = A.SADDLE_Y
    hw = A.SADDLE_HALF_WIDTH
    rows = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x, y = -hw + 2 * hw * i / nx, y0 + (y1 - y0) * j / ny
            hit, n = _drop(bvh, x, y)
            if hit is None:
                raise RuntimeError(f"saddle ray missed the body at ({x:.2f}, {y:.2f})")
            row.append(hit + n * 0.015)
        rows.append(row)
    bm = bmesh.new()
    verts = [[bm.verts.new(p) for p in row] for row in rows]
    for j in range(ny):
        for i in range(nx):
            bm.faces.new([verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]])
    seat = _obj("Saddle", bm, M["leather"])
    _solidify(seat, 0.03, -1.0)

    def weight(co):
        return {"saddle": 0.7, **{k: v * 0.3 for k, v in spine_weight(co.y).items()}}

    _bind(seat, rig, weight)
    pommel = tube("SaddlePommel", [p + Vector((0, 0, 0.03)) for p in rows[0][1:-1]], 0.03, M["leather"])
    cantle = tube("SaddleCantle", [p + Vector((0, 0, 0.045)) for p in rows[-1][1:-1]], 0.045, M["leather"])
    for ob in (pommel, cantle):
        _bind(ob, rig, weight)
    return [seat, pommel, cantle]


def girth(rig, bvh, name, y, M):
    """A 5 cm band hugging the body cross-section at `y` (rays cast inward around the body axis)."""
    centre = Vector((0.0, y, 1.0))
    ring = []
    for k in range(48):
        a = 2 * math.pi * k / 48
        d = Vector((math.cos(a), 0.0, math.sin(a)))
        hit, n, _, _ = bvh.ray_cast(centre + d * 1.4, -d)
        if hit is None:
            raise RuntimeError(f"{name}: ray {k} missed the body")
        ring.append(hit + n * 0.006)
    bm = bmesh.new()
    front = [bm.verts.new(p + Vector((0, -0.025, 0))) for p in ring]
    back = [bm.verts.new(p + Vector((0, 0.025, 0))) for p in ring]
    for k in range(48):
        k2 = (k + 1) % 48
        bm.faces.new([front[k], front[k2], back[k2], back[k]])
    ob = _obj(name, bm, M["leather"])
    _solidify(ob, 0.008, 1.0)
    _bind(ob, rig, lambda co: spine_weight(y))
    return ob


def build_all(rig, body, M):
    bvh = _bvh(body)
    objs = saddle(rig, M, bvh)
    # GirthFront sits well forward of the pedal/stirrup (both at y = PEDAL_L.y = -0.28) so the strap and the
    # pedal plate read as two distinct pieces of tack instead of tangling together.
    objs += [girth(rig, bvh, "GirthFront", -0.42, M), girth(rig, bvh, "GirthRear", -0.12, M)]

    # pedal plate 6 cm outside the left flank at the pedal pivot (clears the plate's own 4.5 cm half-width so it
    # hangs clean of the flank instead of embedding in it); stirrup strap from the saddle's left edge down to it
    py, pz = float(A.PEDAL_L[1]), float(A.PEDAL_L[2])
    side, _, _, _ = bvh.ray_cast(Vector((1.5, py, pz)), Vector((-1, 0, 0)))
    if side is None:
        raise RuntimeError("pedal ray missed the flank")
    plate = Vector((side.x + 0.06, py, pz))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.09, v.co.y * 0.16, v.co.z * 0.02)) + plate
    pedal = _obj("Pedal", bm, M["metal"])
    _bind(pedal, rig, lambda co: {"pedal_L": 1.0})
    edge, _ = _drop(bvh, A.SADDLE_HALF_WIDTH - 0.02, py)
    if edge is None:
        raise RuntimeError("stirrup ray missed the back")
    top = plate + Vector((0, 0, 0.03))
    strap = tube("StirrupStrap", [edge + Vector((0.01, 0, 0.01)), edge.lerp(top, 0.5) + Vector((0.03, 0, 0)), top], 0.012, M["leather"])
    _bind(strap, rig, lambda co: {"pedal_L": 1.0} if co.z < edge.z - 0.1 else {"saddle": 1.0})
    objs += [pedal, strap]

    # fin-linkage cable: pedal -> along the left flank -> along the tail's upper left -> the prosthetic fin hub
    path = [plate + Vector((0.0, 0.08, 0.0))]
    for y in (0.1, 0.5, 0.85):
        hit, n = _drop(bvh, 0.30, y)
        if hit is None:
            raise RuntimeError(f"cable ray missed the flank at y={y}")
        path.append(hit + n * 0.02)
    # detour around the hip-wing root: a straight hop from the last back sample to the first tail point would
    # cut within ~1.5 cm of the hip-wing hub (fan root, y=1.45), notching its membrane. The hip-wing fan only
    # extends toward the tail from its hub (every rib angle is 0-90 deg), so dropping onto the flank surface
    # short of the hub's y and well below its z clears the fan before the path rises back up to the tail points.
    hw_hub = A.HIP_WING_L["hub"]
    detour, dn, _, _ = bvh.ray_cast(Vector((1.5, 1.25, float(hw_hub[2]) - 0.25)), Vector((-1, 0, 0)))
    if detour is None:
        raise RuntimeError("cable ray missed the flank at the hip-wing detour")
    path.append(detour + dn * 0.02)
    diag = Vector((1.0, 0.0, 1.0)).normalized()
    for p, r in zip(A.TAIL_PTS[2:10], A.TAIL_RADII[2:10]):
        path.append(Vector(p) + diag * (float(r) + 0.012))
    hub = Vector(A.TAIL_FIN_L["hub"])
    path.append(hub + Vector((0.0, -0.05, 0.02)))
    cable = tube("FinCable", path, 0.007, M["metal"], segs=6)
    _bind(cable, rig, lambda co: {"pedal_L": 1.0} if (co - plate).length < 0.12
          else (spine_weight(co.y) if co.y < 0.8 else tail_weight(co.y)))
    objs.append(cable)

    # clamp ring around the tail at the prosthetic fin's root
    (y8, z8), (y9, z9) = (float(A.TAIL_PTS[8][1]), float(A.TAIL_PTS[8][2])), (float(A.TAIL_PTS[9][1]), float(A.TAIL_PTS[9][2]))
    hub_y = float(hub.y)
    zc = z8 + (hub_y - y8) * (z9 - z8) / (y9 - y8)
    rad = float(A.TAIL_RADII[8]) + 0.012
    ring = [Vector((math.cos(a) * rad, hub_y, zc + math.sin(a) * rad)) for a in (2 * math.pi * k / 24 for k in range(24))]
    clamp = tube("FinClamp", ring, 0.01, M["metal"], closed=True)
    _bind(clamp, rig, lambda co: tail_weight(hub_y))
    objs.append(clamp)
    return objs
