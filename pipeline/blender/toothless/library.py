"""Toothless pose library (spec §5.11): single-frame poses and short clips for toothless.poses.glb, plus the metadata
the engine reads from toothless.poses.json (explicit bone masks, leg ownership, body placement, wing state, sole spots,
loop flag, blend times, interrupt policy, face curves).

A pose is bone-local XYZ Euler rotations (radians) from bind: independent of the mesh, so a re-sculpt keeps it valid.
root = (pelvis-head height above the ground (m), body pitch (rad, + = nose up)); the engine drives its body solver to it,
here it becomes the pelvis bone's pose. wings = (fold 0..1, lift rad, flare 0..1), applied after rig.fold_wings.
The numbers were solved against the anatomy (limits, sole contacts, proxies) and the skinned mesh (ground contact),
then checked on clay contact sheets (qa.library_renders).
"""
import math
import bpy
from mathutils import Euler, Matrix, Vector
import anatomy as A
import rig as R

FPS = 30
FLARE_DEG = 25.0        # at flare 1 the folded wing swings this far off the flank (humerus local Z, mirrored per side)
FLARE_LIFT_DEG = 8.0    # ...and lifts this much (humerus local X)
LEG_KEYS = ("front_L", "front_R", "hind_L", "hind_R")

POSES = {
    "sit": {
        "root": (0.384, 0.278),
        "wings": (1, 0.4, 0),
        "bones": {
            "chest": (0.147, 0, 0), "front_humerus_L": (-0.521, 0, 0), "front_humerus_R": (-0.521, 0, 0),
            "front_metacarpal_L": (0.257, 0, 0), "front_metacarpal_R": (0.257, 0, 0), "front_radius_L": (-0.449, 0, 0),
            "front_radius_R": (-0.449, 0, 0), "front_scapula_L": (0.029, 0, 0), "front_scapula_R": (0.029, 0, 0),
            "front_toes_L": (-0.041, 0, 0), "front_toes_R": (-0.041, 0, 0), "head": (-0.445, 0, 0),
            "hind_femur_L": (0.233, 0, 0), "hind_femur_R": (0.233, 0, 0), "hind_metatarsal_L": (1.483, 0, 0),
            "hind_metatarsal_R": (1.483, 0, 0), "hind_tibia_L": (1.222, 0, 0), "hind_tibia_R": (1.222, 0, 0),
            "hind_toes_L": (-0.878, 0, 0), "hind_toes_R": (-0.878, 0, 0), "neck_01": (0.099, 0, 0),
            "neck_02": (-0.015, 0, 0), "neck_03": (-0.12, 0, 0), "neck_04": (-0.248, 0, 0),
            "spine_01": (0.154, 0, 0), "spine_02": (0.079, 0, 0), "spine_03": (0.072, 0, 0),
            "tail_01": (0.079, 0, -0.314), "tail_02": (0.118, 0, -0.392), "tail_03": (-0.062, 0, -0.436),
            "tail_04": (-0.092, 0, -0.489), "tail_05": (-0.124, 0, -0.499), "tail_06": (-0.117, 0, -0.474),
            "tail_07": (-0.098, 0, -0.415), "tail_08": (-0.081, 0, -0.339), "tail_09": (-0.06, 0, -0.258),
            "tail_10": (-0.035, 0, -0.181), "tail_11": (-0.021, 0, -0.114), "tail_12": (-0.009, 0, -0.054),
        },
    },
    "lie": {
        "root": (0.388, -0.004),
        "wings": (1, 0.45, 0),
        "bones": {
            "chest": (0.12, 0, 0), "front_humerus_L": (0.17, 0, 0), "front_humerus_R": (0.17, 0, 0),
            "front_metacarpal_L": (-0.67, 0, 0), "front_metacarpal_R": (-0.67, 0, 0), "front_radius_L": (0.488, 0, 0),
            "front_radius_R": (0.488, 0, 0), "front_scapula_L": (0.061, 0, 0), "front_scapula_R": (0.061, 0, 0),
            "front_toes_L": (-0.529, 0, 0), "front_toes_R": (-0.529, 0, 0), "head": (-0.014, 0, 0),
            "hind_femur_L": (1.034, 0, 0), "hind_femur_R": (1.034, 0, 0), "hind_metatarsal_L": (1.025, 0, 0),
            "hind_metatarsal_R": (1.025, 0, 0), "hind_tibia_L": (1.216, 0, 0), "hind_tibia_R": (1.216, 0, 0),
            "hind_toes_L": (-0.892, 0, 0), "hind_toes_R": (-0.892, 0, 0), "neck_01": (-0.178, 0, 0),
            "neck_02": (-0.139, 0, 0), "neck_03": (-0.093, 0, 0), "neck_04": (-0.052, 0, 0),
            "spine_01": (-0.161, 0, 0), "spine_02": (0.262, 0, 0), "spine_03": (0.259, 0, 0),
            "tail_01": (-0.436, 0, 0), "tail_02": (0.426, 0, 0), "tail_03": (0.044, 0, 0),
            "tail_04": (0.029, 0, 0.07), "tail_05": (0.01, 0, 0.14), "tail_06": (-0.001, 0, 0.175),
            "tail_07": (0.01, 0, 0.14), "tail_08": (0.005, 0, 0.07), "tail_09": (0.009, 0, -0.07),
            "tail_10": (0.022, 0, -0.175), "tail_11": (0.015, 0, -0.244), "tail_12": (-0.001, 0, -0.279),
        },
    },
    "sleep": {
        "root": (0.4, -0.004),       # 1.2 cm above lie: the tucked left elbow pressed 4.1 cm into the ground
        "wings": (1, 0.45, 0),
        "bones": {
            "chest": (0.12, 0, 0.078), "front_humerus_L": (1.047, 0, 0), "front_humerus_R": (0.981, 0, 0),
            "front_metacarpal_L": (1.571, 0, 0), "front_metacarpal_R": (1.571, 0, 0), "front_radius_L": (2.094, 0, 0),
            "front_radius_R": (2.094, 0, 0), "front_scapula_L": (-0.383, 0, 0), "front_scapula_R": (-0.436, 0, 0),
            "front_toes_L": (1.396, 0, 0), "front_toes_R": (1.377, 0, 0), "head": (0.333, 0.262, 0.17),
            "hind_femur_L": (1.034, 0, 0), "hind_femur_R": (1.034, 0, 0), "hind_metatarsal_L": (1.025, 0, 0),
            "hind_metatarsal_R": (1.025, 0, 0), "hind_tibia_L": (1.216, 0, 0), "hind_tibia_R": (1.216, 0, 0),
            "hind_toes_L": (-0.892, 0, 0), "hind_toes_R": (-0.892, 0, 0), "neck_01": (-0.611, 0.262, 0.698),
            "neck_02": (-0.494, 0.262, 0.698), "neck_03": (-0.03, 0.262, 0.698), "neck_04": (0.159, 0.262, 0.151),
            "spine_01": (-0.161, 0, 0.209), "spine_02": (0.262, 0, 0.184), "spine_03": (0.259, 0, 0.209),
            "tail_01": (-0.436, 0, 0), "tail_02": (0.42, 0, -0.14), "tail_03": (0.024, 0, -0.244),
            "tail_04": (-0.007, 0, -0.349), "tail_05": (-0.048, 0, -0.419), "tail_06": (-0.065, 0, -0.489),
            "tail_07": (-0.073, 0, -0.524), "tail_08": (-0.079, 0, -0.524), "tail_09": (-0.08, 0, -0.524),
            "tail_10": (-0.078, 0, -0.524), "tail_11": (-0.082, 0, -0.524), "tail_12": (-0.085, 0, -0.489),
        },
    },
    "stretch": {
        "root": (1.131, -0.485),
        "wings": (1, 0.2, 1),
        "bones": {
            "chest": (0.249, 0, 0), "front_humerus_L": (0.524, 0, 0), "front_humerus_R": (0.524, 0, 0),
            "front_metacarpal_L": (-0.658, 0, 0), "front_metacarpal_R": (-0.658, 0, 0), "front_radius_L": (0.639, 0, 0),
            "front_radius_R": (0.639, 0, 0), "front_scapula_L": (0.117, 0, 0), "front_scapula_R": (0.117, 0, 0),
            "front_toes_L": (-0.533, 0, 0), "front_toes_R": (-0.533, 0, 0), "head": (0.378, 0, 0),
            "hind_femur_L": (-0.097, 0, 0), "hind_femur_R": (-0.097, 0, 0), "hind_metatarsal_L": (0.077, 0, 0),
            "hind_metatarsal_R": (0.077, 0, 0), "hind_tibia_L": (-0.96, 0, 0), "hind_tibia_R": (-0.96, 0, 0),
            "hind_toes_L": (-0.448, 0, 0), "hind_toes_R": (-0.448, 0, 0), "neck_01": (-0.315, 0, 0),
            "neck_02": (-0.132, 0, 0), "neck_03": (0.068, 0, 0), "neck_04": (0.233, 0, 0),
            "spine_01": (-0.049, 0, 0), "spine_02": (0.051, 0, 0), "spine_03": (0.152, 0, 0),
            "tail_01": (0.175, 0, 0), "tail_02": (0.14, 0, 0), "tail_03": (0.087, 0, 0),
            "tail_04": (0.035, 0, 0), "tail_06": (-0.052, 0, 0), "tail_07": (-0.087, 0, 0),
            "tail_08": (-0.105, 0, 0), "tail_09": (-0.105, 0, 0), "tail_10": (-0.105, 0, 0),
            "tail_11": (-0.087, 0, 0), "tail_12": (-0.07, 0, 0),
        },
    },
    "sniff": {
        "root": (0.95, -0.12),
        "wings": (1, 0, 0),
        "bones": {
            "chest": (-0.116, 0, 0), "front_humerus_L": (-0.163, 0, 0), "front_humerus_R": (-0.163, 0, 0),
            "front_metacarpal_L": (-0.02, 0, 0), "front_metacarpal_R": (-0.02, 0, 0), "front_radius_L": (0.881, 0, 0),
            "front_radius_R": (0.881, 0, 0), "front_scapula_L": (-0.012, 0, 0), "front_scapula_R": (-0.012, 0, 0),
            "front_toes_L": (-0.45, 0, 0), "front_toes_R": (-0.45, 0, 0), "head": (-0.233, 0, 0),
            "hind_metatarsal_L": (0.453, 0, 0), "hind_metatarsal_R": (0.453, 0, 0), "hind_tibia_L": (-0.041, 0, 0),
            "hind_tibia_R": (-0.041, 0, 0), "hind_toes_L": (-0.371, 0, 0), "hind_toes_R": (-0.371, 0, 0),
            "neck_01": (-0.182, 0, 0), "neck_02": (-0.229, 0, 0), "neck_03": (-0.262, 0, 0),
            "neck_04": (-0.264, 0, 0), "tail_01": (0.052, 0, 0), "tail_02": (0.052, 0, 0),
            "tail_03": (0.052, 0, 0), "tail_04": (0.052, 0, 0), "tail_05": (0.052, 0, -0.07),
            "tail_06": (0.052, 0, -0.07), "tail_07": (0.052, 0, -0.07), "tail_08": (0.052, 0, -0.07),
            "tail_09": (0.052, 0, -0.07), "tail_10": (0.052, 0, -0.07), "tail_11": (0.052, 0, -0.07),
            "tail_12": (0.052, 0, -0.07),
        },
    },
    "stalk": {
        "root": (0.8, -0.06),
        "wings": (1, 0, 0),
        "bones": {
            "chest": (-0.056, 0, 0), "front_humerus_L": (-0.406, 0, 0), "front_humerus_R": (-0.406, 0, 0),
            "front_metacarpal_L": (0.001, 0, 0), "front_metacarpal_R": (0.001, 0, 0), "front_radius_L": (1.07, 0, 0),
            "front_radius_R": (1.07, 0, 0), "front_scapula_L": (-0.028, 0, 0), "front_scapula_R": (-0.028, 0, 0),
            "front_toes_L": (-0.522, 0, 0), "front_toes_R": (-0.522, 0, 0), "head": (0.063, 0, 0),
            "hind_femur_L": (0.029, 0, 0), "hind_femur_R": (0.029, 0, 0), "hind_metatarsal_L": (0.804, 0, 0),
            "hind_metatarsal_R": (0.804, 0, 0), "hind_tibia_L": (0.293, 0, 0), "hind_tibia_R": (0.293, 0, 0),
            "hind_toes_L": (-0.475, 0, 0), "hind_toes_R": (-0.475, 0, 0), "neck_01": (-0.021, 0, 0),
            "neck_02": (0.002, 0, 0), "neck_03": (0.026, 0, 0), "neck_04": (0.046, 0, 0),
            "tail_01": (-0.035, 0, 0), "tail_02": (-0.035, 0, 0), "tail_03": (-0.035, 0, 0),
            "tail_04": (-0.035, 0, 0), "tail_05": (0.052, 0, 0), "tail_06": (0.052, 0, 0),
            "tail_07": (0.052, 0, 0), "tail_08": (0.052, 0, 0), "tail_09": (0.052, 0, 0),
            "tail_10": (0.052, 0, 0), "tail_11": (0.052, 0, 0), "tail_12": (0.052, 0, 0),
        },
    },
    "jump_crouch": {
        "root": (0.78, -0.1),
        "wings": (1, 0, 0),
        "bones": {
            "chest": (-0.07, 0, 0), "front_humerus_L": (-0.413, 0, 0), "front_humerus_R": (-0.413, 0, 0),
            "front_metacarpal_L": (0.01, 0, 0), "front_metacarpal_R": (0.01, 0, 0), "front_radius_L": (1.006, 0, 0),
            "front_radius_R": (1.006, 0, 0), "front_scapula_L": (-0.026, 0, 0), "front_scapula_R": (-0.026, 0, 0),
            "front_toes_L": (-0.494, 0, 0), "front_toes_R": (-0.494, 0, 0), "head": (0.14, 0, 0),
            "hind_femur_L": (0.028, 0, 0), "hind_femur_R": (0.028, 0, 0), "hind_metatarsal_L": (0.933, 0, 0),
            "hind_metatarsal_R": (0.933, 0, 0), "hind_tibia_L": (0.247, 0, 0), "hind_tibia_R": (0.247, 0, 0),
            "hind_toes_L": (-0.608, 0, 0), "hind_toes_R": (-0.608, 0, 0), "neck_01": (-0.105, 0, 0),
            "neck_02": (-0.07, 0, 0), "neck_03": (0.07, 0, 0), "neck_04": (0.105, 0, 0),
            "spine_01": (0.07, 0, 0), "spine_02": (0.07, 0, 0), "spine_03": (-0.052, 0, 0),
            "tail_01": (0.105, 0, 0), "tail_02": (0.105, 0, 0), "tail_03": (0.105, 0, 0),
            "tail_04": (0.105, 0, 0), "tail_05": (0.105, 0, 0), "tail_06": (0.035, 0, 0),
            "tail_07": (0.035, 0, 0), "tail_08": (0.035, 0, 0), "tail_09": (0.035, 0, 0),
            "tail_10": (0.035, 0, 0), "tail_11": (0.035, 0, 0), "tail_12": (0.035, 0, 0),
        },
    },
    "jump_launch": {
        "root": (1.5, 0.087),
        "wings": (1, 0, 0.7),
        "bones": {
            "chest": (0.07, 0, 0), "front_humerus_L": (0.785, 0, 0), "front_humerus_R": (0.785, 0, 0),
            "front_metacarpal_L": (-0.349, 0, 0), "front_metacarpal_R": (-0.349, 0, 0), "front_radius_L": (0.349, 0, 0),
            "front_radius_R": (0.349, 0, 0), "front_toes_L": (-0.175, 0, 0), "front_toes_R": (-0.175, 0, 0),
            "head": (-0.175, 0, 0), "hind_femur_L": (-1.187, 0, 0), "hind_femur_R": (-1.187, 0, 0),
            "hind_metatarsal_L": (-0.733, 0, 0), "hind_metatarsal_R": (-0.733, 0, 0), "hind_tibia_L": (-0.908, 0, 0),
            "hind_tibia_R": (-0.908, 0, 0), "hind_toes_L": (-0.785, 0, 0), "hind_toes_R": (-0.785, 0, 0),
            "neck_01": (0.105, 0, 0), "neck_02": (0.07, 0, 0), "spine_01": (-0.07, 0, 0),
            "spine_02": (-0.07, 0, 0), "tail_01": (0.14, 0, 0), "tail_02": (0.14, 0, 0),
            "tail_03": (0.14, 0, 0), "tail_04": (0.14, 0, 0), "tail_05": (0.035, 0, 0),
            "tail_06": (0.035, 0, 0), "tail_07": (0.035, 0, 0), "tail_08": (0.035, 0, 0),
            "tail_09": (0.035, 0, 0), "tail_10": (0.035, 0, 0), "tail_11": (0.035, 0, 0),
            "tail_12": (0.035, 0, 0),
        },
    },
    "jump_tuck": {
        "root": (1.9, 0.035),
        "wings": (1, 0, 1),
        "bones": {
            "front_humerus_L": (-0.698, 0, 0), "front_humerus_R": (-0.698, 0, 0), "front_metacarpal_L": (0.698, 0, 0),
            "front_metacarpal_R": (0.698, 0, 0), "front_radius_L": (1.745, 0, 0), "front_radius_R": (1.745, 0, 0),
            "front_toes_L": (0.349, 0, 0), "front_toes_R": (0.349, 0, 0), "head": (-0.105, 0, 0),
            "hind_femur_L": (1.047, 0, 0), "hind_femur_R": (1.047, 0, 0), "hind_metatarsal_L": (1.222, 0, 0),
            "hind_metatarsal_R": (1.222, 0, 0), "hind_tibia_L": (1.134, 0, 0), "hind_tibia_R": (1.134, 0, 0),
            "hind_toes_L": (-0.524, 0, 0), "hind_toes_R": (-0.524, 0, 0), "neck_01": (0.07, 0, 0),
            "spine_01": (0.052, 0, 0), "spine_02": (0.052, 0, 0), "tail_01": (0.026, 0, 0),
            "tail_02": (0.026, 0, 0), "tail_03": (0.026, 0, 0), "tail_04": (0.026, 0, 0),
            "tail_05": (0.026, 0, 0), "tail_06": (0.026, 0, 0), "tail_07": (0.026, 0, 0),
            "tail_08": (0.026, 0, 0), "tail_09": (0.026, 0, 0), "tail_10": (0.026, 0, 0),
            "tail_11": (0.026, 0, 0), "tail_12": (0.026, 0, 0),
        },
    },
    "jump_land": {
        "root": (1.35, -0.209),
        "wings": (1, 0, 0.6),
        "bones": {
            "chest": (-0.07, 0, 0), "front_humerus_L": (0.873, 0, 0), "front_humerus_R": (0.873, 0, 0),
            "front_metacarpal_L": (-0.262, 0, 0), "front_metacarpal_R": (-0.262, 0, 0), "front_radius_L": (-0.262, 0, 0),
            "front_radius_R": (-0.262, 0, 0), "front_toes_L": (-0.175, 0, 0), "front_toes_R": (-0.175, 0, 0),
            "head": (-0.105, 0, 0), "hind_femur_L": (-0.524, 0, 0), "hind_femur_R": (-0.524, 0, 0),
            "hind_metatarsal_L": (-0.175, 0, 0), "hind_metatarsal_R": (-0.175, 0, 0), "hind_tibia_L": (0.175, 0, 0),
            "hind_tibia_R": (0.175, 0, 0), "neck_01": (0.175, 0, 0), "neck_02": (0.14, 0, 0),
            "neck_03": (0.035, 0, 0), "tail_01": (0.105, 0, 0), "tail_02": (0.087, 0, 0),
            "tail_03": (0.07, 0, 0), "tail_04": (0.052, 0, 0), "tail_05": (0.035, 0, 0),
            "tail_06": (0.017, 0, 0), "tail_09": (-0.017, 0, 0), "tail_10": (-0.017, 0, 0),
            "tail_11": (-0.017, 0, 0), "tail_12": (-0.017, 0, 0),
        },
    },
    "plasma_rear": {
        "root": (1, 0.03),
        "wings": (1, 0, 0),
        "bones": {
            "chest": (0.105, 0, 0), "front_humerus_L": (0.037, 0, 0), "front_humerus_R": (0.037, 0, 0),
            "front_metacarpal_L": (-0.127, 0, 0), "front_metacarpal_R": (-0.127, 0, 0), "front_radius_L": (-0.464, 0, 0),
            "front_radius_R": (-0.464, 0, 0), "front_scapula_L": (-0.001, 0, 0), "front_scapula_R": (-0.001, 0, 0),
            "front_toes_L": (0.348, 0, 0), "front_toes_R": (0.348, 0, 0), "head": (-0.105, 0, 0),
            "hind_femur_L": (0.006, 0, 0), "hind_femur_R": (0.006, 0, 0), "hind_metatarsal_L": (0.014, 0, 0),
            "hind_metatarsal_R": (0.014, 0, 0), "hind_tibia_L": (0.07, 0, 0), "hind_tibia_R": (0.07, 0, 0),
            "hind_toes_L": (0.02, 0, 0), "hind_toes_R": (0.02, 0, 0), "neck_01": (0.314, 0, 0),
            "neck_02": (0.244, 0, 0), "neck_03": (-0.07, 0, 0), "neck_04": (-0.175, 0, 0),
            "spine_03": (0.07, 0, 0), "tail_01": (0.07, 0, 0), "tail_02": (0.07, 0, 0),
            "tail_03": (0.07, 0, 0), "tail_04": (0.07, 0, 0), "tail_05": (0.07, 0, 0),
            "tail_06": (0.07, 0, 0), "tail_07": (0.017, 0, 0), "tail_08": (0.017, 0, 0),
            "tail_09": (0.017, 0, 0), "tail_10": (0.017, 0, 0), "tail_11": (0.017, 0, 0),
            "tail_12": (0.017, 0, 0),
        },
    },
    "climb_reach": {
        "root": (1.02, 0),
        "wings": (1, 0, 0.8),
        "bones": {
            "chest": (0.087, 0, 0), "front_humerus_L": (-0.068, 0, 0), "front_humerus_R": (-0.068, 0, 0),
            "front_metacarpal_L": (0.003, 0, 0), "front_metacarpal_R": (0.003, 0, 0), "front_radius_L": (-0.074, 0, 0),
            "front_radius_R": (-0.074, 0, 0), "front_scapula_L": (-0.001, 0, 0), "front_scapula_R": (-0.001, 0, 0),
            "front_toes_L": (0.051, 0, 0), "front_toes_R": (0.051, 0, 0), "head": (-0.209, 0, 0),
            "neck_01": (0.175, 0, 0), "neck_02": (0.14, 0, 0), "neck_03": (0.07, 0, 0),
            "neck_04": (-0.105, 0, 0),
        },
    },
    "scramble_hook": {
        "root": (1.4, 0.698),
        "wings": (1, 0, 0.8),
        "bones": {
            "chest": (0.14, 0, 0), "front_humerus_L": (0.873, 0, 0), "front_humerus_R": (0.873, 0, 0),
            "front_metacarpal_L": (1.047, 0, 0), "front_metacarpal_R": (1.047, 0, 0), "front_radius_L": (-0.349, 0, 0),
            "front_radius_R": (-0.349, 0, 0), "front_toes_L": (0.698, 0, 0), "front_toes_R": (0.698, 0, 0),
            "head": (-0.105, 0, 0), "hind_femur_L": (-0.349, 0, 0), "hind_femur_R": (-0.349, 0, 0),
            "hind_metatarsal_L": (0.175, 0, 0), "hind_metatarsal_R": (0.175, 0, 0), "hind_tibia_L": (0.349, 0, 0),
            "hind_tibia_R": (0.349, 0, 0), "neck_01": (-0.244, 0, 0), "neck_02": (-0.279, 0, 0),
            "neck_03": (-0.209, 0, 0), "neck_04": (-0.105, 0, 0), "spine_01": (-0.105, 0, 0),
            "spine_02": (-0.07, 0, 0), "tail_01": (0.244, 0, 0), "tail_02": (0.244, 0, 0),
            "tail_03": (0.244, 0, 0), "tail_04": (0.07, 0, 0), "tail_05": (0.07, 0, 0),
            "tail_06": (0.07, 0, 0), "tail_07": (0.07, 0, 0), "tail_08": (0.07, 0, 0),
            "tail_09": (0.07, 0, 0), "tail_10": (0.07, 0, 0), "tail_11": (0.07, 0, 0),
            "tail_12": (0.07, 0, 0),
        },
    },
    "scratch_reach": {
        "root": (0.384, 0.278),
        "wings": (1, 0.4, 0),
        "bones": {
            "chest": (0.147, 0, 0.126), "front_humerus_L": (-0.521, 0, 0), "front_humerus_R": (-0.521, 0, 0),
            "front_metacarpal_L": (0.257, 0, 0), "front_metacarpal_R": (0.257, 0, 0), "front_radius_L": (-0.449, 0, 0),
            "front_radius_R": (-0.449, 0, 0), "front_scapula_L": (0.029, 0, 0), "front_scapula_R": (0.029, 0, 0),
            "front_toes_L": (-0.041, 0, 0), "front_toes_R": (-0.041, 0, 0), "head": (-0.569, 0, 0.312),
            "hind_femur_L": (1.303, 0, 0.45), "hind_femur_R": (0.233, 0, 0), "hind_metatarsal_L": (-0.638, 0, 0),
            "hind_metatarsal_R": (1.483, 0, 0), "hind_tibia_L": (-0.958, 0, 0), "hind_tibia_R": (1.222, 0, 0),
            "hind_toes_L": (0.134, 0, 0), "hind_toes_R": (-0.878, 0, 0), "neck_01": (0.451, 0, 0.376),
            "neck_02": (0.139, 0, 0.634), "neck_03": (0.045, 0, 0.429), "neck_04": (-0.345, 0, 0.421),
            "spine_01": (0.154, 0, -0.113), "spine_02": (0.079, 0, -0.061), "spine_03": (0.072, 0, 0.184),
            "tail_01": (0.079, 0, -0.314), "tail_02": (0.118, 0, -0.392), "tail_03": (-0.062, 0, -0.436),
            "tail_04": (-0.092, 0, -0.489), "tail_05": (-0.124, 0, -0.499), "tail_06": (-0.117, 0, -0.474),
            "tail_07": (-0.098, 0, -0.415), "tail_08": (-0.081, 0, -0.339), "tail_09": (-0.06, 0, -0.258),
            "tail_10": (-0.035, 0, -0.181), "tail_11": (-0.021, 0, -0.114), "tail_12": (-0.009, 0, -0.054),
        },
    },
}

