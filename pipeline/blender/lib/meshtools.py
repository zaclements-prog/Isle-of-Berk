"""Mesh utilities for the asset pipeline (Blender)."""
import bpy
import bmesh
from mathutils import Vector, kdtree


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


def weld_mirror_seam(ob, tol=0.005, merge=1e-5, max_hole_sides=8):
    """Weld a mesh mirrored across X = 0 whose halves were left unjoined: snap the boundary vertices lying
    within `tol` of the plane onto it and merge the now-coincident mirror pairs.

    Two QuadriFlow artefacts along the seam are repaired on the way:
    - faces lying IN the plane (every vertex on the seam) are zero-thickness flaps left where a feature is thinner
      than a quad (dorsal-spike tips); each coincides with its mirror twin, so both twins are dropped and the
      edges/vertices only they used are cleared;
    - where a seam vertex was pulled off the plane, the two halves leave a small hole straddling the seam; each hole
      of at most `max_hole_sides` edges is closed with one face (larger holes stay open for mesh_report to flag).
    Returns (merged verts, dropped flap faces, filled holes)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    seam = {v for e in bm.edges if e.is_boundary for v in e.verts if abs(v.co.x) <= tol}
    flaps = [f for f in bm.faces if all(v in seam for v in f.verts)]
    bmesh.ops.delete(bm, geom=flaps, context="FACES_ONLY")
    for v in seam:
        v.co.x = 0.0
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=list(seam), dist=merge)
    merged = before - len(bm.verts)
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context="EDGES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    holes = [e for e in bm.edges if e.is_boundary]
    filled = bmesh.ops.holes_fill(bm, edges=holes, sides=max_hole_sides)["faces"] if holes else []
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return merged, len(flaps), len(filled)


def folded_faces(bm, limit=-0.5):
    """Faces turned against their surroundings: the normal opposes every edge neighbour's, or the area-weighted
    normal of the faces around its vertices. QuadriFlow folds or crumples the odd spot where a feature is thinner
    than its quads (thin dorsal-spike blades, a singularity cluster); sharp but consistent features (spike ridges,
    the mouth slit) are not flagged."""
    bm.normal_update()
    out = []
    for f in bm.faces:
        if all(f.normal.dot(g.normal) < -0.2 for e in f.edges for g in e.link_faces if g is not f):
            out.append(f)
            continue
        ring = Vector()
        for g in {g for v in f.verts for g in v.link_faces if g is not f}:
            ring += g.normal * g.calc_area()
        if ring.length > 0.0 and f.normal.dot(ring.normalized()) < limit:
            out.append(f)
    return out


def unfold(ob, iterations=50, mirror_x=False):
    """Repair folded faces by relaxing (Laplacian smoothing: each vertex to its neighbours' centroid) the two-ring
    around them until none remain. Topology is untouched; with `mirror_x`, vertices on X = 0 stay there, so a
    symmetric mesh stays symmetric. Returns the number of folded faces left."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(iterations):
        folded = folded_faces(bm)
        if not folded:
            break
        region = {v for f in folded for v in f.verts}
        for _ring in range(2):
            region |= {e.other_vert(v) for v in region for e in v.link_edges}
        bmesh.ops.smooth_vert(bm, verts=list(region), factor=1.0, mirror_clip_x=mirror_x,
                              clip_dist=1e-5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    left = len(folded_faces(bm))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return left


def quadriflow(ob, target_faces, symmetry=True, seed=0):
    select_only(ob)
    ob.data.use_mirror_x = symmetry
    result = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=symmetry, mode="FACES", target_faces=target_faces, seed=seed)
    if result != {"FINISHED"}:
        raise RuntimeError("QuadriFlow refused the mesh — run manifold_voxel_remesh + clean_degenerate first")
    if symmetry:
        # Blender's symmetric mode remeshes one half and mirrors it WITHOUT welding: two islands meeting along
        # X = 0 as open boundaries (seen in Blender 5.1). Weld them into one closed surface.
        weld_mirror_seam(ob)
    unfold(ob, mirror_x=symmetry)
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
