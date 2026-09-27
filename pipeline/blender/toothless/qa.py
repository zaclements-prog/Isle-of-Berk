"""Toothless QA render sets (clay, Workbench) and reference composites."""
import os
import qa_render as QR

REF_SIDE = r"C:\Users\zacle\Pictures\Screenshots\Screenshot 2026-06-12 155402.png"
REF_TOP = r"C:\Users\zacle\Pictures\Screenshots\Screenshot 2026-06-12 155348.png"
REF_FRONT = r"C:\Users\zacle\dragon-walk\tools\ref_dtv.png"


def _composite(out_dir, name, render, ref):
    return [QR.composite(out_dir, name, os.path.join(out_dir, render + ".png"), ref)] if os.path.exists(ref) else []


def model_renders(sc, out_dir):
    shots = {
        "model_hero": dict(loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)),
        "model_side": dict(loc=(9.0, 1.3, 1.1), target=(0, 1.3, 1.1), ortho=7.9),
        "model_top": dict(loc=(0, 1.3, 9.0), target=(0, 1.3, 0.0), ortho=7.9),
        "model_front": dict(loc=(0, -6.5, 1.35), target=(0, 0, 1.0), lens=50),
        "model_face": dict(loc=(-1.45, -2.75, 1.55), target=(0, -1.9, 1.45), lens=50),
    }
    paths = [QR.shoot(sc, out_dir, name, **kw) for name, kw in shots.items()]
    paths += _composite(out_dir, "model_vs_ref_side", "model_side", REF_SIDE)
    paths += _composite(out_dir, "model_vs_ref_front", "model_front", REF_FRONT)
    return paths


def tack_renders(sc, out_dir):
    return [QR.shoot(sc, out_dir, "tack_hero", loc=(-3.2, -2.6, 2.4), target=(0, -0.3, 1.2)),
            QR.shoot(sc, out_dir, "tack_side", loc=(3.5, -0.3, 1.5), target=(0, -0.3, 1.2)),
            QR.shoot(sc, out_dir, "tack_tail", loc=(2.5, 4.0, 1.4), target=(0, 3.8, 0.7))]


def wing_renders(sc, rig, out_dir):
    import rig as R
    paths = [QR.shoot(sc, out_dir, "wings_spread_top", loc=(0, 0.5, 14.0), target=(0, 0.5, 0.0), ortho=15.5),
             QR.shoot(sc, out_dir, "wings_spread_hero", loc=(-7.5, -8.0, 5.0), target=(0, 0.3, 1.2))]
    R.fold_wings(rig, 0.5)
    paths.append(QR.shoot(sc, out_dir, "wings_half_hero", loc=(-5.0, -5.5, 3.2), target=(0, 0.3, 1.1)))
    R.reset_pose(rig)
    R.fold_wings(rig, 1.0)
    paths += [QR.shoot(sc, out_dir, "wings_folded_hero", loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)),
              QR.shoot(sc, out_dir, "wings_folded_side", loc=(9.0, 1.3, 1.1), target=(0, 1.3, 1.1), ortho=7.9),
              QR.shoot(sc, out_dir, "wings_folded_top", loc=(0, 1.3, 9.0), target=(0, 1.3, 0.0), ortho=7.9)]
    R.reset_pose(rig)
    paths += _composite(out_dir, "wings_vs_ref_top", "wings_spread_top", REF_TOP)
    return paths


