"""Mesh utilities for the asset pipeline (Blender)."""
import bpy
import bmesh
from mathutils import kdtree


def select_only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def manifold_voxel_remesh(ob, voxel):
    """Voxel remesh → a closed manifold surface (VDB meshing can leave thin non-manifold walls)."""
    select_only(ob)
    ob.data.remesh_voxel_size = voxel
    if bpy.ops.object.voxel_remesh() != {"FINISHED"}:
        raise RuntimeError(f"voxel_remesh failed on {ob.name}")


def clean_degenerate(ob, dist=0.0006):
    """Remove near-zero edges/doubles and make normals consistent (QuadriFlow rejects any edge < 0.1 mm)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=bm.edges[:])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=dist)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def quadriflow(ob, target_faces, symmetry=True, seed=0):
    select_only(ob)
    ob.data.use_mirror_x = symmetry
    result = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=symmetry, mode="FACES", target_faces=target_faces, seed=seed)
    if result != {"FINISHED"}:
        raise RuntimeError("QuadriFlow refused the mesh — run manifold_voxel_remesh + clean_degenerate first")
    for p in ob.data.polygons:
        p.use_smooth = True


def mesh_report(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    rep = {
        "verts": len(bm.verts),
        "faces": len(bm.faces),
        "tris": sum(len(f.verts) - 2 for f in bm.faces),
        "boundary_edges": sum(1 for e in bm.edges if e.is_boundary),
        "nonmanifold_edges": sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary),
        "short_edges": sum(1 for e in bm.edges if e.calc_length() < 1e-4),
    }
    seen, islands = set(), 0
    for f in bm.faces:
        if f.index in seen:
            continue
        islands += 1
        stack = [f]
        while stack:
            g = stack.pop()
            if g.index in seen:
                continue
            seen.add(g.index)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        stack.append(h)
    rep["islands"] = islands
    bm.free()
    return rep


def symmetry_error(ob):
    """Largest distance from any vertex's X-mirror to the nearest vertex (metres)."""
    me = ob.data
    kd = kdtree.KDTree(len(me.vertices))
    for i, v in enumerate(me.vertices):
        kd.insert(v.co, i)
    kd.balance()
    worst = 0.0
    for v in me.vertices:
        m = v.co.copy()
        m.x = -m.x
        worst = max(worst, kd.find(m)[2])
    return worst
