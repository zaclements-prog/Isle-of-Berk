import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flatWorld, rampWorld, wallWorld } from '../fixtures/worlds';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);

describe('CollisionWorld', () => {
  it('casts rays onto the floor with an upward normal', () => {
    const hit = flatWorld().raycast(V(1, 5, 2), DOWN, 10)!;
    expect(hit.point.y).toBeCloseTo(0, 6);
    expect(hit.normal.y).toBeCloseTo(1, 6);
    expect(hit.distance).toBeCloseTo(5, 6);
  });
  it('reports the slope of a ramp', () => {
    const hit = rampWorld(30).groundAt(0, 5, 20, 40)!;
    expect(THREE.MathUtils.radToDeg(Math.acos(hit.normal.y))).toBeCloseTo(30, 2);
  });
  it('misses where there is no ground', () => {
    expect(flatWorld().groundAt(100, 0, 10, 20)).toBeNull();
  });
  it('finds sphere contacts against a wall', () => {
    const c = wallWorld(2).sphereContact(V(0, 1, 2.3), 0.3)!;
    expect(c.depth).toBeCloseTo(0.1, 6);
    expect(c.normal.z).toBeCloseTo(-1, 6);
  });
  it('resolves penetrating spheres, including centres inside the solid', () => {
    const w = wallWorld(2);
    for (const z of [2.3, 2.6]) {
      const c = V(0, 1, z);
      w.resolveSphere(c, 0.3);
      expect(c.z).toBeLessThanOrEqual(2.2 + 1e-4);
      expect(w.sphereContact(c, 0.3)).toBeNull();
    }
  });
  it('knows when a point is inside a solid', () => {
    const w = wallWorld(2);
    expect(w.isInside(V(0, 1, 3))).toBe(true);
    expect(w.isInside(V(0, 1, 1))).toBe(false);
    expect(flatWorld().isInside(V(0, -0.2, 0))).toBe(true);
  });
  it('stops a sphere cast before the wall', () => {
    const w = wallWorld(2);
    const t = w.sphereCast(V(0, 1, 0), V(0, 1, 5), 0.3);
    expect(t * 5).toBeCloseTo(2.2, 1);
    expect(w.sphereCast(V(0, 1, 2.3), V(0, 1, 0), 0.3)).toBe(0);
    expect(w.sphereCast(V(0, 1, 0), V(0, 1, 1), 0.3)).toBe(1);
  });
});
