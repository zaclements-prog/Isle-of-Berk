import unittest
import numpy as np
import anatomy as A
import sculpt as SB


class SculptTests(unittest.TestCase):
    def test_jaw_hinge_is_inside_the_lower_jaw(self):
        """The hinge sits in solid head behind and below the mouth slit (heat weighting fails with it in the gap)."""
        hinge = np.asarray(A.JAW[0], float)[None]
        self.assertLess(float(SB._head_field(hinge)[0]), -0.02)
        self.assertGreater(float(SB.mouth_slit().fn(hinge)[0]), 0.01)
        self.assertLess(A.JAW[0][2], SB.MOUTH_Z)

    def test_rest_close_shuts_the_slit_along_the_lip_line(self):
        """At bind the slit is a wedge the jaw's rest close (anatomy.JAW_REST_CLOSE_RAD) seals: a point on the bind
        slit's floor, carried shut, lands on the lip plane; the slit is >= 1.6 cm at the lip corners."""
        for p in SB.MOUTH_LINE_L:
            h = SB.slit_opening(p[1])
            floor = np.array([float(p[0]) * 0.5, float(p[1]), SB.MOUTH_Z - h])
            self.assertAlmostEqual(float(SB.close_jaw(floor)[2]), SB.MOUTH_Z, delta=0.002)
        self.assertGreaterEqual(SB.slit_opening(SB.MOUTH_LINE_L[-1][1]), 0.0155)

    def test_mouth_polygon_is_symmetric_and_closed_behind_the_corners(self):
        poly = np.array(SB.mouth_polygon())
        self.assertAlmostEqual(float(poly[:, 0].sum()), 0.0, places=9)
        self.assertGreater(poly[:, 1].max(), SB.MOUTH_LINE_L[-1][1])

    def test_no_dorsal_spikes_under_the_saddle(self):
        y0, y1 = A.SADDLE_Y
        spikes = SB.dorsal_spikes()
        self.assertEqual(len(spikes), 28)
        for base, tip, radius in spikes:
            self.assertFalse(y0 - 0.02 <= base[1] <= y1 + 0.02, base)
            self.assertGreater(tip[2], base[2])
            self.assertGreater(radius, 0.0)


if __name__ == "__main__":
    unittest.main()
