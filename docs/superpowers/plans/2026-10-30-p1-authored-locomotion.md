# Plan 5 — Authored locomotion (Phase 1, M5 follow-up)

**Why.** The M5/M6 locomotion is fully procedural: the gait engine phases four legs, the foot planner swings each
paw on a parabola and the LegRig bends the chain to reach it. Every metric gate passes, but the motion reads as
robotic. Nothing is authored, swings are piston-like with no paw roll or toe curl, the body stays rigid (no scapula
swing, spine flex or weight shift), there is little overlap, and the timing is uniform.

**What.** Toothless walks, trots and gallops on looping cycles authored from big-cat gait mechanics, built in Blender
and baked into `toothless.poses.glb`. The engine blends the cycles by speed and turn rate and keeps its planner and
IK only to *correct* the authored motion: the paws are pinned to and pressed onto the real terrain, the body follows
slopes. Climbing, scramble, hop, jump and the pose library are unchanged.

**Gates.** All 19 course scripts and 17 M6 scripts stay green under the existing `METRIC_LIMITS`: slip ≤ 1 cm;
penetration, float and proxy ≤ 2 cm; joint limits; no NaN; boundedness. Each cycle is also reviewed visually from
Blender playblasts before it ships, and lab recordings compare it with the procedural motion.

## Reference mechanics (felid)

| Gait   | Footfall                                  | Duty  | Leg offsets (LH, LF, RH, RF) | Cadence   |
|--------|-------------------------------------------|-------|------------------------------|-----------|
| walk   | lateral sequence: LH → LF → RH → RF       | ≈0.68 | 0, 0.25, 0.5, 0.75           | ≈0.9 Hz   |
| trot   | diagonal pairs                            | ≈0.5  | 0, 0.5, 0.5, 0               | ≈1.5 Hz   |
| gallop | rotary, with flexed and extended suspension | ≈0.3 | to be solved against the spine flex | ≈2.2 Hz |

These traits are what separate a cat from a table on legs:

- the scapula swings with the forelimb;
- the carpus folds hard in the front swing, so the paw hangs and then flicks forward;
- the toes peel at lift-off: the heel rises while the toe tip stays planted;
- the paw approaches touchdown already matching the ground's speed;
- the hips roll toward the swinging hind leg, and the spine flexes laterally against the stride;
- the neck absorbs the body bob so the head stays level;
- the tail wave trails the hips.

## Authoring (Blender, `pipeline/blender/toothless/locomotion.py`)

A cycle is blocked the way an animator would block it, as data in a `CYCLES` table:

- **Per limb.** The toe-tip path:
  - in stance it is planted and slides back at the cycle's speed;
  - in swing it follows a hermite arc that leaves at a fraction of ground speed (`peel`), lands matching a fraction
    of it (`land`), and lifts by `lift`.
- **Distal angles.** Keyed angle channels over the leg phase:
  - the metacarpal or metatarsal and the toes, in degrees from straight down toward forward;
  - the scapula, as a hinge angle from bind.
- **Interpolation.** Channels use a cyclic monotone cubic (PCHIP), so held values, such as a planted paw's flat
  toes, stay exactly held.
- **Per body.** Bob, pitch and lean, hip roll, lateral spine flex, chest counter-roll, neck and head steadying, and
  the tail wave, as phased sinusoids.
- **Solve.** For each frame: body first, then for each leg the scapula, a planar two-bone solve (humerus + radius, or
  femur + tibia) to the wrist or hock, and then the distal and toe hinges. Every rotation is about the bone's local X,
  the same model the engine's LegRig uses. Three re-aim passes absorb the legs' slight splay out of the sagittal
  plane, leaving a residual under 1 mm. A limit report flags any hinge outside `anatomy.LIMBS`.
- **Bake.** The result is plain bone rotations in `library.py`'s frame form, baked by `library.keyframe_frames`, so
  the glTF carries no IK. Each clip has `frames + 1` keys, with the last equal to the first, so it loops cleanly.

## Export (`poses.json`, a v3 `locomotion` block)

Each cycle records:

- `speed` (m/s) and `stride` (m, speed × period);
- `period` (s), `duty` and `offsets`;
- per leg, the stance interval in clip phase and the toe-tip path's touchdown and lift-off points in the glTF
  character frame;
- `turn`, for turn variants.

The engine reads gait timing from the clips instead of the `GAITS` table.

## Engine integration (`src/characters/dragon/motion/`)

1. **LocomotionDriver.** It owns cycle playback:
   - gait phase advances at `speed / stride` of the active blend;
   - cycle weights come from speed, with walk↔trot↔gallop crossfades over a speed band;
   - the cycles are phase-aligned, because every clip's phase 0 is LH touchdown;
   - turn variants are blended in by yaw rate.
2. **The pose layer.** The blended cycle replaces the procedural body pose (spine, neck, tail, root height and
   pitch) as the base layer. The body solver adds terrain pitch and roll on top.
3. **The planner.**
   - The contact schedule comes from the blended clip contacts.
   - A stance paw is pinned in the world, as today.
   - A swing paw follows the clip's toe path, rebased so it lands on the predicted foothold on the real ground. The
     rebase spreads the difference between the clip's touchdown point and the planned foothold over the swing.
4. **IK as a correction.** LegRig starts from the clip's leg angles (not bind) and solves only the remaining error.
   It keeps the authored scapula, carpus and toe shapes and still enforces the ground guard and joint limits.
5. **Fallbacks.** The procedural path stays behind a tuning flag for climbing, steep slopes and any unhandled state.
   The cycle weight fades out whenever an action owns the legs.

## Tasks

1. Prototype: the walk cycle authored and solved in Blender, with playblasts for review. *(This PR: done.)*
2. Polish the walk from review notes; add start and stop transitions and the turn-left and turn-right variants.
3. Trot and gallop cycles (gallop: rotary footfall, spine flexion and extension, suspension phase).
4. Bake and export: clips in `toothless.poses.glb` and the `locomotion` block in `poses.json`; schema tests.
5. Engine: the LocomotionDriver and the cycle base layer.
6. Engine: the planner contact schedule and swing rebasing from the clips; IK correction from the clip pose.
7. Gates: all course and M6 scripts green, plus new loco-specific checks (cycle-phase continuity, no pops on gait
   change).
8. Review: lab recordings (cinematic, overlay-free) comparing the authored and procedural motion, then the progress log.
