import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mulberry32 } from '../../src/core/rng';
import {
  solveTwoBone, createTwoBoneResult, solvePantograph, createPantographResult, chainFrame, createFrame, planeAngle,
  type TwoBoneInput, type PantographInput,
} from '../../src/characters/dragon/motion/ik';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** World rotation of a bone from head to tail with its local +Y along the bone and +X near −X world. */
function boneQuat(head: THREE.Vector3, tail: THREE.Vector3): THREE.Quaternion {
  const y = tail.clone().sub(head).normalize();
  const x = V(-1, 0, 0).addScaledVector(y, y.x).normalize();
  const z = x.clone().cross(y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const along = (q: THREE.Quaternion, len: number) => V(0, len, 0).applyQuaternion(q);
const sameRotation = (a: THREE.Quaternion, b: THREE.Quaternion) => Math.abs(a.dot(b)) > 1 - 1e-9;

// Toothless front leg (glTF space, from the anatomy): shoulder → elbow → wrist; elbows point back (pole −Z).
const SH = V(0.31, 0.95, 0.74);
const EL = V(0.34, 0.56, 0.6);
const WR = V(0.34, 0.17, 0.74);
const front = (target: THREE.Vector3, minInterior = 0, maxInterior = Math.PI): TwoBoneInput => ({
  root: SH, mid: EL, end: WR, upper: boneQuat(SH, EL), lower: boneQuat(EL, WR),
  target, pole: V(0, 0, -1), minInterior, maxInterior,
});

// Hind leg: hip → knee → hock → paw; knees point forward (pole +Z).
const HIP = V(0.29, 0.97, -0.62);
const KNEE = V(0.34, 0.6, -0.36);
const HOCK = V(0.33, 0.3, -0.74);
const PAW = V(0.33, 0.07, -0.6);
const hind = (target: THREE.Vector3): PantographInput => ({
  hip: HIP, knee: KNEE, hock: HOCK, paw: PAW,
  femur: boneQuat(HIP, KNEE), tibia: boneQuat(KNEE, HOCK), meta: boneQuat(HOCK, PAW),
  target, pole: V(0, 0, 1), maxReach: 0.995,
});

function randomTargets(center: THREE.Vector3, spread: THREE.Vector3, n: number, seed: number): THREE.Vector3[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () =>
    V(center.x + (rnd() * 2 - 1) * spread.x, center.y + (rnd() * 2 - 1) * spread.y, center.z + (rnd() * 2 - 1) * spread.z));
}

describe('solveTwoBone', () => {
  const l1 = EL.distanceTo(SH);
  const l2 = WR.distanceTo(EL);
  it('returns the reference pose for the reference target', () => {
    const inp = front(WR.clone());
    const o = solveTwoBone(inp, createTwoBoneResult());
    expect(sameRotation(o.upper, inp.upper)).toBe(true);
    expect(sameRotation(o.lower, inp.lower)).toBe(true);
    expect(o.reached).toBe(true);
  });
  it('reaches reachable targets within 1 mm, keeping bone lengths and consistent rotations', () => {
    const o = createTwoBoneResult();
    for (const t of randomTargets(V(0.34, 0.3, 0.8), V(0.05, 0.12, 0.25), 200, 3)) {
      if (t.distanceTo(SH) > l1 + l2 - 0.01) continue;
      solveTwoBone(front(t), o);
      expect(o.end.distanceTo(t)).toBeLessThan(1e-3);
      expect(o.mid.distanceTo(SH)).toBeCloseTo(l1, 9);
      expect(o.end.distanceTo(o.mid)).toBeCloseTo(l2, 9);
      expect(SH.clone().add(along(o.upper, l1)).distanceTo(o.mid)).toBeLessThan(1e-9);
      expect(o.mid.clone().add(along(o.lower, l2)).distanceTo(o.end)).toBeLessThan(1e-9);
    }
  });
  it('keeps the bend on the pole side (elbows back) and never flips', () => {
    const o = createTwoBoneResult();
    for (const t of randomTargets(V(0.34, 0.3, 0.8), V(0.05, 0.12, 0.25), 200, 5)) {
      solveTwoBone(front(t), o);
      const u = o.end.clone().sub(SH).normalize();
      const side = o.mid.clone().sub(SH);
      side.addScaledVector(u, -side.dot(u));
      expect(side.z).toBeLessThan(0);
    }
  });
  it('moves the middle joint continuously as the target moves', () => {
    const o = createTwoBoneResult();
    const a = V(0.34, 0.25, 0.95);
    const b = V(0.34, 0.3, 0.45);
    let prev: THREE.Vector3 | null = null;
    for (let k = 0; k <= 500; k++) {
      solveTwoBone(front(a.clone().lerp(b, k / 500)), o);
      if (prev) expect(o.mid.distanceTo(prev)).toBeLessThan(0.01);
      prev = o.mid.clone();
    }
  });
  it('clamps unreachable targets along the target direction', () => {
    const t = SH.clone().add(V(0, -2, 0.3));
    const o = solveTwoBone(front(t), createTwoBoneResult());
    expect(o.reached).toBe(false);
    expect(o.shortfall).toBeGreaterThan(1);
    expect(o.stretch).toBeGreaterThan(1);
    const dir = t.clone().sub(SH).normalize();
    expect(o.end.clone().sub(SH).normalize().dot(dir)).toBeCloseTo(1, 9);
  });
  it('respects the middle-joint interior limits', () => {
    const minInterior = 2.0;
    const t = SH.clone().add(V(0, -0.3, 0));
    const o = solveTwoBone(front(t, minInterior), createTwoBoneResult());
    expect(o.interior).toBeGreaterThanOrEqual(minInterior - 1e-9);
    expect(o.reached).toBe(false);
  });
});

describe('solvePantograph', () => {
  const pawOf = (o: { paw: THREE.Vector3 }) => o.paw;
  it('returns the reference pose for the reference target', () => {
    const inp = hind(PAW.clone());
    const o = solvePantograph(inp, createPantographResult());
    expect(sameRotation(o.femur, inp.femur)).toBe(true);
    expect(sameRotation(o.tibia, inp.tibia)).toBe(true);
    expect(sameRotation(o.meta, inp.meta)).toBe(true);
  });
  it('reaches targets within 1 mm and keeps the metatarsal–femur angle', () => {
    const f0 = createFrame();
    chainFrame(HIP, KNEE, PAW, V(0, 0, 1), f0);
    const delta0 = planeAngle(PAW.clone().sub(HOCK), f0) - planeAngle(KNEE.clone().sub(HIP), f0);
    const o = createPantographResult();
    const f = createFrame();
    for (const t of randomTargets(V(0.33, 0.15, -0.6), V(0.05, 0.15, 0.3), 200, 9)) {
      solvePantograph(hind(t), o);
      expect(pawOf(o).distanceTo(t)).toBeLessThan(1e-3);
      chainFrame(HIP, o.knee, o.paw, V(0, 0, 1), f);
      const delta = planeAngle(o.paw.clone().sub(o.hock), f) - planeAngle(o.knee.clone().sub(HIP), f);
      expect(delta).toBeCloseTo(delta0, 6);
      expect(o.knee.clone().sub(HIP).z).toBeGreaterThan(-0.05); // knee stays forward-ish of the hip line
    }
  });
  it('rotations agree with joint positions', () => {
    const o = solvePantograph(hind(V(0.33, 0.2, -0.3)), createPantographResult());
    expect(HIP.clone().add(along(o.femur, KNEE.distanceTo(HIP))).distanceTo(o.knee)).toBeLessThan(1e-9);
    expect(o.knee.clone().add(along(o.tibia, HOCK.distanceTo(KNEE))).distanceTo(o.hock)).toBeLessThan(1e-9);
    expect(o.hock.clone().add(along(o.meta, PAW.distanceTo(HOCK))).distanceTo(o.paw)).toBeLessThan(1e-9);
  });
  it('clamps far targets and reports the shortfall', () => {
    const o = solvePantograph(hind(V(0.33, -1.5, -0.6)), createPantographResult());
    expect(o.reached).toBe(false);
    expect(o.shortfall).toBeGreaterThan(0.5);
  });
});
