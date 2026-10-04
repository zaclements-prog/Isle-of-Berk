import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, dropWorld, floor, rampWorld, wallWorld } from '../fixtures/worlds';
import { runLabScript } from '../../src/dev/lab/labRunner';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const input = (keys: string[]): InputState => ({
  keys: new Set(keys), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});
function run(world: CollisionWorld, keys: string[], seconds: number, onStep?: (d: DragonCharacter) => void): DragonCharacter {
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world });
  d.spawn(0, -6, 0);
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    d.update({ input: input(keys), cameraYaw: 0, cameraPos: CAM }, DT);
    onStep?.(d);
  }
  return d;
}

describe('climbing', () => {
  it('walks up a 30° ramp in ordinary locomotion, body pitched with the slope', { timeout: 60_000 }, () => {
    let maxPitch = 0;
    const modes = new Set<string>();
    const d = run(rampWorld(30, -2), ['KeyW'], 4.5, (x) => {
      modes.add(x.climb.mode);
      maxPitch = Math.max(maxPitch, x.body.pose.pitch);
    });
    expect(modes.has('climb')).toBe(false);
    expect(modes.has('hop')).toBe(false); // the plateau at the crest is higher ground, not a drop
    expect(THREE.MathUtils.radToDeg(maxPitch)).toBeGreaterThan(20);
    expect(d.kin.pos.y).toBeGreaterThan(3);
    expect(d.nanResets).toBe(0);
  });
  it('switches to climb mode on a 55° slope and caps the speed', { timeout: 60_000 }, () => {
    let climbing = 0;
    let maxClimbSpeed = 0;
    const d = run(rampWorld(55, -2), ['KeyW'], 6, (x) => {
      if (x.climb.mode !== 'climb') return;
      climbing++;
      if (climbing > 30) maxClimbSpeed = Math.max(maxClimbSpeed, x.kin.speed); // after braking to the cap
    });
    expect(climbing).toBeGreaterThan(60);
    expect(maxClimbSpeed).toBeLessThanOrEqual(1.8 + 1e-6);
    expect(d.kin.pos.y).toBeGreaterThan(3); // and he actually climbs the face (it rises 6.55 m)
    expect(d.nanResets).toBe(0);
  });
  it('scrambles up a 2.3 m ledge', { timeout: 60_000 }, () => {
    const modes = new Set<string>();
    const d = run(wallWorld(2.3, 0), ['KeyW'], 3.5, (x) => modes.add(x.climb.mode));
    expect(modes.has('scramble')).toBe(true);
    expect(d.kin.pos.y).toBeGreaterThan(2.2);
    expect(d.kin.pos.z).toBeGreaterThan(0);
    expect(d.nanResets).toBe(0);
  });
  it('is blocked by a 3 m wall and never passes through it', { timeout: 60_000 }, () => {
    let maxChestZ = -Infinity;
    const chest = new THREE.Vector3();
    const wide = CollisionWorld.fromObjects([floor(), box(40, 3, 1, 0, 1.5, 0)]);
    const d = run(wide, ['KeyW'], 5, (x) => {
      maxChestZ = Math.max(maxChestZ, x.chestPos(chest).z);
    });
    expect(d.climb.mode).toBe('blocked');
    expect(maxChestZ).toBeLessThan(-0.5);
    expect(d.nanResets).toBe(0);
  });
  it('hops every drop deeper than the planner can step down (the two thresholds meet)', () => {
    expect(DEFAULT_TUNING.climb.dropMin).toBeLessThanOrEqual(DEFAULT_TUNING.planner.maxStepDown);
  });
  it('a respawn ends a scramble or hop in progress', { timeout: 60_000 }, () => {
    const d = new DragonCharacter({ rig: toothlessFixtureRig(), world: wallWorld(2.3, 0) });
    d.spawn(0, -6, 0);
    let k = 0;
    while (d.climb.mode !== 'scramble' && k++ < 600) d.update({ input: input(['KeyW']), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(d.climb.mode).toBe('scramble');
    d.spawn(-3, -8, 0);
    d.update({ input: input([]), cameraYaw: 0, cameraPos: CAM }, DT);
    expect(d.climb.mode).toBe('ground');
    expect(d.mods.scripted).toBe(false);
    expect(d.body.override.active).toBe(false);
    expect(d.planner.autoStep).toBe(true);
    expect(Math.hypot(d.kin.pos.x + 3, d.kin.pos.z + 8)).toBeLessThan(0.05);
  });
  it('walks up 0.5 m stairs as steps, never as scramble ledges', { timeout: 60_000 }, () => {
    const risers = [0, 1, 2, 3].map((k) => box(6, 0.5 * (k + 1), 1.2, 0, 0.25 * (k + 1), -3 + 1.2 * k));
    const landing = box(6, 2, 30, 0, 1, 0.6 + 15); // the top tread runs on into a landing (no drop at the top)
    const stairs = CollisionWorld.fromObjects([floor(), ...risers, landing]);
    const modes = new Set<string>();
    const d = run(stairs, ['KeyW'], 6, (x) => modes.add(x.climb.mode));
    expect([...modes]).toEqual(['ground']);
    expect(d.kin.pos.y).toBeGreaterThan(1);
    expect(d.nanResets).toBe(0);
  });
  it('carries every paw past the edge when he walks off a drop slowly', { timeout: 60_000 }, () => {
    const d = new DragonCharacter({ rig: toothlessFixtureRig(), world: dropWorld(2, 0) });
    d.spawn(0, -3, 0);
    d.controller.prowl = true; // 1.4 m/s: too slow to carry the hind paws over the edge on its own
    let hopped = false;
    const landing: Array<THREE.Vector3 | null> = [null, null, null, null];
    for (let k = 0; k < Math.round(5 / DT); k++) {
      d.update({ input: input(['KeyW']), cameraYaw: 0, cameraPos: CAM }, DT);
      if (d.climb.mode === 'hop') hopped = true;
      d.planner.paws.forEach((paw, i) => {
        if (hopped && paw.justPlanted && !landing[i]) landing[i] = paw.pos.clone();
      });
    }
    expect(hopped).toBe(true);
    for (const p of landing) {
      expect(p).not.toBeNull();
      expect(p!.y).toBeCloseTo(-2, 3); // on the lower level
      expect(p!.z).toBeGreaterThan(0); // past the edge
    }
    expect(d.nanResets).toBe(0);
  });
  it('stops in an inside corner instead of flipping between its walls (camera in the loop)', { timeout: 60_000 }, () => {
    // the course's L corner, from the corners script's spawn: with the orbit camera recentring behind him, held W
    // turns into "forward along whichever wall he faces", and the slide along one wall runs into the other
    const corner = CollisionWorld.fromObjects([floor(), box(8, 3, 0.8, -3, 1.5, 8), box(0.8, 3, 8, -6.6, 1.5, 4.4)]);
    const script = {
      name: 'corner', description: 'into an inside corner', spawn: { x: 0, z: 0, heading: Math.atan2(-6, 7) }, duration: 6,
      events: [{ t: 0.1, down: ['KeyW'] }],
    };
    let flips = 0;
    let prev = '';
    let last: DragonCharacter | null = null;
    const r = runLabScript({ rig: toothlessFixtureRig(), world: corner, script, onStep: (d, t) => {
      if (t > 3 && d.climb.mode !== prev) flips++;
      prev = d.climb.mode;
      last = d;
    } });
    expect(r.failures, JSON.stringify(r)).toEqual([]);
    expect(last!.climb.mode).toBe('blocked');
    expect(last!.kin.speed).toBe(0);
    expect(flips).toBe(0); // settled: no blocked/ground flip-flop in the last 3 s
  });
  it('does not scramble onto a top too small to stand on (a pillar), but is blocked by it', { timeout: 60_000 }, () => {
    const pillar = CollisionWorld.fromObjects([floor(), box(1.2, 1.5, 1.2, 0, 0.75, 0.6)]);
    const modes = new Set<string>();
    run(pillar, ['KeyW'], 3, (x) => modes.add(x.climb.mode));
    expect(modes.has('scramble')).toBe(false);
    expect(modes.has('blocked')).toBe(true);
  });
  it('hops down a 2 m drop with every metric in bounds: paws carried clear of the edge, legs in reach, landing absorbed', { timeout: 60_000 }, () => {
    const world = dropWorld(2, 0);
    const metrics = new MotionMetrics(world, 5);
    let hopped = false;
    let maxStretch = 0;
    let minPelvis = Infinity;
    run(world, ['KeyW'], 5, (d) => {
      metrics.sample(d);
      if (d.climb.mode === 'hop') {
        hopped = true;
        maxStretch = Math.max(maxStretch, ...d.legs.stretch);
      } else if (hopped) minPelvis = Math.min(minPelvis, d.body.pose.pelvisPos.y);
    });
    expect(hopped).toBe(true);
    expect(metrics.report('hop').failures).toEqual([]);
    expect(maxStretch).toBeLessThan(1); // the legs stay within reach in flight
    expect(minPelvis).toBeLessThan(-2 + toothlessFixtureRig().contacts.hind_L.sole[1] + 0.95); // he sinks into the landing
  });
  it('hops down a 2 m drop and lands on the lower level', { timeout: 60_000 }, () => {
    const modes = new Set<string>();
    const d = run(dropWorld(2, 0), ['KeyW'], 5, (x) => modes.add(x.climb.mode));
    expect(modes.has('hop')).toBe(true);
    expect(d.kin.pos.y).toBeLessThan(-1.8);
    expect(d.climb.mode).not.toBe('hop');
    expect(d.nanResets).toBe(0);
  });
});
