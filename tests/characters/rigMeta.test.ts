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
  it('carries the blink map (three listed morphs per eye) and a closing rest rotation for the jaw', () => {
    const rig = validateRig(raw);
    expect(rig.blink.L).toEqual(['blink_L_a', 'blink_L_b', 'blink_L']);
    expect(rig.blink.R).toEqual(['blink_R_a', 'blink_R_b', 'blink_R']);
    expect(Math.sign(rig.jaw.restCloseRad)).toBe(-rig.jaw.openSign);   // closing turns against the opening
    expect(Math.abs(rig.jaw.restCloseRad)).toBeLessThan(rig.jaw.maxOpenRad);
  });
  it('rejects a blink key that is not a listed morph, and a missing jaw rest', () => {
    const bad = structuredClone(raw);
    bad.blink.R[1] = 'blink_R_x';
    expect(() => validateRig(bad)).toThrow(/blink R.*blink_R_x/);
    const noRest = structuredClone(raw);
    delete noRest.jaw.restCloseRad;
    expect(() => validateRig(noRest)).toThrow(/restCloseRad/);
  });
  it("stays assignable to the motion system's MotionRig (a structural subset; tsc checks the assignment)", () => {
    const motion: MotionRig = validateRig(raw);
    expect(motion.chains.spine[0]).toBe('pelvis');
  });
});
