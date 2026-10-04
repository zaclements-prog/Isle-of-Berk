"""Assembly: body skin weights, face shape keys, the _MASK attribute (ray-traced vertex AO + region masks),
then one joined skinned mesh with <= 4 influences per vertex."""
import math
from collections import namedtuple
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from berk_sdf import polygon_slab
import anatomy as A
import meshtools as MT
import sculpt as SB
import wings as W

NON_BODY = ("wing_", "hipwing_", "tailfin_", "ear_", "saddle", "pedal_")
WING_PARTS = ("Wing_", "hipwing_", "tailfin_")
# limb-root bone (add _L/_R) -> (inner, outer) capsule radius around the bone, metres: full heat weight inside the
# inner radius, none beyond the outer (the upper arm is ~0.17 m thick, the haunch ~0.25 m)
LIMB_ROOTS = {"front_scapula": (0.18, 0.32), "front_humerus": (0.20, 0.34), "hind_femur": (0.26, 0.42)}
SMOOTH_REPEAT = 8
# heat-weight canary (Ruling 15), read off the raw ARMATURE_AUTO weights before any correction or smoothing (they
# would hide a partial failure): a bone covers a vertex it got >= HEAT_W of, and every body bone must cover at least
# HEAT_COVERAGE of its expected region (the body vertices it is the nearest body bone to — where heat weighting
# puts a bone's weight when its solve succeeds), and never fewer than HEAT_MIN_VERTS vertices.
HEAT_W, HEAT_COVERAGE, HEAT_MIN_VERTS = 0.2, 0.5, 5
# vertex AO: occluder search distance (m) and hemisphere rays. 1 m spans the neighbouring masses of this 7 m dragon
# (legs ~0.45 m apart, belly ~0.6 m above the paws); at 0.5 m the armpits and under the jaw barely registered (0.90,
# 0.97). 96 rays halve the blotches the 48-ray set left on smooth flanks.
AO_DIST, AO_RAYS = 1.0, 96
AO_GAMMA = 1.6    # stored AO = raw ** gamma: deeper armpits, under-jaw and leg creases; open skin (1.0) is untouched
# face key offsets (metres; +y = back, +z = up)
LIP_REACH = 0.07                                   # lip offsets fade out this far from the lip line
SMILE_UPPER = Vector((0, 0.02, 0.042))             # side upper lip: up and back (the gums show)
SMILE_LOWER = Vector((0, 0.02, -0.006))            # side lower lip draws back and a little down: the lips part
SMILE_CORNER = Vector((0, 0.035, 0.05))            # corners and cheeks draw up and back into the gummy grin
SNARL_LIP = Vector((0, 0.012, 0.055))              # upper lip lifts well clear of the extended teeth and draws back
SNARL_PEEL = 0.014                                 # ... and peels outward, rolling the lip edge away from the teeth
SNARL_LOWER = Vector((0, 0.004, -0.02))            # front lower lip drops
SNARL_NOSE = Vector((0, 0.008, 0.016))             # nostrils ride up
SNARL_CRINKLE = (0.10, 0.013, 0.008, 0.042)        # bridge crinkle: reach, bunch (back + up), crease height, crease pitch


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def confine_limb_roots(body, rig):
    """Scripted correction (spec §5.6). The limb-root bones lie closer to the ribcage and flank walls than the spine
    does, so heat weighting hands them the whole side of the torso and a swinging leg drags the chest wall with it.
    Fade each limb root's weight out beyond a capsule around its bone and give it to the torso chain by position
    along the back."""
    groups = {g.name: g for g in body.vertex_groups}
    index = {g.index: g.name for g in body.vertex_groups}
    mw = body.matrix_world
    moved = 0
    for base, (r_in, r_out) in LIMB_ROOTS.items():
        for sfx in ("L", "R"):
            name = f"{base}_{sfx}"
            bone = rig.data.bones[name]
            a, b = rig.matrix_world @ bone.head_local, rig.matrix_world @ bone.tail_local
            for v in body.data.vertices:
                w = next((g.weight for g in v.groups if index[g.group] == name), 0.0)
                if w <= 0.0:
                    continue
                p = mw @ v.co
                keep = 1.0 - smoothstep(r_in, r_out, _segment_distance(p, a, b))
                if keep >= 1.0:
                    continue
                groups[name].add([v.index], w * keep, "REPLACE")
                for torso, tw in W.spine_weights_at(p.y).items():
                    groups[torso].add([v.index], w * (1.0 - keep) * tw, "ADD")
                moved += 1
    return moved


