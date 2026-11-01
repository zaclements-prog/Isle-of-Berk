import * as THREE from 'three';
import type { DragonAction } from '../behaviour/brain';
import type { DragonCharacter } from '../motion/dragon';
import type { FlightClipMeta } from '../motion/poseLayers';
import { angleDiff, clamp, deg, fract, lerp, smoothstep, wrapAngle } from '../motion/math';
import type { MotionTuning } from '../motion/tuning';
import type { RayHit } from '../../../world/collision';

type FlightTuning = MotionTuning['flight'];
type Phase = 'idle' | 'prep' | 'takeoff' | 'air' | 'descend' | 'landing' | 'settle' | 'runout';

/** Flight clips play above every other layer (posture 0 < gesture 1 < action 2). */
const ORDER = 3;
const FPS = 30;
const G = 9.81;
export const FLIGHT_CLIPS = ['fly_flap', 'fly_glide', 'fly_takeoff', 'fly_runtakeoff_wings', 'fly_runtakeoff', 'fly_land', 'fly_runland'] as const;
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _p = new THREE.Vector3();

/**
 * A flight curve (one value per frame at 30 fps) at time t: clamped, or wrapped for a loop. Between frames a
 * Catmull-Rom spline through the neighbouring frames (a missing end neighbour extrapolated linearly, so a straight run
 * stays straight): linear interpolation of a 30 fps curve at 120 Hz changes the pelvis's speed every fourth step.
 */
export function sampleFlight(curve: readonly number[], t: number, loop = false): number {
  const n = curve.length;
  if (n === 0) return 0;
  if (n === 1) return curve[0];
  let k: number;
  let u: number;
  if (loop) {
    const x = fract((t * FPS) / n) * n;
    k = Math.floor(x);
    u = x - k;
  } else {
    const x = clamp(t * FPS, 0, n - 1);
    k = Math.min(Math.floor(x), n - 2);
    u = x - k;
  }
  const at = (i: number): number => {
    if (loop) return curve[((i % n) + n) % n];
    if (i < 0) return 2 * curve[0] - curve[1];
    if (i > n - 1) return 2 * curve[n - 1] - curve[n - 2];
    return curve[i];
  };
  const p0 = at(k - 1);
  const p1 = at(k);
  const p2 = at(k + 1);
  const p3 = at(k + 2);
  return 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
}

/**
 * Flight (Phase 2): takeoff, the camera-steered flight, landing. The clips come from Blender (flight_export.py) with
 * every bone but the pelvis; this action places the pelvis (the body solver's override: height, pitch, roll) and moves
 * the body itself (`mods.scripted`), like the jump.
 *
 * - **Standing takeoff** (Space held from a stand): `fly_takeoff` plays; its height, pitch and forward travel drive
 *   the body, the legs pre-load and push with the first downstroke.
 * - **Running takeoff** (Space at a gallop): `prep` plays `fly_runtakeoff_wings` over the gallop, timed by the gait
 *   phase to end on the next left-hind touchdown; then `fly_runtakeoff` from that push, faded in from the gallop
 *   while the gallop's height and speed hand over.
 * - **Air**: a simple path. Heading follows the camera's yaw, the path angle its pitch, the bank is the coordinated
 *   one. W flaps (thrust), nothing glides (a shallow sink, little drag), S brakes. The flap and glide loops cross-fade
 *   at their phase gates (the flap stops at mid-downstroke, where its wings are level like the glide's; the glide
 *   enters the flap on its upstroke). Their pelvis bob and pitch ride on the path. The ground ahead keeps him up.
 * - **Landing** (Space in the air): above maxLandHeight he first descends; then `fly_land` (slow) or `fly_runland`
 *   (fast) plays against the ground found at its touchdown spot, the height gap closing before the flare. A
 *   standing landing settles at its end; a running one hands the body to the gallop at hind touchdown (the gait
 *   phase set to 0, the feet re-seated), the clip fading out as the planner and the cycles take over.
 * - **Run-out** (after a running landing): the ground motion has the body back (kinematics, feet, cycles) but the
 *   pelvis eases from the clip's touchdown carriage (high, legs reaching) down onto the ground's running height over
 *   runoutTime, its height and speed carried, instead of dropping onto the springs 0.4 m high (the legs then fall
 *   short and pull the body down into a belly-low sag); the landing speed bleeds off over runoutDecel s whatever is
 *   held, rather than braking to the trot at once.
 *
 * Every hand-off keeps the pelvis continuous: the difference between the old and new placement is carried and eased
 * out over `settle`.
 */
