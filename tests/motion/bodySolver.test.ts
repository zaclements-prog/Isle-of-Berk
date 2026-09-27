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
