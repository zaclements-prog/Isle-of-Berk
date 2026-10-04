import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BodyProxies } from '../../src/characters/dragon/motion/proxies';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, floor, wallWorld, rampWorld } from '../fixtures/worlds';
import { CollisionWorld } from '../../src/world/collision';
import { rotY } from '../../src/characters/dragon/motion/math';

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
  it('tests the proxies where the step\'s turn swings them, and pushes the body out of a wall it turns into', () => {
    const p = setup();
    // a wall along z to his left (+X), clear of the head now; a 30° turn left swings the head (z 1.72) into it
    const world = CollisionWorld.fromObjects([floor(), box(1, 3, 10, 1.4, 1.5, 0)]);
    const pivot = new THREE.Vector3(0, 0, 0);
    const turn = (30 * Math.PI) / 180;
    const still = p.resolveMove(world, new THREE.Vector3(), DEFAULT_TUNING.body.wallNormalY);
    expect(still.length()).toBe(0);
    const d = p.resolveMove(world, new THREE.Vector3(), DEFAULT_TUNING.body.wallNormalY, pivot, turn);
    expect(p.blocked).toBe(true);
    expect(d.x).toBeLessThan(-0.05); // pushed away from the wall (−X)
    for (let k = 0; k < p.items.length; k++) {
      const c = rotY(p.centers[k].clone().sub(pivot), turn, new THREE.Vector3()).add(pivot).add(d);
      const contact = world.sphereContact(c, p.items[k].radius);
      expect(!contact || contact.normal.y >= 0.64 || contact.depth < 1e-3).toBe(true);
    }
  });
  it('keeps a skin of clearance from walls when asked', () => {
    const p = setup();
    const world = wallWorld(3, 3); // near face at z = 2.5
    const d = p.resolveMove(world, new THREE.Vector3(0, 0, 0.5), DEFAULT_TUNING.body.wallNormalY, undefined, 0, 0.04);
    for (let k = 0; k < p.items.length; k++) {
      const c = world.sphereContact(p.centers[k].clone().add(d), p.items[k].radius + 0.04);
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
