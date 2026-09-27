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
