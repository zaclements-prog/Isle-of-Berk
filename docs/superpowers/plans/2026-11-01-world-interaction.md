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
- Boulders and props on a crater's rim are not re-seated.
- Debris does not collide with other moving debris, only with settled debris.
- Structures show damage only as a darker tint before they collapse; nothing comes loose part by part yet.
- No fire spread (`burn` event) and no embers or smoke trails.
- The per-blast budgets (crater < 8 ms, felling a tree < 1 ms) are only checked loosely in CI; measure them in
  the browser.
- Headless swiftshader sometimes returns black frames. This predates this work, so retake those frames in capture
  scripts.
