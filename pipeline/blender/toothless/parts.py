"""Separately built parts, each bound to the rig: eyes (planar eye UVs), lids (blink/squint keys), teeth (teeth_out key),
tongue, ears, claws and the dorsal plates — plus the mouth-interior material on the sculpted body.

Every part's mesh is in bind-pose world coordinates (object at the origin, transforms applied)."""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix
import anatomy as A
import meshtools as MT
import sculpt as SB

V = A.V
# lids (upper, lower). Rest edges above/below the eye's equator: open and curious, the upper lid a thin rim over the
# top of the iris (<= ~15 % of its height), the lower lid barely showing (<= ~8 %).
LID_OPEN_DEG = (44.0, 52.0)
LID_REST_CORNER_DEG = (22.0, 20.0)     # extra polar reach at the corners at rest: the lid edges arc into an almond
LID_BLINK_DEG = (56.0, -46.0)          # full-blink travel about the eye's lateral axis: the lids meet ~10 deg below centre
LID_BLINK_CORNER_DEG = (102.0, 84.0)   # polar reach of each closed lid at the eye corners (they overlap there)
LID_SQUINT_DEG = (14.0, -12.0)         # `squint`: a small narrowing from the rest
BLINK_STEPS = ((1.0 / 3.0, "_a"), (2.0 / 3.0, "_b"), (1.0, ""))   # blink in-betweens and the full key


def eye_frame(side):
    """Right-handed eye frame: n = gaze, up = world-up orthogonalised, r = up x n."""
    n = Vector(A.eye_dir(side))
    up = (Vector((0, 0, 1)) - n * n.z).normalized()
    r = up.cross(n).normalized()
    return n, up, r


def _eye_center(side):
    return Vector((A.EYE_CENTER_L[0] * side, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2]))


def _skin_to_rig(ob, rig):
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    ob.parent = rig


def bind_rigid(ob, rig, bone):
    """Rigid skin: one vertex group for `bone` at weight 1.0, an Armature modifier, parented to the rig."""
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    _skin_to_rig(ob, rig)
    return ob


