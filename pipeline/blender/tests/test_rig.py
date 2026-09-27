import math
import unittest
import scene as SC
import rig as R


class RigTests(unittest.TestCase):
    def setUp(self):
        SC.reset()
        self.rig = R.build_armature()

    def test_armature_has_all_bones(self):
        self.assertEqual(len(self.rig.data.bones), 101)
        self.assertIsNone(self.rig.data.bones["pelvis"].parent)

    def test_fold_brings_the_wing_close_and_reset_restores(self):
        R.fold_wings(self.rig, 1.0)
        wrist = self.rig.pose.bones["wing_forearm_L"].tail
        self.assertLess(abs(wrist.x), 0.8)
        R.reset_pose(self.rig)
        self.assertAlmostEqual(self.rig.pose.bones["wing_forearm_L"].tail.x, self.rig.data.bones["wing_forearm_L"].tail_local.x, places=5)

    def test_jaw_opens_downward(self):
        R.pose_jaw(self.rig, 1.0)
        tip = self.rig.pose.bones["jaw"].tail
        rest = self.rig.data.bones["jaw"].tail_local
        self.assertLess(tip.z, rest.z - 0.05)


if __name__ == "__main__":
    unittest.main()
