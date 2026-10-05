import * as THREE from 'three';
import type { Mood } from '../face/face';
import type { DragonCharacter } from '../motion/dragon';
import type { MotionTuning } from '../motion/tuning';
import { clamp, deg, lerp, smoothstep } from '../motion/math';
import { loopTime } from '../motion/poseLayers';
import { BEHAVIOURS, BehaviourSelector, type BehaviourContext, type BehaviourDef, type Posture } from './selector';

type BehaviourTuning = MotionTuning['behaviour'];

const LAYER: Record<Posture, string | null> = { stand: null, sit: 'sit', lie: 'lie', sleep: 'sleep' };
/** Deeper postures apply after shallower ones (PoseLayerStack order), so a hop is always slerp(shallower, deeper, w). */
const ORDER: Record<Posture, number> = { stand: 0, sit: 0.1, lie: 0.2, sleep: 0.3 };
const DEPTH: Record<Posture, number> = { stand: 0, sit: 1, lie: 2, sleep: 3 };
const DOWN: Record<Posture, Posture | null> = { stand: 'sit', sit: 'lie', lie: 'sleep', sleep: null };
/** Getting up skips the sit: lie → stand, sleep → lie → stand (spec §6.10: he gets up from lying). */
const UP: Record<Posture, Posture | null> = { stand: null, sit: 'stand', lie: 'stand', sleep: 'lie' };
const GESTURE_ORDER = 1;

/**
 * Stand, sit, lie, sleep (spec §6.10–6.11): one hop at a time. A hop blends the deeper posture's layer over the
 * shallower one (whose layer, if any, holds at weight 1): its weight rises going down, falls getting up. A new target
 * mid-hop reverses it in place, so an interrupted lie-down turns straight into getting up.
 */
export class PostureController {
  current: Posture = 'stand';
  target: Posture = 'stand';
  hop: { base: Posture; top: Posture; p: number; dir: 1 | -1 } | null = null;

  constructor(private readonly d: DragonCharacter) {}

  get settled(): boolean {
    return !this.hop && this.current === this.target;
  }

  /** Posture weight of the deeper layer in the current hop (1 when settled below stand). */
  get depth(): number {
    return this.hop ? DEPTH[this.hop.base] + smoothstep(0, 1, this.hop.p) : DEPTH[this.current];
  }

  goTo(p: Posture): void {
    this.target = p;
  }

  /** Standing at once, every posture layer cleared (a lab script start). */
  reset(): void {
    for (const l of Object.values(LAYER)) if (l && this.d.layers.has(l)) this.d.layers.set(l, 0);
    this.current = this.target = 'stand';
    this.hop = null;
  }

  update(dt: number): void {
    const h0 = this.hop;
    if (h0) {
      if (h0.dir > 0 && DEPTH[this.target] <= DEPTH[h0.base]) h0.dir = -1;          // reverse an interrupted lie-down
      else if (h0.dir < 0 && DEPTH[this.target] >= DEPTH[h0.top]) h0.dir = 1;
    } else if (this.current !== this.target) {
      if (DEPTH[this.target] > DEPTH[this.current]) this.hop = { base: this.current, top: DOWN[this.current]!, p: 0, dir: 1 };
      else {
        const base = this.current === 'lie' && this.target === 'sit' ? 'sit' : UP[this.current]!;
        this.hop = { base, top: this.current, p: 1, dir: -1 };
      }
    }
    const h = this.hop;
    if (!h) {
      const l = LAYER[this.current];
      if (l) this.set(l, 1, this.current);
      return;
    }
    const top = LAYER[h.top]!;
    const m = this.d.layers.meta(top);
    const dur = Math.max((h.dir > 0 ? m?.blendIn : m?.blendOut) ?? 0.8, 1e-3);
    h.p = clamp(h.p + (h.dir * dt) / dur, 0, 1);
    const baseLayer = LAYER[h.base];
    if (baseLayer) this.set(baseLayer, 1, h.base);
    this.set(top, smoothstep(0, 1, h.p), h.top);
    if (h.dir > 0 && h.p >= 1) {
      if (baseLayer) this.set(baseLayer, 0, h.base);
      this.current = h.top;
      this.hop = null;
    } else if (h.dir < 0 && h.p <= 0) {
      this.set(top, 0, h.top);
      this.current = h.base;
      this.hop = null;
    }
  }

  private set(layer: string, w: number, p: Posture): void {
    if (this.d.layers.has(layer)) this.d.layers.set(layer, w, 0, false, ORDER[p]);
  }
}

interface Gesture {
  def: BehaviourDef;
  phase: 'enter' | 'loop' | 'exit';
  /** Time in the current phase. */
  t: number;
  /** Time since the gesture started (the clip's time). */
  clock: number;
  hold: number;
  layer: string | null;
  w: number;
  exitFrom: number;
  blendIn: number;
  blendOut: number;
  /** Exit by playing the clip backwards to frame 0 (its first frame is the pose beneath it). */
  reverse: boolean;
  duration: number;
  seed: number;
}

