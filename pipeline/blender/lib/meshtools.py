"""Mesh utilities for the asset pipeline (Blender)."""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree


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
        neighbours = {g for e in f.edges for g in e.link_faces if g is not f}
        if neighbours and all(f.normal.dot(g.normal) < -0.2 for g in neighbours):
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


def canonical_order(ob, quantum=1e-5):
    """Renumber a bare mesh (positions + faces, no other data) into a canonical order: vertices sorted by quantised
    position (x, then y, then z; exact coordinates break ties inside a quantum), each face's loop rotated to start
    at its lowest vertex id (winding kept), faces sorted by their sorted vertex ids, edges rebuilt from the faces.

    The multithreaded remesh/QuadriFlow emit the same surface in a different vertex/face order from run to run
    (Ruling 16); everything downstream (fold repair, heat weights, AO rays, the glTF export) then runs on a stable
    order, so a rebuild is byte-identical. Distinct vertices at one position (QuadriFlow's two mirrored sheets can
    touch at a spike tip on the seam) are told apart by their sorted neighbour positions; raises if even those tie.
    Returns the vertex count."""
    me = ob.data
    n = len(me.vertices)
    co = np.empty(3 * n, np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    q = np.round(co / quantum).astype(np.int64)
    order = np.lexsort((co[:, 2], co[:, 1], co[:, 0], q[:, 2], q[:, 1], q[:, 0]))
    polys = [tuple(p.vertices) for p in me.polygons]
    runs = []                         # [first, last] positions in `order` of each run of equal positions
    for k in np.nonzero(np.all(co[order][1:] == co[order][:-1], axis=1))[0]:
        if runs and runs[-1][1] == k:
            runs[-1][1] = k + 1
        else:
            runs.append([k, k + 1])
    if runs:
        ring = {}
        for vs in polys:
            for a, b in zip(vs, vs[1:] + vs[:1]):
                ring.setdefault(a, set()).add(b)
                ring.setdefault(b, set()).add(a)
        for first, last in runs:      # re-sort each run by its vertices' sorted 1-ring positions
            run = [int(i) for i in order[first:last + 1]]
            key = {i: tuple(sorted(tuple(co[k]) for k in ring.get(i, ()))) for i in run}
            if len(set(key.values())) < len(run):
                raise RuntimeError(f"{ob.name}: coincident vertices with identical neighbourhoods — no canonical order")
            order[first:last + 1] = sorted(run, key=key.get)
    rank = np.empty(n, np.int64)
    rank[order] = np.arange(n)
    faces = []
    for vs in polys:
        ids = [int(rank[i]) for i in vs]
        k = ids.index(min(ids))
        faces.append(ids[k:] + ids[:k])
    faces.sort(key=sorted)
    me.clear_geometry()
    me.from_pydata(co[order].tolist(), [], faces)
    me.update()
    return n


def _quadriflow_once(ob, request, symmetry, seed):
    select_only(ob)
    ob.data.use_mirror_x = symmetry
    result = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=symmetry, mode="FACES", target_faces=request, seed=seed)
    if result != {"FINISHED"}:
        raise RuntimeError("QuadriFlow refused the mesh — run manifold_voxel_remesh + clean_degenerate first")
    return len(ob.data.polygons)


def surface_deviation(src_points, ob, q=99.0):
    """The q-th percentile distance (metres) from `src_points` (points on the surface QuadriFlow was given) to the
    object's surface: how much of the input shape the remesh lost."""
    bvh = BVHTree.FromPolygons([v.co for v in ob.data.vertices], [p.vertices for p in ob.data.polygons])
    return float(np.percentile([bvh.find_nearest(p)[3] for p in src_points], q))


def crease_fraction(src_bvh, ob, max_angle=35.0):
    """Fraction of the object's vertices whose normal turns more than `max_angle` degrees from the input surface's
    at the nearest point: a narrow crease or crumpled band the distance percentiles barely register."""
    ob.data.update()
    limit = math.radians(max_angle)
    bad = sum(1 for v in ob.data.vertices if v.normal.length > 0 and v.normal.angle(src_bvh.find_nearest(v.co)[1]) > limit)
    return bad / max(1, len(ob.data.vertices))


