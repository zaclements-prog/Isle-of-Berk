import * as THREE from 'three';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import type { GaitEngine } from './gait';
import { LEG_KEYS, type LimbKey, type MotionRig } from './rigTypes';
import type { MotionTuning } from './tuning';
import { clamp, dampFactor, deg, rotY, smoothstep } from './math';

type PlannerTuning = MotionTuning['planner'];

export interface PawState {
  readonly key: LimbKey;
  planted: boolean;
  /** Sole contact point — locked in the world while planted. */
  readonly pos: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly fromNormal: THREE.Vector3;
  readonly toNormal: THREE.Vector3;
  /** Swing progress 0…1 and its duration (s). */
  s: number;
  duration: number;
  /** Peak height of the swing arc above the straight path (m). */
  lift: number;
  forced: boolean;
  justPlanted: boolean;
  justLifted: boolean;
  /** Whether the landing spot passed the foothold checks (slope, edge, step height). */
  targetOk: boolean;
  wasStance: boolean;
  /** Retargeting has stopped and `to` is blending onto `settle`, the surface under it, by touchdown. */
  settled: boolean;
  readonly settle: THREE.Vector3;
  readonly settleNormal: THREE.Vector3;
}

export interface PlannerBody {
  /** Character-frame origin (ground point between the feet). */
  readonly pos: THREE.Vector3;
  readonly heading: number;
  /** Horizontal velocity. */
  readonly velocity: THREE.Vector3;
  readonly yawRate: number;
  /** Body up axis (world up on ordinary ground; tilted while climbing). Footholds are searched along −up. */
  readonly up: THREE.Vector3;
}

export interface Foothold {
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  ok: boolean;
}

/** Where a stepping paw comes from, for slope-aware foothold checks (FootPlanner.project). */
export interface StepContext {
  /** The paw's current contact and its surface normal. */
  readonly from: THREE.Vector3;
  readonly fromNormal: THREE.Vector3;
  /** The leg's hip/shoulder joint (world), or null when unknown. */
  readonly hip: THREE.Vector3 | null;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _down = new THREE.Vector3();
const _target = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _probe: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _foot: Foothold = { point: new THREE.Vector3(), normal: new THREE.Vector3(), ok: false };
const OFFSETS_FULL: ReadonlyArray<[number, number]> = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const OFFSETS_ONE: ReadonlyArray<[number, number]> = [[0, 0]];
const EDGE_DIRS: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Plant/swing state machine for the four paws (spec §6.4). Lift-off comes from the gait phase (stance → swing),
 * or is forced on over-stretch and when standing (one corrective step at a time). Landing target: Raibert placement
 * (predicted body at touchdown + neutral stance + v·T_stance·gain), projected along −up onto real geometry, scored
 * over a few candidates (distance, slope, edges) with > 75° slopes, edges and out-of-reach heights rejected.
 * Swings follow an eased path with a sin(πs) lift raised over obstacles, re-targeting smoothly until late in the swing.
 */
export class FootPlanner {
  readonly paws: PawState[];
  /** Neutral sole positions in the character frame (bind pose), LEG_KEYS order. */
  readonly neutral: THREE.Vector3[];
  /** When false only scripted steps (forceStep) happen: no gait lift-offs, no standing corrections. */
  autoStep = true;
  private readonly envForward = [Infinity, Infinity, Infinity, Infinity];
  private readonly envBackward = [Infinity, Infinity, Infinity, Infinity];
  private readonly hips = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly reach = [Infinity, Infinity, Infinity, Infinity];
  private readonly ctx: Array<{ from: THREE.Vector3; fromNormal: THREE.Vector3; hip: THREE.Vector3 | null }> =
    [0, 1, 2, 3].map(() => ({ from: new THREE.Vector3(), fromNormal: new THREE.Vector3(0, 1, 0), hip: null }));

  constructor(rig: MotionRig, private readonly world: CollisionWorld, private readonly t: PlannerTuning) {
    this.neutral = LEG_KEYS.map((k) => new THREE.Vector3(...rig.contacts[k].sole));
    this.paws = LEG_KEYS.map((key) => ({
      key, planted: true, pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0),
      from: new THREE.Vector3(), to: new THREE.Vector3(), fromNormal: new THREE.Vector3(0, 1, 0), toNormal: new THREE.Vector3(0, 1, 0),
      s: 1, duration: 0.3, lift: 0, forced: false, justPlanted: false, justLifted: false, targetOk: true, wasStance: true,
      settled: false, settle: new THREE.Vector3(), settleNormal: new THREE.Vector3(0, 1, 0),
    }));
  }

