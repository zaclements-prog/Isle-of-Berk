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
