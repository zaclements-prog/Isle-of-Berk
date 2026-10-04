import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';

const DT = 1 / 120;
const idle: InputState = { keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 };
function setup() {
  const world = CollisionWorld.fromObjects([box(100, 1, 100, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world });
  d.spawn(0, 0, 0);
  return { world, d, m: new MotionMetrics(world, 2) };
}

describe('MotionMetrics', () => {
  it('passes a dragon standing still', () => {
    const { d, m } = setup();
    for (let k = 0; k < 240; k++) {
      d.update({ input: idle, cameraYaw: 0, cameraPos: new THREE.Vector3(0, 3, -8) }, DT);
      m.sample(d);
    }
    const r = m.report('stand');
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.maxSlip).toBeLessThan(1e-3);
  });
  it('detects a planted paw that slides', () => {
    const { d, m } = setup();
    for (let k = 0; k < 240; k++) {
      if (k === 100) d.planner.paws[0].pos.x += 0.05; // drag a locked contact → the pinned sole slides with it
      d.update({ input: idle, cameraYaw: 0, cameraPos: new THREE.Vector3(0, 3, -8) }, DT);
      m.sample(d);
    }
    const r = m.report('slide');
    expect(r.maxSlip).toBeGreaterThan(0.04);
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/slip/);
  });
});
