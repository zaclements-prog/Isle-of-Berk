import { describe, it, expect } from 'vitest';
import { FixedStepClock } from '../../src/core/clock';

describe('FixedStepClock', () => {
  it('runs two 1/120 s steps for a 1/60 s frame', () => {
    const c = new FixedStepClock(1 / 120, 8);
    const r = c.advance(1 / 60);
    expect(r.steps).toBe(2);
    expect(r.alpha).toBeCloseTo(0, 6);
  });

  it('carries the remainder between frames', () => {
    const c = new FixedStepClock(1 / 120, 8);
    const a = c.advance(0.004);
    expect(a.steps).toBe(0);
    expect(a.alpha).toBeCloseTo(0.48, 6);
    const b = c.advance(0.005);
    expect(b.steps).toBe(1);
    expect(b.alpha).toBeCloseTo((0.009 - 1 / 120) * 120, 6);
  });

  it('drops the backlog beyond maxSteps (e.g. after a hidden tab)', () => {
    const c = new FixedStepClock(1 / 120, 8);
    const r = c.advance(1.0);
    expect(r.steps).toBe(8);
    expect(r.alpha).toBe(0);
    expect(c.advance(0).steps).toBe(0);
  });

  it('ignores negative elapsed time', () => {
    const c = new FixedStepClock(1 / 120, 8);
    expect(c.advance(-5).steps).toBe(0);
    expect(c.advance(-5).alpha).toBe(0);
  });
});
