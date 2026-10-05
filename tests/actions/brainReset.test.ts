import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { createToothlessBrain } from '../../src/characters/dragon/toothlessBrain';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const input = (pressed: string[] = []): InputState => ({
  keys: new Set(), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});

describe('DragonBrain.reset (a lab script start)', () => {
  function setup() {
    const rig = toothlessFixtureRig();
    const d = new DragonCharacter({ rig, world: CollisionWorld.fromObjects([box(200, 1, 200, 0, -0.5, 0)]), seed: 1 });
    d.spawn(0, 0, 0);
    const aim = new THREE.Vector3(0, 1.2, 30);
    const tb = createToothlessBrain(d, rig, { aimAt: (_d, out) => out.copy(aim) });
    const step = (pressed: string[] = []) => d.update({ input: input(pressed), cameraYaw: 0, cameraPos: CAM }, DT);
    for (let k = 0; k < 120; k++) step();
    return { d, tb, step };
  }
  it('drops a jump in flight: nothing scripted is left, and he can jump again at once', () => {
    const { d, tb, step } = setup();
    step(['Space']);
    for (let k = 0; k < 60 && tb.jump.phase !== 'air'; k++) step();
    for (let k = 0; k < 12; k++) step();                  // into the flight (takeoff hands over on the next step)
    expect(tb.jump.phase).toBe('air');
    expect(d.mods.scripted).toBe(true);
    tb.brain.reset();
    expect(tb.jump.phase).toBe('idle');
    expect(d.mods.scripted).toBe(false);
    expect(d.climb.suspended).toBe(false);
    expect(d.body.override.active).toBe(false);
    expect(d.body.override.snap).toBe(false);
    expect(d.planner.autoStep).toBe(true);
    for (const n of ['jump_crouch', 'jump_launch', 'jump_tuck', 'jump_land']) expect(d.layers.weight(n), n).toBe(0);
    d.spawn(4, 0, 0);
    for (let k = 0; k < 120; k++) step();
    step(['Space']);
    expect(tb.jump.phase).toBe('crouch');                 // no cooldown carried over
  });
  it('drops a plasma charge: no shot fires, and he can fire again at once', () => {
    const { tb, step } = setup();
    step(['KeyF']);
    expect(tb.plasma.phase).toBe('charge');
    for (let k = 0; k < 12; k++) step();
    tb.brain.reset();
    expect(tb.plasma.phase).toBe('idle');
    expect(tb.plasma.aggressive).toBe(false);
    for (let k = 0; k < 120; k++) step();
    expect(tb.plasma.fired).toBe(0);
    expect(tb.plasma.shots).toHaveLength(0);
    step(['KeyF']);
    expect(tb.plasma.phase).toBe('charge');
  });
});
