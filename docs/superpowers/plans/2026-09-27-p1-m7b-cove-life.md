# Phase 1 · M7b The Cove — Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** Bring the Cove to life on top of Plan M7a's ground:
- the rim forest: game-ready conifers with needle cards baked from Poly Haven scans, LODs and octahedral impostors
- wind
- geometric grass trampled by Toothless
- ferns, shrubs, logs, stumps, flowers and reeds
- fish, dragonflies, butterflies, a bird flock and falling leaves
- light shafts and motes

Then pass the Cove's perf gates and the M7 look review.

**Architecture:**
- **Region wiring.** Everything hangs off the M7a `CoveRegion` through one module, `src/world/cove/coveLife.ts`. Its `addCoveLife(cove)` runs after the pond and adds each part through the region's `add` / `addCollision` / `onUpdate` / `onDispose`.
- **Offline.** Blender builds the needle atlas (a Cycles high→card bake of the `fir_sapling` scan) and eight conifer variants (LOD0 and LOD1 in one shared `trees.glb`). Scanned props reuse M7a's rock pipeline (`rocks.py --kit prop_kit.json`). A Node step derives a vegetation density map from the splat maps.
- **Runtime.** The runtime is instanced throughout:
  - Trees are re-bucketed by distance into LOD0 / LOD1 / impostor `InstancedMesh`es. The impostors are baked at load from LOD1 into hemi-octahedral atlases.
  - Grass is camera-following tiles of instanced blades.
  - Life animates in vertex hooks.
- **Materials and layers.** Every material goes through the app pipeline with a pure hook key (`vegWind`, `treeImpostor`, `grassBlade`, `lifeSwim`, `lifeFlap`). Grass, leaves, shafts and motes live on `LAYER_MAIN_ONLY`. Fish and reeds are on `LAYER_UNDERWATER`, so the pond's refraction pre-pass sees them.

**Tech Stack:** three 0.186.1 (instancing, `InstancedBufferGeometry`, `DataTexture` mip chains, `Points`), Blender 5.1.2 headless (Cycles bakes, bmesh, glTF + `EXT_texture_webp`), Node 24 + sharp 0.35.4, Vitest 5, TypeScript 7.

**Spec:** `docs/superpowers/specs/2026-09-26-phase1-vertical-slice-design.md`:
- §7.6 trees, §7.7 ground cover and props, §7.8 light shafts, §7.9 ambient life
- §4.6 AO and transparents, §4.7 alpha-to-coverage, §4.10 budgets
- §6.14 trees as capsules, §8.4–8.5 QA and perf gates
- §12 (motes must not read as snow)

**Branch and workspace:**
- Continues on `phase1-cove` after Plan M7a is complete (it needs M7a Tasks 8–13; the Toothless trample in the final QA uses M7a Task 14).
- Tasks 3, 4 and 8 run Blender through Plan 2's `pipeline/blender/run.ps1`, which is already merged for M7a Task 9.

**Pre-validated while planning** (scratch copy of the engine plus M7a, in the session scratchpad):
- **Code and tests.** Every TypeScript file in this plan typechecks against M7a's code. Their unit tests pass (**89 tests across 20 files** with M7a's). The Blender builder tests (tree + rock) pass inside Blender 5.1.2.
- **The M7b region on the real Cove** rendered in headless Chrome (SwiftShader) with a clean console. It had everything in this plan except the scanned props, which reuse M7a's validated rock pipeline:
  - **Forest:** 1794 trees from the layout. At the `wide` camera, 37 are at LOD0, 315 at LOD1 and 1442 are impostors. Trunk capsules: 857.
  - **Impostors** baked at load: hemi-octahedral 8 × 8 frames, compiled and lit, matching their meshes side by side.
  - **Grass:** about 45k blades within 60 m on the density map, kept out of the pond mirror.
  - **Also present:** flowers, reeds, fish in the refraction, dragonflies, butterflies, birds, leaves, soft light shafts and capped motes.
  - **Whole frame at High (`wide`):** 620 draw calls, 5.7 M triangles; this includes 4 CSM cascades, N8AO and the mirror. Task 11 brings it into budget.
- **Needle atlas.**
  - The `fir_sapling` scan (three saplings, needles as real geometry, about 150k triangles each) baked onto cards in 5 s per view; coverage 18–31 % per cell.
  - `trees.py` built all eight variants: firs at LOD0 2.8–4.5k and LOD1 1.2–2.0k triangles; `trees.glb` is 5.0 MB with the textures stored once. The needle material exports as glTF `alphaMode: MASK`.
  - **Found and fixed:** with GPU mips, the sparse needle cards thinned into holey blobs at distance. The atlas alpha now ships as its own opaque PNG, and the runtime builds coverage-preserving mips.
  - **Still open for the look review:** LOD0 cards seen from inside the forest read as leafy blobs rather than needle sprays. The levers are in Task 11.
- **Poly Haven IDs verified on the live API (2026-09-27):** `fir_sapling` (model), `pine_bark` (texture), `fern_02`, `shrub_02`, `shrub_04`, `dead_tree_trunk`, `tree_stump_01`, `tree_stump_02`.
  - `fir_tree_01` (478 MB of geometry) and `pine_tree_01` are unusable, as the spec says.
  - `pine_roots` ships two texture sets, which the one-material rock pipeline does not handle; roots are left to M8.

## Global Constraints

- Plan M7a's Global Constraints all apply: world, determinism (`mulberry32`, `hash01`), materials through the pipeline, hook keys pure, Plan 1's hardening wave, WebP + `pipeline/cc0`, collision roots, budgets, **never bind Ctrl**, commits.
- **Layers:**
  - Grass, falling leaves, shafts and motes: `LAYER_MAIN_ONLY` only. They are not in the mirror and not in the shadow maps.
  - Fish: `LAYER_UNDERWATER` only; the opaque water hides them from the main view.
  - Reeds: layer 0 plus `LAYER_UNDERWATER`.
  - Trees, flowers and props: layer 0 (mirrored).
- **Foliage (spec §4.7):**
  - Needle cards are alpha-tested (0.5), with `alphaToCoverage` when the preset has MSAA (High). The needle texture uses coverage-preserving mips.
  - Grass, reeds and flowers are geometric (no alpha).
- **Additive effects** (shafts, motes) use `fog: false` and fade to black, never to the haze colour (controller note 5). They still enter the material pipeline through `CoveRegion.add`.
- **Wind:** one set of region uniforms (`CoveLife.wind`), advanced once per frame. Plant materials get it through `applyWind` (key `vegWind`; per-material height and stiffness are uniforms).
- **Shadows:** tree LOD0 and LOD1 cast, and impostors don't. Grass casts nothing but receives. The Task 11 levers change this, never the tests.
- **Budgets (spec §4.10):**
  - With M7a's share: High whole-frame draw calls ≤ 800, main-view triangles ≤ 4 M.
  - Low (Iris Xe): `berk.perf()` ≤ 33 ms at every QA camera.
- **Blender scripts** make absolute paths of every CLI argument, because Blender resolves relative paths against the drive root or the .blend.

---

## File Structure

| Path | Responsibility |
|---|---|
| `pipeline/terrain/density.mjs`, `density.test.mjs` | vegetation density map (grass, forest, flowers) from the splat maps |
| `pipeline/blender/cove/needles.py` | fir_sapling → needle atlas (albedo RGB, alpha PNG, normal, cell rects) |
| `pipeline/blender/cove/trees.py`, `tree_kit.json`, `pipeline/blender/tests/test_trees.py` | procedural conifers → `trees.glb` + `trees.json` |
| `pipeline/blender/cove/prop_kit.json` | scanned props for M7a's `rocks.py` |
| `public/assets/world/cove/density.png`, `trees/`, `props/` | outputs |
| `src/world/vegetation/noise.ts` | `hash01`, value noise, fBm |
| `src/world/vegetation/wind.ts` | wind uniforms, GLSL, `applyWind` |
| `src/world/vegetation/density.ts` | `DensityMap`, `loadDensityMap` |
| `src/world/vegetation/impostor.ts` | hemi-octahedral maths, runtime bake, impostor material |
| `src/world/vegetation/treeLayout.ts` | seeded forest layout, trunk capsules |
| `src/world/vegetation/needleTexture.ts` | coverage-preserving mips, needle texture loader |
| `src/world/vegetation/trees.ts` | `TreeField` (instanced LODs + impostors, collision), `addTrees` |
| `src/world/vegetation/grass.ts` | blade layout, grass shader, `GrassField` |
| `src/world/vegetation/groundCover.ts` | prop layout, flowers, reeds |
| `src/world/life/boids.ts`, `src/world/life/life.ts` | flock; fish school, insect paths, wing/fin hooks, leaf fall |
| `src/world/life/atmosphere.ts` | light shafts, motes |
| `src/world/cove/coveLife.ts` | wiring into the region (`addCoveLife`) |
| `tests/world/{wind,impostor,forest,needleTexture,grass,groundCover,boids,life,atmosphere}.test.ts` | unit tests |

---

### Task 1: Wind and the life wiring

**Files:**
- Create: `src/world/vegetation/noise.ts`, `src/world/vegetation/wind.ts`, `src/world/cove/coveLife.ts`, `tests/world/wind.test.ts`
- Modify: `src/world/cove/cove.ts`

**Interfaces:**
- Consumes: `addCompileHook` (Plan 1); `CoveRegion` (M7a).
- Produces:
  - `noise.ts`: `hash01(a, b, c)`, `valueNoise2(x, z, seed)`, `fbm2(x, z, seed)`.
  - `wind.ts`: `interface WindUniforms`, `createWindUniforms()`, `WIND_GLSL` (`berkWindField`, `berkSway`), `interface WindParams { height; stiffness }`, `applyWind(material, wind, params)` (key `vegWind`).
  - `coveLife.ts`: `interface CoveLife { wind; density?; trees?; grass?; flowers? }`, `addWind(cove)`, `addCoveLife(cove) → Promise<CoveLife>`.
  - `CoveRegion.life`.

- [ ] **Step 1: Write the failing test**

`tests/world/wind.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createWindUniforms, applyWind } from '../../src/world/vegetation/wind';

describe('wind', () => {
  it('adds wind to a plant material under one key, values in uniforms', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const wind = createWindUniforms();
    applyWind(a, wind, { height: 10, stiffness: 1 });
    applyWind(b, wind, { height: 3, stiffness: 2 });
    expect(a.customProgramCacheKey()).toContain('vegWind');
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
  });
  it('sways only above the root, and patches after <begin_vertex>', () => {
    const m = new THREE.MeshStandardMaterial();
    applyWind(m, createWindUniforms(), { height: 4, stiffness: 1 });
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader } as never as Parameters<THREE.Material['onBeforeCompile']>[0];
    m.onBeforeCompile(shader, null as never);
    expect(shader.vertexShader).toContain('clamp(transformed.y / uWindHeight, 0.0, 1.0)');
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['uWindTime', 'uWindDir', 'uWindStrength', 'uWindHeight']));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/world/wind` → module not found.

- [ ] **Step 3: Implement**

`src/world/vegetation/noise.ts`:
```ts
/** Integer lattice hash → [0, 1) (Math.imul-exact on every engine; same mixer as pipeline/terrain/noise.mjs). */
export function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [0, 1). */
export function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(z - iz);
  const a = hash01(ix, iz, seed);
  const b = hash01(ix + 1, iz, seed);
  const c = hash01(ix, iz + 1, seed);
  const d = hash01(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Three-octave fBm of value noise in [0, 1). */
export function fbm2(x: number, z: number, seed: number): number {
  return (valueNoise2(x, z, seed) * 0.57 + valueNoise2(x * 2.03, z * 2.03, seed + 1) * 0.29 + valueNoise2(x * 4.1, z * 4.1, seed + 2) * 0.14) / 1.0;
}
```

`src/world/vegetation/wind.ts`:
```ts
import * as THREE from 'three';
import { addCompileHook, type ShaderParams } from '../../render/materials';

/** Region-wide wind (shared by trees, grass, reeds, ferns): one set of uniform objects, advanced once per frame. */
export interface WindUniforms {
  uWindTime: { value: number };
  /** Unit ground direction the wind blows toward (x, z). */
  uWindDir: { value: THREE.Vector2 };
  uWindStrength: { value: number };
}

export function createWindUniforms(): WindUniforms {
  return { uWindTime: { value: 0 }, uWindDir: { value: new THREE.Vector2(0.6, 0.8) }, uWindStrength: { value: 1 } };
}

/**
 * GLSL wind field. berkWindField: a slow gusting 2D wind that varies over the ground. berkSway: the world-space
 * offset of a point `h01` (0 root … 1 top) up a plant of `height` metres rooted at `root` — quadratic bend (tip moves
 * most) plus a small flutter; `stiffness` 1 = conifer, larger = stiffer.
 */
export const WIND_GLSL = /* glsl */ `
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
vec2 berkWindField(vec2 xz) {
  float t = uWindTime;
  float gust = 0.55 + 0.45 * sin(t * 0.63 + dot(xz, vec2(0.021, 0.017))) * sin(t * 0.21 + xz.x * 0.013 + 1.7);
  return uWindDir * gust * uWindStrength;
}
vec3 berkSway(vec3 root, float h01, float height, float stiffness) {
  vec2 w = berkWindField(root.xz);
  float bend = h01 * h01 * height * 0.018 / stiffness;
  float flutter = sin(uWindTime * 2.3 + root.x * 0.7 + root.z * 0.3 + h01 * 3.0) * 0.3;
  return vec3(w.x, 0.0, w.y) * bend * (1.0 + flutter);
}
`;

/** Per-material wind parameters (values only; the injected GLSL is the same for every material). */
export interface WindParams {
  /** Local-space height of the plant (metres, before instance scale). */
  height: number;
  stiffness: number;
}

/**
 * Wind for (instanced) plant meshes, key `vegWind`: after <begin_vertex>, sway `transformed` by berkSway, computed in
 * world space and brought back through the (uniformly scaled, Y-rotated) instance + model matrix.
 */
export function applyWind(material: THREE.Material, wind: WindUniforms, params: WindParams): void {
  const own = { uWindHeight: { value: params.height }, uWindStiffness: { value: params.stiffness } };
  addCompileHook(material, 'vegWind', (shader: ShaderParams) => {
    if (!shader.vertexShader.includes('#include <begin_vertex>')) throw new Error('wind: vertex anchor missing: #include <begin_vertex>');
    Object.assign(shader.uniforms, wind, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', () => `#include <common>\n${WIND_GLSL}\nuniform float uWindHeight;\nuniform float uWindStiffness;`)
      .replace('#include <begin_vertex>', () => `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    mat4 windModel = modelMatrix * instanceMatrix;
  #else
    mat4 windModel = modelMatrix;
  #endif
  mat3 windM = mat3(windModel);
  float windS2 = dot(windM[0], windM[0]);
  vec3 windRoot = (windModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 windW = berkSway(windRoot, clamp(transformed.y / uWindHeight, 0.0, 1.0), uWindHeight * sqrt(windS2), uWindStiffness);
  transformed += transpose(windM) * windW / windS2;
}`);
  });
}
```

`src/world/cove/coveLife.ts` (first version; later tasks extend `CoveLife` and `addCoveLife`):
```ts
import type { CoveRegion } from './cove';
import { createWindUniforms, type WindUniforms } from '../vegetation/wind';

/** M7b's region parts, created in order by `addCoveLife` (Tasks 1, 2, 6–10). */
export interface CoveLife {
  wind: WindUniforms;
}

/** Task 1: region-wide wind, advanced every frame. */
export function addWind(cove: CoveRegion): WindUniforms {
  const wind = createWindUniforms();
  cove.onUpdate((dt) => {
    wind.uWindTime.value += dt;
  });
  return wind;
}

/** Everything M7b adds, in dependency order; called by createCove after the pond. */
export async function addCoveLife(cove: CoveRegion): Promise<CoveLife> {
  const life: CoveLife = { wind: addWind(cove) };
  return life;
}
```

`src/world/cove/cove.ts`:
- Import: `import { addCoveLife, type CoveLife } from './coveLife';`
- In `CoveRegion`, after `pond: PondWater | null = null;`, add `life: CoveLife | null = null;`
- In `createCove`, directly after `cove.pond = addPond(cove);`, add `cove.life = await addCoveLife(cove);`

- [ ] **Step 4: Run to verify it passes** — `npm test` → all pass (wind: 2). `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `feat(cove-life): shared wind field, vegetation noise and the life wiring`.

---

### Task 2: Vegetation density map

**Pure (Node + a small browser loader).**

**Files:**
- Create: `pipeline/terrain/density.mjs`, `pipeline/terrain/density.test.mjs`, `src/world/vegetation/density.ts`, `public/assets/world/cove/density.png`
- Modify: `package.json` (script `terrain:density`), `src/world/cove/coveLife.ts`

**Interfaces:**
- Produces:
  - `densityFromSplat(a, b, pixels) → Buffer`
  - `npm run terrain:density`
  - `class DensityMap { grass(x, z); forest(x, z); flowers(x, z) }`, `loadDensityMap(url, header)`

The splat PNGs carry weights in their alpha channel, so a canvas decode would premultiply them away. This map is opaque: R grass, G forest floor, B flowers (dry, open grass).

- [ ] **Step 1: Write the failing test**

`pipeline/terrain/density.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { densityFromSplat } from './density.mjs';

describe('vegetation density map', () => {
  it('copies grass and forest, grows flowers only on dry, open grass, and stays opaque', () => {
    // texel 0: open dry grass; texel 1: wet grass; texel 2: grass under the walls (low AO); texel 3: forest
    const a = new Uint8Array([200, 0, 0, 55, 200, 0, 0, 55, 200, 0, 0, 55, 0, 255, 0, 0]);
    const b = new Uint8Array([0, 0, 0, 255, 0, 0, 200, 255, 0, 0, 0, 90, 0, 0, 0, 255]);
    const d = densityFromSplat(a, b, 4);
    expect([d[0], d[1], d[2], d[3]]).toEqual([200, 0, 200, 255]);
    expect(d[4 + 2]).toBe(0);
    expect(d[8 + 2]).toBe(0);
    expect([d[12], d[13], d[14]]).toEqual([0, 255, 0]);
    expect(() => densityFromSplat(a, b, 5)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- pipeline/terrain/density` → module not found.

- [ ] **Step 3: Implement**

`pipeline/terrain/density.mjs`:
```js
// Vegetation density map from the committed splat maps: R grass, G forest floor, B flowers (sunny, dry, open grass).
// Opaque RGBA so browsers decode it exactly. Usage: node pipeline/terrain/density.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * @param {Uint8Array} a splatA RGBA (grass, forest, moss, mud)
 * @param {Uint8Array} b splatB RGBA (pebbles, rock, wet, baked AO)
 * @param {number} pixels
 * @returns {Buffer} RGBA, alpha 255
 */
export function densityFromSplat(a, b, pixels) {
  if (a.length < pixels * 4 || b.length < pixels * 4) throw new Error('densityFromSplat: short buffer');
  const out = Buffer.alloc(pixels * 4);
  for (let k = 0; k < pixels; k++) {
    const grass = a[k * 4];
    const forest = a[k * 4 + 1];
    const wet = b[k * 4 + 2] / 255;
    const ao = b[k * 4 + 3] / 255;
    out[k * 4] = grass;
    out[k * 4 + 1] = forest;
    // flowers: grass that is dry and open (baked AO high: not under the walls)
    out[k * 4 + 2] = Math.round(grass * Math.max(0, 1 - 2 * wet) * Math.min(1, Math.max(0, (ao - 0.55) / 0.3)));
    out[k * 4 + 3] = 255;
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'assets', 'world', 'cove');
  const A = await sharp(join(DIR, 'splatA.png')).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(join(DIR, 'splatB.png')).raw().toBuffer({ resolveWithObject: true });
  const px = A.info.width * A.info.height;
  const d = densityFromSplat(A.data, B.data, px);
  await sharp(d, { raw: { width: A.info.width, height: A.info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(DIR, 'density.png'));
  console.log(`density.png ${A.info.width}² written`);
}
```

`src/world/vegetation/density.ts`:
```ts
import type { TerrainHeader } from '../terrain/heightfield';

/**
 * Vegetation density per heightfield sample (`public/assets/world/cove/density.png`, written by
 * pipeline/terrain/density.mjs from the splat maps): R grass, G forest floor, B flowers. The PNG is opaque, so a
 * canvas decode is exact (the splat PNGs are not: their alpha would premultiply the weights away).
 */
export class DensityMap {
  constructor(
    readonly header: TerrainHeader,
    readonly rgba: Uint8ClampedArray | Uint8Array,
  ) {
    if (rgba.length !== header.size * header.size * 4) throw new Error(`density: expected ${header.size}² RGBA`);
  }

  private channel(x: number, z: number, c: number): number {
    const h = this.header;
    const n = h.size - 1;
    const fi = Math.min(Math.max((x - h.origin) / h.spacing, 0), n);
    const fj = Math.min(Math.max((z - h.origin) / h.spacing, 0), n);
    const i = Math.min(Math.floor(fi), n - 1);
    const j = Math.min(Math.floor(fj), n - 1);
    const u = fi - i;
    const v = fj - j;
    const at = (a: number, b: number) => this.rgba[(b * h.size + a) * 4 + c];
    const top = at(i, j) * (1 - u) + at(i + 1, j) * u;
    const bottom = at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u;
    return (top * (1 - v) + bottom * v) / 255;
  }

  grass(x: number, z: number): number {
    return this.channel(x, z, 0);
  }

  forest(x: number, z: number): number {
    return this.channel(x, z, 1);
  }

  flowers(x: number, z: number): number {
    return this.channel(x, z, 2);
  }
}

/** Browser: decode the (opaque) density PNG. Image row 0 is sample row j = 0, like the splat maps. */
export async function loadDensityMap(url: string, header: TerrainHeader): Promise<DensityMap> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const g = canvas.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return new DensityMap(header, g.getImageData(0, 0, canvas.width, canvas.height).data);
}
```

`package.json`: `"terrain:density": "node pipeline/terrain/density.mjs"`.

`coveLife.ts`:
- Import `loadDensityMap` and `type DensityMap` from `../vegetation/density`.
- Add `density?: DensityMap;` to `CoveLife`.
- In `addCoveLife`, after the wind: `life.density = await loadDensityMap(`${cove.baseUrl}world/cove/density.png`, cove.header);`.

- [ ] **Step 4: Run to verify it passes; generate the map**
  - `npm test -- pipeline/terrain` → all pass.
  - `npm run terrain:density` prints `density.png 1024² written`. Read it: green is forest outside the rim, red is grass on the floor, and blue flowers sit in the open sunlit floor only.
- [ ] **Step 5: Commit** — `feat(cove-life): vegetation density map from the splat weights`.

---

### Task 3: The needle atlas — baked from the Poly Haven fir sapling scan

**Needs Plan 2's Blender runner.**

**Files:**
- Create: `pipeline/blender/cove/needles.py`
- Modify: `pipeline/cc0/wanted.json`, `package.json` (script `cove:needles`)
- Output (committed): `public/assets/world/cove/trees/{needles_albedo.webp, needles_alpha.png, needles_normal.webp, needles.json}`

