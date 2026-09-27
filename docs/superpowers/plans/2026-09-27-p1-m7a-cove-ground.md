# Phase 1 · M7a The Cove — Ground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cove from the first film as a streamed-in world region: the terrain bake and runtime, the six-layer splat material, the kit-bashed scanned rock walls with climbable routes, the pond, the backdrop and the lighting. Then put Toothless in it.

**Architecture:**
- **Bake.** An offline Node bake (`pipeline/terrain/`) turns explicit shape functions, a light hydraulic-erosion pass and derived masks into a committed 1024² heightfield, splat maps and a header. The bake is deterministic from a seed.
- **Runtime terrain.** The runtime (`src/world/terrain/`) samples the heightfield exactly as its triangles do. It builds 64 m chunks with distance LODs and skirts, and shades them with an `addCompileHook` splat patch on `MeshStandardMaterial` over three `DataArrayTexture`s, so CSM shadows and Berk fog still apply.
- **Rocks.** Rock scans are decimated and normal-baked in headless Blender (`pipeline/blender/cove/`, reusing Plan 2's runner and library), then placed by a pure, seeded layout that reads the heightfield.
- **Water.** The pond is an opaque custom water material. Its planar mirror and an opaque "underwater" pre-pass (colour + depth, which N8AO's single-pass render doesn't provide) render from the water mesh's `onBeforeRender`, inside the main frame, so they reuse that frame's shadow maps. A heightfield water-depth texture gives the smooth shoreline.
- **Region.** `createCove()` assembles everything behind the `Region` contract the Phase 3 island will compose.

**Tech Stack:** three 0.186.1 (WebGL2: `DataArrayTexture`, `sampler2DArray`), three-mesh-bvh 0.9.15 (via Plan 3's `CollisionWorld`), Node 24 + sharp 0.35.4 (bake, PNG/WebP), Blender 5.1.2 headless (rocks), Vitest 5, TypeScript 7.

**Spec:** `docs/superpowers/specs/2026-09-26-phase1-vertical-slice-design.md`:
- §7.1–7.5 and §7.8 (region, layout, terrain, rock walls, pond, lighting) and §7.10 (manifest/credits)
- §4.4 (fog, clamped sun glint), §4.6 (AO and transparency), §4.9 (pond water), §4.10 (budgets)
- §6.6 (climbing rules the routes must satisfy), §8.4–8.5 (visual QA camera set, perf gates)
- §12 (lessons)

Trees, grass, ground cover, props, ambient life, light shafts and motes (§7.6, §7.7, §7.9) are **Plan M7b** (`2026-09-27-p1-m7b-cove-life.md`), which builds on this plan.

**Branch and workspace:** executed in a git worktree on a local branch `phase1-cove`, created from `phase1-slice` after Plan 1 completes. Tasks 9–11 additionally need Plan 2's `pipeline/blender/{run.ps1, lib/}` (merge `phase1-toothless` into `phase1-cove` first, or rebase onto `phase1-slice` after Plan 2 has merged there). Task 14 needs Plan 3 (motion core) and Plan 2's exported asset.

**Pre-validated while planning** (scratch harness in the session scratchpad):
- The Task 2–4 bake code as written here ran end to end in **6 s**. Measured results:
  - heights −3.0…44.2 m; walls 14–25 m; floor edge r ≈ 37–39 m
  - pond 2.54 m deep, with nothing flooded outside it
  - gully max slope 20°; route B max 57.8°; route A risers 2.2 m
  - with GOLDEN_HOUR (292°, 14°), 50.4 % of the floor outside the pond is sunlit (spec §7.8: "half in warm light")
- The terrain splat hook (Task 7) and the water shaders (Task 12) compiled with **zero errors** in a headless Chrome over SwiftShader (strict GLSL ES 3.0). That run included the Berk fog chunks, CSM's `setupMaterial` and a PMREM environment (the `USE_ENVMAP` path).
- The Blender path of Task 9 (Poly Haven glTF import, collapse decimate, Cycles high→low tangent normal bake, LODs, collision mesh, GLB export with `EXT_texture_webp`) ran in 3 s on `rock_face_02` (29.6 k → 5.9 k tris), and the baked map had a sane mean (129, 129, 241).
- Poly Haven IDs verified against the live API — see Task 6 and Task 9.
- Tasks 5, 7, 8 and 10–13 were run as written in a scratch copy of the Plan 1 engine: **68 unit tests pass and `tsc` is clean**. The Cove preview rendered the terrain, rocks, pond (mirror, underwater pre-pass, ripples) and backdrop at `?q=high` and `?q=low` with a clean console. The run also simulated Plan 1's hardening wave (a `scene.fog` FogExp2 proxy, `shadowMap.autoUpdate = false` plus one update per frame).
- Task 9's `rocks.py` ran on the real scans (coastal_cliff_01/02, rock_face_01/02, boulder_01, rock_moss_set_02; 1k while planning). All seven sources take about 3 min.
  - Planning found three things the script now handles: `boulder_01` arrives as near-soup (24k islands until welded at 0.1 mm); the ends of the cliff scans taper, so their fronts float; the moss sets' roughness texture can't be re-packed.
- Measured on the Low preset: the pond's two extra views add **67 draw calls and 0.57 M triangles** at the `pond` camera. That is after restricting the underwater pre-pass to one render layer; before, it was 104 calls.

## Global Constraints

- **World:** metres, **+Y up, +X east, −Z north**. Compass azimuth φ: 0° = north (−Z), 90° = east (+X), matching `src/render/sun.ts`. The Cove is centred at the world origin, and its region contract is spec §7.1.
- **Determinism:**
  - Randomness in bake and runtime comes only from `mulberry32` (`src/core/rng.ts`; `pipeline/terrain/rng.mjs` is a byte-identical port, test-enforced). Nothing reads `Math.random`, `Date` or `performance.now` inside bake maths or `update()`.
  - The bake is reproducible: same seed, identical files.
- **Heightfield contract:** a square grid of `size` samples (1024), sample `i` at `origin + i·spacing` (origin −204.8 m, spacing 0.4 m) on both axes.
  - Heights are stored as uint16 LE over [`heightMin`, `heightMax`] = [−8, 72] m.
  - Every quad splits along the (i, j+1)–(i+1, j) diagonal, the same split as three's `PlaneGeometry`. `Heightfield.heightAt` interpolates on those triangles, so it agrees with the render and collision meshes.
- **Splat contract:**
  - `splatA` RGBA = grass, forest, moss, mud. `splatB` RGBA = pebbles, rock, wet, baked AO. The six layer weights sum to exactly 255 per texel.
  - Layer textures come in three arrays (albedo sRGB; normal GL; **armh** = AO, roughness, **height** — terrain metalness is always 0, so its channel carries the blend height; no alpha, so canvas decoding is exact).
- **Materials:** every material goes through the app material pipeline (`app.add` / `app.materials.prepare`). Shader patches use `addCompileHook` only. Custom `ShaderMaterial`s that want Berk fog set `fog: true` and include the fog chunks.
- **Textures:** WebP only (Plan 1 Ruling 4: no KTX2 tooling). Every fetched asset goes through `pipeline/cc0` (`wanted.json` → `manifest.json` → `CREDITS.md`).
- **Collision:**
  - Collision geometry is exposed as invisible `THREE.Object3D` roots (`Region.collisionRoots()`) in exactly the form Plan 3's `CollisionWorld.fromObjects(roots)` consumes: world-space, non-instanced meshes, outward-wound.
  - Collision meshes are never added to the render scene.
- **Climbing contract (spec §6.6, Plan 3):**
  - ≤ 45° walkable; 45–70° climb mode.
  - > 70° with a ledge top ≤ 2.5 m above the forepaws → scramble-up; otherwise blocked.
  - Drops > 1.5 m → hop-down.
  - The two designed routes out of the hollow (A: scramble terraces, B: climb slope) and the gully must satisfy these rules. The bake tests (Task 2) enforce this, and so does the rock layout, which keeps every rock out of the corridors (Task 10). Toothless's Cove runs in Task 14 check it end to end.
- **Budgets (spec §4.10, High):** draw calls ≤ 800; visible triangles ≤ 4 M; texture VRAM ≤ 1.5 GB. Low (Iris Xe) must hold ≥ 30 fps: `berk.perf()` ≤ 33 ms/frame, measured with the gpuFence perf tool. This plan's share (ground) should stay under ~60 % of each budget, leaving room for M7b:
  - main-view triangles (terrain + rocks, `berk.cove.stats()`) ≤ 2.4 M
  - whole-frame draw calls (every pass, `berk.perf()`) ≤ 480 on High
- **Plan 1 hardening wave (prerequisite).** Every task after Task 4 assumes it has merged into `phase1-slice`. It provides:
  - `App.remove(root)`, which releases CSM materials and disposes GPU resources; `CoveRegion.dispose()` calls it.
  - a `scene.fog` FogExp2 proxy synced to the Berk fog, which N8AO's AO fade needs. Keep Berk fog as the real fog. A `ShaderMaterial` with `fog: true` must carry `THREE.UniformsLib.fog`.
  - `renderer.shadowMap.autoUpdate = false`, with one update requested per frame at the top of the main render. Extra views never request shadow updates.
- **Shaders compile behind the loading step:** `createCove` awaits `renderer.compileAsync` before it resolves.
- **Hook keys are pure:** a hook key fully determines the GLSL it injects (`terrainSplat`, `coveRock`). Per-material values go through uniforms or defines (`TERRAIN_LOW`, `ROCK_LOW`). Every material the Cove creates enters the pipeline through `CoveRegion.add` (or `app.materials.prepare` if it is created later). Nothing is cloned after preparation.
- **Render layers** (`src/world/renderLayers.ts`):
  - Layer 0: the main camera, the pond mirror and the shadow maps.
  - `LAYER_MAIN_ONLY` (1): grass, particles, motes and shafts (M7b). Main camera only.
  - `LAYER_UNDERWATER` (2): things that can be seen through the water (pond terrain chunks, pond/bank rocks, fish, Toothless). The only layer the refraction pre-pass renders.
- **Tone curve:** fixed by Plan 1 before M7. Tune water, rocks and the backdrop under it; never change exposure or the curve here.
- **Never bind Ctrl.** The Motion Lab keeps its course; only the game page (`index.html`, Task 14) switches to the Cove.
- **Commits:**
  - One per task (fix rounds add commits).
  - Write the message to a file with the Write tool and `git commit -F <file>`, ending with your own model-accurate `Co-Authored-By:` trailer.
  - Stage explicit paths only; never `git add -A`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `pipeline/terrain/rng.mjs` | mulberry32 (port of `src/core/rng.ts`) |
| `pipeline/terrain/noise.mjs` | deterministic value noise, fBm, ridged |
| `pipeline/terrain/coveShape.mjs` | `COVE` constants, azimuth helpers, height shape functions, erosion protection mask |
| `pipeline/terrain/erosion.mjs` | seeded droplet hydraulic erosion (light pass) |
| `pipeline/terrain/masks.mjs` | slope, curvature, horizon AO, sun visibility, wetness, splat weights, quantisation |
| `pipeline/terrain/bake.mjs` | CLI: shape → erode → masks → `public/assets/world/cove/*` + preview |
| `pipeline/terrain/terrain.test.mjs` | unit tests for everything above + the committed outputs |
| `pipeline/cc0/terrainLayers.mjs`, `.d.mts`, `pack-terrain.mjs` | terrain layer packing (albedo, normal, armh) — pure packer + CLI |
| `pipeline/blender/cove/rocks.py`, `rock_kit.json`, `rocks_qa.py` | rock scans → split, orient, decimate, bake, LODs, collision, GLB export; QA renders |
| `pipeline/blender/tests/test_rocks.py` | Blender unit tests of the rock pipeline (runs in Plan 2's `npm run blender:test`) |
| `public/assets/world/cove/` | `terrain.json`, `height.bin`, `splatA.png`, `splatB.png`, `rocks/{<id>.glb,<id>.col.glb,kit.json}` |
| `public/assets/textures/terrain/<id>/` | `albedo.webp`, `nor.webp`, `armh.webp` per splat layer |
| `src/world/region.ts` | `Region` contract and shared types |
| `src/world/renderLayers.ts` | `LAYER_MAIN_ONLY`, `LAYER_UNDERWATER` |
| `src/world/terrain/heightfield.ts` | `Heightfield` (decode, triangle-exact `heightAt`, `normalAt`) |
| `src/world/terrain/chunks.ts` | chunk grid, LOD chunk geometry with skirts, LOD selection |
| `src/world/terrain/collisionMesh.ts` | fine/coarse terrain collision triangles (exact partition) |
| `src/world/terrain/heightTexture.ts` | half-float height texture + world→texel-centre uv transform |
| `src/world/terrain/layers.ts` | layer table, browser loader into `DataArrayTexture`s, splat texture loader |
| `src/world/terrain/splatShader.ts` | splat GLSL + `createSplatMaterial(uniforms, low)` |
| `src/world/terrain/terrain.ts` | `Terrain`: chunk meshes, LOD update, layer marking, collision root |
| `src/world/cove/coveGeometry.ts` | runtime mirror of the bake's compass helpers, wall height, pond ellipse, keep-clear corridors |
| `src/world/cove/rockLayout.ts` | seeded kit-bash placement (pure) |
| `src/world/cove/rockMaterial.ts` | rock hook: moss on top faces + terrain blend at the base |
| `src/world/cove/rocks.ts` | `loadRockKit`, `RockField` (LOD objects + collision), `addRocks` |
| `src/world/cove/backdrop.ts` | distant hills and peaks around the terrain square (pure geometry) |
| `src/world/cove/cove.ts` | `CoveRegion`, `createCove()` |
| `src/world/water/waterShader.ts` | water GLSL |
| `src/world/water/waterNormals.ts` | tileable procedural normal map |
| `src/world/water/ripples.ts` | `RipplePool`, `SplashDetector` |
| `src/world/water/planarViews.ts` | mirror maths, oblique clipping, mirror + underwater pre-pass targets |
| `src/world/water/pondWater.ts` | `PondWater`, `pondRect`, `waterDepthData`, `addPond` |
| `src/dev/cove/main.ts`, `cove.html`, `vite.config.ts` | Cove preview page (orbit camera, QA presets, stats) |
| `src/dev/lab/coveScripts.ts`, `tests/lab/coveRoutes.test.ts` | Toothless on the Cove's routes (Task 14) |
| `src/main.ts` | game page: Toothless in the Cove (Task 14) |
| `tests/world/*.test.ts` | runtime unit tests |
| `docs/progress/img/cove/` | visual QA captures |

---

### Task 1: Region contract, seeded RNG port and noise

**Files:**
- Create: `src/world/region.ts`, `pipeline/terrain/rng.mjs`, `pipeline/terrain/noise.mjs`, `pipeline/terrain/terrain.test.mjs`

**Interfaces:**
- Consumes: `mulberry32` (Plan 1 `src/core/rng.ts`).
- Produces:
  - `src/world/region.ts`:
    - point types: `interface SpawnPoint { x; z; heading }`, `interface InterestPoint { id: string; kind: 'water' | 'view' | 'butterfly' | 'fish' | 'flower'; position: THREE.Vector3; weight: number }`
    - collision/interaction types: `interface TreeCapsule { x; y; z; radius; height }`, `interface InteractionSphere { center: THREE.Vector3; radius: number }`
    - `interface RegionUpdateContext { time: number; camera: THREE.PerspectiveCamera; interactions: readonly InteractionSphere[] }`
    - `interface Region { readonly id; readonly bounds: THREE.Box3; readonly transform: THREE.Matrix4; heightAt(x, z); normalAt(x, z, out?); collisionRoots(): THREE.Object3D[]; treeCapsules(): readonly TreeCapsule[]; readonly spawnPoints: readonly SpawnPoint[]; readonly interestPoints: InterestPoint[]; update(dt, ctx): void; dispose(): void }`
    - `load(app)` is performed by the factory (`createCove(app)`, Task 13): an async factory returns a loaded region, so no region exists half-loaded.
  - `pipeline/terrain/rng.mjs`: `mulberry32(seed) → () => number`.
  - `pipeline/terrain/noise.mjs`: `hash2(ix, iy, seed)`, `valueNoise2(x, y, seed)`, `fbm2(x, y, seed, octaves, lacunarity, gain)`, `ridged2(x, y, seed, octaves)` — all in [0, 1).

- [ ] **Step 1: Write the failing tests**

`pipeline/terrain/terrain.test.mjs` (this file grows through Task 4):
```js
import { describe, it, expect } from 'vitest';
import { mulberry32 as bakeRng } from './rng.mjs';
import { mulberry32 as appRng } from '../../src/core/rng';
import { hash2, valueNoise2, fbm2, ridged2 } from './noise.mjs';

describe('rng port', () => {
  it('produces the engine mulberry32 stream exactly', () => {
    const a = bakeRng(1337);
    const b = appRng(1337);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });
});

describe('noise', () => {
  it('is deterministic and in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.731 - 90;
      const y = i * 1.37 + 12;
      for (const v of [hash2(i, -i, 3), valueNoise2(x, y, 7), fbm2(x, y, 7), ridged2(x, y, 7)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      expect(fbm2(x, y, 7)).toBe(fbm2(x, y, 7));
    }
  });
  it('is continuous (small steps make small changes)', () => {
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.01;
      worst = Math.max(worst, Math.abs(valueNoise2(x + 0.001, 3.3, 1) - valueNoise2(x, 3.3, 1)));
    }
    expect(worst).toBeLessThan(0.01);
  });
  it('changes with the seed', () => {
    let diff = 0;
    for (let i = 0; i < 100; i++) diff += Math.abs(fbm2(i * 0.37, 1.1, 1) - fbm2(i * 0.37, 1.1, 2));
    expect(diff).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- pipeline/terrain` → FAIL (`Cannot find module './rng.mjs'`).

- [ ] **Step 3: Implement**

`pipeline/terrain/rng.mjs`:
```js
/** mulberry32 — the same generator as src/core/rng.ts, so bake-time and runtime seeded streams agree. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

`pipeline/terrain/noise.mjs`:
```js
// Deterministic 2D value noise + fractal sums for the terrain bake. Pure: no global state, no Math.random.

/** Integer lattice hash → [0, 1). Math.imul keeps it exact on every JS engine. */
export function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [0, 1). */
export function valueNoise2(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = fade(x - ix);
  const v = fade(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal Brownian motion of value noise, normalised to [0, 1). */
export function fbm2(x, y, seed = 0, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged fractal (sharp crests) in [0, 1): rocky breakup for cliff bands. */
export function ridged2(x, y, seed = 0, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise2(x * freq, y * freq, seed + o * 131) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}
```

`src/world/region.ts`:
```ts
import type * as THREE from 'three';

/** Where Toothless (or a camera) may start in a region. Heading: forward = (sin h, 0, cos h). */
export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
}

/** Something worth looking at (Plan 4's look-at priorities: interest points > travel > camera). */
export interface InterestPoint {
  id: string;
  kind: 'water' | 'view' | 'butterfly' | 'fish' | 'flower';
  position: THREE.Vector3;
  weight: number;
}

/** A tree trunk collider: base centre (x, y, z), radius, height. */
export interface TreeCapsule {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

/** A sphere that pushes vegetation and ripples water (paws, body, tail). */
export interface InteractionSphere {
  center: THREE.Vector3;
  radius: number;
}

export interface RegionUpdateContext {
  time: number;
  camera: THREE.PerspectiveCamera;
  interactions: readonly InteractionSphere[];
}

/**
 * A streamed-in piece of the world (spec §7.1). Factories (e.g. `createCove(app)`) return a fully loaded
 * region; the Phase 3 island composes several.
 */
export interface Region {
  readonly id: string;
  readonly bounds: THREE.Box3;
  readonly transform: THREE.Matrix4;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  /** Invisible world-space collision meshes, in the form Plan 3's CollisionWorld.fromObjects consumes. */
  collisionRoots(): THREE.Object3D[];
  treeCapsules(): readonly TreeCapsule[];
  readonly spawnPoints: readonly SpawnPoint[];
  readonly interestPoints: InterestPoint[];
  update(dt: number, ctx: RegionUpdateContext): void;
  dispose(): void;
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- pipeline/terrain` → 4 tests pass. `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `feat(cove): region contract, seeded rng port and terrain noise`.

---

### Task 2: Cove shape functions

**Files:**
- Create: `pipeline/terrain/coveShape.mjs`
- Modify: `pipeline/terrain/terrain.test.mjs`

**Interfaces:**
- Consumes: `fbm2`, `ridged2` (Task 1).
- Produces: `COVE` (constants below), `clamp`, `lerp`, `smoothstep`, `azimuthDeg(x, z)`, `azimuthDir(deg) → [x, z]`, `rayFrame(x, z, deg) → { along, lateral }`, `wallHeight(phi)`, `cliffCurve(t, k)`, `ringJitter(phi)`, `floorHeight(x, z)`, `baseHeight(x, z)`, `pondQ(x, z)`, `routeAProfile(along)`, `routeBProfile(along)`, `coveHeight(x, z)`, `erosionMask(x, z)`, `samplePos(i, j) → [x, z]`, `sunDirection(azimuthDeg, elevationDeg) → [x, y, z]`.

Design (spec §7.2):
- The floor is ≈ 70 m across, the rim ≈ 100 m. Wall height is H(φ) = 19.5 − 5.5·cos(φ − 292°): 14 m toward the sun (WNW), 25 m opposite.
- The gully runs toward the sun, so evening light streams through it onto half the floor.
- The pond (≈ 35 × 25 m, 2.5 m deep) sits east of centre.
- Route A (azimuth 330°) is seven 2.2 m scramble terraces with 2.7 m treads.
- Route B (azimuth 250°) is a climb-mode slope peaking near 58°.

- [ ] **Step 1: Write the failing tests** (append to `terrain.test.mjs`)
```js
import {
  COVE, coveHeight, azimuthDir, rayFrame, wallHeight, pondQ, routeAProfile, cliffCurve, azimuthDeg, sunDirection,
} from './coveShape.mjs';

const slopeDegAt = (x, z, h = 0.4) => {
  const gx = (coveHeight(x + h, z) - coveHeight(x - h, z)) / (2 * h);
  const gz = (coveHeight(x, z + h) - coveHeight(x, z - h)) / (2 * h);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
};
const centreline = (deg, r0, r1, step = 0.4) => {
  const [ux, uz] = azimuthDir(deg);
  const pts = [];
  for (let r = r0; r <= r1 + 1e-9; r += step) pts.push({ r, x: ux * r, z: uz * r, y: coveHeight(ux * r, uz * r) });
  return pts;
};
const inSector = (deg, centre, halfDeg) => Math.abs(((deg - centre + 540) % 360) - 180) < halfDeg;

describe('cove shape', () => {
  it('uses the compass convention of src/render/sun.ts', () => {
    expect(azimuthDeg(0, -10)).toBeCloseTo(0, 9); // north = −Z
    expect(azimuthDeg(10, 0)).toBeCloseTo(90, 9); // east = +X
    const s = sunDirection(292, 14);
    expect(s[0]).toBeLessThan(0); // WNW: west …
    expect(s[2]).toBeLessThan(0); // … and a little north
    expect(Math.hypot(...s)).toBeCloseTo(1, 12);
  });
  it('has a ~70 m floor and 14–25 m walls reaching the rim at ~50 m', () => {
    for (let az = 0; az < 360; az += 15) {
      if (inSector(az, COVE.gully.azimuth, 25) || inSector(az, COVE.routeA.azimuth, 12) || inSector(az, COVE.routeB.azimuth, 12)) continue;
      const [ux, uz] = azimuthDir(az);
      for (let r = 0; r <= 30; r += 3) expect(coveHeight(ux * r, uz * r)).toBeLessThan(1.5);
      const rim = coveHeight(ux * 55, uz * 55);
      expect(rim).toBeGreaterThan(wallHeight(az) - 3);
      expect(rim).toBeLessThan(wallHeight(az) + 4);
    }
    expect(wallHeight(292)).toBeCloseTo(14, 9);
    expect(wallHeight(112)).toBeCloseTo(25, 9);
  });
  it('cuts a walkable gully toward the sun (≤ 25°, ≥ 14 m wide at its mouth)', () => {
    let worst = 0;
    for (const p of centreline(COVE.gully.azimuth, 20, 100)) worst = Math.max(worst, slopeDegAt(p.x, p.z));
    expect(worst).toBeLessThan(25);
    const [ux, uz] = azimuthDir(COVE.gully.azimuth);
    const [px, pz] = [-uz, ux];
    const mouth = coveHeight(ux * 45, uz * 45);
    for (const s of [-7, -3.5, 0, 3.5, 7]) expect(Math.abs(coveHeight(ux * 45 + px * s, uz * 45 + pz * s) - mouth)).toBeLessThan(1.5);
  });
  it('route A is scramble terraces: risers ≤ 2.3 m, flat treads ≥ 2.5 m', () => {
    const ra = COVE.routeA;
    for (let i = 0; i < ra.steps; i++) {
      const a = ra.rStart + i * ra.tread;
      expect(routeAProfile(a + ra.riserRun + 0.05) - routeAProfile(a - 0.05)).toBeLessThan(2.31);
      const treadStart = a + ra.riserRun + 0.05;
      const treadEnd = a + ra.tread - 0.05;
      expect(treadEnd - treadStart).toBeGreaterThanOrEqual(2.5);
      expect(Math.abs(routeAProfile(treadEnd) - routeAProfile(treadStart))).toBeLessThan(0.01);
    }
    const line = centreline(ra.azimuth, ra.rStart + 0.5, ra.rStart + ra.steps * ra.tread - 0.5, 0.1);
    let biggestJump = 0;
    for (let k = 1; k < line.length; k++) biggestJump = Math.max(biggestJump, line[k].y - line[k - 1].y);
    expect(biggestJump).toBeLessThan(2.31);
    expect(line[line.length - 1].y).toBeGreaterThan(wallHeight(ra.azimuth) - 1.5);
  });
  it('route B is a climb-mode slope: steepest 50–65°, never above 70°', () => {
    let worst = 0;
    for (const p of centreline(COVE.routeB.azimuth, 30, 54)) worst = Math.max(worst, slopeDegAt(p.x, p.z));
    expect(worst).toBeGreaterThan(50);
    expect(worst).toBeLessThan(65);
    expect(cliffCurve(0, 3.5)).toBeCloseTo(0, 12);
    expect(cliffCurve(1, 3.5)).toBeCloseTo(1, 12);
  });
  it('carves a 2.2–2.7 m deep pond with dry banks around it', () => {
    let deepest = 0;
    let wetOutside = 0;
    for (let x = -30; x <= 40; x += 0.5) {
      for (let z = -25; z <= 35; z += 0.5) {
        const q = pondQ(x, z);
        const y = coveHeight(x, z);
        if (q < 1) deepest = Math.max(deepest, COVE.water.level - y);
        if (q > 1.05 && q < 3 && y < COVE.water.level) wetOutside++;
      }
    }
    expect(deepest).toBeGreaterThan(2.2);
    expect(deepest).toBeLessThan(2.7);
    expect(wetOutside).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `Cannot find module './coveShape.mjs'`.

- [ ] **Step 3: Implement `pipeline/terrain/coveShape.mjs`**
```js
// The Cove's height as explicit shape functions (spec §7.2–7.3). World metres, +Y up, +X east, −Z north.
// Compass azimuth φ: 0° = north (−Z), 90° = east (+X) — the same convention as src/render/sun.ts.
import { fbm2, ridged2 } from './noise.mjs';

export const COVE = {
  seed: 1337,
  grid: { size: 1024, spacing: 0.4, origin: -204.8 }, // sample i sits at origin + i·spacing
  heightRange: { min: -8, max: 72 }, // 16-bit quantisation range (1.2 mm steps)
  floorRadius: 35, // hollow floor ≈ 70 m across
  rimRadius: 50, // rim ≈ 100 m across
  sunAzimuth: 292, // GOLDEN_HOUR: walls are lowest toward the sun and the gully opens there
  sunElevation: 14,
  wall: { mean: 19.5, amp: 5.5, sharpness: 5, jitter: 1.6 }, // H(φ) = mean − amp·cos(φ − sun): 14–25 m
  water: { level: -0.45 },
  pond: { cx: 9, cz: 6, a: 17.5, b: 12.5, angle: 25, depth: 2.5, bank: 0.4 }, // ≈ 35 × 25 m, 2.5 m deep
  gully: { azimuth: 292, rStart: 30, rEnd: 110, halfWidthIn: 8, halfWidthOut: 13, blend: 8, ease: 1.6 },
  routeA: { azimuth: 330, rStart: 29, steps: 7, tread: 3.0, rise: 2.2, riserRun: 0.3, halfWidth: 3.5, blend: 3 },
  routeB: { azimuth: 250, r0: 33, r1: 51, sharpness: 3.5, halfWidth: 4, blend: 4 },
};

const DEG = Math.PI / 180;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Compass azimuth of (x, z) in degrees [0, 360). */
export function azimuthDeg(x, z) {
  const a = Math.atan2(x, -z) / DEG;
  return a < 0 ? a + 360 : a;
}

/** Unit ground direction [x, z] of a compass azimuth. */
export function azimuthDir(deg) {
  return [Math.sin(deg * DEG), -Math.cos(deg * DEG)];
}

/** Unit vector from the scene toward the sun — identical to src/render/sun.ts sunDirection. */
export function sunDirection(azimuthDegrees, elevationDegrees) {
  const az = azimuthDegrees * DEG;
  const el = elevationDegrees * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** Distance along and across a ray from the origin at compass azimuth `deg`. */
export function rayFrame(x, z, deg) {
  const [ux, uz] = azimuthDir(deg);
  return { along: x * ux + z * uz, lateral: Math.abs(x * uz - z * ux) };
}

/** Rim height above the floor at azimuth φ: lowest toward the sun, tallest opposite. */
export function wallHeight(phiDeg) {
  return COVE.wall.mean - COVE.wall.amp * Math.cos((phiDeg - COVE.sunAzimuth) * DEG);
}

/** Steep S-curve on t ∈ [0, 1] → [0, 1]; max slope 0.5·k / tanh(k/2) at t = 0.5. */
export function cliffCurve(t, k) {
  const tt = clamp(t, 0, 1);
  return 0.5 + (0.5 * Math.tanh(k * (tt - 0.5))) / Math.tanh(k / 2);
}

/** Radial jitter of the wall ring, periodic in azimuth (sampled on a circle in noise space). */
export function ringJitter(phiDeg) {
  const s = Math.sin(phiDeg * DEG);
  const c = Math.cos(phiDeg * DEG);
  return COVE.wall.jitter * (fbm2(s * 2.2 + 11.3, c * 2.2 + 7.9, COVE.seed + 1, 4) * 2 - 1);
}

/** The hollow floor: gently rising toward the wall foot, low undulation; always above the water level. */
export function floorHeight(x, z) {
  const r = Math.hypot(x, z);
  const rise = 0.6 * clamp(r / COVE.floorRadius, 0, 1) ** 2;
  const und = 0.3 * (fbm2(x / 18, z / 18, COVE.seed + 2, 4) * 2 - 1);
  return rise + und;
}

function outside(x, z, d) {
  const slope = 0.06 * d;
  const hills = smoothstep(0, 60, d) * 14 * (fbm2(x / 70, z / 70, COVE.seed + 4, 5) - 0.4);
  const far = smoothstep(100, 160, d) * 9 * (fbm2(x / 45, z / 45, COVE.seed + 5, 4) - 0.3);
  return slope + hills + far;
}

/** Floor → cliff wall → rim → rolling hills, before the pond, gully and routes are cut in. */
export function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  const phi = azimuthDeg(x, z);
  const j = ringJitter(phi);
  const rf = COVE.floorRadius + j;
  const rr = COVE.rimRadius + j;
  const H = wallHeight(phi);
  const fl = floorHeight(x, z);
  if (r <= rf) return fl;
  const t = (r - rf) / (rr - rf);
  if (t <= 1) {
    const rough = 1.2 * Math.sin(Math.PI * t) * (ridged2(x / 6, z / 6, COVE.seed + 3, 4) - 0.5);
    return lerp(fl, H, cliffCurve(t, COVE.wall.sharpness)) + rough;
  }
  return H + outside(x, z, r - rr);
}

/** Pond ellipse parameter: q < 1 inside the water outline, 1 on it. */
export function pondQ(x, z) {
  const p = COVE.pond;
  const a = p.angle * DEG;
  const dx = x - p.cx;
  const dz = z - p.cz;
  const u = dx * Math.cos(a) + dz * Math.sin(a);
  const v = -dx * Math.sin(a) + dz * Math.cos(a);
  return (u / p.a) ** 2 + (v / p.b) ** 2;
}

function carvePond(h, x, z) {
  const p = COVE.pond;
  const wl = COVE.water.level;
  const q = pondQ(x, z);
  if (q >= 1 + p.bank) return h;
  if (q < 1) {
    const bedNoise = 0.25 * (fbm2(x / 5, z / 5, COVE.seed + 6, 3) - 0.5) * (1 - q);
    return Math.min(h, wl - p.depth * Math.pow(1 - q, 0.7) + bedNoise);
  }
  return lerp(wl, h, smoothstep(1, 1 + p.bank, q));
}

let gullyEnd = null;
function carveGully(h, x, z) {
  const g = COVE.gully;
  const { along, lateral } = rayFrame(x, z, g.azimuth);
  if (along < g.rStart - g.blend) return h;
  if (gullyEnd === null) {
    const [ux, uz] = azimuthDir(g.azimuth);
    gullyEnd = baseHeight(ux * g.rEnd, uz * g.rEnd);
  }
  const s = smoothstep(g.rStart, g.rEnd, along);
  const halfW = lerp(g.halfWidthIn, g.halfWidthOut, s);
  const w = smoothstep(halfW, halfW + g.blend, lateral); // 0 in the channel, 1 outside it
  if (w >= 1) return h;
  // ease-in rise: flat where it opens into the hollow (lets the low sun in), steeper farther out
  const rise = Math.pow(clamp((along - g.rStart) / (g.rEnd - g.rStart), 0, 1), g.ease);
  const floorH = lerp(floorHeight(x, z), gullyEnd, rise) + 0.3 * (fbm2(x / 9, z / 9, COVE.seed + 7, 3) - 0.5);
  const cut = lerp(Math.min(h, floorH), h, w);
  return lerp(h, cut, smoothstep(g.rStart - g.blend, g.rStart, along));
}

/** Route A: scramble terraces — risers of `rise` over `riserRun` (> 70°) and flat treads. Null before the start. */
export function routeAProfile(along) {
  const ra = COVE.routeA;
  if (along < ra.rStart) return null;
  const i = Math.floor((along - ra.rStart) / ra.tread);
  if (i >= ra.steps) return ra.steps * ra.rise;
  const within = along - (ra.rStart + i * ra.tread);
  return (i + smoothstep(0, ra.riserRun, within)) * ra.rise;
}

let routeABase = null;
function shapeRouteA(h, x, z) {
  const ra = COVE.routeA;
  const { along, lateral } = rayFrame(x, z, ra.azimuth);
  const end = ra.rStart + ra.steps * ra.tread;
  if (along < ra.rStart - 2 || along > end + 4 || lateral > ra.halfWidth + ra.blend) return h;
  if (routeABase === null) {
    const [ux, uz] = azimuthDir(ra.azimuth);
    routeABase = floorHeight(ux * ra.rStart, uz * ra.rStart);
  }
  const stair = routeAProfile(along);
  const target = stair === null ? floorHeight(x, z) : routeABase + stair;
  const endFade = 1 - smoothstep(end, end + 4, along);
  const w = (1 - smoothstep(ra.halfWidth, ra.halfWidth + ra.blend, lateral)) * endFade;
  return lerp(h, target, w);
}

/** Route B: a climbable slope (45–70° in the middle, walkable at both ends). */
export function routeBProfile(along) {
  const rb = COVE.routeB;
  return wallHeight(rb.azimuth) * cliffCurve((along - rb.r0) / (rb.r1 - rb.r0), rb.sharpness);
}

function shapeRouteB(h, x, z) {
  const rb = COVE.routeB;
  const { along, lateral } = rayFrame(x, z, rb.azimuth);
  if (along < rb.r0 - 2 || along > rb.r1 + 2 || lateral > rb.halfWidth + rb.blend) return h;
  const target = lerp(floorHeight(x, z), routeBProfile(along), smoothstep(rb.r0 - 2, rb.r0, along));
  const w = 1 - smoothstep(rb.halfWidth, rb.halfWidth + rb.blend, lateral);
  const endFade = 1 - smoothstep(rb.r1, rb.r1 + 2, along);
  return lerp(h, target, w * endFade);
}

/** Final designed height (before erosion). */
export function coveHeight(x, z) {
  let h = baseHeight(x, z);
  h = shapeRouteB(h, x, z);
  h = shapeRouteA(h, x, z);
  h = carveGully(h, x, z);
  h = carvePond(h, x, z);
  return h;
}

/**
 * 1 where erosion may act, 0 where the designed shape must survive exactly: climb routes, the gully
 * path and the pond. The floor erodes lightly (0.3) so small channels drain toward the pond.
 */
export function erosionMask(x, z) {
  const r = Math.hypot(x, z);
  let m = r < COVE.floorRadius - 3 ? 0.3 : 1;
  const ra = rayFrame(x, z, COVE.routeA.azimuth);
  if (ra.along > COVE.routeA.rStart - 4) m *= smoothstep(COVE.routeA.halfWidth + 2, COVE.routeA.halfWidth + COVE.routeA.blend + 4, ra.lateral);
  const rb = rayFrame(x, z, COVE.routeB.azimuth);
  if (rb.along > COVE.routeB.r0 - 4) m *= smoothstep(COVE.routeB.halfWidth + 2, COVE.routeB.halfWidth + COVE.routeB.blend + 4, rb.lateral);
  const g = rayFrame(x, z, COVE.gully.azimuth);
  if (g.along > COVE.gully.rStart - 6) m *= smoothstep(COVE.gully.halfWidthOut, COVE.gully.halfWidthOut + 6, g.lateral);
  m *= smoothstep(1 + COVE.pond.bank, 1.8, pondQ(x, z));
  return m;
}

/** World (x, z) of grid sample (i, j). */
export function samplePos(i, j) {
  const g = COVE.grid;
  return [g.origin + i * g.spacing, g.origin + j * g.spacing];
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- pipeline/terrain` → 10 tests pass (4 + 6).

- [ ] **Step 5: Commit** — `feat(cove): terrain shape functions — hollow, walls, gully, routes, pond`.

---

### Task 3: Erosion and masks

**Files:**
- Create: `pipeline/terrain/erosion.mjs`, `pipeline/terrain/masks.mjs`
- Modify: `pipeline/terrain/terrain.test.mjs`

**Interfaces:**
- Consumes: `mulberry32` (Task 1).
- Produces:
  - `EROSION_DEFAULTS`; `erode(h, size, mask, opts) → flow` (in place; the flow field is used for wetness).
  - `LAYERS` (`['grass', 'forest', 'moss', 'mud', 'pebbles', 'rock']`).
  - Grid fields: `slopeField(h, size, spacing)`, `curvatureField(h, size, spacing)`, `horizonAO(h, size, spacing, opts)`, `sunVisibility(h, size, spacing, sun, maxDist) → Uint8Array`, `wetnessFromFlow(flow, size)`.
  - Splat: `splatForCell(c) → { weights: number[6], wet }`, `quantizeWeights(weights) → number[6]` (sum = 255).

- [ ] **Step 1: Write the failing tests** (append)
```js
import { erode, EROSION_DEFAULTS } from './erosion.mjs';
import {
  slopeField, curvatureField, horizonAO, sunVisibility, wetnessFromFlow, splatForCell, quantizeWeights,
} from './masks.mjs';

const cone = (size, spacing, peak) => {
  const h = new Float32Array(size * size);
  const c = (size - 1) / 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) h[j * size + i] = Math.max(0, peak - Math.hypot(i - c, j - c) * spacing * 0.8);
  return h;
};

describe('erosion', () => {
  const size = 64;
  it('is deterministic, bounded, and respects the protection mask', () => {
    const mask = new Float32Array(size * size).fill(1);
    for (let k = 0; k < size * 16; k++) mask[k] = 0; // protect the first 16 rows
    const a = cone(size, 0.4, 12);
    const b = cone(size, 0.4, 12);
    const before = a.slice();
    const flowA = erode(a, size, mask, { droplets: 3000, seed: 3 });
    erode(b, size, mask, { droplets: 3000, seed: 3 });
    expect(Array.from(a)).toEqual(Array.from(b));
    let moved = 0;
    for (let k = 0; k < a.length; k++) {
      expect(Math.abs(a[k] - before[k])).toBeLessThanOrEqual(EROSION_DEFAULTS.maxChange + 1e-6);
      if (k < size * 16) expect(a[k]).toBe(before[k]);
      if (Math.abs(a[k] - before[k]) > 1e-4) moved++;
    }
    expect(moved).toBeGreaterThan(50);
    expect(flowA.some((f) => f > 0)).toBe(true);
    expect(flowA.every((f) => f >= 0)).toBe(true);
  });
});

describe('masks', () => {
  it('measures slope and curvature', () => {
    const size = 32;
    const plane = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) plane[j * size + i] = i * 0.4 * Math.tan((30 * Math.PI) / 180);
    expect(slopeField(plane, size, 0.4)[16 * size + 16]).toBeCloseTo(30, 4);
    const bowl = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) bowl[j * size + i] = ((i - 16) ** 2 + (j - 16) ** 2) * 0.01;
    expect(curvatureField(bowl, size, 0.4)[16 * size + 16]).toBeGreaterThan(0);
  });
  it('horizon AO is 1 on open ground and lower in a pit', () => {
    const size = 128;
    const flat = new Float32Array(size * size);
    expect(horizonAO(flat, size, 0.4)[64 * size + 64]).toBeCloseTo(1, 6);
    const pit = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) pit[j * size + i] = Math.hypot(i - 64, j - 64) > 10 ? 6 : 0;
    expect(horizonAO(pit, size, 0.4)[64 * size + 64]).toBeLessThan(0.8);
  });
  it('sun visibility: open ground lit, ground behind a wall toward the sun shadowed', () => {
    const size = 128;
    const h = new Float32Array(size * size);
    // a 5 m wall on the west (−X) side; at ~14° its shadow reaches ≈ 18 m past the rays' 0.5 m start height
    for (let j = 0; j < size; j++) for (let i = 0; i < 20; i++) h[j * size + i] = 5;
    const vis = sunVisibility(h, size, 0.4, [-0.97, 0.24, 0], 120);
    expect(vis[64 * size + 100]).toBe(1); // 32 m east of the wall: sunlit
    expect(vis[64 * size + 25]).toBe(0); // 2 m east of the wall: shadowed
  });
  it('quantised splat weights sum to 255 and keep the dominant layer', () => {
    for (const w of [[1, 0, 0, 0, 0, 0], [0.2, 0.3, 0.1, 0, 0.4, 0], [0, 0, 0, 0, 0, 0], [1e-6, 3, 1e-6, 0, 0, 0.5]]) {
      const q = quantizeWeights(w);
      expect(q.reduce((a, b) => a + b, 0)).toBe(255);
      if (w.some((v) => v > 0)) expect(q.indexOf(Math.max(...q))).toBe(w.indexOf(Math.max(...w)));
    }
  });
  it('splat rules: steep → rock, pond bed → pebbles/mud, outside the rim → forest, floor → grass', () => {
    const base = { slope: 5, height: 0.3, waterLevel: -0.45, pondQ: 3, r: 20, rimT: -0.5, curvature: 0, wetness: 0, noise: 0.5, onRoute: 0, inGully: 0 };
    const top = (c) => {
      const w = splatForCell({ ...base, ...c }).weights;
      return ['grass', 'forest', 'moss', 'mud', 'pebbles', 'rock'][w.indexOf(Math.max(...w))];
    };
    expect(top({ slope: 60, rimT: 0.5 })).toBe('rock');
    expect(['pebbles', 'mud']).toContain(top({ pondQ: 0.5, height: -1.5 }));
    expect(top({ rimT: 1.6, r: 70 })).toBe('forest');
    expect(top({})).toBe('grass');
    expect(splatForCell({ ...base, pondQ: 1.1 }).wet).toBeGreaterThan(0.5);
  });
  it('wetness follows the flow field', () => {
    const size = 16;
    const flow = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 6; i <= 10; i++) flow[j * size + i] = 500; // a 2 m wide runoff channel
    const wet = wetnessFromFlow(flow, size);
    expect(wet[8 * size + 8]).toBeGreaterThan(wet[8 * size + 1]);
  });
});
```
- [ ] **Step 2: Run to verify they fail** — missing modules.

- [ ] **Step 3: Implement**

`pipeline/terrain/erosion.mjs`:
```js
// Light hydraulic erosion: particle droplets (after Beyer 2015, "Implementation of a method for hydraulic
// erosion"), deterministic from a seed. Carves runoff lines into the walls and hills without touching the
// designed routes, gully and pond (the caller's mask is 0 there).
import { mulberry32 } from './rng.mjs';

export const EROSION_DEFAULTS = {
  droplets: 120000,
  seed: 7,
  inertia: 0.05,
  capacity: 4,
  minSlope: 0.01,
  erosion: 0.3,
  deposition: 0.3,
  evaporation: 0.02,
  gravity: 4,
  maxSteps: 48,
  radius: 3,
  heightScale: 20, // heights are eroded in units of this many metres so the classic constants apply
  strength: 0.5, // fraction of the simulated change that is kept ("light pass")
  maxChange: 1.5, // metres; no cell moves more than this
};

function makeBrush(radius) {
  const off = [];
  const weight = [];
  let sum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      off.push(dx, dy);
      const w = 1 - d / radius;
      weight.push(w);
      sum += w;
    }
  }
  return { off, weight: weight.map((w) => w / sum) };
}

/**
 * Erodes `h` (Float32Array, row-major size × size, metres) in place.
 * @param {Float32Array} h
 * @param {number} size
 * @param {Float32Array} mask per-cell 0..1 multiplier of the final change
 * @param {Partial<typeof EROSION_DEFAULTS>} opts
 * @returns {Float32Array} per-cell accumulated droplet water (the flow field, for wetness)
 */
export function erode(h, size, mask, opts = {}) {
  const o = { ...EROSION_DEFAULTS, ...opts };
  const S = o.heightScale;
  const w = new Float32Array(h.length);
  for (let k = 0; k < h.length; k++) w[k] = h[k] / S;
  const flow = new Float32Array(h.length);
  const brush = makeBrush(o.radius);
  const rnd = mulberry32(o.seed);
  let sh = 0;
  let sgx = 0;
  let sgy = 0;
  const sample = (x, y) => {
    const ix = x | 0;
    const iy = y | 0;
    const fx = x - ix;
    const fy = y - iy;
    const k = iy * size + ix;
    const a = w[k];
    const b = w[k + 1];
    const c = w[k + size];
    const d = w[k + size + 1];
    sgx = (b - a) * (1 - fy) + (d - c) * fy;
    sgy = (c - a) * (1 - fx) + (d - b) * fx;
    sh = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };

  for (let n = 0; n < o.droplets; n++) {
    let x = 1 + rnd() * (size - 3);
    let y = 1 + rnd() * (size - 3);
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sed = 0;
    for (let step = 0; step < o.maxSteps; step++) {
      const ix = x | 0;
      const iy = y | 0;
      const fx = x - ix;
      const fy = y - iy;
      const cell = iy * size + ix;
      sample(x, y);
      const hOld = sh;
      dx = dx * o.inertia - sgx * (1 - o.inertia);
      dy = dy * o.inertia - sgy * (1 - o.inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) break;
      dx /= len;
      dy /= len;
      x += dx;
      y += dy;
      if (x < 1 || y < 1 || x >= size - 2 || y >= size - 2) break;
      flow[cell] += water;
      sample(x, y);
      const dh = sh - hOld;
      const cap = Math.max(-dh * speed * water * o.capacity, o.minSlope);
      if (sed > cap || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sed) : (sed - cap) * o.deposition;
        sed -= amount;
        w[cell] += amount * (1 - fx) * (1 - fy);
        w[cell + 1] += amount * fx * (1 - fy);
        w[cell + size] += amount * (1 - fx) * fy;
        w[cell + size + 1] += amount * fx * fy;
      } else {
        const amount = Math.min((cap - sed) * o.erosion, -dh);
        for (let b = 0; b < brush.weight.length; b++) {
          const bx = ix + brush.off[2 * b];
          const by = iy + brush.off[2 * b + 1];
          if (bx < 0 || by < 0 || bx >= size || by >= size) continue;
          const e = amount * brush.weight[b];
          w[by * size + bx] -= e;
          sed += e;
        }
      }
      // downhill (dh < 0) accelerates the droplet
      speed = Math.sqrt(Math.max(0, speed * speed - dh * o.gravity));
      water *= 1 - o.evaporation;
    }
  }

  for (let k = 0; k < h.length; k++) {
    const delta = (w[k] * S - h[k]) * o.strength * mask[k];
    h[k] += Math.max(-o.maxChange, Math.min(o.maxChange, delta));
  }
  return flow;
}
```

`pipeline/terrain/masks.mjs`:
```js
// Masks derived from the final heightfield: slope, curvature, horizon AO, sun visibility, wetness and the
// six-layer splat weights (spec §7.3). All functions are pure over typed arrays (row-major, size × size).

