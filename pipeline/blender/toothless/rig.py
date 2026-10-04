"""Build the Toothless armature from anatomy.bone_specs() and small posing helpers."""
import bpy
from mathutils import Vector, Matrix
import anatomy as A


def build_armature(name="ToothlessRig"):
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = data.edit_bones
    for bname, head, tail, parent, deform in A.bone_specs():
        b = eb.new(bname)
        b.head = Vector(head); b.tail = Vector(tail)
        d = (b.tail - b.head).normalized()
        # roll: keep local Z as close to world up as possible (world -Y for near-vertical bones)
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, -1, 0))
        b.align_roll(up)
        b.use_deform = deform
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def reset_pose(rig):
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def _frame(direction, up):
    """Bone frame (3x3, armature space): local Y along `direction`, local X = Y x up, local Z = X x Y."""
    y = Vector(direction).normalized()
    x = y.cross(Vector(up))
    x = x.normalized() if x.length > 1e-6 else Vector((1, 0, 0))
    z = x.cross(y)
    return Matrix((x, y, z)).transposed()


def aim(rig, bone, direction, up=Vector((0, 0, 1))):
    """Point a pose bone along `direction` (armature space), keeping its current head."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[bone]
    head = pb.head.copy()
    m = _frame(direction, up).to_4x4()
    m.translation = head
    pb.matrix = m
    bpy.context.view_layer.update()


def rest_dir(rig, bone):
    b = rig.data.bones[bone]
    return (b.tail_local - b.head_local).normalized()


# Folded-wing targets: armature-space directions for the left side (x mirrors for the right).
FOLD_HUMERUS = (0.16, 0.97, -0.10)    # back along the top of the flank, clear of the waist
FOLD_FOREARM = (0.05, -0.97, 0.12)    # forward over the humerus: the wrist ends above the shoulder
DOUBLED_RIBS = 4                      # ribs 1-4 (4.75-3.05 m) fold their outer halves forward; 5-7 go straight back


def _rib_back(i):
    """Inner half (and the whole of ribs 5-7): back along the flank, lower ribs splayed out and down."""
    return (0.07 + 0.012 * i, 0.99, -0.10 - 0.025 * i)


def _rib_forward(i):
    """Outer half of a doubled rib: forward over the bundle. It rises more steeply than its inner half falls, so the
    hinge turns < 180 deg over the top (a clip blend's shortest path goes over, never down through the legs)."""
    return (0.03 + 0.01 * i, -0.99, 0.14 + 0.03 * i)


def fold_wings(rig, amount):
    """Fan-fold both main wings and the hip wings (amount 0 = spread bind pose, 1 = folded).

    0 -> 0.5: the arm folds (humerus back along the flank, forearm forward over it) while every rib swings back with
    its joint straight, so the membrane closes like a hand fan. 0.5 -> 1: the outer halves of the four long leading
    ribs hinge forward over the top of the bundle, keeping the fold between shoulder and tail base. The hinge keeps
    each rib's lateral axis (a yaw would flip it), so the membrane between a doubled rib and a straight one lies along
    the flank instead of flipping out as a sail; the short rear ribs fold straight back so the inner membrane
    (body -> last rib) collapses instead of being dragged forward into a skirt.
    """
    if amount <= 0:
        return
    def mix(bone, target):
        return rest_dir(rig, bone).lerp(Vector(target).normalized(), amount)
    hinge = min(1.0, max(0.0, 2.0 * amount - 1.0))
    up = Vector((0, 0, 1))
    for s, sfx in ((1, "L"), (-1, "R")):
        side = lambda v: (s * v[0], v[1], v[2])
        aim(rig, f"wing_humerus_{sfx}", mix(f"wing_humerus_{sfx}", side(FOLD_HUMERUS)))
        aim(rig, f"wing_forearm_{sfx}", mix(f"wing_forearm_{sfx}", side(FOLD_FOREARM)))
        for i in range(7):
            inner, outer = f"wing_rib{i+1}_a_{sfx}", f"wing_rib{i+1}_b_{sfx}"
            back = mix(inner, side(_rib_back(i)))
            aim(rig, inner, back)
            if i < DOUBLED_RIBS:
                straight = _frame(back, up).to_quaternion()
                q = straight.slerp(_frame(side(_rib_forward(i)), -up).to_quaternion(), hinge)
                aim(rig, outer, q @ Vector((0, 1, 0)), up=q @ Vector((0, 0, 1)))
            else:
                aim(rig, outer, back)
        for i in range(4):
            aim(rig, f"hipwing_rib{i+1}_{sfx}", mix(f"hipwing_rib{i+1}_{sfx}", (s * (0.22 + 0.04 * i), 0.96, -0.18 - 0.05 * i)))


def pose_jaw(rig, amount):
    """0 = closed (bind), 1 = wide open (~35 degrees)."""
    import math
    pb = rig.pose.bones["jaw"]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (A.JAW_OPEN_SIGN * 0.62 * amount, 0.0, 0.0)
    bpy.context.view_layer.update()
