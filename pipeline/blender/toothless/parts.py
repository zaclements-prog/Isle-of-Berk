"""Separately built parts, each bound to the rig: eyes (planar eye UVs), lids (blink/squint keys), teeth (teeth_out key),
tongue, ears and claws — plus the mouth-interior material on the sculpted body.

Every part's mesh is in bind-pose world coordinates (object at the origin, transforms applied)."""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix
import anatomy as A
import meshtools as MT
import sculpt as SB
from berk_sdf import polygon_slab

V = A.V
LID_BLINK_DEG = (100.0, -46.0)    # upper, lower travel about the eye's lateral axis (closes the outer-corner sliver)
LID_SQUINT_DEG = (18.0, -16.0)    # upper, lower travel for the `squint` key
LID_BLINK_CORNER_DEG = 100.0      # polar reach of the closed upper lid at the eye corners (covers them; rest caps stop at 72)


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


def make_ears(rig, mat):
    """Paddle ear plates (24 x 12 spheres flattened and tapered), each rigid on its own ear bone."""
    ears = []
    for s, sfx in ((1, "L"), (-1, "R")):
        for name, root, length, width, thick, pitch, yaw, roll in A.EARS_L:
            b = _finish(_uv_sphere(f"{name}_{sfx}", 1.0, 24, 12), f"{name}_{sfx}", mat)
            for v in b.data.vertices:
                t = (v.co.y + 1.0) / 2.0
                v.co.y = t * length
                v.co.x *= width * 0.5 * (1.0 - 0.35 * t ** 2)
                v.co.z *= thick * 0.5 * (1.0 - 0.4 * t)
            b.location = (root[0] * s, root[1], root[2])
            b.rotation_euler = (math.radians(pitch), math.radians(roll * s), math.radians(yaw * s))
            _apply_transform(b)
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


# ---------------------------------------------------------------- lids (blink + squint keys)
def _lid(side, name, mat, upper=True, open_edge_deg=18.0, thickness=0.008):
    """Spherical-shell lid cap around the eye with `blink_<side>` and `squint` shape keys."""
    c = _eye_center(side)
    n, up, r = eye_frame(side)
    R = A.EYE_RADIUS * 1.045
    axis = up if upper else -up
    # parametric spherical cap around `axis`: polar angle 0..alpha, so the lid edge is a clean circle
    alpha = math.acos(math.sin(math.radians(open_edge_deg if upper else 34.0)))
    e1, e2 = n, r            # both perpendicular to `up`
    K, M = 14, 56
    bm = bmesh.new()
    pole = bm.verts.new(c + axis * R)
    rings = []
    for k in range(1, K + 1):
        th = alpha * k / K
        ring = []
        for j in range(M):
            ph = 2 * math.pi * j / M
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
    # (alpha < 90 deg), so the closed upper lid is also stretched toward the corners (polar reach LID_BLINK_CORNER_DEG
    # at +-r) or a sliver of eye stays visible there at any travel. The rest shape is untouched.
    blink_reach = math.radians(LID_BLINK_CORNER_DEG) if upper else alpha

    def reach_corners(p):
        u = p - c
        rho = u.length
        d = u / rho
        th = math.acos(max(-1.0, min(1.0, d.dot(axis))))
        ph = math.atan2(d.dot(e2), d.dot(e1))
        th *= (alpha + (blink_reach - alpha) * math.sin(ph) ** 2) / alpha
        return c + (axis * math.cos(th) + (e1 * math.cos(ph) + e2 * math.sin(ph)) * math.sin(th)) * rho

    ob.shape_key_add(name="Basis", from_mix=False)
    k = 0 if upper else 1
    for key_name, deg, shape in ((f"blink_{'L' if side > 0 else 'R'}", LID_BLINK_DEG[k], reach_corners),
                                 ("squint", LID_SQUINT_DEG[k], lambda p: p)):
        key = ob.shape_key_add(name=key_name, from_mix=False)
        key.value = 0.0   # Blender 5.1 creates shape keys at value 1.0; the bind pose must show open lids
        rotm = Matrix.Rotation(math.radians(deg), 3, r)
        for i, v in enumerate(me.vertices):
            key.data[i].co = c + rotm @ (shape(v.co) - c)
    return ob


