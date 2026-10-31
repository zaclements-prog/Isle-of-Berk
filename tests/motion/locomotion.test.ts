import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GaitEngine, GAITS } from '../../src/characters/dragon/motion/gait';
import { LOCO_ORDER, LocomotionDriver, sampleLoop } from '../../src/characters/dragon/motion/locomotion';
import { PoseLayerStack, parsePosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const DT = 1 / 120;
const BEND = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0));
const cycle = (name: string) => new THREE.AnimationClip(name, 1, [
  new THREE.QuaternionKeyframeTrack('spine_02.quaternion', [0, 0.5, 1], [0, 0, 0, 1, ...BEND.toArray(), 0, 0, 0, 1]),
]);
const loco = (gait: string, duty: number) => ({
  mask: ['spine_'], loop: true, duration: 1,
  locomotion: { gait, speed: 1, stride: 1, duty, offsets: [0, 0.25, 0.5, 0.75], height: 0.95, rootBob: [0.1, -0.1], wingLift: [0, 0.2] },
});
const meta = parsePosesMeta({ clips: { loco_walk: loco('walk', 0.68), loco_gallop: loco('gallop', 0.21), sit: { mask: 'all' } } });

function setup() {
  const s = new RigSkeleton(toothlessFixtureRig());
  const layers = new PoseLayerStack(s, new Map([['loco_walk', cycle('loco_walk')], ['loco_gallop', cycle('loco_gallop')]]), meta);
  const gait = new GaitEngine({ hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05 });
  return { s, layers, gait, d: new LocomotionDriver(layers, meta, DEFAULT_TUNING.loco) };
}

function run(o: ReturnType<typeof setup>, speed: number, seconds: number, yawRate = 0, suppress = 0): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    o.gait.update(speed, DT);
    o.d.update(o.gait, speed, yawRate, suppress, DT);
  }
}

describe('authored locomotion (Plan 5)', () => {
  it('samples a loop curve linearly and wraps', () => {
    expect(sampleLoop([0, 1], 0)).toBe(0);
    expect(sampleLoop([0, 1], 0.25)).toBeCloseTo(0.5, 9);
    expect(sampleLoop([0, 1], 0.75)).toBeCloseTo(0.5, 9);       // frame 1 → frame 0 across the wrap
    expect(sampleLoop([0, 1], 1.5)).toBeCloseTo(sampleLoop([0, 1], 0.5), 9);
  });

  it('finds the cycles whose gait and clip exist', () => {
    const { d } = setup();
    expect(d.cycles.map((c) => c.clip).sort()).toEqual(['loco_gallop', 'loco_walk']);
    expect(d.cycles.find((c) => c.clip === 'loco_gallop')!.gait).toBe(GAITS.findIndex((g) => g.name === 'gallop'));
  });

  it('is a no-op without cycles', () => {
    const s = new RigSkeleton(toothlessFixtureRig());
    const layers = new PoseLayerStack(s, new Map(), { clips: {} });
    const d = new LocomotionDriver(layers, { clips: {} }, DEFAULT_TUNING.loco);
    const gait = new GaitEngine({ hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05 });
    gait.update(1, DT);
    d.update(gait, 1, 0, 0, DT);
    expect(d.available).toBe(false);
    expect(d.weight).toBe(0);
    expect(layers.active().length).toBe(0);
  });

  it('plays the walk additively under the library layers, synced to the gait phase, with bob and wing lift', () => {
    const o = setup();
    run(o, 1, 2);
    expect(o.d.weight).toBeCloseTo(1, 6);
    const live = o.layers.active().find((l) => l.name === 'loco_walk')!;
    expect(live.weight).toBeCloseTo(1, 6);
    expect(live.time).toBeCloseTo(o.gait.phase, 6);         // duration 1: layer time = phase
    expect(o.layers.active().find((l) => l.name === 'loco_gallop')).toBeUndefined();
    expect(o.d.bob).toBeCloseTo(sampleLoop([0.1, -0.1], o.gait.phase), 6);
    expect(o.d.wingLift).toBeCloseTo(sampleLoop([0, 0.2], o.gait.phase), 6);
    expect(LOCO_ORDER).toBeLessThan(0);
  });

  it('fades out standing, in a tight turn and while suppressed — quickly — and back in over blendTime', () => {
    const o = setup();
    run(o, 1, 2);
    run(o, 1, 0.5, 0, 1);                                       // suppressed (climbing, a pose owning the legs, …)
    expect(o.d.weight).toBe(0);
    run(o, 1, DEFAULT_TUNING.loco.blendTime / 2);
    expect(o.d.weight).toBeCloseTo(0.5, 2);
    run(o, 1, 1, 3);                                            // 3 rad/s at 1 m/s: radius 0.33 m
    expect(o.d.weight).toBe(0);
    run(o, 1, 1, 0.3);                                          // a wide turn keeps the cycle
    expect(o.d.weight).toBeCloseTo(1, 6);
    run(o, 0, 1);
    expect(o.d.weight).toBe(0);
  });

  it('crossfades the cycles with the gait weights', () => {
    const o = setup();
    run(o, 8, 3);
    expect(o.layers.weight('loco_gallop')).toBeCloseTo(1, 6);
    expect(o.layers.weight('loco_walk')).toBe(0);
  });

  it('lets a cycle set its gait timing', () => {
    const g = new GaitEngine({ hysteresis: 0.3, blendTime: 0.3, stopSpeed: 0.05 });
    g.setTiming(2, { duty: 0.21 });
    for (let k = 0; k < 360; k++) g.update(8, DT);
    expect(g.name).toBe('gallop');
    expect(g.duty).toBeCloseTo(0.21, 9);
    expect(GAITS[2].duty).toBe(0.33);                           // the shared table is untouched
  });

  it('rejects a locomotion block without its curves', () => {
    expect(() => parsePosesMeta({ clips: { c: { mask: ['spine_'], locomotion: { gait: 'walk', stride: 1, rootBob: [] } } } })).toThrow(/locomotion/);
  });
});
