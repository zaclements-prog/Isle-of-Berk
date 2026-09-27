import math
import unittest
import bpy
from mathutils import Vector
import anatomy as A
import meshtools as MT
import scene as SC
import rig as R
import parts as P


def piecewise(w):
    """Blink weight w in [0, 1] -> weights of (key_a at 1/3, key_b at 2/3, key_full)."""
    if w <= 1 / 3:
        return (3 * w, 0.0, 0.0)
    if w <= 2 / 3:
        return (2 - 3 * w, 3 * w - 1, 0.0)
    return (0.0, 3 - 3 * w, 3 * w - 2)


class LidTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SC.reset()
        cls.rig = R.build_armature()
        mat = bpy.data.materials.new("skin")
        cls.lids = P.make_lids(cls.rig, mat)

    def test_blink_path_never_cuts_deeper_than_rest(self):
        for lid in self.lids:
            side = 1 if lid.name.endswith("_L") else -1
            c = Vector((A.EYE_CENTER_L[0] * side, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2]))
            kb = lid.data.shape_keys.key_blocks
            sfx = "L" if side > 0 else "R"
            basis, ka, kb_, kf = kb["Basis"], kb[f"blink_{sfx}_a"], kb[f"blink_{sfx}_b"], kb[f"blink_{sfx}"]
            rest_min = min((v.co - c).length for v in basis.data)
            for step in range(21):
                wa, wb, wf = piecewise(step / 20)
                worst = min(((basis.data[i].co + wa * (ka.data[i].co - basis.data[i].co) + wb * (kb_.data[i].co - basis.data[i].co)
                              + wf * (kf.data[i].co - basis.data[i].co)) - c).length for i in range(len(basis.data)))
                self.assertGreaterEqual(worst, rest_min - 0.001, (lid.name, step))

    def test_piecewise_weights_are_continuous_and_normalised(self):
        prev = piecewise(0.0)
        for step in range(1, 301):
            cur = piecewise(step / 300)
            self.assertLessEqual(max(abs(a - b) for a, b in zip(cur, prev)), 0.011)
            self.assertLessEqual(sum(cur), 1.0 + 1e-9)
            prev = cur
        self.assertEqual(piecewise(1.0), (0.0, 0.0, 1.0))

    def test_rest_lids_leave_the_iris_open(self):
        """Seen along the gaze, down the iris's vertical midline, the rest upper lid covers <= 15 % of the iris height
        and the lower lid <= 8 % (the eye shader's iris spans +-0.96 of the eye radius)."""
        iris = 0.96 * A.EYE_RADIUS
        for lid in self.lids:
            side = 1 if lid.name.endswith("_L") else -1
            c = Vector((A.EYE_CENTER_L[0] * side, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2]))
            n, up, r = P.eye_frame(side)
            front = [v.co - c for v in lid.data.vertices
                     if (v.co - c).normalized().dot(n) > 0.0 and abs((v.co - c).dot(r)) < 0.1 * A.EYE_RADIUS]
            if lid.name.startswith("LidU"):
                edge = min(p.dot(up) for p in front)
                self.assertLessEqual((iris - edge) / (2 * iris), 0.15, lid.name)
            else:
                edge = max(p.dot(up) for p in front)
                self.assertLessEqual((iris + edge) / (2 * iris), 0.08, lid.name)

    def test_closed_lids_meet(self):
        """At full blink the two lids of an eye overlap along the gaze (no slit of eye between them)."""
        for sfx, side in (("L", 1), ("R", -1)):
            c = Vector((A.EYE_CENTER_L[0] * side, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2]))
            n, up, _ = P.eye_frame(side)
            upper = next(l for l in self.lids if l.name == f"LidU_{sfx}").data.shape_keys.key_blocks[f"blink_{sfx}"]
            lower = next(l for l in self.lids if l.name == f"LidD_{sfx}").data.shape_keys.key_blocks[f"blink_{sfx}"]
            front = lambda kb: [d.co - c for d in kb.data if (d.co - c).normalized().dot(n) > 0.3]
            upper_low = min(p.dot(up) for p in front(upper))
            lower_high = max(p.dot(up) for p in front(lower))
            self.assertLess(upper_low, lower_high - 0.005, sfx)


class TeethTests(unittest.TestCase):
    def test_teeth_are_buried_at_rest(self):
        """With the mouth closed every tooth cone lies inside the closed head (he is Toothless)."""
        import sculpt as SB
        for upper, base, size in P.teeth_layout():
            depth = SB._head_field(P.tooth_points(upper, base, size)).max()
            self.assertLessEqual(depth, -P.TOOTH_BURY, (upper, tuple(base), size))

    def test_rows_interleave_and_never_touch_when_out(self):
        """Teeth out with the jaw closed: the two rows' tips pass each other, so over the band where an upper and a
        lower cone overlap in height their radii sum to 0.28 x the tip overlap; every upper/lower pair stands further
        apart than that. The lower row is also offset half a spacing along the U from the upper."""
        layout = P.teeth_layout()
        ups = [(b, s) for u, b, s in layout if u]
        lows = [(b, s) for u, b, s in layout if not u]
        self.assertEqual(len(lows), len(ups) - 1)
        for bl, sl in lows:
            for bu, su in ups:
                overlap = P.tooth_travel(su) + P.tooth_travel(sl) - 0.01
                reach = 0.45 / 1.6 * overlap
                self.assertGreater((bl - bu).length, reach + 0.002, (tuple(bl), tuple(bu)))


class SphereTests(unittest.TestCase):
    def test_uv_sphere_is_closed_with_outward_normals(self):
        SC.reset()
        c = Vector((0.3, -1.2, 0.8))
        ob = P._uv_sphere("S", 0.5, 24, 12, c)
        rep = MT.mesh_report(ob)
        self.assertEqual((rep["verts"], rep["faces"], rep["boundary_edges"], rep["nonmanifold_edges"], rep["islands"]),
                         (24 * 11 + 2, 24 * 12, 0, 0, 1))
        for v in ob.data.vertices:
            self.assertAlmostEqual((v.co - c).length, 0.5, places=5)
        for p in ob.data.polygons:
            self.assertGreater(p.normal.dot((p.center - c).normalized()), 0.9)


if __name__ == "__main__":
    unittest.main()
