import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import { PoseLayerStack, parsePosesMeta, sampleCurve, withFoldClip, type PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { LEG_KEYS, type MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { WingController } from '../../src/characters/dragon/motion/wings';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const X = new THREE.Vector3(1, 0, 0);
const same = (a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-6) => Math.abs(a.dot(b)) > 1 - eps;
const idle: InputState = { keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 };
const CAM = new THREE.Vector3(0, 3, -8);

/** A clip holding bind·Rx(angle) on the given bones (keys at t = 0 and `duration`, rotating by `spin` over it). */
function clipOf(name: string, s: RigSkeleton, bones: string[], angle: number, duration = 0, spin = 0): THREE.AnimationClip {
  const times = duration > 0 ? [0, duration] : [0];
  const tracks = bones.map((b) => {
    const i = s.id(b);
    const v = times.flatMap((t, k) => s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, angle + (k ? spin : 0))).toArray());
    return new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, v);
  });
  return new THREE.AnimationClip(name, duration || -1, tracks);
}

describe('poses.json v2 metadata', () => {
  it('parses leg ownership, root, wings, soles, loop, interrupt and face curves', () => {
    const m = parsePosesMeta({
      version: 2, clips: {
        sit: { mask: ['hind_'], ownsLegs: ['hind_L', 'hind_R'], root: { height: 0.38, pitch: 0.28 }, wings: { fold: 1, lift: 0.4, flare: 0 },
          soles: { hind_L: [0.34, 0.02, -0.41] }, interrupt: 'exit', face: { smile: [[0, 0.2], [1, 0.4]] } },
      },
    });
    expect(m.clips.sit.ownsLegs).toEqual(['hind_L', 'hind_R']);
    expect(m.clips.sit.root!.height).toBe(0.38);
  });
  it('rejects unknown legs, interrupt policies and malformed face curves', () => {
    expect(() => parsePosesMeta({ clips: { a: { mask: 'all', ownsLegs: ['tail'] } } })).toThrow(/ownsLegs/);
    expect(() => parsePosesMeta({ clips: { a: { mask: 'all', interrupt: 'sometimes' } } })).toThrow(/interrupt/);
    expect(() => parsePosesMeta({ clips: { a: { mask: 'all', face: { jaw: [[0]] } } } })).toThrow(/face\.jaw/);
  });
  it('samples face curves linearly and clamps outside the keys', () => {
    const c: Array<[number, number]> = [[0.5, 0], [1.5, 1]];
    expect(sampleCurve(c, 0)).toBe(0);
    expect(sampleCurve(c, 1)).toBeCloseTo(0.5, 12);
    expect(sampleCurve(c, 9)).toBe(1);
    expect(sampleCurve([], 1)).toBe(0);
  });
});

