import type { LimbKey, MotionRig, Vec3 } from '../../src/characters/dragon/motion/rigTypes';

type V = [number, number, number];
const v = (x: number, y: number, z: number): V => [x, y, z];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
const mirror = (p: V): V => [-p[0], p[1], p[2]];
/** Blender (X = left, −Y = forward, Z = up) → glTF/three (x, z, −y). */
const G = (p: V): Vec3 => [p[0], p[2], -p[1]];
const rad = (d: number) => (d * Math.PI) / 180;
const pad = (n: number) => String(n).padStart(2, '0');

// ---- anatomy.py, Blender space ----
const HO = v(0, 0.04, -0.14);
const SPINE: Array<[string, V]> = [['pelvis', v(0, 0.62, 1.02)], ['spine_01', v(0, 0.3, 1.06)], ['spine_02', v(0, 0, 1.1)], ['spine_03', v(0, -0.3, 1.14)], ['chest', v(0, -0.58, 1.18)], ['', v(0, -0.86, 1.23)]];
const NECK: Array<[string, V]> = [['neck_01', v(0, -0.86, 1.23)], ['neck_02', v(0, -1.03, 1.3)], ['neck_03', v(0, -1.21, 1.39)], ['neck_04', v(0, -1.36, 1.46)], ['', v(0, -1.5, 1.5)]];
const HEAD: [V, V] = [v(0, -1.5, 1.5), v(0, -2.24, 1.45)];
const JAW: [V, V] = [v(0, -1.7, 1.345), v(0, -2.16, 1.3)];
const TAIL_PTS: V[] = [v(0, 0.88, 1.03), v(0, 1.2, 1.0), v(0, 1.54, 0.97), v(0, 1.9, 0.93), v(0, 2.28, 0.88), v(0, 2.66, 0.83), v(0, 3.03, 0.78), v(0, 3.38, 0.73), v(0, 3.72, 0.68), v(0, 4.04, 0.63), v(0, 4.34, 0.58), v(0, 4.63, 0.53), v(0, 4.92, 0.48)];
const FRONT = { scapula: v(0.2, -0.5, 1.28), shoulder: v(0.31, -0.74, 0.95), elbow: v(0.34, -0.6, 0.56), wrist: v(0.34, -0.74, 0.17), paw: v(0.34, -0.84, 0.07), toe: v(0.34, -1.0, 0.04) };
const HIND = { hip: v(0.29, 0.62, 0.97), knee: v(0.34, 0.36, 0.6), hock: v(0.33, 0.74, 0.3), paw: v(0.33, 0.6, 0.07), toe: v(0.33, 0.44, 0.04) };
/** name, root, length, pitch, yaw, roll (degrees; yaw/roll mirror with side) */
const EARS: Array<[string, V, number, number, number, number]> = [
  ['ear_1', add(v(0.125, -1.62, 1.87), HO), 0.34, 62, -14, -12],
  ['ear_2', add(v(0.25, -1.62, 1.77), HO), 0.2, 30, -40, -30],
  ['ear_3', add(v(0.315, -1.7, 1.61), HO), 0.13, 10, -68, -45],
];
const MAIN_WING = { root: v(0.26, -0.72, 1.42), elbow: v(1.05, -0.45, 1.55), hub: v(2.05, -0.62, 1.62), angles: [-6, 10, 26, 42, 58, 75, 94], lengths: [4.75, 4.2, 3.6, 3.05, 2.6, 2.2, 1.9] };
const HIP_WING = { hub: v(0.16, 1.45, 1.13), angles: [4, 30, 56, 82], lengths: [1.45, 1.3, 1.1, 0.85] };
const TAIL_FIN = { hub: v(0.04, 3.8, 0.69), angles: [48, 62, 76], lengths: [0.85, 1.05, 1.18] };
const SADDLE_SEAT = v(0, -0.36, 1.46);
const PEDAL_L = v(0.38, -0.28, 1.02);