**Interfaces:**
- Produces: a 2 × 2 atlas at 1024². Cells 0–2 are the side views of saplings a, b, c (branch sprays); cell 3 is the top view of sapling a. `needles.json` gives, per cell, `uv` [u0, v0, u1, v1] (Blender convention, v up), the card `aspect` (w/h) and its `coverage`.

The spec asks for a needle atlas baked from the Poly Haven scans. `fir_tree_01` is 478 MB of geometry, but `fir_sapling` (25 MB) holds three saplings whose needles are real geometry, which bake cleanly onto cards:
- albedo: Cycles `DIFFUSE` colour pass with an 8 px margin, so colour bleeds past the needle edges
- tangent normal
- coverage: an `EMIT` bake of the needles made white, with no margin

- [ ] **Step 1: Implement**

`pipeline/blender/cove/needles.py`:
```python
"""Needle atlas (spec §7.6): Poly Haven's fir_sapling scan (needles are real geometry, three saplings a/b/c) baked onto
cards in Cycles — albedo, tangent normal and coverage — into a 2 × 2 atlas: cells 0–2 are the side views of saplings
a, b, c (branch sprays), cell 3 the top view of sapling a. Writes public/assets/world/cove/trees/needles_albedo.webp
(RGB, sRGB, colour dilated past the needle edges), needles_alpha.png (lossless coverage), needles_normal.webp and
needles.json (cell rects and card aspect ratios). Alpha is a separate opaque file so the runtime can decode it exactly
and build coverage-preserving mips (src/world/vegetation/needleTexture.ts).

Usage: run.ps1 pipeline/blender/cove/needles.py [--cache <dir>] [--out <dir>] [--res 1k|2k] [--cell 512]
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import scene as SC  # noqa: E402


def import_saplings(path):
    SC.reset()
    bpy.ops.import_scene.gltf(filepath=path)
    saplings = sorted([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda o: o.name)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in saplings:
        o.select_set(True)
    bpy.context.view_layer.objects.active = saplings[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in saplings:  # keep the needle (twig) faces only
        twig = next(i for i, m in enumerate(o.data.materials) if "twig" in m.name)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != twig], context="FACES")
        bm.to_mesh(o.data)
        bm.free()
    return saplings


def bounds(ob):
    vs = [v.co for v in ob.data.vertices]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    return lo, hi


def card_for(ob, view):
    """A plane covering the sapling's silhouette: 'side' looks along +Y (card in XZ), 'top' looks down (card in XY)."""
    lo, hi = bounds(ob)
    bpy.ops.mesh.primitive_plane_add(size=1)
    card = bpy.context.active_object
    if view == "side":
        w, h, depth = hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]
        card.rotation_euler = (math.pi / 2, 0, 0)
        card.location = ((hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2)
    else:
        w, h, depth = hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]
        card.location = ((hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2)
    card.scale = (w * 1.02, h * 1.02, 1)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mat = bpy.data.materials.new("card")
    mat.use_nodes = True
    card.data.materials.append(mat)
    return card, w / h, depth


def bake(src, card, depth, kind, size, colorspace, margin, **kw):
    sc = bpy.context.scene
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = depth / 2 + 0.05
    sc.render.bake.max_ray_distance = depth + 0.1
    img = bpy.data.images.new(f"bake_{kind}", size, size, alpha=False)
    img.colorspace_settings.name = colorspace
    nt = card.data.materials[0].node_tree
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    nt.nodes.active = node
    for o in sc.objects:
        o.select_set(False)
    src.select_set(True)
    card.select_set(True)
    bpy.context.view_layer.objects.active = card
    if bpy.ops.object.bake(type=kind, margin=margin, use_clear=True, **kw) != {"FINISHED"}:
        raise RuntimeError(f"bake {kind} failed")
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    nt.nodes.remove(node)
    bpy.data.images.remove(img)
    return px


def whiten(ob):
    """Every material of `ob` → pure white emission, for the coverage (alpha) bake."""
    for m in ob.data.materials:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (1, 1, 1, 1)
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])


def save_webp(pixels, path, colorspace, alpha):
    h, w = pixels.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=alpha)
    img.colorspace_settings.name = colorspace
    img.pixels = pixels.ravel()
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = "WEBP"
    st.quality = 92
    st.color_mode = "RGBA" if alpha else "RGB"
    img.save_render(path, scene=sc)
    bpy.data.images.remove(img)


def save_png(pixels, path):
    """Lossless 8-bit grayscale (the coverage mask) — opaque, so browsers decode it exactly."""
    h, w = pixels.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels = pixels.ravel()
    st = bpy.context.scene.render.image_settings
    st.file_format = "PNG"
    st.color_mode = "BW"
    st.color_depth = "8"
    img.save_render(path, scene=bpy.context.scene)
    bpy.data.images.remove(img)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, "pipeline", "cc0", "cache"))
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "assets", "world", "cove", "trees"))
    ap.add_argument("--res", default="2k")
    ap.add_argument("--cell", type=int, default=512)
    args = ap.parse_args(argv)
    args.out = os.path.abspath(args.out)
    args.cache = os.path.abspath(args.cache)  # Blender resolves relative paths against the .blend, not the cwd
    os.makedirs(args.out, exist_ok=True)
    saplings = import_saplings(os.path.join(args.cache, "fir_sapling", f"fir_sapling_{args.res}.gltf"))
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 1
    n = args.cell
    albedo = np.zeros((2 * n, 2 * n, 4), np.float32)
    normal = np.zeros((2 * n, 2 * n, 4), np.float32)
    cells = []
    views = [(saplings[0], "side"), (saplings[1], "side"), (saplings[2], "side"), (saplings[0], "top")]
    maps = []
    for src, view in views:
        card, aspect, depth = card_for(src, view)
        col = bake(src, card, depth, "DIFFUSE", n, "sRGB", 8, pass_filter={"COLOR"})
        nor = bake(src, card, depth, "NORMAL", n, "Non-Color", 8, normal_space="TANGENT")
        maps.append((src, card, depth, aspect, col, nor))
    for src in saplings:
        whiten(src)
    for k, (src, card, depth, aspect, col, nor) in enumerate(maps):
        cover = bake(src, card, depth, "EMIT", n, "Non-Color", 0)
        col[..., 3] = (cover[..., 0] > 0.5).astype(np.float32)
        nor[..., 3] = 1.0
        cx, cy = k % 2, k // 2
        albedo[cy * n:(cy + 1) * n, cx * n:(cx + 1) * n] = col
        normal[cy * n:(cy + 1) * n, cx * n:(cx + 1) * n] = nor
        # uv rect [u0, v0, u1, v1] in Blender's convention (v up; pixel rows run bottom-up) — trees.py maps cards with it
        cells.append({"uv": [cx / 2, cy / 2, (cx + 1) / 2, (cy + 1) / 2], "aspect": round(aspect, 4), "coverage": round(float(col[..., 3].mean()), 3)})
        print(f"[needles] cell {k}: aspect {aspect:.3f} coverage {cells[-1]['coverage']}", flush=True)
    alpha = np.repeat(albedo[..., 3:4], 4, axis=2)
    alpha[..., 3] = 1.0
    albedo[..., 3] = 1.0
    save_webp(albedo, os.path.join(args.out, "needles_albedo.webp"), "sRGB", False)
    save_png(alpha, os.path.join(args.out, "needles_alpha.png"))
    save_webp(normal, os.path.join(args.out, "needles_normal.webp"), "Non-Color", False)
    with open(os.path.join(args.out, "needles.json"), "w", encoding="utf-8") as f:
        json.dump({"cells": cells}, f, indent=1)
        f.write("\n")
    print("[needles] atlas written", flush=True)


if __name__ == "__main__":
    main()
```

`wanted.json` — append:
```json
{ "id": "fir_sapling", "type": "models", "res": "2k" },
{ "id": "pine_bark", "type": "textures", "res": "2k", "maps": ["diff", "nor", "arm"] }
```

`package.json`: `"cove:needles": "powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/cove/needles.py"`.

- [ ] **Step 2: Fetch and bake**
  - `npm run cc0:fetch`, then `npm run cove:needles`. The run prints four `cell k: aspect … coverage …` lines (planning at 1k: aspects 0.68 / 0.70 / 0.89 / 1.05, coverage 0.18–0.31) and `atlas written`.
  - Read `needles_albedo.webp` and `needles_alpha.png`: three sapling side sprays and one top view, sharp needle silhouettes, green colour carried past the edges in the albedo.
- [ ] **Step 3: Commit** — `feat(cove-life): needle atlas baked from the fir sapling scan`.

---

### Task 4: The conifer builder

**Needs Task 3.**

**Files:**
- Create: `pipeline/blender/cove/trees.py`, `pipeline/blender/cove/tree_kit.json`, `pipeline/blender/tests/test_trees.py`
- Modify: `package.json` (script `cove:trees`)
- Output (committed): `public/assets/world/cove/trees/{trees.glb, trees.json}`

**Interfaces:**
- Consumes: `needles.json` and the atlas (Task 3); the `pine_bark` textures from the CC0 cache.
- Produces:
  - `trees.glb`: nodes `<variant>_LOD{0,1}_{bark,needles}`, one bark and one needle material shared by every variant.
  - `trees.json`: `{ version: 1, variants: TreeVariant[] }`, each `{ name, kind, height, crown, trunk, tris [LOD0, LOD1], file }`.

The variants (spec §7.6: about five firs of 8–25 m and three saplings): `fir_a` 22 m, `fir_b` 18 m, `fir_c` 14 m, `fir_d` 10 m, `fir_e` 25 m (sparse and old), `sapling_a` 2.5 m, `sapling_b` 4 m, `sapling_c` 1.6 m.

How a tree is built:
- **Trunk:** a tapered cylinder, 10 sides at LOD0 and 6 at LOD1, bark tiled every 2 m.
- **Whorls:** start at `firstWhorl × H`, spaced `whorlStep` (tighter toward the top), with `branches` per whorl on a golden-angle spiral.
- **Branches:** each gets a drooping main card plus a vertical card; LOD0 adds two side sprays and a top-view tip card.
- **Leader:** a crossed pair of cards at the top.

- [ ] **Step 1: Write the failing Blender tests**

`pipeline/blender/tests/test_trees.py`:
```python
import os
import random
import sys
import unittest

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cove"))
import trees as T  # noqa: E402
import scene as SC  # noqa: E402

CELLS = [{"uv": [0, 0, 0.5, 0.5], "aspect": 0.68}, {"uv": [0.5, 0, 1, 0.5], "aspect": 0.7}, {"uv": [0, 0.5, 0.5, 1], "aspect": 0.89},
         {"uv": [0.5, 0.5, 1, 1], "aspect": 1.05}]
FIR_A = {"name": "fir_a", "kind": "fir", "height": 22, "crown": 3.6, "trunk": 0.32, "firstWhorl": 0.2, "whorlStep": 0.62, "branches": 7, "droop": 26, "seed": 101}


class TreeBuilderTests(unittest.TestCase):
    def setUp(self):
        SC.reset()

    def test_trunk_tapers_and_tiles_its_bark(self):
        t = T.trunk_mesh("t", 20, 0.3, 10, 1.2, 2.0)
        zs = [v.co.z for v in t.data.vertices]
        self.assertAlmostEqual(min(zs), 0.0, places=5)
        self.assertAlmostEqual(max(zs), 20.0, places=5)
        base = max(v.co.length for v in t.data.vertices if v.co.z < 0.01)
        top = max((v.co.x ** 2 + v.co.y ** 2) ** 0.5 for v in t.data.vertices if v.co.z > 19.99)
        self.assertAlmostEqual(base, 0.3, places=4)
        self.assertLess(top, 0.03)
        vmax = max(l.uv[1] for l in t.data.uv_layers[0].data)
        self.assertAlmostEqual(vmax, 10.0, places=3)

    def test_crown_budgets_and_atlas_cells(self):
        lod0 = T.crown_mesh("c0", FIR_A, CELLS, 0, random.Random(1))
        lod1 = T.crown_mesh("c1", FIR_A, CELLS, 1, random.Random(1))
        self.assertTrue(3800 <= T.tris(lod0) <= 7600, T.tris(lod0))  # + trunk ≈ 4–8k
        self.assertTrue(1000 <= T.tris(lod1) <= 1900, T.tris(lod1))
        for l in lod0.data.uv_layers[0].data:
            self.assertTrue(-1e-6 <= l.uv[0] <= 1 + 1e-6 and -1e-6 <= l.uv[1] <= 1 + 1e-6)
        zs = [v.co.z for v in lod0.data.vertices]
        self.assertGreater(min(zs), 0.1 * FIR_A["height"] - 3)
        self.assertLess(max(zs), FIR_A["height"] * 1.05)

    def test_same_seed_same_tree(self):
        a = T.crown_mesh("a", FIR_A, CELLS, 0, random.Random(5))
        b = T.crown_mesh("b", FIR_A, CELLS, 0, random.Random(5))
        self.assertEqual([tuple(round(c, 5) for c in v.co) for v in a.data.vertices], [tuple(round(c, 5) for c in v.co) for v in b.data.vertices])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify they fail** — `npm run blender:test` → `No module named 'trees'`.

- [ ] **Step 3: Implement**

`pipeline/blender/cove/trees.py`:
```python
"""Cove conifers (spec §7.6): game-ready firs and saplings built procedurally — a tapered trunk with scanned bark
(Poly Haven pine_bark) and whorls of branch cards textured from the needle atlas (needles.py). LOD0 ≈ 4–8k and
LOD1 ≈ 1–2k triangles; LOD2 is a runtime octahedral impostor. Deterministic per variant seed.

Writes public/assets/world/cove/trees/trees.glb (every variant; nodes <name>_LOD{0,1}_{bark,needles}; the bark and
needle textures stored once) and trees.json.
Usage: run.ps1 pipeline/blender/cove/trees.py [--kit <json>] [--cache <dir>] [--out <dir>]
"""
import argparse
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import scene as SC  # noqa: E402

