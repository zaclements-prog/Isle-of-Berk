import * as THREE from 'three';
import type { InputState } from '../../../core/input';
import { mulberry32 } from '../../../core/rng';
import type { CollisionWorld, RayHit, SphereContact } from '../../../world/collision';
import { BodyKinematics, DragonController, createIntent, type MoveIntent } from './controller';
import { BodySolver, type ClimbRide } from './bodySolver';
import { ClimbController } from './climbing';
import { FootPlanner, type PlannerBody } from './footPlanner';
import { GaitEngine, NO_GAIT_MODS, type GaitMods } from './gait';
import { LegRig } from './legs';
import { LookController } from './look';
import { PoseLayerStack, withFoldClip, type PosesMeta } from './poseLayers';
import { BodyProxies } from './proxies';
import type { MotionRig } from './rigTypes';
import { SecondaryMotion } from './secondary';
import { RigSkeleton } from './skeleton';
import { DEFAULT_TUNING, mergeTuning, type MotionTuning } from './tuning';
import { dampFactor, deg, rotY } from './math';

export interface DragonOptions {
  rig: MotionRig;
  world: CollisionWorld;
  tuning?: MotionTuning;
  /** Pose-library clips (toothless.poses.glb) and their masks (toothless.poses.json). */
  clips?: ReadonlyMap<string, THREE.AnimationClip>;
  posesMeta?: PosesMeta;
  seed?: number;
}

export interface DragonFrameInput {
  readonly input: InputState;
  /** Yaw of the camera's forward direction (camera-relative controls). */
  readonly cameraYaw: number;
  readonly cameraPos: THREE.Vector3;
}

export type DragonHook = (dragon: DragonCharacter, dt: number) => void;

/** Body proxies whose contacts with ground-like surfaces raise the front of the body (see frontRaise). */
const FRONT_PROXIES: readonly string[] = ['head', 'muzzle', 'neck'];

/** Per-step motion modifiers — climbing (Task 14) and M6 actions set these before the kinematics run. */
export interface MotionMods {
  speedCap: number;
  gait: GaitMods;
  maxTiltDeg: number;
  /** Body up axis for foothold searches. */
  readonly up: THREE.Vector3;
  /** A scripted action owns kin.pos/heading this step: skip the kinematics and proxy slide. */
  scripted: boolean;
  /** Proxy contacts with |normal.y| below this push the body sideways (walls); climb mode admits steeper ground. */
  wallNormalY: number;
}

/**
 * Toothless's motion (spec §6.1). Every fixed step recomputes the whole pose ABSOLUTELY from bind (spec §3.4) and
 * depends only on its inputs, so the Motion Lab and tests can step it deterministically.
 */
