import * as THREE from 'three';
import { clamp } from './math';

/** Bend-plane frame of a chain: u = root → end, w = the side the middle joint bends toward (⟂ u), m = u × w (hinge normal). */
export interface ChainFrame {
  readonly u: THREE.Vector3;
  readonly w: THREE.Vector3;
  readonly m: THREE.Vector3;
}

export function createFrame(): ChainFrame {
  return { u: new THREE.Vector3(), w: new THREE.Vector3(), m: new THREE.Vector3() };
}

/** Unit vector ⟂ u, as close as possible to `hint` (any perpendicular when the hint is parallel to u). */
function perpendicularTo(u: THREE.Vector3, hint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(hint).addScaledVector(u, -hint.dot(u));
  if (out.lengthSq() < 1e-12) {
    out.set(Math.abs(u.x) < 0.9 ? 1 : 0, Math.abs(u.x) < 0.9 ? 0 : 1, 0);
    out.addScaledVector(u, -out.dot(u));
  }
  return out.normalize();
}

/**
 * Frame of a chain in its reference configuration. w is the part of (mid − root) perpendicular to u — the side the
 * middle joint already bends toward — so re-solving to the reference target is exactly the identity. The pole is used
 * only when the chain is straight. Returns false when root and end coincide.
 */
export function chainFrame(
  root: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3, pole: THREE.Vector3, out: ChainFrame,
): boolean {
  out.u.subVectors(end, root);
  const len = out.u.length();
  if (len < 1e-9) return false;
  out.u.divideScalar(len);
  out.w.subVectors(mid, root);
  out.w.addScaledVector(out.u, -out.w.dot(out.u)); // the argument is evaluated before the call mutates w
  if (out.w.lengthSq() < 1e-12) perpendicularTo(out.u, pole, out.w);
  else out.w.normalize();
  out.m.crossVectors(out.u, out.w);
  return true;
}

/** Target frame: u toward the target; w keeps the reference bend side (so the joint never flips). */
export function retargetFrame(
  ref: ChainFrame, root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, out: ChainFrame,
): void {
  out.u.subVectors(target, root);
  if (out.u.lengthSq() < 1e-12) out.u.copy(ref.u);
  else out.u.normalize();
  out.w.copy(ref.w).addScaledVector(out.u, -ref.w.dot(out.u));
  if (out.w.lengthSq() < 1e-6) perpendicularTo(out.u, pole, out.w);
  else out.w.normalize();
  out.m.crossVectors(out.u, out.w);
}

const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();

/** The rotation R with R·u0 = u, R·w0 = w, R·m0 = m, i.e. R = [u w m]·[u0 w0 m0]ᵀ. */
export function frameRotation(from: ChainFrame, to: ChainFrame, out: THREE.Quaternion): THREE.Quaternion {
  _m0.makeBasis(from.u, from.w, from.m).transpose();
  _m1.makeBasis(to.u, to.w, to.m).multiply(_m0);
  return out.setFromRotationMatrix(_m1);
}

/** Angle of v within the frame's bend plane, measured from u toward w. */
export function planeAngle(v: THREE.Vector3, f: ChainFrame): number {
  return Math.atan2(v.dot(f.w), v.dot(f.u));
}

export interface TwoBoneInput {
  readonly root: THREE.Vector3;
  readonly mid: THREE.Vector3;
  readonly end: THREE.Vector3;
  /** Reference world rotations of the two bones (local +Y along each bone). */
  readonly upper: THREE.Quaternion;
  readonly lower: THREE.Quaternion;
  readonly target: THREE.Vector3;
  /** Bend-side hint used only when the reference chain is straight. */
  readonly pole: THREE.Vector3;
  /** Allowed interior angle at the middle joint (rad; 0 … π). */
  readonly minInterior: number;
  readonly maxInterior: number;
}

export interface TwoBoneResult {
  readonly upper: THREE.Quaternion;
  readonly lower: THREE.Quaternion;
  readonly mid: THREE.Vector3;
  readonly end: THREE.Vector3;
  reached: boolean;
  /** Distance still missing to the target (> 0 when out of reach, < 0 when too close). */
  shortfall: number;
  interior: number;
  /** Target distance ÷ the longest reach the limits allow (≥ 1: out of reach). */
  stretch: number;
}

