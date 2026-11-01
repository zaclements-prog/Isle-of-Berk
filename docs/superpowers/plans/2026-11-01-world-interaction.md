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
