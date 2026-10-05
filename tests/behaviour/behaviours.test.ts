import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { mulberry32 } from '../../src/core/rng';
import { DragonBrain } from '../../src/characters/dragon/behaviour/brain';
import { BEHAVIOURS, BehaviourSelector, type BehaviourContext } from '../../src/characters/dragon/behaviour/selector';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import type { PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const input = (keys: string[] = [], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});
const calm = { calm: 1, curious: 0, excited: 0, tired: 0, aggressive: 0 };
const ctx = (o: Partial<BehaviourContext> = {}): BehaviourContext => ({ idle: 0, posture: 'stand', mood: calm, interest: false, sinceStoodUp: 99, ...o });
const T = DEFAULT_TUNING.behaviour;

describe('BehaviourSelector (spec §8.1)', () => {
  it('waits for each behaviour\'s idle threshold and posture', () => {
    const s = new BehaviourSelector(BEHAVIOURS, mulberry32(1), T);
    const sit = s.def('sit')!;
    expect(s.eligible(sit, ctx({ idle: 9.9 }), 100)).toBe(false);
    expect(s.eligible(sit, ctx({ idle: 10 }), 100)).toBe(true);
    expect(s.eligible(s.def('lie')!, ctx({ idle: 30, posture: 'stand' }), 100)).toBe(false);
    expect(s.eligible(s.def('lie')!, ctx({ idle: 30, posture: 'sit' }), 100)).toBe(true);
    expect(s.eligible(s.def('sleep')!, ctx({ idle: 59, posture: 'lie', mood: { ...calm, tired: 1 } }), 100)).toBe(false);
    expect(s.eligible(s.def('sleep')!, ctx({ idle: 61, posture: 'lie', mood: { ...calm, tired: 1 } }), 100)).toBe(true);
    expect(s.eligible(s.def('scratch')!, ctx({ idle: 20, posture: 'stand' }), 100)).toBe(false);
    expect(s.eligible(s.def('watch')!, ctx({ idle: 5 }), 100)).toBe(false);          // nothing to watch
    expect(s.eligible(s.def('watch')!, ctx({ idle: 5, interest: true }), 100)).toBe(true);
  });
  it('respects cooldowns, counted from when a behaviour ends, and never repeats a running one', () => {
    const s = new BehaviourSelector(BEHAVIOURS, mulberry32(1), T);
    const sniff = s.def('sniff')!;
    s.started('sniff');
    expect(s.eligible(sniff, ctx({ idle: 5 }), 100)).toBe(false);
    s.ended('sniff', 100);
    expect(s.eligible(sniff, ctx({ idle: 5 }), 100 + sniff.cooldown - 0.01)).toBe(false);
    expect(s.eligible(sniff, ctx({ idle: 5 }), 100 + sniff.cooldown)).toBe(true);
  });
  it('draws by utility with a share of plain idling, deterministically for a seed', () => {
    const count = (seed: number) => {
      const s = new BehaviourSelector(BEHAVIOURS, mulberry32(seed), T);
      const n: Record<string, number> = {};
      for (let k = 0; k < 4000; k++) {
        const d = s.pick(ctx({ idle: 5 }), 0);
        n[d?.name ?? 'rest'] = (n[d?.name ?? 'rest'] ?? 0) + 1;
      }
      return n;
    };
    const a = count(3);
    expect(a).toEqual(count(3));
    const sum = T.restWeight + 1 + 0.8 + 0.25 + 0.35 + 0.25 + 0.6 + 0.6 + 0.5;   // eligible utilities at 5 s idle, standing
    expect(a.rest / 4000).toBeCloseTo(T.restWeight / sum, 1);
    expect(a.look_around / 4000).toBeCloseTo(1 / sum, 1);
    expect(a.sit).toBeUndefined();
  });
});

function fixtureDragon(seed = 1, clips?: Map<string, THREE.AnimationClip>, posesMeta?: PosesMeta) {
  const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world, clips, posesMeta, seed });
  d.spawn(0, 0, 0);
  const brain = new DragonBrain(d, { rig: toothlessFixtureRig(), seed });
  return { d, brain, world };
}

