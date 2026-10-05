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
