import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite step from 0 at e0 to 1 at e1 (reversed when e1 < e0); with e1 = e0, a plain step there (no 0/0). */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

export function deg(d: number): number {
  return (d * Math.PI) / 180;
}

/** Wrap to (−π, π]. */
export function wrapAngle(a: number): number {
  const w = a - TAU * Math.floor((a + Math.PI) / TAU);
  return w <= -Math.PI ? w + TAU : w;
}

/** Shortest signed rotation from a to b, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Shortest signed difference of two phases in [0, 1): result in (−0.5, 0.5]. */
export function phaseDiff(a: number, b: number): number {
  return wrapAngle((b - a) * TAU) / TAU;
}

/** Fraction of the remaining gap an exponential smoother closes in dt, given its half-life (frame-rate independent). */
export function dampFactor(halfLife: number, dt: number): number {
  return 1 - Math.pow(2, -dt / Math.max(halfLife, 1e-6));
}

export function isFiniteVec3(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isFiniteQuat(q: THREE.Quaternion): boolean {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}

/** Rotate v about +Y by `angle` (heading convention: +Z → (sin, 0, cos)). */
export function rotY(v: THREE.Vector3, angle: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = v.x * c + v.z * s;
  const z = -v.x * s + v.z * c;
  return out.set(x, v.y, z);
}

/**
 * Signed twist of q about the unit `axis` (swing–twist decomposition), in (−π, π].
 * For q = (sin(θ/2)·a, cos(θ/2)) the projection of the vector part on the axis is sin(θ/2), so θ = 2·atan2(v·a, w).
 */
export function twistAngle(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const len = Math.hypot(d, q.w);
  if (len < 1e-12) return 0; // 180° swing: the twist is undefined, return 0
  return wrapAngle(2 * Math.atan2(d, q.w));
}

const _inv = new THREE.Quaternion();

/** Split q = swing · twist (twist about the unit `axis`). Returns the twist angle. `swing` and `twist` must not alias `q`. */
export function swingTwist(q: THREE.Quaternion, axis: THREE.Vector3, swing: THREE.Quaternion, twist: THREE.Quaternion): number {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  twist.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  const len = Math.hypot(twist.x, twist.y, twist.z, twist.w);
  if (len < 1e-12) twist.identity(); // 180° swing: the twist is undefined, take none
  else twist.set(twist.x / len, twist.y / len, twist.z / len, twist.w / len);
  swing.copy(q).multiply(_inv.copy(twist).invert());
  return twistAngle(twist, axis);
}

const _corr = new THREE.Quaternion();

/**
 * Clamp the twist of `rel` (a rotation relative to bind, in the bone's local frame) about the local `axis` to
 * [lo, hi] by post-multiplying a rotation about that axis (swing untouched). Returns the correction applied (rad).
 */
export function clampTwist(rel: THREE.Quaternion, axis: THREE.Vector3, lo: number, hi: number): number {
  const a = twistAngle(rel, axis);
  const c = clamp(a, lo, hi);
  if (c === a) return 0;
  rel.multiply(_corr.setFromAxisAngle(axis, c - a));
  return c - a;
}
