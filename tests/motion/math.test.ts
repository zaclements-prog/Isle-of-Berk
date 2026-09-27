import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  wrapAngle, angleDiff, phaseDiff, fract, smoothstep, deg, twistAngle, swingTwist, clampTwist, rotY,
} from '../../src/characters/dragon/motion/math';

describe('angles and phases', () => {
  it('wraps angles to (-π, π]', () => {
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(7 * Math.PI)).toBeCloseTo(Math.PI, 9);
  });
  it('takes the short way round', () => {
    expect(angleDiff(deg(170), deg(-170))).toBeCloseTo(deg(20), 12);
    expect(angleDiff(deg(-170), deg(170))).toBeCloseTo(deg(-20), 12);
    expect(phaseDiff(0.95, 0.05)).toBeCloseTo(0.1, 12);
    expect(fract(-0.25)).toBeCloseTo(0.75, 12);
  });
  it('smoothsteps', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(1, 0, 0.25)).toBeCloseTo(smoothstep(0, 1, 0.75), 12);
  });
  it('rotates about +Y so heading ψ maps +Z to (sin ψ, 0, cos ψ)', () => {
    const v = rotY(new THREE.Vector3(0, 0, 1), deg(90), new THREE.Vector3());
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });
});

describe('swing-twist', () => {
  const axis = new THREE.Vector3(0.3, -0.2, 0.9).normalize();
  it('recovers the angle of a pure twist', () => {
    for (const a of [-2.5, -1, 0, 0.7, 3]) {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, a);
      expect(twistAngle(q, axis)).toBeCloseTo(a, 9);
    }
  });
  it('recomposes q = swing · twist with a swing perpendicular to the axis', () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.8, 1.1));
    const s = new THREE.Quaternion();
    const t = new THREE.Quaternion();
    swingTwist(q, axis, s, t);
    expect(Math.abs(s.clone().multiply(t).dot(q))).toBeCloseTo(1, 9);
    expect(Math.abs(s.x * axis.x + s.y * axis.y + s.z * axis.z)).toBeLessThan(1e-9);
  });
  it('clamps only the twist', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, 1.2);
    expect(clampTwist(q, axis, -0.5, 0.5)).toBeCloseTo(-0.7, 9);
    expect(twistAngle(q, axis)).toBeCloseTo(0.5, 9);
    const inside = new THREE.Quaternion().setFromAxisAngle(axis, 0.2);
    expect(clampTwist(inside, axis, -0.5, 0.5)).toBe(0);
  });
  it('twistAngle returns 0 at 180° swing singularity', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    const twistAxis = new THREE.Vector3(0, 1, 0);
    expect(twistAngle(q, twistAxis)).toBe(0);
  });
});
