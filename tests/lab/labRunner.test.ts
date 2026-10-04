import { describe, it, expect } from 'vitest';
import { buildCourse } from '../../src/dev/lab/course';
import { runLabScript } from '../../src/dev/lab/labRunner';
import { LAB_SCRIPTS, scriptByName } from '../../src/dev/lab/scripts';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const world = CollisionWorld.fromObjects(buildCourse().surfaces);
const rig = toothlessFixtureRig();
const CORE = ['walk-straight', 'trot-straight', 'gallop-straight', 'trot-circle', 'ramp15', 'ramp30', 'side-slope', 'steps-small', 'steps-large'];

describe('Motion Lab scripts (fixture rig, headless)', () => {
  it('defines every course script the spec asks for', () => {
    const names = LAB_SCRIPTS.map((s) => s.name);
    for (const n of [...CORE, 'ramp45', 'ramp60', 'ledge-scramble', 'ledge-blocked', 'boulders', 'corners', 'idle-turn-60s']) expect(names).toContain(n);
  });
  it.each(CORE)('passes every metric: %s', { timeout: 120_000 }, (name) => {
    const r = runLabScript({ rig, world, script: scriptByName(name) });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});