  neutralWorld(i: number, pos: THREE.Vector3, heading: number, out: THREE.Vector3): THREE.Vector3 {
    return rotY(this.neutral[i], heading, out).add(pos);
  }

  /** Reachable sole offsets from neutral along the body's forward axis (m), per leg; the landing lead is clamped to 90 %. */
  setEnvelope(forward: readonly number[], backward: readonly number[]): void {
    for (let i = 0; i < 4; i++) {
      this.envForward[i] = forward[i];
      this.envBackward[i] = backward[i];
    }
  }

  /** World hip/shoulder joints (from the last pose) and each leg's max hip→sole distance — the landing reach limit. */
  setLegs(hips: readonly THREE.Vector3[], reach: readonly number[]): void {
    for (let i = 0; i < 4; i++) {
      this.hips[i].copy(hips[i]);
      this.reach[i] = reach[i];
    }
  }

  /**
   * Raibert landing target for a touchdown `remaining` seconds from now (unprojected):
   *   neutral stance under the predicted body (heading at touchdown)
   *   + lead: v·T_stance·gain (linear) and the neutral turned a further yawRate·T_stance·gain (rotational), so the paw
   *     passes neutral mid-stance; the combined lead is clamped in the body frame to 90 % of the leg's fore-aft
   *     envelope and ±sideLead sideways;
   *   then kept within reachFrac of the leg's reach from the predicted hip (lean, crouch and pitch shift the hip),
   *   measured to the real ground under the target: on a side slope the downhill ground is lower than the body's
   *   and the uphill ground higher, so the body's own ground height would let the one paw land out of reach and
   *   pin the other under its shoulder.
   */
  predictTarget(i: number, body: PlannerBody, gait: GaitEngine, remaining: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.t;
    const stance = gait.cadence > 0 ? gait.stanceDuration : 0;
    const heading = body.heading + body.yawRate * remaining;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    rotY(this.neutral[i], heading, out);
    rotY(this.neutral[i], heading + body.yawRate * stance * t.raibertGain, _a).sub(out); // rotational lead
    rotY(body.velocity, body.yawRate * remaining, _c).multiplyScalar(stance * t.raibertGain); // linear lead
    _a.add(_c);
    const along = clamp(_a.x * fx + _a.z * fz, -t.leadEnvelopeFrac * this.envBackward[i], t.leadEnvelopeFrac * this.envForward[i]);
    const side = clamp(_a.x * fz - _a.z * fx, -t.sideLead, t.sideLead);
    out.add(body.pos).addScaledVector(body.velocity, remaining);
    out.x += along * fx + side * fz;
    out.z += along * fz - side * fx;
    if (Number.isFinite(this.reach[i])) {
      // predicted hip: carried with the body and turned about it
      _n.subVectors(this.hips[i], body.pos);
      rotY(_n, body.yawRate * remaining, _n).add(body.pos).addScaledVector(body.velocity, remaining);
      const R = t.reachFrac * this.reach[i];
      // twice: pulling the target in moves it over ground of another height on a slope
      for (let pass = 0; pass < 2; pass++) {
        _c.set(out.x, _n.y + t.castUp, out.z);
        const ground = !this.world.isInside(_c) && this.world.raycast(_c, DOWN, t.castUp + R + t.castDown, _probe);
        const dy = (ground ? _probe.point.y : out.y) - _n.y;
        const dx = out.x - _n.x;
        const dz = out.z - _n.z;
        const h = Math.hypot(dx, dz);
        const hMax = Math.sqrt(Math.max(R * R - dy * dy, 0));
        if (h <= hMax || h < 1e-9) break;
        out.x = _n.x + (dx * hMax) / h;
        out.z = _n.z + (dz * hMax) / h;
      }
    }
    return out;
  }

