import * as THREE from 'three';

/** `public/assets/world/cove/terrain.json` (written by pipeline/terrain/bake.mjs). */
export interface TerrainHeader {
  version: 1;
  size: number;
  spacing: number;
  origin: number;
  heightMin: number;
  heightMax: number;
  waterLevel: number;
  seed: number;
  pond: { cx: number; cz: number; a: number; b: number; angle: number; depth: number };
  floorRadius: number;
  rimRadius: number;
  wall: { mean: number; amp: number; sharpness: number; jitter: number };
  sun: { azimuth: number; elevation: number };
  gully: { azimuth: number; rStart: number; rEnd: number; halfWidthIn: number; halfWidthOut: number; blend: number; ease: number };
  routeA: { azimuth: number; rStart: number; steps: number; tread: number; rise: number; riserRun: number; halfWidth: number; blend: number };
  routeB: { azimuth: number; r0: number; r1: number; sharpness: number; halfWidth: number; blend: number };
  spawn: { x: number; z: number; heading: number }[];
  layers: string[];
  files: { height: string; splatA: string; splatB: string };
  stats: Record<string, number>;
}

/**
 * The baked terrain height grid. Sample (i, j) sits at (origin + i·spacing, origin + j·spacing); every quad is split
 * along the (i, j+1)–(i+1, j) diagonal — the same triangles the render chunks and the collision mesh use — and
 * `heightAt` interpolates on those triangles, so it agrees with both exactly.
 */
export class Heightfield {
  readonly size: number;
  readonly spacing: number;
  readonly origin: number;

  constructor(
    readonly header: TerrainHeader,
    readonly heights: Float32Array,
  ) {
    this.size = header.size;
    this.spacing = header.spacing;
    this.origin = header.origin;
    if (heights.length !== this.size * this.size) throw new Error(`heightfield: expected ${this.size ** 2} samples, got ${heights.length}`);
  }

  /** Decodes the bake's uint16 little-endian grid over [heightMin, heightMax]. */
  static fromUint16LE(header: TerrainHeader, bytes: ArrayBuffer | Uint8Array): Heightfield {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.byteLength !== header.size * header.size * 2) throw new Error(`heightfield: ${u8.byteLength} bytes for a ${header.size}² grid`);
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const out = new Float32Array(header.size * header.size);
    const scale = (header.heightMax - header.heightMin) / 65535;
    for (let k = 0; k < out.length; k++) out[k] = header.heightMin + view.getUint16(k * 2, true) * scale;
    return new Heightfield(header, out);
  }

  /** World x (or z) of sample index i. */
  coord(i: number): number {
    return this.origin + i * this.spacing;
  }

  /** Grid value with clamped indices. */
  sample(i: number, j: number): number {
    const n = this.size - 1;
    const ii = i < 0 ? 0 : i > n ? n : i;
    const jj = j < 0 ? 0 : j > n ? n : j;
    return this.heights[jj * this.size + ii];
  }

  /** Height on the render/collision triangles (clamped to the grid edge outside it). */
  heightAt(x: number, z: number): number {
    const n = this.size - 1;
    let fi = (x - this.origin) / this.spacing;
    let fj = (z - this.origin) / this.spacing;
    fi = fi < 0 ? 0 : fi > n ? n : fi;
    fj = fj < 0 ? 0 : fj > n ? n : fj;
    let i = Math.floor(fi);
    let j = Math.floor(fj);
    if (i === n) i = n - 1;
    if (j === n) j = n - 1;
    const u = fi - i;
    const v = fj - j;
    const h00 = this.heights[j * this.size + i];
    const h10 = this.heights[j * this.size + i + 1];
    const h01 = this.heights[(j + 1) * this.size + i];
    const h11 = this.heights[(j + 1) * this.size + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  /** Smooth surface normal from central differences of the grid, bilinearly interpolated. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const fi = (x - this.origin) / this.spacing;
    const fj = (z - this.origin) / this.spacing;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const g00 = this.gradient(i, j);
    const g10 = this.gradient(i + 1, j);
    const g01 = this.gradient(i, j + 1);
    const g11 = this.gradient(i + 1, j + 1);
    const gx = (g00[0] * (1 - u) + g10[0] * u) * (1 - v) + (g01[0] * (1 - u) + g11[0] * u) * v;
    const gz = (g00[1] * (1 - u) + g10[1] * u) * (1 - v) + (g01[1] * (1 - u) + g11[1] * u) * v;
    return out.set(-gx, 1, -gz).normalize();
  }

  /** Vertex normal of grid sample (i, j) — what the render chunks use at every LOD. */
  vertexNormal(i: number, j: number, out = new THREE.Vector3()): THREE.Vector3 {
    const [gx, gz] = this.gradient(i, j);
    return out.set(-gx, 1, -gz).normalize();
  }

  /** dh/dx, dh/dz at grid sample (i, j) by central differences (one-sided at the edges). */
  private gradient(i: number, j: number): [number, number] {
    const s = 2 * this.spacing;
    return [(this.sample(i + 1, j) - this.sample(i - 1, j)) / s, (this.sample(i, j + 1) - this.sample(i, j - 1)) / s];
  }
}
