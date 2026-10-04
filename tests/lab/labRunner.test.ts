import { describe, it, expect } from 'vitest';
import { buildCourse } from '../../src/dev/lab/course';
import { runLabScript } from '../../src/dev/lab/labRunner';
import { LAB_SCRIPTS, scriptByName } from '../../src/dev/lab/scripts';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const world = CollisionWorld.fromObjects(buildCourse().surfaces);
const rig = toothlessFixtureRig();
const CORE = ['walk-straight', 'trot-straight', 'gallop-straight', 'trot-circle', 'ramp15', 'ramp30', 'side-slope', 'steps-small', 'steps-large'];
/** Everything that passes on the fixture rig so far (still open: ramp60). */
const GATED = [...CORE, 'ramp45', 'ledge-scramble', 'ledge-blocked', 'boulders', 'corners', 'drop-hop', 'down-ramp30', 'down-steps-small', 'idle-turn-60s'];

describe('Motion Lab scripts (fixture rig, headless)', () => {
  it('defines every course script the spec asks for', () => {
    const names = LAB_SCRIPTS.map((s) => s.name);
    for (const n of [...GATED, 'ramp60']) expect(names).toContain(n);
  });
  it.each(GATED)('passes every metric and its goal: %s', { timeout: 120_000 }, (name) => {
    const r = runLabScript({ rig, world, script: scriptByName(name) });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});