GOLDEN = math.pi * (3 - math.sqrt(5))


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def trunk_mesh(name, height, r0, sides, ring_step, bark_tile):
    """Tapered trunk (r0 at the base → 8 % at the top), UVs tiled every `bark_tile` metres."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rings = max(2, int(math.ceil(height / ring_step)) + 1)
    verts = []
    for j in range(rings):
        y = height * j / (rings - 1)
        r = r0 * (1 - 0.92 * (y / height) ** 0.9)
        verts.append([bm.verts.new((math.cos(2 * math.pi * s / sides) * r, math.sin(2 * math.pi * s / sides) * r, y)) for s in range(sides)])
    circ = 2 * math.pi * r0
    for j in range(rings - 1):
        for s in range(sides):
            a, b = verts[j][s], verts[j][(s + 1) % sides]
            c, d = verts[j + 1][(s + 1) % sides], verts[j + 1][s]
            f = bm.faces.new((a, b, c, d))
            for loop, (su, sv) in zip(f.loops, ((s, j), (s + 1, j), (s + 1, j + 1), (s, j + 1))):
                loop[uv].uv = (su / sides * circ / bark_tile, height * sv / (rings - 1) / bark_tile)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def add_card(bm, uv, frame, length, width, segments, bend, cell):
    """A card along `frame`'s local +X (length) and ±Y (width), bending down by `bend` radians toward its tip; UVs map
    the atlas `cell` with the sapling's vertical axis (v) along the card's length."""
    u0, v0, u1, v1 = cell
    rows = []
    for k in range(segments + 1):
        t = k / segments
        ang = bend * t
        x = length * t * math.cos(ang * 0.5)
        z = -length * t * math.sin(ang * 0.5)
        rows.append([bm.verts.new(frame @ Vector((x, side * width / 2, z))) for side in (-1, 1)])
    for k in range(segments):
        a, b = rows[k]
        c, d = rows[k + 1][1], rows[k + 1][0]
        f = bm.faces.new((a, b, c, d))
        for loop, (su, sv) in zip(f.loops, ((0, k), (1, k), (1, k + 1), (0, k + 1))):
            loop[uv].uv = (u0 + (u1 - u0) * su, v0 + (v1 - v0) * sv / segments)


def crown_mesh(name, v, cells, lod, rng):
    """Branch whorls from the first whorl height to the top: per branch a main card (tilted to the droop), a vertical
    card through the same axis and — on LOD0 — two side sprays and a tip card; plus a crossed leader at the top."""
    H = v["height"]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    h0 = v["firstWhorl"] * H
    y = h0
    whorl = 0
    step = v["whorlStep"]
    while y < H * 0.95:
        t = (y - h0) / max(H - h0, 1e-3)
        n = v["branches"]
        for i in range(n):
            az = whorl * GOLDEN + i * 2 * math.pi / n + (rng.random() - 0.5) * 0.4
            length = v["crown"] * (1 - t) ** 0.85 * (0.85 + 0.3 * rng.random()) + 0.25
            pitch = math.radians(v["droop"] * (1 - t) + 6)
            base = Matrix.Translation((0, 0, y)) @ Matrix.Rotation(az, 4, "Z") @ Matrix.Rotation(pitch, 4, "Y")
            cell = cells[i % 3]["uv"]
            aspect = cells[i % 3]["aspect"]
            segs = 3 if lod == 0 else 2
            bend = math.radians(12 + 10 * (1 - t))
            add_card(bm, uv, base, length, length * aspect, segs, bend, cell)
            add_card(bm, uv, base @ Matrix.Rotation(math.pi / 2, 4, "X"), length, length * aspect * 0.8, segs, bend * 0.5, cell)
            if lod == 0:
                for side in (-1, 1):
                    spray = base @ Matrix.Translation((length * 0.45, 0, 0)) @ Matrix.Rotation(side * math.radians(38), 4, "Z")
                    add_card(bm, uv, spray, length * 0.5, length * 0.5 * aspect, 1, bend, cells[(i + 1) % 3]["uv"])
                add_card(bm, uv, base @ Matrix.Translation((length * 0.8, 0, 0)), length * 0.35, length * 0.35, 1, bend, cells[3]["uv"])
        whorl += 1
        y += step * (0.85 + 0.3 * rng.random()) * (1 - 0.35 * t)
    lead = cells[0]
    for rot in (0, math.pi / 2):
        top = Matrix.Translation((0, 0, H * 0.9)) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Rotation(-math.pi / 2, 4, "Y")
        add_card(bm, uv, top, H * 0.12, H * 0.12 * lead["aspect"], 2, 0.0, lead["uv"])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def image_node(nt, path, colorspace):
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(path, check_existing=True)
    node.image.colorspace_settings.name = colorspace
    return node


def bark_material(cache, bark):
    d = os.path.join(cache, bark["id"])
    mat = bpy.data.materials.new("bark")
    mat.use_nodes = True
    mat.use_backface_culling = True  # single-sided in glTF
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    diff = image_node(nt, os.path.join(d, f"{bark['id']}_diff_{bark['res']}.jpg"), "sRGB")
    nt.links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])
    nor = image_node(nt, os.path.join(d, f"{bark['id']}_nor_gl_{bark['res']}.png"), "Non-Color")
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nor.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.9
    return mat


def needle_material(atlas_dir):
    mat = bpy.data.materials.new("needles")
    mat.use_nodes = True
    mat.use_backface_culling = False  # glTF doubleSided
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    alb = image_node(nt, os.path.join(atlas_dir, "needles_albedo.webp"), "sRGB")
    nt.links.new(alb.outputs["Color"], bsdf.inputs["Base Color"])
    cover = image_node(nt, os.path.join(atlas_dir, "needles_alpha.png"), "Non-Color")
    clip = nt.nodes.new("ShaderNodeMath")  # Greater Than on the coverage → glTF alphaMode MASK, cutoff 0.5
    clip.operation = "GREATER_THAN"
    clip.inputs[1].default_value = 0.5
    nt.links.new(cover.outputs["Color"], clip.inputs[0])
    nt.links.new(clip.outputs["Value"], bsdf.inputs["Alpha"])
    nor = image_node(nt, os.path.join(atlas_dir, "needles_normal.webp"), "Non-Color")
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nor.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.8
    return mat


def build_variant(v, cells, bark_mat, needle_mat):
    """LOD0 and LOD1 meshes of one variant (left in the scene for the shared export) and its trees.json record."""
    objs = []
    record = {"name": v["name"], "kind": v["kind"], "height": v["height"], "crown": v["crown"], "trunk": v["trunk"], "file": "trees.glb", "tris": []}
    for lod in (0, 1):
        trunk = trunk_mesh(f"{v['name']}_LOD{lod}_bark", v["height"], v["trunk"], 10 if lod == 0 else 6, 1.2 if lod == 0 else 3.0, 2.0)
        trunk.data.materials.append(bark_mat)
        crown = crown_mesh(f"{v['name']}_LOD{lod}_needles", v, cells, lod, random.Random(v["seed"] + 17))
        crown.data.materials.append(needle_mat)
        objs += [trunk, crown]
        record["tris"].append(tris(trunk) + tris(crown))
    print(f"[trees] {v['name']}: H {v['height']} m, tris LOD0 {record['tris'][0]}, LOD1 {record['tris'][1]}", flush=True)
    return objs, record


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--kit", default=os.path.join(HERE, "tree_kit.json"))
    ap.add_argument("--cache", default=os.path.join(ROOT, "pipeline", "cc0", "cache"))
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "assets", "world", "cove", "trees"))
    args = ap.parse_args(argv)
    args.out = os.path.abspath(args.out)
    args.cache = os.path.abspath(args.cache)  # Blender resolves relative paths against the .blend, not the cwd
    kit = json.load(open(args.kit, encoding="utf-8"))
    cells = json.load(open(os.path.join(args.out, "needles.json"), encoding="utf-8"))["cells"]
    SC.reset()
    bark_mat = bark_material(args.cache, kit["bark"])
    needle_mat = needle_material(args.out)
    objs, variants = [], []
    for v in kit["variants"]:
        o, rec = build_variant(v, cells, bark_mat, needle_mat)
        objs += o
        variants.append(rec)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, "trees.glb"), export_format="GLB", use_selection=True, export_apply=True,
                              export_image_format="WEBP", export_image_quality=90)
    with open(os.path.join(args.out, "trees.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "variants": sorted(variants, key=lambda x: x["name"])}, f, indent=1)
        f.write("\n")
    print(f"[trees] trees.glb: {os.path.getsize(os.path.join(args.out, 'trees.glb'))} bytes, {len(variants)} variants", flush=True)


if __name__ == "__main__":
    main()
```

`pipeline/blender/cove/tree_kit.json`:
```json
{
 "bark": { "id": "pine_bark", "res": "2k" },
 "variants": [
  { "name": "fir_a", "kind": "fir", "height": 22, "crown": 3.6, "trunk": 0.32, "firstWhorl": 0.2, "whorlStep": 0.62, "branches": 7, "droop": 26, "seed": 101 },
  { "name": "fir_b", "kind": "fir", "height": 18, "crown": 3.1, "trunk": 0.27, "firstWhorl": 0.18, "whorlStep": 0.58, "branches": 7, "droop": 24, "seed": 102 },
  { "name": "fir_c", "kind": "fir", "height": 14, "crown": 2.6, "trunk": 0.22, "firstWhorl": 0.15, "whorlStep": 0.5, "branches": 6, "droop": 22, "seed": 103 },
  { "name": "fir_d", "kind": "fir", "height": 10, "crown": 2.0, "trunk": 0.17, "firstWhorl": 0.12, "whorlStep": 0.42, "branches": 6, "droop": 20, "seed": 104 },
  { "name": "fir_e", "kind": "fir", "height": 25, "crown": 3.4, "trunk": 0.36, "firstWhorl": 0.32, "whorlStep": 0.78, "branches": 6, "droop": 30, "seed": 105 },
  { "name": "sapling_a", "kind": "sapling", "height": 2.5, "crown": 0.9, "trunk": 0.05, "firstWhorl": 0.06, "whorlStep": 0.22, "branches": 5, "droop": 14, "seed": 201 },
  { "name": "sapling_b", "kind": "sapling", "height": 4.0, "crown": 1.3, "trunk": 0.07, "firstWhorl": 0.08, "whorlStep": 0.28, "branches": 5, "droop": 16, "seed": 202 },
  { "name": "sapling_c", "kind": "sapling", "height": 1.6, "crown": 0.6, "trunk": 0.04, "firstWhorl": 0.05, "whorlStep": 0.18, "branches": 4, "droop": 12, "seed": 203 }
 ]
}
```

`package.json`: `"cove:trees": "powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/cove/trees.py"`.

- [ ] **Step 4: Run to verify they pass, then build** — `npm run blender:test` → all pass. Then `npm run cove:trees` prints one line per variant (planning: fir_a LOD0 4546 / LOD1 1952 … sapling_c 840 / 372) and `trees.glb: ~5.0 MB, 8 variants`.
  - Check the GLB's JSON chunk: the needle material has `"alphaMode": "MASK"` and `doubleSided`; the bark is single-sided.
- [ ] **Step 5: Commit** — `feat(cove-life): procedural conifers — eight variants, two LODs, shared bark and needle atlas`.

---

### Task 5: Octahedral impostors

**Pure maths + a browser bake.**

**Files:**
- Create: `src/world/vegetation/impostor.ts`, `tests/world/impostor.test.ts`

**Interfaces:**
- Produces:
  - `IMPOSTOR_FRAMES = 8`
  - maths: `hemiOctEncode(x, y, z)`, `hemiOctDecode(u, v, out?)`, `impostorFrames(u, v, n?)` (three frames and barycentric weights), `billboardAxes(d, right, up)`
  - atlas: `interface ImpostorAtlas { albedo; normal; center; radius; dispose() }`, `bakeImpostor(renderer, source, cell = 128, n?)` (orthographic renders into N × N cells, object-space normals)
  - material: `patchImpostorShader(shader, u)`, `createImpostorMaterial(atlas, alphaToCoverage)` (key `treeImpostor`), `impostorQuad()`

How it works:
- **Billboard.** The vertex shader turns the unit quad into a camera-facing billboard of the instance's bounding sphere and brings `transformed` back through `inverse(modelMatrix · instanceMatrix)`, so fog and projection chunks stay consistent.
- **Frames.** It picks the three nearest frames from the view direction in instance space (yaw only, uniform scale).
- **Lighting.** The fragment shader blends their albedo and object-space normals and rotates the normal to view space for normal lighting.
- **Shadows.** Impostors don't cast shadows.

- [ ] **Step 1: Write the failing tests**

`tests/world/impostor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { hemiOctEncode, hemiOctDecode, impostorFrames, billboardAxes, patchImpostorShader, IMPOSTOR_FRAMES } from '../../src/world/vegetation/impostor';

const std = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });

describe('hemi-octahedral impostor maths', () => {
  it('round-trips every upper-hemisphere direction', () => {
    const d = new THREE.Vector3();
    for (let k = 0; k < 500; k++) {
      const az = k * 2.39996;
      const el = ((k * 0.618034) % 1) * (Math.PI / 2);
      d.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      const [u, v] = hemiOctEncode(d.x, d.y, d.z);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(hemiOctDecode(u, v).distanceTo(d)).toBeLessThan(1e-9);
    }
    expect(hemiOctEncode(0, 1, 0)).toEqual([0.5, 0.5]);
  });
  it('blends the three nearest frames with weights summing to 1, exact on a frame', () => {
    const n = IMPOSTOR_FRAMES;
    for (let k = 0; k < 200; k++) {
      const u = (k * 0.618034) % 1;
      const v = (k * 0.414214) % 1;
      const { frames, weights } = impostorFrames(u, v);
      expect(weights[0] + weights[1] + weights[2]).toBeCloseTo(1, 12);
      expect(Math.min(...weights)).toBeGreaterThanOrEqual(-1e-12);
      for (const [i, j] of frames) {
        expect(Math.abs(i - u * (n - 1))).toBeLessThanOrEqual(1);
        expect(Math.abs(j - v * (n - 1))).toBeLessThanOrEqual(1);
      }
    }
    const exact = impostorFrames(3 / (n - 1), 5 / (n - 1));
    expect(exact.frames[0]).toEqual([3, 5]);
    expect(exact.weights[0]).toBeCloseTo(1, 12);
  });
  it('builds an orthonormal billboard frame for every view, including straight down', () => {
    const r = new THREE.Vector3();
    const u = new THREE.Vector3();
    for (const d of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.3, 0.5, -0.8).normalize()]) {
      billboardAxes(d, r, u);
      expect(r.length()).toBeCloseTo(1, 9);
      expect(u.length()).toBeCloseTo(1, 9);
      expect(r.dot(u)).toBeCloseTo(0, 9);
      expect(r.dot(d)).toBeCloseTo(0, 9);
      expect(u.y).toBeGreaterThanOrEqual(-1e-9);
    }
  });
  it('patches the standard program (and fails loudly if an anchor moved)', () => {
    const s = std() as never as Parameters<typeof patchImpostorShader>[0];
    const t = new THREE.Texture();
    patchImpostorShader(s, { tImpAlbedo: { value: t }, tImpNormal: { value: t }, uImpCenter: { value: new THREE.Vector3() }, uImpRadius: { value: 1 }, uImpFrames: { value: 8 } });
    expect(s.vertexShader).toContain('vec3 transformed = (inverse(impModel) * vec4(impWorld, 1.0)).xyz;');
    expect(s.fragmentShader).toContain('diffuseColor *= impAlb;');
    const bad = std() as never as Parameters<typeof patchImpostorShader>[0];
    bad.fragmentShader = bad.fragmentShader.replace('#include <normal_fragment_maps>', '');
    expect(() => patchImpostorShader(bad, { tImpAlbedo: { value: t }, tImpNormal: { value: t }, uImpCenter: { value: new THREE.Vector3() }, uImpRadius: { value: 1 }, uImpFrames: { value: 8 } })).toThrow(/normal_fragment_maps/);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement**

`src/world/vegetation/impostor.ts`:
```ts
import * as THREE from 'three';
import { addCompileHook, type ShaderParams } from '../../render/materials';

/** Frames per side of the hemi-octahedral atlas (N × N views of the upper hemisphere). */
export const IMPOSTOR_FRAMES = 8;

/** Unit direction with y ≥ 0 → hemi-octahedral square [0, 1]² (straight up → the centre, the horizon → the rim). */
export function hemiOctEncode(x: number, y: number, z: number): [number, number] {
  const s = Math.abs(x) + Math.abs(Math.max(y, 0)) + Math.abs(z) || 1;
  const px = x / s;
  const pz = z / s;
  return [(px + pz) * 0.5 + 0.5, (px - pz) * 0.5 + 0.5];
}

/** Inverse of hemiOctEncode: [0, 1]² → unit direction with y ≥ 0. */
export function hemiOctDecode(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = u * 2 - 1;
  const b = v * 2 - 1;
  const px = (a + b) / 2;
  const pz = (a - b) / 2;
  return out.set(px, 1 - Math.abs(px) - Math.abs(pz), pz).normalize();
}

/** The three frames (grid i, j) and weights blended for view-direction uv (triangle split of the frame grid). */
export function impostorFrames(u: number, v: number, n = IMPOSTOR_FRAMES): { frames: [number, number][]; weights: [number, number, number] } {
  const gx = Math.min(Math.max(u, 0), 1) * (n - 1);
  const gy = Math.min(Math.max(v, 0), 1) * (n - 1);
  const i = Math.min(Math.floor(gx), n - 2);
  const j = Math.min(Math.floor(gy), n - 2);
  const fx = gx - i;
  const fy = gy - j;
  if (fx + fy < 1) return { frames: [[i, j], [i + 1, j], [i, j + 1]], weights: [1 - fx - fy, fx, fy] };
  return { frames: [[i + 1, j + 1], [i, j + 1], [i + 1, j]], weights: [fx + fy - 1, 1 - fx, 1 - fy] };
}

/** Billboard axes for view direction `d` (toward the viewer): right = Y × d, up = d × right (a top-down view uses −Z as up). */
export function billboardAxes(d: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void {
  if (Math.abs(d.y) > 0.999) right.set(1, 0, 0);
  else right.set(d.z, 0, -d.x).normalize(); // (0, 1, 0) × d
  up.crossVectors(d, right).normalize();
}

export interface ImpostorAtlas {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** Bounding sphere of the source in its own space: the billboard is centred there and 2·radius across. */
  center: THREE.Vector3;
  radius: number;
  dispose(): void;
}

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vObjNormal;
void main() {
  vUv = uv;
  vObjNormal = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BAKE_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float useMap;
uniform vec3 color;
uniform float mode; // 0: albedo (linear) + coverage, 1: object-space normal + coverage
varying vec2 vUv;
varying vec3 vObjNormal;
void main() {
  vec4 t = useMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
  if (t.a < 0.5) discard;
  vec3 n = normalize(vObjNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = mode < 0.5 ? vec4(t.rgb * color, 1.0) : vec4(n * 0.5 + 0.5, 1.0);
}`;

/**
 * Renders `source` (at its own origin) from N × N hemi-octahedral directions into an albedo and a normal atlas
 * (object-space normals). Runs once per tree variant at load; each view is an orthographic render into one cell.
 */
export function bakeImpostor(renderer: THREE.WebGLRenderer, source: THREE.Object3D, cell = 128, n = IMPOSTOR_FRAMES): ImpostorAtlas {
  source.updateMatrixWorld(true);
  const sphere = new THREE.Box3().setFromObject(source).getBoundingSphere(new THREE.Sphere());
  const size = cell * n;
  const make = (srgb: boolean) => {
    const rt = new THREE.WebGLRenderTarget(size, size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  };
  const albedo = make(true);
  const normal = make(false);
  const scene = new THREE.Scene();
  const holder = new THREE.Group();
  scene.add(holder);
  const bakeMats = new Map<THREE.Mesh, THREE.ShaderMaterial>();
  const meshes: THREE.Mesh[] = [];
  source.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const mat = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERTEX,
      fragmentShader: BAKE_FRAGMENT,
      side: THREE.DoubleSide,
      uniforms: { map: { value: src.map ?? null }, useMap: { value: src.map ? 1 : 0 }, color: { value: (src.color ?? new THREE.Color(1, 1, 1)).clone() }, mode: { value: 0 } },
    });
    const clone = new THREE.Mesh(m.geometry, mat);
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(m.matrixWorld);
    holder.add(clone);
    bakeMats.set(clone, mat);
    meshes.push(clone);
  });
  holder.updateMatrixWorld(true);
  const r = sphere.radius;
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, r * 4);
  const d = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);
  for (const [target, mode] of [[albedo, 0], [normal, 1]] as const) {
    for (const mat of bakeMats.values()) mat.uniforms.mode.value = mode;
    renderer.setRenderTarget(target);
    renderer.clear();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        hemiOctDecode(i / (n - 1), j / (n - 1), d);
        billboardAxes(d, right, up);
        cam.position.copy(sphere.center).addScaledVector(d, r * 2);
        cam.up.copy(up);
        cam.lookAt(sphere.center);
        cam.updateMatrixWorld();
        target.viewport.set(i * cell, j * cell, cell, cell);
        target.scissor.set(i * cell, j * cell, cell, cell);
        target.scissorTest = true;
        renderer.setRenderTarget(target);
        renderer.render(scene, cam);
      }
    }
    target.scissorTest = false;
    target.viewport.set(0, 0, size, size);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.shadowMap.autoUpdate = prevShadow;
  for (const mat of bakeMats.values()) mat.dispose();
  return {
    albedo: albedo.texture,
    normal: normal.texture,
    center: sphere.center.clone(),
    radius: r,
    dispose() {
      albedo.dispose();
      normal.dispose();
    },
  };
}

const VERTEX_PARS = /* glsl */ `
uniform vec3 uImpCenter;
uniform float uImpRadius;
uniform float uImpFrames;
varying vec2 vImpUv;
varying vec4 vImpA;
varying vec4 vImpB;
varying vec3 vImpW;
varying vec2 vImpYaw;
vec2 impEncode(vec3 d) {
  d.y = max(d.y, 0.0);
  vec3 a = abs(d);
  vec2 p = d.xz / max(a.x + a.y + a.z, 1e-5);
  return vec2(p.x + p.y, p.x - p.y) * 0.5 + 0.5;
}
`;

/**
 * Replaces <begin_vertex>: the quad (position.xy in [−0.5, 0.5]) becomes a billboard of the instance's bounding
 * sphere facing the camera; the three nearest atlas frames and weights go to the fragment shader. `transformed`
 * is brought back into instance space so fog, shadows and projection chunks stay consistent.
 */
const VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
  mat4 impModel = modelMatrix * instanceMatrix;
#else
  mat4 impModel = modelMatrix;
#endif
float impScale = length(impModel[0].xyz);
vec3 impC = (impModel * vec4(uImpCenter, 1.0)).xyz;
vec3 impD = normalize(cameraPosition - impC);
vec3 impRight = abs(impD.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(impD.z, 0.0, -impD.x));
vec3 impUp = normalize(cross(impD, impRight));
vec3 impWorld = impC + (impRight * position.x + impUp * position.y) * (2.0 * uImpRadius * impScale);
vec3 transformed = (inverse(impModel) * vec4(impWorld, 1.0)).xyz;
vImpUv = position.xy + 0.5;
vec2 impYaw = normalize(impModel[0].xz); // cos, −sin of the instance's yaw (uniform scale, Y rotation only)
vImpYaw = impYaw;
vec3 impLocalD = vec3(impYaw.x * impD.x + impYaw.y * impD.z, impD.y, -impYaw.y * impD.x + impYaw.x * impD.z); // Rᵀ·d
vec2 impG = clamp(impEncode(impLocalD), 0.0, 1.0) * (uImpFrames - 1.0);
vec2 impI = min(floor(impG), vec2(uImpFrames - 2.0));
vec2 impF = impG - impI;
if (impF.x + impF.y < 1.0) {
  vImpA = vec4(impI, impI + vec2(1.0, 0.0));
  vImpB = vec4(impI + vec2(0.0, 1.0), 0.0, 0.0);
  vImpW = vec3(1.0 - impF.x - impF.y, impF.x, impF.y);
} else {
  vImpA = vec4(impI + vec2(1.0), impI + vec2(0.0, 1.0));
  vImpB = vec4(impI + vec2(1.0, 0.0), 0.0, 0.0);
  vImpW = vec3(impF.x + impF.y - 1.0, 1.0 - impF.x, 1.0 - impF.y);
}
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D tImpAlbedo;
uniform sampler2D tImpNormal;
uniform float uImpFrames;
varying vec2 vImpUv;
varying vec4 vImpA;
varying vec4 vImpB;
varying vec3 vImpW;
varying vec2 vImpYaw;
vec4 impSample(sampler2D t, vec2 frame) {
  return texture2D(t, (frame + clamp(vImpUv, 0.002, 0.998)) / uImpFrames);
}
vec4 impBlend(sampler2D t) {
  return impSample(t, vImpA.xy) * vImpW.x + impSample(t, vImpA.zw) * vImpW.y + impSample(t, vImpB.xy) * vImpW.z;
}
`;

const MAP_FRAGMENT = /* glsl */ `
vec4 impAlb = impBlend(tImpAlbedo);
diffuseColor *= impAlb;
`;

const NORMAL_FRAGMENT = /* glsl */ `
{
  vec3 impN = impBlend(tImpNormal).xyz * 2.0 - 1.0;
  vec3 impNW = vec3(vImpYaw.x * impN.x - vImpYaw.y * impN.z, impN.y, vImpYaw.y * impN.x + vImpYaw.x * impN.z); // R·n
  normal = normalize((viewMatrix * vec4(impNW, 0.0)).xyz);
}
`;

export interface ImpostorUniforms {
  tImpAlbedo: { value: THREE.Texture };
  tImpNormal: { value: THREE.Texture };
  uImpCenter: { value: THREE.Vector3 };
  uImpRadius: { value: number };
  uImpFrames: { value: number };
}

export function patchImpostorShader(shader: ShaderParams, u: ImpostorUniforms): void {
  for (const a of ['#include <common>', '#include <begin_vertex>']) if (!shader.vertexShader.includes(a)) throw new Error(`impostor: vertex anchor missing: ${a}`);
  for (const a of ['#include <common>', '#include <map_fragment>', '#include <normal_fragment_maps>']) if (!shader.fragmentShader.includes(a)) throw new Error(`impostor: fragment anchor missing: ${a}`);
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', () => `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <begin_vertex>', () => VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', () => `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <map_fragment>', () => MAP_FRAGMENT)
    .replace('#include <normal_fragment_maps>', () => NORMAL_FRAGMENT);
}

/** Impostor material (key `treeImpostor`): alpha-tested, or alpha-to-coverage when the target has MSAA. */
export function createImpostorMaterial(atlas: ImpostorAtlas, alphaToCoverage: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'treeImpostor', roughness: 0.9, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide });
  m.alphaToCoverage = alphaToCoverage;
  const u: ImpostorUniforms = {
    tImpAlbedo: { value: atlas.albedo },
    tImpNormal: { value: atlas.normal },
    uImpCenter: { value: atlas.center },
    uImpRadius: { value: atlas.radius },
    uImpFrames: { value: IMPOSTOR_FRAMES },
  };
  addCompileHook(m, 'treeImpostor', (shader) => patchImpostorShader(shader, u));
  return m;
}

/** The billboard quad (position.xy ∈ [−0.5, 0.5]); the vertex shader places and orients it. */
export function impostorQuad(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/world/impostor` → 4 pass. `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `feat(cove-life): hemi-octahedral tree impostors — runtime bake and billboard material`.

---

### Task 6: The forest

**Needs Tasks 1, 4, 5 and M7a's rocks.**

**Files:**
- Create: `src/world/vegetation/treeLayout.ts`, `src/world/vegetation/needleTexture.ts`, `src/world/vegetation/trees.ts`, `tests/world/forest.test.ts`, `tests/world/needleTexture.test.ts`
- Modify: `src/world/cove/coveLife.ts`, `src/dev/cove/main.ts`
- Output: `docs/progress/img/cove/m7b-forest-{wide,rim,inside}.png`

**Interfaces:**
- Consumes:
  - `designedCorridor`, `pondQ` (M7a); `selectLod` (M7a chunks); `applyWind`
  - `bakeImpostor`, `createImpostorMaterial`; `createGltfLoader`; `CoveRegion`
- Produces:
  - `treeLayout.ts`: `interface TreeVariant`, `TreePlacement`, `ForestParams`, `KeepOut`; `COVE_FOREST`; `layoutTrees(ground, header, variants, keepOut, params?)`; `treeCapsules(trees, variants, maxRadius = 140)`.
  - `needleTexture.ts`: `coverageMips(rgba, w, h, cutoff = 0.5)`, `loadNeedleTexture(dir)`.
  - `trees.ts`:
    - `TREE_LOD_DISTANCES = [35, 110]`, `interface TreeKit`, `TreeMeshes`, `loadTreeKit(loader, dir, kit)`
    - `class TreeField { root; collisionRoot; placements; variants; atlases; update(camera) → [lod0, lod1, impostor]; dispose() }`
    - `addTrees(cove, wind, keepOut)`: trunk cylinders into the collision world, capsules into `cove.capsules`
  - `coveLife.ts`: `rockKeepOut(cove)`; `CoveLife.trees`.

The forest layout:
- **Candidates:** a jittered 5.5 m grid over the ring from 53 to 195 m.
- **Thinning:** clearings (fBm above 0.64), slope over 34°, the corridors (+2.5 m), the pond, rock circles, and a minimum trunk spacing.
- **Saplings:** at the first 20 m of the forest edge (25 %), plus ten in the hollow.

- [ ] **Step 1: Write the failing tests**

`tests/world/forest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';
import { layoutTrees, treeCapsules, COVE_FOREST, type TreeVariant } from '../../src/world/vegetation/treeLayout';
import { layoutRocks } from '../../src/world/cove/rockLayout';
import { designedCorridor, pondQ } from '../../src/world/cove/coveGeometry';
import { FIXTURE_KIT } from './rockKitFixture';

const COVE = 'public/assets/world/cove/';
const variant = (name: string, kind: TreeVariant['kind'], height: number, crown: number, trunk: number): TreeVariant => ({ name, kind, height, crown, trunk, tris: [6000, 1500], file: `${name}.glb` });
/** The variant set pipeline/blender/cove/tree_kit.json builds. */
const VARIANTS: TreeVariant[] = [
  variant('fir_a', 'fir', 22, 3.6, 0.32), variant('fir_b', 'fir', 18, 3.1, 0.27), variant('fir_c', 'fir', 14, 2.6, 0.22),
  variant('fir_d', 'fir', 10, 2.0, 0.17), variant('fir_e', 'fir', 25, 3.4, 0.36),
  variant('sapling_a', 'sapling', 2.5, 0.9, 0.05), variant('sapling_b', 'sapling', 4, 1.3, 0.07), variant('sapling_c', 'sapling', 1.6, 0.6, 0.04),
];

describe.skipIf(!existsSync(`${COVE}terrain.json`))('the forest on the baked terrain', () => {
  const header = JSON.parse(readFileSync(`${COVE}terrain.json`, 'utf8')) as TerrainHeader;
  const hf = Heightfield.fromUint16LE(header, readFileSync(COVE + header.files.height));
  const rocks = layoutRocks(hf, header, FIXTURE_KIT);
  const keepOut = rocks.map((r) => {
    const p = FIXTURE_KIT.find((k) => k.name === r.piece)!;
    return { x: r.x, z: r.z, r: (Math.max(p.size[0], p.size[2]) * r.scale) / 2 };
  });
  const trees = layoutTrees(hf, header, VARIANTS, keepOut);

  it('is deterministic and dense, with clearings', () => {
    expect(layoutTrees(hf, header, VARIANTS, keepOut)).toEqual(trees);
    expect(trees.length).toBeGreaterThan(700);
    expect(trees.length).toBeLessThan(2400);
    const ring = trees.filter((t) => Math.hypot(t.x, t.z) >= COVE_FOREST.inner);
    const area = Math.PI * (COVE_FOREST.outer ** 2 - COVE_FOREST.inner ** 2);
    expect(ring.length / area).toBeLessThan(1 / (COVE_FOREST.spacing * COVE_FOREST.spacing * 0.8));
  });

  it('keeps trunks off the corridors, the pond, rocks, steep ground and each other', () => {
    for (const t of trees) {
      expect(designedCorridor(header, t.x, t.z, 2)).toBeNull();
      expect(pondQ(header, t.x, t.z)).toBeGreaterThan(1.5);
      expect(hf.normalAt(t.x, t.z).y).toBeGreaterThan(Math.cos((COVE_FOREST.maxSlopeDeg * Math.PI) / 180) - 1e-9);
      for (const k of keepOut) expect(Math.hypot(k.x - t.x, k.z - t.z)).toBeGreaterThan(k.r + 1);
      expect(t.y).toBeLessThan(hf.heightAt(t.x, t.z));
    }
    let tooClose = 0;
    for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++) if (Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z) < COVE_FOREST.spacing * 0.8 - 1e-9) tooClose++;
    expect(tooClose).toBe(0);
  });

  it('puts saplings at the forest edge and a few in the hollow, and gives reachable trees capsules', () => {
    const saplings = trees.filter((t) => t.variant.startsWith('sapling'));
    expect(saplings.some((t) => Math.hypot(t.x, t.z) < 35)).toBe(true);
    expect(saplings.filter((t) => Math.hypot(t.x, t.z) > COVE_FOREST.inner + 20)).toHaveLength(0);
    const caps = treeCapsules(trees, VARIANTS);
    expect(caps.length).toBeGreaterThan(100);
    for (const c of caps) expect(Math.hypot(c.x, c.z)).toBeLessThan(140);
  });

});
```

`tests/world/needleTexture.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { coverageMips } from '../../src/world/vegetation/needleTexture';

describe('needle texture mips', () => {
  it('keep the alpha-test coverage of sparse needles at every level', () => {
    const w = 64;
    const rgba = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = (x * 7 + y * 3) % 5 === 0 ? 255 : 0; // thin 20 % strands
    const levels = coverageMips(rgba, w, w);
    expect(levels.map((l) => l.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
    for (const l of levels.slice(1, 5)) {
      let pass = 0;
      for (let k = 0; k < l.width * l.height; k++) if (l.data[k * 4 + 3] > 127) pass++;
      expect(pass / (l.width * l.height)).toBeGreaterThan(0.12);
      expect(pass / (l.width * l.height)).toBeLessThan(0.3);
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail** — modules not found.

- [ ] **Step 3: Implement**

`src/world/vegetation/treeLayout.ts`:
```ts
import * as THREE from 'three';
import type { TerrainHeader } from '../terrain/heightfield';
import type { TreeCapsule } from '../region';
import { designedCorridor, pondQ } from '../cove/coveGeometry';
import { hash01, fbm2 } from './noise';

/** One tree variant of `public/assets/world/cove/trees/trees.json` (written by pipeline/blender/cove/trees.py). */
export interface TreeVariant {
  name: string;
  kind: 'fir' | 'sapling';
  /** Height, crown radius and trunk base radius (m) at scale 1. */
  height: number;
  crown: number;
  trunk: number;
  tris: [number, number];
  file: string;
}

export interface TreePlacement {
  variant: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface ForestParams {
  seed: number;
  /** Forest ring (m from the Cove centre): the rim forest starts just behind the rim. */
  inner: number;
  outer: number;
  /** Candidate grid spacing and minimum trunk spacing (× the larger crown factor). */
  spacing: number;
  /** Clearings: fBm at this scale (m) above the threshold is left open. */
  clearingScale: number;
  clearingThreshold: number;
  maxSlopeDeg: number;
  /** Share of saplings at the forest edge (first 20 m of the ring), and saplings scattered in the hollow. */
  edgeSaplings: number;
  hollowSaplings: number;
}

export const COVE_FOREST: ForestParams = {
  seed: 2024,
  inner: 53,
  outer: 195,
  spacing: 5.5,
  clearingScale: 38,
  clearingThreshold: 0.64,
  maxSlopeDeg: 34,
  edgeSaplings: 0.25,
  hollowSaplings: 10,
};

export interface ForestGround {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
}

/** A circle trees keep out of (rocks, props). */
export interface KeepOut {
  x: number;
  z: number;
  r: number;
}

/**
 * Seeded forest (spec §7.2: dense conifers with clearings on the rim, spec §7.6 variants): a jittered candidate
 * grid over the ring, thinned by clearings, slope, the designed corridors, the pond and keep-out circles, with a
 * minimum trunk spacing; big firs inside, saplings at the forest edge and a few in the hollow. Pure.
 */
export function layoutTrees(ground: ForestGround, header: TerrainHeader, variants: readonly TreeVariant[], keepOut: readonly KeepOut[], p: ForestParams = COVE_FOREST): TreePlacement[] {
  const firs = variants.filter((v) => v.kind === 'fir');
  const saplings = variants.filter((v) => v.kind === 'sapling');
  const out: TreePlacement[] = [];
  const cell = p.spacing;
  const grid = new Map<string, TreePlacement[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const n = new THREE.Vector3();
  const cosMax = Math.cos((p.maxSlopeDeg * Math.PI) / 180);
  const byName = new Map(variants.map((v) => [v.name, v]));
  const clear = (x: number, z: number, radius: number) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (const t of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const other = byName.get(t.variant)!;
          if (Math.hypot(t.x - x, t.z - z) < Math.max(radius, other.trunk * t.scale * 6, p.spacing * 0.8)) return false;
        }
      }
    }
    return true;
  };
  const allowed = (x: number, z: number, margin: number) => {
    if (designedCorridor(header, x, z, margin) !== null) return false;
    if (pondQ(header, x, z) < 1.5) return false;
    if (ground.normalAt(x, z, n).y < cosMax) return false;
    return keepOut.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + 1);
  };
  const place = (v: TreeVariant, x: number, z: number, k: number) => {
    const scale = 0.85 + 0.3 * hash01(k, 7, p.seed);
    const t: TreePlacement = { variant: v.name, x, y: ground.heightAt(x, z) - 0.25, z, yaw: hash01(k, 8, p.seed) * Math.PI * 2, scale };
    out.push(t);
    const kk = key(x, z);
    grid.set(kk, [...(grid.get(kk) ?? []), t]);
  };
  const span = Math.ceil(p.outer / cell);
  for (let j = -span; j <= span; j++) {
    for (let i = -span; i <= span; i++) {
      const k = (j + span) * (2 * span + 1) + (i + span);
      const x = (i + hash01(i, j, p.seed)) * cell;
      const z = (j + hash01(i, j, p.seed + 1)) * cell;
      const r = Math.hypot(x, z);
      if (r < p.inner || r > p.outer) continue;
      if (fbm2(x / p.clearingScale, z / p.clearingScale, p.seed + 3) > p.clearingThreshold) continue;
      if (!allowed(x, z, 2.5)) continue;
      const edge = r < p.inner + 20 && hash01(i, j, p.seed + 2) < p.edgeSaplings;
      const pool = edge && saplings.length ? saplings : firs;
      const v = pool[Math.floor(hash01(i, j, p.seed + 4) * pool.length)];
      if (!clear(x, z, v.trunk * 6)) continue;
      place(v, x, z, k);
    }
  }
  for (let k = 0, tries = 0; k < p.hollowSaplings && saplings.length && tries < 400; tries++) {
    const a = hash01(tries, 1, p.seed + 5) * Math.PI * 2;
    const r = 18 + hash01(tries, 2, p.seed + 5) * 14;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (!allowed(x, z, 3) || !clear(x, z, 3)) continue;
    place(saplings[k % saplings.length], x, z, 100000 + tries);
    k++;
  }
  return out;
}

/** Trunk colliders for the trees Toothless can reach (the spec §6.14 capsules): base, radius, height. */
export function treeCapsules(trees: readonly TreePlacement[], variants: readonly TreeVariant[], maxRadius = 140): TreeCapsule[] {
  const byName = new Map(variants.map((v) => [v.name, v]));
  return trees
    .filter((t) => Math.hypot(t.x, t.z) < maxRadius)
    .map((t) => {
      const v = byName.get(t.variant)!;
      return { x: t.x, y: t.y, z: t.z, radius: Math.max(0.12, v.trunk * t.scale), height: Math.min(6, v.height * t.scale) };
    });
}
```

`src/world/vegetation/needleTexture.ts`:
```ts
import * as THREE from 'three';

/** Fraction of texels whose alpha (0–255) exceeds the cutoff (0–1) after scaling by `scale`. */
function coverage(alpha: Float32Array, cutoff: number, scale: number): number {
  let n = 0;
  for (let k = 0; k < alpha.length; k++) if (alpha[k] * scale > cutoff * 255) n++;
  return n / alpha.length;
}

/**
 * Mip chain for alpha-tested foliage that keeps its coverage (Castaño's alpha-coverage-preserving mips): each level
 * is a 2 × 2 box filter of the previous one, then its alpha is scaled so the share of texels passing the alpha test
 * matches the base level — plain mips thin sparse needles into holey blobs at distance. RGBA8 in, RGBA8 levels out.
 */
export function coverageMips(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, cutoff = 0.5): { data: Uint8Array; width: number; height: number }[] {
  const levels = [{ data: new Uint8Array(rgba), width, height }];
  const base = new Float32Array(width * height);
  for (let k = 0; k < base.length; k++) base[k] = rgba[k * 4 + 3];
  const target = coverage(base, cutoff, 1);
  let w = width;
  let h = height;
  let src = levels[0].data;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const dst = new Uint8Array(nw * nh * 4);
    const alpha = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        for (let c = 0; c < 4; c++) {
          let s = 0;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += src[((Math.min(y * 2 + dy, h - 1)) * w + Math.min(x * 2 + dx, w - 1)) * 4 + c];
          if (c < 3) dst[(y * nw + x) * 4 + c] = Math.round(s / 4);
          else alpha[y * nw + x] = s / 4;
        }
      }
    }
    let lo = 1;
    let hi = 8;
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      if (coverage(alpha, cutoff, mid) < target) lo = mid;
      else hi = mid;
    }
    for (let k = 0; k < alpha.length; k++) dst[k * 4 + 3] = Math.min(255, Math.round(alpha[k] * hi));
    levels.push({ data: dst, width: nw, height: nh });
    src = dst;
    w = nw;
    h = nh;
  }
  return levels;
}

async function opaquePixels(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const g = canvas.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return { data: g.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

/**
 * The needle atlas as one RGBA texture with coverage-preserving mips, from the two opaque images needles.py writes
 * (`needles_albedo.webp` RGB, `needles_alpha.png` coverage) — opaque, so a canvas decode is exact. Image row 0 is the
 * top: flipY stays false, matching the glTF UVs the tree meshes carry.
 */
export async function loadNeedleTexture(dir: string): Promise<THREE.Texture> {
  const [rgb, a] = await Promise.all([opaquePixels(`${dir}needles_albedo.webp`), opaquePixels(`${dir}needles_alpha.png`)]);
  if (rgb.width !== a.width || rgb.height !== a.height) throw new Error('needles: albedo and alpha differ in size');
  const rgba = new Uint8Array(rgb.data);
  for (let k = 0; k < rgb.width * rgb.height; k++) rgba[k * 4 + 3] = a.data[k * 4];
  const levels = coverageMips(rgba, rgb.width, rgb.height);
  const tex = new THREE.DataTexture(levels[0].data, rgb.width, rgb.height, THREE.RGBAFormat);
  tex.mipmaps = levels.map((l) => ({ data: l.data, width: l.width, height: l.height })) as unknown as ImageData[];
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
```

`src/world/vegetation/trees.ts`:
```ts
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGltfLoader } from '../../render/loaders';
import type { CoveRegion } from '../cove/cove';
import { applyWind, type WindUniforms } from './wind';
import { bakeImpostor, createImpostorMaterial, impostorQuad, type ImpostorAtlas } from './impostor';
import { layoutTrees, treeCapsules, type KeepOut, type TreePlacement, type TreeVariant } from './treeLayout';
import { selectLod } from '../terrain/chunks';
import { loadNeedleTexture } from './needleTexture';

/** LOD0 → LOD1 and LOD1 → impostor switch distances (m, × the preset's lodDistanceScale; spec §4.10: ×0.5 on Low). */
export const TREE_LOD_DISTANCES = [35, 110] as const;

export interface TreeKit {
  version: 1;
  variants: TreeVariant[];
}

/** A variant's meshes per LOD: [bark, needles]. */
export interface TreeMeshes {
  lod0: THREE.Mesh[];
  lod1: THREE.Mesh[];
}

/** Loads each kit file once (all variants share `trees.glb`) and picks every variant's LOD meshes out of it. */
export async function loadTreeKit(loader: GLTFLoader, dir: string, kit: TreeKit): Promise<Map<string, TreeMeshes>> {
  const byName = new Map<string, THREE.Mesh>();
  await Promise.all(
    [...new Set(kit.variants.map((v) => v.file))].map(async (file) => {
      const gltf = await loader.loadAsync(dir + file);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) byName.set(o.name, o as THREE.Mesh);
      });
    }),
  );
  const out = new Map<string, TreeMeshes>();
  for (const v of kit.variants) {
    const get = (lod: number, part: string) => {
      const m = byName.get(`${v.name}_LOD${lod}_${part}`);
      if (!m) throw new Error(`trees: ${v.file} has no ${v.name}_LOD${lod}_${part}`);
      return m;
    };
    out.set(v.name, { lod0: [get(0, 'bark'), get(0, 'needles')], lod1: [get(1, 'bark'), get(1, 'needles')] });
  }
  return out;
}

interface Batch {
  variant: TreeVariant;
  indices: number[];
  levels: THREE.InstancedMesh[][];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const INVISIBLE = new THREE.MeshBasicMaterial({ visible: false });

/**
 * The forest: per variant, instanced LOD0 / LOD1 (bark + needle cards) and instanced octahedral impostors (baked
 * at load from LOD1), re-bucketed by camera distance when the camera has moved; trunk collision cylinders and
 * capsules for the trees Toothless can reach.
 */
export class TreeField {
  readonly root = new THREE.Group();
  readonly collisionRoot = new THREE.Group();
  private readonly level: Int8Array;
  private readonly batches: Batch[] = [];
  private readonly lastCam = new THREE.Vector3(1e9, 0, 0);
  private readonly lod0: number;
  private readonly lod1: number;

  constructor(
    readonly placements: readonly TreePlacement[],
    readonly variants: readonly TreeVariant[],
    meshes: ReadonlyMap<string, TreeMeshes>,
    readonly atlases: ReadonlyMap<string, ImpostorAtlas>,
    alphaToCoverage: boolean,
    lodDistanceScale = 1,
  ) {
    this.root.name = 'Trees';
    this.collisionRoot.name = 'TreeCollision';
    this.lod0 = TREE_LOD_DISTANCES[0] * lodDistanceScale;
    this.lod1 = TREE_LOD_DISTANCES[1] * lodDistanceScale;
    this.level = new Int8Array(placements.length).fill(-1);
    for (const v of variants) {
      const m = meshes.get(v.name);
      const atlas = atlases.get(v.name);
      if (!m || !atlas) throw new Error(`trees: variant ${v.name} not loaded`);
      const indices = placements.flatMap((p, k) => (p.variant === v.name ? [k] : []));
      if (!indices.length) continue;
      const inst = (src: THREE.Mesh, cast: boolean) => {
        const im = new THREE.InstancedMesh(src.geometry, src.material, indices.length);
        im.count = 0;
        im.castShadow = cast;
        im.receiveShadow = true;
        im.name = `${v.name}:${src.name}`;
        this.root.add(im);
        return im;
      };
      for (const mesh of [...m.lod0, ...m.lod1]) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.alphaTest > 0) mat.alphaToCoverage = alphaToCoverage;
      }
      const imp = inst(new THREE.Mesh(impostorQuad(), createImpostorMaterial(atlas, alphaToCoverage)), false);
      this.batches.push({ variant: v, indices, levels: [m.lod0.map((x) => inst(x, true)), m.lod1.map((x) => inst(x, true)), [imp]] });
    }
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
    const byName = new Map(variants.map((v) => [v.name, v]));
    for (const t of placements) {
      if (Math.hypot(t.x, t.z) > 140) continue;
      const v = byName.get(t.variant)!;
      const c = new THREE.Mesh(cyl, INVISIBLE);
      c.position.set(t.x, t.y, t.z);
      c.scale.set(Math.max(0.12, v.trunk * t.scale), Math.min(6, v.height * t.scale), Math.max(0.12, v.trunk * t.scale));
      this.collisionRoot.add(c);
    }
    this.collisionRoot.updateMatrixWorld(true);
  }

  /** Re-buckets instances by LOD when the camera has moved more than 0.5 m. Returns the instances per level. */
  update(camera: THREE.Camera): [number, number, number] {
    const cam = camera.getWorldPosition(_p);
    const counts: [number, number, number] = [0, 0, 0];
    if (cam.distanceToSquared(this.lastCam) > 0.25) {
      this.lastCam.copy(cam);
      for (const b of this.batches) {
        let dirty = false;
        for (const k of b.indices) {
          const t = this.placements[k];
          const lvl = selectLod(Math.hypot(t.x - cam.x, t.y - cam.y, t.z - cam.z), this.level[k], [this.lod0, this.lod1]);
          if (lvl !== this.level[k]) {
            this.level[k] = lvl;
            dirty = true;
          }
        }
        if (dirty) this.rebuild(b);
      }
    }
    for (const b of this.batches) for (let l = 0; l < 3; l++) counts[l] += b.levels[l][0].count;
    return counts;
  }

  private rebuild(b: Batch): void {
    const slot = [0, 0, 0];
    for (const k of b.indices) {
      const t = this.placements[k];
      const l = this.level[k];
      _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(UP, t.yaw), _s.setScalar(t.scale));
      for (const im of b.levels[l]) im.setMatrixAt(slot[l], _m);
      slot[l]++;
    }
    for (let l = 0; l < 3; l++) {
      for (const im of b.levels[l]) {
        im.count = slot[l];
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      }
    }
  }

  dispose(): void {
    for (const b of this.batches) for (const level of b.levels) for (const im of level) im.dispose();
    for (const a of this.atlases.values()) a.dispose();
  }
}

/** Loads the kit, lays out the forest around the region's rocks, bakes impostors and adds everything. */
export async function addTrees(cove: CoveRegion, wind: WindUniforms, keepOut: readonly KeepOut[]): Promise<TreeField> {
  const dir = `${cove.baseUrl}world/cove/trees/`;
  const kit = (await (await fetch(`${dir}trees.json`)).json()) as TreeKit;
  const [meshes, needles] = await Promise.all([loadTreeKit(createGltfLoader(), dir, kit), loadNeedleTexture(dir)]);
  for (const m of meshes.values()) {
    for (const mesh of [m.lod0[1], m.lod1[1]]) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.map = needles; // coverage-preserving mips (the GLB's copy thins to blobs at distance)
      mat.alphaTest = 0.5;
      mat.needsUpdate = true;
    }
  }
  for (const v of kit.variants) {
    const m = meshes.get(v.name)!;
    applyWind(m.lod0[0].material as THREE.Material, wind, { height: v.height, stiffness: 3 });
    applyWind(m.lod0[1].material as THREE.Material, wind, { height: v.height, stiffness: 1 });
    if (m.lod1[0].material !== m.lod0[0].material) applyWind(m.lod1[0].material as THREE.Material, wind, { height: v.height, stiffness: 3 });
    if (m.lod1[1].material !== m.lod0[1].material) applyWind(m.lod1[1].material as THREE.Material, wind, { height: v.height, stiffness: 1 });
  }
  const atlases = new Map<string, ImpostorAtlas>();
  for (const v of kit.variants) {
    const group = new THREE.Group();
    for (const mesh of meshes.get(v.name)!.lod1) group.add(new THREE.Mesh(mesh.geometry, mesh.material));
    atlases.set(v.name, bakeImpostor(cove.app.renderer, group));
  }
  const placements = layoutTrees(cove.hf, cove.header, kit.variants, keepOut);
  const field = new TreeField(placements, kit.variants, meshes, atlases, cove.app.preset.msaaSamples > 0, cove.app.preset.lodDistanceScale);
  cove.add(field.root);
  cove.addCollision(field.collisionRoot);
  cove.capsules.push(...treeCapsules(placements, kit.variants));
  cove.onUpdate((_dt, ctx) => field.update(ctx.camera));
  cove.onDispose(() => field.dispose());
  return field;
}
```

`coveLife.ts` — add the imports `import type { KeepOut } from '../vegetation/treeLayout';` and `import { addTrees, type TreeField } from '../vegetation/trees';`, add `trees?: TreeField;` to `CoveLife`, append:

```ts
/** Keep-out circles for trees and props: every rock placement's footprint radius. */
export function rockKeepOut(cove: CoveRegion): KeepOut[] {
  const r = cove.rocks;
  if (!r) return [];
  return r.placements.map((p) => {
    const g = r.meshes.get(p.piece)!.lods[0];
    g.computeBoundingSphere();
    return { x: p.x, z: p.z, r: g.boundingSphere!.radius * p.scale * 0.8 };
  });
}```

and in `addCoveLife`, after the density: `life.trees = await addTrees(cove, life.wind, rockKeepOut(cove));`.

`src/dev/cove/main.ts` — add to the `berk.cove` registration:
```ts
      trees: () => ({ count: c.life?.trees?.placements.length ?? 0, levels: c.life?.trees?.update(app.camera), capsules: c.capsules.length }),
```

- [ ] **Step 4: Run to verify they pass** — `npm test` → all pass (forest: 3, needle mips: 1). `npm run typecheck` clean.
- [ ] **Step 5: Visual check** — `cove.html?q=high`, console clean.
  - Capture `wide` and `rim` to `m7b-forest-wide.png` and `m7b-forest-rim.png`. Then orbit into the rim forest (about 70, 28, 40 looking at 110, 26, 80) and capture `m7b-forest-inside.png`. Read all three.
  - **Wide / rim:** a dense dark conifer forest with clearings rings the rim, and conifer silhouettes run into the haze with no visible LOD pop while orbiting.
  - **Inside:** trunks and branch cards are lit, and their shadows fall on the forest floor.
  - `berk.cove.trees()`: planning gave about 1800 trees (37 / 315 / 1442 by level at `wide`) and about 860 capsules.
  - **Known look risk:** up close, LOD0 cards read as leafy blobs rather than needle sprays. Record the capture for the Task 11 look pass.
- [ ] **Step 6: Commit** — `feat(cove-life): the rim forest — instanced conifer LODs, impostors, trunk collision`.

---

### Task 7: Grass

**Needs Tasks 1 and 2.**

**Files:**
- Create: `src/world/vegetation/grass.ts`, `tests/world/grass.test.ts`
- Modify: `src/world/cove/coveLife.ts`
- Output: `docs/progress/img/cove/m7b-grass-{floor,trample}.png`

**Interfaces:**
- Produces:
  - `MAX_TRAMPLE = 16`, `interface GrassOptions`, `COVE_GRASS` (12 m tiles, 60 m radius, 22 blades/m² at full weight)
  - `interface GrassGround`, `tileBlades(tx, tz, o, ground, densityScale)`, `bladeGeometry()`
  - `interface GrassUniforms`, `patchGrassShader`, `createGrassUniforms(radius)`, `createGrassMaterial(wind, grass)` (key `grassBlade`)
  - `class GrassField { root; uniforms; material; update(camera, spheres) → blades; dispose() }`
  - `addGrass(cove, wind, density)`

How it works:
- **Blades.** Each blade is 7 vertices / 5 triangles, built in world space in the vertex shader from per-instance `aBlade` (x, y, z, yaw) and `aShape` (height, width, lean, tint). It sways in the wind, and bends away from and flattens under each interaction sphere (spec §7.7: up to 16).
- **Density.** Tiles are laid out on the CPU from the density map; Low scales density by the preset's 0.3. Blades shrink out toward the fade radius.
- **Layer.** `LAYER_MAIN_ONLY`: no shadows cast, not in the mirror.

- [ ] **Step 1: Write the failing tests**

`tests/world/grass.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { tileBlades, COVE_GRASS, patchGrassShader, createGrassUniforms, bladeGeometry } from '../../src/world/vegetation/grass';
import { createWindUniforms } from '../../src/world/vegetation/wind';

const std = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });

describe('grass', () => {
  const ground = { heightAt: (x: number) => 0.1 * x, grassWeight: (x: number) => (x < 6 ? 1 : 0) };
  it('lays out a tile deterministically, only where grass grows, sitting on the ground', () => {
    const t = tileBlades(0, 0, COVE_GRASS, ground, 1);
    expect(tileBlades(0, 0, COVE_GRASS, ground, 1).a).toEqual(t.a);
    // half the 12 m tile (x < 6) grows grass: ≈ density × 72 m²
    expect(t.count).toBeGreaterThan(0.9 * COVE_GRASS.density * 72);
    expect(t.count).toBeLessThan(1.1 * COVE_GRASS.density * 72);
    for (let k = 0; k < t.count; k++) {
      expect(t.a[k * 4]).toBeLessThan(6.2);
      expect(t.a[k * 4 + 1]).toBeCloseTo(0.1 * t.a[k * 4], 5);
    }
    expect(tileBlades(0, 0, COVE_GRASS, ground, 0.3).count).toBeLessThan(t.count * 0.45);
  });
  it('patches the standard program with blades, wind and trample', () => {
    const s = std() as never as Parameters<typeof patchGrassShader>[0];
    patchGrassShader(s, createWindUniforms(), createGrassUniforms(60));
    expect(s.vertexShader).toContain('attribute vec4 aBlade;');
    expect(s.vertexShader).toContain('vec3 objectNormal = vec3(gYawS, 0.3, gYawC);');
    expect(s.vertexShader).toContain('uniform vec4 uTrample[16];');
    expect(bladeGeometry().index!.count).toBe(15);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement**

`src/world/vegetation/grass.ts`:
```ts
import * as THREE from 'three';
import { addCompileHook, type ShaderParams } from '../../render/materials';
import { WIND_GLSL, type WindUniforms } from './wind';
import { LAYER_MAIN_ONLY } from '../renderLayers';
import { hash01 } from './noise';

/** Up to this many interaction spheres bend grass (paws, body, tail — spec §7.7). */
export const MAX_TRAMPLE = 16;

export interface GrassOptions {
  /** Tile edge (m), tiles kept within `radius` of the camera, blades per m² at full grass weight. */
  tileSize: number;
  radius: number;
  density: number;
  /** New tiles built per frame at most (spreads the cost when the camera jumps). */
  buildPerFrame: number;
  seed: number;
}

export const COVE_GRASS: GrassOptions = { tileSize: 12, radius: 60, density: 22, buildPerFrame: 6, seed: 1337 };

/** Where grass grows and how dense (0..1), and the ground height — the region supplies both. */
export interface GrassGround {
  heightAt(x: number, z: number): number;
  grassWeight(x: number, z: number): number;
}

/**
 * Blades of one tile (world tile coords tx, tz): candidates on a jittered grid at `density` per m², each kept with
 * probability grassWeight × densityScale. Per blade: (x, y, z, yaw) and (height, width, lean, tint). Pure.
 */
export function tileBlades(tx: number, tz: number, o: GrassOptions, ground: GrassGround, densityScale: number): { a: Float32Array; b: Float32Array; count: number } {
  const per = Math.max(1, Math.round(Math.sqrt(o.density) * o.tileSize));
  const step = o.tileSize / per;
  const a: number[] = [];
  const b: number[] = [];
  for (let j = 0; j < per; j++) {
    for (let i = 0; i < per; i++) {
      const k = j * per + i;
      const x = tx * o.tileSize + (i + hash01(tx, tz, k * 4 + o.seed)) * step;
      const z = tz * o.tileSize + (j + hash01(tx, tz, k * 4 + 1 + o.seed)) * step;
      const w = ground.grassWeight(x, z) * densityScale;
      if (hash01(tx, tz, k * 4 + 2 + o.seed) >= w) continue;
      const r = hash01(tx, tz, k * 4 + 3 + o.seed);
      a.push(x, ground.heightAt(x, z), z, r * Math.PI * 2);
      b.push(0.35 + 0.45 * w * (0.6 + 0.4 * r), 0.045 + 0.02 * r, (r - 0.5) * 0.6, r);
    }
  }
  return { a: new Float32Array(a), b: new Float32Array(b), count: a.length / 4 };
}

/** A blade: 3 segments + tip, local y 0..1 (scaled by height), x −0.5..0.5 (scaled by width), normal +Z. */
export function bladeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const ys = [0, 0.3, 0.62, 1];
  const widths = [1, 0.85, 0.55, 0];
  for (let s = 0; s < 3; s++) pos.push(-0.5 * widths[s], ys[s], 0, 0.5 * widths[s], ys[s], 0);
  pos.push(0, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
  g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
  return g;
}

export interface GrassUniforms {
  uTrample: { value: THREE.Vector4[] };
  uGrassFade: { value: THREE.Vector2 };
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aBlade;
attribute vec4 aShape;
uniform vec4 uTrample[${MAX_TRAMPLE}];
uniform vec2 uGrassFade;
varying float vGrassTip;
varying float vGrassTint;
${WIND_GLSL}
`;

/**
 * Replaces <begin_vertex> and <beginnormal_vertex>: builds the blade in world space (the mesh sits at the origin
 * with identity transforms): yaw, lean, wind sway, trample (bend away from and flatten under each sphere),
 * shrink-out at the fade distance.
 */
const BEGIN_NORMAL = /* glsl */ `
float gYawC = cos(aBlade.w);
float gYawS = sin(aBlade.w);
vec3 objectNormal = vec3(gYawS, 0.3, gYawC);
`;
const BEGIN_VERTEX = /* glsl */ `
vec3 gRoot = aBlade.xyz;
float gDist = length(gRoot - cameraPosition);
float gFade = 1.0 - smoothstep(uGrassFade.x, uGrassFade.y, gDist);
float gH = aShape.x * gFade;
float gT = position.y;
vec3 gSide = vec3(gYawC, 0.0, -gYawS);
vec3 transformed = gRoot + gSide * position.x * aShape.y + vec3(0.0, gT * gH, 0.0);
vec3 gBend = vec3(gYawS, 0.0, gYawC) * aShape.z * gT * gT * gH + berkSway(gRoot, gT, gH * 4.0, 1.0) * 4.0;
for (int i = 0; i < ${MAX_TRAMPLE}; i++) {
  vec4 s = uTrample[i];
  if (s.w <= 0.0) continue;
  vec2 d = gRoot.xz - s.xz;
  float dist = length(d);
  float reach = s.w + gH;
  float k = (1.0 - smoothstep(s.w * 0.5, reach, dist)) * step(gRoot.y - 0.3, s.y);
  gBend.xz += (d / max(dist, 1e-3)) * k * gT * gH * 0.9;
  transformed.y -= k * gT * gH * 0.7;
}
transformed += gBend;
vGrassTip = gT;
vGrassTint = aShape.w;
`;

const FRAGMENT_PARS = /* glsl */ `
varying float vGrassTip;
varying float vGrassTint;
`;

const COLOR_FRAGMENT = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb *= mix(vec3(0.55, 0.6, 0.45), vec3(1.05, 1.08, 0.9), vGrassTip) * (0.85 + 0.3 * vGrassTint);
`;

export function patchGrassShader(shader: ShaderParams, wind: WindUniforms, grass: GrassUniforms): void {
  for (const a of ['#include <common>', '#include <beginnormal_vertex>', '#include <begin_vertex>']) {
    if (!shader.vertexShader.includes(a)) throw new Error(`grass: vertex anchor missing: ${a}`);
  }
  if (!shader.fragmentShader.includes('#include <color_fragment>')) throw new Error('grass: fragment anchor missing: #include <color_fragment>');
  Object.assign(shader.uniforms, wind, grass);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', () => `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <beginnormal_vertex>', () => BEGIN_NORMAL)
    .replace('#include <begin_vertex>', () => BEGIN_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', () => `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <color_fragment>', () => COLOR_FRAGMENT);
}

export function createGrassUniforms(radius: number): GrassUniforms {
  return {
    uTrample: { value: Array.from({ length: MAX_TRAMPLE }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
    uGrassFade: { value: new THREE.Vector2(radius * 0.7, radius) },
  };
}

/** Grass blades: one material (key `grassBlade`), geometric blades, no alpha (spec §4.7). */
export function createGrassMaterial(wind: WindUniforms, grass: GrassUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'grass', color: 0x5f7a2e, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  addCompileHook(m, 'grassBlade', (shader) => patchGrassShader(shader, wind, grass));
  return m;
}

interface Tile {
  key: string;
  mesh: THREE.Mesh;
}

/**
 * Camera-following grass: square tiles within `radius`, each one InstancedBufferGeometry mesh (instanced blades
 * over one shared blade), built deterministically from the tile coordinates and recycled as the camera moves.
 * Main camera only (LAYER_MAIN_ONLY): no shadows cast, not in the pond mirror.
 */
export class GrassField {
  readonly root = new THREE.Group();
  readonly uniforms: GrassUniforms;
  readonly material: THREE.MeshStandardMaterial;
  private readonly blade = bladeGeometry();
  private readonly tiles = new Map<string, Tile>();

  constructor(
    private readonly ground: GrassGround,
    wind: WindUniforms,
    private readonly o: GrassOptions = COVE_GRASS,
    private readonly densityScale = 1,
  ) {
    this.root.name = 'Grass';
    this.uniforms = createGrassUniforms(o.radius);
    this.material = createGrassMaterial(wind, this.uniforms);
  }

  /** Keeps the tiles around `camera` built; returns the blade count in use. */
  update(camera: THREE.Camera, spheres: readonly { center: THREE.Vector3; radius: number }[]): number {
    const t = this.uniforms.uTrample.value;
    for (let i = 0; i < MAX_TRAMPLE; i++) {
      const s = spheres[i];
      if (s) t[i].set(s.center.x, s.center.y, s.center.z, s.radius);
      else t[i].w = 0;
    }
    const cx = camera.position.x / this.o.tileSize;
    const cz = camera.position.z / this.o.tileSize;
    const r = this.o.radius / this.o.tileSize;
    const want = new Set<string>();
    const todo: [number, number, number][] = [];
    for (let tz = Math.floor(cz - r); tz <= Math.floor(cz + r); tz++) {
      for (let tx = Math.floor(cx - r); tx <= Math.floor(cx + r); tx++) {
        const d = Math.hypot(tx + 0.5 - cx, tz + 0.5 - cz);
        if (d > r + 0.75) continue;
        const key = `${tx},${tz}`;
        want.add(key);
        if (!this.tiles.has(key)) todo.push([tx, tz, d]);
      }
    }
    for (const [key, tile] of this.tiles) {
      if (want.has(key)) continue;
      tile.mesh.geometry.dispose();
      tile.mesh.removeFromParent();
      this.tiles.delete(key);
    }
    todo.sort((p, q) => p[2] - q[2]);
    for (const [tx, tz] of todo.slice(0, this.o.buildPerFrame)) this.build(tx, tz);
    let n = 0;
    for (const tile of this.tiles.values()) n += (tile.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
    return n;
  }

  private build(tx: number, tz: number): void {
    const { a, b, count } = tileBlades(tx, tz, this.o, this.ground, this.densityScale);
    const g = new THREE.InstancedBufferGeometry();
    g.index = this.blade.index;
    g.setAttribute('position', this.blade.getAttribute('position'));
    g.setAttribute('normal', this.blade.getAttribute('normal'));
    g.setAttribute('aBlade', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aShape', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = count;
    const s = this.o.tileSize;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(tx * s - 1, -20, tz * s - 1), new THREE.Vector3((tx + 1) * s + 1, 80, (tz + 1) * s + 1));
    if (count) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < count; k++) {
        lo = Math.min(lo, a[k * 4 + 1]);
        hi = Math.max(hi, a[k * 4 + 1]);
      }
      g.boundingBox.min.y = lo - 0.5;
      g.boundingBox.max.y = hi + 1.5;
    }
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = `grass_${tx}_${tz}`;
    mesh.layers.set(LAYER_MAIN_ONLY);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    this.tiles.set(`${tx},${tz}`, { key: `${tx},${tz}`, mesh });
  }

  dispose(): void {
    for (const t of this.tiles.values()) t.mesh.geometry.dispose();
    this.tiles.clear();
    this.blade.dispose();
    this.material.dispose();
  }
}
```

`coveLife.ts` — add `import { GrassField, COVE_GRASS } from '../vegetation/grass';`, `import { pondQ } from './coveGeometry';`, `import type { DensityMap } from '../vegetation/density';` (if not yet imported), add `grass?: GrassField;` to `CoveLife`, append:

```ts
/** Task 7: camera-following grass on the grass layer's density, trampled by the interaction spheres. */
export function addGrass(cove: CoveRegion, wind: WindUniforms, density: DensityMap): GrassField {
  const ground = {
    heightAt: (x: number, z: number) => cove.hf.heightAt(x, z),
    grassWeight: (x: number, z: number) => (pondQ(cove.header, x, z) < 1.12 ? 0 : density.grass(x, z)),
  };
  const grass = new GrassField(ground, wind, COVE_GRASS, cove.app.preset.grassDensity);
  cove.add(grass.root);
  cove.onUpdate((_dt, ctx) => {
    grass.update(ctx.camera, ctx.interactions);
    cove.app.materials.prepareTree(grass.root); // new tiles share the one prepared material; this is a WeakSet no-op
  });
  cove.onDispose(() => grass.dispose());
  return grass;
}```

and in `addCoveLife`, after the trees: `life.grass = addGrass(cove, life.wind, life.density);`.

- [ ] **Step 4: Run to verify they pass** — `npm test` → all pass (grass: 2).
- [ ] **Step 5: Visual check**
  - At `floor` on High, capture `m7b-grass-floor.png`: dense geometric grass on the floor, none in the pond, and none in the pond's reflection.
  - Trample check needs Toothless (M7a Task 14): on the game page, walk him through the grass and capture `m7b-grass-trample.png`. Blades bend away from his paws and body.
  - Record the blade count (`GrassField.update` return) at High and Low.
- [ ] **Step 6: Commit** — `feat(cove-life): camera-following instanced grass with wind and trample`.

---

### Task 8: Ground cover — scanned props, flowers, reeds

**Needs Tasks 1, 2 and 6; M7a's rock pipeline (Task 9) and runtime (Task 11).**

**Files:**
- Create: `pipeline/blender/cove/prop_kit.json`, `src/world/vegetation/groundCover.ts`, `tests/world/groundCover.test.ts`
- Modify: `pipeline/cc0/wanted.json`, `package.json` (script `cove:props`), `src/world/cove/coveLife.ts`
- Output (committed): `public/assets/world/cove/props/{<id>.glb, <id>.col.glb, kit.json}`, `docs/progress/img/cove/m7b-cover-{floor,forest,pond}.png`

**Interfaces:**
- Produces:
  - `PROP_KINDS`, `COVE_COVER`
  - `layoutCover(ground, header, density, pieces, trees, keepOut, c?) → RockPlacement[]` (drawn by M7a's `RockField`)
  - `flowerPoints(density, header, count, seed)`, `FLOWER_COLORS`, `flowerHeadGeometry()`, `flowerStemGeometry()`, `createFlowers(points, ground, wind, seed)`
  - `createReeds(header, ground, wind, trample, count, seed)`
  - `addGroundCover(cove, wind, density, trees, grass)`

The props:
- **Scans:** `fern_02`, `shrub_02`, `shrub_04`, `dead_tree_trunk`, `tree_stump_01`, `tree_stump_02` go through M7a's `rocks.py`.
- **Flowers:** heather purple, harebell blue and small yellow (spec §7.7) are geometric: a 6-petal head and a crossed stem, two instanced meshes.
- **Reeds:** grass blades at the bank, 0.8–1.5 m tall, sharing the grass trample array.

- [ ] **Step 1: Write the failing tests**

`tests/world/groundCover.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Heightfield, type TerrainHeader } from '../../src/world/terrain/heightfield';
import { layoutTrees, type TreeVariant } from '../../src/world/vegetation/treeLayout';
import { layoutCover, flowerPoints, COVE_COVER, flowerHeadGeometry, flowerStemGeometry } from '../../src/world/vegetation/groundCover';
import { layoutRocks, type KitPiece } from '../../src/world/cove/rockLayout';
import { designedCorridor, pondQ } from '../../src/world/cove/coveGeometry';
import { FIXTURE_KIT } from './rockKitFixture';

const COVE = 'public/assets/world/cove/';
const variant = (name: string, kind: TreeVariant['kind'], height: number, crown: number, trunk: number): TreeVariant => ({ name, kind, height, crown, trunk, tris: [6000, 1500], file: `${name}.glb` });
/** The variant set pipeline/blender/cove/tree_kit.json builds. */
const VARIANTS: TreeVariant[] = [
  variant('fir_a', 'fir', 22, 3.6, 0.32), variant('fir_b', 'fir', 18, 3.1, 0.27), variant('fir_c', 'fir', 14, 2.6, 0.22),
  variant('fir_d', 'fir', 10, 2.0, 0.17), variant('fir_e', 'fir', 25, 3.4, 0.36),
  variant('sapling_a', 'sapling', 2.5, 0.9, 0.05), variant('sapling_b', 'sapling', 4, 1.3, 0.07), variant('sapling_c', 'sapling', 1.6, 0.6, 0.04),
];
const prop = (name: string, size: [number, number, number]): KitPiece => ({ name, source: name.replace(/_\d+$/, ''), role: 'boulder', size, base: 0, tris: [1, 1, 1], colTris: 1, ao: true, file: '', colFile: '' });
const PROPS = [prop('fern_02_0', [1.9, 0.45, 1.7]), prop('dead_tree_trunk_0', [3.1, 0.3, 0.3]), prop('tree_stump_01_0', [1.4, 0.6, 1.6]), prop('pine_roots_0', [1.8, 0.2, 1.9]), prop('shrub_04_0', [0.75, 0.28, 0.2])];
const flatDensity = { grass: () => 0.8, forest: () => 0.7, flowers: () => 0.5 };

describe.skipIf(!existsSync(`${COVE}terrain.json`))('ground cover on the baked terrain', () => {
  const header = JSON.parse(readFileSync(`${COVE}terrain.json`, 'utf8')) as TerrainHeader;
  const hf = Heightfield.fromUint16LE(header, readFileSync(COVE + header.files.height));
  const keepOut = layoutRocks(hf, header, FIXTURE_KIT).map((r) => {
    const p = FIXTURE_KIT.find((k) => k.name === r.piece)!;
    return { x: r.x, z: r.z, r: (Math.max(p.size[0], p.size[2]) * r.scale) / 2 };
  });
  const trees = layoutTrees(hf, header, VARIANTS, keepOut);

  it('places ground cover clear of corridors, the pond, rocks and trunks', () => {
    const cover = layoutCover(hf, header, flatDensity, PROPS, trees, keepOut);
    expect(cover.length).toBeGreaterThan(0.6 * (COVE_COVER.ferns + COVE_COVER.logs + COVE_COVER.stumps + COVE_COVER.roots + COVE_COVER.shrubs));
    for (const c of cover) {
      expect(designedCorridor(header, c.x, c.z, 1)).toBeNull();
      expect(pondQ(header, c.x, c.z)).toBeGreaterThan(1.4);
    }
    const flowers = flowerPoints(flatDensity, header, 500, 3);
    expect(flowers).toHaveLength(500);
    for (const f of flowers) expect(pondQ(header, f.x, f.z)).toBeGreaterThan(1.25);
  });
  it('builds light geometric flowers', () => {
    expect(flowerHeadGeometry().index!.count).toBe(36);
    expect(flowerStemGeometry().index!.count).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement**

`pipeline/blender/cove/prop_kit.json`:
```json
{
 "sources": [
  { "id": "fern_02", "res": "2k", "role": "boulder", "arm": true, "split": { "mode": "whole" },
    "tris": [4000, 1200, 300], "collisionTris": 60, "bake": 1024, "ray": 0.1, "cage": 0.02 },
  { "id": "shrub_02", "res": "2k", "role": "boulder", "arm": true, "split": { "mode": "whole" },
    "tris": [6000, 1500, 400], "collisionTris": 80, "bake": 1024, "ray": 0.15, "cage": 0.03 },
  { "id": "shrub_04", "res": "2k", "role": "boulder", "arm": true, "split": { "mode": "whole" },
    "tris": [3000, 800, 250], "collisionTris": 40, "bake": 1024, "ray": 0.1, "cage": 0.02 },
  { "id": "dead_tree_trunk", "res": "2k", "role": "boulder", "arm": true, "closed": true, "split": { "mode": "whole" },
    "tris": [8000, 2000, 500], "collisionTris": 300, "bake": 1024, "ray": 0.2, "cage": 0.03 },
  { "id": "tree_stump_01", "res": "2k", "role": "boulder", "arm": true, "closed": true, "split": { "mode": "whole" },
    "tris": [6000, 1500, 400], "collisionTris": 200, "bake": 1024, "ray": 0.2, "cage": 0.03 },
  { "id": "tree_stump_02", "res": "2k", "role": "boulder", "arm": true, "closed": true, "split": { "mode": "whole" },
    "tris": [6000, 1500, 400], "collisionTris": 200, "bake": 1024, "ray": 0.2, "cage": 0.03 }
 ]
}
```

`src/world/vegetation/groundCover.ts`:
```ts
import * as THREE from 'three';
import type { TerrainHeader } from '../terrain/heightfield';
import type { KitPiece, RockPlacement } from '../cove/rockLayout';
import { designedCorridor, pondPoint, pondQ } from '../cove/coveGeometry';
import type { TreePlacement } from './treeLayout';
import type { KeepOut } from './treeLayout';
import { hash01 } from './noise';
import { applyWind, type WindUniforms } from './wind';
import { createGrassMaterial, createGrassUniforms, type GrassUniforms } from './grass';
import { bladeGeometry } from './grass';

export interface CoverGround {
  heightAt(x: number, z: number): number;
}

export interface CoverDensity {
  grass(x: number, z: number): number;
  forest(x: number, z: number): number;
  flowers(x: number, z: number): number;
}

/** Prop kinds by kit piece name prefix (pipeline/blender/cove/prop_kit.json). */
export const PROP_KINDS: Record<string, 'fern' | 'log' | 'stump' | 'roots' | 'shrub'> = {
  fern_02: 'fern', dead_tree_trunk: 'log', tree_stump_01: 'stump', tree_stump_02: 'stump', pine_roots: 'roots', shrub_02: 'shrub', shrub_04: 'shrub',
};

export const COVE_COVER = { seed: 99, ferns: 170, logs: 9, stumps: 14, roots: 18, shrubs: 70, flowers: 2600, reeds: 900 };

/**
 * Seeded placement of the scanned ground cover (spec §7.7): ferns in forest shade near trunks and along the shaded
 * wall foot, fallen logs and stumps in the forest, roots at big trunks, shrubs at the forest edge — all clear of
 * the corridors, the pond, rocks and trunks. Returns RockPlacements so the rock runtime (RockField) draws them.
 */
export function layoutCover(ground: CoverGround, header: TerrainHeader, density: CoverDensity, pieces: readonly KitPiece[], trees: readonly TreePlacement[], keepOut: readonly KeepOut[], c = COVE_COVER): RockPlacement[] {
  const byKind = (k: string) => pieces.filter((p) => PROP_KINDS[p.source] === k);
  const out: RockPlacement[] = [];
  const taken: KeepOut[] = [...keepOut, ...trees.map((t) => ({ x: t.x, z: t.z, r: 0.6 }))];
  const free = (x: number, z: number, r: number) =>
    designedCorridor(header, x, z, 1) === null && pondQ(header, x, z) > 1.4 && taken.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + r);
  const put = (kind: string, count: number, sample: (k: number) => [number, number] | null, scale: [number, number], sink: number) => {
    const list = byKind(kind);
    if (!list.length) return;
    for (let k = 0, tries = 0; k < count && tries < count * 40; tries++) {
      const pt = sample(tries);
      if (!pt) continue;
      const [x, z] = pt;
      const piece = list[Math.floor(hash01(tries, 1, c.seed + kind.length) * list.length)];
      const s = scale[0] + (scale[1] - scale[0]) * hash01(tries, 2, c.seed);
      const r = (Math.max(piece.size[0], piece.size[2]) * s) / 2;
      if (!free(x, z, r)) continue;
      out.push({ piece: piece.name, kind: 'floor', x, y: ground.heightAt(x, z) - sink * piece.size[1] * s - piece.base * s, z, yaw: hash01(tries, 3, c.seed) * Math.PI * 2, scale: s });
      taken.push({ x, z, r });
      k++;
    }
  };
  const ring = (r0: number, r1: number, seed: number) => (k: number): [number, number] => {
    const a = hash01(k, seed, c.seed) * Math.PI * 2;
    const r = r0 + (r1 - r0) * hash01(k, seed + 1, c.seed);
    return [Math.sin(a) * r, -Math.cos(a) * r];
  };
  const nearTree = (k: number): [number, number] | null => {
    const t = trees[Math.floor(hash01(k, 11, c.seed) * trees.length)];
    if (!t || Math.hypot(t.x, t.z) > 120) return null;
    const a = hash01(k, 12, c.seed) * Math.PI * 2;
    const d = 1.2 + hash01(k, 13, c.seed) * 3;
    return [t.x + Math.cos(a) * d, t.z + Math.sin(a) * d];
  };
  put('roots', c.roots, (k) => {
    const t = trees[Math.floor(hash01(k, 21, c.seed) * trees.length)];
    return t && Math.hypot(t.x, t.z) < 110 ? [t.x + 0.9, t.z + 0.4] : null;
  }, [0.8, 1.1], 0.1);
  put('fern', Math.round(c.ferns * 0.7), (k) => {
    const p = nearTree(k);
    return p && density.forest(p[0], p[1]) > 0.3 ? p : null;
  }, [0.7, 1.2], 0.05);
  put('fern', Math.round(c.ferns * 0.3), ring(33, 37, 31), [0.6, 1.0], 0.05);
  put('log', c.logs, ring(58, 120, 41), [0.8, 1.2], 0.25);
  put('stump', c.stumps, ring(56, 120, 51), [0.8, 1.2], 0.15);
  put('shrub', c.shrubs, (k) => {
    const p = ring(49, 66, 61)(k);
    return density.forest(p[0], p[1]) + density.grass(p[0], p[1]) > 0.4 ? p : null;
  }, [0.7, 1.3], 0.05);
  return out;
}

/** Flower points on sunny, dry grass (the density map's flower channel), three Nordic kinds (spec §7.7). */
export function flowerPoints(density: CoverDensity, header: TerrainHeader, count: number, seed: number): { x: number; z: number; kind: number }[] {
  const out: { x: number; z: number; kind: number }[] = [];
  for (let k = 0, tries = 0; out.length < count && tries < count * 30; tries++) {
    const a = hash01(tries, 1, seed) * Math.PI * 2;
    const r = Math.sqrt(hash01(tries, 2, seed)) * 36;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (hash01(tries, 3, seed) >= density.flowers(x, z)) continue;
    if (designedCorridor(header, x, z, 0.5) === 'spawn' || pondQ(header, x, z) < 1.25) continue;
    // patches: kind follows a coarse cell hash so colours cluster
    out.push({ x, z, kind: Math.floor(hash01(Math.floor(x / 5), Math.floor(z / 5), seed + 7) * 3) });
    k++;
  }
  return out;
}

/** Heather purple, harebell blue, small yellow (linear). */
export const FLOWER_COLORS = [new THREE.Color(0.42, 0.14, 0.5), new THREE.Color(0.22, 0.32, 0.85), new THREE.Color(0.95, 0.75, 0.12)];

/** A flower head: a flat six-petal star (r 3.5 cm) at the top of a stem (height 1 after scale), facing up. */
export function flowerHeadGeometry(): THREE.BufferGeometry {
  const pos: number[] = [0, 1, 0];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.035 : 0.014;
    pos.push(Math.cos(a) * r, 1 + (i % 2 === 0 ? 0.004 : 0), Math.sin(a) * r);
  }
  const idx: number[] = [];
  for (let i = 0; i < 12; i++) idx.push(0, 1 + ((i + 1) % 12), 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A stem: a thin crossed pair of quads, 0 → 1 m (scaled per instance to 0.2–0.4 m). */
export function flowerStemGeometry(): THREE.BufferGeometry {
  const w = 0.004;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, w, 1, 0, -w, 1, 0, 0, 0, -w, 0, 0, w, 0, 1, w, 0, 1, -w], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeVertexNormals();
  return g;
}

/** Instanced flowers: one stem mesh + one head mesh (instance colours), with wind. */
export function createFlowers(points: readonly { x: number; z: number; kind: number }[], ground: CoverGround, wind: WindUniforms, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Flowers';
  const stemMat = new THREE.MeshStandardMaterial({ name: 'flowerStem', color: 0x3d5a22, roughness: 0.9, side: THREE.DoubleSide });
  const headMat = new THREE.MeshStandardMaterial({ name: 'flowerHead', color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
  applyWind(stemMat, wind, { height: 1, stiffness: 0.6 });
  applyWind(headMat, wind, { height: 1, stiffness: 0.6 });
  const stems = new THREE.InstancedMesh(flowerStemGeometry(), stemMat, points.length);
  const heads = new THREE.InstancedMesh(flowerHeadGeometry(), headMat, points.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  points.forEach((p, k) => {
    const h = 0.18 + 0.2 * hash01(k, 1, seed);
    m.compose(new THREE.Vector3(p.x, ground.heightAt(p.x, p.z) - 0.02, p.z), q.setFromAxisAngle(up, hash01(k, 2, seed) * 6.28), new THREE.Vector3(h, h, h));
    stems.setMatrixAt(k, m);
    heads.setMatrixAt(k, m);
    heads.setColorAt(k, FLOWER_COLORS[p.kind].clone().multiplyScalar(0.8 + 0.4 * hash01(k, 3, seed)));
  });
  for (const im of [stems, heads]) {
    im.castShadow = false;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}

/** Reeds along the pond bank: tall blades drawn by the grass shader (key `grassBlade`) with their own fade range. */
export function createReeds(header: TerrainHeader, ground: CoverGround, wind: WindUniforms, trample: GrassUniforms['uTrample'], count: number, seed: number): THREE.Mesh {
  const a: number[] = [];
  const b: number[] = [];
  for (let k = 0, tries = 0; k < count && tries < count * 20; tries++) {
    const [x, z] = pondPoint(header, 0.93 + 0.3 * hash01(tries, 1, seed), hash01(tries, 2, seed) * Math.PI * 2);
    const y = ground.heightAt(x, z);
    if (y < header.waterLevel - 0.35 || y > header.waterLevel + 0.4) continue;
    const r = hash01(tries, 3, seed);
    a.push(x, y, z, r * Math.PI * 2);
    b.push(0.8 + 0.7 * r, 0.03, (r - 0.5) * 0.4, 0.2 * r);
    k++;
  }
  const blade = bladeGeometry();
  const g = new THREE.InstancedBufferGeometry();
  g.index = blade.index;
  g.setAttribute('position', blade.getAttribute('position'));
  g.setAttribute('normal', blade.getAttribute('normal'));
  g.setAttribute('aBlade', new THREE.InstancedBufferAttribute(new Float32Array(a), 4));
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(b), 4));
  g.instanceCount = a.length / 4;
  const p = header.pond;
  const reach = Math.max(p.a, p.b) * 1.3;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(p.cx, header.waterLevel, p.cz), reach + 2);
  const uniforms = createGrassUniforms(160);
  uniforms.uTrample = trample;
  const mat = createGrassMaterial(wind, uniforms);
  mat.name = 'reeds';
  mat.color.set(0x4c5a26);
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'Reeds';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
```

`wanted.json` — append `{ "id": "<id>", "type": "models", "res": "2k" }` for `fern_02`, `shrub_02`, `shrub_04`, `dead_tree_trunk`, `tree_stump_01` and `tree_stump_02`.

`package.json`: `"cove:props": "powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/cove/rocks.py -- --kit pipeline/blender/cove/prop_kit.json --out public/assets/world/cove/props"`.

`coveLife.ts` — add the imports (`layoutCover, flowerPoints, createFlowers, createReeds, COVE_COVER, PROP_KINDS` from `../vegetation/groundCover`; `loadRockKit, RockField` from `./rocks`; `type RockKit` from `./rockLayout`; `createGltfLoader`; `applyWind`; `LAYER_UNDERWATER` from `../renderLayers`), add `flowers?: { x: number; z: number; kind: number }[];` to `CoveLife`, append:

```ts
/** Task 8: scanned ground cover (ferns, logs, stumps, roots, shrubs), flowers and reeds. */
export async function addGroundCover(cove: CoveRegion, wind: WindUniforms, density: DensityMap, trees: readonly TreePlacement[], grass: GrassField): Promise<{ x: number; z: number; kind: number }[]> {
  const dir = `${cove.baseUrl}world/cove/props/`;
  const kit = (await (await fetch(`${dir}kit.json`)).json()) as RockKit;
  const meshes = await loadRockKit(createGltfLoader(), dir, kit);
  for (const p of kit.pieces) if (PROP_KINDS[p.source] === 'fern' || PROP_KINDS[p.source] === 'shrub') applyWind(meshes.get(p.name)!.material, wind, { height: p.size[1], stiffness: 1.5 });
  const placements = layoutCover(cove.hf, cove.header, density, kit.pieces, trees, rockKeepOut(cove));
  const props = new RockField(placements, meshes, cove.app.preset.lodDistanceScale);
  props.root.name = 'GroundCover';
  cove.add(props.root);
  cove.addCollision(props.collisionRoot);
  cove.onDispose(() => props.dispose());
  const flowers = flowerPoints(density, cove.header, Math.round(COVE_COVER.flowers * cove.app.preset.grassDensity), COVE_COVER.seed);
  cove.add(createFlowers(flowers, cove.hf, wind, COVE_COVER.seed));
  const reeds = createReeds(cove.header, cove.hf, wind, grass.uniforms.uTrample, COVE_COVER.reeds, COVE_COVER.seed);
  reeds.layers.enable(LAYER_UNDERWATER); // the stems stand in the water
  cove.add(reeds);
  return flowers;
}```

and in `addCoveLife`, after the grass: `life.flowers = await addGroundCover(cove, life.wind, life.density, life.trees.placements, life.grass);`.

- [ ] **Step 4: Run to verify they pass** — `npm test` → all pass (ground cover: 2).
- [ ] **Step 5: Build the props** — `npm run cc0:fetch`, then `npm run cove:props`: one line per piece and `kit.json: 6 pieces`. Read `rocks-kit-front.png` after `npm run cove:rocks-qa -- --rocks public/assets/world/cove/props --out docs/progress/img/cove/props` to check the orientation and cleanliness of the props.
- [ ] **Step 6: Visual check** — capture `floor`, the forest and `pond` to `m7b-cover-*.png`:
  - ferns under the rim trees and along the shaded wall foot
  - logs and stumps in the forest; shrubs at the forest edge
  - flower patches in three colours on the sunny floor
  - reeds around the bank, with their stems visible through the water
- [ ] **Step 7: Commit** — `feat(cove-life): ground cover — scanned ferns, shrubs, logs and stumps; flowers; reeds`.

---

### Task 9: Ambient life

**Needs Tasks 1, 6 and 8; M7a's pond (ripples).**

**Files:**
- Create: `src/world/life/boids.ts`, `src/world/life/life.ts`, `tests/world/boids.test.ts`, `tests/world/life.test.ts`
- Modify: `src/world/cove/coveLife.ts`
- Output: `docs/progress/img/cove/m7b-life-{pond,birds}.png`

**Interfaces:**
- Produces:
  - `boids.ts`: `interface FlockParams`, `COVE_BIRDS`, `class Flock { pos; vel; update(dt) }`.
  - `life.ts`:
    - `lifeTime`, `class FishSchool { pos; vel; update(dt); centre(out) }`, `fishGeometry()`
    - `applySwim(material)` (key `lifeSwim`), `dragonflyAt(k, t, header, out)`, `butterflyAt(k, t, anchors, heightAt, out)`
    - `wingGeometry(span, length)`, `applyFlap(material, hz, amplitude)` (key `lifeFlap`), `class LeafFall { pos; update(dt, time) }`
  - `addLife(cove, trees, flowers)`: interest points `fish` and `butterfly0–7`, updated every frame.

The spec §7.9 population:
- **Fish:** 8 in a school, seen only through the refraction.
- **Dragonflies:** 5, darting over the water.
- **Butterflies:** 8 on the flower patches.
- **Birds:** 16 boids circling above the Cove at 45–85 m.
- **Leaves:** 60, falling from the crowns near the pond; those that land on the pond ring it.

- [ ] **Step 1: Write the failing tests**

`tests/world/boids.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Flock, COVE_BIRDS } from '../../src/world/life/boids';

describe('bird flock', () => {
  it('stays in its band and circle, keeps its spacing and never goes NaN over two minutes', () => {
    const f = new Flock();
    let minSep = Infinity;
    for (let step = 0; step < 120 * 30; step++) {
      f.update(1 / 30);
      if (step > 30 * 30) {
        for (let i = 0; i < f.pos.length; i++) for (let j = i + 1; j < f.pos.length; j++) minSep = Math.min(minSep, f.pos[i].distanceTo(f.pos[j]));
      }
    }
    for (const p of f.pos) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(p.y).toBeGreaterThan(COVE_BIRDS.minY - 10);
      expect(p.y).toBeLessThan(COVE_BIRDS.maxY + 10);
      expect(Math.hypot(p.x - COVE_BIRDS.home.x, p.z - COVE_BIRDS.home.z)).toBeLessThan(COVE_BIRDS.homeRadius + 25);
    }
    expect(minSep).toBeGreaterThan(0.8);
  });
});
```

`tests/world/life.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FishSchool, dragonflyAt, butterflyAt, LeafFall, fishGeometry, wingGeometry } from '../../src/world/life/life';
import { pondQ } from '../../src/world/cove/coveGeometry';
import { testHeader } from './terrainFixtures';

const header = { ...testHeader(8), waterLevel: -0.45, pond: { cx: 9, cz: 6, a: 17.5, b: 12.5, angle: 25, depth: 2.5 } };
const bed = (x: number, z: number) => (pondQ(header, x, z) < 1 ? -2.5 * (1 - pondQ(header, x, z)) - 0.45 : 0.5);

describe('fish', () => {
  it('stay inside the pond, under the surface and above the bed for two minutes', () => {
    const s = new FishSchool(header, bed, 8, 11);
    for (let k = 0; k < 120 * 30; k++) {
      s.update(1 / 30);
      for (const p of s.pos) {
        expect(pondQ(header, p.x, p.z)).toBeLessThan(0.9);
        expect(p.y).toBeLessThan(header.waterLevel);
        expect(p.y).toBeGreaterThan(bed(p.x, p.z));
      }
    }
    expect(fishGeometry().index!.count).toBeGreaterThan(0);
  });
});

describe('insects', () => {
  it('dart over the water and flutter near their flowers, deterministically', () => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let k = 0; k < 5; k++) {
      for (let t = 0; t < 60; t += 0.7) {
        dragonflyAt(k, t, header, a);
        expect(pondQ(header, a.x, a.z)).toBeLessThan(1.01);
        expect(a.y).toBeGreaterThan(header.waterLevel + 0.25);
        expect(dragonflyAt(k, t, header, b)).toEqual(a);
      }
    }
    const anchors = [{ x: 3, z: -4 }, { x: -6, z: 2 }];
    for (let t = 0; t < 30; t += 0.9) {
      butterflyAt(1, t, anchors, () => 0, a);
      expect(Math.min(...anchors.map((q) => Math.hypot(q.x - a.x, q.z - a.z)))).toBeLessThan(2.5);
      expect(a.y).toBeGreaterThan(0.4);
    }
    expect(wingGeometry(1, 0.5).attributes.position.count).toBe(6);
  });
});

describe('falling leaves', () => {
  it('land, ring the pond when they land on water, then respawn', () => {
    const rings: [number, number][] = [];
    const leaves = new LeafFall([{ x: 9, y: 6, z: 6 }], () => 0, (x, z) => (pondQ(header, x, z) < 1 ? header.waterLevel : null), (x, z) => rings.push([x, z]), 30, 5);
    for (let k = 0; k < 30 * 40; k++) leaves.update(1 / 30, k / 30);
    expect(rings.length).toBeGreaterThan(10);
    for (const [x, z] of rings) expect(pondQ(header, x, z)).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — modules not found.

- [ ] **Step 3: Implement**

`src/world/life/boids.ts`:
```ts
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';

export interface FlockParams {
  count: number;
  /** Home the flock circles: centre, radius, and the height band it keeps to. */
  home: THREE.Vector3;
  homeRadius: number;
  minY: number;
  maxY: number;
  speed: [number, number];
  /** Neighbour radius, separation radius (m) and rule weights. */
  neighbour: number;
  separation: number;
  weights: { separate: number; align: number; cohere: number; home: number; level: number };
  seed: number;
}

export const COVE_BIRDS: FlockParams = {
  count: 16,
  home: new THREE.Vector3(0, 60, 0),
  homeRadius: 90,
  minY: 45,
  maxY: 85,
  speed: [7, 11],
  neighbour: 12,
  separation: 3.5,
  weights: { separate: 2.2, align: 0.9, cohere: 0.6, home: 0.5, level: 1.2 },
  seed: 7,
};

/**
 * Deterministic boids (separation, alignment, cohesion) held around a home circle and a height band — the bird
 * flock over the Cove (spec §7.9). O(n²) with n ≤ 20. Fixed-step `update(dt)`; positions/velocities are public.
 */
export class Flock {
  readonly pos: THREE.Vector3[] = [];
  readonly vel: THREE.Vector3[] = [];
  private readonly acc = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly sep = new THREE.Vector3();
  private readonly ali = new THREE.Vector3();
  private readonly coh = new THREE.Vector3();

  constructor(readonly p: FlockParams = COVE_BIRDS) {
    const rng = mulberry32(p.seed);
    for (let i = 0; i < p.count; i++) {
      const a = rng() * Math.PI * 2;
      const r = p.homeRadius * (0.3 + 0.4 * rng());
      this.pos.push(new THREE.Vector3(p.home.x + Math.cos(a) * r, p.minY + (p.maxY - p.minY) * rng(), p.home.z + Math.sin(a) * r));
      this.vel.push(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(p.speed[0]));
    }
  }

  update(dt: number): void {
    const p = this.p;
    const n = this.pos.length;
    for (let i = 0; i < n; i++) {
      const me = this.pos[i];
      this.sep.set(0, 0, 0);
      this.ali.set(0, 0, 0);
      this.coh.set(0, 0, 0);
      let k = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const d = me.distanceTo(this.pos[j]);
        if (d > p.neighbour) continue;
        k++;
        this.ali.add(this.vel[j]);
        this.coh.add(this.pos[j]);
        if (d < p.separation) this.sep.add(this.tmp.subVectors(me, this.pos[j]).divideScalar(Math.max(d * d, 1e-3)));
      }
      this.acc.set(0, 0, 0).addScaledVector(this.sep, p.weights.separate * 10);
      if (k) {
        this.acc.addScaledVector(this.ali.divideScalar(k).sub(this.vel[i]), p.weights.align);
        this.acc.addScaledVector(this.coh.divideScalar(k).sub(me), p.weights.cohere * 0.2);
      }
      // home: steer back inside the circle, and circle around it (tangential push)
      this.tmp.set(me.x - p.home.x, 0, me.z - p.home.z);
      const r = this.tmp.length();
      if (r > p.homeRadius) this.acc.addScaledVector(this.tmp, (-p.weights.home * (r - p.homeRadius)) / Math.max(r, 1e-3));
      this.acc.x += (-this.tmp.z / Math.max(r, 1)) * p.weights.home;
      this.acc.z += (this.tmp.x / Math.max(r, 1)) * p.weights.home;
      if (me.y < p.minY) this.acc.y += (p.minY - me.y) * p.weights.level;
      if (me.y > p.maxY) this.acc.y -= (me.y - p.maxY) * p.weights.level;
      this.acc.y -= this.vel[i].y * 0.5; // level out
      const v = this.vel[i].addScaledVector(this.acc, dt);
      const s = v.length();
      if (s > p.speed[1]) v.multiplyScalar(p.speed[1] / s);
      else if (s < p.speed[0]) v.multiplyScalar(p.speed[0] / Math.max(s, 1e-3));
    }
    for (let i = 0; i < n; i++) this.pos[i].addScaledVector(this.vel[i], dt);
  }
}
```

`src/world/life/life.ts`:
```ts
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';
import { addCompileHook } from '../../render/materials';
import type { TerrainHeader } from '../terrain/heightfield';
import { pondPoint, pondQ } from '../cove/coveGeometry';
import { hash01 } from '../vegetation/noise';

/** Shared animation clock for the life shaders (fins, wings), advanced once per frame by the region. */
export const lifeTime = { value: 0 };

/**
 * Fish in the pond (spec §7.9): a small school steering in 2D inside the pond ellipse (q < 0.7), each fish at its
 * own depth, above the bed. Seen only through the pond's refraction pre-pass (LAYER_UNDERWATER).
 */
export class FishSchool {
  readonly pos: THREE.Vector3[] = [];
  readonly vel: THREE.Vector3[] = [];
  private readonly depth: number[] = [];

  constructor(
    readonly header: TerrainHeader,
    private readonly bedAt: (x: number, z: number) => number,
    count = 8,
    seed = 11,
  ) {
    const rng = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const [x, z] = pondPoint(header, 0.1 + 0.35 * rng(), rng() * Math.PI * 2);
      this.depth.push(0.45 + 0.8 * rng());
      this.pos.push(new THREE.Vector3(x, header.waterLevel - this.depth[i], z));
      const a = rng() * Math.PI * 2;
      this.vel.push(new THREE.Vector3(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6));
    }
  }

  update(dt: number): void {
    const n = this.pos.length;
    const h = this.header;
    const acc = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = this.pos[i];
      acc.set(0, 0, 0);
      let k = 0;
      const coh = new THREE.Vector3();
      const ali = new THREE.Vector3();
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const d = p.distanceTo(this.pos[j]);
        if (d > 3) continue;
        k++;
        coh.add(this.pos[j]);
        ali.add(this.vel[j]);
        if (d < 0.6) acc.addScaledVector(new THREE.Vector3().subVectors(p, this.pos[j]).setY(0), 1.5 / Math.max(d, 0.1));
      }
      if (k) {
        acc.addScaledVector(coh.divideScalar(k).sub(p).setY(0), 0.25);
        acc.addScaledVector(ali.divideScalar(k).sub(this.vel[i]).setY(0), 0.5);
      }
      const q = pondQ(h, p.x, p.z);
      if (q > 0.55) acc.add(new THREE.Vector3(h.pond.cx - p.x, 0, h.pond.cz - p.z).normalize().multiplyScalar((q - 0.55) * 6));
      const v = this.vel[i].addScaledVector(acc, dt);
      v.y = 0;
      const s = v.length();
      if (s > 1.2) v.multiplyScalar(1.2 / s);
      else if (s < 0.35) v.multiplyScalar(0.35 / Math.max(s, 1e-3));
      p.addScaledVector(v, dt);
      const bed = this.bedAt(p.x, p.z);
      p.y = Math.max(bed + 0.18, h.waterLevel - this.depth[i]);
      p.y = Math.min(p.y, h.waterLevel - 0.12);
    }
  }

  /** The school's centre (the fish interest point). */
  centre(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    for (const p of this.pos) out.add(p);
    return out.divideScalar(Math.max(1, this.pos.length));
  }
}

/** A 30 cm fish: a flattened spindle along +Z (head) with a tail fin at −Z; swims by a sine through its body. */
export function fishGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const rings = [
    [0.16, 0.0, 0.0],
    [0.1, 0.035, 0.05],
    [0.0, 0.045, 0.06],
    [-0.1, 0.03, 0.045],
    [-0.16, 0.012, 0.015],
  ];
  const sides = 6;
  for (const [z, w, hgt] of rings) {
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos.push(Math.cos(a) * w, Math.sin(a) * hgt, z);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      idx.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  const tail = pos.length / 3;
  pos.push(0, 0, -0.16, 0, 0.06, -0.24, 0, -0.06, -0.24);
  idx.push(tail, tail + 1, tail + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertex hook `lifeSwim`: a travelling sine along −Z (tail swings most), phase per instance. */
export function applySwim(material: THREE.Material): void {
  addCompileHook(material, 'lifeSwim', (shader) => {
    shader.uniforms.uLifeTime = lifeTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', () => '#include <common>\nuniform float uLifeTime;')
      .replace('#include <begin_vertex>', () => `#include <begin_vertex>
{
  float swimPhase = 0.0;
  #ifdef USE_INSTANCING
    swimPhase = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
  #endif
  float tail = smoothstep(0.1, -0.24, transformed.z);
  transformed.x += sin(uLifeTime * 9.0 + transformed.z * 14.0 + swimPhase) * 0.035 * tail;
}`);
  });
}

/** Insect path: darting hover over the pond (dragonflies) — a new target every 1.5–3 s, eased. Pure. */
export function dragonflyAt(k: number, t: number, header: TerrainHeader, out: THREE.Vector3): THREE.Vector3 {
  const period = 1.5 + 1.5 * hash01(k, 1, 5);
  const seg = Math.floor(t / period);
  const f = t / period - seg;
  const e = f < 0.35 ? (f / 0.35) * (f / 0.35) * (3 - (2 * f) / 0.35) : 1; // quick dart, then hover
  const target = (s: number) => {
    const [x, z] = pondPoint(header, 0.15 + 0.8 * hash01(k, s, 6), hash01(k, s, 7) * Math.PI * 2);
    return [x, header.waterLevel + 0.35 + 0.8 * hash01(k, s, 8), z];
  };
  const a = target(seg);
  const b = target(seg + 1);
  const m = Math.min(1, e);
  return out.set(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m + Math.sin(t * 7 + k) * 0.03, a[2] + (b[2] - a[2]) * m);
}

/** Butterfly path: a wandering flutter around a flower anchor, hopping to another anchor every ~8 s. Pure. */
export function butterflyAt(k: number, t: number, anchors: readonly { x: number; z: number }[], heightAt: (x: number, z: number) => number, out: THREE.Vector3): THREE.Vector3 {
  const hop = Math.floor((t + k * 3.7) / 8);
  const a = anchors[Math.floor(hash01(k, hop, 9) * anchors.length)] ?? { x: 0, z: 0 };
  const x = a.x + Math.sin(t * 0.9 + k) * 1.4 + Math.sin(t * 2.3 + k * 2) * 0.35;
  const z = a.z + Math.cos(t * 0.7 + k * 1.3) * 1.4 + Math.cos(t * 2.9 + k) * 0.35;
  return out.set(x, heightAt(x, z) + 0.45 + Math.abs(Math.sin(t * 3.1 + k)) * 0.5, z);
}

/** A two-wing insect / bird silhouette (wings in XZ, body along Z); wings flap about the body axis. */
export function wingGeometry(span: number, length: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const s = span / 2;
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, length * 0.5, 0, 0, -length * 0.5, s, 0, 0, 0, 0, length * 0.5, -s, 0, 0, 0, 0, -length * 0.5], 3));
  g.setIndex([0, 1, 2, 3, 4, 5]);
  g.computeVertexNormals();
  return g;
}

/** Vertex hook `lifeFlap`: wing vertices (|x| > 0) rotate about the body axis at `hz` Hz, phase per instance. */
export function applyFlap(material: THREE.Material, hz: number, amplitude: number): void {
  const own = { uFlapHz: { value: hz }, uFlapAmp: { value: amplitude } };
  addCompileHook(material, 'lifeFlap', (shader) => {
    Object.assign(shader.uniforms, own, { uLifeTime: lifeTime });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', () => '#include <common>\nuniform float uLifeTime;\nuniform float uFlapHz;\nuniform float uFlapAmp;')
      .replace('#include <begin_vertex>', () => `#include <begin_vertex>
{
  float flapPhase = 0.0;
  #ifdef USE_INSTANCING
    flapPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
  #endif
  float ang = sin(uLifeTime * 6.2831853 * uFlapHz + flapPhase) * uFlapAmp * sign(transformed.x);
  float r = abs(transformed.x);
  transformed.y += sin(ang) * r;
  transformed.x = sign(transformed.x) * cos(ang) * r;
}`);
  });
}

/**
 * Falling leaves and needles from the crowns near the camera: they drift down with a sway, rest where they land
 * (on the pond they ring it via `onWater`), fade and respawn. Deterministic for a given seed and dt sequence.
 */
export class LeafFall {
  readonly pos: THREE.Vector3[] = [];
  private readonly state: { vy: number; phase: number; rest: number }[] = [];
  private readonly rng: () => number;

  constructor(
    private readonly sources: readonly { x: number; y: number; z: number }[],
    private readonly groundAt: (x: number, z: number) => number,
    private readonly waterAt: (x: number, z: number) => number | null,
    private readonly onWater: (x: number, z: number) => void,
    count = 60,
    seed = 13,
  ) {
    this.rng = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      this.pos.push(new THREE.Vector3());
      this.state.push({ vy: 0, phase: 0, rest: 0 });
      this.respawn(i, true);
    }
  }

  private respawn(i: number, anywhere: boolean): void {
    const s = this.sources[Math.floor(this.rng() * this.sources.length)];
    if (!s) return;
    this.pos[i].set(s.x + (this.rng() - 0.5) * 4, s.y * (anywhere ? this.rng() : 1), s.z + (this.rng() - 0.5) * 4);
    this.state[i] = { vy: 0.5 + 0.5 * this.rng(), phase: this.rng() * 6.28, rest: 0 };
  }

  update(dt: number, time: number): void {
    this.pos.forEach((p, i) => {
      const st = this.state[i];
      if (st.rest > 0) {
        st.rest -= dt;
        if (st.rest <= 0) this.respawn(i, false);
        return;
      }
      p.y -= st.vy * dt;
      p.x += Math.sin(time * 1.3 + st.phase) * 0.4 * dt;
      p.z += Math.cos(time * 1.1 + st.phase) * 0.3 * dt;
      const water = this.waterAt(p.x, p.z);
      const floor = water ?? this.groundAt(p.x, p.z);
      if (p.y <= floor) {
        p.y = floor;
        st.rest = 4;
        if (water !== null) this.onWater(p.x, p.z);
      }
    });
  }
}
```

`coveLife.ts` — add the life imports (`Flock, COVE_BIRDS`; `FishSchool, fishGeometry, applySwim, dragonflyAt, butterflyAt, wingGeometry, applyFlap, LeafFall, lifeTime`; `LAYER_MAIN_ONLY`), make `addWind` also advance `lifeTime.value += dt`, append:

```ts
/** Task 9: fish, dragonflies, butterflies, the bird flock and falling leaves (spec §7.9). */
export function addLife(cove: CoveRegion, trees: readonly TreePlacement[], flowers: readonly { x: number; z: number }[]): void {
  const h = cove.header;
  const pond = cove.pond;
  const fishSchool = new FishSchool(h, (x, z) => cove.hf.heightAt(x, z));
  const fishMat = new THREE.MeshStandardMaterial({ name: 'fish', color: 0x6d6a4c, roughness: 0.5, metalness: 0.1 });
  applySwim(fishMat);
  const fish = new THREE.InstancedMesh(fishGeometry(), fishMat, fishSchool.pos.length);
  fish.layers.set(LAYER_UNDERWATER); // behind the opaque water: seen only through the refraction pre-pass
  fish.frustumCulled = false;
  cove.add(fish);
  const fishPoint = { id: 'fish', kind: 'fish' as const, position: new THREE.Vector3(), weight: 0.4 };
  cove.interestPoints.push(fishPoint);

  const flyMat = new THREE.MeshStandardMaterial({ name: 'dragonfly', color: 0x2b6f80, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
  applyFlap(flyMat, 22, 0.35);
  const flies = new THREE.InstancedMesh(wingGeometry(0.1, 0.08), flyMat, 5);
  flies.frustumCulled = false;
  cove.add(flies);

  const bflyMat = new THREE.MeshStandardMaterial({ name: 'butterfly', color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
  applyFlap(bflyMat, 7, 0.9);
  const bflies = new THREE.InstancedMesh(wingGeometry(0.07, 0.045), bflyMat, 8);
  const tints = [0xe8a23a, 0xf2f2e6, 0xe8d24a, 0x9b6ad0];
  for (let k = 0; k < 8; k++) bflies.setColorAt(k, new THREE.Color(tints[k % tints.length]));
  bflies.frustumCulled = false;
  cove.add(bflies);
  const bflyPoints = Array.from({ length: 8 }, (_, k) => ({ id: `butterfly${k}`, kind: 'butterfly' as const, position: new THREE.Vector3(), weight: 0.2 }));
  cove.interestPoints.push(...bflyPoints);

  const flock = new Flock(COVE_BIRDS);
  const birdMat = new THREE.MeshStandardMaterial({ name: 'bird', color: 0x1c1a18, roughness: 0.8, side: THREE.DoubleSide });
  applyFlap(birdMat, 2.6, 0.55);
  const birds = new THREE.InstancedMesh(wingGeometry(0.9, 0.35), birdMat, flock.pos.length);
  birds.frustumCulled = false;
  cove.add(birds);

  const crowns = trees.filter((t) => Math.hypot(t.x - h.pond.cx, t.z - h.pond.cz) < 75).map((t) => ({ x: t.x, y: t.y + 9 * t.scale, z: t.z }));
  const leaves = new LeafFall(
    crowns.length ? crowns : [{ x: h.pond.cx, y: 20, z: h.pond.cz }],
    (x, z) => cove.hf.heightAt(x, z),
    (x, z) => (pondQ(h, x, z) < 1 && cove.hf.heightAt(x, z) < h.waterLevel ? h.waterLevel : null),
    (x, z) => pond?.ripples.spawn(x, z, 0.08),
  );
  const leafMat = new THREE.MeshStandardMaterial({ name: 'leaf', color: 0x7a5a2a, roughness: 0.9, side: THREE.DoubleSide });
  const leafMesh = new THREE.InstancedMesh(wingGeometry(0.05, 0.04), leafMat, leaves.pos.length);
  leafMesh.frustumCulled = false;
  leafMesh.layers.set(LAYER_MAIN_ONLY);
  cove.add(leafMesh);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let t = 0;
  cove.onUpdate((dt) => {
    t += dt;
    fishSchool.update(Math.min(dt, 0.05));
    fishSchool.pos.forEach((fp, k) => {
      const v = fishSchool.vel[k];
      fish.setMatrixAt(k, m.compose(fp, q.setFromEuler(e.set(0, Math.atan2(v.x, v.z), 0)), one));
    });
    fish.instanceMatrix.needsUpdate = true;
    fishSchool.centre(fishPoint.position);
    for (let k = 0; k < 5; k++) {
      dragonflyAt(k, t - 0.05, h, prev);
      dragonflyAt(k, t, h, p);
      flies.setMatrixAt(k, m.compose(p, q.setFromEuler(e.set(0, Math.atan2(p.x - prev.x, p.z - prev.z), 0)), one));
    }
    flies.instanceMatrix.needsUpdate = true;
    const heightAt = (x: number, z: number) => cove.hf.heightAt(x, z);
    for (let k = 0; k < 8; k++) {
      butterflyAt(k, t - 0.05, flowers, heightAt, prev);
      butterflyAt(k, t, flowers, heightAt, p);
      bflies.setMatrixAt(k, m.compose(p, q.setFromEuler(e.set(0, Math.atan2(p.x - prev.x, p.z - prev.z), 0)), one));
      bflyPoints[k].position.copy(p);
    }
    bflies.instanceMatrix.needsUpdate = true;
    flock.update(Math.min(dt, 0.05));
    flock.pos.forEach((bp, k) => {
      const v = flock.vel[k];
      birds.setMatrixAt(k, m.compose(bp, q.setFromEuler(e.set(-Math.asin(Math.max(-1, Math.min(1, v.y / Math.max(v.length(), 1e-3)))) * 0.5, Math.atan2(v.x, v.z), 0)), one));
    });
    birds.instanceMatrix.needsUpdate = true;
    leaves.update(Math.min(dt, 0.05), t);
    leaves.pos.forEach((lp, k) => leafMesh.setMatrixAt(k, m.compose(lp, q.setFromEuler(e.set(t * 2 + k, t * 1.3 + k * 2, 0)), one)));
    leafMesh.instanceMatrix.needsUpdate = true;
  });
}```

and in `addCoveLife`, after the ground cover: `addLife(cove, life.trees.placements, life.flowers);`.

- [ ] **Step 4: Run to verify they pass** — `npm test` → all pass (boids: 1, life: 3).
- [ ] **Step 5: Visual check** — at `pond` (High), watch 10 s, then capture `m7b-life-pond.png`:
  - fish move under the surface; dragonflies dart over the water
  - leaves fall, and some ring the water
  - butterflies flutter over the flower patches

  Then capture a sky view over the rim (`m7b-life-birds.png`): the flock circles, flapping.
- [ ] **Step 6: Commit** — `feat(cove-life): fish, dragonflies, butterflies, a bird flock and falling leaves`.

---

### Task 10: Light shafts and motes

**Needs Tasks 6 and 1.**

**Files:**
- Create: `src/world/life/atmosphere.ts`, `tests/world/atmosphere.test.ts`
- Modify: `src/world/cove/coveLife.ts`
- Output: `docs/progress/img/cove/m7b-shafts.png`

**Interfaces:**
- Produces: `interface Shaft`, `MAX_SHAFTS = 8`, `placeShafts(header, trees, sunDir, heightAt, count?, gap?, seed?)`, `createShafts(shafts, sunColor)`, `motePixels(size, distance, viewportHeight, fovDeg, maxPx)`, `createMotes(shafts, sunColor, count?, box?, maxPx?, seed?)`, `addAtmosphere(cove, trees)`.

Spec §7.8 and §7.9, and lesson §12:
- **Shafts.** They open where the sun crosses a gap in the sunward rim forest. Each is a cylindrical billboard card along the sunlight, additive and faded at its ends, edges and near the camera, brightest when looking toward the sun.
- **Motes.** Motes wrap in a 30 m box around the camera, are capped at 3 px, fade with distance and glow mainly inside the shafts.
- **Fog and layers.** Both use `fog: false` and `LAYER_MAIN_ONLY`.

- [ ] **Step 1: Write the failing tests**

`tests/world/atmosphere.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { placeShafts, motePixels } from '../../src/world/life/atmosphere';
import { testHeader } from './terrainFixtures';
import type { TreePlacement } from '../../src/world/vegetation/treeLayout';

const header = { ...testHeader(8), waterLevel: -0.45, pond: { cx: 9, cz: 6, a: 17.5, b: 12.5, angle: 25, depth: 2.5 } };

describe('light shafts and motes', () => {
  const sun = new THREE.Vector3(-0.9, 0.24, -0.36).normalize();
  it('opens shafts on the sunward rim only where no trunk blocks the sun', () => {
    const trees: TreePlacement[] = [];
    for (const r of [58, 64, 70]) { // a closed three-row forest ring: every line toward the sun hits a trunk
      for (let a = 0; a < 360; a += 3) trees.push({ variant: 'fir_a', x: Math.sin((a * Math.PI) / 180) * r, y: 0, z: -Math.cos((a * Math.PI) / 180) * r, yaw: 0, scale: 1 });
    }
    const open = placeShafts(header, [], sun, () => 20, 6);
    expect(open.length).toBe(6);
    for (const s of open) {
      expect(s.dir.y).toBeLessThan(0);
      expect(Math.hypot(s.origin.x, s.origin.z)).toBeGreaterThan(49);
    }
    expect(placeShafts(header, trees, sun, () => 20, 6)).toHaveLength(0);
  });
  it('caps mote size in pixels (no full-screen discs)', () => {
    expect(motePixels(0.012, 0.05, 1440, 50, 3)).toBe(3);
    expect(motePixels(0.012, 20, 1440, 50, 3)).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement**

`src/world/life/atmosphere.ts`:
```ts
import * as THREE from 'three';
import type { TerrainHeader } from '../terrain/heightfield';
import { azimuthDir } from '../cove/coveGeometry';
import type { TreePlacement } from '../vegetation/treeLayout';
import { hash01 } from '../vegetation/noise';

/** A light shaft: where it enters (top), the unit direction light travels, length and width (m). */
export interface Shaft {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  width: number;
}

export const MAX_SHAFTS = 8;

/**
 * Authored light shafts (spec §7.8): where the sun crosses gaps in the rim forest on its side of the Cove. Candidate
 * points on the sunward rim (±35° of the sun azimuth) whose line toward the sun passes no trunk within `gap` metres
 * for 25 m become shafts slanting down into the hollow along the sunlight. Pure.
 */
export function placeShafts(header: TerrainHeader, trees: readonly TreePlacement[], sunDir: THREE.Vector3, heightAt: (x: number, z: number) => number, count = 6, gap = 3.5, seed = 3): Shaft[] {
  const out: Shaft[] = [];
  const toSun = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  for (let k = 0; k < 200 && out.length < count; k++) {
    const az = header.sun.azimuth + (hash01(k, 1, seed) - 0.5) * 70;
    const [ux, uz] = azimuthDir(az);
    const r = 50 + hash01(k, 2, seed) * 12;
    const x = ux * r;
    const z = uz * r;
    const blocked = trees.some((t) => {
      const dx = t.x - x;
      const dz = t.z - z;
      const along = dx * toSun.x + dz * toSun.y;
      const across = Math.abs(dx * toSun.y - dz * toSun.x);
      return along > 0 && along < 25 && across < gap;
    });
    if (blocked || out.some((s) => Math.hypot(s.origin.x - x, s.origin.z - z) < 10)) continue;
    const top = new THREE.Vector3(x, heightAt(x, z) + 14, z);
    out.push({ origin: top, dir: sunDir.clone().negate(), length: 55 + 20 * hash01(k, 3, seed), width: 2.5 + 3.5 * hash01(k, 4, seed) });
  }
  return out;
}

const SHAFT_VERTEX = /* glsl */ `
attribute vec4 aShaftA; // origin xyz, length
attribute vec4 aShaftB; // dir xyz, width
varying float vAlong;
varying float vAcross;
varying float vView;
void main() {
  vec3 o = aShaftA.xyz;
  vec3 d = normalize(aShaftB.xyz);
  vec3 mid = o + d * aShaftA.w * 0.5;
  vec3 toCam = normalize(cameraPosition - mid);
  vec3 side = normalize(cross(d, toCam)); // cylindrical billboard about the shaft axis
  vec3 p = o + d * (position.y * aShaftA.w) + side * (position.x * aShaftB.w);
  vAlong = position.y;
  vAcross = position.x * 2.0;
  vView = abs(dot(normalize(cameraPosition - p), d));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const SHAFT_FRAGMENT = /* glsl */ `
uniform vec3 uShaftColor;
uniform float uShaftCamFade;
varying float vAlong;
varying float vAcross;
varying float vView;
void main() {
  float ends = smoothstep(0.0, 0.15, vAlong) * (1.0 - smoothstep(0.55, 1.0, vAlong));
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vAcross));
  float toward = 0.35 + 0.65 * vView * vView;
  float near = smoothstep(uShaftCamFade * 0.4, uShaftCamFade, gl_FragCoord.z / gl_FragCoord.w);
  gl_FragColor = vec4(uShaftColor * ends * edge * toward * near, 1.0);
}`;

/** Instanced shaft cards: additive, no fog (they fade to black, not to haze), main camera only. */
export function createShafts(shafts: readonly Shaft[], sunColor: THREE.Color): THREE.Mesh {
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  const a = new Float32Array(shafts.length * 4);
  const b = new Float32Array(shafts.length * 4);
  shafts.forEach((s, k) => {
    a.set([s.origin.x, s.origin.y, s.origin.z, s.length], k * 4);
    b.set([s.dir.x, s.dir.y, s.dir.z, s.width], k * 4);
  });
  g.setAttribute('aShaftA', new THREE.InstancedBufferAttribute(a, 4));
  g.setAttribute('aShaftB', new THREE.InstancedBufferAttribute(b, 4));
  g.instanceCount = shafts.length;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 10, 0), 150);
  const mat = new THREE.ShaderMaterial({
    name: 'lightShaft',
    vertexShader: SHAFT_VERTEX,
    fragmentShader: SHAFT_FRAGMENT,
    uniforms: { uShaftColor: { value: sunColor.clone().multiplyScalar(0.012) }, uShaftCamFade: { value: 12 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'LightShafts';
  mesh.frustumCulled = false;
  return mesh;
}

/** CPU mirror of the mote point-size rule: world size → pixels, capped (spec §7.9: the old snow must not return). */
export function motePixels(sizeMetres: number, distance: number, viewportHeight: number, fovDeg: number, maxPixels: number): number {
  const px = (sizeMetres * viewportHeight) / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(distance, 0.01));
  return Math.min(px, maxPixels);
}

const MOTE_VERTEX = /* glsl */ `
uniform float uMoteTime;
uniform float uMoteBox;
uniform float uMoteScale;
uniform float uMoteMaxPx;
uniform vec4 uShaftA[${MAX_SHAFTS}];
uniform vec4 uShaftB[${MAX_SHAFTS}];
attribute float aSeed;
varying float vMoteAlpha;
void main() {
  vec3 drift = vec3(sin(uMoteTime * 0.21 + aSeed * 13.0), sin(uMoteTime * 0.13 + aSeed * 7.0) * 0.5 - 0.15 * uMoteTime, cos(uMoteTime * 0.17 + aSeed * 11.0));
  vec3 p = position + drift;
  vec3 rel = mod(p - cameraPosition + uMoteBox * 0.5, uMoteBox) - uMoteBox * 0.5; // wrap around the camera
  vec3 w = cameraPosition + rel;
  float dist = length(rel);
  float shaft = 0.0;
  for (int i = 0; i < ${MAX_SHAFTS}; i++) {
    vec4 A = uShaftA[i];
    vec4 B = uShaftB[i];
    if (B.w <= 0.0) continue;
    vec3 d = normalize(B.xyz);
    float t = clamp(dot(w - A.xyz, d), 0.0, A.w);
    float r = length(w - (A.xyz + d * t));
    shaft = max(shaft, 1.0 - smoothstep(B.w * 0.3, B.w, r));
  }
  vMoteAlpha = (0.15 + 0.85 * shaft) * (1.0 - smoothstep(uMoteBox * 0.25, uMoteBox * 0.5, dist)) * smoothstep(0.4, 1.2, dist);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(0.012 * uMoteScale / max(-mv.z, 0.01), uMoteMaxPx);
}`;
const MOTE_FRAGMENT = /* glsl */ `
uniform vec3 uMoteColor;
varying float vMoteAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.2, 0.5, length(c))) * vMoteAlpha;
  gl_FragColor = vec4(uMoteColor * a, 1.0);
}`;

/**
 * Pollen and dust motes (spec §7.9): points wrapped in a box around the camera, ≤ `maxPx` pixels, faded by
 * distance, bright mainly inside the light shafts; additive, no fog, main camera only.
 */
export function createMotes(shafts: readonly Shaft[], sunColor: THREE.Color, count = 1500, box = 30, maxPx = 3, seed = 21): THREE.Points {
  const pos = new Float32Array(count * 3);
  const s = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    pos[k * 3] = (hash01(k, 1, seed) - 0.5) * box;
    pos[k * 3 + 1] = (hash01(k, 2, seed) - 0.5) * box;
    pos[k * 3 + 2] = (hash01(k, 3, seed) - 0.5) * box;
    s[k] = hash01(k, 4, seed);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
  const A = Array.from({ length: MAX_SHAFTS }, (_, k) => (shafts[k] ? new THREE.Vector4(shafts[k].origin.x, shafts[k].origin.y, shafts[k].origin.z, shafts[k].length) : new THREE.Vector4()));
  const B = Array.from({ length: MAX_SHAFTS }, (_, k) => (shafts[k] ? new THREE.Vector4(shafts[k].dir.x, shafts[k].dir.y, shafts[k].dir.z, shafts[k].width) : new THREE.Vector4()));
  const mat = new THREE.ShaderMaterial({
    name: 'motes',
    vertexShader: MOTE_VERTEX,
    fragmentShader: MOTE_FRAGMENT,
    uniforms: {
      uMoteTime: { value: 0 }, uMoteBox: { value: box }, uMoteScale: { value: 800 }, uMoteMaxPx: { value: maxPx },
      uShaftA: { value: A }, uShaftB: { value: B }, uMoteColor: { value: sunColor.clone().multiplyScalar(0.6) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'Motes';
  pts.frustumCulled = false;
  return pts;
}
```

`coveLife.ts` — add `import { placeShafts, createShafts, createMotes } from '../life/atmosphere';`, append `addAtmosphere`, and call it last in `addCoveLife`. The file now reads in full:

`src/world/cove/coveLife.ts`:
```ts
import * as THREE from 'three';
import type { CoveRegion } from './cove';
import type { KeepOut, TreePlacement } from '../vegetation/treeLayout';
import { createWindUniforms, applyWind, type WindUniforms } from '../vegetation/wind';
import { addTrees, type TreeField } from '../vegetation/trees';
import { loadDensityMap, type DensityMap } from '../vegetation/density';
import { GrassField, COVE_GRASS } from '../vegetation/grass';
import { layoutCover, flowerPoints, createFlowers, createReeds, COVE_COVER, PROP_KINDS } from '../vegetation/groundCover';
import { loadRockKit, RockField } from './rocks';
import type { RockKit } from './rockLayout';
import { createGltfLoader } from '../../render/loaders';
import { pondQ } from './coveGeometry';
import { LAYER_MAIN_ONLY, LAYER_UNDERWATER } from '../renderLayers';
import { Flock, COVE_BIRDS } from '../life/boids';
import { FishSchool, fishGeometry, applySwim, dragonflyAt, butterflyAt, wingGeometry, applyFlap, LeafFall, lifeTime } from '../life/life';
import { placeShafts, createShafts, createMotes } from '../life/atmosphere';

/** M7b's region parts, created in order by `addCoveLife` (Tasks 1, 2, 6–10). */
export interface CoveLife {
  wind: WindUniforms;
  density?: DensityMap;
  trees?: TreeField;
  grass?: GrassField;
  flowers?: { x: number; z: number; kind: number }[];
}

/** Keep-out circles for trees and props: every rock placement's footprint radius. */
export function rockKeepOut(cove: CoveRegion): KeepOut[] {
  const r = cove.rocks;
  if (!r) return [];
  return r.placements.map((p) => {
    const g = r.meshes.get(p.piece)!.lods[0];
    g.computeBoundingSphere();
    return { x: p.x, z: p.z, r: g.boundingSphere!.radius * p.scale * 0.8 };
  });
}

/** Task 1: region-wide wind, advanced every frame. */
export function addWind(cove: CoveRegion): WindUniforms {
  const wind = createWindUniforms();
  cove.onUpdate((dt) => {
    wind.uWindTime.value += dt;
    lifeTime.value += dt;
  });
  return wind;
}

/** Task 7: camera-following grass on the grass layer's density, trampled by the interaction spheres. */
export function addGrass(cove: CoveRegion, wind: WindUniforms, density: DensityMap): GrassField {
  const ground = {
    heightAt: (x: number, z: number) => cove.hf.heightAt(x, z),
    grassWeight: (x: number, z: number) => (pondQ(cove.header, x, z) < 1.12 ? 0 : density.grass(x, z)),
  };
  const grass = new GrassField(ground, wind, COVE_GRASS, cove.app.preset.grassDensity);
  cove.add(grass.root);
  cove.onUpdate((_dt, ctx) => {
    grass.update(ctx.camera, ctx.interactions);
    cove.app.materials.prepareTree(grass.root); // new tiles share the one prepared material; this is a WeakSet no-op
  });
  cove.onDispose(() => grass.dispose());
  return grass;
}

/** Task 8: scanned ground cover (ferns, logs, stumps, roots, shrubs), flowers and reeds. */
export async function addGroundCover(cove: CoveRegion, wind: WindUniforms, density: DensityMap, trees: readonly TreePlacement[], grass: GrassField): Promise<{ x: number; z: number; kind: number }[]> {
  const dir = `${cove.baseUrl}world/cove/props/`;
  const kit = (await (await fetch(`${dir}kit.json`)).json()) as RockKit;
  const meshes = await loadRockKit(createGltfLoader(), dir, kit);
  for (const p of kit.pieces) if (PROP_KINDS[p.source] === 'fern' || PROP_KINDS[p.source] === 'shrub') applyWind(meshes.get(p.name)!.material, wind, { height: p.size[1], stiffness: 1.5 });
  const placements = layoutCover(cove.hf, cove.header, density, kit.pieces, trees, rockKeepOut(cove));
  const props = new RockField(placements, meshes, cove.app.preset.lodDistanceScale);
  props.root.name = 'GroundCover';
  cove.add(props.root);
  cove.addCollision(props.collisionRoot);
  cove.onDispose(() => props.dispose());
  const flowers = flowerPoints(density, cove.header, Math.round(COVE_COVER.flowers * cove.app.preset.grassDensity), COVE_COVER.seed);
  cove.add(createFlowers(flowers, cove.hf, wind, COVE_COVER.seed));
  const reeds = createReeds(cove.header, cove.hf, wind, grass.uniforms.uTrample, COVE_COVER.reeds, COVE_COVER.seed);
  reeds.layers.enable(LAYER_UNDERWATER); // the stems stand in the water
  cove.add(reeds);
  return flowers;
}

/** Task 9: fish, dragonflies, butterflies, the bird flock and falling leaves (spec §7.9). */
export function addLife(cove: CoveRegion, trees: readonly TreePlacement[], flowers: readonly { x: number; z: number }[]): void {
  const h = cove.header;
  const pond = cove.pond;
  const fishSchool = new FishSchool(h, (x, z) => cove.hf.heightAt(x, z));
  const fishMat = new THREE.MeshStandardMaterial({ name: 'fish', color: 0x6d6a4c, roughness: 0.5, metalness: 0.1 });
  applySwim(fishMat);
  const fish = new THREE.InstancedMesh(fishGeometry(), fishMat, fishSchool.pos.length);
  fish.layers.set(LAYER_UNDERWATER); // behind the opaque water: seen only through the refraction pre-pass
  fish.frustumCulled = false;
  cove.add(fish);
  const fishPoint = { id: 'fish', kind: 'fish' as const, position: new THREE.Vector3(), weight: 0.4 };
  cove.interestPoints.push(fishPoint);

  const flyMat = new THREE.MeshStandardMaterial({ name: 'dragonfly', color: 0x2b6f80, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
  applyFlap(flyMat, 22, 0.35);
  const flies = new THREE.InstancedMesh(wingGeometry(0.1, 0.08), flyMat, 5);
  flies.frustumCulled = false;
  cove.add(flies);

  const bflyMat = new THREE.MeshStandardMaterial({ name: 'butterfly', color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
  applyFlap(bflyMat, 7, 0.9);
  const bflies = new THREE.InstancedMesh(wingGeometry(0.07, 0.045), bflyMat, 8);
  const tints = [0xe8a23a, 0xf2f2e6, 0xe8d24a, 0x9b6ad0];
  for (let k = 0; k < 8; k++) bflies.setColorAt(k, new THREE.Color(tints[k % tints.length]));
  bflies.frustumCulled = false;
  cove.add(bflies);
  const bflyPoints = Array.from({ length: 8 }, (_, k) => ({ id: `butterfly${k}`, kind: 'butterfly' as const, position: new THREE.Vector3(), weight: 0.2 }));
  cove.interestPoints.push(...bflyPoints);

  const flock = new Flock(COVE_BIRDS);
  const birdMat = new THREE.MeshStandardMaterial({ name: 'bird', color: 0x1c1a18, roughness: 0.8, side: THREE.DoubleSide });
  applyFlap(birdMat, 2.6, 0.55);
  const birds = new THREE.InstancedMesh(wingGeometry(0.9, 0.35), birdMat, flock.pos.length);
  birds.frustumCulled = false;
  cove.add(birds);

  const crowns = trees.filter((t) => Math.hypot(t.x - h.pond.cx, t.z - h.pond.cz) < 75).map((t) => ({ x: t.x, y: t.y + 9 * t.scale, z: t.z }));
  const leaves = new LeafFall(
    crowns.length ? crowns : [{ x: h.pond.cx, y: 20, z: h.pond.cz }],
    (x, z) => cove.hf.heightAt(x, z),
    (x, z) => (pondQ(h, x, z) < 1 && cove.hf.heightAt(x, z) < h.waterLevel ? h.waterLevel : null),
    (x, z) => pond?.ripples.spawn(x, z, 0.08),
  );
  const leafMat = new THREE.MeshStandardMaterial({ name: 'leaf', color: 0x7a5a2a, roughness: 0.9, side: THREE.DoubleSide });
  const leafMesh = new THREE.InstancedMesh(wingGeometry(0.05, 0.04), leafMat, leaves.pos.length);
  leafMesh.frustumCulled = false;
  leafMesh.layers.set(LAYER_MAIN_ONLY);
  cove.add(leafMesh);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let t = 0;
  cove.onUpdate((dt) => {
    t += dt;
    fishSchool.update(Math.min(dt, 0.05));
    fishSchool.pos.forEach((fp, k) => {
      const v = fishSchool.vel[k];
      fish.setMatrixAt(k, m.compose(fp, q.setFromEuler(e.set(0, Math.atan2(v.x, v.z), 0)), one));
    });
    fish.instanceMatrix.needsUpdate = true;
    fishSchool.centre(fishPoint.position);
    for (let k = 0; k < 5; k++) {
      dragonflyAt(k, t - 0.05, h, prev);
      dragonflyAt(k, t, h, p);
      flies.setMatrixAt(k, m.compose(p, q.setFromEuler(e.set(0, Math.atan2(p.x - prev.x, p.z - prev.z), 0)), one));
    }
    flies.instanceMatrix.needsUpdate = true;
    const heightAt = (x: number, z: number) => cove.hf.heightAt(x, z);
    for (let k = 0; k < 8; k++) {
      butterflyAt(k, t - 0.05, flowers, heightAt, prev);
      butterflyAt(k, t, flowers, heightAt, p);
      bflies.setMatrixAt(k, m.compose(p, q.setFromEuler(e.set(0, Math.atan2(p.x - prev.x, p.z - prev.z), 0)), one));
      bflyPoints[k].position.copy(p);
    }
    bflies.instanceMatrix.needsUpdate = true;
    flock.update(Math.min(dt, 0.05));
    flock.pos.forEach((bp, k) => {
      const v = flock.vel[k];
      birds.setMatrixAt(k, m.compose(bp, q.setFromEuler(e.set(-Math.asin(Math.max(-1, Math.min(1, v.y / Math.max(v.length(), 1e-3)))) * 0.5, Math.atan2(v.x, v.z), 0)), one));
    });
    birds.instanceMatrix.needsUpdate = true;
    leaves.update(Math.min(dt, 0.05), t);
    leaves.pos.forEach((lp, k) => leafMesh.setMatrixAt(k, m.compose(lp, q.setFromEuler(e.set(t * 2 + k, t * 1.3 + k * 2, 0)), one)));
    leafMesh.instanceMatrix.needsUpdate = true;
  });
}

/** Task 10: light shafts through the sunward rim forest and the motes that glow in them. */
export function addAtmosphere(cove: CoveRegion, trees: readonly TreePlacement[]): void {
  const app = cove.app;
  const sunColor = new THREE.Color(app.lighting.params.sunColor).multiplyScalar(app.lighting.params.sunIntensity);
  const shafts = placeShafts(cove.header, trees, app.lighting.sunDir, (x, z) => cove.hf.heightAt(x, z));
  const shaftMesh = createShafts(shafts, sunColor);
  shaftMesh.layers.set(LAYER_MAIN_ONLY);
  cove.add(shaftMesh);
  const motes = createMotes(shafts, sunColor);
  motes.layers.set(LAYER_MAIN_ONLY);
  cove.add(motes);
  cove.onUpdate((dt) => ((motes.material as THREE.ShaderMaterial).uniforms.uMoteTime.value += dt));
}

/** Everything M7b adds, in dependency order; called by createCove after the pond. */
export async function addCoveLife(cove: CoveRegion): Promise<CoveLife> {
  const life: CoveLife = { wind: addWind(cove) };
  life.density = await loadDensityMap(`${cove.baseUrl}world/cove/density.png`, cove.header);
  life.trees = await addTrees(cove, life.wind, rockKeepOut(cove));
  life.grass = addGrass(cove, life.wind, life.density);
  life.flowers = await addGroundCover(cove, life.wind, life.density, life.trees.placements, life.grass);
  addLife(cove, life.trees.placements, life.flowers);
  addAtmosphere(cove, life.trees.placements);
  return life;
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test` → all pass (atmosphere: 2). `npm run typecheck` clean.
- [ ] **Step 5: Visual check** — at `wide` and `floor` (High), capture `m7b-shafts.png`:
  - soft warm shafts slant in from the WNW rim, with no hard edges and no full-frame haze
  - motes are pinpricks that show mainly inside the shafts
  - nothing reads as snow

  Tune `uShaftColor` (0.012 × sun) by eye.
- [ ] **Step 6: Commit** — `feat(cove-life): light shafts through the rim forest and capped dust motes`.

---

### Task 11: Perf pass, visual QA and the M7 look review

**Needs everything above and M7a Task 14 (Toothless in the Cove).**

**Files:**
- Modify: tuning constants only (`TREE_LOD_DISTANCES`, `COVE_GRASS`, `COVE_COVER`, `POND_LOOK`, shaft and mote values), `docs/progress/phase1.md`
- Output: `docs/progress/img/cove/m7-final-*.png`

- [ ] **Step 1: Budgets on High** — `berk.perf(30)` and `berk.cove.stats()` at `wide`, `rim`, `floor`, `pond`, `gully` and inside the forest.
  - Gates: whole-frame draw calls ≤ 800 and main-view triangles ≤ 4 M (terrain + rocks + tree LODs + grass blades × 5).
  - Planning measured 620 calls and 5.7 M whole-frame triangles at `wide` before any tuning.
  - Levers, in order:
    1. Tree LOD1 stops casting shadows beyond 60 m (a second LOD1 bucket with `castShadow = false`).
    2. `TREE_LOD_DISTANCES` [30, 90].
    3. Impostors kept out of the pond mirror (set their layer to `LAYER_MAIN_ONLY`).
    4. Grass radius 50 m.
- [ ] **Step 2: Low gate (Iris Xe)** — `?q=low`, the same cameras: `berk.perf(30)` ≤ 33 ms.
  - Levers, in order:
    1. The M7a mirror every other frame.
    2. Grass density 0.2.
    3. Tree LOD distances × 0.5 (the preset's `lodDistanceScale`, already applied).
    4. Motes 800.
    5. Fewer shafts.
- [ ] **Step 3: Look pass**
  - **Needle cards** (the blob risk from Task 6). Try, in order:
    1. Bake cells from branch-tip crops rather than whole saplings (a smaller card region in `needles.py`).
    2. Smaller, more numerous LOD0 cards (`trees.py` card scale 0.6).
    3. A darker, cooler needle tint (`MeshStandardMaterial.color` about 0.8, 0.9, 0.85).
  - **Grass:** height and colour against the M1 grade.
  - **Water:** `POND_LOOK` against the real bed.
  - Keep every test green; never loosen a test.
- [ ] **Step 4: Visual QA, spec §8.4 set**
  - Without Toothless, on the Cove preview: every preset.
  - With Toothless, on the game page (M7a Task 14 spots): face close-up, three-quarter standing, gallop side-on (through grass: trample visible), pond reflection, from the rim looking down, wide establishing.
  - Save as `m7-final-<shot>.png`; Read each and compare with the M7a captures.
- [ ] **Step 5: Progress log and the user checkpoint**
  - Add "M7b — the Cove (life)" to `docs/progress/phase1.md`: captures, the perf table (High and Low, before and after tuning), tree/grass/life counts, tuned values, known limitations.
  - Spec §9 M7 ends with **the user reviewing the Cove look**; hand the captures to the controller for that review.
- [ ] **Step 6: Commit** — `perf(cove): M7 budgets and look pass; progress log`.

---

## Self-Review

**1. Spec coverage**

| Spec | Where |
|---|---|
| §7.6 trees: Blender-built firs 8–25 m + saplings; trunk with scanned bark; needle atlas baked from Poly Haven scans; LOD0 4–8k, LOD1 1–2k, octahedral LOD2; vertex wind; instanced per variant and LOD | Tasks 3–6, 1. `fir_sapling` stands in for `fir_tree_01`, which is 478 MB. The smaller firs' LOD0 is 2.8–3.2k (the big ones 4–4.5k). |
| §7.7 grass: geometric, 150–250k within ~60 m on High, density from the splat masks, wind, trample by 16 spheres | Task 7 (count measured and tuned in Task 11; planning's floor view had ~45k with the density map) |
| §7.7 ferns, shrubs, flowers (three Nordic kinds), moss patches, logs, stumps, roots | Task 8. Moss patches are the terrain's moss layer and the rock moss (M7a); roots are deferred (the multi-material scan). |
| §7.9 fish, dragonflies, butterflies (interest points), bird flock, falling leaves with ripples, motes (capped, distance-faded, mainly in shafts) | Tasks 9–10 |
| §7.8 shafts where the sun crosses tree gaps | Task 10 |
| §4.7 alpha-to-coverage on foliage | Task 6 (High with MSAA; alpha test on Low) |
| §4.10 / §8.5 budgets and the Low gate | Task 11 |
| §6.14 trees as capsules | Task 6 `treeCapsules` + collision cylinders (Plan 3's `CollisionWorld` consumes meshes) |

**2. Placeholder scan** — none. Every code step carries complete code; the `coveLife.ts` edits show the exact functions to append and their `addCoveLife` lines, with the whole file at Task 10.

**3. Consistency**
- `CoveLife` fields grow per task.
- `TreeVariant` comes from `trees.json` (`trees.py` writes exactly those keys).
- The needle texture loader expects `needles_albedo.webp` and `needles_alpha.png` (`needles.py`).
- Hook keys `vegWind`, `treeImpostor`, `grassBlade`, `lifeSwim` and `lifeFlap` each inject one fixed text.
- Layer use matches the Global Constraints.

**4. Risks for the controller**
- The LOD0 needle-card look (Task 6/11).
- The High budget before tuning (5.7 M whole-frame triangles).
- The Low gate is unmeasured on real hardware.
- Tree shadows stop at the LOD1 → impostor switch.
- Grass counts depend on the density map.
- Roots are deferred.
