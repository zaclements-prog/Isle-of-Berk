import * as THREE from 'three';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import type { MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, deg, fract, lerp, TAU } from './math';
import { stepSpring, type SpringState } from './springs';

type SecondaryTuning = Pick<MotionTuning, 'tail' | 'ears' | 'fins' | 'breath'>;

export interface SecondaryInput {
  readonly yawRate: number;
  readonly speed: number;
  readonly verticalAccel: number;
  readonly gallopWeight: number;
  /** 0…1; defaults to speed / 10. */
  readonly exertion?: number;
}

const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

/**
 * Secondary motion (spec §6.9):
 * - Tail: 12 underdamped yaw/pitch springs, softer toward the tip. They are driven by the yaw rate and lateral
 *   acceleration (counterbalance) and by vertical acceleration (lag), with a gravity droop and a rise in the gallop.
 *   After posing, each segment whose end would dip below the ground lifts; the tail never penetrates.
 * - Ears: springs that lay back in the gallop, plus seeded random twitches.
 * - Hip wings and tail fins: a speed-driven flutter, plus seeded random twitches (spec §6.9).
 * - Breathing: a chest pitch at 12 → 40 breaths/min with exertion, recovering slowly; the neck base cancels it.
 */
export class SecondaryMotion {
  readonly tailYaw: SpringState[];
  readonly tailPitch: SpringState[];
  readonly ears: Array<{ bone: number; backSign: number; s: SpringState }>;
  readonly fins: Array<{ bone: number; phase: number; s: SpringState }>;
  exertion = 0;
  private breathPhase = 0;
  private time = 0;
  private nextEarTwitch: number;
  private nextFinTwitch: number;
  private readonly tail: number[];
  private readonly radius: number[];
  private readonly chest: number[];
  private readonly neckBase: number;
  private readonly tailYawLimit: number;
  private readonly tailPitchLimit: number;

  constructor(rig: MotionRig, s: RigSkeleton, private readonly world: CollisionWorld, private readonly t: SecondaryTuning, private readonly rng: () => number) {
    this.tail = rig.chains.tail.map((n) => s.id(n));
    this.tailYaw = this.tail.map(() => ({ x: 0, v: 0 }));
    this.tailPitch = this.tail.map(() => ({ x: 0, v: 0 }));
    this.tailYawLimit = deg(rig.chainLimitsDeg.tail.yaw);
    this.tailPitchLimit = deg(rig.chainLimitsDeg.tail.pitch);
    // tail radius per bone, interpolated between the rig's tail proxies (by position along the chain)
    const known = rig.proxies.filter((p) => rig.chains.tail.includes(p.bone)).map((p) => ({ k: rig.chains.tail.indexOf(p.bone), r: p.radius }))
      .sort((a, b) => a.k - b.k);
    this.radius = this.tail.map((_, k) => {
      if (!known.length) return t.tail.defaultRadius;
      if (k <= known[0].k) return known[0].r;
      for (let j = 0; j < known.length - 1; j++) {
        if (k <= known[j + 1].k) return lerp(known[j].r, known[j + 1].r, (k - known[j].k) / (known[j + 1].k - known[j].k));
      }
      return known[known.length - 1].r;
    });
    const earNames = [...rig.ears.L, ...rig.ears.R];
    this.ears = earNames.map((n) => {
      const bone = s.id(n);
      // which sign of rotation about the ear's local X moves its tip backward (−Z at bind)
      const tip0 = new THREE.Vector3(0, s.length[bone], 0).applyQuaternion(s.bindWorldQuat[bone]).z;
      const q = s.bindWorldQuat[bone].clone().multiply(_qa.setFromAxisAngle(AX, 0.01));
      const tip1 = new THREE.Vector3(0, s.length[bone], 0).applyQuaternion(q).z;
      return { bone, backSign: tip1 < tip0 ? 1 : -1, s: { x: 0, v: 0 } };
    });
    const finNames = (['L', 'R'] as const).flatMap((side) => [...rig.wings[side].hipRibs, ...rig.wings[side].finRibs]);
    this.fins = finNames.map((n, k) => ({ bone: s.id(n), phase: k * t.fins.phaseStep, s: { x: 0, v: 0 } }));
    const spine = rig.chains.spine;
    this.chest = spine.slice(-2).map((n) => s.id(n));
    this.neckBase = s.id(rig.chains.neck[0]);
    this.nextEarTwitch = lerp(t.ears.twitchMin, t.ears.twitchMax, rng());
    this.nextFinTwitch = lerp(t.fins.twitchMin, t.fins.twitchMax, rng());
  }

  get breathRate(): number {
    return lerp(this.t.breath.calmPerMin, this.t.breath.exertedPerMin, this.exertion) / 60;
  }

