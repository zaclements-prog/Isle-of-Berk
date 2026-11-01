import * as THREE from 'three';
import type { App } from '../../app/createApp';
import { debug } from '../../core/debug';
import { KeyboardMouseInput } from '../../core/input';
import { OrbitCamera } from '../../camera/orbitCamera';
import { cameraFollow } from '../../dev/lab/labRunner';
import { PlasmaFx } from '../../fx/plasmaFx';
import type { CollisionWorld, RayHit } from '../../world/collision';
import type { WorldEvents } from '../../world/events';
import type { ForceSource } from '../../world/forceField';
import { loadDragonAsset, type DragonAsset } from './asset';
import { dragonLook } from './facet';
import type { InterestPoint } from './behaviour/attention';
import { applyExpression } from './face/expression';
import { applyDitherFade, dragonFade } from './fade';
import { DRAGON_MATERIAL_NAMES } from './materials';
import { DragonCharacter } from './motion/dragon';
import { loadPosesMeta } from './motion/poseLayers';
import { loadTuning } from './motion/tuning';
import { createToothlessBrain, type ToothlessBrain } from './toothlessBrain';

export interface ToothlessOptions {
  app: App;
  world: CollisionWorld;
  spawn: { x: number; z: number; heading: number };
  /** Live interest lists — e.g. a region's `interestPoints` (read every step, never copied). */
  interest?: ReadonlyArray<ReadonlyArray<InterestPoint>>;
  /** Also show the model through the pond's underwater pass (Plan 5a LAYER_UNDERWATER). */
  extraLayers?: number[];
  /** The world's events bus: each plasma impact is published as a `blast`. */
  events?: WorldEvents;
  seed?: number;
}

export interface Toothless extends ToothlessBrain {
  readonly asset: DragonAsset;
  readonly dragon: DragonCharacter;
  readonly cam: OrbitCamera;
  readonly fx: PlasmaFx;
  /** What the force field reads from him (flying, chest, velocity, the ground under him, the wings' push). */
  forceSource(ground: (x: number, z: number) => number): ForceSource;
  /** Teleport (and re-seat the camera). */
  tp(x: number, z: number, heading?: number): void;
}

const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _dir = new THREE.Vector3();

/**
 * Toothless on a page (the game, the Cove, the lab): the asset with its film materials, the motion core (Plan 3) with
 * the M6 brain (behaviours, face, jump, plasma), the orbit camera, the plasma FX and the per-frame expression binder.
 * Plasma aims along the camera: the first surface under the view centre, else 120 m out. Registers berk.tp,
 * berk.behaviour, berk.state, berk.toothless.{mood, face, posture, fire, fireHold, release, fireKey, charge, jump} and berk.cam.preset.
 */
