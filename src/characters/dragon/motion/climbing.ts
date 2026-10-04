import * as THREE from 'three';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import type { DragonCharacter } from './dragon';
import type { GaitMods } from './gait';
import { LEG_KEYS, isFrontLeg } from './rigTypes';
import type { MotionTuning } from './tuning';
import { angleDiff, clamp, dampFactor, deg, lerp, rotY, smoothstep } from './math';

type ClimbTuning = MotionTuning['climb'];
type ScrambleTuning = MotionTuning['scramble'];
export type ClimbMode = 'ground' | 'climb' | 'scramble' | 'blocked' | 'hop';

/** A swinging forepaw's take-off contact and landing target, and whether the planner found a foothold for it. */
export interface ClimbLanding {
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly found: boolean;
}

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
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
}

function bezier1(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return a * u * u * u + 3 * b * u * u * t + 3 * c * u * t * t + d * t * t * t;
}

/** When (swing progress) a climbing paw path is at its peak and crossing over the lip, and when it starts down. */
interface PathTiming {
  /** Up to the peak and in to the face by here; then over the lip until `cross`. */
  rise: number;
  cross: number;
  /** Down on to the spot from here. */
  drop: number;
}

/**
 * Wall-frame point (x lateral, y above the base, z from the face) at progress s of a paw path from `from` to `to` on the
 * top: it rises in front of the face (never closer than `gap`) to `peak`, crosses over the lip, and comes down on `to`.
 * It is above the lip whenever it is over the top: the crossing starts only at the peak.
 */
