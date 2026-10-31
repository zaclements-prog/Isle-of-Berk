import { GAITS, type GaitEngine } from './gait';
import { clamp, fract } from './math';
import type { LocoCycleMeta, PoseLayerStack, PosesMeta } from './poseLayers';
import type { MotionTuning } from './tuning';

type LocoTuning = MotionTuning['loco'];

interface Cycle {
  readonly clip: string;
  readonly meta: LocoCycleMeta;
  readonly duration: number;
  /** Index into GAITS (the gait engine's weights). */
  readonly gait: number;
}

/** Order of the cycle layers: under every library layer, so a pose (sit, the jump) overrides the body it shapes. */
export const LOCO_ORDER = -1;

/** A cycle curve (one value per frame over one loop) at phase p, linear between frames, wrapping. */
export function sampleLoop(curve: readonly number[], p: number): number {
  const n = curve.length;
  const x = fract(p) * n;
  const k = Math.floor(x);
  const u = x - k;
  return curve[k % n] * (1 - u) + curve[(k + 1) % n] * u;
}

/**
 * Authored locomotion (Plan 5). The walk, trot and gallop cycles baked in Blender (toothless.poses.glb, metadata in
 * poses.json `locomotion`) play as ADDITIVE pose layers on the pelvis, spine, neck, head and tail, each weighted by its
 * gait's weight in the gait engine and sampled at the gait phase (every cycle's phase 0 is LH touchdown, as in
 * gait.ts), so the authored body motion lands on the planner's real footfalls. The legs stay the planner's and the leg
 * IK's: the paws keep exact contact with the real ground. The cycles' pelvis bob and wing lift come out as numbers the
 * body solver and wing controller apply. The whole thing fades in with speed and out while suppressed (climbing, an
 * action owning the legs or the body, standing still), and is a no-op on a library without cycles.
 */
export class LocomotionDriver {
  readonly cycles: Cycle[];
  /** Overall authored weight (0…1) after its fade. */
  weight = 0;
  /** Pelvis bob (m) and wing lift (rad) of the blended cycles this step, already scaled by their weights. */
  bob = 0;
  wingLift = 0;
  /** Extra crouch (m) of the authored carriage, weighted: the cycles are built on a lower body than standing. */
  crouch = 0;

  constructor(
    private readonly layers: PoseLayerStack,
    meta: PosesMeta,
    private readonly t: LocoTuning,
  ) {
    this.cycles = Object.entries(meta.clips).flatMap(([clip, m]) => {
      const loco = m.locomotion;
      const gait = loco ? GAITS.findIndex((g) => g.name === loco.gait) : -1;
      if (!loco || gait < 0 || !layers.has(clip)) return [];
      return [{ clip, meta: loco, duration: m.duration ?? 0, gait }];
    });
  }

  get available(): boolean {
    return this.cycles.length > 0;
  }

  reset(): void {
    this.weight = 0;
    this.bob = 0;
    this.wingLift = 0;
    this.crouch = 0;
    for (const c of this.cycles) this.layers.set(c.clip, 0);
  }

  /**
   * Set this step's cycle layers. `suppress` (0…1) holds the cycles back: the climb weight, leg ownership by a library
   * pose or action, a scripted move. A tight turn (yaw rate / speed) fades them too: they are straight runs.
   */
  update(gait: GaitEngine, speed: number, yawRate: number, suppress: number, dt: number): void {
    const t = this.t;
    if (!this.available) return;
    const moving = clamp((speed - t.fadeSpeedLo) / Math.max(t.fadeSpeedHi - t.fadeSpeedLo, 1e-6), 0, 1);
    const curve = Math.abs(yawRate) / Math.max(speed, 0.1);
    const straight = 1 - clamp((curve - t.turnCurveLo) / Math.max(t.turnCurveHi - t.turnCurveLo, 1e-6), 0, 1);
    const target = gait.cadence > 0 ? moving * straight * (1 - clamp(suppress, 0, 1)) : 0;
    const up = dt / Math.max(t.blendTime, 1e-6);
    const down = dt / Math.max(t.fallTime, 1e-6);
    this.weight += clamp(target - this.weight, -down, up);
    this.bob = 0;
    this.wingLift = 0;
    this.crouch = 0;
    const phase = gait.phase;
    for (const c of this.cycles) {
      const w = this.weight * gait.weights[c.gait] * (t.gains[c.gait] ?? 1);
      this.layers.set(c.clip, w, phase * c.duration, true, LOCO_ORDER);
      if (w <= 0) continue;
      this.crouch += w * (t.crouch[c.gait] ?? 0);
      this.bob += w * sampleLoop(c.meta.rootBob, phase);
      this.wingLift += w * sampleLoop(c.meta.wingLift, phase);
    }
    this.bob *= t.bobGain;
  }
}