describe('PoseLayerStack (M6 additions)', () => {
  const rig = toothlessFixtureRig();
  const s = new RigSkeleton(rig);
  const meta: PosesMeta = {
    clips: {
      loopy: { mask: ['tail_'], loop: true },
      low: { mask: ['neck_'], ownsLegs: ['hind_L', 'hind_R'] },
      high: { mask: ['neck_'], ownsLegs: ['hind_L'] },
    },
  };
  const clips = new Map([
    ['loopy', clipOf('loopy', s, ['tail_01'], 0, 1, 1)],
    ['low', clipOf('low', s, ['neck_01'], 0.2)],
    ['high', clipOf('high', s, ['neck_01'], 0.5)],
  ]);
  it('wraps a looping clip\'s time', () => {
    const st = new PoseLayerStack(s, clips, meta);
    st.set('loopy', 1, 1.3);
    expect(st.active()[0].time).toBeCloseTo(0.3, 12);
    s.resetToBind();
    st.apply(s);
    const want = s.bindLocalQuat[s.id('tail_01')].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.3));
    expect(same(s.localQuat[s.id('tail_01')], want, 1e-5)).toBe(true);
  });
  it('applies by order, then by first use, and reports leg ownership', () => {
    const st = new PoseLayerStack(s, clips, meta);
    st.set('high', 0.7, 0, false, 1);
    st.set('low', 0.4, 0, false, 0);
    expect(st.active().map((l) => l.name)).toEqual(['low', 'high']);
    s.resetToBind();
    st.set('high', 1, 0, false, 1);
    st.set('low', 1, 0, false, 0);
    st.apply(s);
    const want = s.bindLocalQuat[s.id('neck_01')].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.5));
    expect(same(s.localQuat[s.id('neck_01')], want)).toBe(true);        // 'high' (order 1) lands last
    st.set('high', 0.7, 0, false, 1);
    st.set('low', 0.4, 0, false, 0);
    const own = st.legOwnership([9, 9, 9, 9]);
    expect(own[LEG_KEYS.indexOf('hind_L')]).toBeCloseTo(0.7, 12);
    expect(own[LEG_KEYS.indexOf('hind_R')]).toBeCloseTo(0.4, 12);
    expect(own[LEG_KEYS.indexOf('front_L')]).toBe(0);
  });
});

/** The fixture rig with fold samples (wing_humerus_* at 0.2 rad per sample about local X), merged as Plan 3 does. */
function foldedFixture() {
  const rig = structuredClone(toothlessFixtureRig()) as MotionRig;
  const names = ['bind', 'wings_fold_25', 'wings_half', 'wings_fold_75', 'wings_folded'];
  const s = new RigSkeleton(rig);
  const clips0 = new Map(names.map((n, k) => [n, clipOf(n, s, ['wing_humerus_L', 'wing_humerus_R', 'hipwing_rib1_L'], 0.2 * k)]));
  const meta0: PosesMeta = {
    wingFlare: { deg: 25, liftDeg: 8 },
    clips: {
      bind: { mask: 'all' }, ...Object.fromEntries(names.slice(1).map((n) => [n, { mask: ['wing_', 'hipwing_'] }])),
      perch: { mask: ['neck_'], wings: { fold: 0.5, lift: 0.3, flare: 0 } },
    },
  };
  clips0.set('perch', clipOf('perch', s, ['neck_01'], 0));
  const { clips, meta } = withFoldClip(clips0, meta0, names);
  const layers = new PoseLayerStack(s, clips, meta);
  return { rig, s, layers, meta };
}

/** One step's wing pass as DragonCharacter runs it: update (drives wingFold) → layers → flare/lift. */
function wingPass(w: WingController, layers: PoseLayerStack, s: RigSkeleton, dt: number): void {
  s.resetToBind();
  w.update(dt);
  layers.apply(s);
  w.apply(s);
}

