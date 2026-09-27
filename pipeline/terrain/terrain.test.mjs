import { describe, it, expect } from 'vitest';
import { mulberry32 as bakeRng } from './rng.mjs';
import { mulberry32 as appRng } from '../../src/core/rng';
import { hash2, valueNoise2, fbm2, ridged2 } from './noise.mjs';

describe('rng port', () => {
  it('produces the engine mulberry32 stream exactly', () => {
    const a = bakeRng(1337);
    const b = appRng(1337);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });
});

describe('noise', () => {
  it('is deterministic and in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.731 - 90;
      const y = i * 1.37 + 12;
      for (const v of [hash2(i, -i, 3), valueNoise2(x, y, 7), fbm2(x, y, 7), ridged2(x, y, 7)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      expect(fbm2(x, y, 7)).toBe(fbm2(x, y, 7));
    }
  });
  it('is continuous (small steps make small changes)', () => {
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.01;
      worst = Math.max(worst, Math.abs(valueNoise2(x + 0.001, 3.3, 1) - valueNoise2(x, 3.3, 1)));
    }
    expect(worst).toBeLessThan(0.01);
  });
  it('changes with the seed', () => {
    let diff = 0;
    for (let i = 0; i < 100; i++) diff += Math.abs(fbm2(i * 0.37, 1.1, 1) - fbm2(i * 0.37, 1.1, 2));
    expect(diff).toBeGreaterThan(1);
  });
});

import {
  COVE, coveHeight, azimuthDir, rayFrame, wallHeight, pondQ, routeAProfile, cliffCurve, azimuthDeg, sunDirection, smoothstep, lerp,
} from './coveShape.mjs';

const slopeDegAt = (x, z, h = 0.4) => {
  const gx = (coveHeight(x + h, z) - coveHeight(x - h, z)) / (2 * h);
  const gz = (coveHeight(x, z + h) - coveHeight(x, z - h)) / (2 * h);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
};
const centreline = (deg, r0, r1, step = 0.4) => {
  const [ux, uz] = azimuthDir(deg);
  const pts = [];
  for (let r = r0; r <= r1 + 1e-9; r += step) pts.push({ r, x: ux * r, z: uz * r, y: coveHeight(ux * r, uz * r) });
  return pts;
};
const inSector = (deg, centre, halfDeg) => Math.abs(((deg - centre + 540) % 360) - 180) < halfDeg;

