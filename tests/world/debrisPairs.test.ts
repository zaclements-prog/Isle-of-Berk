import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../../src/world/collision';
import { DEFAULT_DEBRIS, Debris } from '../../src/world/damage/debris';

function flatWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
  const world = CollisionWorld.fromObjects([ground], { tile: 64 });
  return { world, set: world.createSet('debris') };
}
const C = new THREE.Color();
const V0 = () => new THREE.Vector3();

describe('debris against debris', () => {
  it('stacks two boxes dropped onto each other while both move, and both go to sleep there', () => {
    const { world, set } = flatWorld();
    const d = new Debris(world, set, DEFAULT_DEBRIS, { ground: () => 0 });
    const a = d.spawn(new THREE.Vector3(0, 0.6, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.4, 1), C, V0(), V0());
    // dropped right after, so the lower one is still awake when it lands
    const b = d.spawn(new THREE.Vector3(0.2, 2.2, -0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.5, 0)), new THREE.Vector3(0.6, 0.3, 0.6), C, V0(), V0());
    let maxV = 0;
    let bothAwakeContact = false;
    for (let t = 0; t < 8 && !(a.asleep && b.asleep); t += 1 / 60) {
      d.update(1 / 60);
      if (!a.asleep && !b.asleep && b.pos.y < 1.2) bothAwakeContact = true;
      maxV = Math.max(maxV, b.v.length(), a.v.length());
    }
    expect(bothAwakeContact).toBe(true);
    expect(a.asleep && b.asleep).toBe(true);
    expect(a.pos.y).toBeGreaterThan(0.35);
    expect(a.pos.y).toBeLessThan(0.45);
    expect(b.pos.y).toBeGreaterThan(1.05);        // on top: 0.8 + 0.3
    expect(b.pos.y).toBeLessThan(1.2);
    expect(Math.abs(b.pos.x - 0.2)).toBeLessThan(0.2);  // not shoved off sideways
    expect(maxV).toBeLessThan(8);                // no explosive separation
    d.dispose();
  });

  it('keeps moving boxes out of each other without pairs, and not with them (the pair test is what stacks)', () => {
    const { world } = flatWorld();
    const run = (pairs: boolean) => {
      const d = new Debris(world, null, { ...DEFAULT_DEBRIS, pairs }, { ground: () => 0 });
      const a = d.spawn(new THREE.Vector3(0, 0.3, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.3, 1), C, V0(), V0());
      const b = d.spawn(new THREE.Vector3(0, 1.4, 0), new THREE.Quaternion(), new THREE.Vector3(0.5, 0.3, 0.5), C, V0(), V0());
      for (let t = 0; t < 0.5; t += 1 / 60) d.update(1 / 60);
      const y = b.pos.y;
      d.dispose();
      return y - a.pos.y;
    };
    expect(run(true)).toBeGreaterThan(0.5);
    expect(run(false)).toBeLessThan(0.1);
  });

  it('settles a heap of thrown planks without jitter: all asleep, none under the ground, none fast', () => {
    const { world, set } = flatWorld();
    const d = new Debris(world, set, DEFAULT_DEBRIS, { ground: () => 0 });
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 30; k++) {
      d.spawn(new THREE.Vector3((rnd() - 0.5) * 3, 1 + k * 0.5, (rnd() - 0.5) * 3), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)),
        new THREE.Vector3(0.4 + rnd() * 1.2, 0.1 + rnd() * 0.2, 0.3 + rnd() * 0.5), C,
        new THREE.Vector3((rnd() - 0.5) * 4, 0, (rnd() - 0.5) * 4), new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(4));
    }
    let worst = 0;
    for (let t = 0; t < 15; t += 1 / 60) {
      d.update(1 / 60);
      worst = Math.max(worst, d.lastMs);
    }
    expect(d.active).toBe(0);
    const corner = new THREE.Vector3();
    for (const p of d.pieces) {
      for (const k of [-1, 1]) for (const l of [-1, 1]) for (const m of [-1, 1]) {
        corner.set(k * p.half.x, l * p.half.y, m * p.half.z).applyQuaternion(p.q).add(p.pos);
        expect(corner.y).toBeGreaterThan(-0.11);
      }
    }
    // a heap, not a carpet: some pieces lie on others
    expect(d.pieces.filter((p) => p.pos.y > 0.5).length).toBeGreaterThan(2);
    d.dispose();
  });

  it('a blast wakes the settled rubble near it and throws it again; far rubble stays put', () => {
    const { world, set } = flatWorld();
    const d = new Debris(world, set, DEFAULT_DEBRIS, { ground: () => 0 });
    const near = d.spawn(new THREE.Vector3(2, 0.2, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.2, 0.5), C, V0(), V0());
    const far = d.spawn(new THREE.Vector3(30, 0.2, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.2, 0.5), C, V0(), V0());
    for (let t = 0; t < 3; t += 1 / 60) d.update(1 / 60);
    expect(near.asleep && far.asleep).toBe(true);
    expect(set.size).toBe(2);
    expect(d.blast(new THREE.Vector3(0, 0, 0), 6, 5)).toBe(1);
    expect(near.asleep).toBe(false);
    expect(set.has(`debris:${near.id}`)).toBe(false);
    expect(near.v.x).toBeGreaterThan(1);
    expect(near.v.y).toBeGreaterThan(0.5);
    expect(far.asleep).toBe(true);
    for (let t = 0; t < 6; t += 1 / 60) d.update(1 / 60);
    expect(near.asleep).toBe(true);
    expect(near.pos.x).toBeGreaterThan(2.5);
    d.dispose();
  });

  it('never leaves a piece asleep under the ground, even one the cap puts to sleep before it moves', () => {
    const { world, set } = flatWorld();
    const d = new Debris(world, set, { ...DEFAULT_DEBRIS, maxActive: 2 }, { ground: () => 0 });
    // spawned half inside the ground, then two more: the cap puts the first to sleep at once
    const buried = d.spawn(new THREE.Vector3(0, -0.3, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.5, 1), C, V0(), V0());
    d.spawn(new THREE.Vector3(5, 2, 0), new THREE.Quaternion(), new THREE.Vector3(0.5, 0.5, 0.5), C, V0(), V0());
    d.spawn(new THREE.Vector3(9, 2, 0), new THREE.Quaternion(), new THREE.Vector3(0.5, 0.5, 0.5), C, V0(), V0());
    expect(buried.asleep).toBe(true);
    expect(buried.pos.y - buried.half.y).toBeGreaterThan(-0.06);
    d.dispose();
  });
});
