import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Terrain, TERRAIN_LOD_DISTANCES } from '../../src/world/terrain/terrain';
import { bumpy, testHeader } from './terrainFixtures';
import { CoveRegion } from '../../src/world/cove/cove';
import { removeFromApp, type App } from '../../src/app/createApp';
import { createSplatMaterial, createSplatUniforms } from '../../src/world/terrain/splatShader';
import type { LayerArrays } from '../../src/world/terrain/layers';

describe('Terrain', () => {
  const hf = bumpy(481); // 3 × 3 chunks of 160 cells
  const terrain = new Terrain(hf, new THREE.MeshBasicMaterial());
  const cam = new THREE.PerspectiveCamera();

  it('builds every chunk at the coarsest LOD, then refines near the camera', () => {
    expect(terrain.root.children).toHaveLength(9);
    expect(terrain.stats().lods.every((l) => l === 3)).toBe(true);
    cam.position.set(hf.coord(20), 10, hf.coord(20)); // over the first chunk
    cam.updateMatrixWorld();
    terrain.update(cam);
    const lods = terrain.stats().lods;
    expect(lods[0]).toBe(0);
    expect(Math.max(...lods)).toBeGreaterThan(0); // the far corner stays coarser
    expect(TERRAIN_LOD_DISTANCES).toEqual([70, 140, 240]);
  });

  it('marks the chunks under a rectangle with a render layer', () => {
    const n = terrain.enableLayerIn(5, [hf.coord(10), hf.coord(10), hf.coord(30), hf.coord(30)]);
    expect(n).toBe(1);
    expect(terrain.root.children[0].layers.isEnabled(5)).toBe(true);
    expect(terrain.root.children[4].layers.isEnabled(5)).toBe(false);
  });

  it('keeps its collision root out of the scene graph', () => {
    expect(terrain.collisionRoot.parent).toBeNull();
    expect(terrain.collisionRoot.getObjectByName('terrain-collision')).toBeTruthy();
  });
});

describe('CoveRegion.dispose (C2 regression)', () => {
  it('releases the terrain material from CSM instead of losing it when terrain.dispose() detaches its root', () => {
    const header = testHeader(65);
    const hf = bumpy(65);
    const splat = createSplatUniforms();
    const material = createSplatMaterial(splat, true);
    const terrain = new Terrain(hf, material);
    const layers = { dispose: vi.fn() } as unknown as LayerArrays;
    const releaseMaterial = vi.fn();
    const scene = new THREE.Scene();
    // Minimal stub: CoveRegion's constructor only reads app.preset.name, and dispose() only calls
    // app.remove(root) — exactly App.remove's real body (removeFromApp), with a spy lighting.
    const app = {
      preset: { name: 'low' },
      remove: (root: THREE.Object3D) => removeFromApp(scene, { releaseMaterial }, root),
    } as unknown as App;

    const region = new CoveRegion(app, 'assets/', header, hf, terrain, splat, layers);
    scene.add(region.root);

    region.dispose();

    const terrainMaterialCalls = releaseMaterial.mock.calls.filter((c) => c[0] === material);
    expect(terrainMaterialCalls).toHaveLength(1);
  });
});
