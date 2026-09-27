# Phase 1 · M6 Behaviours and Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Toothless his authored pose library and the M6 layer over the motion core: personality idles on a sit → lie → sleep posture chain, face and mood, attention, the jump and the plasma blast with its effects. All of it is measured by Motion Lab gates and wired into the Motion Lab and the game page.

**Architecture:**
- **Pose library (Blender).** `pipeline/blender/toothless/library.py` authors the spec §5.11 poses and clips in bone space on Plan 2's rig. It exports them into `toothless.poses.glb`, with explicit metadata in `toothless.poses.json` v2: mask, owned legs, body root, wing state, sole spots, loop/exit, blends, interrupt policy, look gain and face curves. A clay contact sheet is the visual QA.
- **Pose runtime.** `PoseLayerStack` v2 orders its layers (posture < gesture < action), wraps loops and reports leg ownership.
  - `DragonCharacter` hands owned legs from the leg IK to the pose through a tucked leg. It guards posed paws against the ground and blends the body toward the pose's root.
  - A `WingController` is the one writer of Plan 3's merged `wingFold` layer, and adds flare and lift on the humerus.
- **The brain.** `DragonBrain` runs entirely in `DragonCharacter.hooks`:
  - `beforeMove`: behaviours (utility selector, posture chain, gestures with enter/loop/exit), then the actions (`JumpAction`, `PlasmaAction`), then attention (aim > interest > behaviour look).
  - `face`: `FaceController` (mood, blinks, pupils, ears, layer face curves) → `FaceRig` writes the jaw and the ears' mood bias.
  - `applyExpression` copies the face onto the asset's morphs and eye uniforms once per rendered frame.
- **FX.** `PlasmaFx` flies pooled bolts with sphere casts and plays the impact: flash, spark and smoke particles, a scorch decal cut from the local collision triangles, and a camera shake.
- **Pages.** `createToothless()` bundles asset, motion, brain, camera and FX for any page. The Motion Lab gains the M6 scripts; the game page switches over last.

**Tech Stack:** three 0.186.1 (WebGL2), three-mesh-bvh 0.9.15, TypeScript 7 (strict, `verbatimModuleSyntax`), Vitest 5 (`environment: 'node'`), Vite 8, Blender 5.1.2 headless through Plan 2's `pipeline/blender/run.ps1`.

**Spec:** `docs/superpowers/specs/2026-09-26-phase1-vertical-slice-design.md`:
- §5.11 pose library; §5.12 asset QA (the library sheet)
- §6.1 steps 6 and 8; §6.8 look priorities and eyes; §6.9 wing flare; §6.10 pose layers; §6.11 behaviours; §6.12 face and mood; §6.13 actions; §6.15 (the impact shake)
- §8.1 (selector unit tests), §8.2 (lab gates), §9 (M6 exit: "idles and actions pass lab checks"), §12

**Branch, order and dependencies:**
- Executed on `phase1-slice` after Plan 3 (M5) is complete **and** `phase1-toothless` (Plan 2, including its Task 9 look pass) has merged into `phase1-slice`.
- Plan 5a Task 14 also rewrites `src/main.ts`. Task 11 here is last and is written against whichever `main.ts` exists: variant A for Plan 3 Task 16's test-scene page, variant B for Plan 5a Task 14's Cove page.
- Plan 5b's interest points (fish, butterflies) reach the brain through `createToothless({ interest: [cove.interestPoints] })` (Task 11, variant B).
- Tasks run in order. Tasks 3–10 each need the ones before them; Task 1 and Task 2 are independent of each other.

**Pre-validated while planning** (scratch harness in the session scratchpad):
- **Engine baseline:** `phase1-slice` at `eb45db5` (Plan 3 Tasks 1–11 as committed) + Plan 3's plan text for Tasks 12–16 with its Rulings 3 and 12 applied + Plan 2 Task 8's committed engine files (`phase1-toothless` at `cbc7637`).
- Every file and every find/replace edit in this plan was applied to that baseline by script. Results:
  - `tsc` clean.
  - `npm test`: 391 pass, 15 fail. The 15 are Plan 3's own course-script gaps (fixture: ramp30, side-slope, steps-small, steps-large; real rig: those plus ramp45, ramp60, ledge-scramble, ledge-blocked, boulders, corners, idle-turn-60s). They fail identically without this plan; Plan 3's Task 15 tuning owns them.
  - The M6 gate (`tests/lab/m6.test.ts`, 17 scripts × fixture rig and exported rig) and the jump and plasma suites: **43/43 pass**, every §8.2 metric.
