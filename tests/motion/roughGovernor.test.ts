import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';

const DT = 1 / 120;

/** Ground as a function y = f(x, z) over 120 m at 0.5 m, plus any boxes standing on it. */
function world(f: (x: number, z: number) => number, extra: THREE.Mesh[] = []): CollisionWorld {
  const g = new THREE.PlaneGeometry(120, 120, 240, 240).rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, f(p.getX(i), p.getZ(i)));
  return CollisionWorld.fromObjects([new THREE.Mesh(g), ...extra]);
}

/** The speed cap the rough-ground governor sets for a dragon standing at the origin facing +z. */
function capAt(w: CollisionWorld): number {
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world: w, seed: 1 });
  d.spawn(0, 0, 0);
  return d.roughCap(DT);
}

describe('rough-ground governor', () => {
  it('lets him gallop up and over a smooth hill (a plane fit read its curve as rough)', () => {
    // a crest 4 m ahead on a 25 m radius: over the probes the ground sags ~0.5 m off any plane
    expect(capAt(world((x, z) => 3 - ((z - 4) ** 2) / 50))).toBe(Infinity);
    // a 20° rise that eases off, and the foot of a gully: still smooth
    expect(capAt(world((x, z) => 0.36 * z - 0.012 * z * z))).toBe(Infinity);
    expect(capAt(world((x, z) => ((z - 4) ** 2) / 40))).toBe(Infinity);
  });

  it('still holds him to a trot over a log, onto a ledge and through rocks', () => {
    const trot = new DragonCharacter({ rig: toothlessFixtureRig(), world: world(() => 0), seed: 1 }).tuning.rough.trotCap;
    expect(capAt(world(() => 0, [box(4, 0.3, 0.5, 0, 0.15, 3.5)]))).toBe(trot);        // a log across his path
    expect(capAt(world(() => 0, [box(6, 0.5, 6, 0, 0.25, 5.5)]))).toBe(trot);          // a 0.5 m ledge from 2.5 m on
    const rocks = [[-0.4, 1.5], [0.3, 2.6], [-0.2, 3.8], [0.4, 4.9]].map(([x, z]) => box(0.5, 0.3, 0.5, x, 0.15, z));
    expect(capAt(world(() => 0, rocks))).toBe(trot);                                      // rocks underfoot
  });
});
