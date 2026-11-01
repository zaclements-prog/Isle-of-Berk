# Plan — World interaction: aerodynamics, a reactive world, destruction

**Why.** Toothless moves through the island, but the island doesn't answer back. Flying low should flatten the grass
under his wing beats, ruffle the water and bend the trees he passes. His plasma blast is a high-powered explosive and
should change the world: knock down and burn trees, scorch and flatten foliage, crater the soil, and break buildings.
The engine has to be set up for all of this before detail art goes on top.

## Architecture

### 1. One world-events bus (`src/world/events.ts`)
- A typed, synchronous bus that the systems publish to and subscribe from. It has no knowledge of who listens.
- **`blast`:** a plasma impact. Carries the point, the surface normal, a power and a radius, plus what was hit if it
  is known (terrain, tree, building).
- **`wingbeat`:** a downstroke, from the flight. Carries where the wings are, its strength and its height above the
  ground.
- Later events: `burn` (fire spreading), `fell` (a tree coming down), `collapse` (a building breaking).

### 2. One force field for everything that sways (`src/world/forceField.ts`)
- A small fixed set of force emitters, rewritten each step and read by the shaders as uniform arrays (the grass's
  push spheres generalised):
  - **contact spheres:** paws and body. They part the grass, as now.
  - **downwash disc:** under a flying dragon. Its strength grows with each downstroke and fades with height above the
    ground (≈ one wingspan). It flattens grass radially outward and pushes trees.
  - **wake sphere:** following a flying dragon. It bends the trees he passes, away from his path and along his heading.
  - **shockwave rings:** from a blast, expanding at ~60 m/s and decaying over ~1 s. They whip grass and trees outward.
- **Grass** (`grass.ts`) and **trees** (`props.ts`) read the same field. Trees take only the downwash, wake and
  shocks, as a lean at the crown on top of their wind sway.
- **Water** (ocean, pond) takes the downwash as spreading ripple rings and a spray burst, and blast shocks as a ring.

### 3. Collision that can change (`src/world/collision.ts`)
- **Composite world:** `CollisionWorld` becomes a composite of collision **layers**, each with its own BVH.
  - static rock and terrain, split into **tiles** (64 m), so a crater rebuilds one or two tiles;
  - **dynamic sets** (trees, buildings, debris) whose members can be removed or moved.
- **Same API:** queries (`raycast`, `groundAt`, `sphereContact`, `sphereCast`, `isInside`, `closestPoint`) keep their
  signatures and test every layer. Nothing that uses them changes.

### 4. Damage handlers (each subscribes to `blast`)
- **Foliage:**
  - Grass inside the radius is flattened, then burned. A CPU burn mask (one texel per metre, uploaded as a texture)
    darkens the terrain and removes tufts. It regrows slowly.
  - Trees:
    - each tree instance has a state: standing, scorched, falling, felled, stump;
    - a close blast fells a tree away from the impact (a hinged rotation at its base, then it lies);
    - a near one scorches it (darker crown, embers);
    - collision follows the state.
- **Terrain:** a blast deforms the heightfield into a crater (a bowl with a raised lip, depth by power and the
  material). The heightfield is the source of truth. The affected render chunks are rebuilt at their LODs, plus the
  collision tiles and the height texture the water and grass read. The splat gets scorched earth.
- **Structures:** buildings are assembled from a few pre-fractured parts (walls, roof halves, beams) with hit points.
  A blast in range damages them by distance. Past their hit points the parts break loose as debris.
- **Debris:** a small rigid-body integrator (spheres and boxes against the collision world, with gravity, bounce,
  friction and sleep). Pieces settle, and then become static collision in the dynamic layer, or fade.

### 5. Blast energy
- `plasma.blastPower` (tuning) scales the radius of each effect: shockwave, felling, scorching, crater depth and
  structure damage.
- One blast is the unit. Repeated blasts deepen craters and finish off damaged structures.

## Milestones
1. **Foundation and aerodynamics:**
   - the events bus, the force field, contact spheres moved onto it;
   - downwash and wake from flight on grass, trees and water;
   - blasts publishing `blast` with a shockwave through grass and trees;
   - tests and captures.
2. **Changing collision:** layered and tiled `CollisionWorld`, with dynamic sets (trees, buildings). Every existing
   gate stays green.
3. **Destructible foliage:** the grass burn mask and regrowth; tree states (scorch, fell, stump) with collision.
4. **Craters:** heightfield deformation with chunk, collision-tile, height-texture and splat updates.
5. **Destructible buildings and debris:** pre-fractured houses, hit points, the debris integrator, settling.

