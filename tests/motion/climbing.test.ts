import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, dropWorld, floor, rampWorld, wallWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const input = (keys: string[]): InputState => ({
  keys: new Set(keys), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});
function run(world: CollisionWorld, keys: string[], seconds: number, onStep?: (d: DragonCharacter) => void): DragonCharacter {
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world });
  d.spawn(0, -6, 0);
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    d.update({ input: input(keys), cameraYaw: 0, cameraPos: CAM }, DT);
    onStep?.(d);
  }
  return d;
}

describe('climbing', () => {
  it('walks up a 30° ramp in ordinary locomotion, body pitched with the slope', { timeout: 60_000 }, () => {
    let maxPitch = 0;
    const modes = new Set<string>();
    const d = run(rampWorld(30, -2), ['KeyW'], 4.5, (x) => {
      modes.add(x.climb.mode);
      maxPitch = Math.max(maxPitch, x.body.pose.pitch);
    });
    expect(modes.has('climb')).toBe(false);
    expect(THREE.MathUtils.radToDeg(maxPitch)).toBeGreaterThan(20);
    expect(d.kin.pos.y).toBeGreaterThan(3);
    expect(d.nanResets).toBe(0);
  });
  it('switches to climb mode on a 55° slope and caps the speed', { timeout: 60_000 }, () => {
    let climbing = 0;
    let maxClimbSpeed = 0;
    const d = run(rampWorld(55, -2), ['KeyW'], 6, (x) => {
      if (x.climb.mode !== 'climb') return;
      climbing++;
      if (climbing > 30) maxClimbSpeed = Math.max(maxClimbSpeed, x.kin.speed); // after braking to the cap
    });
    expect(climbing).toBeGreaterThan(60);
    expect(maxClimbSpeed).toBeLessThanOrEqual(1.8 + 1e-6);
    expect(d.nanResets).toBe(0);
  });
  it('scrambles up a 2.3 m ledge', { timeout: 60_000 }, () => {
    const modes = new Set<string>();
    const d = run(wallWorld(2.3, 0), ['KeyW'], 3.5, (x) => modes.add(x.climb.mode));
    expect(modes.has('scramble')).toBe(true);
    expect(d.kin.pos.y).toBeGreaterThan(2.2);
    expect(d.kin.pos.z).toBeGreaterThan(0);
    expect(d.nanResets).toBe(0);
  });
  it('is blocked by a 3 m wall and never passes through it', { timeout: 60_000 }, () => {
    let maxChestZ = -Infinity;
    const chest = new THREE.Vector3();
    const wide = CollisionWorld.fromObjects([floor(), box(40, 3, 1, 0, 1.5, 0)]);
    const d = run(wide, ['KeyW'], 5, (x) => {
      maxChestZ = Math.max(maxChestZ, x.chestPos(chest).z);
    });
    expect(d.climb.mode).toBe('blocked');
    expect(maxChestZ).toBeLessThan(-0.5);
    expect(d.nanResets).toBe(0);
  });
  it('hops down a 2 m drop and lands on the lower level', { timeout: 60_000 }, () => {
    const modes = new Set<string>();
    const d = run(dropWorld(2, 0), ['KeyW'], 5, (x) => modes.add(x.climb.mode));
    expect(modes.has('hop')).toBe(true);
    expect(d.kin.pos.y).toBeLessThan(-1.8);
    expect(d.climb.mode).not.toBe('hop');
    expect(d.nanResets).toBe(0);
  });
});
