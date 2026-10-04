import * as THREE from 'three';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import type { DragonCharacter } from './dragon';
import type { GaitMods } from './gait';
import type { MotionTuning } from './tuning';
import { dampFactor, deg, lerp, rotY, smoothstep } from './math';

type ClimbTuning = MotionTuning['climb'];
export type ClimbMode = 'ground' | 'climb' | 'scramble' | 'blocked' | 'hop';

export interface ClimbProbe {
  slopeDeg: number;
  readonly slopeNormal: THREE.Vector3;
  wall: boolean;
  /** Horizontal distance from the character origin to the wall face. */
  wallDist: number;
  readonly wallPoint: THREE.Vector3;
  /** Horizontal wall normal, pointing away from the wall. */
  readonly wallNormal: THREE.Vector3;
  /** The wall is only a step (its riser, top minus the ground at its foot, ≤ the planner's max step-up): walk up it. */
  step: boolean;
  ledge: boolean;
  ledgeHeight: number;
  readonly ledgeTop: THREE.Vector3;
  /** How far the ground ahead lies below the forepaw support (m; 0 when it rises — the probe starts inside it — or there is none). */
  drop: number;
  readonly dropPoint: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const GRAVITY = 9.81;
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
}

/** Spec §6.6 climbing rules, run before each step's kinematics (DragonCharacter.hooks.beforeMove). */
export class ClimbController {
  mode: ClimbMode = 'ground';
  t = 0;
  readonly probe: ClimbProbe = {
    slopeDeg: 0, slopeNormal: new THREE.Vector3(0, 1, 0), wall: false, wallDist: Infinity, wallPoint: new THREE.Vector3(),
    wallNormal: new THREE.Vector3(), step: false, ledge: false, ledgeHeight: 0, ledgeTop: new THREE.Vector3(), drop: 0, dropPoint: new THREE.Vector3(),
  };
  private duration = 0;
  private stage = 0;
  private readonly fwd = new THREE.Vector3();
  private readonly lat = new THREE.Vector3();
  private readonly p0 = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();
  private readonly p3 = new THREE.Vector3();
  private readonly hopVel = new THREE.Vector3();
  private hopY0 = 0;
  private hopVy = 0;
  /** How far the forepaws stand ahead of the character origin at bind (m); set by attach(). */
  private forepawAhead = 0;
  /** How far the rearmost paws stand behind it (m, positive). */
  private hindBehind = 0;
  /** Neutral sole positions in the character frame (the planner's), set by attach(). */
  private neutral: readonly THREE.Vector3[] = [];
  /**
   * How far climb mode's settings apply (0–1). It eases toward 1 on a climbable slope and back to 0 off it
   * (climb.blendTime), so cresting a face never snaps the tilt limit, speed cap, gait or up axis.
   */
  climbWeight = 0;
  private readonly climbUp = new THREE.Vector3(0, 1, 0);
  private readonly gaitMods: GaitMods = { cadenceScale: 1, strideScale: 1, swingScale: 1 };
  private readonly contacts = [new THREE.Vector3(), new THREE.Vector3()];

  /** `frontExtent`: how far the body proxies reach ahead of the character origin at bind (m). */
  constructor(
    private readonly world: CollisionWorld, private readonly c: ClimbTuning, readonly frontExtent: number, private readonly stepMax: number,
  ) {}

  /** Back to ordinary locomotion at once (a respawn): no scripted action, no climb settings. */
  reset(d: DragonCharacter): void {
    this.mode = 'ground';
    this.t = 0;
    this.stage = 0;
    this.climbWeight = 0;
    this.resetMods(d);
  }

  attach(d: DragonCharacter): void {
    this.neutral = d.planner.neutral;
    this.forepawAhead = Math.max(d.planner.neutral[1].z, d.planner.neutral[3].z);
    this.hindBehind = -Math.min(...d.planner.neutral.map((n) => n.z));
    d.hooks.beforeMove.push((dragon, dt) => this.step(dragon, dt));
  }

