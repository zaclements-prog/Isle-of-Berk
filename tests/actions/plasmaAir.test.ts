import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { PlasmaAction, boltSpeedFrom, type PlasmaBody, type PlasmaShot } from '../../src/characters/dragon/actions/plasma';
import { DragonBrain } from '../../src/characters/dragon/behaviour/brain';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { createToothlessBrain } from '../../src/characters/dragon/toothlessBrain';
import { OrbitCamera } from '../../src/camera/orbitCamera';
import { cameraFollow } from '../../src/dev/lab/labRunner';
import { PlasmaFx } from '../../src/fx/plasmaFx';
import { DEFAULT_TUNING } from '../../src/characters/dragon/motion/tuning';
import { CollisionWorld, type RayHit } from '../../src/world/collision';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const input = (keys: string[], pressed: string[] = []): InputState => ({
  keys: new Set(keys), pressed: new Set(pressed), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0,
});
const at = (t: number, s: number) => Math.abs(t - s) < DT / 2;
const deg = THREE.MathUtils.degToRad;

describe('boltSpeedFrom', () => {
  it('adds the body speed along the aim ray, ignores the sideways part, never slows the bolt', () => {
    const dir = V(0, -1, 1).normalize();
    expect(boltSpeedFrom(45, dir, V(0, 0, 0))).toBe(45);
    expect(boltSpeedFrom(45, dir, dir.clone().multiplyScalar(40))).toBeCloseTo(85);       // a dive straight at it
    expect(boltSpeedFrom(45, dir, V(30, 0, 0))).toBeCloseTo(45);                           // sideways: led out
    expect(boltSpeedFrom(45, dir, dir.clone().multiplyScalar(-20))).toBe(45);              // flying away
    expect(boltSpeedFrom(45, dir, dir.clone().multiplyScalar(40), 0.5)).toBeCloseTo(65);
  });
});

/** The fixture rig with a stand-in body that says it is airborne (the flight's contract, without its clips). */
function airSetup(aim: THREE.Vector3, vel: THREE.Vector3) {
  const rig = toothlessFixtureRig();
  const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);
  const d = new DragonCharacter({ rig, world, seed: 1 });
  d.spawn(0, 0, 0);
  const calls = { hitch: [] as number[], recoil: [] as Array<[number, number]> };
  const body: PlasmaBody = {
    airborne: () => true,
    velocity: (out) => out.copy(vel),
    hitch: (s) => calls.hitch.push(s),
    recoil: (p, s) => calls.recoil.push([p, s]),
  };
  const plasma = new PlasmaAction(rig, d, d.tuning.plasma, (_dd, out) => out.copy(aim), body);
  new DragonBrain(d, { rig, seed: 1, actions: [plasma] });
  const shots: Array<{ t: number; shot: PlasmaShot }> = [];
  const run = (presses: number[], seconds: number, each?: (t: number) => void) => {
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      const t = k * DT;
      d.mods.scripted = true;                         // the flight scripts the body: plasma must still fire
      d.update({ input: input([], presses.some((p) => at(t, p)) ? ['KeyF'] : []), cameraYaw: 0, cameraPos: CAM }, DT);
      while (plasma.shots.length) shots.push({ t, shot: plasma.shots.shift()! });
      each?.(t);
    }
  };
  return { d, plasma, calls, shots, run };
}

