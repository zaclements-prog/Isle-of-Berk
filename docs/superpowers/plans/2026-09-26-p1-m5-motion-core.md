# Phase 1 · M5 Motion Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the rebuilt Toothless his procedural ground motion — camera-relative controller, gait engine, foot planner, body solver, analytic leg IK, look, secondary springs, collision, climbing and an orbit camera. The motion is deterministic at 1/120 s steps, measured in the Motion Lab with the spec's metrics, and playable on the game page.

**Architecture:** Every motion concern is a small, pure, unit-tested module in `src/characters/dragon/motion/`. `DragonCharacter` (`dragon.ts`) runs the spec §6.1 per-step pipeline in order on a `RigSkeleton`. The skeleton is built from rig metadata alone and rewrites ABSOLUTE local rotations every step (spec §3.4), then writes them onto the loaded three.js bones with render-time interpolation. `CollisionWorld` (three-mesh-bvh) answers ray and sphere queries for paws, body proxies, climbing probes and the camera. The Motion Lab runs scripted input timelines headlessly (also inside vitest) and reports the spec §8.2 metrics.

**Tech Stack:** three 0.186.1, three-mesh-bvh 0.9.15, TypeScript 7 (strict, `verbatimModuleSyntax`), Vitest 5 (`environment: 'node'`, `tests/**/*.test.ts`), lil-gui 0.21.

**Spec:** `docs/superpowers/specs/2026-09-26-phase1-vertical-slice-design.md` — §3.4, §6.1–6.10, §6.14–6.16, §8.1–8.2, §12.