function climbPath(from: THREE.Vector3, to: THREE.Vector3, peak: number, gap: number, k: PathTiming, s: number, out: THREE.Vector3): THREE.Vector3 {
  const z = lerp(lerp(from.z, -gap, smoothstep(0, k.rise, s)), to.z, smoothstep(k.rise, k.cross, s));
  const y = lerp(lerp(from.y, peak, smoothstep(0, k.rise, s)), to.y, smoothstep(k.drop, 1, s));
  return out.set(lerp(from.x, to.x, smoothstep(0, 1, s)), y, z);
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
  private readonly hopVel = new THREE.Vector3();
  private hopY0 = 0;
  private hopVy = 0;
  /** Hop: each paw's sole relative to the body origin (body frame) at take-off, in flight and at touchdown. */
  private readonly hopLaunch = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly hopFlight = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly hopLand = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly hopLandNormal = [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0));
  /** Hop: when the gather into the flight pose ends and the reach for the landing starts (s into the hop). */
  private hopGatherEnd = 0;
  private hopReachStart = 0;
  /** Scramble: the wall frame's origin (on the face at the base's height, in line with the body) and heading. */
  private readonly wallO = new THREE.Vector3();
  private wallHeading = 0;
  private scrHeading0 = 0;
  /** Scramble key poses of the pelvis in the wall frame (y above the base, z from the face; x unused) and their pitches. */
  private readonly kStart = new THREE.Vector3();
  private readonly kHook = new THREE.Vector3();
  private readonly kOver = new THREE.Vector3();
  private readonly kEnd = new THREE.Vector3();
  private pitchStart = 0;
  private pitchHook = 0;
  private pitchOver = 0;
  /** Paws the scramble carries along its own paths (wall frame), and the path timing of each. */
  private readonly pathFrom = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly pathTo = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly pathOn = [false, false, false, false];
  private readonly foreTiming: PathTiming = { rise: 0, cross: 0, drop: 0 };
  private readonly hindTiming: PathTiming = { rise: 0, cross: 0, drop: 0 };
  private readonly pathTiming: PathTiming[] = [this.foreTiming, this.foreTiming, this.foreTiming, this.foreTiming];
  private readonly spotNormal = [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0));
  /** The rig's body frame (attach): the shoulder joint and the hip joint relative to the pelvis head, standing shoulder height. */
  private readonly shoulderRel = new THREE.Vector2();
  private readonly hipRel = new THREE.Vector2();
  private shoulderH = 0;
  /** How far the forepaws stand ahead of the character origin at bind (m); set by attach(). */
  private forepawAhead = 0;
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
  private readonly landings: ClimbLanding[] = [];

  /** `frontExtent`: how far the body proxies reach ahead of the character origin at bind (m). */
  constructor(
    private readonly world: CollisionWorld, private readonly c: ClimbTuning, private readonly sc: ScrambleTuning,
    readonly frontExtent: number, private readonly stepMax: number,
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
    // the body frame at bind: joints relative to the pelvis head as (z forward, y up)
    const pelvisZ = d.body.pelvisOffset.z;
    const pelvisY = d.body.hipHeight + (d.planner.neutral[0].y + d.planner.neutral[2].y) / 2;
    const joint = new THREE.Vector3();
    let sz = 0;
    let sy = 0;
    let hz = 0;
    let hy = 0;
    for (let i = 0; i < 4; i++) {
      d.legs.hip(i, d.skeleton, joint);
      if (isFrontLeg(LEG_KEYS[i])) {
        sz += (joint.z - pelvisZ) / 2;
        sy += (joint.y - pelvisY) / 2;
      } else {
        hz += (joint.z - pelvisZ) / 2;
        hy += (joint.y - pelvisY) / 2;
      }
    }
    this.shoulderRel.set(sz, sy);
    this.hipRel.set(hz, hy);
    this.shoulderH = pelvisY + sy - (d.planner.neutral[1].y + d.planner.neutral[3].y) / 2;
    d.hooks.beforeMove.push((dragon, dt) => this.step(dragon, dt));
  }

  /**
   * `wallHeading`: direction of the wall probes — the intent direction while moving, so a wall he slides along stays
   * detected. `forepaws`: the forepaws' contacts (the drop probes sit just ahead of each); without them, no drop is read.
   * `landings`: swinging forepaws' take-off contacts and landing targets: at speed a paw can lift short of an edge and
   * swing out over it, so a drop is also read under a target that found no foothold at all (`found` false) and hangs
   * in the air. A found target is on its ground (a slope, a tread), however far below the take-off, even while the
   * blended target on its way there hangs above it.
   */
  sense(
    pos: THREE.Vector3, heading: number, forepawY: number, wallHeading = heading, forepaws?: readonly THREE.Vector3[],
    landings?: readonly ClimbLanding[],
  ): ClimbProbe {
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
    for (const contact of forepaws ?? []) this.readDrop(contact, contact.x + fx * c.dropAhead, contact.z + fz * c.dropAhead);
    for (const l of landings ?? []) if (!l.found) this.readDrop(l.from, l.to.x, l.to.z, l.to.y - c.dropMin);
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

  /**
   * The ground at (x, z), probed from well above `contact` (see sense): a drop below the contact deeper than any so far
   * is kept, when the ground lies below `under` too.
   */
  private readDrop(contact: THREE.Vector3, x: number, z: number, under = Infinity): void {
    const p = this.probe;
    _o.set(x, contact.y + this.c.ledgeMax + 0.4, z);
    if (this.world.isInside(_o) || !this.world.groundAt(_o.x, _o.z, _o.y, 99, _hit) || _hit.point.y >= under) return;
    if (contact.y - _hit.point.y > p.drop) {
      p.drop = contact.y - _hit.point.y;
      p.dropPoint.copy(_hit.point);
    }
  }

  /** Raise the probe's slope to the steepest climbable surface under a paw (a swinging paw counts where it took off). */
  private steepestContact(d: DragonCharacter, p: ClimbProbe): void {
    for (const paw of d.planner.paws) {
      const n = paw.planted ? paw.normal : paw.fromNormal;
      const slope = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, n.y)));
      if (slope > p.slopeDeg && slope <= this.c.wallMinDeg) {
        p.slopeDeg = slope;
        p.slopeNormal.copy(n);
      }
    }
  }

  /** The swinging forepaws' landings (see sense). */
  private forepawLandings(d: DragonCharacter): ClimbLanding[] {
    this.landings.length = 0;
    for (const i of [1, 3]) {
      const paw = d.planner.paws[i];
      if (!paw.planted) this.landings.push({ from: paw.from, to: paw.to, found: paw.targetFound });
    }
    return this.landings;
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
    const p = this.sense(d.kin.pos, d.kin.heading, forepawY, moving ? Math.atan2(i.dirX, i.dirZ) : d.kin.heading, this.forepawContacts(d), this.forepawLandings(d));
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
      if (p.drop <= c.dropMax && this.startHop(d, dt)) return;
      // too far down to jump, or nowhere to land: he stops at the edge, still free to turn and walk along it
      if (i.dirX * Math.sin(d.kin.heading) + i.dirZ * Math.cos(d.kin.heading) > 0.3) i.speed = 0;
    }
    // cresting a face, the probes ahead already see the top while his paws are still on the face: once climbing, he
    // climbs on until every paw is off it
    if (this.climbWeight > 0.5) this.steepestContact(d, p);
    const climbing = p.slopeDeg > c.climbMinDeg && p.slopeDeg <= c.wallMinDeg;
    this.mode = climbing ? 'climb' : 'ground';
    // footholds are searched along an up axis half-way between world up and the body's own (spec §6.6): it tilts as
    // the body pitches on to the face, not when the face first comes in sight (on the floor before a face, an axis
    // tilted to it would put each paw half a metre ahead of its shoulder)
    if (climbing) this.climbUp.set(0, 1, 0).applyQuaternion(d.body.pose.bodyQuat).add(UP).normalize();
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
    d.body.override.exact = false;
    if (d.layers.has('wingFold')) d.layers.set('wingFold', 1, 1);
  }

  /**
   * Scramble-up (spec §6.6), in three phases:
   * 1. leap to the hook: the body rears into the hook pose (shoulders in front of the face, below the lip), the hind
   *    paws leap under the hips, the forepaws climb in front of the face and come down on the lip;
   * 2. pull-up: hanging from the forepaws, the body rises along the face and rolls over the lip at a pitch that keeps
   *    its chest and belly clear of it; the hind paws scrabble up the face and onto the top;
   * 3. the forepaws step on to their stance and the body levels out on the top.
   * Every planted paw stays within reach of its joint by construction, and every path clears the wall.
   */
  private startScramble(d: DragonCharacter): void {
    const p = this.probe;
    const c = this.c;
    const S = this.sc;
    this.mode = 'scramble';
    this.t = 0;
    this.stage = 0;
    this.duration = c.scrambleTime;
    this.fwd.set(-p.wallNormal.x, 0, -p.wallNormal.z).normalize();
    this.lat.crossVectors(UP, this.fwd);
    this.wallHeading = Math.atan2(this.fwd.x, this.fwd.z);
    this.scrHeading0 = d.kin.heading;
    d.kin.speed = 0;
    d.kin.velocity.set(0, 0, 0);
    const base = this.forepawY(d);
    const H = p.ledgeTop.y - base;
    this.wallO.copy(d.kin.pos).addScaledVector(this.fwd, _t.subVectors(p.wallPoint, d.kin.pos).dot(this.fwd)).setY(base);
    // key poses of the pelvis (wall frame)
    this.toWall(d.body.pose.pelvisPos, this.kStart);
    this.pitchStart = d.body.pose.pitch;
    // hook: the shoulders above the lip and in front of the face, the forepaws reaching down on to the top. The body
    // pitches up until the pelvis would drop below standing height (a low wall), at most maxPitchDeg; above that the
    // pelvis is in the air (a high wall: the hind paws scrabble at the face)
    const R = this.shoulderRel.length();
    const delta = Math.atan2(this.shoulderRel.y, this.shoulderRel.x);
    const shoulderY = H + S.hookUp;
    this.pitchHook = clamp(Math.asin(clamp((shoulderY - d.body.hipHeight) / R, -1, 1)) - delta, 0, deg(S.maxPitchDeg));
    this.kHook.set(0, shoulderY - this.bodyY(this.shoulderRel, this.pitchHook), -S.hookBack - this.bodyZ(this.shoulderRel, this.pitchHook));
    this.kOver.set(0, H + S.overUp, S.overBack);
    this.pitchOver = deg(S.overPitchDeg);
    this.kEnd.set(0, H + d.body.hipHeight, c.scrambleLand + d.body.pelvisOffset.z);
    // the paws leave the ground together: the forepaws climb to the lip, the hind paws scrabble up the face and come
    // down on their stance on the top once the hips are over it
    const T = this.duration;
    this.foreTiming.rise = S.foreRise;
    this.foreTiming.cross = S.foreCross;
    this.foreTiming.drop = S.foreDrop;
    this.hindTiming.rise = S.hindRise;
    this.hindTiming.cross = S.hindCross;
    this.hindTiming.drop = S.hindDrop;
    for (let i = 0; i < 4; i++) {
      const front = isFrontLeg(LEG_KEYS[i]);
      this.spot(i, d.planner.neutral[i].x, front ? c.scrambleGrip : c.scrambleLand + d.planner.neutral[i].z, H, _t);
      this.toWall(d.planner.swingPoint(i, _o), this.pathFrom[i]);
      this.pathTo[i].copy(_t);
      this.pathTiming[i] = front ? this.foreTiming : this.hindTiming;
      this.pathOn[i] = true;
      d.planner.forceStep(i, this.fromWall(_t, _o), this.spotNormal[i], (front ? S.leapEnd : S.hindLand) * T, 0);
    }
  }

  private stepScramble(d: DragonCharacter, dt: number): void {
    const c = this.c;
    this.t = Math.min(this.t + dt, this.duration);
    const T = this.duration;
    const tau = this.t / T;
    const S = this.sc;
    d.mods.scripted = true;
    d.planner.autoStep = false;
    // the body; the heading turns square to the wall during the leap
    const pitch = this.scramblePose(tau, _p);
    d.kin.heading = tau < S.leapEnd ? this.scrHeading0 + angleDiff(this.scrHeading0, this.wallHeading) * smoothstep(0, S.leapEnd, tau) : this.wallHeading;
    this.fromWall(_p, _o); // pelvis (world)
    rotY(d.body.pelvisOffset, d.kin.heading, _t);
    d.kin.pos.set(_o.x - _t.x, _o.y, _o.z - _t.z);
    d.body.override.active = true;
    d.body.override.exact = true;
    d.body.override.height = _o.y;
    d.body.override.pitch = pitch;
    // the forepaws step twice: on to the top under the shoulders as they come over the lip, then on to their stance
    const H = this.kOver.y - S.overUp;
    if ((this.stage === 0 && tau >= S.foreStep1) || (this.stage === 1 && tau >= S.foreStep2)) {
      const first = this.stage === 0;
      const end = first ? S.foreStep1End : S.stepEnd;
      const endPitch = this.scramblePose(end, _a);
      const under = _a.z + this.bodyZ(this.shoulderRel, endPitch); // the shoulders' place at touchdown
      for (const i of [1, 3]) {
        const z = first ? Math.max(under, c.scrambleGrip) : c.scrambleLand + d.planner.neutral[i].z;
        this.spot(i, d.planner.neutral[i].x, z, H, _t);
        d.planner.forceStep(i, this.fromWall(_t, _o), this.spotNormal[i], (end - tau) * T, S.stepLift);
      }
      this.stage++;
    }
    // the paws on paths of the scramble's own, at the progress the planner gives their swings this step
    for (let i = 0; i < 4; i++) {
      const paw = d.planner.paws[i];
      if (!this.pathOn[i]) continue;
      if (paw.planted) {
        this.pathOn[i] = false;
        continue;
      }
      const s = Math.min(1, paw.s + dt / paw.duration);
      climbPath(this.pathFrom[i], this.pathTo[i], H + S.clear, S.clear, this.pathTiming[i], s, _t);
      _n.copy(UP).lerp(this.spotNormal[i], smoothstep(this.pathTiming[i].drop, 1, s)).normalize();
      d.planner.carry(i, this.fromWall(_t, _o), _n);
    }
    // the last step stays scripted (the paws plant on their spots); ordinary locomotion resumes next step
    if (this.t >= T) this.mode = 'ground';
  }

  /**
   * The pelvis (wall frame) and pitch at scramble progress `tau`: the leap to the hook (the head rises first), the
   * pull-up (up the face first, then over the lip), then on to the stance on the top.
   */
  private scramblePose(tau: number, out: THREE.Vector3): number {
    const S = this.sc;
    if (tau <= S.leapEnd) {
      const s = tau / S.leapEnd;
      out.lerpVectors(this.kStart, this.kHook, smoothstep(0, 1, s));
      out.y += S.leapUp * Math.sin(Math.PI * s);
      return lerp(this.pitchStart, this.pitchHook, smoothstep(0, S.pitchLead, s));
    }
    if (tau <= S.pullEnd) {
      const s = smoothstep(S.leapEnd, S.pullEnd, tau);
      _c1.set(0, this.kHook.y + S.pullRise * (this.kOver.y - this.kHook.y), this.kHook.z + S.pullAhead);
      _c2.set(0, this.kOver.y, this.kOver.z - S.overReach);
      bezier(this.kHook, _c1, _c2, this.kOver, s, out);
      return bezier1(this.pitchHook, this.pitchHook + deg(S.pullPitchDeg), this.pitchOver + deg(S.overPitchLeadDeg), this.pitchOver, s);
    }
    const s = smoothstep(S.pullEnd, 1, tau);
    out.lerpVectors(this.kOver, this.kEnd, s);
    return lerp(this.pitchOver, 0, s);
  }

  /** World point → wall frame (x along lat, y above the base, z from the face). */
  private toWall(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    _d.subVectors(p, this.wallO);
    return out.set(_d.dot(this.lat), _d.y, _d.dot(this.fwd));
  }

  /** Wall frame → world point. */
  private fromWall(w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.wallO).addScaledVector(this.lat, w.x).addScaledVector(this.fwd, w.z).setY(this.wallO.y + w.y);
  }

  /** How far forward of the pelvis (m) a joint at body-frame `rel` (z, y) lies, at `pitch`. */
  private bodyZ(rel: THREE.Vector2, pitch: number): number {
    return rel.x * Math.cos(pitch) - rel.y * Math.sin(pitch);
  }

  /** How far above the pelvis (m) a joint at body-frame `rel` (z, y) lies, at `pitch`. */
  private bodyY(rel: THREE.Vector2, pitch: number): number {
    return rel.x * Math.sin(pitch) + rel.y * Math.cos(pitch);
  }

  /** A paw spot at wall-frame (x, ·, z) on the ground there (searched from above the top at height `top`); its normal → spotNormal[i]. */
  private spot(i: number, x: number, z: number, top: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(x, top, z);
    this.fromWall(out, _o);
    const g = this.world.groundAt(_o.x, _o.z, this.wallO.y + top + 1, top + 3, _hit);
    this.spotNormal[i].copy(g ? _hit.normal : UP);
    return out.set(x, g ? _hit.point.y - this.wallO.y : 0, z);
  }

  /**
   * Hop down (spec §6.6): a ballistic leap. The forward speed is at least climb.hopSpeed; the launch speed upward is the
   * least (≥ hopUpSpeed) that gets the hind paws, drawn up by hopTuck, hopClear past the edge before they would sink
   * below it. Every paw is carried with the body: from its take-off contact into the flight pose (hopGather), then
   * down to its landing spot under the neutral stance at touchdown (hopReach).
   */
  private startHop(d: DragonCharacter, dt: number): boolean {
    const c = this.c;
    const h = d.kin.heading;
    this.fwd.set(Math.sin(h), 0, Math.cos(h));
    this.p0.copy(d.kin.pos);
    this.hopY0 = d.kin.pos.y;
    let behind = 0;
    for (let i = 0; i < 4; i++) {
      rotY(d.planner.swingPoint(i, _t).sub(this.p0), -h, this.hopLaunch[i]);
      if (!isFrontLeg(LEG_KEYS[i])) behind = Math.max(behind, -this.hopLaunch[i].z);
      this.hopFlight[i].copy(d.planner.neutral[i]);
      if (!isFrontLeg(LEG_KEYS[i])) this.hopFlight[i].y += c.hopTuck;
    }
    // the edge lies before the drop point (read just ahead of a forepaw, or under a landing target further on)
    const edge = this.edgeAhead(this.p0, h, this.forepawY(d), Math.max(this.forepawAhead + c.dropAhead, _t.subVectors(this.probe.dropPoint, this.p0).dot(this.fwd)));
    // he leaps no slower than hopSpeed, and further (up to hopSpeedMax) until all four paws land within a step of each
    // other: over a gap, not into it
    const v0 = Math.max(d.kin.velocity.dot(this.fwd), c.hopSpeed);
    const tries = 6;
    let clearTime = 0;
    let landY = this.probe.dropPoint.y;
    let found = false;
    for (let k = 0; k <= tries && !found; k++) {
      const along = v0 + (Math.max(c.hopSpeedMax - v0, 0) * k) / tries;
      clearTime = (edge + behind + c.hopClear) / along; // the hind paws are hopClear past the edge
      this.hopVy = this.launchSpeed(clearTime);
      this.hopVel.copy(this.fwd).multiplyScalar(along);
      landY = this.landing(d, clearTime, this.probe.dropPoint.y);
      let lo = Infinity;
      let hi = -Infinity;
      for (const spot of this.hopLand) {
        lo = Math.min(lo, spot.y);
        hi = Math.max(hi, spot.y);
      }
      found = hi - lo <= this.stepMax;
    }
    if (!found) return false;
    this.mode = 'hop';
    this.t = 0;
    _p.copy(this.p0).addScaledVector(this.hopVel, this.duration).setY(landY);
    for (let i = 0; i < 4; i++) rotY(this.hopLand[i].sub(_p), -h, this.hopLand[i]);
    // the gather and the reach never overlap, and the hind paws stay drawn up until they are past the edge
    this.hopGatherEnd = Math.min(c.hopGather, this.duration / 2);
    this.hopReachStart = Math.max(this.duration - c.hopReach, this.duration / 2, Math.min(clearTime, this.duration));
    d.kin.speed = this.hopVel.length();
    d.kin.velocity.copy(this.hopVel);
    for (let i = 0; i < 4; i++) d.planner.forceStep(i, d.planner.swingPoint(i, _t), UP, this.duration, 0);
    this.stepHop(d, dt); // the take-off step: in step with the swings the planner advances next
    return true;
  }

  /**
   * The hop's flight time and landing spots (world, in hopLand) for the launch in hopVy/hopVel; returns the landing
   * height. The spots depend on the flight time, and the flight time on their height: both settle in a few passes.
   * The flight lasts until the hind paws are past the edge and have reached for the landing (a fall shorter than the
   * hind paws' tuck would land them sooner): the launch speed rises to make it last.
   */
  private landing(d: DragonCharacter, clearTime: number, landY: number): number {
    const c = this.c;
    for (let pass = 0; pass < 3; pass++) {
      const fall = Math.max(0, this.hopY0 - landY);
      this.duration = (this.hopVy + Math.sqrt(this.hopVy * this.hopVy + 2 * GRAVITY * fall)) / GRAVITY;
      const least = clearTime + c.hopReach;
      if (this.duration < least) {
        this.hopVy = (0.5 * GRAVITY * least * least - fall) / least;
        this.duration = least;
      }
      _p.copy(this.p0).addScaledVector(this.hopVel, this.duration);
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        rotY(d.planner.neutral[i], d.kin.heading, _t).add(_p);
        const g = this.world.groundAt(_t.x, _t.z, this.hopY0 + 1, fall + 3, _hit);
        this.hopLand[i].set(_t.x, g ? _hit.point.y : landY, _t.z);
        this.hopLandNormal[i].copy(g ? _hit.normal : UP);
        sum += this.hopLand[i].y;
      }
      landY = sum / 4;
    }
    return landY;
  }

  /** The least upward launch speed (≥ hopUpSpeed) that keeps the drawn-up hind paws above the take-off level until `clearTime`. */
  private launchSpeed(clearTime: number): number {
    const c = this.c;
    let vy = c.hopUpSpeed;
    for (let k = 1; k <= 24; k++) {
      const t = (clearTime * k) / 24;
      vy = Math.max(vy, (0.5 * GRAVITY * t * t - c.hopTuck * smoothstep(0, c.hopGather, t)) / t);
    }
    return vy;
  }

  private stepHop(d: DragonCharacter, dt: number): void {
    const c = this.c;
    this.t = Math.min(this.t + dt, this.duration);
    const t = this.t;
    const T = this.duration;
    d.mods.scripted = true;
    d.planner.autoStep = false;
    const y = this.hopY0 + this.hopVy * t - 0.5 * GRAVITY * t * t;
    d.kin.pos.set(this.p0.x + this.hopVel.x * t, y, this.p0.z + this.hopVel.z * t);
    d.body.override.active = true;
    d.body.override.exact = true;
    d.body.override.height = y + d.body.hipHeight;
    d.body.override.pitch = -deg(c.hopPitchDeg) * Math.sin((Math.PI * t) / T);
    const gather = smoothstep(0, this.hopGatherEnd, t);
    const reach = smoothstep(this.hopReachStart, T, t);
    for (let i = 0; i < 4; i++) {
      _t.lerpVectors(this.hopLaunch[i], this.hopFlight[i], gather).lerp(this.hopLand[i], reach);
      rotY(_t, d.kin.heading, _t).add(d.kin.pos);
      _o.copy(UP).lerp(this.hopLandNormal[i], reach).normalize();
      d.planner.carry(i, _t, _o);
    }
    // touchdown: the swings end this step and plant every paw on its spot. Ordinary locomotion resumes next step,
    // and the fall speed carries into the body's height spring as the landing absorb.
    if (t >= T) this.mode = 'ground';
  }
}
