import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { sampleFlight } from '../../src/characters/dragon/actions/flight';
import { ClipPose, PoseLayerStack, parsePosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import { RigSkeleton } from '../../src/characters/dragon/motion/skeleton';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { HAS_LIBRARY } from '../fixtures/toothlessAsset';
import { PROBE_BONES, SEQUENCES, runSequence, type ProbeResult, type Transition } from '../fixtures/transitionProbe';

/**
 * Transition continuity (the chain run → jump → takeoff → flight → landing → run-out): no state change may step the
 * pose. The probe (tests/fixtures/transitionProbe.ts) measures every key bone's rotation second difference (deg per
 * step at 120 Hz: a one-step snap of θ reads θ) and the pelvis height / pitch second differences around each change.
 * Bounds sit a little above what the chain does now and far below the pops it had (in brackets).
 */

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const angle = (a: THREE.Quaternion, b: THREE.Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
/** Bones whose pops the transition bounds cover: the tail tip is left to its ground avoidance (a contact, see below). */
const BODY = PROBE_BONES.map(([n]) => n).filter((n) => n !== 'tailTip');

function peakOf(tr: Transition): number {
  return Math.max(...PROBE_BONES.map(([n], i) => (BODY.includes(n) ? tr.bones[i] : 0)));
}

function find(r: ProbeResult, from: string, to: string): Transition[] {
  const out = r.transitions.filter((t) => t.from === from && t.to === to);
  expect(out.length, `${r.name}: ${from}→${to} in ${r.transitions.map((t) => `${t.from}→${t.to}`).join(', ')}`).toBeGreaterThan(0);
  return out;
}

const seq = (name: string) => SEQUENCES.find((s) => s.name === name)!;

describe('flight cross-fades (PoseLayerStack.blendWeight)', () => {
  const A = q(0.4, 0, 0);
  const B = q(1.6, 0.3, 0);
  const track = (v: THREE.Quaternion) => new THREE.QuaternionKeyframeTrack('wing_humerus_L.quaternion', [0], v.toArray());
  const clips = new Map([['fa', new THREE.AnimationClip('fa', 0, [track(A)])], ['fb', new THREE.AnimationClip('fb', 0, [track(B)])]]);
  const flight = { kind: 'loop', height: [0], pitch: [0] };
  const meta = parsePosesMeta({ clips: { fa: { mask: ['wing_'], flight }, fb: { mask: ['wing_'], flight } } });

  it('blends two flight clips as shares of one blend: nothing of the pose under them leaks back mid-fade', () => {
    const s = new RigSkeleton(toothlessFixtureRig());
    const stack = new PoseLayerStack(s, clips, meta);
    const i = s.id('wing_humerus_L');
    let prev: THREE.Quaternion | null = null;
    for (let k = 0; k <= 20; k++) {
      const u = k / 20;
      s.resetToBind();
      stack.set('fa', 1 - u, 0, false, 3);
      stack.set('fb', u, 0, false, 3);
      stack.apply(s);
      // at every share the pose is the A→B blend: the bind pose under the layers never shows through
      if (u > 0 && u < 1) expect(angle(s.localQuat[i], A.clone().slerp(B, u))).toBeLessThan(1e-6);
      // and equal steps of the share make equal steps of the pose (no step where a layer comes or goes)
      if (prev) expect(angle(s.localQuat[i], prev)).toBeLessThan(angle(A, B) / 20 + 1e-6);
      prev = s.localQuat[i].clone();
    }
  });

  it('still fades a single flight clip in from the pose under it by its weight', () => {
    const s = new RigSkeleton(toothlessFixtureRig());
    const stack = new PoseLayerStack(s, clips, meta);
    const i = s.id('wing_humerus_L');
    stack.set('fa', 0.3, 0, false, 3);
    stack.apply(s);
    expect(angle(s.localQuat[i], s.bindLocalQuat[i].clone().slerp(A, 0.3))).toBeLessThan(1e-6);
  });
});

describe('clip sampling between keys', () => {
  it('splines a 30 fps clip: the keys exactly, no rate change at each key', () => {
    const s = new RigSkeleton(toothlessFixtureRig());
    // a wing beat keyed at 30 fps: sin-shaped angle about X
    const n = 31;
    const times = Array.from({ length: n }, (_, k) => k / 30);
    const values = times.flatMap((t) => q(0.8 * Math.sin(2 * Math.PI * t), 0, 0).toArray());
    const clip = new THREE.AnimationClip('beat', 1, [new THREE.QuaternionKeyframeTrack('wing_humerus_L.quaternion', times, values)]);
    const pose = new ClipPose(clip, s, ['wing_']);
    const out = [new THREE.Quaternion()];
    pose.sample(10 / 30, out);
    expect(angle(out[0], q(0.8 * Math.sin((2 * Math.PI * 10) / 30), 0, 0))).toBeLessThan(1e-6);
    // second difference at 120 Hz (deg): slerp key to key kinks every 4th step; the spline stays near the true curve's
    let worst = 0;
    const qs = [0, 1, 2].map(() => new THREE.Quaternion());
    for (let k = 8; k < 100; k++) {
      for (let j = 0; j < 3; j++) {
        pose.sample((k + j) / 120, out);
        qs[j].copy(out[0]);
      }
      const a0 = 2 * Math.atan2(qs[0].x, qs[0].w);
      const a1 = 2 * Math.atan2(qs[1].x, qs[1].w);
      const a2 = 2 * Math.atan2(qs[2].x, qs[2].w);
      worst = Math.max(worst, Math.abs(a2 - 2 * a1 + a0));
    }
    const exact = 0.8 * (2 * Math.PI / 120) ** 2;                  // the true curve's largest second difference
    expect(worst).toBeLessThan(1.5 * exact);
  });

  it('splines the flight curves too, keeping straight runs straight and the keys exact', () => {
    expect(sampleFlight([0, 3, 6, 9], 1 / 60)).toBeCloseTo(1.5);
    expect(sampleFlight([0, 3, 6, 9], 2 / 30)).toBeCloseTo(6);
    // a corner in the keys turns over the neighbouring span instead of in one step
    const c = [0, 0, 0, 1, 2, 3];
    const v = (t: number) => (sampleFlight(c, t + 1 / 120) - sampleFlight(c, t)) * 120;
    expect(v(2 / 30 - 1 / 120)).toBeGreaterThan(0);                 // already moving off just before the corner key
    expect(v(2 / 30 + 1 / 240)).toBeLessThan(30);                   // and not yet at full speed just after it
  });
});

describe.skipIf(!HAS_LIBRARY)('transition chain (Toothless library, game tuning)', () => {
  it('idle → walk → trot → gallop → stop: every gait change is smooth', { timeout: 60_000 }, async () => {
    const r = await runSequence(seq('idle-walk-run-stop'));
    expect(r.nanResets).toBe(0);
    for (const tr of r.transitions) {
      expect(peakOf(tr), `${tr.from}→${tr.to}`).toBeLessThan(2);
      expect(tr.dy, `${tr.from}→${tr.to}`).toBeLessThan(1.5);
    }
  });

  it('trot → jump → land → trot: the launch leaves the crouch without a snap, touchdown absorbs', { timeout: 60_000 }, async () => {
    const r = await runSequence(seq('trot-jump-land-trot'));
    const [launch] = find(r, 'jump-crouch', 'jump-air');
    expect(launch.dy).toBeLessThan(3);                              // (19 cm: the pelvis snapped onto the arc)
    expect(peakOf(launch)).toBeLessThan(2);
    const [land] = find(r, 'jump-air', 'jump-land');
    expect(land.dy).toBeLessThan(3);                                // (3.9 cm: held at the ground a step, then the absorb)
    expect(peakOf(land)).toBeLessThan(2);
    expect(r.peakP).toBeLessThan(0.5);
  });

  it('a high fall absorbs deeper, with no larger pop than the impact itself', { timeout: 60_000 }, async () => {
    const r = await runSequence(seq('ledge-jump-high-fall'));
    const [land] = find(r, 'jump-air', 'jump-land');
    expect(land.dy).toBeLessThan(5);                                // (8.2 cm)
    expect(peakOf(land)).toBeLessThan(2);
    // the absorb sinks further than a hop's (impact-scaled): the pelvis bottoms out below the standing height
    const after = r.samples.filter((s) => s.t > land.t && s.t < land.t + 0.4);
    expect(Math.min(...after.map((s) => s.y))).toBeLessThan(r.d.body.hipHeight - 0.15);
  });

  it('quick re-jump: a press while landing is kept, and the next jump crouches straight out of the landing', { timeout: 60_000 }, async () => {
    const r = await runSequence(seq('quick-rejump'));
    const launches = r.transitions.filter((t) => t.from === 'jump-crouch' && t.to === 'jump-air');
    expect(launches.length).toBe(2);                                // (1: the press during the landing was lost)
    const [again] = find(r, 'jump-land', 'jump-crouch');           // out of the landing, not after recovering
    expect(again.t).toBeLessThan(3.3);
    for (const tr of r.transitions) {
      expect(peakOf(tr), `${tr.t.toFixed(2)} ${tr.from}→${tr.to}`).toBeLessThan(2);
      expect(tr.dy, `${tr.t.toFixed(2)} ${tr.from}→${tr.to}`).toBeLessThan(3);
    }
  });

  it('gallop → wings prep → running takeoff: the wings carry over, the body keeps its pace', { timeout: 60_000 }, async () => {
    const r = await runSequence(seq('gallop-takeoff-flight'));
    const [push] = find(r, 'prep', 'takeoff');
    expect(push.bones[PROBE_BONES.findIndex(([n]) => n === 'wingL')]).toBeLessThan(3);   // (98.6°: the wings dropped)
    expect(peakOf(push)).toBeLessThan(3);
    expect(push.dy).toBeLessThan(2.5);
    expect(push.dv).toBeLessThan(0.5);                              // (8 m/s: set back by a step of the gallop)
    const [cruise] = find(r, 'takeoff', 'flap');
    expect(peakOf(cruise)).toBeLessThan(2);
  });

  it('flap → glide → tucked dive → pull-up: every air change is smooth', { timeout: 60_000 }, async () => {
    const r = await runSequence(seq('flap-glide-dive-pullup'));
    for (const tr of r.transitions) {
      expect(peakOf(tr), `${tr.from}→${tr.to}`).toBeLessThan(2);
      expect(tr.dy, `${tr.from}→${tr.to}`).toBeLessThan(1.5);
    }
  });

  it('fast flight → running landing → run-out: the descent carries in, the body eases down onto the ground', { timeout: 60_000 }, async () => {
    const r = await runSequence(seq('fast-flight-runland-runout'));
    const [land] = find(r, 'descend', 'landing');
    expect(land.dy).toBeLessThan(1.5);                              // (5.4 cm: the sink rate stopped dead)
    const [touch] = find(r, 'landing', 'runout');
    expect(peakOf(touch)).toBeLessThan(2);                          // (3.0°: the clip's 30 fps keys at the impact)
    expect(touch.dy).toBeLessThan(1.5);
    const [ground] = find(r, 'runout', 'trot');
    expect(ground.dy).toBeLessThan(1.5);
    // no belly-low sag as the springs take the body back (it dropped to 0.65 m)
    const after = r.samples.filter((s) => s.t > touch.t && s.t < touch.t + 1.5);
    expect(Math.min(...after.map((s) => s.y))).toBeGreaterThan(r.d.body.hipHeight - 0.25);
    // and the landing speed bleeds off rather than braking to the trot at once
    const ahead = r.samples.find((s) => s.t > touch.t + 0.25)!;
    expect(ahead.speed).toBeGreaterThan(4.5);
  });

  it('a slow landing settles to a stand with no step', { timeout: 60_000 }, async () => {
    const r = await runSequence(seq('slow-flight-standland'));
    for (const tr of r.transitions) {
      if (tr.from === 'idle' || tr.to === 'idle') continue;
      expect(peakOf(tr), `${tr.from}→${tr.to}`).toBeLessThan(2.5);
      expect(tr.dy, `${tr.from}→${tr.to}`).toBeLessThan(1.5);
    }
  });
});