def body_bones(rig):
    return [b.name for b in rig.data.bones if not b.name.startswith(NON_BODY)]


def expected_coverage(body, rig, bones):
    """Per bone, the number of body vertices it is the nearest of `bones` to (distance to the bone segment)."""
    me = body.data
    n = len(me.vertices)
    co = np.empty(3 * n)
    me.vertices.foreach_get("co", co)
    mw = body.matrix_world
    P = co.reshape(n, 3) @ np.array(mw.to_3x3()).T + np.array(mw.translation)
    d = np.empty((n, len(bones)))
    for j, name in enumerate(bones):
        bone = rig.data.bones[name]
        a, b = np.array(rig.matrix_world @ bone.head_local), np.array(rig.matrix_world @ bone.tail_local)
        ab = b - a
        t = np.clip((P - a) @ ab / (ab @ ab), 0.0, 1.0)
        d[:, j] = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
    nearest = np.argmin(d, axis=1)
    return {name: int(np.count_nonzero(nearest == j)) for j, name in enumerate(bones)}


def heat_coverage(body, bones, w_min=HEAT_W):
    """Per bone, the number of body vertices whose weight for it is >= w_min."""
    index = {g.index: g.name for g in body.vertex_groups}
    counts = dict.fromkeys(bones, 0)
    for v in body.data.vertices:
        for g in v.groups:
            name = index[g.group]
            if g.weight >= w_min and name in counts:
                counts[name] += 1
    return counts


def check_heat_weights(body, rig):
    """The heat-weight canary (Ruling 15). Blender reports a failed heat solve only as a warning, and a failure can
    be partial (a bone the solver or the visibility rays starved). Returns {bone: (covered, expected)}."""
    bones = body_bones(rig)
    expected = expected_coverage(body, rig, bones)
    got = heat_coverage(body, bones)
    short = [f"{b} {got[b]}/{expected[b]}" for b in bones
             if got[b] < max(HEAT_MIN_VERTS, math.ceil(HEAT_COVERAGE * expected[b]))]
    if short or got["jaw"] < 500:
        raise RuntimeError(f"heat weighting failed (raw ARMATURE_AUTO weights, covered/expected): {short} jaw={got['jaw']}")
    return {b: (got[b], expected[b]) for b in bones}


def skin_body(body, rig):
    """Heat weights on the body with the non-body bones excluded (they would steal weights), checked by the canary
    before the scripted corrections. Returns the canary's {bone: (covered, expected)}."""
    saved = {b.name: b.use_deform for b in rig.data.bones}
    for b in rig.data.bones:
        b.use_deform = not b.name.startswith(NON_BODY)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for b in rig.data.bones:
        b.use_deform = saved[b.name]
    coverage = check_heat_weights(body, rig)
    confine_limb_roots(body, rig)
    # scripted correction (spec §5.6): a smooth of every group evens out limb seams and the jagged edges heat weighting
    # leaves where a bone's visibility flips between neighbouring vertices. Blender 5.1 only runs vertex_group_smooth
    # in Edit Mode (or weight-paint vertex selection), on the selected vertices: select them all.
    MT.select_only(body)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=SMOOTH_REPEAT)
    bpy.ops.object.mode_set(mode="OBJECT")
    seal_lips(body)
    return coverage


LIP_SEAL_REACH = (0.03, 0.06)   # the jaw-weight correction is whole within 3 cm of the lip line, gone by 6 cm


