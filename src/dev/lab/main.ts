import '../../styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createApp } from '../../app/createApp';
import { buildCourse } from './course';
import { captureFilmstrip, showOverlay, hideOverlay } from '../filmstrip';
import { debug } from '../../core/debug';
import { KeyboardMouseInput, ScriptedInput, type InputSource } from '../../core/input';
import { CollisionWorld } from '../../world/collision';
import { loadDragonAsset } from '../../characters/dragon/asset';
import { DRAGON_MATERIAL_NAMES } from '../../characters/dragon/materials';
import { DragonCharacter } from '../../characters/dragon/motion/dragon';
import { loadPosesMeta } from '../../characters/dragon/motion/poseLayers';
import { loadTuning, type MotionTuning } from '../../characters/dragon/motion/tuning';
import { OrbitCamera } from '../../camera/orbitCamera';
import { applyDitherFade, dragonFade } from '../../characters/dragon/fade';
import { MotionOverlays, OVERLAY_NAMES, type OverlayName } from './overlays';
import { LAB_SCRIPTS, scriptByName } from './scripts';
import { cameraFollow, runLabScript } from './labRunner';

const app = createApp(document.getElementById('app')!);
const course = buildCourse();
app.add(course.root);
const world = CollisionWorld.fromObjects(course.surfaces);

const grid = new THREE.GridHelper(160, 160, 0x445566, 0x2b3440);
grid.position.y = 0.01;
grid.material.fog = false; // a dev overlay: keep it crisp under scene.fog (the N8AO fog proxy)
app.scene.add(grid); // exempt from the material pipeline (Ruling 3)

app.camera.position.set(0, 18, 38);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
controls.target.set(0, 0, 0);
app.loop.addRender(() => {
  if (controls.enabled) controls.update();
}, 0);

const renderOnce = () => app.post.render(0);
const gui = new GUI({ title: 'Motion Lab' });
const loopUi = {
  pause: () => app.loop.pause(),
  play: () => app.loop.resume(),
  step1: () => app.loop.step(1),
  step10: () => app.loop.step(10),
};
const fl = gui.addFolder('Loop');
fl.add(loopUi, 'pause');
fl.add(loopUi, 'play');
fl.add(loopUi, 'step1').name('step 1');
fl.add(loopUi, 'step10').name('step 10');

const sunUi = { azimuth: app.lighting.params.azimuth, elevation: app.lighting.params.elevation };
const fs = gui.addFolder('Sun');
fs.add(sunUi, 'azimuth', 0, 360, 1).onFinishChange(() => app.setSun(sunUi.azimuth, sunUi.elevation));
fs.add(sunUi, 'elevation', 1, 89, 0.5).onFinishChange(() => app.setSun(sunUi.azimuth, sunUi.elevation));

const postUi = { exposure: app.renderer.toneMappingExposure, grid: true };
const fp = gui.addFolder('View');
fp.add(postUi, 'exposure', 0.2, 3, 0.01).onChange((v: number) => { app.renderer.toneMappingExposure = v; });
fp.add(postUi, 'grid').onChange((v: boolean) => { grid.visible = v; });

debug.register('lab', {
  filmstrip(frames = 12, stepsBetween = 10, columns = 6, thumbWidth = 320) {
    const wasPaused = app.loop.isPaused;
    app.loop.pause();
    const strip = captureFilmstrip(
      { frames, stepsBetween, columns, thumbWidth },
      (n) => app.loop.step(n),
      renderOnce,
      app.renderer.domElement,
    );
    showOverlay(strip);
    if (!wasPaused) app.loop.resume();
    return { width: strip.width, height: strip.height };
  },
  closeOverlay: hideOverlay,
  surfaces: () => course.surfaces.map((m) => m.name),
});

const hud = document.getElementById('hud')!;
hud.textContent = `Motion Lab · loading Toothless… · quality: ${app.preset.name}`;

