import * as THREE from 'three';
import type { App } from '../../app/createApp';
import { debug } from '../../core/debug';
import { KeyboardMouseInput } from '../../core/input';
import { OrbitCamera } from '../../camera/orbitCamera';
import { cameraFollow } from '../../dev/lab/labRunner';
import { PlasmaFx } from '../../fx/plasmaFx';
import type { CollisionWorld, RayHit } from '../../world/collision';
import { loadDragonAsset, type DragonAsset } from './asset';
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
  seed?: number;
}

export interface Toothless extends ToothlessBrain {
  readonly asset: DragonAsset;
  readonly dragon: DragonCharacter;
  readonly cam: OrbitCamera;
  readonly fx: PlasmaFx;
  /** Teleport (and re-seat the camera). */
  tp(x: number, z: number, heading?: number): void;
}

const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
const _dir = new THREE.Vector3();

/**
 * Toothless on a page (the game, the Cove, the lab): the asset with its film materials, the motion core (Plan 3) with
 * the M6 brain (behaviours, face, jump, plasma), the orbit camera, the plasma FX and the per-frame expression binder.
 * Plasma aims along the camera: the first surface under the view centre, else 120 m out. Registers berk.tp,
 * berk.behaviour, berk.state, berk.toothless.{mood, face, posture, fire, jump} and berk.cam.preset.
 */
export async function createToothless(o: ToothlessOptions): Promise<Toothless> {
  const { app, world } = o;
  const [asset, posesMeta, tuning] = await Promise.all([
    loadDragonAsset({
      glbUrl: 'assets/characters/toothless/toothless.glb', posesUrl: 'assets/characters/toothless/toothless.poses.glb',
      rigUrl: 'assets/characters/toothless/toothless.rig.json', sunDir: app.lighting.sunDir, prepare: (m) => app.materials.prepare(m),
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
  const aimAt = (_d: DragonCharacter, out: THREE.Vector3): THREE.Vector3 => {
    _dir.subVectors(cam.target, cam.position).normalize();
    const hit = world.raycast(cam.position, _dir, 120, _hit);
    return hit ? out.copy(hit.point) : out.copy(cam.position).addScaledVector(_dir, 120);
  };
  const tb = createToothlessBrain(dragon, asset.rig, { seed: o.seed ?? 1, sunDir: app.lighting.sunDir, aimAt });
  for (const list of o.interest ?? []) tb.brain.interest.addList(list);
  const fx = new PlasmaFx({
    world, cfg: tuning.plasma, prepare: (m) => app.materials.prepare(m),
    shake: (a, t) => cam.shake(a, t), seed: o.seed ?? 1,
  });
  app.scene.add(fx.root);
  const canvas = app.renderer.domElement;
  const input = new KeyboardMouseInput(window, () => document.pointerLockElement === canvas);
  canvas.addEventListener('click', () => void canvas.requestPointerLock());
  const prevCam = new THREE.Vector3().copy(cam.position);
  const curCam = new THREE.Vector3().copy(cam.position);
  app.loop.addSim((dt) => {
    const inp = input.sample();
    prevCam.copy(cam.position);
    cam.update(inp, cameraFollow(dragon, hold), dt);
    curCam.copy(cam.position);
    dragon.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
    while (tb.plasma.shots.length) fx.fire(tb.plasma.shots.shift()!);
  });
  app.loop.addRender((alpha, frameDt) => {
    dragon.writeTo(asset.bones, alpha);
    applyExpression(asset, tb.brain.face.state);
    dragonFade.value = cam.fade;
    app.camera.position.lerpVectors(prevCam, curCam, alpha);
    app.camera.lookAt(cam.target);
    fx.update(frameDt, app.camera, canvas.height);
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
    }),
  });
  /** A key tap through the real input path (the controller reads it next step). */
  const tap = (code: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 60);
  };
  debug.register('toothless', {
    mood: () => ({ ...tb.brain.face.state.mood }),
    face: () => ({ ...tb.brain.face.state, mood: undefined }),
    posture: () => tb.brain.behaviours.posture.current,
    fire: () => tap('KeyF'),
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
  });
  return { ...tb, asset, dragon, cam, fx, tp };
}
