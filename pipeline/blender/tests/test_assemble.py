import unittest
import bpy
from mathutils import Vector
import scene as SC
import sculpt as SB
import rig as R
import assemble as AS


class AssembleHelperTests(unittest.TestCase):
    def test_hemisphere_dirs_are_unit_upper_and_cosine_weighted(self):
        dirs = AS.hemisphere_dirs(256)
        self.assertTrue(all(abs(d.length - 1) < 1e-9 and d.z > 0 for d in dirs))
        mean_z = sum(d.z for d in dirs) / len(dirs)
        self.assertAlmostEqual(mean_z, 2 / 3, delta=0.01)   # E[cos θ] for cosine-weighted directions

    def test_smoothstep_handles_reversed_edges(self):
        self.assertEqual(AS.smoothstep(-0.15, -0.65, 0.0), 0.0)
        self.assertEqual(AS.smoothstep(-0.15, -0.65, -1.0), 1.0)
        self.assertAlmostEqual(AS.smoothstep(0.0, 1.0, 0.5), 0.5)

    def test_vertex_ao_darkens_under_an_overhang(self):
        SC.reset()
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=20, y_subdivisions=20, size=4.0)
        ground = bpy.context.active_object
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.3))
        roof = bpy.context.active_object
        roof.scale = (2.0, 2.0, 0.05)
        bpy.ops.object.transform_apply(scale=True)
        ao = AS.vertex_ao(ground, AS.occluder_bvh([ground, roof]), AS.hemisphere_dirs(), dist=0.5)
        verts = ground.data.vertices
        under = [a for v, a in zip(verts, ao) if abs(v.co.x) < 0.2 and abs(v.co.y) < 0.2]
        open_sky = [a for v, a in zip(verts, ao) if abs(v.co.x) > 1.6]
        self.assertLess(max(under), 0.4)
        self.assertGreater(min(open_sky), 0.95)

    def test_heat_canary_flags_a_starved_bone(self):
        """A perfect bind (points along every body bone, each fully weighted to its own bone) passes; a bone that lost
        its whole region, or more than half of it, is named."""
        SC.reset()
        rig = R.build_armature()
        bones = AS.body_bones(rig)
        verts, owner = [], []
        for name in bones:
            b = rig.data.bones[name]
            n = 520 if name == "jaw" else 30
            for k in range(n):
                verts.append(tuple(b.head_local.lerp(b.tail_local, (k + 0.5) / n)))
                owner.append(name)
        me = bpy.data.meshes.new("body")
        me.from_pydata(verts, [], [])
        body = bpy.data.objects.new("body", me)
        bpy.context.scene.collection.objects.link(body)

        def bind(keep):
            for g in list(body.vertex_groups):
                body.vertex_groups.remove(g)
            groups = {name: body.vertex_groups.new(name=name) for name in bones}
            seen = {}
            for i, name in enumerate(owner):
                seen[name] = seen.get(name, 0) + 1
                if seen[name] <= keep.get(name, len(verts)):
                    groups[name].add([i], 1.0, "REPLACE")

        bind({})
        coverage = AS.check_heat_weights(body, rig)
        self.assertEqual(coverage["front_radius_L"], (30, 30))
        bind({"front_radius_L": 0})
        with self.assertRaisesRegex(RuntimeError, "front_radius_L 0/30"):
            AS.check_heat_weights(body, rig)
        bind({"tail_07": 14})                        # 14/30 < half its region
        with self.assertRaisesRegex(RuntimeError, "tail_07 14/30"):
            AS.check_heat_weights(body, rig)
        bind({"tail_07": 16})
        AS.check_heat_weights(body, rig)

    def test_seal_lips_hands_the_lower_lip_to_the_jaw_and_the_upper_to_the_head(self):
        """Around the lips the jaw's weight becomes the sculpt's opening weight: 1 on the lower lip (it closes with the
        full rest rotation), 0 on the upper; far from the mouth nothing changes."""
        import anatomy as A
        SC.reset()
        front = SB.MOUTH_LINE_L[0]
        h = SB.slit_opening(front[1])
        pts = [(0.0, front[1] + 0.01, SB.MOUTH_Z + 0.01),        # upper lip
               (0.0, front[1] + 0.01, SB.MOUTH_Z - h - 0.01),    # lower lip (the bind slit's floor is h down)
               (0.3, 0.0, 1.0)]                                  # the flank
        me = bpy.data.meshes.new("body")
        me.from_pydata(pts, [], [])
        body = bpy.data.objects.new("body", me)
        bpy.context.scene.collection.objects.link(body)
        for name in ("jaw", "head", "spine_02"):
            body.vertex_groups.new(name=name)
        body.vertex_groups["jaw"].add([0, 1], 0.5, "REPLACE")
        body.vertex_groups["head"].add([0, 1], 0.5, "REPLACE")
        body.vertex_groups["spine_02"].add([2], 1.0, "REPLACE")
        self.assertEqual(AS.seal_lips(body), 2)
        w = lambda i, g: body.vertex_groups[g].weight(i)
        self.assertAlmostEqual(w(0, "jaw"), 0.0, places=3)
        self.assertAlmostEqual(w(0, "head"), 1.0, places=3)
        self.assertAlmostEqual(w(1, "jaw"), 1.0, places=3)
        self.assertAlmostEqual(w(1, "head"), 0.0, places=3)
        self.assertAlmostEqual(w(2, "spine_02"), 1.0, places=6)
        self.assertGreater(A.JAW_REST_CLOSE_RAD, 0.0)

    def test_dorsal_weight_marks_spike_bases_only(self):
        spikes = SB.dorsal_spikes()
        base = Vector(spikes[10][0])
        self.assertEqual(AS.dorsal_weight(base + Vector((0, 0, 0.01)), spikes), 1.0)
        self.assertEqual(AS.dorsal_weight(base + Vector((0.3, 0, 0)), spikes), 0.0)


if __name__ == "__main__":
    unittest.main()