/**
 * Joint limits this plan requires (right-hand rule about the exported xAxis; + flexes the radius, tibia and
 * metatarsal). The distal joints need wide ranges because the paws stay flat on the ground while the leg swings over
 * them (metacarpal/toes compensate the whole swing). Plan 2's anatomy.LIMBS must carry the same values — Task 9's
 * rig-sanity test checks the export.
 */
export const LIMB_LIMITS: Record<'front' | 'hind', Record<string, [number, number]>> = {
  front: { front_scapula: [-25, 25], front_humerus: [-70, 60], front_radius: [-35, 120], front_metacarpal: [-90, 90], front_toes: [-80, 80] },
  hind: { hind_femur: [-70, 75], hind_tibia: [-55, 70], hind_metatarsal: [-45, 110], hind_toes: [-80, 80] },
};

function fanTips(hub: V, angles: number[], lengths: number[], side: number, droop: boolean): V[] {
  return angles.map((a, i) => {
    const t = add(hub, v(Math.cos(rad(a)) * lengths[i], Math.sin(rad(a)) * lengths[i], droop ? -0.06 - 0.01 * i : 0));
    return side < 0 ? mirror(t) : t;
  });
}

/** anatomy.ear_axis: tail = root + Rz(yaw)·Ry(roll)·Rx(pitch)·(0, length, 0), yaw/roll mirrored by side. */
function earAxis(root: V, length: number, pitch: number, yaw: number, roll: number, side: number): [V, V] {
  const r = v(root[0] * side, root[1], root[2]);
  const rx = rad(pitch);
  const ry = rad(roll * side);
  const rz = rad(yaw * side);
  let p: V = v(0, length, 0);
  p = v(p[0], p[1] * Math.cos(rx) - p[2] * Math.sin(rx), p[1] * Math.sin(rx) + p[2] * Math.cos(rx));
  p = v(p[0] * Math.cos(ry) + p[2] * Math.sin(ry), p[1], -p[0] * Math.sin(ry) + p[2] * Math.cos(ry));
  p = v(p[0] * Math.cos(rz) - p[1] * Math.sin(rz), p[0] * Math.sin(rz) + p[1] * Math.cos(rz), p[2]);
  return [r, add(r, p)];
}

/** Blender align_roll: local Z as close as possible to world up (Blender −Y for near-vertical bones); X = Y × Z. */
function xAxisOf(head: V, tail: V): V {
  const d = unit(sub(tail, head));
  const up = Math.abs(d[2]) < 0.9 ? v(0, 0, 1) : v(0, -1, 0);
  const z = unit(sub(up, scale(d, dot(up, d))));
  return cross(d, z);
}

type Spec = [string, V, V, string | null];

