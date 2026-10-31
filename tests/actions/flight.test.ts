import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { FLIGHT_CLIPS, sampleFlight } from '../../src/characters/dragon/actions/flight';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { createToothlessBrain, type ToothlessBrain } from '../../src/characters/dragon/toothlessBrain';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const LEVEL = (18 * Math.PI) / 180;              // the camera pitch that asks for level flight (flight.neutralPitchDeg)
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});
const at = (t: number, s: number) => Math.abs(t - s) < DT / 2;

interface Flown {
  d: DragonCharacter;
  tb: ToothlessBrain;
  phases: string[];
  /** Largest per-step change of the pelvis's per-step height change (m) and pitch change (rad): pops show up here. */
  accH: number;
  accP: number;
  /** Lowest pelvis height over the ground (m), highest altitude. */
  minH: number;
  maxH: number;
  /** Gait phase and speed on the step the running landing handed over. */
  handGait: number;
  handSpeed: number;
  /** Largest bank magnitude (rad), and the body roll's extremes. */
  maxBank: number;
  minRoll: number;
  maxRoll: number;
}

async function fly(plan: (t: number) => { keys: string[]; press?: string[] }, seconds: number, cameraYaw: (t: number) => number = () => 0): Promise<Flown> {
  const a = await loadToothlessMotion();
  const world = CollisionWorld.fromObjects([box(1200, 1, 1200, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig: a.rig, world, clips: a.clips, posesMeta: a.posesMeta, seed: 1 });
  d.spawn(0, -300, 0);
  const tb = createToothlessBrain(d, a.rig, {});
  const r: Flown = { d, tb, phases: [], accH: 0, accP: 0, minH: Infinity, maxH: -Infinity, handGait: -1, handSpeed: -1, maxBank: 0, minRoll: 0, maxRoll: 0 };
  let prevH = d.body.pose.pelvisPos.y;
  let prevP = d.body.pose.pitch;
  let dh0 = 0;
  let dp0 = 0;
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = k * DT;
    const p = plan(t);
    const was = tb.flight.phase;
    d.update({ input: input(p.keys, p.press ?? []), cameraYaw: cameraYaw(t), cameraPitch: LEVEL, cameraPos: CAM }, DT);
    const ph = tb.flight.phase;
    if (r.phases[r.phases.length - 1] !== ph) r.phases.push(ph);
    if (was === 'landing' && ph === 'idle') {
      r.handGait = d.gait.phase;
      r.handSpeed = d.kin.speed;
    }
    const h = d.body.pose.pelvisPos.y;
    const pi = d.body.pose.pitch;
    if (k > 2) {
      r.accH = Math.max(r.accH, Math.abs(h - prevH - dh0));
      r.accP = Math.max(r.accP, Math.abs(pi - prevP - dp0));
    }
    dh0 = h - prevH;
    dp0 = pi - prevP;
    prevH = h;
    prevP = pi;
    r.minH = Math.min(r.minH, h);
    r.maxBank = Math.max(r.maxBank, Math.abs(tb.flight.bank));
    if (tb.flight.airborne) {
      r.minRoll = Math.min(r.minRoll, d.body.pose.roll);
      r.maxRoll = Math.max(r.maxRoll, d.body.pose.roll);
    }
    r.maxH = Math.max(r.maxH, h);
  }
  return r;
}

describe('sampleFlight', () => {
  it('samples a 30 fps curve linearly, clamped for a one-shot and wrapped for a loop', () => {
    const c = [0, 3, 6, 9];
    expect(sampleFlight(c, 1 / 60)).toBeCloseTo(1.5);
    expect(sampleFlight(c, 5)).toBe(9);
    expect(sampleFlight(c, -1)).toBe(0);
    expect(sampleFlight(c, 3.5 / 30, true)).toBeCloseTo(4.5);   // between the last frame and the first
    expect(sampleFlight(c, 4 / 30, true)).toBeCloseTo(0);
  });
});