**Pre-validated while planning:**
- The TypeScript of Tasks 1–15 was extracted into a scratch project (Plan 1's core, course and `render/materials.ts` code blocks alongside) and typechecked clean. The two page scripts (`src/dev/lab/main.ts`, `src/main.ts`) were left out: they import Plan 1/Plan 2 modules that do not exist yet.
- Every unit and integration test in Tasks 1–14 passes there: 127 tests. That includes the flat-ground motion gates (planted-paw slip ≤ 1 cm, penetration and float ≤ 2 cm, bounded rotations over 60 s) and the fixture climbing gates.
- On Plan 1's real course geometry, four Motion Lab scripts already pass. Five do not yet (the ramps, side slope and stairs). Task 15 Step 8 lists them with their diagnosis and tuning levers.
- Expect the real rig to need tuning in the Motion Lab. The algorithms themselves are tested. Behaviours, face/mood, jump and plasma (§6.11–6.13) and the full pose library (§5.11) are **Plan 4 (M6)**; this plan leaves hooks for them (`DragonCharacter.hooks`, `PoseLayerStack`).

## Global Constraints

- World space: metres, **+Y up**. The dragon faces **+Z** at bind; its left is **+X**. Heading ψ means forward = (sin ψ, 0, cos ψ), and a positive yaw rate turns toward +X (left). Nose-up pitch is positive; roll is positive when the left side is up.
- **The skeleton lives in world space.** The loaded asset root stays at the origin with identity transform. The root bone `pelvis` carries the world position and rotation, so there is no character-space conversion anywhere.
- Simulation runs in fixed **1/120 s** steps. `DragonCharacter.update(frame, dt)` depends only on its arguments and seeded state, so the Motion Lab and vitest step it without `requestAnimationFrame`.
- Randomness comes only from `mulberry32` (`src/core/rng.ts`). No `Math.random`, `Date` or `performance.now` in simulation code.
- **Absolute rotations (spec §3.4):** every step starts from `skeleton.resetToBind()`, and every layer writes rotations computed from bind plus that step's state. Never accumulate a per-step relative rotation on a bone.
- **Never bind Ctrl** (Ctrl+W closes the tab). Keys: WASD/arrows move (camera-relative); **C** toggles prowl; **Shift** gallops; **Space** is jump (M6); **F**/left click is plasma (M6).
- Anatomy comes only from rig metadata. Motion modules consume `MotionRig` (`motion/rigTypes.ts`), a structural subset of Plan 2's `RigMeta`, so no module imports Plan 2 files until Task 15.
  - The only hand-set numbers are in `motion/tuning.ts`.
  - **Cross-plan:** Plan 2's `anatomy.LIMBS` must carry exactly the limits of `LIMB_LIMITS` in `tests/fixtures/toothlessRig.ts` (Task 5). Plan 2 as written has the hind tibia inverted (`[-120, 5]`) and the distal joints too narrow. Task 9's exported-rig check fails until they match.
  - **Joint-limit semantics:** `limitsDeg[bone] = [lo, hi]` is the rotation about the bone's exported `xAxis` (right-hand rule) relative to bind, in degrees.
- NaN guard: if the pose ever becomes non-finite, the character restores the previous step's pose and counts it (`nanResets`). The lab metrics fail on any reset.
- Shader patches go through `addCompileHook` only (Plan 1 `src/render/materials.ts`); every scene material goes through the app material pipeline.
- Acceptance numbers are gates, not suggestions (spec §8.2):
  - planted-foot slip ≤ 1 cm
  - paw penetration ≤ 2 cm
  - planted-paw float ≤ 2 cm
  - no proxy penetration > 2 cm
  - joint limits never exceeded
  - no NaN
  - bone rotations bounded over 60 s loops

  When a test or metric fails, tune `tuning.ts` or fix the code. **Never loosen a threshold.**
- Commits: one per task (fix rounds add commits). Write the message to a file with the Write tool and commit with `git commit -F <file>`, ending with your own model-accurate `Co-Authored-By:` trailer. Branch `phase1-slice`.
- **Dependencies:**
  - Tasks 1–14 are pure: they use the fixture rig in `tests/fixtures/toothlessRig.ts`, built from the anatomy numbers, and need only Plan 1 Tasks 1–4.
  - Task 15 additionally needs Plan 1 complete plus Plan 2's exported `public/assets/characters/toothless/*` and `src/characters/dragon/{rigMeta,asset,materials}.ts`.
  - Task 16 needs everything above.
  - Tests that read the exported asset `skipIf` it is absent and say so.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/characters/dragon/motion/math.ts` | angles/phases, clamps, swing–twist, twist clamping |
| `src/characters/dragon/motion/springs.ts` | exact damped springs (scalar, angle, vector) |
| `src/characters/dragon/motion/ik.ts` | planar chain frames, analytic two-bone IK, pantograph (3-segment) IK |
| `src/characters/dragon/motion/gait.ts` | gait table, hysteresis, blended phase/duty/offsets |
| `src/world/collision.ts` | `CollisionWorld`: merged static BVH — rays, ground, closest point, sphere contact/resolve/cast |
| `src/characters/dragon/motion/rigTypes.ts` | `MotionRig` (subset of `RigMeta`), `LimbKey`, `LEG_KEYS` |
| `src/characters/dragon/motion/skeleton.ts` | `RigSkeleton`: bind frames from metadata, absolute pose buffer, FK, bone writer with interpolation |
| `src/characters/dragon/motion/tuning.ts` | every motion constant (typed) + deep merge + preset loading |
| `src/characters/dragon/motion/controller.ts` | input → `MoveIntent`; `BodyKinematics` (speed, heading, yaw rate) |
| `src/characters/dragon/motion/proxies.ts` | body collision spheres from rig proxies; slide resolution |
| `src/characters/dragon/motion/footPlanner.ts` | plant/swing state machine, Raibert targets, foothold projection/scoring, swing paths, forced steps |
| `src/characters/dragon/motion/bodySolver.ts` | pelvis height/pitch/roll from supports, dynamics, spine bend |
| `src/characters/dragon/motion/legs.ts` | per-leg IK on the rig (front: scapula + two-bone; hind: pantograph), foot/toe alignment, limits |
| `src/characters/dragon/motion/poseLayers.ts` | `poses.json` parsing, clip sampling with explicit masks, override/additive layers |
| `src/characters/dragon/motion/look.ts` | head/neck look-at with eyes-first springs, glances |
| `src/characters/dragon/motion/secondary.ts` | tail springs + ground avoidance, ears, hip wings/fins, breathing |
| `src/characters/dragon/motion/climbing.ts` | surface probes, climb mode, scramble-up, blocked, hop-down |
| `src/characters/dragon/motion/dragon.ts` | `DragonCharacter`: the §6.1 pipeline, spawn, NaN guard, hooks, bone writer |
| `src/characters/dragon/motion/metrics.ts` | pure lab metrics (slip, penetration, float, proxies, limits, NaN, boundedness) |
| `src/characters/dragon/fade.ts` | dithered camera-proximity fade compile hook |
| `src/camera/orbitCamera.ts` | orbit/follow camera with collision, recentre, climb pitch, fade value |
| `src/dev/lab/scripts.ts` | named input timelines for the course |
| `src/dev/lab/labRunner.ts` | headless scripted runs → metrics report |
| `src/dev/lab/overlays.ts` | debug overlays (targets, planted markers, arcs, support polygon, COM, spine, look, proxies) |
| `src/dev/lab/main.ts` | (modify) Toothless in the Motion Lab, tuning panels, `berk.lab.run/play`, `berk.toggle` |
| `src/main.ts` | (modify) Toothless on the game page with the orbit camera |
| `public/assets/characters/toothless/motion-tuning.json` | committed tuned preset |
| `tests/fixtures/toothlessRig.ts` | fixture `MotionRig` generated from the anatomy numbers |
| `tests/fixtures/worlds.ts` | small collision fixtures (floor, ramps, walls, steps) |
| `tests/motion/*.test.ts`, `tests/world/collision.test.ts`, `tests/camera/orbitCamera.test.ts`, `tests/lab/*.test.ts` | tests |

Motion tests share one helper file, `tests/fixtures/worlds.ts`, created in Task 4.

---

### Task 1: Motion math and exact springs

**Files:**
- Create: `src/characters/dragon/motion/math.ts`, `src/characters/dragon/motion/springs.ts`
- Test: `tests/motion/math.test.ts`, `tests/motion/springs.test.ts`

**Interfaces:**
- Consumes: `three` only.
- Produces (math): `TAU`, `clamp(v, lo, hi)`, `lerp(a, b, t)`, `smoothstep(e0, e1, x)`, `fract(x)`, `wrapAngle(a)` → (−π, π], `angleDiff(a, b)` = wrap(b − a), `phaseDiff(a, b)` → (−0.5, 0.5], `dampFactor(halfLife, dt)`, `deg(x)` (degrees → rad), `isFiniteVec3(v)`, `isFiniteQuat(q)`, `twistAngle(q, axis)`, `swingTwist(q, axis, swingOut, twistOut) → number`, `clampTwist(rel, axis, lo, hi) → correction`, `rotY(v: Vector3, angle, out)`.
- Produces (springs): `interface SpringState { x: number; v: number }`, `stepSpring(s, target, omega, zeta, dt)`, `stepAngleSpring(s, target, omega, zeta, dt)`, `class Vec3Spring { x; v; reset(p); step(target, omega, zeta, dt) }`.

- [ ] **Step 1: Write the failing tests**

`tests/motion/math.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  wrapAngle, angleDiff, phaseDiff, fract, smoothstep, deg, twistAngle, swingTwist, clampTwist, rotY,
} from '../../src/characters/dragon/motion/math';

describe('angles and phases', () => {
  it('wraps angles to (-π, π]', () => {
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(7 * Math.PI)).toBeCloseTo(Math.PI, 9);
  });
  it('takes the short way round', () => {
    expect(angleDiff(deg(170), deg(-170))).toBeCloseTo(deg(20), 12);
    expect(angleDiff(deg(-170), deg(170))).toBeCloseTo(deg(-20), 12);
    expect(phaseDiff(0.95, 0.05)).toBeCloseTo(0.1, 12);
    expect(fract(-0.25)).toBeCloseTo(0.75, 12);
  });
  it('smoothsteps', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(1, 0, 0.25)).toBeCloseTo(smoothstep(0, 1, 0.75), 12);
  });
  it('rotates about +Y so heading ψ maps +Z to (sin ψ, 0, cos ψ)', () => {
    const v = rotY(new THREE.Vector3(0, 0, 1), deg(90), new THREE.Vector3());
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });
});

describe('swing-twist', () => {
  const axis = new THREE.Vector3(0.3, -0.2, 0.9).normalize();
  it('recovers the angle of a pure twist', () => {
    for (const a of [-2.5, -1, 0, 0.7, 3]) {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, a);
      expect(twistAngle(q, axis)).toBeCloseTo(a, 9);
    }
  });
  it('recomposes q = swing · twist with a swing perpendicular to the axis', () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.8, 1.1));
    const s = new THREE.Quaternion();
    const t = new THREE.Quaternion();
    swingTwist(q, axis, s, t);
    expect(Math.abs(s.clone().multiply(t).dot(q))).toBeCloseTo(1, 9);
    expect(Math.abs(s.x * axis.x + s.y * axis.y + s.z * axis.z)).toBeLessThan(1e-9);
  });
  it('clamps only the twist', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, 1.2);
    expect(clampTwist(q, axis, -0.5, 0.5)).toBeCloseTo(-0.7, 9);
    expect(twistAngle(q, axis)).toBeCloseTo(0.5, 9);
    const inside = new THREE.Quaternion().setFromAxisAngle(axis, 0.2);
    expect(clampTwist(inside, axis, -0.5, 0.5)).toBe(0);
  });
});
```

`tests/motion/springs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { stepSpring, stepAngleSpring, Vec3Spring, type SpringState } from '../../src/characters/dragon/motion/springs';
import { deg } from '../../src/characters/dragon/motion/math';

function run(s: SpringState, target: number, omega: number, zeta: number, dt: number, n: number): void {
  for (let i = 0; i < n; i++) stepSpring(s, target, omega, zeta, dt);
}

describe('springs', () => {
  it('critically damped: converges with no overshoot', () => {
    const s = { x: 1, v: 0 };
    let min = Infinity;
    for (let i = 0; i < 240; i++) {
      stepSpring(s, 0, 10, 1, 1 / 120);
      min = Math.min(min, s.x);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
  });
  it.each([1, 0.35, 0])('is independent of the step size (ζ = %s)', (zeta) => {
    const a = { x: 0.8, v: -2 };
    const b = { x: 0.8, v: -2 };
    run(a, 0.1, 9, zeta, 1 / 30, 1);
    run(b, 0.1, 9, zeta, 1 / 240, 8);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.v).toBeCloseTo(b.v, 9);
  });
  it.each([1 / 240, 1 / 120, 1 / 60, 1 / 30])('never gains energy (dt = %s)', (dt) => {
    for (const zeta of [1, 0.45, 0.1]) {
      const omega = 20;
      const s = { x: 1, v: 3 };
      let e = 0.5 * s.v * s.v + 0.5 * omega * omega * s.x * s.x;
      for (let i = 0; i < 300; i++) {
        stepSpring(s, 0, omega, zeta, dt);
        const e2 = 0.5 * s.v * s.v + 0.5 * omega * omega * s.x * s.x;
        expect(e2).toBeLessThanOrEqual(e + 1e-9);
        e = e2;
      }
    }
  });
  it('underdamped springs overshoot (follow-through)', () => {
    const s = { x: 1, v: 0 };
    let min = Infinity;
    for (let i = 0; i < 240; i++) {
      stepSpring(s, 0, 10, 0.3, 1 / 120);
      min = Math.min(min, s.x);
    }
    expect(min).toBeLessThan(-0.1);
  });
  it('angle springs take the short way round', () => {
    const s = { x: deg(170), v: 0 };
    for (let i = 0; i < 240; i++) {
      stepAngleSpring(s, deg(-170), 8, 1, 1 / 120);
      expect(Math.abs(s.x)).toBeGreaterThan(deg(150));
    }
    expect(s.x).toBeCloseTo(deg(-170), 3);
  });
  it('vector springs converge', () => {
    const sp = new Vec3Spring();
    sp.reset(new THREE.Vector3(1, 2, 3));
    const target = new THREE.Vector3(-1, 0, 0.5);
    for (let i = 0; i < 600; i++) sp.step(target, 8, 1, 1 / 120);
    expect(sp.x.distanceTo(target)).toBeLessThan(1e-4);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/motion`
Expected: FAIL — cannot resolve `src/characters/dragon/motion/math` / `springs`.

- [ ] **Step 3: Implement `math.ts`**

```ts
import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

export function deg(d: number): number {
  return (d * Math.PI) / 180;
}

/** Wrap to (−π, π]. */
export function wrapAngle(a: number): number {
  const w = a - TAU * Math.floor((a + Math.PI) / TAU);
  return w <= -Math.PI ? w + TAU : w;
}

/** Shortest signed rotation from a to b, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Shortest signed difference of two phases in [0, 1): result in (−0.5, 0.5]. */
export function phaseDiff(a: number, b: number): number {
  return wrapAngle((b - a) * TAU) / TAU;
}

/** Fraction of the remaining gap an exponential smoother closes in dt, given its half-life (frame-rate independent). */
export function dampFactor(halfLife: number, dt: number): number {
  return 1 - Math.pow(2, -dt / Math.max(halfLife, 1e-6));
}

export function isFiniteVec3(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isFiniteQuat(q: THREE.Quaternion): boolean {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}

/** Rotate v about +Y by `angle` (heading convention: +Z → (sin, 0, cos)). */
export function rotY(v: THREE.Vector3, angle: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = v.x * c + v.z * s;
  const z = -v.x * s + v.z * c;
  return out.set(x, v.y, z);
}

/**
 * Signed twist of q about the unit `axis` (swing–twist decomposition), in (−π, π].
 * For q = (sin(θ/2)·a, cos(θ/2)) the projection of the vector part on the axis is sin(θ/2), so θ = 2·atan2(v·a, w).
 */
export function twistAngle(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  return wrapAngle(2 * Math.atan2(d, q.w));
}

const _inv = new THREE.Quaternion();

/** Split q = swing · twist (twist about the unit `axis`). Returns the twist angle. */
export function swingTwist(q: THREE.Quaternion, axis: THREE.Vector3, swing: THREE.Quaternion, twist: THREE.Quaternion): number {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  twist.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  const len = Math.hypot(twist.x, twist.y, twist.z, twist.w);
  if (len < 1e-12) twist.identity(); // 180° swing: the twist is undefined, take none
  else twist.set(twist.x / len, twist.y / len, twist.z / len, twist.w / len);
  swing.copy(q).multiply(_inv.copy(twist).invert());
  return twistAngle(twist, axis);
}

const _corr = new THREE.Quaternion();

/**
 * Clamp the twist of `rel` (a rotation relative to bind, in the bone's local frame) about the local `axis` to
 * [lo, hi] by post-multiplying a rotation about that axis (swing untouched). Returns the correction applied (rad).
 */
export function clampTwist(rel: THREE.Quaternion, axis: THREE.Vector3, lo: number, hi: number): number {
  const a = twistAngle(rel, axis);
  const c = clamp(a, lo, hi);
  if (c === a) return 0;
  rel.multiply(_corr.setFromAxisAngle(axis, c - a));
  return c - a;
}
```

- [ ] **Step 4: Implement `springs.ts`**

```ts
import * as THREE from 'three';
import { wrapAngle } from './math';

export interface SpringState {
  x: number;
  v: number;
}

/**
 * Advance x'' = −ω²(x − target) − 2ζω·x' by dt with the EXACT solution (0 ≤ ζ ≤ 1; ζ ≥ 1 is treated as critical).
 * Exact integration is unconditionally stable and step-size independent: one 1/30 s step equals eight 1/240 s steps.
 *   critical (ζ = 1), y = x − target, j = v0 + ω·y0:  y(t) = (y0 + j·t)·e^(−ωt),  v(t) = (v0 − ω·j·t)·e^(−ωt)
 *   underdamped, a = ζω, b = ω√(1 − ζ²):           y(t) = e^(−at)·(y0·cos bt + ((v0 + a·y0)/b)·sin bt)
 *                                                  v(t) = e^(−at)·(v0·cos bt − ((ω²·y0 + a·v0)/b)·sin bt)
 * A constant external acceleration A shifts the equilibrium: pass target + A/ω².
 */
export function stepSpring(s: SpringState, target: number, omega: number, zeta: number, dt: number): void {
  const y = s.x - target;
  if (zeta >= 0.9999) {
    const e = Math.exp(-omega * dt);
    const j = s.v + omega * y;
    s.x = target + (y + j * dt) * e;
    s.v = (s.v - omega * j * dt) * e;
    return;
  }
  const a = zeta * omega;
  const b = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-a * dt);
  const c = Math.cos(b * dt);
  const sn = Math.sin(b * dt);
  const nx = e * (y * c + ((s.v + a * y) / b) * sn);
  const nv = e * (s.v * c - ((omega * omega * y + a * s.v) / b) * sn);
  s.x = target + nx;
  s.v = nv;
}

/** Spring on an angle: the target is unwrapped next to x so the spring always takes the short way round. */
export function stepAngleSpring(s: SpringState, target: number, omega: number, zeta: number, dt: number): void {
  stepSpring(s, s.x + wrapAngle(target - s.x), omega, zeta, dt);
  s.x = wrapAngle(s.x);
}

/** Three independent exact springs. */
export class Vec3Spring {
  readonly x = new THREE.Vector3();
  readonly v = new THREE.Vector3();
  private readonly s: SpringState = { x: 0, v: 0 };

  reset(p: THREE.Vector3): void {
    this.x.copy(p);
    this.v.set(0, 0, 0);
  }

  step(target: THREE.Vector3, omega: number, zeta: number, dt: number): void {
    for (const k of ['x', 'y', 'z'] as const) {
      this.s.x = this.x[k];
      this.s.v = this.v[k];
      stepSpring(this.s, target[k], omega, zeta, dt);
      this.x[k] = this.s.x;
      this.v[k] = this.s.v;
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/motion` → all pass. Run `npm run typecheck` → exit 0.

- [ ] **Step 6: Commit** — message `feat(motion): angle/phase math, swing–twist and exact damped springs`.

---

### Task 2: Analytic leg IK — two-bone and pantograph

**Files:**
- Create: `src/characters/dragon/motion/ik.ts`
- Test: `tests/motion/ik.test.ts`

**Interfaces:**
- Consumes: `clamp` (Task 1).
- Produces:
  - `interface ChainFrame { u; w; m }` (unit vectors), `createFrame()`, `chainFrame(root, mid, end, pole, out) → boolean`, `retargetFrame(ref, root, target, pole, out)`, `frameRotation(from, to, out: Quaternion)`, `planeAngle(v, frame) → number`
  - `interface TwoBoneInput { root; mid; end; upper; lower; target; pole; minInterior; maxInterior }`, `interface TwoBoneResult { upper; lower; mid; end; reached; shortfall; interior; stretch }`, `createTwoBoneResult()`, `solveTwoBone(input, out)`
  - `interface PantographInput { hip; knee; hock; paw; femur; tibia; meta; target; pole; maxReach }`, `interface PantographResult { femur; tibia; meta; knee; hock; paw; reached; shortfall; stretch }`
  - `stretch` = target distance ÷ the longest distance the solver may use (≥ 1 means out of reach). The foot planner uses it to lift paws before they over-stretch., `createPantographResult()`, `solvePantograph(input, out)`
  - All positions and rotations are world-space. `upper`/`lower`/`femur`/… are the bones' reference **world** rotations: the pose to bend from, with each bone's local +Y along the bone. Results are world rotations.

- [ ] **Step 1: Write the failing tests**

`tests/motion/ik.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mulberry32 } from '../../src/core/rng';
import {
  solveTwoBone, createTwoBoneResult, solvePantograph, createPantographResult, chainFrame, createFrame, planeAngle,
  type TwoBoneInput, type PantographInput,
} from '../../src/characters/dragon/motion/ik';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** World rotation of a bone from head to tail with its local +Y along the bone and +X near −X world. */
function boneQuat(head: THREE.Vector3, tail: THREE.Vector3): THREE.Quaternion {
  const y = tail.clone().sub(head).normalize();
  const x = V(-1, 0, 0).addScaledVector(y, y.x).normalize();
  const z = x.clone().cross(y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const along = (q: THREE.Quaternion, len: number) => V(0, len, 0).applyQuaternion(q);
const sameRotation = (a: THREE.Quaternion, b: THREE.Quaternion) => Math.abs(a.dot(b)) > 1 - 1e-9;

// Toothless front leg (glTF space, from the anatomy): shoulder → elbow → wrist; elbows point back (pole −Z).
const SH = V(0.31, 0.95, 0.74);
const EL = V(0.34, 0.56, 0.6);
const WR = V(0.34, 0.17, 0.74);
const front = (target: THREE.Vector3, minInterior = 0, maxInterior = Math.PI): TwoBoneInput => ({
  root: SH, mid: EL, end: WR, upper: boneQuat(SH, EL), lower: boneQuat(EL, WR),
  target, pole: V(0, 0, -1), minInterior, maxInterior,
});

// Hind leg: hip → knee → hock → paw; knees point forward (pole +Z).
const HIP = V(0.29, 0.97, -0.62);
const KNEE = V(0.34, 0.6, -0.36);
const HOCK = V(0.33, 0.3, -0.74);
const PAW = V(0.33, 0.07, -0.6);
const hind = (target: THREE.Vector3): PantographInput => ({
  hip: HIP, knee: KNEE, hock: HOCK, paw: PAW,
  femur: boneQuat(HIP, KNEE), tibia: boneQuat(KNEE, HOCK), meta: boneQuat(HOCK, PAW),
  target, pole: V(0, 0, 1), maxReach: 0.995,
});

function randomTargets(center: THREE.Vector3, spread: THREE.Vector3, n: number, seed: number): THREE.Vector3[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () =>
    V(center.x + (rnd() * 2 - 1) * spread.x, center.y + (rnd() * 2 - 1) * spread.y, center.z + (rnd() * 2 - 1) * spread.z));
}

describe('solveTwoBone', () => {
  const l1 = EL.distanceTo(SH);
  const l2 = WR.distanceTo(EL);
  it('returns the reference pose for the reference target', () => {
    const inp = front(WR.clone());
    const o = solveTwoBone(inp, createTwoBoneResult());
    expect(sameRotation(o.upper, inp.upper)).toBe(true);
    expect(sameRotation(o.lower, inp.lower)).toBe(true);
    expect(o.reached).toBe(true);
  });
  it('reaches reachable targets within 1 mm, keeping bone lengths and consistent rotations', () => {
    const o = createTwoBoneResult();
    for (const t of randomTargets(V(0.34, 0.3, 0.8), V(0.05, 0.12, 0.25), 200, 3)) {
      if (t.distanceTo(SH) > l1 + l2 - 0.01) continue;
      solveTwoBone(front(t), o);
      expect(o.end.distanceTo(t)).toBeLessThan(1e-3);
      expect(o.mid.distanceTo(SH)).toBeCloseTo(l1, 9);
      expect(o.end.distanceTo(o.mid)).toBeCloseTo(l2, 9);
      expect(SH.clone().add(along(o.upper, l1)).distanceTo(o.mid)).toBeLessThan(1e-9);
      expect(o.mid.clone().add(along(o.lower, l2)).distanceTo(o.end)).toBeLessThan(1e-9);
    }
  });
  it('keeps the bend on the pole side (elbows back) and never flips', () => {
    const o = createTwoBoneResult();
    for (const t of randomTargets(V(0.34, 0.3, 0.8), V(0.05, 0.12, 0.25), 200, 5)) {
      solveTwoBone(front(t), o);
      const u = o.end.clone().sub(SH).normalize();
      const side = o.mid.clone().sub(SH);
      side.addScaledVector(u, -side.dot(u));
      expect(side.z).toBeLessThan(0);
    }
  });
  it('moves the middle joint continuously as the target moves', () => {
    const o = createTwoBoneResult();
    const a = V(0.34, 0.25, 0.95);
    const b = V(0.34, 0.3, 0.45);
    let prev: THREE.Vector3 | null = null;
    for (let k = 0; k <= 500; k++) {
      solveTwoBone(front(a.clone().lerp(b, k / 500)), o);
      if (prev) expect(o.mid.distanceTo(prev)).toBeLessThan(0.01);
      prev = o.mid.clone();
    }
  });
  it('clamps unreachable targets along the target direction', () => {
    const t = SH.clone().add(V(0, -2, 0.3));
    const o = solveTwoBone(front(t), createTwoBoneResult());
    expect(o.reached).toBe(false);
    expect(o.shortfall).toBeGreaterThan(1);
    expect(o.stretch).toBeGreaterThan(1);
    const dir = t.clone().sub(SH).normalize();
    expect(o.end.clone().sub(SH).normalize().dot(dir)).toBeCloseTo(1, 9);
  });
  it('respects the middle-joint interior limits', () => {
    const minInterior = 2.0;
    const t = SH.clone().add(V(0, -0.3, 0));
    const o = solveTwoBone(front(t, minInterior), createTwoBoneResult());
    expect(o.interior).toBeGreaterThanOrEqual(minInterior - 1e-9);
    expect(o.reached).toBe(false);
  });
});

describe('solvePantograph', () => {
  const pawOf = (o: { paw: THREE.Vector3 }) => o.paw;
  it('returns the reference pose for the reference target', () => {
    const inp = hind(PAW.clone());
    const o = solvePantograph(inp, createPantographResult());
    expect(sameRotation(o.femur, inp.femur)).toBe(true);
    expect(sameRotation(o.tibia, inp.tibia)).toBe(true);
    expect(sameRotation(o.meta, inp.meta)).toBe(true);
  });
  it('reaches targets within 1 mm and keeps the metatarsal–femur angle', () => {
    const f0 = createFrame();
    chainFrame(HIP, KNEE, PAW, V(0, 0, 1), f0);
    const delta0 = planeAngle(PAW.clone().sub(HOCK), f0) - planeAngle(KNEE.clone().sub(HIP), f0);
    const o = createPantographResult();
    const f = createFrame();
    for (const t of randomTargets(V(0.33, 0.15, -0.6), V(0.05, 0.15, 0.3), 200, 9)) {
      solvePantograph(hind(t), o);
      expect(pawOf(o).distanceTo(t)).toBeLessThan(1e-3);
      chainFrame(HIP, o.knee, o.paw, V(0, 0, 1), f);
      const delta = planeAngle(o.paw.clone().sub(o.hock), f) - planeAngle(o.knee.clone().sub(HIP), f);
      expect(delta).toBeCloseTo(delta0, 6);
      expect(o.knee.clone().sub(HIP).z).toBeGreaterThan(-0.05); // knee stays forward-ish of the hip line
    }
  });
  it('rotations agree with joint positions', () => {
    const o = solvePantograph(hind(V(0.33, 0.2, -0.3)), createPantographResult());
    expect(HIP.clone().add(along(o.femur, KNEE.distanceTo(HIP))).distanceTo(o.knee)).toBeLessThan(1e-9);
    expect(o.knee.clone().add(along(o.tibia, HOCK.distanceTo(KNEE))).distanceTo(o.hock)).toBeLessThan(1e-9);
    expect(o.hock.clone().add(along(o.meta, PAW.distanceTo(HOCK))).distanceTo(o.paw)).toBeLessThan(1e-9);
  });
  it('clamps far targets and reports the shortfall', () => {
    const o = solvePantograph(hind(V(0.33, -1.5, -0.6)), createPantographResult());
    expect(o.reached).toBe(false);
    expect(o.shortfall).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/motion/ik.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `ik.ts`**

```ts
import * as THREE from 'three';
import { clamp } from './math';

/** Bend-plane frame of a chain: u = root → end, w = the side the middle joint bends toward (⟂ u), m = u × w (hinge normal). */
export interface ChainFrame {
  readonly u: THREE.Vector3;
  readonly w: THREE.Vector3;
  readonly m: THREE.Vector3;
}

export function createFrame(): ChainFrame {
  return { u: new THREE.Vector3(), w: new THREE.Vector3(), m: new THREE.Vector3() };
}

/** Unit vector ⟂ u, as close as possible to `hint` (any perpendicular when the hint is parallel to u). */
function perpendicularTo(u: THREE.Vector3, hint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(hint).addScaledVector(u, -hint.dot(u));
  if (out.lengthSq() < 1e-12) {
    out.set(Math.abs(u.x) < 0.9 ? 1 : 0, Math.abs(u.x) < 0.9 ? 0 : 1, 0);
    out.addScaledVector(u, -out.dot(u));
  }
  return out.normalize();
}

/**
 * Frame of a chain in its reference configuration. w is the part of (mid − root) perpendicular to u — the side the
 * middle joint already bends toward — so re-solving to the reference target is exactly the identity. The pole is used
 * only when the chain is straight. Returns false when root and end coincide.
 */
export function chainFrame(
  root: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3, pole: THREE.Vector3, out: ChainFrame,
): boolean {
  out.u.subVectors(end, root);
  const len = out.u.length();
  if (len < 1e-9) return false;
  out.u.divideScalar(len);
  out.w.subVectors(mid, root);
  out.w.addScaledVector(out.u, -out.w.dot(out.u)); // the argument is evaluated before the call mutates w
  if (out.w.lengthSq() < 1e-12) perpendicularTo(out.u, pole, out.w);
  else out.w.normalize();
  out.m.crossVectors(out.u, out.w);
  return true;
}

/** Target frame: u toward the target; w keeps the reference bend side (so the joint never flips). */
export function retargetFrame(
  ref: ChainFrame, root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, out: ChainFrame,
): void {
  out.u.subVectors(target, root);
  if (out.u.lengthSq() < 1e-12) out.u.copy(ref.u);
  else out.u.normalize();
  out.w.copy(ref.w).addScaledVector(out.u, -ref.w.dot(out.u));
  if (out.w.lengthSq() < 1e-6) perpendicularTo(out.u, pole, out.w);
  else out.w.normalize();
  out.m.crossVectors(out.u, out.w);
}

const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();

/** The rotation R with R·u0 = u, R·w0 = w, R·m0 = m, i.e. R = [u w m]·[u0 w0 m0]ᵀ. */
export function frameRotation(from: ChainFrame, to: ChainFrame, out: THREE.Quaternion): THREE.Quaternion {
  _m0.makeBasis(from.u, from.w, from.m).transpose();
  _m1.makeBasis(to.u, to.w, to.m).multiply(_m0);
  return out.setFromRotationMatrix(_m1);
}

/** Angle of v within the frame's bend plane, measured from u toward w. */
export function planeAngle(v: THREE.Vector3, f: ChainFrame): number {
  return Math.atan2(v.dot(f.w), v.dot(f.u));
}

export interface TwoBoneInput {
  readonly root: THREE.Vector3;
  readonly mid: THREE.Vector3;
  readonly end: THREE.Vector3;
  /** Reference world rotations of the two bones (local +Y along each bone). */
  readonly upper: THREE.Quaternion;
  readonly lower: THREE.Quaternion;
  readonly target: THREE.Vector3;
  /** Bend-side hint used only when the reference chain is straight. */
  readonly pole: THREE.Vector3;
  /** Allowed interior angle at the middle joint (rad; 0 … π). */
  readonly minInterior: number;
  readonly maxInterior: number;
}

export interface TwoBoneResult {
  readonly upper: THREE.Quaternion;
  readonly lower: THREE.Quaternion;
  readonly mid: THREE.Vector3;
  readonly end: THREE.Vector3;
  reached: boolean;
  /** Distance still missing to the target (> 0 when out of reach, < 0 when too close). */
  shortfall: number;
  interior: number;
  /** Target distance ÷ the longest reach the limits allow (≥ 1: out of reach). */
  stretch: number;
}

export function createTwoBoneResult(): TwoBoneResult {
  return {
    upper: new THREE.Quaternion(), lower: new THREE.Quaternion(), mid: new THREE.Vector3(), end: new THREE.Vector3(),
    reached: false, shortfall: 0, interior: 0, stretch: 0,
  };
}

const F0 = createFrame();
const F1 = createFrame();
const _R = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * Analytic two-bone IK in the chain's bend plane.
 *   The reach d = |target − root| is clamped to what the middle-joint limits allow: d(θ)² = l1² + l2² − 2·l1·l2·cos θ.
 *   The upper bone's angle from u follows from the law of cosines: cos α = (l1² + d² − l2²) / (2·l1·d), on the w side.
 * Each bone's new world rotation = Rot(m, Δangle) · R · reference, where R maps the reference bend frame onto the
 * target frame. Each bone keeps its own twist relative to the bend plane, and the reference target gives back the
 * reference pose exactly.
 */
export function solveTwoBone(i: TwoBoneInput, o: TwoBoneResult): TwoBoneResult {
  const l1 = i.mid.distanceTo(i.root);
  const l2 = i.end.distanceTo(i.mid);
  if (!chainFrame(i.root, i.mid, i.end, i.pole, F0)) {
    o.upper.copy(i.upper);
    o.lower.copy(i.lower);
    o.mid.copy(i.mid);
    o.end.copy(i.end);
    o.reached = false;
    o.shortfall = 0;
    o.interior = 0;
    o.stretch = 0;
    return o;
  }
  const reachAt = (theta: number) => Math.sqrt(Math.max(l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(theta), 0));
  const dLo = Math.max(Math.abs(l1 - l2) + 1e-5, reachAt(clamp(i.minInterior, 0, Math.PI)));
  const dHi = Math.max(dLo, Math.min(l1 + l2 - 1e-5, reachAt(clamp(i.maxInterior, 0, Math.PI))));
  const dist = i.target.distanceTo(i.root);
  const d = clamp(dist, dLo, dHi);
  retargetFrame(F0, i.root, i.target, i.pole, F1);
  const a0 = planeAngle(_v.subVectors(i.mid, i.root), F0);
  const b0 = planeAngle(_v.subVectors(i.end, i.mid), F0);
  const alpha = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  o.mid.copy(i.root).addScaledVector(F1.u, l1 * Math.cos(alpha)).addScaledVector(F1.w, l1 * Math.sin(alpha));
  o.end.copy(i.root).addScaledVector(F1.u, d);
  const beta = planeAngle(_v.subVectors(o.end, o.mid), F1);
  frameRotation(F0, F1, _R);
  o.upper.setFromAxisAngle(F1.m, alpha - a0).multiply(_R).multiply(i.upper);
  o.lower.setFromAxisAngle(F1.m, beta - b0).multiply(_R).multiply(i.lower);
  o.reached = Math.abs(d - dist) < 1e-6;
  o.shortfall = dist - d;
  o.interior = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  o.stretch = dist / dHi;
  return o;
}

export interface PantographInput {
  readonly hip: THREE.Vector3;
  readonly knee: THREE.Vector3;
  readonly hock: THREE.Vector3;
  readonly paw: THREE.Vector3;
  readonly femur: THREE.Quaternion;
  readonly tibia: THREE.Quaternion;
  readonly meta: THREE.Quaternion;
  readonly target: THREE.Vector3;
  readonly pole: THREE.Vector3;
  /** Fraction of the virtual chain's full length the solver may use (e.g. 0.995). */
  readonly maxReach: number;
}

export interface PantographResult {
  readonly femur: THREE.Quaternion;
  readonly tibia: THREE.Quaternion;
  readonly meta: THREE.Quaternion;
  readonly knee: THREE.Vector3;
  readonly hock: THREE.Vector3;
  readonly paw: THREE.Vector3;
  reached: boolean;
  shortfall: number;
  stretch: number;
}

export function createPantographResult(): PantographResult {
  return {
    femur: new THREE.Quaternion(), tibia: new THREE.Quaternion(), meta: new THREE.Quaternion(),
    knee: new THREE.Vector3(), hock: new THREE.Vector3(), paw: new THREE.Vector3(), reached: false, shortfall: 0, stretch: 0,
  };
}

const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _m = new THREE.Vector3();
const _qF = new THREE.Quaternion();
const _qT = new THREE.Quaternion();
const _qM = new THREE.Quaternion();

/**
 * Three-segment digitigrade leg (femur, tibia, metatarsal) with the mammalian pantograph constraint: the metatarsal
 * keeps its bind angle δ to the femur in the bend plane. Writing in-plane vectors as complex numbers,
 *   paw − hip = Lf·e^{iθf} + Lt·e^{iθt} + Lm·e^{i(θf+δ)} = L1·e^{i(θf+γ)} + Lt·e^{iθt},
 *   L1 = |Lf + Lm·e^{iδ}|,  γ = arg(Lf + Lm·e^{iδ})
 * — a two-bone problem with a virtual upper bone of length L1. Lengths and angles are those of the bones projected on
 * the hip–knee–paw plane; the out-of-plane parts sum to zero and ride along unchanged (rotations are about m), so the
 * paw lands exactly on the clamped target.
 */
export function solvePantograph(i: PantographInput, o: PantographResult): PantographResult {
  if (!chainFrame(i.hip, i.knee, i.paw, i.pole, F0)) {
    o.femur.copy(i.femur);
    o.tibia.copy(i.tibia);
    o.meta.copy(i.meta);
    o.knee.copy(i.knee);
    o.hock.copy(i.hock);
    o.paw.copy(i.paw);
    o.reached = false;
    o.shortfall = 0;
    o.stretch = 0;
    return o;
  }
  _f.subVectors(i.knee, i.hip);
  _t.subVectors(i.hock, i.knee);
  _m.subVectors(i.paw, i.hock);
  const Lf = Math.hypot(_f.dot(F0.u), _f.dot(F0.w));
  const Lt = Math.hypot(_t.dot(F0.u), _t.dot(F0.w));
  const Lm = Math.hypot(_m.dot(F0.u), _m.dot(F0.w));
  const thF0 = planeAngle(_f, F0);
  const thT0 = planeAngle(_t, F0);
  const thM0 = planeAngle(_m, F0);
  const delta = thM0 - thF0;
  const cx = Lf + Lm * Math.cos(delta);
  const cy = Lm * Math.sin(delta);
  const L1 = Math.hypot(cx, cy);
  const gamma = Math.atan2(cy, cx);
  const dist = i.target.distanceTo(i.hip);
  const d = clamp(dist, Math.abs(L1 - Lt) + 1e-5, (L1 + Lt) * i.maxReach);
  retargetFrame(F0, i.hip, i.target, i.pole, F1);
  const alpha = Math.acos(clamp((L1 * L1 + d * d - Lt * Lt) / (2 * L1 * d), -1, 1));
  const thF = alpha - gamma;
  const thT = Math.atan2(-L1 * Math.sin(alpha), d - L1 * Math.cos(alpha)); // from the virtual knee to the target
  const thM = thF + delta;
  frameRotation(F0, F1, _R);
  _qF.setFromAxisAngle(F1.m, thF - thF0).multiply(_R);
  _qT.setFromAxisAngle(F1.m, thT - thT0).multiply(_R);
  _qM.setFromAxisAngle(F1.m, thM - thM0).multiply(_R);
  o.knee.copy(_f).applyQuaternion(_qF).add(i.hip);
  o.hock.copy(_t).applyQuaternion(_qT).add(o.knee);
  o.paw.copy(_m).applyQuaternion(_qM).add(o.hock);
  o.femur.copy(_qF).multiply(i.femur);
  o.tibia.copy(_qT).multiply(i.tibia);
  o.meta.copy(_qM).multiply(i.meta);
  o.reached = Math.abs(d - dist) < 1e-6;
  o.shortfall = dist - d;
  o.stretch = dist / ((L1 + Lt) * i.maxReach);
  return o;
}
```
- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- tests/motion/ik.test.ts` → all pass; `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit** — message `feat(motion): analytic two-bone and pantograph leg IK in the bend plane`.

---

### Task 3: Gait engine

**Files:**
- Create: `src/characters/dragon/motion/gait.ts`
- Test: `tests/motion/gait.test.ts`

**Interfaces:**
- Consumes: `clamp`, `fract`, `lerp`, `phaseDiff` (Task 1).
- Produces:
  - Types and constants: `type GaitName = 'walk' | 'trot' | 'gallop'`, `interface GaitParams`, `GAITS`, `interface GaitMods { cadenceScale; strideScale; swingScale }`, `NO_GAIT_MODS`.
  - `class GaitEngine`:
    - constructor `{ hysteresis, blendTime, stopSpeed, maxCadence? }`
    - `setStrideLimit(maxTravel)` — the longest distance a planted paw may travel relative to the body in one stance. The cadence rises above the table value when strides would outreach the legs, up to `maxCadence`; no limit by default.
    - state: `phase`, `active`, `weights`, `offsets` (per leg, LEG_KEYS order LH, LF, RH, RF), `cadence`, `duty`, `swingHeight`, `speed`
    - methods: `reset()`, `update(speed, dt, mods?)`, `legPhase(leg)`, `inStance(leg)`
    - getters: `stanceDuration`, `swingDuration`, `strideLength`, `gallopWeight`, `name`

- [ ] **Step 1: Write the failing tests**

`tests/motion/gait.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GaitEngine, GAITS } from '../../src/characters/dragon/motion/gait';
import { phaseDiff } from '../../src/characters/dragon/motion/math';

const DT = 1 / 120;
const make = () => new GaitEngine({ hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05 });
const hold = (g: GaitEngine, speed: number, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) g.update(speed, DT);
};

describe('GaitEngine', () => {
  it.each([
    [1.0, 'walk'],
    [4.0, 'trot'],
    [8.0, 'gallop'],
  ] as const)('settles at %s m/s into the %s table values', (speed, name) => {
    const g = make();
    hold(g, speed, 3);
    const p = GAITS.find((x) => x.name === name)!;
    expect(g.name).toBe(name);
    expect(g.duty).toBeCloseTo(p.duty, 9);
    expect(g.swingHeight).toBeCloseTo(p.swingHeight, 9);
    for (let leg = 0; leg < 4; leg++) expect(Math.abs(phaseDiff(g.offsets[leg], p.offsets[leg]))).toBeLessThan(1e-9);
    expect(g.strideLength).toBeCloseTo(speed / g.cadence, 9);
  });
  it('maps speed to cadence within each gait range', () => {
    const g = make();
    hold(g, 2.4, 2);
    expect(g.name).toBe('walk');
    expect(g.cadence).toBeCloseTo(1.2, 9);
    hold(g, 5.5, 2);
    expect(g.name).toBe('trot');
    expect(g.cadence).toBeCloseTo(1.8, 9);
  });
  it('holds its gait inside the hysteresis band', () => {
    const g = make();
    hold(g, 4, 1);
    for (let i = 0; i < 240; i++) g.update(i % 2 ? 2.25 : 2.55, DT);
    expect(g.name).toBe('trot');
  });
  it('never jumps a leg phase across a 0 → 10 → 0 m/s ramp', () => {
    const g = make();
    const prev = [0, 0, 0, 0].map((_, leg) => g.legPhase(leg));
    for (let i = 0; i <= 2400; i++) {
      const t = i * DT;
      g.update(10 * (1 - Math.abs(t - 10) / 10), DT);
      for (let leg = 0; leg < 4; leg++) {
        const p = g.legPhase(leg);
        expect(Math.abs(phaseDiff(prev[leg], p))).toBeLessThan(0.06);
        prev[leg] = p;
      }
    }
  });
  it('freezes the phase when stopped', () => {
    const g = make();
    hold(g, 1, 1);
    g.update(0, DT);
    const p = g.phase;
    hold(g, 0, 1);
    expect(g.phase).toBe(p);
    expect(g.cadence).toBe(0);
    expect(g.swingDuration).toBe(Infinity);
  });
  it('raises the cadence so strides fit the legs (stance travel ≤ the stride limit), up to maxCadence', () => {
    const g = new GaitEngine({ hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05, maxCadence: 3 });
    g.setStrideLimit(0.8);
    hold(g, 4, 3);
    expect((g.speed * g.duty) / g.cadence).toBeCloseTo(0.8, 9); // table cadence 1.55 Hz would travel 1.29 m
    hold(g, 10, 3);
    expect(g.cadence).toBeCloseTo(3, 9); // the floor (4.1 Hz) is capped
    hold(g, 1, 3);
    expect(g.cadence).toBeCloseTo(0.8 + 0.4 * (1 / 2.4), 9); // short strides keep the table cadence
  });
  it('applies climbing modifiers (shorter strides → higher cadence, higher swings)', () => {
    const g = make();
    hold(g, 1.5, 2);
    const base = g.cadence;
    g.update(1.5, DT, { cadenceScale: 0.8, strideScale: 0.7, swingScale: 1.5 });
    expect(g.cadence).toBeCloseTo((base * 0.8) / 0.7, 9);
    expect(g.swingHeight).toBeCloseTo(0.12 * 1.5, 9);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/gait.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `gait.ts`**

```ts
import { clamp, fract, lerp, phaseDiff } from './math';

export type GaitName = 'walk' | 'trot' | 'gallop';

export interface GaitParams {
  readonly name: GaitName;
  readonly speedMin: number;
  readonly speedMax: number;
  /** Cadence (strides per second) at speedMin and speedMax. */
  readonly cadenceMin: number;
  readonly cadenceMax: number;
  readonly duty: number;
  /** Touchdown phase of each leg in LEG_KEYS order (LH, LF, RH, RF). */
  readonly offsets: readonly [number, number, number, number];
  readonly swingHeight: number;
}

/** Spec §6.3. */
export const GAITS: readonly GaitParams[] = [
  { name: 'walk', speedMin: 0, speedMax: 2.4, cadenceMin: 0.8, cadenceMax: 1.2, duty: 0.7, offsets: [0, 0.25, 0.5, 0.75], swingHeight: 0.12 },
  { name: 'trot', speedMin: 2.4, speedMax: 5.5, cadenceMin: 1.3, cadenceMax: 1.8, duty: 0.5, offsets: [0, 0.5, 0.5, 0], swingHeight: 0.18 },
  { name: 'gallop', speedMin: 5.5, speedMax: 10, cadenceMin: 1.9, cadenceMax: 2.4, duty: 0.33, offsets: [0, 0.65, 0.1, 0.55], swingHeight: 0.28 },
];

export interface GaitMods {
  cadenceScale: number;
  strideScale: number;
  swingScale: number;
}

export const NO_GAIT_MODS: GaitMods = { cadenceScale: 1, strideScale: 1, swingScale: 1 };

/**
 * One global phase drives all four legs: leg phase = fract(phase − offset[leg]); 0 = touchdown, stance while < duty.
 * Gait parameters crossfade linearly over `blendTime`. Offsets are blended ON THE CIRCLE as a weighted mean of the
 * shortest arcs around the dominant gait's offset. (A weighted unit-vector sum → atan2 sweeps up to ~0.06 phase per
 * step near a 50/50 blend of offsets 162° apart, e.g. RF trot 0 ↔ gallop 0.55; the arc mean moves uniformly with the
 * weights.) The phase freezes below `stopSpeed`.
 */
export class GaitEngine {
  phase = 0;
  active = 0;
  readonly weights: number[] = [1, 0, 0];
  readonly offsets: number[] = [...GAITS[0].offsets];
  cadence = 0;
  duty = GAITS[0].duty;
  swingHeight = GAITS[0].swingHeight;
  speed = 0;

  private maxTravel = Infinity;

  constructor(private readonly opts: { hysteresis: number; blendTime: number; stopSpeed: number; maxCadence?: number }) {}

  /**
   * Longest distance a planted paw may travel relative to the body during one stance (m). The cadence is raised when
   * the table cadence would make strides longer than the legs can reach (speed · duty / cadence ≤ maxTravel), up to
   * opts.maxCadence. Defaults to no limit.
   */
  setStrideLimit(maxTravel: number): void {
    this.maxTravel = maxTravel;
  }

  reset(): void {
    this.phase = 0;
    this.active = 0;
    this.weights.splice(0, 3, 1, 0, 0);
    this.offsets.splice(0, 4, ...GAITS[0].offsets);
    this.cadence = 0;
    this.duty = GAITS[0].duty;
    this.swingHeight = GAITS[0].swingHeight;
    this.speed = 0;
  }

  update(speed: number, dt: number, mods: GaitMods = NO_GAIT_MODS): void {
    this.speed = speed;
    const a = this.active;
    if (a < GAITS.length - 1 && speed > GAITS[a].speedMax + this.opts.hysteresis) this.active = a + 1;
    else if (a > 0 && speed < GAITS[a].speedMin - this.opts.hysteresis) this.active = a - 1;

    const rate = dt / this.opts.blendTime;
    let sum = 0;
    for (let g = 0; g < GAITS.length; g++) {
      const target = g === this.active ? 1 : 0;
      this.weights[g] += clamp(target - this.weights[g], -rate, rate);
      sum += this.weights[g];
    }
    for (let g = 0; g < GAITS.length; g++) this.weights[g] /= sum;

    let cadence = 0;
    let duty = 0;
    let swing = 0;
    for (let g = 0; g < GAITS.length; g++) {
      const w = this.weights[g];
      if (w === 0) continue;
      const p = GAITS[g];
      const k = clamp((speed - p.speedMin) / (p.speedMax - p.speedMin), 0, 1);
      cadence += w * lerp(p.cadenceMin, p.cadenceMax, k);
      duty += w * p.duty;
      swing += w * p.swingHeight;
    }
    let ref = 0;
    for (let g = 1; g < GAITS.length; g++) if (this.weights[g] > this.weights[ref]) ref = g;
    for (let leg = 0; leg < 4; leg++) {
      const base = GAITS[ref].offsets[leg];
      let o = base;
      for (let g = 0; g < GAITS.length; g++) if (g !== ref) o += this.weights[g] * phaseDiff(base, GAITS[g].offsets[leg]);
      this.offsets[leg] = fract(o);
    }
    this.duty = duty;
    this.swingHeight = swing * mods.swingScale;
    let c = (cadence * mods.cadenceScale) / mods.strideScale;
    const floor = (speed * duty) / (this.maxTravel * mods.strideScale);
    if (floor > c) c = Math.min(floor, Math.max(c, this.opts.maxCadence ?? Infinity));
    this.cadence = speed < this.opts.stopSpeed ? 0 : c;
    this.phase = fract(this.phase + this.cadence * dt);
  }

  legPhase(leg: number): number {
    return fract(this.phase - this.offsets[leg]);
  }

  inStance(leg: number): boolean {
    return this.legPhase(leg) < this.duty;
  }

  get stanceDuration(): number {
    return this.cadence > 0 ? this.duty / this.cadence : Infinity;
  }

  get swingDuration(): number {
    return this.cadence > 0 ? (1 - this.duty) / this.cadence : Infinity;
  }

  get strideLength(): number {
    return this.cadence > 0 ? this.speed / this.cadence : 0;
  }

  get gallopWeight(): number {
    return this.weights[2];
  }

  get name(): GaitName {
    return GAITS[this.active].name;
  }
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/motion/gait.test.ts` → pass; typecheck clean.

- [ ] **Step 5: Commit** — `feat(motion): gait engine with hysteresis and circular offset blending`.

---

### Task 4: Collision world

**Files:**
- Create: `src/world/collision.ts`, `tests/fixtures/worlds.ts`
- Test: `tests/world/collision.test.ts`

**Interfaces:**
- Consumes: `three-mesh-bvh` `MeshBVH` (`raycastFirst(ray, side, near, far)`, `closestPointToPoint(point, target, min, max)`).
- Produces:
  - Types: `interface RayHit { point; normal; distance }`, `interface SurfacePoint { point; normal; distance }`, `interface SphereContact { point; normal; depth }`
  - `class CollisionWorld`:
    - construction: `static fromObjects(objects: readonly Object3D[])`, `constructor(geometry)`
    - `raycast(origin, dir, far, out?) → RayHit | null` — normal faces the ray's origin
    - `groundAt(x, z, top, depth, out?) → RayHit | null`
    - `closestPoint(p, maxDist, out?) → SurfacePoint | null` — normal = outward face normal
    - `sphereContact(center, radius, out?) → SphereContact | null`
    - `resolveSphere(center, radius, iterations = 4) → number` (moves `center`, returns the push length)
    - `isInside(p, maxUp = 50) → boolean` — the first surface straight above is seen from behind
    - `sphereCast(from, to, radius) → number` — free fraction in [0, 1]
  - Fixtures (`tests/fixtures/worlds.ts`): `box(...)`, `floor()`, `flatWorld()`, `rampWorld(deg, z0?)`, `wallWorld(h, zWall?)`, `stepWorld(h, z0?)`, `dropWorld(drop, z0?)`.

- [ ] **Step 1: Write the fixtures and the failing tests**

`tests/fixtures/worlds.ts`:
```ts
import * as THREE from 'three';
import { CollisionWorld } from '../../src/world/collision';

export function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.updateMatrixWorld(true);
  return m;
}

/** 40 × 40 m floor whose top is y = 0. */
export const floor = (): THREE.Mesh => box(40, 1, 40, 0, -0.5, 0);

export const flatWorld = (): CollisionWorld => CollisionWorld.fromObjects([floor()]);

/** Ramp of `deg` rising toward +Z from z = z0 (8 m long, 6 m wide, 0.4 m thick) with a plateau on top. */
export function rampWorld(deg: number, z0 = 2): CollisionWorld {
  const a = (deg * Math.PI) / 180;
  const len = 8;
  const t = 0.4;
  const rise = Math.sin(a) * len;
  const run = Math.cos(a) * len;
  const ramp = box(6, t, len, 0, (len / 2) * Math.sin(a) - (t / 2) * Math.cos(a), z0 + (len / 2) * Math.cos(a) + (t / 2) * Math.sin(a), -a);
  const plateau = box(6, rise, 6, 0, rise / 2, z0 + run + 3);
  return CollisionWorld.fromObjects([floor(), ramp, plateau]);
}

/** Wall of height h across X whose near face is at z = zWall − 0.5, with a platform of the same height behind it. */
export function wallWorld(h: number, zWall = 3): CollisionWorld {
  return CollisionWorld.fromObjects([floor(), box(10, h, 1, 0, h / 2, zWall), box(10, h, 8, 0, h / 2, zWall + 4.5)]);
}

/** A raised floor of height h starting at z = z0. */
export function stepWorld(h: number, z0 = 1): CollisionWorld {
  return CollisionWorld.fromObjects([floor(), box(10, h, 20, 0, h / 2, z0 + 10)]);
}

/** Floor at y = 0 for z < z0 and at y = −drop beyond. */
export function dropWorld(drop: number, z0 = 3): CollisionWorld {
  return CollisionWorld.fromObjects([box(40, 1, 20, 0, -0.5, z0 - 10), box(40, 1, 20, 0, -drop - 0.5, z0 + 10)]);
}
```

`tests/world/collision.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flatWorld, rampWorld, wallWorld } from '../fixtures/worlds';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);

describe('CollisionWorld', () => {
  it('casts rays onto the floor with an upward normal', () => {
    const hit = flatWorld().raycast(V(1, 5, 2), DOWN, 10)!;
    expect(hit.point.y).toBeCloseTo(0, 6);
    expect(hit.normal.y).toBeCloseTo(1, 6);
    expect(hit.distance).toBeCloseTo(5, 6);
  });
  it('reports the slope of a ramp', () => {
    const hit = rampWorld(30).groundAt(0, 5, 20, 40)!;
    expect(THREE.MathUtils.radToDeg(Math.acos(hit.normal.y))).toBeCloseTo(30, 2);
  });
  it('misses where there is no ground', () => {
    expect(flatWorld().groundAt(100, 0, 10, 20)).toBeNull();
  });
  it('finds sphere contacts against a wall', () => {
    const c = wallWorld(2).sphereContact(V(0, 1, 2.3), 0.3)!;
    expect(c.depth).toBeCloseTo(0.1, 6);
    expect(c.normal.z).toBeCloseTo(-1, 6);
  });
  it('resolves penetrating spheres, including centres inside the solid', () => {
    const w = wallWorld(2);
    for (const z of [2.3, 2.6]) {
      const c = V(0, 1, z);
      w.resolveSphere(c, 0.3);
      expect(c.z).toBeLessThanOrEqual(2.2 + 1e-4);
      expect(w.sphereContact(c, 0.3)).toBeNull();
    }
  });
  it('knows when a point is inside a solid', () => {
    const w = wallWorld(2);
    expect(w.isInside(V(0, 1, 3))).toBe(true);
    expect(w.isInside(V(0, 1, 1))).toBe(false);
    expect(flatWorld().isInside(V(0, -0.2, 0))).toBe(true);
  });
  it('stops a sphere cast before the wall', () => {
    const w = wallWorld(2);
    const t = w.sphereCast(V(0, 1, 0), V(0, 1, 5), 0.3);
    expect(t * 5).toBeCloseTo(2.2, 1);
    expect(w.sphereCast(V(0, 1, 2.3), V(0, 1, 0), 0.3)).toBe(0);
    expect(w.sphereCast(V(0, 1, 0), V(0, 1, 1), 0.3)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/world` → FAIL (module not found).

- [ ] **Step 3: Implement `src/world/collision.ts`**

```ts
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface RayHit {
  readonly point: THREE.Vector3;
  /** Face normal, flipped to face the ray's origin. */
  readonly normal: THREE.Vector3;
  distance: number;
}

export interface SurfacePoint {
  readonly point: THREE.Vector3;
  /** Outward face normal of the closest triangle. */
  readonly normal: THREE.Vector3;
  distance: number;
}

export interface SphereContact {
  readonly point: THREE.Vector3;
  /** Direction to push the sphere out. */
  readonly normal: THREE.Vector3;
  depth: number;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Static collision geometry: every mesh under the given roots is baked in world space into one BVH (spec §6.14).
 * Instanced meshes are ignored (trees get capsules in the region code).
 */
export class CollisionWorld {
  readonly bvh: MeshBVH;
  private readonly ray = new THREE.Ray();
  private readonly cpTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  private readonly tri = new THREE.Triangle();
  private readonly scratchSurface: SurfacePoint = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private readonly scratchContact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

  static fromObjects(objects: readonly THREE.Object3D[]): CollisionWorld {
    const chunks: Float32Array[] = [];
    let total = 0;
    for (const root of objects) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.geometry?.attributes.position) return;
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        const arr = new Float32Array(g.attributes.position.array as ArrayLike<number>);
        chunks.push(arr);
        total += arr.length;
        g.dispose();
      });
    }
    const pos = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      pos.set(c, off);
      off += c.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new CollisionWorld(geometry);
  }

  constructor(readonly geometry: THREE.BufferGeometry) {
    this.bvh = new MeshBVH(geometry); // builds (and reorders) an index buffer for the triangles
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number, out?: RayHit): RayHit | null {
    this.ray.origin.copy(origin);
    this.ray.direction.copy(dir).normalize();
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, far);
    if (!hit || !hit.face) return null;
    const r = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    r.point.copy(hit.point);
    r.distance = hit.distance;
    r.normal.copy(hit.face.normal);
    if (r.normal.dot(this.ray.direction) > 0) r.normal.negate();
    return r;
  }

  /**
   * True when `p` is inside a solid: the first surface straight above it is seen from behind (its outward face
   * normal points up). Needs outward-wound closed meshes or terrain surfaces (no mirrored transforms).
   */
  isInside(p: THREE.Vector3, maxUp = 50): boolean {
    this.ray.origin.copy(p);
    this.ray.direction.set(0, 1, 0);
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, maxUp);
    return !!hit?.face && hit.face.normal.y > 0;
  }

  /** Ground straight below (x, top, z), searching `depth` metres down. */
  groundAt(x: number, z: number, top: number, depth: number, out?: RayHit): RayHit | null {
    return this.raycast(_o.set(x, top, z), DOWN, depth, out);
  }

  closestPoint(p: THREE.Vector3, maxDist: number, out?: SurfacePoint): SurfacePoint | null {
    const hit = this.bvh.closestPointToPoint(p, this.cpTarget, 0, maxDist);
    if (!hit) return null;
    const r = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    r.point.copy(hit.point);
    r.distance = hit.distance;
    const index = this.geometry.index!.array;
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const f = hit.faceIndex * 3;
    this.tri.a.fromBufferAttribute(pos, index[f]);
    this.tri.b.fromBufferAttribute(pos, index[f + 1]);
    this.tri.c.fromBufferAttribute(pos, index[f + 2]);
    this.tri.getNormal(r.normal);
    return r;
  }

  /** Deepest-point contact of a sphere with the world, or null. Centres behind a face (inside a solid) push out along its normal. */
  sphereContact(center: THREE.Vector3, radius: number, out?: SphereContact): SphereContact | null {
    const s = this.closestPoint(center, radius, this.scratchSurface);
    if (!s) return null;
    const r = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };
    r.point.copy(s.point);
    _v.subVectors(center, s.point);
    const dist = _v.length();
    if (dist < 1e-9 || _v.dot(s.normal) < 0) {
      r.normal.copy(s.normal);
      r.depth = radius + dist;
    } else {
      r.normal.copy(_v).divideScalar(dist);
      r.depth = radius - dist;
    }
    return r.depth > 0 ? r : null;
  }

  /** Push `center` out of the world (a few passes for corners). Returns the total push distance. */
  resolveSphere(center: THREE.Vector3, radius: number, iterations = 4): number {
    let total = 0;
    for (let k = 0; k < iterations; k++) {
      const c = this.sphereContact(center, radius, this.scratchContact);
      if (!c || c.depth < 1e-6) break;
      center.addScaledVector(c.normal, c.depth + 1e-5);
      total += c.depth;
    }
    return total;
  }

  /**
   * Fraction t ∈ [0, 1] of the segment a sphere can travel from `from` toward `to` before touching the world.
   * Samples every radius/2 (no tunnelling through walls thinner than the step), then bisects the first hit.
   */
  sphereCast(from: THREE.Vector3, to: THREE.Vector3, radius: number): number {
    if (this.closestPoint(from, radius, this.scratchSurface)) return 0;
    const len = from.distanceTo(to);
    if (len < 1e-9) return 1;
    const n = Math.max(1, Math.ceil(len / Math.max(radius * 0.5, 0.02)));
    let prev = 0;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (this.closestPoint(_p.lerpVectors(from, to, t), radius, this.scratchSurface)) {
        let lo = prev;
        let hi = t;
        for (let b = 0; b < 10; b++) {
          const mid = (lo + hi) / 2;
          if (this.closestPoint(_p.lerpVectors(from, to, mid), radius, this.scratchSurface)) hi = mid;
          else lo = mid;
        }
        return lo;
      }
      prev = t;
    }
    return 1;
  }
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/world` → pass; typecheck clean. (If `this.geometry.index` is null after construction in the installed three-mesh-bvh, call `geometry.setIndex([...Array(pos.count).keys()])` before building the BVH and note it in the report.)

- [ ] **Step 5: Commit** — `feat(world): BVH collision world — rays, ground, closest point, sphere contact/resolve/cast`.

---

### Task 5: Rig types, fixture rig and `RigSkeleton`

**Files:**
- Create: `src/characters/dragon/motion/rigTypes.ts`, `src/characters/dragon/motion/skeleton.ts`, `tests/fixtures/toothlessRig.ts`
- Test: `tests/motion/skeleton.test.ts`

**Interfaces:**
- Consumes: `isFiniteQuat`, `isFiniteVec3` (Task 1).
- Produces: `type Vec3`, `type LimbKey`, `LEG_KEYS` (LH, LF, RH, RF — the gait order), `isFrontLeg(key)`, `interface MotionRig`. `MotionRig` is structurally a subset of Plan 2's `RigMeta`, so a validated `RigMeta` can be passed wherever a `MotionRig` is expected.
- Produces `class RigSkeleton`:
  - constructor `(rig: MotionRig)`
  - arrays and tables: `count`, `names`, `parent`, `length`, `bindLocalPos/Quat`, `bindWorldPos/Quat`, `localPos/Quat`, `worldPos/Quat`, `prevLocalPos/Quat`
  - `id(name)`, `has(name)`, `resetToBind()`, `fk()`
  - `tail(i, out)`, `toWorld(i, local, out)`, `bindToLocal(i, bindPoint, out)`, `setWorldQuat(i, q)`
  - `snapshot()`, `restorePrev()`, `angleFromBind(i)`, `isFinite()`
  - `writeTo(bones: ReadonlyMap<string, THREE.Object3D>, alpha = 1)`
- Produces `toothlessFixtureRig(): MotionRig` (tests only). It is generated from `docs/superpowers/prototypes/toothless/anatomy.py` and Plan 2 Task 2's metadata, with the joint limits this plan requires (`LIMB_LIMITS` below).
- Bone frames: world bind frame = basis(X = `xAxis` orthonormalised, Y = normalize(tail − head), Z = X × Y) at `head`. A bone's tail is at local (0, length, 0).

- [ ] **Step 1: Rig types**

`src/characters/dragon/motion/rigTypes.ts`:
```ts
export type Vec3 = [number, number, number];
export type LimbKey = 'front_L' | 'front_R' | 'hind_L' | 'hind_R';

/** Leg order used everywhere in motion code — the spec §6.3 gait-offset order (LH, LF, RH, RF). */
export const LEG_KEYS: readonly LimbKey[] = ['hind_L', 'front_L', 'hind_R', 'front_R'];

export function isFrontLeg(key: LimbKey): boolean {
  return key === 'front_L' || key === 'front_R';
}

/**
 * The anatomy the motion system reads (spec §5.10) — a structural subset of Plan 2's RigMeta, glTF/three space
 * (+Y up, dragon faces +Z, its left is +X). limitsDeg = [lo, hi] rotation about the bone's xAxis (right-hand rule)
 * relative to bind, degrees.
 */
export interface MotionRig {
  bones: ReadonlyArray<{ name: string; parent: string | null; head: Vec3; tail: Vec3; xAxis: Vec3 }>;
  chains: { spine: string[]; neck: string[]; tail: string[] };
  limbs: Record<LimbKey, { bones: string[]; pole: Vec3; limitsDeg: Record<string, [number, number]> }>;
  contacts: Record<LimbKey, { bone: string; sole: Vec3; toe: Vec3; heel: Vec3 }>;
  proxies: ReadonlyArray<{ name: string; bone: string; center: Vec3; radius: number }>;
  anchors: Record<string, { bone: string; position: Vec3 }>;
  chainLimitsDeg: Record<'spine' | 'neck' | 'tail', { pitch: number; yaw: number; roll: number }>;
  wings: Record<'L' | 'R', { humerus: string; forearm: string; thumb: string; ribs: [string, string][]; hipRibs: string[]; finRibs: string[] }>;
  ears: Record<'L' | 'R', string[]>;
  proportions: { length: number; wingspan: number; shoulderHeight: number; hipHeight: number; headTop: number };
}
```

- [ ] **Step 2: Fixture rig**

`tests/fixtures/toothlessRig.ts` (a TypeScript port of `anatomy.bone_specs()` plus the Plan 2 metadata; the roll rule reproduces Blender's `align_roll`):
```ts
import type { LimbKey, MotionRig, Vec3 } from '../../src/characters/dragon/motion/rigTypes';

type V = [number, number, number];
const v = (x: number, y: number, z: number): V => [x, y, z];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
const mirror = (p: V): V => [-p[0], p[1], p[2]];
/** Blender (X = left, −Y = forward, Z = up) → glTF/three (x, z, −y). */
const G = (p: V): Vec3 => [p[0], p[2], -p[1]];
const rad = (d: number) => (d * Math.PI) / 180;
const pad = (n: number) => String(n).padStart(2, '0');

// ---- anatomy.py, Blender space ----
const HO = v(0, 0.04, -0.14);
const SPINE: Array<[string, V]> = [['pelvis', v(0, 0.62, 1.02)], ['spine_01', v(0, 0.3, 1.06)], ['spine_02', v(0, 0, 1.1)], ['spine_03', v(0, -0.3, 1.14)], ['chest', v(0, -0.58, 1.18)], ['', v(0, -0.86, 1.23)]];
const NECK: Array<[string, V]> = [['neck_01', v(0, -0.86, 1.23)], ['neck_02', v(0, -1.03, 1.3)], ['neck_03', v(0, -1.21, 1.39)], ['neck_04', v(0, -1.36, 1.46)], ['', v(0, -1.5, 1.5)]];
const HEAD: [V, V] = [v(0, -1.5, 1.5), v(0, -2.24, 1.45)];
const JAW: [V, V] = [v(0, -1.7, 1.345), v(0, -2.16, 1.3)];
const TAIL_PTS: V[] = [v(0, 0.88, 1.03), v(0, 1.2, 1.0), v(0, 1.54, 0.97), v(0, 1.9, 0.93), v(0, 2.28, 0.88), v(0, 2.66, 0.83), v(0, 3.03, 0.78), v(0, 3.38, 0.73), v(0, 3.72, 0.68), v(0, 4.04, 0.63), v(0, 4.34, 0.58), v(0, 4.63, 0.53), v(0, 4.92, 0.48)];
const FRONT = { scapula: v(0.2, -0.5, 1.28), shoulder: v(0.31, -0.74, 0.95), elbow: v(0.34, -0.6, 0.56), wrist: v(0.34, -0.74, 0.17), paw: v(0.34, -0.84, 0.07), toe: v(0.34, -1.0, 0.04) };
const HIND = { hip: v(0.29, 0.62, 0.97), knee: v(0.34, 0.36, 0.6), hock: v(0.33, 0.74, 0.3), paw: v(0.33, 0.6, 0.07), toe: v(0.33, 0.44, 0.04) };
/** name, root, length, pitch, yaw, roll (degrees; yaw/roll mirror with side) */
const EARS: Array<[string, V, number, number, number, number]> = [
  ['ear_1', add(v(0.125, -1.62, 1.87), HO), 0.34, 62, -14, -12],
  ['ear_2', add(v(0.25, -1.62, 1.77), HO), 0.2, 30, -40, -30],
  ['ear_3', add(v(0.315, -1.7, 1.61), HO), 0.13, 10, -68, -45],
];
const MAIN_WING = { root: v(0.26, -0.72, 1.42), elbow: v(1.05, -0.45, 1.55), hub: v(2.05, -0.62, 1.62), angles: [-6, 10, 26, 42, 58, 75, 94], lengths: [4.75, 4.2, 3.6, 3.05, 2.6, 2.2, 1.9] };
const HIP_WING = { hub: v(0.16, 1.45, 1.13), angles: [4, 30, 56, 82], lengths: [1.45, 1.3, 1.1, 0.85] };
const TAIL_FIN = { hub: v(0.04, 3.8, 0.69), angles: [48, 62, 76], lengths: [0.85, 1.05, 1.18] };
const SADDLE_SEAT = v(0, -0.36, 1.46);
const PEDAL_L = v(0.38, -0.28, 1.02);

/**
 * Joint limits this plan requires (right-hand rule about the exported xAxis; + flexes the radius, tibia and
 * metatarsal). The distal joints need wide ranges because the paws stay flat on the ground while the leg swings over
 * them (metacarpal/toes compensate the whole swing). Plan 2's anatomy.LIMBS must carry the same values — Task 9's
 * rig-sanity test checks the export.
 */
export const LIMB_LIMITS: Record<'front' | 'hind', Record<string, [number, number]>> = {
  front: { front_scapula: [-25, 25], front_humerus: [-70, 60], front_radius: [-35, 120], front_metacarpal: [-90, 90], front_toes: [-80, 80] },
  hind: { hind_femur: [-70, 75], hind_tibia: [-55, 70], hind_metatarsal: [-45, 110], hind_toes: [-80, 80] },
};

function fanTips(hub: V, angles: number[], lengths: number[], side: number, droop: boolean): V[] {
  return angles.map((a, i) => {
    const t = add(hub, v(Math.cos(rad(a)) * lengths[i], Math.sin(rad(a)) * lengths[i], droop ? -0.06 - 0.01 * i : 0));
    return side < 0 ? mirror(t) : t;
  });
}

/** anatomy.ear_axis: tail = root + Rz(yaw)·Ry(roll)·Rx(pitch)·(0, length, 0), yaw/roll mirrored by side. */
function earAxis(root: V, length: number, pitch: number, yaw: number, roll: number, side: number): [V, V] {
  const r = v(root[0] * side, root[1], root[2]);
  const rx = rad(pitch);
  const ry = rad(roll * side);
  const rz = rad(yaw * side);
  let p: V = v(0, length, 0);
  p = v(p[0], p[1] * Math.cos(rx) - p[2] * Math.sin(rx), p[1] * Math.sin(rx) + p[2] * Math.cos(rx));
  p = v(p[0] * Math.cos(ry) + p[2] * Math.sin(ry), p[1], -p[0] * Math.sin(ry) + p[2] * Math.cos(ry));
  p = v(p[0] * Math.cos(rz) - p[1] * Math.sin(rz), p[0] * Math.sin(rz) + p[1] * Math.cos(rz), p[2]);
  return [r, add(r, p)];
}

/** Blender align_roll: local Z as close as possible to world up (Blender −Y for near-vertical bones); X = Y × Z. */
function xAxisOf(head: V, tail: V): V {
  const d = unit(sub(tail, head));
  const up = Math.abs(d[2]) < 0.9 ? v(0, 0, 1) : v(0, -1, 0);
  const z = unit(sub(up, scale(d, dot(up, d))));
  return cross(d, z);
}

type Spec = [string, V, V, string | null];

function boneSpecs(): Spec[] {
  const b: Spec[] = [];
  for (let i = 0; i < SPINE.length - 1; i++) b.push([SPINE[i][0], SPINE[i][1], SPINE[i + 1][1], i > 0 ? SPINE[i - 1][0] : null]);
  for (let i = 0; i < NECK.length - 1; i++) b.push([NECK[i][0], NECK[i][1], NECK[i + 1][1], i === 0 ? 'chest' : NECK[i - 1][0]]);
  b.push(['head', HEAD[0], HEAD[1], 'neck_04'], ['jaw', JAW[0], JAW[1], 'head']);
  for (let i = 0; i < TAIL_PTS.length - 1; i++) b.push([`tail_${pad(i + 1)}`, TAIL_PTS[i], TAIL_PTS[i + 1], i === 0 ? 'pelvis' : `tail_${pad(i)}`]);
  for (const [side, s] of [[1, 'L'], [-1, 'R']] as const) {
    const m = (p: V): V => (side > 0 ? p : mirror(p));
    const f = { sc: m(FRONT.scapula), sh: m(FRONT.shoulder), el: m(FRONT.elbow), wr: m(FRONT.wrist), pw: m(FRONT.paw), to: m(FRONT.toe) };
    b.push(
      [`front_scapula_${s}`, f.sc, f.sh, 'chest'], [`front_humerus_${s}`, f.sh, f.el, `front_scapula_${s}`],
      [`front_radius_${s}`, f.el, f.wr, `front_humerus_${s}`], [`front_metacarpal_${s}`, f.wr, f.pw, `front_radius_${s}`],
      [`front_toes_${s}`, f.pw, f.to, `front_metacarpal_${s}`],
    );
    const h = { hip: m(HIND.hip), kn: m(HIND.knee), hk: m(HIND.hock), pw: m(HIND.paw), to: m(HIND.toe) };
    b.push(
      [`hind_femur_${s}`, h.hip, h.kn, 'pelvis'], [`hind_tibia_${s}`, h.kn, h.hk, `hind_femur_${s}`],
      [`hind_metatarsal_${s}`, h.hk, h.pw, `hind_tibia_${s}`], [`hind_toes_${s}`, h.pw, h.to, `hind_metatarsal_${s}`],
    );
    for (const [name, root, len, pitch, yaw, roll] of EARS) {
      const [head, tail] = earAxis(root, len, pitch, yaw, roll, side);
      b.push([`${name}_${s}`, head, tail, 'head']);
    }
    const root = m(MAIN_WING.root);
    const elbow = m(MAIN_WING.elbow);
    const hub = m(MAIN_WING.hub);
    b.push([`wing_humerus_${s}`, root, elbow, 'chest'], [`wing_forearm_${s}`, elbow, hub, `wing_humerus_${s}`],
      [`wing_thumb_${s}`, hub, add(hub, v(side * 0.05, -0.16, 0.02)), `wing_forearm_${s}`]);
    fanTips(MAIN_WING.hub, MAIN_WING.angles, MAIN_WING.lengths, side, true).forEach((tip, i) => {
      const mid = add(hub, scale(sub(tip, hub), 0.5));
      b.push([`wing_rib${i + 1}_a_${s}`, hub, mid, `wing_forearm_${s}`], [`wing_rib${i + 1}_b_${s}`, mid, tip, `wing_rib${i + 1}_a_${s}`]);
    });
    const hh = m(HIP_WING.hub);
    b.push([`hipwing_root_${s}`, sub(hh, v(side * 0.06, 0, 0)), hh, 'tail_02']);
    fanTips(HIP_WING.hub, HIP_WING.angles, HIP_WING.lengths, side, false).forEach((tip, i) => b.push([`hipwing_rib${i + 1}_${s}`, hh, tip, `hipwing_root_${s}`]));
    const th = m(TAIL_FIN.hub);
    b.push([`tailfin_root_${s}`, sub(th, v(side * 0.03, 0.05, 0)), th, 'tail_09']);
    fanTips(TAIL_FIN.hub, TAIL_FIN.angles, TAIL_FIN.lengths, side, false).forEach((tip, i) => b.push([`tailfin_rib${i + 1}_${s}`, th, tip, `tailfin_root_${s}`]));
  }
  b.push(['saddle', SADDLE_SEAT, add(SADDLE_SEAT, v(0, -0.25, 0.02)), 'spine_03'], ['pedal_L', PEDAL_L, add(PEDAL_L, v(0, -0.14, 0)), 'saddle']);
  return b;
}

export function toothlessFixtureRig(): MotionRig {
  const bones = boneSpecs().map(([name, head, tail, parent]) => ({ name, parent, head: G(head), tail: G(tail), xAxis: G(xAxisOf(head, tail)) }));
  const limb = (kind: 'front' | 'hind', side: 'L' | 'R') => ({
    bones: Object.keys(LIMB_LIMITS[kind]).map((n) => `${n}_${side}`),
    pole: kind === 'front' ? G(v(0, 1, 0)) : G(v(0, -1, 0)),
    limitsDeg: Object.fromEntries(Object.entries(LIMB_LIMITS[kind]).map(([n, l]) => [`${n}_${side}`, l])) as Record<string, [number, number]>,
  });
  const contact = (kind: 'front' | 'hind', side: 'L' | 'R') => {
    const k = side === 'L' ? (p: V) => G(p) : (p: V) => G(mirror(p));
    return kind === 'front'
      ? { bone: `front_toes_${side}`, sole: k(v(0.34, -0.86, 0)), toe: k(v(0.34, -1.05, 0)), heel: k(v(0.34, -0.68, 0.03)) }
      : { bone: `hind_toes_${side}`, sole: k(v(0.33, 0.58, 0)), toe: k(v(0.33, 0.38, 0)), heel: k(v(0.33, 0.76, 0.03)) };
  };
  const limbs = {} as MotionRig['limbs'];
  const contacts = {} as MotionRig['contacts'];
  for (const key of ['front_L', 'front_R', 'hind_L', 'hind_R'] as LimbKey[]) {
    const [kind, side] = key.split('_') as ['front' | 'hind', 'L' | 'R'];
    limbs[key] = limb(kind, side);
    contacts[key] = contact(kind, side);
  }
  const eye = add(v(0.2, -2.0, 1.735), HO);
  const proxy = (name: string, bone: string, c: V, radius: number) => ({ name, bone, center: G(c), radius });
  const wing = (s: 'L' | 'R') => ({
    humerus: `wing_humerus_${s}`, forearm: `wing_forearm_${s}`, thumb: `wing_thumb_${s}`,
    ribs: [1, 2, 3, 4, 5, 6, 7].map((i) => [`wing_rib${i}_a_${s}`, `wing_rib${i}_b_${s}`] as [string, string]),
    hipRibs: [1, 2, 3, 4].map((i) => `hipwing_rib${i}_${s}`),
    finRibs: [1, 2, 3].map((i) => `tailfin_rib${i}_${s}`),
  });
  return {
    bones,
    chains: {
      spine: ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'chest'],
      neck: ['neck_01', 'neck_02', 'neck_03', 'neck_04', 'head'],
      tail: Array.from({ length: 12 }, (_, i) => `tail_${pad(i + 1)}`),
    },
    limbs,
    contacts,
    proxies: [
      proxy('head', 'head', v(0, -1.72, 1.58), 0.33), proxy('muzzle', 'head', v(0, -2.02, 1.47), 0.2),
      proxy('neck', 'neck_02', v(0, -1.1, 1.33), 0.3), proxy('chest', 'chest', v(0, -0.62, 1.0), 0.44),
      proxy('belly', 'spine_02', v(0, 0, 1.04), 0.32), proxy('hips', 'pelvis', v(0, 0.6, 1.02), 0.36),
      proxy('tail_a', 'tail_03', v(0, 1.72, 0.95), 0.2), proxy('tail_b', 'tail_06', v(0, 2.85, 0.8), 0.13),
      proxy('tail_c', 'tail_09', v(0, 3.88, 0.66), 0.08), proxy('tail_d', 'tail_12', v(0, 4.8, 0.5), 0.045),
    ],
    anchors: {
      eye_L: { bone: 'head', position: G(eye) }, eye_R: { bone: 'head', position: G(mirror(eye)) },
      mouth: { bone: 'head', position: G(v(0, -2.2, 1.375)) },
      saddle: { bone: 'saddle', position: G(add(SADDLE_SEAT, v(0, 0, 0.06))) }, pedal_L: { bone: 'pedal_L', position: G(PEDAL_L) },
    },
    chainLimitsDeg: { spine: { pitch: 15, yaw: 12, roll: 8 }, neck: { pitch: 35, yaw: 40, roll: 15 }, tail: { pitch: 25, yaw: 30, roll: 10 } },
    wings: { L: wing('L'), R: wing('R') },
    ears: { L: ['ear_1_L', 'ear_2_L', 'ear_3_L'], R: ['ear_1_R', 'ear_2_R', 'ear_3_R'] },
    proportions: { length: 7.18, wingspan: 13.548, shoulderHeight: 1.28, hipHeight: 0.97, headTop: 1.815 },
  };
}
```

- [ ] **Step 3: Write the failing skeleton tests**

`tests/motion/skeleton.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const RIG_JSON = 'public/assets/characters/toothless/toothless.rig.json';
const GLB = 'public/assets/characters/toothless/toothless.glb';

interface GltfNode { name?: string; rotation?: number[]; translation?: number[] }
function readGlbNodes(path: string): GltfNode[] {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return (JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { nodes: GltfNode[] }).nodes;
}

/** three.js bones built from the skeleton's bind locals — what GLTFLoader builds from the GLB. */
function threeBones(s: RigSkeleton): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>();
  for (let i = 0; i < s.count; i++) {
    const b = new THREE.Bone();
    b.name = s.names[i];
    b.position.copy(s.bindLocalPos[i]);
    b.quaternion.copy(s.bindLocalQuat[i]);
    bones.set(b.name, b);
    if (s.parent[i] >= 0) bones.get(s.names[s.parent[i]])!.add(b);
  }
  return bones;
}

describe('RigSkeleton (fixture rig)', () => {
  const rig = toothlessFixtureRig();
  it('orders 101 bones parents-first', () => {
    const s = new RigSkeleton(rig);
    expect(s.count).toBe(101);
    for (let i = 0; i < s.count; i++) expect(s.parent[i]).toBeLessThan(i);
  });
  it('reproduces every bone head, tail and hinge axis at bind', () => {
    const s = new RigSkeleton(rig);
    s.resetToBind();
    s.fk();
    const x = new THREE.Vector3();
    for (const b of rig.bones) {
      const i = s.id(b.name);
      expect(s.worldPos[i].distanceTo(new THREE.Vector3(...b.head))).toBeLessThan(1e-9);
      expect(s.tail(i, new THREE.Vector3()).distanceTo(new THREE.Vector3(...b.tail))).toBeLessThan(1e-9);
      x.set(1, 0, 0).applyQuaternion(s.worldQuat[i]);
      expect(x.dot(new THREE.Vector3(...b.xAxis).normalize())).toBeGreaterThan(1 - 1e-9);
    }
  });
  it('recomputes poses absolutely — 1000 steps equal one', () => {
    const s = new RigSkeleton(rig);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    const i = s.id('tail_05');
    for (let step = 0; step < 1000; step++) {
      s.resetToBind();
      s.localQuat[i].multiply(q);
    }
    s.fk();
    const many = s.worldQuat[i].clone();
    s.resetToBind();
    s.localQuat[i].multiply(q);
    s.fk();
    expect(Math.abs(many.dot(s.worldQuat[i]))).toBeCloseTo(1, 12);
  });
  it('sets local rotations from desired world rotations', () => {
    const s = new RigSkeleton(rig);
    s.resetToBind();
    s.fk();
    const i = s.id('hind_tibia_L');
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.2, 0.5));
    s.setWorldQuat(i, want);
    s.fk();
    expect(Math.abs(s.worldQuat[i].dot(want))).toBeCloseTo(1, 12);
  });
  it('matches three.js Object3D forward kinematics and interpolates when writing', () => {
    const s = new RigSkeleton(rig);
    const bones = threeBones(s);
    s.resetToBind();
    s.snapshot();
    const i = s.id('neck_02');
    s.localQuat[i].multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6));
    s.localPos[s.id('pelvis')].x += 1;
    s.fk();
    s.writeTo(bones, 1);
    bones.get('pelvis')!.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (let k = 0; k < s.count; k++) expect(bones.get(s.names[k])!.getWorldPosition(p).distanceTo(s.worldPos[k])).toBeLessThan(1e-9);
    s.writeTo(bones, 0.5);
    const mid = new THREE.Quaternion().slerpQuaternions(s.prevLocalQuat[i], s.localQuat[i], 0.5);
    expect(Math.abs(bones.get('neck_02')!.quaternion.dot(mid))).toBeCloseTo(1, 12);
    expect(bones.get('pelvis')!.position.x).toBeCloseTo(s.prevLocalPos[s.id('pelvis')].x + 0.5, 12);
  });
  it('detects non-finite poses and restores the previous one', () => {
    const s = new RigSkeleton(rig);
    s.resetToBind();
    s.snapshot();
    s.localQuat[3].x = Number.NaN;
    expect(s.isFinite()).toBe(false);
    s.restorePrev();
    expect(s.isFinite()).toBe(true);
  });
});

