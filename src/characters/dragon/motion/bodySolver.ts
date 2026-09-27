import * as THREE from 'three';
import type { GaitEngine } from './gait';
import { LEG_KEYS, type MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, deg, rotY, TAU } from './math';
import { stepSpring, type SpringState } from './springs';

type BodyTuning = MotionTuning['body'];

/** Ground height under each paw (LEG_KEYS order) and this step's touchdowns — the FootPlanner provides both. */
export interface SupportSource {
  support(i: number): number;
  readonly paws: ReadonlyArray<{ justPlanted: boolean }>;
}

export interface BodyKinState {
  readonly pos: THREE.Vector3;
  readonly heading: number;
  readonly yawRate: number;
  readonly speed: number;
  readonly accel: number;
}

export interface BodyPose {
  /** World position of the pelvis head (the root bone). */
  readonly pelvisPos: THREE.Vector3;
  /** Bind character frame → body: yaw · pitch · roll. */
  readonly bodyQuat: THREE.Quaternion;
  pitch: number;
  roll: number;
  height: number;
  /** Per spine bone after the pelvis (spine_01 … chest). */
  readonly spinePitch: number[];
  readonly spineYaw: number[];
}

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qy = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qr = new THREE.Quaternion();

/**
 * Pelvis height/pitch/roll and spine bend (spec §6.5). Hips ride above the hind supports and shoulders above the front
 * supports at bind heights, through critically damped springs, so the body pitches on slopes, rolls on side slopes and
 * rises over steps. Dynamics on top: footfall dips, the gait bob (two dips per walk/trot cycle), the gallop rock and
 * gather/extend, lean into turns (centripetal acceleration), and pitch with acceleration. When a leg cannot reach its
 * target, the body lowers by the shortfall.
 */
export class BodySolver {
  readonly pose: BodyPose;
  /** Pelvis-head height above the hind soles at bind. */
  readonly hipHeight: number;
  /** Scripted actions drive the height/pitch targets directly (roll levels out). */
  readonly override = { active: false, height: 0, pitch: 0 };
  private readonly height: SpringState = { x: 0, v: 0 };
  private readonly pitch: SpringState = { x: 0, v: 0 };
  private readonly roll: SpringState = { x: 0, v: 0 };
  private readonly bend: SpringState = { x: 0, v: 0 };
  private readonly pelvis: number;
  private readonly spine: number[];
  private readonly pelvisOffset: THREE.Vector3;
  private readonly feetLength: number;
  private readonly feetWidth: number;
  private readonly spinePitchLimit: number;
  private readonly spineYawLimit: number;

  constructor(rig: MotionRig, skeleton: RigSkeleton, private readonly t: BodyTuning) {
    this.pelvis = skeleton.id(rig.chains.spine[0]);
    this.spine = rig.chains.spine.slice(1).map((n) => skeleton.id(n));
    const head = skeleton.bindWorldPos[this.pelvis];
    const soles = LEG_KEYS.map((k) => new THREE.Vector3(...rig.contacts[k].sole)); // LH, LF, RH, RF
    this.hipHeight = head.y - (soles[0].y + soles[2].y) / 2;
    this.pelvisOffset = new THREE.Vector3(head.x, 0, head.z);
    this.feetLength = (soles[1].z + soles[3].z) / 2 - (soles[0].z + soles[2].z) / 2;
    this.feetWidth = (soles[0].x + soles[1].x) / 2 - (soles[2].x + soles[3].x) / 2;
    this.spinePitchLimit = deg(rig.chainLimitsDeg.spine.pitch);
    this.spineYawLimit = deg(rig.chainLimitsDeg.spine.yaw);
    this.pose = {
      pelvisPos: new THREE.Vector3(), bodyQuat: new THREE.Quaternion(), pitch: 0, roll: 0, height: 0,
      spinePitch: this.spine.map(() => 0), spineYaw: this.spine.map(() => 0),
    };
  }

  reset(pos: THREE.Vector3, heading: number, groundY: number): void {
    this.height.x = groundY + this.hipHeight;
    this.height.v = 0;
    this.pitch.x = this.pitch.v = 0;
    this.roll.x = this.roll.v = 0;
    this.bend.x = this.bend.v = 0;
    this.pose.spinePitch.fill(0);
    this.pose.spineYaw.fill(0);
    this.compose(pos, heading);
  }

