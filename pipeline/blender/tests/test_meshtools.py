import os, unittest
import bpy
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


if __name__ == "__main__":
    unittest.main()
