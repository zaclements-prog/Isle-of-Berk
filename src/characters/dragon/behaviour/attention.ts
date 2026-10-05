import * as THREE from 'three';
import type { MotionTuning } from '../motion/tuning';
import { angleDiff, clamp, deg, smoothstep } from '../motion/math';

/**
 * Something worth looking at — structurally the Cove Region's InterestPoint (Plan 5a `src/world/region.ts`), so a
 * region's live `interestPoints` array plugs straight in; Plan 5b's fish and butterflies move their `position`s.
 */
export interface InterestPoint {
  readonly id: string;
  readonly kind: string;
  readonly position: THREE.Vector3;
  readonly weight: number;
}

/** Where interest comes from: live lists (read afresh on every query, never copied) and single registered points. */
export class InterestField {
  private readonly lists: Array<ReadonlyArray<InterestPoint>> = [];
  private readonly points = new Map<string, InterestPoint>();

  /** A live array — e.g. `region.interestPoints`; later pushes and position changes are seen. Returns the undo. */
  addList(list: ReadonlyArray<InterestPoint>): () => void {
    this.lists.push(list);
    return () => {
      const i = this.lists.indexOf(list);
      if (i >= 0) this.lists.splice(i, 1);
    };
  }

  register(p: InterestPoint): () => void {
    this.points.set(p.id, p);
    return () => {
      if (this.points.get(p.id) === p) this.points.delete(p.id);
    };
  }

  /** Every point, into `out` (reused; no allocation per query). */
  collect(out: InterestPoint[]): InterestPoint[] {
    out.length = 0;
    for (const l of this.lists) for (const p of l) out.push(p);
    for (const p of this.points.values()) out.push(p);
    return out;
  }
}

export interface AttentionInput {
  readonly headPos: THREE.Vector3;
  readonly heading: number;
  readonly speed: number;
  /** The plasma aim point while charging/firing (the top priority), else null. */
  readonly aim: THREE.Vector3 | null;
}

type AttentionTuning = MotionTuning['attention'];
const _d = new THREE.Vector3();

/**
 * Who he looks at (spec §6.8), top priority first: the plasma aim; then interest points, scored by weight, proximity,
 * a view cone (narrow while moving: he glances at a butterfly in his path, not behind him), motion (fish and
 * butterflies beat rocks) and boredom (after `dwell` seconds on one point it is ignored for `bored` seconds), with
 * hysteresis so the gaze does not flicker between two points. Below that, the LookController's own priorities apply
 * (travel direction, the camera when idle, random glances): update() returns false and the brain releases the look.
 */
export class Attention {
  mode: 'aim' | 'interest' | 'none' = 'none';
  target: InterestPoint | null = null;
  readonly point = new THREE.Vector3();
  private dwell = 0;
  private readonly bored = new Map<string, number>();
  private readonly last = new Map<string, THREE.Vector3>();
  private readonly speeds = new Map<string, number>();
  private readonly all: InterestPoint[] = [];

  constructor(private readonly t: AttentionTuning) {}

  update(inp: AttentionInput, field: InterestField, dt: number): boolean {
    for (const [id, left] of this.bored) {
      if (left - dt <= 0) this.bored.delete(id);
      else this.bored.set(id, left - dt);
    }
    const points = field.collect(this.all);
    for (const p of points) {
      const prev = this.last.get(p.id);
      if (prev) {
        this.speeds.set(p.id, prev.distanceTo(p.position) / Math.max(dt, 1e-6));
        prev.copy(p.position);
      } else {
        this.last.set(p.id, p.position.clone());
        this.speeds.set(p.id, 0);
      }
    }
    if (inp.aim) {
      this.mode = 'aim';
      this.target = null;
      this.point.copy(inp.aim);
      return true;
    }
    if (this.target && this.dwell > this.t.dwell) {
      this.bored.set(this.target.id, this.t.bored);        // watched long enough: look for something else now
      this.target = null;
      this.dwell = 0;
    }
    let best: InterestPoint | null = null;
    let bestScore = 0;
    let current = 0;
    for (const p of points) {
      const sc = this.score(p, inp);
      if (p === this.target) current = sc;
      if (sc > bestScore) {
        bestScore = sc;
        best = p;
      }
    }
    const keep = this.target !== null && current > this.t.exit && !(best !== this.target && bestScore > current * this.t.switchRatio);
    if (!keep) {
      const next: InterestPoint | null = bestScore > this.t.enter ? best : null;
      if (next !== this.target) this.dwell = 0;
      this.target = next;
    }
    if (!this.target) {
      this.mode = 'none';
      return false;
    }
    this.dwell += dt;
    this.mode = 'interest';
    this.point.copy(this.target.position);
    return true;
  }

  score(p: InterestPoint, inp: AttentionInput): number {
    const t = this.t;
    if (this.bored.has(p.id)) return 0;
    _d.subVectors(p.position, inp.headPos);
    const dist = _d.length();
    if (dist > t.maxDist) return 0;
    const off = Math.abs(angleDiff(inp.heading, Math.atan2(_d.x, _d.z)));
    const moving = inp.speed > t.movingSpeed;
    const cone = moving
      ? 1 - smoothstep(deg(t.moveCone) * 0.6, deg(t.moveCone), off)
      : 1 - 0.6 * smoothstep(deg(t.stillCone) * 0.4, deg(t.stillCone), off);
    const near = 1 - smoothstep(t.near, t.maxDist, dist);
    const motion = 1 + t.motionBonus * clamp((this.speeds.get(p.id) ?? 0) / 1.5, 0, 1);
    return p.weight * near * cone * motion * (moving ? t.movingFactor : 1);
  }
}