# The scramble's pull-over key (between scramble_hook and settling): chest over the lip, head level, tail lifted.
PULL = {"spine_01": (0.06, 0, 0), "spine_02": (0.06, 0, 0), "chest": (-0.1, 0, 0), "neck_01": (-0.2, 0, 0),
        "neck_02": (-0.15, 0, 0), "neck_03": (-0.05, 0, 0), "head": (0.15, 0, 0),
        **{f"tail_{i:02d}": (0.1 if i < 4 else 0.03, 0, 0) for i in range(1, 13)}}

# The scratch intro's middle key: the left hind paw folded up under the flank, clear of the ground.
SCRATCH_LIFT = {"hind_femur_L": (1.05, 0, 0.2), "hind_tibia_L": (1.1, 0, 0), "hind_metatarsal_L": (1.2, 0, 0), "hind_toes_L": (-0.6, 0, 0)}
SCRATCH_LOOP_START = 12          # frames: 0-12 intro (sit -> folded paw -> reach), 12-28 two strokes, frame 28 == frame 12


BODY = ["spine_", "chest", "neck_", "head", "tail_"]
LEGS = ["front_", "hind_"]
ALL = list(LEG_KEYS)
# Engine metadata per clip (spec §5.11). mask: bone-name prefixes the layer drives. ownsLegs: legs the pose drives instead
# of the leg IK. useRoot: the body solver takes the pelvis to POSES[..]["root"]. interrupt: "exit" (any input plays the
# exit blend at once), "finish" (the clip completes first), "none" (an action; input does not interrupt it).
# bodyPitch: an airborne pose's body pitch (rad), read by the jump (no root: it flies the body itself).
# look: the head-look gain while the layer is live (0 = the pose's head wins: shake, sleep; 1 or absent = full look).
# loopStart: a looping clip wraps into [loopStart, duration) (an intro plays once). exit "reverse": the clip plays
# backwards to its start instead of blending out (its first frame is the pose beneath it).
# face: channel -> [[t, value], ...] (linear; constant after the last key). Channels: jaw, blink, squint, smile, snarl,
# teeth_out, nostril_flare (0..1), pupil (0 slit .. 1 round, a target), ears (deg, + = back/flat), plasmaGlow (0..1).
# Posture layers (sit, lie, sleep) hold time 0, so their curves are constants that the hop's weight blends in.
META = {
    # postures: the body solver takes the pelvis to `root`; owned legs follow the pose, the rest stay on the leg IK
    "sit": {"mask": BODY + ["hind_"], "ownsLegs": ["hind_L", "hind_R"], "useRoot": True, "blendIn": 0.8, "blendOut": 0.6,
            "interrupt": "exit"},
    "lie": {"mask": BODY + LEGS, "ownsLegs": ALL, "useRoot": True, "blendIn": 1.0, "blendOut": 0.8, "interrupt": "exit"},
    "sleep": {"mask": BODY + LEGS, "ownsLegs": ALL, "useRoot": True, "blendIn": 1.6, "blendOut": 1.0, "interrupt": "exit", "look": 0.0,
              "face": {"blink": [[0, 1]], "smile": [[0, 0.15]], "ears": [[0, 20]]}},
    "stretch": {"mask": BODY + LEGS, "ownsLegs": ALL, "useRoot": True, "blendIn": 0.9, "blendOut": 0.7, "interrupt": "exit", "look": 0.5,
                "face": {"squint": [[0, 0.7]], "ears": [[0, 25]]}},
    # gestures over the procedural stance (legs stay on IK)
    "sniff": {"mask": ["chest", "neck_", "head", "tail_"], "ownsLegs": [], "useRoot": True, "blendIn": 0.5, "blendOut": 0.4,
              "interrupt": "exit", "look": 0.4, "face": {"nostril_flare": [[0, 0.6]]}},
    "stalk": {"mask": ["chest", "neck_", "head", "tail_"], "ownsLegs": [], "useRoot": True, "blendIn": 0.6, "blendOut": 0.5,
              "interrupt": "exit", "face": {"pupil": [[0, 0.95]], "ears": [[0, -12]]}},
    # actions (input does not interrupt them)
    "jump_crouch": {"mask": BODY, "ownsLegs": [], "useRoot": True, "blendIn": 0.1, "blendOut": 0.1, "interrupt": "none"},
    # airborne poses: the jump flies the body itself and reads bodyPitch (the root heights here only place the renders)
    "jump_launch": {"mask": BODY + LEGS, "ownsLegs": ALL, "useRoot": False, "bodyPitch": True, "blendIn": 0.08, "blendOut": 0.15,
                    "interrupt": "none", "look": 0.5},
    "jump_tuck": {"mask": BODY + LEGS, "ownsLegs": ALL, "useRoot": False, "bodyPitch": True, "blendIn": 0.2, "blendOut": 0.15,
                  "interrupt": "none", "look": 0.5},
    # the landing shapes the body and tail only: the leg IK reaches the paws down onto their landing spots
    "jump_land": {"mask": BODY, "ownsLegs": [], "useRoot": False, "bodyPitch": True, "blendIn": 0.15, "blendOut": 0.3,
                  "interrupt": "none", "look": 0.6},
    "plasma_rear": {"mask": BODY, "ownsLegs": [], "useRoot": True, "blendIn": 0.15, "blendOut": 0.3, "interrupt": "none",
                    "face": {"jaw": [[0, 0], [0.3, 0.75]], "teeth_out": [[0, 0], [0.15, 1]], "snarl": [[0, 0.7]],
                             "pupil": [[0, 0]], "ears": [[0, 45]], "plasmaGlow": [[0, 0], [0.3, 1]]}},
    # climbing
    "climb_reach": {"mask": ["chest", "neck_", "head"], "ownsLegs": [], "useRoot": False, "blendIn": 0.4, "blendOut": 0.4,
                    "interrupt": "exit"},
    "scramble_hook": {"mask": BODY, "ownsLegs": [], "useRoot": False, "blendIn": 0.15, "blendOut": 0.2, "interrupt": "none", "look": 0.3},
    # clips
    "scratch": {"mask": ["spine_", "chest", "neck_", "head", "hind_femur_L", "hind_tibia_L", "hind_metatarsal_L", "hind_toes_L"],
                "ownsLegs": ["hind_L"], "useRoot": False, "loop": True, "loopStart": SCRATCH_LOOP_START / FPS, "exit": "reverse",
                "blendIn": 0.1, "blendOut": 0.1, "interrupt": "exit", "look": 0.2,
                "face": {"squint": [[0, 0.8]], "smile": [[0, 0.35]], "ears": [[0, 15]]}},
    "shake": {"mask": ["spine_", "chest", "neck_", "head", "tail_", "ear_"], "ownsLegs": [], "useRoot": True, "root": (0.94, 0.0),
              "blendIn": 0.1, "blendOut": 0.2, "interrupt": "exit", "look": 0.0, "face": {"squint": [[0, 0.6]]}},
    "yawn": {"mask": ["neck_", "head"], "ownsLegs": [], "useRoot": False, "blendIn": 0.2, "blendOut": 0.3, "interrupt": "exit", "look": 0.4,
             "face": {"jaw": [[0, 0], [0.5, 0.25], [1.1, 0.95], [1.7, 0.95], [2.3, 0]],
                      "squint": [[0, 0], [0.8, 0.85], [1.8, 0.85], [2.4, 0]],
                      "smile": [[0.8, 0], [1.2, 0.6], [1.7, 0.6], [2.2, 0]],
                      "ears": [[0, 0], [0.9, 30], [1.9, 30], [2.4, 0]]}},
    "scramble_up": {"mask": BODY, "ownsLegs": [], "useRoot": False, "blendIn": 0.1, "blendOut": 0.2, "interrupt": "none", "look": 0.3},
}
LIBRARY = list(META)