export const LAYERS = ['grass', 'forest', 'moss', 'mud', 'pebbles', 'rock'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Surface slope in degrees (central differences; edges clamp). */
export function slopeField(h, size, spacing) {
  const out = new Float32Array(h.length);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const l = h[j * size + Math.max(0, i - 1)];
      const r = h[j * size + Math.min(size - 1, i + 1)];
      const d = h[Math.max(0, j - 1) * size + i];
      const u = h[Math.min(size - 1, j + 1) * size + i];
      const gx = (r - l) / (2 * spacing);
      const gz = (u - d) / (2 * spacing);
      out[j * size + i] = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
    }
  }
  return out;
}

/** Laplacian curvature (1/m): positive in hollows and valleys, negative on crests. */
export function curvatureField(h, size, spacing) {
  const out = new Float32Array(h.length);
  for (let j = 1; j < size - 1; j++) {
    for (let i = 1; i < size - 1; i++) {
      const k = j * size + i;
      out[k] = (h[k - 1] + h[k + 1] + h[k - size] + h[k + size] - 4 * h[k]) / (spacing * spacing);
    }
  }
  return out;
}

/**
 * Horizon-based ambient occlusion: from every `stride`-th sample, march `dirs` directions up to `maxDist`
 * metres and average the sine of the highest horizon. 1 = open sky, 0 = enclosed. Upsampled bilinearly.
 */
export function horizonAO(h, size, spacing, { stride = 2, dirs = 8, maxDist = 24, steps = 12 } = {}) {
  const n = Math.ceil(size / stride);
  const coarse = new Float32Array(n * n);
  const dirX = [];
  const dirZ = [];
  for (let d = 0; d < dirs; d++) {
    dirX.push(Math.cos((2 * Math.PI * d) / dirs));
    dirZ.push(Math.sin((2 * Math.PI * d) / dirs));
  }
  for (let cj = 0; cj < n; cj++) {
    for (let ci = 0; ci < n; ci++) {
      const i0 = Math.min(size - 1, ci * stride);
      const j0 = Math.min(size - 1, cj * stride);
      const h0 = h[j0 * size + i0] + 0.2;
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        let best = 0;
        for (let s = 1; s <= steps; s++) {
          const dist = (maxDist * s * s) / (steps * steps); // denser near the sample
          const i = Math.round(i0 + (dirX[d] * dist) / spacing);
          const j = Math.round(j0 + (dirZ[d] * dist) / spacing);
          if (i < 0 || j < 0 || i >= size || j >= size) break;
          const rise = h[j * size + i] - h0;
          if (rise > 0) best = Math.max(best, rise / Math.hypot(rise, dist));
        }
        occ += best;
      }
      coarse[cj * n + ci] = 1 - occ / dirs;
    }
  }
  const out = new Float32Array(h.length);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const fx = Math.min(n - 1.001, i / stride);
      const fz = Math.min(n - 1.001, j / stride);
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const a = coarse[iz * n + ix];
      const b = coarse[iz * n + ix + 1];
      const c = coarse[(iz + 1) * n + ix];
      const d = coarse[(iz + 1) * n + ix + 1];
      out[j * size + i] = a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    }
  }
  return out;
}

/**
 * 1 where a ray from the surface toward the sun (unit [x, y, z], world) clears the terrain within
 * `maxDist` metres. Used by the bake (spawn choice, lit-fraction check) and tests; CSM shadows do
 * this at runtime.
 */
export function sunVisibility(h, size, spacing, sun, maxDist = 180) {
  const out = new Uint8Array(h.length);
  const horiz = Math.hypot(sun[0], sun[2]);
  const tanElev = sun[1] / horiz;
  const sx = sun[0] / horiz;
  const sz = sun[2] / horiz;
  const step = spacing * 1.5;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h0 = h[j * size + i] + 0.5;
      let lit = 1;
      for (let d = step; d < maxDist; d += step) {
        const fi = i + (sx * d) / spacing;
        const fj = j + (sz * d) / spacing;
        if (fi < 0 || fj < 0 || fi >= size - 1 || fj >= size - 1) break;
        if (h[Math.round(fj) * size + Math.round(fi)] > h0 + tanElev * d) {
          lit = 0;
          break;
        }
      }
      out[j * size + i] = lit;
    }
  }
  return out;
}

/** Flow → wetness 0..1: log-compressed droplet water, box-blurred (radius 2) to read as damp bands. */
export function wetnessFromFlow(flow, size) {
  let max = 0;
  const lf = new Float32Array(flow.length);
  for (let k = 0; k < flow.length; k++) {
    lf[k] = Math.log1p(flow[k]);
    if (lf[k] > max) max = lf[k];
  }
  const out = new Float32Array(flow.length);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      let c = 0;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= size || jj >= size) continue;
          s += lf[jj * size + ii];
          c++;
        }
      }
      out[j * size + i] = max > 0 ? smoothstep(0.35, 0.85, s / c / max) : 0;
    }
  }
  return out;
}

/**
 * Six-layer splat weights for one sample (un-normalised, all ≥ 0) + the wet mask.
 * rimT: 0 at the wall foot, 1 at the rim (jitter-corrected); r: radius from the Cove centre.
 * @param {{ slope: number, height: number, waterLevel: number, pondQ: number, r: number, rimT: number,
 *           curvature: number, wetness: number, noise: number, onRoute: number, inGully: number }} c
 */
export function splatForCell(c) {
  const rock = smoothstep(34, 50, c.slope) * (1 - 0.6 * c.onRoute);
  const bed = smoothstep(1.06, 0.92, c.pondQ);
  const shore = smoothstep(1.35, 1.02, c.pondQ) * (1 - bed);
  const pebbles = Math.max(bed * 0.75, shore * 0.35, c.inGully * 0.25) * (1 - rock);
  const mud = Math.max(shore * 0.65, bed * 0.25, c.wetness * 0.5 * (1 - rock), c.inGully * 0.3) * (1 - rock);
  const wallFoot = smoothstep(-0.12, 0.02, c.rimT) * (1 - smoothstep(0.3, 0.55, c.rimT));
  const moss = (wallFoot * 0.8 + smoothstep(0, 0.35, c.curvature) * 0.3) * smoothstep(8, 18, c.slope) * (1 - smoothstep(38, 52, c.slope))
    * (0.6 + 0.8 * c.noise);
  const outsideRim = smoothstep(0.95, 1.2, c.rimT);
  const forest = outsideRim * (1 - rock) * (0.7 + 0.6 * c.noise);
  const floor = 1 - outsideRim;
  const grass = Math.max(0, floor * (1 - rock) * (1 - bed) * (0.9 - 0.4 * c.noise) - moss * 0.5 - mud * 0.6);
  const wet = Math.max(smoothstep(1.3, 1.0, c.pondQ), c.wetness * 0.7);
  return { weights: [grass, forest, moss, mud, pebbles, rock], wet };
}

