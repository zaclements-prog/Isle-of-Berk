import * as THREE from 'three';
import { mulberry32 } from '../../../core/rng';
import { FaceController, createFaceInput } from '../face/face';
import { FaceRig } from '../face/faceRig';
import type { DragonCharacter } from '../motion/dragon';
import type { MotionRig } from '../motion/rigTypes';
import { smoothstep } from '../motion/math';
import { stepSpring, type SpringState } from '../motion/springs';
import { Attention, InterestField } from './attention';
import { BehaviourSystem } from './behaviours';

/** An action (jump, plasma) the brain runs before the behaviours' look and face (spec §6.13). */
export interface DragonAction {
  readonly name: string;
  /** Running: behaviours pause, the idle clock resets. */
  readonly active: boolean;
  /** Plasma aim point while charging/firing — the top look priority (spec §6.8). */
  readonly aim: THREE.Vector3 | null;
  /** Face mood input (plasma: aggressive). */
  readonly aggressive: boolean;
  /** Called every step in DragonCharacter.hooks.beforeMove, after the behaviours. `standing` = posture settled on stand. */
  step(d: DragonCharacter, dt: number, standing: boolean): void;
}

export interface BrainOptions {
  rig: MotionRig;
  seed?: number;
  /** Sun direction (toward the sun): bright light narrows the pupils. */
  sunDir?: THREE.Vector3;
  actions?: DragonAction[];
}

const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();

/**
 * Toothless's M6 layer over the motion core: attention (interest points + plasma aim), personality idles, actions,
 * face and mood. It only uses DragonCharacter's hooks, so the motion core stays species-agnostic:
 * - beforeMove: behaviours (idle clock, interrupts, posture chain, gestures) → actions → the look (aim > interest >
 *   behaviour request > the LookController's own travel / camera / glance priorities) and the look gain (0 asleep);
 * - face: FaceController from mood, layers and gaze → FaceRig writes the jaw and the ears' mood bias.
 * `face.state` is what applyExpression copies onto the asset every rendered frame.
 */
export class DragonBrain {
  readonly interest = new InterestField();
  readonly attention: Attention;
  readonly behaviours: BehaviourSystem;
  readonly face: FaceController;
  readonly faceRig: FaceRig;
  readonly actions: DragonAction[];
  private readonly input = createFaceInput();
  private readonly gain: SpringState = { x: 1, v: 0 };
  private readonly head = new THREE.Vector3();
  private readonly sunDir: THREE.Vector3;

  constructor(private readonly d: DragonCharacter, o: BrainOptions) {
    const t = d.tuning;
    const seed = o.seed ?? 1;
    this.attention = new Attention(t.attention);
    this.behaviours = new BehaviourSystem(d, t.behaviour, mulberry32(seed * 7919 + 17));
    this.face = new FaceController(t.face, mulberry32(seed * 104729 + 3));
    this.faceRig = new FaceRig(o.rig, d.skeleton);
    this.actions = o.actions ?? [];
    this.sunDir = o.sunDir ?? new THREE.Vector3(0, 0, 0);
    d.hooks.beforeMove.push((dd, dt) => this.think(dd, dt));
    d.hooks.face.push((dd, dt) => this.express(dd, dt));
  }

  /** berk.behaviour(name). */
  behaviour(name: string): string | string[] {
    return this.behaviours.force(name);
  }

  /** Standing and idle-fresh, no gesture (the lab page calls it when a script starts). */
  reset(): void {
    this.behaviours.reset();
  }

  private think(d: DragonCharacter, dt: number): void {
    const i = d.intent;
    const acting = this.actions.some((a) => a.active);
    const input = i.hasDir || i.jump || i.plasma || acting;
    this.behaviours.step({ input, mood: this.face.state.mood, interest: this.attention.mode === 'interest', cameraPos: d.cameraPos }, dt);
    const standing = this.behaviours.posture.settled && this.behaviours.posture.current === 'stand';
    for (const a of this.actions) a.step(d, dt, standing);
    const aim = this.actions.find((a) => a.aim)?.aim ?? null;
    d.headPos(this.head);
    const attending = this.attention.update({ headPos: this.head, heading: d.kin.heading, speed: d.kin.speed, aim }, this.interest, dt);
    const o = d.look.override;
    if (attending) {
      o.active = true;
      o.point.copy(this.attention.point);
    } else if (this.behaviours.lookActive) {
      o.active = true;
      o.point.copy(this.behaviours.lookPoint);
    } else o.active = false;
    const p = this.behaviours.posture;
    const asleep = p.current === 'sleep' || p.target === 'sleep' || p.hop?.top === 'sleep';   // curling up: the look lets go first
    let gain = asleep ? 0 : 1;
    for (const l of d.layers.active()) if (l.meta.look !== undefined) gain *= 1 - l.weight * (1 - l.meta.look);
    if (attending && this.attention.mode === 'aim') gain = 1;                                 // the plasma aim always turns the head
    stepSpring(this.gain, gain, d.tuning.behaviour.sleepLookOmega, 1, dt);
    d.look.gain = Math.min(1, Math.max(0, this.gain.x));
  }

  private express(d: DragonCharacter, dt: number): void {
    const f = this.input;
    const s = d.skeleton;
    f.exertion = d.secondary.exertion;
    f.gallopWeight = d.gait.gallopWeight;
    f.idle = this.behaviours.idle;
    f.interested = this.attention.mode === 'interest';
    f.aggressive = this.actions.some((a) => a.aggressive);
    f.headTurnRate = d.look.headYaw.v;
    _fwd.set(0, 1, 0).applyQuaternion(s.worldQuat[this.faceRig.head]);
    f.sunInFace = Math.max(0, _fwd.dot(this.sunDir)) * smoothstep(0.02, 0.2, this.sunDir.dot(UP));
    f.eyeYaw = d.look.eyeYaw.x;
    f.eyePitch = d.look.eyePitch.x;
    f.content = this.behaviours.content;
    f.wingFold = d.wings.state.fold;
    const st = this.face.update(f, d.layers.active(), dt);
    this.faceRig.apply(s, d.secondary, st);
  }
}