function boneSpecs(): Spec[] {
  const b: Spec[] = [];
  for (let i = 0; i < SPINE.length - 1; i++) b.push([SPINE[i][0], SPINE[i][1], SPINE[i + 1][1], i > 0 ? SPINE[i - 1][0] : null]);
  for (let i = 0; i < NECK.length - 1; i++) b.push([NECK[i][0], NECK[i][1], NECK[i + 1][1], i === 0 ? 'chest' : NECK[i - 1][0]]);
  b.push(['head', HEAD[0], HEAD[1], 'neck_04'], ['jaw', JAW[0], JAW[1], 'head']);
  for (let i = 0; i < TAIL_PTS.length - 1; i++) b.push([`tail_${pad(i + 1)}`, TAIL_PTS[i], TAIL_PTS[i + 1], i === 0 ? 'pelvis' : `tail_${pad(i)}`]);
  for (const [side, s] of [[1, 'L'], [-1, 'R']] as const) {
    const m = (p: V): V => (side > 0 ? p : mirror(p));
    const f = { sc: m(FRONT.scapula), sh: m(FRONT.shoulder), el: m(FRONT.elbow), wr: m(FRONT.wrist), pw: m(FRONT.paw), to: m(FRONT.toe) };
    b.push(
      [`front_scapula_${s}`, f.sc, f.sh, 'chest'], [`front_humerus_${s}`, f.sh, f.el, `front_scapula_${s}`],
      [`front_radius_${s}`, f.el, f.wr, `front_humerus_${s}`], [`front_metacarpal_${s}`, f.wr, f.pw, `front_radius_${s}`],
      [`front_toes_${s}`, f.pw, f.to, `front_metacarpal_${s}`],
    );
    const h = { hip: m(HIND.hip), kn: m(HIND.knee), hk: m(HIND.hock), pw: m(HIND.paw), to: m(HIND.toe) };
    b.push(
      [`hind_femur_${s}`, h.hip, h.kn, 'pelvis'], [`hind_tibia_${s}`, h.kn, h.hk, `hind_femur_${s}`],
      [`hind_metatarsal_${s}`, h.hk, h.pw, `hind_tibia_${s}`], [`hind_toes_${s}`, h.pw, h.to, `hind_metatarsal_${s}`],
    );
    for (const [name, root, len, pitch, yaw, roll] of EARS) {
      const [head, tail] = earAxis(root, len, pitch, yaw, roll, side);
      b.push([`${name}_${s}`, head, tail, 'head']);
    }
    const root = m(MAIN_WING.root);
    const elbow = m(MAIN_WING.elbow);
    const hub = m(MAIN_WING.hub);
    b.push([`wing_humerus_${s}`, root, elbow, 'chest'], [`wing_forearm_${s}`, elbow, hub, `wing_humerus_${s}`],
      [`wing_thumb_${s}`, hub, add(hub, v(side * 0.05, -0.16, 0.02)), `wing_forearm_${s}`]);
    fanTips(MAIN_WING.hub, MAIN_WING.angles, MAIN_WING.lengths, side, true).forEach((tip, i) => {
      const mid = add(hub, scale(sub(tip, hub), 0.5));
      b.push([`wing_rib${i + 1}_a_${s}`, hub, mid, `wing_forearm_${s}`], [`wing_rib${i + 1}_b_${s}`, mid, tip, `wing_rib${i + 1}_a_${s}`]);
    });
    const hh = m(HIP_WING.hub);
    b.push([`hipwing_root_${s}`, sub(hh, v(side * 0.06, 0, 0)), hh, 'tail_02']);
    fanTips(HIP_WING.hub, HIP_WING.angles, HIP_WING.lengths, side, false).forEach((tip, i) => b.push([`hipwing_rib${i + 1}_${s}`, hh, tip, `hipwing_root_${s}`]));
    const th = m(TAIL_FIN.hub);
    b.push([`tailfin_root_${s}`, sub(th, v(side * 0.03, 0.05, 0)), th, 'tail_09']);
    fanTips(TAIL_FIN.hub, TAIL_FIN.angles, TAIL_FIN.lengths, side, false).forEach((tip, i) => b.push([`tailfin_rib${i + 1}_${s}`, th, tip, `tailfin_root_${s}`]));
  }
  b.push(['saddle', SADDLE_SEAT, add(SADDLE_SEAT, v(0, -0.25, 0.02)), 'spine_03'], ['pedal_L', PEDAL_L, add(PEDAL_L, v(0, -0.14, 0)), 'saddle']);
  return b;
}

