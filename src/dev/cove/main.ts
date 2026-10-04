import '../../styles.css';
import type * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createApp } from '../../app/createApp';
import { createCove, type CoveRegion } from '../../world/cove/cove';
import { debug } from '../../core/debug';

/** Cove preview (dev page): orbit camera, fixed QA camera presets, perf readout. */
const app = createApp(document.getElementById('app')!);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
controls.maxDistance = 900;
const hud = document.getElementById('hud')!;
hud.textContent = 'Cove preview · loading…';

/** Spec §8.4 camera set (without Toothless): [position, target]. */
const COVE_CAMERAS: Record<string, [number, number, number, number, number, number]> = {
  wide: [-95, 48, -30, 5, 0, 5],
  rim: [46, 31, 12, -6, 0, -2],
  floor: [-26, 3.2, -16, -8, 1.2, -4],
  pond: [-8, 2.4, 16, 12, -0.3, 4],
  gully: [-70, 22, -22, -20, 2, -6],
  shadow: [0, 95, 70, 0, 0, 0],
  outward: [30, 40, 35, -160, 20, -60],
};

const setCam = (name: string) => {
  const p = COVE_CAMERAS[name];
  if (!p) return Object.keys(COVE_CAMERAS);
  app.camera.position.set(p[0], p[1], p[2]);
  controls.target.set(p[3], p[4], p[5]);
  controls.update();
  return name;
};
setCam('wide');
app.loop.addRender(() => controls.update(), 0);

/** Tint pickers edit the linear multipliers in place; lil-gui shows them divided by this, so 1.0 reads as #555. */
const TINT_PICKER_SCALE = 3;

/** Palette tuning: the six splat layer tints (live uniforms) and the rock macro-variation strength. */
function addTerrainFolder(gui: GUI, c: CoveRegion): void {
  const folder = gui.addFolder('Terrain');
  const tints: Record<string, THREE.Color> = {};
  c.header.layers.forEach((name, i) => {
    tints[name] = c.splat.uLayerTint.value[i];
    folder.addColor(tints, name, TINT_PICKER_SCALE);
  });
  folder.add(c.splat.uRockMacro, 'value', 0, 1, 0.01).name('rock macro');
  // lil-gui leaves its inputs unnamed, which DevTools flags as a form-field issue; name them to keep the console clean
  folder.domElement.querySelectorAll('input').forEach((el, k) => { el.name = `terrain-${k}`; });
}

const gui = new GUI({ title: 'Cove preview' });
let cove: CoveRegion | null = null;
debug.register('cam', { preset: setCam });
hud.textContent = 'Cove preview · loading and compiling shaders…';
createCove(app)
  .then((c) => {
    cove = c;
    app.loop.addRender((_alpha, frameDt) => c.update(frameDt, { time: app.loop.simTime, camera: app.camera, interactions: [] }), 10);
    addTerrainFolder(gui, c);
    debug.register('cove', {
      region: () => cove,
      stats: () => ({ terrain: c.terrain.stats(), collisionRoots: c.collisionRoots().length, spawn: c.spawnPoints[0] }),
      heightAt: (x: number, z: number) => c.heightAt(x, z),
      /** The live layer tints (linear multipliers), rounded: paste into COVE_LAYER_TINTS once they're settled. */
      tints: () => c.splat.uLayerTint.value.map((t) => [t.r, t.g, t.b].map((v) => +v.toFixed(3))),
      /** Show or hide the tuning panel (hidden for clean captures). */
      gui: (visible = true) => gui.show(visible),
    });
    hud.textContent = `Cove preview · quality: ${app.preset.name} · berk.cam.preset(${Object.keys(COVE_CAMERAS).join('|')})`;
    (window as unknown as { __coveReady: boolean }).__coveReady = true;
  })
  .catch((e) => {
    console.error('[cove] failed to load', e);
    hud.textContent = 'Cove failed to load — see the console';
  });
app.loop.start();
