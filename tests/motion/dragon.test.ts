import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { parsePosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
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

// Ruling 3: Plan 2 exports the wing fold as ordered single-frame samples (rig.json wings.<side>.foldClips). The dragon
// merges them into ONE multi-key clip (withFoldClip) and holds it at the fully folded end (time 1), so a single slerp
// never crosses the ~177° the doubled ribs sweep between half-open and folded.
describe('DragonCharacter wing fold (Ruling 3)', () => {
  const FOLD = ['bind', 'wings_fold_25', 'wings_half', 'wings_fold_75', 'wings_folded'];
  const WING = 'wing_humerus_L';
  const STEP_DEG = 44; // sample k turns the humerus k·44° about its local X from bind: 0 … 176°

  /** Single-frame fold samples for WING (as Plan 2 exports them), with poses.json-style masks. */
  function foldAssets(names: readonly string[]) {
    const s = new RigSkeleton(toothlessFixtureRig());
    const b = s.id(WING);
    const sample = (k: number) =>
      s.bindLocalQuat[b].clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(STEP_DEG * k)));
    const clips = new Map(names.map((n, k) => [n, new THREE.AnimationClip(n, 0, [new THREE.QuaternionKeyframeTrack(`${WING}.quaternion`, [0], sample(k).toArray())])]));
    const meta = parsePosesMeta({ clips: Object.fromEntries(names.map((n) => [n, { mask: ['wing_'] }])) });
    return { clips, meta, sample };
  }

  it('layers the merged wingFold clip at weight 1, time 1 (the last sample) when the rig lists foldClips', () => {
    const { clips, meta, sample } = foldAssets(FOLD);
    const rig = toothlessFixtureRig();
    rig.wings.L.foldClips = [...FOLD];
    rig.wings.R.foldClips = [...FOLD];
    const d = new DragonCharacter({ rig, world: bigFloor(), clips, posesMeta: meta });
    d.spawn(0, 0, 0);
    drive(d, [], 0.5);
    expect(d.layers.has('wingFold')).toBe(true);
    expect(d.layers.weight('wingFold')).toBe(1);
    expect(d.layers.weight('wings_folded')).toBe(0); // the merged clip replaces the single-sample layer
    const q = d.skeleton.localQuat[d.skeleton.id(WING)];
    const last = sample(FOLD.length - 1);
    expect(Math.abs(q.dot(last))).toBeGreaterThan(1 - 1e-9); // time 1 = the fully folded sample
    expect(Math.abs(q.dot(sample(FOLD.length - 2)))).toBeLessThan(0.95); // not a neighbour (44° away)
    expect(d.nanResets).toBe(0);
  });

  it('falls back to wings_folded at weight 1 without foldClips, or when a listed sample is missing', () => {
    const { clips, meta } = foldAssets(['wings_folded']);
    const plain = new DragonCharacter({ rig: toothlessFixtureRig(), world: bigFloor(), clips, posesMeta: meta });
    expect(plain.layers.has('wingFold')).toBe(false);
    expect(plain.layers.weight('wings_folded')).toBe(1);
    const rig = toothlessFixtureRig();
    rig.wings.L.foldClips = [...FOLD]; // bind … wings_fold_75 are not in the poses
    const partial = new DragonCharacter({ rig, world: bigFloor(), clips, posesMeta: meta });
    expect(partial.layers.has('wingFold')).toBe(false);
    expect(partial.layers.weight('wings_folded')).toBe(1);
  });
});

