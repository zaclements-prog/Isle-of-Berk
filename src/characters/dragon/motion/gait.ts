import { clamp, fract, lerp, phaseDiff } from './math';

export type GaitName = 'walk' | 'trot' | 'gallop';

export interface GaitParams {
  readonly name: GaitName;
  readonly speedMin: number;
  readonly speedMax: number;
  /** Cadence (strides per second) at speedMin and speedMax. */
  readonly cadenceMin: number;
  readonly cadenceMax: number;
  readonly duty: number;
  /** Touchdown phase of each leg in LEG_KEYS order (LH, LF, RH, RF). */
  readonly offsets: readonly [number, number, number, number];
  readonly swingHeight: number;
}

/** Spec §6.3. */
export const GAITS: readonly GaitParams[] = [
  { name: 'walk', speedMin: 0, speedMax: 2.4, cadenceMin: 0.8, cadenceMax: 1.2, duty: 0.7, offsets: [0, 0.25, 0.5, 0.75], swingHeight: 0.12 },
  { name: 'trot', speedMin: 2.4, speedMax: 5.5, cadenceMin: 1.3, cadenceMax: 1.8, duty: 0.5, offsets: [0, 0.5, 0.5, 0], swingHeight: 0.18 },
  { name: 'gallop', speedMin: 5.5, speedMax: 10, cadenceMin: 1.9, cadenceMax: 2.4, duty: 0.33, offsets: [0, 0.65, 0.1, 0.55], swingHeight: 0.28 },
];

export interface GaitMods {
  cadenceScale: number;
  strideScale: number;
  swingScale: number;
}

export const NO_GAIT_MODS: GaitMods = { cadenceScale: 1, strideScale: 1, swingScale: 1 };

/**
 * One global phase drives all four legs: leg phase = fract(phase − offset[leg]); 0 = touchdown, stance while < duty.
 * Gait parameters crossfade linearly over `blendTime`. Offsets are blended ON THE CIRCLE as a weighted mean of the
 * shortest arcs around the dominant gait's offset. (A weighted unit-vector sum → atan2 sweeps up to ~0.06 phase per
 * step near a 50/50 blend of offsets 162° apart, e.g. RF trot 0 ↔ gallop 0.55; the arc mean moves uniformly with the
 * weights.) The phase freezes below `stopSpeed`.
 */
export class GaitEngine {
  phase = 0;
  active = 0;
  readonly weights: number[] = [1, 0, 0];
  readonly offsets: number[] = [...GAITS[0].offsets];
  cadence = 0;
  duty = GAITS[0].duty;
  swingHeight = GAITS[0].swingHeight;
  speed = 0;

  private maxTravel = Infinity;

  constructor(private readonly opts: { hysteresis: number; blendTime: number; stopSpeed: number; maxCadence?: number }) {}

  /**
   * Longest distance a planted paw may travel relative to the body during one stance (m). The cadence is raised when
   * the table cadence would make strides longer than the legs can reach (speed · duty / cadence ≤ maxTravel), up to
   * opts.maxCadence. Defaults to no limit.
   */
  setStrideLimit(maxTravel: number): void {
    this.maxTravel = maxTravel;
  }

  reset(): void {
    this.phase = 0;
    this.active = 0;
    this.weights.splice(0, 3, 1, 0, 0);
    this.offsets.splice(0, 4, ...GAITS[0].offsets);
    this.cadence = 0;
    this.duty = GAITS[0].duty;
    this.swingHeight = GAITS[0].swingHeight;
    this.speed = 0;
  }

  update(speed: number, dt: number, mods: GaitMods = NO_GAIT_MODS): void {
    this.speed = speed;
    const a = this.active;
    if (a < GAITS.length - 1 && speed > GAITS[a].speedMax + this.opts.hysteresis) this.active = a + 1;
    else if (a > 0 && speed < GAITS[a].speedMin - this.opts.hysteresis) this.active = a - 1;

    const rate = dt / this.opts.blendTime;
    let sum = 0;
    for (let g = 0; g < GAITS.length; g++) {
      const target = g === this.active ? 1 : 0;
      this.weights[g] += clamp(target - this.weights[g], -rate, rate);
      sum += this.weights[g];
    }
    for (let g = 0; g < GAITS.length; g++) this.weights[g] /= sum;

    let cadence = 0;
    let duty = 0;
    let swing = 0;
    for (let g = 0; g < GAITS.length; g++) {
      const w = this.weights[g];
      if (w === 0) continue;
      const p = GAITS[g];
      const k = clamp((speed - p.speedMin) / (p.speedMax - p.speedMin), 0, 1);
      cadence += w * lerp(p.cadenceMin, p.cadenceMax, k);
      duty += w * p.duty;
      swing += w * p.swingHeight;
    }
    let ref = 0;
    for (let g = 1; g < GAITS.length; g++) if (this.weights[g] > this.weights[ref]) ref = g;
    for (let leg = 0; leg < 4; leg++) {
      const base = GAITS[ref].offsets[leg];
      let o = base;
      for (let g = 0; g < GAITS.length; g++) if (g !== ref) o += this.weights[g] * phaseDiff(base, GAITS[g].offsets[leg]);
      this.offsets[leg] = fract(o);
    }
    this.duty = duty;
    this.swingHeight = swing * mods.swingScale;
    let c = (cadence * mods.cadenceScale) / mods.strideScale;
    const floor = (speed * duty) / (this.maxTravel * mods.strideScale);
    if (floor > c) c = Math.min(floor, Math.max(c, this.opts.maxCadence ?? Infinity));
    this.cadence = speed < this.opts.stopSpeed ? 0 : c;
    this.phase = fract(this.phase + this.cadence * dt);
  }

  legPhase(leg: number): number {
    return fract(this.phase - this.offsets[leg]);
  }

  inStance(leg: number): boolean {
    return this.legPhase(leg) < this.duty;
  }

  get stanceDuration(): number {
    return this.cadence > 0 ? this.duty / this.cadence : Infinity;
  }

  get swingDuration(): number {
    return this.cadence > 0 ? (1 - this.duty) / this.cadence : Infinity;
  }

  get strideLength(): number {
    return this.cadence > 0 ? this.speed / this.cadence : 0;
  }

  get gallopWeight(): number {
    return this.weights[2];
  }

  get name(): GaitName {
    return GAITS[this.active].name;
  }
}
