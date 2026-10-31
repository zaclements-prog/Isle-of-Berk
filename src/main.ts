import './styles.css';
import { createApp } from './app/createApp';
import { createTestScene } from './world/testScene';
import { CollisionWorld } from './world/collision';
import { createIsland } from './world/island/island';
import { createToothless } from './characters/dragon/toothless';

const KEYS = 'click to control · WASD move · Shift gallop · C prowl · Space jump · hold Space (standing) or Space at a gallop: take off · '
  + 'flying: mouse steers, W flap, S brake, Space land · F / left click plasma · mouse look · wheel zoom';

/**
 * The game page. The Test Isle by default (docs/superpowers/plans/2026-11-01-test-isle.md); `?scene=test` keeps the
 * M1 look-dev plane with its swatches and blocks.
 */
const app = createApp(document.getElementById('app')!);
const hud = document.getElementById('hud')!;
const scene = new URLSearchParams(location.search).get('scene') ?? 'island';

async function start(): Promise<void> {
  let world: CollisionWorld;
  let spawn = { x: 0, z: 6, heading: Math.PI };
  if (scene === 'test') {
    const test = createTestScene();
    app.add(test.root);
    app.loop.addSim(() => test.update(app.loop.simTime));
    world = CollisionWorld.fromObjects([test.root]);
  } else {
    hud.textContent = 'Loading the island…';
    const island = await createIsland(app);
    world = CollisionWorld.fromObjects(island.collisionRoots());
    spawn = { ...island.spawnPoints[0] };
    const ctx = { time: 0, camera: app.camera, interactions: [] };
    app.loop.addRender((_alpha, frameDt) => {
      ctx.time += frameDt;
      island.update(frameDt, ctx);
    }, -1);
  }
  hud.textContent = 'Loading Toothless…';
  await createToothless({ app, world, spawn });
  hud.textContent = `Isle of Berk · ${KEYS} · quality: ${app.preset.name}`;
}

start().catch((e) => {
  console.error('[game] failed to load', e);
  hud.textContent = 'Failed to load — see the console';
});
app.loop.start();
