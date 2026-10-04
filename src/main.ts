import './styles.css';
import * as THREE from 'three';
import { createApp } from './app/createApp';
import { createTestScene } from './world/testScene';
import { debug } from './core/debug';
import { KeyboardMouseInput } from './core/input';
import { CollisionWorld } from './world/collision';
import { loadDragonAsset } from './characters/dragon/asset';
import { DRAGON_MATERIAL_NAMES } from './characters/dragon/materials';
import { DragonCharacter } from './characters/dragon/motion/dragon';
import { loadPosesMeta } from './characters/dragon/motion/poseLayers';
import { loadTuning } from './characters/dragon/motion/tuning';
import { OrbitCamera } from './camera/orbitCamera';
import { applyDitherFade, dragonFade } from './characters/dragon/fade';
import { cameraFollow } from './dev/lab/labRunner';

const app = createApp(document.getElementById('app')!);
const test = createTestScene();
app.add(test.root);
app.loop.addSim(() => test.update(app.loop.simTime));
const world = CollisionWorld.fromObjects([test.root]); // the swatches are solid: he walks around them or is blocked
const hud = document.getElementById('hud')!;
hud.textContent = 'Loading Toothless…';

async function start(): Promise<void> {
  const [asset, posesMeta, tuning] = await Promise.all([
    loadDragonAsset({
      glbUrl: 'assets/characters/toothless/toothless.glb', posesUrl: 'assets/characters/toothless/toothless.poses.glb',
      rigUrl: 'assets/characters/toothless/toothless.rig.json', sunDir: app.lighting.sunDir, prepare: (m) => app.materials.prepare(m),
    }),
    loadPosesMeta('assets/characters/toothless/toothless.poses.json'),
    loadTuning(),
  ]);
  applyDitherFade(DRAGON_MATERIAL_NAMES.map((n) => asset.materials.byName(n)!));
  app.add(asset.root);
  const dragon = new DragonCharacter({ rig: asset.rig, world, tuning, clips: asset.clips, posesMeta, seed: 1 });
  dragon.spawn(0, 6, Math.PI);
  const cam = new OrbitCamera(tuning.camera, world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(dragon, hold));
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
  });
  app.loop.addRender((alpha) => {
    dragon.writeTo(asset.bones, alpha);
    dragonFade.value = cam.fade;
    app.camera.position.lerpVectors(prevCam, curCam, alpha);
    app.camera.lookAt(cam.target);
  }, 0);

  // [yaw from his heading (rad), pitch (deg), distance (m)]. They move the follow camera, which keeps following from
  // there; the controls are camera-relative, so walking on steers him away from it, and it recentres behind him.
  const PRESETS: Record<string, [number, number, number]> = { hero: [2.4, 12, 6], side: [Math.PI / 2, 8, 7], low: [2.8, 2, 5], wide: [2.6, 25, 16] };
  debug.register(null, {
    tp: (x: number, z: number, heading = dragon.kin.heading) => {
      dragon.spawn(x, z, heading);
      cam.reset(cameraFollow(dragon, hold));
      prevCam.copy(cam.position);
      curCam.copy(cam.position);
    },
    /** Where he is and what he is doing (for scripted play-checks). */
    state: () => ({
      pos: dragon.kin.pos.toArray().map((v) => +v.toFixed(3)), heading: +dragon.kin.heading.toFixed(3),
      speed: +dragon.kin.speed.toFixed(2), prowl: dragon.controller.prowl, climb: dragon.climb.mode, fade: +cam.fade.toFixed(2),
    }),
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
  hud.textContent = `Isle of Berk · click to control · WASD move · Shift gallop · C prowl · mouse look · wheel zoom · quality: ${app.preset.name}`;
}

start().catch((e) => {
  console.error('[game] Toothless failed to load', e);
  hud.textContent = 'Toothless failed to load — see the console';
});
app.loop.start();
