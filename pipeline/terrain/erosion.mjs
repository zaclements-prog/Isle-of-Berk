// Light hydraulic erosion: particle droplets (after Beyer 2015, "Implementation of a method for hydraulic
// erosion"), deterministic from a seed. Carves runoff lines into the walls and hills without touching the
// designed routes, gully and pond (the caller's mask is 0 there).
import { mulberry32 } from './rng.mjs';

export const EROSION_DEFAULTS = {
  droplets: 120000,
  seed: 7,
  inertia: 0.05,
  capacity: 4,
  minSlope: 0.01,
  erosion: 0.3,
  deposition: 0.3,
  evaporation: 0.02,
  gravity: 4,
  maxSteps: 48,
  radius: 3,
  heightScale: 20, // heights are eroded in units of this many metres so the classic constants apply
  strength: 0.5, // fraction of the simulated change that is kept ("light pass")
  maxChange: 1.5, // metres; no cell moves more than this
};

function makeBrush(radius) {
  const off = [];
  const weight = [];
  let sum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      off.push(dx, dy);
      const w = 1 - d / radius;
      weight.push(w);
      sum += w;
    }
  }
  return { off, weight: weight.map((w) => w / sum) };
}

/**
 * Erodes `h` (Float32Array, row-major size × size, metres) in place.
 * @param {Float32Array} h
 * @param {number} size
 * @param {Float32Array} mask per-cell 0..1 multiplier of the final change
 * @param {Partial<typeof EROSION_DEFAULTS>} opts
 * @returns {Float32Array} per-cell accumulated droplet water (the flow field, for wetness)
 */
export function erode(h, size, mask, opts = {}) {
  const o = { ...EROSION_DEFAULTS, ...opts };
  const S = o.heightScale;
  const w = new Float32Array(h.length);
  for (let k = 0; k < h.length; k++) w[k] = h[k] / S;
  const flow = new Float32Array(h.length);
  const brush = makeBrush(o.radius);
  const rnd = mulberry32(o.seed);
  let sh = 0;
  let sgx = 0;
  let sgy = 0;
  const sample = (x, y) => {
    const ix = x | 0;
    const iy = y | 0;
    const fx = x - ix;
    const fy = y - iy;
    const k = iy * size + ix;
    const a = w[k];
    const b = w[k + 1];
    const c = w[k + size];
    const d = w[k + size + 1];
    sgx = (b - a) * (1 - fy) + (d - c) * fy;
    sgy = (c - a) * (1 - fx) + (d - b) * fx;
    sh = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };

  for (let n = 0; n < o.droplets; n++) {
    let x = 1 + rnd() * (size - 3);
    let y = 1 + rnd() * (size - 3);
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sed = 0;
    for (let step = 0; step < o.maxSteps; step++) {
      const ix = x | 0;
      const iy = y | 0;
      const fx = x - ix;
      const fy = y - iy;
      const cell = iy * size + ix;
      sample(x, y);
      const hOld = sh;
      dx = dx * o.inertia - sgx * (1 - o.inertia);
      dy = dy * o.inertia - sgy * (1 - o.inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) break;
      dx /= len;
      dy /= len;
      x += dx;
      y += dy;
      if (x < 1 || y < 1 || x >= size - 2 || y >= size - 2) break;
      flow[cell] += water;
      sample(x, y);
      const dh = sh - hOld;
      const cap = Math.max(-dh * speed * water * o.capacity, o.minSlope);
      if (sed > cap || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sed) : (sed - cap) * o.deposition;
        sed -= amount;
        w[cell] += amount * (1 - fx) * (1 - fy);
        w[cell + 1] += amount * fx * (1 - fy);
        w[cell + size] += amount * (1 - fx) * fy;
        w[cell + size + 1] += amount * fx * fy;
      } else {
        const amount = Math.min((cap - sed) * o.erosion, -dh);
        for (let b = 0; b < brush.weight.length; b++) {
          const bx = ix + brush.off[2 * b];
          const by = iy + brush.off[2 * b + 1];
          if (bx < 0 || by < 0 || bx >= size || by >= size) continue;
          const e = amount * brush.weight[b];
          w[by * size + bx] -= e;
          sed += e;
        }
      }
      // downhill (dh < 0) accelerates the droplet
      speed = Math.sqrt(Math.max(0, speed * speed - dh * o.gravity));
      water *= 1 - o.evaporation;
    }
  }

  for (let k = 0; k < h.length; k++) {
    const delta = (w[k] * S - h[k]) * o.strength * mask[k];
    h[k] += Math.max(-o.maxChange, Math.min(o.maxChange, delta));
  }
  return flow;
}
