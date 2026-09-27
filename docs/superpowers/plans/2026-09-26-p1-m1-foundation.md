# Phase 1 · M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new Isle of Berk engine: a Vite/TypeScript project with a fixed-step loop, input, debug API, the film-look render stack (CSM sun, physically based sky + IBL, height fog, N8AO, bloom, tone curve, grade LUT), three working pages (game, Motion Lab, Asset Viewer) and a CC0 asset pipeline — all rendering a lit test scene.

**Architecture:** Pure, unit-tested core modules (`src/core`, grade/fog/sun maths) plus thin GPU-facing wrappers (`src/render`) assembled by one `createApp()` bootstrap shared by all pages. Every material passes through one material pipeline (CSM + fog shader hooks) so shader patches compose. The simulation runs in fixed 1/120 s steps; pages add systems to the shared `GameLoop`.

**Tech Stack:** Vite 8.3.1, TypeScript 7.0.2, three.js 0.186.1, n8ao 2.0.1, lil-gui 0.21.0, Vitest 5.0.2, Node 24 scripts, sharp 0.35.4.

**Spec:** `docs/superpowers/specs/2026-09-26-phase1-vertical-slice-design.md` (§3 architecture, §4 rendering, §8 verification). Program context: `docs/superpowers/specs/2026-09-26-isle-of-berk-roadmap.md`.

## Global Constraints

- Exact dependency versions: three 0.186.1, three-mesh-bvh 0.9.15, n8ao 2.0.1, lil-gui 0.21.0, vite 8.3.1, vitest 5.0.2, typescript 7.0.2, @types/three 0.186.0, sharp 0.35.4.
- World units are metres. +Y up, +X east, −Z north. Sun azimuth 0° = north, 90° = east.
- Simulation: fixed 1/120 s steps, at most 8 steps per frame (backlog dropped beyond that).
- Every scene material goes through the app's material pipeline (`app.add(root)` / `materials.prepare(m)`); never assign `onBeforeCompile` directly — use `addCompileHook`.
- Post order: AO → Bloom → Output (tone curve + sRGB) → Grade (LUT + vignette) → SMAA only when MSAA is off.
- Never bind Ctrl in the game (Ctrl+W closes the tab even under pointer lock).
- The renderer is disposed on `pagehide` (no WebGL context leaks across navigations).
- Debug/tooling API lives on `window.berk` via `DebugRegistry`.
- Dev server port 5190; the built game is served on port 8750.
- Textures are WebP (no KTX2 tooling install). Poly Haven requests send a `User-Agent`.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Git identity is repo-local `zacle <zaclements@gmail.com>` (already configured).
- Shell is PowerShell on Windows; multi-line commit messages use `git commit -m @'...'@` (closing `'@` at column 0).

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` | project config |
| `index.html`, `lab.html`, `viewer.html` | page shells |
| `src/styles.css` | shared page styles |
| `src/types/n8ao.d.ts` | type declarations for n8ao (ships none) |
| `src/core/clock.ts` | `FixedStepClock` — real time → fixed steps + interpolation alpha |
| `src/core/loop.ts` | `GameLoop` — prioritised sim systems + renderers, pause/step |
| `src/core/input.ts` | `InputState`, `KeyboardMouseInput`, `ScriptedInput` |
| `src/core/debug.ts` | `DebugRegistry` + shared `debug` instance (`window.berk`) |
| `src/core/rng.ts` | `mulberry32` seeded PRNG |
| `src/render/quality.ts` | `QualityPreset`, `PRESETS`, `choosePreset`, `gpuRendererName` |
| `src/render/renderer.ts` | `createRenderer` |
| `src/render/grade.ts` | `GradeParams`, `gradeColor`, `bakeLutData`, `bakeLut` |
| `src/render/post.ts` | `createPostStack` (N8AO/Render → Bloom → Output → Grade → SMAA) |
| `src/render/sun.ts` | `sunDirection(azimuth, elevation)` |
| `src/render/materials.ts` | `addCompileHook`, `createMaterialPipeline` |
| `src/render/fog.ts` | height fog: `installFogChunks`, `applyBerkFog`, `fogUniforms`, `berkFogFactor` |
| `src/render/lighting.ts` | `LightingRig` (CSM sun + hemisphere fill), `GOLDEN_HOUR` |
| `src/render/sky.ts` | `SkySystem` (Preetham sky with clouds + PMREM environment) |
| `src/render/loaders.ts` | `createGltfLoader` (meshopt) |
| `src/app/createApp.ts` | shared bootstrap for all pages |
| `src/dev/perf.ts` | `measureRenderCost`, `rendererStats` |
| `src/dev/filmstrip.ts` | `filmstripLayout`, `captureFilmstrip`, `showOverlay` |
| `src/world/testScene.ts` | M1 lit test scene |
| `src/main.ts` | game page (M1: test scene + orbit camera) |
| `src/dev/lab/course.ts` | Motion Lab test course geometry |
| `src/dev/lab/main.ts` | Motion Lab page |
| `src/dev/viewer/main.ts` | Asset Viewer page |
| `pipeline/cc0/polyhaven.mjs` | pure Poly Haven file selection, manifest, credits |
| `pipeline/cc0/fetch.mjs` | download wanted assets into the cache, write manifest + CREDITS.md |
| `pipeline/cc0/process-textures.mjs` | convert cached textures to WebP under `public/assets` |
| `pipeline/cc0/wanted.json` | the asset wish-list |
| `tools/serve-dist.ps1`, `tools/launch-game.bat` | double-click launcher |
| `tests/**` | Vitest unit tests |
| `docs/progress/phase1.md` | milestone progress log with screenshots |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `lab.html`, `viewer.html`, `src/styles.css`, `src/main.ts`, `src/dev/lab/main.ts`, `src/dev/viewer/main.ts`, `src/types/n8ao.d.ts`, `tests/smoke.test.ts`, `README.md`

**Interfaces:**
- Produces: `npm run dev|build|test|typecheck`; pages at `/`, `/lab.html`, `/viewer.html`; `#app`, `#hud`, `#overlay` DOM hooks; the `n8ao` module type.

- [ ] **Step 1: Write the config files**

`package.json`:
```json
{
  "name": "isle-of-berk",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --port 8750 --strictPort",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "cc0:fetch": "node pipeline/cc0/fetch.mjs",
    "cc0:textures": "node pipeline/cc0/process-textures.mjs"
  },
  "dependencies": {
    "lil-gui": "0.21.0",
    "n8ao": "2.0.1",
    "three": "0.186.1",
    "three-mesh-bvh": "0.9.15"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/three": "0.186.0",
    "sharp": "0.35.4",
    "typescript": "7.0.2",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client", "node"],
    "noEmit": true
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

`vite.config.ts`:
```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5190, strictPort: true },
  preview: { port: 8750, strictPort: true },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        lab: resolve(import.meta.dirname, 'lab.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
    },
  },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'pipeline/**/*.test.mjs'],
  },
});
```

- [ ] **Step 2: Write the page shells, styles and entry stubs**

`index.html` (repeat for `lab.html` with title `Isle of Berk — Motion Lab` and script `/src/dev/lab/main.ts`, and `viewer.html` with title `Isle of Berk — Asset Viewer` and script `/src/dev/viewer/main.ts`):
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Isle of Berk</title>
  <link rel="icon" href="data:," />
</head>
<body>
  <div id="app"></div>
  <div id="hud"></div>
  <div id="overlay"><img alt="capture" /></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`src/styles.css`:
```css
html, body { margin: 0; height: 100%; overflow: hidden; background: #0b1018; }
#app { position: fixed; inset: 0; }
#app canvas { display: block; width: 100%; height: 100%; }
#hud {
  position: fixed; left: 14px; bottom: 12px; color: #dfeaf2;
  font: 12px/1.5 "Segoe UI", system-ui, sans-serif;
  background: rgba(8, 14, 22, 0.55); padding: 6px 10px; border-radius: 6px; pointer-events: none;
}
#overlay { position: fixed; inset: 0; display: none; place-items: center; background: rgba(0, 0, 0, 0.88); z-index: 10; }
#overlay.show { display: grid; }
#overlay img { max-width: 98vw; max-height: 98vh; }
```

`src/main.ts`, `src/dev/lab/main.ts`, `src/dev/viewer/main.ts` (stubs — replaced in Tasks 8–9; for the lab and viewer use `'../../styles.css'`):
```ts
import './styles.css';

document.getElementById('hud')!.textContent = 'Isle of Berk — scaffold';
```

`src/types/n8ao.d.ts`:
```ts
declare module 'n8ao' {
  import type { Camera, Color, Scene, WebGLRenderTarget } from 'three';
  import { Pass } from 'three/addons/postprocessing/Pass.js';

  export type N8AOQualityMode =
    | 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
    | 'Neural-Low' | 'Neural-Medium' | 'Neural-High';

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    gammaCorrection: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    screenSpaceRadius: boolean;
    transparencyAware: boolean;
    autoRenderBeauty: boolean;
    accumulate: boolean;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
  }

  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    beautyRenderTarget: WebGLRenderTarget;
    setQualityMode(mode: N8AOQualityMode): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
    setSize(width: number, height: number): void;
  }
}
```

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('toolchain', () => {
  it('runs against three r186', () => {
    expect(THREE.REVISION).toBe('186');
  });
});
```

`README.md`:
```markdown
# Isle of Berk

Rebuild of the Night Fury game (see `docs/superpowers/specs/`).

- `npm run dev` — dev server on http://localhost:5190 (game `/`, Motion Lab `/lab.html`, Asset Viewer `/viewer.html`)
- `npm test` — unit tests · `npm run typecheck` — TypeScript
- `npm run build` — production build into `dist/`; `tools/launch-game.bat` serves it on http://localhost:8750
- `npm run cc0:fetch` / `npm run cc0:textures` — CC0 asset pipeline (see `pipeline/cc0/`)
- Debug API in the browser console: `berk`
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: completes without errors (npm also installs n8ao's peer `postprocessing` automatically).

- [ ] **Step 4: Run the smoke test, typecheck and build**

Run: `npm test`
Expected: 1 passed.
Run: `npm run typecheck`
Expected: exits 0 with no output.
Run: `npm run build`
Expected: `dist/index.html`, `dist/lab.html`, `dist/viewer.html` exist.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m @'
chore: scaffold Vite + TypeScript project with three pages

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 2: Fixed-step clock and game loop

**Files:**
- Create: `src/core/clock.ts`, `src/core/loop.ts`
- Test: `tests/core/clock.test.ts`, `tests/core/loop.test.ts`

**Interfaces:**
- Produces: `class FixedStepClock { constructor(step = 1/120, maxSteps = 8); advance(elapsed: number): { steps: number; alpha: number }; reset(): void; readonly step: number }`
- Produces: `class GameLoop { constructor(clock?: FixedStepClock); simTime: number; frameCount: number; addSim(fn: (dt: number) => void, priority = 0): () => void; addRender(fn: (alpha: number, frameDt: number) => void, priority = 0): () => void; frame(elapsed: number): void; step(n = 1, dt = clock.step): void; pause(): void; resume(): void; isPaused: boolean; start(): void; stop(): void }` — lower priority runs first; equal priority runs in insertion order.

- [ ] **Step 1: Write the failing tests**

`tests/core/clock.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FixedStepClock } from '../../src/core/clock';

describe('FixedStepClock', () => {
  it('runs two 1/120 s steps for a 1/60 s frame', () => {
    const c = new FixedStepClock(1 / 120, 8);
    const r = c.advance(1 / 60);
    expect(r.steps).toBe(2);
    expect(r.alpha).toBeCloseTo(0, 6);
  });

  it('carries the remainder between frames', () => {
    const c = new FixedStepClock(1 / 120, 8);
    const a = c.advance(0.004);
    expect(a.steps).toBe(0);
    expect(a.alpha).toBeCloseTo(0.48, 6);
    const b = c.advance(0.005);
    expect(b.steps).toBe(1);
    expect(b.alpha).toBeCloseTo((0.009 - 1 / 120) * 120, 6);
  });

  it('drops the backlog beyond maxSteps (e.g. after a hidden tab)', () => {
    const c = new FixedStepClock(1 / 120, 8);
    const r = c.advance(1.0);
    expect(r.steps).toBe(8);
    expect(r.alpha).toBe(0);
    expect(c.advance(0).steps).toBe(0);
  });

  it('ignores negative elapsed time', () => {
    const c = new FixedStepClock(1 / 120, 8);
    expect(c.advance(-5).steps).toBe(0);
    expect(c.advance(-5).alpha).toBe(0);
  });
});
```

`tests/core/loop.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GameLoop } from '../../src/core/loop';
import { FixedStepClock } from '../../src/core/clock';