  /**
   * `groundFront` / `groundHind`: terrain height under the shoulders / hips (−Infinity when unknown). The body rides on
   * the higher of those and the paw supports, so it never sinks into rising ground before the paws step up.
   */
  update(
    kin: BodyKinState, sup: SupportSource, gait: GaitEngine, shortfall: readonly number[], maxTiltDeg: number, dt: number,
    groundFront = -Infinity, groundHind = -Infinity,
  ): BodyPose {
    const t = this.t;
    const hH = Math.max((sup.support(0) + sup.support(2)) / 2, groundHind);
    const hF = Math.max((sup.support(1) + sup.support(3)) / 2, groundFront);
    const hL = (sup.support(0) + sup.support(1)) / 2;
    const hR = (sup.support(2) + sup.support(3)) / 2;
    const lowerHind = Math.max(shortfall[0], shortfall[2], 0) * t.shortfallLower;
    const lowerFront = Math.max(shortfall[1], shortfall[3], 0) * t.shortfallLower;
    const w = gait.weights;
    const moving = clamp(kin.speed / t.crouchFullSpeed, 0, 1);
    const crouch = (w[0] * t.crouchWalk + w[1] * t.crouchTrot + w[2] * t.crouchGallop) * moving;
    const ph = gait.phase;
    const bob = -(w[0] * t.bobWalk + w[1] * t.bobTrot) * moving * 0.5 * (1 - Math.cos(2 * TAU * ph));
    const maxTilt = deg(maxTiltDeg);

    let pitchT = Math.atan2(hF - lowerFront - (hH - lowerHind), this.feetLength);
    pitchT += clamp(deg(t.accelPitchDeg) * kin.accel, -deg(t.maxAccelPitchDeg), deg(t.maxAccelPitchDeg));
    pitchT += deg(t.rockGallopDeg) * w[2] * Math.sin(TAU * ph);
    let rollT = Math.atan2(hL - hR, this.feetWidth);
    rollT -= clamp(Math.atan((kin.speed * kin.yawRate) / 9.81) * t.leanGain, -deg(t.maxLeanDeg), deg(t.maxLeanDeg));
    pitchT = clamp(pitchT, -maxTilt, maxTilt);
    rollT = clamp(rollT, -maxTilt, maxTilt);
    let heightT = hH + this.hipHeight - crouch - lowerHind + bob;
    if (this.override.active) {
      heightT = this.override.height;
      pitchT = this.override.pitch;
      rollT = 0;
    }

    for (const p of sup.paws) {
      if (p.justPlanted) this.height.v -= t.footfallImpulse * clamp(kin.speed / t.footfallFullSpeed, t.footfallMinScale, 1);
    }
    stepSpring(this.height, heightT, t.heightOmega, 1, dt);
    stepSpring(this.pitch, pitchT, t.tiltOmega, 1, dt);
    stepSpring(this.roll, rollT, t.tiltOmega, 1, dt);

    stepSpring(this.bend, clamp(t.bendGain * kin.yawRate, -deg(t.maxBendDeg), deg(t.maxBendDeg)), t.tiltOmega, 1, dt);
    const bend = this.bend.x;
    const flex = deg(t.flexGallopDeg) * w[2] * Math.sin(TAU * ph + Math.PI / 2);
    for (let k = 0; k < this.spine.length; k++) {
      this.pose.spineYaw[k] = clamp(bend * (t.bendShare[k] ?? 1 / this.spine.length), -this.spineYawLimit, this.spineYawLimit);
      this.pose.spinePitch[k] = clamp(flex / this.spine.length, -this.spinePitchLimit, this.spinePitchLimit);
    }
    this.compose(kin.pos, kin.heading);
    return this.pose;
  }

  /** Landing absorb: push the height spring down by dv (m/s). */
  impulse(dv: number): void {
    this.height.v -= dv;
  }

  /** Write the pelvis transform and the spine bends as absolute locals (call right after skeleton.resetToBind()). */
  apply(skeleton: RigSkeleton): void {
    const p = this.pose;
    skeleton.localPos[this.pelvis].copy(p.pelvisPos);
    skeleton.localQuat[this.pelvis].copy(p.bodyQuat).multiply(skeleton.bindWorldQuat[this.pelvis]);
    for (let k = 0; k < this.spine.length; k++) {
      skeleton.localQuat[this.spine[k]]
        .multiply(_qp.setFromAxisAngle(AX, p.spinePitch[k]))
        .multiply(_qr.setFromAxisAngle(AZ, p.spineYaw[k]));
    }
  }

  private compose(pos: THREE.Vector3, heading: number): void {
    const p = this.pose;
    p.height = this.height.x;
    p.pitch = this.pitch.x;
    p.roll = this.roll.x;
    _qy.setFromAxisAngle(AY, heading);
    _qp.setFromAxisAngle(AX, -p.pitch); // rotating −pitch about +X lifts +Z (the nose)
    _qr.setFromAxisAngle(AZ, p.roll); // rotating +roll about +Z lifts +X (the left side)
    p.bodyQuat.copy(_qy).multiply(_qp).multiply(_qr);
    rotY(this.pelvisOffset, heading, p.pelvisPos).add(pos);
    p.pelvisPos.y = p.height;
  }
}
