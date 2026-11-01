import * as THREE from 'three';
import type { DragonAction } from '../behaviour/brain';
import type { DragonCharacter } from '../motion/dragon';
import type { RayHit } from '../../../world/collision';
import type { MotionTuning } from '../motion/tuning';
import { clamp, lerp, rotY, smoothstep } from '../motion/math';
import { stepSpring, type SpringState } from '../motion/springs';

type JumpTuning = MotionTuning['jump'];
const UP = new THREE.Vector3(0, 1, 0);
const ORDER = 2;
const JUMP_LAYERS: readonly string[] = ['jump_crouch', 'jump_launch', 'jump_tuck', 'jump_land'];
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

/**
 * The jump (spec §6.13): anticipation crouch (~0.12 s) → launch at the speed that gives a `apex`-metre rise, carrying
 * his forward momentum → air pose (legs tuck, tail extends, wings flare for balance) → front-feet-first landing with
 * spine compression and a spring absorb → recovery. The flight is scripted: the body follows the ballistic arc through
 * the body solver's override, every paw takes one forced step from its takeoff spot to its landing spot (front paws a
 * little early, hind a little late) while the launch and tuck poses own the legs; before touchdown the legs go back to
 * the IK, which reaches them down onto their landing spots.
 *
 * Every hand-off is continuous: the push takes the pelvis from the crouch (its height and speed) onto the arc over
 * pushTime instead of snapping it to the arc; the pitch follows its own spring through the air and hands its speed
 * back; touchdown keeps the fall going into an absorb as deep as the impact is fast (the body's height spring sinks
 * and recovers); a press while he is still landing or cooling down is buffered, and a re-jump crouches straight out
 * of the landing pose.
 */
export class JumpAction implements DragonAction {
  readonly name = 'jump';
  phase: 'idle' | 'crouch' | 'air' | 'land' = 'idle';
  t = 0;
  readonly aim = null;
  readonly aggressive = false;
  /** Seconds of the current flight (takeoff → body touchdown) and the landing origin. */
  flight = 0;
  readonly landing = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private y0 = 0;
  private vy = 0;
  private landY = 0;
  private cool = 0;
  /** A Space press waiting for the jump to be free (s left). */
  private buffer = 0;
  /** The pelvis's offset from the arc at launch (m) and its speed relative to the arc (m/s), closed over the push. */
  private offH = 0;
  private offV = 0;
  /** The body pitch through the air (its own spring: the override is exact, so the solver's springs sleep). */
  private readonly pitch: SpringState = { x: 0, v: 0 };
  /** The pelvis height of the last two steps (to carry its speed into the launch). */
  private h1 = 0;
  private h0 = 0;
  /** The landing pose's weight as a re-jump's crouch takes over from it. */
  private landFrom = 0;
  /** When (s into the arc) the tuck has handed the legs back to the IK. */
  private release = 0;

  constructor(private readonly cfg: JumpTuning) {}

