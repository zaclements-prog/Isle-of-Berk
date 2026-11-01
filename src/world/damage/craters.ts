import * as THREE from 'three';
import type { CollisionWorld } from '../collision';
import type { BlastEvent, WorldEvents } from '../events';
import type { Heightfield } from '../terrain/heightfield';

export interface CraterTuning {
  /** Crater radius as a fraction of the blast radius; depth (m) at power 1; the lip's height (m) and width (× radius). */
  radius: number;
  depth: number;
  lip: number;
  lipWidth: number;
  /** Rock (steep ground) gives way this much less than soil. */
  rock: number;
  /** The deepest (m) repeated blasts can dig below the original ground. */
  maxDepth: number;
}

export const DEFAULT_CRATER: CraterTuning = { radius: 0.55, depth: 1.3, lip: 0.35, lipWidth: 0.45, rock: 0.3, maxDepth: 5 };

/** Everything that has to follow the heightfield when it changes. */
export interface CraterTargets {
  /** Rebuild the render chunks over a world rectangle [x0, z0, x1, z1]. */
  refreshTerrain?: (rect: readonly [number, number, number, number]) => void;
  /** The collision world whose static tiles (`tileLayer(i, j)`, `tile` m) are the terrain. */
  collision?: CollisionWorld;
  tile?: number;
  /** The half-float height texture the water and grass read (one texel per sample). */
  heightTexture?: THREE.DataTexture;
  /** Anything else (the grass ring, props). */
  changed?: (rect: readonly [number, number, number, number]) => void;
}

/**
 * Blast craters (world-interaction plan §4, milestone 4): a blast at the ground digs a bowl with a raised lip into the
 * heightfield — deeper with power, shallower in rock, deepening with repeated blasts down to a limit — and then
 * everything built from the heightfield follows: the render chunks over it, the collision tiles (re-sampled), the
 * height texture and whatever else asks (the grass ring).
 */
export class Craters {
  private readonly original: Float32Array;
  private readonly off: () => void;
  /** Milliseconds the last crater took (deformation and every rebuild), for the budget. */
  lastMs = 0;

  constructor(
    private readonly hf: Heightfield,
    private readonly targets: CraterTargets,
    events: WorldEvents | null,
    private readonly t: CraterTuning = DEFAULT_CRATER,
  ) {
    this.original = hf.heights.slice();
    this.off = events?.on('blast', (e) => this.blast(e)) ?? (() => {});
  }

  blast(e: BlastEvent): void {
    const above = e.point.y - this.hf.heightAt(e.point.x, e.point.z);
    const R = e.radius * this.t.radius;
    if (above > R) return; // an air burst leaves the ground alone
    const k = 1 - Math.max(0, above) / R;
    this.dig(e.point.x, e.point.z, R, this.t.depth * e.power * k);
  }

  /** Dig a crater of radius R (m) and depth (m) at (x, z), then rebuild what depends on the ground. */
  dig(x: number, z: number, R: number, depth: number): void {
    const t0 = performance.now();
    const hf = this.hf;
    const t = this.t;
    const reach = R * (1 + t.lipWidth * 1.6);
    const i0 = Math.max(0, Math.floor((x - reach - hf.origin) / hf.spacing));
    const i1 = Math.min(hf.size - 1, Math.ceil((x + reach - hf.origin) / hf.spacing));
    const j0 = Math.max(0, Math.floor((z - reach - hf.origin) / hf.spacing));
    const j1 = Math.min(hf.size - 1, Math.ceil((z + reach - hf.origin) / hf.spacing));
    if (i0 > i1 || j0 > j1) return;
    const n = new THREE.Vector3();
    const delta = new Float32Array((i1 - i0 + 1) * (j1 - j0 + 1));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = hf.coord(i) - x;
        const dz = hf.coord(j) - z;
        // a little raggedness so craters are never perfect circles
        const d = Math.hypot(dx, dz) / R * (1 + 0.08 * Math.sin(Math.atan2(dz, dx) * 4 + x * 0.7));
        let h = 0;
        if (d < 1) h -= depth * (1 - d * d) ** 2 + t.lip * 0.4 * (1 - d * d);
        const w = (d - 1) / t.lipWidth;
        h += t.lip * Math.min(1, depth / t.depth) * Math.exp(-w * w * 2.2) * (d < 1 ? d * d : 1);
        if (h === 0) continue;
        const steep = 1 - hf.vertexNormal(i, j, n).y;
        h *= THREE.MathUtils.lerp(1, t.rock, THREE.MathUtils.smoothstep(steep, 0.15, 0.4));
        delta[(j - j0) * (i1 - i0 + 1) + (i - i0)] = h;
      }
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * hf.size + i;
        const v = hf.heights[k] + delta[(j - j0) * (i1 - i0 + 1) + (i - i0)];
        hf.heights[k] = Math.max(v, this.original[k] - t.maxDepth);
      }
    }
    const rect = [hf.coord(i0), hf.coord(j0), hf.coord(i1), hf.coord(j1)] as const;
    this.targets.refreshTerrain?.(rect);
    this.retile(rect);
    this.updateHeightTexture(i0, j0, i1, j1);
    this.targets.changed?.(rect);
    this.lastMs = performance.now() - t0;
  }

  /** Re-sample the terrain collision tiles over the rectangle from the heightfield (their vertices sit on samples). */
  private retile(rect: readonly [number, number, number, number]): void {
    const w = this.targets.collision;
    if (!w) return;
    const tile = this.targets.tile ?? 64;
    const hf = this.hf;
    const pad = hf.spacing * 2; // a coarse cell whose centroid is in a neighbour tile can still reach in
    for (let ti = Math.floor((rect[0] - pad) / tile); ti <= Math.floor((rect[2] + pad) / tile); ti++) {
      for (let tj = Math.floor((rect[1] - pad) / tile); tj <= Math.floor((rect[3] + pad) / tile); tj++) {
        const layer = w.tileLayer(ti, tj);
        if (!layer) continue;
        // the triangles keep their vertices, only the heights move: refit the tile's BVH, don't rebuild it
        w.refitLayer(layer, (pos) => {
          let touched = false;
          for (let v = 0; v < pos.length; v += 3) {
            const x = pos[v];
            const z = pos[v + 2];
            if (x < rect[0] - pad || x > rect[2] + pad || z < rect[1] - pad || z > rect[3] + pad) continue;
            const y = hf.sample(Math.round((x - hf.origin) / hf.spacing), Math.round((z - hf.origin) / hf.spacing));
            if (y !== pos[v + 1]) {
              pos[v + 1] = y;
              touched = true;
            }
          }
          return touched;
        });
      }
    }
  }

  private updateHeightTexture(i0: number, j0: number, i1: number, j1: number): void {
    const tex = this.targets.heightTexture;
    if (!tex) return;
    const data = tex.image.data as Uint16Array;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) data[j * this.hf.size + i] = THREE.DataUtils.toHalfFloat(this.hf.heights[j * this.hf.size + i]);
    tex.needsUpdate = true;
  }

  dispose(): void {
    this.off();
  }
}
