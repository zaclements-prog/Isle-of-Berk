import unittest
import bpy
from mathutils.bvhtree import BVHTree
import scene as SC
import rig as R
import tack as T

PARTS = ["Saddle", "SaddlePommel", "SaddleCantle", "GirthFront", "GirthRear", "StirrupStrap", "Pedal", "FinCable", "FinClamp"]


class TackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SC.reset()
        cls.rig = R.build_armature()
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, location=(0, -0.2, 1.0))
        cls.body = bpy.context.active_object
        cls.body.name = "Toothless"
        cls.body.scale = (0.5, 1.6, 0.45)
        bpy.ops.object.transform_apply(scale=True)
        M = {n: bpy.data.materials.new(n) for n in ("leather", "metal")}
        cls.objs = {o.name: o for o in T.build_all(cls.rig, cls.body, M)}

    def test_builds_every_part(self):
        self.assertEqual(sorted(self.objs), sorted(PARTS))

    def test_every_vertex_is_weighted_to_existing_bones(self):
        bones = set(self.rig.data.bones.keys())
        for ob in self.objs.values():
            self.assertTrue(ob.vertex_groups, ob.name)
            for g in ob.vertex_groups:
                self.assertIn(g.name, bones, (ob.name, g.name))
            self.assertTrue(all(v.groups for v in ob.data.vertices), ob.name)

    def test_saddle_seat_hugs_the_body(self):
        dg = bpy.context.evaluated_depsgraph_get()
        bvh = BVHTree.FromObject(self.body.evaluated_get(dg), dg)
        worst = max(bvh.find_nearest(v.co)[3] for v in self.objs["Saddle"].data.vertices)
        self.assertLess(worst, 0.05)

    def test_tail_weight_is_continuous_and_normalised(self):
        ys = [0.6 + i * 0.002 for i in range(2000)]
        for a, b in zip(ys, ys[1:]):
            wa, wb = T.tail_weight(a), T.tail_weight(b)
            self.assertAlmostEqual(sum(wa.values()), 1.0, places=9)
            for k in set(wa) | set(wb):
                self.assertLess(abs(wa.get(k, 0.0) - wb.get(k, 0.0)), 0.02, (a, k))

    def test_spine_weight_is_normalised(self):
        for i in range(200):
            y = -1.0 + i * 0.01
            self.assertAlmostEqual(sum(T.spine_weight(y).values()), 1.0, places=9)


if __name__ == "__main__":
    unittest.main()