- **Blender:** Task 2's pipeline ran end to end on Plan 2's Task 8 build.
  - 52 pipeline tests pass (Plan 2's suite as of Task 8 plus the 9 library tests).
  - Export: `toothless.poses.glb` ≈ 2.1 MB, 23 clips, every clip with full tracks for all 101 bones.
  - The clay contact sheet was reviewed pose by pose.
- **Browser** (`?q=low`, Iris Xe), game page and Motion Lab page:
  - The console was clean: every shader compiled, including the FX, the eye gaze and the scorch.
  - Checked visually: the jump, the plasma bolt → impact → scorch → shake, sit/lie/sleep, and the eye gaze direction (left/right/up, see Task 4).
  - The browser runs found three bugs, fixed in this plan: the camera collapsing into him when he lies down (Task 1), a scorch alpha map that drew a dark square (Task 8), and his eyes staying open asleep (Task 2).

**Not validated while planning — each task says where:**
- Plan 2's look pass (its Task 9) re-sculpts the mesh after the library was authored. Task 2's mesh-contact tests may need small retunes of pose data; Task 2 Step 6 gives the procedure.
- Plan 3 Tasks 12–16 were not committed while planning. Their anchors come from the plan text plus Rulings 3 and 12; see "Editing Plan 2/3 files".
- `?q=high` (N8AO on) with the FX on screen was not checked (Low only); Task 10 Step 8 and Task 11 Step 4 check it.
- Task 11 variant B (the Cove page) was not run, because the Cove did not exist yet.

## Global Constraints

From the spec (verbatim):
- §3.4: "Simulation advances in **fixed 1/120 s steps** (accumulator, max 8 steps per frame)."
- §3.4: "Every simulation module exposes `update(dt)` and depends only on its inputs, so the Motion Lab can step the world frame-by-frame with no `requestAnimationFrame` (immune to the throttled-background-tab problem)."
- §3.4: "Every procedural layer computes **absolute** local bone rotations from rest plus layers each step — no relative per-frame rotation is ever accumulated (the old "spinning" bug class)."
- §5.11: "`poses.json` gives each one its bone mask, loop flag, blend-in/out times and interrupt policy. Blender's glTF exporter strips constant tracks, so masks are **explicit metadata**; the engine never infers a mask from which tracks survived export."
- §6.2: "Space: jump. Left click or F: plasma. (Never bind Ctrl: Ctrl+W closes the browser tab even under pointer lock.)"
- §6.10: "Transitions: every behaviour has enter / loop / exit phases; interrupts play the exit (he gets up from lying rather than snapping to standing)."
- §6.11: "Any input interrupts with the behaviour's exit transition. `berk.behaviour(name)` forces one for testing."
- §6.16: "All motion constants live in one typed config with lil-gui panels in the Motion Lab; tuned presets are saved as JSON and committed."
- §8.2: "Pass criteria per run: planted-foot slip ≤ 1 cm; paw penetration ≤ 2 cm; planted-paw float ≤ 2 cm; no collision-proxy penetration; joint limits never exceeded; no NaN; bone rotations bounded over 60 s loops (the spin-bug check)."
- §4.2: "Bloom only on values above ~1.0 HDR (eyes, plasma, sun glints, fire) — never a full-frame haze."
- §4.6: "Transparent effects (plasma, particles, motes, smoke) render after AO and never go through its depth/normal prepass (the bug that forced GTAO's removal)."
- §3.6: "**Blender hygiene** (mandatory, from the old project): collections by purpose, helpers deleted immediately, orphans purged before every save, every datablock named, one concern per file, multi-angle + numeric verification before any diagnosis, pre-export checklist (apply transforms/modifiers, recalculate normals outward, purge)."
- §12: "Size-cap and distance-fade particles (the "snow" motes)"

Plan rules (every task):
- World frame (Plan 3): metres, +Y up. The dragon faces +Z at bind and his left is +X. Heading ψ means forward = (sin ψ, 0, cos ψ).
- Randomness comes only from `mulberry32` (`src/core/rng.ts`). No simulation code reads `Math.random`, `Date` or `performance.now`. Every M6 module takes a seed, so runs are repeatable.
- Motion constants live in `motion/tuning.ts`. Plan 3's Ruling 14 applies: numerical-method internals may stay as commented local literals. Visual FX constants live in the `FX` table of `src/fx/plasmaFx.ts`.
- Pose data lives in `library.py` and reaches the engine only through `poses.json`. The engine hard-codes no bone angle.
- Gates are gates. Never loosen a §8.2 threshold, a test tolerance or a mesh-contact bound. Tune the pose data, `tuning.ts` or the code instead.
- Simulation code allocates nothing per step: reuse module-level scratch vectors, as Plan 3 does.
- Shader changes go through `addCompileHook` only (Plan 1). Every lit scene material goes through `app.materials.prepare`.
- Commits:
  - One per task (fix rounds add commits).
  - Write the message to a file with the Write tool, then run `git commit -F <msgfile> -- <paths>` with explicit paths. Never use `git add -A`.
  - End the message with your own model-accurate `Co-Authored-By:` trailer.

---

## Editing Plan 2/3 files

Tasks 1, 3, 4, 6, 7, 8, 9 and 10 change files that Plan 3 owns; Task 4 also changes Plan 2's `materials.ts`. Every such change is a numbered **Find / Replace with** pair:
- **Where the Find texts come from:**
  - For files committed while planning, the Find text is the committed code:
    - Plan 3 at `eb45db5`: `collision.ts`, `tuning.ts`, `rigTypes.ts`, `bodySolver.ts`, `footPlanner.ts`, `look.ts`, `secondary.ts`.
    - Plan 2's `materials.ts` at `cbc7637`.
  - For Plan 3 Tasks 12–16, which were not committed yet, it is Plan 3's plan text with its Rulings 3 and 12. Those files are `dragon.ts`, `climbing.ts`, `metrics.ts`, `orbitCamera.ts`, `labRunner.ts` and `dev/lab/main.ts`. Edits that follow a Ruling-3 line carry a note.
- Apply a task's edits in their numbered order: a later edit may find text an earlier one wrote.
- If a Find text does not match exactly (a review fix renamed or reflowed it), apply the same change to the equivalent code and list the deviation in your report. Never skip an edit.
- To locate an edit, `rg -n` a distinctive line of its Find text.

## File Structure

| Path | Task | Responsibility |
|---|---|---|
| `src/world/collision.ts`, `src/camera/orbitCamera.ts` (modify) | 1 | a cast's start test and the camera's push-in test use real contacts |
| `pipeline/blender/toothless/library.py` | 2 | the pose library: pose data, clip builders, metadata, keyframing, sole/QA helpers |
| `pipeline/blender/toothless/{poses,export,qa,build}.py` (modify) | 2 | library clips in the poses GLB, `poses.json` v2, the clay contact sheet |
| `pipeline/blender/tests/test_library.py` | 2 | Blender tests: limits, symmetry, clips, metadata, ground contact |
| `tests/assets/toothless.test.ts` (modify) | 2 | the library ships full-track clips |
| `public/assets/characters/toothless/*` | 2 | re-exported poses GLB, `poses.json` v2 and `rig.json` |
| `docs/progress/img/toothless/library_sheet.jpg` | 2 | the committed clay contact sheet |
| `src/characters/dragon/motion/poseLayers.ts` (replace) | 3 | `poses.json` v2, ordered layers, loops, leg ownership, `withFoldClip` |
| `src/characters/dragon/motion/wings.ts` | 3 | `WingController`: fold (through `wingFold`), flare, lift |
| `src/characters/dragon/motion/{tuning,bodySolver,footPlanner,metrics,secondary,dragon,climbing}.ts` (modify) | 3 | M6 tuning sections; pose placement; posed paws; metrics; breathing gain; leg ownership; wing demands |
| `tests/fixtures/toothlessAsset.ts`, `tests/motion/poseLibrary.test.ts` | 3 | the exported library in node; pose runtime tests |
| `src/characters/dragon/face/{face,faceRig,expression}.ts` | 4 | mood, blinks, pupils, ears, face curves; jaw and ear bias; the per-frame binder |
| `src/characters/dragon/materials.ts`, `motion/{rigTypes,secondary}.ts` (modify) | 4 | the eye-gaze uniform; `MotionRig.jaw`; `SecondaryMotion.earBias` |
| `src/characters/dragon/behaviour/attention.ts` | 5 | interest points and who he looks at |
| `src/characters/dragon/behaviour/{selector,behaviours,brain}.ts`, `motion/look.ts` (modify) | 6 | utility selector, posture chain, gestures, the brain; look gain and hysteresis |
| `src/characters/dragon/actions/jump.ts`, `motion/climbing.ts` (modify) | 7 | the jump; climbing stands aside in flight |
| `src/characters/dragon/actions/plasma.ts`, `src/fx/{particles,plasmaFx}.ts`, `src/characters/dragon/toothlessBrain.ts`, `src/camera/orbitCamera.ts` (modify) | 8 | the plasma action, bolts and impacts, the brain factory, the shake |
| `src/characters/dragon/motion/climbing.ts` (modify), `tests/motion/scramblePolish.test.ts` | 9 | climb reach and the scramble-up choreography (the M5 hand-off) |
| `src/dev/lab/m6Scripts.ts`, `src/dev/lab/{labRunner,main}.ts` (modify), `tests/lab/m6.test.ts` | 10 | the M6 lab gate; the Motion Lab page |
| `src/characters/dragon/toothless.ts`, `src/main.ts` (modify) | 11 | Toothless on a page; the game page |
| `tests/{characters/face,behaviour/*,actions/*,fx/plasmaFx}.test.ts` | 4–8 | per-task tests |

---

### Task 1: Collision proximity — a cast's start test and the camera use real contacts

**Model:** haiku (transcription).

**Why:** three-mesh-bvh's `closestPointToPoint(p, target, 0, maxDist)` prunes BVH *boxes* beyond `maxDist`, but it returns the nearest triangle of the boxes it visits, even when that triangle is farther than `maxDist`.
- `CollisionWorld.sphereCast` treats any hit returned at its start point as "starting inside", so a cast that starts inside a far surface's bounds returns 0.
- In the browser, the orbit camera fell into Toothless as soon as he lay down: the chest target sank into a ground leaf's bounds. The dither fade then hid him completely.
- A plasma bolt can die at the mouth the same way.
- `sphereContact` already classifies correctly: depth > 0 only for a real overlap, or for a centre behind a face.

If Plan 3 has already taken this fix (`rg -n "sphereContact\(from" src/world/collision.ts` finds it), keep Plan 3's version, still add both tests and make sure they pass.

**Files:**
- Modify: `src/world/collision.ts` (Plan 3 Task 4), `src/camera/orbitCamera.ts` (Plan 3 Task 13)
- Test: `tests/world/collision.test.ts`, `tests/camera/orbitCamera.test.ts`

**Interfaces:**
- Consumes (Plan 3):
  - `CollisionWorld.sphereContact(center: THREE.Vector3, radius: number, out?: SphereContact): SphereContact | null`
  - `SphereContact { point; normal; depth }`
  - `OrbitCamera.update(input, follow, dt)`
- Produces: no API change. `sphereCast(from, to, radius)` returns 0 only for a real start contact. The camera pulls in only when the camera sphere really touches geometry.

- [ ] **Step 1: Write the failing tests**

**Edit 1.T1 — `tests/world/collision.test.ts`**

Find:
```ts
  it('returns 0 when starting inside collision', () => {
```
Replace with:
```ts
  it('is not stopped at its start by a surface farther away than its radius (the start inside that surface bounds)', () => {
    // one sloped triangle: its bounding box holds the start, the triangle itself is 2.1 m away and the path leads off it
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-5, 0, 0, 5, 0, 0, 0, 5, 5], 3));
    const w = CollisionWorld.fromObjects([new THREE.Mesh(g)]);
    expect(w.sphereCast(V(0, 1, 4), V(0, 1, 10), 0.3)).toBe(1);
  });

  it('returns 0 when starting inside collision', () => {
```

**Edit 1.T2 — `tests/world/collision.test.ts`**

Find:
```ts
import { flatWorld, rampWorld, wallWorld, cornerWorld } from '../fixtures/worlds';
```
Replace with:
```ts
import { CollisionWorld } from '../../src/world/collision';
import { flatWorld, rampWorld, wallWorld, cornerWorld } from '../fixtures/worlds';
```

**Edit 1.T3 — `tests/camera/orbitCamera.test.ts`**

Find:
```ts
  it('eases back out slowly when the obstacle is gone', () => {
```
Replace with:
```ts
  it('keeps its distance when its target sits inside a big surface bounds but well clear of it (he lies down)', () => {
    // one big sloped triangle whose bounding box holds the whole camera arm; the surface itself is 13+ m away
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([50, 0, 0, -50, 0, 0, 0, 50, -50], 3));
    const c = new OrbitCamera(T, CollisionWorld.fromObjects([new THREE.Mesh(g)]));
    const f = follow({ chest: new THREE.Vector3(0, 1, -20) });
    c.reset(f);
    settle(c, f, 1);
    expect(c.currentDistance).toBeCloseTo(T.distance, 3);
  });
  it('eases back out slowly when the obstacle is gone', () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/world/collision.test.ts tests/camera/orbitCamera.test.ts`
Expected: the two new tests FAIL (`expected 0 to be 1`; `expected 0 to be close to 8`). The rest pass.

- [ ] **Step 3: Implement**

**Edit 1.1 — `src/world/collision.ts`**

Find:
```ts
    if (this.closestPoint(from, radius, this.scratchSurface)) return 0;
```
Replace with:
```ts
    // a real contact only: closestPoint can return a triangle beyond maxDist (three-mesh-bvh prunes boxes, not
    // triangles), which stopped every cast that started inside a far surface's bounds (the camera fell into him)
    if (this.sphereContact(from, radius, this.scratchContact)) return 0;
```

**Edit 1.2 — `src/camera/orbitCamera.ts`**

Find:
```ts
    for (let k = 0; k < 10 && this.world.closestPoint(this.position, t.radius * 0.5); k++) {
```
Replace with:
```ts
    for (let k = 0; k < 10 && this.world.sphereContact(this.position, t.radius * 0.5, _contact); k++) {
```

**Edit 1.3 — `src/camera/orbitCamera.ts`**

Find:
```ts
import type { CollisionWorld } from '../world/collision';
```
Replace with:
```ts
import type { CollisionWorld, SphereContact } from '../world/collision';
```

**Edit 1.4 — `src/camera/orbitCamera.ts`**

Find:
```ts
const _goal = new THREE.Vector3();
```
Replace with:
```ts
const _goal = new THREE.Vector3();
const _contact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/world/collision.test.ts tests/camera/orbitCamera.test.ts` → all pass. Then `npm run typecheck` → clean, and `npm test` → no suite that passed before fails now.

- [ ] **Step 5: Commit** — `src/world/collision.ts`, `src/camera/orbitCamera.ts` and the two test files. Message: `fix(world): a sphere cast's start and the camera push-in test real contacts (the camera no longer falls into him when he lies down)`.

---

### Task 2: The pose library in Blender

**Model:** opus (Blender pose authoring with visual QA).

**Needs:** Plan 2 complete, including its look pass (Plan 2 Task 9). Pose data is bone-local, so a re-sculpt keeps it valid. The mesh-contact tests re-check the ground contact on the new mesh.

**How the library is built** (read `library.py`'s docstrings for detail):
- **Poses.** A pose is bone-local XYZ Euler rotations (radians) from bind, plus:
  - `root` = (pelvis-head height above the ground, body pitch): the engine's body solver blends the body there.
  - `wings` = (fold 0…1, lift rad, flare 0…1), applied after `rig.fold_wings`.
- **Single-frame poses:** sit, lie, sleep, stretch, sniff, stalk, jump crouch/launch/tuck/land, plasma rear-up, climb reach, scramble hook.
- **Clips**, built by the `_scratch`, `_shake`, `_yawn` and `_scramble_up` builders:
  - `scratch`: a 12-frame intro from the sit (lift the hind paw, reach), then two strokes that loop on frames 12–28. Its exit plays the clip *backwards* to its first frame, which is the sit pose beneath it.
  - `shake` (1.2 s, a lowered root and a roll oscillation), `yawn` (2.4 s), `scramble_up` (0.9 s, reach → hook → pull-over → settle).
- **Keying.** Clips are keyed from frame 0 at 30 fps. The exporter's forced sampling keeps full tracks for every bone.
- **Metadata** (`META`, exported by `meta_entries`):
  - body parts: `mask`, `ownsLegs`, `root` (only if `useRoot`), `bodyPitch` (airborne poses, read by the jump)
  - blending: `blendIn`, `blendOut`, `interrupt`, `loop`, `loopStart`, `exit`
  - look and face: `look` (the head-look gain while the layer is live), `face` curves
  - derived when exported: `duration`, `wings`, and `soles` (owned paws' sole spots in the character frame)
- **Face curves.** Posture layers (sit, lie, sleep) hold time 0, so their face curves are constants blended in by the hop weight. Sleep's `blink: [[0, 1]]` closes his eyes as he curls up.
- **Masks.** Every mask is explicit, and none includes `pelvis` (the body solver owns the root bone).

**Files:**
- Create: `pipeline/blender/toothless/library.py`, `pipeline/blender/tests/test_library.py`
- Modify: `pipeline/blender/toothless/{poses,export,qa,build}.py`, `tests/assets/toothless.test.ts`
- Output (committed): `public/assets/characters/toothless/{toothless.poses.glb,toothless.poses.json,toothless.rig.json}` (and `toothless.glb`, which should come out byte-identical), `docs/progress/img/toothless/library_sheet.jpg`

**Interfaces:**
- Consumes (Plan 2):
  - `anatomy.{CONTACTS_L, mirror, blender_to_gltf}` (library); `anatomy.{LIMBS, CHAIN_LIMITS, PROXIES}` (tests)
  - `rig.fold_wings(rig, f)`, `rig.reset_pose(rig)`
  - `qa_render.{setup_clay, shoot, _load, _resize}`, `scene.{collection, move_to, reset}`
  - `poses.make_clips`, `export.{POSES, write_all}`, `build.stage_export` (each edited below)
- Produces:
  - `library.py`: `FPS = 30`, `FLARE_DEG = 25.0`, `FLARE_LIFT_DEG = 8.0`, `LEG_KEYS`, `POSES`, `META`, `LIBRARY`, `SCRATCH_LOOP_START`
  - `library.py` functions: `frames_of(name) → list[pose]`, `apply_pose(rig, pose)`, `make_library_clips(rig) → list[bpy.types.Action]`, `sole_world(rig, key) → Vector`, `meta_entries(rig) → dict`
  - `LIBRARY` is 17 clips: `sit lie sleep stretch sniff stalk jump_crouch jump_launch jump_tuck jump_land plasma_rear climb_reach scramble_hook scratch shake yawn scramble_up`
  - `export.poses_json(rig) → {"version": 2, "wingFlare": {"deg", "liftDeg"}, "clips": {...}}`
  - **The `poses.json` v2 contract** (read by Task 3's `parsePosesMeta`), per clip:
    - body: `mask`, `ownsLegs[]`, `root {height, pitch}`?, `bodyPitch`?
    - blending: `blendIn`, `blendOut`, `interrupt` (`exit` | `finish` | `none`), `loop`, `loopStart`?, `exit` (`reverse`)?
    - look and face: `look`?, `face {channel: [[t, value], …]}`?
    - derived: `duration`, `wings {fold, lift, flare}`, `soles {leg: [x, y, z]}`?

- [ ] **Step 1: Write the failing Blender tests**

`pipeline/blender/tests/test_library.py`:
```python
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run blender:test`
Expected: FAIL — `ModuleNotFoundError: No module named 'library'` (test_library). Plan 2's tests still pass.

- [ ] **Step 3: Create the library**

`pipeline/blender/toothless/library.py`:
```python
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
        "root": (0.388, -0.004),
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
```

- [ ] **Step 4: Put the library into the pipeline** — the poses GLB, `poses.json` v2 and the contact sheet

**Edit 2.P1 — `pipeline/blender/toothless/poses.py`**

Find:
```python
import bpy
import rig as R
```
Replace with:
```python
import bpy
import library as LIB
import rig as R
```

**Edit 2.P2 — `pipeline/blender/toothless/poses.py`**

Find:
```python
def make_clips(rig):
    return [keyframe_pose(rig, name, setter) for name, setter in CLIPS.items()]
```
Replace with:
```python
def make_clips(rig):
    """Plan 2's clips, then the pose library (spec §5.11); every clip is sampled at LIB.FPS."""
    bpy.context.scene.render.fps = LIB.FPS
    return [keyframe_pose(rig, name, setter) for name, setter in CLIPS.items()] + LIB.make_library_clips(rig)
```

**Edit 2.P3 — `pipeline/blender/toothless/export.py`**

Find:
```python
import bpy
import anatomy as A
```
Replace with:
```python
import bpy
import anatomy as A
import library as LIB
```

**Edit 2.P4 — `pipeline/blender/toothless/export.py`**

Find:
```python
        "clips": ["bind", "wings_fold_25", "wings_half", "wings_fold_75", "wings_folded", "jaw_open"],
```
Replace with:
```python
        "clips": ["bind", "wings_fold_25", "wings_half", "wings_fold_75", "wings_folded", "jaw_open", *LIB.LIBRARY],
```

**Edit 2.P5 — `pipeline/blender/toothless/export.py`**

Find:
```python
def write_all(rig, mesh, out_dir):
```
Replace with:
```python
def poses_json(rig):
    """toothless.poses.json v2: Plan 2's clip masks plus the library metadata (masks, ownsLegs, root, wings, soles,
    loop, blends, interrupt, duration, face curves), and the wing flare the engine's WingController applies."""
    return {"version": 2, "wingFlare": {"deg": LIB.FLARE_DEG, "liftDeg": LIB.FLARE_LIFT_DEG},
            "clips": {**POSES["clips"], **LIB.meta_entries(rig)}}


def write_all(rig, mesh, out_dir):
```

**Edit 2.P6 — `pipeline/blender/toothless/export.py`**

Find:
```python
        json.dump(POSES, f, indent=1)
```
Replace with:
```python
        json.dump(poses_json(rig), f, indent=1)
```

**Edit 2.P7 — `pipeline/blender/toothless/build.py`**

Find:
```python
    body.name = body.data.name = "Toothless"
    PO.make_clips(rig)
```
Replace with:
```python
    body.name = body.data.name = "Toothless"
    QR.setup_clay(bpy.context.scene)
    qa.library_renders(bpy.context.scene, rig, os.path.join(BUILD, "qa_library"), os.path.join(QA_DIR, "library_sheet.jpg"))
    PO.make_clips(rig)                     # after the renders: the clips' NLA tracks would override the posed bones
```

**Edit 2.P8 — `pipeline/blender/toothless/qa.py`**: append at the end of the file:
```python
LIBRARY_VIEWS = {"side": dict(loc=(8.5, 0.9, 1.0), target=(0, 0.9, 0.7), ortho=7.6),
                 "tq": dict(loc=(-4.6, -5.4, 2.4), target=(0, 0.4, 0.7), lens=32)}


def library_renders(sc, rig, frames_dir, sheet_path):
    """Clay contact sheet of the pose library (spec 5.12): side + three-quarter view of every pose (clips at their middle
    frame) on a ground plane. The single views go to frames_dir (build output); the stacked half-size JPEG sheet to
    sheet_path (committed)."""
    import bpy
    import numpy as np
    import library as LIB
    import rig as R
    import scene as SC
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 1.0, 0))
    ground = bpy.context.active_object
    ground.name = ground.data.name = "QA_Ground"
    SC.move_to(ground, SC.collection("00_Studio"))
    mat = bpy.data.materials.new("QA_GroundMat")
    mat.diffuse_color = (0.32, 0.34, 0.3, 1.0)
    ground.data.materials.append(mat)
    rows = []
    try:
        for name in LIB.LIBRARY:
            frames = LIB.frames_of(name)
            LIB.apply_pose(rig, frames[len(frames) // 2])
            views = [QR.shoot(sc, frames_dir, f"library_{name}_{v}", res=(640, 420), **kw) for v, kw in LIBRARY_VIEWS.items()]
            a, b = (QR._resize(QR._load(p), 240) for p in views)
            rows.append(np.concatenate([a, np.ones((a.shape[0], 4, 4), np.float32), b], axis=1))
    finally:
        R.reset_pose(rig)
        mesh = ground.data
        bpy.data.objects.remove(ground)
        bpy.data.meshes.remove(mesh)
        bpy.data.materials.remove(mat)
    gap = np.ones((4, rows[0].shape[1], 4), np.float32)
    sheet = np.concatenate([np.concatenate([r, gap], axis=0) for r in rows[::-1]], axis=0)   # images are stored bottom-up
    img = bpy.data.images.new("library_sheet", sheet.shape[1], sheet.shape[0], alpha=True)
    img.pixels = sheet.ravel()
    img.filepath_raw = sheet_path
    img.file_format = "JPEG"                         # a committed QA image: JPEG keeps the repo light
    img.save(quality=88)
    bpy.data.images.remove(img)
    return sheet_path
```

- [ ] **Step 5: Export**
  - If `pipeline/blender/build/toothless_assembled.blend` is missing, run `npm run toothless:build` (every stage, several minutes).
  - Otherwise run only the export stage: `powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/toothless/build.py --stage export`
  - Expected: `GLB bytes …` ≤ 6 MB.
  - `toothless.poses.glb` ≈ 2.1 MB with 23 clips; `toothless.poses.json` has `"version": 2`; `docs/progress/img/toothless/library_sheet.jpg` is written (≈ 0.25 MB).
  - `git diff --stat public/assets/characters/toothless/toothless.glb` should show no change: Plan 2's builds are byte-identical. If it changed, stop and report.

- [ ] **Step 6: Run the Blender tests to verify they pass**

Run: `npm run blender:test` → every test passes: Plan 2's plus the 9 library tests. `LibraryPoseTests` needs `toothless_assembled.blend` from Step 5 and must not be skipped.

If a mesh-contact test fails, retune the pose data — never a bound. Plan 2's look pass may have moved the skin by a centimetre or two:
- `test_grounded_poses_rest_on_the_ground_without_sinking` names the pose and its lowest skin height. Raise that pose's `root[0]` by the shortfall plus about 1 cm (lowest −0.05 m against the −0.035 bound → raise the root ~0.025 m), and keep the owned paws on the ground (next item).
- `test_owned_grounded_paws_touch_the_ground` names the pose, the paw and its sole height. Adjust that leg's distal bones (`*_metatarsal_*` / `*_toes_*` for hind, `*_metacarpal_*` / `*_toes_*` for front) by a few hundredths of a radian about X, or the root height.
- `test_body_proxies_stay_above_the_ground` names the pose and proxy: raise the root or pitch the body away (`root[1]`, `spine_*`).
- Mirror every change to the `_R` bones (`test_symmetric_poses_mirror_left_and_right`), re-run, then re-export (Step 5) and look at the sheet again (Step 7).

- [ ] **Step 7: Visual QA — read the contact sheet**
  - Read `docs/progress/img/toothless/library_sheet.jpg`: side and three-quarter per pose, top to bottom in `LIBRARY` order. For detail, read `pipeline/blender/build/qa_library/library_<pose>_<view>.png`.
  - Check every pose:
    - grounded poses rest on the ground plane: no floating, no buried paws
    - legs bend the right way (knees forward, elbows back); no limb through the body
    - the wings stay folded along the back (lifted and flared only where `wings` says so), without ribs through the body or the legs
    - sit reads as a cat-like sit; lie is sphinx-like; sleep is curled with the tail around; stretch is a play-bow
    - the jump poses read as crouch → extension → tucked → front-feet-first reach; plasma rear-up has the head up and the jaw toward the target
    - the clips' middle frames: scratch (hind paw at the ear), shake (spine rolled), yawn (head up), scramble-up (pulling over)
  - Fix in `library.py`, re-export and re-read until every pose passes. Record anything you changed in the report.

- [ ] **Step 8: The asset test**

**Edit 2.T1 — `tests/assets/toothless.test.ts`**

Find:
```ts
describe('toothless.rig.json', () => {
```
Replace with:
```ts
describe('toothless.poses.glb — the M6 pose library (spec §5.11)', () => {
  const LIBRARY = ['sit', 'lie', 'sleep', 'stretch', 'sniff', 'stalk', 'jump_crouch', 'jump_launch', 'jump_tuck', 'jump_land',
    'plasma_rear', 'climb_reach', 'scramble_hook', 'scratch', 'shake', 'yawn', 'scramble_up'];
  const LENGTH: Record<string, number> = { scratch: 28 / 30, shake: 36 / 30, yawn: 72 / 30, scramble_up: 27 / 30 };
  it('keeps full tracks for every bone, keyed from t = 0 at 30 fps', () => {
    for (const c of LIBRARY) {
      const anim = poses.animations.find((a: any) => a.name === c);
      expect(anim, c).toBeTruthy();
      const nodes = new Set(anim.channels.filter((ch: any) => ch.target.path === 'rotation').map((ch: any) => ch.target.node));
      expect(nodes.size, c).toBe(101);
      const times = poses.accessors[anim.samplers[anim.channels[0].sampler].input];
      expect(times.min[0], c).toBeCloseTo(0, 6);
      expect(times.max[0], c).toBeCloseTo(LENGTH[c] ?? 1 / 30, 4);        // a single pose: two keys, frames 0 and 1
    }
  });
});

describe('toothless.rig.json', () => {
```

Run: `npm test -- tests/assets` → all pass, including the new library test. Then run `npm test`: no suite that passed before fails now. The engine still loads: Plan 3's parser ignores the new metadata fields until Task 3.

- [ ] **Step 9: Commit**
  - Include `pipeline/blender/toothless/{library,poses,export,qa,build}.py`, `pipeline/blender/tests/test_library.py` and `tests/assets/toothless.test.ts`.
  - Include the re-exported `public/assets/characters/toothless/*` and `docs/progress/img/toothless/library_sheet.jpg`.
  - Message: `feat(toothless): the pose library — 13 poses and 4 clips with poses.json v2 metadata, clay contact sheet`.

---

### Task 3: The pose runtime — layers v2, leg ownership, body placement, wings

**Model:** opus (cross-module integration into Plan 3's `DragonCharacter`).

**What changes and why:**
- **`PoseLayerStack` v2.** This replaces Plan 3 Task 10's file and keeps `withFoldClip` (now carrying every `poses.json` field, not just `clips`).
  - Layers apply by `order` (posture 0.1–0.3 < gesture 1 < scramble 2), then by first use, so a posture hop is always slerp(shallower, deeper, w).
  - Looping clips wrap into `[loopStart, duration)`.
  - `active()` exposes the live layers without allocating; `legOwnership()` reports how strongly layers drive each leg.
- **Owned legs.** `DragonCharacter` saves the layered pose of every owned leg, runs Plan 3's leg IK, then blends IK → pose by the ownership weight.
  - The blend passes **through the tucked leg** of `jump_tuck` (IK → tuck for w < ½, tuck → pose above), so a paw lifts and re-places instead of sweeping through the ground.
  - A ground guard re-solves any posed paw that ends below the ground: in full at 2 cm (`pose.groundGuard`).
  - The planner leaves posed paws alone (`PawState.posed`), and the metrics skip slip and float for them. Penetration still applies.
- **Body placement.** Layers with a `root` blend the body solver's height and pitch targets to the weighted pose root (`BodySolver.posture`). A scripted `override` may `snap` the height (the jump's ballistic arc).
- **Wings.** The `WingController` computes fold, lift and flare targets from the live layers' `wings` metadata and from named demands, and eases them through critically damped springs.
  - It is the only writer of Plan 3's merged `wingFold` layer (Plan 3 Ruling 3: time = fold, so the fold only ever slerps between neighbouring samples).
  - After the layers, it post-multiplies flare and lift on each humerus.
  - Climbing's "wings open ~20 %" (spec §6.6) becomes a flare of the folded wing (`wings.climbFlare`). Unfolding to 0.8 stood the doubled ribs up vertically.
  - `climb.wingsOpen` is removed.
- **Metrics.** Boundedness is measured from each bone's pose at the start of the run instead of from bind. The folded wing's ribs sit ~170° from bind for the whole run — a held pose, not a spin — and read as unbounded otherwise.
- **Breathing** is halved while the front legs are posed (lying, sleeping), so the posed paws don't float.
- **Tuning.** The M6 tuning sections are added here for Tasks 4–10.

**Files:**
- Replace: `src/characters/dragon/motion/poseLayers.ts`
- Create: `src/characters/dragon/motion/wings.ts`, `tests/fixtures/toothlessAsset.ts`, `tests/motion/poseLibrary.test.ts`
- Modify: `src/characters/dragon/motion/{tuning,bodySolver,footPlanner,metrics,secondary,dragon,climbing}.ts`

**Interfaces:**
- Consumes:
  - Plan 3: `RigSkeleton` (`localQuat`, `bindLocalQuat`, `names`, `id`, `fk`)
  - Plan 3 `DragonCharacter`: `legs.{legs[i].bones, solve, soleWorld, stretch, shortfall, margin}`, `planner.paws`, `body`, `secondary`, `kin`, `world`, `tuning`, `hooks`
  - Plan 3: `withFoldClip` and the `wingFold` layer (Ruling 3), `MotionMetrics`
  - Task 2: `poses.json` v2 and the library clips
- Produces:
  - `poseLayers.ts`:
    - metadata: `PoseClipMeta` (+ `ownsLegs, root, look, bodyPitch, wings, soles, duration, loopStart, exit, face`), `PosesMeta { version?, wingFlare?, clips }`, `FaceCurve`
    - `parsePosesMeta`, `loadPosesMeta`, `maskBones`, `loopTime(meta, duration, t)`, `sampleCurve(curve, t)`, `ClipPose`
    - `ActiveLayer { name; weight; time; meta }`
    - `PoseLayerStack.{has, meta(name), set(name, weight, time = 0, additive = false, order = 0), weight(name), active(), legOwnership(out), apply(s)}`
    - `withFoldClip(clips, meta, foldClips, name = 'wingFold')`
  - `wings.ts`: `WingState { fold; lift; flare }`; `new WingController(rig, skeleton, layers, posesMeta, tuning.wings)` with `state`, `target`, `available`, `demand(source, state | null, weight = 1)`, `settle()`, `update(dt)` (before `layers.apply`), `apply(s)` (after)
  - `MotionTuning`:
    - new sections: `wings`, `pose`, `face`, `behaviour`, `jump`, `plasma`, `attention` (defaults in `DEFAULT_TUNING`)
    - `climb.wingsOpen` removed
  - `BodySolver.override.snap: boolean`, `BodySolver.posture { weight; height; pitch }`
  - `PawState.posed`; `SecondaryMotion.breathGain`
  - `DragonCharacter`: `wings`, `own: number[4]`, `cameraPos`, `headPos(out)`, `DragonOptions.legTuckClip` (default `'jump_tuck'`)
  - `ClimbController` demands `wings.demand('climb', { flare })`
  - `tests/fixtures/toothlessAsset.ts`: `HAS_LIBRARY`, `loadToothlessMotion() → { rig, clips, posesMeta }`

- [ ] **Step 1: Write the failing tests**

`tests/fixtures/toothlessAsset.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parsePosesMeta, type PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';

const DIR = 'public/assets/characters/toothless/';

/** The exported asset with the M6 pose library (poses.json v2) is present. */
export const HAS_LIBRARY = existsSync(`${DIR}toothless.rig.json`) && existsSync(`${DIR}toothless.poses.glb`)
  && existsSync(`${DIR}toothless.poses.json`)
  && (JSON.parse(readFileSync(`${DIR}toothless.poses.json`, 'utf8')) as { version?: number }).version === 2;

export interface ToothlessMotionAsset {
  rig: MotionRig;
  clips: Map<string, THREE.AnimationClip>;
  posesMeta: PosesMeta;
}

let cached: Promise<ToothlessMotionAsset> | null = null;

/** rig.json + the poses GLB's clips (GLTFLoader.parse runs in node for an armature-only GLB) + poses.json. */
export function loadToothlessMotion(): Promise<ToothlessMotionAsset> {
  cached ??= (async () => {
    const buf = readFileSync(`${DIR}toothless.poses.glb`);
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    return {
      rig: JSON.parse(readFileSync(`${DIR}toothless.rig.json`, 'utf8')) as MotionRig,
      clips: new Map(gltf.animations.map((c) => [c.name, c])),
      posesMeta: parsePosesMeta(JSON.parse(readFileSync(`${DIR}toothless.poses.json`, 'utf8'))),
    };
  })();
  return cached;
}
```

`tests/motion/poseLibrary.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import { PoseLayerStack, parsePosesMeta, sampleCurve, withFoldClip, type PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { LEG_KEYS, type MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { WingController } from '../../src/characters/dragon/motion/wings';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const X = new THREE.Vector3(1, 0, 0);
const same = (a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-6) => Math.abs(a.dot(b)) > 1 - eps;
const idle: InputState = { keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 };
const CAM = new THREE.Vector3(0, 3, -8);

/** A clip holding bind·Rx(angle) on the given bones (keys at t = 0 and `duration`, rotating by `spin` over it). */
function clipOf(name: string, s: RigSkeleton, bones: string[], angle: number, duration = 0, spin = 0): THREE.AnimationClip {
  const times = duration > 0 ? [0, duration] : [0];
  const tracks = bones.map((b) => {
    const i = s.id(b);
    const v = times.flatMap((t, k) => s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, angle + (k ? spin : 0))).toArray());
    return new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, v);
  });
  return new THREE.AnimationClip(name, duration || -1, tracks);
}

describe('poses.json v2 metadata', () => {
  it('parses leg ownership, root, wings, soles, loop, interrupt and face curves', () => {
    const m = parsePosesMeta({
      version: 2, clips: {
        sit: { mask: ['hind_'], ownsLegs: ['hind_L', 'hind_R'], root: { height: 0.38, pitch: 0.28 }, wings: { fold: 1, lift: 0.4, flare: 0 },
          soles: { hind_L: [0.34, 0.02, -0.41] }, interrupt: 'exit', face: { smile: [[0, 0.2], [1, 0.4]] } },
      },
    });
    expect(m.clips.sit.ownsLegs).toEqual(['hind_L', 'hind_R']);
    expect(m.clips.sit.root!.height).toBe(0.38);
  });
  it('rejects unknown legs, interrupt policies and malformed face curves', () => {
    expect(() => parsePosesMeta({ clips: { a: { mask: 'all', ownsLegs: ['tail'] } } })).toThrow(/ownsLegs/);
    expect(() => parsePosesMeta({ clips: { a: { mask: 'all', interrupt: 'sometimes' } } })).toThrow(/interrupt/);
    expect(() => parsePosesMeta({ clips: { a: { mask: 'all', face: { jaw: [[0]] } } } })).toThrow(/face\.jaw/);
  });
  it('samples face curves linearly and clamps outside the keys', () => {
    const c: Array<[number, number]> = [[0.5, 0], [1.5, 1]];
    expect(sampleCurve(c, 0)).toBe(0);
    expect(sampleCurve(c, 1)).toBeCloseTo(0.5, 12);
    expect(sampleCurve(c, 9)).toBe(1);
    expect(sampleCurve([], 1)).toBe(0);
  });
});

describe('PoseLayerStack (M6 additions)', () => {
  const rig = toothlessFixtureRig();
  const s = new RigSkeleton(rig);
  const meta: PosesMeta = {
    clips: {
      loopy: { mask: ['tail_'], loop: true },
      low: { mask: ['neck_'], ownsLegs: ['hind_L', 'hind_R'] },
      high: { mask: ['neck_'], ownsLegs: ['hind_L'] },
    },
  };
  const clips = new Map([
    ['loopy', clipOf('loopy', s, ['tail_01'], 0, 1, 1)],
    ['low', clipOf('low', s, ['neck_01'], 0.2)],
    ['high', clipOf('high', s, ['neck_01'], 0.5)],
  ]);
  it('wraps a looping clip\'s time', () => {
    const st = new PoseLayerStack(s, clips, meta);
    st.set('loopy', 1, 1.3);
    expect(st.active()[0].time).toBeCloseTo(0.3, 12);
    s.resetToBind();
    st.apply(s);
    const want = s.bindLocalQuat[s.id('tail_01')].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.3));
    expect(same(s.localQuat[s.id('tail_01')], want, 1e-5)).toBe(true);
  });
  it('applies by order, then by first use, and reports leg ownership', () => {
    const st = new PoseLayerStack(s, clips, meta);
    st.set('high', 0.7, 0, false, 1);
    st.set('low', 0.4, 0, false, 0);
    expect(st.active().map((l) => l.name)).toEqual(['low', 'high']);
    s.resetToBind();
    st.set('high', 1, 0, false, 1);
    st.set('low', 1, 0, false, 0);
    st.apply(s);
    const want = s.bindLocalQuat[s.id('neck_01')].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.5));
    expect(same(s.localQuat[s.id('neck_01')], want)).toBe(true);        // 'high' (order 1) lands last
    st.set('high', 0.7, 0, false, 1);
    st.set('low', 0.4, 0, false, 0);
    const own = st.legOwnership([9, 9, 9, 9]);
    expect(own[LEG_KEYS.indexOf('hind_L')]).toBeCloseTo(0.7, 12);
    expect(own[LEG_KEYS.indexOf('hind_R')]).toBeCloseTo(0.4, 12);
    expect(own[LEG_KEYS.indexOf('front_L')]).toBe(0);
  });
});

/** The fixture rig with fold samples (wing_humerus_* at 0.2 rad per sample about local X), merged as Plan 3 does. */
function foldedFixture() {
  const rig = structuredClone(toothlessFixtureRig()) as MotionRig;
  const names = ['bind', 'wings_fold_25', 'wings_half', 'wings_fold_75', 'wings_folded'];
  const s = new RigSkeleton(rig);
  const clips0 = new Map(names.map((n, k) => [n, clipOf(n, s, ['wing_humerus_L', 'wing_humerus_R', 'hipwing_rib1_L'], 0.2 * k)]));
  const meta0: PosesMeta = {
    wingFlare: { deg: 25, liftDeg: 8 },
    clips: {
      bind: { mask: 'all' }, ...Object.fromEntries(names.slice(1).map((n) => [n, { mask: ['wing_', 'hipwing_'] }])),
      perch: { mask: ['neck_'], wings: { fold: 0.5, lift: 0.3, flare: 0 } },
    },
  };
  clips0.set('perch', clipOf('perch', s, ['neck_01'], 0));
  const { clips, meta } = withFoldClip(clips0, meta0, names);
  const layers = new PoseLayerStack(s, clips, meta);
  return { rig, s, layers, meta };
}

/** One step's wing pass as DragonCharacter runs it: update (drives wingFold) → layers → flare/lift. */
function wingPass(w: WingController, layers: PoseLayerStack, s: RigSkeleton, dt: number): void {
  s.resetToBind();
  w.update(dt);
  layers.apply(s);
  w.apply(s);
}

describe('WingController', () => {
  it('drives the merged wingFold layer: the fold blends piecewise between neighbouring samples', () => {
    const { rig, s, layers, meta } = foldedFixture();
    const w = new WingController(rig, s, layers, meta, DEFAULT_TUNING.wings);
    expect(w.available).toBe(true);
    const i = s.id('wing_humerus_L');
    const at = (a: number) => s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, a));
    w.demand('test', { fold: 0.5 });
    w.update(0);
    w.settle();
    wingPass(w, layers, s, 0);
    expect(layers.active().find((l) => l.name === 'wingFold')!.time).toBeCloseTo(0.5, 12);
    expect(same(s.localQuat[i], at(0.4))).toBe(true);
    w.demand('test', { fold: 0.625 });           // halfway between the 0.4 rad (wings_half) and 0.6 rad samples
    w.update(0);
    w.settle();
    wingPass(w, layers, s, 0);
    expect(same(s.localQuat[i], at(0.5))).toBe(true);
  });
  it('flares and lifts the humerus after the layers, mirrored per side', () => {
    const { rig, s, layers, meta } = foldedFixture();
    const w = new WingController(rig, s, layers, meta, DEFAULT_TUNING.wings);
    w.demand('test', { fold: 1, flare: 1 });
    w.update(0);
    w.settle();
    wingPass(w, layers, s, 0);
    const flare = THREE.MathUtils.degToRad(25);
    const lift = THREE.MathUtils.degToRad(8);
    for (const [name, side] of [['wing_humerus_L', 1], ['wing_humerus_R', -1]] as const) {
      const i = s.id(name);
      const want = s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.8))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -side * flare))
        .multiply(new THREE.Quaternion().setFromAxisAngle(X, lift));
      expect(same(s.localQuat[i], want)).toBe(true);
    }
  });
  it('follows layer wing metadata and named demands through springs', () => {
    const { rig, s, layers, meta } = foldedFixture();
    const w = new WingController(rig, s, layers, meta, DEFAULT_TUNING.wings);
    layers.set('perch', 0.5);
    w.demand('climb', { flare: 0.8 });
    for (let k = 0; k < 240; k++) w.update(DT);
    expect(w.target.fold).toBeCloseTo(0.75, 12);
    expect(w.target.lift).toBeCloseTo(0.15, 12);
    expect(w.target.flare).toBeCloseTo(0.8, 12);
    expect(w.state.fold).toBeCloseTo(0.75, 3);
    expect(layers.active().find((l) => l.name === 'wingFold')!.time).toBeCloseTo(w.state.fold, 12);
    w.demand('climb', null);
    layers.set('perch', 0);
    for (let k = 0; k < 240; k++) w.update(DT);
    expect(w.state.flare).toBeCloseTo(0, 3);
    expect(w.state.fold).toBeCloseTo(1, 3);
  });
  it('without fold clips (fixture rig) drives no layer and leaves the wings at bind', () => {
    const rig = toothlessFixtureRig();
    const s = new RigSkeleton(rig);
    const layers = new PoseLayerStack(s, new Map(), { clips: {} });
    const w = new WingController(rig, s, layers, { clips: {} }, DEFAULT_TUNING.wings);
    expect(w.available).toBe(false);
    wingPass(w, layers, s, DT);
    expect(layers.active()).toHaveLength(0);
    expect(s.angleFromBind(s.id('wing_humerus_L'))).toBe(0);
  });
});

describe('DragonCharacter with an owning pose layer (fixture rig)', () => {
  it('blends owned legs from the IK to the pose and places the body at the pose root', () => {
    const rig = toothlessFixtureRig();
    const s0 = new RigSkeleton(rig);
    const hind = ['hind_femur_L', 'hind_tibia_L', 'hind_femur_R', 'hind_tibia_R'];
    const clips = new Map([['crouch', clipOf('crouch', s0, hind, 0.3)]]);
    const posesMeta: PosesMeta = { clips: { crouch: { mask: ['hind_'], ownsLegs: ['hind_L', 'hind_R'], root: { height: 1.12, pitch: 0.05 } } } };
    const world = CollisionWorld.fromObjects([box(60, 1, 60, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig, world, clips, posesMeta, seed: 1 });
    d.spawn(0, 0, 0);
    d.hooks.beforeMove.push((dd) => dd.layers.set('crouch', 1));
    for (let k = 0; k < 360; k++) d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
    expect(d.own[LEG_KEYS.indexOf('hind_L')]).toBe(1);
    expect(d.own[LEG_KEYS.indexOf('front_L')]).toBe(0);
    expect(d.planner.paws[LEG_KEYS.indexOf('hind_L')].posed).toBe(true);
    expect(d.planner.paws[LEG_KEYS.indexOf('front_L')].posed).toBe(false);
    expect(d.body.posture.weight).toBe(1);
    expect(d.body.pose.height).toBeCloseTo(1.12, 2);
    expect(d.body.pose.pitch).toBeCloseTo(0.05, 2);
    const i = d.skeleton.id('hind_tibia_L');
    const want = d.skeleton.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.3));
    expect(same(d.skeleton.localQuat[i], want)).toBe(true);
    expect(d.nanResets).toBe(0);
  });
});

describe('the ground guard for posed legs (fixture rig)', () => {
  it('re-solves a posed leg that would sink onto the ground', () => {
    const rig = toothlessFixtureRig();
    const s0 = new RigSkeleton(rig);
    const clips = new Map([['slump', clipOf('slump', s0, ['neck_01'], 0)]]);
    // the body drops 25 cm while the hind legs stay straight (posed at bind): their paws would go 25 cm under
    const posesMeta: PosesMeta = { clips: { slump: { mask: ['neck_'], ownsLegs: ['hind_L', 'hind_R'], root: { height: 0.77, pitch: 0 } } } };
    const world = CollisionWorld.fromObjects([box(60, 1, 60, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig, world, clips, posesMeta, seed: 1 });
    d.spawn(0, 0, 0);
    d.hooks.beforeMove.push((dd) => dd.layers.set('slump', 1));
    const sole = new THREE.Vector3();
    let lowest = Infinity;
    for (let k = 0; k < 240; k++) {
      d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
      for (const key of ['hind_L', 'hind_R'] as const) lowest = Math.min(lowest, d.legs.soleWorld(LEG_KEYS.indexOf(key), d.skeleton, sole).y);
    }
    expect(d.body.pose.height).toBeCloseTo(0.77, 2);
    expect(lowest).toBeGreaterThan(-0.005);
    expect(d.nanResets).toBe(0);
  });
});

describe.skipIf(!HAS_LIBRARY)('the exported pose library (Plan 4 Task 1)', () => {
  const LIBRARY = ['sit', 'lie', 'sleep', 'stretch', 'sniff', 'stalk', 'jump_crouch', 'jump_launch', 'jump_tuck', 'jump_land',
    'plasma_rear', 'climb_reach', 'scramble_hook', 'scratch', 'shake', 'yawn', 'scramble_up'];
  it('ships every library clip with its metadata', async () => {
    const a = await loadToothlessMotion();
    for (const n of LIBRARY) {
      expect(a.clips.has(n), n).toBe(true);
      expect(a.posesMeta.clips[n], n).toBeTruthy();
    }
    expect(a.posesMeta.clips.scratch.loop).toBe(true);
    expect(a.posesMeta.wingFlare).toEqual({ deg: 25, liftDeg: 8 });
    expect(a.posesMeta.clips.sleep.face!.blink).toEqual([[0, 1]]);     // a posture layer holds time 0
    expect(a.clips.get('yawn')!.duration).toBeCloseTo(2.4, 3);
  });
  it('sits on the real rig: hind legs posed, body at the sit root, every metric passes', { timeout: 60_000 }, async () => {
    const a = await loadToothlessMotion();
    const world = CollisionWorld.fromObjects([box(60, 1, 60, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig: a.rig, world, clips: a.clips, posesMeta: a.posesMeta, seed: 1 });
    d.spawn(0, 0, 0);
    let w = 0;
    d.hooks.beforeMove.push((dd, dt) => {
      w = Math.min(1, w + dt / a.posesMeta.clips.sit.blendIn!);
      dd.layers.set('sit', w);
    });
    const m = new MotionMetrics(world, 4);
    for (let k = 0; k < 480; k++) {
      d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
      m.sample(d);
    }
    const r = m.report('sit');
    expect(r.failures, JSON.stringify(r)).toEqual([]);
    expect(d.body.pose.height).toBeCloseTo(a.posesMeta.clips.sit.root!.height, 1);
    expect(d.planner.paws[LEG_KEYS.indexOf('hind_L')].posed).toBe(true);
    expect(d.wings.state.lift).toBeCloseTo(a.posesMeta.clips.sit.wings!.lift, 2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/motion/poseLibrary.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/characters/dragon/motion/wings"` (and missing exports from `poseLayers`).

- [ ] **Step 3: Replace `poseLayers.ts`** with (Plan 3's `ClipPose`, `maskBones` and `withFoldClip` keep their behaviour; Plan 3's `tests/motion/poseLayers.test.ts` must still pass):

`src/characters/dragon/motion/poseLayers.ts`:
```ts
import * as THREE from 'three';
import { LEG_KEYS, type LimbKey, type Vec3 } from './rigTypes';
import type { RigSkeleton } from './skeleton';

/** A face channel curve: [time (s), value] keys, linear, constant outside the keys. */
export type FaceCurve = ReadonlyArray<readonly [number, number]>;

export interface PoseClipMeta {
  mask: 'all' | string[];
  loop?: boolean;
  blendIn?: number;
  blendOut?: number;
  /** 'exit': any input plays the exit blend at once; 'finish': the clip completes first; 'none': an action. */
  interrupt?: string;
  /** Legs this layer drives instead of the leg IK (M6). */
  ownsLegs?: LimbKey[];
  /** Body placement the body solver blends toward: pelvis-head height above the ground (m) and pitch (rad, + nose up). */
  root?: { height: number; pitch: number };
  /** Head-look gain while this layer is live (0: the pose's head wins — shake, sleep; absent = 1). */
  look?: number;
  /** An airborne pose's body pitch (rad, + nose up): the jump pitches the body to it (the pose has no root). */
  bodyPitch?: number;
  /** Wing state while this layer is active (fold 0 spread … 1 folded, lift rad, flare 0…1). */
  wings?: { fold: number; lift: number; flare: number };
  /** Sole spots of the owned grounded paws, character frame (glTF, +Z forward). */
  soles?: Partial<Record<LimbKey, Vec3>>;
  /** Clip length (s); 0 for a single-frame pose. */
  duration?: number;
  /** A looping clip wraps into [loopStart, duration): an intro before it plays once. */
  loopStart?: number;
  /** 'reverse': the clip plays backwards to its first frame (the pose beneath it) instead of blending out. */
  exit?: string;
  /** Face channel curves over the layer's time (jaw, blink, squint, smile, snarl, teeth_out, nostril_flare, pupil, ears, plasmaGlow). */
  face?: Record<string, FaceCurve>;
}

export interface PosesMeta {
  version?: number;
  /** Degrees a full wing flare swings / lifts the folded humerus (the Blender library's FLARE_DEG / FLARE_LIFT_DEG). */
  wingFlare?: { deg: number; liftDeg: number };
  clips: Record<string, PoseClipMeta>;
}

const INTERRUPTS = ['exit', 'finish', 'none'];

export function parsePosesMeta(raw: unknown): PosesMeta {
  const r = raw as { clips?: unknown } | null;
  if (!r || typeof r !== 'object' || !r.clips || typeof r.clips !== 'object') throw new Error('poses.json: missing "clips"');
  for (const [name, c] of Object.entries(r.clips as Record<string, unknown>)) {
    const m = c as PoseClipMeta | null;
    const mask = m?.mask as unknown;
    if (!(mask === 'all' || (Array.isArray(mask) && mask.every((x) => typeof x === 'string')))) {
      throw new Error(`poses.json: clip '${name}' needs mask "all" or a list of bone-name prefixes`);
    }
    if (m!.ownsLegs !== undefined && !(Array.isArray(m!.ownsLegs) && m!.ownsLegs.every((k) => (LEG_KEYS as readonly string[]).includes(k)))) {
      throw new Error(`poses.json: clip '${name}' ownsLegs must list leg keys (${LEG_KEYS.join(', ')})`);
    }
    if (m!.exit !== undefined && m!.exit !== 'blend' && m!.exit !== 'reverse') {
      throw new Error(`poses.json: clip '${name}' exit must be "blend" or "reverse"`);
    }
    if (m!.interrupt !== undefined && !INTERRUPTS.includes(m!.interrupt)) {
      throw new Error(`poses.json: clip '${name}' interrupt must be one of ${INTERRUPTS.join(', ')}`);
    }
    for (const [channel, curve] of Object.entries(m!.face ?? {})) {
      if (!Array.isArray(curve) || !curve.every((k) => Array.isArray(k) && k.length === 2 && k.every(Number.isFinite))) {
        throw new Error(`poses.json: clip '${name}' face.${channel} must be [[t, value], ...]`);
      }
    }
  }
  return r as PosesMeta;
}

export async function loadPosesMeta(url: string): Promise<PosesMeta> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`poses.json: ${url} → HTTP ${res.status}`);
  return parsePosesMeta(await res.json());
}

/** Bone indices selected by a mask: 'all', or every bone whose name starts with one of the prefixes. */
export function maskBones(s: RigSkeleton, mask: 'all' | readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.count; i++) if (mask === 'all' || mask.some((p) => s.names[i].startsWith(p))) out.push(i);
  return out;
}

/** A looping clip's time wrapped into [loopStart, duration); other clips' time unchanged. */
export function loopTime(meta: PoseClipMeta, duration: number, t: number): number {
  const a = meta.loopStart ?? 0;
  if (!meta.loop || duration - a <= 0 || t < a) return t;
  const span = duration - a;
  return a + (((t - a) % span) + span) % span;
}

/** Value of a face curve at time t (linear between keys, clamped at the ends). */
export function sampleCurve(curve: FaceCurve, t: number): number {
  if (!curve.length) return 0;
  if (t <= curve[0][0]) return curve[0][1];
  for (let k = 1; k < curve.length; k++) {
    const [t1, v1] = curve[k];
    if (t <= t1) {
      const [t0, v0] = curve[k - 1];
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return curve[curve.length - 1][1];
}

/** Samples a clip's rotation tracks for the masked bones (local rotations, slerped between keys). */
export class ClipPose {
  readonly bones: number[] = [];
  readonly duration: number;
  private readonly interpolants: THREE.Interpolant[] = [];

  constructor(clip: THREE.AnimationClip, s: RigSkeleton, mask: 'all' | readonly string[]) {
    const allowed = new Set(maskBones(s, mask));
    for (const track of clip.tracks) {
      if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
      const dot = track.name.lastIndexOf('.');
      const bone = track.name.slice(0, dot);
      if (!s.has(bone) || !allowed.has(s.id(bone))) continue;
      this.bones.push(s.id(bone));
      this.interpolants.push(track.InterpolantFactoryMethodLinear(new Float32Array(4)));
    }
    this.duration = clip.duration;
  }

  sample(t: number, out: THREE.Quaternion[]): void {
    for (let k = 0; k < this.bones.length; k++) {
      const v = this.interpolants[k].evaluate(t);
      out[k].set(v[0], v[1], v[2], v[3]).normalize();
    }
  }
}

interface Layer {
  name: string;
  pose: ClipPose;
  meta: PoseClipMeta;
  weight: number;
  time: number;
  additive: boolean;
  order: number;
  seq: number;
}

/** A live layer as behaviours, the wing controller, the body placement and the face read it. */
export interface ActiveLayer {
  readonly name: string;
  readonly weight: number;
  /** Layer time (s); a looping clip's time is wrapped into [0, duration) when set. */
  readonly time: number;
  readonly meta: PoseClipMeta;
}

const _d = new THREE.Quaternion();
const _w = new THREE.Quaternion();

/**
 * Library pose layers (spec §6.10): applied after the body pose and before the procedural finals (look, IK, springs).
 * Layers apply by `order` (posture 0 < gesture 1 < action 2), then in the order they were first set. Override layers
 * slerp masked bones toward the clip; additive layers post-multiply the clip's offset from bind. Looping clips wrap
 * their time. Masks, leg ownership, body placement, wing state and face curves are explicit metadata (spec §5.11).
 */
export class PoseLayerStack {
  private readonly layers = new Map<string, Layer>();
  private sorted: Layer[] = [];
  private seq = 0;
  private readonly tmp: THREE.Quaternion[] = [];

  constructor(
    private readonly skeleton: RigSkeleton,
    private readonly clips: ReadonlyMap<string, THREE.AnimationClip>,
    private readonly metaAll: PosesMeta,
  ) {}

  has(name: string): boolean {
    return this.clips.has(name) && name in this.metaAll.clips;
  }

  meta(name: string): PoseClipMeta | undefined {
    return this.metaAll.clips[name];
  }

  set(name: string, weight: number, time = 0, additive = false, order = 0): void {
    if (weight <= 0) {
      if (this.layers.delete(name)) this.resort();
      return;
    }
    let layer = this.layers.get(name);
    if (!layer) {
      const clip = this.clips.get(name);
      const m = this.metaAll.clips[name];
      if (!clip || !m) throw new Error(`pose layer '${name}': no clip in the poses GLB or no entry in poses.json`);
      layer = { name, pose: new ClipPose(clip, this.skeleton, m.mask), meta: m, weight, time, additive, order, seq: this.seq++ };
      this.layers.set(name, layer);
      this.resort();
    }
    layer.weight = Math.min(weight, 1);
    layer.time = loopTime(layer.meta, layer.pose.duration, time);
    layer.additive = additive;
    if (layer.order !== order) {
      layer.order = order;
      this.resort();
    }
  }

  weight(name: string): number {
    return this.layers.get(name)?.weight ?? 0;
  }

  /** Live layers in application order (no allocation: the stack's own records, read-only). */
  active(): ReadonlyArray<ActiveLayer> {
    return this.sorted;
  }

  /** Per leg (LEG_KEYS order): the largest weight of a layer that owns it (0 = the leg IK drives it alone). */
  legOwnership(out: number[]): number[] {
    out.fill(0, 0, LEG_KEYS.length);
    for (const l of this.sorted) {
      for (const key of l.meta.ownsLegs ?? []) {
        const i = LEG_KEYS.indexOf(key);
        out[i] = Math.max(out[i], l.weight);
      }
    }
    return out;
  }

  apply(s: RigSkeleton): void {
    for (const l of this.sorted) {
      while (this.tmp.length < l.pose.bones.length) this.tmp.push(new THREE.Quaternion());
      l.pose.sample(l.time, this.tmp);
      for (let k = 0; k < l.pose.bones.length; k++) {
        const b = l.pose.bones[k];
        if (l.additive) {
          _d.copy(s.bindLocalQuat[b]).invert().multiply(this.tmp[k]);
          s.localQuat[b].multiply(_w.identity().slerp(_d, l.weight));
        } else {
          s.localQuat[b].slerp(this.tmp[k], l.weight);
        }
      }
    }
  }

  private resort(): void {
    this.sorted = [...this.layers.values()].sort((a, b) => a.order - b.order || a.seq - b.seq);
  }
}


/**
 * Merge ordered single-frame fold samples (rig.json wings.<side>.foldClips) into ONE multi-key clip, keyed at
 * t = i/(n−1), so sampling it at fold amount f ∈ [0,1] slerps only between neighbouring samples (each step < 120°).
 * Registers meta[name] with the mask of the last sample (the fully folded pose). Returns new maps; inputs untouched.
 */
export function withFoldClip(
  clips: ReadonlyMap<string, THREE.AnimationClip>,
  meta: PosesMeta,
  foldClips: readonly string[],
  name = 'wingFold',
): { clips: Map<string, THREE.AnimationClip>; meta: PosesMeta } {
  if (foldClips.length < 2) throw new Error(`withFoldClip: '${name}' needs at least 2 foldClips, got ${foldClips.length}`);
  const samples = foldClips.map((clipName) => {
    const c = clips.get(clipName);
    if (!c || !meta.clips[clipName]) {
      throw new Error(`withFoldClip: '${name}' references fold clip '${clipName}', missing from the poses GLB or poses.json`);
    }
    return c;
  });
  const n = samples.length;

  // Every bone with a QuaternionKeyframeTrack in any sample.
  const boneNames = new Set<string>();
  for (const c of samples) {
    for (const track of c.tracks) {
      if (track instanceof THREE.QuaternionKeyframeTrack) boneNames.add(track.name.slice(0, track.name.lastIndexOf('.')));
    }
  }

  const tracks: THREE.QuaternionKeyframeTrack[] = [];
  for (const bone of boneNames) {
    const trackName = `${bone}.quaternion`;
    const perSample = samples.map((c) => {
      const track = c.tracks.find(
        (t): t is THREE.QuaternionKeyframeTrack => t instanceof THREE.QuaternionKeyframeTrack && t.name === trackName,
      );
      return track ? new THREE.Quaternion(track.values[0], track.values[1], track.values[2], track.values[3]) : null;
    });
    // Fill missing samples from the previous one; the first sample missing a track borrows the first that has one.
    let prev = perSample.find((v): v is THREE.Quaternion => v !== null)!;
    const resolved = perSample.map((v) => {
      prev = v ?? prev;
      return prev.clone();
    });
    // Keep neighbouring keys in one hemisphere so the interpolant never takes the long way around.
    for (let i = 1; i < resolved.length; i++) {
      if (resolved[i].dot(resolved[i - 1]) < 0) resolved[i].set(-resolved[i].x, -resolved[i].y, -resolved[i].z, -resolved[i].w);
    }
    const times = resolved.map((_, i) => i / (n - 1));
    const values = resolved.flatMap((qv) => qv.toArray());
    tracks.push(new THREE.QuaternionKeyframeTrack(trackName, times, values));
  }

  const outClips = new Map(clips);
  outClips.set(name, new THREE.AnimationClip(name, 1, tracks));
  // M6: keep every other poses.json field (version, wingFlare)
  const outMeta: PosesMeta = { ...meta, clips: { ...meta.clips, [name]: { mask: meta.clips[foldClips[n - 1]].mask, loop: false } } };
  return { clips: outClips, meta: outMeta };
}
```

- [ ] **Step 4: Create the wing controller**

`src/characters/dragon/motion/wings.ts`:
```ts
import * as THREE from 'three';
import type { PoseLayerStack, PosesMeta } from './poseLayers';
import type { MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, deg, lerp } from './math';
import { stepSpring, type SpringState } from './springs';

export interface WingState {
  /** 0 = spread (bind) … 1 = folded. */
  fold: number;
  /** Extra humerus rotation about its local X (rad, + raises the folded bundle's rear). */
  lift: number;
  /** 0 … 1: the folded wing swings off the flank (local Z, mirrored per side) and lifts a little. */
  flare: number;
}

const KEYS = ['fold', 'lift', 'flare'] as const;
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/**
 * The main and hip wings (spec §5.4, §6.6, §6.9, §6.13). The fold drives Plan 3's merged `wingFold` layer (Ruling 3:
 * one multi-key clip over rig.json wings.L.foldClips, sampled at the fold amount, so it only ever slerps between
 * neighbouring samples); without it, `wings_folded` by weight. After the layers, the folded humerus gets its flare and
 * lift. Target: folded, blended toward each live pose layer's `wings` metadata by its weight, then toward named demands
 * (the climb's balance flare, the jump); every channel follows its target through a critically damped spring, so a
 * layer change never pops. This is the ONLY writer of the fold layer once M6 is in.
 */
export class WingController {
  readonly state: WingState = { fold: 1, lift: 0, flare: 0 };
  readonly target: WingState = { fold: 1, lift: 0, flare: 0 };
  private readonly springs: Record<keyof WingState, SpringState> = { fold: { x: 1, v: 0 }, lift: { x: 0, v: 0 }, flare: { x: 0, v: 0 } };
  private readonly demands = new Map<string, { state: Partial<WingState>; weight: number }>();
  private readonly humerus: Array<{ bone: number; side: number }>;
  private readonly flareRad: number;
  private readonly flareLiftRad: number;
  private readonly foldLayer: 'wingFold' | 'wings_folded' | null;

  constructor(
    rig: MotionRig, s: RigSkeleton, private readonly layers: PoseLayerStack, meta: PosesMeta, private readonly t: MotionTuning['wings'],
  ) {
    this.foldLayer = layers.has('wingFold') ? 'wingFold' : layers.has('wings_folded') ? 'wings_folded' : null;
    this.humerus = [{ bone: s.id(rig.wings.L.humerus), side: 1 }, { bone: s.id(rig.wings.R.humerus), side: -1 }];
    this.flareRad = deg(meta.wingFlare?.deg ?? 25);
    this.flareLiftRad = deg(meta.wingFlare?.liftDeg ?? 8);
  }

  /** false on a rig without fold clips (the fixture): flare and lift still apply, the fold does nothing. */
  get available(): boolean {
    return this.foldLayer !== null;
  }

  /** A named request (e.g. 'climb') blended over the layer targets by `weight`; null removes it. */
  demand(source: string, state: Partial<WingState> | null, weight = 1): void {
    if (!state || weight <= 0) this.demands.delete(source);
    else this.demands.set(source, { state, weight: Math.min(weight, 1) });
  }

  /** Snap to the current target (spawn / teleport). */
  settle(): void {
    for (const k of KEYS) {
      this.springs[k].x = this.state[k] = this.target[k];
      this.springs[k].v = 0;
    }
    this.driveFold();
  }

  /** Target from the live layers and demands, springs, then the fold layer — call before PoseLayerStack.apply. */
  update(dt: number): void {
    const g = this.target;
    g.fold = 1;
    g.lift = 0;
    g.flare = 0;
    for (const l of this.layers.active()) {
      const w = l.meta.wings;
      if (!w) continue;
      for (const k of KEYS) g[k] = lerp(g[k], w[k], l.weight);
    }
    for (const d of this.demands.values()) {
      for (const k of KEYS) {
        const v = d.state[k];
        if (v !== undefined) g[k] = lerp(g[k], v, d.weight);
      }
    }
    for (const k of KEYS) {
      stepSpring(this.springs[k], g[k], this.t.omega, 1, dt);
      this.state[k] = this.springs[k].x;
    }
    this.state.fold = clamp(this.state.fold, 0, 1);
    this.state.flare = Math.max(0, this.state.flare);
    this.driveFold();
  }

  /** Flare and lift on the humerus (post-multiplied on its local axes) — call after PoseLayerStack.apply. */
  apply(s: RigSkeleton): void {
    const { flare, lift } = this.state;
    if (flare === 0 && lift === 0) return;
    for (const h of this.humerus) {
      s.localQuat[h.bone]
        .multiply(_qa.setFromAxisAngle(AZ, -h.side * this.flareRad * flare))
        .multiply(_qb.setFromAxisAngle(AX, lift + this.flareLiftRad * flare));
    }
  }

  private driveFold(): void {
    if (this.foldLayer === 'wingFold') this.layers.set('wingFold', 1, this.state.fold);
    else if (this.foldLayer === 'wings_folded') this.layers.set('wings_folded', this.state.fold);
  }
}
```

- [ ] **Step 5: Edit Plan 3's files**

**Edit 3.1 — `src/characters/dragon/motion/tuning.ts`**

Find:
```ts
    cadenceScale: number; strideScale: number; swingScale: number; wingsOpen: number;
    ledgeMax: number; scrambleTime: number; dropMin: number; hopUpSpeed: number; probeAhead: number;
  };
```
Replace with:
```ts
    cadenceScale: number; strideScale: number; swingScale: number;
    ledgeMax: number; scrambleTime: number; dropMin: number; hopUpSpeed: number; probeAhead: number;
  };
  /** Wing fold/flare/lift springs (M6 WingController); climbFlare = the spec §6.6 "wings open ~20%" while climbing. */
  wings: { omega: number; climbFlare: number };
  /** Library-pose legs (M6): breathGainPosed = breathing depth while the front legs are posed (lying: shallower); a
   *  posed paw below the ground hands its leg to the IK in full by groundGuard metres of depth. */
  pose: { breathGainPosed: number; groundGuard: number };
  /** Face and mood (M6, spec §6.12). pupilByMood / earsByMood follow MOODS: calm, curious, excited, tired, aggressive. */
  face: {
    blinkMin: number; blinkMax: number; doubleBlink: number; doubleGap: number; blinkClose: number; blinkHold: number; blinkOpen: number;
    turnBlinkRate: number; turnBlinkGap: number; moodOmega: number; pupilOmega: number; earOmega: number;
    tiredFrom: number; tiredFull: number; tiredLid: number; sunSquint: number; sunNarrow: number;
    contentSmile: number; contentPupil: number; pantJaw: number; eyeGlow: number; eyeGlowAggressive: number;
    pupilByMood: number[]; earsByMood: number[];
  };
  /** Personality idles (M6, spec §6.11): times s, impulses rad/s. */
  behaviour: {
    thinkEvery: number; restWeight: number; holdMin: number; holdMax: number; watchMin: number; watchMax: number;
    stretchHold: number; glanceHold: number; lookAroundHold: number; lookAroundYawDeg: number; twitchImpulse: number; flickImpulse: number;
    sleepLookOmega: number; reverseRate: number;
  };
  /** The jump (M6, spec §6.13): m, s, m/s. tuckAt: flight fraction; releaseTime / landLead: s before touchdown;
   *  frontLag / hindLag: s after the body's touchdown that the front / hind paws plant (front first). */
  jump: {
    crouchTime: number; apex: number; gravity: number; minForward: number; wallMargin: number; maxFlight: number;
    tuckAt: number; releaseTime: number; landLead: number; frontLag: number; hindLag: number; minLift: number;
    landImpulse: number; recoverHold: number; recoverTime: number; cooldown: number;
    /** Body behind the origin (hind paws, hips) and paw-level clearance the arc keeps over the ground (m). */
    rearExtent: number; clearance: number;
    /** Speed (m/s) a landing keeps when no direction is held. */
    landCarry: number;
  };
  /** The plasma blast (M6, spec §6.13): deg, s, m/s, m. recoilDrop: suspension dip (m/s); recoilKick: head (rad/s). */
  plasma: {
    turnFirstDeg: number; chargeFacingDeg: number; turnTimeout: number; chargeTime: number; cooldown: number;
    recoilDrop: number; recoilKick: number; skidSpeed: number; skidDecay: number; lingerAggro: number;
    boltSpeed: number; boltRadius: number; boltRange: number; shake: number; shakeTime: number;
  };
  /** Interest-point attention (M6, spec §6.8): distances m, cones deg, times s. */
  attention: {
    maxDist: number; near: number; movingSpeed: number; moveCone: number; stillCone: number; movingFactor: number;
    motionBonus: number; enter: number; exit: number; switchRatio: number; dwell: number; bored: number;
  };
```

**Edit 3.2 — `src/characters/dragon/motion/tuning.ts`**

Find:
```ts
    swingScale: 1.5, wingsOpen: 0.2, ledgeMax: 2.5, scrambleTime: 0.9, dropMin: 1.5, hopUpSpeed: 1.2, probeAhead: 1.2,
  },
```
Replace with:
```ts
    swingScale: 1.5, ledgeMax: 2.5, scrambleTime: 0.9, dropMin: 1.5, hopUpSpeed: 1.2, probeAhead: 1.2,
  },
  wings: { omega: 8, climbFlare: 0.8 },
  pose: { breathGainPosed: 0.5, groundGuard: 0.02 },
  face: {
    blinkMin: 2, blinkMax: 6, doubleBlink: 0.18, doubleGap: 0.12, blinkClose: 0.07, blinkHold: 0.04, blinkOpen: 0.12,
    turnBlinkRate: 2.5, turnBlinkGap: 0.8, moodOmega: 1.2, pupilOmega: 6, earOmega: 5,
    tiredFrom: 40, tiredFull: 90, tiredLid: 0.35, sunSquint: 0.3, sunNarrow: 0.35,
    contentSmile: 0.7, contentPupil: 0.2, pantJaw: 0.18, eyeGlow: 0.35, eyeGlowAggressive: 0.4,
    pupilByMood: [0.5, 0.92, 0.7, 0.6, 0.04], earsByMood: [0, -15, -6, 12, 45],
  },
  behaviour: {
    thinkEvery: 0.5, restWeight: 2.5, holdMin: 1.8, holdMax: 3, watchMin: 3, watchMax: 6, stretchHold: 1.3, glanceHold: 1.4,
    lookAroundHold: 0.9, lookAroundYawDeg: 55, twitchImpulse: 7, flickImpulse: 4, sleepLookOmega: 6, reverseRate: 1.5,
  },
  jump: {
    crouchTime: 0.12, apex: 2, gravity: 9.81, minForward: 1.5, wallMargin: 0.3, maxFlight: 2.5,
    tuckAt: 0.3, releaseTime: 0.28, landLead: 0.3, frontLag: 0.02, hindLag: 0.1, minLift: 0.25,
    landImpulse: 1.2, recoverHold: 0.2, recoverTime: 0.35, cooldown: 0.3, rearExtent: 1.1, clearance: 0.1, landCarry: 0.8,
  },
  plasma: {
    turnFirstDeg: 100, chargeFacingDeg: 35, turnTimeout: 1.5, chargeTime: 0.3, cooldown: 0.7,
    recoilDrop: 1.2, recoilKick: 3, skidSpeed: 0.8, skidDecay: 8, lingerAggro: 1.5,
    boltSpeed: 45, boltRadius: 0.12, boltRange: 120, shake: 0.12, shakeTime: 0.35,
  },
  attention: {
    maxDist: 15, near: 2, movingSpeed: 0.3, moveCone: 55, stillCone: 150, movingFactor: 0.6, motionBonus: 1.5,
    enter: 0.3, exit: 0.15, switchRatio: 1.6, dwell: 4.5, bored: 12,
  },
```

**Edit 3.3 — `src/characters/dragon/motion/bodySolver.ts`**

Find:
```ts
  readonly override = { active: false, height: 0, pitch: 0 };
```
Replace with:
```ts
  readonly override = { active: false, height: 0, pitch: 0, snap: false };
  /**
   * Library-pose placement (M6): the height (world, pelvis head) and pitch targets blend toward these by `weight`
   * (roll levels out with it). Scripted `override`s still replace everything.
   */
  readonly posture = { weight: 0, height: 0, pitch: 0 };
```

**Edit 3.4 — `src/characters/dragon/motion/bodySolver.ts`**

Find:
```ts
    let heightT = hH + this.hipHeight - crouch - lowerHind + bob;
    if (this.override.active) {
      heightT = this.override.height;
      pitchT = this.override.pitch;
      rollT = 0;
    }
```
Replace with:
```ts
    let heightT = hH + this.hipHeight - crouch - lowerHind + bob;
    if (this.posture.weight > 0) {
      const w = clamp(this.posture.weight, 0, 1);
      heightT += (this.posture.height - heightT) * w;
      pitchT += (this.posture.pitch - pitchT) * w;
      rollT -= rollT * w;
    }
    if (this.override.active) {
      heightT = this.override.height;
      pitchT = this.override.pitch;
      rollT = 0;
      if (this.override.snap) {
        this.height.x = heightT;          // a ballistic flight (M6 jump) follows its arc exactly: no spring lag
        this.height.v = 0;
      }
    }
```

**Edit 3.5 — `src/characters/dragon/motion/footPlanner.ts`**

Find:
```ts
  wasStance: boolean;
}
```
Replace with:
```ts
  wasStance: boolean;
  /** Driven by a pose layer (M6 leg ownership): no automatic lift-offs or corrections; metrics skip slip/float. */
  posed: boolean;
}
```

**Edit 3.6 — `src/characters/dragon/motion/footPlanner.ts`**

Find:
```ts
targetOk: true, wasStance: true,
```
Replace with:
```ts
targetOk: true, wasStance: true, posed: false,
```

**Edit 3.7 — `src/characters/dragon/motion/footPlanner.ts`**

Find:
```ts
      if (this.autoStep && !stopped && p.planted && !p.justPlanted && p.wasStance && !stance) {
```
Replace with:
```ts
      if (this.autoStep && !stopped && p.planted && !p.posed && !p.justPlanted && p.wasStance && !stance) {
```

**Edit 3.8 — `src/characters/dragon/motion/footPlanner.ts`**

Find:
```ts
      if (!p.planted || p.justPlanted || (stopped && airborne >= t.maxAirborne)) continue;
```
Replace with:
```ts
      if (!p.planted || p.posed || p.justPlanted || (stopped && airborne >= t.maxAirborne)) continue;
```

**Edit 3.9 — `src/characters/dragon/motion/footPlanner.ts`**

Find:
```ts
        const p = this.paws[i];
        this.neutralWorld(i, body.pos, body.heading, _a);
```
Replace with:
```ts
        const p = this.paws[i];
        if (p.posed) continue;
        this.neutralWorld(i, body.pos, body.heading, _a);
```

**Edit 3.10 — `src/characters/dragon/motion/metrics.ts`**

Find:
```ts
  /** Largest per-bone rotation from bind in the first / last 10 s (rad), for runs ≥ 30 s. */
```
Replace with:
```ts
  /** Largest per-bone rotation from its pose at the start of the run, in the first / last 10 s (rad), runs ≥ 30 s. */
```

**Edit 3.11 — `src/characters/dragon/motion/metrics.ts`**

Find:
```ts
  private last: number[] = [];
```
Replace with:
```ts
  private last: number[] = [];
  /** Each bone's local rotation at the first sample: boundedness is measured from where the run started (M6: the
   *  folded wing's ribs sit ~170° from bind for the whole run — a pose, not a spin). */
  private ref: THREE.Quaternion[] = [];
```

**Edit 3.12 — `src/characters/dragon/motion/metrics.ts`**

Find:
```ts
      this.last = new Array(s.count).fill(0);
```
Replace with:
```ts
      this.last = new Array(s.count).fill(0);
      this.ref = s.localQuat.map((q) => q.clone());
```

**Edit 3.13 — `src/characters/dragon/motion/metrics.ts`**

Find:
```ts
      if (paw.planted) {
        if (!this.wasPlanted[i] || paw.justPlanted) this.locked[i].copy(_sole);
```
Replace with:
```ts
      const planted = paw.planted && !paw.posed;     // a posed paw follows its pose layer (M6), not a contact
      if (planted) {
        if (!this.wasPlanted[i] || paw.justPlanted) this.locked[i].copy(_sole);
```

**Edit 3.14 — `src/characters/dragon/motion/metrics.ts`**

Find:
```ts
      this.wasPlanted[i] = paw.planted;
```
Replace with:
```ts
      this.wasPlanted[i] = planted;
```

**Edit 3.15 — `src/characters/dragon/motion/metrics.ts`**

Find:
```ts
      const a = s.angleFromBind(b);
```
Replace with:
```ts
      const a = 2 * Math.acos(Math.min(1, Math.abs(s.localQuat[b].dot(this.ref[b]))));
```

**Edit 3.16 — `src/characters/dragon/motion/secondary.ts`**

Find:
```ts
  exertion = 0;
```
Replace with:
```ts
  exertion = 0;
  /** Breathing depth scale (M6: shallower while the front legs are posed on the ground). */
  breathGain = 1;
```

**Edit 3.17 — `src/characters/dragon/motion/secondary.ts`**

Find:
```ts
    const b = deg(this.t.breath.amplitudeDeg) * Math.sin(TAU * this.breathPhase);
```
Replace with:
```ts
    const b = deg(this.t.breath.amplitudeDeg) * this.breathGain * Math.sin(TAU * this.breathPhase);
```

**Edit 3.18 — `src/characters/dragon/motion/dragon.ts`**

> Plan 3 Task 12 imports `withFoldClip` here (its Ruling 3). However the import is written, add `ClipPose` to it.

Find:
```ts
import { PoseLayerStack, withFoldClip, type PosesMeta } from './poseLayers';
```
Replace with:
```ts
import { ClipPose, PoseLayerStack, withFoldClip, type PosesMeta } from './poseLayers';
```

**Edit 3.19 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
import { SecondaryMotion } from './secondary';
```
Replace with:
```ts
import { SecondaryMotion } from './secondary';
import { WingController } from './wings';
```

**Edit 3.20 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
import { dampFactor, deg, rotY } from './math';
```
Replace with:
```ts
import { dampFactor, deg, rotY } from './math';

const _ik = new THREE.Quaternion();
```

**Edit 3.21 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
  posesMeta?: PosesMeta;
  seed?: number;
}
```
Replace with:
```ts
  posesMeta?: PosesMeta;
  seed?: number;
  /** Pose whose legs are the midpoint of every IK↔pose leg blend (paws lift instead of sweeping through the ground). */
  legTuckClip?: string;
}
```

**Edit 3.22 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
  readonly layers: PoseLayerStack;
```
Replace with:
```ts
  readonly layers: PoseLayerStack;
  readonly wings: WingController;
  /** Per leg (LEG_KEYS order): how strongly pose layers drive it instead of the leg IK (0…1). */
  readonly own = [0, 0, 0, 0];
```

**Edit 3.23 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
  nanResets = 0;
```
Replace with:
```ts
  nanResets = 0;
  /** The camera position of the current step (hooks read it: glance at the camera). */
  readonly cameraPos = new THREE.Vector3();
```

**Edit 3.24 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
    s: [1, 1, 1, 1],
  };
  private prevPelvisY = 0;
```
Replace with:
```ts
    s: [1, 1, 1, 1],
  };
  private readonly legBones: number[][];
  private readonly legSave: THREE.Quaternion[][];
  private readonly legPosed: THREE.Quaternion[][];
  private readonly guardSole = new THREE.Vector3();
  private readonly guardHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private readonly guardKeep = { stretch: [0, 0, 0, 0], shortfall: [0, 0, 0, 0], margin: [0, 0, 0, 0] };
  private readonly guardTargets = {
    sole: [0, 1, 2, 3].map(() => new THREE.Vector3()),
    normal: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0)),
    planted: [true, true, true, true],
    s: [1, 1, 1, 1],
  };
  private readonly guardDepth = [0, 0, 0, 0];
  /** Per leg, the tucked-leg locals (null without the clip: plain slerp). */
  private readonly legTuck: THREE.Quaternion[][] | null;
  private prevPelvisY = 0;
```

**Edit 3.25 — `src/characters/dragon/motion/dragon.ts`**

> These are the constructor lines Plan 3 Task 12 wrote for its Ruling 3 (the merged `wingFold` layer at weight 1, time 1; `wings_folded` as the fallback). Keep them, whatever their exact form, and add the `WingController` line right after them.

Find:
```ts
    if (this.layers.has('wingFold')) this.layers.set('wingFold', 1, 1);
    else if (this.layers.has('wings_folded')) this.layers.set('wings_folded', 1);
```
Replace with:
```ts
    if (this.layers.has('wingFold')) this.layers.set('wingFold', 1, 1);
    else if (this.layers.has('wings_folded')) this.layers.set('wings_folded', 1);
    this.wings = new WingController(opts.rig, this.skeleton, this.layers, opts.posesMeta ?? { clips: {} }, t.wings);
```

**Edit 3.26 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
    this.mods = { speedCap: Infinity, gait: NO_GAIT_MODS, maxTiltDeg: t.body.maxTiltDeg, up: new THREE.Vector3(0, 1, 0), scripted: false };
```
Replace with:
```ts
    this.mods = { speedCap: Infinity, gait: NO_GAIT_MODS, maxTiltDeg: t.body.maxTiltDeg, up: new THREE.Vector3(0, 1, 0), scripted: false };
    this.legBones = this.legs.legs.map((l) => l.bones);
    this.legSave = this.legBones.map((b) => b.map(() => new THREE.Quaternion()));
    this.legPosed = this.legBones.map((b) => b.map(() => new THREE.Quaternion()));
    const tuckClip = opts.clips?.get(opts.legTuckClip ?? 'jump_tuck');
    if (tuckClip) {
      const pose = new ClipPose(tuckClip, this.skeleton, ['front_', 'hind_']);
      const qs = pose.bones.map(() => new THREE.Quaternion());
      pose.sample(0, qs);
      const byBone = new Map(pose.bones.map((b, k) => [b, qs[k]]));
      this.legTuck = this.legBones.map((bones) => bones.map((b) => (byBone.get(b) ?? this.skeleton.bindLocalQuat[b]).clone()));
    } else this.legTuck = null;
```

**Edit 3.27 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
    this.body.apply(s);
    this.layers.apply(s);
    s.fk();
    this.fillTargets();
```
Replace with:
```ts
    this.body.apply(s);
    this.wings.update(0);
    this.wings.settle();
    this.layers.apply(s);
    this.wings.apply(s);
    s.fk();
    this.fillTargets();
```

**Edit 3.28 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
    s.snapshot();
    // 1) input → intent
```
Replace with:
```ts
    s.snapshot();
    this.cameraPos.copy(frame.cameraPos);
    // 1) input → intent
```

**Edit 3.29 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
    for (const h of this.hooks.beforeMove) h(this, dt);
```
Replace with:
```ts
    for (const h of this.hooks.beforeMove) h(this, dt);
    // pose layers set by behaviours/actions decide which legs they drive; the planner leaves those paws alone
    this.layers.legOwnership(this.own);
    for (let i = 0; i < 4; i++) this.planner.paws[i].posed = this.own[i] > 0;
    this.secondary.breathGain = 1 - (1 - t.pose.breathGainPosed) * Math.max(this.own[1], this.own[3]);
```

**Edit 3.30 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
    // 5) body
    const pose = this.body.update(
```
Replace with:
```ts
    // 5) body (library poses with a root blend the placement)
    this.poseBody();
    const pose = this.body.update(
```

**Edit 3.31 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
    this.body.apply(s);
    this.layers.apply(s);
    this.secondary.applyBreathing(s);
```
Replace with:
```ts
    this.body.apply(s);
    this.wings.update(dt);
    this.layers.apply(s);
    this.wings.apply(s);
    this.secondary.applyBreathing(s);
```

**Edit 3.32 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
    this.fillTargets();
    this.legs.solve(s, this.targets, pose.bodyQuat);
    s.fk();
    this.secondary.applyAppendages(s);
```
Replace with:
```ts
    this.saveOwnedLegs();
    this.fillTargets();
    this.legs.solve(s, this.targets, pose.bodyQuat);
    this.blendOwnedLegs();
    s.fk();
    this.guardOwnedLegs(pose.bodyQuat);
    this.secondary.applyAppendages(s);
```

**Edit 3.33 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
  chestPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.skeleton.worldPos[this.chest]);
  }
```
Replace with:
```ts
  chestPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.skeleton.worldPos[this.chest]);
  }

  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.skeleton.worldPos[this.head]);
  }
```

**Edit 3.34 — `src/characters/dragon/motion/dragon.ts`**

Find:
```ts
  private plannerBody(): PlannerBody {
```
Replace with:
```ts
  /** Body placement from the live pose layers that carry a root (weighted mean over those layers). */
  private poseBody(): void {
    let w = 0;
    let h = 0;
    let p = 0;
    for (const l of this.layers.active()) {
      const r = l.meta.root;
      if (!r) continue;
      w += l.weight;
      h += l.weight * r.height;
      p += l.weight * r.pitch;
    }
    const b = this.body.posture;
    b.weight = Math.min(1, w);
    if (w > 0) {
      b.height = this.kin.pos.y + h / w;
      b.pitch = p / w;
    }
  }

  /** Keep the layered pose of every owned leg before the leg IK overwrites it. */
  private saveOwnedLegs(): void {
    const s = this.skeleton;
    for (let i = 0; i < 4; i++) {
      if (this.own[i] <= 0) continue;
      this.legBones[i].forEach((b, k) => this.legSave[i][k].copy(s.localQuat[b]));
    }
  }

  /**
   * Owned legs: the IK solution blends to the layered pose by the ownership weight — through the tucked leg
   * (IK → tuck for w < ½, tuck → pose above), so a paw lifts and re-places instead of sweeping through the ground.
   */
  private blendOwnedLegs(): void {
    const s = this.skeleton;
    for (let i = 0; i < 4; i++) {
      const w = this.own[i];
      if (w <= 0) continue;
      const tuck = this.legTuck?.[i];
      this.legBones[i].forEach((b, k) => {
        if (!tuck || w >= 1) s.localQuat[b].slerp(this.legSave[i][k], w);
        else if (w < 0.5) s.localQuat[b].slerp(tuck[k], 2 * w);
        else s.localQuat[b].copy(tuck[k]).slerp(this.legSave[i][k], 2 * w - 1);
      });
    }
  }

  /**
   * A posed paw must not sink: wherever an owned sole ends below the ground (a pose held while the body moves, a blend
   * path), that leg is re-solved by the IK onto the ground and blended in by depth / pose.groundGuard (full at 2 cm), so
   * no posed paw goes more than a few millimetres under. The IK's bookkeeping (stretch, shortfall, margin) is kept.
   */
  private guardOwnedLegs(bodyQuat: THREE.Quaternion): void {
    const s = this.skeleton;
    let any = false;
    for (let i = 0; i < 4; i++) {
      this.guardDepth[i] = 0;
      if (this.own[i] <= 0) continue;
      this.legs.soleWorld(i, s, this.guardSole);
      const g = this.world.groundAt(this.guardSole.x, this.guardSole.z, this.guardSole.y + 1, 3, this.guardHit);
      if (!g || g.point.y <= this.guardSole.y) continue;
      this.guardDepth[i] = g.point.y - this.guardSole.y;
      this.guardTargets.sole[i].set(this.guardSole.x, g.point.y + 0.002, this.guardSole.z);
      this.guardTargets.normal[i].copy(g.normal);
      any = true;
    }
    if (!any) return;
    const k = this.guardKeep;
    for (let i = 0; i < 4; i++) {
      k.stretch[i] = this.legs.stretch[i];
      k.shortfall[i] = this.legs.shortfall[i];
      k.margin[i] = this.legs.margin[i];
      this.legBones[i].forEach((b, n) => this.legPosed[i][n].copy(s.localQuat[b]));
      if (this.guardDepth[i] === 0) this.legs.soleWorld(i, s, this.guardTargets.sole[i]);
    }
    this.legs.solve(s, this.guardTargets, bodyQuat);
    for (let i = 0; i < 4; i++) {
      const c = Math.min(1, this.guardDepth[i] / this.tuning.pose.groundGuard);
      this.legBones[i].forEach((b, n) => {
        if (c > 0) s.localQuat[b].copy(_ik.copy(this.legPosed[i][n]).slerp(s.localQuat[b], c));
        else s.localQuat[b].copy(this.legPosed[i][n]);
      });
      this.legs.stretch[i] = k.stretch[i];
      this.legs.shortfall[i] = k.shortfall[i];
      this.legs.margin[i] = k.margin[i];
    }
    s.fk();
  }

  private plannerBody(): PlannerBody {
```

**Edit 3.35 — `src/characters/dragon/motion/climbing.ts`**

> Plan 3 Task 14's climb-mode fold (its Ruling 3: `wingFold` at time 1 − wingsOpen). Replace it however it is written.

Find:
```ts
      if (d.layers.has('wingFold')) d.layers.set('wingFold', 1, 1 - c.wingsOpen);
```
Replace with:
```ts
      d.wings.demand('climb', { flare: d.tuning.wings.climbFlare });
```

**Edit 3.36 — `src/characters/dragon/motion/climbing.ts`**

> Plan 3 Task 14's `resetMods` line that folds the wings again (Ruling 3). Replace it however it is written.

Find:
```ts
    if (d.layers.has('wingFold')) d.layers.set('wingFold', 1, 1);
```
Replace with:
```ts
    d.wings.demand('climb', null);
```

- [ ] **Step 6: Clear out `wingsOpen`**
  - `rg -n wingsOpen src tests public` must print nothing.
  - Plan 3's tuned preset `public/assets/characters/toothless/motion-tuning.json` may carry `"wingsOpen"` under `climb`: delete that key. (`mergeTuning` ignores unknown keys, but a dead key misleads tuners.)
  - If a Plan 3 test asserts the climb-mode fold (`wingFold` at time 1 − wingsOpen), change it to assert `d.wings.target.flare` ≈ `d.tuning.wings.climbFlare` while `d.climb.mode === 'climb'`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- tests/motion` → all pass. That includes the 13 new tests: the 3 library tests read Task 2's export and must not be skipped. Plan 3's `poseLayers`, `metrics`, `dragon` and `climbing` suites pass too. Then `npm run typecheck` → clean, and `npm test` → no suite that passed before fails now.

- [ ] **Step 8: Commit** — the files above. Message: `feat(motion): pose runtime — poses.json v2 layers, leg ownership through the tuck, ground guard, pose placement, wing controller`.

---

### Task 4: Face and mood

**Model:** sonnet (complete code; integration with Plan 2's materials).

**What it does (spec §6.12, §5.7):**
- **Mood.** Calm, curious, excited, tired and aggressive each ease toward a context target through a spring. Calm is what the others leave.
- **Blinks.**
  - scheduled every 2–6 s, sometimes doubled
  - a blink on large head turns
  - slower and heavier lids when tired (tired grows after 40–90 s idle)
  - a posture layer's `blink` curve closes the eyes: asleep
- **Pupils.** Slit when aggressive or in bright sun, round when curious or content. A layer's `pupil` curve takes over by its weight (plasma: slit).
- **Ears.** Perked when curious, back when tired, flat when aggressive. The gallop lay-back stays Plan 3's `SecondaryMotion`; the mood adds an `earBias` to its targets.
- **Expressions.** The gummy smile in content moments; the jaw pants with exertion; live layers add their `face` curves (the yawn's jaw, the plasma charge's snarl, teeth and dorsal glow).
- **`FaceRig`** writes the jaw ABSOLUTELY from bind every step.
  - Rest = closed by `rig.jaw.restCloseRad`; Plan 2's look pass may add it, and it defaults to 0.
  - Open = `openSign · maxOpenRad`.
- **`applyExpression`** copies the state onto the asset once per rendered frame:
  - morphs (blinks via `setBlink` if Plan 2's look pass added it, else `blink_L/R`; `squint`, `smile`, `snarl`, `teeth_out`, `nostril_flare`)
  - the membrane pleat correctives with the wing fold
  - the uniforms `pupil`, `eyeGlow`, `plasmaGlow` and the new **eye gaze**
- **Gaze.** Plan 2's eye shader draws the iris from planar eye UVs, so a gaze offset `(sin yaw, −sin pitch)` in UV units moves the iris toward the look target.
  - Verified in the browser while planning: yaw +0.5 moved both irises toward his left, −0.5 toward his right, pitch +0.5 up.

**Files:**
- Create: `src/characters/dragon/face/{face,faceRig,expression}.ts`, `tests/characters/face.test.ts`
- Modify: `src/characters/dragon/materials.ts` (Plan 2), `src/characters/dragon/motion/{rigTypes,secondary}.ts` (Plan 3)

**Interfaces:**
- Consumes:
  - Task 3: `ActiveLayer`, `sampleCurve`, `tuning.face`
  - Plan 3: `RigSkeleton`, `SecondaryMotion`, `stepSpring`, math helpers
  - Plan 2: `DragonAsset.setMorph(name, w)` (and the optional `setBlink(side, w)`), `DragonMaterials.uniforms`
- Produces:
  - `face.ts`: `Mood`, `MOODS`, `FaceInput`, `createFaceInput()`, `FaceState`; `new FaceController(tuning.face, rng)` with `state`, `blinks`, `update(input, layers, dt) → FaceState`
  - `faceRig.ts`: `new FaceRig(rig, skeleton)` with `jaw`, `head`, `angle(open)`, `apply(s, secondary, state)`
  - `expression.ts`: `ExpressionTarget` (structural subset of `DragonAsset`), `applyExpression(target, state)`
  - edits: `DragonMaterials.uniforms.gaze: { value: THREE.Vector2 }`; `MotionRig.jaw?: { bone; openSign; maxOpenRad; restCloseRad? }`; `SecondaryMotion.earBias`

- [ ] **Step 1: Write the failing tests**

`tests/characters/face.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FaceController, createFaceInput, type FaceInput } from '../../src/characters/dragon/face/face';
import { FaceRig } from '../../src/characters/dragon/face/faceRig';
import { applyExpression, type ExpressionTarget } from '../../src/characters/dragon/face/expression';
import type { ActiveLayer } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { SecondaryMotion } from '../../src/characters/dragon/motion/secondary';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { mulberry32 } from '../../src/core/rng';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { flatWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const T = DEFAULT_TUNING.face;

function run(f: FaceController, patch: Partial<FaceInput>, seconds: number, layers: ActiveLayer[] = [], each?: (t: number) => void): void {
  const inp = { ...createFaceInput(), ...patch };
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    f.update(inp, layers, DT);
    each?.(k * DT);
  }
}

describe('FaceController', () => {
  it('blinks every 2–6 s, sometimes twice in quick succession', () => {
    const f = new FaceController(T, mulberry32(3));
    const starts: number[] = [];
    let seen = 0;
    run(f, {}, 120, [], (t) => {
      if (f.blinks > seen) {
        starts.push(t);
        seen = f.blinks;
      }
    });
    const gaps = starts.slice(1).map((t, k) => t - starts[k]);
    const doubles = gaps.filter((g) => g < 0.6);
    expect(starts.length).toBeGreaterThanOrEqual(20);
    expect(starts.length).toBeLessThanOrEqual(75);
    expect(doubles.length).toBeGreaterThanOrEqual(1);
    for (const g of gaps) if (g >= 0.6) expect(g).toBeGreaterThanOrEqual(T.blinkMin - 1e-9);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(T.blinkMax + 0.5);
  });
  it('is deterministic for a seed', () => {
    const a = new FaceController(T, mulberry32(11));
    const b = new FaceController(T, mulberry32(11));
    run(a, { idle: 30 }, 40);
    run(b, { idle: 30 }, 40);
    expect(a.blinks).toBe(b.blinks);
    expect(a.state.blinkL).toBe(b.state.blinkL);
  });
  it('blinks on a large head turn', () => {
    const f = new FaceController(T, mulberry32(5));
    run(f, {}, 1);
    const before = f.blinks;
    run(f, { headTurnRate: 4 }, DT);
    expect(f.blinks).toBe(before + 1);
    let closed = 0;
    run(f, {}, 0.12, [], () => { closed = Math.max(closed, f.state.blinkL); });
    expect(closed).toBeGreaterThan(0.99);
  });
  it('slits the pupils when aggressive, rounds them when curious, narrows them in bright light', () => {
    const a = new FaceController(T, mulberry32(1));
    run(a, { aggressive: true }, 1.5);
    expect(a.state.pupil).toBeLessThan(0.15);
    const c = new FaceController(T, mulberry32(1));
    run(c, { interested: true }, 4);
    expect(c.state.pupil).toBeGreaterThan(0.8);
    const shade = new FaceController(T, mulberry32(1));
    const sun = new FaceController(T, mulberry32(1));
    run(shade, {}, 3);
    run(sun, { sunInFace: 1 }, 3);
    expect(shade.state.pupil - sun.state.pupil).toBeGreaterThan(0.25);
    expect(sun.state.squint).toBeGreaterThan(0.25);
  });
  it('lays the ears flat when aggressive and perks them when curious', () => {
    const a = new FaceController(T, mulberry32(1));
    run(a, { aggressive: true }, 2);
    expect(a.state.earsDeg).toBeGreaterThan(35);
    const c = new FaceController(T, mulberry32(1));
    run(c, { interested: true }, 4);
    expect(c.state.earsDeg).toBeLessThan(-10);
  });
  it('grows tired after a long idle: heavier lids, slower blinks', () => {
    const f = new FaceController(T, mulberry32(2));
    run(f, { idle: 120 }, 6);
    expect(f.state.mood.tired).toBeGreaterThan(0.95);
    expect(f.state.blinkL).toBeGreaterThanOrEqual(T.tiredLid * 0.95);
  });
  it('adds the live pose layers\' face curves (strongest layer wins; the pupil blends to the layer\'s target)', () => {
    const f = new FaceController(T, mulberry32(4));
    const yawn: ActiveLayer = { name: 'yawn', weight: 0.5, time: 1.2, meta: { mask: ['head'], face: { jaw: [[0, 0], [1.1, 0.95]], smile: [[0, 0.6]] } } };
    const rear: ActiveLayer = { name: 'plasma_rear', weight: 1, time: 0.3, meta: { mask: ['head'], face: { pupil: [[0, 0]], plasmaGlow: [[0, 0], [0.3, 1]] } } };
    run(f, {}, 2, [yawn, rear]);
    expect(f.state.jaw).toBeCloseTo(0.475, 6);
    expect(f.state.smile).toBeCloseTo(0.3, 6);
    expect(f.state.plasmaGlow).toBeCloseTo(1, 6);
    expect(f.state.pupil).toBeLessThan(0.02);
  });
  it('closes the eyes with a posture layer (time 0: its constant curve, scaled by the hop weight)', () => {
    const f = new FaceController(T, mulberry32(5));
    const sleep = (weight: number): ActiveLayer => ({ name: 'sleep', weight, time: 0, meta: { mask: ['head'], face: { blink: [[0, 1]] } } });
    run(f, {}, 0.5, [sleep(0.5)]);
    expect(f.state.blinkL).toBeGreaterThanOrEqual(0.5);
    run(f, {}, 0.5, [sleep(1)]);
    expect(f.state.blinkL).toBe(1);
    expect(f.state.blinkR).toBe(1);
  });
});

describe('FaceRig', () => {
  it('writes the jaw absolutely from bind: closed at rest by restCloseRad, open by openSign · maxOpenRad', () => {
    const rig = { ...toothlessFixtureRig(), jaw: { bone: 'jaw', openSign: -1, maxOpenRad: 0.62, restCloseRad: 0.05 } };
    const s = new RigSkeleton(rig);
    const sec = new SecondaryMotion(rig, s, flatWorld(), DEFAULT_TUNING, mulberry32(1));
    const fr = new FaceRig(rig, s);
    const f = new FaceController(T, mulberry32(1));
    const j = s.id('jaw');
    const about = (a: number) => s.bindLocalQuat[j].clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a));
    for (let k = 0; k < 3; k++) {
      s.resetToBind();
      fr.apply(s, sec, f.state);                    // repeated steps never accumulate
    }
    expect(Math.abs(s.localQuat[j].dot(about(0.05)))).toBeCloseTo(1, 12);
    f.state.jaw = 1;
    s.resetToBind();
    fr.apply(s, sec, f.state);
    expect(Math.abs(s.localQuat[j].dot(about(-0.62)))).toBeCloseTo(1, 12);
  });
  it('hands the ear attitude to SecondaryMotion', () => {
    const rig = toothlessFixtureRig();
    const s = new RigSkeleton(rig);
    const sec = new SecondaryMotion(rig, s, flatWorld(), DEFAULT_TUNING, mulberry32(1));
    const f = new FaceController(T, mulberry32(1));
    f.state.earsDeg = 30;
    new FaceRig(rig, s).apply(s, sec, f.state);
    expect(sec.earBias).toBeCloseTo(THREE.MathUtils.degToRad(30), 12);
  });
});

describe('applyExpression', () => {
  function stub(withBlink: boolean) {
    const morphs: Record<string, number> = {};
    const blinks: Record<string, number> = {};
    const target: ExpressionTarget = {
      setMorph: (n, w) => { morphs[n] = w; },
      ...(withBlink ? { setBlink: (side: 'L' | 'R', w: number) => { blinks[side] = w; } } : {}),
      materials: { uniforms: { pupil: { value: 0 }, eyeGlow: { value: 0 }, plasmaGlow: { value: 0 }, gaze: { value: new THREE.Vector2() } } },
    };
    return { morphs, blinks, target };
  }
  it('writes the morphs and eye/skin uniforms; the gaze as (sin yaw, −sin pitch)', () => {
    const { morphs, target } = stub(false);
    const f = new FaceController(T, mulberry32(1));
    Object.assign(f.state, { blinkL: 0.4, blinkR: 0.6, smile: 0.5, teethOut: 1, pupil: 0.2, plasmaGlow: 0.7, gazeYaw: 0.3, gazePitch: 0.2, pleat: 0.8 });
    applyExpression(target, f.state);
    expect(morphs.blink_L).toBe(0.4);
    expect(morphs.blink_R).toBe(0.6);
    expect(morphs.teeth_out).toBe(1);
    expect(morphs.membrane_pleat_L).toBe(0.8);
    expect(target.materials.uniforms.pupil.value).toBe(0.2);
    expect(target.materials.uniforms.plasmaGlow.value).toBe(0.7);
    expect(target.materials.uniforms.gaze.value.x).toBeCloseTo(Math.sin(0.3), 12);
    expect(target.materials.uniforms.gaze.value.y).toBeCloseTo(-Math.sin(0.2), 12);
  });
  it('blinks through setBlink when the asset has it (Plan 2 look pass)', () => {
    const { morphs, blinks, target } = stub(true);
    const f = new FaceController(T, mulberry32(1));
    f.state.blinkL = 0.5;
    applyExpression(target, f.state);
    expect(blinks.L).toBe(0.5);
    expect(morphs.blink_L).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/characters/face.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/characters/dragon/face/face"`.

- [ ] **Step 3: Create the face modules**

`src/characters/dragon/face/face.ts`:
```ts
import { sampleCurve, type ActiveLayer } from '../motion/poseLayers';
import type { MotionTuning } from '../motion/tuning';
import { clamp, lerp, smoothstep } from '../motion/math';
import { stepSpring, type SpringState } from '../motion/springs';

export type Mood = 'calm' | 'curious' | 'excited' | 'tired' | 'aggressive';
/** Order of the per-mood tables in tuning.face (pupilByMood, earsByMood). */
export const MOODS: readonly Mood[] = ['calm', 'curious', 'excited', 'tired', 'aggressive'];

type FaceTuning = MotionTuning['face'];

/** What the face reads each step (DragonBrain fills it from the character and the behaviours). */
export interface FaceInput {
  /** 0…1 (secondary.exertion). */
  exertion: number;
  gallopWeight: number;
  /** Seconds without movement input. */
  idle: number;
  /** Watching an interest point. */
  interested: boolean;
  /** Charging or firing plasma. */
  aggressive: boolean;
  /** Head yaw speed (rad/s): large head turns blink. */
  headTurnRate: number;
  /** 0…1: how squarely the sun shines into his face (bright light narrows the pupils). */
  sunInFace: number;
  /** Eye rotation from the look controller (rad). */
  eyeYaw: number;
  eyePitch: number;
  /** 0…1: a content moment (the gummy smile), asked for by behaviours. */
  content: number;
  /** Wing fold 0…1 (drives the membrane pleat correctives). */
  wingFold: number;
}

/** Everything the expression binder writes to the asset (morphs, eye/skin uniforms) and the rig (jaw, ears). */
export interface FaceState {
  readonly mood: Record<Mood, number>;
  blinkL: number;
  blinkR: number;
  squint: number;
  smile: number;
  snarl: number;
  teethOut: number;
  nostrilFlare: number;
  /** 0 = closed … 1 = rig.jaw.maxOpenRad open. */
  jaw: number;
  /** 0 = slit … 1 = round. */
  pupil: number;
  eyeGlow: number;
  plasmaGlow: number;
  /** Ear attitude (deg): + lays them back/flat, − perks them forward. */
  earsDeg: number;
  gazeYaw: number;
  gazePitch: number;
  pleat: number;
}

export function createFaceInput(): FaceInput {
  return {
    exertion: 0, gallopWeight: 0, idle: 0, interested: false, aggressive: false, headTurnRate: 0, sunInFace: 0,
    eyeYaw: 0, eyePitch: 0, content: 0, wingFold: 1,
  };
}

/** Layer face curves: channels that take the strongest layer vs channels that blend toward the layer's value. */
const MAX_CHANNELS = ['jaw', 'blink', 'squint', 'smile', 'snarl', 'teeth_out', 'nostril_flare', 'plasmaGlow'] as const;
type MaxChannel = (typeof MAX_CHANNELS)[number];

/**
 * Face and mood (spec §6.12). Mood (calm, curious, excited, tired, aggressive) eases with springs from context; it
 * drives blinks (every 2–6 s, occasional doubles, on large head turns, heavier when tired), the pupils (slit when
 * aggressive or in bright light, round when curious or content), the ears (perked, neutral, flat when aggressive; the
 * gallop lay-back is SecondaryMotion's) and the gummy smile in content moments. Live pose layers add their face
 * curves (the yawn, the plasma charge, sleep's closed eyes). Seeded: the same seed gives the same blinks.
 */
export class FaceController {
  readonly state: FaceState = {
    mood: { calm: 1, curious: 0, excited: 0, tired: 0, aggressive: 0 },
    blinkL: 0, blinkR: 0, squint: 0, smile: 0, snarl: 0, teethOut: 0, nostrilFlare: 0, jaw: 0, pupil: 0.5, eyeGlow: 0.35,
    plasmaGlow: 0, earsDeg: 0, gazeYaw: 0, gazePitch: 0, pleat: 1,
  };
  /** Blinks started so far (tests, debug). */
  blinks = 0;
  private readonly moodS: Record<Mood, SpringState> = {
    calm: { x: 1, v: 0 }, curious: { x: 0, v: 0 }, excited: { x: 0, v: 0 }, tired: { x: 0, v: 0 }, aggressive: { x: 0, v: 0 },
  };
  private readonly pupilS: SpringState = { x: 0.5, v: 0 };
  private readonly earsS: SpringState = { x: 0, v: 0 };
  private readonly layerMax: Record<MaxChannel, number> = {
    jaw: 0, blink: 0, squint: 0, smile: 0, snarl: 0, teeth_out: 0, nostril_flare: 0, plasmaGlow: 0,
  };
  private blinkT = -1;
  private nextBlink: number;
  private sinceBlink = 10;
  private doublePending = false;
  private secondOfDouble = false;

  constructor(private readonly t: FaceTuning, private readonly rng: () => number) {
    this.nextBlink = lerp(t.blinkMin, t.blinkMax, rng());
  }

  update(inp: FaceInput, layers: ReadonlyArray<ActiveLayer>, dt: number): FaceState {
    const t = this.t;
    const st = this.state;
    // 1) mood: each eases toward its context target; calm is what the others leave
    const aggressive = inp.aggressive ? 1 : 0;
    const targets: Record<Mood, number> = {
      calm: 0,
      curious: inp.interested ? 1 : 0,
      excited: clamp(Math.max(inp.exertion * 1.6 - 0.3, inp.gallopWeight), 0, 1),
      tired: smoothstep(t.tiredFrom, t.tiredFull, inp.idle),
      aggressive,
    };
    for (const m of MOODS) {
      if (m === 'calm') continue;
      stepSpring(this.moodS[m], targets[m], m === 'aggressive' && aggressive ? t.moodOmega * 4 : t.moodOmega, 1, dt);
      st.mood[m] = clamp(this.moodS[m].x, 0, 1);
    }
    st.mood.calm = 1 - Math.max(st.mood.curious, st.mood.excited, st.mood.tired, st.mood.aggressive);
    // 2) live pose layers' face curves
    for (const c of MAX_CHANNELS) this.layerMax[c] = 0;
    let pupilW = 0;
    let pupilV = 0;
    let earsW = 0;
    let earsV = 0;
    for (const l of layers) {
      const face = l.meta.face;
      if (!face) continue;
      for (const c of MAX_CHANNELS) {
        const curve = face[c];
        if (curve) this.layerMax[c] = Math.max(this.layerMax[c], sampleCurve(curve, l.time) * l.weight);
      }
      if (face.pupil) {
        pupilW += l.weight;
        pupilV += l.weight * sampleCurve(face.pupil, l.time);
      }
      if (face.ears) {
        earsW += l.weight;
        earsV += l.weight * sampleCurve(face.ears, l.time);
      }
    }
    // 3) blinks: scheduled (2–6 s, sometimes double), on large head turns, slower and heavier when tired
    this.sinceBlink += dt;
    this.nextBlink -= dt;
    const turnBlink = Math.abs(inp.headTurnRate) > t.turnBlinkRate && this.sinceBlink > t.turnBlinkGap;
    if (this.blinkT < 0 && (this.nextBlink <= 0 || turnBlink)) this.startBlink();
    let blink = 0;
    if (this.blinkT >= 0) {
      const slow = 1 + st.mood.tired;
      const close = t.blinkClose * slow;
      const hold = t.blinkHold * slow;
      const open = t.blinkOpen * slow;
      const b = this.blinkT;
      blink = b < close ? b / close : b < close + hold ? 1 : 1 - (b - close - hold) / open;
      this.blinkT += dt;
      if (this.blinkT > close + hold + open) {
        this.blinkT = -1;
        blink = 0;
        if (this.doublePending) {
          this.doublePending = false;
          this.secondOfDouble = true;
          this.nextBlink = t.doubleGap;
        }
      }
    }
    const lid = Math.max(clamp(blink, 0, 1), t.tiredLid * st.mood.tired, this.layerMax.blink);
    st.blinkL = lid;
    st.blinkR = lid;
    // 4) expressions
    st.squint = Math.max(this.layerMax.squint, t.sunSquint * inp.sunInFace, 0.25 * st.mood.tired);
    st.smile = Math.max(this.layerMax.smile, t.contentSmile * inp.content);
    st.snarl = Math.max(this.layerMax.snarl, 0.35 * st.mood.aggressive);
    st.teethOut = this.layerMax.teeth_out;
    st.nostrilFlare = Math.max(this.layerMax.nostril_flare, 0.5 * inp.exertion);
    st.jaw = Math.max(this.layerMax.jaw, t.pantJaw * clamp(inp.exertion * 1.4 - 0.4, 0, 1));
    st.plasmaGlow = this.layerMax.plasmaGlow;
    st.eyeGlow = t.eyeGlow + t.eyeGlowAggressive * st.mood.aggressive;
    // pupils: the mood's size, narrowed by bright light; a layer's pupil target takes over by its weight
    let pupil = 0;
    let ears = 0;
    MOODS.forEach((m, k) => {
      pupil += st.mood[m] * t.pupilByMood[k];
      ears += st.mood[m] * t.earsByMood[k];
    });
    const wsum = MOODS.reduce((a, m) => a + st.mood[m], 0) || 1;
    pupil = pupil / wsum - t.sunNarrow * inp.sunInFace + t.contentPupil * inp.content;
    ears /= wsum;
    if (pupilW > 0) pupil = lerp(pupil, pupilV / pupilW, Math.min(1, pupilW));
    if (earsW > 0) ears = lerp(ears, earsV / earsW, Math.min(1, earsW));
    stepSpring(this.pupilS, clamp(pupil, 0, 1), t.pupilOmega, 1, dt);
    stepSpring(this.earsS, ears, t.earOmega, 1, dt);
    st.pupil = clamp(this.pupilS.x, 0, 1);
    st.earsDeg = this.earsS.x;
    st.gazeYaw = inp.eyeYaw;
    st.gazePitch = inp.eyePitch;
    st.pleat = smoothstep(0.5, 1, inp.wingFold);
    return st;
  }

  private startBlink(): void {
    this.blinkT = 0;
    this.sinceBlink = 0;
    this.blinks++;
    this.nextBlink = lerp(this.t.blinkMin, this.t.blinkMax, this.rng());
    if (this.secondOfDouble) {
      this.secondOfDouble = false;                 // the second blink of a double never doubles again
      return;
    }
    this.doublePending = this.rng() < this.t.doubleBlink;
  }
}
```

`src/characters/dragon/face/faceRig.ts`:
```ts
import * as THREE from 'three';
import type { MotionRig } from '../motion/rigTypes';
import type { RigSkeleton } from '../motion/skeleton';
import type { SecondaryMotion } from '../motion/secondary';
import { deg, lerp } from '../motion/math';
import type { FaceState } from './face';

const AX = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();

/**
 * The face's rig-side channels, written in DragonCharacter's face hook (spec §6.1 step 8): the jaw, ABSOLUTE from bind
 * every step (rest = closed by rig.jaw.restCloseRad, the lips meeting; open = openSign · maxOpenRad), and the ears'
 * mood bias for SecondaryMotion's next step. No pose layer masks the jaw, so nothing else writes it.
 */
export class FaceRig {
  readonly jaw: number;
  /** The head bone (the brain reads its forward axis for "sun in his face"). */
  readonly head: number;
  private readonly closed: number;
  private readonly open: number;

  constructor(rig: MotionRig, s: RigSkeleton) {
    const j = rig.jaw ?? { bone: 'jaw', openSign: -1, maxOpenRad: 0.62 };
    this.jaw = s.id(j.bone);
    this.head = s.id(rig.chains.neck[rig.chains.neck.length - 1]);
    const sign = Math.sign(j.openSign) || -1;
    this.closed = -sign * Math.abs(j.restCloseRad ?? 0);
    this.open = sign * j.maxOpenRad;
  }

  /** Jaw rotation about its local X (rad) for an opening 0…1. */
  angle(open: number): number {
    return lerp(this.closed, this.open, open);
  }

  apply(s: RigSkeleton, secondary: SecondaryMotion, st: FaceState): void {
    s.localQuat[this.jaw].copy(s.bindLocalQuat[this.jaw]).multiply(_q.setFromAxisAngle(AX, this.angle(st.jaw)));
    secondary.earBias = deg(st.earsDeg);
  }
}
```

`src/characters/dragon/face/expression.ts`:
```ts
import type * as THREE from 'three';
import type { FaceState } from './face';

/** The part of Plan 2's DragonAsset the expression binder writes (structural, so tests can pass a stub). */
export interface ExpressionTarget {
  setMorph(name: string, weight: number): void;
  /** Plan 2's look pass: blink through the in-between keys (piecewise). Falls back to the blink_L/R morphs. */
  setBlink?(side: 'L' | 'R', weight: number): void;
  readonly materials: {
    readonly uniforms: {
      pupil: { value: number };
      eyeGlow: { value: number };
      plasmaGlow: { value: number };
      gaze: { value: THREE.Vector2 };
    };
  };
}

/**
 * Copy a FaceState onto the asset once per rendered frame: morph weights, blinks, the membrane pleat correctives, and
 * the eye/skin uniforms. Gaze: the eye shader draws the iris from planar UVs (u toward the dragon's left on both eyes,
 * v downward after the glTF flip), so an eye rotated by yaw/pitch moves the iris centre to (sin yaw, −sin pitch).
 */
export function applyExpression(a: ExpressionTarget, st: FaceState): void {
  if (a.setBlink) {
    a.setBlink('L', st.blinkL);
    a.setBlink('R', st.blinkR);
  } else {
    a.setMorph('blink_L', st.blinkL);
    a.setMorph('blink_R', st.blinkR);
  }
  a.setMorph('squint', st.squint);
  a.setMorph('smile', st.smile);
  a.setMorph('snarl', st.snarl);
  a.setMorph('teeth_out', st.teethOut);
  a.setMorph('nostril_flare', st.nostrilFlare);
  a.setMorph('membrane_pleat_L', st.pleat);
  a.setMorph('membrane_pleat_R', st.pleat);
  const u = a.materials.uniforms;
  u.pupil.value = st.pupil;
  u.eyeGlow.value = st.eyeGlow;
  u.plasmaGlow.value = st.plasmaGlow;
  u.gaze.value.set(Math.sin(st.gazeYaw), -Math.sin(st.gazePitch));
}
```

- [ ] **Step 4: Edit Plan 2/3's files**

**Edit 4.1 — `src/characters/dragon/motion/rigTypes.ts`**

Find:
```ts
  ears: Record<'L' | 'R', string[]>;
```
Replace with:
```ts
  ears: Record<'L' | 'R', string[]>;
  /** Jaw hinge (Plan 2 rig.json; restCloseRad from its look pass). Absent on the fixture rig: 'jaw', -1, 0.62. */
  jaw?: { bone: string; openSign: number; maxOpenRad: number; restCloseRad?: number };
```

**Edit 4.2 — `src/characters/dragon/motion/secondary.ts`**

Find:
```ts
  exertion = 0;
```
Replace with:
```ts
  exertion = 0;
  /** Mood ear attitude (rad, + = back/flat) added to every ear's target — set by the face (M6). */
  earBias = 0;
```

**Edit 4.3 — `src/characters/dragon/motion/secondary.ts`**

Find:
```ts
    for (const e of this.ears) stepSpring(e.s, e.backSign * deg(t.ears.gallopBackDeg) * inp.gallopWeight, t.ears.omega, t.ears.zeta, dt);
```
Replace with:
```ts
    for (const e of this.ears) stepSpring(e.s, e.backSign * (deg(t.ears.gallopBackDeg) * inp.gallopWeight + this.earBias), t.ears.omega, t.ears.zeta, dt);
```

**Edit 4.4 — `src/characters/dragon/materials.ts`**

Find:
```ts
    plasmaGlow: { value: number }; pupil: { value: number }; eyeGlow: { value: number }; irisDepth: { value: number };
    sunDir: { value: THREE.Vector3 };
```
Replace with:
```ts
    plasmaGlow: { value: number }; pupil: { value: number }; eyeGlow: { value: number }; irisDepth: { value: number };
    sunDir: { value: THREE.Vector3 };
    /** Iris offset in eye-UV units (x toward the dragon's left, y down): the eyes' gaze (M6). */
    gaze: { value: THREE.Vector2 };
```

**Edit 4.5 — `src/characters/dragon/materials.ts`**

Find:
```ts
    shader.uniforms.berkIrisDepth = u.irisDepth;
```
Replace with:
```ts
    shader.uniforms.berkIrisDepth = u.irisDepth;
    shader.uniforms.berkEyeGaze = u.gaze;
```

**Edit 4.6 — `src/characters/dragon/materials.ts`**

Find:
```ts
uniform float berkIrisDepth;\nvec3 berkEyeIris;
```
Replace with:
```ts
uniform float berkIrisDepth;\nuniform vec2 berkEyeGaze;\nvec3 berkEyeIris;
```

**Edit 4.7 — `src/characters/dragon/materials.ts`**

Find:
```ts
          vec2 e = uvP * 2.0 - 1.0;
```
Replace with:
```ts
          vec2 e = uvP * 2.0 - 1.0 - berkEyeGaze;
```

**Edit 4.8 — `src/characters/dragon/materials.ts`**

Find:
```ts
irisDepth: { value: 0.08 }, sunDir: { value: opts.sunDir },
```
Replace with:
```ts
irisDepth: { value: 0.08 }, sunDir: { value: opts.sunDir },
    gaze: { value: new THREE.Vector2() },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/characters` → all pass (12 face tests plus Plan 2's `materials`/`asset`/`rigMeta` suites). Then `npm run typecheck` → clean, and `npm test` → no suite that passed before fails now. The gaze shader edit compiles in the browser in Tasks 10 and 11.

- [ ] **Step 6: Commit** — the files above. Message: `feat(dragon): face and mood — blinks, pupils, ears, smile, jaw, layer face curves, eye gaze`.

---

### Task 5: Attention — interest points and who he looks at

**Model:** haiku (transcription).

**What it does (spec §6.8):** the look-target priority is plasma aim > interest points > (Plan 3's own) travel direction > the camera when idle > random glances. The brain (Task 6) hands the winner to `LookController.override`.
- Interest points are scored by weight, proximity, a view cone and motion:
  - The cone is narrow while he moves, so he glances at a butterfly in his path, not behind him.
  - Motion: fish and butterflies beat rocks.
- Boredom: after `dwell` seconds on one point, that point is ignored for `bored` seconds.
- Hysteresis keeps him from flicking between points: an enter threshold above the exit threshold, and a switch ratio.
- `InterestField` reads live lists (a region's `interestPoints` array) afresh on every query, so Plan 5b's moving fish and butterflies need no wiring beyond `addList`.

**Files:**
- Create: `src/characters/dragon/behaviour/attention.ts`, `tests/behaviour/attention.test.ts`

**Interfaces:**
- Consumes: Task 3 `tuning.attention`; Plan 3 math helpers.
- Produces:
  - `InterestPoint { id; kind; position: THREE.Vector3; weight }`, structurally Plan 5a's `Region` `InterestPoint`
  - `InterestField.{addList(list) → undo, register(point) → undo, collect(out)}`
  - `AttentionInput { headPos; heading; speed; aim: THREE.Vector3 | null }`
  - `new Attention(tuning.attention)` with `mode: 'aim' | 'interest' | 'none'`, `target`, `point`, `update(input, field, dt) → boolean`, `score(point, input)`

- [ ] **Step 1: Write the failing test**

`tests/behaviour/attention.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Attention, InterestField, type AttentionInput, type InterestPoint } from '../../src/characters/dragon/behaviour/attention';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';

const DT = 1 / 120;
const T = DEFAULT_TUNING.attention;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const pt = (id: string, p: THREE.Vector3, weight = 1, kind = 'view'): InterestPoint => ({ id, kind, position: p, weight });
const still = (o: Partial<AttentionInput> = {}): AttentionInput => ({ headPos: V(0, 1.5, 2), heading: 0, speed: 0, aim: null, ...o });

function run(a: Attention, f: InterestField, inp: AttentionInput, seconds: number, each?: () => void): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    a.update(inp, f, DT);
    each?.();
  }
}

describe('Attention', () => {
  it('picks the most interesting point by weight and distance', () => {
    const f = new InterestField();
    f.register(pt('far', V(0, 1, 13), 1));
    f.register(pt('near', V(1, 1, 5), 1));
    f.register(pt('faint', V(-1, 1, 4), 0.1));
    const a = new Attention(T);
    run(a, f, still(), 0.5);
    expect(a.mode).toBe('interest');
    expect(a.target?.id).toBe('near');
    expect(a.point.distanceTo(V(1, 1, 5))).toBeLessThan(1e-9);
  });
  it('ignores points outside a narrow cone while moving, but looks well aside when standing', () => {
    const f = new InterestField();
    f.register(pt('side', V(6, 1, 2), 1));                        // ~90° to his left
    const moving = new Attention(T);
    run(moving, f, still({ speed: 3 }), 0.5);
    expect(moving.mode).toBe('none');
    const standing = new Attention(T);
    run(standing, f, still(), 0.5);
    expect(standing.target?.id).toBe('side');
  });
  it('prefers moving things', () => {
    const f = new InterestField();
    const fly = pt('butterfly', V(-2, 1.5, 7), 0.6, 'butterfly');
    f.register(pt('rock', V(2, 1, 7), 0.6));
    f.register(fly);
    const a = new Attention(T);
    run(a, f, still(), 1, () => fly.position.x += 1.2 * DT);
    expect(a.target?.id).toBe('butterfly');
  });
  it('gets bored of one point, looks elsewhere, and comes back later', () => {
    const f = new InterestField();
    f.register(pt('a', V(0, 1, 5), 1));
    f.register(pt('b', V(3, 1, 7), 0.6));
    const a = new Attention(T);
    const seen: string[] = [];
    run(a, f, still(), T.dwell + T.bored + 3, () => {
      const id = a.target?.id ?? '-';
      if (seen[seen.length - 1] !== id) seen.push(id);
    });
    expect(seen.slice(0, 3)).toEqual(['a', 'b', '-']);
    expect(seen).toContain('a');
    expect(seen.lastIndexOf('a')).toBeGreaterThan(0);
  });
  it('puts the plasma aim above every interest point', () => {
    const f = new InterestField();
    f.register(pt('a', V(0, 1, 5), 1));
    const a = new Attention(T);
    run(a, f, still({ aim: V(-10, 2, 20) }), 0.2);
    expect(a.mode).toBe('aim');
    expect(a.point.x).toBe(-10);
  });
  it('reads a live list (a region\'s interestPoints array) on every query', () => {
    const f = new InterestField();
    const region: InterestPoint[] = [];
    const undo = f.addList(region);
    const a = new Attention(T);
    run(a, f, still(), 0.2);
    expect(a.mode).toBe('none');
    region.push(pt('fish', V(0.5, 0.2, 4), 1, 'fish'));
    run(a, f, still(), 0.2);
    expect(a.target?.id).toBe('fish');
    undo();
    run(a, f, still(), 0.2);
    expect(a.mode).toBe('none');
  });
  it('does not flicker between two nearly equal points', () => {
    const f = new InterestField();
    f.register(pt('l', V(-1, 1, 5), 1));
    f.register(pt('r', V(1, 1, 5), 1.05));
    const a = new Attention(T);
    let switches = 0;
    let prev = '';
    run(a, f, still(), 3, () => {
      const id = a.target?.id ?? '-';
      if (id !== prev) switches++;
      prev = id;
    });
    expect(switches).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npm test -- tests/behaviour/attention.test.ts` → `Failed to resolve import "../../src/characters/dragon/behaviour/attention"`.

- [ ] **Step 3: Implement**

`src/characters/dragon/behaviour/attention.ts`:
```ts
import * as THREE from 'three';
import type { MotionTuning } from '../motion/tuning';
import { angleDiff, clamp, deg, smoothstep } from '../motion/math';

/**
 * Something worth looking at — structurally the Cove Region's InterestPoint (Plan 5a `src/world/region.ts`), so a
 * region's live `interestPoints` array plugs straight in; Plan 5b's fish and butterflies move their `position`s.
 */
export interface InterestPoint {
  readonly id: string;
  readonly kind: string;
  readonly position: THREE.Vector3;
  readonly weight: number;
}

/** Where interest comes from: live lists (read afresh on every query, never copied) and single registered points. */
export class InterestField {
  private readonly lists: Array<ReadonlyArray<InterestPoint>> = [];
  private readonly points = new Map<string, InterestPoint>();

  /** A live array — e.g. `region.interestPoints`; later pushes and position changes are seen. Returns the undo. */
  addList(list: ReadonlyArray<InterestPoint>): () => void {
    this.lists.push(list);
    return () => {
      const i = this.lists.indexOf(list);
      if (i >= 0) this.lists.splice(i, 1);
    };
  }

  register(p: InterestPoint): () => void {
    this.points.set(p.id, p);
    return () => {
      if (this.points.get(p.id) === p) this.points.delete(p.id);
    };
  }

  /** Every point, into `out` (reused; no allocation per query). */
  collect(out: InterestPoint[]): InterestPoint[] {
    out.length = 0;
    for (const l of this.lists) for (const p of l) out.push(p);
    for (const p of this.points.values()) out.push(p);
    return out;
  }
}

export interface AttentionInput {
  readonly headPos: THREE.Vector3;
  readonly heading: number;
  readonly speed: number;
  /** The plasma aim point while charging/firing (the top priority), else null. */
  readonly aim: THREE.Vector3 | null;
}

type AttentionTuning = MotionTuning['attention'];
const _d = new THREE.Vector3();

/**
 * Who he looks at (spec §6.8), top priority first: the plasma aim; then interest points, scored by weight, proximity,
 * a view cone (narrow while moving: he glances at a butterfly in his path, not behind him), motion (fish and
 * butterflies beat rocks) and boredom (after `dwell` seconds on one point it is ignored for `bored` seconds), with
 * hysteresis so the gaze does not flicker between two points. Below that, the LookController's own priorities apply
 * (travel direction, the camera when idle, random glances): update() returns false and the brain releases the look.
 */
export class Attention {
  mode: 'aim' | 'interest' | 'none' = 'none';
  target: InterestPoint | null = null;
  readonly point = new THREE.Vector3();
  private dwell = 0;
  private readonly bored = new Map<string, number>();
  private readonly last = new Map<string, THREE.Vector3>();
  private readonly speeds = new Map<string, number>();
  private readonly all: InterestPoint[] = [];

  constructor(private readonly t: AttentionTuning) {}

  update(inp: AttentionInput, field: InterestField, dt: number): boolean {
    for (const [id, left] of this.bored) {
      if (left - dt <= 0) this.bored.delete(id);
      else this.bored.set(id, left - dt);
    }
    const points = field.collect(this.all);
    for (const p of points) {
      const prev = this.last.get(p.id);
      if (prev) {
        this.speeds.set(p.id, prev.distanceTo(p.position) / Math.max(dt, 1e-6));
        prev.copy(p.position);
      } else {
        this.last.set(p.id, p.position.clone());
        this.speeds.set(p.id, 0);
      }
    }
    if (inp.aim) {
      this.mode = 'aim';
      this.target = null;
      this.point.copy(inp.aim);
      return true;
    }
    if (this.target && this.dwell > this.t.dwell) {
      this.bored.set(this.target.id, this.t.bored);        // watched long enough: look for something else now
      this.target = null;
      this.dwell = 0;
    }
    let best: InterestPoint | null = null;
    let bestScore = 0;
    let current = 0;
    for (const p of points) {
      const sc = this.score(p, inp);
      if (p === this.target) current = sc;
      if (sc > bestScore) {
        bestScore = sc;
        best = p;
      }
    }
    const keep = this.target !== null && current > this.t.exit && !(best !== this.target && bestScore > current * this.t.switchRatio);
    if (!keep) {
      const next: InterestPoint | null = bestScore > this.t.enter ? best : null;
      if (next !== this.target) this.dwell = 0;
      this.target = next;
    }
    if (!this.target) {
      this.mode = 'none';
      return false;
    }
    this.dwell += dt;
    this.mode = 'interest';
    this.point.copy(this.target.position);
    return true;
  }

  score(p: InterestPoint, inp: AttentionInput): number {
    const t = this.t;
    if (this.bored.has(p.id)) return 0;
    _d.subVectors(p.position, inp.headPos);
    const dist = _d.length();
    if (dist > t.maxDist) return 0;
    const off = Math.abs(angleDiff(inp.heading, Math.atan2(_d.x, _d.z)));
    const moving = inp.speed > t.movingSpeed;
    const cone = moving
      ? 1 - smoothstep(deg(t.moveCone) * 0.6, deg(t.moveCone), off)
      : 1 - 0.6 * smoothstep(deg(t.stillCone) * 0.4, deg(t.stillCone), off);
    const near = 1 - smoothstep(t.near, t.maxDist, dist);
    const motion = 1 + t.motionBonus * clamp((this.speeds.get(p.id) ?? 0) / 1.5, 0, 1);
    return p.weight * near * cone * motion * (moving ? t.movingFactor : 1);
  }
}
```

- [ ] **Step 4: Run it to verify it passes** — `npm test -- tests/behaviour/attention.test.ts` → 7 pass. Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — the two files. Message: `feat(dragon): attention — plasma aim, scored interest points, boredom and hysteresis`.

---

### Task 6: Behaviours and the brain

**Model:** opus (cross-module integration; the real-rig idle gate).

**What it does (spec §6.10, §6.11):**
- **`BehaviourSelector`** (the §8.1 selector test). This is utility scoring with context, randomness and cooldowns:
  - Small gestures unlock from ~2 s idle, sit at 10 s, lie at 25 s, sleep at 60 s.
  - Gestures: look around, sniff, stretch, shake, yawn, scratch (while sitting), watch (needs interest), ear twitch, tail flick, glance at the camera.
  - "Rest" (do nothing) competes with a fixed weight.
- **`PostureController`** runs stand ↔ sit ↔ lie ↔ sleep one hop at a time.
  - A hop blends the deeper posture's layer over the shallower one.
  - A new target mid-hop reverses the hop in place, so an interrupted lie-down turns straight into getting up.
  - Getting up skips the sit: lie → stand; sleep → lie → stand.
- **`BehaviourSystem`**:
  - gestures with enter / loop / exit (one-shot clips play once; `exit: 'reverse'` plays scratch backwards to the sit)
  - any input interrupts with the exit, and the posture chain gets him up
  - no walking until he stands (`mods.speedCap = 0`, intent cleared)
  - `force(name)` backs `berk.behaviour(name)`, getting into the needed posture first
  - look requests (look around, glance at the camera), "content" for the smile, and ear/tail impulses
- **`DragonBrain`**:
  - `hooks.beforeMove`: behaviours → actions → attention → the look override (aim > interest > behaviour look).
  - The look gain goes to 0 while he curls up asleep, is scaled by each live layer's `look` metadata, and stays 1 while aiming.
  - `hooks.face`: the face.
  - `reset()` stands him up for a lab script start.
- **`LookController`** gains `gain` (scales the applied turn) and a behind-target hysteresis. A target behind him used to flip-flop across ±180°, and with sleep's gain drop that compounded into the spin check.

**Files:**
- Create: `src/characters/dragon/behaviour/{selector,behaviours,brain}.ts`, `tests/behaviour/behaviours.test.ts`
- Modify: `src/characters/dragon/motion/look.ts` (Plan 3 Task 11)

**Interfaces:**
- Consumes:
  - Task 3: `layers.{has, meta, set(…, order), active, weight}`, `loopTime`, `d.headPos`, `d.cameraPos`, `d.wings.state`, `tuning.behaviour`
  - Task 4: `FaceController`, `FaceRig`, `Mood`
  - Task 5: `Attention`, `InterestField`
  - Plan 3:
    - `DragonCharacter`: `hooks.{beforeMove, face}`, `intent.{hasDir, speed, jump, plasma}`, `mods.{speedCap, scripted}`, `kin`, `secondary.{ears, tailYaw, exertion}`, `gait.gallopWeight`
    - `look.{override, headYaw, eyeYaw, eyePitch}`
- Produces:
  - `selector.ts`: `Posture`, `BehaviourContext`, `BehaviourDef`, `BEHAVIOURS`; `new BehaviourSelector(defs, rng, tuning.behaviour)` with `def(name)`, `eligible(def, ctx, now)`, `pick(ctx, now)`, `started(name)`, `ended(name, now)`
  - `behaviours.ts`: `PostureController.{current, target, hop, settled, depth, goTo(p), reset(), update(dt)}`; `BehaviourStepInput`
  - `behaviours.ts`: `BehaviourSystem.{posture, selector, gesture, idle, lookPoint, lookActive, content, autonomous, busy, force(name), reset(), context(mood, interest), step(input, dt)}`
  - `brain.ts`: `DragonAction { name; active; aim; aggressive; step(d, dt, standing) }`; `BrainOptions { rig; seed?; sunDir?; actions? }`
  - `brain.ts`: `new DragonBrain(dragon, options)` with `interest`, `attention`, `behaviours`, `face`, `faceRig`, `actions`, `behaviour(name) → string | string[]`, `reset()`
  - `LookController.gain`

- [ ] **Step 1: Write the failing tests** (the last test reads Task 2's export: 90 s of free idling on the exported rig, sit → lie → sleep, with every §8.2 metric passing and his eyes shut asleep)

`tests/behaviour/behaviours.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { mulberry32 } from '../../src/core/rng';
import { DragonBrain } from '../../src/characters/dragon/behaviour/brain';
import { BEHAVIOURS, BehaviourSelector, type BehaviourContext } from '../../src/characters/dragon/behaviour/selector';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import type { PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const input = (keys: string[] = [], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});
const calm = { calm: 1, curious: 0, excited: 0, tired: 0, aggressive: 0 };
const ctx = (o: Partial<BehaviourContext> = {}): BehaviourContext => ({ idle: 0, posture: 'stand', mood: calm, interest: false, sinceStoodUp: 99, ...o });
const T = DEFAULT_TUNING.behaviour;

describe('BehaviourSelector (spec §8.1)', () => {
  it('waits for each behaviour\'s idle threshold and posture', () => {
    const s = new BehaviourSelector(BEHAVIOURS, mulberry32(1), T);
    const sit = s.def('sit')!;
    expect(s.eligible(sit, ctx({ idle: 9.9 }), 100)).toBe(false);
    expect(s.eligible(sit, ctx({ idle: 10 }), 100)).toBe(true);
    expect(s.eligible(s.def('lie')!, ctx({ idle: 30, posture: 'stand' }), 100)).toBe(false);
    expect(s.eligible(s.def('lie')!, ctx({ idle: 30, posture: 'sit' }), 100)).toBe(true);
    expect(s.eligible(s.def('sleep')!, ctx({ idle: 59, posture: 'lie', mood: { ...calm, tired: 1 } }), 100)).toBe(false);
    expect(s.eligible(s.def('sleep')!, ctx({ idle: 61, posture: 'lie', mood: { ...calm, tired: 1 } }), 100)).toBe(true);
    expect(s.eligible(s.def('scratch')!, ctx({ idle: 20, posture: 'stand' }), 100)).toBe(false);
    expect(s.eligible(s.def('watch')!, ctx({ idle: 5 }), 100)).toBe(false);          // nothing to watch
    expect(s.eligible(s.def('watch')!, ctx({ idle: 5, interest: true }), 100)).toBe(true);
  });
  it('respects cooldowns, counted from when a behaviour ends, and never repeats a running one', () => {
    const s = new BehaviourSelector(BEHAVIOURS, mulberry32(1), T);
    const sniff = s.def('sniff')!;
    s.started('sniff');
    expect(s.eligible(sniff, ctx({ idle: 5 }), 100)).toBe(false);
    s.ended('sniff', 100);
    expect(s.eligible(sniff, ctx({ idle: 5 }), 100 + sniff.cooldown - 0.01)).toBe(false);
    expect(s.eligible(sniff, ctx({ idle: 5 }), 100 + sniff.cooldown)).toBe(true);
  });
  it('draws by utility with a share of plain idling, deterministically for a seed', () => {
    const count = (seed: number) => {
      const s = new BehaviourSelector(BEHAVIOURS, mulberry32(seed), T);
      const n: Record<string, number> = {};
      for (let k = 0; k < 4000; k++) {
        const d = s.pick(ctx({ idle: 5 }), 0);
        n[d?.name ?? 'rest'] = (n[d?.name ?? 'rest'] ?? 0) + 1;
      }
      return n;
    };
    const a = count(3);
    expect(a).toEqual(count(3));
    const sum = T.restWeight + 1 + 0.8 + 0.25 + 0.35 + 0.25 + 0.6 + 0.6 + 0.5;   // eligible utilities at 5 s idle, standing
    expect(a.rest / 4000).toBeCloseTo(T.restWeight / sum, 1);
    expect(a.look_around / 4000).toBeCloseTo(1 / sum, 1);
    expect(a.sit).toBeUndefined();
  });
});

function fixtureDragon(seed = 1, clips?: Map<string, THREE.AnimationClip>, posesMeta?: PosesMeta) {
  const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world, clips, posesMeta, seed });
  d.spawn(0, 0, 0);
  const brain = new DragonBrain(d, { rig: toothlessFixtureRig(), seed });
  return { d, brain, world };
}

describe('BehaviourSystem on the character (fixture rig, no clips)', () => {
  it('idles its way down the posture chain: sit, then lie, then asleep', { timeout: 60_000 }, () => {
    const { d, brain } = fixtureDragon(5);
    const reached: Record<string, number> = {};
    for (let k = 0; k < Math.round(95 / DT); k++) {
      d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
      const p = brain.behaviours.posture.current;
      if (reached[p] === undefined) reached[p] = k * DT;
    }
    expect(reached.sit).toBeGreaterThanOrEqual(10);
    expect(reached.lie).toBeGreaterThanOrEqual(25);
    expect(reached.sleep).toBeGreaterThanOrEqual(60);
    expect(reached.sleep).toBeLessThan(95);
    expect(d.look.gain).toBeLessThan(0.05);
  });
  it('gets up through the chain on input and does not walk until standing', { timeout: 60_000 }, () => {
    const { d, brain } = fixtureDragon(5);
    brain.behaviour('sleep');
    for (let k = 0; k < Math.round(8 / DT); k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(brain.behaviours.posture.current).toBe('sleep');
    const seen: string[] = [];
    const start = d.kin.pos.clone();
    let movedBeforeStanding = 0;
    for (let k = 0; k < Math.round(6 / DT); k++) {
      d.update({ input: input(['KeyW']), cameraYaw: 0, cameraPos: CAM }, DT);
      const p = brain.behaviours.posture;
      if (seen[seen.length - 1] !== p.current) seen.push(p.current);
      if (!(p.settled && p.current === 'stand')) movedBeforeStanding = Math.max(movedBeforeStanding, d.kin.pos.distanceTo(start));
    }
    expect(seen).toEqual(['sleep', 'lie', 'stand']);
    expect(movedBeforeStanding).toBeLessThan(1e-9);
    expect(d.kin.pos.distanceTo(start)).toBeGreaterThan(1);                 // then he walks off
  });
  it('turns a half-done lie-down straight into getting up', () => {
    const { d, brain } = fixtureDragon(2);
    brain.behaviour('sit');
    for (let k = 0; k < 30; k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    const hop = brain.behaviours.posture.hop!;
    expect(hop.dir).toBe(1);
    const p = hop.p;
    d.update({ input: input(['KeyW']), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(brain.behaviours.posture.hop!.dir).toBe(-1);
    expect(brain.behaviours.posture.hop!.p).toBeLessThan(p);
  });
  it('forces a behaviour, getting into the posture it needs first (berk.behaviour)', () => {
    const { d, brain } = fixtureDragon(2);
    expect(brain.behaviour('scratch')).toBe('sit, then scratch');
    for (let k = 0; k < Math.round(2 / DT); k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(brain.behaviours.posture.current).toBe('sit');
    expect(brain.behaviours.gesture?.def.name).toBe('scratch');
    expect(brain.behaviour('nonsense')).toContain('sleep');
  });
  it('resets to standing with no gesture and a fresh idle clock (a lab script start)', () => {
    const { d, brain } = fixtureDragon(2);
    brain.behaviour('scratch');
    for (let k = 0; k < Math.round(3 / DT); k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    brain.reset();
    const b = brain.behaviours;
    expect([b.posture.current, b.posture.target, b.posture.hop, b.gesture, b.idle]).toEqual(['stand', 'stand', null, null, 0]);
    expect(d.layers.active().filter((l) => ['sit', 'lie', 'sleep', 'scratch'].includes(l.name))).toHaveLength(0);
  });
});

describe('gesture interrupts (synthetic sniff clip)', () => {
  it('plays the exit blend at once on input, then lets him walk', () => {
    const rig = toothlessFixtureRig();
    const s = new RigSkeleton(rig);
    const i = s.id('neck_02');
    const q = s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.4));
    const clips = new Map([['sniff', new THREE.AnimationClip('sniff', -1, [new THREE.QuaternionKeyframeTrack('neck_02.quaternion', [0], q.toArray())])]]);
    const meta: PosesMeta = { clips: { sniff: { mask: ['neck_'], blendIn: 0.5, blendOut: 0.4, interrupt: 'exit', duration: 0 } } };
    const { d, brain } = fixtureDragon(4, clips, meta);
    brain.behaviour('sniff');
    for (let k = 0; k < Math.round(0.8 / DT); k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(d.layers.weight('sniff')).toBe(1);
    const ws: number[] = [];
    for (let k = 0; k < Math.round(0.6 / DT); k++) {
      d.update({ input: input(['KeyW']), cameraYaw: 0, cameraPos: CAM }, DT);
      ws.push(d.layers.weight('sniff'));
    }
    expect(brain.behaviours.gesture).toBeNull();
    for (let k = 1; k < ws.length; k++) expect(ws[k]).toBeLessThanOrEqual(ws[k - 1] + 1e-12);
    expect(ws[Math.round(0.4 / DT)]).toBe(0);
    expect(d.kin.speed).toBeGreaterThan(0.5);
  });
});

describe.skipIf(!HAS_LIBRARY)('personality idles on the real rig and library', () => {
  it('idles for 90 s — sits, lies, sleeps — and passes every metric', { timeout: 300_000 }, async () => {
    const a = await loadToothlessMotion();
    const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig: a.rig, world, clips: a.clips, posesMeta: a.posesMeta, seed: 3 });
    d.spawn(0, 0, 0);
    const brain = new DragonBrain(d, { rig: a.rig, seed: 3 });
    const m = new MotionMetrics(world, 29);                       // < 30 s windows: boundedness belongs to the loop script
    const postures = new Set<string>();
    const gestures = new Set<string>();
    let asleep = 0;
    let lidsAsleep = 1;
    for (let k = 0; k < Math.round(90 / DT); k++) {
      d.update({ input: input(), cameraYaw: 0.3, cameraPos: CAM }, DT);
      m.sample(d);
      postures.add(brain.behaviours.posture.current);
      if (brain.behaviours.gesture) gestures.add(brain.behaviours.gesture.def.name);
      asleep = brain.behaviours.posture.settled && brain.behaviours.posture.current === 'sleep' ? asleep + DT : 0;
      if (asleep > 0.5) lidsAsleep = Math.min(lidsAsleep, brain.face.state.blinkL, brain.face.state.blinkR);
    }
    const r = m.report('idle-90s');
    expect(r.failures, JSON.stringify(r)).toEqual([]);
    expect([...postures].sort()).toEqual(['lie', 'sit', 'sleep', 'stand']);
    expect(asleep).toBeGreaterThan(1);                             // still asleep at the end, eyes shut throughout
    expect(lidsAsleep).toBeGreaterThan(0.99);
    expect(gestures.size).toBeGreaterThanOrEqual(3);
    expect(d.nanResets).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail** — `npm test -- tests/behaviour/behaviours.test.ts` → `Failed to resolve import "../../src/characters/dragon/behaviour/brain"`.

- [ ] **Step 3: Implement**

`src/characters/dragon/behaviour/selector.ts`:
```ts
import type { Mood } from '../face/face';
import type { MotionTuning } from '../motion/tuning';

export type Posture = 'stand' | 'sit' | 'lie' | 'sleep';

/** What a behaviour's utility reads. */
export interface BehaviourContext {
  /** Seconds without input (and without moving). */
  readonly idle: number;
  /** The settled posture. */
  readonly posture: Posture;
  readonly mood: Readonly<Record<Mood, number>>;
  /** Attention holds an interest point (a butterfly, a fish…). */
  readonly interest: boolean;
  /** Seconds since he last got up from lying or sleeping. */
  readonly sinceStoodUp: number;
}

export interface BehaviourDef {
  readonly name: string;
  /** 'posture' changes the posture (sit, lie, sleep); 'gesture' plays on top of it. */
  readonly kind: 'posture' | 'gesture';
  /** Idle seconds before it may start (spec §6.11: small ~2 s, sit ~10 s, lie ~25 s, asleep ~60 s). */
  readonly minIdle: number;
  /** Seconds after it ends before it may start again. */
  readonly cooldown: number;
  /** Postures it can start from. */
  readonly from: readonly Posture[];
  /** Utility (0 = not now); multiplied by randomness in pick(). */
  readonly utility: (c: BehaviourContext) => number;
}

type BehaviourTuning = MotionTuning['behaviour'];

/**
 * Utility-based selection with context, randomness and cooldowns (spec §6.11). pick() weighs every eligible
 * behaviour by its utility against a constant "carry on idling" weight and draws one with the seeded RNG. A behaviour
 * is eligible when the idle time has reached its threshold, the posture allows it, its cooldown (counted from when it
 * last ENDED) has passed and its utility is positive.
 */
export class BehaviourSelector {
  private readonly lastEnd = new Map<string, number>();
  private readonly running = new Set<string>();

  constructor(readonly defs: readonly BehaviourDef[], private readonly rng: () => number, private readonly t: BehaviourTuning) {}

  def(name: string): BehaviourDef | undefined {
    return this.defs.find((d) => d.name === name);
  }

  eligible(d: BehaviourDef, c: BehaviourContext, now: number): boolean {
    if (this.running.has(d.name) || c.idle < d.minIdle || !d.from.includes(c.posture)) return false;
    const end = this.lastEnd.get(d.name);
    if (end !== undefined && now - end < d.cooldown) return false;
    return d.utility(c) > 0;
  }

  pick(c: BehaviourContext, now: number): BehaviourDef | null {
    let total = this.t.restWeight;
    const cands: Array<[BehaviourDef, number]> = [];
    for (const d of this.defs) {
      if (!this.eligible(d, c, now)) continue;
      const u = d.utility(c);
      cands.push([d, u]);
      total += u;
    }
    let r = this.rng() * total - this.t.restWeight;
    if (r < 0) return null;
    for (const [d, u] of cands) {
      r -= u;
      if (r < 0) return d;
    }
    return cands.length ? cands[cands.length - 1][0] : null;
  }

  started(name: string): void {
    this.running.add(name);
  }

  ended(name: string, now: number): void {
    this.running.delete(name);
    this.lastEnd.set(name, now);
  }
}

const has = (c: BehaviourContext) => (c.interest ? 1 : 0);

/** The catalogue (spec §6.11). Utilities are relative weights; tune them in the Motion Lab. */
export const BEHAVIOURS: readonly BehaviourDef[] = [
  { name: 'sit', kind: 'posture', minIdle: 10, cooldown: 5, from: ['stand'], utility: () => 1.2 },
  { name: 'lie', kind: 'posture', minIdle: 25, cooldown: 5, from: ['sit'], utility: (c) => 0.8 + 1.5 * c.mood.tired },
  { name: 'sleep', kind: 'posture', minIdle: 60, cooldown: 5, from: ['lie'], utility: (c) => 3 * c.mood.tired },
  { name: 'look_around', kind: 'gesture', minIdle: 2, cooldown: 8, from: ['stand', 'sit', 'lie'], utility: () => 1 },
  { name: 'sniff', kind: 'gesture', minIdle: 2, cooldown: 10, from: ['stand'], utility: () => 0.8 },
  { name: 'stretch', kind: 'gesture', minIdle: 2, cooldown: 30, from: ['stand'], utility: (c) => (c.sinceStoodUp < 6 ? 2.5 : 0.25) },
  { name: 'shake', kind: 'gesture', minIdle: 3, cooldown: 25, from: ['stand'], utility: () => 0.35 },
  { name: 'yawn', kind: 'gesture', minIdle: 4, cooldown: 20, from: ['stand', 'sit', 'lie'], utility: (c) => 0.25 + 1.5 * c.mood.tired },
  { name: 'scratch', kind: 'gesture', minIdle: 10, cooldown: 15, from: ['sit'], utility: () => 0.8 },
  { name: 'watch', kind: 'gesture', minIdle: 2, cooldown: 4, from: ['stand', 'sit', 'lie'], utility: (c) => 3 * has(c) },
  { name: 'ear_twitch', kind: 'gesture', minIdle: 2, cooldown: 3, from: ['stand', 'sit', 'lie'], utility: () => 0.6 },
  { name: 'tail_flick', kind: 'gesture', minIdle: 2, cooldown: 3, from: ['stand', 'sit', 'lie'], utility: () => 0.6 },
  { name: 'glance_camera', kind: 'gesture', minIdle: 3, cooldown: 10, from: ['stand', 'sit', 'lie'], utility: () => 0.5 },
];
```

`src/characters/dragon/behaviour/behaviours.ts`:
```ts
import * as THREE from 'three';
import type { Mood } from '../face/face';
import type { DragonCharacter } from '../motion/dragon';
import type { MotionTuning } from '../motion/tuning';
import { clamp, deg, lerp, smoothstep } from '../motion/math';
import { loopTime } from '../motion/poseLayers';
import { BEHAVIOURS, BehaviourSelector, type BehaviourContext, type BehaviourDef, type Posture } from './selector';

type BehaviourTuning = MotionTuning['behaviour'];

const LAYER: Record<Posture, string | null> = { stand: null, sit: 'sit', lie: 'lie', sleep: 'sleep' };
/** Deeper postures apply after shallower ones (PoseLayerStack order), so a hop is always slerp(shallower, deeper, w). */
const ORDER: Record<Posture, number> = { stand: 0, sit: 0.1, lie: 0.2, sleep: 0.3 };
const DEPTH: Record<Posture, number> = { stand: 0, sit: 1, lie: 2, sleep: 3 };
const DOWN: Record<Posture, Posture | null> = { stand: 'sit', sit: 'lie', lie: 'sleep', sleep: null };
/** Getting up skips the sit: lie → stand, sleep → lie → stand (spec §6.10: he gets up from lying). */
const UP: Record<Posture, Posture | null> = { stand: null, sit: 'stand', lie: 'stand', sleep: 'lie' };
const GESTURE_ORDER = 1;

/**
 * Stand, sit, lie, sleep (spec §6.10–6.11): one hop at a time. A hop blends the deeper posture's layer over the
 * shallower one (whose layer, if any, holds at weight 1): its weight rises going down, falls getting up. A new target
 * mid-hop reverses it in place, so an interrupted lie-down turns straight into getting up.
 */
export class PostureController {
  current: Posture = 'stand';
  target: Posture = 'stand';
  hop: { base: Posture; top: Posture; p: number; dir: 1 | -1 } | null = null;

  constructor(private readonly d: DragonCharacter) {}

  get settled(): boolean {
    return !this.hop && this.current === this.target;
  }

  /** Posture weight of the deeper layer in the current hop (1 when settled below stand). */
  get depth(): number {
    return this.hop ? DEPTH[this.hop.base] + smoothstep(0, 1, this.hop.p) : DEPTH[this.current];
  }

  goTo(p: Posture): void {
    this.target = p;
  }

  /** Standing at once, every posture layer cleared (a lab script start). */
  reset(): void {
    for (const l of Object.values(LAYER)) if (l && this.d.layers.has(l)) this.d.layers.set(l, 0);
    this.current = this.target = 'stand';
    this.hop = null;
  }

  update(dt: number): void {
    const h0 = this.hop;
    if (h0) {
      if (h0.dir > 0 && DEPTH[this.target] <= DEPTH[h0.base]) h0.dir = -1;          // reverse an interrupted lie-down
      else if (h0.dir < 0 && DEPTH[this.target] >= DEPTH[h0.top]) h0.dir = 1;
    } else if (this.current !== this.target) {
      if (DEPTH[this.target] > DEPTH[this.current]) this.hop = { base: this.current, top: DOWN[this.current]!, p: 0, dir: 1 };
      else {
        const base = this.current === 'lie' && this.target === 'sit' ? 'sit' : UP[this.current]!;
        this.hop = { base, top: this.current, p: 1, dir: -1 };
      }
    }
    const h = this.hop;
    if (!h) {
      const l = LAYER[this.current];
      if (l) this.set(l, 1, this.current);
      return;
    }
    const top = LAYER[h.top]!;
    const m = this.d.layers.meta(top);
    const dur = Math.max((h.dir > 0 ? m?.blendIn : m?.blendOut) ?? 0.8, 1e-3);
    h.p = clamp(h.p + (h.dir * dt) / dur, 0, 1);
    const baseLayer = LAYER[h.base];
    if (baseLayer) this.set(baseLayer, 1, h.base);
    this.set(top, smoothstep(0, 1, h.p), h.top);
    if (h.dir > 0 && h.p >= 1) {
      if (baseLayer) this.set(baseLayer, 0, h.base);
      this.current = h.top;
      this.hop = null;
    } else if (h.dir < 0 && h.p <= 0) {
      this.set(top, 0, h.top);
      this.current = h.base;
      this.hop = null;
    }
  }

  private set(layer: string, w: number, p: Posture): void {
    if (this.d.layers.has(layer)) this.d.layers.set(layer, w, 0, false, ORDER[p]);
  }
}

interface Gesture {
  def: BehaviourDef;
  phase: 'enter' | 'loop' | 'exit';
  /** Time in the current phase. */
  t: number;
  /** Time since the gesture started (the clip's time). */
  clock: number;
  hold: number;
  layer: string | null;
  w: number;
  exitFrom: number;
  blendIn: number;
  blendOut: number;
  /** Exit by playing the clip backwards to frame 0 (its first frame is the pose beneath it). */
  reverse: boolean;
  duration: number;
  seed: number;
}

export interface BehaviourStepInput {
  /** Any movement or action input this step. */
  readonly input: boolean;
  readonly mood: Readonly<Record<Mood, number>>;
  readonly interest: boolean;
  readonly cameraPos: THREE.Vector3;
}

/**
 * Personality idles (spec §6.11): the posture chain plus one gesture at a time on top, chosen by the utility selector
 * while he idles, each with enter / loop / exit phases. Any input interrupts: the gesture plays its exit blend and the
 * posture chain gets him up, and he does not walk off until he is standing again. Outputs for the brain: a look
 * request (look around, glance at the camera) and a 0…1 "content" for the gummy smile. `force(name)` backs
 * `berk.behaviour(name)`.
 */
export class BehaviourSystem {
  readonly posture: PostureController;
  readonly selector: BehaviourSelector;
  gesture: Gesture | null = null;
  idle = 0;
  now = 0;
  sinceStoodUp = 99;
  readonly lookPoint = new THREE.Vector3();
  lookActive = false;
  content = 0;
  /** false: only forced behaviours play (scripted lab runs); the selector is not consulted. */
  autonomous = true;
  private think = 0;
  private queued: BehaviourDef | null = null;
  private readonly head = new THREE.Vector3();
  private wasDown = false;

  constructor(private readonly d: DragonCharacter, private readonly t: BehaviourTuning, private readonly rng: () => number) {
    this.posture = new PostureController(d);
    this.selector = new BehaviourSelector(BEHAVIOURS, rng, t);
  }

  get busy(): boolean {
    return this.gesture !== null || !(this.posture.settled && this.posture.current === 'stand');
  }

  /** Start a behaviour now (getting into the posture it needs first). Returns what happens, or the catalogue. */
  force(name: string): string | string[] {
    const def = this.selector.def(name);
    if (!def) return BEHAVIOURS.map((b) => b.name);
    this.idle = Math.max(this.idle, def.minIdle);
    if (def.kind === 'posture') {
      this.stopGesture();
      this.posture.goTo(name as Posture);
      return `posture → ${name}`;
    }
    if (!def.from.includes(this.posture.current) || !this.posture.settled) {
      this.posture.goTo(def.from[0]);
      this.queued = def;
      return `${def.from[0]}, then ${name}`;
    }
    this.startGesture(def);
    return name;
  }

  /** Standing, no gesture or queued behaviour, a fresh idle clock (a lab script start). */
  reset(): void {
    this.stopGesture();
    this.posture.reset();
    this.queued = null;
    this.idle = 0;
    this.think = 0;
    this.sinceStoodUp = 99;
    this.wasDown = false;
    this.lookActive = false;
    this.content = 0;
  }

  context(mood: Readonly<Record<Mood, number>>, interest: boolean): BehaviourContext {
    return { idle: this.idle, posture: this.posture.current, mood, interest, sinceStoodUp: this.sinceStoodUp };
  }

  step(inp: BehaviourStepInput, dt: number): void {
    const d = this.d;
    this.now += dt;
    if (inp.input) {
      this.idle = 0;
      this.queued = null;
      if (this.gesture && this.gesture.phase !== 'exit') this.exitGesture();
      if (this.posture.target !== 'stand') this.posture.goTo('stand');
    } else if (d.kin.speed < 0.2 && !d.mods.scripted) this.idle += dt;
    else this.idle = 0;
    this.posture.update(dt);
    const down = this.posture.current === 'lie' || this.posture.current === 'sleep';
    if (this.wasDown && this.posture.current === 'stand' && this.posture.settled) this.sinceStoodUp = 0;
    else this.sinceStoodUp += dt;
    this.wasDown = down || (this.wasDown && this.posture.current !== 'stand');
    this.stepGesture(inp, dt);
    // no walking or turning until he is standing (posed paws would slide round with the body)
    if (!(this.posture.settled && this.posture.current === 'stand')) {
      d.mods.speedCap = 0;
      d.intent.hasDir = false;
      d.intent.speed = 0;
    }
    if (this.queued && this.posture.settled && this.queued.from.includes(this.posture.current) && !this.gesture) {
      this.startGesture(this.queued);
      this.queued = null;
    }
    this.think -= dt;
    if (this.autonomous && !inp.input && !this.gesture && this.posture.settled && this.think <= 0) {
      this.think = this.t.thinkEvery;
      const def = this.selector.pick(this.context(inp.mood, inp.interest), this.now);
      if (def?.kind === 'posture') {
        this.posture.goTo(def.name as Posture);
        this.selector.started(def.name);
        this.selector.ended(def.name, this.now);
      } else if (def) this.startGesture(def);
    }
  }

  private startGesture(def: BehaviourDef): void {
    this.stopGesture();
    const layer = GESTURE_LAYER[def.name];
    const L = this.d.layers;
    const has = layer !== null && L.has(layer) && (def.name !== 'watch' || this.posture.current === 'stand');
    const m = has ? L.meta(layer!) : undefined;
    const dur = m?.duration ?? 0;
    const blendIn = m?.blendIn ?? 0.25;
    const blendOut = m?.blendOut ?? 0.25;
    const t = this.t;
    const r = this.rng();
    const holds: Record<string, number> = {
      look_around: t.lookAroundHold * 3, sniff: lerp(t.holdMin, t.holdMax, r), stretch: t.stretchHold, scratch: lerp(t.holdMin, t.holdMax, r),
      watch: lerp(t.watchMin, t.watchMax, r), ear_twitch: 0.5, tail_flick: 0.8, glance_camera: t.glanceHold,
    };
    // a one-shot clip plays once: its loop phase is whatever the blends leave of it
    const hold = dur > 0 && !m?.loop ? Math.max(0, dur - blendIn - blendOut) : holds[def.name] ?? 1;
    const reverse = m?.exit === 'reverse';
    this.gesture = {
      def, phase: 'enter', t: 0, clock: 0, hold: reverse ? hold + (m?.loopStart ?? 0) : hold, layer: has ? layer : null, w: 0, exitFrom: 0,
      blendIn, blendOut, reverse, duration: dur, seed: r,
    };
    this.selector.started(def.name);
    if (def.name === 'ear_twitch') {
      const e = this.d.secondary.ears[Math.min(this.d.secondary.ears.length - 1, Math.floor(r * this.d.secondary.ears.length))];
      if (e) e.s.v += (r < 0.5 ? -1 : 1) * t.twitchImpulse;
    } else if (def.name === 'tail_flick') {
      const ty = this.d.secondary.tailYaw;
      for (let k = Math.floor(ty.length / 2); k < ty.length; k++) ty[k].v += (r < 0.5 ? -1 : 1) * t.flickImpulse * (k / ty.length);
    }
  }

  private exitGesture(): void {
    const g = this.gesture!;
    g.exitFrom = g.w;
    g.phase = 'exit';
    g.t = 0;
    if (g.reverse && g.layer) g.clock = loopTime(this.d.layers.meta(g.layer)!, g.duration, g.clock);
  }

  private stopGesture(): void {
    const g = this.gesture;
    if (!g) return;
    if (g.layer) this.d.layers.set(g.layer, 0);
    this.selector.ended(g.def.name, this.now);
    this.gesture = null;
  }

  private stepGesture(inp: BehaviourStepInput, dt: number): void {
    this.lookActive = false;
    this.content = Math.max(0, this.content - dt * 2);
    const g = this.gesture;
    if (!g) return;
    g.t += dt;
    g.clock += g.phase === 'exit' && g.reverse ? -this.t.reverseRate * dt : dt;
    if (g.phase === 'enter') {
      g.w = g.blendIn > 0 ? smoothstep(0, g.blendIn, g.t) : 1;
      if (g.t >= g.blendIn) {
        g.phase = 'loop';
        g.t = 0;
      }
    } else if (g.phase === 'loop') {
      g.w = 1;
      const lostInterest = g.def.name === 'watch' && !inp.interest;
      if (g.t >= g.hold || lostInterest) this.exitGesture();
    } else if (g.reverse) {
      g.w = g.exitFrom;                                  // weight holds while the clip runs back to the pose beneath
      if (g.clock <= 0) {
        this.stopGesture();
        return;
      }
    } else {
      g.w = g.exitFrom * (1 - (g.blendOut > 0 ? smoothstep(0, g.blendOut, g.t) : 1));
      if (g.t >= g.blendOut) {
        this.stopGesture();
        return;
      }
    }
    if (g.layer) this.d.layers.set(g.layer, g.w, g.clock, false, GESTURE_ORDER);
    const d = this.d;
    const head = d.headPos(this.head);
    if (g.def.name === 'look_around') {
      const k = Math.min(2, Math.floor(g.clock / this.t.lookAroundHold));
      const yaw = d.kin.heading + deg([this.t.lookAroundYawDeg, -this.t.lookAroundYawDeg, 0][k]) * (g.seed < 0.5 ? 1 : -1);
      const pitch = deg(k === 2 ? 15 : 0);
      this.lookPoint.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(6).add(head);
      this.lookActive = g.phase !== 'exit';
    } else if (g.def.name === 'glance_camera') {
      this.lookPoint.copy(inp.cameraPos);
      this.lookActive = g.phase !== 'exit';
      this.content = Math.max(this.content, g.w);
    } else if (g.def.name === 'stretch' && g.phase === 'exit') {
      this.content = Math.max(this.content, g.exitFrom);
    }
  }
}

/** Library layer each gesture plays (null: look / impulse only). 'watch' stalks only while standing. */
const GESTURE_LAYER: Record<string, string | null> = {
  look_around: null, sniff: 'sniff', stretch: 'stretch', shake: 'shake', yawn: 'yawn', scratch: 'scratch', watch: 'stalk',
  ear_twitch: null, tail_flick: null, glance_camera: null,
};
```

`src/characters/dragon/behaviour/brain.ts`:
```ts
import * as THREE from 'three';
import { mulberry32 } from '../../../core/rng';
import { FaceController, createFaceInput } from '../face/face';
import { FaceRig } from '../face/faceRig';
import type { DragonCharacter } from '../motion/dragon';
import type { MotionRig } from '../motion/rigTypes';
import { smoothstep } from '../motion/math';
import { stepSpring, type SpringState } from '../motion/springs';
import { Attention, InterestField } from './attention';
import { BehaviourSystem } from './behaviours';

/** An action (jump, plasma) the brain runs before the behaviours' look and face (spec §6.13). */
export interface DragonAction {
  readonly name: string;
  /** Running: behaviours pause, the idle clock resets. */
  readonly active: boolean;
  /** Plasma aim point while charging/firing — the top look priority (spec §6.8). */
  readonly aim: THREE.Vector3 | null;
  /** Face mood input (plasma: aggressive). */
  readonly aggressive: boolean;
  /** Called every step in DragonCharacter.hooks.beforeMove, after the behaviours. `standing` = posture settled on stand. */
  step(d: DragonCharacter, dt: number, standing: boolean): void;
}

export interface BrainOptions {
  rig: MotionRig;
  seed?: number;
  /** Sun direction (toward the sun): bright light narrows the pupils. */
  sunDir?: THREE.Vector3;
  actions?: DragonAction[];
}

const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();

/**
 * Toothless's M6 layer over the motion core: attention (interest points + plasma aim), personality idles, actions,
 * face and mood. It only uses DragonCharacter's hooks, so the motion core stays species-agnostic:
 * - beforeMove: behaviours (idle clock, interrupts, posture chain, gestures) → actions → the look (aim > interest >
 *   behaviour request > the LookController's own travel / camera / glance priorities) and the look gain (0 asleep);
 * - face: FaceController from mood, layers and gaze → FaceRig writes the jaw and the ears' mood bias.
 * `face.state` is what applyExpression copies onto the asset every rendered frame.
 */
export class DragonBrain {
  readonly interest = new InterestField();
  readonly attention: Attention;
  readonly behaviours: BehaviourSystem;
  readonly face: FaceController;
  readonly faceRig: FaceRig;
  readonly actions: DragonAction[];
  private readonly input = createFaceInput();
  private readonly gain: SpringState = { x: 1, v: 0 };
  private readonly head = new THREE.Vector3();
  private readonly sunDir: THREE.Vector3;

  constructor(private readonly d: DragonCharacter, o: BrainOptions) {
    const t = d.tuning;
    const seed = o.seed ?? 1;
    this.attention = new Attention(t.attention);
    this.behaviours = new BehaviourSystem(d, t.behaviour, mulberry32(seed * 7919 + 17));
    this.face = new FaceController(t.face, mulberry32(seed * 104729 + 3));
    this.faceRig = new FaceRig(o.rig, d.skeleton);
    this.actions = o.actions ?? [];
    this.sunDir = o.sunDir ?? new THREE.Vector3(0, 0, 0);
    d.hooks.beforeMove.push((dd, dt) => this.think(dd, dt));
    d.hooks.face.push((dd, dt) => this.express(dd, dt));
  }

  /** berk.behaviour(name). */
  behaviour(name: string): string | string[] {
    return this.behaviours.force(name);
  }

  /** Standing and idle-fresh, no gesture (the lab page calls it when a script starts). */
  reset(): void {
    this.behaviours.reset();
  }

  private think(d: DragonCharacter, dt: number): void {
    const i = d.intent;
    const acting = this.actions.some((a) => a.active);
    const input = i.hasDir || i.jump || i.plasma || acting;
    this.behaviours.step({ input, mood: this.face.state.mood, interest: this.attention.mode === 'interest', cameraPos: d.cameraPos }, dt);
    const standing = this.behaviours.posture.settled && this.behaviours.posture.current === 'stand';
    for (const a of this.actions) a.step(d, dt, standing);
    const aim = this.actions.find((a) => a.aim)?.aim ?? null;
    d.headPos(this.head);
    const attending = this.attention.update({ headPos: this.head, heading: d.kin.heading, speed: d.kin.speed, aim }, this.interest, dt);
    const o = d.look.override;
    if (attending) {
      o.active = true;
      o.point.copy(this.attention.point);
    } else if (this.behaviours.lookActive) {
      o.active = true;
      o.point.copy(this.behaviours.lookPoint);
    } else o.active = false;
    const p = this.behaviours.posture;
    const asleep = p.current === 'sleep' || p.target === 'sleep' || p.hop?.top === 'sleep';   // curling up: the look lets go first
    let gain = asleep ? 0 : 1;
    for (const l of d.layers.active()) if (l.meta.look !== undefined) gain *= 1 - l.weight * (1 - l.meta.look);
    if (attending && this.attention.mode === 'aim') gain = 1;                                 // the plasma aim always turns the head
    stepSpring(this.gain, gain, d.tuning.behaviour.sleepLookOmega, 1, dt);
    d.look.gain = Math.min(1, Math.max(0, this.gain.x));
  }

  private express(d: DragonCharacter, dt: number): void {
    const f = this.input;
    const s = d.skeleton;
    f.exertion = d.secondary.exertion;
    f.gallopWeight = d.gait.gallopWeight;
    f.idle = this.behaviours.idle;
    f.interested = this.attention.mode === 'interest';
    f.aggressive = this.actions.some((a) => a.aggressive);
    f.headTurnRate = d.look.headYaw.v;
    _fwd.set(0, 1, 0).applyQuaternion(s.worldQuat[this.faceRig.head]);
    f.sunInFace = Math.max(0, _fwd.dot(this.sunDir)) * smoothstep(0.02, 0.2, this.sunDir.dot(UP));
    f.eyeYaw = d.look.eyeYaw.x;
    f.eyePitch = d.look.eyePitch.x;
    f.content = this.behaviours.content;
    f.wingFold = d.wings.state.fold;
    const st = this.face.update(f, d.layers.active(), dt);
    this.faceRig.apply(s, d.secondary, st);
  }
}
```

- [ ] **Step 4: Edit Plan 3's look controller**

**Edit 6.1 — `src/characters/dragon/motion/look.ts`**

Find:
```ts
  readonly eyePitch: SpringState = { x: 0, v: 0 };
```
Replace with:
```ts
  readonly eyePitch: SpringState = { x: 0, v: 0 };
  /** 0…1 scale on the applied head/neck turn (M6: 0 while he sleeps, so the curled head stays put). */
  gain = 1;
```

**Edit 6.2 — `src/characters/dragon/motion/look.ts`**

Find:
```ts
    const yaw = clamp(Math.atan2(_d.x, _d.z), -deg(t.yawLimitDeg), deg(t.yawLimitDeg));
```
Replace with:
```ts
    let yawRaw = Math.atan2(_d.x, _d.z);
    // a target behind him: stay on the side the head already turned to (no flip-flop across ±180°)
    if (Math.abs(yawRaw) > deg(t.yawLimitDeg) && Math.abs(this.headYaw.x) > 0.2) yawRaw = Math.sign(this.headYaw.x) * Math.abs(yawRaw);
    const yaw = clamp(yawRaw, -deg(t.yawLimitDeg), deg(t.yawLimitDeg));
```

**Edit 6.3 — `src/characters/dragon/motion/look.ts`**

Find:
```ts
      const yaw = clamp(this.headYaw.x * w, -this.yawLimit, this.yawLimit);
      const pitch = clamp(this.headPitch.x * w, -this.pitchLimit, this.pitchLimit);
```
Replace with:
```ts
      const yaw = clamp(this.headYaw.x * w * this.gain, -this.yawLimit, this.yawLimit);
      const pitch = clamp(this.headPitch.x * w * this.gain, -this.pitchLimit, this.pitchLimit);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/behaviour` → 17 pass. The real-rig idle test must not be skipped (it needs Task 2's export). Then `npm run typecheck` → clean, and `npm test` → no suite that passed before fails now.

If the real-rig idle fails a metric after Plan 2's look pass, read the report's failure. For example, `penetration 0.03 m` means a posed paw or a body part under the ground in a posture. Fix the pose data (Task 2's `library.py`, re-export) or `tuning.pose`, never a threshold.

- [ ] **Step 6: Commit** — the files above. Message: `feat(dragon): personality idles — utility selector, posture chain, gestures with enter/loop/exit, the brain`.

---

### Task 7: The jump

**Model:** sonnet (complete code; integration with climbing and the body solver).

**What it does (spec §6.13):**
- **Crouch** (0.12 s, `jump_crouch`).
- **Takeoff.** Before takeoff it:
  - picks a landing: at least `minForward` ahead, or where a trot carries him
  - rejects walls with rays at three heights over the body's front extent
  - finds the ground and checks that a ballistic arc (apex ≈ 2 m) clears the ground under the body, speeding the arc up if it clips a ledge corner
- **Flight.**
  - He flies the body himself: `mods.scripted`, climbing `suspended`, `body.override` with `snap` so the height follows the arc exactly.
  - The body pitch blends from the launch pose's `bodyPitch` to the landing's.
  - The layers go launch → tuck → land; the wings flare for balance; forced steps plant the paws front first (`frontLag` / `hindLag`).
- **Landing**, with an absorb impulse. A landing keeps `landCarry` speed if no direction is held, so his legs don't over-stretch.
- **Recovery** and cooldown.
- **Metadata.** `jump_land` owns no legs: the leg IK reaches the paws down onto their landing spots.

**Files:**
- Create: `src/characters/dragon/actions/jump.ts`, `tests/actions/jump.test.ts`
- Modify: `src/characters/dragon/motion/climbing.ts` (Plan 3 Task 14)

**Interfaces:**
- Consumes:
  - Task 6: `DragonAction`, `DragonBrain` (`actions` option)
  - Task 3: `body.override.snap`, `wings.demand`, layers + `bodyPitch` metadata, `tuning.jump`
  - Plan 3: `planner.{forceStep(i, point, normal, duration, lift), autoStep, paws}`, `mods.scripted`, `world.{raycast, groundAt}`, `climb.frontExtent`, `intent.jump`
- Produces:
  - `new JumpAction(tuning.jump)` implements `DragonAction`: `phase: 'idle' | 'crouch' | 'air' | 'land'`, `t`, `flight`, `landing: THREE.Vector3`, `active`
  - `ClimbController.suspended: boolean`

- [ ] **Step 1: Write the failing tests**

`tests/actions/jump.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { JumpAction } from '../../src/characters/dragon/actions/jump';
import { DragonBrain } from '../../src/characters/dragon/behaviour/brain';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import type { PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { LEG_KEYS } from '../../src/characters/dragon/motion/rigTypes';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, dropWorld, floor } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const bigFloor = () => CollisionWorld.fromObjects([box(200, 1, 200, 0, -0.5, 0)]);
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});

interface Run { d: DragonCharacter; jump: JumpAction; m: MotionMetrics; apex: number; plants: number[]; flights: number[]; own: number }

function jumpRun(world: CollisionWorld, keysAt: (t: number) => string[], seconds: number, jumpAt: number, rig: MotionRig = toothlessFixtureRig(),
  clips?: Map<string, THREE.AnimationClip>, posesMeta?: PosesMeta, spawnZ = 0): Run {
  const d = new DragonCharacter({ rig, world, clips, posesMeta, seed: 1 });
  d.spawn(0, spawnZ, 0);
  const jump = new JumpAction(d.tuning.jump);
  new DragonBrain(d, { rig, seed: 1, actions: [jump] });
  const m = new MotionMetrics(world, seconds);
  const r: Run = { d, jump, m, apex: -Infinity, plants: [-1, -1, -1, -1], flights: [], own: 0 };
  let takeoffY = 0;
  let was = 'idle';
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = k * DT;
    const press = Math.abs(t - jumpAt) < DT / 2 ? ['Space'] : [];
    d.update({ input: input(keysAt(t), press), cameraYaw: 0, cameraPos: CAM }, DT);
    m.sample(d);
    if (jump.phase === 'air') {
      if (was !== 'air') {
        takeoffY = d.body.pose.pelvisPos.y;
        r.flights.push(jump.flight);
      }
      r.apex = Math.max(r.apex, d.body.pose.pelvisPos.y - takeoffY);
      r.own = Math.max(r.own, d.own[0]);
      d.planner.paws.forEach((p, i) => { if (p.justPlanted && r.plants[i] < 0) r.plants[i] = t; });
    }
    if (jump.phase === 'land') d.planner.paws.forEach((p, i) => { if (p.justPlanted && r.plants[i] < 0) r.plants[i] = t; });
    was = jump.phase;
  }
  return r;
}

describe('JumpAction (fixture rig)', () => {
  it('crouches, rises about 2 m, lands front paws first and passes every metric', { timeout: 60_000 }, () => {
    const r = jumpRun(bigFloor(), () => [], 4, 0.5);
    expect(r.flights).toHaveLength(1);
    expect(r.apex).toBeGreaterThan(1.9);
    expect(r.apex).toBeLessThan(2.15);
    const front = Math.max(r.plants[LEG_KEYS.indexOf('front_L')], r.plants[LEG_KEYS.indexOf('front_R')]);
    const hind = Math.min(r.plants[LEG_KEYS.indexOf('hind_L')], r.plants[LEG_KEYS.indexOf('hind_R')]);
    expect(front).toBeGreaterThan(0);
    expect(hind).toBeGreaterThan(front);
    expect(r.jump.phase).toBe('idle');
    expect(Math.abs(r.d.kin.pos.y)).toBeLessThan(0.02);
    const rep = r.m.report('jump-standing');
    expect(rep.failures, JSON.stringify(rep)).toEqual([]);
  });
  it('carries a trot into the leap and keeps trotting after it', { timeout: 60_000 }, () => {
    const r = jumpRun(bigFloor(), (t) => (t < 5 ? ['KeyW'] : []), 6, 2.5);
    const flight = r.flights[0];
    expect(r.d.kin.pos.z).toBeGreaterThan(3.2 * 2.3 + 3.2 * flight * 0.8);
    const rep = r.m.report('jump-trot');
    expect(rep.failures, JSON.stringify(rep)).toEqual([]);
  });
  it('stops short of a wall in its path', { timeout: 60_000 }, () => {
    const world = CollisionWorld.fromObjects([floor(), box(20, 4, 1, 0, 2, 5.5)]);
    const r = jumpRun(world, (t) => (t < 1.2 ? ['KeyW'] : []), 4, 1.2);
    expect(r.d.chestPos(new THREE.Vector3()).z).toBeLessThan(5);
    expect(r.d.nanResets).toBe(0);
  });
  it('lands on the lower level when it leaps off a ledge', { timeout: 60_000 }, () => {
    const r = jumpRun(dropWorld(2, 3), (t) => (t < 2 ? ['KeyW'] : []), 5, 0.45);
    expect(r.flights[0]).toBeGreaterThan(1.4);
    expect(r.d.kin.pos.y).toBeLessThan(-1.9);
    expect(r.d.nanResets).toBe(0);
  });
});

describe.skipIf(!HAS_LIBRARY)('JumpAction on the real rig with the library', () => {
  it('owns the legs in the air and passes every metric', { timeout: 120_000 }, async () => {
    const a = await loadToothlessMotion();
    const r = jumpRun(bigFloor(), (t) => (t < 4 ? ['KeyW'] : []), 6, 2, a.rig, a.clips, a.posesMeta);
    expect(r.own).toBeGreaterThan(0.99);
    expect(r.apex).toBeGreaterThan(1.9);
    const rep = r.m.report('jump-real');
    expect(rep.failures, JSON.stringify(rep)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail** — `npm test -- tests/actions/jump.test.ts` → `Failed to resolve import "../../src/characters/dragon/actions/jump"`.

- [ ] **Step 3: Implement**

`src/characters/dragon/actions/jump.ts`:
```ts
import * as THREE from 'three';
import type { DragonAction } from '../behaviour/brain';
import type { DragonCharacter } from '../motion/dragon';
import type { RayHit } from '../../../world/collision';
import type { MotionTuning } from '../motion/tuning';
import { lerp, rotY, smoothstep } from '../motion/math';

type JumpTuning = MotionTuning['jump'];
const UP = new THREE.Vector3(0, 1, 0);
const ORDER = 2;
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

/**
 * The jump (spec §6.13): anticipation crouch (~0.12 s) → launch at the speed that gives a `apex`-metre rise, carrying
 * his forward momentum → air pose (legs tuck, tail extends, wings flare for balance) → front-feet-first landing with
 * spine compression and a spring absorb → recovery. The flight is scripted: the body follows the ballistic arc through
 * the body solver's override, every paw takes one forced step from its takeoff spot to its landing spot (front paws a
 * little early, hind a little late) while the launch and tuck poses own the legs; before touchdown the legs go back to
 * the IK, which reaches them down onto their landing spots.
 */
export class JumpAction implements DragonAction {
  readonly name = 'jump';
  phase: 'idle' | 'crouch' | 'air' | 'land' = 'idle';
  t = 0;
  readonly aim = null;
  readonly aggressive = false;
  /** Seconds of the current flight (takeoff → body touchdown) and the landing origin. */
  flight = 0;
  readonly landing = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private y0 = 0;
  private vy = 0;
  private landY = 0;
  private cool = 0;

  constructor(private readonly cfg: JumpTuning) {}

  get active(): boolean {
    return this.phase !== 'idle';
  }

  step(d: DragonCharacter, dt: number, standing: boolean): void {
    const c = this.cfg;
    this.cool = Math.max(0, this.cool - dt);
    this.t += dt;
    const L = d.layers;
    const set = (name: string, w: number, time = 0) => {
      if (L.has(name)) L.set(name, w, time, false, ORDER);
    };
    if (this.phase === 'idle') {
      if (!d.intent.jump || !standing || this.cool > 0 || d.mods.scripted || d.climb.mode !== 'ground') return;
      this.phase = 'crouch';
      this.t = 0;
    }
    if (this.phase === 'crouch') {
      set('jump_crouch', smoothstep(0, c.crouchTime, this.t));
      if (this.t >= c.crouchTime) this.takeoff(d);
      return;
    }
    if (this.phase === 'air') {
      d.climb.suspended = true;
      d.mods.scripted = true;
      d.planner.autoStep = false;
      d.kin.pos.addScaledVector(this.v, dt);
      d.kin.speed = this.v.length();
      const y = this.y0 + this.vy * this.t - 0.5 * c.gravity * this.t * this.t;
      const f = this.t / this.flight;
      // layers: crouch out; launch → tuck crossfade; tuck (the legs' owner) hands the legs back to the IK before touchdown
      set('jump_crouch', 1 - smoothstep(0, 0.1, this.t));
      set('jump_launch', smoothstep(0, 0.06, this.t) * (1 - smoothstep(c.tuckAt, c.tuckAt + 0.15, f)));
      const release = this.flight - c.releaseTime;
      set('jump_tuck', smoothstep(c.tuckAt - 0.1, c.tuckAt + 0.05, f) * (1 - smoothstep(release - 0.12, release, this.t)));
      set('jump_land', smoothstep(this.flight - c.landLead, this.flight - c.landLead + 0.12, this.t));
      d.body.override.active = true;
      d.body.override.snap = true;
      d.body.override.height = Math.max(y, this.landY) + d.body.hipHeight;
      d.body.override.pitch = lerp(this.pitchOf(d, 'jump_launch'), this.pitchOf(d, 'jump_land'), smoothstep(0.35, 1, f));
      d.wings.demand('jump', { flare: 1 }, Math.min(smoothstep(0, 0.15, this.t), 1 - smoothstep(this.flight + 0.1, this.flight + 0.5, this.t)));
      if (this.t >= this.flight) {
        this.phase = 'land';
        this.t = 0;
        d.body.override.active = false;
        d.body.override.snap = false;
        d.body.impulse(c.landImpulse);
        // momentum carries on only if he is asked to keep going; otherwise the landing soaks it up
        const carry = d.intent.hasDir ? this.v.length() : Math.min(this.v.length(), c.landCarry);
        d.kin.velocity.copy(this.v).setLength(carry);
        d.kin.speed = carry;
        d.mods.scripted = false;
        d.planner.autoStep = true;
      }
      return;
    }
    // land: hold the landing shape a moment, then recover; the hind paws may still be touching down
    d.climb.suspended = false;
    set('jump_launch', 0);
    set('jump_tuck', 0);
    set('jump_land', 1 - smoothstep(c.recoverHold, c.recoverHold + c.recoverTime, this.t));
    d.wings.demand('jump', { flare: 1 }, 1 - smoothstep(0, 0.4, this.t));
    if (this.t >= c.recoverHold + c.recoverTime) {
      set('jump_land', 0);
      d.wings.demand('jump', null);
      this.phase = 'idle';
      this.cool = c.cooldown;
    }
  }

  /** First time on the way down that the arc meets the ground under it. */
  private findLanding(d: DragonCharacter): void {
    const c = this.cfg;
    const k = d.kin;
    this.flight = c.maxFlight;
    this.landY = this.y0;
    for (let tt = 0.2; tt <= c.maxFlight; tt += 1 / 120) {
      const y = this.y0 + this.vy * tt - 0.5 * c.gravity * tt * tt;
      _p.copy(k.pos).addScaledVector(this.v, tt);
      const g = d.world.groundAt(_p.x, _p.z, Math.max(y, this.y0) + 2, 60, _hit);
      if (g && this.vy - c.gravity * tt < 0 && y <= g.point.y) {
        this.flight = tt;
        this.landY = g.point.y;
        break;
      }
    }
  }

  /** Paw level (the arc) stays above the ground under the body from the hind feet to the muzzle until touchdown. */
  private clearsArc(d: DragonCharacter): boolean {
    const c = this.cfg;
    const k = d.kin;
    const len = this.v.length();
    if (len < 1e-6) return true;
    const fx = this.v.x / len;
    const fz = this.v.z / len;
    for (let tt = 0.05; tt < this.flight - 0.1; tt += 0.05) {
      const y = this.y0 + this.vy * tt - 0.5 * c.gravity * tt * tt;
      for (const off of [-c.rearExtent, 0, d.climb.frontExtent]) {
        _p.copy(k.pos).addScaledVector(this.v, tt);
        const g = d.world.groundAt(_p.x + fx * off, _p.z + fz * off, y + 3, 6, _hit);
        if (g && g.point.y > y - c.clearance) return false;
      }
    }
    return true;
  }

  private pitchOf(d: DragonCharacter, clip: string): number {
    return d.layers.meta(clip)?.bodyPitch ?? 0;
  }

  /** Launch: ballistic speeds, the landing found along the arc, one forced step per paw to its landing spot. */
  private takeoff(d: DragonCharacter): void {
    const c = this.cfg;
    const k = d.kin;
    this.phase = 'air';
    this.t = 0;
    this.v.set(k.velocity.x, 0, k.velocity.z);
    const fwd = _dir.set(Math.sin(k.heading), 0, Math.cos(k.heading));
    const along = this.v.dot(fwd);
    if (along < c.minForward) this.v.addScaledVector(fwd, c.minForward - along);
    this.vy = Math.sqrt(2 * c.gravity * c.apex);
    this.y0 = k.pos.y;
    // stop short of a wall in the flight path: the body reaches frontExtent ahead of the origin (the muzzle)
    const dist = this.v.length() * (2 * this.vy) / c.gravity;
    if (dist > 1e-3) {
      const reach = d.climb.frontExtent + c.wallMargin;
      let free = dist;
      for (const h of [0.6, 1.2, 1.8]) {
        _p.copy(k.pos).addScaledVector(UP, h);
        const hit = d.world.raycast(_p, _t.copy(this.v).normalize(), dist + reach, _hit);
        if (hit) free = Math.min(free, Math.max(0, hit.distance - reach));
      }
      this.v.multiplyScalar(free / dist);
    }
    // off a ledge the hind quarters trail behind the origin: speed up until the whole body clears the arc
    this.findLanding(d);
    for (let tries = 0; tries < 8 && !this.clearsArc(d); tries++) {
      this.v.multiplyScalar(1.15);
      this.findLanding(d);
    }
    this.landing.copy(k.pos).addScaledVector(this.v, this.flight).setY(this.landY);
    for (let i = 0; i < 4; i++) {
      const front = i === 1 || i === 3;
      rotY(d.planner.neutral[i], k.heading, _t).add(this.landing);
      const g = d.world.groundAt(_t.x, _t.z, this.landY + 2, 6, _hit);
      if (g) _t.y = g.point.y;
      d.planner.forceStep(i, _t, g ? _hit.normal : UP, this.flight + (front ? c.frontLag : c.hindLag), c.minLift);
    }
  }
}
```

**Edit 7.1 — `src/characters/dragon/motion/climbing.ts`**

Find:
```ts
  mode: ClimbMode = 'ground';
  t = 0;
```
Replace with:
```ts
  mode: ClimbMode = 'ground';
  t = 0;
  /** Set by an action that scripts the body itself (the jump's flight): climbing stands aside. */
  suspended = false;
```

**Edit 7.2 — `src/characters/dragon/motion/climbing.ts`**

Find:
```ts
  step(d: DragonCharacter, dt: number): void {
    if (this.mode === 'scramble') {
```
Replace with:
```ts
  step(d: DragonCharacter, dt: number): void {
    if (this.suspended) {                       // an M6 action (the jump) owns the body: no probing, no mods reset
      this.mode = 'ground';
      return;
    }
    if (this.mode === 'scramble') {
```

- [ ] **Step 4: Run the tests to verify they pass** — `npm test -- tests/actions/jump.test.ts` → 5 pass. The real-rig jump must not be skipped. Then `npm run typecheck` → clean, and `npm test -- tests/motion` → Plan 3's climbing suite still passes.

- [ ] **Step 5: Commit** — the files above. Message: `feat(dragon): the jump — anticipation crouch, ballistic flight with tuck, front-feet-first landing and recovery`.

---

### Task 8: Plasma — the action, bolts and impacts, camera shake

**Model:** sonnet (complete code). The FX shaders compile in the browser in Tasks 10 and 11.

**What it does (spec §6.13):**
- **`PlasmaAction`.** A request (F / left click) aims along the page's aim function (the camera ray).
  - If the aim is more than ~100° from his facing he first turns in place (with a timeout).
  - **Charge** 0.3 s: the `plasma_rear` layer carries jaw, teeth, snarl, pupils, ears and dorsal glow; he holds still.
  - **Fire**: a shot from the mouth anchor toward the aim point. Recoil drops the suspension and kicks the head. A small backward skid slides through `resolveMove`.
  - **Recover** and cooldown (0.7 s). The aggression lingers briefly.
- **`PlasmaFx`** (per rendered frame):
  - pooled bolts: an HDR core, a glow sprite, a fading ribbon trail and a moving point light
  - each frame, a sphere cast against the collision world
  - at the first hit: a flash sprite and light, spark and smoke particles, a scorch decal, and a distance-scaled camera shake
  - Lights exist from the start at zero intensity, so firing never changes the light count (no shader recompiles).
  - **The scorch** is a `DecalGeometry` cut from the collision triangles near the impact: a BVH shapecast collects at most 2000 triangles.
    - It costs the same on an 80k-triangle terrain chunk as on a lab box (≤ 3 ms vs 42 ms measured for the whole mesh).
    - It needs no list of target meshes.
    - Its alpha map carries the falloff in RGB, because three.js reads an `alphaMap`'s green channel. The first version drew a dark square.
- **`Particles`**: a CPU pool drawn as `THREE.Points` whose shader caps screen size and fades with distance (spec §12).
- **`OrbitCamera.shake(amplitude, duration)`**: a decaying sum of sines, deterministic. A stronger shake overrides a weaker one.
- **`createToothlessBrain(d, rig, options)`** wires the brain with both actions, for the lab, the game and the tests.

**Files:**
- Create: `src/characters/dragon/actions/plasma.ts`, `src/fx/particles.ts`, `src/fx/plasmaFx.ts`, `src/characters/dragon/toothlessBrain.ts`, `tests/actions/plasma.test.ts`, `tests/fx/plasmaFx.test.ts`
- Modify: `src/camera/orbitCamera.ts` (Plan 3 Task 13)

**Interfaces:**
- Consumes:
  - Task 6: `DragonAction`, `DragonBrain`
  - Task 7: `JumpAction`
  - Task 3: layers, `mods.speedCap`, `tuning.plasma`
  - Plan 3: `rig.anchors.mouth`, `look.headPitch`, `body` springs, `proxies.resolveMove(world, delta, wallNormalY)`, `CollisionWorld.{sphereCast, closestPoint, bvh}`, `OrbitCamera`
- Produces:
  - `plasma.ts`:
    - `PlasmaShot { from; dir }`
    - `new PlasmaAction(rig, dragon, tuning.plasma, aimAt: (d, out) => THREE.Vector3)` with `phase: 'idle' | 'turn' | 'charge' | 'recover'`, `aimPoint`, `shots: PlasmaShot[]` (the page drains them), `fired`, `aim`, `aggressive`, `mouth(d, out)`
  - `particles.ts`: `ParticleOptions`, `ParticleEmit`; `new Particles(options)` with `points`, `material`, `count`, `emit(e)`, `setView(camera, viewportHeight)`, `update(dt)`, `dispose()`
  - `plasmaFx.ts`: `PlasmaFxOptions { world; cfg; prepare?; shake?; seed? }`; `new PlasmaFx(options)` with `root`, `impacts`, `sparks`, `smoke`, `flying`, `decals`, `fire(shot)`, `update(dt, camera, viewportHeight)`, `dispose()`
  - `OrbitCamera.shake(amplitude, duration)`
  - `toothlessBrain.ts`: `ToothlessBrainOptions { seed?; sunDir?; aimAt? }`; `createToothlessBrain(d, rig, options) → { brain, jump, plasma }`

- [ ] **Step 1: Write the failing tests**

`tests/actions/plasma.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { PlasmaAction } from '../../src/characters/dragon/actions/plasma';
import { DragonBrain } from '../../src/characters/dragon/behaviour/brain';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import type { PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});

function setup(aim: THREE.Vector3, rig: MotionRig = toothlessFixtureRig(), clips?: Map<string, THREE.AnimationClip>, posesMeta?: PosesMeta) {
  const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig, world, clips, posesMeta, seed: 1 });
  d.spawn(0, 0, 0);
  const plasma = new PlasmaAction(rig, d, d.tuning.plasma, (_dd, out) => out.copy(aim));
  const brain = new DragonBrain(d, { rig, seed: 1, actions: [plasma] });
  return { world, d, plasma, brain };
}

/** Press F at the given times; run `seconds`. */
function run(s: ReturnType<typeof setup>, presses: number[], seconds: number, each?: (t: number) => void): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = k * DT;
    const press = presses.some((p) => Math.abs(p - t) < DT / 2) ? ['KeyF'] : [];
    s.d.update({ input: input([], press), cameraYaw: 0, cameraPos: CAM }, DT);
    each?.(t);
  }
}

describe('PlasmaAction (fixture rig)', () => {
  it('charges ~0.3 s, fires once from the mouth toward the aim, then cools down ~0.7 s', () => {
    const aim = new THREE.Vector3(2, 1, 20);
    const s = setup(aim);
    const shotAt: number[] = [];
    run(s, [0.5, 0.9, 1.3, 1.6], 2.4, (t) => { while (s.plasma.shots.length) { const shot = s.plasma.shots.shift()!; shotAt.push(t); (s as { last?: typeof shot }).last = shot; } });
    expect(shotAt.length).toBe(2);                                  // 0.9 falls in the cooldown; 1.3 fires; 1.6 is cooling
    expect(shotAt[0]).toBeCloseTo(0.5 + s.d.tuning.plasma.chargeTime, 1);
    expect(shotAt[1] - shotAt[0]).toBeGreaterThanOrEqual(s.d.tuning.plasma.cooldown - 1e-9);
    const last = (s as { last?: { from: THREE.Vector3; dir: THREE.Vector3 } }).last!;
    const mouth = s.plasma.mouth(s.d, new THREE.Vector3());
    expect(last.from.distanceTo(mouth)).toBeLessThan(0.3);
    expect(last.dir.dot(aim.clone().sub(last.from).normalize())).toBeGreaterThan(0.999);
  });
  it('turns to an aim behind him before charging', () => {
    const aim = new THREE.Vector3(0, 1, -20);
    const s = setup(aim);
    let fired = -1;
    run(s, [0.3], 3, (t) => { if (s.plasma.shots.length && fired < 0) fired = t; });
    expect(fired).toBeGreaterThan(0.3 + s.d.tuning.plasma.chargeTime + 0.2);
    expect(Math.cos(s.d.kin.heading)).toBeLessThan(-Math.cos(THREE.MathUtils.degToRad(s.d.tuning.plasma.chargeFacingDeg + 5)));
  });
  it('looks at the aim, recoils and skids a little, and every metric holds', () => {
    const aim = new THREE.Vector3(-3, 2, 25);
    const s = setup(aim);
    const m = new MotionMetrics(s.world, 3);
    let lookedAtAim = false;
    let minH = Infinity;
    let standH = 0;
    run(s, [0.5], 3, (t) => {
      m.sample(s.d);
      if (s.plasma.phase === 'charge' && s.d.look.override.active && s.d.look.override.point.distanceTo(aim) < 1e-9) lookedAtAim = true;
      if (t < 0.5) standH = s.d.body.pose.height;
      if (t > 0.8 && t < 1.2) minH = Math.min(minH, s.d.body.pose.height);
    });
    expect(lookedAtAim).toBe(true);
    expect(standH - minH).toBeGreaterThan(0.02);                    // the recoil dips the suspension
    expect(s.d.kin.pos.z).toBeLessThan(0);                          // skidded back
    expect(s.d.kin.pos.z).toBeGreaterThan(-0.3);
    const r = m.report('plasma');
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});

describe.skipIf(!HAS_LIBRARY)('PlasmaAction on the real rig with the library', () => {
  it('rears up, glows, slits the pupils and fires', { timeout: 60_000 }, async () => {
    const a = await loadToothlessMotion();
    const s = setup(new THREE.Vector3(1, 2, 25), a.rig, a.clips, a.posesMeta);
    let glow = 0;
    let pupil = 1;
    let rear = 0;
    run(s, [0.5], 2.5, () => {
      glow = Math.max(glow, s.brain.face.state.plasmaGlow);
      pupil = Math.min(pupil, s.brain.face.state.pupil);
      rear = Math.max(rear, s.d.layers.weight('plasma_rear'));
    });
    expect(s.plasma.fired).toBe(1);
    expect(rear).toBe(1);
    expect(glow).toBeGreaterThan(0.95);
    expect(pupil).toBeLessThan(0.15);
    expect(s.d.nanResets).toBe(0);
  });
});
```

`tests/fx/plasmaFx.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlasmaFx } from '../../src/fx/plasmaFx';
import { Particles } from '../../src/fx/particles';
import { OrbitCamera } from '../../src/camera/orbitCamera';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld } from '../../src/world/collision';
import { box, floor, flatWorld } from '../fixtures/worlds';

const DT = 1 / 60;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function scene() {
  const wall = box(20, 6, 1, 0, 3, 20.5);                 // near face at z = 20
  const ground = floor();
  const world = CollisionWorld.fromObjects([ground, wall]);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  camera.position.set(0, 3, -6);
  camera.lookAt(0, 1, 10);
  camera.updateMatrixWorld();
  wall.updateMatrixWorld();
  const shakes: number[] = [];
  const fx = new PlasmaFx({ world, cfg: DEFAULT_TUNING.plasma, shake: (a) => shakes.push(a) });
  return { fx, camera, shakes, wall };
}

describe('PlasmaFx', () => {
  it('flies a bolt at the plasma speed and hits the first surface in its path', () => {
    const { fx, camera, shakes } = scene();
    fx.fire({ from: V(0, 1.5, 2), dir: V(0, 0, 1) });
    let frames = 0;
    while (fx.flying && frames < 200) {
      fx.update(DT, camera, 1080);
      frames++;
    }
    expect(fx.impacts).toBe(1);
    const expected = (20 - 2 - DEFAULT_TUNING.plasma.boltRadius) / DEFAULT_TUNING.plasma.boltSpeed;
    expect(frames * DT).toBeGreaterThan(expected - 2 * DT);
    expect(frames * DT).toBeLessThan(expected + 2 * DT);
    expect(fx.sparks.count).toBeGreaterThan(20);
    expect(fx.smoke.count).toBeGreaterThan(4);
    expect(fx.decals).toBe(1);
    expect(shakes).toHaveLength(1);
  });
  it('projects the scorch onto the hit mesh', () => {
    const { fx, camera } = scene();
    fx.fire({ from: V(1, 2, 5), dir: V(0, 0, 1) });
    for (let k = 0; k < 60; k++) fx.update(DT, camera, 1080);
    const scorch = fx.root.children.find((c) => c.name === 'fx-scorch') as THREE.Mesh;
    expect(scorch).toBeTruthy();
    const pos = scorch.geometry.attributes.position;
    expect(pos.count).toBeGreaterThan(3);
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getZ(i) - 20)).toBeLessThan(0.05);   // on the wall's face
    // three.js reads an alphaMap's GREEN channel: the scorch fades out to transparent corners, not a dark square
    const tex = (scorch.material as THREE.MeshStandardMaterial).alphaMap as THREE.DataTexture;
    const { data, width } = tex.image as { data: Uint8Array; width: number };
    const g = (x: number, y: number) => data[(y * width + x) * 4 + 1];
    expect(g(width / 2, width / 2)).toBeGreaterThan(150);
    expect(g(0, 0)).toBe(0);
  });
  it('scorches a big terrain-like mesh from a local patch of its collision triangles', () => {
    // 80 000 triangles, like a Cove terrain chunk: the decal is cut from the few triangles under the impact
    const g = new THREE.PlaneGeometry(200, 200, 200, 200).rotateX(-Math.PI / 2);
    const world = CollisionWorld.fromObjects([new THREE.Mesh(g)]);
    const camera = new THREE.PerspectiveCamera();
    const fx = new PlasmaFx({ world, cfg: DEFAULT_TUNING.plasma });
    fx.fire({ from: V(3.3, 2, 0), dir: V(0, -1, 0.4).normalize() });
    for (let k = 0; k < 30; k++) fx.update(DT, camera, 1080);
    expect(fx.decals).toBe(1);
    const scorch = fx.root.children.find((c) => c.name === 'fx-scorch') as THREE.Mesh;
    const pos = scorch.geometry.attributes.position;
    expect(pos.count).toBeGreaterThan(3);
    expect(pos.count).toBeLessThan(600);
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getY(i))).toBeLessThan(1e-4);                   // on the ground
  });
  it('expires a bolt that hits nothing, and pools bolts and decals', () => {
    const world = flatWorld();
    const camera = new THREE.PerspectiveCamera();
    const fx = new PlasmaFx({ world, cfg: DEFAULT_TUNING.plasma });
    fx.fire({ from: V(0, 5, 0), dir: V(0, 0.2, 1) });
    for (let k = 0; k < 400 && fx.flying; k++) fx.update(DT, camera, 1080);
    expect(fx.flying).toBe(0);
    expect(fx.impacts).toBe(0);
    const lightsBefore = fx.root.children.filter((c) => (c as THREE.PointLight).isPointLight).length;
    for (let k = 0; k < 20; k++) {
      fx.fire({ from: V(0, 2, 0), dir: V(0, -1, 0.3).normalize() });
      for (let j = 0; j < 30; j++) fx.update(DT, camera, 1080);
    }
    expect(fx.impacts).toBe(20);
    expect(fx.decals).toBeLessThanOrEqual(12);
    expect(fx.root.children.filter((c) => (c as THREE.PointLight).isPointLight).length).toBe(lightsBefore);
  });
});

describe('Particles', () => {
  it('ages, fades and recycles particles; the shader caps their screen size', () => {
    const p = new Particles({ capacity: 4, additive: true, maxPixels: 12, fadeNear: 10, fadeFar: 20, gravity: 9.81, drag: 0 });
    for (let k = 0; k < 6; k++) p.emit({ pos: V(0, 0, 0), vel: V(0, 5, 0), life: 0.5 + k * 0.1, size: 0.1, grow: 0, color: new THREE.Color(1, 1, 1), alpha: 1 });
    expect(p.count).toBe(4);
    p.update(0.55);
    expect(p.count).toBe(3);
    p.update(1);
    expect(p.count).toBe(0);
    expect(p.material.fragmentShader).toContain('discard');
    expect(p.material.vertexShader).toContain('min(aSize * uScale / dist, uMaxPx)');
  });
});

describe('OrbitCamera.shake', () => {
  it('shakes the view and settles back', () => {
    const cam = new OrbitCamera(DEFAULT_TUNING.camera, flatWorld());
    const f = { chest: V(0, 1.25, 0), velocity: V(0, 0, 0), heading: 0, moving: false, climbing: false, bodySpheres: [] };
    cam.reset(f);
    for (let k = 0; k < 240; k++) cam.update({ mouseDX: 0, mouseDY: 0, wheel: 0 }, f, 1 / 120);
    const rest = cam.position.clone();
    cam.shake(0.12, 0.35);
    let maxOff = 0;
    for (let k = 0; k < 30; k++) {
      cam.update({ mouseDX: 0, mouseDY: 0, wheel: 0 }, f, 1 / 120);
      maxOff = Math.max(maxOff, cam.position.distanceTo(rest));
    }
    expect(maxOff).toBeGreaterThan(0.02);
    for (let k = 0; k < 60; k++) cam.update({ mouseDX: 0, mouseDY: 0, wheel: 0 }, f, 1 / 120);
    expect(cam.position.distanceTo(rest)).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 2: Run them to verify they fail** — `npm test -- tests/actions/plasma.test.ts tests/fx` → `Failed to resolve import …/actions/plasma` and `…/fx/plasmaFx`.

- [ ] **Step 3: Implement**

`src/characters/dragon/actions/plasma.ts`:
```ts
import * as THREE from 'three';
import type { DragonAction } from '../behaviour/brain';
import type { DragonCharacter } from '../motion/dragon';
import type { MotionRig } from '../motion/rigTypes';
import type { MotionTuning } from '../motion/tuning';
import { angleDiff, deg, smoothstep } from '../motion/math';

type PlasmaTuning = MotionTuning['plasma'];
const ORDER = 2;
const _m = new THREE.Vector3();
const _d = new THREE.Vector3();

/** A bolt leaving his mouth; the FX layer takes it from PlasmaAction.shots. */
export interface PlasmaShot {
  readonly from: THREE.Vector3;
  readonly dir: THREE.Vector3;
}

/**
 * The plasma blast (spec §6.13). F / left click: if the aim is more than ~100° off his facing he turns to it first;
 * then a ~0.3 s charge (the plasma_rear layer: head rears, jaw opens, teeth out, ears flat, pupils slit, dorsal plates
 * glow — its face curves); the bolt leaves the mouth anchor toward the aim point; a recoil kicks the head up, dips the
 * suspension and skids him back a little; then a ~0.7 s cooldown. The aim point comes from `aimAt` (the game: the
 * camera's aim ray) and is his top look priority while he charges and fires.
 */
export class PlasmaAction implements DragonAction {
  readonly name = 'plasma';
  phase: 'idle' | 'turn' | 'charge' | 'recover' = 'idle';
  t = 0;
  readonly aimPoint = new THREE.Vector3();
  /** Fired and not yet taken by the FX. */
  readonly shots: PlasmaShot[] = [];
  fired = 0;
  private cool = 0;
  private linger = 0;
  private skid = 0;
  private readonly mouthBone: number;
  private readonly mouthLocal: THREE.Vector3;

  constructor(
    rig: MotionRig, d: DragonCharacter, private readonly cfg: PlasmaTuning,
    private readonly aimAt: (d: DragonCharacter, out: THREE.Vector3) => THREE.Vector3,
  ) {
    const a = rig.anchors.mouth ?? { bone: rig.chains.neck[rig.chains.neck.length - 1], position: [0, 1.375, 2.2] as [number, number, number] };
    this.mouthBone = d.skeleton.id(a.bone);
    this.mouthLocal = d.skeleton.bindToLocal(this.mouthBone, new THREE.Vector3(...a.position), new THREE.Vector3());
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  get aim(): THREE.Vector3 | null {
    return this.phase === 'idle' ? null : this.aimPoint;
  }

  get aggressive(): boolean {
    return this.phase !== 'idle' || this.linger > 0;
  }

  /** World position of the mouth anchor (the muzzle). */
  mouth(d: DragonCharacter, out: THREE.Vector3): THREE.Vector3 {
    return d.skeleton.toWorld(this.mouthBone, this.mouthLocal, out);
  }

  step(d: DragonCharacter, dt: number, standing: boolean): void {
    const c = this.cfg;
    this.cool = Math.max(0, this.cool - dt);
    this.linger = Math.max(0, this.linger - dt);
    this.t += dt;
    const L = d.layers;
    if (this.phase === 'idle') {
      if (!d.intent.plasma || !standing || this.cool > 0 || d.mods.scripted) return;
      this.aimAt(d, this.aimPoint);
      this.phase = Math.abs(this.offAim(d)) > deg(c.turnFirstDeg) ? 'turn' : 'charge';
      this.t = 0;
    }
    if (this.phase === 'turn') {
      this.aimAt(d, this.aimPoint);
      _d.subVectors(this.aimPoint, d.kin.pos);
      const len = Math.hypot(_d.x, _d.z) || 1;
      d.intent.hasDir = true;
      d.intent.dirX = _d.x / len;
      d.intent.dirZ = _d.z / len;
      d.intent.speed = 0;                                   // turn on the spot
      if (Math.abs(this.offAim(d)) < deg(c.chargeFacingDeg) || this.t > c.turnTimeout) {
        this.phase = 'charge';
        this.t = 0;
      }
      return;
    }
    if (this.phase === 'charge') {
      this.aimAt(d, this.aimPoint);
      d.mods.speedCap = 0;
      d.intent.hasDir = false;
      if (L.has('plasma_rear')) L.set('plasma_rear', smoothstep(0, L.meta('plasma_rear')?.blendIn ?? 0.15, this.t), this.t, false, ORDER);
      if (this.t >= c.chargeTime) this.fire(d);
      return;
    }
    // recover: the rear-up blends out while the charge's face curves play on; the skid decays
    const bo = L.meta('plasma_rear')?.blendOut ?? 0.3;
    if (L.has('plasma_rear')) L.set('plasma_rear', 1 - smoothstep(0, bo, this.t), c.chargeTime + this.t, false, ORDER);
    if (this.skid > 1e-3) {
      _d.set(-Math.sin(d.kin.heading), 0, -Math.cos(d.kin.heading)).multiplyScalar(this.skid * dt);
      d.proxies.update(d.skeleton);
      d.proxies.resolveMove(d.world, _d, d.tuning.body.wallNormalY);
      d.kin.pos.add(_d);
      this.skid *= Math.exp(-c.skidDecay * dt);
    }
    if (this.t >= bo) {
      if (L.has('plasma_rear')) L.set('plasma_rear', 0);
      this.phase = 'idle';
    }
  }

  private offAim(d: DragonCharacter): number {
    return angleDiff(d.kin.heading, Math.atan2(this.aimPoint.x - d.kin.pos.x, this.aimPoint.z - d.kin.pos.z));
  }

  private fire(d: DragonCharacter): void {
    const c = this.cfg;
    this.mouth(d, _m);
    this.shots.push({ from: _m.clone(), dir: _d.subVectors(this.aimPoint, _m).normalize().clone() });
    this.fired++;
    d.body.impulse(c.recoilDrop);
    d.look.headPitch.v += c.recoilKick;
    this.skid = c.skidSpeed;
    this.cool = c.cooldown;
    this.linger = c.lingerAggro;
    this.phase = 'recover';
    this.t = 0;
  }
}
```

`src/fx/particles.ts`:
```ts
import * as THREE from 'three';

export interface ParticleOptions {
  capacity: number;
  /** Additive (sparks, flashes) or normal alpha blending (smoke). */
  additive: boolean;
  /** Screen-size cap in pixels: particles never become big discs close to the camera (the old "snow" motes). */
  maxPixels: number;
  /** Distance fade (m): full at fadeNear, gone at fadeFar. */
  fadeNear: number;
  fadeFar: number;
  gravity: number;
  /** Velocity damping (1/s). */
  drag: number;
}

export interface ParticleEmit {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly life: number;
  /** World size (m) at birth and its growth (m/s). */
  readonly size: number;
  readonly grow: number;
  readonly color: THREE.Color;
  readonly alpha: number;
}

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
uniform float uMaxPx;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.01);
  gl_PointSize = min(aSize * uScale / dist, uMaxPx);
  vColor = vec4(aColor.rgb, aColor.a * (1.0 - smoothstep(uFadeNear, uFadeFar, dist)));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vColor.a * (1.0 - smoothstep(0.35, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

/**
 * A small CPU particle pool drawn as one THREE.Points: soft discs, size-capped in pixels and distance-faded (spec §7.9,
 * §12). Live particles are packed at the front of the buffers; `update` integrates gravity and drag, ages, fades
 * (alpha falls with age) and grows them. Transparent and depth-write off, so N8AO's transparency-aware pass keeps
 * them out of its depth/normal prepass (spec §4.6).
 */
export class Particles {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  count = 0;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly grow: Float32Array;
  private readonly alpha: Float32Array;
  private readonly geo = new THREE.BufferGeometry();

  constructor(private readonly o: ParticleOptions) {
    const n = o.capacity;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      name: o.additive ? 'fx-particles-add' : 'fx-particles',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 }, uMaxPx: { value: o.maxPixels }, uFadeNear: { value: o.fadeNear }, uFadeFar: { value: o.fadeFar } },
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(e: ParticleEmit): void {
    if (this.count >= this.o.capacity) return;
    const i = this.count++;
    this.pos.set([e.pos.x, e.pos.y, e.pos.z], i * 3);
    this.vel.set([e.vel.x, e.vel.y, e.vel.z], i * 3);
    this.col.set([e.color.r, e.color.g, e.color.b, e.alpha], i * 4);
    this.size[i] = e.size;
    this.grow[i] = e.grow;
    this.alpha[i] = e.alpha;
    this.age[i] = 0;
    this.life[i] = e.life;
  }

  /** Pixels per metre at 1 m from the camera (viewport height / (2·tan(fov/2))). */
  setView(camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  update(dt: number): void {
    const damp = Math.exp(-this.o.drag * dt);
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const p = i * 3;
      this.vel[p] *= damp;
      this.vel[p + 1] = this.vel[p + 1] * damp - this.o.gravity * dt;
      this.vel[p + 2] *= damp;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.age[i] / this.life[i];
      this.col[i * 4 + 3] = this.alpha[i] * (1 - f) * (1 - f);
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    for (const name of ['position', 'aColor', 'aSize']) (this.geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }

  /** Move the last live particle into slot i. */
  private kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.col.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.size[i] = this.size[j];
    this.grow[i] = this.grow[j];
    this.alpha[i] = this.alpha[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
  }
}
```

`src/fx/plasmaFx.ts`:
```ts
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import type { CollisionWorld } from '../world/collision';
import type { MotionTuning } from '../characters/dragon/motion/tuning';
import type { PlasmaShot } from '../characters/dragon/actions/plasma';
import { mulberry32 } from '../core/rng';
import { Particles } from './particles';

export interface PlasmaFxOptions {
  world: CollisionWorld;
  cfg: MotionTuning['plasma'];
  /** The app material pipeline (fog + CSM) for the lit scorch material. */
  prepare?: (m: THREE.Material) => void;
  /** Camera shake at an impact (amplitude m, duration s) — OrbitCamera.shake. */
  shake?: (amplitude: number, duration: number) => void;
  seed?: number;
}

/** Visual constants (not motion): linear HDR colours above 1 bloom (spec §4.2). */
const FX = {
  core: new THREE.Color(0.55, 0.85, 3.6), glow: new THREE.Color(0.35, 0.6, 1.8), trail: new THREE.Color(0.3, 0.55, 2.2),
  light: new THREE.Color(0.45, 0.65, 1.0), spark: new THREE.Color(0.8, 0.9, 2.4), smoke: new THREE.Color(0.14, 0.14, 0.16),
  coreRadius: 0.13, glowSize: 1.2, trailPoints: 18, trailSpacing: 0.28, trailWidth: 0.22, lightIntensity: 9, lightDistance: 16,
  flashSize: 3.6, flashTime: 0.14, impactLight: 40, impactLightTime: 0.3, sparkCount: 36, smokeCount: 9, scorchSize: 1.8, scorchLife: 30,
  maxDecals: 12, maxPatchTris: 2000,
};

/**
 * Soft round falloff, procedural (no image loading). Glow/flash sprites (rng null): white, the falloff in alpha. The
 * scorch (rng given): an alphaMap, which three.js reads from the GREEN channel — so the falloff goes into RGB too.
 */
function radialTexture(size: number, rng: (() => number) | null): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(dx, dy);
      let a = Math.max(0, 1 - r);
      a = a * a * (3 - 2 * a);
      if (rng) a *= 0.65 + 0.35 * rng();                // a blotchy scorch edge
      const i = (y * size + x) * 4;
      const v = Math.round(255 * Math.min(1, a * (rng ? 1.4 : 1)));
      data[i] = data[i + 1] = data[i + 2] = rng ? v : 255;
      data[i + 3] = v;
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.needsUpdate = true;
  return t;
}

const TRAIL_VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(uColor, vAlpha); }`;

interface Bolt {
  alive: boolean;
  readonly pos: THREE.Vector3;
  readonly dir: THREE.Vector3;
  traveled: number;
  readonly history: THREE.Vector3[];
  readonly core: THREE.Mesh;
  readonly glow: THREE.Sprite;
  readonly trail: THREE.Mesh;
  readonly light: THREE.PointLight;
}

interface Flash {
  readonly sprite: THREE.Sprite;
  readonly light: THREE.PointLight;
  t: number;
}

interface Scorch {
  readonly mesh: THREE.Mesh;
  age: number;
}

const _next = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _n = new THREE.Vector3();
const _side = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Plasma bolts and impacts (spec §6.13): a hot core, a glow sprite and a fading ribbon trail, carrying a moving
 * light; at the first hit (a sphere cast against the collision world each frame) a flash, sparks, smoke, a projected
 * scorch decal and a small camera shake. The two bolt lights and the flash light exist from the start with zero
 * intensity, so firing never changes the scene's light count (no shader recompiles). Bolts, flashes and decals are
 * pooled. Runs per rendered frame; `fire` takes the shots PlasmaAction pushes.
 */
export class PlasmaFx {
  readonly root = new THREE.Group();
  impacts = 0;
  readonly sparks: Particles;
  readonly smoke: Particles;
  private readonly bolts: Bolt[] = [];
  private readonly flash: Flash;
  private readonly scorches: Scorch[] = [];
  private readonly scorchMaterial: THREE.MeshStandardMaterial;
  private readonly glowTex = radialTexture(64, null);
  private readonly scorchTex: THREE.DataTexture;
  private readonly rng: () => number;
  private readonly camPos = new THREE.Vector3();

  constructor(private readonly o: PlasmaFxOptions) {
    this.root.name = 'PlasmaFx';
    this.rng = mulberry32(o.seed ?? 99);
    this.scorchTex = radialTexture(64, this.rng);
    for (let k = 0; k < 2; k++) this.bolts.push(this.makeBolt());
    const flashMat = new THREE.SpriteMaterial({ map: this.glowTex, color: FX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.flash = { sprite: new THREE.Sprite(flashMat), light: new THREE.PointLight(FX.light, 0, FX.lightDistance * 1.5, 2), t: 1 };
    this.flash.sprite.visible = false;
    this.root.add(this.flash.sprite, this.flash.light);
    this.sparks = new Particles({ capacity: 256, additive: true, maxPixels: 10, fadeNear: 30, fadeFar: 90, gravity: 9.81, drag: 1.2 });
    this.smoke = new Particles({ capacity: 64, additive: false, maxPixels: 220, fadeNear: 25, fadeFar: 110, gravity: -0.4, drag: 0.8 });
    this.root.add(this.sparks.points, this.smoke.points);
    this.scorchMaterial = new THREE.MeshStandardMaterial({
      name: 'fx-scorch', color: 0x060505, roughness: 1, transparent: true, depthWrite: false, alphaMap: this.scorchTex,
      polygonOffset: true, polygonOffsetFactor: -4,
    });
    o.prepare?.(this.scorchMaterial);
  }

  get flying(): number {
    return this.bolts.filter((b) => b.alive).length;
  }

  get decals(): number {
    return this.scorches.length;
  }

  fire(shot: PlasmaShot): void {
    const b = this.bolts.find((x) => !x.alive) ?? this.bolts[0];
    b.alive = true;
    b.pos.copy(shot.from);
    b.dir.copy(shot.dir).normalize();
    b.traveled = 0;
    for (const h of b.history) h.copy(shot.from);
    b.core.visible = b.glow.visible = b.trail.visible = true;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    const c = this.o.cfg;
    camera.getWorldPosition(this.camPos);
    for (const b of this.bolts) {
      if (!b.alive) continue;
      const step = c.boltSpeed * dt;
      _next.copy(b.pos).addScaledVector(b.dir, step);
      const t = this.o.world.sphereCast(b.pos, _next, c.boltRadius);
      if (t < 1) {
        _hitPos.copy(b.pos).lerp(_next, t);
        this.impact(b, _hitPos);
        continue;
      }
      b.pos.copy(_next);
      b.traveled += step;
      if (b.traveled > c.boltRange) {
        this.retire(b);
        continue;
      }
      this.placeBolt(b);
    }
    // the impact flash and its light fade fast
    const f = this.flash;
    if (f.t < 1) {
      f.t = Math.min(1, f.t + dt / FX.impactLightTime);
      const k = 1 - f.t;
      f.light.intensity = FX.impactLight * k * k;
      const s = FX.flashSize * (0.4 + 0.6 * Math.min(1, f.t * FX.impactLightTime / FX.flashTime));
      f.sprite.scale.set(s, s, 1);
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - (f.t * FX.impactLightTime) / FX.flashTime);
      f.sprite.visible = f.t * FX.impactLightTime < FX.flashTime;
    }
    for (let k = this.scorches.length - 1; k >= 0; k--) {
      const s = this.scorches[k];
      s.age += dt;
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.92 * (1 - smooth(Math.max(0, s.age - FX.scorchLife * 0.6) / (FX.scorchLife * 0.4)));
      if (s.age > FX.scorchLife) this.dropScorch(k);
    }
    this.sparks.setView(camera, viewportHeight);
    this.smoke.setView(camera, viewportHeight);
    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  dispose(): void {
    for (const b of this.bolts) {
      b.core.geometry.dispose();
      (b.core.material as THREE.Material).dispose();
      (b.glow.material as THREE.Material).dispose();
      b.trail.geometry.dispose();
      (b.trail.material as THREE.Material).dispose();
    }
    (this.flash.sprite.material as THREE.Material).dispose();
    while (this.scorches.length) this.dropScorch(0);
    this.scorchMaterial.dispose();
    this.glowTex.dispose();
    this.scorchTex.dispose();
    this.sparks.dispose();
    this.smoke.dispose();
    this.root.removeFromParent();
  }

  private makeBolt(): Bolt {
    const core = new THREE.Mesh(new THREE.SphereGeometry(FX.coreRadius, 16, 12), new THREE.MeshBasicMaterial({ color: FX.core, fog: false }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: FX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.scale.set(FX.glowSize, FX.glowSize, 1);
    const n = FX.trailPoints;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const alpha = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) alpha[k * 2] = alpha[k * 2 + 1] = (1 - k / (n - 1)) ** 1.5;
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const idx: number[] = [];
    for (let k = 0; k < n - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    g.setIndex(idx);
    const trail = new THREE.Mesh(g, new THREE.ShaderMaterial({
      name: 'fx-plasma-trail', vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, uniforms: { uColor: { value: FX.trail } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    trail.frustumCulled = false;
    const light = new THREE.PointLight(FX.light, 0, FX.lightDistance, 2);
    core.visible = glow.visible = trail.visible = false;
    this.root.add(core, glow, trail, light);
    return { alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), traveled: 0, history: Array.from({ length: n }, () => new THREE.Vector3()), core, glow, trail, light };
  }

  private placeBolt(b: Bolt): void {
    b.core.position.copy(b.pos);
    b.glow.position.copy(b.pos);
    b.light.position.copy(b.pos);
    b.light.intensity = FX.lightIntensity;
    // history: the head moves with the bolt; older points are kept trailSpacing apart
    const h = b.history;
    h[0].copy(b.pos);
    for (let k = 1; k < h.length; k++) {
      _seg.subVectors(h[k], h[k - 1]);
      const d = _seg.length();
      if (d > FX.trailSpacing) h[k].copy(h[k - 1]).addScaledVector(_seg, FX.trailSpacing / d);
    }
    const pos = b.trail.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < h.length; k++) {
      _seg.subVectors(h[Math.max(0, k - 1)], h[Math.min(h.length - 1, k + 1)]);
      _toCam.subVectors(this.camPos, h[k]);
      _side.crossVectors(_seg, _toCam).normalize().multiplyScalar(FX.trailWidth * (1 - k / h.length));
      _v.copy(h[k]).add(_side);
      pos.setXYZ(k * 2, _v.x, _v.y, _v.z);
      _v.copy(h[k]).sub(_side);
      pos.setXYZ(k * 2 + 1, _v.x, _v.y, _v.z);
    }
    pos.needsUpdate = true;
  }

  private retire(b: Bolt): void {
    b.alive = false;
    b.core.visible = b.glow.visible = b.trail.visible = false;
    b.light.intensity = 0;
  }

  private impact(b: Bolt, at: THREE.Vector3): void {
    this.impacts++;
    const hit = this.o.world.closestPoint(at, this.o.cfg.boltRadius * 3);
    _n.copy(hit ? hit.normal : b.dir.clone().negate()).normalize();
    this.retire(b);
    const f = this.flash;
    f.t = 0;
    f.sprite.position.copy(at).addScaledVector(_n, 0.2);
    f.light.position.copy(at).addScaledVector(_n, 0.5);
    f.sprite.visible = true;
    for (let k = 0; k < FX.sparkCount; k++) {
      const v = this.hemisphere(_n).multiplyScalar(4 + 7 * this.rng());
      this.sparks.emit({ pos: at, vel: v, life: 0.35 + 0.55 * this.rng(), size: 0.05, grow: 0, color: FX.spark, alpha: 1 });
    }
    for (let k = 0; k < FX.smokeCount; k++) {
      const v = this.hemisphere(_n).multiplyScalar(0.4 + 0.8 * this.rng());
      this.smoke.emit({ pos: _v.copy(at).addScaledVector(_n, 0.15), vel: v, life: 1.4 + 1.2 * this.rng(), size: 0.5, grow: 0.9, color: FX.smoke, alpha: 0.55 });
    }
    this.placeScorch(at, _n);
    const dist = this.camPos.distanceTo(at);
    this.o.shake?.(this.o.cfg.shake / Math.max(1, dist / 12), this.o.cfg.shakeTime);
  }

  private hemisphere(n: THREE.Vector3): THREE.Vector3 {
    for (;;) {
      _v.set(this.rng() * 2 - 1, this.rng() * 2 - 1, this.rng() * 2 - 1);
      const l = _v.lengthSq();
      if (l > 1e-4 && l <= 1) break;
    }
    _v.normalize();
    if (_v.dot(n) < 0) _v.addScaledVector(n, -2 * _v.dot(n));
    return _v.clone().addScaledVector(n, 0.6).normalize();
  }

  /**
   * The collision triangles near an impact as a throwaway world-space mesh (at most FX.maxPatchTris), so a scorch
   * costs the same on a 50k-triangle terrain chunk as on a lab box: DecalGeometry walks every triangle it is given.
   */
  private patch(at: THREE.Vector3, halfSize: number): THREE.Mesh | null {
    _box.setFromCenterAndSize(at, _size.setScalar(2 * halfSize));
    const pos: number[] = [];
    this.o.world.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        if (tri.intersectsBox(_box)) pos.push(tri.a.x, tri.a.y, tri.a.z, tri.b.x, tri.b.y, tri.b.z, tri.c.x, tri.c.y, tri.c.z);
        return pos.length >= FX.maxPatchTris * 9;
      },
    });
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g);
  }

  private placeScorch(at: THREE.Vector3, n: THREE.Vector3): void {
    let mesh: THREE.Mesh;
    const size = FX.scorchSize * (0.8 + 0.4 * this.rng());
    _q.setFromUnitVectors(Z, n).multiply(new THREE.Quaternion().setFromAxisAngle(Z, this.rng() * Math.PI * 2));
    const local = this.patch(at, size * 0.75);
    if (local) {
      const g = new DecalGeometry(local, at, new THREE.Euler().setFromQuaternion(_q), new THREE.Vector3(size, size, 1));
      local.geometry.dispose();
      mesh = new THREE.Mesh(g, this.scorchMaterial.clone());
    } else {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.scorchMaterial.clone());
      mesh.position.copy(at).addScaledVector(n, 0.01);
      mesh.quaternion.copy(_q);
    }
    this.o.prepare?.(mesh.material as THREE.Material);
    mesh.name = 'fx-scorch';
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.scorches.push({ mesh, age: 0 });
    if (this.scorches.length > FX.maxDecals) this.dropScorch(0);
  }

  private dropScorch(k: number): void {
    const s = this.scorches[k];
    s.mesh.removeFromParent();
    s.mesh.geometry.dispose();
    (s.mesh.material as THREE.Material).dispose();
    this.scorches.splice(k, 1);
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
```

`src/characters/dragon/toothlessBrain.ts`:
```ts
import * as THREE from 'three';
import { JumpAction } from './actions/jump';
import { PlasmaAction } from './actions/plasma';
import { DragonBrain } from './behaviour/brain';
import type { DragonCharacter } from './motion/dragon';
import type { MotionRig } from './motion/rigTypes';

export interface ToothlessBrainOptions {
  seed?: number;
  sunDir?: THREE.Vector3;
  /** Where plasma goes (the game: the camera's aim ray). Default: 30 m ahead of his head. */
  aimAt?: (d: DragonCharacter, out: THREE.Vector3) => THREE.Vector3;
}

export interface ToothlessBrain {
  readonly brain: DragonBrain;
  readonly jump: JumpAction;
  readonly plasma: PlasmaAction;
}

/** Straight ahead of his head, 30 m out. */
function aheadAim(d: DragonCharacter, out: THREE.Vector3): THREE.Vector3 {
  d.headPos(out);
  return out.set(out.x + Math.sin(d.kin.heading) * 30, out.y, out.z + Math.cos(d.kin.heading) * 30);
}

/** Toothless's M6 layer on a DragonCharacter: the brain with the jump and plasma actions (lab, game, tests). */
export function createToothlessBrain(d: DragonCharacter, rig: MotionRig, o: ToothlessBrainOptions = {}): ToothlessBrain {
  const jump = new JumpAction(d.tuning.jump);
  const plasma = new PlasmaAction(rig, d, d.tuning.plasma, o.aimAt ?? aheadAim);
  const brain = new DragonBrain(d, { rig, seed: o.seed, sunDir: o.sunDir, actions: [jump, plasma] });
  return { brain, jump, plasma };
}
```

**Edit 8.1 — `src/camera/orbitCamera.ts`**

Find:
```ts
const _dir = new THREE.Vector3();
```
Replace with:
```ts
const _shake = new THREE.Vector3();
const _dir = new THREE.Vector3();
```

**Edit 8.2 — `src/camera/orbitCamera.ts`**

Find:
```ts
  private sinceMouse = 0;
```
Replace with:
```ts
  private sinceMouse = 0;
  private shakeT = 0;
  private shakeDur = 1;
  private shakeAmp = 0;
  private shakeClock = 0;
```

**Edit 8.3 — `src/camera/orbitCamera.ts`**

Find:
```ts
    let nearest = Infinity;
```
Replace with:
```ts
    if (this.shakeT > 0) {
      // M6 impact shake: a decaying sum of sines (deterministic), position more than aim
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.shakeClock += dt;
      const k = (this.shakeAmp * (this.shakeT / this.shakeDur) ** 2) / 1.5;
      const c = this.shakeClock;
      _shake.set(Math.sin(c * 71.3) + 0.5 * Math.sin(c * 37.1), Math.sin(c * 83.7 + 1.3) + 0.5 * Math.sin(c * 29.3), Math.sin(c * 61.9 + 2.1))
        .multiplyScalar(k);
      this.position.add(_shake);
      this.target.addScaledVector(_shake, 0.5);
    }

    let nearest = Infinity;
```

**Edit 8.4 — `src/camera/orbitCamera.ts`**

Find:
```ts
  apply(camera: THREE.PerspectiveCamera): void {
```
Replace with:
```ts
  /** Impact shake (M6 plasma): amplitude (m) fading over duration (s); a stronger shake overrides a weaker one. */
  shake(amplitude: number, duration: number): void {
    const now = this.shakeT > 0 ? this.shakeAmp * (this.shakeT / this.shakeDur) ** 2 : 0;
    if (amplitude <= now) return;
    this.shakeAmp = amplitude;
    this.shakeDur = Math.max(duration, 1e-3);
    this.shakeT = this.shakeDur;
  }

  apply(camera: THREE.PerspectiveCamera): void {
```

- [ ] **Step 4: Run the tests to verify they pass** — `npm test -- tests/actions tests/fx` → 15 pass (jump 5, plasma 4, FX 6). Then `npm run typecheck` → clean, and `npm test` → no suite that passed before fails now.

- [ ] **Step 5: Commit** — the files above. Message: `feat(fx): plasma — turn, charge, fire, recoil; pooled bolts, impacts, local-patch scorch decals, camera shake`.

---

### Task 9: Scramble polish (the M5 hand-off)

**Model:** sonnet.

**What it does:**
- **Climb reach.** While climbing (45–70°) and early in a scramble, the `climb_reach` layer (head and chest up the slope) eases toward 0.6.
- **Scramble-up.** The 0.9 s `scramble_up` clip shapes spine, neck and tail through reach → hook → pull-over → settle. It is timed to Plan 3's scripted body curve (clip time = τ · duration, order 2), and it blends in and out at the ends.
- **Balance.** The wings flare throughout the scramble.
- Plan 3's `ledge-scramble` and ramp course scripts are Plan 3's own tuning. While planning, they failed identically with and without this polish.

**Files:**
- Modify: `src/characters/dragon/motion/climbing.ts` (Plan 3 Task 14)
- Test: `tests/motion/scramblePolish.test.ts`

**Interfaces:**
- Consumes: Task 3 `layers.{has, meta, set(…, order)}` and `wings.demand`; Task 2's `scramble_up` and `climb_reach` clips; Plan 3 `ClimbController.{mode, t, duration}` and `stepScramble`.
- Produces: `ClimbController.reach: number` (the `climb_reach` layer weight).

- [ ] **Step 1: Write the failing test**

`tests/motion/scramblePolish.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import type { PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { rampWorld, wallWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const W: InputState = { keys: new Set(['KeyW']), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 };
const X = new THREE.Vector3(1, 0, 0);

/** Synthetic scramble_up (a 0.9 s clip) and climb_reach (a pose) on the fixture rig's neck, with library-style metadata. */
function library() {
  const s = new RigSkeleton(toothlessFixtureRig());
  const i = s.id('neck_01');
  const q = (a: number) => s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, a)).toArray();
  const clips = new Map([
    ['scramble_up', new THREE.AnimationClip('scramble_up', 0.9, [new THREE.QuaternionKeyframeTrack('neck_01.quaternion', [0, 0.9], [...q(0), ...q(-0.5)])])],
    ['climb_reach', new THREE.AnimationClip('climb_reach', -1, [new THREE.QuaternionKeyframeTrack('neck_01.quaternion', [0], q(-0.3))])],
  ]);
  const posesMeta: PosesMeta = {
    clips: {
      scramble_up: { mask: ['neck_'], ownsLegs: [], duration: 0.9, blendIn: 0.1, blendOut: 0.2, interrupt: 'none' },
      climb_reach: { mask: ['neck_'], ownsLegs: [], duration: 0, blendIn: 0.4, blendOut: 0.4, interrupt: 'exit' },
    },
  };
  return { clips, posesMeta };
}

describe('scramble polish (the M5 hand-off)', () => {
  it('plays scramble_up through the scramble, flares the wings for balance, and clears both after', { timeout: 60_000 }, () => {
    const d = new DragonCharacter({ rig: toothlessFixtureRig(), world: wallWorld(2.3, 0), ...library(), seed: 1 });
    d.spawn(0, -6, 0);
    let up = 0;
    let flare = 0;
    let reach = 0;
    let scrambled = false;
    for (let k = 0; k < Math.round(3.5 / DT); k++) {
      d.update({ input: W, cameraYaw: 0, cameraPos: CAM }, DT);
      if (d.climb.mode !== 'scramble') continue;
      scrambled = true;
      up = Math.max(up, d.layers.weight('scramble_up'));
      flare = Math.max(flare, d.wings.target.flare);
      reach = Math.max(reach, d.climb.reach);
    }
    expect(scrambled).toBe(true);
    expect(up).toBeGreaterThan(0.99);
    expect(flare).toBeCloseTo(DEFAULT_TUNING.wings.climbFlare, 6);
    expect(reach).toBeGreaterThan(0);
    expect(d.layers.weight('scramble_up')).toBe(0);                  // finished: the layer is gone
    expect(d.nanResets).toBe(0);
  });
  it('eases climb_reach toward 0.6 in climb mode and flares the wings while climbing', { timeout: 60_000 }, () => {
    const d = new DragonCharacter({ rig: toothlessFixtureRig(), world: rampWorld(55, -2), ...library(), seed: 1 });
    d.spawn(0, -6, 0);
    let reach = 0;
    let flare = 0;
    for (let k = 0; k < Math.round(6 / DT); k++) {
      d.update({ input: W, cameraYaw: 0, cameraPos: CAM }, DT);
      if (d.climb.mode !== 'climb') continue;
      reach = Math.max(reach, d.climb.reach);
      flare = Math.max(flare, d.wings.target.flare);
      expect(d.layers.weight('climb_reach')).toBeCloseTo(d.climb.reach, 12);
    }
    expect(reach).toBeCloseTo(0.6, 6);
    expect(flare).toBeCloseTo(DEFAULT_TUNING.wings.climbFlare, 6);
    expect(d.nanResets).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npm test -- tests/motion/scramblePolish.test.ts` → FAIL (`d.climb.reach` is undefined; `scramble_up` never gets a weight).

- [ ] **Step 3: Implement**

**Edit 9.1 — `src/characters/dragon/motion/climbing.ts`**

Find:
```ts
  suspended = false;
```
Replace with:
```ts
  suspended = false;
  /** Weight of the climb_reach layer (head and chest up the slope), eased in and out of climb mode. */
  reach = 0;
```

**Edit 9.2 — `src/characters/dragon/motion/climbing.ts`**

Find:
```ts
  step(d: DragonCharacter, dt: number): void {
    if (this.suspended) {
```
Replace with:
```ts
  step(d: DragonCharacter, dt: number): void {
    this.easeReach(d, dt);
    if (this.suspended) {
```

**Edit 9.3 — `src/characters/dragon/motion/climbing.ts`**

Find:
```ts
  private stepScramble(d: DragonCharacter, dt: number): void {
    this.t += dt;
    const tau = Math.min(1, this.t / this.duration);
```
Replace with:
```ts
  private stepScramble(d: DragonCharacter, dt: number): void {
    this.t += dt;
    const tau = Math.min(1, this.t / this.duration);
    // choreography (M6): the scramble_up clip shapes spine, neck and tail through reach → hook → pull-over → settle,
    // timed to the scripted body curve; the wings flare for balance
    if (d.layers.has('scramble_up')) {
      const dur = d.layers.meta('scramble_up')?.duration ?? this.duration;
      d.layers.set('scramble_up', smoothstep(0, 0.08, tau) * (1 - smoothstep(0.88, 1, tau)), tau * dur, false, 2);
    }
    d.wings.demand('climb', { flare: d.tuning.wings.climbFlare });
```

**Edit 9.4 — `src/characters/dragon/motion/climbing.ts`**

Find:
```ts
    if (tau >= 1) {
      this.mode = 'ground';
      d.mods.scripted = false;
      d.planner.autoStep = true;
      d.body.override.active = false;
    }
  }
```
Replace with:
```ts
    if (tau >= 1) {
      this.mode = 'ground';
      d.mods.scripted = false;
      d.planner.autoStep = true;
      d.body.override.active = false;
      if (d.layers.has('scramble_up')) d.layers.set('scramble_up', 0);
    }
  }

  /** climb_reach eases toward 0.6 in climb mode and the scramble's first half, and back to 0 elsewhere. */
  private easeReach(d: DragonCharacter, dt: number): void {
    const want = this.mode === 'climb' || (this.mode === 'scramble' && this.t < this.duration * 0.3) ? 0.6 : 0;
    this.reach += Math.sign(want - this.reach) * Math.min(Math.abs(want - this.reach), dt / 0.4);
    if (d.layers.has('climb_reach')) d.layers.set('climb_reach', this.reach, 0, false, 1);
  }
```

- [ ] **Step 4: Run it to verify it passes** — `npm test -- tests/motion` → all pass, including Plan 3's climbing suite. Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `src/characters/dragon/motion/climbing.ts`, the test. Message: `feat(motion): climb reach and the scramble-up choreography`.

---

### Task 10: The M6 lab gate and the Motion Lab page

**Model:** opus (browser checks and visual QA).

**What it does (spec §8.2, §9 M6 exit: "idles and actions pass lab checks"):**
- **17 M6 lab scripts**, run headlessly on the fixture rig and on the exported rig with the library:
  - every behaviour forced, then interrupted by W: sit, lie, sleep, stretch, sniff, scratch, shake, yawn, look around, glance at the camera
  - `idle-free-28s`, where the selector idles freely
  - `idle-cycle-58s`: three 24 s cycles of sit → scratch → lie → sleep → W → shake, repeatable because the selector stays quiet. This is the behaviours' spin check.
  - jumps: standing, while trotting, off the 2 m ledge
  - plasma: at the climb wall, and behind him (turn first)
- **`runM6Script`** attaches the brain through the lab runner's new `setup` hook, forces the script's behaviours on time and aims its plasma.
- **The Motion Lab page** gets the brain, the plasma FX and the per-frame expression. `berk.lab.{run, runAll, play, scripts}` include the M6 scripts; `berk.behaviour(name)` works there too.

**Files:**
- Create: `src/dev/lab/m6Scripts.ts`, `tests/lab/m6.test.ts`
- Modify: `src/dev/lab/labRunner.ts`, `src/dev/lab/main.ts` (Plan 3 Task 15)
- Output: `docs/progress/img/m6/*.png`, `docs/progress/img/m6/metrics.json`

**Interfaces:**
- Consumes:
  - Task 8: `createToothlessBrain`, `PlasmaFx`
  - Task 4: `applyExpression`
  - Plan 3: `runLabScript`, `LabRunOptions`, `LabScript`, `ScriptedInput`/`InputEvent`, `buildCourse` (Plan 1), `MetricsReport`, and the lab page code of Plan 3 Task 15 Step 7
- Produces:
  - `LabRunOptions.setup?: (d, cam) => void`
  - `M6LabScript` (`LabScript` + `behaviours?`, `aim?`, `autonomous?`), `M6_SCRIPTS`, `m6ScriptByName(name)`
  - `runM6Script(options & { script, onBrain? }) → MetricsReport`
  - lab page: `berk.lab.{run, runAll, play, scripts}` with the M6 scripts, and `berk.behaviour(name)`

- [ ] **Step 1: Write the failing gate**

`tests/lab/m6.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildCourse } from '../../src/dev/lab/course';
import { M6_SCRIPTS, runM6Script } from '../../src/dev/lab/m6Scripts';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const world = CollisionWorld.fromObjects(buildCourse().surfaces);

describe('M6 lab scripts on the fixture rig (no pose library)', () => {
  it.each(M6_SCRIPTS.map((s) => s.name))('passes every metric: %s', { timeout: 300_000 }, (name) => {
    const r = runM6Script({ rig: toothlessFixtureRig(), world, script: M6_SCRIPTS.find((s) => s.name === name)! });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});

describe.skipIf(!HAS_LIBRARY)('M6 lab scripts on the exported rig with the pose library (spec §9 M6 exit)', () => {
  it.each(M6_SCRIPTS.map((s) => s.name))('passes every metric: %s', { timeout: 300_000 }, async (name) => {
    const a = await loadToothlessMotion();
    const r = runM6Script({ rig: a.rig, world, script: M6_SCRIPTS.find((s) => s.name === name)!, clips: a.clips, posesMeta: a.posesMeta });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npm test -- tests/lab/m6.test.ts` → `Failed to resolve import "../../src/dev/lab/m6Scripts"`.

- [ ] **Step 3: Implement the scripts and the runner hook**

`src/dev/lab/m6Scripts.ts`:
```ts
import * as THREE from 'three';
import type { InputEvent } from '../../core/input';
import { createToothlessBrain, type ToothlessBrain } from '../../characters/dragon/toothlessBrain';
import type { MetricsReport } from '../../characters/dragon/motion/metrics';
import { runLabScript, type LabRunOptions } from './labRunner';
import type { LabScript } from './scripts';

/** An M6 lab script: Plan 3's LabScript plus forced behaviours and a plasma aim point. */
export interface M6LabScript extends LabScript {
  /** berk.behaviour(name) at time t. */
  behaviours?: Array<{ t: number; name: string }>;
  /** World point the plasma aims at (the game: the camera's aim ray). */
  aim?: [number, number, number];
  /** false: the selector stays quiet, only `behaviours` play (repeatable cycles). */
  autonomous?: boolean;
}

const hold = (keys: string[], from: number, to: number): InputEvent[] => [{ t: from, down: keys }, { t: to, up: keys }];
const tap = (key: string, at: number): InputEvent[] => [{ t: at, down: [key] }, { t: at + 0.05, up: [key] }];
const PI = Math.PI;

/** Force a behaviour, let it play, interrupt it with W, walk off (each < 30 s: boundedness belongs to idle-cycle). */
function behaviourRun(name: string, playFor: number): M6LabScript {
  const w = 0.5 + playFor;
  return {
    name: `behaviour-${name}`, description: `${name}: forced, interrupted by W at ${w.toFixed(1)} s, walks off`,
    spawn: { x: 0, z: 0, heading: 0 }, duration: w + 4, events: hold(['KeyW'], w, w + 2), behaviours: [{ t: 0.5, name }],
  };
}

/** One 24 s cycle: sit, lie down, curl up asleep, get up (W), shake off; run 58 s so the last 10 s repeat the first. */
function idleCycle(): M6LabScript {
  const events: InputEvent[] = [];
  const behaviours: Array<{ t: number; name: string }> = [];
  for (let c = 0; c < 3; c++) {
    const o = 24 * c;
    behaviours.push({ t: o + 1, name: 'sit' }, { t: o + 4, name: 'scratch' }, { t: o + 8, name: 'lie' }, { t: o + 11, name: 'sleep' }, { t: o + 20, name: 'shake' });
    events.push(...hold(['KeyW'], o + 16, o + 16.4));
  }
  return {
    name: 'idle-cycle-58s', description: 'three 24 s idle cycles: sit, scratch, lie, sleep, W, shake — the behaviours\' spin-bug check',
    spawn: { x: 0, z: 0, heading: 0 }, duration: 58, events, behaviours, autonomous: false,
  };
}

/** Spec §8.2 lab checks for M6 (§9: idles and actions pass lab checks). Course coordinates: Plan 1's buildCourse. */
export const M6_SCRIPTS: M6LabScript[] = [
  behaviourRun('sit', 6), behaviourRun('lie', 7), behaviourRun('sleep', 9), behaviourRun('stretch', 3), behaviourRun('sniff', 3),
  behaviourRun('scratch', 5), behaviourRun('shake', 2), behaviourRun('yawn', 3), behaviourRun('look_around', 3),
  behaviourRun('glance_camera', 2),
  {
    name: 'idle-free-28s', description: 'no input: the selector idles freely (small behaviours, then sits)',
    spawn: { x: 0, z: 0, heading: 0 }, duration: 28, events: [],
  },
  idleCycle(),
  { name: 'jump-standing', description: 'Space from a stand', spawn: { x: 0, z: 0, heading: 0 }, duration: 4, events: tap('Space', 0.5) },
  { name: 'jump-trot', description: 'trot, leap, keep trotting', spawn: { x: 0, z: -6, heading: 0 }, duration: 6, events: [...hold(['KeyW'], 0.1, 5), ...tap('Space', 2.5)] },
  {
    name: 'jump-off-ledge', description: 'leap off the 2 m ledge onto the pad', spawn: { x: 24, z: 9.5, heading: PI }, duration: 5,
    events: [...hold(['KeyW'], 0.1, 1), ...tap('Space', 0.6)],
  },
  { name: 'plasma-wall', description: 'fire at the climb wall', spawn: { x: 0, z: 18, heading: 0 }, duration: 3, events: tap('KeyF', 0.5), aim: [1, 1.2, 29.5] },
  { name: 'plasma-turn', description: 'aim behind him: turn, then fire', spawn: { x: 0, z: 18, heading: PI }, duration: 4, events: tap('KeyF', 0.5), aim: [0, 1.2, 29.5] },
];

export function m6ScriptByName(name: string): M6LabScript {
  const s = M6_SCRIPTS.find((x) => x.name === name);
  if (!s) throw new Error(`unknown M6 lab script '${name}' (have: ${M6_SCRIPTS.map((x) => x.name).join(', ')})`);
  return s;
}

/** runLabScript with Toothless's brain attached, the script's behaviours forced on time and its plasma aim. */
export function runM6Script(o: Omit<LabRunOptions, 'script' | 'setup'> & { script: M6LabScript; onBrain?: (b: ToothlessBrain) => void }): MetricsReport {
  const aim = new THREE.Vector3(...(o.script.aim ?? [0, 1.5, 1e4]));
  let tb: ToothlessBrain | null = null;
  const queue = [...(o.script.behaviours ?? [])].sort((a, b) => a.t - b.t);
  return runLabScript({
    ...o,
    setup: (d) => {
      tb = createToothlessBrain(d, o.rig, { seed: 1, aimAt: (_d, out) => out.copy(aim) });
      tb.brain.behaviours.autonomous = o.script.autonomous ?? true;
      o.onBrain?.(tb);
    },
    onStep: (d, t) => {
      while (queue.length && queue[0].t <= t + 1e-9) tb!.brain.behaviour(queue.shift()!.name);
      o.onStep?.(d, t);
    },
  });
}
```

**Edit 10.1 — `src/dev/lab/labRunner.ts`**

Find:
```ts
  onStep?: (d: DragonCharacter, t: number) => void;
```
Replace with:
```ts
  onStep?: (d: DragonCharacter, t: number) => void;
  /** Called once after spawning (M6: attach the brain and actions). */
  setup?: (d: DragonCharacter, cam: OrbitCamera) => void;
```

**Edit 10.2 — `src/dev/lab/labRunner.ts`**

Find:
```ts
  cam.reset(cameraFollow(d, hold));
  const input = new ScriptedInput(o.script.events);
```
Replace with:
```ts
  cam.reset(cameraFollow(d, hold));
  o.setup?.(d, cam);
  const input = new ScriptedInput(o.script.events);
```

**Edit 10.3 — `src/dev/lab/main.ts`**

Find:
```ts
import { cameraFollow, runLabScript } from './labRunner';
```
Replace with:
```ts
import { cameraFollow, runLabScript } from './labRunner';
import { createToothlessBrain } from '../../characters/dragon/toothlessBrain';
import { applyExpression } from '../../characters/dragon/face/expression';
import { PlasmaFx } from '../../fx/plasmaFx';
import { M6_SCRIPTS, runM6Script } from './m6Scripts';
```

**Edit 10.4 — `src/dev/lab/main.ts`**

Find:
```ts
  const cam = new OrbitCamera(tuning.camera, world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(dragon, hold));
```
Replace with:
```ts
  const cam = new OrbitCamera(tuning.camera, world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(dragon, hold));
  // M6: the brain (behaviours, face, jump, plasma) and the plasma FX. Plasma aims along the camera like the game page,
  // unless a playing M6 script names its aim point.
  const aimDir = new THREE.Vector3();
  const aimHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  let scriptAim: THREE.Vector3 | null = null;
  let scriptEnd = -1;
  let queue: Array<{ t: number; name: string }> = [];
  const tb = createToothlessBrain(dragon, asset.rig, {
    seed: 1, sunDir: app.lighting.sunDir,
    aimAt: (_d, out) => {
      if (scriptAim) return out.copy(scriptAim);
      aimDir.subVectors(cam.target, cam.position).normalize();
      const hit = world.raycast(cam.position, aimDir, 120, aimHit);
      return hit ? out.copy(hit.point) : out.copy(cam.position).addScaledVector(aimDir, 120);
    },
  });
  const fx = new PlasmaFx({
    world, cfg: tuning.plasma, prepare: (m) => app.materials.prepare(m),
    shake: (a, t) => cam.shake(a, t), seed: 1,
  });
  app.scene.add(fx.root);
```

**Edit 10.5 — `src/dev/lab/main.ts`**

Find:
```ts
    if (scripted?.done) {
      source = live;
      scripted = null;
      yawPx = 0;
    }
```
Replace with:
```ts
    if (scripted?.done) {
      source = live;
      scripted = null;
      yawPx = 0;
    }
    while (queue.length && queue[0].t <= app.loop.simTime) tb.brain.behaviour(queue.shift()!.name);
    if (app.loop.simTime > scriptEnd) {                      // an M6 script's aim and quiet selector last its duration
      scriptAim = null;
      tb.brain.behaviours.autonomous = true;
    }
```

**Edit 10.6 — `src/dev/lab/main.ts`**

Find:
```ts
    dragon.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
  });
  app.loop.addRender((alpha) => {
    dragon.writeTo(asset.bones, alpha);
```
Replace with:
```ts
    dragon.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
    while (tb.plasma.shots.length) fx.fire(tb.plasma.shots.shift()!);
  });
  app.loop.addRender((alpha, frameDt) => {
    dragon.writeTo(asset.bones, alpha);
    applyExpression(asset, tb.brain.face.state);
```

**Edit 10.7 — `src/dev/lab/main.ts`**

Find:
```ts
    overlays.update(dragon);
  }, 0);
```
Replace with:
```ts
    overlays.update(dragon);
    fx.update(frameDt, app.camera, canvas.height);
  }, 0);
```

**Edit 10.8 — `src/dev/lab/main.ts`**

Find:
```ts
    run: (name: string) => runLabScript({ rig: asset.rig, world, script: scriptByName(name), tuning, clips: asset.clips, posesMeta }),
    runAll: () => Object.fromEntries(LAB_SCRIPTS.map((s) => [s.name, runLabScript({ rig: asset.rig, world, script: s, tuning, clips: asset.clips, posesMeta })])),
    play: (name: string) => {
      const s = scriptByName(name);
      dragon.spawn(s.spawn.x, s.spawn.z, s.spawn.heading);
      cam.reset(cameraFollow(dragon, hold));
```
Replace with:
```ts
    run: (name: string) => {
      const m6 = M6_SCRIPTS.find((x) => x.name === name);
      const o = { rig: asset.rig, world, tuning, clips: asset.clips, posesMeta };
      return m6 ? runM6Script({ ...o, script: m6 }) : runLabScript({ ...o, script: scriptByName(name) });
    },
    runAll: () => Object.fromEntries([
      ...LAB_SCRIPTS.map((s) => [s.name, runLabScript({ rig: asset.rig, world, script: s, tuning, clips: asset.clips, posesMeta })]),
      ...M6_SCRIPTS.map((s) => [s.name, runM6Script({ rig: asset.rig, world, script: s, tuning, clips: asset.clips, posesMeta })]),
    ]),
    play: (name: string) => {
      const m6 = M6_SCRIPTS.find((x) => x.name === name);
      const s = m6 ?? scriptByName(name);
      dragon.spawn(s.spawn.x, s.spawn.z, s.spawn.heading);
      cam.reset(cameraFollow(dragon, hold));
      tb.brain.reset();
      tb.brain.behaviours.autonomous = m6?.autonomous ?? true;
      queue = (m6?.behaviours ?? []).map((b) => ({ t: b.t + app.loop.simTime, name: b.name })).sort((a, b) => a.t - b.t);
      scriptAim = m6?.aim ? new THREE.Vector3(...m6.aim) : null;
      scriptEnd = app.loop.simTime + s.duration;
```

**Edit 10.9 — `src/dev/lab/main.ts`**

Find:
```ts
    scripts: () => LAB_SCRIPTS.map((s) => `${s.name}: ${s.description}`),
```
Replace with:
```ts
    scripts: () => [...LAB_SCRIPTS, ...M6_SCRIPTS].map((s) => `${s.name}: ${s.description}`),
```

**Edit 10.10 — `src/dev/lab/main.ts`**

Find:
```ts
    toggle: (name: OverlayName) => (OVERLAY_NAMES.includes(name) ? overlays.toggle(name) : OVERLAY_NAMES),
  });
```
Replace with:
```ts
    toggle: (name: OverlayName) => (OVERLAY_NAMES.includes(name) ? overlays.toggle(name) : OVERLAY_NAMES),
    behaviour: (name: string) => tb.brain.behaviour(name),
  });
```

- [ ] **Step 4: Run the gate to verify it passes** — `npm test -- tests/lab/m6.test.ts` → 34 pass (17 scripts × fixture rig and exported rig). The exported-rig half must not be skipped.

- [ ] **Step 5: Typecheck and the full suite** — `npm run typecheck` → clean; `npm test` → no suite that passed before fails now.

- [ ] **Step 6: Browser — the Motion Lab**
  - Start the dev server: `npm run dev` (port 5190).
  - Open a new chrome-devtools page at `http://localhost:5190/lab.html?q=low` and wait ~5 s for Toothless to load.
  - `list_console_messages`: no errors or warnings. The FX, eye-gaze and scorch shaders compile on first use: fire once (`berk.lab.play('plasma-wall')`) and check again.
  - For each of `behaviour-sit`, `behaviour-scratch`, `behaviour-sleep`, `idle-cycle-58s`, `jump-trot`, `jump-off-ledge`, `plasma-wall`, `plasma-turn`:
    - `evaluate_script` → `berk.lab.play(name)`
    - wait into the interesting part (sit 2 s, scratch 3 s, sleep 6 s, idle-cycle 13 s, jump-trot 2.4 s, jump-off-ledge 0.5 s, plasma 0.4 s)
    - `berk.lab.filmstrip(12, 10, 6)`, then `take_screenshot` to `docs/progress/img/m6/<name>-strip.png`
    - `berk.lab.closeOverlay()`

- [ ] **Step 7: Read every strip and check:**
  - paws stay put while planted; posed paws rest on the ground (sit's hind legs, lie and sleep: all four)
  - getting up after W plays the exit: sleep → lie → stand, with no snap
  - the scratch hind leg reaches the ear, and the scratch reverses to the sit before he stands
  - asleep: eyes shut, head still, curled
  - jump: crouch → tucked flight with the wings flared → front paws land first → recovery; no penetration at the ledge
  - plasma: he rears, the jaw opens, the dorsal plates glow; the bolt leaves the mouth, hits and leaves a soft round scorch, and the camera shakes a little; with the aim behind him, he turns first
  - no popping, spinning or collapsing
  - Fix, re-run, repeat.

- [ ] **Step 8: High preset and metrics**
  - Reload with `?q=high`. Fire at the wall with `berk.lab.play('plasma-wall')` and read a screenshot at the impact: the bolt, the flash and the sparks are not darkened or haloed by AO (spec §4.6: transparent FX render after AO).
  - `evaluate_script` → `() => JSON.stringify(Object.fromEntries(berk.lab.scripts().map((s) => s.split(':')[0]).filter((n) => /^(behaviour-|idle-free|idle-cycle|jump-|plasma-)/.test(n)).map((n) => [n, berk.lab.run(n)])))` — the 17 M6 scripts on the page's real rig. Every report must have `pass: true`. Save the JSON to `docs/progress/img/m6/metrics.json`.
  - Close your page and stop your dev server.

- [ ] **Step 9: Commit** — the files above, the strips and `metrics.json`. Message: `feat(lab): the M6 gate — behaviour, idle-cycle, jump and plasma scripts; the brain and FX in the Motion Lab`.

---

### Task 11: Toothless on a page — `createToothless` and the game page

**Model:** opus (integration against whichever `main.ts` exists; browser play check).

**What it does:** `createToothless(options)` bundles everything a page needs, so the game page, the Cove and later pages share one wiring:
- **Asset and motion:** the asset (film materials with the dither fade), `DragonCharacter` with the tuned preset and the pose library, the brain with both actions, the interest lists.
- **Camera and FX:** the orbit camera (plasma aims at the first surface under the view centre, else 120 m out), `PlasmaFx` with the camera shake.
- **Loops:**
  - sim: camera → character → drain the plasma shots
  - render: bones, expression, fade, camera lerp, FX
- **Debug API:** `berk.tp`, `berk.behaviour(name)`, `berk.toothless.{mood, face, posture, fire, jump}` (fire and jump tap the real key path), `berk.cam.preset(hero|side|low|wide|face)`.

**Files:**
- Create: `src/characters/dragon/toothless.ts`
- Modify: `src/main.ts`, choosing the variant for whichever page exists:
  - **Variant A** — Plan 3 Task 16's test-scene page (no Cove yet).
  - **Variant B** — Plan 5a Task 14's Cove page (`createCove` in `main.ts`).
- Modify: `docs/progress/phase1.md` (an M6 section). Output: `docs/progress/img/m6/game-*.png`.

**Interfaces:**
- Consumes:
  - Task 8: `createToothlessBrain`, `PlasmaFx`, `PlasmaAction.shots`, `OrbitCamera.shake`
  - Task 4: `applyExpression`
  - Task 5: `InterestPoint`
  - Plan 2: `loadDragonAsset`; Plan 3: `DragonCharacter`, `OrbitCamera`, `cameraFollow`, `applyDitherFade`/`dragonFade`, `loadPosesMeta`, `loadTuning`, `KeyboardMouseInput`
  - Plan 1: `App`, `debug`
  - Variant B: Plan 5a `createCove`, `CoveRegion.{collisionRoots, spawnPoints, interestPoints, update, header, terrain, rocks}`, `coveGeometry`, `LAYER_UNDERWATER`, `InteractionSphere`
- Produces:
  - `ToothlessOptions { app; world; spawn: { x; z; heading }; interest?: ReadonlyArray<ReadonlyArray<InterestPoint>>; extraLayers?: number[]; seed? }`
  - `Toothless` (= `ToothlessBrain` + `asset`, `dragon`, `cam`, `fx`, `tp(x, z, heading?)`)
  - `createToothless(options) → Promise<Toothless>`
  - the game page with jump and plasma

- [ ] **Step 1: Create `createToothless`**

`src/characters/dragon/toothless.ts`:
```ts
import * as THREE from 'three';
import type { App } from '../../app/createApp';
import { debug } from '../../core/debug';
import { KeyboardMouseInput } from '../../core/input';
import { OrbitCamera } from '../../camera/orbitCamera';
import { cameraFollow } from '../../dev/lab/labRunner';
import { PlasmaFx } from '../../fx/plasmaFx';
import type { CollisionWorld, RayHit } from '../../world/collision';
import { loadDragonAsset, type DragonAsset } from './asset';
import type { InterestPoint } from './behaviour/attention';
import { applyExpression } from './face/expression';
import { applyDitherFade, dragonFade } from './fade';
import { DragonCharacter } from './motion/dragon';
import { loadPosesMeta } from './motion/poseLayers';
import { loadTuning } from './motion/tuning';
import { createToothlessBrain, type ToothlessBrain } from './toothlessBrain';

export interface ToothlessOptions {
  app: App;
  world: CollisionWorld;
  spawn: { x: number; z: number; heading: number };
  /** Live interest lists — e.g. a region's `interestPoints` (read every step, never copied). */
  interest?: ReadonlyArray<ReadonlyArray<InterestPoint>>;
  /** Also show the model through the pond's underwater pass (Plan 5a LAYER_UNDERWATER). */
  extraLayers?: number[];
  seed?: number;
}

export interface Toothless extends ToothlessBrain {
  readonly asset: DragonAsset;
  readonly dragon: DragonCharacter;
  readonly cam: OrbitCamera;
  readonly fx: PlasmaFx;
  /** Teleport (and re-seat the camera). */
  tp(x: number, z: number, heading?: number): void;
}

const MATERIALS = ['skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal'];
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _dir = new THREE.Vector3();

/**
 * Toothless on a page (the game, the Cove, the lab): the asset with its film materials, the motion core (Plan 3) with
 * the M6 brain (behaviours, face, jump, plasma), the orbit camera, the plasma FX and the per-frame expression binder.
 * Plasma aims along the camera: the first surface under the view centre, else 120 m out. Registers berk.tp,
 * berk.behaviour, berk.toothless.{mood, face, fire, jump} and berk.cam.preset.
 */
export async function createToothless(o: ToothlessOptions): Promise<Toothless> {
  const { app, world } = o;
  const [asset, posesMeta, tuning] = await Promise.all([
    loadDragonAsset({
      glbUrl: 'assets/characters/toothless/toothless.glb', posesUrl: 'assets/characters/toothless/toothless.poses.glb',
      rigUrl: 'assets/characters/toothless/toothless.rig.json', sunDir: app.lighting.sunDir, prepare: (m) => app.materials.prepare(m),
    }),
    loadPosesMeta('assets/characters/toothless/toothless.poses.json'),
    loadTuning(),
  ]);
  applyDitherFade(MATERIALS.map((n) => asset.materials.byName(n)!));
  for (const l of o.extraLayers ?? []) asset.root.traverse((obj) => obj.layers.enable(l));
  app.add(asset.root);
  const dragon = new DragonCharacter({ rig: asset.rig, world, tuning, clips: asset.clips, posesMeta, seed: o.seed ?? 1 });
  dragon.spawn(o.spawn.x, o.spawn.z, o.spawn.heading);
  const cam = new OrbitCamera(tuning.camera, world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(dragon, hold));
  const aimAt = (_d: DragonCharacter, out: THREE.Vector3): THREE.Vector3 => {
    _dir.subVectors(cam.target, cam.position).normalize();
    const hit = world.raycast(cam.position, _dir, 120, _hit);
    return hit ? out.copy(hit.point) : out.copy(cam.position).addScaledVector(_dir, 120);
  };
  const tb = createToothlessBrain(dragon, asset.rig, { seed: o.seed ?? 1, sunDir: app.lighting.sunDir, aimAt });
  for (const list of o.interest ?? []) tb.brain.interest.addList(list);
  const fx = new PlasmaFx({
    world, cfg: tuning.plasma, prepare: (m) => app.materials.prepare(m),
    shake: (a, t) => cam.shake(a, t), seed: o.seed ?? 1,
  });
  app.scene.add(fx.root);
  const canvas = app.renderer.domElement;
  const input = new KeyboardMouseInput(window, () => document.pointerLockElement === canvas);
  canvas.addEventListener('click', () => void canvas.requestPointerLock());
  const prevCam = new THREE.Vector3();
  const curCam = new THREE.Vector3();
  app.loop.addSim((dt) => {
    const inp = input.sample();
    prevCam.copy(cam.position);
    cam.update(inp, cameraFollow(dragon, hold), dt);
    curCam.copy(cam.position);
    dragon.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
    while (tb.plasma.shots.length) fx.fire(tb.plasma.shots.shift()!);
  });
  app.loop.addRender((alpha, frameDt) => {
    dragon.writeTo(asset.bones, alpha);
    applyExpression(asset, tb.brain.face.state);
    dragonFade.value = cam.fade;
    app.camera.position.lerpVectors(prevCam, curCam, alpha);
    app.camera.lookAt(cam.target);
    fx.update(frameDt, app.camera, canvas.height);
  }, 0);
  const tp = (x: number, z: number, heading = dragon.kin.heading) => {
    dragon.spawn(x, z, heading);
    cam.reset(cameraFollow(dragon, hold));
  };
  const PRESETS: Record<string, [number, number, number]> = { hero: [2.4, 12, 6], side: [Math.PI / 2, 8, 7], low: [2.8, 2, 5], wide: [2.6, 25, 16], face: [3.0, 6, 3] };
  debug.register(null, { tp, behaviour: (name: string) => tb.brain.behaviour(name) });
  /** A key tap through the real input path (the controller reads it next step). */
  const tap = (code: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 60);
  };
  debug.register('toothless', {
    mood: () => ({ ...tb.brain.face.state.mood }),
    face: () => ({ ...tb.brain.face.state, mood: undefined }),
    posture: () => tb.brain.behaviours.posture.current,
    fire: () => tap('KeyF'),
    jump: () => tap('Space'),
  });
  debug.register('cam', {
    preset(name: string) {
      const p = PRESETS[name];
      if (!p) return Object.keys(PRESETS);
      cam.yaw = dragon.kin.heading + p[0];
      cam.pitch = THREE.MathUtils.degToRad(p[1]);
      cam.distance = p[2];
      return name;
    },
  });
  return { ...tb, asset, dragon, cam, fx, tp };
}
```

- [ ] **Step 2: The game page**

**Variant A** — `src/main.ts` is Plan 3 Task 16's test-scene page (it builds `createTestScene()` and a `DragonCharacter` itself). Replace the whole file with:

`src/main.ts`:
```ts
import './styles.css';
import { createApp } from './app/createApp';
import { createTestScene } from './world/testScene';
import { CollisionWorld } from './world/collision';
import { createToothless } from './characters/dragon/toothless';

const app = createApp(document.getElementById('app')!);
const test = createTestScene();
app.add(test.root);
app.loop.addSim(() => test.update(app.loop.simTime));
const world = CollisionWorld.fromObjects([test.root]);
const hud = document.getElementById('hud')!;
hud.textContent = 'Loading Toothless…';

createToothless({ app, world, spawn: { x: 0, z: 6, heading: Math.PI } })
  .then(() => {
    hud.textContent = `Isle of Berk · click to control · WASD move · Shift gallop · C prowl · Space jump · F / left click plasma · mouse look · wheel zoom · quality: ${app.preset.name}`;
  })
  .catch((e) => {
    console.error('[game] Toothless failed to load', e);
    hud.textContent = 'Toothless failed to load — see the console';
  });
app.loop.start();
```

**Variant B** — `src/main.ts` is Plan 5a Task 14's Cove page (it calls `createCove(app)`). Replace the whole file with the version below.
- It keeps Plan 5a's Cove, collision world, spawn, region update with interaction spheres, `berk.spot` and `berk.cove`.
- `createToothless` takes over the asset, character, camera, input, loops, `berk.tp` and `berk.cam.preset` (now with `face`).
- This variant was written against Plan 5a's documented API and was not run while planning. If a name differs in the committed Cove code, follow the committed code and report it.

```ts
import './styles.css';
import { createApp } from './app/createApp';
import { debug } from './core/debug';
import { CollisionWorld } from './world/collision';
import { createCove } from './world/cove/cove';
import { azimuthDir, headingOfAzimuth, pondPoint } from './world/cove/coveGeometry';
import { LAYER_UNDERWATER } from './world/renderLayers';
import type { InteractionSphere } from './world/region';
import { createToothless } from './characters/dragon/toothless';

const app = createApp(document.getElementById('app')!);
const hud = document.getElementById('hud')!;
hud.textContent = 'Loading the Cove…';

async function start(): Promise<void> {
  const cove = await createCove(app);
  const world = CollisionWorld.fromObjects(cove.collisionRoots());
  hud.textContent = 'Loading Toothless…';
  const s = cove.spawnPoints[0];
  // his legs show through the pond; the Cove's interest points (the pond, M7b's fish and butterflies) are live
  const t = await createToothless({ app, world, spawn: s, interest: [cove.interestPoints], extraLayers: [LAYER_UNDERWATER], seed: 1 });
  /** Paws and body spheres push grass (M7b) and ring the pond. */
  const spheres: InteractionSphere[] = [];
  app.loop.addRender((_alpha, frameDt) => {
    spheres.length = 0;
    for (const p of t.dragon.planner.paws) spheres.push({ center: p.pos, radius: 0.14 });
    t.dragon.proxies.items.forEach((item, k) => spheres.push({ center: t.dragon.proxies.centers[k], radius: item.radius }));
    cove.update(frameDt, { time: app.loop.simTime, camera: app.camera, interactions: spheres });
  }, 10);
  const [px, pz] = pondPoint(cove.header, 1.35, Math.PI); // west bank, looking east across the water
  const [rx, rz] = azimuthDir(cove.header.routeA.azimuth);
  const rimAlong = cove.header.routeA.rStart + cove.header.routeA.steps * cove.header.routeA.tread + 3;
  const SPOTS: Record<string, [number, number, number]> = {
    spawn: [s.x, s.z, s.heading],
    pond: [px, pz, Math.atan2(cove.header.pond.cx - px, cove.header.pond.cz - pz)],
    rim: [rx * rimAlong, rz * rimAlong, headingOfAzimuth(cove.header.routeA.azimuth + 180)],
    gully: [azimuthDir(cove.header.gully.azimuth)[0] * 45, azimuthDir(cove.header.gully.azimuth)[1] * 45, headingOfAzimuth(cove.header.gully.azimuth + 180)],
  };
  debug.register(null, { spot: (name: string) => (SPOTS[name] ? (t.tp(...SPOTS[name]), name) : Object.keys(SPOTS)) });
  debug.register('cove', { region: () => cove, stats: () => ({ terrain: cove.terrain.stats(), rocks: cove.rocks?.triangles() ?? 0 }) });
  hud.textContent = `Isle of Berk · click to control · WASD move · Shift gallop · C prowl · Space jump · F / left click plasma · mouse look · wheel zoom · quality: ${app.preset.name}`;
}

start().catch((e) => {
  console.error('[game] failed to load', e);
  hud.textContent = 'The Cove failed to load — see the console';
});
app.loop.start();
```

- [ ] **Step 3: Typecheck and tests** — `npm run typecheck` → clean; `npm test` → no suite that passed before fails now.

- [ ] **Step 4: Play check (browser)**
  - Start the dev server (`npm run dev`, port 5190) and open a new chrome-devtools page at `http://localhost:5190/?q=low`. The HUD must show the jump/plasma hint. `list_console_messages`: no errors or warnings.
  - Through `evaluate_script`, then `take_screenshot` to `docs/progress/img/m6/game-<name>.png`, then read each:
    - `berk.cam.preset('hero')`, then `berk.toothless.jump()` and wait 0.35 s → `jump`: in the air, tucked, wings flared.
    - `berk.cam.preset('side')`, then `berk.toothless.fire()` and wait 0.45 s → `plasma`: the bolt or the impact flash.
    - Wait 2 s more, then `berk.cam.preset('low')` → `scorch`: a soft round mark on the ground, not a square.
    - `berk.behaviour('sit')` and wait 2 s → `sit`.
    - `berk.behaviour('sleep')` and wait 12 s → `sleep`: curled, eyes shut, the camera still at its distance (Task 1). Then press W (`press_key`) and check he gets up.
    - `berk.cam.preset('face')` → `face`. With `berk.toothless.face()` showing a non-zero `gazeYaw`, the irises sit toward that side.
  - Reload with `?q=high` and fire once: the console stays clean and the FX are not darkened by AO.
  - With the pointer locked (click the canvas): WASD, Shift, C, Space and F / left click all work. **No key uses Ctrl.**
  - Close your page and stop your dev server.
  - Variant B only: `berk.spot('pond')` → look for fish/butterfly interest (the head turns toward them when idle), and check the underwater legs.

- [ ] **Step 5: Progress log**
  - Add an M6 section to `docs/progress/phase1.md`: the library sheet, the lab strips, `metrics.json` (all pass), the game captures, and every tuning or pose change made during Tasks 2–11.
  - List the known gaps too: Plan 3's course scripts, if any still fail.

- [ ] **Step 6: Commit** — `src/characters/dragon/toothless.ts`, `src/main.ts`, `docs/progress/phase1.md`, `docs/progress/img/m6/game-*.png`. Message: `feat(game): Toothless with his idles, face, jump and plasma on the game page`.

---

## Decisions this plan makes (for review)

1. **Posed paws are exempt from slip and float.** A paw an owning layer drives (sit's hind paws, lie/sleep's four) follows the pose, not a ground contact. Penetration still applies, and the ground guard keeps it within millimetres.
2. **Boundedness is measured from each bone's pose at the start of the run.** With the wings folded, the ribs sit ~170° from bind for the whole run: a held pose, not a spin.
3. **`jump_land` owns no legs.** It shapes body and tail only (`bodyPitch` metadata); the leg IK reaches the paws down onto their spots. The airborne poses carry `bodyPitch` instead of a `root`.
4. **The wings are one controller's job.** Plan 3's climb-mode `wingFold` write becomes a flare demand, and `climb.wingsOpen` is removed: unfolding to 0.8 stands the doubled ribs up vertically.
5. **Interrupt policies.** Shake and yawn are `exit` (any input plays their exit), per spec §6.11 "any input interrupts". Actions are `none`.
6. **The jaw's closed rest** (`rig.jaw.restCloseRad`, from Plan 2's look pass if present) is applied by `FaceRig`, because `RigSkeleton` rewrites the jaw from bind every step.
7. **Repo weight.** `toothless.poses.glb` grows to ≈ 2.1 MB (23 full-track clips at 30 fps) and `library_sheet.jpg` ≈ 0.25 MB.
8. **Collision fix (Task 1).** It is in this plan because M6 exposes it: lying down, and plasma near geometry. Plan 3 may take it earlier.

## Self-Review

**1. Spec coverage**

| Spec | Where |
|---|---|
| §5.11 pose library: sit, lie, curled sleep, sniff, stalk, stretch, jump crouch/launch/tuck/land, plasma rear-up, climb reach, scramble hook; scratch loop, shake-off, yawn, scramble-up; explicit masks, loop, blends, interrupt | Task 2 (`POSES`, clip builders, `META`, `poses_json`); Task 3 parses and applies |
| §5.12 deformation/QA renders for the library | Task 2 Step 7 (contact sheet) |
| §6.1 step 6 (pose layers before the finals), step 8 (face) | Task 3 (`dragon.ts` order); Tasks 4 and 6 (`hooks.face`) |
| §6.8 look priorities: plasma aim > interest > travel > camera > glances; eyes first | Task 5 (`Attention`), Task 6 (brain arbitration; Plan 3 keeps travel/camera/glances); Task 4 (eye gaze) |
| §6.9 folded wings flare on landings and steep climbs | Task 3 (`WingController`), Task 7 (jump flare), Task 9 (scramble flare), climb flare |
| §6.10 layer stack, masks, enter/loop/exit, interrupts play the exit | Task 3 (`PoseLayerStack` v2, ownership, tuck path); Task 6 (gestures, posture chain, reverse exits) |
| §6.11 catalogue, utility selection, 2/10/25/60 s thresholds, `berk.behaviour` | Task 6 (`BEHAVIOURS`, `BehaviourSelector`, `force`); Task 11 (`berk.behaviour`) |
| §6.12 mood → blinks, pupils, ears, smile, yawn | Task 4 (+ Task 2 face curves) |
| §6.13 jump: crouch 0.12 s, ~2 m apex, tuck, wings, front-feet-first landing, recovery | Task 7 |
| §6.13 plasma: charge 0.3 s (rear, jaw, teeth, ears, pupils, dorsal glow), turn first > 100°, recoil + skid, 0.7 s cooldown; bolt core/trail/light; impact flash/sparks/smoke/scorch/shake | Task 8 (+ Task 2 `plasma_rear` face curves) |
| §6.15 small camera shake | Task 8 |
| §8.1 behaviour selector respects cooldowns and interrupts; camera never inside geometry | Task 6 tests; Task 1 tests |
| §8.2 lab checks for idles and actions (all metrics), 60 s loop boundedness | Task 10 (`idle-cycle-58s`, 17 scripts × 2 rigs); Tasks 3, 6, 7, 8 real-rig gates |
| §9 M6 exit | Task 10 Step 4 and Step 8 |
| §12 absolute rotations, explicit masks, size-capped particles | Task 3 (every layer from bind), Task 2 (masks), Task 8 (`Particles`) |
| M5 hand-offs: scramble polish, eye gaze | Task 9; Task 4 |

**2. Placeholder scan.** No TBD or TODO. Every code step carries complete code. Task 11 variant B is complete code but was not run: it depends on Plan 5a's Cove.

**3. Type and name consistency** (checked by `tsc` over the whole harness)
- **Layers and wings:**
  - `PoseLayerStack.set(name, weight, time, additive, order)`: posture orders 0.1/0.2/0.3 (Task 6), gestures 1 (Task 6), `climb_reach` 1 and `scramble_up` 2 (Task 9); Plan 3's calls use the default 0.
  - `WingController.demand` sources: `'climb'` (Tasks 3, 9) and `'jump'` (Task 7). The one fold writer is `WingController.driveFold` (`wingFold`, else `wings_folded`).
- **Brain and actions:** `DragonAction.step(d, dt, standing)` is implemented by `JumpAction` and `PlasmaAction`. `DragonBrain` runs actions after behaviours; `createToothlessBrain` returns `{ brain, jump, plasma }` for the lab (Task 10), the tests and `createToothless` (Task 11).
- **Metadata names** match between `library.py`'s `META`/`meta_entries` and `PoseClipMeta`: `ownsLegs`, `root`, `bodyPitch`, `wings`, `soles`, `loopStart`, `exit`, `look`, `face`, `duration`. Face channels are `jaw`, `blink`, `squint`, `smile`, `snarl`, `teeth_out`, `nostril_flare`, `pupil`, `ears`, `plasmaGlow` (`FaceController.MAX_CHANNELS` + `pupil`, `ears`).
- **Tuning sections** (Task 3) match their readers: `wings` (Tasks 3, 9), `pose` (3), `face` (4), `attention` (5), `behaviour` (6), `jump` (7), `plasma` (8).