def _smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _single(name):
    p = POSES[name]
    return [{"root": p["root"], "wings": p["wings"], "bones": dict(p["bones"])}]


def _lerp_bones(a, b, u):
    zero = (0.0, 0.0, 0.0)
    return {n: tuple(x + (y - x) * u for x, y in zip(a.get(n, zero), b.get(n, zero))) for n in set(a) | set(b)}


def _scratch():
    """Intro (0.4 s): from the sit, the left hind paw folds up under the flank and reaches the neck (a direct blend
    swept it through the ground); then a 16-frame loop of two strokes. The engine loops from SCRATCH_LOOP_START and
    plays the clip backwards to exit, so the paw goes home the way it came."""
    sit = POSES["sit"]
    reach = POSES["scratch_reach"]
    lift = dict(sit["bones"], **SCRATCH_LIFT)
    out = []
    for f in range(SCRATCH_LOOP_START + 1):
        t = f / FPS
        a, b, u = (sit["bones"], lift, t / 0.18) if t < 0.18 else (lift, reach["bones"], (t - 0.18) / (0.4 - 0.18))
        out.append({"root": sit["root"], "wings": sit["wings"], "bones": _lerp_bones(a, b, _smooth(0.0, 1.0, u))})
    for f in range(1, 17):
        s = 0.5 - 0.5 * math.cos(2 * math.pi * 2 * f / 16)
        b = dict(reach["bones"])
        for bone, dx in (("hind_femur_L", -0.14), ("hind_tibia_L", 0.18), ("hind_metatarsal_L", -0.12)):
            x, y, z = b[bone]
            b[bone] = (x + dx * s, y, z)
        x, y, z = b.get("head", (0.0, 0.0, 0.0))
        b["head"] = (x, y + 0.04 * s, z)
        out.append({"root": reach["root"], "wings": reach["wings"], "bones": b})
    return out