def seal_lips(body):
    """Scripted correction (spec §5.6): the sculpt sets the lower jaw open by the rest-close angle (sculpt.jaw_weight
    says how much of it each point took) and the engine closes the jaw by that angle at rest. Around the lips, where
    the smoothed heat weights blend head and jaw across the thin corners of the slit, the jaw's weight is set to the
    sculpt's own opening weight — the rest close then puts the lips back exactly where they were sculpted shut.
    The other bones share what is left in their old proportions (the head takes it if there are none). Whole near
    the lip line, faded out across LIP_SEAL_REACH. Returns the number of vertices changed."""
    me = body.data
    groups = {g.name: g for g in body.vertex_groups}
    index = {g.index: g.name for g in body.vertex_groups}
    lip = [Vector((-p[0], p[1], p[2])) for p in reversed(SB.MOUTH_LINE_L[1:])] + [Vector(p) for p in SB.MOUTH_LINE_L]
    P = np.array([tuple(body.matrix_world @ v.co) for v in me.vertices])
    target = SB.jaw_weight(P)
    shut = SB.close_jaw(P, target * A.JAW_REST_CLOSE_RAD)   # measured with the mouth closed
    changed = 0
    for v, p, t in zip(me.vertices, shut, target):
        reach = 1.0 - smoothstep(*LIP_SEAL_REACH, _polyline_distance(Vector(p), lip))
        if reach <= 0.0:
            continue
        old = {index[g.group]: g.weight for g in v.groups}
        jaw = old.get("jaw", 0.0)
        new_jaw = jaw + (float(t) - jaw) * reach
        rest = {k: w for k, w in old.items() if k != "jaw" and w > 0.0}
        total = sum(rest.values())
        if abs(new_jaw - jaw) < 1e-6:
            continue
        groups["jaw"].add([v.index], new_jaw, "REPLACE")
        if total > 0.0:
            for k, w in rest.items():
                groups[k].add([v.index], w * (1.0 - new_jaw) / total, "REPLACE")
        else:
            groups["head"].add([v.index], 1.0 - new_jaw, "REPLACE")
        changed += 1
    return changed


def _falloff(d, radius):
    return 1.0 - smoothstep(0.0, radius, d)


def _polyline_distance(p, pts):
    return min(_segment_distance(p, a, b) for a, b in zip(pts, pts[1:]))


def lip_mobility(points):
    """1 on the outer skin, fading to 0 from 0.5 to 3 cm inside the lip line within the slit (the gums, whose
    retracted teeth sit just inside, stay put). Smooth in xy and z, unlike the stair-stepped mouth-material border.
    The slit is the bind wedge (sculpt.mouth_slit): "within" is measured from its mid-surface, at its local height."""
    P = np.array([tuple(p) for p in points])
    depth = -polygon_slab(SB.mouth_polygon(outset=0.0), SB.MOUTH_Z, 1.0).fn(P)
    side = SB.slit_side(P)
    out = []
    for p, d, s in zip(points, depth, side):
        half = 0.5 * SB.slit_opening(p.y) + SB.SLIT_ROUNDING
        in_slit = 1.0 - smoothstep(half, half + 0.01, abs(float(s)))
        out.append(1.0 - in_slit * smoothstep(0.005, 0.03, float(d)))
    return out