/** Normalise weights to 8-bit values that sum to exactly 255 (the remainder goes to the largest). */
export function quantizeWeights(weights) {
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  const q = weights.map((w) => (sum > 0 ? Math.floor((Math.max(0, w) / sum) * 255) : 0));
  if (sum <= 0) {
    q[0] = 255;
    return q;
  }
  let largest = 0;
  for (let k = 1; k < q.length; k++) if (weights[k] > weights[largest]) largest = k;
  q[largest] += 255 - q.reduce((a, b) => a + b, 0);
  return q;
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- pipeline/terrain` → 17 tests pass (10 + 7).

- [ ] **Step 5: Commit** — `feat(cove): seeded droplet erosion and terrain masks`.

---

### Task 4: The bake CLI and the committed terrain

**Files:**
- Create: `pipeline/terrain/bake.mjs`, `public/assets/world/cove/{terrain.json,height.bin,splatA.png,splatB.png}`, `docs/progress/img/cove/terrain-preview.png`
- Modify: `package.json` (script `terrain:bake`), `pipeline/terrain/terrain.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `npm run terrain:bake` writes the files listed above.
  - `terrain.json` (the `TerrainHeader` Task 5 types):
    - grid: `{ version: 1, size, spacing, origin, heightMin, heightMax }`
    - water and shape: `waterLevel`, `pond { cx, cz, a, b, angle, depth }`, `floorRadius`, `rimRadius`, `wall { mean, amp, sharpness, jitter }`, `sun { azimuth, elevation }`, `gully`, `routeA`, `routeB`
    - `spawn: [{ x, z, heading }]`, `layers: string[6]`
    - `files: { height, splatA, splatB }`
    - `stats: { floorLitFraction, heightMin, heightMax, erosionMeanChange }`
    - `seed`

- [ ] **Step 1: Write the output tests** (append; they read the committed files)
```js
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';

const DIR = 'public/assets/world/cove/';
describe.skipIf(!existsSync(`${DIR}terrain.json`))('committed Cove terrain', () => {
  const header = existsSync(`${DIR}terrain.json`) ? JSON.parse(readFileSync(`${DIR}terrain.json`, 'utf8')) : null;
  it('has a consistent header and a size² uint16 heightfield', () => {
    expect(header.version).toBe(1);
    expect(header.size).toBe(1024);
    expect(readFileSync(DIR + header.files.height).length).toBe(header.size * header.size * 2);
    expect(header.layers).toEqual(['grass', 'forest', 'moss', 'mud', 'pebbles', 'rock']);
  });
  it('puts half the hollow floor in the sun (spec §7.8)', () => {
    expect(header.stats.floorLitFraction).toBeGreaterThan(0.4);
    expect(header.stats.floorLitFraction).toBeLessThan(0.6);
  });
  it('spawns on the lit hollow floor, away from the pond', () => {
    const s = header.spawn[0];
    expect(Math.hypot(s.x, s.z)).toBeLessThan(30);
    const p = header.pond;
    const a = (p.angle * Math.PI) / 180;
    const u = (s.x - p.cx) * Math.cos(a) + (s.z - p.cz) * Math.sin(a);
    const v = -(s.x - p.cx) * Math.sin(a) + (s.z - p.cz) * Math.cos(a);
    expect((u / p.a) ** 2 + (v / p.b) ** 2).toBeGreaterThan(1.5);
  });
  it('splat maps are 1024² RGBA with six layer weights summing to 255', async () => {
    const A = await sharp(DIR + header.files.splatA).raw().toBuffer({ resolveWithObject: true });
    const B = await sharp(DIR + header.files.splatB).raw().toBuffer({ resolveWithObject: true });
    for (const img of [A, B]) {
      expect(img.info.width).toBe(1024);
      expect(img.info.height).toBe(1024);
      expect(img.info.channels).toBe(4);
    }
    for (let k = 0; k < 1024 * 1024; k += 997) {
      const s = A.data[k * 4] + A.data[k * 4 + 1] + A.data[k * 4 + 2] + A.data[k * 4 + 3] + B.data[k * 4] + B.data[k * 4 + 1];
      expect(s).toBe(255);
    }
  });
});
```

- [ ] **Step 2: Implement `pipeline/terrain/bake.mjs`**
```js
// Bakes the Cove terrain: shape → erosion → masks → splat → public/assets/world/cove/.
// Deterministic from COVE.seed. Usage: npm run terrain:bake
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  COVE, coveHeight, erosionMask, samplePos, pondQ, azimuthDeg, rayFrame, ringJitter, sunDirection,
} from './coveShape.mjs';
import { erode, EROSION_DEFAULTS } from './erosion.mjs';
import {
  LAYERS, slopeField, curvatureField, horizonAO, sunVisibility, wetnessFromFlow, splatForCell, quantizeWeights,
} from './masks.mjs';
import { fbm2 } from './noise.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'assets', 'world', 'cove');
const PREVIEW = join(ROOT, 'docs', 'progress', 'img', 'cove', 'terrain-preview.png');
const { size, spacing, origin } = COVE.grid;
const t0 = performance.now();

// 1. designed shape + erosion protection mask
const h = new Float32Array(size * size);
const mask = new Float32Array(size * size);
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const [x, z] = samplePos(i, j);
    h[j * size + i] = coveHeight(x, z);
    mask[j * size + i] = erosionMask(x, z);
  }
}
// 2. light erosion
const designed = h.slice();
const flow = erode(h, size, mask, { seed: COVE.seed + 11 });
let change = 0;
for (let k = 0; k < h.length; k++) change += Math.abs(h[k] - designed[k]);

// 3. masks
const slope = slopeField(h, size, spacing);
const curv = curvatureField(h, size, spacing);
const ao = horizonAO(h, size, spacing);
const wet = wetnessFromFlow(flow, size);
const vis = sunVisibility(h, size, spacing, sunDirection(COVE.sunAzimuth, COVE.sunElevation));

// 4. splat + wet + AO
const splatA = Buffer.alloc(size * size * 4);
const splatB = Buffer.alloc(size * size * 4);
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const k = j * size + i;
    const [x, z] = samplePos(i, j);
    const r = Math.hypot(x, z);
    const jit = ringJitter(azimuthDeg(x, z));
    const rimT = (r - (COVE.floorRadius + jit)) / (COVE.rimRadius - COVE.floorRadius);
    const ra = rayFrame(x, z, COVE.routeA.azimuth);
    const rb = rayFrame(x, z, COVE.routeB.azimuth);
    const g = rayFrame(x, z, COVE.gully.azimuth);
    const onRoute = Math.max(
      ra.along > COVE.routeA.rStart - 1 && ra.lateral < COVE.routeA.halfWidth + 0.5 ? 1 : 0,
      rb.along > COVE.routeB.r0 - 1 && rb.lateral < COVE.routeB.halfWidth + 1 ? 1 : 0,
    );
    const inGully = g.along > COVE.gully.rStart && g.lateral < COVE.gully.halfWidthIn + 1 ? 1 : 0;
    const c = splatForCell({
      slope: slope[k], height: h[k], waterLevel: COVE.water.level, pondQ: pondQ(x, z), r, rimT, curvature: curv[k],
      wetness: wet[k], noise: fbm2(x / 9, z / 9, COVE.seed + 99, 4), onRoute, inGully,
    });
    const q = quantizeWeights(c.weights);
    splatA[k * 4] = q[0];
    splatA[k * 4 + 1] = q[1];
    splatA[k * 4 + 2] = q[2];
    splatA[k * 4 + 3] = q[3];
    splatB[k * 4] = q[4];
    splatB[k * 4 + 1] = q[5];
    splatB[k * 4 + 2] = Math.round(Math.min(1, c.wet) * 255);
    splatB[k * 4 + 3] = Math.round(Math.max(0, Math.min(1, ao[k])) * 255);
  }
}

// 5. statistics, lit floor fraction, spawn (lit, flat, away from the pond, facing it)
let hmin = Infinity;
let hmax = -Infinity;
let litCount = 0;
let floorCount = 0;
let best = null;
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const k = j * size + i;
    hmin = Math.min(hmin, h[k]);
    hmax = Math.max(hmax, h[k]);
    const [x, z] = samplePos(i, j);
    const r = Math.hypot(x, z);
    const q = pondQ(x, z);
    if (r < 33 && q > 1.1) {
      floorCount++;
      litCount += vis[k];
    }
    if (vis[k] && r < 24 && q > 1.8 && slope[k] < 6) {
      // prefer spots in the middle of a lit patch and a comfortable distance from the pond
      let lit = 0;
      for (let dj = -6; dj <= 6; dj += 3) for (let di = -6; di <= 6; di += 3) lit += vis[Math.min(size - 1, Math.max(0, j + dj)) * size + Math.min(size - 1, Math.max(0, i + di))];
      const score = lit - Math.abs(q - 3) * 2;
      if (!best || score > best.score) best = { score, x, z };
    }
  }
}
if (!best) throw new Error('no lit spawn point on the floor — check the shape parameters');
const spawn = [{ x: +best.x.toFixed(2), z: +best.z.toFixed(2), heading: +Math.atan2(COVE.pond.cx - best.x, COVE.pond.cz - best.z).toFixed(4) }];

// 6. write outputs
const toU16 = new Uint16Array(size * size);
const range = COVE.heightRange.max - COVE.heightRange.min;
for (let k = 0; k < h.length; k++) {
  if (h[k] < COVE.heightRange.min || h[k] > COVE.heightRange.max) throw new Error(`height ${h[k]} outside the 16-bit range`);
  toU16[k] = Math.round(((h[k] - COVE.heightRange.min) / range) * 65535);
}
const le = Buffer.alloc(size * size * 2);
for (let k = 0; k < toU16.length; k++) le.writeUInt16LE(toU16[k], k * 2);
await mkdir(OUT, { recursive: true });
await mkdir(dirname(PREVIEW), { recursive: true });
await writeFile(join(OUT, 'height.bin'), le);
await sharp(splatA, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(OUT, 'splatA.png'));
await sharp(splatB, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(OUT, 'splatB.png'));
const header = {
  version: 1,
  size,
  spacing,
  origin,
  heightMin: COVE.heightRange.min,
  heightMax: COVE.heightRange.max,
  waterLevel: COVE.water.level,
  seed: COVE.seed,
  pond: { cx: COVE.pond.cx, cz: COVE.pond.cz, a: COVE.pond.a, b: COVE.pond.b, angle: COVE.pond.angle, depth: COVE.pond.depth },
  floorRadius: COVE.floorRadius,
  rimRadius: COVE.rimRadius,
  wall: COVE.wall,
  sun: { azimuth: COVE.sunAzimuth, elevation: COVE.sunElevation },
  gully: COVE.gully,
  routeA: COVE.routeA,
  routeB: COVE.routeB,
  spawn,
  layers: LAYERS,
  files: { height: 'height.bin', splatA: 'splatA.png', splatB: 'splatB.png' },
  stats: {
    floorLitFraction: +(litCount / floorCount).toFixed(4),
    heightMin: +hmin.toFixed(3),
    heightMax: +hmax.toFixed(3),
    erosionMeanChange: +(change / h.length).toFixed(5),
    erosionDroplets: EROSION_DEFAULTS.droplets,
  },
};
await writeFile(join(OUT, 'terrain.json'), JSON.stringify(header, null, 1) + '\n');

// 7. preview: splat colours × hillshade × sun, for docs/progress (top = north)
const colours = [[96, 128, 60], [88, 70, 48], [60, 100, 50], [70, 55, 40], [150, 140, 125], [128, 124, 118]];
const shade = Buffer.alloc(size * size * 3);
const L = [-0.6, 0.5, -0.4];
const Ll = Math.hypot(...L);
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const k = j * size + i;
    const gx = (h[j * size + Math.min(size - 1, i + 1)] - h[j * size + Math.max(0, i - 1)]) / (2 * spacing);
    const gz = (h[Math.min(size - 1, j + 1) * size + i] - h[Math.max(0, j - 1) * size + i]) / (2 * spacing);
    const nl = Math.hypot(gx, 1, gz);
    const lam = Math.max(0, (-gx * L[0] + L[1] - gz * L[2]) / (nl * Ll));
    const w = [splatA[k * 4], splatA[k * 4 + 1], splatA[k * 4 + 2], splatA[k * 4 + 3], splatB[k * 4], splatB[k * 4 + 1]];
    const s = (0.35 + 0.65 * lam) * (vis[k] ? 1 : 0.45) * (0.6 + 0.4 * ao[k]) * 1.6 / 255;
    const [x, z] = samplePos(i, j);
    const water = h[k] < COVE.water.level && pondQ(x, z) < 1.2;
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let m = 0; m < 6; m++) v += colours[m][c] * w[m];
      shade[k * 3 + c] = water ? [40, 70, 90][c] : Math.min(255, Math.round(v * s));
    }
  }
}
await sharp(shade, { raw: { width: size, height: size, channels: 3 } }).extract({ left: 300, top: 300, width: 424, height: 424 })
  .resize(848, 848).png().toFile(PREVIEW);
console.log(`terrain baked in ${((performance.now() - t0) / 1000).toFixed(1)} s`, header.stats, 'spawn', spawn[0]);
```

`package.json` — add to `scripts`: `"terrain:bake": "node pipeline/terrain/bake.mjs"`.

- [ ] **Step 3: Run the bake and the tests**

Run: `npm run terrain:bake`.
Expected output:
- it prints `terrain baked in ~6–10 s` with `floorLitFraction` ≈ 0.50, `heightMin` ≈ −3, `heightMax` ≈ 44
- `public/assets/world/cove/` holds `height.bin` (2,097,152 bytes), `splatA.png`, `splatB.png` and `terrain.json`
- the preview has been written

Run it twice and compare with `git hash-object` on `height.bin` and both PNGs: they must be identical (determinism).
Run: `npm test -- pipeline/terrain` → 21 tests pass.

- [ ] **Step 4: Visual check** — Read `docs/progress/img/cove/terrain-preview.png` (top = north). It must show:
  - a round hollow with the elliptical pond east of centre
  - the grey rock ring (steeper, taller on the east)
  - the gully cut toward the west-north-west, with sunlight streaming through it across about half the floor
  - the seven scramble terraces at the north-north-west rim, and the climb slope at the west-south-west
  - forest floor outside the rim
  Fix `COVE` constants (never the tests' bounds) if any read wrong, then re-bake.

- [ ] **Step 5: Commit** — `bake.mjs`, `package.json`, the four committed files, the preview and the test file. Message: `feat(cove): deterministic terrain bake — heightfield, splat maps, header, preview`.

---

### Task 5: Runtime heightfield, chunk geometry and collision mesh

**Files:**
- Create: `src/world/terrain/heightfield.ts`, `src/world/terrain/chunks.ts`, `src/world/terrain/collisionMesh.ts`, `src/world/terrain/heightTexture.ts`, `tests/world/terrainFixtures.ts`, `tests/world/terrain.test.ts`

**Interfaces:**
- Consumes: the committed bake (Task 4) in the skip-if-absent test.
- Produces:
  - `heightfield.ts`:
    - `interface TerrainHeader` (the `terrain.json` shape)
    - `class Heightfield { size; spacing; origin; header; heights; static fromUint16LE(header, bytes); coord(i); sample(i, j); heightAt(x, z); normalAt(x, z, out?); vertexNormal(i, j, out?) }`
  - `chunks.ts`: `CHUNK_CELLS = 160`, `LOD_STEPS = [1, 2, 4, 8]`, `interface ChunkCoord { cx; cz; i0; i1; j0; j1 }`, `chunkGrid(size, cells?)`, `stepIndices(i0, i1, step)`, `buildChunkGeometry(hf, c, step, skirtDepth)`, `chunkBounds(hf, c, out?)`, `selectLod(distance, current, thresholds, hysteresis = 0.08)`.
  - `collisionMesh.ts`: `interface CollisionBands`, `COVE_COLLISION` (fine: 0.4 m out to r = 80 m; coarse: 1.6 m out to r = 200 m), `terrainCollisionGeometry(hf, bands?)`, `terrainCollisionRoot(hf, bands?) → Object3D`.
    - The two bands are decided per 4 × 4 coarse block, so they partition the ground exactly.
    - Planning caught the per-cell version leaving holes and doubled surfaces at the band edge: 58 and 24 of 720 probe rays. The second collision test guards this.
  - `heightTexture.ts`: `createHeightTexture(hf) → DataTexture` (R, half float, one texel per sample), `terrainUvTransform(hf, out?) → Vector4` (world xz → texel-centre uv for every per-sample texture).
  - Fixtures: `testHeader(size, spacing?)`, `bumpy(size)`.

- [ ] **Step 1: Write the failing tests**

`tests/world/terrainFixtures.ts`:
```ts
import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';

/** A header for synthetic heightfields (tests only); the grid is centred on the origin. */
export function testHeader(size: number, spacing = 0.4): TerrainHeader {
  return {
    version: 1, size, spacing, origin: -((size - 1) * spacing) / 2, heightMin: -8, heightMax: 72, waterLevel: -0.45, seed: 1,
    pond: { cx: 0, cz: 0, a: 1, b: 1, angle: 0, depth: 1 }, floorRadius: 35, rimRadius: 50,
    wall: { mean: 19.5, amp: 5.5, sharpness: 5, jitter: 1.6 }, sun: { azimuth: 292, elevation: 14 },
    gully: { azimuth: 292, rStart: 30, rEnd: 110, halfWidthIn: 8, halfWidthOut: 13, blend: 8, ease: 1.6 },
    routeA: { azimuth: 330, rStart: 29, steps: 7, tread: 3, rise: 2.2, riserRun: 0.3, halfWidth: 3.5, blend: 3 },
    routeB: { azimuth: 250, r0: 33, r1: 51, sharpness: 3.5, halfWidth: 4, blend: 4 },
    spawn: [{ x: 0, z: 0, heading: 0 }], layers: ['grass', 'forest', 'moss', 'mud', 'pebbles', 'rock'],
    files: { height: 'height.bin', splatA: 'splatA.png', splatB: 'splatB.png' }, stats: {},
  };
}

/** A deterministic bumpy grid for geometry tests. */
export function bumpy(size: number): Heightfield {
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) h[j * size + i] = Math.sin(i * 0.7) * 2 + Math.cos(j * 0.45) * 1.5 + (i * j) % 7 * 0.1;
  return new Heightfield(testHeader(size), h);
}
```

`tests/world/terrain.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';
import { buildChunkGeometry, chunkGrid, selectLod, stepIndices, CHUNK_CELLS } from '../../src/world/terrain/chunks';
import { terrainCollisionGeometry } from '../../src/world/terrain/collisionMesh';
import { terrainUvTransform } from '../../src/world/terrain/heightTexture';
import { testHeader, bumpy } from './terrainFixtures';

describe('Heightfield', () => {
  it('decodes the uint16 LE grid to within 1.3 mm', () => {
    const hdr = testHeader(4);
    const src = [-8, 0, 12.3456, 72, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, -7.5];
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    src.forEach((v, k) => view.setUint16(k * 2, Math.round(((v + 8) / 80) * 65535), true));
    const hf = Heightfield.fromUint16LE(hdr, bytes);
    src.forEach((v, k) => expect(Math.abs(hf.heights[k] - v)).toBeLessThan(0.0013));
    expect(() => Heightfield.fromUint16LE(hdr, new Uint8Array(30))).toThrow();
  });
  it('heightAt lies exactly on the render triangles', () => {
    const hf = bumpy(33);
    const geo = buildChunkGeometry(hf, { cx: 0, cz: 0, i0: 0, i1: 32, j0: 0, j1: 32 }, 1, 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const rc = new THREE.Raycaster();
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const x = hf.origin + 0.2 + ((k * 0.6180339) % 1) * 12.4;
      const z = hf.origin + 0.2 + ((k * 0.4142135) % 1) * 12.4;
      rc.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
      const hit = rc.intersectObject(mesh, false).find((h) => h.face && h.face.normal.y > 0);
      expect(hit).toBeTruthy();
      worst = Math.max(worst, Math.abs(hit!.point.y - hf.heightAt(x, z)));
    }
    expect(worst).toBeLessThan(1e-4);
  });
  it('normalAt is unit and upright on flat ground', () => {
    const hf = new Heightfield(testHeader(8), new Float32Array(64).fill(2));
    const n = hf.normalAt(0.1, -0.3);
    expect(n.y).toBeCloseTo(1, 9);
    expect(n.length()).toBeCloseTo(1, 9);
  });
});

describe('terrain chunks', () => {
  it('tiles the 1024² grid with 7 × 7 chunks of 160 cells, last ones shorter', () => {
    const g = chunkGrid(1024);
    expect(g).toHaveLength(49);
    expect(CHUNK_CELLS).toBe(160);
    expect(g[g.length - 1]).toMatchObject({ i1: 1023, j1: 1023, i0: 960, j0: 960 });
    expect(stepIndices(960, 1023, 8)).toEqual([960, 968, 976, 984, 992, 1000, 1008, 1016, 1023]);
  });
  it('builds up-facing surface triangles plus skirts, and neighbours share their seam exactly', () => {
    const hf = bumpy(65);
    const a = buildChunkGeometry(hf, { cx: 0, cz: 0, i0: 0, i1: 32, j0: 0, j1: 32 }, 2, 1);
    const b = buildChunkGeometry(hf, { cx: 1, cz: 0, i0: 32, i1: 64, j0: 0, j1: 32 }, 2, 1);
    const pa = a.attributes.position;
    const idx = a.index!;
    const surfTris = 16 * 16 * 2;
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    for (let t = 0; t < surfTris; t++) {
      v0.fromBufferAttribute(pa, idx.getX(t * 3));
      v1.fromBufferAttribute(pa, idx.getX(t * 3 + 1));
      v2.fromBufferAttribute(pa, idx.getX(t * 3 + 2));
      expect(v1.clone().sub(v0).cross(v2.clone().sub(v0)).y).toBeGreaterThan(0);
    }
    const seam = (g: THREE.BufferGeometry, x: number) => {
      const out: string[] = [];
      const p = g.attributes.position;
      for (let k = 0; k < 17 * 17; k++) if (Math.abs(p.getX(k) - x) < 1e-6) out.push(`${p.getZ(k).toFixed(4)}:${p.getY(k).toFixed(5)}`);
      return out.sort();
    };
    const x = hf.coord(32);
    expect(seam(a, x)).toEqual(seam(b, x));
    expect(seam(a, x)).toHaveLength(17);
  });
  it('switches LOD with hysteresis', () => {
    const th = [70, 140, 240];
    expect(selectLod(10, -1, th)).toBe(0);
    expect(selectLod(72, 0, th)).toBe(0); // inside the 8 % band: keep
    expect(selectLod(80, 0, th)).toBe(1);
    expect(selectLod(66, 1, th)).toBe(1); // must come below 64.4 to refine
    expect(selectLod(60, 1, th)).toBe(0);
    expect(selectLod(500, 0, th)).toBe(3);
  });
});

describe('terrain collision', () => {
  const bands = { fine: { radius: 30, step: 1 }, coarse: { radius: 50, step: 4 } };
  it('keeps the fine band at full resolution, winds outward, and matches heightAt', () => {
    const hf = bumpy(257); // 102.4 m square
    const g = terrainCollisionGeometry(hf, bands);
    const pos = g.attributes.position;
    expect(pos.count % 3).toBe(0);
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    for (let t = 0; t < pos.count / 3; t++) {
      v0.fromBufferAttribute(pos, t * 3);
      v1.fromBufferAttribute(pos, t * 3 + 1);
      v2.fromBufferAttribute(pos, t * 3 + 2);
      expect(v1.clone().sub(v0).cross(v2.clone().sub(v0)).y).toBeGreaterThan(0);
    }
    const fineCells = Math.PI * 30 * 30 / (0.4 * 0.4);
    expect(pos.count / 6).toBeGreaterThan(fineCells * 0.95);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    const rc = new THREE.Raycaster(new THREE.Vector3(3.3, 50, -7.1), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObject(mesh)[0];
    expect(hit.point.y).toBeCloseTo(hf.heightAt(3.3, -7.1), 4);
  });
  it('covers the ground exactly once where the fine and coarse bands meet (no holes, no doubled surface)', () => {
    const hf = bumpy(257);
    const mesh = new THREE.Mesh(terrainCollisionGeometry(hf, bands), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const rc = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    for (let k = 0; k < 720; k++) {
      const a = (k / 720) * Math.PI * 2;
      const r = 28 + (k % 9) * 0.5; // 28–32 m: straddles the 30 m band edge
      rc.set(new THREE.Vector3(Math.cos(a) * r + 0.013, 60, Math.sin(a) * r + 0.017), down);
      expect(rc.intersectObject(mesh).length).toBe(1);
    }
  });
});

describe('terrain textures', () => {
  it('maps sample positions to texel centres', () => {
    const hf = bumpy(9);
    const t = terrainUvTransform(hf);
    const u = (x: number) => (x - t.x) * t.z;
    expect(u(hf.coord(0))).toBeCloseTo(0.5 / 9, 12);
    expect(u(hf.coord(8))).toBeCloseTo(8.5 / 9, 12);
  });
});

const COVE = 'public/assets/world/cove/';
describe.skipIf(!existsSync(`${COVE}terrain.json`))('the baked Cove heightfield', () => {
  it('decodes, and the spawn stands on flat floor', () => {
    const hdr = JSON.parse(readFileSync(`${COVE}terrain.json`, 'utf8')) as TerrainHeader;
    const hf = Heightfield.fromUint16LE(hdr, readFileSync(COVE + hdr.files.height));
    const s = hdr.spawn[0];
    expect(Math.abs(hf.heightAt(s.x, s.z))).toBeLessThan(1.5);
    expect(hf.normalAt(s.x, s.z).y).toBeGreaterThan(0.98);
    expect(hf.heightAt(0, -60)).toBeGreaterThan(10); // north rim
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/world/terrain.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/world/terrain/heightfield.ts`:
```ts
import * as THREE from 'three';

/** `public/assets/world/cove/terrain.json` (written by pipeline/terrain/bake.mjs). */
export interface TerrainHeader {
  version: 1;
  size: number;
  spacing: number;
  origin: number;
  heightMin: number;
  heightMax: number;
  waterLevel: number;
  seed: number;
  pond: { cx: number; cz: number; a: number; b: number; angle: number; depth: number };
  floorRadius: number;
  rimRadius: number;
  wall: { mean: number; amp: number; sharpness: number; jitter: number };
  sun: { azimuth: number; elevation: number };
  gully: { azimuth: number; rStart: number; rEnd: number; halfWidthIn: number; halfWidthOut: number; blend: number; ease: number };
  routeA: { azimuth: number; rStart: number; steps: number; tread: number; rise: number; riserRun: number; halfWidth: number; blend: number };
  routeB: { azimuth: number; r0: number; r1: number; sharpness: number; halfWidth: number; blend: number };
  spawn: { x: number; z: number; heading: number }[];
  layers: string[];
  files: { height: string; splatA: string; splatB: string };
  stats: Record<string, number>;
}

/**
 * The baked terrain height grid. Sample (i, j) sits at (origin + i·spacing, origin + j·spacing); every quad is split
 * along the (i, j+1)–(i+1, j) diagonal — the same triangles the render chunks and the collision mesh use — and
 * `heightAt` interpolates on those triangles, so it agrees with both exactly.
 */
export class Heightfield {
  readonly size: number;
  readonly spacing: number;
  readonly origin: number;

  constructor(
    readonly header: TerrainHeader,
    readonly heights: Float32Array,
  ) {
    this.size = header.size;
    this.spacing = header.spacing;
    this.origin = header.origin;
    if (heights.length !== this.size * this.size) throw new Error(`heightfield: expected ${this.size ** 2} samples, got ${heights.length}`);
  }

  /** Decodes the bake's uint16 little-endian grid over [heightMin, heightMax]. */
  static fromUint16LE(header: TerrainHeader, bytes: ArrayBuffer | Uint8Array): Heightfield {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.byteLength !== header.size * header.size * 2) throw new Error(`heightfield: ${u8.byteLength} bytes for a ${header.size}² grid`);
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const out = new Float32Array(header.size * header.size);
    const scale = (header.heightMax - header.heightMin) / 65535;
    for (let k = 0; k < out.length; k++) out[k] = header.heightMin + view.getUint16(k * 2, true) * scale;
    return new Heightfield(header, out);
  }

  /** World x (or z) of sample index i. */
  coord(i: number): number {
    return this.origin + i * this.spacing;
  }

  /** Grid value with clamped indices. */
  sample(i: number, j: number): number {
    const n = this.size - 1;
    const ii = i < 0 ? 0 : i > n ? n : i;
    const jj = j < 0 ? 0 : j > n ? n : j;
    return this.heights[jj * this.size + ii];
  }

  /** Height on the render/collision triangles (clamped to the grid edge outside it). */
  heightAt(x: number, z: number): number {
    const n = this.size - 1;
    let fi = (x - this.origin) / this.spacing;
    let fj = (z - this.origin) / this.spacing;
    fi = fi < 0 ? 0 : fi > n ? n : fi;
    fj = fj < 0 ? 0 : fj > n ? n : fj;
    let i = Math.floor(fi);
    let j = Math.floor(fj);
    if (i === n) i = n - 1;
    if (j === n) j = n - 1;
    const u = fi - i;
    const v = fj - j;
    const h00 = this.heights[j * this.size + i];
    const h10 = this.heights[j * this.size + i + 1];
    const h01 = this.heights[(j + 1) * this.size + i];
    const h11 = this.heights[(j + 1) * this.size + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  /** Smooth surface normal from central differences of the grid, bilinearly interpolated. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const fi = (x - this.origin) / this.spacing;
    const fj = (z - this.origin) / this.spacing;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const g00 = this.gradient(i, j);
    const g10 = this.gradient(i + 1, j);
    const g01 = this.gradient(i, j + 1);
    const g11 = this.gradient(i + 1, j + 1);
    const gx = (g00[0] * (1 - u) + g10[0] * u) * (1 - v) + (g01[0] * (1 - u) + g11[0] * u) * v;
    const gz = (g00[1] * (1 - u) + g10[1] * u) * (1 - v) + (g01[1] * (1 - u) + g11[1] * u) * v;
    return out.set(-gx, 1, -gz).normalize();
  }

  /** Vertex normal of grid sample (i, j) — what the render chunks use at every LOD. */
  vertexNormal(i: number, j: number, out = new THREE.Vector3()): THREE.Vector3 {
    const [gx, gz] = this.gradient(i, j);
    return out.set(-gx, 1, -gz).normalize();
  }

  /** dh/dx, dh/dz at grid sample (i, j) by central differences (one-sided at the edges). */
  private gradient(i: number, j: number): [number, number] {
    const s = 2 * this.spacing;
    return [(this.sample(i + 1, j) - this.sample(i - 1, j)) / s, (this.sample(i, j + 1) - this.sample(i, j - 1)) / s];
  }
}
```

`src/world/terrain/chunks.ts`:
```ts
import * as THREE from 'three';
import type { Heightfield } from './heightfield';

/** 160 cells × 0.4 m = 64 m chunks (spec §7.3). */
export const CHUNK_CELLS = 160;
/** Vertex step (in grid cells) per LOD: 0.4, 0.8, 1.6, 3.2 m. */
export const LOD_STEPS = [1, 2, 4, 8] as const;

/** A chunk: an inclusive range of grid vertex indices on each axis. */
export interface ChunkCoord {
  cx: number;
  cz: number;
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** Tiles the grid's (size − 1)² cells with chunks of `cells` cells; the last row/column may be shorter. */
export function chunkGrid(size: number, cells = CHUNK_CELLS): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  const last = size - 1;
  const n = Math.ceil(last / cells);
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      out.push({ cx, cz, i0: cx * cells, i1: Math.min(last, (cx + 1) * cells), j0: cz * cells, j1: Math.min(last, (cz + 1) * cells) });
    }
  }
  return out;
}

/** i0, i0 + step, …, always ending exactly on i1 (a shorter last step if the range is not a multiple). */
export function stepIndices(i0: number, i1: number, step: number): number[] {
  const out: number[] = [];
  for (let i = i0; i < i1; i += step) out.push(i);
  out.push(i1);
  return out;
}

/**
 * World-space chunk mesh at one LOD, with skirts (strips hanging `skirtDepth` metres below every border, both
 * windings) that hide cracks between neighbours at different LODs. Normals come from the full-resolution grid at
 * every LOD so lighting does not change when a chunk switches.
 */
export function buildChunkGeometry(hf: Heightfield, c: ChunkCoord, step: number, skirtDepth: number): THREE.BufferGeometry {
  const is = stepIndices(c.i0, c.i1, step);
  const js = stepIndices(c.j0, c.j1, step);
  const nx = is.length;
  const nz = js.length;
  const borderCount = 2 * (nx + nz) - 4;
  const vertCount = nx * nz + borderCount;
  const pos = new Float32Array(vertCount * 3);
  const nrm = new Float32Array(vertCount * 3);
  const n = new THREE.Vector3();
  let v = 0;
  const put = (i: number, j: number, drop: number) => {
    hf.vertexNormal(i, j, n);
    pos[v * 3] = hf.coord(i);
    pos[v * 3 + 1] = hf.sample(i, j) - drop;
    pos[v * 3 + 2] = hf.coord(j);
    nrm[v * 3] = n.x;
    nrm[v * 3 + 1] = n.y;
    nrm[v * 3 + 2] = n.z;
    return v++;
  };
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) put(is[a], js[b], 0);
  const idx: number[] = [];
  const at = (a: number, b: number) => b * nx + a;
  for (let b = 0; b < nz - 1; b++) {
    for (let a = 0; a < nx - 1; a++) {
      const v00 = at(a, b);
      const v10 = at(a + 1, b);
      const v01 = at(a, b + 1);
      const v11 = at(a + 1, b + 1);
      idx.push(v00, v01, v10, v10, v01, v11); // CCW seen from +Y; diagonal (i, j+1)–(i+1, j)
    }
  }
  // border loop (clockwise-agnostic): top row, right column, bottom row reversed, left column reversed
  const loop: Array<[number, number]> = [];
  for (let a = 0; a < nx; a++) loop.push([a, 0]);
  for (let b = 1; b < nz; b++) loop.push([nx - 1, b]);
  for (let a = nx - 2; a >= 0; a--) loop.push([a, nz - 1]);
  for (let b = nz - 2; b >= 1; b--) loop.push([0, b]);
  const skirt = loop.map(([a, b]) => put(is[a], js[b], skirtDepth));
  for (let k = 0; k < loop.length; k++) {
    const k2 = (k + 1) % loop.length;
    const t0 = at(loop[k][0], loop[k][1]);
    const t1 = at(loop[k2][0], loop[k2][1]);
    const s0 = skirt[k];
    const s1 = skirt[k2];
    idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(vertCount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Axis-aligned bounds of a chunk from the grid (min/max height over its samples). */
export function chunkBounds(hf: Heightfield, c: ChunkCoord, out = new THREE.Box3()): THREE.Box3 {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = c.j0; j <= c.j1; j++) {
    for (let i = c.i0; i <= c.i1; i++) {
      const h = hf.sample(i, j);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  out.min.set(hf.coord(c.i0), lo, hf.coord(c.j0));
  out.max.set(hf.coord(c.i1), hi, hf.coord(c.j1));
  return out;
}

/**
 * LOD for a chunk at `distance` metres, given ascending switch distances (LOD k is used up to thresholds[k]).
 * Hysteresis keeps the current LOD until the distance clears the switch by `hysteresis` (fraction) either way.
 */
export function selectLod(distance: number, current: number, thresholds: readonly number[], hysteresis = 0.08): number {
  let target = thresholds.length;
  for (let k = 0; k < thresholds.length; k++) {
    if (distance < thresholds[k]) {
      target = k;
      break;
    }
  }
  if (target === current || current < 0) return target;
  if (target > current) return distance > thresholds[current] * (1 + hysteresis) ? target : current;
  return distance < thresholds[target] * (1 - hysteresis) ? target : current;
}
```

`src/world/terrain/collisionMesh.ts`:
```ts
import * as THREE from 'three';
import type { Heightfield } from './heightfield';

/** Full 0.4 m resolution where Toothless walks and climbs; 1.6 m out to the far forest. */
export interface CollisionBands {
  fine: { radius: number; step: number };
  coarse: { radius: number; step: number };
}
export const COVE_COLLISION: CollisionBands = { fine: { radius: 80, step: 1 }, coarse: { radius: 200, step: 4 } };

/**
 * Non-indexed world-space triangles of the terrain for Plan 3's CollisionWorld. The grid is walked in coarse blocks:
 * a block whose centre lies within the fine radius is emitted as full-resolution cells (the same triangles as the
 * LOD0 render chunks), a block within the coarse radius as one coarse cell. Deciding per block makes the two bands
 * an exact partition of the ground — no holes and no doubled surfaces where they meet. Winding is CCW from +Y
 * (outward), which CollisionWorld.isInside relies on.
 */
export function terrainCollisionGeometry(hf: Heightfield, bands: CollisionBands = COVE_COLLISION): THREE.BufferGeometry {
  const tris: number[] = [];
  const last = hf.size - 1;
  const cell = (i: number, j: number, s: number) => {
    const i1 = Math.min(last, i + s);
    const j1 = Math.min(last, j + s);
    const x0 = hf.coord(i);
    const x1 = hf.coord(i1);
    const z0 = hf.coord(j);
    const z1 = hf.coord(j1);
    const h00 = hf.sample(i, j);
    const h10 = hf.sample(i1, j);
    const h01 = hf.sample(i, j1);
    const h11 = hf.sample(i1, j1);
    tris.push(x0, h00, z0, x0, h01, z1, x1, h10, z0, x1, h10, z0, x0, h01, z1, x1, h11, z1);
  };
  const C = bands.coarse.step;
  const F = bands.fine.step;
  if (C % F !== 0) throw new Error('coarse step must be a multiple of the fine step');
  for (let j = 0; j < last; j += C) {
    for (let i = 0; i < last; i += C) {
      const d = Math.hypot(hf.coord(i) + (C * hf.spacing) / 2, hf.coord(j) + (C * hf.spacing) / 2);
      if (d < bands.fine.radius) {
        for (let jj = j; jj < Math.min(j + C, last); jj += F) for (let ii = i; ii < Math.min(i + C, last); ii += F) cell(ii, jj, F);
      } else if (d < bands.coarse.radius) {
        cell(i, j, C);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  return g;
}

/** An invisible, never-rendered collision root (pass it to CollisionWorld.fromObjects, not to the scene). */
export function terrainCollisionRoot(hf: Heightfield, bands: CollisionBands = COVE_COLLISION): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'TerrainCollision';
  const mesh = new THREE.Mesh(terrainCollisionGeometry(hf, bands), new THREE.MeshBasicMaterial({ visible: false }));
  mesh.name = 'terrain-collision';
  root.add(mesh);
  root.updateMatrixWorld(true);
  return root;
}
```

`src/world/terrain/heightTexture.ts`:
```ts
import * as THREE from 'three';
import type { Heightfield } from './heightfield';

/**
 * The heightfield as a half-float red texture (one texel per sample), for shaders that need the ground height:
 * the rock base blend (M7a) and grass placement (M7b). Row j is z; no flip. Half floats keep ~1 cm precision
 * below 16 m and ~3 cm on the tallest rims — fine for blending and grass roots.
 */
export function createHeightTexture(hf: Heightfield): THREE.DataTexture {
  const data = new Uint16Array(hf.heights.length);
  for (let k = 0; k < data.length; k++) data[k] = THREE.DataUtils.toHalfFloat(hf.heights[k]);
  const tex = new THREE.DataTexture(data, hf.size, hf.size, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * (x0, z0, 1/width, 1/depth) mapping world xz to texel-centre UVs of any per-sample terrain texture
 * (height, splat): uv = (xz − (origin − spacing/2)) / (size · spacing).
 */
export function terrainUvTransform(hf: Heightfield, out = new THREE.Vector4()): THREE.Vector4 {
  const start = hf.origin - hf.spacing / 2;
  const inv = 1 / (hf.size * hf.spacing);
  return out.set(start, start, inv, inv);
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/world/terrain.test.ts` → 10 pass (the baked-heightfield test runs because Task 4 committed the bake). `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `feat(cove): runtime heightfield, LOD chunk geometry with skirts, collision mesh`.

---

### Task 6: Terrain splat layers (CC0 fetch + packing)

**Files:**
- Create: `pipeline/cc0/terrainLayers.mjs`, `pipeline/cc0/terrainLayers.d.mts`, `pipeline/cc0/pack-terrain.mjs`, `pipeline/cc0/terrainLayers.test.mjs`
- Modify: `pipeline/cc0/wanted.json`, `package.json` (script `cc0:terrain`)
- Output (committed): `public/assets/textures/terrain/<id>/{albedo,nor,armh}.webp` for the six layers, `pipeline/cc0/manifest.json`, `CREDITS.md`

**Interfaces:**
- Consumes: Plan 1's `pipeline/cc0/{polyhaven,fetch}.mjs` (`npm run cc0:fetch`, `TEXTURE_MAPS` including `disp`).
- Produces:
  - `TERRAIN_LAYER_IDS` (the six ids in splat order), `LAYER_TOKENS`, `packArmh(arm, disp, pixels) → Buffer`.
  - `npm run cc0:terrain`.
  - A new `wanted.json` key `terrainLayer: { dir, size }`, which Plan 1's `process-textures.mjs` ignores.
  - `.d.mts` gives the `.mjs` types, so `tests/world/splat.test.ts` can import it (TS7016 otherwise).

Layer choice (spec §7.3: grass, forest floor, moss, wet mud, pebbles, rock). All six ids were verified on the live Poly Haven API (2026-09-27):

| Splat layer | Poly Haven id | Tile (m) | Why |
|---|---|---|---|
| grass | `sparse_grass` | 2.0 | grass with roots and soil showing (M7b's blades cover it) |
| forest | `forest_ground_04` | 3.15 | pine-forest floor (Plan 1 already fetches it) |
| moss | `mossy_rock` | 3.0 | moss over stone at the wall foot; also the rocks' moss |
| mud | `mud_forest` | 2.35 | wet brown mud with leaves (pond banks, gully) |
| pebbles | `pebble_ground_01` | 1.5 | pond bed and shore |
| rock | `rock_wall_02` | 3.5 | bare weathered coastal rock (tagged "rock face, natural"). Tiled at 1.75× its 2 m scan size, because at 2 m the big triplanar walls striped. |

- [ ] **Step 1: Write the failing test**

`pipeline/cc0/terrainLayers.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { packArmh, TERRAIN_LAYER_IDS } from './terrainLayers.mjs';

describe('terrain layer packing', () => {
  it('keeps AO and roughness and puts the height in blue', () => {
    const arm = new Uint8Array([10, 20, 0, 30, 40, 255]);
    const disp = new Uint8Array([99, 7]);
    expect(Array.from(packArmh(arm, disp, 2))).toEqual([10, 20, 99, 30, 40, 7]);
    expect(() => packArmh(arm, disp, 3)).toThrow();
  });
  it('lists the six splat layers in bake order', () => {
    expect(TERRAIN_LAYER_IDS).toHaveLength(6);
    expect(TERRAIN_LAYER_IDS[5]).toBe('rock_wall_02');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- pipeline/cc0/terrainLayers` → module not found.

- [ ] **Step 3: Implement**

`pipeline/cc0/terrainLayers.mjs`:
```js
// Terrain splat layers: which Poly Haven textures, and how their maps are packed for the runtime arrays.

/** Splat order is fixed by the terrain bake: grass, forest, moss, mud, pebbles, rock. */
export const TERRAIN_LAYER_IDS = ['sparse_grass', 'forest_ground_04', 'mossy_rock', 'mud_forest', 'pebble_ground_01', 'rock_wall_02'];

/** Poly Haven file-name token of each source map (`<id>_<token>_<res>.<ext>`). */
export const LAYER_TOKENS = { diff: 'diff', nor: 'nor_gl', arm: 'arm', disp: 'disp' };

/**
 * The 'armh' map: R = ambient occlusion (arm.r), G = roughness (arm.g), B = height (displacement). Terrain
 * metalness is always 0, so its channel carries the height the splat height-blend needs — and the map stays
 * opaque, so browser canvas decoding returns exact values.
 * @param {Uint8Array} arm interleaved RGB, `pixels` × 3 bytes
 * @param {Uint8Array} disp single channel, `pixels` bytes
 */
export function packArmh(arm, disp, pixels) {
  if (arm.length < pixels * 3 || disp.length < pixels) throw new Error('packArmh: buffers shorter than the pixel count');
  const out = Buffer.alloc(pixels * 3);
  for (let k = 0; k < pixels; k++) {
    out[k * 3] = arm[k * 3];
    out[k * 3 + 1] = arm[k * 3 + 1];
    out[k * 3 + 2] = disp[k];
  }
  return out;
}
```

`pipeline/cc0/terrainLayers.d.mts`:
```ts
// Types for terrainLayers.mjs (imported by the engine's tests to keep the layer order in one place).
export declare const TERRAIN_LAYER_IDS: string[];
export declare const LAYER_TOKENS: Record<'diff' | 'nor' | 'arm' | 'disp', string>;
export declare function packArmh(arm: Uint8Array, disp: Uint8Array, pixels: number): Uint8Array;
```

`pipeline/cc0/pack-terrain.mjs`:
```js
// Packs every wanted.json texture with a `terrainLayer` entry into the runtime's three maps:
// public/assets/<dir>/{albedo,nor,armh}.webp at `size`². Needs `npm run cc0:fetch` first.
// Usage: npm run cc0:terrain
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LAYER_TOKENS, packArmh } from './terrainLayers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const wanted = JSON.parse(await readFile(join(HERE, 'wanted.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(HERE, 'manifest.json'), 'utf8'));

for (const want of wanted.filter((w) => w.type === 'textures' && w.terrainLayer)) {
  const entry = manifest.find((m) => m.id === want.id);
  if (!entry) throw new Error(`${want.id} is not in manifest.json — run npm run cc0:fetch first`);
  const file = (map) => {
    const f = entry.files.find((x) => x.path.toLowerCase().includes(`_${LAYER_TOKENS[map]}_`));
    if (!f) throw new Error(`${want.id}: no cached ${map} map (add it to "maps" in wanted.json)`);
    return join(HERE, 'cache', want.id, f.path);
  };
  const { dir, size } = want.terrainLayer;
  const out = join(ROOT, 'public', 'assets', dir);
  await mkdir(out, { recursive: true });
  const fit = { width: size, height: size, fit: 'fill' };
  await sharp(file('diff')).resize(fit).removeAlpha().webp({ quality: 88 }).toFile(join(out, 'albedo.webp'));
  await sharp(file('nor')).resize(fit).removeAlpha().webp({ quality: 95 }).toFile(join(out, 'nor.webp'));
  const arm = await sharp(file('arm')).resize(fit).removeAlpha().raw({ depth: 'uchar' }).toBuffer();
  const disp = await sharp(file('disp')).resize(fit).toColourspace('b-w').normalise().raw({ depth: 'uchar' }).toBuffer();
  await sharp(packArmh(arm, disp, size * size), { raw: { width: size, height: size, channels: 3 } })
    .webp({ quality: 95 }).toFile(join(out, 'armh.webp'));
  console.log(`${want.id} → ${dir}/{albedo,nor,armh}.webp`);
}
```

`package.json` — add `"cc0:terrain": "node pipeline/cc0/pack-terrain.mjs"` to `scripts`.

`pipeline/cc0/wanted.json` — make three changes:
1. Give the existing `forest_ground_04` entry `"maps": ["diff", "nor", "arm", "disp"]` and `"terrainLayer": { "dir": "textures/terrain/forest_ground_04", "size": 1024 }`. Keep its `install`, which the test scene still uses.
2. Append the other five layers.
3. Keep every other existing entry.
```json
{ "id": "sparse_grass", "type": "textures", "res": "2k", "maps": ["diff", "nor", "arm", "disp"],
  "terrainLayer": { "dir": "textures/terrain/sparse_grass", "size": 1024 } },
{ "id": "mossy_rock", "type": "textures", "res": "2k", "maps": ["diff", "nor", "arm", "disp"],
  "terrainLayer": { "dir": "textures/terrain/mossy_rock", "size": 1024 } },
{ "id": "mud_forest", "type": "textures", "res": "2k", "maps": ["diff", "nor", "arm", "disp"],
  "terrainLayer": { "dir": "textures/terrain/mud_forest", "size": 1024 } },
{ "id": "pebble_ground_01", "type": "textures", "res": "2k", "maps": ["diff", "nor", "arm", "disp"],
  "terrainLayer": { "dir": "textures/terrain/pebble_ground_01", "size": 1024 } },
{ "id": "rock_wall_02", "type": "textures", "res": "2k", "maps": ["diff", "nor", "arm", "disp"],
  "terrainLayer": { "dir": "textures/terrain/rock_wall_02", "size": 1024 } }
```

- [ ] **Step 4: Fetch, pack, verify**
  1. Run `npm run cc0:fetch`. Every file prints `downloaded` or `cached` with its md5 verified; `manifest.json` and `CREDITS.md` are rewritten.
  2. Run `npm run cc0:terrain`. It prints six `<id> → textures/terrain/<id>/{albedo,nor,armh}.webp` lines.
  3. Spot-check with a one-off `node -e` sharp `stats()` call on two layers. Expected:
     - every map is 1024², 3 channels
     - normal-map means ≈ (128, 128, 230+)
     - the `armh` blue channel spans most of 0–255
  4. Run `npm test -- pipeline/cc0` → all pass.

- [ ] **Step 5: Commit** — `wanted.json`, `manifest.json`, `CREDITS.md`, the packer, its test and `.d.mts`, `package.json`, and the 18 WebP files (about 5 MB). Message: `feat(cove): six CC0 terrain splat layers packed as albedo/normal/armh`.

---

### Task 7: The splat material

**Files:**
- Create: `src/world/terrain/layers.ts`, `src/world/terrain/splatShader.ts`, `tests/world/splat.test.ts`

**Interfaces:**
- Consumes: `addCompileHook`, `ShaderParams` (Plan 1 `src/render/materials.ts`); `TERRAIN_LAYER_IDS` (Task 6).
- Produces:
  - `layers.ts`:
    - `interface TerrainLayer { id; tile }`, `COVE_LAYERS`, `interface LayerArrays { albedo; normal; armh; dispose() }`
    - `flipRowsInto(src, dst, offset, width, height)`, `loadLayerArrays(baseUrl, layers, size) → Promise<LayerArrays>` (browser)
    - `loadSplatTexture(url) → Promise<Texture>` (browser; ImageBitmap, un-premultiplied, no flip)
  - `splatShader.ts`:
    - `interface SplatUniforms`, `createSplatUniforms()`
    - `SPLAT_FRAGMENT_PARS`: shared GLSL helpers and uniforms (no varyings); the rock hook reuses them (Task 11)
    - `patchSplatShader(shader, uniforms)`, `createSplatMaterial(uniforms, low) → MeshStandardMaterial` (hook key `terrainSplat`)

How it works:
- Pass 1 reads each active layer's `armh` and height-blends the six splat weights (a layer shows where its height + weight is within `uHeightBlend` of the highest).
- Pass 2 samples albedo and normal only for the layers that survive. Rock is triplanar on High, and the 0.23× far-scale albedo fades in past `uFarBlend` for every layer, rock included, to break up tiling. Low-frequency macro noise varies the tint. Wetness darkens the albedo and lowers the roughness; the baked AO multiplies the layer AO.
- `normal` is set in view space from the blended world normal (whiteout blends).
- The replaced `aomap_fragment` keeps three's specular occlusion.
- Low (`TERRAIN_LOW`) drops the triplanar and far-scale sampling.
- The splat PNGs must be decoded **without premultiplication**. A plain `<img>` upload zeroes the RGB weights wherever the alpha channel (mud) is 0, hence `createImageBitmap(…, { premultiplyAlpha: 'none' })`.

- [ ] **Step 1: Write the failing tests**

`tests/world/splat.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flipRowsInto, COVE_LAYERS } from '../../src/world/terrain/layers';
import { patchSplatShader, createSplatMaterial, createSplatUniforms } from '../../src/world/terrain/splatShader';
import { TERRAIN_LAYER_IDS } from '../../pipeline/cc0/terrainLayers.mjs';

describe('layer packing', () => {
  it('flips rows so v = 0 is the image bottom', () => {
    const src = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]); // 1 px wide, 4 rows (top → bottom)
    const dst = new Uint8Array(20);
    flipRowsInto(src, dst, 4, 1, 4);
    expect(Array.from(dst)).toEqual([0, 0, 0, 0, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
  });
});

describe('layer table', () => {
  it('matches the packer and the bake order', () => {
    expect(COVE_LAYERS.map((l) => l.id)).toEqual(TERRAIN_LAYER_IDS);
    expect(createSplatUniforms().uLayerTile.value).toEqual(COVE_LAYERS.map((l) => l.tile));
  });
});

describe('splat shader', () => {
  const stdShader = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });
  it('patches every anchor of the standard program', () => {
    const s = stdShader() as never as Parameters<typeof patchSplatShader>[0];
    patchSplatShader(s, createSplatUniforms());
    expect(s.fragmentShader).toContain('uniform highp sampler2DArray tTerrainArmh');
    expect(s.fragmentShader).toContain('float roughnessFactor = tRough;');
    expect(s.fragmentShader).not.toContain('#include <map_fragment>');
    expect(s.vertexShader).toContain('vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    expect(Object.keys(s.uniforms)).toContain('uLayerTile');
  });
  it('fails loudly if three renames a chunk', () => {
    const s = stdShader() as never as Parameters<typeof patchSplatShader>[0];
    s.fragmentShader = s.fragmentShader.replace('#include <aomap_fragment>', '');
    expect(() => patchSplatShader(s, createSplatUniforms())).toThrow(/aomap_fragment/);
  });
  it('builds a keyed material with a Low variant', () => {
    const hi = createSplatMaterial(createSplatUniforms(), false);
    const lo = createSplatMaterial(createSplatUniforms(), true);
    expect(hi.customProgramCacheKey()).toContain('terrainSplat');
    expect(lo.defines).toMatchObject({ TERRAIN_LOW: '' });
    expect(hi.defines).not.toHaveProperty('TERRAIN_LOW');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — modules not found.

- [ ] **Step 3: Implement**

`src/world/terrain/layers.ts`:
```ts
import * as THREE from 'three';

/** One splat layer: its Poly Haven id (folder under assets/textures/terrain/) and metres per texture repeat. */
export interface TerrainLayer {
  id: string;
  tile: number;
}

/** Splat order is fixed by the bake: grass, forest, moss, mud, pebbles, rock (splatA rgba, splatB rg). */
export const COVE_LAYERS: readonly TerrainLayer[] = [
  { id: 'sparse_grass', tile: 2.0 },
  { id: 'forest_ground_04', tile: 3.15 },
  { id: 'mossy_rock', tile: 3.0 },
  { id: 'mud_forest', tile: 2.35 },
  { id: 'pebble_ground_01', tile: 1.5 },
  { id: 'rock_wall_02', tile: 3.5 }, // cliffs: 1.75× the scan's scale, so the big walls don't stripe
];

export interface LayerArrays {
  /** sRGB albedo. */
  albedo: THREE.DataArrayTexture;
  /** OpenGL tangent-space normals. */
  normal: THREE.DataArrayTexture;
  /** R = ambient occlusion, G = roughness, B = blend height (terrain metalness is always 0). */
  armh: THREE.DataArrayTexture;
  dispose(): void;
}

/**
 * Copies `height` rows of RGBA pixels into `dst` at `offset` bytes, bottom row first, so v = 0 is the image's
 * bottom row (the OpenGL convention the normal maps are authored in).
 */
export function flipRowsInto(src: Uint8ClampedArray | Uint8Array, dst: Uint8Array, offset: number, width: number, height: number): void {
  const row = width * 4;
  for (let y = 0; y < height; y++) dst.set(src.subarray((height - 1 - y) * row, (height - y) * row), offset + y * row);
}

function makeArray(data: Uint8Array, size: number, depth: number, srgb: boolean): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, size, size, depth);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Decodes an opaque WebP at `size`² with no colour management (exact data for normal/armh maps). */
async function decodeRgba(url: string, size: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain layer ${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), {
    premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: size, resizeHeight: size, resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('terrain layers: no 2D context');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, size, size).data;
}

/**
 * Loads every layer's albedo.webp, nor.webp and armh.webp (written by `npm run cc0:terrain`) into three
 * DataArrayTextures of `size`² (1024 on High, 512 on Low).
 */
export async function loadLayerArrays(baseUrl: string, layers: readonly TerrainLayer[], size: number): Promise<LayerArrays> {
  const bytes = size * size * 4;
  const albedo = new Uint8Array(bytes * layers.length);
  const normal = new Uint8Array(bytes * layers.length);
  const armh = new Uint8Array(bytes * layers.length);
  await Promise.all(layers.map(async (layer, l) => {
    const dir = `${baseUrl}${layer.id}/`;
    const [a, n, h] = await Promise.all([
      decodeRgba(`${dir}albedo.webp`, size), decodeRgba(`${dir}nor.webp`, size), decodeRgba(`${dir}armh.webp`, size),
    ]);
    flipRowsInto(a, albedo, l * bytes, size, size);
    flipRowsInto(n, normal, l * bytes, size, size);
    flipRowsInto(h, armh, l * bytes, size, size);
  }));
  const arrays = {
    albedo: makeArray(albedo, size, layers.length, true),
    normal: makeArray(normal, size, layers.length, false),
    armh: makeArray(armh, size, layers.length, false),
  };
  return {
    ...arrays,
    dispose() {
      arrays.albedo.dispose();
      arrays.normal.dispose();
      arrays.armh.dispose();
    },
  };
}

/**
 * Splat maps as textures that keep their exact channel values: an ImageBitmap decoded with premultiplyAlpha
 * 'none' (a plain <img> upload would premultiply and zero the RGB weights wherever the mud weight in alpha is 0).
 * Row j of the PNG is z, so no flip.
 */
export async function loadSplatTexture(url: string): Promise<THREE.Texture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`splat ${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bmp);
  tex.flipY = false;
  tex.premultiplyAlpha = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
```

`src/world/terrain/splatShader.ts`:
```ts
import * as THREE from 'three';
import { addCompileHook, type ShaderParams } from '../../render/materials';

/** Uniform objects shared by the terrain and the rock base blend (one set per region). */
export interface SplatUniforms {
  tTerrainAlbedo: { value: THREE.DataArrayTexture | null };
  tTerrainNormal: { value: THREE.DataArrayTexture | null };
  tTerrainArmh: { value: THREE.DataArrayTexture | null };
  tTerrainSplatA: { value: THREE.Texture | null };
  tTerrainSplatB: { value: THREE.Texture | null };
  /** (x0, z0, 1/width, 1/depth): world xz → splat texel-centre uv (see heightTexture.terrainUvTransform). */
  uTerrainExtent: { value: THREE.Vector4 };
  /** Metres per texture repeat, per layer. */
  uLayerTile: { value: number[] };
  /** Height-blend band: how far below the highest layer (height + weight) a layer still shows. */
  uHeightBlend: { value: number };
  /** Camera distance where the 4.3× far-scale albedo starts fading in (anti-tiling). */
  uFarBlend: { value: number };
}

export function createSplatUniforms(): SplatUniforms {
  return {
    tTerrainAlbedo: { value: null },
    tTerrainNormal: { value: null },
    tTerrainArmh: { value: null },
    tTerrainSplatA: { value: null },
    tTerrainSplatB: { value: null },
    uTerrainExtent: { value: new THREE.Vector4() },
    uLayerTile: { value: [2, 3.15, 3, 2.35, 1.5, 3.5] },
    uHeightBlend: { value: 0.2 },
    uFarBlend: { value: 30 },
  };
}

export const SPLAT_VERTEX_PARS = /* glsl */ `
varying vec3 vTerrainPos;
varying vec3 vTerrainNrm;
`;

export const SPLAT_VERTEX = /* glsl */ `
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

/** Shared helpers + uniforms; the rock material includes these too. */
export const SPLAT_FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray tTerrainAlbedo;
uniform highp sampler2DArray tTerrainNormal;
uniform highp sampler2DArray tTerrainArmh;
uniform sampler2D tTerrainSplatA;
uniform sampler2D tTerrainSplatB;
uniform vec4 uTerrainExtent;
uniform float uLayerTile[6];
uniform float uHeightBlend;
uniform float uFarBlend;

float berkHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float berkNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = berkHash12(i);
  float b = berkHash12(i + vec2(1.0, 0.0));
  float c = berkHash12(i + vec2(0.0, 1.0));
  float d = berkHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec3 berkTriBlend(vec3 n) {
  vec3 b = pow(abs(n), vec3(4.0));
  return b / (b.x + b.y + b.z);
}
// Whiteout blend of a top-projected (uv = world xz) tangent-space normal onto the geometric normal n.
vec3 berkWhiteoutY(vec3 tn, vec3 n) {
  return normalize(vec3(tn.x + n.x, abs(tn.z) * n.y, tn.y + n.z));
}
// Triplanar sample: uvX = zy, uvY = xz, uvZ = xy, mirrored on the negative-facing sides.
vec4 berkTriSample(highp sampler2DArray tex, float layer, vec3 p, vec3 n, vec3 blend, float s) {
  vec3 sg = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  return texture(tex, vec3(vec2(p.z * sg.x, p.y) * s, layer)) * blend.x
       + texture(tex, vec3(vec2(p.x * sg.y, p.z) * s, layer)) * blend.y
       + texture(tex, vec3(vec2(p.x * sg.z, p.y) * s, layer)) * blend.z;
}
// Triplanar normal in Golus' whiteout form, same projections as berkTriSample.
vec3 berkTriNormal(float layer, vec3 p, vec3 n, vec3 blend, float s) {
  vec3 sg = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  vec3 tx = texture(tTerrainNormal, vec3(vec2(p.z * sg.x, p.y) * s, layer)).xyz * 2.0 - 1.0;
  vec3 ty = texture(tTerrainNormal, vec3(vec2(p.x * sg.y, p.z) * s, layer)).xyz * 2.0 - 1.0;
  vec3 tz = texture(tTerrainNormal, vec3(vec2(p.x * sg.z, p.y) * s, layer)).xyz * 2.0 - 1.0;
  tx.x *= sg.x;
  ty.x *= sg.y;
  tz.x *= sg.z;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * blend.x + ty.xzy * blend.y + tz.xyz * blend.z);
}
`;

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
varying vec3 vTerrainPos;
varying vec3 vTerrainNrm;
`;

/**
 * Replaces <map_fragment>: the six-layer, height-blended splat (spec §7.3). Pass 1 reads armh (AO, roughness,
 * height) for the height blend; pass 2 samples albedo + normal only for layers that survive it. Rock (layer 5) is
 * triplanar on High. Leaves tAlb / tNrmW / tRough / tAO for the replaced chunks below.
 */
export const SPLAT_MAP_FRAGMENT = /* glsl */ `
vec3 tAlb = vec3(0.0);
vec3 tNrmW = vec3(0.0, 1.0, 0.0);
float tRough = 0.9;
float tAO = 1.0;
{
  vec3 p = vTerrainPos;
  vec3 n = normalize(vTerrainNrm);
  vec2 suv = (p.xz - uTerrainExtent.xy) * uTerrainExtent.zw;
  vec4 sa = texture(tTerrainSplatA, suv);
  vec4 sb = texture(tTerrainSplatB, suv);
  float w[6];
  w[0] = sa.r; w[1] = sa.g; w[2] = sa.b; w[3] = sa.a; w[4] = sb.r; w[5] = sb.g;
  float wet = sb.b;
  float bakedAO = sb.a;
  #ifdef TERRAIN_LOW
    float farT = 0.0;
    vec3 triB = vec3(0.0, 1.0, 0.0);
  #else
    float farT = smoothstep(uFarBlend, uFarBlend * 2.5, length(p - cameraPosition));
    vec3 triB = berkTriBlend(n);
  #endif
  vec3 armh[6];
  float hmax = -1.0;
  for (int i = 0; i < 6; i++) {
    armh[i] = vec3(1.0, 0.8, 0.5);
    if (w[i] < 0.004) continue;
    float s = 1.0 / uLayerTile[i];
    #ifndef TERRAIN_LOW
    if (i == 5) armh[i] = berkTriSample(tTerrainArmh, 5.0, p, n, triB, s).rgb;
    else
    #endif
    armh[i] = texture(tTerrainArmh, vec3(p.xz * s, float(i))).rgb;
    hmax = max(hmax, armh[i].b + w[i]);
  }
  float bw[6];
  float bsum = 0.0;
  for (int i = 0; i < 6; i++) {
    bw[i] = w[i] < 0.004 ? 0.0 : max(armh[i].b + w[i] - hmax + uHeightBlend, 0.0);
    bsum += bw[i];
  }
  vec3 nAcc = vec3(0.0);
  vec2 ar = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float b = bw[i] / max(bsum, 1e-4);
    if (b <= 0.0) continue;
    float s = 1.0 / uLayerTile[i];
    vec3 alb;
    vec3 tnW;
    #ifndef TERRAIN_LOW
    if (i == 5) {
      alb = berkTriSample(tTerrainAlbedo, 5.0, p, n, triB, s).rgb;
      if (farT > 0.0) alb = mix(alb, berkTriSample(tTerrainAlbedo, 5.0, p, n, triB, s * 0.23).rgb, farT);
      tnW = berkTriNormal(5.0, p, n, triB, s);
    } else
    #endif
    {
      vec2 uv = p.xz * s;
      alb = texture(tTerrainAlbedo, vec3(uv, float(i))).rgb;
      if (farT > 0.0) alb = mix(alb, texture(tTerrainAlbedo, vec3(uv * 0.23, float(i))).rgb, farT);
      vec3 tn = texture(tTerrainNormal, vec3(uv, float(i))).xyz * 2.0 - 1.0;
      tn.xy *= 1.0 - 0.7 * farT;
      tnW = berkWhiteoutY(tn, n);
    }
    tAlb += alb * b;
    nAcc += tnW * b;
    ar += armh[i].rg * b;
  }
  tNrmW = normalize(nAcc + n * 1e-4);
  float macro = berkNoise2(p.xz / 38.0) * 0.6 + berkNoise2(p.xz / 11.0) * 0.4;
  tAlb *= mix(vec3(0.86, 0.9, 0.84), vec3(1.1, 1.06, 1.0), macro);
  tAlb *= mix(1.0, 0.55, wet);
  tRough = mix(ar.y, 0.22, wet * 0.8);
  tAO = ar.x * mix(1.0, bakedAO, 0.85);
  diffuseColor.rgb = tAlb * diffuse;
}
`;

export const SPLAT_ROUGHNESS = /* glsl */ `float roughnessFactor = tRough;`;
export const SPLAT_METALNESS = /* glsl */ `float metalnessFactor = 0.0;`;
export const SPLAT_NORMAL = /* glsl */ `normal = normalize((viewMatrix * vec4(tNrmW, 0.0)).xyz);`;
export const SPLAT_AO = /* glsl */ `
{
  float ambientOcclusion = tAO;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}
`;

const VERTEX_ANCHORS = ['#include <common>', '#include <begin_vertex>'];
const FRAGMENT_ANCHORS = [
  '#include <common>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>',
  '#include <normal_fragment_maps>', '#include <aomap_fragment>',
];

/** Patches a MeshStandardMaterial program with the terrain splat. Throws if three's chunk anchors moved. */
export function patchSplatShader(shader: ShaderParams, uniforms: SplatUniforms): void {
  for (const a of VERTEX_ANCHORS) if (!shader.vertexShader.includes(a)) throw new Error(`terrain splat: vertex anchor missing: ${a}`);
  for (const a of FRAGMENT_ANCHORS) if (!shader.fragmentShader.includes(a)) throw new Error(`terrain splat: fragment anchor missing: ${a}`);
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', () => `#include <common>\n${SPLAT_VERTEX_PARS}`)
    .replace('#include <begin_vertex>', () => `#include <begin_vertex>\n${SPLAT_VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', () => `#include <common>\n${SPLAT_FRAGMENT_PARS}\n${TERRAIN_FRAGMENT_PARS}`)
    .replace('#include <map_fragment>', () => SPLAT_MAP_FRAGMENT)
    .replace('#include <roughnessmap_fragment>', () => SPLAT_ROUGHNESS)
    .replace('#include <metalnessmap_fragment>', () => SPLAT_METALNESS)
    .replace('#include <normal_fragment_maps>', () => SPLAT_NORMAL)
    .replace('#include <aomap_fragment>', () => SPLAT_AO);
}

/** The terrain material: MeshStandardMaterial + the splat hook. `low` drops triplanar rock and far-scale blending. */
export function createSplatMaterial(uniforms: SplatUniforms, low: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'terrain', color: 0xffffff, roughness: 1, metalness: 0 });
  if (low) m.defines = { ...(m.defines ?? {}), TERRAIN_LOW: '' };
  addCompileHook(m, 'terrainSplat', (shader) => patchSplatShader(shader, uniforms));
  return m;
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/world` → the splat suite (5 tests) passes and the terrain suite still passes. `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `feat(cove): six-layer height-blended splat material with triplanar rock`.

---

### Task 8: Terrain in the engine — `createCove` v1 and the Cove preview page

**Files:**
- Create: `src/world/terrain/terrain.ts`, `tests/world/terrainRuntime.test.ts`, `src/world/cove/cove.ts`, `src/dev/cove/main.ts`, `cove.html`, `docs/progress/img/cove/m7-terrain-{wide,rim,floor,shadow}.png`
- Modify: `vite.config.ts` (add the `cove` page input)

**Interfaces:**
- Consumes: Tasks 5–7; Plan 1's `App`/`createApp` (with the hardening wave's `App.remove`) and `debug`.
- Produces:
  - `terrain.ts`: `TERRAIN_LOD_DISTANCES = [70, 140, 240]`, `class Terrain { root; collisionRoot; hf; material; constructor(hf, material, lodDistanceScale = 1, skirtDepth = 1.5); update(camera); enableLayerIn(layer, rect) → number; stats() → { lods; triangles }; dispose() }`.
  - `cove.ts`:
    - `interface CoveOptions { baseUrl? }`
    - `class CoveRegion implements Region`:
      - state: `root; baseUrl; header; hf; terrain; splat; layers; heightTexture; capsules; low`
      - composition: `add(object)`, `addCollision(root)`, `onUpdate(fn)`, `onDispose(fn)`
      - the Region contract: `heightAt`, `normalAt`, `collisionRoots()`, `treeCapsules()`, `update(dt, ctx)`, `dispose()`
    - `createCove(app, opts?) → Promise<CoveRegion>` resolves after `renderer.compileAsync`. Tasks 11–13 add the rocks, pond and backdrop.
  - The Cove preview page `cove.html`, with debug `berk.cam.preset(wide|rim|floor|pond|gully|shadow|outward)`, `berk.cove.{region, stats, heightAt}`.

- [ ] **Step 1: Write the failing test**

`tests/world/terrainRuntime.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Terrain, TERRAIN_LOD_DISTANCES } from '../../src/world/terrain/terrain';
import { bumpy } from './terrainFixtures';

describe('Terrain', () => {
  const hf = bumpy(481); // 3 × 3 chunks of 160 cells
  const terrain = new Terrain(hf, new THREE.MeshBasicMaterial());
  const cam = new THREE.PerspectiveCamera();

  it('builds every chunk at the coarsest LOD, then refines near the camera', () => {
    expect(terrain.root.children).toHaveLength(9);
    expect(terrain.stats().lods.every((l) => l === 3)).toBe(true);
    cam.position.set(hf.coord(20), 10, hf.coord(20)); // over the first chunk
    cam.updateMatrixWorld();
    terrain.update(cam);
    const lods = terrain.stats().lods;
    expect(lods[0]).toBe(0);
    expect(Math.max(...lods)).toBeGreaterThan(0); // the far corner stays coarser
    expect(TERRAIN_LOD_DISTANCES).toEqual([70, 140, 240]);
  });

  it('marks the chunks under a rectangle with a render layer', () => {
    const n = terrain.enableLayerIn(5, [hf.coord(10), hf.coord(10), hf.coord(30), hf.coord(30)]);
    expect(n).toBe(1);
    expect(terrain.root.children[0].layers.isEnabled(5)).toBe(true);
    expect(terrain.root.children[4].layers.isEnabled(5)).toBe(false);
  });

  it('keeps its collision root out of the scene graph', () => {
    expect(terrain.collisionRoot.parent).toBeNull();
    expect(terrain.collisionRoot.getObjectByName('terrain-collision')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/world/terrainRuntime` → module not found.

- [ ] **Step 3: Implement**

`src/world/terrain/terrain.ts`:
```ts
import * as THREE from 'three';
import type { Heightfield } from './heightfield';
import { buildChunkGeometry, chunkBounds, chunkGrid, LOD_STEPS, selectLod, type ChunkCoord } from './chunks';
import { terrainCollisionRoot } from './collisionMesh';

/** LOD k is used up to lodDistances[k] metres (× the preset's lodDistanceScale); beyond the last, the coarsest. */
export const TERRAIN_LOD_DISTANCES = [70, 140, 240] as const;

interface ChunkState {
  coord: ChunkCoord;
  mesh: THREE.Mesh;
  box: THREE.Box3;
  lod: number;
  geos: (THREE.BufferGeometry | null)[];
}

/**
 * The rendered terrain: 7 × 7 chunk meshes sharing one splat material, each swapping between four LOD geometries
 * (built lazily and cached) by camera distance, plus the invisible collision root.
 */
export class Terrain {
  readonly root = new THREE.Group();
  readonly collisionRoot: THREE.Object3D;
  private readonly chunks: ChunkState[] = [];
  private readonly thresholds: number[];
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly hf: Heightfield,
    readonly material: THREE.Material,
    lodDistanceScale = 1,
    readonly skirtDepth = 1.5,
  ) {
    this.root.name = 'Terrain';
    this.thresholds = TERRAIN_LOD_DISTANCES.map((d) => d * lodDistanceScale);
    for (const coord of chunkGrid(hf.size)) {
      const box = chunkBounds(hf, coord);
      // start every chunk at the coarsest LOD (cheap), so no mesh ever has an empty geometry
      const coarsest = LOD_STEPS.length - 1;
      const geos: (THREE.BufferGeometry | null)[] = LOD_STEPS.map(() => null);
      geos[coarsest] = buildChunkGeometry(hf, coord, LOD_STEPS[coarsest], skirtDepth * LOD_STEPS[coarsest]);
      const mesh = new THREE.Mesh(geos[coarsest]!, material);
      mesh.name = `terrain_${coord.cx}_${coord.cz}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.chunks.push({ coord, mesh, box, lod: coarsest, geos });
    }
    this.collisionRoot = terrainCollisionRoot(hf);
  }

  /** Picks each chunk's LOD from the camera distance to its bounds (hysteresis inside selectLod). */
  update(camera: THREE.Camera): void {
    const cam = camera.getWorldPosition(this.tmp);
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(cam);
      const lod = selectLod(d, c.lod, this.thresholds);
      if (lod === c.lod) continue;
      let g = c.geos[lod];
      if (!g) {
        g = buildChunkGeometry(this.hf, c.coord, LOD_STEPS[lod], this.skirtDepth * LOD_STEPS[lod]);
        c.geos[lod] = g;
      }
      c.mesh.geometry = g;
      c.lod = lod;
    }
  }

  /** Enables render `layer` on every chunk whose bounds overlap the world rectangle [x0, z0, x1, z1]. */
  enableLayerIn(layer: number, rect: readonly [number, number, number, number]): number {
    let n = 0;
    for (const c of this.chunks) {
      if (c.box.max.x < rect[0] || c.box.min.x > rect[2] || c.box.max.z < rect[1] || c.box.min.z > rect[3]) continue;
      c.mesh.layers.enable(layer);
      n++;
    }
    return n;
  }

  /** Current LOD per chunk and the triangles they draw (for perf readouts and tests). */
  stats(): { lods: number[]; triangles: number } {
    let triangles = 0;
    for (const c of this.chunks) {
      const idx = c.mesh.geometry.index;
      if (idx) triangles += idx.count / 3;
    }
    return { lods: this.chunks.map((c) => c.lod), triangles };
  }

  dispose(): void {
    for (const c of this.chunks) for (const g of c.geos) g?.dispose();
    this.root.removeFromParent();
    this.collisionRoot.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
```

`src/world/cove/cove.ts`:
```ts
import * as THREE from 'three';
import type { App } from '../../app/createApp';
import type { InterestPoint, Region, RegionUpdateContext, SpawnPoint, TreeCapsule } from '../region';
import { Heightfield, type TerrainHeader } from '../terrain/heightfield';
import { Terrain } from '../terrain/terrain';
import { COVE_LAYERS, loadLayerArrays, loadSplatTexture, type LayerArrays } from '../terrain/layers';
import { createSplatMaterial, createSplatUniforms, type SplatUniforms } from '../terrain/splatShader';
import { createHeightTexture, terrainUvTransform } from '../terrain/heightTexture';

export interface CoveOptions {
  /** Where `world/cove/` and `textures/terrain/` live (relative URLs resolve from every page). */
  baseUrl?: string;
}

type Updater = (dt: number, ctx: RegionUpdateContext) => void;

/**
 * The Cove region (spec §7). Built by `createCove`; its parts (rocks, pond, backdrop, M7b vegetation and life)
 * attach through `add`, `addCollision`, `onUpdate` and `onDispose`, so the region stays the single owner of
 * everything it puts in the scene.
 */
export class CoveRegion implements Region {
  readonly id = 'cove';
  readonly bounds: THREE.Box3;
  readonly transform = new THREE.Matrix4();
  readonly spawnPoints: readonly SpawnPoint[];
  readonly interestPoints: InterestPoint[] = [];
  readonly root = new THREE.Group();
  readonly heightTexture: THREE.DataTexture;
  readonly capsules: TreeCapsule[] = [];
  /** Low preset: cheaper shader variants (no triplanar rock, no rock ground blend). */
  readonly low: boolean;
  private readonly collision: THREE.Object3D[] = [];
  private readonly updaters: Updater[] = [];
  private readonly disposers: Array<() => void> = [];

  constructor(
    readonly app: App,
    readonly baseUrl: string,
    readonly header: TerrainHeader,
    readonly hf: Heightfield,
    readonly terrain: Terrain,
    readonly splat: SplatUniforms,
    readonly layers: LayerArrays,
  ) {
    this.root.name = 'Cove';
    this.low = app.preset.name === 'low';
    const half = ((hf.size - 1) * hf.spacing) / 2;
    this.bounds = new THREE.Box3(new THREE.Vector3(-half, header.stats.heightMin ?? -8, -half), new THREE.Vector3(half, header.stats.heightMax ?? 72, half));
    this.spawnPoints = header.spawn.map((s) => ({ ...s }));
    this.heightTexture = createHeightTexture(hf);
    this.interestPoints.push({ id: 'pond', kind: 'water', position: new THREE.Vector3(header.pond.cx, header.waterLevel, header.pond.cz), weight: 0.3 });
    this.root.add(terrain.root);
    this.disposers.push(() => {
      terrain.dispose();
      terrain.material.dispose();
      layers.dispose();
      this.heightTexture.dispose();
      splat.tTerrainSplatA.value?.dispose();
      splat.tTerrainSplatB.value?.dispose();
    });
  }

  heightAt(x: number, z: number): number {
    return this.hf.heightAt(x, z);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.hf.normalAt(x, z, out);
  }

  collisionRoots(): THREE.Object3D[] {
    return [this.terrain.collisionRoot, ...this.collision];
  }

  treeCapsules(): readonly TreeCapsule[] {
    return this.capsules;
  }

  /** Adds a render subtree: every material goes through the app pipeline (CSM + fog). */
  add(object: THREE.Object3D): void {
    this.app.materials.prepareTree(object);
    this.root.add(object);
  }

  /** Adds an invisible collision subtree (world-space meshes; never rendered). */
  addCollision(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    this.collision.push(root);
  }

  onUpdate(fn: Updater): void {
    this.updaters.push(fn);
  }

  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  update(dt: number, ctx: RegionUpdateContext): void {
    this.terrain.update(ctx.camera);
    for (const u of this.updaters) u(dt, ctx);
  }

  dispose(): void {
    for (const d of this.disposers.splice(0).reverse()) d();
    this.app.remove(this.root);
  }
}

/**
 * Loads and assembles the Cove (so far: the terrain), adds it to the app, sets the golden-hour sun and compiles every
 * shader before resolving (so the first frames don't hitch). Tasks 11–13 add the rocks, the pond and the backdrop.
 */
export async function createCove(app: App, opts: CoveOptions = {}): Promise<CoveRegion> {
  const base = opts.baseUrl ?? 'assets/';
  const header = (await (await fetch(`${base}world/cove/terrain.json`)).json()) as TerrainHeader;
  const low = app.preset.name === 'low';
  const [heightBuf, layers, splatA, splatB] = await Promise.all([
    fetch(`${base}world/cove/${header.files.height}`).then((r) => r.arrayBuffer()),
    loadLayerArrays(`${base}textures/terrain/`, COVE_LAYERS, low ? 512 : 1024),
    loadSplatTexture(`${base}world/cove/${header.files.splatA}`),
    loadSplatTexture(`${base}world/cove/${header.files.splatB}`),
  ]);
  const hf = Heightfield.fromUint16LE(header, heightBuf);
  const splat = createSplatUniforms();
  splat.tTerrainAlbedo.value = layers.albedo;
  splat.tTerrainNormal.value = layers.normal;
  splat.tTerrainArmh.value = layers.armh;
  splat.tTerrainSplatA.value = splatA;
  splat.tTerrainSplatB.value = splatB;
  terrainUvTransform(hf, splat.uTerrainExtent.value);
  const terrain = new Terrain(hf, createSplatMaterial(splat, low), app.preset.lodDistanceScale);
  const cove = new CoveRegion(app, base, header, hf, terrain, splat, layers);
  app.materials.prepareTree(cove.root);
  app.scene.add(cove.root);
  app.setSun(header.sun.azimuth, header.sun.elevation);
  await app.renderer.compileAsync(app.scene, app.camera);
  return cove;
}
```

`src/dev/cove/main.ts`:
```ts
import '../../styles.css';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createApp } from '../../app/createApp';
import { createCove, type CoveRegion } from '../../world/cove/cove';
import { debug } from '../../core/debug';