describe.skipIf(!existsSync(RIG_JSON) || !existsSync(GLB))('exported Toothless asset (Plan 2)', () => {
  it('bind locals match the GLB bone nodes — the axis-convention guard', () => {
    const s = new RigSkeleton(JSON.parse(readFileSync(RIG_JSON, 'utf8')) as MotionRig);
    const nodes = new Map(readGlbNodes(GLB).filter((n) => n.name).map((n) => [n.name!, n]));
    for (let i = 0; i < s.count; i++) {
      const n = nodes.get(s.names[i]);
      expect(n, s.names[i]).toBeTruthy();
      const q = new THREE.Quaternion().fromArray(n!.rotation ?? [0, 0, 0, 1]);
      const t = new THREE.Vector3().fromArray(n!.translation ?? [0, 0, 0]);
      expect(Math.abs(q.dot(s.bindLocalQuat[i])), s.names[i]).toBeGreaterThan(1 - 1e-4);
      expect(t.distanceTo(s.bindLocalPos[i]), s.names[i]).toBeLessThan(1e-4);
    }
  });
  it('agrees with the fixture rig (keeps the fixture honest)', () => {
    const exported = JSON.parse(readFileSync(RIG_JSON, 'utf8')) as MotionRig;
    const fixture = new Map(toothlessFixtureRig().bones.map((b) => [b.name, b]));
    for (const b of exported.bones) {
      const f = fixture.get(b.name);
      expect(f, b.name).toBeTruthy();
      for (let k = 0; k < 3; k++) {
        expect(b.head[k]).toBeCloseTo(f!.head[k], 4);
        expect(b.tail[k]).toBeCloseTo(f!.tail[k], 4);
        expect(b.xAxis[k]).toBeCloseTo(f!.xAxis[k], 3);
      }
    }
  });
});
```

- [ ] **Step 4: Run to verify they fail** — `npm test -- tests/motion/skeleton.test.ts` → FAIL (module not found).

- [ ] **Step 5: Implement `skeleton.ts`**

```ts
import * as THREE from 'three';
import type { MotionRig } from './rigTypes';
import { isFiniteQuat, isFiniteVec3 } from './math';

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

type RigBone = MotionRig['bones'][number];

/**
 * The dragon's skeleton, built from rig metadata alone (spec §5.5: the engine never guesses bone axes).
 * World == skeleton space (the asset root stays at the origin); the root bone carries the world transform.
 * The pose is rewritten ABSOLUTELY every step (resetToBind → layers → fk), never accumulated (spec §3.4).
 */
export class RigSkeleton {
  readonly count: number;
  readonly names: readonly string[];
  readonly parent: Int16Array;
  readonly length: Float64Array;
  readonly bindLocalPos: THREE.Vector3[] = [];
  readonly bindLocalQuat: THREE.Quaternion[] = [];
  readonly bindWorldPos: THREE.Vector3[] = [];
  readonly bindWorldQuat: THREE.Quaternion[] = [];
  readonly localPos: THREE.Vector3[] = [];
  readonly localQuat: THREE.Quaternion[] = [];
  readonly worldPos: THREE.Vector3[] = [];
  readonly worldQuat: THREE.Quaternion[] = [];
  readonly prevLocalPos: THREE.Vector3[] = [];
  readonly prevLocalQuat: THREE.Quaternion[] = [];
  private readonly index = new Map<string, number>();

  constructor(rig: MotionRig) {
    const byName = new Map(rig.bones.map((b) => [b.name, b]));
    const ordered: RigBone[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (name: string): void => {
      const st = state.get(name);
      if (st === 2) return;
      if (st === 1) throw new Error(`RigSkeleton: parent cycle at '${name}'`);
      const b = byName.get(name);
      if (!b) throw new Error(`RigSkeleton: unknown bone '${name}'`);
      state.set(name, 1);
      if (b.parent) visit(b.parent);
      state.set(name, 2);
      ordered.push(b);
    };
    for (const b of rig.bones) visit(b.name);

    this.count = ordered.length;
    this.names = ordered.map((b) => b.name);
    ordered.forEach((b, i) => this.index.set(b.name, i));
    this.parent = new Int16Array(this.count);
    this.length = new Float64Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const b = ordered[i];
      const head = new THREE.Vector3(...b.head);
      _y.set(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
      this.length[i] = _y.length();
      _y.normalize();
      _x.set(...b.xAxis);
      _x.addScaledVector(_y, -_x.dot(_y)).normalize();
      _z.crossVectors(_x, _y);
      const wq = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
      this.bindWorldQuat.push(wq);
      this.bindWorldPos.push(head);
      const p = b.parent ? this.index.get(b.parent)! : -1;
      this.parent[i] = p;
      if (p < 0) {
        this.bindLocalQuat.push(wq.clone());
        this.bindLocalPos.push(head.clone());
      } else {
        const inv = _q.copy(this.bindWorldQuat[p]).invert();
        this.bindLocalQuat.push(inv.clone().multiply(wq));
        this.bindLocalPos.push(head.clone().sub(this.bindWorldPos[p]).applyQuaternion(inv));
      }
      this.localQuat.push(this.bindLocalQuat[i].clone());
      this.localPos.push(this.bindLocalPos[i].clone());
      this.prevLocalQuat.push(this.bindLocalQuat[i].clone());
      this.prevLocalPos.push(this.bindLocalPos[i].clone());
      this.worldQuat.push(wq.clone());
      this.worldPos.push(head.clone());
    }
  }

  id(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`RigSkeleton: no bone '${name}'`);
    return i;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  resetToBind(): void {
    for (let i = 0; i < this.count; i++) {
      this.localQuat[i].copy(this.bindLocalQuat[i]);
      this.localPos[i].copy(this.bindLocalPos[i]);
    }
  }

  /** World transforms from local ones, parents first. */
  fk(): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.parent[i];
      if (p < 0) {
        this.worldQuat[i].copy(this.localQuat[i]);
        this.worldPos[i].copy(this.localPos[i]);
      } else {
        this.worldQuat[i].multiplyQuaternions(this.worldQuat[p], this.localQuat[i]);
        this.worldPos[i].copy(this.localPos[i]).applyQuaternion(this.worldQuat[p]).add(this.worldPos[p]);
      }
    }
  }

  tail(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, this.length[i], 0).applyQuaternion(this.worldQuat[i]).add(this.worldPos[i]);
  }

  /** A point given in bone i's local frame → world (current pose). */
  toWorld(i: number, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyQuaternion(this.worldQuat[i]).add(this.worldPos[i]);
  }

  /** A bind-pose world point → bone i's local frame. */
  bindToLocal(i: number, bindPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.subVectors(bindPoint, this.bindWorldPos[i]).applyQuaternion(_q.copy(this.bindWorldQuat[i]).invert());
  }

  /** Give bone i the world rotation q (its parent's world rotation must be current). Children need fk() afterwards. */
  setWorldQuat(i: number, q: THREE.Quaternion): void {
    const p = this.parent[i];
    if (p < 0) this.localQuat[i].copy(q);
    else this.localQuat[i].copy(this.worldQuat[p]).invert().multiply(q);
    this.worldQuat[i].copy(q);
  }

  /** Remember this step's starting pose (render interpolation, NaN recovery). */
  snapshot(): void {
    for (let i = 0; i < this.count; i++) {
      this.prevLocalQuat[i].copy(this.localQuat[i]);
      this.prevLocalPos[i].copy(this.localPos[i]);
    }
  }

  restorePrev(): void {
    for (let i = 0; i < this.count; i++) {
      this.localQuat[i].copy(this.prevLocalQuat[i]);
      this.localPos[i].copy(this.prevLocalPos[i]);
    }
    this.fk();
  }

  /** Rotation angle of bone i's local rotation away from bind (rad). */
  angleFromBind(i: number): number {
    return 2 * Math.acos(Math.min(1, Math.abs(this.localQuat[i].dot(this.bindLocalQuat[i]))));
  }

  isFinite(): boolean {
    for (let i = 0; i < this.count; i++) {
      if (!isFiniteQuat(this.localQuat[i]) || !isFiniteVec3(this.localPos[i])) return false;
    }
    return true;
  }

  /** Copy the pose onto three.js bones, interpolating from the previous step by alpha (spec §3.4). */
  writeTo(bones: ReadonlyMap<string, THREE.Object3D>, alpha = 1): void {
    for (let i = 0; i < this.count; i++) {
      const b = bones.get(this.names[i]);
      if (!b) continue;
      b.quaternion.slerpQuaternions(this.prevLocalQuat[i], this.localQuat[i], alpha);
      if (this.parent[i] < 0) b.position.lerpVectors(this.prevLocalPos[i], this.localPos[i], alpha);
    }
  }
}
```

- [ ] **Step 6: Run to verify they pass** — `npm test -- tests/motion/skeleton.test.ts` → the fixture suite passes; the exported-asset suite is skipped (or passes, if Plan 2 has exported). Typecheck clean.

- [ ] **Step 7: Commit** — `feat(motion): MotionRig types, fixture rig and RigSkeleton (bind frames from metadata, absolute pose, FK, writer)`.

---

### Task 6: Tuning, controller, kinematics and body proxies

**Files:**
- Create: `src/characters/dragon/motion/tuning.ts`, `src/characters/dragon/motion/controller.ts`, `src/characters/dragon/motion/proxies.ts`
- Test: `tests/motion/tuning.test.ts`, `tests/motion/controller.test.ts`, `tests/motion/proxies.test.ts`

**Interfaces:**
- Consumes: `InputState` (Plan 1 `src/core/input.ts`), math (Task 1), `CollisionWorld`/fixtures (Task 4), `RigSkeleton`/`MotionRig`/fixture rig (Task 5).
- Produces:
  - `interface MotionTuning` (sections below, every later task reads it), `DEFAULT_TUNING`, `type DeepPartial<T>`, `mergeTuning(base, patch)`, `loadTuning(url)`, `TUNING_URL = 'assets/characters/toothless/motion-tuning.json'`
  - `interface MoveIntent { dirX; dirZ; hasDir; speed; gallop; prowl; jump; plasma }`, `createIntent()`, `class DragonController { prowl; read(input, cameraYaw, tuning.controller, out) }`
  - `class BodyKinematics { pos; heading; speed; yawRate; accel; velocity; delta; spawn(x, y, z, heading); plan(intent, dt, tuning.controller, speedCap?); commit(delta, dt) }`
  - `BODY_PROXY_NAMES`, `class BodyProxies { items; centers; blocked; wallNormal; update(skeleton); resolveMove(world, delta, maxNormalY = 0.64) }`
  - The slide reacts to **wall-like** contacts only (|normal.y| < maxNormalY); floors and ceilings belong to the body solver. Each push is capped at the proxy's radius. Pushing along the horizontal part of a nearly-horizontal face (e.g. the underside of a ramp slab) would otherwise amplify a deep penetration into a teleport.

- [ ] **Step 1: Write the failing tests**

`tests/motion/tuning.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_TUNING, mergeTuning } from '../../src/characters/dragon/motion/tuning';

describe('tuning', () => {
  it('carries the spec defaults', () => {
    const c = DEFAULT_TUNING.controller;
    expect([c.trotSpeed, c.prowlSpeed, c.gallopSpeed]).toEqual([3.2, 1.4, 10]);
    expect([c.accel, c.gallopAccel, c.brake]).toEqual([5, 8, 12]);
    expect([c.turnRateSlowDeg, c.turnRateFastDeg]).toEqual([200, 80]);
  });
  it('merges a partial preset without touching the defaults, ignoring unknown keys', () => {
    const t = mergeTuning(DEFAULT_TUNING, { body: { maxTiltDeg: 30 }, look: { weights: [1, 0, 0, 0, 0] } } as never);
    expect(t.body.maxTiltDeg).toBe(30);
    expect(t.look.weights).toEqual([1, 0, 0, 0, 0]);
    expect(DEFAULT_TUNING.body.maxTiltDeg).toBe(35);
    const u = mergeTuning(DEFAULT_TUNING, { body: { nonsense: 1 }, bogus: { x: 1 } } as never);
    expect((u.body as unknown as Record<string, unknown>).nonsense).toBeUndefined();
  });
});
```

`tests/motion/controller.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { InputState } from '../../src/core/input';
import { DragonController, BodyKinematics, createIntent } from '../../src/characters/dragon/motion/controller';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { deg } from '../../src/characters/dragon/motion/math';

const T = DEFAULT_TUNING.controller;
const DT = 1 / 120;
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});

describe('DragonController', () => {
  it('moves camera-relative: W is the camera forward, D its right', () => {
    const c = new DragonController();
    const i = createIntent();
    c.read(input(['KeyW']), 0, T, i);
    expect(i.dirX).toBeCloseTo(0, 12);
    expect(i.dirZ).toBeCloseTo(1, 12);
    c.read(input(['KeyW']), Math.PI / 2, T, i);
    expect(i.dirX).toBeCloseTo(1, 12);
    c.read(input(['KeyD']), 0, T, i);
    expect(i.dirX).toBeCloseTo(-1, 12);
    expect(i.speed).toBe(3.2);
  });
  it('toggles prowl on C presses, gallops with Shift, and ignores Ctrl', () => {
    const c = new DragonController();
    const i = createIntent();
    c.read(input(['KeyW', 'KeyC'], ['KeyC']), 0, T, i);
    expect(i.speed).toBe(1.4);
    c.read(input(['KeyW', 'KeyC']), 0, T, i);
    expect(i.speed).toBe(1.4);
    c.read(input(['KeyW', 'ShiftLeft']), 0, T, i);
    expect(i.speed).toBe(10);
    c.read(input(['KeyW'], ['KeyC']), 0, T, i);
    expect(i.speed).toBe(3.2);
    c.read(input(['ControlLeft']), 0, T, i);
    expect(i.hasDir).toBe(false);
    expect(i.speed).toBe(0);
  });
});

describe('BodyKinematics', () => {
  const run = (k: BodyKinematics, keys: string[], cameraYaw: number, seconds: number, c = new DragonController()) => {
    const i = createIntent();
    let maxRate = 0;
    for (let s = 0; s < Math.round(seconds / DT); s++) {
      c.read(input(keys), cameraYaw, T, i);
      k.plan(i, DT, T);
      k.commit(k.delta, DT);
      maxRate = Math.max(maxRate, Math.abs(k.yawRate));
    }
    return maxRate;
  };
  it('accelerates at the spec rates and brakes harder', () => {
    const k = new BodyKinematics();
    run(k, ['KeyW'], 0, 0.5);
    expect(k.speed).toBeLessThanOrEqual(2.5 + 1e-9);
    run(k, ['KeyW'], 0, 1);
    expect(k.speed).toBeCloseTo(3.2, 9);
    run(k, ['KeyW', 'ShiftLeft'], 0, 0.5);
    expect(k.speed).toBeCloseTo(3.2 + 4, 6);
    run(k, [], 0, 0.5);
    expect(k.speed).toBeCloseTo(1.2, 6);
  });
  it('limits the turn rate: 200°/s slow, 80°/s at gallop', () => {
    const slow = new BodyKinematics();
    expect(run(slow, ['KeyD'], 0, 0.3)).toBeLessThanOrEqual(deg(200) + 1e-9);
    const fast = new BodyKinematics();
    run(fast, ['KeyW', 'ShiftLeft'], 0, 2);
    expect(run(fast, ['KeyD', 'ShiftLeft'], 0, DT)).toBeLessThanOrEqual(deg(80) + 1e-6); // first step, still at 10 m/s
  });
  it('turns (nearly) on the spot before moving off in the opposite direction', () => {
    const k = new BodyKinematics();
    const i = createIntent();
    const c = new DragonController();
    let maxSpeed = 0;
    for (let s = 0; s < 60; s++) {
      c.read(input(['KeyS']), 0, T, i);
      k.plan(i, DT, T);
      k.commit(k.delta, DT);
      maxSpeed = Math.max(maxSpeed, k.speed);
    }
    expect(maxSpeed).toBeLessThanOrEqual(T.inPlaceSpeed + 1e-9);
    run(k, ['KeyS'], 0, 3, c);
    expect(Math.abs(Math.cos(k.heading) + 1)).toBeLessThan(1e-3);
    expect(k.speed).toBeCloseTo(3.2, 6);
  });
  it('loses the speed a wall blocks', () => {
    const k = new BodyKinematics();
    run(k, ['KeyW'], 0, 1.5);
    k.commit(k.delta.set(0, 0, 0), DT);
    expect(k.speed).toBe(0);
  });
});
```

`tests/motion/proxies.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BodyProxies } from '../../src/characters/dragon/motion/proxies';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { wallWorld, rampWorld } from '../fixtures/worlds';

function setup() {
  const rig = toothlessFixtureRig();
  const s = new RigSkeleton(rig);
  s.resetToBind();
  s.fk();
  const p = new BodyProxies(rig, s);
  p.update(s);
  return p;
}

