import { describe, it, expect } from 'vitest';
import { ScriptedInput, KeyboardMouseInput } from '../../src/core/input';

function keyEvent(type: string, code: string): Event {
  const e = new Event(type);
  Object.assign(e, { code });
  return e;
}

function mouseEvent(type: string, props: Record<string, number>): Event {
  const e = new Event(type);
  Object.assign(e, props);
  return e;
}

describe('ScriptedInput', () => {
  it('applies events at their simulation time', () => {
    const s = new ScriptedInput([{ t: 0.5, down: ['KeyW'] }, { t: 1.0, up: ['KeyW'] }]);
    expect(s.sample(0.25).keys.has('KeyW')).toBe(false);
    const a = s.sample(0.5);
    expect(a.keys.has('KeyW')).toBe(true);
    expect(a.pressed.has('KeyW')).toBe(true);
    const b = s.sample(0.75);
    expect(b.keys.has('KeyW')).toBe(true);
    expect(b.pressed.has('KeyW')).toBe(false);
    expect(s.sample(1.0).keys.has('KeyW')).toBe(false);
    expect(s.done).toBe(true);
  });

  it('delivers mouse deltas and wheel exactly once', () => {
    const s = new ScriptedInput([{ t: 0, mouse: [10, -4], wheel: 3 }]);
    const a = s.sample(0);
    expect([a.mouseDX, a.mouseDY, a.wheel]).toEqual([10, -4, 3]);
    const b = s.sample(0.1);
    expect([b.mouseDX, b.mouseDY, b.wheel]).toEqual([0, 0, 0]);
  });

  it('tracks mouse buttons with edges', () => {
    const s = new ScriptedInput([{ t: 0, buttonsDown: 1 }, { t: 0.2, buttonsUp: 1 }]);
    const a = s.sample(0);
    expect(a.buttons).toBe(1);
    expect(a.buttonsPressed).toBe(1);
    const b = s.sample(0.1);
    expect(b.buttons).toBe(1);
    expect(b.buttonsPressed).toBe(0);
    expect(s.sample(0.2).buttons).toBe(0);
  });

  it('replays identically after reset', () => {
    const s = new ScriptedInput([{ t: 0.1, down: ['ShiftLeft'] }]);
    const first = s.sample(0.2).pressed.has('ShiftLeft');
    s.reset();
    expect(s.sample(0.2).pressed.has('ShiftLeft')).toBe(first);
  });
});

describe('KeyboardMouseInput', () => {
  it('reports held keys and a single press edge despite key repeat', () => {
    const target = new EventTarget();
    const inp = new KeyboardMouseInput(target);
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    target.dispatchEvent(keyEvent('keydown', 'KeyW')); // auto-repeat
    const a = inp.sample();
    expect(a.keys.has('KeyW')).toBe(true);
    expect(a.pressed.has('KeyW')).toBe(true);
    expect(inp.sample().pressed.has('KeyW')).toBe(false);
    target.dispatchEvent(keyEvent('keyup', 'KeyW'));
    expect(inp.sample().keys.has('KeyW')).toBe(false);
    inp.dispose();
  });

  it('accumulates mouse movement only while pointer-locked', () => {
    const target = new EventTarget();
    let locked = false;
    const inp = new KeyboardMouseInput(target, () => locked);
    target.dispatchEvent(mouseEvent('mousemove', { movementX: 5, movementY: 2 }));
    expect(inp.sample().mouseDX).toBe(0);
    locked = true;
    target.dispatchEvent(mouseEvent('mousemove', { movementX: 5, movementY: 2 }));
    target.dispatchEvent(mouseEvent('mousemove', { movementX: 1, movementY: 1 }));
    const s = inp.sample();
    expect([s.mouseDX, s.mouseDY]).toEqual([6, 3]);
  });

  it('clears held keys and buttons when the window loses focus', () => {
    const target = new EventTarget();
    const inp = new KeyboardMouseInput(target);
    target.dispatchEvent(keyEvent('keydown', 'KeyA'));
    target.dispatchEvent(mouseEvent('mousedown', { button: 0 }));
    target.dispatchEvent(new Event('blur'));
    const s = inp.sample();
    expect(s.keys.size).toBe(0);
    expect(s.buttons).toBe(0);
  });
});
