import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlasmaFx } from '../../src/fx/plasmaFx';
import { Particles } from '../../src/fx/particles';
import { OrbitCamera } from '../../src/camera/orbitCamera';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld } from '../../src/world/collision';
import { box, floor, flatWorld } from '../fixtures/worlds';

const DT = 1 / 60;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function scene() {
  const wall = box(20, 6, 1, 0, 3, 20.5);                 // near face at z = 20
  const ground = floor();
  const world = CollisionWorld.fromObjects([ground, wall]);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  camera.position.set(0, 3, -6);
  camera.lookAt(0, 1, 10);
  camera.updateMatrixWorld();
  wall.updateMatrixWorld();
  const shakes: number[] = [];
  const fx = new PlasmaFx({ world, cfg: DEFAULT_TUNING.plasma, shake: (a) => shakes.push(a) });
  return { fx, camera, shakes, wall };
}

describe('PlasmaFx', () => {
  it('flies a bolt at the plasma speed and hits the first surface in its path', () => {
    const { fx, camera, shakes } = scene();
    fx.fire({ from: V(0, 1.5, 2), dir: V(0, 0, 1) });
    let frames = 0;
    while (fx.flying && frames < 200) {
      fx.update(DT, camera, 1080);
      frames++;
    }
    expect(fx.impacts).toBe(1);
    const expected = (20 - 2 - DEFAULT_TUNING.plasma.boltRadius) / DEFAULT_TUNING.plasma.boltSpeed;
    expect(frames * DT).toBeGreaterThan(expected - 2 * DT);
    expect(frames * DT).toBeLessThan(expected + 2 * DT);
    expect(fx.sparks.count).toBeGreaterThan(20);
    expect(fx.smoke.count).toBeGreaterThan(4);
    expect(fx.decals).toBe(1);
    expect(shakes).toHaveLength(1);
  });
  it('projects the scorch onto the hit mesh', () => {
    const { fx, camera } = scene();
    fx.fire({ from: V(1, 2, 5), dir: V(0, 0, 1) });
    for (let k = 0; k < 60; k++) fx.update(DT, camera, 1080);
    const scorch = fx.root.children.find((c) => c.name === 'fx-scorch') as THREE.Mesh;
    expect(scorch).toBeTruthy();
    const pos = scorch.geometry.attributes.position;
    expect(pos.count).toBeGreaterThan(3);
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getZ(i) - 20)).toBeLessThan(0.05);   // on the wall's face
    // three.js reads an alphaMap's GREEN channel: the scorch fades out to transparent corners, not a dark square
    const tex = (scorch.material as THREE.MeshStandardMaterial).alphaMap as THREE.DataTexture;
    const { data, width } = tex.image as { data: Uint8Array; width: number };
    const g = (x: number, y: number) => data[(y * width + x) * 4 + 1];
    expect(g(width / 2, width / 2)).toBeGreaterThan(150);
    expect(g(0, 0)).toBe(0);
  });
  it('scorches a big terrain-like mesh from a local patch of its collision triangles', () => {
    // 80 000 triangles, like a Cove terrain chunk: the decal is cut from the few triangles under the impact
    const g = new THREE.PlaneGeometry(200, 200, 200, 200).rotateX(-Math.PI / 2);
    const world = CollisionWorld.fromObjects([new THREE.Mesh(g)]);
    const camera = new THREE.PerspectiveCamera();
    const fx = new PlasmaFx({ world, cfg: DEFAULT_TUNING.plasma });
    fx.fire({ from: V(3.3, 2, 0), dir: V(0, -1, 0.4).normalize() });
    for (let k = 0; k < 30; k++) fx.update(DT, camera, 1080);
    expect(fx.decals).toBe(1);
    const scorch = fx.root.children.find((c) => c.name === 'fx-scorch') as THREE.Mesh;
    const pos = scorch.geometry.attributes.position;
    expect(pos.count).toBeGreaterThan(3);
    expect(pos.count).toBeLessThan(600);
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getY(i))).toBeLessThan(1e-4);                   // on the ground
  });
  it('expires a bolt that hits nothing, and pools bolts and decals', () => {
    const world = flatWorld();
    const camera = new THREE.PerspectiveCamera();
    const fx = new PlasmaFx({ world, cfg: DEFAULT_TUNING.plasma });
    fx.fire({ from: V(0, 5, 0), dir: V(0, 0.2, 1) });
    for (let k = 0; k < 400 && fx.flying; k++) fx.update(DT, camera, 1080);
    expect(fx.flying).toBe(0);
    expect(fx.impacts).toBe(0);
    const lightsBefore = fx.root.children.filter((c) => (c as THREE.PointLight).isPointLight).length;
    for (let k = 0; k < 20; k++) {
      fx.fire({ from: V(0, 2, 0), dir: V(0, -1, 0.3).normalize() });
      for (let j = 0; j < 30; j++) fx.update(DT, camera, 1080);
    }
    expect(fx.impacts).toBe(20);
    expect(fx.decals).toBeLessThanOrEqual(12);
    expect(fx.root.children.filter((c) => (c as THREE.PointLight).isPointLight).length).toBe(lightsBefore);
  });
});

describe('Particles', () => {
  it('ages, fades and recycles particles; the shader caps their screen size', () => {
    const p = new Particles({ capacity: 4, additive: true, maxPixels: 12, fadeNear: 10, fadeFar: 20, gravity: 9.81, drag: 0 });
    for (let k = 0; k < 6; k++) p.emit({ pos: V(0, 0, 0), vel: V(0, 5, 0), life: 0.5 + k * 0.1, size: 0.1, grow: 0, color: new THREE.Color(1, 1, 1), alpha: 1 });
    expect(p.count).toBe(4);
    p.update(0.55);
    expect(p.count).toBe(3);
    p.update(1);
    expect(p.count).toBe(0);
    expect(p.material.fragmentShader).toContain('discard');
    expect(p.material.vertexShader).toContain('min(aSize * uScale / dist, uMaxPx)');
  });
});

describe('OrbitCamera.shake', () => {
  it('shakes the view and settles back', () => {
    const cam = new OrbitCamera(DEFAULT_TUNING.camera, flatWorld());
    const f = { chest: V(0, 1.25, 0), velocity: V(0, 0, 0), heading: 0, moving: false, climbing: false, bodySpheres: [] };
    cam.reset(f);
    for (let k = 0; k < 240; k++) cam.update({ mouseDX: 0, mouseDY: 0, wheel: 0 }, f, 1 / 120);
    const rest = cam.position.clone();
    cam.shake(0.12, 0.35);
    let maxOff = 0;
    for (let k = 0; k < 30; k++) {
      cam.update({ mouseDX: 0, mouseDY: 0, wheel: 0 }, f, 1 / 120);
      maxOff = Math.max(maxOff, cam.position.distanceTo(rest));
    }
    expect(maxOff).toBeGreaterThan(0.02);
    for (let k = 0; k < 60; k++) cam.update({ mouseDX: 0, mouseDY: 0, wheel: 0 }, f, 1 / 120);
    expect(cam.position.distanceTo(rest)).toBeLessThan(1e-6);
  });
});
