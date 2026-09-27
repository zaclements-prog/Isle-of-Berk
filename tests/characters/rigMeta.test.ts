import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateRig } from '../../src/characters/dragon/rigMeta';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';

const raw = JSON.parse(readFileSync('public/assets/characters/toothless/toothless.rig.json', 'utf8'));

describe('validateRig', () => {
  it('accepts the exported Toothless rig', () => {
    const rig = validateRig(raw);
    expect(rig.bones).toHaveLength(101);
    expect(rig.limbs.front_L.bones[0]).toBe('front_scapula_L');
    expect(rig.jaw.openSign).toBe(-1);
  });
  it('rejects a rig whose limb references a missing bone', () => {
    const bad = structuredClone(raw);
    bad.limbs.hind_R.bones[1] = 'nope';
    expect(() => validateRig(bad)).toThrow(/hind_R.*nope/);
  });
  it('rejects a wrong version', () => {
    expect(() => validateRig({ ...raw, version: 2 })).toThrow(/version/);
  });
  it("stays assignable to the motion system's MotionRig (a structural subset; tsc checks the assignment)", () => {
    const motion: MotionRig = validateRig(raw);
    expect(motion.chains.spine[0]).toBe('pelvis');
  });
});
