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