  /**
   * Best foothold near `target`. `refY` is the current foot height (step-up/down limits). `full` scores five candidates;
   * otherwise only the target itself. Candidates whose cast origin lies inside a solid (walls, slabs, tall blocks) are
   * skipped — a ray started there would find "ground" under the solid. When nothing qualifies, returns the raw target
   * with ok = false.
   *
   * With a `step` context (a paw stepping from a contact):
   * - the rays start above the leg's hip, so on a slope they never start under the ground they look for;
   * - a rise or drop beyond the step limits still passes when the slope of either surface explains it: measured from
   *   the plane of the surface the paw leaves, or from the plane of the foothold's own surface extended back to the
   *   paw. A ramp passes from its foot to its crest; a wall top or a cliff (flat at both ends) does not.
   */
  project(target: THREE.Vector3, body: PlannerBody, full: boolean, refY: number, out: Foothold, step?: StepContext): Foothold {
    const t = this.t;
    _fwd.set(Math.sin(body.heading), 0, Math.cos(body.heading));
    _fwd.addScaledVector(body.up, -_fwd.dot(body.up)).normalize();
    _lat.crossVectors(body.up, _fwd);
    let best = Infinity;
    out.ok = false;
    for (const [f, l] of full ? OFFSETS_FULL : OFFSETS_ONE) {
      _c.copy(target).addScaledVector(_fwd, f * t.candidateOffset).addScaledVector(_lat, l * t.candidateOffset);
      const above = step?.hip ? Math.max(0, _a.subVectors(step.hip, _c).dot(body.up)) : 0;
      if (this.world.isInside(_a.copy(_c).addScaledVector(body.up, t.castUp + above))) continue; // covered by a solid
      if (!this.cast(_c, body.up, _hit, above)) continue;
      const slope = Math.acos(clamp(_hit.normal.dot(WORLD_UP), -1, 1));
      if (slope > deg(t.maxSlopeDeg)) continue;
      if (!this.stepOk(_hit.point.y - refY) && !(step && this.slopeExplains(step, _hit))) continue;
      const edge = this.isEdge(_hit.point, body.up);
      const score = Math.hypot(f, l) * t.candidateOffset + slope * 0.3 + (edge ? 1 : 0);
      if (score < best) {
        best = score;
        out.point.copy(_hit.point);
        out.normal.copy(_hit.normal);
        out.ok = !edge;
      }
    }
    if (best === Infinity) {
      out.point.copy(target);
      out.normal.copy(body.up);
    }
    return out;
  }

  reset(body: PlannerBody): void {
    for (let i = 0; i < 4; i++) {
      const p = this.paws[i];
      this.neutralWorld(i, body.pos, body.heading, _target);
      const f = this.project(_target, body, true, _target.y, _foot);
      p.pos.copy(f.point);
      p.normal.copy(f.normal);
      p.from.copy(p.pos);
      p.to.copy(p.pos);
      p.fromNormal.copy(p.normal);
      p.toNormal.copy(p.normal);
      p.planted = true;
      p.s = 1;
      p.forced = false;
      p.justPlanted = false;
      p.justLifted = false;
      p.targetOk = f.ok;
      p.wasStance = true;
      p.settled = false;
    }
  }

  update(body: PlannerBody, gait: GaitEngine, stretch: readonly number[], dt: number): void {
    const t = this.t;
    let airborne = 0;
    for (const p of this.paws) {
      p.justPlanted = false;
      p.justLifted = false;
      if (!p.planted) airborne++;
    }
    // 1) advance swings, re-targeting toward the moving landing spot until late in the swing
    for (let i = 0; i < 4; i++) {
      const p = this.paws[i];
      if (p.planted) continue;
      if (!p.forced && p.s < t.freezeRetargetAt) {
        this.predictTarget(i, body, gait, (1 - p.s) * p.duration, _target);
        const ctx = this.stepContext(i);
        let f = this.project(_target, body, false, p.from.y, _foot, ctx);
        if (!f.ok) f = this.project(_target, body, true, p.from.y, _foot, ctx);
        const k = dampFactor(t.retargetHalfLife, dt);
        p.to.lerp(f.point, k);
        p.toNormal.lerp(f.normal, k).normalize();
        p.targetOk = f.ok;
      } else if (!p.forced && !p.settled) {
        // retargeting stops: the blended target can hang between footholds on two treads, so settle it onto the
        // surface under it; the rest of the swing blends there and lands exactly on it
        const f = this.project(p.to, body, false, p.from.y, _foot, this.stepContext(i));
        p.settle.copy(f.point);
        p.settleNormal.copy(f.normal);
        p.settled = true;
      }
      const prevS = p.s;
      p.s += dt / p.duration;
      if (p.settled) {
        const k = Math.min(1, (p.s - prevS) / Math.max(1 - prevS, 1e-9));
        p.to.lerp(p.settle, k);
        p.toNormal.lerp(p.settleNormal, k).normalize();
      }
      if (p.s >= 1) {
        p.s = 1;
        p.planted = true;
        p.pos.copy(p.to);
        p.normal.copy(p.toNormal);
        p.justPlanted = true;
        airborne--;
      }
    }
    const stopped = gait.cadence === 0;
    // 2) gait-driven lift-offs on the stance → swing phase transition
    for (let i = 0; i < 4; i++) {
      const p = this.paws[i];
      const stance = gait.inStance(i);
      if (this.autoStep && !stopped && p.planted && !p.justPlanted && p.wasStance && !stance) {
        this.lift(i, body, gait, gait.swingDuration, false);
        airborne++;
      }
      p.wasStance = stance;
    }
    // 3) over-stretch: a planted paw about to leave the leg's reach steps early. While moving this overrides the
    //    airborne limit (a gallop has all-four-off moments anyway, and a slipping paw is worse); standing, it does not.
    for (let i = 0; i < 4; i++) {
      const p = this.paws[i];
      if (!p.planted || p.justPlanted || (stopped && airborne >= t.maxAirborne)) continue;
      if (stretch[i] > t.overstretch) {
        this.lift(i, body, gait, stopped ? t.forcedSwingTime : Math.min(gait.swingDuration, t.overstretchSwingMax), stopped);
        airborne++;
      }
    }
    // 4) standing: one corrective step at a time toward the neutral stance (this also turns him on the spot)
    if (this.autoStep && stopped && airborne === 0) {
      let worst = -1;
      let worstErr = t.forcedStepDist;
      for (let i = 0; i < 4; i++) {
        const p = this.paws[i];
        this.neutralWorld(i, body.pos, body.heading, _a);
        const err = Math.hypot(p.pos.x - _a.x, p.pos.z - _a.z);
        if (err > worstErr) {
          worst = i;
          worstErr = err;
        }
      }
      if (worst >= 0) this.lift(worst, body, gait, t.forcedSwingTime, true);
    }
  }

