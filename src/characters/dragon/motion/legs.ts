import * as THREE from 'three';
import { createPantographResult, createTwoBoneResult, solvePantograph, solveTwoBone } from './ik';
import { LEG_KEYS, isFrontLeg, type LimbKey, type MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, clampTwist, deg, twistAngle } from './math';

type LegTuning = MotionTuning['legs'];

const AX = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

export interface LegLimit {
  readonly bone: number;
  readonly name: string;
  /** Allowed rotation about the bone's local X relative to bind (rad). */
  readonly lo: number;
  readonly hi: number;
}

export interface LegInfo {
  readonly key: LimbKey;
  readonly front: boolean;
  /** front: scapula, humerus, radius, metacarpal, toes · hind: femur, tibia, metatarsal, toes */
  readonly bones: number[];
  readonly limits: LegLimit[];
  /** Sole point in the toes bone's local frame. */
  readonly soleLocal: THREE.Vector3;
  /** Paw joint (toes head) minus sole at bind, character frame. */
  readonly pawOffset: THREE.Vector3;
  readonly pole: THREE.Vector3;
  /** Max distance from the root joint (shoulder / hip) to the sole. */
  readonly reach: number;
  /** Allowed interior angle of the front elbow (rad); unused for hind legs. */
  readonly interior: [number, number];
  /** +1 when a positive rotation about the scapula's local X swings the shoulder forward. */
  readonly scapulaSign: number;
}

export interface LegTargets {
  readonly sole: readonly THREE.Vector3[];
  readonly normal: readonly THREE.Vector3[];
  readonly planted: readonly boolean[];
  /** Swing progress (1 when planted). */
  readonly s: readonly number[];
}

const _q = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _qmc = new THREE.Quaternion();
const _rel = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();
const _target = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Bone direction (local +Y) in world for a world rotation. */
function dirOf(q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(UP).applyQuaternion(q);
}

/**
 * +1 when rotating `child` positively about its own local X closes the joint between `parent` and `child`
 * (reduces the interior angle, i.e. flexes it), else −1. Measured on the bind pose.
 */
function flexSign(s: RigSkeleton, parent: number, child: number): number {
  const p = dirOf(s.bindWorldQuat[parent], _a).negate();
  const interior0 = p.angleTo(dirOf(s.bindWorldQuat[child], _b));
  _q.copy(s.bindWorldQuat[child]).multiply(_qx.setFromAxisAngle(AX, 0.01));
  return p.angleTo(dirOf(_q, _c)) < interior0 ? 1 : -1;
}

/** Flexion range [min, max] (rad) of `child` from its raw limits and flex sign. */
function flexRange(lim: LegLimit, sign: number): [number, number] {
  return sign > 0 ? [lim.lo, lim.hi] : [-lim.hi, -lim.lo];
}

/**
 * Rig sanity (spec §6.7 relies on it): every limb bone's bind pose lies inside its limits, and each leg's main hinge
 * (front radius, hind tibia) allows ≥ 60° of flexion and ≥ 20° of extension. Returns human-readable problems.
 */
export function checkLegLimits(rig: MotionRig, s: RigSkeleton): string[] {
  const problems: string[] = [];
  for (const key of LEG_KEYS) {
    const limb = rig.limbs[key];
    for (const name of limb.bones) {
      const l = limb.limitsDeg[name];
      if (!l) problems.push(`${name}: no limitsDeg`);
      else if (l[0] > 0 || l[1] < 0) problems.push(`${name}: bind (0°) outside [${l[0]}, ${l[1]}]`);
    }
    const hingeParent = s.id(limb.bones[isFrontLeg(key) ? 1 : 0]);
    const hingeName = limb.bones[isFrontLeg(key) ? 2 : 1];
    const hinge = s.id(hingeName);
    const l = limb.limitsDeg[hingeName] ?? [0, 0];
    const [fMin, fMax] = flexRange({ bone: hinge, name: hingeName, lo: deg(l[0]), hi: deg(l[1]) }, flexSign(s, hingeParent, hinge));
    if (fMax < deg(60)) problems.push(`${hingeName}: only ${Math.round((fMax * 180) / Math.PI)}° of flexion (limits [${l[0]}, ${l[1]}] about xAxis; + flexes = ${flexSign(s, hingeParent, hinge) > 0})`);
    if (-fMin < deg(20)) problems.push(`${hingeName}: only ${Math.round((-fMin * 180) / Math.PI)}° of extension (limits [${l[0]}, ${l[1]}])`);
  }
  return problems;
}

