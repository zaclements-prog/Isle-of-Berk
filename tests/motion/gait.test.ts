import { describe, it, expect } from 'vitest';
import { GaitEngine, GAITS } from '../../src/characters/dragon/motion/gait';
import { phaseDiff } from '../../src/characters/dragon/motion/math';

const DT = 1 / 120;
const make = () => new GaitEngine({ hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05 });
const hold = (g: GaitEngine, speed: number, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) g.update(speed, DT);
};

describe('GaitEngine', () => {
  it.each([
    [1.0, 'walk'],
    [4.0, 'trot'],
    [8.0, 'gallop'],
  ] as const)('settles at %s m/s into the %s table values', (speed, name) => {
    const g = make();
    hold(g, speed, 3);
    const p = GAITS.find((x) => x.name === name)!;
    expect(g.name).toBe(name);
    expect(g.duty).toBeCloseTo(p.duty, 9);
    expect(g.swingHeight).toBeCloseTo(p.swingHeight, 9);
    for (let leg = 0; leg < 4; leg++) expect(Math.abs(phaseDiff(g.offsets[leg], p.offsets[leg]))).toBeLessThan(1e-9);
    expect(g.strideLength).toBeCloseTo(speed / g.cadence, 9);
  });
  it('maps speed to cadence within each gait range', () => {
    const g = make();
    hold(g, 2.4, 2);
    expect(g.name).toBe('walk');
    expect(g.cadence).toBeCloseTo(1.2, 9);
    hold(g, 5.5, 2);
    expect(g.name).toBe('trot');
    expect(g.cadence).toBeCloseTo(1.8, 9);
  });
  it('holds its gait inside the hysteresis band', () => {
    const g = make();
    hold(g, 4, 1);
    for (let i = 0; i < 240; i++) g.update(i % 2 ? 2.25 : 2.55, DT);
    expect(g.name).toBe('trot');
  });
  it('never jumps a leg phase across a 0 → 10 → 0 m/s ramp', () => {
    const g = make();
    const prev = [0, 0, 0, 0].map((_, leg) => g.legPhase(leg));
    for (let i = 0; i <= 2400; i++) {
      const t = i * DT;
      g.update(10 * (1 - Math.abs(t - 10) / 10), DT);
      for (let leg = 0; leg < 4; leg++) {
        const p = g.legPhase(leg);
        expect(Math.abs(phaseDiff(prev[leg], p))).toBeLessThan(0.06);
        prev[leg] = p;
      }
    }
  });
  it('freezes the phase when stopped', () => {
    const g = make();
    hold(g, 1, 1);
    g.update(0, DT);
    const p = g.phase;
    hold(g, 0, 1);
    expect(g.phase).toBe(p);
    expect(g.cadence).toBe(0);
    expect(g.swingDuration).toBe(Infinity);
  });
  it('raises the cadence so strides fit the legs (stance travel ≤ the stride limit), up to maxCadence', () => {
    const g = new GaitEngine({ hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05, maxCadence: 3 });
    g.setStrideLimit(0.8);
    hold(g, 4, 3);
    expect((g.speed * g.duty) / g.cadence).toBeCloseTo(0.8, 9); // table cadence 1.55 Hz would travel 1.29 m
    hold(g, 10, 3);
    expect(g.cadence).toBeCloseTo(3, 9); // the floor (4.1 Hz) is capped
    hold(g, 1, 3);
    expect(g.cadence).toBeCloseTo(0.8 + 0.4 * (1 / 2.4), 9); // short strides keep the table cadence
  });
  it('applies climbing modifiers (shorter strides → higher cadence, higher swings)', () => {
    const g = make();
    hold(g, 1.5, 2);
    const base = g.cadence;
    g.update(1.5, DT, { cadenceScale: 0.8, strideScale: 0.7, swingScale: 1.5 });
    expect(g.cadence).toBeCloseTo((base * 0.8) / 0.7, 9);
    expect(g.swingHeight).toBeCloseTo(0.12 * 1.5, 9);
  });
});