/** Cove preview (dev page): orbit camera, fixed QA camera presets, perf readout. */
const app = createApp(document.getElementById('app')!);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
controls.maxDistance = 900;
const hud = document.getElementById('hud')!;
hud.textContent = 'Cove preview · loading…';

/** Spec §8.4 camera set (without Toothless): [position, target]. */
const COVE_CAMERAS: Record<string, [number, number, number, number, number, number]> = {
  wide: [-95, 48, -30, 5, 0, 5],
  rim: [46, 31, 12, -6, 0, -2],
  floor: [-26, 3.2, -16, -8, 1.2, -4],
  pond: [-8, 2.4, 16, 12, -0.3, 4],
  gully: [-70, 22, -22, -20, 2, -6],
  shadow: [0, 95, 70, 0, 0, 0],
  outward: [30, 40, 35, -160, 20, -60],
};

const setCam = (name: string) => {
  const p = COVE_CAMERAS[name];
  if (!p) return Object.keys(COVE_CAMERAS);
  app.camera.position.set(p[0], p[1], p[2]);
  controls.target.set(p[3], p[4], p[5]);
  controls.update();
  return name;
};
setCam('wide');
app.loop.addRender(() => controls.update(), 0);

let cove: CoveRegion | null = null;
debug.register('cam', { preset: setCam });
hud.textContent = 'Cove preview · loading and compiling shaders…';
createCove(app)
  .then((c) => {
    cove = c;
    app.loop.addRender((_alpha, frameDt) => c.update(frameDt, { time: app.loop.simTime, camera: app.camera, interactions: [] }), 10);
    debug.register('cove', {
      region: () => cove,
      stats: () => ({ terrain: c.terrain.stats(), collisionRoots: c.collisionRoots().length, spawn: c.spawnPoints[0] }),
      heightAt: (x: number, z: number) => c.heightAt(x, z),
    });
    hud.textContent = `Cove preview · quality: ${app.preset.name} · berk.cam.preset(${Object.keys(COVE_CAMERAS).join('|')})`;
    (window as unknown as { __coveReady: boolean }).__coveReady = true;
  })
  .catch((e) => {
    console.error('[cove] failed to load', e);
    hud.textContent = 'Cove failed to load — see the console';
  });
app.loop.start();
```

`cove.html` is a copy of `lab.html` with two changes: the title is `Isle of Berk — Cove Preview`, and the script is `/src/dev/cove/main.ts`.

`vite.config.ts`: add `cove: resolve(import.meta.dirname, 'cove.html'),` to `build.rolldownOptions.input`.

- [ ] **Step 4: Tests and typecheck** — `npm test` all pass (terrainRuntime: 3); `npm run typecheck` clean.

- [ ] **Step 5: Visual check in the browser**
  - Start `npm run dev` in the background (port 5190). Open `http://localhost:5190/cove.html?q=high` in the chrome-devtools browser.
  - The HUD reads "loading and compiling shaders…" until `window.__coveReady` is true. Then `list_console_messages`: no errors.
  - For each of `wide`, `rim`, `floor` and `shadow`: `evaluate_script` `berk.cam.preset('<name>')`, wait ~3 s, then `take_screenshot` to `docs/progress/img/cove/m7-terrain-<name>.png`. Read each one.

  Checks:
  - **Shape:** the round hollow reads clearly, with its steep rock ring (triplanar rock, no stretched texture on the walls), the pond basin, the gully to the WNW and the terrace steps at the NNW rim.
  - **Ground layers:**
    - the floor is grassy green-brown
    - the pond bed and shore are pebbles and mud; the wall foot is mossy
    - the ground outside the rim is forest floor
    - no visible tiling grid at mid distance, and no vertical striping on the walls (far-scale blend and macro noise)
  - **Light:** about half the floor is in warm sun through the gully and half in cool shadow; the shadows are crisp and don't swim when the camera moves.
  - **LOD seams:** no cracks or popping at chunk edges while orbiting (skirts, hysteresis).

  Then:
  - Run `evaluate_script` → `berk.cove.stats()` and `berk.perf(30)`, at `?q=high` and at `?q=low`. Record the numbers in the report: terrain triangles, draw calls, ms per frame.
  - Budget: the terrain alone should stay under ~800 k triangles at the `wide` preset.
  - Stop only your dev server.

- [ ] **Step 6: Commit** — the terrain, its test, the region, the preview page, the vite config and the four captures. Message: `feat(cove): terrain in the engine — createCove v1 and the Cove preview page`.

---

### Task 9: The rock kit — Poly Haven scans processed in Blender

**Needs Plan 2's Blender runner and library.** Merge `phase1-toothless` into `phase1-cove` first (or rebase onto `phase1-slice` after Plan 2 has merged there). That provides `pipeline/blender/run.ps1`, `lib/{scene,meshtools,qa_render}.py` and `npm run blender:test`.

**Files:**
- Create: `pipeline/blender/cove/rocks.py`, `pipeline/blender/cove/rock_kit.json`, `pipeline/blender/cove/rocks_qa.py`, `pipeline/blender/tests/test_rocks.py`
- Modify: `pipeline/cc0/wanted.json` (seven model entries), `package.json` (scripts `cove:rocks`, `cove:rocks-qa`)
- Output (committed): `public/assets/world/cove/rocks/{<id>.glb, <id>.col.glb, kit.json}`, `docs/progress/img/cove/rocks-kit-{front,top}.png`, `pipeline/cc0/manifest.json`, `CREDITS.md`