/**
 * Per-leg IK on the rig (spec §6.7).
 * - Hind legs: the pantograph solve (femur, tibia, metatarsal) reaches the paw joint; the toes lie flat on the
 *   surface and curl in swing.
 * - Front legs:
 *   - the shoulder blade rotates with the leg's reach;
 *   - the metacarpal aligns to the surface (curling back in swing);
 *   - a two-bone humerus/radius solve reaches the resulting wrist, with the elbow limited by its flexion range.
 * - Every leg bone is clamped to its limits about its local X.
 */
export class LegRig {
  readonly legs: LegInfo[];
  readonly shortfall = [0, 0, 0, 0];
  /** Per-leg IK reach ratio from the last solve (≥ 1: out of reach). */
  readonly stretch = [0, 0, 0, 0];
  /**
   * Per-leg smallest distance (rad) of the unclamped IK solution to a joint limit (scapula excepted — it is clamped
   * on purpose); negative when the solver wanted to go past a limit, i.e. the paw was not held where it should be.
   */
  readonly margin = [0, 0, 0, 0];
  private curMargin = Infinity;
  readonly envelope = { forward: [0, 0, 0, 0], backward: [0, 0, 0, 0] };
  private readonly two = createTwoBoneResult();
  private readonly pan = createPantographResult();

  constructor(rig: MotionRig, skeleton: RigSkeleton, private readonly t: LegTuning) {
    this.legs = LEG_KEYS.map((key) => {
      const limb = rig.limbs[key];
      const bones = limb.bones.map((n) => skeleton.id(n));
      const limits: LegLimit[] = limb.bones.map((n, k) => {
        const l = limb.limitsDeg[n] ?? [-180, 180];
        return { bone: bones[k], name: n, lo: deg(l[0]), hi: deg(l[1]) };
      });
      const front = isFrontLeg(key);
      const contact = rig.contacts[key];
      const toes = skeleton.id(contact.bone);
      const sole = new THREE.Vector3(...contact.sole);
      const soleLocal = skeleton.bindToLocal(toes, sole, new THREE.Vector3());
      const pawOffset = skeleton.bindWorldPos[toes].clone().sub(sole);
      let chain = 0;
      for (let k = front ? 1 : 0; k < bones.length - 1; k++) chain += skeleton.length[bones[k]];
      const reach = chain + pawOffset.length();
      let interior: [number, number] = [0, Math.PI];
      let scapulaSign = 1;
      if (front) {
        const [, hum, rad] = bones;
        const theta0 = dirOf(skeleton.bindWorldQuat[hum], _a).negate().angleTo(dirOf(skeleton.bindWorldQuat[rad], _b));
        const [fMin, fMax] = flexRange(limits[2], flexSign(skeleton, hum, rad));
        interior = [clamp(theta0 - fMax, 0.05, Math.PI - 1e-3), clamp(theta0 - fMin, 0.05, Math.PI - 1e-3)];
        const sc = bones[0];
        _q.copy(skeleton.bindWorldQuat[sc]).multiply(_qx.setFromAxisAngle(AX, 0.01));
        const moved = _a.set(0, skeleton.length[sc], 0).applyQuaternion(_q).z - _b.set(0, skeleton.length[sc], 0).applyQuaternion(skeleton.bindWorldQuat[sc]).z;
        scapulaSign = moved > 0 ? 1 : -1;
      }
      return { key, front, bones, limits, soleLocal, pawOffset, pole: new THREE.Vector3(...limb.pole), reach, interior, scapulaSign };
    });
    this.measureEnvelope(rig, skeleton);
  }

