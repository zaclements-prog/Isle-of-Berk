"""Pose clips: every bone keyed on frames 1-2 (so the glTF exporter keeps full tracks), one NLA track per clip."""
import bpy
import library as LIB
import rig as R

CLIPS = {   # fold samples 0 / .25 / .5 / .75 / 1: the engine blends piecewise between neighbours (Ruling 13)
    "bind": lambda rig: None,
    "wings_fold_25": lambda rig: R.fold_wings(rig, 0.25),
    "wings_half": lambda rig: R.fold_wings(rig, 0.5),
    "wings_fold_75": lambda rig: R.fold_wings(rig, 0.75),
    "wings_folded": lambda rig: R.fold_wings(rig, 1.0),
    "jaw_open": lambda rig: R.pose_jaw(rig, 1.0),
}


def keyframe_pose(rig, name, setter):
    R.reset_pose(rig)
    setter(rig)
    bpy.context.view_layer.update()
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        q = pb.matrix_basis.to_quaternion()      # whatever rotation mode the setter used (pose_jaw uses XYZ)
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = q
    for f in (1, 2):
        for pb in rig.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("location", frame=f)
    act.use_fake_user = True
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, act)
    rig.animation_data.action = None
    R.reset_pose(rig)
    return act


def make_clips(rig):
    """Plan 2's clips, then the pose library (spec §5.11); every clip is sampled at LIB.FPS."""
    bpy.context.scene.render.fps = LIB.FPS
    return [keyframe_pose(rig, name, setter) for name, setter in CLIPS.items()] + LIB.make_library_clips(rig)
