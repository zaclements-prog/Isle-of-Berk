import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { stepSpring, stepAngleSpring, Vec3Spring, type SpringState } from '../../src/characters/dragon/motion/springs';
import { deg } from '../../src/characters/dragon/motion/math';

function run(s: SpringState, target: number, omega: number, zeta: number, dt: number, n: number): void {
  for (let i = 0; i < n; i++) stepSpring(s, target, omega, zeta, dt);
}

describe('springs', () => {
  it('critically damped: converges with no overshoot', () => {
    const s = { x: 1, v: 0 };
    let min = Infinity;
    for (let i = 0; i < 240; i++) {
      stepSpring(s, 0, 10, 1, 1 / 120);
      min = Math.min(min, s.x);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
  });
  it.each([1, 0.35, 0])('is independent of the step size (ζ = %s)', (zeta) => {
    const a = { x: 0.8, v: -2 };
    const b = { x: 0.8, v: -2 };
    run(a, 0.1, 9, zeta, 1 / 30, 1);
    run(b, 0.1, 9, zeta, 1 / 240, 8);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.v).toBeCloseTo(b.v, 9);
  });
  it.each([1 / 240, 1 / 120, 1 / 60, 1 / 30])('never gains energy (dt = %s)', (dt) => {
    for (const zeta of [1, 0.45, 0.1]) {
      const omega = 20;
      const s = { x: 1, v: 3 };
      let e = 0.5 * s.v * s.v + 0.5 * omega * omega * s.x * s.x;
      for (let i = 0; i < 300; i++) {
        stepSpring(s, 0, omega, zeta, dt);
        const e2 = 0.5 * s.v * s.v + 0.5 * omega * omega * s.x * s.x;
        expect(e2).toBeLessThanOrEqual(e + 1e-9);
        e = e2;
      }
    }
  });
  it('underdamped springs overshoot (follow-through)', () => {
    const s = { x: 1, v: 0 };
    let min = Infinity;
    for (let i = 0; i < 240; i++) {
      stepSpring(s, 0, 10, 0.3, 1 / 120);
      min = Math.min(min, s.x);
    }
    expect(min).toBeLessThan(-0.1);
  });
  it('angle springs take the short way round', () => {
    const s = { x: deg(170), v: 0 };
    for (let i = 0; i < 240; i++) {
      stepAngleSpring(s, deg(-170), 8, 1, 1 / 120);
      expect(Math.abs(s.x)).toBeGreaterThan(deg(150));
    }
    expect(s.x).toBeCloseTo(deg(-170), 3);
  });
  it('vector springs converge', () => {
    const sp = new Vec3Spring();
    sp.reset(new THREE.Vector3(1, 2, 3));
    const target = new THREE.Vector3(-1, 0, 0.5);
    for (let i = 0; i < 600; i++) sp.step(target, 8, 1, 1 / 120);
    expect(sp.x.distanceTo(target)).toBeLessThan(1e-4);
  });
});