def _shake():
    """1.2 s: a roll wave down the spine, a head shake, a tail wave and ear flaps at 4.5 Hz, rising and dying away."""
    out = []
    for f in range(37):
        t = f / FPS
        env = _smooth(0.0, 0.15, t) * (1.0 - _smooth(0.75, 1.2, t))
        w = 2 * math.pi * 4.5 * t
        b = {}
        for k, n in enumerate(("spine_01", "spine_02", "spine_03", "chest")):
            b[n] = (0.0, 0.06 * env * math.sin(w - 0.4 * k), 0.0)      # more would lift a shoulder out of the leg's reach
        for k, n in enumerate(("neck_01", "neck_02", "neck_03", "neck_04", "head")):
            b[n] = (0.0, 0.08 * env * math.sin(w - 1.2 - 0.3 * k), 0.22 * env * math.sin(w - 1.6 - 0.3 * k))
        for k in range(12):
            b[f"tail_{k + 1:02d}"] = (0.0, 0.0, 0.2 * env * math.sin(w + 0.6 + 0.45 * k))
        for side in ("L", "R"):
            for i in (1, 2, 3):
                b[f"ear_{i}_{side}"] = (0.35 * env * math.sin(w - 2.0), 0.0, 0.0)
        out.append({"root": None, "wings": (1.0, 0.0, 0.0), "bones": b})
    return out


