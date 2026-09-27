import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flipRowsInto, COVE_LAYERS, COVE_LAYER_TINTS } from '../../src/world/terrain/layers';
import { patchSplatShader, createSplatMaterial, createSplatUniforms, SPLAT_MAP_FRAGMENT } from '../../src/world/terrain/splatShader';
import { TERRAIN_LAYER_IDS } from '../../pipeline/cc0/terrainLayers.mjs';

/** Keeps only the lines a GLSL preprocessor would, for the #ifdef / #ifndef / #else / #endif directives. */
function preprocess(src: string, defines: string[]): string {
  const live: boolean[] = [];
  const out: string[] = [];
  for (const line of src.split('\n')) {
    const d = line.trim().match(/^#(ifdef|ifndef|else|endif)\b\s*(\w*)/);
    if (d?.[1] === 'ifdef' || d?.[1] === 'ifndef') live.push(defines.includes(d[2]) === (d[1] === 'ifdef'));
    else if (d?.[1] === 'else') live.push(!live.pop());
    else if (d?.[1] === 'endif') live.pop();
    else if (live.every(Boolean)) out.push(line);
  }
  return out.join('\n');
}

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
  it('gives every layer a positive tint, loaded as-is (linear multipliers, no colour-space conversion)', () => {
    expect(COVE_LAYER_TINTS).toHaveLength(COVE_LAYERS.length);
    for (const t of COVE_LAYER_TINTS) for (const v of t) expect(v).toBeGreaterThan(0);
    expect(createSplatUniforms().uLayerTint.value.map((c) => [c.r, c.g, c.b])).toEqual(COVE_LAYER_TINTS);
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
  it('tints every layer through uniforms, so the hook text is the same for any tint (hook-key contract)', () => {
    const a = stdShader() as never as Parameters<typeof patchSplatShader>[0];
    const b = stdShader() as never as Parameters<typeof patchSplatShader>[0];
    const ua = createSplatUniforms();
    const ub = createSplatUniforms();
    ub.uLayerTint.value[0].setRGB(0.2, 1.7, 0.4);
    ub.uRockMacro.value = 0.3;
    patchSplatShader(a, ua);
    patchSplatShader(b, ub);
    expect(b.fragmentShader).toBe(a.fragmentShader);
    expect(b.vertexShader).toBe(a.vertexShader);
    expect(a.fragmentShader).toContain('uniform vec3 uLayerTint[6];');
    expect(a.fragmentShader).toContain('uniform float uRockMacro;');
    expect(a.fragmentShader).toContain('alb *= uLayerTint[i];');
    expect(a.uniforms.uLayerTint).toBe(ua.uLayerTint);
    expect(b.uniforms.uRockMacro).toBe(ub.uRockMacro);
  });
  it('varies the rock at a second 0.37× scale on High only; Low keeps just the brightness noise', () => {
    const high = preprocess(SPLAT_MAP_FRAGMENT, []);
    const low = preprocess(SPLAT_MAP_FRAGMENT, ['TERRAIN_LOW']);
    expect(high).toContain('s * 0.37');
    expect(low).not.toContain('s * 0.37');
    expect(high).toContain('0.12 * uRockMacro');
    expect(low).toContain('0.12 * uRockMacro');
    expect(low).not.toContain('berkTriSample');
  });
});
