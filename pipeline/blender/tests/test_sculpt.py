import unittest
import numpy as np
import anatomy as A
import sculpt as SB


class SculptTests(unittest.TestCase):
    def test_jaw_hinge_is_inside_the_lower_jaw(self):
        self.assertLess(A.JAW[0][2], SB.MOUTH_Z - SB.MOUTH_HALF_H)

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