describe('PlasmaAction on the wing (fixture rig, stand-in body)', () => {
  it('fires without standing: no turn, the same charge and cooldown, along the aim ray with the body speed added', () => {
    const vel = V(0, -12, 30);
    const aim = V(0, -40, 60);
    const s = airSetup(aim, vel);
    const c = s.d.tuning.plasma;
    let turned = false;
    s.run([0.5, 0.9, 1.6], 2.4, () => { if (s.plasma.phase === 'turn') turned = true; });
    expect(turned).toBe(false);
    expect(s.shots.length).toBe(2);                               // 0.9 falls in the cooldown, as on the ground
    expect(s.shots[0].t).toBeCloseTo(0.5 + c.chargeTime, 1);
    const { shot } = s.shots[0];
    expect(shot.dir.dot(aim.clone().sub(shot.from).normalize())).toBeGreaterThan(0.9999);   // on the aim ray
    expect(shot.speed).toBeCloseTo(c.boltSpeed + shot.dir.dot(vel), 6);
    expect(shot.speed!).toBeGreaterThan(c.boltSpeed + 20);       // diving at it: it arrives faster
    // the beat is held back while he charges, then let go; the release kicks the nose up and costs a little speed
    expect(Math.max(...s.calls.hitch)).toBeCloseTo(c.airHitch, 2);
    expect(s.calls.hitch[s.calls.hitch.length - 1]).toBe(0);
    expect(s.calls.recoil.length).toBe(2);
    for (const [p, v] of s.calls.recoil) {
      expect(p).toBeCloseTo(deg(c.airRecoilDeg), 9);
      expect(v).toBe(c.airRecoilSpeed);
    }
    expect(s.d.look.snap).toBe(1);
    expect(s.d.nanResets).toBe(0);
  });
  it('holds a charge for an aim behind him, then lets it go unfired with no cooldown spent', () => {
    const s = airSetup(V(0, 2, -40), V(0, 0, 20));                // flying +Z, the aim behind
    const c = s.d.tuning.plasma;
    s.run([0.3], 0.3 + c.chargeTime + c.airHoldTime + 0.5);
    expect(s.shots.length).toBe(0);
    expect(s.plasma.dropped).toBe(1);
    expect(s.plasma.offPath).toBeGreaterThan(deg(c.airConeDeg));
    expect(s.plasma.phase).toBe('idle');
  });
});

describe('Plasma mid-jump (fixture rig: the jump, no flight clips)', () => {
  it('a press on the jump\'s arc fires without the standing rear, with the arc\'s velocity', () => {
    const rig = toothlessFixtureRig();
    const d = new DragonCharacter({ rig, world: CollisionWorld.fromObjects([box(200, 1, 200, 0, -0.5, 0)]), seed: 1 });
    d.spawn(0, 0, 0);
    const aim = V(0, 0, 25);
    const tb = createToothlessBrain(d, rig, { aimAt: (_dd, out) => out.copy(aim) });
    let pressedInAir = false;
    let shot: PlasmaShot | null = null;
    let pressAt = -1;
    for (let k = 0; k < Math.round(4 / DT); k++) {
      const t = k * DT;
      // F on the first step after the crouch: he is on the arc
      const press = at(t, 1) ? ['Space'] : pressAt < 0 && tb.jump.phase === 'air' ? ['KeyF'] : [];
      if (press[0] === 'KeyF') { pressAt = t; pressedInAir = true; }
      d.update({ input: input(t > 0.5 && t < 1.6 ? ['KeyW'] : [], press), cameraYaw: 0, cameraPos: CAM }, DT);
      if (tb.plasma.shots.length && !shot) shot = tb.plasma.shots.shift()!;
    }
    expect(pressedInAir).toBe(true);
    expect(shot).not.toBeNull();
    expect(tb.plasma.fired).toBe(1);
    expect(d.layers.weight('plasma_rear')).toBe(0);
    expect(shot!.speed).toBeDefined();                            // the airborne path: the arc's speed along the ray
    expect(shot!.speed!).toBeGreaterThanOrEqual(d.tuning.plasma.boltSpeed);
    expect(d.nanResets).toBe(0);
  });
});

