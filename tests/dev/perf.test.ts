import { describe, it, expect } from 'vitest';
import { gpuFence, measureRenderCost } from '../../src/dev/perf';

describe('measureRenderCost', () => {
  it('warms up once, then times the requested frames', () => {
    let renders = 0;
    let finishes = 0;
    const gl = { finish: () => { finishes++; } };
    const r = measureRenderCost(() => { renders++; }, gl, 10);
    expect(renders).toBe(11);
    expect(finishes).toBe(2);
    expect(r.frames).toBe(10);
    expect(r.msPerFrame).toBeGreaterThanOrEqual(0);
  });
});

describe('gpuFence', () => {
  it('waits by reading back one pixel (Chrome treats WebGL finish() as a flush)', () => {
    const reads: number[][] = [];
    const gl = {
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      readPixels: (x: number, y: number, w: number, h: number, format: number, type: number) => { reads.push([x, y, w, h, format, type]); },
    } as unknown as WebGL2RenderingContext;
    gpuFence(gl).finish();
    expect(reads).toEqual([[0, 0, 1, 1, 0x1908, 0x1401]]);
  });
});