def add_face_keys(body):
    """smile / snarl / nostril_flare on the body (the join later merges keys by name).

    Lip offsets fall off with the distance to the lip line (the whole U, not its sample points: those sit ~10 cm apart)
    and split smoothly into upper and lower lip across the slit, so the lips part without tearing at the corners. Inside
    the slit they fade out from the lip line to 3 cm deep (`lip_mobility`): the gums at the teeth line stay, keep the
    retracted teeth covered and show where the lips part. The keys are shaped on the closed face (the engine's rest):
    each vertex is measured where the sculpt's jaw warp (sculpt.jaw_weight) carries it shut.
    - smile (gummy grin): the corners draw up and back, the side lips part and show the gums; strongest at the sides.
    - snarl: the upper lip lifts well clear of the extended teeth (teeth_out) over the front and canines and peels
      outward (the lip edge rolls away from the teeth), the front lower lip drops, the nostrils ride up and the skin of
      the bridge bunches back toward the eyes in a few creases (the nose crinkle).
    """
    if body.data.shape_keys is None:
        body.shape_key_add(name="Basis")
    rest = [v.co.copy() for v in body.data.vertices]
    mobile = lip_mobility(rest)
    corner = Vector(SB.MOUTH_LINE_L[-1])
    corners = [corner, Vector((-corner.x, corner.y, corner.z))]
    lip = [Vector((-p[0], p[1], p[2])) for p in reversed(SB.MOUTH_LINE_L[1:])] + [Vector(p) for p in SB.MOUTH_LINE_L]
    half = corner.x                                                     # the lip line's half-width
    mouth_centre = Vector((0.0, corner.y + 0.01, SB.MOUTH_Z))
    nostrils = [Vector((s * SB.NOSTRIL_L[0], SB.NOSTRIL_L[1], SB.NOSTRIL_L[2])) for s in (1, -1)]
    reach, bunch, crease, pitch = SNARL_CRINKLE
    bridge = Vector((0.0, SB.NOSTRIL_L[1] + 0.075, SB.NOSTRIL_L[2] + 0.035))   # the snout top behind the nostrils
    smile = body.shape_key_add(name="smile", from_mix=False)
    snarl = body.shape_key_add(name="snarl", from_mix=False)
    flare = body.shape_key_add(name="nostril_flare", from_mix=False)
    for key in (smile, snarl, flare):
        key.value = 0.0   # Blender 5.1 creates shape keys at value 1.0; the bind pose must show the neutral face
    P = np.array([tuple(p) for p in rest])
    jaw = SB.jaw_weight(P)                                              # the sculpt's warp: 1 on the lower-jaw side
    shut = SB.close_jaw(P, jaw * A.JAW_REST_CLOSE_RAD)
    for i, p0 in enumerate(rest):
        upper = 1.0 - float(jaw[i])                                     # 1 on the upper lip side, 0 on the lower
        p = Vector(shut[i])                                             # where it sits with the mouth closed
        near_lip = _falloff(_polyline_distance(p, lip), LIP_REACH) * mobile[i]
        side = smoothstep(0.33 * half, 1.2 * half, abs(p.x))            # 0 at the front of the U, 1 toward a corner
        d_corner = min((p - c).length for c in corners)
        grin = (SMILE_UPPER * upper + SMILE_LOWER * (1.0 - upper)) * side * near_lip
        smile.data[i].co = p0 + grin + SMILE_CORNER * (_falloff(d_corner, 0.09) * mobile[i])
        canine = 1.0 - smoothstep(0.65 * half, 1.1 * half, abs(p.x))    # front and canines, fading at the corners
        out = Vector((p.x - mouth_centre.x, p.y - mouth_centre.y, 0.0))
        out = out.normalized() if out.length > 1e-6 else Vector()
        off = (SNARL_LIP + out * SNARL_PEEL) * (upper * canine * near_lip)
        off += SNARL_LOWER * ((1.0 - upper) * (1.0 - side) * canine * near_lip)
        near = min(nostrils, key=lambda c: (p - c).length)
        d_nostril = (p - near).length
        off += SNARL_NOSE * _falloff(d_nostril, 0.05)
        crinkle = (_falloff((p - bridge).length, reach) * smoothstep(SB.MOUTH_Z + 0.06, SB.MOUTH_Z + 0.13, p.z)
                   * (1.0 - smoothstep(0.07, 0.15, abs(p.x))))
        off += Vector((0.0, bunch, 0.5 * bunch + crease * math.sin(2.0 * math.pi * (p.y - bridge.y) / pitch))) * crinkle
        snarl.data[i].co = p0 + off
        radial = Vector((p.x - near.x, p.y - near.y, 0.0))
        flare.data[i].co = p0 + (radial.normalized() * 0.006 * _falloff(d_nostril, 0.035) if radial.length > 1e-6 else Vector())


class Dir(namedtuple("Dir", "x y z")):
    """A unit direction kept in double precision: mathutils.Vector stores float32, whose rounding alone puts a
    unit vector's length up to ~5e-8 off 1. vertex_ao converts to Vector where it casts rays."""
    __slots__ = ()

    @property
    def length(self):
        return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z)


def hemisphere_dirs(n=48):
    """Deterministic cosine-weighted directions around +Z (Fibonacci spiral)."""
    golden = math.pi * (3 - math.sqrt(5))
    out = []
    for i in range(n):
        r = math.sqrt((i + 0.5) / n)
        phi = i * golden
        out.append(Dir(r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1 - r * r))))
    return out


