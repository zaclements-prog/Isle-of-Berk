import { describe, it, expect } from 'vitest';
import { buildCourse } from '../../src/dev/lab/course';
import { M6_SCRIPTS, runM6Script } from '../../src/dev/lab/m6Scripts';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const world = CollisionWorld.fromObjects(buildCourse().surfaces);

describe('M6 lab scripts on the fixture rig (no pose library)', () => {
  it.each(M6_SCRIPTS.map((s) => s.name))('passes every metric: %s', { timeout: 300_000 }, (name) => {
    const r = runM6Script({ rig: toothlessFixtureRig(), world, script: M6_SCRIPTS.find((s) => s.name === name)! });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});

describe.skipIf(!HAS_LIBRARY)('M6 lab scripts on the exported rig with the pose library (spec §9 M6 exit)', () => {
  it.each(M6_SCRIPTS.map((s) => s.name))('passes every metric: %s', { timeout: 300_000 }, async (name) => {
    const a = await loadToothlessMotion();
    const r = runM6Script({ rig: a.rig, world, script: M6_SCRIPTS.find((s) => s.name === name)!, clips: a.clips, posesMeta: a.posesMeta });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});
