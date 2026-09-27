import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flipRowsInto, COVE_LAYERS } from '../../src/world/terrain/layers';
import { patchSplatShader, createSplatMaterial, createSplatUniforms } from '../../src/world/terrain/splatShader';
import { TERRAIN_LAYER_IDS } from '../../pipeline/cc0/terrainLayers.mjs';

describe('layer packing', () => {
  it('flips rows so v = 0 is the image bottom', () => {
    const src = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]); // 1 px wide, 4 rows (top → bottom)
    const dst = new Uint8Array(20);
    flipRowsInto(src, dst, 4, 1, 4);
    expect(Array.from(dst)).toEqual([0, 0, 0, 0, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
  });
});

describe('layer table', () => {
  it('matches the packer and the bake order', () => {
    expect(COVE_LAYERS.map((l) => l.id)).toEqual(TERRAIN_LAYER_IDS);
    expect(createSplatUniforms().uLayerTile.value).toEqual(COVE_LAYERS.map((l) => l.tile));
  });
});

describe('splat shader', () => {
  const stdShader = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });
  it('patches every anchor of the standard program', () => {
    const s = stdShader() as never as Parameters<typeof patchSplatShader>[0];
    patchSplatShader(s, createSplatUniforms());
    expect(s.fragmentShader).toContain('uniform highp sampler2DArray tTerrainArmh');
    expect(s.fragmentShader).toContain('float roughnessFactor = tRough;');
    expect(s.fragmentShader).not.toContain('#include <map_fragment>');
    expect(s.vertexShader).toContain('vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    expect(Object.keys(s.uniforms)).toContain('uLayerTile');
  });
  it('fails loudly if three renames a chunk', () => {
    const s = stdShader() as never as Parameters<typeof patchSplatShader>[0];
    s.fragmentShader = s.fragmentShader.replace('#include <aomap_fragment>', '');
    expect(() => patchSplatShader(s, createSplatUniforms())).toThrow(/aomap_fragment/);
  });
  it('builds a keyed material with a Low variant', () => {
    const hi = createSplatMaterial(createSplatUniforms(), false);
    const lo = createSplatMaterial(createSplatUniforms(), true);
    expect(hi.customProgramCacheKey()).toContain('terrainSplat');
    expect(lo.defines).toMatchObject({ TERRAIN_LOW: '' });
    expect(hi.defines).not.toHaveProperty('TERRAIN_LOW');
  });
});