describe('BodyProxies', () => {
  it('uses the six body spheres from the rig (not the tail)', () => {
    expect(setup().items.map((i) => i.name).sort()).toEqual(['belly', 'chest', 'head', 'hips', 'muzzle', 'neck']);
  });
  it('stops the body at a wall and keeps the tangential slide', () => {
    const p = setup();
    const world = wallWorld(3, 3); // near face at z = 2.5 — just ahead of the muzzle (z 2.02, r 0.2)
    const d = p.resolveMove(world, new THREE.Vector3(0.5, 0, 0.5));
    expect(p.blocked).toBe(true);
    expect(d.x).toBeCloseTo(0.5, 6);
    expect(d.z).toBeLessThan(0.3);
    for (let k = 0; k < p.items.length; k++) {
      const c = world.sphereContact(p.centers[k].clone().add(d), p.items[k].radius);
      expect(!c || c.normal.y >= 0.64 || c.depth < 1e-3).toBe(true);
    }
  });
  it('ignores ground-like contacts so slopes never block walking', () => {
    const p = setup();
    // 15° ramp whose surface just meets the belly: every contact along the body is the ramp's top face
    const d = p.resolveMove(rampWorld(15, -2.7), new THREE.Vector3(0, 0, 0.3));
    expect(d.z).toBeCloseTo(0.3, 9);
    expect(p.blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion` → the three new files FAIL (modules not found).

- [ ] **Step 3: Implement `tuning.ts`**

```ts
/** Every motion constant (spec §6.16). Defaults come from the spec; tuned presets live in motion-tuning.json. */
export interface MotionTuning {
  controller: {
    trotSpeed: number; prowlSpeed: number; gallopSpeed: number;
    accel: number; gallopAccel: number; brake: number;
    turnRateSlowDeg: number; turnRateFastDeg: number; slowTurnSpeed: number;
    inPlaceTurnRateDeg: number; inPlaceSpeed: number; turnGain: number; turnInPlaceAngleDeg: number;
  };
  gait: { hysteresis: number; blendTime: number; stopSpeed: number; turnStepRadius: number; maxCadence: number; strideFrac: number };
  planner: {
    raibertGain: number; castUp: number; castDown: number; maxSlopeDeg: number;
    edgeDrop: number; edgeProbe: number; candidateOffset: number;
    retargetHalfLife: number; freezeRetargetAt: number;
    forcedStepDist: number; forcedSwingTime: number; forcedLift: number;
    overstretch: number; clearance: number; minSwingTime: number; maxAirborne: number; maxStepUp: number; maxStepDown: number;
    reachFrac: number; sideLead: number; strainLookahead: number;
  };
  body: {
    heightOmega: number; tiltOmega: number; maxTiltDeg: number;
    crouchWalk: number; crouchTrot: number; crouchGallop: number;
    footfallImpulse: number; bobWalk: number; bobTrot: number; rockGallopDeg: number; flexGallopDeg: number;
    leanGain: number; maxLeanDeg: number; accelPitchDeg: number; maxAccelPitchDeg: number;
    bendGain: number; maxBendDeg: number; shortfallLower: number; terrainLookahead: number;
  };
  legs: { scapulaFollow: number; swingCurlDeg: number; maxReach: number; limitMarginDeg: number; envelopeDrop: number };
  look: {
    yawLimitDeg: number; pitchLimitDeg: number; headOmega: number; eyeOmega: number; eyeLimitDeg: number;
    leadGain: number; aheadDist: number; idleCameraDelay: number; glanceMin: number; glanceMax: number; glanceHold: number;
    weights: number[];
  };
  tail: {
    omegaBase: number; omegaTip: number; zeta: number; droopDeg: number; turnGain: number;
    latAccelGain: number; vertAccelGain: number; gallopRaiseDeg: number; clearance: number;
  };
  ears: { omega: number; zeta: number; twitchMin: number; twitchMax: number; twitchImpulse: number; gallopBackDeg: number };
  fins: { omega: number; zeta: number; flutterDeg: number; flutterHz: number };
  breath: { calmPerMin: number; exertedPerMin: number; recoverTime: number; amplitudeDeg: number };
  climb: {
    climbMinDeg: number; wallMinDeg: number; climbSpeed: number; scrambleSpeed: number; maxTiltDeg: number;
    cadenceScale: number; strideScale: number; swingScale: number; wingsOpen: number;
    ledgeMax: number; scrambleTime: number; dropMin: number; hopUpSpeed: number; probeAhead: number;
  };
  camera: {
    distance: number; minDistance: number; maxDistance: number; pitchDeg: number; minPitchDeg: number; maxPitchDeg: number;
    sensitivity: number; wheelScale: number; followOmega: number; lookAhead: number;
    recentreDelay: number; recentreOmega: number; climbPitchDeg: number; radius: number; easeOutOmega: number;
    fadeNear: number; fadeFar: number; chestHeight: number;
  };
}

export const DEFAULT_TUNING: MotionTuning = {
  controller: {
    trotSpeed: 3.2, prowlSpeed: 1.4, gallopSpeed: 10, accel: 5, gallopAccel: 8, brake: 12,
    turnRateSlowDeg: 200, turnRateFastDeg: 80, slowTurnSpeed: 1.5, inPlaceTurnRateDeg: 120, inPlaceSpeed: 0.3,
    turnGain: 6, turnInPlaceAngleDeg: 100,
  },
  gait: { hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05, turnStepRadius: 0.8, maxCadence: 3, strideFrac: 0.85 },
  planner: {
    raibertGain: 0.45, castUp: 0.8, castDown: 1.8, maxSlopeDeg: 75, edgeDrop: 0.15, edgeProbe: 0.1, candidateOffset: 0.12,
    retargetHalfLife: 0.04, freezeRetargetAt: 0.8, forcedStepDist: 0.2, forcedSwingTime: 0.28,
    forcedLift: 0.09, overstretch: 0.97, clearance: 0.05, minSwingTime: 0.12, maxAirborne: 2, maxStepUp: 0.6, maxStepDown: 1.0,
    reachFrac: 0.9, sideLead: 0.2, strainLookahead: 3,
  },
  body: {
    heightOmega: 14, tiltOmega: 10, maxTiltDeg: 35, crouchWalk: 0.03, crouchTrot: 0.09, crouchGallop: 0.16,
    footfallImpulse: 0.12, bobWalk: 0.012, bobTrot: 0.02, rockGallopDeg: 3, flexGallopDeg: 6,
    leanGain: 0.8, maxLeanDeg: 18, accelPitchDeg: 0.5, maxAccelPitchDeg: 6, bendGain: 0.25, maxBendDeg: 25, shortfallLower: 1,
    terrainLookahead: 0.15,
  },
  legs: { scapulaFollow: 0.35, swingCurlDeg: 35, maxReach: 0.995, limitMarginDeg: 4, envelopeDrop: 0.09 },
  look: {
    yawLimitDeg: 100, pitchLimitDeg: 40, headOmega: 5, eyeOmega: 28, eyeLimitDeg: 25, leadGain: 0.35, aheadDist: 6,
    idleCameraDelay: 1.5, glanceMin: 3, glanceMax: 7, glanceHold: 1.2, weights: [0.12, 0.18, 0.22, 0.23, 0.25],
  },
  tail: {
    omegaBase: 14, omegaTip: 6, zeta: 0.45, droopDeg: 1.5, turnGain: 0.1, latAccelGain: 0.02, vertAccelGain: 0.015,
    gallopRaiseDeg: 2.5, clearance: 0.04,
  },
  ears: { omega: 16, zeta: 0.35, twitchMin: 1.5, twitchMax: 5, twitchImpulse: 5, gallopBackDeg: 25 },
  fins: { omega: 12, zeta: 0.4, flutterDeg: 3, flutterHz: 3 },
  breath: { calmPerMin: 12, exertedPerMin: 40, recoverTime: 20, amplitudeDeg: 0.8 },
  climb: {
    climbMinDeg: 45, wallMinDeg: 70, climbSpeed: 1.8, scrambleSpeed: 3, maxTiltDeg: 60, cadenceScale: 0.8, strideScale: 0.7,
    swingScale: 1.5, wingsOpen: 0.2, ledgeMax: 2.5, scrambleTime: 0.9, dropMin: 1.5, hopUpSpeed: 1.2, probeAhead: 1.2,
  },
  camera: {
    distance: 8, minDistance: 4, maxDistance: 18, pitchDeg: 18, minPitchDeg: -10, maxPitchDeg: 70, sensitivity: 0.0025,
    wheelScale: 0.0012, followOmega: 8, lookAhead: 0.25, recentreDelay: 2, recentreOmega: 1.5, climbPitchDeg: 15,
    radius: 0.3, easeOutOmega: 2, fadeNear: 0.5, fadeFar: 1.2, chestHeight: 1.25,
  },
};

export const TUNING_URL = 'assets/characters/toothless/motion-tuning.json';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends number[] ? number[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Two-level merge (section → field). Unknown sections/fields are ignored; arrays are replaced. */
export function mergeTuning(base: MotionTuning, patch: DeepPartial<MotionTuning> | undefined): MotionTuning {
  const out = structuredClone(base);
  if (!patch) return out;
  const sections = out as unknown as Record<string, Record<string, unknown>>;
  for (const [section, values] of Object.entries(patch)) {
    const target = sections[section];
    if (!target || typeof values !== 'object' || values === null) continue;
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (k in target && v !== undefined) target[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  return out;
}

export async function loadTuning(url = TUNING_URL): Promise<MotionTuning> {
  try {
    const r = await fetch(url);
    return mergeTuning(DEFAULT_TUNING, r.ok ? ((await r.json()) as DeepPartial<MotionTuning>) : undefined);
  } catch {
    return mergeTuning(DEFAULT_TUNING, undefined);
  }
}
```

- [ ] **Step 4: Implement `controller.ts`**

```ts
import * as THREE from 'three';
import type { InputState } from '../../../core/input';
import type { MotionTuning } from './tuning';
import { angleDiff, clamp, deg, lerp, wrapAngle } from './math';

type ControllerTuning = MotionTuning['controller'];

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];

export interface MoveIntent {
  /** Desired world direction on the ground (unit) when hasDir. */
  dirX: number;
  dirZ: number;
  hasDir: boolean;
  speed: number;
  gallop: boolean;
  prowl: boolean;
  /** Edge-triggered action requests for M6 (jump, plasma). */
  jump: boolean;
  plasma: boolean;
}

export function createIntent(): MoveIntent {
  return { dirX: 0, dirZ: 0, hasDir: false, speed: 0, gallop: false, prowl: false, jump: false, plasma: false };
}

/** Input → intent (spec §6.2). Camera-relative WASD; C toggles prowl; Shift gallops. Ctrl is deliberately unbound. */
export class DragonController {
  prowl = false;

  read(input: InputState, cameraYaw: number, t: ControllerTuning, out: MoveIntent): MoveIntent {
    if (input.pressed.has('KeyC')) this.prowl = !this.prowl;
    const held = (codes: string[]) => codes.some((c) => input.keys.has(c));
    const f = (held(FORWARD) ? 1 : 0) - (held(BACK) ? 1 : 0);
    const r = (held(RIGHT) ? 1 : 0) - (held(LEFT) ? 1 : 0);
    // camera forward = (sin yaw, 0, cos yaw); camera right = forward × up = (−cos yaw, 0, sin yaw)
    const x = f * Math.sin(cameraYaw) - r * Math.cos(cameraYaw);
    const z = f * Math.cos(cameraYaw) + r * Math.sin(cameraYaw);
    const len = Math.hypot(x, z);
    out.hasDir = len > 1e-6;
    out.dirX = out.hasDir ? x / len : 0;
    out.dirZ = out.hasDir ? z / len : 0;
    out.gallop = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
    out.prowl = this.prowl && !out.gallop;
    out.speed = !out.hasDir ? 0 : out.gallop ? t.gallopSpeed : out.prowl ? t.prowlSpeed : t.trotSpeed;
    out.jump = input.pressed.has('Space');
    out.plasma = input.pressed.has('KeyF') || (input.buttonsPressed & 1) !== 0;
    return out;
  }
}

/**
 * Speed, heading and yaw rate of the body (spec §6.2): momentum (accel 5 m/s², gallop launch 8, braking 12), turn rate
 * 200°/s at ≤ 1.5 m/s tapering to 80°/s at full gallop, and turning (nearly) on the spot for large heading errors.
 * `pos` is the character-frame origin on the ground between the feet; the body always moves along its heading.
 */
export class BodyKinematics {
  readonly pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  yawRate = 0;
  accel = 0;
  readonly velocity = new THREE.Vector3();
  /** Displacement proposed by the last plan() — collision may shorten it before commit(). */
  readonly delta = new THREE.Vector3();

  spawn(x: number, y: number, z: number, heading: number): void {
    this.pos.set(x, y, z);
    this.heading = wrapAngle(heading);
    this.speed = 0;
    this.yawRate = 0;
    this.accel = 0;
    this.velocity.set(0, 0, 0);
    this.delta.set(0, 0, 0);
  }

  plan(intent: MoveIntent, dt: number, t: ControllerTuning, speedCap = Infinity): void {
    let target = Math.min(intent.speed, speedCap);
    let rate = 0;
    if (intent.hasDir) {
      const err = angleDiff(this.heading, Math.atan2(intent.dirX, intent.dirZ));
      const k = clamp((this.speed - t.slowTurnSpeed) / Math.max(t.gallopSpeed - t.slowTurnSpeed, 1e-6), 0, 1);
      let maxRate = deg(lerp(t.turnRateSlowDeg, t.turnRateFastDeg, k));
      if (this.speed < t.inPlaceSpeed) maxRate = Math.min(maxRate, deg(t.inPlaceTurnRateDeg));
      rate = clamp(err * t.turnGain, -maxRate, maxRate);
      if (Math.abs(err) > deg(t.turnInPlaceAngleDeg)) target = Math.min(target, t.inPlaceSpeed);
      else target *= Math.max(0, Math.cos(err));
    }
    this.yawRate = rate;
    this.heading = wrapAngle(this.heading + rate * dt);
    const up = (intent.gallop ? t.gallopAccel : t.accel) * dt;
    const change = clamp(target - this.speed, -t.brake * dt, up);
    this.speed = Math.max(0, this.speed + change);
    this.accel = change / dt;
    this.velocity.set(Math.sin(this.heading) * this.speed, 0, Math.cos(this.heading) * this.speed);
    this.delta.copy(this.velocity).multiplyScalar(dt);
  }

  /** Apply the (collision-resolved) displacement; speed a wall took away is lost. */
  commit(delta: THREE.Vector3, dt: number): void {
    this.pos.x += delta.x;
    this.pos.z += delta.z;
    const along = Math.max(0, (delta.x * Math.sin(this.heading) + delta.z * Math.cos(this.heading)) / dt);
    if (along < this.speed - 1e-9) this.speed = along;
    this.velocity.set(delta.x / dt, 0, delta.z / dt);
  }
}
```

- [ ] **Step 5: Implement `proxies.ts`**

```ts
import * as THREE from 'three';
import type { CollisionWorld, SphereContact } from '../../../world/collision';
import type { MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';

export interface BodyProxy {
  readonly name: string;
  readonly bone: number;
  /** Centre in the bone's local frame. */
  readonly local: THREE.Vector3;
  readonly radius: number;
}

/** Spec §6.14: head, chest, belly, hips (+ muzzle, neck) collide; feet and tail only use rays. */
export const BODY_PROXY_NAMES: readonly string[] = ['head', 'muzzle', 'neck', 'chest', 'belly', 'hips'];

const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _contact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

export class BodyProxies {
  readonly items: BodyProxy[] = [];
  readonly centers: THREE.Vector3[] = [];
  blocked = false;
  readonly wallNormal = new THREE.Vector3();

  constructor(rig: MotionRig, skeleton: RigSkeleton, names: readonly string[] = BODY_PROXY_NAMES) {
    for (const p of rig.proxies) {
      if (!names.includes(p.name)) continue;
      const bone = skeleton.id(p.bone);
      const local = skeleton.bindToLocal(bone, new THREE.Vector3(...p.center), new THREE.Vector3());
      this.items.push({ name: p.name, bone, local, radius: p.radius });
      this.centers.push(new THREE.Vector3());
    }
  }

  /** World centres from the skeleton's current FK. */
  update(skeleton: RigSkeleton): void {
    this.items.forEach((p, k) => skeleton.toWorld(p.bone, p.local, this.centers[k]));
  }

  /**
   * Slide-resolve a body displacement against steep geometry: each proxy moved by `delta` is pushed out along the
   * horizontal part of its contact normal (moving s along n_h removes s·|n_h| of depth, so s = depth / |n_h|).
   * Ground-like contacts (normal.y ≥ maxNormalY) are left to the body solver, so slopes and steps never block.
   */
  resolveMove(world: CollisionWorld, delta: THREE.Vector3, maxNormalY = 0.64): THREE.Vector3 {
    this.blocked = false;
    let deepest = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < this.items.length; k++) {
        _c.copy(this.centers[k]).add(delta);
        const c = world.sphereContact(_c, this.items[k].radius, _contact);
        if (!c || Math.abs(c.normal.y) >= maxNormalY) continue; // walls only: floors/ceilings belong to the body solver
        _n.set(c.normal.x, 0, c.normal.z);
        const h = _n.length();
        if (h < 1e-6) continue;
        _n.divideScalar(h);
        delta.addScaledVector(_n, Math.min(c.depth / h, this.items[k].radius) + 1e-5);
        if (c.depth > deepest) {
          deepest = c.depth;
          this.wallNormal.copy(_n);
          this.blocked = true;
        }
      }
    }
    return delta;
  }
}
```

- [ ] **Step 6: Run to verify they pass** — `npm test -- tests/motion` → all pass; typecheck clean.

- [ ] **Step 7: Commit** — `feat(motion): tuning config, camera-relative controller, body kinematics and body collision proxies`.

---

### Task 7: Foot planner

**Files:**
- Create: `src/characters/dragon/motion/footPlanner.ts`
- Test: `tests/motion/footPlanner.test.ts`

**Interfaces:**
- Consumes: `CollisionWorld`/`RayHit` (Task 4), `GaitEngine` (Task 3), `MotionRig`/`LEG_KEYS` (Task 5), `MotionTuning['planner']` (Task 6), math (Task 1).
- Produces:
  - `interface PawState { key; planted; pos; normal; from; to; fromNormal; toNormal; s; duration; lift; forced; justPlanted; justLifted; targetOk; wasStance }`
  - `interface PlannerBody { pos; heading; velocity; yawRate; up }`
  - `interface Foothold { point; normal; ok }`
  - `class FootPlanner`:
    - fields: `paws`, `neutral`
    - `reset(body)`, `update(body, gait, strain, dt)`, `setEnvelope(forward, backward)`, `setLegs(hips, reach)`
    - `autoStep` (default true): when false, only scripted steps happen, with no gait lift-offs and no standing corrections.
    - `forceStep(i, target, normal, duration, minLift)`: a scripted step for climbing and M6 actions.
    - `neutralWorld(i, pos, heading, out)`, `predictTarget(i, body, gait, remaining, out)`, `project(target, body, full, refY, out)`
    - `swingPoint(i, out)`, `swingNormal(i, out)`, `support(i)`
  - Leg index `i` follows `LEG_KEYS`. `pos`/`to` are **sole** contact points.
  - `strain[i]` is leg i's predicted strain from the orchestrator (Task 12): the extrapolated IK reach ratio or joint-limit closeness, ≥ 1 = the paw cannot be held. A planted paw whose strain passes `planner.overstretch` steps early.
  - `setEnvelope(forward, backward)` gives each leg's reachable sole offset from neutral (m, from Task 9's `LegRig.envelope`).
    - The combined lead (linear Raibert lead + rotational lead through turns) is clamped in the body frame to 90 % of it, and to ±`sideLead` sideways.
    - `setLegs(hips, reach)` passes the current hip/shoulder joints and each leg's max reach (Task 9). The landing target is then kept within `reachFrac` of the reach from the *predicted* hip, which catches lean, crouch and pitch.

- [ ] **Step 1: Write the failing tests**

`tests/motion/footPlanner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FootPlanner, type PlannerBody, type Foothold } from '../../src/characters/dragon/motion/footPlanner';
import { GaitEngine } from '../../src/characters/dragon/motion/gait';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { rotY } from '../../src/characters/dragon/motion/math';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { flatWorld, rampWorld, stepWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rig = toothlessFixtureRig();
const gaitOf = () => new GaitEngine(DEFAULT_TUNING.gait);
const bodyAt = (b: Partial<PlannerBody> = {}): PlannerBody => ({
  pos: V(0, 0, 0), heading: 0, velocity: V(0, 0, 0), yawRate: 0, up: V(0, 1, 0), ...b,
});
const foothold = (): Foothold => ({ point: V(0, 0, 0), normal: V(0, 1, 0), ok: false });
const SLACK = [0, 0, 0, 0];

describe('FootPlanner', () => {
  it('plants all four paws at the neutral stance on reset', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    p.paws.forEach((paw, i) => {
      expect(paw.planted).toBe(true);
      expect(paw.pos.distanceTo(p.neutral[i])).toBeLessThan(1e-6);
    });
  });
  it('predicts Raibert landing targets for straight motion', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    for (let k = 0; k < 240; k++) g.update(3.2, DT);
    const t = p.predictTarget(1, bodyAt({ velocity: V(0, 0, 3.2) }), g, 0.2, V(0, 0, 0));
    const lead = 3.2 * 0.2 + 3.2 * g.stanceDuration * DEFAULT_TUNING.planner.raibertGain;
    expect(t.distanceTo(p.neutral[1].clone().add(V(0, 0, lead)))).toBeLessThan(1e-9);
  });
  it('clamps the landing lead to the leg\'s reach envelope', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    p.setEnvelope([0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2]);
    const g = gaitOf();
    for (let k = 0; k < 240; k++) g.update(9, DT);
    const t = p.predictTarget(1, bodyAt({ velocity: V(0, 0, 9) }), g, 0.1, V(0, 0, 0));
    expect(t.z - p.neutral[1].z - 0.9).toBeCloseTo(0.18, 9);
  });
  it('steps a planted paw early when its leg is about to over-stretch', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    const g = gaitOf();
    g.update(0, DT);
    p.update(bodyAt(), g, [0.99, 0, 0, 0], DT);
    expect(p.paws[0].planted).toBe(false);
    expect(p.paws[0].justLifted).toBe(true);
  });
  it('takes scripted steps and pauses automatic stepping while autoStep is off', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    p.reset(bodyAt());
    const g = gaitOf();
    p.autoStep = false;
    const target = p.neutral[1].clone().add(V(0, 0, 0.3));
    p.forceStep(1, target, V(0, 1, 0), 0.3, 0.2);
    let apex = 0;
    for (let k = 0; k < 60; k++) {
      g.update(3, DT);
      p.update(bodyAt({ pos: V(0, 0, 1) }), g, SLACK, DT);
      apex = Math.max(apex, p.swingPoint(1, V(0, 0, 0)).y);
      expect(p.paws[0].planted && p.paws[2].planted && p.paws[3].planted).toBe(true);
    }
    expect(p.paws[1].planted).toBe(true);
    expect(p.paws[1].pos.distanceTo(target)).toBeLessThan(1e-9);
    expect(apex).toBeGreaterThanOrEqual(0.2 - 1e-9);
  });
  it('keeps landing targets within reach of the predicted hip', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const hips = p.neutral.map((n) => n.clone().add(V(0, 0.95, 0)));
    p.setLegs(hips, [1.2, 1.2, 1.2, 1.2]);
    const g = gaitOf();
    for (let k = 0; k < 240; k++) g.update(9, DT);
    const t = p.predictTarget(1, bodyAt({ velocity: V(0, 0, 9) }), g, 0.1, V(0, 0, 0));
    const hip = hips[1].clone().add(V(0, 0, 0.9));
    expect(t.distanceTo(hip)).toBeLessThanOrEqual(DEFAULT_TUNING.planner.reachFrac * 1.2 + 1e-9);
    expect(t.z - p.neutral[1].z - 0.9).toBeGreaterThan(0.1); // still leads, just not out of reach
  });
  it('predicts landing targets through a turn', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const t = p.predictTarget(0, bodyAt({ yawRate: 1 }), gaitOf(), 0.3, V(0, 0, 0));
    expect(t.distanceTo(rotY(p.neutral[0], 0.3, V(0, 0, 0)))).toBeLessThan(1e-9);
  });
  it('rejects footholds steeper than 75°', () => {
    const p = new FootPlanner(rig, rampWorld(80, 2), DEFAULT_TUNING.planner);
    const f = p.project(V(0, 0, 2.05), bodyAt(), true, 0, foothold());
    expect(f.normal.y).toBeGreaterThan(0.99);
    expect(f.point.z).toBeLessThan(2);
  });
  it('moves off edges when a solid spot is nearby', () => {
    const p = new FootPlanner(rig, stepWorld(0.5, 1), DEFAULT_TUNING.planner);
    const f = p.project(V(0, 0, 1.03), bodyAt(), true, 0, foothold());
    expect(f.ok).toBe(true);
    expect(f.point.y).toBeCloseTo(0.5, 6);
    expect(f.point.z).toBeGreaterThan(1.1);
  });
  it('rejects footholds beyond the step-height limits', () => {
    const p = new FootPlanner(rig, stepWorld(1.0, 1), DEFAULT_TUNING.planner);
    expect(p.project(V(0, 0, 2), bodyAt(), true, 0, foothold()).ok).toBe(false);
  });
  it('walks: alternates stance and swing, keeps planted paws fixed, lifts swings and strides with the body', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    const body = { pos: V(0, 0, 0), heading: 0, velocity: V(0, 0, 1.4), yawRate: 0, up: V(0, 1, 0) };
    p.reset(body);
    const lifts = [0, 0, 0, 0];
    const plants: THREE.Vector3[][] = [[], [], [], []];
    const apex = [0, 0, 0, 0];
    const locked = p.paws.map((paw) => paw.pos.clone());
    const q = V(0, 0, 0);
    for (let k = 0; k < 480; k++) {
      body.pos.addScaledVector(body.velocity, DT);
      g.update(1.4, DT);
      p.update(body, g, SLACK, DT);
      p.paws.forEach((paw, i) => {
        if (paw.justLifted) lifts[i]++;
        if (paw.justPlanted) {
          plants[i].push(paw.pos.clone());
          locked[i].copy(paw.pos);
        }
        if (paw.planted) expect(paw.pos.distanceTo(locked[i])).toBe(0);
        else apex[i] = Math.max(apex[i], p.swingPoint(i, q).y);
      });
    }
    for (let i = 0; i < 4; i++) {
      expect(lifts[i]).toBeGreaterThanOrEqual(3);
      expect(apex[i]).toBeGreaterThan(0.1);
      const strides = plants[i].slice(1).map((pt, k) => pt.distanceTo(plants[i][k]));
      const mean = strides.reduce((a, b) => a + b, 0) / strides.length;
      expect(Math.abs(mean - g.strideLength) / g.strideLength).toBeLessThan(0.1);
    }
  });
  it('re-centres the stance with one corrective step at a time when standing', () => {
    const p = new FootPlanner(rig, flatWorld(), DEFAULT_TUNING.planner);
    const g = gaitOf();
    p.reset(bodyAt());
    const body = bodyAt({ pos: V(0, 0, 0.5), heading: 0.4 });
    let maxAirborne = 0;
    for (let k = 0; k < 480; k++) {
      g.update(0, DT);
      p.update(body, g, SLACK, DT);
      maxAirborne = Math.max(maxAirborne, p.paws.filter((paw) => !paw.planted).length);
    }
    expect(maxAirborne).toBe(1);
    p.paws.forEach((paw, i) => {
      const n = p.neutralWorld(i, body.pos, body.heading, V(0, 0, 0));
      expect(Math.hypot(paw.pos.x - n.x, paw.pos.z - n.z)).toBeLessThanOrEqual(DEFAULT_TUNING.planner.forcedStepDist + 1e-9);
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/footPlanner.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `footPlanner.ts`**

```ts
import * as THREE from 'three';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import type { GaitEngine } from './gait';
import { LEG_KEYS, type LimbKey, type MotionRig } from './rigTypes';
import type { MotionTuning } from './tuning';
import { clamp, dampFactor, deg, rotY, smoothstep } from './math';

type PlannerTuning = MotionTuning['planner'];

export interface PawState {
  readonly key: LimbKey;
  planted: boolean;
  /** Sole contact point — locked in the world while planted. */
  readonly pos: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly fromNormal: THREE.Vector3;
  readonly toNormal: THREE.Vector3;
  /** Swing progress 0…1 and its duration (s). */
  s: number;
  duration: number;
  /** Peak height of the swing arc above the straight path (m). */
  lift: number;
  forced: boolean;
  justPlanted: boolean;
  justLifted: boolean;
  /** Whether the landing spot passed the foothold checks (slope, edge, step height). */
  targetOk: boolean;
  wasStance: boolean;
}

export interface PlannerBody {
  /** Character-frame origin (ground point between the feet). */
  readonly pos: THREE.Vector3;
  readonly heading: number;
  /** Horizontal velocity. */
  readonly velocity: THREE.Vector3;
  readonly yawRate: number;
  /** Body up axis (world up on ordinary ground; tilted while climbing). Footholds are searched along −up. */
  readonly up: THREE.Vector3;
}

export interface Foothold {
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  ok: boolean;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _down = new THREE.Vector3();
const _target = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _probe: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _foot: Foothold = { point: new THREE.Vector3(), normal: new THREE.Vector3(), ok: false };
const OFFSETS_FULL: ReadonlyArray<[number, number]> = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const OFFSETS_ONE: ReadonlyArray<[number, number]> = [[0, 0]];

/**
 * Plant/swing state machine for the four paws (spec §6.4). Lift-off comes from the gait phase (stance → swing),
 * or is forced on over-stretch and when standing (one corrective step at a time). Landing target: Raibert placement
 * (predicted body at touchdown + neutral stance + v·T_stance·gain), projected along −up onto real geometry, scored
 * over a few candidates (distance, slope, edges) with > 75° slopes, edges and out-of-reach heights rejected.
 * Swings follow an eased path with a sin(πs) lift raised over obstacles, re-targeting smoothly until late in the swing.
 */
export class FootPlanner {
  readonly paws: PawState[];
  /** Neutral sole positions in the character frame (bind pose), LEG_KEYS order. */
  readonly neutral: THREE.Vector3[];
  /** When false only scripted steps (forceStep) happen: no gait lift-offs, no standing corrections. */
  autoStep = true;
  private readonly envForward = [Infinity, Infinity, Infinity, Infinity];
  private readonly envBackward = [Infinity, Infinity, Infinity, Infinity];
  private readonly hips = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly reach = [Infinity, Infinity, Infinity, Infinity];

  constructor(rig: MotionRig, private readonly world: CollisionWorld, private readonly t: PlannerTuning) {
    this.neutral = LEG_KEYS.map((k) => new THREE.Vector3(...rig.contacts[k].sole));
    this.paws = LEG_KEYS.map((key) => ({
      key, planted: true, pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0),
      from: new THREE.Vector3(), to: new THREE.Vector3(), fromNormal: new THREE.Vector3(0, 1, 0), toNormal: new THREE.Vector3(0, 1, 0),
      s: 1, duration: 0.3, lift: 0, forced: false, justPlanted: false, justLifted: false, targetOk: true, wasStance: true,
    }));
  }

  neutralWorld(i: number, pos: THREE.Vector3, heading: number, out: THREE.Vector3): THREE.Vector3 {
    return rotY(this.neutral[i], heading, out).add(pos);
  }

  /** Reachable sole offsets from neutral along the body's forward axis (m), per leg; the landing lead is clamped to 90 %. */
  setEnvelope(forward: readonly number[], backward: readonly number[]): void {
    for (let i = 0; i < 4; i++) {
      this.envForward[i] = forward[i];
      this.envBackward[i] = backward[i];
    }
  }

  /** World hip/shoulder joints (from the last pose) and each leg's max hip→sole distance — the landing reach limit. */
  setLegs(hips: readonly THREE.Vector3[], reach: readonly number[]): void {
    for (let i = 0; i < 4; i++) {
      this.hips[i].copy(hips[i]);
      this.reach[i] = reach[i];
    }
  }

  /**
   * Raibert landing target for a touchdown `remaining` seconds from now (unprojected):
   *   neutral stance under the predicted body (heading at touchdown)
   *   + lead: v·T_stance·gain (linear) and the neutral turned a further yawRate·T_stance·gain (rotational), so the paw
   *     passes neutral mid-stance; the combined lead is clamped in the body frame to 90 % of the leg's fore-aft
   *     envelope and ±sideLead sideways;
   *   then kept within reachFrac of the leg's reach from the predicted hip (lean, crouch and pitch shift the hip).
   */
  predictTarget(i: number, body: PlannerBody, gait: GaitEngine, remaining: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.t;
    const stance = gait.cadence > 0 ? gait.stanceDuration : 0;
    const heading = body.heading + body.yawRate * remaining;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    rotY(this.neutral[i], heading, out);
    rotY(this.neutral[i], heading + body.yawRate * stance * t.raibertGain, _a).sub(out); // rotational lead
    rotY(body.velocity, body.yawRate * remaining, _c).multiplyScalar(stance * t.raibertGain); // linear lead
    _a.add(_c);
    const along = clamp(_a.x * fx + _a.z * fz, -0.9 * this.envBackward[i], 0.9 * this.envForward[i]);
    const side = clamp(_a.x * fz - _a.z * fx, -t.sideLead, t.sideLead);
    out.add(body.pos).addScaledVector(body.velocity, remaining);
    out.x += along * fx + side * fz;
    out.z += along * fz - side * fx;
    if (Number.isFinite(this.reach[i])) {
      // predicted hip: carried with the body and turned about it
      _n.subVectors(this.hips[i], body.pos);
      rotY(_n, body.yawRate * remaining, _n).add(body.pos).addScaledVector(body.velocity, remaining);
      const R = t.reachFrac * this.reach[i];
      const dy = out.y - _n.y;
      const dx = out.x - _n.x;
      const dz = out.z - _n.z;
      const h = Math.hypot(dx, dz);
      const hMax = Math.sqrt(Math.max(R * R - dy * dy, 0));
      if (h > hMax && h > 1e-9) {
        out.x = _n.x + (dx * hMax) / h;
        out.z = _n.z + (dz * hMax) / h;
      }
    }
    return out;
  }

  /**
   * Best foothold near `target`. `refY` is the current foot height (step-up/down limits). `full` scores five candidates;
   * otherwise only the target itself. Candidates whose cast origin lies inside a solid (walls, slabs, tall blocks) are
   * skipped — a ray started there would find "ground" under the solid. When nothing qualifies, returns the raw target
   * with ok = false.
   */
  project(target: THREE.Vector3, body: PlannerBody, full: boolean, refY: number, out: Foothold): Foothold {
    const t = this.t;
    _fwd.set(Math.sin(body.heading), 0, Math.cos(body.heading));
    _fwd.addScaledVector(body.up, -_fwd.dot(body.up)).normalize();
    _lat.crossVectors(body.up, _fwd);
    let best = Infinity;
    out.ok = false;
    for (const [f, l] of full ? OFFSETS_FULL : OFFSETS_ONE) {
      _c.copy(target).addScaledVector(_fwd, f * t.candidateOffset).addScaledVector(_lat, l * t.candidateOffset);
      if (this.world.isInside(_a.copy(_c).addScaledVector(body.up, t.castUp))) continue; // covered by a solid
      if (!this.cast(_c, body.up, _hit)) continue;
      const slope = Math.acos(clamp(_hit.normal.dot(WORLD_UP), -1, 1));
      if (slope > deg(t.maxSlopeDeg)) continue;
      const rise = _hit.point.y - refY;
      if (rise > t.maxStepUp || -rise > t.maxStepDown) continue;
      const edge = this.isEdge(_hit.point, body.up);
      const score = Math.hypot(f, l) * t.candidateOffset + slope * 0.3 + (edge ? 1 : 0);
      if (score < best) {
        best = score;
        out.point.copy(_hit.point);
        out.normal.copy(_hit.normal);
        out.ok = !edge;
      }
    }
    if (best === Infinity) {
      out.point.copy(target);
      out.normal.copy(body.up);
    }
    return out;
  }

  reset(body: PlannerBody): void {
    for (let i = 0; i < 4; i++) {
      const p = this.paws[i];
      this.neutralWorld(i, body.pos, body.heading, _target);
      const f = this.project(_target, body, true, _target.y, _foot);
      p.pos.copy(f.point);
      p.normal.copy(f.normal);
      p.from.copy(p.pos);
      p.to.copy(p.pos);
      p.fromNormal.copy(p.normal);
      p.toNormal.copy(p.normal);
      p.planted = true;
      p.s = 1;
      p.forced = false;
      p.justPlanted = false;
      p.justLifted = false;
      p.targetOk = f.ok;
      p.wasStance = true;
    }
  }

  update(body: PlannerBody, gait: GaitEngine, stretch: readonly number[], dt: number): void {
    const t = this.t;
    let airborne = 0;
    for (const p of this.paws) {
      p.justPlanted = false;
      p.justLifted = false;
      if (!p.planted) airborne++;
    }
    // 1) advance swings, re-targeting toward the moving landing spot until late in the swing
    for (let i = 0; i < 4; i++) {
      const p = this.paws[i];
      if (p.planted) continue;
      if (!p.forced && p.s < t.freezeRetargetAt) {
        this.predictTarget(i, body, gait, (1 - p.s) * p.duration, _target);
        let f = this.project(_target, body, false, p.from.y, _foot);
        if (!f.ok) f = this.project(_target, body, true, p.from.y, _foot);
        const k = dampFactor(t.retargetHalfLife, dt);
        p.to.lerp(f.point, k);
        p.toNormal.lerp(f.normal, k).normalize();
        p.targetOk = f.ok;
      }
      p.s += dt / p.duration;
      if (p.s >= 1) {
        p.s = 1;
        p.planted = true;
        p.pos.copy(p.to);
        p.normal.copy(p.toNormal);
        p.justPlanted = true;
        airborne--;
      }
    }
    const stopped = gait.cadence === 0;
    // 2) gait-driven lift-offs on the stance → swing phase transition
    for (let i = 0; i < 4; i++) {
      const p = this.paws[i];
      const stance = gait.inStance(i);
      if (this.autoStep && !stopped && p.planted && !p.justPlanted && p.wasStance && !stance) {
        this.lift(i, body, gait, gait.swingDuration, false);
        airborne++;
      }
      p.wasStance = stance;
    }
    // 3) over-stretch: a planted paw about to leave the leg's reach steps early. While moving this overrides the
    //    airborne limit (a gallop has all-four-off moments anyway, and a slipping paw is worse); standing, it does not.
    for (let i = 0; i < 4; i++) {
      const p = this.paws[i];
      if (!p.planted || p.justPlanted || (stopped && airborne >= t.maxAirborne)) continue;
      if (stretch[i] > t.overstretch) {
        this.lift(i, body, gait, stopped ? t.forcedSwingTime : Math.min(gait.swingDuration, 0.4), stopped);
        airborne++;
      }
    }
    // 4) standing: one corrective step at a time toward the neutral stance (this also turns him on the spot)
    if (this.autoStep && stopped && airborne === 0) {
      let worst = -1;
      let worstErr = t.forcedStepDist;
      for (let i = 0; i < 4; i++) {
        const p = this.paws[i];
        this.neutralWorld(i, body.pos, body.heading, _a);
        const err = Math.hypot(p.pos.x - _a.x, p.pos.z - _a.z);
        if (err > worstErr) {
          worst = i;
          worstErr = err;
        }
      }
      if (worst >= 0) this.lift(worst, body, gait, t.forcedSwingTime, true);
    }
  }

  /** Scripted step (climbing, M6 actions): lift paw i now — from wherever it is — and land it exactly on `target`. */
  forceStep(i: number, target: THREE.Vector3, normal: THREE.Vector3, duration: number, minLift: number): void {
    const p = this.paws[i];
    this.swingPoint(i, _a);
    this.swingNormal(i, _n);
    p.from.copy(_a);
    p.fromNormal.copy(_n);
    p.planted = false;
    p.forced = true;
    p.s = 0;
    p.duration = Math.max(duration, this.t.minSwingTime);
    p.justLifted = true;
    p.to.copy(target);
    p.toNormal.copy(normal).normalize();
    p.targetOk = true;
    let lift = minLift;
    for (let k = 1; k < 5; k++) {
      _c.lerpVectors(p.from, p.to, k / 5);
      if (this.world.groundAt(_c.x, _c.z, _c.y + 3, 6, _probe)) lift = Math.max(lift, _probe.point.y - _c.y + this.t.clearance);
    }
    p.lift = lift;
  }

  /** Current sole position of paw i (its contact while planted, its swing arc otherwise). */
  swingPoint(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.paws[i];
    if (p.planted) return out.copy(p.pos);
    const e = smoothstep(0, 1, p.s);
    out.lerpVectors(p.from, p.to, e);
    this.swingNormal(i, _n);
    return out.addScaledVector(_n, p.lift * Math.sin(Math.PI * p.s));
  }

  swingNormal(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.paws[i];
    if (p.planted) return out.copy(p.normal);
    return out.lerpVectors(p.fromNormal, p.toNormal, smoothstep(0, 1, p.s)).normalize();
  }

  /** Ground height under paw i for the body solver: its contact while planted, its path base while swinging. */
  support(i: number): number {
    const p = this.paws[i];
    return p.planted ? p.pos.y : p.from.y + (p.to.y - p.from.y) * smoothstep(0, 1, p.s);
  }

  private lift(i: number, body: PlannerBody, gait: GaitEngine, duration: number, forced: boolean): void {
    const p = this.paws[i];
    const t = this.t;
    p.planted = false;
    p.forced = forced;
    p.s = 0;
    p.duration = Math.max(duration, t.minSwingTime);
    p.justLifted = true;
    p.from.copy(p.pos);
    p.fromNormal.copy(p.normal);
    if (forced) this.neutralWorld(i, body.pos, body.heading, _target);
    else this.predictTarget(i, body, gait, p.duration, _target);
    const f = this.project(_target, body, true, p.from.y, _foot);
    p.to.copy(f.point);
    p.toNormal.copy(f.normal);
    p.targetOk = f.ok;
    let lift = forced ? t.forcedLift : gait.swingHeight;
    for (let k = 1; k < 5; k++) {
      _a.lerpVectors(p.from, p.to, k / 5);
      if (this.world.groundAt(_a.x, _a.z, _a.y + 2, 4, _probe)) lift = Math.max(lift, _probe.point.y - _a.y + t.clearance);
    }
    p.lift = lift;
  }

  /** Ray along −up from castUp above `p`. */
  private cast(p: THREE.Vector3, up: THREE.Vector3, out: RayHit): RayHit | null {
    _down.copy(up).negate();
    _a.copy(p).addScaledVector(up, this.t.castUp);
    return this.world.raycast(_a, _down, this.t.castUp + this.t.castDown, out);
  }

  /** A spot is an edge when any probe around it misses or sits more than edgeDrop above/below it. */
  private isEdge(point: THREE.Vector3, up: THREE.Vector3): boolean {
    const r = this.t.edgeProbe;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
      _c.set(point.x + dx, point.y, point.z + dz);
      if (!this.cast(_c, up, _probe)) return true;
      const dh = (_probe.point.x - point.x) * up.x + (_probe.point.y - point.y) * up.y + (_probe.point.z - point.z) * up.z;
      if (Math.abs(dh) > this.t.edgeDrop) return true;
    }
    return false;
  }
}
```

Implementation notes:
- `project` reuses the module scratch `_c` for candidates while `isEdge` also writes `_c`. `isEdge` runs after the candidate's cast and does not need the candidate position again, so the reuse is safe. Keep that order.
- The inside test costs one extra upward ray per candidate; retargeting during a swing uses the single-candidate path.
- `isEdge` probes along world X/Z (not the body frame). That suffices for edge detection and keeps it cheap.

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/motion/footPlanner.test.ts` → pass; typecheck clean. If the stride test misses by more than 10%, check the lift-off timing (phase transition) and the swing duration before touching any tolerance.

- [ ] **Step 5: Commit** — `feat(motion): foot planner — Raibert targets, foothold scoring, swing arcs, forced steps`.

---

### Task 8: Body solver and spine

**Files:**
- Create: `src/characters/dragon/motion/bodySolver.ts`
- Test: `tests/motion/bodySolver.test.ts`

**Interfaces:**
- Consumes: `GaitEngine` (Task 3), `RigSkeleton`/`MotionRig`/`LEG_KEYS` (Task 5), `MotionTuning['body']` (Task 6), springs/math (Task 1).
- Produces:
  - `interface SupportSource { support(i): number; paws: ReadonlyArray<{ justPlanted: boolean }> }` — FootPlanner satisfies it.
  - `interface BodyKinState { pos; heading; yawRate; speed; accel }` — BodyKinematics satisfies it.
  - `interface BodyPose { pelvisPos; bodyQuat; pitch; roll; height; spinePitch: number[]; spineYaw: number[] }`
  - `class BodySolver { pose; hipHeight; override { active; height; pitch }; reset(pos, heading, groundY); update(kin, support, gait, shortfall, maxTiltDeg, dt, groundFront?, groundHind?): BodyPose; impulse(dv); apply(skeleton) }`
  - `groundFront` / `groundHind` = terrain height under the shoulders / hips. The body rides on the higher of those and the paw supports, so it never sinks into rising ground before the paws step up. The spine bend runs through a spring, so a sudden yaw rate cannot jerk the chest sideways off the planted forepaws.
  - `impulse(dv)` pushes the height spring down by dv m/s (landing absorb for the hop; M6 jump).
  - `override`: scripted actions (scramble, hop; M6 jump) set the pelvis height/pitch targets directly, through the same springs.
- Conventions: pitch > 0 lifts the nose; roll > 0 lifts the left side. `bodyQuat = yaw · pitch · roll` maps the bind character frame to the body. The pitch pivot is the pelvis head. Spine bones get pitch about their local X (+ = front up) and yaw about their local Z (≈ up, + = bend left).

- [ ] **Step 1: Write the failing tests**

`tests/motion/bodySolver.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BodySolver, type BodyKinState, type SupportSource } from '../../src/characters/dragon/motion/bodySolver';
import { GaitEngine } from '../../src/characters/dragon/motion/gait';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const DT = 1 / 120;
const rig = toothlessFixtureRig();
const support = (h: number[], planted = [false, false, false, false]): SupportSource => ({
  support: (i: number) => h[i],
  paws: planted.map((p) => ({ justPlanted: p })),
});
const kin = (o: Partial<BodyKinState> = {}): BodyKinState => ({
  pos: new THREE.Vector3(), heading: 0, yawRate: 0, speed: 0, accel: 0, ...o,
});
function make() {
  const s = new RigSkeleton(rig);
  const b = new BodySolver(rig, s, DEFAULT_TUNING.body);
  b.reset(new THREE.Vector3(), 0, 0);
  return { s, b, gait: new GaitEngine(DEFAULT_TUNING.gait) };
}
function settle(m: ReturnType<typeof make>, k: BodyKinState, sup: SupportSource, steps = 480, maxTilt = 35, groundFront = -Infinity, groundHind = -Infinity) {
  for (let i = 0; i < steps; i++) m.b.update(k, sup, m.gait, [0, 0, 0, 0], maxTilt, DT, groundFront, groundHind);
  return m.b.pose;
}

describe('BodySolver', () => {
  it('stands at bind height, level, on flat ground', () => {
    const p = settle(make(), kin(), support([0, 0, 0, 0]));
    expect(p.pelvisPos.distanceTo(new THREE.Vector3(0, 1.02, -0.62))).toBeLessThan(1e-4);
    expect(Math.abs(p.pitch)).toBeLessThan(1e-6);
    expect(Math.abs(p.roll)).toBeLessThan(1e-6);
  });
  it('pitches with the front/hind support difference', () => {
    const p = settle(make(), kin(), support([0, 0.5, 0, 0.5]));
    expect(p.pitch).toBeCloseTo(Math.atan2(0.5, 1.44), 3);
  });
  it('rolls with the left/right support difference (left up is positive)', () => {
    const p = settle(make(), kin(), support([0.2, 0.2, 0, 0]));
    expect(p.roll).toBeCloseTo(Math.atan2(0.2, 0.67), 3);
  });
  it('rides on the terrain under the shoulders and hips when it is higher than the paws', () => {
    const m = make();
    const p = settle(m, kin(), support([0, 0, 0, 0]), 480, 35, 0.6, 0.1);
    expect(p.pitch).toBeCloseTo(Math.atan2(0.5, 1.44), 3);
    expect(p.height).toBeCloseTo(0.1 + 1.02, 3);
  });
  it('clamps the tilt', () => {
    const p = settle(make(), kin(), support([0, 3, 0, 3]));
    expect(p.pitch).toBeLessThanOrEqual(THREE.MathUtils.degToRad(35) + 1e-9);
  });
  it('leans into turns and bends the spine toward them', () => {
    const p = settle(make(), kin({ speed: 6, yawRate: 1 }), support([0, 0, 0, 0]));
    expect(p.roll).toBeLessThan(-0.2);
    for (const y of p.spineYaw) expect(y).toBeGreaterThan(0);
  });
  it('dips on footfalls', () => {
    const m = make();
    const k = kin({ speed: 5 });
    const steady = settle(m, k, support([0, 0, 0, 0])).height;
    m.b.update(k, support([0, 0, 0, 0], [true, false, false, false]), m.gait, [0, 0, 0, 0], 35, DT);
    let min = Infinity;
    for (let i = 0; i < 20; i++) min = Math.min(min, m.b.update(k, support([0, 0, 0, 0]), m.gait, [0, 0, 0, 0], 35, DT).height);
    expect(min).toBeLessThan(steady - 0.001);
  });
  it('follows scripted height and pitch targets through its springs', () => {
    const m = make();
    m.b.override.active = true;
    m.b.override.height = 2.5;
    m.b.override.pitch = 0.6;
    const p = settle(m, kin(), support([0, 0, 0, 0]));
    expect(p.height).toBeCloseTo(2.5, 6);
    expect(p.pitch).toBeCloseTo(0.6, 6);
    expect(m.b.hipHeight).toBeCloseTo(1.02, 9);
  });
  it('absorbs a landing impulse', () => {
    const m = make();
    const steady = settle(m, kin(), support([0, 0, 0, 0])).height;
    m.b.impulse(1.5);
    let min = Infinity;
    for (let i = 0; i < 30; i++) min = Math.min(min, m.b.update(kin(), support([0, 0, 0, 0]), m.gait, [0, 0, 0, 0], 35, DT).height);
    expect(min).toBeLessThan(steady - 0.03);
  });
  it('applies the pose to the skeleton: pelvis placed, body pitched about the pelvis', () => {
    const m = make();
    const p = settle(m, kin(), support([0, 0.5, 0, 0.5]));
    m.s.resetToBind();
    m.b.apply(m.s);
    m.s.fk();
    const pelvis = m.s.id('pelvis');
    const chest = m.s.id('chest');
    expect(m.s.worldPos[pelvis].distanceTo(p.pelvisPos)).toBeLessThan(1e-9);
    const d = m.s.worldPos[chest].clone().sub(m.s.worldPos[pelvis]);
    const bindElev = Math.atan2(1.18 - 1.02, 0.58 + 0.62);
    expect(Math.atan2(d.y, Math.hypot(d.x, d.z))).toBeCloseTo(bindElev + p.pitch, 6);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/bodySolver.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `bodySolver.ts`**

```ts
import * as THREE from 'three';
import type { GaitEngine } from './gait';
import { LEG_KEYS, type MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, deg, rotY, TAU } from './math';
import { stepSpring, type SpringState } from './springs';

type BodyTuning = MotionTuning['body'];

/** Ground height under each paw (LEG_KEYS order) and this step's touchdowns — the FootPlanner provides both. */
export interface SupportSource {
  support(i: number): number;
  readonly paws: ReadonlyArray<{ justPlanted: boolean }>;
}

export interface BodyKinState {
  readonly pos: THREE.Vector3;
  readonly heading: number;
  readonly yawRate: number;
  readonly speed: number;
  readonly accel: number;
}

export interface BodyPose {
  /** World position of the pelvis head (the root bone). */
  readonly pelvisPos: THREE.Vector3;
  /** Bind character frame → body: yaw · pitch · roll. */
  readonly bodyQuat: THREE.Quaternion;
  pitch: number;
  roll: number;
  height: number;
  /** Per spine bone after the pelvis (spine_01 … chest). */
  readonly spinePitch: number[];
  readonly spineYaw: number[];
}

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qy = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
/** Lateral-bend share for spine_01, spine_02, spine_03, chest. */
const BEND_SHARE = [0.2, 0.25, 0.3, 0.25];

/**
 * Pelvis height/pitch/roll and spine bend (spec §6.5). Hips ride above the hind supports and shoulders above the front
 * supports at bind heights, through critically damped springs, so the body pitches on slopes, rolls on side slopes and
 * rises over steps. Dynamics on top: footfall dips, the gait bob (two dips per walk/trot cycle), the gallop rock and
 * gather/extend, lean into turns (centripetal acceleration), and pitch with acceleration. When a leg cannot reach its
 * target, the body lowers by the shortfall.
 */
export class BodySolver {
  readonly pose: BodyPose;
  /** Pelvis-head height above the hind soles at bind. */
  readonly hipHeight: number;
  /** Scripted actions drive the height/pitch targets directly (roll levels out). */
  readonly override = { active: false, height: 0, pitch: 0 };
  private readonly height: SpringState = { x: 0, v: 0 };
  private readonly pitch: SpringState = { x: 0, v: 0 };
  private readonly roll: SpringState = { x: 0, v: 0 };
  private readonly bend: SpringState = { x: 0, v: 0 };
  private readonly pelvis: number;
  private readonly spine: number[];
  private readonly pelvisOffset: THREE.Vector3;
  private readonly feetLength: number;
  private readonly feetWidth: number;
  private readonly spinePitchLimit: number;
  private readonly spineYawLimit: number;

  constructor(rig: MotionRig, skeleton: RigSkeleton, private readonly t: BodyTuning) {
    this.pelvis = skeleton.id(rig.chains.spine[0]);
    this.spine = rig.chains.spine.slice(1).map((n) => skeleton.id(n));
    const head = skeleton.bindWorldPos[this.pelvis];
    const soles = LEG_KEYS.map((k) => new THREE.Vector3(...rig.contacts[k].sole)); // LH, LF, RH, RF
    this.hipHeight = head.y - (soles[0].y + soles[2].y) / 2;
    this.pelvisOffset = new THREE.Vector3(head.x, 0, head.z);
    this.feetLength = (soles[1].z + soles[3].z) / 2 - (soles[0].z + soles[2].z) / 2;
    this.feetWidth = (soles[0].x + soles[1].x) / 2 - (soles[2].x + soles[3].x) / 2;
    this.spinePitchLimit = deg(rig.chainLimitsDeg.spine.pitch);
    this.spineYawLimit = deg(rig.chainLimitsDeg.spine.yaw);
    this.pose = {
      pelvisPos: new THREE.Vector3(), bodyQuat: new THREE.Quaternion(), pitch: 0, roll: 0, height: 0,
      spinePitch: this.spine.map(() => 0), spineYaw: this.spine.map(() => 0),
    };
  }

  reset(pos: THREE.Vector3, heading: number, groundY: number): void {
    this.height.x = groundY + this.hipHeight;
    this.height.v = 0;
    this.pitch.x = this.pitch.v = 0;
    this.roll.x = this.roll.v = 0;
    this.bend.x = this.bend.v = 0;
    this.pose.spinePitch.fill(0);
    this.pose.spineYaw.fill(0);
    this.compose(pos, heading);
  }

  /**
   * `groundFront` / `groundHind`: terrain height under the shoulders / hips (−Infinity when unknown). The body rides on
   * the higher of those and the paw supports, so it never sinks into rising ground before the paws step up.
   */
  update(
    kin: BodyKinState, sup: SupportSource, gait: GaitEngine, shortfall: readonly number[], maxTiltDeg: number, dt: number,
    groundFront = -Infinity, groundHind = -Infinity,
  ): BodyPose {
    const t = this.t;
    const hH = Math.max((sup.support(0) + sup.support(2)) / 2, groundHind);
    const hF = Math.max((sup.support(1) + sup.support(3)) / 2, groundFront);
    const hL = (sup.support(0) + sup.support(1)) / 2;
    const hR = (sup.support(2) + sup.support(3)) / 2;
    const lowerHind = Math.max(shortfall[0], shortfall[2], 0) * t.shortfallLower;
    const lowerFront = Math.max(shortfall[1], shortfall[3], 0) * t.shortfallLower;
    const w = gait.weights;
    const moving = clamp(kin.speed, 0, 1);
    const crouch = (w[0] * t.crouchWalk + w[1] * t.crouchTrot + w[2] * t.crouchGallop) * moving;
    const ph = gait.phase;
    const bob = -(w[0] * t.bobWalk + w[1] * t.bobTrot) * moving * 0.5 * (1 - Math.cos(2 * TAU * ph));
    const maxTilt = deg(maxTiltDeg);

    let pitchT = Math.atan2(hF - lowerFront - (hH - lowerHind), this.feetLength);
    pitchT += clamp(deg(t.accelPitchDeg) * kin.accel, -deg(t.maxAccelPitchDeg), deg(t.maxAccelPitchDeg));
    pitchT += deg(t.rockGallopDeg) * w[2] * Math.sin(TAU * ph);
    let rollT = Math.atan2(hL - hR, this.feetWidth);
    rollT -= clamp(Math.atan((kin.speed * kin.yawRate) / 9.81) * t.leanGain, -deg(t.maxLeanDeg), deg(t.maxLeanDeg));
    pitchT = clamp(pitchT, -maxTilt, maxTilt);
    rollT = clamp(rollT, -maxTilt, maxTilt);
    let heightT = hH + this.hipHeight - crouch - lowerHind + bob;
    if (this.override.active) {
      heightT = this.override.height;
      pitchT = this.override.pitch;
      rollT = 0;
    }

    for (const p of sup.paws) if (p.justPlanted) this.height.v -= t.footfallImpulse * clamp(kin.speed / 5, 0.2, 1);
    stepSpring(this.height, heightT, t.heightOmega, 1, dt);
    stepSpring(this.pitch, pitchT, t.tiltOmega, 1, dt);
    stepSpring(this.roll, rollT, t.tiltOmega, 1, dt);

    stepSpring(this.bend, clamp(t.bendGain * kin.yawRate, -deg(t.maxBendDeg), deg(t.maxBendDeg)), t.tiltOmega, 1, dt);
    const bend = this.bend.x;
    const flex = deg(t.flexGallopDeg) * w[2] * Math.sin(TAU * ph + Math.PI / 2);
    for (let k = 0; k < this.spine.length; k++) {
      this.pose.spineYaw[k] = clamp(bend * (BEND_SHARE[k] ?? 1 / this.spine.length), -this.spineYawLimit, this.spineYawLimit);
      this.pose.spinePitch[k] = clamp(flex / this.spine.length, -this.spinePitchLimit, this.spinePitchLimit);
    }
    this.compose(kin.pos, kin.heading);
    return this.pose;
  }

  /** Landing absorb: push the height spring down by dv (m/s). */
  impulse(dv: number): void {
    this.height.v -= dv;
  }

  /** Write the pelvis transform and the spine bends as absolute locals (call right after skeleton.resetToBind()). */
  apply(skeleton: RigSkeleton): void {
    const p = this.pose;
    skeleton.localPos[this.pelvis].copy(p.pelvisPos);
    skeleton.localQuat[this.pelvis].copy(p.bodyQuat).multiply(skeleton.bindWorldQuat[this.pelvis]);
    for (let k = 0; k < this.spine.length; k++) {
      skeleton.localQuat[this.spine[k]]
        .multiply(_qp.setFromAxisAngle(AX, p.spinePitch[k]))
        .multiply(_qr.setFromAxisAngle(AZ, p.spineYaw[k]));
    }
  }

  private compose(pos: THREE.Vector3, heading: number): void {
    const p = this.pose;
    p.height = this.height.x;
    p.pitch = this.pitch.x;
    p.roll = this.roll.x;
    _qy.setFromAxisAngle(AY, heading);
    _qp.setFromAxisAngle(AX, -p.pitch); // rotating −pitch about +X lifts +Z (the nose)
    _qr.setFromAxisAngle(AZ, p.roll); // rotating +roll about +Z lifts +X (the left side)
    p.bodyQuat.copy(_qy).multiply(_qp).multiply(_qr);
    rotY(this.pelvisOffset, heading, p.pelvisPos).add(pos);
    p.pelvisPos.y = p.height;
  }
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/motion/bodySolver.test.ts` → pass; typecheck clean.

- [ ] **Step 5: Commit** — `feat(motion): body solver — support-driven height/pitch/roll, dynamics, spine bend`.

---

### Task 9: Leg rig — IK applied to the skeleton

**Files:**
- Create: `src/characters/dragon/motion/legs.ts`
- Test: `tests/motion/legs.test.ts`

**Interfaces:**
- Consumes: `solveTwoBone`, `solvePantograph` (Task 2), `RigSkeleton`/`MotionRig`/`LEG_KEYS`/`isFrontLeg` (Task 5), `MotionTuning['legs']` (Task 6), math (Task 1).
- Produces:
  - `interface LegLimit { bone; name; lo; hi }` (rad, about the bone's local X relative to bind)
  - `interface LegInfo { key; front; bones; limits; soleLocal; pawOffset; pole; reach; interior; scapulaSign }`
  - `interface LegTargets { sole; normal; planted; s }` (LEG_KEYS order)
  - `class LegRig`:
    - fields:
      - `legs`, `shortfall`
      - `stretch` — per leg, the IK reach ratio of the last solve
      - `margin` — per leg, the smallest distance (rad) of the unclamped solution to a joint limit, scapula excepted; negative = the IK wanted past a limit
      - `envelope { forward; backward }` — per leg, m: reachable sole offsets from neutral, measured with the solver itself at construction, with the body lowered by `legs.envelopeDrop` (the working crouch)
    - `hip(i, skeleton, out)`, `solve(skeleton, targets, bodyQuat): readonly number[]`, `soleWorld(i, skeleton, out)`
    - `jointReport(skeleton): Array<{ name; angle; lo; hi }>`
  - `checkLegLimits(rig, skeleton): string[]` — rig sanity; an empty array means usable.
- Order of use: body pose applied → `skeleton.fk()` → `legs.solve(...)` → `skeleton.fk()`. The solver reads the current FK as the reference pose, writes leg-bone locals, and runs `fk()` once itself after each scapula move.

- [ ] **Step 1: Write the failing tests**

`tests/motion/legs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { LegRig, checkLegLimits, type LegTargets } from '../../src/characters/dragon/motion/legs';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { LEG_KEYS, type MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const RIG_JSON = 'public/assets/characters/toothless/toothless.rig.json';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function setup(rig: MotionRig = toothlessFixtureRig()) {
  const s = new RigSkeleton(rig);
  const legs = new LegRig(rig, s, DEFAULT_TUNING.legs);
  s.resetToBind();
  s.fk();
  const soles = LEG_KEYS.map((k) => new THREE.Vector3(...rig.contacts[k].sole));
  const targets: LegTargets = { sole: soles, normal: soles.map(() => V(0, 1, 0)), planted: [true, true, true, true], s: [1, 1, 1, 1] };
  return { rig, s, legs, targets };
}
const legBones = (rig: MotionRig) => LEG_KEYS.flatMap((k) => rig.limbs[k].bones);

describe('LegRig', () => {
  it('passes the rig sanity check on the fixture and flags inverted hinge limits', () => {
    const { rig, s } = setup();
    expect(checkLegLimits(rig, s)).toEqual([]);
    const bad = structuredClone(rig);
    bad.limbs.hind_L.limitsDeg.hind_tibia_L = [-120, 5];
    expect(checkLegLimits(bad, new RigSkeleton(bad)).join('\n')).toMatch(/hind_tibia_L/);
  });
  it('is the identity at the bind stance', () => {
    const { rig, s, legs, targets } = setup();
    legs.solve(s, targets, new THREE.Quaternion());
    for (const b of legBones(rig)) expect(s.angleFromBind(s.id(b))).toBeLessThan(1e-6);
  });
  it('pins every sole within 2 mm of its target', () => {
    const offsets = [V(0, 0.1, 0.25), V(0, 0.1, 0.2), V(0, 0, -0.2), V(0, 0, -0.15)];
    for (const off of offsets) {
      const { s, legs, targets } = setup();
      const want = targets.sole.map((p) => p.clone().add(off));
      legs.solve(s, { ...targets, sole: want }, new THREE.Quaternion());
      s.fk();
      for (let i = 0; i < 4; i++) expect(legs.soleWorld(i, s, V(0, 0, 0)).distanceTo(want[i])).toBeLessThan(0.002);
    }
  });
  it('keeps the bind pose when the whole body and ground tilt together', () => {
    const { rig, s, legs, targets } = setup();
    const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -THREE.MathUtils.degToRad(20));
    const pelvis = s.id('pelvis');
    const pivot = s.bindWorldPos[pelvis].clone();
    s.localQuat[pelvis].copy(q).multiply(s.bindWorldQuat[pelvis]);
    s.fk();
    const sole = targets.sole.map((p) => p.clone().sub(pivot).applyQuaternion(q).add(pivot));
    legs.solve(s, { ...targets, sole, normal: targets.normal.map((n) => n.clone().applyQuaternion(q)) }, q);
    for (const b of legBones(rig)) expect(s.angleFromBind(s.id(b))).toBeLessThan(1e-5);
  });
  it('never exceeds joint limits across a sweep of targets', () => {
    for (let dz = -0.35; dz <= 0.35; dz += 0.07) {
      for (let dy = 0; dy <= 0.3; dy += 0.1) {
        const { s, legs, targets } = setup();
        legs.solve(s, { ...targets, sole: targets.sole.map((p) => p.clone().add(V(0, dy, dz))) }, new THREE.Quaternion());
        for (const j of legs.jointReport(s)) {
          expect(j.angle, j.name).toBeGreaterThanOrEqual(j.lo - 1e-6);
          expect(j.angle, j.name).toBeLessThanOrEqual(j.hi + 1e-6);
        }
      }
    }
  });
  it('reports a shortfall and stays finite for unreachable targets', () => {
    const { s, legs, targets } = setup();
    const short = legs.solve(s, { ...targets, sole: targets.sole.map((p) => p.clone().add(V(0, -1.5, 0))) }, new THREE.Quaternion());
    expect(Math.min(...short)).toBeGreaterThan(0);
    expect(s.isFinite()).toBe(true);
  });
  it('measures a reach envelope that the solver can actually reach', () => {
    const { s, legs, targets } = setup();
    for (let i = 0; i < 4; i++) {
      expect(legs.envelope.forward[i]).toBeGreaterThan(0.15);
      expect(legs.envelope.backward[i]).toBeGreaterThan(0.15);
      for (const dz of [0.95 * legs.envelope.forward[i], -0.95 * legs.envelope.backward[i]]) {
        s.resetToBind();
        s.fk();
        const drop = DEFAULT_TUNING.legs.envelopeDrop;
        const want = targets.sole.map((p, k) => (k === i ? p.clone().add(V(0, drop, dz)) : p.clone()));
        legs.solve(s, { ...targets, sole: want }, new THREE.Quaternion());
        s.fk();
        expect(legs.soleWorld(i, s, V(0, 0, 0)).distanceTo(want[i])).toBeLessThan(0.002);
        expect(legs.stretch[i]).toBeLessThan(1);
      }
    }
  });
  it('curls the toes during a swing', () => {
    const { s, legs, targets } = setup();
    legs.solve(s, { ...targets, planted: [false, true, true, true], s: [0.5, 1, 1, 1] }, new THREE.Quaternion());
    expect(THREE.MathUtils.radToDeg(s.angleFromBind(s.id('hind_toes_L')))).toBeCloseTo(DEFAULT_TUNING.legs.swingCurlDeg, 0);
  });
});

describe.skipIf(!existsSync(RIG_JSON))('exported rig limits (Plan 2)', () => {
  it('passes the rig sanity check — hinge flexion signs match the xAxis convention', () => {
    const rig = JSON.parse(readFileSync(RIG_JSON, 'utf8')) as MotionRig;
    expect(checkLegLimits(rig, new RigSkeleton(rig))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/legs.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `legs.ts`**

```ts
import * as THREE from 'three';
import { createPantographResult, createTwoBoneResult, solvePantograph, solveTwoBone } from './ik';
import { LEG_KEYS, isFrontLeg, type LimbKey, type MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, clampTwist, deg, twistAngle } from './math';

type LegTuning = MotionTuning['legs'];

const AX = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

export interface LegLimit {
  readonly bone: number;
  readonly name: string;
  /** Allowed rotation about the bone's local X relative to bind (rad). */
  readonly lo: number;
  readonly hi: number;
}

export interface LegInfo {
  readonly key: LimbKey;
  readonly front: boolean;
  /** front: scapula, humerus, radius, metacarpal, toes · hind: femur, tibia, metatarsal, toes */
  readonly bones: number[];
  readonly limits: LegLimit[];
  /** Sole point in the toes bone's local frame. */
  readonly soleLocal: THREE.Vector3;
  /** Paw joint (toes head) minus sole at bind, character frame. */
  readonly pawOffset: THREE.Vector3;
  readonly pole: THREE.Vector3;
  /** Max distance from the root joint (shoulder / hip) to the sole. */
  readonly reach: number;
  /** Allowed interior angle of the front elbow (rad); unused for hind legs. */
  readonly interior: [number, number];
  /** +1 when a positive rotation about the scapula's local X swings the shoulder forward. */
  readonly scapulaSign: number;
}

export interface LegTargets {
  readonly sole: readonly THREE.Vector3[];
  readonly normal: readonly THREE.Vector3[];
  readonly planted: readonly boolean[];
  /** Swing progress (1 when planted). */
  readonly s: readonly number[];
}

const _q = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _qmc = new THREE.Quaternion();
const _rel = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();
const _target = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Bone direction (local +Y) in world for a world rotation. */
function dirOf(q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(UP).applyQuaternion(q);
}

/**
 * +1 when rotating `child` positively about its own local X closes the joint between `parent` and `child`
 * (reduces the interior angle, i.e. flexes it), else −1. Measured on the bind pose.
 */
function flexSign(s: RigSkeleton, parent: number, child: number): number {
  const p = dirOf(s.bindWorldQuat[parent], _a).negate();
  const interior0 = p.angleTo(dirOf(s.bindWorldQuat[child], _b));
  _q.copy(s.bindWorldQuat[child]).multiply(_qx.setFromAxisAngle(AX, 0.01));
  return p.angleTo(dirOf(_q, _c)) < interior0 ? 1 : -1;
}

/** Flexion range [min, max] (rad) of `child` from its raw limits and flex sign. */
function flexRange(lim: LegLimit, sign: number): [number, number] {
  return sign > 0 ? [lim.lo, lim.hi] : [-lim.hi, -lim.lo];
}

/**
 * Rig sanity (spec §6.7 relies on it): every limb bone's bind pose lies inside its limits, and each leg's main hinge
 * (front radius, hind tibia) allows ≥ 60° of flexion and ≥ 20° of extension. Returns human-readable problems.
 */
export function checkLegLimits(rig: MotionRig, s: RigSkeleton): string[] {
  const problems: string[] = [];
  for (const key of LEG_KEYS) {
    const limb = rig.limbs[key];
    for (const name of limb.bones) {
      const l = limb.limitsDeg[name];
      if (!l) problems.push(`${name}: no limitsDeg`);
      else if (l[0] > 0 || l[1] < 0) problems.push(`${name}: bind (0°) outside [${l[0]}, ${l[1]}]`);
    }
    const hingeParent = s.id(limb.bones[isFrontLeg(key) ? 1 : 0]);
    const hingeName = limb.bones[isFrontLeg(key) ? 2 : 1];
    const hinge = s.id(hingeName);
    const l = limb.limitsDeg[hingeName] ?? [0, 0];
    const [fMin, fMax] = flexRange({ bone: hinge, name: hingeName, lo: deg(l[0]), hi: deg(l[1]) }, flexSign(s, hingeParent, hinge));
    if (fMax < deg(60)) problems.push(`${hingeName}: only ${Math.round((fMax * 180) / Math.PI)}° of flexion (limits [${l[0]}, ${l[1]}] about xAxis; + flexes = ${flexSign(s, hingeParent, hinge) > 0})`);
    if (-fMin < deg(20)) problems.push(`${hingeName}: only ${Math.round((-fMin * 180) / Math.PI)}° of extension (limits [${l[0]}, ${l[1]}])`);
  }
  return problems;
}

/**
 * Per-leg IK on the rig (spec §6.7).
 * - Hind legs: the pantograph solve (femur, tibia, metatarsal) reaches the paw joint; the toes lie flat on the
 *   surface and curl in swing.
 * - Front legs:
 *   - the shoulder blade rotates with the leg's reach;
 *   - the metacarpal aligns to the surface (curling back in swing);
 *   - a two-bone humerus/radius solve reaches the resulting wrist, with the elbow limited by its flexion range.
 * - Every leg bone is clamped to its limits about its local X.
 */
export class LegRig {
  readonly legs: LegInfo[];
  readonly shortfall = [0, 0, 0, 0];
  /** Per-leg IK reach ratio from the last solve (≥ 1: out of reach). */
  readonly stretch = [0, 0, 0, 0];
  /**
   * Per-leg smallest distance (rad) of the unclamped IK solution to a joint limit (scapula excepted — it is clamped
   * on purpose); negative when the solver wanted to go past a limit, i.e. the paw was not held where it should be.
   */
  readonly margin = [0, 0, 0, 0];
  private curMargin = Infinity;
  readonly envelope = { forward: [0, 0, 0, 0], backward: [0, 0, 0, 0] };
  private readonly two = createTwoBoneResult();
  private readonly pan = createPantographResult();

  constructor(rig: MotionRig, skeleton: RigSkeleton, private readonly t: LegTuning) {
    this.legs = LEG_KEYS.map((key) => {
      const limb = rig.limbs[key];
      const bones = limb.bones.map((n) => skeleton.id(n));
      const limits: LegLimit[] = limb.bones.map((n, k) => {
        const l = limb.limitsDeg[n] ?? [-180, 180];
        return { bone: bones[k], name: n, lo: deg(l[0]), hi: deg(l[1]) };
      });
      const front = isFrontLeg(key);
      const contact = rig.contacts[key];
      const toes = skeleton.id(contact.bone);
      const sole = new THREE.Vector3(...contact.sole);
      const soleLocal = skeleton.bindToLocal(toes, sole, new THREE.Vector3());
      const pawOffset = skeleton.bindWorldPos[toes].clone().sub(sole);
      let chain = 0;
      for (let k = front ? 1 : 0; k < bones.length - 1; k++) chain += skeleton.length[bones[k]];
      const reach = chain + pawOffset.length();
      let interior: [number, number] = [0, Math.PI];
      let scapulaSign = 1;
      if (front) {
        const [, hum, rad] = bones;
        const theta0 = dirOf(skeleton.bindWorldQuat[hum], _a).negate().angleTo(dirOf(skeleton.bindWorldQuat[rad], _b));
        const [fMin, fMax] = flexRange(limits[2], flexSign(skeleton, hum, rad));
        interior = [clamp(theta0 - fMax, 0.05, Math.PI - 1e-3), clamp(theta0 - fMin, 0.05, Math.PI - 1e-3)];
        const sc = bones[0];
        _q.copy(skeleton.bindWorldQuat[sc]).multiply(_qx.setFromAxisAngle(AX, 0.01));
        const moved = _a.set(0, skeleton.length[sc], 0).applyQuaternion(_q).z - _b.set(0, skeleton.length[sc], 0).applyQuaternion(skeleton.bindWorldQuat[sc]).z;
        scapulaSign = moved > 0 ? 1 : -1;
      }
      return { key, front, bones, limits, soleLocal, pawOffset, pole: new THREE.Vector3(...limb.pole), reach, interior, scapulaSign };
    });
    this.measureEnvelope(rig, skeleton);
  }

  /**
   * Binary-search, per leg, how far forward/backward (body +Z) its sole can go from neutral at bind height and still be
   * reached within 1 mm (limits included). Leaves the skeleton at bind.
   */
  private measureEnvelope(rig: MotionRig, s: RigSkeleton): void {
    const soles = LEG_KEYS.map((k) => new THREE.Vector3(...rig.contacts[k].sole));
    const tg = { sole: soles.map((p) => p.clone()), normal: soles.map(() => UP.clone()), planted: [true, true, true, true], s: [1, 1, 1, 1] };
    const ident = new THREE.Quaternion();
    const got = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      for (const dir of [1, -1]) {
        let lo = 0;
        let hi = 1.5;
        for (let it = 0; it < 14; it++) {
          const mid = (lo + hi) / 2;
          s.resetToBind();
          s.fk();
          tg.sole[i].copy(soles[i]).setZ(soles[i].z + dir * mid);
          tg.sole[i].y += this.t.envelopeDrop; // body lowered by the working crouch = paws raised relative to it
          this.solve(s, tg, ident);
          s.fk();
          if (this.soleWorld(i, s, got).distanceTo(tg.sole[i]) < 1e-3 && this.stretch[i] < 1 && this.margin[i] > 0) lo = mid;
          else hi = mid;
        }
        tg.sole[i].copy(soles[i]);
        (dir > 0 ? this.envelope.forward : this.envelope.backward)[i] = lo;
      }
    }
    s.resetToBind();
    s.fk();
    this.shortfall.fill(0);
    this.stretch.fill(0);
    this.margin.fill(0);
  }

  /** World root joint of leg i (front: shoulder = humerus head; hind: hip = femur head). */
  hip(i: number, s: RigSkeleton, out: THREE.Vector3): THREE.Vector3 {
    const L = this.legs[i];
    return out.copy(s.worldPos[L.front ? L.bones[1] : L.bones[0]]);
  }

  soleWorld(i: number, s: RigSkeleton, out: THREE.Vector3): THREE.Vector3 {
    const L = this.legs[i];
    return s.toWorld(L.bones[L.bones.length - 1], L.soleLocal, out);
  }

  /** Solve all four legs against the current FK. Returns each leg's shortfall (m; > 0 = could not reach). */
  solve(s: RigSkeleton, tg: LegTargets, bodyQuat: THREE.Quaternion): readonly number[] {
    for (let i = 0; i < 4; i++) {
      this.curMargin = Infinity;
      this.shortfall[i] = this.legs[i].front ? this.solveFront(i, s, tg, bodyQuat) : this.solveHind(i, s, tg, bodyQuat);
      this.stretch[i] = this.legs[i].front ? this.two.stretch : this.pan.stretch;
      this.margin[i] = this.curMargin;
    }
    return this.shortfall;
  }

  jointReport(s: RigSkeleton): Array<{ name: string; angle: number; lo: number; hi: number }> {
    const out: Array<{ name: string; angle: number; lo: number; hi: number }> = [];
    for (const L of this.legs) {
      for (const lim of L.limits) {
        _rel.copy(s.bindLocalQuat[lim.bone]).invert().multiply(s.localQuat[lim.bone]);
        out.push({ name: lim.name, angle: twistAngle(_rel, AX), lo: lim.lo, hi: lim.hi });
      }
    }
    return out;
  }

  private solveHind(i: number, s: RigSkeleton, tg: LegTargets, bodyQuat: THREE.Quaternion): number {
    const L = this.legs[i];
    const [femur, tibia, meta, toes] = L.bones;
    this.footFrame(tg.normal[i], bodyQuat, _qf);
    _target.copy(L.pawOffset).applyQuaternion(_qf).add(tg.sole[i]);
    _pole.copy(L.pole).applyQuaternion(bodyQuat);
    const r = solvePantograph({
      hip: s.worldPos[femur], knee: s.worldPos[tibia], hock: s.worldPos[meta], paw: s.worldPos[toes],
      femur: s.worldQuat[femur], tibia: s.worldQuat[tibia], meta: s.worldQuat[meta],
      target: _target, pole: _pole, maxReach: this.t.maxReach,
    }, this.pan);
    s.setWorldQuat(femur, r.femur);
    s.setWorldQuat(tibia, r.tibia);
    s.setWorldQuat(meta, r.meta);
    this.clampLimits(s, L, 0, 3);
    this.placeToes(s, L, i, tg);
    return r.shortfall;
  }

  private solveFront(i: number, s: RigSkeleton, tg: LegTargets, bodyQuat: THREE.Quaternion): number {
    const L = this.legs[i];
    const [scap, hum, rad, mc] = L.bones;
    this.footFrame(tg.normal[i], bodyQuat, _qf);
    _target.copy(L.pawOffset).applyQuaternion(_qf).add(tg.sole[i]);
    // 1) the shoulder blade follows the reach: signed swing of (scapula → paw) about the body's lateral axis
    _lat.set(1, 0, 0).applyQuaternion(bodyQuat);
    const toes = L.bones[4];
    _a.subVectors(s.worldPos[toes], s.worldPos[scap]);
    _a.addScaledVector(_lat, -_a.dot(_lat));
    _b.subVectors(_target, s.worldPos[scap]);
    _b.addScaledVector(_lat, -_b.dot(_lat));
    const swing = -Math.atan2(_c.crossVectors(_a, _b).dot(_lat), _a.dot(_b)); // > 0: the target is ahead
    const scapAngle = clamp(L.scapulaSign * this.t.scapulaFollow * swing, L.limits[0].lo, L.limits[0].hi);
    s.localQuat[scap].multiply(_qx.setFromAxisAngle(AX, scapAngle));
    s.fk();
    // 2) metacarpal flat on the surface (curling back in swing) → wrist target
    const curl = tg.planted[i] ? 0 : -deg(this.t.swingCurlDeg) * Math.sin(Math.PI * tg.s[i]);
    _qmc.copy(_qf).multiply(s.bindWorldQuat[mc]).multiply(_qx.setFromAxisAngle(AX, curl));
    _wrist.set(0, s.length[mc], 0).applyQuaternion(_qmc).negate().add(_target);
    // 3) humerus + radius reach the wrist
    _pole.copy(L.pole).applyQuaternion(bodyQuat);
    const r = solveTwoBone({
      root: s.worldPos[hum], mid: s.worldPos[rad], end: s.worldPos[mc], upper: s.worldQuat[hum], lower: s.worldQuat[rad],
      target: _wrist, pole: _pole, minInterior: L.interior[0], maxInterior: L.interior[1],
    }, this.two);
    s.setWorldQuat(hum, r.upper);
    s.setWorldQuat(rad, r.lower);
    this.clampLimits(s, L, 1, 3);
    s.setWorldQuat(mc, _qmc);
    this.clampLimits(s, L, 3, 4);
    this.placeToes(s, L, i, tg);
    return r.shortfall;
  }

  /** Toes flat on the surface frame, curled during swing. */
  private placeToes(s: RigSkeleton, L: LegInfo, i: number, tg: LegTargets): void {
    const toes = L.bones[L.bones.length - 1];
    const curl = tg.planted[i] ? 0 : -deg(this.t.swingCurlDeg) * Math.sin(Math.PI * tg.s[i]);
    _q.copy(_qf).multiply(s.bindWorldQuat[toes]).multiply(_qx.setFromAxisAngle(AX, curl));
    s.setWorldQuat(toes, _q);
    this.clampLimits(s, L, L.bones.length - 1, L.bones.length);
  }

  /**
   * Clamp bones [from, to) of the leg about their local X; refresh their world rotations down the chain. Records the
   * smallest distance to a limit of the unclamped solution (negative = the IK wanted to go past it).
   */
  private clampLimits(s: RigSkeleton, L: LegInfo, from: number, to: number): void {
    for (let k = from; k < to; k++) {
      const lim = L.limits[k];
      const b = lim.bone;
      _rel.copy(s.bindLocalQuat[b]).invert().multiply(s.localQuat[b]);
      const a = twistAngle(_rel, AX);
      this.curMargin = Math.min(this.curMargin, a - lim.lo, lim.hi - a);
      if (clampTwist(_rel, AX, lim.lo, lim.hi) !== 0) s.localQuat[b].copy(s.bindLocalQuat[b]).multiply(_rel);
      s.worldQuat[b].multiplyQuaternions(s.worldQuat[s.parent[b]], s.localQuat[b]);
    }
  }

  /** Bind character frame → the paw's surface frame (up = surface normal, forward = body forward on the surface). */
  private footFrame(n: THREE.Vector3, bodyQuat: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
    _fy.copy(n).normalize();
    _fz.set(0, 0, 1).applyQuaternion(bodyQuat);
    _fz.addScaledVector(_fy, -_fz.dot(_fy));
    if (_fz.lengthSq() < 1e-8) _fz.set(0, 0, 1).addScaledVector(_fy, -_fy.z);
    _fz.normalize();
    _fx.crossVectors(_fy, _fz);
    return out.setFromRotationMatrix(_m.makeBasis(_fx, _fy, _fz));
  }
}
```

Tuning note: if walking tests later show front paws running out of reach, the levers are `body.crouchTrot/Gallop`, `planner.raibertGain` and `legs.scapulaFollow`. Do not widen joint limits beyond anatomy.

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/motion/legs.test.ts` → the fixture suite passes. The exported-rig suite is skipped, or — if Plan 2's export already exists — passes; a failure there names the Plan 2 limits to fix (see the Global Constraints limit semantics). Typecheck clean.

- [ ] **Step 5: Commit** — `feat(motion): leg rig — pantograph hind legs, scapula + two-bone front legs, surface-aligned paws, limits`.

---

### Task 10: Pose layers and `poses.json`

**Files:**
- Create: `src/characters/dragon/motion/poseLayers.ts`
- Test: `tests/motion/poseLayers.test.ts`

**Interfaces:**
- Consumes: `RigSkeleton` (Task 5).
- Produces:
  - `interface PoseClipMeta { mask: 'all' | string[]; loop?; blendIn?; blendOut?; interrupt? }`, `interface PosesMeta { clips }`
  - `parsePosesMeta(raw)`, `loadPosesMeta(url)`, `maskBones(skeleton, mask)`
  - `class ClipPose { bones; duration; sample(t, out) }`
  - `class PoseLayerStack { has(name); set(name, weight, time = 0, additive = false); weight(name); apply(skeleton) }`
  - Masks are explicit metadata: bone-name prefixes, or `'all'` (spec §5.11). A mask is never inferred from which tracks exist.
  - Override layers slerp the masked bones' locals toward the clip. Additive layers post-multiply `slerp(I, bind⁻¹·clip, w)`.
  - M6 adds sit, lie, stretch… with the same calls.

- [ ] **Step 1: Write the failing tests**

`tests/motion/poseLayers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PoseLayerStack, parsePosesMeta, maskBones } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const same = (a: THREE.Quaternion, b: THREE.Quaternion) => Math.abs(a.dot(b)) > 1 - 1e-9;
const QA = q(0.4, 0, 0);
const QB = q(0.8, 0.2, 0);
const clip = new THREE.AnimationClip('fold', 1, [
  new THREE.QuaternionKeyframeTrack('wing_humerus_L.quaternion', [0, 1], [...QA.toArray(), ...QB.toArray()]),
  new THREE.QuaternionKeyframeTrack('neck_02.quaternion', [0, 1], [...QA.toArray(), ...QA.toArray()]),
  new THREE.VectorKeyframeTrack('wing_humerus_L.position', [0, 1], [0, 0, 0, 1, 1, 1]),
]);
const meta = parsePosesMeta({ clips: { fold: { mask: ['wing_'] } } });

function setup() {
  const s = new RigSkeleton(toothlessFixtureRig());
  s.resetToBind();
  return { s, stack: new PoseLayerStack(s, new Map([['fold', clip]]), meta) };
}

describe('pose layers', () => {
  it('matches masks by explicit prefixes', () => {
    const { s } = setup();
    const names = maskBones(s, ['hipwing_']).map((i) => s.names[i]);
    expect(names.length).toBe(10);
    expect(names.every((n) => n.startsWith('hipwing_'))).toBe(true);
    expect(maskBones(s, 'all').length).toBe(101);
  });
  it('overrides only masked bones with the clip pose', () => {
    const { s, stack } = setup();
    stack.set('fold', 1);
    stack.apply(s);
    expect(same(s.localQuat[s.id('wing_humerus_L')], QA)).toBe(true);
    expect(same(s.localQuat[s.id('neck_02')], s.bindLocalQuat[s.id('neck_02')])).toBe(true);
  });
  it('blends by weight and samples by time', () => {
    const { s, stack } = setup();
    const i = s.id('wing_humerus_L');
    stack.set('fold', 0.5);
    stack.apply(s);
    expect(same(s.localQuat[i], s.bindLocalQuat[i].clone().slerp(QA, 0.5))).toBe(true);
    s.resetToBind();
    stack.set('fold', 1, 0.5);
    stack.apply(s);
    expect(same(s.localQuat[i], QA.clone().slerp(QB, 0.5))).toBe(true);
  });
  it('adds additive layers on top of the current pose', () => {
    const { s, stack } = setup();
    const i = s.id('wing_humerus_L');
    const base = q(0, 0.3, 0);
    s.localQuat[i].copy(base);
    stack.set('fold', 1, 0, true);
    stack.apply(s);
    const delta = s.bindLocalQuat[i].clone().invert().multiply(QA);
    expect(same(s.localQuat[i], base.clone().multiply(delta))).toBe(true);
  });
  it('removes a layer at weight 0 and rejects unknown clips and bad metadata', () => {
    const { s, stack } = setup();
    stack.set('fold', 1);
    stack.set('fold', 0);
    expect(stack.weight('fold')).toBe(0);
    stack.apply(s);
    expect(same(s.localQuat[s.id('wing_humerus_L')], s.bindLocalQuat[s.id('wing_humerus_L')])).toBe(true);
    expect(() => stack.set('nope', 1)).toThrow(/nope/);
    expect(() => parsePosesMeta({ clips: { x: { mask: 3 } } })).toThrow(/mask/);
    expect(() => parsePosesMeta({})).toThrow(/clips/);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/poseLayers.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `poseLayers.ts`**

```ts
import * as THREE from 'three';
import type { RigSkeleton } from './skeleton';

export interface PoseClipMeta {
  mask: 'all' | string[];
  loop?: boolean;
  blendIn?: number;
  blendOut?: number;
  interrupt?: string;
}

export interface PosesMeta {
  clips: Record<string, PoseClipMeta>;
}

export function parsePosesMeta(raw: unknown): PosesMeta {
  const r = raw as { clips?: unknown } | null;
  if (!r || typeof r !== 'object' || !r.clips || typeof r.clips !== 'object') throw new Error('poses.json: missing "clips"');
  for (const [name, c] of Object.entries(r.clips as Record<string, unknown>)) {
    const m = (c as { mask?: unknown } | null)?.mask;
    if (!(m === 'all' || (Array.isArray(m) && m.every((x) => typeof x === 'string')))) {
      throw new Error(`poses.json: clip '${name}' needs mask "all" or a list of bone-name prefixes`);
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
  pose: ClipPose;
  weight: number;
  time: number;
  additive: boolean;
}

const _d = new THREE.Quaternion();
const _w = new THREE.Quaternion();

/**
 * Library pose layers (spec §6.10): applied after the body pose and before the procedural finals (look, IK, springs),
 * in the order they were first set. Override layers slerp masked bones toward the clip; additive layers post-multiply
 * the clip's offset from bind.
 */
export class PoseLayerStack {
  private readonly layers = new Map<string, Layer>();
  private readonly tmp: THREE.Quaternion[] = [];

  constructor(
    private readonly skeleton: RigSkeleton,
    private readonly clips: ReadonlyMap<string, THREE.AnimationClip>,
    private readonly meta: PosesMeta,
  ) {}

  has(name: string): boolean {
    return this.clips.has(name) && name in this.meta.clips;
  }

  set(name: string, weight: number, time = 0, additive = false): void {
    if (weight <= 0) {
      this.layers.delete(name);
      return;
    }
    let layer = this.layers.get(name);
    if (!layer) {
      const clip = this.clips.get(name);
      const m = this.meta.clips[name];
      if (!clip || !m) throw new Error(`pose layer '${name}': no clip in the poses GLB or no entry in poses.json`);
      layer = { pose: new ClipPose(clip, this.skeleton, m.mask), weight, time, additive };
      this.layers.set(name, layer);
    }
    layer.weight = Math.min(weight, 1);
    layer.time = time;
    layer.additive = additive;
  }

  weight(name: string): number {
    return this.layers.get(name)?.weight ?? 0;
  }

  apply(s: RigSkeleton): void {
    for (const l of this.layers.values()) {
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
}
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/motion/poseLayers.test.ts` → pass; typecheck clean.

- [ ] **Step 5: Commit** — `feat(motion): pose layers with explicit masks from poses.json`.

---

### Task 11: Look and secondary motion

**Files:**
- Create: `src/characters/dragon/motion/look.ts`, `src/characters/dragon/motion/secondary.ts`
- Test: `tests/motion/look.test.ts`, `tests/motion/secondary.test.ts`

**Interfaces:**
- Consumes: springs/math (Task 1), `CollisionWorld`/fixtures (Task 4), `RigSkeleton`/`MotionRig`/fixture (Task 5), tuning (Task 6), `mulberry32` (Plan 1).
- Produces:
  - `interface LookInput { moving; heading; yawRate; bodyQuat; headPos; cameraPos }`
  - `class LookController`:
    - state: `mode`, `target`, `override { active; point }`, `headYaw`, `headPitch`, `eyeYaw`, `eyePitch`
    - `update(input, dt)`, `apply(skeleton)`
    - `eyeYaw`/`eyePitch` are exposed for M6's eye shader.
  - `interface SecondaryInput { yawRate; speed; verticalAccel; gallopWeight; exertion? }`
  - `class SecondaryMotion`:
    - state: `tailYaw`, `tailPitch`, `ears`, `fins`, `exertion`, `breathRate`
    - `update(input, dt)`, `apply(skeleton)` = `applyBreathing(skeleton)` + `applyAppendages(skeleton)`.
      - Breathing moves the chest, so the orchestrator applies it before leg IK.
      - Tail, ears and fins go after leg IK, followed by `fk()` and the tail ground-avoidance passes.
  - Both write rotations on top of the step's absolute pose, so call them after `resetToBind` → body → layers.

- [ ] **Step 1: Write the failing tests**

`tests/motion/look.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LookController, type LookInput } from '../../src/characters/dragon/motion/look';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { mulberry32 } from '../../src/core/rng';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const DT = 1 / 120;
const rig = toothlessFixtureRig();
function make(seed = 1) {
  const s = new RigSkeleton(rig);
  const look = new LookController(rig, s, DEFAULT_TUNING.look, mulberry32(seed));
  return { s, look };
}
function run(m: ReturnType<typeof make>, inp: Partial<LookInput>, seconds: number): void {
  const head = m.s.id('head');
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    m.s.resetToBind();
    m.s.fk();
    m.look.update({ moving: false, heading: 0, yawRate: 0, bodyQuat: new THREE.Quaternion(), headPos: m.s.worldPos[head].clone(), cameraPos: new THREE.Vector3(0, 2, 10), ...inp }, DT);
    m.look.apply(m.s);
    m.s.fk();
  }
}
const headForward = (m: ReturnType<typeof make>) => new THREE.Vector3(0, 1, 0).applyQuaternion(m.s.worldQuat[m.s.id('head')]);

describe('LookController', () => {
  it('turns the head toward an explicit look point, spreading the turn down the neck', () => {
    const m = make();
    m.look.override.active = true;
    m.look.override.point.set(8, 1.5, 1.5);
    run(m, {}, 3);
    const f = headForward(m);
    const toTarget = m.look.override.point.clone().sub(m.s.worldPos[m.s.id('head')]);
    // the neck bones' yaw axes tilt with the neck, so the composed turn is a few degrees short of the sum
    expect(Math.abs(Math.atan2(f.x, f.z) - Math.atan2(toTarget.x, toTarget.z))).toBeLessThan(THREE.MathUtils.degToRad(10));
    for (const n of rig.chains.neck) expect(m.s.angleFromBind(m.s.id(n))).toBeLessThan(THREE.MathUtils.degToRad(40));
  });
  it('clamps the head yaw for targets behind him', () => {
    const m = make();
    m.look.override.active = true;
    m.look.override.point.set(0.5, 1.5, -10);
    run(m, {}, 3);
    expect(Math.abs(m.look.headYaw.x)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(DEFAULT_TUNING.look.yawLimitDeg) + 1e-6);
  });
  it('looks at the camera once idle', () => {
    const m = make();
    run(m, {}, 2.5);
    expect(m.look.mode).toBe('camera');
  });
  it('moves the eyes before the head', () => {
    const m = make();
    m.look.override.active = true;
    m.look.override.point.set(6, 1.5, 3);
    run(m, {}, 0.1);
    expect(Math.abs(m.look.eyeYaw.x)).toBeGreaterThan(Math.abs(m.look.headYaw.x));
  });
  it('glances deterministically for a given seed', () => {
    const a = make(7);
    const b = make(7);
    run(a, {}, 12);
    run(b, {}, 12);
    expect(a.look.headYaw.x).toBe(b.look.headYaw.x);
  });
});
```

`tests/motion/secondary.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SecondaryMotion, type SecondaryInput } from '../../src/characters/dragon/motion/secondary';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld } from '../../src/world/collision';
import { mulberry32 } from '../../src/core/rng';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, floor, flatWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const rig = toothlessFixtureRig();
function make(world = flatWorld(), seed = 3) {
  const s = new RigSkeleton(rig);
  return { s, sec: new SecondaryMotion(rig, s, world, DEFAULT_TUNING, mulberry32(seed)) };
}
function run(m: ReturnType<typeof make>, inp: Partial<SecondaryInput>, seconds: number): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    m.s.resetToBind();
    m.s.fk();
    m.sec.update({ yawRate: 0, speed: 0, verticalAccel: 0, gallopWeight: 0, ...inp }, DT);
    m.sec.apply(m.s);
  }
}

describe('SecondaryMotion', () => {
  it('lifts the tail over ground that rises under it', () => {
    const world = CollisionWorld.fromObjects([floor(), box(4, 0.7, 4, 0, 0.35, -4.2)]);
    const m = make(world);
    run(m, {}, 1);
    const p = new THREE.Vector3();
    for (const n of rig.chains.tail) {
      m.s.tail(m.s.id(n), p);
      const g = world.groundAt(p.x, p.z, p.y + 2, 5)!;
      expect(p.y).toBeGreaterThanOrEqual(g.point.y + DEFAULT_TUNING.tail.clearance - 1e-3);
    }
  });
  it('swings the tail out of a turn (counterbalance)', () => {
    const m = make();
    run(m, { yawRate: 1, speed: 3 }, 1);
    expect(m.s.tail(m.s.id('tail_12'), new THREE.Vector3()).x).toBeLessThan(-0.05);
  });
  it('lays the ears back in the gallop', () => {
    const m = make();
    run(m, { gallopWeight: 1, speed: 9 }, 1.5);
    const tip = m.s.tail(m.s.id('ear_1_L'), new THREE.Vector3());
    const bind = new THREE.Vector3(...rig.bones.find((b) => b.name === 'ear_1_L')!.tail);
    expect(tip.z).toBeLessThan(bind.z - 0.03);
  });
  it('breathes faster after exertion, then recovers', () => {
    const m = make();
    run(m, {}, 1);
    const calm = m.sec.breathRate;
    run(m, { speed: 10 }, 5);
    const hard = m.sec.breathRate;
    run(m, {}, 10);
    expect(calm).toBeCloseTo(12 / 60, 6);
    expect(hard).toBeCloseTo(40 / 60, 3);
    expect(m.sec.breathRate).toBeLessThan(hard);
    expect(m.sec.breathRate).toBeGreaterThan(calm);
  });
  it('twitches deterministically for a given seed', () => {
    const a = make(flatWorld(), 9);
    const b = make(flatWorld(), 9);
    run(a, {}, 10);
    run(b, {}, 10);
    expect(a.sec.ears.map((e) => e.s.x)).toEqual(b.sec.ears.map((e) => e.s.x));
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/look.test.ts tests/motion/secondary.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement `look.ts`**

```ts
import * as THREE from 'three';
import type { MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, deg } from './math';
import { stepAngleSpring, stepSpring, type SpringState } from './springs';

type LookTuning = MotionTuning['look'];

export interface LookInput {
  readonly moving: boolean;
  readonly heading: number;
  readonly yawRate: number;
  readonly bodyQuat: THREE.Quaternion;
  readonly headPos: THREE.Vector3;
  readonly cameraPos: THREE.Vector3;
}

const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/**
 * Head/neck look-at (spec §6.8, M5 subset). Target priority: an explicit point (M6: interest points, plasma aim) >
 * travel direction (leading into turns) > idle glances > the camera. Eyes lead with a fast spring and the head
 * follows with a slow one. The turn is spread down neck_01…head with per-bone chain limits. Targets are world
 * points, so body bob is cancelled (gaze stabilisation).
 */
export class LookController {
  mode: 'point' | 'travel' | 'glance' | 'camera' = 'travel';
  readonly target = new THREE.Vector3();
  readonly override = { active: false, point: new THREE.Vector3() };
  readonly headYaw: SpringState = { x: 0, v: 0 };
  readonly headPitch: SpringState = { x: 0, v: 0 };
  readonly eyeYaw: SpringState = { x: 0, v: 0 };
  readonly eyePitch: SpringState = { x: 0, v: 0 };
  private idle = 0;
  private nextGlance: number;
  private glanceLeft = 0;
  private glanceYaw = 0;
  private glancePitch = 0;
  private readonly chain: number[];
  private readonly yawLimit: number;
  private readonly pitchLimit: number;
  private readonly headBindPitch: number;

  constructor(rig: MotionRig, skeleton: RigSkeleton, private readonly t: LookTuning, private readonly rng: () => number) {
    this.chain = rig.chains.neck.map((n) => skeleton.id(n));
    this.yawLimit = deg(rig.chainLimitsDeg.neck.yaw);
    this.pitchLimit = deg(rig.chainLimitsDeg.neck.pitch);
    const head = this.chain[this.chain.length - 1];
    const f = new THREE.Vector3(0, 1, 0).applyQuaternion(skeleton.bindWorldQuat[head]);
    this.headBindPitch = Math.atan2(f.y, Math.hypot(f.x, f.z));
    this.nextGlance = t.glanceMin + rng() * (t.glanceMax - t.glanceMin);
  }

  update(inp: LookInput, dt: number): void {
    const t = this.t;
    if (this.override.active) {
      this.mode = 'point';
      this.idle = 0;
      this.target.copy(this.override.point);
    } else if (inp.moving) {
      this.mode = 'travel';
      this.idle = 0;
      const a = inp.heading + t.leadGain * inp.yawRate;
      this.target.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(t.aheadDist).add(inp.headPos);
    } else {
      this.idle += dt;
      if (this.glanceLeft > 0) {
        this.glanceLeft -= dt;
        this.mode = 'glance';
        _d.set(Math.sin(this.glanceYaw) * Math.cos(this.glancePitch), Math.sin(this.glancePitch), Math.cos(this.glanceYaw) * Math.cos(this.glancePitch));
        this.target.copy(_d.applyQuaternion(inp.bodyQuat).multiplyScalar(5)).add(inp.headPos);
      } else {
        this.nextGlance -= dt;
        if (this.nextGlance <= 0) {
          this.glanceLeft = t.glanceHold;
          this.glanceYaw = deg(-60 + 120 * this.rng());
          this.glancePitch = deg(-15 + 30 * this.rng());
          this.nextGlance = t.glanceMin + this.rng() * (t.glanceMax - t.glanceMin);
        }
        if (this.idle > t.idleCameraDelay) {
          this.mode = 'camera';
          this.target.copy(inp.cameraPos);
        } else {
          this.mode = 'travel';
          this.target.set(Math.sin(inp.heading), 0, Math.cos(inp.heading)).multiplyScalar(t.aheadDist).add(inp.headPos);
        }
      }
    }
    _d.subVectors(this.target, inp.headPos).applyQuaternion(_qi.copy(inp.bodyQuat).invert());
    const yaw = clamp(Math.atan2(_d.x, _d.z), -deg(t.yawLimitDeg), deg(t.yawLimitDeg));
    const pitch = clamp(Math.atan2(_d.y, Math.hypot(_d.x, _d.z)) - this.headBindPitch, -deg(t.pitchLimitDeg), deg(t.pitchLimitDeg));
    stepAngleSpring(this.headYaw, yaw, t.headOmega, 1, dt);
    stepSpring(this.headPitch, pitch, t.headOmega, 1, dt);
    const eyeLim = deg(t.eyeLimitDeg);
    stepSpring(this.eyeYaw, clamp(yaw - this.headYaw.x, -eyeLim, eyeLim), t.eyeOmega, 1, dt);
    stepSpring(this.eyePitch, clamp(pitch - this.headPitch.x, -eyeLim, eyeLim), t.eyeOmega, 1, dt);
  }

  apply(s: RigSkeleton): void {
    for (let k = 0; k < this.chain.length; k++) {
      const w = this.t.weights[k] ?? 1 / this.chain.length;
      const yaw = clamp(this.headYaw.x * w, -this.yawLimit, this.yawLimit);
      const pitch = clamp(this.headPitch.x * w, -this.pitchLimit, this.pitchLimit);
      s.localQuat[this.chain[k]].multiply(_qa.setFromAxisAngle(AZ, yaw)).multiply(_qb.setFromAxisAngle(AX, pitch));
    }
  }
}
```

- [ ] **Step 4: Implement `secondary.ts`**

```ts
import * as THREE from 'three';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import type { MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, deg, fract, lerp, TAU } from './math';
import { stepSpring, type SpringState } from './springs';

type SecondaryTuning = Pick<MotionTuning, 'tail' | 'ears' | 'fins' | 'breath'>;

export interface SecondaryInput {
  readonly yawRate: number;
  readonly speed: number;
  readonly verticalAccel: number;
  readonly gallopWeight: number;
  /** 0…1; defaults to speed / 10. */
  readonly exertion?: number;
}

const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

/**
 * Secondary motion (spec §6.9):
 * - Tail: 12 underdamped yaw/pitch springs, softer toward the tip. They are driven by the yaw rate and lateral
 *   acceleration (counterbalance) and by vertical acceleration (lag), with a gravity droop and a rise in the gallop.
 *   After posing, each segment whose end would dip below the ground lifts; the tail never penetrates.
 * - Ears: springs that lay back in the gallop, plus seeded random twitches.
 * - Hip wings and tail fins: a speed-driven flutter.
 * - Breathing: a chest pitch at 12 → 40 breaths/min with exertion, recovering slowly; the neck base cancels it.
 */
export class SecondaryMotion {
  readonly tailYaw: SpringState[];
  readonly tailPitch: SpringState[];
  readonly ears: Array<{ bone: number; backSign: number; s: SpringState }>;
  readonly fins: Array<{ bone: number; phase: number; s: SpringState }>;
  exertion = 0;
  private breathPhase = 0;
  private time = 0;
  private nextTwitch: number;
  private readonly tail: number[];
  private readonly radius: number[];
  private readonly chest: number[];
  private readonly neckBase: number;
  private readonly tailYawLimit: number;
  private readonly tailPitchLimit: number;

  constructor(rig: MotionRig, s: RigSkeleton, private readonly world: CollisionWorld, private readonly t: SecondaryTuning, private readonly rng: () => number) {
    this.tail = rig.chains.tail.map((n) => s.id(n));
    this.tailYaw = this.tail.map(() => ({ x: 0, v: 0 }));
    this.tailPitch = this.tail.map(() => ({ x: 0, v: 0 }));
    this.tailYawLimit = deg(rig.chainLimitsDeg.tail.yaw);
    this.tailPitchLimit = deg(rig.chainLimitsDeg.tail.pitch);
    // tail radius per bone, interpolated between the rig's tail proxies (by position along the chain)
    const known = rig.proxies.filter((p) => rig.chains.tail.includes(p.bone)).map((p) => ({ k: rig.chains.tail.indexOf(p.bone), r: p.radius }))
      .sort((a, b) => a.k - b.k);
    this.radius = this.tail.map((_, k) => {
      if (!known.length) return 0.05;
      if (k <= known[0].k) return known[0].r;
      for (let j = 0; j < known.length - 1; j++) {
        if (k <= known[j + 1].k) return lerp(known[j].r, known[j + 1].r, (k - known[j].k) / (known[j + 1].k - known[j].k));
      }
      return known[known.length - 1].r;
    });
    const earNames = [...rig.ears.L, ...rig.ears.R];
    this.ears = earNames.map((n) => {
      const bone = s.id(n);
      // which sign of rotation about the ear's local X moves its tip backward (−Z at bind)
      const tip0 = new THREE.Vector3(0, s.length[bone], 0).applyQuaternion(s.bindWorldQuat[bone]).z;
      const q = s.bindWorldQuat[bone].clone().multiply(_qa.setFromAxisAngle(AX, 0.01));
      const tip1 = new THREE.Vector3(0, s.length[bone], 0).applyQuaternion(q).z;
      return { bone, backSign: tip1 < tip0 ? 1 : -1, s: { x: 0, v: 0 } };
    });
    const finNames = (['L', 'R'] as const).flatMap((side) => [...rig.wings[side].hipRibs, ...rig.wings[side].finRibs]);
    this.fins = finNames.map((n, k) => ({ bone: s.id(n), phase: k * 0.7, s: { x: 0, v: 0 } }));
    const spine = rig.chains.spine;
    this.chest = spine.slice(-2).map((n) => s.id(n));
    this.neckBase = s.id(rig.chains.neck[0]);
    this.nextTwitch = lerp(t.ears.twitchMin, t.ears.twitchMax, rng());
  }

  get breathRate(): number {
    return lerp(this.t.breath.calmPerMin, this.t.breath.exertedPerMin, this.exertion) / 60;
  }

  update(inp: SecondaryInput, dt: number): void {
    const t = this.t;
    this.time += dt;
    const n = this.tail.length;
    const latAccel = inp.speed * inp.yawRate;
    for (let k = 0; k < n; k++) {
      const f = (k + 1) / n;
      const omega = lerp(t.tail.omegaBase, t.tail.omegaTip, k / Math.max(n - 1, 1));
      const yawT = clamp((t.tail.turnGain * inp.yawRate + t.tail.latAccelGain * latAccel) * f, -this.tailYawLimit, this.tailYawLimit);
      const pitchT = clamp(-deg(t.tail.droopDeg) + deg(t.tail.gallopRaiseDeg) * inp.gallopWeight - t.tail.vertAccelGain * inp.verticalAccel * f,
        -this.tailPitchLimit, this.tailPitchLimit);
      stepSpring(this.tailYaw[k], yawT, omega, t.tail.zeta, dt);
      stepSpring(this.tailPitch[k], pitchT, omega, t.tail.zeta, dt);
    }
    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0 && this.ears.length) {
      const e = this.ears[Math.min(this.ears.length - 1, Math.floor(this.rng() * this.ears.length))];
      e.s.v += (this.rng() < 0.5 ? -1 : 1) * t.ears.twitchImpulse;
      this.nextTwitch = lerp(t.ears.twitchMin, t.ears.twitchMax, this.rng());
    }
    for (const e of this.ears) stepSpring(e.s, e.backSign * deg(t.ears.gallopBackDeg) * inp.gallopWeight, t.ears.omega, t.ears.zeta, dt);
    const flutter = deg(t.fins.flutterDeg) * Math.min(1, inp.speed / 5);
    for (const f of this.fins) stepSpring(f.s, flutter * Math.sin(TAU * t.fins.flutterHz * this.time + f.phase), t.fins.omega, t.fins.zeta, dt);
    const target = inp.exertion ?? Math.min(1, inp.speed / 10);
    this.exertion = target >= this.exertion ? target : this.exertion + (target - this.exertion) * Math.min(1, dt / t.breath.recoverTime);
    this.breathPhase = fract(this.breathPhase + this.breathRate * dt);
  }

  apply(s: RigSkeleton): void {
    this.applyBreathing(s);
    this.applyAppendages(s);
  }

  /** Chest rise and fall; the neck base cancels it so the head stays steady. Moves the shoulders — apply before leg IK. */
  applyBreathing(s: RigSkeleton): void {
    const b = deg(this.t.breath.amplitudeDeg) * Math.sin(TAU * this.breathPhase);
    for (const c of this.chest) s.localQuat[c].multiply(_qa.setFromAxisAngle(AX, b));
    s.localQuat[this.neckBase].multiply(_qa.setFromAxisAngle(AX, -b * this.chest.length));
  }

  /** Tail, ears and fins (nothing downstream depends on them), then FK and the tail's ground avoidance. */
  applyAppendages(s: RigSkeleton): void {
    for (let k = 0; k < this.tail.length; k++) {
      s.localQuat[this.tail[k]].multiply(_qa.setFromAxisAngle(AZ, this.tailYaw[k].x)).multiply(_qb.setFromAxisAngle(AX, this.tailPitch[k].x));
    }
    for (const e of this.ears) s.localQuat[e.bone].multiply(_qa.setFromAxisAngle(AX, e.s.x));
    for (const f of this.fins) s.localQuat[f.bone].multiply(_qa.setFromAxisAngle(AX, f.s.x));
    s.fk();
    // ground avoidance, base → tip: lift each segment whose end would dip below ground + clearance + radius
    for (let k = 0; k < this.tail.length; k++) {
      const i = this.tail[k];
      s.tail(i, _p);
      if (!this.world.groundAt(_p.x, _p.z, _p.y + 1.5, 4, _hit)) continue;
      const need = _hit.point.y + this.t.tail.clearance + this.radius[k] - _p.y;
      if (need <= 0) continue;
      s.localQuat[i].multiply(_qa.setFromAxisAngle(AX, Math.asin(clamp(need / s.length[i], 0, 1))));
      s.fk();
    }
  }
}
```
(The ground test asserts clearance only, not clearance + radius. The radius term keeps the mesh surface, not just the bone line, off the ground. Only the ears' back direction is computed from geometry; every other rotation sign follows the rig conventions in the Global Constraints.)

- [ ] **Step 5: Run to verify they pass** — `npm test -- tests/motion/look.test.ts tests/motion/secondary.test.ts` → pass; typecheck clean.

- [ ] **Step 6: Commit** — `feat(motion): head/neck look with eyes-first springs; tail, ears, fins and breathing`.

---

### Task 12: `DragonCharacter` — the per-step pipeline

**Files:**
- Create: `src/characters/dragon/motion/dragon.ts`
- Test: `tests/motion/dragon.test.ts`

**Interfaces:**
- Consumes: Tasks 1–11, `InputState` and `mulberry32` (Plan 1).
- Produces:
  - Types: `interface DragonOptions { rig; world; tuning?; clips?; posesMeta?; seed? }`, `interface DragonFrameInput { input; cameraYaw; cameraPos }`, `type DragonHook = (dragon, dt) => void`, `interface MotionMods { speedCap; gait; maxTiltDeg; up; scripted }`
  - `mods.scripted`: a scripted action owns the body position (scramble, hop; M6 jump), so the kinematics step is skipped.
  - `class DragonCharacter`, public fields and methods:
    - modules: `tuning`, `skeleton`, `controller`, `intent`, `kin`, `gait`, `planner`, `body`, `legs`, `layers`, `look`, `secondary`, `proxies`
    - state: `world`, `mods`, `hooks { beforeMove; preFinals; face }`, `time`, `nanResets`, `verticalAccel`
    - `spawn(x, z, heading)`, `update(frame, dt)`, `writeTo(bones, alpha)`, `chestPos(out)`
- The gait's stride limit is set once from the legs' envelopes: `gait.strideFrac` × the shortest fore-aft envelope.
- `update` runs spec §6.1 in order, recomputing the pose absolutely:
  1. input → intent
  2. kinematics + proxy slide
  3. gait — turning on the spot drives it too
  4. feet — the strain of each leg is extrapolated `planner.strainLookahead` steps ahead, the reach ratio and the joint-limit margin separately (either can race toward its limit while the other is calm) → early lift-offs. The planner also gets the current hips and reach (landing reach clamp).
  5. body — riding on max(paw supports, terrain `body.terrainLookahead` s ahead under the shoulders/hips)
  6. `resetToBind` → body → library layers → breathing
  7. finals: look → leg IK → tail/ears/fins
  8. face hooks, then the NaN guard
- `mods` are per-step motion modifiers: climbing sets them in Task 14; M6 actions may too. `hooks` are the M6 extension points. `wings_folded` is layered at weight 1 whenever the clip is available.

- [ ] **Step 1: Write the failing tests** (headless, fixture rig, 400 m floor)

`tests/motion/dragon.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const bigFloor = () => CollisionWorld.fromObjects([box(400, 1, 400, 0, -0.5, 0)]);
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});
function dragon(seed = 1): DragonCharacter {
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world: bigFloor(), seed });
  d.spawn(0, 0, 0);
  return d;
}

interface Stats { maxSlip: number; maxFloat: number; maxPen: number; lifts: number[] }
/** Drive for `seconds`; measure planted-sole slip (FK sole vs locked contact) and height against the y = 0 floor. */
function drive(d: DragonCharacter, keys: string[], seconds: number, cameraYaw: (t: number) => number = () => 0, pressedAtStart: string[] = []): Stats {
  const st: Stats = { maxSlip: 0, maxFloat: 0, maxPen: 0, lifts: [0, 0, 0, 0] };
  const sole = new THREE.Vector3();
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) {
    d.update({ input: input(keys, k === 0 ? pressedAtStart : []), cameraYaw: cameraYaw(k * DT), cameraPos: CAM }, DT);
    d.planner.paws.forEach((paw, i) => {
      if (paw.justLifted) st.lifts[i]++;
      d.legs.soleWorld(i, d.skeleton, sole);
      st.maxPen = Math.max(st.maxPen, -sole.y);
      if (!paw.planted) return;
      st.maxSlip = Math.max(st.maxSlip, sole.distanceTo(paw.pos));
      st.maxFloat = Math.max(st.maxFloat, sole.y);
    });
  }
  return st;
}

describe('DragonCharacter on flat ground', () => {
  it('stands still with planted paws', () => {
    const d = dragon();
    const st = drive(d, [], 2);
    expect(d.nanResets).toBe(0);
    expect(d.planner.paws.every((p) => p.planted)).toBe(true);
    expect(d.body.pose.pelvisPos.y).toBeCloseTo(1.02, 1);
    expect(st.maxSlip).toBeLessThan(1e-3);
  });
  it('trots forward; planted paws never slip, float or sink', () => {
    const d = dragon();
    const st = drive(d, ['KeyW'], 5);
    expect(d.kin.pos.z).toBeGreaterThan(10);
    expect(st.maxSlip).toBeLessThanOrEqual(0.01);
    expect(st.maxFloat).toBeLessThanOrEqual(0.02);
    expect(st.maxPen).toBeLessThanOrEqual(0.02);
    for (const l of st.lifts) expect(l).toBeGreaterThanOrEqual(4);
    expect(d.nanResets).toBe(0);
  });
  it('gallops to 10 m/s without slipping', { timeout: 30_000 }, () => {
    const d = dragon();
    const st = drive(d, ['KeyW', 'ShiftLeft'], 4);
    expect(d.kin.speed).toBeGreaterThan(9.5);
    expect(st.maxSlip).toBeLessThanOrEqual(0.01);
    expect(st.maxPen).toBeLessThanOrEqual(0.02);
    expect(d.nanResets).toBe(0);
  });
  it('prowls at 1.4 m/s', () => {
    const d = dragon();
    const st = drive(d, ['KeyW', 'KeyC'], 3, () => 0, ['KeyC']);
    expect(d.kin.speed).toBeCloseTo(1.4, 6);
    expect(st.maxSlip).toBeLessThanOrEqual(0.01);
  });
  it('turns on the spot by stepping', () => {
    const d = dragon();
    const st = drive(d, ['KeyW'], 2, () => Math.PI);
    expect(Math.cos(d.kin.heading)).toBeLessThan(-0.95);
    for (const l of st.lifts) expect(l).toBeGreaterThanOrEqual(1);
    expect(st.maxSlip).toBeLessThanOrEqual(0.01);
  });
  it('is deterministic', () => {
    const a = dragon(5);
    const b = dragon(5);
    drive(a, ['KeyW'], 3, (t) => 0.7 * t);
    drive(b, ['KeyW'], 3, (t) => 0.7 * t);
    for (let i = 0; i < a.skeleton.count; i++) expect(a.skeleton.localQuat[i].toArray()).toEqual(b.skeleton.localQuat[i].toArray());
  });
  it('keeps bone rotations bounded over a minute of circling (the spin-bug check)', { timeout: 120_000 }, () => {
    const d = dragon();
    const first = new Array(d.skeleton.count).fill(0);
    const last = new Array(d.skeleton.count).fill(0);
    for (let k = 0; k < 7200; k++) {
      const t = k * DT;
      d.update({ input: input(['KeyW']), cameraYaw: 0.5 * t, cameraPos: CAM }, DT);
      for (let i = 0; i < d.skeleton.count; i++) {
        const a = d.skeleton.angleFromBind(i);
        if (t < 10) first[i] = Math.max(first[i], a);
        if (t >= 50) last[i] = Math.max(last[i], a);
      }
    }
    for (let i = 0; i < d.skeleton.count; i++) {
      if (d.skeleton.parent[i] < 0) continue; // the root bone carries the world heading — it may turn all the way round
      expect(last[i], d.skeleton.names[i]).toBeLessThanOrEqual(first[i] + 0.3);
      expect(last[i], d.skeleton.names[i]).toBeLessThan(2.8);
    }
    expect(d.nanResets).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/dragon.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `dragon.ts`**

```ts
import * as THREE from 'three';
import type { InputState } from '../../../core/input';
import { mulberry32 } from '../../../core/rng';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import { BodyKinematics, DragonController, createIntent, type MoveIntent } from './controller';
import { BodySolver } from './bodySolver';
import { FootPlanner, type PlannerBody } from './footPlanner';
import { GaitEngine, NO_GAIT_MODS, type GaitMods } from './gait';
import { LegRig } from './legs';
import { LookController } from './look';
import { PoseLayerStack, type PosesMeta } from './poseLayers';
import { BodyProxies } from './proxies';
import type { MotionRig } from './rigTypes';
import { SecondaryMotion } from './secondary';
import { RigSkeleton } from './skeleton';
import { DEFAULT_TUNING, mergeTuning, type MotionTuning } from './tuning';
import { dampFactor, deg, rotY } from './math';

export interface DragonOptions {
  rig: MotionRig;
  world: CollisionWorld;
  tuning?: MotionTuning;
  /** Pose-library clips (toothless.poses.glb) and their masks (toothless.poses.json). */
  clips?: ReadonlyMap<string, THREE.AnimationClip>;
  posesMeta?: PosesMeta;
  seed?: number;
}

export interface DragonFrameInput {
  readonly input: InputState;
  /** Yaw of the camera's forward direction (camera-relative controls). */
  readonly cameraYaw: number;
  readonly cameraPos: THREE.Vector3;
}

export type DragonHook = (dragon: DragonCharacter, dt: number) => void;

/** Per-step motion modifiers — climbing (Task 14) and M6 actions set these before the kinematics run. */
export interface MotionMods {
  speedCap: number;
  gait: GaitMods;
  maxTiltDeg: number;
  /** Body up axis for foothold searches. */
  readonly up: THREE.Vector3;
  /** A scripted action owns kin.pos/heading this step: skip the kinematics and proxy slide. */
  scripted: boolean;
}

/**
 * Toothless's motion (spec §6.1). Every fixed step recomputes the whole pose ABSOLUTELY from bind (spec §3.4) and
 * depends only on its inputs, so the Motion Lab and tests can step it deterministically.
 */
export class DragonCharacter {
  readonly tuning: MotionTuning;
  readonly world: CollisionWorld;
  readonly skeleton: RigSkeleton;
  readonly controller = new DragonController();
  readonly intent: MoveIntent = createIntent();
  readonly kin = new BodyKinematics();
  readonly gait: GaitEngine;
  readonly planner: FootPlanner;
  readonly body: BodySolver;
  readonly legs: LegRig;
  readonly layers: PoseLayerStack;
  readonly look: LookController;
  readonly secondary: SecondaryMotion;
  readonly proxies: BodyProxies;
  readonly mods: MotionMods;
  readonly hooks: { beforeMove: DragonHook[]; preFinals: DragonHook[]; face: DragonHook[] } = { beforeMove: [], preFinals: [], face: [] };
  time = 0;
  nanResets = 0;
  verticalAccel = 0;
  private readonly head: number;
  private readonly chest: number;
  private readonly strain = [0, 0, 0, 0];
  private readonly prevStretch = [0, 0, 0, 0];
  private readonly prevMargin = [0, 0, 0, 0];
  private readonly hips = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly reach: number[];
  private readonly groundProbe = new THREE.Vector3();
  private readonly groundHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private readonly targets = {
    sole: [0, 1, 2, 3].map(() => new THREE.Vector3()),
    normal: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0)),
    planted: [true, true, true, true],
    s: [1, 1, 1, 1],
  };
  private prevPelvisY = 0;
  private prevVy = 0;

  constructor(opts: DragonOptions) {
    this.world = opts.world;
    this.tuning = opts.tuning ?? mergeTuning(DEFAULT_TUNING, undefined);
    const t = this.tuning;
    this.skeleton = new RigSkeleton(opts.rig);
    this.gait = new GaitEngine(t.gait);
    this.planner = new FootPlanner(opts.rig, opts.world, t.planner);
    this.body = new BodySolver(opts.rig, this.skeleton, t.body);
    this.legs = new LegRig(opts.rig, this.skeleton, t.legs);
    this.planner.setEnvelope(this.legs.envelope.forward, this.legs.envelope.backward);
    this.reach = this.legs.legs.map((l) => l.reach);
    const env = this.legs.envelope;
    this.gait.setStrideLimit(t.gait.strideFrac * Math.min(...env.forward.map((f, i) => f + env.backward[i])));
    this.layers = new PoseLayerStack(this.skeleton, opts.clips ?? new Map(), opts.posesMeta ?? { clips: {} });
    if (this.layers.has('wings_folded')) this.layers.set('wings_folded', 1);
    const rng = mulberry32(opts.seed ?? 1);
    this.look = new LookController(opts.rig, this.skeleton, t.look, rng);
    this.secondary = new SecondaryMotion(opts.rig, this.skeleton, opts.world, t, rng);
    this.proxies = new BodyProxies(opts.rig, this.skeleton);
    this.mods = { speedCap: Infinity, gait: NO_GAIT_MODS, maxTiltDeg: t.body.maxTiltDeg, up: new THREE.Vector3(0, 1, 0), scripted: false };
    this.head = this.skeleton.id(opts.rig.chains.neck[opts.rig.chains.neck.length - 1]);
    this.chest = this.skeleton.id(opts.rig.chains.spine[opts.rig.chains.spine.length - 1]);
  }

  spawn(x: number, z: number, heading: number): void {
    const g = this.world.groundAt(x, z, 1000, 2000);
    const y = g ? g.point.y : 0;
    this.kin.spawn(x, y, z, heading);
    this.gait.reset();
    this.planner.reset(this.plannerBody());
    this.body.reset(this.kin.pos, heading, y);
    const s = this.skeleton;
    s.resetToBind();
    this.body.apply(s);
    this.layers.apply(s);
    s.fk();
    this.fillTargets();
    this.legs.solve(s, this.targets, this.body.pose.bodyQuat);
    s.fk();
    s.snapshot();
    for (let i = 0; i < 4; i++) {
      this.prevStretch[i] = this.legs.stretch[i];
      this.prevMargin[i] = this.legs.margin[i];
    }
    this.prevPelvisY = this.body.pose.pelvisPos.y;
    this.prevVy = 0;
    this.verticalAccel = 0;
    this.time = 0;
  }

  update(frame: DragonFrameInput, dt: number): void {
    const t = this.tuning;
    const s = this.skeleton;
    s.snapshot();
    // 1) input → intent (hooks may adjust mods first: climbing, actions)
    this.controller.read(frame.input, frame.cameraYaw, t.controller, this.intent);
    for (const h of this.hooks.beforeMove) h(this, dt);
    // 2) kinematics; the body proxies slide along steep geometry (skipped while a scripted action owns the body)
    if (!this.mods.scripted) {
      this.kin.plan(this.intent, dt, t.controller, this.mods.speedCap);
      this.proxies.update(s);
      this.proxies.resolveMove(this.world, this.kin.delta);
      this.kin.commit(this.kin.delta, dt);
    }
    // 3) gait — turning on the spot drives the phase too, so the feet step around
    this.gait.update(Math.max(this.kin.speed, Math.abs(this.kin.yawRate) * t.gait.turnStepRadius), dt, this.mods.gait);
    // 4) feet: lift a paw early when its leg is predicted to over-stretch within two steps
    for (let i = 0; i < 4; i++) {
      // extrapolate reach and joint-limit margin separately (either can race toward its limit while the other is calm)
      const st = this.legs.stretch[i];
      const m = this.legs.margin[i];
      const ahead = t.planner.strainLookahead;
      const predReach = st + ahead * (st - this.prevStretch[i]);
      const predMargin = m + ahead * (m - this.prevMargin[i]);
      this.strain[i] = Math.max(predReach, 1 - predMargin / deg(t.legs.limitMarginDeg));
      this.prevStretch[i] = st;
      this.prevMargin[i] = m;
      this.legs.hip(i, s, this.hips[i]);
    }
    this.planner.setLegs(this.hips, this.reach);
    this.planner.update(this.plannerBody(), this.gait, this.strain, dt);
    this.kin.pos.y = (this.planner.support(0) + this.planner.support(1) + this.planner.support(2) + this.planner.support(3)) / 4;
    // 5) body
    const pose = this.body.update(this.kin, this.planner, this.gait, this.legs.shortfall, this.mods.maxTiltDeg, dt,
      this.groundUnder(1, 3), this.groundUnder(0, 2));
    this.secondary.update({ yawRate: this.kin.yawRate, speed: this.kin.speed, verticalAccel: this.verticalAccel, gallopWeight: this.gait.gallopWeight }, dt);
    // 6) the absolute pose: bind → body → library layers → breathing
    s.resetToBind();
    this.body.apply(s);
    this.layers.apply(s);
    this.secondary.applyBreathing(s);
    s.fk();
    for (const h of this.hooks.preFinals) h(this, dt);
    // 7) procedural finals: look, leg IK, tail/ears/fins
    this.look.update({
      moving: this.kin.speed > 0.2, heading: this.kin.heading, yawRate: this.kin.yawRate,
      bodyQuat: pose.bodyQuat, headPos: s.worldPos[this.head], cameraPos: frame.cameraPos,
    }, dt);
    this.look.apply(s);
    s.fk();
    this.fillTargets();
    this.legs.solve(s, this.targets, pose.bodyQuat);
    s.fk();
    this.secondary.applyAppendages(s);
    // 8) face (M6)
    for (const h of this.hooks.face) h(this, dt);
    // pelvis vertical acceleration (tail lag), smoothed
    const vy = (pose.pelvisPos.y - this.prevPelvisY) / dt;
    this.verticalAccel += ((vy - this.prevVy) / dt - this.verticalAccel) * dampFactor(0.05, dt);
    this.prevVy = vy;
    this.prevPelvisY = pose.pelvisPos.y;
    if (!s.isFinite()) {
      s.restorePrev();
      this.nanResets++;
    }
    this.time += dt;
  }

  /** Copy the pose onto the loaded three.js bones, interpolated by the loop's alpha (spec §3.4). */
  writeTo(bones: ReadonlyMap<string, THREE.Object3D>, alpha: number): void {
    this.skeleton.writeTo(bones, alpha);
  }

  chestPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.skeleton.worldPos[this.chest]);
  }

  /** Terrain height under the midpoint of two paws' neutral positions (shoulders: 1, 3; hips: 0, 2). */
  private groundUnder(a: number, b: number): number {
    const p = this.groundProbe;
    p.addVectors(this.planner.neutral[a], this.planner.neutral[b]).multiplyScalar(0.5);
    rotY(p, this.kin.heading, p).add(this.kin.pos).addScaledVector(this.kin.velocity, this.tuning.body.terrainLookahead);
    const hit = this.world.groundAt(p.x, p.z, this.kin.pos.y + 1.5, 4, this.groundHit);
    return hit ? hit.point.y : -Infinity;
  }

  private plannerBody(): PlannerBody {
    return { pos: this.kin.pos, heading: this.kin.heading, velocity: this.kin.velocity, yawRate: this.kin.yawRate, up: this.mods.up };
  }

  private fillTargets(): void {
    for (let i = 0; i < 4; i++) {
      const paw = this.planner.paws[i];
      this.planner.swingPoint(i, this.targets.sole[i]);
      this.planner.swingNormal(i, this.targets.normal[i]);
      this.targets.planted[i] = paw.planted;
      this.targets.s[i] = paw.planted ? 1 : paw.s;
    }
  }
}
```

- [ ] **Step 4: Run and tune until green** — `npm test -- tests/motion/dragon.test.ts`.
  - These are the M5 flat-ground acceptance gates.
  - If slip or float fails, find the cause with the `drive` stats: which leg, which gait, `legs.stretch`, `legs.shortfall`.
  - Then fix it in code or `tuning.ts` — in this order: `planner.overstretch`, `planner.raibertGain`, `body.crouch*`, `legs.scapulaFollow`, `controller.inPlaceTurnRateDeg`.
  - **Do not change a threshold in the test.**
  - Record the tuned values and why in the task report.

- [ ] **Step 5: Commit** — `feat(motion): DragonCharacter — the §6.1 per-step pipeline with absolute poses, NaN guard and M6 hooks`.

---

### Task 13: Orbit camera and camera-proximity fade

**Files:**
- Create: `src/camera/orbitCamera.ts`, `src/characters/dragon/fade.ts`
- Test: `tests/camera/orbitCamera.test.ts`, `tests/characters/fade.test.ts`

**Interfaces:**
- Consumes: `CollisionWorld` (Task 4), tuning/math/springs (Tasks 1, 6), `addCompileHook` (Plan 1 `src/render/materials.ts`).
- Produces:
  - `interface CameraFollow { chest; velocity; heading; moving; climbing; bodySpheres }`, `interface CameraInput { mouseDX; mouseDY; wheel }`
  - `class OrbitCamera`:
    - fields: `yaw` (forward yaw, for camera-relative controls), `pitch`, `distance`, `currentDistance`, `target`, `position`, `fade`, `world` (swappable)
    - `reset(follow)`, `update(input, follow, dt)`, `apply(camera)`
  - `dragonFade: { value: number }`, `applyDitherFade(materials, uniform = dragonFade)`

- [ ] **Step 1: Write the failing tests**

`tests/camera/orbitCamera.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OrbitCamera, type CameraFollow } from '../../src/camera/orbitCamera';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld } from '../../src/world/collision';
import { box, floor, flatWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const T = DEFAULT_TUNING.camera;
const follow = (o: Partial<CameraFollow> = {}): CameraFollow => ({
  chest: new THREE.Vector3(0, 1.25, 0), velocity: new THREE.Vector3(), heading: 0, moving: false, climbing: false,
  bodySpheres: [{ center: new THREE.Vector3(0, 1.0, 0.6), radius: 0.44 }], ...o,
});
const still = { mouseDX: 0, mouseDY: 0, wheel: 0 };
function settle(c: OrbitCamera, f: CameraFollow, seconds: number, inp = still): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) c.update(k === 0 ? inp : still, f, DT);
}
/** A 5 m-high wall across X whose near face is 3 m behind the chest. */
const wallBehind = () => CollisionWorld.fromObjects([floor(), box(20, 5, 1, 0, 2.5, -3.5)]);

describe('OrbitCamera', () => {
  it('sits behind and above the dragon at the set distance and pitch', () => {
    const c = new OrbitCamera(T, flatWorld());
    const f = follow();
    c.reset(f);
    settle(c, f, 2);
    const p = THREE.MathUtils.degToRad(T.pitchDeg);
    expect(c.position.distanceTo(new THREE.Vector3(0, 1.25 + T.distance * Math.sin(p), -T.distance * Math.cos(p)))).toBeLessThan(1e-3);
  });
  it('pulls in at a wall and never ends inside geometry', () => {
    const w = wallBehind();
    const c = new OrbitCamera(T, w);
    const f = follow();
    c.reset(f);
    settle(c, f, 1);
    expect(c.position.z).toBeGreaterThan(-3);
    expect(w.closestPoint(c.position, T.radius * 0.5)).toBeNull();
  });
  it('eases back out slowly when the obstacle is gone', () => {
    const c = new OrbitCamera(T, wallBehind());
    const f = follow();
    c.reset(f);
    settle(c, f, 1);
    const near = c.currentDistance;
    c.world = flatWorld();
    settle(c, f, 0.25);
    expect(c.currentDistance).toBeLessThan(T.distance - 1);
    expect(c.currentDistance).toBeGreaterThan(near);
    settle(c, f, 5);
    expect(c.currentDistance).toBeCloseTo(T.distance, 1);
  });
  it('recentres behind a moving dragon after ~2 s without mouse input', () => {
    const c = new OrbitCamera(T, flatWorld());
    const f = follow({ moving: true, heading: 0 });
    c.reset(f);
    c.yaw = Math.PI / 2;
    settle(c, f, 1.5);
    expect(c.yaw).toBeCloseTo(Math.PI / 2, 6);
    settle(c, f, 6);
    expect(Math.abs(c.yaw)).toBeLessThan(0.1);
  });
  it('orbits with the mouse and clamps the zoom', () => {
    const c = new OrbitCamera(T, flatWorld());
    const f = follow();
    c.reset(f);
    c.update({ mouseDX: 100, mouseDY: 0, wheel: 0 }, f, DT);
    expect(c.yaw).toBeCloseTo(-100 * T.sensitivity, 9);
    c.update({ mouseDX: 0, mouseDY: 0, wheel: 1e5 }, f, DT);
    expect(c.distance).toBe(T.maxDistance);
    c.update({ mouseDX: 0, mouseDY: 0, wheel: -1e5 }, f, DT);
    expect(c.distance).toBe(T.minDistance);
  });
  it('fades the dragon when the camera is forced close to the body', () => {
    const c = new OrbitCamera(T, CollisionWorld.fromObjects([floor(), box(20, 5, 1, 0, 2.5, -1.2)]));
    const f = follow();
    c.reset(f);
    settle(c, f, 1);
    expect(c.fade).toBeGreaterThan(0.3);
    const far = new OrbitCamera(T, flatWorld());
    far.reset(f);
    settle(far, f, 1);
    expect(far.fade).toBe(0);
  });
});
```

`tests/characters/fade.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyDitherFade, dragonFade } from '../../src/characters/dragon/fade';

describe('applyDitherFade', () => {
  it('adds a dither-discard compile hook driven by the shared uniform', () => {
    const m = new THREE.MeshStandardMaterial();
    applyDitherFade([m]);
    expect(m.customProgramCacheKey()).toContain('dragonfade');
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('berkDragonFade');
    expect(shader.fragmentShader).toContain('discard');
    expect(shader.uniforms.berkDragonFade).toBe(dragonFade);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/camera tests/characters/fade.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement `src/camera/orbitCamera.ts`**

```ts
import * as THREE from 'three';
import type { CollisionWorld } from '../world/collision';
import type { MotionTuning } from '../characters/dragon/motion/tuning';
import { angleDiff, clamp, dampFactor, deg, smoothstep, wrapAngle } from '../characters/dragon/motion/math';
import { Vec3Spring, stepSpring, type SpringState } from '../characters/dragon/motion/springs';

type CameraTuning = MotionTuning['camera'];

export interface CameraFollow {
  /** Chest-height point to orbit. */
  readonly chest: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly heading: number;
  readonly moving: boolean;
  readonly climbing: boolean;
  /** Body spheres (world) for the proximity fade. */
  readonly bodySpheres: ReadonlyArray<{ center: THREE.Vector3; radius: number }>;
}

export interface CameraInput {
  mouseDX: number;
  mouseDY: number;
  wheel: number;
}

const _goal = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();

/**
 * Third-person orbit camera (spec §6.15):
 * - Orbits a chest-height target; the mouse moves it under pointer lock, the wheel sets the distance (4–18 m).
 * - Follows with a critically damped spring and velocity look-ahead.
 * - Sphere-casts from the target, pulling in instantly and easing back out slowly, and never ends inside geometry.
 * - Recentres behind him after ~2 s without mouse input while he moves; raises its pitch while he climbs.
 * - Reports a `fade` when forced within ~1.2 m of his body.
 */
export class OrbitCamera {
  yaw = 0;
  pitch: number;
  distance: number;
  currentDistance: number;
  fade = 0;
  readonly target = new THREE.Vector3();
  readonly position = new THREE.Vector3();
  private readonly follow = new Vec3Spring();
  private readonly climbPitch: SpringState = { x: 0, v: 0 };
  private readonly dist: SpringState = { x: 0, v: 0 };
  private sinceMouse = 0;

  constructor(private readonly t: CameraTuning, public world: CollisionWorld) {
    this.pitch = deg(t.pitchDeg);
    this.distance = t.distance;
    this.currentDistance = t.distance;
  }

  reset(f: CameraFollow): void {
    this.yaw = f.heading;
    this.pitch = deg(this.t.pitchDeg);
    this.distance = this.t.distance;
    this.currentDistance = this.distance;
    this.dist.x = this.distance;
    this.dist.v = 0;
    this.climbPitch.x = this.climbPitch.v = 0;
    this.sinceMouse = 0;
    this.follow.reset(f.chest);
    this.target.copy(f.chest);
  }

  update(input: CameraInput, f: CameraFollow, dt: number): void {
    const t = this.t;
    if (input.mouseDX !== 0 || input.mouseDY !== 0) this.sinceMouse = 0;
    else this.sinceMouse += dt;
    this.yaw = wrapAngle(this.yaw - input.mouseDX * t.sensitivity);
    this.pitch = clamp(this.pitch + input.mouseDY * t.sensitivity, deg(t.minPitchDeg), deg(t.maxPitchDeg));
    this.distance = clamp(this.distance * Math.exp(input.wheel * t.wheelScale), t.minDistance, t.maxDistance);
    if (f.moving && this.sinceMouse > t.recentreDelay) this.yaw = wrapAngle(this.yaw + angleDiff(this.yaw, f.heading) * dampFactor(1 / t.recentreOmega, dt));
    stepSpring(this.climbPitch, f.climbing ? deg(t.climbPitchDeg) : 0, 3, 1, dt);

    _goal.copy(f.chest).addScaledVector(f.velocity, t.lookAhead);
    this.follow.step(_goal, t.followOmega, 1, dt);
    this.target.copy(this.follow.x);

    const pitch = clamp(this.pitch + this.climbPitch.x, deg(t.minPitchDeg), deg(t.maxPitchDeg));
    _dir.set(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch));
    _want.copy(this.target).addScaledVector(_dir, this.distance);
    const free = this.world.sphereCast(this.target, _want, t.radius) * this.distance;
    if (free < this.dist.x) {
      this.dist.x = free; // pull in at once
      this.dist.v = 0;
    } else {
      stepSpring(this.dist, free, t.easeOutOmega, 1, dt); // ease back out slowly
    }
    this.currentDistance = this.dist.x;
    this.position.copy(this.target).addScaledVector(_dir, this.currentDistance);
    for (let k = 0; k < 10 && this.world.closestPoint(this.position, t.radius * 0.5); k++) {
      this.dist.x = this.currentDistance *= 0.8;
      this.position.copy(this.target).addScaledVector(_dir, this.currentDistance);
    }

    let nearest = Infinity;
    for (const s of f.bodySpheres) nearest = Math.min(nearest, this.position.distanceTo(s.center) - s.radius);
    this.fade = 1 - smoothstep(t.fadeNear, t.fadeFar, nearest);
  }

  apply(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.position);
    camera.lookAt(this.target);
  }
}
```

- [ ] **Step 4: Implement `src/characters/dragon/fade.ts`**

```ts
import type * as THREE from 'three';
import { addCompileHook } from '../../render/materials';

/** Shared camera-proximity fade (0 = opaque, 1 = gone) — the orbit camera writes it each frame. */
export const dragonFade = { value: 0 };

/**
 * Screen-door fade with a 4×4 ordered-dither pattern: fragments below the fade level are discarded. It needs no
 * transparency sorting, so AO and shadows are unaffected. Apply once to the dragon's materials after the app pipeline.
 */
export function applyDitherFade(materials: readonly THREE.Material[], uniform: { value: number } = dragonFade): void {
  for (const m of materials) {
    addCompileHook(m, 'dragonfade', (shader) => {
      shader.uniforms.berkDragonFade = uniform;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float berkDragonFade;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (berkDragonFade > 0.0) {
            const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
            ivec2 cell = ivec2(mod(gl_FragCoord.xy, 4.0));
            if ((BAYER[cell.y * 4 + cell.x] + 0.5) / 16.0 < berkDragonFade) discard;
          }`);
    });
  }
}
```

- [ ] **Step 5: Run to verify they pass** — `npm test -- tests/camera tests/characters/fade.test.ts` → pass; typecheck clean.

- [ ] **Step 6: Commit** — `feat(camera): orbit camera with collision, recentre and climb pitch; dithered proximity fade`.

---

### Task 14: Climbing — climb mode, scramble-up, blocked walls, hop-down

**Files:**
- Create: `src/characters/dragon/motion/climbing.ts`
- Modify: `src/characters/dragon/motion/dragon.ts` (create and attach the controller)
- Test: `tests/motion/climbing.test.ts`

**Interfaces:**
- Consumes: `DragonCharacter` + `mods` + `hooks.beforeMove` (Task 12), `FootPlanner.forceStep/autoStep/neutral` (Task 7), `BodySolver.override/hipHeight/impulse` (Task 8), `BodyProxies` (Task 6), `CollisionWorld.isInside` (Task 4), `MotionTuning['climb']` (Task 6).
- Produces:
  - `type ClimbMode = 'ground' | 'climb' | 'scramble' | 'blocked' | 'hop'`
  - `interface ClimbProbe { slopeDeg; slopeNormal; wall; wallDist; wallPoint; wallNormal; step; ledge; ledgeHeight; ledgeTop; drop; dropPoint }`
  - `class ClimbController { mode; t; probe; frontExtent; constructor(world, climbTuning, frontExtent, stepMax); attach(dragon); sense(pos, heading, forepawY, wallHeading?); step(dragon, dt) }`
  - Walls are probed along the **intent** direction while moving, so a wall he slides along stays detected. A "wall" whose top is ≤ `stepMax` (the planner's `maxStepUp`) is a **step**: he walks up it. The forepaw height is the *lower* forepaw, because on stairs the two can stand on different steps.
  - `DragonCharacter.climb` is created in the constructor and attached to `hooks.beforeMove`.
  - `frontExtent` is how far the body proxies reach ahead of the character origin at bind (the muzzle). Wall distances are measured from the origin, so the head proxy stopping at a wall still counts as "at the wall".
- Behaviour, per spec §6.6:
  - ≤ 45°: ordinary locomotion.
  - 45–70°: climb mode — speed cap 1.8 m/s (Shift 3), shorter strides, higher swings, tilt up to 60°, wings ~20 % open (`wings_half` layer), footholds searched along a half-tilted up axis.
  - A > 70° wall with a flat ledge top 0.6–2.5 m above the forepaws, when moving into it → **scramble-up**, a ~0.9 s scripted body curve and paw choreography.
  - Any other > 70° wall when moving into it → **blocked**: the intent slides along the wall, or turns along it when heading straight in, at ≤ 1.8 m/s.
  - A drop > 1.5 m ahead while moving → **hop down**: a ballistic body with paws reaching for the landing, then a landing absorb.

- [ ] **Step 1: Write the failing tests** (the full character on fixtures, headless)

`tests/motion/climbing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, dropWorld, floor, rampWorld, wallWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const input = (keys: string[]): InputState => ({
  keys: new Set(keys), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});
function run(world: CollisionWorld, keys: string[], seconds: number, onStep?: (d: DragonCharacter) => void): DragonCharacter {
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world });
  d.spawn(0, -6, 0);
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    d.update({ input: input(keys), cameraYaw: 0, cameraPos: CAM }, DT);
    onStep?.(d);
  }
  return d;
}