describe('GameLoop', () => {
  it('runs fixed sim steps then one render per frame', () => {
    const loop = new GameLoop(new FixedStepClock(1 / 120, 8));
    const dts: number[] = [];
    const alphas: number[] = [];
    loop.addSim((dt) => dts.push(dt));
    loop.addRender((alpha) => alphas.push(alpha));
    loop.frame(1 / 60);
    expect(dts).toEqual([1 / 120, 1 / 120]);
    expect(alphas.length).toBe(1);
    expect(loop.simTime).toBeCloseTo(1 / 60, 9);
  });

  it('does not simulate while paused but still renders the current state', () => {
    const loop = new GameLoop();
    let sims = 0;
    const alphas: number[] = [];
    loop.addSim(() => sims++);
    loop.addRender((a) => alphas.push(a));
    loop.pause();
    loop.frame(1 / 30);
    expect(sims).toBe(0);
    expect(alphas).toEqual([1]);
  });

  it('step(n) advances exactly n steps even while paused', () => {
    const loop = new GameLoop();
    const dts: number[] = [];
    let renders = 0;
    loop.addSim((dt) => dts.push(dt));
    loop.addRender(() => renders++);
    loop.pause();
    loop.step(3, 1 / 60);
    expect(dts).toEqual([1 / 60, 1 / 60, 1 / 60]);
    expect(renders).toBe(1);
    expect(loop.simTime).toBeCloseTo(0.05, 9);
  });

  it('removal functions detach systems', () => {
    const loop = new GameLoop();
    let n = 0;
    const off = loop.addSim(() => n++);
    off();
    loop.frame(1 / 60);
    expect(n).toBe(0);
  });

  it('orders systems by priority (lower first), then insertion', () => {
    const loop = new GameLoop();
    const order: string[] = [];
    loop.addSim(() => order.push('b'), 10);
    loop.addSim(() => order.push('a'), 0);
    loop.addSim(() => order.push('c'), 10);
    loop.step(1);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core`
Expected: FAIL — cannot resolve `../../src/core/clock` / `../../src/core/loop`.

- [ ] **Step 3: Implement**

`src/core/clock.ts`:
```ts
export interface StepResult {
  /** Fixed simulation steps to run this frame. */
  steps: number;
  /** Interpolation factor from the previous toward the current simulation state (0..1). */
  alpha: number;
}

/** Accumulates real frame time into fixed simulation steps ("fix your timestep"). */
export class FixedStepClock {
  private acc = 0;

  constructor(
    readonly step = 1 / 120,
    readonly maxSteps = 8,
  ) {}

  advance(elapsed: number): StepResult {
    this.acc += Math.max(0, elapsed);
    let steps = Math.floor(this.acc / this.step);
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.acc = 0; // drop the backlog instead of spiralling (hidden tab, debugger pause, ...)
    } else {
      this.acc = Math.max(0, this.acc - steps * this.step);
    }
    return { steps, alpha: this.acc / this.step };
  }

  reset(): void {
    this.acc = 0;
  }
}
```

`src/core/loop.ts`:
```ts
import { FixedStepClock } from './clock';

export type SimSystem = (dt: number) => void;
export type RenderFn = (alpha: number, frameDt: number) => void;

interface Entry<T> {
  fn: T;
  priority: number;
  seq: number;
}

/** Drives fixed-step simulation systems and per-frame renderers. Lower priority runs first. */
export class GameLoop {
  simTime = 0;
  frameCount = 0;
  private readonly sims: Entry<SimSystem>[] = [];
  private readonly renders: Entry<RenderFn>[] = [];
  private seq = 0;
  private paused = false;
  private rafId = 0;
  private lastNow = 0;

  constructor(readonly clock = new FixedStepClock()) {}

  addSim(fn: SimSystem, priority = 0): () => void {
    return this.add(this.sims, fn, priority);
  }

  addRender(fn: RenderFn, priority = 0): () => void {
    return this.add(this.renders, fn, priority);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.clock.reset();
  }

  /** Advance one real frame of `elapsed` seconds (called by start(); public for tests and tools). */
  frame(elapsed: number): void {
    this.frameCount++;
    if (this.paused) {
      this.renderAll(1, elapsed);
      return;
    }
    const { steps, alpha } = this.clock.advance(elapsed);
    for (let i = 0; i < steps; i++) this.tick(this.clock.step);
    this.renderAll(alpha, elapsed);
  }

  /** Run exactly n simulation steps now (works while paused), then render the newest state. */
  step(n = 1, dt = this.clock.step): void {
    for (let i = 0; i < n; i++) this.tick(dt);
    this.renderAll(1, dt * n);
  }

  start(): void {
    if (this.rafId) return;
    this.lastNow = performance.now();
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      const elapsed = Math.min((now - this.lastNow) / 1000, 0.25);
      this.lastNow = now;
      this.frame(elapsed);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private tick(dt: number): void {
    for (const s of this.sims) s.fn(dt);
    this.simTime += dt;
  }

  private renderAll(alpha: number, frameDt: number): void {
    for (const r of this.renders) r.fn(alpha, frameDt);
  }

  private add<T>(list: Entry<T>[], fn: T, priority: number): () => void {
    const entry: Entry<T> = { fn, priority, seq: this.seq++ };
    list.push(entry);
    list.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    return () => {
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/core`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```powershell
git add src/core tests/core
git commit -m @'
feat(core): fixed-step clock and prioritised game loop

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 3: Input sources

**Files:**
- Create: `src/core/input.ts`
- Test: `tests/core/input.test.ts`

**Interfaces:**
- Produces: `interface InputState { keys: ReadonlySet<string>; pressed: ReadonlySet<string>; mouseDX: number; mouseDY: number; wheel: number; buttons: number; buttonsPressed: number }`
- Produces: `interface InputSource { sample(simTime: number): InputState; dispose(): void }`
- Produces: `class KeyboardMouseInput implements InputSource { constructor(target: EventTarget, isLocked?: () => boolean) }`
- Produces: `interface InputEvent { t: number; down?: string[]; up?: string[]; mouse?: [number, number]; wheel?: number; buttonsDown?: number; buttonsUp?: number }`, `class ScriptedInput implements InputSource { constructor(events: InputEvent[]); done: boolean; reset(): void }`
- Produces: `const EMPTY_INPUT: InputState`

- [ ] **Step 1: Write the failing tests**

`tests/core/input.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ScriptedInput, KeyboardMouseInput } from '../../src/core/input';

function keyEvent(type: string, code: string): Event {
  const e = new Event(type);
  Object.assign(e, { code });
  return e;
}

function mouseEvent(type: string, props: Record<string, number>): Event {
  const e = new Event(type);
  Object.assign(e, props);
  return e;
}

describe('ScriptedInput', () => {
  it('applies events at their simulation time', () => {
    const s = new ScriptedInput([{ t: 0.5, down: ['KeyW'] }, { t: 1.0, up: ['KeyW'] }]);
    expect(s.sample(0.25).keys.has('KeyW')).toBe(false);
    const a = s.sample(0.5);
    expect(a.keys.has('KeyW')).toBe(true);
    expect(a.pressed.has('KeyW')).toBe(true);
    const b = s.sample(0.75);
    expect(b.keys.has('KeyW')).toBe(true);
    expect(b.pressed.has('KeyW')).toBe(false);
    expect(s.sample(1.0).keys.has('KeyW')).toBe(false);
    expect(s.done).toBe(true);
  });

  it('delivers mouse deltas and wheel exactly once', () => {
    const s = new ScriptedInput([{ t: 0, mouse: [10, -4], wheel: 3 }]);
    const a = s.sample(0);
    expect([a.mouseDX, a.mouseDY, a.wheel]).toEqual([10, -4, 3]);
    const b = s.sample(0.1);
    expect([b.mouseDX, b.mouseDY, b.wheel]).toEqual([0, 0, 0]);
  });

  it('tracks mouse buttons with edges', () => {
    const s = new ScriptedInput([{ t: 0, buttonsDown: 1 }, { t: 0.2, buttonsUp: 1 }]);
    const a = s.sample(0);
    expect(a.buttons).toBe(1);
    expect(a.buttonsPressed).toBe(1);
    const b = s.sample(0.1);
    expect(b.buttons).toBe(1);
    expect(b.buttonsPressed).toBe(0);
    expect(s.sample(0.2).buttons).toBe(0);
  });

  it('replays identically after reset', () => {
    const s = new ScriptedInput([{ t: 0.1, down: ['ShiftLeft'] }]);
    const first = s.sample(0.2).pressed.has('ShiftLeft');
    s.reset();
    expect(s.sample(0.2).pressed.has('ShiftLeft')).toBe(first);
  });
});

describe('KeyboardMouseInput', () => {
  it('reports held keys and a single press edge despite key repeat', () => {
    const target = new EventTarget();
    const inp = new KeyboardMouseInput(target);
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    target.dispatchEvent(keyEvent('keydown', 'KeyW')); // auto-repeat
    const a = inp.sample();
    expect(a.keys.has('KeyW')).toBe(true);
    expect(a.pressed.has('KeyW')).toBe(true);
    expect(inp.sample().pressed.has('KeyW')).toBe(false);
    target.dispatchEvent(keyEvent('keyup', 'KeyW'));
    expect(inp.sample().keys.has('KeyW')).toBe(false);
    inp.dispose();
  });

  it('accumulates mouse movement only while pointer-locked', () => {
    const target = new EventTarget();
    let locked = false;
    const inp = new KeyboardMouseInput(target, () => locked);
    target.dispatchEvent(mouseEvent('mousemove', { movementX: 5, movementY: 2 }));
    expect(inp.sample().mouseDX).toBe(0);
    locked = true;
    target.dispatchEvent(mouseEvent('mousemove', { movementX: 5, movementY: 2 }));
    target.dispatchEvent(mouseEvent('mousemove', { movementX: 1, movementY: 1 }));
    const s = inp.sample();
    expect([s.mouseDX, s.mouseDY]).toEqual([6, 3]);
  });

  it('clears held keys and buttons when the window loses focus', () => {
    const target = new EventTarget();
    const inp = new KeyboardMouseInput(target);
    target.dispatchEvent(keyEvent('keydown', 'KeyA'));
    target.dispatchEvent(mouseEvent('mousedown', { button: 0 }));
    target.dispatchEvent(new Event('blur'));
    const s = inp.sample();
    expect(s.keys.size).toBe(0);
    expect(s.buttons).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core/input.test.ts`
Expected: FAIL — cannot resolve `../../src/core/input`.

- [ ] **Step 3: Implement**

`src/core/input.ts`:
```ts
export interface InputState {
  /** KeyboardEvent.code values currently held. */
  readonly keys: ReadonlySet<string>;
  /** Codes that went down since the previous sample (edge-triggered). */
  readonly pressed: ReadonlySet<string>;
  /** Mouse movement accumulated since the previous sample (pixels). */
  readonly mouseDX: number;
  readonly mouseDY: number;
  /** Wheel delta accumulated since the previous sample. */
  readonly wheel: number;
  /** Buttons held (bit 0 = left, 1 = middle, 2 = right — MouseEvent.button order). */
  readonly buttons: number;
  /** Buttons that went down since the previous sample. */
  readonly buttonsPressed: number;
}

export interface InputSource {
  /** Called once per simulation step. */
  sample(simTime: number): InputState;
  dispose(): void;
}

export const EMPTY_INPUT: InputState = {
  keys: new Set<string>(),
  pressed: new Set<string>(),
  mouseDX: 0,
  mouseDY: 0,
  wheel: 0,
  buttons: 0,
  buttonsPressed: 0,
};

/** Keys whose browser default action must be suppressed while playing. */
const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Live keyboard + mouse. Mouse movement only counts while pointer-locked. */
export class KeyboardMouseInput implements InputSource {
  private readonly held = new Set<string>();
  private down = new Set<string>();
  private dx = 0;
  private dy = 0;
  private wheelAcc = 0;
  private btn = 0;
  private btnDown = 0;
  private readonly off: Array<() => void> = [];

  constructor(
    target: EventTarget,
    private readonly isLocked: () => boolean = () => true,
  ) {
    const on = (type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.off.push(() => target.removeEventListener(type, fn, opts));
    };
    on('keydown', (e) => {
      const code = (e as KeyboardEvent).code;
      if (PREVENT_DEFAULT.has(code)) e.preventDefault();
      if (!this.held.has(code)) this.down.add(code);
      this.held.add(code);
    });
    on('keyup', (e) => {
      this.held.delete((e as KeyboardEvent).code);
    });
    on('blur', () => {
      this.held.clear();
      this.btn = 0;
    });
    on('mousemove', (e) => {
      if (!this.isLocked()) return;
      const m = e as MouseEvent;
      this.dx += m.movementX ?? 0;
      this.dy += m.movementY ?? 0;
    });
    on('mousedown', (e) => {
      const bit = 1 << (e as MouseEvent).button;
      if (!(this.btn & bit)) this.btnDown |= bit;
      this.btn |= bit;
    });
    on('mouseup', (e) => {
      this.btn &= ~(1 << (e as MouseEvent).button);
    });
    on('wheel', (e) => {
      this.wheelAcc += (e as WheelEvent).deltaY;
    }, { passive: true });
  }

  sample(): InputState {
    const s: InputState = {
      keys: new Set(this.held),
      pressed: this.down,
      mouseDX: this.dx,
      mouseDY: this.dy,
      wheel: this.wheelAcc,
      buttons: this.btn,
      buttonsPressed: this.btnDown,
    };
    this.down = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheelAcc = 0;
    this.btnDown = 0;
    return s;
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }
}

export interface InputEvent {
  /** Simulation time (s) at which the event applies. */
  t: number;
  down?: string[];
  up?: string[];
  mouse?: [number, number];
  wheel?: number;
  buttonsDown?: number;
  buttonsUp?: number;
}

/** Deterministic input for the Motion Lab and tests: a timeline keyed by simulation time. */
export class ScriptedInput implements InputSource {
  private readonly events: InputEvent[];
  private next = 0;
  private readonly held = new Set<string>();
  private btn = 0;

  constructor(events: InputEvent[]) {
    this.events = [...events].sort((a, b) => a.t - b.t);
  }

  sample(simTime: number): InputState {
    const pressed = new Set<string>();
    let dx = 0;
    let dy = 0;
    let wheel = 0;
    let btnDown = 0;
    while (this.next < this.events.length && this.events[this.next].t <= simTime + 1e-9) {
      const e = this.events[this.next++];
      for (const k of e.down ?? []) {
        if (!this.held.has(k)) pressed.add(k);
        this.held.add(k);
      }
      for (const k of e.up ?? []) this.held.delete(k);
      if (e.mouse) {
        dx += e.mouse[0];
        dy += e.mouse[1];
      }
      wheel += e.wheel ?? 0;
      if (e.buttonsDown) {
        btnDown |= e.buttonsDown & ~this.btn;
        this.btn |= e.buttonsDown;
      }
      if (e.buttonsUp) this.btn &= ~e.buttonsUp;
    }
    return { keys: new Set(this.held), pressed, mouseDX: dx, mouseDY: dy, wheel, buttons: this.btn, buttonsPressed: btnDown };
  }

  get done(): boolean {
    return this.next >= this.events.length;
  }

  reset(): void {
    this.next = 0;
    this.held.clear();
    this.btn = 0;
  }

  dispose(): void {}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/core/input.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```powershell
git add src/core/input.ts tests/core/input.test.ts
git commit -m @'
feat(core): keyboard/mouse and scripted input sources

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 4: Debug registry and seeded RNG

**Files:**
- Create: `src/core/debug.ts`, `src/core/rng.ts`
- Test: `tests/core/debug.test.ts`, `tests/core/rng.test.ts`

**Interfaces:**
- Produces: `class DebugRegistry { register(namespace: string | null, api: Record<string, unknown>): void; expose(target: Record<string, unknown>, name = 'berk'): void; readonly api: Record<string, unknown> }`, `const debug: DebugRegistry`
- Produces: `function mulberry32(seed: number): () => number` (values in [0, 1))

- [ ] **Step 1: Write the failing tests**

`tests/core/debug.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DebugRegistry } from '../../src/core/debug';

describe('DebugRegistry', () => {
  it('registers root functions and namespaces, merging repeated namespaces', () => {
    const d = new DebugRegistry();
    d.register(null, { step: () => 'stepped' });
    d.register('cam', { preset: () => 1 });
    d.register('cam', { orbit: () => 2 });
    const api = d.api as { step: () => string; cam: { preset: () => number; orbit: () => number } };
    expect(api.step()).toBe('stepped');
    expect(api.cam.preset()).toBe(1);
    expect(api.cam.orbit()).toBe(2);
  });

  it('exposes the api object on a target under a name', () => {
    const d = new DebugRegistry();
    d.register(null, { ping: () => 'pong' });
    const target: Record<string, unknown> = {};
    d.expose(target, 'berk');
    expect((target.berk as { ping: () => string }).ping()).toBe('pong');
  });

  it('keeps the exposed object live for later registrations', () => {
    const d = new DebugRegistry();
    const target: Record<string, unknown> = {};
    d.expose(target);
    d.register('lab', { run: () => 'ok' });
    expect((target.berk as { lab: { run: () => string } }).lab.run()).toBe('ok');
  });
});
```

`tests/core/rng.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/core/rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays in [0, 1) with a sane mean', () => {
    const r = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core/debug.test.ts tests/core/rng.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/core/debug.ts`:
```ts
export type DebugApi = Record<string, unknown>;

/** Collects debug/tooling functions into one live object, exposed as `window.berk`. */
export class DebugRegistry {
  private readonly root: DebugApi = {};

  register(namespace: string | null, api: DebugApi): void {
    if (namespace === null) {
      Object.assign(this.root, api);
      return;
    }
    const existing = this.root[namespace];
    const ns = (typeof existing === 'object' && existing !== null ? existing : {}) as DebugApi;
    Object.assign(ns, api);
    this.root[namespace] = ns;
  }

  expose(target: Record<string, unknown>, name = 'berk'): void {
    target[name] = this.root;
  }

  get api(): DebugApi {
    return this.root;
  }
}

export const debug = new DebugRegistry();
```

`src/core/rng.ts`:
```ts
/** Small, fast, seedable PRNG (mulberry32). The same seed gives the same sequence on every machine. */
export function mulberry32(seed: number): () => number {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/core`
Expected: all core tests pass (15).

- [ ] **Step 5: Commit**

```powershell
git add src/core tests/core
git commit -m @'
feat(core): debug registry (window.berk) and seeded RNG

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 5: Quality presets and renderer factory

**Files:**
- Create: `src/render/quality.ts`, `src/render/renderer.ts`
- Test: `tests/render/quality.test.ts`

**Interfaces:**
- Produces: `type QualityName = 'high' | 'low'`; `interface QualityPreset { name; renderScale; maxPixelRatio; msaaSamples; ao; aoQuality: 'Performance'|'Low'|'Medium'|'High'|'Ultra'; aoHalfRes; shadowCascades; shadowMapSize; bloom; reflectionScale; grassDensity; lodDistanceScale }`; `PRESETS: Record<QualityName, QualityPreset>`; `choosePreset(gpuRenderer: string | null, query: string): QualityPreset`; `gpuRendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null`
- Produces: `createRenderer(container: HTMLElement, preset: QualityPreset): THREE.WebGLRenderer`

- [ ] **Step 1: Write the failing test**

`tests/render/quality.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { choosePreset, PRESETS } from '../../src/render/quality';

describe('choosePreset', () => {
  it('honours an explicit ?q= override', () => {
    expect(choosePreset('NVIDIA GeForce RTX 3080 Ti', '?q=low').name).toBe('low');
    expect(choosePreset('Intel(R) Iris(R) Xe Graphics', '?q=high').name).toBe('high');
  });

  it('picks low for integrated or software GPUs', () => {
    expect(choosePreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', '').name).toBe('low');
    expect(choosePreset('SwiftShader', '').name).toBe('low');
  });

  it('picks high for discrete GPUs and unknown renderers', () => {
    expect(choosePreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Ti Laptop GPU Direct3D11)', '').name).toBe('high');
    expect(choosePreset(null, '').name).toBe('high');
  });

  it('matches the spec §4.10 preset table', () => {
    expect(PRESETS.high).toMatchObject({ renderScale: 1, msaaSamples: 4, ao: true, shadowCascades: 4, shadowMapSize: 2048, reflectionScale: 0.5, grassDensity: 1, lodDistanceScale: 1 });
    expect(PRESETS.low).toMatchObject({ renderScale: 0.75, ao: false, shadowCascades: 2, shadowMapSize: 1024, reflectionScale: 0.25, grassDensity: 0.3, lodDistanceScale: 0.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/render/quality.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/render/quality.ts`:
```ts
export type QualityName = 'high' | 'low';

export interface QualityPreset {
  name: QualityName;
  /** Multiplies the device pixel ratio. */
  renderScale: number;
  maxPixelRatio: number;
  /** 0 = MSAA off (SMAA is used instead). */
  msaaSamples: number;
  ao: boolean;
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  aoHalfRes: boolean;
  shadowCascades: number;
  shadowMapSize: number;
  bloom: boolean;
  /** Pond reflection render-target scale (used by the Cove). */
  reflectionScale: number;
  /** 0..1 grass instance density (used by the Cove). */
  grassDensity: number;
  /** Multiplies LOD switch distances (used by the Cove). */
  lodDistanceScale: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  high: {
    name: 'high', renderScale: 1, maxPixelRatio: 2, msaaSamples: 4, ao: true, aoQuality: 'High', aoHalfRes: false,
    shadowCascades: 4, shadowMapSize: 2048, bloom: true, reflectionScale: 0.5, grassDensity: 1, lodDistanceScale: 1,
  },
  low: {
    name: 'low', renderScale: 0.75, maxPixelRatio: 1, msaaSamples: 0, ao: false, aoQuality: 'Performance', aoHalfRes: true,
    shadowCascades: 2, shadowMapSize: 1024, bloom: true, reflectionScale: 0.25, grassDensity: 0.3, lodDistanceScale: 0.5,
  },
};

const INTEGRATED = /intel|microsoft basic|swiftshader|llvmpipe/i;

export function choosePreset(gpuRenderer: string | null, query: string): QualityPreset {
  const q = new URLSearchParams(query).get('q');
  if (q === 'high' || q === 'low') return PRESETS[q];
  if (gpuRenderer && INTEGRATED.test(gpuRenderer)) return PRESETS.low;
  return PRESETS.high;
}

export function gpuRendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
}
```

`src/render/renderer.ts`:
```ts
import * as THREE from 'three';
import type { QualityPreset } from './quality';

export function createRenderer(container: HTMLElement, preset: QualityPreset): THREE.WebGLRenderer {
  // MSAA happens in the post stack's render targets, not the default framebuffer.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio) * preset.renderScale);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping; // applied by OutputPass
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  // Lesson from the old game: repeated navigations exhausted WebGL contexts. Release ours on leave.
  addEventListener('pagehide', () => {
    renderer.dispose();
    renderer.forceContextLoss();
  });
  return renderer;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/render/quality.test.ts`
Expected: 4 passed.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```powershell
git add src/render tests/render
git commit -m @'
feat(render): quality presets and renderer factory

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 6: Colour grade LUT and post stack

**Files:**
- Create: `src/render/grade.ts`, `src/render/post.ts`
- Test: `tests/render/grade.test.ts`

**Interfaces:**
- Consumes: `QualityPreset` (Task 5).
- Produces: `interface GradeParams { saturation; contrast; shadowTint: [n,n,n]; highlightTint: [n,n,n]; warmth; vignette }`; `NEUTRAL_GRADE`, `FILM_GRADE`; `gradeColor(r, g, b, p): [number, number, number]`; `bakeLutData(p, size = 32): Uint8Array`; `bakeLut(p, size = 32): THREE.Data3DTexture`
- Produces: `interface PostStack { composer; ao: N8AOPass | null; bloom: UnrealBloomPass | null; grade: ShaderPass; setGrade(p: GradeParams): void; setSize(w: number, h: number): void; render(frameDt: number): void; dispose(): void }`; `createPostStack(renderer, scene, camera, preset, grade = FILM_GRADE): PostStack`

- [ ] **Step 1: Write the failing test**

`tests/render/grade.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { gradeColor, bakeLutData, NEUTRAL_GRADE, FILM_GRADE } from '../../src/render/grade';

describe('gradeColor', () => {
  it('is the identity for the neutral grade', () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.3]] as const) {
      const [r, g, b] = gradeColor(c[0], c[1], c[2], NEUTRAL_GRADE);
      expect(r).toBeCloseTo(c[0], 6);
      expect(g).toBeCloseTo(c[1], 6);
      expect(b).toBeCloseTo(c[2], 6);
    }
  });

  it('desaturates to grey at saturation 0', () => {
    const [r, g, b] = gradeColor(0.8, 0.2, 0.1, { ...NEUTRAL_GRADE, saturation: 0 });
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
  });

  it('film grade warms highlights and cools shadows', () => {
    const hi = gradeColor(0.9, 0.9, 0.9, FILM_GRADE);
    const lo = gradeColor(0.1, 0.1, 0.1, FILM_GRADE);
    expect(hi[0]).toBeGreaterThan(hi[2]);
    expect(lo[2]).toBeGreaterThan(lo[0]);
  });

  it('stays within 0..1', () => {
    const out = gradeColor(1, 1, 0, { ...FILM_GRADE, saturation: 3, contrast: 2 });
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('bakeLutData', () => {
  it('bakes an identity cube for the neutral grade (red fastest, then green, then blue)', () => {
    const size = 8;
    const data = bakeLutData(NEUTRAL_GRADE, size);
    expect(data.length).toBe(size * size * size * 4);
    const at = (r: number, g: number, b: number) => {
      const i = ((b * size + g) * size + r) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    expect(at(0, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(7, 7, 7)).toEqual([255, 255, 255, 255]);
    expect(at(7, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(0, 0, 7)).toEqual([0, 0, 255, 255]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/render/grade.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the grade maths**

`src/render/grade.ts`:
```ts
import * as THREE from 'three';

export interface GradeParams {
  /** 1 = unchanged. */
  saturation: number;
  /** 1 = unchanged; pivots around mid grey (display space). */
  contrast: number;
  /** Display-space RGB offsets added to shadows. */
  shadowTint: [number, number, number];
  /** Display-space RGB offsets added to highlights. */
  highlightTint: [number, number, number];
  /** Extra warm push in highlights (red up, blue down). */
  warmth: number;
  /** 0..1 corner darkening. */
  vignette: number;
}

export const NEUTRAL_GRADE: GradeParams = {
  saturation: 1, contrast: 1, shadowTint: [0, 0, 0], highlightTint: [0, 0, 0], warmth: 0, vignette: 0,
};

/** Starting film look (HTTYD 2/3 golden hour): gentle contrast, richer colour, cool shadows, warm highlights. */
export const FILM_GRADE: GradeParams = {
  saturation: 1.12, contrast: 1.05, shadowTint: [-0.012, 0.0, 0.02], highlightTint: [0.018, 0.008, -0.01], warmth: 0.015, vignette: 0.16,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** The grade as a pure display-space colour transform (baked into the LUT; also used by tests). */
export function gradeColor(r: number, g: number, b: number, p: GradeParams): [number, number, number] {
  let R = (r - 0.5) * p.contrast + 0.5;
  let G = (g - 0.5) * p.contrast + 0.5;
  let B = (b - 0.5) * p.contrast + 0.5;
  const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  R = l + (R - l) * p.saturation;
  G = l + (G - l) * p.saturation;
  B = l + (B - l) * p.saturation;
  const ws = 1 - smoothstep(0.0, 0.55, l);
  const wh = smoothstep(0.45, 1.0, l);
  R += p.shadowTint[0] * ws + (p.highlightTint[0] + p.warmth) * wh;
  G += p.shadowTint[1] * ws + p.highlightTint[1] * wh;
  B += p.shadowTint[2] * ws + (p.highlightTint[2] - p.warmth) * wh;
  return [clamp01(R), clamp01(G), clamp01(B)];
}

/** RGBA8 3D LUT data: red fastest, then green, then blue (Data3DTexture layout). */
export function bakeLutData(p: GradeParams, size = 32): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    for (let gy = 0; gy < size; gy++) {
      for (let rx = 0; rx < size; rx++) {
        const [r, g, b] = gradeColor(rx / (size - 1), gy / (size - 1), bz / (size - 1), p);
        data[i++] = Math.round(r * 255);
        data[i++] = Math.round(g * 255);
        data[i++] = Math.round(b * 255);
        data[i++] = 255;
      }
    }
  }
  return data;
}

export function bakeLut(p: GradeParams, size = 32): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(bakeLutData(p, size), size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/render/grade.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Implement the post stack**

`src/render/post.ts`:
```ts
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import type { QualityPreset } from './quality';
import { bakeLut, FILM_GRADE, type GradeParams } from './grade';

const LUT_SIZE = 32;

/** Display-space grade: 3D LUT lookup + vignette. Runs after OutputPass (tone curve + sRGB). */
const GradeShader = {
  name: 'BerkGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tLut: { value: null as THREE.Data3DTexture | null },
    lutSize: { value: LUT_SIZE },
    vignette: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp sampler3D;
    uniform sampler2D tDiffuse;
    uniform sampler3D tLut;
    uniform float lutSize;
    uniform float vignette;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 uvw = clamp(c.rgb, 0.0, 1.0) * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
      vec3 graded = texture(tLut, uvw).rgb;
      vec2 d = vUv - 0.5;
      d.x *= aspect;
      float v = smoothstep(0.9, 0.3, length(d));
      graded *= mix(1.0 - vignette, 1.0, v);
      gl_FragColor = vec4(graded, c.a);
    }`,
};

export interface PostStack {
  readonly composer: EffectComposer;
  readonly ao: N8AOPass | null;
  readonly bloom: UnrealBloomPass | null;
  readonly grade: ShaderPass;
  setGrade(p: GradeParams): void;
  setSize(width: number, height: number): void;
  render(frameDt: number): void;
  dispose(): void;
}

export function createPostStack(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  preset: QualityPreset,
  grade: GradeParams = FILM_GRADE,
): PostStack {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const useMsaa = preset.msaaSamples > 0;
  // Linear HDR working buffers. MSAA lives on the beauty target when AO renders the scene.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: preset.ao ? 0 : preset.msaaSamples,
  });
  const composer = new EffectComposer(renderer, target);

  let ao: N8AOPass | null = null;
  if (preset.ao) {
    ao = new N8AOPass(scene, camera, size.x, size.y); // renders the scene itself (replaces RenderPass)
    ao.configuration.gammaCorrection = false; // OutputPass does tone mapping + sRGB
    ao.configuration.aoRadius = 1.5;
    ao.configuration.distanceFalloff = 1.0;
    ao.configuration.intensity = 2.2;
    ao.setQualityMode(preset.aoQuality);
    ao.configuration.halfRes = preset.aoHalfRes;
    if (useMsaa) {
      const beauty = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: preset.msaaSamples });
      beauty.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
      beauty.depthTexture.format = THREE.DepthFormat;
      ao.beautyRenderTarget = beauty;
    }
    composer.addPass(ao);
  } else {
    composer.addPass(new RenderPass(scene, camera));
  }

  let bloom: UnrealBloomPass | null = null;
  if (preset.bloom) {
    // Threshold 1.0 on linear HDR: only genuinely bright things (emissives, glints) glow.
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.55, 1.0);
    composer.addPass(bloom);
  }

  composer.addPass(new OutputPass());

  const gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.tLut.value = bakeLut(grade, LUT_SIZE);
  gradePass.uniforms.vignette.value = grade.vignette;
  gradePass.uniforms.aspect.value = size.x / size.y;
  composer.addPass(gradePass);

  if (!useMsaa) composer.addPass(new SMAAPass());

  return {
    composer,
    ao,
    bloom,
    grade: gradePass,
    setGrade(p) {
      (gradePass.uniforms.tLut.value as THREE.Data3DTexture).dispose();
      gradePass.uniforms.tLut.value = bakeLut(p, LUT_SIZE);
      gradePass.uniforms.vignette.value = p.vignette;
    },
    setSize(w, h) {
      composer.setSize(w, h);
      gradePass.uniforms.aspect.value = w / h;
    },
    render(frameDt) {
      composer.render(frameDt);
    },
    dispose() {
      composer.dispose();
    },
  };
}
```

- [ ] **Step 6: Typecheck and run all tests**

Run: `npm run typecheck`
Expected: exit 0.
Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add src/render tests/render
git commit -m @'
feat(render): film grade LUT and N8AO/bloom/output/grade post stack

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 7: Sun, material hooks, height fog, lighting rig, sky + IBL

**Files:**
- Create: `src/render/sun.ts`, `src/render/materials.ts`, `src/render/fog.ts`, `src/render/lighting.ts`, `src/render/sky.ts`
- Test: `tests/render/sun.test.ts`, `tests/render/materials.test.ts`, `tests/render/fog.test.ts`

**Interfaces:**
- Consumes: `QualityPreset` (Task 5).
- Produces: `sunDirection(azimuthDeg: number, elevationDeg: number, out = new THREE.Vector3()): THREE.Vector3` — unit vector from the scene toward the sun.
- Produces: `type ShaderParams = Parameters<THREE.Material['onBeforeCompile']>[0]`; `addCompileHook(material: THREE.Material, key: string, hook: (shader: ShaderParams, renderer: THREE.WebGLRenderer) => void): void`; `interface MaterialPipeline { prepare(m: THREE.Material): void; prepareTree(root: THREE.Object3D): void }`; `createMaterialPipeline(steps: Array<(m: THREE.Material) => void>): MaterialPipeline`
- Produces: `interface FogParams { color: THREE.Color; sunColor: THREE.Color; density; heightFalloff; baseHeight; inscatterExponent; maxOpacity }`; `GOLDEN_FOG`; `fogUniforms`; `setFogParams(p: FogParams, sunDir: THREE.Vector3): void`; `berkFogFactor(p: FogParams, cam: THREE.Vector3, point: THREE.Vector3): number`; `installFogChunks(): void`; `applyBerkFog(m: THREE.Material): void`
- Produces: `interface LightingParams { azimuth; elevation; sunColor; sunIntensity; skyColor; groundColor; hemiIntensity }`; `GOLDEN_HOUR`; `class LightingRig { csm: CSM; hemi: THREE.HemisphereLight; sunDir: THREE.Vector3; params: LightingParams; setupMaterial(m): void; setSun(azimuth, elevation): void; update(): void; onResize(): void; dispose(): void }`
- Produces: `interface SkyParams { turbidity; rayleigh; mieCoefficient; mieDirectionalG; cloudCoverage; cloudDensity; cloudElevation; exposure }`; `GOLDEN_SKY`; `class SkySystem { sky: Sky; constructor(renderer, scene, params = GOLDEN_SKY); setSun(dir): void; setParams(p: Partial<SkyParams>): void; bakeEnvironment(intensity = 1): void; update(time: number): void; dispose(): void }`

- [ ] **Step 1: Write the failing tests**

`tests/render/sun.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sunDirection } from '../../src/render/sun';

describe('sunDirection', () => {
  it('points north (−Z) at azimuth 0 on the horizon', () => {
    const d = sunDirection(0, 0);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(-1, 6);
  });

  it('points east (+X) at azimuth 90', () => {
    const d = sunDirection(90, 0);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('points straight up at elevation 90 and is unit length', () => {
    expect(sunDirection(123, 90).y).toBeCloseTo(1, 6);
    expect(sunDirection(292, 14).length()).toBeCloseTo(1, 6);
  });

  it('places the golden-hour sun low in the west-northwest', () => {
    const d = sunDirection(292, 14);
    expect(d.x).toBeLessThan(-0.8);
    expect(d.y).toBeGreaterThan(0.2);
    expect(d.z).toBeLessThan(0);
  });
});
```

`tests/render/materials.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { addCompileHook, createMaterialPipeline, type ShaderParams } from '../../src/render/materials';

const fakeShader = () => ({ uniforms: {} }) as unknown as ShaderParams;
const fakeRenderer = {} as THREE.WebGLRenderer;

describe('addCompileHook', () => {
  it('runs hooks in registration order after a pre-existing onBeforeCompile', () => {
    const m = new THREE.MeshStandardMaterial();
    const calls: string[] = [];
    m.onBeforeCompile = () => { calls.push('original'); };
    addCompileHook(m, 'a', () => { calls.push('a'); });
    addCompileHook(m, 'b', () => { calls.push('b'); });
    m.onBeforeCompile(fakeShader(), fakeRenderer);
    expect(calls).toEqual(['original', 'a', 'b']);
  });

  it('includes hook keys in the program cache key', () => {
    const m = new THREE.MeshStandardMaterial();
    addCompileHook(m, 'fog', () => {});
    addCompileHook(m, 'wind', () => {});
    expect(m.customProgramCacheKey()).toContain('fog');
    expect(m.customProgramCacheKey()).toContain('wind');
  });

  it('does not add the same hook key twice', () => {
    const m = new THREE.MeshStandardMaterial();
    let n = 0;
    addCompileHook(m, 'x', () => { n++; });
    addCompileHook(m, 'x', () => { n++; });
    m.onBeforeCompile(fakeShader(), fakeRenderer);
    expect(n).toBe(1);
  });
});

describe('createMaterialPipeline', () => {
  it('prepares each material once, including arrays and nested meshes', () => {
    const seen: THREE.Material[] = [];
    const pipe = createMaterialPipeline([(m) => { seen.push(m); }]);
    const shared = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    const child = new THREE.Mesh(new THREE.BoxGeometry(), [shared, new THREE.MeshBasicMaterial()]);
    root.add(child);
    pipe.prepareTree(root);
    pipe.prepare(shared);
    expect(seen.length).toBe(2);
  });
});
```

`tests/render/fog.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { berkFogFactor, GOLDEN_FOG, applyBerkFog, fogUniforms } from '../../src/render/fog';
import type { ShaderParams } from '../../src/render/materials';

describe('berkFogFactor', () => {
  const cam = new THREE.Vector3(0, 2, 0);

  it('is zero at zero distance and grows with distance', () => {
    expect(berkFogFactor(GOLDEN_FOG, cam, cam.clone())).toBeCloseTo(0, 9);
    const near = berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 2, -50));
    const far = berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 2, -500));
    expect(far).toBeGreaterThan(near);
  });

  it('is thinner looking up than looking along the ground at equal distance', () => {
    const level = berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 2, -300));
    const up = berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 302, 0));
    expect(up).toBeLessThan(level);
  });

  it('never exceeds maxOpacity', () => {
    expect(berkFogFactor(GOLDEN_FOG, cam, new THREE.Vector3(0, 0, -100000))).toBeLessThanOrEqual(GOLDEN_FOG.maxOpacity + 1e-9);
  });

  it('matches the closed form for a level ray', () => {
    const p = { ...GOLDEN_FOG, maxOpacity: 1 };
    const f = berkFogFactor(p, cam, new THREE.Vector3(0, 2, -100));
    const expected = 1 - Math.exp(-p.density * Math.exp(-p.heightFalloff * (2 - p.baseHeight)) * 100);
    expect(f).toBeCloseTo(expected, 9);
  });
});

describe('applyBerkFog', () => {
  it('defines BERK_FOG and injects the shared uniform objects', () => {
    const m = new THREE.MeshStandardMaterial();
    applyBerkFog(m);
    expect((m as unknown as { defines: Record<string, unknown> }).defines.BERK_FOG).toBe('');
    const shader = { uniforms: {} } as unknown as ShaderParams;
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.berkFogDensity).toBe(fogUniforms.berkFogDensity);
  });

  it('skips materials with fog disabled', () => {
    const m = new THREE.MeshBasicMaterial({ fog: false });
    applyBerkFog(m);
    expect((m as unknown as { defines?: Record<string, unknown> }).defines?.BERK_FOG).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/render`
Expected: FAIL — `sun`, `materials`, `fog` modules not found.

- [ ] **Step 3: Implement sun, materials and fog**

`src/render/sun.ts`:
```ts
import * as THREE from 'three';

/**
 * Unit vector from the scene toward the sun.
 * Azimuth: 0 = north (−Z), 90 = east (+X). Elevation: 0 = horizon, 90 = zenith.
 */
export function sunDirection(azimuthDeg: number, elevationDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}
```

`src/render/materials.ts`:
```ts
import * as THREE from 'three';

export type ShaderParams = Parameters<THREE.Material['onBeforeCompile']>[0];
type CompileHook = (shader: ShaderParams, renderer: THREE.WebGLRenderer) => void;

interface HookState {
  keys: string[];
  hooks: CompileHook[];
  base: THREE.Material['onBeforeCompile'] | null;
  baseKey: () => string;
}

const STATE = new WeakMap<THREE.Material, HookState>();

/**
 * Compose shader patches on one material. three.js has a single onBeforeCompile slot and CSM, fog,
 * wind, etc. all need it — every patch in this project goes through here, never direct assignment.
 * A pre-existing onBeforeCompile (e.g. from CSM.setupMaterial) runs first.
 */
export function addCompileHook(material: THREE.Material, key: string, hook: CompileHook): void {
  let st = STATE.get(material);
  if (!st) {
    const base = material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile ? null : material.onBeforeCompile;
    const s: HookState = { keys: [], hooks: [], base, baseKey: material.customProgramCacheKey.bind(material) };
    STATE.set(material, s);
    material.onBeforeCompile = (shader, renderer) => {
      s.base?.call(material, shader, renderer);
      for (const h of s.hooks) h(shader, renderer);
    };
    material.customProgramCacheKey = () => `${s.baseKey()}|${s.keys.join(',')}`;
    st = s;
  }
  if (st.keys.includes(key)) return;
  st.keys.push(key);
  st.hooks.push(hook);
  material.needsUpdate = true;
}

export interface MaterialPipeline {
  prepare(material: THREE.Material): void;
  prepareTree(root: THREE.Object3D): void;
}

/** Runs each step once per material (order matters: CSM setup must precede compile hooks). */
export function createMaterialPipeline(steps: Array<(m: THREE.Material) => void>): MaterialPipeline {
  const done = new WeakSet<THREE.Material>();
  const prepare = (m: THREE.Material) => {
    if (done.has(m)) return;
    done.add(m);
    for (const step of steps) step(m);
  };
  return {
    prepare,
    prepareTree(root) {
      root.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) prepare(m);
      });
    },
  };
}
```

`src/render/fog.ts`:
```ts
import * as THREE from 'three';
import { addCompileHook } from './materials';

export interface FogParams {
  /** Haze colour away from the sun (linear). */
  color: THREE.Color;
  /** In-scattered colour toward the sun (linear). */
  sunColor: THREE.Color;
  /** Extinction per metre at baseHeight. */
  density: number;
  /** Per metre; larger = fog hugs the ground. */
  heightFalloff: number;
  baseHeight: number;
  inscatterExponent: number;
  /** 0..1 cap so distant geometry never fully vanishes. */
  maxOpacity: number;
}

export const GOLDEN_FOG: FogParams = {
  color: new THREE.Color(0.62, 0.7, 0.8),
  sunColor: new THREE.Color(1.0, 0.78, 0.52),
  density: 0.0035,
  heightFalloff: 0.035,
  baseHeight: 0,
  inscatterExponent: 6,
  maxOpacity: 0.92,
};

/** Shared uniforms — every fogged material references these same objects. */
export const fogUniforms = {
  berkFogColor: { value: new THREE.Color() },
  berkFogSunColor: { value: new THREE.Color() },
  berkFogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  berkFogDensity: { value: 0 },
  berkFogHeightFalloff: { value: 0 },
  berkFogBaseHeight: { value: 0 },
  berkFogInscatterExp: { value: 1 },
  berkFogMaxOpacity: { value: 1 },
};

export function setFogParams(p: FogParams, sunDir: THREE.Vector3): void {
  fogUniforms.berkFogColor.value.copy(p.color);
  fogUniforms.berkFogSunColor.value.copy(p.sunColor);
  fogUniforms.berkFogSunDir.value.copy(sunDir).normalize();
  fogUniforms.berkFogDensity.value = p.density;
  fogUniforms.berkFogHeightFalloff.value = p.heightFalloff;
  fogUniforms.berkFogBaseHeight.value = p.baseHeight;
  fogUniforms.berkFogInscatterExp.value = p.inscatterExponent;
  fogUniforms.berkFogMaxOpacity.value = p.maxOpacity;
}

/** CPU reference of the shader maths (tests + tools): exponential height fog integrated along the view ray. */
export function berkFogFactor(p: FogParams, cam: THREE.Vector3, point: THREE.Vector3): number {
  const dx = point.x - cam.x;
  const dy = point.y - cam.y;
  const dz = point.z - cam.z;
  const dist = Math.hypot(dx, dy, dz);
  const k = Math.max(-20, Math.min(20, p.heightFalloff * dy));
  const line = Math.abs(k) > 1e-4 ? (1 - Math.exp(-k)) / k : 1;
  const optical = p.density * Math.exp(-p.heightFalloff * (cam.y - p.baseHeight)) * dist * line;
  return Math.min(1 - Math.exp(-optical), p.maxOpacity);
}

let installed = false;

/** Adds a BERK_FOG branch to three's fog chunks. Materials without the define are untouched. */
export function installFogChunks(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex += `
#ifdef BERK_FOG
  varying vec3 vBerkWorldPos;
#endif
`;
  C.fog_vertex += `
#ifdef BERK_FOG
  {
    vec4 berkWP = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      berkWP = batchingMatrix * berkWP;
    #endif
    #ifdef USE_INSTANCING
      berkWP = instanceMatrix * berkWP;
    #endif
    vBerkWorldPos = (modelMatrix * berkWP).xyz;
  }
#endif
`;
  C.fog_pars_fragment += `
#ifdef BERK_FOG
  varying vec3 vBerkWorldPos;
  uniform vec3 berkFogColor;
  uniform vec3 berkFogSunColor;
  uniform vec3 berkFogSunDir;
  uniform float berkFogDensity;
  uniform float berkFogHeightFalloff;
  uniform float berkFogBaseHeight;
  uniform float berkFogInscatterExp;
  uniform float berkFogMaxOpacity;
#endif
`;
  C.fog_fragment = `
#ifdef BERK_FOG
  {
    vec3 berkRay = vBerkWorldPos - cameraPosition;
    float berkDist = length(berkRay);
    float berkK = clamp(berkFogHeightFalloff * berkRay.y, -20.0, 20.0);
    float berkLine = abs(berkK) > 1e-4 ? (1.0 - exp(-berkK)) / berkK : 1.0;
    float berkOptical = berkFogDensity * exp(-berkFogHeightFalloff * (cameraPosition.y - berkFogBaseHeight)) * berkDist * berkLine;
    float berkF = min(1.0 - exp(-berkOptical), berkFogMaxOpacity);
    float berkSun = pow(max(dot(berkRay / max(berkDist, 1e-4), berkFogSunDir), 0.0), berkFogInscatterExp);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(berkFogColor, berkFogSunColor, berkSun), berkF);
  }
#else
${C.fog_fragment}
#endif
`;
}

/** Opt a material into Berk fog (define + shared uniforms). Respects material.fog === false. */
export function applyBerkFog(material: THREE.Material): void {
  const m = material as THREE.Material & { fog?: boolean; defines?: Record<string, unknown> };
  if (m.fog === false) return;
  m.defines = { ...(m.defines ?? {}), BERK_FOG: '' };
  addCompileHook(material, 'berkfog', (shader) => {
    Object.assign(shader.uniforms, fogUniforms);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/render`
Expected: all render tests pass.

- [ ] **Step 5: Implement the lighting rig**

`src/render/lighting.ts`:
```ts
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import type { QualityPreset } from './quality';
import { sunDirection } from './sun';

export interface LightingParams {
  azimuth: number;
  elevation: number;
  sunColor: THREE.ColorRepresentation;
  sunIntensity: number;
  skyColor: THREE.ColorRepresentation;
  groundColor: THREE.ColorRepresentation;
  hemiIntensity: number;
}

/** Late-afternoon golden hour, sun low in the west-northwest (spec §7.8). Tuned by eye. */
export const GOLDEN_HOUR: LightingParams = {
  azimuth: 292, elevation: 14, sunColor: 0xffc890, sunIntensity: 3.0,
  skyColor: 0xa9c8f0, groundColor: 0x4d5a36, hemiIntensity: 0.25,
};

const isLit = (m: THREE.Material) =>
  (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true ||
  (m as THREE.MeshLambertMaterial).isMeshLambertMaterial === true ||
  (m as THREE.MeshPhongMaterial).isMeshPhongMaterial === true;

/** Sun with cascaded shadow maps (crisp near, stable far) + a hemisphere fill. */
export class LightingRig {
  readonly csm: CSM;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    preset: QualityPreset,
    public params: LightingParams = GOLDEN_HOUR,
  ) {
    sunDirection(params.azimuth, params.elevation, this.sunDir);
    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: preset.shadowCascades,
      maxFar: 250,
      mode: 'practical',
      shadowMapSize: preset.shadowMapSize,
      shadowBias: -0.00015,
      lightDirection: this.sunDir.clone().negate(),
      lightIntensity: params.sunIntensity,
      lightNear: 1,
      lightFar: 1200,
      lightMargin: 150,
    });
    this.csm.fade = true; // must be set before any setupMaterial call
    for (const l of this.csm.lights) {
      l.color.set(params.sunColor);
      l.shadow.normalBias = 0.03;
    }
    this.hemi = new THREE.HemisphereLight(params.skyColor, params.groundColor, params.hemiIntensity);
    scene.add(this.hemi);
  }

  setupMaterial(m: THREE.Material): void {
    if (isLit(m)) this.csm.setupMaterial(m);
  }

  setSun(azimuth: number, elevation: number): void {
    this.params = { ...this.params, azimuth, elevation };
    sunDirection(azimuth, elevation, this.sunDir);
    this.csm.lightDirection.copy(this.sunDir).negate();
  }

  update(): void {
    this.csm.update();
  }

  onResize(): void {
    this.csm.updateFrustums();
  }

  dispose(): void {
    this.csm.remove();
    this.csm.dispose();
    this.hemi.removeFromParent();
  }
}
```

- [ ] **Step 6: Implement the sky and environment**

`src/render/sky.ts`:
```ts
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
  cloudElevation: number;
  /** Scales the sky's radiance (the Preetham model is far brighter than our lights). */
  exposure: number;
}

export const GOLDEN_SKY: SkyParams = {
  turbidity: 3.5, rayleigh: 1.8, mieCoefficient: 0.004, mieDirectionalG: 0.8,
  cloudCoverage: 0.32, cloudDensity: 0.4, cloudElevation: 0.55, exposure: 0.5,
};

const OUT_ANCHOR = 'gl_FragColor = vec4( texColor, 1.0 );';
const UNIFORM_ANCHOR = 'uniform float time;';

function makeSky(p: SkyParams): Sky {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const mat = sky.material;
  mat.uniforms.skyExposure = { value: p.exposure };
  const before = mat.fragmentShader;
  mat.fragmentShader = before
    .replace(UNIFORM_ANCHOR, `${UNIFORM_ANCHOR}\nuniform float skyExposure;`)
    .replace(OUT_ANCHOR, 'gl_FragColor = vec4( texColor * skyExposure, 1.0 );');
  if (!mat.fragmentShader.includes('texColor * skyExposure') || !mat.fragmentShader.includes('uniform float skyExposure;')) {
    console.error('[sky] exposure patch anchor missing — sky exposure NOT applied');
  }
  applySkyParams(sky, p);
  return sky;
}

function applySkyParams(sky: Sky, p: SkyParams): void {
  const u = sky.material.uniforms;
  u.turbidity.value = p.turbidity;
  u.rayleigh.value = p.rayleigh;
  u.mieCoefficient.value = p.mieCoefficient;
  u.mieDirectionalG.value = p.mieDirectionalG;
  u.cloudCoverage.value = p.cloudCoverage;
  u.cloudDensity.value = p.cloudDensity;
  u.cloudElevation.value = p.cloudElevation;
  u.skyExposure.value = p.exposure;
}

/** Physically based sky with clouds; also bakes the scene's image-based light from itself. */
export class SkySystem {
  readonly sky: Sky;
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private params: SkyParams = GOLDEN_SKY,
  ) {
    this.sky = makeSky(params);
    scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  setSun(dir: THREE.Vector3): void {
    this.sky.material.uniforms.sunPosition.value.copy(dir);
  }

  setParams(p: Partial<SkyParams>): void {
    this.params = { ...this.params, ...p };
    applySkyParams(this.sky, this.params);
  }

  /** Re-bake the image-based light from the current sky. Call after the sun or sky params change. */
  bakeEnvironment(intensity = 1): void {
    const envScene = new THREE.Scene();
    const s = makeSky(this.params);
    s.material.uniforms.sunPosition.value.copy(this.sky.material.uniforms.sunPosition.value);
    s.material.uniforms.showSunDisc.value = 0; // the CSM light is the sun; the disc would swamp the ambient
    envScene.add(s);
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(envScene, 0, 0.1, 20000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = intensity;
    s.geometry.dispose();
    s.material.dispose();
  }

  update(time: number): void {
    this.sky.material.uniforms.time.value = time;
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
```

- [ ] **Step 7: Typecheck and run all tests**

Run: `npm run typecheck`
Expected: exit 0.
Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add src/render tests/render
git commit -m @'
feat(render): sun maths, composable material hooks, height fog, CSM lighting, sky + IBL

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 8: App bootstrap, perf tools, test scene and the game page

**Files:**
- Create: `src/app/createApp.ts`, `src/dev/perf.ts`, `src/world/testScene.ts`, `src/render/loaders.ts`
- Modify: `src/main.ts` (replace stub)
- Test: `tests/dev/perf.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: `interface App { renderer; scene; camera; preset; post: PostStack; lighting: LightingRig; sky: SkySystem; materials: MaterialPipeline; loop: GameLoop; add(root: THREE.Object3D): void; setSun(azimuth: number, elevation: number): void }`; `createApp(container: HTMLElement): App` — the app's main render runs at render priority 1000 (page camera updates use priority 0).
- Produces: `measureRenderCost(render: () => void, gl: { finish(): void }, frames = 30): { msPerFrame: number; frames: number }`; `rendererStats(r: THREE.WebGLRenderer): { calls; triangles; points; lines; geometries; textures; programs }`
- Produces: `createTestScene(): { root: THREE.Group; update(t: number): void }`
- Produces: `createGltfLoader(manager?: THREE.LoadingManager): GLTFLoader` (meshopt enabled)
- Produces debug API: `berk.step(n?, dt?)`, `berk.pause()`, `berk.play()`, `berk.quality()`, `berk.perf(frames?)`, `berk.sun(azimuth, elevation)`, `berk.exposure(v?)`, `berk.cam.preset(name)`

- [ ] **Step 1: Write the failing test**

`tests/dev/perf.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { measureRenderCost } from '../../src/dev/perf';

describe('measureRenderCost', () => {
  it('warms up once, then times the requested frames', () => {
    let renders = 0;
    let finishes = 0;
    const gl = { finish: () => { finishes++; } };
    const r = measureRenderCost(() => { renders++; }, gl, 10);
    expect(renders).toBe(11);
    expect(finishes).toBe(2);
    expect(r.frames).toBe(10);
    expect(r.msPerFrame).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dev/perf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement perf tools and loaders**

`src/dev/perf.ts`:
```ts
import type * as THREE from 'three';

export interface RenderCost {
  msPerFrame: number;
  frames: number;
}

/**
 * Wall-clock cost of `render` with the GPU pipeline drained (gl.finish) — independent of
 * requestAnimationFrame, so it works in throttled background tabs.
 */
export function measureRenderCost(render: () => void, gl: { finish(): void }, frames = 30): RenderCost {
  render();
  gl.finish();
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) render();
  gl.finish();
  return { msPerFrame: (performance.now() - t0) / frames, frames };
}

export interface RendererStats {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
}

export function rendererStats(r: THREE.WebGLRenderer): RendererStats {
  return {
    calls: r.info.render.calls,
    triangles: r.info.render.triangles,
    points: r.info.render.points,
    lines: r.info.render.lines,
    geometries: r.info.memory.geometries,
    textures: r.info.memory.textures,
    programs: r.info.programs?.length ?? 0,
  };
}
```

`src/render/loaders.ts`:
```ts
import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export function createGltfLoader(manager?: THREE.LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
```

- [ ] **Step 4: Implement the app bootstrap**

`src/app/createApp.ts`:
```ts
import * as THREE from 'three';
import { GameLoop } from '../core/loop';
import { debug } from '../core/debug';
import { choosePreset, gpuRendererName, type QualityPreset } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { createPostStack, type PostStack } from '../render/post';
import { LightingRig } from '../render/lighting';
import { SkySystem } from '../render/sky';
import { installFogChunks, applyBerkFog, setFogParams, GOLDEN_FOG } from '../render/fog';
import { createMaterialPipeline, type MaterialPipeline } from '../render/materials';
import { measureRenderCost, rendererStats } from '../dev/perf';

export interface App {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly preset: QualityPreset;
  readonly post: PostStack;
  readonly lighting: LightingRig;
  readonly sky: SkySystem;
  readonly materials: MaterialPipeline;
  readonly loop: GameLoop;
  /** Prepare every material under root (CSM + fog) and add it to the scene. */
  add(root: THREE.Object3D): void;
  /** Move the sun: lighting, sky, fog in-scatter and the baked environment follow. */
  setSun(azimuth: number, elevation: number): void;
}

export function createApp(container: HTMLElement): App {
  installFogChunks();
  // Probe the GPU name before choosing a preset (the real renderer is created with that preset).
  const probe = document.createElement('canvas').getContext('webgl2');
  const gpuName = probe ? gpuRendererName(probe) : null;
  probe?.getExtension('WEBGL_lose_context')?.loseContext();
  const preset = choosePreset(gpuName, location.search);

  const renderer = createRenderer(container, preset);
  renderer.info.autoReset = false; // several renders per frame (AO, bloom...) — reset once per frame
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 6000);

  const lighting = new LightingRig(scene, camera, preset);
  const sky = new SkySystem(renderer, scene);
  sky.setSun(lighting.sunDir);
  sky.bakeEnvironment(1.0);
  setFogParams(GOLDEN_FOG, lighting.sunDir);

  const materials = createMaterialPipeline([(m) => lighting.setupMaterial(m), applyBerkFog]);
  const post = createPostStack(renderer, scene, camera, preset);
  const loop = new GameLoop();

  loop.addRender(() => {
    renderer.info.reset();
    camera.updateMatrixWorld();
    lighting.update();
    sky.update(loop.simTime);
    post.render(0);
  }, 1000);

  addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    post.setSize(w, h);
    lighting.onResize();
  });

  const setSun = (azimuth: number, elevation: number) => {
    lighting.setSun(azimuth, elevation);
    sky.setSun(lighting.sunDir);
    sky.bakeEnvironment(scene.environmentIntensity);
    setFogParams(GOLDEN_FOG, lighting.sunDir);
  };

  debug.register(null, {
    step: (n = 1, dt?: number) => loop.step(n, dt),
    pause: () => loop.pause(),
    play: () => loop.resume(),
    quality: () => ({ preset: preset.name, gpu: gpuName }),
    sun: (azimuth: number, elevation: number) => setSun(azimuth, elevation),
    exposure: (v?: number) => {
      if (v !== undefined) renderer.toneMappingExposure = v;
      return renderer.toneMappingExposure;
    },
    perf: (frames = 30) => {
      renderer.info.reset();
      post.render(0);
      const stats = rendererStats(renderer);
      const cost = measureRenderCost(() => post.render(0), renderer.getContext(), frames);
      return { ...cost, fpsEquivalent: 1000 / cost.msPerFrame, ...stats, preset: preset.name, gpu: gpuName };
    },
  });
  debug.expose(window as unknown as Record<string, unknown>);

  return {
    renderer, scene, camera, preset, post, lighting, sky, materials, loop,
    add(root) {
      materials.prepareTree(root);
      scene.add(root);
    },
    setSun,
  };
}
```

- [ ] **Step 5: Implement the test scene**

`src/world/testScene.ts`:
```ts
import * as THREE from 'three';

export interface TestScene {
  root: THREE.Group;
  update(t: number): void;
}

/** M1 look-dev scene: material swatches, distant blocks for fog/cascades, a transparent sprite for AO. */
export function createTestScene(): TestScene {
  const root = new THREE.Group();
  root.name = 'TestScene';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x6f8f4a, roughness: 0.95 }),
  );
  ground.name = 'ground';
  ground.receiveShadow = true;
  root.add(ground);

  const swatches: Array<{ name: string; mat: THREE.Material; geo: THREE.BufferGeometry }> = [
    {
      name: 'dragonSkin',
      mat: new THREE.MeshPhysicalMaterial({
        color: 0x14161c, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.4,
        sheen: 0.6, sheenColor: new THREE.Color(0x3a4a66), sheenRoughness: 0.5,
      }),
      geo: new THREE.CapsuleGeometry(0.7, 2.2, 8, 24).rotateZ(Math.PI / 2),
    },
    { name: 'rock', mat: new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.9 }), geo: new THREE.IcosahedronGeometry(1.2, 3) },
    { name: 'wood', mat: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 }), geo: new THREE.BoxGeometry(1.6, 1.6, 1.6) },
    { name: 'mirror', mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1 }), geo: new THREE.SphereGeometry(1, 48, 32) },
    { name: 'emissive', mat: new THREE.MeshStandardMaterial({ color: 0x223311, emissive: 0x9cff44, emissiveIntensity: 4 }), geo: new THREE.SphereGeometry(0.5, 32, 16) },
  ];
  swatches.forEach((s, i) => {
    const m = new THREE.Mesh(s.geo, s.mat);
    m.name = s.name;
    m.position.set((i - 2) * 4, 1.4, 0);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  });

  const blockMat = new THREE.MeshStandardMaterial({ color: 0x7d8a6a, roughness: 0.9 });
  for (let i = 0; i < 24; i++) {
    const h = 6 + (i % 5) * 3;
    const b = new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), blockMat);
    b.position.set(((i % 6) - 2.5) * 18, h / 2, -30 - Math.floor(i / 6) * 45);
    b.castShadow = b.receiveShadow = true;
    root.add(b);
  }

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xb080ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.name = 'glowSprite';
  glow.position.set(0, 3.5, 2);
  glow.scale.setScalar(2.5);
  root.add(glow);

  return {
    root,
    update(t) {
      glow.material.rotation = t * 0.5;
    },
  };
}
```

- [ ] **Step 6: Wire the game page**

`src/main.ts`:
```ts
import './styles.css';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createApp } from './app/createApp';
import { createTestScene } from './world/testScene';
import { debug } from './core/debug';