  /**
   * Binary-search, per leg, how far forward/backward (body +Z) its sole can go from neutral at bind height and still be
   * reached within 1 mm (limits included). Leaves the skeleton at bind.
   */
  private measureEnvelope(rig: MotionRig, s: RigSkeleton): void {
    const soles = LEG_KEYS.map((k) => new THREE.Vector3(...rig.contacts[k].sole));
    const tg = { sole: soles.map((p) => p.clone()), normal: soles.map(() => UP.clone()), planted: [true, true, true, true], s: [1, 1, 1, 1] };
    const ident = new THREE.Quaternion();
    const got = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      for (const dir of [1, -1]) {
        let lo = 0;
        let hi = 1.5;
        for (let it = 0; it < 14; it++) {
          const mid = (lo + hi) / 2;
          s.resetToBind();
          s.fk();
          tg.sole[i].copy(soles[i]).setZ(soles[i].z + dir * mid);
          tg.sole[i].y += this.t.envelopeDrop; // body lowered by the working crouch = paws raised relative to it
          this.solve(s, tg, ident);
          s.fk();
          if (this.soleWorld(i, s, got).distanceTo(tg.sole[i]) < 1e-3 && this.stretch[i] < 1 && this.margin[i] > 0) lo = mid;
          else hi = mid;
        }
        tg.sole[i].copy(soles[i]);
        (dir > 0 ? this.envelope.forward : this.envelope.backward)[i] = lo;
      }
    }
    s.resetToBind();
    s.fk();
    this.shortfall.fill(0);
    this.stretch.fill(0);
    this.margin.fill(0);
  }

  /** World root joint of leg i (front: shoulder = humerus head; hind: hip = femur head). */
  hip(i: number, s: RigSkeleton, out: THREE.Vector3): THREE.Vector3 {
    const L = this.legs[i];
    return out.copy(s.worldPos[L.front ? L.bones[1] : L.bones[0]]);
  }

  soleWorld(i: number, s: RigSkeleton, out: THREE.Vector3): THREE.Vector3 {
    const L = this.legs[i];
    return s.toWorld(L.bones[L.bones.length - 1], L.soleLocal, out);
  }

  /** Solve all four legs against the current FK. Returns each leg's shortfall (m; > 0 = could not reach). */
  solve(s: RigSkeleton, tg: LegTargets, bodyQuat: THREE.Quaternion): readonly number[] {
    for (let i = 0; i < 4; i++) {
      this.curMargin = Infinity;
      this.shortfall[i] = this.legs[i].front ? this.solveFront(i, s, tg, bodyQuat) : this.solveHind(i, s, tg, bodyQuat);
      this.stretch[i] = this.legs[i].front ? this.two.stretch : this.pan.stretch;
      this.margin[i] = this.curMargin;
    }
    return this.shortfall;
  }

  jointReport(s: RigSkeleton): Array<{ name: string; angle: number; lo: number; hi: number }> {
    const out: Array<{ name: string; angle: number; lo: number; hi: number }> = [];
    for (const L of this.legs) {
      for (const lim of L.limits) {
        _rel.copy(s.bindLocalQuat[lim.bone]).invert().multiply(s.localQuat[lim.bone]);
        out.push({ name: lim.name, angle: twistAngle(_rel, AX), lo: lim.lo, hi: lim.hi });
      }
    }
    return out;
  }

  private solveHind(i: number, s: RigSkeleton, tg: LegTargets, bodyQuat: THREE.Quaternion): number {
    const L = this.legs[i];
    const [femur, tibia, meta, toes] = L.bones;
    this.footFrame(tg.normal[i], bodyQuat, _qf);
    _target.copy(L.pawOffset).applyQuaternion(_qf).add(tg.sole[i]);
    _pole.copy(L.pole).applyQuaternion(bodyQuat);
    const r = solvePantograph({
      hip: s.worldPos[femur], knee: s.worldPos[tibia], hock: s.worldPos[meta], paw: s.worldPos[toes],
      femur: s.worldQuat[femur], tibia: s.worldQuat[tibia], meta: s.worldQuat[meta],
      target: _target, pole: _pole, maxReach: this.t.maxReach,
    }, this.pan);
    s.setWorldQuat(femur, r.femur);
    s.setWorldQuat(tibia, r.tibia);
    s.setWorldQuat(meta, r.meta);
    this.clampLimits(s, L, 0, 3);
    this.placeToes(s, L, i, tg);
    return r.shortfall;
  }

  private solveFront(i: number, s: RigSkeleton, tg: LegTargets, bodyQuat: THREE.Quaternion): number {
    const L = this.legs[i];
    const [scap, hum, rad, mc] = L.bones;
    this.footFrame(tg.normal[i], bodyQuat, _qf);
    _target.copy(L.pawOffset).applyQuaternion(_qf).add(tg.sole[i]);
    // 1) the shoulder blade follows the reach: signed swing of (scapula → paw) about the body's lateral axis
    _lat.set(1, 0, 0).applyQuaternion(bodyQuat);
    const toes = L.bones[4];
    _a.subVectors(s.worldPos[toes], s.worldPos[scap]);
    _a.addScaledVector(_lat, -_a.dot(_lat));
    _b.subVectors(_target, s.worldPos[scap]);
    _b.addScaledVector(_lat, -_b.dot(_lat));
    const swing = -Math.atan2(_c.crossVectors(_a, _b).dot(_lat), _a.dot(_b)); // > 0: the target is ahead
    const scapAngle = clamp(L.scapulaSign * this.t.scapulaFollow * swing, L.limits[0].lo, L.limits[0].hi);
    s.localQuat[scap].multiply(_qx.setFromAxisAngle(AX, scapAngle));
    s.fk();
    // 2) metacarpal flat on the surface (curling back in swing) → wrist target
    const curl = tg.planted[i] ? 0 : -deg(this.t.swingCurlDeg) * Math.sin(Math.PI * tg.s[i]);
    _qmc.copy(_qf).multiply(s.bindWorldQuat[mc]).multiply(_qx.setFromAxisAngle(AX, curl));
    _wrist.set(0, s.length[mc], 0).applyQuaternion(_qmc).negate().add(_target);
    // 3) humerus + radius reach the wrist
    _pole.copy(L.pole).applyQuaternion(bodyQuat);
    const r = solveTwoBone({
      root: s.worldPos[hum], mid: s.worldPos[rad], end: s.worldPos[mc], upper: s.worldQuat[hum], lower: s.worldQuat[rad],
      target: _wrist, pole: _pole, minInterior: L.interior[0], maxInterior: L.interior[1],
    }, this.two);
    s.setWorldQuat(hum, r.upper);
    s.setWorldQuat(rad, r.lower);
    this.clampLimits(s, L, 1, 3);
    s.setWorldQuat(mc, _qmc);
    this.clampLimits(s, L, 3, 4);
    this.placeToes(s, L, i, tg);
    return r.shortfall;
  }

  /** Toes flat on the surface frame, curled during swing. */
  private placeToes(s: RigSkeleton, L: LegInfo, i: number, tg: LegTargets): void {
    const toes = L.bones[L.bones.length - 1];
    const curl = tg.planted[i] ? 0 : -deg(this.t.swingCurlDeg) * Math.sin(Math.PI * tg.s[i]);
    _q.copy(_qf).multiply(s.bindWorldQuat[toes]).multiply(_qx.setFromAxisAngle(AX, curl));
    s.setWorldQuat(toes, _q);
    this.clampLimits(s, L, L.bones.length - 1, L.bones.length);
  }

  /**
   * Clamp bones [from, to) of the leg about their local X; refresh their world rotations down the chain. Records the
   * smallest distance to a limit of the unclamped solution (negative = the IK wanted to go past it).
   */
  private clampLimits(s: RigSkeleton, L: LegInfo, from: number, to: number): void {
    for (let k = from; k < to; k++) {
      const lim = L.limits[k];
      const b = lim.bone;
      _rel.copy(s.bindLocalQuat[b]).invert().multiply(s.localQuat[b]);
      const a = twistAngle(_rel, AX);
      this.curMargin = Math.min(this.curMargin, a - lim.lo, lim.hi - a);
      if (clampTwist(_rel, AX, lim.lo, lim.hi) !== 0) s.localQuat[b].copy(s.bindLocalQuat[b]).multiply(_rel);
      s.worldQuat[b].multiplyQuaternions(s.worldQuat[s.parent[b]], s.localQuat[b]);
    }
  }

  /** Bind character frame → the paw's surface frame (up = surface normal, forward = body forward on the surface). */
  private footFrame(n: THREE.Vector3, bodyQuat: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
    _fy.copy(n).normalize();
    _fz.set(0, 0, 1).applyQuaternion(bodyQuat);
    _fz.addScaledVector(_fy, -_fz.dot(_fy));
    if (_fz.lengthSq() < 1e-8) _fz.set(0, 0, 1).addScaledVector(_fy, -_fy.z);
    _fz.normalize();
    _fx.crossVectors(_fy, _fz);
    return out.setFromRotationMatrix(_m.makeBasis(_fx, _fy, _fz));
  }
}