describe('climbing', () => {
  it('walks up a 30° ramp in ordinary locomotion, body pitched with the slope', { timeout: 60_000 }, () => {
    let maxPitch = 0;
    const modes = new Set<string>();
    const d = run(rampWorld(30, -2), ['KeyW'], 4.5, (x) => {
      modes.add(x.climb.mode);
      maxPitch = Math.max(maxPitch, x.body.pose.pitch);
    });
    expect(modes.has('climb')).toBe(false);
    expect(THREE.MathUtils.radToDeg(maxPitch)).toBeGreaterThan(20);
    expect(d.kin.pos.y).toBeGreaterThan(3);
    expect(d.nanResets).toBe(0);
  });
  it('switches to climb mode on a 55° slope and caps the speed', { timeout: 60_000 }, () => {
    let climbing = 0;
    let maxClimbSpeed = 0;
    const d = run(rampWorld(55, -2), ['KeyW'], 6, (x) => {
      if (x.climb.mode !== 'climb') return;
      climbing++;
      if (climbing > 30) maxClimbSpeed = Math.max(maxClimbSpeed, x.kin.speed); // after braking to the cap
    });
    expect(climbing).toBeGreaterThan(60);
    expect(maxClimbSpeed).toBeLessThanOrEqual(1.8 + 1e-6);
    expect(d.nanResets).toBe(0);
  });
  it('scrambles up a 2.3 m ledge', { timeout: 60_000 }, () => {
    const modes = new Set<string>();
    const d = run(wallWorld(2.3, 0), ['KeyW'], 3.5, (x) => modes.add(x.climb.mode));
    expect(modes.has('scramble')).toBe(true);
    expect(d.kin.pos.y).toBeGreaterThan(2.2);
    expect(d.kin.pos.z).toBeGreaterThan(0);
    expect(d.nanResets).toBe(0);
  });
  it('is blocked by a 3 m wall and never passes through it', { timeout: 60_000 }, () => {
    let maxChestZ = -Infinity;
    const chest = new THREE.Vector3();
    const wide = CollisionWorld.fromObjects([floor(), box(40, 3, 1, 0, 1.5, 0)]);
    const d = run(wide, ['KeyW'], 5, (x) => {
      maxChestZ = Math.max(maxChestZ, x.chestPos(chest).z);
    });
    expect(d.climb.mode).toBe('blocked');
    expect(maxChestZ).toBeLessThan(-0.5);
    expect(d.nanResets).toBe(0);
  });
  it('hops down a 2 m drop and lands on the lower level', { timeout: 60_000 }, () => {
    const modes = new Set<string>();
    const d = run(dropWorld(2, 0), ['KeyW'], 5, (x) => modes.add(x.climb.mode));
    expect(modes.has('hop')).toBe(true);
    expect(d.kin.pos.y).toBeLessThan(-1.8);
    expect(d.climb.mode).not.toBe('hop');
    expect(d.nanResets).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/climbing.test.ts` → FAIL (`climbing` module / `d.climb` missing).

- [ ] **Step 3: Implement `climbing.ts`**

```ts
import * as THREE from 'three';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import type { DragonCharacter } from './dragon';
import { NO_GAIT_MODS } from './gait';
import type { MotionTuning } from './tuning';
import { deg, rotY, smoothstep } from './math';

type ClimbTuning = MotionTuning['climb'];
export type ClimbMode = 'ground' | 'climb' | 'scramble' | 'blocked' | 'hop';

export interface ClimbProbe {
  slopeDeg: number;
  readonly slopeNormal: THREE.Vector3;
  wall: boolean;
  /** Horizontal distance from the character origin to the wall face. */
  wallDist: number;
  readonly wallPoint: THREE.Vector3;
  /** Horizontal wall normal, pointing away from the wall. */
  readonly wallNormal: THREE.Vector3;
  /** The wall is only a step (top ≤ the foot planner's max step-up): walk up it, don't block or scramble. */
  step: boolean;
  ledge: boolean;
  ledgeHeight: number;
  readonly ledgeTop: THREE.Vector3;
  /** How far the ground ahead lies below the forepaw support (m; 99 when there is none). */
  drop: number;
  readonly dropPoint: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const GRAVITY = 9.81;
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
}

/** Spec §6.6 climbing rules, run before each step's kinematics (DragonCharacter.hooks.beforeMove). */
export class ClimbController {
  mode: ClimbMode = 'ground';
  t = 0;
  readonly probe: ClimbProbe = {
    slopeDeg: 0, slopeNormal: new THREE.Vector3(0, 1, 0), wall: false, wallDist: Infinity, wallPoint: new THREE.Vector3(),
    wallNormal: new THREE.Vector3(), step: false, ledge: false, ledgeHeight: 0, ledgeTop: new THREE.Vector3(), drop: 0, dropPoint: new THREE.Vector3(),
  };
  private duration = 0;
  private stage = 0;
  private readonly fwd = new THREE.Vector3();
  private readonly lat = new THREE.Vector3();
  private readonly p0 = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();
  private readonly p3 = new THREE.Vector3();
  private readonly hopVel = new THREE.Vector3();
  private hopY0 = 0;
  private hopVy = 0;

  /** `frontExtent`: how far the body proxies reach ahead of the character origin at bind (m). */
  constructor(
    private readonly world: CollisionWorld, private readonly c: ClimbTuning, readonly frontExtent: number, private readonly stepMax: number,
  ) {}

  attach(d: DragonCharacter): void {
    d.hooks.beforeMove.push((dragon, dt) => this.step(dragon, dt));
  }

  /** `wallHeading`: direction of the wall probes — the intent direction while moving, so a wall he slides along stays detected. */
  sense(pos: THREE.Vector3, heading: number, forepawY: number, wallHeading = heading): ClimbProbe {
    const p = this.probe;
    const c = this.c;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    _d.set(Math.sin(wallHeading), 0, Math.cos(wallHeading));
    p.slopeDeg = 0;
    p.slopeNormal.set(0, 1, 0);
    if (this.world.groundAt(pos.x + fx * 1.3, pos.z + fz * 1.3, forepawY + 1.5, 4, _hit)) {
      p.slopeNormal.copy(_hit.normal);
      p.slopeDeg = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, _hit.normal.y)));
    }
    p.wall = false;
    p.wallDist = Infinity;
    for (const h of [0.35, 0.9]) {
      _o.set(pos.x, forepawY + h, pos.z);
      const hit = this.world.raycast(_o, _d, this.frontExtent + c.probeAhead, _hit);
      if (hit && Math.abs(hit.normal.y) < Math.cos(deg(c.wallMinDeg)) && hit.distance < p.wallDist) {
        p.wall = true;
        p.wallDist = hit.distance;
        p.wallPoint.copy(hit.point);
        p.wallNormal.set(hit.normal.x, 0, hit.normal.z).normalize();
      }
    }
    p.ledge = false;
    p.step = false;
    if (p.wall) {
      _o.copy(p.wallPoint).addScaledVector(p.wallNormal, -0.35);
      _o.y = forepawY + c.ledgeMax + 0.4;
      if (!this.world.isInside(_o) && this.world.raycast(_o, DOWN, c.ledgeMax + 1, _hit) && _hit.normal.y > 0.8) {
        p.ledgeTop.copy(_hit.point);
        p.ledgeHeight = _hit.point.y - forepawY;
        p.step = p.ledgeHeight <= this.stepMax;
        p.ledge = !p.step && p.ledgeHeight <= c.ledgeMax;
      }
    }
    p.drop = 99;
    if (this.world.groundAt(pos.x + fx * 1.8, pos.z + fz * 1.8, forepawY + 1, 99, _hit)) {
      p.dropPoint.copy(_hit.point);
      p.drop = forepawY - _hit.point.y;
    }
    return p;
  }

  step(d: DragonCharacter, dt: number): void {
    if (this.mode === 'scramble') {
      this.stepScramble(d, dt);
      return;
    }
    if (this.mode === 'hop') {
      this.stepHop(d, dt);
      return;
    }
    const c = this.c;
    this.resetMods(d);
    // the lower forepaw: on stairs the two forepaws can stand on different steps
    const forepawY = Math.min(d.planner.support(1), d.planner.support(3));
    const i = d.intent;
    const moving = i.hasDir && i.speed > 0;
    const p = this.sense(d.kin.pos, d.kin.heading, forepawY, moving ? Math.atan2(i.dirX, i.dirZ) : d.kin.heading);
    const into = moving ? i.dirX * p.wallNormal.x + i.dirZ * p.wallNormal.z : 0;
    if (moving && p.wall && !p.step && into < -0.5 && p.wallDist < this.frontExtent + 0.3) {
      if (p.ledge) {
        this.startScramble(d);
        return;
      }
      this.mode = 'blocked';
      let tx = i.dirX - into * p.wallNormal.x;
      let tz = i.dirZ - into * p.wallNormal.z;
      let len = Math.hypot(tx, tz);
      if (len < 0.3) {
        tx = -p.wallNormal.z;
        tz = p.wallNormal.x;
        if (tx * Math.sin(d.kin.heading) + tz * Math.cos(d.kin.heading) < 0) {
          tx = -tx;
          tz = -tz;
        }
        len = 1;
      }
      i.dirX = tx / len;
      i.dirZ = tz / len;
      i.speed = Math.min(i.speed, c.climbSpeed);
      return;
    }
    if (moving && p.drop > c.dropMin) {
      this.startHop(d);
      return;
    }
    if (p.slopeDeg > c.climbMinDeg && p.slopeDeg <= c.wallMinDeg) {
      this.mode = 'climb';
      d.mods.speedCap = i.gallop ? c.scrambleSpeed : c.climbSpeed;
      d.mods.gait = { cadenceScale: c.cadenceScale, strideScale: c.strideScale, swingScale: c.swingScale };
      d.mods.maxTiltDeg = c.maxTiltDeg;
      d.mods.up.copy(UP).lerp(p.slopeNormal, 0.5).normalize();
      if (d.layers.has('wings_half')) d.layers.set('wings_half', c.wingsOpen / 0.5);
      return;
    }
    this.mode = 'ground';
  }

  private resetMods(d: DragonCharacter): void {
    d.mods.speedCap = Infinity;
    d.mods.gait = NO_GAIT_MODS;
    d.mods.maxTiltDeg = d.tuning.body.maxTiltDeg;
    d.mods.up.copy(UP);
    d.mods.scripted = false;
    d.planner.autoStep = true;
    d.body.override.active = false;
    if (d.layers.has('wings_half')) d.layers.set('wings_half', 0);
  }

  private startScramble(d: DragonCharacter): void {
    const p = this.probe;
    this.mode = 'scramble';
    this.t = 0;
    this.stage = 0;
    this.duration = this.c.scrambleTime;
    this.fwd.set(-p.wallNormal.x, 0, -p.wallNormal.z).normalize();
    this.lat.crossVectors(UP, this.fwd);
    d.kin.heading = Math.atan2(this.fwd.x, this.fwd.z);
    d.kin.speed = 0;
    d.kin.velocity.set(0, 0, 0);
    const top = p.ledgeTop.y;
    this.p0.copy(d.kin.pos);
    this.p1.copy(this.p0).addScaledVector(UP, (top - this.p0.y) * 0.7);
    this.p2.copy(p.wallPoint).addScaledVector(this.fwd, -0.4).setY(top + 0.3);
    this.p3.copy(p.wallPoint).addScaledVector(this.fwd, 0.9).setY(top);
  }

  /** ~0.9 s: body up the curve, nose up; forepaws hook the lip, hind paws follow onto the top, forepaws re-place. */
  private stepScramble(d: DragonCharacter, dt: number): void {
    this.t += dt;
    const tau = Math.min(1, this.t / this.duration);
    bezier(this.p0, this.p1, this.p2, this.p3, smoothstep(0, 1, tau), _p);
    d.mods.scripted = true;
    d.planner.autoStep = false;
    d.kin.pos.x = _p.x;
    d.kin.pos.z = _p.z;
    d.body.override.active = true;
    d.body.override.height = _p.y + d.body.hipHeight;
    d.body.override.pitch = deg(45) * smoothstep(0, 0.3, tau) * (1 - smoothstep(0.55, 1, tau));
    const top = this.probe.ledgeTop.y;
    const lip = (i: number) =>
      _t.copy(this.probe.wallPoint).addScaledVector(this.fwd, 0.12).addScaledVector(this.lat, d.planner.neutral[i].x).setY(top);
    const onTop = (i: number) => rotY(d.planner.neutral[i], d.kin.heading, _t).add(this.p3).setY(top);
    const T = this.duration;
    if (this.stage === 0) {
      d.planner.forceStep(1, lip(1), UP, 0.3 * T, 0.25);
      d.planner.forceStep(3, lip(3), UP, 0.3 * T, 0.25);
      this.stage = 1;
    } else if (this.stage === 1 && tau >= 0.45) {
      d.planner.forceStep(0, onTop(0), UP, 0.35 * T, 0.2);
      d.planner.forceStep(2, onTop(2), UP, 0.35 * T, 0.2);
      this.stage = 2;
    } else if (this.stage === 2 && tau >= 0.7) {
      d.planner.forceStep(1, onTop(1), UP, 0.25 * T, 0.1);
      d.planner.forceStep(3, onTop(3), UP, 0.25 * T, 0.1);
      this.stage = 3;
    }
    if (tau >= 1) {
      this.mode = 'ground';
      d.mods.scripted = false;
      d.planner.autoStep = true;
      d.body.override.active = false;
    }
  }

  private startHop(d: DragonCharacter): void {
    this.mode = 'hop';
    this.t = 0;
    this.hopVel.copy(d.kin.velocity);
    this.hopY0 = d.kin.pos.y;
    this.hopVy = this.c.hopUpSpeed;
    const fall = Math.max(0, this.hopY0 - this.probe.dropPoint.y);
    this.duration = (this.hopVy + Math.sqrt(this.hopVy * this.hopVy + 2 * GRAVITY * fall)) / GRAVITY;
    for (let i = 0; i < 4; i++) {
      rotY(d.planner.neutral[i], d.kin.heading, _t).add(d.kin.pos).addScaledVector(this.hopVel, this.duration);
      const g = this.world.groundAt(_t.x, _t.z, this.hopY0 + 1, fall + 3, _hit);
      if (g) _t.y = g.point.y;
      d.planner.forceStep(i, _t, g ? _hit.normal : UP, this.duration, 0.15);
    }
  }

  private stepHop(d: DragonCharacter, dt: number): void {
    this.t += dt;
    d.mods.scripted = true;
    d.planner.autoStep = false;
    d.kin.pos.addScaledVector(this.hopVel, dt);
    const y = this.hopY0 + this.hopVy * this.t - 0.5 * GRAVITY * this.t * this.t;
    d.body.override.active = true;
    d.body.override.height = Math.max(y, this.probe.dropPoint.y) + d.body.hipHeight;
    d.body.override.pitch = -deg(10) * smoothstep(0, 1, this.t / this.duration);
    if (this.t >= this.duration) {
      this.mode = 'ground';
      d.mods.scripted = false;
      d.planner.autoStep = true;
      d.body.override.active = false;
      d.body.impulse(1.5); // landing absorb
    }
  }
}
```

- [ ] **Step 4: Wire it into `DragonCharacter`** (`dragon.ts`)

Add `import { ClimbController } from './climbing';`, a public field `readonly climb: ClimbController;` and, at the end of the constructor:
```ts
    // how far the body reaches ahead of the origin at bind (the muzzle) — climbing measures walls from the origin
    this.proxies.update(this.skeleton);
    const frontExtent = Math.max(...this.proxies.items.map((p, k) => this.proxies.centers[k].z + p.radius));
    this.climb = new ClimbController(opts.world, t.climb, frontExtent, t.planner.maxStepUp);
    this.climb.attach(this);
```
(At construction the skeleton is at bind with the origin at (0, 0, 0) facing +Z, so a proxy centre's z is its forward offset.)

- [ ] **Step 5: Run and tune until green** — `npm test -- tests/motion/climbing.test.ts`, keeping `tests/motion/dragon.test.ts` green.
  - Tuning levers: the scramble control points and paw timing (`startScramble` / `stepScramble`), `climb.*` in `tuning.ts`, and the probe offsets in `sense`.
  - Never loosen a test threshold. Record the tuned values in the report.

- [ ] **Step 6: Commit** — `feat(motion): climbing — climb mode, scramble-up, blocked walls, hop-down`.

---

### Task 15: Motion Lab — metrics, scripts, headless runner, overlays, live Toothless

**Files:**
- Create: `src/characters/dragon/motion/metrics.ts`, `src/dev/lab/scripts.ts`, `src/dev/lab/labRunner.ts`, `src/dev/lab/overlays.ts`
- Modify: `src/dev/lab/main.ts` (Plan 1 Task 9)
- Test: `tests/motion/metrics.test.ts`, `tests/lab/labRunner.test.ts`
- Output: `docs/progress/img/motion/*.png`

**Interfaces:**
- Consumes:
  - Tasks 1–14.
  - Plan 1: `buildCourse()` (`src/dev/lab/course.ts`), `ScriptedInput`/`InputEvent`/`KeyboardMouseInput`, `createApp`, `debug`, `captureFilmstrip` via `berk.lab.filmstrip`.
  - Plan 2: `loadDragonAsset` (`src/characters/dragon/asset.ts`) and `public/assets/characters/toothless/*`.
- Produces:
  - Metrics: `interface MetricsReport`, `METRIC_LIMITS`, `class MotionMetrics { constructor(world, duration); sample(dragon); report(name) }`
  - Scripts: `interface LabScript { name; description; spawn { x; z; heading }; duration; events; cameraYawRate? }`, `LAB_SCRIPTS: LabScript[]`, `scriptByName(name)`
  - Runner: `interface LabRunOptions { rig; world; script; tuning?; clips?; posesMeta?; onStep? }`, `runLabScript(options) → MetricsReport`
  - Overlays: `type OverlayName`, `class MotionOverlays { root; enabled; toggle(name, on?); update(dragon) }`
  - Debug API:
    - `berk.lab`: `run(name)`, `runAll()`, `play(name)`, `scripts()`, `tuning()`
    - `berk.tp(x, z, heading?)`, `berk.toggle(name)`

- [ ] **Step 1: Write the failing tests**

`tests/motion/metrics.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';

const DT = 1 / 120;
const idle: InputState = { keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 };
function setup() {
  const world = CollisionWorld.fromObjects([box(100, 1, 100, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world });
  d.spawn(0, 0, 0);
  return { world, d, m: new MotionMetrics(world, 2) };
}

describe('MotionMetrics', () => {
  it('passes a dragon standing still', () => {
    const { d, m } = setup();
    for (let k = 0; k < 240; k++) {
      d.update({ input: idle, cameraYaw: 0, cameraPos: new THREE.Vector3(0, 3, -8) }, DT);
      m.sample(d);
    }
    const r = m.report('stand');
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.maxSlip).toBeLessThan(1e-3);
  });
  it('detects a planted paw that slides', () => {
    const { d, m } = setup();
    for (let k = 0; k < 240; k++) {
      if (k === 100) d.planner.paws[0].pos.x += 0.05; // drag a locked contact → the pinned sole slides with it
      d.update({ input: idle, cameraYaw: 0, cameraPos: new THREE.Vector3(0, 3, -8) }, DT);
      m.sample(d);
    }
    const r = m.report('slide');
    expect(r.maxSlip).toBeGreaterThan(0.04);
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/slip/);
  });
});
```

`tests/lab/labRunner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildCourse } from '../../src/dev/lab/course';
import { runLabScript } from '../../src/dev/lab/labRunner';
import { LAB_SCRIPTS, scriptByName } from '../../src/dev/lab/scripts';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const world = CollisionWorld.fromObjects(buildCourse().surfaces);
const rig = toothlessFixtureRig();
const CORE = ['walk-straight', 'trot-straight', 'gallop-straight', 'trot-circle', 'ramp15', 'ramp30', 'side-slope', 'steps-small', 'steps-large'];

describe('Motion Lab scripts (fixture rig, headless)', () => {
  it('defines every course script the spec asks for', () => {
    const names = LAB_SCRIPTS.map((s) => s.name);
    for (const n of [...CORE, 'ramp45', 'ramp60', 'ledge-scramble', 'ledge-blocked', 'boulders', 'corners', 'idle-turn-60s']) expect(names).toContain(n);
  });
  it.each(CORE)('passes every metric: %s', { timeout: 120_000 }, (name) => {
    const r = runLabScript({ rig, world, script: scriptByName(name) });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/motion/metrics.test.ts tests/lab` → FAIL (modules not found).

- [ ] **Step 3: Implement `metrics.ts`**

```ts
import * as THREE from 'three';
import type { CollisionWorld, RayHit, SphereContact } from '../../../world/collision';
import type { DragonCharacter } from './dragon';

export interface MetricsReport {
  name: string;
  steps: number;
  seconds: number;
  maxSlip: number;
  maxPenetration: number;
  maxFloat: number;
  maxProxyPenetration: number;
  limitViolations: number;
  worstLimit: string;
  nanResets: number;
  /** Largest per-bone rotation from bind in the first / last 10 s (rad), for runs ≥ 30 s. */
  boundedFirst: number;
  boundedLast: number;
  pass: boolean;
  failures: string[];
}

