/**
 * toothless.rig.json (Plan 2 Task 7): the anatomy the engine reads, in glTF/three space (+Y up, the dragon faces
 * +Z, its left is +X), metres. Plan 3's MotionRig (motion/rigTypes.ts) is a structural subset of RigMeta: keep
 * these field names and shapes so a RigMeta stays assignable to it.
 */
export type Vec3 = [number, number, number];
export type LimbKey = 'front_L' | 'front_R' | 'hind_L' | 'hind_R';
export interface RigBone { name: string; parent: string | null; head: Vec3; tail: Vec3; length: number; xAxis: Vec3 }
export interface RigLimb { bones: string[]; pole: Vec3; limitsDeg: Record<string, [number, number]> }
export interface RigContact { bone: string; sole: Vec3; toe: Vec3; heel: Vec3 }
export interface RigProxy { name: string; bone: string; center: Vec3; radius: number }
export interface RigAnchor { bone: string; position: Vec3 }
export interface RigWing { humerus: string; forearm: string; thumb: string; ribs: [string, string][]; hipRibs: string[]; finRibs: string[]; foldClips: string[] }
export interface RigMeta {
  version: 1;
  units: 'm';
  bones: RigBone[];
  chains: { spine: string[]; neck: string[]; tail: string[] };
  limbs: Record<LimbKey, RigLimb>;
  contacts: Record<LimbKey, RigContact>;
  proxies: RigProxy[];
  anchors: Record<string, RigAnchor>;
  jaw: { bone: string; openSign: 1 | -1; maxOpenRad: number };
  chainLimitsDeg: Record<'spine' | 'neck' | 'tail', { pitch: number; yaw: number; roll: number }>;
  wings: Record<'L' | 'R', RigWing>;
  ears: Record<'L' | 'R', string[]>;
  morphs: string[];
  clips: string[];
  proportions: { length: number; wingspan: number; shoulderHeight: number; hipHeight: number; headTop: number };
}

const LIMBS: LimbKey[] = ['front_L', 'front_R', 'hind_L', 'hind_R'];

/** Checks the version and that every bone reference resolves to a bone in `bones`; throws naming the first bad one. */
export function validateRig(raw: unknown): RigMeta {
  const r = raw as RigMeta;
  if (!r || r.version !== 1) throw new Error(`rig.json: unsupported version ${(r as { version?: unknown })?.version}`);
  const names = new Set(r.bones.map((b) => b.name));
  const need = (where: string, bone: string) => {
    if (!names.has(bone)) throw new Error(`rig.json: ${where} references missing bone '${bone}'`);
  };
  for (const [k, chain] of Object.entries(r.chains)) chain.forEach((b) => need(`chain ${k}`, b));
  for (const k of LIMBS) {
    if (!r.limbs[k]) throw new Error(`rig.json: missing limb ${k}`);
    r.limbs[k].bones.forEach((b) => need(`limb ${k}`, b));
    need(`contact ${k}`, r.contacts[k].bone);
  }
  r.proxies.forEach((p) => need(`proxy ${p.name}`, p.bone));
  for (const [k, a] of Object.entries(r.anchors)) need(`anchor ${k}`, a.bone);
  need('jaw', r.jaw.bone);
  for (const side of ['L', 'R'] as const) {
    const w = r.wings[side];
    [w.humerus, w.forearm, w.thumb, ...w.ribs.flat(), ...w.hipRibs, ...w.finRibs].forEach((b) => need(`wing ${side}`, b));
    r.ears[side].forEach((b) => need(`ear ${side}`, b));
  }
  return r;
}
