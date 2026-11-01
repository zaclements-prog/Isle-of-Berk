import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { CollisionWorld } from '../../src/world/collision';
import { Craters } from '../../src/world/damage/craters';
import { Heightfield } from '../../src/world/terrain/heightfield';
import { Terrain } from '../../src/world/terrain/terrain';
import { toothlessFixtureRig } from '../fixtures/toothlessRig';
import { box, rampWorld } from '../fixtures/worlds';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';
import { testHeader } from '../world/terrainFixtures';

// Ground contact under a changing world (the "clips through the terrain after a close blast" bug): planted paws were
// locked to the ground as it was, a respawn or a landing left a stale landing prediction that sank the body metres,
// and nothing kept the trunk or the head out of the ground.

const DT = 1 / 120;
const CAM = new THREE.Vector3(0, 3, -8);
const idle: InputState = { keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 };
const sole = new THREE.Vector3();

/** Flat ground at y = 5 (80 m square, 0.5 m samples), its collision in 16 m tiles, and craters that dig into both. */
function craterWorld() {
  const size = 161;
  const hdr = testHeader(size, 0.5);
  const hf = new Heightfield(hdr, new Float32Array(size * size).fill(5));
  const terrain = new Terrain(hf, new THREE.MeshBasicMaterial(), 1, 1.5, { fine: { radius: 60, step: 1 }, coarse: { radius: 200, step: 2 } });
  const world = CollisionWorld.fromObjects([terrain.collisionRoot], { tile: 16 });
  const craters = new Craters(hf, { refreshTerrain: (r) => terrain.refresh(r), collision: world, tile: 16 }, null);
  return { hf, world, craters };
}

function standing(world: CollisionWorld, x = 0, z = 0): DragonCharacter {
  const d = new DragonCharacter({ rig: toothlessFixtureRig(), world });
  d.spawn(x, z, 0);
  for (let k = 0; k < 120; k++) d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
  return d;
}

/** Step n times; the deepest any FK sole goes below the live ground, and the lowest pelvis height above it. */
function run(d: DragonCharacter, world: CollisionWorld, n: number): { soleDepth: number; pelvisMin: number } {
  let soleDepth = -Infinity;
  let pelvisMin = Infinity;
  for (let k = 0; k < n; k++) {
    d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
    for (let i = 0; i < 4; i++) {
      d.legs.soleWorld(i, d.skeleton, sole);
      const g = world.groundAt(sole.x, sole.z, sole.y + 20, 40);
      if (g) soleDepth = Math.max(soleDepth, g.point.y - sole.y);
    }
    const p = d.body.pose.pelvisPos;
    const g = world.groundAt(p.x, p.z, p.y + 20, 40);
    if (g) pelvisMin = Math.min(pelvisMin, p.y - g.point.y);
  }
  return { soleDepth, pelvisMin };
}

describe('ground contact when the ground changes under him', () => {
  it('a crater lip thrown up under his planted paws lifts them out of it', () => {
    const { world, craters } = craterWorld();
    const d = standing(world);
    // a standard blast 3 m ahead: the lip rises ~0.3 m under the fore paws
    craters.dig(0, 3, 3.3, 1.3);
    const r = run(d, world, 240);
    expect(r.soleDepth).toBeLessThan(0.02);
    for (const p of d.planner.paws) {
      const g = world.groundAt(p.pos.x, p.pos.z, p.pos.y + 5, 10)!;
      expect(Math.abs(g.point.y - p.pos.y)).toBeLessThan(0.01);
    }
  });

  it('a crater dug out under him lets him down into it instead of hovering over the hole', () => {
    const { world, craters } = craterWorld();
    const d = standing(world);
    craters.dig(0, 1.5, 9, 3.5);
    const r = run(d, world, 240);
    expect(r.soleDepth).toBeLessThan(0.03);
    // standing height again, on the crater floor (it hovered ~4 m over it)
    const p = d.body.pose.pelvisPos;
    const g = world.groundAt(p.x, p.z, p.y + 20, 40)!;
    expect(p.y - g.point.y).toBeLessThan(1.3);
    expect(p.y - g.point.y).toBeGreaterThan(0.6);
  });

  it('the world counts its geometry edits (what tells him to re-check his contacts)', () => {
    const { world, craters } = craterWorld();
    const v0 = world.version;
    craters.dig(0, 0, 3, 1);
    expect(world.version).toBeGreaterThan(v0);
    const v1 = world.version;
    world.groundAt(0, 0, 10, 20);
    expect(world.version).toBe(v1);
  });
});

