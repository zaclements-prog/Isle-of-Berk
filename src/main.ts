import './styles.css';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createApp } from './app/createApp';
import { createTestScene } from './world/testScene';
import { debug } from './core/debug';

const app = createApp(document.getElementById('app')!);
const test = createTestScene();
app.add(test.root);

app.camera.position.set(9, 4.5, 11);
const controls = new OrbitControls(app.camera, app.renderer.domElement);
controls.target.set(0, 1.4, 0);
app.loop.addSim(() => test.update(app.loop.simTime));
app.loop.addRender(() => controls.update(), 0);

const CAMS: Record<string, [number, number, number, number, number, number]> = {
  hero: [4.5, 2.2, 5.5, 0, 1.4, 0],
  wide: [30, 14, 40, 0, 2, -40],
  low: [2, 0.6, 8, 0, 1.5, 0],
};
debug.register('cam', {
  preset(name: string) {
    const p = CAMS[name];
    if (!p) return Object.keys(CAMS);
    app.camera.position.set(p[0], p[1], p[2]);
    controls.target.set(p[3], p[4], p[5]);
    controls.update();
    return name;
  },
});

document.getElementById('hud')!.textContent = `Isle of Berk — foundation test scene · quality: ${app.preset.name}`;
app.loop.start();