/** Spec §8.2 pass criteria. */
export const METRIC_LIMITS = { slip: 0.01, penetration: 0.02, float: 0.02, proxy: 0.02, limitTolDeg: 0.5, boundedGrowth: 0.3, boundedMax: 2.8 };

const _sole = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _contact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

/**
 * Per-step motion metrics (spec §8.2):
 * - planted-foot slip: the FK sole's drift from where it was when the paw planted
 * - paw penetration: any paw below the ground under it
 * - planted float: a planted sole above its ground
 * - body-proxy penetration, joint-limit violations, NaN resets
 * - boundedness: every non-root bone's max rotation in the last 10 s vs the first 10 s (the spin-bug check)
 */
export class MotionMetrics {
  private steps = 0;
  private time = 0;
  private maxSlip = 0;
  private maxPen = 0;
  private maxFloat = 0;
  private maxProxy = 0;
  private violations = 0;
  private worstLimit = '';
  private worstExcess = 0;
  private nan = 0;
  private readonly locked: THREE.Vector3[] = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly wasPlanted = [false, false, false, false];
  private first: number[] = [];
  private last: number[] = [];

  constructor(private readonly world: CollisionWorld, private readonly duration: number) {}

  sample(d: DragonCharacter): void {
    const dt = 1 / 120;
    const s = d.skeleton;
    if (!this.first.length) {
      this.first = new Array(s.count).fill(0);
      this.last = new Array(s.count).fill(0);
    }
    for (let i = 0; i < 4; i++) {
      const paw = d.planner.paws[i];
      d.legs.soleWorld(i, s, _sole);
      const g = this.world.groundAt(_sole.x, _sole.z, _sole.y + 0.5, 3, _hit);
      if (g) this.maxPen = Math.max(this.maxPen, g.point.y - _sole.y);
      if (paw.planted) {
        if (!this.wasPlanted[i] || paw.justPlanted) this.locked[i].copy(_sole);
        this.maxSlip = Math.max(this.maxSlip, _sole.distanceTo(this.locked[i]));
        if (g) this.maxFloat = Math.max(this.maxFloat, _sole.y - g.point.y);
      }
      this.wasPlanted[i] = paw.planted;
    }
    d.proxies.update(s);
    d.proxies.items.forEach((p, k) => {
      const c = this.world.sphereContact(d.proxies.centers[k], p.radius, _contact);
      if (c) this.maxProxy = Math.max(this.maxProxy, c.depth);
    });
    const tol = (METRIC_LIMITS.limitTolDeg * Math.PI) / 180;
    for (const j of d.legs.jointReport(s)) {
      const excess = Math.max(j.lo - j.angle, j.angle - j.hi);
      if (excess > tol) {
        this.violations++;
        if (excess > this.worstExcess) {
          this.worstExcess = excess;
          this.worstLimit = j.name;
        }
      }
    }
    this.nan = d.nanResets;
    for (let b = 0; b < s.count; b++) {
      if (s.parent[b] < 0) continue; // the root carries the world heading
      const a = s.angleFromBind(b);
      if (this.time < 10) this.first[b] = Math.max(this.first[b], a);
      if (this.time >= this.duration - 10) this.last[b] = Math.max(this.last[b], a);
    }
    this.steps++;
    this.time += dt;
  }

