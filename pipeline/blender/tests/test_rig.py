import math
import unittest
import bpy
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

    def test_fold_path_is_piecewise_slerp_safe(self):
        """Exported fold samples (0, 0.25, 0.5, 0.75, 1.0) are blended in-engine with per-bone quaternion
        slerp, which always takes the shortest path. No consecutive pair of samples may be anywhere near a
        180 degree rotation on any wing bone, or the blend would flip direction (see Controller Ruling 13)."""
        rig = self.rig
        amounts = (0.0, 0.25, 0.5, 0.75, 1.0)
        samples = []
        for amount in amounts:
            R.reset_pose(rig)
            if amount > 0.0:
                R.fold_wings(rig, amount)
            bpy.context.view_layer.update()
            samples.append({
                pb.name: pb.matrix_basis.to_quaternion()
                for pb in rig.pose.bones
                if pb.name.startswith("wing_") or pb.name.startswith("hipwing_")
            })
        max_angle = 0.0
        for i in range(len(amounts) - 1):
            a1, a2 = amounts[i], amounts[i + 1]
            for bone, q1 in samples[i].items():
                q2 = samples[i + 1][bone]
                angle = math.degrees(2 * math.acos(min(1.0, abs(q1.dot(q2)))))
                max_angle = max(max_angle, angle)
                self.assertLess(angle, 120, f"{bone} rotates {angle:.1f} deg between amount {a1} and {a2} (slerp would flip direction)")
        self.assertGreater(max_angle, 20, "fold_wings should move some wing bone by more than 20 deg between consecutive samples")
        R.reset_pose(rig)


if __name__ == "__main__":
    unittest.main()
