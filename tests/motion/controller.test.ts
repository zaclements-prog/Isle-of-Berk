import { describe, it, expect } from 'vitest';
import type { InputState } from '../../src/core/input';
import { DragonController, BodyKinematics, createIntent } from '../../src/characters/dragon/motion/controller';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { deg } from '../../src/characters/dragon/motion/math';

const T = DEFAULT_TUNING.controller;
const DT = 1 / 120;
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});

describe('DragonController', () => {
  it('moves camera-relative: W is the camera forward, D its right', () => {
    const c = new DragonController();
    const i = createIntent();
    c.read(input(['KeyW']), 0, T, i);
    expect(i.dirX).toBeCloseTo(0, 12);
    expect(i.dirZ).toBeCloseTo(1, 12);
    c.read(input(['KeyW']), Math.PI / 2, T, i);
    expect(i.dirX).toBeCloseTo(1, 12);
    c.read(input(['KeyD']), 0, T, i);
    expect(i.dirX).toBeCloseTo(-1, 12);
    expect(i.speed).toBe(3.2);
  });
  it('toggles prowl on C presses, gallops with Shift, and ignores Ctrl', () => {
    const c = new DragonController();
    const i = createIntent();
    c.read(input(['KeyW', 'KeyC'], ['KeyC']), 0, T, i);
    expect(i.speed).toBe(1.4);
    c.read(input(['KeyW', 'KeyC']), 0, T, i);
    expect(i.speed).toBe(1.4);
    c.read(input(['KeyW', 'ShiftLeft']), 0, T, i);
    expect(i.speed).toBe(10);
    c.read(input(['KeyW'], ['KeyC']), 0, T, i);
    expect(i.speed).toBe(3.2);
    c.read(input(['ControlLeft']), 0, T, i);
    expect(i.hasDir).toBe(false);
    expect(i.speed).toBe(0);
  });
});

describe('BodyKinematics', () => {
  const run = (k: BodyKinematics, keys: string[], cameraYaw: number, seconds: number, c = new DragonController()) => {
    const i = createIntent();
    let maxRate = 0;
    for (let s = 0; s < Math.round(seconds / DT); s++) {
      c.read(input(keys), cameraYaw, T, i);
      k.plan(i, DT, T);
      k.commit(k.delta, DT);
      maxRate = Math.max(maxRate, Math.abs(k.yawRate));
    }
    return maxRate;
  };
  it('accelerates at the spec rates and brakes harder', () => {
    const k = new BodyKinematics();
    run(k, ['KeyW'], 0, 0.5);
    expect(k.speed).toBeLessThanOrEqual(2.5 + 1e-9);
    run(k, ['KeyW'], 0, 1);
    expect(k.speed).toBeCloseTo(3.2, 9);
    run(k, ['KeyW', 'ShiftLeft'], 0, 0.5);
    expect(k.speed).toBeCloseTo(3.2 + 4, 6);
    run(k, [], 0, 0.5);
    expect(k.speed).toBeCloseTo(1.2, 6);
  });
  it('limits the turn rate: 200°/s slow, 80°/s at gallop', () => {
    const slow = new BodyKinematics();
    expect(run(slow, ['KeyD'], 0, 0.3)).toBeLessThanOrEqual(deg(200) + 1e-9);
    const fast = new BodyKinematics();
    run(fast, ['KeyW', 'ShiftLeft'], 0, 2);
    expect(run(fast, ['KeyD', 'ShiftLeft'], 0, DT)).toBeLessThanOrEqual(deg(80) + 1e-6); // first step, still at 10 m/s
  });
  it('turns (nearly) on the spot before moving off in the opposite direction', () => {
    const k = new BodyKinematics();
    const i = createIntent();
    const c = new DragonController();
    let maxSpeed = 0;
    for (let s = 0; s < 60; s++) {
      c.read(input(['KeyS']), 0, T, i);
      k.plan(i, DT, T);
      k.commit(k.delta, DT);
      maxSpeed = Math.max(maxSpeed, k.speed);
    }
    expect(maxSpeed).toBeLessThanOrEqual(T.inPlaceSpeed + 1e-9);
    run(k, ['KeyS'], 0, 3, c);
    expect(Math.abs(Math.cos(k.heading) + 1)).toBeLessThan(1e-3);
    expect(k.speed).toBeCloseTo(3.2, 6);
  });
  it('loses the speed a wall blocks', () => {
    const k = new BodyKinematics();
    run(k, ['KeyW'], 0, 1.5);
    k.commit(k.delta.set(0, 0, 0), DT);
    expect(k.speed).toBe(0);
  });
});