  update(inp: SecondaryInput, dt: number): void {
    const t = this.t;
    this.time += dt;
    const n = this.tail.length;
    const latAccel = inp.speed * inp.yawRate;
    for (let k = 0; k < n; k++) {
      const f = (k + 1) / n;
      const omega = lerp(t.tail.omegaBase, t.tail.omegaTip, k / Math.max(n - 1, 1));
      const yawT = clamp((t.tail.turnGain * inp.yawRate + t.tail.latAccelGain * latAccel) * f, -this.tailYawLimit, this.tailYawLimit);
      const pitchT = clamp(-deg(t.tail.droopDeg) + deg(t.tail.gallopRaiseDeg) * inp.gallopWeight - t.tail.vertAccelGain * inp.verticalAccel * f,
        -this.tailPitchLimit, this.tailPitchLimit);
      stepSpring(this.tailYaw[k], yawT, omega, t.tail.zeta, dt);
      stepSpring(this.tailPitch[k], pitchT, omega, t.tail.zeta, dt);
    }
    this.nextEarTwitch -= dt;
    if (this.nextEarTwitch <= 0 && this.ears.length) {
      const e = this.ears[Math.min(this.ears.length - 1, Math.floor(this.rng() * this.ears.length))];
      e.s.v += (this.rng() < 0.5 ? -1 : 1) * t.ears.twitchImpulse;
      this.nextEarTwitch = lerp(t.ears.twitchMin, t.ears.twitchMax, this.rng());
    }
    for (const e of this.ears) stepSpring(e.s, e.backSign * deg(t.ears.gallopBackDeg) * inp.gallopWeight, t.ears.omega, t.ears.zeta, dt);
    this.nextFinTwitch -= dt;
    if (this.nextFinTwitch <= 0 && this.fins.length) {
      const f = this.fins[Math.min(this.fins.length - 1, Math.floor(this.rng() * this.fins.length))];
      f.s.v += (this.rng() < 0.5 ? -1 : 1) * t.fins.twitchImpulse;
      this.nextFinTwitch = lerp(t.fins.twitchMin, t.fins.twitchMax, this.rng());
    }
    const flutter = deg(t.fins.flutterDeg) * Math.min(1, inp.speed / t.fins.flutterFullSpeed);
    for (const f of this.fins) stepSpring(f.s, flutter * Math.sin(TAU * t.fins.flutterHz * this.time + f.phase), t.fins.omega, t.fins.zeta, dt);
    const target = inp.exertion ?? Math.min(1, inp.speed / t.breath.exertionFullSpeed);
    this.exertion = target >= this.exertion ? target : this.exertion + (target - this.exertion) * Math.min(1, dt / t.breath.recoverTime);
    this.breathPhase = fract(this.breathPhase + this.breathRate * dt);
  }

  apply(s: RigSkeleton): void {
    this.applyBreathing(s);
    this.applyAppendages(s);
  }

  /** Chest rise and fall; the neck base cancels it so the head stays steady. Moves the shoulders — apply before leg IK. */
  applyBreathing(s: RigSkeleton): void {
    const b = deg(this.t.breath.amplitudeDeg) * Math.sin(TAU * this.breathPhase);
    for (const c of this.chest) s.localQuat[c].multiply(_qa.setFromAxisAngle(AX, b));
    s.localQuat[this.neckBase].multiply(_qa.setFromAxisAngle(AX, -b * this.chest.length));
  }

  /** Tail, ears and fins (nothing downstream depends on them), then FK and the tail's ground avoidance. */
  applyAppendages(s: RigSkeleton): void {
    for (let k = 0; k < this.tail.length; k++) {
      // Write-time clamp (mirrors look.ts's apply()): the spring value can overshoot the target it was driven
      // toward (it's underdamped), so the WRITTEN angle — not just the target — must respect the rig's chain limit.
      const yaw = clamp(this.tailYaw[k].x, -this.tailYawLimit, this.tailYawLimit);
      const pitch = clamp(this.tailPitch[k].x, -this.tailPitchLimit, this.tailPitchLimit);
      s.localQuat[this.tail[k]].multiply(_qa.setFromAxisAngle(AZ, yaw)).multiply(_qb.setFromAxisAngle(AX, pitch));
    }
    for (const e of this.ears) s.localQuat[e.bone].multiply(_qa.setFromAxisAngle(AX, e.s.x));
    for (const f of this.fins) s.localQuat[f.bone].multiply(_qa.setFromAxisAngle(AX, f.s.x));
    s.fk();
    // Ground avoidance, base → tip: lift each segment whose end would dip below ground + clearance + radius.
    // The probe window (1.5 m up, 4 m down) is a numerical ray-probe range, not a tuning knob (Ruling 14) —
    // generous enough for any slope under the tail, mirroring footPlanner's own auxiliary lift-clearance probes.
    // The lift itself is capped so the bone's total written pitch (clamped spring value + lift) never exceeds
    // the rig's chain limit; a segment capped this way still leaves every later segment free to lift up to its
    // own limit (each is computed independently, from its own spring value and the shared chain-limit budget).
    for (let k = 0; k < this.tail.length; k++) {
      const i = this.tail[k];
      s.tail(i, _p);
      if (!this.world.groundAt(_p.x, _p.z, _p.y + 1.5, 4, _hit)) continue;
      const need = _hit.point.y + this.t.tail.clearance + this.radius[k] - _p.y;
      if (need <= 0) continue;
      const pitchNow = clamp(this.tailPitch[k].x, -this.tailPitchLimit, this.tailPitchLimit);
      const lift = clamp(Math.asin(clamp(need / s.length[i], 0, 1)), 0, this.tailPitchLimit - pitchNow);
      s.localQuat[i].multiply(_qa.setFromAxisAngle(AX, lift));
      s.fk();
    }
  }
}