def _yawn():
    """2.4 s: the head lifts and tips back while the jaw (a face curve) opens wide, holds, then settles."""
    out = []
    for f in range(73):
        t = f / FPS
        up = _smooth(0.0, 1.1, t) * (1.0 - _smooth(1.7, 2.4, t))
        b = {"neck_01": (0.10 * up, 0, 0), "neck_02": (0.12 * up, 0, 0), "neck_03": (0.10 * up, 0, 0),
             "neck_04": (0.06 * up, 0, 0), "head": (0.22 * up, 0.05 * up, 0)}
        out.append({"root": None, "wings": (1.0, 0.0, 0.0), "bones": b})
    return out


def _scramble_up():
    """0.9 s: reach (climb_reach) -> hook (scramble_hook) -> pull over the lip (PULL) -> settle (bind), eased."""
    keys = [(0.0, POSES["climb_reach"]["bones"]), (0.3, POSES["scramble_hook"]["bones"]), (0.6, PULL), (0.9, {})]
    zero = (0.0, 0.0, 0.0)
    out = []
    for f in range(28):
        t = min(f / FPS, 0.9)
        k = len(keys) - 2 if t >= 0.9 else max(i for i in range(len(keys) - 1) if keys[i][0] <= t + 1e-9)
        (t0, a), (t1, b) = keys[k], keys[k + 1]
        u = _smooth(0.0, 1.0, (t - t0) / (t1 - t0))
        names = {n for n in set(a) | set(b) if n.startswith(tuple(BODY))}
        bones = {n: tuple(x + (y - x) * u for x, y in zip(a.get(n, zero), b.get(n, zero))) for n in names}
        out.append({"root": None, "wings": (1.0, 0.0, 0.8), "bones": bones})
    return out