describe('cove shape', () => {
  it('uses the compass convention of src/render/sun.ts', () => {
    expect(azimuthDeg(0, -10)).toBeCloseTo(0, 9); // north = −Z
    expect(azimuthDeg(10, 0)).toBeCloseTo(90, 9); // east = +X
    const s = sunDirection(292, 14);
    expect(s[0]).toBeLessThan(0); // WNW: west …
    expect(s[2]).toBeLessThan(0); // … and a little north
    expect(Math.hypot(...s)).toBeCloseTo(1, 12);
  });
  it('has a ~70 m floor and 14–25 m walls reaching the rim at ~50 m', () => {
    for (let az = 0; az < 360; az += 15) {
      if (inSector(az, COVE.gully.azimuth, 25) || inSector(az, COVE.routeA.azimuth, 12) || inSector(az, COVE.routeB.azimuth, 12)) continue;
      const [ux, uz] = azimuthDir(az);
      for (let r = 0; r <= 30; r += 3) expect(coveHeight(ux * r, uz * r)).toBeLessThan(1.5);
      const rim = coveHeight(ux * 55, uz * 55);
      expect(rim).toBeGreaterThan(wallHeight(az) - 3);
      expect(rim).toBeLessThan(wallHeight(az) + 4);
    }
    expect(wallHeight(292)).toBeCloseTo(14, 9);
    expect(wallHeight(112)).toBeCloseTo(25, 9);
  });
  it('cuts a walkable gully toward the sun (≤ 45°, ≥ 14 m wide at its mouth)', () => {
    const g = COVE.gully;
    const [ux, uz] = azimuthDir(g.azimuth);
    const [px, pz] = [-uz, ux];
    let worst = 0;
    let worstLateral = 0;
    for (let along = g.rStart; along <= g.rEnd; along += 1) {
      const s = smoothstep(g.rStart, g.rEnd, along);
      const halfW = lerp(g.halfWidthIn, g.halfWidthOut, s);
      const x_ctr = ux * along;
      const z_ctr = uz * along;
      const laterals = [0, 0.5 * halfW, -0.5 * halfW, 0.9 * halfW, -0.9 * halfW];
      for (const lat of laterals) {
        const slope = slopeDegAt(x_ctr + px * lat, z_ctr + pz * lat);
        if (slope > worst) {
          worst = slope;
          worstLateral = lat;
        }
      }
    }
    expect(worst).toBeLessThan(45);
    const mouth = coveHeight(ux * 45, uz * 45);
    for (const s of [-7, -3.5, 0, 3.5, 7]) expect(Math.abs(coveHeight(ux * 45 + px * s, uz * 45 + pz * s) - mouth)).toBeLessThan(1.5);
  });
  it('route A is scramble terraces: risers ≤ 2.3 m, flat treads ≥ 2.5 m', () => {
    const ra = COVE.routeA;
    for (let i = 0; i < ra.steps; i++) {
      const a = ra.rStart + i * ra.tread;
      expect(routeAProfile(a + ra.riserRun + 0.05) - routeAProfile(a - 0.05)).toBeLessThan(2.31);
      const treadStart = a + ra.riserRun + 0.05;
      const treadEnd = a + ra.tread - 0.05;
      expect(treadEnd - treadStart).toBeGreaterThanOrEqual(2.5);
      expect(Math.abs(routeAProfile(treadEnd) - routeAProfile(treadStart))).toBeLessThan(0.01);
    }
    const line = centreline(ra.azimuth, ra.rStart + 0.5, ra.rStart + ra.steps * ra.tread - 0.5, 0.1);
    let biggestJump = 0;
    for (let k = 1; k < line.length; k++) biggestJump = Math.max(biggestJump, line[k].y - line[k - 1].y);
    expect(biggestJump).toBeLessThan(2.31);
    expect(line[line.length - 1].y).toBeGreaterThan(wallHeight(ra.azimuth) - 1.5);
  });
  it('route B is a climb-mode slope: steepest 45–70°, walkable at both ends', () => {
    const rb = COVE.routeB;
    const [ux, uz] = azimuthDir(rb.azimuth);
    const [px, pz] = [-uz, ux];
    let worst = 0;
    let worstLateral = 0;
    let maxSlope = 0;
    let maxLateral = 0;
    for (let along = rb.r0; along <= rb.r1; along += 0.5) {
      const x_ctr = ux * along;
      const z_ctr = uz * along;
      const laterals = [0, 2, -2, 3.6, -3.6];
      for (const lat of laterals) {
        const slope = slopeDegAt(x_ctr + px * lat, z_ctr + pz * lat);
        worst = Math.max(worst, slope);
        if (slope > maxSlope) {
          maxSlope = slope;
          maxLateral = lat;
        }
      }
    }
    expect(worst).toBeGreaterThan(45);
    expect(worst).toBeLessThan(70);
    expect(cliffCurve(0, 3.5)).toBeCloseTo(0, 12);
    expect(cliffCurve(1, 3.5)).toBeCloseTo(1, 12);
  });
  it('carves a 2.2–2.7 m deep pond with dry banks around it', () => {
    let deepest = 0;
    let wetOutside = 0;
    for (let x = -30; x <= 40; x += 0.5) {
      for (let z = -25; z <= 35; z += 0.5) {
        const q = pondQ(x, z);
        const y = coveHeight(x, z);
        if (q < 1) deepest = Math.max(deepest, COVE.water.level - y);
        if (q > 1.05 && q < 3 && y < COVE.water.level) wetOutside++;
      }
    }
    expect(deepest).toBeGreaterThan(2.2);
    expect(deepest).toBeLessThan(2.7);
    expect(wetOutside).toBe(0);
  });
});

import { erode, EROSION_DEFAULTS } from './erosion.mjs';
import {
  slopeField, curvatureField, horizonAO, sunVisibility, wetnessFromFlow, splatForCell, quantizeWeights,
} from './masks.mjs';

const cone = (size, spacing, peak) => {
  const h = new Float32Array(size * size);
  const c = (size - 1) / 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) h[j * size + i] = Math.max(0, peak - Math.hypot(i - c, j - c) * spacing * 0.8);
  return h;
};

