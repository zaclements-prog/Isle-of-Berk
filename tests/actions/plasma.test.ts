import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { PlasmaAction } from '../../src/characters/dragon/actions/plasma';
import { DragonBrain } from '../../src/characters/dragon/behaviour/brain';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { MotionMetrics } from '../../src/characters/dragon/motion/metrics';
import type { PosesMeta } from '../../src/characters/dragon/motion/poseLayers';
import type { MotionRig } from '../../src/characters/dragon/motion/rigTypes';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});

function setup(aim: THREE.Vector3, rig: MotionRig = toothlessFixtureRig(), clips?: Map<string, THREE.AnimationClip>, posesMeta?: PosesMeta) {
  const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig, world, clips, posesMeta, seed: 1 });
  d.spawn(0, 0, 0);
  const plasma = new PlasmaAction(rig, d, d.tuning.plasma, (_dd, out) => out.copy(aim));
  const brain = new DragonBrain(d, { rig, seed: 1, actions: [plasma] });
  return { world, d, plasma, brain };
}

/** Press F at the given times; run `seconds`. */
function run(s: ReturnType<typeof setup>, presses: number[], seconds: number, each?: (t: number) => void): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = k * DT;
    const press = presses.some((p) => Math.abs(p - t) < DT / 2) ? ['KeyF'] : [];
    s.d.update({ input: input([], press), cameraYaw: 0, cameraPos: CAM }, DT);
    each?.(t);
  }
}

describe('PlasmaAction (fixture rig)', () => {
  it('charges ~0.3 s, fires once from the mouth toward the aim, then cools down ~0.7 s', () => {
    const aim = new THREE.Vector3(2, 1, 20);
    const s = setup(aim);
    const shotAt: number[] = [];
    run(s, [0.5, 0.9, 1.3, 1.6], 2.4, (t) => { while (s.plasma.shots.length) { const shot = s.plasma.shots.shift()!; shotAt.push(t); (s as { last?: typeof shot }).last = shot; } });
    expect(shotAt.length).toBe(2);                                  // 0.9 falls in the cooldown; 1.3 fires; 1.6 is cooling
    expect(shotAt[0]).toBeCloseTo(0.5 + s.d.tuning.plasma.chargeTime, 1);
    expect(shotAt[1] - shotAt[0]).toBeGreaterThanOrEqual(s.d.tuning.plasma.cooldown - 1e-9);
    const last = (s as { last?: { from: THREE.Vector3; dir: THREE.Vector3 } }).last!;
    const mouth = s.plasma.mouth(s.d, new THREE.Vector3());
    expect(last.from.distanceTo(mouth)).toBeLessThan(0.3);
    expect(last.dir.dot(aim.clone().sub(last.from).normalize())).toBeGreaterThan(0.999);
  });
  it('turns to an aim behind him before charging', () => {
    const aim = new THREE.Vector3(0, 1, -20);
    const s = setup(aim);
    let fired = -1;
    run(s, [0.3], 3, (t) => { if (s.plasma.shots.length && fired < 0) fired = t; });
    expect(fired).toBeGreaterThan(0.3 + s.d.tuning.plasma.chargeTime + 0.2);
    expect(Math.cos(s.d.kin.heading)).toBeLessThan(-Math.cos(THREE.MathUtils.degToRad(s.d.tuning.plasma.chargeFacingDeg + 5)));
  });
  it('looks at the aim, recoils and skids a little, and every metric holds', () => {
    const aim = new THREE.Vector3(-3, 2, 25);
    const s = setup(aim);
    const m = new MotionMetrics(s.world, 3);
    let lookedAtAim = false;
    let minH = Infinity;
    let standH = 0;
    run(s, [0.5], 3, (t) => {
      m.sample(s.d);
      if (s.plasma.phase === 'charge' && s.d.look.override.active && s.d.look.override.point.distanceTo(aim) < 1e-9) lookedAtAim = true;
      if (t < 0.5) standH = s.d.body.pose.height;
      if (t > 0.8 && t < 1.2) minH = Math.min(minH, s.d.body.pose.height);
    });
    expect(lookedAtAim).toBe(true);
    expect(standH - minH).toBeGreaterThan(0.02);                    // the recoil dips the suspension
    expect(s.d.kin.pos.z).toBeLessThan(0);                          // skidded back
    expect(s.d.kin.pos.z).toBeGreaterThan(-0.3);
    const r = m.report('plasma');
    expect(r.failures, JSON.stringify(r)).toEqual([]);
  });
});

describe.skipIf(!HAS_LIBRARY)('PlasmaAction on the real rig with the library', () => {
  it('rears up, glows, slits the pupils and fires', { timeout: 60_000 }, async () => {
    const a = await loadToothlessMotion();
    const s = setup(new THREE.Vector3(1, 2, 25), a.rig, a.clips, a.posesMeta);
    let glow = 0;
    let pupil = 1;
    let rear = 0;
    run(s, [0.5], 2.5, () => {
      glow = Math.max(glow, s.brain.face.state.plasmaGlow);
      pupil = Math.min(pupil, s.brain.face.state.pupil);
      rear = Math.max(rear, s.d.layers.weight('plasma_rear'));
    });
    expect(s.plasma.fired).toBe(1);
    expect(rear).toBe(1);
    expect(glow).toBeGreaterThan(0.95);
    expect(pupil).toBeLessThan(0.15);
    expect(s.d.nanResets).toBe(0);
  });
});
