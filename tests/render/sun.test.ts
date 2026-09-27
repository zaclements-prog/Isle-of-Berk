import { describe, it, expect } from 'vitest';
import { sunDirection } from '../../src/render/sun';

describe('sunDirection', () => {
  it('points north (−Z) at azimuth 0 on the horizon', () => {
    const d = sunDirection(0, 0);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(-1, 6);
  });

  it('points east (+X) at azimuth 90', () => {
    const d = sunDirection(90, 0);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('points straight up at elevation 90 and is unit length', () => {
    expect(sunDirection(123, 90).y).toBeCloseTo(1, 6);
    expect(sunDirection(292, 14).length()).toBeCloseTo(1, 6);
  });

  it('places the golden-hour sun low in the west-northwest', () => {
    const d = sunDirection(292, 14);
    expect(d.x).toBeLessThan(-0.8);
    expect(d.y).toBeGreaterThan(0.2);
    expect(d.z).toBeLessThan(0);
  });
});