  /**
   * `wallHeading`: direction of the wall probes — the intent direction while moving, so a wall he slides along stays
   * detected. `forepaws`: the forepaws' contacts (the drop probes sit just ahead of each); without them, no drop is read.
   */
  sense(pos: THREE.Vector3, heading: number, forepawY: number, wallHeading = heading, forepaws?: readonly THREE.Vector3[]): ClimbProbe {
    const p = this.probe;
    const c = this.c;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    _d.set(Math.sin(wallHeading), 0, Math.cos(wallHeading));
    // the steeper of the slope 1.3 m ahead and under the muzzle: a steep face meets his head first, and it must
    // already read as climbable then (climb mode admits it as ground) or the head butts it like a wall
    p.slopeDeg = 0;
    p.slopeNormal.set(0, 1, 0);
    for (const ahead of [1.3, this.frontExtent]) {
      if (!this.world.groundAt(pos.x + fx * ahead, pos.z + fz * ahead, forepawY + 1.5 + ahead, 4 + ahead, _hit)) continue;
      const slope = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, _hit.normal.y)));
      if (slope > p.slopeDeg) {
        p.slopeDeg = slope;
        p.slopeNormal.copy(_hit.normal);
      }
    }
    p.wall = false;
    p.wallDist = Infinity;
    for (const h of [0.35, 0.9]) {
      _o.set(pos.x, forepawY + h, pos.z);
      const hit = this.world.raycast(_o, _d, this.frontExtent + c.probeAhead, _hit);
      if (hit && Math.abs(hit.normal.y) < Math.cos(deg(c.wallMinDeg)) && hit.distance < p.wallDist) {
        p.wall = true;
        p.wallDist = hit.distance;
        p.wallPoint.copy(hit.point);
        p.wallNormal.set(hit.normal.x, 0, hit.normal.z).normalize();
      }
    }
    p.ledge = false;
    p.step = false;
    if (p.wall) {
      // the riser is measured from the ground at its own foot: on stairs the probes can pass over the first step and
      // meet the next riser, whose foot is that step's tread, not the forepaws' level
      _o.copy(p.wallPoint).addScaledVector(p.wallNormal, 0.15);
      const foot = this.world.raycast(_o, DOWN, p.wallPoint.y - forepawY + 0.5, _hit) ? _hit.point.y : forepawY;
      _o.copy(p.wallPoint).addScaledVector(p.wallNormal, -0.35);
      _o.y = forepawY + c.ledgeMax + 0.4;
      if (!this.world.isInside(_o) && this.world.raycast(_o, DOWN, c.ledgeMax + 1, _hit) && _hit.normal.y > 0.8) {
        p.ledgeTop.copy(_hit.point);
        p.ledgeHeight = _hit.point.y - forepawY;
        p.step = _hit.point.y - foot <= this.stepMax;
        p.ledge = !p.step && p.ledgeHeight <= c.ledgeMax && this.roomOnTop(p);
      }
    }
    p.drop = 0;
    // dropAhead in front of each forepaw's own contact, so he hops when a paw reaches the edge. Measured from the
    // contact, a climbable slope falls at most dropAhead·tan(wallMinDeg) over the gap — never a "drop" — where a probe
    // ahead of the neutral stance spans more slope whenever the paws trail it. The ray starts well above the paw: on
    // a steep face a low origin lies under the face (inside it, or in the hollow under a slab) and finds the floor
    // beneath. An origin inside a solid means the ground ahead rises above it.
    for (const contact of forepaws ?? []) {
      _o.set(contact.x + fx * c.dropAhead, contact.y + c.ledgeMax + 0.4, contact.z + fz * c.dropAhead);
      if (this.world.isInside(_o) || !this.world.groundAt(_o.x, _o.z, _o.y, 99, _hit)) continue;
      if (contact.y - _hit.point.y > p.drop) {
        p.drop = contact.y - _hit.point.y;
        p.dropPoint.copy(_hit.point);
      }
    }
    return p;
  }

  /**
   * The ledge top has room for him: flat ground at the top's height under all four paws where the scramble lands them
   * (a boulder's rounded top passes the flat spot behind its lip but has no room for a dragon).
   */
  private roomOnTop(p: ClimbProbe): boolean {
    _d.set(-p.wallNormal.x, 0, -p.wallNormal.z);
    const heading = Math.atan2(_d.x, _d.z);
    for (const n of this.neutral) {
      rotY(n, heading, _t).add(p.wallPoint).addScaledVector(_d, this.c.scrambleLand);
      _o.set(_t.x, p.ledgeTop.y + 0.5, _t.z);
      if (this.world.isInside(_o) || !this.world.raycast(_o, DOWN, 1, _hit)) return false;
      if (_hit.normal.y < 0.8 || Math.abs(_hit.point.y - p.ledgeTop.y) > this.c.topFlatness) return false;
    }
    return true;
  }

  /** A wall (not a step) faces the direction (dx, dz) within the body's reach of `pos`, at the wall-probe heights. */
  private wallAlong(pos: THREE.Vector3, forepawY: number, dx: number, dz: number): boolean {
    _d.set(dx, 0, dz);
    for (const h of [0.35, 0.9]) {
      _o.set(pos.x, forepawY + h, pos.z);
      const hit = this.world.raycast(_o, _d, this.frontExtent + 0.3, _hit);
      if (hit && Math.abs(hit.normal.y) < Math.cos(deg(this.c.wallMinDeg)) && hit.normal.x * dx + hit.normal.z * dz < -0.5) return true;
    }
    return false;
  }

  /** Distance (m) ahead of `pos` along `heading` where the ground falls away below `forepawY` (bisected up to `far`). */
  private edgeAhead(pos: THREE.Vector3, heading: number, forepawY: number, far: number): number {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const below = forepawY - this.c.dropMin / 2;
    let lo = 0;
    let hi = far;
    for (let it = 0; it < 10; it++) {
      const m = (lo + hi) / 2;
      _o.set(pos.x + fx * m, forepawY + this.c.ledgeMax + 0.4, pos.z + fz * m);
      const dropped = !this.world.isInside(_o) && (!this.world.groundAt(_o.x, _o.z, _o.y, 99, _hit) || _hit.point.y < below);
      if (dropped) hi = m;
      else lo = m;
    }
    return hi;
  }

  /** The forepaws' real contacts (a swinging paw counts where it took off). */
  private forepawContacts(d: DragonCharacter): THREE.Vector3[] {
    for (const [k, i] of [1, 3].entries()) {
      const paw = d.planner.paws[i];
      this.contacts[k].copy(paw.planted ? paw.pos : paw.from);
    }
    return this.contacts;
  }

  /** The lower of the forepaws' real contacts (a swinging paw counts where it took off). */
  private forepawY(d: DragonCharacter): number {
    const a = d.planner.paws[1];
    const b = d.planner.paws[3];
    return Math.min(a.planted ? a.pos.y : a.from.y, b.planted ? b.pos.y : b.from.y);
  }

  step(d: DragonCharacter, dt: number): void {
    if (this.mode === 'scramble') {
      this.stepScramble(d, dt);
      return;
    }
    if (this.mode === 'hop') {
      this.stepHop(d, dt);
      return;
    }
    const c = this.c;
    this.resetMods(d);
    // the lower forepaw: on stairs the two forepaws can stand on different steps
    const forepawY = this.forepawY(d);
    const i = d.intent;
    const moving = i.hasDir && i.speed > 0;
    const p = this.sense(d.kin.pos, d.kin.heading, forepawY, moving ? Math.atan2(i.dirX, i.dirZ) : d.kin.heading, this.forepawContacts(d));
    const into = moving ? i.dirX * p.wallNormal.x + i.dirZ * p.wallNormal.z : 0;
    if (moving && p.wall && !p.step && into < -0.5 && p.wallDist < this.frontExtent + 0.3) {
      if (p.ledge) {
        this.startScramble(d);
        return;
      }
      this.mode = 'blocked';
      let tx = i.dirX - into * p.wallNormal.x;
      let tz = i.dirZ - into * p.wallNormal.z;
      let len = Math.hypot(tx, tz);
      if (len < 0.3) {
        tx = -p.wallNormal.z;
        tz = p.wallNormal.x;
        if (tx * Math.sin(d.kin.heading) + tz * Math.cos(d.kin.heading) < 0) {
          tx = -tx;
          tz = -tz;
        }
        len = 1;
      }
      tx /= len;
      tz /= len;
      if (this.wallAlong(d.kin.pos, forepawY, tx, tz)) {
        // an inside corner: the slide runs into the other wall. He stops there rather than flipping between them.
        i.hasDir = false;
        i.speed = 0;
        return;
      }
      i.dirX = tx;
      i.dirZ = tz;
      i.speed = Math.min(i.speed, c.climbSpeed);
      return;
    }
    if (moving && p.drop > c.dropMin) {
      if (p.drop <= c.dropMax) {
        this.startHop(d);
        return;
      }
      // too far down to jump: he stops at the edge, still free to turn and walk along it
      if (i.dirX * Math.sin(d.kin.heading) + i.dirZ * Math.cos(d.kin.heading) > 0.3) i.speed = 0;
    }
    const climbing = p.slopeDeg > c.climbMinDeg && p.slopeDeg <= c.wallMinDeg;
    this.mode = climbing ? 'climb' : 'ground';
    if (climbing) this.climbUp.copy(UP).lerp(p.slopeNormal, 0.5).normalize();
    this.climbWeight += ((climbing ? 1 : 0) - this.climbWeight) * dampFactor(c.blendTime, dt);
    if (this.climbWeight < 1e-3) return;
    const w = this.climbWeight;
    // the cap holds at once on a climbable face (he brakes before it reaches him) and eases off as he crests it:
    // climbSpeed at full weight, out of the way well before zero
    d.mods.speedCap = (i.gallop ? c.scrambleSpeed : c.climbSpeed) / (climbing ? 1 : w);
    this.gaitMods.cadenceScale = lerp(1, c.cadenceScale, w);
    this.gaitMods.strideScale = lerp(1, c.strideScale, w);
    this.gaitMods.swingScale = lerp(1, c.swingScale, w);
    d.mods.gait = this.gaitMods;
    d.mods.maxTiltDeg = lerp(d.tuning.body.maxTiltDeg, c.maxTiltDeg, w);
    d.mods.up.copy(UP).lerp(this.climbUp, w).normalize();
    d.mods.wallNormalY = lerp(d.tuning.body.wallNormalY, Math.cos(deg(c.wallMinDeg)), w);
    // Ruling 3: the merged fold clip is sampled at the fold amount, so the wings open by easing it below 1
    if (d.layers.has('wingFold')) d.layers.set('wingFold', 1, 1 - c.wingsOpen * w);
  }

  private resetMods(d: DragonCharacter): void {
    d.mods.speedCap = Infinity;
    this.gaitMods.cadenceScale = this.gaitMods.strideScale = this.gaitMods.swingScale = 1;
    d.mods.gait = this.gaitMods;
    d.mods.maxTiltDeg = d.tuning.body.maxTiltDeg;
    d.mods.up.copy(UP);
    d.mods.wallNormalY = d.tuning.body.wallNormalY;
    d.mods.scripted = false;
    d.planner.autoStep = true;
    d.body.override.active = false;
    if (d.layers.has('wingFold')) d.layers.set('wingFold', 1, 1);
  }

  private startScramble(d: DragonCharacter): void {
    const p = this.probe;
    this.mode = 'scramble';
    this.t = 0;
    this.stage = 0;
    this.duration = this.c.scrambleTime;
    this.fwd.set(-p.wallNormal.x, 0, -p.wallNormal.z).normalize();
    this.lat.crossVectors(UP, this.fwd);
    d.kin.heading = Math.atan2(this.fwd.x, this.fwd.z);
    d.kin.speed = 0;
    d.kin.velocity.set(0, 0, 0);
    const top = p.ledgeTop.y;
    this.p0.copy(d.kin.pos);
    this.p1.copy(this.p0).addScaledVector(UP, (top - this.p0.y) * 0.7);
    this.p2.copy(p.wallPoint).addScaledVector(this.fwd, -0.4).setY(top + 0.3);
    this.p3.copy(p.wallPoint).addScaledVector(this.fwd, this.c.scrambleLand).setY(top);
  }

  /** ~0.9 s: body up the curve, nose up; forepaws hook the lip, hind paws follow onto the top, forepaws re-place. */
  private stepScramble(d: DragonCharacter, dt: number): void {
    this.t += dt;
    const tau = Math.min(1, this.t / this.duration);
    bezier(this.p0, this.p1, this.p2, this.p3, smoothstep(0, 1, tau), _p);
    d.mods.scripted = true;
    d.planner.autoStep = false;
    d.kin.pos.x = _p.x;
    d.kin.pos.z = _p.z;
    d.body.override.active = true;
    d.body.override.height = _p.y + d.body.hipHeight;
    d.body.override.pitch = deg(45) * smoothstep(0, 0.3, tau) * (1 - smoothstep(0.55, 1, tau));
    const top = this.probe.ledgeTop.y;
    const lip = (i: number) =>
      _t.copy(this.probe.wallPoint).addScaledVector(this.fwd, 0.12).addScaledVector(this.lat, d.planner.neutral[i].x).setY(top);
    const onTop = (i: number) => rotY(d.planner.neutral[i], d.kin.heading, _t).add(this.p3).setY(top);
    const T = this.duration;
    if (this.stage === 0) {
      d.planner.forceStep(1, lip(1), UP, 0.3 * T, 0.25);
      d.planner.forceStep(3, lip(3), UP, 0.3 * T, 0.25);
      this.stage = 1;
    } else if (this.stage === 1 && tau >= 0.45) {
      d.planner.forceStep(0, onTop(0), UP, 0.35 * T, 0.2);
      d.planner.forceStep(2, onTop(2), UP, 0.35 * T, 0.2);
      this.stage = 2;
    } else if (this.stage === 2 && tau >= 0.7) {
      d.planner.forceStep(1, onTop(1), UP, 0.25 * T, 0.1);
      d.planner.forceStep(3, onTop(3), UP, 0.25 * T, 0.1);
      this.stage = 3;
    }
    if (tau >= 1) {
      this.mode = 'ground';
      d.mods.scripted = false;
      d.planner.autoStep = true;
      d.body.override.active = false;
    }
  }

  private startHop(d: DragonCharacter): void {
    this.mode = 'hop';
    this.t = 0;
    this.hopY0 = d.kin.pos.y;
    this.hopVy = this.c.hopUpSpeed;
    const fall = Math.max(0, this.hopY0 - this.probe.dropPoint.y);
    this.duration = (this.hopVy + Math.sqrt(this.hopVy * this.hopVy + 2 * GRAVITY * fall)) / GRAVITY;
    // carry every paw past the edge: the rearmost lands hopClear beyond it, however slowly he walked off
    const h = d.kin.heading;
    const edge = this.edgeAhead(d.kin.pos, h, this.forepawY(d), this.forepawAhead + this.c.dropAhead);
    const along = Math.max(d.kin.velocity.x * Math.sin(h) + d.kin.velocity.z * Math.cos(h), (edge + this.hindBehind + this.c.hopClear) / this.duration);
    this.hopVel.set(Math.sin(h) * along, 0, Math.cos(h) * along);
    for (let i = 0; i < 4; i++) {
      rotY(d.planner.neutral[i], d.kin.heading, _t).add(d.kin.pos).addScaledVector(this.hopVel, this.duration);
      const g = this.world.groundAt(_t.x, _t.z, this.hopY0 + 1, fall + 3, _hit);
      if (g) _t.y = g.point.y;
      d.planner.forceStep(i, _t, g ? _hit.normal : UP, this.duration, 0.15);
    }
  }

  private stepHop(d: DragonCharacter, dt: number): void {
    this.t += dt;
    d.mods.scripted = true;
    d.planner.autoStep = false;
    d.kin.pos.addScaledVector(this.hopVel, dt);
    const y = this.hopY0 + this.hopVy * this.t - 0.5 * GRAVITY * this.t * this.t;
    d.body.override.active = true;
    d.body.override.height = Math.max(y, this.probe.dropPoint.y) + d.body.hipHeight;
    d.body.override.pitch = -deg(10) * smoothstep(0, 1, this.t / this.duration);
    if (this.t >= this.duration) {
      this.mode = 'ground';
      d.mods.scripted = false;
      d.planner.autoStep = true;
      d.body.override.active = false;
      d.body.impulse(1.5); // landing absorb
    }
  }
}
