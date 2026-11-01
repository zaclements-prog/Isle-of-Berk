import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { InputState } from '../../src/core/input';
import { Heightfield } from '../../src/world/terrain/heightfield';
import { ISLAND_COLLISION, terrainCollisionRoot } from '../../src/world/terrain/collisionMesh';
import { buildProps, boulderGeometry, pineGeometry } from '../../src/world/island/props';
import { buildBerk } from '../../src/world/island/berk';
import type { IslandHeader } from '../../src/world/island/island';
import { rippleNormalTexture } from '../../src/world/island/ocean';
import { CollisionWorld } from '../../src/world/collision';
import { DragonCharacter } from '../../src/characters/dragon/motion/dragon';
import { HAS_LIBRARY, loadToothlessMotion } from '../fixtures/toothlessAsset';

const DIR = 'public/assets/world/island/';
const HAS_ISLAND = existsSync(`${DIR}terrain.json`) && existsSync(`${DIR}height.bin`);

function loadIsland(): { header: IslandHeader; hf: Heightfield } {
  const header = JSON.parse(readFileSync(`${DIR}terrain.json`, 'utf8')) as IslandHeader;
  return { header, hf: Heightfield.fromUint16LE(header, readFileSync(`${DIR}height.bin`)) };
}

describe('island props', () => {
  it('builds pines about 9 m tall and boulders about a metre across', () => {
    for (let v = 0; v < 3; v++) {
      const g = pineGeometry(v);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeCloseTo(0, 1);
      expect(g.boundingBox!.max.y).toBeGreaterThan(7);
      expect(g.boundingBox!.max.y).toBeLessThan(12);
      expect(g.attributes.color).toBeDefined();
    }
    const b = boulderGeometry(0);
    b.computeBoundingBox();
    const s = new THREE.Vector3();
    b.boundingBox!.getSize(s);
    expect(s.x).toBeGreaterThan(0.9);
    expect(s.y).toBeLessThan(s.x);
  });

  it('makes a seamless ripple normal map', () => {
    const t = rippleNormalTexture(64);
    const d = t.image.data as Uint8Array;
    const at = (i: number, j: number) => d[(j * 64 + i) * 4];
    let edge = 0;
    for (let j = 0; j < 64; j++) edge = Math.max(edge, Math.abs(at(63, j) - at(0, j)));
    expect(edge).toBeLessThan(40);                                // the last column runs on into the first
  });
});

describe.skipIf(!HAS_ISLAND)('Test Isle runtime', () => {
  it('places every pine and boulder on the ground, with trunk and boulder collision', () => {
    const { header, hf } = loadIsland();
    const props = buildProps(header.trees, header.rocks, (x, z) => hf.heightAt(x, z));
    expect(props.collision.map((o) => o.name).sort()).toEqual(['boulders_collision', 'trunks_collision']);
    const inst = props.root.children as THREE.InstancedMesh[];
    expect(inst.reduce((n, m) => n + m.count, 0)).toBe(header.trees.length + header.rocks.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const mesh of inst) {
      for (let k = 0; k < Math.min(mesh.count, 50); k++) {
        mesh.getMatrixAt(k, m);
        p.setFromMatrixPosition(m);
        expect(p.y).toBeLessThan(hf.heightAt(p.x, p.z) + 0.01);    // sunk a little, never floating
        expect(p.y).toBeGreaterThan(hf.heightAt(p.x, p.z) - 1.5);
      }
    }
    props.dispose();
  });

  it('builds the village, the Great Hall, the piers and the Kill Ring, with house, hall and deck collision', () => {
    const { header } = loadIsland();
    const berk = buildBerk(header);
    const names = berk.root.children.map((o) => o.name);
    expect(names).toContain('GreatHall');
    expect(names).toContain('KillRing');
    expect(names.filter((n) => n === 'pier')).toHaveLength(header.docks.length);
    const houses = berk.root.children.filter((o) => o.name.startsWith('houses_')) as THREE.InstancedMesh[];
    expect(houses.reduce((n, m) => n + m.count, 0)).toBe(header.houses.length);
    expect(berk.collision).toHaveLength(1);
    // the hall's door faces the village: the hall stands on its terrace
    const hall = berk.root.getObjectByName('GreatHall')!;
    expect(hall.position.y).toBeCloseTo(header.hall.height - 0.3, 1);
    berk.dispose();
  });

  it.skipIf(!HAS_LIBRARY)('Toothless spawns on the path below the Great Hall, then gallops across the plateau', { timeout: 60_000 }, async () => {
    const { header, hf } = loadIsland();
    const props = buildProps(header.trees, header.rocks, (x, z) => hf.heightAt(x, z));
    const berk = buildBerk(header);
    const world = CollisionWorld.fromObjects([terrainCollisionRoot(hf, ISLAND_COLLISION), ...props.collision, ...berk.collision]);
    const a = await loadToothlessMotion();
    const d = new DragonCharacter({ rig: a.rig, world, clips: a.clips, posesMeta: a.posesMeta, seed: 1 });
    const s = header.spawn[0];
    d.spawn(s.x, s.z, s.heading);
    expect(Math.abs(d.kin.pos.y - hf.heightAt(s.x, s.z))).toBeLessThan(0.3);
    const input = (keys: string[]): InputState => ({ keys: new Set(keys), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, buttons: 0, buttonsPressed: 0 });
    const cam = new THREE.Vector3(s.x, hf.heightAt(s.x, s.z) + 3, s.z - 8);
    for (let k = 0; k < 120; k++) d.update({ input: input([]), cameraYaw: s.heading, cameraPos: cam }, 1 / 120);
    expect(d.nanResets).toBe(0);
    // the plateau, heading west across it
    const p = header.plateau;
    d.spawn(p.x + 30, p.z - 10, -Math.PI / 2);
    expect(d.kin.pos.y).toBeCloseTo(p.height, 0);
    for (let k = 0; k < 360; k++) d.update({ input: input(['KeyW', 'ShiftLeft']), cameraYaw: -Math.PI / 2, cameraPos: cam }, 1 / 120);
    expect(d.nanResets).toBe(0);
    expect(d.kin.speed).toBeGreaterThan(7);
    expect(Math.abs(d.kin.pos.y - hf.heightAt(d.kin.pos.x, d.kin.pos.z))).toBeLessThan(0.3);
    props.dispose();
    berk.dispose();
  });
});