const app = createApp(document.getElementById('app')!);
const test = createTestScene();
app.add(test.root);

app.camera.position.set(9, 4.5, 11);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
controls.target.set(0, 1.4, 0);
app.loop.addSim(() => test.update(app.loop.simTime));
app.loop.addRender(() => controls.update(), 0);

const CAMS: Record<string, [number, number, number, number, number, number]> = {
  hero: [4.5, 2.2, 5.5, 0, 1.4, 0],
  wide: [30, 14, 40, 0, 2, -40],
  low: [2, 0.6, 8, 0, 1.5, 0],
};
debug.register('cam', {
  preset(name: string) {
    const p = CAMS[name];
    if (!p) return Object.keys(CAMS);
    app.camera.position.set(p[0], p[1], p[2]);
    controls.target.set(p[3], p[4], p[5]);
    controls.update();
    return name;
  },
});

document.getElementById('hud')!.textContent = `Isle of Berk — foundation test scene · quality: ${app.preset.name}`;
app.loop.start();
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test`
Expected: all pass.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Visual verification in the browser**

Start the dev server in the background: `npm run dev` (port 5190).
In the chrome-devtools browser open `http://localhost:5190/?q=high`, wait ~5 s, then:
1. `list_console_messages` (types error, warn): no errors; warnings only if they are known three/n8ao informational messages (record any in the progress log).
2. `take_screenshot` with `berk.cam.preset('hero')`, `('wide')`, `('low')`.
3. Check each and fix until all hold:
   - Sky: blue gradient, low warm sun in the west-northwest, soft clouds; no hard seam at the horizon.
   - Shadows: crisp under the swatches, continuing to the far blocks; no acne stripes, no floating (peter-panning) at contact.
   - AO: soft contact darkening where swatches meet the ground; the purple sprite is NOT a dark box.
   - Fog: far blocks fade into haze that warms toward the sun and cools away from it.
   - Bloom: the emissive sphere glows; nothing else is hazy.
   - Exposure: the ground is mid-tone (not blown out, not muddy). Tune with `berk.exposure(v)` and, if needed, `GOLDEN_SKY.exposure`, `GOLDEN_FOG.density`, `GOLDEN_HOUR.sunIntensity` — commit tuned constants.
   - MSAA + N8AO: silhouette edges are smooth with no bright/dark halo lines. If edges show AO halos, set `PRESETS.high.msaaSamples = 0` (SMAA path) and note the decision in the progress log.
