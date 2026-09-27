import * as THREE from 'three';
import { wrapAngle } from './math';

export interface SpringState {
  x: number;
  v: number;
}

/**
 * Advance x'' = −ω²(x − target) − 2ζω·x' by dt with the EXACT solution (0 ≤ ζ ≤ 1; ζ ≥ 1 is treated as critical).
 * Exact integration is unconditionally stable and step-size independent: one 1/30 s step equals eight 1/240 s steps.
 *   critical (ζ = 1), y = x − target, j = v0 + ω·y0:  y(t) = (y0 + j·t)·e^(−ωt),  v(t) = (v0 − ω·j·t)·e^(−ωt)
 *   underdamped, a = ζω, b = ω√(1 − ζ²):           y(t) = e^(−at)·(y0·cos bt + ((v0 + a·y0)/b)·sin bt)
 *                                                  v(t) = e^(−at)·(v0·cos bt − ((ω²·y0 + a·v0)/b)·sin bt)
 * A constant external acceleration A shifts the equilibrium: pass target + A/ω².
 */
export function stepSpring(s: SpringState, target: number, omega: number, zeta: number, dt: number): void {
  const y = s.x - target;
  if (zeta >= 0.9999) {
    const e = Math.exp(-omega * dt);
    const j = s.v + omega * y;
    s.x = target + (y + j * dt) * e;
    s.v = (s.v - omega * j * dt) * e;
    return;
  }
  const a = zeta * omega;
  const b = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-a * dt);
  const c = Math.cos(b * dt);
  const sn = Math.sin(b * dt);
  const nx = e * (y * c + ((s.v + a * y) / b) * sn);
  const nv = e * (s.v * c - ((omega * omega * y + a * s.v) / b) * sn);
  s.x = target + nx;
  s.v = nv;
}

/** Spring on an angle: the target is unwrapped next to x so the spring always takes the short way round. */
export function stepAngleSpring(s: SpringState, target: number, omega: number, zeta: number, dt: number): void {
  stepSpring(s, s.x + wrapAngle(target - s.x), omega, zeta, dt);
  s.x = wrapAngle(s.x);
}

/** Three independent exact springs. */
export class Vec3Spring {
  readonly x = new THREE.Vector3();
  readonly v = new THREE.Vector3();
  private readonly s: SpringState = { x: 0, v: 0 };

  reset(p: THREE.Vector3): void {
    this.x.copy(p);
    this.v.set(0, 0, 0);
  }

  step(target: THREE.Vector3, omega: number, zeta: number, dt: number): void {
    for (const k of ['x', 'y', 'z'] as const) {
      this.s.x = this.x[k];
      this.s.v = this.v[k];
      stepSpring(this.s, target[k], omega, zeta, dt);
      this.x[k] = this.s.x;
      this.v[k] = this.s.v;
    }
  }
}
