import '../../styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createApp } from '../../app/createApp';
import { buildCourse } from './course';
import { captureFilmstrip, showOverlay, hideOverlay } from '../filmstrip';
import { debug } from '../../core/debug';

const app = createApp(document.getElementById('app')!);
const course = buildCourse();
app.add(course.root);

const grid = new THREE.GridHelper(160, 160, 0x445566, 0x2b3440);
grid.position.y = 0.01;
grid.material.fog = false; // a dev overlay: keep it crisp under scene.fog (the N8AO fog proxy)
app.scene.add(grid); // exempt from the material pipeline (Ruling 3)

app.camera.position.set(0, 18, 38);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
controls.target.set(0, 0, 0);
app.loop.addRender(() => controls.update(), 0);

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
  filmstrip(frames = 12, stepsBetween = 10, columns = 6) {
    const wasPaused = app.loop.isPaused;
    app.loop.pause();
    const strip = captureFilmstrip(
      { frames, stepsBetween, columns, thumbWidth: 320 },
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

document.getElementById('hud')!.textContent = `Motion Lab · quality: ${app.preset.name}`;
app.loop.start();
