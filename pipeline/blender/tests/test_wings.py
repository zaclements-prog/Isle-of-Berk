import unittest
import bpy
import scene as SC
import rig as R
import wings as W


class WingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SC.reset()
        cls.rig = R.build_armature()
        M = {n: bpy.data.materials.new(n) for n in ("skin", "membrane", "claw", "prosthetic", "metal")}
        cls.objs = {o.name: o for o in W.build_all(cls.rig, M)}

    def test_builds_six_named_parts(self):
        self.assertEqual(sorted(self.objs), sorted(["Wing_L", "Wing_R", "hipwing_L", "hipwing_R", "tailfin_L", "tailfin_R"]))

    def test_every_vertex_is_weighted_to_existing_bones(self):
        bones = set(self.rig.data.bones.keys())
        for ob in self.objs.values():
            for g in ob.vertex_groups:
                self.assertIn(g.name, bones, (ob.name, g.name))
            self.assertTrue(all(v.groups for v in ob.data.vertices), ob.name)

    def test_main_wings_carry_the_pleat_key(self):
        for sfx in ("L", "R"):
            keys = self.objs[f"Wing_{sfx}"].data.shape_keys.key_blocks
            basis, pleat = keys["Basis"], keys[f"membrane_pleat_{sfx}"]
            moved = max((pleat.data[i].co - basis.data[i].co).length for i in range(len(basis.data)))
            self.assertTrue(0.02 < moved < 0.06, moved)

    def test_prosthetic_fin_is_left_only(self):
        self.assertIn("prosthetic", [m.name for m in self.objs["tailfin_L"].data.materials])
        self.assertNotIn("prosthetic", [m.name for m in self.objs["tailfin_R"].data.materials])

    def test_spread_wingspan(self):
        xs = [abs(v.co.x) for o in (self.objs["Wing_L"], self.objs["Wing_R"]) for v in o.data.vertices]
        self.assertTrue(6.5 <= max(xs) <= 7.1, max(xs))

    def test_folded_wings_tuck_against_the_body(self):
        m = W.fold_metrics(self.rig, [self.objs["Wing_L"], self.objs["Wing_R"]], 1.0)
        self.assertLessEqual(m["max_abs_x"], 0.85, m)
        self.assertGreaterEqual(m["min_z"], 0.8, m)   # no membrane skirt hanging below the flank
        self.assertLessEqual(m["max_y"], 2.4, m)

    def test_folded_hip_wings_stay_close(self):
        m = W.fold_metrics(self.rig, [self.objs["hipwing_L"], self.objs["hipwing_R"]], 1.0)
        self.assertLessEqual(m["max_abs_x"], 0.6, m)


if __name__ == "__main__":
    unittest.main()