describe('ground contact after a respawn or a landing', () => {
  const bigFloor = () => CollisionWorld.fromObjects([box(800, 1, 800, 0, -0.5, 0)]);

  it("a corrective step after a respawn far away does not sink the body (stale landing prediction)", () => {
    const world = bigFloor();
    const d = new DragonCharacter({ rig: toothlessFixtureRig(), world });
    d.spawn(0, 0, 0);
    // walk a few strides, so every leg has predicted a touchdown here
    const walk: InputState = { ...idle, keys: new Set(['KeyW']) };
    for (let k = 0; k < 240; k++) d.update({ input: walk, cameraYaw: 0, cameraPos: CAM }, DT);
    d.spawn(300, 300, 0);
    // a paw out of its stance: the standing correction steps it at once
    d.planner.paws[0].pos.x += 0.4;
    const r = run(d, world, 120);
    expect(r.pelvisMin).toBeGreaterThan(0.6);
    expect(r.soleDepth).toBeLessThan(0.03);
  });

  it('resetFeet (a landing) seats the paws on the ground under him, not at the take-off height', () => {
    // floor at 0; a plateau 2.5 m high for z > 10
    const world = CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0), box(80, 2.5, 30, 0, 1.25, 25)]);
    const d = new DragonCharacter({ rig: toothlessFixtureRig(), world });
    d.spawn(0, 0, 0);
    // a flight carried him onto the plateau: x, z and the pelvis moved, the paws' height did not
    d.kin.pos.set(0, 0, 20);
    d.body.pose.pelvisPos.set(0, 3.5, 20);
    d.resetFeet();
    for (const p of d.planner.paws) expect(p.pos.y).toBeCloseTo(2.5, 2);
    // the flight's exact placement hands the springs the pelvis where it is (standing height over the plateau)
    d.body.reset(d.kin.pos, 0, 2.5, d.planner);
    const r = run(d, world, 120);
    expect(r.soleDepth).toBeLessThan(0.03);
    expect(r.pelvisMin).toBeGreaterThan(0.6);
  });
});

describe('the trunk and the head never pass through the ground', () => {
  const flat = () => CollisionWorld.fromObjects([box(80, 1, 80, 0, -0.5, 0)]);

  /** Deepest trunk proxy-sphere bottom below the y = 0 floor. */
  function trunkDepth(d: DragonCharacter): number {
    d.proxies.update(d.skeleton);
    let trunk = -Infinity;
    d.proxies.items.forEach((p, k) => {
      if (['chest', 'belly', 'hips'].includes(p.name)) trunk = Math.max(trunk, -(d.proxies.centers[k].y - p.radius));
    });
    return trunk;
  }

  it('a placement asking for the pelvis inside the ground is held at the floor', () => {
    const world = flat();
    const d = standing(world);
    let worst = -Infinity;
    for (let k = 0; k < 60; k++) {
      Object.assign(d.body.override, { active: true, exact: true, height: 0.15, pitch: 0, roll: 0 });
      d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
      if (k > 2) worst = Math.max(worst, trunkDepth(d));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it.skipIf(!HAS_LIBRARY)('sniffing facing up a steep slope keeps the head out of it (the pose holds its flat-ground pitch)', async () => {
    const m = await loadToothlessMotion();
    // standing on a 30° bank, facing up it: the sniff's root pitch (−0.12 rad, level ground's) buried the head 0.65 m
    const world = rampWorld(30, -3);
    const d = new DragonCharacter({ rig: m.rig, world, clips: m.clips, posesMeta: m.posesMeta });
    d.spawn(0, 0, 0);
    for (let k = 0; k < 60; k++) d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
    let worst = -Infinity;
    for (let k = 0; k < 240; k++) {
      d.layers.set('sniff', Math.min(1, k / 60), 0, false, 1);
      d.update({ input: idle, cameraYaw: 0, cameraPos: CAM }, DT);
      d.proxies.update(d.skeleton);
      d.proxies.items.forEach((p, i) => {
        if (!['head', 'muzzle', 'neck'].includes(p.name)) return;
        const c = d.proxies.centers[i];
        const inside = world.depthInside(c, 3);
        const g = inside >= 0 ? c.y + inside : world.groundAt(c.x, c.z, c.y, p.radius)?.point.y;
        if (g !== undefined) worst = Math.max(worst, g - (c.y - p.radius));
      });
    }
    expect(worst).toBeLessThan(0.06);
  });
});
