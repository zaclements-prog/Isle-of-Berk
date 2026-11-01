import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildProps, type Placement } from '../../src/world/island/props';
import { reseatBoulders, type IslandCollision } from '../../src/world/island/island';
import { CollisionWorld, trianglesOf } from '../../src/world/collision';

// Three boulders on flat ground at y = 2; a "crater" then drops the ground under the first two by 1.5 m.
const rocks: Placement[] = [[0, 2, 0, 1.5, 0, 0], [6, 2, 0, 1, 1, 0.5], [40, 2, 0, 1.2, 2, 1]];
const flat = () => 2;
const dug = (x: number) => (x < 20 ? 0.5 : 2);

function setup() {
  const props = buildProps([], rocks, flat);
  const world = new CollisionWorld();
  const hulls = props.collision.filter((o) => o.name === 'boulders_collision');
  const boulders = world.addLayer('boulders', trianglesOf(hulls));
  return { props, collision: { world, boulders } as unknown as IslandCollision };
}

const topAt = (w: CollisionWorld, x: number, z: number) => w.groundAt(x, z, 50, 100)?.point.y ?? -Infinity;

describe('crater re-seats boulders', () => {
  it("each boulder's hull range in the collision triangles surrounds that boulder", () => {
    const { props } = setup();
    const pos = trianglesOf(props.collision.filter((o) => o.name === 'boulders_collision'));
    expect(props.boulders).toHaveLength(3);
    for (const b of props.boulders) {
      let cx = 0, cz = 0;
      for (let v = b.first; v < b.first + b.count; v++) { cx += pos[v * 3]; cz += pos[v * 3 + 2]; }
      expect(Math.hypot(cx / b.count - b.x, cz / b.count - b.z)).toBeLessThan(0.5 * b.scale);
    }
  });

  it('drops the boulders in the rectangle with their collision, and leaves the rest', () => {
    const { props, collision } = setup();
    const before = props.boulders.map((b) => topAt(collision.world, b.x, b.z));
    const m = new THREE.Matrix4();
    const n = reseatBoulders(props, collision, [-10, -10, 10, 10], (x) => dug(x));
    expect(n).toBe(2);
    props.boulders.forEach((b, i) => {
      const drop = i < 2 ? 1.5 : 0;
      expect(topAt(collision.world, b.x, b.z)).toBeCloseTo(before[i] - drop, 4);
      b.mesh.getMatrixAt(b.k, m);
      expect(m.elements[13]).toBeCloseTo(b.y, 6);
      expect(b.y).toBeCloseTo((i < 2 ? 0.5 : 2) - 0.12 * b.scale, 6);
    });
    // nothing more to do on the same ground
    expect(reseatBoulders(props, collision, [-10, -10, 10, 10], (x) => dug(x))).toBe(0);
  });
});
