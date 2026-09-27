# Phase 1 — Vertical Slice: Engine, Toothless, the Cove — Design

**Date:** 2026-09-26
**Status:** Design approved section-by-section in brainstorming; awaiting written-spec review.
**Program context:** `2026-09-26-isle-of-berk-roadmap.md` (art direction, sourcing, phase order, cross-phase contracts).

## 1. Goal

Prove the whole rebuilt pipeline at final quality in one small area: a new engine, a rebuilt Toothless who
moves beautifully on the ground, and the Cove from the first film, lit like the animated films.

**Done when:** in the Cove at golden hour, Toothless walks, trots, gallops, turns, jumps and climbs out of the
hollow with no sliding or floating feet; idles with personality; fires plasma; the Cove reads as the film;
every Motion Lab metric passes; and the user signs off after playing it. The desktop shortcut then switches to
the new game.

## 2. Scope

**In:** engine foundation (§3), rendering and the film look (§4), the Toothless asset including saddle and
prosthetic-fin linkage (§5), the ground motion system including cat-like climbing, personality idles, jump and
plasma (§6), the Cove region (§7), dev tools (Motion Lab, Asset Viewer, debug API), verification (§8).

**Out:** flight and wing-beat (Phase 2; the wing *rig* is built now), Hiccup (Phase 2), the rest of Berk,
ocean, day/night cycle, colour shrine (Phase 3), village (Phase 4), NPC dragons, villagers, livestock
(Phase 5), audio, UI/menus beyond a minimal HUD, water wading/swimming, pounce-and-play.

## 3. Architecture

### 3.1 Project

- New repository `C:\Users\zacle\isle-of-berk\` under git (the old project had no version control).
- `C:\Users\zacle\dragon-walk\` is not modified. The desktop shortcut keeps launching it until sign-off.

### 3.2 Stack (versions pinned at scaffold time)

| Piece | Choice | Why |
|---|---|---|
| Build | Vite 8 + TypeScript (strict) | fast dev loop, typed modules for a large codebase |
| 3D | three.js r186, **WebGL2 renderer** | mature; every technique needed is proven. Rendering setup is isolated in `render/` so a later WebGPU move stays contained |
| Spatial queries | three-mesh-bvh | ray and shape casts against rock meshes for foot planting, climbing, collision and camera |
| Tests | Vitest | unit tests for the exact math (IK, gait, springs, planner, camera) |
| Dev UI | lil-gui (dev pages only) | live tuning panels |
| Asset tooling | Blender 5.1 (headless Python), gltf-transform CLI, Node scripts | reproducible asset builds |

### 3.3 Source layout

```
isle-of-berk/
  src/
    core/        loop, fixed-step clock, input, events, debug API (window.berk)
    render/      renderer, post stack, lighting rig, sky/fog, quality presets
    world/       region manager, terrain, water, vegetation, props, collision world (BVH)
      regions/cove/
    characters/
      dragon/    asset binding, rig metadata, motion system (see §6), face, behaviours
    camera/      third-person orbit camera with collision
    fx/          plasma, particles, decals
    dev/         Motion Lab, Asset Viewer, film-strip capture, perf HUD
  pages: index.html (game), lab.html (Motion Lab), viewer.html (Asset Viewer)
  pipeline/
    blender/     toothless/ (build scripts, proportions.json), trees/, cc0/ (processing), qa/
    terrain/     offline terrain bake (Node/TS)
    cc0/         Poly Haven fetch scripts + asset manifest
  public/assets/ built GLBs, textures (KTX2), rig/pose metadata
  tests/
  CREDITS.md     every sourced asset (CC0) with source URL
