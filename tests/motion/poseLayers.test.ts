import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PoseLayerStack, parsePosesMeta, maskBones, withFoldClip } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const same = (a: THREE.Quaternion, b: THREE.Quaternion) => Math.abs(a.dot(b)) > 1 - 1e-9;
const QA = q(0.4, 0, 0);
const QB = q(0.8, 0.2, 0);
const clip = new THREE.AnimationClip('fold', 1, [
  new THREE.QuaternionKeyframeTrack('wing_humerus_L.quaternion', [0, 1], [...QA.toArray(), ...QB.toArray()]),
  new THREE.QuaternionKeyframeTrack('neck_02.quaternion', [0, 1], [...QA.toArray(), ...QA.toArray()]),
  new THREE.VectorKeyframeTrack('wing_humerus_L.position', [0, 1], [0, 0, 0, 1, 1, 1]),
]);
const meta = parsePosesMeta({ clips: { fold: { mask: ['wing_'] } } });

function setup() {
  const s = new RigSkeleton(toothlessFixtureRig());
  s.resetToBind();
  return { s, stack: new PoseLayerStack(s, new Map([['fold', clip]]), meta) };
}

describe('pose layers', () => {
  it('matches masks by explicit prefixes', () => {
    const { s } = setup();
    const names = maskBones(s, ['hipwing_']).map((i) => s.names[i]);
    expect(names.length).toBe(10);
    expect(names.every((n) => n.startsWith('hipwing_'))).toBe(true);
    expect(maskBones(s, 'all').length).toBe(101);
  });
  it('overrides only masked bones with the clip pose', () => {
    const { s, stack } = setup();
    stack.set('fold', 1);
    stack.apply(s);
    expect(same(s.localQuat[s.id('wing_humerus_L')], QA)).toBe(true);
    expect(same(s.localQuat[s.id('neck_02')], s.bindLocalQuat[s.id('neck_02')])).toBe(true);
  });
  it('blends by weight and samples by time', () => {
    const { s, stack } = setup();
    const i = s.id('wing_humerus_L');
    stack.set('fold', 0.5);
    stack.apply(s);
    expect(same(s.localQuat[i], s.bindLocalQuat[i].clone().slerp(QA, 0.5))).toBe(true);
    s.resetToBind();
    stack.set('fold', 1, 0.5);
    stack.apply(s);
    expect(same(s.localQuat[i], QA.clone().slerp(QB, 0.5))).toBe(true);
  });
  it('adds additive layers on top of the current pose', () => {
    const { s, stack } = setup();
    const i = s.id('wing_humerus_L');
    const base = q(0, 0.3, 0);
    s.localQuat[i].copy(base);
    stack.set('fold', 1, 0, true);
    stack.apply(s);
    const delta = s.bindLocalQuat[i].clone().invert().multiply(QA);
    expect(same(s.localQuat[i], base.clone().multiply(delta))).toBe(true);
  });
  it('removes a layer at weight 0 and rejects unknown clips and bad metadata', () => {
    const { s, stack } = setup();
    stack.set('fold', 1);
    stack.set('fold', 0);
    expect(stack.weight('fold')).toBe(0);
    stack.apply(s);
    expect(same(s.localQuat[s.id('wing_humerus_L')], s.bindLocalQuat[s.id('wing_humerus_L')])).toBe(true);
    expect(() => stack.set('nope', 1)).toThrow(/nope/);
    expect(() => parsePosesMeta({ clips: { x: { mask: 3 } } })).toThrow(/mask/);
    expect(() => parsePosesMeta({})).toThrow(/clips/);
  });
});

// Ruling 3: Plan 2 exports the wing fold as ordered single-frame samples (rig.json wings.<side>.foldClips), not one
// clip, because a single slerp across the ~177° the doubled ribs sweep between half-open and folded can take the
// wrong shortest path. withFoldClip merges the samples into one clip keyed so sampling only ever slerps neighbours.
describe('withFoldClip', () => {
  const FOLD_BONE = 'wing_humerus_L';
  const FOLD_NAMES: readonly string[] = ['bind', 'wings_fold_25', 'wings_half', 'wings_fold_75', 'wings_folded'];
  const FOLD_ANGLES_DEG = [0, 45, 90, 135, 180 - 0.5];
  const FOLD_AXIS = new THREE.Vector3(1, 0, 0);
  const foldQuat = (deg: number) => new THREE.Quaternion().setFromAxisAngle(FOLD_AXIS, THREE.MathUtils.degToRad(deg));

  function foldFixture() {
    const clips = new Map<string, THREE.AnimationClip>();
    const clipsMeta: Record<string, { mask: string[] }> = {};
    FOLD_NAMES.forEach((clipName, i) => {
      clips.set(
        clipName,
        new THREE.AnimationClip(clipName, 0, [
          new THREE.QuaternionKeyframeTrack(`${FOLD_BONE}.quaternion`, [0], foldQuat(FOLD_ANGLES_DEG[i]).toArray()),
        ]),
      );
      clipsMeta[clipName] = { mask: ['wing_'] };
    });
    return { clips, meta: parsePosesMeta({ clips: clipsMeta }) };
  }

  function foldStack() {
    const { clips, meta } = foldFixture();
    const merged = withFoldClip(clips, meta, FOLD_NAMES);
    const s = new RigSkeleton(toothlessFixtureRig());
    s.resetToBind();
    return { s, i: s.id(FOLD_BONE), stack: new PoseLayerStack(s, merged.clips, merged.meta) };
  }

  it('slerps only between neighbouring samples, at the local fraction within that pair', () => {
    const { s, i, stack } = foldStack();
    stack.set('wingFold', 1, 0.6); // between wings_half (t=0.5, 90°) and wings_fold_75 (t=0.75, 135°), local 0.4
    stack.apply(s);
    const want = foldQuat(90).slerp(foldQuat(135), 0.4);
    expect(same(s.localQuat[i], want)).toBe(true);
  });

  it('samples the first and last pose exactly at f = 0 and f = 1', () => {
    const { s, i, stack } = foldStack();
    stack.set('wingFold', 1, 1);
    stack.apply(s);
    expect(same(s.localQuat[i], foldQuat(FOLD_ANGLES_DEG[4]))).toBe(true);
    s.resetToBind();
    stack.set('wingFold', 1, 0);
    stack.apply(s);
    expect(same(s.localQuat[i], foldQuat(FOLD_ANGLES_DEG[0]))).toBe(true);
  });

  it('never flips to the long way across the near-180° total range', () => {
    const { s, i, stack } = foldStack();
    stack.set('wingFold', 1, 0.9); // between wings_fold_75 (135°) and wings_folded (179.5°), local 0.6
    stack.apply(s);
    const angleDeg = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(s.localQuat[i].w))));
    expect(angleDeg).toBeGreaterThan(135);
    expect(angleDeg).toBeLessThan(180);
  });

  it('throws when a named fold clip is missing', () => {
    const { clips, meta } = foldFixture();
    expect(() => withFoldClip(clips, meta, ['bind', 'wings_half', 'nope', 'wings_folded'])).toThrow(/nope/);
  });
});
