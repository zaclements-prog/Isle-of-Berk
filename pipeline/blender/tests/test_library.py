import math
import os
import unittest
import bpy
from mathutils import Vector
import anatomy as A
import library as LIB
import rig as R
import scene as SC

BUILD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build", "toothless_assembled.blend")
LIMITS = {f"{n}_{s}": v for s in "LR" for limb in A.LIMBS.values() for n, v in limb["limits"].items()}
CHAIN = {**{n: A.CHAIN_LIMITS["spine"] for n in ("spine_01", "spine_02", "spine_03", "chest")},
         **{n: A.CHAIN_LIMITS["neck"] for n in ("neck_01", "neck_02", "neck_03", "neck_04", "head")},
         **{f"tail_{i:02d}": A.CHAIN_LIMITS["tail"] for i in range(1, 13)}}
SYMMETRIC = ("sit", "lie", "stretch", "sniff", "stalk", "jump_crouch", "jump_launch", "jump_tuck", "jump_land",
             "plasma_rear", "climb_reach", "scramble_hook")
GROUNDED = ("sit", "lie", "sleep", "stretch")
BODY_PROXIES = ("head", "muzzle", "neck", "chest", "belly", "hips")
FACE_CHANNELS = {"jaw", "blink", "squint", "smile", "snarl", "teeth_out", "nostril_flare", "pupil", "ears", "plasmaGlow"}


class LibraryDataTests(unittest.TestCase):
    def test_every_frame_stays_inside_the_joint_and_chain_limits(self):
        for name in LIB.LIBRARY:
            for f, pose in enumerate(LIB.frames_of(name)):
                for bone, (x, y, z) in pose["bones"].items():
                    if bone in LIMITS:
                        lo, hi = LIMITS[bone]
                        self.assertTrue(lo - 0.5 <= math.degrees(x) <= hi + 0.5, (name, f, bone, math.degrees(x)))
                    if bone in CHAIN:
                        lim = CHAIN[bone]
                        for v, axis in ((x, "pitch"), (y, "roll"), (z, "yaw")):
                            self.assertLessEqual(abs(math.degrees(v)), lim[axis] + 0.5, (name, f, bone, axis))

    def test_symmetric_poses_mirror_left_and_right(self):
        for name in SYMMETRIC:
            bones = LIB.POSES[name]["bones"]
            for bone, (x, y, z) in bones.items():
                if bone.startswith(("front_", "hind_")) and bone.endswith("_L"):
                    rx, ry, rz = bones.get(bone[:-2] + "_R", (0.0, 0.0, 0.0))
                    for a, b in ((x, rx), (-y, ry), (-z, rz)):
                        self.assertAlmostEqual(a, b, places=3, msg=(name, bone))

    def test_clips_have_their_lengths_and_the_loop_closes(self):
        lengths = {"scratch": 29, "shake": 37, "yawn": 73, "scramble_up": 28}
        for name, n in lengths.items():
            self.assertEqual(len(LIB.frames_of(name)), n, name)
        scratch = LIB.frames_of("scratch")
        first, last = scratch[LIB.SCRATCH_LOOP_START]["bones"], scratch[-1]["bones"]
        for bone, e in LIB.POSES["sit"]["bones"].items():         # the intro starts from the sit beneath it
            for a, b in zip(e, scratch[0]["bones"][bone]):
                self.assertAlmostEqual(a, b, places=9, msg=bone)
        for bone, e in first.items():
            for a, b in zip(e, last[bone]):
                self.assertAlmostEqual(a, b, places=9, msg=bone)
        for name in LIB.LIBRARY:
            if name not in lengths:
                self.assertEqual(len(LIB.frames_of(name)), 1, name)

    def test_metadata_is_explicit_and_complete(self):
        self.assertEqual(set(LIB.META), set(LIB.LIBRARY))
        for name, m in LIB.META.items():
            self.assertTrue(m["mask"] and all(isinstance(p, str) and p for p in m["mask"]), name)
            self.assertNotIn("pelvis", m["mask"], name)          # the body solver owns the root bone
            self.assertTrue(set(m["ownsLegs"]) <= set(LIB.LEG_KEYS), name)
            self.assertIn(m["interrupt"], ("exit", "finish", "none"), name)
            self.assertGreater(m["blendIn"], 0, name)
            self.assertGreater(m["blendOut"], 0, name)
            for channel, curve in m.get("face", {}).items():
                self.assertIn(channel, FACE_CHANNELS, (name, channel))
                times = [k[0] for k in curve]
                self.assertEqual(times, sorted(times), (name, channel))
            for leg in m["ownsLegs"]:                             # an owned leg is wholly inside the mask
                kind, side = leg.split("_")
                for bone in A.LIMBS[kind]["bones"]:
                    self.assertTrue(any(f"{bone}_{side}".startswith(p) for p in m["mask"]), (name, leg, bone))