```

### 3.4 Simulation loop and determinism

- Simulation advances in **fixed 1/120 s steps** (accumulator, max 8 steps per frame). Rendering interpolates
  root transforms, camera and bone rotations between the last two simulation states, so motion is smooth on
  144/165/240 Hz displays.
- Every simulation module exposes `update(dt)` and depends only on its inputs, so the Motion Lab can step the
  world frame-by-frame with no `requestAnimationFrame` (immune to the throttled-background-tab problem).
- Every procedural layer computes **absolute** local bone rotations from rest plus layers each step — no
  relative per-frame rotation is ever accumulated (the old "spinning" bug class).

### 3.5 Pages

- **Game** (`index.html`): the Cove, Toothless, HUD hint line.
- **Motion Lab** (`lab.html`): clean studio lighting, a test course (§8.2), deterministic stepper, scripted
  input playback, overlays (foot targets, planted markers, swing arcs, support polygon, centre of mass, spine
  curve, look targets, collision proxies), film-strip capture, live tuning panels, metrics readout.
- **Asset Viewer** (`viewer.html`): turntable, material/lighting presets, deformation test poses, morph-target
  sliders, bone/weight visualisation, LOD switcher.

### 3.6 Asset pipeline

- **Toothless:** `pipeline/blender/toothless/` builds him from source (§5.2), headless and re-runnable
  (`blender --background --python`). Output: `toothless.glb`, `toothless.poses.glb`, `toothless.rig.json`.
- **CC0 assets:** `pipeline/cc0/` fetches from the Poly Haven API into a local cache with a manifest (asset id,
  resolution, licence, URL); `pipeline/blender/cc0/` processes them (decimate to budget, bake normal maps from
  the full-resolution source, generate LODs, tree card atlases and impostors).
- **Compression:** textures to KTX2 (Basis Universal) and geometry to meshopt via gltf-transform; runtime uses
  `GLTFLoader` + `KTX2Loader` + `MeshoptDecoder`.
- **Blender hygiene** (mandatory, from the old project): collections by purpose, helpers deleted immediately,
  orphans purged before every save, every datablock named, one concern per file, multi-angle + numeric
  verification before any diagnosis, pre-export checklist (apply transforms/modifiers, recalculate normals
  outward, purge).

### 3.7 Build and launch

- Dev: `npm run dev` (Vite). Tests: `npm test`. Build: `npm run build` to `dist/`.
- Launch stays a double-click: a launcher serves `dist/` on a local port and opens the browser (same UX as the
  old shortcut).

### 3.8 Debug API — `window.berk`

Namespaced successor to the old `dbg`: `step(n, dt)`, `pause()`, `play()`, `cam.preset(name)`,
`cam.orbit(az, el, dist)`, `tp(x, z)`, `toggle(overlay)`, `behaviour(name)`, `metrics()`, `perf()`,
`capture.set(name)`, `capture.filmstrip(script, frames)`, `lab.run(script) → metrics JSON`.

## 4. Rendering and the film look

### 4.1 Target frame

HTTYD 2/3 at golden hour: warm low key light, cool sky fill, shadows deep but open, layered atmospheric haze,
saturated natural greens, a bright rim of light around Toothless so the black dragon always reads.

### 4.2 Colour pipeline

Linear HDR (half-float targets) → film tone curve → colour-grade 3D LUT → subtle vignette → sRGB output.
Tone curve candidates AgX (default), Khronos Neutral and ACES, chosen by side-by-side test in M1. Bloom only on
values above ~1.0 HDR (eyes, plasma, sun glints, fire) — never a full-frame haze.

### 4.3 Sun and shadows

Directional sun with **cascaded shadow maps** (three `CSM`): 4 cascades × 2048 on High, practical split,
tuned bias; crisp contact shadows under the paws, stable shadows to the rim. Replaces the old single 180 m
shadow box.

### 4.4 Sky, image-based light and fog

- Physically based analytic sky with an art-directed tint and a soft cloud layer. The sky is rendered into a
  PMREM environment map that supplies ambient light and reflections (regenerated only when the sun moves).
- Fog replaces three's built-in fog globally via shader chunks: **exponential height fog + distance fog with
  sun-direction in-scattering** (the haze brightens and warms toward the sun).
- Sun specular on water is clamped (the old white glare column must not return).

### 4.5 Character lighting

Toothless's skin shader adds a film-style rim/kicker term keyed to the sun and sky directions (fresnel ×
light-facing), plus a subtle cool sheen, so his silhouette separates from dark rock and forest.

### 4.6 Ambient occlusion

Screen-space AO (**N8AO**, transparency-aware mode) for contact grounding. Transparent effects (plasma,
particles, motes, smoke) render after AO and never go through its depth/normal prepass (the bug that forced
GTAO's removal). Fallback if N8AO misbehaves: GTAO on an opaque-only layer with transparents re-rendered after.

### 4.7 Anti-aliasing

4× MSAA on the composer's render targets + **alpha-to-coverage** on alpha-tested foliage (branch cards,
ferns), so foliage edges are smooth instead of shimmering. Grass is geometric blades (no alpha).

### 4.8 Post stack order

`Render (opaque) → AO → Render (transparent/FX) → Bloom → Output (tone curve + LUT + vignette)`.

### 4.9 Pond water

Custom shader: planar reflection (mirror camera, half resolution on High), refraction of the pond bed from the
opaque colour buffer, depth-based colour absorption from the scene depth texture, soft depth-faded shorelines,
scrolling dual normal maps for ripples, footfall/leaf ripple rings (ring pool in a small uniform array), clamped
sun glint.

### 4.10 Quality presets and budgets

| | High (RTX 3080 Ti, 1440p) | Low (integrated GPU) |
|---|---|---|
| Target | ≥ 60 fps; GPU ≤ 12 ms | ≥ 30 fps |
| Render scale | 1.0 | 0.75 |
| Shadows | CSM 4 × 2048 | CSM 2 × 1024 |
| AO | full | off |
| Pond reflection | half res | quarter res |
| Grass density | 100% | 30% |
| Tree LOD distances | ×1 | ×0.5 |

High-preset budgets: draw calls ≤ 800, visible triangles ≤ 4 M, texture VRAM ≤ 1.5 GB, main-thread JS ≤ 5 ms
(motion system ≤ 1 ms, world update ≤ 1 ms). Performance is measured independently of browser frame
throttling (timed `render()` + `gl.finish()` loops, plus `renderer.info`).

### 4.11 GPU selection

The automated test browser runs on the Intel Iris Xe. With the user's OK (asked in M1), Chrome is set to the
RTX 3080 Ti via the Windows per-app graphics preference. Perf gates for High are measured on the RTX; Low keeps
automated testing usable on the Iris Xe.

## 5. The Toothless asset

### 5.1 Reference and proportions

- Design: HTTYD 2 Toothless, checked against the user's reference renders
  (`C:\Users\zacle\Pictures\Screenshots\Screenshot 2026-06-12 155329/155348/155402/155430/155447.png`: side
  spread, top planform, side standing, three-quarter, head close-up).
- Key reads from the references: panther-like build, broad rounded head, large acid-green eyes with slit
  pupils, six ear plates (large pair + two smaller pairs), short powerful legs with pale claws, a row of small
  dorsal plates, main wings built as a **fan of ~7 thin ribs radiating from the wrist** with a scalloped
  trailing edge, a small pair of hip wings, a long tail ending in paired fins, both also fan-ribbed.
- `proportions.json` is the single source of truth for the model, the rig and the engine. Starting targets,
  locked at the M2 checkpoint: length nose→tail tip ≈ 7.3 m; wingspan fully spread ≈ 13.5 m; shoulder height
  ≈ 1.3 m; tail ≈ half the total length.

### 5.2 Build pipeline (headless Blender, re-runnable, deterministic)

1. Read `proportions.json` (joint positions in the rest pose, volume parameters).
2. **Body volume:** sculpt from blended anatomical volumes (ellipsoids, capsules, round cones; negative volumes
   for eye sockets, nostrils, mouth line) with smooth unions. Default technique: Blender metaballs; fallback:
   custom SDF evaluation + marching cubes. A short spike on the head chooses between them at the start of M2.
3. Convert to mesh → voxel remesh → smooth → **QuadriFlow** quad remesh (clean deformable topology) →
   subdivide a copy as the high-resolution source.
4. Detail on the high-res copy: scale pattern, muscle definition, brow ridges, nostril and mouth detail via
   masked procedural displacement.
5. UV unwrap with planned seams (belly line, inner limbs); pack.
6. **Bake** high → low: normal, ambient occlusion, curvature; author albedo (near-black with subtle blue-purple
   variation, lighter claws) and roughness from masks.
7. Build separate parts (§5.3), the wings (§5.4) and the armature (§5.5) from the same proportions.
8. Skin weights (§5.6), shape keys (§5.7), pose library actions (§5.11).
9. Export (§5.10) and render QA (§5.12).

### 5.3 Parts

Eyes (sclera/iris sphere + cornea shell), retractable teeth, six ear plates, dorsal plates, claws, main wings,
hip wings, tail fins — natural on the right, the **red prosthetic** on the left — and the **saddle, harness and
prosthetic-fin linkage** (pedal + cable path) for Hiccup in Phase 2.

### 5.4 Fan-folding wings

- Topology: membrane panels span between adjacent ribs (grid topology per panel); each rib is a bone chain;
  panel vertices are weighted between their two ribs, so closing the ribs closes each wing like a fan.
- Folding: ribs rotate to lie along the forearm; the forearm folds against the upper arm; the upper arm lifts
  and sweeps back so the folded wing lies along the back.
- Bind pose: wings spread to the reference planform (membrane undistorted at bind).
- A corrective `membrane_pleat` shape (per side), driven by fold amount, adds soft slack and pleats in the
  folded state so it reads as membrane, not stretched plastic.
- Hip wings and tail fins use the same fan scheme at smaller scale.

### 5.5 Skeleton (~100 bones)

| Group | Bones |
|---|---|
| Spine & head | `pelvis` (root), `spine_01..03`, `chest`, `neck_01..04`, `head`, `jaw` |
| Ears | `ear_L_1..3`, `ear_R_1..3` |
| Front legs (×2) | `scapula`, `humerus`, `radius`, `metacarpal`, `toes` |
| Hind legs (×2) | `femur`, `tibia`, `metatarsal`, `toes` |
| Tail | `tail_01..12` |
| Tail fins (×2) | `fin_root`, `fin_rib_1..3` |
| Hip wings (×2) | `hipwing_root`, `hipwing_rib_1..4` |
| Main wings (×2) | `wing_humerus`, `wing_forearm`, `wing_wrist`, `wing_thumb`, `wing_rib_1..7_a/_b` |
| Tack | `saddle`, `pedal` |

Side suffix convention `_L`/`_R`. Every joint's bend axis, twist axis and limits are measured in Blender and
**exported as metadata** — the engine never guesses bone local axes (the old `b14` axis confusion cost days).

### 5.6 Skinning

Blender automatic (heat) weights on the watertight body, then scripted corrections (membrane panels weighted
between ribs by angular position; limb seams smoothed), max 4 influences per vertex, normalised, no unweighted
vertices.

### 5.7 Face, eyes and teeth

- Shape keys (glTF morph targets): `blink_L`, `blink_R`, `squint`, `smile` (gummy), `snarl`,
  `nostril_flare`, `membrane_pleat_L/R`.
- Teeth are **retracted by default** (he is Toothless); a `teeth_out` control extends them for the snarl and
  plasma charge.
- Eyes: engine-side shader with a procedural iris (radial fibres, green gradient, dark limbal ring), parallax
  iris depth, a pupil that morphs slit ↔ round via a uniform, and a clearcoat cornea with catch-lights.

### 5.8 Materials

- Body: physical material — baked normal/AO/roughness maps, near-black albedo with subtle variation, low
  clearcoat (~0.15), cool sheen, the rim term (§4.5). Albedo is tintable so colour-shrine skins can return in
  Phase 3.
- Membranes: separate double-sided material with a faint back-light transmission tint.
- Dorsal plates carry an emissive mask (off by default) that glows blue during plasma charge.
- Claws pale ivory; saddle leather and iron; prosthetic fin red leather over dark ribs.

### 5.9 Budgets and LOD

LOD0 (hero) 30–40k triangles in total (body ~25k, the rest wings, eyes, teeth, claws, fins and tack);
LOD1 ~12k; LOD2 ~4k (reused by Phase 5 NPC Night Furies). Textures: body 2048²
(albedo, normal, ORM), wings 2048² (mirrored UVs), small parts 1024² atlas, all KTX2.

### 5.10 Export and rig metadata

- `public/assets/characters/toothless/toothless.glb`: skinned meshes, morph targets, placeholder materials
  (the engine binds its own).
- `toothless.rig.json`: bone roles and chains, rest lengths, bend/twist axes and joint limits, foot contact
  points (sole centre, toe tip, heel), collision proxies (spheres for head, chest, belly, hips, tail),
  anchors (eyes, mouth/muzzle, saddle, pedal), wing fold/spread target poses, proportions summary.
  The motion system reads only this file for anatomy — it is species-agnostic (roadmap contract).

### 5.11 Pose library

`toothless.poses.glb` holds Blender actions as glTF animations: single-frame poses (sit, lie down, curled
sleep, sniff, stalk crouch, stretch, jump crouch/launch/tuck/land, plasma rear-up, climb reach, scramble hook)
and short clips (scratch loop, shake-off, yawn, scramble-up). `poses.json` gives each one its bone mask, loop
flag, blend-in/out times and interrupt policy. Blender's glTF exporter strips constant tracks, so masks are
**explicit metadata**; the engine never infers a mask from which tracks survived export.

### 5.12 Asset QA

- Turntables (front, side, top, three-quarter) from fixed Blender cameras, composited side-by-side with the
  matching reference renders.
- Deformation test poses rendered in clay: walk extremes, gallop gather/extend, sit, lie, scratch, climb reach,
  wings folded/half/spread, jaw open, neck turned 90°, tail curled. Checks: no candy-wrapping at joints, no
  membrane tearing or visible intersection, volume held at elbows and knees.
- Numeric: bounding box within ±3% of proportions, left/right symmetry error < 1 mm, triangle budgets, weight
  sanity, naming convention, no NaN.

## 6. The motion system

### 6.1 Per-step pipeline (order matters)

1. Input → controller intent (desired velocity, facing, action requests).
2. Body kinematics: velocity, heading, collision (§6.14).
3. Gait engine: phase advance and gait blend (§6.3).
4. Foot planner: plant/swing states and targets (§6.4).
5. Body solver: pelvis, chest, spine curve (§6.5), climbing adaptation (§6.6).
6. Pose layers: library poses and clips with bone masks (§6.10).
7. Procedural finals: head/neck look (§6.8), leg IK pinning the feet (§6.7), springs (§6.9).
8. Face: morph weights, eye uniforms (§6.12).
9. Write skeleton (absolute local rotations) → skinning.
10. Camera (§6.15).

### 6.2 Controller

- Camera-relative WASD. Movement keys alone: **3.2 m/s** (trot). **C** toggles a **1.4 m/s** prowl walk.
  Shift held: **10 m/s** gallop. Space: jump. Left click or F: plasma. (Never bind Ctrl: Ctrl+W closes the
  browser tab even under pointer lock.)
- Momentum: acceleration ~5 m/s² (gallop launch ~8 m/s²), braking ~12 m/s² (he skids to a stop).
- Turn rate ~200°/s at ≤1.5 m/s, tapering to ~80°/s at full gallop (he swings wide at speed); turning on the
  spot steps the feet.

### 6.3 Gait engine

| Gait | Speed (m/s) | Cadence (Hz) | Duty factor | Phase offsets (LH, LF, RH, RF) | Airborne phase |
|---|---|---|---|---|---|
| Walk (lateral sequence) | 0–2.4 | 0.8–1.2 | 0.70 | 0, 0.25, 0.50, 0.75 | no |
| Trot (diagonal pairs) | 2.4–5.5 | 1.3–1.8 | 0.50 | 0, 0.50, 0.50, 0 | slight |
| Gallop (rotary, cat-like) | 5.5–10 | 1.9–2.4 | 0.33 | 0, 0.65, 0.10, 0.55 | yes |

Stride length = speed ÷ cadence. Gait parameters blend continuously by speed with ±0.3 m/s hysteresis; phase
offsets interpolate on the circle so transitions never jump. Swing heights: walk 0.12 m, trot 0.18 m,
gallop 0.28 m, plus obstacle clearance. All numbers are starting values tuned in the Motion Lab.

### 6.4 Foot planner

- Each paw is **planted** (locked to a world position and surface normal) or **swinging**.
- Lift-off is triggered by gait phase, or forced when the leg over-stretches or the body rotates in place.
- Landing target: the hip's predicted position at touchdown (current velocity and yaw rate) + the neutral
  stance offset + velocity × half the stance duration (Raibert-style placement: the foot lands so the hip
  passes over it mid-stance).
- The target is projected onto real geometry by casting along the body's down axis against the collision BVH;
  a few candidates around it are scored (slope, flatness, distance, edge proximity); steep (> 75°) and edge
  footholds are rejected.
- Swing path: eased horizontal travel with a lift arc; mid-swing ray checks add clearance over obstacles; the
  target is re-evaluated during swing and blended smoothly if it moves.
- Paw orientation: aligned to the surface at plant; heel lifts first at take-off, toes curl in swing, toes
  reach first at touchdown.

### 6.5 Body solver and spine

- Hips ride above the hind feet and shoulders above the front feet on critically-damped springs, at nominal
  heights from the rig metadata → the body pitches on slopes, rolls on side slopes and rises over steps
  naturally.
- Dynamics layered on top: a footfall impulse per contact into a vertical spring; gait-phase oscillation
  (two small dips per walk cycle; one large pitching rock per gallop stride); gallop **gather/extend** (the
  chest–hip distance oscillates ~±8% with the stride); lean into turns (roll from centripetal acceleration);
  pitch with acceleration and braking.
- Spine: a smooth Hermite curve from hips to chest to neck base; lateral bend from yaw rate (the body arcs
  through turns); spine bones are placed along the curve by arc length with twist distributed.

### 6.6 Climbing

| Surface | Behaviour |
|---|---|
| ≤ 45° | Normal locomotion; body tilts with the ground (pitch/roll limited to ±35°). |
| 45°–70° | Climb mode: body up-axis blends toward the surface normal (≤ 60° tilt); slower climbing gait with higher swings and shorter strides; speed capped at 1.8 m/s (Shift: 3 m/s scramble); toes curl and claws dig in; wings open ~20% for balance. |
| > 70° with a ledge top ≤ 2.5 m above the forepaws | **Scramble-up**: forepaws hook the lip, the body is pulled up, hind legs push against the wall (~0.9 s), triggered by moving into the wall. |
| > 70° otherwise | Blocked; he slows and turns along the wall. |
| Drops > 1.5 m | Hop down with jump pose and landing absorb. |

Footholds and ledges are probed with ray and shape casts in the body frame. The Cove walls include designed
climbable routes (§7.2).

### 6.7 Leg IK

- Hind legs (digitigrade, three segments): the metatarsal angle is driven from the femur angle (the mammalian
  pantograph relationship), then an analytic two-bone solve places femur and tibia to reach the ankle. Knees
  bend forward.
- Front legs: the shoulder blade rotates and slides with leg extension (a large realism win), then a two-bone
  solve for humerus and radius; the metacarpal aligns to the surface. Elbows bend backward.
- Joint limits clamp every solution (no flips). If a target is unreachable, the foot is lifted toward reach
  and the body lowers slightly rather than hyper-extending.

### 6.8 Head, neck and eyes

- Look-at targets by priority: plasma aim > interest points (fish, butterflies, anything moving nearby) >
  travel direction > the camera when idle > occasional random glances.
- Eyes move first, the head follows (saccade then pursuit). Rotation is distributed down the neck with
  per-bone limits.
- Gaze stabilisation: the head partially cancels body bob so it stays steady while running.
- The head leads into turns (anticipation).

### 6.9 Secondary motion

- **Tail:** 12 angular spring-dampers (yaw and pitch), softer toward the tip, driven by body angular velocity
  and lateral/vertical acceleration (counterbalance through turns and jumps), gravity droop, ground avoidance
  (the tail lifts rather than penetrating terrain). Extends straight and rises in the gallop.
- **Ears, hip wings, tail fins:** springs toward mood targets plus random twitch impulses.
- **Folded wings:** held by a fold spring; flare slightly on landings and during steep climbs.
- **Breathing:** chest expansion rate from ~12/min when calm to ~40/min after a gallop, easing back.

### 6.10 Pose layers

- Layer stack: procedural locomotion base → library pose layers (bone-masked, weighted; e.g. `sit` masks the
  hind legs, spine and tail while the front legs stay procedurally planted) → additive layers (breathing,
  recoil) → procedural finals (look, IK, springs).
- Transitions: every behaviour has enter / loop / exit phases; interrupts play the exit (he gets up from
  lying rather than snapping to standing).

### 6.11 Behaviours (personality idles)

- Catalogue: look around, sniff ground, sit, lie down, curl up asleep, scratch ear with a hind leg, shake off,
  stretch, yawn (gummy), watch a butterfly or fish, ear twitch, tail flick, glance at the camera.
- Selection: utility scoring with context, randomness and cooldowns. Small behaviours from ~2 s idle; sit
  eligible from ~10 s; lie down from ~25 s; curl up asleep from ~60 s.
- Any input interrupts with the behaviour's exit transition. `berk.behaviour(name)` forces one for testing.

### 6.12 Face and mood

Mood (calm, curious, excited, tired, aggressive) drives: blinks (every 2–6 s, occasional double blink, blink
on large head turns); pupils (slit when aggressive or in bright light, round when curious or content); ears
(perked, neutral, back when galloping, flat when aggressive); the gummy smile in content moments; the yawn.

### 6.13 Actions

- **Jump:** anticipation crouch (~0.12 s) → launch (≈2 m apex, forward momentum carried) → air pose (legs
  tuck, tail extends, wings open slightly for balance) → front-feet-first landing with spine compression and
  spring absorb → recovery.
- **Plasma:** charge ~0.3 s (head rears, jaw opens, teeth out, ears flat, pupils slit, dorsal plates glow
  blue) → the bolt leaves the mouth anchor along the camera aim (he turns first if the aim is more than ~100°
  from his facing) → recoil impulse through neck, chest and suspension, with a small backward skid → ~0.7 s
  cooldown. Bolt: hot core, glow trail, moving light. Impact: flash, sparks, smoke, projected scorch decal,
  small camera shake.

### 6.14 Collision

- Static world: terrain chunks and simplified rock collision meshes merged into a BVH; trees as vertical
  capsules.
- Toothless: collision spheres from the rig metadata (head, chest, belly, hips) resolved against the BVH with
  slide response. Feet and tail use ray casts only (they adapt; they do not block).
- Surfaces too steep to climb block via the climbing rules (§6.6).

### 6.15 Camera

Orbit around a chest-height target (mouse with pointer lock; wheel distance 4–18 m) with critically-damped
follow and velocity look-ahead; a sphere-cast from target to camera against the BVH pulls it in (and eases
back out slowly), so it never ends inside rock or buildings; gentle auto-recentre behind him when moving after
~2 s without mouse input; raised pitch while climbing; dithered fade of Toothless if the camera is forced
within ~1.2 m of him.

### 6.16 Tuning

All motion constants live in one typed config with lil-gui panels in the Motion Lab; tuned presets are saved as
JSON and committed.

## 7. The Cove

### 7.1 Region contract

The Cove is a `Region`: `id`, bounds, local transform, `heightAt(x, z)`, `normalAt(x, z)`, collision BVH,
spawn points, interest points, `load()`, `update(dt)`, `dispose()`. The Phase 3 island composes regions; for
the slice the Cove is centred at the world origin.

### 7.2 Layout

- Region ~400 × 400 m.
- A near-circular hollow: floor ~70 m across, rim ~100 m across, rock walls 15–25 m high.
- A still pond (~35 × 25 m, up to ~2.5 m deep) with a few boulders breaking the surface; grassy, mossy banks;
  a sloping gully entrance on one side.
- Designed climbable routes: boulder steps and ledges (within the §6.6 rules) up at least two walls, one
  requiring a scramble-up.
- The rim: dense conifer forest with clearings. Beyond ~200 m: low-detail hills, then distant peaks fading
  into haze.

### 7.3 Terrain

- Baked offline by `pipeline/terrain` (Node/TS): a 1024 × 1024 heightfield at 0.4 m spacing (16-bit), the
  hollow and gully sculpted with explicit shape functions, a light hydraulic-erosion pass for natural runoff
  lines, and baked masks (slope, curvature, flow/wetness, AO, splat weights).
- Runtime: chunked terrain meshes (64 m chunks, distance LOD with skirts).
- Material: up to six scanned CC0 layers — grass, forest floor, moss, wet mud, pebbles, rock — with albedo,
  normal and ORM each, in texture arrays; height-based blending for natural transitions; triplanar mapping for
  rock on steep slopes; macro variation and distance-dependent UV scale to hide tiling; wet darkening near the
  water.

### 7.4 Rock walls

Poly Haven scanned cliffs and boulders (candidates: `coastal_cliff_01/02/04`, `rock_face_01/02`,
`rock_moss_set_01/02`, `boulder_01`), decimated to ≤ 60k triangles per large piece with normal maps baked from
the full-resolution scans, plus LODs and simplified collision meshes. Kit-bashed into the wall ring. The rock
shader blends terrain texture into the base and adds moss on up-facing surfaces, so rocks sit in the ground
with no floating seams.

### 7.5 Pond

The §4.9 water surface over a textured pond bed (pebbles, mud, submerged rocks, darkening with depth), a wet
band on the banks, reed and grass tufts at the edge.

### 7.6 Trees

The raw Poly Haven conifers are 7.9 M (`fir_tree_01`) and 17.4 M (`pine_tree_01`) polygons — unusable
directly. Instead, a Blender script builds game-ready conifers: ~5 fir/spruce variants (8–25 m) and ~3
saplings, trunks with scanned bark texture, branch whorls of card clusters whose needle atlas (albedo, normal,
alpha, translucency) is **baked from the Poly Haven scans**. LOD0 ~4–8k triangles, LOD1 ~1–2k, LOD2 octahedral
impostor. Vertex-shader wind (trunk sway, branch flutter) from shared wind uniforms. Instanced per variant and
LOD.

### 7.7 Ground cover and props

- Geometric grass blades, instanced (~150–250k visible on High within ~60 m), density from the splat masks,
  wind, and **trample**: up to 16 interaction spheres (paws, body, tail) bend blades away.
- Ferns (`fern_02`), shrubs, Nordic wildflowers (heather purple, harebell blue, small yellow), moss patches,
  fallen logs (`dead_tree_trunk`), stumps (`tree_stump_01/02`), roots (`pine_roots`) — all decimated to budget.

### 7.8 Lighting

Sun ~12–15° elevation from the west-northwest so half the hollow is in warm light and half in cool shadow;
cool sky fill; authored light-shaft cards where the sun crosses tree gaps (soft, depth-faded, with dust); the
pond mirrors the walls.

### 7.9 Ambient life

- Fish in the pond (6–10; simple meshes with vertex swim wave; visible through refraction; look-at interest
  points).
- Dragonflies over the water (4–6), butterflies near flowers (6–10, interest points), a bird flock overhead
  (12–20, boids).
- Falling leaves, some landing on the pond as ripples.
- Pollen and dust motes: small, sparse, **screen-size capped and distance-faded**, visible mainly in the light
  shafts (the old full-screen white discs that read as snow must not return).

### 7.10 Asset manifest and credits

`pipeline/cc0/manifest.json` lists every fetched asset (id, type, resolution, licence, source URL, processed
outputs). `CREDITS.md` is generated from it.

## 8. Verification

### 8.1 Unit tests (`npm test`)

- Two-bone IK reaches reachable targets within 1 mm, clamps gracefully when unreachable, respects pole and
  limits; the three-segment heuristic is consistent.
- Gait: phase offsets and duty factors per gait; transitions are continuous (no phase jumps).
- Foot planner: landing prediction for straight and turning motion; rejection of steep and edge footholds on
  fixtures.
- Springs: stable and convergent for dt from 1/240 s to 1/30 s.
- Camera collision never leaves the camera inside test geometry.
- Behaviour selector respects cooldowns and interrupts.

### 8.2 Motion Lab course and metrics

- Course: flat pad; 15°/30°/45°/60° ramps; a side slope; 0.25 m and 0.5 m steps; 1 / 2 / 2.5 / 3 m ledges;
  an uneven boulder field; a > 70° wall with a 2.3 m ledge; inside and outside corners.
- Input scripts (JSON timelines of keys and mouse) played at fixed dt.
- Pass criteria per run: planted-foot slip ≤ 1 cm; paw penetration ≤ 2 cm; planted-paw float ≤ 2 cm; no
  collision-proxy penetration; joint limits never exceeded; no NaN; bone rotations bounded over 60 s loops
  (the spin-bug check).
- Film strips (e.g. 12 frames across one gallop stride) for visual review. `berk.lab.run(script)` returns
  metrics JSON so runs are scriptable from chrome-devtools.

### 8.3 Asset QA

As §5.12, with the side-by-side reference composites and deformation renders saved per iteration.

### 8.4 Visual QA

A fixed Cove camera set — face close-up, three-quarter standing, gallop side-on, pond reflection, from the rim
looking down, wide establishing — captured at each milestone and compared with the previous capture.

### 8.5 Performance and health

High ≥ 60 fps at 1440p on the RTX and Low ≥ 30 fps on the Iris Xe (§4.10), budgets met, console clean (no
errors or WebGL warnings), no WebGL context loss across page reloads (renderer disposed on unload).

## 9. Milestones and user checkpoints

| # | Milestone | Ends with |
|---|---|---|
| M1 | Foundation: repo, Vite/TS, render/post/lighting scaffold, quality presets, debug API, Motion Lab and Asset Viewer shells, CC0 fetch pipeline, GPU preference (with OK) | a lit test scene in all three pages |
| M2 | Toothless block-out: sculpt spike, proportions, rough volumes, wings in planform | **user approves shape and proportions** |
| M3 | Detailed model: topology, details, bakes, materials, eyes, fan-fold wings, parts, saddle | **user approves the model** |
| M4 | Rig, weights, face shapes, rig metadata, deformation tests, pose-library scaffolding | deformation QA pass |
| M5 | Motion core: gait, foot planner, body solver, IK, springs, collision, camera — flat → slopes → climbing | **user tries it in the Motion Lab** |
| M6 | Pose library, behaviours, face and mood, jump, plasma | idles and actions pass lab checks |
| M7 | The Cove: terrain bake, rock walls, pond, trees, ground cover, lighting, life | **user reviews the Cove look** |
| M8 | Integration, polish, performance pass | **user play-test and sign-off**; shortcut switches |

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Script-sculpted model tops out below the film look | Early block-out checkpoint (M2), sculpt-technique spike, reference composites every iteration; if it still falls short, escalate with options (e.g. a standing base mesh from the user's Hunyuan3D, retopologised onto the same rig and pipeline). |
| Procedural motion reads as robotic | Authored pose library for style, underdamped springs for follow-through, measured tuning in the lab, user feel check at M5 before building idles on top. |
| Fan-fold wings intersect or crumple | Pleat correctives, fold-state test renders, joint limits on rib rotation. |
| Scanned assets too heavy | Hard budgets, decimation with baked normals, LODs and impostors, KTX2. |
| Climbing edge cases (target popping, body flipping at corners) | Angle limits, foothold scoring and smoothing, corners in the lab course. |
| Perf numbers skewed by the iGPU | GPU preference change (with OK); Low preset for automated runs. |
| Scope creep | The §2 out-of-scope list; new ideas go to the roadmap. |

## 11. Decisions deferred to implementation (defaults stated)

- Tone curve: AgX default; final pick by side-by-side in M1.
- AO: N8AO (transparency-aware) default; GTAO-with-layers fallback.
- Texture compression: KTX2 via KTX-Software `toktx` (installing it needs the user's OK in M1); WebP fallback.
- Sculpt technique: metaballs default; SDF + marching cubes fallback (M2 spike decides).
- Exact CC0 picks: finalised in the M7 manifest.
- Exact proportions: locked at the M2 checkpoint.

## 12. Lessons carried from the old project

- Never layer per-frame relative rotations on bones without resetting to a known base — compute absolute
  local rotations every step (§3.4).
- Blender's glTF exporter strips constant tracks — pose masks are explicit metadata (§5.11).
- Bone local axes come from exported metadata, never from guessing (§5.5).
- Recalculate normals outward before export (inward faces render see-through in three.js).
- When binding a skeleton manually, update world matrices before constructing it.
- Transparent effects must not pass through an AO depth/normal prepass (§4.6).
- Background tabs throttle `requestAnimationFrame` — verify with deterministic stepping (§3.4).
- Repeated navigations can exhaust WebGL contexts — dispose the renderer on unload; keep game and lab as
  separate pages.
- Follow the Blender hygiene protocol (§3.6).
- Size-cap and distance-fade particles (the "snow" motes); clamp sun glints on water (the glare column).
