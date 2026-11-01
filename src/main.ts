import './styles.css';
import * as THREE from 'three';
import { createApp } from './app/createApp';
import { createTestScene } from './world/testScene';
import { CollisionWorld } from './world/collision';
import { createIsland } from './world/island/island';
import { createToothless } from './characters/dragon/toothless';
import { WorldEvents } from './world/events';
import { ForceField } from './world/forceField';
import { debug } from './core/debug';

const KEYS = 'click to control · WASD move · Shift gallop · C prowl · Space jump · hold Space (standing) or Space at a gallop: take off · '
  + 'flying: mouse steers, W flap, S brake, Space land · F / left click plasma · mouse look · wheel zoom';

/**
 * The game page. The Test Isle by default (docs/superpowers/plans/2026-11-01-test-isle.md); `?scene=test` keeps the
 * M1 look-dev plane with its swatches and blocks; `?look=photo` shows the island in the Cove's photo-texture look.
 */
const app = createApp(document.getElementById('app')!);
const hud = document.getElementById('hud')!;
const scene = new URLSearchParams(location.search).get('scene') ?? 'island';

/** The world's events (blasts…) and the force field the grass, trees and water read (world-interaction plan). */
const events = new WorldEvents();
const field = new ForceField(undefined, events);
const interactions = field.contacts;
let groundAt: (x: number, z: number) => number = () => 0;
let explode: ((at: THREE.Vector3) => void) | null = null;

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
    const look = new URLSearchParams(location.search).get('look') === 'photo' ? 'photo' : 'stylised';
    const island = await createIsland(app, { look, force: field.uniforms });
    // the air meets the sea at sea level, the pond at its own
    const sea = island.header.seaLevel;
    const P = island.header.cove.pond;
    groundAt = (x, z) => Math.max(island.heightAt(x, z), sea, Math.hypot(x - P.x, z - P.z) < P.r ? P.level : -Infinity);
    // layered collision: terrain tiles that can be rebuilt, trees and buildings that can be removed
    const collision = island.createCollisionWorld();
    world = collision.world;
    // blasts scorch the ground, burn and flatten the grass, and scorch and fell trees
    island.enableDamage(events, collision, field.uniforms);
    debug.register('world', {
      /** Live counts: grass tufts and flowers in the ring, trees by state, collision layers and triangles. */
      stats: () => ({
        tufts: island.grass?.tufts.count ?? 0, flowers: island.grass?.flowers.count ?? 0, trees: island.trees?.census(),
        broken: island.structures?.broken ?? 0, debris: island.debris?.pieces.length ?? 0, moving: island.debris?.active ?? 0,
        layers: world.layers.length, triangles: world.triangles, downwash: +field.downwash.toFixed(3),
      }),
      /** Camera and force-field state (diagnostics). */
      probe: () => ({
        cam: app.camera.position.toArray(), down: field.uniforms.uForceDown.value.toArray(), downS: field.uniforms.uForceDownS.value,
        wake: field.uniforms.uForceWake.value.toArray(), wakeDir: field.uniforms.uForceWakeDir.value.toArray(),
        shocks: field.uniforms.uForceShockS.value.map((v) => v.x),
      }),
      /** Set off a blast on the ground at (x, z): power 1 is his plasma, with its explosion; other powers, the event alone. */
      blast: (x: number, z: number, power = 1) => (power === 1 && explode ? explode(new THREE.Vector3(x, island.heightAt(x, z), z)) : events.emit({
        type: 'blast', point: new THREE.Vector3(x, island.heightAt(x, z), z), normal: new THREE.Vector3(0, 1, 0),
        power, radius: 6 * power, time: app.loop.simTime,
      })),
    });
    spawn = { ...island.spawnPoints[0] };
    const ctx = { time: app.loop.simTime, camera: app.camera, interactions };
    // the island's grass, trees and sea animate on simulation time, not wall-clock frame time: the same motion at any
    // frame rate, and a paused, stepped capture (berk.step) shows exactly what play shows
    app.loop.addRender(() => {
      const dt = Math.max(0, app.loop.simTime - ctx.time);
      ctx.time = app.loop.simTime;
      island.update(dt, ctx);
    }, -1);
  }
  hud.textContent = 'Loading Toothless…';
  const t = await createToothless({ app, world, spawn, events });
  field.source = () => t.forceSource(groundAt);
  explode = (at) => t.fx.explode(at, new THREE.Vector3(0, 1, 0));
  // what parts the island's grass: his paws and the low body (chest, belly, hips, the start of the tail)
  const d = t.dragon;
  const body = d.proxies.items.flatMap((p, k) => (['chest', 'belly', 'hips', 'tail_a', 'tail_b'].includes(p.name) ? [k] : []));
  const spheres = [0, 1, 2, 3].map(() => ({ center: new THREE.Vector3(), radius: 0.32 }))
    .concat(body.map((k) => ({ center: d.proxies.centers[k], radius: d.proxies.items[k].radius * 1.3 })));
  interactions.push(...spheres);
  app.loop.addSim((dt) => {
    for (let i = 0; i < 4; i++) d.legs.soleWorld(i, d.skeleton, spheres[i].center);
    field.update(app.loop.simTime, dt);
  });
  hud.textContent = `Isle of Berk · ${KEYS} · quality: ${app.preset.name}`;
}

start().catch((e) => {
  console.error('[game] failed to load', e);
  hud.textContent = 'Failed to load — see the console';
});
app.loop.start();
