import { describe, it, expect } from 'vitest';
import { filmstripLayout } from '../../src/dev/filmstrip';

describe('filmstripLayout', () => {
  it('lays frames out row-major with the source aspect ratio', () => {
    const l = filmstripLayout(12, 6, 1920, 1080, 320);
    expect(l.tw).toBe(320);
    expect(l.th).toBe(180);
    expect(l.cols).toBe(6);
    expect(l.rows).toBe(2);
    expect(l.cell(0)).toEqual([0, 0]);
    expect(l.cell(5)).toEqual([1600, 0]);
    expect(l.cell(6)).toEqual([0, 180]);
  });

  it('uses fewer columns than requested when there are fewer frames', () => {
    const l = filmstripLayout(3, 6, 1000, 500, 200);
    expect(l.cols).toBe(3);
    expect(l.rows).toBe(1);
  });
});