export async function createToothless(o: ToothlessOptions): Promise<Toothless> {
  const { app, world } = o;
  const [asset, posesMeta, tuning] = await Promise.all([
    loadDragonAsset({
      glbUrl: 'assets/characters/toothless/toothless.glb', posesUrl: 'assets/characters/toothless/toothless.poses.glb',
      rigUrl: 'assets/characters/toothless/toothless.rig.json', sunDir: app.lighting.sunDir, prepare: (m) => app.materials.prepare(m), look: dragonLook(location.search),
    }),
    loadPosesMeta('assets/characters/toothless/toothless.poses.json'),
    loadTuning(),
  ]);
  applyDitherFade(DRAGON_MATERIAL_NAMES.map((n) => asset.materials.byName(n)!));
  for (const l of o.extraLayers ?? []) asset.root.traverse((obj) => obj.layers.enable(l));
  app.add(asset.root);
  const dragon = new DragonCharacter({ rig: asset.rig, world, tuning, clips: asset.clips, posesMeta, seed: o.seed ?? 1 });
  dragon.spawn(o.spawn.x, o.spawn.z, o.spawn.heading);
  const cam = new OrbitCamera(tuning.camera, world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(dragon, hold));
  // the aim ray reaches as far as a bolt flies (plasma.boltRange): from 60 m up a shallow aim still finds the ground
  const reach = tuning.plasma.boltRange;
  const aimAt = (_d: DragonCharacter, out: THREE.Vector3): THREE.Vector3 => {
    _dir.subVectors(cam.target, cam.position).normalize();
    const hit = world.raycast(cam.position, _dir, reach, _hit);
    return hit ? out.copy(hit.point) : out.copy(cam.position).addScaledVector(_dir, reach);
  };
  const tb = createToothlessBrain(dragon, asset.rig, { seed: o.seed ?? 1, sunDir: app.lighting.sunDir, aimAt });
  for (const list of o.interest ?? []) tb.brain.interest.addList(list);
  const fx = new PlasmaFx({
    world, cfg: tuning.plasma, prepare: (m) => app.materials.prepare(m),
    shake: (a, t) => cam.shake(a, t), seed: o.seed ?? 1,
    // a shot's power (the quick fire's small one, the long fire's charged one) scales the blast and its radius
    onImpact: (point, normal, power) => o.events?.emit({
      type: 'blast', point: point.clone(), normal: normal.clone(), power: tuning.plasma.blastPower * power,
      radius: tuning.plasma.blastRadius * tuning.plasma.blastPower * power, time: app.loop.simTime,
    }),
  });
  app.scene.add(fx.root);
  const canvas = app.renderer.domElement;
  const input = new KeyboardMouseInput(window, () => document.pointerLockElement === canvas);
  canvas.addEventListener('click', () => void canvas.requestPointerLock());
  const reticle = createReticle(canvas.parentElement);
  /**
   * A review camera (berk.cam.review): the camera recentres review.yaw off his heading and the controls read its yaw
   * less that offset, so it can watch him from the side while he flies (or walks) as if it were behind him.
   */
  const review = { yaw: 0 };
  const follow = () => {
    const f = cameraFollow(dragon, hold);
    return { ...f, heading: f.heading + review.yaw, flying: tb.flight.airborne };
  };
  const prevCam = new THREE.Vector3().copy(cam.position);
  const curCam = new THREE.Vector3().copy(cam.position);
  app.loop.addSim((dt) => {
    const inp = input.sample();
    prevCam.copy(cam.position);
    cam.update(inp, follow(), dt);
    curCam.copy(cam.position);
    dragon.update({ input: inp, cameraYaw: cam.yaw - review.yaw, cameraPitch: cam.pitch, cameraPos: cam.position }, dt);
    while (tb.plasma.shots.length) fx.fire(tb.plasma.shots.shift()!);
  });
  // the long fire's glow gathering at his mouth: placed by the rendered (interpolated) bones, so it never lags him
  const muzzle = tb.plasma.mouthAnchor(dragon);
  const muzzleBone = asset.bones.get(muzzle.bone);
  const muzzleAt = new THREE.Vector3();
  app.loop.addRender((alpha, frameDt) => {
    dragon.writeTo(asset.bones, alpha);
    const p = tb.plasma;
    const charging = p.phase === 'charge' || p.phase === 'turn';
    if (muzzleBone && charging) {
      muzzleBone.updateWorldMatrix(true, false);
      fx.charging(muzzleBone.localToWorld(muzzleAt.copy(muzzle.local)), p.glow ?? 0, p.charge);
    } else fx.charging(null, 0, 0);
    applyExpression(asset, tb.brain.face.state);
    tb.plasma.sweep(asset.materials.uniforms.plasmaSweep.value);
    dragonFade.value = cam.fade;
    app.camera.position.lerpVectors(prevCam, curCam, alpha);
    app.camera.lookAt(cam.target);
    fx.update(frameDt, app.camera, canvas.height);
    reticle?.update(document.pointerLockElement === canvas, tb.flight.airborne, tb.plasma.phase === 'charge');
  }, 0);
  const tp = (x: number, z: number, heading = dragon.kin.heading) => {
    dragon.spawn(x, z, heading);
    tb.brain.reset(); // no gesture, jump or blast carries over to the new spot
    cam.reset(cameraFollow(dragon, hold));
    prevCam.copy(cam.position);
    curCam.copy(cam.position);
  };
  const PRESETS: Record<string, [number, number, number]> = { hero: [2.4, 12, 6], side: [Math.PI / 2, 8, 7], low: [2.8, 2, 5], wide: [2.6, 25, 16], face: [3.0, 6, 3] };
  debug.register(null, {
    tp,
    behaviour: (name: string) => tb.brain.behaviour(name),
    /** Where he is and what he is doing (for scripted play-checks). */
    state: () => ({
      pos: dragon.kin.pos.toArray().map((v) => +v.toFixed(3)), heading: +dragon.kin.heading.toFixed(3),
      speed: +dragon.kin.speed.toFixed(2), prowl: dragon.controller.prowl, climb: dragon.climb.mode,
      posture: tb.brain.behaviours.posture.current, jump: tb.jump.phase, plasma: tb.plasma.phase, fade: +cam.fade.toFixed(2),
      flight: tb.flight.phase, altitude: +tb.flight.pos.y.toFixed(2),
    }),
  });
  /** A key tap through the real input path (the controller reads it next step). */
  const keyHold = (code: string, seconds: number) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), seconds * 1000);
  };
  const tap = (code: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 60);
  };
  debug.register('toothless', {
    mood: () => ({ ...tb.brain.face.state.mood }),
    face: () => ({ ...tb.brain.face.state, mood: undefined }),
    posture: () => tb.brain.behaviours.posture.current,
    /** Quick fire: a tap of F (a small shot). */
    fire: () => tap('KeyF'),
    /**
     * Long fire on simulation time (works paused, with berk.step): hold for `seconds` (default: until it fires itself
     * at full charge); released sooner it fires with the charge so far. A charge's state: berk.toothless.charge().
     */
    fireHold: (seconds = Infinity) => tb.plasma.press(seconds),
    /** Let a fireHold go (it fires with the charge so far). */
    release: () => tb.plasma.release(),
    /** Long fire through the real input path, on wall-clock time: F held down for `seconds`. */
    fireKey: (seconds = 2.2) => keyHold('KeyF', seconds),
    charge: () => ({
      phase: tb.plasma.phase, held: +tb.plasma.held.toFixed(3), charge: +tb.plasma.charge.toFixed(3),
      glow: tb.plasma.glow === null ? null : +tb.plasma.glow.toFixed(3), fired: tb.plasma.fired,
      lastCharge: +tb.plasma.lastCharge.toFixed(3), lastPower: +tb.plasma.lastPower.toFixed(3),
    }),
    jump: () => tap('Space'),
  });
  debug.register('cam', {
    preset(name: string) {
      const p = PRESETS[name];
      if (!p) return Object.keys(PRESETS);
      cam.yaw = dragon.kin.heading + p[0];
      cam.pitch = THREE.MathUtils.degToRad(p[1]);
      cam.distance = p[2];
      return name;
    },
    /** Review camera (deg): it sits this far round from behind him; the controls still steer as if from behind. */
    review(yawDeg: number) {
      review.yaw = THREE.MathUtils.degToRad(yawDeg);
      cam.yaw = dragon.kin.heading + review.yaw;
    },
    /** Aim the camera (deg): yaw relative to his heading, pitch (+ from above); the flight steers by it. */
    aim(yawDeg: number, pitchDeg?: number) {
      cam.yaw = dragon.kin.heading + THREE.MathUtils.degToRad(yawDeg);
      if (pitchDeg !== undefined) cam.pitch = THREE.MathUtils.degToRad(pitchDeg);
    },
  });
  const src: ForceSource = { airborne: false, chest: new THREE.Vector3(), velocity: new THREE.Vector3(), ground: 0, wingPush: 0 };
  const forceSource = (ground: (x: number, z: number) => number): ForceSource => {
    const f = tb.flight;
    src.airborne = f.airborne;
    dragon.chestPos(src.chest);
    src.velocity.copy(dragon.kin.velocity);
    src.ground = ground(src.chest.x, src.chest.z);
    // the wings push hardest mid-downstroke (the flap's first ~half beat), a glide only a little; the takeoff and the
    // landing are all big strokes
    const down = Math.max(0, Math.sin((Math.PI * (f.flapU % 1)) / 0.52)) * ((f.flapU % 1) < 0.52 ? 1 : 0);
    src.wingPush = f.phase === 'takeoff' || f.phase === 'landing' ? 0.85 : f.flapW * down + f.glideW * 0.25;
    return src;
  };
  return { ...tb, asset, dragon, cam, fx, tp, forceSource };
}

