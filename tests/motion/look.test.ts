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
