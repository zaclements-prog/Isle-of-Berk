import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import type { PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { rampWorld, wallWorld } from '../fixtures/worlds';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const W: InputState = { keys: new Set(['KeyW']), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 };
const X = new THREE.Vector3(1, 0, 0);

/** Synthetic scramble_up (a 0.9 s clip) and climb_reach (a pose) on the fixture rig's neck, with library-style metadata. */
function library() {
  const s = new RigSkeleton(toothlessFixtureRig());
  const i = s.id('neck_01');
  const q = (a: number) => s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, a)).toArray();
  const clips = new Map([
    ['scramble_up', new THREE.AnimationClip('scramble_up', 0.9, [new THREE.QuaternionKeyframeTrack('neck_01.quaternion', [0, 0.9], [...q(0), ...q(-0.5)])])],
    ['climb_reach', new THREE.AnimationClip('climb_reach', -1, [new THREE.QuaternionKeyframeTrack('neck_01.quaternion', [0], q(-0.3))])],
  ]);
  const posesMeta: PosesMeta = {
    clips: {
      scramble_up: { mask: ['neck_'], ownsLegs: [], duration: 0.9, blendIn: 0.1, blendOut: 0.2, interrupt: 'none' },
      climb_reach: { mask: ['neck_'], ownsLegs: [], duration: 0, blendIn: 0.4, blendOut: 0.4, interrupt: 'exit' },
    },
  };
  return { clips, posesMeta };
}

describe('scramble polish (the M5 hand-off)', () => {
  it('plays scramble_up through the scramble, flares the wings for balance, and clears both after', { timeout: 60_000 }, () => {
    const d = new DragonCharacter({ rig: toothlessFixtureRig(), world: wallWorld(2.3, 0), ...library(), seed: 1 });
    d.spawn(0, -6, 0);
    let up = 0;
    let flare = 0;
    let reach = 0;
    let scrambled = false;
    for (let k = 0; k < Math.round(3.5 / DT); k++) {
      d.update({ input: W, cameraYaw: 0, cameraPos: CAM }, DT);
      if (d.climb.mode !== 'scramble') continue;
      scrambled = true;
      up = Math.max(up, d.layers.weight('scramble_up'));
      flare = Math.max(flare, d.wings.target.flare);
      reach = Math.max(reach, d.climb.reach);
    }
    expect(scrambled).toBe(true);
    expect(up).toBeGreaterThan(0.99);
    expect(flare).toBeCloseTo(DEFAULT_TUNING.wings.climbFlare, 6);
    expect(reach).toBeGreaterThan(0);
    expect(d.layers.weight('scramble_up')).toBe(0);                  // finished: the layer is gone
    expect(d.nanResets).toBe(0);
  });
  it('eases climb_reach toward 0.6 in climb mode and flares the wings while climbing', { timeout: 60_000 }, () => {
    const d = new DragonCharacter({ rig: toothlessFixtureRig(), world: rampWorld(55, -2), ...library(), seed: 1 });
    d.spawn(0, -6, 0);
    let reach = 0;
    let flare = 0;
    for (let k = 0; k < Math.round(6 / DT); k++) {
      d.update({ input: W, cameraYaw: 0, cameraPos: CAM }, DT);
      if (d.climb.mode !== 'climb') continue;
      reach = Math.max(reach, d.climb.reach);
      flare = Math.max(flare, d.wings.target.flare);
      expect(d.layers.weight('climb_reach')).toBeCloseTo(d.climb.reach, 12);
    }
    expect(reach).toBeCloseTo(0.6, 6);
    expect(flare).toBeCloseTo(DEFAULT_TUNING.wings.climbFlare, 6);
    expect(d.nanResets).toBe(0);
  });
});