4. `evaluate_script` → `berk.perf(30)`; record msPerFrame, calls, triangles, preset and GPU in the progress log (Task 11).
5. Repeat step 1–2 at `?q=low`.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m @'
feat(app): shared bootstrap, perf tools and the lit foundation test scene

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 9: Motion Lab and Asset Viewer shells (+ film strips)

**Files:**
- Create: `src/dev/filmstrip.ts`, `src/dev/lab/course.ts`
- Modify: `src/dev/lab/main.ts`, `src/dev/viewer/main.ts` (replace stubs)
- Test: `tests/dev/filmstrip.test.ts`, `tests/dev/course.test.ts`

**Interfaces:**
- Consumes: `createApp` (Task 8), `mulberry32` (Task 4), `createGltfLoader` (Task 8), `debug`.
- Produces: `filmstripLayout(frames: number, columns: number, width: number, height: number, thumbWidth: number): { tw: number; th: number; rows: number; cols: number; cell(i: number): [number, number] }`; `captureFilmstrip(opts: { frames: number; stepsBetween: number; columns: number; thumbWidth: number }, advance: (steps: number) => void, render: () => void, source: HTMLCanvasElement): HTMLCanvasElement`; `showOverlay(canvas: HTMLCanvasElement): void`; `hideOverlay(): void`
- Produces: `interface Course { root: THREE.Group; surfaces: THREE.Mesh[] }`; `buildCourse(seed = 7): Course` — named surfaces: `floor`, `ramp15|30|45|60`, `plateau15|30|45|60`, `sideSlope`, `stepSmall0..5`, `stepLarge0..3`, `ledge1|2|2.5|3`, `boulder0..29`, `climbWall` (vertical 2.3 m face), `climbTop`, `steepWall` (75°, 6 m, no ledge), `cornerA`, `cornerB`, `pillar`.
- Produces debug API: `berk.lab.filmstrip(frames = 12, stepsBetween = 10, columns = 6)`, `berk.lab.closeOverlay()`, `berk.lab.surfaces()`; `berk.viewer.load(url)`, `berk.viewer.stats()`, `berk.viewer.turntable(on)`, `berk.viewer.clip(name)`, `berk.viewer.pose(t)`, `berk.viewer.morph(mesh, name, weight)`