# bone-local Euler (radians); local X is the lateral hinge for limbs and spine. +X swings a bone's far end toward its
# local +Z (the roll keeps Z up, or forward on near-vertical bones): forward for the forward/down-pointing leg bones,
# but backward-up for the hind tibia (it points back from the knee), so + flexes the knee there; + lifts a spine,
# neck or tail bone's far end.
DEFORM_POSES = {
    # walk, look: prototype assemble_v5.POSES, verbatim
    "walk": {"front_humerus_L": (0.55, 0, 0), "front_radius_L": (-0.7, 0, 0), "front_humerus_R": (-0.45, 0, 0),
             "hind_femur_R": (0.5, 0, 0), "hind_tibia_R": (-0.8, 0, 0), "hind_femur_L": (-0.45, 0, 0),
             "spine_02": (0, 0, 0.12), "spine_03": (0, 0, 0.12), "neck_02": (0, 0, 0.2), "neck_03": (0, 0, 0.2), "head": (0.1, 0, 0.15),
             **{f"tail_{i:02d}": (0, 0, -0.1) for i in range(2, 10)}},
    # sit: the prototype's hind-leg signs folded the feet up over the haunch (paw above the hip). The pelvis (the root)
    # pitches the torso up, the spine and neck counter-bend, the front legs swing back to vertical, and the hind legs
    # fold under the haunch: thigh forward, shin back, metatarsal and toes flat (both paw pairs end ~0.5 m up)
    "sit": {"pelvis": (0.45, 0, 0), "spine_01": (-0.1, 0, 0), "chest": (-0.1, 0, 0), "neck_01": (-0.15, 0, 0), "neck_02": (-0.05, 0, 0),
            "front_humerus_L": (-0.25, 0, 0), "front_humerus_R": (-0.25, 0, 0),
            "hind_femur_L": (0.05, 0, 0), "hind_femur_R": (0.05, 0, 0), "hind_tibia_L": (0.56, 0, 0), "hind_tibia_R": (0.56, 0, 0),
            "hind_metatarsal_L": (1.0, 0, 0), "hind_metatarsal_R": (1.0, 0, 0), "hind_toes_L": (-0.75, 0, 0), "hind_toes_R": (-0.75, 0, 0),
            **{f"tail_{i:02d}": (0.08, 0, 0.18) for i in range(1, 12)}},
    "look": {"neck_01": (0, 0, 0.25), "neck_02": (0, 0, 0.25), "neck_03": (0.1, 0, 0.3), "neck_04": (0.1, 0, 0.3), "head": (0.15, 0, 0.3), "jaw": (-0.45, 0, 0)},
    # gallop extremes (legs gathered under the body / fully extended; the spine flexes and extends with them)
    "gallop_gather": {"front_humerus_L": (-0.6, 0, 0), "front_humerus_R": (-0.6, 0, 0), "hind_femur_L": (0.6, 0, 0), "hind_femur_R": (0.6, 0, 0),
                      "spine_01": (0.08, 0, 0), "spine_02": (0.08, 0, 0), "spine_03": (-0.08, 0, 0), "chest": (-0.08, 0, 0)},
    "gallop_extend": {"front_humerus_L": (0.7, 0, 0), "front_humerus_R": (0.7, 0, 0), "front_radius_L": (-0.3, 0, 0), "front_radius_R": (-0.3, 0, 0),
                      "hind_femur_L": (-0.55, 0, 0), "hind_femur_R": (-0.55, 0, 0), "spine_01": (-0.05, 0, 0), "chest": (0.05, 0, 0)},
    # the rest of the spec §5.12 set (+ yaw turns a neck or head bone's far end to the dragon's left, a tail bone's to
    # its right), every sign checked on the renders. lie, scratch: hind legs re-solved (the first-draft signs put the lie's
    # hind paws above the hip and lifted the scratching foot over the back): lie folds them flat under the belly
    # (sphinx); scratch reaches the left foot forward along the flank to the shoulder (its 0.2 hip yaw keeps the foot
    # outside the chest)
    "lie": {"front_humerus_L": (-0.9, 0, 0), "front_humerus_R": (-0.9, 0, 0), "front_radius_L": (1.7, 0, 0), "front_radius_R": (1.7, 0, 0),
            "front_metacarpal_L": (-0.8, 0, 0), "front_metacarpal_R": (-0.8, 0, 0),
            "hind_femur_L": (0.68, 0, 0), "hind_femur_R": (0.68, 0, 0), "hind_tibia_L": (0.9, 0, 0), "hind_tibia_R": (0.9, 0, 0),
            "hind_metatarsal_L": (1.26, 0, 0), "hind_metatarsal_R": (1.26, 0, 0), "hind_toes_L": (-0.84, 0, 0), "hind_toes_R": (-0.84, 0, 0)},
    "scratch": {"hind_femur_L": (1.17, 0, 0.2), "hind_tibia_L": (-1.12, 0, 0), "hind_metatarsal_L": (-1.35, 0, 0), "hind_toes_L": (-0.18, 0, 0),
                "neck_01": (0, 0, 0.3), "neck_02": (0, 0, 0.3), "neck_03": (0, 0, 0.25), "neck_04": (0, 0, 0.2), "head": (0.2, 0, 0.3)},
    "climb_reach": {"front_scapula_L": (0.3, 0, 0), "front_humerus_L": (1.1, 0, 0), "front_radius_L": (0.3, 0, 0),
                    "chest": (0.2, 0, 0), "neck_01": (0.15, 0, 0), "neck_02": (0.15, 0, 0)},
    "neck_90": {"neck_01": (0, 0, 0.3), "neck_02": (0, 0, 0.3), "neck_03": (0, 0, 0.3), "neck_04": (0, 0, 0.3), "head": (0, 0, 0.3)},
    "tail_curl": {f"tail_{i:02d}": (0, 0, 0.22) for i in range(1, 13)},
}
FACE_POSES = {"blink": {"blink_L": 1, "blink_R": 1}, "squint": {"squint": 1}, "smile": {"smile": 1},
              "snarl": {"snarl": 1, "teeth_out": 1}, "roar": {"teeth_out": 1}}