export function createTwoBoneResult(): TwoBoneResult {
  return {
    upper: new THREE.Quaternion(), lower: new THREE.Quaternion(), mid: new THREE.Vector3(), end: new THREE.Vector3(),
    reached: false, shortfall: 0, interior: 0, stretch: 0,
  };
}

const F0 = createFrame();
const F1 = createFrame();
const _R = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * Analytic two-bone IK in the chain's bend plane.
 *   The reach d = |target − root| is clamped to what the middle-joint limits allow: d(θ)² = l1² + l2² − 2·l1·l2·cos θ.
 *   The upper bone's angle from u follows from the law of cosines: cos α = (l1² + d² − l2²) / (2·l1·d), on the w side.
 * Each bone's new world rotation = Rot(m, Δangle) · R · reference, where R maps the reference bend frame onto the
 * target frame. Each bone keeps its own twist relative to the bend plane, and the reference target gives back the
 * reference pose exactly.
 */
export function solveTwoBone(i: TwoBoneInput, o: TwoBoneResult): TwoBoneResult {
  const l1 = i.mid.distanceTo(i.root);
  const l2 = i.end.distanceTo(i.mid);
  if (!chainFrame(i.root, i.mid, i.end, i.pole, F0)) {
    o.upper.copy(i.upper);
    o.lower.copy(i.lower);
    o.mid.copy(i.mid);
    o.end.copy(i.end);
    o.reached = false;
    o.shortfall = 0;
    o.interior = 0;
    o.stretch = 0;
    return o;
  }
  const reachAt = (theta: number) => Math.sqrt(Math.max(l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(theta), 0));
  const dLo = Math.max(Math.abs(l1 - l2) + 1e-5, reachAt(clamp(i.minInterior, 0, Math.PI)));
  const dHi = Math.max(dLo, Math.min(l1 + l2 - 1e-5, reachAt(clamp(i.maxInterior, 0, Math.PI))));
  const dist = i.target.distanceTo(i.root);
  const d = clamp(dist, dLo, dHi);
  retargetFrame(F0, i.root, i.target, i.pole, F1);
  const a0 = planeAngle(_v.subVectors(i.mid, i.root), F0);
  const b0 = planeAngle(_v.subVectors(i.end, i.mid), F0);
  const alpha = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  o.mid.copy(i.root).addScaledVector(F1.u, l1 * Math.cos(alpha)).addScaledVector(F1.w, l1 * Math.sin(alpha));
  o.end.copy(i.root).addScaledVector(F1.u, d);
  const beta = planeAngle(_v.subVectors(o.end, o.mid), F1);
  frameRotation(F0, F1, _R);
  o.upper.setFromAxisAngle(F1.m, alpha - a0).multiply(_R).multiply(i.upper);
  o.lower.setFromAxisAngle(F1.m, beta - b0).multiply(_R).multiply(i.lower);
  o.reached = Math.abs(d - dist) < 1e-6;
  o.shortfall = dist - d;
  o.interior = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  o.stretch = dist / dHi;
  return o;
}

export interface PantographInput {
  readonly hip: THREE.Vector3;
  readonly knee: THREE.Vector3;
  readonly hock: THREE.Vector3;
  readonly paw: THREE.Vector3;
  readonly femur: THREE.Quaternion;
  readonly tibia: THREE.Quaternion;
  readonly meta: THREE.Quaternion;
  readonly target: THREE.Vector3;
  readonly pole: THREE.Vector3;
  /** Fraction of the virtual chain's full length the solver may use (e.g. 0.995). */
  readonly maxReach: number;
}

export interface PantographResult {
  readonly femur: THREE.Quaternion;
  readonly tibia: THREE.Quaternion;
  readonly meta: THREE.Quaternion;
  readonly knee: THREE.Vector3;
  readonly hock: THREE.Vector3;
  readonly paw: THREE.Vector3;
  reached: boolean;
  shortfall: number;
  stretch: number;
}

