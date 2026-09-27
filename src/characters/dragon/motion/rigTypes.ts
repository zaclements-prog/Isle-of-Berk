export type Vec3 = [number, number, number];
export type LimbKey = 'front_L' | 'front_R' | 'hind_L' | 'hind_R';

/** Leg order used everywhere in motion code — the spec §6.3 gait-offset order (LH, LF, RH, RF). */
export const LEG_KEYS: readonly LimbKey[] = ['hind_L', 'front_L', 'hind_R', 'front_R'];

export function isFrontLeg(key: LimbKey): boolean {
  return key === 'front_L' || key === 'front_R';
}

/**
 * The anatomy the motion system reads (spec §5.10) — a structural subset of Plan 2's RigMeta, glTF/three space
 * (+Y up, dragon faces +Z, its left is +X). limitsDeg = [lo, hi] rotation about the bone's xAxis (right-hand rule)
 * relative to bind, degrees.
 */
export interface MotionRig {
  bones: ReadonlyArray<{ name: string; parent: string | null; head: Vec3; tail: Vec3; xAxis: Vec3 }>;
  chains: { spine: string[]; neck: string[]; tail: string[] };
  limbs: Record<LimbKey, { bones: string[]; pole: Vec3; limitsDeg: Record<string, [number, number]> }>;
  contacts: Record<LimbKey, { bone: string; sole: Vec3; toe: Vec3; heel: Vec3 }>;
  proxies: ReadonlyArray<{ name: string; bone: string; center: Vec3; radius: number }>;
  anchors: Record<string, { bone: string; position: Vec3 }>;
  chainLimitsDeg: Record<'spine' | 'neck' | 'tail', { pitch: number; yaw: number; roll: number }>;
  wings: Record<'L' | 'R', { humerus: string; forearm: string; thumb: string; ribs: [string, string][]; hipRibs: string[]; finRibs: string[] }>;
  ears: Record<'L' | 'R', string[]>;
  proportions: { length: number; wingspan: number; shoulderHeight: number; hipHeight: number; headTop: number };
}