def frames_of(name):
    """Per-frame poses of a library entry (a single-frame pose is one frame)."""
    builders = {"scratch": _scratch, "shake": _shake, "yawn": _yawn, "scramble_up": _scramble_up}
    return builders[name]() if name in builders else _single(name)


def place_root(rig, height, pitch):
    """Pelvis head at `height` above the ground, body pitched `pitch` (+ = nose up) about the pelvis head."""
    b = rig.data.bones["pelvis"]
    pb = rig.pose.bones["pelvis"]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (pitch, 0.0, 0.0)
    pb.location = b.matrix_local.to_3x3().transposed() @ Vector((0.0, 0.0, height - b.head_local.z))


def apply_wings(rig, fold, lift, flare):
    """rig.fold_wings, then the humerus flare (local Z, mirrored per side) and lift (local X): the engine's
    WingController applies the same two rotations after its piecewise fold."""
    R.fold_wings(rig, fold)
    if lift or flare:
        for sfx, s in (("L", 1), ("R", -1)):
            pb = rig.pose.bones[f"wing_humerus_{sfx}"]
            pb.matrix_basis = (pb.matrix_basis @ Matrix.Rotation(-s * math.radians(FLARE_DEG) * flare, 4, "Z")
                               @ Matrix.Rotation(lift + math.radians(FLARE_LIFT_DEG) * flare, 4, "X"))