export class DragonCharacter {
  readonly tuning: MotionTuning;
  readonly world: CollisionWorld;
  readonly skeleton: RigSkeleton;
  readonly controller = new DragonController();
  readonly intent: MoveIntent = createIntent();
  readonly kin = new BodyKinematics();
  readonly gait: GaitEngine;
  readonly planner: FootPlanner;
  readonly body: BodySolver;
  readonly legs: LegRig;
  readonly layers: PoseLayerStack;
  readonly look: LookController;
  readonly secondary: SecondaryMotion;
  readonly proxies: BodyProxies;
  readonly mods: MotionMods;
  /** Spec §6.6 climbing (climb mode, scramble-up, blocked walls, hop-down), run in hooks.beforeMove. */
  readonly climb: ClimbController;
  readonly hooks: { beforeMove: DragonHook[]; preFinals: DragonHook[]; face: DragonHook[] } = { beforeMove: [], preFinals: [], face: [] };
  time = 0;
  nanResets = 0;
  verticalAccel = 0;
  private readonly head: number;
  private readonly chest: number;
  /**
   * The jaw's closed rest (rig.jaw.restCloseRad): bind leaves the mouth ajar, and every step rebuilds the pose from
   * bind, which would undo the loader's closing turn. Applied right after resetToBind, so pose layers and the face
   * (M6) can still open it.
   */
  private readonly jawRest: { bone: number; quat: THREE.Quaternion } | null;
  private readonly strain = [0, 0, 0, 0];
  private readonly prevStretch = [0, 0, 0, 0];
  private readonly prevMargin = [0, 0, 0, 0];
  private readonly hips = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly reach: number[];
  /** What climbing rides on (climbRide), and its two probe points. */
  private readonly ride = { weight: 0, up: new THREE.Vector3(0, 1, 0), hind: -Infinity, front: -Infinity, span: 0, tiltOmega: 0 };
  private readonly rideHind = new THREE.Vector3();
  private readonly rideFront = new THREE.Vector3();
  private readonly rideDir = new THREE.Vector3();
  /** Per leg, how far the body lowers for it this step (BodySolver): the leg's shortfall or its landing's. */
  private readonly short = [0, 0, 0, 0];
  private readonly groundProbe = new THREE.Vector3();
  private readonly groundOrigin = new THREE.Vector3();
  private readonly groundHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private readonly targets = {
    sole: [0, 1, 2, 3].map(() => new THREE.Vector3()),
    normal: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0)),
    planted: [true, true, true, true],
    s: [1, 1, 1, 1],
  };
  private prevPelvisY = 0;
  private prevVy = 0;
  /** Proxy indices of the head, muzzle and neck, and each proxy's forward lever arm about the pelvis at bind (m). */
  private readonly front: number[];
  private readonly frontLever: number[];
  private readonly raiseProbe = new THREE.Vector3();
  private readonly raiseContact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

  constructor(opts: DragonOptions) {
    this.world = opts.world;
    this.tuning = opts.tuning ?? mergeTuning(DEFAULT_TUNING, undefined);
    const t = this.tuning;
    this.skeleton = new RigSkeleton(opts.rig);
    this.gait = new GaitEngine(t.gait);
    this.planner = new FootPlanner(opts.rig, opts.world, t.planner);
    this.body = new BodySolver(opts.rig, this.skeleton, t.body);
    this.legs = new LegRig(opts.rig, this.skeleton, t.legs);
    this.planner.setEnvelope(this.legs.envelope.forward, this.legs.envelope.backward);
    this.reach = this.legs.legs.map((l) => l.reach);
    const env = this.legs.envelope;
    this.gait.setStrideLimit(t.gait.strideFrac * Math.min(...env.forward.map((f, i) => f + env.backward[i])));
    // Ruling 3: the wing fold is ONE merged multi-key clip (rig.wings.L.foldClips), sampled at the fold amount
    const clips0 = opts.clips ?? new Map<string, THREE.AnimationClip>();
    const meta0 = opts.posesMeta ?? { clips: {} };
    const foldClips = opts.rig.wings.L.foldClips;
    const fold = foldClips && foldClips.every((n) => clips0.has(n) && n in meta0.clips) ? withFoldClip(clips0, meta0, foldClips) : { clips: clips0, meta: meta0 };
    this.layers = new PoseLayerStack(this.skeleton, fold.clips, fold.meta);
    if (this.layers.has('wingFold')) this.layers.set('wingFold', 1, 1);
    else if (this.layers.has('wings_folded')) this.layers.set('wings_folded', 1);
    const rng = mulberry32(opts.seed ?? 1);
    this.look = new LookController(opts.rig, this.skeleton, t.look, rng);
    this.secondary = new SecondaryMotion(opts.rig, this.skeleton, opts.world, t, rng);
    this.proxies = new BodyProxies(opts.rig, this.skeleton);
    this.mods = {
      speedCap: Infinity, gait: NO_GAIT_MODS, maxTiltDeg: t.body.maxTiltDeg, up: new THREE.Vector3(0, 1, 0), scripted: false,
      wallNormalY: t.body.wallNormalY,
    };
    this.front = this.proxies.items.flatMap((p, k) => (FRONT_PROXIES.includes(p.name) ? [k] : []));
    const jaw = opts.rig.jaw;
    const jawBone = jaw?.restCloseRad ? this.skeleton.id(jaw.bone) : -1;
    this.jawRest = jawBone < 0 ? null : {
      bone: jawBone,
      quat: this.skeleton.bindLocalQuat[jawBone].clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), jaw!.restCloseRad!)),
    };
    this.head = this.skeleton.id(opts.rig.chains.neck[opts.rig.chains.neck.length - 1]);
    this.chest = this.skeleton.id(opts.rig.chains.spine[opts.rig.chains.spine.length - 1]);
    // how far the body reaches ahead of the origin at bind (the muzzle) — climbing measures walls from the origin
    this.proxies.update(this.skeleton);
    const frontExtent = Math.max(...this.proxies.items.map((p, k) => this.proxies.centers[k].z + p.radius));
    const pelvisZ = this.skeleton.bindWorldPos[this.skeleton.id(opts.rig.chains.spine[0])].z;
    this.frontLever = this.proxies.centers.map((c) => c.z - pelvisZ);
    this.climb = new ClimbController(opts.world, t.climb, t.scramble, frontExtent, t.planner.maxStepUp);
    this.climb.attach(this);
  }

  spawn(x: number, z: number, heading: number): void {
    const g = this.world.groundAt(x, z, 1000, 2000); // probe window: any ground under the spawn point (Ruling 14)
    const y = g ? g.point.y : 0;
    this.climb.reset(this); // a respawn mid-scramble or mid-hop must not resume it
    this.kin.spawn(x, y, z, heading);
    this.gait.reset();
    this.planner.reset(this.plannerBody());
    this.body.reset(this.kin.pos, heading, y, this.planner);
    const s = this.skeleton;
    this.resetPose();
    this.body.apply(s);
    this.layers.apply(s);
    s.fk();
    this.fillTargets();
    this.legs.solve(s, this.targets, this.body.pose.bodyQuat);
    s.fk();
    s.snapshot();
    for (let i = 0; i < 4; i++) {
      this.prevStretch[i] = this.legs.stretch[i];
      this.prevMargin[i] = this.legs.margin[i];
    }
    this.prevPelvisY = this.body.pose.pelvisPos.y;
    this.prevVy = 0;
    this.verticalAccel = 0;
    this.time = 0;
  }

  update(frame: DragonFrameInput, dt: number): void {
    const t = this.tuning;
    const s = this.skeleton;
    s.snapshot();
    // 1) input → intent (hooks may adjust mods first: climbing, actions)
    this.controller.read(frame.input, frame.cameraYaw, t.controller, this.intent);
    for (const h of this.hooks.beforeMove) h(this, dt);
    // 2) kinematics; the body proxies slide along steep geometry (skipped while a scripted action owns the body)
    if (!this.mods.scripted) {
      this.kin.plan(this.intent, dt, t.controller, this.mods.speedCap);
      this.proxies.update(s);
      this.proxies.resolveMove(this.world, this.kin.delta, this.mods.wallNormalY, this.kin.pos, this.kin.yawRate * dt, t.body.proxySkin);
      this.kin.commit(this.kin.delta, dt);
    }
    // 3) gait — turning on the spot drives the phase too, so the feet step around
    this.gait.update(Math.max(this.kin.speed, Math.abs(this.kin.yawRate) * t.gait.turnStepRadius), dt, this.mods.gait);
    // 4) feet: lift a paw early when its leg is predicted to over-stretch within planner.strainLookahead steps
    for (let i = 0; i < 4; i++) {
      // extrapolate reach and joint-limit margin separately (either can race toward its limit while the other is calm)
      const st = this.legs.stretch[i];
      const m = this.legs.margin[i];
      const ahead = t.planner.strainLookahead;
      const predReach = st + ahead * (st - this.prevStretch[i]);
      const predMargin = m + ahead * (m - this.prevMargin[i]);
      this.strain[i] = Math.max(predReach, 1 - predMargin / deg(t.legs.limitMarginDeg));
      this.prevStretch[i] = st;
      this.prevMargin[i] = m;
      this.legs.hip(i, s, this.hips[i]);
    }
    this.planner.setLegs(this.hips, this.reach);
    this.planner.update(this.plannerBody(), this.gait, this.strain, dt);
    this.kin.pos.y = (this.planner.support(0) + this.planner.support(1) + this.planner.support(2) + this.planner.support(3)) / 4;
    // 5) body
    // a leg short of its target lowers the body; so does a swing landing out of reach, ahead of touchdown
    for (let i = 0; i < 4; i++) this.short[i] = Math.max(this.legs.shortfall[i], this.planner.landingShortfall(i, t.body.landingReach));
    const pose = this.body.update(this.kin, this.planner, this.gait, this.short, this.mods.maxTiltDeg, dt,
      this.groundUnder(1, 3), this.groundUnder(0, 2), this.frontRaise(), this.climbRide());
    this.secondary.update({ yawRate: this.kin.yawRate, speed: this.kin.speed, verticalAccel: this.verticalAccel, gallopWeight: this.gait.gallopWeight }, dt);
    // 6) the absolute pose: bind (jaw closed) → body → library layers → breathing
    this.resetPose();
    this.body.apply(s);
    this.layers.apply(s);
    this.secondary.applyBreathing(s);
    s.fk();
    for (const h of this.hooks.preFinals) h(this, dt);
    // 7) procedural finals: look, leg IK, tail/ears/fins
    this.look.update({
      moving: this.kin.speed > t.look.travelSpeed, heading: this.kin.heading, yawRate: this.kin.yawRate,
      bodyQuat: pose.bodyQuat, headPos: s.worldPos[this.head], cameraPos: frame.cameraPos, rise: this.climbRise(),
    }, dt);
    this.look.apply(s);
    s.fk();
    this.fillTargets();
    this.legs.solve(s, this.targets, pose.bodyQuat);
    s.fk();
    this.secondary.applyAppendages(s);
    // 8) face (M6)
    for (const h of this.hooks.face) h(this, dt);
    // pelvis vertical acceleration (tail lag), smoothed
    const vy = (pose.pelvisPos.y - this.prevPelvisY) / dt;
    this.verticalAccel += ((vy - this.prevVy) / dt - this.verticalAccel) * dampFactor(t.tail.vertAccelHalfLife, dt);
    this.prevVy = vy;
    this.prevPelvisY = pose.pelvisPos.y;
    if (!s.isFinite()) {
      s.restorePrev();
      this.nanResets++;
    }
    this.time += dt;
  }

  /** Copy the pose onto the loaded three.js bones, interpolated by the loop's alpha (spec §3.4). */
  writeTo(bones: ReadonlyMap<string, THREE.Object3D>, alpha: number): void {
    this.skeleton.writeTo(bones, alpha);
  }

  /** Bind pose with the jaw at its closed rest. */
  private resetPose(): void {
    this.skeleton.resetToBind();
    if (this.jawRest) this.skeleton.localQuat[this.jawRest.bone].copy(this.jawRest.quat);
  }

  chestPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.skeleton.worldPos[this.chest]);
  }

  /**
   * Climbing, the body rides on the face under its joints (BodySolver ClimbRide): the face along −up from the hips'
   * and the shoulders' midpoints, a little ahead along his velocity, with each pair raised to stand hipHeight along
   * the climb's up axis from the plane of the face there.
   */
  private climbRide(): ClimbRide | undefined {
    const w = this.climb.climbWeight;
    if (w <= 0) return undefined;
    const r = this.ride;
    r.weight = w;
    r.up.copy(this.mods.up);
    r.hind = this.faceUnder(0, 2, this.rideHind);
    r.front = this.faceUnder(1, 3, this.rideFront);
    r.span = Math.max(0, (this.rideFront.x - this.rideHind.x) * Math.sin(this.kin.heading) + (this.rideFront.z - this.rideHind.z) * Math.cos(this.kin.heading));
    r.tiltOmega = this.tuning.climb.tiltOmega;
    return r;
  }

  /** Climbing, the face's rise per metre along his heading (from the climb probe's slope), by the climb weight; else 0. */
  private climbRise(): number {
    const w = this.climb.climbWeight;
    const n = this.climb.probe.slopeNormal;
    if (w <= 0 || n.y < 1e-3) return 0;
    return (w * -(n.x * Math.sin(this.kin.heading) + n.z * Math.cos(this.kin.heading))) / n.y;
  }

  /** See climbRide: the height to ride on under joints a and b; their probe point → out. */
  private faceUnder(a: number, b: number, out: THREE.Vector3): number {
    const t = this.tuning;
    const h = this.body.hipHeight;
    const up = this.mods.up;
    out.addVectors(this.hips[a], this.hips[b]).multiplyScalar(0.5).addScaledVector(this.kin.velocity, t.body.terrainLookahead);
    // the face along −up from the joints (a vertical probe would jump from the face to the top as it crosses a crest,
    // where the joints' height above the surface under them jumps; along −up both meet at the corner)
    const lift = 0.3;
    this.groundOrigin.copy(out).addScaledVector(up, lift);
    if (this.world.isInside(this.groundOrigin)) this.groundOrigin.copy(out);
    this.rideDir.copy(up).negate();
    if (!this.world.raycast(this.groundOrigin, this.rideDir, lift + 3 * h, this.groundHit)) return -Infinity;
    // the height that puts the joints h along up from the plane of that face (at their own x, z), less what the body
    // solver adds back (h·up.y)
    const q = this.groundHit.point;
    const n = this.groundHit.normal;
    const y = q.y + (h * n.dot(up) - n.x * (out.x - q.x) - n.z * (out.z - q.z)) / Math.max(n.y, 0.2);
    return y - h * up.y;
  }

  /**
   * How far the front supports must rise (m) for the head, muzzle and neck to clear the ground-like surfaces they meet:
   * each front proxy is tested slightly ahead along his velocity (body.terrainLookahead, with body.proxySkin to spare),
   * and its vertical overlap is scaled from its lever arm about the pelvis back to the front supports'. Walls are the
   * proxy slide's; this is what lets him raise his head onto a steep slope instead of butting it.
   */
  private frontRaise(): number {
    const t = this.tuning;
    const s = this.skeleton;
    let raise = 0;
    this.proxies.update(s);
    for (const k of this.front) {
      const p = this.proxies.items[k];
      this.raiseProbe.copy(this.proxies.centers[k]).addScaledVector(this.kin.velocity, t.body.terrainLookahead);
      const c = this.world.sphereContact(this.raiseProbe, p.radius + t.body.proxySkin, this.raiseContact);
      if (!c || c.normal.y < this.mods.wallNormalY) continue;
      const lever = Math.max(this.frontLever[k], 1e-3);
      raise = Math.max(raise, (c.depth / c.normal.y) * (this.body.feetLength / lever));
    }
    return raise;
  }

  /**
   * Terrain height under the midpoint of two paws' neutral positions (shoulders: 1, 3; hips: 0, 2), a little ahead
   * along his velocity: the mean of three probes body.terrainSpan apart along his heading, so a staircase reads as a
   * ramp. Probes whose origin lies inside a solid, that find nothing, or that find ground more than body.terrainDrop
   * below the two paws (the far side of a drop: he hops it or stops, he never rides down to it) are left out
   * (−Infinity if all are).
   */
  private groundUnder(a: number, b: number): number {
    const t = this.tuning;
    const lowest = (this.planner.support(a) + this.planner.support(b)) / 2 - t.body.terrainDrop;
    const p = this.groundProbe;
    p.addVectors(this.planner.neutral[a], this.planner.neutral[b]).multiplyScalar(0.5);
    rotY(p, this.kin.heading, p).add(this.kin.pos).addScaledVector(this.kin.velocity, t.body.terrainLookahead);
    const fx = Math.sin(this.kin.heading) * t.body.terrainSpan;
    const fz = Math.cos(this.kin.heading) * t.body.terrainSpan;
    const top = this.kin.pos.y + t.climb.ledgeMax; // probe window (Ruling 14): steep ground can rise this far ahead
    let sum = 0;
    let n = 0;
    for (let k = -1; k <= 1; k++) {
      const x = p.x + fx * k;
      const z = p.z + fz * k;
      if (this.world.isInside(this.groundOrigin.set(x, top, z))) continue;
      if (!this.world.groundAt(x, z, top, 2 * t.climb.ledgeMax, this.groundHit) || this.groundHit.point.y < lowest) continue;
      sum += this.groundHit.point.y;
      n++;
    }
    return n ? sum / n : -Infinity;
  }

  private plannerBody(): PlannerBody {
    return {
      pos: this.kin.pos, heading: this.kin.heading, velocity: this.kin.velocity, yawRate: this.kin.yawRate, up: this.mods.up,
      climb: this.climb.climbWeight,
    };
  }

  private fillTargets(): void {
    for (let i = 0; i < 4; i++) {
      const paw = this.planner.paws[i];
      this.planner.swingPoint(i, this.targets.sole[i]);
      this.planner.swingNormal(i, this.targets.normal[i]);
      this.targets.planted[i] = paw.planted;
      this.targets.s[i] = paw.planted ? 1 : paw.s;
    }
  }
}