describe('erosion', () => {
  const size = 64;
  it('is deterministic, bounded, and respects the protection mask', () => {
    const mask = new Float32Array(size * size).fill(1);
    for (let k = 0; k < size * 16; k++) mask[k] = 0; // protect the first 16 rows
    const a = cone(size, 0.4, 12);
    const b = cone(size, 0.4, 12);
    const before = a.slice();
    const flowA = erode(a, size, mask, { droplets: 3000, seed: 3 });
    erode(b, size, mask, { droplets: 3000, seed: 3 });
    expect(Array.from(a)).toEqual(Array.from(b));
    let moved = 0;
    for (let k = 0; k < a.length; k++) {
      expect(Math.abs(a[k] - before[k])).toBeLessThanOrEqual(EROSION_DEFAULTS.maxChange + 1e-6);
      if (k < size * 16) expect(a[k]).toBe(before[k]);
      if (Math.abs(a[k] - before[k]) > 1e-4) moved++;
    }
    expect(moved).toBeGreaterThan(50);
    expect(flowA.some((f) => f > 0)).toBe(true);
    expect(flowA.every((f) => f >= 0)).toBe(true);
  });
});

describe('masks', () => {
  it('measures slope and curvature', () => {
    const size = 32;
    const plane = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) plane[j * size + i] = i * 0.4 * Math.tan((30 * Math.PI) / 180);
    expect(slopeField(plane, size, 0.4)[16 * size + 16]).toBeCloseTo(30, 4);
    const bowl = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) bowl[j * size + i] = ((i - 16) ** 2 + (j - 16) ** 2) * 0.01;
    expect(curvatureField(bowl, size, 0.4)[16 * size + 16]).toBeGreaterThan(0);
  });
  it('horizon AO is 1 on open ground and lower in a pit', () => {
    const size = 128;
    const flat = new Float32Array(size * size);
    expect(horizonAO(flat, size, 0.4)[64 * size + 64]).toBeCloseTo(1, 6);
    const pit = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) pit[j * size + i] = Math.hypot(i - 64, j - 64) > 10 ? 6 : 0;
    expect(horizonAO(pit, size, 0.4)[64 * size + 64]).toBeLessThan(0.8);
  });
  it('sun visibility: open ground lit, ground behind a wall toward the sun shadowed', () => {
    const size = 128;
    const h = new Float32Array(size * size);
    // a 5 m wall on the west (−X) side; at ~14° its shadow reaches ≈ 18 m past the rays' 0.5 m start height
    for (let j = 0; j < size; j++) for (let i = 0; i < 20; i++) h[j * size + i] = 5;
    const vis = sunVisibility(h, size, 0.4, [-0.97, 0.24, 0], 120);
    expect(vis[64 * size + 100]).toBe(1); // 32 m east of the wall: sunlit
    expect(vis[64 * size + 25]).toBe(0); // 2 m east of the wall: shadowed
  });
  it('quantised splat weights sum to 255 and keep the dominant layer', () => {
    for (const w of [[1, 0, 0, 0, 0, 0], [0.2, 0.3, 0.1, 0, 0.4, 0], [0, 0, 0, 0, 0, 0], [1e-6, 3, 1e-6, 0, 0, 0.5]]) {
      const q = quantizeWeights(w);
      expect(q.reduce((a, b) => a + b, 0)).toBe(255);
      if (w.some((v) => v > 0)) expect(q.indexOf(Math.max(...q))).toBe(w.indexOf(Math.max(...w)));
    }
  });
  it('splat rules: steep → rock, pond bed → pebbles/mud, outside the rim → forest, floor → grass', () => {
    const base = { slope: 5, height: 0.3, waterLevel: -0.45, pondQ: 3, r: 20, rimT: -0.5, curvature: 0, wetness: 0, noise: 0.5, onRoute: 0, inGully: 0 };
    const top = (c) => {
      const w = splatForCell({ ...base, ...c }).weights;
      return ['grass', 'forest', 'moss', 'mud', 'pebbles', 'rock'][w.indexOf(Math.max(...w))];
    };
    expect(top({ slope: 60, rimT: 0.5 })).toBe('rock');
    expect(['pebbles', 'mud']).toContain(top({ pondQ: 0.5, height: -1.5 }));
    expect(top({ rimT: 1.6, r: 70 })).toBe('forest');
    expect(top({})).toBe('grass');
    expect(splatForCell({ ...base, pondQ: 1.1 }).wet).toBeGreaterThan(0.5);
  });
  it('wetness follows the flow field', () => {
    const size = 16;
    const flow = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 6; i <= 10; i++) flow[j * size + i] = 500; // a 2 m wide runoff channel
    const wet = wetnessFromFlow(flow, size);
    expect(wet[8 * size + 8]).toBeGreaterThan(wet[8 * size + 1]);
  });
});