@unittest.skipUnless(os.path.exists(BUILD), "needs the assemble stage's toothless_assembled.blend")
class LibraryPoseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bpy.ops.wm.open_mainfile(filepath=BUILD)
        cls.rig = bpy.data.objects["ToothlessRig"]
        cls.body = bpy.data.objects["Toothless"]
        names = [g.name for g in cls.body.vertex_groups]
        skip = ("wing_", "hipwing_", "tailfin_")
        cls.solid = [v.index for v in cls.body.data.vertices
                     if v.groups and not names[max(v.groups, key=lambda g: g.weight).group].startswith(skip)]

    @classmethod
    def tearDownClass(cls):
        SC.reset()

    def lowest(self):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.body.evaluated_get(dg)
        me = ev.to_mesh()
        z = min((self.body.matrix_world @ me.vertices[i].co).z for i in self.solid)
        ev.to_mesh_clear()
        return z

    def proxy_low(self, name):
        _, bone, center, radius = next(p for p in A.PROXIES if p[0] == name)
        b = self.rig.data.bones[bone]
        pb = self.rig.pose.bones[bone]
        return (pb.matrix @ (b.matrix_local.inverted() @ Vector(center))).z - radius

    def test_grounded_poses_rest_on_the_ground_without_sinking(self):
        for name in GROUNDED:
            LIB.apply_pose(self.rig, LIB.frames_of(name)[0])
            self.assertGreater(self.lowest(), -0.035, name)       # skin pressed into the ground, not buried
            self.assertLess(self.lowest(), 0.03, name)            # ...and not hovering

    def test_owned_paws_never_dip_below_the_ground_during_clips(self):
        for name in ("scratch",):
            for f, pose in enumerate(LIB.frames_of(name)):
                LIB.apply_pose(self.rig, pose)
                for key in LIB.META[name]["ownsLegs"]:
                    self.assertGreater(LIB.sole_world(self.rig, key).z, -0.02, (name, f, key))

    def test_owned_grounded_paws_touch_the_ground(self):
        for name in GROUNDED:
            LIB.apply_pose(self.rig, LIB.frames_of(name)[0])
            for key in LIB.META[name]["ownsLegs"]:
                z = LIB.sole_world(self.rig, key).z
                if z < 0.1:
                    self.assertTrue(-0.02 <= z <= 0.05, (name, key, z))

    def test_body_proxies_stay_above_the_ground(self):
        for name in LIB.LIBRARY:
            for pose in LIB.frames_of(name)[:: max(1, len(LIB.frames_of(name)) // 4)]:
                LIB.apply_pose(self.rig, pose)
                for proxy in BODY_PROXIES:
                    self.assertGreater(self.proxy_low(proxy), -0.03, (name, proxy))

    def test_meta_entries_carry_root_wings_and_soles(self):
        entries = LIB.meta_entries(self.rig)
        self.assertAlmostEqual(entries["sit"]["root"]["height"], LIB.POSES["sit"]["root"][0])
        self.assertEqual(sorted(entries["sit"]["soles"]), ["hind_L", "hind_R"])
        self.assertEqual(sorted(entries["lie"]["soles"]), sorted(LIB.LEG_KEYS))
        self.assertTrue(entries["scratch"]["loop"])
        self.assertAlmostEqual(entries["yawn"]["duration"], 2.4, places=4)
        self.assertNotIn("root", entries["scramble_up"])
        for key, (x, y, z) in entries["lie"]["soles"].items():
            self.assertTrue(-0.02 <= y <= 0.05, key)              # glTF +Y up: on the ground
        import export as EX
        pj = EX.poses_json(self.rig)
        self.assertEqual(pj["version"], 2)
        self.assertEqual(pj["wingFlare"], {"deg": LIB.FLARE_DEG, "liftDeg": LIB.FLARE_LIFT_DEG})
        self.assertIn("wings_folded", pj["clips"])                # Plan 2's masks stay
        self.assertEqual(pj["clips"]["sleep"]["face"]["blink"], [[0, 1]])   # posture layers hold time 0
        R.reset_pose(self.rig)


if __name__ == "__main__":
    unittest.main()