def deform_renders(sc, rig, body, out_dir):
    import rig as R
    keys = body.data.shape_keys.key_blocks
    paths = []

    def pose(bones, fold=1.0, jaw=0.0):
        R.reset_pose(rig)
        R.fold_wings(rig, fold)
        if jaw:
            R.pose_jaw(rig, jaw)
        for name, rot in bones.items():
            pb = rig.pose.bones[name]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = rot
        import bpy
        bpy.context.view_layer.update()

    for name, bones in DEFORM_POSES.items():
        pose(bones)
        paths += [QR.shoot(sc, out_dir, f"deform_{name}_hero", loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)),
                  QR.shoot(sc, out_dir, f"deform_{name}_side", loc=(7.5, 0.4, 1.3), target=(0, 0.4, 0.9))]
    for name, weights in FACE_POSES.items():
        pose({}, jaw=1.0 if name == "roar" else 0.0)
        for k, w in weights.items():
            keys[k].value = w
        paths.append(QR.shoot(sc, out_dir, f"deform_face_{name}", loc=(-1.45, -2.75, 1.55), target=(0, -1.9, 1.45), lens=50))
        for k in weights:
            keys[k].value = 0.0
    for fold in (0.5, 1.0):
        pose({}, fold=fold)
        paths.append(QR.shoot(sc, out_dir, f"deform_wings_{int(fold * 100)}", loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)))
    keys["membrane_pleat_L"].value = keys["membrane_pleat_R"].value = 1.0
    paths.append(QR.shoot(sc, out_dir, "deform_wings_100_pleat", loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)))
    keys["membrane_pleat_L"].value = keys["membrane_pleat_R"].value = 0.0
    pose({})
    paths.append(mask_render(sc, body, out_dir))
    R.reset_pose(rig)
    return paths


def mask_render(sc, body, out_dir, name="deform_mask_ao"):
    """_MASK.x (vertex AO) as flat grey (grey level = stored value), wings folded. Workbench cannot display a
    FLOAT_VECTOR attribute (it draws flat grey), so the AO goes through a temporary FLOAT_COLOR copy that is removed
    right after the render: a colour attribute would reach the GLB as COLOR_0."""
    me = body.data
    n = len(me.vertices)
    mask = [0.0] * (3 * n)
    me.attributes["_MASK"].data.foreach_get("vector", mask)
    view = me.color_attributes.new("_MASK_view", "FLOAT_COLOR", "POINT")
    view.data.foreach_set("color", [c for i in range(n) for c in (mask[3 * i], mask[3 * i], mask[3 * i], 1.0)])
    me.color_attributes.active_color = view
    sh = sc.display.shading
    saved = (sh.light, sh.color_type, sh.show_cavity, sc.view_settings.view_transform)
    sh.light, sh.color_type, sh.show_cavity = "FLAT", "VERTEX", False   # "VERTEX" is the UI's "Attribute" mode
    sc.view_settings.view_transform = "Raw"                               # no display transform: grey = stored value
    try:
        return QR.shoot(sc, out_dir, name, loc=(-2.6, -3.8, 0.45), target=(0, -0.7, 0.85))   # low: eyes, jaw, armpit, legs
    finally:
        sh.light, sh.color_type, sh.show_cavity, sc.view_settings.view_transform = saved
        me.color_attributes.remove(me.color_attributes["_MASK_view"])
