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
# vertex AO: occluder search distance (m) and hemisphere rays. 1 m spans the neighbouring masses of this 7 m dragon
# (legs ~0.45 m apart, belly ~0.6 m above the paws); at 0.5 m the armpits and under the jaw barely registered (0.90,
# 0.97). 96 rays halve the blotches the 48-ray set left on smooth flanks.
AO_DIST, AO_RAYS = 1.0, 96
# face key offsets (metres; +y = back, +z = up)
LIP_REACH = 0.07                                   # lip offsets fade out this far from the lip line
SMILE_UPPER = Vector((0, 0.015, 0.03))             # side upper lip: up and back (the gums show)
SMILE_LOWER = Vector((0, 0.015, 0.0))              # side lower lip only draws back: the lips part
SMILE_CORNER = Vector((0, 0.025, 0.035))           # corners and cheeks draw up and back
SNARL_LIP = Vector((0, 0.006, 0.04))               # upper lip clears the extended teeth (~2 cm into the slit)
SNARL_LOWER = Vector((0, 0.0, -0.012))             # front lower lip drops
SNARL_NOSE = Vector((0, 0.006, 0.012))             # nose wrinkles up


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


def skin_body(body, rig):
    """Heat weights on the body with the non-body bones excluded (they would steal weights)."""
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
    confine_limb_roots(body, rig)
    # scripted correction (spec §5.6): a smooth of every group evens out limb seams and the jagged edges heat weighting
    # leaves where a bone's visibility flips between neighbouring vertices. Blender 5.1 only runs vertex_group_smooth
    # in Edit Mode (or weight-paint vertex selection), on the selected vertices: select them all.
    MT.select_only(body)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=SMOOTH_REPEAT)
    bpy.ops.object.mode_set(mode="OBJECT")
    # Blender reports heat-weighting failure only as a warning: failed bones end up with empty groups
    counts = {}
    for v in body.data.vertices:
        for g in v.groups:
            if g.weight > 0.2:
                name = body.vertex_groups[g.group].name
                counts[name] = counts.get(name, 0) + 1
    empty = [b.name for b in rig.data.bones if not b.name.startswith(NON_BODY) and counts.get(b.name, 0) < 5]
    if empty or counts.get("jaw", 0) < 500:
        raise RuntimeError(f"heat weighting failed: empty={empty} jaw={counts.get('jaw', 0)}")
    return counts


def _falloff(d, radius):
    return 1.0 - smoothstep(0.0, radius, d)


def _polyline_distance(p, pts):
    return min(_segment_distance(p, a, b) for a, b in zip(pts, pts[1:]))


def lip_mobility(points):
    """1 on the outer skin, fading to 0 from 0.5 to 3 cm inside the lip line within the slit (the gums, whose
    retracted teeth sit 3 cm in, stay put). Smooth in xy and z, unlike the stair-stepped mouth-material border."""
    depth = -polygon_slab(SB.mouth_polygon(outset=0.0), SB.MOUTH_Z, 1.0).fn(np.array([tuple(p) for p in points]))
    out = []
    for p, d in zip(points, depth):
        in_slit = 1.0 - smoothstep(0.012, 0.022, abs(p.z - SB.MOUTH_Z))
        out.append(1.0 - in_slit * smoothstep(0.005, 0.03, float(d)))
    return out


def add_face_keys(body):
    """smile / snarl / nostril_flare on the body (the join later merges keys by name).

    Lip offsets fall off with the distance to the lip line (the whole U, not its sample points: those sit ~10 cm apart)
    and split smoothly into upper and lower lip across the slit, so the lips part without tearing at the corners. Inside
    the slit they fade out from the lip line to 3 cm deep (`lip_mobility`): the gums at the teeth line stay, keep the
    retracted teeth covered and show where the lips part.
    - smile (gummy grin): the corners draw up and back, the side lips part and show the gums; strongest at the sides.
    - snarl: the upper lip lifts clear of the extended teeth (teeth_out) over the front and canines, the front lower
      lip drops, and the nose wrinkles up.
    """
    if body.data.shape_keys is None:
        body.shape_key_add(name="Basis")
    rest = [v.co.copy() for v in body.data.vertices]
    mobile = lip_mobility(rest)
    corner = Vector(SB.MOUTH_LINE_L[-1])
    corners = [corner, Vector((-corner.x, corner.y, corner.z))]
    lip = [Vector((-p[0], p[1], p[2])) for p in reversed(SB.MOUTH_LINE_L[1:])] + [Vector(p) for p in SB.MOUTH_LINE_L]
    nostrils = [Vector((s * 0.062, -2.2, 1.708)) + Vector(A.HEAD_OFFSET) for s in (1, -1)]
    smile = body.shape_key_add(name="smile", from_mix=False)
    snarl = body.shape_key_add(name="snarl", from_mix=False)
    flare = body.shape_key_add(name="nostril_flare", from_mix=False)
    for key in (smile, snarl, flare):
        key.value = 0.0   # Blender 5.1 creates shape keys at value 1.0; the bind pose must show the neutral face
    for i, p in enumerate(rest):
        near_lip = _falloff(_polyline_distance(p, lip), LIP_REACH) * mobile[i]
        upper = smoothstep(SB.MOUTH_Z - 0.009, SB.MOUTH_Z + 0.009, p.z)   # 1 on the upper lip, 0 on the lower
        side = smoothstep(0.08, 0.30, abs(p.x))                          # 0 at the front of the U, 1 toward a corner
        d_corner = min((p - c).length for c in corners)
        grin = (SMILE_UPPER * upper + SMILE_LOWER * (1.0 - upper)) * side * near_lip
        smile.data[i].co = p + grin + SMILE_CORNER * (_falloff(d_corner, 0.09) * mobile[i])
        canine = 1.0 - smoothstep(0.18, 0.32, abs(p.x))                  # front and canines, fading at the corners
        off = (SNARL_LIP * upper + SNARL_LOWER * (1.0 - upper) * (1.0 - side)) * (canine * near_lip)
        near = min(nostrils, key=lambda c: (p - c).length)
        d_nostril = (p - near).length
        off += SNARL_NOSE * _falloff(d_nostril, 0.05)
        snarl.data[i].co = p + off
        radial = Vector((p.x - near.x, p.y - near.y, 0.0))
        flare.data[i].co = p + (radial.normalized() * 0.006 * _falloff(d_nostril, 0.035) if radial.length > 1e-6 else Vector())


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
    Wing membranes are not occluders — spread in the bind pose they would roof over the flanks."""
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
        is_body = ob.name == "Toothless"
        rows = []
        for v, occ in zip(ob.data.vertices, ao):
            p = ob.matrix_world @ v.co
            n = (nm @ v.normal).normalized()
            under = smoothstep(-0.15, -0.65, n.z) if is_body else 0.0
            dorsal = dorsal_weight(p, spikes) if is_body and abs(p.x) < 0.12 and p.z > 0.4 else 0.0
            rows.append((occ, under, dorsal))
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
    counts = skin_body(body, rig)
    print("SKIN jaw", counts.get("jaw"), "groups", len(counts))
    add_face_keys(body)
    add_masks([o for o in bpy.context.scene.objects if o.type == "MESH"])
    join_all(body, rig)
    me = body.data
    print("JOINED verts", len(me.vertices), "tris", sum(len(p.vertices) - 2 for p in me.polygons),
          "keys", [k.name for k in me.shape_keys.key_blocks], "mats", [m.name for m in me.materials])
    return body
