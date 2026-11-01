import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  ISLE, isleHeight, inland, ledgeFrame, plateauMask, plateauHeight, azimuthDeg, harbourField, terraceMask, ringRim, coveRim, pondLevel,
  villageMask,
} from './islandShape.mjs';

const D = Math.PI / 180;
const HEADER = 'public/assets/world/island/terrain.json';

/** The outer coast's radius along azimuth a (bisection on inland()). */
function coastAt(a) {
  const dir = [Math.sin(a * D), -Math.cos(a * D)];
  let lo = 0;
  let hi = 500;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if (inland(dir[0] * mid, dir[1] * mid) > 0) lo = mid;
    else hi = mid;
  }
  return { dir, r: lo };
}

describe('island shape (after Berk)', () => {
  it('is deterministic and inside the 16-bit height range', () => {
    for (let k = 0; k < 400; k++) {
      const x = (k * 37.3) % 1000 - 500;
      const z = (k * 91.7) % 1000 - 500;
      const h = isleHeight(x, z);
      expect(h).toBe(isleHeight(x, z));
      expect(h).toBeGreaterThan(ISLE.heightRange.min);
      expect(h).toBeLessThan(ISLE.heightRange.max);
    }
  });

  it('is an island ringed by sea cliffs: sea at the grid edge, 15 m+ cliffs at the coast', () => {
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * 2 * Math.PI;
      expect(isleHeight(Math.sin(a) * 505, -Math.cos(a) * 505)).toBeLessThan(-2);
    }
    let cliffs = 0;
    for (let a = 0; a < 360; a += 15) {
      if (Math.abs(a - ISLE.harbour.mouthAzimuth) < 25) continue;
      const { dir, r } = coastAt(a);
      if (isleHeight(dir[0] * (r - 14), dir[1] * (r - 14)) > 15 && isleHeight(dir[0] * (r + 6), dir[1] * (r + 6)) < 0) cliffs++;
    }
    expect(cliffs).toBeGreaterThan(18);                          // of 22 rays outside the harbour
  });

  it('has a mountain in the north standing over 120 m', () => {
    expect(isleHeight(ISLE.mountain.x, ISLE.mountain.z)).toBeGreaterThan(120);
  });

  it('has a sheltered harbour: open water from the sea to a low shelf at its head', () => {
    const H = ISLE.harbour;
    for (const t of [0.2, 0.5, 0.8]) {
      const a = H.mouthAzimuth * D;
      const r = 420;
      const x = Math.sin(a) * r + (H.inner.x - Math.sin(a) * r) * t;
      const z = -Math.cos(a) * r + (H.inner.z + Math.cos(a) * r) * t;
      expect(isleHeight(x, z)).toBeLessThan(-3);
      expect(harbourField(x, z).d).toBeLessThan(harbourField(x, z).half);
    }
  });

  it('climbs from the harbour to the Great Hall in flat terraces', () => {
    let prev = ISLE.harbour.shelf;
    ISLE.terraces.forEach((t, k) => {
      expect(terraceMask(t.x, t.z, k)).toBeCloseTo(1);
      expect(isleHeight(t.x, t.z)).toBeCloseTo(t.height, 0);
      expect(t.height).toBeGreaterThan(prev);
      prev = t.height;
      expect(villageMask(t.x, t.z)).toBeGreaterThan(0.9);
    });
    expect(isleHeight(ISLE.hall.x, ISLE.hall.z)).toBeCloseTo(ISLE.hall.height, 0);
    expect(ISLE.hall.height).toBeGreaterThan(prev);
  });

  it('sinks the Kill Ring into the cliff-top: a flat floor below steep sides', () => {
    const R = ISLE.killRing;
    const floor = isleHeight(R.x, R.z);
    expect(floor).toBeCloseTo(ringRim() - R.depth, 0);
    expect(isleHeight(R.x + R.r * 0.6, R.z)).toBeCloseTo(floor, 0);
    expect(isleHeight(R.x + R.r + R.wall + 2, R.z)).toBeGreaterThan(floor + R.depth * 0.8);
  });

  it('hides the Cove in the forest: a walled hollow with a pond below its floor', () => {
    const C = ISLE.cove;
    const floor = coveRim() - C.depth;
    expect(isleHeight(C.x + C.r * 0.5, C.z + C.r * 0.3)).toBeCloseTo(floor, -0.5);
    expect(isleHeight(C.pond.x, C.pond.z)).toBeLessThan(pondLevel() - 1);
    expect(pondLevel()).toBeGreaterThan(floor - 1);
    // walls on the far side from the gully
    const back = (C.gully.azimuth + 180) * D;
    expect(isleHeight(C.x + Math.sin(back) * (C.r + 8), C.z - Math.cos(back) * (C.r + 8))).toBeGreaterThan(floor + C.depth * 0.6);
  });

  it('has a flat eastern plateau (≤ 4° over 80 m) with the stepped tor on it', () => {
    const p = ISLE.plateau;
    expect(plateauMask(p.x, p.z)).toBeGreaterThan(0.99);
    for (let k = -40; k <= 40; k += 5) {
      const dh = isleHeight(p.x + k + 1, p.z) - isleHeight(p.x + k - 1, p.z);
      expect(Math.abs(dh / 2)).toBeLessThan(Math.tan(4 * D));
    }
    const L = ISLE.ledges;
    const fx = Math.sin(L.azimuth * D);
    const fz = -Math.cos(L.azimuth * D);
    for (let k = 0; k < L.steps; k++) {
      const a = (k + 0.5) * L.tread;
      expect(isleHeight(L.x + fx * a, L.z + fz * a)).toBeCloseTo(plateauHeight() + (k + 1) * L.rise, 0);
      expect(ledgeFrame(L.x + fx * a, L.z + fz * a).lateral).toBeLessThan(1e-6);
    }
  });

  it('has sea stacks over 20 m standing in the sea', () => {
    for (const s of ISLE.stacks) {
      expect(isleHeight(s.x, s.z)).toBeGreaterThan(20);
      expect(isleHeight(s.x + s.r + 8, s.z)).toBeLessThan(0);
      expect(azimuthDeg(s.x, s.z)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe.skipIf(!existsSync(HEADER))('island bake output', () => {
  it('ships the Berk sites, houses on the terraces clear of the path, trees outside the village', () => {
    const h = JSON.parse(readFileSync(HEADER, 'utf8'));
    expect(h.version).toBe(2);
    expect(h.size).toBe(ISLE.grid.size);
    expect(h.houses.length).toBeGreaterThan(20);
    expect(h.docks.length).toBe(3);
    for (const hs of h.houses) expect(villageMask(hs.x, hs.z)).toBeGreaterThan(0.3);
    for (const t of h.trees.slice(0, 400)) expect(villageMask(t[0], t[2])).toBeLessThan(0.05);
    expect(h.trees.length).toBeGreaterThan(1500);
    expect(h.cove.pond.level).toBeCloseTo(pondLevel(), 1);
    expect(readFileSync('public/assets/world/island/height.bin').byteLength).toBe(h.size * h.size * 2);
  });
});
