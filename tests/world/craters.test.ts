import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Heightfield } from '../../src/world/terrain/heightfield';
import { Terrain } from '../../src/world/terrain/terrain';
import { createHeightTexture } from '../../src/world/terrain/heightTexture';
import { CollisionWorld } from '../../src/world/collision';
import { Craters, DEFAULT_CRATER } from '../../src/world/damage/craters';
import { WorldEvents } from '../../src/world/events';
import { testHeader } from './terrainFixtures';

/** A 160 m square of gently rolling ground at 1 m, with one steep rock bank along x > 40. */
function ground(): Heightfield {
  const size = 161;
  const h = new Float32Array(size * size);
  const hdr = testHeader(size, 1);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = hdr.origin + i;
      const z = hdr.origin + j;
      h[j * size + i] = 5 + 0.3 * Math.sin(x * 0.1) * Math.cos(z * 0.08) + Math.max(0, x - 40) * 1.5;
    }
  }
  return new Heightfield(hdr, h);
}

function setup() {
  const hf = ground();
  const terrain = new Terrain(hf, new THREE.MeshBasicMaterial(), 1, 1.5, { fine: { radius: 60, step: 1 }, coarse: { radius: 200, step: 2 } });
  const world = CollisionWorld.fromObjects([terrain.collisionRoot], { tile: 32 });
  const tex = createHeightTexture(hf);
  const events = new WorldEvents();
  let changed = 0;
  const craters = new Craters(hf, { refreshTerrain: (r) => terrain.refresh(r), collision: world, tile: 32, heightTexture: tex, changed: () => changed++ }, events);
  return { hf, terrain, world, tex, events, craters, changed: () => changed };
}

const blast = (x: number, y: number, z: number, power = 1) => ({
  type: 'blast' as const, point: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(0, 1, 0), power, radius: 6 * power, time: 0,
});

describe('craters', () => {
  it('digs a bowl with a raised lip, and everything built on the ground follows', () => {
    const { hf, terrain, world, tex, events, craters, changed } = setup();
    const y0 = hf.heightAt(0, 0);
    const lip0 = hf.heightAt(3.6, 0);
    const far0 = hf.heightAt(12, 0);
    events.emit(blast(0, y0, 0));
    expect(hf.heightAt(0, 0)).toBeLessThan(y0 - DEFAULT_CRATER.depth * 0.8);
    expect(hf.heightAt(3.6, 0)).toBeGreaterThan(lip0 + 0.1);         // the lip, a little past the rim
    expect(hf.heightAt(12, 0)).toBeCloseTo(far0, 5);                 // untouched beyond it
    expect(changed()).toBe(1);
    // collision agrees with the new ground everywhere around the crater
    for (let k = 0; k < 200; k++) {
      const x = ((k * 0.618) % 1) * 16 - 8;
      const z = ((k * 0.414) % 1) * 16 - 8;
      expect(world.groundAt(x, z, 30, 60)!.point.y).toBeCloseTo(hf.heightAt(x, z), 3);
    }
    // the render chunk under it has been rebuilt from the dug ground
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 10, 0);
    cam.updateMatrixWorld();
    terrain.update(cam);
    const rc = new THREE.Raycaster(new THREE.Vector3(0.2, 50, 0.3), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObjects(terrain.root.children, false)[0];
    expect(hit.point.y).toBeCloseTo(hf.heightAt(0.2, 0.3), 3);
    // and the height texture the water reads
    const k = Math.round(-hf.origin) * hf.size + Math.round(-hf.origin);
    expect(THREE.DataUtils.fromHalfFloat((tex.image.data as Uint16Array)[k])).toBeCloseTo(hf.heights[k], 1);
    expect(craters.lastMs).toBeLessThan(80); // the browser budget is 8 ms; this shared CI box is far slower
  });

  it('digs deeper with power and with repeated blasts, down to a limit, and less into rock', () => {
    const { hf, events } = setup();
    const y0 = hf.heightAt(-20, 0);
    events.emit(blast(-20, y0, 0, 2));
    const d2 = y0 - hf.heightAt(-20, 0);
    const { hf: hf1, events: ev1 } = setup();
    ev1.emit(blast(-20, y0, 0, 1));
    const d1 = y0 - hf1.heightAt(-20, 0);
    expect(d2).toBeGreaterThan(d1 * 1.6);
    for (let n = 0; n < 12; n++) events.emit(blast(-20, hf.heightAt(-20, 0), 0, 2));
    expect(y0 - hf.heightAt(-20, 0)).toBeLessThanOrEqual(DEFAULT_CRATER.maxDepth + 1e-4);
    // the rock bank
    const r0 = hf.heightAt(55, 0);
    events.emit(blast(55, r0, 0));
    expect(r0 - hf.heightAt(55, 0)).toBeLessThan(d1 * 0.6);
  });

  it('leaves the ground alone under an air burst', () => {
    const { hf, events, changed } = setup();
    const y0 = hf.heightAt(0, 0);
    events.emit(blast(0, y0 + 10, 0));
    expect(hf.heightAt(0, 0)).toBe(y0);
    expect(changed()).toBe(0);
  });
});
