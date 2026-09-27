import { describe, it, expect } from 'vitest';
import { gradeColor, bakeLutData, NEUTRAL_GRADE, FILM_GRADE } from '../../src/render/grade';

describe('gradeColor', () => {
  it('is the identity for the neutral grade', () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.3]] as const) {
      const [r, g, b] = gradeColor(c[0], c[1], c[2], NEUTRAL_GRADE);
      expect(r).toBeCloseTo(c[0], 6);
      expect(g).toBeCloseTo(c[1], 6);
      expect(b).toBeCloseTo(c[2], 6);
    }
  });

  it('desaturates to grey at saturation 0', () => {
    const [r, g, b] = gradeColor(0.8, 0.2, 0.1, { ...NEUTRAL_GRADE, saturation: 0 });
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
  });

  it('film grade warms highlights and cools shadows', () => {
    const hi = gradeColor(0.9, 0.9, 0.9, FILM_GRADE);
    const lo = gradeColor(0.1, 0.1, 0.1, FILM_GRADE);
    expect(hi[0]).toBeGreaterThan(hi[2]);
    expect(lo[2]).toBeGreaterThan(lo[0]);
  });

  it('stays within 0..1', () => {
    const out = gradeColor(1, 1, 0, { ...FILM_GRADE, saturation: 3, contrast: 2 });
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('bakeLutData', () => {
  it('bakes an identity cube for the neutral grade (red fastest, then green, then blue)', () => {
    const size = 8;
    const data = bakeLutData(NEUTRAL_GRADE, size);
    expect(data.length).toBe(size * size * size * 4);
    const at = (r: number, g: number, b: number) => {
      const i = ((b * size + g) * size + r) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    expect(at(0, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(7, 7, 7)).toEqual([255, 255, 255, 255]);
    expect(at(7, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(0, 0, 7)).toEqual([0, 0, 255, 255]);
  });
});
