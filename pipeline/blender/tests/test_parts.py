import unittest
from mathutils import Vector
import meshtools as MT
import scene as SC
import parts as P


class SphereTests(unittest.TestCase):
    def test_uv_sphere_is_closed_with_outward_normals(self):
        SC.reset()
        c = Vector((0.3, -1.2, 0.8))
        ob = P._uv_sphere("S", 0.5, 24, 12, c)
        rep = MT.mesh_report(ob)
        self.assertEqual((rep["verts"], rep["faces"], rep["boundary_edges"], rep["nonmanifold_edges"], rep["islands"]),
                         (24 * 11 + 2, 24 * 12, 0, 0, 1))
        for v in ob.data.vertices:
            self.assertAlmostEqual((v.co - c).length, 0.5, places=5)
        for p in ob.data.polygons:
            self.assertGreater(p.normal.dot((p.center - c).normalized()), 0.9)


if __name__ == "__main__":
    unittest.main()