describe('PlasmaFx: range from altitude', () => {
  it('a shallow downward shot from 60 m up reaches the ground and blasts', () => {
    const world = CollisionWorld.fromObjects([new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2))]);
    const impacts: THREE.Vector3[] = [];
    const fx = new PlasmaFx({ world, cfg: DEFAULT_TUNING.plasma, onImpact: (p) => impacts.push(p.clone()) });
    const camera = new THREE.PerspectiveCamera();
    const slope = deg(15);                                        // 60 / sin 15° ≈ 232 m of flight
    fx.fire({ from: V(0, 60, 0), dir: V(0, -Math.sin(slope), Math.cos(slope)), speed: 60 });
    let frames = 0;
    for (; frames < 600 && fx.flying; frames++) fx.update(1 / 60, camera, 1080);
    expect(impacts.length).toBe(1);
    expect(impacts[0].z).toBeCloseTo(60 / Math.tan(slope), -0.5);
    expect(frames / 60).toBeCloseTo(60 / Math.sin(slope) / 60, 0);   // at the shot's own speed
  });
  it('keeps several long shots in flight at once (no bolt stolen mid-air), with the same two lights', () => {
    const world = CollisionWorld.fromObjects([new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2))]);
    const fx = new PlasmaFx({ world, cfg: DEFAULT_TUNING.plasma });
    const camera = new THREE.PerspectiveCamera();
    const lights = fx.root.children.filter((c) => (c as THREE.PointLight).isPointLight).length;
    for (let k = 0; k < 5; k++) {
      fx.fire({ from: V(k * 3, 60, 0), dir: V(0, -0.25, 1).normalize() });
      for (let j = 0; j < 60; j++) fx.update(1 / 60, camera, 1080);            // one a second
    }
    expect(fx.flying).toBe(5);
    for (let j = 0; j < 600 && fx.flying; j++) fx.update(1 / 60, camera, 1080);
    expect(fx.impacts).toBe(5);
    expect(fx.root.children.filter((c) => (c as THREE.PointLight).isPointLight).length).toBe(lights);
  });
});

