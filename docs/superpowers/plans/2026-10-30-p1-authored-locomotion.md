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

1. Prototype: the walk cycle authored and solved in Blender, with playblasts for review. *(Done.)*
2. Polish the walk from review notes; add start and stop transitions and the turn-left and turn-right variants.
   *(Walk polished: one body line, panther carriage. Transitions and turn variants are still open: until then the
   cycles fade out in tight turns.)*
3. Trot and gallop cycles. *(Done. The gallop was iterated on review notes: a bound, a cat's spine, panther flow,
   then one travelling line through the air for the spine and tail, with the wave enlarged for more pounce.)*
4. Bake and export: clips in `toothless.poses.glb` and the `locomotion` block in `poses.json` (v3); schema tests.
   *(Done.)*
5. Engine: the LocomotionDriver. *(Done; see "As built" below.)*
6. Engine: the planner contact schedule from the clips. *(Partly done: the gallop takes its authored duty, while the
   walk and trot keep gait.ts's, which is within 0.05. Swing rebasing and clip leg shapes are deferred; the legs
   stay the planner's and the IK's.)*
7. Gates: all course and M6 scripts green. *(Done: the 19 course scripts also run with the pose library, i.e. with
   authored locomotion on, and pass.)*
8. Review: lab recordings with authored locomotion, then the progress log.

## As built (engine)

- **Layers.** The cycles play as *additive* pose layers on the pelvis, spine, neck, head and tail, ordered under
  the library layers (order −1), so a pose or action overrides the body it shapes. Each layer's weight is its gait's
  weight in the gait engine; its time is the gait phase.
- **Body solver and secondary motion.**
  - The per-frame `rootBob` is added to the pelvis height after the body solver's height spring.
  - The procedural walk/trot bob, gallop rock and gallop spine flex fade out by the authored weight.
  - The tail springs keep their dynamics but lose their static droop and gallop raise.
  - The wing controller takes an unsprung `wingLift`.
- **Fades.** The authored weight fades in with speed and falls within `loco.fallTime` when:
  - he is climbing, scripted, or a pose owns the legs;
  - in a tight turn (yaw rate divided by speed);
  - on twisted ground, i.e. the four supports out of plane (`LH + RF ≠ LF + RH`);
  - his head meets ground ahead (front raise);
  - in the walk and trot, a planted leg nears full reach (contact comes first).
- **Contact robustness** (needed with the cycles on, and kept for the procedural motion too):
  - LegRig: a clamped humerus or femur re-aims the radius or tibia from the real joint position.
  - The ground guard covers swinging paws, backs a paw out of a solid along its swing, and re-solves from the layered
    pose.
  - The planner steps short of an obstacle its arc can't clear within `maxLift`.

## Footfall rhythm (review note: "no natural gait or rhythm to the steps")

**Measured** (a scratch probe that logs every lift-off on the flat course scripts): about 40 % of lift-offs were early,
off the gait schedule. The fore legs ran out of length, stretched to 0.96 with the elbow nearly straight, about a
quarter of a second before their scheduled lift. At the walk they stepped almost twice as often as the hind legs:
every 0.58 s ± 0.17 against 0.87 s. The planner already lands each fore paw at its forward reach limit, so the fore
stance sweep was longer than the fore leg's range at that shoulder height.

**Fixes:**
- **Chest-low carriage** (`loco.crouch`): the cycles hold the shoulders 8 cm lower at the walk and trot, through the
  pitch spring, weighted by the cycle weight. All four legs now step every 0.87 s at the walk, and the trot stays on
  schedule once at speed.
- **Gallop strain:** the joint-margin extrapolation is off in the gallop. At 10 m/s it predicted limits the stride
  never reached and cut a fore stance short every stride. Step intervals now spread ± 0.07–0.10 s, down from up to
  ± 0.37 s.
- **Planted-paw lift:** a planted paw left under its contact by a leg folded to its limit lifts the pelvis and the
  nose in the same step, with a leg re-solve. This is the counterpart of lowering the body for a leg that falls short.
