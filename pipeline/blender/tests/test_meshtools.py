import os, unittest
import bpy
import bmesh
import berk_sdf as S
import meshtools as MT
import scene as SC


class MeshToolsTests(unittest.TestCase):
    def setUp(self):
        SC.reset()

    def test_report_on_cube(self):
        bpy.ops.mesh.primitive_cube_add()
        rep = MT.mesh_report(bpy.context.active_object)
        self.assertEqual((rep["verts"], rep["faces"], rep["tris"], rep["islands"]), (8, 6, 12, 1))
        self.assertEqual((rep["boundary_edges"], rep["nonmanifold_edges"]), (0, 0))

    def test_sculpt_remesh_quadriflow_symmetric(self):
        sc = S.Sculpt((-0.6, -0.6, -0.6), (0.6, 0.6, 0.6), 0.02)
        sc.add(S.ellipsoid((0, 0, 0), (0.5, 0.3, 0.25)))
        ob = sc.to_mesh("Ell", os.path.join(bpy.app.tempdir, "ell.vdb"))
        MT.manifold_voxel_remesh(ob, 0.02)
        MT.clean_degenerate(ob)
        rep = MT.mesh_report(ob)
        self.assertEqual((rep["boundary_edges"], rep["nonmanifold_edges"], rep["islands"], rep["short_edges"]), (0, 0, 1, 0))
        MT.quadriflow(ob, 2000)
        self.assertTrue(1500 <= len(ob.data.polygons) <= 2600, len(ob.data.polygons))
        self.assertLess(MT.symmetry_error(ob), 0.01)
        rep = MT.mesh_report(ob)   # the mirrored halves must come back welded into one closed surface
        self.assertEqual((rep["boundary_edges"], rep["nonmanifold_edges"], rep["islands"]), (0, 0, 1))
        self.assertEqual(rep["folded_faces"], 0)

    def test_canonical_order_is_independent_of_the_input_order(self):
        """Two copies of one surface, stored in different vertex/face/loop orders, come out identical."""
        import random
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3)
        a = bpy.context.active_object
        b = a.copy()
        b.data = a.data.copy()
        bpy.context.scene.collection.objects.link(b)
        bm = bmesh.new()
        bm.from_mesh(b.data)
        rng = random.Random(7)
        vkey = {v: rng.random() for v in bm.verts}
        bm.verts.sort(key=lambda v: vkey[v])
        faces = [list(f.verts) for f in bm.faces]      # re-create every face in a shuffled order, loop start rotated
        bmesh.ops.delete(bm, geom=bm.faces[:], context="FACES_ONLY")
        rng.shuffle(faces)
        for vs in faces:
            k = rng.randrange(len(vs))
            bm.faces.new(vs[k:] + vs[:k])
        bm.to_mesh(b.data)
        bm.free()
        self.assertNotEqual([tuple(p.vertices) for p in a.data.polygons], [tuple(p.vertices) for p in b.data.polygons])
        for ob in (a, b):
            MT.canonical_order(ob)
        self.assertEqual([tuple(v.co) for v in a.data.vertices], [tuple(v.co) for v in b.data.vertices])
        self.assertEqual([tuple(p.vertices) for p in a.data.polygons], [tuple(p.vertices) for p in b.data.polygons])
        rep = MT.mesh_report(a)
        self.assertEqual((rep["verts"], rep["faces"], rep["boundary_edges"], rep["folded_faces"]), (162, 320, 0, 0))

    def test_canonical_order_separates_coincident_vertices_by_their_neighbours(self):
        """Two closed pyramids touching apex to apex through two distinct vertices at one position (as QuadriFlow's
        mirrored sheets do at a spike tip): both input orders of the apexes give the same canonical mesh."""
        base = lambda z: [(-1, -1, z), (1, -1, z), (1, 1, z), (-1, 1, z)]

        def pyramids(apex_first):
            verts = base(-1.0) + base(1.0) + [(0, 0, 0), (0, 0, 0)]
            lo, hi = (8, 9) if apex_first else (9, 8)       # which apex index serves the lower pyramid
            faces = [(0, 3, 2, 1), (4, 5, 6, 7)]
            faces += [(i, (i + 1) % 4, lo) for i in range(4)] + [(4 + (i + 1) % 4, 4 + i, hi) for i in range(4)]
            me = bpy.data.meshes.new("pyr")
            me.from_pydata(verts, [], faces)
            ob = bpy.data.objects.new("pyr", me)
            bpy.context.scene.collection.objects.link(ob)
            return ob

        a, b = pyramids(True), pyramids(False)
        for ob in (a, b):
            MT.canonical_order(ob)
        self.assertEqual([tuple(p.vertices) for p in a.data.polygons], [tuple(p.vertices) for p in b.data.polygons])
        self.assertEqual([tuple(v.co) for v in a.data.vertices], [tuple(v.co) for v in b.data.vertices])

    def test_folded_faces_detects_a_flipped_face(self):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8)
        ob = bpy.context.active_object
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.faces.ensure_lookup_table()
        self.assertEqual(MT.folded_faces(bm), [])
        flipped = bm.faces[len(bm.faces) // 2]
        bmesh.ops.reverse_faces(bm, faces=[flipped])
        self.assertEqual(MT.folded_faces(bm), [flipped])
        bm.free()


if __name__ == "__main__":
    unittest.main()
