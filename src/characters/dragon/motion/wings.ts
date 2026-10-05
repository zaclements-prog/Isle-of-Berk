import * as THREE from 'three';
import type { PoseLayerStack, PosesMeta } from './poseLayers';
import type { MotionRig } from './rigTypes';
import type { RigSkeleton } from './skeleton';
import type { MotionTuning } from './tuning';
import { clamp, deg, lerp } from './math';
import { stepSpring, type SpringState } from './springs';

export interface WingState {
  /** 0 = spread (bind) … 1 = folded. */
  fold: number;
  /** Extra humerus rotation about its local X (rad, + raises the folded bundle's rear). */
  lift: number;
  /** 0 … 1: the folded wing swings off the flank (local Z, mirrored per side) and lifts a little. */
  flare: number;
}

const KEYS = ['fold', 'lift', 'flare'] as const;
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/**
 * The main and hip wings (spec §5.4, §6.6, §6.9, §6.13). The fold drives Plan 3's merged `wingFold` layer (Ruling 3:
 * one multi-key clip over rig.json wings.L.foldClips, sampled at the fold amount, so it only ever slerps between
 * neighbouring samples); without it, `wings_folded` by weight. After the layers, the folded humerus gets its flare and
 * lift. Target: folded, blended toward each live pose layer's `wings` metadata by its weight, then toward named demands
 * (the climb's balance flare, the jump); every channel follows its target through a critically damped spring, so a
 * layer change never pops. This is the ONLY writer of the fold layer once M6 is in.
 */
export class WingController {
  readonly state: WingState = { fold: 1, lift: 0, flare: 0 };
  readonly target: WingState = { fold: 1, lift: 0, flare: 0 };
  private readonly springs: Record<keyof WingState, SpringState> = { fold: { x: 1, v: 0 }, lift: { x: 0, v: 0 }, flare: { x: 0, v: 0 } };
  private readonly demands = new Map<string, { state: Partial<WingState>; weight: number }>();
  private readonly humerus: Array<{ bone: number; side: number }>;
  private readonly flareRad: number;
  private readonly flareLiftRad: number;
  private readonly foldLayer: 'wingFold' | 'wings_folded' | null;

  constructor(
    rig: MotionRig, s: RigSkeleton, private readonly layers: PoseLayerStack, meta: PosesMeta, private readonly t: MotionTuning['wings'],
  ) {
    this.foldLayer = layers.has('wingFold') ? 'wingFold' : layers.has('wings_folded') ? 'wings_folded' : null;
    this.humerus = [{ bone: s.id(rig.wings.L.humerus), side: 1 }, { bone: s.id(rig.wings.R.humerus), side: -1 }];
    this.flareRad = deg(meta.wingFlare?.deg ?? 25);
    this.flareLiftRad = deg(meta.wingFlare?.liftDeg ?? 8);
  }

  /** false on a rig without fold clips (the fixture): flare and lift still apply, the fold does nothing. */
  get available(): boolean {
    return this.foldLayer !== null;
  }

  /** A named request (e.g. 'climb') blended over the layer targets by `weight`; null removes it. */
  demand(source: string, state: Partial<WingState> | null, weight = 1): void {
    if (!state || weight <= 0) this.demands.delete(source);
    else this.demands.set(source, { state, weight: Math.min(weight, 1) });
  }

  /** Snap to the current target (spawn / teleport). */
  settle(): void {
    for (const k of KEYS) {
      this.springs[k].x = this.state[k] = this.target[k];
      this.springs[k].v = 0;
    }
    this.driveFold();
  }

  /** Target from the live layers and demands, springs, then the fold layer — call before PoseLayerStack.apply. */
  update(dt: number): void {
    const g = this.target;
    g.fold = 1;
    g.lift = 0;
    g.flare = 0;
    for (const l of this.layers.active()) {
      const w = l.meta.wings;
      if (!w) continue;
      for (const k of KEYS) g[k] = lerp(g[k], w[k], l.weight);
    }
    for (const d of this.demands.values()) {
      for (const k of KEYS) {
        const v = d.state[k];
        if (v !== undefined) g[k] = lerp(g[k], v, d.weight);
      }
    }
    for (const k of KEYS) {
      stepSpring(this.springs[k], g[k], this.t.omega, 1, dt);
      this.state[k] = this.springs[k].x;
    }
    this.state.fold = clamp(this.state.fold, 0, 1);
    this.state.flare = Math.max(0, this.state.flare);
    this.driveFold();
  }

  /** Flare and lift on the humerus (post-multiplied on its local axes) — call after PoseLayerStack.apply. */
  apply(s: RigSkeleton): void {
    const { flare, lift } = this.state;
    if (flare === 0 && lift === 0) return;
    for (const h of this.humerus) {
      s.localQuat[h.bone]
        .multiply(_qa.setFromAxisAngle(AZ, -h.side * this.flareRad * flare))
        .multiply(_qb.setFromAxisAngle(AX, lift + this.flareLiftRad * flare));
    }
  }

  private driveFold(): void {
    if (this.foldLayer === 'wingFold') this.layers.set('wingFold', 1, this.state.fold);
    else if (this.foldLayer === 'wings_folded') this.layers.set('wings_folded', this.state.fold);
  }
}