QUADRIFLOW_JITTER = (1.0, 1.05, 0.95, 1.1, 0.9, 1.15, 0.85, 1.2, 0.8)


def quadriflow(ob, target_faces, symmetry=True, seed=0, tolerance=0.08, max_dev=0.016, max_crease=0.005, tries=10):
    """QuadriFlow remesh to ~target_faces quads, then weld the mirrored halves, canonicalise the order and repair folds.

    QuadriFlow is a chaotic function of its input and request: the look-pass body came out at 14.5k faces for 24k
    requested (the Task 3 body at 22.3k), and at 39.6k requested it came out at 24.8k faces but with the waist
    pinched shut — in symmetric mode it remeshes a half-body whose cut boundary it may drag off the midline, and
    the mirror seam then sinks up to 17 cm somewhere (belly, chin, waist: a different place per request; p99
    input->output distance 23-200 mm, against 4-16 mm for a sound remesh); other draws crease a band of quads (one
    ringed the waist: 0.9 % of the vertices turned > 35 deg from the input's normals, against 0.2-0.3 % on sound
    draws, all at the sculpted eye and mouth edges) or leave folds the repair cannot undo. So each attempt must pass
    four checks: the face count within `tolerance` of target_faces, the p99 distance from the input surface to the
    result within `max_dev`, at most `max_crease` of the vertices creased, and a complete fold repair. The next
    request aims at target_faces through the median output/request ratio seen so far, stepped through
    QUADRIFLOW_JITTER after each shape or fold failure. Deterministic: the same input gives the same requests.
    Returns {"request", "faces", "dev_p99_mm", "crease_pct", "attempts"}."""
    src = ob.data.copy()
    name = ob.data.name
    points = [v.co.copy() for v in src.vertices][::7]
    src_bvh = BVHTree.FromPolygons([v.co for v in src.vertices], [p.vertices for p in src.polygons])
    request, done, log, ratios, misses, tried = target_faces, None, [], [], 0, {target_faces}
    try:
        for attempt in range(tries):
            if attempt:
                spent = ob.data
                ob.data = src.copy()
                bpy.data.meshes.remove(spent)
                ob.data.name = name
            _quadriflow_once(ob, request, symmetry, seed)
            if symmetry:
                # Blender's symmetric mode remeshes one half and mirrors it WITHOUT welding: two islands meeting
                # along X = 0 as open boundaries (seen in Blender 5.1). Weld them into one closed surface.
                weld_mirror_seam(ob)
            got = len(ob.data.polygons)
            ratios.append(got / request)
            dev = surface_deviation(points, ob)
            crease = crease_fraction(src_bvh, ob)
            verdict = "ok"
            if dev > max_dev:
                verdict = "shape lost"
            elif crease > max_crease:
                verdict = "creased"
            elif abs(got - target_faces) > tolerance * target_faces:
                verdict = "count"
            else:
                canonical_order(ob)
                left = unfold(ob, mirror_x=symmetry)
                if left:
                    verdict = f"{left} folds left"
            log.append(f"request {request} -> {got} faces, p99 {dev * 1000:.1f} mm, creased {crease:.2%}: {verdict}")
            print(f"quadriflow attempt {attempt + 1}: {log[-1]}")
            if verdict == "ok":
                done = {"request": request, "faces": got, "dev_p99_mm": round(dev * 1000, 1),
                        "crease_pct": round(100 * crease, 2), "attempts": attempt + 1}
                break
            if verdict != "count":
                misses += 1
            aim = target_faces / float(np.median(ratios))
            while True:
                request = int(round(aim * QUADRIFLOW_JITTER[misses % len(QUADRIFLOW_JITTER)]))
                if request not in tried:
                    break
                misses += 1
            tried.add(request)
    finally:
        bpy.data.meshes.remove(src)
    if done is None:
        raise RuntimeError(f"QuadriFlow found no sound remesh of {ob.name} in {tries} attempts: {log}")
    for p in ob.data.polygons:
        p.use_smooth = True
    return done


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
        "folded_faces": len(folded_faces(bm)),
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
