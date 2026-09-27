import * as THREE from 'three';
import type { Heightfield } from './heightfield';

/** 160 cells × 0.4 m = 64 m chunks (spec §7.3). */
export const CHUNK_CELLS = 160;
/** Vertex step (in grid cells) per LOD: 0.4, 0.8, 1.6, 3.2 m. */
export const LOD_STEPS = [1, 2, 4, 8] as const;

/** A chunk: an inclusive range of grid vertex indices on each axis. */
export interface ChunkCoord {
  cx: number;
  cz: number;
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** Tiles the grid's (size − 1)² cells with chunks of `cells` cells; the last row/column may be shorter. */
export function chunkGrid(size: number, cells = CHUNK_CELLS): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  const last = size - 1;
  const n = Math.ceil(last / cells);
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      out.push({ cx, cz, i0: cx * cells, i1: Math.min(last, (cx + 1) * cells), j0: cz * cells, j1: Math.min(last, (cz + 1) * cells) });
    }
  }
  return out;
}

/** i0, i0 + step, …, always ending exactly on i1 (a shorter last step if the range is not a multiple). */
export function stepIndices(i0: number, i1: number, step: number): number[] {
  const out: number[] = [];
  for (let i = i0; i < i1; i += step) out.push(i);
  out.push(i1);
  return out;
}

/**
 * World-space chunk mesh at one LOD, with skirts (strips hanging `skirtDepth` metres below every border, both
 * windings) that hide cracks between neighbours at different LODs. Normals come from the full-resolution grid at
 * every LOD so lighting does not change when a chunk switches.
 */
export function buildChunkGeometry(hf: Heightfield, c: ChunkCoord, step: number, skirtDepth: number): THREE.BufferGeometry {
  const is = stepIndices(c.i0, c.i1, step);
  const js = stepIndices(c.j0, c.j1, step);
  const nx = is.length;
  const nz = js.length;
  const borderCount = 2 * (nx + nz) - 4;
  const vertCount = nx * nz + borderCount;
  const pos = new Float32Array(vertCount * 3);
  const nrm = new Float32Array(vertCount * 3);
  const n = new THREE.Vector3();
  let v = 0;
  const put = (i: number, j: number, drop: number) => {
    hf.vertexNormal(i, j, n);
    pos[v * 3] = hf.coord(i);
    pos[v * 3 + 1] = hf.sample(i, j) - drop;
    pos[v * 3 + 2] = hf.coord(j);
    nrm[v * 3] = n.x;
    nrm[v * 3 + 1] = n.y;
    nrm[v * 3 + 2] = n.z;
    return v++;
  };
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) put(is[a], js[b], 0);
  const idx: number[] = [];
  const at = (a: number, b: number) => b * nx + a;
  for (let b = 0; b < nz - 1; b++) {
    for (let a = 0; a < nx - 1; a++) {
      const v00 = at(a, b);
      const v10 = at(a + 1, b);
      const v01 = at(a, b + 1);
      const v11 = at(a + 1, b + 1);
      idx.push(v00, v01, v10, v10, v01, v11); // CCW seen from +Y; diagonal (i, j+1)–(i+1, j)
    }
  }
  // border loop (clockwise-agnostic): top row, right column, bottom row reversed, left column reversed
  const loop: Array<[number, number]> = [];
  for (let a = 0; a < nx; a++) loop.push([a, 0]);
  for (let b = 1; b < nz; b++) loop.push([nx - 1, b]);
  for (let a = nx - 2; a >= 0; a--) loop.push([a, nz - 1]);
  for (let b = nz - 2; b >= 1; b--) loop.push([0, b]);
  const skirt = loop.map(([a, b]) => put(is[a], js[b], skirtDepth));
  for (let k = 0; k < loop.length; k++) {
    const k2 = (k + 1) % loop.length;
    const t0 = at(loop[k][0], loop[k][1]);
    const t1 = at(loop[k2][0], loop[k2][1]);
    const s0 = skirt[k];
    const s1 = skirt[k2];
    idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(vertCount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Axis-aligned bounds of a chunk from the grid (min/max height over its samples). */
export function chunkBounds(hf: Heightfield, c: ChunkCoord, out = new THREE.Box3()): THREE.Box3 {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = c.j0; j <= c.j1; j++) {
    for (let i = c.i0; i <= c.i1; i++) {
      const h = hf.sample(i, j);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  out.min.set(hf.coord(c.i0), lo, hf.coord(c.j0));
  out.max.set(hf.coord(c.i1), hi, hf.coord(c.j1));
  return out;
}

/**
 * LOD for a chunk at `distance` metres, given ascending switch distances (LOD k is used up to thresholds[k]).
 * Hysteresis keeps the current LOD until the distance clears the switch by `hysteresis` (fraction) either way.
 */
export function selectLod(distance: number, current: number, thresholds: readonly number[], hysteresis = 0.08): number {
  let target = thresholds.length;
  for (let k = 0; k < thresholds.length; k++) {
    if (distance < thresholds[k]) {
      target = k;
      break;
    }
  }
  if (target === current || current < 0) return target;
  if (target > current) return distance > thresholds[current] * (1 + hysteresis) ? target : current;
  return distance < thresholds[current - 1] * (1 - hysteresis) ? target : current;
}