  /** Scripted step (climbing, M6 actions): lift paw i now — from wherever it is — and land it exactly on `target`. */
  forceStep(i: number, target: THREE.Vector3, normal: THREE.Vector3, duration: number, minLift: number): void {
    const p = this.paws[i];
    this.swingPoint(i, _a);
    this.swingNormal(i, _n);
    p.from.copy(_a);
    p.fromNormal.copy(_n);
    p.planted = false;
    p.forced = true;
    p.s = 0;
    p.duration = Math.max(duration, this.t.minSwingTime);
    p.justLifted = true;
    p.to.copy(target);
    p.toNormal.copy(normal).normalize();
    p.targetOk = true;
    p.settled = false;
    p.lift = this.swingLift(p, minLift);
  }

  /** Current sole position of paw i (its contact while planted, its swing arc otherwise). */
  swingPoint(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.paws[i];
    if (p.planted) return out.copy(p.pos);
    const e = smoothstep(0, 1, p.s);
    out.lerpVectors(p.from, p.to, e);
    this.swingNormal(i, _n);
    return out.addScaledVector(_n, p.lift * Math.sin(Math.PI * p.s));
  }

  swingNormal(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.paws[i];
    if (p.planted) return out.copy(p.normal);
    return out.lerpVectors(p.fromNormal, p.toNormal, smoothstep(0, 1, p.s)).normalize();
  }

  /** Ground height under paw i for the body solver: its contact while planted, its path base while swinging. */
  support(i: number): number {
    const p = this.paws[i];
    return p.planted ? p.pos.y : p.from.y + (p.to.y - p.from.y) * smoothstep(0, 1, p.s);
  }

  private lift(i: number, body: PlannerBody, gait: GaitEngine, duration: number, forced: boolean): void {
    const p = this.paws[i];
    const t = this.t;
    p.planted = false;
    p.forced = forced;
    p.s = 0;
    p.duration = Math.max(duration, t.minSwingTime);
    p.justLifted = true;
    p.from.copy(p.pos);
    p.fromNormal.copy(p.normal);
    if (forced) this.neutralWorld(i, body.pos, body.heading, _target);
    else this.predictTarget(i, body, gait, p.duration, _target);
    const f = this.project(_target, body, true, p.from.y, _foot, this.stepContext(i));
    p.to.copy(f.point);
    p.toNormal.copy(f.normal);
    p.targetOk = f.ok;
    p.settled = false;
    p.lift = this.swingLift(p, forced ? t.forcedLift : gait.swingHeight);
  }

