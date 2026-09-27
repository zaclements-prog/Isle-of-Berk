import { describe, it, expect } from 'vitest';
import { DebugRegistry } from '../../src/core/debug';

describe('DebugRegistry', () => {
  it('registers root functions and namespaces, merging repeated namespaces', () => {
    const d = new DebugRegistry();
    d.register(null, { step: () => 'stepped' });
    d.register('cam', { preset: () => 1 });
    d.register('cam', { orbit: () => 2 });
    const api = d.api as { step: () => string; cam: { preset: () => number; orbit: () => number } };
    expect(api.step()).toBe('stepped');
    expect(api.cam.preset()).toBe(1);
    expect(api.cam.orbit()).toBe(2);
  });

  it('exposes the api object on a target under a name', () => {
    const d = new DebugRegistry();
    d.register(null, { ping: () => 'pong' });
    const target: Record<string, unknown> = {};
    d.expose(target, 'berk');
    expect((target.berk as { ping: () => string }).ping()).toBe('pong');
  });

  it('keeps the exposed object live for later registrations', () => {
    const d = new DebugRegistry();
    const target: Record<string, unknown> = {};
    d.expose(target);
    d.register('lab', { run: () => 'ok' });
    expect((target.berk as { lab: { run: () => string } }).lab.run()).toBe('ok');
  });
});
