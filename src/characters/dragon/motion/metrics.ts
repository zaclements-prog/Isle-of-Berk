import * as THREE from 'three';
import type { CollisionWorld, RayHit, SphereContact } from '../../../world/collision';
import type { DragonCharacter } from './dragon';

export interface MetricsReport {
  name: string;
  steps: number;
  seconds: number;
  maxSlip: number;
  maxPenetration: number;
  maxFloat: number;
  maxProxyPenetration: number;
  limitViolations: number;
  worstLimit: string;
  nanResets: number;
  /** Largest per-bone rotation from bind in the first / last 10 s (rad), for runs ≥ 30 s. */
  boundedFirst: number;
  boundedLast: number;
  pass: boolean;
  failures: string[];
}

/** Spec §8.2 pass criteria. */
export const METRIC_LIMITS = { slip: 0.01, penetration: 0.02, float: 0.02, proxy: 0.02, limitTolDeg: 0.5, boundedGrowth: 0.3, boundedMax: 2.8 };

const _sole = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _contact: SphereContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

/**
 * Per-step motion metrics (spec §8.2):
 * - planted-foot slip: the FK sole's drift from where it was when the paw planted
 * - paw penetration: any paw inside the ground, by its depth below the surface over it
 * - planted float: a planted sole above its ground
 * - body-proxy penetration, joint-limit violations, NaN resets
 * - boundedness: every non-root bone's max rotation in the last 10 s vs the first 10 s (the spin-bug check). It is
 *   measured from the bone's pose at the first sample, not from the bind: the folded wing ribs rest ~170° from their
 *   spread bind (Ruling 3), while a spinning bone still sweeps toward π from wherever it started.
 */
export class MotionMetrics {
  private steps = 0;
  private time = 0;
  private maxSlip = 0;
  private maxPen = 0;
  private maxFloat = 0;
  private maxProxy = 0;
  private violations = 0;
  private worstLimit = '';
  private worstExcess = 0;
  private nan = 0;
  private readonly locked: THREE.Vector3[] = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private readonly wasPlanted = [false, false, false, false];
  private first: number[] = [];
  private last: number[] = [];
  private rest: THREE.Quaternion[] = [];

  constructor(private readonly world: CollisionWorld, private readonly duration: number) {}

  sample(d: DragonCharacter): void {
    const dt = 1 / 120;
    const s = d.skeleton;
    if (!this.first.length) {
      this.first = new Array(s.count).fill(0);
      this.last = new Array(s.count).fill(0);
      this.rest = s.localQuat.map((q) => q.clone());
    }
    for (let i = 0; i < 4; i++) {
      const paw = d.planner.paws[i];
      d.legs.soleWorld(i, s, _sole);
      // penetration is the depth up to the surface above a sole inside a solid, however deep (a ray from a fixed
      // height above it would start inside too, and miss)
      const depth = this.world.depthInside(_sole, 50);
      if (depth > 0) this.maxPen = Math.max(this.maxPen, depth);
      if (paw.planted) {
        if (!this.wasPlanted[i] || paw.justPlanted) this.locked[i].copy(_sole);
        this.maxSlip = Math.max(this.maxSlip, _sole.distanceTo(this.locked[i]));
        if (depth < 0 && this.world.groundAt(_sole.x, _sole.z, _sole.y, 3, _hit)) this.maxFloat = Math.max(this.maxFloat, _sole.y - _hit.point.y);
      }
      this.wasPlanted[i] = paw.planted;
    }
    d.proxies.update(s);
    d.proxies.items.forEach((p, k) => {
      const c = this.world.sphereContact(d.proxies.centers[k], p.radius, _contact);
      if (c) this.maxProxy = Math.max(this.maxProxy, c.depth);
    });
    const tol = (METRIC_LIMITS.limitTolDeg * Math.PI) / 180;
    for (const j of d.legs.jointReport(s)) {
      const excess = Math.max(j.lo - j.angle, j.angle - j.hi);
      if (excess > tol) {
        this.violations++;
        if (excess > this.worstExcess) {
          this.worstExcess = excess;
          this.worstLimit = j.name;
        }
      }
    }
    this.nan = d.nanResets;
    for (let b = 0; b < s.count; b++) {
      if (s.parent[b] < 0) continue; // the root carries the world heading
      const a = 2 * Math.acos(Math.min(1, Math.abs(s.localQuat[b].dot(this.rest[b]))));
      if (this.time < 10) this.first[b] = Math.max(this.first[b], a);
      if (this.time >= this.duration - 10) this.last[b] = Math.max(this.last[b], a);
    }
    this.steps++;
    this.time += dt;
  }

  report(name: string): MetricsReport {
    const L = METRIC_LIMITS;
    const failures: string[] = [];
    if (this.maxSlip > L.slip) failures.push(`slip ${this.maxSlip.toFixed(4)} m > ${L.slip}`);
    if (this.maxPen > L.penetration) failures.push(`penetration ${this.maxPen.toFixed(4)} m > ${L.penetration}`);
    if (this.maxFloat > L.float) failures.push(`float ${this.maxFloat.toFixed(4)} m > ${L.float}`);
    if (this.maxProxy > L.proxy) failures.push(`proxy penetration ${this.maxProxy.toFixed(4)} m > ${L.proxy}`);
    if (this.violations > 0) failures.push(`${this.violations} joint-limit violations (worst ${this.worstLimit})`);
    if (this.nan > 0) failures.push(`${this.nan} NaN resets`);
    let bf = 0;
    let bl = 0;
    if (this.duration >= 30) {
      for (let b = 0; b < this.first.length; b++) {
        bf = Math.max(bf, this.first[b]);
        bl = Math.max(bl, this.last[b]);
        if (this.last[b] > this.first[b] + L.boundedGrowth || this.last[b] > L.boundedMax) {
          failures.push(`bone #${b} rotation grew ${this.first[b].toFixed(2)} → ${this.last[b].toFixed(2)} rad`);
          break;
        }
      }
    }
    return {
      name, steps: this.steps, seconds: this.time, maxSlip: this.maxSlip, maxPenetration: this.maxPen, maxFloat: this.maxFloat,
      maxProxyPenetration: this.maxProxy, limitViolations: this.violations, worstLimit: this.worstLimit, nanResets: this.nan,
      boundedFirst: bf, boundedLast: bl, pass: failures.length === 0, failures,
    };
  }
}
