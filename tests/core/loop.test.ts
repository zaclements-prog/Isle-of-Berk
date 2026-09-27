import { describe, it, expect } from 'vitest';
import { GameLoop } from '../../src/core/loop';
import { FixedStepClock } from '../../src/core/clock';

describe('GameLoop', () => {
  it('runs fixed sim steps then one render per frame', () => {
    const loop = new GameLoop(new FixedStepClock(1 / 120, 8));
    const dts: number[] = [];
    const alphas: number[] = [];
    loop.addSim((dt) => dts.push(dt));
    loop.addRender((alpha) => alphas.push(alpha));
    loop.frame(1 / 60);
    expect(dts).toEqual([1 / 120, 1 / 120]);
    expect(alphas.length).toBe(1);
    expect(loop.simTime).toBeCloseTo(1 / 60, 9);
  });

  it('does not simulate while paused but still renders the current state', () => {
    const loop = new GameLoop();
    let sims = 0;
    const alphas: number[] = [];
    loop.addSim(() => sims++);
    loop.addRender((a) => alphas.push(a));
    loop.pause();
    loop.frame(1 / 30);
    expect(sims).toBe(0);
    expect(alphas).toEqual([1]);
  });

  it('step(n) advances exactly n steps even while paused', () => {
    const loop = new GameLoop();
    const dts: number[] = [];
    let renders = 0;
    loop.addSim((dt) => dts.push(dt));
    loop.addRender(() => renders++);
    loop.pause();
    loop.step(3, 1 / 60);
    expect(dts).toEqual([1 / 60, 1 / 60, 1 / 60]);
    expect(renders).toBe(1);
    expect(loop.simTime).toBeCloseTo(0.05, 9);
  });

  it('removal functions detach systems', () => {
    const loop = new GameLoop();
    let n = 0;
    const off = loop.addSim(() => n++);
    off();
    loop.frame(1 / 60);
    expect(n).toBe(0);
  });

  it('orders systems by priority (lower first), then insertion', () => {
    const loop = new GameLoop();
    const order: string[] = [];
    loop.addSim(() => order.push('b'), 10);
    loop.addSim(() => order.push('a'), 0);
    loop.addSim(() => order.push('c'), 10);
    loop.step(1);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