- [ ] **Step 1: Write the failing tests**

`tests/dev/filmstrip.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { filmstripLayout } from '../../src/dev/filmstrip';

describe('filmstripLayout', () => {
  it('lays frames out row-major with the source aspect ratio', () => {
    const l = filmstripLayout(12, 6, 1920, 1080, 320);
    expect(l.tw).toBe(320);
    expect(l.th).toBe(180);
    expect(l.cols).toBe(6);
    expect(l.rows).toBe(2);
    expect(l.cell(0)).toEqual([0, 0]);
    expect(l.cell(5)).toEqual([1600, 0]);
    expect(l.cell(6)).toEqual([0, 180]);
  });

  it('uses fewer columns than requested when there are fewer frames', () => {
    const l = filmstripLayout(3, 6, 1000, 500, 200);
    expect(l.cols).toBe(3);
    expect(l.rows).toBe(1);
  });
});
```

`tests/dev/course.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCourse } from '../../src/dev/lab/course';

describe('buildCourse', () => {
  it('contains every named test surface', () => {
    const c = buildCourse();
    const names = new Set(c.surfaces.map((m) => m.name));
    for (const n of ['floor', 'ramp15', 'ramp30', 'ramp45', 'ramp60', 'sideSlope', 'stepSmall0', 'stepLarge3',
      'ledge1', 'ledge2', 'ledge2.5', 'ledge3', 'boulder0', 'climbWall', 'climbTop', 'steepWall', 'cornerA', 'cornerB', 'pillar']) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('tilts each ramp to its named angle', () => {
    const c = buildCourse();
    for (const a of [15, 30, 45, 60]) {
      const ramp = c.surfaces.find((m) => m.name === `ramp${a}`)!;
      ramp.updateMatrixWorld(true);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ramp.quaternion);
      expect(THREE.MathUtils.radToDeg(Math.acos(up.y))).toBeCloseTo(a, 5);
    }
  });

  it('gives each ledge its named height', () => {
    const c = buildCourse();
    for (const h of [1, 2, 2.5, 3]) {
      const ledge = c.surfaces.find((m) => m.name === `ledge${h}`)!;
      const box = new THREE.Box3().setFromObject(ledge);
      expect(box.max.y).toBeCloseTo(h, 5);
    }
  });

  it('is deterministic for a seed', () => {
    const a = buildCourse(7).surfaces.find((m) => m.name === 'boulder3')!.position.toArray();
    const b = buildCourse(7).surfaces.find((m) => m.name === 'boulder3')!.position.toArray();
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/dev`
Expected: FAIL — `filmstrip` and `course` modules not found.

