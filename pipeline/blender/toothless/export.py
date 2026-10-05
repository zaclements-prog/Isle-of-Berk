"""GLB + rig.json + poses.json export."""
import json
import os
import bpy
import anatomy as A
import library as LIB

REQUIRED_OPTS = {
    "export_format": "GLB", "use_selection": True, "export_yup": True, "export_apply": False,
    "export_skins": True, "export_morph": True, "export_morph_normal": True, "export_animations": True,
    "export_animation_mode": "NLA_TRACKS", "export_force_sampling": True, "export_optimize_animation_size": False,
    "export_optimize_animation_keep_anim_armature": True, "export_def_bones": False, "export_materials": "EXPORT",
    "export_attributes": True,        # custom attributes whose names start with "_" (the _MASK vec3)
    "export_try_sparse_sk": True,     # sparse morph accessors: face keys touch a few hundred vertices, not 40 k
}


def _export(path, objects, active, **overrides):
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    missing = [k for k in REQUIRED_OPTS if k not in props]
    if missing:
        raise RuntimeError(f"glTF exporter lacks options {missing}")
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active
    bpy.ops.export_scene.gltf(filepath=path, **{**REQUIRED_OPTS, **overrides})


def export_glb(rig, mesh, path):
    """Mesh + skin + morphs in the bind pose; the pose library ships separately."""
    if mesh.data.shape_keys:
        for kb in mesh.data.shape_keys.key_blocks:
            kb.value = 0.0            # shape-key values become default morph weights
    _export(path, [mesh, rig], rig, export_animations=False)


def export_poses(rig, path):
    """Armature only, every NLA track as a glTF animation (spec §5.11: toothless.poses.glb)."""
    _export(path, [rig], rig)


def rig_json(rig, mesh):
    G = A.blender_to_gltf
    bones = []
    for b in rig.data.bones:
        bones.append({"name": b.name, "parent": b.parent.name if b.parent else None,
                      "head": G(b.head_local), "tail": G(b.tail_local), "length": round(b.length, 5),
                      "xAxis": G(b.matrix_local.to_3x3().col[0])})   # the hinge axis for limbs/spine (bind pose)
    spine = ["pelvis", "spine_01", "spine_02", "spine_03", "chest"]
    neck = ["neck_01", "neck_02", "neck_03", "neck_04", "head"]
    tail = [f"tail_{i:02d}" for i in range(1, 13)]
    limbs, contacts = {}, {}
    for side, s in (("L", 1), ("R", -1)):
        mirror = (lambda p: p) if s > 0 else A.mirror
        for kind, limb in A.LIMBS.items():
            key = f"{kind}_{side}"
            limbs[key] = {"bones": [f"{n}_{side}" for n in limb["bones"]], "pole": G(limb["pole"]),
                          "limitsDeg": {f"{n}_{side}": v for n, v in limb["limits"].items()}}
            c = A.CONTACTS_L[kind]
            contacts[key] = {"bone": f"{c['bone']}_{side}", "sole": G(mirror(c["sole"])),
                             "toe": G(mirror(c["toe"])), "heel": G(mirror(c["heel"]))}
    keys = [k.name for k in mesh.data.shape_keys.key_blocks[1:]] if mesh.data.shape_keys else []
    return {
        "version": 1, "units": "m", "up": "+Y", "forward": "+Z",
        "bones": bones,
        "chains": {"spine": spine, "neck": neck, "tail": tail},
        "limbs": limbs, "contacts": contacts,
        "proxies": [{"name": n, "bone": b, "center": G(c), "radius": r} for n, b, c, r in A.PROXIES],
        "anchors": {k: {"bone": b, "position": G(p)} for k, (b, p) in A.ANCHORS.items()},
        "jaw": {"bone": "jaw", "openSign": A.JAW_OPEN_SIGN, "maxOpenRad": 0.62, "restCloseRad": A.JAW_REST_CLOSE_RAD},
        # blink keys per eye at 1/3, 2/3 and all of the blink (parts.BLINK_STEPS): blend piecewise-linearly
        "blink": {side: [f"blink_{side}_a", f"blink_{side}_b", f"blink_{side}"] for side in ("L", "R")},
        "chainLimitsDeg": A.CHAIN_LIMITS,
        "wings": {side: {"humerus": f"wing_humerus_{side}", "forearm": f"wing_forearm_{side}", "thumb": f"wing_thumb_{side}",
                         "ribs": [[f"wing_rib{i}_a_{side}", f"wing_rib{i}_b_{side}"] for i in range(1, 8)],
                         "hipRibs": [f"hipwing_rib{i}_{side}" for i in range(1, 5)],
                         "finRibs": [f"tailfin_rib{i}_{side}" for i in range(1, 4)],
                         "foldClips": ["bind", "wings_fold_25", "wings_half", "wings_fold_75", "wings_folded"]}
                  for side in ("L", "R")},
        "ears": {side: [f"ear_{i}_{side}" for i in range(1, 4)] for side in ("L", "R")},
        "morphs": keys,
        "clips": ["bind", "wings_fold_25", "wings_half", "wings_fold_75", "wings_folded", "jaw_open", *LIB.LIBRARY],
        "proportions": {k: round(v, 4) for k, v in A.proportions().items()},
    }


WING_MASK = {"mask": ["wing_", "hipwing_"]}
POSES = {"clips": {"bind": {"mask": "all"}, "wings_fold_25": WING_MASK, "wings_half": WING_MASK,
                   "wings_fold_75": WING_MASK, "wings_folded": WING_MASK, "jaw_open": {"mask": ["jaw"]}}}


def poses_json(rig):
    """toothless.poses.json v2: Plan 2's clip masks plus the library metadata (masks, ownsLegs, root, wings, soles,
    loop, blends, interrupt, duration, face curves), and the wing flare the engine's WingController applies."""
    return {"version": 2, "wingFlare": {"deg": LIB.FLARE_DEG, "liftDeg": LIB.FLARE_LIFT_DEG},
            "clips": {**POSES["clips"], **LIB.meta_entries(rig)}}


def write_all(rig, mesh, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    export_glb(rig, mesh, os.path.join(out_dir, "toothless.glb"))
    export_poses(rig, os.path.join(out_dir, "toothless.poses.glb"))
    with open(os.path.join(out_dir, "toothless.rig.json"), "w", encoding="utf-8") as f:
        json.dump(rig_json(rig, mesh), f, indent=1)
    with open(os.path.join(out_dir, "toothless.poses.json"), "w", encoding="utf-8") as f:
        json.dump(poses_json(rig), f, indent=1)