## Gates
- All existing tests stay green.
- New unit tests cover:
  - the bus;
  - the force field (downwash strength against height, the shock's speed and decay);
  - the collision layers (the same answers as today's single BVH on the same geometry, and changes after a tile
    rebuild);
  - each damage handler on a flat test world;
  - performance budgets per blast: crater rebuild under 8 ms, felling a tree under 1 ms.
- Captures on the island for each milestone.

## Status (2026-11-01): M1–M5 in, ready to review on a GPU machine

All five milestones are implemented, with 599 unit tests green (`npx vitest run --exclude 'tests/_scratch/**'`).
They have not been visually reviewed yet: software-GL captures in the cloud box were too slow. Review them on a real
GPU with `npm run dev`, then open the game page.

| Milestone | Where | What to look at |
|---|---|---|
| M1 force field | `src/world/events.ts`, `src/world/forceField.ts`; hooks in `island/grass.ts`, `island/props.ts`, `island/ocean.ts` | Fly low (under ~16 m) over grass, trees and water: the downwash flattens grass in pulses, trees lean, and water ripples and foams. Passing trees fast bends them away from the path. Blasts send a shock ring through grass, trees and water. |
| M2 layered collision | `src/world/collision.ts` (`CollisionLayer`, `CollisionSet`); `IslandRegion.createCollisionWorld` | Behaviour should be identical to before (it is tested to be). |
| M3 foliage | `src/world/damage/burnMask.ts`, `src/world/damage/trees.ts` | A blast chars the ground, burns grass to stubble and flattens it further out. Nearby trees scorch; close ones fall away from the blast, lie as logs (with collision) and crumble to stumps after ~45 s. |
| M4 craters | `src/world/damage/craters.ts`, `Terrain.refresh` | A bowl with a raised lip. Repeated blasts dig deeper, and rock gives less. Chunks, collision and water depth follow. |
| M5 buildings | `src/world/damage/structures.ts`, `src/world/damage/debris.ts`; `BerkLandmarks.breakables` | Houses (100 HP), the hall (600 HP) and piers (120 HP) break into wall, roof and plank debris. The debris tumbles, settles and becomes walkable rubble. |

**Play-check hooks** (browser console):
- `berk.world.stats()`: grass, tree states, broken structures, debris, layers and downwash.
- `berk.world.blast(x, z, power?)`: a blast on the ground; power 1 also plays the plasma explosion.
- `berk.world.probe()`: camera and force-field uniforms.
- `berk.toothless.fire()`: a real plasma shot along the camera.

**Good test spots:**
- (200, 100): dense grass with trees.
- The village by the spawn point (`terrain.json` `spawn[0]`): houses.

**Tuning:**
- `plasma.blastPower` and `plasma.blastRadius` in `motion-tuning.json` scale every effect.
- Per-system defaults: `DEFAULT_FORCE_TUNING`, `DEFAULT_BURN_TUNING`, `DEFAULT_TREE_DAMAGE`, `DEFAULT_CRATER`,
  `DEFAULT_STRUCTURE` and `DEFAULT_DEBRIS`.

**Known gaps and next steps:**
- Boulders and props on a crater's rim are not re-seated (trees are: a felled tree falls from the dug ground).
- No fire spread (`burn` event) and no embers or smoke trails.
- Opened structures are drawn as their box parts: the gable infill, the crossed gable boards and the door of the
  longhouse mesh go when the first real damage swaps the mesh out.
- Done 2026-11-01 (wave 2, structures): buildings break part by part (per-part hit points, lean, char, supports,
  per-wall collision), moving debris collides with moving debris, and debris splashes on the sea and the pond (see
  `damage/structures.ts`, `damage/debris.ts`, `damage/splash.ts`).

## GPU review and fixes (2026-11-01)

Reviewed on an Apple M5 Max (ANGLE Metal) with the dev server, driving the systems directly (a scripted force
source hovering over the sea and the pond, a free camera, stepped captures).

**Black frames: a capture-timing artifact, not a render bug.** About 14,000 frames on the GPU (High and Low, about
100 blasts, cameras inside houses, under the terrain and water) had none. The canvas is created with
`preserveDrawingBuffer: false`: read in the same task as the render it holds the frame, read one task later (a
paused, stepped capture that screenshots or calls `toDataURL` afterwards) it is cleared, all zero. A slow software
renderer only widens that window. Capture with **`berk.capture(type?, quality?)`**, which renders and reads back in
one task.

| Found | Fix |
|---|---|
| Power-3 blasts took 7–11 ms (budget 8): rebuilding each touched 64 m terrain tile's BVH cost ~1.2 ms, four at a tile corner | `CollisionWorld.refitLayer`: craters move the tile's vertices in place and refit its BVH (0.15 ms vs 1.4–2.2 ms a tile). Power 3 now 3.0 ms median, 6.0 ms max at a tile corner; 1.2 ms median elsewhere |
| 7 of 37 houses buried 1.5–8.2 m on their uphill side, 10 floating up to 6.6 m downhill; their wall debris spawned inside the hill and 16 of 202 pieces ended under the ground (6 fell out of the world) | `levelHousePads` at load: each house gets a flat pad at the ground under its centre, easing back to the slope over a skirt that widens with the cut; houses whose walls overlap share a pad; close neighbours split the margin. Worst now 0.2 m buried (the intended sink), 0.8 m at one corner |
| Debris could tunnel or start inside the ground | `Debris` takes the ground: no corner ends below it (a frictional contact, so pieces still come to rest). 240 pieces from all 38 structures: 0 under the ground |
| Pier planks sank to the seabed and vanished | `Debris` takes the water: wood floats half under, with water drag, and is kept out of the collision |
| The downwash spray on the sea and pond was a regular checkerboard (`sin x · sin z`) | Two octaves of rotated value noise streaming outward, as a flow map (two phases crossfaded, so it never shears) |
| The wake barely moved the trees (~1% of pixels, ~4° at cruise) | `wakeRadius` 9 → 12, `wakeStrength` 1 → 1.8, the bend lingers twice as far behind, crown push cap 1.6 → 2.6 m (~10–12° at cruise) |
| Felled trees lay as whole green trees | The crown breaks off on impact: a charred log lies along the fall and a splintered stump stays; the log crumbles after `lie` |
| Stump (and log) vertex colours were authored as sRGB but read as linear, so pale | Converted to linear |

**Still to judge in play:** the wake's lean in motion; the pads' banks on the steepest terraces; whether a power-1
blast (fells within 4.5 m, crater radius 3.3 m) feels strong enough. The plan's grass test spot (200, 100) is forest
floor; use the meadow at (30, 30)–(40, 60).

## Wave 2 (2026-11-01, branch `wave2`)

Built on `look-faceted` (the faceted Toothless and the golden-hour grade), checked on the GPU (M5 Max, ANGLE Metal).
658 tests green.

| Piece | Where | Notes |
|---|---|---|
| Airborne plasma | `actions/plasma.ts`, `fx/plasmaFx.ts`, `camera/orbitCamera.ts`, `toothless.ts` | Fires in every flight state and mid-jump. The bolt flies along the aim ray at `boltSpeed` plus the body's speed along it; aim error 0.2–0.6 m at 50–180 m; range 320 m. An air charge pose (face plus half the rear on the flight clips, the beat held), a recoil pitch-up. Fires only within 75° of the flight path (holds up to 0.6 s for the camera to turn him). Flight camera lifted 3 m; a reticle ring. Far hits keep a ~3° flash and a sqrt-falloff shake. |
| Buildings piece by piece | `damage/structures.ts` | Per-part hit points, leaning/sagging/charring before a part breaks, per-wall collision (openings), supports (roofs on walls, planks on posts), collapse below 30% integrity. Rubble resting on a part or a house wakes when it goes. |
| Debris on debris | `damage/debris.ts` | Spatial-hash broad phase, sampled box contacts, sequential impulses; stacks settle and sleep. Blasts toss settled rubble. Hall collapse: 0.7 ms median per frame. |
| Splashes | `damage/splash.ts`, `forceField.ts` (`uForceRipple*`), `island/ocean.ts` | Spray, column and mist by impact energy; ripple rings and foam drawn by the water shader. |
| Fire | `damage/fire.ts`, `damage/fireFx.ts`, `trees.ts` (burning, burnt), `events.ts` (`burn`) | 2 m grid; ignites from blasts, scorched trees and felled logs; spreads downwind and with the downwash, decays by distance (~25 m), burns out in under 45 s; caps 180 cells / 24 trees. Faceted flames, ember beds, embers, faceted smoke; downwash fans flames and smoke. ~0.1 ms update, ~0.75 ms render at peak. |
| Crater rims | `island/props.ts`, `island/island.ts` (`reseatBoulders`) | Boulders re-seat on the dug ground, their collision hulls refit with them. |

**Known gaps:**
- A house swapped for its parts loses its gable infill, boards and door.
- The hall chews slowly (7 spread blasts to collapse).
- Floating wood that falls asleep freezes on the water.
- Fire doesn't set buildings alight.
- `berk.world.stats()` doesn't show fire (`island.fire.stats()` does).
- Two older wall-clock budget tests (`island.test.ts`, `collisionLayers.test.ts`) flake under heavy CPU load.

## Wave 3 (2026-11-01, branch `wave3`)

Play-test feedback round: dark terrain, quick/charged fire, ground clipping, animation chaining.

| Item | Branch / commit | Notes |
|---|---|---|
| Navy-black terrain shade | `d8c34cb` | Shade-gated neutral warm fill, reflection cut in shade, AO floor 45%, wet 74% |
| Tap / hold-charge plasma | `wave3-charge` `e99c8a5` | Tap <0.25 s = power 0.6; hold 2 s auto-fires power 2.6; early release fires scaled; plates light tail→head |
| Ground clipping | `wave3-clip` `44d3b68` | `CollisionWorld.version` re-seats planted paws after edits; stale landing prediction ignored; landing seats from ground under body; pelvis/head floors |
| Transitions | `wave3-anim` `efa64aa`, `aa9b3b5` | Running takeoff wing cross-fade, jump push, landing carry, new `runout` phase, Catmull-Rom clip sampling, jump buffering |

Known gaps: tail tip can dip 0.2–0.4 m into steep slopes (secondary.ts ground avoidance); a full charge
on the ground puts him inside his own blast; he stands still while charging on the ground and sinks 2–3 m
while charging in flight; plates clip to white past ~1.6 s of charge; HUD text doesn't mention hold-to-charge;
standing-jump launch steps 0→1.5 m/s in one step; Space during the takeoff clip is ignored.
