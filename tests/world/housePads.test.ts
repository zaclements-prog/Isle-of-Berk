import { describe, it, expect } from 'vitest';
import { Heightfield } from '../../src/world/terrain/heightfield';
import { levelHousePads, type HousePlacement } from '../../src/world/island/berk';
import { testHeader } from './terrainFixtures';

/** A 120 m slope rising `grade` m per metre along +x. */
function slope(grade = 0.6): Heightfield {
  const size = 121;
  const hdr = testHeader(size, 1);
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) h[j * size + i] = 20 + grade * (hdr.origin + i);
  return new Heightfield(hdr, h);
}

describe('house pads', () => {
  it('levels each footprint at the ground under its centre, whatever the bake said', () => {
    const hf = slope();
    const houses: HousePlacement[] = [
      { x: 0, z: 0, y: 3, yaw: 0.6, len: 11, wid: 6.5, terrace: 0 }, // the bake's y is 17 m off
      { x: -30, z: 25, y: 2, yaw: -1.2, len: 9, wid: 6, terrace: 1 },
    ];
    const worst = levelHousePads(hf, houses);
    expect(worst).toBeGreaterThan(3);
    for (const h of houses) {
      expect(h.y).toBeCloseTo(20 + 0.6 * h.x, 1);
      // every point of the footprint is at the pad height: none of the house is buried or floating
      for (let u = -0.5; u <= 0.5; u += 0.1) {
        for (let v = -0.5; v <= 0.5; v += 0.1) {
          const lx = u * h.len;
          const lz = v * h.wid;
          const x = h.x + lx * Math.cos(h.yaw) + lz * Math.sin(h.yaw);
          const z = h.z - lx * Math.sin(h.yaw) + lz * Math.cos(h.yaw);
          expect(Math.abs(hf.heightAt(x, z) - h.y)).toBeLessThan(0.05);
        }
      }
    }
  });

  it('leaves the slope untouched away from the houses, and joins it on a bank no steeper than 45°', () => {
    const hf = slope(0.25); // a terrace's run-out, about 14°
    levelHousePads(hf, [{ x: 0, z: 0, y: 0, yaw: 0, len: 10, wid: 6, terrace: 0 }]);
    expect(hf.heightAt(45, 40)).toBeCloseTo(20 + 0.25 * 45, 3);
    // walking out from the pad edge the ground never jumps more than a sample's worth of slope
    let prev = hf.heightAt(5, 0);
    for (let x = 5.25; x < 25; x += 0.25) {
      const y = hf.heightAt(x, 0);
      expect(Math.abs(y - prev)).toBeLessThan(0.25); // under 45°
      prev = y;
    }
  });

  it("keeps neighbours' pads flat where their skirts overlap", () => {
    const hf = slope();
    const houses: HousePlacement[] = [
      { x: -8, z: 0, y: 0, yaw: 0, len: 10, wid: 6, terrace: 0 },
      { x: 8, z: 2, y: 0, yaw: 0.3, len: 10, wid: 6, terrace: 0 },
    ];
    levelHousePads(hf, houses);
    for (const h of houses) {
      for (const [u, v] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45], [0, 0]]) {
        const lx = u * h.len;
        const lz = v * h.wid;
        const x = h.x + lx * Math.cos(h.yaw) + lz * Math.sin(h.yaw);
        const z = h.z - lx * Math.sin(h.yaw) + lz * Math.cos(h.yaw);
        expect(Math.abs(hf.heightAt(x, z) - h.y)).toBeLessThan(0.05);
      }
    }
  });

  it('splits overlapping footprints at different heights so each house sits on its own ground', () => {
    const hf = slope();
    // 11 m apart along the slope (walls 1 m apart): their padded footprints overlap, their pads differ by over 6 m
    const houses: HousePlacement[] = [
      { x: 0, z: 0, y: 0, yaw: 0, len: 10, wid: 6, terrace: 0 },
      { x: 11, z: 0, y: 0, yaw: 0, len: 10, wid: 6, terrace: 0 },
    ];
    levelHousePads(hf, houses);
    expect(houses[1].y - houses[0].y).toBeGreaterThan(6);
    for (const h of houses) {
      for (const u of [-0.45, 0, 0.45]) expect(Math.abs(hf.heightAt(h.x + u * h.len, 1) - h.y)).toBeLessThan(0.05);
    }
  });

  it('puts houses the bake crowded into each other on one shared pad', () => {
    const hf = slope();
    const houses: HousePlacement[] = [
      { x: 0, z: 0, y: 0, yaw: 0, len: 12, wid: 6, terrace: 0 },
      { x: 9, z: 1, y: 0, yaw: 0.2, len: 12, wid: 6, terrace: 0 }, // walls overlap by about 3 m
    ];
    levelHousePads(hf, houses);
    expect(houses[0].y).toBeCloseTo(houses[1].y, 5);
    for (const h of houses) {
      for (const u of [-0.45, 0, 0.45]) {
        const x = h.x + u * h.len * Math.cos(h.yaw);
        const z = h.z - u * h.len * Math.sin(h.yaw);
        expect(Math.abs(hf.heightAt(x, z) - h.y)).toBeLessThan(0.05);
      }
    }
  });
});