export class FlightAction implements DragonAction {
  readonly name = 'flight';
  readonly aim = null;
  readonly aggressive = false;
  phase: Phase = 'idle';
  /** Time in the current phase (s) and the current one-shot clip's time (s). */
  t = 0;
  clipT = 0;
  clip: string | null = null;
  run = false;
  /** Path: character origin (x, z) and pelvis height (y); heading, path angle (rad, + up), speed (m/s), bank (rad). */
  readonly pos = new THREE.Vector3();
  heading = 0;
  gamma = 0;
  speed = 0;
  bank = 0;
  yawRate = 0;
  /** Loops: flap and glide weights, beat phases (0…1), the flap's rate (it slows to a stop into the glide). */
  flapW = 0;
  glideW = 0;
  /** The tuck (Shift held in the air), eased in and out over tuckTime: 0 wings out, 1 swept back for a dive. */
  tuckW = 0;
  flapU = 0;
  glideU = 0;
  private flapRate = 1;
  private mode: 'flap' | 'glide' = 'flap';
  private stopping = false;
  private airW = 0;
  /** One-shot clip state. */
  private clipW = 0;
  private ground = 0;
  private v0 = 0;
  private clipOff = 0;
  private clipOffV = 0;
  private groundH: number | null = null;
  private groundV = 0;
  private pitchOff = 0;
  /** The pitch speed (rad/s) the takeoff brought beyond the clip's own, closed with the offset. */
  private pitchOffV = 0;
  /** Continuity carry (eased out over `settle`): pelvis height (m), pitch (rad). */
  private carryH = 0;
  private carryP = 0;
  private carryT = 0;
  private outH = 0;
  private outP = 0;
  private outVH = 0;
  private outVP = 0;
  private prevPhase = 0;
  private prepLeft = 0;
  private landRun = true;
  private fedFeet = false;
  private fading: string | null = null;
  private fadeW = 0;

  /** Plasma on the wing: the flap's beat held back by this share (0…1) while he charges (PlasmaBody.hitch). */
  hitch = 0;
  /** The plasma release's nose-up: amplitude (rad), and the time since it (s). */
  private recoilA = 0;
  private recoilT = Infinity;

  constructor(private readonly cfg: FlightTuning) {}

  /** The path's velocity (m/s, world): speed along the heading at the path angle (no flap bob). */
  velocity(out: THREE.Vector3): THREE.Vector3 {
    if (!this.airborne) return out.set(0, 0, 0);
    const h = Math.cos(this.gamma) * this.speed;
    return out.set(Math.sin(this.heading) * h, Math.sin(this.gamma) * this.speed, Math.cos(this.heading) * h);
  }

  /** A plasma release on the wing: the nose pitches up by `pitch` (rad), easing in and out, and he loses some speed. */
  recoil(pitch: number, speedLoss: number): void {
    this.recoilA = pitch;
    this.recoilT = 0;
    if (this.phase === 'air' || this.phase === 'descend') this.speed = Math.max(this.cfg.minSpeed, this.speed - speedLoss);
  }