def _finish(ob, name, mat):
    """Name the object and its mesh, assign the material, smooth-shade."""
    ob.name = name
    ob.data.name = name
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def _apply_transform(ob):
    MT.select_only(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def _link(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _uv_sphere(name, radius, segments, rings, location=(0.0, 0.0, 0.0)):
    """UV sphere (poles on Z, outward normals) in world coordinates, its vertices and faces listed in a fixed order.
    Both bpy.ops.mesh.primitive_uv_sphere_add and bmesh.ops.create_uvsphere build it by spinning an arc, and the
    spin walks a pointer-keyed map: the faces come out in a run-dependent order, which reached the GLB's index
    buffers (Ruling 16: rebuilds must be byte-identical)."""
    c = Vector(location)
    verts = [c + Vector((0.0, 0.0, radius))]
    for i in range(1, rings):
        th = math.pi * i / rings
        for j in range(segments):
            ph = 2.0 * math.pi * j / segments
            verts.append(c + Vector((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th))) * radius)
    verts.append(c + Vector((0.0, 0.0, -radius)))
    top, bottom = 0, len(verts) - 1

    def ring(i, j):
        return 1 + (i - 1) * segments + j % segments
    faces = [(top, ring(1, j), ring(1, j + 1)) for j in range(segments)]
    faces += [(ring(i, j), ring(i + 1, j), ring(i + 1, j + 1), ring(i, j + 1)) for i in range(1, rings - 1) for j in range(segments)]
    faces += [(bottom, ring(rings - 1, j + 1), ring(rings - 1, j)) for j in range(segments)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- eyes, ears, claws (rigid, one bone each)
def make_eyes(rig, mat):
    """Eye spheres (32 x 16). No pupil meshes: the engine eye shader draws iris and pupil from the planar UVs
    (layer UVMap): eye-frame x/y divided by the radius on the front hemisphere, v = -1 on the back."""
    eyes = []
    for s, sfx in ((1, "L"), (-1, "R")):
        c = _eye_center(s)
        e = _finish(_uv_sphere(f"Eye_{sfx}", A.EYE_RADIUS, 32, 16, c), f"Eye_{sfx}", mat)
        n, up, r = eye_frame(s)
        uv = e.data.uv_layers.new(name="UVMap")
        for loop in e.data.loops:
            p = e.data.vertices[loop.vertex_index].co - c
            front = p.normalized().dot(n) > 0
            uv.data[loop.index].uv = (0.5 + 0.5 * p.dot(r) / A.EYE_RADIUS, 0.5 + 0.5 * p.dot(up) / A.EYE_RADIUS if front else -1.0)
        eyes.append(bind_rigid(e, rig, "head"))
    return eyes


# ear plate shapes: (length, width, thickness) scale on the anatomy.EARS_L plate, and the width / thickness taper
# toward the tip. The big flap is a long leaf; the small pairs are rounded nubs (thick, blunt), not horns.
EAR_SHAPE = {"ear_1": (1.12, 1.1, 1.0, 0.35, 0.4), "ear_2": (1.0, 1.05, 1.35, 0.2, 0.25), "ear_3": (1.0, 1.2, 1.6, 0.1, 0.15)}


def make_ears(rig, mat):
    """Paddle ear plates (24 x 12 spheres flattened and tapered), each rigid on its own ear bone: laid along the bone
    and turned about it (sculpt.ear_frame) so the broad face looks outward."""
    ears = []
    for s, sfx in ((1, "L"), (-1, "R")):
        for ear in A.EARS_L:
            name, root, length, width, thick = ear[:5]
            ls, ws, ts, w_taper, t_taper = EAR_SHAPE[name]
            b = _finish(_uv_sphere(f"{name}_{sfx}", 1.0, 24, 12), f"{name}_{sfx}", mat)
            frame = Matrix(SB.ear_frame(ear, s).tolist())
            r0 = Vector((root[0] * s, root[1], root[2]))
            for v in b.data.vertices:
                t = (v.co.y + 1.0) / 2.0
                v.co = r0 + frame @ Vector((v.co.x * width * ws * 0.5 * (1.0 - w_taper * t ** 2), t * length * ls,
                                            v.co.z * thick * ts * 0.5 * (1.0 - t_taper * t)))
            ears.append(bind_rigid(b, rig, f"{name}_{sfx}"))
    return ears


def make_claws(rig, mat):
    """Four 12-vertex cone claws per paw, each rigid on that paw's toes bone."""
    claws = []
    for s, sfx in ((1, "L"), (-1, "R")):
        for leg, fwd, kind in ((A.FRONT_LEG_L, -0.14, "front"), (A.HIND_LEG_L, -0.15, "hind")):
            pw = V(leg["paw"][0] * s, leg["paw"][1], leg["paw"][2])
            for i, tx in enumerate((-0.1, -0.034, 0.034, 0.1)):
                base = pw + V(s * tx, fwd - 0.07, -0.005)
                bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.018, radius2=0.002, depth=0.07, location=tuple(base))
                cl = _finish(bpy.context.active_object, f"Claw_{kind}_{i + 1}_{sfx}", mat)
                # the cone's tip (radius2) is local +Z: +100 deg about X points it forward (-Y) and 10 deg down, out of
                # the toe (the prototype's -100 deg buried the tip and left the flat base showing)
                cl.rotation_euler = (math.radians(100), 0, 0)
                _apply_transform(cl)
                claws.append(bind_rigid(cl, rig, f"{kind}_toes_{sfx}"))
    return claws


# ---------------------------------------------------------------- dorsal plates
def back_chain():
    """[(bone, mid-y)] along the dragon's top line, head -> tail tip: neck, spine (chest -> pelvis), tail."""
    mids = lambda pts: [(name, (float(p[1]) + float(q[1])) / 2) for (name, p), (_, q) in zip(pts, pts[1:])]
    tail = [(f"tail_{i + 1:02d}", (float(p[1]) + float(q[1])) / 2) for i, (p, q) in enumerate(zip(A.TAIL_PTS, A.TAIL_PTS[1:]))]
    return sorted(mids(A.NECK) + mids(A.SPINE) + tail, key=lambda e: e[1])


def chain_weights(chain, y):
    """Weights at depth y along a chain [(bone, mid-y)] sorted by y: the two bones whose midpoints bracket it."""
    if y <= chain[0][1]:
        return {chain[0][0]: 1.0}
    for (a, ya), (b, yb) in zip(chain, chain[1:]):
        if y <= yb:
            t = (y - ya) / (yb - ya)
            return {a: 1.0 - t, b: t}
    return {chain[-1][0]: 1.0}


def make_spikes(rig, mat, rows=5, sink=0.03):
    """Crisp dorsal plates (the sculpted cones went soft at 24k faces): one thin fin per sculpt.dorsal_spikes entry —
    convex front edge, concave back edge, a sharp tip leaning back, the base sunk `sink` into the skin. Each fin is
    rigid on the back/tail bones under its base."""
    chain = back_chain()
    bm = bmesh.new()
    groups = []            # (vertices, weights) per fin
    for base, tip, radius in SB.dorsal_spikes():
        b, t = Vector(base), Vector(tip)
        front, back = b + Vector((0.0, -1.25 * radius, -sink)), b + Vector((0.0, 1.25 * radius, -sink))

        def edge(p0, bulge):
            d = t - p0
            n = Vector((0.0, -d.z, d.y)).normalized()
            if n.dot(p0 - b) < 0:
                n = -n                                   # away from the fin's interior
            return lambda u: p0 + d * u + n * (bulge * d.length * math.sin(math.pi * u))
        f_edge, b_edge = edge(front, 0.12), edge(back, -0.10)   # convex front, concave back
        h0 = 0.27 * radius
        verts, ring = [], []
        for k in range(rows):
            u = k / rows
            F, B = f_edge(u), b_edge(u)
            h = h0 * (1.0 - u) ** 0.8 + 0.0015
            x = Vector((h, 0.0, 0.0))
            row = [F, F.lerp(B, 0.3) + x, F.lerp(B, 0.7) + x * 0.9, B, F.lerp(B, 0.7) - x * 0.9, F.lerp(B, 0.3) - x]
            ring.append([bm.verts.new(p) for p in row])
            verts += ring[-1]
        apex = bm.verts.new(t)
        verts.append(apex)
        for r0, r1 in zip(ring, ring[1:]):
            for j in range(6):
                bm.faces.new([r0[j], r0[(j + 1) % 6], r1[(j + 1) % 6], r1[j]])
        for j in range(6):
            bm.faces.new([ring[-1][j], ring[-1][(j + 1) % 6], apex])
        bm.faces.new(list(reversed(ring[0])))
        groups.append((verts, chain_weights(chain, float(b.y))))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.index_update()
    groups = [([v.index for v in vs], w) for vs, w in groups]
    ob = _link("Spikes", bm)
    bm.free()
    _finish(ob, "Spikes", mat)
    vg = {}
    for ids, weights in groups:
        for bone, w in weights.items():
            if w > 1e-6:
                if bone not in vg:
                    vg[bone] = ob.vertex_groups.new(name=bone)
                vg[bone].add(ids, w, "REPLACE")
    _skin_to_rig(ob, rig)
    return [ob]


# ---------------------------------------------------------------- lids (blink + squint keys)
def _segment_min(a, b):
    """Closest approach to the origin along the segment a -> b (vectors)."""
    ab = b - a
    t = max(0.0, min(1.0, -a.dot(ab) / ab.length_squared)) if ab.length_squared > 1e-18 else 0.0
    return (a + ab * t).length


def chord_lift(chain, margin=0.0003):
    """Radial scale for the two in-between blink keys of one vertex. `chain` = the vertex's rest, 1/3, 2/3 and full
    positions relative to the eye centre, all at its rest radius rho (the blink only rotates and re-spreads the cap).
    The engine blends neighbouring keys linearly, i.e. along the chords of the vertex's arc, which dip inside the
    rest shell by up to rho (1 - cos(step / 2)); the in-betweens are pushed out just far enough (bisection) that the
    whole path stays >= rho - margin from the centre."""
    rho = chain[0].length

    def clear(lift):
        a, b = chain[1] * lift, chain[2] * lift
        return min(_segment_min(chain[0], a), _segment_min(a, b), _segment_min(b, chain[3])) >= rho - margin
    if clear(1.0):
        return 1.0
    lo, hi = 1.0, 1.25
    for _ in range(24):
        mid = 0.5 * (lo + hi)
        lo, hi = (lo, mid) if clear(mid) else (mid, hi)
    return hi


def _lid(side, name, mat, upper=True, thickness=0.008):
    """Spherical-shell lid cap around the eye with `blink_<side>_a`, `blink_<side>_b`, `blink_<side>` (1/3, 2/3 and
    all of the blink) and `squint` shape keys."""
    c = _eye_center(side)
    n, up, r = eye_frame(side)
    R = A.EYE_RADIUS * 1.045
    axis = up if upper else -up
    which = 0 if upper else 1
    # parametric spherical cap around `axis`: polar angle 0..extent(ph), where ph is the azimuth about the axis from
    # the gaze (0) to the eye corners (+-90 deg). The edge reaches alpha over the middle of the eye and alpha + the
    # rest corner reach at the corners, so the two lids frame an almond-shaped opening.
    alpha = math.acos(math.sin(math.radians(LID_OPEN_DEG[which])))
    corner_rest = math.radians(LID_REST_CORNER_DEG[which])
    extent = lambda ph: alpha + corner_rest * math.sin(ph) ** 2
    e1, e2 = n, r            # both perpendicular to `up`
    K, M = 14, 56
    bm = bmesh.new()
    pole = bm.verts.new(c + axis * R)
    rings = []
    for k in range(1, K + 1):
        ring = []
        for j in range(M):
            ph = 2 * math.pi * j / M
            th = extent(ph) * k / K
            d = axis * math.cos(th) + (e1 * math.cos(ph) + e2 * math.sin(ph)) * math.sin(th)
            ring.append(bm.verts.new(c + d * R))
        rings.append(ring)
    for j in range(M):
        bm.faces.new([pole, rings[0][j], rings[0][(j + 1) % M]])
    for k in range(K - 1):
        for j in range(M):
            j2 = (j + 1) % M
            bm.faces.new([rings[k][j], rings[k + 1][j], rings[k + 1][j2], rings[k][j2]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    f0 = bm.faces[len(bm.faces) // 2]
    if f0.normal.dot(f0.calc_center_median() - c) < 0:   # normals must face away from the eye (solidify grows outward)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    ob = _link(name, bm)
    bm.free()
    me = ob.data
    sol = ob.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = 1.0
    MT.select_only(ob)
    bpy.ops.object.modifier_apply(modifier="solid")
    _finish(ob, name, mat)
    # blink / squint: rotate the cap about the eye's lateral axis so the lid edge sweeps over the eye.
    # The rotation never moves the eye corners (+-r) relative to the caps, and both rest caps stop short of them
    # (extent < 90 deg), so each closing lid is also re-spread toward the corners (polar reach LID_BLINK_CORNER_DEG at
    # +-r, the two lids overlapping there) or a sliver of eye stays visible at any travel. A fraction f of the blink
    # applies f of that corner reach, then f of the rotation, about the same axis (the in-betweens are true partial
    # blinks, not a linear blend of the full key). The rest shape is untouched.
    reach = math.radians(LID_BLINK_CORNER_DEG[which])

    def blink(p, f):
        u = p - c
        rho = u.length
        d = u / rho
        th = math.acos(max(-1.0, min(1.0, d.dot(axis))))
        ph = math.atan2(d.dot(e2), d.dot(e1))
        closed = alpha + (reach - alpha) * math.sin(ph) ** 2
        th *= 1.0 + f * (closed / extent(ph) - 1.0)
        q = (axis * math.cos(th) + (e1 * math.cos(ph) + e2 * math.sin(ph)) * math.sin(th)) * rho
        return Matrix.Rotation(math.radians(f * LID_BLINK_DEG[which]), 3, r) @ q     # relative to the eye centre

    rest = [v.co - c for v in me.vertices]
    steps = {f: [blink(v.co, f) for v in me.vertices] for f, _ in BLINK_STEPS}
    lift = [chord_lift([p, steps[BLINK_STEPS[0][0]][i], steps[BLINK_STEPS[1][0]][i], steps[1.0][i]])
            for i, p in enumerate(rest)]
    ob.shape_key_add(name="Basis", from_mix=False)
    sfx = "L" if side > 0 else "R"
    for f, suffix in BLINK_STEPS:
        key = ob.shape_key_add(name=f"blink_{sfx}{suffix}", from_mix=False)
        key.value = 0.0   # Blender 5.1 creates shape keys at value 1.0; the bind pose must show open lids
        for i, q in enumerate(steps[f]):
            key.data[i].co = c + (q if f == 1.0 else q * lift[i])
    squint = ob.shape_key_add(name="squint", from_mix=False)
    squint.value = 0.0
    rotm = Matrix.Rotation(math.radians(LID_SQUINT_DEG[which]), 3, r)
    for i, p in enumerate(rest):
        squint.data[i].co = c + rotm @ p
    return ob


def make_lids(rig, mat):
    """Upper and lower lid shells per eye: [LidU_L, LidD_L, LidU_R, LidD_R], rigid on `head`."""
    lids = []
    for s, sfx in ((1, "L"), (-1, "R")):
        for upper in (True, False):
            lids.append(bind_rigid(_lid(s, f"Lid{'U' if upper else 'D'}_{sfx}", mat, upper=upper), rig, "head"))
    return lids


# ---------------------------------------------------------------- mouth: teeth, tongue, interior material
def _opened(co):
    """A point modelled with the mouth closed, carried open with the lower jaw into the bind pose."""
    return Vector(SB.close_jaw(np.array(co[:]), -A.JAW_REST_CLOSE_RAD))


TOOTH_BURY = 0.004   # every tooth at rest lies at least this deep inside the closed head (he is Toothless)


def tooth_travel(size):
    """How far `teeth_out` slides a tooth of this size out of its gum."""
    return 0.9 * size + 0.006


def tooth_points(upper, base, size):
    """Sample points of a tooth cone at rest, with the mouth closed: its base ring and its tip (5 mm inside the gum),
    upper teeth hanging down from above the lip plane, lower ones standing up from below it."""
    s = 1.0 if upper else -1.0
    tip = SB.MOUTH_Z + s * 0.005
    root = tip + s * 1.6 * size
    r = 0.45 * size
    pts = [(base[0], base[1], tip)]
    pts += [(base[0] + r * math.cos(a), base[1] + r * math.sin(a), root) for a in (2 * math.pi * k / 8 for k in range(8))]
    return np.array(pts)


def teeth_layout(count=9):
    """[(upper, base (x, y), size)] for both rows (right corner -> front -> left corner), with the mouth closed: the
    upper row inside the lip line, the lower row inside the lower lip's rim (sculpt.LOWER_LIP_L; the head narrows
    under the lip line, so it runs inside the upper row, as in an overbite). Each tooth starts 3 cm (upper) or 2.5 cm
    (lower) in and steps further in until the whole cone is buried TOOTH_BURY deep (the chin recedes under the
    front teeth). The lower row also sits half a tooth spacing along from the upper (one fewer tooth): with the
    teeth out the rows interleave and the tips never meet. Sizes taper from 3 cm at the front to 2 cm at the corners."""
    ctr = Vector((0, -1.86, 0))
    n = count * 2
    step = 0.88 / (n - 1)
    out = []
    for upper, line, inset, us in ((True, SB.MOUTH_LINE_L, 0.03, [0.06 + step * k for k in range(n)]),
                                   (False, SB.LOWER_LIP_L, 0.025, [0.06 + step * (k + 0.5) for k in range(n - 1)])):
        pts = [Vector((-p[0], p[1], 0)) for p in reversed(line[1:])] + [Vector((p[0], p[1], 0)) for p in line]
        total = sum((b - a).length for a, b in zip(pts, pts[1:]))

        def at(u):
            d = u * total
            for a, b in zip(pts, pts[1:]):
                seg = (b - a).length
                if d <= seg:
                    return a.lerp(b, d / seg)
                d -= seg
            return pts[-1]
        for u in us:
            p = at(u)
            inward = ctr - p
            inward.z = 0
            inward.normalize()
            size = 0.03 - 0.01 * abs(u - 0.5) * 2
            depth = inset
            while depth < 0.1 and SB._head_field(tooth_points(upper, (p + inward * depth).to_2d(), size)).max() > -TOOTH_BURY:
                depth += 0.005
            out.append((upper, (p + inward * depth).to_2d(), size))
    return out


def make_teeth(rig, mat, count=9):
    """Upper + lower rows of conical teeth, hidden inside the gums (he is Toothless: the tips 5 mm under the lip
    surfaces of the closed mouth); `teeth_out` slides them out by ~0.9 x their size. The upper row rides `head`; the
    lower row rides `jaw` and is modelled closed, then carried open with the jaw into the bind pose."""
    bm = bmesh.new()
    moves, rows = [], {True: [], False: []}
    for upper, base, size in teeth_layout(count):
        z_hidden = SB.MOUTH_Z + (1 if upper else -1) * (0.005 + 0.8 * size)
        geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=size * 0.45, radius2=0.0005, depth=size * 1.6)
        vs = geom["verts"]
        rotm = Matrix.Rotation(math.pi, 3, "X") if upper else Matrix.Identity(3)
        travel = Vector((0.0, 0.0, (-1 if upper else 1) * tooth_travel(size)))
        for v in vs:
            v.co = rotm @ v.co + Vector((base.x, base.y, z_hidden))
        if upper:
            moves.append((vs, [travel] * len(vs)))
        else:
            out = [_opened(v.co + travel) for v in vs]
            for v in vs:
                v.co = _opened(v.co)
            moves.append((vs, [o - v.co for o, v in zip(out, vs)]))
        rows[upper] += vs
    bm.verts.index_update()
    moves = [([v.index for v in vs], mv) for vs, mv in moves]
    rows = {k: [v.index for v in vs] for k, vs in rows.items()}
    ob = _link("Teeth", bm)
    bm.free()
    me = ob.data
    _finish(ob, "Teeth", mat)
    ob.shape_key_add(name="Basis", from_mix=False)
    key = ob.shape_key_add(name="teeth_out", from_mix=False)
    key.value = 0.0   # Blender 5.1 creates shape keys at value 1.0; at rest the teeth stay in the gums
    for ids, mv in moves:
        for i, d in zip(ids, mv):
            key.data[i].co = me.vertices[i].co + d
    for bone, upper in (("head", True), ("jaw", False)):
        ob.vertex_groups.new(name=bone).add(rows[upper], 1.0, "REPLACE")
    _skin_to_rig(ob, rig)
    return ob


def make_tongue(rig, mat):
    """Flattened ellipsoid on the floor of the mouth, rigid on `jaw`, modelled closed (its top 2 mm under the lip
    plane) and carried open with the jaw (it shows when the jaw opens)."""
    t = _finish(_uv_sphere("Tongue", 1.0, 16, 8), "Tongue", mat)
    t.location = (0.0, -1.995, SB.MOUTH_Z - 0.016)       # ends ~4 cm inside the lip corners
    t.scale = (0.10, 0.15, 0.014)
    _apply_transform(t)
    for v in t.data.vertices:
        v.co = _opened(v.co)
    return bind_rigid(t, rig, "jaw")


def assign_mouth_material(body, mat, inset=0.012, band=0.006, corner_inset=0.02):
    """Faces lying in the slit (inside the lip line pulled `inset` inward at the front and `corner_inset` at the
    corners, within the slit + `band`) get the mouth material: the palate above, the tongue bed below, the gums
    around. The lips stay skin up to the corners, where the sealed mouth's crease shows. Returns the face count."""
    me = body.data
    names = [m.name for m in me.materials]
    if mat.name not in names:
        me.materials.append(mat)
        names.append(mat.name)
    mi = names.index(mat.name)
    slab = SB.mouth_slit(outset=-inset, extra=band, corner_outset=-corner_inset)
    cents = np.array([p.center[:] for p in me.polygons])
    inside = slab.fn(cents) < 0.0
    for p, flag in zip(me.polygons, inside):
        if flag:
            p.material_index = mi
    return int(inside.sum())
