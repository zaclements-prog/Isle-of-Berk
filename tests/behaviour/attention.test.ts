import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Attention, InterestField, type AttentionInput, type InterestPoint } from '../../src/characters/dragon/behaviour/attention';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';

const DT = 1 / 120;
const T = DEFAULT_TUNING.attention;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const pt = (id: string, p: THREE.Vector3, weight = 1, kind = 'view'): InterestPoint => ({ id, kind, position: p, weight });
const still = (o: Partial<AttentionInput> = {}): AttentionInput => ({ headPos: V(0, 1.5, 2), heading: 0, speed: 0, aim: null, ...o });

function run(a: Attention, f: InterestField, inp: AttentionInput, seconds: number, each?: () => void): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    a.update(inp, f, DT);
    each?.();
  }
}

describe('Attention', () => {
  it('picks the most interesting point by weight and distance', () => {
    const f = new InterestField();
    f.register(pt('far', V(0, 1, 13), 1));
    f.register(pt('near', V(1, 1, 5), 1));
    f.register(pt('faint', V(-1, 1, 4), 0.1));
    const a = new Attention(T);
    run(a, f, still(), 0.5);
    expect(a.mode).toBe('interest');
    expect(a.target?.id).toBe('near');
    expect(a.point.distanceTo(V(1, 1, 5))).toBeLessThan(1e-9);
  });
  it('ignores points outside a narrow cone while moving, but looks well aside when standing', () => {
    const f = new InterestField();
    f.register(pt('side', V(6, 1, 2), 1));                        // ~90° to his left
    const moving = new Attention(T);
    run(moving, f, still({ speed: 3 }), 0.5);
    expect(moving.mode).toBe('none');
    const standing = new Attention(T);
    run(standing, f, still(), 0.5);
    expect(standing.target?.id).toBe('side');
  });
  it('prefers moving things', () => {
    const f = new InterestField();
    const fly = pt('butterfly', V(-2, 1.5, 7), 0.6, 'butterfly');
    f.register(pt('rock', V(2, 1, 7), 0.6));
    f.register(fly);
    const a = new Attention(T);
    run(a, f, still(), 1, () => fly.position.x += 1.2 * DT);
    expect(a.target?.id).toBe('butterfly');
  });
  it('gets bored of one point, looks elsewhere, and comes back later', () => {
    const f = new InterestField();
    f.register(pt('a', V(0, 1, 5), 1));
    f.register(pt('b', V(3, 1, 7), 0.6));
    const a = new Attention(T);
    const seen: string[] = [];
    run(a, f, still(), T.dwell + T.bored + 3, () => {
      const id = a.target?.id ?? '-';
      if (seen[seen.length - 1] !== id) seen.push(id);
    });
    expect(seen.slice(0, 3)).toEqual(['a', 'b', '-']);
    expect(seen).toContain('a');
    expect(seen.lastIndexOf('a')).toBeGreaterThan(0);
  });
  it('puts the plasma aim above every interest point', () => {
    const f = new InterestField();
    f.register(pt('a', V(0, 1, 5), 1));
    const a = new Attention(T);
    run(a, f, still({ aim: V(-10, 2, 20) }), 0.2);
    expect(a.mode).toBe('aim');
    expect(a.point.x).toBe(-10);
  });
  it('reads a live list (a region\'s interestPoints array) on every query', () => {
    const f = new InterestField();
    const region: InterestPoint[] = [];
    const undo = f.addList(region);
    const a = new Attention(T);
    run(a, f, still(), 0.2);
    expect(a.mode).toBe('none');
    region.push(pt('fish', V(0.5, 0.2, 4), 1, 'fish'));
    run(a, f, still(), 0.2);
    expect(a.target?.id).toBe('fish');
    undo();
    run(a, f, still(), 0.2);
    expect(a.mode).toBe('none');
  });
  it('does not flicker between two nearly equal points', () => {
    const f = new InterestField();
    f.register(pt('l', V(-1, 1, 5), 1));
    f.register(pt('r', V(1, 1, 5), 1.05));
    const a = new Attention(T);
    let switches = 0;
    let prev = '';
    run(a, f, still(), 3, () => {
      const id = a.target?.id ?? '-';
      if (id !== prev) switches++;
      prev = id;
    });
    expect(switches).toBe(1);
  });
});