export function createPantographResult(): PantographResult {
  return {
    femur: new THREE.Quaternion(), tibia: new THREE.Quaternion(), meta: new THREE.Quaternion(),
    knee: new THREE.Vector3(), hock: new THREE.Vector3(), paw: new THREE.Vector3(), reached: false, shortfall: 0, stretch: 0,
  };
}

const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _m = new THREE.Vector3();
const _qF = new THREE.Quaternion();
const _qT = new THREE.Quaternion();
const _qM = new THREE.Quaternion();

/**
 * Three-segment digitigrade leg (femur, tibia, metatarsal) with the mammalian pantograph constraint: the metatarsal
 * keeps its bind angle δ to the femur in the bend plane. Writing in-plane vectors as complex numbers,
 *   paw − hip = Lf·e^{iθf} + Lt·e^{iθt} + Lm·e^{i(θf+δ)} = L1·e^{i(θf+γ)} + Lt·e^{iθt},
 *   L1 = |Lf + Lm·e^{iδ}|,  γ = arg(Lf + Lm·e^{iδ})
 * — a two-bone problem with a virtual upper bone of length L1. Lengths and angles are those of the bones projected on
 * the hip–knee–paw plane; the out-of-plane parts sum to zero and ride along unchanged (rotations are about m), so the
 * paw lands exactly on the clamped target.
 */
export function solvePantograph(i: PantographInput, o: PantographResult): PantographResult {
  if (!chainFrame(i.hip, i.knee, i.paw, i.pole, F0)) {
    o.femur.copy(i.femur);
    o.tibia.copy(i.tibia);
    o.meta.copy(i.meta);
    o.knee.copy(i.knee);
    o.hock.copy(i.hock);
    o.paw.copy(i.paw);
    o.reached = false;
    o.shortfall = 0;
    o.stretch = 0;
    return o;
  }
  _f.subVectors(i.knee, i.hip);
  _t.subVectors(i.hock, i.knee);
  _m.subVectors(i.paw, i.hock);
  const Lf = Math.hypot(_f.dot(F0.u), _f.dot(F0.w));
  const Lt = Math.hypot(_t.dot(F0.u), _t.dot(F0.w));
  const Lm = Math.hypot(_m.dot(F0.u), _m.dot(F0.w));
  const thF0 = planeAngle(_f, F0);
  const thT0 = planeAngle(_t, F0);
  const thM0 = planeAngle(_m, F0);
  const delta = thM0 - thF0;
  const cx = Lf + Lm * Math.cos(delta);
  const cy = Lm * Math.sin(delta);
  const L1 = Math.hypot(cx, cy);
  const gamma = Math.atan2(cy, cx);
  const dist = i.target.distanceTo(i.hip);
  const d = clamp(dist, Math.abs(L1 - Lt) + 1e-5, (L1 + Lt) * i.maxReach);
  retargetFrame(F0, i.hip, i.target, i.pole, F1);
  const alpha = Math.acos(clamp((L1 * L1 + d * d - Lt * Lt) / (2 * L1 * d), -1, 1));
  const thF = alpha - gamma;
  const thT = Math.atan2(-L1 * Math.sin(alpha), d - L1 * Math.cos(alpha)); // from the virtual knee to the target
  const thM = thF + delta;
  frameRotation(F0, F1, _R);
  _qF.setFromAxisAngle(F1.m, thF - thF0).multiply(_R);
  _qT.setFromAxisAngle(F1.m, thT - thT0).multiply(_R);
  _qM.setFromAxisAngle(F1.m, thM - thM0).multiply(_R);
  o.knee.copy(_f).applyQuaternion(_qF).add(i.hip);
  o.hock.copy(_t).applyQuaternion(_qT).add(o.knee);
  o.paw.copy(_m).applyQuaternion(_qM).add(o.hock);
  o.femur.copy(_qF).multiply(i.femur);
  o.tibia.copy(_qT).multiply(i.tibia);
  o.meta.copy(_qM).multiply(i.meta);
  o.reached = Math.abs(d - dist) < 1e-6;
  o.shortfall = dist - d;
  o.stretch = dist / ((L1 + Lt) * i.maxReach);
  return o;
}