  report(name: string): MetricsReport {
    const L = METRIC_LIMITS;
    const failures: string[] = [];
    if (this.maxSlip > L.slip) failures.push(`slip ${this.maxSlip.toFixed(4)} m > ${L.slip}`);
    if (this.maxPen > L.penetration) failures.push(`penetration ${this.maxPen.toFixed(4)} m > ${L.penetration}`);
    if (this.maxFloat > L.float) failures.push(`float ${this.maxFloat.toFixed(4)} m > ${L.float}`);
    if (this.maxProxy > L.proxy) failures.push(`proxy penetration ${this.maxProxy.toFixed(4)} m > ${L.proxy}`);
    if (this.violations > 0) failures.push(`${this.violations} joint-limit violations (worst ${this.worstLimit})`);
    if (this.nan > 0) failures.push(`${this.nan} NaN resets`);
    let bf = 0;
    let bl = 0;
    if (this.duration >= 30) {
      for (let b = 0; b < this.first.length; b++) {
        bf = Math.max(bf, this.first[b]);
        bl = Math.max(bl, this.last[b]);
        if (this.last[b] > this.first[b] + L.boundedGrowth || this.last[b] > L.boundedMax) {
          failures.push(`bone #${b} rotation grew ${this.first[b].toFixed(2)} → ${this.last[b].toFixed(2)} rad`);
          break;
        }
      }
    }
    return {
      name, steps: this.steps, seconds: this.time, maxSlip: this.maxSlip, maxPenetration: this.maxPen, maxFloat: this.maxFloat,
      maxProxyPenetration: this.maxProxy, limitViolations: this.violations, worstLimit: this.worstLimit, nanResets: this.nan,
      boundedFirst: bf, boundedLast: bl, pass: failures.length === 0, failures,
    };
  }
}
```

- [ ] **Step 4: Implement `scripts.ts`** (course coordinates from Plan 1 Task 9's `buildCourse`)

```ts
import type { InputEvent } from '../../core/input';
import { DEFAULT_TUNING } from '../../characters/dragon/motion/tuning';

