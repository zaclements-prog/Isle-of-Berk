import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { buildCourse } from '../../src/dev/lab/course';
import { runLabScript } from '../../src/dev/lab/labRunner';
import { LAB_SCRIPTS } from '../../src/dev/lab/scripts';
import { CollisionWorld } from '../../src/world/collision';
import { mergeTuning, DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';

const RIG = 'public/assets/characters/toothless/toothless.rig.json';
const TUNING = 'public/assets/characters/toothless/motion-tuning.json';

describe.skipIf(!existsSync(RIG))('Motion Lab course on the exported Toothless rig', () => {
  const rig = JSON.parse(readFileSync(RIG, 'utf8')) as MotionRig;
  const tuning = mergeTuning(DEFAULT_TUNING, existsSync(TUNING) ? JSON.parse(readFileSync(TUNING, 'utf8')) : undefined);
  const world = CollisionWorld.fromObjects(buildCourse().surfaces);
  it.each(LAB_SCRIPTS.map((s) => s.name))('passes every metric: %s', { timeout: 300_000 }, (name) => {
    const r = runLabScript({ rig, world, script: LAB_SCRIPTS.find((s) => s.name === name)!, tuning });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});
