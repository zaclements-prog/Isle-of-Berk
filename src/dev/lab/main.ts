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
import { createToothlessBrain } from '../../characters/dragon/toothlessBrain';
import { applyExpression } from '../../characters/dragon/face/expression';
import { PlasmaFx } from '../../fx/plasmaFx';
import { M6_SCRIPTS, runM6Script } from './m6Scripts';

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

const renderOnce = () => app.loop.step(0); // every render callback (his bones, the view), then the frame
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
  // M6: the brain (behaviours, face, jump, plasma) and the plasma FX. Plasma aims along the camera like the game page,
  // unless a playing M6 script names its aim point.
  const aimDir = new THREE.Vector3();
  const aimHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  let scriptAim: THREE.Vector3 | null = null;
  let scriptEnd = -1;
  let queue: Array<{ t: number; name: string }> = [];
  const tb = createToothlessBrain(dragon, asset.rig, {
    seed: 1, sunDir: app.lighting.sunDir,
    aimAt: (_d, out) => {
      if (scriptAim) return out.copy(scriptAim);
      aimDir.subVectors(cam.target, cam.position).normalize();
      const hit = world.raycast(cam.position, aimDir, 120, aimHit);
      return hit ? out.copy(hit.point) : out.copy(cam.position).addScaledVector(aimDir, 120);
    },
  });
  const fx = new PlasmaFx({
    world, cfg: tuning.plasma, prepare: (m) => app.materials.prepare(m),
    shake: (a, t) => cam.shake(a, t), seed: 1,
  });
  app.scene.add(fx.root);
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
  /**
   * berk.cam.orbit: view him from a fixed angle to his heading (side views for film strips). View only: the controls
   * are camera-relative, so they keep reading the follow camera, as in the headless runner.
   */
  const hold3 = { on: false, az: 0, el: 0, dist: 0 };
  const viewPos = (out: THREE.Vector3): THREE.Vector3 => {
    if (!hold3.on) return out.copy(cam.position);
    const yaw = dragon.kin.heading + THREE.MathUtils.degToRad(hold3.az);
    const el = THREE.MathUtils.degToRad(hold3.el);
    // the follow camera's own convention: it sits behind its forward yaw
    out.set(-Math.sin(yaw) * Math.cos(el), Math.sin(el), -Math.cos(yaw) * Math.cos(el));
    return out.multiplyScalar(hold3.dist).add(cam.target);
  };
  /** Jump the view to where it should be now (after a respawn or a view change), with no interpolation from before. */
  const snapView = () => curCam.copy(viewPos(prevCam));

  app.loop.addSim((dt) => {
    const inp = source.sample(app.loop.simTime);
    if (scripted?.done) {
      source = live;
      scripted = null;
      yawPx = 0;
    }
    while (queue.length && queue[0].t <= app.loop.simTime) tb.brain.behaviour(queue.shift()!.name);
    if (app.loop.simTime > scriptEnd) {                      // an M6 script's aim and quiet selector last its duration
      scriptAim = null;
      tb.brain.behaviours.autonomous = true;
    }
    viewPos(prevCam);
    cam.update({ mouseDX: inp.mouseDX + yawPx, mouseDY: inp.mouseDY, wheel: inp.wheel }, cameraFollow(dragon, hold), dt);
    viewPos(curCam);
    dragon.update({ input: inp, cameraYaw: cam.yaw, cameraPos: cam.position }, dt);
    while (tb.plasma.shots.length) fx.fire(tb.plasma.shots.shift()!);
  });
  app.loop.addRender((alpha, frameDt) => {
    dragon.writeTo(asset.bones, alpha);
    applyExpression(asset, tb.brain.face.state);
    dragonFade.value = hold3.on ? 0 : cam.fade;
    if (view.follow) {
      app.camera.position.lerpVectors(prevCam, curCam, alpha);
      app.camera.lookAt(cam.target);
    }
    overlays.update(dragon);
    fx.update(frameDt, app.camera, canvas.height);
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
    run: (name: string) => {
      const m6 = M6_SCRIPTS.find((x) => x.name === name);
      const o = { rig: asset.rig, world, tuning, clips: asset.clips, posesMeta };
      return m6 ? runM6Script({ ...o, script: m6 }) : runLabScript({ ...o, script: scriptByName(name) });
    },
    runAll: () => Object.fromEntries([
      ...LAB_SCRIPTS.map((s) => [s.name, runLabScript({ rig: asset.rig, world, script: s, tuning, clips: asset.clips, posesMeta })]),
      ...M6_SCRIPTS.map((s) => [s.name, runM6Script({ rig: asset.rig, world, script: s, tuning, clips: asset.clips, posesMeta })]),
    ]),
    play: (name: string) => {
      const m6 = M6_SCRIPTS.find((x) => x.name === name);
      const s = m6 ?? scriptByName(name);
      dragon.controller.prowl = false; // a script's C press toggles from trot, as in the headless runner
      dragon.spawn(s.spawn.x, s.spawn.z, s.spawn.heading);
      cam.reset(cameraFollow(dragon, hold));
      snapView();
      tb.brain.reset();
      tb.brain.behaviours.autonomous = m6?.autonomous ?? true;
      queue = (m6?.behaviours ?? []).map((b) => ({ t: b.t + app.loop.simTime, name: b.name })).sort((a, b) => a.t - b.t);
      scriptAim = m6?.aim ? new THREE.Vector3(...m6.aim) : null;
      scriptEnd = app.loop.simTime + s.duration;
      scripted = new ScriptedInput(s.events.map((e) => ({ ...e, t: e.t + app.loop.simTime })));
      source = scripted;
      yawPx = s.cameraYawRate ? -(s.cameraYawRate / 120) / tuning.camera.sensitivity : 0;
      return s.description;
    },
    scripts: () => [...LAB_SCRIPTS, ...M6_SCRIPTS].map((s) => `${s.name}: ${s.description}`),
    /** Where he is and what he is doing, for checking a play against the headless run. */
    state: () => ({
      pos: dragon.kin.pos.toArray().map((v) => +v.toFixed(3)), heading: +dragon.kin.heading.toFixed(3),
      speed: +dragon.kin.speed.toFixed(2), climb: dragon.climb.mode,
    }),
    tuning: () => JSON.stringify(tuning, null, 1),
  });
  debug.register(null, {
    tp: (x: number, z: number, heading = dragon.kin.heading) => {
      dragon.spawn(x, z, heading);
      cam.reset(cameraFollow(dragon, hold));
      snapView();
    },
    toggle: (name: OverlayName) => (OVERLAY_NAMES.includes(name) ? overlays.toggle(name) : OVERLAY_NAMES),
    behaviour: (name: string) => tb.brain.behaviour(name),
  });
  debug.register('cam', {
    /** View him from azimuth `az` (deg, relative to his heading; 90 = his right side), elevation `el` (deg) and `dist` (m). */
    orbit: (az: number, el: number, dist: number) => {
      Object.assign(hold3, { on: true, az, el, dist });
      snapView();
      return hold3;
    },
    /** Back to the free follow camera (mouse orbit, auto-recentre). */
    free: () => {
      hold3.on = false;
      snapView();
    },
  });
  hud.textContent = `Motion Lab · click to drive · WASD move · Shift gallop · C prowl · mouse look · wheel zoom · berk.lab.scripts() · quality: ${app.preset.name}`;
}

startToothless().catch((e) => {
  console.error('[lab] Toothless failed to load', e);
  hud.textContent = 'Motion Lab · Toothless failed to load — see the console';
});
app.loop.start();
