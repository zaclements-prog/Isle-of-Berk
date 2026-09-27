import unittest
import numpy as np
import berk_sdf as S


class SdfTests(unittest.TestCase):
    def test_sphere_distance(self):
        p = S.sphere((0, 0, 0), 1.0)
        np.testing.assert_allclose(p.fn(np.array([[2, 0, 0], [0, 0, 0], [0, 1, 0]], float)), [1.0, -1.0, 0.0], atol=1e-9)

    def test_ellipsoid_sign(self):
        d = S.ellipsoid((0, 0, 0), (1.0, 0.5, 0.25)).fn(np.array([[0, 0, 0], [0.9, 0, 0], [1.1, 0, 0], [0, 0.6, 0]], float))
        self.assertLess(d[0], 0); self.assertLess(d[1], 0); self.assertGreater(d[2], 0); self.assertGreater(d[3], 0)

    def test_round_cone_endpoints(self):
        d = S.round_cone((0, 0, 0), (1, 0, 0), 0.3, 0.1).fn(np.array([[-0.3, 0, 0], [1.1, 0, 0], [0.5, 0, 0]], float))
        np.testing.assert_allclose(d[:2], [0.0, 0.0], atol=1e-6)
        self.assertLess(d[2], 0)

    def test_tube_has_no_joint_bulge(self):
        t = S.tube([(0, 0, 0), (1, 0, 0), (2, 0, 0)], [0.2, 0.2, 0.2])
        np.testing.assert_allclose(t.fn(np.array([[1, 0.2, 0]], float)), [0.0], atol=1e-6)

    def test_smin_is_symmetric_and_below_min(self):
        a = np.array([0.1, -0.2, 0.5]); b = np.array([0.3, 0.0, 0.45])
        s1 = S.smin(a, b, 0.1); s2 = S.smin(b, a, 0.1)
        np.testing.assert_allclose(s1, s2, atol=1e-12)
        self.assertTrue(np.all(s1 <= np.minimum(a, b) + 1e-12))

    def test_polygon_slab_inside_outside(self):
        p = S.polygon_slab([[-1, -1], [1, -1], [1, 1], [-1, 1]], 0.0, 0.1)
        d = p.fn(np.array([[0, 0, 0], [0, 0, 0.2], [2, 0, 0], [0.5, 0.5, 0.05]], float))
        self.assertLess(d[0], 0); self.assertGreater(d[2], 0); self.assertLess(d[3], 0)
        np.testing.assert_allclose(d[1], 0.1, atol=1e-9)

    def test_squashed_flattens_an_axis(self):
        f = S.squashed(S.sphere((0, 0, 0), 1.0), (0, 0, 0), (1, 1, 0.5))
        d = f.fn(np.array([[0, 0, 0.6], [0.9, 0, 0]], float))
        self.assertGreater(d[0], 0); self.assertLess(d[1], 0)


if __name__ == "__main__":
    unittest.main()
