"""Scene hygiene helpers (see the Blender hygiene protocol)."""
import bpy


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def collection(name, hidden=False):
    sc = bpy.context.scene
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    coll.hide_render = hidden
    coll.hide_viewport = hidden
    return coll


def move_to(ob, coll):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)


def purge_orphans():
    for _ in range(10):
        if not bpy.data.orphans_purge(do_recursive=True):
            break


def save(path):
    purge_orphans()
    bpy.ops.wm.save_as_mainfile(filepath=path)