export interface BehaviourStepInput {
  /** Any movement or action input this step. */
  readonly input: boolean;
  readonly mood: Readonly<Record<Mood, number>>;
  readonly interest: boolean;
  readonly cameraPos: THREE.Vector3;
}

/**
 * Personality idles (spec §6.11): the posture chain plus one gesture at a time on top, chosen by the utility selector
 * while he idles, each with enter / loop / exit phases. Any input interrupts: the gesture plays its exit blend and the
 * posture chain gets him up, and he does not walk off until he is standing again. Outputs for the brain: a look
 * request (look around, glance at the camera) and a 0…1 "content" for the gummy smile. `force(name)` backs
 * `berk.behaviour(name)`.
 */
export class BehaviourSystem {
  readonly posture: PostureController;
  readonly selector: BehaviourSelector;
  gesture: Gesture | null = null;
  idle = 0;
  now = 0;
  sinceStoodUp = 99;
  readonly lookPoint = new THREE.Vector3();
  lookActive = false;
  content = 0;
  /** false: only forced behaviours play (scripted lab runs); the selector is not consulted. */
  autonomous = true;
  private think = 0;
  private queued: BehaviourDef | null = null;
  private readonly head = new THREE.Vector3();
  private wasDown = false;

  constructor(private readonly d: DragonCharacter, private readonly t: BehaviourTuning, private readonly rng: () => number) {
    this.posture = new PostureController(d);
    this.selector = new BehaviourSelector(BEHAVIOURS, rng, t);
  }

  get busy(): boolean {
    return this.gesture !== null || !(this.posture.settled && this.posture.current === 'stand');
  }

  /** Start a behaviour now (getting into the posture it needs first). Returns what happens, or the catalogue. */
  force(name: string): string | string[] {
    const def = this.selector.def(name);
    if (!def) return BEHAVIOURS.map((b) => b.name);
    this.idle = Math.max(this.idle, def.minIdle);
    if (def.kind === 'posture') {
      this.stopGesture();
      this.posture.goTo(name as Posture);
      return `posture → ${name}`;
    }
    if (!def.from.includes(this.posture.current) || !this.posture.settled) {
      this.posture.goTo(def.from[0]);
      this.queued = def;
      return `${def.from[0]}, then ${name}`;
    }
    this.startGesture(def);
    return name;
  }

  /** Standing, no gesture or queued behaviour, a fresh idle clock (a lab script start). */
  reset(): void {
    this.stopGesture();
    this.posture.reset();
    this.queued = null;
    this.idle = 0;
    this.think = 0;
    this.sinceStoodUp = 99;
    this.wasDown = false;
    this.lookActive = false;
    this.content = 0;
  }

  context(mood: Readonly<Record<Mood, number>>, interest: boolean): BehaviourContext {
    return { idle: this.idle, posture: this.posture.current, mood, interest, sinceStoodUp: this.sinceStoodUp };
  }

  step(inp: BehaviourStepInput, dt: number): void {
    const d = this.d;
    this.now += dt;
    if (inp.input) {
      this.idle = 0;
      this.queued = null;
      if (this.gesture && this.gesture.phase !== 'exit') this.exitGesture();
      if (this.posture.target !== 'stand') this.posture.goTo('stand');
    } else if (d.kin.speed < 0.2 && !d.mods.scripted) this.idle += dt;
    else this.idle = 0;
    this.posture.update(dt);
    const down = this.posture.current === 'lie' || this.posture.current === 'sleep';
    if (this.wasDown && this.posture.current === 'stand' && this.posture.settled) this.sinceStoodUp = 0;
    else this.sinceStoodUp += dt;
    this.wasDown = down || (this.wasDown && this.posture.current !== 'stand');
    this.stepGesture(inp, dt);
    // no walking or turning until he is standing (posed paws would slide round with the body)
    if (!(this.posture.settled && this.posture.current === 'stand')) {
      d.mods.speedCap = 0;
      d.intent.hasDir = false;
      d.intent.speed = 0;
    }
    if (this.queued && this.posture.settled && this.queued.from.includes(this.posture.current) && !this.gesture) {
      this.startGesture(this.queued);
      this.queued = null;
    }
    this.think -= dt;
    if (this.autonomous && !inp.input && !this.gesture && this.posture.settled && this.think <= 0) {
      this.think = this.t.thinkEvery;
      const def = this.selector.pick(this.context(inp.mood, inp.interest), this.now);
      if (def?.kind === 'posture') {
        this.posture.goTo(def.name as Posture);
        this.selector.started(def.name);
        this.selector.ended(def.name, this.now);
      } else if (def) this.startGesture(def);
    }
  }

