import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import {
  PlasmaAction, chargeCooldown, chargeFraction, chargeGlow, chargePower, chargeSweep, type PlasmaBody, type PlasmaShot,
} from '../../src/characters/dragon/actions/plasma';
import { DragonBrain } from '../../src/characters/dragon/behaviour/brain';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { PlasmaFx, blastLook } from '../../src/fx/plasmaFx';
import { CollisionWorld } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const C = DEFAULT_TUNING.plasma;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const input = (keys: string[], pressed: string[] = [], buttons = 0, buttonsPressed = 0): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons, buttonsPressed,
});
const at = (t: number, s: number) => Math.abs(t - s) < DT / 2;

describe('charge curves (quick fire vs long fire)', () => {
  it('a press held within tapTime is a quick shot; the charge then fills linearly to fullTime', () => {
    expect(chargeFraction(C, 0)).toBe(0);
    expect(chargeFraction(C, C.tapTime)).toBe(0);
    expect(chargeFraction(C, (C.tapTime + C.fullTime) / 2)).toBeCloseTo(0.5, 9);
    expect(chargeFraction(C, C.fullTime)).toBe(1);
    expect(chargeFraction(C, C.fullTime + 5)).toBe(1);
  });
  it('power runs from tapPower to fullPower, easing in; the cooldown from the quick shot\'s to the full one\'s', () => {
    expect(chargePower(C, 0)).toBe(C.tapPower);
    expect(chargePower(C, 1)).toBeCloseTo(C.fullPower, 9);
    expect(chargePower(C, 0.5)).toBeLessThan((C.tapPower + C.fullPower) / 2);       // a full charge pays most
    for (let f = 0.1; f <= 1; f += 0.1) expect(chargePower(C, f)).toBeGreaterThan(chargePower(C, f - 0.1));
    expect(C.tapPower).toBeLessThan(C.blastPower);                                   // a quick shot is the small blast
    expect(C.fullPower).toBeGreaterThan(2 * C.blastPower);                           // a full charge, a much bigger one
    expect(chargeCooldown(C, 0)).toBe(C.cooldown);
    expect(chargeCooldown(C, 1)).toBe(C.fullCooldown);
    expect(C.cooldown).toBeLessThan(C.fullCooldown);
  });
  it('the plates ramp to tapGlow over the wind-up, then climb to fullGlow, pulsing near full and cresting at it', () => {
    expect(chargeGlow(C, 0, 0)).toBe(0);
    expect(chargeGlow(C, C.chargeTime, 0.05)).toBeCloseTo(C.tapGlow, 9);
    // before the flicker: rising every step
    let prev = chargeGlow(C, C.chargeTime, C.tapTime);
    const flickerAt = C.tapTime + C.flickerFrom * (C.fullTime - C.tapTime);
    for (let h = C.tapTime + 0.05; h < flickerAt; h += 0.05) {
      const g = chargeGlow(C, C.chargeTime, h);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
    // the flicker: it swings both ways, more as it nears full, and crests at fullGlow at full charge
    const tail: number[] = [];
    for (let h = flickerAt; h <= C.fullTime + 1e-9; h += DT) tail.push(chargeGlow(C, C.chargeTime, h));
    let falls = 0;
    for (let k = 1; k < tail.length; k++) if (tail[k] < tail[k - 1]) falls++;
    expect(falls).toBeGreaterThan(5);
    expect(chargeGlow(C, C.chargeTime, C.fullTime)).toBeCloseTo(C.fullGlow, 9);
    expect(Math.max(...tail)).toBeLessThanOrEqual(C.fullGlow + 1e-9);
    expect(Math.min(...tail)).toBeGreaterThan(C.tapGlow);
    expect(C.fullGlow).toBeGreaterThan(3 * C.tapGlow);
  });
  it('a long charge runs the light up the spine from the tail to the head; a quick shot lights it all at once', () => {
    expect(chargeSweep(C, 0.1)).toBeGreaterThanOrEqual(1.1);                      // quick: every plate alike
    expect(chargeSweep(C, C.tapTime + 0.01)).toBeLessThan(0.05);                  // long: it starts at the tail
    let prev = -1;
    for (let h = C.tapTime + 0.01; h <= C.fullTime; h += 0.1) {
      const f = chargeSweep(C, h);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(chargeSweep(C, C.tapTime + 0.8 * (C.fullTime - C.tapTime))).toBeGreaterThanOrEqual(1.05);   // the head by 80 %
  });
});

/** The fixture rig on the ground (or, with a body, on the wing), plasma alone. */
function setup(aim: THREE.Vector3, body?: PlasmaBody) {
  const rig = toothlessFixtureRig();
  const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig, world, seed: 1 });
  d.spawn(0, 0, 0);
  const plasma = new PlasmaAction(rig, d, d.tuning.plasma, (_dd, out) => out.copy(aim), body);
  const brain = new DragonBrain(d, { rig, seed: 1, actions: [plasma] });
  const shots: Array<{ t: number; shot: PlasmaShot }> = [];
  const glow: Array<{ t: number; g: number }> = [];
  /** `held(t)`: F down at time t; a press on its first step down (the controller's edge). */
  const run = (held: (t: number) => boolean, seconds: number, each?: (t: number) => void, from = 0) => {
    let was = false;
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      const t = from + k * DT;
      const h = held(t);
      if (body) d.mods.scripted = true;
      d.update({ input: input(h ? ['KeyF'] : [], h && !was ? ['KeyF'] : []), cameraYaw: 0, cameraPos: CAM }, DT);
      was = h;
      while (plasma.shots.length) shots.push({ t, shot: plasma.shots.shift()! });
      glow.push({ t, g: brain.face.state.plasmaGlow });
      each?.(t);
    }
  };
  return { d, plasma, brain, shots, glow, run };
}
const glowAt = (s: ReturnType<typeof setup>, t: number) => s.glow.find((g) => at(g.t, t))!.g;

