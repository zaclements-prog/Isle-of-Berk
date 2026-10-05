import * as THREE from 'three';
import type { DragonAction } from '../behaviour/brain';
import type { DragonCharacter } from '../motion/dragon';
import type { RayHit } from '../../../world/collision';
import type { MotionTuning } from '../motion/tuning';
import { lerp, rotY, smoothstep } from '../motion/math';

type JumpTuning = MotionTuning['jump'];
const UP = new THREE.Vector3(0, 1, 0);
const ORDER = 2;
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

  constructor(private readonly cfg: JumpTuning) {}

  get active(): boolean {
    return this.phase !== 'idle';
  }

  step(d: DragonCharacter, dt: number, standing: boolean): void {
    const c = this.cfg;
    this.cool = Math.max(0, this.cool - dt);
    this.t += dt;
    const L = d.layers;
    const set = (name: string, w: number, time = 0) => {
      if (L.has(name)) L.set(name, w, time, false, ORDER);
    };
    if (this.phase === 'idle') {
      if (!d.intent.jump || !standing || this.cool > 0 || d.mods.scripted || d.climb.mode !== 'ground') return;
      this.phase = 'crouch';
      this.t = 0;
    }
    if (this.phase === 'crouch') {
      set('jump_crouch', smoothstep(0, c.crouchTime, this.t));
      if (this.t >= c.crouchTime) this.takeoff(d);
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
      const release = this.flight - c.releaseTime;
      set('jump_tuck', smoothstep(c.tuckAt - 0.1, c.tuckAt + 0.05, f) * (1 - smoothstep(release - 0.12, release, this.t)));
      set('jump_land', smoothstep(this.flight - c.landLead, this.flight - c.landLead + 0.12, this.t));
      d.body.override.active = true;
      d.body.override.snap = true;
      d.body.override.height = Math.max(y, this.landY) + d.body.hipHeight;
      d.body.override.pitch = lerp(this.pitchOf(d, 'jump_launch'), this.pitchOf(d, 'jump_land'), smoothstep(0.35, 1, f));
      d.wings.demand('jump', { flare: 1 }, Math.min(smoothstep(0, 0.15, this.t), 1 - smoothstep(this.flight + 0.1, this.flight + 0.5, this.t)));
      if (this.t >= this.flight) {
        this.phase = 'land';
        this.t = 0;
        d.body.override.active = false;
        d.body.override.snap = false;
        d.body.impulse(c.landImpulse);
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
  private takeoff(d: DragonCharacter): void {
    const c = this.cfg;
    const k = d.kin;
    this.phase = 'air';
    this.t = 0;
    this.v.set(k.velocity.x, 0, k.velocity.z);
    const fwd = _dir.set(Math.sin(k.heading), 0, Math.cos(k.heading));
    const along = this.v.dot(fwd);
    if (along < c.minForward) this.v.addScaledVector(fwd, c.minForward - along);
    this.vy = Math.sqrt(2 * c.gravity * c.apex);
    this.y0 = k.pos.y;
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
    for (let i = 0; i < 4; i++) {
      const front = i === 1 || i === 3;
      rotY(d.planner.neutral[i], k.heading, _t).add(this.landing);
      const g = d.world.groundAt(_t.x, _t.z, this.landY + 2, 6, _hit);
      if (g) _t.y = g.point.y;
      d.planner.forceStep(i, _t, g ? _hit.normal : UP, this.flight + (front ? c.frontLag : c.hindLag), c.minLift);
    }
  }
}