// Task 8 carry-over: the body solver's gait dynamics, measured through the real pipeline (fixture rig, flat floor).
describe('DragonCharacter body dynamics on flat ground', () => {
  /** Hold `keys` for `seconds`, calling `each` after every step. */
  function hold(d: DragonCharacter, keys: string[], seconds: number, each: () => void = () => {}): void {
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      d.update({ input: input(keys), cameraYaw: 0, cameraPos: CAM }, DT);
      each();
    }
  }
  /** Sample `value` every step over `cycles` whole gait cycles (from one phase wrap to the cycles-th after it). */
  function overCycles(d: DragonCharacter, keys: string[], cycles: number, value: () => number): number[] {
    const out: number[] = [];
    let wraps = 0;
    let prev = d.gait.phase;
    for (let k = 0; k < 20_000 && wraps <= cycles; k++) {
      d.update({ input: input(keys), cameraYaw: 0, cameraPos: CAM }, DT);
      if (d.gait.phase < prev) wraps++;
      prev = d.gait.phase;
      if (wraps >= 1 && wraps <= cycles) out.push(value());
    }
    expect(wraps).toBeGreaterThan(cycles);
    return out;
  }
  /** Minima of `xs` that fall at least `h` below the preceding maximum and are climbed out of by `h` (hysteresis). */
  function countDips(xs: readonly number[], h: number): number {
    let n = 0;
    let falling = false;
    let hi = xs[0];
    let lo = xs[0];
    for (const x of xs) {
      if (!falling) {
        hi = Math.max(hi, x);
        if (x < hi - h) {
          falling = true;
          lo = x;
        }
      } else {
        lo = Math.min(lo, x);
        if (x > lo + h) {
          falling = false;
          hi = x;
          n++;
        }
      }
    }
    return n;
  }
  const range = (xs: readonly number[]) => Math.max(...xs) - Math.min(...xs);
  /** Elevation of the chest above the pelvis as seen from the pelvis (rad) — rises when the body pitches nose-up. */
  function chestElevation(d: DragonCharacter): number {
    const s = d.skeleton;
    const v = s.worldPos[s.id('chest')].clone().sub(s.worldPos[s.id('pelvis')]);
    return Math.atan2(v.y, Math.hypot(v.x, v.z));
  }
  const CYCLES = 8;

  it('dips the pelvis twice per gait cycle at the 3.2 m/s trot', () => {
    const d = dragon();
    hold(d, ['KeyW'], 2); // up to speed, fully blended into the trot
    expect(d.kin.speed).toBeCloseTo(3.2, 6);
    expect(d.gait.weights[1]).toBeCloseTo(1, 6);
    const y = overCycles(d, ['KeyW'], CYCLES, () => d.body.pose.pelvisPos.y);
    const h = 0.001; // a dip is at least 1 mm deep
    expect(range(y)).toBeGreaterThan(4 * h);
    expect(range(y)).toBeLessThan(0.05); // centimetre order, not a lurch
    const perCycle = countDips(y, h) / CYCLES;
    expect(perCycle).toBeGreaterThanOrEqual(1.75);
    expect(perCycle).toBeLessThanOrEqual(2.25);
    expect(d.nanResets).toBe(0);
  });

  it('rocks the body pitch once per stride at the gallop', { timeout: 30_000 }, () => {
    const d = dragon();
    hold(d, ['KeyW', 'ShiftLeft'], 3); // up to 10 m/s, fully blended into the gallop
    expect(d.kin.speed).toBeCloseTo(10, 6);
    expect(d.gait.gallopWeight).toBeCloseTo(1, 6);
    const pitch = overCycles(d, ['KeyW', 'ShiftLeft'], CYCLES, () => d.body.pose.pitch);
    const h = THREE.MathUtils.degToRad(0.2); // a rock swings at least 0.2°
    expect(range(pitch)).toBeGreaterThan(4 * h);
    expect(range(pitch)).toBeLessThan(THREE.MathUtils.degToRad(10)); // degree order, not a somersault
    const perStride = countDips(pitch.map((p) => -p), h) / CYCLES; // nose-up peaks
    expect(perStride).toBeGreaterThanOrEqual(0.75);
    expect(perStride).toBeLessThanOrEqual(1.25);
    expect(d.nanResets).toBe(0);
  });

  it('pitches nose-up (positive) while accelerating from rest and nose-down while braking', () => {
    const d = dragon();
    hold(d, [], 0.5);
    const rest = chestElevation(d);
    expect(Math.abs(d.body.pose.pitch)).toBeLessThan(1e-3);
    // accelerating: 5 m/s² up to the trot (0.64 s)
    let upPitch = -Infinity;
    let upRise = -Infinity;
    hold(d, ['KeyW'], 0.6, () => {
      expect(d.kin.accel).toBeGreaterThan(0);
      upPitch = Math.max(upPitch, d.body.pose.pitch);
      upRise = Math.max(upRise, chestElevation(d) - rest);
    });
    expect(THREE.MathUtils.radToDeg(upPitch)).toBeGreaterThan(1);
    expect(THREE.MathUtils.radToDeg(upRise)).toBeGreaterThan(1); // the skeleton really lifts its front
    // braking: 12 m/s² from the steady trot to a stop
    hold(d, ['KeyW'], 2.4);
    expect(d.kin.speed).toBeCloseTo(3.2, 6);
    let downPitch = Infinity;
    let downRise = Infinity;
    hold(d, [], 0.4, () => {
      downPitch = Math.min(downPitch, d.body.pose.pitch);
      downRise = Math.min(downRise, chestElevation(d) - rest);
    });
    expect(d.kin.speed).toBe(0);
    expect(THREE.MathUtils.radToDeg(downPitch)).toBeLessThan(-1);
    expect(THREE.MathUtils.radToDeg(downRise)).toBeLessThan(-1); // the skeleton really dips its front
    expect(d.nanResets).toBe(0);
  });
});
