import * as THREE from 'three';
import type { MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, deg } from './math';
import { stepAngleSpring, stepSpring, type SpringState } from './springs';

type LookTuning = MotionTuning['look'];

export interface LookInput {
  readonly moving: boolean;
  readonly heading: number;
  readonly yawRate: number;
  readonly bodyQuat: THREE.Quaternion;
  readonly headPos: THREE.Vector3;
  readonly cameraPos: THREE.Vector3;
  /** Height gained per metre along the travel direction (climbing: the face's rise), so he looks up what he climbs. */
  readonly rise?: number;
}

const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/**
 * Head/neck look-at (spec §6.8, the M5 subset). Target priority: an explicit point (M6: interest points, plasma aim) >
 * travel direction (leading into turns) > idle glances > the camera. Eyes lead with a fast spring and the head
 * follows with a slow one. The turn is spread down neck_01…head with per-bone chain limits. Targets are world
 * points, so body bob is cancelled (gaze stabilisation).
 */
export class LookController {
  mode: 'point' | 'travel' | 'glance' | 'camera' = 'travel';
  readonly target = new THREE.Vector3();
  readonly override = { active: false, point: new THREE.Vector3() };
  readonly headYaw: SpringState = { x: 0, v: 0 };
  readonly headPitch: SpringState = { x: 0, v: 0 };
  readonly eyeYaw: SpringState = { x: 0, v: 0 };
  readonly eyePitch: SpringState = { x: 0, v: 0 };
  private idle = 0;
  private nextGlance: number;
  private glanceLeft = 0;
  private glanceYaw = 0;
  private glancePitch = 0;
  private readonly chain: number[];
  private readonly yawLimit: number;
  private readonly pitchLimit: number;
  private readonly headBindPitch: number;

  constructor(rig: MotionRig, skeleton: RigSkeleton, private readonly t: LookTuning, private readonly rng: () => number) {
    this.chain = rig.chains.neck.map((n) => skeleton.id(n));
    this.yawLimit = deg(rig.chainLimitsDeg.neck.yaw);
    this.pitchLimit = deg(rig.chainLimitsDeg.neck.pitch);
    const head = this.chain[this.chain.length - 1];
    const f = new THREE.Vector3(0, 1, 0).applyQuaternion(skeleton.bindWorldQuat[head]);
    this.headBindPitch = Math.atan2(f.y, Math.hypot(f.x, f.z));
    this.nextGlance = t.glanceMin + rng() * (t.glanceMax - t.glanceMin);
  }

  update(inp: LookInput, dt: number): void {
    const t = this.t;
    if (this.override.active) {
      this.mode = 'point';
      this.idle = 0;
      this.target.copy(this.override.point);
    } else if (inp.moving) {
      this.mode = 'travel';
      this.idle = 0;
      const a = inp.heading + t.leadGain * inp.yawRate;
      this.target.set(Math.sin(a), inp.rise ?? 0, Math.cos(a)).multiplyScalar(t.aheadDist).add(inp.headPos);
    } else {
      this.idle += dt;
      if (this.glanceLeft > 0) {
        this.glanceLeft -= dt;
        this.mode = 'glance';
        _d.set(Math.sin(this.glanceYaw) * Math.cos(this.glancePitch), Math.sin(this.glancePitch), Math.cos(this.glanceYaw) * Math.cos(this.glancePitch));
        this.target.copy(_d.applyQuaternion(inp.bodyQuat).multiplyScalar(t.glanceDist)).add(inp.headPos);
      } else {
        this.nextGlance -= dt;
        if (this.nextGlance <= 0) {
          this.glanceLeft = t.glanceHold;
          this.glanceYaw = deg(-t.glanceYawRangeDeg + 2 * t.glanceYawRangeDeg * this.rng());
          this.glancePitch = deg(-t.glancePitchRangeDeg + 2 * t.glancePitchRangeDeg * this.rng());
          this.nextGlance = t.glanceMin + this.rng() * (t.glanceMax - t.glanceMin);
        }
        if (this.idle > t.idleCameraDelay) {
          this.mode = 'camera';
          this.target.copy(inp.cameraPos);
        } else {
          this.mode = 'travel';
          this.target.set(Math.sin(inp.heading), 0, Math.cos(inp.heading)).multiplyScalar(t.aheadDist).add(inp.headPos);
        }
      }
    }
    _d.subVectors(this.target, inp.headPos).applyQuaternion(_qi.copy(inp.bodyQuat).invert());
    const yaw = clamp(Math.atan2(_d.x, _d.z), -deg(t.yawLimitDeg), deg(t.yawLimitDeg));
    const pitch = clamp(Math.atan2(_d.y, Math.hypot(_d.x, _d.z)) - this.headBindPitch, -deg(t.pitchLimitDeg), deg(t.pitchLimitDeg));
    stepAngleSpring(this.headYaw, yaw, t.headOmega, 1, dt);
    stepSpring(this.headPitch, pitch, t.headOmega, 1, dt);
    const eyeLim = deg(t.eyeLimitDeg);
    stepSpring(this.eyeYaw, clamp(yaw - this.headYaw.x, -eyeLim, eyeLim), t.eyeOmega, 1, dt);
    stepSpring(this.eyePitch, clamp(pitch - this.headPitch.x, -eyeLim, eyeLim), t.eyeOmega, 1, dt);
  }

  apply(s: RigSkeleton): void {
    for (let k = 0; k < this.chain.length; k++) {
      const w = this.t.weights[k] ?? 1 / this.chain.length;
      const yaw = clamp(this.headYaw.x * w, -this.yawLimit, this.yawLimit);
      const pitch = clamp(this.headPitch.x * w, -this.pitchLimit, this.pitchLimit);
      s.localQuat[this.chain[k]].multiply(_qa.setFromAxisAngle(AZ, yaw)).multiply(_qb.setFromAxisAngle(AX, pitch));
    }
  }
}