async function startToothless(): Promise<void> {
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
  dragon.spawn(0, 0, 0);
  const cam = new OrbitCamera(tuning.camera, world);
  const hold = { chest: new THREE.Vector3() };
  cam.reset(cameraFollow(dragon, hold));
  const overlays = new MotionOverlays();
  app.scene.add(overlays.root); // dev overlay: exempt from the material pipeline (Ruling 3)
  const canvas = app.renderer.domElement;
  const live = new KeyboardMouseInput(window, () => document.pointerLockElement === canvas);
  let source: InputSource = live;
  let scripted: ScriptedInput | null = null;
  let yawPx = 0;
  const view = { follow: true };
  canvas.addEventListener('click', () => {
    if (view.follow) void canvas.requestPointerLock();
  });
  const prevCam = new THREE.Vector3();
  const curCam = new THREE.Vector3();
  /** berk.cam.orbit: hold the follow camera at an angle to his heading (side views for film strips). */
  const hold3 = { on: false, az: 0, el: 0, dist: 0 };

  app.loop.addSim((dt) => {
    const inp = source.sample(app.loop.simTime);
    if (scripted?.done) {
      source = live;
      scripted = null;
      yawPx = 0;
    }
    if (hold3.on) {
      cam.yaw = dragon.kin.heading + THREE.MathUtils.degToRad(hold3.az);
      cam.pitch = THREE.MathUtils.degToRad(hold3.el);
      cam.distance = hold3.dist;
    }
    prevCam.copy(cam.position);
    cam.update({ mouseDX: inp.mouseDX + yawPx, mouseDY: inp.mouseDY, wheel: inp.wheel }, cameraFollow(dragon, hold), dt);
    curCam.copy(cam.position);
    dragon.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
  });
  app.loop.addRender((alpha) => {
    dragon.writeTo(asset.bones, alpha);
    dragonFade.value = cam.fade;
    if (view.follow) {
      app.camera.position.lerpVectors(prevCam, curCam, alpha);
      app.camera.lookAt(cam.target);
    }
    overlays.update(dragon);
  }, 0);

  const fc = gui.addFolder('Toothless');
  fc.add(view, 'follow').name('follow camera').onChange((v: boolean) => {
    controls.enabled = !v;
    if (!v) {
      controls.target.copy(cam.target); // free orbit starts around him
      controls.update();
    }
  });
  controls.enabled = !view.follow;
  const ft = gui.addFolder('Tuning').close();
  for (const [section, values] of Object.entries(tuning) as Array<[keyof MotionTuning, Record<string, unknown>]>) {
    const f = ft.addFolder(section).close();
    for (const [k, v] of Object.entries(values)) if (typeof v === 'number') f.add(values, k);
  }

  debug.register('lab', {
    run: (name: string) => runLabScript({ rig: asset.rig, world, script: scriptByName(name), tuning, clips: asset.clips, posesMeta }),
    runAll: () => Object.fromEntries(LAB_SCRIPTS.map((s) => [s.name, runLabScript({ rig: asset.rig, world, script: s, tuning, clips: asset.clips, posesMeta })])),
    play: (name: string) => {
      const s = scriptByName(name);
      dragon.controller.prowl = false; // a script's C press toggles from trot, as in the headless runner
      dragon.spawn(s.spawn.x, s.spawn.z, s.spawn.heading);
      cam.reset(cameraFollow(dragon, hold));
      scripted = new ScriptedInput(s.events.map((e) => ({ ...e, t: e.t + app.loop.simTime })));
      source = scripted;
      yawPx = s.cameraYawRate ? -(s.cameraYawRate / 120) / tuning.camera.sensitivity : 0;
      return s.description;
    },
    scripts: () => LAB_SCRIPTS.map((s) => `${s.name}: ${s.description}`),
    tuning: () => JSON.stringify(tuning, null, 1),
  });
  debug.register(null, {
    tp: (x: number, z: number, heading = dragon.kin.heading) => {
      dragon.spawn(x, z, heading);
      cam.reset(cameraFollow(dragon, hold));
    },
    toggle: (name: OverlayName) => (OVERLAY_NAMES.includes(name) ? overlays.toggle(name) : OVERLAY_NAMES),
  });
  debug.register('cam', {
    /** Hold the follow camera at azimuth `az` (deg, relative to his heading; 90 = his right side), elevation `el` (deg) and `dist` (m). */
    orbit: (az: number, el: number, dist: number) => {
      Object.assign(hold3, { on: true, az, el, dist });
      return hold3;
    },
    /** Back to the free follow camera (mouse orbit, auto-recentre). */
    free: () => {
      hold3.on = false;
    },
  });
  hud.textContent = `Motion Lab · click to drive · WASD move · Shift gallop · C prowl · mouse look · wheel zoom · berk.lab.scripts() · quality: ${app.preset.name}`;
}

startToothless().catch((e) => {
  console.error('[lab] Toothless failed to load', e);
  hud.textContent = 'Motion Lab · Toothless failed to load — see the console';
});
app.loop.start();