describe('FlightAction (fixture rig: no flight clips)', () => {
  it('never starts without the clips, and a Space tap is still the jump', () => {
    const rig = toothlessFixtureRig();
    const d = new DragonCharacter({ rig, world: CollisionWorld.fromObjects([box(200, 1, 200, 0, -0.5, 0)]), seed: 1 });
    d.spawn(0, 0, 0);
    const tb = createToothlessBrain(d, rig, {});
    for (let k = 0; k < 120; k++) d.update({ input: input([]), cameraYaw: 0, cameraPos: CAM }, DT);
    d.update({ input: input([], ['Space']), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(tb.jump.phase).toBe('crouch');
    expect(tb.flight.phase).toBe('idle');
  });
});

describe.skipIf(!HAS_LIBRARY)('FlightAction (Toothless library)', () => {
  it('ships every flight clip with its curves', async () => {
    const a = await loadToothlessMotion();
    for (const n of FLIGHT_CLIPS) {
      const m = a.posesMeta.clips[n];
      expect(a.clips.has(n), n).toBe(true);
      expect(m?.flight?.height.length, n).toBeGreaterThan(10);
      expect(m?.mask, n).not.toContain('pelvis');
    }
  });

  it('standing: hold Space → takeoff → flap → glide → brake → Space → standing landing, smooth and above ground', { timeout: 60_000 }, async () => {
    const r = await fly((t) => {
      if (t >= 1 && t < 1.5) return { keys: ['Space'], press: at(t, 1) ? ['Space'] : [] };
      if (t > 5 && t < 8) return { keys: ['KeyW'] };
      if (t > 11 && t < 13) return { keys: ['KeyS'] };
      if (at(t, 13)) return { keys: [], press: ['Space'] };
      return { keys: [] };
    }, 18);
    expect(r.phases).toEqual(['idle', 'takeoff', 'air', 'landing', 'settle', 'idle']);
    expect(r.tb.jump.phase).toBe('idle');                         // the held Space was never a jump
    expect(r.d.nanResets).toBe(0);
    expect(r.maxH).toBeGreaterThan(4.5);
    expect(r.minH).toBeGreaterThan(0.6);                          // the pre-load crouch is the lowest he goes
    expect(r.accH).toBeLessThan(0.025);                           // no pops: ≤ 2.5 cm/step change of the step
    expect(r.accP).toBeLessThan(0.02);
    expect(r.d.mods.scripted).toBe(false);
    expect(r.d.body.override.active).toBe(false);
    expect(r.d.planner.autoStep).toBe(true);
    for (const n of FLIGHT_CLIPS) expect(r.d.layers.weight(n), n).toBe(0);
    expect(r.d.body.pose.pelvisPos.y).toBeCloseTo(r.d.body.hipHeight, 0);   // standing again
  });

  it('running: gallop + Space → wings prep → push → flight → running landing hands the gallop on in phase', { timeout: 60_000 }, async () => {
    const r = await fly((t) => {
      if (t < 3) return { keys: ['KeyW', 'ShiftLeft'], press: at(t, 2.5) ? ['Space'] : [] };
      if (t < 7) return { keys: ['KeyW'] };
      if (at(t, 10)) return { keys: [], press: ['Space'] };
      return { keys: [] };
    }, 14);
    expect(r.phases).toEqual(['idle', 'prep', 'takeoff', 'air', 'descend', 'landing', 'idle']);
    expect(r.tb.jump.phase).toBe('idle');                         // the Space at a gallop was the takeoff, not a jump
    expect(r.d.nanResets).toBe(0);
    expect(r.minH).toBeGreaterThan(0.55);
    expect(r.accH).toBeLessThan(0.035);
    expect(r.accP).toBeLessThan(0.02);
    expect(r.handGait).toBeLessThan(0.05);                        // touchdown is the gallop's left-hind footfall
    expect(r.handSpeed).toBeGreaterThan(5);                       // he lands running
    expect(r.d.mods.scripted).toBe(false);
  });

  it('a slow landing from altitude stays a standing landing through its descent', { timeout: 60_000 }, async () => {
    const r = await fly((t) => {
      if (t >= 1 && t < 1.5) return { keys: ['Space'], press: at(t, 1) ? ['Space'] : [] };
      if (t > 4 && t < 9) return { keys: ['KeyW'] };
      if (t > 9 && t < 12) return { keys: ['KeyS'] };
      if (at(t, 12)) return { keys: [], press: ['Space'] };
      return { keys: [] };
    }, 20, () => 0);
    expect(r.phases).toEqual(['idle', 'takeoff', 'air', 'descend', 'landing', 'settle', 'idle']);
    expect(r.d.nanResets).toBe(0);
    expect(r.accH).toBeLessThan(0.035);
  });

  it('turns toward the camera and banks into the turn', { timeout: 60_000 }, async () => {
    let bank = 0;
    const r = await fly((t) => {
      if (t < 1) return { keys: [] };
      if (t < 1.5) return { keys: ['Space'], press: at(t, 1) ? ['Space'] : [] };
      return { keys: ['KeyW'] };
    }, 9, (t) => (t > 5 ? Math.PI / 2 : 0));
    bank = r.d.body.override.roll;
    expect(r.maxBank).toBeGreaterThan(0.2);
    // into the turn: the camera swung to his left (+heading), so his left side goes down (+ roll lifts the left side)
    expect(r.minRoll).toBeLessThan(-0.2);
    expect(r.maxRoll).toBeLessThan(0.05);
    expect(r.tb.flight.phase).toBe('air');
    expect(Math.abs(r.d.kin.heading - Math.PI / 2)).toBeLessThan(0.2);
    expect(Math.abs(bank)).toBeLessThan(0.7);
  });
});
