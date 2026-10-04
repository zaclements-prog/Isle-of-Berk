import * as THREE from 'three';
import type { InputState } from '../../../core/input';
import { mulberry32 } from '../../../core/rng';
import type { CollisionWorld, RayHit } from '../../../world/collision';
import { BodyKinematics, DragonController, createIntent, type MoveIntent } from './controller';
import { BodySolver } from './bodySolver';
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

/** Per-step motion modifiers — climbing (Task 14) and M6 actions set these before the kinematics run. */
export interface MotionMods {
  speedCap: number;
  gait: GaitMods;
  maxTiltDeg: number;
  /** Body up axis for foothold searches. */
  readonly up: THREE.Vector3;
  /** A scripted action owns kin.pos/heading this step: skip the kinematics and proxy slide. */
  scripted: boolean;
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
  private readonly strain = [0, 0, 0, 0];
  private readonly prevStretch = [0, 0, 0, 0];
  private readonly prevMargin = [0, 0, 0, 0];
  private readonly hips = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly reach: number[];
  private readonly groundProbe = new THREE.Vector3();
  private readonly groundHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private readonly targets = {
    sole: [0, 1, 2, 3].map(() => new THREE.Vector3()),
    normal: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0)),
    planted: [true, true, true, true],
    s: [1, 1, 1, 1],
  };
  private prevPelvisY = 0;
  private prevVy = 0;

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
    this.mods = { speedCap: Infinity, gait: NO_GAIT_MODS, maxTiltDeg: t.body.maxTiltDeg, up: new THREE.Vector3(0, 1, 0), scripted: false };
    this.head = this.skeleton.id(opts.rig.chains.neck[opts.rig.chains.neck.length - 1]);
    this.chest = this.skeleton.id(opts.rig.chains.spine[opts.rig.chains.spine.length - 1]);
    // how far the body reaches ahead of the origin at bind (the muzzle) — climbing measures walls from the origin
    this.proxies.update(this.skeleton);
    const frontExtent = Math.max(...this.proxies.items.map((p, k) => this.proxies.centers[k].z + p.radius));
    this.climb = new ClimbController(opts.world, t.climb, frontExtent, t.planner.maxStepUp);
    this.climb.attach(this);
  }

  spawn(x: number, z: number, heading: number): void {
    const g = this.world.groundAt(x, z, 1000, 2000); // probe window: any ground under the spawn point (Ruling 14)
    const y = g ? g.point.y : 0;
    this.kin.spawn(x, y, z, heading);
    this.gait.reset();
    this.planner.reset(this.plannerBody());
    this.body.reset(this.kin.pos, heading, y);
    const s = this.skeleton;
    s.resetToBind();
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
      this.proxies.resolveMove(this.world, this.kin.delta, t.body.wallNormalY);
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
    const pose = this.body.update(this.kin, this.planner, this.gait, this.legs.shortfall, this.mods.maxTiltDeg, dt,
      this.groundUnder(1, 3), this.groundUnder(0, 2));
    this.secondary.update({ yawRate: this.kin.yawRate, speed: this.kin.speed, verticalAccel: this.verticalAccel, gallopWeight: this.gait.gallopWeight }, dt);
    // 6) the absolute pose: bind → body → library layers → breathing
    s.resetToBind();
    this.body.apply(s);
    this.layers.apply(s);
    this.secondary.applyBreathing(s);
    s.fk();
    for (const h of this.hooks.preFinals) h(this, dt);
    // 7) procedural finals: look, leg IK, tail/ears/fins
    this.look.update({
      moving: this.kin.speed > t.look.travelSpeed, heading: this.kin.heading, yawRate: this.kin.yawRate,
      bodyQuat: pose.bodyQuat, headPos: s.worldPos[this.head], cameraPos: frame.cameraPos,
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

  chestPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.skeleton.worldPos[this.chest]);
  }

  /** Terrain height under the midpoint of two paws' neutral positions (shoulders: 1, 3; hips: 0, 2). */
  private groundUnder(a: number, b: number): number {
    const p = this.groundProbe;
    p.addVectors(this.planner.neutral[a], this.planner.neutral[b]).multiplyScalar(0.5);
    rotY(p, this.kin.heading, p).add(this.kin.pos).addScaledVector(this.kin.velocity, this.tuning.body.terrainLookahead);
    const hit = this.world.groundAt(p.x, p.z, this.kin.pos.y + 1.5, 4, this.groundHit); // probe window (Ruling 14)
    return hit ? hit.point.y : -Infinity;
  }

  private plannerBody(): PlannerBody {
    return { pos: this.kin.pos, heading: this.kin.heading, velocity: this.kin.velocity, yawRate: this.kin.yawRate, up: this.mods.up };
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