/**
 * The aim reticle: a small ring at the screen centre, where the camera's aim ray (and so the plasma) goes. Shown while
 * the pointer is locked (in control): faint on the ground, clearer on the wing (there the camera is well behind him
 * and the aim is not on his head), and tightening in plasma blue while he charges.
 */
function createReticle(parent: HTMLElement | null): { update(locked: boolean, flying: boolean, charging: boolean): void } | null {
  if (!parent || typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.className = 'berk-reticle';
  Object.assign(el.style, {
    position: 'absolute', left: '50%', top: '50%', width: '18px', height: '18px', margin: '-10px 0 0 -10px',
    border: '1.5px solid rgba(235, 242, 248, 0.85)', borderRadius: '50%', pointerEvents: 'none', opacity: '0',
    boxShadow: '0 0 0 1px rgba(8, 14, 22, 0.35), inset 0 0 0 1px rgba(8, 14, 22, 0.25)',
    transition: 'opacity 0.25s, transform 0.12s, border-color 0.12s',
  } satisfies Partial<CSSStyleDeclaration>);
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'absolute', left: '50%', top: '50%', width: '3px', height: '3px', margin: '-1.5px 0 0 -1.5px',
    borderRadius: '50%', background: 'rgba(235, 242, 248, 0.95)',
  } satisfies Partial<CSSStyleDeclaration>);
  el.appendChild(dot);
  parent.appendChild(el);
  let last = '';
  return {
    update(locked, flying, charging) {
      const key = `${locked}${flying}${charging}`;
      if (key === last) return;
      last = key;
      el.style.opacity = !locked ? '0' : flying || charging ? '0.9' : '0.4';
      el.style.transform = charging ? 'scale(0.7)' : 'scale(1)';
      el.style.borderColor = charging ? 'rgba(140, 190, 255, 0.95)' : 'rgba(235, 242, 248, 0.85)';
    },
  };
}