**Interfaces:**
- Consumes: Plan 2 `lib/scene.py` (`reset`, `purge_orphans`), `lib/meshtools.py` (`select_only`), `lib/qa_render.py` (`setup_clay`, `shoot`); Plan 1's CC0 fetch.
- Produces:
  - `kit.json`: `{ version: 1, pieces: KitPiece[] }`. `KitPiece` has:
    - `name`, `source`, `role` (`wall` | `ledge` | `boulder`)
    - `size` [w, h, d]; `base` (height of the front face's bottom edge above the origin); `tris` [LOD0, LOD1, LOD2]; `colTris`
    - `ao` (the source's metallic-roughness texture is an ARM map, so its red channel is AO)
    - `file`, `colFile`
  - Per source `<id>.glb`: nodes `<piece>_LOD0/1/2`, one material (scan albedo, the ARM or roughness map, a **baked** tangent normal map), WebP textures via `EXT_texture_webp`.
  - `<id>.col.glb`: nodes `<piece>_col`, positions only.
  - Piece frame: **front face toward +Z (three.js), origin at the bottom centre**, metres.

The kit (spec §7.4 candidates; ids verified on the live API, 2026-09-27):

| Source | Role | Split | LOD0 tris | Why |
|---|---|---|---|---|
| `coastal_cliff_01` (92 × 10 × 11 m scan) | wall | 6 segments, keep the middle three | 30 k | layered cliff faces. The end segments taper (their front starts 4.5–5.6 m up), so they are dropped. |
| `coastal_cliff_02` (41 × 10 × 9 m) | wall | 3 segments | 36 k | a second cliff face, flat base (0.7–1.1 m) |
| `rock_face_01`, `rock_face_02` | ledge | whole | 12 k | outcrops: the upper tier, gully and route flanks, narrow gaps |
| `boulder_01` | boulder | whole | 6 k | floor and pond boulders |
| `rock_moss_set_01`, `rock_moss_set_02` | boulder | one piece per scan node | 3 k | mossy talus and bank rocks |

`coastal_cliff_04` (86 × 11 × 24 m) was tried and rejected: it is a sloping shore shelf, not a face. Poly Haven's listed dimensions are unreliable for some scans (`rock_face_02` imports at 2.7 × 2.5 × 2.1 m against a listed 4.9 × 3.5 × 4.7), so every size comes from the imported mesh.

- [ ] **Step 1: Write the failing Blender tests**

`pipeline/blender/tests/test_rocks.py`:
```python
import math
import os
import sys
import unittest

import bmesh
import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cove"))
import rocks as R  # noqa: E402
import scene as SC  # noqa: E402


def grid_wall(name, width=20.0, height=8.0, step=0.5, face_dir=+1, lift=None):
    """A vertical grid wall in the XZ plane (y = 0) whose face points +Y (face_dir=+1) or −Y. `lift(x, z) → z`
    optionally reshapes it (e.g. a raised bottom edge)."""
    nx = int(round(width / step))
    nz = int(round(height / step))
    bm = bmesh.new()
    verts = []
    for j in range(nz + 1):
        for i in range(nx + 1):
            x = -width / 2 + i * step
            z = j * step
            verts.append(bm.verts.new((x, 0.0, lift(x, z) if lift else z)))
    for j in range(nz):
        for i in range(nx):
            a = verts[j * (nx + 1) + i]
            b = verts[j * (nx + 1) + i + 1]
            c = verts[(j + 1) * (nx + 1) + i + 1]
            d = verts[(j + 1) * (nx + 1) + i]
            bm.faces.new((a, d, c, b) if face_dir > 0 else (a, b, c, d))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


class RockKitTests(unittest.TestCase):
    def setUp(self):
        SC.reset()

    def test_slab_keeps_the_range_and_drops_fragments(self):
        wall = grid_wall("wall")
        bm = bmesh.new()
        bm.from_mesh(wall.data)
        bmesh.ops.create_cube(bm, size=0.05, matrix=Matrix.Translation((3.0, 5.0, 1.0)))  # a detached speck
        bm.to_mesh(wall.data)
        bm.free()
        s = R.slab(wall, "s", 0, -5.0, 5.0, 0.05)
        xs = [v.co.x for v in s.data.vertices]
        self.assertGreaterEqual(min(xs), -5.0 - 1e-4)
        self.assertLessEqual(max(xs), 5.0 + 1e-4)
        self.assertLess(max(abs(v.co.y) for v in s.data.vertices), 1e-4)  # the speck at y = 5 is gone

    def test_orient_turns_the_face_to_minus_y_with_the_origin_at_the_bottom_centre(self):
        wall = grid_wall("wall", face_dir=+1)
        self.assertGreater(R.steep_normal(wall)[1], 0)
        R.apply_matrix(wall, R.orient_matrix(wall, keep_axis=True))
        self.assertLess(R.steep_normal(wall)[1], 0)
        vs = [v.co for v in wall.data.vertices]
        self.assertAlmostEqual(min(v.z for v in vs), 0.0, places=4)
        self.assertAlmostEqual((min(v.x for v in vs) + max(v.x for v in vs)) / 2, 0.0, places=4)
        self.assertEqual(R.dims(wall)[:2], [20.0, 8.0])

    def test_orient_turns_a_whole_piece_to_its_face_normal(self):
        wall = grid_wall("wall", face_dir=+1)
        wall.data.transform(Matrix.Rotation(math.radians(30), 4, "Z"))
        R.apply_matrix(wall, R.orient_matrix(wall, keep_axis=False))
        nx, ny = R.steep_normal(wall)
        self.assertAlmostEqual(math.degrees(math.atan2(nx, -ny)), 0.0, places=3)

    def test_front_base_measures_a_raised_front_edge(self):
        # the right half's face starts 2 m up (a tapering scan end): 90th percentile of the column minima = 2
        wall = grid_wall("wall", face_dir=-1, lift=lambda x, z: max(z, 2.0) if x > 0.25 else z)
        self.assertAlmostEqual(R.front_base(wall), 2.0, places=3)
        flat = grid_wall("flat", face_dir=-1)
        self.assertAlmostEqual(R.front_base(flat), 0.0, places=3)

    def test_decimate_hits_the_target(self):
        wall = grid_wall("wall", step=0.25)
        low = R.decimate_to(wall, "low", 800)
        self.assertTrue(700 <= R.tris(low) <= 820, R.tris(low))
        self.assertEqual(R.tris(R.decimate_to(low, "same", 10_000)), R.tris(low))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify they fail** — `npm run blender:test` → `ModuleNotFoundError: No module named 'rocks'` (Plan 2's tests still pass).

- [ ] **Step 3: Implement**

`pipeline/blender/cove/rocks.py`:
```python
"""Cove rock kit (spec §7.4): Poly Haven rock scans → game-ready pieces.

For every source in rock_kit.json:
  1. import the cached glTF scan (pipeline/cc0/cache/<id>/<id>_<res>.gltf)
  2. split it into pieces: `segments` (N slabs along the long axis, optionally only the `keep` ones), `nodes` (one
     per scan object) or `whole`
  3. per piece: decimate LOD0, bake a high→LOD0 tangent-space normal map from the FULL scan into one image shared by
     the source's pieces, decimate LOD1/LOD2 and a collision mesh from LOD0
  4. orient each piece: front face → Blender −Y (three.js +Z), origin at the bottom centre
  5. export <id>.glb (every piece's LODs, one material, WebP textures) and <id>.col.glb (collision only)
Then merge the pieces' records into kit.json.

Usage: run.ps1 pipeline/blender/cove/rocks.py [--only <id>] [--kit <json>] [--cache <dir>] [--out <dir>]
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import meshtools as MT  # noqa: E402
import scene as SC  # noqa: E402

T0 = time.time()


def log(*a):
    print("[rocks]", *a, f"({time.time() - T0:.1f}s)", flush=True)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def deselect_all():
    for o in bpy.context.scene.objects:
        o.select_set(False)


def import_source(path):
    """Fresh scene + the glTF scan; returns its mesh objects, unparented, with transforms applied."""
    SC.reset()
    # merge_vertices: Poly Haven scans arrive split along every UV seam, which stalls collapse decimation
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{path}: no meshes")
    deselect_all()
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in bpy.context.scene.objects if o.type != "MESH"]:
        bpy.data.objects.remove(o)
    for o in meshes:  # some scans (boulder_01) are near-soup: 24k islands until welded at 0.1 mm
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.to_mesh(o.data)
        bm.free()
    return meshes


def join(objs, name):
    deselect_all()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    return ob


def copy_object(src, name):
    ob = src.copy()
    ob.data = src.data.copy()
    ob.name = ob.data.name = name
    bpy.context.scene.collection.objects.link(ob)
    return ob


def drop_fragments(bm, frac):
    """Deletes connected islands smaller than `frac` of the faces (slivers a cut leaves behind)."""
    bm.faces.ensure_lookup_table()
    bm.faces.index_update()
    seen = set()
    doomed = []
    total = len(bm.faces)
    for f in bm.faces:
        if f.index in seen:
            continue
        comp = [f]
        seen.add(f.index)
        k = 0
        while k < len(comp):
            for e in comp[k].edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        comp.append(h)
            k += 1
        if len(comp) < frac * total:
            doomed.extend(comp)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")


def slab(src, name, axis, lo, hi, fragment_frac=0.01):
    """Copy of `src` cut to lo ≤ co[axis] ≤ hi (open cut faces, small detached fragments dropped)."""
    ob = copy_object(src, name)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n = Vector((0.0, 0.0, 0.0))
    n[axis] = 1.0
    co = Vector((0.0, 0.0, 0.0))
    co[axis] = lo
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=n, clear_inner=True)
    co[axis] = hi
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=n, clear_outer=True)
    drop_fragments(bm, fragment_frac)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def decimate_to(src, name, target):
    """Collapse-decimated, triangulated copy of `src` with ≈ `target` triangles (never more than it has)."""
    ob = copy_object(src, name)
    ratio = min(1.0, target / max(1, tris(src)))
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    MT.select_only(ob)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def steep_normal(ob):
    """Area-weighted horizontal normal of the steep faces (|n.z| < 0.5): the direction the rock face looks."""
    nx = ny = 0.0
    for p in ob.data.polygons:
        if abs(p.normal.z) < 0.5:
            nx += p.normal.x * p.area
            ny += p.normal.y * p.area
    return nx, ny


def orient_matrix(ob, keep_axis):
    """Rotation about Z turning the rock face to −Y (three.js +Z), then the bottom centre to the origin. Segments
    keep their long axis on X and only flip; other pieces turn to their steep-face normal."""
    nx, ny = steep_normal(ob)
    if keep_axis:
        ang = math.pi if ny > 0 else 0.0
    else:
        ang = (-math.pi / 2 - math.atan2(ny, nx)) if math.hypot(nx, ny) > 1e-9 else 0.0
    rot = Matrix.Rotation(ang, 4, "Z")
    pts = [rot @ v.co for v in ob.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    return Matrix.Translation(-centre) @ rot


def trim_depth(piece, max_depth):
    """Keeps the front `max_depth` metres of a wall segment (shore-cliff scans run 20+ m back from the face)."""
    name = piece.name
    _, ny = steep_normal(piece)
    ys = sorted(v.co.y for v in piece.data.vertices)
    if ny <= 0:
        yf = ys[int(0.02 * (len(ys) - 1))]
        lo, hi = yf - 1.0, yf + max_depth
    else:
        yf = ys[int(0.98 * (len(ys) - 1))]
        lo, hi = yf - max_depth, yf + 1.0
    cut = slab(piece, name + "_trim", 1, lo, hi, 0.05)
    bpy.data.objects.remove(piece)
    cut.name = cut.data.name = name
    return cut


def apply_matrix(ob, m):
    ob.data.transform(m)
    ob.data.update()


def dims(ob):
    """[width x, height z, depth y] in metres — three.js [x, y, z] extents after the glTF Y-up export."""
    vs = [v.co for v in ob.data.vertices]
    return [round(max(v[i] for v in vs) - min(v[i] for v in vs), 3) for i in (0, 2, 1)]


def front_base(ob, bin_width=1.0):
    """How high the bottom edge of the front face sits above the origin plane (metres, unscaled): per 1 m column across
    the width, the lowest vertex of the front 35 % of the depth; the 90th percentile of those minima. The layout sinks
    a piece by this much more, so a scan whose front face starts above its lowest point doesn't float."""
    vs = [v.co for v in ob.data.vertices]
    ymin = min(v.y for v in vs)
    depth = max(v.y for v in vs) - ymin
    cols = {}
    for v in vs:
        if v.y <= ymin + 0.35 * depth:
            k = int(v.x // bin_width)
            cols[k] = min(cols.get(k, v.z), v.z)
    lows = sorted(cols.values())
    return round(lows[int(0.9 * (len(lows) - 1))], 3) if lows else 0.0


def split(meshes, spec):
    """High-resolution pieces (still in the scan's frame) + the joined full scan used as the bake source."""
    high = join(meshes, "scan_high") if spec["split"]["mode"] != "nodes" else None
    mode = spec["split"]["mode"]
    if mode == "whole":
        return high, [copy_object(high, f"{spec['id']}_0_high")]
    if mode == "nodes":
        pieces = [copy_object(o, f"{spec['id']}_{k}_high") for k, o in enumerate(sorted(meshes, key=lambda o: o.name))]
        keep = spec["split"].get("keep")
        if keep:
            pieces.sort(key=lambda o: -sum(p.area for p in o.data.polygons))
            for o in pieces[keep:]:
                bpy.data.objects.remove(o)
            pieces = pieces[:keep]
        high = join(meshes, "scan_high")
        return high, pieces
    if mode == "segments":
        count = spec["split"]["count"]
        overlap = spec["split"].get("overlap", 0.6)
        xs = [v.co.x for v in high.data.vertices]
        ys = [v.co.y for v in high.data.vertices]
        axis = 0 if (max(xs) - min(xs)) >= (max(ys) - min(ys)) else 1
        cs = xs if axis == 0 else ys
        lo, hi = min(cs), max(cs)
        step = (hi - lo) / count
        pieces = []
        for k in spec["split"].get("keep", range(count)):  # tapered end segments float: rocks_kit.json drops them
            a = lo + k * step - (overlap / 2 if k else 0.0)
            b = lo + (k + 1) * step + (overlap / 2 if k < count - 1 else 0.0)
            piece = slab(high, f"{spec['id']}_{k}_high", axis, a, b, 0.05)
            pieces.append(trim_depth(piece, spec["split"]["maxDepth"]) if "maxDepth" in spec["split"] else piece)
        return high, pieces
    raise ValueError(f"unknown split mode {mode}")


def bake_normals(high, lows, image, spec):
    """Cycles high→low tangent normal bake into `image`, one low at a time (islands accumulate, image cleared once)."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 1
    first = True
    for low in lows:
        deselect_all()
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        res = bpy.ops.object.bake(type="NORMAL", use_selected_to_active=True, cage_extrusion=spec["cage"],
                                  max_ray_distance=spec["ray"], margin=8, normal_space="TANGENT", use_clear=first)
        if res != {"FINISHED"}:
            raise RuntimeError(f"bake failed for {low.name}: {res}")
        first = False


def lod_material(src_mat, image, roughness=None):
    """Copy of the scan material for the LODs: its normal map reads the baked image (active node while baking).
    `roughness` replaces a roughness-only texture (the moss sets ship no ARM map, and Blender cannot re-pack it)."""
    mat = src_mat.copy()
    mat.name = "rock"
    nt = mat.node_tree
    if roughness is not None:
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        for link in list(bsdf.inputs["Roughness"].links):
            nt.links.remove(link)
        bsdf.inputs["Roughness"].default_value = roughness
    bake_node = nt.nodes.new("ShaderNodeTexImage")
    bake_node.name = "BakeTarget"
    bake_node.image = image
    nt.nodes.active = bake_node
    return mat


def finish_material(mat, image):
    """After the bake: the Normal Map node reads the baked image; the bake node goes."""
    nt = mat.node_tree
    nmap = next((n for n in nt.nodes if n.type == "NORMAL_MAP"), None)
    if nmap is None or not nmap.inputs["Color"].links:
        raise RuntimeError("scan material has no normal map to replace")
    nmap.inputs["Color"].links[0].from_node.image = image
    nt.nodes.remove(nt.nodes["BakeTarget"])


def export(objs, path, collision):
    deselect_all()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if collision:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_materials="NONE",
                                  export_normals=False, export_texcoords=False, export_apply=True)
    else:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                                  export_image_format="WEBP", export_image_quality=90)


def build_source(spec, cache, out):
    """Runs the whole kit pipeline for one source; returns its kit.json piece records."""
    sid = spec["id"]
    path = os.path.join(cache, sid, f"{sid}_{spec['res']}.gltf")
    if not os.path.exists(path):
        raise FileNotFoundError(f"{path} — run npm run cc0:fetch first")
    meshes = import_source(path)
    src_mat = meshes[0].data.materials[0]
    high, pieces = split(meshes, spec)
    log(sid, "scan tris", tris(high), "pieces", len(pieces))
    image = bpy.data.images.new(f"{sid}_nor_baked", spec["bake"], spec["bake"], alpha=False)
    image.colorspace_settings.name = "Non-Color"
    mat = lod_material(src_mat, image, spec.get("roughness"))
    lod0s = []
    for piece in pieces:
        lod0 = decimate_to(piece, piece.name.replace("_high", "_LOD0"), spec["tris"][0])
        lod0.data.materials.clear()
        lod0.data.materials.append(mat)
        lod0s.append(lod0)
    bake_normals(high, lod0s, image, spec)
    finish_material(mat, image)
    records, render_objs, col_objs = [], [], []
    for piece, lod0 in zip(pieces, lod0s):
        name = piece.name.replace("_high", "")
        lod1 = decimate_to(lod0, f"{name}_LOD1", spec["tris"][1])
        lod2 = decimate_to(lod0, f"{name}_LOD2", spec["tris"][2])
        col = decimate_to(lod0, f"{name}_col", spec["collisionTris"])
        col.data.materials.clear()
        m = orient_matrix(lod0, keep_axis=spec["split"]["mode"] == "segments")
        for o in (lod0, lod1, lod2, col):
            apply_matrix(o, m)
        if spec.get("closed"):
            MT.select_only(col)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.mesh.normals_make_consistent(inside=False)
            bpy.ops.object.mode_set(mode="OBJECT")
        bpy.data.objects.remove(piece)
        render_objs += [lod0, lod1, lod2]
        col_objs.append(col)
        records.append({
            "name": name, "source": sid, "role": spec["role"], "size": dims(lod0), "base": front_base(lod0),
            "tris": [tris(lod0), tris(lod1), tris(lod2)], "colTris": tris(col),
            "ao": bool(spec.get("arm")), "file": f"{sid}.glb", "colFile": f"{sid}.col.glb",
        })
        log(name, "size", records[-1]["size"], "tris", records[-1]["tris"], "col", records[-1]["colTris"])
    bpy.data.objects.remove(high)
    export(render_objs, os.path.join(out, f"{sid}.glb"), collision=False)
    export(col_objs, os.path.join(out, f"{sid}.col.glb"), collision=True)
    log(sid, "exported", os.path.getsize(os.path.join(out, f"{sid}.glb")), "bytes")
    return records


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--kit", default=os.path.join(HERE, "rock_kit.json"))
    ap.add_argument("--cache", default=os.path.join(ROOT, "pipeline", "cc0", "cache"))
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "assets", "world", "cove", "rocks"))
    ap.add_argument("--only", default=None)
    args = ap.parse_args(argv)
    args.out = os.path.abspath(args.out)
    kit = json.load(open(args.kit, encoding="utf-8"))
    kit_path = os.path.join(args.out, "kit.json")
    pieces = json.load(open(kit_path, encoding="utf-8"))["pieces"] if os.path.exists(kit_path) else []
    for spec in kit["sources"]:
        if args.only and spec["id"] != args.only:
            continue
        records = build_source(spec, args.cache, args.out)
        pieces = [p for p in pieces if p["source"] != spec["id"]] + records
    pieces.sort(key=lambda p: p["name"])
    with open(kit_path, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "pieces": pieces}, f, indent=1)
        f.write("\n")
    log("kit.json:", len(pieces), "pieces")


if __name__ == "__main__":
    main()
```

`pipeline/blender/cove/rock_kit.json`:
```json
{
 "sources": [
  { "id": "coastal_cliff_01", "res": "2k", "role": "wall", "arm": true,
    "split": { "mode": "segments", "count": 6, "keep": [2, 3, 4], "overlap": 0.6, "maxDepth": 9 },
    "tris": [30000, 7500, 1800], "collisionTris": 1200, "bake": 2048, "ray": 0.6, "cage": 0.1 },
  { "id": "coastal_cliff_02", "res": "2k", "role": "wall", "arm": true,
    "split": { "mode": "segments", "count": 3, "overlap": 0.6, "maxDepth": 9 },
    "tris": [36000, 9000, 2200], "collisionTris": 1400, "bake": 2048, "ray": 0.6, "cage": 0.1 },
  { "id": "rock_face_01", "res": "2k", "role": "ledge", "arm": true, "split": { "mode": "whole" },
    "tris": [12000, 3000, 800], "collisionTris": 500, "bake": 1024, "ray": 0.25, "cage": 0.03 },
  { "id": "rock_face_02", "res": "2k", "role": "ledge", "arm": true, "split": { "mode": "whole" },
    "tris": [12000, 3000, 800], "collisionTris": 500, "bake": 1024, "ray": 0.25, "cage": 0.03 },
  { "id": "boulder_01", "res": "2k", "role": "boulder", "arm": true, "closed": true, "split": { "mode": "whole" },
    "tris": [6000, 1500, 400], "collisionTris": 300, "bake": 1024, "ray": 0.2, "cage": 0.03 },
  { "id": "rock_moss_set_01", "res": "2k", "role": "boulder", "closed": true, "roughness": 0.85, "split": { "mode": "nodes" },
    "tris": [3000, 800, 250], "collisionTris": 200, "bake": 1024, "ray": 0.15, "cage": 0.02 },
  { "id": "rock_moss_set_02", "res": "2k", "role": "boulder", "closed": true, "roughness": 0.85, "split": { "mode": "nodes" },
    "tris": [3000, 800, 250], "collisionTris": 200, "bake": 1024, "ray": 0.15, "cage": 0.02 }
 ]
}
```

`pipeline/blender/cove/rocks_qa.py`:
```python
"""QA renders of the rock kit: every piece's LOD0 lined up, seen from the front (their +Z face in three.js) and from
above, textured. Usage: run.ps1 pipeline/blender/cove/rocks_qa.py [--rocks <dir>] [--out <dir>]"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))

import bpy  # noqa: E402

import qa_render as QA  # noqa: E402
import scene as SC  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--rocks", default=os.path.join(ROOT, "public", "assets", "world", "cove", "rocks"))
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "progress", "img", "cove"))
    args = ap.parse_args(argv)
    args.out = os.path.abspath(args.out)  # Blender resolves a relative render path against the drive root
    kit = json.load(open(os.path.join(args.rocks, "kit.json"), encoding="utf-8"))
    sc = SC.reset()
    for f in sorted({p["file"] for p in kit["pieces"]}):
        bpy.ops.import_scene.gltf(filepath=os.path.join(args.rocks, f))
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" or not o.name.endswith("_LOD0"):
            bpy.data.objects.remove(o)
    x = 0.0
    height = 0.0
    for p in kit["pieces"]:
        o = bpy.data.objects[p["name"] + "_LOD0"]
        w = p["size"][0]
        o.location = (x + w / 2, 0.0, 0.0)
        x += w + 1.5
        height = max(height, p["size"][1])
    QA.setup_clay(sc)
    sc.display.shading.color_type = "TEXTURE"
    mid = x / 2
    span = max(x, height * 3)
    QA.shoot(sc, args.out, "rocks-kit-front", (mid, -span * 0.9, height * 0.6), (mid, 0.0, height * 0.45), lens=35, res=(1800, 600))
    QA.shoot(sc, args.out, "rocks-kit-top", (mid, 0.0, span), (mid, 0.0, 0.0), res=(1800, 600), ortho=x * 1.05)


if __name__ == "__main__":
    main()
```

`package.json` scripts:
```json
"cove:rocks": "powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/cove/rocks.py",
"cove:rocks-qa": "powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/cove/rocks_qa.py"
```

`pipeline/cc0/wanted.json`:
- Change the existing `rock_moss_set_01` entry's `res` from `"1k"` to `"2k"`. Nothing loads the 1k copy at runtime; it only exercised the fetcher.
- Append:
```json
{ "id": "coastal_cliff_01", "type": "models", "res": "2k" },
{ "id": "coastal_cliff_02", "type": "models", "res": "2k" },
{ "id": "rock_face_01", "type": "models", "res": "2k" },
{ "id": "rock_face_02", "type": "models", "res": "2k" },
{ "id": "boulder_01", "type": "models", "res": "2k" },
{ "id": "rock_moss_set_02", "type": "models", "res": "2k" }
```

- [ ] **Step 4: Run to verify they pass** — `npm run blender:test` → every test passes: Plan 2's, plus the five rock tests.

- [ ] **Step 5: Fetch and build the kit**
  1. `npm run cc0:fetch`: seven models download at 2k (about 95 MB into the git-ignored cache), md5-verified.
  2. `npm run cove:rocks`: about 4–6 min; while planning, at 1k, the same kit took ~3 min. Expected log:
     - one line per piece with its size, LOD triangle counts and collision triangles; LOD0 counts within 1 % of the targets
     - the cliff pieces 14–16 m wide and ~8.5–10 m tall; `base` below 1.3 m
     - the moss sets split into their scan nodes (six and seven pieces)
     - the last line is `kit.json: 18 pieces`
  3. Check the output in `public/assets/world/cove/rocks/`:
     - each GLB's JSON chunk lists `EXT_texture_webp`
     - every material has a `normalTexture`
     - the collision GLBs have no images
     - total size about 20 MB
- [ ] **Step 6: Visual check** — `npm run cove:rocks-qa`, then Read `docs/progress/img/cove/rocks-kit-front.png` and `rocks-kit-top.png`. Every piece must:
  - show its rock face to the camera in the front view (not its back or a cut side)
  - stand on its bottom, with no detached slivers floating beside it
  - read as rock with fine detail: the baked normal carries the scan's detail

  If a cliff segment shows a cut face or a raised front edge, change its `keep` list in `rock_kit.json`, re-run with `--only <id>`, and record why in the report.
- [ ] **Step 7: Commit** — the Blender scripts, the kit spec, the test, `wanted.json`, `manifest.json`, `CREDITS.md`, `package.json`, the kit outputs and the two QA renders. Message: `feat(cove): rock kit — Poly Haven scans decimated with baked normals, LODs and collision`.

---

### Task 10: Rock layout (pure, seeded)

**Pure: needs only Task 4's bake and Task 5.** The fixture kit mirrors Task 9's measured sizes, so this task can run before Task 9.

**Files:**
- Create: `src/world/cove/coveGeometry.ts`, `src/world/cove/rockLayout.ts`, `tests/world/coveGeometry.test.ts`, `tests/world/rockKitFixture.ts`, `tests/world/rockLayout.test.ts`

**Interfaces:**
- Consumes: `TerrainHeader`, `Heightfield` (Task 5), `mulberry32`.
- Produces:
  - `coveGeometry.ts` (runtime mirror of `coveShape.mjs`, reads the header): `azimuthDeg`, `azimuthDir`, `rayFrame`, `headingOfAzimuth` (Plan 3 heading), `wallHeightAt`, `pondQ`, `pondPoint(h, q, t)`, `designedCorridor(h, x, z, margin) → 'gully' | 'routeA' | 'routeB' | 'spawn' | null`. The corridors are the gully channel and the routes' shaped strips; their blend bands stay usable. M7b's placement reuses this.
  - `rockLayout.ts`:
    - types: `RockRole`, `interface KitPiece`, `interface RockKit`, `type PlacementKind`, `interface RockPlacement { piece; kind; x; y; z; yaw; scale }`, `interface HeightSampler`, `interface RockLayoutParams`
    - `COVE_ROCK_LAYOUT`, `yawFacing(dx, dz)`, `wallFoot(ground, φ, rise)`, `layoutRocks(ground, header, kit, params?) → RockPlacement[]`

The layout works in five stages:
- **Wall ring.** Free arcs are the azimuths whose wall foot is outside every corridor. Each arc is filled from its start with wall pieces (scale 1.5–1.9) that overlap by 3 m, face the hollow and sink 1.6 m plus their `base`. The last piece is pulled back to end exactly at the arc's end. A piece that still touches a corridor shrinks, then falls back to a ledge piece.
- **Upper tier.** Where the wall is over 21 m, a set-back tier of ledge pieces goes where the ground reaches the lower piece's top.
- **Flanks.** Ledge outcrops flank the gully and both climb routes. They hide the corridors' straight edges; the corridors themselves stay clear.
- **Pond boulders.** Three boulders, scaled from the local depth so they break the surface.
- **Scatter.** Bank rocks, talus at the wall foot, floor boulders and rim-forest rocks, with non-overlap circles.

- [ ] **Step 1: Write the failing tests**

`tests/world/coveGeometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { azimuthDeg, azimuthDir, designedCorridor, headingOfAzimuth, pondPoint, pondQ, rayFrame, wallHeightAt } from '../../src/world/cove/coveGeometry';
import { testHeader } from './terrainFixtures';

describe('Cove geometry helpers', () => {
  const h = { ...testHeader(8), pond: { cx: 9, cz: 6, a: 17.5, b: 12.5, angle: 25, depth: 2.5 } };

  it('uses the compass convention of the bake and the sun (0 = north −Z, 90 = east +X)', () => {
    expect(azimuthDir(0)[1]).toBeCloseTo(-1, 12);
    expect(azimuthDir(90)[0]).toBeCloseTo(1, 12);
    for (const a of [5, 91, 180, 292, 359]) {
      const [x, z] = azimuthDir(a);
      expect(azimuthDeg(x * 7, z * 7)).toBeCloseTo(a, 9);
      const hd = headingOfAzimuth(a); // Plan 3: forward = (sin h, cos h)
      expect(Math.sin(hd)).toBeCloseTo(x, 12);
      expect(Math.cos(hd)).toBeCloseTo(z, 12);
    }
    expect(rayFrame(0, -10, 0)).toEqual({ along: 10, lateral: 0 });
  });

  it('makes the walls lowest toward the sun and tallest opposite it', () => {
    expect(wallHeightAt(h, 292)).toBeCloseTo(14, 9);
    expect(wallHeightAt(h, 112)).toBeCloseTo(25, 9);
  });

  it('parameterises the pond ellipse both ways', () => {
    expect(pondQ(h, 9, 6)).toBe(0);
    for (const t of [0, 1, 2.5, 4]) {
      const [x, z] = pondPoint(h, 1, t);
      expect(pondQ(h, x, z)).toBeCloseTo(1, 9);
    }
  });

  it('finds the gully, both routes and the spawn clearing', () => {
    const at = (az: number, r: number, side = 0): [number, number] => {
      const [x, z] = azimuthDir(az);
      return [x * r + z * side, z * r - x * side];
    };
    expect(designedCorridor(h, ...at(292, 60))).toBe('gully');
    expect(designedCorridor(h, ...at(292, 60, 12))).toBeNull(); // on the gully's side slope
    expect(designedCorridor(h, ...at(330, 40))).toBe('routeA');
    expect(designedCorridor(h, ...at(250, 45))).toBe('routeB');
    expect(designedCorridor(h, 0.5, 0.5)).toBe('spawn');
    expect(designedCorridor(h, ...at(120, 40))).toBeNull();
  });
});
```

`tests/world/rockKitFixture.ts`:
```ts
import type { KitPiece } from '../../src/world/cove/rockLayout';

const piece = (name: string, role: KitPiece['role'], size: [number, number, number], base: number): KitPiece => {
  const source = name.replace(/_\d+$/, '');
  return { name, source, role, size, base, tris: [1, 1, 1], colTris: 1, ao: true, file: `${source}.glb`, colFile: `${source}.col.glb` };
};

/** Piece sizes as rocks.py measured them from the Poly Haven scans while planning (Task 9 writes the real kit). */
export const FIXTURE_KIT: KitPiece[] = [
  piece('boulder_01_0', 'boulder', [1.736, 1.0, 1.498], 0.0),
  piece('coastal_cliff_01_2', 'wall', [15.934, 9.889, 9.099], 1.195),
  piece('coastal_cliff_01_3', 'wall', [15.933, 10.011, 8.167], 1.143),
  piece('coastal_cliff_01_4', 'wall', [15.935, 9.909, 8.43], 0.901),
  piece('coastal_cliff_02_0', 'wall', [13.949, 10.053, 8.591], 0.66),
  piece('coastal_cliff_02_1', 'wall', [14.255, 8.477, 4.541], 0.843),
  piece('coastal_cliff_02_2', 'wall', [13.949, 8.66, 6.881], 1.067),
  piece('rock_face_01_0', 'ledge', [4.923, 3.565, 3.788], 0.066),
  piece('rock_face_02_0', 'ledge', [2.849, 2.475, 1.984], 0.001),
  piece('rock_moss_set_02_0', 'boulder', [1.484, 0.744, 1.782], 0.0),
  piece('rock_moss_set_02_1', 'boulder', [1.216, 0.526, 1.205], 0.001),
  piece('rock_moss_set_02_2', 'boulder', [1.449, 0.609, 1.194], 0.0),
  piece('rock_moss_set_02_3', 'boulder', [2.118, 0.766, 1.561], 0.004),
  piece('rock_moss_set_02_4', 'boulder', [1.882, 1.304, 1.885], 0.012),
  piece('rock_moss_set_02_5', 'boulder', [1.46, 0.734, 1.56], 0.0),
  piece('rock_moss_set_02_6', 'boulder', [1.734, 1.253, 1.613], 0.032),
];
```

`tests/world/rockLayout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';
import { layoutRocks, wallFoot, COVE_ROCK_LAYOUT, type RockPlacement } from '../../src/world/cove/rockLayout';
import { azimuthDeg, azimuthDir, designedCorridor, pondQ } from '../../src/world/cove/coveGeometry';
import { FIXTURE_KIT } from './rockKitFixture';

const COVE = 'public/assets/world/cove/';
const byName = new Map(FIXTURE_KIT.map((p) => [p.name, p]));

/** World xz of piece-local point (lx, lz) (unscaled metres) of a placement. */
const world = (p: RockPlacement, lx: number, lz: number): [number, number] => {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return [p.x + (lx * c + lz * s) * p.scale, p.z + (-lx * s + lz * c) * p.scale];
};
const radius = (r: RockPlacement) => (Math.max(byName.get(r.piece)!.size[0], byName.get(r.piece)!.size[2]) * r.scale) / 2;

describe.skipIf(!existsSync(`${COVE}terrain.json`))('Cove rock layout on the baked terrain', () => {
  const header = JSON.parse(readFileSync(`${COVE}terrain.json`, 'utf8')) as TerrainHeader;
  const hf = Heightfield.fromUint16LE(header, readFileSync(COVE + header.files.height));
  const rocks = layoutRocks(hf, header, FIXTURE_KIT);

  it('is deterministic and seed-dependent', () => {
    expect(layoutRocks(hf, header, FIXTURE_KIT)).toEqual(rocks);
    expect(layoutRocks(hf, header, FIXTURE_KIT, { ...COVE_ROCK_LAYOUT, seed: 7 })).not.toEqual(rocks);
  });

  it('rings the hollow with wall pieces everywhere except where a corridor crosses the wall', () => {
    const walls = rocks.filter((r) => r.kind === 'wall');
    expect(walls.length).toBeGreaterThanOrEqual(6);
    const covered = new Array<boolean>(360).fill(false);
    for (const w of walls) {
      const half = byName.get(w.piece)!.size[0] / 2;
      for (let t = -1; t <= 1; t += 0.01) {
        const [x, z] = world(w, half * t, 0);
        covered[Math.floor(azimuthDeg(x, z)) % 360] = true;
      }
    }
    const gaps: number[] = [];
    for (let a = 0; a < 360; a++) {
      if (covered[a]) continue;
      const [ux, uz] = azimuthDir(a + 0.5);
      const r = wallFoot(hf, a + 0.5, COVE_ROCK_LAYOUT.footRise);
      // a slot's width of slack either side of a corridor (a piece that would touch it is skipped whole)
      const nearCorridor = [-14, -7, 0, 7, 14].some((d) => designedCorridor(header, ux * r + d * uz, uz * r - d * ux, 2) !== null);
      if (!nearCorridor) gaps.push(a);
    }
    expect(gaps).toEqual([]);
  });

  it('keeps every footprint out of the gully, both climb routes and the spawn clearing', () => {
    for (const r of rocks) {
      const [w, , d] = byName.get(r.piece)!.size;
      for (let fx = -0.5; fx <= 0.5001; fx += 1 / Math.ceil(w * r.scale)) {
        for (let fz = -0.5; fz <= 0.5001; fz += 1 / Math.ceil(d * r.scale)) {
          const [x, z] = world(r, fx * w, fz * d);
          expect(designedCorridor(header, x, z, 1), `${r.kind} ${r.piece} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeNull();
        }
      }
    }
  });

  it('sinks every piece into the ground (no floating corners)', () => {
    for (const r of rocks) {
      const p = byName.get(r.piece)!;
      const pts = r.kind === 'wall' ? [[-0.4, 0.5], [-0.2, 0.5], [0, 0.5], [0.2, 0.5], [0.4, 0.5]] : [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4], [0, 0]];
      for (const [fx, fz] of pts) {
        const [x, z] = world(r, fx * p.size[0], fz * p.size[2]);
        expect(r.y + p.base * r.scale, `${r.kind} ${r.piece} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThan(hf.heightAt(x, z) - 0.15);
      }
    }
  });

  it('breaks the pond surface with three boulders and keeps the other scatter out of the water', () => {
    const pond = rocks.filter((r) => r.kind === 'pond');
    expect(pond).toHaveLength(3);
    for (const r of pond) {
      expect(pondQ(header, r.x, r.z)).toBeLessThan(0.9);
      expect(r.y + byName.get(r.piece)!.size[1] * r.scale).toBeGreaterThan(header.waterLevel + 0.3);
    }
    for (const r of rocks.filter((k) => k.kind === 'floor' || k.kind === 'talus' || k.kind === 'rim')) {
      expect(pondQ(header, r.x, r.z)).toBeGreaterThan(1.3);
    }
  });

  it('never overlaps two scattered boulders', () => {
    const b = rocks.filter((r) => ['floor', 'talus', 'bank', 'pond', 'rim'].includes(r.kind));
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) expect(Math.hypot(b[i].x - b[j].x, b[i].z - b[j].z)).toBeGreaterThan(radius(b[i]) + radius(b[j]));
    }
  });

  it('places the requested scatter counts', () => {
    const count = (k: string) => rocks.filter((r) => r.kind === k).length;
    const c = COVE_ROCK_LAYOUT.counts;
    expect([count('talus'), count('floor'), count('bank'), count('rim')]).toEqual([c.talus, c.floor, c.bank, c.rim]);
    expect(count('flank')).toBeGreaterThanOrEqual(3 * c.flank - 3);
    expect(count('upper')).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/world/coveGeometry tests/world/rockLayout` → modules not found.

- [ ] **Step 3: Implement**

`src/world/cove/coveGeometry.ts`:
```ts
import type { TerrainHeader } from '../terrain/heightfield';

/**
 * The Cove's designed features, read from the baked header (runtime mirror of pipeline/terrain/coveShape.mjs):
 * compass helpers, wall height, the pond ellipse and the keep-clear corridors (gully, climb routes, spawn) that
 * placement code (rocks here, trees and props in M7b) must leave free.
 */
const DEG = Math.PI / 180;

/** Compass azimuth of (x, z) in degrees [0, 360): 0 = north (−Z), 90 = east (+X). */
export function azimuthDeg(x: number, z: number): number {
  const a = Math.atan2(x, -z) / DEG;
  return a < 0 ? a + 360 : a;
}

/** Unit ground direction [x, z] of a compass azimuth. */
export function azimuthDir(deg: number): [number, number] {
  return [Math.sin(deg * DEG), -Math.cos(deg * DEG)];
}

/** Distance along, and unsigned distance across, the ray from the origin at compass azimuth `deg`. */
export function rayFrame(x: number, z: number, deg: number): { along: number; lateral: number } {
  const [ux, uz] = azimuthDir(deg);
  return { along: x * ux + z * uz, lateral: Math.abs(x * uz - z * ux) };
}

/** Plan 3 heading (forward = (sin h, cos h)) that faces compass azimuth `deg`. */
export function headingOfAzimuth(deg: number): number {
  const [ux, uz] = azimuthDir(deg);
  return Math.atan2(ux, uz);
}

/** Rim height above the floor at azimuth φ (the bake's wallHeight). */
export function wallHeightAt(h: TerrainHeader, phiDeg: number): number {
  return h.wall.mean - h.wall.amp * Math.cos((phiDeg - h.sun.azimuth) * DEG);
}

/** Pond ellipse parameter: < 1 inside the water outline. */
export function pondQ(h: TerrainHeader, x: number, z: number): number {
  const p = h.pond;
  const a = p.angle * DEG;
  const dx = x - p.cx;
  const dz = z - p.cz;
  const u = dx * Math.cos(a) + dz * Math.sin(a);
  const v = -dx * Math.sin(a) + dz * Math.cos(a);
  return (u / p.a) ** 2 + (v / p.b) ** 2;
}

/** World point at ellipse parameter q (radius fraction √q) and polar angle t around the pond centre. */
export function pondPoint(h: TerrainHeader, q: number, t: number): [number, number] {
  const p = h.pond;
  const a = p.angle * DEG;
  const r = Math.sqrt(q);
  const u = Math.cos(t) * p.a * r;
  const v = Math.sin(t) * p.b * r;
  return [p.cx + u * Math.cos(a) - v * Math.sin(a), p.cz + u * Math.sin(a) + v * Math.cos(a)];
}

/**
 * Which designed corridor (if any) the point lies in: the gully channel, a climb route's shaped strip, or the spawn
 * clearing (4 m), each widened by `margin` metres. The blend bands either side are natural ground and stay usable.
 */
export function designedCorridor(h: TerrainHeader, x: number, z: number, margin = 0): 'gully' | 'routeA' | 'routeB' | 'spawn' | null {
  const g = h.gully;
  const gf = rayFrame(x, z, g.azimuth);
  if (gf.along > g.rStart - g.blend - margin) {
    const s = Math.min(1, Math.max(0, (gf.along - g.rStart) / (g.rEnd - g.rStart)));
    const halfW = g.halfWidthIn + (g.halfWidthOut - g.halfWidthIn) * s * s * (3 - 2 * s);
    if (gf.lateral < halfW + margin) return 'gully';
  }
  const ra = h.routeA;
  const af = rayFrame(x, z, ra.azimuth);
  const aEnd = ra.rStart + ra.steps * ra.tread;
  if (af.along > ra.rStart - 3 - margin && af.along < aEnd + 6 + margin && af.lateral < ra.halfWidth + margin) return 'routeA';
  const rb = h.routeB;
  const bf = rayFrame(x, z, rb.azimuth);
  if (bf.along > rb.r0 - 3 - margin && bf.along < rb.r1 + 4 + margin && bf.lateral < rb.halfWidth + margin) return 'routeB';
  for (const s of h.spawn) if (Math.hypot(x - s.x, z - s.z) < 4 + margin) return 'spawn';
  return null;
}
```

`src/world/cove/rockLayout.ts`:
```ts
import { mulberry32 } from '../../core/rng';
import type { TerrainHeader } from '../terrain/heightfield';
import { azimuthDeg, azimuthDir, designedCorridor, pondPoint, pondQ, wallHeightAt } from './coveGeometry';

export type RockRole = 'wall' | 'ledge' | 'boulder';

/** One piece of `public/assets/world/cove/rocks/kit.json` (written by pipeline/blender/cove/rocks.py). */
export interface KitPiece {
  name: string;
  source: string;
  role: RockRole;
  /** [width x, height y, depth z] in metres; front face toward +Z, origin at the bottom centre. */
  size: [number, number, number];
  /** Height of the front face's bottom edge above the origin (unscaled metres); placements sink this much more. */
  base: number;
  tris: number[];
  colTris: number;
  /** The source's metallic-roughness texture is an ARM map (AO in red). */
  ao: boolean;
  file: string;
  colFile: string;
}

export interface RockKit {
  version: 1;
  pieces: KitPiece[];
}

export type PlacementKind = 'wall' | 'upper' | 'flank' | 'floor' | 'talus' | 'bank' | 'pond' | 'rim';

/** A placed piece: origin (x, y, z), yaw about +Y (three.js rotation.y), uniform scale. */
export interface RockPlacement {
  piece: string;
  kind: PlacementKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface HeightSampler {
  heightAt(x: number, z: number): number;
}

export interface RockLayoutParams {
  seed: number;
  /** The wall foot is where the ground first rises this far above the floor, marching outward. */
  footRise: number;
  /** How far in front of the foot a wall face stands, and how deep its base is sunk. */
  wallInset: number;
  wallSink: number;
  /** Neighbouring wall pieces overlap by this much (hides the cut ends). */
  wallOverlap: number;
  wallScale: [number, number];
  /** Walls taller than this get a second, set-back tier of ledge pieces. */
  upperMinWall: number;
  upperScale: [number, number];
  /** Keep-clear margin around the gully, routes and spawn (metres). */
  corridorMargin: number;
  counts: { floor: number; talus: number; bank: number; pond: number; rim: number; flank: number };
}

export const COVE_ROCK_LAYOUT: RockLayoutParams = {
  seed: 1337,
  footRise: 0.8,
  wallInset: 0.6,
  wallSink: 1.6,
  wallOverlap: 3,
  wallScale: [1.5, 1.9],
  upperMinWall: 21,
  upperScale: [1.9, 2.6],
  corridorMargin: 1.5,
  counts: { floor: 10, talus: 18, bank: 6, pond: 3, rim: 12, flank: 4 },
};

const DEG = Math.PI / 180;

/** Local footprint sample points (x, z) of a scaled piece: a grid at most `step` metres apart over `frac` of its extent. */
function footprint(p: KitPiece, s: number, frac = 0.5, step = 1.5): [number, number][] {
  const w = p.size[0] * s * frac;
  const d = p.size[2] * s * frac;
  const nw = Math.max(2, Math.ceil((2 * w) / step));
  const nd = Math.max(2, Math.ceil((2 * d) / step));
  const pts: [number, number][] = [];
  for (let i = 0; i <= nw; i++) for (let j = 0; j <= nd; j++) pts.push([-w + (2 * w * i) / nw, -d + (2 * d * j) / nd]);
  return pts;
}

/** World xz of a local footprint point under yaw (three.js rotation.y) at (x, z). */
function toWorld(lx: number, lz: number, yaw: number, x: number, z: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

/** Yaw that turns a piece's front (+Z) toward ground direction (dx, dz). */
export function yawFacing(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Radius where the ground along azimuth φ first rises `rise` above the floor at r = 30 (clear of the pond). */
export function wallFoot(ground: HeightSampler, phiDeg: number, rise: number): number {
  const [ux, uz] = azimuthDir(phiDeg);
  const floor = ground.heightAt(ux * 30, uz * 30);
  for (let r = 30; r < 70; r += 0.25) if (ground.heightAt(ux * r, uz * r) - floor > rise) return r;
  return 70;
}

/**
 * Seeded kit-bash layout of the Cove's rocks (spec §7.4): wall pieces ringing the hollow at the wall foot, a
 * set-back upper tier where the wall is tall, ledge outcrops flanking the gully and both climb routes, talus and
 * floor boulders, bank rocks, boulders breaking the pond surface, and rocks in the rim forest. Nothing enters the
 * gully, the two climb routes or the spawn clearing. Pure: the same inputs always give the same placements.
 */
export function layoutRocks(ground: HeightSampler, header: TerrainHeader, kit: readonly KitPiece[], params: RockLayoutParams = COVE_ROCK_LAYOUT): RockPlacement[] {
  const rng = mulberry32(params.seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  const range = (r: [number, number]) => r[0] + (r[1] - r[0]) * rng();
  const wallsAll = kit.filter((p) => p.role === 'wall');
  const flat = wallsAll.filter((p) => p.base <= 0.35 * p.size[1]); // a front face starting high up would float
  const walls = flat.length ? flat : wallsAll;
  const ledges = kit.filter((p) => p.role === 'ledge');
  const boulders = kit.filter((p) => p.role === 'boulder');
  const big = boulders.reduce((a, b) => (b.size[0] * b.size[1] > a.size[0] * a.size[1] ? b : a), boulders[0]);
  const byName = new Map(kit.map((p) => [p.name, p]));
  const out: RockPlacement[] = [];
  const clearOf = (p: KitPiece, s: number, yaw: number, x: number, z: number, margin: number) =>
    footprint(p, s).every(([lx, lz]) => {
      const [wx, wz] = toWorld(lx, lz, yaw, x, z);
      return designedCorridor(header, wx, wz, margin) === null;
    });
  /** Lowest ground under the footprint (sampled at the heightfield's 0.4 m), so no corner floats. */
  const groundUnder = (p: KitPiece, s: number, yaw: number, x: number, z: number, frac = 0.45) =>
    Math.min(...footprint(p, s, frac, 0.4).map(([lx, lz]) => ground.heightAt(...toWorld(lx, lz, yaw, x, z))));
  const circles: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => circles.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + r + 0.4);

  // Wall ring. Free arcs are the azimuths whose wall foot lies outside every corridor; each arc is filled from its
  // start, pieces overlapping by wallOverlap, the last one pulled back so it ends at the arc's end. A piece whose
  // footprint still touches a corridor shrinks (up to 3 times), then falls back to a ledge piece, then is skipped.
  const footPoint = (phi: number): [number, number, number] => {
    const [ux, uz] = azimuthDir(phi);
    const r = wallFoot(ground, phi, params.footRise) - params.wallInset;
    return [ux * r, uz * r, r];
  };
  const blocked = Array.from({ length: 360 }, (_, a) => {
    const [x, z] = footPoint(a + 0.5);
    return designedCorridor(header, x, z, params.corridorMargin) !== null;
  });
  const arcs: [number, number][] = [];
  const firstBlocked = blocked.indexOf(true);
  if (firstBlocked < 0) arcs.push([0, 360]);
  else {
    let runStart = -1;
    for (let k = 1; k <= 360; k++) {
      const a = firstBlocked + k;
      const isFree = k < 360 && !blocked[a % 360];
      if (isFree && runStart < 0) runStart = a;
      if (!isFree && runStart >= 0) {
        arcs.push([runStart, a]);
        runStart = -1;
      }
    }
  }
  const placeWall = (piece: KitPiece, s: number, phi: number, kind: PlacementKind): number | null => {
    const [fx, fz, rFront] = footPoint(phi);
    const r = rFront + (piece.size[2] * s) / 2;
    const [ux, uz] = azimuthDir(phi);
    const x = ux * r;
    const z = uz * r;
    const yaw = yawFacing(-ux, -uz) + (rng() - 0.5) * 8 * DEG;
    if (!clearOf(piece, s, yaw, x, z, params.corridorMargin)) return null;
    const y = ground.heightAt(fx, fz) - params.wallSink - piece.base * s;
    out.push({ piece: piece.name, kind, x, y, z, yaw, scale: s });
    return y + piece.size[1] * s;
  };
  for (const [a0, a1] of arcs) {
    let cursor = a0;
    while (cursor < a1 - 1) {
      let piece = pick(walls);
      let s = range(params.wallScale);
      let top: number | null = null;
      let phi = cursor;
      for (let attempt = 0; attempt < 5 && top === null; attempt++) {
        if (attempt === 3) {
          piece = pick(ledges.length ? ledges : walls);
          s = range(params.upperScale);
        } else if (attempt > 0) s *= 0.88;
        const r = footPoint(cursor)[2] + (piece.size[2] * s) / 2;
        const half = (piece.size[0] * s) / 2 / r / DEG;
        phi = Math.max(a0 + half, Math.min(cursor + half, a1 - half));
        top = placeWall(piece, s, phi, 'wall');
        if (top !== null) cursor = phi + half >= a1 - 0.5 ? a1 : Math.max(cursor + 1, phi + half - params.wallOverlap / r / DEG);
      }
      if (top === null) {
        cursor += 2;
        continue;
      }
      if (wallHeightAt(header, phi) > params.upperMinWall && ledges.length) {
        const up = pick(ledges);
        const su = range(params.upperScale);
        const [ux, uz] = azimuthDir(phi);
        const rFront = footPoint(phi)[2];
        let ru = rFront + 1;
        while (ru < rFront + 14 && ground.heightAt(ux * ru, uz * ru) < top - 2.5) ru += 0.25;
        const du = up.size[2] * su;
        const xu = ux * (ru + du / 2);
        const zu = uz * (ru + du / 2);
        const yawU = yawFacing(-ux, -uz) + (rng() - 0.5) * 16 * DEG;
        if (clearOf(up, su, yawU, xu, zu, params.corridorMargin)) {
          out.push({ piece: up.name, kind: 'upper', x: xu, y: groundUnder(up, su, yawU, xu, zu) - 1.2 - up.base * su, z: zu, yaw: yawU, scale: su });
        }
      }
    }
  }

  // Ledge outcrops flanking the gully and both climb routes, facing across them: they break up the corridors' straight
  // edges and read as the rock the routes climb through, while the corridors themselves stay clear.
  const flank = (azimuth: number, from: number, to: number, halfWidthAt: (along: number) => number) => {
    const [dx, dz] = azimuthDir(azimuth);
    for (let k = 0; k < params.counts.flank && ledges.length; k++) {
      const side = k % 2 === 0 ? 1 : -1;
      const along = from + ((Math.floor(k / 2) + 0.5 + (rng() - 0.5) * 0.6) / Math.ceil(params.counts.flank / 2)) * (to - from);
      const piece = pick(ledges);
      const s = range([1.5, 2.1]);
      const lat = halfWidthAt(along) + params.corridorMargin + (piece.size[2] * s) / 2 + 1;
      const x = dx * along + dz * lat * side;
      const z = dz * along - dx * lat * side;
      const yaw = yawFacing(-dz * side, dx * side) + (rng() - 0.5) * 12 * DEG;
      if (!clearOf(piece, s, yaw, x, z, params.corridorMargin)) continue;
      out.push({ piece: piece.name, kind: 'flank', x, y: groundUnder(piece, s, yaw, x, z) - 0.6 - piece.base * s, z, yaw, scale: s });
    }
  };
  const g = header.gully;
  flank(g.azimuth, g.rStart + 10, g.rStart + 50, (along) => {
    const t = Math.min(1, Math.max(0, (along - g.rStart) / (g.rEnd - g.rStart)));
    return g.halfWidthIn + (g.halfWidthOut - g.halfWidthIn) * t * t * (3 - 2 * t);
  });
  const ra = header.routeA;
  flank(ra.azimuth, ra.rStart + 1, ra.rStart + ra.steps * ra.tread, () => ra.halfWidth);
  const rb = header.routeB;
  flank(rb.azimuth, rb.r0 + 1, rb.r1, () => rb.halfWidth);

  const scatter = (kind: PlacementKind, count: number, sample: () => [number, number], scale: [number, number], sinkFrac: number, avoidPond: boolean) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 60; tries++) {
      const [x, z] = sample();
      const piece = pick(boulders);
      const s = range(scale);
      const yaw = rng() * Math.PI * 2;
      const rad = (Math.max(piece.size[0], piece.size[2]) * s) / 2;
      if (!free(x, z, rad)) continue;
      if (avoidPond && pondQ(header, x, z) < 1.35) continue;
      if (!clearOf(piece, s, yaw, x, z, params.corridorMargin)) continue;
      const y = groundUnder(piece, s, yaw, x, z) - Math.max(0.2, piece.size[1] * s * sinkFrac) - piece.base * s;
      out.push({ piece: piece.name, kind, x, y, z, yaw, scale: s });
      circles.push({ x, z, r: rad });
      placed++;
    }
  };
  const polar = (r0: number, r1: number): [number, number] => {
    const a = rng() * 360;
    const r = r0 + (r1 - r0) * rng();
    const [ux, uz] = azimuthDir(a);
    return [ux * r, uz * r];
  };
  const footAt = (x: number, z: number) => wallFoot(ground, azimuthDeg(x, z), params.footRise);

  // Pond boulders first (they choose their spot from the depth), then the rest around them.
  for (let k = 0, tries = 0; k < params.counts.pond && tries < 200; tries++) {
    const [x, z] = pondPoint(header, 0.55 + rng() * 0.3, rng() * Math.PI * 2);
    const yaw = rng() * Math.PI * 2;
    const base0 = groundUnder(big, 2, yaw, x, z) - 0.3;
    const s = Math.min(2.8, Math.max(1.4, (header.waterLevel + 0.5 - base0) / big.size[1] + rng() * 0.2));
    const y = groundUnder(big, s, yaw, x, z) - 0.3 - big.base * s;
    const rad = (Math.max(big.size[0], big.size[2]) * s) / 2;
    if (y + big.size[1] * s < header.waterLevel + 0.3 || !free(x, z, rad + 1.5)) continue;
    out.push({ piece: big.name, kind: 'pond', x, y, z, yaw, scale: s });
    circles.push({ x, z, r: rad });
    k++;
  }
  scatter('bank', params.counts.bank, () => pondPoint(header, 1.12 + rng() * 0.35, rng() * Math.PI * 2), [0.7, 1.1], 0.3, false);
  scatter('talus', params.counts.talus, () => {
    const [x, z] = polar(20, 40);
    const r = Math.hypot(x, z);
    const f = footAt(x, z) - 0.8 - rng() * 4;
    return [(x / r) * f, (z / r) * f];
  }, [0.8, 1.4], 0.25, true);
  scatter('floor', params.counts.floor, () => polar(6, 30), [0.9, 1.6], 0.3, true);
  scatter('rim', params.counts.rim, () => polar(56, 90), [1.0, 1.8], 0.3, true);

  for (const p of out) if (!byName.has(p.piece)) throw new Error(`rock layout: unknown piece ${p.piece}`);
  return out;
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/world/coveGeometry tests/world/rockLayout` → 11 pass. `npm run typecheck` clean.
  - While planning, the layout on the real bake gave about 79 placements: 9–10 wall pieces (4 of them ledge fillers in the narrow arcs between the corridors), 4 upper, 9–12 flanks, 3 pond, 6 bank, 18 talus, 10 floor and 12 rim.
  - If Task 9's real kit changes the sizes much, update `rockKitFixture.ts` from `kit.json` (names, sizes, `base`) and re-run.
- [ ] **Step 5: Commit** — `feat(cove): seeded rock layout — wall ring, upper tier, flanks, pond and scatter, corridors kept clear`.

---

### Task 11: Rocks in the Cove — runtime, material hook, collision

**Needs Tasks 7–10.**

**Files:**
- Create: `src/world/renderLayers.ts`, `src/world/cove/rockMaterial.ts`, `src/world/cove/rocks.ts`, `tests/world/rocks.test.ts`
- Modify: `src/world/cove/cove.ts`, `src/dev/cove/main.ts`
- Output: `docs/progress/img/cove/m7-rocks-{floor,pond,wide}.png`

**Interfaces:**
- Consumes:
  - `SplatUniforms`, `SPLAT_FRAGMENT_PARS` (Task 7); `CoveRegion` (Task 8); `layoutRocks`, `KitPiece` (Task 10)
  - `createGltfLoader` (Plan 1 `src/render/loaders.ts`); `addCompileHook`
- Produces:
  - `renderLayers.ts`: `LAYER_MAIN_ONLY = 1`, `LAYER_UNDERWATER = 2`.
  - `rockMaterial.ts`: `interface RockUniforms`, `createRockUniforms(heightTexture)`, `patchRockShader(shader, splat, rock)`, `applyRockMaterial(material, splat, rock, low)` (hook key `coveRock`, define `ROCK_LOW`).
  - `rocks.ts`:
    - `ROCK_LOD_DISTANCES = [40, 100]` (× piece size ÷ 8 m, × preset scale)
    - `interface RockMeshes`, `loadRockKit(loader, baseUrl, kit)`
    - `class RockField { root; collisionRoot; placements; meshes; triangles(); dispose() }`, `addRocks(cove) → Promise<RockField>`
  - Placement policy:
    - one `THREE.LOD` per placement; wall-ring pieces don't cast CSM shadows (the terrain wall casts that shadow)
    - pond and bank rocks enable `LAYER_UNDERWATER`
    - ARM sources reuse their metallic-roughness texture as `aoMap`

- [ ] **Step 1: Write the failing tests**

`tests/world/rocks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RockField, ROCK_LOD_DISTANCES, type RockMeshes } from '../../src/world/cove/rocks';
import { patchRockShader, createRockUniforms, applyRockMaterial } from '../../src/world/cove/rockMaterial';
import { createSplatUniforms } from '../../src/world/terrain/splatShader';
import { LAYER_UNDERWATER } from '../../src/world/renderLayers';
import type { RockPlacement } from '../../src/world/cove/rockLayout';

/** A 2 × 1 × 2 m box standing on its origin (LOD0–2 and collision all the same box). */
function boxRock(): RockMeshes {
  const g = new THREE.BoxGeometry(2, 1, 2).translate(0, 0.5, 0);
  return { lods: [g, g, g], collision: g, material: new THREE.MeshStandardMaterial() };
}

describe('RockField', () => {
  const meshes = new Map([['box', boxRock()]]);
  const placements: RockPlacement[] = [
    { piece: 'box', kind: 'wall', x: 10, y: -0.5, z: 4, yaw: 0.7, scale: 3 },
    { piece: 'box', kind: 'pond', x: -3, y: -1, z: 2, yaw: 0, scale: 1.5 },
  ];
  const field = new RockField(placements, meshes, 0.5);

  it('places one LOD per rock with size- and preset-scaled switch distances', () => {
    expect(field.root.children).toHaveLength(2);
    const wall = field.root.children[0] as THREE.LOD;
    expect(wall.levels).toHaveLength(3);
    const size = Math.max(1, (new THREE.Sphere().copy(meshes.get('box')!.lods[0].boundingSphere!).radius * 2 * 3) / 8);
    expect(wall.levels[1].distance).toBeCloseTo(ROCK_LOD_DISTANCES[0] * size * 0.5, 6);
    expect(wall.levels[2].distance).toBeCloseTo(ROCK_LOD_DISTANCES[1] * size * 0.5, 6);
  });

  it('casts shadows only from scattered rocks and puts pond rocks on the underwater layer', () => {
    const [wall, pond] = field.root.children as THREE.LOD[];
    expect((wall.levels[0].object as THREE.Mesh).castShadow).toBe(false);
    expect((pond.levels[0].object as THREE.Mesh).castShadow).toBe(true);
    expect(pond.levels[0].object.layers.isEnabled(LAYER_UNDERWATER)).toBe(true);
    expect(wall.levels[0].object.layers.isEnabled(LAYER_UNDERWATER)).toBe(false);
  });

  it('builds world-space collision that matches the placement', () => {
    expect(field.collisionRoot.parent).toBeNull();
    const rc = new THREE.Raycaster(new THREE.Vector3(10, 50, 4), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObject(field.collisionRoot, true)[0];
    expect(hit.point.y).toBeCloseTo(-0.5 + 1 * 3, 6); // top of the scaled box
  });
});

describe('rock material hook', () => {
  const stdShader = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });
  it('patches the standard program with moss and the ground blend', () => {
    const s = stdShader() as never as Parameters<typeof patchRockShader>[0];
    patchRockShader(s, createSplatUniforms(), createRockUniforms(new THREE.Texture()));
    expect(s.vertexShader).toContain('vRockPos = (modelMatrix * rockP).xyz;');
    expect(s.fragmentShader).toContain('float rockMoss = 0.0;');
    expect(s.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, 0.95, rockMoss);');
    expect(s.fragmentShader).toContain('#include <map_fragment>'); // kept: the scan's albedo map still applies first
    expect(Object.keys(s.uniforms)).toEqual(expect.arrayContaining(['tTerrainAlbedo', 'tTerrainHeight', 'uRockMoss']));
  });
  it('fails loudly on a missing anchor and keys the program', () => {
    const s = stdShader() as never as Parameters<typeof patchRockShader>[0];
    s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', '');
    expect(() => patchRockShader(s, createSplatUniforms(), createRockUniforms(new THREE.Texture()))).toThrow(/roughnessmap/);
    const m = new THREE.MeshStandardMaterial();
    applyRockMaterial(m, createSplatUniforms(), createRockUniforms(new THREE.Texture()), true);
    expect(m.customProgramCacheKey()).toContain('coveRock');
    expect(m.defines).toMatchObject({ ROCK_LOW: '' });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/world/rocks` → modules not found.

- [ ] **Step 3: Implement**

`src/world/renderLayers.ts`:
```ts
/**
 * Render layers. Layer 0 is seen by the main camera, the pond mirror and the shadow maps. Objects set to
 * LAYER_MAIN_ONLY alone are drawn by the main camera only: grass, particles, motes and light shafts stay out of the
 * mirror (M7b). The region enables this layer on the app camera.
 */
export const LAYER_MAIN_ONLY = 1;

/**
 * Objects that can be seen through the pond surface also enable this layer: the terrain chunks under the pond, the
 * rocks in and beside it, fish (M7b) and Toothless (Task 14). The pond's refraction pre-pass renders only this
 * layer, which keeps it to a handful of draw calls.
 */
export const LAYER_UNDERWATER = 2;
```

`src/world/cove/rockMaterial.ts`:
```ts
import * as THREE from 'three';
import { addCompileHook, type ShaderParams } from '../../render/materials';
import { SPLAT_FRAGMENT_PARS, type SplatUniforms } from '../terrain/splatShader';

/** Region-wide uniforms of the rock hook (shared by every rock material). */
export interface RockUniforms {
  tTerrainHeight: { value: THREE.Texture | null };
  /** Metres above the ground over which the terrain's own surface blends into a rock's base. */
  uRockGroundBlend: { value: number };
  /** 0..1 moss coverage on up-facing rock. */
  uRockMoss: { value: number };
}

export function createRockUniforms(heightTexture: THREE.Texture): RockUniforms {
  return { tTerrainHeight: { value: heightTexture }, uRockGroundBlend: { value: 0.7 }, uRockMoss: { value: 0.85 } };
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vRockPos;
varying vec3 vRockNrm;
`;

const VERTEX = /* glsl */ `
{
  vec4 rockP = vec4(transformed, 1.0);
  vec3 rockN = objectNormal;
  #ifdef USE_INSTANCING
    rockP = instanceMatrix * rockP;
    rockN = mat3(instanceMatrix) * rockN;
  #endif
  vRockPos = (modelMatrix * rockP).xyz;
  vRockNrm = normalize(mat3(modelMatrix) * rockN);
}
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vRockPos;
varying vec3 vRockNrm;
uniform sampler2D tTerrainHeight;
uniform float uRockGroundBlend;
uniform float uRockMoss;
`;

/**
 * After <map_fragment>: moss (the terrain's moss layer, world top-projected) on up-facing surfaces, broken up by
 * noise; on High, the terrain's two strongest splat layers blend into the rock where it meets the ground, so rocks
 * sit in the ground with no seam (spec §7.4).
 */
const MAP_FRAGMENT = /* glsl */ `
#include <map_fragment>
float rockMoss = 0.0;
{
  vec3 rp = vRockPos;
  vec3 rn = normalize(vRockNrm);
  float mossNoise = berkNoise2(rp.xz * 0.45) * 0.65 + berkNoise2(rp.xz * 1.7) * 0.35;
  rockMoss = smoothstep(0.45, 0.8, rn.y) * smoothstep(0.35, 0.6, mossNoise) * uRockMoss;
  vec3 mossAlbedo = texture(tTerrainAlbedo, vec3(rp.xz / uLayerTile[2], 2.0)).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, mossAlbedo, rockMoss);
  #ifndef ROCK_LOW
  vec2 suv = (rp.xz - uTerrainExtent.xy) * uTerrainExtent.zw;
  float ground = 1.0 - smoothstep(0.0, uRockGroundBlend, rp.y - texture(tTerrainHeight, suv).r);
  ground *= smoothstep(-0.4, 0.3, rn.y);
  vec4 sa = texture(tTerrainSplatA, suv);
  vec4 sb = texture(tTerrainSplatB, suv);
  float w[6];
  w[0] = sa.r; w[1] = sa.g; w[2] = sa.b; w[3] = sa.a; w[4] = sb.r; w[5] = sb.g;
  int i1 = 0;
  for (int i = 1; i < 6; i++) if (w[i] > w[i1]) i1 = i;
  int i2 = i1 == 0 ? 1 : 0;
  for (int i = 0; i < 6; i++) if (i != i1 && w[i] > w[i2]) i2 = i;
  vec3 g1 = texture(tTerrainAlbedo, vec3(rp.xz / uLayerTile[i1], float(i1))).rgb;
  vec3 g2 = texture(tTerrainAlbedo, vec3(rp.xz / uLayerTile[i2], float(i2))).rgb;
  vec3 groundAlbedo = mix(g1, g2, w[i2] / max(w[i1] + w[i2], 1e-4));
  diffuseColor.rgb = mix(diffuseColor.rgb, groundAlbedo, ground);
  #endif
}
`;

const ROUGHNESS_FRAGMENT = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.95, rockMoss);
`;

const VERTEX_ANCHORS = ['#include <common>', '#include <project_vertex>'];
const FRAGMENT_ANCHORS = ['#include <common>', '#include <map_fragment>', '#include <roughnessmap_fragment>'];

export function patchRockShader(shader: ShaderParams, splat: SplatUniforms, rock: RockUniforms): void {
  for (const a of VERTEX_ANCHORS) if (!shader.vertexShader.includes(a)) throw new Error(`rock: vertex anchor missing: ${a}`);
  for (const a of FRAGMENT_ANCHORS) if (!shader.fragmentShader.includes(a)) throw new Error(`rock: fragment anchor missing: ${a}`);
  Object.assign(shader.uniforms, splat, rock);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', () => `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <project_vertex>', () => `#include <project_vertex>\n${VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', () => `#include <common>\n${SPLAT_FRAGMENT_PARS}\n${FRAGMENT_PARS}`)
    .replace('#include <map_fragment>', () => MAP_FRAGMENT)
    .replace('#include <roughnessmap_fragment>', () => ROUGHNESS_FRAGMENT);
}

/** Adds the rock hook (key `coveRock`; Low drops the ground blend via the ROCK_LOW define). */
export function applyRockMaterial(material: THREE.MeshStandardMaterial, splat: SplatUniforms, rock: RockUniforms, low: boolean): void {
  if (low) material.defines = { ...(material.defines ?? {}), ROCK_LOW: '' };
  addCompileHook(material, 'coveRock', (shader) => patchRockShader(shader, splat, rock));
}
```

`src/world/cove/rocks.ts`:
```ts
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGltfLoader } from '../../render/loaders';
import { layoutRocks, type PlacementKind, type RockKit, type RockPlacement } from './rockLayout';
import { applyRockMaterial, createRockUniforms } from './rockMaterial';
import { LAYER_UNDERWATER } from '../renderLayers';
import type { CoveRegion } from './cove';

/** LOD1 / LOD2 switch distances for a ~8 m rock; bigger pieces switch proportionally later (× lodDistanceScale). */
export const ROCK_LOD_DISTANCES = [40, 100] as const;

/**
 * Kinds that cast CSM shadows. Wall-ring pieces don't: the terrain wall they dress already casts that shadow, and
 * 40k-triangle casters in every cascade would cost more than they show. Tuning lever if the walls look detached.
 */
const CASTS_SHADOW: ReadonlySet<PlacementKind> = new Set(['floor', 'talus', 'bank', 'pond', 'rim']);

/** Kinds that stand in or beside the pond: seen through the water (LAYER_UNDERWATER). */
const UNDERWATER: ReadonlySet<PlacementKind> = new Set(['pond', 'bank']);

/** One kit piece, loaded: LOD0–2 geometries sharing the source's material, plus the collision geometry. */
export interface RockMeshes {
  lods: THREE.BufferGeometry[];
  collision: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

const meshesByName = (root: THREE.Object3D) => {
  const out = new Map<string, THREE.Mesh>();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.set(o.name, o as THREE.Mesh);
  });
  return out;
};

/** Loads each source GLB (render LODs) and its collision GLB once and splits them into per-piece meshes. */
export async function loadRockKit(loader: GLTFLoader, baseUrl: string, kit: RockKit): Promise<Map<string, RockMeshes>> {
  const out = new Map<string, RockMeshes>();
  const files = [...new Set(kit.pieces.map((p) => p.file))];
  await Promise.all(
    files.map(async (file) => {
      const pieces = kit.pieces.filter((p) => p.file === file);
      const [render, collision] = await Promise.all([loader.loadAsync(baseUrl + file), loader.loadAsync(baseUrl + pieces[0].colFile)]);
      const r = meshesByName(render.scene);
      const c = meshesByName(collision.scene);
      for (const p of pieces) {
        const lods = [0, 1, 2].map((k) => r.get(`${p.name}_LOD${k}`)?.geometry);
        const col = c.get(`${p.name}_col`)?.geometry;
        if (lods.some((g) => !g) || !col) throw new Error(`rock kit: ${p.name} is missing a LOD or its collision mesh in ${file}`);
        const material = r.get(`${p.name}_LOD0`)!.material as THREE.MeshStandardMaterial;
        if (p.ao && material.roughnessMap && !material.aoMap) material.aoMap = material.roughnessMap; // ARM: AO in red
        out.set(p.name, { lods: lods as THREE.BufferGeometry[], collision: col, material });
      }
    }),
  );
  return out;
}

const INVISIBLE = new THREE.MeshBasicMaterial({ visible: false });

/**
 * The placed rocks: one THREE.LOD per placement (render layer 0, so the pond mirrors them) and, separately, one
 * invisible world-space collision mesh per placement for Plan 3's CollisionWorld (never added to the scene).
 */
export class RockField {
  readonly root = new THREE.Group();
  readonly collisionRoot = new THREE.Group();

  constructor(
    readonly placements: readonly RockPlacement[],
    readonly meshes: ReadonlyMap<string, RockMeshes>,
    lodDistanceScale = 1,
  ) {
    this.root.name = 'Rocks';
    this.collisionRoot.name = 'RockCollision';
    for (const p of placements) {
      const m = meshes.get(p.piece);
      if (!m) throw new Error(`rock field: no meshes for ${p.piece}`);
      m.lods[0].computeBoundingSphere();
      const size = Math.max(1, (m.lods[0].boundingSphere!.radius * 2 * p.scale) / 8);
      const lod = new THREE.LOD();
      lod.name = `${p.kind}:${p.piece}`;
      m.lods.forEach((g, k) => {
        const mesh = new THREE.Mesh(g, m.material);
        mesh.castShadow = CASTS_SHADOW.has(p.kind);
        mesh.receiveShadow = true;
        if (UNDERWATER.has(p.kind)) mesh.layers.enable(LAYER_UNDERWATER);
        lod.addLevel(mesh, k === 0 ? 0 : ROCK_LOD_DISTANCES[k - 1] * size * lodDistanceScale, 0.08);
      });
      lod.position.set(p.x, p.y, p.z);
      lod.rotation.y = p.yaw;
      lod.scale.setScalar(p.scale);
      this.root.add(lod);
      const col = new THREE.Mesh(m.collision, INVISIBLE);
      col.name = `col:${p.piece}`;
      col.position.copy(lod.position);
      col.rotation.copy(lod.rotation);
      col.scale.copy(lod.scale);
      this.collisionRoot.add(col);
    }
    this.root.updateMatrixWorld(true);
    this.collisionRoot.updateMatrixWorld(true);
  }

  /** Triangles of the LOD levels currently selected (after a render has updated the LODs). */
  triangles(): number {
    let n = 0;
    for (const o of this.root.children) {
      const lod = o as THREE.LOD;
      const g = (lod.levels[lod.getCurrentLevel()].object as THREE.Mesh).geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    return n;
  }

  dispose(): void {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    for (const m of this.meshes.values()) {
      m.lods.forEach((g) => geos.add(g));
      geos.add(m.collision);
      mats.add(m.material);
    }
    geos.forEach((g) => g.dispose());
    for (const m of mats) {
      for (const t of [m as THREE.MeshStandardMaterial].flatMap((s) => [s.map, s.normalMap, s.roughnessMap, s.metalnessMap, s.aoMap])) t?.dispose();
      m.dispose();
    }
  }
}

/** Loads the kit, lays it out on the region's terrain and adds the rocks (render + collision) to the region. */
export async function addRocks(cove: CoveRegion): Promise<RockField> {
  const dir = `${cove.baseUrl}world/cove/rocks/`;
  const kit = (await (await fetch(`${dir}kit.json`)).json()) as RockKit;
  const meshes = await loadRockKit(createGltfLoader(), dir, kit);
  const uniforms = createRockUniforms(cove.heightTexture);
  for (const m of new Set([...meshes.values()].map((x) => x.material))) applyRockMaterial(m, cove.splat, uniforms, cove.low);
  const field = new RockField(layoutRocks(cove.hf, cove.header, kit.pieces), meshes, cove.app.preset.lodDistanceScale);
  cove.add(field.root);
  cove.addCollision(field.collisionRoot);
  cove.onDispose(() => field.dispose());
  return field;
}
```

`src/world/cove/cove.ts` — wire the rocks in:
- Import: `import { addRocks, type RockField } from './rocks';`
- In `CoveRegion`, after `readonly low: boolean;`, add `rocks: RockField | null = null;`
- In `createCove`, directly after `const cove = new CoveRegion(app, base, header, hf, terrain, splat, layers);`, add `cove.rocks = await addRocks(cove);`

`src/dev/cove/main.ts` — replace the `stats` entry with:
```ts
      stats: () => ({ terrain: c.terrain.stats(), rocks: c.rocks?.placements.length ?? 0, rockTriangles: c.rocks?.triangles() ?? 0, collisionRoots: c.collisionRoots().length, spawn: c.spawnPoints[0] }),
```

- [ ] **Step 4: Run to verify they pass** — `npm test` → all pass (rocks: 5). `npm run typecheck` clean.

- [ ] **Step 5: Visual check** — dev server on 5190, `cove.html?q=high`, console clean. Capture `floor`, `pond` and `wide` to `docs/progress/img/cove/m7-rocks-<preset>.png` and Read them:
  - **Walls:** big rock formations stand at the foot of the walls all round, except in the gully and on the two routes; neither route is blocked.
  - **Grounding:** no piece floats, and no front face starts above the ground.
  - **Blending:** moss grows on the tops, and each rock's base blends into the ground layers at the contact line (High).
  - **Pond:** three boulders break its surface.
  - **Stats:** `berk.cove.stats()` shows about 75–85 rocks. Record `rockTriangles` at `wide`, and `berk.perf()` calls at High and Low.
  - **Look levers:** if the wall ring reads too uniform, the levers are `wallScale`, `wallOverlap`, `upperMinWall` and the per-kind counts. Tune them, never the tests' bounds.
- [ ] **Step 6: Commit** — `feat(cove): rocks in the Cove — LOD kit pieces, moss and ground-blend hook, collision`.

---

### Task 12: The pond

**Needs Task 8; Task 11 for the render layers and the underwater rocks.**

Deviation from spec §4.9, as the controller ruled for M7:
- **Refraction.** N8AO renders opaque and transparent objects in one pass, so there is no opaque colour or depth buffer to refract. The pond therefore renders its own **underwater pre-pass**: the main camera, clipped to below the water plane, drawing `LAYER_UNDERWATER` only, colour + depth, at the reflection scale.
- **Absorption.** It uses the shorter of two paths: the heightfield water depth (smooth, exact for the bed, fades the shore) and the pre-pass depth (anything standing in the water, e.g. Toothless's legs).

**Files:**
- Create: `src/world/water/waterShader.ts`, `src/world/water/waterNormals.ts`, `src/world/water/ripples.ts`, `src/world/water/planarViews.ts`, `src/world/water/pondWater.ts`, `tests/world/water.test.ts`
- Modify: `src/world/cove/cove.ts`, `src/dev/cove/main.ts`
- Output: `docs/progress/img/cove/m7-pond-{high,low,ripples}.png`

**Interfaces:**
- Consumes: `Heightfield`, `TerrainHeader`, `Terrain.enableLayerIn`, `CoveRegion`, `coveGeometry.pondQ`, `renderLayers`.
- Produces:
  - `waterShader.ts`: `MAX_RIPPLES = 16`, `WATER_VERTEX`, `WATER_FRAGMENT`.
  - `waterNormals.ts`: `waterWaves(seed?, count?)`, `waveGradient`, `waterNormalData(size?, seed?, strength?)`, `createWaterNormalTexture()` (integer wave vectors, so it tiles).
  - `ripples.ts`: `RIPPLE_LIFE = 3`, `class RipplePool { slots; spawn(x, z, amp); update(dt); active }`, `class SplashDetector { update(time, spheres) }`.
  - `planarViews.ts`: `mirrorCamera(src, level, out)`, `obliqueClip(camera, plane)` (Lengyel), `mirrorTextureMatrix(mirror, out)`, `class PlanarViews { reflection; refraction (+ depthTexture); reflectMatrix; mirror; refract; fit(renderer); render(renderer, scene, camera, hide); dispose() }`.
  - `pondWater.ts`: `pondRect(header, qMax?, pad?)`, `waterDepthData(ground, level, rect, spacing)`, `POND_LOOK`, `class PondWater { mesh; material; views; ripples; depthTexture; normals; update(dt, time, spheres); dispose() }`, `addPond(cove) → PondWater`.

How the frame works:
- **When the views render.** They run from the water mesh's `onBeforeRender`, only for the main camera, i.e. inside the main frame's beauty render. N8AO's transparency passes hide opaque objects, so the views run exactly once per frame and are counted in `berk.perf()`.
- **Shadows.** By the time they run, the frame's shadow maps are drawn (hardening wave: one update per frame); the views set `shadowMap.autoUpdate = false` while they render and never request an update.
- **Fog.** The water material carries `THREE.UniformsLib.fog`, because the hardening wave's `scene.fog` proxy makes three refresh those uniforms; Berk fog still does the actual fogging.
- **Under water.** No views are rendered while the camera is under the water.

- [ ] **Step 1: Write the failing tests**

`tests/world/water.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { waterWaves, waveGradient, waterNormalData } from '../../src/world/water/waterNormals';
import { RipplePool, SplashDetector, RIPPLE_LIFE } from '../../src/world/water/ripples';
import { MAX_RIPPLES } from '../../src/world/water/waterShader';
import { mirrorCamera, mirrorTextureMatrix, obliqueClip } from '../../src/world/water/planarViews';
import { PondWater, pondRect, waterDepthData } from '../../src/world/water/pondWater';
import { pondPoint, pondQ } from '../../src/world/cove/coveGeometry';
import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';

describe('water normal map', () => {
  it('tiles exactly (integer wave vectors)', () => {
    const w = waterWaves();
    for (const [u, v] of [[0.13, 0.71], [0.5, 0.02], [0.99, 0.4]]) {
      const [a, b] = waveGradient(w, u, v);
      const [c, d] = waveGradient(w, u + 1, v - 1);
      expect(c).toBeCloseTo(a, 9);
      expect(d).toBeCloseTo(b, 9);
    }
  });
  it('stores unit normals with no overall tilt, deterministically', () => {
    const data = waterNormalData(64);
    expect(waterNormalData(64)).toEqual(data);
    let mx = 0;
    let my = 0;
    for (let k = 0; k < 64 * 64; k++) {
      const n = [0, 1, 2].map((c) => (data[k * 4 + c] / 255) * 2 - 1);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 1);
      mx += n[0];
      my += n[1];
    }
    expect(Math.abs(mx / 4096)).toBeLessThan(0.02);
    expect(Math.abs(my / 4096)).toBeLessThan(0.02);
  });
});

describe('ripples', () => {
  it('fills free slots, then replaces the oldest ring, and frees rings when they die', () => {
    const pool = new RipplePool();
    for (let k = 0; k < MAX_RIPPLES; k++) {
      pool.spawn(k, 0, 0.2);
      pool.update(0.01);
    }
    expect(pool.active).toBe(MAX_RIPPLES);
    pool.spawn(99, 0, 0.2);
    expect(pool.slots.find((s) => s.x === 0)).toBeUndefined(); // the first (oldest) ring was replaced
    expect(pool.slots.filter((s) => s.x === 99)).toHaveLength(1);
    pool.update(RIPPLE_LIFE + 0.1);
    expect(pool.active).toBe(0);
  });
  it('rings once when a paw enters the water, again only after it moves or waits', () => {
    const pool = new RipplePool();
    const splash = new SplashDetector(pool, 0, (x) => x < 10, 0.35, 0.3);
    const paw = { center: new THREE.Vector3(0, 0.05, 0), radius: 0.1 };
    splash.update(0, [paw]);
    splash.update(0.1, [paw]);
    expect(pool.active).toBe(1);
    paw.center.x = 0.5;
    splash.update(0.2, [paw]);
    expect(pool.active).toBe(2);
    paw.center.y = 0.5; // lifted out
    splash.update(0.3, [paw]);
    paw.center.set(20, 0.05, 0); // on dry ground
    splash.update(0.4, [paw]);
    expect(pool.active).toBe(2);
  });
});

describe('planar mirror', () => {
  const level = -0.45;
  const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 6000);
  cam.position.set(3, 5, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const project = (m: THREE.Matrix4, p: THREE.Vector3) => {
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(m);
    return [v.x / v.w, v.y / v.w];
  };

  it('looks up, at a point on the water, what the camera sees reflected there', () => {
    const mirror = new THREE.PerspectiveCamera();
    mirrorCamera(cam, level, mirror);
    const tex = mirrorTextureMatrix(mirror, new THREE.Matrix4());
    const x = new THREE.Vector3(-4, 6, -20); // e.g. a point on the far wall
    const image = new THREE.Vector3(x.x, 2 * level - x.y, x.z);
    const t = (level - cam.position.y) / (image.y - cam.position.y);
    const q = cam.position.clone().lerp(image, t); // where the eye ray to the mirror image crosses the water
    const [u1, v1] = project(tex, q);
    const [u2, v2] = project(tex, x);
    expect(u1).toBeCloseTo(u2, 9);
    expect(v1).toBeCloseTo(v2, 9);
  });

  it('clips the mirror view below the water and the refraction view above it', () => {
    const mirror = new THREE.PerspectiveCamera();
    mirrorCamera(cam, level, mirror);
    obliqueClip(mirror, new THREE.Plane(new THREE.Vector3(0, 1, 0), -level));
    const refract = cam.clone();
    refract.updateMatrixWorld();
    obliqueClip(refract, new THREE.Plane(new THREE.Vector3(0, -1, 0), level));
    const ndcZ = (c: THREE.Camera, p: THREE.Vector3) => p.clone().applyMatrix4(c.matrixWorldInverse).applyMatrix4(c.projectionMatrix).z;
    const above = new THREE.Vector3(-1, 3, -6);
    const below = new THREE.Vector3(1, -1.5, -2);
    expect(Math.abs(ndcZ(mirror, above))).toBeLessThan(1);
    expect(ndcZ(mirror, new THREE.Vector3(below.x, level - 0.3, below.z))).toBeLessThan(-1);
    expect(Math.abs(ndcZ(refract, below))).toBeLessThan(1);
    expect(ndcZ(refract, above)).toBeLessThan(-1);
  });
});

const COVE = 'public/assets/world/cove/';
describe.skipIf(!existsSync(`${COVE}terrain.json`))('the pond on the baked terrain', () => {
  const header = JSON.parse(readFileSync(`${COVE}terrain.json`, 'utf8')) as TerrainHeader;
  const hf = Heightfield.fromUint16LE(header, readFileSync(COVE + header.files.height));

  it('covers the pond and its bank with the depth rectangle, deepest at the middle', () => {
    const rect = pondRect(header);
    for (let k = 0; k < 64; k++) {
      const [x, z] = pondPoint(header, 1.6, (k / 64) * Math.PI * 2);
      expect(x > rect[0] && x < rect[2] && z > rect[1] && z < rect[3]).toBe(true);
    }
    const d = waterDepthData(hf, header.waterLevel, rect, header.spacing);
    let max = 0;
    for (let j = 0; j < d.height; j++) {
      for (let i = 0; i < d.width; i++) {
        const x = rect[0] + (i + 0.5) * header.spacing;
        const z = rect[1] + (j + 0.5) * header.spacing;
        const v = d.data[j * d.width + i];
        if (pondQ(header, x, z) > 1.45) expect(v).toBe(0); // dry beyond the bank
        max = Math.max(max, v);
      }
    }
    expect(max).toBeGreaterThan(header.pond.depth - 0.4);
  });

  it('builds a fog-ready water material and renders its views only for the main camera', () => {
    const main = new THREE.PerspectiveCamera();
    const pond = new PondWater(hf, header, main, new THREE.Vector3(0, 1, 0), new THREE.Color(1, 1, 1), 0.25);
    expect(pond.mesh.position.y).toBe(header.waterLevel);
    expect(pond.material.fog).toBe(true);
    expect(pond.material.uniforms).toHaveProperty('fogColor'); // scene.fog (N8AO's proxy) refreshes these
    const untouchable = new Proxy({}, { get: () => { throw new Error('renderer used'); } }) as THREE.WebGLRenderer;
    expect(() => pond.mesh.onBeforeRender(untouchable, new THREE.Scene(), new THREE.PerspectiveCamera(), pond.mesh.geometry, pond.material, null as never)).not.toThrow();
    pond.dispose();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/world/water` → modules not found.

- [ ] **Step 3: Implement**

`src/world/water/waterShader.ts`:
```ts
/** Ring-ripple slots in the water shader's uniform array (spec §4.9: a small ring pool). */
export const MAX_RIPPLES = 16;

export const WATER_VERTEX = /* glsl */ `
uniform mat4 uReflectMatrix;
varying vec4 vReflCoord;
varying vec3 vWaterWorld;
varying vec3 vWaterView;
#include <fog_pars_vertex>
void main() {
  vec3 transformed = position;
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWaterWorld = wp.xyz;
  vReflCoord = uReflectMatrix * wp;
  vec4 mvPosition = viewMatrix * wp;
  vWaterView = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/**
 * Pond surface (spec §4.9): two scrolling normal-map samples plus ring ripples perturb the normal; the opaque
 * pre-pass is looked up in screen space for refraction and absorbed along the water path — the shorter of the
 * heightfield depth (smooth, exact for the bed, fades the shore) and the pre-pass depth (anything standing in the
 * water); the planar mirror is mixed in by Schlick fresnel; the sun glint is clamped.
 */
export const WATER_FRAGMENT = /* glsl */ `
uniform sampler2D tReflection;
uniform sampler2D tRefraction;
uniform sampler2D tRefractionDepth;
uniform mat4 uRefractProjInv;
uniform sampler2D tWaterNormals;
uniform sampler2D tWaterDepth;
uniform vec4 uDepthRect;
uniform vec2 uInvResolution;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAbsorption;
uniform vec3 uDeepColor;
uniform float uGlintMax;
uniform float uWaveStrength;
uniform vec4 uRipples[${MAX_RIPPLES}];
varying vec4 vReflCoord;
varying vec3 vWaterWorld;
varying vec3 vWaterView;
#include <fog_pars_fragment>

// Height-field gradient of the surface at xz → normal. The texture stores unit normals (xy = −gradient).
vec3 waterNormal(vec2 xz) {
  vec2 uv1 = xz * 0.12 + vec2(uTime * 0.012, uTime * 0.007);
  vec2 uv2 = xz * 0.31 + vec2(-uTime * 0.009, uTime * 0.013);
  vec3 n1 = texture2D(tWaterNormals, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tWaterNormals, uv2).xyz * 2.0 - 1.0;
  vec2 slope = -(n1.xy + n2.xy) * uWaveStrength;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    if (r.z < 0.0) continue;
    vec2 d = xz - r.xy;
    float dist = length(d);
    float x = dist - r.z * 0.9;
    float env = exp(-x * x * 6.0) * exp(-r.z * 1.2) * r.w;
    slope += (d / max(dist, 1e-3)) * cos(x * 18.0) * env;
  }
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

void main() {
  vec3 n = waterNormal(vWaterWorld.xz);
  vec3 V = normalize(cameraPosition - vWaterWorld);
  float depth = texture2D(tWaterDepth, (vWaterWorld.xz - uDepthRect.xy) * uDepthRect.zw).r;
  float shore = smoothstep(0.0, 0.25, depth);
  vec2 suv = gl_FragCoord.xy * uInvResolution;
  vec3 refr = texture2D(tRefraction, suv + n.xz * 0.035 * shore).rgb;
  vec4 behind = uRefractProjInv * vec4(suv * 2.0 - 1.0, texture2D(tRefractionDepth, suv).r * 2.0 - 1.0, 1.0);
  float objectPath = max(length(behind.xyz / behind.w) - length(vWaterView), 0.0);
  float path = min(depth / max(abs(V.y), 0.15), objectPath);
  vec3 trans = exp(-uAbsorption * path);
  vec3 under = refr * trans + uDeepColor * (1.0 - trans);
  vec3 refl = texture2D(tReflection, vReflCoord.xy / vReflCoord.w + n.xz * 0.03).rgb;
  float cosT = clamp(dot(n, V), 0.0, 1.0);
  float fresnel = (0.02 + 0.98 * pow(1.0 - cosT, 5.0)) * shore;
  vec3 col = mix(under, refl, fresnel);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 600.0) * 60.0 * shore;
  col += uSunColor * min(spec, uGlintMax);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;
```

`src/world/water/waterNormals.ts`:
```ts
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';

/** One sine term of the procedural wave height field h(u, v) = Σ amp · sin(2π(kx·u + ky·v) + phase). */
export interface WaveTerm {
  kx: number;
  ky: number;
  amp: number;
  phase: number;
}

/** Seeded wave terms with INTEGER wave vectors, so the height field (and its normal map) tiles exactly. */
export function waterWaves(seed = 7, count = 24): WaveTerm[] {
  const rng = mulberry32(seed);
  const out: WaveTerm[] = [];
  while (out.length < count) {
    const kx = Math.round((rng() * 2 - 1) * 9);
    const ky = Math.round((rng() * 2 - 1) * 9);
    const k = Math.hypot(kx, ky);
    if (k < 2) continue;
    out.push({ kx, ky, amp: 1 / k ** 1.6, phase: rng() * Math.PI * 2 });
  }
  return out;
}

/** Gradient (∂h/∂u, ∂h/∂v) of the wave field at (u, v). */
export function waveGradient(waves: readonly WaveTerm[], u: number, v: number): [number, number] {
  let gu = 0;
  let gv = 0;
  for (const w of waves) {
    const c = Math.cos(2 * Math.PI * (w.kx * u + w.ky * v) + w.phase) * w.amp * 2 * Math.PI;
    gu += c * w.kx;
    gv += c * w.ky;
  }
  return [gu, gv];
}

/** RGBA8 unit normals of the wave field, xy = −gradient · strength (z up), `size`² texels covering one tile. */
export function waterNormalData(size = 256, seed = 7, strength = 0.035): Uint8Array {
  const waves = waterWaves(seed);
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [gu, gv] = waveGradient(waves, i / size, j / size);
      const nx = -gu * strength;
      const ny = -gv * strength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const k = (j * size + i) * 4;
      data[k] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  }
  return data;
}

export function createWaterNormalTexture(size = 256, seed = 7): THREE.DataTexture {
  const t = new THREE.DataTexture(waterNormalData(size, seed), size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
```

`src/world/water/ripples.ts`:
```ts
import * as THREE from 'three';
import type { InteractionSphere } from '../region';
import { MAX_RIPPLES } from './waterShader';

/** Seconds a ring lives; the shader's envelope has faded to ~3 % by then. */
export const RIPPLE_LIFE = 3;

/** Fixed pool of expanding rings (spec §4.9), laid out exactly as the water shader's `uRipples` array reads it. */
export class RipplePool {
  /** (x, z, age, amplitude) per slot; age < 0 marks a free slot. */
  readonly slots: THREE.Vector4[] = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -1, 0));

  /** Starts a ring in a free slot, or replaces the oldest one. */
  spawn(x: number, z: number, amplitude: number): void {
    let slot = this.slots.find((s) => s.z < 0);
    if (!slot) slot = this.slots.reduce((a, b) => (b.z > a.z ? b : a));
    slot.set(x, z, 0, amplitude);
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (s.z < 0) continue;
      s.z += dt;
      if (s.z > RIPPLE_LIFE) s.z = -1;
    }
  }

  get active(): number {
    return this.slots.filter((s) => s.z >= 0).length;
  }
}

/**
 * Turns interaction spheres (paws, tail, body) that cross the water surface into rings: one when a sphere first
 * touches the surface, then one per `interval` seconds or `spacing` metres of travel while it stays in the water.
 */
export class SplashDetector {
  private readonly last = new Map<number, { t: number; x: number; z: number }>();

  constructor(
    private readonly pool: RipplePool,
    private readonly level: number,
    private readonly isWater: (x: number, z: number) => boolean,
    private readonly interval = 0.35,
    private readonly spacing = 0.3,
  ) {}

  update(time: number, spheres: readonly InteractionSphere[]): void {
    spheres.forEach((s, k) => {
      const c = s.center;
      const touching = Math.abs(c.y - this.level) < s.radius && this.isWater(c.x, c.z);
      if (!touching) {
        this.last.delete(k);
        return;
      }
      const prev = this.last.get(k);
      if (prev && time - prev.t < this.interval && Math.hypot(c.x - prev.x, c.z - prev.z) < this.spacing) return;
      this.pool.spawn(c.x, c.z, Math.min(0.25, 0.12 + s.radius * 0.5));
      this.last.set(k, { t: time, x: c.x, z: c.z });
    });
  }
}
```

`src/world/water/planarViews.ts`:
```ts
import * as THREE from 'three';
import { LAYER_UNDERWATER } from '../renderLayers';

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _target = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();

/** Mirrors `src` in the horizontal plane y = level (position, view direction and up) into `out`, same projection. */
export function mirrorCamera(src: THREE.PerspectiveCamera, level: number, out: THREE.PerspectiveCamera): void {
  src.updateMatrixWorld();
  _pos.setFromMatrixPosition(src.matrixWorld);
  _dir.set(0, 0, -1).transformDirection(src.matrixWorld);
  _up.set(0, 1, 0).transformDirection(src.matrixWorld);
  _target.copy(_pos).add(_dir);
  out.position.set(_pos.x, 2 * level - _pos.y, _pos.z);
  out.up.set(_up.x, -_up.y, _up.z);
  out.lookAt(_target.x, 2 * level - _target.y, _target.z);
  out.near = src.near;
  out.far = src.far;
  out.projectionMatrix.copy(src.projectionMatrix);
  out.projectionMatrixInverse.copy(src.projectionMatrixInverse);
  out.updateMatrixWorld();
}

/**
 * Lengyel's oblique near plane: after this, `camera` clips (and frustum-culls) everything on the negative side of
 * the world-space `plane` (normal · p + constant < 0). The camera must be on that negative side.
 */
export function obliqueClip(camera: THREE.Camera, plane: THREE.Plane): void {
  _plane.copy(plane).applyMatrix4(camera.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const m = camera.projectionMatrix.elements;
  _q.set((Math.sign(_clip.x) + m[8]) / m[0], (Math.sign(_clip.y) + m[9]) / m[5], -1, (1 + m[10]) / m[14]);
  _clip.multiplyScalar(2 / _clip.dot(_q));
  m[2] = _clip.x;
  m[6] = _clip.y;
  m[10] = _clip.z + 1;
  m[14] = _clip.w;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

/** world → mirror-texture coordinates: bias · projection · view of the mirror camera. */
export function mirrorTextureMatrix(mirror: THREE.Camera, out: THREE.Matrix4): THREE.Matrix4 {
  out.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  return out.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
}

/**
 * The pond's two extra views: a planar mirror above the water plane (layer 0), and an opaque pre-pass of what lies
 * under the water (LAYER_UNDERWATER only; the main camera clipped to below the plane; colour + depth) that the
 * water shader reads in screen space for refraction and absorption — N8AO renders the whole scene in one pass, so
 * there is no opaque-only buffer to borrow. Both are linear HDR at `scale` × the drawing buffer (0.5 High, 0.25 Low).
 * `render` is called from the water mesh's onBeforeRender, i.e. inside the main frame after its shadow maps were
 * drawn: the views reuse those maps and never trigger a shadow update of their own.
 */
export class PlanarViews {
  readonly reflection: THREE.WebGLRenderTarget;
  readonly refraction: THREE.WebGLRenderTarget;
  readonly reflectMatrix = new THREE.Matrix4();
  readonly mirror = new THREE.PerspectiveCamera();
  readonly refract = new THREE.PerspectiveCamera();
  private readonly above: THREE.Plane;
  private readonly below: THREE.Plane;
  private readonly size = new THREE.Vector2();

  constructor(
    readonly level: number,
    readonly scale: number,
  ) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: false };
    this.reflection = new THREE.WebGLRenderTarget(1, 1, opts);
    this.refraction = new THREE.WebGLRenderTarget(1, 1, opts);
    this.refraction.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.above = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level);
    this.below = new THREE.Plane(new THREE.Vector3(0, -1, 0), level);
    this.mirror.layers.set(0);
    this.refract.layers.set(LAYER_UNDERWATER);
  }

  /** Resizes both targets to `scale` × the renderer's drawing buffer (call before rendering; cheap when unchanged). */
  fit(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x * this.scale));
    const h = Math.max(1, Math.round(this.size.y * this.scale));
    if (this.reflection.width !== w || this.reflection.height !== h) {
      this.reflection.setSize(w, h);
      this.refraction.setSize(w, h);
    }
  }

  /** Renders both views of `scene` for `camera`. Objects in `hide` (the water itself) are hidden meanwhile. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: readonly THREE.Object3D[]): void {
    camera.updateMatrixWorld();
    if (camera.getWorldPosition(_pos).y <= this.level + 0.02) return; // under water: no planar views
    this.fit(renderer);
    mirrorCamera(camera, this.level, this.mirror);
    mirrorTextureMatrix(this.mirror, this.reflectMatrix);
    obliqueClip(this.mirror, this.above);
    this.refract.position.copy(camera.position);
    this.refract.quaternion.copy(camera.quaternion);
    this.refract.near = camera.near;
    this.refract.far = camera.far;
    this.refract.projectionMatrix.copy(camera.projectionMatrix);
    this.refract.updateMatrixWorld();
    obliqueClip(this.refract, this.below);

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevXr = renderer.xr.enabled;
    const visible = hide.map((o) => o.visible);
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false; // the main frame's cascades are reused
    for (const o of hide) o.visible = false;
    renderer.state.buffers.depth.setMask(true);
    renderer.setRenderTarget(this.reflection);
    renderer.clear();
    renderer.render(scene, this.mirror);
    renderer.setRenderTarget(this.refraction);
    renderer.clear();
    renderer.render(scene, this.refract);
    hide.forEach((o, k) => (o.visible = visible[k]));
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.xr.enabled = prevXr;
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.reflection.dispose();
    this.refraction.dispose();
  }
}
```

`src/world/water/pondWater.ts`:
```ts
import * as THREE from 'three';
import type { TerrainHeader } from '../terrain/heightfield';
import type { InteractionSphere } from '../region';
import { pondQ } from '../cove/coveGeometry';
import { PlanarViews } from './planarViews';
import { RipplePool, SplashDetector } from './ripples';
import { createWaterNormalTexture } from './waterNormals';
import { WATER_FRAGMENT, WATER_VERTEX } from './waterShader';
import type { CoveRegion } from '../cove/cove';
import { LAYER_UNDERWATER } from '../renderLayers';

export interface HeightSampler {
  heightAt(x: number, z: number): number;
}

/** Axis-aligned world rectangle [x0, z0, x1, z1]. */
export type Rect = [number, number, number, number];

/** Bounding rectangle of the pond ellipse grown to parameter q = `qMax` (the bank), padded by `pad` metres. */
export function pondRect(h: TerrainHeader, qMax = 1.6, pad = 1): Rect {
  const p = h.pond;
  const a = (p.angle * Math.PI) / 180;
  const s = Math.sqrt(qMax);
  const ex = Math.hypot(p.a * s * Math.cos(a), p.b * s * Math.sin(a)) + pad;
  const ez = Math.hypot(p.a * s * Math.sin(a), p.b * s * Math.cos(a)) + pad;
  return [p.cx - ex, p.cz - ez, p.cx + ex, p.cz + ez];
}

/** Water column depth max(level − ground, 0) sampled at texel centres every `spacing` metres over `rect`. */
export function waterDepthData(ground: HeightSampler, level: number, rect: Rect, spacing: number): { data: Float32Array; width: number; height: number } {
  const width = Math.ceil((rect[2] - rect[0]) / spacing);
  const height = Math.ceil((rect[3] - rect[1]) / spacing);
  const data = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      data[j * width + i] = Math.max(level - ground.heightAt(rect[0] + (i + 0.5) * spacing, rect[1] + (j + 0.5) * spacing), 0);
    }
  }
  return { data, width, height };
}

/** Tuned by eye in the Cove preview (Task 12). Absorption is per metre of water path, linear RGB. */
export const POND_LOOK = {
  absorption: new THREE.Vector3(0.55, 0.22, 0.26),
  deepColor: new THREE.Color(0.012, 0.03, 0.028),
  glintMax: 6,
  waveStrength: 0.18,
};

/**
 * The pond (spec §4.9, §7.5): an opaque water plane over the pond rectangle (the terrain occludes it outside the
 * water) whose planar views render from its own onBeforeRender — once per main frame, only when the pond is in
 * view, inside the frame so they reuse its shadow maps. Paws and tail dipping in make rings.
 */
export class PondWater {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly material: THREE.ShaderMaterial;
  readonly views: PlanarViews;
  readonly ripples = new RipplePool();
  readonly depthTexture: THREE.DataTexture;
  readonly normals: THREE.DataTexture;
  private readonly splashes: SplashDetector;
  private readonly resolution = new THREE.Vector2();

  constructor(
    ground: HeightSampler,
    readonly header: TerrainHeader,
    readonly mainCamera: THREE.PerspectiveCamera,
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    reflectionScale: number,
  ) {
    const level = header.waterLevel;
    const rect = pondRect(header);
    const depth = waterDepthData(ground, level, rect, header.spacing);
    const half = new Uint16Array(depth.data.length);
    for (let k = 0; k < half.length; k++) half[k] = THREE.DataUtils.toHalfFloat(depth.data[k]);
    this.depthTexture = new THREE.DataTexture(half, depth.width, depth.height, THREE.RedFormat, THREE.HalfFloatType);
    this.depthTexture.magFilter = this.depthTexture.minFilter = THREE.LinearFilter;
    this.depthTexture.wrapS = this.depthTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.depthTexture.needsUpdate = true;
    this.normals = createWaterNormalTexture();
    this.views = new PlanarViews(level, reflectionScale);
    const w = depth.width * header.spacing;
    const d = depth.height * header.spacing;
    this.material = new THREE.ShaderMaterial({
      name: 'pondWater',
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      fog: true, // Berk fog via the material pipeline; scene.fog (the N8AO proxy) needs the fog uniforms below
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uReflectMatrix: { value: this.views.reflectMatrix },
        tReflection: { value: this.views.reflection.texture },
        tRefraction: { value: this.views.refraction.texture },
        tRefractionDepth: { value: this.views.refraction.depthTexture },
        uRefractProjInv: { value: new THREE.Matrix4() },
        tWaterNormals: { value: this.normals },
        tWaterDepth: { value: this.depthTexture },
        uDepthRect: { value: new THREE.Vector4(rect[0], rect[1], 1 / w, 1 / d) },
        uInvResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uSunDir: { value: sunDir },
        uSunColor: { value: sunColor },
        uAbsorption: { value: POND_LOOK.absorption },
        uDeepColor: { value: POND_LOOK.deepColor },
        uGlintMax: { value: POND_LOOK.glintMax },
        uWaveStrength: { value: POND_LOOK.waveStrength },
        uRipples: { value: this.ripples.slots },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), this.material);
    this.mesh.name = 'PondWater';
    this.mesh.position.set(rect[0] + w / 2, level, rect[1] + d / 2);
    this.mesh.updateMatrixWorld();
    this.mesh.matrixAutoUpdate = false;
    this.splashes = new SplashDetector(this.ripples, level, (x, z) => pondQ(header, x, z) < 1 && ground.heightAt(x, z) < level - 0.05);
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      if (camera !== this.mainCamera) return;
      this.views.render(renderer, scene, this.mainCamera, [this.mesh]);
      renderer.getDrawingBufferSize(this.resolution);
      this.material.uniforms.uInvResolution.value.set(1 / this.resolution.x, 1 / this.resolution.y);
      this.material.uniforms.uRefractProjInv.value.copy(this.views.refract.projectionMatrixInverse);
    };
  }

  /** Per frame: ripple ages, splashes from the interaction spheres, wave time. */
  update(dt: number, time: number, spheres: readonly InteractionSphere[]): void {
    this.ripples.update(dt);
    this.splashes.update(time, spheres);
    this.material.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.views.dispose();
    this.depthTexture.dispose();
    this.normals.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Adds the pond to the region: its mesh, per-frame update (ripples from the region's interaction spheres), disposal. */
export function addPond(cove: CoveRegion): PondWater {
  const app = cove.app;
  const sunColor = new THREE.Color(app.lighting.params.sunColor).multiplyScalar(app.lighting.params.sunIntensity);
  const pond = new PondWater(cove.hf, cove.header, app.camera, app.lighting.sunDir, sunColor, app.preset.reflectionScale);
  cove.terrain.enableLayerIn(LAYER_UNDERWATER, pondRect(cove.header));
  cove.add(pond.mesh);
  cove.onUpdate((dt, ctx) => pond.update(dt, ctx.time, ctx.interactions));
  cove.onDispose(() => pond.dispose());
  return pond;
}
```

`src/world/cove/cove.ts`:
- Imports: `import { LAYER_MAIN_ONLY } from '../renderLayers';` and `import { addPond, type PondWater } from '../water/pondWater';`
- In `CoveRegion`, after `rocks: RockField | null = null;`, add `pond: PondWater | null = null;`
- In `createCove`:
  - directly before `cove.rocks = await addRocks(cove);`, add `app.camera.layers.enable(LAYER_MAIN_ONLY);`
  - directly after it, add `cove.pond = addPond(cove);`

`src/dev/cove/main.ts` — add to the `berk.cove` registration, after `heightAt`:
```ts
      /** Drop a ring on the pond (visual QA of the ripple pool). */
      ripple: (x = 9, z = 6, amp = 0.25) => c.pond?.ripples.spawn(x, z, amp),
```

- [ ] **Step 4: Run to verify they pass** — `npm test` → all pass (water: 8). `npm run typecheck` clean.

- [ ] **Step 5: Visual and cost check**
  - At `?q=high`, `pond` preset: capture `m7-pond-high.png`. Then `berk.cove.ripple(2, 9, 0.3); berk.cove.ripple(6, 13, 0.3)`, wait 1 s, and capture `m7-pond-ripples.png`. At `?q=low`, `pond` preset: capture `m7-pond-low.png`. Read all three.
  - **Mirror:** the far walls and sky mirror in the water (spec §7.8), with nothing below the water line leaking into the reflection.
  - **Refraction:** the pond bed and the submerged parts of the boulders show through, darkening with depth.
  - **Shore:** it fades to clear water with no hard line.
  - **Ripples:** they expand and fade.
  - **Glint:** the sun glint is a clamped sparkle, never a glare column.
  - **Cost:** measure `berk.perf(30)` at `pond` on Low with the pond visible, then again after `berk.cove.region().pond.mesh.visible = false`. The difference is the two views: planning measured +67 calls and +0.57 M triangles. Record both.
  - **Look:** tune `POND_LOOK` by eye against the real bed textures (absorption per metre, deep colour, wave strength) and record the values. The shader and the maths stay as they are.
- [ ] **Step 6: Commit** — `feat(cove): the pond — planar mirror, underwater pre-pass, depth absorption, ripples, clamped glint`.

---

### Task 13: Backdrop, final assembly, visual QA and the Low perf gate

**Needs Tasks 8, 11 and 12.**

**Files:**
- Create: `src/world/cove/backdrop.ts`, `tests/world/backdrop.test.ts`
- Modify: `src/world/cove/cove.ts`, `docs/progress/phase1.md`
- Output: `docs/progress/img/cove/m7a-{wide,rim,floor,pond,gully,shadow,outward}.png` (High) and `m7a-low-{floor,pond}.png`

**Interfaces:**
- Produces: `COVE_BACKDROP`, `squareEdgeRadius(θ, half)`, `backdropGeometry(edgeHeight, half, opts?)`, `createBackdrop(edgeHeight, half, opts?) → Mesh`.
  - The inner ring starts 0.5 m inside the terrain's edge and 0.3 m under it, so the terrain and its skirts hide the join.
  - Hills, then seeded ridge-line peaks (80–280 m) out to 1.6 km, fading into the Berk haze.
  - One draw call; no shadows.

- [ ] **Step 1: Write the failing test**

`tests/world/backdrop.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { backdropGeometry, squareEdgeRadius, COVE_BACKDROP } from '../../src/world/cove/backdrop';

const edge = (x: number, z: number) => 12 + 0.02 * x - 0.01 * z;

describe('backdrop', () => {
  const opts = { ...COVE_BACKDROP, segments: 64, rings: 10 };
  const g = backdropGeometry(edge, 200, opts);
  const pos = g.attributes.position;

  it('measures the square edge in every direction', () => {
    expect(squareEdgeRadius(0, 200)).toBeCloseTo(200, 9);
    expect(squareEdgeRadius(Math.PI / 2, 200)).toBeCloseTo(200, 9);
    expect(squareEdgeRadius(Math.PI / 4, 200)).toBeCloseTo(200 * Math.SQRT2, 9);
  });

  it('starts on the terrain edge, just under it, and reaches the outer radius', () => {
    for (let i = 0; i < opts.segments; i++) {
      const k = i * (opts.rings + 1);
      const x = pos.getX(k);
      const z = pos.getZ(k);
      expect(Math.max(Math.abs(x), Math.abs(z))).toBeCloseTo(200, 3); // float32 positions
      expect(pos.getY(k)).toBeCloseTo(edge(x, z) - 0.3, 4);
      const o = k + opts.rings;
      expect(Math.hypot(pos.getX(o), pos.getZ(o))).toBeCloseTo(opts.outer, 3);
    }
  });

  it('faces up everywhere and is deterministic', () => {
    const idx = g.index!;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let t = 0; t < idx.count / 3; t++) {
      a.fromBufferAttribute(pos, idx.getX(t * 3));
      b.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
      c.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
      expect(b.clone().sub(a).cross(c.clone().sub(a)).y).toBeGreaterThan(0);
    }
    expect(Array.from(backdropGeometry(edge, 200, opts).attributes.position.array)).toEqual(Array.from(pos.array));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement**

`src/world/cove/backdrop.ts`:
```ts
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';

export interface BackdropOptions {
  /** Angular segments around the ring and radial rings from the terrain edge out to `outer` metres. */
  segments: number;
  rings: number;
  outer: number;
  seed: number;
}

export const COVE_BACKDROP: BackdropOptions = { segments: 256, rings: 28, outer: 1600, seed: 1337 };

/** Distance from the origin to the edge of the square [−half, half]² in ground direction (sin θ, −cos θ). */
export function squareEdgeRadius(theta: number, half: number): number {
  return half / Math.max(Math.abs(Math.sin(theta)), Math.abs(Math.cos(theta)));
}

/** Periodic ridge signal in [0, 1] around the ring: a few sharpened seeded sine harmonics (no seam at θ = 2π). */
function ridgeSignal(seed: number): (theta: number) => number {
  const rng = mulberry32(seed);
  const terms = [3, 5, 8, 13, 21].map((k, i) => ({ k, phase: rng() * Math.PI * 2, amp: 1 / (i + 1.2) }));
  const norm = terms.reduce((s, t) => s + t.amp, 0);
  return (theta) => terms.reduce((s, t) => s + t.amp * (1 - Math.abs(Math.sin(t.k * theta * 0.5 + t.phase))) ** 2, 0) / norm;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Low hills, then peaks fading into the haze, around the terrain square (spec §7.2: beyond ~200 m). The inner ring
 * is the square of half-size `half` (just inside the terrain's edge) 0.3 m under the terrain, so the terrain and
 * its chunk skirts hide the join; heights rise outward to a ridge line whose peaks vary around the ring. Vertex
 * colours run forest → bare rock with height.
 */
export function backdropGeometry(edgeHeight: (x: number, z: number) => number, half: number, o: BackdropOptions = COVE_BACKDROP): THREE.BufferGeometry {
  const hills = ridgeSignal(o.seed);
  const peaks = ridgeSignal(o.seed + 1);
  const S = o.segments;
  const R = o.rings;
  const pos = new Float32Array(S * (R + 1) * 3);
  const col = new Float32Array(S * (R + 1) * 3);
  const forest = new THREE.Color(0.035, 0.06, 0.03);
  const rock = new THREE.Color(0.2, 0.21, 0.22);
  const c = new THREE.Color();
  for (let i = 0; i < S; i++) {
    const theta = (i / S) * Math.PI * 2;
    const ux = Math.sin(theta);
    const uz = -Math.cos(theta);
    const r0 = squareEdgeRadius(theta, half);
    const h0 = edgeHeight(ux * r0, uz * r0) - 0.3;
    for (let j = 0; j <= R; j++) {
      const t = j / R;
      const r = r0 + (o.outer - r0) * t ** 1.6;
      const hill = 8 + 22 * hills(theta + t * 0.9);
      const peak = (80 + 200 * peaks(theta)) * smooth(0.25, 0.6, t) * (1 - 0.4 * smooth(0.8, 1, t));
      const h = j === 0 ? h0 : h0 + (hill - h0) * smooth(0, 0.12, t) + peak;
      const k = (i * (R + 1) + j) * 3;
      pos[k] = ux * r;
      pos[k + 1] = h;
      pos[k + 2] = uz * r;
      c.copy(forest).lerp(rock, smooth(45, 160, h));
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < S; i++) {
    const i1 = (i + 1) % S;
    for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j;
      const b = i1 * (R + 1) + j;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export function createBackdrop(edgeHeight: (x: number, z: number) => number, half: number, o: BackdropOptions = COVE_BACKDROP): THREE.Mesh {
  const mesh = new THREE.Mesh(backdropGeometry(edgeHeight, half, o), new THREE.MeshStandardMaterial({ name: 'backdrop', vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.name = 'Backdrop';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
```

`src/world/cove/cove.ts`: import `createBackdrop` from `./backdrop` and add it after the pond. The file now reads in full:

`src/world/cove/cove.ts`:
```ts
import * as THREE from 'three';
import type { App } from '../../app/createApp';
import type { InterestPoint, Region, RegionUpdateContext, SpawnPoint, TreeCapsule } from '../region';
import { LAYER_MAIN_ONLY } from '../renderLayers';
import { Heightfield, type TerrainHeader } from '../terrain/heightfield';
import { Terrain } from '../terrain/terrain';
import { COVE_LAYERS, loadLayerArrays, loadSplatTexture, type LayerArrays } from '../terrain/layers';
import { createSplatMaterial, createSplatUniforms, type SplatUniforms } from '../terrain/splatShader';
import { createHeightTexture, terrainUvTransform } from '../terrain/heightTexture';
import { addRocks, type RockField } from './rocks';
import { addPond, type PondWater } from '../water/pondWater';
import { createBackdrop } from './backdrop';

export interface CoveOptions {
  /** Where `world/cove/` and `textures/terrain/` live (relative URLs resolve from every page). */
  baseUrl?: string;
}

type Updater = (dt: number, ctx: RegionUpdateContext) => void;

/**
 * The Cove region (spec §7). Built by `createCove`; its parts (rocks, pond, backdrop, M7b vegetation and life)
 * attach through `add`, `addCollision`, `onUpdate` and `onDispose`, so the region stays the single owner of
 * everything it puts in the scene.
 */
export class CoveRegion implements Region {
  readonly id = 'cove';
  readonly bounds: THREE.Box3;
  readonly transform = new THREE.Matrix4();
  readonly spawnPoints: readonly SpawnPoint[];
  readonly interestPoints: InterestPoint[] = [];
  readonly root = new THREE.Group();
  readonly heightTexture: THREE.DataTexture;
  readonly capsules: TreeCapsule[] = [];
  /** Low preset: cheaper shader variants (no triplanar rock, no rock ground blend). */
  readonly low: boolean;
  rocks: RockField | null = null;
  pond: PondWater | null = null;
  private readonly collision: THREE.Object3D[] = [];
  private readonly updaters: Updater[] = [];
  private readonly disposers: Array<() => void> = [];

  constructor(
    readonly app: App,
    readonly baseUrl: string,
    readonly header: TerrainHeader,
    readonly hf: Heightfield,
    readonly terrain: Terrain,
    readonly splat: SplatUniforms,
    readonly layers: LayerArrays,
  ) {
    this.root.name = 'Cove';
    this.low = app.preset.name === 'low';
    const half = ((hf.size - 1) * hf.spacing) / 2;
    this.bounds = new THREE.Box3(new THREE.Vector3(-half, header.stats.heightMin ?? -8, -half), new THREE.Vector3(half, header.stats.heightMax ?? 72, half));
    this.spawnPoints = header.spawn.map((s) => ({ ...s }));
    this.heightTexture = createHeightTexture(hf);
    this.interestPoints.push({ id: 'pond', kind: 'water', position: new THREE.Vector3(header.pond.cx, header.waterLevel, header.pond.cz), weight: 0.3 });
    this.root.add(terrain.root);
    this.disposers.push(() => {
      terrain.dispose();
      terrain.material.dispose();
      layers.dispose();
      this.heightTexture.dispose();
      splat.tTerrainSplatA.value?.dispose();
      splat.tTerrainSplatB.value?.dispose();
    });
  }

  heightAt(x: number, z: number): number {
    return this.hf.heightAt(x, z);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.hf.normalAt(x, z, out);
  }

  collisionRoots(): THREE.Object3D[] {
    return [this.terrain.collisionRoot, ...this.collision];
  }

  treeCapsules(): readonly TreeCapsule[] {
    return this.capsules;
  }

  /** Adds a render subtree: every material goes through the app pipeline (CSM + fog). */
  add(object: THREE.Object3D): void {
    this.app.materials.prepareTree(object);
    this.root.add(object);
  }

  /** Adds an invisible collision subtree (world-space meshes; never rendered). */
  addCollision(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    this.collision.push(root);
  }

  onUpdate(fn: Updater): void {
    this.updaters.push(fn);
  }

  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  update(dt: number, ctx: RegionUpdateContext): void {
    this.terrain.update(ctx.camera);
    for (const u of this.updaters) u(dt, ctx);
  }

  dispose(): void {
    for (const d of this.disposers.splice(0).reverse()) d();
    this.app.remove(this.root);
  }
}

/**
 * Loads and assembles the Cove — terrain, rocks, pond, backdrop — adds it to the app, sets the golden-hour sun and
 * compiles every shader before resolving (so the first frames don't hitch).
 */
export async function createCove(app: App, opts: CoveOptions = {}): Promise<CoveRegion> {
  const base = opts.baseUrl ?? 'assets/';
  const header = (await (await fetch(`${base}world/cove/terrain.json`)).json()) as TerrainHeader;
  const low = app.preset.name === 'low';
  const [heightBuf, layers, splatA, splatB] = await Promise.all([
    fetch(`${base}world/cove/${header.files.height}`).then((r) => r.arrayBuffer()),
    loadLayerArrays(`${base}textures/terrain/`, COVE_LAYERS, low ? 512 : 1024),
    loadSplatTexture(`${base}world/cove/${header.files.splatA}`),
    loadSplatTexture(`${base}world/cove/${header.files.splatB}`),
  ]);
  const hf = Heightfield.fromUint16LE(header, heightBuf);
  const splat = createSplatUniforms();
  splat.tTerrainAlbedo.value = layers.albedo;
  splat.tTerrainNormal.value = layers.normal;
  splat.tTerrainArmh.value = layers.armh;
  splat.tTerrainSplatA.value = splatA;
  splat.tTerrainSplatB.value = splatB;
  terrainUvTransform(hf, splat.uTerrainExtent.value);
  const terrain = new Terrain(hf, createSplatMaterial(splat, low), app.preset.lodDistanceScale);
  const cove = new CoveRegion(app, base, header, hf, terrain, splat, layers);
  app.camera.layers.enable(LAYER_MAIN_ONLY);
  cove.rocks = await addRocks(cove);
  cove.pond = addPond(cove);
  // the terrain spans [origin, origin + (size − 1)·spacing]; the backdrop's inner ring starts 0.5 m inside it
  const inner = Math.min(-hf.origin, hf.origin + (hf.size - 1) * hf.spacing) - 0.5;
  cove.add(createBackdrop((x, z) => hf.heightAt(x, z), inner));
  app.materials.prepareTree(cove.root);
  app.scene.add(cove.root);
  app.setSun(header.sun.azimuth, header.sun.elevation);
  await app.renderer.compileAsync(app.scene, app.camera);
  return cove;
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test` → all pass (backdrop: 3). `npm run typecheck` clean. `npm run build` succeeds.

- [ ] **Step 5: Visual QA (spec §8.4 set, without Toothless)**
  - At `?q=high`, capture every preset (`wide`, `rim`, `floor`, `pond`, `gully`, `shadow`, `outward`) to `m7a-<preset>.png`, and `floor` and `pond` at `?q=low` to `m7a-low-<preset>.png`. Read every image.
  - Compare against the Task 8 captures and the checks of Tasks 8, 11 and 12.
  - **Outward:** the gully opens onto hills and a haze-softened peak line, with no seam or gap at the terrain edge.
  - **Look risks seen while planning:**
    - from high views, the gully reads as a straight trench and route A's terraces as a staircase
    - the flank outcrops soften both
    - if they still read as man-made, record it for the M7 look review with the user; don't re-shape the bake here
- [ ] **Step 6: Perf gate on Low (spec §4.10, §8.5)**
  - The automated browser is the Iris Xe. On `?q=low`, at each of `wide`, `rim`, `floor`, `pond` and `gully`, run `berk.perf(30)`: **≤ 33 ms/frame** (≥ 30 fps).
  - At `?q=high` record the same, plus `berk.cove.stats()`. Budget: main-view triangles (terrain + rocks) ≤ 2.4 M; whole-frame draw calls ≤ 480.
  - If Low misses:
    - first turn the pond mirror to every other frame: add `if (++this.frame % 2) return;` at the top of `PlanarViews.render` for Low only
    - then `lodDistanceScale`
    - then the rock LOD distances
    - Record what was changed.
  - If the Chrome GPU preference has been switched to the RTX (with the user's OK, spec §4.11), measure High too; otherwise say High was not measured.
  - Console clean at both presets.
- [ ] **Step 7: Progress log** — add an "M7a — the Cove (ground)" section to `docs/progress/phase1.md` with:
  - the captures, the perf/budget table (Low and High), the rock count and triangle numbers
  - the pond cost, the tuned `POND_LOOK`
  - the known look risks
- [ ] **Step 8: Commit** — `feat(cove): backdrop peaks, final Cove assembly, visual QA and Low perf gate`.

---

### Task 14: Toothless in the Cove — game page, climb routes, QA

**Needs Plan 3 (M5 motion core: `CollisionWorld`, `DragonCharacter`, `OrbitCamera`, `runLabScript`, the game page of its Task 16) and Plan 2's exported Toothless.** Merge both into `phase1-cove` first. This task's code was written against those plans' documented APIs; it could not be run while planning.

**Files:**
- Modify: `src/main.ts` (Plan 3 Task 16's game page)
- Create: `src/dev/lab/coveScripts.ts`, `tests/lab/coveRoutes.test.ts`
- Output: `docs/progress/img/cove/m7a-toothless-{face,three-quarter,gallop,pond,rim,wide}.png`

**Interfaces:**
- Consumes:
  - `createCove`, `CoveRegion`, `LAYER_UNDERWATER`, `coveGeometry` (`azimuthDir`, `headingOfAzimuth`, `pondPoint`, `wallHeightAt`), `terrainCollisionRoot`, `Heightfield`
  - Plan 3: `CollisionWorld.fromObjects`, `DragonCharacter` (`planner.paws[k].pos`, `proxies.items[k].radius`, `proxies.centers[k]`, `kin.pos`), `OrbitCamera`, `cameraFollow`, `runLabScript`, `LabScript`, `mergeTuning`, `DEFAULT_TUNING`
  - Plan 2: `loadDragonAsset`
- Produces:
  - `coveScripts(header) → CoveRun[]`: `interface CoveRun { script: LabScript; goal: { minTop?; maxTop?; minAlong?: { azimuth; along } } }`
  - the route gate test
  - the game page in the Cove, with `berk.spot(name)` (`spawn` | `pond` | `rim` | `gully`)

- [ ] **Step 1: Write the failing route test**

`tests/lab/coveRoutes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';
import { terrainCollisionRoot } from '../../src/world/terrain/collisionMesh';
import { rayFrame } from '../../src/world/cove/coveGeometry';
import { CollisionWorld } from '../../src/world/collision';
import { runLabScript } from '../../src/dev/lab/labRunner';
import { coveScripts } from '../../src/dev/lab/coveScripts';
import { mergeTuning, DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';

const COVE = 'public/assets/world/cove/';
const RIG = 'public/assets/characters/toothless/toothless.rig.json';
const TUNING = 'public/assets/characters/toothless/motion-tuning.json';

// Terrain collision only: Task 10's layout keeps every rock out of the routes and the gully (tested there).
describe.skipIf(!existsSync(RIG) || !existsSync(`${COVE}terrain.json`))('Toothless on the Cove routes (spec §6.6)', () => {
  const header = JSON.parse(readFileSync(`${COVE}terrain.json`, 'utf8')) as TerrainHeader;
  const hf = Heightfield.fromUint16LE(header, readFileSync(COVE + header.files.height));
  const world = CollisionWorld.fromObjects([terrainCollisionRoot(hf)]);
  const rig = JSON.parse(readFileSync(RIG, 'utf8')) as MotionRig;
  const tuning = mergeTuning(DEFAULT_TUNING, existsSync(TUNING) ? JSON.parse(readFileSync(TUNING, 'utf8')) : undefined);
  for (const run of coveScripts(header)) {
    it(run.script.name, { timeout: 600_000 }, () => {
      let top = -Infinity;
      const end = new THREE.Vector3();
      const r = runLabScript({ rig, world, script: run.script, tuning, onStep: (d) => { top = Math.max(top, d.kin.pos.y); end.copy(d.kin.pos); } });
      expect(r.failures, JSON.stringify(r)).toEqual([]);
      if (run.goal.minTop !== undefined) expect(top).toBeGreaterThan(run.goal.minTop);
      if (run.goal.maxTop !== undefined) expect(top).toBeLessThan(run.goal.maxTop);
      if (run.goal.minAlong) expect(rayFrame(end.x, end.z, run.goal.minAlong.azimuth).along).toBeGreaterThan(run.goal.minAlong.along);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/lab/coveRoutes` → `Cannot find module '../../src/dev/lab/coveScripts'`.

- [ ] **Step 3: Implement the scripts**

`src/dev/lab/coveScripts.ts`:
```ts
import type { InputEvent } from '../../core/input';
import type { TerrainHeader } from '../../world/terrain/heightfield';
import { azimuthDir, headingOfAzimuth, wallHeightAt } from '../../world/cove/coveGeometry';
import type { LabScript } from './scripts';

export interface CoveRun {
  script: LabScript;
  /** Highest body height reached (m), and/or how far along a compass ray the run must end. */
  goal: { minTop?: number; maxTop?: number; minAlong?: { azimuth: number; along: number } };
}

const hold = (keys: string[], from: number, to: number): InputEvent[] => [{ t: from, down: keys }, { t: to, up: keys }];

/** A run starting `along` metres out on compass ray `azimuth`, heading outward. */
function ray(name: string, description: string, azimuth: number, along: number, duration: number, events: InputEvent[]): LabScript {
  const [x, z] = azimuthDir(azimuth);
  return { name, description, spawn: { x: x * along, z: z * along, heading: headingOfAzimuth(azimuth) }, duration, events };
}

/**
 * The Cove's designed ways out (spec §6.6, §7.2) and one wall that must stay blocked. Heights come from the
 * header, so a re-bake keeps the goals honest.
 */
export function coveScripts(h: TerrainHeader): CoveRun[] {
  const a = h.routeA;
  const b = h.routeB;
  const g = h.gully;
  return [
    {
      script: ray('cove-route-a', 'trot up the scramble terraces (2.2 m risers: scramble-ups)', a.azimuth, a.rStart - 6, 24, hold(['KeyW'], 0.1, 22)),
      goal: { minTop: a.steps * a.rise - 1.5, minAlong: { azimuth: a.azimuth, along: a.rStart + a.steps * a.tread } },
    },
    {
      script: ray('cove-route-b', 'climb the 45–70° slope out of the hollow', b.azimuth, b.r0 - 6, 24, hold(['KeyW'], 0.1, 22)),
      goal: { minTop: wallHeightAt(h, b.azimuth) - 1.5, minAlong: { azimuth: b.azimuth, along: b.r1 } },
    },
    {
      script: ray('cove-gully', 'gallop out through the gully (≤ 20°: walkable)', g.azimuth, 20, 14, hold(['KeyW', 'ShiftLeft'], 0.1, 13)),
      goal: { minAlong: { azimuth: g.azimuth, along: 90 } },
    },
    {
      script: ray('cove-east-wall', 'walk into the tall east wall (> 70°): blocked', 110, 26, 8, hold(['KeyW'], 0.1, 7)),
      goal: { maxTop: 3 },
    },
  ];
}
```

- [ ] **Step 4: Run the route gates** — `npm test -- tests/lab/coveRoutes`: all four runs pass every spec §8.2 metric and reach their goals.
  - Tune with Plan 3's levers (`tuning.ts`, its Task 15 Step 8 table) and commit the preset. **Never loosen a threshold or a goal.**
  - If a route itself violates the §6.6 rules, fix the shape in `pipeline/terrain/coveShape.mjs` and re-bake (Task 4); the terrain tests of Tasks 2–4 must stay green. Record which route and why.

- [ ] **Step 5: Game page** — change Plan 3's `src/main.ts`:
  - The Cove replaces the test scene.
  - The collision world is built from `cove.collisionRoots()`, and he spawns at `cove.spawnPoints[0]`.
  - The region updates after the camera each frame, with his paws and body spheres as interaction spheres (ripples now, M7b's grass trample later).
  - His meshes enable `LAYER_UNDERWATER` so his legs show through the pond.
  - `berk.spot(name)` teleports him to a QA spot.

Everything else is Plan 3's code, unchanged:
```ts
import './styles.css';
import * as THREE from 'three';
import { createApp } from './app/createApp';
import { debug } from './core/debug';
import { KeyboardMouseInput } from './core/input';
import { CollisionWorld } from './world/collision';
import { createCove } from './world/cove/cove';
import { azimuthDir, headingOfAzimuth, pondPoint } from './world/cove/coveGeometry';
import { LAYER_UNDERWATER } from './world/renderLayers';
import type { InteractionSphere } from './world/region';
import { loadDragonAsset } from './characters/dragon/asset';
import { DragonCharacter } from './characters/dragon/motion/dragon';
import { loadPosesMeta } from './characters/dragon/motion/poseLayers';
import { loadTuning } from './characters/dragon/motion/tuning';
import { OrbitCamera } from './camera/orbitCamera';
import { applyDitherFade, dragonFade } from './characters/dragon/fade';
import { cameraFollow } from './dev/lab/labRunner';

const app = createApp(document.getElementById('app')!);
const hud = document.getElementById('hud')!;
hud.textContent = 'Loading the Cove…';

async function start(): Promise<void> {
  const cove = await createCove(app);
  const world = CollisionWorld.fromObjects(cove.collisionRoots());
  hud.textContent = 'Loading Toothless…';
  const [asset, posesMeta, tuning] = await Promise.all([
    loadDragonAsset({
      glbUrl: 'assets/characters/toothless/toothless.glb', posesUrl: 'assets/characters/toothless/toothless.poses.glb',
      rigUrl: 'assets/characters/toothless/toothless.rig.json', sunDir: app.lighting.sunDir, prepare: (m) => app.materials.prepare(m),
    }),
    loadPosesMeta('assets/characters/toothless/toothless.poses.json'),
    loadTuning(),
  ]);
  applyDitherFade(['skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal'].map((n) => asset.materials.byName(n)!));
  asset.root.traverse((o) => o.layers.enable(LAYER_UNDERWATER)); // his legs show through the pond
  app.add(asset.root);
  const dragon = new DragonCharacter({ rig: asset.rig, world, tuning, clips: asset.clips, posesMeta, seed: 1 });
  const s = cove.spawnPoints[0];
  dragon.spawn(s.x, s.z, s.heading);
  const cam = new OrbitCamera(tuning.camera, world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(dragon, hold));
  const canvas = app.renderer.domElement;
  const input = new KeyboardMouseInput(window, () => document.pointerLockElement === canvas);
  canvas.addEventListener('click', () => void canvas.requestPointerLock());
  const prevCam = new THREE.Vector3();
  const curCam = new THREE.Vector3();
  app.loop.addSim((dt) => {
    const inp = input.sample(app.loop.simTime);
    prevCam.copy(cam.position);
    cam.update(inp, cameraFollow(dragon, hold), dt);
    curCam.copy(cam.position);
    dragon.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
  });
  app.loop.addRender((alpha) => {
    dragon.writeTo(asset.bones, alpha);
    dragonFade.value = cam.fade;
    app.camera.position.lerpVectors(prevCam, curCam, alpha);
    app.camera.lookAt(cam.target);
  }, 0);
  /** Paws and body spheres push grass (M7b) and ring the pond. */
  const spheres: InteractionSphere[] = [];
  app.loop.addRender((_alpha, frameDt) => {
    spheres.length = 0;
    for (const p of dragon.planner.paws) spheres.push({ center: p.pos, radius: 0.14 });
    dragon.proxies.items.forEach((item, k) => spheres.push({ center: dragon.proxies.centers[k], radius: item.radius }));
    cove.update(frameDt, { time: app.loop.simTime, camera: app.camera, interactions: spheres });
  }, 10);
  const PRESETS: Record<string, [number, number, number]> = { hero: [2.4, 12, 6], side: [Math.PI / 2, 8, 7], low: [2.8, 2, 5], wide: [2.6, 25, 16] };
  const [px, pz] = pondPoint(cove.header, 1.35, Math.PI); // west bank, looking east across the water
  const [rx, rz] = azimuthDir(cove.header.routeA.azimuth);
  const rimAlong = cove.header.routeA.rStart + cove.header.routeA.steps * cove.header.routeA.tread + 3;
  const SPOTS: Record<string, [number, number, number]> = {
    spawn: [s.x, s.z, s.heading],
    pond: [px, pz, Math.atan2(cove.header.pond.cx - px, cove.header.pond.cz - pz)],
    rim: [rx * rimAlong, rz * rimAlong, headingOfAzimuth(cove.header.routeA.azimuth + 180)],
    gully: [azimuthDir(cove.header.gully.azimuth)[0] * 45, azimuthDir(cove.header.gully.azimuth)[1] * 45, headingOfAzimuth(cove.header.gully.azimuth + 180)],
  };
  const tp = (x: number, z: number, heading = dragon.kin.heading) => {
    dragon.spawn(x, z, heading);
    cam.reset(cameraFollow(dragon, hold));
  };
  debug.register(null, {
    tp,
    spot: (name: string) => (SPOTS[name] ? (tp(...SPOTS[name]), name) : Object.keys(SPOTS)),
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
  debug.register('cove', { region: () => cove, stats: () => ({ terrain: cove.terrain.stats(), rocks: cove.rocks?.triangles() ?? 0 }) });
  hud.textContent = `Isle of Berk · click to control · WASD move · Shift gallop · C prowl · mouse look · wheel zoom · quality: ${app.preset.name}`;
}

start().catch((e) => {
  console.error('[game] failed to load', e);
  hud.textContent = 'The Cove failed to load — see the console';
});
app.loop.start();
```

- [ ] **Step 6: Typecheck and tests** — `npm run typecheck` clean; `npm test` all pass.

- [ ] **Step 7: Play check and visual QA with Toothless (spec §8.4)**
  - Open `http://localhost:5190/?q=low`: console clean.
  - Capture:
    - `berk.spot('spawn')` + `berk.cam.preset('hero')` → `m7a-toothless-face.png`
    - `preset('wide')` → `m7a-toothless-three-quarter.png`
    - hold Shift+W with `press_key`, then `preset('side')` → `m7a-toothless-gallop.png`
    - `berk.spot('pond')`, walk him into the shallows → `m7a-toothless-pond.png` (his reflection, legs through the water, rings at his paws)
    - `berk.spot('rim')` → `m7a-toothless-rim.png` (from the rim looking down)
    - `preset('wide')` from the spawn → `m7a-toothless-wide.png`
  - Read each. Check:
    - he stands on the terrain and on rocks with planted paws
    - he climbs route A and route B when driven onto them, and is blocked by the east wall
    - the camera never enters rock
  - `berk.perf(30)` on Low at the spawn and the pond: ≤ 33 ms.
- [ ] **Step 8: Progress log and commit**
  - Add the Toothless captures, the route-gate results and any tuning to the M7a section of `docs/progress/phase1.md`.
  - Commit: `feat(game): Toothless in the Cove — game page, climb-route gates, pond interaction`.

---

## Self-Review

**1. Spec coverage**

| Spec | Where |
|---|---|
| §7.1 region contract | Task 1 `Region` · Task 8 `CoveRegion` (bounds, transform, `heightAt`, `normalAt`, collision roots, spawn, interest points, `update`, `dispose` via `App.remove`) · `load()` is the async factory |
| §7.2 layout: floor 70 m, rim 100 m, walls 15–25 m, pond 35 × 25 × 2.5 m with boulders, gully, two routes, rim forest, hills, peaks | Tasks 2–4 bake; Task 10 pond boulders; Task 13 backdrop. Walls are 14–25 m: 14 m at the gully side, lowered so the sun reaches half the floor. Forest is M7b. |
| §7.3 terrain: 1024² × 0.4 m 16-bit, shape functions, erosion, masks; 64 m chunks with LOD and skirts; six layers, height blend, triplanar, macro, far UV, wet | Tasks 2–8 |
| §7.4 rock walls: scans ≤ 60k tris, baked normals, LODs, collision, kit-bashed ring, terrain blend at the base, moss on top | Tasks 9–11 |
| §7.5 pond: bed, wet banks, boulders; reeds/tufts in M7b | Tasks 4 (wet mask, pebbles), 10, 12 |
| §7.8 lighting: 12–15° WNW sun, half light / half shadow, pond mirrors the walls | Task 4 (`floorLitFraction` test), Task 12 |
| §7.10 manifest + credits | Tasks 6 and 9 go through `pipeline/cc0` |
| §4.4 fog, clamped glint | Berk fog on every Cove material; glint clamp in `WATER_FRAGMENT` |
| §4.9 pond water | Task 12. Deviation: refraction and absorption come from an underwater pre-pass plus heightfield depth, because N8AO provides no opaque buffer (controller note 1). |
| §4.10 budgets, §8.5 Low ≥ 30 fps | Task 13 Step 6; Task 14 Step 7 |
| §6.6 climbing routes | Task 2 (shape tests) · Task 10 (corridors clear) · Task 14 (Toothless runs) |
| §8.4 camera set | Tasks 8 and 13 without Toothless; Task 14 with him |

**2. Placeholder scan**
- No TBD or TODO. Every code step carries complete code except Task 14.
- Task 14's `src/main.ts` and scripts are complete code, but they were written against Plan 3's documented API and not run.

**3. Type and name consistency**
- `KitPiece.base` is written by `rocks.py` `front_base` and read by `layoutRocks`, its test and the fixture.
- `RockMeshes`: `loadRockKit` → `RockField` → `addRocks`. `CoveRegion.{baseUrl, low, rocks, pond}` are used by `addRocks`, `addPond` and the preview.
- `LAYER_UNDERWATER` is set on the pond-rect chunks (`Terrain.enableLayerIn`), on pond and bank rocks, and on Toothless; it is the only layer the refraction camera renders.
- `LAYER_MAIN_ONLY` is enabled on the app camera in Task 12, ready for M7b.
- Hook keys: `terrainSplat`, `coveRock`. Defines: `TERRAIN_LOW`, `ROCK_LOW`.
- Plan 3 names used in Task 14: `planner.paws[k].pos`, `proxies.items/centers`, `kin.pos`, `runLabScript({ onStep })`, `LabScript`.

**4. Cross-plan dependencies**
- Task 9 needs Plan 2's runner and library; Task 14 needs Plans 2 and 3.
- Tasks 8–14 assume Plan 1's hardening wave: `App.remove`, the `scene.fog` proxy, manual shadow updates.
- Task 6 and Task 9 edit Plan 1's `wanted.json`: additive, plus `rock_moss_set_01` 1k → 2k.

**5. Known risks, carried to the report**
- Look: the gully reads as a trench and route A as stairs from above.
- The pond's pale-cyan base colour needs look-dev with the real bed textures.
- The Low perf gate is unmeasured on the Iris Xe; the fallback levers are listed in Task 13.
- The rock GLBs add about 20 MB to git (no LFS).
