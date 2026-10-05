import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OrbitCamera, type CameraFollow } from '../../src/camera/orbitCamera';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld } from '../../src/world/collision';
import { box, floor, flatWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const T = DEFAULT_TUNING.camera;
const follow = (o: Partial<CameraFollow> = {}): CameraFollow => ({
  chest: new THREE.Vector3(0, 1.25, 0), velocity: new THREE.Vector3(), heading: 0, moving: false, climbing: false,
  bodySpheres: [{ center: new THREE.Vector3(0, 1.0, 0.6), radius: 0.44 }], ...o,
});
const still = { mouseDX: 0, mouseDY: 0, wheel: 0 };
function settle(c: OrbitCamera, f: CameraFollow, seconds: number, inp = still): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) c.update(k === 0 ? inp : still, f, DT);
}
/** A 5 m-high wall across X whose near face is 3 m behind the chest. */
const wallBehind = () => CollisionWorld.fromObjects([floor(), box(20, 5, 1, 0, 2.5, -3.5)]);

describe('OrbitCamera', () => {
  it('sits behind and above the dragon at the set distance and pitch', () => {
    const c = new OrbitCamera(T, flatWorld());
    const f = follow();
    c.reset(f);
    settle(c, f, 2);
    const p = THREE.MathUtils.degToRad(T.pitchDeg);
    expect(c.position.distanceTo(new THREE.Vector3(0, 1.25 + T.distance * Math.sin(p), -T.distance * Math.cos(p)))).toBeLessThan(1e-3);
  });
  it('pulls in at a wall and never ends inside geometry', () => {
    const w = wallBehind();
    const c = new OrbitCamera(T, w);
    const f = follow();
    c.reset(f);
    settle(c, f, 1);
    expect(c.position.z).toBeGreaterThan(-3);
    expect(w.closestPoint(c.position, T.radius * 0.5)).toBeNull();
  });
  it('eases back out slowly when the obstacle is gone', () => {
    const c = new OrbitCamera(T, wallBehind());
    const f = follow();
    c.reset(f);
    settle(c, f, 1);
    const near = c.currentDistance;
    c.world = flatWorld();
    settle(c, f, 0.25);
    expect(c.currentDistance).toBeLessThan(T.distance - 1);
    expect(c.currentDistance).toBeGreaterThan(near);
    settle(c, f, 5);
    expect(c.currentDistance).toBeCloseTo(T.distance, 1);
  });
  it('recentres behind a moving dragon after ~2 s without mouse input', () => {
    const c = new OrbitCamera(T, flatWorld());
    const f = follow({ moving: true, heading: 0 });
    c.reset(f);
    c.yaw = Math.PI / 2;
    settle(c, f, 1.5);
    expect(c.yaw).toBeCloseTo(Math.PI / 2, 6);
    settle(c, f, 6);
    expect(Math.abs(c.yaw)).toBeLessThan(0.1);
  });
  it('orbits with the mouse and clamps the zoom', () => {
    const c = new OrbitCamera(T, flatWorld());
    const f = follow();
    c.reset(f);
    c.update({ mouseDX: 100, mouseDY: 0, wheel: 0 }, f, DT);
    expect(c.yaw).toBeCloseTo(-100 * T.sensitivity, 9);
    c.update({ mouseDX: 0, mouseDY: 0, wheel: 1e5 }, f, DT);
    expect(c.distance).toBe(T.maxDistance);
    c.update({ mouseDX: 0, mouseDY: 0, wheel: -1e5 }, f, DT);
    expect(c.distance).toBe(T.minDistance);
  });
  it('fades the dragon when the camera is forced close to the body', () => {
    const c = new OrbitCamera(T, CollisionWorld.fromObjects([floor(), box(20, 5, 1, 0, 2.5, -1.2)]));
    const f = follow();
    c.reset(f);
    settle(c, f, 1);
    expect(c.fade).toBeGreaterThan(0.3);
    const far = new OrbitCamera(T, flatWorld());
    far.reset(f);
    settle(far, f, 1);
    expect(far.fade).toBe(0);
  });
});