describe('WingController', () => {
  it('drives the merged wingFold layer: the fold blends piecewise between neighbouring samples', () => {
    const { rig, s, layers, meta } = foldedFixture();
    const w = new WingController(rig, s, layers, meta, DEFAULT_TUNING.wings);
    expect(w.available).toBe(true);
    const i = s.id('wing_humerus_L');
    const at = (a: number) => s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, a));
    w.demand('test', { fold: 0.5 });
    w.update(0);
    w.settle();
    wingPass(w, layers, s, 0);
    expect(layers.active().find((l) => l.name === 'wingFold')!.time).toBeCloseTo(0.5, 12);
    expect(same(s.localQuat[i], at(0.4))).toBe(true);
    w.demand('test', { fold: 0.625 });           // halfway between the 0.4 rad (wings_half) and 0.6 rad samples
    w.update(0);
    w.settle();
    wingPass(w, layers, s, 0);
    expect(same(s.localQuat[i], at(0.5))).toBe(true);
  });
  it('flares and lifts the humerus after the layers, mirrored per side', () => {
    const { rig, s, layers, meta } = foldedFixture();
    const w = new WingController(rig, s, layers, meta, DEFAULT_TUNING.wings);
    w.demand('test', { fold: 1, flare: 1 });
    w.update(0);
    w.settle();
    wingPass(w, layers, s, 0);
    const flare = THREE.MathUtils.degToRad(25);
    const lift = THREE.MathUtils.degToRad(8);
    for (const [name, side] of [['wing_humerus_L', 1], ['wing_humerus_R', -1]] as const) {
      const i = s.id(name);
      const want = s.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.8))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -side * flare))
        .multiply(new THREE.Quaternion().setFromAxisAngle(X, lift));
      expect(same(s.localQuat[i], want)).toBe(true);
    }
  });
  it('follows layer wing metadata and named demands through springs', () => {
    const { rig, s, layers, meta } = foldedFixture();
    const w = new WingController(rig, s, layers, meta, DEFAULT_TUNING.wings);
    layers.set('perch', 0.5);
    w.demand('climb', { flare: 0.8 });
    for (let k = 0; k < 240; k++) w.update(DT);
    expect(w.target.fold).toBeCloseTo(0.75, 12);
    expect(w.target.lift).toBeCloseTo(0.15, 12);
    expect(w.target.flare).toBeCloseTo(0.8, 12);
    expect(w.state.fold).toBeCloseTo(0.75, 3);
    expect(layers.active().find((l) => l.name === 'wingFold')!.time).toBeCloseTo(w.state.fold, 12);
    w.demand('climb', null);
    layers.set('perch', 0);
    for (let k = 0; k < 240; k++) w.update(DT);
    expect(w.state.flare).toBeCloseTo(0, 3);
    expect(w.state.fold).toBeCloseTo(1, 3);
  });
  it('without fold clips (fixture rig) drives no layer and leaves the wings at bind', () => {
    const rig = toothlessFixtureRig();
    const s = new RigSkeleton(rig);
    const layers = new PoseLayerStack(s, new Map(), { clips: {} });
    const w = new WingController(rig, s, layers, { clips: {} }, DEFAULT_TUNING.wings);
    expect(w.available).toBe(false);
    wingPass(w, layers, s, DT);
    expect(layers.active()).toHaveLength(0);
    expect(s.angleFromBind(s.id('wing_humerus_L'))).toBe(0);
  });
});

describe('DragonCharacter with an owning pose layer (fixture rig)', () => {
  it('blends owned legs from the IK to the pose and places the body at the pose root', () => {
    const rig = toothlessFixtureRig();
    const s0 = new RigSkeleton(rig);
    const hind = ['hind_femur_L', 'hind_tibia_L', 'hind_femur_R', 'hind_tibia_R'];
    const clips = new Map([['crouch', clipOf('crouch', s0, hind, 0.3)]]);
    const posesMeta: PosesMeta = { clips: { crouch: { mask: ['hind_'], ownsLegs: ['hind_L', 'hind_R'], root: { height: 1.12, pitch: 0.05 } } } };
    const world = CollisionWorld.fromObjects([box(60, 1, 60, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig, world, clips, posesMeta, seed: 1 });
    d.spawn(0, 0, 0);
    d.hooks.beforeMove.push((dd) => dd.layers.set('crouch', 1));
    for (let k = 0; k < 360; k++) d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
    expect(d.own[LEG_KEYS.indexOf('hind_L')]).toBe(1);
    expect(d.own[LEG_KEYS.indexOf('front_L')]).toBe(0);
    expect(d.planner.paws[LEG_KEYS.indexOf('hind_L')].posed).toBe(true);
    expect(d.planner.paws[LEG_KEYS.indexOf('front_L')].posed).toBe(false);
    expect(d.body.posture.weight).toBe(1);
    expect(d.body.pose.height).toBeCloseTo(1.12, 2);
    expect(d.body.pose.pitch).toBeCloseTo(0.05, 2);
    const i = d.skeleton.id('hind_tibia_L');
    const want = d.skeleton.bindLocalQuat[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.3));
    expect(same(d.skeleton.localQuat[i], want)).toBe(true);
    expect(d.nanResets).toBe(0);
  });
});

