"""Toothless build stages. Usage (via run.ps1): build.py --stage model|wings|tack|assemble|export|all"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(ROOT, "lib"), HERE]

import bpy  # noqa: E402
import scene as SC  # noqa: E402
import meshtools as MT  # noqa: E402
import qa_render as QR  # noqa: E402
import rig as R  # noqa: E402
import sculpt as SB  # noqa: E402
import parts as P  # noqa: E402
import wings as W  # noqa: E402
import tack as T  # noqa: E402
import assemble as AS  # noqa: E402
import qa  # noqa: E402

REPO = os.path.dirname(os.path.dirname(ROOT))
BUILD = os.path.join(ROOT, "build")
QA_DIR = os.path.join(REPO, "docs", "progress", "img", "toothless")
ASSETS = os.path.join(REPO, "public", "assets", "characters", "toothless")
VOX = 0.008
FACES = 24000
COLORS = {
    "skin": (0.46, 0.47, 0.5), "membrane": (0.34, 0.35, 0.39), "eye": (0.62, 0.78, 0.16), "mouth": (0.75, 0.3, 0.33),
    "teeth": (0.95, 0.93, 0.88), "claw": (0.85, 0.8, 0.72), "prosthetic": (0.62, 0.12, 0.08),
    "leather": (0.36, 0.22, 0.12), "metal": (0.55, 0.56, 0.58),
}


def materials():
    """Clay placeholder materials; the engine swaps in the real ones by name (Task 8)."""
    out = {}
    for name, rgb in COLORS.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.diffuse_color = (*rgb, 1.0)
        out[name] = m
    return out


def open_stage(name):
    """Open the .blend an earlier stage saved; returns (rig, body)."""
    bpy.ops.wm.open_mainfile(filepath=os.path.join(BUILD, f"toothless_{name}.blend"))
    return bpy.data.objects["ToothlessRig"], bpy.data.objects["Toothless"]


def stage_model():
    sc = SC.reset()
    coll = SC.collection("01_Toothless")
    M = materials()
    rig = R.build_armature()
    SC.move_to(rig, coll)
    body = SB.build(VOX).to_mesh("Toothless", os.path.join(BUILD, "body.vdb"))
    SC.move_to(body, coll)
    MT.manifold_voxel_remesh(body, VOX)
    MT.clean_degenerate(body)
    MT.quadriflow(body, FACES)
    body.data.materials.append(M["skin"])
    P.assign_mouth_material(body, M["mouth"], inset=0.03)
    parts = (P.make_eyes(rig, M["eye"]) + P.make_lids(rig, M["skin"]) + [P.make_teeth(rig, M["teeth"]), P.make_tongue(rig, M["mouth"])]
             + P.make_ears(rig, M["skin"]) + P.make_claws(rig, M["claw"]))
    for ob in parts:
        SC.move_to(ob, coll)
    print("MODEL", MT.mesh_report(body), "symmetry", round(MT.symmetry_error(body), 5))
    QR.setup_clay(sc)
    qa.model_renders(sc, QA_DIR)
    SC.save(os.path.join(BUILD, "toothless_model.blend"))


def stage_wings():
    rig, body = open_stage("model")
    sc = bpy.context.scene
    coll = SC.collection("01_Toothless")
    for ob in W.build_all(rig, materials()):
        SC.move_to(ob, coll)
    print("WINGS folded", W.fold_metrics(rig, [bpy.data.objects["Wing_L"], bpy.data.objects["Wing_R"]]))
    QR.setup_clay(sc)
    qa.wing_renders(sc, rig, QA_DIR)
    SC.save(os.path.join(BUILD, "toothless_wings.blend"))


def stage_tack():
    rig, body = open_stage("wings")
    sc = bpy.context.scene
    coll = SC.collection("01_Toothless")
    for ob in T.build_all(rig, body, materials()):
        SC.move_to(ob, coll)
    QR.setup_clay(sc)
    qa.tack_renders(sc, QA_DIR)
    SC.save(os.path.join(BUILD, "toothless_tack.blend"))


def stage_assemble():
    rig, body = open_stage("tack")
    sc = bpy.context.scene
    AS.run(rig, body)
    QR.setup_clay(sc)
    qa.deform_renders(sc, rig, body, QA_DIR)
    SC.save(os.path.join(BUILD, "toothless_assembled.blend"))


STAGES = {"model": stage_model, "wings": stage_wings, "tack": stage_tack,
          "assemble": stage_assemble}   # a later task adds "export" last


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all", choices=["all", *STAGES])
    stage = ap.parse_args(argv).stage
    os.makedirs(BUILD, exist_ok=True)
    for name in (list(STAGES) if stage == "all" else [stage]):
        print(f"=== stage {name} ===")
        STAGES[name]()


if __name__ == "__main__":
    main()
