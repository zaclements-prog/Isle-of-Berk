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

  /** 30 s of samples of a standing dragon with one wing bone turned turn(t) rad about its X axis on top of its pose. */
  function bounded(turn: (t: number) => number) {
    const { world, d } = setup();
    const m = new MotionMetrics(world, 30);
    d.update({ input: idle, cameraYaw: 0, cameraPos: new THREE.Vector3(0, 3, -8) }, DT);
    const s = d.skeleton;
    const b = s.id(toothlessFixtureRig().wings.L.ribs[0][0]);
    const posed = s.localQuat[b].clone();
    const q = new THREE.Quaternion();
    for (let k = 0; k < 3600; k++) {
      s.localQuat[b].copy(posed).multiply(q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), turn(k * DT)));
      m.sample(d);
    }
    return m.report('bounded');
  }
  it('measures boundedness from his pose at the start, not the bind (folded wing ribs rest ~170° from bind)', () => {
    const r = bounded(() => (170 * Math.PI) / 180);
    expect(r.failures).toEqual([]);
  });
  it('flags a bone that keeps turning (the spin-bug check)', () => {
    const r = bounded((t) => 0.08 * t); // 0.8 rad by 10 s, 2.4 by 30 s: under the cap, but it grew
    expect(r.failures.join(' ')).toMatch(/rotation grew 0\.80 → 2\.40/);
  });
  it('flags a bone that spins from the start', () => {
    const r = bounded((t) => 2 * t); // sweeps round in both windows: no growth, but past the cap
    expect(r.failures.join(' ')).toMatch(/rotation grew 3\.1\d → 3\.1\d/);
  });
});
