// Masks derived from the final heightfield: slope, curvature, horizon AO, sun visibility, wetness and the
// six-layer splat weights (spec §7.3). All functions are pure over typed arrays (row-major, size × size).

export const LAYERS = ['grass', 'forest', 'moss', 'mud', 'pebbles', 'rock'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Surface slope in degrees (central differences; edges clamp). */
export function slopeField(h, size, spacing) {
  const out = new Float32Array(h.length);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const l = h[j * size + Math.max(0, i - 1)];
      const r = h[j * size + Math.min(size - 1, i + 1)];
      const d = h[Math.max(0, j - 1) * size + i];
      const u = h[Math.min(size - 1, j + 1) * size + i];
      const gx = (r - l) / (2 * spacing);
      const gz = (u - d) / (2 * spacing);
      out[j * size + i] = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
    }
  }
  return out;
}

/** Laplacian curvature (1/m): positive in hollows and valleys, negative on crests. */
export function curvatureField(h, size, spacing) {
  const out = new Float32Array(h.length);
  for (let j = 1; j < size - 1; j++) {
    for (let i = 1; i < size - 1; i++) {
      const k = j * size + i;
      out[k] = (h[k - 1] + h[k + 1] + h[k - size] + h[k + size] - 4 * h[k]) / (spacing * spacing);
    }
  }
  return out;
}

/**
 * Horizon-based ambient occlusion: from every `stride`-th sample, march `dirs` directions up to `maxDist`
 * metres and average the sine of the highest horizon. 1 = open sky, 0 = enclosed. Upsampled bilinearly.
 */
export function horizonAO(h, size, spacing, { stride = 2, dirs = 8, maxDist = 24, steps = 12 } = {}) {
  const n = Math.ceil(size / stride);
  const coarse = new Float32Array(n * n);
  const dirX = [];
  const dirZ = [];
  for (let d = 0; d < dirs; d++) {
    dirX.push(Math.cos((2 * Math.PI * d) / dirs));
    dirZ.push(Math.sin((2 * Math.PI * d) / dirs));
  }
  for (let cj = 0; cj < n; cj++) {
    for (let ci = 0; ci < n; ci++) {
      const i0 = Math.min(size - 1, ci * stride);
      const j0 = Math.min(size - 1, cj * stride);
      const h0 = h[j0 * size + i0] + 0.2;
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        let best = 0;
        for (let s = 1; s <= steps; s++) {
          const dist = (maxDist * s * s) / (steps * steps); // denser near the sample
          const i = Math.round(i0 + (dirX[d] * dist) / spacing);
          const j = Math.round(j0 + (dirZ[d] * dist) / spacing);
          if (i < 0 || j < 0 || i >= size || j >= size) break;
          const rise = h[j * size + i] - h0;
          if (rise > 0) best = Math.max(best, rise / Math.hypot(rise, dist));
        }
        occ += best;
      }
      coarse[cj * n + ci] = 1 - occ / dirs;
    }
  }
  const out = new Float32Array(h.length);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const fx = Math.min(n - 1.001, i / stride);
      const fz = Math.min(n - 1.001, j / stride);
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const a = coarse[iz * n + ix];
      const b = coarse[iz * n + ix + 1];
      const c = coarse[(iz + 1) * n + ix];
      const d = coarse[(iz + 1) * n + ix + 1];
      out[j * size + i] = a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    }
  }
  return out;
}

/**
 * 1 where a ray from the surface toward the sun (unit [x, y, z], world) clears the terrain within
 * `maxDist` metres. Used by the bake (spawn choice, lit-fraction check) and tests; CSM shadows do
 * this at runtime.
 */
export function sunVisibility(h, size, spacing, sun, maxDist = 180) {
  const out = new Uint8Array(h.length);
  const horiz = Math.hypot(sun[0], sun[2]);
  const tanElev = sun[1] / horiz;
  const sx = sun[0] / horiz;
  const sz = sun[2] / horiz;
  const step = spacing * 1.5;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h0 = h[j * size + i] + 0.5;
      let lit = 1;
      for (let d = step; d < maxDist; d += step) {
        const fi = i + (sx * d) / spacing;
        const fj = j + (sz * d) / spacing;
        if (fi < 0 || fj < 0 || fi >= size - 1 || fj >= size - 1) break;
        if (h[Math.round(fj) * size + Math.round(fi)] > h0 + tanElev * d) {
          lit = 0;
          break;
        }
      }
      out[j * size + i] = lit;
    }
  }
  return out;
}

/** Flow → wetness 0..1: log-compressed droplet water, box-blurred (radius 2) to read as damp bands. */
export function wetnessFromFlow(flow, size) {
  let max = 0;
  const lf = new Float32Array(flow.length);
  for (let k = 0; k < flow.length; k++) {
    lf[k] = Math.log1p(flow[k]);
    if (lf[k] > max) max = lf[k];
  }
  const out = new Float32Array(flow.length);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      let c = 0;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= size || jj >= size) continue;
          s += lf[jj * size + ii];
          c++;
        }
      }
      out[j * size + i] = max > 0 ? smoothstep(0.35, 0.85, s / c / max) : 0;
    }
  }
  return out;
}

/**
 * Six-layer splat weights for one sample (un-normalised, all ≥ 0) + the wet mask.
 * rimT: 0 at the wall foot, 1 at the rim (jitter-corrected); r: radius from the Cove centre.
 * @param {{ slope: number, height: number, waterLevel: number, pondQ: number, r: number, rimT: number,
 *           curvature: number, wetness: number, noise: number, onRoute: number, inGully: number }} c
 */
export function splatForCell(c) {
  const rock = smoothstep(34, 50, c.slope) * (1 - 0.6 * c.onRoute);
  const bed = smoothstep(1.06, 0.92, c.pondQ);
  const shore = smoothstep(1.35, 1.02, c.pondQ) * (1 - bed);
  const pebbles = Math.max(bed * 0.75, shore * 0.35, c.inGully * 0.25) * (1 - rock);
  const mud = Math.max(shore * 0.65, bed * 0.25, c.wetness * 0.5 * (1 - rock), c.inGully * 0.3) * (1 - rock);
  const wallFoot = smoothstep(-0.12, 0.02, c.rimT) * (1 - smoothstep(0.3, 0.55, c.rimT));
  const moss = (wallFoot * 0.8 + smoothstep(0, 0.35, c.curvature) * 0.3) * smoothstep(8, 18, c.slope) * (1 - smoothstep(38, 52, c.slope))
    * (0.6 + 0.8 * c.noise);
  const outsideRim = smoothstep(0.95, 1.2, c.rimT);
  const forest = outsideRim * (1 - rock) * (0.7 + 0.6 * c.noise);
  const floor = 1 - outsideRim;
  const grass = Math.max(0, floor * (1 - rock) * (1 - bed) * (0.9 - 0.4 * c.noise) - moss * 0.5 - mud * 0.6);
  const wet = Math.max(smoothstep(1.3, 1.0, c.pondQ), c.wetness * 0.7);
  return { weights: [grass, forest, moss, mud, pebbles, rock], wet };
}

/** Normalise weights to 8-bit values that sum to exactly 255 (the remainder goes to the largest). */
export function quantizeWeights(weights) {
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  const q = weights.map((w) => (sum > 0 ? Math.floor((Math.max(0, w) / sum) * 255) : 0));
  if (sum <= 0) {
    q[0] = 255;
    return q;
  }
  let largest = 0;
  for (let k = 1; k < q.length; k++) if (weights[k] > weights[largest]) largest = k;
  q[largest] += 255 - q.reduce((a, b) => a + b, 0);
  return q;
}
