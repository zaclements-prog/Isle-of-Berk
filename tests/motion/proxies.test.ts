import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BodyProxies } from '../../src/characters/dragon/motion/proxies';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { wallWorld, rampWorld } from '../fixtures/worlds';

function setup() {
  const rig = toothlessFixtureRig();
  const s = new RigSkeleton(rig);
  s.resetToBind();
  s.fk();
  const p = new BodyProxies(rig, s);
  p.update(s);
  return p;
}

describe('BodyProxies', () => {
  it('uses the six body spheres from the rig (not the tail)', () => {
    expect(setup().items.map((i) => i.name).sort()).toEqual(['belly', 'chest', 'head', 'hips', 'muzzle', 'neck']);
  });
  it('stops the body at a wall and keeps the tangential slide', () => {
    const p = setup();
    const world = wallWorld(3, 3); // near face at z = 2.5 — just ahead of the muzzle (z 2.02, r 0.2)
    const d = p.resolveMove(world, new THREE.Vector3(0.5, 0, 0.5), DEFAULT_TUNING.body.wallNormalY);
    expect(p.blocked).toBe(true);
    expect(d.x).toBeCloseTo(0.5, 6);
    expect(d.z).toBeLessThan(0.3);
    for (let k = 0; k < p.items.length; k++) {
      const c = world.sphereContact(p.centers[k].clone().add(d), p.items[k].radius);
      expect(!c || c.normal.y >= 0.64 || c.depth < 1e-3).toBe(true);
    }
  });
  it('ignores ground-like contacts so slopes never block walking', () => {
    const p = setup();
    // 15° ramp whose surface just meets the belly: every contact along the body is the ramp's top face
    const d = p.resolveMove(rampWorld(15, -2.7), new THREE.Vector3(0, 0, 0.3), DEFAULT_TUNING.body.wallNormalY);
    expect(d.z).toBeCloseTo(0.3, 9);
    expect(p.blocked).toBe(false);
  });
  it('honours a stricter maxNormalY: the same ramp now counts as wall-like', () => {
    const p = setup();
    // Same 15° ramp (normal.y ≈ cos(15°) ≈ 0.966) but with maxNormalY raised past that — no longer ground-like.
    const d = p.resolveMove(rampWorld(15, -2.7), new THREE.Vector3(0, 0, 0.3), 0.99);
    expect(p.blocked).toBe(true);
    expect(d.z).not.toBeCloseTo(0.3, 6);
  });
});