  private startGesture(def: BehaviourDef): void {
    this.stopGesture();
    const layer = GESTURE_LAYER[def.name];
    const L = this.d.layers;
    const has = layer !== null && L.has(layer) && (def.name !== 'watch' || this.posture.current === 'stand');
    const m = has ? L.meta(layer!) : undefined;
    const dur = m?.duration ?? 0;
    const blendIn = m?.blendIn ?? 0.25;
    const blendOut = m?.blendOut ?? 0.25;
    const t = this.t;
    const r = this.rng();
    const holds: Record<string, number> = {
      look_around: t.lookAroundHold * 3, sniff: lerp(t.holdMin, t.holdMax, r), stretch: t.stretchHold, scratch: lerp(t.holdMin, t.holdMax, r),
      watch: lerp(t.watchMin, t.watchMax, r), ear_twitch: 0.5, tail_flick: 0.8, glance_camera: t.glanceHold,
    };
    // a one-shot clip plays once: its loop phase is whatever the blends leave of it
    const hold = dur > 0 && !m?.loop ? Math.max(0, dur - blendIn - blendOut) : holds[def.name] ?? 1;
    const reverse = m?.exit === 'reverse';
    this.gesture = {
      def, phase: 'enter', t: 0, clock: 0, hold: reverse ? hold + (m?.loopStart ?? 0) : hold, layer: has ? layer : null, w: 0, exitFrom: 0,
      blendIn, blendOut, reverse, duration: dur, seed: r,
    };
    this.selector.started(def.name);
    if (def.name === 'ear_twitch') {
      const e = this.d.secondary.ears[Math.min(this.d.secondary.ears.length - 1, Math.floor(r * this.d.secondary.ears.length))];
      if (e) e.s.v += (r < 0.5 ? -1 : 1) * t.twitchImpulse;
    } else if (def.name === 'tail_flick') {
      const ty = this.d.secondary.tailYaw;
      for (let k = Math.floor(ty.length / 2); k < ty.length; k++) ty[k].v += (r < 0.5 ? -1 : 1) * t.flickImpulse * (k / ty.length);
    }
  }

  private exitGesture(): void {
    const g = this.gesture!;
    g.exitFrom = g.w;
    g.phase = 'exit';
    g.t = 0;
    if (g.reverse && g.layer) g.clock = loopTime(this.d.layers.meta(g.layer)!, g.duration, g.clock);
  }

  private stopGesture(): void {
    const g = this.gesture;
    if (!g) return;
    if (g.layer) this.d.layers.set(g.layer, 0);
    this.selector.ended(g.def.name, this.now);
    this.gesture = null;
  }

  private stepGesture(inp: BehaviourStepInput, dt: number): void {
    this.lookActive = false;
    this.content = Math.max(0, this.content - dt * 2);
    const g = this.gesture;
    if (!g) return;
    g.t += dt;
    g.clock += g.phase === 'exit' && g.reverse ? -this.t.reverseRate * dt : dt;
    if (g.phase === 'enter') {
      g.w = g.blendIn > 0 ? smoothstep(0, g.blendIn, g.t) : 1;
      if (g.t >= g.blendIn) {
        g.phase = 'loop';
        g.t = 0;
      }
    } else if (g.phase === 'loop') {
      g.w = 1;
      const lostInterest = g.def.name === 'watch' && !inp.interest;
      if (g.t >= g.hold || lostInterest) this.exitGesture();
    } else if (g.reverse) {
      g.w = g.exitFrom;                                  // weight holds while the clip runs back to the pose beneath
      if (g.clock <= 0) {
        this.stopGesture();
        return;
      }
    } else {
      g.w = g.exitFrom * (1 - (g.blendOut > 0 ? smoothstep(0, g.blendOut, g.t) : 1));
      if (g.t >= g.blendOut) {
        this.stopGesture();
        return;
      }
    }
    if (g.layer) this.d.layers.set(g.layer, g.w, g.clock, false, GESTURE_ORDER);
    const d = this.d;
    const head = d.headPos(this.head);
    if (g.def.name === 'look_around') {
      const k = Math.min(2, Math.floor(g.clock / this.t.lookAroundHold));
      const yaw = d.kin.heading + deg([this.t.lookAroundYawDeg, -this.t.lookAroundYawDeg, 0][k]) * (g.seed < 0.5 ? 1 : -1);
      const pitch = deg(k === 2 ? 15 : 0);
      this.lookPoint.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(6).add(head);
      this.lookActive = g.phase !== 'exit';
    } else if (g.def.name === 'glance_camera') {
      this.lookPoint.copy(inp.cameraPos);
      this.lookActive = g.phase !== 'exit';
      this.content = Math.max(this.content, g.w);
    } else if (g.def.name === 'stretch' && g.phase === 'exit') {
      this.content = Math.max(this.content, g.exitFrom);
    }
  }
}

/** Library layer each gesture plays (null: look / impulse only). 'watch' stalks only while standing. */
const GESTURE_LAYER: Record<string, string | null> = {
  look_around: null, sniff: 'sniff', stretch: 'stretch', shake: 'shake', yawn: 'yawn', scratch: 'scratch', watch: 'stalk',
  ear_twitch: null, tail_flick: null, glance_camera: null,
};