- [ ] **Step 3: Implement film strips**

`src/dev/filmstrip.ts`:
```ts
export interface FilmstripLayout {
  tw: number;
  th: number;
  rows: number;
  cols: number;
  cell(i: number): [number, number];
}

export function filmstripLayout(frames: number, columns: number, width: number, height: number, thumbWidth: number): FilmstripLayout {
  const cols = Math.min(columns, frames);
  const tw = thumbWidth;
  const th = Math.round((thumbWidth * height) / width);
  const rows = Math.ceil(frames / cols);
  return { tw, th, rows, cols, cell: (i) => [(i % cols) * tw, Math.floor(i / cols) * th] };
}

export interface FilmstripOptions {
  frames: number;
  stepsBetween: number;
  columns: number;
  thumbWidth: number;
}

/**
 * Advance the simulation deterministically and grab a frame after each advance.
 * Each frame is copied right after render() in the same task, so no preserveDrawingBuffer is needed.
 */
export function captureFilmstrip(
  opts: FilmstripOptions,
  advance: (steps: number) => void,
  render: () => void,
  source: HTMLCanvasElement,
): HTMLCanvasElement {
  const l = filmstripLayout(opts.frames, opts.columns, source.width, source.height, opts.thumbWidth);
  const out = document.createElement('canvas');
  out.width = l.tw * l.cols;
  out.height = l.th * l.rows;
  const ctx = out.getContext('2d')!;
  ctx.font = '12px sans-serif';
  for (let i = 0; i < opts.frames; i++) {
    if (i > 0) advance(opts.stepsBetween);
    render();
    const [x, y] = l.cell(i);
    ctx.drawImage(source, x, y, l.tw, l.th);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, 26, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i), x + 4, y + 12);
  }
  return out;
}

export function showOverlay(canvas: HTMLCanvasElement): void {
  const overlay = document.getElementById('overlay')!;
  (overlay.querySelector('img') as HTMLImageElement).src = canvas.toDataURL('image/png');
  overlay.classList.add('show');
  overlay.onclick = hideOverlay;
}

export function hideOverlay(): void {
  document.getElementById('overlay')?.classList.remove('show');
}
```

- [ ] **Step 4: Implement the course**

