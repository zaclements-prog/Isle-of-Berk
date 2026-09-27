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