export interface LabScript {
  name: string;
  description: string;
  spawn: { x: number; z: number; heading: number };
  duration: number;
  events: InputEvent[];
  /** Constant camera orbit rate (rad/s), fed as mouse input (so the camera does not auto-recentre). */
  cameraYawRate?: number;
}

const hold = (keys: string[], from: number, to: number): InputEvent[] => [{ t: from, down: keys }, { t: to, up: keys }];
const prowl = (at = 0): InputEvent[] => [{ t: at, down: ['KeyC'] }, { t: at + 0.05, up: ['KeyC'] }];
/** Mouse pixels that turn the camera by `rad` (camera yaw −= dx · sensitivity). */
const turnPx = (rad: number) => -rad / DEFAULT_TUNING.camera.sensitivity;
const PI = Math.PI;

export const LAB_SCRIPTS: LabScript[] = [
  { name: 'walk-straight', description: 'prowl walk across the pad', spawn: { x: 0, z: 0, heading: 0 }, duration: 10, events: [...prowl(), ...hold(['KeyW'], 0.1, 8)] },
  { name: 'trot-straight', description: 'default trot', spawn: { x: 0, z: 0, heading: 0 }, duration: 8, events: hold(['KeyW'], 0.1, 6) },
  { name: 'gallop-straight', description: 'Shift gallop toward −Z (clear lane at x = 0)', spawn: { x: 0, z: 0, heading: PI }, duration: 6, events: hold(['KeyW', 'ShiftLeft'], 0.1, 4) },
  { name: 'trot-circle', description: 'trot on an 8 m circle', spawn: { x: -8, z: 10, heading: 0 }, duration: 20, events: hold(['KeyW'], 0.1, 20), cameraYawRate: 0.4 },
  ...[15, 30, 45, 60].map((a, i): LabScript => {
    // spawn 6 m before the ramp foot; stop mid-plateau (it ends in a drop of the ramp's full rise)
    const run = 8 * Math.cos((a * PI) / 180);
    const rampSpeed = a > DEFAULT_TUNING.climb.climbMinDeg ? DEFAULT_TUNING.climb.climbSpeed : DEFAULT_TUNING.controller.trotSpeed;
    const walk = 0.7 + 6 / DEFAULT_TUNING.controller.trotSpeed + run / rampSpeed + 2.5 / DEFAULT_TUNING.controller.trotSpeed;
    return {
      name: `ramp${a}`, description: `up the ${a}° ramp onto its plateau`, spawn: { x: -40 + i * 8, z: -8, heading: PI },
      duration: walk + 1.5, events: hold(['KeyW'], 0.1, 0.1 + walk),
    };
  }),
  { name: 'side-slope', description: 'along the 20° side slope (body roll)', spawn: { x: -21, z: 13, heading: 0 }, duration: 4, events: hold(['KeyW'], 0.1, 3) },
  { name: 'steps-small', description: 'prowl up the 0.25 m steps', spawn: { x: 9, z: -10, heading: PI / 2 }, duration: 7, events: [...prowl(), ...hold(['KeyW'], 0.1, 6)] },
  { name: 'steps-large', description: 'prowl up the 0.5 m steps', spawn: { x: 9, z: -2, heading: PI / 2 }, duration: 6, events: [...prowl(), ...hold(['KeyW'], 0.1, 5)] },
  { name: 'ledge-scramble', description: 'scramble up the 2.3 m climb wall', spawn: { x: 0, z: 22, heading: 0 }, duration: 6, events: hold(['KeyW'], 0.1, 5) },
  { name: 'ledge-blocked', description: 'walk into the 3 m ledge: blocked', spawn: { x: 40, z: 0, heading: 0 }, duration: 5, events: hold(['KeyW'], 0.1, 4) },
  { name: 'boulders', description: 'trot through the boulder field', spawn: { x: 26, z: 20, heading: PI / 4 }, duration: 9, events: hold(['KeyW'], 0.1, 8) },
  { name: 'corners', description: 'into the inside corner, then around the pillar', spawn: { x: -27, z: 22, heading: Math.atan2(-6, 7) }, duration: 6, events: hold(['KeyW'], 0.1, 5) },
  {
    name: 'idle-turn-60s', description: '60 s of standing, turning on the spot and short walks', spawn: { x: 0, z: 0, heading: 0 }, duration: 60,
    events: Array.from({ length: 12 }, (_, k): InputEvent[] => [{ t: 5 * k + 1, mouse: [turnPx(PI), 0], down: ['KeyW'] }, { t: 5 * k + 2.5, up: ['KeyW'] }]).flat(),
  },
];

export function scriptByName(name: string): LabScript {
  const s = LAB_SCRIPTS.find((x) => x.name === name);
  if (!s) throw new Error(`unknown lab script '${name}' (have: ${LAB_SCRIPTS.map((x) => x.name).join(', ')})`);
  return s;
}
```

- [ ] **Step 5: Implement `labRunner.ts`**

```ts
import * as THREE from 'three';
import { ScriptedInput } from '../../core/input';
import { OrbitCamera, type CameraFollow } from '../../camera/orbitCamera';
import { DragonCharacter } from '../../characters/dragon/motion/dragon';
import { MotionMetrics, type MetricsReport } from '../../characters/dragon/motion/metrics';
import type { PosesMeta } from '../../characters/dragon/motion/poseLayers';
import type { MotionRig } from '../../characters/dragon/motion/rigTypes';
import type { MotionTuning } from '../../characters/dragon/motion/tuning';
import type { CollisionWorld } from '../../world/collision';
import type { LabScript } from './scripts';

export interface LabRunOptions {
  rig: MotionRig;
  world: CollisionWorld;
  script: LabScript;
  tuning?: MotionTuning;
  clips?: ReadonlyMap<string, THREE.AnimationClip>;
  posesMeta?: PosesMeta;
  onStep?: (d: DragonCharacter, t: number) => void;
}

/** Build the camera's view of the dragon (shared by the runner, the lab page and the game page). */
export function cameraFollow(d: DragonCharacter, out: { chest: THREE.Vector3 }): CameraFollow {
  d.chestPos(out.chest);
  return {
    chest: out.chest, velocity: d.kin.velocity, heading: d.kin.heading, moving: d.kin.speed > 0.2,
    climbing: d.climb.mode === 'climb' || d.climb.mode === 'scramble',
    bodySpheres: d.proxies.items.map((p, k) => ({ center: d.proxies.centers[k], radius: p.radius })),
  };
}

/** Run a script deterministically at 1/120 s with no rendering and return the spec §8.2 metrics. */
export function runLabScript(o: LabRunOptions): MetricsReport {
  const dt = 1 / 120;
  const d = new DragonCharacter({ rig: o.rig, world: o.world, tuning: o.tuning, clips: o.clips, posesMeta: o.posesMeta, seed: 1 });
  d.spawn(o.script.spawn.x, o.script.spawn.z, o.script.spawn.heading);
  const cam = new OrbitCamera(d.tuning.camera, o.world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(d, hold));
  const input = new ScriptedInput(o.script.events);
  const metrics = new MotionMetrics(o.world, o.script.duration);
  const yawPx = o.script.cameraYawRate ? -(o.script.cameraYawRate * dt) / d.tuning.camera.sensitivity : 0;
  const n = Math.round(o.script.duration / dt);
  for (let k = 0; k < n; k++) {
    const t = k * dt;
    const inp = input.sample(t);
    cam.update({ mouseDX: inp.mouseDX + yawPx, mouseDY: inp.mouseDY, wheel: inp.wheel }, cameraFollow(d, hold), dt);
    d.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
    metrics.sample(d);
    o.onStep?.(d, t);
  }
  return metrics.report(o.script.name);
}
```
- [ ] **Step 6: Implement `overlays.ts`** (dev-only lines/points; Plan 1 Ruling 3 exempts dev overlays from the material pipeline)

```ts
import * as THREE from 'three';
import type { DragonCharacter } from '../../characters/dragon/motion/dragon';

export type OverlayName = 'targets' | 'planted' | 'arcs' | 'support' | 'com' | 'spine' | 'look' | 'proxies';
export const OVERLAY_NAMES: readonly OverlayName[] = ['targets', 'planted', 'arcs', 'support', 'com', 'spine', 'look', 'proxies'];

const MAX = 512;
const _v = new THREE.Vector3();

class LineSet {
  readonly obj: THREE.LineSegments;
  private readonly pos = new Float32Array(MAX * 6);
  private n = 0;
  constructor(color: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    this.obj.renderOrder = 999;
    this.obj.frustumCulled = false;
  }
  clear(): void {
    this.n = 0;
  }
  seg(a: THREE.Vector3, b: THREE.Vector3): void {
    if (this.n >= MAX) return;
    this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z], this.n * 6);
    this.n++;
  }
  flush(): void {
    const attr = this.obj.geometry.attributes.position as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.obj.geometry.setDrawRange(0, this.n * 2);
  }
}

/** Motion Lab overlays (spec §3.5), each toggled with berk.toggle(name). */
export class MotionOverlays {
  readonly root = new THREE.Group();
  readonly enabled = new Set<OverlayName>(['planted', 'targets', 'support']);
  private readonly sets: Record<OverlayName, LineSet> = {
    targets: new LineSet(0x33ddff), planted: new LineSet(0x44ff66), arcs: new LineSet(0xffcc33), support: new LineSet(0xffffff),
    com: new LineSet(0xff3366), spine: new LineSet(0xcc66ff), look: new LineSet(0x66ffff), proxies: new LineSet(0xff8844),
  };

  constructor() {
    this.root.name = 'MotionOverlays';
    for (const s of Object.values(this.sets)) this.root.add(s.obj);
  }

  toggle(name: OverlayName, on?: boolean): boolean {
    const v = on ?? !this.enabled.has(name);
    if (v) this.enabled.add(name);
    else this.enabled.delete(name);
    return v;
  }

  update(d: DragonCharacter): void {
    for (const [name, set] of Object.entries(this.sets) as Array<[OverlayName, LineSet]>) {
      set.clear();
      set.obj.visible = this.enabled.has(name);
    }
    const S = this.sets;
    const cross = (set: LineSet, p: THREE.Vector3, r: number) => {
      set.seg(_v.copy(p).setX(p.x - r), p.clone().setX(p.x + r));
      set.seg(_v.copy(p).setZ(p.z - r), p.clone().setZ(p.z + r));
      set.seg(_v.copy(p).setY(p.y - r), p.clone().setY(p.y + r));
    };
    const planted: THREE.Vector3[] = [];
    d.planner.paws.forEach((paw, i) => {
      if (paw.planted) {
        cross(S.planted, paw.pos, 0.08);
        planted.push(paw.pos);
      } else {
        cross(S.targets, paw.to, 0.1);
        let prev = paw.from.clone();
        const save = paw.s;
        for (let k = 1; k <= 16; k++) {
          paw.s = k / 16;
          const q = d.planner.swingPoint(i, new THREE.Vector3());
          S.arcs.seg(prev, q);
          prev = q;
        }
        paw.s = save;
      }
    });
    // support polygon through planted paws, in LH, LF, RF, RH order
    const order = [0, 1, 3, 2].map((i) => d.planner.paws[i]).filter((p) => p.planted).map((p) => p.pos);
    for (let k = 0; k < order.length; k++) S.support.seg(order[k], order[(k + 1) % order.length]);
    // centre of mass ≈ midpoint of pelvis and chest, dropped to the ground
    const s = d.skeleton;
    const com = s.worldPos[s.id('pelvis')].clone().lerp(d.chestPos(new THREE.Vector3()), 0.5);
    S.com.seg(com, com.clone().setY(d.kin.pos.y));
    cross(S.com, com.clone().setY(d.kin.pos.y), 0.12);
    // spine curve: pelvis → … → head
    const chain = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'chest', 'neck_01', 'neck_02', 'neck_03', 'neck_04', 'head'].filter((n) => s.has(n)).map((n) => s.worldPos[s.id(n)]);
    for (let k = 0; k + 1 < chain.length; k++) S.spine.seg(chain[k], chain[k + 1]);
    S.look.seg(chain[chain.length - 1], d.look.target);
    d.proxies.items.forEach((p, k) => {
      const c = d.proxies.centers[k];
      for (let a = 0; a < 24; a++) {
        const t0 = (a / 24) * Math.PI * 2;
        const t1 = ((a + 1) / 24) * Math.PI * 2;
        S.proxies.seg(new THREE.Vector3(c.x + Math.cos(t0) * p.radius, c.y + Math.sin(t0) * p.radius, c.z), new THREE.Vector3(c.x + Math.cos(t1) * p.radius, c.y + Math.sin(t1) * p.radius, c.z));
        S.proxies.seg(new THREE.Vector3(c.x, c.y + Math.cos(t0) * p.radius, c.z + Math.sin(t0) * p.radius), new THREE.Vector3(c.x, c.y + Math.cos(t1) * p.radius, c.z + Math.sin(t1) * p.radius));
      }
    });
    for (const set of Object.values(S)) set.flush();
  }
}
```

- [ ] **Step 7: Put Toothless in the Motion Lab** (`src/dev/lab/main.ts` — keep Plan 1's course, loop GUI, sun/view folders and `berk.lab.filmstrip`; add after the course is added):

```ts
import { KeyboardMouseInput, ScriptedInput, type InputSource } from '../../core/input';
import { CollisionWorld } from '../../world/collision';
import { loadDragonAsset } from '../../characters/dragon/asset';
import { DragonCharacter } from '../../characters/dragon/motion/dragon';
import { loadPosesMeta } from '../../characters/dragon/motion/poseLayers';
import { loadTuning, type MotionTuning } from '../../characters/dragon/motion/tuning';
import { OrbitCamera } from '../../camera/orbitCamera';
import { applyDitherFade, dragonFade } from '../../characters/dragon/fade';
import { MotionOverlays, OVERLAY_NAMES, type OverlayName } from './overlays';
import { LAB_SCRIPTS, scriptByName } from './scripts';
import { cameraFollow, runLabScript } from './labRunner';

const world = CollisionWorld.fromObjects(course.surfaces);
const MATERIAL_NAMES = ['skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal'];

async function startToothless(): Promise<void> {
  const [asset, posesMeta, tuning] = await Promise.all([
    loadDragonAsset({
      glbUrl: 'assets/characters/toothless/toothless.glb', posesUrl: 'assets/characters/toothless/toothless.poses.glb',
      rigUrl: 'assets/characters/toothless/toothless.rig.json', sunDir: app.lighting.sunDir, prepare: (m) => app.materials.prepare(m),
    }),
    loadPosesMeta('assets/characters/toothless/toothless.poses.json'),
    loadTuning(),
  ]);
  applyDitherFade(MATERIAL_NAMES.map((n) => asset.materials.byName(n)!));
  app.add(asset.root);
  const dragon = new DragonCharacter({ rig: asset.rig, world, tuning, clips: asset.clips, posesMeta, seed: 1 });
  dragon.spawn(0, 0, 0);
  const cam = new OrbitCamera(tuning.camera, world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(dragon, hold));
  const overlays = new MotionOverlays();
  app.scene.add(overlays.root);
  const canvas = app.renderer.domElement;
  const live = new KeyboardMouseInput(window, () => document.pointerLockElement === canvas);
  let source: InputSource = live;
  let scripted: ScriptedInput | null = null;
  let yawPx = 0;
  const view = { follow: true };
  canvas.addEventListener('click', () => { if (view.follow) void canvas.requestPointerLock(); });
  const prevCam = new THREE.Vector3();
  const curCam = new THREE.Vector3();

  app.loop.addSim((dt) => {
    const inp = source.sample(app.loop.simTime);
    if (scripted?.done) {
      source = live;
      scripted = null;
      yawPx = 0;
    }
    prevCam.copy(cam.position);
    cam.update({ mouseDX: inp.mouseDX + yawPx, mouseDY: inp.mouseDY, wheel: inp.wheel }, cameraFollow(dragon, hold), dt);
    curCam.copy(cam.position);
    dragon.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
  });
  app.loop.addRender((alpha) => {
    dragon.writeTo(asset.bones, alpha);
    dragonFade.value = cam.fade;
    if (view.follow) {
      app.camera.position.lerpVectors(prevCam, curCam, alpha);
      app.camera.lookAt(cam.target);
    }
    overlays.update(dragon);
  }, 0);

  const fc = gui.addFolder('Toothless');
  fc.add(view, 'follow').name('follow camera').onChange((v: boolean) => { controls.enabled = !v; });
  controls.enabled = !view.follow;
  const ft = gui.addFolder('Tuning').close();
  for (const [section, values] of Object.entries(tuning) as Array<[keyof MotionTuning, Record<string, unknown>]>) {
    const f = ft.addFolder(section).close();
    for (const [k, v] of Object.entries(values)) if (typeof v === 'number') f.add(values, k);
  }

  debug.register('lab', {
    run: (name: string) => runLabScript({ rig: asset.rig, world, script: scriptByName(name), tuning, clips: asset.clips, posesMeta }),
    runAll: () => Object.fromEntries(LAB_SCRIPTS.map((s) => [s.name, runLabScript({ rig: asset.rig, world, script: s, tuning, clips: asset.clips, posesMeta })])),
    play: (name: string) => {
      const s = scriptByName(name);
      dragon.spawn(s.spawn.x, s.spawn.z, s.spawn.heading);
      cam.reset(cameraFollow(dragon, hold));
      scripted = new ScriptedInput(s.events.map((e) => ({ ...e, t: e.t + app.loop.simTime })));
      source = scripted;
      yawPx = s.cameraYawRate ? -(s.cameraYawRate / 120) / tuning.camera.sensitivity : 0;
      return s.description;
    },
    scripts: () => LAB_SCRIPTS.map((s) => `${s.name}: ${s.description}`),
    tuning: () => JSON.stringify(tuning, null, 1),
  });
  debug.register(null, {
    tp: (x: number, z: number, heading = dragon.kin.heading) => {
      dragon.spawn(x, z, heading);
      cam.reset(cameraFollow(dragon, hold));
    },
    toggle: (name: OverlayName) => (OVERLAY_NAMES.includes(name) ? overlays.toggle(name) : OVERLAY_NAMES),
  });
}

startToothless().catch((e) => console.error('[lab] Toothless failed to load', e));
```
(`controls` and `gui` are the OrbitControls and lil-gui instances Plan 1 already creates in this file. `asset.bones` is `DragonAsset.bones` — a `Map<string, THREE.Bone>` — which `writeTo` accepts.)

- [ ] **Step 8: Run the tests and close the course gaps** — `npm test` → all suites pass, including the headless course scripts on the fixture rig; `npm run typecheck` → clean.
  - If a course script fails, fix the motion or tuning rather than the script. Gates stay at the spec §8.2 values (slip ≤ 1 cm, penetration/float/proxy ≤ 2 cm).
  - **Exception:** a script whose spawn or path is geometrically wrong for the course (a lane that hits an obstacle it is not meant to test) may be corrected. Say so in the report.

  **Known gaps at planning time.** The plan's code was validated in a scratch harness on Plan 1's course geometry. walk-straight, trot-straight, gallop-straight and trot-circle pass every metric. Close these five, in this order, with the levers named — the motion algorithms are tested, so these are tuning plus two small design changes:

  | Script | Measured | Diagnosis | Levers |
  |---|---|---|---|
  | `side-slope` | float 2.9 cm | The body rolls fully with the 20° side slope, so the downhill legs over-extend (stretch 1.04) right after spawn | Add `body.rollFollow` (0–1, start 0.5) scaling the support-roll target — a real animal keeps the body flatter and extends the downhill legs. Also `body.tiltOmega`, `body.crouchWalk` |
  | `ramp15` | penetration 9.4 cm, float 5.0 cm | At the ramp→plateau crease a hind leg goes 21–26° past a joint limit (`legs.margin`), so the sole ends 5–9 cm off; the paw is planted within a few cm of the crease | `planner.edgeProbe` / `edgeDrop` (reject spots right at a crease), `body.terrainLookahead`, `body.tiltOmega`. Consider aligning the paw only partly to the surface normal (`footFrame`) |
  | `ramp30` | slip 0.77 m, proxy 2.3 m | The ramp15 crease issue compounded, then a body proxy ends deep inside the slab. Re-check after ramp15 and side-slope are green | Same as ramp15, plus the proxy resolve (only wall-like contacts react) |
  | `steps-small` | penetration 8.8 cm, float 3.1 cm | Swing paws clip the 0.25 m step edges; the 5-point swing clearance probe misses convex edges | `planner.clearance`; probe the swing path at ≥ 9 points and include the lip corner; `planner.edgeProbe` |
  | `steps-large` | slip, float and proxy failures | After the stair-classification fix, the stair's 2 m far edge triggers a hop whose landing plants the hind paws on the upper level | Start the hop when the *forepaws* reach the edge (drop probe just ahead of the forepaws, not 1.8 m ahead of the origin). Give the hop a minimum forward distance so all four paws clear the edge. Stop the script on the top step |

  Record every tuned value and design change in the report and in `motion-tuning.json` (Task 16).

- [ ] **Step 9: Visual verification in the browser** (needs Plan 2's exported asset)
  - Setup: dev server (`npm run dev`, port 5190); chrome-devtools browser at `http://localhost:5190/lab.html?q=low`; wait ~5 s for Toothless to load. `list_console_messages` must show no errors.
  - Film strips (`berk.lab.play(name)` then `berk.lab.filmstrip(12, 10, 6)`), each saved with `take_screenshot` to `docs/progress/img/motion/<name>-strip.png`, for `walk-straight`, `trot-straight`, `gallop-straight`, `ramp30`, `ramp60`, `ledge-scramble`, `idle-turn-60s` (first 10 s).
  - Read every strip and check:
    - paws stay put while planted
    - legs bend the right way (elbows back, knees forward)
    - the body pitches on ramps and leans in turns
    - the tail follows through
    - the head looks where he goes
    - no popping, spinning or collapsing
  - Fix, re-run, repeat.
  - `evaluate_script` → `berk.lab.runAll()` on the real rig: every report `pass: true`. Save the JSON to `docs/progress/img/motion/metrics.json`.

- [ ] **Step 10: Commit** — metrics, scripts, runner, overlays, lab page, tests, images, `metrics.json`. Message: `feat(lab): Toothless in the Motion Lab — scripted course runs, metrics, overlays, tuning panels`.

---

### Task 16: Game page, tuned preset, real-rig gates, progress log

**Files:**
- Modify: `src/main.ts` (Plan 1 Task 8)
- Create: `public/assets/characters/toothless/motion-tuning.json`, `tests/lab/realRig.test.ts`
- Modify: `docs/progress/phase1.md`
- Output: `docs/progress/img/motion/game-*.png`

**Interfaces:**
- Consumes: everything above; Plan 1 `createTestScene`; Plan 2 asset files.
- Produces:
  - Toothless on the game page: orbit camera with pointer lock, WASD/Shift/C, HUD hint.
  - The committed tuning preset; the headless real-rig gate test.
  - `berk.tp(x, z, heading?)`, `berk.cam.preset(name)` (`hero` | `side` | `low` | `wide`, orbit presets relative to the dragon).

- [ ] **Step 1: Real-rig gate test** (skips without the export)

`tests/lab/realRig.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { buildCourse } from '../../src/dev/lab/course';
import { runLabScript } from '../../src/dev/lab/labRunner';
import { LAB_SCRIPTS } from '../../src/dev/lab/scripts';
import { CollisionWorld } from '../../src/world/collision';
import { mergeTuning, DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';

const RIG = 'public/assets/characters/toothless/toothless.rig.json';
const TUNING = 'public/assets/characters/toothless/motion-tuning.json';

describe.skipIf(!existsSync(RIG))('Motion Lab course on the exported Toothless rig', () => {
  const rig = JSON.parse(readFileSync(RIG, 'utf8')) as MotionRig;
  const tuning = mergeTuning(DEFAULT_TUNING, existsSync(TUNING) ? JSON.parse(readFileSync(TUNING, 'utf8')) : undefined);
  const world = CollisionWorld.fromObjects(buildCourse().surfaces);
  it.each(LAB_SCRIPTS.map((s) => s.name))('passes every metric: %s', { timeout: 300_000 }, (name) => {
    const r = runLabScript({ rig, world, script: LAB_SCRIPTS.find((s) => s.name === name)!, tuning });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});
```
Run: `npm test -- tests/lab/realRig.test.ts`. Every script must pass; this includes the climbing and 60 s scripts that the fixture suite does not gate. Tune `tuning.ts` / code until they do.

- [ ] **Step 2: Save the tuned preset** — write the final tuning as JSON to `public/assets/characters/toothless/motion-tuning.json`. The simplest route is `berk.lab.tuning()` in the lab, pasted into the file. Re-run the real-rig test with it.

- [ ] **Step 3: Game page** — replace Plan 1's OrbitControls camera in `src/main.ts`, keeping the test scene:
```ts
import './styles.css';
import * as THREE from 'three';
import { createApp } from './app/createApp';
import { createTestScene } from './world/testScene';
import { debug } from './core/debug';
import { KeyboardMouseInput } from './core/input';
import { CollisionWorld } from './world/collision';
import { loadDragonAsset } from './characters/dragon/asset';
import { DragonCharacter } from './characters/dragon/motion/dragon';
import { loadPosesMeta } from './characters/dragon/motion/poseLayers';
import { loadTuning } from './characters/dragon/motion/tuning';
import { OrbitCamera } from './camera/orbitCamera';
import { applyDitherFade, dragonFade } from './characters/dragon/fade';
import { cameraFollow } from './dev/lab/labRunner';

const app = createApp(document.getElementById('app')!);
const test = createTestScene();
app.add(test.root);
app.loop.addSim(() => test.update(app.loop.simTime));
const world = CollisionWorld.fromObjects([test.root]);
const hud = document.getElementById('hud')!;
hud.textContent = 'Loading Toothless…';

async function start(): Promise<void> {
  const [asset, posesMeta, tuning] = await Promise.all([
    loadDragonAsset({
      glbUrl: 'assets/characters/toothless/toothless.glb', posesUrl: 'assets/characters/toothless/toothless.poses.glb',
      rigUrl: 'assets/characters/toothless/toothless.rig.json', sunDir: app.lighting.sunDir, prepare: (m) => app.materials.prepare(m),
    }),
    loadPosesMeta('assets/characters/toothless/toothless.poses.json'),
    loadTuning(),
  ]);
  applyDitherFade(['skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal'].map((n) => asset.materials.byName(n)!));
  app.add(asset.root);
  const dragon = new DragonCharacter({ rig: asset.rig, world, tuning, clips: asset.clips, posesMeta, seed: 1 });
  dragon.spawn(0, 6, Math.PI);
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
  const PRESETS: Record<string, [number, number, number]> = { hero: [2.4, 12, 6], side: [Math.PI / 2, 8, 7], low: [2.8, 2, 5], wide: [2.6, 25, 16] };
  debug.register(null, {
    tp: (x: number, z: number, heading = dragon.kin.heading) => {
      dragon.spawn(x, z, heading);
      cam.reset(cameraFollow(dragon, hold));
    },
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
  hud.textContent = `Isle of Berk · click to control · WASD move · Shift gallop · C prowl · mouse look · wheel zoom · quality: ${app.preset.name}`;
}

start().catch((e) => {
  console.error('[game] Toothless failed to load', e);
  hud.textContent = 'Toothless failed to load — see the console';
});
app.loop.start();
```
(The camera presets set yaw/pitch/distance; the follow springs carry the camera there. The swatch meshes in the test scene are solid obstacles — he walks around them or is blocked by them.)

- [ ] **Step 4: Play-check in the browser**
  - Load `http://localhost:5190/?q=low`; `list_console_messages` shows no errors.
  - Drive him with `press_key`: hold W; Shift+W; C then W; A/D turns; run into a swatch.
  - Screenshots to `docs/progress/img/motion/game-hero.png`, `game-gallop.png`, `game-turn.png` (via `berk.cam.preset`).
  - Check each screenshot: he stands on the ground, walks/trots/gallops with planted paws, turns smoothly, the camera never clips into the swatches, and he fades if the camera is pushed into him.

- [ ] **Step 5: Progress log** — add an "M5 — Motion core" section to `docs/progress/phase1.md` with:
  - the `berk.lab.runAll()` metrics table (script, max slip / penetration / float / proxy, pass)
  - the film strips and game screenshots
  - the tuned values that differ from the spec defaults, and why
  - known limitations handed to M6: scramble choreography polish, the jump/plasma actions, behaviours, the eye gaze uniform, face

- [ ] **Step 6: Commit** — `feat(game): Toothless playable on the game page — orbit camera, tuned motion preset, real-rig course gates`.

---

## Self-Review

- **Spec coverage:**

  | Spec | Where |
  |---|---|
  | §3.4 fixed 1/120 s steps, absolute rotations, deterministic stepping | Global Constraints; `RigSkeleton.resetToBind/fk/writeTo(alpha)` (T5); determinism tests (T11, T12) |
  | §6.1 pipeline order | `DragonCharacter.update` (T12) |
  | §6.2 controller | T6 |
  | §6.3 gait | T3 |
  | §6.4 foot planner | T7 + envelope/overstretch (T9, T12) |
  | §6.5 body and spine | T8 |
  | §6.6 climbing | T14 |
  | §6.7 leg IK | T2, T9 |
  | §6.8 head/neck/eyes (M5 subset) | T11 |
  | §6.9 secondary motion | T11 |
  | §6.10 pose layers | T10 |
  | §6.14 collision | T4, T6 |
  | §6.15 camera + fade | T13 |
  | §6.16 tuning | T6 + lab panels (T15) + preset (T16) |
  | §8.1 unit tests: IK, gait, planner, springs, camera | T1–T4, T7, T13 |
  | §8.2 course scripts + metrics + `lab.run` + film strips | T15, T16 |

  The §8.1 behaviour-selector test belongs to M6.
- **Deferred to M6, with hooks in place:** §6.11 behaviours, §6.12 face/mood (`hooks.face`, `look.eyeYaw/eyePitch`), §6.13 jump/plasma (`intent.jump/plasma`, `hooks.preFinals`, `BodySolver.override/impulse`, `FootPlanner.forceStep`), and the §5.11 pose library (`PoseLayerStack`).
- **Placeholder scan:** none. Visual/tuning steps name concrete checks and forbid loosening thresholds.
- **Validation (during planning):**
  - Every module and test block of Tasks 1–15 was extracted from this document into a scratch project with Plan 1's core, course and `render/materials.ts` code. The two page scripts were excluded: they need Plan 1/Plan 2 modules that do not exist yet.
  - `tsc` is clean, and all Task 1–14 tests pass: 20 files, 127 tests. The 3 skipped tests need Plan 2's exported asset.
  - That run found and fixed:
    - a gait-offset blend that jumped 0.069 phase in one step
    - hind-leg hock-limit slip at trot (1.3–2 cm)
    - over-long strides for the front legs, whose bind envelope is only 0.62 m
    - on-the-spot turn slip (3.7 cm)
    - the body sinking into ramps
    - proxy teleports through slabs
    - stairs misread as scramble ledges
  - Course scripts on Plan 1's geometry: 4 of 9 core scripts pass. The remaining 5 are listed with diagnosis and levers in Task 15 Step 8.
- **Type consistency:**
  - `MotionRig` ⊂ `RigMeta`.
  - `LEG_KEYS` order (LH, LF, RH, RF) is used identically by the gait offsets, planner, legs, body supports and metrics.
  - `PlannerBody`, `SupportSource`, `BodyKinState`, `LegTargets`, `MotionMods`, `CameraFollow` and `LabScript` signatures match between producers and consumers.
  - `solveTwoBone`/`solvePantograph` results carry `stretch`, which `LegRig.stretch` and `DragonCharacter` consume.
- **Risks for the controller:** see the report accompanying this plan.