`src/dev/lab/course.ts`:
```ts
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';

export interface Course {
  root: THREE.Group;
  surfaces: THREE.Mesh[];
}

const deg = THREE.MathUtils.degToRad;

/**
 * Static Motion Lab course (spec §8.2): flat pad, 15–60° ramps, side slope, steps, ledges,
 * boulder field, a vertical 2.3 m climb face with a plateau, a 75° wall, and inside/outside corners.
 * Layout (top view): ramps along −Z on the west side, steps + ledges east, boulders north-east,
 * climbing walls south, corners south-west. The pad centre (0, 0, 0) is clear for spawning.
 */
export function buildCourse(seed = 7): Course {
  const root = new THREE.Group();
  root.name = 'Course';
  const surfaces: THREE.Mesh[] = [];
  const mats = {
    floor: new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.95 }),
    ramp: new THREE.MeshStandardMaterial({ color: 0xa8a296, roughness: 0.9 }),
    step: new THREE.MeshStandardMaterial({ color: 0x9aa39a, roughness: 0.9 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.92 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x9c8f82, roughness: 0.92 }),
  };
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    root.add(mesh);
    surfaces.push(mesh);
    return mesh;
  };

  add('floor', new THREE.BoxGeometry(160, 1, 160), mats.floor, [0, -0.5, 0]);

  // Ramps rise toward −Z: rotating +a about X lifts the −Z end. Near edge sits on the floor.
  [15, 30, 45, 60].forEach((a, i) => {
    const len = 8;
    const thick = 0.4;
    const rise = Math.sin(deg(a)) * len;
    const run = Math.cos(deg(a)) * len;
    const x = -40 + i * 8;
    const z0 = -14; // near (bottom) edge
    add(`ramp${a}`, new THREE.BoxGeometry(5, thick, len), mats.ramp,
      [x, rise / 2 - (thick / 2) * Math.cos(deg(a)), z0 - run / 2], [deg(a), 0, 0]);
    add(`plateau${a}`, new THREE.BoxGeometry(5, rise, 6), mats.step, [x, rise / 2, z0 - run - 3]);
  });

  // 20° side slope (tilted about Z), for body-roll tests.
  add('sideSlope', new THREE.BoxGeometry(10, 0.4, 14), mats.ramp, [-20, 1.6, 18], [0, 0, deg(20)]);

  // Stairs: 6 × 0.25 m then 4 × 0.5 m risers, 1 m treads, rising toward +X.
  for (let i = 0; i < 6; i++) {
    const h = 0.25 * (i + 1);
    add(`stepSmall${i}`, new THREE.BoxGeometry(1, h, 5), mats.step, [14 + i, h / 2, -10]);
  }
  for (let i = 0; i < 4; i++) {
    const h = 0.5 * (i + 1);
    add(`stepLarge${i}`, new THREE.BoxGeometry(1.2, h, 5), mats.step, [14 + i * 1.2, h / 2, -2]);
  }

  // Ledges of 1 / 2 / 2.5 / 3 m (3 m is above the scramble limit → must block).
  [1, 2, 2.5, 3].forEach((h, i) => {
    add(`ledge${h}`, new THREE.BoxGeometry(6, h, 6), mats.wall, [16 + i * 8, h / 2, 8]);
  });

  // Boulder field: 30 displaced icosahedra, seeded.
  const rnd = mulberry32(seed);
  for (let i = 0; i < 30; i++) {
    const r = 0.4 + rnd() * 1.1;
    const geo = new THREE.IcosahedronGeometry(r, 2);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const k = 0.8 + rnd() * 0.35;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.7, pos.getZ(v) * k);
    }
    geo.computeVertexNormals();
    add(`boulder${i}`, geo, mats.rock, [28 + rnd() * 18, r * 0.25, 22 + rnd() * 16], [rnd(), rnd() * 6, rnd()]);
  }

  // Climbing: a vertical 2.3 m face with a plateau on top (scramble-up), and a 75° wall with no ledge.
  add('climbWall', new THREE.BoxGeometry(10, 2.3, 1), mats.wall, [0, 1.15, 30]);
  add('climbTop', new THREE.BoxGeometry(10, 2.3, 8), mats.step, [0, 1.15, 34.5]);
  add('steepWall', new THREE.BoxGeometry(10, 0.6, 6.2), mats.wall, [14, 2.9, 30], [deg(-75), 0, 0]);

  // Corners: an L of two walls (inside corner) and a free-standing pillar (outside corners).
  add('cornerA', new THREE.BoxGeometry(8, 3, 0.8), mats.wall, [-30, 1.5, 30]);
  add('cornerB', new THREE.BoxGeometry(0.8, 3, 8), mats.wall, [-33.6, 1.5, 26.4]);
  add('pillar', new THREE.BoxGeometry(3, 3, 3), mats.wall, [-18, 1.5, 34]);

  return { root, surfaces };
}
```
(Ramp check for the test: the ramp's local +Y rotated by `deg(a)` about X has `up.y = cos(a)`, so `acos(up.y) = a`. Ledge boxes of height `h` centred at `h/2` have `max.y = h`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/dev`
Expected: all dev tests pass.

- [ ] **Step 6: Implement the Motion Lab page**

`src/dev/lab/main.ts`:
```ts
import '../../styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createApp } from '../../app/createApp';
import { buildCourse } from './course';
import { captureFilmstrip, showOverlay, hideOverlay } from '../filmstrip';
import { debug } from '../../core/debug';

const app = createApp(document.getElementById('app')!);
const course = buildCourse();
app.add(course.root);

const grid = new THREE.GridHelper(160, 160, 0x445566, 0x2b3440);
grid.position.y = 0.01;
app.scene.add(grid);

app.camera.position.set(0, 18, 38);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
controls.target.set(0, 0, 0);
app.loop.addRender(() => controls.update(), 0);

const renderOnce = () => app.post.render(0);
const gui = new GUI({ title: 'Motion Lab' });
const loopUi = {
  pause: () => app.loop.pause(),
  play: () => app.loop.resume(),
  step1: () => app.loop.step(1),
  step10: () => app.loop.step(10),
};
const fl = gui.addFolder('Loop');
fl.add(loopUi, 'pause');
fl.add(loopUi, 'play');
fl.add(loopUi, 'step1').name('step 1');
fl.add(loopUi, 'step10').name('step 10');

const sunUi = { azimuth: app.lighting.params.azimuth, elevation: app.lighting.params.elevation };
const fs = gui.addFolder('Sun');
fs.add(sunUi, 'azimuth', 0, 360, 1).onFinishChange(() => app.setSun(sunUi.azimuth, sunUi.elevation));
fs.add(sunUi, 'elevation', 1, 89, 0.5).onFinishChange(() => app.setSun(sunUi.azimuth, sunUi.elevation));

const postUi = { exposure: app.renderer.toneMappingExposure, grid: true };
const fp = gui.addFolder('View');
fp.add(postUi, 'exposure', 0.2, 3, 0.01).onChange((v: number) => { app.renderer.toneMappingExposure = v; });
fp.add(postUi, 'grid').onChange((v: boolean) => { grid.visible = v; });

debug.register('lab', {
  filmstrip(frames = 12, stepsBetween = 10, columns = 6) {
    const wasPaused = app.loop.isPaused;
    app.loop.pause();
    const strip = captureFilmstrip(
      { frames, stepsBetween, columns, thumbWidth: 320 },
      (n) => app.loop.step(n),
      renderOnce,
      app.renderer.domElement,
    );
    showOverlay(strip);
    if (!wasPaused) app.loop.resume();
    return { width: strip.width, height: strip.height };
  },
  closeOverlay: hideOverlay,
  surfaces: () => course.surfaces.map((m) => m.name),
});

document.getElementById('hud')!.textContent = `Motion Lab · quality: ${app.preset.name}`;
app.loop.start();
```

- [ ] **Step 7: Implement the Asset Viewer page**

`src/dev/viewer/main.ts`:
```ts
import '../../styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createApp } from '../../app/createApp';
import { createGltfLoader } from '../../render/loaders';
import { createTestScene } from '../../world/testScene';
import { debug } from '../../core/debug';

const app = createApp(document.getElementById('app')!);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
app.camera.position.set(6, 3, 8);
controls.target.set(0, 1, 0);
app.loop.addRender(() => controls.update(), 0);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(40, 96).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x7a7f86, roughness: 0.9 }),
);
floor.receiveShadow = true;
app.add(floor);

const loader = createGltfLoader();
const state = { turntable: false, wireframe: false, skeleton: false, playing: false, clip: '', time: 0 };
let current: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let clips: THREE.AnimationClip[] = [];
let action: THREE.AnimationAction | null = null;
let helper: THREE.SkeletonHelper | null = null;
const gui = new GUI({ title: 'Asset Viewer' });
let morphFolder: GUI | null = null;
let clipFolder: GUI | null = null;

function frameObject(obj: THREE.Object3D): void {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  box.setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z);
  controls.target.copy(center);
  app.camera.position.set(center.x + r * 1.1, center.y + r * 0.45, center.z + r * 1.3);
}

function stats() {
  let tris = 0;
  let bones = 0;
  const morphs: string[] = [];
  const materials = new Set<string>();
  current?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const name of Object.keys(m.morphTargetDictionary ?? {})) morphs.push(`${m.name}:${name}`);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat.name || mat.type);
    }
    if ((o as THREE.Bone).isBone) bones++;
  });
  return { tris, bones, morphs, clips: clips.map((c) => c.name), materials: [...materials] };
}

function buildMorphUi(): void {
  morphFolder?.destroy();
  morphFolder = gui.addFolder('Morph targets');
  current?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.morphTargetDictionary || !m.morphTargetInfluences) return;
    for (const [name, i] of Object.entries(m.morphTargetDictionary)) {
      morphFolder!.add(m.morphTargetInfluences, String(i), 0, 1, 0.01).name(`${m.name}:${name}`);
    }
  });
}

function playClip(name: string): void {
  if (!mixer) return;
  const clip = clips.find((c) => c.name === name);
  if (!clip) return;
  mixer.stopAllAction();
  action = mixer.clipAction(clip);
  action.play();
  state.clip = name;
  state.playing = true;
}

function buildClipUi(): void {
  clipFolder?.destroy();
  clipFolder = gui.addFolder('Clips');
  if (!clips.length) return;
  const names = clips.map((c) => c.name);
  state.clip = names[0];
  clipFolder.add(state, 'clip', names).onChange(playClip);
  clipFolder.add(state, 'playing');
  clipFolder.add(state, 'time', 0, Math.max(...clips.map((c) => c.duration)), 0.001).onChange((t: number) => {
    state.playing = false;
    if (mixer) mixer.setTime(t);
  });
}

async function load(url: string) {
  const gltf = await loader.loadAsync(url);
  if (current) app.scene.remove(current);
  current = gltf.scene;
  current.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  app.add(current);
  frameObject(current);
  clips = gltf.animations;
  mixer = clips.length ? new THREE.AnimationMixer(current) : null;
  helper?.removeFromParent();
  helper = new THREE.SkeletonHelper(current);
  helper.visible = state.skeleton;
  app.scene.add(helper);
  buildMorphUi();
  buildClipUi();
  return stats();
}

const view = gui.addFolder('View');
view.add(state, 'turntable');
view.add(state, 'wireframe').onChange((w: boolean) => {
  current?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) (mat as THREE.MeshStandardMaterial).wireframe = w;
  });
});
view.add(state, 'skeleton').onChange((v: boolean) => { if (helper) helper.visible = v; });
const exposureUi = { exposure: app.renderer.toneMappingExposure };
view.add(exposureUi, 'exposure', 0.2, 3, 0.01).onChange((v: number) => { app.renderer.toneMappingExposure = v; });

app.loop.addSim((dt) => {
  if (current && state.turntable) current.rotation.y += dt * 0.5;
  if (mixer && state.playing) {
    mixer.update(dt);
    state.time = action ? action.time : 0;
  }
});

debug.register('viewer', {
  load,
  stats,
  turntable: (on: boolean) => { state.turntable = on; },
  clip: (name: string) => playClip(name),
  pose: (t: number) => { state.playing = false; mixer?.setTime(t); },
  morph: (meshName: string, morphName: string, weight: number) => {
    const mesh = current?.getObjectByName(meshName) as THREE.Mesh | undefined;
    const i = mesh?.morphTargetDictionary?.[morphName];
    if (mesh?.morphTargetInfluences && i !== undefined) mesh.morphTargetInfluences[i] = weight;
    return i !== undefined;
  },
});

const assetUrl = new URLSearchParams(location.search).get('asset');
if (assetUrl) {
  load(assetUrl).catch((e) => console.error('[viewer] failed to load', assetUrl, e));
} else {
  const test = createTestScene();
  app.add(test.root);
}
document.getElementById('hud')!.textContent = `Asset Viewer · ${assetUrl ?? 'look-dev swatches'} · quality: ${app.preset.name}`;
app.loop.start();
```

- [ ] **Step 8: Typecheck and tests**

Run: `npm run typecheck`
Expected: exit 0.
Run: `npm test`
Expected: all pass.

- [ ] **Step 9: Visual verification**

With `npm run dev` running, open `http://localhost:5190/lab.html?q=high` and `http://localhost:5190/viewer.html?q=high` in the chrome-devtools browser:
1. Console: no errors.
2. Lab screenshot: every course element is visible and lit (ramps rise away from the pad, ledges stand at increasing heights, boulders cluster north-east, climbing walls south).
3. `evaluate_script` → `berk.lab.filmstrip(6, 60, 3)` then `take_screenshot`: a 3×2 grid of frames appears (the scene is static, so identical frames are expected). `berk.lab.closeOverlay()`.
4. Viewer screenshot: the look-dev swatches on the studio floor. `berk.viewer.stats()` returns without throwing.

- [ ] **Step 10: Commit**

```powershell
git add -A
git commit -m @'
feat(dev): Motion Lab (test course, stepper, film strips) and Asset Viewer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 10: CC0 asset pipeline (Poly Haven)

**Files:**
- Create: `pipeline/cc0/polyhaven.mjs`, `pipeline/cc0/fetch.mjs`, `pipeline/cc0/process-textures.mjs`, `pipeline/cc0/wanted.json`
- Create (generated): `pipeline/cc0/manifest.json`, `CREDITS.md`, `public/assets/textures/terrain/forest_ground_04/{diff,nor,arm}.webp`
- Modify: `src/world/testScene.ts` (ground uses the processed texture)
- Test: `pipeline/cc0/polyhaven.test.mjs`

**Interfaces:**
- Produces: `selectFiles(files, want): Array<{ url: string; path: string; size: number; md5: string }>`; `manifestEntry(want, files)`; `creditsMarkdown(entries): string`; `TEXTURE_MAPS`
- Produces: `wanted.json` entries: `{ id: string; type: 'textures' | 'models'; res: '1k'|'2k'|'4k'; maps?: Array<'diff'|'nor'|'arm'|'rough'|'ao'|'disp'>; install?: { dir: string; size: number } }`
- Produces: installed textures at `public/assets/<install.dir>/<map>.webp`, served at `assets/<install.dir>/<map>.webp`.

- [ ] **Step 1: Write the failing test**

`pipeline/cc0/polyhaven.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { selectFiles, manifestEntry, creditsMarkdown } from './polyhaven.mjs';

const textureFiles = {
  Diffuse: { '2k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/forest_ground_04/forest_ground_04_diff_2k.jpg', size: 4529321, md5: 'f6ce' } } },
  nor_gl: { '2k': { png: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/forest_ground_04/forest_ground_04_nor_gl_2k.png', size: 9987026, md5: 'c7bf' } } },
  arm: { '2k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/forest_ground_04/forest_ground_04_arm_2k.jpg', size: 3418726, md5: 'c688' } } },
};

