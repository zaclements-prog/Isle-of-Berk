import { describe, it, expect } from 'vitest';
import { DEFAULT_TUNING, mergeTuning } from '../../src/characters/dragon/motion/tuning';

describe('tuning', () => {
  it('carries the spec defaults', () => {
    const c = DEFAULT_TUNING.controller;
    expect([c.trotSpeed, c.prowlSpeed, c.gallopSpeed]).toEqual([3.2, 1.4, 10]);
    expect([c.accel, c.gallopAccel, c.brake]).toEqual([5, 8, 12]);
    expect([c.turnRateSlowDeg, c.turnRateFastDeg]).toEqual([200, 80]);
  });
  it('merges a partial preset without touching the defaults, ignoring unknown keys', () => {
    const t = mergeTuning(DEFAULT_TUNING, { body: { maxTiltDeg: 30 }, look: { weights: [1, 0, 0, 0, 0] } } as never);
    expect(t.body.maxTiltDeg).toBe(30);
    expect(t.look.weights).toEqual([1, 0, 0, 0, 0]);
    expect(DEFAULT_TUNING.body.maxTiltDeg).toBe(35);
    const u = mergeTuning(DEFAULT_TUNING, { body: { nonsense: 1 }, bogus: { x: 1 } } as never);
    expect((u.body as unknown as Record<string, unknown>).nonsense).toBeUndefined();
  });
});
