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


def aim(rig, bone, direction, up=Vector((0, 0, 1))):
    """Point a pose bone along `direction` (armature space), keeping its current head."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[bone]
    head = pb.head.copy()
    y = Vector(direction).normalized()
    x = y.cross(up)
    x = x.normalized() if x.length > 1e-6 else Vector((1, 0, 0))
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = head
    pb.matrix = m
    bpy.context.view_layer.update()


def rest_dir(rig, bone):
    b = rig.data.bones[bone]
    return (b.tail_local - b.head_local).normalized()


def fold_wings(rig, amount):
    """Fan-fold both main wings and the hip wings (amount 0 = spread bind pose, 1 = folded)."""
    if amount <= 0:
        return
    def mix(bone, target):
        return rest_dir(rig, bone).lerp(Vector(target).normalized(), amount)
    for s, sfx in ((1, "L"), (-1, "R")):
        aim(rig, f"wing_humerus_{sfx}", mix(f"wing_humerus_{sfx}", (s * 0.08, 0.95, -0.25)))
        aim(rig, f"wing_forearm_{sfx}", mix(f"wing_forearm_{sfx}", (s * 0.06, -0.95, 0.22)))
        for i in range(7):   # double fold: inner halves back along the flank, outer halves folded forward over them
            back = (s * (0.08 + 0.012 * i), 0.97, -0.12 - 0.03 * i)
            fwd = (s * (0.14 + 0.01 * i), -0.96, 0.08 - 0.02 * i)
            aim(rig, f"wing_rib{i+1}_a_{sfx}", mix(f"wing_rib{i+1}_a_{sfx}", back))
            # only the four long leading ribs double-fold; the short rear ribs fold straight back so the
            # inner membrane (body -> last rib) collapses instead of being dragged forward into a skirt
            aim(rig, f"wing_rib{i+1}_b_{sfx}", mix(f"wing_rib{i+1}_b_{sfx}", fwd if i < 4 else back))
        for i in range(4):
            aim(rig, f"hipwing_rib{i+1}_{sfx}", mix(f"hipwing_rib{i+1}_{sfx}", (s * (0.22 + 0.04 * i), 0.96, -0.18 - 0.05 * i)))


def pose_jaw(rig, amount):
    """0 = closed (bind), 1 = wide open (~35 degrees)."""
    import math
    pb = rig.pose.bones["jaw"]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (A.JAW_OPEN_SIGN * 0.62 * amount, 0.0, 0.0)
    bpy.context.view_layer.update()