describe('PlasmaAction quick fire and long fire (fixture rig)', () => {
  it('a quick click is a small shot after the usual wind-up', () => {
    const s = setup(V(0, 1, 25));
    s.run((t) => at(t, 0.5) || at(t, 0.5 + DT), 1.5);           // down for two steps
    expect(s.shots.length).toBe(1);
    expect(s.shots[0].t).toBeCloseTo(0.5 + C.chargeTime, 1);
    expect(s.shots[0].shot.power).toBe(C.tapPower);
    expect(s.shots[0].shot.charge).toBe(0);
    expect(Math.max(...s.glow.map((g) => g.g))).toBeCloseTo(C.tapGlow, 1);
  });
  it('the mouse works the same way: a left-button hold charges', () => {
    const s = setup(V(0, 1, 25));
    let was = false;
    for (let k = 0; k < Math.round(3 / DT); k++) {
      const down = k * DT >= 0.2;
      s.d.update({ input: input([], [], down ? 1 : 0, down && !was ? 1 : 0), cameraYaw: 0, cameraPos: CAM }, DT);
      was = down;
    }
    expect(s.plasma.fired).toBe(1);
    expect(s.plasma.lastPower).toBeCloseTo(C.fullPower, 6);
  });
  it('quick shots fire in quick succession (and a click just early is kept)', () => {
    const s = setup(V(0, 1, 25));
    const taps = [0.2, 0.85, 1.42, 2.05];                       // 1.42 lands just before he is ready: buffered
    s.run((t) => taps.some((p) => at(t, p)), 3);
    expect(s.shots.length).toBe(4);
    for (let k = 1; k < 4; k++) expect(s.shots[k].t - s.shots[k - 1].t).toBeLessThan(0.7);
    for (const { shot } of s.shots) expect(shot.power).toBe(C.tapPower);
  });
  it('held: the plates light up progressively, and at fullTime it fires itself, once, at full power', () => {
    const s = setup(V(0, 1, 25));
    const sweeps: THREE.Vector2[] = [];
    s.run((t) => t >= 0.5, 4, (t) => { if (at(t, 1) || at(t, 1.6)) sweeps.push(s.plasma.sweep(new THREE.Vector2())); });
    expect(s.shots.length).toBe(1);
    expect(s.shots[0].t).toBeCloseTo(0.5 + C.fullTime, 1);
    expect(s.shots[0].shot.power).toBeCloseTo(C.fullPower, 6);
    expect(s.shots[0].shot.charge).toBe(1);
    // the glow climbs through the charge, well past a quick shot's, and peaks at the release
    const g = [0.8, 1.2, 1.6, 2.0].map((t) => glowAt(s, t));
    for (let k = 1; k < g.length; k++) expect(g[k]).toBeGreaterThan(g[k - 1]);
    expect(g[0]).toBeGreaterThan(C.tapGlow * 0.9);
    expect(glowAt(s, 0.5 + C.fullTime - DT)).toBeGreaterThan(C.fullGlow * 0.95);
    // the light climbed the spine as it charged, and lit every plate alike at the release
    expect(sweeps[0].x).toBeLessThan(sweeps[1].x);
    expect(sweeps[0].y).toBeLessThan(1);                                         // the plates ahead keep tapGlow
    expect(s.plasma.sweep(new THREE.Vector2()).x).toBeGreaterThanOrEqual(1.1);
    // then fades out over the recover and gives the plates back to the layers
    expect(glowAt(s, 0.5 + C.fullTime + 0.6)).toBe(0);
    expect(s.plasma.glow).toBeNull();
    expect(s.d.nanResets).toBe(0);
  });
  it('a full charge cools down longer than a quick shot', () => {
    const s = setup(V(0, 1, 25));
    // full charge fires at 2.5; a tap at 3.2 is inside its cooldown (and too early to be buffered); 4.2 fires
    s.run((t) => (t >= 0.5 && t < 2.6) || at(t, 3.2) || at(t, 4.2), 5);
    expect(s.shots.map((x) => x.shot.power)).toEqual([expect.closeTo(C.fullPower, 6), C.tapPower]);
    expect(s.shots[1].t - s.shots[0].t).toBeGreaterThanOrEqual(C.fullCooldown);
  });
  it('released mid-charge it fires at once, with the power charged so far', () => {
    const s = setup(V(0, 1, 25));
    const release = 1.5;
    s.run((t) => t >= 0.5 && t < release, 3);
    expect(s.shots.length).toBe(1);
    expect(s.shots[0].t).toBeCloseTo(release, 1);
    const f = chargeFraction(C, release - 0.5);
    expect(s.shots[0].shot.charge).toBeCloseTo(f, 1);
    expect(s.shots[0].shot.power).toBeCloseTo(chargePower(C, f), 1);
    expect(s.shots[0].shot.power!).toBeGreaterThan(C.tapPower);
    expect(s.shots[0].shot.power!).toBeLessThan(C.fullPower);
  });
  it('scripted: press(seconds) holds on simulation time, press(Infinity) until release()', () => {
    const s = setup(V(0, 1, 25));
    s.run(() => false, 0.2);
    s.plasma.press(1);
    s.run(() => false, 2, undefined, 0.2);
    expect(s.shots.length).toBe(1);
    expect(s.shots[0].shot.charge).toBeCloseTo(chargeFraction(C, 1), 1);
    s.plasma.press(Infinity);
    s.run(() => false, 1.2, undefined, 2.2);
    expect(s.plasma.phase).toBe('charge');
    expect(s.plasma.charge).toBeGreaterThan(0.4);
    s.plasma.release();
    s.run(() => false, 0.3, undefined, 3.4);
    expect(s.shots.length).toBe(2);
    s.run(() => false, 1.2, undefined, 3.7);                    // the part charge's cooldown
    s.plasma.press();                                           // a tap
    s.run(() => false, 1, undefined, 4.9);
    expect(s.shots.length).toBe(3);
    expect(s.shots[2].shot.power).toBe(C.tapPower);
  });
  it('a full charge recoils harder than a quick shot', () => {
    const tap = setup(V(0, 1, 25));
    let tapKick = 0;
    tap.run((t) => at(t, 0.2), 1.2, () => { tapKick = Math.max(tapKick, tap.d.look.headPitch.v); });
    const full = setup(V(0, 1, 25));
    let fullKick = 0;
    full.run((t) => t >= 0.2, 3, () => { fullKick = Math.max(fullKick, full.d.look.headPitch.v); });
    expect(fullKick).toBeGreaterThan(tapKick * 1.5);
  });
});

