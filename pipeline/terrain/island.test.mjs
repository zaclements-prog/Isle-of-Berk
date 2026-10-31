import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { ISLE, isleHeight, inland, cliffMask, ledgeFrame, meadowMask, azimuthDeg } from './islandShape.mjs';

const D = Math.PI / 180;
const HEADER = 'public/assets/world/island/terrain.json';

describe('Test Isle shape', () => {
  it('is deterministic and inside the 16-bit height range', () => {
    for (let k = 0; k < 400; k++) {
      const x = (k * 37.3) % 800 - 400;
      const z = (k * 91.7) % 800 - 400;
      const h = isleHeight(x, z);
      expect(h).toBe(isleHeight(x, z));
      expect(h).toBeGreaterThan(ISLE.heightRange.min);
      expect(h).toBeLessThan(ISLE.heightRange.max);
    }
  });

  it('is an island: sea all round the edge of the grid, land in the middle', () => {
    const e = 400;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * 2 * Math.PI;
      expect(isleHeight(Math.sin(a) * e * 0.98, -Math.cos(a) * e * 0.98)).toBeLessThan(-2);
    }
    expect(isleHeight(0, 0)).toBeGreaterThan(8);
  });

  it('has shingle beaches running gently into the sea in the south-west', () => {
    for (const a of [200, 230, 260]) {
      // walk out from the beach top to the waterline: no step steeper than 20 % (~11°)
      let prev = null;
      for (let d = 12; d > -15; d -= 1) {
        const dir = [Math.sin(a * D), -Math.cos(a * D)];
        // find the coast along this ray first
        let lo = 0;
        let hi = 400;
        for (let n = 0; n < 40; n++) {
          const mid = (lo + hi) / 2;
          if (inland(dir[0] * mid, dir[1] * mid) > 0) lo = mid;
          else hi = mid;
        }
        const rr = lo - d;
        const h = isleHeight(dir[0] * rr, dir[1] * rr);
        if (prev !== null) expect(Math.abs(h - prev)).toBeLessThan(0.2);
        prev = h;
      }
      expect(cliffMask(Math.sin(a * D) * 200, -Math.cos(a * D) * 200)).toBe(0);
    }
  });

  it('has sea cliffs over 20 m in the north-east and sea stacks over 20 m', () => {
    const a = 65;
    const dir = [Math.sin(a * D), -Math.cos(a * D)];
    let lo = 0;
    let hi = 400;
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2;
      if (inland(dir[0] * mid, dir[1] * mid) > 0) lo = mid;
      else hi = mid;
    }
    expect(isleHeight(dir[0] * (lo - 12), dir[1] * (lo - 12))).toBeGreaterThan(20);
    expect(isleHeight(dir[0] * (lo + 12), dir[1] * (lo + 12))).toBeLessThan(0);
    for (const s of ISLE.stacks) {
      expect(isleHeight(s.x, s.z)).toBeGreaterThan(20);
      expect(isleHeight(s.x + s.r + 8, s.z)).toBeLessThan(0);
      expect(azimuthDeg(s.x, s.z)).toBeGreaterThan(ISLE.cliffs.from - 30);
    }
  });

  it('has a flat meadow for gallops and running takeoffs (≤ 4° over 100 m)', () => {
    const m = ISLE.meadow;
    expect(meadowMask(m.x, m.z)).toBeGreaterThan(0.99);
    for (let k = -50; k <= 50; k += 5) {
      const dh = isleHeight(m.x + k + 1, m.z) - isleHeight(m.x + k - 1, m.z);
      expect(Math.abs(dh / 2)).toBeLessThan(Math.tan(4 * D));
    }
  });

  it('has a ledge flight of 2.2 m risers on 3.2 m treads up to a summit', () => {
    const L = ISLE.ledges;
    const fx = Math.sin(L.azimuth * D);
    const fz = -Math.cos(L.azimuth * D);
    for (let k = 0; k < L.steps; k++) {
      const a = (k + 0.5) * L.tread;
      const hh = isleHeight(L.x + fx * a, L.z + fz * a);
      expect(hh).toBeCloseTo(ISLE.meadow.height + (k + 1) * L.rise, 0);
      expect(ledgeFrame(L.x + fx * a, L.z + fz * a).lateral).toBeLessThan(1e-6);
    }
    const summit = isleHeight(L.x + fx * (L.steps * L.tread + L.summit / 2), L.z + fz * (L.steps * L.tread + L.summit / 2));
    expect(summit).toBeCloseTo(ISLE.meadow.height + L.steps * L.rise, 0);
  });
});

describe.skipIf(!existsSync(HEADER))('Test Isle bake output', () => {
  it('ships a header with spawn on the meadow, trees and boulders on land', () => {
    const h = JSON.parse(readFileSync(HEADER, 'utf8'));
    expect(h.size).toBe(ISLE.grid.size);
    expect(h.spawn[0].x).toBeCloseTo(ISLE.meadow.x + 20);
    expect(meadowMask(h.spawn[0].x, h.spawn[0].z)).toBeGreaterThan(0.9);
    expect(h.trees.length).toBeGreaterThan(500);
    expect(h.rocks.length).toBeGreaterThan(100);
    for (const t of h.trees.slice(0, 200)) expect(t[1]).toBeGreaterThan(2);
    expect(readFileSync('public/assets/world/island/height.bin').byteLength).toBe(h.size * h.size * 2);
  });
});
