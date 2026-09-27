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
  COVE, coveHeight, azimuthDir, rayFrame, wallHeight, pondQ, routeAProfile, cliffCurve, azimuthDeg, sunDirection,
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
  it('cuts a walkable gully toward the sun (≤ 25°, ≥ 14 m wide at its mouth)', () => {
    let worst = 0;
    for (const p of centreline(COVE.gully.azimuth, 20, 100)) worst = Math.max(worst, slopeDegAt(p.x, p.z));
    expect(worst).toBeLessThan(25);
    const [ux, uz] = azimuthDir(COVE.gully.azimuth);
    const [px, pz] = [-uz, ux];
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
  it('route B is a climb-mode slope: steepest 50–65°, never above 70°', () => {
    let worst = 0;
    for (const p of centreline(COVE.routeB.azimuth, 30, 54)) worst = Math.max(worst, slopeDegAt(p.x, p.z));
    expect(worst).toBeGreaterThan(50);
    expect(worst).toBeLessThan(65);
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
