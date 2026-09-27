import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SecondaryMotion, type SecondaryInput } from '../../src/characters/dragon/motion/secondary';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld } from '../../src/world/collision';
import { twistAngle } from '../../src/characters/dragon/motion/math';
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
  it('twitches the fins/hip-wings within [twitchMin, twitchMax], changing spring state, deterministically', () => {
    const a = make(flatWorld(), 11);
    const b = make(flatWorld(), 11);
    const before = DEFAULT_TUNING.fins.twitchMin - 0.1;
    const after = DEFAULT_TUNING.fins.twitchMax - DEFAULT_TUNING.fins.twitchMin + 0.2;
    // speed stays 0 throughout, so the flutter target is exactly 0 for every fin — any nonzero spring state
    // below can only come from a twitch impulse, not the ongoing flutter.
    run(a, {}, before);
    run(b, {}, before);
    expect(a.sec.fins.every((f) => f.s.x === 0 && f.s.v === 0)).toBe(true);
    run(a, {}, after);
    run(b, {}, after);
    expect(a.sec.fins.some((f) => f.s.v !== 0 || f.s.x !== 0)).toBe(true);
    expect(a.sec.fins.map((f) => f.s.x)).toEqual(b.sec.fins.map((f) => f.s.x));
    expect(a.sec.fins.map((f) => f.s.v)).toEqual(b.sec.fins.map((f) => f.s.v));
  });
  it('keeps every written tail yaw within the rig chain limit through an abrupt high-speed turn', () => {
    const m = make();
    const yawLimit = THREE.MathUtils.degToRad(rig.chainLimitsDeg.tail.yaw);
    const AZ = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion();
    run(m, { yawRate: 3, speed: 10 }, 60 * DT);
    run(m, { yawRate: -3, speed: 10 }, 60 * DT);
    for (const n of rig.chains.tail) {
      const i = m.s.id(n);
      q.copy(m.s.bindLocalQuat[i]).invert().multiply(m.s.localQuat[i]);
      const yaw = twistAngle(q, AZ);
      expect(Math.abs(yaw)).toBeLessThanOrEqual(yawLimit + 1e-6);
    }
  });
  it('caps each tail segment’s written pitch to the rig limit under a tall obstacle, while the tail tip still rises', () => {
    const tall = CollisionWorld.fromObjects([floor(), box(4, 1.2, 6, 0, 0.6, -3)]);
    const flat = make(flatWorld());
    const m = make(tall);
    run(flat, {}, 1);
    run(m, {}, 1);
    const pitchLimit = THREE.MathUtils.degToRad(rig.chainLimitsDeg.tail.pitch);
    const AX = new THREE.Vector3(1, 0, 0);
    const q = new THREE.Quaternion();
    for (const n of rig.chains.tail) {
      const i = m.s.id(n);
      q.copy(m.s.bindLocalQuat[i]).invert().multiply(m.s.localQuat[i]);
      const pitch = twistAngle(q, AX);
      expect(Math.abs(pitch)).toBeLessThanOrEqual(pitchLimit + 1e-6);
    }
    const tipFlat = flat.s.tail(flat.s.id('tail_12'), new THREE.Vector3());
    const tipObstacle = m.s.tail(m.s.id('tail_12'), new THREE.Vector3());
    expect(tipObstacle.y).toBeGreaterThan(tipFlat.y);
  });
});