def make_lids(rig, mat):
    """Upper and lower lid shells per eye: [LidU_L, LidD_L, LidU_R, LidD_R], rigid on `head`."""
    lids = []
    for s, sfx in ((1, "L"), (-1, "R")):
        for upper in (True, False):
            lids.append(bind_rigid(_lid(s, f"Lid{'U' if upper else 'D'}_{sfx}", mat, upper=upper), rig, "head"))
    return lids


# ---------------------------------------------------------------- mouth: teeth, tongue, interior material
def make_teeth(rig, mat, count=9):
    """Upper + lower rows of small conical teeth, hidden inside the gums; `teeth_out` slides them into the slit.
    The upper row rides `head`, the lower row `jaw`."""
    bm = bmesh.new()
    line = SB.MOUTH_LINE_L
    # sample the U (right corner -> front -> left corner), inset toward the centre so teeth sit behind the lips
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
    ctr = Vector((0, -1.86, 0))
    moves = []
    for upper in (True, False):
        for k in range(count * 2):
            u = 0.06 + 0.88 * k / (count * 2 - 1)
            p = at(u)
            inward = ctr - p
            inward.z = 0
            inward.normalize()
            base = p + inward * 0.03
            size = 0.022 - 0.008 * abs(u - 0.5) * 2
            z_hidden = SB.MOUTH_Z + (0.03 if upper else -0.03)   # fully inside the gums (he is Toothless)
            tip_dir = -1 if upper else 1
            geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=size * 0.45, radius2=0.0005, depth=size * 1.6)
            vs = geom["verts"]
            rotm = Matrix.Rotation(math.pi, 3, "X") if upper else Matrix.Identity(3)
            for v in vs:
                v.co = rotm @ v.co
                v.co += Vector((base.x, base.y, z_hidden))
            moves.append((vs, Vector((0, 0, tip_dir * 0.024))))
    bm.verts.index_update()
    moves = [([v.index for v in vs], mv) for vs, mv in moves]
    ob = _link("Teeth", bm)
    bm.free()
    me = ob.data
    _finish(ob, "Teeth", mat)
    ob.shape_key_add(name="Basis", from_mix=False)
    key = ob.shape_key_add(name="teeth_out", from_mix=False)
    key.value = 0.0   # Blender 5.1 creates shape keys at value 1.0; at rest the teeth stay in the gums
    for ids, mv in moves:
        for i in ids:
            key.data[i].co = me.vertices[i].co + mv
    for bone, sel in (("head", lambda z: z > SB.MOUTH_Z), ("jaw", lambda z: z <= SB.MOUTH_Z)):
        g = ob.vertex_groups.new(name=bone)
        g.add([v.index for v in me.vertices if sel(v.co.z)], 1.0, "REPLACE")
    _skin_to_rig(ob, rig)
    return ob


def make_tongue(rig, mat):
    """Flattened ellipsoid on the floor of the mouth slit, rigid on `jaw` (shows when the jaw opens)."""
    t = _finish(_uv_sphere("Tongue", 1.0, 16, 8), "Tongue", mat)
    t.location = (0.0, -1.93, SB.MOUTH_Z - 0.009)
    t.scale = (0.10, 0.17, 0.014)
    _apply_transform(t)
    return bind_rigid(t, rig, "jaw")


def assign_mouth_material(body, mat, inset=0.012, band=0.006):
    """Faces lying in the slit (inside the lip line pulled `inset` inward, within the slit height + `band`)
    get the mouth material: the palate above, the tongue bed below, the gums around. Returns the face count."""
    me = body.data
    names = [m.name for m in me.materials]
    if mat.name not in names:
        me.materials.append(mat)
        names.append(mat.name)
    mi = names.index(mat.name)
    slab = polygon_slab(SB.mouth_polygon(outset=-inset), SB.MOUTH_Z, SB.MOUTH_HALF_H + band)
    cents = np.array([p.center[:] for p in me.polygons])
    inside = slab.fn(cents) < 0.0
    for p, flag in zip(me.polygons, inside):
        if flag:
            p.material_index = mi
    return int(inside.sum())