describe('the ground guard for posed legs (fixture rig)', () => {
  it('re-solves a posed leg that would sink onto the ground', () => {
    const rig = toothlessFixtureRig();
    const s0 = new RigSkeleton(rig);
    const clips = new Map([['slump', clipOf('slump', s0, ['neck_01'], 0)]]);
    // the body drops 25 cm while the hind legs stay straight (posed at bind): their paws would go 25 cm under
    const posesMeta: PosesMeta = { clips: { slump: { mask: ['neck_'], ownsLegs: ['hind_L', 'hind_R'], root: { height: 0.77, pitch: 0 } } } };
    const world = CollisionWorld.fromObjects([box(60, 1, 60, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig, world, clips, posesMeta, seed: 1 });
    d.spawn(0, 0, 0);
    d.hooks.beforeMove.push((dd) => dd.layers.set('slump', 1));
    const sole = new THREE.Vector3();
    let lowest = Infinity;
    for (let k = 0; k < 240; k++) {
      d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
      for (const key of ['hind_L', 'hind_R'] as const) lowest = Math.min(lowest, d.legs.soleWorld(LEG_KEYS.indexOf(key), d.skeleton, sole).y);
    }
    expect(d.body.pose.height).toBeCloseTo(0.77, 2);
    expect(lowest).toBeGreaterThan(-0.005);
    expect(d.nanResets).toBe(0);
  });
});

describe.skipIf(!HAS_LIBRARY)('the exported pose library (Plan 4 Task 1)', () => {
  const LIBRARY = ['sit', 'lie', 'sleep', 'stretch', 'sniff', 'stalk', 'jump_crouch', 'jump_launch', 'jump_tuck', 'jump_land',
    'plasma_rear', 'climb_reach', 'scramble_hook', 'scratch', 'shake', 'yawn', 'scramble_up'];
  it('ships every library clip with its metadata', async () => {
    const a = await loadToothlessMotion();
    for (const n of LIBRARY) {
      expect(a.clips.has(n), n).toBe(true);
      expect(a.posesMeta.clips[n], n).toBeTruthy();
    }
    expect(a.posesMeta.clips.scratch.loop).toBe(true);
    expect(a.posesMeta.wingFlare).toEqual({ deg: 25, liftDeg: 8 });
    expect(a.posesMeta.clips.sleep.face!.blink).toEqual([[0, 1]]);     // a posture layer holds time 0
    expect(a.clips.get('yawn')!.duration).toBeCloseTo(2.4, 3);
  });
  it('sits on the real rig: hind legs posed, body at the sit root, every metric passes', { timeout: 60_000 }, async () => {
    const a = await loadToothlessMotion();
    const world = CollisionWorld.fromObjects([box(60, 1, 60, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig: a.rig, world, clips: a.clips, posesMeta: a.posesMeta, seed: 1 });
    d.spawn(0, 0, 0);
    let w = 0;
    d.hooks.beforeMove.push((dd, dt) => {
      w = Math.min(1, w + dt / a.posesMeta.clips.sit.blendIn!);
      dd.layers.set('sit', w);
    });
    const m = new MotionMetrics(world, 4);
    for (let k = 0; k < 480; k++) {
      d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
      m.sample(d);
    }
    const r = m.report('sit');
    expect(r.failures, JSON.stringify(r)).toEqual([]);
    expect(d.body.pose.height).toBeCloseTo(a.posesMeta.clips.sit.root!.height, 1);
    expect(d.planner.paws[LEG_KEYS.indexOf('hind_L')].posed).toBe(true);
    expect(d.wings.state.lift).toBeCloseTo(a.posesMeta.clips.sit.wings!.lift, 2);
  });
});