def occluder_bvh(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        base = len(verts)
        verts += [ob.matrix_world @ v.co for v in me.vertices]
        polys += [[base + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def vertex_ao(ob, bvh, dirs, dist=0.5):
    """Per-vertex ambient occlusion: 1 = open, 0 = fully occluded within `dist` metres."""
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    dirs = [Vector(d) for d in dirs]
    out = []
    for v in ob.data.vertices:
        n = (nm @ v.normal).normalized()
        q = n.to_track_quat("Z", "Y")
        origin = mw @ v.co + n * 0.003
        hits = sum(1 for d in dirs if bvh.ray_cast(origin, q @ d, dist)[0] is not None)
        out.append(1.0 - hits / len(dirs))
    return out


def dorsal_weight(p, spikes):
    """1 on and around a dorsal spike (distance measured in the spikes' un-squashed space), else 0."""
    for base, tip, radius in spikes:
        q = Vector(p) - Vector(base)
        q.x /= 0.33
        axis = Vector(tip) - Vector(base)
        length = axis.length
        a = axis / length
        u = max(0.0, min(1.0, q.dot(a) / length))
        if (q - a * (u * length)).length <= radius + (0.004 - radius) * u + 0.012:
            return 1.0
    return 0.0


def _write_mask(ob, rows):
    attr = ob.data.attributes.get("_MASK") or ob.data.attributes.new("_MASK", "FLOAT_VECTOR", "POINT")
    attr.data.foreach_set("vector", [c for row in rows for c in row])


def add_masks(objs):
    """_MASK on every mesh before joining (the join merges same-named attributes).
    Wing membranes are not occluders — spread in the bind pose they would roof over the flanks. The dorsal plates
    (parts.make_spikes) are the dorsal channel; on the body it marks the skin around their bases."""
    wings = [o for o in objs if o.name.startswith(WING_PARTS)]
    solid = [o for o in objs if o not in wings]
    bvh = occluder_bvh(solid)
    dirs = hemisphere_dirs(AO_RAYS)
    spikes = SB.dorsal_spikes()
    for ob in objs:
        if ob in wings:
            _write_mask(ob, [(1.0, 0.0, 0.0)] * len(ob.data.vertices))
            continue
        ao = vertex_ao(ob, bvh, dirs, AO_DIST)
        nm = ob.matrix_world.to_3x3().inverted().transposed()
        is_body, is_plates = ob.name == "Toothless", ob.name == "Spikes"
        rows = []
        for v, occ in zip(ob.data.vertices, ao):
            p = ob.matrix_world @ v.co
            n = (nm @ v.normal).normalized()
            under = smoothstep(-0.15, -0.65, n.z) if is_body else 0.0
            if is_plates:
                dorsal = 1.0
            else:
                dorsal = dorsal_weight(p, spikes) if is_body and abs(p.x) < 0.12 and p.z > 0.4 else 0.0
            rows.append((occ ** AO_GAMMA, under, dorsal))
        _write_mask(ob, rows)


def join_all(body, rig):
    parts = [o for o in bpy.context.scene.objects if o.type == "MESH" and o is not body]
    for o in parts:
        MT.select_only(o)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in parts:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.data.name = body.name   # the sculpt stage left the datablock as "Toothless.001"
    arm = [m for m in body.modifiers if m.type == "ARMATURE"]
    for m in arm[1:]:
        body.modifiers.remove(m)
    arm[0].object = rig
    MT.select_only(body)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    unweighted = sum(1 for v in body.data.vertices if not v.groups)
    if unweighted:
        raise RuntimeError(f"{unweighted} unweighted vertices after the join")
    return body


def run(rig, body):
    coverage = skin_body(body, rig)
    ratio = {b: got / max(exp, 1) for b, (got, exp) in coverage.items()}
    low = sorted(ratio, key=ratio.get)[:3]
    print("SKIN jaw", coverage["jaw"][0], "bones", len(coverage), "lowest coverage",
          [(b, *coverage[b], round(ratio[b], 2)) for b in low])
    add_face_keys(body)
    add_masks([o for o in bpy.context.scene.objects if o.type == "MESH"])
    join_all(body, rig)
    me = body.data
    print("JOINED verts", len(me.vertices), "tris", sum(len(p.vertices) - 2 for p in me.polygons),
          "keys", [k.name for k in me.shape_keys.key_blocks], "mats", [m.name for m in me.materials])
    return body
