"""Clay QA renders and side-by-side reference composites."""
import math
import os
import bpy
import numpy as np
from mathutils import Vector


def setup_clay(sc):
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_backface_culling = False
    world = bpy.data.worlds.get("QA") or bpy.data.worlds.new("QA")
    sc.world = world
    world.color = (0.2, 0.22, 0.26)


def shoot(sc, out_dir, name, loc, target, lens=35, res=(1200, 800), ortho=None):
    os.makedirs(out_dir, exist_ok=True)
    cam_data = bpy.data.cameras.new(f"QA_{name}")
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho
    else:
        cam_data.lens = lens
    cam = bpy.data.objects.new(f"QA_{name}", cam_data)
    cam.location = loc
    sc.collection.objects.link(cam)
    d = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = (math.pi / 2 + math.asin(max(-1.0, min(1.0, d.z))), 0.0, -math.atan2(d.x, d.y))
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    path = os.path.join(out_dir, name + ".png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)
    return path


def _load(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return px


def _resize(px, h):
    H, W = px.shape[:2]
    w = int(round(W * h / H))
    return px[(np.arange(h) * H / h).astype(int)][:, (np.arange(w) * W / w).astype(int)]


def composite(out_dir, name, left, right, h=520):
    a = _resize(_load(left), h)
    b = _resize(_load(right), h)
    out = np.concatenate([a, np.ones((h, 8, 4), np.float32), b], axis=1)
    img = bpy.data.images.new(name, out.shape[1], out.shape[0], alpha=True)
    img.pixels = out.ravel()
    path = os.path.join(out_dir, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path
