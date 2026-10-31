import * as THREE from 'three';
import type { InputState } from '../../../core/input';
import { mulberry32 } from '../../../core/rng';
import type { CollisionWorld, RayHit, SphereContact } from '../../../world/collision';
import { BodyKinematics, DragonController, createIntent, type MoveIntent } from './controller';
import { BodySolver, type BodyPose, type ClimbRide } from './bodySolver';
import { ClimbController } from './climbing';
import { FootPlanner, type PlannerBody } from './footPlanner';
import { GAITS, GaitEngine, NO_GAIT_MODS, type GaitMods } from './gait';
import { LegRig } from './legs';
import { LocomotionDriver } from './locomotion';
import { LookController } from './look';
import { ClipPose, PoseLayerStack, withFoldClip, type PosesMeta } from './poseLayers';
import { BodyProxies } from './proxies';
import type { MotionRig } from './rigTypes';
import { SecondaryMotion } from './secondary';
import { WingController } from './wings';
import { RigSkeleton } from './skeleton';
import { DEFAULT_TUNING, mergeTuning, type MotionTuning } from './tuning';
import { clamp, dampFactor, deg, rotY } from './math';

const _ik = new THREE.Quaternion();

export interface DragonOptions {
  rig: MotionRig;
  world: CollisionWorld;
  tuning?: MotionTuning;
  /** Pose-library clips (toothless.poses.glb) and their masks (toothless.poses.json). */
  clips?: ReadonlyMap<string, THREE.AnimationClip>;
  posesMeta?: PosesMeta;
  seed?: number;
  /** Pose whose legs are the midpoint of every IK↔pose leg blend (paws lift instead of sweeping through the ground). */
  legTuckClip?: string;
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
  readonly wings: WingController;
  /** Authored locomotion cycles (Plan 5), additive on the body, synced to the gait. */
  readonly loco: LocomotionDriver;
  /** Per leg (LEG_KEYS order): how strongly pose layers drive it instead of the leg IK (0…1). */
  readonly own = [0, 0, 0, 0];
  readonly look: LookController;
  readonly secondary: SecondaryMotion;
  readonly proxies: BodyProxies;
  readonly mods: MotionMods;
  /** Spec §6.6 climbing (climb mode, scramble-up, blocked walls, hop-down), run in hooks.beforeMove. */
  readonly climb: ClimbController;
  readonly hooks: { beforeMove: DragonHook[]; preFinals: DragonHook[]; face: DragonHook[] } = { beforeMove: [], preFinals: [], face: [] };
  time = 0;
  nanResets = 0;
  /** The camera position of the current step (hooks read it: glance at the camera). */
  readonly cameraPos = new THREE.Vector3();
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
  private readonly legBones: number[][];
  private readonly legSave: THREE.Quaternion[][];
  private readonly legPosed: THREE.Quaternion[][];
  /** Every leg's locals as the layers left them, before the leg IK (a guard re-solve starts from these). */
  private readonly legPre: THREE.Quaternion[][];
  private readonly guardSole = new THREE.Vector3();
  private readonly guardHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private readonly guardKeep = { stretch: [0, 0, 0, 0], shortfall: [0, 0, 0, 0], margin: [0, 0, 0, 0] };
  private readonly guardTargets = {
    sole: [0, 1, 2, 3].map(() => new THREE.Vector3()),
    normal: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 1, 0)),
    planted: [true, true, true, true],
    s: [1, 1, 1, 1],
  };
  private readonly guardDepth = [0, 0, 0, 0];
  private readonly backProbe = new THREE.Vector3();
  private readonly pinchAxis = new THREE.Vector3();
  private readonly pinchQuat = new THREE.Quaternion();
  private readonly roughPts: [number, number, number][] = Array.from({ length: 16 }, () => [0, 0, 0]);
  /** The last roughCap reading (m off the plane of the ground ahead), and how long the trot cap still holds (s). */
  roughness = 0;
  private roughHold = 0;
  /** Per leg, the tucked-leg locals (null without the clip: plain slerp). */
  private readonly legTuck: THREE.Quaternion[][] | null;
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
    this.wings = new WingController(opts.rig, this.skeleton, this.layers, opts.posesMeta ?? { clips: {} }, t.wings);
    this.loco = new LocomotionDriver(this.layers, fold.meta, t.loco);
    // footfalls where the cycles expect them, for gaits whose authored duty is far from the table's (the gallop)
    for (const c of this.loco.cycles) if (Math.abs(c.meta.duty - GAITS[c.gait].duty) > t.loco.adoptDutyOver) this.gait.setTiming(c.gait, { duty: c.meta.duty });
    const rng = mulberry32(opts.seed ?? 1);
    this.look = new LookController(opts.rig, this.skeleton, t.look, rng);
    this.secondary = new SecondaryMotion(opts.rig, this.skeleton, opts.world, t, rng);
    this.proxies = new BodyProxies(opts.rig, this.skeleton);
    this.mods = {
      speedCap: Infinity, gait: NO_GAIT_MODS, maxTiltDeg: t.body.maxTiltDeg, up: new THREE.Vector3(0, 1, 0), scripted: false,
      wallNormalY: t.body.wallNormalY,
    };
    this.legBones = this.legs.legs.map((l) => l.bones);
    this.legSave = this.legBones.map((b) => b.map(() => new THREE.Quaternion()));
    this.legPosed = this.legBones.map((b) => b.map(() => new THREE.Quaternion()));
    this.legPre = this.legBones.map((b) => b.map(() => new THREE.Quaternion()));
    const tuckClip = opts.clips?.get(opts.legTuckClip ?? 'jump_tuck');
    if (tuckClip) {
      const pose = new ClipPose(tuckClip, this.skeleton, ['front_', 'hind_']);
      const qs = pose.bones.map(() => new THREE.Quaternion());
      pose.sample(0, qs);
      const byBone = new Map(pose.bones.map((b, k) => [b, qs[k]]));
      this.legTuck = this.legBones.map((bones) => bones.map((b) => (byBone.get(b) ?? this.skeleton.bindLocalQuat[b]).clone()));
    } else this.legTuck = null;
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
    this.loco.reset();
    this.applyLoco();
    this.planner.reset(this.plannerBody());
    this.body.reset(this.kin.pos, heading, y, this.planner);
    const s = this.skeleton;
    this.resetPose();
    this.body.apply(s);
    this.wings.update(0);
    this.wings.settle();
    this.layers.apply(s);
    this.wings.apply(s);
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
    this.cameraPos.copy(frame.cameraPos);
    // 1) input → intent (hooks may adjust mods first: climbing, actions)
    this.controller.read(frame.input, frame.cameraYaw, t.controller, this.intent);
    for (const h of this.hooks.beforeMove) h(this, dt);
    // pose layers set by behaviours/actions decide which legs they drive; the planner leaves those paws alone
    this.layers.legOwnership(this.own);
    for (let i = 0; i < 4; i++) this.planner.paws[i].posed = this.own[i] > 0;
    this.secondary.breathGain = 1 - (1 - t.pose.breathGainPosed) * Math.max(this.own[1], this.own[3]);
    // 2) kinematics; the body proxies slide along steep geometry (skipped while a scripted action owns the body)
    if (!this.mods.scripted) {
      this.kin.plan(this.intent, dt, t.controller, Math.min(this.mods.speedCap, this.roughCap(dt)));
      this.proxies.update(s);
      this.proxies.resolveMove(this.world, this.kin.delta, this.mods.wallNormalY, this.kin.pos, this.kin.yawRate * dt, t.body.proxySkin);
      this.kin.commit(this.kin.delta, dt);
    }
    // 3) gait — turning on the spot drives the phase too, so the feet step around
    this.gait.update(Math.max(this.kin.speed, Math.abs(this.kin.yawRate) * t.gait.turnStepRadius), dt, this.mods.gait);
    // the authored cycles ride the gait (held back while climbing, scripted, a pose owning the legs, or on rough ground:
    // they are flat-ground runs). Roughness = how far the paws' supports are from one plane: on any plane, ramps, side
    // slopes and stair treads included, the diagonal pairs' heights sum alike (LH + RF = LF + RH)
    const sp = this.planner;
    const twist = Math.abs(sp.support(0) + sp.support(3) - sp.support(1) - sp.support(2)) / 2;
    const rough = clamp((twist - t.loco.roughLo) / Math.max(t.loco.roughHi - t.loco.roughLo, 1e-6), 0, 1);
    const raise = this.frontRaise();
    let reach = 0;
    for (let i = 0; i < 4; i++) if (sp.paws[i].planted) reach = Math.max(reach, this.legs.stretch[i]);
    // (not the gallop's: its stance legs run near full reach by design, and the fade would flicker its body)
    const strain = clamp((reach - t.loco.strainLo) / Math.max(t.loco.strainHi - t.loco.strainLo, 1e-6), 0, 1) * (1 - this.gait.gallopWeight);
    const suppress = Math.max(this.climb.climbWeight, this.own[0], this.own[1], this.own[2], this.own[3], this.mods.scripted ? 1 : 0,
      rough, clamp(raise / t.loco.raiseFade, 0, 1), strain);
    this.loco.update(this.gait, this.kin.speed, this.kin.yawRate, suppress, dt);
    this.applyLoco();
    // 4) feet: lift a paw early when its leg is predicted to over-stretch within planner.strainLookahead steps
    for (let i = 0; i < 4; i++) {
      // extrapolate reach and joint-limit margin separately (either can race toward its limit while the other is calm)
      const st = this.legs.stretch[i];
      const m = this.legs.margin[i];
      const ahead = t.planner.strainLookahead;
      const predReach = st + ahead * (st - this.prevStretch[i]);
      const predMargin = m + ahead * (m - this.prevMargin[i]);
      // (not the joint-margin term in the gallop: at 10 m/s the margin swings fast enough that its extrapolation
      // predicts limits the stride never reaches, cutting a forelimb's stance short every stride; the reach term and
      // the ground guard cover it)
      const marginStrain = (1 - predMargin / deg(t.legs.limitMarginDeg)) * (1 - this.gait.gallopWeight);
      this.strain[i] = Math.max(predReach, marginStrain);
      this.prevStretch[i] = st;
      this.prevMargin[i] = m;
      this.legs.hip(i, s, this.hips[i]);
    }
    this.planner.setLegs(this.hips, this.reach);
    this.planner.update(this.plannerBody(), this.gait, this.strain, dt);
    this.kin.pos.y = (this.planner.support(0) + this.planner.support(1) + this.planner.support(2) + this.planner.support(3)) / 4;
    // 5) body (library poses with a root blend the placement)
    this.poseBody();
    // a leg short of its target lowers the body; so does a swing landing out of reach, ahead of touchdown
    for (let i = 0; i < 4; i++) this.short[i] = Math.max(this.legs.shortfall[i], this.planner.landingShortfall(i, t.body.landingReach));
    const pose = this.body.update(this.kin, this.planner, this.gait, this.short, this.mods.maxTiltDeg, dt,
      this.groundUnder(1, 3), this.groundUnder(0, 2), raise, this.climbRide());
    this.secondary.update({ yawRate: this.kin.yawRate, speed: this.kin.speed, verticalAccel: this.verticalAccel, gallopWeight: this.gait.gallopWeight }, dt);
    // 6) the absolute pose: bind (jaw closed) → body → library layers → breathing
    this.resetPose();
    this.body.apply(s);
    this.wings.update(dt);
    this.layers.apply(s);
    this.wings.apply(s);
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
    this.saveOwnedLegs();
    for (let i = 0; i < 4; i++) this.legBones[i].forEach((b, k) => this.legPre[i][k].copy(s.localQuat[b]));
    this.fillTargets();
    this.legs.solve(s, this.targets, pose.bodyQuat);
    this.blendOwnedLegs();
    s.fk();
    this.guardLegs(pose.bodyQuat);
    // twice: pitching the nose up turns a leg held at its limit with the body, so one lift leaves part of the pinch
    const pinchSum = [0, 0];
    for (let pass = 0; pass < 2 && this.measurePinch(); pass++) {
      pinchSum[0] += this.body.pinch[0];
      pinchSum[1] += this.body.pinch[1];
      this.liftForPinch(pose);
    }
    this.body.pinch[0] = pinchSum[0];
    this.body.pinch[1] = pinchSum[1];
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

  /**
   * Speed cap (m/s) from the ground ahead (tuning.rough): rows of probes ahead along his heading, a little farther the
   * faster he goes, three across; the roughness is the largest height off their least-squares plane, so a ramp or a
   * side slope reads as smooth and broken ground, rubble, logs or a ditch as rough. He slows to a trot over it, as an
   * animal picks its way, instead of galloping onto footholds his legs cannot keep.
   */
  roughCap(dt: number): number {
    const r = this.tuning.rough;
    const fx = Math.sin(this.kin.heading);
    const fz = Math.cos(this.kin.heading);
    const lead = r.roughLead * this.kin.speed;
    const top = this.kin.pos.y + this.tuning.climb.ledgeMax;
    const pts = this.roughPts;
    let n = 0;
    for (const a of r.roughAhead) {
      for (const l of [-1, 0, 1]) {
        const x = this.kin.pos.x + fx * (a + lead) + fz * l * r.roughSpan;
        const z = this.kin.pos.z + fz * (a + lead) - fx * l * r.roughSpan;
        if (this.world.isInside(this.groundOrigin.set(x, top, z))) continue;
        if (!this.world.groundAt(x, z, top, 2 * this.tuning.climb.ledgeMax, this.groundHit)) continue;
        pts[n++] = [a, l * r.roughSpan, this.groundHit.point.y];
      }
    }
    if (n < 4) {
      this.roughHold = Math.max(0, this.roughHold - dt);
      return this.roughHold > 0 ? r.trotCap : Infinity;
    }
    // least-squares plane h = c0 + c1·a + c2·l over the probes, then the largest residual
    let sa = 0, sl = 0, sh = 0, saa = 0, sll = 0, sal = 0, sah = 0, slh = 0;
    for (let k = 0; k < n; k++) {
      const [a, l, h] = pts[k];
      sa += a; sl += l; sh += h; saa += a * a; sll += l * l; sal += a * l; sah += a * h; slh += l * h;
    }
    const m = [[n, sa, sl], [sa, saa, sal], [sl, sal, sll]];
    const v = [sh, sah, slh];
    const c = solve3(m, v);
    let rough = 0;
    for (let k = 0; k < n; k++) {
      const [a, l, h] = pts[k];
      rough = Math.max(rough, Math.abs(h - (c[0] + c[1] * a + c[2] * l)));
    }
    this.roughness = rough;
    // once over rough ground he keeps to the trot for roughHold s after the last rough reading: a flat stretch
    // between obstacles (the top of a ledge, a gap between logs) is no place to break into a gallop
    if (rough >= r.roughTrot) this.roughHold = r.roughHold;
    else this.roughHold = Math.max(0, this.roughHold - dt);
    return this.roughHold > 0 ? r.trotCap : Infinity;
  }

  /** Hand the locomotion cycles' weight, pelvis bob and wing lift to the body, tail and wings. */
  private applyLoco(): void {
    this.body.authored = this.loco.weight;
    this.body.bobOffset = this.loco.bob;
    this.body.authoredCrouch = this.loco.crouch;
    this.secondary.authored = this.loco.weight;
    this.wings.extraLift = this.loco.wingLift;
  }

  /** Bind pose with the jaw at its closed rest. */
  private resetPose(): void {
    this.skeleton.resetToBind();
    if (this.jawRest) this.skeleton.localQuat[this.jawRest.bone].copy(this.jawRest.quat);
  }

  chestPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.skeleton.worldPos[this.chest]);
  }

  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.skeleton.worldPos[this.head]);
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

  /** Body placement from the live pose layers that carry a root (weighted mean over those layers). */
  private poseBody(): void {
    let w = 0;
    let h = 0;
    let p = 0;
    for (const l of this.layers.active()) {
      const r = l.meta.root;
      if (!r) continue;
      w += l.weight;
      h += l.weight * r.height;
      p += l.weight * r.pitch;
    }
    const b = this.body.posture;
    b.weight = Math.min(1, w);
    if (w > 0) {
      b.height = this.kin.pos.y + h / w;
      b.pitch = p / w;
    }
  }

  /** Keep the layered pose of every owned leg before the leg IK overwrites it. */
  private saveOwnedLegs(): void {
    const s = this.skeleton;
    for (let i = 0; i < 4; i++) {
      if (this.own[i] <= 0) continue;
      this.legBones[i].forEach((b, k) => this.legSave[i][k].copy(s.localQuat[b]));
    }
  }

  /**
   * Owned legs: the IK solution blends to the layered pose by the ownership weight — through the tucked leg
   * (IK → tuck for w < ½, tuck → pose above), so a paw lifts and re-places instead of sweeping through the ground.
   */
  private blendOwnedLegs(): void {
    const s = this.skeleton;
    for (let i = 0; i < 4; i++) {
      const w = this.own[i];
      if (w <= 0) continue;
      const tuck = this.legTuck?.[i];
      this.legBones[i].forEach((b, k) => {
        if (!tuck || w >= 1) s.localQuat[b].slerp(this.legSave[i][k], w);
        else if (w < 0.5) s.localQuat[b].slerp(tuck[k], 2 * w);
        else s.localQuat[b].copy(tuck[k]).slerp(this.legSave[i][k], 2 * w - 1);
      });
    }
  }

  /**
   * A posed or swinging paw must not sink: wherever an owned sole (a pose held while the body moves, a blend path) or
   * a swinging sole (a leg at a joint limit cannot follow its swing arc, e.g. a gallop's fore paw just after lift-off
   * under a dipping chest) ends below the ground, that leg is re-solved by the IK onto the ground and blended in by
   * depth / pose.groundGuard (full at 2 cm), so no such paw goes more than a few millimetres under. The IK's
   * bookkeeping (stretch, shortfall, margin) is kept. Planted paws are the planner's.
   */
  private guardLegs(bodyQuat: THREE.Quaternion): void {
    const s = this.skeleton;
    let any = false;
    for (let i = 0; i < 4; i++) {
      this.guardDepth[i] = 0;
      if (this.own[i] <= 0 && this.planner.paws[i].planted) continue;
      this.legs.soleWorld(i, s, this.guardSole);
      const g = this.world.groundAt(this.guardSole.x, this.guardSole.z, this.guardSole.y + 1, 3, this.guardHit);
      if (!g || g.point.y <= this.guardSole.y) continue;
      this.guardDepth[i] = g.point.y - this.guardSole.y;
      this.guardTargets.sole[i].set(this.guardSole.x, g.point.y + 0.002, this.guardSole.z);
      this.guardTargets.normal[i].copy(g.normal);
      // a swinging paw inside a solid (into a boulder's flank) backs out toward its hip, to the first free spot, rather
      // than reaching for the top of the rock
      if (this.own[i] <= 0 && this.world.isInside(this.guardSole) && this.backOut(i, this.guardTargets.sole[i])) {
        this.guardTargets.normal[i].set(0, 1, 0);
      }
      any = true;
    }
    if (!any) return;
    const k = this.guardKeep;
    for (let i = 0; i < 4; i++) {
      k.stretch[i] = this.legs.stretch[i];
      k.shortfall[i] = this.legs.shortfall[i];
      k.margin[i] = this.legs.margin[i];
      this.legBones[i].forEach((b, n) => this.legPosed[i][n].copy(s.localQuat[b]));
      if (this.guardDepth[i] === 0) this.legs.soleWorld(i, s, this.guardTargets.sole[i]);
    }
    // re-solve from the layered pose: the front solve turns the shoulder blade relative to what it finds
    for (let i = 0; i < 4; i++) this.legBones[i].forEach((b, n) => s.localQuat[b].copy(this.legPre[i][n]));
    s.fk();
    this.legs.solve(s, this.guardTargets, bodyQuat);
    for (let i = 0; i < 4; i++) {
      const c = Math.min(1, this.guardDepth[i] / this.tuning.pose.groundGuard);
      this.legBones[i].forEach((b, n) => {
        if (c > 0) s.localQuat[b].copy(_ik.copy(this.legPosed[i][n]).slerp(s.localQuat[b], c));
        else s.localQuat[b].copy(this.legPosed[i][n]);
      });
      this.legs.stretch[i] = k.stretch[i];
      this.legs.shortfall[i] = k.shortfall[i];
      this.legs.margin[i] = k.margin[i];
    }
    s.fk();
  }

  /**
   * A planted paw left under its contact by a leg folded to its limit (a fore paw as a braking gallop's bob comes
   * down): lift the pelvis by the hind pinch and pitch the nose up by what the front needs beyond it, then re-solve
   * the legs, this step. The body's springs carry the lift on from the next step (BodySolver.pinch).
   */
  private liftForPinch(pose: BodyPose): void {
    const s = this.skeleton;
    const [ph, pf] = this.body.pinch;
    const pel = this.body.pelvis;
    const dp = Math.atan2(Math.max(0, pf - ph), this.body.feetLength);
    s.localPos[pel].y += ph;
    pose.pelvisPos.y += ph;
    if (dp > 0) {
      this.pinchAxis.set(1, 0, 0).applyQuaternion(pose.bodyQuat);
      this.pinchQuat.setFromAxisAngle(this.pinchAxis, -dp); // −pitch about the lateral axis lifts the nose
      s.localQuat[pel].premultiply(this.pinchQuat);
      pose.bodyQuat.premultiply(this.pinchQuat);
      pose.pitch += dp;
    }
    for (let i = 0; i < 4; i++) this.legBones[i].forEach((b, k) => s.localQuat[b].copy(this.legPre[i][k]));
    s.fk();
    this.legs.solve(s, this.targets, pose.bodyQuat);
    this.blendOwnedLegs();
    s.fk();
    this.guardLegs(pose.bodyQuat);
  }

  /** Planted paws the leg left under their contact (a leg folded to its limit): true when there is any. */
  private measurePinch(): boolean {
    const pinch = this.body.pinch;
    pinch[0] = pinch[1] = 0;
    for (let i = 0; i < 4; i++) {
      const p = this.planner.paws[i];
      if (!p.planted || p.posed || this.own[i] > 0) continue;
      this.legs.soleWorld(i, this.skeleton, this.guardSole);
      const d = p.pos.y - this.guardSole.y - 0.003; // a few millimetres of IK residue is not a pinch
      const pr = i === 1 || i === 3 ? 1 : 0;
      if (d > pinch[pr]) pinch[pr] = d;
    }
    return pinch[0] > 0 || pinch[1] > 0;
  }

  /**
   * From guardSole, back along the straight line to where swinging paw i lifted off (a spot it just stood on, so the
   * line leaves the rock) to the first point outside every solid with no ground above it; that point → out (false:
   * none). guardHit is clobbered.
   */
  private backOut(i: number, out: THREE.Vector3): boolean {
    const from = this.planner.paws[i].from;
    const p = this.backProbe;
    for (let k = 1; k <= 10; k++) {
      p.lerpVectors(this.guardSole, from, k / 10);
      if (this.world.isInside(p)) continue;
      const g = this.world.groundAt(p.x, p.z, p.y + 1, 3, this.guardHit);
      if (g && g.point.y > p.y) continue;                   // free of the rock but still under some ground: not out
      out.copy(p).setY(p.y + 0.002);
      return true;
    }
    return false;
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

/** Solve the 3×3 system m · x = v (Cramer's rule); a singular system gives a flat plane at the mean height. */
function solve3(m: number[][], v: number[]): number[] {
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
    + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return [v[0] / m[0][0], 0, 0];
  return [0, 1, 2].map((k) => det(m.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)))) / d);
}
