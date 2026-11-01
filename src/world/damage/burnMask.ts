import * as THREE from 'three';

export interface BurnTuning {
  /** Of a blast's radius: fully scorched inside `core`, scorched fading out to `edge`, grass flattened out to `flatten`. */
  core: number;
  edge: number;
  flatten: number;
  /** Seconds a full scorch takes to grow back, and a flattened patch to spring back up. */
  regrow: number;
  springBack: number;
}

export const DEFAULT_BURN_TUNING: BurnTuning = { core: 0.45, edge: 0.85, flatten: 1.5, regrow: 150, springBack: 9 };

/**
 * Where the ground is scorched and the grass burnt or flattened (world-interaction plan §4): a CPU grid over the
 * terrain, one texel per heightfield sample, uploaded as an RG texture (R scorch, G flatten) the terrain darkens by
 * and the grass shrinks and lies down by. Blasts write into it; it heals over time (scorch slowly, flattening fast),
 * only over the patches that are still healing.
 */
export class BurnMask {
  readonly texture: THREE.DataTexture;
  /** (start x, start z, 1 / width, 1 / depth): the same mapping as terrainUvTransform. */
  readonly extent: THREE.Vector4;
  private readonly scorch: Float32Array;
  private readonly flat: Float32Array;
  private readonly data: Uint8Array;
  private readonly patches: { i0: number; j0: number; i1: number; j1: number }[] = [];
  private uploadIn = 0;
  private changed = false;

  constructor(readonly size: number, readonly start: number, readonly texel: number, readonly t: BurnTuning = DEFAULT_BURN_TUNING) {
    this.scorch = new Float32Array(size * size);
    this.flat = new Float32Array(size * size);
    this.data = new Uint8Array(size * size * 2);
    this.texture = new THREE.DataTexture(this.data, size, size, THREE.RGFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    const inv = 1 / (size * texel);
    this.extent = new THREE.Vector4(start, start, inv, inv);
  }

  /** Scorch and flatten around (x, z) for a blast of this radius (m) and power. */
  burn(x: number, z: number, radius: number, power = 1): void {
    const t = this.t;
    const reach = radius * t.flatten;
    const i0 = Math.max(0, Math.floor((x - reach - this.start) / this.texel));
    const i1 = Math.min(this.size - 1, Math.ceil((x + reach - this.start) / this.texel));
    const j0 = Math.max(0, Math.floor((z - reach - this.start) / this.texel));
    const j1 = Math.min(this.size - 1, Math.ceil((z + reach - this.start) / this.texel));
    if (i0 > i1 || j0 > j1) return;
    const strength = Math.min(1, power);
    for (let j = j0; j <= j1; j++) {
      const cz = this.start + (j + 0.5) * this.texel;
      for (let i = i0; i <= i1; i++) {
        const cx = this.start + (i + 0.5) * this.texel;
        // a ragged edge, so a scorch is never a perfect disc
        const d = Math.hypot(cx - x, cz - z) / radius * (1 + 0.12 * Math.sin(Math.atan2(cz - z, cx - x) * 5 + x));
        const k = j * this.size + i;
        const s = (1 - THREE.MathUtils.smoothstep(d, t.core, t.edge)) * strength;
        if (s > this.scorch[k]) this.scorch[k] = s;
        const f = 1 - THREE.MathUtils.smoothstep(d, t.edge * 0.8, t.flatten);
        if (f > this.flat[k]) this.flat[k] = f;
      }
    }
    this.patches.push({ i0, j0, i1, j1 });
    this.encode(i0, j0, i1, j1);
  }

  /** Scorch (0…1) and flattening (0…1) at (x, z), nearest texel. */
  sample(x: number, z: number): { scorch: number; flat: number } {
    const i = Math.floor((x - this.start) / this.texel);
    const j = Math.floor((z - this.start) / this.texel);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return { scorch: 0, flat: 0 };
    const k = j * this.size + i;
    return { scorch: this.scorch[k], flat: this.flat[k] };
  }

  /** Heal: scorch fades over `regrow` s, flattening over `springBack` s. Uploads at most 4 times a second. */
  update(dt: number): void {
    if (!this.patches.length && !this.changed) return;
    const ds = dt / this.t.regrow;
    const df = dt / this.t.springBack;
    for (let p = this.patches.length - 1; p >= 0; p--) {
      const { i0, j0, i1, j1 } = this.patches[p];
      let live = false;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * this.size + i;
          if (this.scorch[k] > 0) this.scorch[k] = Math.max(0, this.scorch[k] - ds);
          if (this.flat[k] > 0) this.flat[k] = Math.max(0, this.flat[k] - df);
          if (this.scorch[k] > 0 || this.flat[k] > 0) live = true;
        }
      }
      if (!live) {
        this.encode(i0, j0, i1, j1, false);
        this.patches.splice(p, 1);
      }
    }
    this.uploadIn -= dt;
    if (this.uploadIn > 0) {
      this.changed = true;
      return;
    }
    this.uploadIn = 0.25;
    this.changed = false;
    for (const q of this.patches) this.encode(q.i0, q.j0, q.i1, q.j1, false);
    this.texture.needsUpdate = true;
  }

  private encode(i0: number, j0: number, i1: number, j1: number, upload = true): void {
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.size + i;
        this.data[k * 2] = Math.round(this.scorch[k] * 255);
        this.data[k * 2 + 1] = Math.round(this.flat[k] * 255);
      }
    }
    if (upload) this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