  /** The arc's velocity (m/s, world) while in the air; zero otherwise. */
  velocity(out: THREE.Vector3): THREE.Vector3 {
    if (this.phase !== 'air') return out.set(0, 0, 0);
    return out.set(this.v.x, this.vy - this.cfg.gravity * this.t, this.v.z);
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Abandon the jump at once (a respawn): no jump layer, wing demand, suspended climbing or scripted body left behind. */
  reset(d: DragonCharacter): void {
    if (this.phase !== 'idle') {
      for (const name of JUMP_LAYERS) if (d.layers.has(name)) d.layers.set(name, 0);
      d.wings.demand('jump', null);
      d.climb.suspended = false;
      d.body.override.active = false;
      d.body.override.snap = false;
      d.body.override.exact = false;
      d.mods.scripted = false;
      d.planner.autoStep = true;
    }
    this.phase = 'idle';
    this.t = 0;
    this.cool = 0;
    this.buffer = 0;
  }

  step(d: DragonCharacter, dt: number, standing: boolean): void {
    const c = this.cfg;
    this.cool = Math.max(0, this.cool - dt);
    this.buffer = Math.max(0, this.buffer - dt);
    this.t += dt;
    this.h0 = this.h1;
    this.h1 = d.body.pose.pelvisPos.y;
    const L = d.layers;
    const set = (name: string, w: number, time = 0) => {
      if (L.has(name)) L.set(name, w, time, false, ORDER);
    };
    // a press the jump cannot take yet (still landing, recovering, cooling down, the posture still settling) waits a
    // moment for it rather than being lost; one at a gallop's speed is the flight's (a running takeoff)
    if (d.intent.jump && (this.phase !== 'idle' || this.cool > 0 || !standing)) this.buffer = c.bufferTime;
    const want = d.intent.jump || this.buffer > 0;
    const free = !d.mods.scripted && d.climb.mode === 'ground' && d.kin.speed < d.tuning.flight.runTakeoffSpeed;
    if (this.phase === 'idle') {
      if (!want || !standing || this.cool > 0 || !free) return;
      this.startCrouch(0);
    } else if (this.phase === 'land' && want && free && this.t >= c.rejumpAfter) {
      // straight out of the landing into the next crouch (the landing pose hands over to it)
      this.startCrouch(L.weight('jump_land'));
      d.body.override.active = false;
      d.body.override.exact = false;
    }
    if (this.phase === 'crouch') {
      const k = smoothstep(0, c.crouchTime, this.t);
      set('jump_crouch', k);
      if (this.landFrom > 0) set('jump_land', this.landFrom * (1 - k));
      d.wings.demand('jump', { flare: 1 }, this.landFrom * (1 - k));
      if (this.t >= c.crouchTime) this.takeoff(d, dt);
      return;
    }
    if (this.phase === 'air') {
      d.climb.suspended = true;
      d.mods.scripted = true;
      d.planner.autoStep = false;
      d.kin.pos.addScaledVector(this.v, dt);
      d.kin.speed = this.v.length();
      const y = this.y0 + this.vy * this.t - 0.5 * c.gravity * this.t * this.t;
      const f = this.t / this.flight;
      // layers: crouch out; launch → tuck crossfade; tuck (the legs' owner) hands the legs back to the IK before touchdown
      set('jump_crouch', 1 - smoothstep(0, 0.1, this.t));
      set('jump_launch', smoothstep(0, 0.06, this.t) * (1 - smoothstep(c.tuckAt, c.tuckAt + 0.15, f)));
      const release = this.release;
      set('jump_tuck', smoothstep(c.tuckAt - 0.1, c.tuckAt + 0.05, f) * (1 - smoothstep(release - 0.12, release, this.t)));
      set('jump_land', smoothstep(this.flight - c.landLead, this.flight - c.landLead + 0.12, this.t));
      // the push: the pelvis leaves the crouch at its own height and speed and meets the arc pushTime later (a cubic
      // that closes the offset and its speed together)
      const u = clamp(this.t / Math.max(c.pushTime, 1e-3), 0, 1);
      const T = Math.max(c.pushTime, 1e-3);
      const off = u >= 1 ? 0 : this.offH * (2 * u * u * u - 3 * u * u + 1) + this.offV * T * (u * u * u - 2 * u * u + u);
      const o = d.body.override;
      o.active = true;
      o.exact = true;
      o.snap = false;
      o.height = Math.max(y, this.landY) + d.body.hipHeight + off;
      stepSpring(this.pitch, lerp(this.pitchOf(d, 'jump_launch'), this.pitchOf(d, 'jump_land'), smoothstep(0.35, 1, f)), d.tuning.body.tiltOmega, 1, dt);
      o.pitch = this.pitch.x;
      o.roll = 0;
      d.wings.demand('jump', { flare: 1 }, Math.min(smoothstep(0, 0.15, this.t), 1 - smoothstep(this.flight + 0.1, this.flight + 0.5, this.t)));
      // touchdown on the step the arc meets the ground (it falls between steps: held at landY for a step, the pelvis
      // would stop dead before the absorb)
      if (this.t >= this.flight || (this.vy < c.gravity * this.t && y < this.landY)) {
        this.phase = 'land';
        this.t = 0;
        o.active = false;
        o.exact = false;
        // the absorb: the fall carries on into the height spring, which sinks as deep as the impact was fast and comes
        // back up (a critically damped spring from rest with speed V bottoms out at V / (ω·e))
        const vi = Math.max(0, -(this.vy - c.gravity * this.flight));
        const depth = clamp(c.absorbPerSpeed * vi, c.absorbMin, c.absorbMax);
        const sink = Math.max(c.landImpulse, depth * d.tuning.body.heightOmega * Math.E);
        d.body.impulse(sink + d.body.heightSpeed);
        // momentum carries on only if he is asked to keep going; otherwise the landing soaks it up
        const carry = d.intent.hasDir ? this.v.length() : Math.min(this.v.length(), c.landCarry);
        d.kin.velocity.copy(this.v).setLength(carry);
        d.kin.speed = carry;
        d.mods.scripted = false;
        d.planner.autoStep = true;
      }
      return;
    }
    // land: hold the landing shape a moment, then recover; the hind paws may still be touching down
    d.climb.suspended = false;
    set('jump_launch', 0);
    set('jump_tuck', 0);
    set('jump_land', 1 - smoothstep(c.recoverHold, c.recoverHold + c.recoverTime, this.t));
    d.wings.demand('jump', { flare: 1 }, 1 - smoothstep(0, 0.4, this.t));
    if (this.t >= c.recoverHold + c.recoverTime) {
      set('jump_land', 0);
      d.wings.demand('jump', null);
      this.phase = 'idle';
      this.cool = c.cooldown;
    }
  }

  private startCrouch(landFrom: number): void {
    this.phase = 'crouch';
    this.t = 0;
    this.buffer = 0;
    this.landFrom = landFrom;
  }

  /** First time on the way down that the arc meets the ground under it. */
  private findLanding(d: DragonCharacter): void {
    const c = this.cfg;
    const k = d.kin;
    this.flight = c.maxFlight;
    this.landY = this.y0;
    for (let tt = 0.2; tt <= c.maxFlight; tt += 1 / 120) {
      const y = this.y0 + this.vy * tt - 0.5 * c.gravity * tt * tt;
      _p.copy(k.pos).addScaledVector(this.v, tt);
      const g = d.world.groundAt(_p.x, _p.z, Math.max(y, this.y0) + 2, 60, _hit);
      if (g && this.vy - c.gravity * tt < 0 && y <= g.point.y) {
        this.flight = tt;
        this.landY = g.point.y;
        break;
      }
    }
  }

  /** Paw level (the arc) stays above the ground under the body from the hind feet to the muzzle until touchdown. */
  private clearsArc(d: DragonCharacter): boolean {
    const c = this.cfg;
    const k = d.kin;
    const len = this.v.length();
    if (len < 1e-6) return true;
    const fx = this.v.x / len;
    const fz = this.v.z / len;
    for (let tt = 0.05; tt < this.flight - 0.1; tt += 0.05) {
      const y = this.y0 + this.vy * tt - 0.5 * c.gravity * tt * tt;
      for (const off of [-c.rearExtent, 0, d.climb.frontExtent]) {
        _p.copy(k.pos).addScaledVector(this.v, tt);
        const g = d.world.groundAt(_p.x + fx * off, _p.z + fz * off, y + 3, 6, _hit);
        if (g && g.point.y > y - c.clearance) return false;
      }
    }
    return true;
  }

  private pitchOf(d: DragonCharacter, clip: string): number {
    return d.layers.meta(clip)?.bodyPitch ?? 0;
  }

  /** Launch: ballistic speeds, the landing found along the arc, one forced step per paw to its landing spot. */
  private takeoff(d: DragonCharacter, dt: number): void {
    const c = this.cfg;
    const k = d.kin;
    this.phase = 'air';
    this.t = 0;
    this.landFrom = 0;
    d.wings.demand('jump', null);
    this.v.set(k.velocity.x, 0, k.velocity.z);
    const fwd = _dir.set(Math.sin(k.heading), 0, Math.cos(k.heading));
    const along = this.v.dot(fwd);
    if (along < c.minForward) this.v.addScaledVector(fwd, c.minForward - along);
    this.vy = Math.sqrt(2 * c.gravity * c.apex);
    this.y0 = k.pos.y;
    // where the crouch has the pelvis (and how fast it moves) against the arc's start: the push closes the gap
    this.offH = this.h1 - (this.y0 + d.body.hipHeight);
    this.offV = (this.h1 - this.h0) / dt - this.vy;
    this.pitch.x = d.body.pose.pitch;
    this.pitch.v = d.body.pitchSpeed;
    // stop short of a wall in the flight path: the body reaches frontExtent ahead of the origin (the muzzle)
    const dist = this.v.length() * (2 * this.vy) / c.gravity;
    if (dist > 1e-3) {
      const reach = d.climb.frontExtent + c.wallMargin;
      let free = dist;
      for (const h of [0.6, 1.2, 1.8]) {
        _p.copy(k.pos).addScaledVector(UP, h);
        const hit = d.world.raycast(_p, _t.copy(this.v).normalize(), dist + reach, _hit);
        if (hit) free = Math.min(free, Math.max(0, hit.distance - reach));
      }
      this.v.multiplyScalar(free / dist);
    }
    // off a ledge the hind quarters trail behind the origin: speed up until the whole body clears the arc
    this.findLanding(d);
    for (let tries = 0; tries < 8 && !this.clearsArc(d); tries++) {
      this.v.multiplyScalar(1.15);
      this.findLanding(d);
    }
    this.landing.copy(k.pos).addScaledVector(this.v, this.flight).setY(this.landY);
    // the legs go back to the IK (which reaches them for their landing spots) releaseTime before touchdown, but not
    // while the body is still more than reachExtra above its landing height: from higher up the IK can only hang them
    // straight down at the ground for the rest of the fall
    const disc = this.vy * this.vy - 2 * c.gravity * (this.landY + c.reachExtra - this.y0);
    const reach = disc >= 0 ? (this.vy + Math.sqrt(disc)) / c.gravity : 0;
    this.release = Math.min(this.flight, Math.max(this.flight - c.releaseTime, reach));
    for (let i = 0; i < 4; i++) {
      const front = i === 1 || i === 3;
      rotY(d.planner.neutral[i], k.heading, _t).add(this.landing);
      const g = d.world.groundAt(_t.x, _t.z, this.landY + 2, 6, _hit);
      if (g) _t.y = g.point.y;
      d.planner.forceStep(i, _t, g ? _hit.normal : UP, this.flight + (front ? c.frontLag : c.hindLag), c.minLift);
    }
  }
}