def apply_pose(rig, pose):
    R.reset_pose(rig)
    apply_wings(rig, *(pose.get("wings") or (1.0, 0.0, 0.0)))
    if pose.get("root"):
        place_root(rig, *pose["root"])
    for name, e in pose["bones"].items():
        pb = rig.pose.bones[name]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = Euler(e, "XYZ")
    bpy.context.view_layer.update()


def keyframe_frames(rig, name, frames):
    """Key every bone at every frame from frame 0 (so the glTF exporter keeps full tracks and the clip starts at
    t = 0); one NLA track per clip."""
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    prev = {}
    for f, pose in enumerate(frames if len(frames) > 1 else frames * 2):
        apply_pose(rig, pose)
        for pb in rig.pose.bones:
            q = pb.matrix_basis.to_quaternion()
            if pb.name in prev and prev[pb.name].dot(q) < 0:
                q.negate()                      # neighbouring keys on one hemisphere: no interpolation flips
            prev[pb.name] = q.copy()
            loc = pb.matrix_basis.to_translation()
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q
            pb.location = loc
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("location", frame=f)
    act.use_fake_user = True
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)             # frame 0 -> glTF time 0: clip time == layer time
    rig.animation_data.action = None
    R.reset_pose(rig)
    return act


def make_library_clips(rig):
    bpy.context.scene.render.fps = FPS
    return [keyframe_frames(rig, name, frames_of(name)) for name in LIBRARY]


