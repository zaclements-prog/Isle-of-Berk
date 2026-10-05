import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { JumpAction } from '../../src/characters/dragon/actions/jump';
import { DragonBrain } from '../../src/characters/dragon/behaviour/brain';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import type { PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { LEG_KEYS } from '../../src/characters/dragon/motion/rigTypes';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, dropWorld, floor } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const bigFloor = () => CollisionWorld.fromObjects([box(200, 1, 200, 0, -0.5, 0)]);
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});

interface Run { d: DragonCharacter; jump: JumpAction; m: MotionMetrics; apex: number; plants: number[]; flights: number[]; own: number }

function jumpRun(world: CollisionWorld, keysAt: (t: number) => string[], seconds: number, jumpAt: number, rig: MotionRig = toothlessFixtureRig(),
  clips?: Map<string, THREE.AnimationClip>, posesMeta?: PosesMeta, spawnZ = 0): Run {
  const d = new DragonCharacter({ rig, world, clips, posesMeta, seed: 1 });
  d.spawn(0, spawnZ, 0);
  const jump = new JumpAction(d.tuning.jump);
  new DragonBrain(d, { rig, seed: 1, actions: [jump] });
  const m = new MotionMetrics(world, seconds);
  const r: Run = { d, jump, m, apex: -Infinity, plants: [-1, -1, -1, -1], flights: [], own: 0 };
  let takeoffY = 0;
  let was = 'idle';
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = k * DT;
    const press = Math.abs(t - jumpAt) < DT / 2 ? ['Space'] : [];
    d.update({ input: input(keysAt(t), press), cameraYaw: 0, cameraPos: CAM }, DT);
    m.sample(d);
    if (jump.phase === 'air') {
      if (was !== 'air') {
        takeoffY = d.body.pose.pelvisPos.y;
        r.flights.push(jump.flight);
      }
      r.apex = Math.max(r.apex, d.body.pose.pelvisPos.y - takeoffY);
      r.own = Math.max(r.own, d.own[0]);
      d.planner.paws.forEach((p, i) => { if (p.justPlanted && r.plants[i] < 0) r.plants[i] = t; });
    }
    if (jump.phase === 'land') d.planner.paws.forEach((p, i) => { if (p.justPlanted && r.plants[i] < 0) r.plants[i] = t; });
    was = jump.phase;
  }
  return r;
}

describe('JumpAction (fixture rig)', () => {
  it('crouches, rises about 2 m, lands front paws first and passes every metric', { timeout: 60_000 }, () => {
    const r = jumpRun(bigFloor(), () => [], 4, 0.5);
    expect(r.flights).toHaveLength(1);
    expect(r.apex).toBeGreaterThan(1.9);
    expect(r.apex).toBeLessThan(2.15);
    const front = Math.max(r.plants[LEG_KEYS.indexOf('front_L')], r.plants[LEG_KEYS.indexOf('front_R')]);
    const hind = Math.min(r.plants[LEG_KEYS.indexOf('hind_L')], r.plants[LEG_KEYS.indexOf('hind_R')]);
    expect(front).toBeGreaterThan(0);
    expect(hind).toBeGreaterThan(front);
    expect(r.jump.phase).toBe('idle');
    expect(Math.abs(r.d.kin.pos.y)).toBeLessThan(0.02);
    const rep = r.m.report('jump-standing');
    expect(rep.failures, JSON.stringify(rep)).toEqual([]);
  });
  it('carries a trot into the leap and keeps trotting after it', { timeout: 60_000 }, () => {
    const r = jumpRun(bigFloor(), (t) => (t < 5 ? ['KeyW'] : []), 6, 2.5);
    const flight = r.flights[0];
    expect(r.d.kin.pos.z).toBeGreaterThan(3.2 * 2.3 + 3.2 * flight * 0.8);
    const rep = r.m.report('jump-trot');
    expect(rep.failures, JSON.stringify(rep)).toEqual([]);
  });
  it('stops short of a wall in its path', { timeout: 60_000 }, () => {
    const world = CollisionWorld.fromObjects([floor(), box(20, 4, 1, 0, 2, 5.5)]);
    const r = jumpRun(world, (t) => (t < 1.2 ? ['KeyW'] : []), 4, 1.2);
    expect(r.d.chestPos(new THREE.Vector3()).z).toBeLessThan(5);
    expect(r.d.nanResets).toBe(0);
  });
  it('lands on the lower level when it leaps off a ledge', { timeout: 60_000 }, () => {
    const r = jumpRun(dropWorld(2, 3), (t) => (t < 2 ? ['KeyW'] : []), 5, 0.45);
    expect(r.flights[0]).toBeGreaterThan(1.4);
    expect(r.d.kin.pos.y).toBeLessThan(-1.9);
    expect(r.d.nanResets).toBe(0);
  });
});

describe.skipIf(!HAS_LIBRARY)('JumpAction on the real rig with the library', () => {
  it('owns the legs in the air and passes every metric', { timeout: 120_000 }, async () => {
    const a = await loadToothlessMotion();
    const r = jumpRun(bigFloor(), (t) => (t < 4 ? ['KeyW'] : []), 6, 2, a.rig, a.clips, a.posesMeta);
    expect(r.own).toBeGreaterThan(0.99);
    expect(r.apex).toBeGreaterThan(1.9);
    const rep = r.m.report('jump-real');
    expect(rep.failures, JSON.stringify(rep)).toEqual([]);
  });
});
