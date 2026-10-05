import type { Mood } from '../face/face';
import type { MotionTuning } from '../motion/tuning';

export type Posture = 'stand' | 'sit' | 'lie' | 'sleep';

/** What a behaviour's utility reads. */
export interface BehaviourContext {
  /** Seconds without input (and without moving). */
  readonly idle: number;
  /** The settled posture. */
  readonly posture: Posture;
  readonly mood: Readonly<Record<Mood, number>>;
  /** Attention holds an interest point (a butterfly, a fish…). */
  readonly interest: boolean;
  /** Seconds since he last got up from lying or sleeping. */
  readonly sinceStoodUp: number;
}

export interface BehaviourDef {
  readonly name: string;
  /** 'posture' changes the posture (sit, lie, sleep); 'gesture' plays on top of it. */
  readonly kind: 'posture' | 'gesture';
  /** Idle seconds before it may start (spec §6.11: small ~2 s, sit ~10 s, lie ~25 s, asleep ~60 s). */
  readonly minIdle: number;
  /** Seconds after it ends before it may start again. */
  readonly cooldown: number;
  /** Postures it can start from. */
  readonly from: readonly Posture[];
  /** Utility (0 = not now); multiplied by randomness in pick(). */
  readonly utility: (c: BehaviourContext) => number;
}

type BehaviourTuning = MotionTuning['behaviour'];

/**
 * Utility-based selection with context, randomness and cooldowns (spec §6.11). pick() weighs every eligible
 * behaviour by its utility against a constant "carry on idling" weight and draws one with the seeded RNG. A behaviour
 * is eligible when the idle time has reached its threshold, the posture allows it, its cooldown (counted from when it
 * last ENDED) has passed and its utility is positive.
 */
export class BehaviourSelector {
  private readonly lastEnd = new Map<string, number>();
  private readonly running = new Set<string>();

  constructor(readonly defs: readonly BehaviourDef[], private readonly rng: () => number, private readonly t: BehaviourTuning) {}

  def(name: string): BehaviourDef | undefined {
    return this.defs.find((d) => d.name === name);
  }

  eligible(d: BehaviourDef, c: BehaviourContext, now: number): boolean {
    if (this.running.has(d.name) || c.idle < d.minIdle || !d.from.includes(c.posture)) return false;
    const end = this.lastEnd.get(d.name);
    if (end !== undefined && now - end < d.cooldown) return false;
    return d.utility(c) > 0;
  }

  pick(c: BehaviourContext, now: number): BehaviourDef | null {
    let total = this.t.restWeight;
    const cands: Array<[BehaviourDef, number]> = [];
    for (const d of this.defs) {
      if (!this.eligible(d, c, now)) continue;
      const u = d.utility(c);
      cands.push([d, u]);
      total += u;
    }
    let r = this.rng() * total - this.t.restWeight;
    if (r < 0) return null;
    for (const [d, u] of cands) {
      r -= u;
      if (r < 0) return d;
    }
    return cands.length ? cands[cands.length - 1][0] : null;
  }

  started(name: string): void {
    this.running.add(name);
  }

  ended(name: string, now: number): void {
    this.running.delete(name);
    this.lastEnd.set(name, now);
  }
}

const has = (c: BehaviourContext) => (c.interest ? 1 : 0);

/** The catalogue (spec §6.11). Utilities are relative weights; tune them in the Motion Lab. */
export const BEHAVIOURS: readonly BehaviourDef[] = [
  { name: 'sit', kind: 'posture', minIdle: 10, cooldown: 5, from: ['stand'], utility: () => 1.2 },
  { name: 'lie', kind: 'posture', minIdle: 25, cooldown: 5, from: ['sit'], utility: (c) => 0.8 + 1.5 * c.mood.tired },
  { name: 'sleep', kind: 'posture', minIdle: 60, cooldown: 5, from: ['lie'], utility: (c) => 3 * c.mood.tired },
  { name: 'look_around', kind: 'gesture', minIdle: 2, cooldown: 8, from: ['stand', 'sit', 'lie'], utility: () => 1 },
  { name: 'sniff', kind: 'gesture', minIdle: 2, cooldown: 10, from: ['stand'], utility: () => 0.8 },
  { name: 'stretch', kind: 'gesture', minIdle: 2, cooldown: 30, from: ['stand'], utility: (c) => (c.sinceStoodUp < 6 ? 2.5 : 0.25) },
  { name: 'shake', kind: 'gesture', minIdle: 3, cooldown: 25, from: ['stand'], utility: () => 0.35 },
  { name: 'yawn', kind: 'gesture', minIdle: 4, cooldown: 20, from: ['stand', 'sit', 'lie'], utility: (c) => 0.25 + 1.5 * c.mood.tired },
  { name: 'scratch', kind: 'gesture', minIdle: 10, cooldown: 15, from: ['sit'], utility: () => 0.8 },
  { name: 'watch', kind: 'gesture', minIdle: 2, cooldown: 4, from: ['stand', 'sit', 'lie'], utility: (c) => 3 * has(c) },
  { name: 'ear_twitch', kind: 'gesture', minIdle: 2, cooldown: 3, from: ['stand', 'sit', 'lie'], utility: () => 0.6 },
  { name: 'tail_flick', kind: 'gesture', minIdle: 2, cooldown: 3, from: ['stand', 'sit', 'lie'], utility: () => 0.6 },
  { name: 'glance_camera', kind: 'gesture', minIdle: 3, cooldown: 10, from: ['stand', 'sit', 'lie'], utility: () => 0.5 },
];