export function toothlessFixtureRig(): MotionRig {
  const bones = boneSpecs().map(([name, head, tail, parent]) => ({ name, parent, head: G(head), tail: G(tail), xAxis: G(xAxisOf(head, tail)) }));
  const limb = (kind: 'front' | 'hind', side: 'L' | 'R') => ({
    bones: Object.keys(LIMB_LIMITS[kind]).map((n) => `${n}_${side}`),
    pole: kind === 'front' ? G(v(0, 1, 0)) : G(v(0, -1, 0)),
    limitsDeg: Object.fromEntries(Object.entries(LIMB_LIMITS[kind]).map(([n, l]) => [`${n}_${side}`, l])) as Record<string, [number, number]>,
  });
  const contact = (kind: 'front' | 'hind', side: 'L' | 'R') => {
    const k = side === 'L' ? (p: V) => G(p) : (p: V) => G(mirror(p));
    return kind === 'front'
      ? { bone: `front_toes_${side}`, sole: k(v(0.34, -0.86, 0)), toe: k(v(0.34, -1.05, 0)), heel: k(v(0.34, -0.68, 0.03)) }
      : { bone: `hind_toes_${side}`, sole: k(v(0.33, 0.58, 0)), toe: k(v(0.33, 0.38, 0)), heel: k(v(0.33, 0.76, 0.03)) };
  };
  const limbs = {} as MotionRig['limbs'];
  const contacts = {} as MotionRig['contacts'];
  for (const key of ['front_L', 'front_R', 'hind_L', 'hind_R'] as LimbKey[]) {
    const [kind, side] = key.split('_') as ['front' | 'hind', 'L' | 'R'];
    limbs[key] = limb(kind, side);
    contacts[key] = contact(kind, side);
  }
  const eye = add(v(0.2, -2.0, 1.735), HO);
  const proxy = (name: string, bone: string, c: V, radius: number) => ({ name, bone, center: G(c), radius });
  const wing = (s: 'L' | 'R') => ({
    humerus: `wing_humerus_${s}`, forearm: `wing_forearm_${s}`, thumb: `wing_thumb_${s}`,
    ribs: [1, 2, 3, 4, 5, 6, 7].map((i) => [`wing_rib${i}_a_${s}`, `wing_rib${i}_b_${s}`] as [string, string]),
    hipRibs: [1, 2, 3, 4].map((i) => `hipwing_rib${i}_${s}`),
    finRibs: [1, 2, 3].map((i) => `tailfin_rib${i}_${s}`),
  });
  return {
    bones,
    chains: {
      spine: ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'chest'],
      neck: ['neck_01', 'neck_02', 'neck_03', 'neck_04', 'head'],
      tail: Array.from({ length: 12 }, (_, i) => `tail_${pad(i + 1)}`),
    },
    limbs,
    contacts,
    proxies: [
      proxy('head', 'head', v(0, -1.72, 1.58), 0.33), proxy('muzzle', 'head', v(0, -2.02, 1.47), 0.2),
      proxy('neck', 'neck_02', v(0, -1.1, 1.33), 0.3), proxy('chest', 'chest', v(0, -0.62, 1.0), 0.44),
      proxy('belly', 'spine_02', v(0, 0, 1.04), 0.32), proxy('hips', 'pelvis', v(0, 0.6, 1.02), 0.36),
      proxy('tail_a', 'tail_03', v(0, 1.72, 0.95), 0.2), proxy('tail_b', 'tail_06', v(0, 2.85, 0.8), 0.13),
      proxy('tail_c', 'tail_09', v(0, 3.88, 0.66), 0.08), proxy('tail_d', 'tail_12', v(0, 4.8, 0.5), 0.045),
    ],
    anchors: {
      eye_L: { bone: 'head', position: G(eye) }, eye_R: { bone: 'head', position: G(mirror(eye)) },
      mouth: { bone: 'head', position: G(v(0, -2.2, 1.375)) },
      saddle: { bone: 'saddle', position: G(add(SADDLE_SEAT, v(0, 0, 0.06))) }, pedal_L: { bone: 'pedal_L', position: G(PEDAL_L) },
    },
    chainLimitsDeg: { spine: { pitch: 15, yaw: 12, roll: 8 }, neck: { pitch: 35, yaw: 40, roll: 15 }, tail: { pitch: 25, yaw: 30, roll: 10 } },
    wings: { L: wing('L'), R: wing('R') },
    ears: { L: ['ear_1_L', 'ear_2_L', 'ear_3_L'], R: ['ear_1_R', 'ear_2_R', 'ear_3_R'] },
    proportions: { length: 7.18, wingspan: 13.548, shoulderHeight: 1.28, hipHeight: 0.97, headTop: 1.815 },
  };
}