describe('PlasmaAction long fire on the wing (stand-in body)', () => {
  const airBody = (vel: THREE.Vector3, recoil: Array<[number, number]>): PlasmaBody => ({
    airborne: () => true, velocity: (out) => out.copy(vel), hitch: () => {}, recoil: (p, v) => recoil.push([p, v]),
  });
  it('charges and fires itself at full power in flight, the bolt keeping the body\'s speed along the ray', () => {
    const vel = V(0, -6, 25);
    const recoil: Array<[number, number]> = [];
    const s = setup(V(0, -40, 70), airBody(vel, recoil));
    let maxGlow = 0;
    s.run((t) => t >= 0.3, 3, () => { maxGlow = Math.max(maxGlow, s.brain.face.state.plasmaGlow); });
    expect(s.shots.length).toBe(1);
    expect(s.shots[0].t).toBeCloseTo(0.3 + C.fullTime, 1);
    const { shot } = s.shots[0];
    expect(shot.power).toBeCloseTo(C.fullPower, 6);
    expect(shot.speed).toBeCloseTo(C.boltSpeed + shot.dir.dot(vel), 6);
    expect(maxGlow).toBeGreaterThan(C.fullGlow * 0.95);
    expect(recoil[0][0]).toBeCloseTo(THREE.MathUtils.degToRad(C.airRecoilDeg) * Math.sqrt(C.fullPower), 9);
  });
  it('a full charge with the aim behind him waits airHoldTime for it, then lets it go unfired', () => {
    const s = setup(V(0, 2, -40), airBody(V(0, 0, 20), []));
    s.run((t) => t >= 0.3, 0.3 + C.fullTime + C.airHoldTime + 0.6);
    expect(s.shots.length).toBe(0);
    expect(s.plasma.dropped).toBe(1);
    expect(s.plasma.phase).toBe('idle');
  });
});

