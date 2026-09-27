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