describe('BehaviourSystem on the character (fixture rig, no clips)', () => {
  it('idles its way down the posture chain: sit, then lie, then asleep', { timeout: 60_000 }, () => {
    const { d, brain } = fixtureDragon(5);
    const reached: Record<string, number> = {};
    for (let k = 0; k < Math.round(95 / DT); k++) {
      d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
      const p = brain.behaviours.posture.current;
      if (reached[p] === undefined) reached[p] = k * DT;
    }
    expect(reached.sit).toBeGreaterThanOrEqual(10);
    expect(reached.lie).toBeGreaterThanOrEqual(25);
    expect(reached.sleep).toBeGreaterThanOrEqual(60);
    expect(reached.sleep).toBeLessThan(95);
    expect(d.look.gain).toBeLessThan(0.05);
  });
  it('gets up through the chain on input and does not walk until standing', { timeout: 60_000 }, () => {
    const { d, brain } = fixtureDragon(5);
    brain.behaviour('sleep');
    for (let k = 0; k < Math.round(8 / DT); k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(brain.behaviours.posture.current).toBe('sleep');
    const seen: string[] = [];
    const start = d.kin.pos.clone();
    let movedBeforeStanding = 0;
    for (let k = 0; k < Math.round(6 / DT); k++) {
      d.update({ input: input(['KeyW']), cameraYaw: 0, cameraPos: CAM }, DT);
      const p = brain.behaviours.posture;
      if (seen[seen.length - 1] !== p.current) seen.push(p.current);
      if (!(p.settled && p.current === 'stand')) movedBeforeStanding = Math.max(movedBeforeStanding, d.kin.pos.distanceTo(start));
    }
    expect(seen).toEqual(['sleep', 'lie', 'stand']);
    expect(movedBeforeStanding).toBeLessThan(1e-9);
    expect(d.kin.pos.distanceTo(start)).toBeGreaterThan(1);                 // then he walks off
  });
  it('turns a half-done lie-down straight into getting up', () => {
    const { d, brain } = fixtureDragon(2);
    brain.behaviour('sit');
    for (let k = 0; k < 30; k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    const hop = brain.behaviours.posture.hop!;
    expect(hop.dir).toBe(1);
    const p = hop.p;
    d.update({ input: input(['KeyW']), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(brain.behaviours.posture.hop!.dir).toBe(-1);
    expect(brain.behaviours.posture.hop!.p).toBeLessThan(p);
  });
  it('forces a behaviour, getting into the posture it needs first (berk.behaviour)', () => {
    const { d, brain } = fixtureDragon(2);
    expect(brain.behaviour('scratch')).toBe('sit, then scratch');
    for (let k = 0; k < Math.round(2 / DT); k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(brain.behaviours.posture.current).toBe('sit');
    expect(brain.behaviours.gesture?.def.name).toBe('scratch');
    expect(brain.behaviour('nonsense')).toContain('sleep');
  });
  it('resets to standing with no gesture and a fresh idle clock (a lab script start)', () => {
    const { d, brain } = fixtureDragon(2);
    brain.behaviour('scratch');
    for (let k = 0; k < Math.round(3 / DT); k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    brain.reset();
    const b = brain.behaviours;
    expect([b.posture.current, b.posture.target, b.posture.hop, b.gesture, b.idle]).toEqual(['stand', 'stand', null, null, 0]);
    expect(d.layers.active().filter((l) => ['sit', 'lie', 'sleep', 'scratch'].includes(l.name))).toHaveLength(0);
  });
});

describe('gesture interrupts (synthetic sniff clip)', () => {
  it('plays the exit blend at once on input, then lets him walk', () => {
    const rig = toothlessFixtureRig();
    const s = new RigSkeleton(rig);
    const i = s.id('neck_02');
    const q = s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.4));
    const clips = new Map([['sniff', new THREE.AnimationClip('sniff', -1, [new THREE.QuaternionKeyframeTrack('neck_02.quaternion', [0], q.toArray())])]]);
    const meta: PosesMeta = { clips: { sniff: { mask: ['neck_'], blendIn: 0.5, blendOut: 0.4, interrupt: 'exit', duration: 0 } } };
    const { d, brain } = fixtureDragon(4, clips, meta);
    brain.behaviour('sniff');
    for (let k = 0; k < Math.round(0.8 / DT); k++) d.update({ input: input(), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(d.layers.weight('sniff')).toBe(1);
    const ws: number[] = [];
    for (let k = 0; k < Math.round(0.6 / DT); k++) {
      d.update({ input: input(['KeyW']), cameraYaw: 0, cameraPos: CAM }, DT);
      ws.push(d.layers.weight('sniff'));
    }
    expect(brain.behaviours.gesture).toBeNull();
    for (let k = 1; k < ws.length; k++) expect(ws[k]).toBeLessThanOrEqual(ws[k - 1] + 1e-12);
    expect(ws[Math.round(0.4 / DT)]).toBe(0);
    expect(d.kin.speed).toBeGreaterThan(0.5);
  });
});

describe.skipIf(!HAS_LIBRARY)('personality idles on the real rig and library', () => {
  it('idles for 90 s — sits, lies, sleeps — and passes every metric', { timeout: 300_000 }, async () => {
    const a = await loadToothlessMotion();
    const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig: a.rig, world, clips: a.clips, posesMeta: a.posesMeta, seed: 3 });
    d.spawn(0, 0, 0);
    const brain = new DragonBrain(d, { rig: a.rig, seed: 3 });
    const m = new MotionMetrics(world, 29);                       // < 30 s windows: boundedness belongs to the loop script
    const postures = new Set<string>();
    const gestures = new Set<string>();
    let asleep = 0;
    let lidsAsleep = 1;
    for (let k = 0; k < Math.round(90 / DT); k++) {
      d.update({ input: input(), cameraYaw: 0.3, cameraPos: CAM }, DT);
      m.sample(d);
      postures.add(brain.behaviours.posture.current);
      if (brain.behaviours.gesture) gestures.add(brain.behaviours.gesture.def.name);
      asleep = brain.behaviours.posture.settled && brain.behaviours.posture.current === 'sleep' ? asleep + DT : 0;
      if (asleep > 0.5) lidsAsleep = Math.min(lidsAsleep, brain.face.state.blinkL, brain.face.state.blinkR);
    }
    const r = m.report('idle-90s');
    expect(r.failures, JSON.stringify(r)).toEqual([]);
    expect([...postures].sort()).toEqual(['lie', 'sit', 'sleep', 'stand']);
    expect(asleep).toBeGreaterThan(1);                             // still asleep at the end, eyes shut throughout
    expect(lidsAsleep).toBeGreaterThan(0.99);
    expect(gestures.size).toBeGreaterThanOrEqual(3);
    expect(d.nanResets).toBe(0);
  });
});
