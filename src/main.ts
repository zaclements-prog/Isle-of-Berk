import './styles.css';
import { createApp } from './app/createApp';
import { createTestScene } from './world/testScene';
import { CollisionWorld } from './world/collision';
import { createToothless } from './characters/dragon/toothless';

const app = createApp(document.getElementById('app')!);
const test = createTestScene();
app.add(test.root);
app.loop.addSim(() => test.update(app.loop.simTime));
const world = CollisionWorld.fromObjects([test.root]);
const hud = document.getElementById('hud')!;
hud.textContent = 'Loading Toothless…';

createToothless({ app, world, spawn: { x: 0, z: 6, heading: Math.PI } })
  .then(() => {
    hud.textContent = `Isle of Berk · click to control · WASD move · Shift gallop · C prowl · Space jump · F / left click plasma · mouse look · wheel zoom · quality: ${app.preset.name}`;
  })
  .catch((e) => {
    console.error('[game] Toothless failed to load', e);
    hud.textContent = 'Toothless failed to load — see the console';
  });
app.loop.start();
