import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WorldEvents } from '../../src/world/events';
import { DEFAULT_FORCE_TUNING, ForceField, MAX_SHOCKS, type ForceSource } from '../../src/world/forceField';
import { buildProps } from '../../src/world/island/props';
import { Ocean } from '../../src/world/island/ocean';

const blast = (x: number, time: number, power = 1) => ({
  type: 'blast' as const, point: new THREE.Vector3(x, 0, 0), normal: new THREE.Vector3(0, 1, 0), power, radius: 6, time,
});

function settle(f: ForceField, s: ForceSource, seconds = 2, t0 = 0): number {
  let t = t0;
  for (let k = 0; k < seconds * 120; k++) f.update((t += 1 / 120), 1 / 120);
  void s;
  return t;
}

describe('world events', () => {
  it('delivers each event to its subscribers until they unsubscribe', () => {
    const bus = new WorldEvents();
    const got: number[] = [];
    const off = bus.on('blast', (e) => got.push(e.point.x));
    bus.emit(blast(3, 0));
    off();
    bus.emit(blast(4, 0));
    expect(got).toEqual([3]);
  });
});

describe('force field', () => {
  const source = (agl: number, wingPush = 1, airborne = true): ForceSource => ({
    airborne, chest: new THREE.Vector3(0, 10 + agl, 0), velocity: new THREE.Vector3(0, 0, 12), ground: 10, wingPush,
  });

  it('blows down hardest close to the ground, fading out by about a wingspan up, and only while flying', () => {
    const at = (agl: number, push = 1, air = true) => {
      const f = new ForceField();
      const s = source(agl, push, air);
      f.source = () => s;
      settle(f, s);
      return f.downwash;
    };
    expect(at(2)).toBeGreaterThan(0.8);
    expect(at(6)).toBeLessThan(at(2));
    expect(at(6)).toBeGreaterThan(0.3);
    expect(at(DEFAULT_FORCE_TUNING.downFadeHeight + 1)).toBe(0);
    expect(at(2, 0)).toBeLessThan(at(2, 1) * 0.4);               // a glide pushes a little, a downstroke a lot
    expect(at(2, 1, false)).toBe(0);                             // standing or walking: no downwash
  });

  it('puts the downwash disc on the ground just ahead of him, and the wake along his heading', () => {
    const f = new ForceField();
    const s = source(3);
    f.source = () => s;
    settle(f, s);
    const d = f.uniforms.uForceDown.value;
    expect(d.y).toBe(10);
    expect(d.z).toBeGreaterThan(0);
    expect(d.w).toBeGreaterThan(DEFAULT_FORCE_TUNING.downRadius);
    expect(f.uniforms.uForceWakeDir.value.y).toBeCloseTo(1);
    expect(f.uniforms.uForceWakeDir.value.z).toBeGreaterThan(0.5);
  });

  it('eases in and out instead of snapping', () => {
    const f = new ForceField();
    let s: ForceSource | null = source(2);
    f.source = () => s;
    f.update(1 / 120, 1 / 120);
    expect(f.downwash).toBeLessThan(0.1);
    settle(f, s!);
    s = null;
    f.update(3, 1 / 120);
    expect(f.downwash).toBeGreaterThan(0.5);
  });

  it('sends a blast out as a ring at the shock speed, weakening to nothing over its life', () => {
    const bus = new WorldEvents();
    const f = new ForceField(DEFAULT_FORCE_TUNING, bus);
    bus.emit(blast(5, 1));
    f.update(1.25, 1 / 120);
    const ring = f.uniforms.uForceShock.value[0];
    expect(ring.x).toBe(5);
    expect(ring.w).toBeCloseTo(0.25 * DEFAULT_FORCE_TUNING.shockSpeed, 5);
    const s1 = f.uniforms.uForceShockS.value[0].x;
    f.update(1.8, 1 / 120);
    const s2 = f.uniforms.uForceShockS.value[0].x;
    expect(s2).toBeLessThan(s1);
    expect(s1).toBeLessThan(1);
    f.update(1 + DEFAULT_FORCE_TUNING.shockLife + 0.01, 1 / 120);
    expect(f.uniforms.uForceShockS.value[0].x).toBe(0);
  });

  it('keeps the newest shocks when more blasts land than it can hold', () => {
    const f = new ForceField();
    for (let k = 0; k <= MAX_SHOCKS; k++) f.addShock(new THREE.Vector3(k, 0, 0), 1, 0);
    f.update(0.01, 0.01);
    expect(f.uniforms.uForceShock.value.map((v) => v.x)).toEqual(Array.from({ length: MAX_SHOCKS }, (_, k) => k + 1));
  });

  it('is read by the trees and the water through the same uniforms', () => {
    const f = new ForceField();
    const stub = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_maps>' };
    const props = buildProps([[0, 0, 0, 1, 0, 0]], [], () => 0, f.uniforms);
    const tree = props.root.children[0] as THREE.InstancedMesh;
    const ts = structuredClone(stub);
    (tree.material as THREE.Material).onBeforeCompile(ts as never, {} as never);
    expect(ts.uniforms.uForceWake).toBe(f.uniforms.uForceWake);
    expect(ts.vertexShader).toContain('forceAt(base)');
    const ocean = new Ocean({ seaLevel: 0, heightTexture: new THREE.DataTexture(), extent: new THREE.Vector4(), force: f.uniforms });
    const os = structuredClone(stub);
    ocean.material.onBeforeCompile(os as never, {} as never);
    expect(os.uniforms.uForceDown).toBe(f.uniforms.uForceDown);
    expect(os.fragmentShader).toContain('oceanForce(vOceanXZ)');
    props.dispose();
    ocean.dispose();
  });
});