  /**
   * Peak lift (m) of paw p's swing, at least `minLift` and at most planner.maxLift, so that the arc — lift·sin(πs) over
   * the smoothstep-eased path — clears the ground by `clearance`. The path is sampled in swing time (a riser just ahead
   * of the paw meets the arc early, when it is still low), and a riser between two samples is bisected so its lip is
   * cleared too.
   */
  private swingLift(p: PawState, minLift: number): number {
    const t = this.t;
    const top = Math.max(p.from.y, p.to.y) + t.castUp + t.maxStepUp;
    const depth = top - Math.min(p.from.y, p.to.y) + t.castDown;
    let lift = minLift;
    let prevS = 0;
    let prevG = p.from.y;
    for (let k = 1; k < t.swingProbes; k++) {
      const s = k / t.swingProbes;
      const g = this.pathGround(p, s, top, depth);
      lift = Math.max(lift, this.liftNeeded(p, s, g));
      if (Number.isFinite(g) && Number.isFinite(prevG) && Math.abs(g - prevG) > t.edgeDrop) {
        const upper = Math.max(g, prevG);
        const rising = g > prevG; // the upper side is the later one
        let lo = prevS;
        let hi = s;
        for (let it = 0; it < 6; it++) {
          const m = (lo + hi) / 2;
          if ((Math.abs(this.pathGround(p, m, top, depth) - upper) < t.edgeDrop) === rising) hi = m;
          else lo = m;
        }
        lift = Math.max(lift, this.liftNeeded(p, rising ? hi : lo, upper));
      }
      prevS = s;
      prevG = g;
    }
    return Math.min(lift, t.maxLift);
  }

  /** Ground height under paw p's straight (unlifted) swing path at progress s, or −Infinity. */
  private pathGround(p: PawState, s: number, top: number, depth: number): number {
    _c.lerpVectors(p.from, p.to, smoothstep(0, 1, s));
    return this.world.groundAt(_c.x, _c.z, top, depth, _probe) ? _probe.point.y : -Infinity;
  }

  /** Peak lift that puts the arc at progress s above ground height g (clearance tapering with the arc). */
  private liftNeeded(p: PawState, s: number, g: number): number {
    if (!Number.isFinite(g)) return 0;
    const e = smoothstep(0, 1, s);
    const baseY = p.from.y + (p.to.y - p.from.y) * e;
    const ny = Math.max(_n.lerpVectors(p.fromNormal, p.toNormal, e).normalize().y, 0.3);
    const arc = Math.sin(Math.PI * s) * ny;
    // at the very ends the paw is on its own ground: nothing to clear (and no division by a vanishing arc)
    return arc < 1e-3 ? 0 : Math.max(0, g - baseY) / arc + this.t.clearance;
  }

  /** Paw i's swing start and its leg's hip (once setLegs has given one), for project's slope-aware checks. */
  private stepContext(i: number): StepContext {
    const p = this.paws[i];
    const c = this.ctx[i];
    c.from.copy(p.from);
    c.fromNormal.copy(p.fromNormal);
    c.hip = Number.isFinite(this.reach[i]) ? this.hips[i] : null;
    return c;
  }

  /** Ray along −up from castUp (+ `above`) above `p`, reaching castDown below it. */
  private cast(p: THREE.Vector3, up: THREE.Vector3, out: RayHit, above = 0): RayHit | null {
    _down.copy(up).negate();
    _a.copy(p).addScaledVector(up, this.t.castUp + above);
    return this.world.raycast(_a, _down, this.t.castUp + above + this.t.castDown, out);
  }

  private stepOk(rise: number): boolean {
    return rise <= this.t.maxStepUp && -rise <= this.t.maxStepDown;
  }

  /** The rise from the paw to `hit` is within the step limits once measured from either surface's plane. */
  private slopeExplains(step: StepContext, hit: RayHit): boolean {
    const f = step.from;
    const nf = step.fromNormal;
    const nh = hit.normal;
    const p = hit.point;
    // from's surface plane, extended to the foothold
    if (nf.y > 0.2 && this.stepOk(p.y - (f.y - (nf.x * (p.x - f.x) + nf.z * (p.z - f.z)) / nf.y))) return true;
    // the foothold's surface plane, extended back to the paw
    return nh.y > 0.2 && this.stepOk(p.y - (nh.x * (f.x - p.x) + nh.z * (f.z - p.z)) / nh.y - f.y);
  }

  /** A spot is an edge when any probe around it misses or sits more than edgeDrop above/below it. */
  private isEdge(point: THREE.Vector3, up: THREE.Vector3): boolean {
    const r = this.t.edgeProbe;
    for (const [ux, uz] of EDGE_DIRS) {
      _c.set(point.x + ux * r, point.y, point.z + uz * r);
      if (!this.cast(_c, up, _probe)) return true;
      const dh = (_probe.point.x - point.x) * up.x + (_probe.point.y - point.y) * up.y + (_probe.point.z - point.z) * up.z;
      if (Math.abs(dh) > this.t.edgeDrop) return true;
    }
    return false;
  }
}