def sole_world(rig, key):
    """The rest-pose sole contact of leg `key`, carried by its toes bone into the current pose (Blender space)."""
    kind, side = key.split("_")
    c = A.CONTACTS_L[kind]
    sole = Vector(c["sole"]) if side == "L" else Vector(A.mirror(c["sole"]))
    b = rig.data.bones[f"{c['bone']}_{side}"]
    pb = rig.pose.bones[f"{c['bone']}_{side}"]
    return rig.matrix_world @ (pb.matrix @ (b.matrix_local.inverted() @ sole))


def meta_entries(rig):
    """poses.json entries for the library: META plus duration, loop, wings, root and the soles of owned grounded legs
    (glTF character frame). NLA playback is muted meanwhile (the clips' tracks would override the posed bones)."""
    ad = rig.animation_data
    use_nla = ad.use_nla if ad else None
    if ad:
        ad.use_nla = False
    try:
        return _meta_entries(rig)
    finally:
        if ad:
            ad.use_nla = use_nla


def _meta_entries(rig):
    out = {}
    for name in LIBRARY:
        m = META[name]
        frames = frames_of(name)
        first = frames[0]
        entry = {"mask": m["mask"], "ownsLegs": m["ownsLegs"], "loop": bool(m.get("loop", False)),
                 "blendIn": m["blendIn"], "blendOut": m["blendOut"], "interrupt": m["interrupt"],
                 "duration": round((len(frames) - 1) / FPS, 4) if len(frames) > 1 else 0.0}
        fold, lift, flare = first.get("wings") or (1.0, 0.0, 0.0)
        entry["wings"] = {"fold": fold, "lift": lift, "flare": flare}
        root = m.get("root") or first.get("root")                 # META may place the body for a clip keyed without one
        if m["useRoot"] and root:
            entry["root"] = {"height": root[0], "pitch": root[1]}
        if "look" in m:
            entry["look"] = m["look"]                        # look gain while live: the pose's head stays the pose's
        if m.get("bodyPitch") and first.get("root"):
            entry["bodyPitch"] = first["root"][1]           # the jump pitches the body to this while the pose is live
        for key in ("loopStart", "exit"):
            if key in m:
                entry[key] = round(m[key], 4) if isinstance(m[key], float) else m[key]
        if m["ownsLegs"]:
            apply_pose(rig, first)
            soles = {}
            for key in m["ownsLegs"]:
                p = sole_world(rig, key)
                if p.z < 0.05:                       # grounded owned paws: the engine steps them here before blending in
                    soles[key] = [round(v, 4) for v in A.blender_to_gltf(p)]
            if soles:
                entry["soles"] = soles
            R.reset_pose(rig)
        if m.get("face"):
            entry["face"] = m["face"]
        out[name] = entry
    return out