  /** The recoil's pitch now: up over 0.08 s, back over the next ~0.5 s (smooth: no pop in the pelvis). */
  private recoilPitch(dt: number): number {
    if (!Number.isFinite(this.recoilT)) return 0;
    this.recoilT += dt;
    const t = this.recoilT;
    if (t > 0.6) {
      this.recoilT = Infinity;
      return 0;
    }
    return this.recoilA * smoothstep(0, 0.08, t) * (1 - smoothstep(0.08, 0.6, t));
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Flying (any phase but idle and the gallop prep): the body is the flight's. */
  get airborne(): boolean {
    return this.phase === 'takeoff' || this.phase === 'air' || this.phase === 'descend' || this.phase === 'landing';
  }

  private meta(d: DragonCharacter, name: string): FlightClipMeta | undefined {
    return d.layers.meta(name)?.flight;
  }

  private available(d: DragonCharacter): boolean {
    return FLIGHT_CLIPS.every((n) => d.layers.has(n) && this.meta(d, n));
  }

  reset(d: DragonCharacter): void {
    this.tuckW = 0;
    this.hitch = 0;
    this.recoilT = Infinity;
    d.wings.tuck = 0;
    if (this.phase !== 'idle' || this.fading) {
      for (const n of FLIGHT_CLIPS) if (d.layers.has(n)) d.layers.set(n, 0);
      this.release(d);
    }
    this.phase = 'idle';
    this.fading = null;
    this.t = 0;
  }

  step(d: DragonCharacter, dt: number): void {
    const c = this.cfg;
    this.t += dt;
    this.fade(d, dt);
    if (this.phase === 'idle' || this.phase === 'prep') {
      // the body's own pelvis height and speed on the ground (the gait's bob included): a takeoff starts from them
      const h = d.body.pose.pelvisPos.y;
      this.groundV = this.groundH === null ? 0 : (h - this.groundH) / dt;
      this.groundH = h;
    } else this.groundH = null;
    if (this.phase === 'idle') {
      if (!this.available(d) || d.mods.scripted || d.climb.mode !== 'ground') return;
      if (d.intent.fly) this.startTakeoff(d, false);
      else if (d.intent.jump && d.kin.speed >= c.runTakeoffSpeed) {
        d.intent.jump = false;                                    // the jump must not take it too
        this.startPrep(d);
      } else if (d.intent.jump && d.intent.gallop) {
        // Shift + Space is always a takeoff: short of a gallop's speed (held to a trot on rough ground, still getting
        // going) it's a standing one, not a hop that reads as a takeoff that failed
        d.intent.jump = false;
        this.startTakeoff(d, false);
      }
      if ((this.phase as Phase) !== 'takeoff') return;
    }
    if (this.phase === 'prep') {
      this.stepPrep(d, dt);
      // the push starts this very step: a step of the gallop's own kinematics after the takeoff took his position
      // would set him back by that step's travel
      if ((this.phase as Phase) !== 'takeoff') return;
    }
    if (this.phase === 'settle') return this.stepSettle(d, dt);
    if (this.phase === 'runout') return this.stepRunout(d, dt);
    d.mods.scripted = true;
    d.climb.suspended = true;
    d.planner.autoStep = false;
    if (this.phase === 'takeoff') this.stepTakeoff(d, dt);
    else if (this.phase === 'air' || this.phase === 'descend') this.stepAir(d, dt);
    else if (this.phase === 'landing') this.stepLanding(d, dt);
  }

  // ---- takeoff ------------------------------------------------------------------------------------------------------

  private startPrep(d: DragonCharacter): void {
    const m = this.meta(d, 'fly_runtakeoff_wings')!;
    const dur = (m.height.length - 1) / FPS;
    const cad = Math.max(d.gait.cadence, 0.5);
    let left = (1 - d.gait.phase) / cad;                         // to the next left-hind touchdown
    while (left < 0.75 * dur) left += 1 / cad;
    this.phase = 'prep';
    this.run = true;
    this.t = 0;
    this.prepLeft = left;
    this.prevPhase = d.gait.phase;
  }

  private stepPrep(d: DragonCharacter, dt: number): void {
    const m = this.meta(d, 'fly_runtakeoff_wings')!;
    const dur = (m.height.length - 1) / FPS;
    this.prepLeft -= dt;
    const wt = dur - this.prepLeft;
    const w = smoothstep(0, 0.15, wt);
    d.layers.set('fly_runtakeoff_wings', Math.max(w, 1e-4), clamp(wt, 0, dur), false, ORDER);
    d.wings.liftScale = 1 - w;
    const ph = d.gait.phase;
    const wrapped = ph < this.prevPhase - 0.5;
    this.prevPhase = ph;
    // the push lands on the left hind's touchdown (gallop phase 0); a stalled gait (he stopped) gives up at the clip end
    if ((wrapped && this.prepLeft < 0.12) || this.prepLeft < -0.2) {
      // the wings hand over to the push's as it fades in over the gallop (runBlend), not at once
      this.fadeOut('fly_runtakeoff_wings', 1, this.cfg.runBlend, clamp(wt, 0, dur));
      this.startTakeoff(d, true);
    }
  }

  private startTakeoff(d: DragonCharacter, run: boolean): void {
    const name = run ? 'fly_runtakeoff' : 'fly_takeoff';
    const m = this.meta(d, name)!;
    this.phase = 'takeoff';
    this.run = run;
    this.clip = name;
    this.clipT = 0;
    this.t = 0;
    this.clipW = 0;
    this.ground = d.kin.pos.y;
    this.pos.set(d.kin.pos.x, d.body.pose.height, d.kin.pos.z);
    this.heading = d.kin.heading;
    this.v0 = d.kin.speed;
    // the clip starts from its own authored carriage: the engine's height and pitch (and their speeds) now hand over
    const h0 = d.body.pose.pelvisPos.y;
    this.clipOff = h0 - (this.ground + m.height[0]);
    this.clipOffV = this.groundV - (m.height[1] - m.height[0]) * FPS;
    this.pitchOff = d.body.pose.pitch - m.pitch[0];
    this.pitchOffV = d.body.pitchSpeed - (m.pitch[1] - m.pitch[0]) * FPS;
    this.carryH = this.carryP = 0;
    this.pendingCarry = false;
    this.outH = h0;
    this.outP = d.body.pose.pitch;
    this.outVH = this.groundV;
    this.outVP = d.body.pitchSpeed;
    d.intent.fly = false;
  }

  private stepTakeoff(d: DragonCharacter, dt: number): void {
    const c = this.cfg;
    const m = this.meta(d, this.clip!)!;
    const dur = (m.height.length - 1) / FPS;
    const t0 = this.clipT;
    this.clipT = Math.min(dur, this.clipT + dt);
    const t = this.clipT;
    const blend = this.run ? c.runBlend : 0.25;
    this.clipW = smoothstep(0, blend, t);
    d.layers.set(this.clip!, Math.max(this.clipW, 1e-4), t, false, ORDER);
    d.wings.liftScale = 1 - Math.min(1, this.clipW + this.fadeWeight);
    const offW = 1 - smoothstep(0, c.runOffsetTime, t);
    // the gap to the clip's carriage (and its speed) closes over runOffsetTime
    const h = this.ground + sampleFlight(m.height, t) + (this.clipOff + this.clipOffV * t) * offW;
    const pitch = sampleFlight(m.pitch, t) + (this.pitchOff + this.pitchOffV * t) * offW;
    // forward: the clip's own travel, plus (running) the gallop's extra speed over the clip's, handing over in 1 s
    const xs = m.x!;
    let dx = sampleFlight(xs, t) - sampleFlight(xs, t0);
    if (this.run) dx += (this.v0 - (m.speed0 ?? this.v0)) * (1 - smoothstep(0, 1, t)) * dt;
    // steering: from lift-off on, toward the camera's heading
    const lift = m.liftoff ?? 0;
    const steer = smoothstep(lift, lift + 0.6, t);
    this.yawRate = clamp(angleDiff(this.heading, d.cameraYaw) * c.headingGain, -deg(c.maxTurnRateDeg), deg(c.maxTurnRateDeg)) * steer;
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    this.pos.x += Math.sin(this.heading) * dx;
    this.pos.z += Math.cos(this.heading) * dx;
    const vy = (h - this.pos.y) / dt;
    this.pos.y = h;
    const hs = dx / dt;
    this.speed = Math.hypot(hs, vy);
    this.gamma = Math.atan2(vy, Math.max(hs, 0.1));
    this.bank += (clamp(-Math.atan((this.speed * this.yawRate) / G), -deg(c.maxBankDeg), deg(c.maxBankDeg)) * steer - this.bank) * (1 - Math.exp(-c.bankOmega * dt));
    this.place(d, h, pitch, this.bank, dt);
    if (t + dt >= dur) {
      // into the cruise flap, on the beat the takeoff ended on (the path keeps the body's velocity: speed along it and
      // its angle, so the climb carries on and eases into level flight)
      this.phase = 'air';
      this.t = 0;
      this.mode = 'flap';
      this.stopping = false;
      this.flapRate = 1;
      this.flapU = m.beatEnd ?? 0;
      this.flapW = 1;
      this.glideW = 0;
      this.airW = 0;
      this.fadeOut(this.clip!, 1);
      this.clip = null;
      this.handoff();
    }
  }

  // ---- air ----------------------------------------------------------------------------------------------------------

  private stepAir(d: DragonCharacter, dt: number): void {
    const c = this.cfg;
    const flap = this.meta(d, 'fly_flap')!;
    const glide = this.meta(d, 'fly_glide')!;
    const throttle = d.intent.throttle;
    const agl = this.pos.y - this.groundBelow(d);
    // the tuck: Shift held (not while landing); it ends any flap and lets the dive go steeper
    const tuck = d.intent.gallop && this.phase === 'air';
    this.tuckW = clamp(this.tuckW + (tuck ? 1 : -1) * (dt / c.tuckTime), 0, 1);
    const dive = lerp(c.diveDeg, c.tuckDiveDeg, this.tuckW);
    // the path angle the camera asks for, then the glide's sink, a stall's nose-down and the ground's pull-up
    let gammaT = clamp(deg(c.neutralPitchDeg) - d.cameraPitch, -deg(dive), deg(c.climbDeg)) * c.pitchGain;
    gammaT = clamp(gammaT, -deg(dive), deg(c.climbDeg));
    const wantFlap = !tuck && (throttle > 0 || gammaT > deg(5) || this.speed < c.minSpeed);
    if (this.phase === 'descend') gammaT = -deg(c.descendDeg);
    else if (!wantFlap && this.speed <= c.glideSpeed) gammaT = Math.min(gammaT, -deg(c.glideSinkDeg));
    if (this.speed < c.minSpeed) gammaT = Math.min(gammaT, -deg(4) * (c.minSpeed - this.speed));
    const clear = c.minClearance - this.clearanceAhead(d);
    if (clear > 0 && this.phase !== 'descend') gammaT = Math.max(gammaT, Math.min(deg(c.climbDeg), clear * deg(12)));
    this.gamma += (gammaT - this.gamma) * (1 - Math.exp(-c.pathOmega * dt));
    // heading toward the camera's yaw; the bank is the coordinated one, into the turn: + yaw rate turns him to his left
    // (+X), and + roll lifts the left side, so a left turn rolls negative (as the ground lean in bodySolver)
    this.yawRate = clamp(angleDiff(this.heading, d.cameraYaw) * c.headingGain, -deg(c.maxTurnRateDeg), deg(c.maxTurnRateDeg));
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    const bankT = clamp(-Math.atan((this.speed * this.yawRate) / G), -deg(c.maxBankDeg), deg(c.maxBankDeg));
    this.bank += (bankT - this.bank) * (1 - Math.exp(-c.bankOmega * dt));
    // speed: thrust while flapping against the flap's drag; the glide's drag balances its sink at glideSpeed
    const kFlap = c.flapThrust / (c.flapSpeed * c.flapSpeed);
    const kGlide = (G * Math.sin(deg(c.glideSinkDeg))) / (c.glideSpeed * c.glideSpeed);
    const k = lerp(lerp(kGlide, kFlap, this.flapW), kGlide * c.tuckDrag, this.tuckW);
    let a = -G * Math.sin(this.gamma) + c.flapThrust * this.flapW * (throttle >= 0 ? 1 : 0) * (1 - this.tuckW) - k * this.speed * this.speed;
    if (throttle < 0) a -= c.brakeDrag * this.speed;
    // wings out above their top speed (out of a dive), the open wings bleed it off over a few seconds
    a -= 0.6 * Math.max(0, this.speed - c.maxSpeed) * (1 - this.tuckW);
    // the descent brakes against the dive: a slow (standing) landing holds its slow speed, a running one stays near the
    // glide's (a long dive from height would otherwise run away)
    if (this.phase === 'descend') {
      const cap = this.landRun ? c.glideSpeed : 0.8 * c.runLandSpeed;
      a = Math.min(a, -2 * c.brakeDrag * Math.max(0, this.speed - cap));
    }
    this.speed = clamp(this.speed + a * dt, 0.5 * c.minSpeed, c.tuckMaxSpeed);
    const h = Math.cos(this.gamma) * this.speed;
    this.pos.x += Math.sin(this.heading) * h * dt;
    this.pos.z += Math.cos(this.heading) * h * dt;
    this.pos.y = Math.max(this.pos.y + Math.sin(this.gamma) * this.speed * dt, this.groundBelow(d) + 0.6 * c.minClearance);
    // the loops: flap ↔ glide at their phase gates
    const fp = flap.period ?? 0.9;
    const gp = glide.period ?? 4;
    if (this.mode === 'flap' && !wantFlap && !this.stopping) {
      const u = fract(this.flapU);
      if (u >= c.flapStopPhase - 0.06 && u <= c.flapStopPhase) this.stopping = true;
    }
    if (this.stopping) {
      // the downstroke slows to a stop at the stop phase while the glide comes in
      this.flapRate = Math.max(0, this.flapRate - dt / c.flapToGlide);
      this.glideW = Math.min(1, this.glideW + dt / c.flapToGlide);
      if (this.glideW >= 1) {
        this.mode = 'glide';
        this.stopping = false;
      }
      if (wantFlap) {                                           // changed his mind: back into the beat
        this.stopping = false;
        this.flapRate = 1;
      }
    } else if (this.mode === 'glide' && wantFlap) {
      this.mode = 'flap';
      this.flapU = c.flapEntryPhase;
      this.flapRate = 1;
    }
    if (this.mode === 'flap' && !this.stopping) this.glideW = Math.max(0, this.glideW - dt / c.glideToFlap);
    this.flapW = 1 - this.glideW;
    // a plasma charge holds the stroke back a little (the phase runs on, slower: the cycle never jumps)
    this.flapU = fract(this.flapU + (this.flapRate * (1 - clamp(this.hitch, 0, 0.9)) * dt) / fp);
    this.glideU = fract(this.glideU + dt / gp);
    this.airW = Math.min(1, this.airW + dt / c.handoff);
    this.setLoops(d, 1);
    const [bob, att] = this.loopBody(d);
    const aw = this.airEase;
    this.place(d, this.pos.y + bob * aw, att * aw + (1 - aw) * this.outP + 0.6 * this.gamma * aw, this.bank, dt);
    // Space: land (descending first when high)
    if (d.intent.jump) {
      d.intent.jump = false;
      this.phase = 'descend';
      this.landRun = this.speed >= c.runLandSpeed;               // the kind of landing is chosen at the press
    }
    if (this.phase === 'descend' && agl <= this.cfg.maxLandHeight + 0.3) this.startLanding(d);
  }

  /** The flap and glide loops' pelvis bob (m) and attitude (rad) at their phases, by their weights. */
  private loopBody(d: DragonCharacter): [number, number] {
    const flap = this.meta(d, 'fly_flap')!;
    const glide = this.meta(d, 'fly_glide')!;
    const fp = flap.period ?? 0.9;
    const gp = glide.period ?? 4;
    return [
      this.flapW * sampleFlight(flap.height, this.flapU * fp, true) + this.glideW * sampleFlight(glide.height, this.glideU * gp, true),
      this.flapW * sampleFlight(flap.pitch, this.flapU * fp, true) + this.glideW * sampleFlight(glide.pitch, this.glideU * gp, true),
    ];
  }

  /** The loops' hand-in from the takeoff clip (0…1), eased so the cross-fade starts and ends without a kink. */
  private get airEase(): number {
    return smoothstep(0, 1, this.airW);
  }

  private setLoops(d: DragonCharacter, w: number): void {
    const flap = this.meta(d, 'fly_flap')!;
    const glide = this.meta(d, 'fly_glide')!;
    const fw = this.flapW * w * this.airEase;
    const gw = this.glideW * w * this.airEase;
    d.layers.set('fly_flap', fw > 1e-4 ? fw : 0, this.flapU * (flap.period ?? 0.9), false, ORDER);
    d.layers.set('fly_glide', gw > 1e-4 ? gw : 0, this.glideU * (glide.period ?? 4), false, ORDER);
    d.wings.liftScale = 1 - Math.min(1, fw + gw + this.clipW + this.fadeWeight);
    d.wings.tuck = this.tuckW * w * this.airEase;
    d.wings.tuckFold = this.cfg.tuckFold;
  }

  // ---- landing ------------------------------------------------------------------------------------------------------

  private startLanding(d: DragonCharacter): void {
    const c = this.cfg;
    this.run = this.landRun;
    const name = this.run ? 'fly_runland' : 'fly_land';
    const m = this.meta(d, name)!;
    const td = m.touchdown ?? 1;
    const flare = m.flare ?? td;
    this.phase = 'landing';
    this.clip = name;
    this.clipT = 0;
    this.t = 0;
    this.clipW = 0;
    this.v0 = this.speed * Math.cos(this.gamma);
    this.fedFeet = false;
    // the touchdown spot: the travel landSpeed gives up to touchdown
    let dist = 0;
    for (let t = 0; t < td; t += 1 / 120) dist += this.landSpeed(m, t, flare) / 120;
    _p.set(this.pos.x + Math.sin(this.heading) * dist, 0, this.pos.z + Math.cos(this.heading) * dist);
    const g = d.world.groundAt(_p.x, _p.z, this.pos.y + 2, 60, _hit);
    this.ground = g ? g.point.y : this.groundBelow(d);
    this.clipOff = this.pos.y - (this.ground + m.height[0]);
    // the descent's sink rate carries on into the clip and eases out (the clip's own approach starts near level)
    this.landVOff = this.outVH - (m.height[1] - m.height[0]) * FPS;
    this.pitchOff = 0.6 * this.gamma;
  }

  /** The vertical speed (m/s) the pelvis brought into the landing clip beyond the clip's own, eased out over landCarryTime. */
  private landVOff = 0;

  private stepLanding(d: DragonCharacter, dt: number): void {
    const c = this.cfg;
    const m = this.meta(d, this.clip!)!;
    const dur = (m.height.length - 1) / FPS;
    const td = m.touchdown ?? dur;
    const flare = m.flare ?? td;
    const t0 = this.clipT;
    this.clipT = Math.min(dur, this.clipT + dt);
    const t = this.clipT;
    this.clipW = smoothstep(0, 0.3, t);
    d.layers.set(this.clip!, Math.max(this.clipW, 1e-4), t, false, ORDER);
    // the loops fade out under the clip, still beating
    this.flapU = fract(this.flapU + (this.flapRate * dt) / 0.9);
    this.glideU = fract(this.glideU + dt / 4);
    this.setLoops(d, 1 - this.clipW);
    const [bob, att] = this.loopBody(d);
    const w = smoothstep(0, 0.5, t);
    const tc = Math.max(c.landCarryTime, 1e-3);
    const h = this.ground + sampleFlight(m.height, t) + this.clipOff * (1 - smoothstep(0, flare, t)) + bob * (1 - w)
      + this.landVOff * t * Math.exp(-t / tc);
    const pitch = lerp(att + this.pitchOff, sampleFlight(m.pitch, t), w);
    const dx = t > t0 ? this.landSpeed(m, t, flare) * (t - t0) : 0;
    const steer = 1 - smoothstep(0, flare, t);                     // small corrections until the flare, then committed
    this.yawRate = clamp(angleDiff(this.heading, d.cameraYaw) * c.headingGain, -deg(c.maxTurnRateDeg), deg(c.maxTurnRateDeg)) * steer * 0.5;
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    this.bank *= 1 - Math.min(1, dt / Math.max(0.3, flare - t));
    this.pos.x += Math.sin(this.heading) * dx;
    this.pos.z += Math.cos(this.heading) * dx;
    this.pos.y = h;
    this.speed = dx / dt;
    this.place(d, h, pitch, this.bank, dt);
    // the feet: re-seated under the body for the IK as the clip lets go of the legs
    if (this.run && t >= td) {
      // running: the gallop takes the body at hind touchdown (the cycles' phase 0)
      this.fadeOut(this.clip!, 1, m.handoff ?? 0.35);
      d.gait.phase = 0;
      d.kin.speed = m.runSpeed ?? 6;
      // the ground motion takes the body back; the pelvis eases down onto it (stepRunout)
      d.resetFeet();
      d.mods.scripted = false;
      d.climb.suspended = false;
      d.planner.autoStep = true;
      d.kin.velocity.set(Math.sin(this.heading) * d.kin.speed, 0, Math.cos(this.heading) * d.kin.speed);
      this.runH = this.outH - (d.kin.pos.y + d.body.hipHeight);
      this.runVH = this.outVH;
      this.runP = this.outP;
      this.runVP = this.outVP;
      this.runRoll = this.bank;
      this.runV = d.kin.speed;
      this.phase = 'runout';
      this.t = 0;
      this.clip = null;
      return;
    }
    if (!this.run && t >= dur) {
      this.fadeOut(this.clip!, 1, c.settle);
      this.finishScripted(d);
      d.kin.speed = 0;
      d.kin.velocity.set(0, 0, 0);
      this.phase = 'settle';
      this.t = 0;
      this.clip = null;
    }
  }

  /**
   * Forward speed (m/s) through a landing clip at its time t. Coming in slower than the clip's own approach, he never
   * speeds up: the clip's speed, capped at the entry speed (so he holds it until the flare brakes below it). Faster,
   * the gap to the clip's speed closes by the flare.
   */
  private landSpeed(m: FlightClipMeta, t: number, flare: number): number {
    const h = 1 / 60;
    const clip = (sampleFlight(m.x!, t + h) - sampleFlight(m.x!, Math.max(0, t - h))) / (t + h - Math.max(0, t - h));
    if (this.v0 <= (m.speed0 ?? this.v0)) return Math.min(this.v0, clip);
    return clip + (this.v0 - (m.speed0 ?? this.v0)) * (1 - smoothstep(0, flare, t));
  }

  private stepSettle(_d: DragonCharacter, _dt: number): void {
    if (!this.fading) this.phase = 'idle';
  }

  /** Run-out state: the pelvis's offset over the ground's standing height (m) and speed, pitch, roll, ground speed. */
  private runH = 0;
  private runVH = 0;
  private runP = 0;
  private runVP = 0;
  private runRoll = 0;
  private runV = 0;

  /**
   * After a running landing: the pelvis, still the flight's (an exact override), eases from its touchdown height and
   * speed to the running height over the ground (standing less runoutCrouch) and its pitch and roll to level, along a
   * cubic that closes offset and speed together; then the springs take it over at rest. The speed he landed with
   * bleeds off over runoutDecel s (held keys can keep it up, never cut it short).
   */
  private stepRunout(d: DragonCharacter, dt: number): void {
    const c = this.cfg;
    const T = Math.max(c.runoutTime, 1e-3);
    const u = clamp(this.t / T, 0, 1);
    const h00 = 2 * u * u * u - 3 * u * u + 1;
    const h10 = u * u * u - 2 * u * u + u;
    const ground = d.kin.pos.y + d.body.hipHeight - c.runoutCrouch * smoothstep(0, 1, u);
    const o = d.body.override;
    o.active = true;
    o.exact = true;
    o.snap = false;
    o.height = ground + this.runH * h00 + this.runVH * T * h10;
    o.pitch = this.runP * h00 + this.runVP * T * h10;
    o.roll = this.runRoll * h00;
    o.bob = smoothstep(0, 1, u);                                   // the running cycles' bob comes back in with the ground
    d.intent.speed = Math.max(d.intent.speed, this.runV * (1 - smoothstep(0, c.runoutDecel, this.t)));
    if (u >= 1) {
      this.release(d);
      this.phase = 'idle';
    }
  }

  // ---- shared -------------------------------------------------------------------------------------------------------

  /** Place the body: the pelvis at height h (world) with the pitch and roll, the origin at the path's (x, z). */
  private place(d: DragonCharacter, h: number, pitch: number, roll: number, dt: number): void {
    const c = this.cfg;
    if (this.pendingCarry) {
      // where the old placement was heading this step (its velocity carried on), minus the new
      this.carryH = this.outH + this.outVH * dt - h;
      this.carryP = this.outP + this.outVP * dt - pitch;
      this.pendingCarry = false;
    }
    const prevH = this.outH;
    const prevP = this.outP;
    const k = 1 - smoothstep(0, c.settle, this.carryT);
    this.carryT += dt;
    this.outH = h + this.carryH * k;
    this.outP = pitch + this.carryP * k;
    this.outVH = (this.outH - prevH) / dt;
    this.outVP = (this.outP - prevP) / dt;
    const o = d.body.override;
    o.active = true;
    o.exact = true;
    o.snap = false;
    o.bob = 0;
    o.height = this.outH;
    o.pitch = this.outP + this.recoilPitch(dt);
    o.roll = roll;
    const kin = d.kin;
    const dx = this.pos.x - kin.pos.x;
    const dz = this.pos.z - kin.pos.z;
    kin.pos.x = this.pos.x;
    kin.pos.z = this.pos.z;
    kin.heading = this.heading;
    kin.yawRate = this.yawRate;
    kin.velocity.set(dx / dt, 0, dz / dt);
    kin.speed = Math.hypot(dx, dz) / dt;
  }

  /** Keep the pelvis where it is across a change of placement: the old minus the new is carried and eased out. */
  private handoff(): void {
    this.carryH = 0;
    this.carryP = 0;
    this.carryT = 0;
    this.pendingCarry = true;
  }

  private pendingCarry = false;

  /** Hand the body back to the ground motion: the paws re-seated under him, nothing scripted left. */
  private finishScripted(d: DragonCharacter): void {
    d.resetFeet();
    this.release(d);
  }

  private release(d: DragonCharacter): void {
    d.mods.scripted = false;
    d.climb.suspended = false;
    d.planner.autoStep = true;
    d.body.override.active = false;
    d.body.override.exact = false;
    d.body.override.snap = false;
    d.body.override.roll = 0;
    d.body.override.bob = 0;
    d.wings.liftScale = 1;
  }

  private fadeOut(name: string, from: number, time = this.cfg.handoff, clipT = this.clipT): void {
    if (this.fading && this.fading !== name) this.fadingDone();
    this.fading = name;
    this.fadeW = from;
    this.fadeTime = time;
    this.fadeClipT = clipT;
  }

  /** The fading clip's layer weight: its linear fade eased (smoothstep), so the clip under it fades in kink-free. */
  private get fadeWeight(): number {
    return this.fading ? smoothstep(0, 1, this.fadeW) : 0;
  }

  private fadeTime = 0.5;
  private fadeClipT = 0;

  private fadingDone(): void {
    this.fading = null;
  }

  private fade(d: DragonCharacter, dt: number): void {
    if (!this.fading) return;
    this.fadeW -= dt / Math.max(this.fadeTime, 1e-3);
    const m = this.meta(d, this.fading);
    const dur = m ? (m.height.length - 1) / FPS : 0;
    this.fadeClipT = Math.min(dur, this.fadeClipT + dt);
    if (this.fadeW <= 0) {
      d.layers.set(this.fading, 0);
      this.fading = null;
      if (!this.airborne) d.wings.liftScale = 1;
      return;
    }
    d.layers.set(this.fading, this.fadeWeight, this.fadeClipT, false, ORDER);
    if (!this.airborne) d.wings.liftScale = 1 - this.fadeWeight;
  }

  /** The highest ground under the body (m), from the hips to the muzzle. */
  private groundBelow(d: DragonCharacter): number {
    let best = -Infinity;
    for (const off of [-1.2, 0, 1.6]) {
      const x = this.pos.x + Math.sin(this.heading) * off;
      const z = this.pos.z + Math.cos(this.heading) * off;
      const g = d.world.groundAt(x, z, this.pos.y + 1, 200, _hit);
      if (g) best = Math.max(best, g.point.y);
    }
    return Number.isFinite(best) ? best : this.pos.y - 100;
  }

  /** Pelvis height over the highest ground along the path ahead (clearLookahead s), straight down at each probe. */
  private clearanceAhead(d: DragonCharacter): number {
    const c = this.cfg;
    let low = Infinity;
    for (const f of [0.25, 0.5, 1]) {
      const s = this.speed * c.clearLookahead * f;
      const x = this.pos.x + Math.sin(this.heading) * s;
      const z = this.pos.z + Math.cos(this.heading) * s;
      const y = this.pos.y + Math.sin(this.gamma) * s;
      const g = d.world.groundAt(x, z, y + 30, 230, _hit);
      if (g) low = Math.min(low, y - g.point.y);
    }
    return Number.isFinite(low) ? low : 100;
  }
}