const modelFiles = {
  gltf: { '1k': { gltf: {
    url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/rock_moss_set_01/rock_moss_set_01_1k.gltf', size: 9987, md5: '7511',
    include: {
      'rock_moss_set_01.bin': { url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/rock_moss_set_01/rock_moss_set_01.bin', size: 100, md5: 'aa' },
      'textures/rock_moss_set_01_diff_1k.jpg': { url: 'https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/rock_moss_set_01/rock_moss_set_01_diff_1k.jpg', size: 200, md5: 'bb' },
    },
  } } },
};

describe('selectFiles', () => {
  it('picks the requested texture maps in their preferred formats', () => {
    const out = selectFiles(textureFiles, { id: 'forest_ground_04', type: 'textures', res: '2k', maps: ['diff', 'nor', 'arm'] });
    expect(out.map((f) => f.path)).toEqual([
      'forest_ground_04_diff_2k.jpg', 'forest_ground_04_nor_gl_2k.png', 'forest_ground_04_arm_2k.jpg',
    ]);
    expect(out[0].md5).toBe('f6ce');
  });

  it('includes a model gltf and all its dependencies at their relative paths', () => {
    const out = selectFiles(modelFiles, { id: 'rock_moss_set_01', type: 'models', res: '1k' });
    expect(out.map((f) => f.path)).toEqual([
      'rock_moss_set_01_1k.gltf', 'rock_moss_set_01.bin', 'textures/rock_moss_set_01_diff_1k.jpg',
    ]);
  });

  it('throws a clear error when a map or resolution is missing', () => {
    expect(() => selectFiles(textureFiles, { id: 'forest_ground_04', type: 'textures', res: '4k', maps: ['diff'] }))
      .toThrow(/forest_ground_04: missing Diffuse 4k jpg/);
  });
});

describe('manifest + credits', () => {
  it('records licence, source page and file hashes', () => {
    const want = { id: 'forest_ground_04', type: 'textures', res: '2k' };
    const e = manifestEntry(want, [{ path: 'a.jpg', md5: 'x', size: 1, url: 'u' }]);
    expect(e).toEqual({ id: 'forest_ground_04', type: 'textures', res: '2k', license: 'CC0', source: 'https://polyhaven.com/a/forest_ground_04', files: [{ path: 'a.jpg', md5: 'x', size: 1 }] });
  });

  it('renders a sorted credits table', () => {
    const md = creditsMarkdown([
      { id: 'z_rock', type: 'models', source: 'https://polyhaven.com/a/z_rock', license: 'CC0' },
      { id: 'a_ground', type: 'textures', source: 'https://polyhaven.com/a/a_ground', license: 'CC0' },
    ]);
    expect(md.indexOf('a_ground')).toBeLessThan(md.indexOf('z_rock'));
    expect(md).toContain('| a_ground | textures | https://polyhaven.com/a/a_ground | CC0 |');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pipeline/cc0`
Expected: FAIL — cannot find `./polyhaven.mjs`.

- [ ] **Step 3: Implement the pure module**

`pipeline/cc0/polyhaven.mjs`:
```js
export const API = 'https://api.polyhaven.com';
export const USER_AGENT = 'isle-of-berk-asset-pipeline (personal project)';

/** Our map names → [Poly Haven file key, preferred format]. */
export const TEXTURE_MAPS = {
  diff: ['Diffuse', 'jpg'],
  nor: ['nor_gl', 'png'],
  arm: ['arm', 'jpg'],
  rough: ['Rough', 'jpg'],
  ao: ['AO', 'jpg'],
  disp: ['Displacement', 'png'],
};

const basename = (u) => u.split('/').pop();

/**
 * @param {Record<string, any>} files JSON from GET /files/{id}
 * @param {{ id: string, type: 'textures'|'models', res: string, maps?: string[] }} want
 * @returns {{ url: string, path: string, size: number, md5: string }[]} paths relative to the asset cache dir
 */
export function selectFiles(files, want) {
  if (want.type === 'models') {
    const g = files?.gltf?.[want.res]?.gltf;
    if (!g) throw new Error(`${want.id}: missing gltf ${want.res}`);
    const out = [{ url: g.url, path: basename(g.url), size: g.size, md5: g.md5 }];
    for (const [rel, f] of Object.entries(g.include ?? {})) out.push({ url: f.url, path: rel, size: f.size, md5: f.md5 });
    return out;
  }
  return (want.maps ?? ['diff', 'nor', 'arm']).map((m) => {
    const spec = TEXTURE_MAPS[m];
    if (!spec) throw new Error(`${want.id}: unknown map '${m}'`);
    const [key, fmt] = spec;
    const f = files?.[key]?.[want.res]?.[fmt];
    if (!f) throw new Error(`${want.id}: missing ${key} ${want.res} ${fmt}`);
    return { url: f.url, path: basename(f.url), size: f.size, md5: f.md5 };
  });
}

export function manifestEntry(want, files) {
  return {
    id: want.id,
    type: want.type,
    res: want.res,
    license: 'CC0',
    source: `https://polyhaven.com/a/${want.id}`,
    files: files.map((f) => ({ path: f.path, md5: f.md5, size: f.size })),
  };
}

export function creditsMarkdown(entries) {
  const lines = [
    '# Credits',
    '',
    'Third-party assets used by Isle of Berk. All are CC0 (public domain); attribution is not required but is recorded here.',
    '',
    '| Asset | Type | Source | Licence |',
    '|---|---|---|---|',
  ];
  for (const e of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`| ${e.id} | ${e.type} | ${e.source} | ${e.license} |`);
  }
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pipeline/cc0`
Expected: 5 passed.

- [ ] **Step 5: Implement the fetch CLI and the wish-list**

`pipeline/cc0/wanted.json`:
```json
[
  { "id": "forest_ground_04", "type": "textures", "res": "2k", "maps": ["diff", "nor", "arm"],
    "install": { "dir": "textures/terrain/forest_ground_04", "size": 1024 } },
  { "id": "rock_moss_set_01", "type": "models", "res": "1k" }
]
```

`pipeline/cc0/fetch.mjs`:
```js
// Downloads every asset in wanted.json into pipeline/cc0/cache/<id>/ (md5-verified, skips cached files),
// then writes pipeline/cc0/manifest.json and CREDITS.md.  Usage: npm run cc0:fetch
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, USER_AGENT, selectFiles, manifestEntry, creditsMarkdown } from './polyhaven.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CACHE = join(HERE, 'cache');

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function download(file, dest) {
  if (existsSync(dest) && md5(await readFile(dest)) === file.md5) return 'cached';
  const res = await fetch(file.url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${file.url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (md5(buf) !== file.md5) throw new Error(`md5 mismatch for ${file.url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return 'downloaded';
}

const wanted = JSON.parse(await readFile(join(HERE, 'wanted.json'), 'utf8'));
const manifest = [];
for (const want of wanted) {
  const files = selectFiles(await getJson(`${API}/files/${want.id}`), want);
  for (const f of files) {
    const status = await download(f, join(CACHE, want.id, f.path));
    console.log(`${want.id}/${f.path}: ${status}`);
  }
  manifest.push(manifestEntry(want, files));
}
await writeFile(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(ROOT, 'CREDITS.md'), creditsMarkdown(manifest));
console.log(`manifest: ${manifest.length} assets`);
```

- [ ] **Step 6: Implement texture processing**

`pipeline/cc0/process-textures.mjs`:
```js
// Converts cached textures that have an `install` entry in wanted.json into WebP under public/assets.
// diff/arm → quality 88/90; nor → quality 95 (normals are sensitive). Usage: npm run cc0:textures
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const QUALITY = { diff: 88, arm: 90, rough: 90, ao: 90, nor: 95, disp: 95 };
/** Our map name → the token Poly Haven puts in file names (`<id>_<token>_<res>.<ext>`). */
const FILE_TOKEN = { diff: 'diff', nor: 'nor_gl', arm: 'arm', rough: 'rough', ao: 'ao', disp: 'disp' };

const wanted = JSON.parse(await readFile(join(HERE, 'wanted.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(HERE, 'manifest.json'), 'utf8'));

for (const want of wanted.filter((w) => w.type === 'textures' && w.install)) {
  const entry = manifest.find((m) => m.id === want.id);
  if (!entry) throw new Error(`${want.id} is not in manifest.json — run npm run cc0:fetch first`);
  const outDir = join(ROOT, 'public', 'assets', want.install.dir);
  await mkdir(outDir, { recursive: true });
  for (const map of want.maps ?? ['diff', 'nor', 'arm']) {
    const token = FILE_TOKEN[map];
    const file = entry.files.find((f) => f.path.toLowerCase().includes(`_${token}_`));
    if (!file) throw new Error(`${want.id}: no cached file for map ${map}`);
    const out = join(outDir, `${map}.webp`);
    await sharp(join(HERE, 'cache', want.id, file.path))
      .resize(want.install.size, want.install.size)
      .webp({ quality: QUALITY[map] })
      .toFile(out);
    console.log(`${want.id} ${map} → ${out}`);
  }
}
```
(Poly Haven names texture files `<id>_diff_2k.jpg`, `<id>_nor_gl_2k.png`, `<id>_arm_2k.jpg`, `<id>_rough_2k.jpg`, `<id>_ao_2k.jpg`, `<id>_disp_2k.png` — hence the explicit `FILE_TOKEN` table.)

- [ ] **Step 7: Run the pipeline**

Run: `npm run cc0:fetch`
Expected: lines ending `downloaded` for 3 texture files and the model's gltf + bin + textures; `manifest: 2 assets`; `CREDITS.md` created at the repo root.
Run: `npm run cc0:textures`
Expected: three `.webp` files under `public/assets/textures/terrain/forest_ground_04/`.

- [ ] **Step 8: Use the processed texture on the test-scene ground**

In `src/world/testScene.ts` replace the ground material with:
```ts
  const tl = new THREE.TextureLoader();
  const tex = (url: string, srgb: boolean) => {
    const t = tl.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(80, 80);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const base = 'assets/textures/terrain/forest_ground_04/';
  const arm = tex(`${base}arm.webp`, false);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: tex(`${base}diff.webp`, true),
      normalMap: tex(`${base}nor.webp`, false),
      aoMap: arm,
      roughnessMap: arm,
      metalnessMap: arm,
      metalness: 1, // the ARM texture's blue channel is metalness (0 for ground)
    }),
  );
```
(Keep the `ground.name`, `receiveShadow` and `root.add(ground)` lines.)

- [ ] **Step 9: Verify**

Run: `npm test` → all pass. `npm run typecheck` → exit 0.
In the browser (`http://localhost:5190/?q=high`), `berk.cam.preset('hero')` and screenshot: the ground shows the forest-floor texture (leaves/needles), not a flat green; no console errors.

- [ ] **Step 10: Commit**

```powershell
git add -A
git commit -m @'
feat(pipeline): Poly Haven CC0 fetch, manifest, credits and WebP texture processing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 11: Launcher, production build check and the M1 progress log

**Files:**
- Create: `tools/serve-dist.ps1`, `tools/launch-game.bat`, `docs/progress/phase1.md`, `docs/progress/img/m1-*.png`

**Interfaces:**
- Produces: `tools/launch-game.bat` — serves `dist/` on http://localhost:8750 and opens the browser (the desktop shortcut is repointed to it at M8, not now).

- [ ] **Step 1: Write the launcher**

`tools/serve-dist.ps1`:
```powershell
# Serves the built game (dist/) on http://localhost:8750 and opens it. Starts the server only if needed.
$port = 8750
$dist = (Resolve-Path (Join-Path $PSScriptRoot '..\dist')).Path
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -WindowStyle Hidden python -ArgumentList '-m', 'http.server', "$port", '--directory', "$dist"
  Start-Sleep -Milliseconds 900
}
Start-Process "http://localhost:$port/"
```

`tools/launch-game.bat`:
```bat
@echo off
rem ---- Isle of Berk launcher: serve dist/ on :8750 and open the game
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-dist.ps1"
```

- [ ] **Step 2: Production build and served check**

Run: `npm run build`
Expected: exit 0; `dist/assets/` contains the bundled JS and `dist/assets/textures/terrain/forest_ground_04/*.webp`.
Run: `tools\launch-game.bat` (or start `python -m http.server 8750 --directory dist` in the background).
In the chrome-devtools browser open `http://localhost:8750/?q=high`: the test scene renders exactly as in dev; console clean. Also open `http://localhost:8750/lab.html` and `http://localhost:8750/viewer.html`.

- [ ] **Step 3: Write the progress log**

Save screenshots to `docs/progress/img/` (`m1-hero.png`, `m1-wide.png`, `m1-lab.png`, `m1-viewer.png`) via the chrome-devtools `take_screenshot` `filePath` argument, then create `docs/progress/phase1.md`:
```markdown
# Phase 1 progress log

## M1 — Foundation (YYYY-MM-DD)

![hero](img/m1-hero.png) ![wide](img/m1-wide.png)
![lab](img/m1-lab.png) ![viewer](img/m1-viewer.png)

- Pages: game `/`, Motion Lab `/lab.html`, Asset Viewer `/viewer.html` — all render the lit test scene; console clean.
- Render stack: CSM (N cascades) · Preetham sky + clouds → PMREM IBL · Berk height fog · N8AO · bloom · AgX · grade LUT.
- Tuned values: exposure …, sky exposure …, fog density …, sun intensity … (committed).
- MSAA + N8AO decision: … (kept MSAA / switched High to SMAA because …).
- Perf (`berk.perf(30)`): High on <GPU> … ms/frame, … calls, … tris · Low … ms/frame.
- CC0 pipeline: forest_ground_04 (2k→1k WebP), rock_moss_set_01 (1k glTF cached).
```
Fill every `…` with the measured values and today's date; no placeholders may remain.

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m @'
chore: dist launcher and M1 progress log

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

## Self-Review (done while writing)

- **Spec coverage (M1 scope):** §3.1 repo ✓(pre-existing) · §3.2 stack ✓ T1 · §3.3 layout ✓ · §3.4 fixed step ✓ T2 (render interpolation of dragon/bones arrives with the motion plan, which owns those states) · §3.5 three pages ✓ T8–9 · §3.6 CC0 pipeline ✓ T10 (Blender Toothless pipeline is the M2 plan) · §3.7 build/launch ✓ T11 · §3.8 debug API ✓ T4/T8/T9 (motion/behaviour entries arrive with their systems) · §4.2 colour ✓ T6 · §4.3 CSM ✓ T7 · §4.4 sky/IBL/fog ✓ T7 · §4.6 AO ✓ T6 · §4.7 AA ✓ T6 (+decision step T8) · §4.8 order ✓ · §4.10 presets ✓ T5 + perf T8 · §4.11 GPU: not changed (needs the user's OK; noted in the progress log). §4.5 rim light, §4.9 water, §7 Cove, §5 Toothless, §6 motion — later plans.
- **Placeholder scan:** the only `…` are inside the progress-log template, with an explicit instruction to fill them from measurements.
- **Type consistency:** `QualityPreset` fields used in post/lighting match Task 5; `ShaderParams` exported from materials.ts and used by fog tests; `App` members used by pages exist in `createApp`.
