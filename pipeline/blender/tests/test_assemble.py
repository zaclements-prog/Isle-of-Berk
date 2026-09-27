import unittest
import bpy
from mathutils import Vector
import scene as SC
import sculpt as SB
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

    def test_dorsal_weight_marks_spike_bases_only(self):
        spikes = SB.dorsal_spikes()
        base = Vector(spikes[10][0])
        self.assertEqual(AS.dorsal_weight(base + Vector((0, 0, 0.01)), spikes), 1.0)
        self.assertEqual(AS.dorsal_weight(base + Vector((0.3, 0, 0)), spikes), 0.0)


if __name__ == "__main__":
    unittest.main()
