import re
import unittest
import numpy as np
import anatomy as A

NAME = re.compile(r"^[a-z]+[a-z0-9_]*(_[LR])?$")
NO_MIRROR = {"pedal_L"}  # single-sided tack bone (the left pedal only)


class AnatomyTests(unittest.TestCase):
    def setUp(self):
        self.specs = A.bone_specs()
        self.by = {b[0]: b for b in self.specs}

    def test_bone_count_and_unique_names(self):
        self.assertEqual(len(self.specs), 101)
        self.assertEqual(len(self.by), 101)

    def test_parents_exist_and_precede(self):
        seen = set()
        for name, head, tail, parent, _ in self.specs:
            if parent is not None:
                self.assertIn(parent, seen, f"{name} parent {parent} must come first")
            seen.add(name)

    def test_names_follow_convention(self):
        for name, *_ in self.specs:
            self.assertRegex(name, NAME)

    def test_left_right_mirror(self):
        for name, head, tail, *_ in self.specs:
            if name.endswith("_L") and name not in NO_MIRROR:
                other = self.by.get(name[:-2] + "_R")
                self.assertIsNotNone(other, name)
                np.testing.assert_allclose(other[1], [-head[0], head[1], head[2]], atol=1e-9)
                np.testing.assert_allclose(other[2], [-tail[0], tail[1], tail[2]], atol=1e-9)
        # the exemption itself must be real: each NO_MIRROR bone exists and genuinely has no _R twin,
        # so a future pedal_R (or a typo'd exemption) can't hide behind this skip.
        for name in NO_MIRROR:
            self.assertIn(name, self.by, name)
            self.assertNotIn(name[:-2] + "_R", self.by, name)

    def test_no_degenerate_bones(self):
        for name, head, tail, *_ in self.specs:
            self.assertGreater(np.linalg.norm(np.asarray(tail) - np.asarray(head)), 0.02, name)

    def test_proportions(self):
        p = A.proportions()
        self.assertTrue(7.1 <= p["length"] <= 7.5, p)
        self.assertTrue(13.1 <= p["wingspan"] <= 13.9, p)        # spec 13.5 m ± 3 %
        self.assertTrue(1.2 <= p["shoulderHeight"] <= 1.4, p)    # withers (top of the shoulder blades), spec ≈ 1.3 m
        self.assertTrue(1.7 <= p["headTop"] <= 1.95, p)

    def test_contacts_on_the_ground_and_limbs_reference_bones(self):
        for leg, c in A.CONTACTS_L.items():
            for k in ("sole", "toe", "heel"):
                self.assertLess(c[k][2], 0.05, (leg, k))
        names = set(self.by)
        for side in ("L", "R"):
            for kind, limb in A.LIMBS.items():
                for b in limb["bones"]:
                    self.assertIn(f"{b}_{side}", names)

    def test_gltf_conversion(self):
        self.assertEqual(tuple(A.blender_to_gltf((1.0, 2.0, 3.0))), (1.0, 3.0, -2.0))

    def test_proxies_and_anchors_reference_bones(self):
        for name, bone, centre, radius in A.PROXIES:
            self.assertIn(bone, self.by, name)
            self.assertGreater(radius, 0.0)
        for key, (bone, pos) in A.ANCHORS.items():
            self.assertIn(bone, self.by, key)

    def test_saddle_footprint_sits_behind_the_wing_roots(self):
        y0, y1 = A.SADDLE_Y
        self.assertTrue(y0 < A.SADDLE_SEAT[1] < y1)
        self.assertGreater(y0, A.MAIN_WING_L["root"][1])
        self.assertLess(A.SADDLE_HALF_WIDTH, A.MAIN_WING_L["attach"][1][0])


if __name__ == "__main__":
    unittest.main()