describe.skipIf(!HAS_LIBRARY)('Plasma on the wing (Toothless library, the game camera\'s aim)', () => {
  /**
   * The game's loop in miniature: the orbit camera follows him (backing off in flight), plasma aims along its ray, the
   * FX flies the bolts. Take off, climb with W and the camera low, then the camera's pitch per `pitchAt`.
   */
  async function sortie(o: { climbUntil: number; seconds: number; fires: number[]; keys: (t: number) => string[]; pitchAt: (t: number) => number }) {
    const a = await loadToothlessMotion();
    const world = CollisionWorld.fromObjects([box(4000, 1, 4000, 0, -0.5, 0)]);
    const d = new DragonCharacter({ rig: a.rig, world, clips: a.clips, posesMeta: a.posesMeta, seed: 1 });
    d.spawn(0, -1500, 0);
    const cam = new OrbitCamera(d.tuning.camera, world);
    const hold = { chest: new THREE.Vector3() };
    cam.reset(cameraFollow(d, hold));
    const dir = new THREE.Vector3();
    const hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    const reach = d.tuning.plasma.boltRange;
    const aimAt = (_d: DragonCharacter, out: THREE.Vector3) => {
      dir.subVectors(cam.target, cam.position).normalize();
      return world.raycast(cam.position, dir, reach, hit) ? out.copy(hit.point) : out.copy(cam.position).addScaledVector(dir, reach);
    };
    const tb = createToothlessBrain(d, a.rig, { aimAt });
    const fired: Array<{ shot: PlasmaShot; aim: THREE.Vector3; alt: number; state: string; body: THREE.Vector3 }> = [];
    const impacts: THREE.Vector3[] = [];
    const fx = new PlasmaFx({ world, cfg: d.tuning.plasma, onImpact: (p) => impacts.push(p.clone()) });
    const camera = new THREE.PerspectiveCamera();
    let accP = 0;
    let prevP = 0;
    let dp0 = 0;
    let flapBack = 0;
    let prevU = 0;
    let wasAir = false;
    let glow = 0;
    let neck = 0;
    for (let k = 0; k < Math.round(o.seconds / DT); k++) {
      const t = k * DT;
      cam.pitch = o.pitchAt(t);
      const keys = t < 1 ? [] : t < 1.5 ? ['Space'] : t < o.climbUntil ? ['KeyW'] : o.keys(t);
      const press = (at(t, 1) ? ['Space'] : []).concat(o.fires.some((f) => at(t, f)) ? ['KeyF'] : []);
      const inp = input(keys, press);
      cam.update(inp, { ...cameraFollow(d, hold), flying: tb.flight.airborne }, DT);
      d.update({ input: inp, cameraYaw: cam.yaw, cameraPitch: cam.pitch, cameraPos: cam.position }, DT);
      const f = tb.flight;
      while (tb.plasma.shots.length) {
        const shot = tb.plasma.shots.shift()!;
        fired.push({
          // the path's velocity at the release (the recoil has since taken its bit of speed)
          shot, aim: tb.plasma.aimPoint.clone(), alt: f.pos.y, body: f.velocity(new THREE.Vector3()).setLength(f.speed + d.tuning.plasma.airRecoilSpeed),
          state: f.tuckW > 0.9 ? 'tuck' : f.glideW > 0.9 ? 'glide' : f.flapW > 0.9 ? 'flap' : f.phase,
        });
        fx.fire(shot);
      }
      fx.update(DT, camera, 1080);
      if (tb.plasma.air) {
        glow = Math.max(glow, tb.brain.face.state.plasmaGlow);
        neck = Math.max(neck, d.layers.weight('plasma_air_neck'));
      }
      const p = d.body.pose.pitch;
      if (k > 2 && f.phase === 'air') accP = Math.max(accP, Math.abs(p - prevP - dp0));
      dp0 = p - prevP;
      prevP = p;
      if (f.phase === 'air' && wasAir && f.flapW > 0.99) {
        const du = (f.flapU - prevU + 1) % 1;
        if (du > 0.05) flapBack++;                                  // the beat ran backwards or jumped
      }
      prevU = f.flapU;
      wasAir = f.phase === 'air';
    }
    return { d, tb, fired, impacts, accP, flapBack, glow, neck };
  }

  it('fires while gliding and in a tucked dive: the dive shot is faster, every bolt lands on its aim point', { timeout: 60_000 }, async () => {
    const r = await sortie({
      climbUntil: 11, seconds: 24, fires: [12.5, 17.5],
      keys: (t) => (t >= 15.5 && t < 20 ? ['ShiftLeft'] : []),
      pitchAt: (t) => deg(t < 11 ? -10 : t < 15.5 ? 22 : t < 20 ? 55 : 0),
    });
    expect(r.fired.map((f) => f.state)).toEqual(['glide', 'tuck']);
    const [glide, dive] = r.fired;
    // the bolt keeps the body's speed along the aim ray (to within a step of the path's change)
    for (const f of r.fired) expect(Math.abs(f.shot.speed! - r.d.tuning.plasma.boltSpeed - Math.max(0, f.shot.dir.dot(f.body)))).toBeLessThan(0.5);
    expect(dive.shot.speed!).toBeGreaterThan(glide.shot.speed!);
    expect(r.impacts.length).toBe(2);
    for (let k = 0; k < 2; k++) expect(r.impacts[k].distanceTo(r.fired[k].aim)).toBeLessThan(0.5);
    expect(r.glow).toBeGreaterThan(0.95);                          // the plates light on the wing too
    expect(r.neck).toBeCloseTo(r.d.tuning.plasma.airRear, 2);
    expect(r.d.layers.weight('plasma_air_face')).toBe(0);           // and it all lets go
    expect(r.d.layers.weight('plasma_rear')).toBe(0);               // never the standing rear
    expect(r.d.nanResets).toBe(0);
  });

  it('fires flapping without breaking the beat or popping the body', { timeout: 60_000 }, async () => {
    const r = await sortie({ climbUntil: 30, seconds: 14, fires: [6, 8, 10], keys: () => [], pitchAt: () => deg(-10) });
    expect(r.fired.map((f) => f.state)).toEqual(['flap', 'flap', 'flap']);
    expect(r.flapBack).toBe(0);
    expect(r.accP).toBeLessThan(0.02);                             // the recoil eases in and out
    expect(r.d.nanResets).toBe(0);
  });

  it('a level aim from 60 m up still reaches the ground and blasts where the camera aimed', { timeout: 60_000 }, async () => {
    const r = await sortie({ climbUntil: 22, seconds: 34, fires: [26], keys: () => [], pitchAt: (t) => deg(t < 22 ? -10 : 18) });
    expect(r.fired.length).toBe(1);
    expect(r.fired[0].alt).toBeGreaterThan(60);
    expect(r.fired[0].aim.y).toBeLessThan(0.5);                    // the aim ray found the ground
    expect(r.impacts.length).toBe(1);
    // ~200 m away at a grazing ~17°: the bolt's sphere (boltRadius) touches the ground ~r / sin 17° short of the point
    expect(r.impacts[0].distanceTo(r.fired[0].aim)).toBeLessThan(1);
  });
});
