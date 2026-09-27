import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flatWorld, rampWorld, wallWorld, cornerWorld } from '../fixtures/worlds';

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
    const stats = { queries: 0 };
    const from = V(0, 1, 0);
    const to = V(0, 1, 5);
    const t = w.sphereCast(from, to, 0.3, stats);
    expect(t * 5).toBeCloseTo(2.2, 1);
    // Invariant: the result point is not inside collision (spec §8.1)
    // Allow tiny FP-level contacts (< 1e-4)
    const resultPoint = from.clone().lerp(to, t);
    const contact = w.sphereContact(resultPoint, 0.3);
    expect(!contact || contact.depth < 1e-4).toBe(true);
    expect(stats.queries).toBeLessThanOrEqual(12);
  });

  it('returns 0 when starting inside collision', () => {
    const w = wallWorld(2);
    const stats = { queries: 0 };
    expect(w.sphereCast(V(0, 1, 2.3), V(0, 1, 0), 0.3, stats)).toBe(0);
  });

  it('returns 1 for a clear long path', () => {
    const w = flatWorld();
    const stats = { queries: 0 };
    const from = V(0, 10, 0); // Far above the floor so it's not queried
    const to = V(0, 10, 18);
    const t = w.sphereCast(from, to, 0.3, stats);
    expect(t).toBe(1);
    // Invariant: the result point is not inside collision
    const resultPoint = from.clone().lerp(to, t);
    const contact = w.sphereContact(resultPoint, 0.3);
    expect(!contact || contact.depth < 1e-4).toBe(true);
    expect(stats.queries).toBeLessThanOrEqual(3);
  });

  it('stops before hitting geometry', () => {
    const w = wallWorld(2);
    const stats = { queries: 0 };
    const from = V(0, 1, 0);
    const to = V(0, 1, 10);
    const t = w.sphereCast(from, to, 0.3, stats);
    expect(t).toBeLessThan(1);
    expect(t * 10).toBeCloseTo(2.2, 1); // Wall stops at ~2.2m
    // Invariant: the result point is not deeply inside collision
    const resultPoint = from.clone().lerp(to, t);
    const contact = w.sphereContact(resultPoint, 0.3);
    expect(!contact || contact.depth < 1e-4).toBe(true);
  });

  it('resolves sphere penetrating a concave corner', () => {
    const w = cornerWorld();
    // Sphere barely embedded in corner
    const c = V(-0.1, 0.1, 0);
    const radius = 0.2;
    w.resolveSphere(c, radius);
    // After resolve, no significant contact
    const contact = w.sphereContact(c, radius);
    expect(!contact || contact.depth < 1e-3).toBe(true);
  });

  it('stops at a vertical wall EDGE when the path passes just outside the side face', () => {
    // wallWorld(2)'s first box spans x ∈ [-5, 5], y ∈ [0, 2], z ∈ [2.5, 3.5]. A sweep along +z at x = 5.2
    // stays 0.2 m outside the x = 5 side face, so the first contact is the vertical edge (x = 5, z = 2.5):
    // it happens when the centre reaches z = 2.5 − √(r² − 0.2²).
    const w = wallWorld(2);
    const r = 0.3;
    const from = V(5.2, 1, 0);
    const to = V(5.2, 1, 5);
    const t = w.sphereCast(from, to, r);
    const zEdge = 2.5 - Math.sqrt(r * r - 0.2 * 0.2); // ≈ 2.2764
    expect(t * 5).toBeGreaterThan(zEdge - 0.01);
    expect(t * 5).toBeLessThanOrEqual(zEdge + 1e-6);
    const c = w.sphereContact(from.clone().lerp(to, t), r);
    expect(!c || c.depth < 1e-4).toBe(true); // spec §8.1 invariant (Ruling 10 tolerance)
    // 0.35 m outside the side face the path clears the edge (and the second box) entirely.
    expect(w.sphereCast(V(5.35, 1, 0), V(5.35, 1, 5), r)).toBe(1);
  });
});
