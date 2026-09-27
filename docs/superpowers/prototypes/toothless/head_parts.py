"""Eyelid shells (blink shape keys), retractable teeth (teeth_out shape key) and mouth-interior material."""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix
import anatomy as A
import sculpt_body as SB


def eye_frame(side):
    """Right-handed eye frame: n = gaze, up = world-up orthogonalised, r = up x n."""
    n = Vector(A.eye_dir(side))
    up = (Vector((0, 0, 1)) - n * n.z).normalized()
    r = up.cross(n).normalized()
    return n, up, r


def lid(side, name, mat, upper=True, open_edge_deg=18.0, thickness=0.008):
    """Spherical-shell lid cap around the eye; returns object with a 'blink' shape key."""
    c = Vector((A.EYE_CENTER_L[0] * side, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2]))
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
    bm.faces.ensure_lookup_table(); bm.normal_update()
    f0 = bm.faces[len(bm.faces) // 2]
    if f0.normal.dot(f0.calc_center_median() - c) < 0:   # normals must face away from the eye (solidify grows outward)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    sol = ob.modifiers.new("solid", "SOLIDIFY"); sol.thickness = thickness; sol.offset = 1.0
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="solid")
    for p in me.polygons:
        p.use_smooth = True
    # blink: rotate the cap about the eye's lateral axis so the lid edge sweeps over the eye
    ob.shape_key_add(name="Basis")
    key = ob.shape_key_add(name=f"blink_{'L' if side > 0 else 'R'}")
    ang = math.radians(96.0 if upper else -40.0)
    rotm = Matrix.Rotation(ang * (1 if side > 0 else 1), 4, r)
    for i, v in enumerate(me.vertices):
        key.data[i].co = c + (rotm @ (v.co - c))
    return ob


def teeth(mat, count=9):
    """Upper + lower rows of small conical teeth, hidden inside the gums; `teeth_out` slides them into the slit."""
    bm = bmesh.new()
    rows = []
    line = SB.MOUTH_LINE_L
    # sample the U (right corner -> front -> left corner), inset toward the centre so teeth sit behind the lips
    pts = [Vector((-p[0], p[1], 0)) for p in reversed(line[1:])] + [Vector((p[0], p[1], 0)) for p in line]
    total = sum((b - a).length for a, b in zip(pts, pts[1:]))
    def at(u):
        d = u * total
        for a, b in zip(pts, pts[1:]):
            L = (b - a).length
            if d <= L:
                return a.lerp(b, d / L)
            d -= L
        return pts[-1]
    ctr = Vector((0, -1.86, 0))
    moves = []
    for upper in (True, False):
        for k in range(count * 2):
            u = 0.06 + 0.88 * k / (count * 2 - 1)
            p = at(u)
            inward = (ctr - p); inward.z = 0; inward.normalize()
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
    me = bpy.data.meshes.new("Teeth"); bm.to_mesh(me)
    ob = bpy.data.objects.new("Teeth", me); bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    ob.shape_key_add(name="Basis")
    key = ob.shape_key_add(name="teeth_out")
    for ids, mv in moves:
        for i in ids:
            key.data[i].co = me.vertices[i].co + mv
    bm.free()
    return ob


def assign_mouth_material(body, mouth_mat, inset=0.012, band=0.006):
    """Faces lying in the slit (inside the lip line pulled `inset` inward, within the slit height + `band`)
    get the mouth material: the palate above, the tongue bed below, the gums around."""
    from berk_sdf import polygon_slab
    me = body.data
    names = [m.name for m in me.materials]
    if mouth_mat.name not in names:
        me.materials.append(mouth_mat)
        names.append(mouth_mat.name)
    mi = names.index(mouth_mat.name)
    slab = polygon_slab(SB.mouth_polygon(outset=-inset), SB.MOUTH_Z, SB.MOUTH_HALF_H + band)
    cents = np.array([p.center[:] for p in me.polygons])
    inside = slab.fn(cents) < 0.0
    for p, flag in zip(me.polygons, inside):
        if flag:
            p.material_index = mi
    return int(inside.sum())