describe('PlasmaFx scales with the shot\'s power', () => {
  it('a bigger shot is a bigger bolt, flash and scorch, more sparks and shake; onImpact carries the power', () => {
    for (const k of ['bolt', 'flash', 'light', 'time', 'sparks', 'smoke', 'scorch', 'shake'] as const) {
      expect(blastLook(1)[k]).toBeCloseTo(1, 9);                               // the standard shot is unchanged
      expect(blastLook(C.fullPower)[k]).toBeGreaterThan(blastLook(1)[k]);
      expect(blastLook(C.tapPower)[k]).toBeLessThan(blastLook(1)[k]);
    }
    const world = CollisionWorld.fromObjects([new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2))]);
    const powers: number[] = [];
    const shakes: number[] = [];
    const fx = new PlasmaFx({ world, cfg: C, onImpact: (_p, _n, power) => powers.push(power), shake: (a) => shakes.push(a) });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 5, -10);
    fx.fire({ from: V(0, 5, 0), dir: V(0, -1, 1).normalize(), power: C.tapPower });
    fx.fire({ from: V(30, 5, 0), dir: V(0, -1, 1).normalize(), power: C.fullPower });
    fx.fire({ from: V(-30, 5, 0), dir: V(0, -1, 1).normalize() });
    for (let f = 0; f < 120 && fx.flying; f++) fx.update(1 / 60, camera, 1080);
    expect(powers.sort()).toEqual([C.tapPower, 1, C.fullPower].sort());
    expect(Math.max(...shakes)).toBeGreaterThan(Math.min(...shakes) * 2);
    fx.dispose();
  });
  it('the mouth glow shows only while charging, bigger with the charge', () => {
    const world = CollisionWorld.fromObjects([]);
    const fx = new PlasmaFx({ world, cfg: C });
    const sprite = () => fx.root.children.filter((c) => (c as THREE.Sprite).isSprite && c.visible);
    const before = sprite().length;
    fx.charging(V(0, 1, 0), 0.7, 0);
    const small = sprite().find((c) => c.position.y === 1)!.scale.x;
    fx.charging(V(0, 1, 0), C.fullGlow, 1);
    const big = sprite().find((c) => c.position.y === 1)!.scale.x;
    expect(big).toBeGreaterThan(2 * small);
    fx.update(0.1, new THREE.PerspectiveCamera(), 1080);
    expect(fx.sparks.count).toBeGreaterThan(0);                                 // drawn in toward the mouth
    fx.charging(null, 0, 0);
    expect(sprite().length).toBe(before);
    fx.dispose();
  });
});
